# Conversation shell

The renderer's first screen: a scrollable message thread above a bottom-pinned composer, styled from the mobile **Conversation Thread** screen (Figma node `16-8`) stretched to the desktop window. It is the surface later tickets bind real state into.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders the conversation thread and composer for a session: a thread region that fills the window height and scrolls independently, and a composer (text input + send button) pinned to the bottom edge. The thread now renders the **live** message list from the [session store](session-store.md) — streamed daemon replies appear as they arrive ([#69](../codebase/69.md)). The composer is now **wired**: typing a message and submitting it (send button or Enter) sends it and shows it in the thread immediately as an optimistic echo ([#66](../codebase/66.md) — see [Composer send](composer-send.md)).

The messaging top bar shows the current conversation name beside the overflow menu
and remains visible while messages scroll. It follows conversation switches and
list-reply name updates, including automatic naming, with `Unnamed conversation` for
a null name. See [Chrome and controls](conversation-shell-chrome.md#structure) for
the title, menu boundary and layout contract. The earlier unpair header was removed;
see [Unpair control](conversation-shell-chrome.md#unpair-control-166-deleted-by-1061).

A **proactive** twin of that escape hatch landed in [#167](../codebase/167.md): beneath the composer, a `Re-pair` button that appeared only when the connection had hit a terminal failure or the daemon had rejected the pairing, instead of requiring the user to notice the manual header control. [#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) folded it into the composer status row's own error slot as a filled button, in place of the block beneath the composer. [#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604) moved it again, out of that slot into the **Top overlay** (below) as a pill, so a pairing rejection no longer competes with the slot's other occupants for the same space. See [Re-pair control](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963) below and [Composer — actionable-error button](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963-re-pair-split-out-by-1604).

A **Top overlay of pills** landed in [#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604): a right-aligned stack pinned over the message area's top edge, shared with mobile, that takes no space and renders no element when it has no pills. Two occupants moved into it out of the composer status row's single-occupant slot, where each used to compete with every other slot occupant for the same space: the [usage-limit notice](conversation-shell-composer-usage-limit-notice.md#the-usage-limit-notice-now-a-top-overlay-pill-1321-moved-by-1604) (#1321) — now a Default pill with a dismiss X for exactly `allowed_warning`, an Error pill with no X for every other status, shown whatever the slot holds and whatever the connection state — and the pairing-error [Re-pair button](conversation-shell-composer-repair-button.md) (#963), now an Error pill with no X. `TopOverlay` (the pure view) lives in `TopOverlay.tsx`, and `TopOverlayControl` (its store-bound container) lives in `ConversationScreen.tsx`; the thread and the overlay together are wrapped in an always-rendered `.conversation__message-area`, so the overlay — Re-pair especially — still has somewhere to sit when an offline host leaves `Timeline` nothing to draw.

The [permission resolution notice](#permission-resolution-notices) occupies the middle of this stack,
between usage and Re-pair, with client-owned copy and a dismiss X.

The thread overflow menu's bottom-end anchor uses level 2 above the Top overlay's
level 1; equal levels let the later pills paint over the menu. Sheets and dialogs
also use level 2 and retain precedence through later DOM placement. See
[chrome stacking](conversation-shell-chrome.md#structure) and
[browser stacking proof](development-verification.md#layout-and-input) for the
regression's overlap, hit-testing and click requirements.

A **third, prominent** read of the connection status landed in [#279](../codebase/279.md): a disconnected-only banner across the top of the thread, between the header row and the message list — distinct from both the composer's terse inline gate and the still-separate #149 two-dot indicator. See [Connection banner](conversation-shell-chrome.md#connection-banner-279) below.

A **pre-first-message workspace chip** landed in [#278](../codebase/278.md) and was **removed in [#1486](https://github.com/pyrycode/pyrycode-desktop/issues/1486)**: a Material 3 pill above the empty new-discussion thread showing the workspace `cwd` the discussion will run in, with a disabled "Change" placeholder reserved for the #157 Workspace Picker sheet, gone once the thread had its first message. By the time it was removed, the sidebar's workspace-start plus (#1178) and Add workspace (#1189) had made every chat start in a chosen directory, so the row only restated a choice already made; the empty thread's copy is now the first thing below the banner row. See [Workspace chip](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278-deleted-by-1486) below.

The chip's "Change" placeholder was wired in [#383](../codebase/383.md): a bottom sheet (Figma node 20-2) listing the [recent-workspaces store](recent-workspaces-store.md) (#382), marking the row matching the active conversation's `cwd` with a "default" pill, and dispatching the existing [`changeWorkspace` command](conversation-workspace-change.md) (#379) on selection — the daemon's `conversation_updated` reply reflects the change into the conversation list for free, no optimistic update. Closes #157's split except for the "Other" section's create-folder dialog, deferred to #384 and landed by [#398](../codebase/398.md). #1486 deleted the chip that opened this sheet from the conversation screen; its pure view and `requestChangeWorkspace` survive as Settings' [Default workspace row](settings-screen-how-it-works.md#the-defaults-section-defaultworkspacerowtsx-404)'s own picker, while the #383 container, `CreateFolderDialog` and the conversation-scoped `onCreateFolder` wiring stay in the tree dormant, deliberately unswept: removing this entry point also removed the app's only way to make a directory on the host, and [#1499](https://github.com/pyrycode/pyrycode-desktop/issues/1499) owns that capability question. See [Workspace Picker sheet](conversation-shell-workspace-chip-and-picker.md#workspace-picker-sheet-383) below.

The status row and the "Run configuration" sheet it opens landed as a **chrome-only shell** in [#177](../codebase/177.md): a trigger row between the thread and the composer, and a host modal that renders no live data or sections yet. See [Run configuration sheet](conversation-shell-run-configuration.md#run-configuration-sheet-177) below.

The sheet's first section, **Log data** (a Download button for the debug bundle), landed in [#72](../codebase/72.md): the last child in the sheet body, beneath where Model/Effort/YOLO/Context-window will mount. See [Log data section](conversation-shell-run-configuration.md#log-data-section-72) below.

A second, **structured-stream** thread landed in [#203](../codebase/203.md): a `Timeline` view mounted beside `MessageThread`, rendering [thread-timeline store](conversation-timeline-store.md) items (the streamed assistant text, with a streaming cursor on the in-progress bubble) in a Strangler-Fig coexistence with the coarse thread above it. Inert (empty, zero footprint) in production until #179 flipped the `interactive` capability. See [Structured-stream timeline render](conversation-shell-timeline-render.md#structured-stream-timeline-render-203) below.

`Timeline`'s structural twin over the store's coarse `phase` scalar landed in [#215](../codebase/215.md): a "Thinking…" affordance mounted right after `Timeline`, covering the pre-text window the daemon opens with `turn_state{thinking}` before any assistant delta — otherwise the thread shows nothing and a slow turn looks stalled. Also inert until #179 (below). See [Thinking indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725) below.

`ThinkingIndicator`'s own twin, over a second store scalar, landed in [#317](../codebase/317.md): a `StallIndicator` mounted as its sibling, showing a problem-state affordance when the daemon's onset-only `stall` signal (#315) fires and self-clearing on the next turn activity (client-derived in the reducer — there is no daemon "cleared" frame). A first supersede peer, `ApiRetryIndicator`, landed in [#493](../codebase/493.md) over the daemon's `api_retry` signal (#492); a **second**, `CompactingIndicator`, landed in [#496](../codebase/496.md) over `compacting` (#495), mounted right after `ApiRetryIndicator` and, like it, occluding the thinking indicator rather than co-rendering beside it. All three retired in [#967](https://github.com/pyrycode/pyrycode-desktop/issues/967), which folded their copy into `ThinkingIndicator`'s own widened label instead of three separate mounts. See [Thinking / working indicator § Retired by #967](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725) below.

**The cutover landed in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse `message` fan-out stops daemon-side, the composer's optimistic echo routes into the timeline as a `userText` item, and the coarse `MessageThread` mount is retired. `Timeline` is now the conversation's **single** thread surface — every "inert until #179" render slice below (the structured-stream thread, the thinking indicator, the tool-call rows, the permission modal) is now live. See [The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below.

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

An **openable background-task panel** landed in [#581](../codebase/581.md): a trigger — originally a
`StatusRow`-sibling between the thread and the composer, retired to a `Background tasks` overflow-menu
item by [#962](https://github.com/pyrycode/pyrycode-desktop/issues/962) — opens an overlay listing the tasks
[`backgroundTaskRosterStore`](background-task-roster-store.md) (#573/#576/#577) holds alive for the
open conversation — work that outlives a turn, which the chat's turn-shaped rendering has no way to
express, without adding a single row to the timeline. The store's three `selectRosterFor` readings
(never-observed, observed-with-nothing-alive, populated) render as three structurally distinct
outputs. This slice is the shell: chrome, the trigger, the three-way branch, and one row per task
showing `description` + `taskType` only. Split from #568 alongside #582 (truncation/cap reports) and
\#583 (latest patch, shipped); visual design is #580's. [#1634](https://github.com/pyrycode/pyrycode-desktop/issues/1634)
landed that design: a non-modal drawer beside the thread, in place of the interim `.status-sheet__*`
overlay, toggled by a Primary-outlined composer pill and by the overflow-menu item, its open state
surviving a conversation switch. See [Background-task panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)
below.

Permission and trust requests use the open chat's bottom input panel since
[#1356](https://github.com/pyrycode/pyrycode-desktop/issues/1356). The oldest outstanding request for
that chat takes precedence over a waiting questionnaire, retaining its picks, Other text and active
question, and the composer's typed draft. A row selection sends nothing; Continue sends the supplied
default or opens Back/Confirm for a non-default. Chat history and the sidebar remain usable, and
rejection feedback stays in normal flow in its originating chat. The existing modal bridge and
answer/cancel commands remain in use. See [Permission panel](conversation-shell-permission-modal.md)
and [Questionnaire placement](conversation-shell-question-panel.md#composer-placement).

An **in-app markdown reader** landed in [#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627): a link in an assistant reply that names a workspace `.md`/`.markdown` file now opens a reader, over the pane, showing that file's current text as rendered markdown behind a back arrow and its file name. The thread and composer stay mounted underneath it — hidden, not unmounted, after a review-caught regression where an early return dropped the composer's pending attachments on the round trip. See [Markdown reader](conversation-shell-markdown-reader.md) below.

## How it works

This screen is large enough that its surfaces live in their own documents. Each one keeps its original section headings, so an existing `#anchor` still resolves once you follow the link here.

- [Chrome and controls](conversation-shell-chrome.md) — The screen's structure and the persistent controls around the thread: layout, theme, the back, unpair and re-pair controls, and the connection surfaces in the header.
- [Workspace and run configuration](conversation-shell-workspace-and-run-config.md) — Choosing where a session runs and how it is configured: the workspace chip and picker, the run configuration sheet and its sections, and the log data section.
- [Turn status surfaces](conversation-shell-turn-status.md) — Retained refusal records and a map to timeline rendering, stopped turns, background tasks and the working indicator. The composer offers [stopped-turn recovery](conversation-shell-composer-status.md#stopped-turn-recovery) and [refusal Switch back](conversation-shell-composer-status.md#refusal-switch-back) with separate lifetimes.
- [Composer](conversation-shell-composer.md) — The composer's own surfaces: its status row, error chip and footer row. The options panel is large enough to have its own document.
- [Composer options panel](conversation-shell-composer-options.md) — The composer's options panel: its resting appearance, placement, keyboard driving, and the live wiring behind each control.
- [Tool rows](conversation-shell-tool-rows.md) — Pending and resolved rows, the expandable result, collapsed headline and input field list. Failed results show an accessible 16px [Failed icon](conversation-shell-tool-rows.md#failed-icon) between count and chevron in either expansion state; denied rows keep their separate treatment, and borders and joins stay plain.
- [Tool row layout](conversation-shell-tool-row-layout.md) — Map only. The later redraw of the tool row: the shell command code block, the full-width bordered row, the header's groups and run routing, and the expanded body's own drawing (field values and result), split across six documents.
- [Conversation surfaces and modals](conversation-shell-conversation-and-modals.md) — Surfaces that act on the conversation as a whole rather than on one turn. Now a map itself: the interactive flip + thread cutover, the queued backlog, and screen-snapshot history stayed here; three larger topics split out on 2026-09-02 (below).
- [Actions menu and reader cutover](conversation-shell-actions-menu-and-reader-cutover.md) — The composer's Actions menu and the per-conversation timeline reader cutover.
- [Markdown reader](conversation-shell-markdown-reader.md) — The in-app reader a markdown-path link in an assistant reply opens: its state machine, and the covered-not-unmounted pane layering that keeps the composer's attachments alive underneath it.
- [Modals](conversation-shell-modals.md) — The permission/trust panel (with its rejection surface) and the questionnaire in the input area.
- [Session boundaries and channel info](conversation-shell-session-and-channel-info.md) — The session-boundary delimiter row and the Channel Info sheet, with its Rename/Archive/Delete actions.
- [Message bubble](conversation-shell-message-bubble.md) — The later redraw of the message bubble itself: the desktop `Message` shape, the meta row and its copy control.
- [Thread scroll pin](conversation-shell-scroll-pin.md) — Whether the thread stays pinned to the bottom as new content arrives, and the user-input demand band and preservation of reading position across prepends.

The seams this screen exposes are in [Seams](conversation-shell-seams.md).

### Permission resolution notices

`TopOverlay.tsx` is the pure view; `TopOverlayControl` in `ConversationScreen.tsx` selects the open
chat's resolution from the [modal store](modal-store-bridge.md#permission-resolution-feedback).
The pill sits below usage and above Re-pair, using the existing Default treatment and exact 8px X.
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
[verification notes](development-verification.md#what-each-test-tier-proves) for lifecycle proofs.

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
See [verification boundaries](development-verification.md#what-each-test-tier-proves) and
[the design](../../specs/architecture/1382-offline-conversation-actions.md).

## Edge cases and limitations

- An **empty `items` array** renders a valid empty scroll region — no crash, no placeholder fallback (`Timeline` returns `null`). A just-connected session with no messages yet renders a clean empty thread. (Historical: before [#179](../codebase/179.md) this was the coarse `messages` array; `sessionStore.messages` still returns `[]` on initial state, but nothing reads it in production anymore.)
- Since [#179](../codebase/179.md), the timeline is the **only** thread surface — no split-brain, no empty second region. `MessageThread`/`selectMessages` are retained but unread residue.
- The send button is **wired** ([#66](../codebase/66.md)): a click (or Enter) sends the composed message and appends an optimistic echo, now into the timeline ([#179](../codebase/179.md)). A whitespace-only input does nothing; a send-bridge failure is swallowed (no crash). See [Composer send](composer-send.md).
- **Dark scheme only**; no responsive layout beyond flex reflow; no desktop-native layout (the plan defers that until the app is fully functioning).
- **Connection banner** ([#279](../codebase/279.md)) — reads the open conversation's own host through `useOpenConnectionStatus` and renders while it is not connected. Pairing rejection selects the fixed recovery notice; other non-connected states use `CONNECTION_BANNER_COPY`, never `ConnectionError.message`. See [per-host decisions](session-store.md#one-slot-per-server-since-1133). Through [#968](../codebase/968.md) it coexisted with the composer's own terse caption (#31), both visible while disconnected by design; #968 dropped that caption, and the banner is now the only announcement of a non-connected state outside the `error` arm's status-row occupant (#797/#963).
- No DOM interactivity is tested yet — the render test uses `renderToStaticMarkup`, not a DOM harness. Because zustand v5's `useStore` reads `getInitialState()` (not `getState()`) for its server snapshot, a *server*-rendered store-bound container always shows the store's **initial** state; #69 therefore proves ordering + role→type on the pure `MessageThread` view and smoke-tests the container against the empty store. Observing a *populated* container render needs a jsdom harness — still deferred. See [#69 codebase notes](../codebase/69.md).
- **Session-boundary delimiter** ([#286](../codebase/286.md), redrawn [#690](https://github.com/pyrycode/pyrycode-desktop/issues/690)) — appears only when a `sessionBoundary` item exists; an empty thread and a thread with no boundary render exactly as before. Its `clear`/`idle_evict` copy is no longer provisional as of #690 — `Session reset` / `Session reset after idle` are the shipped labels, not a placeholder awaiting a Figma variant.
- **Queued backlog + drop affordance** ([#294](../codebase/294.md)/[#296](../codebase/296.md)) — the region and its drop buttons render only when the milestone conversation's backlog is non-empty; dropping a row is fire-and-forget with no client-side validation of `queued_msg_id` and no error surface on a bridge failure (swallowed, `console.error` only) — the row simply remains, since the daemon never received the drop. The drop button inherits the region's 50% dimming; it cannot be rendered at full opacity without restructuring the region-level dim (a child opacity cannot escape a parent's opacity compositing group).
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
- **Background-task panel** ([#581](../codebase/581.md)) — a list-opened thread (no active conversation)
  reads `conversationId: null`, which `selectRosterFor` resolves to the "never observed" reading, so
  the panel opens gracefully with no crash and no rows, same posture as the Channel Info and Workspace
  Picker sheets. `panelOpen` is independent of the other three open-state booleans, so overlays could in
  principle stack — not reachable through normal use, no AC requires mutual exclusion. No terminal state
  is ever shown: a task leaves the list only by no longer appearing in the next roster, never by an
  explicit "done" render. Stale-list-after-reconnect is retired
  ([#569](https://github.com/pyrycode/pyrycode-desktop/issues/569)): the store's held rosters
  repopulate from the daemon's reconcile-on-connect burst, so the panel reads the two silences apart
  across a reconnect too — `.background-task-panel__empty` ("No background tasks") for a
  conversation reconciled with an explicit empty roster, `.background-task-panel__unobserved` ("No
  background-task report yet") for one the daemon reports nothing for — never the pre-disconnect list.
- **Thread scroll pin** keeps new content at the bottom only while following.
  Qualifying upward user input near the top requests one history page while the
  owning host is connected. Stable row keys, native nonzero anchoring and measured
  zero-offset compensation preserve the reader's place. See [Thread scroll pin](conversation-shell-scroll-pin.md).

## Related

- [Welcome screen](welcome-screen.md) — the mark's original home; [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) moved the shared `PyryMark` component into `theme/PyryMark.tsx` so the composer status row's icon and the welcome hero's mark are the same 12 KB path, not a drifted copy; the welcome screen's own call site and markup are unchanged.
- [App shell](app-shell.md) — mounts the paired shell and returns to initial pairing after explicit removal of the last saved host.
- [Paired shell](paired-shell.md) — conversation activation, pane identity and [non-destructive recovery navigation](paired-shell-routing.md#host-recovery-and-navigation-lifetime).
- [Session store](session-store.md) — per-host status for this conversation's send gate, banner and repair slot; the old coarse message array is unread residue.
- [Composer send](composer-send.md) — the composer's now-wired submit + optimistic echo (#66), retargeted from the session store into the timeline store since [#179](../codebase/179.md); the send half of this screen; also home of `shouldShowBanner`/`CONNECTION_BANNER_COPY` (#279), the connection banner's predicate + copy, co-located beside `composerAvailability`/`shouldOfferRepair` as a third read of `ConnectionStatus`
- [Unpair channel](unpair-channel.md) — explicit host removal used by Settings. Composer Re-pair navigates to recovery and does not invoke it.
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) — the main-process consumer the Log data section's Download button and its three daemon events finally drive (#169, consumed in #72)
- [Run configuration store](run-config-store.md) — the dedicated store the headless data path `<RunConfigData/>` feeds (#187) and `<RunConfigSections/>` reads via `selectSnapshot` (#188, widened by #192); mounted as the sheet body's first two children, ahead of `<LogDataSection/>`; since #810 also fed app-lifetime by `RunConfigLiveData`, which is what lets [Composer footer row](conversation-shell-composer-message-box.md#composer-footer-row-811)'s `ContextUsageControl` read a live figure with no sheet ever opened
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the original transport data path (#180, extended #191) `<RunConfigData/>` consumed via `snapshotReceived` until #491/#500 moved it onto [Run configuration store](run-config-store.md)'s `runConfigReceived`; also hosted the `requestSnapshot` command (removed #620), the `screenSnapshotReceived` event #324's now-removed control used to send and render (#316, #324, removed #618), and both events removed outright by [#621](../codebase/621.md)
- [Screen-snapshot store](screen-snapshot-store.md) — the dedicated store (#323), reader-less since [#618](../codebase/618.md) removed `ScreenSnapshotControl`, its former sole consumer (#324), then deleted outright by [#619](../codebase/619.md)
- [Relay-link store](relay-link-store.md) — the dedicated store (#329) `<ConnectionStatusIndicatorControl/>` reads via `selectRelayLinkStatus`, its first real consumer; combined at render time with [session store](session-store.md)'s `ConnectionStatus` (#330)
- [Conversation timeline store](conversation-timeline-store.md) / [Thread timeline (conversation model)](thread-timeline.md) — the flat store and model this screen read through [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758): `<Timeline/>` via `selectItems` (#203); the `useTimelineBridge()` twin of `useDaemonEventBridge()` mounted in `App.tsx` (still mounted, still dual-writing); `<ThinkingIndicator/>` via `selectPhase` (#215); the `toolCall` items `TimelineRow`'s pending chip renders (#218, transport #217) and now resolves in place once `result` fills (#230, transport #229); `Composer` writes to this store's `dispatch` as the `userText` producer (unchanged — still the flat store, see below), and `TimelineRow`'s `case 'userText'` draws the echo (#179) — the vertical's last piece; the fifth `ThreadItem` kind, `sessionBoundary`, is translated by the bridge and drawn by `TimelineRow`'s new case (#286, transport #285); `<StallIndicator/>` via `selectStalled` (#317, transport #315); `<ApiRetryIndicator/>` via `selectApiRetry`, and the exported `shouldShowThinking` predicate reading it alongside `selectPhase` to narrow `<ThinkingIndicator/>`'s gate (#493, transport #492); `<CompactingIndicator/>` via `selectCompacting`, and `shouldShowThinking` gaining a second clause reading it to narrow `<ThinkingIndicator/>`'s gate again (#496, transport #495) — **all three views retired in [#967](https://github.com/pyrycode/pyrycode-desktop/issues/967)**, which folds their selectors' values into `<ThinkingIndicator/>`'s own widened `state`/`retry` props instead of three separate mounts; `selectStalled`/`selectApiRetry`/`selectCompacting` themselves are unchanged, only their reader consolidated
- [Conversation timeline holder](conversation-timeline-holder.md) — as of [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758), the store all six reads above and (until [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678) retired `InterruptControl`) its `phase` actually come from: one subscription to `selectTimelineFor(openConversationId)` on this screen, keyed by `activeConversationStore`'s open id. The flat store above stays mounted and dual-written (the bridge fan-out, `Composer`'s echo) but is read only by nothing in this screen any more. See [The open-conversation reader cutover](conversation-shell-actions-menu-and-reader-cutover.md#the-open-conversation-reader-cutover-758) above.
- [Interrupt envelope](interrupt-envelope.md) — since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678), the stop-a-running-turn affordance this screen renders is a variant of `Composer`'s own send button (`ComposerSendButton`), not a standalone control; the `phase` prop plumbed through this screen feeds it directly.
- [Modal store + bridge](modal-store-bridge.md) — the store `<PermissionModal/>` reads via `selectOutstanding` (#224) and now also `dispatch` (#237); the `useModalBridge()` third independent subscriber mounted in `App.tsx` beside `useDaemonEventBridge()`/`useTimelineBridge()`, live since [#179](../codebase/179.md) flipped `interactive` (dormant #223–#178)
- [Modal resolution envelope](modal-resolution-envelope.md) / [Command channel](command-channel.md) — the `answerModalCommand`/`cancelModalCommand` this screen's `PermissionModal` now dispatches through `modalResolution.ts` (#237), routed main-side by [Daemon connection](daemon-connection.md)'s `answerModal`/`cancelModal` (#236); gated behind a `selectOption` client-side second-confirm on `defaultOptionId` for any non-default answer (#226) — no wire/envelope change, the gate lives entirely in `modalResolution.ts`/`PermissionModal.tsx`
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — `class` is `permission | trust` only, no `destructive` wire class; the premise #226's second-confirm gate is a client-side stand-in for
- [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `role→'daemon'` / `message_id→id` adapter seam deferred to this screen
- [ADR 0006 — ephemeral screen-local state](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the `useState` boolean the Run configuration sheet's open/close toggle follows (#177); the `useReducer` phase-machine the Log data download state follows (#72)
- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md) — gains `--color-surface-container-low` + `--color-scrim` (#177); gains `--color-secondary-container` + `--color-on-secondary-container` (#72); gains `--color-surface-container-highest` (#188, reused by #192's context-window track — 0 new tokens)
- [Queue store](queue-store.md) / [Dequeue message envelope](dequeue-message-envelope.md) — the store `ConversationScreen` reads via `selectBacklogFor(openConversationId ?? '')` (#293, consumed in #294, rekeyed off the active conversation id by #448, hoisted out of the retired `QueuedBacklogControl` and into the screen itself by [#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) so the read's re-render re-pins the thread), folded from its own `.conversation__queued` region into `Timeline`'s rows by [#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) (the read itself unchanged; see [Conversation shell — conversation surfaces and modals § Queued rows folded into the thread](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213)), and the outbound command the drop affordance's `dropQueuedMessage` dispatches (#299/#300, consumed in #296) — the queue-drop family is now complete end to end.
- [Recent-workspaces store](recent-workspaces-store.md) — the dedicated store + dormant bridge `WorkspacePickerSheet` reads via `selectRecentWorkspaces` and mounts (`RecentWorkspacesData`), its first real consumer (#382, consumed in #383)
- [Conversation workspace change](conversation-workspace-change.md) — the `changeWorkspace` command `requestChangeWorkspace` dispatches on a row choice, its first real caller (#379, consumed in #383)
- [Background-task roster store](background-task-roster-store.md) — the store `BackgroundTaskPanel` reads via `selectRosterFor(conversationId)`, its first real consumer since the store shipped dormant at #573 (#581, extended to read `droppedTasks`/`truncatedFields` in #582 and `latestUpdate` in #583, see [Background-task panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583) above)
- [Assistant markdown renderer](assistant-markdown-renderer.md) — `AssistantMarkdown`, shipped dormant at #608, wired into this screen's `assistantText` settled branch by [#609](../codebase/609.md); the `.bubble__markdown` container and its block-rhythm/code-wrap CSS live in `conversation.css`, not in that module. Gained the `onOpenMarkdownPath` opt-in and `markdownLinkPath` by [#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627), threaded down from this screen through `Timeline`/`TimelineRow` — see [Markdown reader](conversation-shell-markdown-reader.md).
- [Message bubble](conversation-shell-message-bubble.md) — the later redraw of `.bubble`/`.bubble--user`/`.bubble--daemon` from the mobile shape to the desktop `Message` component, the `title-small` token family it added, and the meta row + copy control it appended to both `TimelineRow` message arms (#969); the queued row and the unmounted `MessageBubble` residue take the CSS restyle but not the meta row
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md), [ADR 0002 — Remote head over relay](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#1 codebase notes](../codebase/1.md) · [#69 codebase notes](../codebase/69.md) · [#166 codebase notes](../codebase/166.md) · [#177 codebase notes](../codebase/177.md) · [#72 codebase notes](../codebase/72.md) · [#167 codebase notes](../codebase/167.md) · [#187 codebase notes](../codebase/187.md) · [#188 codebase notes](../codebase/188.md) · [#191 codebase notes](../codebase/191.md) · [#192 codebase notes](../codebase/192.md) · [#203 codebase notes](../codebase/203.md) · [#140 codebase notes](../codebase/140.md) · [#214 codebase notes](../codebase/214.md) · [#215 codebase notes](../codebase/215.md) · [#217 codebase notes](../codebase/217.md) · [#218 codebase notes](../codebase/218.md) · [#229 codebase notes](../codebase/229.md) · [#230 codebase notes](../codebase/230.md) · [#245 codebase notes](../codebase/245.md) · [#179 codebase notes](../codebase/179.md) · [#237 codebase notes](../codebase/237.md) · [#226 codebase notes](../codebase/226.md) · [#279 codebase notes](../codebase/279.md) · [#285 codebase notes](../codebase/285.md) · [#286 codebase notes](../codebase/286.md) · [#278 codebase notes](../codebase/278.md) · [#323 codebase notes](../codebase/323.md) · [#324 codebase notes](../codebase/324.md) · [#328 codebase notes](../codebase/328.md) · [#329 codebase notes](../codebase/329.md) · [#330 codebase notes](../codebase/330.md) · [#492 codebase notes](../codebase/492.md) · [#493 codebase notes](../codebase/493.md) · [#495 codebase notes](../codebase/495.md) · [#496 codebase notes](../codebase/496.md) · [#365 codebase notes](../codebase/365.md) · [#366 codebase notes](../codebase/366.md) · [#368 codebase notes](../codebase/368.md) · [#377 codebase notes](../codebase/377.md) · [#383 codebase notes](../codebase/383.md) · [#529 codebase notes](../codebase/529.md) · [#530 codebase notes](../codebase/530.md) · [#581 codebase notes](../codebase/581.md) · [#582 codebase notes](../codebase/582.md) · [#583 codebase notes](../codebase/583.md) · [#600 codebase notes](../codebase/600.md) · [#601 codebase notes](../codebase/601.md) · [#618 codebase notes](../codebase/618.md) · Spec: `docs/specs/architecture/1-app-shell-and-theme-tokens.md`
