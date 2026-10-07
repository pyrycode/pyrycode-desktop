import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { AssistantMarkdown, remarkGfmSubset } from './AssistantMarkdown'
import { partitionMarkdown, pendingMarkdown } from './StreamingAssistantMarkdown'

const parser = unified().use(remarkParse).use(remarkGfmSubset)
const render = (text: string): string => renderToStaticMarkup(<AssistantMarkdown text={text} />)
const normalize = (markup: string): string => markup.replace(/>\s+</g, '><')
const fixtures = [
  'p\nA\n|-| f', 'b\n<e>\n-|3', '    a\n10. x', 'p\n> > -', '>\n    a\n1.',
  '>\n    a\n    b\n    c', '-\n\n    ~\n\n-', '[x][a]\n\n[a]: https://e.com',
  '[a]: /u\n"t"', 'p\n#t', '> q\n#', 'Title\n=', '1. a\n\n2.', '* a\n\n* * *tail*',
  '```js\na\n```x\nb\n```\n', 'first\n\nsecond\nline\n\nthird\nline\n',
  ...['- ', '> '].flatMap(prefix => ['[x][a]\n\n[a]: https://e.com', '[a]: /u\n"t"']
    .map(source => source.split('\n').map((line, index) => (prefix === '- ' && index > 0 ? '  ' : prefix) + line).join('\n')))
]

function replay(source: string): void {
  let partition: ReturnType<typeof partitionMarkdown> | undefined
  for (let end = 0; end <= source.length; end++) {
    const text = source.slice(0, end)
    partition = partitionMarkdown(text, partition)
    const units = [...partition.frozen, { text: text.slice(partition.offset), offset: partition.offset }]
    const nodes = units.flatMap(unit => {
      const tree = parser.parse(unit.text)
      // Compare every node field, shifting all source coordinates into the complete document.
      const line = text.slice(0, unit.offset).split('\n').length - 1
      return JSON.parse(JSON.stringify(tree.children, (key, value) =>
        key === 'offset' ? value + unit.offset : key === 'line' ? value + line : value))
    })
    expect(nodes, text).toEqual(parser.parse(text).children)
    expect(normalize(units.map(unit => render(unit.text)).join('')), text).toBe(normalize(render(text)))
  }
}

describe('parser-verified streaming partitions', () => {
  it.each(fixtures)('replays every original prefix of %j', replay)
  it('replays deterministic block-starter fuzz', () => {
    let seed = 1751
    const lines = ['p', '', '#', '#t', '>', '> q', '    a', '-', '* * *', '2.', '1. a', '| A | B |', '---', '|-|', '[a]: /u', '"t"', '```', '```x']
    for (let doc = 0; doc < 70; doc++) {
      const source = Array.from({ length: 7 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return lines[seed % lines.length]
      }).join('\n')
      replay(source)
    }
  })
  it('retains frozen objects, invalidates for definitions, resets replacement source', () => {
    const source = 'first\n\nsecond\nline\n\nthird\nline\n'
    const first = partitionMarkdown(source)
    expect(first.frozen.length).toBeGreaterThan(0)
    const next = partitionMarkdown(source + 'tail', first)
    expect(next.frozen[0]).toBe(first.frozen[0])
    const defined = partitionMarkdown(source + '\n[a]: /u', next)
    expect(defined.frozen).toEqual([])
    expect(defined.offset).toBe(0)
    expect(partitionMarkdown('replacement', next).offset).toBe(0)
  })
})

