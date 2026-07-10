// The composer's submit logic — framework-free and React-free, co-located with the screen
// and mirroring pairingState.ts / messageViewModel.ts: the effects are injected so the helper
// is a pure, deterministic function tested with plain spies (no React, no store, no Electron).
// The React container (ConversationScreen's Composer) is thin glue over this.
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { SendMessagePayload } from '@shared/wire/types'
import type { ConnectionStatus } from '../../store/sessionStore'
import type { ThreadEvent } from '../../store/threadTimeline'

/**
 * The single active conversation for this milestone. There is no conversation-selection surface
 * yet (the message list is empty until the first message; HelloAckPayload carries no conversation
 * id), so a stable constant is the correct source. This is the one place a future
 * conversation-selection ticket replaces. The daemon treats `conversation_id` as opaque and echoes
 * back whatever it is sent.
 */
export const MILESTONE_CONVERSATION_ID = 'default'

/**
 * The three effects submitMessage performs, injected so the helper stays pure and deterministic in
 * tests. `newMessageId` is `crypto.randomUUID()` in the container; tests inject a stub. `dispatch`
 * writes a `ThreadEvent` into `timelineStore` (#179): the user's message and the daemon's structured
 * reply now share the one ordered timeline surface.
 */
export interface ComposerSendDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: ThreadEvent) => void
  newMessageId: () => string
}

/**
 * Submit the composer's current text. Returns `true` when a message was sent (the container clears
 * the input on `true`), `false` for whitespace-only input (no effect).
 *
 * The `message_id` is minted for the WIRE command only. The old "reuse the id for wire + echo so the
 * daemon's re-echo dedupes" rationale is retired (#179): in interactive mode the daemon streams no
 * user-message event (the `DaemonEvent` union has no such arm, and the coarse `message` fan-out is
 * off), so the optimistic `userText` echo is the sole source of the user message and needs no dedup
 * key. The send is guarded (AC4): a bridge failure is swallowed, never propagated. The echo is
 * dispatched regardless of the send outcome — "optimistic" means show-immediately, and this
 * milestone has no send-failure UI surface.
 */
export function submitMessage(text: string, deps: ComposerSendDeps): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false

  const message_id = deps.newMessageId()

  const payload: SendMessagePayload = {
    conversation_id: MILESTONE_CONVERSATION_ID,
    message_id,
    text: trimmed
  }

  try {
    deps.sendCommand(sendMessageCommand(payload))
  } catch (error) {
    // AC4: a send-bridge failure must not crash the window. The optimistic echo still posts.
    console.error('composer send failed', error)
  }

  // Route the optimistic echo into the timeline as the `userText` item (#245). The timeline reducer
  // tail-appends it, so it renders in arrival order beside the daemon's structured reply.
  deps.dispatch({ type: 'userText', text: trimmed })

  return true
}

/**
 * Whether the composer may send, and — when it may not — a short caption naming why (#31). Both
 * facts derive from the single `ConnectionStatus` read, so there is one source of truth.
 */
export interface ComposerAvailability {
  canSend: boolean // true only when the session is connected
  hint: string | null // short "why unavailable" caption; null iff canSend
}

/** Compile-time exhaustiveness guard: a new ConnectionStatus arm without a case is a type error. */
function assertNever(status: never): never {
  throw new Error(`Unhandled connection status: ${JSON.stringify(status)}`)
}

/**
 * Total mapping over ConnectionStatus's four arms. Pure — no store, no React, no I/O — so the
 * send/no-send decision (AC1) and the "why" copy (AC2) are unit-testable without a DOM, the same
 * reason submitMessage is pure. This is a UX affordance, not a safety net: the deterministic
 * no-throw safety on a disconnected send already lives in #65's daemonConnection.send() and #66's
 * guarded sendCommand — this only governs what the composer shows.
 *
 * The `error` hint is a short generic label; it deliberately does NOT surface
 * `status.error.message`. That ConnectionError.message is the connection banner's surface, out of
 * scope for #31 — leaking it here would duplicate the banner's job.
 */
export function composerAvailability(status: ConnectionStatus): ComposerAvailability {
  switch (status.type) {
    case 'connected':
      return { canSend: true, hint: null }
    case 'connecting':
      return { canSend: false, hint: 'Connecting…' }
    case 'disconnected':
      return { canSend: false, hint: 'Not connected' }
    case 'error':
      return { canSend: false, hint: 'Connection error' }
    default:
      return assertNever(status)
  }
}

/**
 * Whether the app should proactively offer a re-pair escape hatch (#167). True ONLY for a terminal,
 * non-retryable connection `error` — the case where the stored pairing can no longer be used: a fatal
 * close code or supervisor give-up (which daemonConnection.emitFailed always reports `retryable: false`),
 * or the daemon rejecting a stale/unknown device at handshake (pyrycode ADR 029). Pure — no store, no
 * React, no I/O — so the whole true/false matrix is unit-testable, the same discipline as
 * composerAvailability. A boolean over the single `error` arm; the other three arms are not `error`, so
 * no exhaustiveness switch is needed.
 *
 * The two gates, derived from the three-source retryability model (validated against the merged transport):
 *  - `!retryable` is the primary gate. It admits the terminal transport/handshake failures (always
 *    non-retryable) and EXCLUDES the retryable daemon-wire-error class (server.binary_offline,
 *    rate_limited) — a transient daemon-side condition, not a broken pairing (AC4). A transient transport
 *    drop never reaches `error` at all (relaySupervisor absorbs + re-dials), so it is out of scope here.
 *  - `code !== 'unpair'` excludes the self-inflicted UNPAIR_FAILED_ERROR that runUnpair dispatches when
 *    the clear itself fails (`unpairAction.ts`, `code: 'unpair'`). Without it, a failed re-pair would
 *    immediately re-satisfy the predicate and re-offer itself — a tight loop of a broken capability (AC5).
 */
export function shouldOfferRepair(status: ConnectionStatus): boolean {
  return status.type === 'error' && !status.error.retryable && status.error.code !== 'unpair'
}
