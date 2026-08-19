# #588 — Hold claude's announced running model in a renderer store

## Files to read first

Codegraph is not initialized for this repo (`codegraph_status` → "CodeGraph not initialized"), so this
list is grep/Read-derived rather than lifted from `codegraph_context`. It is the developer's turn-1
data load — read these before writing anything.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/screenSnapshotStore.ts:1-67` | **The primary shape template.** Record-`\|`-null state, DI factory → singleton → hook → selector, single unconditional setter. Clone this file's structure, not sessionIdStore's. |
| `src/renderer/src/store/screenSnapshotBridge.ts:1-75` | **The primary bridge template.** Fresh named-field literal in the translator (`{ text: event.text, ts: event.ts }` — never a spread), `default: null` filter, `!== null` guard, headless `*Data` leaf. |
| `src/renderer/src/store/screenSnapshotBridge.test.ts:1-177` | Test file shape to mirror: `fakeBridge()` helper, translate/subscribe/container describe blocks. |
| `src/renderer/src/store/screenSnapshotStore.test.ts:1-77` | Store-test shape to mirror (77 lines is the target size). |
| `src/renderer/src/store/sessionIdStore.ts:24-29, 41-67` | The `null` vs `''` contract argued in prose — reuse the reasoning, not the flat-scalar shape. |
| `src/renderer/src/store/sessionIdBridge.ts:43-60` | The `id !== null` (not `if (id)`) guard and why. Same trap, different surface here — see §Design. |
| `src/shared/ipc/events.ts:174-211` | The `modelAnnounced` arm and its 37-line contract comment. **The spec below restates it; the comment is the SSOT.** |
| `src/renderer/src/App.tsx:107-135` | The seven mounted headless leaves and the comment convention above them. This adds the eighth. |
| `src/renderer/src/store/daemonEventBridge.ts:150-156` | The permanent `modelAnnounced` no-op. **Do not edit.** Confirms this ticket adds an observer, not a bridge arm. |
| `src/renderer/src/store/modalBridge.ts:101` + `src/renderer/src/store/timelineBridge.ts:161` | The other two permanent no-ops. **Do not edit either.** |
| `src/renderer/src/store/runConfigStore.ts:1-45` | The `model` field that means the **override** — the value this store must not be confused with. Read to understand the collision, not to modify. |
| `src/renderer/src/clearPairingScopedState.ts:19-27, 75-80` | The "a pairing-scoped store nothing re-asserts belongs HERE" rule. **Deliberately not satisfied by this ticket** — see §Deferred. |
| `docs/specs/architecture/587-model-announced-decode.md` | The upstream half: what already decodes, what is already dropped, what ships dormant. |

## Design source

N/A — renderer state only, no user-visible surface. The run-configuration sheet's Figma reference is
on #560, which owns the render boundary.

## Context

#587 landed (`e407a7e`, PR#589): `model_announced` is decoded off the v2 wire into a typed
`modelAnnounced` daemon event that crosses IPC and is no-op'd by all three exhaustive bridges. It
shipped dormant — the house shape for an inbound signal here (`apiRetry` dormant until #493,
`compacting` until #496, the background-task family until #567).

This ticket gives the value a home in renderer state. Nothing renders it; #560 is the consumer.

The value answers a question the persisted override cannot. The run-config sheet reads the daemon's
per-session override, which on an un-overridden daemon is `''` — honest, but indistinguishable from
broken. The operator is asking what is *running*, not what was once *set*.

## Design

### Decision 1 — a dedicated store, not a `runConfigStore` facet

The ticket left this to the architect. **Dedicated store.** Four facts, three from the ticket and one
structural:

1. **Lifetime mismatch.** `runConfigStore.ts:1-5` — its data path "requests a fresh snapshot on sheet
   open". Sheet-scoped and request-driven. This holder must be App-level always-listening, because an
   announcement arrives on the turn's `init` line whether or not any sheet is open.
2. **All three bridge comments already name it as a distinct thing** — "the announced-model store
   (#588)" at `daemonEventBridge.ts:150`, `modalBridge.ts:101`, `timelineBridge.ts:161`.
3. **The name collides and means the opposite.** `events.ts:180-185` warns that `modelAnnounced.model`
   "COLLIDES BY NAME WITH TWO ARMS ABOVE AND MEANS THE OPPOSITE THING". `runConfigStore.ts:27` holds
   `model: string` meaning the *override* (`''` = inherited default). Folding the announcement in puts
   two differently-meaning `model` fields in one store, both destined for the same sheet.
4. **The `null` sentinel is already spent.** `runConfigStore`'s `snapshot: RunConfigSnapshot | null`
   uses `null` for "not yet loaded". Folding in would need a *second* not-yet sentinel nested inside a
   record whose own `null` already means something else — i.e. it would force exactly the
   representability problem AC4 exists to avoid.

The evidence is one-sided. Two orthogonal stores; a snapshot arrival re-renders only components
selecting its slice, and an announcement only components selecting this one.

### Decision 2 — a record, not two flat fields

```ts
export interface AnnouncedModel {
  model: string      // claude's identifier, VERBATIM
  truncated: boolean // the daemon's cut report; `false` is a VALUE, never an absence
}

