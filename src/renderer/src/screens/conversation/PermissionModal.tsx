import { useModalStore, selectOutstanding } from '../../store/modalStore'
import type { ModalPrompt } from '../../store/modalPrompts'

// #224: the interactive permission/trust modal — the store → UI half of the modal vertical. Two
// components mirroring RepairPrompt / RepairControl: a pure, exported view (ModalPrompt in, markup out,
// server-render-tested with injected fixtures) and a store-bound container isolating the read so a modal
// arrival re-renders this leaf only, never ConversationScreen.
//
// Read-only render: the option buttons draw but do not answer the daemon (the answer path is a
// downstream slice), so each is inert — no onClick. This lands the render surface stably before the
// enrichment, the #203-before-#218 discipline.

// A stable id tying the dialog's aria-labelledby to its title element (the STATUS_SHEET_TITLE_ID idiom).
// A single fixed id is safe: only the oldest outstanding prompt renders, so at most one dialog exists.
const PERMISSION_MODAL_TITLE_ID = 'permission-modal-title'

// The pure dialog chrome for one (non-null) prompt. Reuses StatusSheet's overlay+scrim+panel structure
// (role="dialog", aria-modal, a dedicated scrim, an opaque panel absolutely positioned inside
// .conversation, no portal) but centers the panel as an M3 dialog (Figma "Dialogs", node 22-3) rather
// than bottom-anchoring it. The scrim is decorative here (no dismissal until the answer path).
export function PermissionModalView({ prompt }: { prompt: ModalPrompt }): JSX.Element {
  return (
    <div className="permission-modal-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed. Inert this slice — no backdrop dismissal. */}
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
// answered/dismissed downstream, the next [0] renders. No selectCurrentModal selector — the container
// derives [0] locally, honoring ADR 0009's deferral. Returns null when nothing is outstanding.
export function PermissionModal(): JSX.Element | null {
  const outstanding = useModalStore(selectOutstanding)
  const prompt = outstanding[0]
  if (!prompt) return null
  return <PermissionModalView prompt={prompt} />
}
