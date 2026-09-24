import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MarkdownReaderView,
  markdownFileName,
  markdownReaderReducer,
  type MarkdownReaderState
} from './MarkdownReader'

// #1627 — the reader's state machine and its view, both pure. The click, the IPC round trip and the
// back transition are e2e/markdown-reader.spec.ts's; this tier proves what each state draws and which
// answers each state accepts.

const CLOSED: MarkdownReaderState = { type: 'closed', notice: false }
const open = (requestKey: string, path = 'notes/Plan.md') =>
  ({ type: 'open', requestKey, path }) as const
const loaded = (requestKey: string, text = '# Plan') =>
  ({ type: 'outcome', event: { type: 'loaded', requestKey, text } }) as const
const failed = (requestKey: string) =>
  ({ type: 'outcome', event: { type: 'failed', requestKey, reason: 'not-found' } }) as const

describe('markdownReaderReducer (#1627)', () => {
  it('opens into loading, then shows the answer carrying the same key', () => {
    const loading = markdownReaderReducer(CLOSED, open('k1'))
    expect(loading).toEqual({ type: 'loading', requestKey: 'k1', path: 'notes/Plan.md' })
    expect(markdownReaderReducer(loading, loaded('k1', 'body'))).toEqual({
      type: 'loaded', requestKey: 'k1', path: 'notes/Plan.md', text: 'body'
    })
  })

  it('closes with the notice when the current ask fails', () => {
    const loading = markdownReaderReducer(CLOSED, open('k1'))
    expect(markdownReaderReducer(loading, failed('k1'))).toEqual({ type: 'closed', notice: true })
  })

  it('ignores an answer for another key, including after a second link superseded the first', () => {
    const first = markdownReaderReducer(CLOSED, open('k1', 'a.md'))
    const second = markdownReaderReducer(first, open('k2', 'b.md'))
    expect(markdownReaderReducer(second, loaded('k1'))).toBe(second)
    expect(markdownReaderReducer(second, failed('k1'))).toBe(second)
  })

  it('ignores an answer that arrives after the reader closed', () => {
    const closed = markdownReaderReducer(markdownReaderReducer(CLOSED, open('k1')), { type: 'back' })
    expect(closed).toEqual({ type: 'closed', notice: false })
    expect(markdownReaderReducer(closed, loaded('k1'))).toBe(closed)
    expect(markdownReaderReducer(closed, failed('k1'))).toBe(closed)
  })

  it('ignores a second answer once the text is shown', () => {
    const shown = markdownReaderReducer(markdownReaderReducer(CLOSED, open('k1')), loaded('k1'))
    expect(markdownReaderReducer(shown, failed('k1'))).toBe(shown)
  })

  it('clears the notice when another markdown link is opened', () => {
    const noticed: MarkdownReaderState = { type: 'closed', notice: true }
    expect(markdownReaderReducer(noticed, open('k2')).type).toBe('loading')
    const back = markdownReaderReducer(markdownReaderReducer(noticed, open('k2')), { type: 'back' })
    expect(back).toEqual({ type: 'closed', notice: false })
  })
})

describe('markdownFileName (#1627)', () => {
  it('is the last path component', () => {
    expect(markdownFileName('notes/deep/Plan.md')).toBe('Plan.md')
    expect(markdownFileName('Plan.md')).toBe('Plan.md')
  })

  it('is length-bounded', () => {
    expect(markdownFileName(`dir/${'x'.repeat(1000)}.md`)).toHaveLength(255)
  })
})

describe('MarkdownReaderView (#1627)', () => {
  const view = (state: Exclude<MarkdownReaderState, { type: 'closed' }>): string =>
    renderToStaticMarkup(<MarkdownReaderView state={state} onBack={() => {}} />)

  it('draws the top bar with a named back control and the file name while the first fetch is in flight', () => {
    const markup = view({ type: 'loading', requestKey: 'k', path: 'notes/Plan.md' })
    expect(markup).toContain('aria-label="Back"')
    expect(markup).toContain('<p class="markdown-reader__title">Plan.md</p>')
    expect(markup).toContain('<div class="markdown-reader__body" aria-busy="true"></div>')
  })

  it('renders the loaded text as markdown beneath the bar, without following links inside the note', () => {
    const markup = view({
      type: 'loaded',
      requestKey: 'k',
      path: 'notes/Plan.md',
      text: '# Builder Plan\n\nSee [the other](Other.md) and <b>x</b>.'
    })
    expect(markup).toContain('<h1>Builder Plan</h1>')
    expect(markup).toContain('class="bubble__markdown"')
    expect(markup).toContain('See the other and &lt;b&gt;x&lt;/b&gt;.')
    expect(markup).not.toContain('markdown-link')
    expect(markup).not.toContain('aria-busy')
  })

  it('shows the path only as the title text, never in an attribute', () => {
    const markup = view({ type: 'loading', requestKey: 'k', path: 'notes/Hidden-Dir/Plan.md' })
    expect(markup).toContain('Plan.md')
    expect(markup).not.toContain('Hidden-Dir')
  })
})
