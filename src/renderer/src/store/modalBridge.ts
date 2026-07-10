// The renderer translation half feeding the modal store: it turns the two modal daemon events (#201)
// into the matching `ModalEvent`s (#122) and dispatches them into the app-singleton `modalStore` the
// interactive render slice (#224) reads. `translateModalEvent` is the pure choke point;
// `useModalBridge` is its only production caller, wiring the channel into React's lifecycle. Nothing
// here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload
// bridge and dispatches typed events.
//
// A third independent subscriber on the same channel: `daemonEventBridge` owns the session arms and
// `timelineBridge` the stream arms, each returning `null` for the two modal arms; this one owns
// exactly those two modal arms and returns `null` for everything else.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { modalStore } from './modalStore'
import type { ModalEvent } from './modalPrompts'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Map one typed daemon event to the `ModalEvent` it produces, or `null` when the event drives no
 * modal state. Owns exactly the two modal arms (`modalShown` / `modalDismissed`, #201); each is
 * reconstructed as a fresh literal with named fields — not `return event`, not a spread — so the
 * translator stays immune to a `DaemonEvent` arm gaining an unrelated field later.
 *
 * This is a filter, NOT a rename of fields: the field names are already camelCase and field-for-field
 * identical on both sides (the snake→camel decode is #201's, at the transport). The one thing that
 * changes across the boundary is the discriminant TAG — `modalShown` → `type: 'shown'`,
 * `modalDismissed` → `type: 'dismissed'` — unlike `translateTimelineEvent`, where the tag is identical
 * on both sides. Field types are structurally equal (`class: WireModalClass` → `ModalClass`,
 * `source: WireModalSource` → the inline union, `options: readonly WireModalOption[]` →
 * `readonly ModalOption[]`), so the copy compiles clean with no cast (the codebase bans unchecked
 * `as` in prod, #121). `options` passes through by reference, matching `reduceModal`'s `shown` arm.
 *
 * Every other arm returns `null` via explicit fall-through cases, then `assertNever` — deliberately
 * NOT a catch-all `default: return null`, which would silently swallow a future arm. The guard is
 * load-bearing: a new `DaemonEvent` arm is then a compile error in this bridge, `daemonEventBridge`,
 * and `timelineBridge` until each decides its mapping.
 */
export function translateModalEvent(event: DaemonEvent): ModalEvent | null {
  switch (event.type) {
    case 'modalShown':
      return {
        type: 'shown',
        modalId: event.modalId,
        class: event.class,
        title: event.title,
        prompt: event.prompt,
        options: event.options,
        defaultOptionId: event.defaultOptionId
      }
    case 'modalDismissed':
      return { type: 'dismissed', modalId: event.modalId, outcome: event.outcome, source: event.source }
    case 'modalAnswerRejected':
      // Owned here — the render slice (#249) flips this to translate a rejection ModalEvent. Dormant
      // this slice: returns null (no ModalEvent, no reduce arm added), so the arm renders nothing —
      // matching how sessionTransition (#254) added the arm + bridge cases while its consumer waited.
      // Kept a DISTINCT case (not lumped into the null group below) so this bridge's ownership is
      // visible: #248 is transport-only, #249 lands the ModalEvent + reduce arm + UI here.
      return null
    case 'connecting':
    case 'connected':
    case 'disconnected':
    case 'failed':
    case 'messageReceived':
    case 'messagesReceived':
    case 'debugBundleProgress':
    case 'debugBundleSaved':
    case 'debugBundleFailed':
    case 'snapshotReceived':
    case 'assistantDelta':
    case 'turnEnd':
    case 'turnState':
    case 'toolUse':
    case 'toolResult':
    case 'conversationsReceived':
    case 'conversationCreated':
    case 'sessionTransition':
      // No modal event: the session store (#19), download UI (#72), Run configuration bridge (#181),
      // conversation-list store (#208), timeline store (#202), create render slice (#242), and the #259
      // session-id holder consume these — not the modal store.
      return null
    default:
      return assertNever(event)
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned arm translates to a `ModalEvent` and is
 * dispatched, every other arm no-ops. Returns the exact unsubscribe handle from `onDaemonEvent` (the
 * `subscribeTimeline` idiom) so the React binding can use it as its effect cleanup. Injecting
 * `onDaemonEvent` + `dispatch` keeps it React-free and unit-testable with plain spies. The listener
 * only translates + dispatches — it never throws into React.
 */
export function subscribeModal(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: ModalEvent) => void
): () => void {
  return onDaemonEvent((event) => {
    const modalEvent = translateModalEvent(event)
    if (modalEvent) dispatch(modalEvent)
  })
}

/**
 * Wire the daemon-event channel into the app-singleton modal store for the lifetime of the mounting
 * component (#224 mounts it). Subscribes on mount and returns `subscribeModal`'s off handle as the
 * effect cleanup, so a StrictMode double-mount runs mount → cleanup → mount and nets exactly one live
 * listener — mirroring `useTimelineBridge`. `window.pyry` is dereferenced only inside the effect,
 * never during render.
 */
export function useModalBridge(): void {
  useEffect(
    () => subscribeModal(window.pyry.onDaemonEvent, (event) => modalStore.getState().dispatch(event)),
    []
  )
}
