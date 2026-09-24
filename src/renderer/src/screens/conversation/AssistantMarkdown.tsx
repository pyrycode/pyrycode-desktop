import { Children, isValidElement, useMemo, useRef, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item'
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough'
// TYPE-ONLY, both erased at build, and both declared in package.json rather than reached for
// transitively — see `remarkGfmSubset` below, where the reason is the whole of why this import pair
// exists in this shape.
import type {} from 'remark-parse'
import type { Processor } from 'unified'
import { MAX_WORKSPACE_FILE_PATH_LENGTH } from '@shared/ipc/workspaceFileRead'
import { copyMessageText } from './copyMessageText'

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
//   • ONE `remarkPlugin`, `remarkGfmSubset` below, and it registers the GFM TABLE, TASK LIST and
//     STRIKETHROUGH constructs and nothing else. `remark-gfm` itself is still never added: it is a
//     BUNDLE of five unrelated extensions, and the two that matter here — autolink literals and
//     footnotes — are separate packages that are NOT INSTALLED. So bare URLs and bare email addresses
//     still render as plain text because there is no autolinking code in the dependency graph to
//     suppress, not because a setting turns it off. Absence, not suppression: the same property as the
//     `rehypePlugins` line above, arrived at the same way, and the reason the subset ships as
//     per-construct packages rather than the bundle plus an override. THE COUNT IN THIS SENTENCE IS
//     PART OF THE CONTRACT — a fourth construct here is a change to what this module can parse out of
//     untrusted daemon text.
//   • No source-authored form controls: task-list inputs become inert spans. CodeBlock adds only
//     a client-owned, non-submitting Copy code button; its label and behavior are fixed here.
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

/**
 * #1079 / #1080 — registers the GFM table, task-list and strikethrough constructs on the processor, and
 * nothing else. THIS FUNCTION BODY IS THE LIST; the `remarkPlugins` array below is not (see its own
 * docstring). Autolink literals and footnotes are the two bundle members deliberately still absent.
 *
 * ALL SIX IMPORTS ARE FUNCTIONS AND EVERY ONE MUST BE CALLED. Passing one called and another uncalled
 * fails SILENTLY rather than throwing — a function where an extension object is expected is accepted,
 * the source markers are eaten, and the text loses its syntax while gaining no element. If any of the
 * three ever renders as neither its element nor its visible source characters — a table as neither a
 * table nor pipes, a task item as neither a mark nor brackets, struck text as neither `<del>` nor
 * tildes — this is the line to read first.
 *
 * `gfmStrikethrough()` takes its `singleTilde` default (on), so `~struck~` strikes as well as
 * `~~struck~~`. Left there on purpose: the obvious hazard is a pair of home-relative paths on one line,
 * and it does not reproduce, because GFM requires the closing marker to be right-flanking and a path's
 * tilde can only ever open. AssistantMarkdown.test.tsx pins that non-reproduction, so the day it turns
 * red is the day to reconsider the option — rather than disabling it now against no observed failure.
 *
 * WHY `this` IS TYPED THIS WAY, and why two type-only packages are declared for it. `tsconfig.web.json`
 * is `strict`, so `noImplicitThis` rejects a bare `function` whose body calls `this.data()`. Two routes
 * were measured against this tree and BOTH FAIL, so neither is worth rediscovering:
 *
 *   • `Processor` alone is not enough. `unified`'s own `Data` declares neither extension array —
 *     `remark-parse` contributes both by module augmentation, and react-markdown's types import from
 *     `unified` directly, so that augmentation never enters the program. Four TS2339s.
 *   • A local structural `this` type fails CONTRAVARIANTLY. `Plugin`'s `this` is `Processor`, so
 *     assignability runs the other way: `Processor` must satisfy the local type, and with `Data`
 *     unaugmented the two share no properties at all — weak-type detection, TS2322.
 *
 * Hence the augmentation is imported from the package that OWNS it. The payoff is not merely that it
 * compiles: `micromarkExtensions` is then typed `MicromarkExtension[]` and `gfmTable()` returns exactly
 * that, so both pushes are type-CHECKED rather than asserted, and this file keeps its no-cast posture.
 * Declaring the two packages is the point rather than bookkeeping — a type import satisfied only by a
 * transitively hoisted package is what breaks on a differently resolved `npm ci`.
 *
 * NOT DONE: declaring the `unified.Data` augmentation here ourselves. It would work today only because
 * `remark-parse`'s types happen to be absent from the program, and would become a hard duplicate-property
 * error the moment anything pulls them in. A latent trap traded for one fewer package.json line.
 */
function remarkGfmSubset(this: Processor): undefined {
  const data = this.data()
  const micromarkExtensions = data.micromarkExtensions ?? (data.micromarkExtensions = [])
  const fromMarkdownExtensions = data.fromMarkdownExtensions ?? (data.fromMarkdownExtensions = [])
  micromarkExtensions.push(gfmTable(), gfmTaskListItem(), gfmStrikethrough())
  fromMarkdownExtensions.push(
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    gfmStrikethroughFromMarkdown()
  )
  return undefined
}

/**
 * The plugin list, a module constant rather than an inline array literal at the call site: a fresh array
 * on every render would give react-markdown a new prop identity each time for no gain.
 *
 * ITS LENGTH IS NO LONGER THE CONSTRUCT COUNT, and #1080 is why this docstring says so. It read "one
 * entry, one construct" while that happened to hold; adding two constructs inside `remarkGfmSubset`
 * left the array at length 1, so the claim went quietly wrong with nothing to redden. What this array
 * actually guards is narrower and still worth guarding: THIS MODULE PASSES EXACTLY ONE PLUGIN, and that
 * plugin is defined directly above, in this file, where its whole extension list can be read at once.
 * A second entry here would put part of the parse configuration somewhere else — including anywhere a
 * dependency's default export could reach — which is the change the header's contract is about. The
 * construct count lives in `remarkGfmSubset`'s body and in the header's own sentence, both of which
 * name all three; keep the three statements in step.
 */
const remarkPlugins = [remarkGfmSubset]

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
 * An absolute http/https URL, authority and all. Anchored, with no quantified group to backtrack on, so
 * it carries no ReDoS exposure on an unbounded daemon-supplied href.
 */
const ABSOLUTE_WEB_URL = /^https?:\/\//i

/**
 * The href VERBATIM when it is an absolute http/https URL carrying an authority; null otherwise.
 *
 * This is #610's whole allowlist, and it is enforced HERE — in the renderer, at render time, before any
 * anchor element exists. It deliberately does not lean on the main-process guards: a `javascript:` href
 * executes in the document rather than navigating it, so `will-navigate` (src/main/index.ts:79) would
 * never see it. It narrows to match `setWindowOpenHandler` (:56) rather than the other way round —
 * `mailto:` is permitted by react-markdown's built-in `urlTransform` but denied by that handler, and a
 * link that renders live and then silently does nothing is worse than one that renders as text.
 *
 * It FAILS CLOSED, like `fenceLanguage` above: every shape that is not an allowed link returns null and
 * renders as the link's visible text — a complete UI state, not a degraded one. There is no error path.
 * Nothing is logged on the null path either: the value is untrusted daemon text and the repo's
 * diagnostics are content-free (#126).
 *
 * The RETURN IS THE ORIGINAL STRING, never `url.href`. The parser normalises — it adds a trailing slash
 * to `https://example.com` and punycodes/percent-encodes a non-ASCII authority — and the criterion is
 * that an allowed link carries its href unchanged. The parse decides; the original renders.
 */
function allowedLinkHref(href: string | undefined): string | null {
  // react-markdown types the prop as optional, so this is the shape check, not a scheme decision.
  if (href === undefined) return null
  let url: URL
  try {
    // NO BASE ARGUMENT, and that is the reject-without-resolving rule rather than an omission: every
    // relative, protocol-relative, empty and unparseable href throws right here. Resolving instead would
    // make the same reply behave differently in the two builds — under the dev server the document base
    // is http:, so `./doc.md` would resolve to a web scheme and be ALLOWED, while a packaged build's
    // file: base would deny the identical href.
    url = new URL(href)
  } catch {
    return null
  }
  // THE ALLOWLIST — the one line to read when asking which schemes ship. `protocol` is lowercased by the
  // parser, so `HTTPS://…` matches by construction and a toLowerCase() here would be noise.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // THE BASE-INDEPENDENCE GUARD, not a second scheme check, and deliberately not fused with the test
  // above even though it implies it today: `http:example.com` is a scheme with NO AUTHORITY, so it parses
  // absolutely and passes the allowlist, but the browser still resolves it against the document base when
  // the click navigates — to the dev server unpackaged, to the real host when packaged. Requiring the
  // authority is also what keeps this check and the main process's independent one (index.ts:56, which
  // re-derives the scheme from the URL it is handed) in agreement: with it, the string checked here and
  // the string that process receives are the same URL. Fusing the two conditions would mean a later
  // widening of the allowlist silently dropped that.
  if (!ABSOLUTE_WEB_URL.test(href)) return null
  return href
}

/** A trailing `:line` or `:line:column` suffix. Anchored, digits only: nothing to backtrack on. */
const LINE_SUFFIX = /:\d+(?::\d+)?$/
/** A leading URL scheme, per RFC 3986's `scheme ":"`. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i

/**
 * #1627 — the workspace path a link names when it points at a markdown file, or null for every other
 * link. A markdown path has no URL scheme and, once a `#fragment` and then a trailing `:line` /
 * `:line:column` are removed, ends in `.md` or `.markdown` in any case. The result is that remainder with
 * its percent-escapes decoded ONCE, because micromark percent-encodes a destination (`<My Plan.md>`
 * arrives as `My%20Plan.md`).
 *
 * The scheme test runs AFTER the suffix is removed, so `Plan.md:12` is a line reference rather than the
 * scheme `plan.md:`. It FAILS CLOSED like `allowedLinkHref`: an escape that does not decode, or a path the
 * main-side `isWorkspaceFileReadRequest` would silently drop for length (leaving the reader loading
 * forever), is not a markdown path and keeps today's plain-text rendering.
 *
 * The path is UNTRUSTED and goes to the daemon unchanged, which does all confinement. Nothing here
 * resolves it, checks it against a local folder or logs it.
 */
export function markdownLinkPath(href: string | undefined): string | null {
  if (href === undefined) return null
  const hash = href.indexOf('#')
  const target = (hash === -1 ? href : href.slice(0, hash)).replace(LINE_SUFFIX, '')
  if (URL_SCHEME.test(target) || !MARKDOWN_EXTENSION.test(target)) return null
  let path: string
  try {
    path = decodeURIComponent(target)
  } catch {
    return null
  }
  return path.length > MAX_WORKSPACE_FILE_PATH_LENGTH ? null : path
}

/**
 * The #610 link rule, shared by both component tables below so the two cannot drift: an allowed web link
 * is an anchor, and everything else is its visible text.
 *
 * `target="_blank"` IS THE CLICK MECHANISM, not decoration. It is what makes the click a window-open
 * request, which setWindowOpenHandler (src/main/index.ts) answers by handing the URL to
 * shell.openExternal and denying the in-app window on every path. A plain anchor would instead be a
 * same-document navigation, which will-navigate cancels — so the link would look correct and do
 * NOTHING. `rel="noreferrer"` makes the anchor correct in isolation rather than correct-only-because-
 * another-process guards it.
 */
function webLink(href: string | undefined, children: ReactNode): JSX.Element {
  const allowed = allowedLinkHref(href)
  if (allowed === null) return <>{children}</>
  return (
    <a href={allowed} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

/**
 * Element overrides. The link, image and input rules are load-bearing — none of the three falls out of
 * "raw HTML disabled", because a conforming renderer emits a real `<a href>`, a real `<img src>` and
 * (with the task-list extension registered above) a real `<input type="checkbox">` from ordinary
 * markdown syntax whatever the HTML setting. The `pre` rule is #623's block chrome.
 *
 * NEVER spread `{...props}` into any of these. A spread puts `href` / `src` straight back and
 * regresses both rules silently: the visible text still renders, so a carelessly-written test keeps
 * passing. Each override renders its own values and nothing else.
 */
const components: Components = {
  // #610 opened the allowlist to exactly http/https, and THIS override is where it is enforced — not
  // react-markdown's built-in `urlTransform`, which stays at its default and is a prior, independent
  // narrowing nothing here depends on. Measured against the pinned react-markdown 10.1.0: the transform
  // BLANKS a denied href, it does not remove the anchor, so relying on it emits `<a href="">` for the
  // javascript:, data:, file:, custom-scheme and empty cases — an anchor, a click target and the literal
  // string `href`, all three of which the deny criterion forbids. Only an override can render no element
  // at all, and a denied href renders exactly what every href used to: the visible link text.
  //
  // Bound by the never-spread rule above: `href` and `children` are destructured and nothing else is
  // passed through, so `title` and every other attribute react-markdown supplies is dropped. The anchor
  // itself and its click mechanism are `webLink`'s.
  a: ({ href, children }) => webLink(href, children),
  // #1080 — the task-list mark, and THE ANSWER TO "should a reply contain a checkbox": no. The task-list
  // extension's hast handler emits `<input type="checkbox" disabled>` into the item's first paragraph;
  // this renders an inert <span> in its place, so no source-authored checkbox exists. A
  // `disabled` checkbox would already have satisfied "not interactive" — it takes no click, no focus and
  // no keyboard toggle — but it READS as a control the reader could tick, and a reply is a transcript.
  // Removing the element is also what leaves nothing to keep correct later: no disabled attribute a
  // future edit could drop, no form association, and no precedent for the next construct that wants one.
  //
  // THE SOURCE'S ENTIRE INFLUENCE HERE IS ONE BOOLEAN. `checked` is set by the handler behind its own
  // `typeof node.checked === 'boolean'` gate, and it SELECTS between client-owned constants — no daemon
  // substring is interpolated into the class or the label. That is the operator ruling's line (daemon
  // text may be rendered; it may not reach an attribute), and the reason this override does not label a
  // mark with the item's own text. `=== true` rather than a truthy test, so a later reader gets no
  // impression that a string or a number could arrive here.
  //
  // `role="img"` with a label, and NOT visually-hidden text: both put the state in the accessibility
  // tree, but an aria-label contributes nothing to textContent, while a text node inside .bubble is
  // something every whole-bubble text assertion in e2e/ would then have to admit. The drawn mark is a
  // CSS pseudo-element for the same reason (conversation.css, `.bubble__markdown .task-mark`).
  //
  // Bound by the never-spread rule above: only `checked` is destructured, so `type`, `disabled` and
  // everything else react-markdown supplies is dropped. The override is TOTAL — with no HTML parser in
  // the graph, that handler is the only thing that can produce an `input` node.
  input: ({ checked }) => (
    <span
      className={checked === true ? 'task-mark task-mark--checked' : 'task-mark'}
      role="img"
      aria-label={checked === true ? 'Done' : 'Not done'}
    />
  ),
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
  pre: CodeBlock
}

function CodeBlock({ children }: { children?: ReactNode }): JSX.Element {
  const body = useRef<HTMLPreElement>(null)
  const language = fenceLanguage(children)

  const copy = async (): Promise<void> => {
    // textContent preserves literal characters and trailing newlines; chrome stays outside the pre.
    const text = body.current?.querySelector('code')?.textContent
    if (text == null) {
      window.pyry.sendDiagnostic({ event: 'code-block-copy', code: 'missing-code' })
      return
    }
    const copied = await copyMessageText(text)
    window.pyry.sendDiagnostic({ event: 'code-block-copy', code: copied ? 'copied' : 'failed' })
  }

  return (
    <div className="code-block code-block--copyable">
      {language !== null && <div className="code-block__header">{language}</div>}
      <pre ref={body} className="code-block__body">{children}</pre>
      <button
        type="button"
        className="code-block__copy"
        aria-label="Copy code"
        onClick={() => void copy()}
      >
        {/* Exact copy glyph used by BubbleMeta; the button supplies its accessible name. */}
        <svg
          className="code-block__copy-icon"
          viewBox="0 0 11 12"
          width="11"
          height="12"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4.71429 0C3.84754 0 3.14286 0.672656 3.14286 1.5V7.5C3.14286 8.32734 3.84754 9 4.71429 9H9.42857C10.2953 9 11 8.32734 11 7.5V2.79844C11 2.39062 10.8257 1.99922 10.5163 1.71562L9.09955 0.417188C8.80737 0.15 8.41696 0 8.01183 0H4.71429ZM1.57143 3C0.704688 3 0 3.67266 0 4.5V10.5C0 11.3273 0.704688 12 1.57143 12H6.28571C7.15246 12 7.85714 11.3273 7.85714 10.5V10.125H6.28571V10.5H1.57143V4.5H1.96429V3H1.57143Z" />
        </svg>
      </button>
    </div>
  )
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
export function AssistantMarkdown({ text, onOpenMarkdownPath }: {
  text: string
  /** #1627: when passed, a link to a markdown path (see `markdownLinkPath`) renders as a button that
   *  calls this with the path. Absent — the reader, and every caller that predates it — such a link keeps
   *  its plain-text rendering and the module-constant table is used unchanged. */
  onOpenMarkdownPath?: (path: string) => void
}): JSX.Element {
  const table = useMemo<Components>(() => {
    if (onOpenMarkdownPath === undefined) return components
    return {
      ...components,
      // THE PATH LIVES ONLY IN THE CLICK CLOSURE. No href, title, data-* or aria-* carries it, so the
      // markup shows it nowhere but the visible text the reply already had. A <button>, not an anchor:
      // it opens an in-app view and must never navigate. Bound by the never-spread rule like `a` above.
      a: ({ href, children }) => {
        const path = markdownLinkPath(href)
        if (path === null) return webLink(href, children)
        return (
          <button type="button" className="markdown-link" onClick={() => onOpenMarkdownPath(path)}>
            {children}
          </button>
        )
      }
    }
  }, [onOpenMarkdownPath])
  return (
    <Markdown components={table} remarkPlugins={remarkPlugins}>
      {text}
    </Markdown>
  )
}
