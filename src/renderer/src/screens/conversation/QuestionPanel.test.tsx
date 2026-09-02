import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  QuestionPanelView,
  optionPickEventFor,
  otherPickEventFor,
  QUESTION_CANCEL_COPY,
  QUESTION_CONTINUE_COPY,
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

const render = (q: Question, picked: QuestionSelection = selection()): string =>
  renderToStaticMarkup(
    <QuestionPanelView
      question={q}
      selection={picked}
      onOptionChosen={() => {}}
      onOtherChosen={() => {}}
      onOtherTextChanged={() => {}}
    />
  )

const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0

describe('QuestionPanelView', () => {
  it('draws the header in the title row and the question in the box', () => {
    const markup = render(question())
    expect(markup).toContain('>Language choice<')
    expect(markup).toContain('Which of these three programming languages should you learn next?')
  })

  it('renders an inert Cancel / Continue row above no dispatch', () => {
    const markup = render(question())
    expect(markup).toContain(QUESTION_CANCEL_COPY)
    expect(markup).toContain(QUESTION_CONTINUE_COPY)
    // Two buttons, both type="button" (never a submit), and no handler reaches the markup — the inert
    // posture #224 took so #853's answer path lands on a stable surface. `disabled` is deliberately
    // ABSENT: the panel sits on top of the composer, so there is no disabled state to draw.
    expect(count(markup, /<button type="button"/g)).toBe(2)
    expect(markup).not.toContain('disabled')
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

  it('draws two options that are byte-identical', () => {
    // A React key is not observable in static markup, so this asserts the observable CONSEQUENCE of keying
    // by array index (AC4): two options claude happens to word identically are two rows, not one. A
    // label-keyed list is what this rules out by construction — the key choice itself lives in the source.
    const twin = { label: 'Rust', description: 'systems' }
    const markup = render(question({ options: [twin, twin] }))
    expect(count(markup, /question-panel__option-label">Rust</g)).toBe(2)
    expect(count(markup, /question-panel__control--radio/g)).toBe(3)
  })
})
