import { useEffect, useRef, useState } from 'react'
import { useModalStore, selectOutstanding, selectRejections } from '../../store/modalStore'
import type { ModalOption, ModalPrompt } from '../../store/modalPrompts'
import { PyryMark } from '../../theme/PyryMark'
import { QuestionTick } from './QuestionPanel'
import { canRespondToPromptNow, usePromptResponseAvailability } from './promptResponseAvailability'
import {
  answerPrompt,
  confirmPrompt,
  hasSessionPermission,
  cancelPrompt,
  selectOption,
  resolvePendingOption,
  type PendingConfirm
} from './modalResolution'

const PERMISSION_MODAL_TITLE_ID = 'permission-modal-title'

// Permission and questionnaire share visual structure, but never requests or answer state.
export function PermissionModalView({
  prompt, selectedOption, pendingOption, responseAvailable, onSelect, onContinue, onConfirm, onBack, onCancel,
  sessionPermissionChecked, onSessionPermissionChange
}: {
  prompt: ModalPrompt
  selectedOption: ModalOption | null
  pendingOption: ModalOption | null
  responseAvailable: boolean
  sessionPermissionChecked: boolean
  onSessionPermissionChange: (checked: boolean) => void
  onSelect: (modalId: string, optionId: string) => void
  onContinue: () => void
  onConfirm: (modalId: string, optionId: string) => void
  onBack: () => void
  onCancel: (modalId: string) => void
}): JSX.Element {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const displayedModalId = useRef<string | null>(null)
  useEffect(() => {
    if (displayedModalId.current === prompt.modalId) return
    displayedModalId.current = prompt.modalId
    // Only initial display moves focus; updates, Back and availability changes never steal it.
    if (prompt.defaultToNo === true && responseAvailable) cancelButton.current?.focus()
  }, [prompt.modalId, prompt.defaultToNo, responseAvailable])
  // The inbound parser supplies JSON; keep false, zero and null as meaningful display text.
  const reason = typeof prompt.reason === 'string' ? prompt.reason : JSON.stringify(prompt.reason)
  const reasonLabel = prompt.reasonType === 'classifier' ? 'The auto classifier could not approve this'
    : prompt.reasonType === 'rule' ? 'A permission rule asks'
      : prompt.reasonType !== undefined ? `Reason type: ${prompt.reasonType}` : 'Reason'
  const hasReason = reason !== undefined || prompt.reasonType !== undefined
  const hasContext = hasReason || prompt.description !== undefined || prompt.blockedPath !== undefined
  return (
    <section className="question-panel permission-panel" role="region" aria-labelledby={PERMISSION_MODAL_TITLE_ID}>
      <div className="question-panel__title">
        <PyryMark className="question-panel__mark" width={14} height={16} />
        <h2 id={PERMISSION_MODAL_TITLE_ID} className="question-panel__label permission-panel__title">
          {prompt.title}
        </h2>
      </div>
      <div className="question-panel__box">
        <div className="permission-panel__content">
          {pendingOption ? (
            <p className="question-panel__question permission-panel__explanation">
              Send &quot;{pendingOption.label}&quot;? This grants the requested action.
            </p>
          ) : (
            <>
              <p className="question-panel__question permission-panel__explanation">{prompt.prompt}</p>
              {hasContext && (
                <div className="permission-panel__context">
                  {hasReason && <p className="permission-panel__context-text">
                    {reasonLabel}{reason !== undefined ? `: ${reason}` : ''}
                  </p>}
                  {prompt.description !== undefined && <p className="permission-panel__context-text">{prompt.description}</p>}
                  {prompt.blockedPath !== undefined && <p className="permission-panel__context-text">{prompt.blockedPath}</p>}
                </div>
              )}
              <div className="question-panel__options">
                {prompt.options.map((option) => (
                  <label key={option.id} className="question-panel__option">
                    <input type="radio" name="permission-choice" className="question-panel__input"
                      checked={selectedOption?.id === option.id}
                      onChange={() => onSelect(prompt.modalId, option.id)} />
                    <span className="question-panel__control question-panel__control--radio" aria-hidden="true">
                      {selectedOption?.id === option.id && <span className="question-panel__control-dot" />}
                    </span>
                    <span className="question-panel__option-text question-panel__option-label">
                      {option.label}{option.id === prompt.defaultOptionId && (
                        <span className="permission-panel__default"> Default</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          {prompt.class === 'permission' && prompt.alwaysAllow?.offered === true && (
            <div className="permission-panel__session-offer">
              <label className="question-panel__option">
                <input type="checkbox" className="question-panel__input"
                  checked={sessionPermissionChecked} aria-describedby="permission-session-rules"
                  onChange={(event) => onSessionPermissionChange(event.target.checked)} />
                <span className="question-panel__control question-panel__control--checkbox" aria-hidden="true">
                  {sessionPermissionChecked && <QuestionTick />}
                </span>
                <span className="question-panel__option-text question-panel__option-label">
                  Don't ask again this session for:
                </span>
              </label>
              <ul id="permission-session-rules" className="permission-panel__rules">
                {prompt.alwaysAllow.rules.map((rule, index) => <li key={index}>{rule}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="question-panel__separator" aria-hidden="true" />
        <div className="question-panel__actions">
          {pendingOption ? (
            <>
              <button type="button" className="button-small question-panel__cancel permission-modal__back" onClick={onBack}>
                Back
              </button>
              <button type="button" className="button-small question-panel__continue permission-modal__confirm"
                disabled={!responseAvailable}
                onClick={() => onConfirm(prompt.modalId, pendingOption.id)}>
                Confirm
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button-small question-panel__cancel permission-modal__cancel"
                ref={cancelButton}
                disabled={!responseAvailable}
                onClick={() => onCancel(prompt.modalId)}>
                Cancel
              </button>
              <button type="button" className="button-small question-panel__continue" disabled={!responseAvailable || selectedOption === null}
                onClick={onContinue}>
                Continue
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

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

// Selection is local to this chat instance. Rejection ownership lives as long as the feedback.
export function PermissionModal({ conversationId }: { conversationId: string | null }): JSX.Element | null {
  const outstanding = useModalStore(selectOutstanding)
  const rejections = useModalStore(selectRejections)
  const owners = useModalStore((s) => s.rejectionOwners)
  const dispatch = useModalStore((s) => s.dispatch)
  const [selected, setSelected] = useState<PendingConfirm | null>(null)
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [opted, setOpted] = useState<ModalPrompt | null>(null)
  const prompt = conversationId === null ? undefined
    : outstanding.find((p) => p.conversationId === conversationId)
  const responseAvailable = usePromptResponseAvailability(prompt?.conversationId ?? null)
  const selectedOption = resolvePendingOption(prompt, selected)
  const pendingOption = resolvePendingOption(prompt, pending)
  const sessionPermissionChecked = hasSessionPermission(prompt, opted)
  // Clear invalid markers during render: a removed option must not revive on a later re-delivery.
  if (selected && !selectedOption) setSelected(null)
  if (pending && !pendingOption) setPending(null)
  if (opted && !sessionPermissionChecked) setOpted(null)
  const visibleRejections = conversationId === null ? [] : rejections.filter((id) =>
    owners.some((owner) => owner.modalId === id && owner.conversationId === conversationId))
  return (
    <>
      <RejectionSurfaceView rejections={visibleRejections}
        onDismiss={(modalId) => dispatch({ type: 'rejectionDismissed', modalId })} />
      {prompt && (
        <PermissionModalView
          prompt={prompt}
          responseAvailable={responseAvailable}
          sessionPermissionChecked={sessionPermissionChecked}
          onSessionPermissionChange={(checked) => setOpted(checked ? prompt : null)}
          selectedOption={selectedOption}
          pendingOption={pendingOption}
          onSelect={(modalId, optionId) => setSelected({ modalId, optionId })}
          onContinue={() => {
            if (!selectedOption || !canRespondToPromptNow(prompt.conversationId)) return
            selectOption(prompt, selectedOption.id, {
              answer: (id) => answerPrompt(prompt.modalId, id, { sendCommand: window.pyry.sendCommand, dispatch }),
              requestConfirm: (optionId) => setPending({ modalId: prompt.modalId, optionId })
            })
          }}
          onConfirm={(modalId, optionId) => {
            if (modalId !== prompt.modalId || !pendingOption || pendingOption.id !== optionId
              || !canRespondToPromptNow(prompt.conversationId)) return
            confirmPrompt(prompt, pending, opted, { sendCommand: window.pyry.sendCommand, dispatch })
            setPending(null)
          }}
          onBack={() => setPending(null)}
          onCancel={(modalId) => {
            if (!canRespondToPromptNow(prompt.conversationId)) return
            cancelPrompt(modalId, { sendCommand: window.pyry.sendCommand, dispatch })
          }}
        />
      )}
    </>
  )
}
