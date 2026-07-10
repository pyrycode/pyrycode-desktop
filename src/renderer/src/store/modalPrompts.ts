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
 * Pure reducer — no mutation, returns fresh state. `shown` always appends (a shown is always a
 * change); `dismissed` removes by id, or no-ops on an unknown id. Mirrors `reduceTimeline`: a
 * `switch` on the sealed union with an `assertNever` default, and a same-reference return when
 * nothing changes so an unchanged slice does not churn selectors.
 */
export function reduceModal(state: ModalState, event: ModalEvent): ModalState {
  switch (event.type) {
    case 'shown':
      // Spread state so the orthogonal `rejections` surface survives a prompt install (#249).
      return {
        ...state,
        outstanding: [
          ...state.outstanding,
          {
            modalId: event.modalId,
            class: event.class,
            title: event.title,
            prompt: event.prompt,
            options: event.options,
            defaultOptionId: event.defaultOptionId
          }
        ]
      }
    case 'dismissed': {
      const outstanding = removeById(state.outstanding, event.modalId)
      // Unknown/already-dismissed id: removeById returned the same array — return the same state.
      // Spread state so `rejections` survives a real clear (#249).
      return outstanding === state.outstanding ? state : { ...state, outstanding }
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

export const initialModalState: ModalState = { outstanding: [], rejections: [] }

/** Selector — the read surface, returns the slice by reference (matching `selectItems`). */
export const selectOutstanding = (s: ModalState): readonly ModalPrompt[] => s.outstanding

/** Selector for the rejection surface (#249) — the read surface, returns the slice by reference. */
export const selectRejections = (s: ModalState): readonly string[] => s.rejections
