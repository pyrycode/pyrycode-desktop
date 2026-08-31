// The outstanding modal prompts: the permission/trust prompts `claude` raises during a
// desktop-driven interactive session and has not yet resolved, each addressed by its one-time
// `modalId`. Pure renderer state — no IPC, no preload bridge, no transport, no React. Introduced
// alongside `sessionStore` and `threadTimeline` (Strangler Fig, ADR 0009): nothing cuts over here
// and no consumer imports this yet. The follow-up adds the modal wire types, the transport decode,
// the `DaemonEvent` arm, and the bridge that maps wire (snake_case) frames into the `ModalEvent`s
// this reducer consumes — the desktop analog of `daemonEventBridge` mapping `DaemonEvent` →
// `SessionAction`. Field names mirror the wire so that bridge is a thin rename. See ADR 0009.

/** The two shipped wire modal classes. There is no `destructive` class (ADR 0009). */
export type ModalClass = 'permission' | 'trust'

/** One selectable option. Array order is display/selection order — the store holds it verbatim. */
export interface ModalOption {
  id: string
  label: string
}

/** The held, outstanding prompt — what a `shown` event installs and a `dismissed` clears. */
export interface ModalPrompt {
  modalId: string
  class: ModalClass
  title: string
  prompt: string
  options: readonly ModalOption[]
  defaultOptionId: string
}

/**
 * The renderer-local, sealed input union the reducer consumes. camelCase and defined here (not in
 * `src/shared/wire`); the follow-up's bridge maps the snake_case wire frames into these.
 *
 * The `shown` arm carries `conversationId` (#877) — the frame's `conversation_id` (pyrycode#1065,
 * decoded by #870), arriving on the `modalShown` `DaemonEvent` (#871) and copied BY NAME into the
 * fresh literal the bridge builds, never by spreading that event. REQUIRED, never optional: the wire
 * has it always-present and the decode fail-closes on absence, so an optional field would invent an
 * absence case the daemon never produces — and an assigned `undefined` survives the structured clone
 * across the IPC channel, so a later `'conversationId' in event` check would read true on an event
 * carrying nothing. The id is a daemon-asserted SCOPING KEY, not rendered text, so none of the
 * untrusted-display-text handling `title` / `prompt` / `options[].label` need attaches to it.
 *
 * It STOPS at `reduceModal`, which builds `ModalPrompt` from named fields and omits it; the consumer
 * that scopes a prompt to a sidebar row is #878. It is an OUTBOUND scoping key only: `modalId`
 * remains the sole correlation key for ANSWERING a prompt — `modal_answer` / `modal_cancel` carry no
 * conversation id and the daemon resolves an answer against its own outstanding-modal state
 * (ADR 0009).
 */
export type ModalEvent =
  | {
      type: 'shown'
      conversationId: string
      modalId: string
      class: ModalClass
      title: string
      prompt: string
      options: readonly ModalOption[]
      defaultOptionId: string
    }
  // `outcome`/`source` are carried for the follow-up consumer (a resolution toast) but NOT consulted
  // by the reduce — only `modalId` drives the clear — mirroring threadTimeline's carried-but-unused `seq`.
  | { type: 'dismissed'; modalId: string; outcome: string; source: 'remote' | 'local' | 'timeout' }
  // #249: a modal answer that round-tripped to a daemon `error`. Produced by the bridge from the
  // content-free `modalAnswerRejected` daemon event (#248) — it carries ONLY the `modalId` nonce, no
  // daemon error text (AC3). The answer path already cleared the prompt optimistically (#237), so this
  // installs a NEW, orthogonal surface, never re-surfacing `outstanding`.
  | { type: 'rejected'; modalId: string }
  // #249: a LOCAL user action — the user dismissed a rejection banner. Never produced by the bridge;
  // dispatched inline from the container, exactly as answer/cancel dispatch `dismissed` locally.
  | { type: 'rejectionDismissed'; modalId: string }
  // #415: the transport (re)connected. Fires on EVERY supervisor (re)handshake, including the first
  // connect. Reconciles `outstanding` against the daemon's connect-time re-sends by clearing it; the
  // daemon then repopulates via `shown`, and absence = resolved-while-away. #510: it clears `resolved`
  // too — both slices are per-connection truth. Carries no payload — the reset needs nothing from the
  // connect ack. A reconnect with neither slice to clear is a same-reference no-op (AC4).
  | { type: 'reconnected' }

