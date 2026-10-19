// The composer's submit logic — framework-free and React-free, co-located with the screen
// and mirroring pairingState.ts / messageViewModel.ts: the effects are injected so the helper
// is a pure, deterministic function tested with plain spies (no React, no store, no Electron).
// The React container (ConversationScreen's Composer) is thin glue over this.
import type { MessageLifecycleDiagnostic } from '@shared/ipc/diagnostics'
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'

export const COMPOSER_MESSAGE_DELIVERY_COPY = { waiting: 'Waiting for connection', 'not-sent': 'Not sent', 'not-delivered': 'Not delivered' } as const
import type { SendMessagePayload } from '@shared/wire/types'
import type { ConnectionStatus } from '../../store/sessionStore'
import type { MessageAttachment, ThreadEvent } from '../../store/threadTimeline'
import type { createThreadSendStore } from '../../store/threadSendStore'

// The daemon intercepts these tokens and only acks; no user_message will settle a local row.
const INTERCEPTED_RESET_COMMAND = /^\/(?:clear|reset)(?:\p{White_Space}|$)/u

/**
 * One send's claim on the composer's pending attachments (#1055): the set it took, and the undo that
 * puts them back. The two travel together so a caller cannot hold one without the other.
 *
 * DECLARED HERE, WITH THE CONSUMER, AND NOT BESIDE ITS PRODUCER — the module-level rule this repo
 * already follows for `RelayConnection`. `drainPendingAttachments` in ComposerAttach.tsx is what builds
 * one, but that is a `.tsx` module: importing the type FROM there would make this pure, React-free
 * helper name a React module, and a type-only import that is erased at build time is still an edge a
 * reader has to check. The edge runs the other way instead.
 */
export interface PendingAttachmentTake {
  /** The set this take claimed. Already removed from the composer's holder — reading it consumed it. */
  attachments: readonly MessageAttachment[]
  /** Undo this take, restoring exactly the set above. Called when the send did not go. */
  rollback: () => void
}

/** Captured send ownership and effects. Attachments are claimed only after the no-op guards. */
export interface ComposerSendDeps {
  serverId: string
  threadSend: { store: ReturnType<typeof createThreadSendStore>; deviceId: string | null; version?: number }
  diagnose?: (record: MessageLifecycleDiagnostic) => void
  sendCommand: (command: RendererCommand) => void
  newMessageId: () => string
  now?: () => number
  takeAttachments?: () => PendingAttachmentTake
}

/**
 * Retain ordinary unaccepted sends before the bridge, so synchronous feedback can find them.
 * Intercepted reset commands have no authoritative user item and need no local retention.
 * A bridge exception preserves recoverable text, marks local feedback and rolls attachments back.
 * Acceptance and exact host/device/message settlement belong to the authoritative send store.
 */
export function submitMessage(
  text: string,
  conversationId: string | null,
  deps: ComposerSendDeps
): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0 || conversationId === null) return false
  const threadSend = deps.threadSend, host = deps.serverId
  if (!host) return false
  const message_id = deps.newMessageId()
  const take = deps.takeAttachments?.()
  const named = take !== undefined && take.attachments.length > 0 ? take.attachments : undefined
  const payload: SendMessagePayload = {
    conversation_id: conversationId, message_id, text: trimmed,
    attachment_ids: named?.map(attachment => attachment.attachmentId)
  }
  const diagnose = (event: MessageLifecycleDiagnostic['event']): void => {
    try { deps.diagnose?.({ event, messageId: message_id, conversationId }) } catch { /* Observe only. */ }
  }
  diagnose('message-queued')
  if (!INTERCEPTED_RESET_COMMAND.test(trimmed)) {
    // Both identities exist before the bridge can synchronously report delivery.
    const echo: ThreadEvent = { type: 'userText', text: trimmed, messageId: message_id,
      createdAt: deps.now?.(), attachments: named }
    threadSend.store.getState().retain(host, conversationId, threadSend.deviceId, echo)
  }
  try {
    deps.sendCommand(sendMessageCommand(payload, deps.serverId))
    threadSend.store.getState().clearReports(host, conversationId, threadSend.version ?? 0)
    return true
  } catch {
    diagnose('message-bridge-failed')
    take?.rollback()
    const failed: ThreadEvent = { type: 'messageDelivery', messageId: message_id, status: 'not-sent' }
    threadSend.store.getState().feedback(host, conversationId, failed)
    return false
  }
}

