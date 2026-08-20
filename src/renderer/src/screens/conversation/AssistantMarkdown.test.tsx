import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantMarkdown } from './AssistantMarkdown'

// Server-render only (vitest `environment: 'node'`) — the ArchivedCountRow idiom. Every criterion in
// #608 is a property of the emitted markup, so a string is the right assertion surface.
//
// EVERY negative assertion below is paired with a positive one in the SAME case. `not.toContain('<a ')`,
// `not.toContain('<img')` and `not.toContain('<script')` are all satisfied by the empty string, so a
// case that rendered nothing at all would pass vacuously. The anti-interpretation cases additionally
// assert on a React-escaped character (`&lt;`, `&amp;`) so "escaped" is distinguished from "absent" —
// the two outcomes AC2 allows, only one of which this module actually produces.
//
// Fixtures are line arrays joined with '\n' rather than template literals: the hard-break fixture
// depends on trailing spaces, which survive inside a quoted string literal but not in raw source.
const render = (markdown: string): string =>
  renderToStaticMarkup(<AssistantMarkdown text={markdown} />)

const lines = (...src: string[]): string => src.join('\n')

describe('AssistantMarkdown', () => {
  it('converts every listed block construct to its element (AC1)', () => {
    const markup = render(
      lines(
        '# Heading one',
        '',
        '## Heading two',
        '',
        'Some **bold** and *italic* and `inline code`.',
        '',
        '```',
        'const x = 1',
        '```',
        '',
        '1. first',
        '2. second',
        '',
        '- alpha',
        '- beta',
        '',
        '> quoted'
      )
    )
    expect(markup).toContain('<h1>Heading one</h1>')
    expect(markup).toContain('<h2>Heading two</h2>')
    expect(markup).toContain('<strong>bold</strong>')
    expect(markup).toContain('<em>italic</em>')
    expect(markup).toContain('<code>inline code</code>')
    expect(markup).toContain('<pre>')
    expect(markup).toContain('const x = 1')
    expect(markup).toContain('<ol>')
    expect(markup).toContain('<ul>')
    expect(markup).toContain('<li>alpha</li>')
    expect(markup).toContain('<blockquote>')
    expect(markup).toContain('<p>')
  })

  it('converts a trailing-two-spaces hard break to <br>, keeping both lines (AC1)', () => {
    const markup = render(lines('first line  ', 'second line'))
    expect(markup).toContain('first line')
    expect(markup).toContain('second line')
    expect(markup).toContain('<br')
  })

  it('converts a trailing-backslash hard break to <br>, keeping both lines (AC1)', () => {
    const markup = render(lines('first line\\', 'second line'))
    expect(markup).toContain('first line')
    expect(markup).toContain('second line')
    expect(markup).toContain('<br')
  })

  it('escapes an inline HTML tag to visible characters rather than interpreting it (AC2)', () => {
    const markup = render('x <img src=q onerror=alert(1)> y')
    // Positive: the tag survives as escaped TEXT (not deleted) and its surroundings rendered.
    expect(markup).toContain('&lt;img src=q onerror=alert(1)&gt;')
    expect(markup).toContain('x ')
    expect(markup).toContain(' y')
    // Negative: no real element was constructed, so nothing can fire onerror.
    expect(markup).not.toContain('<img')
  })

  it('escapes a script tag to visible characters (AC2)', () => {
    const markup = render('Before <script>alert(1)</script> after')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).toContain('&lt;/script&gt;')
    expect(markup).toContain('Before')
    expect(markup).toContain('after')
    expect(markup).not.toContain('<script')
  })

  it('escapes a bare ampersand, proving the path escapes rather than drops (AC2)', () => {
    const markup = render('Tom & Jerry')
    expect(markup).toContain('Tom &amp; Jerry')
  })

  it('renders link syntax as its visible text with no anchor (AC3)', () => {
    const markup = render('see [click me](https://example.com) here')
    expect(markup).toContain('click me')
    expect(markup).toContain('here')
    expect(markup).not.toContain('<a ')
    expect(markup).not.toContain('href')
    expect(markup).not.toContain('example.com')
  })

  it('gives a javascript: href the same no-anchor treatment (AC3)', () => {
    const markup = render('[evil](javascript:alert(1))')
    expect(markup).toContain('evil')
    expect(markup).not.toContain('<a')
    expect(markup).not.toContain('javascript:')
  })

  it('renders a reference-style link as its label, resolving to no anchor (AC3)', () => {
    const markup = render(lines('[label][ref]', '', '[ref]: https://ref.example/target'))
    expect(markup).toContain('label')
    expect(markup).not.toContain('<a')
    expect(markup).not.toContain('ref.example')
  })

  it('renders an autolink as visible text with no anchor (AC3)', () => {
    const markup = render('<https://example.com>')
    // The URL is visible TEXT here — that is the point; what must not exist is the click target.
    expect(markup).toContain('https://example.com')
    expect(markup).not.toContain('<a')
  })

  it('renders image syntax as its alt text, producing no fetching element (AC4)', () => {
    const markup = render('![alt text](https://evil.example/pixel.png)')
    expect(markup).toContain('alt text')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('evil.example')
  })

  it('drops an empty-alt image entirely, leaving its sibling text (AC4)', () => {
    const markup = render('![](https://evil.example/pixel.png) sibling sentence')
    expect(markup).toContain('sibling sentence')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('evil.example')
  })

  it('keeps the language class on a fenced code block, the #609 label carrier', () => {
    // Figma 16:47 puts the language ("typescript") on the code block's header bar, and this class is
    // the only carrier for that value. Stripping it would look like hardening and would silently
    // delete the data #609 needs.
    const markup = render(lines('```typescript', 'const x: number = 1', '```'))
    expect(markup).toContain('class="language-typescript"')
    expect(markup).toContain('const x: number = 1')
  })
})