/**
 * The whole modal state: the ordered set of still-outstanding prompts, plus the rejection surface —
 * the arrival-ordered, de-duplicated `modalId`s of answers that round-tripped to a daemon `error`
 * (#249). `rejections` is ORTHOGONAL to `outstanding`: the answered prompt is already gone (#237), so a
 * rejection is new UI state, not a re-surfaced prompt. It holds bare `modalId` strings — the event is
 * content-free, so there is genuinely nothing else to carry — and each id is the stable React key when
 * more than one banner shows (AC4).
 */
export interface ModalState {
  outstanding: readonly ModalPrompt[]
  rejections: readonly string[]
  // #195: the `modalId`s that have LEFT `outstanding` via `dismissed` (answer/cancel/remote/timeout).
  // Internal reducer bookkeeping — no selector, no consumer reads it. It lets the `shown` arm tell a
  // never-seen id (→ append) from a seen-then-resolved one (→ no-op), so a duplicate delivery within one
  // connection updates the prompt already shown rather than re-surfacing an already-answered one.
  // Disjoint from `outstanding` by construction. #510: PER-CONNECTION state, not permanent — the
  // `reconnected` arm clears it. An answer is dispatched optimistically even when the transport is down
  // and the send is swallowed (`answerModal` early-returns on a null driver), so a recorded id means
  // "resolved as far as THIS connection saw" — never "the daemon has it". The daemon's connect-time
  // reconcile re-sends only STILL-OUTSTANDING prompts, so anything re-sent after a handshake is
  // genuinely unanswered and must re-surface.
  resolved: readonly string[]
}

/** Compile-time exhaustiveness guard: a new ModalEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled modal event: ${JSON.stringify(event)}`)
}

/**
 * Remove the prompt whose `modalId` matches, returning a new array. If none matches — an unknown or
 * already-dismissed id — return the SAME array reference, so the caller can return the same state
 * unchanged (deterministic no-op, non-throwing, per ADR 0009 / AC4). Mirrors `fillResult`'s
 * same-reference-on-no-match discipline.
 */
function removeById(outstanding: readonly ModalPrompt[], modalId: string): readonly ModalPrompt[] {
  const next = outstanding.filter((p) => p.modalId !== modalId)
  return next.length === outstanding.length ? outstanding : next
}

/**
 * Append a `modalId` to the rejection list, de-duplicated: a repeat returns the SAME array reference so
 * the caller can return the same state unchanged (#248's FIFO window can, in a race, redeliver an id).
 * Mirrors `removeById`'s same-reference-on-no-change contract.
 */
function appendUnique(rejections: readonly string[], modalId: string): readonly string[] {
  return rejections.includes(modalId) ? rejections : [...rejections, modalId]
}

/**
 * Remove a `modalId` from the rejection list, returning a new array — or the SAME array reference when
 * no id matches (an unknown or already-dismissed id), a deterministic non-throwing no-op. Mirrors
 * `removeById` for the `readonly string[]` surface.
 */
function removeRejection(rejections: readonly string[], modalId: string): readonly string[] {
  const next = rejections.filter((id) => id !== modalId)
  return next.length === rejections.length ? rejections : next
}

/**
 * Pure reducer — no mutation, returns fresh state. `shown` is idempotent on `modalId` (#195): a
 * never-seen id appends, a re-delivered still-outstanding id updates in place, and a re-delivered
 * already-resolved id is a same-reference no-op WITHIN THE CURRENT CONNECTION — so a duplicate delivery
 * never double-shows. #510 scopes that last clause: `reconnected` clears `resolved`, so the same id
 * re-sent after a handshake DOES re-surface. `dismissed` removes by id (recording it as resolved), or
 * no-ops on an unknown id. Mirrors `reduceTimeline`: a `switch` on the sealed union with an
 * `assertNever` default, and a same-reference return when nothing changes so an unchanged slice does
 * not churn selectors.
 */
