# Development verification — live-test diagnosis

Executable identity, credential ownership and counted live evidence.
See [development verification](development-verification.md) for the topic map.

## Live-test diagnosis

A real-Claude failure can come from the installed daemon being too old or too new
for the client contract. It can also be an unrelated race.
Check the daemon version and the capabilities the test needs.
Confirm the actual test executable's source revision contains the prerequisite merge. A focused
pass against a temporary binary leaves a stale dedicated test binary unchanged; rerun against
the executable the dispatcher uses before treating that environment as repaired.
A release version needs a source mapping: use the executed binary's build metadata and release
tag, rather than a revision from a separate checkout. If a neighbouring spec supplies the identity,
record why it and the named cases used the same executable in the same run.
Compare neighbouring gate runs and per-spec durations before assigning the cause.
Search existing bug tickets before creating another.

The real suite can exit successfully while every test skipped.
Read executed counts, skip reasons and failure evidence.
Desktop's automatic gate uses captured client replay. Explicit live acceptance
requires counted builder/operator evidence accepted by the verifier; replay cannot
supply current provider behavior. Follow the Desktop harness and current role
instructions for credentials and runs.
Do not import the daemon repository's Go-specific live-test commands.

Capability-gated failures can share a setup cause even when their bodies exercise different features.
If only `requiredCapabilities` consumers time out waiting for the seeded sidebar row after pairing,
check the pre-app probe's credential ownership before diagnosing question delivery or app capability
advertising. First-key binding makes a successful probe with the app's token prevent the app's
independent key from authenticating. See the
[separate-pairing fixture and regression](real-claude-liveness-e2e.md#capability-gated-skip--the-one-check-that-runs-after-the-daemon-exists).

Recorded evidence for [#1785](https://github.com/pyrycode/pyrycode-desktop/issues/1785): the
[dispatcher live verdict](https://github.com/pyrycode/pyrycode-desktop/issues/1785#issuecomment-6004782077)
ran branch `29e351d298a78ef5a488b909a5dce8f80c51d273` integrated with main `cb82a7d9d5` on
2026-10-05. The run `2026-10-05T22-45-56-174Z` executed 24 tests: 24 passed, 0 failed, 1 skipped.
The dispatcher-provided per-test gate report confirms each required case was present and passed:

| Spec | Named test | Result |
| --- | --- | --- |
| `real-claude-question-answer.spec.ts` | `real claude changes model during a question and resumes with the original answer` | Executed, passed |
| `real-claude-question-cancel.spec.ts` | `real claude raises a clarifying question that refusing through Cancel stops the gated work` | Executed, passed |
| `real-daemon-multi-agent.spec.ts` | `a real daemon echoes interactive and multi_agent in the app hello_ack` | Executed, passed |

These three account for 3 executed, 3 passed, 0 failed and 0 skipped. The suite's single skip is
`real-claude-system-prompt.spec.ts` → `real claude picks up a saved channel system prompt at Reset
session`; the evidence comment records no skip reason. The dispatcher-host report is
`pyrycode-desktop-agents/logs/2026-10-05T22-45-56-174Z_real-claude-gate_#1785.log`.
This proves the named live results against the built app and local relay.

**Daemon provenance:** the run's daemon was release `0.34.0`, built from pyrycode tag
`v0.34.0` at source revision `9834e99ee046b9f94b528c2c83c7bd03f389cc41`. The same JSON report
records `daemon-revision` `0.34.0`, parsed from `pyry version`, in every spec that checks it,
including `real-daemon-archive-order.spec.ts`, which ran between the question-cancel and
multi-agent cases. The three named specs do not attach it themselves. They spawn their daemons
from the same `PYRY_BIN`, `/usr/local/bin/pyry` in the dispatcher image, within the same
single-worker run. That image installs the daemon with `go install` of `cmd/pyry@v0.34.0`; the
binary's build info records module `v0.34.0` with sum
`h1:5Xfhf9XwYuRp1TT1rk9LgGIWRfbcMdw42CwfwXQSWgw=`, which the Go module proxy resolves to
`refs/tags/v0.34.0` at that revision. It contains daemon commit `4d651424` from
[pyrycode#2734](https://github.com/pyrycode/pyrycode/issues/2734), so this run exercised
first-key binding. See the
[provenance comment](https://github.com/pyrycode/pyrycode-desktop/issues/1785#issuecomment-6010788994) on the ticket.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1792#issuecomment-6004715409)
records 8,835 unit tests executed/passed, 0 failed and 3 skipped, including all 18 fixture/capability
tests. Its fake-transport gate executed/passed 276 tests, 0 failed and 4 skipped; the three named
live cases were excluded there. This separates fixture regression evidence from live acceptance.

### Correlating live settings evidence

An acknowledgement proves a saved choice, not settled applied effort. In the
[effort observation diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1949#issuecomment-6166500926),
the original failed run took 21,769ms and expected `low` while the footer remained `medium`;
the named case was the sole failure in 27 executed, 26 passed, 1 failed, 1 skipped.
The same-tree focused rerun executed and passed that case in 18,434ms: 1 executed,
1 passed, 0 failed, 0 skipped. Both reported daemon release `0.39.0`.
Those reports contain no settings sequence, so the exact historical ordering remains unknown.
The repair capture establishes the mechanism: a medium write, settings request, matching
acknowledgement, saved-medium/applied-low reply, follow-up request and saved-medium/applied-medium
reply. Footer samples advanced from low to medium. The old reply-count wait froze the transitional
low oracle while the product correctly advanced to the settled medium reading.

Use an operation checkpoint, the intended conversation and the latest reply after its settings
request. Bind creation to the actual `conversationCreated` ID rather than the most recent request,
which could still belong to an old chat. For writes, match the latest effort write's session and
change acknowledgement and require a later reading; unrelated acknowledgements or superseded
replies cannot settle the proof. Record settings evidence synchronously in the page, observe commands
without replacing the preload API, and sample evidence and footer in one page evaluation on every
bounded poll. Missing evidence or a persistently incorrect footer must reach the deadline and fail.

Require the intended applied effort when proving a running-session change has settled, while
retaining unavailable applied effort before the first turn. Keep saved `effort`, applied
`effectiveEffort` and the confirmed `pyry.lastEffort` preference separate: substituting the chosen
value for the daemon oracle could conceal an incorrect footer. Attach the ordered evidence and
deduplicated footer samples with event counts on success and failure. A deterministic replay must
show the old frozen observation failing and the shared bounded poll succeeding only when current
evidence arrives, with negative deadline cases for obsolete/unrelated-only replies and wrong labels.
See [effort proof and bootstrap prerequisites](composer-effort-menu.md#testing-the-default-apply-1169)
and [counted focused and full live results](live-e2e-runbook.md#current-real-claude-gate-state).

## Question-answer Linux acceptance

The [verifier PASS for #2137](https://github.com/pyrycode/pyrycode-desktop/pull/2142#issuecomment-6269316902)
accepted the [correlated answer and freshness proof](development-verification-evidence-that-cannot-pass-too-early.md#question-answer-interpretation-and-freshness)
on 2026-10-19 at Desktop `9e0e6e75f85e763d615693beecddf5287dda3437`.
The helper, controls, scenario and recording were unchanged from tested implementation
`7052f041059cdd26b03ab793952226d67252df52`, which includes main `85358d02c328`.
These are retained Linux builder results reviewed by the verifier; verification and
documentation did not perform an independent live run. macOS is outside this ticket's scope.

All three scenario reports below contain the exact named case
`real claude changes model during a question and resumes with the original answer`,
present and passed. Configured retries and attempt retry were both zero.
Reports and stderr remain under `/tmp/builder-2137/`:

| Run / report | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Supported real capture, `capture-4.json` | 1 | 1 | 0 | 0 |
| Final normal-build live acceptance, `pre-submit-live.json` | 1 | 1 | 0 | 0 |
| Final guarded `claude-question-answer` replay, `pre-submit-replay.json` | 1 | 1 | 0 | 0 |
| Final deterministic controls, `pre-submit-controls-green.log` | 47 | 47 | 0 | 0 |

Live/replay attachments retain public host/conversation/batch/turn identity, every
positive answer-evidence gate and the changed resolved-model announcement
`claude-opus-5-5`. Guarded replay matched 29 requests, emitted 136 frames, left
0 requests outstanding and recorded 0 forbidden launches. Pre-verify's five checks,
client-test typecheck and normal build passed; Electron SQLite preparation followed
the completed Node gate before replay. The
[plan's final validation](../../specs/architecture/2137-question-answer-evidence.md#second-rework-validation)
retains exact log, provenance and checksum paths.

Keep the live executable and fixture capture provenance separate:

| Evidence | Desktop source | Isolated clean Linux daemon source | Binary SHA-256 |
| --- | --- | --- | --- |
| Final live acceptance (`/tmp/builder-2137/pyry`) | `7052f041059cdd26b03ab793952226d67252df52` | `664305939d73e5a146457503081d8232fcca5407` | `ba2831b24dd8f880c0a707fb694bab8b99cfe2535d76eaa6129dbf11e4d0b869` |
| Committed capture-4 (`/tmp/builder-2137/pyry-capture`) | `5788a683ab580647008eaf2b292631607c407ab8` | `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf` | `ec471608fa0e9cd68bc23d714f3433a26473db6824c350f4d5e9dd133df194fa` |

Capture used Claude `2.1.280`. The capture-4 authenticated capabilities are
`interactive`, `multi_agent`, `stop_background_task`, `thread`. The newer live
binary's same-binary capture-3 evidence also retains `thread_expansion` and
`thread_compact`. The verifier checked clean Go VCS metadata and binary checksums.
The committed `e2e/recordings/claude-question-answer.json` is byte-identical to the
successful capture-4 artifact, SHA-256
`6de35feed0dcf02764da0765a4af03234314ff691a29cc975bf82c3e8d498d6b`.
Its confirmation input equals answer index 1 and is absent from the initial prompt;
its original source stamp, authenticated capabilities and closure provenance remain intact.
The recording was unchanged by both freshness repairs.

Earlier failed captures and replays remain failed. The superseded `66430593`
capture-3 report contains the same named scenario, 1 executed/passed, 0 failed/skipped,
retry 0, but its exchange closed connection 1 at wire index 47 before three trailing
requests assigned to that connection. Historical `replay.json` remains failed:
1 executed, 0 passed, 1 failed, 0 skipped, retry 0; strict replay refused reconnect
with 9 matched requests, 38 emitted frames, 29 remaining and 0 forbidden launches.
The separate close-ordering repair now has
[combined retained-input acceptance](development-verification.md#captured-close-client-tails):
the unchanged capture-3 passed on clean current source with complete-thread
selection, 1 executed/passed, 0 failed/skipped, 38 matched / 201 emitted /
0 remaining and zero forbidden launches. That offline pass preserves the original
close chronology, strict matcher and capture bytes; it adds no fresh live proof.
The older clean daemon produced the independently successful capture-4 above.
Red freshness controls, interrupted-install/native-preparation failures and exploratory
capture failures remain separately retained in the plan; none is a successful fixture.
The last pre-submission reproducer run recorded 47 executed, 44 passed, 3 failed and
0 skipped before repair. The verifier's two stale-content reproductions both passed
after repair: 2 executed/passed, 0 failed/skipped in
`/tmp/verifier-2142/review-9e0e6e75/pre-submit-replay.log`.

The dispatcher additionally recorded 9,746 unit tests executed/passed, 0 failed and
3 skipped. Its original application gate recorded 509 executed, 508 passed, 1 failed
and 5 skipped, with the named question-answer replay present and passed. The verifier
accepted the unrelated history-writer flake's same-tree rerun, tracked on #2125;
that acceptance does not rewrite the original failed run or turn replay into live proof.
