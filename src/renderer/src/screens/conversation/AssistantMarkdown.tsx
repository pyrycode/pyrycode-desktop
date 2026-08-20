import { Children, isValidElement, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'

// #608: assistant-reply markdown → React elements. Daemon-supplied text may render as content
// (operator decision, 2026-08-20), so the question here is markup handling, not provenance.
//
// This file is the ENTIRE security boundary for markdown rendering, and the configuration below is
// the contract, not incidental detail — any change to it is a security change:
//
//   • No `rehypePlugins`. `rehype-raw` is the only way to make this path interpret HTML, so enabling
//     it would mean ADDING A PACKAGE to package.json — a visible, reviewable act — rather than
//     flipping a boolean. Capability-absent, not capability-disabled; that property is why
//     react-markdown was chosen over the far smaller markdown-to-jsx, whose HTML parser ships on.
//   • No `remarkPlugins`. CommonMark covers every construct the ticket lists, and `remark-gfm` would
//     manufacture anchors from bare URLs — exactly what the link rule below exists to prevent.
//   • No `skipHtml`. It reads like the safe option and is not: it DELETES tags and promotes their
//     text content into the message (`<b>bold</b>` → `bold`). The default escapes instead, which
//     matches the bubble's existing posture at ConversationScreen.tsx:493 ("HTML inside a delta
//     renders as visible characters") and is the only behaviour that preserves the &lt; / &amp;
//     discriminator the tests use to tell "escaped" from "absent".
//
// The transport-side posture is unchanged and is not rebuilt here: sandbox + contextIsolation, the
// http/https-only setWindowOpenHandler, the same-document will-navigate guard (src/main/index.ts),
// and a CSP with no img-src so a remote subresource fails by policy (src/renderer/index.html).
//
// #609 wired this in and settled what it owns: ConversationScreen.tsx:522 renders it inside a
// `.bubble__markdown` container for a SETTLED reply only. It chose a CONDITIONAL bubble--assistant-text
// over neutralising `white-space: pre-wrap` inside that container — markdown owns the whitespace by
// ABSENCE of the declaration — and it DECLINED React.memo, with the reason stated at that call site
// (parsing does re-run on every timeline render; nothing in this test tier can observe a skipped one).
// #623 then added the `pre` override below: a fenced block's header bar and border (Figma 16:45).

const LANGUAGE_PREFIX = 'language-'

/**
 * A fence may declare an arbitrarily long info string, and an unbounded label under `white-space:
 * nowrap` is precisely the shape that pushes a box past its measure. 20 clears every real fence
 * language with room (`restructuredtext` is 16, `objective-c++` 13, `typescript` 10).
 *
 * The residual — 20 characters still exceeding the block in a narrow window — is covered by
 * `.code-block__header`'s ellipsis, which is a DIFFERENT fabric rather than a repeat: this bound is
 * what the server-render tier can see, that one is geometric and reaches cases this cannot.
 */
const MAX_LANGUAGE_CHARS = 20

/**
 * The fence's language, bounded for display, or null when there is none to show.
 *
 * Reads the `language-*` class react-markdown puts on the `<code>` child rather than re-parsing the
 * message source; the docstring below is where that class is deliberately left unstripped, for this.
 *
 * It FAILS CLOSED: every shape that is not "a `<code>` carrying a `language-…` class" returns null,
 * which renders exactly what a fence with no info string renders (the block, no header). There is no
 * third branch and no error path. That degrade also covers a construct the mock does not draw: an
 * INDENTED code block (four spaces, no fence) reaches this same override carrying no class at all, and
 * "no header" is the right answer for a block that never declared a language.
 *
 * Nothing is logged on the null path. The value that would be logged is untrusted daemon text, the
 * repo's diagnostics are content-free (#126), and markdown with no language is not a fault.
 */
function fenceLanguage(children: ReactNode): string | null {
  // toArray is TOTAL over both shapes react-markdown may hand a single child (the element itself, or a
  // one-element array); indexing `children` directly or Children.only each handles only one of them.
  // The array it builds is read here only — the children that get RENDERED are the originals.
  const first = Children.toArray(children)[0]
  // The type argument is an UNCHECKED claim about react-markdown's output, so the runtime typeof test
  // is what actually keeps a non-string out of the render. `unknown` rather than `string` is
  // deliberate: it denies the compiler any grounds for letting that guard be dropped later.
  if (!isValidElement<{ className?: unknown }>(first)) return null
  const { className } = first.props
  if (typeof className !== 'string') return null
  // A token scan, not /^language-(.+)$/ over the whole value: a second class on the element would
  // silently kill the label under a whole-string match. A plain whitespace split also leaves an
  // adversarial info string nothing to backtrack on — do not "simplify" this into a pattern match.
  const token = className.split(/\s+/).find((name) => name.startsWith(LANGUAGE_PREFIX))
  if (token === undefined) return null
  const language = token.slice(LANGUAGE_PREFIX.length)
  return language === '' ? null : language.slice(0, MAX_LANGUAGE_CHARS)
}

/**
 * Element overrides. The link and image rules are load-bearing — neither falls out of "raw HTML
 * disabled", because a conforming CommonMark renderer emits a real `<a href>` and a real `<img src>`
 * from link and image syntax whatever the HTML setting. The `pre` rule is #623's block chrome.
 *
 * NEVER spread `{...props}` into any of these. A spread puts `href` / `src` straight back and
 * regresses both rules silently: the visible text still renders, so a carelessly-written test keeps
 * passing. Each override renders its own values and nothing else.
 */
const components: Components = {
  // Links are deny-first in this slice: the visible link text, no anchor element, for every href
  // including http/https ones. So no URL reaches the DOM by any path, and no click target reaches
  // the main-process guards. #610 opens the http/https allowlist; react-markdown's built-in
  // `urlTransform` (which already blanks a javascript: href) is the mechanism it re-enables — this
  // module deliberately does not rely on it, since a javascript: URL executes in the document rather
  // than navigating it and would never be seen by will-navigate.
  a: ({ children }) => <>{children}</>,
  // Image syntax must produce no element that fetches a remote resource. The CSP's absent img-src is
  // the independent second layer (deterministic policy, different fabric), but the rule here is that
  // no fetching element is CREATED — not merely that the fetch fails. Alt text renders in its place.
  img: ({ alt }) => <>{alt ?? ''}</>,
  // A fenced block's chrome (Figma 16:45): a bordered, rounded surface holding an optional header bar
  // naming the language above the code body. `pre` and NOT `code`: react-markdown routes INLINE code
  // through `code` as well, and a fence with no info string is indistinguishable from inline code by
  // className alone — which is exactly the no-header case below. Inline code's treatment is #624's.
  //
  // Bound by the rule above: `children` is destructured and nothing is spread, so the `<code>` child
  // (its `language-*` class and all) passes through verbatim and every other attribute is dropped.
  pre: ({ children }) => {
    const language = fenceLanguage(children)
    return (
      <div className="code-block">
        {/* `!== null`, not a bare && on the string: the guard names the one falsy value the helper can
            return, so an empty-string language can never render an empty header bar — the shape the
            no-language criterion forbids. The label is a React TEXT child, interpolated into no
            className, id, data-* or style; React escapes it, and that is the whole inertness argument
            (the same one ConversationScreen.tsx:499-503 makes for the in-progress tail). */}
        {language !== null && <div className="code-block__header">{language}</div>}
        <pre className="code-block__body">{children}</pre>
      </div>
    )
  }
}

/**
 * Renders assistant markdown source as React elements. A pure function of `text`: no state, no
 * effects, no store access, and no wrapper element of its own — react-markdown v10 emits block
 * elements directly, so the container belongs to the call site.
 *
 * `code` is deliberately NOT overridden. Stripping its `language-*` class looks like hardening but
 * would delete the language label Figma 16:47 specifies for the code-block header bar, forcing
 * `fenceLanguage` above to re-parse the message source. The value is React-escaped (inert) and the
 * mandatory `language-` prefix makes collision with an app CSS class structurally impossible —
 * CommonMark ends the language token at the first whitespace character and CSS class separators ARE
 * whitespace, so a fence can never contribute more than that one token.
 */
export function AssistantMarkdown({ text }: { text: string }): JSX.Element {
  return <Markdown components={components}>{text}</Markdown>
}
