# Held expansion completion

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and mounted-test requirements.
- `docs/knowledge/features/development-verification.md`: counted evidence and immutable failure provenance.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-timeline-render.md`, `conversation-shell-scroll-pin.md`: source-ID retention, deferred bodies and committed geometry.
- `docs/specs/architecture/2127-visible-thread-presentation.md`: existing admission contract and historical completion failures.
- `e2e/thread-items.spec.ts` → `rendererFixture`, held-item case: real composer instrumentation and 8,334-source workload.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`: visible-ID admission, 256-item budget, timer cleanup and scroll pin.
- `src/renderer/src/screens/conversation/deferredThread.test.tsx`: static deferral assertions; these do not establish effect liveness.
- `e2e/fixtures/electronLaunch.ts`, `launchPairedApp.ts`, `runDisplay.ts`, `playwright.config.ts`: normal launch/teardown, worker isolation and clipboard project.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553
Read design context and screenshot: single-line tool header with lead, subject, count and chevron, existing token-based border and body. Preserve the existing presentation and assets.

## Context

One behavior: complete held expansion while actual composer input remains responsive. Repair and discriminating regression stay together. Original macOS failure is retained separately under `/tmp/builder-2184/original-failure/`, bundle `cbb63d3356b372eaa1b98e91808e261b1ea315e1eb41b9182ffa90540ba738d7`: 532 executed, 531 passed, one failed, two skipped. Its same-tree retry is historical evidence of intermittency, not a cause. No ADR is needed.

## Design

Instrument the existing spec-local renderer fixture to distinguish committed row progress, admission scheduling and visibility from test-driver orchestration. Establish a controlled schedule that discriminates the demonstrated failure boundary, then repair that boundary locally. Keep the production admission contract: at most 256 additional visible source IDs per turn, yielding to real input, no paging, no dropped final rows. Any diagnosis changing this design is recorded in Revisions before implementation.

Prefer the existing local effect and spec-local controls over introducing an exported scheduler or shared harness changes. Preserve all original assertions, workload and deadlines; no sleeps, retries or increased timeout. Overlap: `feature/2176` adds independent read diagnostics in `rendererFixture` and a separate test; preserve its edits when merged, keeping changes additive.

## State + concurrency model

Admission and expansion remain local to the host/conversation/epoch keyed view. Pending admission work must progress while visible work remains, stop when complete, cancel on visibility replacement and unmount, and avoid retaining stale IDs. Actual composer input stays independently committed. No transport or store ownership changes.

## State transitions and identity reuse

| Event | Mounted coverage |
| --- | --- |
| Nested expansion and input during incomplete admission | existing held-item case, controlled schedule plus real keyboard commit |
| Completion after input | held-item case: positive progress, row 8339 and all 8,334 rows |
| Collapse, closed revision and reopen with same IDs | held-item case: revised last row, retained child expansion and visible-only read |
| Group collapse and removed reading row | held-item case: both existing anchor assertions |
| Scope/epoch replacement and teardown | existing supplied-agent scope loop and normal fixture teardown |

## Error handling

No new I/O or reject branches. Diagnostic attachments contain counts, timing and static phases only. Failure retains progress and normal launch-fate evidence rather than retrying it away.

## Testing strategy

- Run a discriminating mounted regression against unchanged production first, retain the failure, then run it after the repair.
- Preserve static deferral tests; pre-verify targets `deferredThread.test.tsx`.
- Linux exact case: clipboard project, no dependencies, distinctive title, ten repeats, retries zero. Run the complete `thread-items.spec.ts` with retries zero.
- Retain commands, revision, counts, retries and composer/progress observations in this plan. Build and pre-verify after final main merge. Complete configured application acceptance belongs to verifier/dispatcher; no fresh provider or second-OS proof is claimed.

## Open Questions

Resolved by the diagnostic and discriminating regression below: the demonstrated defect is expensive test-driver inspection during a missing-row wait. No production scheduler change is justified.

Size: approximately 250 written lines, at most one production file, no new exports or migrated consumers, three observable criteria, no new reject branches; below all ceilings. One independently verifiable behavior, no split warranted.

## Revisions

2026-10-20 diagnosis: A mounted CPU profile of unchanged production during initial expansion sampled accessibility-tree generation (`getCSSContent`, `processElement`, `toAriaNode`, visibility/style/geometry reads) in the Playwright utility world. Local installed Playwright's `InjectedScript.expect` calls `_ariaSnapshotForExpect` on each failed scalar assertion; when the element is absent it snapshots the entire document body. The growing 8,334-row workload therefore makes its own completion observer repeatedly traverse unrelated mounted rows on the renderer thread. The admission trace progresses normally; this run provides no evidence for a lost renderer timer.

The discriminating regression instruments `aria-hidden` reads on source-row wrappers in the actual isolated Playwright utility world during the pending wait. With the original assertion it fails: 47,920 unrelated source-row accessibility reads, one executed/failed, zero passed/skipped/retries (`/tmp/builder-2184/utility-regression-before.json`). The real composer still commits in 91.4 ms at 772 rows. An initial main-world probe did not intercept utility-world reads and is explicitly excluded as discriminating evidence (`regression-before.json`).