export function reduceModal(state: ModalState, event: ModalEvent): ModalState {
  switch (event.type) {
    case 'shown': {
      // Check `resolved` first — the cheap duplicate-delivery early-out: a prompt the client already
      // answered/dismissed (optimistically, #237) must NOT re-surface WITHIN THE CURRENT CONNECTION.
      // Same-reference no-op. #510: ACROSS a reconnect it must re-surface, and does — the `reconnected`
      // arm clears `resolved`, so this check simply finds nothing after a handshake.
      if (state.resolved.includes(event.modalId)) return state
      const prompt: ModalPrompt = {
        modalId: event.modalId,
        class: event.class,
        title: event.title,
        prompt: event.prompt,
        options: event.options,
        defaultOptionId: event.defaultOptionId
      }
      // Re-delivery of a still-outstanding id: replace in place from the RE-DELIVERED fields
      // (match-and-replace takes the latest) — position + length preserved, no duplicate append.
      // Spread state so the orthogonal `rejections`/`resolved` surfaces survive a prompt install.
      const outstanding = state.outstanding.some((p) => p.modalId === event.modalId)
        ? state.outstanding.map((p) => (p.modalId === event.modalId ? prompt : p))
        : [...state.outstanding, prompt]
      return { ...state, outstanding }
    }
    case 'dismissed': {
      const outstanding = removeById(state.outstanding, event.modalId)
      // Unknown/already-dismissed id: removeById returned the same array — return the same state.
      // Do NOT record `resolved` here: a `dismissed` for a never-outstanding id must not poison
      // `resolved`, or a later legitimate `shown` of that id would be wrongly suppressed (ordering edge).
      if (outstanding === state.outstanding) return state
      // Genuine removal — the single choke point where a prompt leaves `outstanding` (answer/cancel/
      // remote/timeout all dispatch `dismissed`). Record the id so a reconnect re-send no-ops (#195).
      // Spread state so `rejections` survives a real clear (#249).
      const resolved = appendUnique(state.resolved, event.modalId)
      return { ...state, outstanding, resolved }
    }
    case 'rejected': {
      const rejections = appendUnique(state.rejections, event.modalId)
      // Duplicate id: appendUnique returned the same array — return the same state (no churn).
      return rejections === state.rejections ? state : { ...state, rejections }
    }
    case 'rejectionDismissed': {
      const rejections = removeRejection(state.rejections, event.modalId)
      // Unknown/already-dismissed id: removeRejection returned the same array — return the same state.
      return rejections === state.rejections ? state : { ...state, rejections }
    }
    case 'reconnected': {
      // #415: on every (re)handshake, clear `outstanding` so the daemon's connect-time re-sends are the
      // sole repopulation truth (a still-held prompt re-appends via `shown`, absence = resolved-while-away).
      // #510 DELIBERATELY REVERSES #415 AC3 and clears `resolved` too: both slices are per-CONNECTION
      // truth. Retaining `resolved` guarded nothing — the daemon's reconcile enumerates only STILL-
      // OUTSTANDING modals, so a prompt it already resolved is never re-sent — while costing the bug it
      // was meant to prevent: an answer clicked while the link was down is swallowed by the transport,
      // yet the retained id suppressed the daemon's re-delivery, so the user's explicit Allow decayed
      // into a deny-on-timeout with no way to re-answer. `rejections` still passes through the spread —
      // it has no daemon repopulation path.
      // Each slice is guarded independently so the same-reference-on-no-change discipline survives:
      // an already-empty `outstanding` keeps its reference (PermissionModal selects it under Object.is,
      // so a fresh [] would re-render for no state change), and a reconnect with nothing at all to clear
      // returns the same state (AC4: no churn on the first / held-nothing connect).
      const outstanding = state.outstanding.length === 0 ? state.outstanding : []
      const resolved = state.resolved.length === 0 ? state.resolved : []
      if (outstanding === state.outstanding && resolved === state.resolved) return state
      return { ...state, outstanding, resolved }
    }
    default:
      return assertNever(event)
  }
}

export const initialModalState: ModalState = { outstanding: [], rejections: [], resolved: [] }

/** Selector — the read surface, returns the slice by reference (matching `selectItems`). */
export const selectOutstanding = (s: ModalState): readonly ModalPrompt[] => s.outstanding

/** Selector for the rejection surface (#249) — the read surface, returns the slice by reference. */
export const selectRejections = (s: ModalState): readonly string[] => s.rejections
