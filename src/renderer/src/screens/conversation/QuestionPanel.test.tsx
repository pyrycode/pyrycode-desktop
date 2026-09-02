import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  QuestionPanelView,
  QUESTION_CANCEL_COPY,
  QUESTION_CONTINUE_COPY,
  QUESTION_OTHER_PLACEHOLDER_COPY
} from './QuestionPanel'
import type { Question } from '../../store/questionBatches'

// The #218 idiom: server-render the pure view with injected fixtures — no DOM harness, no store. Every
// assertion here is on markup, which is all `environment: 'node'` can see; the container's store read is
// composerSlot.test.tsx's, and clicking anything is #908's Playwright spec.

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

const render = (q: Question): string => renderToStaticMarkup(<QuestionPanelView question={q} />)

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
    // posture #224 took so #908's answer path lands on a stable surface. `disabled` is deliberately
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

  it('draws every control at rest, whatever the design mock shows selected', () => {
    // The Figma mock has row 1 selected and every checkbox ticked; AC5 says resting. An empty control
    // element is the proof: a selector child (or a `checked`) would break both matches.
    const markup = render(question({ multiSelect: true }))
    expect(count(markup, /<span class="question-panel__control[^"]*"><\/span>/g)).toBe(3)
    expect(markup).not.toContain('checked')
  })

  it('ends the list with an Other row carrying an inert free-text field', () => {
    const markup = render(question({ multiSelect: true }))
    expect(markup).toContain(`placeholder="${QUESTION_OTHER_PLACEHOLDER_COPY}"`)
    // An accessible name, since a placeholder alone is only a last-resort one. Both are client-owned copy.
    expect(markup).toContain(`aria-label="${QUESTION_OTHER_PLACEHOLDER_COPY}"`)
    expect(markup).toContain('type="text"')
    // Inert in #906's sense: real, no handler, no `value` — nothing reads it until #908.
    expect(markup).not.toContain('value=')
    // Last in the list, and wearing the variant's own chrome so it can later sit ticked beside the rest.
    expect(markup.indexOf(QUESTION_OTHER_PLACEHOLDER_COPY)).toBeGreaterThan(markup.indexOf('Elixir'))
    expect(markup).toContain('question-panel__control--checkbox question-panel__control--other')
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
