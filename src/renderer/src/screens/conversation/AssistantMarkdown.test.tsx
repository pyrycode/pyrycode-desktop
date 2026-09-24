import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantMarkdown, markdownLinkPath } from './AssistantMarkdown'
import { MAX_WORKSPACE_FILE_PATH_LENGTH } from '@shared/ipc/workspaceFileRead'

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

/**
 * Occurrences of `pattern` in the markup — the QuestionPanel.test.tsx idiom.
 *
 * #1080's task-list cases count class occurrences rather than matching a whole `class="…"` run, because
 * a later shared-treatment lift would turn `class="task-mark"` into `class="shared task-mark"` and a
 * whole-run assertion would then fail while proving nothing about the thing it was written to protect.
 * A count says "two marks, one of them checked" whatever else joins the run. The two shape assertions
 * that DO match a whole run are deliberate and named where they appear.
 */
const count = (markup: string, pattern: RegExp): number => [...markup.matchAll(pattern)].length

describe('AssistantMarkdown', () => {
  it('adds a native copy button to each code block, but not inline code', () => {
    const markup = render(lines(
      '`inline`', '', '```ts', '  const tag = "<b>&amp;</b>"', '', '```',
      '', '```', 'second block', '```'
    ))
    expect(count(markup, /<button type="button"[^>]*aria-label="Copy code"/g)).toBe(2)
    expect(count(markup, /class="code-block__header"/g)).toBe(1)
    expect(markup).toContain('<code>inline</code>')
    expect(markup).toContain('  const tag = &quot;&lt;b&gt;&amp;amp;&lt;/b&gt;&quot;\n\n</code>')
    expect(markup).not.toContain('<b>')
    expect(render('`inline only`')).not.toContain('<button')
  })

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
      '<div class="code-block code-block--copyable"><div class="code-block__header">typescript</div><pre class="code-block__body">'
    )
    expect(markup).toContain('const x: number = 1')
  })

  it('renders a fence with no language as the same block with no header bar (#623 AC3)', () => {
    const markup = render(lines('```', 'const x = 1', '```'))
    // The wrapper IMMEDIATELY followed by the body is the proof that no empty bar sits between them —
    // stronger than the absence assertion below, which alone would also pass on a header rendered
    // somewhere else entirely.
    expect(markup).toContain('<div class="code-block code-block--copyable"><pre class="code-block__body">')
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
    expect(markup).not.toMatch(/<b(?:\s|>)/)
  })

  // #1079 — the GFM table subset. Every case below is about the SUBSET being exactly one construct
  // wide: the table renders, and the four other members of the `remark-gfm` bundle stay uninstalled.
  //
  // A three-column table with all three alignment markers, reused by the cases that follow so the
  // alignment claim and the structure claim are made against the same fixture rather than two.
  const ALIGNED_TABLE = lines(
    '| Left | Middle | Right |',
    '| :--- | :----: | ----: |',
    '| a    | b      | c     |'
  )

  it('renders a table as a table, header row and body rows (#1079 AC1)', () => {
    const markup = render(ALIGNED_TABLE)
    // The nesting asserted as ONE string per row group, so "a table exists", "it has a head" and "the
    // head holds a row of header cells" is a single claim rather than three that could hold apart —
    // the `code-block` cases above set that idiom. A pipe table that failed to parse renders one <p>
    // of raw pipes, which contains none of these.
    expect(markup).toContain('<table><thead><tr>')
    expect(markup).toContain('</thead><tbody><tr>')
    // Header cells are <th> and body cells are <td>: the distinction the header row exists to make.
    expect(markup).toContain('Left')
    expect(markup).toContain('>a<')
    expect(markup).toContain('<th')
    expect(markup).toContain('<td')
    // Negative, paired: the pipes are GONE from the rendered text — the unreadable jam this ticket is
    // about. Asserted on the delimiter row, whose every character is markdown syntax with no text of
    // its own, so a surviving one can only be an unparsed table.
    expect(markup).not.toContain(':----:')
  })

  it('takes per-column alignment from the :-- / :-: / --: markers (#1079 AC1)', () => {
    const markup = render(ALIGNED_TABLE)
    // The three markers, in the fixture's column order. MEASURED, not assumed: mdast-util-to-hast puts
    // the alignment on the cell as `align` and then its `tableCellAlignToStyle` option — ON by default —
    // rewrites it into an inline `style`, which is the form that actually ships. That distinction is the
    // security-relevant half, and the case below is where it is bounded.
    expect(markup).toContain('style="text-align:left"')
    expect(markup).toContain('style="text-align:center"')
    expect(markup).toContain('style="text-align:right"')
  })

  it('confines the alignment attribute to its closed enum on a hostile delimiter row (#1079 AC1)', () => {
    // THE SECURITY CASE, and the one the plan's review names as mandatory. The alignment `style` is the
    // only new attribute this change lets the parser emit from daemon text — and a style string is a
    // CSS sink, so what matters is that its value can never BE daemon text. Upstream, `Align` is
    // 'center' | 'left' | 'none' | 'right', inferred from micromark EVENT TYPES rather than copied from
    // the delimiter cell (micromark-extension-gfm-table/lib/infer.js) — this asserts that rather than
    // trusting it, because "the enum is closed" is exactly the claim a dependency minor can falsify.
    //
    // The delimiter cells carry text that would be catastrophic if it were ever copied into an
    // attribute: a quote to break out of one, and a url() a CSS sink would fetch.
    const markup = render(
      lines(
        '| A | B |',
        '| :--x" onload="alert(1) | ---: url(http://evil.test) |',
        '| a | b |'
      )
    )
    // Positive FIRST, because every negative below is satisfied by the empty string. GFM requires a
    // delimiter cell to be `:?-+:?` and nothing else, so this row does not match, the block is not a
    // table at all, and its text renders as ESCAPED characters — the quote that would have broken out
    // of an attribute arrives as `&quot;`. That is the "escaped, not absent" discriminator the rest of
    // this file uses, and it is the positive half this case would otherwise lack.
    expect(markup).toContain('&quot; onload=&quot;alert(1)')
    expect(markup).toContain('url(http://evil.test)')
    // Negative: the text is TEXT. No attribute was named from it, and no element built out of it.
    // Asserted as `onload="` rather than as the bare word, because the word legitimately appears in
    // the rendered text above and forbidding it there would be forbidding the correct behaviour.
    expect(markup).not.toContain('onload="')
    expect(markup).not.toContain('<table')
    expect(markup).not.toContain('style=')
    // THE ENUM SWEEP, and the assertion that generalises past this fixture: EVERY style declaration the
    // module emits is a `text-align` carrying one of the three values. Run over both renders in one
    // case on purpose — this fixture proves a hostile delimiter contributes none, and the aligned one
    // makes the sweep non-vacuous. Split across two cases, the second could quietly stop producing any
    // and the first would still pass.
    const styles = (source: string): string[] =>
      [...source.matchAll(/style="([^"]*)"/g)].map((match) => match[1])
    expect(styles(markup)).toEqual([])
    const aligned = styles(render(ALIGNED_TABLE))
    expect(aligned.length).toBeGreaterThan(0)
    for (const value of aligned) {
      expect(['text-align:left', 'text-align:center', 'text-align:right']).toContain(value)
    }
  })

  it('renders markup-looking cell text as inert escaped characters (#1079 AC4)', () => {
    const markup = render(
      lines('| Cell |', '| --- |', '| <b>bold</b> and <img src=q onerror=alert(1)> |')
    )
    // Positive: the tag survives as escaped TEXT inside a real cell — the same escaped-not-deleted
    // discriminator every anti-interpretation case in this file uses.
    expect(markup).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(markup).toContain('&lt;img src=q onerror=alert(1)&gt;')
    expect(markup).toContain('<td')
    // Negative: no real element was constructed, so nothing can fire onerror.
    expect(markup).not.toContain('<b>bold')
    expect(markup).not.toContain('<img')
  })

  it('keeps the link and image overrides in force inside a table cell (#1079 AC4)', () => {
    // The overrides are keyed on ELEMENT TYPE, not on ancestry, so a cell should not be a new
    // enforcement gap — proven here rather than assumed, because the table is the first construct
    // this file ships that puts a link inside a container it did not previously emit.
    const markup = render(
      lines(
        '| Link | Denied | Image |',
        '| --- | --- | --- |',
        '| [ok](https://example.com/a) | [no](javascript:alert(1)) | ![alt text](https://example.com/i.png) |'
      )
    )
    // The allowed link is a real anchor carrying its href verbatim, with the click mechanism intact.
    expect(markup).toContain('<a href="https://example.com/a" target="_blank" rel="noreferrer">ok</a>')
    // The denied link renders as its visible text, with no anchor and no href anywhere for it.
    expect(markup).toContain('no')
    expect(markup).not.toContain('javascript:')
    // The image renders as alt text only — no fetching element inside a cell either.
    expect(markup).toContain('alt text')
    expect(markup).not.toContain('<img')
  })

  it('still renders a bare URL and a bare email as plain text, with no anchor (#1079 AC4)', () => {
    // THE CRITERION TO PROVE RATHER THAN ASSERT. `remark-gfm` would have manufactured anchors from
    // both; the autolink-literal extension is simply not installed, so there is nothing to suppress.
    // Positive first — both cases would pass their negatives vacuously on an empty render.
    const url = render('bare https://example.com here')
    expect(url).toContain('bare ')
    expect(url).toContain('https://example.com')
    expect(url).toContain(' here')
    expect(url).not.toContain('<a ')
    expect(url).not.toContain('href')

    const mail = render('mail me at a@b.com ok')
    expect(mail).toContain('mail me at ')
    expect(mail).toContain('a@b.com')
    expect(mail).toContain(' ok')
    expect(mail).not.toContain('<a ')
    expect(mail).not.toContain('href')
  })

  it('installs table, task list and strikethrough only — no autolink literal, no footnote (#1080 AC5)', () => {
    // #1079 WROTE THIS CASE THE OTHER WAY ROUND, asserting the absence of four bundle members. #1080
    // INVERTS two arms rather than deleting the case: strikethrough and task lists are now installed, so
    // their arms become positive, and the "only" claim narrows to what genuinely remains uninstalled.
    // Each positive still pairs with a negative, so none of these passes on a render that produced
    // nothing. The two constructs' own treatment is the subject of the four cases below; this one is the
    // SUBSET BOUNDARY — what the plugin does and does not register.
    const strike = render('a ~~struck~~ b')
    expect(strike).toContain('<del>struck</del>')
    expect(strike).not.toContain('~~')

    // The brackets are CONSUMED by the construct rather than surviving as text — the discriminator that
    // separates "parsed" from "rendered raw", which is exactly what this case asserted in reverse.
    const task = render(lines('- [ ] open', '- [x] done'))
    expect(task).toContain('open')
    expect(task).toContain('done')
    expect(task).not.toContain('[ ]')
    expect(task).not.toContain('[x]')

    // ...and the two members still NOT installed, which is what "only" now means. The autolink literal's
    // arm is the case above (a bare URL and a bare email, both still plain text with no anchor) — kept
    // there because it needs the paired positives that case already builds. This is the footnote's.
    // Its reference renders as text and its definition as a link reference definition whose target
    // `allowedLinkHref` rejects — unchanged behaviour, not a regression this ticket introduces.
    const footnote = render(lines('a ref[^1] here', '', '[^1]: the note'))
    expect(footnote).toContain('here')
    expect(footnote).not.toContain('footnote')
    expect(footnote).not.toContain('<sup')
  })

  it('renders a task list as two distinguishable marks, in both list tightnesses (#1080 AC1)', () => {
    const markup = render(lines('- [ ] open', '- [x] done', '- plain'))

    // The <li> keeps the class the hast handler emits. It hides no bullet by itself — it is a hook for
    // github-markdown-css, which this repo does not ship — so it is the styling hook the suppression
    // rule in conversation.css hangs on, and nothing more.
    expect(count(markup, /class="task-list-item"/g)).toBe(2)

    // The <ul> gains one too, from the LIST handler rather than the list-item one. Pinned here because
    // conversation.css deliberately does NOT hang the bullet suppression on it: a list may mix task
    // items with plain ones — this fixture does — and suppressing per-list would take the plain item's
    // bullet with it. Per-item is the correct grain, and this assertion is why that is a choice.
    expect(count(markup, /class="contains-task-list"/g)).toBe(1)

    // DISTINGUISHABLE, which is the whole of AC1's first half: two marks, exactly one of them checked.
    // Counted, not matched as a whole class run — see the `count` docstring.
    expect(count(markup, /\btask-mark\b/g)).toBe(3) // once unchecked, twice in the checked run
    expect(count(markup, /task-mark--checked/g)).toBe(1)

    // The unmarked third item is untouched: no class, no mark, still rendered. Without it a rule that
    // treated every <li> in the container would pass every assertion above.
    expect(markup).toContain('<li>plain</li>')

    // TIGHTNESS DECIDES WHICH ELEMENT THE MARK LANDS IN, and therefore which existing `li > *` rule
    // reaches it — the one structural fact the stylesheet depends on. Tight: mdast-util-to-hast unwraps
    // the paragraph it inserted the mark into, so the mark is a direct child of the <li>. These two are
    // whole-run matches on purpose: the claim IS the element nesting, not the class alone.
    expect(markup).toContain('<li class="task-list-item"><span class="task-mark"')

    // Loose (blank lines between items): the paragraph survives and wraps the mark instead. Matched
    // with `\s*` because a loose item is emitted across lines — the claim is the NESTING, and writing it
    // as a literal run would make this assertion about the serialiser's newlines instead.
    const loose = render(lines('- [x] done', '', '- [ ] open'))
    expect(loose).toMatch(/<li class="task-list-item">\s*<p><span class="task-mark/)
  })

  it('puts no interactive element in a reply — the checkbox is overridden away (#1080 AC3)', () => {
    const markup = render(lines('- [ ] open', '- [x] done'))

    // AC3's decision, ASSERTED RATHER THAN DESCRIBED. mdast-util-to-hast emits an <input type="checkbox"
    // disabled> for each item; the `input` override renders a <span> instead, so no form control reaches
    // the DOM at all — nothing to keep disabled, no submission target, no autofill surface in the window
    // that holds the transport bridge.
    expect(markup).not.toContain('<input')
    expect(markup).not.toContain('type="checkbox"')
    expect(markup).not.toContain('disabled')

    // ...and nothing else in the render can take a click, a focus or a keyboard toggle either. In THIS
    // tier that is a structural claim — renderToStaticMarkup under environment: 'node', no DOM and no
    // handlers. The behavioural half clicks a real mark, in e2e/assistant-whitespace.spec.ts.
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('tabindex')
    expect(markup).not.toContain('contenteditable')
    expect(markup).not.toContain('onclick')

    // The positives that keep all seven negatives above non-vacuous, and AC1's accessibility half: the
    // state reaches the accessibility tree as a labelled image rather than as a control or as TEXT. A
    // visually-hidden text label would have read the same to a screen reader and put a text node inside
    // .bubble, which is what every whole-bubble `toHaveText` in e2e/ would then have to admit.
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Not done"')
    expect(markup).toContain('aria-label="Done"')
  })

  it('renders strikethrough, keeps the singleTilde default, and leaves a path pair alone (#1080 AC2)', () => {
    const double = render('a ~~struck~~ b')
    expect(double).toContain('<del>struck</del>')
    expect(double).not.toContain('~~')

    // `singleTilde` defaults to ON and is DELIBERATELY LEFT THERE. Disabling it would be a defence
    // against a failure nobody has observed; the obvious candidate is pinned below instead.
    const single = render('a ~struck~ b')
    expect(single).toContain('<del>struck</del>')

    // THE HAZARD, pinned rather than re-derived: two home-relative paths on one line are not a
    // strikethrough run. GFM requires the closing marker to be right-flanking, and a path's tilde is
    // followed by a slash and preceded by a space, so it can only ever open. This is the assertion that
    // turns red if a later version changes that flanking rule — the signal to reconsider the option.
    const paths = render('paths ~/config and ~/other are both real')
    expect(paths).toContain('~/config')
    expect(paths).toContain('~/other')
    expect(paths).not.toContain('<del')
  })

  it('renders markup-looking task and struck text as inert escaped characters (#1080 AC1, AC2)', () => {
    const markup = render(
      lines('- [x] <b>bold</b> and <img src=q onerror=alert(1)>', '', '~~<script>alert(1)</script>~~')
    )

    // Positive: both survive as escaped TEXT inside the real new elements — the escaped-not-absent
    // discriminator every anti-interpretation case in this file uses.
    expect(markup).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).toContain('<del>')
    expect(markup).toContain('task-mark--checked')

    // Negative: no element was constructed out of any of it.
    expect(markup).not.toContain('<b>bold')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<script')

    // AND NO DAEMON TEXT REACHED AN ATTRIBUTE — the security-review finding this case exists to pin.
    // The source's ONLY influence over the mark is a boolean (`node.checked`), which selects between
    // client-owned constants for the class and the label; nothing interpolates the item's own text. The
    // sweep is what turns red if a later edit ever labels a mark with what the daemon wrote.
    expect(markup).not.toContain('style=')
    expect(markup).not.toContain('href')
    expect(markup).not.toContain('alert(1)"')
  })

  it('keeps the link and image overrides in force inside a task item and a <del> (#1080 AC1, AC2)', () => {
    // The overrides are keyed on ELEMENT TYPE, not on ancestry — #1079 proved that for a table cell and
    // the same question reopens for every container this file starts emitting. Two new ones here.
    const markup = render(
      lines(
        '- [x] [ok](https://example.com/a) and ![alt text](https://example.com/i.png)',
        '- [ ] [no](javascript:alert(1))',
        '',
        '~~[also ok](https://example.com/b)~~'
      )
    )
    // Allowed links are real anchors carrying their href verbatim, with the click mechanism intact.
    expect(markup).toContain('<a href="https://example.com/a" target="_blank" rel="noreferrer">ok</a>')
    expect(markup).toContain(
      '<a href="https://example.com/b" target="_blank" rel="noreferrer">also ok</a>'
    )
    // The denied link renders as its visible text, with no anchor and no href anywhere for it.
    expect(markup).toContain('no')
    expect(markup).not.toContain('javascript:')
    // The image renders as alt text only — no fetching element inside a task item either.
    expect(markup).toContain('alt text')
    expect(markup).not.toContain('<img')
  })
})

