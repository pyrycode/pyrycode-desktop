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

For ack-only sends, daemon receipt alone cannot prove the response was parsed.
[`composer-reset-send.spec.ts`](../../../e2e/composer-reset-send.spec.ts) uses
`threadMode: 'native'` to prevent synthetic user echoes from settling reset rows.
It waits for the initial native row before typing, then for each command's receipt
and an increment of the content-free `inbound-unmodeled`/`ack` diagnostic. A later
native assistant marker on the same encrypted stream establishes renderer progress
before checking that Sending and reset rows are absent. An ordinary-send control
must remain pending after ack alone until its matching authoritative user item
arrives. See the [named regression and counted Linux evidence](composer-send-limits.md#ack-only-reset-regression).

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
[`thread-scroll-work.spec.ts`](../../../e2e/thread-scroll-work.spec.ts) checks all
32/400 ordered Markdown texts within a local 60-second initial-history limit,
then checks cursor absence before adding Growing. The separate 100-row gap/hidden-run
case retains its local 15-second limit. Keep readiness outside measured hook work. Its
[bounded-anchor verification](conversation-shell-scroll-work-verification.md#bounded-anchor-and-growth-verification)
records the controlled late-completion evidence and deadline rationale. Row 255
can be an interim commit after main has forwarded the entire burst; inspector reads
can queue behind renderer processing. Receipt/application/commit timelines distinguish
this from lost delivery or recovery failure; passing unthrottled repetitions alone
does not establish the cause.

The footer needs a session-settings snapshot before its controls can render.
Check the current refresh trigger. A lone idle event does not produce a transition
from running to idle. Drive the prerequisite transition when the fixture requires it.

Compact status fixtures also need admitted live-state provenance. In
[`compact-demand.spec.ts`](../../../e2e/compact-demand.spec.ts), the Agent-label
regression supplies the bound `session_id` on its `turn_state` envelope, which
has no envelope-level conversation routing. Without that session, the live-state
guard correctly refuses the event and the status stays idle despite a rendered
active header. Preserve the guard and fix the fixture's ownership facts. Wait
for the initial description and same-item revised description to commit before
asserting zero body/children/page/history requests; an immediate zero count
would not prove that either header reached the composer. See
[Agent label derivation](conversation-shell-working-indicator.md#agent-descriptions-from-compact-headers).

## Received but uncommitted read evidence

The `stable callbacks exclude hidden, queued and received but uncommitted tails`
case in [`visible-tail-read.spec.ts`](../../../e2e/visible-tail-read.spec.ts) must
hold application through both scheduler paths. The runtime races the **same drain
function** through an animation frame and a **50 ms timer**. Holding frames alone
lets the timer commit the supposedly pending text. Match timer callbacks by
identity to retained frame callbacks, leaving unrelated timers and callback/IPC
processing live. Native wrappers count actual frame and timer opportunities
without invoking the retained application callbacks.

Keep the hidden-document, hidden-row and queued checks. For the pending append,
opt into thread updates on the real preload subscription and positively observe
receipt, then both native opportunities and the retained 100 ms challenge. Require
“Awaiting commit” to remain absent and the latest read target to stay 4. Dispatch
focus and scroll, then send `requestContextUsage` on the same ordered outbound
path. Wait for that new command at the fake daemon before comparing the exact
read-target sequence and text absence again; evaluation completion alone can
miss delayed publication. Keep the hold active through the sentinel receipt.

In `finally`, restore the exact `requestAnimationFrame`, `cancelAnimationFrame`,
`setTimeout` and `clearTimeout` identities and unsubscribe before releasing retained
callbacks. Cancel native handles and clear retained maps; runtime cancellation
and its scheduling token fence the losing drain. Final assertions require the
same append to become visible and publish target 5. This tests resumed progress
as well as exclusion. See the [runtime read contract](thread-runtime.md#live-controls-and-read-publication).

### Counted Linux validation

These are retained builder/dispatcher results accepted by the
[PR #2189 verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2189#issuecomment-6296990392)
on 2026-10-20, not documentation-stage test runs. Builder browser evidence used
candidate `c449934ff692110a56a7e542a5253fa1627b2ecb`; the accepted verifier reviewed
`3ce46e4b19ecb2ef7f57af6783f2fbfde9367ad8`, with the same repaired test.

| Run/report | Executed | Passed | Failed | Skipped | Retries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Controlled original frame-only hold, `before.json` | 1 | 0 | 1 | 0 | 0 |
| Repaired hold, `after.json` | 1 | 1 | 0 | 0 | 0 |
| Ten consecutive named repetitions, `repeat.json` | 10 | 10 | 0 | 0 | 0 |
| Complete visible-tail spec, `spec.json` | 7 | 7 | 0 | 0 | 0 |
| Builder complete default suite, `default.json` | 528 | 527 | 1 | 4 | 0 |
| Complete configured verifier application/replay gate 7 | 528 | 528 | 0 | 4 | 0 |

The controlled failure rendered “Awaiting commit” at the intended absence assertion
after a native 100 ms opportunity. The repaired named case is present and passed
in the after run, all ten repetitions, the complete spec and both complete-suite
runs; all seven visible-tail cases passed in each complete suite. Repaired
`pending-read-barrier` attachments record receipt 1, frame/timer opportunities 1
each, targets `[1,2,3,4]` and the received context-usage sentinel. Passing final
assertions establish released text and target 5.

Builder reports/result directories remain under `/tmp/builder-2186/`; the
[plan](../../specs/architecture/2186-pending-read-barrier.md#final-linux-validation)
retains commands, report hashes and pre-verify/build evidence. Repetitions used
`--project parallel --no-deps --repeat-each 10 --workers 1 --retries 0`; the full
default run retained the original projects and two workers. Its last-row thumbnail
case failed when `rowPosition` reported that the bubble was outside a thread scroll
region, tracked separately in [#2188](https://github.com/pyrycode/pyrycode-desktop/issues/2188).
That run remains failed; no unchanged-main attribution is established. The current
complete green gate includes that case and all seven visible-tail cases, each
passed, with zero flaky outcomes, two workers and all three projects. Its four
existing skips are two macOS badge cases, macOS last-window reopening and the
recorded system-prompt-reset fixme. Accepted verifier stage
`b754f2c76dec91777846d087d6f72e6d70eae755ec803d128728e0b83c4decbd`
retains the verdict and dispatcher gate references.

### Separate historical macOS provenance

The recovered bundle for owning ticket **#2176 / PR #2180**,
`ffc78e067a57e1446e74fe49f96444dc69e4f2be953f438bd475591d094889ac`,
preserves these earlier outcomes separately:

| Historical run | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Original complete macOS gate | 531 | 529 | 2 | 2 |
| Unchanged exact retry, recorded verifier handoff | 2 | 1 | 1 | 0 |

The original `logs/verifier-gate__2176_6.log` contains this named stable-callback
failure with the pending text rendered; its verified SHA-256 is
`f5917e8f8ed50c180f3116b6c6c8dd3df1075189352d9833e5ab4aaeeae2acc3`.
The bundle's `handoff/verifier-2176.md` records the same named case passing in the
unchanged retry, with zero retries, while the separate reply-source case failed
(#2173). The original raw `retry.json` is absent from the recovered bundle:
the named retry outcome is handoff evidence, not a raw JSON inspection. The
builder recovered the bundle under `/tmp/builder-2186/evidence-2176/`; the verifier
checked its log hash and relevant manifest entries. Original scratch paths
`/tmp/verifier-2180/review-bf3131b5/original-playwright.log` and `retry.json`
belong to the originating Mac and are not replaced by Linux reports.

Current macOS execution is outside this Linux ticket's verification scope.
These fake-transport and captured-client results establish no fresh provider or
live-daemon acceptance; none was required for the test-only repair.

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

Protected durability needs its own observation after dispatch and publication.
The [history coverage reader and controlled regression](chat-history-testing.md#protected-paging-coverage-observation)
retain actual numeric coverage before trusted input and require a strictly older
protected start within five seconds afterward. A pending split save deliberately
returns `unreadable`; collapsing that result to `undefined` loses the baseline,
while rereading a successful baseline can lose it again. Keep result categories
and the successful value, and start the progress poll alongside request-count
checks so dispatch waiting adds no coverage deadline. The real-writer regression
controls this mechanism; it does not identify the historical flaky run's trigger.
See [counted Linux evidence](chat-history-testing.md#counted-linux-coverage-observer-validation)
for separate builder and dispatcher results and retained historical outcomes.

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
