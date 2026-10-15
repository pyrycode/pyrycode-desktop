import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantMarkdown } from './AssistantMarkdown'
import { StreamingAssistantMarkdown } from './StreamingAssistantMarkdown'

const link = 'pyrycode://hosts/11111111-1111-4111-8111-111111111111/apps/22222222-2222-4222-8222-222222222222'
describe('conversation hosted links', () => {
  it('is opt-in and never emits an app URL attribute or activates during rendering', () => {
    const open = vi.fn(), text = `[Open app](${link} "ignored")`
    expect(renderToStaticMarkup(<AssistantMarkdown text={text} />)).toBe('<p>Open app</p>')
    const html = renderToStaticMarkup(<AssistantMarkdown text={text} onOpenHostedApp={open} />)
    expect(html).toBe('<p><button type="button" class="markdown-link">Open app</button></p>')
    expect(open).not.toHaveBeenCalled()
  })
  it('rejects escaped and normalized destinations while retaining visible labels', () => {
    for (const target of [link + '/', link + '?x=1', link + '#x', link.replace(':', '\\:'),
      link.replace(':', '&#58;'), link.replace('hosts', '%68osts'), link.replace('/apps/', '/a/../apps/')]) {
      const html = renderToStaticMarkup(<AssistantMarkdown text={`[Visible](${target})`} onOpenHostedApp={() => {}} />)
      expect(html, target).toBe('<p>Visible</p>')
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
