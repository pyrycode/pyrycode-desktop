import { useModalStore, selectOutstanding } from '../../store/modalStore'
import type { ModalPrompt } from '../../store/modalPrompts'
import { answerPrompt, cancelPrompt } from './modalResolution'

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
// the dismissal affordance). onAnswer / onCancel are REQUIRED injected effects (the RepairPrompt idiom
// — a view that cannot answer is a bug), speaking the store's camelCase; the container renames into the
// wire vocabulary. The `Cancel` label is client-owned copy, not daemon-supplied.
export function PermissionModalView({
  prompt,
  onAnswer,
  onCancel
}: {
  prompt: ModalPrompt
  onAnswer: (modalId: string, optionId: string) => void
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
        {/* title / prompt / labels are daemon-supplied, untrusted display text rendered as React
            children (auto-escaped) — never dangerouslySetInnerHTML, no markup interpretation (AC4). */}
        <h2 id={PERMISSION_MODAL_TITLE_ID} className="permission-modal__title">
          {prompt.title}
        </h2>
        <p className="permission-modal__prompt">{prompt.prompt}</p>
        <div className="permission-modal__options">
          {/* The leading (first) child of the action row: the de-emphasized cancel, at the left, the M3
              leading-dismissive placement (Figma "Dialogs", node 22-3). Its own class — NOT
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
            // The fail-safe deny default carries the --default modifier (visually distinct, assertable);
            // every other option carries only the base class — the codebase message-row--${type} idiom.
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
                onClick={() => onAnswer(prompt.modalId, option.id)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// The store-bound container. Reads the outstanding slice and renders the oldest prompt only (a
// permission/trust prompt is a blocking decision → single-dialog FIFO); when the oldest is
// answered/dismissed, the local `dismissed` dispatch removes it via reduceModal and the next [0]
// renders. No selectCurrentModal selector — the container derives [0] locally, honoring ADR 0009's
// deferral. Returns null when nothing is outstanding.
//
// The effects wire the modalResolution helpers, dereferencing `window.pyry` ONLY inside the handler
// closures (interaction time — the Composer.handleSubmit discipline), so the empty-case server-render
// test never touches the bridge. The camelCase → snake_case rename lives in the helpers.
export function PermissionModal(): JSX.Element | null {
  const outstanding = useModalStore(selectOutstanding)
  const dispatch = useModalStore((s) => s.dispatch)
  const prompt = outstanding[0]
  if (!prompt) return null
  return (
    <PermissionModalView
      prompt={prompt}
      onAnswer={(modalId, optionId) =>
        answerPrompt(modalId, optionId, { sendCommand: window.pyry.sendCommand, dispatch })
      }
      onCancel={(modalId) =>
        cancelPrompt(modalId, { sendCommand: window.pyry.sendCommand, dispatch })
      }
    />
  )
}
