# Progressive assistant markdown (#1751)

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and reading map.
- `docs/knowledge/features/assistant-markdown-renderer.md`: capability-absent HTML handling and shared allowlists.
- `docs/knowledge/features/conversation-shell-timeline-render.md`: tail identity, tool settlement and cursor placement.
- `docs/knowledge/features/development-verification.md`: static versus mounted evidence.
- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` → `AssistantMarkdown`, `remarkGfmSubset`: sole renderer and shared parser configuration.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → markdown parser: existing unified/remark usage.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`: streaming/settled branch.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__markdown`, `.bubble--assistant-text`: block rhythm and obsolete plain-tail whitespace.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx`, `e2e/assistant-whitespace.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: assertions to replace and encrypted fake transport.
- Ticket's October 6 discussion: parser experiments and resolved pending/settlement policy.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

Read design context and screenshot. Preserve the existing assistant message surface, body-medium typography, token colours, padding, radius and actions. Both branches use the existing markdown block rhythm; pending presentation follows the ticket's textual policy. No new asset or token is needed.

## Context

The growing reply currently shows syntax and then switches to markdown at settlement. Render progressively without changing stored source or expanding the renderer's capabilities. Historical plain-tail decisions need documentation-stage updates, not edits here.

## Design

Add a local `StreamingAssistantMarkdown.tsx` module with partition and presentation helpers and the streaming component. A partition holds original source, ordered frozen source units with numeric offsets, the remaining tail offset and a whole-reply definition flag. It is render-local derived state, not a store or wire contract.

`partitionMarkdown(source, previous?)` parses only from the unfrozen block's line, using unified/remark-parse/`remarkGfmSubset`. A following top-level block must have two ended lines before a boundary can freeze. Compare independently parsed halves to the original tree, including absolute source positions. Reject units ending in lists, quotes or indented code; grow the candidate at the next boundary when verification fails. Nested definitions switch permanently to whole-reply mode for append-only source. Replacement source resets the partition.

`pendingMarkdown(tail)` returns insertion-only virtual source and a position-based element predicate. Only the trailing paragraph/heading leaf is eligible, including quotes. Probe unpaired markers innermost first, before trailing whitespace; accept a closer only when the parser consumes it into an inline construct. Bound probe passes. Leave escaped markers, ordinary punctuation and single tildes alone. Inline elements reaching synthetic closers unwrap, including links and code; original completed constructs retain their treatment.

For a trailing pipe line or partial delimiter, try the smallest parser-accepted delimiter completion, up to header pipe count plus one cells, preserving quote prefixes. Unwrap the pending table, rows and cells, separating header cells with spaces. No synthetic delimiter is visible. An incomplete end-of-input fence closer receives insertion-only stabilization so code remains code until its closing line ends.

`AssistantMarkdown` gets an optional `allowElement` predicate and `unwrapDisallowed` only when provided. Existing callers remain unchanged. Frozen units render through one memoized component per numeric offset; the tail through another `AssistantMarkdown`. All are direct children of `.bubble__markdown` without extra block wrappers. Settlement remounts the original full renderer with `item.text`.

## State + concurrency model

The streaming component owns derived partition state. Guarded render-time state replacement derives the next partition from the current source and previous partition; it performs no I/O or external mutation. Frozen objects survive appended deltas. Unmount discards everything. No subscriptions, timers, promises or cancellation paths are added. A source replacement resets local caches. Reference definitions invalidate all frozen rendering.

## Error handling

Unpaired syntax is content, not an error. Failed partition verification keeps a larger tail. Failed pending probes retain original source. No content, href, parser tree or caught text is logged. Existing IPC, transport and clipboard error contracts remain unchanged.

## Testing strategy

- Test first: named every-prefix fixtures and seeded block-starter fuzz compare raw partitions against full mdast at absolute offsets and full `AssistantMarkdown` output, ignoring only whitespace between top-level blocks.
- Separate expected-display tests cover pending inline/header syntax, quotes, escapes, punctuation, fences and unfinished raw-source settlement.
- Existing renderer security tests continue to pass; add stabilized hostile HTML/links/images and pending-link non-interactivity assertions.
- Fake transport drives appended deltas, definition invalidation, both settlement triggers and captures 1280px/800px views. Mounted parser and memo-render invocation counts establish reuse, rather than DOM identity alone.
- Replace obsolete screen/static and browser whitespace assertions. Run both changed browser specs, pre-verify and build after final main merge. No live spec changes or live Claude requirement.

## Open Questions

None. Reviewed a simpler whole-reply-per-delta design; it cannot meet frozen parser/render reuse. Keep the helper with its sole consumer.

Sizing: one deliverable; forecast at most 800 written lines including deletions, plan and tests; at most five new exported surfaces, one consumer, five observable criteria, no I/O rejection branches. Analogue #1079 included a 406-line plan and dependency work; this plan and existing parser dependencies keep the present work smaller. Branch #1818 overlaps only unrelated permission/composer blocks; edits stay local.

## Revisions

2026-10-07: `remark-parse` already renders an unclosed fenced block as code after its opener ends and keeps an end-of-input closer growing into ` ```x ` in that block. No virtual fence insertion is needed; raw-source fence fixtures and browser deltas pin this behavior. Pending table cells retain parser-literal markers (the unescaped pipe inside backticks creates two cells), with whitespace between the unwrapped cells collapsing to spaces. V8 mounted function counters prove memo skips, and a scoped parser breakpoint proves subsequent inputs exclude frozen source, without production instrumentation.

