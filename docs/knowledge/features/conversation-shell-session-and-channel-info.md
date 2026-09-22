# Conversation shell — session boundaries and channel info

The session-boundary delimiter row and the Channel Info sheet — two conversation-wide surfaces split out of [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md) on 2026-09-02 to keep that document under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Session-boundary delimiter (#286, redrawn #690)

The fifth `ThreadItem` kind's render row (transport half was #285): marks where a `/clear`, an idle
eviction, or a workspace change started a fresh session. `TimelineRow`'s `sessionBoundary` case renders
a `<div className="session-delimiter">` — deliberately **no `data-thread-role`** (AC4, keeping it out of
the assistant/user/tool bubble count).

**#286 shipped it in mobile's shape** (Figma node 16-35): a monospace title stacked above a single
full-width rule, the title joined to a **long-form** relative time (`formatSessionBoundaryTime`, `2
hours ago` — a deliberate sibling of `channelListViewModel.ts`'s short-form `formatLastActivity`) via a
`now` prop threaded from `ConversationScreen`'s `Date.now()` through `Timeline` → `TimelineRow`. Copy for
`clear`/`idle_evict` was provisional (`New session` / `New session after idle`) since the Figma drew only
the `workspace_change` variant.

**#690 redrew it as the desktop chat screen's own shape** (Figma node 119-3843): one 16px-tall row —
hairline rule, centred label, hairline rule — replacing the stacked layout. Two copy decisions the
operator took 2026-08-22 drove the change: the reason still has to read differently in the words
themselves, so the label is no longer provisional — `Session reset` for `clear`, `Session reset after
idle` for `idle_evict`, narrower than the Figma's single "Session reset" node — and the relative time is
gone entirely, since every message above and below the row already carries its own timestamp.
`sessionBoundaryTitle(item)` in `sessionBoundaryViewModel.ts` collapsed from the two-function long-form
module into a single exhaustive label switch (`workspace_change` unchanged: `Workspace changed to
${workspaceCwd}`, degrading to the pathless `Workspace changed` on a `null` path); `formatSessionBoundaryTime`
and the `now` prop threaded through `Timeline`/`TimelineRow` for its sake are both deleted —
`ConversationScreen`'s own `now` stays, since the [Channel Info](#channel-info-sheet-365) and [Workspace
Picker](conversation-shell-workspace-chip-and-picker.md#workspace-picker-sheet-383) sheets still read it for their own relative-time lines.

The row is now two identically-classed `.session-delimiter__rule` siblings bracketing the centred label,
each `flex: 1 0 0` inside a `nowrap` flex row — equal halves at every container width by construction,
nothing kept in sync via a width or percentage. The label takes `--color-primary` and `--font-sans`
body-small (no `font-family` declaration — `.conversation` already sets `--font-sans` and a `<p>` has no
UA font-family to fight); the two hairlines take a new token, `--color-inverse-primary` (`#32628d`, M3
Schemes/Inverse Primary, `tokens.css`), at the Figma's own 60% opacity. `workspaceCwd` (an untrusted
daemon filesystem path) still reaches the DOM only inside the label string as auto-escaped React
children — the `toolCall`/`userText` posture, unchanged since #286. Both rules stay decorative
`aria-hidden` styled `div`s, not semantic `<hr>`s.

Row clearance (16px above/below) was originally the *sum* of `.conversation__thread`'s `gap:
var(--space-3)` (12px) and the row's own `--space-1` padding (4px) — not `--space-4`, which would have
doubled the container's then-gap into 28px. [#1444](../../specs/architecture/1444-chat-top-bar-and-inset.md)
retuned the thread's gap to `--space-4` (16px) for the chat card's own inset and deleted the row's
padding outright rather than zeroing it, since the gap alone now draws the same 16px clearance this
section originally split two ways — the CSS comment predicted this exact silent breakage ("if that
container gap ever changes, this number is what silently breaks") and it broke exactly that way, caught
by neither the new ticket's own spec nor any other, only by re-reading the comment. AC5 (equal halves
under resize; a long unbroken workspace path wrapping inside the row rather than stranding a rule) was
settled as review-by-inspection in the spec, since nothing
under `renderToStaticMarkup` can measure layout — but the PR discovered that the Playwright Electron tier
actually *can* resize the window (`app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
.setSize(w, h))`; `page.setViewportSize` still does not apply to an Electron page), so AC5 was verified
by measuring real rects at 800px and 1600px rather than only inspected. The explanatory sentence and
`Install` affordance (Figma 16-38, #286's mobile file) remain out of scope, deferred with the
memory-plugin subsystem neither ticket depends on. See [#286 codebase notes](../codebase/286.md) for
\#286's original design and patterns established.

**The shadow (the 2026-09-05 shadow fix).** The design draws the message area's one drop shadow on this
row's frame too ("Session reset" 119:3843; X 0, Y 4, blur 5, black at 20%, the `--shadow-thread` token —
see [message bubble § The shadow](conversation-shell-message-bubble.md#the-shadow-the-2026-09-05-shadow-fix)).
The frame has no fill, and Figma shadows what an unfilled frame *paints*, the two hairlines and the label,
never its box — so `.session-delimiter` itself carries no shadow (a box-shadow there would paint a
rectangle under 16px of empty thread) and the painted parts carry it in their own form: each
`.session-delimiter__rule` as a `box-shadow` (a 1px band's box is its painted shape; the 60% opacity
dims the shadow with it, the composite Figma renders), and `.session-delimiter__title` as a
`text-shadow`, which shadows the glyphs and has no spread slot — the reason the token writes none.
`e2e/thread-shadow.spec.ts` asserts `none` on the row and the value on all three parts.

### Compaction dividers

`TimelineRow` renders `compactionBoundary` with the same `.session-delimiter`
hairlines, centred body-small label, spacing and painted-part shadows. It adds
`.compaction-delimiter`, keeps both rules decorative, and has no `data-thread-role`.
The [timeline store](conversation-timeline-store.md#what-it-does) owns insertion,
delayed enrichment and retention; the view never infers completion from status.

[`compactionBoundaryTitle`](../../../src/renderer/src/screens/conversation/compactionBoundaryViewModel.ts)
starts with `Conversation compacted`. Until metadata arrives that generic label
remains at the completion's original position. Two non-negative safe-integer counts
add `, 180k → 40k tokens`: values below 1,000 are integers, and larger values use
thousands rounded to one decimal with trailing `.0` removed (`999`, `1k`, `1.1k`).
If either count is missing, null or unusable, the entire count phrase is omitted;
zero remains a count (`0 → 0 tokens`). Only the exact trigger `manual` adds
` by you`, after any count phrase. Auto, empty and unknown triggers add no suffix.

Failures always read `Compaction failed`, with neither counts nor manual attribution.
`.compaction-delimiter--failed` changes only the label to `--color-error`; the rules
retain their existing styling. Rows hold classified failure/manual flags and counts,
so raw result, trigger and error strings never enter the label or its attributes.
These are reported outcomes and sizes, not an inference about Claude's memory.

The [label tests](../../../src/renderer/src/screens/conversation/compactionBoundaryViewModel.test.tsx)
pin rounding, zero versus absence, failure precedence and static markup.
[`e2e/compaction-divider.spec.ts`](../../../e2e/compaction-divider.spec.ts) proves
frame delivery to the rendered thread, delayed enrichment after an intervening row,
manual/automatic/failure labels, standalone boundaries, successive compactions,
conversation isolation and scroll/navigation/reconnect retention. It also measures
equal rules and checks shadows, typography and error colour. Its
[reconnect delivery barrier](e2e-harness.md#reconnect-delivery-evidence) is required
before checking that transient status disappeared. These client behaviours need
no live Claude run.

## Channel Info sheet (#365)

Makes the thread overflow menu's **Channel info** item (#276, previously a live no-op) open a new
bottom sheet (Figma node 20-48), reusing the Run-configuration `StatusSheet`'s `.status-sheet__*`
chrome verbatim — the second sheet to do so. Renders the active conversation's **About** detail
(Workspace `cwd` + Last activity), read-only **Session** facts (#1241), a read-only **MCP servers**
list (#1490), a **System prompt** section (#1078), **Actions**, and a monospace **Channel ID** footer.
The Session report and the MCP report both arrive through the validated daemon event path; the sheet
owns only their display.

```
.conversation
├── … (StatusSheet, when sheetOpen)
└── ChannelInfoSheet                    (mounted last, when channelInfoOpen)
    └── ChannelInfoSheetView
        ├── .status-sheet-overlay__scrim         (onClick → onClose)
        └── .status-sheet  role="dialog"
            ├── .status-sheet__handle
            ├── .status-sheet__header             title (name / "Unnamed conversation" / "Channel info") + close
            └── .status-sheet__body
                ├── "About" section-header
                ├── .channel-info__row × 2          Workspace (mono, cwd) / Last activity  — or —
                ├── .channel-info__empty            "No conversation details yet" (conversation === null)
                ├── "Session" + two detail rows     Claude version / Reported permission mode (conversation !== null)
                ├── McpServersSection                #1490, conversation !== null only — see below
                ├── SystemPromptSection              #1078, conversation !== null only — see below
                ├── "Actions" section-header
                ├── .channel-info__actions          mount point for #366/#367/#368 (Rename+Archive built, Delete #367 open)
                └── .channel-info__footer           "Channel ID: {id}" (omitted when conversation === null)
