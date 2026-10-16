# Conversation shell — composer status row and error slot

The status row directly above the message box: its activity/thinking display, its error chip, that chip's fold into an actionable reconnect button, and the retry/compacting/stall statuses folded into its label. Split from [Composer](conversation-shell-composer.md) 2026-09-05, once this ticket's message-box growth would have pushed the combined document over the size cap. (Through #1604 the chip's fold also produced a Re-pair button here; Re-pair now shows in the conversation's Top overlay instead — see below.)

Part of [Composer](conversation-shell-composer.md); see that document for the message box and footer row, and [Conversation shell](conversation-shell.md) for the screen overall.

This page holds the row's own geometry and the five small, connected-only occupants of its trailing
slot's precedence chain. The largest occupants live on their own pages, linked from their stub
headings below: [Composer status row](conversation-shell-composer-status-row.md) (#796),
[Composer error chip](conversation-shell-composer-error-chip.md) (#797), and
[Actionable-error button](conversation-shell-composer-repair-button.md) (#963, Reconnect only since #1604).
[The usage-limit notice](conversation-shell-composer-usage-limit-notice.md) (#1321) and Re-pair, #963's
other arm, both moved out of this slot into the conversation's Top overlay by #1604 — their pages describe
where they live now, and neither is an occupant of the chain below any more.

## Composer status row (#796)

Split out to its own page: [Composer status row](conversation-shell-composer-status-row.md) — the
desktop layout's own fixed-height status area above the message box (Figma `111:3525`), its
activity/thinking display, the turning `PyryMark` icon, the truncation chain that bounds a daemon tool
name, and the retry/compacting/stall statuses folded into the label by #967.

## Agent-switch progress

`ConversationScreen` reads `agentSwitchStore.statuses` for the open conversation,
matching the retained entry's owning `serverId` to the pane's selected host.
`ThinkingIndicator` receives optional `switchStatus`; `statusRowCopy` gives it
precedence over ordinary activity, including tool labels, and renders it even
when the working state is null. Pending keeps the existing `PyryMark` turning.
See [confirmation API and read surface](switch-agent-request.md#renderer-confirmation-and-read-surface)
for opening, dispatch guards and [outcome lifetime](switch-agent-request.md#renderer-outcomes-and-lifetime).

Switching copy uses client-owned Claude/Codex names for `target` and `outgoing`:

| Held switch state / reset phase | Exact label |
|---|---|
| Pending, before a named phase or after reset's falling edge | `Switching to <target>…` |
| Pending, `wrapping_up` | `Switching to <target>: <outgoing> is writing a hand-over note…` |
| Pending, `restarting` | `Switching to <target>: starting <target>…` |
| Refused, retryable | `The agent did not change. Try again.` |
| Refused, nonretryable | `The agent did not change.` |

Reset completion and session transition leave the switch pending until a fresh
owning-host list actually shows the target agent. Switching never uses reset
wording or a handoff-outcome suffix. Without `switchStatus`, ordinary reset output
remains byte-identical: `Resetting…`, `Resetting: writing the handoff note…`, or
`Resetting: restarting claude…` / `Resetting: restarting codex…`, with the existing
` handoff note written` / ` handoff note skipped` restarting suffix where applicable.
Retryability adds copy only; there is no retry button or automatic resend. Refusal
does not imply wrap-up had no effects; another valid opening clears the old refusal.

`AgentSwitchDialog.test.tsx` statically pins both directions, phase/refusal copy and
escaped model text. Static renders execute neither effects nor handlers, so
interaction proof is [the scoped fake-transport spec](../../../e2e/agent-switch-confirmation.spec.ts).
Its scratch alternate renderer exposes only the production `openAgentSwitch` function;
it mounts the real App and preload subscriptions without a production menu entry
point or shared test hook. It exercises Switch twice in one task for single dispatch,
Cancel, Escape and X, focus containment, progress/refusal/list frames, navigation
with pending, authoritative completion and reverse-direction confirmation copy.
The confirmed round trip supplies a positive processing barrier for dismissal
zero-send assertions; an immediate empty command log alone would not prove them.

Recorded dispatcher verifier gate 6 at `a52fb304f142c204eb64a36135ebe907def5c8bc`
on 2026-10-07: `npx playwright test --reporter=json` executed 326 tests, 326 passed,
0 failed and 4 skipped. The named test “mounted agent switch dismissals, single
dispatch, progress, refusal and authoritative success” is present and passed;
the [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1841#issuecomment-6031427330)
confirms one execution without retry and all 29 focused unit/static tests passed.
The same verdict records 9,240 unit tests executed/passed, 0 failed and 3 skipped.
It also confirms Figma review of integrated captures at 1280×800 and constrained
800×300. Model-menu entry points, optimistic model display/rollback and live
hand-over acceptance remain #1662's scope; no live-Claude pass is claimed here.

## Composer error chip (#797)

Split out to its own page: [Composer error chip](conversation-shell-composer-error-chip.md) — the row's
`trailing` slot filled with a red pill reading `COMPOSER_ERROR_CHIP_COPY` in the `error` connection arm
and no other, and why it never destructures `status.error`.

## Actionable-error button, and the row that grows to fit it (#963; Re-pair moved out by #1604)

Split out to its own page: [Actionable-error button, and the row that grows to fit it](conversation-shell-composer-repair-button.md) —
`Connection error - Reconnect` for terminal failures except `unpair` and `not-paired`, the row's growth
from 24 to 32px to fit it, and the retired `RepairPrompt`/`RepairControl`/`.composer__repair` block this
retires. `Pairing error - Re-pair`, #963's other arm, moved to the conversation's Top overlay in #1604; on
a pairing rejection this slot now falls through to the ordinary connection-error chip below instead.

## Stopped-turn recovery

`ComposerErrorSlotControl` reads the open conversation's `timeline.latestTurnEnd`.
Only a stop that passes [the boundary formatter](conversation-shell-timeline-render.md#stopped-turn-records)
can offer recovery. `terminalReason: 'prompt_too_long'` shows “Context too long.
Compact or reset the session.” with Compact. Otherwise `billing_error` shows
“Claude reported a billing error. Check Claude billing on this server.” and
`authentication_failed` shows “Claude reported an authentication failure. Check
Claude sign-in on this server.” These are reports about Claude on the affected
server; Desktop settings cannot repair that account and are not an action here.

Compact sends the client-owned `/compact` through the same `sendText` path as the
[Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#grey-out-for-an-absent-command-681).
`markUnavailableActions` checks the published command list at render and again at
click time: a complete list proving absence disables it; unknown or incomplete
availability does not. The click also rechecks the open conversation id, and
`sendText` retains its connection/conversation guards. A command never clears the
typed draft. **Reset session is the Actions menu's `new_session` control action, not a
slash command**, as of [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) — it dispatches
outside `sendText` entirely; see [New session control
action](conversation-shell-actions-menu-and-reader-cutover.md#new-session-control-action-1218-folded-to-the-menus-only-reset-row-by-1496).

Recovery has priority after reconnect and connection errors, before refusal recovery and
model-settings rejection; it is visible only while connected. (Through #1604, the usage-limit notice
also sat in this chain, below Claude stopping reports; it now shows independently, in the Top overlay,
and no longer competes with recovery in either direction.) The
next local submitted message or daemon turn activity clears recovery while preserving the
boundary; the stopped turn's trailing idle does **not** clear it. Session boundaries,
reset and reconnect also clear the reading. A timeline reset or eviction drops the
retained rows too. [The reducer lifecycle](thread-timeline-internals.md#stopped-turn-state)
defines the exact events; scratch history folds cannot restore recovery, and each
conversation owns its own reading.

The recovery text wraps within a shrinkable status group. Compact needs both
`button-small` and `button-small--error`: the base class supplies typography and
shape only, so omitting the status-action variant leaves native button styling.
See [browser evidence](e2e-harness.md#stopped-turn-evidence) for draft preservation,
availability, slot priority and the 800px layout check.

## Refusal Switch back

`ComposerErrorSlotControl` reads only the active conversation's live refusal offer.
The latest fallback qualifies only with exact `scope: 'session'` and nonempty original
and fallback identifiers. Local/unknown scopes and no-fallback records create no
offer; history cannot create or revive one. The button requires a connected state
and an addressable session id (neither `null` nor `''`).

Switch back uses `changeSetting`, the same path as [ComposerModelMenu](composer-model-menu.md),
with the original identifier unchanged. It preserves the draft and sends one
`setSessionSettings` command, with no `/model` chat message. The handler rechecks
the active conversation, exact offer object, connection, session id and pending-model
guards at click time. The button stays visible but disabled while the offer has a
`changeId` or the settings store has a pending model write.

A correlated rejection retains the offer and shows “Could not change the model —
try again.” beside the retry button. Retry clears that feedback; confirmation retires
the matching offer while retaining its [thread row](conversation-shell-turn-status.md#model-refusal-records).
Navigation clears the settings-write store, so pending/rejected presentation also
reads the offer's conversation-owned `changeId` and `rejected` flag. This keeps a
held write disabled across A → B → A and preserves rejection received while away.
See [offer lifetime and regression coverage](conversation-timeline-store.md#refusal-offer-lifetime)
for retirement and stale-reply rules. Styling reuses `button-small button-small--error`.

## Model settings rejection

`ComposerErrorSlotControl` reads `useRunSettingsWriteStore(selectError)`. When the last
correlated settings rejection is for `model`, it supplies “Could not change the model —
try again.” as the slot's `notice`, above Claude reports (#1252). The message is
fixed client copy in a `role="alert"` element. It is available both with the ordinary
composer and while the [questionnaire's model footer](composer-model-menu.md#availability-during-question-batches)
is visible; rejection leaves the question answerable and rolls back the optimistic label.

The single-occupant priority is reconnect button → connection-error chip → stopped-turn
recovery → refusal Switch back (with any rejection feedback) → model rejection → Claude
stopping report → history failure → MCP server failure → task count. Recovery and notices
require `connected`; disconnected and connecting states hide them without clearing held reports. The
[usage-limit notice](conversation-shell-composer-usage-limit-notice.md) and Re-pair are no longer part of
this chain (#1604): both show in the conversation's Top overlay whatever this chain holds, and the usage
reading shows whatever the connection state too.
`.composer-status__error--settings` retains the error treatment but uses
`flex: 0 1 auto`, `min-width: 0` and `white-space: normal` so the sentence can wrap at the
800px minimum window width.

Clearing follows the existing [settings write lifecycle](session-settings-send.md), with
no timer or question-specific reset. Any new settings dispatch clears the stored error;
`conversationSwitched` clears it with the other write state. Reconnect clears pending
writes but preserves the error, so it can reappear once connected. A confirmation does
not clear a standing error, and an unmatched rejection changes nothing. A later correlated
rejection replaces the stored field; non-model errors do not use this status message.
Closing the question or the model menu does not clear it. Refusal recovery also retains
its own rejection across navigation, as described above.

Static slot tests cover connection priority. The fake question-answer drive holds the
settings response, checks rollback on rejection, and checks that a fresh dispatch clears the rejection
message while the original question remains answerable. Through #1604 this drive also proved rejection
outranked an existing usage notice; the notice now shows in the Top overlay independently of the
rejection, so `e2e/question-answer-continue.spec.ts` instead asserts the pill stays visible across both
the rejection and the fresh dispatch.

## Claude stopping reports

`ComposerErrorSlotControl` selects the open conversation's `timeline.stoppingBanner`.
The latest `stops_turn: true` report occupies the connected-only slot at the priority
above, regardless of level; even `info`, hidden in the timeline, appears here.
Higher-priority messages hide the report without retiring it.

`ComposerBannerReport` reuses the error treatment with `role="status"` and the shared
`bannerDisplayText` formatter. Terminal escapes/non-layout controls are removed;
line breaks and tabs survive, markup and URLs stay inert, and `…` is appended only
when the producer reports truncation. No second text cap applies. Its shrinkable
`pre-wrap`/`overflow-wrap: anywhere` styling lets the row grow at the 800px minimum.

**\#1656 made the `Claude:`/`(Claude reported: …)` prefixes name the conversation's agent.**
`bannerDisplayText(report, agent?)` and `stoppedTurnText(item, agent?)` (both in
`ConversationScreen.tsx`) pick `agent === 'codex' ? 'Codex' : 'Claude'`; a client-owned name, the
raw `agent` value is never rendered. `ComposerErrorSlotControl` reads its agent through
`useConversationAgent(open?.id ?? null)` (the #1651 hook, exported from `RunConfigSections.tsx`) and
passes it to `ComposerBannerReport`. Authoritative banner and stopped-turn rows
instead use the supplied item's recorded agent through `ThreadItemsView` and
`TimelineRow`; missing attribution uses saved text/summary. The deleted `Timeline`
no longer threads a current-conversation default into these rows.

The next accepted typed or slash send inserts an optimistic user row and clears
only this transient report. Empty/blocked attempts, daemon activity, trailing idle,
reconnect and navigation preserve it; reset, clear or eviction drops it with the
timeline. See [routing and lifetime](conversation-timeline-store-banners.md#claude-banner-routing-and-lifetime).
The flag changes no turn or permission state and triggers no action.

Claude's shipped producer subtype is `informational`, distinct from the payload
level. The multiline `/cost` example in `e2e/banner-reports.spec.ts` is synthetic
client coverage; it does not establish a `local_command_output` or `notification`
producer.

## History page failure and Retry

Production Older and Retry actions use host-addressed authoritative thread queries
and their owning query state. The legacy `retryHistoryPage`/`requestHistoryPage`
cursor/purpose producers and exclusive tests retired with #2030; #2025 removes
the remaining main/IPC request, reply/failure events and page decoding. See
[thread recovery](thread-runtime.md#restore-recovery-and-cleanup) and
[counted activation evidence](thread-runtime.md#main-request-and-recovery-retirement-validation).
The shared recovery presentation remains available; no raw-history fallback exists.

## The usage-limit notice — moved to the Top overlay (#1321; moved by #1604)

Split out to its own page: [The usage-limit notice](conversation-shell-composer-usage-limit-notice.md) —
the per-conversation [usage-limit store](usage-limit-store.md) reading, `usageLimitNotice.ts`'s three-run
copy composition (lead, window, reset clause), and the layout hazard the first #1321 review cleared,
wrongly, when a client-owned string (not a daemon one) blew the row past the pane. Through #1604 the
reading drew in this slot, as its third occupant; #1604 moved it out entirely, into the conversation's
Top overlay, where it now shows whatever this slot holds and whatever the connection state.

## MCP server failure notice (#1494)

A server that dies at spawn was invisible for the rest of the session unless the operator happened to
open Channel info — reports reach `mcpStatusStore` for the app's lifetime, sheet open or not (see [Channel
info — MCP servers section](conversation-shell-channel-info-mcp.md)), but only the sheet read them. This
ticket surfaces the first unacknowledged `failed` server in the trailing slot, between history failure and
the task count: `recovery ?? refusal ?? notice ?? history ?? mcpFailure ?? taskCount ?? null`. Every
occupant above it outranks it, and it outranks the task count in turn. Visible only while `connected`.

`isMcpServerFailed(status)` (`mcpStatusStore.ts`) is the exact `=== 'failed'` comparison, shared with the
sheet's `toneOf` so the row and the sheet cannot classify a server differently. `selectUnacknowledgedMcpFailureFor(conversationId)`
returns the first server in report order that reads failed and is not acknowledged for that conversation,
or `null` — a primitive, so a fresh selector per render never loops, the same shape as `taskCount`'s
`selectLiveTaskCountFor` above.

**Raised once per server, per app run.** `acknowledgedFailures: ReadonlyMap<string, ReadonlySet<string>>`
holds server names per conversation, for equality only (`Set.has`), never as a key, an attribute, a log
field or a lookup path — the same discipline every other MCP surface applies to a server `name`. Pressing
the notice calls `acknowledgeMcpFailures(conversationId)`, which adds *every* server the currently held
report shows as failed, not only the one named in the button — one press silences the whole current set. A
later report repeating an acknowledged name stays silent; a server that stops reading `failed` drops out on
its own, simply because the selector only reads the latest report; a server failing for the first time (or
failing again after having recovered) raises its own notice. `setMcpStatus` never touches this map —
acknowledgements last for the app run per conversation and clear only with `clearMcpStatus`, the same
pairing-scoped reset that already empties every other MCP-scoped set here. Because
acknowledgement compares the full raw name while display uses the bounded one, two names that share their
first 256 code points read identically in the row but are acknowledged separately — that can only raise an
extra notice, never hide one. A prototype-shaped name (`__proto__`, `constructor`, `toString`) is compared
as a value like any other; acknowledging one silences only that exact name (added during the ticket's
security-sensitive rework, below).

**Copy and view.** `mcpFailedCopy(name)` → `` `MCP server ${name} failed` ``, beside `toolWorkingCopy`,
client-owned and apostrophe-free with one hole. `ComposerMcpFailure({ name, onOpen })` renders the one
`button-small button-small--error` shape #963 already established, its only child the escaped
`mcpFailedCopy(boundMcpText(name))` text run — `boundMcpText` is the sheet's own 256-code-point bound,
exported from `McpServersSection.tsx` so both surfaces cut a name identically. `.composer-status__mcp-failure`
is `flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis` — the `.composer-status__tasks`
treatment, not the two fixed-width error occupants' `flex: 0 0 auto`, because this is the one Error-type
button whose label holds untrusted text of unbounded (pre-cut) length: letting it shrink and ellipsize is
what keeps the row from growing past the window, while `.button-small`'s `nowrap` keeps it to one line so
the row's height stays fixed at 32px even at the 800px minimum width.

**Opening the sheet reuses one closure.** `ConversationScreen` now hoists `openChannelInfo` (set the sheet
open, then `requestMcpStatus` for the on-screen conversation) as a single function passed to both
`ThreadOverflowMenu.onChannelInfo` and `ComposerErrorSlotControl`'s new `onOpenChannelInfo` prop — the
overflow-menu item and this notice open Channel info identically, status refresh included. The control's own
press handler acknowledges first, then calls `onOpenChannelInfo`, synchronously and with nothing async
between the two.

**Testing.** `mcpStatusStore.test.ts`'s `MCP failure acknowledgement` describe covers the exact-word
classification, first-unacknowledged-in-order (built-in names included), acknowledging the full current
set at once, a later repeat staying silent, a newly-failed name raising, a recovered server dropping out,
per-conversation isolation including `__proto__`/`constructor` conversation ids, and (added in the
security-sensitive rework below) that a prototype-shaped *server name* is itself compared as a value.
`mcpFailureNotice.test.tsx` (static render) pins the copy and its lack of an apostrophe, that a
markup-shaped name comes out escaped, the 256-code-point bound, the full `ComposerErrorSlot` precedence
matrix (outranked by every occupant above it, outranking the task count), and that it never shows on any
disconnected/connecting/error status. `e2e/composer-mcp-failure.spec.ts` (fake tier) drives raise-once end
to end: a report naming two failed servers raises the first by name; pressing opens the sheet, sends
exactly one `requestMcpStatus`, and shows the second failed server already in the sheet; closing and
repeating the same report raises nothing; a newly-failed server raises on its own; a recovered server
clears the notice; and a 300-character name at the 800px minimum keeps the row at 32px tall and its width
unchanged, with the button staying inside it. **Lesson from the PR:** a spec that forwards to
`conversationStateFake` without answering `request_history` lets the history failure fill the slot first,
which outranks this notice (and the task count) — the spec must answer history itself before pushing an
MCP report, since the fake is the reply function itself and has no separate method to prime.

**Security.** Reviewed against the shipped code as a retroactive `## Security review` (the ticket is
`security-sensitive` and the plan initially shipped without one) — PASS, no MUST FIX. The one untrusted
input is the server `name`/`status` pair already validated and typed before it reaches the renderer; the
only new decision on it is the exact-word `isMcpServerFailed` comparison. The name reaches the DOM only as
escaped text, never an attribute, key, log field or IPC payload; pressing the button sends only the
existing `request_mcp_status` command carrying the conversation id, no server name. Out of scope, by the
same reasoning the sheet already accepts: a hostile server name using bidi controls or confusables to
mislead the operator display-only, unchanged by this ticket. See the ticket's [architecture
spec](../../specs/architecture/1494-mcp-failure-status-row.md) for the full review.

## Background-task count pill, the slot's last occupant (#1435)

`ComposerTaskCount({ count, onToggle, open = false })` is the pure shared trailing
pill. Production receives the count of active supplied task presentations from the
[thread runtime](thread-runtime.md), matching the drawer's Running partition. Roster
size, dropped-task counts and retained `selectLiveTaskCountFor` producer state cannot
add tasks to this reading. Supplied inactive work remains accessible through the
Background tasks menu even when the active count is zero.

The connected-only status slot keeps task count last, behind reconnect/errors,
recovery/refusal, model/stopping/history and MCP notices. An absent occupant must
reach the precedence chain as actual null, not an element whose view later returns
null. `ComposerTaskCount` itself returns null at `count <= 0`; otherwise it renders
a real button with “1 task running” or “N tasks running”. The visible text supplies
the accessible name without a live region or task descriptions.

The count toggles the same `backgroundTasksOpen` boolean that the overflow-menu item
opens and drawer Close clears. Production holds it in `PairedShell`, preserving
visibility across conversation switches; the new thread scope supplies new task
facts. Bare screens can use local state. While open, the pill adds
`composer-status__tasks--open` and `aria-expanded="true"`; its Primary inset outline
leaves the native focus ring free. See the
[drawer contract](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583).

`.composer-status__tasks` keeps neutral Pill tokens, body-small regular text and a
shrinkable ellipsis chain (`flex: 0 1 auto; min-width: 0`). Its 16px line and 4px
vertical padding yield the 24px resting row. Static captures need the caller's
`.conversation` wrapper to inherit the application font; bare markup cannot prove
typography. A JSX comment in an expression prop must use ordinary `/* … */` syntax,
not the child-only `{/* … */}` form.

`ConversationScreen.test.tsx` retains static count copy, singular/plural, zero and
open-state assertions; `threadTaskPresentation.test.tsx` checks supplied activity
and scoped task identity. Mounted `e2e/background-task-drawer.spec.ts`,
`e2e/background-task-stop.spec.ts` and `e2e/thread-items.spec.ts` retain menu/count
open state, task controls and keyboard/close behavior. Static renders execute no
handlers or effects. Retained roster producer tests remain separate until #2024;
they do not establish a roster-backed drawer or count.
