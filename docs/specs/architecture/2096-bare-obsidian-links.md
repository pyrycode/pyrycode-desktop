# Bare Obsidian open links in reply prose

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and owning package.
- `docs/knowledge/features/assistant-markdown-renderer.md`: absent general autolinks, shared allowlist and pending source-position exclusions.
- `docs/knowledge/features/development-verification.md`: static rendering proves markup; application gate owns activation evidence.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx`: `remarkCodeSpanLinks`, `remarkPlugins`, `webLink`, both component tables and `urlTransform`.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx`: `render`, `count`, code-span regression tables and unchanged bare-web/email cases.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.tsx`: `pendingMarkdown` filters synthetic anchors using source ranges.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.test.tsx`: pending/settled presentation and prefix regressions.
- `src/shared/externalLink.ts`: `allowedLinkHref` preserves admitted strings and rejects writable actions/parameters and non-note files.
- `docs/specs/architecture/2095-code-span-url-links.md`, `package.json`: predecessor contract and existing dependencies.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Read the design context and screenshot: sidebar beside conversation bubbles, body text and primary-colour links. Reuse the existing `AssistantMarkdown` anchor treatment and conversation/theme tokens. No new CSS, assets or layout. Capture the isolated production renderer with actual conversation styles.

## Context

One useful behaviour: admitted bare Obsidian open URLs become clickable in reply prose. Boundary, punctuation, nesting and pending exclusions are safety invariants of that behaviour, not separate deliverables. General bare web/email autolinking stays absent. Documentation stage updates the existing ADR; no new ADR needed.

Sizing: approximately 300 written lines across production, tests and plan; no new exported types/components/stores, no consumer signature changes, five acceptance behaviours, no state-machine error branches. #2095 landed 197 written lines; the additional candidate scanning and boundary cases account for the difference. No overlapping remote feature branches touch the three planned source/test files. Recount before commit remains below all ceilings.

## Design

Add private `remarkObsidianProseLinks(): (tree: Root) => void` to the stable `remarkPlugins` list after the existing transforms. Walk text children recursively, excluding entire link/link-reference and code subtrees. Scan each text value for case-insensitive `obsidian://open` starts. Refuse starts immediately preceded by a word character, colon or slash. Consume to whitespace or `<`, `>`, backtick, double quote, `[` or `]`; never retry inside the consumed candidate.

Count parentheses once, then trim trailing `. , ; : ! ?` and surplus closing parentheses from the end. Keep balanced parentheses and interior apostrophes, exclamation marks and asterisks. Consult `allowedLinkHref` once for the complete trimmed candidate; on rejection retain the original text. Use forward cursors and character checks rather than repeated suffix regex matching, keeping scanning linear on unbounded input.

Split accepted text into mdast text/link nodes. Each generated link contains only its URL text, retains the source text node's position, and sets `data.hProperties.href` to the admitted original URL as #2095 does. The conservative original range lets `pendingMarkdown` suppress synthetic presentation anchors even when parsed entities change text offsets. Both existing component tables pass generated links through `webLink`. Keep `remarkGfmSubset`, `urlTransform`, `allowedLinkHref` and the window-open handler unchanged; no package additions.

## State + concurrency model

Pure synchronous per-render tree transformation. No store, identities, async jobs, subscriptions or teardown changes. Mutation is limited to the current parsed tree; scanner cursors are local to a text node.

## State transitions and identity reuse

| Event | Regression |
| --- | --- |
| Table header receives a synthetic delimiter | `keeps bare Obsidian links inert in a synthetic pending table`: source positions cause generated anchors to unwrap. |
| Original table delimiter arrives and settled source renders | Same test checks the original completed table contains the admitted anchor. |

Repeated renders derive fresh trees; no identity reuse or cross-render scanner state.

## Error handling

Denied/malformed candidates remain escaped text. No render-time opening, I/O, errors or content logging is introduced. The existing main-process handler independently validates activation targets.

## Testing strategy

Write regressions first and observe missing anchors, then implement.

- Static render tables with default and navigation-enabled component tables: exact admitted href/text, casing and HTML escaping, two URLs, emphasis and prose preservation.
- Delimiters and punctuation: each stopping character, sentence punctuation, surplus/balanced parentheses and Obsidian's unencoded note-name characters.
- Denied action/append/non-note file, malformed/hostile candidates and preceding words/schemes remain text; never salvage a rejected prefix. Existing bare web/email tests remain unchanged.
- Inline/reference outer links including emphasis produce only the allowed outer anchor; denied outer targets remain inert. Fenced/indented code stay unchanged; existing whole-code-span tests continue passing.
- Pending table and original settled table test, existing streaming and hosted-link suites.
- Linux focused files, pre-verify after final main merge, typecheck, build and docs guard. Record executed counts. Existing `e2e/assistant-link-opens-externally.spec.ts` covers the unchanged activation path in the dispatcher application gate. No live provider/native Obsidian acceptance is added; another OS is outside scope.

## Open Questions

None. Conservative source ranges avoid inventing decoded-text-to-source offset mappings and preserve pending exclusions.

## Documentation handoff

Pending for documentation stage:

- `docs/knowledge/features/assistant-markdown-renderer.md`: update the “Footnotes and autolink literals” bullet and plugin description to state the narrow bare-Obsidian-open exception while retaining the absence of general autolink-literal syntax, footnotes and bare web/email linking.
- `docs/knowledge/decisions/0010-markdown-renderer-capability-absent-html.md`: update the `remark-gfm` consequence with the same narrow exception and retained exclusions.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings: untrusted text becomes a target only after whole-candidate `allowedLinkHref` admission. `urlTransform`, `webLink` and the main handler still validate independently; React escapes visible text and the intentional admitted-link attribute.
- [Tokens, secrets, credentials] No findings: no credential generation, access, storage or logging.
- [File and storage operations] No findings: no filesystem or storage operation. Existing note-only checks remain in `allowedLinkHref`, unchanged.
- [Electron attack surface] No findings: existing external anchors retain `target="_blank" rel="noreferrer"` and main-process admission. No IPC, protocol registration, navigation or raw HTML change. Link/reference subtrees are excluded regardless of destination, preventing nested anchors.
- [Cryptographic primitives] No findings: no transport, keys, randomness or cryptographic code changes.
- [Network and I/O] No findings: transformation performs no I/O. Forward candidate scanning, one parentheses count and backward trimming have linear work; rejected candidates receive no shorter-prefix retries.
- [Errors, logs, telemetry] No findings: no new diagnostics; daemon text and URLs never enter logs. Rejections preserve escaped prose.
- [Concurrency] No findings: no persistent mutable state or async work. Generated anchors retain original positions, enabling the existing synthetic-presentation filter.
- [Threat model alignment] No findings: hostile daemon text cannot widen the shared read-only allowlist or open anything at render time. Malicious relay flooding remains bounded by existing transport policies; this transform adds no superlinear scan. Credential theft and renderer isolation mechanisms are untouched.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-18