```

**Open-state ownership stays local, not threaded through `PairedShell`.** `channelInfoOpen` is a new
`useState(false)` in `ConversationScreen` — the `sheetOpen` precedent (ADR 0006) — flipped by the
overflow menu's `onChannelInfo={() => setChannelInfoOpen(true)}`. This is a deliberate divergence from
\#276's original design: #276 shipped a speculative `ConversationScreenProps.onChannelInfo?` seam
assuming the sheet would live *above* `ConversationScreen` (opened by `PairedShell`). #365 retired that
prop instead (removed from the interface and the destructure) because the sheet's trigger, data
(`activeConversationStore`), and chrome are all `ConversationScreen`-local, exactly like `StatusSheet` —
splitting one sheet's control across two files for zero behavioral gain would have contradicted the very
precedent the seam was named after. No caller ever passed `onChannelInfo` (`PairedShell`, `App.tsx`, and
every test constructed props without it), so the removal is a pure simplification, not a breaking change.

**The menu that hosts this item grew from one item to three in
[#962](https://github.com/pyrycode/pyrycode-desktop/issues/962).** `Channel info` was `ThreadOverflowMenu`'s
only item until #962 retired the run-configuration row (#177) and the background-task trigger (#581),
both of which had no drawn home in the desktop design, and gave each a menuitem here instead —
`Run configuration` and `Background tasks`, added after `Channel info` in that order. `onChannelInfo`
went from #276's optional prop to one of three **required** action props on `ThreadOverflowMenu`, and
`ThreadOverflowMenuView`'s single literal `<button role="menuitem">Channel info</button>` became a map
over three `{ label, onSelect }` entries kept as literals inside the view — this item's copy and position
are unchanged, but it is no longer the only thing the view renders. See [Run-configuration row and
background-task trigger
retired](conversation-shell-chrome.md#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962)
for the other two items' own design.

**`conversation === null` renders gracefully, not a crash.** [`activeConversationStore`](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278)
is written by `activateConversation` on both a FAB create-nav callback and a sidebar row's `onOpen`
(which hands the clicked `ConversationSummary` row straight to the store — a structural superset of
`ConversationCreatedPayload`), and, since
[#1184](https://github.com/pyrycode/pyrycode-desktop/issues/1184), re-seeded by
[`activeConversationReseedBridge`](paired-shell-conversation-exits.md#the-list-reseed-activeconversationreseedbridgets-1184)
whenever a later list reply describes the open chat differently — so a thread opened from the channel
list populates it too, not only a freshly created one. The `conversation === null` branch below is
therefore not a "list-opened vs. created" distinction; it covers the one path that activates no
conversation at all — the notification-activated `open` dispatch (#393), which carries no payload and
shows whatever was already active, so a notification arriving before any conversation has ever been
opened this session leaves the store at its initial `null`. The sheet still opens in that case: chrome +
a `CHANNEL_INFO_EMPTY_COPY` placeholder line in place of the About rows, and the Channel ID footer
omitted entirely (there is no id to show). `conversation.name === null` (an unnamed scratch conversation)
is a separate, narrower case — the title falls back to `UNNAMED_CONVERSATION_LABEL` — distinct from no
conversation at all.

**Deferred, not invented:** Figma 20-48 also shows Created / Total sessions / Total messages rows and a
Memory section — none has a field on the desktop `ConversationCreatedPayload`, so none is built. The
Channel ID footer ships at the app's `body-small` (12px) mono token rather than Figma's 11px — a
type-scale simplification (the app's fixed vocabulary is the fidelity ceiling, not a literal Figma
pixel match), not drift.

Escape-to-dismiss is wired via the same `document`-`keydown`-listener-scoped-to-mount-lifetime idiom
\#276 established (`DocumentEventMap['keydown']`, not a bare `KeyboardEvent` — this file's top-level
`import { type KeyboardEvent } from 'react'` shadows the DOM type). Untested here, same as #276's
Escape/outside-click and `StatusSheet`'s open-on-click wiring — the suite is `renderToStaticMarkup`-only,
no jsdom, so interactive effects are reviewed glue, not asserted. Not security-sensitive: the only daemon
strings rendered by the original shell (`name`/`cwd`/`id`) are already rendered elsewhere in this file
as auto-escaped React children, the toolCall/sessionBoundary posture (`WorkspaceChip` carried it until
[#1486](https://github.com/pyrycode/pyrycode-desktop/issues/1486) deleted that component). Session report text follows the
bounded display rules below. See [#365 codebase notes](../codebase/365.md) for the full
design and patterns established.

### Session reports

For an identified conversation, **Session** sits after About and before System prompt, reusing the
desktop sheet's section heading and detail rows. **Claude version** and **Reported permission mode**
show **Not reported** before a report arrives or when that field is an empty string. Unknown mode
names and non-semver version strings display verbatim as escaped React text, bounded to 256 Unicode
code points per field and allowed to wrap. **Truncated** appears separately beneath a value when
`truncated_fields` names its wire field (`claude_code_version` or `permission_mode`), or when the local
display cap cuts it. An empty reported field can therefore show both Not reported and Truncated.
With no conversation, the existing placeholder remains and Session is omitted.

These are reported claims, never permission controls: they do not change the selected permission
setting or approval behavior. A `session_facts` frame neither starts a turn nor identifies a session,
and creates no timeline entry. It carries no resolved effort; no effort value is inferred from it.
The [decoder](inbound-message-decode.md) requires all three string fields (including
`conversation_id`) and `truncated_fields: string[] | null`, discards unknown payload fields, and
preserves empty strings and unknown truncation field names. Shape validation must not narrow the
permission report to the control-request enum. Malformed reports use the existing decode failure
path; diagnostics contain only static classification, frame length and hash, never report text.

`SessionFactsData`, mounted in `App`, subscribes through the [daemon-event channel](daemon-event-channel.md)
even while the sheet is closed. `sessionFactsStore` retains the latest complete report in an in-memory
Map keyed by conversation id, following the [announced-model store](announced-model-store.md) pattern.
Every report replaces both values and the truncation metadata, including empty strings and null or
empty lists; it is not a partial merge. The sheet selects only its conversation's record, with null
for an unknown conversation. Closing the sheet, switching conversations and reconnecting retain
reports; `clearPairingScopedState` unconditionally clears the whole Map at pairing teardown. Reports
are not persisted, and receipt has no turn, modal or question action.

**Testing.** `SessionFacts.test.tsx` covers the pure view's missing, empty, unknown, escaped and
truncated states, section order and no-conversation placeholder. Static rendering cannot prove the
app-level listener is mounted. `e2e/channel-session-facts.spec.ts` sends facts before opening the
sheet, then waits for a later conversation-list frame to become visible as a delivery barrier. That
ordering prevents a sheet-mounted listener from accidentally passing the pre-open retention check.
The fake-transport test also observes updates while open and switches both ways between two
conversations. Store and cleanup tests cover complete replacement, isolation, hostile Map keys and
pairing reset. See [verification boundaries](development-verification.md#what-each-test-tier-proves).

### Session running cost, as Claude's estimate ([#1567](https://github.com/pyrycode/pyrycode-desktop/issues/1567))

A third Session row, after Claude version and Reported permission mode: **Cost (Claude's estimate)**,
`$0.42 est.`. Unlike the two facts rows above (a `session_facts` frame retained in a store), this reads
`costUsdTotal` off `turnBoundary` items already in the open conversation's timeline — [thread timeline
internals](thread-timeline-internals.md#types) has that field's shape, landed by #1565 and first read by
[#1566's turn-stats hover](conversation-shell-message-bubble.md#turn-stats-on-hover-1566), a sibling
consumer of the same field. `costUsdTotal` is claude's own running total for the *whole session*, an
estimate the daemon does not verify — pyrycode's `docs/protocol-mobile.md` (§ `turn_end`) forbids
presenting it as the app's own accounting, hence the label attributing it to Claude rather than a plain
"Cost".

**`latestSessionCostUsd(items)`, in the new `sessionCost.ts`,** scans the timeline backwards and returns
the first `turnBoundary`'s `costUsdTotal` that is present, finite and above zero; `null` with none.
Never summed — each reported value already includes every turn before it — so a later boundary whose
value is absent, `0`, negative or non-finite is skipped rather than replacing the earlier positive one.
`formatSessionCost(usd)` rounds to cents with `toFixed(2)`. `ConversationScreen` calls
`latestSessionCostUsd(items)` only inside the `channelInfoOpen` branch, so the backward scan runs while
the sheet is mounted, not on every timeline update; the verifier flagged the resulting per-render
recompute as a NIT and left it, since the scan is cheap and the sheet's re-render rate is already low.
`ChannelInfoSheetView` takes the result as `sessionCostUsd?: number | null` (default `null`) and renders
the row only when it is non-null, after the two facts rows and inside the same `conversation !== null`
block — no cost row for the graceful-empty, no-active-conversation case either, and none until a turn has
actually reported a positive figure.

**A `/clear` or new session is not a reset.** The ticket's rule is the most recent positive value *in the
open conversation's timeline*, applied literally: the previous session's total keeps showing across a
`sessionBoundary` until the new session's own first turn ends and reports its own `costUsdTotal`. Flagged
in the PR as a possible follow-up if that reads as misleading to an operator, not fixed here.

**Testing.** `sessionCost.test.ts` pins the latest-not-summed rule, that a later absent/zero/negative/NaN/
infinite value never overwrites an earlier positive one, the `null` cases, and the three formatting
examples. `SessionFacts.test.tsx` adds the row's presence with a cost and absence without one, plus its
position between the Session header and Actions. `e2e/channel-info-session-cost.spec.ts` (fake transport)
opens the sheet before any turn (no row), sends three messages whose `turn_end` frames report 0.10, then
0.42, then none, and confirms the sheet shows exactly `$0.42 est.` — never a summed `$0.52` — under the
Claude-attributed label.

### MCP servers section ([#1490](https://github.com/pyrycode/pyrycode-desktop/issues/1490))

A read-only list of claude's MCP servers, sitting after the Session facts rows and before the System
prompt section — #1489's decoded `mcp_status` report carried the rest of the way, slice for slice on
[#1241 session facts](#session-reports)'s path: one `DaemonEvent` member (`mcpStatus`), an ignore arm
on each of the four exhaustive renderer bridges, a `Map`-keyed store (`mcpStatusStore.ts`) retaining one
report per conversation id, an always-mounted `McpStatusData` bridge (`App.tsx`, beside
`SessionFactsData`) so a report lands while the sheet is closed, and an unconditional `clearMcpStatus()`
in `clearPairingScopedState`. `selectMcpStatusFor(id)` returns `null` for "no report has arrived" and a
`{ servers: [], droppedServers }` report for claude's own positive "no servers" — the two states the wire
doc requires apart stay apart end to end.

**Wording.** `McpServersSectionView` (pure, `report | null` plus `showBuiltIn` in → markup out) picks
one of four lines: `report === null` → *No MCP report has arrived yet.* (no toggle, no rows); an empty
`servers` → *Claude reported no MCP servers.*; a non-empty `servers` fully hidden by the built-in filter
→ *Only built-in servers are reported.*; and, independently, `droppedServers > 0` → *Partial list: N more
servers were left out by the daemon.* stacked beneath whichever of the first three applies. The review
that shipped this (PR #1576) flagged as a non-blocking SHOULD FIX that the third case can still read as
self-contradictory when the daemon drops every row (`servers: [], droppedServers > 0` shows both "Claude
reported no MCP servers." and the partial line back to back) — left unfixed as a deliberately unlikely
edge case, along with a NIT that the partial line never pluralizes ("1 more servers"). Fix both together
if this section changes again.

**Show built-in** is a `useState(false)` owned by the container (`McpServersSection`), not persisted and
not read from the store — every sheet open starts hidden, matching "off by default". It filters rows
whose `name` is exactly `pyry_approve` or `pyry_files`, the daemon's own servers on every non-bypass
spawn, matched against a client-owned constant list — display-only, never a behavior gate. Rows keep
claude's order (never sorted) and are `key`ed by array position, since a claude-authored `name` must
never become a React key, a `Map` key or any other identity. Each row shows the name, a 6px
`--radius-full` dot styled on the sidebar `ConversationStatusDot` (`--color-success` for exactly
`connected`, `--color-error` for exactly `failed`, `--color-outline` for every other word — a closed
three-way client set, `status` itself is never parsed or mapped), and the status word verbatim. A
non-empty `error` renders as its own `<p class="channel-info__mcp-error">` beneath the row with
`white-space: pre-wrap`, so an embedded newline stays inside that one text block; an empty `error` adds
nothing. Name, status and error are each bounded to 256 Unicode code points with a trailing `…` on cut,
the same bound `SessionFacts` uses for reported fields — every string reaches the DOM only as an escaped
React child, never an attribute, a URL, a filename or a log line.

`MCPServerStatus` also carries `scope` and `version` (both copied into the store's retained rows), but
neither is rendered here — this ticket draws only what #1490's acceptance criteria named. A later ticket
adding either should read `mcpStatusStore.ts`'s row-copy first: the fields are already flowing.

**Testing.** `McpServersSection.test.tsx` (static render) pins the four wording states, claude's row
order, the tone-by-exact-word mapping, the error line's escaping and newline, the built-in filter both
ways, the 256-code-point bound, and that no daemon string reaches an attribute. `daemonConnection.test.ts`
asserts the `mcp-status` arm emits exactly one named-field event and drops a malformed frame — added
because, per the PR's Lessons learned, a test asserting only "no event emitted" would have passed both
before and after this ticket, since #1489 already decoded the frame but nothing downstream consumed it.
`e2e/channel-mcp-servers.spec.ts` (fake transport) pushes reports for two conversations before opening
the sheet (the closed-sheet retention proof), toggles built-in visibility, and confirms a report survives
closing the sheet and switching conversations; reconnect survival is structural, proven by
`clearPairingScopedState.test.ts` rather than driven live. Not `needs-real-claude`: the acceptance is a
daemon frame rendering, which the fake transport already covers end to end.

**Rename action ([#368](../codebase/368.md)), retitled Edit chat ([#1440](rename-conversation-dialog.md)),
split into Edit channel / Edit chat by conversation kind ([#1431](edit-channel-dialog.md)).**
The Actions slot's first filler: a Material 3 tonal pill (Figma 20:89, `.channel-info__action`)
rendered only when the container supplies an `onRename?` callback — supplied exactly in the
`conversation !== null` branch, so the null-conversation graceful-empty case (above) offers no
Edit action either. The pill's word and the dialog it opens both split on the same expression,
`conversation.is_promoted` — the wire's only signal for "a saved channel" vs. "an ad-hoc
discussion" (there is no `kind` enum), and the same field the view already reads `cwd`, `name` and
`last_used_at` off a few lines up, so the word is derived from data already in scope rather than
handed in as a second, possibly-disagreeing authority. A promoted channel reads **Edit channel** and
mounts [#1476/#1477's `EditChannelDialog`](edit-channel-dialog.md) for the conversation's id,
displayed name and server; anything else reads **Edit chat** and opens the existing [Edit chat
dialog](rename-conversation-dialog.md) (`EditChatDialogView`, `RenameConversationDialogView` before
\#1440), byte-for-byte as #1440 left it, Archive chat button included. Both arms seed and drive a
single second screen-local `useState` pair (`renameOpen`/`renameName`) the `ChannelInfoSheet`
container grows, mirroring `ChannelList.tsx`'s row-level rename state shape — no second cell for the
channel arm. Save on either arm dispatches the already-shipped `renameConversation` command (#359)
via `requestRenameConversation`, imported verbatim rather than cloned. That helper's `row` param
narrowed from `ConversationSummary` to `Pick<ConversationSummary, 'id'>` (it only ever read `.id`)
so the sheet's `ConversationCreatedPayload` — a narrower 5-field shape lacking
`is_archived`/`last_message_ts` — passes directly, no adapter, no cast; the existing `ChannelList`
call site is unaffected (a wider shape still satisfies the narrower `Pick`). The pill's own prop
name, `onRename`, is unchanged across both arms — it still opens a rename-capable dialog, only the
rendered word and, for a channel, the dialog itself moved. No new transport, IPC, or wire code.

The channel arm carries one condition its chat twin does not: `serverId !== null && available`,
where `serverId` is resolved at render time
(`serverIdForOpenConversation(useConversationListStore(selectConversations), conversation?.id)`)
because `EditChannelDialog` needs the host id as a prop to gate its own daemon subscription, and
`available` is this sheet's existing `connected(…)` equivalent. `EditChatDialogView` instead carries
that condition itself, as its `available` prop — the channel dialog has no such prop by design (see
[Edit channel dialog](edit-channel-dialog.md)), so the sheet supplies the render gate from outside
instead. Both are already true whenever the pill is clickable (`onRename` is withheld unless
`available`), so the pair only ever fires as a *close on host loss*, never as a refusal to open. The
channel arm's `onSave` restates `ChannelList`'s own save order — a live
`connectedConversationHostNow(conversation.id)` re-check, then the dialog's own prompt write, then
the rename, then dismissal — with one deliberate divergence from `ChannelList`: **no
unchanged-name no-send.** The sheet has always sent its rename unconditionally regardless of which
dialog answers it, and giving the channel arm alone a no-send comparison would make one pill mean two
different things depending on what kind of conversation is open. See [#368 codebase
notes](../codebase/368.md) for the Rename action's original design and patterns established, and
[Edit chat dialog](rename-conversation-dialog.md) for the #1440 retitle and its Archive chat button
(which now duplicates, inside that dialog, the send-then-close-both sequence the Archive pill below
already used).

**Archive action ([#366](../codebase/366.md)).** The Actions slot's second filler, landing one
merge after Rename and reusing its `.channel-info__action` tonal pill (Figma 20:94) verbatim — no
new CSS. Same callback-gate shape as Rename (`onArchive?`, supplied by the container only when
`conversation !== null`), but the handler itself is simpler: no dialog, just dispatch-then-close.
Activating it fires the already-shipped, previously-dormant [`archiveConversation`
command](conversation-archive.md) (#363) via a new exported helper, `requestArchiveConversation` —
a structural clone of `requestUnarchiveConversation` (`ArchiveScreen.tsx`) — with
`{ conversation_id: conversation.id }`, fire-and-forget, then calls the container's existing
`onClose`. Button order is Rename → Archive → the future Delete (#367), a destructive-last
convention. The archived conversation leaving the active list needs no new code here: the daemon's
`conversation_updated` broadcast reply rides the existing #275 list-re-request path, the same
mechanism the restore flow already proved in reverse (#346/#348). No transport, IPC, or wire code.
See [#366 codebase notes](../codebase/366.md) for the full design and patterns established.

**System prompt section ([#1078](https://github.com/pyrycode/pyrycode-desktop/issues/1078)).** Renders
the surface for the `set_system_prompt` vertical that had been built and dark since #1230: the whole
data path — [System-prompt store](system-prompt-store.md) (#1231, the read half) and [System-prompt
write store](system-prompt-write-store.md) (#1250, the write half) — already existed with nothing
rendering it. This ticket adds no wire type, no envelope and no IPC arm; it is renderer-only.

Its own file, `SystemPromptSection.tsx`, the `WorkspacePickerSheet.tsx` precedent in this directory —
not a fourth thousand lines in `ConversationScreen.tsx`. Three exports in the order state flows:
`deriveSystemPromptSection(reading, write, draft)` is the whole state machine as a pure function (so
every arm is a vitest case rather than a render); `SystemPromptSectionView` is the pure markup (props
in, JSX out, no store, no `window.pyry`); `SystemPromptSection` is the thin container that reads the
two stores, owns the draft, and dispatches.

`ChannelInfoSheetView` gained one optional prop, `systemPromptSection?: ReactNode`, rendered between
the Session rows and the `Actions` section header — the `StatusSheet` `children` slot idiom in narrow
form, keeping the view itself pure. `ChannelInfoSheet` supplies
`<SystemPromptSection conversationId={conversation.id} />` only in the `conversation !== null` branch,
the same callback-gate the Rename/Archive/Delete actions use, so the list-opened graceful-empty case
grows no editor and `conversationId` is a plain required string with no id-or-empty-string fallback.
The section brings its own `.status-sheet__section-header` ("System prompt"), so the slot needs none.

**The tri-state and its one legitimate collapse.** A conversation's stored prompt is
`string | undefined` (no prompt at all) vs. `''` (an explicitly empty one) vs. text — and `reading`
itself can be `null`, a fourth state meaning "nothing has arrived yet." The `null` reading renders a
`loading` arm with **no editor, no Save, no Clear** — structural, not a rule an implementer has to
remember, and it is what makes an unanswered conversation unable to be saved blank over a stored value
(AC1). The `undefined`/`''` distinction collapses only in the editor's *display* seed (both show an
empty box, and always will, since they are indistinguishable to the eye) — never on the write side:
Save always sends a `string` (`''` when the box is empty), Clear always sends `null`, and Clear is a
control the operator presses, never inferred from an empty box. `draft: string | null`
(`useState`, ADR 0006) tracks whether the operator has touched the box; once non-null, a late-arriving
reading is never read for display again — the guard against an on-path relay's delayed reply silently
replacing text already typed.

**The byte count.** `new TextEncoder().encode(text).length`, a module-hoisted encoder, counted live
against the imported `MAX_SYSTEM_PROMPT_BYTES` (never restated) — matching `daemonConnection.ts`'s
`Buffer.byteLength(prompt, 'utf8')` exactly (both replace an unpaired surrogate with U+FFFD), so the
count never reports "under" on a value main refuses. Save is disabled once `byteLength >
MAX_SYSTEM_PROMPT_BYTES` (inclusive bound: exactly 8192 is legal) rather than waiting for main's own
`prompt-too-long` refusal — that refusal stays the authority; the client-side count only stops it being
the operator's first news. Both Save and Clear are withheld while a write is `in-flight`, which also
closes [System-prompt write store](system-prompt-write-store.md)'s two-writes ambiguity behaviourally,
since that store correlates on conversation id alone with no per-write identity to disambiguate.

**Session status copy.** `sessionPromptStatus === 'differs'` renders a notice naming **Reset session**
(renamed from New session by [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496), which
folded the Actions menu's two reset rows into the one this notice now names) as what applies the saved
prompt; `matches` and `no_session` render nothing. The confirmed-write line *also* restates that same story
in a form true under all three statuses ("Saved. A running session keeps the prompt it started with until
Reset session.") — a form conditioned on `sessionPromptStatus` would go stale the instant a save lands,
since nothing re-asks after a write.

**Copy is entirely client-owned**, mirroring `CHANNEL_INFO_*`'s module-constant idiom, apostrophe-free
(`renderToStaticMarkup` escapes `'` → `&#x27;`). The four `SystemPromptWriteFailure` reasons and the
three `SessionPromptStatus` values are both closed unions narrowed at the decode boundary, so no daemon
string ever reaches the section's copy.

