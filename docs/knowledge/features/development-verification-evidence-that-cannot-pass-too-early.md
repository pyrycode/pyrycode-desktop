# Development verification — evidence that cannot pass too early

Positive processing barriers and nonvacuous absence assertions.
See [development verification](development-verification.md) for the topic map.

## Evidence that cannot pass too early

A closing absence assertion can pass before an action completes.
First wait for a positive effect of that specific action, then check the absence.
A positive assertion can also be vacuous if history already satisfies it.
Measure the pre-action count and wait for an increase.
Keep an opening absence check when it proves that a later observation is new.

Renderer evaluation completion does not establish delivery of fire-and-forget IPC. When an
observation callback sends synchronously, a later sentinel command on the same ordered outbound
path, received at the fake daemon, establishes processing before checking that no publication
occurred. Keep the exclusion condition active until that receipt; restoring it earlier can let
an incorrect excluded publication satisfy the subsequent positive poll. See
[visible-tail read publication](development-verification-what-each-test-tier-proves.md#visible-tail-read-publication)
for the focus/context-usage barrier and the forced-publication control that rejects this false pass.

A width assertion must distinguish the before and after layouts.
A test that passes at both widths cannot prove that resizing changed anything.
`launchPairedApp` initially clicks an unfiltered `.channel-list__row-open` locator,
so seed exactly one conversation for that step. For off-screen routing or a resting,
unopened row, push the second conversation after launch returns. Seeding both in the
initial reply fails before the feature is exercised; see
[`banner-reports.spec.ts`](../../../e2e/banner-reports.spec.ts).

Optimistic state can disappear in the same frame when the fake immediately replies.
Hold the fake response, assert the optimistic state, then send the correlated reply.
A rejection can distinguish states whose successful renderings look identical.

The reset regression in
[`composer-context-claude-reading.spec.ts`](../../../e2e/composer-context-claude-reading.spec.ts),
`reset completion requests context once and refreshes footer and gauge without a message`,
holds the completion reply while both displays retain 40%. Visible wrapping-up and restarting
labels establish that phase frames were processed before checking that no request was added.
The inactive edge produces one new request addressed to the reset conversation. Two more inactive
frames precede the correlated reply; the footer and gauge changing to 5%, with 10K of 200K tokens,
form the positive processing barrier before checking that request count stayed at two and no message
was sent. An immediate count after pushing inactive frames could pass before they reached the app.
Reopening then produces its separate activation ask.

The [verifier verdict for #1749](https://github.com/pyrycode/pyrycode-desktop/pull/1798#issuecomment-6006397775)
confirms this named regression was present and passed, along with the other two tests in that spec,
in the dispatcher gate at `1f994132db599066efd744a9df57a542195133e0` on 2026-10-06:
279 executed, 279 passed, 0 failed and 4 skipped. This is fake-transport evidence; no live-Claude
result is claimed.

A streaming assistant row includes cursor and metadata text, so an exact-text locator
can miss a visible delivery marker. Target the assistant role wrapper with `hasText`
for the positive barrier, then assert duplicate absence. In
[`live-user-receipts.spec.ts`](../../../e2e/live-user-receipts.spec.ts), a later
`assistant_delta` on the same encrypted stream proves the preceding receipts passed
through the mounted app before the one-row checks; an immediate count alone could
pass before either receipt arrived.

Visible assistant text can also precede `turn_end` processing. A whole-row replay
snapshot taken then includes the streaming cursor, so normal settlement can look
like a replay mutation. In
[`disconnected-message-delivery.spec.ts`](../../../e2e/disconnected-message-delivery.spec.ts),
observe each answer with its cursor before pushing its `turn_end`, then wait for
that answer's cursor to disappear before reading the baseline. Requiring the
cursor to appear first prevents an absence assertion from passing before the delta
is rendered. Keep the later replay-processing barrier before comparing rows;
settlement and replay processing are separate observations. The
[delivery verification](daemon-connection-disconnected-delivery.md#delivery-verification) records
the controlled reproduction and counted automatic, explicit and terminal evidence.

Bulk fixture feeds need a positive commit barrier too. Send completion and animation
frames can finish while replies are still reaching the renderer; a tail-only deadline
can reject an intact but slow feed before the geometry assertions begin.
[`thread-scroll-work.spec.ts`](../../../e2e/thread-scroll-work.spec.ts) checks all 100
ordered Markdown texts within a local 15-second limit, then checks cursor absence
before mutating rows. Keep readiness outside measured hook work. Its
[bounded-anchor verification](conversation-shell-scroll-pin.md#bounded-anchor-and-growth-verification)
records the controlled late-completion evidence and deadline rationale; passing
unthrottled baseline repetitions alone did not establish the cause.

The footer needs a session-settings snapshot before its controls can render.
Check the current refresh trigger. A lone idle event does not produce a transition
from running to idle. Drive the prerequisite transition when the fixture requires it.

## Question-answer interpretation and freshness

Selected-label mention order cannot establish answer delivery: correct contrastive prose
can mention an unchosen label first, and offered labels can overlap. The shared
[`real-claude-question-answer.spec.ts`](../../../e2e/real-claude-question-answer.spec.ts)
instead asks one two-question batch, selects a surfaced policy and enters a unique
confirmation through Other. Generate the confirmation through `scenarioInput` after the
batch appears, keeping it absent from the trigger prompt. The accepted model change must
leave that original batch outstanding before submission.

The scenario-local
[`createQuestionAnswerEvidence`](../../../e2e/fixtures/questionAnswerEvidence.ts)
binds host/conversation before sending the trigger, then native epoch and the original
live `AskUserQuestion` turn. A read-only CDP breakpoint projects only the answer command's
host, batch and exact indexed values; the daemon-supplied batch associates that command
with the original conversation, since the command has no conversation field. Preserve
the chosen label verbatim, including whitespace. Neither that outgoing command nor
optimistic panel clearing proves interpretation. Success additionally requires the owning
daemon's `answered` dismissal, fresh top-level assistant text containing the confirmation
on the original turn, and a subsequent normal `turn_end` on that turn. Error/foreign
completion, nested text and transcript replacement cannot supply the proof. The observer
retains necessary projected fields and public identities, never answer tokens or raw frames.

Freshness has two exclusion sources. Same-route/epoch `thread_items` snapshots retain
assistant text/revisions and already-seen terminal identities, even after submission;
snapshots never establish the tool turn, witness or completion. Every accepted live
assistant text revision before the exact submission must also extend the exclusion
baseline, including the interval after `arm()`. Otherwise `arm → reply → submit → dismiss
→ status-only update → terminal` can falsely pass using pre-submission text. Exclusions
only grow: shorter or absent bodies, higher revisions and arming cannot erase known
text. A higher revision containing unchanged text supplies no fresh witness. Terminal
identity counts on first observation only; updating an old end item after the witness
cannot turn it into a new completion.

Genuine post-submission appends remain eligible, including an ordered same-revision
field-change/text-suffix companion. A snapshot containing that item invalidates its pending
companion; an empty or unrelated snapshot preserves it. Prefix replacement and epoch reuse
fail the proof rather than falling back to the whole transcript. Deterministic controls
reject ignored/restated answers, wrong routes/batches/indices/values, stale text and
missing/mismatched/error completion. They accept varied correct prose, overlapping labels,
an unchosen label first and fresh appends after exclusions. The
[accepted Linux evidence](development-verification-live-test-diagnosis.md#question-answer-linux-acceptance)
records 47 passed controls and the separate capture/live/replay runs.

Stop the answer observer after original-turn completion, before the subsequent model
probe. That probe waits for the expected changed Opus announcement and retains its
resolved-model attachment: native live state can reassert the old Sonnet model before
the ensuing `system/init` announces the new model. The first new announcement alone
cannot settle this assertion. See the [recorded inventory](../../client-replay-migration.md#question-answer-proof).

## History page receipt and terminal demand

An observed history request proves neither reply admission nor React commit.
In [`history-walk.spec.ts`](../../../e2e/history-walk.spec.ts), the spec-local
`received` helper polls protected `readTimeline` for the exact received cursor and
`atStart`, then makes a main-process round trip before checking the exact request
count. This positively observes even an empty page's settlement and checks that
each response waits for fresh input instead of automatically continuing. Separate
DOM checks establish opening, short-page and terminal-row commits; saved coverage
alone is not a DOM barrier. The input helper's animation frames settle local
scroll positioning, not asynchronous IPC receipt.

Fixture chronology must also match the durable log. The former opening IDs
100–113 followed by supposedly older IDs 200 and 300 created disjoint newer spans.
After bringing the terminal row into view, focused trusted ArrowUp exposed those
gaps and produced an extra empty-cursor request at the final exact-request equality.
This is legitimate [visible-gap priority](conversation-shell-scroll-pin.md#user-demand-and-prepend-position)
despite oldest-end `atStart`, not evidence of a renderer paging defect.
The repaired walk uses contiguous newest-first IDs, retains that terminal reader
position and requires zero gap markers. It preserves opening overflow, trusted
input, exact cursor/conversation/`limit: 200` order, empty/short continuation without
automatic paging, terminal stopping and exactly sixteen rows without duplicates.

The [diagnosis and commands](../../specs/architecture/1999-history-walk-reliability.md#revisions)
and [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2013#issuecomment-6190760691)
record Linux evidence for candidate `876a0c37fd281433915d64c936a122684753d500`:

| Run | Executed | Passed | Failed | Skipped | Retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Terminal-position control, `control-diagnostic.json` | 3 | 0 | 3 | 0 | 0 |
| Shipping regression with only old IDs restored, `final-mutation.json` | 3 | 0 | 3 | 0 | 0 |
| Ten consecutive independent named-test invocations, `final-walk-1.json` through `final-walk-10.json` | 10 | 10 | 0 | 0 | 0 |
| Complete configured fake gate, `full-gate.json` | 428 | 428 | 0 | 3 | 0 |

Both controls failed with the extra `''` request; the old-ID mutation retained
the receipt barriers. The named `scrolling back walks the thread page by page and
stops at the start of the log` case was present and passed in all ten independent
invocations and in the complete gate. Four workers stayed configured; each selected
single case used one effective worker, while the complete gate used four. The
three skips were existing macOS-only badge/window cases. Reports, stderr and
failure contexts are retained under `/tmp/builder-1999/` with a verified manifest.

The dispatcher separately recorded the named case present and passed in verifier
gate 6 at `3944a15ea2229bb685b2423cdf5e73ba87a0b3e3`: 428 executed/passed,
0 failed and 3 skipped. That head adds plan evidence only. The original incident's
truncated report omits its assertion and schedule; these controls diagnose a
reproduced geometry-dependent fixture defect, not the exact original trace.
Unmodified baseline passes alone established no cause. No production behavior,
shared launch infrastructure, timeouts, retries or concurrency changed, and no
real-Claude proof was required.
