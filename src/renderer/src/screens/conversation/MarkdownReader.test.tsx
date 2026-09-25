import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MARKDOWN_COPIED_NOTICE,
  MARKDOWN_OPEN_IN_APP_FAILED_NOTICE,
  MARKDOWN_SAVE_FAILED_NOTICE,
  MARKDOWN_OPEN_FAILED_NOTICE,
  MarkdownReaderView,
  markdownFileName,
  markdownHtml,
  markdownPlainText,
  markdownReaderMenuOptions,
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
      type: 'loaded', requestKey: 'k1', path: 'notes/Plan.md', text: 'body', refreshKey: null, notice: false
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
    renderToStaticMarkup(
      <MarkdownReaderView state={state} copied={false} openInAppFailed={false} saveFailed={false} onBack={() => {}} onRefresh={() => {}} onCopy={() => {}} onOpenInApp={() => {}} onSave={() => {}} />
    )

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
      text: '# Builder Plan\n\nSee [the other](Other.md) and <b>x</b>.',
      refreshKey: null,
      notice: false
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

// #1630 — Refresh keeps the shown text while a fresh key is pending, and each refresh mints its own key
// so a late answer to any earlier fetch is ignored.
describe('markdownReaderReducer refresh (#1630)', () => {
  const shown = (): MarkdownReaderState =>
    markdownReaderReducer(markdownReaderReducer(CLOSED, open('k1')), loaded('k1', 'old'))
  const refresh = (requestKey: string) => ({ type: 'refresh', requestKey }) as const

  it('keeps the current text on screen while the refresh is in flight', () => {
    expect(markdownReaderReducer(shown(), refresh('r1'))).toEqual({
      type: 'loaded', requestKey: 'k1', path: 'notes/Plan.md', text: 'old', refreshKey: 'r1', notice: false
    })
  })

  it('replaces the text with the refreshed answer', () => {
    const pending = markdownReaderReducer(shown(), refresh('r1'))
    expect(markdownReaderReducer(pending, loaded('r1', 'new'))).toEqual({
      type: 'loaded', requestKey: 'r1', path: 'notes/Plan.md', text: 'new', refreshKey: null, notice: false
    })
  })

  it('keeps the reader open with the old text and the notice when the refresh fails, and a later success clears it', () => {
    const noticed = markdownReaderReducer(markdownReaderReducer(shown(), refresh('r1')), failed('r1'))
    expect(noticed).toEqual({
      type: 'loaded', requestKey: 'k1', path: 'notes/Plan.md', text: 'old', refreshKey: null, notice: true
    })
    const cleared = markdownReaderReducer(markdownReaderReducer(noticed, refresh('r2')), loaded('r2', 'new'))
    expect(cleared).toMatchObject({ type: 'loaded', text: 'new', notice: false, refreshKey: null })
  })

  it('ignores an answer to a refresh a newer refresh superseded', () => {
    const newer = markdownReaderReducer(markdownReaderReducer(shown(), refresh('r1')), refresh('r2'))
    expect(markdownReaderReducer(newer, loaded('r1', 'stale'))).toBe(newer)
    expect(markdownReaderReducer(newer, failed('r1'))).toBe(newer)
  })

  it('ignores a refresh answer after back or after a newer open', () => {
    const pending = markdownReaderReducer(shown(), refresh('r1'))
    const closed = markdownReaderReducer(pending, { type: 'back' })
    expect(markdownReaderReducer(closed, loaded('r1', 'stale'))).toBe(closed)
    const reopened = markdownReaderReducer(pending, open('k2', 'b.md'))
    expect(markdownReaderReducer(reopened, loaded('r1', 'stale'))).toBe(reopened)
    expect(markdownReaderReducer(reopened, failed('r1'))).toBe(reopened)
  })

  it('ignores a second answer to the shown key', () => {
    const pending = markdownReaderReducer(shown(), refresh('r1'))
    expect(markdownReaderReducer(pending, loaded('k1', 'again'))).toBe(pending)
  })

  it('supersedes the first fetch when refreshed before it answered', () => {
    const loading = markdownReaderReducer(CLOSED, open('k1'))
    const refreshed = markdownReaderReducer(loading, refresh('r1'))
    expect(refreshed).toEqual({ type: 'loading', requestKey: 'r1', path: 'notes/Plan.md' })
    expect(markdownReaderReducer(refreshed, loaded('k1'))).toBe(refreshed)
  })

  it('does nothing while closed', () => {
    expect(markdownReaderReducer(CLOSED, refresh('r1'))).toBe(CLOSED)
  })
})