**Security.** The stored prompt is untrusted, operator-authored, network-relayed text, and this is the
first consumer that renders *and edits* it rather than merely holding it — the deny-list [System-prompt
store](system-prompt-store.md#security) restates is discharged here, not inherited by reference. It
reaches exactly one sink, a controlled `<textarea value={…}>`: an escaped text child server-side, a DOM
property in the browser, never a serialized attribute, never `dangerouslySetInnerHTML`, never a URL, a
filename, a cache key, a lookup path or a React `key`. Nothing on the path normalises or trims the
value — it round-trips back to the daemon as a write, so any normalisation would silently change what
the operator stored. Nothing here logs, on any branch, including the byte count — it is rendered into
the operator's own window because AC3 requires it, never to a console, a file or telemetry. The draft
lives in `useState` only and dies with the sheet's unmount: an operator can paste a credential into a
system prompt, so nothing on this path touches `localStorage`, `sessionStorage`, IndexedDB or zustand
`persist`/`devtools`. Builder self-review, verdict PASS.

**CSS** (`conversation.css`, `.system-prompt__*`) borrows rather than invents, since Figma 102-595 draws
the sheet this section joins and not the section itself: `.status-sheet__section-header` for its
heading, the `.channel-info__row`/`__empty` padding rhythm for its prose lines, the Rename dialog's
outlined field (`.rename-conversation__field`/`__input`, Figma 19:16) for the editor, and
`.channel-info__action`'s tonal-pill treatment for Save and Clear. No new colour, size or spacing token.

**Testing.** `SystemPromptSection.test.tsx` (vitest, `renderToStaticMarkup`) covers
`deriveSystemPromptSection` directly — the loading arm, the `undefined`/`''`/text seeds, a typed draft
surviving a late reading, the inclusive 8192 bound (and one byte over, with a multi-byte character), all
four refusal reasons, and `differs` vs. `matches`/`no_session` — plus the view's markup: no `<textarea>`
and no Save in the loading arm, a `<script>`-bearing prompt landing inert as an escaped textarea child,
and `disabled` present on Save both over-limit and in-flight. `e2e/channel-system-prompt.spec.ts` (fake
tier) is the vertical's first end-to-end drive: a spec-local fake answers `request_system_prompt` with a
seeded prompt and `session_prompt_status: 'differs'`, then the spec opens Channel info, asserts the
seeded value and the `differs` notice, types a string whose UTF-8 byte length diverges from its
code-unit length (to pin AC3's byte-not-code-unit count), and asserts the captured `set_system_prompt`
frame carries the typed text verbatim on Save and `system_prompt: null` on Clear. Live confirmation
(saving never restarts a session, survives an app relaunch) is #2151's daemon-side guarantee and stays
unproven end-to-end (`needs-real-claude`).

Two Open Questions from the spec were resolved in Phase B without changing the design: Clear stays
visible on an already-clear conversation (a well-defined no-op write, withheld only in-flight like
Save), and the confirmed line does restate the session story, in the stale-safe form above.