// #1627 — a relative link to a markdown file becomes a control that opens the in-app reader. The rule is
// `markdownLinkPath`; the control exists only when the caller passes `onOpenMarkdownPath`.
describe('markdownLinkPath (#1627)', () => {
  it.each([
    ['notes/Plan.md', 'notes/Plan.md'],
    ['Plan.markdown', 'Plan.markdown'],
    ['notes/PLAN.MD', 'notes/PLAN.MD'],
    ['notes/Plan.md:12', 'notes/Plan.md'],
    ['notes/Plan.md:12:3', 'notes/Plan.md'],
    ['notes/Plan.md#next-steps', 'notes/Plan.md'],
    // No slash before the colon: read as a line suffix, not as a URL scheme `plan.md:`.
    ['Plan.md:12', 'Plan.md'],
    // micromark percent-encodes a destination; it is decoded exactly once.
    ['notes/My%20Plan.md', 'notes/My Plan.md'],
    ['notes/100%2525.md', 'notes/100%25.md'],
    ['/abs/path/Plan.md', '/abs/path/Plan.md']
  ])('reads %s as the markdown path %s', (href, path) => {
    expect(markdownLinkPath(href)).toBe(path)
  })

  it.each([
    [undefined],
    [''],
    ['https://example.com/Plan.md'],
    ['file:///home/me/Plan.md'],
    ['javascript:alert(1)//.md'],
    ['mailto:someone@example.com.md'],
    ['notes/plan.txt'],
    ['notes/Plan.md?raw=1'],
    ['notes/Plan.mdx'],
    // An escape that does not decode keeps today's plain-text rendering.
    ['notes/%E0%A4%A.md'],
    // The main-side guard drops an over-length path silently; the window never asks for one.
    [`${'a'.repeat(MAX_WORKSPACE_FILE_PATH_LENGTH)}.md`]
  ])('is not a markdown path: %s', (href) => {
    expect(markdownLinkPath(href)).toBeNull()
  })
})

