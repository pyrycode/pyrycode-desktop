# #974 — hold the daemon's published model list per conversation

## Files read

- `src/renderer/src/store/slashCommandListStore.ts` → `createSlashCommandListStore`,
  `selectSlashCommandListFor`, `SlashCommandListEntry`, `initialSlashCommandListState` — the exact
  local precedent (#954). This slice is that store with the row type swapped; the DI-factory →
  singleton → hook → selector structure, the copy-on-write `ReadonlyMap`, and the `?? null` selector
  are copied deliberately.
- `src/renderer/src/store/slashCommandListBridge.ts` → `translateSlashCommandList`,
  `subscribeSlashCommandList`, `SlashCommandListData` — the dedicated-subscriber posture: an injected
  `onDaemonEvent`, a `default: null` filter, the off-handle returned as the effect cleanup.
- `src/renderer/src/store/slashCommandListStore.test.ts` and `slashCommandListBridge.test.ts` — the
  test shapes this slice mirrors, including the identity assertions that defend "no per-row mapping
  exists" and the `connected`-edge pin.
- `src/shared/ipc/events.ts` → the `modelList` arm (#973) and its docblock — the three-positions-on-empty
  rule, the truncation contract, and the SECURITY paragraph this plan's obligations come from. Also
  the four permanent no-op cases this slice must leave alone.
- `src/shared/wire/types.ts` → `WireModelOption`, `ModelListPayload` — the six row fields, the
  `effort_levels` collapse, the `truncated_fields` exemption, the never-parse rule on `value`.
- `src/shared/wire/types.test.ts` → the `model-list wire vocabulary (#971)` block — the measured row
  values (`<unmeasured>`, `opus[1m]`, `claude-fable-5[1m]`, Haiku's empty `effort_levels` and
  `supports_auto_mode: false`) this slice's fixtures are transcribed from rather than invented.
- `src/renderer/src/App.tsx` → the numbered headless-leaf block and its JSX fragment — where the new
  leaf joins and what its comment owes.
- `docs/knowledge/features/slash-command-list-store.md` — the analogue's overview: the store/bridge/App
  split, the data-flow section, and the edge cases the same design inherits.
- `docs/knowledge/features/model-list-wire-types.md` § "Edge cases and limitations" — records that RED
  for the type-only slices was `tsc`, and that `docs/protocol-mobile.md` § `model_list` is stale on the
  delivery window and must not be re-derived from.
- `src/renderer/src/App.test.tsx` — checked for a leaf-count or leaf-name assertion; there is none, so
  the mount adds no test obligation there beyond the existing no-stub `<App/>` neutral-render.

## Design source

**Figma:** N/A — this slice renders nothing. Both production modules are React-free data plumbing plus
one headless leaf that returns `null`; the visual work is #975 (model rows) and #976 (effort segments),
which carry their own Figma anchors. The visual-fidelity check is intentionally skipped.

## Context

The daemon publishes, from a conversation's `initialize` control reply, the models claude will accept
for that conversation. #971 modelled the frame, #972 decoded it fail-closed, #973 carried it to the
window as a typed `modelList` `DaemonEvent` arm. The event reaches the renderer today and nothing
catches it.

Four consumers are waiting: the run-configuration sheet's model rows (#975) and effort segments
(#976), the input footer's model and effort menus (#683), and the permission-mode menu (#682), which
needs each row's `supports_auto_mode`. That is why this is a store rather than a subscription inside
one screen — four surfaces reading one holder instead of four subscribers to the daemon channel.

**Sizing, stated rather than engineered away.** Two lines of the size-S boundary are exceeded and both
were named by the refiner: total written work (~1250 lines, dominated by the two test files) and the
exported-symbol count (six — four types plus a store singleton plus a React leaf — against a limit of
five). The file count (3), the consumer call-site count (1: `App.tsx`), the AC count (5) and the
reject-branch count (0) are all inside their limits. The store and its bridge split cleanly on paper
and badly in practice: a store slice alone ships a container nothing fills, which cannot be verified as
doing its job, and the sizing floor wins over the ceiling. Independently, this ticket is a grandchild
(#974 → #561 → #556), so the split-depth gate forbids splitting it regardless; the ticket carries
`needs-human:sizing` for that reason, exactly as #954 did. Building it as one ticket.

No ADR is warranted: this slice makes no new architectural decision, it applies the settled
`slashCommandListStore` / `announcedModelBridge` posture to one more frame.

## Design

Three production files. Two new modules under `src/renderer/src/store/`, plus the `App.tsx` mount.

### `modelListStore.ts` — the holder

Mirrors `slashCommandListStore` structurally. Contracts:

```ts
interface ModelListEntry { models: readonly WireModelOption[]; droppedModels: number }
interface ModelListSnapshot extends ModelListEntry { conversationId: string }
interface ModelListState { lists: ReadonlyMap<string, ModelListEntry> }
type ModelListStore = ModelListState & { setModelList: (snapshot: ModelListSnapshot) => void }

const initialModelListState: ModelListState          // shared, frozen-by-convention empty map
function createModelListStore(init?: ModelListState) // DI factory — one isolated instance per test
const modelListStore                                 // app-wide singleton
function useModelListStore<T>(selector: (s: ModelListStore) => T): T
const selectModelListFor: (conversationId: string) => (s: ModelListState) => ModelListEntry | null
```

**Rows are held by reference, in the wire's own vocabulary.** The Technical Notes ask this to be
decided once and justified: this frame joins nothing — unlike `backgroundTaskRosterStore`, which holds
a renderer type because it joins three sources — so there is no renderer vocabulary to translate into,
and #972's narrower already rebuilt each row as a fresh six-field literal. Holding the array the frame
carried is what makes AC3 true **by construction**: with no per-row mapping anywhere on the path, a
row's `truncated_fields: null` cannot be collapsed into `[]`, nothing can be hoisted or flattened
across rows, `effort_levels: []` cannot be normalised, and no string can be trimmed or lowercased.
AC3 requires that be defended by a test rather than by construction, so the store spec asserts row and
array **identity** (`toBe`), which is the assertion that reddens the moment someone introduces a
mapping.

**`setModelList` replaces one conversation's entry wholesale and is unconditional.** Copy-on-write:
clone the outer map, set the one key, return a fresh state. Never mutate `s.lists` or an entry in
place — a write for one conversation leaves every other entry object `Object.is`-identical, so a
component watching a different id does not re-render. `models: []` sets the key to an entry holding no
rows; it never deletes the key and is never dropped as "no news". `droppedModels` is taken from the
snapshot unconditionally, including `0`, and nothing recomputes it from `models.length`.

**`selectModelListFor` is the read surface and carries AC1's distinction.** `?? null`, emphatically not
`?? EMPTY_LIST`: an absent key means *no frame has arrived* (UNKNOWN), a present entry holding
`models: []` means *claude offered nothing*. Both would otherwise surface to #682/#683 as a bare empty
list with no type error and no failing test. Three readings:

| map state | selector | meaning |
|---|---|---|
| key absent | `null` | no frame has arrived — UNKNOWN |
| `{ models: [], droppedModels: 0 }` | that entry | claude published an empty list |
| `{ models: [r], droppedModels: 2 }` | that entry | 1 row carried, 3 models in the true list |

The nullable return forces a consumer to branch, so the distinction cannot be ignored accidentally.
`null` is a stable reference by construction, so no module-scope `EMPTY_*` constant is needed. The
selector returns the held entry itself, never a freshly built object.

**No clear, no `connected` branch.** The pairing-scoped clear is #977's and lands in
`clearPairingScopedState`'s injected dep set (the #588 → #593 and #954 → #955 precedent), not here and
not at either `PairedShell` call site. The entry point #977 needs is the store's exported shape — the
DI factory, the singleton and `ModelListStore` — which this slice provides; the `clearAllModelLists`
method itself is #977's to add, exactly as `clearAllSlashCommandLists` was #955's rather than #954's
(verified against `9875ee1` vs `18ce310`). There is no `connected`-edge reset and there must never be
one: a reconnect to the same daemon does not invalidate a published list, and nothing on this path
could re-fetch one.

**Exported symbols and `renderToStaticMarkup`.** Seeding a zustand singleton is invisible to a server
render — the server renderer reads `getServerSnapshot()`, which zustand wires to the state captured at
creation — so #975/#976 will need `vi.mock` on this module with only the `useModelListStore` binding
overridden onto a per-file `createModelListStore()` instance and `...importActual` kept for the
selectors. That is why the DI factory, the hook and the selector are three separate exports rather
than one bundled hook: the export shape is what makes that workaround possible.

### `modelListBridge.ts` — the data path

```ts
function translateModelList(event: DaemonEvent): ModelListSnapshot | null
function subscribeModelList(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setModelList: (snapshot: ModelListSnapshot) => void
): () => void
function ModelListData(): null
```

**A fifth independent subscriber, not a new arm on an existing bridge.** #973's arm docblock already
commits this slice to a dedicated subscriber in the `announcedModelBridge` /
`backgroundTaskRosterBridge` / `slashCommandListBridge` posture. The four exhaustive bridges keep their
permanent `modelList` no-op cases — in `routeDaemonEvent`, `timelineWriteTarget`, `translateModalEvent`
and `translateQuestionEvent` — and **all four stay untouched**. Removing one is a security regression,
not a tidy-up: each `assertNever` guard stringifies the whole event into an `Error`, so a dropped case
would put claude-authored row text into an error message.

`translateModelList` returns a **fresh named-field literal**, never `return event` and never a spread:
a spread would carry the arm's `type` tag, and any field a later arm gains, into a write unit that
never agreed to hold it. `models` passes through by reference. `default: null` — not `assertNever` —
because ignoring the rest is this path's intended permanent behaviour, and because an `assertNever`
here would leak the event's text into an `Error`. `null` means *not our arm*, never *bad data*: a
malformed payload was already rejected upstream by #972's narrower inside `daemonConnection`'s decode
guard, and no event is emitted at all.

The arm it must not pick up by accident is `slashCommandList`, and behind it `backgroundTaskRoster` —
all three carry the identical shape (one conversation id, a row list, a frame-level drop count), so the
filter switches on the **discriminant** and never on field names.

`subscribeModelList` guards on `snapshot !== null`, not on truthiness and emphatically not on
`snapshot.models.length`: a snapshot object is truthy even when empty, and a content guard would drop
an empty list together with its drop count. The listener translates and dispatches; it never throws
into React and it logs nothing.

`ModelListData` is the React glue: one `useEffect` with an empty dep array, returning the off handle as
its cleanup so a StrictMode double-mount nets exactly one live listener. `window.pyry` is dereferenced
only inside the effect, never during render, so it server-renders to `''` without a bridge mock — the
invariant `App.test.tsx`'s no-stub `<App/>` render depends on.

### `App.tsx` — the mount

`ModelListData` joins the headless-leaf fragment as the **eleventh** leaf, after `SlashCommandListData`,
with a numbered comment in the block's existing style. App-level is load-bearing rather than
conventional: the list is published from a conversation's `initialize` reply, so a frame arrives for a
conversation the operator may never have opened and long before any of the four consumers is mounted.
A screen-scoped listener would miss exactly the case the store exists for — which is why AC2 puts the
mount inside this slice rather than leaving it to convention: without it every other criterion still
passes against an injected subscribe function while nothing ever writes the singleton.

## State + concurrency model

One store slice, keyed by `conversationId`, holding one `ModelListEntry` per id. One writer (the
subscription), one read surface (`selectModelListFor`). Unidirectional: no component ever writes back.

No async work at all — no promise, no timer, no `AbortController`, nothing to cancel. The only
long-lived resource is the daemon-event subscription, whose cancellation path is the off handle
returned from `onDaemonEvent`, used directly as the effect cleanup. Teardown on window close is the
same handle.

`set((s) => …)` reads `s.lists` **inside** the updater, so two frames arriving back-to-back cannot
interleave — zustand runs the updater synchronously against current state. Deliberately never
`set({ lists: new Map(modelListStore.getState().lists) })`, which would read outside the updater and
open a check-then-act gap.

Reactive-only. There is no request half and none may be added: the daemon pushes the list unsolicited
(upstream pyrycode#1867 delivers it to a client that connects without sending a message first, which is
exactly what this app does), and delivery is best-effort, so a conversation with no list is a normal,
permanent state rather than something to retry or spin on.

## Error handling

There is no failure mode on this path and no reject branch — the honest statement, not an omission.

- A malformed frame never arrives: #972's narrower throws inside `daemonConnection`'s decode guard and
  no `DaemonEvent` is emitted. A second, weaker check in the renderer would only invent a disagreement
  with the upstream one.
- An unrelated event is not an error; it is `null` from the filter and a no-op.
- A missing list is not an error; it is `null` from the selector, and #975/#976 render their existing
  fallback rather than a spinner.
- Nothing throws, nothing rejects, and **nothing is logged** — see the security review.

## Testing strategy

Vitest only (`environment: 'node'`), two co-located spec files. No Playwright spec: this slice has no
interaction and no render, so there is nothing under `e2e/` to drive. RED comes from the spec files
failing against absent modules, then GREEN.

Fixtures are transcribed from the measured rows in `src/shared/wire/types.test.ts`'s `#971` block
rather than invented, so no test passes on a tidier list than the daemon sends: `<unmeasured>` as a
`resolved_model` (four of five live rows), the bracketed `opus[1m]` and `claude-fable-5[1m]` values,
Haiku's row as the all-real case (`effort_levels: []`, `supports_auto_mode: false`), and a row
reporting `truncated_fields: ['value']`. One hand-authored row carries `truncated_fields: []` so the
`[]`-vs-`null` distinction reddens in both directions.

`modelListStore.test.ts` — scenarios:

- holds one conversation's list, readable through the selector (AC1)
- leaves every other conversation untouched **by reference** (AC1)
- replaces a conversation's list wholesale; nothing merges, the count follows the newest frame (AC1)
- reads `null` for a conversation no frame arrived for **and** an empty entry for one that published
  nothing, in one test so neither assertion passes vacuously (AC1)
- an empty list still carries the frame's own drop count (AC1, AC4)
- holds the rows verbatim — the **same array and the same row objects** (AC3, identity not equality)
- keeps each row's own `truncated_fields`: `null` never collapsed into `[]`, nothing hoisted or
  flattened across rows into a single flag; the entry has no such field (AC3)
- preserves the daemon's published order, asserted on `value` (AC3)
- holds every string field and every `effort_levels` entry untouched, including `<unmeasured>` and the
  bracketed values (AC3)
- holds `droppedModels: 0` as a value, and `models.length + droppedModels` is the reader's arithmetic,
  never the store's (AC4)
- starts empty, copy-on-write, and never mutates the shared `initialModelListState`
- accepts a seeded initial state (the DI factory)

`modelListBridge.test.ts` — scenarios, with plain spies and a fake `onDaemonEvent` (no React, no
Electron; the real store is wired only for the seam tests):

- maps a `modelList` to its snapshot; returns a fresh literal, so `type` never reaches the store, while
  `models` still passes through by reference
- maps an **empty** list to a snapshot, never to `null`
- carries `droppedModels: 0` through
- returns `null` for unrelated events **including its two structural twins**, `slashCommandList` and
  `backgroundTaskRoster`
- subscribes exactly once; returns the off handle as the cleanup
- writes on the owned arm, does not write on an unrelated one
- drives the real store from `null` to the published list, and a newer frame replaces the older (AC2)
- **a `connected` edge neither writes nor clears the store**, asserted `toBe` on the held entry so a
  re-handshake leaves it identical by reference (AC2, pinned specifically per the AC)
- `ModelListData` server-renders to empty markup without touching `window.pyry`

AC5 is a structural criterion — neither production file imports `ipcRenderer`, a key, a socket or a raw
frame type — and is proven by the import blocks plus `npm run build`, not by a runtime test. Both files
import only `zustand`, `react`, and types from `@shared/wire/types` / `@shared/ipc/events`.

## Open questions

1. **Map field name — `lists` vs mirroring the sibling's `menus`.** Resolved in this plan: `lists`,
   since `s.lists.get(id)` reads correctly for a model list and `menus` is the sibling's word for a
   command menu. No revision expected.
2. **Whether to ship `clearAllModelLists` now.** Resolved against, in this plan: the ticket scopes the
   clear to #977, and the #954/#955 split is the verified precedent (the method landed in `18ce310`,
   not `9875ee1`). Shipping it here would add an untested-by-its-own-AC export and a seventh exported
   symbol. If Phase B finds #977 cannot reach the store without it, that is a revision to record here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX (mitigated by construction).** The untrusted → trusted crossing is
  `parseModelListPayload` (#972), inside `daemonConnection`'s decode guard, upstream of this slice —
  explicit and single, not scattered. What this slice receives is an already-typed `DaemonEvent`, and
  it adds no second parse. The real gap: **decoded is not sanitized.** #972 made the *shape* trusted
  and nothing more, and `string` carries no signal, so nothing in the type system tells #975/#976 that
  `display_name` is claude-authored text that crossed the subprocess trust boundary — a *higher* tier
  than `slashCommandList`'s workspace-authored strings. No branded-type infrastructure exists in this
  repo and inventing one here is out of scope. The mitigation carried into Phase B is that **no per-row
  mapping exists anywhere on this path**, so nothing can normalise, trim, lowercase or shape-check a
  string even by accident, pinned by the identity assertions in the store spec. The docblocks on both
  files must state the tier and must not restate it as the sibling's.
- **[Tokens, secrets, credentials] No findings.** The arm's whole payload is one conversation id, a
  bounded list of six-field rows, and a count — no token, key, or raw frame can ride it.
  `conversationId` is an outbound display-scoping key and **not a nonce**: nothing here is unguessable
  and nothing is a secret, so matching it is a plain `Map.get` and specifically not
  `crypto.timingSafeEqual`. Nothing is persisted and nothing may be: `createModelListStore` takes no
  storage port (unlike `createConversationLastReadStore`), and web storage would outlive the pairing
  that scoped the list — a persisted copy would survive #977's clear with every in-memory assertion
  still green.
- **[File / storage operations] No findings, by an explicit design decision.** Nothing here touches the
  filesystem, and no string from a row is ever concatenated into a path, a filename or a cache key.
  The one keyed structure is the outer `Map`, keyed by `conversationId` and by nothing else; **the rows
  stay an array rather than an index built from row text**, so the `__proto__` hazard the arm's
  docblock names (`index[row.display_name] = row` writing through to `Object.prototype`) has no site to
  occur in. If a later slice needs a `display_name` index, the arm's docblock and this note both
  require it be a `Map`.
- **[Inter-process / Electron attack surface] No findings.** Both production modules are renderer-side
  and add no IPC channel, no `contextBridge` API and no `ipcMain` handler. The bridge subscribes
  through the existing preload bridge (`window.pyry.onDaemonEvent`) and reads an already-typed event —
  AC5 forbids `ipcRenderer`, a key, a socket and a raw frame type, and the import blocks are the proof.
  `window.pyry` is dereferenced only inside the effect, never during render. No window, navigation,
  protocol handler or remote content is involved.
- **[Cryptographic primitives] Not applicable, by design.** No randomness, no key material, no
  comparison against a secret, no handshake. See the tokens finding for why `===` / `Map.get` is the
  correct comparison for `conversationId` rather than a constant-time one.
- **[Network & I/O] No findings; growth is bounded and stated rather than defended.** No socket, no
  fetch, no URL, no timeout to set — this slice owns no I/O. The **reactive-only** decision is
  security-relevant and not merely architectural: a client-side retry or a `connected`-edge fetch
  against a relay that withholds the frame would be a self-inflicted spin driven by an on-path relay,
  so there is no request half and none may be added. The one DoS-shaped question is a hostile relay
  replaying `model_list` frames with distinct conversation ids: growth is **one bounded entry per
  distinct id**, never an unbounded append per frame, each frame is producer-capped upstream, and
  `MAX_PLAINTEXT_BYTES` caps the decrypted envelope before any parse — in `parseInboundMessage`, ahead
  of `decodeEnvelope` and ahead of every narrower. #977 returns it to zero at each pairing change. No
  speculative eviction policy is built for a failure nobody has observed.
- **[Error messages, logs, telemetry] SHOULD FIX — the load-bearing category here.** **Nothing on this
  path may be logged**, not even a content-free "dropped an unrelated event" or "no list for this
  conversation" diagnostic; the Phase-B check is that neither production file contains a `console.`
  call. Two consequences that look like style choices and are not: (a) `default: null` in
  `translateModelList` rather than `assertNever` is a security control — every `assertNever` guard in
  this repo `JSON.stringify`s the whole event into an `Error`, which would put claude-authored
  `display_name`, `value` and `effort_levels` text into an error message; (b) for the same reason the
  four existing bridge no-op cases must stay, and this slice touches none of them. The never-into-a-log
  clause rests on the **contract**, not on a measurement: no control byte is measured in these short
  labels, but the daemon bounds and does not sanitize, so one is *permitted* rather than *excluded*.
  The sibling's measured-`0x0a`-across-51-entries argument must **not** be transcribed into these
  docblocks — it would be a false factual claim about this frame. Nothing throws into React, so no
  stack trace can carry row text either.
- **[Concurrency] No findings.** One subscription, whose cancellation path is the off handle returned
  as the effect cleanup, so a StrictMode double-mount nets exactly one live listener and window
  teardown removes it. No promise, timer, interval or `AbortController` — nothing outlives the window.
  The one check-then-act shape is the store write, and it is closed by reading `s.lists` inside the
  `set` updater rather than through `getState()` outside it; zustand runs the updater synchronously, so
  two frames arriving back-to-back cannot interleave.
- **[Threat model alignment] No findings; two threats explicitly deferred.** A malicious or compromised
  relay is content-blind but on-path: **drop** → a conversation with no list, the normal permanent
  `null` state rather than a spinner; **delay / reorder / replay** → a snapshot replaces wholesale, so
  the last frame wins, there is no merge to poison and nothing accumulates; **flood** → the bounded
  per-id growth above. A hostile daemon response is rejected upstream by #972's fail-closed narrower.
  Renderer compromise reaching the transport is stopped by process isolation — nothing here holds keys,
  sockets or tokens. **OUT OF SCOPE, named:** the render-boundary escaping obligation for these
  claude-authored strings belongs to #975 and #976 (this slice has no DOM sink), and the pairing-scoped
  clear belongs to #977.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
