import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LogDataView, LogDataSection } from './LogDataSection'

// No DOM harness (jsdom/Testing Library) — mirrors ConversationScreen.test.tsx. LogDataView is pure
// (state in, markup out), so a server-rendered string proves each visible state; the container is
// exercised only for "server-renders the idle view without touching window.pyry".
function buttonTag(markup: string): string {
  return markup.match(/<button[^>]*>/)?.[0] ?? ''
}

describe('LogDataView', () => {
  it('idle → a Log data header and a Download button, no status caption', () => {
    const markup = renderToStaticMarkup(<LogDataView state={{ phase: 'idle' }} onDownload={() => {}} />)
    expect(markup).toContain('Log data')
    expect(markup).toContain('Download')
    expect(buttonTag(markup)).not.toContain('disabled')
    // No caption while idle.
    expect(markup).not.toContain('role="status"')
  })

  it('downloading → button disabled + aria-busy, a polite status caption showing the running count', () => {
    const markup = renderToStaticMarkup(
      <LogDataView state={{ phase: 'downloading', chunks: 3 }} onDownload={() => {}} />
    )
    const tag = buttonTag(markup)
    expect(tag).toContain('disabled')
    expect(tag).toContain('aria-busy="true"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('3')
  })

  it('saved → the saved path in the caption; the button stays pressable', () => {
    const path = '/Users/x/pyry-debug.tar.gz'
    const markup = renderToStaticMarkup(
      <LogDataView state={{ phase: 'saved', path }} onDownload={() => {}} />
    )
    expect(markup).toContain(path)
    expect(buttonTag(markup)).not.toContain('disabled')
  })

  it('failed → the mapped sentence with the error class; the button stays pressable; no raw reason', () => {
    const markup = renderToStaticMarkup(
      <LogDataView state={{ phase: 'failed', reason: 'unavailable' }} onDownload={() => {}} />
    )
    expect(markup).toContain('log-data__status--error')
    expect(buttonTag(markup)).not.toContain('disabled')
    // AC5: the raw reason token never reaches the surface.
    expect(markup).not.toContain('unavailable')
  })
})

describe('LogDataSection (container)', () => {
  it('server-renders the idle Download button without touching window.pyry', () => {
    // useEffect/handlers never run under server render, so the bridge is never dereferenced — the
    // same discipline as Composer.handleSubmit. No window.pyry mock is needed.
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<LogDataSection />)
    }).not.toThrow()
    expect(markup).toContain('Download')
  })
})