describe('AssistantMarkdown markdown-path links (#1627)', () => {
  const renderWithOpen = (markdown: string): string =>
    renderToStaticMarkup(<AssistantMarkdown text={markdown} onOpenMarkdownPath={() => {}} />)

  it('renders a markdown path as a button whose path appears in no attribute', () => {
    const markup = renderWithOpen('See [the plan](notes/Secret-Plan.md:12) now.')
    expect(markup).toContain('<button type="button" class="markdown-link">the plan</button>')
    expect(markup).not.toContain('Secret-Plan')
    expect(markup).not.toContain('<a ')
  })

  it('shows the path only where the reply already had it: the visible link text', () => {
    const markup = renderWithOpen('[notes/Plan.md](notes/Plan.md)')
    expect(count(markup, /notes\/Plan\.md/g)).toBe(1)
    expect(markup).toContain('>notes/Plan.md</button>')
  })

  it('keeps every other link on the allowedLinkHref rule', () => {
    const markup = renderWithOpen('[web](https://example.com/Plan.md) and [txt](notes/plan.txt)')
    expect(markup).toContain('<a href="https://example.com/Plan.md" target="_blank" rel="noreferrer">web</a>')
    expect(markup).toContain('and txt')
    expect(markup).not.toContain('<button type="button" class="markdown-link"')
  })

  it('renders a markdown path as plain text when no opener is passed (the reader, other call sites)', () => {
    const markup = render('See [the plan](notes/Plan.md) now.')
    expect(markup).toContain('See the plan now.')
    expect(markup).not.toContain('markdown-link')
    expect(markup).not.toContain('<a ')
  })
})
