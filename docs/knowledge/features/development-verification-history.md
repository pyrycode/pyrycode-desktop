# History admission and protected-restoration verification

Part of [Development verification](development-verification.md). History coverage
and display retention require separate assertions; a green receipt-only repeat
cannot prove that a split reply or orphan tool result survives restoration.

### Served-page persistence verification

Parser/store regressions in `inboundMessage`, `historyPageBridge`, `chatHistory`,
`chatHistoryWriter`, `chatHistoryStore` and `finishedAgentHistory` cover skipped ids,
admission, strict metadata, protected restoration/allocation, host lifetimes and
immutable finish evidence.

The [final verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1852#issuecomment-6035527996)
at `ea4d7d35` on 2026-10-07 records units: 9,329 executed/passed, 0 failed,
3 skipped; no per-test unit counts supplied. Dispatcher gate 6
(`npx playwright test --reporter=json`): 332 executed/passed, 0 failed, 4 skipped.
It confirms these named browser cases were present, executed and passed:

- `a correlated repeated served page contributes assistant and tool rows only once`
- `receipt saturation still saves a repeated page and later live content across fresh relaunches`
- `records received content, drains buffered quit, and reads locally after relaunch`

Scoped counts: history-walk 3 executed/passed, 0 failed/skipped; recording
8 executed/passed, 0 failed, 1 window-close platform skip. Assistant/tool counts defeat
user-message-only suppression; asking from the updated cursor proves repeat
settlement before absence checks. Cancelling an echo retains content/keys with
advanced allocation; whole-snapshot equality would stop quit/relaunch proof early.
This is fake transport; no live-Claude run was required or performed.

For repeated pages that change only receipt metadata, restored rows and enabled
Send cannot prove reply settlement, and thread focus creates no history demand.
Observe the host/conversation/cursor-specific `historyPageReceived`, then poll a
small observation of successful real protected replacement before reading the
whole record once for exact equality. Retain immediate fake replies, the 500 × 200 saturated
receipts, eviction of `page-0` for `repeat`, unchanged oldest-end coverage, one
assistant with its original identity, later live content with the next allocated
key, and whole-snapshot equality after a third fresh Electron launch. See the
[browser lifecycle contract](chat-history-testing.md#browser-persistence-and-lifecycle).

The [confirmed synchronization cause](https://github.com/pyrycode/pyrycode-desktop/issues/1918#issuecomment-6097546760)
distinguishes missing receipt observation from an unproven product defect. The
original gate at `f1ada1b9df` recorded 377 executed, 376 passed, 1 failed, 3 skipped;
the saturation test failed when its five-second save predicate still saw the seed
(16,870 ms overall). Its focused rerun recorded 1 executed/passed, 0 failed/skipped
(9,360 ms). Original log references are in the
[refinement evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1918#issuecomment-6097325467).
Those logs do not distinguish request/receipt scheduling delay from save latency.
The controlled held-reply diagnostic confirmed one newest request and both old UI
readiness checks while the protected record still equaled the saturated seed:
1 executed, 1 deliberately failed, 0 skipped/retried. Releasing that correlated
reply and awaiting its receipt recorded 1 executed/passed, 0 failed/skipped/retried.
This establishes the missing receipt boundary before the buffered metadata save;
holding the reply was diagnostic only.

The [builder's counted validation](https://github.com/pyrycode/pyrycode-desktop/issues/1918#issuecomment-6097574390)
at `e94e2398` records the exact saturation test above with
`--repeat-each=10 --workers=1 --retries=0`: 10 consecutive executions, 10 passed,
0 failed/skipped/retried. The complete `chat-history-recording.spec.ts` run with
`--workers=1 --retries=0` recorded 10 executed/passed, 0 failed/skipped/retried,
including the named saturation test. Raw builder diagnostic and repetition logs
were unavailable to the verifier; these counts rely on the recorded ticket evidence.
The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1921#issuecomment-6099383720)
and supplied dispatcher per-test report independently confirm the saturation test
was present, executed and passed in gate 6 on 2026-10-10 at
`bad47b9e00675dfda34db438ca7baa48bb072a0a`: 377 executed/passed, 0 failed,
3 skipped. The verdict confirms the complete recording spec contributed
10 executed/passed, 0 failed/skipped, every retry 0. No production behavior changed;
no visual or live-Claude check applied to this fake-transport synchronization fix.

The [later recovered gate excerpt](https://github.com/pyrycode/pyrycode-desktop/issues/1978#issuecomment-6186764616)
at `3d527863366852cdfa49d945daa192d16df380ce` identifies second-launch repeated-page
snapshot equality timing out with the old seed: 395 executed, 394 passed, 1 failed,
3 skipped; named rerun 1 executed/passed, 0 failed/skipped. That excerpt alone
does not establish delayed versus skipped replacement. The separate
[controlled diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1978#issuecomment-6188161084),
with [accounting corrected by review](https://github.com/pyrycode/pyrycode-desktop/pull/1997#issuecomment-6188310409),
recorded 32 unchanged historical executions, 16 passed, 16 failed, 0 skipped/retried:
15 later-live saved-text failures and one repeated-page equality failure.
Instrumented runs recorded 16 executed, 11 passed, 5 failed, 0 skipped/retried.
Their traces establish an old large read racing a later successful two-item save;
a diagnostic read then retained keys `[-8, 42]`, next key `43`, 500 receipts and
cursor `repeat`. This proves an observation race in those later-live failures,
without proving the original occurrence's timing or a product persistence defect.
The earlier receipt barrier remained intact.

Poll small successful-save counts separately from typed receipt, then compare the
complete record; repeatedly transferring 100,000 receipt ids can spend the deadline
returning a stale snapshot. The corrected held-save control recorded 1 executed,
0 passed, 1 intentionally failed, 0 skipped/retried: receipt passed while successful
counts stayed `[1]` and storage retained only the assistant. Releasing the actual
write saved both rows. This defeats a receipt-only substitute for protected-save
completion. See the [implemented observation contract](chat-history-testing.md#browser-persistence-and-lifecycle).

At implementation `b6059c79033045f1822941a218664a0674fed75e`, the named saturation
test passed 20 consecutive executions, followed by the complete recording spec:
20 executed/passed, then 10 executed/passed; both 0 failed/skipped/retried, no skip
reasons. Eight-worker repaired contention recorded 16 executed/passed,
0 failed/skipped/retried. Reports under `/tmp/builder-1978/` are
`final-named-20.json`, `final-spec.json`, `final-contention.json` and
`held-save-control-final.json`, each with matching `.stderr` and `-results/` artifacts.
The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1997#issuecomment-6188310409)
and supplied dispatcher per-test report confirm the named test was present,
executed and passed in gate 6 at `f7866f3e7331b5ae99fa3412ba3ecb1131eb2baa`
on 2026-10-15: 405 executed/passed, 0 failed, 3 skipped, zero retries. Skips were
two macOS-only badge cases and macOS last-window reopening. No production change
or live-Claude proof was required. The [plan](../../specs/architecture/1978-saturated-history-save-observation.md)
records commands and separates the recovered excerpt from instrumented evidence.

### Certified checkpoint inspection verification

The restore-overlap case in [`thread-activation.spec.ts`](../../../e2e/thread-activation.spec.ts),
`restore overlapping live content retains complete progress across an interrupted catch-up and epoch replacement`,
separates terminal receipt/admission, in-memory completion and protected write acknowledgement
from the final full saved read. The [acknowledgement-first inspection contract](e2e-harness-context-recovery.md#certified-checkpoint-inspection)
prevents an expensive pre-write read from consuming the assertion budget. This changes
scenario synchronization only; production certification, storage, protocol and API behavior
are unchanged.

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2133#issuecomment-6262520577)
records Linux x64 evidence on 2026-10-19, implementation `ed0ea8f7`, reviewed head
`ba208a6d1f01d201b6a615a950568328b501023b`. In the traced original ten-run comparison,
all ten cases received the correlated terminal, committed the batch in memory and
acknowledged the exact protected 20→25 completion write, including the six failed
checkpoint assertions. A timed sample's initial full read returned 20 after 2318 ms;
commitment followed one millisecond later, write acknowledgement four milliseconds after
commitment, and a second 2355 ms read returned 25. Thus those failures demonstrate
inspection ordering/contention rather than lost certification or a failed protected write.

The expensive-reader regression fails the extracted original polling sequence because
it admits a full read before acknowledgement, then passes with the repaired ordering.
Its six helper cases also retain pending/unavailable inspection, actual stale/missing
full-read results and fatal inspection errors. A passing unchanged rerun alone would
not establish this repair.

Retained builder reports under `/tmp/builder-2122/`:

| Check | Executed / passed / failed / skipped | Report |
| --- | --- | --- |
| Traced original named case, ten repetitions | 10 / 4 / 6 / 0 | `traced-native-before.json` |
| Timed original ordering, diagnostic only | 3 / 3 / 0 / 0 | `timed-before.json` |
| Deterministic original polling sequence | 1 / 0 / 1 / 0 | `controlled-before-clean.log` |
| Repaired deterministic regression | 1 / 1 / 0 / 0 | `controlled-after.log` |
| Final checkpoint-helper and held-read units | 20 / 20 / 0 / 0 | `focused-final.log` |
| Existing runtime/coordinator/item-store/writer/held-read units | 111 / 111 / 0 / 0 | `owner-baseline.log` |
| Repaired named case, ten repetitions | 10 / 10 / 0 / 0 | `after-ten.json` |
| Complete thread-activation spec, sequential native preparation | 20 / 20 / 0 / 0 | `spec-sequential-final.json` |

Both ten-run comparisons used the retained gate configuration, with unchanged
`clipboard`/`parallel` projects and the named case in `parallel`:

```bash
npx playwright test e2e/thread-activation.spec.ts --grep 'restore overlapping live content retains complete progress across an interrupted catch-up and epoch replacement$' --repeat-each 10 --workers 3 --retries 0 --reporter=json
npx playwright test e2e/thread-activation.spec.ts --workers 3 --retries 0 --reporter=json
```

The repaired ten-run report has three configured/actual concurrent workers (slots 0/1/2);
ten worker process indices reflect repeat scheduling. The complete spec has three
configured/one actual worker because the file remains serial. The named case is present
and passed in both, with no retries, skips, flaky results or top-level errors. Matching
`.stderr` files and setup/launch attachments remain with the reports. The ten-run report
has twenty clean launch exits and ten held-read setups, each one installation, one
inspection and zero context losses; the complete spec has twenty-six clean exits and
one identical setup, without teardown failures.

Every repaired trace records generation 2, wire request 7, correlated terminal version 25,
in-memory batch commitment, acknowledged exact completion `{ fromVersion: 20, version: 25 }`,
then full protected read checkpoint 25. The mounted case preserves the newer live revision,
one overlapping item and saved-only row; bounded opening shows 200 shown items plus the active
dependency and excludes the older row. Catch-up starts at 20; the full durable read must
return 25 before reconnect, and both interrupted version-30 replies reconnect from 25.
Replacement epoch content commits before late retired-content exclusions, with no legacy
history/replay request. All host/conversation, request, epoch, generation, revision and
completion-certificate fences remain intact.

The completed dispatcher application run, `npx playwright test --reporter=json`, records
**506 executed, 505 passed, 1 failed, 5 skipped**, three configured/actual workers, zero
retries. The named overlap case is present and passed on its first attempt, with the exact
write/read trace, confirmed held-read setup and two clean launch exits. The supplied gate
report also explicitly confirms passing captured-client cases
`daemon-built thread streams, places an agent, reconnects, resets and reopens saved items`
and `a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`.
These are replay results, not fresh live-daemon/provider evidence. The supplied unit gate
records **9,664 executed/passed, 0 failed, 3 skipped**.

The accepted verdict is PASS under the dispatcher's accepted-flake policy: the unrelated
native-writer failure is tracked in [#2125](https://github.com/pyrycode/pyrycode-desktop/issues/2125),
and its dispatcher rerun records **3 executed/passed, 0 failed/skipped**, including that
failed test. The original complete run remains failed; no overall verifier gate pass is
recorded in the supplied gate report. Reports are `verifier-gate_#2122_7.log` and
`2026-10-19T07-55-51-485Z_verifier-gate-rerun_#2122.log` under the agents logs directory.

Earlier invalid native-preparation attempts remain failures: `baseline.json` executed zero
because sandbox Xvfb socket creation failed; `baseline-native.json` failed ten launches
before Electron installation completed; `traced-before.json` failed ten initial storage
predicates before SQLite preparation. `spec-final.json` recorded **20 executed, 13 passed,
7 failed, 0 skipped** when Node ABI rebuilding overlapped Electron. Acceptance uses the
later sequentially prepared complete spec, not reclassification of those failures.
Complete Node preparation before `npm run rebuild:electron` and Electron execution;
the [native storage prerequisite](development-verification-replay-native-storage.md#replay-native-storage-prerequisite)
applies independently of inspection ordering.

The [plan](../../specs/architecture/2122-certified-checkpoint-overlap.md#validation-evidence)
retains exact revision/command correspondence, preparation/build logs and earlier attempts.
These are recorded results, not documentation-stage executions. Production-path targeted
replay was conditional on production changes and was not required; no live-provider run
or visual change was required or claimed. macOS is outside this Linux ticket's scope.

### Known-gap recovery verification

`historyGaps.test.ts` exercises admission, one-entry/multi-page and older holes,
newest high-water overlap, adjacency, first opening, skipped ids, saved-position
fallback, covered/empty steps and independent held `atStart`. It also covers
strict gap parsing/allowlisting, fresh restoration, receipt expiry and structural
host/removal/eviction lifetimes. The writer's metadata-only regression saves and
restores cursor progress without pending/failure state. Static `Timeline` tests
place a marker inside joined text before its whole bubble and check count-free
idle/loading/failure copy and Retry gates; they do not exercise input or effects.

Fixtures must separate served envelope ids from command ids and drawable rows.
Sparse synthetic ids can create real gaps once coverage is held, diverting reader
input from an intended oldest-end ask. Declare consecutive envelope coverage,
including undrawable entries, when no gap is intended, and explicitly allow
optional `gaps: []` in protected snapshot expectations. Demand tests must fail one
of two gaps and then ask the other, also after newest/oldest and nonretryable
failures: a global failure guard would pass a single-gap Retry test while blocking
healthy boundaries.

[`history-gaps.spec.ts`](../../../e2e/history-gaps.spec.ts) →
`known gaps require fresh input, retain failure/resume, anchor and expansion through protected restoration`
checks chronological marker placement, overlay visibility, thread-focus/trusted
input, pending-input exclusion, no settlement cascade, loading/failure/Retry,
expanded-tool retention and content-anchor geometry. It polls the protected gap
cursor before reloading the renderer, then verifies a newest overlap leaves the
restored walk intact and fresh input uses that cursor. This is a fresh renderer
over protected storage; full Electron exit is established by the live proof below.
Both fresh-input sites establish focused, settled geometry and marker
intersection with the reading area between measured top/input chrome before one ArrowUp, while setup
adds no requests. See [the local readiness contract](chat-history-testing-contracts.md#demand-and-snapshot-contracts).

The [controlled cause observation](https://github.com/pyrycode/pyrycode-desktop/issues/1932#issuecomment-6102627361)
records the original failure at `c4420495fe` in `verifier-gate_#1904_6.log`:
380 executed, 379 passed, 1 failed, 4 skipped, 4 actual workers, attempt zero.
The named test received two requests instead of three. Its selected rerun in
`2026-10-10T21-36-32-883Z_verifier-gate-rerun_#1904.log` recorded 1 executed/passed,
0 failed/skipped, 1 actual worker, attempt zero. Neither log captured pre-key
geometry, so the exact reflow in that occurrence cannot be recovered.

Before repair, the controlled diagnostic returned to the bottom with End, settled
native movement, then expanded the existing tool and parked the marker in the
same renderer task. Pending layout/resize pinning overwrote the park. Three trials
recorded 3 executed, 0 passed, 3 failed, 0 skipped at 3 actual workers, retries zero.
Two initial samples intersected at 351–395px; at trusted ArrowUp capture the focused
thread's marker was at −968–−924px against reading bounds 105–436px, with scrollTop
1319 and content height 1879. This establishes invalidated test positioning rather
than rejection of eligible input. Metadata focus did not reproduce this fixture,
whose user rows have no metadata. The same controlled expansion after repair
recorded 3 executed/passed, 0 failed/skipped, 3 actual workers, retries zero.
Diagnostic logs are `/tmp/builder-1932/{expansion,control-repaired}.log`; an
uncontrolled 20/20 baseline pass is not causal evidence.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1934#issuecomment-6103292311)
confirms the named test above executed and passed in all 20 repetitions:
20 executed, 20 passed, 0 failed, 0 skipped, 3 actual workers, retries zero,
all attempt zero (`/tmp/builder-1932/repeats.log`). The builder's final uninterrupted
default suite recorded 380 executed, 380 passed, 0 failed, 4 skipped at the normal
4 actual workers, retries zero (`stable-full-suite.log`). Named-test result
separately: 1 executed/passed, 0 failed/skipped, attempt zero.

The earlier builder full run remained red: 380 executed, 378 passed, 2 failed,
4 skipped, 4 actual workers, retries zero; the named test passed. Two Welcome
setup timeouts began at 22:02:44 while a concurrent rebuild rewrote renderer
assets at 22:02:45. Both scenarios passed in the later uninterrupted run. Keep
builds sequential with Electron suites because launches read those assets.

The supplied dispatcher per-test report and verdict independently confirm the
named test was present, executed and passed in verifier gate 6 on 2026-10-10 at
`4a500e81e55b1c6d72c2490b9b9399b53b82715b`: 382 executed, 382 passed, 0 failed,
3 skipped. The verdict records 4 actual workers, retries zero, and the named
test separately as 1 executed/passed, 0 failed/skipped, attempt zero. No renderer
or presentation change ships; live-Claude and visual-design checks did not apply
to this fake-transport synchronization repair.

The [original feature verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1881#issuecomment-6048495036)
and supplied dispatcher report record gate 6 at `609a8ba87db3520fc306b07daa626b18a598856d`
on 2026-10-07: 350 executed, 350 passed, 0 failed, 4 skipped. The verdict confirms
the named fake gap test above was present, executed and passed, along with all
eight repaired persistence/Retry/tool/Agent/status regressions. Units/build passed;
no per-test unit artifact was supplied, so source coverage is not an individual
unit-result claim. Visual review accepted idle/failure at 800×600 and completion
at 1280×800 against Figma `132:4171`; loading status was verified by interaction,
without a separate loading capture.

`legacyHistoryGaps.test.ts` extends this path with display-only restoration,
held/newest `atStart`, covered walks, fresh backwards completion, unique identity
overlap versus duplicate messages/ambiguous timestamps, isolated refusal, usable
newest fallback, absent/refused-origin acquisition and repeated refusal without
cascades. It also covers strict metadata bounds, host/conversation validation,
foreign-host refusal and shared offline/pending gates. Writer cases save unchanged
rows with refusal evidence under received or explicitly restored ownership, and
reject evidence-only renderer changes that would establish a new owner.

[`history-gaps.spec.ts`](../../../e2e/history-gaps.spec.ts) →
`legacy and refused gap evidence survives full Electron relaunch and needs fresh reader steps`
projects an old display-only snapshot through validated protected IPC, closes
Electron and reopens the same profile. Newest admission leaves the legacy marker
despite held oldest completion. Refusal retains rows/expanded tools, shows no
Retry and saves its rejected cursor. One fresh focused ArrowUp acquires a newest
page; returning the refused cursor cannot trigger a walk. Another full close/
relaunch retains the unknown boundary, refusal evidence and independent oldest
coverage, while the marker returns idle. A usable acquired origin still needs
another reader step. Walking preserves anchor geometry and expansion; tool-only
identity overlap closes the boundary without operator overlap or fresh `atStart`.
The test polls the saved resolved contribution before a final full restart and
checks keys, display evidence and coverage after reopening. Expansion is reestablished
after relaunch; it is preserved during recovery, not persisted as UI state.

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1882#issuecomment-6049290879)
and dispatcher gate report record gate 6 on 2026-10-07 at
`5fa8fb6ae46fcd566b5400b5d1ddc2d6abfc8b27`: 351 executed, 351 passed, 0 failed,
4 skipped. The verdict confirms both named gap scenarios above were present,
executed and passed: `history-gaps.spec.ts` contributed 2 executed/passed,
0 failed/skipped. The complete recording spec contributed 9 executed/passed,
0 failed, 1 platform skip; the supplied per-test gate report explicitly lists
`receipt saturation still saves a repeated page and later live content across fresh relaunches`
as executed and passed. Its additive `newestCursor: 'repeat'` expectation preserves
the independent oldest coverage, receipts, row identities and later-live-save proof.
Units recorded 9,571 executed/passed, 0 failed, 3 skipped; the verdict reports
21 legacy-gap and 39 writer cases passed. These are file/suite counts, not
individual unit-result artifacts. Visual review compared Figma `132:4171` with
legacy idle at 1280×800 and refusal at 800×600; separate loading and opposite-width
captures were not supplied. Synthetic transport satisfies this extension; no new
live-Claude proof was required or performed.

[`real-daemon-history-on-open.spec.ts`](../../../e2e/real-daemon-history-on-open.spec.ts) →
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
establishes a protected served/display baseline, awaits Electron process exit,
posts 205 entries in `relaunch(whileClosed)`, then reopens the same protected
profile. Exactly one newest ask exposes the gap. Programmatic positioning sends
nothing; each fresh focused ArrowUp adds one ask, and settlement adds none. Final
transcript assertions require the baseline followed by every post in order with
no duplicate. `spawnClaude: false` isolates real daemon storage/transport through
the local test relay; this is not a Claude-turn or production-relay proof.

Its local `asks` reader uses the shared `readMainProcess` helper in a five-second
availability poll. Only the recognized inspection-context error yields
`NOT_YET_AVAILABLE`; the sentinel satisfies no assertion and every caller receives
a successful cursor-array read. Listener installation, posts, keys, geometry and
renderer recovery are unchanged. See [the observation contract](chat-history-testing-contracts.md#demand-and-snapshot-contracts)
and [read-only recovery](e2e-harness-context-recovery.md#tolerating-a-transient-inspection-context-loss-on-reads).

The [fresh diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1947#issuecomment-6165420879)
at plan-only `f00774c4194aefeccff8f1d47a71cecd14fdfcdf` over main
`c75bc69d46d61495242ac966a6f180b2a10cdcad` recorded the unchanged named test
failing in `asks` immediately after ArrowUp: inspection context destruction before
any count returned (1 executed, 0 passed, 1 failed, 0 skipped, retry 0). Passing
visible/hidden reruns did not diagnose the cause. Controlled one-shot injection
after successfully reading two real requests failed the original observer while
Electron was running (1 executed, 0 passed, 1 failed, 0 skipped/retried); the same
fault with recovery passed every original assertion (1 executed, 1 passed,
0 failed/skipped/retried). Injection did not ship. No invalid park or rejected
eligible input was observed; the upstream inspection trigger and absent original
October 14 reports' failing assertion remain unproven.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1948#issuecomment-6165945171)
confirms that exact named live test passed in five serial focused runs at
`fd6598e05c3f099bbb93148ae21af8b9a69a4565`: 5 executed, 5 passed, 0 failed,
0 skipped, one worker, retries zero, each attempt zero. Each run explicitly used
`/usr/local/bin/pyry`, version 0.39.0, Go module `github.com/pyrycode/pyrycode`
v0.39.0; binary SHA-256
`a76a703551edf81a42e5b0b1112bf453ed52f08fab19c7f7cfee6ee296b2b3c8`.
The supplied dispatcher per-test report for `2026-10-14T10-10-23-470Z`
independently records the exact test executing and passing once in 5.4s on that
feature revision integrated with main `d31ee247313b`: 27 executed, 26 passed,
1 failed, 1 skipped overall; this named test 1 executed/passed, 0 failed/skipped,
attempt 1. The configured daemon was `/opt/pyry-test-daemon/pyry`, release 0.39.0
from annotations on 9 of 28 tests; no source revision or binary digest was supplied
for that executable. The distinct effort-default failure passed a same-tree
rerun; the history test passed in the original full run. See
[current live gate state](live-e2e-runbook.md#current-real-claude-gate-state).

The supplied per-test dispatcher report for run `2026-10-07T22-53-47-094Z` confirms
that exact live test was present, executed and passed once in 6.2 s. Run counts:
26 executed, 26 passed, 0 failed, 1 skipped; named-test counts: 1 executed,
1 passed, 0 failed, 0 skipped. The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1879#issuecomment-6048554295)
records the same counts at `609a8ba87db3`, integrated with main `bb34dbf6d3f7`.
See [current live gate state](live-e2e-runbook.md#current-real-claude-gate-state).
Documentation records this evidence and runs only the docs guard.

## Contribution joins and held-row regressions

`historyContributions.test.ts` exercises the production bridge/holder admission
path, live dispatch and `parseChatHistorySnapshot` restoration into fresh stores.
Coverage includes partial/repeated overlap, durable order, split text, intervening
row/parent barriers, orphan results and turn-correlated denials, both live timestamp
and operator message-id arrival orders, ambiguous timestamp keys, legacy rows and
receipt-only data, receipt expiry, capacity compaction/retirement, host replacement
and eviction. Snapshot checks reject unsafe ids, overlapping ranges, inconsistent
row references and both saved patch source mismatches. A valid restored denial
must still allow a later live result with the same timestamp.

The table-driven held-row cases run before and after validated fresh restoration,
then repeat pages and validate another round trip. Assert keys, relative held-row
order and exact object survival where content is unchanged, alongside pending
compaction, completed manual/token details, waiting-echo finish associations,
delivery settlement, arrival order, stall/thinking/failure feedback and tool
progress/results. Specifically preserve the tool ID 2 → unrepresented live
assistant → overlapping tool/operator ID 4 reproduction as tool, operator, live
assistant. Numeric allocation order and reconstructed contribution objects cannot
stand in for chronological boundaries or held objects.

Subagent overlap cases dispatch live calls/text with timestamp join keys, admit
the newest-first partial pages through `prependHistoryFor`, optionally restore
into a fresh store through validated snapshot admission, then replay complete
pages. Pending and completed calls have retained-call controls: a suppressed
nonempty-parent call must also let `hello ` join held `world` as
`[toolCall, 'hello world']`. Assert the surviving assistant key and first timestamp,
the exact tool object and pending progress/existing result, and unchanged content,
keys and objects on replay. A reducer-only test misses the suppression branch in
`reconcileHistory`, which shares `isSubagentToolCall` with live lookback.

Barrier cases place a main tool with absent/empty parent, attributed subagent text,
a different turn or an operator row beside the suppressed call. Both restoration
variants must keep texts separate and held keys/order/objects intact. An operator
row absent from display contributions must still block joining and preserve its
live echo/send state. These cases guard against treating transparency of the
subagent call as permission to cross every intervening row.

`chatHistoryWriter.test.ts` checks saving when only display metadata changes;
`chatHistoryStore.test.ts` preserves orphan denial correlation through actual
protected writes and fresh service reads. `historyPageBridge` and
`finishedAgentHistory` cover skipped-entry receipts, original-page qualification,
reserved boundaries and immutable finish evidence even when ordinary rows are
suppressed. Unit snapshot reconstruction alone is not the protected persistence
or mounted interaction proof.

Legacy tool-overlap regressions must validate the recovered snapshot, save it
through the writer/protected store and restore a fresh timeline; an in-memory
resolved marker alone misses invalid contribution metadata. The unique held/page
tool identity retains a `row` contribution with the held key, with keyable and
unkeyable timestamps covered. Pending/completed live-tool suffix controls keep
one tool, its original key, completed object and result patch target while the
legacy boundary remains unresolved, then repeat the page after validated fresh
restoration. The mounted tool-only overlap and full-restart evidence is counted
in [gap recovery verification](#known-gap-recovery-verification) above.

The fake-transport cases extend the existing presentation:

- [`history-walk.spec.ts`](../../../e2e/history-walk.spec.ts):
  `partially overlapping and repeated served pages contribute assistant and tool rows once`.
  Check assistant/tool counts and settlement from the new opaque cursor.
- [`thread-scroll-pin.spec.ts`](../../../e2e/thread-scroll-pin.spec.ts):
  `a page walked back above the reader leaves them looking at the same row`.
  Older fixture ids must actually be lower than the opening page's ids; reversed
  fixture chronology tests insertion below the opening row instead of a prepend.
- [`chat-history-recording.spec.ts`](../../../e2e/chat-history-recording.spec.ts):
  `protected restoration joins partial pages while retaining an expanded tool and content anchor`.
  Save contributions, close and relaunch using the same protected user-data directory,
  then open the saved chat without an automatic history request. Expand the surviving
  tool after restoration, retain its DOM handle, and identify the reader anchor by
  `loaded history 105` content before admitting the partial page. Verify both nodes
  remain connected, expansion/result content survives, anchor geometry is unchanged,
  joined text appears once, missing/orphan results save, and repeating the page settles
  its cursor/start without duplication. Expansion and scroll position are established
  after relaunch; the test does not require either to persist on disk.

## Counted contribution-join evidence

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1858#issuecomment-6044815524)
records the 2026-10-07 gate on `bc5418af14a8aa26725b3be4be3998fe86a8dd7d`:
units 9,469 executed/passed, 0 failed, 3 skipped; `historyContributions` contributed
84 executed/passed. Per-test unit artifacts were not supplied, so these are suite
and file counts rather than individual unit-result claims.

The configured fake-transport gate, `npx playwright test --reporter=json`, executed
341 tests: 341 passed, 0 failed, 4 skipped. The verdict confirms the three scoped
specs contributed 23 executed/passed, 0 failed, 1 recording platform skip:
history-walk 3 executed/passed, 0 failed/skipped; thread-scroll-pin 11
executed/passed, 0 failed/skipped; chat-history-recording 9 executed/passed,
0 failed, 1 skipped. Its inspected JSON report confirms the protected mounted
restoration case above was present, executed once and passed (1 executed/passed,
0 failed/skipped), preserving tool expansion, DOM identity and the content anchor.
The [earlier inspected named result](https://github.com/pyrycode/pyrycode-desktop/pull/1858#issuecomment-6037536453)
also identifies that exact test title and its assertions.

This evidence covers the selected same-host mounted scenario. Suppressed
live-subagent overlap has separate production-store evidence below. No real-Claude
acceptance or Figma capture was required or performed for the #1851 history joins.

### Suppressed subagent overlap evidence

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1877#issuecomment-6045674463)
records the 2026-10-07 gate at `4d6b76c244c90da9ac2fb31eb3849cf7c952c280`:
units 9,489 executed/passed, 0 failed, 3 skipped. It confirms all 104 contribution
tests executed and passed, including 20 added retained/suppressed-call, restoration,
identity and barrier scenarios described above. No individual unit-result artifact
was supplied; these are file/suite counts and source coverage, not per-title results.

Dispatcher gate 6, `npx playwright test --reporter=json`, recorded 345
executed/passed, 0 failed, 4 skipped. Neither the issue nor plan names a test in
that run; the total supplies no separate interactive overlap proof. Static
production-admission captures reviewed at 1280×800 and 800×600 show a separate
tool row followed by one assistant bubble against Figma Message area `132:4171`.
Those captures establish presentation; store regressions establish reconciliation
and identity. No real-Claude run or interactive reproduction was performed or
required for this renderer-store fix.
