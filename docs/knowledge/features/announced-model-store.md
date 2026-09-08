# Announced-model store

The renderer's held copy of **the model claude announced for the running turn** — a dedicated,
unidirectional Zustand store fed by a reactive-only headless observer, so the run-configuration sheet
can answer "what is actually running", a question the daemon's persisted per-session override cannot
answer on an un-overridden daemon.

Introduced in [#588](../codebase/588.md), consuming the `modelAnnounced` daemon event
[#587](../codebase/587.md) already decodes off claude's `system` / `init` line. Shipped dormant at
\#588; rendered by [#560](../codebase/560.md)'s `RunningModelSection`, the sixth section of
`RunConfigView` — see [Run configuration store](run-config-store.md) § Running model section, and, since
[#1053](composer-model-menu.md), by `ComposerModelMenu`'s footer trigger. Cleared on the unpair route
flip by [#593](../codebase/593.md) — see § Edge cases below and [Paired shell](paired-shell.md) for the
shared clear helper.

**Keyed by `conversationId` since #1146.** From #588 through #1141 this was a single app-wide slot, keyed
by neither server nor conversation — defensible only while the app held one daemon. With two servers
paired, the slot held whichever daemon spoke last, so opening a conversation on the other server
attributed the previous daemon's identifier, and its `truncated` cut report, to it. #1141 removed the
pair-another-server transition's incidental clear of the slot, which reopened the staleness on that path
too, but the defect predates #1141 and needs no pairing change to reproduce — only two servers and two
chats. #1146 closed it by keying the store instead: see § How it works and § Edge cases below.

## What it does

Holds, **per conversation**, the most recently arrived `{ model, truncated }` pair, verbatim, replacing
the whole record for that conversation's id on every new announcement (most-recent-wins per key, no
merge, **no dedup of a verbatim repeat** — a repeat is the daemon's own signal that the value is still
current). A write for one conversation leaves every other conversation's held record untouched and
`Object.is`-identical, so a component watching a different id does not re-render. `model` is untrusted,
model-influenced daemon-relayed text — never normalised, lowercased, allow-listed, date-stamped,
family-mapped, or shape-checked. claude echoes an identifier at least as specific as the one it was
given, so a lookup miss downstream is ordinary, not an error. `truncated` is the daemon's cut report and
is load-bearing: a consumer that ignores it presents a cut identifier as complete, and a cut identifier
always misses an exact-lookup display resolution and so always renders verbatim, looking exactly like a
legitimate unrecognised model.

A conversation id **absent from the map** is the distinct "no announcement has arrived yet for this
conversation" state — an announcement arrives once per turn, so a freshly launched app has none, and a
conversation nobody has sent to has none even while another conversation's announcement is held. A
received `{ model: '', truncated: false }` is a **real, degenerate announcement**, held as-is under its
key and never collapsed to absence (the [session-id store](session-id-store.md)'s `null`-vs-`''`
contract, reused here). This arm is reachable, not hypothetical: the daemon's producer suppresses an
empty model, but #587 deliberately declined a second client-side suppression, so a non-conforming or
hostile daemon can still deliver one.

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
export interface AnnouncedModelSnapshot extends AnnouncedModel { conversationId: string }  // the write unit
export interface AnnouncedModelState { announced: ReadonlyMap<string, AnnouncedModel> }  // key absent = not yet announced
export type AnnouncedModelStore = AnnouncedModelState & {
  setAnnouncedModel: (s: AnnouncedModelSnapshot) => void
  clearAnnouncedModel: () => void   // #593 — whole-map clear since #1146, returns initialAnnouncedModelState by reference
}

createAnnouncedModelStore(init?)             // vanilla createStore — one isolated instance per test (DI seam)
announcedModelStore                          // app-wide singleton
useAnnouncedModelStore(selector)             // React binding: useStore(announcedModelStore, selector)
selectAnnouncedModelFor(conversationId)(s)   // the only read surface — a selector FACTORY, one per id
```

Mirrors [`screenSnapshotStore.ts`](screen-snapshot-store.md)'s DI-factory → singleton → hook → selector
structure, and — since #1146 — [`modelListStore`](model-list-store.md)'s `ReadonlyMap`-keyed,
entry/snapshot-split structure on top of it. The held `AnnouncedModel` record-`|`-absence shape is
**load-bearing, not stylistic**: the flat alternative `{ model: string | null; truncated: boolean }`
would force `truncated` to carry a value before any announcement exists, contradicting "`false` is a
value, never an absence." Wrapping both fields behind one record, and putting "not yet announced" in the
map's keyspace rather than in the record, makes every field of a present record a real daemon-delivered
value by construction. `conversationId` lives on `AnnouncedModelSnapshot`, the write unit, and
deliberately not on `AnnouncedModel`, the held record — for `ModelListSnapshot`'s reason: the record is
what a selector hands a reader that already knows which conversation it asked about, so carrying the key
in the value would be a second copy to keep in agreement with the map key, and it would put a
daemon-asserted string inside the very object both DOM sinks render from. `ReadonlyMap` is **mandated
and `Record<string, …>` forbidden**, on [`conversationActivityStore`](conversation-activity-store.md)'s
rule: a `Record` swap produces no type error, so `__proto__`, `constructor` and `''` have to be exercised
as three unremarkable keys by a dedicated test rather than relied on by inspection.

Named setters rather than a reducer — the two mutations ("record the latest announcement" and, since
\#593, "clear when the pairing that scoped it ends") are independent whole-value writes that neither read
prior state nor constrain each other's ordering, so a discriminated-union action set would still be
ceremony without benefit. `setAnnouncedModel` replaces one conversation's record wholesale and touches no
other key: no merge, no coercion, no validation. Copy-on-write — clone the outer map, set the one key,
return a fresh state — and the map is read **inside** the `set` updater rather than through `getState()`
outside it, so two frames arriving back-to-back cannot interleave. Memory changed with #1146 from O(1) to
one entry per distinct `conversationId` seen since launch, each holding one bounded two-field record — a
flooding hostile relay now costs one bounded entry per distinct id rather than one allocation replacing
the same slot, the same posture `modelListStore`, `slashCommandListStore`, `conversationActivityStore`
and `queueStore` already ship. No eviction policy is built for a failure nobody has observed; the pairing
clear below returns the map to empty at every pairing change.

`clearAnnouncedModel` ([#593](../codebase/593.md)) returns the state to the exported
`initialAnnouncedModelState` — unconditional and sourced from that constant rather than a fresh literal,
so it keeps resetting everything if the state ever gains a second field, and so clearing an already-clear
store is a no-op by construction rather than by a guard. Since #1146 this is a **whole-map** clear rather
than a single-record reset — a pairing ending invalidates every conversation's announcement at once — but
it keeps its name and nullary signature rather than becoming `clearAllAnnouncedModels`: renaming would
churn the `ClearPairingScopedStateDeps` member, that helper's sorted-key pin and the `PairedShell` wiring
for nothing observable, so `clearPairingScopedState` and `PairedShell` are untouched by #1146. It
restores the absent-key not-yet-announced state, never a `{ model: '', truncated: false }` record under
some id — the one case that distinguishes the store's two sentinels (see above). It is invoked only by
[`clearPairingScopedState`](paired-shell.md), never two-way-bound from a component, and it never
branches on the held content: a clear gated on the identifier would let a hostile daemon craft a value
that survives a pairing switch and is then attributed to the next daemon. Returning
`initialAnnouncedModelState` **by reference** is what makes the copy-on-write write path load-bearing
rather than stylistic: an in-place mutator would poison that module-shared constant and hand one
pairing's announcements to the next, with no type error — pinned by a test.

### The data path (`src/renderer/src/store/announcedModelBridge.ts`)

Framework-free, effects injected (the `sessionIdBridge` / `screenSnapshotBridge` idiom), so the whole
path unit-tests with plain spies:

```ts
translateModelAnnounced(event: DaemonEvent): AnnouncedModelSnapshot | null
// modelAnnounced → { model: event.model, truncated: event.truncated, conversationId: event.conversationId }
// — a FRESH named-field literal, never `return event`, never a spread, so `type` never reaches the
// store. Every other event → null, including (critically) runConfigReceived, whose own `model: string`
// means the per-session OVERRIDE — the opposite value. (Through #621, snapshotReceived carried the same
// colliding field too.)

subscribeAnnouncedModel(onDaemonEvent, setAnnouncedModel): () => void
// onDaemonEvent(event => { const a = translateModelAnnounced(event); if (a !== null) setAnnouncedModel(a) })
// — `!== null`, not truthiness: `if (announced?.model)` would drop a reachable { model: '' }
// announcement AND its truncated report. Returns the off handle as cleanup (the sessionIdBridge idiom).
```

`conversationId` has ridden the `modelAnnounced` event since [#714](../codebase/714.md) — required, never
optional — but `translateModelAnnounced` dropped it on purpose from #588 through #1146: the event's
docblock in `events.ts` and `daemonConnection.ts` used to state that the id "stops at the announced-model
bridge." #1146 widened the fresh literal to carry it through as a third named field rather than switching
to a spread, so `type` still cannot reach the store. The id is carried verbatim — not normalised, not
allow-listed, not checked against the open conversation — because an id matching no selectable
conversation must be an explicit no-match downstream (`selectAnnouncedModelFor` returning `null` for
every reader that cannot select it), never a `?? activeConversation` fallback.

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
daemon system/init line → #587 transport decode → modelAnnounced{model, truncated, conversationId}
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge   (no-op, permanent)
                                └─ AnnouncedModelData (NEW, #588)
                                     → translateModelAnnounced → setAnnouncedModel
                                     → announcedModelStore     [keyed by conversationId since #1146 — most
                                                                 recent announcement wins PER KEY]

\#560: useAnnouncedModelStore(selectAnnouncedModelFor(conversationId)) → RunningModelSection, the sheet's
       sixth section
\#1053: useAnnouncedModelStore(selectAnnouncedModelFor(conversationId)) → ComposerModelMenu, the footer
        trigger's second layer
```

Both readers hold a `useMemo`-stable selector bound to the open `conversationId` — a fresh closure each
render would churn the subscription — mirroring the `selectModelListFor` line already beside each of
them. A `null` conversation selects nothing through the same path (`() => null`), with no invented key
and no second branch downstream.

## Configuration and usage

- **Import surface**, consumed by [#560](../codebase/560.md)'s `RunningModelSection` and, since #1053, by
  [Composer model menu](composer-model-menu.md)'s `ComposerModelMenu` container:
  `import { useAnnouncedModelStore, selectAnnouncedModelFor } from '@renderer/store/announcedModelStore'`.
  Both readers read the same singleton, bound to their own open `conversationId`, so a `null` vs.
  `{ model: '' }` distinction at this store still matters per conversation even though the footer control
  itself collapses both to "nothing at this layer" — see that document's `ComposerModelLayers` section.
- **Mount point:** `src/renderer/src/App.tsx`, `<AnnouncedModelData />` after `<BackgroundTaskRosterData />`.
- **Keyed by `conversationId`, since #1146.** At ship time `conversation_id` was dropped at the #587
  emit; [#714](../codebase/714.md) later widened the emit to carry it onward as `conversationId` (the
  last arm in the `turnState`/`stallDetected`/`apiRetry`/`compacting` widening family), but
  `translateModelAnnounced` still filtered it out through #1146, rebuilding a fresh `{ model, truncated }`
  literal with no id — so the store held one app-wide value replaced on each announcement, unkeyed by
  server or conversation. With two servers paired at once (#1117, #1084) that meant a conversation opened
  on server B could show server A's last-announced model until B's own first turn. #1146 widened the
  write to `AnnouncedModelSnapshot` and the state to `ReadonlyMap<string, AnnouncedModel>`, so each
  conversation reads back only its own announcement — see § How it works and § Edge cases.

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
  N writes and N fresh record identities, so a component selecting that conversation's announcement
  re-renders on a repeat too. Either reader memoises if that ever matters; this store does not pre-empt it.
- **`conversationId` is a daemon-asserted `Map` key — `ReadonlyMap` is mandated, `Record<string, …>` is
  forbidden, since #1146.** `conversationActivityStore`'s rule, applied here: `Map.prototype.get` and
  `.set` do no prototype-chain lookup, so `__proto__`, `constructor` and `''` are three unremarkable keys
  by construction. A `Record` swap type-checks cleanly and breaks no other assertion — only a **pre-write
  read** of a hostile key catches it: on a `Record`, reading `obj['__proto__']` before any write walks the
  prototype chain and returns `Object.prototype` rather than `undefined`, so `?? null` never fires and a
  reader is handed a truthy "announcement" with `model: undefined`. `announcedModelStore.test.ts`'s
  hostile-key cases read before writing for exactly this reason — a write-then-read pass alone would miss
  the regression entirely. The security review flagged this gap in the first drafted test plan and it was
  fixed before commit; see that spec for the surviving cases. The key itself stops at the map: never
  copied into a held record, never rendered, and never a filename, cache key, lookup path, attribute, URL,
  or log field.
- **Cleared on unpair, since #593 — and, since [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141), only on unpair.**
  The store is pairing-scoped — nothing on a fresh pairing re-asserts an announcement, the next one
  arrives only with the next turn's init line — so it is a member of
  [`clearPairingScopedState`](paired-shell.md)'s shared set rather than cleared at the call site. #588
  shipped the store without this (the deferral was harmless while the slice rendered nowhere); #560 made
  a stale value observable (the sheet would attribute server A's identifier, and its `truncated` cut
  report, to server B with no provenance marker); #593 closed it for both pairing-change paths that
  existed at the time. #1141 retired the pair-another-server call site — adding a server ends no pairing,
  so nothing else in the thirteen-store set may clear there — and doing so reopened #560's staleness for
  this one store, because at the time it alone (among the set) was a single app-wide slot rather than
  keyed by server or conversation: pairing server C while a server A conversation is open could leave the
  run-configuration sheet showing A's last-announced model until C's own first turn. **#1146 closed that
  by keying rather than by adding another clear site**: since the store is a `ReadonlyMap<string,
  AnnouncedModel>`, a record can only be read back under the conversation id it was announced for, so the
  stale-across-servers case is answered by construction rather than by timing a clear against a pairing
  transition. `clearAnnouncedModel` still exists and is unchanged in name, signature and caller — a
  pairing ending still invalidates every conversation's announcement at once, which is now a whole-map
  drop rather than a single-record reset — so AC4 of #1146 (no announcement survives the last-server
  unpair) is carried by the same wiring #593 built, with no edit to `clearPairingScopedState` or
  `PairedShell`. Display-only throughout — the *actionable* run-configuration write reads the
  per-conversation [`modelListStore`](model-list-store.md), which this staleness never touched.
  **Not** on the transport's `connected` edge — the mutually exclusive alternative mechanism
  `backgroundTaskRosterStore` uses — because a reconnect to the *same* daemon leaves every held
  announcement accurate; there is no re-handshake staleness case for this store the way there is for
  the task roster.
  A `modelAnnounced` frame already queued on the IPC channel when the clear runs still repopulates the
  map afterwards (`AnnouncedModelData` is an App-level sibling of `AppView`, so the unpair route flip does
  not unmount its listener) — the same window `sessionIdStore` documents and deliberately leaves alone.
  Keying made that window **strictly narrower**, not wider: the late record now lands under a departed
  pairing's conversation id, which nothing can select any more, instead of under the one slot every
  reader used to read.
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
  (`ScreenSnapshotState { snapshot: T | null }`) this store's held `AnnouncedModel` record followed
  through #1141, and another reactive-only, App-lifetime holder with no request half.
- [Model-list store](model-list-store.md) — the structural template #1146 applied verbatim: `ReadonlyMap`
  keyed by `conversationId`, a snapshot type carrying the key off the held entry (`ModelListSnapshot` /
  `AnnouncedModelSnapshot`), a `select…For(id)` selector factory returning the held entry itself, and the
  same two consumers reading both stores on adjacent lines.
- [Conversation-activity store](conversation-activity-store.md) — the header rule #1146 inherits
  verbatim: a daemon-asserted key is a `ReadonlyMap` key, never a `Record` key, and its hostile-key test
  triad (`__proto__`, `constructor`, `''`) is the pattern `announcedModelStore.test.ts` copies.
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
  the last arm in the transport-wide widening family; `translateModelAnnounced` filtered it out from
  ship through #1146, which is the ticket that finally widened the literal to carry it through.
- [Slash-command-list store](slash-command-list-store.md) — the closer structural read for its bridge
  half: one owned arm, one injected setter, no reset branch, no request half, App-level headless leaf,
  reused nearly verbatim from this store's `announcedModelBridge`.
- [#1146 architecture spec](../../specs/architecture/1146-scope-the-announced-model-store-by-conversation.md)
  — keyed the store by `conversationId`, closing the cross-server misattribution this section used to
  describe as an open bug.
