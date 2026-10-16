# Production daemon-built threads

The desktop app draws daemon-authored conversation items for every paired host.
[`threadRuntime.ts`](../../../src/renderer/src/store/threadRuntime.ts) owns the
application's item store, local pending sends, live session state and query
coordinator. `App` installs its subscriptions. `PairedShell` opens it for both
sidebar navigation and newly created chats. The existing conversation components
provide the rows, composer, menus, prompts, task drawer and scrolling.

## Accepted capability and host routing

The client hello requests `interactive` and `thread`. Main checks each host's
accepted handshake independently. A handshake without `thread` produces
`update-required` with a daemon cause and no `connected` event. The existing failed
host treatment names the daemon and offers no app download link. That host draws
no conversation rows and sends no content or recovery requests.

The driver is parked with reconnect supervision retained. A later accepted
handshake with `thread` connects normally and clears the failed treatment. Another
host's capability or connection cannot select this host's content route. Saved
format provenance permits offline display only and never establishes network
capability. The legacy event/history path is unhooked from paired-host production
content. The renderer reconstruction producers were deleted in #2030, with no
fallback when authoritative inputs are absent.

Conversation commands capture the selected or retained host. Main resolves that
explicit host through the paired registry. A last claimant of an equal conversation
ID cannot redirect the request. Device identity is a separate authenticated fact.

## Restore, recovery and cleanup

