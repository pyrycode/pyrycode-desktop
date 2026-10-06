import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createQuestionBatchStore, type QuestionBatchStore } from '../../store/questionBatchStore'
import { createQuestionPicksStore, type QuestionPicksStore } from '../../store/questionPicksStore'
import type { Question } from '../../store/questionBatches'
import { createModalStore, type ModalStore } from '../../store/modalStore'

const permissionStore = createModalStore()
vi.mock('../../store/modalStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/modalStore')>()),
  useModalStore: <T,>(selector: (s: ModalStore) => T): T => selector(permissionStore.getState())
}))

// #906: the composer slot's container — does an outstanding batch put the panel where the composer was,
// and does the covered composer survive?
//
// A per-file store instance, NOT the app singleton, and that is load-bearing rather than tidiness:
// zustand's server snapshot is the state captured at store CREATION, so seeding the singleton and then
// rendering would silently assert against the initial cell (questionBatchStore.ts documents its `init`
// seam as existing for exactly this). The ChannelList.test.tsx idiom — spread `importActual` so the
// selectors stay real, override only the hook. The factory body touches none of the consts below; only
// the returned hook reads them, and it is not called until a render inside a test.
const batchStore = createQuestionBatchStore()

vi.mock('../../store/questionBatchStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/questionBatchStore')>()),
  useQuestionBatchStore: <T,>(selector: (s: QuestionBatchStore) => T): T =>
    selector(batchStore.getState())
}))

// #912: the same seam for the PICKS store, and it is owed for the same reason — questionPicksStore.ts's
// `init` docblock names this file's ticket in it. `selectQuestionSelection` and the real singleton stay
// untouched by the spread, so only the React binding is redirected.
const picksStore = createQuestionPicksStore()

vi.mock('../../store/questionPicksStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/questionPicksStore')>()),
  useQuestionPicksStore: <T,>(selector: (s: QuestionPicksStore) => T): T =>
    selector(picksStore.getState())
}))

import { ComposerSlot, QuestionHistorySlot, Timeline } from './ConversationScreen'

const OPEN = 'conv-open'
const OTHER = 'conv-other'

const question = (header: string): Question => ({
  question: `Body of ${header}`,
  header,
  options: [{ label: 'Yes', description: 'affirmative' }],
  multiSelect: false
})

const show = (conversationId: string, questions: readonly Question[]): void => {
  batchStore.getState().dispatch({
    type: 'shown',
    conversationId,
    questionBatchId: `batch-${conversationId}`,
    questions
  })
}

const render = (conversationId: string | null): string => renderToStaticMarkup(<>
  <Timeline items={[]} trailing={<QuestionHistorySlot conversationId={conversationId} />} />
  <ComposerSlot conversationId={conversationId} phase="idle" onMessageSent={() => {}} />
</>)

// `reconnected` is each store's own clear-everything arm, so the reset needs no reach into internals.
beforeEach(() => {
  permissionStore.getState().dispatch({ type: 'reset' })
  batchStore.getState().dispatch({ type: 'reconnected' })
  picksStore.getState().dispatch({ type: 'reconnected' })
})

/** Record a pick under an explicit batch id — the two cases below differ only in which id they use. */
const pick = (questionBatchId: string): void => {
  picksStore
    .getState()
    .dispatch({ type: 'optionPicked', questionBatchId, questionIndex: 0, optionIndex: 0 })
}

describe('inline history and composer', () => {
  it('keeps all questions in history and the composer/footer available', () => {
    show(OPEN, [question('First'), question('Second')])
    pick(`batch-${OPEN}`)
    const html = render(OPEN)
    expect(html).toContain('Body of First')
    expect(html).toContain('Body of Second')
    expect(html).toContain('checked=""')
    expect(html.indexOf('question-batch')).toBeGreaterThan(html.indexOf('conversation__thread'))
    expect(html.indexOf('question-batch')).toBeLessThan(html.indexOf('class="composer"'))
    expect(html).not.toContain('hidden=""')
    expect(html.match(/class="composer__footer"/g)).toHaveLength(1)
  })
  it('hides questionnaire and mounted composer while current-chat permission takes precedence', () => {
    show(OPEN, [question('Waiting question')])
    permissionStore.getState().dispatch({ type: 'shown', conversationId: OPEN, modalId: 'permission',
      class: 'trust', title: 'Trust workspace', prompt: 'Explain trust',
      options: [{ id: 'exit', label: 'Exit' }], defaultOptionId: 'exit' })
    const html = render(OPEN)
    expect(html).toContain('Waiting question')
    expect(html).toContain('permission-panel')
    expect(html.match(/hidden=""/g)).toHaveLength(2)
    expect(html).toContain('class="composer" hidden=""')
    permissionStore.getState().dispatch({ type: 'reset' })
    expect(render(OPEN)).not.toContain('hidden=""')
  })
  it('keeps requests scoped to the owning conversation and nonce', () => {
    show(OPEN, [question('Owned')])
    pick(OPEN)
    expect(render(OPEN)).not.toContain('checked=""')
    expect(render(OTHER)).not.toContain('question-batch')
    expect(render(null)).not.toContain('question-batch')
    expect(render(OTHER)).not.toContain('hidden=""')
  })
})