/**
 * The three fields of a composer keydown that the submit decision reads. Plain values, no React —
 * the container destructures them off the synthetic event so this stays testable without a DOM.
 */
export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  /** `event.nativeEvent.isComposing` — true on every keydown fired while an IME composition is live. */
  isComposing: boolean
}

/**
 * Whether this keydown asks the composer to submit (#512). Enter sends; Shift+Enter inserts a newline;
 * and — the fix — the Enter that COMMITS an IME composition does neither. For a CJK user that commit
 * keydown is ordinary typing: it arrives with `key === 'Enter'` and `shiftKey === false`, so the old
 * handler sent the half-composed text and blanked the input mid-word.
 *
 * The caller must `return` on `false` BEFORE calling `preventDefault()`. Preventing the default on the
 * committing keydown breaks the IME commit itself — the candidate never lands and the user's text is
 * stranded — so "do not submit" has to mean "do not touch the event" too.
 *
 * `isComposing` is the standard signal and it is reliable on the committing keydown in Chromium, which
 * is the only renderer this app has (Electron ^33.2.1). Chromium also sets the legacy `keyCode === 229`
 * on the same event, but one signal identifies the composition; a second would be a defense for a
 * failure mode nobody has observed here.
 *
 * This deliberately does NOT absorb the `canSend` gate. That gate lives in the container's
 * `handleSubmit` and is authoritative for the send button as well as for Enter; #31's contract is that
 * a disconnected Enter is *swallowed* (prevented, nothing sent, input preserved), not turned into a
 * newline. This answers keystroke intent only.
 */
export function shouldSubmitOnKeyDown(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}

/**
 * Whether this keydown asks the composer to STOP the running turn (#1072). Escape while a turn is running
 * interrupts; Escape at idle does not; and the Escape that cancels an in-progress IME composition never
 * does. Placed here, directly after `shouldSubmitOnKeyDown`, because it reads the same axis — did this
 * keystroke ask for something — and the same record.
 *
 * IT REUSES `ComposerKeyEvent` RATHER THAN MINTING A SECOND RECORD. A near-duplicate interface would buy a
 * new exported type for one dropped field, and would give the container a second shape to destructure at a
 * call site that already builds this one. The two predicates share one destructure and answer two questions.
 *
 * `shiftKey` IS DELIBERATELY NOT READ, even though the record carries it. Escape has no meaningful shifted
 * variant, so a `!shiftKey` clause would be a defence for a failure mode nobody has observed — the same
 * evidence rule that kept the legacy `keyCode === 229` out of the predicate above. composerSend.test.ts pins
 * the non-read with a Shift+Escape case, so adding the clause "for symmetry" reddens rather than ships.
 *
 * `isComposing` IS LOAD-BEARING HERE, and it is not a mirror of the gate above for symmetry either. The
 * slash type-ahead's own handler returns `false` on a composing keystroke EVEN WHILE ITS PANEL IS OPEN
 * (`useSlashCommandTypeAhead`'s handleKeyDown), so the Escape that cancels a half-typed IME candidate falls
 * straight through to the composer's handler. Without this input a CJK operator cancelling a candidate
 * mid-turn would stop the turn.
 *
 * `turnRunning` is a SECOND POSITIONAL ARGUMENT rather than a field of the record, and the split is the
 * point: the record models the keystroke, this models the app's state. Folding them would make the container
 * fabricate a synthetic key-event field, and would make the stop control's call site — where the value is
 * `true` by construction, since that variant only renders while running — read as if the button knew
 * something about the keydown that it does not. It is `isTurnRunning(phase)` at both call sites and never
 * `localSendPending`: that scalar opens the working-indicator window while `phase` is still the daemon-owned
 * `idle` (#650), so wiring it in would arm an interrupt for a turn the daemon has not started — the same
 * reason the stop button ignores it.
 *
 * Like the gate above, this answers keystroke intent ONLY. It does not absorb the connection gate: a
 * running turn on a dropped connection must still offer the stop (ComposerSendButton's second load-bearing
 * property), and `sendInterrupt` already swallows a bridge failure. Unlike the gate above there is nothing
 * for the caller to suppress — Escape has no default action in a textarea — so no `preventDefault()` belongs
 * on this path at all; if one were ever added it would have to sit below a `false` return, the rule
 * `shouldSubmitOnKeyDown`'s docblock states.
 */
