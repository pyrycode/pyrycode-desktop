# Conversation shell — behavior

Thread sources, presentation and feedback. See the [conversation shell](conversation-shell.md)
for composition, authoritative read publication and lifecycle contracts.

## What it does

Renders the open chat's live timeline and composer. Messages scroll behind translucent controls across the full pane. At history start, the first row keeps its 97px header clearance and 20px horizontal inset; while following, the newest row clears the complete occupied input area. The sidebar and footer actions, context reading, attachment button, model, effort and permission selectors retain their desktop layout. Sending with Enter or the button adds an optimistic echo; see [Composer send](composer-send.md). The [Markdown reader](conversation-shell-markdown-reader.md) retains its independent overlay; its translucent adaptation remains follow-up work.

### Thread sources

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

Composer reports read the selected complete/compact presentation for the bound
session; status and session errors read admitted host/conversation/session
live state. Without a snapshot,
content reports and item previews are empty; without a binding, current-session
reports and live activity are empty. Existing items, unaccepted local sends and independently admitted
prompts keep their own lifetimes. None of these missing inputs activates a legacy
fallback. Sidebar/badge unread compares only received owning-host shown/read marks.
Refusal recovery still forwards new model-selection writes to `threadRuntime.refusals`.

### Expansion and compact delivery

