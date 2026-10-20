# Thumbnail reader setup reliability

## Files read

- `e2e/thread-scroll-pin.spec.ts` → `withheldThumbnails`, `sendWithThumbnail`, `primeOverflowingThread`, `settleScrollEvent`, `stableThreadOffset`: existing fixture and immutable thumbnail growth assertions.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin`: trusted upward intent releases following before native movement; geometry changes alone intentionally retain following.
- `playwright.config.ts` → native-writer dependency, normal projects and workers remain unchanged.
- `docs/specs/architecture/1916-permission-reader-setup.md` → controlled metadata reveal demonstrates why programmatic parking can retain following.
- `docs/knowledge/features/development-verification.md`, `development-verification-layout-and-input.md`, `conversation-shell-scroll-pin.md`, `chat-history-testing.md` → completed delivery, focus/hover, processed scroll and stable geometry are separate barriers; historical thumbnail failures do not establish this cause.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, agents scope policy and working practice → test-only ownership and Linux verification contract.

## Context

One deliverable: reliably establish the existing thumbnail scenario's parked reader and preserve its growth oracles. The historical #2173 failure was before image release (1260 expected, 2416 observed); unchanged focused and full comparisons passed this case. Those observations establish intermittency, not cause. No product change or ADR is planned.

## Design

Keep changes local to this spec. Positively observe daemon echo publication rather than only optimistic row presence. Establish final pointer/focus state and stable offset/content/viewport geometry before reader input. Use trusted upward input, prove positive movement, and set the exact existing 40% target once. A listener registered after React acknowledges processing at that target. Require unchanged geometry and processing observations before retaining the immutable baseline. Preserve above/below placement, full-viewport clearance, decoding, drawn height, positive growth, reference row, exact offset and both bottom-resting cases.

Investigate with a controlled metadata focus/layout change concurrent with the old park, using existing rendered controls. Retain failed and passing artifacts and observations before parking, after processing and before release. If this instead demonstrates a production defect, stop for refinement rather than changing production.

Sizing: one behaviour, estimated 300 total written lines including plan/evidence, zero production files, zero exported types/components/stores, zero migrated consumers, four acceptance criteria, no new reject-state machine. Remote feature-branch overlap scan covers this spec; any overlapping changes will be read before implementation. Prefer a local readiness helper over a shared harness.

## State + concurrency model

Only test-owned observation state and withheld image requests. No application store changes. Listeners are removed after observation; the per-test Electron fixture closes windows and daemon resources. Native-writer ordering, workers, retries and deadlines remain unchanged.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Optimistic attachment send replaced by daemon echo | Named thumbnail reader scenario: positive echo barrier before parking |
| Focus/hover changes row geometry | Controlled old-setup failure and repaired reader scenario |
| Trusted upward intent and exact parking | Named scenario: movement plus newer processed scroll at target |
| Below then above image release | Original exact offset, immutable visible row and growth compensation assertions |
| New test reuses attachment identifiers | Full spec: per-test withheld map and isolated application |

## Error handling

Readiness fails the existing bounded Playwright assertions. No new application failure mode. Retain diagnostic geometry even on failure; never re-park or replace a jumped baseline.

## Testing strategy

- Run a controlled old-setup failure before implementing readiness; replay the same intervention against the repair. Separate this schedule from historical evidence.
- Run the exact named case ten consecutive Linux invocations, retries zero, including native-writer dependency; run the complete scroll spec with normal configuration.
- After final main merge, run pre-verify with `threadScrollPosition.test.ts` and build. Full configured application acceptance belongs to verifier/dispatcher. No fresh provider live acceptance is required; macOS is outside scope.
- Retain commands, source/build identity, JSON/list/stderr, worker/count/retry/error summaries and report hashes under `/tmp/builder-2183/`; record references and counts here before PR.

## Open Questions

- Which controlled echo/input/layout boundary discriminates original setup from repaired setup? Resolve experimentally and record under Revisions before publishing.
