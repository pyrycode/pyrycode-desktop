# Conversation shell — scroll-work verification

Part of [thread scroll pin](conversation-shell-scroll-pin.md). Fixture readiness,
bounded anchor lookup, same-row growth and observer cleanup evidence.

## Bounded anchor and growth verification

[`thread-scroll-work.spec.ts`](../../../e2e/thread-scroll-work.spec.ts) compares settled
32/400-row fixtures during deep-history scrolling and repeated deltas that visibly grow
one existing row. It asserts logarithmic geometry bounds, zero child enumeration and
zero row re-observation during same-row growth, with held and following readers checked
separately. Counting instrumentation stays in this spec: stack attribution isolates
`rememberTop`/`syncRows`/`refreshRow` geometry and child access, the pane target identifies
the pin's resize observer, and captured native geometry methods serve the test oracle.
Read-observer work and oracle reads therefore do not inflate the hook counts. Positive
rendered-height growth precedes the scroll assertions; setup costs are excluded.

### Initial-history readiness and commit delay

Before adding Growing, both sizes require the exact ordered Markdown contents
`History row 0` through `History row ${size - 1}` within a local 60-second
allowance, followed by zero streaming cursors. `history-readiness-32` and
`history-readiness-400` record elapsed time, committed count and tail. Send
completion and six animation frames cannot establish receipt or completed rows;
layout settlement follows the positive DOM barrier, before the existing reset.

