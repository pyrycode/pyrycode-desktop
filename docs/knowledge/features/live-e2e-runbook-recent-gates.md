# Live e2e runbook — recent gate evidence

Part of the [live runbook](live-e2e-runbook.md). These September–October 2026 records
preserve named results and executable provenance; the
[current gate state](live-e2e-runbook.md#current-real-claude-gate-state) stays in the parent.
For earlier runs, see [the earlier history](live-e2e-runbook-history.md).

## #1879, 2026-10-07

**Previous verified run: #1879, 2026-10-07 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1879#issuecomment-6048554295)
records `feature/1879` at `609a8ba87db3`, integrated with main `bb34dbf6d3f7`, in
run `2026-10-07T22-53-47-094Z`. The configured command installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`;
exit 0 in 4m 14s, no flaky tests. The sole skip is
`real claude picks up a saved channel system prompt at Reset session`, with no
reason recorded. The dispatcher removed `needs-real-claude` and advanced the ticket.

The supplied per-test gate report confirms `real-daemon-history-on-open.spec.ts` →
`a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed`
was present, executed and passed on its first attempt in 6.2 s
(1 executed, 1 passed, 0 failed, 0 skipped). It establishes a served saved baseline,
fully exits Electron, writes 205 channel posts while closed and reopens the same
protected profile. One newest ask exposes a gap; programmatic positioning creates
no demand, and each fresh focused reader step asks once. Recovery removes the
marker and displays all posts after the baseline in order without duplicates.

This named proof uses `spawnClaude: false`, real daemon storage/transport and the
local test relay. Suite annotations identify daemon `0.37.0` on 8 of 27 tests and
`PYRY_BIN=/usr/local/bin/pyry`; the history test has no daemon-revision annotation.
The counted report supplies named acceptance beyond a green exit or suite total.
Documentation did not run tests or access dispatcher logs. See
[known-gap verification](development-verification-history.md#known-gap-recovery-verification)
for protected-restoration coverage and fixture traps.

## #1815, 2026-10-07

**Previous verified run: #1815, 2026-10-07 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1815#issuecomment-6047160427)
records `feature/1815` at `b4eee350bb4d`, integrated with main `66ce9425cd88` in run
`2026-10-07T21-21-05-639Z`. The configured command installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`;
exit 0, 4m 22s. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`, with no
reason recorded. The dispatcher removed `needs-real-claude` and advanced the ticket.

The dispatcher's per-test gate report lists the required
`real-daemon-history-on-open.spec.ts` →
`a real daemon refreshes saved history with a channel post written while Electron is closed`
as present, executed and passed on its first attempt in this run (3.1 s;
1 executed, 1 passed, 0 failed, 0 skipped). The spec saves a baseline with served/
display evidence, fully exits Electron, writes a unique channel post in the
fixture's awaited while-closed callback, and relaunches the same protected profile.
Opening shows exactly one matching bubble and one newest ask without upward input;
the marker was absent from the saved baseline. This is real daemon storage and
transport through the local test relay with `spawnClaude: false`, not a Claude-turn
or production-relay proof. Suite annotations report daemon `0.37.0` on 8 of 27 tests;
the history test has no daemon-revision annotation.

Earlier builder evidence at `490ba22e` (1 executed, 1 passed, 0 failed, 0 skipped)
does not substitute for this dispatcher acceptance at the reviewed head. Evidence
above comes from the supplied counted gate report and linked PASS comment;
documentation did not read dispatcher logs or run live tests. See
[fake/unit evidence and input-gate trap](development-verification.md#what-each-test-tier-proves).

## #1818, 2026-10-07

**Previous verified run: #1818, 2026-10-07 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1818#issuecomment-6029664454)
records `feature/1818` at `5d1b88adaa`, integrated with main `59efab093c` in run
`2026-10-07T02-23-21-880Z`. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`, with no reason recorded.
The [supplemental named result](https://github.com/pyrycode/pyrycode-desktop/issues/1818#issuecomment-6029885598)
confirms `e2e/real-claude-permission-modal.spec.ts` →
`real claude session checkbox grants repeated Bash use only in the current session`
was present, executed and passed on its first attempt in this same run, in 37.2 s
(1 executed, 1 passed, 0 failed, 0 skipped). Every test records `daemon-revision: 0.37.0`.

The inline card retains the live spec's repeated Bash effect without renewed permission in the
same session, then renewed permission before any effect in a distinct session in the same workspace.
Card disappearance alone is insufficient. The configured gate installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather than the
requested `npm run e2e:real:gate`. Counted execution and this named pass satisfy the execution
requirement despite the command mismatch. The dispatcher removed `needs-real-claude` and advanced
the ticket. Evidence comes from the linked comments; documentation did not read dispatcher logs or
run live tests. See [inline permission verification](development-verification-test-tiers.md#inline-permission-verification)
for fake interaction and visual evidence. The live results concern the local test relay, not the
production relay.

## #1817, 2026-10-06

**Previous verified run: #1817, 2026-10-06 — 26 executed, 26 passed, 0 failed, 1 skipped.** The
[dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1817#issuecomment-6025928858)
records `feature/1817` at `1cec087404`, integrated with main `04e1cbd95b` in run
`2026-10-06T21-33-26-050Z`. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`, with no reason recorded.
The [named live results](https://github.com/pyrycode/pyrycode-desktop/issues/1817#issuecomment-6026040792)
confirm all three required consumers were present, executed and passed on the first attempt in
this same run, with `daemon-revision: 0.37.0`:

| Migrated spec | Named scenario | Recorded result |
| --- | --- | --- |
| `real-claude-permission-modal.spec.ts` | `real claude session checkbox grants repeated Bash use only in the current session` | Passed, 14.3 s |
| `real-claude-permission-mode.spec.ts` | `operator bypass stays confirmed through a no-op write, then the menu returns to bypass and Manual approval enforces Read` | Passed, 11.0 s |
| `real-claude-question-cancel.spec.ts` | `real claude raises a clarifying question that refusing through Cancel stops the gated work` | Passed, 10.0 s |

The consumers now activate supplied choice buttons, twice for non-defaults. The grant spec retains
a fresh Bash witness after checked second activation, a second fresh effect with no new permission
in the same session, then a new permission before any effect in a different session in the same
workspace. The mode spec retains daemon-announced mode and enforced Read proof; the question-refusal
spec retains continuation, quiescence and absence of the gated artefact while servicing permissions.
Panel disappearance alone proves none of these daemon effects.

The configured gate installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather than the
requested `npm run e2e:real:gate`. The counted run and named passes satisfy its zero-execution guard
and this ticket's live acceptance despite the command mismatch. The dispatcher removed
`needs-real-claude` and advanced the ticket. Evidence comes from the linked gate and named-result
comments; documentation did not read dispatcher logs or run live tests.
See [permission interaction/capture coverage](conversation-shell-permission-modal.md#verification)
for completed fake-tier proofs. These gate results concern the local test relay, not the production relay.

## #1723, 2026-10-06

**Previous verified run: #1723, 2026-10-06 — 26 executed, 26 passed, 0 failed, 1 skipped.**
The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1723#issuecomment-6024904239)
records `feature/1723` at `1832410096`, merged with main `d627211c4d` in run
`2026-10-06T20-27-45-100Z`. The supplied per-test gate report confirms
`real claude restores the status after reconnect during the same running turn`
was present, executed and passed. The sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`; no reason is recorded.
The configured command installed and built, then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`,
rather than the criterion's `npm run e2e:real:gate`. The counted run and named
pass establish the required execution despite this command mismatch.

The [reconnect spec](../../../e2e/real-claude-phase-reconnect.spec.ts) holds a real
foreground Bash tool open and requires a new connection, an attributed running
phase and the same uncompleted turn before accepting restored status. The
[earlier verified baseline](https://github.com/pyrycode/pyrycode-desktop/pull/1763#issuecomment-5994328407)
recorded `responding`, connections 1 → 2 and the original turn still running:
the selected test executed once, passed once, with 0 failed and 0 skipped.
That verifier confirmed daemon v0.31.1 release revision
`ad7c57a850277bea48aafc4daad2cd2983e8fc90` contains prerequisite
`25b532b6205507784a7615fe59d3c5a7bb2f5484` (pyrycode#2718).
This provenance belongs to the earlier baseline, not a version assertion about
that gate. Existing desktop behavior needed no production fix. The live
observer cannot prove omission of `event_id`; the
[fake regression](conversation-timeline-store-limits.md#testing) supplies that seam.
These results cover the built desktop, local relay, real daemon and real Claude;
the production relay is outside this gate.

## #1729, 2026-10-06

**Previous verified run: #1729, 2026-10-06 — 25 executed, 25 passed, 0 failed, 1 skipped.**
The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1729#issuecomment-6024105618)
records `feature/1729` at `98f3db3893`, integrated with main `8b95b3bda8`, in run
`2026-10-06T19-37-51-069Z`. Its sole listed skip is
`real claude picks up a saved channel system prompt at Reset session`; no skip reason is recorded.
The configured command installed/built then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather than the
issue's `npm run e2e:real:gate` spelling. Counted execution satisfies the purpose of the command's
nonzero-execution guard; the named results below establish both required scenarios despite this
command mismatch.

The [supplemental live evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1729#issuecomment-6024286951)
confirms both adapted inline scenarios were present, executed and passed in that same run, each on
its first attempt with no retries:

| Spec and executed scenario | Executed | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `real-claude-question-answer.spec.ts` — `real claude changes model during a question and resumes with the original answer` | 1 | 1 | 0 | 0 | 11.2 s |
| `real-claude-question-cancel.spec.ts` — `real claude raises a clarifying question that refusing through Cancel stops the gated work` | 1 | 1 | 0 | 0 | 10.4 s |

The answer scenario now selects every `.question-batch__question` without stepping; its proof
still requires a real continuation naming the chosen option before the unchosen options. The refusal
scenario targets the whole inline batch and retains continuation, quiescence and recursive absence
of the gated artefact. These current-run passes establish their real-Claude continuation proof;
optimistic panel disappearance alone would not.

The supplemental evidence records `daemon-revision: 0.37.0` on every test and cites the
dispatcher-host report
`pyrycode-desktop-agents/logs/2026-10-06T19-37-51-069Z_real-claude-gate_#1729.log`.
The results cover the built desktop, local test relay, real daemon and real Claude; the production
relay is outside this gate. Documentation records the supplied evidence without rerunning live tests.


## #1731, 2026-10-06

**Previous verified run: #1731, 2026-10-06 — 25 executed, 25 passed, 0 failed, 1 skipped.**
The [dispatcher PASS comment](https://github.com/pyrycode/pyrycode-desktop/issues/1731#issuecomment-6023654588)
records `feature/1731` at `b8b61010e0`, merged with main `2168a4b739`, exit 0.
The sole listed skip is `real claude picks up a saved channel system prompt at Reset session`;
no skip reason is recorded in that comment. The configured command built the app then ran
`npx playwright test --config playwright.real-claude.config.ts --reporter=json`, rather
than the issue's `npm run e2e:real:gate`. The counted per-scenario passes below establish
the intended execution despite this command mismatch.

The [supplemental live evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1731#issuecomment-6023883060)
confirms all three required `e2e/real-claude-queue-delivery.spec.ts` scenarios were present,
executed and passed in that same run, each on its first attempt with no retries:

| Executed test | Executed | Passed | Failed | Skipped | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| `real claude delivers one queued follow-up exactly once` | 1 | 1 | 0 | 0 | 14.3 s |
| `real claude delivers two queued follow-ups in submission order` | 1 | 1 | 0 | 0 | 15.2 s |
| `real claude drops the queued head and completes the remaining follow-up` | 1 | 1 | 0 | 0 | 13.0 s |

These scenarios assert transcript order: first reply, delivered follow-up, its reply,
then each next delivery/reply; one originating row per delivered send and no dropped row.
The same run also passed `real-claude-queue-drop.spec.ts` (11.1 s) and
`real-claude-queue-send-now.spec.ts` (14.0 s), both first attempt.

**Executed daemon provenance:** `PYRY_BIN=/usr/local/bin/pyry`, the image's test binary
selected by `config-desktop/dispatcher.env`. The supplemental evidence records
`daemon-revision: 0.37.0` on every test and verifies source tag `v0.37.0` contains
both required daemon commits: GitHub comparisons of `8581e740...v0.37.0` (#2819) and
`29f1ab04...v0.37.0` (#2820) each report the tag ahead of the commit. The dispatcher
health check requires at least 0.37.0. This records the executed binary's annotated
release and verified tag ancestry, rather than assuming a closed prerequisite is installed.
Each queue-delivery scenario also emits `queue-delivery-evidence` using that same
fixture-resolved executable. The results cover the built desktop, local test relay,
real daemon and real Claude; the production relay is outside this gate.

The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1790#issuecomment-6023555321)
confirms all eight `e2e/queued-own-settlement.spec.ts` scenarios executed and passed in the
current-head fake gate (296 executed, 296 passed, 0 failed, 4 skipped), including the two
mixed-delivery orders and both restoration orders. This establishes mounted regression
coverage alongside the real-Claude results above.

## #1785, 2026-10-05

**Previous verified run: #1785, 2026-10-05 — 24 executed, 24 passed, 0 failed, 1 skipped.**
At `29e351d298` integrated with main `cb82a7d9d5`, all three required question-answer,
question-cancel and multi-agent cases executed and passed against daemon release `0.34.0`,
source `9834e99ee0`; see [per-test evidence and provenance](development-verification.md#live-test-diagnosis).

## #1657, 2026-10-01

**Previous verified run: #1657, 2026-10-01 — 24 executed, 24 passed, 0 failed, 1 skipped.**
The [dispatcher verdict](https://github.com/pyrycode/pyrycode-desktop/issues/1657#issuecomment-5933303183)
records branch `dbe8a350a0` merged with `origin/main` `bd5b9348e7`, exit 0.
Its per-test JSON log `2026-10-01T14-11-47-394Z_real-claude-gate_#1657.log` under
`pyrycode-desktop-agents/logs/` confirms `real-daemon-multi-agent.spec.ts` executed and passed
at 14:15:24 UTC, retry 0 (665ms). The version-checking specs attach daemon revision
`36acd04c79f1279c5c5dfb14a4c35e4dc6b6aff0`. The sole skip remains the Reset session fixme
for pyrycode#2436. This covers the built app and local relay, not the production relay.

`e2e/real-daemon-multi-agent.spec.ts` uses `spawnClaude: false` and
`requiredCapabilities: ['interactive', 'multi_agent']`; `daemonCapabilityGate` skips unsupported
daemons, including those predating v0.27.0. Its body records the app's own `connected` ack
after reconnecting and requires both names; the separate gate probe cannot prove production
advertises them. See the [liveness overview](real-claude-liveness-e2e.md#capability-gated-skip--the-one-check-that-runs-after-the-daemon-exists).

## combined #1673 and #1674, 2026-09-27

**Previous verified run: combined #1673 and #1674, 2026-09-27 — 23 executed, 23 passed, 0 failed, 1 skipped.**
The operator ran `npm run e2e:real:gate` on commit `97ad5940`, containing both fixes and
`origin/main` at `d085e321`. The configured test binary reported `pyry 0.27.0`.
All five release-version cases and the workspace grouping, cwd-equality, and unique-create
cases passed. The three version-checking specs now accept either a source revision or a
release version and record the parsed value as `daemon-revision`. The one skipped case is
the existing Reset session `test.fixme` for pyrycode#2436. This result covers the built
desktop, local routing relay, real daemon, and real Claude. It does not test the production
relay. The outcome is recorded on [#1673](https://github.com/pyrycode/pyrycode-desktop/issues/1673)
and [#1674](https://github.com/pyrycode/pyrycode-desktop/issues/1674).

## #1522, 2026-09-19

**Previous recorded run: #1522, 2026-09-19 — 22 executed, 22 passed, 0 failed, 1 skipped;
all four required queue cases passed on retry 0.** The
[dispatcher verdict](https://github.com/pyrycode/pyrycode-desktop/issues/1522#issuecomment-5741840980)
records `feature/1522` at `8abd854c7b`, merged with `origin/main` at `db45831a51`
(0 commits behind), exit 0, wall clock 151.9s. Per-test JSON in dispatcher-host log
`2026-09-19T12-23-02-498Z_real-claude-gate_#1522.log` confirms these executions;
the log is under `pyrycode-desktop-agents/logs/`.

All three cases in
[`e2e/real-claude-queue-delivery.spec.ts`](../../../e2e/real-claude-queue-delivery.spec.ts)
ran against real Claude with the stream-json runner. Their `queue-delivery-evidence`
attachments each report **daemon revision `8a850505`**, read from the executed binary's
`version` output using the fixture's `PYRY_BIN`/PATH resolution. This is binary evidence,
not the newer daemon checkout revision inspected during implementation.

| Executed test | Queued before release | Completed marker order | Result |
| --- | ---: | --- | --- |
| `real claude delivers one queued follow-up exactly once` | 1 | 0 → 1 | PASS |
| `real claude delivers two queued follow-ups in submission order` | 2 | 0 → 1 → 2 | PASS |
| `real claude drops the queued head and completes the remaining follow-up` | 2 (then head dropped) | 0 → 2 | PASS |

Marker 0 belongs to the held first turn; 1 and 2 belong to the follow-ups in submission
order. Every listed turn had exactly one normal completion, each next turn started after
the previous completion, and all attachments report `released: true`, `complete: true`
and zero remaining queue items. The passing cases also checked one surviving originating
user row per delivered message, removed queued/drop affordances, rendered response markers
and no additional desktop send through the three-second settle window. The drop case
observed no turn for marker 1.

The retained
[`e2e/real-claude-queue-drop.spec.ts`](../../../e2e/real-claude-queue-drop.spec.ts)
case, `real claude enqueues a mid-turn send, drops it before drain, and runs no turn for it`,
also executed and passed on the stream-json runner. It checks cancellation of the only
follow-up, row removal and stable idle UI/content after release. It uses the same daemon
fixture and binary resolution; it does not emit a separate revision attachment.

The suite declares **23 tests in 20 files**, including the three new delivery cases.
The sole skip was `real-claude-system-prompt.spec.ts` → `real claude picks up a saved channel
system prompt at Reset session`, the existing `test.fixme` for pyrycode#2436; it is not a
pass. The gate reported a configured execution floor of 10, still below the 22 runnable
tests; adjusting that external setting remains the operator's work.

This run did not reproduce the reported stuck queue. The change adds regression proof
without a production repair or a confirmed daemon prerequisite. The result covers the
built desktop, local routing relay, real daemon and real Claude at the recorded revision;
it does not establish behavior through the production relay. The
[liveness overview](real-claude-liveness-e2e.md#what-it-does) explains the correlated proof.

## MCP live coverage

**#1579 added `e2e/real-claude-mcp.spec.ts`, which passed in the combined 2026-09-27 run.**
It opens Channel info against a real daemon and a real non-bypass child (`skipPermissions: false`, so
the daemon spawns the child with its strict `--mcp-config` and the on-demand `mcp_status_request` this
ticket's Channel-info trigger sends has something to answer), ticks Show built-in, and asserts the
daemon's own `pyry_approve`/`pyry_files` rows by exact name — see [Channel info § MCP servers
section](conversation-shell-channel-info-mcp.md#mcp-servers-section-1490).
The recorded run executed 24 tests against the fork's then-configured floor of 10.
Current counts and required named results stay in the parent runbook; the floor lives
in the fork's dispatcher configuration, not this repo.
