// The composer's submit logic — framework-free and React-free, co-located with the screen
// and mirroring pairingState.ts / messageViewModel.ts: the effects are injected so the helper
// is a pure, deterministic function tested with plain spies (no React, no store, no Electron).
// The React container (ConversationScreen's Composer) is thin glue over this.
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { SendMessagePayload } from '@shared/wire/types'
import type { ConnectionStatus } from '../../store/sessionStore'
import type { ThreadEvent } from '../../store/threadTimeline'

/**
 * The four effects submitMessage performs, injected so the helper stays pure and deterministic in
 * tests. `newMessageId` is `crypto.randomUUID()` in the container; tests inject a stub. `dispatch`
 * writes a `ThreadEvent` into `timelineStore` (#179): the user's message and the daemon's structured
 * reply now share the one ordered timeline surface.
 *
 * `dispatchFor` (#756) is the same echo's write into the keyed holder — the timeline's second
 * row-adding writer, folded into the conversation the message was SENT TO. REQUIRED, not optional, and
 * not an arity widening of `dispatch`: the opposite call from `subscribeTimeline`'s, for the reason
 * `ConversationScreen.tsx:1930-1934` already states — the cascade decides. This deps object had six
 * call sites in `composerSend.test.ts` plus the one container, so requiring the field cost six
 * mechanical test edits and buys a compile error for "forgot to wire it"; at `subscribeTimeline`'s
 * twenty that trade is unavailable, which is why the bridge went the other way.
 */
export interface ComposerSendDeps {
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: ThreadEvent) => void
  dispatchFor: (conversationId: string, event: ThreadEvent) => void
  newMessageId: () => string
}

/**
 * Submit the composer's current text into the ACTIVE conversation (#448). `conversationId` is the
 * id of the conversation this thread shows — the activeConversationStore's id at the container.
 * Returns `true` when a message was sent (the container clears the input on `true`), `false` for
 * whitespace-only input or a null conversation id (no effect either way).
 *
 * The null guard is #448's contract: the daemon validates `conversation_id` and rejects an unknown
 * id with an error frame, so sending under a placeholder is never correct. No active conversation →
 * no wire command AND no optimistic echo — an echo for a message that cannot be delivered would
 * paint a lie into the timeline.
 *
 * The `message_id` is minted for the WIRE command only. The old "reuse the id for wire + echo so the
 * daemon's re-echo dedupes" rationale is retired (#179): in interactive mode the daemon streams no
 * user-message event (the `DaemonEvent` union has no such arm, and the coarse `message` fan-out is
 * off), so the optimistic `userText` echo is the sole source of the user message and needs no dedup
 * key. The send is guarded (AC4): a bridge failure is swallowed, never propagated. The echo is
 * dispatched regardless of the send outcome — "optimistic" means show-immediately, and this
 * milestone has no send-failure UI surface.
 */
