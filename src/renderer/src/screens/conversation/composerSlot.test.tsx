import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createQuestionBatchStore, type QuestionBatchStore } from '../../store/questionBatchStore'
import { createQuestionPicksStore, type QuestionPicksStore } from '../../store/questionPicksStore'
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

// #912: the same seam for the PICKS store, and it is owed for the same reason — questionPicksStore.ts's
// `init` docblock names this file's ticket in it. `selectQuestionSelection` and the real singleton stay
// untouched by the spread, so only the React binding is redirected.
const picksStore = createQuestionPicksStore()

vi.mock('../../store/questionPicksStore', async (importActual) => ({
  ...(await importActual<typeof import('../../store/questionPicksStore')>()),
  useQuestionPicksStore: <T,>(selector: (s: QuestionPicksStore) => T): T =>
    selector(picksStore.getState())
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

// `reconnected` is each store's own clear-everything arm, so the reset needs no reach into internals.
beforeEach(() => {
  batchStore.getState().dispatch({ type: 'reconnected' })
  picksStore.getState().dispatch({ type: 'reconnected' })
})

/** Record a pick under an explicit batch id — the two cases below differ only in which id they use. */
const pick = (questionBatchId: string): void => {
  picksStore
    .getState()
    .dispatch({ type: 'optionPicked', questionBatchId, questionIndex: 0, optionIndex: 0 })
}

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

  it('opens a batch carrying several on its first question, with a tab for each', () => {
    show(OPEN, [question('First'), question('Second')])
    const markup = render(OPEN)
    // #915 draws EVERY header, as tabs, so "which question is showing" moved to the box's own text. The
    // panel opens on the first — FIRST_QUESTION_INDEX seeds the slot's state, and a static render never
    // leaves it, which is also why the jump itself is Playwright's.
    expect(markup).toContain('Body of First')
    expect(markup).not.toContain('Body of Second')
    expect(markup).toContain('>First<')
    expect(markup).toContain('>Second<')
  })

  // #912 — the picks read. The view is proven against injected props in QuestionPanel.test.tsx; what only
  // this file can prove is that the container hands it the RIGHT selection.
  it('draws the panel against the picks held under the batch nonce', () => {
    show(OPEN, [question('Language choice')])
    pick(`batch-${OPEN}`)
    const markup = render(OPEN)
    expect(markup).toContain('question-panel__control-dot')
    expect(markup).toContain('checked=""')
  })

  it('ignores picks keyed on the conversation id rather than the batch nonce', () => {
    // THE SUBSTITUTION WOULD COMPILE CLEAN — both keys are `string`, and this container holds both. Keying
    // on the conversation is also the WRONG semantics, not just the wrong value: a batch dismissed and
    // immediately replaced for the same conversation would inherit the retired one's picks, which is the
    // half of AC4 the nonce gives for free.
    show(OPEN, [question('Language choice')])
    pick(OPEN)
    const markup = render(OPEN)
    expect(markup).toContain('question-panel')
    expect(markup).not.toContain('question-panel__control-dot')
    expect(markup).not.toContain('checked=""')
  })
})
