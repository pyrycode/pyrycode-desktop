# Assistant markdown renderer

Converts assistant-reply markdown source into React elements — headings, emphasis, lists, code, blockquotes — with raw HTML incapable of interpretation on this path. Introduced in [#608](../codebase/608.md) shipped dormant, then wired into the thread by [#609](../codebase/609.md): a **settled** `assistantText` bubble now renders through it inside a `.bubble__markdown` container, while the still-growing in-progress tail keeps the original plain-text render with the streaming cursor. [#623](../codebase/623.md) then gave a fenced code block its chrome — a bordered, rounded `.code-block` with an optional header bar naming the fence's language above a divider. [#628](../codebase/628.md) then sized `h1`–`h6` from the type scale in place of the UA's `2em..0.67em`/`bold`. [#629](../codebase/629.md) then took over the last two UA-laid-out constructs — `ul`/`ol` indent and `blockquote` margin — replacing the UA's 40px with a `--space-4` indent (list) and a `--space-3` indent plus a 4px `--color-outline` leading bar (blockquote), and established the container's 8px block rhythm one level inside either, which `.bubble__markdown`'s own direct-child reset and flex `gap` never reached. All four of these post-#609 tickets are CSS-only, hung under `.bubble__markdown`'s single call site — none of them touch this file. See [ADR 0010](../decisions/0010-markdown-renderer-capability-absent-html.md) for the full library-choice rationale and security review, and [Conversation shell § assistantText](conversation-shell.md) for the fork itself.

## What it does

Takes the exact untrusted string `TimelineRow`'s `assistantText` arm already renders as plain, auto-escaped text (`ConversationScreen.tsx:492-499`, the posture this module inherits rather than redefines — see also [Conversation shell](conversation-shell.md)) and turns markdown syntax in it into real markup, while guaranteeing:

- Raw HTML in the source is never interpreted — it renders as literal, escaped text (`<script>` → `&lt;script&gt;`), never deleted, never parsed into a real element.
- Link syntax renders as its visible text only, with **no anchor element**, for every href including `http:`/`https:`/`javascript:`.
- Image syntax renders as its alt text only, with **no `<img>` element** — no element on this path can ever fetch a remote resource, independent of the CSP.

## How it works

One file: `src/renderer/src/screens/conversation/AssistantMarkdown.tsx`.

```tsx
export function AssistantMarkdown({ text }: { text: string }): JSX.Element
```

A pure function of `text` — no state, no effects, no store access, parses synchronously during render, emits no wrapper element of its own (`react-markdown` v10 emits block elements directly; the container and its class are [#609](../codebase/609.md)'s `.bubble__markdown`, a flex column with `gap: var(--space-2)` for Figma `16:43`'s 8px block rhythm). Built on `react-markdown@10.1.0` with:

- **No `rehypePlugins`, no `remarkPlugins`.** No HTML parser exists in the dependency graph at all — interpreting HTML would require adding `rehype-raw` to `package.json`, a visible, reviewable act, not a config flip. `remark-gfm` is deliberately never added; it would auto-link bare URLs, manufacturing exactly the anchors this module suppresses.
- **`skipHtml` left at its default (unset).** The tempting-looking `skipHtml: true` *deletes* HTML tags and promotes their inner text into the message; the default *escapes* them to visible characters instead, matching the bubble's pre-existing untrusted-text posture and preserving the `&lt;`/`&amp;` discriminator tests need.
- **`components.a`** → renders `children` only (no anchor, ever).
- **`components.img`** → renders `alt` only (no `<img>`, ever; `''` when alt is absent).
- **`components.code`** → not overridden. Its `class="language-*"` is React-escaped (inert) and structurally can't collide with an app CSS class (mandatory `language-` prefix) — and it's the sole carrier of the fenced-code language label Figma `16:47` specifies, read by `components.pre` below.
- **`components.pre`** ([#623](../codebase/623.md)) → wraps the fence in `<div className="code-block">`, preceded by `<div className="code-block__header">` when the module-private `fenceLanguage(children)` helper finds one. `fenceLanguage` reads the `language-*` class off the fence's `<code>` child (never re-parses the message source), token-scans rather than pattern-matches the class, truncates to 20 characters, and fails closed to `null` — the same no-header render a languageless fence gets — for anything that isn't a `<code>` element carrying that class, including a non-fenced indented code block. `code` itself is still not overridden: a languageless fence and inline code share the same `className`-less shape, and inline code's own treatment is [#624](https://github.com/pyrycode/pyrycode-desktop/issues/624)'s.

Neither the `a` nor `img` override spreads `{...props}` — a spread would put `href`/`src` straight back while every visible-text test assertion kept passing, so the no-spread rule is enforced by construction (a code comment flags it), not by test coverage alone.

## Configuration and usage

Its only importer, `ConversationScreen.tsx`'s `assistantText` arm: `<AssistantMarkdown text={item.text} />` inside `<div className="bubble__markdown">`, rendered only when `inProgress` is false (the settled branch). #609 resolved the two questions #608 deliberately left open:

- **The container and its whitespace.** Rather than neutralising `.bubble--assistant-text`'s `white-space: pre-wrap` ([#607](../codebase/607.md)) *inside* the new container, `bubble--assistant-text` itself became conditional on `inProgress` — the settled branch never carries the class at all, so "markdown owns the whitespace" holds by construction (an absent declaration, not an override that must be re-verified whenever a new element type appears inside the container).
- **`React.memo` at the render site.** Declined, not deferred to a later ticket: #609's spec and code review both concluded no failure has been observed, `micromark` is a non-backtracking fuzz-tested parser rather than a regex engine, and — decisively — this repo's only renderer test tier (`renderToStaticMarkup`, no DOM) cannot observe a skipped re-render, so adding it now would ship unverified. The seam is named at the render site: a memoized wrapper component keyed on `text` (not `useMemo`, since hooks can't be called from inside `TimelineRow`'s switch), sound because the render is a pure function of that one prop.

## Edge cases and limitations

- **Reference-style links and autolinks get the same no-anchor treatment as inline links** — `[label][ref]` and `<https://example.com>` both render their visible text/URL with no `<a>`, verified as its own test case rather than assumed to fall out of the inline-link override.
- **A `javascript:` href never reaches the DOM in the first place**, because no anchor is produced at all — this module doesn't rely on `react-markdown`'s built-in `urlTransform` (which independently blanks `javascript:` hrefs) as the safety mechanism. [#610](https://github.com/pyrycode/pyrycode-desktop/issues/610) is the ticket that opens the `http:`/`https:` allowlist and will be the first consumer of `urlTransform`.
- **Empty-alt images (`![]()`) render nothing but leave sibling text intact** — no `<img>`, no placeholder, the empty string from `alt ?? ''`.
- **GFM tables and bare-URL autolinking are out of scope by design**, not a gap — both require `remark-gfm`, which is deliberately not added (see above).
- **A pathological document costs parse time on the render thread, recurring on every re-render** — accepted, bounded in practice by daemon message sizing; `micromark` is fuzz-tested CommonMark, not a backtracking regex engine, so catastrophic blowup isn't the expected failure shape. `React.memo` at the #609 render site is the named, declined mitigation seam — see § Configuration and usage.
- **No longer dormant.** Live in production since [#609](../codebase/609.md): every settled assistant reply renders through this module. Verify with `grep -rn "AssistantMarkdown" src/renderer/src/screens/conversation/ConversationScreen.tsx` — the import and the render-site usage are the two hits.
- **A fence's language label is display-bounded, not just visually clipped.** `MAX_LANGUAGE_CHARS = 20` truncates in `fenceLanguage` itself (the layer the server-render unit tier can see); `.code-block__header`'s `nowrap`+`ellipsis`+`overflow:hidden` is a second, different-fabric bound for the narrow-window residual truncation alone can't cover. Neither is redundant with the other.

## Related

- [ADR 0010](../decisions/0010-markdown-renderer-capability-absent-html.md) — the library choice (`react-markdown` over `markdown-to-jsx`/`marked-react`), the `skipHtml` trap, and the full security rationale.
- [#608 codebase notes](../codebase/608.md) — implementation summary, verified construct-coverage table, code-review record.
- [#609 codebase notes](../codebase/609.md) — the consumer: the `assistantText` fork, the `.bubble__markdown` container and its block-rhythm/code-wrap CSS, the conditional `bubble--assistant-text` modifier, and the `React.memo` decline.
- [#623 codebase notes](../codebase/623.md) — the `pre` override, `fenceLanguage`, and the `.code-block`/`.code-block__header`/`.code-block__body` CSS.
- [#628 codebase notes](../codebase/628.md) — the `h1`–`h6` type-scale CSS, and the type-role census that picked the four steps.
- [#629 codebase notes](../codebase/629.md) — the `ul`/`ol` indent, the blockquote's indent-plus-bar, and the nested block-rhythm CSS; the marker-overhang arithmetic that bounds the list indent.
- [Conversation shell § assistantText](conversation-shell.md) — the render arm this module is wired into, and the origin of the untrusted-text posture this module inherits (`ConversationScreen.tsx:492-499`).
- [#607 codebase notes](../codebase/607.md) — `.bubble--assistant-text`'s `white-space: pre-wrap`, now conditional on the in-progress tail rather than reaching the settled, markdown-rendered branch.
