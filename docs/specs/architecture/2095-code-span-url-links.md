# Whole inline-code URL links

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and owning topic.
- `docs/knowledge/features/assistant-markdown-renderer.md`: `components.a`, `webLink`, pending source positions and the unoverridden `code` contract.
- `docs/knowledge/features/development-verification.md` and `development-verification-what-each-test-tier-proves.md`: static markup establishes structure, not activation.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx`: `remarkHostedLinks`, `remarkPlugins`, `webLink`, both component tables; the only production file to change.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx`: `render`, `count`; existing allowlist and escaped-markup assertions.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.tsx`: `pendingMarkdown` removes synthetic anchors/code by source range.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.test.tsx`: pending/settled and parser-prefix regressions.
- `src/renderer/src/screens/conversation/hostedAppLinks.test.tsx`: hosted navigation stays opt-in and separate from external links.
- `src/shared/externalLink.ts`: `allowedLinkHref` returns the admitted original URL; read-only Obsidian note restrictions.
- `src/main/windowOpenHandler.ts`: `createWindowOpenHandler` independently validates external targets and denies in-app windows.
- `package.json`, `vitest.config.ts`: existing mdast types, static renderer test environment, no dependency needed.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read design context and screenshot for the desktop sidebar beside conversation bubbles. Reuse `AssistantMarkdown` in the existing conversation surface: inline-code chips retain their theme surface/type tokens, wrapped in the current primary-colour underlined anchor. No CSS or layout change. Capture the isolated renderer with real conversation/theme styles.

## Context

Assistant replies put useful URLs in backticks, leaving them unclickable. One independently useful behaviour is linking a complete allowed URL in inline code; negative cases, nesting and pending rendering are its safety invariants. Bare prose URLs belong to #2096. No ADR required.

Sizing: approximately 220–280 written lines including plan, tests and production; zero new exported types/components/stores, zero changed consumer call sites, four acceptance behaviours, no new state-machine errors. This is smaller than #1944's broader 413-line allowlist/handler change. No overlapping in-flight remote feature branches touch the three planned files. Recount before plan commit remains within all ceilings.

## Design

Add module-private `remarkCodeSpanLinks(): (tree: Root) => void` after `remarkHostedLinks` in the stable module-level `remarkPlugins` list. Walk mdast parents, skipping entire `link` and `linkReference` subtrees. For an `inlineCode` child, trim its parsed `value`, reject any remaining whitespace, then consult `allowedLinkHref`. Wrap accepted nodes in a mdast `link` whose URL is the admitted trimmed string and whose position is the original code node's position. Retain the original code child, including its parsed padding and position. Block `code` nodes are never candidates.

Keep `code`, `urlTransform`, `allowedLinkHref`, `webLink`, both component tables and the main-process handler unchanged. Synthesized links use the existing external-open anchors in either component table; workspace/hosted code strings never become links or buttons.

## State + concurrency model

Pure synchronous tree transformation during rendering. No store, async job, subscription, mutable cross-render state or teardown path.

## State transitions and identity reuse

| Event | Regression |
| --- | --- |
| Unclosed URL code span receives a virtual closing backtick | `pending presentation` test for pending URL code: preserved source positions cause both synthetic anchor and code to unwrap. |
| Original source later includes its real closing backtick and settles | Same pending/settled regression: rendering original completed source produces the allowed code anchor. |

No persistent identities are introduced; repeated renders independently derive the same markup.

## Error handling

Nonqualifying candidates remain original code nodes without throwing, controls or logging. The existing allowlist handles malformed/denied URLs. Rendering does not open URLs; activation uses the existing independently validated OS-open boundary.

## Testing strategy

Write regressions first and observe expected missing-anchor failures, then implement.

- Static renderer tables (default, workspace callback, both navigation callbacks): Obsidian open/http/https, retained CommonMark padding, verbatim casing/escaping; disallowed schemes/actions/parameters/extensions, whitespace-separated content, hosted links, paths and ordinary code remain exactly plain code.
- Inline/reference outer links, with direct and emphasized code labels: exactly the outer anchor; denied outer links stay inert. URL-only fenced/indented code stays unchanged.
- Existing streaming suite: pending synthetic completion stays unlinked and preserves pending presentation; original completed source links after settlement.
- Linux: focused `AssistantMarkdown.test.tsx`, `StreamingAssistantMarkdown.test.tsx`, `hostedAppLinks.test.tsx`, required pre-verify after final main merge, typecheck, build and docs check. Record executed counts. Existing `e2e/assistant-link-opens-externally.spec.ts` supplies activation coverage in the dispatcher application gate; no new Electron/live-provider/native Obsidian test. Another OS is outside this ticket's verification scope.

## Open Questions

None. Preserve mdast code and wrapper positions to satisfy the existing pending predicate without modifying streaming production code.

## Documentation handoff

- Pending for documentation stage: add one bullet to `docs/knowledge/features/assistant-markdown-renderer.md` describing whole-code-span URL linking, unchanged parsed code text, the shared allowlist and exclusions for blocks and existing links.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings: hostile parsed code reaches a link target only through whitespace rejection and `allowedLinkHref`; `webLink` validates again. The existing validated external-link attribute is the intentional sink; React escapes it and the label.
- [Tokens, secrets, credentials] No findings: no credentials generated, read, stored or logged; the transform receives only reply syntax.
- [File and storage operations] No findings: no file/storage operations. Relative Markdown and hosted strings remain code even with navigation callbacks; Obsidian file restrictions remain the shared allowlist's responsibility.
- [Electron attack surface] No findings: existing `target="_blank" rel="noreferrer"` anchors route to `createWindowOpenHandler`, which revalidates and denies in-app windows. No IPC, protocol registration, raw HTML, remote resource or Electron preference changes.
- [Cryptographic primitives] No findings: no keys, randomness, crypto or transport changes; these remain in the main process.
- [Network and I/O] No findings: transformation performs no I/O; it does not fetch or open a URL during rendering and adds no transport task.
- [Errors, logs, telemetry] No findings: no new logs or error state; URL/content strings never enter diagnostics. Denied content retains escaped code presentation.
- [Concurrency] No findings: per-render tree walk is synchronous and stateless. Original source ranges on both nodes prevent virtual pending syntax from exposing navigation.
- [Threat model alignment] No findings: hostile daemon text cannot create nested links, code-block links, arbitrary protocol controls or bypass the existing external allowlist. Link/reference subtrees are skipped regardless of destination, including nested emphasis. Relay/credential/process isolation boundaries remain untouched.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-18

## Revisions

- 2026-10-18: The verbatim-href regression with Unicode and HTML-sensitive characters exposed `mdast-util-to-hast` URI-encoding `link.url`. Set the wrapper's `data.hProperties.href` to the same already-admitted trimmed URL so the original reaches the unchanged `urlTransform` and `webLink` gates, then normal React escaping. The security verdict remains PASS: no additional attributes or unchecked destinations are forwarded.
