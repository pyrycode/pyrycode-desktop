# Readable Agent running status

## Files read

- `src/renderer/src/screens/conversation/threadComposerReports.ts` → `threadComposerReports`: selects current-session foreground activity and forwards tool names.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `presentation`: compact headers supply headlines without structured input; complete tools retain input strings.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `toolWorkingCopy`, `ThinkingIndicator`: escaped text, trailing ellipsis and elapsed formatting remain unchanged.
- `src/renderer/src/screens/conversation/threadComposerReports.test.ts` → `snapshot`: existing authoritative report fixtures.
- `src/renderer/src/screens/conversation/compactPresentation.test.tsx` → compact presentation cases: static renderer coverage and deferred-body boundaries.
- `e2e/compact-demand.spec.ts` → compact fake transport: negotiated delivery, live revisions and recorded detail requests.
- `docs/knowledge/features/conversation-shell.md` → Edge cases and limitations: selected reports own live chrome; frozen presentation identity must remain intact.
- `docs/knowledge/features/development-verification.md` → evidence boundaries: static rendering proves text; mounted processing barriers prove revisions and absent requests.
- QMD search → `docs/specs/architecture/2127-visible-thread-presentation.md`: existing authoritative presentation seam.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525
Read design context and screenshot: a compact horizontal activity icon/text row, body-small typography and primary colour. Retain the existing `ThinkingIndicator`, theme tokens, single-line ellipsis, activity treatment and elapsed display. Reference screenshot: `/tmp/builder-2162/figma-status.png` (706×34).

## Context

Compact delivery can truncate tool-input JSON after a complete description. Forwarding the entire Agent headline exposes raw input in composer chrome. This is one observable repair with its regression, not separate parser and UI deliverables. No ADR or documentation-stage change is required.

## Design

Add private pure label derivation beside `threadComposerReports`; leave source items and their presentation/cache authority unchanged. For a structured Agent call, use its nonempty string input description. For an Agent-prefixed compact headline with readable prose, preserve the headline. For JSON-shaped suffixes, recover only a complete top-level string description and otherwise use `Agent`.

Scan JSON string/escape and nesting boundaries, validating complete object prefixes with `JSON.parse`. Only top-level member boundaries are candidates; quoted/nested descriptions cannot match. A valid prefix through the description is sufficient even when later members are truncated. JSON decoding handles escapes; React continues to escape the resulting text. No detail API, source mutation, new public type, dependency or store is added. Other tools and the existing foreground/current-session/activity selection remain unchanged.

Sizing, checked against sketch and written plan: approximately 330–380 total written lines (about 60 production, 230 tests and 60 plan), 0 new exported surfaces, 1 changed consumer site, 3 observable acceptance criteria, fewer than 10 parsing/fallback outcomes. The narrower #2061 analogue changed 17 lines but did not handle compact/truncated input. Remote feature-branch overlap check found none in the intended files.

## State + concurrency model

Pure derivation from the current immutable snapshot; no async task, subscription or cancellation path is introduced. Existing runtime subscriptions publish updated reports.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Same compact item ID receives a newer header description | `compact Agent status describes truncated input and follows live revisions` in `e2e/compact-demand.spec.ts` |
| Active foreground selection competes with child, old-session, inactive or task-linked activity | `keeps Agent labels within existing foreground selection` in `threadComposerReports.test.ts` |

## Error handling

Invalid JSON prefixes, missing/empty/non-string descriptions and incomplete strings produce the plain Agent label without throwing or displaying JSON. This local presentation fallback introduces no I/O failures or logging of daemon content.

## Testing strategy

- Test first: focused report regressions fail on the existing raw headline/description omission.
- Unit cases cover structured input, complete/truncated compact input, escaped keys/values, nested/quoted decoys, malformed/empty/non-string/cut descriptions, readable headlines, non-Agent controls and selection.
- Static render the resulting name through `ThinkingIndicator` to prove safe text and existing elapsed/ellipsis formatting.
- Negotiate compact delivery in the mounted fake application; assert description, no raw input in status, live revision and no body/children/history demand after positive rendering barriers. Capture the status at normal and minimum window widths for visual comparison.
- After final main merge: install, pre-verify for affected unit files, build, client-test typecheck and focused compact-demand Playwright spec. Linux is this run's verification OS under the shared host policy; no second-OS check or provider credentials are required.

## Open Questions

None. Keep the repair at composer label derivation rather than altering all tool row headlines.
