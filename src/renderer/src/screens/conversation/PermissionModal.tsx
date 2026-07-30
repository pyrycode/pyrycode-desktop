import { useState } from 'react'
import { useModalStore, selectOutstanding, selectRejections } from '../../store/modalStore'
import type { ModalOption, ModalPrompt } from '../../store/modalPrompts'
import {
  answerPrompt,
  cancelPrompt,
  selectOption,
  resolvePendingOption,
  type PendingConfirm
} from './modalResolution'

// #224/#237: the interactive permission/trust modal — the store → UI half of the modal vertical. Two
// components mirroring RepairPrompt / RepairControl: a pure, exported view (ModalPrompt in, markup out,
// server-render-tested with injected fixtures) and a store-bound container isolating the read so a modal
// arrival re-renders this leaf only, never ConversationScreen.
//
// #237 makes the modal answerable: each option button dispatches the user's choice and a new leading
// cancel affordance dispatches a cancel, both clearing the outstanding prompt locally via the existing
// `dismissed` reducer arm. The view speaks the store's camelCase (`onAnswer(modalId, optionId)`); the
// snake_case rename to the wire vocabulary is the modalResolution helper's job (see modalResolution.ts).

// A stable id tying the dialog's aria-labelledby to its title element (the STATUS_SHEET_TITLE_ID idiom).
// A single fixed id is safe: only the oldest outstanding prompt renders, so at most one dialog exists.
const PERMISSION_MODAL_TITLE_ID = 'permission-modal-title'

