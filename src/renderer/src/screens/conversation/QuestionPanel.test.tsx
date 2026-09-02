import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  QuestionPanelView,
  optionPickEventFor,
  otherPickEventFor,
  QUESTION_CANCEL_COPY,
  QUESTION_CONTINUE_COPY,
  QUESTION_PREVIOUS_COPY,
  QUESTION_NEXT_COPY,
  QUESTION_OTHER_PLACEHOLDER_COPY,
  QUESTION_OTHER_TICK_COPY
} from './QuestionPanel'
import type { Question } from '../../store/questionBatches'
import type { QuestionSelection } from '../../store/questionPicksStore'

// The #218 idiom: server-render the pure view with injected fixtures — no DOM harness, no store. Every
// assertion here is on markup, which is all `environment: 'node'` can see; the container's store read is
// composerSlot.test.tsx's, and clicking anything is #912's Playwright spec.
//
// #912 MADE THE VIEW TAKE ITS SELECTION AS A PROP, which is what keeps every render below a plain
// static one: the picked and ticked states are a pure function of `selection`, so no store and no
// `vi.mock` is needed here at all — the seeding seam questionPicksStore.ts documents is only owed by
// the CONTAINER's test, one file over.

const question = (over: Partial<Question> = {}): Question => ({
  question: 'Which of these three programming languages should you learn next?',
  header: 'Language choice',
  options: [
    { label: 'Rust', description: 'systems' },
    { label: 'Elixir', description: 'concurrent' }
  ],
  multiSelect: false,
  ...over
})

/** The store's own untouched shape, spread-overridden per case — mirroring `EMPTY_QUESTION_SELECTION`
 *  rather than importing it (it is deliberately not exported: a consumer needs the selector). */
const selection = (over: Partial<QuestionSelection> = {}): QuestionSelection => ({
  optionIndices: [],
  otherText: '',
  otherTicked: false,
  ...over
})

// `canAnswer` DEFAULTS TO TRUE — the answerable baseline, so every pre-#922 case above renders the row
// exactly as it shipped and the gate is opt-in per case. The view holds no picks beyond the active
// question's, so this is a prop rather than something derivable here: the container computes it from the
// whole batch's selections through the one function that also builds the frame.
const renderBatch = (
  questions: readonly Question[],
  activeIndex: number,
  picked: QuestionSelection = selection(),
  canAnswer = true
): string =>
  renderToStaticMarkup(
    <QuestionPanelView
      questions={questions}
      activeIndex={activeIndex}
      selection={picked}
      canAnswer={canAnswer}
      onQuestionSelected={() => {}}
      onCancel={() => {}}
      onAnswer={() => {}}
      onOptionChosen={() => {}}
      onOtherChosen={() => {}}
      onOtherTextChanged={() => {}}
    />
  )

/** The one-question batch, which is every pre-#915 case: same panel, and the row draws a bare label. */
const render = (q: Question, picked: QuestionSelection = selection()): string =>
  renderBatch([q], 0, picked)

const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0

/** Just the title row's labels, so a tab assertion cannot be satisfied by the Cancel/Continue buttons or by
 *  anything inside the bordered box below. */
const labelsRow = (markup: string): string =>
  markup.slice(
    markup.indexOf('question-panel__labels'),
    markup.indexOf('question-panel__box')
  )

