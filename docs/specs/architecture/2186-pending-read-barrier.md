# Reliable pending read evidence

## Files read
- `e2e/visible-tail-read.spec.ts` → stable-callback test: frame-only hold and hidden/queued exclusions.
- `src/renderer/src/store/threadRuntime.ts` → `schedule`: the same drain races a frame against a 50 ms timer.
- `src/renderer/src/store/conversationReadPublisher.ts` → `useReadObservation`: focus/scroll observe synchronously from committed inputs.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: real preload delivery and isolated app teardown.
- `playwright.config.ts` → default projects, native prerequisite and retries.
- `docs/knowledge/features/thread-runtime.md` and `conversation-shell.md`: received work is distinct from committed read authority.
- `docs/knowledge/features/development-verification*.md`: positive receipt and ordered outbound barriers precede absence assertions.
- Root `CLAUDE.md`, knowledge index, shared working practice and ticket scope policy: test-only repair, Linux verification and artifact ownership.

## Context
One independently useful behavior: reliably exclude a received but uncommitted tail from read publication. The runtime's bounded timer bypasses the frame-only test hold. No production change or ADR is needed. Estimate: approximately 180 written lines including tests and this plan; zero new exported surfaces, consumer migrations or production failure branches, two acceptance behaviors. Overlap with #2150 is limited to the separate native-focus helper; build through it locally.

## Design
Keep the hidden-document, hidden-row and queued checks. Hold frame callbacks and their paired timer drain by callback identity, leaving unrelated timers running. Count actual native frame/timer opportunities while retaining the work. After real preload receipt and both opportunities, assert text remains absent and marks remain at 4. Dispatch focus/scroll then send a context-usage sentinel on the same ordered IPC/transport path; wait for its daemon receipt before excluding publication. Restore exact intercepted API identities and unsubscribe in `finally`, then release retained work and require visible text and target 5.

## State + concurrency model
All interception lives in this test's renderer and ends in `finally`. Native APIs continue scheduling opportunities; only application callbacks are retained. Cancellation removes held work and cancels native handles. Release restores APIs before invoking retained work, letting the runtime cancel its losing race normally. App teardown owns the renderer if its context disappears.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Repeated same-row hidden/queued commits and reveal | Existing named stable-callback test |
| Preload receipt, native frame/timer opportunities, focus/scroll before commit | Strengthened named stable-callback test |
| Release, cancellation of losing drain, committed target 5 | Same test, followed by ten independent repetitions |
| Failure during exclusion assertions | `finally` restores all four scheduling APIs and the preload subscription |

## Error handling
No new production error paths. Assertion failure retains raw reports and still releases interception; final assertions verify normal progress resumes.

## Testing strategy
- Controlled before: add a native 100 ms opportunity after receipt with the original frame-only barrier; retain the expected absence-assertion failure.
- After repair: named test, ten consecutive repetitions with one worker, complete visible-tail spec, all with retries zero.
- Run pre-verify with existing `src/renderer/src/store/threadUpdates.test.ts`, build and client-test typecheck after final merge of main; prepare the Electron native addon sequentially afterwards.
- Run the complete default suite with its original projects/workers and retries zero, explicitly required by this ticket. Preserve counts and artifacts under `/tmp/builder-2186/` and record results here.
- Historical macOS `original-playwright.log` and `retry.json` under `/tmp/verifier-2180/review-bf3131b5/` remain historical red/retry evidence, never overwritten. They are absent on this Linux host; evidence and stage services returned no #2180 records. No macOS rerun is in scope.

## Open Questions
None. The shared drain identity provides a narrow timer interception without pausing unrelated work.

## Revisions
2026-10-20: Confirmed the timer bypass with the controlled original barrier plus a 100 ms native opportunity: `before.json` records 1 executed, 0 passed, 1 failed, 0 skipped, retries zero, at the expected “Awaiting commit” absence assertion. The repaired barrier retains that challenge and adds positive native opportunity counters. `after.json` records 1 executed/passed, 0 failed/skipped/retried; its `pending-read-barrier` attachment records receipt 1, frame opportunity 1, timer opportunity 1, targets `[1,2,3,4]` and the received context-usage sentinel. Both reports and their result directories remain under `/tmp/builder-2186/`.

Historical evidence was recovered through owning ticket #2176 (PR #2180), not the PR number. Bundle `ffc78e067a57e1446e74fe49f96444dc69e4f2be953f438bd475591d094889ac`, downloaded beneath `/tmp/builder-2186/evidence-2176/`, retains the original full macOS gate log `logs/verifier-gate__2176_6.log` (SHA-256 `f5917e8f8ed50c180f3116b6c6c8dd3df1075189352d9833e5ab4aaeeae2acc3`): 531 executed, 529 passed, 2 failed, 2 skipped. The stable-callback absence assertion failed with the pending text rendered. Its `handoff/verifier-2176.md` preserves the exact unchanged retry: 2 executed, 1 passed (stable callbacks), 1 failed (reply source, #2173), 0 skipped/retried. The original scratch `retry.json` is not included in this bundle; its successful named outcome is handoff evidence, not a newly inspected raw JSON report. Original macOS red and retry are not replaced by Linux results.