// The pure dialog chrome for one (non-null) prompt. Reuses StatusSheet's overlay+scrim+panel structure
// (role="dialog", aria-modal, a dedicated scrim, an opaque panel absolutely positioned inside
// .conversation, no portal) but centers the panel as an M3 dialog (Figma "Dialogs", node 22-3) rather
// than bottom-anchoring it. The scrim is decorative here (no backdrop dismissal — the cancel button is
// the dismissal affordance).
//
// #226: the view renders one of two modes off the `pendingOption` prop — the state is a PROP (not
// internal useState) so both modes stay SSR-testable under the `node` env. `pendingOption === null` →
// the daemon option list (list mode); a set `pendingOption` → the client-owned confirm sub-step
// (confirm mode), reusing this same chrome. Every option click routes through `onSelect`; the container
// (via the selectOption gate) decides answer-straight-through vs hold-pending-confirm. onSelect /
// onConfirm / onBack / onCancel are REQUIRED injected effects (the RepairPrompt idiom — a view that
// cannot answer is a bug), speaking the store's camelCase; the container renames into the wire
// vocabulary. The `Cancel` / confirm-sentence / `Back` / `Confirm` copy is client-owned, not daemon-supplied.
export function PermissionModalView({
  prompt,
  pendingOption,
  onSelect,
  onConfirm,
  onBack,
  onCancel
}: {
  prompt: ModalPrompt
  pendingOption: ModalOption | null
  onSelect: (modalId: string, optionId: string) => void
  onConfirm: (modalId: string, optionId: string) => void
  onBack: () => void
  onCancel: (modalId: string) => void
}): JSX.Element {
  return (
    <div className="permission-modal-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed. */}
      <div className="permission-modal-overlay__scrim" aria-hidden="true" />
      <div
        className="permission-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={PERMISSION_MODAL_TITLE_ID}
      >
        {/* The title stays shown in BOTH modes so the user remains oriented on what they are approving.
            title / prompt / labels are daemon-supplied, untrusted display text rendered as React
            children (auto-escaped) — never dangerouslySetInnerHTML, no markup interpretation (AC4). */}
        <h2 id={PERMISSION_MODAL_TITLE_ID} className="permission-modal__title">
          {prompt.title}
        </h2>
        {pendingOption ? (
          // Confirm mode (#226): a client-owned confirm sentence naming the held option's (auto-escaped)
          // label + a Back/Confirm action row. The daemon option list is NOT rendered here.
          <>
            <p className="permission-modal__prompt">
              Send &quot;{pendingOption.label}&quot;? This grants the requested action.
            </p>
            <div className="permission-modal__options">
              {/* Back is the leading (left) action — margin-right: auto, the M3 leading-dismissive
                  placement — returning to the option list without sending. */}
              <button type="button" className="permission-modal__back" onClick={() => onBack()}>
                Back
              </button>
              <button
                type="button"
                className="permission-modal__confirm"
                onClick={() => onConfirm(prompt.modalId, pendingOption.id)}
              >
                Confirm
              </button>
            </div>
          </>
        ) : (
          // List mode (#237): the daemon prompt + one button per option, plus the leading Cancel.
          <>
            <p className="permission-modal__prompt">{prompt.prompt}</p>
            <div className="permission-modal__options">
              {/* The leading (first) child of the action row: the de-emphasized cancel, at the left, the
                  M3 leading-dismissive placement (Figma "Dialogs", node 22-3). Its own class — NOT
                  permission-modal__option — so it neither carries the option treatment nor inflates the
                  option count. */}
              <button
                type="button"
                className="permission-modal__cancel"
                onClick={() => onCancel(prompt.modalId)}
              >
                Cancel
              </button>
              {prompt.options.map((option) => {
                // The fail-safe deny default carries the --default modifier (visually distinct,
                // assertable); every other option carries only the base class — the message-row--${type}
                // idiom. Every click routes through onSelect; the gate decides answer vs hold.
                const isDefault = option.id === prompt.defaultOptionId
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={
                      isDefault
                        ? 'permission-modal__option permission-modal__option--default'
                        : 'permission-modal__option'
                    }
                    onClick={() => onSelect(prompt.modalId, option.id)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// #249: the modal-answer rejection surface — a pure, exported, SSR-testable view mirroring
// PermissionModalView. When a modal answer round-trips to a daemon `error` (#248), the answer path has
// already cleared the prompt optimistically (#237), so this transient banner stack is the ONLY thing
// telling the user the answer did not go through. It reads ONLY `rejections` (bare modalIds), never the
// outstanding prompt — so it structurally cannot depend on it (AC2, the ThinkingIndicator posture).
//
// Content-free (AC3): the copy is a client-owned category constant; no daemon `code`/`message`/nonce
// reaches the DOM. `modalId` is used ONLY as the stable React key and the `onDismiss` argument, never
// rendered as visible text (AC4 — the nonce is meaningless to a human and the prompt title is gone).
// `onDismiss` is a REQUIRED injected effect (the PermissionModalView "a view that cannot answer is a
// bug" rule). Returns null on an empty list — zero layout footprint (the Timeline/ThinkingIndicator idiom).
const REJECTION_COPY = 'Your answer was rejected.'

export function RejectionSurfaceView({
  rejections,
  onDismiss
}: {
  rejections: readonly string[]
  onDismiss: (modalId: string) => void
}): JSX.Element | null {
  if (rejections.length === 0) return null
  return (
    <div className="modal-rejections">
      {rejections.map((modalId) => (
        // role="alert" makes each banner a live region so a screen reader announces the failure on
        // arrival. Keyed by modalId — the stable identity across a stack (AC4).
        <div key={modalId} className="modal-rejection" role="alert">
          <p className="modal-rejection__copy">{REJECTION_COPY}</p>
          <button
            type="button"
            className="modal-rejection__dismiss"
            onClick={() => onDismiss(modalId)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}

// The store-bound container. Reads the outstanding slice and renders the oldest prompt only (a
// permission/trust prompt is a blocking decision → single-dialog FIFO); when the oldest is
// answered/dismissed, the local `dismissed` dispatch removes it via reduceModal and the next [0]
// renders. No selectCurrentModal selector — the container derives [0] locally, honoring ADR 0009's
// deferral. It also reads the orthogonal `rejections` slice (#249) and renders the rejection surface
// alongside the prompt; either surface may show independently. Returns null when BOTH are empty.
//
// The effects wire the modalResolution helpers, dereferencing `window.pyry` ONLY inside the handler
// closures (interaction time — the Composer.handleSubmit discipline), so the empty-case server-render
// test never touches the bridge. The camelCase → snake_case rename lives in the helpers. The rejection
// dismiss is a trivial inline `dispatch` — no modalResolution helper (it neither sends a command nor
// renames to the wire): the reduce arm is unit-tested and the button is structurally tested.
export function PermissionModal(): JSX.Element | null {
  const outstanding = useModalStore(selectOutstanding)
  const rejections = useModalStore(selectRejections)
  const dispatch = useModalStore((s) => s.dispatch)
  // #226/#511: the transient second-confirm marker — the option held pending a confirm AND the modalId
  // of the prompt it was selected on, or null in list mode. useState (not a store slice): the lowest
  // scope that survives re-render, cleared on confirm or back, never persisted. Declared BEFORE the
  // early return (rules-of-hooks); the empty-case SSR test still returns null because the guard fires
  // after the hook runs.
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const prompt = outstanding[0]
  // Fire only when BOTH surfaces are empty: a rejection can show with no outstanding prompt (the prompt
  // was optimistically cleared, #237), so a lone `rejections` entry must still render.
  if (!prompt && rejections.length === 0) return null
  // #511: re-derive the held option every render, scoped by modalId — a marker armed on one prompt can
  // never render as a confirm step on another. The three routes that swap outstanding[0] under a live
  // marker (a remote/timeout `dismissed`, a `reconnected` reset, and the empty-outstanding window this
  // component survives because ConversationScreen mounts it unconditionally) therefore all fall back to
  // list mode. `pending` and `outstanding` are read in the SAME render pass, so Confirm exists only
  // while the identity currently matches — there is no clearing effect to get wrong and a stale marker
  // is inert rather than dangerous. Guard/consequence detail lives on resolvePendingOption.
  const pendingOption = resolvePendingOption(prompt, pending)
  return (
    <>
      {prompt && (
        <PermissionModalView
          prompt={prompt}
          pendingOption={pendingOption}
          onSelect={(modalId, optionId) =>
            selectOption(prompt, optionId, {
              answer: (id) =>
                answerPrompt(modalId, id, { sendCommand: window.pyry.sendCommand, dispatch }),
              // #511: the identity is captured from the CLICK — `modalId` is onSelect's own first
              // argument, sourced by the view from the prompt it actually rendered — never re-read
              // from a possibly-newer store.
              requestConfirm: (optionId) => setPending({ modalId, optionId })
            })
          }
          onConfirm={(modalId, optionId) => {
            answerPrompt(modalId, optionId, { sendCommand: window.pyry.sendCommand, dispatch })
            setPending(null)
          }}
          onBack={() => setPending(null)}
          onCancel={(modalId) =>
            cancelPrompt(modalId, { sendCommand: window.pyry.sendCommand, dispatch })
          }
        />
      )}
      <RejectionSurfaceView
        rejections={rejections}
        onDismiss={(modalId) => dispatch({ type: 'rejectionDismissed', modalId })}
      />
    </>
  )
}
