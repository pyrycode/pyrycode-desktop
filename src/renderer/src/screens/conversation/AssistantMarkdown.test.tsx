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
    // #623 gave the fence its chrome, so the bare `<pre>` this case asserted became the block's body.
    // This fixture's fence has NO info string, so it is the no-header degrade path that renders here.
    expect(markup).toContain('<pre class="code-block__body">')
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

  // #610 OPENED THE ALLOWLIST, so the three cases below — which asserted the deny-first treatment on
  // `https:` hrefs — are rewritten rather than deleted: the same three link SYNTAXES are still the
  // subject, only the expected markup moved. The `javascript:` case keeps its assertions verbatim, and
  // it is now one member of the denied SET enumerated further down.
  //
  // Each accepted case pins the whole anchor as ONE string. `target="_blank"` is in it deliberately and
  // is not decoration: it is what routes the click to setWindowOpenHandler (index.ts:56) and thence to
  // shell.openExternal. Without it the click is a same-document navigation that will-navigate cancels,
  // so the link would look right and do nothing — a failure no separate attribute assertion distinguishes
  // from success as clearly as one composed string does.
  it('renders an https link as an anchor carrying its href and text unchanged (AC1)', () => {
    const markup = render('see [click me](https://example.com) here')
    expect(markup).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">click me</a>'
    )
    expect(markup).toContain('here')
  })

  it('renders an http link as an anchor too, matching the window-open handler (AC1)', () => {
    // AC1 names BOTH schemes and the rewrites above cover only https:. The allowlist admits plaintext
    // http: because setWindowOpenHandler does (index.ts:63) and the two must agree — narrowing both to
    // https: would be a main-process change, so it is not this ticket's.
    const markup = render('[plain](http://example.com/a)')
    expect(markup).toContain(
      '<a href="http://example.com/a" target="_blank" rel="noreferrer">plain</a>'
    )
  })

  it('renders a reference-style link as an anchor on its resolved target (AC1)', () => {
    const markup = render(lines('[label][ref]', '', '[ref]: https://ref.example/target'))
    expect(markup).toContain(
      '<a href="https://ref.example/target" target="_blank" rel="noreferrer">label</a>'
    )
  })

  it('renders an autolink as an anchor whose href and text are both the URL (AC1)', () => {
    const markup = render('<https://example.com>')
    expect(markup).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">https://example.com</a>'
    )
  })

  it('gives a javascript: href the same no-anchor treatment (AC3)', () => {
    const markup = render('[evil](javascript:alert(1))')
    expect(markup).toContain('evil')
    expect(markup).not.toContain('<a')
    expect(markup).not.toContain('javascript:')
  })

  // The rest of AC2's denied set, one case per input rather than one render holding all of them: the
  // claim below is about the WHOLE emitted markup, so a shared render would have every fixture's absence
  // assertion answered by some other fixture's presence.
  //
  // Every link text is `t` — free of the substring `href`, which the claim forbids anywhere in the
  // markup and which a fixture named `[href](…)` would supply from its own visible text while the code
  // under test behaved correctly.
  const denied: Array<[string, string]> = [
    ['a data: href', '[t](data:text/html,hello)'],
    ['a file: href', '[t](file:///etc/passwd)'],
    // Permitted by react-markdown's built-in urlTransform but DENIED by setWindowOpenHandler, so a live
    // mail link would silently do nothing when clicked. The renderer narrows to match the handler.
    ['a mailto: href', '[t](mailto:a@b.example)'],
    ['an arbitrary custom scheme', '[t](pyry-evil://do/thing)'],
    // Rejected WITHOUT being resolved against the app's own document: under the dev server the base is
    // http: and this would resolve to a web scheme, while a packaged build's file: base would not — the
    // two builds must agree, and this test tier has no document base at all.
    ['a relative href', '[t](./doc.md)'],
    ['a protocol-relative href', '[t](//example.com/x)'],
    ['an empty href', '[t]()'],
    // The angle-bracket form, NOT `[t](not a url)`: the latter is not link syntax in CommonMark at all
    // and renders as literal text, so it would pass without the predicate ever seeing it. This one
    // reaches the override as `not%20a%20url`, which is what makes it a real test of the parse.
    ['a string that does not parse as a URL', '[t](<not a url>)'],
    // A scheme with NO AUTHORITY. It parses absolutely and its protocol IS on the allowlist, so the
    // scheme test alone admits it — but the browser still resolves it against the document base when the
    // click navigates (http://localhost:5173/example.com under the dev server, http://example.com/ when
    // packaged). It is the only guard on the authority condition; without this case that condition can be
    // deleted as a redundant second scheme check with every other test here still green.
    ['a scheme carrying no authority', '[t](http:example.com)']
  ]

  it.each(denied)('renders %s as its visible text with no anchor (AC2)', (_name, markdown) => {
    // ONE exact-markup claim rather than a toContain/not.toContain triple. It makes all three of those
    // statements at once — the visible text rendered, no `<a` exists, no `href` appears — and adds the
    // one they cannot: the denied URL reached the markup nowhere at all. It is also what fails an
    // implementation that leans on urlTransform alone, which emits `<a href="">t</a>` here: an anchor, a
    // click target, and the literal string `href`, all three of which AC2 forbids.
    expect(render(markdown)).toBe('<p>t</p>')
  })

  it('leaves a bare URL typed as plain text inert, with no anchor (AC2)', () => {
    // The no-remark-gfm design, asserted rather than assumed. A bare URL is not a link in CommonMark, so
    // nothing here has an href to allow or deny; the plugin that would manufacture one is the thing
    // AssistantMarkdown.tsx's header comment and ADR 0010 both name as excluded.
    expect(render('https://example.com')).toBe('<p>https://example.com</p>')
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

  it('keeps the language class on a fenced code block, the #623 label carrier', () => {
    // Figma 16:47 puts the language ("typescript") on the code block's header bar, and this class is
    // the only carrier for that value — `fenceLanguage` reads it rather than re-parsing the source.
    // Stripping it would look like hardening and would silently delete the label's only input.
    const markup = render(lines('```typescript', 'const x: number = 1', '```'))
    expect(markup).toContain('class="language-typescript"')
    expect(markup).toContain('const x: number = 1')
  })

  it('renders a languaged fence as the bordered block, language above the code (#623 AC1, AC2)', () => {
    const markup = render(lines('```typescript', 'const x: number = 1', '```'))
    // One string, so "a header exists", "it names the fence's own language" and "it sits inside the
    // block, above the body" are a single claim rather than three assertions that could hold apart.
    expect(markup).toContain(
      '<div class="code-block"><div class="code-block__header">typescript</div><pre class="code-block__body">'
    )
    expect(markup).toContain('const x: number = 1')
  })

  it('renders a fence with no language as the same block with no header bar (#623 AC3)', () => {
    const markup = render(lines('```', 'const x = 1', '```'))
    // The wrapper IMMEDIATELY followed by the body is the proof that no empty bar sits between them —
    // stronger than the absence assertion below, which alone would also pass on a header rendered
    // somewhere else entirely.
    expect(markup).toContain('<div class="code-block"><pre class="code-block__body">')
    expect(markup).toContain('const x = 1')
    expect(markup).not.toContain('code-block__header')
  })

  it('bounds a pathological info string rather than letting it stretch the header (#623 AC4)', () => {
    // A single unbroken word far past any real language name (the longest, `restructuredtext`, is 16),
    // every character distinct so no prefix can be mistaken for the whole.
    const info = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const markup = render(lines('```' + info, 'const x = 1', '```'))
    const label = /<div class="code-block__header">([^<]*)<\/div>/.exec(markup)?.[1] ?? ''
    // Positive: a label rendered at all, and it is a genuine prefix of what the fence declared.
    expect(label.length).toBeGreaterThan(0)
    expect(info.startsWith(label)).toBe(true)
    // Negative: it is SHORTER than the fence's string, so the bound applied, and the dropped tail
    // reached no rendered text. Asserted on the label rather than on the whole markup: the untruncated
    // string is still present there as the `language-…` class the carrier case above pins, and that
    // attribute is not displayed — the bound this criterion is about is a bound on what is DRAWN.
    expect(label.length).toBeLessThan(info.length)
    expect(markup).not.toContain('>' + info + '<')
  })

  it('renders a markup-character info string as inert escaped text (#623 AC4)', () => {
    // Deliberately SHORT — under the truncation bound — so this case reads the escaping half of AC4
    // and the case above reads the bounding half, neither standing in for the other.
    const markup = render(lines('```<b>x</b>', 'const x = 1', '```'))
    // Positive: the label survives as escaped TEXT (not deleted), and the block still rendered.
    expect(markup).toContain('<div class="code-block__header">&lt;b&gt;x&lt;/b&gt;</div>')
    expect(markup).toContain('const x = 1')
    // Negative: no real element was constructed from it.
    expect(markup).not.toContain('<b')
  })
})