export function submitMessage(
  text: string,
  conversationId: string | null,
  deps: ComposerSendDeps
): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (conversationId === null) return false

  const message_id = deps.newMessageId()

  const payload: SendMessagePayload = {
    conversation_id: conversationId,
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
  //
  // Built ONCE and handed to both write paths (#756). Sharing one `ThreadEvent` reference across two
  // stores is safe for the reason `conversationTimelineStore.ts:268-270` already states:
  // `reduceTimeline` is pure and always builds fresh arrays. Both writes sit outside the `try` above —
  // the guarded-send contract covers `sendCommand` only and must not grow to cover a store write.
  const echo: ThreadEvent = { type: 'userText', text: trimmed }
  deps.dispatch(echo)
  // The keyed fold, under the conversation this message was SENT TO — it rides the wire as
  // `conversation_id` in the payload above. This is NOT the fallback AC3 bans: that ban is on inventing
  // an id for an event that ARRIVED without one, not on knowing where you just sent something. The id
  // is non-null here by control flow — the `conversationId === null` guard already returned `false`
  // above — so there is no `?? ''`, no default and no non-null assertion.
  deps.dispatchFor(conversationId, echo)

  return true
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

/**
 * The connection banner's copy (#279) — a single, exported, module-level client-owned string. This is
 * the banner's ENTIRE text; it is never derived from `status`, so AC3 ("no daemon-supplied string is
 * rendered as the banner text") is a structural guarantee, not a convention (the EMPTY_THREAD_COPY /
 * ThinkingIndicator label idiom). It is deliberately lexically distinct from all three
 * `composerAvailability` hints (`Connecting…` / `Not connected` / `Connection error`) — it leads with
 * "Cannot reach" and shares no leading words — so the prominent banner and the terse composer gate
 * never read as the same string stacked twice (AC5). A single constant, not a per-arm map: every
 * non-connected arm is a state where pyry is unreachable, so one sentence covers all three honestly (no
 * "restored"/"lost" temporal claim); a second three-way copy split would be the duplication AC5 warns
 * against — the composer already carries the per-arm nuance. It is a client-owned constant, so PO/design
 * may tune the wording; the load-bearing contract is (a) one client-owned constant, (b) lexically
 * distinct from the three composer hints, (c) zero daemon-supplied substring. Apostrophe-free by design
 * — the EMPTY_THREAD_COPY / `Thinking…` convention — so a server-rendered `toContain` assertion matches
 * it verbatim (renderToStaticMarkup escapes `'` → `&#x27;`).
 */
export const CONNECTION_BANNER_COPY =
  'Cannot reach pyrybox — your messages will not send until the connection is back.'

/**
 * Whether the prominent, disconnected-only connection banner should show (#279) — the third,
 * independent read of the single `ConnectionStatus` slice, beside `composerAvailability` (the terse
 * inline composer gate) and `shouldOfferRepair` (the terminal-error escape hatch). True for every
 * non-connected arm (`disconnected` | `connecting` | `error`), false only when `connected` (AC1/AC2).
 *
 * Expressed as `!== 'connected'` rather than an exhaustive switch/assertNever (composerAvailability's
 * shape): unlike that gate — where each arm maps to different copy, so it must enumerate — every
 * non-connected arm maps to the SAME behavior (show the banner), so "show unless connected" is the
 * honest shape. Its fail-mode is correct too: a hypothetical future 5th `ConnectionStatus` arm would
 * default to SHOWING the not-connected band — the safe direction (over-showing a "not connected" banner
 * beats silently hiding it).
 */
export function shouldShowBanner(status: ConnectionStatus): boolean {
  return status.type !== 'connected'
}

/**
 * The composer status row's error-chip copy (#797) — the chip's ENTIRE visible text, and the fourth
 * string this module owns about the single `ConnectionStatus` fact. It lives here, beside
 * CONNECTION_BANNER_COPY and the three `composerAvailability` hints, rather than as a module-level
 * constant in ConversationScreen.tsx (where THINKING_COPY / STALL_COPY live), precisely so the lexical
 * distinctness those four owe each other is reviewable in one place.
 *
 * It carries CONNECTION_BANNER_COPY's three-part contract verbatim: (a) one client-owned constant,
 * (b) lexically distinct from the banner copy and the three composer hints — it leads with "Host" and
 * shares no leading word with `Cannot reach pyrybox…` / `Connecting…` / `Not connected` /
 * `Connection error` — and (c) zero daemon-supplied substring. (c) is structural rather than
 * conventional here too: ComposerErrorChip narrows on `status.type` and never destructures
 * `status.error`, so no ConnectionError field has a rendering path to escape, length-bound or
 * newline-strip. Apostrophe-free by design (renderToStaticMarkup escapes `'` → `&#x27;`, the standing
 * desktop lesson), so a server-rendered `toContain` matches it verbatim. PO/design may tune the wording
 * — the contract is load-bearing, the exact words are not; the exclamation mark is the mock's.
 */
export const COMPOSER_ERROR_CHIP_COPY = 'Host connection down!'

/**
 * The error chip's assistive-technology marking (#797, AC4) — rendered as visually hidden TEXT inside
 * the chip, ahead of COMPOSER_ERROR_CHIP_COPY, so the chip's error nature does not rest on its colour
 * alone. Hidden text rather than an `aria-label`, because a bare <div>/<span> maps to role="generic",
 * which ARIA 1.2 puts on the name-prohibited list — an aria-label there asserts green in a markup test
 * and is dropped by a real screen reader. See ComposerErrorChip's own comment.
 *
 * THE TRAILING SPACE IS LOAD-BEARING. It is the entire separator between the two runs when a screen
 * reader concatenates them into "Error: Host connection down!"; an editor's trim silently degrades the
 * announcement. composerSend.test.ts pins it. Client-owned and apostrophe-free like its sibling above.
 */
export const COMPOSER_ERROR_CHIP_PREFIX_COPY = 'Error: '
