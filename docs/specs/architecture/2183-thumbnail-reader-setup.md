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

## Revisions

2026-10-20: Resolved the question with controlled metadata focus during the original park. All three user rows had supplied numeric identities (`1`, `2`, `123`), proving echo publication. Focusing the first thumbnail's Copy action with `preventScroll` and reading layout changed height 3149 → 3177 (viewport 733); assigning 1260 succeeded immediately, then scroll/resize processing returned to bottom 2444. The original pre-release equality failed. This is a controlled focus/layout intervention, not attribution of the historical unrecorded schedule (whose observed endpoint was 2416).

The repair retains that focus intervention, settles focus geometry, transfers focus to the thread with pointer outside, and settles again. Trusted ArrowUp then proves actual upward movement (2416 → 2376). One exact park follows; the observer registered after React records a newer processed scroll at 1260, with 20 unchanged frame comparisons covering offset, content/viewport dimensions, focus and processing. Its pre-release snapshot remains immutable through the original assertions. Each setup phase is attached as `thumbnail-reader-setup`, including failed observations. All listeners are removed before release.

The repaired controlled run passed 2/2 including native writer; the reader case retained both above/below growth oracles. An initial diagnostic looked for the authoritative identity on the inner message row and failed there; corrected observation uses the existing direct-child supplied wrapper. No product defect or product change was needed. No remote feature branch overlaps this spec. Written scope remains below 300 lines, with zero production files or exported abstractions.

Additional source reads: `e2e/fixtures/scriptedThread.ts` → message publication supplies the authoritative row; `ThreadItemsView` and `MessageActions` in `ConversationScreen.tsx` → outer supplied wrapper and Copy focus reveal. Final main merge brought #1983's additive fake-daemon diagnostics, which were retained unchanged.

## Validation evidence

Linux x64/Xvfb, kernel `7.0.0-38-generic`, Node `25.8.0`, Electron `33.4.11`. Final normal build compiled clean `ecab62531156cbda4959d406e6d67257122f8f30`, containing main `3d890c0e7eae`. Subsequent commits add plan evidence only. `final-build-provenance.json` and `final-build.sha256` under `/tmp/builder-2183/` retain compilation identity and output hashes; hashes were checked again after browser acceptance. Spec SHA-256: `1b55e95b98a03df9eb91534ed0658220bc910485714758ffa194ce6502abb616`.

| Check | Executed / passed / failed / skipped |
| --- | --- |
| Original setup + concurrent metadata focus, `control-before.json` | 2 / 1 / 1 / 0 |
| Same control with positive echo barrier, `control-echo-ready.json` | 2 / 1 / 1 / 0 |
| Repaired control, `control-repaired.json` | 2 / 2 / 0 / 0 |
| Ten consecutive final invocations, `focused-1.json` through `focused-10.json` | 20 / 20 / 0 / 0 |
| Complete scroll spec, `scroll-spec.json` | 23 / 23 / 0 / 0 |
| Pre-verify affected unit file | 15 / 15 / 0 / 0 |

All browser reports used four configured workers and one effective execution slot, normal projects and the native-writer dependency, zero retries and zero report-level errors. Each focused invocation executed the exact named reader case once plus the prerequisite once. No skip reasons exist because none skipped. All three thumbnail cases passed in the complete spec. All 30 fake-daemon setup attachments in the ten final invocations report first-attempt `opened`, with no setup failure/retry. The separate `control-echo-complete.json` diagnostic recorded 2 / 1 / 1 / 0 at the initially incorrect inner-row observation; it did not reach the park and supplies no causal proof.

Focused/control command (each with a distinct run name and combined stdout/stderr saved as `<run>.log`):

```sh
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2183/<run>.json npx playwright test e2e/thread-scroll-pin.spec.ts --grep 'a thumbnail resolving leaves a scrolled-up reader where they were, above them or below them' --retries=0 --reporter=list,json --output=/tmp/builder-2183/<run>-results
```

The complete spec used the same command without `--grep`, with run name `scroll-spec`. No worker override, workload reduction, sleep, retry, skip, deadline relaxation or repeated park was introduced. `thumbnail-reader-setup` attachments retain focus growth and the final 40 samples of each phase; failed controls retain their expected/actual offsets and contexts. Controls used the original production build from plan commit `7b99661d` (dirty only for test instrumentation), whose provenance/hashes and exact controlled spec copies are retained separately.

`pre-verify.log` records all five checks green after final main merge, including the issue label read, typecheck and `threadScrollPosition.test.ts` (15 passing cases). `unit-final/` retains its structured unit evidence. `build-final.log` and `check-docs.log` passed. Native preparation used `npm run rebuild:electron` after the Node unit gate. No fresh provider/daemon live acceptance is required or claimed; macOS is outside this Linux ticket's scope.

Report SHA-256: original control `ebb0a7cf7211fb5282e5454244fb218f1b0a874c93a7c596029e7ea9c88960b8`; echo-ready control `255b7b646142368a5eae300d53d9a9546fbb490feda0023a37ef4f9ea4886a28`; repaired control `e6c8ef6fe17ef7f0ac09d08f13fbd5c514d90376021a85332a35baf20927e57d`; full spec `bffb66781cef93dd1eaafac4627452fa4f78311c82fedc1c728d67e99193f777`. Counted per-report summary with all ten focused hashes and phase endpoints: `/tmp/builder-2183/summary.json`, SHA-256 `4efdbca4c86331c74619c0070a5b06c6f78c7e30a32e85509c0d65bdb113b8ea`. `/tmp/builder-2183/SHA256SUMS` inventories reports, logs, controlled source and build identities.

Historical evidence remains separate: #2173's original 529 executed / 528 passed / 1 failed / 4 skipped report at `dd069c67` had SHA-256 `03c6cf0b3d1c08b516529d00d616e3f64a2feda0a1bef33349c9ec848221535a`; unchanged focused comparison passed 2/2, and full comparison passed this case while another failure belonged to #2184. Their source-computer paths and hashes remain in the issue comments. Retrieved builder bundle `396b1c9d43491efb01e9a8f866bd3e42c0b6994eebe2c3e88520356fe93ca6ff` under `historical-2173/` verified all three checksums; it contains the original agent log/metadata, not standalone reports. Stage lookup returned no records. #2158 observations are not attributed to this controlled schedule.

Handoff: verifier/dispatcher owns the complete configured `npm run e2e -- --reporter=list,json` application suite, including captured clients, and must identify the named case's outcome. That full application gate has not been run by this builder.
