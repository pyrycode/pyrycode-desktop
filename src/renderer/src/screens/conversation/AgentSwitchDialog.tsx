import { useCallback, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { Modal } from '../../components/Modal'
import { agentSwitchStore, type AgentSwitchStatus } from '../../store/agentSwitchStore'
import { composerModelRowLabel } from './ComposerModelMenu'

/** Shared modal presentation with caller-owned focus and dismissal. No menu entry point. */
export function AgentSwitchDialog(props: {
  attempt?: Omit<Extract<AgentSwitchStatus, { type: 'pending' }>, 'type'>
  onCancel?: () => void
  onConfirm?: () => void
} = {}): JSX.Element | null {
  const held = useStore(agentSwitchStore, s => s.dialog)
  const attempt = props.attempt ?? held
  const root = useRef<HTMLDivElement>(null)
  const cancel = useCallback(() => {
    if (props.onCancel !== undefined) props.onCancel()
    else agentSwitchStore.getState().dispatch({ type: 'cancel' })
  }, [props.onCancel])
  useEffect(() => {
    if (attempt === null) return
    const previous = document.activeElement
    root.current?.querySelector<HTMLButtonElement>('.modal__action--cancel')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation()
        cancel()
      } else if (event.key === 'Tab') {
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>('button')
        if (!buttons?.length) return
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [attempt, cancel])
  if (attempt === null) return null
  const outgoing = attempt.outgoing === 'codex' ? 'Codex' : 'Claude'
  const target = attempt.target === 'codex' ? 'Codex' : 'Claude'
  return (
    <div className="agent-switch-overlay" ref={root}>
      <div className="agent-switch-overlay__scrim" aria-hidden="true" />
      <Modal title={`Switch to ${target}?`} width={640} onClose={cancel}
        cancelAction={{ label: 'Cancel', onClick: cancel }}
        confirmAction={{ label: 'Switch', onClick: props.onConfirm ?? (() => agentSwitchStore.getState().dispatch({ type: 'confirm' })) }}>
        <p className="agent-switch__copy">{`This channel moves from ${outgoing} to ${composerModelRowLabel(attempt.row)} on ${target}. ${outgoing} writes a hand-over note first, and ${target} continues from it. The first reply after the switch costs more, and full-bypass mode turns off.`}</p>
      </Modal>
    </div>
  )
}
