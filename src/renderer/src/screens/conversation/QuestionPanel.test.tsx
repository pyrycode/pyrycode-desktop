import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionPanelView, QUESTION_CANCEL_COPY, QUESTION_CONTINUE_COPY } from './QuestionPanel'
import type { Question } from '../../store/questionBatches'

// The #218 idiom: server-render the pure view with injected fixtures — no DOM harness, no store. Every
// assertion here is on markup, which is all `environment: 'node'` can see; the container's store read is
// composerSlot.test.tsx's, and clicking anything is #908's Playwright spec.

const question = (over: Partial<Question> = {}): Question => ({
  question: 'Which of these three programming languages should you learn next?',
  header: 'Language choice',
  // Present on every held question and deliberately NOT drawn by this slice — #907 draws the rows. The
  // fixture carries them so "the frame draws no options" is asserted against a batch that HAS some.
  options: [{ label: 'Rust', description: 'systems' }],
  multiSelect: false,
  ...over
})

const render = (q: Question): string => renderToStaticMarkup(<QuestionPanelView question={q} />)

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
    expect(markup.match(/<button type="button"/g)).toHaveLength(2)
    expect(markup).not.toContain('disabled')
  })

  it('draws the separator and the pyry mark, both decorative', () => {
    const markup = render(question())
    expect(markup).toContain('question-panel__separator')
    // The title row's glyph IS the shipped brand mark, not a re-downloaded Figma asset (PyryMark.tsx).
    expect(markup.match(/<svg class="question-panel__mark"/g)).toHaveLength(1)
    expect(markup).toContain('aria-hidden="true"')
  })

  it('draws no option rows — the frame slice stops at the separator', () => {
    const markup = render(question())
    expect(markup).not.toContain('Rust')
    expect(markup).not.toContain('systems')
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

  it('puts neither string into an attribute', () => {
    // The trap this component invites: the question text is clamped to one line with an ellipsis, and the
    // reflex accompaniment to a clamp is `title={question.question}` — claude-authored text in an
    // ATTRIBUTE, which questionBatchStore.ts's header bans by name. Same for any data-* derived from it.
    const markup = render(question({ header: 'HEADER-SENTINEL', question: 'QUESTION-SENTINEL' }))
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('data-')
    // Each sentinel appears exactly once, as element content: an attribute copy would make it two.
    expect(markup.match(/HEADER-SENTINEL/g)).toHaveLength(1)
    expect(markup.match(/QUESTION-SENTINEL/g)).toHaveLength(1)
  })
})
