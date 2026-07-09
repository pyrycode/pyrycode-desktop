# #187 — Run configuration sheet: request a snapshot on open and hold Model/Effort/YOLO

**Size:** S · **Security-sensitive:** No · Split A (data path) of #181; sibling #188 (render) is blocked by this.

## Files to read first

- `src/shared/ipc/commands.ts:39-42` — `RendererCommand` union; the `{ type: 'requestSnapshot'; payload: RequestSnapshotPayload }` member this ticket sends. Confirm the exact literal shape (no constructor exists — inline a typed literal).
- `src/shared/ipc/events.ts:49-59` — `DaemonEvent` union; the `{ type: 'snapshotReceived'; model: string; effort: string; yolo: boolean }` member this ticket consumes. Fields are plain `string`/`boolean`, so empty/`false` are held verbatim by construction.
- `src/renderer/src/screens/conversation/LogDataSection.tsx` — the #72 direct-precedent: a sheet-body container that subscribes `window.pyry.onDaemonEvent` in a mount `useEffect` (returns the off handle as cleanup) and derefs `window.pyry` only inside effects/handlers. Copy this discipline. Note: #72 fires its command from a **click**, not mount — so it is *not* a precedent for the mount-fired request (see § StrictMode).
- `src/renderer/src/screens/conversation/logDataDownload.ts:87-98` — `toDownloadAction`: the pure `DaemonEvent → action | null` filter idiom (`default: null`, not `assertNever`, because ignoring the rest is permanent intent). `toRunConfigSnapshot` mirrors this exactly.
- `src/renderer/src/screens/conversation/composerSend.ts:16` — `MILESTONE_CONVERSATION_ID = 'default'`; the single conversation id to request with. Import it (single source of truth). Also read `submitMessage` (`:38-68`) for the framework-free-helper-with-injected-effects idiom.
- `src/renderer/src/store/sessionStore.ts:139-172` — the store module shape to mirror: `createSessionStore()` DI factory → app singleton `sessionStore` → `useSessionStore(selector)` binding → read-only selectors, `dispatch` as the sole mutation. `runConfigStore` copies this structure (with a single setter, not a reducer — see § Design).
- `src/renderer/src/store/daemonEventBridge.ts:71-80` — the StrictMode-safe subscription idiom: `useEffect(() => onDaemonEvent(...), [])` returning the off handle nets exactly one live listener across a StrictMode double-mount.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:39-56` — the sheet is conditionally mounted (`{sheetOpen && (<StatusSheet>…</StatusSheet>)}`); the sheet body's children mount on open, unmount on close. This ticket adds `<RunConfigData />` as a child here.
- `src/renderer/src/App.tsx:46-63` — the accepted StrictMode posture for a mount-fired side effect: `pairingStatus()` is *allowed* to fire twice under StrictMode; only the **result application** is guarded (`active` flag). Context for the request-firing decision below.
- `src/renderer/src/screens/conversation/LogDataSection.test.tsx` — the test idiom: `renderToStaticMarkup` (no jsdom/Testing Library); pure logic proven as plain functions, containers proven only for "server-renders without touching `window.pyry`."

## Context

The Run configuration sheet shell (#177, PR #184) opens over the conversation. The transport (#180, PR #185) already exposes both ends of the data path on the existing generic preload bridges: outbound `window.pyry.sendCommand({ type: 'requestSnapshot', payload: { conversation_id } })`, and inbound `window.pyry.onDaemonEvent(...)` delivering `{ type: 'snapshotReceived', model, effort, yolo }`. `snapshotReceived` is deliberately *not* a `SessionAction`: `translateDaemonEvent` maps it to `null` (`daemonEventBridge.ts:53-57`), reserving it for "the Run configuration render bridge, not the session store." **This ticket introduces that consumer** — the renderer half that (a) requests a fresh snapshot when the sheet opens, and (b) holds the arriving `model`/`effort`/`yolo` in a unidirectional renderer store. It delivers **no visible surface**; #188 renders the held values into three sections.

## Design source

N/A — this ticket delivers no visible surface (a headless data-path component that renders `null`). The Run configuration sections' visual design lands in #188, which carries the Figma refs.

## Design

Three new renderer modules plus a one-line mount in `ConversationScreen`. The split mirrors the established store-vs-logic-vs-container separation (`sessionStore.ts` / `composerSend.ts` / `Composer`), so #188 imports only the store's read surface.

### 1. `src/renderer/src/store/runConfigStore.ts` — the unidirectional hold (new)

A dedicated Zustand vanilla store (a separate consumer, per #180's landed comments — *not* a session-store facet). It mirrors `sessionStore.ts`'s DI-factory → singleton → hook → selectors structure, but with a **single setter** rather than a reducer: there is exactly one mutation ("record the latest snapshot"), so a discriminated-union action set would be a one-member union — ceremony without benefit. Unidirectional is preserved: read-only selectors, one write path, and `setSnapshot` is invoked *only* by the subscription wiring (§2), never two-way-bound from a component.

Contract (types + signatures only):

```ts
export interface RunConfigSnapshot { model: string; effort: string; yolo: boolean }
export interface RunConfigState { snapshot: RunConfigSnapshot | null } // null = none received yet
export type RunConfigStore = RunConfigState & { setSnapshot: (s: RunConfigSnapshot) => void }

