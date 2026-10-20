# Conversation shell

The desktop conversation pane: a full-height message scroller behind a fixed translucent header and input area, beside the paired shell's sidebar.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Screen composition lives under `src/renderer/`; keys, sockets and the Noise handshake belong to main.

## What it does

Renders the open chat's authoritative thread, composer, chrome and inline prompts.
See [thread sources, presentation and feedback](conversation-shell-behavior.md#what-it-does)
for the behavior map and retained surface history.

## How it works

The positioned `.conversation__covered` pane holds the full-pane message area and separate top/input chrome. Masked backdrop layers soften rows, leaving controls sharp and clickable. The header fades from `#09141D` to transparent with 10px → 0px blur; the input fades to `#0B0E11` at 60% with 0px → 10px blur across its top fifth. Header content and composer status use the Default shadow. Measured chrome heights reserve thread padding, position pills below the header and bound the drawer between controls. See [layout](conversation-shell-chrome.md#layout-contract), [scroll pin](conversation-shell-scroll-pin.md#thread-scroll-pin) and [verification evidence](development-verification-layout-and-input.md#layout-and-input).

`ThreadItemsView` uses metadata-only `threadItemIndex` for ancestry, placement,
validity, counts and lifecycle, sharing `nest` with the complete adapter. It checks
ancestor/run visibility and bounded admission before demanding a source's header or
full presentation. Hidden messages do not format timestamps or usage; closed tools
do not format shell-command blocks or denial bodies. Usage demand retains matching
ending metadata and selects the latest nonempty formatted reading: a later empty
ending must not erase an earlier reading. See
[supplied presentation](conversation-shell-timeline-render.md#supplied-daemon-item-presentation)
and [admission, anchoring and counted Linux evidence](conversation-shell-scroll-pin.md#deferred-expansion-verification).
This complete-thread behavior is separate from incoming-update batching (#2079)
and compact delivery activation (#2128); it adds no idle prefetch.

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
row. On the complete route the target must be at most both `snapshot.checkpoint`
and supplied `completeThrough`,
and at most `repair.fromVersion` while repair is pending. A nonempty certified range must
establish a loaded baseline at or before that row's order; completed live suffixes need not
widen the saved range's end.

Compact observation instead requires a proof paired with that exact snapshot,
still-current authority, a safe completed `through` covering the target, and the
tail among its certified roots. It grants no complete-route or persistence
evidence. Scope/metadata/target and ordered-tail checks precede either route's
proof; shown queued/unordered items are checked afterward on both routes.

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

The visible-tail browser spec's [native focus recovery](e2e-harness-context-recovery.md#native-window-setup)
confirms window state before removing its deliberate document-focus override and
requiring genuine `document.hasFocus()`. Its focus notification only rechecks the
committed evidence above. See [counted Linux verification](development-verification-layout-and-input.md#visible-tail-native-acknowledgement-verification);
recovered native acknowledgement alone grants no read target.

The document must be focused and visible, the reader closed, and the actual newest shown
source row's trailing edge inside the thread viewport between measured top/input chrome.
Scrolling above it, chrome overlap, a collapsed ancestor or a folded tool run excludes the
claim. Closed descendants are absent, and neither run headers nor launch-marker proxies
carry source read authority. Reopening must commit the actual visible source revision
before it can justify publication. A visible header/proxy cannot stand for its hidden
descendant. Numeric source identity locates that row independently of nested
presentation; host/conversation/epoch view keys
replace DOM evidence on scope changes. Observer cleanup removes subscriptions and listeners.
Retained callbacks also reject a changed captured route epoch or a mismatch with
the selected route store; both exclusions use `route-stale` below.

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

#### Read-observation diagnostics

`readTargetFor` and the setup/observe phases of `useReadObservation` explain
returning refusals through the existing `window.pyry.sendDiagnostic` pipe.
Only static client-owned `event` and `code` fields are produced; the unchanged
receiver projection retains the logger's normal `seq` and `ts` stamps. No host,
conversation, epoch, item or request identities, daemon/message content, DOM text,
raw errors or interpolated payloads are emitted. These events avoid the reserved
`message-` prefix.

Each table follows the guard order. Only the first applicable reason is emitted
for that returning invocation/phase. Successful target calculation and ordinary
successful observation remain silent.

| `read-target` code | Reason |
| --- | --- |
| `scope-unavailable` | The summary has no owning server. |
| `scope-mismatch` | Snapshot host/conversation differs from the owning summary. |
| `read-metadata-unavailable` | Received read or shown watermark is absent. |
| `target-invalid` | Shown watermark is negative or not a safe integer. |
| `tail-unavailable` | No ordered, shown, nonqueued source tail is available. |
| `compact-snapshot-mismatch` | Compact proof belongs to another snapshot object. |
| `compact-stale` | Compact authority is no longer current. |
| `compact-completion-insufficient` | Compact completion is unsafe or below the target. |
| `compact-tail-uncovered` | Compact proof does not certify the source tail. |
| `checkpoint-insufficient` | Complete snapshot checkpoint is below the target. |
| `completion-insufficient` | Complete newest/catch-up completion is unsafe or below the target. |
| `repair-pending` | Target exceeds the pending repair's starting version. |
| `coverage-insufficient` | No nonempty complete range establishes a baseline at/before the tail. |
| `shown-tail-pending` | A shown item is queued, unordered or has nonpositive order. |

The four compact checks and four complete-evidence checks are alternative paths.
A queued-only snapshot has no eligible tail and therefore reports `tail-unavailable`
before the later pending-item check.

| `read-observer-setup` code | Reason |
| --- | --- |
| `reused` | Successful reuse of the same scope/route/tail and pane/thread elements, with the reader closed and tail connected. |
| `inputs-unavailable` | No committed observation inputs can be installed. |
| `reader-open` | Reader overlay is open, after target admission. |
| `dom-unavailable` | Pane or thread element is unavailable. |
| `tail-dom-unavailable` | The actual source-tail element is unavailable. |

After the reuse/missing-input checks, fresh setup delegates target admission to
`readTargetFor` before checking the reader and DOM. A delegated rejection emits
only its `read-target` record, without a wrapper refusal. Reuse emits `reused`
as a success, then invokes the retained observation callback, which evaluates the
target once. Those are separate phases: `reused` followed by a single target or
observer refusal is expected, rather than a duplicate rejection. Metadata-only
commits must not reinstall observers, listeners or list subscriptions.

| `read-observer` code | Reason |
| --- | --- |
| `inputs-unavailable` | Retained callback has no current committed inputs. |
| `reader-open` | Reader overlay is open. |
| `scope-stale` | Committed host, conversation or snapshot epoch replaced the callback's scope. |
| `tail-stale` | Newest eligible source tail replaced the callback's tail. |
| `route-stale` | Committed route epoch or selected route no longer matches the captured route. |
| `document-unfocused` | Document lacks focus. |
| `document-hidden` | Document visibility is not visible. |
| `tail-disconnected` | Captured source-tail element is detached. |
| `tail-hidden` | Source tail or an ancestor has `hidden`. |
| `tail-queued` | Source-tail DOM carries queued-row styling. |
| `viewport-empty` | Source-tail rectangle has nonpositive height. |
| `viewport-above` | Trailing edge is at/above the effective viewport top. |
| `viewport-below` | Trailing edge is below the effective viewport bottom. |

The callback delegates target admission after its scope check and before its
tail/route checks; a refusal again emits only `read-target`. Effective viewport
bounds retain the measured top/input chrome exclusions.

Emission is best-effort, including the optional injected test sink and default
bridge lookup/invocation. Missing transport is silent; throwing diagnostics are
dropped without retry or secondary logging. The catch encloses emission only,
leaving domain evaluation, DOM work and publication outside it. Diagnostics
cannot change eligibility, observer reuse/cleanup, geometry, publication or
deduplication. Catching only target refusals would miss the successful reuse
path, where a throwing sink could otherwise prevent the retained observation.

#### Diagnostic verification

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2180#issuecomment-6298117359)
reviews `7aa73aa64fa07580e786f490be7d00756a9484fa` on macOS arm64.
Its complete configured application gate executed/passed 532 tests, failed 0,
skipped 2, with zero retries. The retained gate log confirms these named tests
were present and passed: `read observation explains each committed refusal, reuse
and receiver delivery`, both `publishes only committed visible authoritative read
evidence` widths (1280 and 800), `read setup is reused across committed same-row
deltas on short and long threads`, and `committed folded tails require focus,
uncovered viewport and a closed reader`. The receiver case drives a genuine hook
rejection through the default production bridge/main receiver, requiring exactly
`event`, `code`, `seq`, `ts` and static `read-observer` / `document-unfocused`
fields, with fixture secrets absent. Controlled document focus proves reason
selection; it establishes no native focus recovery.

The same verdict confirms the publisher's 41 unit cases passed. Retained
exception-repair evidence under `/tmp/builder-2176/repair-20261020/` records units
before: 41 executed, 12 passed, 29 failed, 0 skipped; after: 41 executed/passed,
0 failed/skipped. The mounted before selection executed 2 (1 prerequisite passed,
1 hook setup failed); after selection executed/passed 5, both 0 skipped and the
after run 0 failed. The separate lifecycle/reuse selection executed/passed 2,
0 failed/skipped. These focused results remain distinct from the earlier managed
candidate `b5afdda7` (532 executed/passed, 0 failed, 2 skipped) and the reviewed-head
gate. The original target matrix's raw initial before-run report is unavailable;
the later retained exception regressions provide independent before/after proof.

Historical failed readiness, expansion and native-writer attempts remain failed;
the plan retains their separate receipts, including the native-writer follow-up
[#2198](https://github.com/pyrycode/pyrycode-desktop/issues/2198). The two full-gate
skips are the never-shown-window pointer case and existing system-prompt-reset
fixme. No fresh provider/daemon or physical-effect acceptance was required or
claimed; other operating systems are outside this ticket's verification scope.
See [synchronization barriers and counted evidence](development-verification-evidence-that-cannot-pass-too-early.md#read-and-reply-synchronization-on-macos).

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
The pill sits below usage and above session errors, Markdown failures, connection feedback and recovery actions, using the existing Default treatment and exact 8px X.
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
selected reports/header status and live readings, so a missing legacy timeline cannot hide them.
Agent status labels recover complete top-level descriptions from truncated compact
JSON without requesting details; unusable input falls back to `Running Agent…`.
See [Agent descriptions](conversation-shell-working-indicator.md#agent-descriptions-from-compact-headers).
Tool rows with unchanged immutable source facts reuse their presentation while
another row streams. Frozen headers and complete bodies use separate source-object
caches; rebuilding headers on unrelated deltas would defeat `TimelineToolRow`
memoization even while bodies remain deferred. Mutable supplied test inputs remain
uncached, and a revised frozen source gets its own presentation.


- An empty supplied timeline keeps a focusable history scroller with `EmptyThread` inside. Without a snapshot, chrome, Top overlay and pending inline prompts still mount and measure.
- Since [#179](../codebase/179.md), the timeline is the **only** thread surface — no split-brain, no empty second region. `MessageThread`/`selectMessages` are retained but unread residue.
- A click or Enter submits through the host-qualified pending-send store, capturing authenticated device/message identity. Whitespace does nothing; identity or bridge failure preserves recoverable input. Accepted daemon items settle only the exact host/device/message pair. See [Composer send](composer-send.md).
- **Dark scheme only**; the desktop sidebar stays fixed while the chat pane reflows down to the 800px minimum window width.
- **Connection feedback** — reads the open host through `useOpenConnectionStatus` and uses `connectionNotice` for fixed generic, pairing-expired or daemon-update copy. One Top overlay pill combines the connection explanation, visible offline saved-row notice and independent loading feedback. Connected state clears connection/offline copy; read settlement clears loading. See [announcement ownership](conversation-shell-chrome.md#connection-and-saved-history-announcement).
- Renderer unit tests use `renderToStaticMarkup`: store-bound containers read Zustand's initial server snapshot, and effects, geometry and clicks do not run. Fake-transport Electron coverage establishes interaction; see [test boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).
- **Session-boundary delimiter** ([#286](../codebase/286.md), redrawn [#690](https://github.com/pyrycode/pyrycode-desktop/issues/690)) — appears only when a `sessionBoundary` item exists; an empty thread and a thread with no boundary render exactly as before. Its `clear`/`idle_evict` copy is no longer provisional as of #690 — `Session reset` / `Session reset after idle` are the shipped labels, not a placeholder awaiting a Figma variant.
- **Queued rows** — supplied shown queued user items keep dimmed bubbles and valid attachments. Usable raw handles and a connected owning host gate Cancel/Send now; Send now also requires `mid_turn_input`. Drop hides only after the supplied revision, with no optimistic removal. See [queue authority](conversation-shell-behavior.md#what-it-does).
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
