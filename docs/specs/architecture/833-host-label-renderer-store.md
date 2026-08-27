# Spec #833 — A host-label store and one-shot loader for the window

The renderer half of the host-label read path: the store the window subscribes to, and the one-shot
loader that fills it from `window.pyry.hostLabel()`. Ships **dormant** — no screen mounts it here.

## Design source

N/A — this ticket ships **no rendered output**. `HostLabelData` renders `null`, nothing is mounted
into a screen tree, and the diff touches no component that draws. The sidebar host row that displays
the label — and the copy for an empty or absent one — is
[#834](https://github.com/pyrycode/pyrycode-desktop/issues/834), which carries the Figma anchor.
Code-review's visual-fidelity check is intentionally skipped for this ticket.

## Files to read first

Codegraph is **not indexed for this repo** (`codegraph_status` → "CodeGraph not initialized"), so this
list was built by grep + Read rather than `codegraph_context`. Read these before writing anything.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/serverInfoStore.ts:16-64` | **The store template.** DI factory → singleton → hook → selector, single setter (not a reducer), and the "one mutation ⇒ no action union" argument. Copy the structure. |
| `src/renderer/src/store/serverInfoLoader.ts:9-69` | **The loader template.** Pure map + injected React-free `load` + headless binding that dereferences `window.pyry` only inside its effect. Every layer of this ticket mirrors it. |
| `src/renderer/src/store/serverInfoStore.test.ts:1-79` | The plain-function, isolated-`createStore()`-per-test idiom. The new store test follows it beat for beat. |
| `src/renderer/src/store/serverInfoLoader.test.ts:1-96` | The pure-map + injected-spy + seam + server-render test layout. |
| `src/shared/ipc/hostLabel.ts:22-64` | **The contract this ticket consumes.** `HostLabelResult`'s three arms and, in the doc comment, exactly why `error` must not collapse into `not-stored` and why `''` is a stored label. |
| `src/renderer/src/store/newFolderStore.ts:12-19,23-31` | **Why the union is nested under a store field, not intersected flat** — `created` carries `path` and the others do not, so a flat shape leaks a stale key through zustand's shallow-merge `set`. The identical hazard applies to `label` here. |
| `src/preload/index.ts:103-113` | The bridge signature: `hostLabel: () => Promise<HostLabelResult>`, an arrow closing over `ipcRenderer` (so passing the bare reference needs no `this` binding). `PyryApi = typeof api` already types `window.pyry.hostLabel` — no `index.d.ts` edit. |
| `src/renderer/src/screens/conversation/RunConfigData.tsx:19-40` | The alternative one-shot guard (a `useRef` flag). Read it to understand why this spec picks the `active`-flag idiom instead — see § The one-shot guard. |
| `docs/knowledge/features/host-label-channel.md` | The predecessor's package overview: the three arms, the verbatim-label rule, and § Edge cases (the label outliving an unpair; over-length collapsing into `error`). |
| `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md` | The rule this store must not undo: an unreadable record is never masked as never-stored. |
| `CLAUDE.md` § Conventions, § "Renderer tests are static server renders" | Test-first; no DOM, no `@testing-library`, nothing in this repo can click. |

## Context

The operator types a name for the machine at pairing time ([#823](https://github.com/pyrycode/pyrycode-desktop/issues/823)),
it persists at rest in the background process ([#822](https://github.com/pyrycode/pyrycode-desktop/issues/822)),
and [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) shipped the read half as
`window.pyry.hostLabel()` — a sealed three-arm result with **no caller**. This ticket adds the caller:
renderer state plus the data path that fills it. The sidebar host row that renders it is #834.

The split mirrors `serverInfoStore` + `serverInfoLoader` (#340, dormant) followed by the Settings row
that consumed them (#334): the store is unit-testable on its own, and the consuming screen gets a value
to render rather than a data path to invent.

The load-bearing constraint is the arm count. `ServerInfo` deliberately collapses not-paired and
unreadable into one arm; `HostLabelResult` deliberately does not, because ADR 0005 forbids masking an
unreadable record as never-stored. `src/shared/ipc/hostLabel.ts:33-42` calls the IPC boundary *"the last
place that distinction could be thrown away."* After this ticket the store is. It must carry three
distinct outcomes into renderer state, plus a fourth pre-settle state, without flattening any of them.

## Design

Two new modules under `src/renderer/src/store/`, mirroring the server-info pair file-for-file:

| Piece | File | Layer |
|---|---|---|
| `HostLabelValue` + store factory / singleton / hook / selector | `src/renderer/src/store/hostLabelStore.ts` (new) | pure renderer state |
| `mapHostLabel` / `loadHostLabel` / `startHostLabelLoad` / `HostLabelData` | `src/renderer/src/store/hostLabelLoader.ts` (new) | data path |

Nothing else is modified. No screen, no `App.tsx`, no preload, no main. The diff is two production files
and their two test files.

### The held value — four arms, nested under one field

```ts
export type HostLabelValue =
  | { status: 'loading' }                  // pre-settle; the one-shot has not landed yet
  | { status: 'stored'; label: string }    // a label was read — '' IS a stored label
  | { status: 'not-stored' }               // never stored; the ONLY absence path
  | { status: 'error' }                    // unreadable: over-length, malformed, decrypt failure, or a rejected invoke

export interface HostLabelState { hostLabel: HostLabelValue }
```

Four arms, not three. `HostLabelResult`'s three cannot represent "the query has not resolved yet," and
that state must be distinct from all three: reusing `not-stored` would make the row claim absence during
the round trip, and reusing `error` would flash a recovery affordance before anything failed. `loading`
is the created-in state and the loader leaves it exactly once; nothing ever returns to it.

**The union is nested under `hostLabel`, never intersected flat into the store object.** This is the one
structural decision that can silently break AC2. `stored` carries `label`; the other three arms do not.
Zustand's `set` shallow-merges at the top level of the store object, so a flat
`{ status, label?, setHostLabel }` shape would leave a stale `label` key behind on a
`stored → not-stored` transition — an absent label rendering as the previous host's name. Nesting swaps
the whole union object wholesale, so no key survives a transition. This is `newFolderStore.ts:12-19`'s
documented reason, and `serverInfoStore` nests for the same reason. A test asserts the transition leaves
no `label` key.

### The store — single setter, not a reducer

Same surface as `serverInfoStore`, with `HostLabelValue` in place of `ServerInfoValue | null`:

- `createHostLabelStore(init?: HostLabelState)` — DI factory over `zustand/vanilla`'s `createStore`, one
  isolated instance per test.
- `initialHostLabelState: HostLabelState = { hostLabel: { status: 'loading' } }`
- `hostLabelStore` — the app-wide singleton the loader writes and #834 reads.
- `useHostLabelStore<T>(selector)` — narrow-slice React binding.
- `selectHostLabel(s: HostLabelState): HostLabelValue` — the only read surface.
- `setHostLabel(value: HostLabelValue): void` — replaces the whole nested value unconditionally. The sole
  mutation path, invoked only by the loader wiring, never two-way-bound from a component.

A single setter rather than a reducer, for `serverInfoStore.ts:12-15`'s reason verbatim: there is exactly
one mutation ("record what the loader mapped"), so a sealed action union would be a one-member union —
ceremony without benefit. The *value* is a discriminated union; the *mutation* is not.

The setter accepts `loading` as a type (it is a member of `HostLabelValue`), but nothing writes it — the
map never produces it. That is a deliberate non-restriction: a narrower setter parameter would need a
second type for no gain, and `loading` is not a dangerous value to be able to write.

### The map — three arms in, three arms out, ADR 0005 safe by construction

```ts
export function mapHostLabel(res: HostLabelResult): HostLabelValue
```

The pure collapse, React-free and unit-testable without a DOM — the `mapServerInfo` analog. Behaviour:

- `stored` → a **fresh** `{ status: 'stored', label: res.label }` literal. Reconstructed, not passed
  through, so nothing the union did not declare can ride an IPC payload into renderer state and out into
  #834's render. Same argument as `mapServerInfo`'s "a FRESH literal, NOT a pass-through."
- `not-stored` → a fresh `{ status: 'not-stored' }`.
- everything else → `{ status: 'error' }`.

Write it as **two positive tests followed by an unconditional `return { status: 'error' }`** — not a
`switch` with a `not-stored` default and not an exhaustiveness `assertNever`. The shape matters: it means
there is no code path in the module from an unrecognised value to `not-stored`. A structurally-invalid
response (a future arm, a buggy handler, a hostile `ipcRenderer.invoke` result) degrades to the
conservative outcome, and ADR 0005's rule holds by construction rather than by a branch someone has to
keep correct. A test drives an unrecognised `status` through a cast and asserts `error`.

**`label` is held verbatim.** No trim, no coercion, no re-application of `MAX_HOST_LABEL_LENGTH`, no
escaping, no empty-to-null normalisation. #824 already bounded and classified it main-side
(`hostLabelHandler` rejects over-length whole, into `error`) and returns the string untouched; re-checking
here would either duplicate a bound that can drift or, worse, invent an absence. `''` maps to
`{ status: 'stored', label: '' }` and is therefore distinct from both `not-stored` and `error` — AC2's
third clause, and the distinction #822/#823/#824 each paid to keep alive.

**What the screen shows for an empty or absent label is not decided here.** Land the value; don't pick
the copy. Escaping at render is React's default and is #834's concern under CLAUDE.md's
no-raw-markup-sink rule.

### The load — always resolves, never `not-stored` on failure

```ts
export function loadHostLabel(
  invoke: () => Promise<HostLabelResult>,
  setHostLabel: (value: HostLabelValue) => void
): Promise<void>
```

The injected, React-free load surface a unit test drives with a plain spy — the `loadServerInfo` analog.
It resolves `invoke()`, writes `mapHostLabel(res)`, and on a rejection writes `{ status: 'error' }`. The
returned promise **always resolves**; it never rejects into the caller, so a late-arriving handler failure
cannot surface as an unhandled rejection in React (AC3). Assumes `invoke` returns a promise and does not
throw synchronously — the `ipcRenderer.invoke` contract.

A rejected invoke means the handler is absent or the main process died mid-query. That is "the stored
label could not be read," which is `error` — never `not-stored`. Mapping it to `not-stored` would invent
an absence out of a transport failure, exactly the masking ADR 0005 forbids. A test asserts the written
value is `error` and explicitly not `not-stored`.

### The one-shot guard — extracted so AC4 is proven, not asserted

```ts
export function startHostLabelLoad(
  invoke: () => Promise<HostLabelResult>,
  setHostLabel: (value: HostLabelValue) => void
): () => void        // the cleanup: cancels the pending write
```

Five lines: raise an `active` flag, kick off `loadHostLabel` with a write wrapped in `if (active)`, return
a cleanup that lowers the flag. `HostLabelData`'s effect body becomes a single expression that returns it.

**Why extract it rather than inline the flag as `ServerInfoData` does.** AC4 is a written acceptance
criterion — "a React StrictMode double-mount applies exactly one write" — and every sibling bridge in this
repo settles the equivalent claim in a comment ("effect timing is verified by inspection", e.g.
`serverInfoLoader.test.ts:88`, `queueBridge.test.ts:246`). That is fine for a subscription bridge, where
the guarantee is structural: the off-handle *is* the cleanup, so it cannot be wrong. Here the guarantee is
about a **write**, which is a real conditional someone can get backwards. Pulling the flag into a
React-free function costs ~8 production lines and makes StrictMode's exact sequence — effect, cleanup,
effect — a deterministic three-call test with no DOM. Cheaper than the failure it prevents, and it does
not fight this repo's `environment: 'node'` constraint; it sidesteps it. This is the **only** place the
design departs from the server-info template beyond arm count; the layering is otherwise identical.

**Why the `active`-flag idiom and not `RunConfigData`'s `useRef` guard.** Both satisfy AC4. The ref
version also spares one redundant IPC round trip under StrictMode, but it lives inside the component and
cannot be tested without a DOM, and this query is cheap by construction — `host-label-channel.md`
§ Edge cases: *"Repeated invokes are cheap — each is an independent local `store.load()`, no
amplification, no state mutation, no secret returned."* Testability wins; the ticket's own Technical Notes
point the same way ("exercise the store through the React-free load function… not through a rendered
component").

Note the guarantee precisely, and document it in the module comment: under StrictMode the **invoke** runs
twice and exactly one **write** is applied — the first mount's cleanup lowers its flag, so its
late-resolving write is dropped and the second mount's lands. Do not try to dedupe the invoke with a
module-level flag: that would also block the re-read on a genuine remount, which is the whole point of
mounting the binding per screen rather than once at launch.

### The binding — headless, dormant

```ts
export function HostLabelData(): null
```

A headless leaf that renders `null`. Its effect is `useEffect(() => startHostLabelLoad(window.pyry.hostLabel,
(v) => hostLabelStore.getState().setHostLabel(v)), [])` — empty deps, the returned cancel as cleanup.
`window.pyry` is dereferenced **only inside the effect**, never during render, so it server-renders to
`''` without a bridge mock (the `ServerInfoData` / `LogDataSection` discipline). `window.pyry.hostLabel`
is passed as a bare reference: the preload API is an arrow closing over `ipcRenderer`, so there is no
`this` to bind.

**Ships dormant.** Nothing mounts it in this ticket — not `App.tsx`, not any screen. Where it mounts is
#834's call, and the `serverInfoLoader.ts:44-49` argument transfers: an app-level one-shot at launch runs
before pairing and never re-runs, leaving the row stale after a same-session pair, so mounting it inside
the paired-only tree that renders the row gives a fresh read per open. Recording that here as guidance,
not deciding it.

## State + concurrency model

- **One store slice, one writer.** `hostLabelStore` holds `{ hostLabel }`. The only write path is
  `setHostLabel`, called only from `HostLabelData`'s effect. Unidirectional: components read through
  `useHostLabelStore(selectHostLabel)` and never write.
- **No subscription.** This is a one-shot `invoke`, not a daemon event stream — there is no
  `onDaemonEvent` handle, no unsubscribe, no last-write-wins ordering concern. Cancellation is the
  `active` flag alone.
- **Lifecycle.** Mount → invoke → (map | catch) → at most one write → unmount lowers the flag. A write
  that resolves after unmount is dropped. Nothing outlives the window: no timer, no interval, no listener,
  no `AbortController` (there is nothing abortable behind `ipcRenderer.invoke`).
- **Re-render seam.** Each write swaps the whole nested `hostLabel` object, so `selectHostLabel` yields a
  new identity and only components selecting that slice re-render. One write per mount, so the fresh-object
  identity costs nothing.
- **No cross-store coupling.** The label is at-rest state, independent of session, timeline, run config
  and paired-server state. It is deliberately *not* a `serverInfoStore` facet — different channel,
  different cardinality, different lifetime.

## Error handling

| Failure | Where classified | Value landed | UI surface |
|---|---|---|---|
| `load()` threw main-side (malformed, decrypt failure, keychain rotation) | #824's handler | `{ status: 'error' }` | none here — #834 |
| Stored label exceeds `MAX_HOST_LABEL_LENGTH` | #824's handler (rejected whole, never truncated) | `{ status: 'error' }` | none here — #834 |
| Never stored | #824's handler, from a strict `null` | `{ status: 'not-stored' }` | none here — #834 |
| Stored empty label (`''`) | #824's handler, verbatim | `{ status: 'stored', label: '' }` | none here — #834 |
| `invoke` rejects (handler absent, main died mid-query) | `loadHostLabel`'s `catch` | `{ status: 'error' }` | none here — #834 |
| Unrecognised `status` on the response | `mapHostLabel`'s final `return` | `{ status: 'error' }` | none here — #834 |

No banner, no dialog, no toast, no `console.*` on any branch. This ticket lands a value and stops; every
failure mode converges on `error`, and none converges on `not-stored`. The caught error object is dropped
unread — never logged, interpolated, or stored — matching the handler's classify-don't-forward discipline
one layer down.

## Testing strategy

Test-first. Two new spec files, `npm test` (vitest, `environment: 'node'`) plus `npm run typecheck`.
**Everything is exercised through the React-free functions and the selector, never through a rendered
component with a seeded store** — a zustand singleton seeded before `renderToStaticMarkup` is invisible to
it (the server snapshot is the state captured at store creation), so a seed-then-render assertion would
pass against the initial cell and prove nothing.

### `hostLabelStore.test.ts` — plain functions over isolated `createHostLabelStore()` instances

- Starts at `{ status: 'loading' }`; `selectHostLabel` returns it.
- `setHostLabel({ status: 'stored', label: 'pyrybox' })` → the selector returns exactly that.
- **`{ status: 'stored', label: '' }` is held as a stored label** — deep-equal to
  `{ status: 'stored', label: '' }`, and deep-**un**equal to both `{ status: 'not-stored' }` and
  `{ status: 'error' }`. (AC2, the empty-label clause.)
- The three settled arms are mutually distinct: assert each held value against the other two. (AC2.)
- **`stored → not-stored` leaves no `label` key** on the held value — the stale-key leak the nesting
  prevents. Same again for `stored → error`.
- Two `createHostLabelStore()` instances stay independent (DI).
- Starts from an injected initial state (DI).
- `initialHostLabelState` deep-equals `{ hostLabel: { status: 'loading' } }`.
- `setHostLabel`'s reference is stable across updates.

### `hostLabelLoader.test.ts` — pure map, injected spies, one seam, one server render

- `mapHostLabel` on each of the three response arms returns the matching value; the `stored` result is a
  **fresh object** (`not.toBe(res)`) carrying only `status` and `label`.
- `mapHostLabel` never returns `loading` for any response.
- `mapHostLabel` on an unrecognised `status` (cast through `as unknown as HostLabelResult`) returns
  `{ status: 'error' }`, and specifically **not** `{ status: 'not-stored' }`. (ADR 0005.)
- `loadHostLabel` writes **exactly once** for each of the three arms, with the mapped value. (AC1, AC2.)
- `loadHostLabel` on a rejected invoke: the returned promise `resolves.toBeUndefined()`, exactly one write
  lands, its value is `{ status: 'error' }` and is asserted **not** to be `{ status: 'not-stored' }`. (AC3.)
- **Seam:** a real `createHostLabelStore()` driven from `loading` to a held `stored` value through the real
  `setHostLabel`, read back through `selectHostLabel`. (AC1.)
- **AC4, StrictMode:** two test-controlled deferred promises fed to `invoke` via `mockReturnValueOnce`
  twice. Sequence: `const cancel = startHostLabelLoad(...)` (mount 1) → `cancel()` (StrictMode cleanup) →
  `startHostLabelLoad(...)` (mount 2). Resolve mount 1's deferred with a **`stored`** response and mount 2's
  with a **`not-stored`** response, then flush. Assert the setter was called **exactly once** *and* that it
  carries mount 2's value — the differing arms prove the first mount's write was dropped rather than that
  the count coincidentally landed on one.
- `startHostLabelLoad`'s cancel suppresses the write from the other side too: cancel **before** resolving,
  flush, assert **zero** writes.
- `HostLabelData` server-renders to `''` and does not throw, with no `window.pyry` mock present.

**Flushing, no fake timers.** After resolving the deferreds, `await` each deferred's promise and then one
further `await Promise.resolve()` before asserting, so the `.then` continuation inside `loadHostLabel` has
run. Deterministic; do not reach for `vi.useFakeTimers` — there are no timers on this path.

## Open questions

- **Where #834 mounts `HostLabelData`.** Deliberately left open; the guidance above (paired-only tree, not
  app-level-at-launch) is the recommendation, not a constraint this ticket imposes.
- **Naming the pre-settle arm `loading`.** Honest while the binding is mounted, mildly inaccurate while the
  store is dormant and nothing is in flight. `unknown` would be the more literal name. `loading` is chosen
  because it reads correctly at the consumer's call site, which is the only place it is ever observed. If
  #834 finds it misleading, renaming a single string literal is a one-line follow-up.
- **The label outlives an unpair.** `host-label-channel.md` § Edge cases: unpair clears only
  `pairedServerStore`, so this store will faithfully hold the previous host's label until
  [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827) closes that gap. Out of scope here —
  the store reports what the channel reports.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The one boundary crossed is `window.pyry.hostLabel()` — main → renderer,
  which is the *trusted → untrusted* direction; nothing untrusted flows the other way, because the invoke
  carries **zero arguments** (`src/preload/index.ts:113`), so this ticket adds no renderer-controlled input to
  the main process at all. The inbound response is narrowed at exactly one place, `mapHostLabel`, which
  reconstructs fresh literals rather than passing the IPC object through — so an extra property riding a
  malformed payload cannot enter renderer state. The discriminated union is the type-system signal that
  downstream code is holding a classified, not a raw, value.
- **[Tokens, secrets, credentials]** No findings, structurally. The response union's only field is `label`
  (`src/shared/ipc/hostLabel.ts:61-64`) — `token`, `server_static_pubkey`, keychain paths and error messages are
  absent *by construction* one layer down, so there is nothing for this store to hold that could be a secret.
  This ticket adds no storage of its own: the value lives in memory in a zustand cell and is never written to
  `localStorage`, `sessionStorage`, IndexedDB, or disk. **This is a MUST-NOT for #834 too** — an operator-typed
  machine name is low-sensitivity but is still user data, and there is no reason for it to reach web storage
  when the authoritative copy is already in `safeStorage` main-side.
- **[File / storage operations]** N/A by design decision, not by omission: this ticket performs no filesystem
  access. `label` is display text and the spec forbids its use as a path, a filename, a cache key or a lookup
  index — it never leaves the store except to be rendered. Worth stating because a host label is exactly the
  kind of string that later gets "helpfully" reused as a per-host storage key; when per-server-id keying lands
  (`host-label-store.md` § Edge cases), the key is the server id, never the label.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new `contextBridge` member,
  no `ipcMain.handle`, no `webPreferences` change, no protocol handler, no navigation surface — the whole surface
  was reviewed and shipped by #824. This ticket consumes the existing bridge function and dereferences
  `window.pyry` only inside an effect. `ipcRenderer` still never crosses the bridge.
- **[Cryptographic primitives]** N/A — no randomness, no comparison against a secret, no key material, no
  handshake code on this path. The decrypt that *could* fail happens main-side in `hostLabelStore.load()` and
  reaches here already collapsed to a value-free `error`.
- **[Network & I/O]** N/A — no socket, no frame, no relay URL, no timeout to set. The read is a local IPC round
  trip against at-rest state and is connection-independent by construction (the handler holds no reference to the
  relay connection).
- **[Error messages, logs, telemetry]** No findings, and one deliberate rule: the `catch` in `loadHostLabel`
  drops the caught object **unread** — it is never logged, interpolated into a message, or stored. A rejected
  `ipcRenderer.invoke` rejection message can carry the channel name and main-process detail, and the renderer
  console is readable by anything that can open DevTools. No `console.*` on any branch of either new module.
  The union carries no error-reason field and the spec forbids adding one, matching `hostLabel.ts:48-50`.
- **[Concurrency]** No findings. One `Promise` per mount, no timer, no interval, no listener, nothing that
  outlives the window. `loadHostLabel` always resolves, so no unhandled rejection can escape (AC3). The
  `active`-flag cleanup drops a write that resolves after unmount. There is no check-then-act race: the write is
  an unconditional whole-value replacement, not a read-modify-write across an `await`, so two concurrent loads
  (impossible as specified, but harmless) would produce a last-write-wins settle rather than a torn value.
- **[Threat model alignment]** Three named threats, each addressed:
  - *Hostile/compromised relay* — out of reach. This path never touches the relay; the answer is identical
    whether or not a connection exists.
  - *Renderer compromise reaching the transport* — unchanged. Compromised renderer script could already call
    `window.pyry.hostLabel()` after #824; this ticket adds no capability, only a caller. The reachable prize is
    the operator-typed machine name — no route to the token, the server key, or the socket.
  - *Hostile/buggy main-side response* — addressed. An unrecognised or malformed response degrades to `error`
    via `mapHostLabel`'s unconditional final `return`, so a structurally-invalid payload can never be read as
    "never stored" (ADR 0005), and reconstruction drops any undeclared field before it reaches renderer state.
  - *Untrusted text reaching a raw-markup sink* — **OUT OF SCOPE, named for #834.** `label` is operator-typed
    and passes through this ticket verbatim and unescaped, which is correct here (nothing renders it). #834 must
    render it as escaped text only: no `dangerouslySetInnerHTML`, never into an attribute or a URL, per CLAUDE.md
    (operator ruling 2026-08-20).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
