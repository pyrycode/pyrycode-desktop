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
