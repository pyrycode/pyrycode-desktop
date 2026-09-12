import { useId, type CSSProperties, type ReactNode } from 'react'
import closeIcon from '../assets/modal-close.svg'
import './modal.css'

export interface ModalAction {
  label: string
  disabled?: boolean
  onClick: () => void
}

export interface ModalProps {
  title: string
  children: ReactNode
  cancelAction: ModalAction
  confirmAction: ModalAction
  onClose: () => void
  /** Preferred width in CSS pixels, constrained by the container and viewport. */
  width?: number
}

/** Presentation only: callers own mounting, overlay, focus, Escape and save state. */
export function Modal({
  title, children, cancelAction, confirmAction, onClose, width = 600
}: ModalProps): JSX.Element {
  const titleId = useId()
  const style: CSSProperties & { '--modal-width': string } = { '--modal-width': `${width}px` }
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={style}
    >
      <header className="modal__header">
        <h2 className="modal__title" id={titleId}>{title}</h2>
        <button
          type="button"
          className="modal__close"
          aria-label="Close dialog"
          onClick={() => onClose()}
        >
          <img src={closeIcon} alt="" aria-hidden="true" />
        </button>
      </header>
      <div className="modal__content">{children}</div>
      <footer className="modal__footer">
        <button
          type="button"
          className="modal__action modal__action--cancel"
          disabled={cancelAction.disabled}
          onClick={() => cancelAction.onClick()}
        >
          {cancelAction.label}
        </button>
        <button
          type="button"
          className="modal__action modal__action--confirm"
          disabled={confirmAction.disabled}
          onClick={() => confirmAction.onClick()}
        >
          {confirmAction.label}
        </button>
      </footer>
    </div>
  )
}
