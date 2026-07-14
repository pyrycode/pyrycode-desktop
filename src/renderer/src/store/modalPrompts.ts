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
 * `src/shared/wire`); the follow-up's bridge maps the snake_case wire frames into these. `modalId`
 * is the sole correlation key — no `conversation_id` is carried (the wire carries none on a modal,
 * ADR 0009).
 */
export type ModalEvent =
  | {
      type: 'shown'
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
  // never-seen id (→ append) from a seen-then-resolved one (→ no-op), so the daemon's reconcile-on-
  // connect re-send of a still-outstanding prompt updates the one prompt already shown rather than
  // re-surfacing an already-answered one. Disjoint from `outstanding` by construction. `modalId`s are
  // one-time nonces (never reused), so a retained id is never legitimately re-shown — retain forever.
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
 * never-seen id appends, a re-delivered still-outstanding id updates in place, a re-delivered
 * already-resolved id is a same-reference no-op — so the daemon's reconcile-on-connect re-send never
 * double-shows. `dismissed` removes by id (recording it as resolved), or no-ops on an unknown id.
 * Mirrors `reduceTimeline`: a `switch` on the sealed union with an `assertNever` default, and a
 * same-reference return when nothing changes so an unchanged slice does not churn selectors.
 */
export function reduceModal(state: ModalState, event: ModalEvent): ModalState {
  switch (event.type) {
    case 'shown': {
      // Check `resolved` first — the cheap reconnect-race early-out: a re-delivered prompt the client
      // already answered/dismissed (optimistically, #237) must NOT re-surface. Same-reference no-op.
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
    default:
      return assertNever(event)
  }
}

export const initialModalState: ModalState = { outstanding: [], rejections: [], resolved: [] }

/** Selector — the read surface, returns the slice by reference (matching `selectItems`). */
export const selectOutstanding = (s: ModalState): readonly ModalPrompt[] => s.outstanding

/** Selector for the rejection surface (#249) — the read surface, returns the slice by reference. */
export const selectRejections = (s: ModalState): readonly string[] => s.rejections
