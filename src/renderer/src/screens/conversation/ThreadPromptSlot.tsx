import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { threadRuntime } from '../../store/threadRuntime'
import { selectThreadReadings } from '../../store/threadLiveState'
import { translateModalEvent } from '../../store/modalBridge'
import { translateQuestionEvent } from '../../store/questionBridge'
import { createPermissionChoices } from './permissionChoices'
import { PermissionModalView } from './PermissionModal'
import { createQuestionPicksStore, selectBatchSelections } from '../../store/questionPicksStore'
import { resolveQuestionAnswers } from './questionResolution'
import { QuestionPanelView, optionPickEventFor, otherPickEventFor } from './QuestionPanel'
import { sessionStore } from '../../store/sessionStore'

/** Existing prompt views with session-owned readings and exact retained response authority. */
export function ThreadPromptSlot({ host, conversationId }: { host: string | null; conversationId: string | null }): JSX.Element | null {
  const live = useMemo(() => threadRuntime.live(host ?? '', conversationId ?? ''), [host, conversationId])
  const state = useStore(live, s => s)
  const connected = useStore(sessionStore, s => host !== null && s.statuses.get(host)?.type === 'connected')
  const permission = selectThreadReadings(state, 'modalShown')[0]
  const question = selectThreadReadings(state, 'questionShown')[0]
  const batch = question ? translateQuestionEvent(question) : null
  const scope = useMemo(() => {
    let previous: typeof permission, prompt: ReturnType<typeof translateModalEvent>
    const read = () => {
      const displayed = selectThreadReadings(live.getState(), 'modalShown')[0]
      if (displayed !== previous) { previous = displayed; prompt = displayed ? translateModalEvent(displayed, () => new Set()) : null }
      return { prompt: prompt?.type === 'shown' ? prompt : undefined, serverId: host,
        available: host !== null && sessionStore.getState().statuses.get(host)?.type === 'connected' }
    }
    const choices = createPermissionChoices(read, changed => {
      const off = live.subscribe(changed), offLink = sessionStore.subscribe(changed)
      return () => { off(); offLink() }
    }, { sendCommand: command => {
      const displayed = selectThreadReadings(live.getState(), 'modalShown')[0]
      if (displayed && (command.type === 'answerModal' || command.type === 'cancelModal')) live.getState().respond(displayed, command)
    }, dispatch: () => {} })
    return { choices, read }
  }, [live, host])
  const { choices } = scope
  useEffect(() => choices.start(), [choices])
  const choice = useStore(choices.store, s => s)
  const prompt = scope.read().prompt
  const picks = useMemo(() => createQuestionPicksStore(), [question])
  const selections = useStore(picks, selectBatchSelections(question?.questionBatchId ?? ''))
  const answers = batch?.type === 'shown' ? resolveQuestionAnswers(batch.questions, selections) : null
  if (prompt) return <PermissionModalView prompt={prompt}
    armedOption={prompt.options.find(option => option.id === choice.armedOptionId) ?? null}
    responseAvailable={connected} sessionPermissionChecked={choices.checked(prompt)}
    onSessionPermissionChange={checked => choices.toggle(prompt, checked)}
    onActivate={id => choices.activate(prompt, id)} onCancel={() => choices.cancel(prompt)} />
  if (!question || batch?.type !== 'shown') return null
  return <QuestionPanelView questions={batch.questions} selections={selections} canAnswer={answers !== null}
    responseAvailable={connected} onCancel={() => live.getState().respond(question,
      { type: 'refuseQuestions', payload: { question_batch_id: question.questionBatchId } })}
    onAnswer={() => { if (answers) live.getState().respond(question,
      { type: 'answerQuestions', payload: { question_batch_id: question.questionBatchId, answers } }) }}
    onOptionChosen={(questionIndex, optionIndex) => {
      const q = question.questions[questionIndex]
      if (q) picks.getState().dispatch(optionPickEventFor({ questionBatchId: question.questionBatchId, questionIndex, optionIndex, multiSelect: q.multi_select }))
    }} onOtherChosen={questionIndex => {
      const q = question.questions[questionIndex]
      if (q) picks.getState().dispatch(otherPickEventFor({ questionBatchId: question.questionBatchId, questionIndex, multiSelect: q.multi_select }))
    }} onOtherTextChanged={(questionIndex, text) => {
      const q = question.questions[questionIndex]
      if (q) picks.getState().dispatch({ type: 'otherTextChanged', questionBatchId: question.questionBatchId, questionIndex, text, multiSelect: q.multi_select })
    }} />
}
