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

/** The whole modal state: the ordered set of still-outstanding prompts. */
export interface ModalState {
  outstanding: readonly ModalPrompt[]
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
 * Pure reducer — no mutation, returns fresh state. `shown` always appends (a shown is always a
 * change); `dismissed` removes by id, or no-ops on an unknown id. Mirrors `reduceTimeline`: a
 * `switch` on the sealed union with an `assertNever` default, and a same-reference return when
 * nothing changes so an unchanged slice does not churn selectors.
 */
export function reduceModal(state: ModalState, event: ModalEvent): ModalState {
  switch (event.type) {
    case 'shown':
      return {
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
      return outstanding === state.outstanding ? state : { outstanding }
    }
    default:
      return assertNever(event)
  }
}

export const initialModalState: ModalState = { outstanding: [] }

/** Selector — the read surface, returns the slice by reference (matching `selectItems`). */
export const selectOutstanding = (s: ModalState): readonly ModalPrompt[] => s.outstanding
