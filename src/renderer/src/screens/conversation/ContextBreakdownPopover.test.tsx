import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReportedContextReading } from '../../store/reportedContextStore'
import {
  CONTEXT_BREAKDOWN_LABEL,
  CONTEXT_BREAKDOWN_PENDING,
  ContextBreakdownPanel,
  ContextBreakdownPopover,
  contextBarPercent,
  formatContextTokens,
  groupMcpToolsByServer
} from './ContextBreakdownPopover'

// #1254: the breakdown popover as values, then as markup. Nothing here can click — the open, close and
// focus-return transitions are e2e/composer-context-breakdown.spec.ts's.

function reading(overrides: Partial<ReportedContextReading> = {}): ReportedContextReading {
  return {
    model: 'seeded-model',
    totalTokens: 80_000,
    maxTokens: 200_000,
    percentage: 40,
    categories: [],
    droppedCategories: 0,
    mcpTools: [],
    droppedMcpTools: 0,
    memoryFiles: [],
    droppedMemoryFiles: 0,
    ...overrides
  }
}

describe('formatContextTokens', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [12_400, '12.4k'],
    [12_449, '12.4k'],
    [80_000, '80k'],
    [200_000, '200k'],
    [Number.NaN, '?'],
    [Number.POSITIVE_INFINITY, '?']
  ])('%s → %s', (tokens, text) => {
    expect(formatContextTokens(tokens)).toBe(text)
  })
})

