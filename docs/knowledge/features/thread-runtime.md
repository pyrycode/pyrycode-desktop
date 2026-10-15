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
content. Its reducer remains retained for cleanup, with no one-release fallback.

Conversation commands capture the selected or retained host. Main resolves that
explicit host through the paired registry. A last claimant of an equal conversation
ID cannot redirect the request. Device identity is a separate authenticated fact.

## Restore, recovery and cleanup

Opening first starts an owned protected `readThread` through `readSavedTimeline`.
Only `daemon-items` can hydrate the runtime. A legacy saved timeline is never drawn
or converted. The existing protected collection remains the application backend;
indexed partial storage and local paging are separate work.

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
canonical items. Session errors come from admitted live readings.

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
retains exact counts, hashes and the 19 legacy-only skipped cases. The remaining
skip is the pre-existing desktop-isolation case. Cleanup is tracked in
[#2020](https://github.com/pyrycode/pyrycode-desktop/issues/2020#issuecomment-6200547647).
The [fake publisher](e2e-harness.md#scripted-and-native-thread-fixtures) supplies test
protocol data only. These checks establish no credentialed real-daemon pass.
The [live runbook](live-e2e-runbook.md#current-real-claude-gate-state) records the
remaining required scenarios and executable provenance.
