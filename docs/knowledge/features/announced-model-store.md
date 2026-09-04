# Announced-model store

The renderer's held copy of **the model claude announced for the running turn** — a dedicated,
unidirectional Zustand store fed by a reactive-only headless observer, so the run-configuration sheet
can answer "what is actually running", a question the daemon's persisted per-session override cannot
answer on an un-overridden daemon.

Introduced in [#588](../codebase/588.md), consuming the `modelAnnounced` daemon event
[#587](../codebase/587.md) already decodes off claude's `system` / `init` line. Shipped dormant at
\#588; rendered by [#560](../codebase/560.md)'s `RunningModelSection`, the sixth section of
`RunConfigView` — see [Run configuration store](run-config-store.md) § Running model section. Cleared
when a pairing ends, both on the unpair route flip and the pair-another-server transition, by
[#593](../codebase/593.md) — see § Edge cases below and [Paired shell](paired-shell.md) for the shared
clear helper.

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
opposite** on `runConfigReceived` (the per-session *override*, not what claude announced — through
[#621](../codebase/621.md), `snapshotReceived` carried the same colliding field too), and
`runConfigStore`'s own `snapshot: null` already spends its not-yet sentinel.

## How it works

### The store (`src/renderer/src/store/announcedModelStore.ts`)

```ts
export interface AnnouncedModel { model: string; truncated: boolean }
export interface AnnouncedModelState { announced: AnnouncedModel | null }  // null = not yet announced
export type AnnouncedModelStore = AnnouncedModelState & {
  setAnnouncedModel: (a: AnnouncedModel) => void
  clearAnnouncedModel: () => void   // #593 — returns to initialAnnouncedModelState, by reference
}

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

Named setters rather than a reducer — the two mutations ("record the latest announcement" and, since
\#593, "clear when the pairing that scoped it ends") are independent whole-value writes that neither read
prior state nor constrain each other's ordering, so a discriminated-union action set would still be
ceremony without benefit. `setAnnouncedModel` replaces the whole `announced` record unconditionally: no
merge, no coercion, no validation. Memory is O(1) regardless of announcement volume — the store holds
exactly one record and replaces it, so a flooding hostile relay costs one allocation per frame, not an
unbounded append.

`clearAnnouncedModel` ([#593](../codebase/593.md)) returns the state to the exported
`initialAnnouncedModelState` — unconditional and sourced from that constant rather than a fresh literal,
so it keeps resetting everything if the state ever gains a second field, and so clearing an already-clear
store is a no-op by construction rather than by a guard. It restores the `null` not-yet-announced
sentinel, never a `{ model: '', truncated: false }` record — the one case that distinguishes the store's
two sentinels (see above). It is invoked only by [`clearPairingScopedState`](paired-shell.md), never
two-way-bound from a component, and it never branches on the held content: a clear gated on the
identifier would let a hostile daemon craft a value that survives a pairing switch and is then
attributed to the next daemon.

### The data path (`src/renderer/src/store/announcedModelBridge.ts`)

Framework-free, effects injected (the `sessionIdBridge` / `screenSnapshotBridge` idiom), so the whole
path unit-tests with plain spies:

```ts
translateModelAnnounced(event: DaemonEvent): AnnouncedModel | null
// modelAnnounced → { model: event.model, truncated: event.truncated } — a FRESH named-field literal,
// never `return event`, never a spread, so `type` never reaches the store. Every other event → null,
// including (critically) runConfigReceived, whose own `model: string` means the per-session OVERRIDE
// — the opposite value. (Through #621, snapshotReceived carried the same colliding field too.)

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

\#560: useAnnouncedModelStore(selectAnnouncedModel) → RunningModelSection, the sheet's sixth section
\#1053: useAnnouncedModelStore(selectAnnouncedModel) → ComposerModelMenu, the footer trigger's second layer
```

## Configuration and usage

- **Import surface**, consumed by [#560](../codebase/560.md)'s `RunningModelSection` and, since #1053, by
  [Composer model menu](composer-model-menu.md)'s `ComposerModelMenu` container:
  `import { useAnnouncedModelStore, selectAnnouncedModel } from '@renderer/store/announcedModelStore'`.
  The footer trigger reads the same singleton and the same selector, so a `null` vs. `{ model: '' }`
  distinction at this store still matters even though the footer control itself collapses both to "nothing
  at this layer" — see that document's `ComposerModelLayers` section.
- **Mount point:** `src/renderer/src/App.tsx`, `<AnnouncedModelData />` after `<BackgroundTaskRosterData />`.
- **Single current value, not a per-conversation map.** At ship time `conversation_id` was dropped at the
  #587 emit; [#714](../codebase/714.md) later widened the emit to carry it onward as `conversationId` (the
  last arm in the `turnState`/`stallDetected`/`apiRetry`/`compacting` widening family), but the id stops at
  `translateModelAnnounced`, which still rebuilds a fresh `{ model, truncated }` literal — this store still
  holds one value replaced on each announcement, unaffected. The per-conversation consumer is #588 / #674,
  not yet built.

## Edge cases and limitations

- **Untrusted text, two DOM sinks since #1053, downstream of this store.** `model` is model-influenced
  daemon-relayed text, bounded to 256 bytes by the daemon's producer but not sanitised — no
  control-character or terminal-escape stripping anywhere on this path. [#560](../codebase/560.md)'s
  `RunningModelSection` was the only DOM sink through #975: one JSX text position, never `innerHTML`, an
  attribute, or a URL. At #560 ship time the resolved name on a lookup hit was a client-owned
  `MODEL_CATALOG` label, kept out of the same node as the daemon-supplied verbatim text;
  [#975](../codebase/975.md) deleted that catalog and re-anchored the lookup onto [Model-list
  store](model-list-store.md)'s published rows, so **both branches are daemon-authored text now** — the
  provenance changed, the one-JSX-text-position-per-branch property that actually matters did not, and
  #975's code comment rewrote the now-false "provenances never mix" claim in place rather than leaving it
  standing. [#1053](composer-model-menu.md) added a second, independent sink in `ComposerModelMenu`'s
  trigger label — same rule (one JSX text position, no attribute, no `title`, no log), and the value never
  reaches that control's `onSelect` write, which dispatches only a value a published row itself carries.
- **No dedup of a verbatim repeat, by design.** N daemon frames — including an identical repeat — produce
  N writes and N fresh object identities, so a component selecting `selectAnnouncedModel` re-renders on
  a repeat too. #560 memoises if that ever matters; this store does not pre-empt it.
- **Cleared on both pairing-change paths, since #593.** The store is pairing-scoped — nothing on a
  fresh pairing re-asserts an announcement, the next one arrives only with the next turn's init line —
  so it is a member of [`clearPairingScopedState`](paired-shell.md)'s shared set rather than cleared at
  either call site. #588 shipped the store without this (the deferral was harmless while the slice
  rendered nowhere); #560 made a stale value observable (the sheet would attribute server A's
  identifier, and its `truncated` cut report, to server B with no provenance marker); #593 closed it.
  **Not** on the transport's `connected` edge — the mutually exclusive alternative mechanism
  `backgroundTaskRosterStore` uses — because a reconnect to the *same* daemon leaves the held
  announcement accurate; there is no re-handshake staleness case for this store the way there is for
  the task roster.
- **No correlation, no request half.** The daemon pushes `modelAnnounced` unsolicited off the turn's
  init line; there is no `requestAnnouncedModel` command and nothing to time out or retry.

## Related

- [Composer model menu](composer-model-menu.md) — #1053's second consumer: the footer trigger layers this
  store's value between a pick made in this client and the run-config snapshot's stored choice, resolving
  it through the same `publishedRowFor` lookup `RunningModelSection` uses.
- [#587 codebase notes](../codebase/587.md) — the transport half: `modelAnnounced` decode, the
  `truncated` field, and the `model`-name collision with `runConfigReceived` (and, through
  [#621](../codebase/621.md), `snapshotReceived`).
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
  sentinel); § Running model section documents this store's consumer, `RunConfigView`'s sixth
  section.
- [#560 codebase notes](../codebase/560.md) — the original render consumer: the `MODEL_CATALOG`
  exact-match lookup, the render contract for the three states, and the sibling-element cut marker.
  [#975](../codebase/975.md) deleted the catalog and re-anchored the lookup (`publishedRowFor`, renamed
  from `runningPublishedRow` by #976 when it gained a second caller) onto [Model-list
  store](model-list-store.md)'s published rows, joined on `value` — see [Run
  configuration store § Running model section](run-config-store.md#running-model-section-560-resolved-onto-the-published-rows-by-975).
- [#593 codebase notes](../codebase/593.md) — `clearAnnouncedModel` and its join into
  [`clearPairingScopedState`](paired-shell.md)'s shared set, closing the deferral #588 flagged and #560
  made observable.
- [#714 codebase notes](../codebase/714.md) — widened the `modelAnnounced` emit to carry `conversationId`,
  the last arm in the transport-wide widening family; `translateModelAnnounced` still filters it out, so
  this store and its bridge are unaffected — the per-conversation consumer is #588 / #674, not yet built.
- [Slash-command-list store](slash-command-list-store.md) — the closer structural read for its bridge
  half: one owned arm, one injected setter, no reset branch, no request half, App-level headless leaf,
  reused nearly verbatim from this store's `announcedModelBridge`.