Collapsed agents keep their headers; folded tool runs keep their run headers. Their
descendants/members and closed bodies are unmounted, and full message/body adaptation
and body-only formatting wait until local expansion makes them visible. Closing
previously expanded content restores that deferral, including for revisions received
while closed. Complete-route source-ID expansion state survives collapse, reopen,
prepends and reparenting; remounted descendants can be new DOM elements. Headlines, counts,
lifecycle, launch markers, joins and indentation keep their existing presentation.
On the complete route expansion uses items already held locally. Production selects
[compact delivery](thread-runtime-compact.md) from the owning accepted handshake;
visible tool expansion leases its body, while agent expansion leases only direct-child
summaries, with separate launch-body demand and explicit cursor paging. Grouped-run
expansion reveals headers only. Summary rows never become invented full messages.
Active supplied agents keep full opacity on both delivery routes, including inside
expanded tool runs; ordinary pending tools remain dimmed. See
[agent emphasis](conversation-shell-timeline-render.md#saved-content-and-activity).
Questions, approvals, actionable errors, delivery feedback, task status and
current-session controls keep their independently owned availability. Composer
reports use selected facts independently of local expansion; compact live task
controls require [admitted identities](conversation-shell-turn-status.md#session-scoped-live-presentation).
Compact facts supply no complete read/persistence evidence, including when complete
history remains held.

### Queued item presentation

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

### Chrome and notices

The messaging top bar shows the current conversation name beside the overflow menu
and remains visible while messages scroll. It follows conversation switches and
list-reply name updates, including automatic naming, with `Unnamed conversation` for
a null name. See [Chrome and controls](conversation-shell-chrome.md#structure) for
the title, menu boundary and layout contract. The earlier unpair header was removed;
see [Unpair control](conversation-shell-chrome.md#unpair-control-166-deleted-by-1061).

A **proactive** twin of that escape hatch landed in [#167](../codebase/167.md): beneath the composer, a `Re-pair` button that appeared only when the connection had hit a terminal failure or the daemon had rejected the pairing, instead of requiring the user to notice the manual header control. [#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) folded it into the composer status row's own error slot as a filled button, in place of the block beneath the composer. [#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604) moved it again, out of that slot into the **Top overlay** (below) as a pill, so a pairing rejection no longer competes with the slot's other occupants for the same space. See [Re-pair control](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963) below and [Composer — actionable-error button](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963-re-pair-split-out-by-1604).

A **Top overlay of pills** landed in [#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604): a right-aligned stack pinned over the message area's top edge, shared with mobile, that takes no space and renders no element when it has no pills. Two occupants moved into it out of the composer status row's single-occupant slot, where each used to compete with every other slot occupant for the same space: the [usage-limit notice](conversation-shell-composer-usage-limit-notice.md#the-usage-limit-notice-now-a-top-overlay-pill-1321-moved-by-1604) (#1321) — now a Default pill with a dismiss X for exactly `allowed_warning`, an Error pill with no X for every other status, shown whatever the slot holds and whatever the connection state — and the pairing-error [Re-pair button](conversation-shell-composer-repair-button.md) (#963), now an Error pill with no X. `TopOverlay` (the pure view) lives in `TopOverlay.tsx`, and `TopOverlayControl` (its store-bound container) lives in `ConversationScreen.tsx`; the thread and the overlay together are wrapped in an always-rendered `.conversation__message-area`, so the overlay — Re-pair especially — still has somewhere to sit when a pane has no thread snapshot to draw.

The [permission resolution notice](conversation-shell.md#permission-resolution-notices) follows usage,
with client-owned copy and a dismiss X. A session-error notice follows resolution
and precedes Markdown-open and connection feedback, using the existing Error
treatment with no dismiss control.
`TopOverlayControl` selects only the open conversation's admitted `sessionError` from
its authoritative live store. `TopOverlay` compares its code to client literals; daemon codes
and message text never enter displayed text, attributes or classes.

The [Markdown reader's failed-open notice](conversation-shell-markdown-reader.md#how-it-works)
follows session errors and precedes connection/restoration feedback and recovery
actions. It uses one existing Error pill with
the fixed copy “Could not open the file.” and no dismiss control. Its `role="status"`
provides a polite announcement; the overlay container itself is not a live region.
It coexists with usage and Re-pair pills without a full-width band or moving the
message list or composer. The reader owns its lifetime: the next open attempt or
a conversation switch clears it, and returning to the chat does not restore it.

Reconnect, Re-pair and pills with a dismiss X show an 8% On Surface hover layer over their
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

### Connection feedback

Connection and saved-history feedback now occupy the **Top overlay** as well
([#2076](https://github.com/pyrycode/pyrycode-desktop/issues/2076)). A single
non-dismissible Error pill owns the atomic polite connection/restoration
announcement. It shows the open host's fixed connection explanation, adds saved
copy only for visible host-qualified offline rows, and keeps loading feedback
until its independent read settles. Empty and hidden-only snapshots do not justify
“Showing saved messages”; `items.length` alone would make a false claim.
Connected state clears connection/offline copy, including while loading continues.
Reconnect and Re-pair are Error action pills; both re-resolve the current host and
recheck their existing predicates at click time. The retired header bands and
composer connection chip/button have no remaining mounts. Other composer
occupants remain connected-only; send restrictions and automatic retries retain
their policy. See [connection feedback](conversation-shell-chrome.md#connection-banner-279)
and [recovery routing and counted Linux evidence](conversation-shell-composer-repair-button.md).
The same absolute overlay preserves the Markdown failure pill, wraps at 800px,
and leaves timeline/composer geometry and pointer-transparent gaps intact.

### Workspace and configuration surfaces

A **pre-first-message workspace chip** landed in [#278](../codebase/278.md) and was **removed in [#1486](https://github.com/pyrycode/pyrycode-desktop/issues/1486)**: a Material 3 pill above the empty new-discussion thread showing the workspace `cwd` the discussion will run in, with a disabled "Change" placeholder reserved for the #157 Workspace Picker sheet, gone once the thread had its first message. By the time it was removed, the sidebar's workspace-start plus (#1178) and Add workspace (#1189) had made every chat start in a chosen directory, so the row only restated a choice already made; the empty thread's copy remains in the message area beneath the overlay. See [Workspace chip](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278-deleted-by-1486) below.

The chip's "Change" placeholder was wired in [#383](../codebase/383.md): a bottom sheet (Figma node 20-2) listing the [recent-workspaces store](recent-workspaces-store.md) (#382), marking the row matching the active conversation's `cwd` with a "default" pill, and dispatching the existing [`changeWorkspace` command](conversation-workspace-change.md) (#379) on selection — the daemon's `conversation_updated` reply reflects the change into the conversation list for free, no optimistic update. Closes #157's split except for the "Other" section's create-folder dialog, deferred to #384 and landed by [#398](../codebase/398.md). #1486 deleted the chip that opened this sheet from the conversation screen; its pure view and `requestChangeWorkspace` survive as Settings' [Default workspace row](settings-screen-how-it-works.md#the-defaults-section-defaultworkspacerowtsx-404)'s own picker, while the #383 container, `CreateFolderDialog` and the conversation-scoped `onCreateFolder` wiring stay in the tree dormant, deliberately unswept: removing this entry point also removed the app's only way to make a directory on the host, and [#1499](https://github.com/pyrycode/pyrycode-desktop/issues/1499) owns that capability question. See [Workspace Picker sheet](conversation-shell-workspace-chip-and-picker.md#workspace-picker-sheet-383) below.

The status row and the "Run configuration" sheet it opens landed as a **chrome-only shell** in [#177](../codebase/177.md): a trigger row between the thread and the composer, and a host modal that renders no live data or sections yet. See [Run configuration sheet](conversation-shell-run-configuration.md#run-configuration-sheet-177) below.

The sheet's first section, **Log data** (a Download button for the debug bundle), landed in [#72](../codebase/72.md): the last child in the sheet body, beneath where Model/Effort/YOLO/Context-window will mount. See [Log data section](conversation-shell-run-configuration.md#log-data-section-72) below.

### Thread presentation history

A second, **structured-stream** thread landed in [#203](../codebase/203.md): a `Timeline` view mounted beside `MessageThread`, rendering [thread-timeline store](conversation-timeline-store.md) items (the streamed assistant text, with a streaming cursor on the in-progress bubble) in a Strangler-Fig coexistence with the coarse thread above it. Inert (empty, zero footprint) in production until #179 flipped the `interactive` capability. See [Structured-stream timeline render](conversation-shell-timeline-render.md#structured-stream-timeline-render-203) below.

`Timeline`'s structural twin over the store's coarse `phase` scalar landed in [#215](../codebase/215.md): a "Thinking…" affordance mounted right after `Timeline`, covering the pre-text window the daemon opens with `turn_state{thinking}` before any assistant delta — otherwise the thread shows nothing and a slow turn looks stalled. Also inert until #179 (below). See [Thinking indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725) below.

`ThinkingIndicator`'s own twin, over a second store scalar, landed in [#317](../codebase/317.md): a `StallIndicator` mounted as its sibling, showing a problem-state affordance when the daemon's onset-only `stall` signal (#315) fires and self-clearing on the next turn activity (client-derived in the reducer — there is no daemon "cleared" frame). A first supersede peer, `ApiRetryIndicator`, landed in [#493](../codebase/493.md) over the daemon's `api_retry` signal (#492); a **second**, `CompactingIndicator`, landed in [#496](../codebase/496.md) over `compacting` (#495), mounted right after `ApiRetryIndicator` and, like it, occluding the thinking indicator rather than co-rendering beside it. All three retired in [#967](https://github.com/pyrycode/pyrycode-desktop/issues/967), which folded their copy into `ThinkingIndicator`'s own widened label instead of three separate mounts. See [Thinking / working indicator § Retired by #967](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967-splits-the-local-send-window-into-sending-and-waiting-for-claude-since-1725) below.

**The cutover landed in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse `message` fan-out stops daemon-side, the composer's optimistic echo routes into the timeline as a `userText` item, and the coarse `MessageThread` mount is retired. `Timeline` became the single thread surface at that cutover. The current `ThreadItemsTimeline` later replaced it, and #2023 removed the retained legacy view; shared row presentation remains live. See [The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below.

**The message bubble itself was the last piece of the desktop chat screen still wearing the mobile drawing, and [#969](https://github.com/pyrycode/pyrycode-desktop/issues/969) redrew it:** one 6px-cornered shape for both sides in place of the mobile's mirrored clipped corner, the desktop's 16/20 padding and fills, `title-small` emphasized type (a token family this ticket added), and a new **meta row** at the foot holding a timestamp slot (filled by #970) and a copy control that puts the message's own text on the clipboard. Reaching the OS clipboard needed a one-line narrowing of the renderer's blanket permission denial in `src/main/index.ts`, to an allowlist of exactly `clipboard-sanitized-write`. See [Message bubble](conversation-shell-message-bubble.md) below.

### Navigation and inline prompts

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

