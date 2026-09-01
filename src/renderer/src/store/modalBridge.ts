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
        conversationId: event.conversationId,
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
      // #249 flips the dormant #248 case: a fresh named-field literal (never `return event`, matching
      // modalShown/modalDismissed above) so the translator stays immune to the DaemonEvent arm gaining
      // an unrelated field later. The discriminant is renamed across the boundary: modalAnswerRejected
      // → 'rejected'. Content-free by construction — only the correlation nonce crosses (AC3).
      return { type: 'rejected', modalId: event.modalId }
    case 'connected':
      // #415: every supervisor (re)handshake re-emits `connected`. Flip it to the payload-free reset that
      // clears the outstanding modal slice so the daemon's connect-time re-sends are the sole repopulation
      // truth. Ignores `event.ack` (HelloAckPayload) — the reset needs no field off it.
      return { type: 'reconnected' }
    case 'connecting':
    case 'disconnected':
    case 'failed':
    case 'messageReceived':
    case 'messagesReceived':
    case 'debugBundleProgress':
    case 'debugBundleSaved':
    case 'debugBundleFailed':
    case 'assistantDelta':
    case 'turnEnd':
    case 'turnState':
    case 'toolUse':
    case 'toolResult':
    case 'conversationsReceived':
    case 'conversationCreated':
    case 'conversationUpdated':
    case 'conversationDeleted':
    case 'recentWorkspacesReceived':
    case 'workspaceFolderCreated':
    case 'workspaceFolderRejected':
    case 'sessionTransition':
    case 'sessionSettingsUpdated':
    case 'sessionSettingsRejected':
    case 'queueState':
    case 'stallDetected':
    case 'relayLinkChanged':
    case 'notificationActivated':
    case 'apiRetry':
    case 'compacting':
    case 'unrecognizedMessage':
    case 'backgroundTaskStarted':
    case 'backgroundTaskUpdated':
    case 'backgroundTaskRoster':
    case 'modelAnnounced':
    case 'questionShown':
    case 'questionDismissed':
      // No modal event: the session store (#19), download UI (#72), conversation-list store (#208),
      // timeline store (#202), create render slice (#242), the #259 session-id holder, the #261 /
      // #256 session-settings consumers (confirmed + rejected #269), the #293 queue store
      // (queueState), the #317 stall-render slice (stallDetected), the #329 relay-link store
      // (relayLinkChanged), the #376 list-reflect slice (conversationDeleted), the #382
      // recent-workspaces store (recentWorkspacesReceived), the #157 Create-folder dialog
      // (workspaceFolderCreated), the #397 round-trip store (workspaceFolderRejected), and the #393
      // notificationActivatedBridge (notificationActivated → the paired `open` nav) consume these —
      // not the modal store. apiRetry (#492) ships dormant; its render consumer is #493 — a retry
      // status line is not a modal.
      // compacting (#495) ships dormant likewise; its render consumer is #496 — a compaction banner is
      // not a modal either. unrecognizedMessage ships dormant too; its render consumer is the timeline
      // row — a diagnostic the operator reads at leisure is emphatically not a modal, since nothing is
      // waiting on an answer. backgroundTaskStarted (#564) ships dormant likewise; its consumer is the
      // #567 background-task store — a task claude left running is not a modal either, for the same
      // reason: nothing is waiting on an answer. backgroundTaskUpdated (#565) joins it on both counts:
      // same dormant #567 consumer, and a change to a task claude left running is no more a modal than
      // its opening was. backgroundTaskRoster (#566) closes the family on the same terms: same dormant
      // #567 consumer, and a snapshot of what claude left running is not a modal either — nothing is
      // waiting on an answer, not even when the roster is empty. modelAnnounced (#587) ships dormant on
      // the same terms; its consumer is the #588 announced-model store — an identity report about the
      // turn claude is running is not a modal, since nothing is waiting on an answer.
      // questionShown (#885) is the one arm in this group where something IS waiting on an answer, so
      // it needs the distinction the others do not: a modal is a PERMISSION PROMPT gating an action
      // claude wants to take, resolved by `modal_answer` against `modal_id`, whereas a question batch
      // is claude asking the operator to CHOOSE — its own `question_batch_id` nonce, its own
      // outstanding-batch state daemon-side, its own stepped panel with header tabs, and as yet no
      // answer frame in the contract at all. Routing it through this store would give it a modal's
      // one-shot resolution semantics, which is exactly wrong. Its consumer is the #850 question store
      // plus a dedicated bridge — a FOURTH INDEPENDENT SUBSCRIBER — so this no-op is PERMANENT, not
      // dormant: unlike `connected`, which #538 flipped to a `reconnected` reset above, this case can
      // never become an owned arm here.
      // questionDismissed (#895) is the frame that ENDS that waiting, and it routes nowhere near this
      // store either — which is the whole point, since a dismissal is the one arm a reader is most
      // tempted to hand to the modal store on the strength of its `modalDismissed` twin. The two are
      // not the same resolution: `modalDismissed` retires a permission prompt against `modal_id` under
      // first-answer-wins, while this retires a question batch against its own nonce, and the daemon
      // contract has no question-answer frame at all yet. Its no-op is PERMANENT on the same #850
      // grounds as its sibling.
      return null
    case 'runConfigReceived':
      // Not a modal event (#491). Present only because the assertNever guard makes a new arm a
      // compile error.
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