describe('pending presentation', () => {
  it.each([
    ['**bold', '<p>bold</p>'], ['`code ', '<p>code</p>'], ['**bold ', '<p>bold</p>'],
    ['[text](', '<p>text</p>'], ['[text](https://exa', '<p>text</p>'],
    ['**foo `bar**', '<p>foo bar**</p>'], ['2 * 3', '<p>2 * 3</p>'],
    ['snake_case_', '<p>snake_case_</p>'], ['see ~/path', '<p>see ~/path</p>'],
    ['\\[t](', '<p>[t](</p>'], ['**bold**', '<p><strong>bold</strong></p>'],
    ['| A | B |\n', 'A B'], ['| A | B |\n---', 'A B'], ['| A | B |\n:', 'A B'],
    ['| A | B |\n|', 'A B'], ['| A | B |\n| :', 'A B'], ['| `A|B` |', '`A B`'],
    ['> | A | B |', '<blockquote>A B</blockquote>'],
    ...[' ', '  ', '   ', '>   ', '> >   '].flatMap(prefix =>
      ['\n', '\n' + (prefix.includes('>') ? prefix : '') + '---', '\n' + prefix + ':'].map(suffix => [
        prefix + '| A | B |' + suffix,
        prefix.includes('> >') ? '<blockquote><blockquote>A B</blockquote></blockquote>'
          : prefix.includes('>') ? '<blockquote>A B</blockquote>' : 'A B'
      ])),
    ['> **bold', '<blockquote><p>bold</p></blockquote>'], ['# **bold', '<h1>bold</h1>'],
    ...['**bold', '`code'].flatMap(inline => [' #', ' ###  \t\n'].flatMap(closing => [
      ['# ' + inline + closing, '<h1>' + inline.replace(/^[*`]+/, '') + '</h1>'],
      ['> # ' + inline + closing, '<blockquote><h1>' + inline.replace(/^[*`]+/, '') + '</h1></blockquote>']
    ])),
    ['# **bold** #', '<h1><strong>bold</strong></h1>'],
    ['# **bold \\#', '<h1>bold #</h1>'], ['# `code #x', '<h1>code #x</h1>'],
    ['# **foo `bar #', '<h1>foo bar</h1>'],
    ['left | right\n\nnext', '<p>left | right</p><p>next</p>']
  ])('presents %j as %j', (source, expected) => {
    const pending = pendingMarkdown(source)
    const markup = renderToStaticMarkup(<AssistantMarkdown text={pending.text} allowElement={pending.allowElement} />)
    expect(source.includes('|') && expected.includes('A') ? markup.replace(/\s+/g, ' ').replace(/> /g, '>').replace(/ </g, '<').trim() : normalize(markup)).toBe(expected)
    // Virtual source preserves every original character in order.
    let index = 0
    for (const char of pending.text) if (char === source[index]) index++
    expect(index).toBe(source.length)
  })
  it('renders a completed table and preserves code while a closer grows', () => {
    for (const source of ['| A | B |\n--- | ---', '  | A | B |\n--- | ---', '>   | A | B |\n> --- | ---', '```js\na\n', '```js\na\n`', '```js\na\n``', '```js\na\n```x']) {
      const pending = pendingMarkdown(source)
      const markup = renderToStaticMarkup(<AssistantMarkdown text={pending.text} allowElement={pending.allowElement} />)
      expect(markup).toContain(source.includes('|') ? '<table>' : 'code-block__body')
      if (source.endsWith('```x')) expect(markup).toContain('```x')
    }
  })
  it('keeps HTML escaped, images inert and pending links untappable with reader opt-in', () => {
    for (const source of ['<script>alert(1)</script>', '![alt](https://example.com/x)', '[x](javascript:alert(1)', '[x](Plan.md']) {
      const pending = pendingMarkdown(source)
      const markup = renderToStaticMarkup(<AssistantMarkdown text={pending.text} allowElement={pending.allowElement} onOpenMarkdownPath={() => {}} />)
      expect(markup).not.toMatch(/<script|<img|<a\b|markdown-link/)
    }
    expect(render('**bold')).toBe('<p>**bold</p>')
  })
  it('retains raw heading syntax at settlement and leaves indented code alone', () => {
    expect(render('# **bold #  \t\n')).toBe('<h1>**bold</h1>')
    expect(render('# `code ###  \t\n')).toBe('<h1>`code</h1>')
    const source = '    | A | B |\n'
    const pending = pendingMarkdown(source)
    expect(pending.text).toBe(source)
    expect(renderToStaticMarkup(<AssistantMarkdown text={pending.text} allowElement={pending.allowElement} />)).toBe(render(source))
  })
})