export interface AnnouncedModelState {
  announced: AnnouncedModel | null // `null` = no announcement has arrived yet (AC4)
}
```

The `screenSnapshotStore` / `runConfigStore` record-`|`-null shape, and it is load-bearing here rather
than stylistic. The flat alternative `{ model: string | null; truncated: boolean }` is **wrong**: it
forces `truncated` to carry a value before any announcement exists, which is precisely the
"`false` is a VALUE (nothing was cut), never an absence" rule at `events.ts:194`. Wrapping both fields
behind one nullable makes "not yet announced" a single sentinel and makes every field of a present
record a real daemon-delivered value by construction.

A received `{ model: '', truncated: false }` is a **real, degenerate announcement — not `null`**. This
arm is reachable, not hypothetical: the daemon's producer suppresses an empty model
(`parser.go:1446`), but #587 deliberately declined a second client-side suppression, so `requireString`
admits `''` and the decoder passes it through. A non-conforming or hostile daemon reaches this store
with it.

### Decision 3 — module surface

Two new files under `src/renderer/src/store/`, named after the three bridge comments' own phrasing
(`grep -rn "announcedModel\|AnnouncedModel" src/` returns zero — no fan-out, no collision):

**`announcedModelStore.ts`** — clone `screenSnapshotStore.ts`'s structure:

| Export | Contract |
|---|---|
| `AnnouncedModel` | The two-field record above. |
| `AnnouncedModelState` | `{ announced: AnnouncedModel \| null }`. |
| `AnnouncedModelStore` | `AnnouncedModelState & { setAnnouncedModel: (a: AnnouncedModel) => void }` — the mutation lives on the store type, **not** on the state interface, so the selector (typed against state-only) cannot see it and `initialAnnouncedModelState` stays assignable. |
| `initialAnnouncedModelState` | `{ announced: null }`. |
| `createAnnouncedModelStore(init?)` | DI factory — one isolated instance per test. |
| `announcedModelStore` | App-wide singleton. |
| `useAnnouncedModelStore<T>(selector)` | Narrow-slice React binding for #560. |
| `selectAnnouncedModel` | `(s: AnnouncedModelState) => AnnouncedModel \| null` — the only read surface (AC5). |

`setAnnouncedModel` replaces the whole record unconditionally: no merge, no coercion, no validation,
**no dedup of a verbatim repeat** (AC3). Per `events.ts:208-209` a repeat is the signal that the value
is still current, so suppressing it would discard information. One consequence to state rather than
discover: each write produces a fresh object identity, so a verbatim repeat does re-notify subscribers.
That matches `screenSnapshotStore` exactly; #560 memoises if it ever matters.

**`announcedModelBridge.ts`** — clone `screenSnapshotBridge.ts`'s structure:

```ts
export function translateModelAnnounced(event: DaemonEvent): AnnouncedModel | null
export function subscribeAnnouncedModel(
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void,
  setAnnouncedModel: (a: AnnouncedModel) => void
): () => void
export function AnnouncedModelData(): null
```

- `translateModelAnnounced` — `switch (event.type)`, one `case 'modelAnnounced'` returning a **fresh
  named-field literal** `{ model: event.model, truncated: event.truncated }`, and `default: null`.
  Never `return event`, never a spread — a spread would drag `type` into the store and would couple
  the store's shape to a later unrelated field on the arm. `daemonConnection.ts:686` already made the
  identical call one layer up. `default: null` and **not** `assertNever`: ignoring the rest is this
  path's intended permanent behaviour (the independent-subscriber posture of `sessionIdBridge` /
  `queueBridge` / `screenSnapshotBridge`), unlike the three typecheck-gating exhaustive bridges.
- `subscribeAnnouncedModel` — subscribes via the injected `onDaemonEvent`, guards
  `if (announced !== null)`, writes, and returns the off handle as the caller's cleanup. **The guard
  is on the record's presence, never on `.model`'s content.** `if (announced?.model)` would drop both
  the reachable `{ model: '' }` announcement *and* its `truncated` report — the `sessionIdBridge:47-49`
  trap, made structurally harder here by the record wrapper but still writable by hand.
- `AnnouncedModelData` — headless leaf, renders `null`, dereferences `window.pyry` **only inside the
  effect** so it server-renders to `''` without a bridge mock.

**`App.tsx`** — one import, one `<AnnouncedModelData />` in the fragment (order: after
`<BackgroundTaskRosterData />`), and a comment in the block at `:91-118` following the established
convention: the **eighth** headless leaf, App-level always-listening because an announcement can
arrive before the run-config sheet (#560) is ever opened; reactive-only, no connected gate; ships
dormant.

### What this ticket does NOT touch

`daemonEventBridge.ts`, `modalBridge.ts`, `timelineBridge.ts`. Their `modelAnnounced` no-ops are
**permanent** — each is present only so the `assertNever` guard makes a *new* arm a compile error.
This is the `sessionIdBridge` / `backgroundTaskRosterBridge` shape (an independent fourth observer),
**not** the #493 shape (folding into an owned arm of an existing bridge). AC5's "no existing bridge arm
changes behaviour" is satisfied by not editing them at all.

## State + concurrency model

One store slice, one writer, one subscription.

```
IPC DaemonEvent → AnnouncedModelData effect → subscribeAnnouncedModel
                → translateModelAnnounced (pure) → setAnnouncedModel → announcedModelStore
                → selectAnnouncedModel → (#560, not yet built)
```

- **Async tasks:** none. No promise, no timer, no `AbortController`, no request half — the daemon
  pushes unsolicited. There is no request effect and no connected-edge trigger.
- **Subscription lifetime:** app-lifetime. Subscribe on mount inside `useEffect(…, [])`; the returned
  off handle *is* the cleanup, so a StrictMode double-mount nets exactly one live listener.
- **Ordering:** last-write-wins, unconditional. No check-then-act — the setter never reads prior state,
  so there is no critical section and no `await` gap in which state could change.
- **Keying:** none. `conversation_id` is dropped at the emit (#587), so this is a single value replaced
  on each announcement, exactly as `events.ts:205-207` specifies.

## Error handling

No new failure mode. Every malformed-payload path is already handled and closed upstream: the #587
decoder throws `WireDecodeError` inside `daemonConnection`'s existing decode guard, the frame is
dropped, and **no event is emitted**. By the time an event reaches this store it is already a
type-checked `{ model: string; truncated: boolean }`.

| Layer | Result type | Surface |
|---|---|---|
| Translator | `AnnouncedModel \| null` — `null` means "not our arm", never "bad data" | none |
| Subscriber | `void`; the listener only translates + dispatches and **never throws into React** | none |
| Store | `void`; the setter is total (no gate, no return value, no throw path) | none |

**No user-facing surface.** No banner, no dialog, no silent-failure decision — nothing renders until
#560. Nothing is logged: ADR 0007's content-free rule forbids logging the identifier (untrusted,
model-influenced text), a bare "an announcement arrived" line instruments nothing, and there is no
observed failure to instrument.

## Testing strategy

`npm test` (vitest, node env) plus `npm run typecheck`. Both modules are plain TypeScript with injected
dependencies, so they test directly with spies — no DOM, no Electron, no store singleton in the unit
paths. The repo's server-render-only UI posture does not constrain this ticket (nothing renders), with
the single exception of the container smoke test below.

**Do not write the singleton store then server-render a container to assert the result** — zustand v5
reads `getInitialState()` under `renderToStaticMarkup`, so that assertion is silently vacuous
(`ConversationScreen.test.tsx:1543`). Every seam test drives a `createAnnouncedModelStore()` instance
directly.

### `announcedModelStore.test.ts`

- Initial state is `{ announced: null }`, and `selectAnnouncedModel` returns `null` — the distinct
  "not yet announced" state (AC4).
- `setAnnouncedModel` with a concrete record → selector returns that record; assert with an exact
  `toEqual` on a literal.
- A second `setAnnouncedModel` wholly replaces the first — last-write-wins, no merge (AC3).
- A verbatim repeat writes again and yields a value equal to the previous one (AC3, no dedup).
- `{ model: '', truncated: false }` is held as a **real record**, not collapsed to `null` — assert
  `selectAnnouncedModel(...)` is not null *and* its `model` is `''` (AC4's empty-string arm).
- An identifier that appears in no published model list (`'claude-haiku-4-5'`) is held byte-for-byte —
  exact `toBe`, proving no allow-list, no date-stamping, no family mapping (AC1).
- An identifier carrying mixed case, underscores, dots and a control character is held byte-for-byte —
  exact `toBe`, proving no normalising and no lowercasing (AC1).
- `truncated: true` is held alongside the identifier; a write differing only in `truncated` replaces
  (AC2 — the report is not sticky and not derived from the identifier).
- `createAnnouncedModelStore(init)` honours a non-default init and two instances are independent (DI).

### `announcedModelBridge.test.ts`

Mirror `screenSnapshotBridge.test.ts`'s layout, including its `fakeBridge()` capture-the-listener helper.

- `translateModelAnnounced` maps the owned arm to `{ model, truncated }` — exact `toEqual` on a literal.
- The returned object is a **fresh literal, not the event**: assert `'type' in result` is `false`.
  This is the anti-spread pin.
- Returns `null` for a sample of unrelated events. **Include `snapshotReceived` with `model: ''` and
  `runConfigReceived` with `model: 'some-override'`** — the two name-colliding arms. This is the
  highest-value negative in the file: it pins that the filter never picks up the *override* and mistakes
  it for the announcement.
- `subscribeAnnouncedModel` subscribes exactly once, and its return value invokes the captured off spy.
- Writes on the owned arm (AC1); writes again on a second, with the second value (AC3).
- Writes an announcement whose `model` is `''` — the `!== null` guard, not truthiness (AC4). Assert the
  spy received `{ model: '', truncated: false }`, i.e. that `truncated` survived too.
- Does not call the setter for an unrelated event.
- **Seam:** with a real `createAnnouncedModelStore()`, `selectAnnouncedModel` goes `null` → the record
  on one emitted event (AC4 → AC1 in one test).
- `AnnouncedModelData` server-renders to `''` without touching `window.pyry` and without throwing.

### Type-level

`npm run typecheck` covers the rest: `selectAnnouncedModel` typed against `AnnouncedModelState` cannot
see `setAnnouncedModel` (AC5's read-only-selector half), and the translator's `case 'modelAnnounced'`
stops compiling if the arm is ever renamed.

## Deferred — the pairing clear

`clearPairingScopedState.ts:19-27` states the rule: *"A future pairing-scoped store that nothing
re-asserts on the new pairing belongs HERE."* This store meets that description — nothing on a fresh
pairing re-asserts an announcement; the next one arrives only with the next turn's `init` line.

**Deliberately out of scope for this ticket**, on three grounds:

1. It ships dormant. A stale value is unobservable until #560 builds the render surface.
2. The AC set has no clear, and adding one adds a second mutation to a store whose AC5 says "written
   only by wiring".
3. It would take this ticket to **five production files** (store, bridge, `App.tsx`,
   `clearPairingScopedState.ts`, `PairedShell.tsx:50-55`), tripping the §4 self-check gate — the exact
   scope creep that gate exists to stop.

**Obligation this creates:** the store's header comment MUST record the deferral in writing —
that the store is pairing-scoped, that it is deliberately absent from `clearPairingScopedState`, and
that the clear rides with #560 or a follow-up filed against it. Written down, the next ticket finds it;
undocumented, it is rediscovered as a bug.

## Open questions

1. **Who files the pairing-clear follow-up?** Recommendation: PO folds `clearAnnouncedModel` +
   its `ClearPairingScopedStateDeps` entry into #560, since #560 is the ticket that makes a stale value
   observable and already touches this vertical. The alternative — a standalone XS ticket — is equally
   correct; what must not happen is the obligation existing only in this spec.
2. **Nothing else.** No open interface question: the wire shape, the drop of `conversation_id`, the
   `truncated` boolean-not-list form, and the no-dedup rule are all settled by #587's merged code and
   pinned in `events.ts:174-211`.

## Scope

| | |
|---|---|
| New production files | 2 (`announcedModelStore.ts`, `announcedModelBridge.ts`) |
| Edited production files | 1 (`App.tsx` — one import, one JSX line, one comment) |
| **Production files total** | **3** — under the §4 ≥5 gate |
| New test files | 2 |
| New exported types / interfaces / components | 4 (`AnnouncedModel`, `AnnouncedModelState`, `AnnouncedModelStore`, `AnnouncedModelData`) — under the 5 red line |
| Projected total LOC | ~420 (store ~70 / bridge ~72 / store test ~80 / bridge test ~180 / App.tsx +4, at the anchors' documented comment density) — under the ~600 red line |
| Consumer call sites to update | **0** — `grep -rn "announcedModel\|AnnouncedModel" src/` returns zero; the only consumer is #560 |
| Reject / error branches | 0 — no state machine, no per-branch log calls |
| Acceptance criteria | 5 |

No red line tripped. Size **S** confirmed (PO's label held; not lowered to XS — two new modules with
two new test files is above XS, and the pair is compile-atomic: a bridge without its store does not
compile, and a store with no writer has no behaviour to test).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary is explicit rather than incidental. The
  untrusted→typed transition already happened upstream at `parseModelAnnouncedPayload`
  (`inboundMessage.ts:1403`) inside the main process; this slice receives an already-type-checked
  `{ model: string; truncated: boolean }` across the existing `contextBridge` `onDaemonEvent` channel
  and adds **no new IPC channel, no new preload surface, and no new `ipcMain` handler**. The value stays
  *content*-untrusted after the boundary, which is why the store header must carry the untrusted-text
  warning forward to #560 (§Design) rather than letting the type check read as a sanitization claim.
- **[Tokens, secrets, credentials]** No findings, structurally: this path mints, stores, compares and
  transmits no secret. It holds one bounded opaque string and one boolean, both already inside the
  renderer's event stream. Nothing is written to disk, `localStorage`, `sessionStorage`, or IndexedDB —
  the store is in-memory zustand state that dies with the window.
- **[File / storage operations]** Not applicable by design decision, not by omission: there is no
  filesystem access anywhere in this slice. This is load-bearing rather than incidental — `events.ts:202`
  states the identifier "is not a cache key, a filename, or a lookup path", and the design honours it:
  the value is never concatenated into a path, never used as a key (the store is keyed by nothing), and
  never resolved. The path-traversal category is closed by the value having no sink at all.
- **[Inter-process / Electron attack surface]** No findings. No `BrowserWindow` / `webPreferences`
  change, no custom protocol or deep link, no navigation or `window.open` handler, no remote content.
  The IPC surface is *unchanged* — `AnnouncedModelData` subscribes through the existing preload
  `onDaemonEvent` bridge and touches no `ipcRenderer`, socket, key, or raw frame. Process placement is
  respected: the transport half stays in main (#587), and only an already-typed event crosses.
- **[Cryptographic primitives]** Not applicable — no RNG, no hashing, no key material, no nonce, no
  comparison against a secret. Notably there is **no comparison at all**: the design forbids matching
  the identifier against an allow-list (AC1), so no `===`-vs-`timingSafeEqual` question arises. #560's
  display lookup is an exact map lookup on a non-secret and is likewise not a timing-sensitive compare.
- **[Network & I/O]** No findings — this slice opens no socket and sets no timeout. The bound on the
  identifier is enforced *twice* upstream and neither bound is this slice's to add: the daemon caps the
  field at 256 bytes (`maxModelField`) and the frame-level `MAX_PLAINTEXT_BYTES` (65519) rejects an
  oversized frame before the parser runs. Memory growth from a flooding hostile relay is bounded by
  construction — the store holds exactly one record and replaces it, so N announcements cost O(1), not
  O(N). This is the concrete reason the no-dedup decision (§Design) is safe: a repeat costs one object
  allocation, not an unbounded append.
- **[Error messages, logs, telemetry]** No findings. Nothing is logged, deliberately (§Error handling) —
  which also means the untrusted, model-influenced identifier can never reach a log file, a console, or
  a crash/telemetry payload from this path. No error message interpolates the value; the translator has
  no throw path and the setter is total.
- **[Concurrency]** No findings. One subscription, owned by one headless component, cancelled by the
  effect cleanup that *is* the subscribe call's return value — so teardown cannot be forgotten
  separately from setup. No timer, no `AbortController`-needing call, no long-lived async task, no
  listener stacking (StrictMode double-mount nets one live listener). No check-then-act: the setter
  never reads prior state and there is no `await` inside the listener, so no shared-state race exists.
- **[Threat model alignment]** Two desktop threats apply and both are addressed rather than assumed
  away. **Hostile daemon response:** a non-conforming daemon *can* deliver `{ model: '' }` past the
  producer's own suppression, and the design records it as the degenerate value it is instead of
  erasing it — the store deliberately does not "repair" daemon data. Control characters and terminal
  escapes are likewise held verbatim because the escaping obligation belongs to the DOM sink, not to
  the holder; the constraint is *inherited and documented*, not discharged. **Malicious relay:** it is
  on-path but content-blind and cannot forge a frame inside the Noise session; flooding is bounded as
  above. **Renderer compromise reaching the transport** is out of scope here — this slice adds no new
  renderer→main capability, so it cannot widen that surface.
- **[OUT OF SCOPE]** The render boundary — plain text only, never HTML, never into an attribute or a
  URL, never executed — belongs to **#560**, which owns the only DOM sink. This slice has none, so the
  constraint is inherited and must be carried in the store header (§Design), not silently dropped. The
  pairing-scoped clear is likewise deferred, with its rationale and its follow-up obligation recorded in
  §Deferred.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-20