Chosen repair: poll the final row's `allTextContents()` for the exact singleton expected text, bounded by the same 120 seconds, for both initial expansion and revised reopening. This checks existence, uniqueness and full text without generating failure-time accessibility snapshots. Preserve all other workload, input, progress, read-publication, retention and anchor assertions. Keep the zero-unrelated-inspection assertion and commit-count attachment. This fixture-only change is simpler than modifying production scheduling and changes no application visuals, state, exports or failure modes. The historical macOS timeout remains failed evidence; its precise environmental trigger was not captured, so this establishes the amplification boundary rather than claiming to reproduce its unrecorded schedule.

## Validation — 2026-10-20

Linux x64, tested implementation `2306dfda13e42e380127d6cb16c1ab3c784e21b6`, containing final merged main `e83ec64fd338161099e4af37aded174eed12cdde`. Node 25.8.0, Electron 33.4.11. All source and fixture changes were committed before the final build and counted mounted runs; this evidence addition changes only the plan.

Commands (JSON reports and companion stderr under `/tmp/builder-2184/`):

```sh
python3 "$AGENTS_REPO_PATH/bin/pre-verify-check" --test-file src/renderer/src/screens/conversation/deferredThread.test.tsx
npm run build
npm run typecheck:client-tests
python3 "$AGENTS_REPO_PATH/bin/native-preparation.py" electron
npx playwright test e2e/thread-items.spec.ts --project clipboard --no-deps --grep 'defers 8333 held items and commits real composer input during unfinished expansion' --repeat-each=10 --retries=0 --reporter=json --output=/tmp/builder-2184/exact-ten-results
npx playwright test e2e/thread-items.spec.ts --project clipboard --no-deps --retries=0 --reporter=json --output=/tmp/builder-2184/full-thread-items-results
```

| Check | Executed / passed / failed / skipped | Retries |
| --- | --- | --- |
| Original-wait utility-world work regression | 1 / 0 / 1 / 0 | 0 |
| Repaired standalone workload | 1 / 1 / 0 / 0 | 0 |
| Final exact case, ten repetitions | 10 / 10 / 0 / 0 | 0 |
| Complete thread-items file | 13 / 13 / 0 / 0 | 0 |
| Deferral units through pre-verify | 5 / 5 / 0 / 0 | 0 |

Pre-verify passed all five checks; final build, client-test typecheck and Electron native preparation passed. Both mounted reports contain zero runner errors. Every launch exited normally with no teardown failures. No assertions were skipped. The exact and full-file commands overlapped on independently owned worker displays; later exact repetitions continued after the full file completed.

All ten repetitions had 516 mounted rows before input, zero final-row matches when the observer armed, zero unrelated accessibility reads while waiting, positive post-input progress, 8,334 final source rows, and passed closed-revision/reopen, read-publication and both anchor assertions. Per-repetition measurements:

| Repetition | Composer commit latency (ms) | Rows at commit | Initial expansion completion (ms) |
| --- | --- | --- | --- |
| 1 | 187.2 | 772 | 12636.3 |
| 2 | 249.8 | 1028 | 17440.9 |
| 3 | 257.0 | 1028 | 14267.5 |
| 4 | 5.4 | 772 | 7071.7 |
| 5 | 92.2 | 772 | 6548.3 |
| 6 | 17.8 | 772 | 6121.7 |
| 7 | 4.0 | 772 | 6342.7 |
| 8 | 88.1 | 772 | 6373.5 |
| 9 | 87.0 | 772 | 5820.0 |
| 10 | 18.4 | 772 | 6293.2 |

Completion intervals run from the first expanded 260-row commit through the committed 8,334-row trace entry. In the complete-file run the workload committed input in 169.4 ms at 772 rows and completed initial expansion in 12431.2 ms. Original-wait CPU profiling (`profile.json`) attributed 9175.279 of 16596.176 sampled milliseconds (55.3%) to accessibility snapshot stacks, versus 4466.943 ms in application stacks. These timings describe these runs, not a universal performance guarantee.

Retained reports: `exact-ten.json` SHA-256 `b062660165cc06281101172ff0d32d82815952a8abd7199ec2e0878092bc4487`; `full-thread-items.json` SHA-256 `238e906c3d0644be99040aca2c8c1ce07e65251d8f9274de0a359b7497373b98`. Both include composer, completion-observer, commit-progress and launch-fate attachments. The original failed bundle's `SHA256SUMS` verified completely; it remains separate from candidate evidence. `baseline.json` selected zero tests with an anchored selector and is excluded as passing evidence; the corrected baseline executed/passed one.

Existing header presentation was inspected at 1280×773 against Figma node `155:553`; captures are `/tmp/builder-2184/held-expanded-1280.png` and `held-collapsed-1280.png`. No production visuals or assets changed. The complete configured application suite, including captured clients, remains verifier/dispatcher-owned acceptance. No fresh-provider or other-OS acceptance is claimed.
