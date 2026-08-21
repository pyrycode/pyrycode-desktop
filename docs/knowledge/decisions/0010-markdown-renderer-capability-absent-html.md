# 0010 — Assistant markdown rendering: a React-element renderer with raw HTML capability-absent, not merely disabled

## Status

Accepted, 2026-08-20. First realized in [#608](../codebase/608.md), shipped dormant; wired into the thread by [#609](../codebase/609.md); fenced-code language label consumed by [#623](../codebase/623.md). The deny-first link posture this ADR originally shipped was narrowed to an `http:`/`https:` allowlist by [#610](../codebase/610.md) — see the Rationale note below, corrected in that ticket's documentation pass.

## Context

Assistant replies reach the screen as plain text (`ConversationScreen.tsx:499`, `.bubble--assistant-text`, `white-space: pre-wrap` since [#607](../codebase/607.md)) — markdown syntax in a daemon reply renders as literal characters. The operator decided on 2026-08-20 that daemon-supplied text may render as *content*: the client-owned-constant discipline that governs the app's own chrome strings does not apply to message bodies, so the question is markup handling, not provenance.

Rendering untrusted markdown safely in an Electron renderer has two layers. The **process-level** layer was already closed before this ticket: `sandbox: true` + `contextIsolation: true`, a `setWindowOpenHandler` that allows only `http:`/`https:` and routes to `shell.openExternal`, a same-document `will-navigate` guard, and a CSP with no `img-src` (`default-src 'self'` blocks a remote image fetch by policy). None of that is rebuilt or weakened here. What was open is the **renderer-level** question this ADR settles: given markdown source, what elements does it become, and can any of them reach an HTML sink, a click target, or a network fetch?

Three React-element-emitting candidates were evaluated (the HTML-string family — `marked`, `markdown-it`, `snarkdown` — is ruled out structurally: consuming a string output requires `dangerouslySetInnerHTML`, which is a hard "no" in this repo):

| Candidate | Packages added | Raw-HTML posture |
|---|---|---|
| `react-markdown@10` | 85 per the architecture spec's install-time count (**79 net-new** by the honest `comm -23` set-difference measure code review used — see note below) | No HTML parser exists in the dependency graph at all. Enabling it means adding `rehype-raw` to `package.json`. |
| `markdown-to-jsx@9` | 1, zero deps | HTML parser present and **on by default**; suppressed only by setting `disableParsingRawHTML: true`. |
| `marked-react@4` | 4 | `marked` lexer behind a thin React bridge. |

## Decision

`react-markdown@10.1.0`, configured with no `rehypePlugins` and no `remarkPlugins`, `skipHtml` left at its default (unset), and explicit element overrides on `a` (renders `children` only) and `img` (renders `alt` only) that never spread `{...props}`. `code` keeps its `className` (`language-*`) uncovered — see § Consequences.

The whole configuration lives in one file, `AssistantMarkdown.tsx`, which is the entire security boundary for this path.

## Rationale

**Capability-absent beats capability-disabled.** `markdown-to-jsx`'s HTML parsing is its headline feature, live by default; the safety here is one boolean (`disableParsingRawHTML: true`), and a future edit that drops it — or a version bump that changes the default — silently re-enables real HTML element construction from daemon text. With `react-markdown`, the equivalent regression requires *adding a package* to `package.json`: a visible, reviewable act, not a configuration typo. This is the deciding factor, weighed explicitly against `markdown-to-jsx`'s far smaller dependency footprint in a repo with **no automated supply-chain gate** (`check:electron-digest` is [#101](../codebase/101.md)'s BLAKE2s/BoringSSL parity check and vets nothing about dependencies).

Two secondary points reinforced the choice: `markdown-to-jsx` auto-slugs headings into `id` attributes, putting untrusted text in an attribute position where this repo's posture keeps daemon text in JSX *text* children only (React escapes the value, so it's inert, but it's a second precedent this repo doesn't otherwise have); and its root element shape is unstable (bare text, `<span>`, or `<div>` depending on source), a downstream cost for whatever container #609 wraps it in.

**The `skipHtml` trap.** `skipHtml: true` reads as the safer option and is not: verified against `Before <script>alert(1)</script> and <b>bold</b> after`, it *deletes* the tags and promotes their text content into the message (`Before alert(1) and bold after`). The default *escapes* instead (`Before &lt;script&gt;alert(1)&lt;/script&gt; and &lt;b&gt;bold&lt;/b&gt; after`), which is the only one of the two that matches the bubble's pre-existing posture at `ConversationScreen.tsx:493` ("HTML inside a delta renders as visible characters") — and the only one that preserves an `&lt;`/`&amp;` discriminator a test can assert against to prove "escaped" rather than "silently absent."

**Links and images are suppressed at the element level, not the policy level.** `components.a` renders only `children`; `components.img` renders only `alt`. Neither override spreads `{...props}` — a spread reintroduces `href`/`src` and defeats the suppression while every visible-text assertion keeps passing, which is why this repo's convention forbids the spread by construction rather than by test coverage alone. This lands the repo in a state where no anchor and no image element is ever constructed from daemon markdown, so no unvetted `href` reaches the DOM regardless of scheme — including `javascript:`, which executes in the document rather than navigating it and so would never be caught by `will-navigate`. `react-markdown`'s built-in `urlTransform` (which already blanks a `javascript:` href) is not relied on for this — no anchor is produced at all.

**Correction, [#610](../codebase/610.md), 2026-08-21.** This paragraph originally predicted that opening the `http:`/`https:` allowlist would "re-enable `urlTransform`." Measured against the pinned `react-markdown@10.1.0` at implementation time, that plan doesn't hold: `urlTransform` *blanks* a denied href rather than removing the anchor, so relying on it alone for the denied set would emit `<a href="">` for `javascript:`, `data:`, `file:`, a custom scheme and an empty href — an anchor, a click target, and the literal string `href`, all three the deny criterion forbids (`mailto:` and a relative href arrive at the override *unblanked* by the transform, which is worse). #610 instead added a module-local, fail-closed predicate, `allowedLinkHref`, as the enforcement point inside the `a` override itself — parsing with no base argument (rejecting relative/protocol-relative hrefs without resolving them, so a dev and packaged build agree), requiring an `http:`/`https:` protocol, and separately requiring the raw string to carry an authority (closing `http:example.com`, which parses absolutely but would base-resolve to a different host in the two builds). `urlTransform` stays at its default, unconfigured, running as a prior narrowing this design does not depend on. See [#610 codebase notes](../codebase/610.md) for the full predicate and the `target="_blank"` mechanism that routes an allowed click to `setWindowOpenHandler`.

**`code`'s `language-*` class is kept, deliberately.** Stripping it looks like hardening but isn't load-bearing: the value is React-escaped as an attribute (inert) and the mandatory `language-` prefix makes collision with an app CSS class structurally impossible. It is also the only carrier for the fenced-code language label Figma `16:47` specifies — stripping it would have deleted the data [#623](../codebase/623.md)'s `fenceLanguage` helper reads and forced it to re-parse the source text.

## Consequences

- Interpreting HTML on this path now requires a `package.json` diff (adding `rehype-raw`), not a boolean flip — the structural property this decision is built on. Any future PR adding `rehype-raw` anywhere near this file should be treated as a security-relevant change requiring the same review depth as this ADR.
- 79 net-new packages entered the tree (see note below on the two competing counts), with no automated gate vetting them — the standing cost of this choice, accepted because the safety property purchased is structural rather than configurational. Overwhelmingly the `micromark-*`/`mdast-util-*`/`hast-util-*` toolchain from one maintainer (wooorm), MIT-licensed.
- `<a>` and `<img>` overrides are the two places a future edit could quietly regress the deny set by adding `{...props}`; this is called out in a code comment in `AssistantMarkdown.tsx` itself, not just here. Since [#610](../codebase/610.md), `<a>` is no longer deny-everything — it renders a real anchor for an allowed `http:`/`https:` href — but the no-spread rule and the fail-closed default (anything `allowedLinkHref` doesn't recognize still renders as visible text only) both carry forward unchanged.
- `code`'s `className` is intentionally left un-hardened; a future "cleanup" that strips it needs to know it is Figma `16:47`'s label carrier, not incidental output — [#623](../codebase/623.md) is the ticket that reads it, via a token-scan of the class rather than a re-parse of the message source.
- `remark-gfm` must never be added "for completeness" — its bare-URL autolinking would manufacture exactly the anchors this design suppresses.

**Note on the two dependency counts.** The architecture spec's design table states "85 packages added," verified at spec time against an install. [#608](../codebase/608.md)'s code review re-measured with an honest `comm -23` set difference between the pre- and post-change lockfile package lists and found **79 net-new** packages — `npm install`'s own summary line ("added 256") was junk in that worktree (an empty `node_modules` directory was present and mis-reported as populated), and a naive `grep -c '^+.*node_modules/'` over the lockfile diff over-counted at 89 because npm re-sorts entries, so roughly 10 packages appear as both a `-` and a `+` line for the same version. 79 is the number that should be cited going forward; 85 was a reasonable estimate at spec time that a more careful measure later corrected downward.

## Related

- [#608 codebase notes](../codebase/608.md) — the implementation, the full verified construct-coverage table, and the code-review record.
- [#623 codebase notes](../codebase/623.md) — the fenced-code header bar and language label, the module's first consumer of `code`'s kept `className`.
- [#610 codebase notes](../codebase/610.md) — the `http:`/`https:` link allowlist that narrows this ADR's original deny-first link posture; see the Rationale correction above.
- [Assistant markdown renderer](../features/assistant-markdown-renderer.md) — the feature doc for the module this ADR governs.
- [ADR 0003](0003-m3-theme-tokens-css-custom-properties.md) — unrelated in mechanism, same repo discipline of "the configuration is the contract."
- `src/main/index.ts` — the process-level guards this decision explicitly does not rebuild or weaken: `setWindowOpenHandler`, `will-navigate`, sandbox/context-isolation.
- `src/renderer/index.html` — the CSP this decision leaves untouched (no `img-src`, `default-src 'self'`).
