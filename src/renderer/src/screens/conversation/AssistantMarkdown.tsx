import { Children, isValidElement, memo, useMemo, useRef, type ReactNode } from 'react'
import Markdown, {
  defaultUrlTransform,
  type AllowElement,
  type Components,
  type UrlTransform
} from 'react-markdown'
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
import { allowedLinkHref } from '@shared/externalLink'
import { parseHostedAppLink } from '@shared/hostedAppLink'
import type { Nodes, Root } from 'mdast'
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
//   • `remarkGfmSubset` registers the GFM TABLE, TASK LIST and
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
// setWindowOpenHandler that opens only `allowedLinkHref` links (src/shared/externalLink.ts, shared with
// the `a` override below), the same-document will-navigate guard (src/main/index.ts),
// and a CSP with no img-src so a remote subresource fails by policy (src/renderer/index.html).
//
// TimelineRow uses this same boundary for settled replies and progressive streaming units.
// Streaming presentation unwraps pending elements; frozen units use a memoized wrapper.
// Markdown owns block whitespace on both branches.

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
 *
 * #1630 EXPORTS IT for the markdown reader's Copy as plain text, which parses a note with exactly this
 * plugin so its text walk sees the same tree this module renders. The export adds a parser, not a
 * renderer: nothing that walk produces reaches a markup sink.
 */
export function remarkGfmSubset(this: Processor): undefined {
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

/** Parsed definition labels can contain escaped brackets, including literal `]:` text. */
function definitionDelimiter(raw: string): number {
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === '\\') i++
    else if (raw[i] === ']' && raw[i + 1] === ':') return i
  }
  return -1
}

/** Reject destinations made canonical only by Markdown entity/backslash normalization. */
function remarkHostedLinks() {
  return (tree: Root, file: { value: unknown }): void => {
    const source = String(file.value)
    const visit = (node: Nodes): void => {
      if ((node.type === 'link' || node.type === 'definition') && parseHostedAppLink(node.url)) {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset)
        const labelEnd = node.type === 'link' ? node.children[node.children.length - 1]?.position?.end.offset : undefined
        const start = node.type === 'definition' ? definitionDelimiter(raw)
          : raw.indexOf('](', labelEnd === undefined ? 0 : labelEnd - (node.position?.start.offset ?? 0))
        const destination = start < 0 ? raw : raw.slice(start + 2).trimStart()
        // The parser already validated the title. Check only the original destination token.
        const literal = new RegExp(`^(?:${node.url}|<${node.url}>)(?=\\s|\\)|$)`)
        if (raw !== `<${node.url}>` && !literal.test(destination)) node.url = ''
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}
// Stable list: the subset registers syntax; the second plugin only narrows existing destinations.
const remarkPlugins = [remarkGfmSubset, remarkHostedLinks]

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
 * The link allowlist is `allowedLinkHref` in src/shared/externalLink.ts, enforced HERE in the renderer,
 * at render time, before any anchor element exists, and by the main process's window-open handler with
 * the very same function. It does not lean on the main-process guard alone: a `javascript:` href
 * executes in the document rather than navigating it, so `will-navigate` would never see it.
 *
 * `urlTransform` lets through EXACTLY what that allowlist admits and hands every other value to
 * react-markdown's default, unchanged. The default blanks every scheme outside its own short list, which
 * includes `obsidian:`, so without this the override would only ever receive `href=""` for an Obsidian
 * link. The default stays a prior, independent narrowing for everything else, and the override below
 * remains the enforcement point. A module constant for a stable prop identity.
 */
const urlTransform: UrlTransform = (url) => parseHostedAppLink(url) ? url : allowedLinkHref(url) ?? defaultUrlTransform(url)

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
 * The #610 link rule, shared by both component tables below so the two cannot drift: an allowed link (a
 * web link, or an Obsidian `open` link since the allowlist moved to src/shared/externalLink.ts) is an
 * anchor, and everything else is its visible text.
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

/** Match the rendered label: formatting keeps its children and images render only their alt text. */
function hasLinkLabel(children: ReactNode): boolean {
  return Children.toArray(children).some(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child).trim() !== ''
    if (!isValidElement<{ children?: ReactNode; alt?: unknown }>(child)) return false
    return typeof child.props.alt === 'string'
      ? child.props.alt.trim() !== ''
      : hasLinkLabel(child.props.children)
  })
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
  // #610 opened the allowlist to http/https, later widened to Obsidian `open` links in the shared
  // `allowedLinkHref`, and THIS override is where it is enforced, not `urlTransform` above, which only
  // lets that same allowlist through and otherwise defers to react-markdown's default. Measured against the pinned react-markdown 10.1.0: the transform
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
export const AssistantMarkdown = memo(function AssistantMarkdown({ text, onOpenMarkdownPath, onOpenHostedApp, allowElement }: {
  text: string
  /** Streaming presentation can remove elements; all renderer security rules still apply. */
  allowElement?: AllowElement
  /** #1627: when passed, a link to a markdown path (see `markdownLinkPath`) renders as a button that
   *  calls this with the path. Absent — the reader, and every caller that predates it — such a link keeps
   *  its plain-text rendering and the module-constant table is used unchanged. */
  onOpenMarkdownPath?: (path: string) => void
  onOpenHostedApp?: (serverId: string, appId: string) => void
}): JSX.Element {
  const table = useMemo<Components>(() => {
    if (onOpenMarkdownPath === undefined && onOpenHostedApp === undefined) return components
    return {
      ...components,
      // THE PATH LIVES ONLY IN THE CLICK CLOSURE. No href, title, data-* or aria-* carries it, so the
      // markup shows it nowhere but the visible text the reply already had. A <button>, not an anchor:
      // it opens an in-app view and must never navigate. Bound by the never-spread rule like `a` above.
      a: ({ href, children }) => {
        const app = parseHostedAppLink(href)
        if (app && onOpenHostedApp) {
          if (!hasLinkLabel(children)) return <>{children}</>
          return <button type="button" className="markdown-link"
            onClick={() => onOpenHostedApp(app.serverId, app.appId)}>{children}</button>
        }
        const path = markdownLinkPath(href)
        if (path === null || onOpenMarkdownPath === undefined) return webLink(href, children)
        return (
          <button type="button" className="markdown-link" onClick={() => onOpenMarkdownPath(path)}>
            {children}
          </button>
        )
      }
    }
  }, [onOpenMarkdownPath, onOpenHostedApp])
  return (
    <Markdown components={table} remarkPlugins={remarkPlugins} urlTransform={urlTransform} allowElement={allowElement} unwrapDisallowed={allowElement !== undefined}>
      {text}
    </Markdown>
  )
})