Security follow-up: bound inline probing to 64 candidate parses as well as 32 accepted completion passes. Otherwise a long punctuation-only paragraph could trigger a parse for every unpaired marker within one pass. Exhaustion retains uncompleted original syntax. Accepted closers are also checked against text/code-content positions so re-pairing cannot expose an earlier synthetic delimiter.

## Documentation handoff

Pending for documentation stage:
- `docs/knowledge/features/conversation-shell-timeline-render.md`: Structured-stream timeline render and Streaming cursor.
- `docs/specs/architecture/607-assistant-bubble-whitespace.md`: permanent plain-tail claim in Context.
- `docs/knowledge/features/assistant-markdown-renderer.md`: usage and limitations.

Replace permanent plain-tail claims with progressive rendering, freeze/reference-definition exception, pending presentation and raw-source settlement. Record markdown-owned whitespace, cursor placement and unchanged security rules; retain historical context as history.

## Security review

**Verdict:** PASS

- Trust boundaries: `AssistantMarkdown` remains the sole source-to-elements boundary. Stabilization supplies source and can only remove formatting/link elements through `allowElement`; no raw markup sink or alternate renderer.
- Tokens/secrets: no credentials are read, generated, stored or exposed by these modules.
- File/storage: no filesystem or persistence work; markdown paths retain `markdownLinkPath` validation and closure-only dispatch through the existing reader.
- Electron: no window/IPC/navigation change. Existing isolated sandboxed window and web-link allowlist remain. Pending links unwrap before a link/button can render.
- Cryptography: no primitives, keys, nonces or transport changes.
- Network/I/O: no new requests or resources; images remain alt text and raw HTML remains escaped. No rehype plugin, skipHtml or expanded GFM bundle.
- Errors/logs: malformed markdown remains content. No source, destination, tree or exception is logged.
- Concurrency: synchronous derived state owns its cache; no async jobs or global mutable cache. Replacement/unmount releases references.
- Threat alignment: hostile daemon text is escaped and checked by existing renderer rules even after synthetic completion. Parser probes are bounded and discarded unless consumed as syntax; tests assert no synthetic text leaks. Relay, disk-token theft and renderer isolation inherit unchanged main-process protections.

**Reviewer:** builder self-review per `builder/security-review.md`
**Date:** 2026-10-07
