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
The automatic dispatcher gate remains the acceptance check for live behaviour.
Follow the Desktop harness and current role instructions for credentials and runs.
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