The [initial-feed investigation](../../specs/architecture/2140-scroll-work-initial-readiness.md#revisions)
reproduced the old 15-second assertion rejecting at `History row 255` under
temporary twofold renderer throttling on Linux. The unchanged burst then committed
all 400 exact ordered contents at 52,563ms, with completed rows and no resend,
reconnect, repair or additional catch-up. All 1,201 native updates had reached
main and been forwarded by 1,122ms; renderer application continued through
51,845ms. Row 255 can therefore be an interim commit of an intact burst. Inspector
reads can themselves queue behind renderer work after assertion rejection; use
main receipt and renderer application/commit timelines to distinguish that delay
from incomplete delivery or failed recovery.

The controlled comparison kept application `1ccee42b`, Node 25.8.0, Electron
33.4.11, Playwright 1.61.1 and worker settings unchanged: configured/effective
workers 3/1 and zero retries. `control-twofold.json` ran 1 executed, 0 passed, 1 failed,
0 skipped; `repaired-twofold.json` ran 1 executed, 1 passed, 0 failed, 0 skipped,
with completed long-history readiness at 33,658ms. Sixty seconds exceeds the
measured 52.6-second intact completion while retaining the 120-second case budget.
The unchanged feed, work limits and global timeouts remain in force; these timings
do not establish a render-speed improvement. Diagnostic listeners and throttling
do not ship. Historical failures ended at rejection, so their subsequent progress
is unknown. The stronger sixfold stress remains failed: 1 executed, 0 passed,
1 timed out, 0 skipped, despite eventual complete commit at 108,561ms. It supplies
no acceptance pass.

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2148#issuecomment-6274386382)
records Linux evidence at `43f4b424` (tested spec unchanged from `d35702ac`):

| Run | Executed / passed / failed / skipped | Configured / effective workers |
| --- | --- | --- |
| Ten separate consecutive named invocations | 10 / 10 / 0 / 0 | 3 / 1 each |
| Both scroll-work cases | 2 / 2 / 0 / 0 | 3 / 1 |
| Complete configured default application gate | 515 / 515 / 0 / 5 | 3 / 3 |

`scroll lookup and same-row growth stay bounded on short and long threads` was
present and passed in every named invocation and in the complete gate; both cases
passed in the two-case and full runs. All used zero retries and the original
native-writer/clipboard/parallel projects. The configured gate command omitted the
criterion's explicit `--retries=0` flag, but each project configured zero retries
and both cases passed once at retry 0. Full-gate history readiness observed 32/400
completed ordered rows and Growing counts 33/401, with long-history readiness at
18,382ms. Three held-reader updates, following-reader growth/positions, cross-size
comparisons and zero enumeration/re-observation checks remain intact.

Focused JSON reports `final-named-1.json` through `final-named-10.json`,
`final-both.json` and matching `.stderr.log` files are retained under
`/tmp/builder-2140/`; the plan records the archive and manifest hashes. Full-gate
JSON/stderr are `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2140_7.log`
and the matching `_7.stderr.log`. Its five skips were two macOS-only icon-badge
cases, one macOS-only last-window reopen case, the existing system-prompt
Reset-session fixme and unreachable-host unpair blocked on #2089. Neither
scroll-work case skipped; focused skip lists are empty. macOS is outside this
Linux ticket's verification scope; no live-provider run is claimed.

### Growing-row readiness

The Growing-row setup requires the `Growing row` tail within a local 15-second
allowance, then exactly `size + 1` committed assistant rows before resetting work counters.
Its readiness attachment records size, committed count, tail and elapsed time. In the
[#1662 investigation](../../specs/architecture/1662-merged-model-pickers.md#revisions--2026-10-16-selected-host-rework),
the original four-case subset ran 4 executed, 3 passed, 1 failed, 0 skipped. A same-attempt
control retained the five-second rejection, then observed the row at 5,339ms and rethrew
the original failure. This establishes delayed setup completion without identifying its
precise latency mechanism. The shipping barrier retains geometry bounds, held/following
positions, membership/observer counts and cleanup; diagnostic listeners do not ship.
The [October 16 verifier](https://github.com/pyrycode/pyrycode-desktop/pull/1846#issuecomment-6219617302)
confirms both scroll cases present and passed in the complete Linux gate at `49ed9418`:
488 executed/passed, 0 failed, 4 existing skips, 0 retries or flaky results. In particular,
`scroll lookup and same-row growth stay bounded on short and long threads` executed and
passed. The later pass does not erase the controlled failure.

### Gap, hidden-run and cleanup readiness

The second case checks gaps, long hidden and zero-height runs, immediate expansion before
resize delivery, row addition/replacement/removal and hook teardown/remount. Its streamed
arrival adds a new assistant row; unchanged-membership growth is proved by the first case.
Observation-root replacement within a surviving hook was source-reviewed rather than
separately exercised in the browser.

Before any adversarial geometry changes, the second case requires the exact ordered
Markdown contents of all 100 assistant rows (`History row 0` through `History row 99`)
within a local 15-second deadline, then requires zero streaming cursors. Its
`feed-readiness` attachment records elapsed feed time, committed count and tail.
`FakeDaemon.pushFrame` completion proves sending only; the subsequent six animation
frames settle layout after the positive DOM barrier. Hook-work counting remains
disabled until the existing measurement reset, so feed readiness cannot inflate
the bounded-work oracle.

The [feed-readiness investigation](../../specs/architecture/2033-scroll-work-feed-readiness.md#revisions)
found the unchanged natural-scheduling baseline green on build-hp-1. An identical
temporary 6× renderer slowdown in control and repaired runs exposed the deadline:
the original five-second assertion failed while delivery continued, reaching all
100 rows and the expected tail at 8257ms; the repaired run observed readiness at
7489ms and passed the remaining geometry/cleanup checks. The timeline control ran
1 executed, 0 passed, 1 failed, 0 skipped; the repaired comparison ran 1 executed,
1 passed, 0 failed, 0 skipped. Both configured 2 workers and used 1, with zero
retries and report errors. This establishes deadline
sensitivity under slower rendering, without reproducing the original build-fractal-2
scheduling trace or establishing a transport defect. Fifteen seconds gives
headroom above the measured 8.26-second completion while retaining the fixture's
60-second test limit. The slowdown and
timeline observer are diagnostic only and do not ship.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2034#issuecomment-6203933037)
confirms Linux validation at implementation `bcc8400efdbe759af1e0c38283d4b70fc5aae6a0`:

| Run | Executed / passed / failed / skipped | Configured / effective workers |
| --- | --- | --- |
| Ten separate consecutive named-case invocations | 10 / 10 / 0 / 0 | 2 / 1 each |
| Both scroll-work cases | 2 / 2 / 0 / 0 | 2 / 1 |
| Complete configured fake suite | 432 / 432 / 0 / 19 | 2 / 2 |

The named `gaps, long hidden runs and target changes preserve a valid anchor and clean observations`
case was present and passed in every named invocation and the full report; both
scroll-work cases passed in the two-case and full runs. Every readiness attachment
records 100 rows ending in `History row 99`. All runs used zero retries and had no
report-level errors; clipboard/parallel projects stayed unchanged. The plan records
the inherited skip reasons, JSON/stderr paths and archive hashes. Dispatcher verifier
gate 6 independently passed the named case at evidence-only head
`9fec6f564bd82e84242bbe8a435d76c1eb401152`: 432 executed/passed, 0 failed,
19 skipped, zero retries and report errors, with 4 configured/effective workers.
That gate corroborates the separate two-worker acceptance run rather than supplying
its concurrency evidence.

### Bounded-work regression evidence

Recorded evidence for [#1892](../../specs/architecture/1892-bounded-scroll-anchor.md#revisions):

- The recorded pre-fix main renderer at `214d15625f51495c2e07772d320003dc1eec7588`
  ran both named cases below: 2 executed, 0 passed, 2 failed, 0 skipped. Deep lookup
  read 25/265 row rectangles on the 32/400-row fixtures (bounds 8/11); each delta
  re-observed 34/402 direct children. The gap/hidden case read 87 rectangles and
  failed zero-height anchor correctness. The baseline log is recorded at
  `/tmp/builder-1892/baseline-final.txt`; renderer identity was checked by content hash.
- Dispatcher verifier gate 6 (`npx playwright test --reporter=json`) on 2026-10-08
  at `2e677c70d94547a5d2c32118c5efee970e97f1c9`: 371 executed, 371 passed,
  0 failed, 4 skipped. The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1894#issuecomment-6054832982)
  confirms both named cases were present, executed and passed:
  `scroll lookup and same-row growth stay bounded on short and long threads` and
  `gaps, long hidden runs and target changes preserve a valid anchor and clean observations`.
  The hook-work attachment records 6/10 scroll geometry reads and maximum held-growth
  reads of 8/12 for 32/400 rows, with zero same-row child enumeration/re-observation.

The same verdict confirms all required specs present and passed in that gate:

| Fake-transport spec | Executed / passed | Failed / skipped |
| --- | --- | --- |
| `thread-scroll-work.spec.ts` | 2 / 2 | 0 / 0 |
| `thread-scroll-pin.spec.ts` | 22 / 22 | 0 / 0 |
| `translucent-thread-controls.spec.ts` | 3 / 3 | 0 / 0 |

The existing suites retain prepend position, small upward intent inside the bottom
tolerance, send resumption, late-image, resize/zoom and composer-clearance coverage.
These are bounded-operation and behavior proofs, not profiling evidence for overall
scroll smoothness. Frame publication, read-observation setup and backdrop-filter paint
cost are separate concerns. No live-Claude or visual comparison was required or performed.
