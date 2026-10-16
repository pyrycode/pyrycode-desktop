# Conversation shell

The desktop conversation pane: a full-height message scroller behind a fixed translucent header and input area, beside the paired shell's sidebar.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders the open chat's live timeline and composer. Messages scroll behind translucent controls across the full pane. At history start, the first row keeps its 97px header clearance and 20px horizontal inset; while following, the newest row clears the complete occupied input area. The sidebar and footer actions, context reading, attachment button, model, effort and permission selectors retain their desktop layout. Sending with Enter or the button adds an optimistic echo; see [Composer send](composer-send.md). The [Markdown reader](conversation-shell-markdown-reader.md) retains its independent overlay; its translucent adaptation remains follow-up work.

The production `ThreadItemsTimeline` combines retained daemon snapshots with scoped
local pending rows from [Composer send](composer-send.md#data-flow).
The [thread runtime](thread-runtime.md) supplies
[summary-only session authority](session-id-store.md#summary-authority-in-the-thread-runtime),
[live status and lifecycle inputs](conversation-shell-turn-status.md#session-scoped-live-presentation)
and [host-bound prompts](modal-store-bridge.md#session-scoped-thread-prompts).
Every host must accept `thread`; a host without it shows the daemon update-required
state and draws no conversation rows. There is no legacy fallback.
After acceptance, text and valid supplied attachment facts come exclusively from the
daemon `user_message`; local content is retired rather than matched by text or kept
as accepted truth. No resend repairs display, and legacy echoes and `queueStore`
add no rows to this view. #2023 removed `Timeline`, `foldQueuedRows`, provisional
Agent placement and the roster-connected drawer. #2030 deletes the remaining
renderer reconstruction reducer/holders, history demand/retry and joins,
gap/receipt ledgers, inferred rosters, legacy echo settlement, exclusive queue
actions and local-count read bookkeeping. Shared row/types/translators remain at
their existing paths. #2029 separately retired renderer legacy saved IO; main/IPC
and saved-format/storage retirement remain #2025 and #2026 respectively.

Composer reports read canonical items for the bound session; status and session
errors read admitted host/conversation/session live state. Without a snapshot,
content reports and item previews are empty; without a binding, current-session
reports and live activity are empty. Existing items, unaccepted local sends and independently admitted
prompts keep their own lifetimes. None of these missing inputs activates a legacy
fallback. Sidebar/badge unread compares only received owning-host shown/read marks.
Refusal recovery still forwards new model-selection writes to `threadRuntime.refusals`.

Accepted user items without a positive order sit at the tail in snapshot first-arrival
order. Delivery revises that same scoped item into its supplied positive position,
without another row. Tail placement belongs inside `nest`'s sibling-lane comparator;
a pre-sort is overwritten by agent placement. Existing parent nesting, agent launch
markers and active/ended placement remain intact. Queued bubbles keep their dimming
even when disconnected or lacking an actionable handle.

Drop and Send now require a shown, active, queued `user_message`, a connected owning
host and an injected action callback. The target must be a usable positive safe
integer `content.queued_msg_id`; enclosing-record and field truncation/drop markers,
malformed marker lists and missing or inexact handles suppress actions. Item 100
with queue handle 7 targets entry 7, never item 100. The callback receives the snapshot
host plus an existing `dequeueMessage` or `sendQueuedNow` command for its conversation.
Bridge exceptions preserve authoritative state. A drop hides the row only after the
daemon revision supplies `shown: false` on each device view; explicit restart loss
shows `Not delivered`. Delivered, dropped and lost revisions remove queue actions,
even if a later queue entry reuses their historical handle. See
[supplied item presentation](conversation-shell-timeline-render.md#supplied-daemon-item-presentation).

The messaging top bar shows the current conversation name beside the overflow menu
and remains visible while messages scroll. It follows conversation switches and
list-reply name updates, including automatic naming, with `Unnamed conversation` for
a null name. See [Chrome and controls](conversation-shell-chrome.md#structure) for
the title, menu boundary and layout contract. The earlier unpair header was removed;
see [Unpair control](conversation-shell-chrome.md#unpair-control-166-deleted-by-1061).

A **proactive** twin of that escape hatch landed in [#167](../codebase/167.md): beneath the composer, a `Re-pair` button that appeared only when the connection had hit a terminal failure or the daemon had rejected the pairing, instead of requiring the user to notice the manual header control. [#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) folded it into the composer status row's own error slot as a filled button, in place of the block beneath the composer. [#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604) moved it again, out of that slot into the **Top overlay** (below) as a pill, so a pairing rejection no longer competes with the slot's other occupants for the same space. See [Re-pair control](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963) below and [Composer — actionable-error button](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963-re-pair-split-out-by-1604).

A **Top overlay of pills** landed in [#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604): a right-aligned stack pinned over the message area's top edge, shared with mobile, that takes no space and renders no element when it has no pills. Two occupants moved into it out of the composer status row's single-occupant slot, where each used to compete with every other slot occupant for the same space: the [usage-limit notice](conversation-shell-composer-usage-limit-notice.md#the-usage-limit-notice-now-a-top-overlay-pill-1321-moved-by-1604) (#1321) — now a Default pill with a dismiss X for exactly `allowed_warning`, an Error pill with no X for every other status, shown whatever the slot holds and whatever the connection state — and the pairing-error [Re-pair button](conversation-shell-composer-repair-button.md) (#963), now an Error pill with no X. `TopOverlay` (the pure view) lives in `TopOverlay.tsx`, and `TopOverlayControl` (its store-bound container) lives in `ConversationScreen.tsx`; the thread and the overlay together are wrapped in an always-rendered `.conversation__message-area`, so the overlay — Re-pair especially — still has somewhere to sit when a pane has no thread snapshot to draw.

The [permission resolution notice](#permission-resolution-notices) follows usage,
with client-owned copy and a dismiss X. A session-error notice follows resolution
and precedes Re-pair, using the existing Error treatment with no dismiss control.
`TopOverlayControl` selects only the open conversation's admitted `sessionError` from
its authoritative live store. `TopOverlay` compares its code to client literals; daemon codes
and message text never enter displayed text, attributes or classes.

Re-pair and pills with a dismiss X show an 8% On Surface hover layer over their
existing fill, within 6px corners. Inert notices keep their resting paint; geometry
and native keyboard outlines stay unchanged. See
[Top overlay hover](conversation-shell-chrome.md#top-overlay-hover) for selectors
and counted browser/visual evidence.

| Session-error code | Fixed pill copy |
| --- | --- |
| `session.blocked` | Claude did not pick up your last message. It was not delivered. |
| `session.child_crashing` | Claude keeps failing to start. Your message is waiting. |
| Any other string, including empty | Claude stopped responding. |

A newer error replaces the one pill. Receipt ends that conversation's stale send/turn
feedback, retaining thread rows and the reported queue without a resend or drop action.
An error for another chat changes neither this pill nor the open send window.
Accepted local send, non-idle turn state, conversation reset and reconnect of its host
clear the notice; idle states and received user echoes preserve it. Daemon reset
uses the routed `sessionTransition(reason: 'clear')` boundary; workspace changes and
idle eviction preserve it. Leaving the displayed chat or exiting the screen consumes
its notice, so returning does not replay it. Unopened notices stay held, including
through same-host saved-history reads; host reconnect clears them even off-screen
without touching other hosts. Cleanup defers consumption through a microtask to
distinguish actual departure from StrictMode replay. See
[live-state ownership](thread-runtime.md#live-controls-and-read-publication) and
[verification boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).

The thread overflow menu's bottom-end anchor uses level 2 above the Top overlay's
level 1; equal levels let the later pills paint over the menu. Sheets and dialogs
also use level 2 and retain precedence through later DOM placement. See
[chrome stacking](conversation-shell-chrome.md#structure) and
[browser stacking proof](development-verification-layout-and-input.md#layout-and-input) for the
regression's overlap, hit-testing and click requirements.

A **third, prominent** read of the connection status landed in [#279](../codebase/279.md): a disconnected-only banner across the top of the thread, between the header row and the message list — distinct from both the composer's terse inline gate and the still-separate #149 two-dot indicator. See [Connection banner](conversation-shell-chrome.md#connection-banner-279) below.

A **pre-first-message workspace chip** landed in [#278](../codebase/278.md) and was **removed in [#1486](https://github.com/pyrycode/pyrycode-desktop/issues/1486)**: a Material 3 pill above the empty new-discussion thread showing the workspace `cwd` the discussion will run in, with a disabled "Change" placeholder reserved for the #157 Workspace Picker sheet, gone once the thread had its first message. By the time it was removed, the sidebar's workspace-start plus (#1178) and Add workspace (#1189) had made every chat start in a chosen directory, so the row only restated a choice already made; the empty thread's copy is now the first thing below the banner row. See [Workspace chip](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278-deleted-by-1486) below.

The chip's "Change" placeholder was wired in [#383](../codebase/383.md): a bottom sheet (Figma node 20-2) listing the [recent-workspaces store](recent-workspaces-store.md) (#382), marking the row matching the active conversation's `cwd` with a "default" pill, and dispatching the existing [`changeWorkspace` command](conversation-workspace-change.md) (#379) on selection — the daemon's `conversation_updated` reply reflects the change into the conversation list for free, no optimistic update. Closes #157's split except for the "Other" section's create-folder dialog, deferred to #384 and landed by [#398](../codebase/398.md). #1486 deleted the chip that opened this sheet from the conversation screen; its pure view and `requestChangeWorkspace` survive as Settings' [Default workspace row](settings-screen-how-it-works.md#the-defaults-section-defaultworkspacerowtsx-404)'s own picker, while the #383 container, `CreateFolderDialog` and the conversation-scoped `onCreateFolder` wiring stay in the tree dormant, deliberately unswept: removing this entry point also removed the app's only way to make a directory on the host, and [#1499](https://github.com/pyrycode/pyrycode-desktop/issues/1499) owns that capability question. See [Workspace Picker sheet](conversation-shell-workspace-chip-and-picker.md#workspace-picker-sheet-383) below.

The status row and the "Run configuration" sheet it opens landed as a **chrome-only shell** in [#177](../codebase/177.md): a trigger row between the thread and the composer, and a host modal that renders no live data or sections yet. See [Run configuration sheet](conversation-shell-run-configuration.md#run-configuration-sheet-177) below.

The sheet's first section, **Log data** (a Download button for the debug bundle), landed in [#72](../codebase/72.md): the last child in the sheet body, beneath where Model/Effort/YOLO/Context-window will mount. See [Log data section](conversation-shell-run-configuration.md#log-data-section-72) below.

A second, **structured-stream** thread landed in [#203](../codebase/203.md): a `Timeline` view mounted beside `MessageThread`, rendering [thread-timeline store](conversation-timeline-store.md) items (the streamed assistant text, with a streaming cursor on the in-progress bubble) in a Strangler-Fig coexistence with the coarse thread above it. Inert (empty, zero footprint) in production until #179 flipped the `interactive` capability. See [Structured-stream timeline render](conversation-shell-timeline-render.md#structured-stream-timeline-render-203) below.

`Timeline`'s structural twin over the store's coarse `phase` scalar landed in [#215](../codebase/215.md): a "Thinking…" affordance mounted right after `Timeline`, covering the pre-text window the daemon opens with `turn_state{thinking}` before any assistant delta — otherwise the thread shows nothing and a slow turn looks stalled. Also inert until #179 (below). See [Thinking indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725) below.

`ThinkingIndicator`'s own twin, over a second store scalar, landed in [#317](../codebase/317.md): a `StallIndicator` mounted as its sibling, showing a problem-state affordance when the daemon's onset-only `stall` signal (#315) fires and self-clearing on the next turn activity (client-derived in the reducer — there is no daemon "cleared" frame). A first supersede peer, `ApiRetryIndicator`, landed in [#493](../codebase/493.md) over the daemon's `api_retry` signal (#492); a **second**, `CompactingIndicator`, landed in [#496](../codebase/496.md) over `compacting` (#495), mounted right after `ApiRetryIndicator` and, like it, occluding the thinking indicator rather than co-rendering beside it. All three retired in [#967](https://github.com/pyrycode/pyrycode-desktop/issues/967), which folded their copy into `ThinkingIndicator`'s own widened label instead of three separate mounts. See [Thinking / working indicator § Retired by #967](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725) below.

**The cutover landed in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse `message` fan-out stops daemon-side, the composer's optimistic echo routes into the timeline as a `userText` item, and the coarse `MessageThread` mount is retired. `Timeline` became the single thread surface at that cutover. The current `ThreadItemsTimeline` later replaced it, and #2023 removed the retained legacy view; shared row presentation remains live. See [The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below.

**The message bubble itself was the last piece of the desktop chat screen still wearing the mobile drawing, and [#969](https://github.com/pyrycode/pyrycode-desktop/issues/969) redrew it:** one 6px-cornered shape for both sides in place of the mobile's mirrored clipped corner, the desktop's 16/20 padding and fills, `title-small` emphasized type (a token family this ticket added), and a new **meta row** at the foot holding a timestamp slot (filled by #970) and a copy control that puts the message's own text on the clipboard. Reaching the OS clipboard needed a one-line narrowing of the renderer's blanket permission denial in `src/main/index.ts`, to an allowlist of exactly `clipboard-sanitized-write`. See [Message bubble](conversation-shell-message-bubble.md) below.

This screen is now the **thread view** of the [paired shell](paired-shell.md), landed in [#140](../codebase/140.md): the paired region enters at a list first, and opening a conversation mounts this screen, which gained a leading back affordance to return to the list. See [Back control](conversation-shell-chrome.md#back-control-140) below.

A **queued backlog** landed in [#294](../codebase/294.md): the messages queued while the daemon is
busy render as a dimmed, not-yet-run tail below the thread, reusing the delivered user-bubble
treatment. Each row gained a **drop / cancel affordance** in [#296](../codebase/296.md): an
icon-only button that dispatches a removal for that entry, with no optimistic UI — the row leaves
only when the daemon's next queue snapshot confirms it. See [Queued backlog + drop
affordance](conversation-shell-conversation-and-modals.md#queued-backlog--drop-affordance-294-drop-since-296) below.

A **screen-snapshot request + display** landed in [#324](../codebase/324.md) and was **removed in
[#618](../codebase/618.md)**: the feature answered by photographing claude's terminal, which was
deleted upstream (pyrycode#1348), leaving the button enabled and silently inert. See
[Screen-snapshot action & display](conversation-shell-conversation-and-modals.md#screen-snapshot-action--display-324-removed-618) below.

The **background-task drawer** uses supplied task-linked items from the same thread
snapshot. Supplied activity partitions Running/Finished and supplies the active
count; saved reports, progress and outcomes remain separate facts. The non-modal
drawer and count pill share the overflow menu's open state, held by `PairedShell`
across conversation switches. An empty supplied task array leaves an empty groups
body; retained roster events add no copy or tasks. See
[Background-task panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583).

Permission and trust requests scroll after the open chat's message and queued rows, including
empty/offline histories. The oldest outstanding request hides only a waiting questionnaire,
retaining its picks and Other text. The composer, attachments and desktop footer remain visible
under existing gates. The supplied default answers on one activation; any non-default requires
two activations of the same choice. Checked session consent survives navigation while arming
clears; interrupted request/offer/ownership evicts consent even with the pane closed.
Chat history and the sidebar remain usable, and
rejection feedback stays in normal flow in its originating chat. The existing modal bridge and
answer/cancel commands remain in use. See [Permission panel](conversation-shell-permission-modal.md)
and [Questionnaire placement](conversation-shell-question-panel.md#composer-placement).

An **in-app markdown reader** landed in [#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627): a link in an assistant reply that names a workspace `.md`/`.markdown` file now opens a reader, over the pane, showing that file's current text as rendered markdown behind a back arrow and its file name. The thread and composer stay mounted underneath it — hidden, not unmounted, after a review-caught regression where an early return dropped the composer's pending attachments on the round trip. See [Markdown reader](conversation-shell-markdown-reader.md) below.

## How it works

The positioned `.conversation__covered` pane holds the full-pane message area and separate top/input chrome. Masked backdrop layers soften rows, leaving controls sharp and clickable. The header fades from `#09141D` to transparent with 10px → 0px blur; the input fades to `#0B0E11` at 60% with 0px → 10px blur across its top fifth. Header content and composer status use the Default shadow. Measured chrome heights reserve thread padding, position pills below the header and bound the drawer between controls. See [layout](conversation-shell-chrome.md#layout-contract), [scroll pin](conversation-shell-scroll-pin.md#thread-scroll-pin) and [verification evidence](development-verification-layout-and-input.md#layout-and-input).

This screen is large enough that its surfaces live in their own documents. Each one keeps its original section headings, so an existing `#anchor` still resolves once you follow the link here.

- [Chrome and controls](conversation-shell-chrome.md) — The screen's structure and the persistent controls around the thread: layout, theme, the back, unpair and re-pair controls, and the connection surfaces in the header.
- [Workspace and run configuration](conversation-shell-workspace-and-run-config.md) — Choosing where a session runs and how it is configured: the workspace chip and picker, the run configuration sheet and its sections, and the log data section.
- [Turn status surfaces](conversation-shell-turn-status.md) — Retained refusal records and a map to timeline rendering, stopped turns, background tasks and the working indicator. The composer offers [stopped-turn recovery](conversation-shell-composer-status.md#stopped-turn-recovery) and [refusal Switch back](conversation-shell-composer-status.md#refusal-switch-back) with separate lifetimes.
- [Composer](conversation-shell-composer.md) — The composer's own surfaces: its status row, error chip and footer row. The options panel is large enough to have its own document.
- [Composer options panel](conversation-shell-composer-options.md) — The composer's options panel: its resting appearance, placement, keyboard driving, and the live wiring behind each control.
- [Adjacent tool runs](conversation-shell-tool-row-header-groups.md#adjacent-tool-runs) — Open conversations fold two or more adjacent root tools into “Using tools: N”; local expansion retains member state, and root failures remain visible alongside running status. `ThreadItemsTimeline.foldTools` defaults off for other callers.
- [Tool rows](conversation-shell-tool-rows.md) — Pending and resolved rows, the expandable result, collapsed headline and input field list. Failed results show an accessible 16px [Failed icon](conversation-shell-tool-rows.md#failed-icon) between count and chevron in either expansion state; denied rows keep their separate treatment, and borders and joins stay plain.
- [Tool row layout](conversation-shell-tool-row-layout.md) — Map only. The later redraw of the tool row: the shell command code block, the full-width bordered row, the header's groups and run routing, and the expanded body's own drawing (field values and result), split across six documents.
- [Conversation surfaces and modals](conversation-shell-conversation-and-modals.md) — Surfaces that act on the conversation as a whole rather than on one turn. Now a map itself: the interactive flip + thread cutover, the queued backlog, and screen-snapshot history stayed here; three larger topics split out on 2026-09-02 (below).
- [Actions menu and reader cutover](conversation-shell-actions-menu-and-reader-cutover.md) — The composer's Actions menu and the per-conversation timeline reader cutover.
- [Markdown reader](conversation-shell-markdown-reader.md) — The in-app reader a markdown-path link in an assistant reply opens: its state machine, and the covered-not-unmounted pane layering that keeps the composer's attachments alive underneath it.
- [Modals](conversation-shell-modals.md) — The permission/trust panel (with its rejection surface) and the inline questionnaire at the end of history.
- [Session boundaries and channel info](conversation-shell-session-and-channel-info.md) — The session-boundary delimiter row and the Channel Info sheet, with its Rename/Archive/Delete actions.
- [Message bubble](conversation-shell-message-bubble.md) — Desktop bubble shape and body-medium type, sibling copy actions, centred 900px text rows with 40px far-side insets, and collapsed time/stats revealed together on row hover/focus.
- [Thread scroll pin](conversation-shell-scroll-pin.md) — Whether the thread stays pinned to the bottom as new content arrives, and the user-input demand band and preservation of reading position across prepends.

The seams this screen exposes are in [Seams](conversation-shell-seams.md).

### Authoritative thread read publication

`ThreadItemsTimeline.readInputs` supplies a received summary `row`, `completeThrough`,
`readerOpen` and optionally an injected publisher. The view pairs them with its immutable
`snapshot`; select the same host/conversation/epoch in `conversationReadRouteStore`.
Production composition supplies these inputs from the selected host's runtime,
received summaries and certified newest/catch-up completion. Thread content does
not pass through `reduceTimeline` or legacy row-key/history evidence.
Credentialed live acceptance remains distinct from this integration.

`readTargetFor(inputs)` takes the received `last_shown_version`, never maximum
item IDs, revisions or held `version`. Admission requires matching snapshot/summary scope,
present shown/read metadata, a non-negative safe target, and a newest ordered shown source
row. The target must be at most both `snapshot.checkpoint` and supplied `completeThrough`,
and at most `repair.fromVersion` while repair is pending. A nonempty certified range must
establish a loaded baseline at or before that row's order; completed live suffixes need not
widen the saved range's end.

`completeThrough` certifies completed newest-window/catch-up progress represented by this
render, never an older page. Checkpoint alone is insufficient because older-page certificates
can advance it. Unfinished/abandoned batches retain uncertified progress in
`uncommittedVersion`, fencing checkpoint advancement by later live updates. Neither held
content nor an older page grants a newer read target. Any shown queued/unordered item makes
a new target unavailable; an item with `shown: false` neither raises the target nor prevents
an earlier completely reflected shown version from being published.

`useReadObservation` installs authoritative evidence only in a layout effect after React
commits. Focus, scroll, resize, visibility and list callbacks can recheck the committed
target's eligibility, but cannot upgrade it from the latest summary. With version 10 committed,
a same-row append and summary 11 received before commit cannot publish 11 through those
callbacks. The complete new content and its paired inputs must first commit.

The document must be focused and visible, the reader closed, and the actual newest shown
source row's trailing edge inside the thread viewport between measured top/input chrome.
Scrolling above it, chrome overlap, a collapsed ancestor or a folded tool run excludes the
claim. A visible header/proxy cannot stand for its hidden descendant. Numeric source identity
locates that row independently of nested presentation; host/conversation/epoch view keys
replace DOM evidence on scope changes. Observer cleanup removes subscriptions and listeners.

`createReadPublisher` reuses host-bound `markConversationRead` and coalesces evidenced targets.
Sending is an attempt, without changing unread or received marks. Only the owning daemon's
received `read_up_to` reaching the pending target confirms it; a lower clamp leaves it pending.
Each reconnect may retry that evidenced target once, even while blurred, without adopting a
newer summary. A higher target needs a new committed visible observation. Epoch replacement,
deletion, owner loss or unavailable metadata discards pending authority; a scope change alone
creates none. Late receipts cannot confirm another host's pending claim. Thread publisher
ownership requires the authoritative epoch and shown watermark; the legacy latest-entry,
row-key and receipt branches are deleted. Main retains its independent
ambiguous-connected-owner refusal. Thus a recorded renderer
attempt is not proof of wire delivery. See [mounted evidence](development-verification.md#authoritative-thread-read-evidence)
and [publisher lifecycle](conversation-last-read-store.md#how-it-works).

### Navigation and cleanup

Creation, opening/reopening, switching, archive/delete and unpair retain active/session,
configuration/prompt and pairing cleanup; flat/keyed legacy timelines no longer exist (#2030).
Same-ID activation preserves held configuration but always requests a refresh; an ID change clears
session and configuration before requesting the new chat's readings. Creation opens the
host-qualified thread runtime without creating a legacy slice or marking it viewed.

Navigation publishes no read evidence. `PairedShell` retains `useConversationLastRead`, now only a
wrapper around authoritative `useReadPublication`; its local count store, writer,
subscription and cleanup are removed.
Deletion still requires owning-host admission before active exit. Authoritative item, pending-send
and protected-storage cleanup keep their independent host-qualified lifecycle and ordering. See
[activation/exits](paired-shell-conversation-exits.md),
[deletion admission](paired-shell-conversation-deletion.md#confirmed-deletion-and-host-authority) and
[counted validation](thread-runtime.md#navigation-retirement-validation).

### Permission resolution notices

`TopOverlay.tsx` is the pure view; `TopOverlayControl` in `ConversationScreen.tsx` selects the open
chat's resolution from the [modal store](modal-store-bridge.md#permission-resolution-feedback).
The pill sits below usage and above session errors and Re-pair, using the existing Default treatment and exact 8px X.
Its only copies are “Resolved on another device” (`remote`) and “Request timed out” (`timeout`);
the X is named “Dismiss permission resolution notice”. Outcome, raw source and daemon-authored text
never enter this notice's DOM. An unknown/already-removed prompt, local answer/cancel or reconnect
clear creates no feedback; ownership comes only from a matching held prompt.

Only the latest unseen resolution per chat is retained. Opening its chat dispatches
`resolutionDisplayed` and replaces the pending object with a displayed one; a closed chat's notice
does not age while waiting. The displayed object owns a four-second effect timer. X or expiry removes
it; leaving the chat or unmounting the screen cancels the timer and consumes displayed feedback,
so returning does not replay it. Another chat's pending entry remains untouched. A newer notice
replaces pending or displayed feedback and starts a fresh deadline on display, even for identical
copy. Cleanup and expiry dispatch `resolutionDismissed` with the held object, whose identity prevents
stale work from clearing the replacement.

`resolutions` is transient feedback, separate from reconnect-scoped `resolved` duplicate suppression.
Reconnect preserves existing pending/displayed notices without creating any; pairing `reset` clears
both phases. See the [model contract](modal-prompt-model.md#the-reducer) and
[verification notes](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves) for lifecycle proofs.

### Held reading and host availability

Held chats remain selectable, scrollable and copyable when their host disconnects.
Local drafting and dismissal remain available. Failed hosts keep their red indication
and explicit repair entry; rejection never navigates away or opens repair automatically.
Cancelling manual repair returns to reading with the mounted draft intact. See
[recovery lifetime](paired-shell-routing.md#host-recovery-and-navigation-lifetime).
Saved chats also [restore timelines on demand](chat-history.md#received-state-admission-and-ownership)
whether their host is connected or unavailable. The shell retains clicked host/conversation
coordinates through metadata refreshes and pending reads through repair-modal
cancellation. Offline rows keep copying and scrolling without history/configuration
requests. Saved rendering suppresses cursors and grouped-tool running labels even
when durable rows are partial, including after reconnect. Connected opening and
reconnect remove offline notices without reviving saved working state; new live
receipts resume normal rendering. Pending and failed local-read notices can
still appear while connected because they describe local storage, not connectivity.
A loaded, empty local read draws no notice, connected or offline (\#1447).

Received queue rows remain readable on disconnect with disabled drop controls.
Pending, failed and restored local slices must not borrow the conversation-id-only
queue cache: saved content cannot establish that cache's host or transient state.

Conversation actions require a unique main-stamped owner from
`serverIdForOpenConversation` and that exact host's `SessionState.statuses` entry to
report `connected`. Missing ownership/status, duplicate ownership, connecting,
disconnected and error all block; another connected host grants no fallback authority.
`useConversationActionAvailability` controls presentation, while
`connectedConversationHostNow` re-reads ownership and status immediately before dispatch
and optimistic changes. This covers sending (including slash commands), reset/compact
and recovery commands, interrupt by button or Escape, queue removal, rename/archive/delete,
workspace changes, attachment downloads and the [Log data debug-bundle
download](conversation-shell-run-configuration.md#log-data-section-72) (\#1692). Pre-opened dialogs cannot submit after
disconnect; blocked attempts preserve draft, rename/folder text and queued content and
are never queued for reconnect. Settings and [prompt responses](conversation-shell-modals.md)
retain their separately owned gates.

The [Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)
is hidden while unavailable. Workspace selection and folder creation also require the
conversation's current owner; folder creation explicitly targets that server. A folder
result observed offline is consumed without changing workspace, so reconnect cannot
replay the mutation. Recent-workspace data mounts only while available.

Offline opening still activates local state and records viewing, but returns before
run-configuration, [context-reading](reported-context-store.md#how-it-works), model-list or
system-prompt request helpers. Opening never requests
history, even while connected. Qualifying upward thread input checks availability
before the history helper; reconnect alone cannot retry a page. The run-configuration
sheet gates both its data mount and the effect's current-state request. File-button gates alone are insufficient: thumbnails
retrieve on mount too. An offline thumbnail mount shows the existing unavailable-image
state without requesting or retrying on reconnect; already-rendered images retain their
normal release-on-unmount lifetime.

### Created-chat initialization

Creation confirmation can precede the refreshed conversation list. A one-time ownership
check at activation therefore loses new-chat configuration loading. Local activation stays
immediate; `initializeCreatedConversationAfterList` waits only for a newly created chat
with no existing row and a connected, main-stamped creation origin. It consumes that
host's first list update, unsubscribes before dispatch, and initializes once only when the
unique listed owner matches the origin and the chat remains active and connected.
The creation payload never fabricates a list row or authorizes requests by itself.

Missing/ambiguous ownership on that reply ends the wait. Host unavailability, active-chat
change, replacement creation and shell unmount cancel it too; reconnect cannot restart it.
Ordinary held-chat opening installs no wait. See [activation requests](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166).

`e2e/offline-conversation-actions.spec.ts` observes renderer commands **and** attachment
requests: absent socket frames alone can hide a renderer dispatch dropped by main.
It exercises held reading/copy, stale controls, retained state, another host and explicit
reconnect actions. Creation helper tests cover delayed ownership and cancellation; existing
creation/configuration scenarios detect initialization lost before list arrival.
See [verification boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves) and
[the design](../../specs/architecture/1382-offline-conversation-actions.md).

## Edge cases and limitations

The legacy timeline, roster and receipt producers and their exclusive tests are
deleted (#2030), following presentation retirement (#2023).
The [thread runtime](thread-runtime.md) defines current rendering and live controls.
The authoritative view shares the screen's actual scroll pin. Its ordinary
Background tasks menu and task-count pill control the same drawer.
Current-session hook stops, refusals, errors and foreground tools come from
canonical reports and live readings, so a missing legacy timeline cannot hide them.
Tool rows with unchanged immutable source facts reuse their presentation while
another row streams. Cache presentation only for frozen source objects; mutable
supplied test inputs must still be reprojected.


- An empty supplied timeline keeps a focusable history scroller with `EmptyThread` inside. Without a snapshot, chrome, Top overlay and pending inline prompts still mount and measure.
- Since [#179](../codebase/179.md), the timeline is the **only** thread surface — no split-brain, no empty second region. `MessageThread`/`selectMessages` are retained but unread residue.
- A click or Enter submits through the host-qualified pending-send store, capturing authenticated device/message identity. Whitespace does nothing; identity or bridge failure preserves recoverable input. Accepted daemon items settle only the exact host/device/message pair. See [Composer send](composer-send.md).
- **Dark scheme only**; the desktop sidebar stays fixed while the chat pane reflows down to the 800px minimum window width.
- **Connection banner** ([#279](../codebase/279.md)) — reads the open conversation's own host through `useOpenConnectionStatus` and renders while it is not connected. Pairing rejection selects the fixed recovery notice; other non-connected states use `CONNECTION_BANNER_COPY`, never `ConnectionError.message`. See [per-host decisions](session-store.md#one-slot-per-server-since-1133). Through [#968](../codebase/968.md) it coexisted with the composer's own terse caption (#31), both visible while disconnected by design; #968 dropped that caption, and the banner is now the only announcement of a non-connected state outside the `error` arm's status-row occupant (#797/#963).
- Renderer unit tests use `renderToStaticMarkup`: store-bound containers read Zustand's initial server snapshot, and effects, geometry and clicks do not run. Fake-transport Electron coverage establishes interaction; see [test boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).
- **Session-boundary delimiter** ([#286](../codebase/286.md), redrawn [#690](https://github.com/pyrycode/pyrycode-desktop/issues/690)) — appears only when a `sessionBoundary` item exists; an empty thread and a thread with no boundary render exactly as before. Its `clear`/`idle_evict` copy is no longer provisional as of #690 — `Session reset` / `Session reset after idle` are the shipped labels, not a placeholder awaiting a Figma variant.
- **Queued rows** — supplied shown queued user items keep dimmed bubbles and valid attachments. Usable raw handles and a connected owning host gate Cancel/Send now; Send now also requires `mid_turn_input`. Drop hides only after the supplied revision, with no optimistic removal. See [queue authority](#what-it-does).
- **Two-dot connection indicator** ([#330](../codebase/330.md)) — the two legs render independently and are never reconciled: a fatal session close leaves the relay dot at its last value (typically up) while the daemon dot shows down, and a retryable daemon-absent close leaves the daemon dot in-progress while the relay dot shows up/"Reachable" — both are intended, honest-per-hop renders, not bugs. The relay leg has no in-progress arm (that category is exercised only by the daemon leg's `connecting`), so the daemon dot never shows a false green.
- **Channel Info sheet** ([#365](../codebase/365.md)) — a list-opened thread (never populates `activeConversationStore`) opens the sheet gracefully: chrome + a placeholder About line, no Channel ID footer, no crash. `sheetOpen` (run-config) and `channelInfoOpen` are independent booleans, so both overlays could in principle stack — not reachable through normal use (separate triggers) and no AC requires mutual exclusion, left as-is. Created / Total sessions / Total messages / Memory (Figma 20-48) have no desktop wire field and are deferred, not invented. Escape-dismiss and the overflow-select → open wiring are reviewed glue, not unit-tested (the `renderToStaticMarkup`-only suite constraint, same as #276/#177).
- **Workspace Picker sheet** ([#383](../codebase/383.md)) — same `activeConversationStore`-null
  graceful posture as the Channel Info sheet: a list-opened thread marks no row and renders every
  row inert, no crash. `pickerOpen` is independent of `sheetOpen`/`channelInfoOpen`, so overlays could
  in principle stack — not reachable through normal use, no AC requires mutual exclusion. The change
  action is fire-and-forget with no optimistic update; the conversation list only reflects the new
  workspace once the daemon's `conversation_updated` re-list arrives, and the picker's own "default"
  mark stays stale until the next `conversation_created` (`activeConversationStore` does not observe
  `conversation_updated`) — a pre-existing #278 limitation, not fixed here. The "Other" create-folder
  entry now opens a working dialog ([#398](../codebase/398.md)) when the active conversation has a uniquely owned, connected host; it
  remains unavailable alongside workspace selection otherwise.
- **Background-task panel** — required supplied tasks determine membership, independent activity/outcomes and raw Stop eligibility. An empty array leaves empty groups without roster partial/unobserved/empty readings. Menu, count and Close control one open state; scope changes replace task facts while shell-owned visibility survives. See [drawer contract](conversation-shell-background-tasks.md).
- **Thread scroll pin** keeps new content at the bottom only while following.
  Qualifying upward user input near the top requests one history page while the
  owning host is connected. Stable row keys, native nonzero anchoring and measured
  zero-offset compensation preserve the reader's place. See [Thread scroll pin](conversation-shell-scroll-pin.md).

## Related

See [related documents](conversation-shell-related.md#related) for the stores,
transport paths, component references and architecture decisions behind this pane.
