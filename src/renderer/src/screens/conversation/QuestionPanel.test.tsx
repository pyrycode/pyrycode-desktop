import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionPanelView, optionPickEventFor, otherPickEventFor } from './QuestionPanel'
import type { Question } from '../../store/questionBatches'
import type { QuestionSelection } from '../../store/questionPicksStore'

const questions: Question[] = [false, false, true].map((multiSelect, index) => ({
  header: `Header ${index}`, question: `Question ${index}`,
  options: [{ label: 'Rust', description: 'Systems' }, { label: '<script>bad</script>', description: '' }],
  multiSelect
}))
const selection: QuestionSelection = { optionIndices: [0], otherTicked: true, otherText: 'typed' }
const render = (canAnswer = true, responseAvailable = true) => renderToStaticMarkup(
  <QuestionPanelView questions={questions} selections={new Map([[2, selection]])}
    canAnswer={canAnswer} responseAvailable={responseAvailable} onCancel={() => {}} onAnswer={() => {}}
    onOptionChosen={() => {}} onOtherChosen={() => {}} onOtherTextChanged={() => {}} />
)

describe('inline question batch', () => {
  it('draws all questions in order and one action row without stepping or tabs', () => {
    const html = render()
    expect(html).toContain('Claude has questions')
    expect(html.indexOf('Question 0')).toBeLessThan(html.indexOf('Question 1'))
    expect(html.indexOf('Question 1')).toBeLessThan(html.indexOf('Question 2'))
    expect(html.match(/question-panel__box/g)).toHaveLength(3)
    expect(html.match(/<button /g)).toHaveLength(2)
    expect(html).not.toMatch(/Previous|Next|aria-current|__label--tab/)
    expect(html.lastIndexOf('question-panel__actions')).toBeGreaterThan(html.indexOf('Question 2'))
  })
  it('isolates native radio groups by position and includes Other in each group', () => {
    const html = render()
    expect(html.match(/name="question-panel-option-0"/g)).toHaveLength(3)
    expect(html.match(/name="question-panel-option-1"/g)).toHaveLength(3)
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html.match(/checked=""/g)).toHaveLength(2)
    expect(html).toContain('value="typed"')
  })
  it('renders daemon fields escaped as text with no content-derived attributes', () => {
    const html = render()
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toMatch(/title=|data-|id=|href=/)
    expect(html.match(/aria-label="Other"/g)).toHaveLength(3)
  })
  it('gates Continue on completeness and both responses on availability, while editing stays enabled', () => {
    expect(render(false)).toMatch(/__continue" disabled=""/)
    expect(render(false)).not.toMatch(/__cancel" disabled/)
    const offline = render(true, false)
    expect(offline).toMatch(/__cancel" disabled=""/)
    expect(offline).toMatch(/__continue" disabled=""/)
    expect(offline.match(/disabled=""/g)).toHaveLength(2)
  })
  it('maps independent single and multiple gestures to the existing store arms', () => {
    const at = { questionBatchId: 'batch', questionIndex: 2, optionIndex: 1 }
    expect(optionPickEventFor({ ...at, multiSelect: false })).toEqual({ ...at, type: 'optionPicked' })
    expect(optionPickEventFor({ ...at, multiSelect: true })).toEqual({ ...at, type: 'optionToggled' })
    expect(otherPickEventFor({ ...at, multiSelect: false }).type).toBe('otherPicked')
    expect(otherPickEventFor({ ...at, multiSelect: true }).type).toBe('otherToggled')
  })
})
