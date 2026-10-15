import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantMarkdown } from './AssistantMarkdown'
import { partitionMarkdown, StreamingAssistantMarkdown } from './StreamingAssistantMarkdown'

const link = 'pyrycode://hosts/11111111-1111-4111-8111-111111111111/apps/22222222-2222-4222-8222-222222222222'
describe('conversation hosted links', () => {
  it('is opt-in and never emits an app URL attribute or activates during rendering', () => {
    const open = vi.fn(), text = `[Open app](${link} "ignored")`
    expect(renderToStaticMarkup(<AssistantMarkdown text={text} />)).toBe('<p>Open app</p>')
    const html = renderToStaticMarkup(<AssistantMarkdown text={text} onOpenHostedApp={open} />)
    expect(html).toBe('<p><button type="button" class="markdown-link">Open app</button></p>')
    expect(open).not.toHaveBeenCalled()
  })
  it.each(['inline', 'reference'])('accepts escaped titles independently of %s destinations', style => {
    const open = vi.fn()
    for (const destination of [link, `<${link}>`]) {
      for (const title of [String.raw`"The \"dashboard\""`, String.raw`'The \'dashboard\''`,
        String.raw`(The \(dashboard\))`, '"title with ]( punctuation"']) {
        const text = style === 'inline' ? `[Open](${destination} ${title})`
          : `[Open][app]\n\n[app]: ${destination} ${title}`
        for (const Renderer of [AssistantMarkdown, StreamingAssistantMarkdown]) {
          expect(renderToStaticMarkup(<Renderer text={text} onOpenHostedApp={open} />), text)
            .toBe('<p><button type="button" class="markdown-link">Open</button></p>')
          expect(renderToStaticMarkup(<Renderer text={text} />), text).toBe('<p>Open</p>')
        }
        if (style === 'inline') {
          const streaming = `${text}\n\nparagraph\nline\n\n${text}`
          expect(partitionMarkdown(streaming).frozen[0]?.text).toContain(text)
          const html = renderToStaticMarkup(<StreamingAssistantMarkdown text={streaming} onOpenHostedApp={open} />)
          expect(html.match(/class="markdown-link"/g), streaming).toHaveLength(2)
        }
      }
    }
    expect(open).not.toHaveBeenCalled()
  })
  it.each([String.raw`a\]:b`, String.raw`a\]:b\]:c`, String.raw`a\\\]:b`, String.raw`a\\`,
    String.raw`a\[:b`])('accepts canonical destinations after escaped reference label %s', label => {
    const open = vi.fn()
    for (const destination of [link, `<${link}>`]) {
      for (const title of ['', String.raw` "The \"dashboard\" with ]: punctuation"`]) {
        const text = `[Open][${label}]\n\n[${label}]: ${destination}${title}`
        for (const Renderer of [AssistantMarkdown, StreamingAssistantMarkdown]) {
          expect(renderToStaticMarkup(<Renderer text={text} onOpenHostedApp={open} />), text)
            .toBe('<p><button type="button" class="markdown-link">Open</button></p>')
          expect(renderToStaticMarkup(<Renderer text={text} />), text).toBe('<p>Open</p>')
        }
      }
    }
    expect(open).not.toHaveBeenCalled()
  })
  it('rejects escaped and normalized destinations while retaining visible labels', () => {
    for (const target of [link + '/', link + '?x=1', link + '#x', link.replace(':', '\\:'),
      link.replace(':', '&#58;'), link.replace('hosts', '%68osts'), link.replace('/apps/', '/a/../apps/')]) {
      for (const text of [`[Visible](${target})`, String.raw`[Visible](${target} "The \"dashboard\"")`,
        `[Visible](${target} "decoy ](${link})")`,
        String.raw`[Visible][a\]:b]` + '\n\n' + String.raw`[a\]:b]: ${target} "decoy ]: ${link}"`,
        String.raw`[Visible][app]` + '\n\n' + String.raw`[app]: ${target} "The \"dashboard\""`]) {
        for (const Renderer of [AssistantMarkdown, StreamingAssistantMarkdown]) {
          const html = renderToStaticMarkup(<Renderer text={text} onOpenHostedApp={() => {}} />)
          expect(html, text).toBe('<p>Visible</p>')
        }
      }
    }
  })
  it('forwards activation to both frozen units and pending streaming tail', () => {
    const text = `[Frozen](${link})\n\nparagraph\nline\n\n[Tail](${link})`
    const html = renderToStaticMarkup(<StreamingAssistantMarkdown text={text} onOpenHostedApp={() => {}} />)
    expect(html.match(/class="markdown-link"/g)).toHaveLength(2)
    expect(html).not.toContain('href=')
  })
  it('retains external, Obsidian and workspace links and supports reference destinations', () => {
    const text = `[Web](https://example.com) [Note](obsidian://open?vault=v&file=n) [File](notes.md) [App][a]\n\n[a]: ${link}`
    const html = renderToStaticMarkup(<AssistantMarkdown text={text} onOpenHostedApp={() => {}} onOpenMarkdownPath={() => {}} />)
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">Web</a>')
    expect(html).toContain('href="obsidian://open?vault=v&amp;file=n"')
    expect(html).toContain('class="markdown-link">File</button>')
    expect(html).toContain('class="markdown-link">App</button>')
    expect(renderToStaticMarkup(<AssistantMarkdown text={`[App](${link})`} onOpenMarkdownPath={() => {}} />)).toBe('<p>App</p>')
  })
})