describe('markdownPlainText (#1630)', () => {
  it('drops the markdown syntax and keeps the rendered text', () => {
    const note = [
      '# Builder *Plan*',
      '',
      'Read [the refiner](https://example.com/r) and **bold** ~~gone~~ `code`.',
      '',
      '- one',
      '- two',
      '',
      '```sh',
      'pyry status',
      '```',
      '',
      '> Tokens first.'
    ].join('\n')
    expect(markdownPlainText(note)).toBe(
      [
        'Builder Plan',
        '',
        'Read the refiner and bold gone code.',
        '',
        'one\ntwo',
        '',
        'pyry status',
        '',
        'Tokens first.'
      ].join('\n')
    )
  })

  it('reads a table as tab-separated rows and an image as its alt text', () => {
    const note = ['| a | b |', '| - | - |', '| 1 | 2 |', '', '![a chart](x.png)'].join('\n')
    expect(markdownPlainText(note)).toBe('a\tb\n1\t2\n\na chart')
  })

  it('keeps raw HTML as the literal text the view shows', () => {
    expect(markdownPlainText('Hi <b>x</b>')).toBe('Hi <b>x</b>')
  })
})

describe('markdownHtml (#1630)', () => {
  it('renders the note through the reply pipeline', () => {
    expect(markdownHtml('# Plan\n\nSome *words*.')).toBe('<h1>Plan</h1>\n<p>Some <em>words</em>.</p>')
  })

  it('copies raw HTML escaped, never as live markup', () => {
    const html = markdownHtml(
      'Before <script>alert(1)</script> after.\n\n<img src="x" onerror="alert(1)">\n\n![alt](javascript:alert(1))'
    )
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    // The attribute text survives only as escaped content; no real tag carries it.
    expect(html).not.toMatch(/<[^>]*\sonerror=/)
    expect(html).not.toContain('javascript:')
  })
})

describe('MarkdownReaderView menu (#1630)', () => {
  const render = (
    state: Exclude<MarkdownReaderState, { type: 'closed' }>,
    copied = false,
    openInAppFailed = false,
    saveFailed = false
  ): string =>
    renderToStaticMarkup(
      <MarkdownReaderView
        state={state}
        copied={copied}
        openInAppFailed={openInAppFailed}
        saveFailed={saveFailed}
        onBack={() => {}}
        onRefresh={() => {}}
        onCopy={() => {}}
        onOpenInApp={() => {}}
        onSave={() => {}}
      />
    )
  const loadedState = (notice = false): MarkdownReaderState & { type: 'loaded' } => ({
    type: 'loaded', requestKey: 'k', path: 'notes/Plan.md', text: 'Body', refreshKey: null, notice
  })

  it('lists the six items in the decided order, and only Refresh is available until the content has loaded', () => {
    // #1631: Open in another app sits directly below Refresh. #1632: Save to device is last.
    const labels = [
      'Copy as markdown',
      'Copy as plain text',
      'Copy as HTML',
      'Refresh',
      'Open in another app',
      'Save to device'
    ]
    const loading = markdownReaderMenuOptions({ type: 'loading', requestKey: 'k', path: 'notes/Plan.md' })
    expect(loading.map((option) => option.label)).toEqual(labels)
    expect(loading.map((option) => option.unavailable)).toEqual([true, true, true, false, true, true])
    const loaded = markdownReaderMenuOptions(loadedState())
    expect(loaded.map((option) => option.label)).toEqual(labels)
    expect(loaded.map((option) => option.unavailable)).toEqual([false, false, false, false, false, false])
  })

  it('puts the menu trigger at the end of the bar in both states', () => {
    for (const markup of [render({ type: 'loading', requestKey: 'k', path: 'notes/Plan.md' }), render(loadedState())]) {
      expect(markup).toMatch(
        /<p class="markdown-reader__title">Plan\.md<\/p><div class="composer-options-anchor composer-options-anchor--bottom-end"><button type="button" class="conversation__overflow-trigger" aria-label="Note actions" aria-haspopup="menu" aria-expanded="false">/
      )
    }
  })

  it('shows the refresh failure notice inside the reader and the copy confirmation, from state alone', () => {
    const plain = render(loadedState())
    expect(plain).not.toContain(MARKDOWN_OPEN_FAILED_NOTICE)
    expect(plain).not.toContain(MARKDOWN_COPIED_NOTICE)
    expect(render(loadedState(true))).toContain(
      `<p class="conversation__banner markdown-reader__notice" role="status">${MARKDOWN_OPEN_FAILED_NOTICE}</p>`
    )
    expect(render(loadedState(), true)).toContain(
      `<p class="markdown-reader__copied" role="status">${MARKDOWN_COPIED_NOTICE}</p>`
    )
  })

  it('shows the open-in-another-app failure notice from state alone (#1631)', () => {
    expect(render(loadedState())).not.toContain(MARKDOWN_OPEN_IN_APP_FAILED_NOTICE)
    expect(render(loadedState(), false, true)).toContain(
      `<p class="conversation__banner markdown-reader__notice" role="status">${MARKDOWN_OPEN_IN_APP_FAILED_NOTICE}</p>`
    )
  })

  it('shows the save failure notice from state alone (#1632)', () => {
    expect(render(loadedState())).not.toContain(MARKDOWN_SAVE_FAILED_NOTICE)
    expect(render(loadedState(), false, false, true)).toContain(
      `<p class="conversation__banner markdown-reader__notice" role="status">${MARKDOWN_SAVE_FAILED_NOTICE}</p>`
    )
  })
})
