# Modal store + bridge

The renderer's read/write surface over the [modal-prompt model](modal-prompt-model.md): a dedicated,
unidirectional Zustand store wrapping the pure `reduceModal` reducer, plus a translator + React
binding that feeds it from the two `modalShown`/`modalDismissed` `DaemonEvent` arms. Together, the
store and bridge are what the interactive render slice
([#224](../codebase/224.md)) mounts and reads — the modal analog
of the [conversation timeline store](conversation-timeline-store.md).

Introduced in [#223](../codebase/223.md), the fourth slice of the modal vertical (ADR
[0009](../decisions/0009-modal-prompt-model.md)), blocked-by [#201](../codebase/201.md) (the
transport slice, shipped) and built directly on [#122](../codebase/122.md) (the pure model, shipped).
Purely additive, Strangler Fig: nothing in `daemonEventBridge.ts` or `timelineBridge.ts` imports or is
changed by either new file — both keep returning `null` for the two modal arms, exactly as they did
before this ticket. [#248](../codebase/248.md) later added a third owned case here
(`modalAnswerRejected`), shipped dormant; [#249](../codebase/249.md) flipped it live — see
§ Modal-answer rejection below.

## What it does

Turns the three owned `DaemonEvent` modal arms into `ModalEvent`s and folds them into `ModalState` via
`reduceModal`, exposing narrow subscriptions to the prompt queue, rejection feedback and transient
resolution feedback. `selectOutstanding` and `selectRejections` read their slices;
`TopOverlayControl` selects the held resolution object for the open chat directly. A dismissal can
change both outstanding prompts and resolution feedback, while each subscriber wakes only when its
selected value changes. These slices remain orthogonal to `sessionStore`, `timelineStore` and
`runConfigStore`.

## How it works

### The store (`src/renderer/src/store/modalStore.ts`)

```ts
export type ModalStore = ModalState & { dispatch: (event: ModalEvent) => void }

createModalStore(init?)      // vanilla createStore — one isolated instance per test (DI seam)
modalStore                    // app-wide singleton
useModalStore(selector)       // narrow-slice React binding: useStore(modalStore, selector)
export { selectOutstanding, selectRejections } from './modalPrompts'   // re-exported, never redefined
```

Mirrors `createTimelineStore`'s DI-factory → singleton → hook → selectors structure (ADR 0008/#202),
wrapping the real `reduceModal` reducer + `dispatch` — `set((s) => reduceModal(s, event))`. No
`observe?` param: the #134 diagnostics seam is session-only, and a speculative observer here would
defend an unobserved need (the same call #202 made for the timeline store).

### The translator + binding (`src/renderer/src/store/modalBridge.ts`)

```ts
originOf(event: DaemonEvent): ConversationListOrigin
// #1140 — reads #1068's client-bound stamp ONLY, never event.ack.server_id (the daemon's own value).
// A module-private copy of the relayLinkBridge/conversationListBridge/daemonEventBridge/queueBridge/
// backgroundTaskRosterBridge idiom — a SIXTH precedent — not an import, so this subscriber stays
// independent of theirs.

translateModalEvent(event: DaemonEvent, conversationIdsFor: (origin: ConversationListOrigin) => ReadonlySet<string>): ModalEvent | null
// Owns exactly modalShown / modalDismissed / modalAnswerRejected / connected, each rebuilt as a fresh
// named-field literal (never `return event` or spread the whole event). Every other arm -> null via explicit
// fall-through, then default: assertNever(event) — a HARD guard, not a soft catch-all default.
// `connected` returns { type: 'reconnected', conversationIds: conversationIdsFor(originOf(event)) } —
// conversationIdsFor is INJECTED (#1140), never read from a store here, so the translator stays a pure
// arm-to-value map drivable with a plain stub under this repo's node-environment renderer tests.

subscribeModal(onDaemonEvent, dispatch, conversationIdsFor): () => void
// onDaemonEvent(event => { const me = translateModalEvent(event, conversationIdsFor); if (me) dispatch(me) })
// returns the exact off handle (the subscribeTimeline idiom) — pure, spy-testable, STORE-FREE, no React.

useModalBridge(): void
// useEffect(() => subscribeModal(
//   window.pyry.onDaemonEvent,
//   e => modalStore.getState().dispatch(e),
//   origin => selectConversationIdsFor(origin)(conversationListStore.getState())   // #1140, event-time read
// ), [])
// StrictMode double-mount (mount -> cleanup -> mount) nets exactly one live listener.
```

This is the **third** independent subscriber on the `onDaemonEvent` channel:
[`daemonEventBridge`](daemon-event-bridge.md) owns the session arms, [`timelineBridge`](conversation-timeline-store.md)
the interactive-stream arms, and this bridge owns exactly the three modal arms — all three are
independently `assertNever`-guarded over the full `DaemonEvent` union, so a future arm is a
compile error in all three files until each decides its mapping. [#229](../codebase/229.md) proved this
concretely: adding `toolResult` (the vertical's last transport arm) forced a seventh single-line no-op
case here, the first time a new arm's true touchpoint floor (wire + decode + emit + event + **three**
bridges) diverged from a spec written before this file existed as a third exhaustive subscriber — see
[#229 codebase notes](../codebase/229.md) § Lessons learned.

**The one detail that breaks the naive "clone `timelineBridge`" approach: the discriminant tag renames
across the boundary.** Every arm `timelineBridge` owns (`assistantDelta`, `turnEnd`, `turnState`,
`toolUse`) keeps an identical `type` tag on both the `DaemonEvent` and `ThreadEvent` sides. This
bridge's owned arms do not: `modalShown` → `type: 'shown'`, `modalDismissed` → `type: 'dismissed'`,
`modalAnswerRejected` → `type: 'rejected'` ([#249](../codebase/249.md)). Field **names** are unchanged
(already camelCase, field-for-field identical — the snake→camel decode happened at #201's transport),
so the copy is still a filter, not a rename — just the tag itself changes. The translator tests pin
`translated.type === 'shown'`/`'dismissed'`/`'rejected'` specifically to catch a blind clone carrying
the wrong tag forward.

Optional `reason`, `reasonType`, `blockedPath`, `description` and `defaultToNo` also pass by name,
only when present. The IPC contract alone does not deliver them: both this translator and
[`reduceModal`](modal-prompt-model.md#types) reconstruct the prompt. Keep `null`, `false` and `0`
intact and leave omitted fields absent instead of manufacturing own `undefined` properties.
Bridge tests check property presence as well as values. The
[permission panel](conversation-shell-permission-modal.md#presentation) narrows reason JSON for
escaped display and applies the focus hint; none of this context supplies answer authority.

### No cast

The fresh-literal copy compiles clean with no `as` (the codebase bans unchecked `as` in prod, #121
rework) because the owned `DaemonEvent` arm field types are structurally equal to the `ModalEvent`
field types: `class: WireModalClass` → `ModalClass`, `source: WireModalSource` → the inline
`'remote' | 'local' | 'timeout'` union, `options: readonly WireModalOption[]` → `readonly
ModalOption[]`. `options` passes through **by reference** in the fresh `shown` literal, matching
`reduceModal`'s `shown` arm and `translateTimelineEvent`'s `toolUse` copy — neither deep-clones nested
fields.

### Data flow

```
daemon frame ─(#201/#248 transport, snake→camel; `modal_shown`'s `conversation_id` rides the
   DaemonEvent as of #871 (decoded #870), and as of #877 this bridge copies it by name onto
   ModalEvent's `shown` arm)→
   DaemonEvent{modalShown|modalDismissed|modalAnswerRejected}
   → window.pyry.onDaemonEvent (preload channel)
   → subscribeModal listener → translateModalEvent → ModalEvent (or null → skip)
   → modalStore.dispatch → reduceModal → ModalState
   → selectOutstanding (the prompt queue) / selectRejections (the rejection surface, #249)
   → both read by PermissionModal (#224 prompt render, #249 rejection render)
   → resolutions.find(r => r.conversationId === open.id) → TopOverlayControl → TopOverlay
```

## Configuration and usage

- **`useModalBridge()` is mounted at App level, in [#224](../codebase/224.md)** — beside
  `useDaemonEventBridge()`/`useTimelineBridge()` in `App.tsx`, the third independent subscriber on the
  channel, mirroring how #202 shipped `useTimelineBridge` before #203 mounted it. From #224 onward, a
  live `modalShown`/`modalDismissed` frame reaches `modalStore`, and [`PermissionModal`](conversation-shell-permission-modal.md#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511)
  reads `selectOutstanding` to render it. Was gated behind the `interactive` capability flip in
  production through #178; live since [#179](../codebase/179.md).
- Import surface: `import { useModalStore, selectOutstanding, selectRejections } from
  '@renderer/store/modalStore'` and `import { useModalBridge } from '@renderer/store/modalBridge'`.
- **The `connected` → `reconnected` mapping is scoped to the reconnecting server
  ([#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)).** Since
  [#1117](daemon-connection-routing.md) the background process holds one live connection per paired
  server, so `connected` no longer means "the app's one connection came back." `translateModalEvent`
  reads the origin off `event`'s `serverId` stamp (never `event.ack.server_id`, the daemon's own value)
  via a module-private `originOf`, and the injected `conversationIdsFor` resolves it to that server's
  conversation ids through #1138's shared `selectConversationIdsFor`. The list read happens inside
  `useModalBridge`'s effect, at event time, not at subscribe time — see [modal-prompt
  model](modal-prompt-model.md) for what the reducer does with the set.
- **Conversation-id scoping now reaches the store, but not this bridge's own surface.** `modal_shown`
  carries a `conversation_id` on the wire ([pyrycode#1065](https://github.com/pyrycode/pyrycode/issues/1065)),
  decoded onto the `DaemonEvent` arm ([#871](../codebase/871.md), decoded [#870](../codebase/870.md)),
  copied by name onto `ModalEvent`'s `shown` arm by `translateModalEvent` ([#877](../codebase/877.md)),
  and — as of [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) — copied by name a hop
  further onto the held `ModalPrompt`, where `selectHasOutstandingFor(conversationId)` reads it. This
  module (`translateModalEvent`/`subscribeModal`) is untouched by #878: it still translates and
  dispatches unconditionally, since the scoping decision lives one layer down in `reduceModal`. See
  [modal-prompt model](modal-prompt-model.md) for the current shape. `modal_dismissed` still carries no
  `conversation_id` at all (ADR 0009 stands for that frame).

## Edge cases and limitations

- **`shown` for an already-outstanding `modalId` now replaces in place, and a `shown` for an
  already-resolved `modalId` is a no-op** — [#195](../codebase/195.md) made `reduceModal`'s `shown`
  arm idempotent on `modalId`, the client half of the daemon's reconcile-on-connect contract. This
  bridge itself needed no change: `translateModalEvent`'s `modalShown → shown` tag-rename is invisible
  to the reducer's internal id-tracking.
- **`dismissed` for an unknown/already-dismissed `modalId` is a same-reference no-op**, not a surfaced
  error — inherited from `reduceModal`; this store and bridge do not re-handle it.
- **`title`/`prompt`/`options[].label` are untrusted `claude` free text, carried opaquely.** Neither
  the store nor the bridge escapes or sanitizes them — [`PermissionModalView`](conversation-shell-permission-modal.md#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511)
  (#224) renders them as plain React children, never HTML, the same discipline `assistant_delta`/#203
  and `tool_use`/#218 already established.
- **No dedicated test for `useModalBridge`.** A bare hook is untestable without a React renderer (none
  in this repo), exactly as `useDaemonEventBridge` and `useTimelineBridge` have none — its behavior is
  fully carried by the pure `subscribeModal` tests. See [#202 codebase notes](../codebase/202.md) §
  Lessons learned for the precedent.
- **Zero live traffic through #178.** Desktop withheld the `interactive` capability until
  [#179](../codebase/179.md), so no `modal_shown`/`modal_dismissed` frame reached this bridge in
  production before then — the store and bridge were built and tested against injected `DaemonEvent`s
  only. Now live.

## Choice and consent lifetime

The app-wide store retains requests and feedback across chat navigation; permission arming belongs
to the mounted pane and clears on navigation. Checked consent lives beside the permission consumer
in app-lifetime renderer memory, observing this store and unique conversation ownership even while
the pane is closed. The
[choice controller](conversation-shell-permission-modal.md#selection-and-confirmation) subscribes
synchronously to this store plus active conversation, conversation list and session stores, observing
interrupted offers and ownership even when React paints only the restored state. The reducer's
[continuous choice/offer identities](modal-prompt-model.md#continuous-choice-and-offer-identity)
include ordered option IDs/labels, supplied default, class, eligibility and ordered rules.

Scoped reconnect removes the owning server's held request before re-delivery, discarding its draft;
pairing reset discards all requests/drafts. Fresh answer, checkbox and Cancel handlers require the
exact displayed request in the active chat and the same stamped host captured by the callback,
still uniquely owning that chat and connected. Another connected
host is never a fallback. Construction/subscription reads perform no diagnostic IPC; action paths
retain content-free diagnostics. Inline placement retains valid checked grants across navigation;
request/offer/owner interruptions evict them synchronously before a restored render can revive them.
The bridge, response envelopes and daemon remote-permission authority are unchanged.

## Permission resolution feedback

The bridge already forwards `modalDismissed` source; no new wire or IPC behavior is needed.
`reduceModal` first finds the held prompt, copies its chat owner and selects only `remote` or
`timeout` feedback. Unknown/already-removed IDs, local answers/cancels and later daemon
acknowledgements create no notice. The local-only `resolutionDisplayed` and `resolutionDismissed`
events come from `TopOverlayControl`, never this translator.

The [Top overlay](conversation-shell.md#permission-resolution-notices) places a Default pill between
usage and Re-pair: exactly “Resolved on another device” or “Request timed out”, with an X named
“Dismiss permission resolution notice”. Only the latest notice per chat waits for that chat to
open. On display it gets four seconds; X, expiry or navigation consumes it, so returning cannot
replay it. A replacement gets a fresh display deadline even when its copy is unchanged. Lifecycle
events carry the held object, so an old timer or effect cleanup cannot remove a replacement.

Feedback belongs to `resolutions`, independent of reconnect-scoped `resolved` duplicate suppression.
Reconnect preserves pending/displayed notices and never manufactures one by clearing a prompt;
pairing `reset` clears both phases. Keeping feedback only in component state would lose closed-chat
delivery and bypass the pairing boundary. See the [model contract](modal-prompt-model.md#the-reducer)
and [verification coverage](development-verification.md#what-each-test-tier-proves).

## Modal-answer rejection ([#248](../codebase/248.md) transport, [#249](../codebase/249.md) render)

`translateModalEvent` gained a third owned arm, `case 'modalAnswerRejected':`, kept as a **distinct**
case by [#248](../codebase/248.md) rather than folded into the anonymous null group below it — so
ownership was visible even while dormant. [#249](../codebase/249.md) flipped it: the case now returns
`{ type: 'rejected', modalId: event.modalId }`, a fresh named-field literal matching the
`modalShown`/`modalDismissed` reconstruction — content-free by construction, only the correlation nonce
crosses. The arm's producer is a main-side FIFO correlation window in
[daemon connection](daemon-connection.md) that attributes a content-free daemon `error` to the
`modal_id` it was answering (the wire `error` carries none — ADR 0009). This is the same shape
[#223](../codebase/223.md) itself followed for `modalShown`/`modalDismissed` relative to
[#201](../codebase/201.md), and the same dormant-arm-ahead-of-its-consumer posture `sessionTransition`
([#254](../codebase/254.md)) used ahead of its holder ([#259](../codebase/259.md)).

The translated `rejected` event feeds a new, `outstanding`-orthogonal `ModalState.rejections: readonly
string[]` slice — arrival-ordered, de-duplicated `modalId`s — reduced by two new `ModalEvent` arms,
`rejected` (append, dedup) and the local-only `rejectionDismissed` (remove, dispatched by the user
clicking a dismiss control, never by the bridge). The reducer also records known conversation ownership
in `rejectionOwners`, copied from outstanding/resolved records when rejection arrives. That ownership
survives reconnect with its feedback, independently of resolved-prompt suppression.
[`PermissionModal`](conversation-shell-permission-modal.md#rejection-surface-249) filters the IDs by
the open chat before passing them to `RejectionSurfaceView`. Banners occupy normal flow above the
input area and never cover the composer or questionnaire. The bridge's content-free event remains
unchanged; see [Modal-prompt model](modal-prompt-model.md) for the reducer contract.

## Related

- [Modal-prompt model](modal-prompt-model.md) / [#122 codebase notes](../codebase/122.md) — the pure
  `reduceModal`/`ModalEvent`/`ModalState`/`selectOutstanding` this store wraps verbatim.
- [#201 codebase notes](../codebase/201.md) — the transport slice: wire types, decode, and the
  `modalShown`/`modalDismissed` `DaemonEvent` arms this bridge consumes.
- [#223 codebase notes](../codebase/223.md) — implementation summary and patterns established.
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the sibling bridge that also nulls the
  two modal arms, for exhaustiveness only; the session store never consumes a modal.
- [Conversation timeline store](conversation-timeline-store.md) — the direct structural precedent this
  store + bridge clones (DI-factory → singleton → hook, translate/subscribe/hook shape), and the
  second bridge that also nulls the two modal arms (its inverse-filter list, not its owned block).
- [#229 codebase notes](../codebase/229.md) — the ticket that added `toolResult`, forcing this bridge's
  seventh no-op case and demonstrating that a new `DaemonEvent` arm's touchpoint floor now includes all
  three exhaustive bridges, not two.
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — the normative reducer
  contract this store wraps without altering; reserves the `modalStore.ts` name for exactly this
  container.
- [#224 codebase notes](../codebase/224.md) — the interactive render slice: mounts `useModalBridge`,
  reads `selectOutstanding` via the new `PermissionModal`/`PermissionModalView`. Unblocks #225 (answer
  path) and #226/#227 (destructive second-confirm / surface rejection).
- [Conversation create](conversation-create.md) / [#241 codebase notes](../codebase/241.md) — the
  `conversationCreated` arm that folds into this bridge's no-op case alongside `toolResult`; the real
  consumer is the render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242).
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` arm that folds into this bridge's
  no-op case alongside `toolResult`/`conversationCreated`; the real consumer is the [session-id
  store](session-id-store.md) ([#259](../codebase/259.md), shipped).
- [Session settings send](session-settings-send.md) / [#264 codebase notes](../codebase/264.md) — the
  `sessionSettingsUpdated`/`sessionSettingsRejected` arms that fold into this bridge's no-op case
  alongside `sessionTransition`; the real consumer is the [Run configuration write
  store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped).
- [#179 codebase notes](../codebase/179.md) — flips `interactive` live, so `modal_shown`/`modal_dismissed`
  carry real daemon traffic through this bridge in production for the first time.
- [#248 codebase notes](../codebase/248.md) — adds the third owned arm, `modalAnswerRejected`, shipped
  dormant, and the main-side FIFO correlation window in [daemon connection](daemon-connection.md) that
  produces it (see § Modal-answer rejection above).
- [#249 codebase notes](../codebase/249.md) — flips the dormant `modalAnswerRejected` case live, adds the
  `rejected`/`rejectionDismissed` `ModalEvent` arms and the `rejections` slice, and renders the surface
  at the modal host (see § Modal-answer rejection above).
- [#195 codebase notes](../codebase/195.md) — makes `reduceModal`'s `shown` arm idempotent on `modalId`
  (match-and-replace + resolved-id no-op), consumed by this bridge and store unchanged.
- [#416 codebase notes](../codebase/416.md) — proves the `reconnected` reset ([#415](../codebase/415.md))
  against a **genuine** reconnect: a `modalBridge.test.ts` case runs the real `subscribeModal` over the
  exact ordered `connected`/`modalShown` sequence a mid-session relay drop + real supervisor re-dial
  produces (via the [reconnect-capable fake harness](fake-daemon.md#reconnect-capability-416)), asserting
  `selectOutstanding` clears then repopulates exactly once. No production code in this file changed.
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` arm's dormant-arm-ahead-of-holder
  posture `modalAnswerRejected` followed until #249.
- [#877 codebase notes](../codebase/877.md) — carries `conversation_id` the last hop onto `ModalEvent`'s
  `shown` arm; `translateModalEvent` copies it by name into the existing fresh literal. No new case, no
  new arm — this bridge's shape is otherwise unchanged.
- [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) · Spec:
  `docs/specs/architecture/1140-scoped-modal-reconnect-clear.md` — scopes the `connected` → `reconnected`
  mapping to the reconnecting server (new `originOf`, injected `conversationIdsFor`), the sixth precedent
  for the module-private-`originOf` idiom this bridge's siblings established. Kept the translator-arm
  shape rather than moving to a pre-translator branch (the `queueBridge`/`backgroundTaskRosterBridge`
  posture) precisely because this translator returns an *action union* member, where a payload addition
  costs no widening — see [modal-prompt model](modal-prompt-model.md) for the reducer side (the scoped
  `reconnected` clear and the new pairing-boundary `reset` arm) and
  [`clearPairingScopedState`](paired-shell.md#related) for the pairing-boundary dispatch this ticket also
  wires in.
- [Question-batch model](question-batch-model.md) § The bridge — the question vertical's clone of this
  file's shape ([#900](https://github.com/pyrycode/pyrycode-desktop/issues/900), a fourth independent
  subscriber on the same channel), diverging in one place: the question family rebuilds each row
  (`multi_select` → `multiSelect`) rather than only filtering, since its wire fields aren't already
  camelCase field-for-field the way this bridge's are.
- [Daemon event channel — the sealed union: per-member history (recent members)](daemon-event-channel-sealed-union-history-recent.md)
  — the `thinkingProgress` arm ([#1313](https://github.com/pyrycode/pyrycode-desktop/issues/1313),
  decoded at [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)) that folds into this
  bridge's no-op group. **Permanently**, not dormant: nothing daemon-side is waiting on an answer and
  there is no `modal_id` to resolve a mid-turn reading against, so this store will never claim it.
- [Daemon event channel — the sealed union: per-member history (recent members)](daemon-event-channel-sealed-union-history-recent.md)
  — the `rateLimited` arm ([#1319](https://github.com/pyrycode/pyrycode-desktop/issues/1319), decoded at
  [#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318)) that folds into this bridge's no-op
  group beside its `thinkingProgress` neighbour. **Permanently**, on the same grounds sharpened: nothing
  daemon-side is waiting on an answer, there is no `modal_id`, and a report about the account's usage
  window gates no action claude wants to take — routing it through this store would hand a quota report
  a permission prompt's one-shot `modal_answer` resolution semantics, which nothing on the wire can
  settle.
- [Daemon event channel — the sealed union: per-member history (recent members)](daemon-event-channel-sealed-union-history-recent.md)
  — the `resetting` arm ([#1515](https://github.com/pyrycode/pyrycode-desktop/issues/1515), decoded at
  [#1514](https://github.com/pyrycode/pyrycode-desktop/issues/1514)) that folds into this bridge's no-op
  group. **Permanently**, and it is the one member of the group with a rising and a falling edge rather
  than a reading — the grounds still hold and are if anything plainer: nothing daemon-side is waiting on
  an answer, there is no `modal_id`, and the frame reports what the daemon is doing to a session rather
  than gating an action claude wants to take, the opposite direction from a permission prompt. Its
  consumers are the [#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516) channel-list dot and
  the [#1517](https://github.com/pyrycode/pyrycode-desktop/issues/1517) composer status row, neither of
  which is this store.
- [Daemon event channel — the sealed union: per-member history (recent members)](daemon-event-channel-sealed-union-history-recent.md)
  — the `attachmentOffered` arm ([#1620](https://github.com/pyrycode/pyrycode-desktop/issues/1620),
  decoded at [#1619](https://github.com/pyrycode/pyrycode-desktop/issues/1619)) that folds into this
  bridge's no-op group. **Permanently**, the plainest grounds in the group: nothing daemon-side is
  waiting on an answer and there is no `modal_id` to resolve an offered file against. Unlike its
  `resetting` neighbour, its fourth bridge case is not also permanent — `timelineBridge` claimed the arm
  as [an owned case](conversation-shell-message-bubble-attachments.md#the-assistant-offered-file-row-1621)
  in [#1621](https://github.com/pyrycode/pyrycode-desktop/issues/1621), drawing the assistant's offered
  file as a thread row.
