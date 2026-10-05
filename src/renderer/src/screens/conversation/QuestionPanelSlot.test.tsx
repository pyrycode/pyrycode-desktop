import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { QuestionPanelView } from './QuestionPanel'
import { questionBatchStore, selectBatchFor } from '../../store/questionBatchStore'
import { questionPicksStore, type QuestionPicksStore } from '../../store/questionPicksStore'
import { activeConversationStore } from '../../store/activeConversationStore'
import { modalStore } from '../../store/modalStore'
import { QuestionPanelSlot } from './ConversationScreen'

let controls: ComponentProps<typeof QuestionPanelView>
vi.mock('./QuestionPanel', async (original) => ({
  ...(await original<typeof import('./QuestionPanel')>()),
  QuestionPanelView: (props: ComponentProps<typeof QuestionPanelView>) => { controls = props; return null }
}))
vi.mock('../../store/questionPicksStore', async (original) => ({
  ...(await original<typeof import('../../store/questionPicksStore')>()),
  useQuestionPicksStore: <T,>(selector: (s: QuestionPicksStore) => T) => selector(questionPicksStore.getState())
}))
vi.mock('./promptResponseAvailability', () => ({ usePromptResponseAvailability: () => true, canRespondToPromptNow: () => true }))
const send = vi.fn()
const show = (id: string, count = 2) => {
  questionBatchStore.getState().dispatch({ type: 'shown', conversationId: 'chat', questionBatchId: id,
    questions: Array.from({ length: count }, () => ({ header: 'H', question: 'Q', multiSelect: false,
      options: [{ label: 'Yes', description: '' }] })) })
  const batch = selectBatchFor('chat')(questionBatchStore.getState())!
  renderToStaticMarkup(<QuestionPanelSlot batch={batch} />)
  return controls
}
beforeEach(() => {
  questionBatchStore.getState().dispatch({ type: 'reconnected' })
  questionPicksStore.getState().dispatch({ type: 'reconnected' })
  modalStore.getState().dispatch({ type: 'reset' })
  activeConversationStore.getState().setActiveConversation({ id: 'chat', cwd: '/chat', is_promoted: true,
    name: 'Chat', last_used_at: '', workspace_label: null })
  send.mockClear()
  vi.stubGlobal('window', { pyry: { sendCommand: send } })
})
it('blocks stale edits/responses after replacement and clears retired picks', () => {
  const old = show('old')
  old.onOtherTextChanged(0, 'retired draft')
  show('new')
  old.onOtherTextChanged(0, 'stale edit'); old.onAnswer(); old.onCancel()
  expect(questionPicksStore.getState().picks.has('old')).toBe(false)
  expect(send).not.toHaveBeenCalled()
  expect(selectBatchFor('chat')(questionBatchStore.getState())?.questionBatchId).toBe('new')
})
it('reads current selections, sends once, and prevents edits recreating a dismissed draft', () => {
  const current = show('batch')
  current.onOptionChosen(0, 0); current.onOtherTextChanged(1, '  Other answer  ')
  current.onAnswer(); current.onAnswer(); current.onCancel(); current.onOtherTextChanged(0, 'stale')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][0].payload.answers).toEqual([{ question_index: 0, values: ['Yes'] }, { question_index: 1, values: ['Other answer'] }])
  expect(questionPicksStore.getState().picks.size).toBe(0)
})
it('invalidates captured callbacks on same-request shrink and reconnect', () => {
  const old = show('batch')
  old.onOptionChosen(1, 0)
  const current = show('batch', 1)
  old.onOtherTextChanged(1, 'removed'); old.onCancel()
  expect(send).not.toHaveBeenCalled()
  current.onOptionChosen(0, 0); current.onAnswer()
  expect(send.mock.calls[0][0].payload.answers).toEqual([{ question_index: 0, values: ['Yes'] }])
  const retired = show('again')
  questionBatchStore.getState().dispatch({ type: 'reconnected' })
  questionPicksStore.getState().dispatch({ type: 'reconnected' })
  retired.onOtherTextChanged(0, 'stale'); retired.onCancel()
  expect(questionPicksStore.getState().picks.size).toBe(0)
  expect(send).toHaveBeenCalledTimes(1)
})
it('permission precedence blocks retained callbacks until resolution', () => {
  const current = show('held')
  modalStore.getState().dispatch({ type: 'shown', conversationId: 'chat', modalId: 'permission',
    class: 'trust', title: 'Trust', prompt: 'Trust?', options: [], defaultOptionId: '' })
  current.onOtherTextChanged(0, 'hidden edit'); current.onCancel()
  expect(send).not.toHaveBeenCalled()
  expect(questionPicksStore.getState().picks.size).toBe(0)
  modalStore.getState().dispatch({ type: 'reset' })
  current.onCancel()
  expect(send).toHaveBeenCalledTimes(1)
})
it('ignores retained callbacks after navigation to another conversation', () => {
  const current = show('held')
  activeConversationStore.getState().setActiveConversation({ id: 'another-host-chat', cwd: '/other',
    is_promoted: true, name: 'Other', last_used_at: '', workspace_label: null })
  current.onOtherTextChanged(0, 'stale'); current.onAnswer(); current.onCancel()
  expect(send).not.toHaveBeenCalled()
  expect(questionPicksStore.getState().picks.size).toBe(0)
})
