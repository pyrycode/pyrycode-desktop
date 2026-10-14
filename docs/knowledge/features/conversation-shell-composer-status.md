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
passes it to `ComposerBannerReport`; the timeline's own banner and stopped-turn rows read the same
`WireAgent` threaded down from `ConversationScreen`'s `openAgent` through `Timeline` and `TimelineRow`.
Every new prop or parameter defaults to `'claude'`, so a Claude conversation, a conversation with no
agent, and every pre-#1656 test are byte-identical to before.

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

A settled failure shows “Could not load older messages” with `role="status"` only
for the displayed conversation's exact owning host while connected, behind every
occupant in the priority above. An unowned slice, another host's equal conversation
id, or another conversation cannot supply it. `ComposerHistoryFailure` uses the
existing recovery layout and `button-small button-small--error`; Retry appears
only for `retryable: true`. Daemon failure text never supplies the copy.

`retryHistoryPage` rechecks the captured displayed conversation object, connected
host, exact held failure object and retryability at activation. Navigation (even
to a new object with the same id), disconnect or a new settlement invalidates the
action. A local read in progress or outstanding request prevents dispatch. Pending
and failed state retain the requested cursor and purpose (`older` or `newest`).
Retry delegates to `requestHistoryPage`, resending that captured cursor with
`HISTORY_PAGE_LIMIT = 200`; newest Retry sends `cursor: ''` even when retained
backwards coverage reports `atStart: true`. Completed coverage blocks older Retry;
legacy failures without cursor/purpose fall back to backwards coverage.
The [existing history request path](request-history-send.md#the-one-fact-that-shapes-every-piece)
preserves rows and successful oldest-end coverage. Starting a retry
removes the settled message and button while pending; correlated success clears
failure, and a new failure supplies its new retryability. No automatic retry is
introduced. Fresh backwards demand can still ask after either classification,
subject to current host ownership, pending/completed-walk guards and trusted
upward input within two thread viewport heights of the top. Page arrival,
programmatic scroll, resize and compensation create no backwards demand. See
[opening/reconnect lifecycle](chat-history.md#received-state-admission-and-ownership).

`historyRetry.test.ts` covers state and stale actions; `historyRetry.test.tsx`
covers ownership, pending disappearance and priority through the real container.
`e2e/history-retry.spec.ts` compares the full retry payload and fresh correlation
id, holds the reply to prove one pending request and retained rows, then releases
success. Immediate replies could conceal duplicate-demand bugs. It also delivers
a nonretryable error and proves fresh upward demand remains available.

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

The daemon's live background tasks were readable in exactly one place — the `BackgroundTaskPanel`
behind the More actions menu — so a turn that ended with several tasks still running looked finished.
This ticket adds the count as the trailing slot's **last** reading, appended to the end of the existing
`??` chain: `recovery ?? refusal ?? notice ?? history ?? taskCount ?? null`, still gated inside the
`status.type === 'connected'` arm. Every occupant documented above outranks it — since [#1494](#mcp-server-failure-notice-1494),
that includes the MCP failure notice — and it is visible only when nothing else in the chain is.

**The count was originally the raw roster size**, `roster.tasks.size + roster.droppedTasks`, read via
`selectRosterFor(open.id)` — the same no-conditional-hook-call shape as the usage-limit read this slot used
to hold beside it, before #1604 moved that read into `TopOverlayControl`. **Since
[#1561](https://github.com/pyrycode/pyrycode-desktop/issues/1561) the count is the LIVE count**,
[`backgroundTaskRosterStore`](background-task-roster-store.md)'s `selectLiveTaskCountFor(open.id)` — the
listed tasks claude has not reported terminal on a `background_task_updated` (`status` exactly
`completed`/`failed`/`stopped`), plus `droppedTasks`. The raw roster size kept the pill lit for a task
that had already finished whenever the emptier roster that usually precedes the terminal update did not
arrive first — observed live for 30+ minutes. The selector swap kept the read's shape: a fresh selector
identity per render still costs a re-subscribe and never a loop, since `selectLiveTaskCountFor` returns a
plain `number`, a stable primitive for `useSyncExternalStore` with no memo needed — the same property the
old `selectRosterFor` read had via its stable held-entry-or-`null` reference. "No roster has ever arrived"
and "observed, nothing alive" are distinct store readings the store itself keeps apart (for the panel),
but both collapse to `count === 0` here, which is the reading this surface is entitled to make and the
panel is not. The store, not this component, owns the arithmetic — see [Background-task roster store —
internals § The pill's
count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561) — so a later
surface counting live background tasks cannot silently disagree with this pill about what counts as
finished.

**`ComposerTaskCount({ count, onToggle, open = false })`** is a pure, exported view in
`ConversationScreen.tsx`, a prop rather than a store read — the same discipline `TopOverlay` follows for
the usage pill it moved out of this file — because zustand v5's `useStore` reads `getInitialState()` under
`renderToStaticMarkup`, so a container test can otherwise reach only one arm. Returns `null` at
`count <= 0` (`<=` rather than `===`, since `droppedTasks` decodes through a plain `requireNumber` and a
hostile or buggy daemon can drive the sum negative); otherwise a real
`<button type="button" className="composer-status__tasks">` holding `'1 task running'` or
`` `${count} tasks running` `` — a two-way conditional over two client-owned literals, no copy module
(unlike #1321's `usageLimitNotice.ts`: one number and one word need no pinning module of their own). No
`aria-label`, no live region — the visible text is already the accessible name, and a count that moves
every turn would announce on each one.

**[#1634](https://github.com/pyrycode/pyrycode-desktop/issues/1634) made the pill a toggle, not only an
opener**, once the [background-task panel](conversation-shell-background-tasks.md) became a non-modal
drawer that stays open across a conversation switch. `ConversationScreen` wires `onToggle` to
`setPanelOpen(!panelOpen)`, where `setPanelOpen` is `PairedShell`'s lifted state when present (see
[Background-task panel § Open state lifted](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)).
The new `open` prop, defaulted to `false`, adds a `composer-status__tasks--open` class — an inset 1px
`--color-primary` box-shadow, the design's Primary outline, chosen over the CSS `outline` property so the
UA focus ring stays free — and an `aria-expanded="true"` attribute only while the drawer is open; at
`open = false` both are absent, so the closed markup stays byte-identical to what every pre-#1634 test
site already asserted — the five existing `ComposerTaskCount` test sites needed only the `onOpen` →
`onToggle` rename, nothing else. The overflow menu's `Background tasks` item is unchanged: it still only
opens, via the same `setPanelOpen`, and never toggles closed.

**The count is a plain `number` all the way to the DOM**, which is the whole trust boundary: the roster
also holds untrusted, model-influenced task `description` and `latestUpdate.patch`, and this slice reads
neither. `ComposerErrorSlotControl` checks `taskCount === 0` before constructing the element (an absent
occupant must reach the `??` chain as actual `null`, never as a non-null element whose component renders
nothing — the standing rule #1321 also states, restated here because this is the chain's new tail).

**`.composer-status__tasks`** takes the neutral Pill treatment `.composer__attachment-name` already
implements (`--space-2`/`--space-1` padding, `--radius-xs`, `--text-body-small-*` at regular weight,
`--color-primary-container`/`--color-on-primary-container` — read by token name, never the Figma export's
light-scheme hex fallback). No `height` — 16px of line plus 4px twice already sums to the row's 24px rest
height. Unlike the two error occupants' `flex: 0 0 auto`, this element ships `flex: 0 1 auto; min-width: 0`
with an ellipsis chain — the #1321 rework leg's layout-hazard lesson applied in advance rather than
re-learned. It costs little (the widest reachable string is ~37 characters, since JS `Number`→`String` is
bounded around 24 digits and fits the 640px pane unshrunk) but means this occupant yields to the row before
the row yields to the window, the way the unshrinkable usage-limit notice did not the first time.

**Lessons learned (from the PR's own retrospective):**

- **A `{/* … */}` comment is a syntax error in a JSX *expression* slot**, not merely unsupported style.
  `trailing={…}` and `statusArea={(sendText) => (…)}` are expression positions, not children, so the JSX
  comment form fails to parse there while a plain `/* … */` works. `tsc --noEmit` reported unrelated type
  errors first; esbuild was the tool that actually named it.
- **A static capture inherits nothing.** A first screenshot rendered the pill in the UA serif because the
  fixture omitted `.conversation`, the ancestor that resolves `--font-sans` — it would have passed a glance
  and every markup assertion while proving nothing about typography. Include any caller wrapper that
  supplies inherited fonts, per [the visual-review recipe](visual-review.md).
- `backgroundTaskRosterStore` is keyed by conversation id **alone**, with no server origin, so two paired
  servers issuing the same conversation id would share an entry — pre-existing, not this ticket's to fix.
  `BackgroundTaskPanel` has the identical exposure and shows task *descriptions* where this pill shows only
  a number, so this ticket strictly reduces what's reachable rather than widening it.
- **A pill still reading the same count after an ineffective frame does not prove the frame was applied
  (#1561).** A `status: ''` frame sent to check that the store leaves the count alone reads identically to
  the frame never having arrived, since the assertion is "count unchanged" either way. The #1561 e2e spec
  proves the frame was applied by relying on a later, effective `stopped` frame for the *same* task: frames
  arrive on one ordered channel, so the pill reaching zero afterward proves the earlier no-op frame was
  processed and not merely unsent or dropped.

Tested in `ConversationScreen.test.tsx` (vitest only — nothing under `e2e/` sent roster frames until
[#1634](https://github.com/pyrycode/pyrycode-desktop/issues/1634)'s `background-task-drawer.spec.ts`): the
count copy and its singular/plural split, the exact-empty absence at zero and at "never observed", the
markup carrying `composer-status__tasks` and never `composer-status__error`, the open/closed modifier and
`aria-expanded` pair (#1634 AC2), and the full `ComposerErrorSlot` precedence matrix with the pill yielding
to every occupant above it in both directions. The e2e spec drives `background_task_roster` frames for two
conversations on one host and covers the toggle and its outline, typing and sending with the drawer open,
Escape against the options overlay and against a running turn, and the drawer surviving a conversation
switch — see [Background-task panel](conversation-shell-background-tasks.md). See
[#1435](https://github.com/pyrycode/pyrycode-desktop/issues/1435).