describe('QuestionPanelView', () => {
  it('draws the header in the title row and the question in the box', () => {
    const markup = render(question())
    expect(markup).toContain('>Language choice<')
    expect(markup).toContain('Which of these three programming languages should you learn next?')
  })

  it('renders the Cancel / Continue row, with Cancel drawn exactly as #906 shipped it', () => {
    const markup = render(question())
    expect(markup).toContain(QUESTION_CANCEL_COPY)
    expect(markup).toContain(QUESTION_CONTINUE_COPY)
    // Two buttons, both type="button" (never a submit), and no handler reaches the markup. `disabled` is
    // deliberately ABSENT: the panel sits on top of the composer, so there is no disabled state to draw.
    expect(count(markup, /<button type="button"/g)).toBe(2)
    expect(markup).not.toContain('disabled')
    // #921 — THE ASSERTION IS THE NEGATIVE, and it is the only visual claim this slice owes: Cancel gained
    // a handler and the design read (347:6657) confirms its treatment is unchanged, so the rendered button
    // must be byte-identical to #906's. A static server render never emits `onClick`, so this cannot prove
    // the wiring — that is e2e/question-cancel-refuses.spec.ts's — but it DOES prove nothing leaked into an
    // attribute, which is the failure this panel guards against everywhere else (the batch id is a
    // one-time nonce and this file still never reads it at all).
    expect(markup).toContain(
      `<button type="button" class="question-panel__cancel">${QUESTION_CANCEL_COPY}</button>`
    )
  })

  it('draws the separator and the pyry mark, both decorative', () => {
    const markup = render(question())
    expect(markup).toContain('question-panel__separator')
    // The title row's glyph IS the shipped brand mark, not a re-downloaded Figma asset (PyryMark.tsx).
    expect(count(markup, /<svg class="question-panel__mark"/g)).toBe(1)
    expect(markup).toContain('aria-hidden="true"')
  })

  // #907 — the option rows. The two variants differ by the control's modifier class and by nothing else;
  // the counts below are the fixture's two options PLUS the Other row, which is always last (AC1, AC3).
  it('draws a radio row per option in the held order when multiSelect is false', () => {
    const markup = render(question())
    expect(count(markup, /question-panel__control--radio/g)).toBe(3)
    expect(markup).not.toContain('question-panel__control--checkbox')
    expect(markup.indexOf('Rust')).toBeLessThan(markup.indexOf('Elixir'))
  })

  it('draws a checkbox row per option when multiSelect is true', () => {
    const markup = render(question({ multiSelect: true }))
    expect(count(markup, /question-panel__control--checkbox/g)).toBe(3)
    expect(markup).not.toContain('question-panel__control--radio')
  })

  it('stacks each option label over its description', () => {
    const markup = render(question())
    expect(markup).toContain('question-panel__option-label">Rust<')
    expect(markup).toContain('question-panel__option-description">systems<')
    expect(markup.indexOf('>Rust<')).toBeLessThan(markup.indexOf('>systems<'))
  })

  it('draws no description line for an option whose description is empty', () => {
    // `description` is a required `string`, so `''` is legal traffic rather than a missing field. AC5: it
    // contributes NO element, not a blank one holding height.
    const markup = render(
      question({
        options: [
          { label: 'Rust', description: '' },
          { label: 'Elixir', description: 'concurrent' }
        ]
      })
    )
    expect(count(markup, /question-panel__option-description/g)).toBe(1)
    expect(markup).toContain('question-panel__option-label">Rust<')
  })

  it('draws every control clear on an untouched selection, whatever the design mock shows selected', () => {
    // The Figma mock has row 1 selected and every checkbox ticked; AC4 says a batch opens clear. #907
    // proved this against a control that COULD NOT hold a selection; now that it can, the observable is
    // the selector child's absence and the native control's own unchecked state (AC4).
    const markup = render(question({ multiSelect: true }))
    expect(markup).not.toContain('question-panel__control-dot')
    expect(markup).not.toContain('question-panel__control-tick')
    expect(markup).not.toContain('checked')
    // Three real controls all the same, so the clear render is not one row's accident.
    expect(count(markup, /type="checkbox"/g)).toBe(3)
  })

  it('ends the list with an Other row carrying a live free-text field', () => {
    const markup = render(question({ multiSelect: true }))
    expect(markup).toContain(`placeholder="${QUESTION_OTHER_PLACEHOLDER_COPY}"`)
    // An accessible name, since a placeholder alone is only a last-resort one. Both are client-owned copy.
    expect(markup).toContain(`aria-label="${QUESTION_OTHER_PLACEHOLDER_COPY}"`)
    expect(markup).toContain('type="text"')
    // #907's `not.toContain('value=')` is DELIBERATELY INVERTED, not deleted: it asserted the inert,
    // uncontrolled posture this slice exists to overturn. A controlled field renders its value, and an
    // untouched selection's value is the empty string rather than an absent attribute.
    expect(markup).toContain('value=""')
    // Last in the list, wearing the variant's own chrome so it can sit ticked beside ticked labels.
    expect(markup.indexOf(QUESTION_OTHER_PLACEHOLDER_COPY)).toBeGreaterThan(markup.indexOf('Elixir'))
    expect(markup).toContain('question-panel__control--checkbox question-panel__control--other')
    // Its tick is a SECOND control beside the field, so it carries its own client-owned accessible name —
    // the Other row cannot be one implicit <label> the way an option row is (a label binds its first
    // labelable descendant, so every click into the field would toggle the tick).
    expect(markup).toContain(`aria-label="${QUESTION_OTHER_TICK_COPY}"`)
  })

  // #912 — the picked and ticked renders. Every case below injects a `selection` and asserts the markup it
  // produces, which is the whole benefit of the view staying a pure function of its props.
  it('draws the dot in the picked radio row and in no other', () => {
    const markup = render(question(), selection({ optionIndices: [1] }))
    expect(count(markup, /question-panel__control-dot/g)).toBe(1)
    // The dot is INSIDE the second row: everything before it in document order is the first row's, so a
    // dot landing on the wrong row moves this boundary. Elixir's label opens that row's text stack.
    expect(markup.indexOf('question-panel__control-dot')).toBeGreaterThan(markup.indexOf('>Rust<'))
    expect(markup.indexOf('question-panel__control-dot')).toBeLessThan(markup.indexOf('>Elixir<'))
    // The native control agrees with the drawn treatment — the two are asserted together so neither can
    // stand in for the other.
    expect(count(markup, /checked=""/g)).toBe(1)
  })

  it('draws a tick per ticked checkbox row, several at once', () => {
    const markup = render(question({ multiSelect: true }), selection({ optionIndices: [0, 1] }))
    expect(count(markup, /question-panel__control-tick/g)).toBe(2)
    expect(count(markup, /checked=""/g)).toBe(2)
    // The Other row is untouched by option ticks — its control stays clear.
    expect(count(markup, /type="checkbox"/g)).toBe(3)
  })

  it('holds the typed Other text in the field and ticks the row beside ticked labels', () => {
    // AC2's multi-select half: typed text becomes the answer value itself, so the Other row sits ticked
    // ALONGSIDE ticked option labels rather than replacing them.
    const markup = render(
      question({ multiSelect: true }),
      selection({ optionIndices: [0], otherText: 'Zig', otherTicked: true })
    )
    expect(markup).toContain('value="Zig"')
    expect(count(markup, /question-panel__control-tick/g)).toBe(2)
    expect(count(markup, /checked=""/g)).toBe(2)
  })

  it('holds Other text typed into an un-ticked row', () => {
    // The store holds `otherText` INDEPENDENTLY of `otherTicked`, so typing into an un-ticked row is
    // ordinary traffic and the view must render that pair rather than gate the value on the tick.
    const markup = render(question(), selection({ otherText: 'Zig' }))
    expect(markup).toContain('value="Zig"')
    expect(markup).not.toContain('checked')
  })

  it('escapes operator-typed Other text on the same footing as claude’s own strings', () => {
    // The one string here the daemon did not author. It is still bound into a controlled value, so React's
    // attribute escaping is what keeps it inert.
    const markup = render(question(), selection({ otherText: '"><img src=x onerror=alert(1)>' }))
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;')
  })

  it('maps each variant to the store arm its behaviour needs', () => {
    // `optionPicked`/`optionToggled` and `otherPicked`/`otherToggled` carry IDENTICAL payloads and differ
    // only in the `type` literal, so a transposed arm compiles clean and `tsc` sees nothing. The store is
    // told which behaviour the question wants rather than reading `multiSelect` off the held batch, which
    // makes this mapping the single place the distinction can be lost.
    const at = { questionBatchId: 'batch-1', questionIndex: 0 }
    expect(optionPickEventFor({ ...at, multiSelect: false, optionIndex: 2 })).toEqual({
      type: 'optionPicked',
      questionBatchId: 'batch-1',
      questionIndex: 0,
      optionIndex: 2
    })
    expect(optionPickEventFor({ ...at, multiSelect: true, optionIndex: 2 })).toEqual({
      type: 'optionToggled',
      questionBatchId: 'batch-1',
      questionIndex: 0,
      optionIndex: 2
    })
    expect(otherPickEventFor({ ...at, multiSelect: false })).toEqual({
      type: 'otherPicked',
      questionBatchId: 'batch-1',
      questionIndex: 0
    })
    expect(otherPickEventFor({ ...at, multiSelect: true })).toEqual({
      type: 'otherToggled',
      questionBatchId: 'batch-1',
      questionIndex: 0
    })
  })

  it('escapes both claude-authored strings rather than interpreting them as markup', () => {
    // `header` and `question` crossed the subprocess trust boundary and the daemon neither bounds nor
    // sanitizes them. React auto-escaping is this slice's whole boundary (AC4).
    const markup = render(
      question({
        header: '<img src=x onerror=alert(1)>',
        question: '<script>alert(2)</script> & "quoted"'
      })
    )
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).toContain('&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;quoted&quot;')
    // No element ever opens. `onerror=alert(1)` DOES survive as a substring, and correctly so: inside an
    // escaped text node it is inert characters, not an attribute. The property that matters is that no
    // `<` from claude's string reaches the markup as markup.
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<script')
  })

  it('escapes the option strings too — they are claude-authored on the same footing', () => {
    const markup = render(
      question({ options: [{ label: '<img src=x onerror=alert(1)>', description: '<script>x</script>' }] })
    )
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<script')
  })

  it('puts no claude-authored string into an attribute', () => {
    // The trap this component invites: the question text is clamped to one line with an ellipsis, and the
    // reflex accompaniment to a clamp is `title={question.question}` — claude-authored text in an
    // ATTRIBUTE, which questionBatchStore.ts's header bans by name. Same for any data-* derived from it,
    // and the same for an option's label, which is the option's only identity and so invites `key`/`id`.
    const markup = render(
      question({
        header: 'HEADER-SENTINEL',
        question: 'QUESTION-SENTINEL',
        options: [{ label: 'LABEL-SENTINEL', description: 'DESCRIPTION-SENTINEL' }]
      })
    )
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('data-')
    expect(markup).not.toContain('id=')
    // Each sentinel appears exactly once, as element content: an attribute copy would make it two.
    for (const sentinel of ['HEADER', 'QUESTION', 'LABEL', 'DESCRIPTION']) {
      expect(count(markup, new RegExp(`${sentinel}-SENTINEL`, 'g'))).toBe(1)
    }
  })

  // #915 — the header tabs. `question-panel__labels` (the ROW) shares a prefix with
  // `question-panel__label` (a TAB), so every count below anchors on the class token's own boundary.
  const tabCount = (markup: string): number => count(markup, /question-panel__label[" ]/g)

  const batch = (...headers: string[]): Question[] =>
    headers.map((header, index) =>
      question({ header, question: `Body of ${header}`, multiSelect: index % 2 === 1 })
    )

  it('draws one tab per question, in the batch’s own order, carrying each header', () => {
    const markup = renderBatch(batch('Alpha', 'Beta', 'Gamma'), 0)
    expect(tabCount(markup)).toBe(3)
    expect(markup).toContain('>Alpha<')
    expect(markup).toContain('>Beta<')
    expect(markup).toContain('>Gamma<')
    expect(markup.indexOf('>Alpha<')).toBeLessThan(markup.indexOf('>Beta<'))
    expect(markup.indexOf('>Beta<')).toBeLessThan(markup.indexOf('>Gamma<'))
  })

  it('marks exactly one tab active and every other inactive', () => {
    const markup = renderBatch(batch('Alpha', 'Beta', 'Gamma'), 1)
    // The two treatments are asserted together so neither can stand in for the other: aria-current is the
    // non-visual half (the states differ only in colour, which a screen reader cannot hear), the modifier
    // class is the drawn half.
    expect(count(markup, /aria-current="true"/g)).toBe(1)
    expect(count(markup, /question-panel__label--inactive/g)).toBe(2)
    // On the SECOND tab: everything before it in document order belongs to the first.
    expect(markup.indexOf('aria-current')).toBeGreaterThan(markup.indexOf('>Alpha<'))
    expect(markup.indexOf('aria-current')).toBeLessThan(markup.indexOf('>Gamma<'))
  })

  it('draws the active question’s own text, options and control variant', () => {
    const markup = renderBatch(
      [
        question({ header: 'Alpha', question: 'The first body' }),
        question({
          header: 'Beta',
          question: 'The second body',
          multiSelect: true,
          options: [{ label: 'Swift', description: 'apple' }]
        })
      ],
      1
    )
    expect(markup).toContain('The second body')
    expect(markup).not.toContain('The first body')
    expect(markup).toContain('>Swift<')
    expect(markup).not.toContain('>Rust<')
    // AC3's last clause: the jumped-to question brings its OWN row style, not the one the panel opened with.
    expect(markup).toContain('question-panel__control--checkbox')
    expect(markup).not.toContain('question-panel__control--radio')
  })

  it('offers no jump affordance at all for a one-question batch', () => {
    // AC4. A focusable control that re-selects the question already on screen is not "unchanged", so the
    // single label stays the shipped <span> — scoped to the labels row, since Cancel/Continue are buttons.
    const row = labelsRow(render(question()))
    expect(tabCount(row)).toBe(1)
    expect(row).not.toContain('<button')
    expect(row).not.toContain('aria-current')
    expect(row).not.toContain('question-panel__label--inactive')
  })

  it('keys the tabs by position, so two byte-identical headers stay two tabs', () => {
    // The observable consequence of `key={index}` (a React key is invisible in static markup). Keying by
    // `header` is the failure questionBatches.ts and WireQuestion each name by hand — claude-authored text
    // in a lookup path — and it would collapse these two rows into one.
    const markup = renderBatch(batch('Language choice', 'Language choice'), 0)
    expect(tabCount(markup)).toBe(2)
    expect(count(markup, />Language choice</g)).toBe(2)
  })

  it('puts no claude-authored header into an attribute, across every tab', () => {
    // The one-question version of this above cannot see a tab row at all. Each header must appear EXACTLY
    // once, as element content: an attribute copy — `title`, `aria-label`, a `data-*` — would make it two.
    // NOT the `batch()` helper: its bodies echo the header, which would make each sentinel legitimately
    // appear twice and hide the very duplication this test is looking for.
    const markup = renderBatch(
      [question({ header: 'HEADER-ONE' }), question({ header: 'HEADER-TWO' })],
      0
    )
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('data-')
    expect(markup).not.toContain('id=')
    expect(count(markup, /HEADER-ONE/g)).toBe(1)
    expect(count(markup, /HEADER-TWO/g)).toBe(1)
  })

  it('escapes a hostile header in an inactive tab too', () => {
    const markup = renderBatch(batch('Alpha', '<img src=x onerror=alert(1)>'), 0)
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img')
  })

  // #916 — the step controls. SCOPED TO THE ACTION ROW the way the tab cases are scoped to the labels row,
  // and for the same reason: since #915 a tab is also a `<button type="button"`, so an unscoped button
  // count would mix the two rows and read three where the design draws one tab and two actions. This is
  // also the only place the all-three-visible state is reachable at all — the Playwright arc drives a
  // two-question batch, where no question has both a previous and a next.
  const actionsRow = (markup: string): string => markup.slice(markup.indexOf('question-panel__actions'))

  it('draws Cancel, Previous and the trailing button in that order on a middle question', () => {
    // AC1. Order is asserted by document position rather than by presence, because right-alignment makes
    // a row in the wrong order look plausible in isolation.
    const row = actionsRow(renderBatch(batch('Alpha', 'Beta', 'Gamma'), 1))
    expect(count(row, /<button type="button"/g)).toBe(3)
    expect(row.indexOf(QUESTION_CANCEL_COPY)).toBeLessThan(row.indexOf(QUESTION_PREVIOUS_COPY))
    expect(row.indexOf(QUESTION_PREVIOUS_COPY)).toBeLessThan(row.indexOf(QUESTION_NEXT_COPY))
    // Absent, never `disabled` — the panel covers the composer, so there is no disabled state to draw.
    expect(row).not.toContain('disabled')
  })

  it('omits Previous on the first question of a batch, and reads Next there', () => {
    // AC1 + AC3. The two halves are asserted together: a Previous that leaked onto the first question and
    // a trailing button stuck on Continue are the two off-by-ones this render can carry.
    const row = actionsRow(renderBatch(batch('Alpha', 'Beta', 'Gamma'), 0))
    expect(count(row, /<button type="button"/g)).toBe(2)
    expect(row).not.toContain(QUESTION_PREVIOUS_COPY)
    expect(row).toContain(QUESTION_NEXT_COPY)
    // The class token stays `__continue` (it names the design's filled slot); only the COPY varies, so the
    // absence asserted here is of the word, not of the treatment.
    expect(row).not.toContain(QUESTION_CONTINUE_COPY)
  })

  it('reads Continue on the last question, with Previous still beside it', () => {
    const row = actionsRow(renderBatch(batch('Alpha', 'Beta', 'Gamma'), 2))
    expect(count(row, /<button type="button"/g)).toBe(3)
    expect(row).toContain(QUESTION_PREVIOUS_COPY)
    expect(row).toContain(QUESTION_CONTINUE_COPY)
    expect(row).not.toContain(QUESTION_NEXT_COPY)
  })

  it('leaves a one-question batch’s action row exactly as it shipped', () => {
    // AC1's last clause, and the case where BOTH conditions fire at once: the only question is the first
    // and the last, so either off-by-one alone would show up here as a Previous the design hides or as a
    // Next on a batch with nowhere to go.
    const row = actionsRow(render(question()))
    expect(count(row, /<button type="button"/g)).toBe(2)
    expect(row).toContain(QUESTION_CANCEL_COPY)
    expect(row).toContain(QUESTION_CONTINUE_COPY)
    expect(row).not.toContain(QUESTION_PREVIOUS_COPY)
    expect(row).not.toContain(QUESTION_NEXT_COPY)
  })

  it('puts no claude-authored header into an attribute at a stepping index either', () => {
    // The #915 version of this renders at index 0, where the row has no Previous. Re-run at a middle index
    // so the three-button row is covered too: this slice adds two controls to a component whose whole job
    // at this boundary is that nothing claude wrote ever leaves the React-children path.
    const markup = renderBatch(
      [
        question({ header: 'HEADER-ONE' }),
        question({ header: 'HEADER-TWO' }),
        question({ header: 'HEADER-THREE' })
      ],
      1
    )
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('data-')
    expect(markup).not.toContain('id=')
    for (const sentinel of ['HEADER-ONE', 'HEADER-TWO', 'HEADER-THREE']) {
      expect(count(markup, new RegExp(sentinel, 'g'))).toBe(1)
    }
  })

  it('draws two options that are byte-identical', () => {
    // A React key is not observable in static markup, so this asserts the observable CONSEQUENCE of keying
    // by array index (AC4): two options claude happens to word identically are two rows, not one. A
    // label-keyed list is what this rules out by construction — the key choice itself lives in the source.
    const twin = { label: 'Rust', description: 'systems' }
    const markup = render(question({ options: [twin, twin] }))
    expect(count(markup, /question-panel__option-label">Rust</g)).toBe(2)
    expect(count(markup, /question-panel__control--radio/g)).toBe(3)
  })

  // #922 — the gate. THE CONJUNCTION IS THE WHOLE POINT: the trailing control is one element in two
  // roles, and only the Continue role is gated. Gating the element on batch completeness alone would
  // disable Next on any incomplete batch, stranding the operator on question 1 with no way to reach
  // question 2 to answer it — so the batch could never become complete and the panel would deadlock.
  const actionsRowOf = (markup: string): string => markup.slice(markup.indexOf('question-panel__actions'))
  const three = (): readonly Question[] => batch('Alpha', 'Beta', 'Gamma')

  it('AC1: makes Continue unavailable on the last question while the batch is short an answer', () => {
    const row = actionsRowOf(renderBatch(three(), 2, selection(), false))
    expect(row).toContain(QUESTION_CONTINUE_COPY)
    // React omits the attribute entirely for `disabled={false}`, so its PRESENCE is the assertion and
    // the sibling cases below assert its absence — together they pin both directions of the branch.
    expect(count(row, /disabled=""/g)).toBe(1)
    // On the trailing button and nowhere else: Cancel and Previous are never gated on what has been
    // picked, and a stray `disabled` on either would satisfy a bare `toContain`.
    expect(row.indexOf('disabled=""')).toBeGreaterThan(row.indexOf(QUESTION_PREVIOUS_COPY))
  })

  it('AC1: makes Continue available the moment every question holds a value', () => {
    const row = actionsRowOf(renderBatch(three(), 2, selection(), true))
    expect(row).toContain(QUESTION_CONTINUE_COPY)
    expect(row).not.toContain('disabled')
  })

  it('AC2: never gates stepping — Next stays available on a batch with nothing answered', () => {
    // The deadlock case, asserted at BOTH stepping positions: the first question (no Previous) and a
    // middle one (Previous present), each with `canAnswer` false.
    for (const activeIndex of [0, 1]) {
      const row = actionsRowOf(renderBatch(three(), activeIndex, selection(), false))
      expect(row).toContain(QUESTION_NEXT_COPY)
      expect(row).not.toContain(QUESTION_CONTINUE_COPY)
      expect(row).not.toContain('disabled')
    }
  })

  it('AC2: keeps the row one element across both roles, gated or not', () => {
    // The class token names the design's FILLED TREATMENT slot, which is what does not vary — so
    // counting it is how "one element in two roles" is observable in static markup at all. Two branched
    // elements would reconcile as a REPLACEMENT and drop focus mid-row when stepping onto the last
    // question; the count staying 1 in all four states is what rules that out.
    for (const [activeIndex, canAnswer] of [
      [0, false],
      [0, true],
      [2, false],
      [2, true]
    ] as const) {
      const row = actionsRowOf(renderBatch(three(), activeIndex, selection(), canAnswer))
      expect(count(row, /question-panel__continue/g)).toBe(1)
    }
  })
})
