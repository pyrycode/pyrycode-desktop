# Manual test reliability review, 2026-10-20

Juhana authorised pausing tickets 2155, 2173 and 2181 for manual work and reviewing overly strict assertions. The three central workflow records were set to Halted. Existing claims, failed results and source copies were preserved.

## Findings

The smaller rollback fixture in PR 2157 preserves real protected files, failure injection after multiple bounded turns, explicit replay and fresh-owner equality. Its five-second deadline was not raised. The complete unit suite and build passed on the manually integrated candidate. PR 2157 merged after manual review.

The reply repair in PR 2182 waits for the streamed suffix to commit before activating Reply. Exact quoted source, including fences, is a user-visible requirement. These assertions remain intact.

The saved-title test used the default one-second `vi.waitFor` before testing its title observer. That preliminary wait measured real persistence speed rather than title correctness. It now awaits the writer's existing completion promise and checks the same actual saved reply. The observer's own deadline, fake-clock sequence, exact title, error handling and retirement ordering are unchanged.

The native writer's one-second event-loop and keyboard limits measure application responsiveness. The retained Linux failure contains a roughly 1.4-second database call and a matching main-loop pause. This review does not relax those limits or claim that the historical pause has been repaired.

## Controlled persistence comparison

A diagnostic copy of the original saved-title scenario delays each real mutation submission by 1200 ms. The old preliminary polling barrier fails. Awaiting the actual writer completes successfully with identical protected-reply, title and ordering assertions. This controlled delay is retained only in the diagnostic source and reports, not in the shipping test.

| Check | Passed | Failed | Unselected |
| --- | ---: | ---: | ---: |
| Delayed original | 0 | 1 | 10 |
| Delayed completion barrier | 1 | 0 | 10 |
| Complete repaired saved-title file | 11 | 0 | 0 |

## Complete unit comparison

All runs use the same isolated Mac clone, Node 25.8.0, Vitest 2.1.9, real Node SQLite and retries zero. The rollback repair is included before comparison. No timeout or semantic assertion was increased or weakened. The extra worker flags apply only to the comparison run.

| Run | Passed | Failed | Existing skips | Runner seconds |
| --- | ---: | ---: | ---: | ---: |
| Original worker policy | 9999 | 0 | 6 | 33.5 |
| Four-worker limit | 9999 | 0 | 6 | 52.8 |
| Repaired default, first | 9999 | 0 | 6 | 28.8 |
| Repaired default, second | 9999 | 0 | 6 | 28.8 |

Every one of the nine identities tracked by 2181 executed and passed in all four complete runs. Process sampling saw peaks of eight and three child workers in the comparison pair. Sampling is not an authoritative configured worker count. The four-worker comparison did not reproduce the failures or improve total runtime. Global worker configuration remains unchanged. These results do not establish the cause of the historical nine-test failure.

The first attempted baseline had incomplete copied dependencies and the sandbox-specific mocked launcher failure. It is invalid comparison evidence. Fresh locked installation and a real SQLite open/close check preceded every valid comparison.

## Evidence

Raw reports, commands, execution samples and controlled source copies are under `/private/tmp/desktop-manual-evidence-20261020/`. A durable vault attachment is created at handoff. The original reports remain separate from the later passing comparisons. Browser acceptance is recorded below after execution.

## Complete application execution

Clean candidate 4cac8bd7c0580e8f23684376eb2f9c099856aa2c compiled the normal application profile. The complete default application run used four workers and retries zero. It executed 531 cases: 529 passed, two failed, two existing skips, zero report-level errors. All six reply scenarios and the native storage prerequisite passed. Native storage used real OS protection, durably saved and exactly reopened all 8333 items, and completed in 12.35 seconds. Main-loop maximum gap was 51.6 ms, renderer gap 22.4 ms and keyboard commits 22.5/30.8/39.2 ms. All original responsiveness limits remain.

The failures were the stable pending-read callback scenario already owned by 2186 and the recorded effort-default scenario after relaunch. One exact unchanged-source comparison selected only those two cases: both passed, zero failed/skipped/retried. The complete result remains failed; the selected comparison is not a replacement full-suite pass. The effort occurrence matched 36 requests, emitted 147 frames and left 60 requests. Its final diagnostic read found a closed page and masked the primary failure, so the cause remains unknown. Closed 1949 and 2069 addressed different assertions in that same scenario.

PR 2182 merged after manual judgment with this explicit failure classification. No passing automated stage result was fabricated for the earlier interrupted builder. The historical Linux database pause remains unexplained. The separate original failure and all controlled comparisons remain available in the evidence attachment.
