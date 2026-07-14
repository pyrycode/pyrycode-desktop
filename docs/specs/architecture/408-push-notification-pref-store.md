# Architecture: Push-notification preference — persisted on/off store (#408)

**Ticket:** #408 (split-child of #353) · **Size:** S · **Security-sensitive:** No · **UI:** None (data half)

## Design source

N/A — this slice renders nothing; it is the data half of the push-notification toggle. The Settings toggle UI lands in the sibling slice #409 (Figma 17-64). The Figma 17-68 reference in the ticket body justifies only the *default value* (the mobile knob's on-position), not a UI deliverable here — no visual-fidelity check applies.

## Files to read first

- `src/renderer/src/store/defaultWorkspaceStore.ts` (whole, 99 lines) — **the exact structural precedent to clone (#403, merged).** Copy its shape verbatim: injected `…PrefStorage` port → React-free `createStore` core reading the port once at construction → app-wide singleton wired to the real localStorage port → `use…Store` hook → narrow selector. Note the `typeof window === 'undefined'` **import-safety guard** in `localStorageWorkspacePref` (lines 47-57) and the deliberate *no* try/catch (lines 38-46) — reproduce both decisions.
- `src/renderer/src/store/defaultWorkspaceStore.test.ts` (whole, 100 lines) — **the test idiom to clone.** In-memory `fakeStorage()` closure over a mutable value with `vi.fn` read/write spies; a *second* store constructed over the SAME fake as the "simulated restart" (lines 63-70) — this is the pattern that proves persistence; the DI-isolation test (72-78); the `…_KEY` namespace assertion (89-91) and the window-absent guard test (95-99). Mirror it structurally.
- `src/renderer/src/store/recentWorkspacesStore.ts` and `serverInfoStore.ts` — one-line skim only: additional pure-store precedents confirming the DI-factory → singleton → hook → selector shape is the house style for renderer-local state.
- `CLAUDE.md` (repo root, "Conventions") — the unidirectional-state + sealed-store rules: read-only selector, single setter, never two-way-bound.

## Context

Desktop push notifications exist end-to-end on the main-process side: the primitive fires an OS notification when the window is unfocused (#391, done) and clicking one focuses the window (#393, done). The renderer trigger that decides *when* to fire (#392, blocked) must read a user preference before firing. This slice is that preference — a renderer-local, persisted on/off boolean. It renders nothing.

Consumers, **not built here** (both blocked on this slice):
- **#392** (renderer trigger) — reads the singleton via `selectPushNotificationsEnabled` before firing.
- **#409** (Settings toggle UI) — dispatches into `setPushNotificationsEnabled`.

The renderer-local-persistence idiom already exists and landed as `defaultWorkspaceStore.ts` (#403). This slice mirrors it rather than inventing a second, divergent persistence pattern. (The `serverInfoStore` reference in the ticket's earlier drafts is superseded — it has no persistence half.)

## Design

New module: **`src/renderer/src/store/pushNotificationPrefStore.ts`**. One file, structurally identical to `defaultWorkspaceStore.ts`, with the two deltas the ticket calls out.

### Contract (signatures — not bodies)

```ts
// The injected DI seam. read() reports what is persisted, distinguishing "never set" (null) from a
// stored false. write() persists a concrete boolean — there is no "clear" path (the toggle only ever
// sets true|false; a reset-to-default action does not exist), which is a deliberate simplification vs.
// the workspace port's null-clear.
export interface PushNotificationPrefStorage {
  read(): boolean | null   // null === never persisted (fresh install)
  write(value: boolean): void
}

// The default-on-empty, kept as a single source of truth (Delta 1). Absence resolves to enabled.
export const PUSH_NOTIFICATIONS_DEFAULT_ENABLED = true as const

// Load-bearing storage key value; sibling to 'pyry.defaultWorkspace'. Const NAME is a preference; the
// STRING is the contract. Do NOT extract a shared namespacing helper — the app's second key only; the
// precedent's own comment defers that abstraction until a genuine third case.
export const PUSH_NOTIFICATIONS_ENABLED_KEY = 'pyry.pushNotificationsEnabled' as const

// Pure encode/decode — the only home of the string<->boolean coercion (Delta 2). Extracted (unlike the
// workspace port's inline getItem) precisely because the coercion is a correctness trap the `node`
// runtime cannot exercise via the real port; see Testing strategy. decode recognizes EXACTLY the two
// values encode emits; anything else (absent or corrupt) is null === "not a valid persisted value".
export function encodePushPref(value: boolean): string          // true -> 'true', false -> 'false'
export function decodePushPref(raw: string | null): boolean | null  // 'true'->true, 'false'->false, else null

// Real localStorage-backed port. read() = decodePushPref(getItem(KEY)); write() = setItem(KEY, encode).
// Mirror localStorageWorkspacePref's `typeof window === 'undefined'` guard EXACTLY: under node/static
// render read() returns null and write() is a no-op, so constructing the singleton is import-safe. No
// try/catch (unobserved failure mode; Evidence-Based Fix Selection).
export function localStoragePushNotificationPref(): PushNotificationPrefStorage

export interface PushNotificationPrefState { pushNotificationsEnabled: boolean }
export type PushNotificationPrefStore = PushNotificationPrefState & {
  setPushNotificationsEnabled: (value: boolean) => void
}

// DI-friendly, React-free. Hydration: initial state = storage.read() ?? PUSH_NOTIFICATIONS_DEFAULT_ENABLED
// (Delta 1 — map "not persisted" to the enabled default AT THE STORE, not in the port; the port stays a
// faithful "what's persisted" reporter). Set-through: setter calls storage.write(value) THEN set(...).
export function createPushNotificationPrefStore(storage: PushNotificationPrefStorage): /* zustand vanilla store */

// App-wide singleton over the real port — the read surface #392 reads, the write surface #409 dispatches.
export const pushNotificationPrefStore = createPushNotificationPrefStore(localStoragePushNotificationPref())

// Narrow-slice React binding + the sole read surface. Selector types against the State, not the Store.
export function usePushNotificationPrefStore<T>(selector: (s: PushNotificationPrefStore) => T): T
export const selectPushNotificationsEnabled = (s: PushNotificationPrefState): boolean => s.pushNotificationsEnabled
```

### The two deltas vs. the workspace precedent

1. **Boolean with a meaningful default-on-empty (AC2).** `defaultWorkspace` treats absence as *itself* the value (`null` = "no default set"). Here absence must resolve to **enabled**. The mapping lives at store construction — `storage.read() ?? PUSH_NOTIFICATIONS_DEFAULT_ENABLED` — with the default as a single exported constant. The port never invents the default; it only reports `boolean | null`.

2. **Serialization + a not-set-vs-stored-`false` sentinel, localized in the port (AC3, AC4-last).** `localStorage` holds strings, so the boolean is encoded (`encodePushPref`) and decoded (`decodePushPref`) *inside* the port. `decodePushPref` maps `null` (never set) → `null` and an unrecognized string → `null`, but a stored `'false'` → `false`. This keeps "never set" distinguishable from an explicit `false`, so a user who toggled off is **not** silently re-enabled on next launch. This is the delta that gives the last AC its teeth.

### Why a single setter, not a reducer

Exactly one mutation exists ("record the on/off choice"). A discriminated-union action set would be a one-member union — ceremony without benefit, exactly as the workspace precedent reasons. Unidirectional is preserved: read-only selector, one write path (`setPushNotificationsEnabled`), never two-way-bound — #409 dispatches into the setter, it does not bind a field to it.

## State + concurrency model

- **Store slice:** a dedicated store (not a facet of an existing one) — the preference is orthogonal to connection/messages/conversation-list state, so only components selecting it re-render. Mirrors the `defaultWorkspaceStore` isolation rationale.
- **No async, no streams, no teardown:** `localStorage` access is synchronous; the store reads once at construction and writes synchronously in the setter. No subscriptions, no `AbortController`, no bridge (this is not a daemon-event store — it has no wire surface). No IPC, no preload bridge: a UX boolean is not a secret and need not sit behind the transport boundary.
- **Single source of state:** the singleton is the one source of truth; `localStorage` is its backing store, reconciled only through the port. No parallel mutable copy elsewhere.

## Error handling

- **localStorage quota/disabled:** not an observed failure mode in the Electron renderer (single short path, always-present storage). No try/catch — a defense for an unobserved failure is Evidence-Based Fix Selection's anti-pattern; if it ever surfaces, the fix is localized to the port. (Mirrors the precedent's explicit note.)
- **Corrupt/hand-edited stored value** (e.g. `'maybe'`): `decodePushPref` returns `null`, so the store falls back to the enabled default — the natural, total behavior of "recognize exactly the two encodings I emit." This is a pure-function domain definition, not a speculative safety net.
- **`window` absent (node/static render):** the import-safety guard makes `read()` → `null` and `write()` a no-op; the singleton constructs cleanly and starts at the enabled default.

## Testing strategy

`src/renderer/src/store/pushNotificationPrefStore.test.ts`, vitest `node` runtime, cloning `defaultWorkspaceStore.test.ts`. Plain-function tests over isolated `createPushNotificationPrefStore()` instances — no React, no DOM. Use an in-memory fake port:

- `fakeStorage(seed: boolean | null = null)` — closure over a mutable `boolean | null`, exposing `read`/`write` as `vi.fn` spies; `write` mutates the backing value so a second store over the same fake hydrates the first's write. The fake stores the *decoded* `boolean | null` directly (modeling the port's output contract), so it exercises the store's default-mapping without touching string encode/decode.

**Store scenarios (bullet the inputs → expected; the developer writes the assertions in-idiom):**
- Empty storage → `pushNotificationsEnabled === true`; `selectPushNotificationsEnabled` returns `true` (AC1/AC2 default-enabled).
- `fakeStorage(false)` at construction → state is `false`; `read` called exactly once (AC1 restore-half; proves a stored `false` is honored, not defaulted).
- `fakeStorage(true)` at construction → state is `true`.
- Write-then-read within a session: `set(false)` → selector returns `false` (AC4 write-then-read).
- Setter persists through the port: `set(false)` → `storage.write` called with `false` (AC3 persist-half).
- **Simulated restart (AC4-critical):** store `a` over a fresh fake; `a.set(false)`; construct store `b` over the SAME fake → `b` reads `false`, **not** re-defaulted to `true`. Repeat asserting `a.set(true)` → `b` reads `true`. This is the "explicitly toggled off stays off" guarantee.
- DI isolation: two stores over independent fakes don't cross-contaminate.
- Setter reference stable across updates (re-render correctness), mirroring the precedent's last store test.

**Port / helper scenarios (the Delta-2 coverage the `node` runtime cannot reach through the real port):**
- `PUSH_NOTIFICATIONS_ENABLED_KEY === 'pyry.pushNotificationsEnabled'` (namespace assertion).
- `localStoragePushNotificationPref()` is a safe no-op when `window` is absent: `read()` → `null`, `write(true)` does not throw (import-safety guard).
- **`decodePushPref` sentinel (directly unit-tested — this is why the helpers are extracted):** `decodePushPref(null) === null`; `decodePushPref('false') === false`; `decodePushPref('true') === true`; `decodePushPref('garbage') === null`. This deterministically pins the not-set-vs-stored-`false` distinction that the real port's `getItem` decode depends on but the `node` runtime cannot exercise (window is undefined, so the real `read()` short-circuits to `null`).
- **`encodePushPref` round-trip:** `decodePushPref(encodePushPref(v)) === v` for `v ∈ {true, false}`.

`npm run typecheck` covers the store's type surface (selector types against `PushNotificationPrefState`, setter against `boolean`); `npm test` covers the above.

## Open questions

- **Encoding literal.** Spec picks `'true'`/`'false'` (devtools-readable, matches JS boolean `toString`). Fully localized to the port helpers; `'1'`/`'0'` would be equivalent. Not worth a decision gate.
- **Reset-to-default (clear) path.** Deliberately omitted — the setter is boolean-only; #409's toggle never needs to un-set. If a future "restore defaults" action appears, add a `write`-clearing path then (YAGNI now).