Opening first starts an owned protected `readThread` through `readSavedTimeline`.
Only `daemon-items` can hydrate the runtime. A legacy saved timeline is never drawn
or converted. Protected indexed storage is the application backend; the renderer
still restores complete authoritative snapshots. Bounded local paging remains
separate work. See [storage activation](chat-history-testing.md#native-runtime-and-packaged-proof).

While a saved read is pending, query demand waits. A connected opening or reconnect
then supplies the saved epoch and complete checkpoint to the coordinator. Applied
version, unfinished batches and item presence cannot certify resumable progress.
Live/reply overlap follows item revisions. Interrupted or abandoned batches retain
received facts without certifying completion. Repair resumes the complete
checkpoint. A correlated reset retires the old scope and starts the new epoch's
newest window. Older and Retry controls invoke host-addressed thread queries.

Navigation cancels the selected local read and abandons application of its query.
The coordinator retains sent-query ownership until terminal delivery or expiry.
Local read tokens, request IDs and store generations reject stale callbacks even
when host, conversation or epoch strings are later reused.

Confirmed deletion clears the owning conversation's retained items, pending sends,
live binding, completion and read authority. Successful unpair retires those
resources for every scope on that host, including scopes without content. The
protected writer removes saved content through its existing ordered removal path.
Failed credential removal does not grant successful-unpair cleanup. Other hosts
with equal IDs remain independent.

Text appends are published once per animation frame in arrival order. The first
append schedules that frame. Other event types flush earlier appends before
application. A bounded flush also handles a paused window. Teardown removes
subscriptions and retires owned query and live state.

## Navigation boundaries

Navigation no longer resets, creates, views or clears legacy timelines (#2028).
Renderer legacy saved IO retired separately (#2029). #2030 deletes the flat/keyed
holders, `reduceTimeline`, content subscriptions, delta joining/open-bubble lookback,
result filling, history reconciliation/demand/retry, type/timestamp joins,
gap/receipt tracking, legacy echo settlement, inferred rosters and reconstructed
row keys, along with their exclusive bridges, mounts and tests. The exclusive
queue store/actions and local-count last-read store/cleanup are also gone.

Shared declarations stay at `threadTimeline.ts` and `backgroundTaskRosterStore.ts`;
shared translation remains at `timelineBridge.ts`. Those paths no longer imply a
content producer. Main/IPC request and recovery retirement remains #2025;
saved-format admission and indexed legacy storage retirement remains #2026.
Their surviving contracts are not removed by renderer deletion.

Active ID/session/configuration/prompt cleanup remains synchronous before exit navigation. Same-ID
reopening preserves held configuration and requests a refresh every time. Server removal samples
exclusive departed IDs before dropping the list slot, then exits a matching active chat.
Protected removal retains its owning lifecycle; local-count mark persistence no longer participates. See
[the shell's retained boundaries](paired-shell-conversation-exits.md).

`conversationLastReadBridge` keeps its paired-shell `useReadPublication` mount while dropping the
legacy count helper and timeline subscription. Its wrapper remains after #2030 removes the
underlying count store. Navigation alone creates no read evidence; the
committed-visible-content fences below and daemon acknowledgements remain authoritative.

## Sending and authenticated identity

The no-argument `window.pyry.deviceIdentity()` invoke returns the lowercase
hexadecimal public key from main's protected Noise keypair. Failure returns only
`identity-unavailable`. No private key or token crosses IPC. Each submission
captures this identity with host/conversation and current selection ownership.
Identity failure, lost ownership and a false submit result preserve recoverable
input without overwriting a newer draft. Attachment rollback has one owner.

The pending-send store supplies local rows before acceptance. An authoritative
`user_message` settles a row only when both `content.device_id` and
`content.message_id` match the captured pair in the exact host/conversation.
Equal text, a peer device's equal message ID and another host cannot settle it.
After acceptance, only daemon content supplies the row. Terminal or hidden items
can settle a send even when they are the first observed revision.

Queued actions use genuine `content.queued_msg_id` handles with owning coordinates.
Send now additionally requires the session's reported capability. Task membership,
activity and saved attribution come from linked daemon items rather than a legacy
roster. Stop retains the recorded agent and owning-host capability checks.

## Live controls and read publication

Only the owning summary's `current_session_id` binds live state. Admitted readings
also require host, conversation and envelope-session provenance. Durable items,
saved restoration and session-transition markers cannot choose the current live
session. The selected host's projection supplies existing model, effort, context,
MCP and other configuration readers. Off-screen hosts keep separate live state.

The prompt slot reuses existing permission, consent and questionnaire components.
Replies retain the original host and prompt object. Session replacement and
reconnect invalidate stale handles. Rejection feedback survives reconnect.
Current prompts remain usable during pending or failed initial history recovery.
Composer hook stops, refusal offers and foreground-tool reports derive from current
canonical items. Session errors come from admitted live readings. Without a snapshot
there are no content-derived reports or item previews; without a session binding
there are no current-session reports or admitted live activity. Available daemon
items and local unaccepted sends retain their own presentation authority. Neither
absence selects a reconstructed source. Badge/sidebar status combines admitted
live inputs (idle when unavailable) with received host-qualified shown/read marks.
`notificationPreviewFromItems` remains shared; `notificationPreviewIn` is deleted.

`subscribeRefusalRecovery` still forwards newly selected model writes into
`threadRuntime.refusals`; it no longer dispatches into timelines or settles legacy
events. The overlay consumes the exact displayed authoritative session-error
reading on departure through its microtask fence, preserving StrictMode replay
and preventing a stale cleanup from consuming a replacement reading.

The screen shares one scroll pin with the actual authoritative scroller. The
Background tasks menu, count pill and close action share drawer state. Immutable
source items retain presentation identity while another row streams. Presentation
memoization is restricted to frozen inputs so mutable supplied fixtures stay fresh.

Read publication uses the committed immutable snapshot, received owning summary
and a certified newest/catch-up completion watermark. Visibility, ordered shown
content, reader coverage and repair/unfinished fences remain required. Sending a
read command is distinct from received daemon acknowledgement. Every host-stamped
sidebar row uses `last_shown_version` for unread state before its first opening;
legacy local read stamps cannot replace a missing authoritative mark.
`readTargetFor(inputs)` and `useReadObservation` have no legacy receipt/row-key
branch. The publisher requires the authoritative epoch and shown watermark;
`latest_entry_id` and local counts cannot supply missing eligibility. Observation
cleanup, acknowledgement and reconnect retry retain their existing ownership fences.

## Validation boundaries

The final Mac fake-daemon suite on 2026-10-15 executed and passed 434 cases,
with zero failures, retries or flaky cases and 20 skips. Source was
`8d2f3a03d69c7b81019354feca58d42e0008d977`. All 1093 tracked source/configuration
files matched the frozen executed copy. The full unit suite passed 10391 cases
with 38 existing skips. Build, pre-verifier, documentation and packaged storage
checks also passed.

The final report contains all 15 `thread-activation.spec.ts` cases, all 12
`thread-items.spec.ts` cases and the single `timeline-frame-deltas.spec.ts` case,
each executed and passed. Production cases cover fresh creation/send, identity and
bridge failure, host isolation, session/error/prompt controls, saved offline display,
restore/live overlap, interrupted catch-up, epoch replacement, queue recovery,
deletion/unpair, older paging and capability recovery.

The [activation plan](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions)
retains that historical run's exact counts and hashes and the now-completed
19-case retirement inventory. Its twentieth skip was the pre-existing
desktop-isolation case. Cleanup allocation is tracked in
[#2020](https://github.com/pyrycode/pyrycode-desktop/issues/2020#issuecomment-6200547647).
The [fake publisher](e2e-harness.md#scripted-and-native-thread-fixtures) supplies test
protocol data only. These checks establish no credentialed real-daemon pass.
The [live runbook](live-e2e-runbook.md#current-real-claude-gate-state) records the
remaining required scenarios and executable provenance.

### Navigation retirement validation

The [#2028 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2031#issuecomment-6205882433)
records Linux gates at `d3df5ec300026501d3a8d52488dfdba696609aeb` on 2026-10-16:
10,196 unit tests executed/passed, 0 failed, 30 skipped across 415 files; build and docs guard passed.
The complete configured fake-transport suite executed and passed 432 tests, with 0 failed,
10 skipped, 0 flaky and 0 retries. Both configured projects and four workers ran without selection
or shard filters; seven skips concern retired legacy scenarios and three are macOS-only cases.

All 15 `thread-activation.spec.ts`, all 12 `thread-items.spec.ts` and the single
`settings-per-server-unpair.spec.ts` case are explicitly present and passed in that counted Linux
run. They include deletion/owning-pairing cleanup, host isolation and both committed-visible-
authoritative-read variants. No top-level errors or fake-daemon-setup attachments were reported.
At that revision the navigation factories retained seeded legacy-store preservation assertions;
\#2030 removes those setups with the deleted producers. Tests exclusive to stamping and its
removed subscription had already been deleted.

Historical macOS task `db47ef552e357d3da36abf43f54891dbcfc0aee1588e9a697235800c8860e37e`
ran candidate `4d695203d5035b69ba02d77f1368e2809ead676d`: 434 executed/passed, 0 failed,
17 skipped, 0 flaky and 0 retries out of 451 configured cases. All 15 thread-activation, 12
thread-items and one settings-per-server-unpair case were present and passed there too. The
verifier inspected all six artifacts; capture, JSON and list/execution logs agreed and the
configuration hash matched that candidate. All seven #2028 production modules are unchanged
between that candidate and the Linux gate head. Later main changes to #2029 saved IO and #2033
scroll-test readiness are covered by the Linux gates. These native counts establish only the
recorded historical candidate; current-head macOS checks are outside this Linux ticket's scope.
No real-Claude or visual result is claimed for this navigation-only change. The
[plan](../../specs/architecture/2028-retire-navigation-bookkeeping.md#returned-native-evidence--2026-10-16)
retains the full candidate/configuration and skip breakdown.

### Renderer producer retirement validation

The [#2030 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2039#issuecomment-6208863531)
records Linux gates on 2026-10-16 at
`c42a778299612f1b9ac0f2d786cc02dc132fe2ae`: units **9,152 executed/passed,
0 failed, 30 skipped** across 392 passing files; complete configured fake Playwright
**435 executed/passed, 0 failed, 3 skipped, 0 flaky**, four workers, clipboard/parallel
projects, no selection/shard filters and zero retries. The skips are two macOS badge
cases and the macOS window-reopen case. Install, docs guard, build and both native
addon rebuilds passed. Pre-verify ran three checks and intentionally skipped two
with `--no-suite`; units and typecheck ran in the subsequent unit/build gates.

All 15 `thread-activation.spec.ts` and all 12 `thread-items.spec.ts` cases are
explicitly present and passed, including both committed-visible-authoritative-read
widths, missing-`thread` recovery, paging/checkpoint recovery and owning-scope cleanup.
The retained activation cases assert zero legacy content requests on opening,
reconnect, paging and retry. Both indexed-history lifecycle cases also passed.
No broader suite or shared fake publisher was disabled; active cases in mixed
files, cache/removal/restart and conversation-feature coverage remain.

The last seven retired renderer-only cases were removed with their producers:

| File | Removed cases |
| --- | ---: |
| `history-gaps.spec.ts` (file deleted) | 2 |
| `reconnect-event-replay.spec.ts` | 1 |
| `queued-own-settlement.spec.ts` | 2 |
| `history-on-open.spec.ts` | 1 |
| `visible-tail-read.spec.ts` | 1 |

Together with three presentation cases removed in #2023 and nine recording cases
removed in #2029, this completes the [19-case inventory](../../specs/architecture/1908-thread-activation.md#manual-completion-shared-fake-migration-and-client-regressions).
Producer-exclusive unit regressions retired only with their implementations;
shared translator/presentation tests remain. The verdict references dispatcher
`verifier-gate_#2030.pass.json`, unit `_5.log` and Playwright JSON `_8.log` in its
logs directory. These are recorded gate results, not documentation-stage reruns.
macOS is outside this Linux ticket's verification scope. No real-Claude result or
visual capture is claimed; existing live obligations remain in the runbook.