export function shouldInterruptOnKeyDown(event: ComposerKeyEvent, turnRunning: boolean): boolean {
  return turnRunning && event.key === 'Escape' && !event.isComposing
}

/**
 * Whether the composer may send (#31). #968 retired the "why" caption that used to travel beside it, so
 * this is a one-field record: the call site already destructures from it, and collapsing it to a bare
 * boolean would rewrite that site for no behavioural gain.
 */
export interface ComposerAvailability {
  canSend: boolean // true only when the session is connected
}

/** Compile-time exhaustiveness guard: a new ConnectionStatus arm without a case is a type error. */
function assertNever(status: never): never {
  throw new Error(`Unhandled connection status: ${JSON.stringify(status)}`)
}

/**
 * Total mapping over ConnectionStatus's four arms. Pure — no store, no React, no I/O — so the
 * send/no-send decision (AC1) is unit-testable without a DOM, the same reason submitMessage is pure.
 * This is a UX affordance, not a safety net: the deterministic no-throw safety on a disconnected send
 * already lives in #65's daemonConnection.send() and #66's guarded sendCommand — this only governs what
 * the composer shows.
 *
 * Since #968 it reads `status.type` and nothing else: the three captions it used to return are gone with
 * the element that rendered them, so no string leaves this function and `status.error` is never touched.
 * The exhaustive switch stays — a total mapping is still what this is, and a future fifth arm must be a
 * compile error here rather than a silently-sendable state.
 */
export function composerAvailability(status: ConnectionStatus): ComposerAvailability {
  switch (status.type) {
    case 'connected':
      return { canSend: true }
    case 'connecting':
      return { canSend: false }
    case 'disconnected':
      return { canSend: false }
    case 'error':
      return { canSend: false }
    default:
      return assertNever(status)
  }
}

/** The host's daemon lacks `thread` (#1908): its copy names the daemon, never this app. */
export function isDaemonUpdateRequired(status: ConnectionStatus | undefined): boolean {
  return status?.type === 'error' && status.error.code === 'update-required' && status.error.cause === 'daemon'
}

/** Client-owned copy for that state; no download link, since the app is not what needs updating. */
export const DAEMON_UPDATE_REQUIRED_COPY = 'The Pyrycode daemon on this host needs an update. Update pyry on the host to reconnect.'

/** Only an explicit pairing rejection establishes that re-pairing can help. */
export function shouldOfferRepair(status: ConnectionStatus): boolean {
  return status.type === 'error' && !status.error.retryable && status.error.code === 'pairing-rejected'
}

/** Other terminal failures can redial a saved host; failed removal and absent pairing cannot. */
export function shouldOfferReconnect(status: ConnectionStatus): boolean {
  return (
    status.type === 'error' && !status.error.retryable &&
    status.error.code !== 'pairing-rejected' &&
    status.error.code !== 'unpair' && status.error.code !== 'not-paired'
  )
}

/** Generic connection explanation, retained when the banner moved into the overlay. */
export const CONNECTION_BANNER_COPY =
  'Cannot reach pyrybox — your messages will not send until the connection is back.'

/** Client-owned explanation for the open host; error fields only select fixed copy. */
export function connectionNotice(status: ConnectionStatus): string | null {
  if (!shouldShowBanner(status)) return null
  return status.type === 'error' && status.error.code === 'pairing-rejected'
    ? 'Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.'
    : isDaemonUpdateRequired(status) ? DAEMON_UPDATE_REQUIRED_COPY : CONNECTION_BANNER_COPY
}

/** Every non-connected state needs the connection explanation. */
export function shouldShowBanner(status: ConnectionStatus): boolean {
  return status.type !== 'connected'
}

/** Client-owned visible and accessible label for the host repair action pill. */
export const COMPOSER_REPAIR_BUTTON_COPY = 'Pairing error - Re-pair'

/** Client-owned visible and accessible label; error fields never supply button content. */
export const COMPOSER_RECONNECT_BUTTON_COPY = 'Connection error - Reconnect'
