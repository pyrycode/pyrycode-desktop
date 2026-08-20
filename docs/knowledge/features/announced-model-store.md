# Announced-model store

The renderer's held copy of **the model claude announced for the running turn** — a dedicated,
unidirectional Zustand store fed by a reactive-only headless observer, so the run-configuration sheet
(#560) can eventually answer "what is actually running", a question the daemon's persisted per-session
override cannot answer on an un-overridden daemon.

Introduced in [#588](../codebase/588.md), consuming the `modelAnnounced` daemon event
[#587](../codebase/587.md) already decodes off claude's `system` / `init` line. Shipped **dormant** —
nothing renders it yet; [#560](run-config-store.md) (open) is the consumer.

## What it does

Holds the most recently arrived `{ model, truncated }` pair, verbatim, replacing the whole value on
every new announcement (most-recent-wins, no merge, **no dedup of a verbatim repeat** — a repeat is the
daemon's own signal that the value is still current). `model` is untrusted, model-influenced daemon-relayed
text — never normalised, lowercased, allow-listed, date-stamped, family-mapped, or shape-checked. claude
echoes an identifier at least as specific as the one it was given, so a lookup miss downstream is
ordinary, not an error. `truncated` is the daemon's cut report and is load-bearing: a consumer that
ignores it presents a cut identifier as complete, and a cut identifier always misses an exact-lookup
display resolution and so always renders verbatim, looking exactly like a legitimate unrecognised model.

`announced: null` is the distinct "no announcement has arrived yet" state — an announcement arrives
once per turn, so a freshly launched app has none. A received `{ model: '', truncated: false }` is a
**real, degenerate announcement**, held as-is and never collapsed to `null` (the
[session-id store](session-id-store.md)'s `null`-vs-`''` contract, reused here). This arm is reachable,
not hypothetical: the daemon's producer suppresses an empty model, but #587 deliberately declined a
second client-side suppression, so a non-conforming or hostile daemon can still deliver one.

Deliberately **not** a [run configuration store](run-config-store.md) facet, on four grounds argued in
the architect's spec: lifetime mismatch (that store's data path requests a fresh snapshot on sheet
open; this holder is App-level always-listening), all three exhaustive bridges already name this as a
distinct thing in their permanent no-op comments, the `model` field name **collides and means the
opposite** on `snapshotReceived`/`runConfigReceived` (the per-session *override*, not what claude
announced), and `runConfigStore`'s own `snapshot: null` already spends its not-yet sentinel.

## How it works

### The store (`src/renderer/src/store/announcedModelStore.ts`)

```ts
export interface AnnouncedModel { model: string; truncated: boolean }
export interface AnnouncedModelState { announced: AnnouncedModel | null }  // null = not yet announced
export type AnnouncedModelStore = AnnouncedModelState & { setAnnouncedModel: (a: AnnouncedModel) => void }

createAnnouncedModelStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
announcedModelStore                  // app-wide singleton
useAnnouncedModelStore(selector)     // React binding: useStore(announcedModelStore, selector)
selectAnnouncedModel(s)              // the only read surface
```

Mirrors [`screenSnapshotStore.ts`](screen-snapshot-store.md)'s DI-factory → singleton → hook → selector
structure and its record-`|`-null shape. The record-`|`-null shape is **load-bearing, not stylistic**:
the flat alternative `{ model: string | null; truncated: boolean }` would force `truncated` to carry a
value before any announcement exists, contradicting "`false` is a value, never an absence." Wrapping
both fields behind one nullable record makes "not yet announced" a single sentinel and makes every
field of a present record a real daemon-delivered value by construction.

A single setter rather than a reducer — exactly one mutation ("record the latest announcement"), so a
discriminated-union action set would be ceremony without benefit. `setAnnouncedModel` replaces the whole
`announced` record unconditionally: no merge, no coercion, no validation. Memory is O(1) regardless of
announcement volume — the store holds exactly one record and replaces it, so a flooding hostile relay
costs one allocation per frame, not an unbounded append.

### The data path (`src/renderer/src/store/announcedModelBridge.ts`)

Framework-free, effects injected (the `sessionIdBridge` / `screenSnapshotBridge` idiom), so the whole
path unit-tests with plain spies:

```ts
translateModelAnnounced(event: DaemonEvent): AnnouncedModel | null
// modelAnnounced → { model: event.model, truncated: event.truncated } — a FRESH named-field literal,
// never `return event`, never a spread, so `type` never reaches the store. Every other event → null,
// including (critically) snapshotReceived and runConfigReceived, whose own `model: string` means the
// per-session OVERRIDE — the opposite value.

subscribeAnnouncedModel(onDaemonEvent, setAnnouncedModel): () => void
// onDaemonEvent(event => { const a = translateModelAnnounced(event); if (a !== null) setAnnouncedModel(a) })
// — `!== null`, not truthiness: `if (announced?.model)` would drop a reachable { model: '' }
// announcement AND its truncated report. Returns the off handle as cleanup (the sessionIdBridge idiom).
```

**A fourth independent observer, not a new arm on an existing bridge.** All three exhaustive bridges —
`daemonEventBridge.ts:150`, `modalBridge.ts:101`, `timelineBridge.ts:161` — keep their `modelAnnounced`
no-op **permanently**, present only so their `assertNever` guard makes a *new* arm a compile error. This
is the [session-id store](session-id-store.md) / `backgroundTaskRosterBridge` shape (an independent
subscriber), not the `apiRetry` shape where that arm folded into `timelineBridge`'s owned status
cluster.

### The React binding — `AnnouncedModelData` (same file)

A headless leaf (`AnnouncedModelData(): null`) mounted **unconditionally at App level**
(`src/renderer/src/App.tsx`) — the **eighth** headless leaf, alongside `ConversationListData` …
`BackgroundTaskRosterData`. A `modelAnnounced` event can arrive at any time, including before the
run-configuration sheet is ever opened, so the subscriber must already be listening. One
`useEffect(() => subscribeAnnouncedModel(window.pyry.onDaemonEvent, a => announcedModelStore.getState().setAnnouncedModel(a)), [])`;
`window.pyry` is dereferenced only inside the effect, so it server-renders to `null` without a bridge
mock. No `connected` gate (unlike its roster neighbour, this store has no re-handshake reset logic —
see § Edge cases below), no request effect, reactive-only.

### Data flow

```
daemon system/init line → #587 transport decode → modelAnnounced{model, truncated}
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge   (no-op, permanent)
                                └─ AnnouncedModelData (NEW, #588)
                                     → translateModelAnnounced → setAnnouncedModel
                                     → announcedModelStore                        [most recent announcement wins]

#560 (open): useAnnouncedModelStore(selectAnnouncedModel) → run-configuration sheet's "what is running" row
```

## Configuration and usage

- **Import surface**, for #560 to consume:
  `import { useAnnouncedModelStore, selectAnnouncedModel } from '@renderer/store/announcedModelStore'`.
- **Mount point:** `src/renderer/src/App.tsx`, `<AnnouncedModelData />` after `<BackgroundTaskRosterData />`.
- **Single current value, not a per-conversation map** — `conversation_id` is dropped at the #587 emit
  (the `turnState`/`stallDetected`/`apiRetry`/`compacting` convention), so this holds one value replaced
  on each announcement.

## Edge cases and limitations

- **Untrusted text, no DOM sink here.** `model` is model-influenced daemon-relayed text, bounded to 256
  bytes by the daemon's producer but not sanitised — no control-character or terminal-escape stripping
  anywhere on this path. This slice has no render surface, so the plain-text-never-HTML discipline is
  inherited rather than discharged: #560 owns the only DOM sink and must never place `model` into
  `innerHTML`, an attribute, or a URL.
- **No dedup of a verbatim repeat, by design.** N daemon frames — including an identical repeat — produce
  N writes and N fresh object identities, so a component selecting `selectAnnouncedModel` re-renders on
  a repeat too. #560 memoises if that ever matters; this store does not pre-empt it.
- **Deliberately absent from `clearPairingScopedState`, as of #588.** The store is pairing-scoped
  (nothing on a fresh pairing re-asserts an announcement — the next one arrives only with the next
  turn's init line), which by that helper's own rule means it belongs there. It was left out at #588
  because the store still ships dormant (a stale value is unobservable until #560 renders it), because
  a clear would be a second mutation to a store contracted as "written only by wiring", and because
  adding it would have pushed #588 to five production files. **Recommended, not yet ticketed:** fold
  `clearAnnouncedModel` + a `ClearPairingScopedStateDeps` entry into #560 — see
  [#588 codebase notes](../codebase/588.md) § Deferred.
- **No correlation, no request half.** The daemon pushes `modelAnnounced` unsolicited off the turn's
  init line; there is no `requestAnnouncedModel` command and nothing to time out or retry.

## Related

- [#587 codebase notes](../codebase/587.md) — the transport half: `modelAnnounced` decode, the
  `truncated` field, and the `model`-name collision with `snapshotReceived`/`runConfigReceived`.
- [#588 codebase notes](../codebase/588.md) — implementation summary, patterns established, and the
  pairing-scoped-clear deferral.
- [Daemon-event channel](daemon-event-channel.md) — the `modelAnnounced` `DaemonEvent` arm and the
  three permanent bridge no-ops this store's bridge sits alongside as a fourth observer.
- [Session-id store](session-id-store.md) — the closest structural precedent: DI-factory → singleton →
  hook → selector, the `null`-vs-`''` contract, App-level always-listening headless leaf, and the
  `!== null` (not truthiness) subscription guard, all reused verbatim here.
- [Screen-snapshot store](screen-snapshot-store.md) — the record-`|`-null shape precedent
  (`ScreenSnapshotState { snapshot: T | null }`) this store's `AnnouncedModelState` clones, and another
  reactive-only, App-lifetime holder with no request half.
- [Run configuration store](run-config-store.md) — the sibling store this ticket deliberately did
  **not** fold the announcement into (lifecycle mismatch, name collision on `model`, spent `null`
  sentinel); #560, its future consumer, is tracked there.