describe('contextBarPercent', () => {
  it('is the share of the maximum', () => {
    expect(contextBarPercent(50_000, 200_000)).toBe(25)
  })

  it('clamps to [0, 100] and zeroes an unusable maximum', () => {
    expect(contextBarPercent(300_000, 200_000)).toBe(100)
    expect(contextBarPercent(-5, 200_000)).toBe(0)
    expect(contextBarPercent(10, 0)).toBe(0)
    expect(contextBarPercent(10, -1)).toBe(0)
    expect(contextBarPercent(Number.NaN, 100)).toBe(0)
    expect(contextBarPercent(10, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('groupMcpToolsByServer', () => {
  it('keeps first-appearance group order and held row order within a group', () => {
    const a1 = { name: 'a1', server_name: 'alpha', tokens: 9 }
    const b1 = { name: 'b1', server_name: 'beta', tokens: 8 }
    const a2 = { name: 'a2', server_name: 'alpha', tokens: 7 }
    const groups = groupMcpToolsByServer([a1, b1, a2])
    expect([...groups.keys()]).toEqual(['alpha', 'beta'])
    expect(groups.get('alpha')).toEqual([a1, a2])
    expect(groups.get('beta')).toEqual([b1])
  })

  it('treats a prototype-shaped server name as an ordinary group', () => {
    const groups = groupMcpToolsByServer([
      { name: 't', server_name: '__proto__', tokens: 1 },
      { name: 'u', server_name: 'constructor', tokens: 1 }
    ])
    expect([...groups.keys()]).toEqual(['__proto__', 'constructor'])
    expect(groups.get('__proto__')).toHaveLength(1)
  })
})

describe('ContextBreakdownPanel', () => {
  it('shows only the pending line when no reading is held', () => {
    const markup = renderToStaticMarkup(<ContextBreakdownPanel reading={null} />)
    expect(markup).toContain(`<p class="context-breakdown__pending">${CONTEXT_BREAKDOWN_PENDING}</p>`)
    expect(markup).not.toContain('context-breakdown__header')
    expect(markup).not.toContain('context-breakdown__row')
    expect(markup).toContain(`role="dialog"`)
    expect(markup).toContain(`aria-label="${CONTEXT_BREAKDOWN_LABEL}"`)
  })

  it('shows the model, the total and the maximum in the header', () => {
    const markup = renderToStaticMarkup(<ContextBreakdownPanel reading={reading()} />)
    expect(markup).toContain('>seeded-model<')
    expect(markup).toContain('>80k of 200k tokens<')
    expect(markup).not.toContain(CONTEXT_BREAKDOWN_PENDING)
  })

  it('renders category rows in held order with a bar proportional to the maximum', () => {
    const markup = renderToStaticMarkup(
      <ContextBreakdownPanel
        reading={reading({
          categories: [
            { name: 'Messages', tokens: 50_000 },
            { name: 'System prompt', tokens: 12_400 }
          ]
        })}
      />
    )
    const messagesAt = markup.indexOf('>Messages<')
    const systemAt = markup.indexOf('>System prompt<')
    expect(messagesAt).toBeGreaterThan(-1)
    expect(systemAt).toBeGreaterThan(messagesAt)
    expect(markup).toContain('> · 50k<')
    expect(markup).toContain('> · 12.4k<')
    expect(markup).toContain('style="width:25%"')
    expect(markup).toContain('style="width:6.2%"')
  })

  it('shows a "+N more" line only for a positive dropped count', () => {
    const none = renderToStaticMarkup(
      <ContextBreakdownPanel reading={reading({ categories: [{ name: 'Messages', tokens: 1 }] })} />
    )
    expect(none).not.toContain('more<')
    const some = renderToStaticMarkup(
      <ContextBreakdownPanel
        reading={reading({ categories: [{ name: 'Messages', tokens: 1 }], droppedCategories: 3 })}
      />
    )
    expect(some).toContain('<li class="context-breakdown__more">+3 more</li>')
  })

  it('omits the MCP and memory-file groups when they are empty with nothing dropped', () => {
    const markup = renderToStaticMarkup(
      <ContextBreakdownPanel reading={reading({ categories: [{ name: 'Messages', tokens: 1 }] })} />
    )
    expect(markup).not.toContain('<details')
    expect(markup).not.toContain('MCP tools')
    expect(markup).not.toContain('Memory files')
  })

  it('keeps a group whose rows were all dropped, showing only its "+N more"', () => {
    const markup = renderToStaticMarkup(
      <ContextBreakdownPanel reading={reading({ droppedMcpTools: 2, droppedMemoryFiles: 1 })} />
    )
    expect(markup).toContain('>MCP tools</summary>')
    expect(markup).toContain('>Memory files</summary>')
    expect(markup).toContain('+2 more')
    expect(markup).toContain('+1 more')
  })

  it('groups MCP tools under their server and shortens memory-file paths, collapsed by default', () => {
    const markup = renderToStaticMarkup(
      <ContextBreakdownPanel
        reading={reading({
          mcpTools: [
            { name: 'search', server_name: 'docs', tokens: 3_000 },
            { name: 'open', server_name: 'files', tokens: 2_000 },
            { name: 'fetch', server_name: 'docs', tokens: 1_000 }
          ],
          memoryFiles: [{ path: '/home/user/work/project/sub/CLAUDE.md', type: 'Project', tokens: 1_500 }]
        })}
      />
    )
    expect(markup).not.toContain('<details open')
    const docsAt = markup.indexOf('>docs<')
    const searchAt = markup.indexOf('>search<')
    const fetchAt = markup.indexOf('>fetch<')
    const filesAt = markup.indexOf('>files<')
    const openAt = markup.indexOf('>open<')
    expect(docsAt).toBeGreaterThan(-1)
    expect(searchAt).toBeGreaterThan(docsAt)
    expect(fetchAt).toBeGreaterThan(searchAt)
    expect(filesAt).toBeGreaterThan(fetchAt)
    expect(openAt).toBeGreaterThan(filesAt)
    expect(markup).toContain('>.../work/project/sub/CLAUDE.md<')
    expect(markup).not.toContain('/home/user')
    // The memory-file type is a label the panel does not read.
    expect(markup).not.toContain('Project')
  })

  it('renders every daemon string as escaped text and in no attribute', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const markup = renderToStaticMarkup(
      <ContextBreakdownPanel
        reading={reading({
          model: hostile,
          categories: [{ name: hostile, tokens: 1 }],
          mcpTools: [{ name: hostile, server_name: hostile, tokens: 1 }],
          memoryFiles: [{ path: `javascript:${hostile}`, type: hostile, tokens: 1 }]
        })}
      />
    )
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toMatch(/="[^"]*onerror/)
    expect(markup).not.toContain('href')
    expect(markup).not.toContain('title=')
  })
})

describe('ContextBreakdownPopover', () => {
  it('renders a closed trigger wrapping the reading, with no panel', () => {
    const markup = renderToStaticMarkup(
      <ContextBreakdownPopover reading={reading()}>
        <span className="composer__context">Context: 40%</span>
      </ContextBreakdownPopover>
    )
    expect(markup).toBe(
      '<div class="context-breakdown-anchor"><button type="button" class="composer__context-trigger" ' +
        'aria-haspopup="dialog" aria-expanded="false"><span class="composer__context">Context: 40%</span>' +
        '</button></div>'
    )
  })
})
