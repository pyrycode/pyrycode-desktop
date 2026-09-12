import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline } from './ConversationScreen'
import { compactionBoundaryTitle } from './compactionBoundaryViewModel'

const item = { kind: 'compactionBoundary' as const, failed: false, manual: false }
describe('compaction labels', () => {
  it.each([
    [0, 0, '0 → 0'], [999, 1, '999 → 1'], [1000, 1050, '1k → 1.1k'],
    [180000, 40000, '180k → 40k'], [1234567, 1099, '1234.6k → 1.1k']
  ])('formats %s to %s', (preTokens, postTokens, counts) => {
    expect(compactionBoundaryTitle({ ...item, preTokens, postTokens }))
      .toBe(`Conversation compacted, ${counts} tokens`)
  })
  it.each([undefined, null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('omits the full count phrase for %s', invalid => {
    for (const pair of [{ preTokens: invalid, postTokens: 0 }, { preTokens: 0, postTokens: invalid }]) {
      expect(compactionBoundaryTitle({ ...item, ...pair })).toBe('Conversation compacted')
    }
  })
  it('suffixes only classified manual success, with failure precedence', () => {
    expect(compactionBoundaryTitle({ ...item, manual: true })).toBe('Conversation compacted by you')
    expect(compactionBoundaryTitle({ ...item, manual: true, preTokens: 0, postTokens: 0 }))
      .toBe('Conversation compacted, 0 → 0 tokens by you')
    expect(compactionBoundaryTitle({ ...item, manual: true, failed: true, preTokens: 0, postTokens: 0 }))
      .toBe('Compaction failed')
  })
  it('reuses equal decorative rules and marks a failed row for the error color', () => {
    const html = renderToStaticMarkup(<Timeline items={[item, { ...item, failed: true }]} />)
    expect(html.match(/class="session-delimiter__rule" aria-hidden="true"/g)).toHaveLength(4)
    expect(html).toContain('compaction-delimiter--failed')
    expect(html).toContain('Conversation compacted')
    expect(html).toContain('Compaction failed')
    expect(html).not.toContain('data-thread-role')
  })
})
