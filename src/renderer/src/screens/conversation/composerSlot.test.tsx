import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createQuestionBatchStore, type QuestionBatchStore } from '../../store/questionBatchStore'
import type { Question } from '../../store/questionBatches'

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

import { ComposerSlot } from './ConversationScreen'
import { QUESTION_CANCEL_COPY } from './QuestionPanel'

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

const render = (conversationId: string | null): string =>
  renderToStaticMarkup(
    <ComposerSlot conversationId={conversationId} phase="idle" onMessageSent={() => {}} />
  )

// `reconnected` is the store's own clear-everything arm, so the reset needs no reach into internals.
beforeEach(() => batchStore.getState().dispatch({ type: 'reconnected' }))

describe('ComposerSlot', () => {
  it('renders the composer untouched when no batch is outstanding', () => {
    const markup = render(OPEN)
    expect(markup).toContain('class="composer"')
    expect(markup).not.toContain('hidden=""')
    expect(markup).not.toContain('question-panel')
  })

  it('draws the panel and covers the whole composer when a batch is outstanding', () => {
    show(OPEN, [question('Language choice')])
    const markup = render(OPEN)
    expect(markup).toContain('question-panel')
    expect(markup).toContain('>Language choice<')
    expect(markup).toContain(QUESTION_CANCEL_COPY)
    // AC2/AC3: ONE attribute, on .composer, doing all three jobs — hidden from paint, out of the tab
    // order, out of the accessibility tree — while leaving the subtree mounted.
    expect(markup).toContain('class="composer" hidden=""')
    expect(markup.match(/hidden=""/g)).toHaveLength(1)
  })

  it('keeps the covered composer in the tree rather than unmounting it', () => {
    show(OPEN, [question('Language choice')])
    const markup = render(OPEN)
    // The message box, the send control and the footer are all still rendered — hidden, not discarded —
    // which is what lets a half-typed draft (Composer's own useState) survive the batch (AC3).
    expect(markup).toContain('class="composer__input"')
    expect(markup).toContain('class="composer__send"')
    expect(markup).toContain('class="composer__footer"')
    // .composer__footer is a CHILD of .composer, so the one cover takes the footer row with it — there is
    // no second element to hide separately.
    expect(markup.indexOf('class="composer" hidden=""')).toBeLessThan(
      markup.indexOf('class="composer__footer"')
    )
  })

  it('covers nothing outside .composer, so the status area above it stays visible', () => {
    // ComposerStatusArea is a SIBLING of .composer mounted by ConversationScreen, not a descendant and
    // not this container's child: the slot renders no status markup at all, in either state, so the
    // cover structurally cannot reach it (AC2).
    expect(render(OPEN)).not.toContain('composer-status')
    show(OPEN, [question('Language choice')])
    expect(render(OPEN)).not.toContain('composer-status')
  })

  it('leaves the composer alone for a batch belonging to another conversation', () => {
    show(OTHER, [question('Someone else’s question')])
    const markup = render(OPEN)
    expect(markup).not.toContain('question-panel')
    expect(markup).not.toContain('hidden=""')
  })

  it('leaves the composer alone with no conversation open', () => {
    // An explicit null test, never `?? ''`: an empty-string id stays an ordinary key rather than
    // collapsing into "nothing open".
    show('', [question('Empty-id batch')])
    const markup = render(null)
    expect(markup).not.toContain('question-panel')
    expect(markup).not.toContain('hidden=""')
  })

  it('draws the first question of a batch carrying several', () => {
    show(OPEN, [question('First'), question('Second')])
    const markup = render(OPEN)
    expect(markup).toContain('>First<')
    expect(markup).not.toContain('>Second<')
  })
})
