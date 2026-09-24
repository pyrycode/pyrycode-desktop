import { describe, it, expect, vi, afterEach } from 'vitest'
import { copyMessageText, copyRichText } from './copyMessageText'

// #969 — the copy control's one effect, isolated from the row that renders it. Renderer tests are
// static server renders under `environment: 'node'` (vitest.config.ts), so nothing here can click the
// button; what CAN be proven at this tier is the pure question the control asks — given a message's
// text, exactly what reaches the clipboard sink, and what happens when the sink refuses. The click
// itself, and whether Electron's blanket permission denial lets the write through at all, is
// e2e/message-copy.spec.ts.
//
// SECRET HYGIENE: the fixtures are display strings, never a token or key — the value this helper moves
// is daemon-authored message text, and the assertions below are what pin it to the clipboard call and
// nowhere else (notably: never into the console.error the failure path emits).

// A stub `navigator` carrying only what the helper is allowed to reach. Built per case rather than
// shared, so a case that asserts the call count cannot be polluted by a sibling.
function stubClipboard(writeText: (text: string) => Promise<void>): { writeText: typeof writeText } {
  const clipboard = { writeText }
  vi.stubGlobal('navigator', { clipboard })
  return clipboard
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('copyMessageText — the message bubble copy control effect (#969)', () => {
  it('writes the message text to the clipboard verbatim, once, and reports success', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)

    await expect(copyMessageText('the daemon said this')).resolves.toBe(true)

    // Verbatim and alone: one call, one argument, byte-identical. AC3's "as the daemon sent it" is a
    // property of WHERE the caller reads the string (the store's markdown source, upstream of
    // AssistantMarkdown), and of this helper passing it through untouched.
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('the daemon said this')
  })

  it('carries markdown source through unrendered — fences, newlines and markup characters intact', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    // The exact shape AC3 distinguishes from the rendered DOM: a fenced block survives as its source
    // rather than as the code element it renders to, and `<b>` stays four characters rather than
    // becoming the escaped entity the markup carries.
    const source = ['# Heading', '', '```ts', 'const x = 1', '```', '', 'a <b> tag'].join('\n')

    await copyMessageText(source)

    expect(writeText).toHaveBeenCalledWith(source)
  })

  it('reports failure without throwing when the clipboard write is refused', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    stubClipboard(writeText)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(copyMessageText('refused text')).resolves.toBe(false)

    // The failure is logged as an EVENT NAME and nothing else — not the text, and not the caught error
    // object either (questionResolution's posture, deliberately stricter than composerSend's). The
    // value in flight is relay-peer-authored, and an error object is not a place to risk it.
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged.mock.calls[0]).toHaveLength(1)
    expect(String(logged.mock.calls[0][0])).not.toContain('refused text')
  })

  it('reports failure when the environment exposes no clipboard, touching nothing', async () => {
    // Not a hypothetical: `navigator.clipboard` is undefined on an insecure origin and absent
    // altogether outside a browser context. A missing sink must be the same quiet false as a refused
    // write — never a TypeError thrown out of a click handler.
    vi.stubGlobal('navigator', {})
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(copyMessageText('nowhere to go')).resolves.toBe(false)
    expect(logged).not.toHaveBeenCalled()
  })

  it('reports failure when there is no navigator at all', async () => {
    vi.stubGlobal('navigator', undefined)

    await expect(copyMessageText('nowhere to go')).resolves.toBe(false)
  })
})

// #1630 — the markdown reader's Copy as HTML: one ClipboardItem carrying the HTML and its plain-text
// fallback, through the async `write` the `clipboard-sanitized-write` grant was measured to cover.
describe('copyRichText — the reader HTML copy (#1630)', () => {
  class FakeClipboardItem {
    constructor(readonly items: Record<string, Blob>) {}
  }

  it('writes one item carrying both flavours and reports success', async () => {
    const write = vi.fn(async (_items: FakeClipboardItem[]) => {})
    vi.stubGlobal('navigator', { clipboard: { write } })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)

    await expect(copyRichText({ html: '<h1>Plan</h1>', text: 'Plan' })).resolves.toBe(true)

    expect(write).toHaveBeenCalledTimes(1)
    const [items] = write.mock.calls[0]
    expect(items).toHaveLength(1)
    const flavours = items[0].items
    expect(Object.keys(flavours).sort()).toEqual(['text/html', 'text/plain'])
    expect(await flavours['text/html'].text()).toBe('<h1>Plan</h1>')
    expect(flavours['text/html'].type).toBe('text/html')
    expect(await flavours['text/plain'].text()).toBe('Plan')
  })

  it('reports failure without throwing or logging the content when the write is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => { throw new Error('denied: <h1>Plan</h1>') }) } })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(copyRichText({ html: '<h1>Plan</h1>', text: 'Plan' })).resolves.toBe(false)

    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls)).not.toContain('Plan')
  })

  it('reports failure when the async write or ClipboardItem is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: {} })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    await expect(copyRichText({ html: '<p>x</p>', text: 'x' })).resolves.toBe(false)

    vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => {}) } })
    vi.stubGlobal('ClipboardItem', undefined)
    await expect(copyRichText({ html: '<p>x</p>', text: 'x' })).resolves.toBe(false)
  })
})