export const initialRunConfigState: RunConfigState = { snapshot: null }
export function createRunConfigStore(init?: RunConfigState): /* StoreApi<RunConfigStore> */ // DI, isolated per test
export const runConfigStore // app singleton = createRunConfigStore()
export function useRunConfigStore<T>(selector: (s: RunConfigStore) => T): T // useStore(runConfigStore, selector)
export const selectSnapshot: (s: RunConfigState) => RunConfigSnapshot | null
```

- `snapshot: null` is the distinct "not yet loaded" state; `{ model: '', effort: '', yolo: false }` is a *received* snapshot of inherited-defaults/permissions-enforced. #188 distinguishes the two.
- `setSnapshot` replaces the whole `snapshot` object unconditionally (AC4 "most recent snapshot wins" — no merge, no dedupe).
- No selector or setter coerces or validates the fields — the daemon's values are stored as-is (AC5).

### 2. `src/renderer/src/screens/conversation/runConfigSnapshot.ts` — the data path (new)

Framework-free, effects injected (the `composerSend` / `logDataDownload` idiom), so the whole path is unit-testable with plain spies — no React, no store, no Electron. Three exports:

```ts
// translateDaemonEvent/toDownloadAction analogue: snapshotReceived → the three fields (explicit
// copy, no coercion — AC5); every other DaemonEvent → null (default: null, permanent intent).
export function toRunConfigSnapshot(event: DaemonEvent): RunConfigSnapshot | null

// AC1: fire exactly one requestSnapshot for MILESTONE_CONVERSATION_ID. The command is an inline
// literal typed as RendererCommand (no constructor added — keeps the change renderer-contained,
// per the ticket's "no main-process or IPC change here").
export function requestRunConfigSnapshot(sendCommand: (c: RendererCommand) => void): void

