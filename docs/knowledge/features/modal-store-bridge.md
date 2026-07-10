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
before this ticket. [#248](../codebase/248.md) later added a third, still-dormant owned case here
(`modalAnswerRejected`) — see § Modal-answer rejection (dormant) below.

## What it does

Turns the two owned `DaemonEvent` modal arms into `ModalEvent`s and folds them into `ModalState` via
`reduceModal`, exposing `selectOutstanding` as the only read surface. A `modalShown`/`modalDismissed`
arrival re-renders only components selecting the outstanding slice — orthogonal to `sessionStore`,
`timelineStore`, and `runConfigStore`. Owns a third arm, `modalAnswerRejected` ([#248](../codebase/248.md)),
but that case is dormant — it returns `null`, no `ModalEvent`/reduce arm exists yet; see below.

## How it works

### The store (`src/renderer/src/store/modalStore.ts`)

```ts
export type ModalStore = ModalState & { dispatch: (event: ModalEvent) => void }

createModalStore(init?)      // vanilla createStore — one isolated instance per test (DI seam)
modalStore                    // app-wide singleton
useModalStore(selector)       // narrow-slice React binding: useStore(modalStore, selector)
export { selectOutstanding } from './modalPrompts'   // re-exported, never redefined
```

Mirrors `createTimelineStore`'s DI-factory → singleton → hook → selectors structure (ADR 0008/#202),
wrapping the real `reduceModal` reducer + `dispatch` — `set((s) => reduceModal(s, event))`. No
`observe?` param: the #134 diagnostics seam is session-only, and a speculative observer here would
defend an unobserved need (the same call #202 made for the timeline store).

### The translator + binding (`src/renderer/src/store/modalBridge.ts`)

```ts
translateModalEvent(event: DaemonEvent): ModalEvent | null
// Owns exactly modalShown / modalDismissed, each rebuilt as a fresh named-field literal (never
// `return event`, never a spread). Every other arm -> null via explicit fall-through,
// then default: assertNever(event) — a HARD guard, not a soft catch-all default.

subscribeModal(onDaemonEvent, dispatch): () => void
// onDaemonEvent(event => { const me = translateModalEvent(event); if (me) dispatch(me) })
// returns the exact off handle (the subscribeTimeline idiom) — pure, spy-testable, no React.

useModalBridge(): void
// useEffect(() => subscribeModal(window.pyry.onDaemonEvent, e => modalStore.getState().dispatch(e)), [])
// StrictMode double-mount (mount -> cleanup -> mount) nets exactly one live listener.
```

This is the **third** independent subscriber on the `onDaemonEvent` channel:
[`daemonEventBridge`](daemon-event-bridge.md) owns the session arms, [`timelineBridge`](conversation-timeline-store.md)
the interactive-stream arms, and this bridge owns exactly the two modal arms — all three are
independently `assertNever`-guarded over the full `DaemonEvent` union, so a future arm is a
compile error in all three files until each decides its mapping. [#229](../codebase/229.md) proved this
concretely: adding `toolResult` (the vertical's last transport arm) forced a seventh single-line no-op
case here, the first time a new arm's true touchpoint floor (wire + decode + emit + event + **three**
bridges) diverged from a spec written before this file existed as a third exhaustive subscriber — see
[#229 codebase notes](../codebase/229.md) § Lessons learned.

**The one detail that breaks the naive "clone `timelineBridge`" approach: the discriminant tag renames
across the boundary.** Every arm `timelineBridge` owns (`assistantDelta`, `turnEnd`, `turnState`,
`toolUse`) keeps an identical `type` tag on both the `DaemonEvent` and `ThreadEvent` sides. This
bridge's two owned arms do not: `modalShown` → `type: 'shown'`, `modalDismissed` → `type: 'dismissed'`.
Field **names** are unchanged (already camelCase, field-for-field identical — the snake→camel decode
happened at #201's transport), so the copy is still a filter, not a rename — just the tag itself
changes. The translator tests pin `translated.type === 'shown'`/`'dismissed'` specifically to catch a
blind clone carrying the wrong tag forward.

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
daemon frame ─(#201 transport, snake→camel, no conversation_id on a modal)→
   DaemonEvent{modalShown|modalDismissed}
   → window.pyry.onDaemonEvent (preload channel)
   → subscribeModal listener → translateModalEvent → ModalEvent (or null → skip)
   → modalStore.dispatch → reduceModal → ModalState
   → selectOutstanding   (read by #224's interactive render slice, not yet built)
```

## Configuration and usage

- **`useModalBridge()` is mounted at App level, in [#224](../codebase/224.md)** — beside
  `useDaemonEventBridge()`/`useTimelineBridge()` in `App.tsx`, the third independent subscriber on the
  channel, mirroring how #202 shipped `useTimelineBridge` before #203 mounted it. From #224 onward, a
  live `modalShown`/`modalDismissed` frame reaches `modalStore`, and [`PermissionModal`](conversation-shell.md#permission-modal-224)
  reads `selectOutstanding` to render it. Was gated behind the `interactive` capability flip in
  production through #178; live since [#179](../codebase/179.md).
- Import surface: `import { useModalStore, selectOutstanding } from '@renderer/store/modalStore'` and
  `import { useModalBridge } from '@renderer/store/modalBridge'`.
- No conversation-id scoping — a modal carries no `conversation_id` on the wire at all (ADR 0009); the
  bridge translates and dispatches unconditionally.

## Edge cases and limitations

- **`shown` for an already-outstanding `modalId` plain-appends (a duplicate entry), not a
  replace** — inherited unchanged from `reduceModal` (#122). Reconnect re-delivery idempotency is
  [#195](https://github.com/pyrycode/pyrycode-desktop/issues/195), layered on this store, out of scope
  here.
- **`dismissed` for an unknown/already-dismissed `modalId` is a same-reference no-op**, not a surfaced
  error — inherited from `reduceModal`; this store and bridge do not re-handle it.
- **`title`/`prompt`/`options[].label` are untrusted `claude` free text, carried opaquely.** Neither
  the store nor the bridge escapes or sanitizes them — [`PermissionModalView`](conversation-shell.md#permission-modal-224)
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

## Modal-answer rejection (dormant, [#248](../codebase/248.md))

`translateModalEvent` gained a third owned arm, `case 'modalAnswerRejected':`, kept as a **distinct**
case rather than folded into the anonymous null group below it — so ownership is visible even while
dormant. It returns `null` this slice: no `ModalEvent` variant, no `reduceModal` arm, no UI. The arm's
producer is a main-side FIFO correlation window in [daemon connection](daemon-connection.md) that
attributes a content-free daemon `error` to the `modal_id` it was answering (the wire `error` carries
none — ADR 0009). #249, the render slice, is what flips this case to translate a real `ModalEvent` and
add the corresponding `reduceModal` arm — the same shape [#223](../codebase/223.md) itself followed for
`modalShown`/`modalDismissed` relative to [#201](../codebase/201.md), and the same dormant-arm posture
`sessionTransition` ([#254](../codebase/254.md)) used ahead of its holder ([#259](../codebase/259.md)).

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
  no-op case alongside `toolResult`/`conversationCreated`; the real consumer is the not-yet-built
  renderer holder [#259](https://github.com/pyrycode/pyrycode-desktop/issues/259).
- [#179 codebase notes](../codebase/179.md) — flips `interactive` live, so `modal_shown`/`modal_dismissed`
  carry real daemon traffic through this bridge in production for the first time.
- [#248 codebase notes](../codebase/248.md) — adds the dormant third owned arm, `modalAnswerRejected`,
  and the main-side FIFO correlation window in [daemon connection](daemon-connection.md) that produces
  it (see § Modal-answer rejection above). Render slice is [#249](https://github.com/pyrycode/pyrycode-desktop/issues/249).
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` arm's dormant-arm-ahead-of-holder
  posture this ticket's `modalAnswerRejected` case follows.
