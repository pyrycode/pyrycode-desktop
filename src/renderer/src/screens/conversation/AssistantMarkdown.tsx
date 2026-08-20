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
// Ships dormant: nothing imports this outside its test file. #609 is the consumer and owns the
// container element, its class, the `white-space: pre-wrap` neutralisation inside it, and the
// React.memo decision (parsing runs on every render; the component is a pure function of `text`).

/**
 * Element overrides. Both are load-bearing — neither falls out of "raw HTML disabled", because a
 * conforming CommonMark renderer emits a real `<a href>` and a real `<img src>` from link and image
 * syntax whatever the HTML setting.
 *
 * NEVER spread `{...props}` into either of these. A spread puts `href` / `src` straight back and
 * regresses both rules silently: the visible text still renders, so a carelessly-written test keeps
 * passing. Each override renders its one value and nothing else.
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
  img: ({ alt }) => <>{alt ?? ''}</>
}

/**
 * Renders assistant markdown source as React elements. A pure function of `text`: no state, no
 * effects, no store access, and no wrapper element of its own — react-markdown v10 emits block
 * elements directly, so the container belongs to the call site.
 *
 * `code` is deliberately NOT overridden. Stripping its `language-*` class looks like hardening but
 * would delete the language label Figma 16:47 specifies for the code-block header bar, forcing the
 * consumer to re-parse the source. The value is React-escaped (inert) and the mandatory `language-`
 * prefix makes collision with an app CSS class structurally impossible.
 */
export function AssistantMarkdown({ text }: { text: string }): JSX.Element {
  return <Markdown components={components}>{text}</Markdown>
}