// AC3/4/5: subscribe via the injected onDaemonEvent; each snapshotReceived writes verbatim into the
// store via setSnapshot; returns the unsubscribe handle (the daemonEventBridge off-handle idiom).
export function subscribeRunConfig(
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void,
  setSnapshot: (s: RunConfigSnapshot) => void
): () => void
```

- Import `MILESTONE_CONVERSATION_ID` from `./composerSend` (single source of truth; the one place a future conversation-selection ticket replaces).
- `toRunConfigSnapshot` copies fields explicitly (`{ model: event.model, effort: event.effort, yolo: event.yolo }`), matching the `daemonEventBridge` `failed` arm's explicit-copy discipline — the store shape stays immune to `DaemonEvent` gaining an unrelated field later.
- `subscribeRunConfig`'s listener body is: `const s = toRunConfigSnapshot(event); if (s) setSnapshot(s)` — the exact `LogDataSection` mount-effect shape.

### 3. `src/renderer/src/screens/conversation/RunConfigData.tsx` — the React binding (new)

A **headless** container (`function RunConfigData(): null`) mounted inside the open-only sheet body. It owns the two lifecycle effects and renders nothing (no visible surface). `window.pyry` is dereferenced only inside effects, never during render (the `Composer.handleSubmit` / `LogDataSection` discipline), so it server-renders to `''` without a bridge mock.

Two mount concerns, each with its own StrictMode-correct idiom (see § StrictMode & concurrency):

- **Subscription** — `subscribeRunConfig(window.pyry.onDaemonEvent, (s) => runConfigStore.getState().setSnapshot(s))` in a mount `useEffect([])`, returning the off handle as cleanup → nets one live listener across a StrictMode double-mount.
- **Request** — `requestRunConfigSnapshot(window.pyry.sendCommand)` once per open. Because the effect has no symmetric "un-request" cleanup, guard it with a `useRef(false)` one-shot flag so the StrictMode dev double-invoke fires the request exactly once (AC2). A genuine close→reopen is a *new* component instance with a fresh ref, so it re-requests — exactly one per open.

The developer may implement these as one effect or two; the contract is: **exactly one request per open (incl. StrictMode), one live listener, renders `null`.**

### 4. `src/renderer/src/screens/conversation/ConversationScreen.tsx` — mount point (modify)

Add `<RunConfigData />` as a child of `<StatusSheet>` (`:48-52`), above `<LogDataSection />`. It renders nothing, so DOM order is immaterial; placing it first keeps the future visible sections (#188) between it and Log data. One import + one JSX line — no other change. Because it lives inside `{sheetOpen && …}`, it is unmounted while the sheet is closed (AC2 "none while closed" is structural).

## State + concurrency model

- **Store slice:** one new singleton `runConfigStore` holding `snapshot: RunConfigSnapshot | null`. Orthogonal to `sessionStore` — a snapshot never touches connection/messages state and vice versa. #188 selects `selectSnapshot`; a snapshot arrival re-renders only components selecting that slice.
- **Request timing:** the request is tied to the sheet **open** (component mount), not to render. `useEffect([])` guarantees no refire on re-render (arriving snapshot, unrelated re-render) — AC2.
- **Subscription lifetime:** scoped to the open sheet (mounts on open, off-handle cleanup on close). Sufficient because `snapshotReceived` is request/response — it only arrives while a request is outstanding (sheet open). A response landing after an instant close is simply dropped (no listener); the store keeps its prior value and the next open re-requests. No app-level always-on listener needed.
- **StrictMode:** subscription uses the symmetric off-handle idiom (`daemonEventBridge`) → one live listener. The request uses a `useRef` one-shot guard → one request per open even under the dev double-invoke. (Refs persist across StrictMode's simulated unmount/remount on the same fiber, so the guard holds; a real reopen is a new fiber → new ref → re-request.) This is stricter than `App.tsx`'s "accept the double-invoke, guard the result" posture — chosen because AC2 states "exactly one" explicitly and the guard is ~3 lines; a double-`requestSnapshot` would be harmless (idempotent, last-write-wins) but the guard makes dev match the AC's letter.

## Error handling

- **No new failure modes.** The request is fire-and-forget (`sendCommand` is `void`, like the composer's); a bridge failure is swallowed upstream — no result to await, no error surface here.
- **Unrelated / malformed events:** `toRunConfigSnapshot` returns `null` for every non-`snapshotReceived` event, so the listener no-ops. It never throws into React (dispatch-only listener, per the `daemonEventBridge` idiom).
- **Empty/default values are not errors:** empty `model`, empty `effort`, `yolo: false` flow through verbatim — no coercion, no validation, no dropped event (AC5, satisfied by construction: the fields are plain `string`/`boolean` and the copy is unconditional).
- **Security:** pure renderer — no transport, keys, or sockets. The untrusted renderer→main boundary guard (`isRequestSnapshotPayload` in `commands.ts:90-93`) already landed with #180. Not `security-sensitive`.

## Testing strategy

Follow the server-render-only idiom (`renderToStaticMarkup`, no jsdom). All behavior is proven at the framework-free layer; the React binding is proven only for "renders nothing / doesn't touch the bridge."

**`runConfigStore.test.ts`** (plain function tests via `createRunConfigStore()` isolated instances):
- Initial state is `{ snapshot: null }`; `selectSnapshot` returns `null` before any set.
- `setSnapshot({ model: 'claude-x', effort: 'high', yolo: true })` → `selectSnapshot` returns it (AC3).
- A second `setSnapshot(...)` replaces the first — the store reflects the most recent (AC4).
- `setSnapshot({ model: '', effort: '', yolo: false })` → held verbatim; `selectSnapshot` returns `{ model: '', effort: '', yolo: false }`, *not* `null` and *not* coerced (AC5).

**`runConfigSnapshot.test.ts`** (plain function tests, injected spies):
- `toRunConfigSnapshot({ type: 'snapshotReceived', model, effort, yolo })` → the three fields verbatim, including empty strings and `yolo: false` (AC5).
- `toRunConfigSnapshot` for a sample of other `DaemonEvent` members (`connected`, `messageReceived`, `debugBundleSaved`) → `null` (the filter ignores unrelated events).
- `requestRunConfigSnapshot(fakeSend)` → `fakeSend` called **exactly once** with `{ type: 'requestSnapshot', payload: { conversation_id: 'default' } }` (AC1; the "exactly one per open" invariant — one call per open).
- `subscribeRunConfig(fakeOnDaemonEvent, fakeSet)` → subscribes once; driving the captured listener with a `snapshotReceived` calls `fakeSet` with the verbatim fields; driving it with an unrelated event does **not** call `fakeSet`; calling the returned cleanup invokes the off handle from `fakeOnDaemonEvent`.

**`RunConfigData.test.tsx`** (server-render container sanity, mirrors the `LogDataSection` container test):
- `renderToStaticMarkup(<RunConfigData />)` does not throw and produces empty markup (renders `null`), proving `window.pyry` is never dereferenced during render.

Coverage note: AC2's "none on re-render" and "none while closed" are React-lifecycle properties argued from the binding (`useEffect([])` deps + the conditionally-mounted sheet body), consistent with the pipeline's server-render-only convention — not exercised via jsdom. `requestRunConfigSnapshot`'s one-call-one-command test proves the per-open cardinality; the ref guard proves it holds under StrictMode.

Type coverage (`npm run typecheck`): `RunConfigSnapshot`'s fields align with the `snapshotReceived` member; the inline request literal type-checks against `RendererCommand`.

## Open questions

- **`requestSnapshotCommand` constructor?** `commands.ts` has `sendMessageCommand` but no requestSnapshot constructor. This spec inlines a typed literal to keep the change renderer-contained and at 4 production files (adding a shared-file constructor would touch `commands.ts` and trip the 5-file gate for a one-line nicety). If a later ticket needs the request from multiple sites, promote it to a constructor then. Recommendation: inline now.
- **Reset on close?** No AC requires clearing the store when the sheet closes; the store keeps the last snapshot so #188 can show last-known values immediately on reopen, then refresh. Left as hold-forever; revisit only if #188 surfaces a stale-value concern.
