import { useEffect, useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import { modalStore } from '../../store/modalStore'
import { activeConversationStore } from '../../store/activeConversationStore'
import { conversationListStore, selectConversations } from '../../store/conversationListStore'
import { sessionStore } from '../../store/sessionStore'
import { serverIdForOpenConversation } from './unpairAction'
import { createPermissionChoices } from './permissionChoices'
import { createPermissionConsent } from './permissionConsent'
import { useModalStore, selectOutstanding, selectRejections } from '../../store/modalStore'
import type { ModalOption, ModalPrompt } from '../../store/modalPrompts'
import { QuestionTick } from './QuestionPanel'
import { canRespondToPromptNow, usePromptResponseAvailability } from './promptResponseAvailability'
const PERMISSION_MODAL_TITLE_ID = 'permission-modal-title'

// App-process lifetime: closed panes must still observe invalidating transitions.
const permissionConsent = createPermissionConsent(() => {
  const rows = selectConversations(conversationListStore.getState())
  return modalStore.getState().outstanding.map(prompt => ({ prompt,
    serverId: serverIdForOpenConversation(rows, prompt.conversationId) }))
}, changed => {
  const offs = [modalStore.subscribe(changed), conversationListStore.subscribe(changed)]
  return () => offs.forEach(off => off())
})

// Permission and questionnaire share visual structure, but never requests or answer state.
export function PermissionModalView({
  prompt, armedOption, responseAvailable, onActivate, onCancel,
  sessionPermissionChecked, onSessionPermissionChange
}: {
  prompt: ModalPrompt
  armedOption: ModalOption | null
  responseAvailable: boolean
  sessionPermissionChecked: boolean
  onSessionPermissionChange: (checked: boolean) => void
  onActivate: (optionId: string) => void
  onCancel: (modalId: string) => void
}): JSX.Element {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const displayedModalId = useRef<string | null>(null)
  useEffect(() => {
    if (displayedModalId.current === prompt.modalId) return
    displayedModalId.current = prompt.modalId
    // Only initial display moves focus; updates and availability changes never steal it.
    if (prompt.defaultToNo === true && responseAvailable) cancelButton.current?.focus({ preventScroll: true })
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
      <div className="question-panel__box">
        <div className="permission-panel__content">
          <div className="question-panel__title">
            <h2 id={PERMISSION_MODAL_TITLE_ID} className="question-panel__label permission-panel__title">
              {prompt.title}
            </h2>
          </div>
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
          {prompt.class === 'permission' && prompt.alwaysAllow?.offered === true && (
            <div className="permission-panel__session-offer">
              <label className="question-panel__option">
                <input type="checkbox" className="question-panel__input"
                  disabled={!responseAvailable} checked={sessionPermissionChecked} aria-describedby="permission-session-rules"
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
          <div className="permission-panel__choices">
            {prompt.options.map(option => (
              <div key={option.id}>
                <button type="button"
                  className={`permission-panel__choice${option.id === prompt.defaultOptionId ? ' permission-panel__choice--default' : armedOption?.id === option.id ? ' permission-panel__choice--armed' : ''}`}
                  disabled={!responseAvailable}
                  aria-describedby={armedOption?.id === option.id ? 'permission-choice-confirm' : undefined}
                  onClick={() => onActivate(option.id)}>{option.label}</button>
                {armedOption?.id === option.id && <p id="permission-choice-confirm" className="permission-panel__instruction" role="status">
                  Activate this choice again to confirm.
                </p>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="button-small question-panel__cancel permission-modal__cancel"
        ref={cancelButton} disabled={!responseAvailable} onClick={() => onCancel(prompt.modalId)}>Cancel</button>
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

// Arming is pane-local; checked consent observes request/owner transitions app-wide.
export function PermissionModal({ conversationId }: { conversationId: string | null }): JSX.Element | null {
  const outstanding = useModalStore(selectOutstanding)
  const rejections = useModalStore(selectRejections)
  const owners = useModalStore((s) => s.rejectionOwners)
  const dispatch = useModalStore((s) => s.dispatch)
  const control = useMemo(() => createPermissionChoices(() => {
    const displayed = activeConversationStore.getState().activeConversation?.id === conversationId
    const prompt = displayed ? modalStore.getState().outstanding.find(p => p.conversationId === conversationId) : undefined
    const serverId = serverIdForOpenConversation(selectConversations(conversationListStore.getState()), conversationId)
    return { prompt, serverId,
      available: serverId !== null && sessionStore.getState().statuses.get(serverId)?.type === 'connected' }
  }, changed => {
    const offs = [modalStore, activeConversationStore, conversationListStore, sessionStore].map(store => store.subscribe(changed))
    return () => offs.forEach(off => off())
  }, { sendCommand: command => {
    if (canRespondToPromptNow(conversationId)) window.pyry.sendCommand(command)
  }, dispatch,
    report: code => window.pyry.sendDiagnostic?.({ event: 'permission-choice', code }) }, permissionConsent), [conversationId, dispatch])
  useEffect(() => control.start(), [control])
  const { armedOptionId } = useStore(control.store)
  const prompt = conversationId === null ? undefined : outstanding.find(p => p.conversationId === conversationId)
  const rows = useStore(conversationListStore, selectConversations)
  const displayedServerId = serverIdForOpenConversation(rows, conversationId)
  const responseAvailable = usePromptResponseAvailability(prompt?.conversationId ?? null)
  const armedOption = prompt?.options.find(o => o.id === armedOptionId) ?? null
  const sessionPermissionChecked = control.checked(prompt)
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
          onSessionPermissionChange={checked => control.toggle(prompt, checked, displayedServerId)}
          armedOption={armedOption}
          onActivate={optionId => control.activate(prompt, optionId, displayedServerId)}
          onCancel={() => control.cancel(prompt, displayedServerId)}
        />
      )}
    </>
  )
}
