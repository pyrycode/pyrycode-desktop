# Conversation shell

The renderer's first screen: a scrollable message thread above a bottom-pinned composer, styled from the mobile **Conversation Thread** screen (Figma node `16-8`) stretched to the desktop window. It is the surface later tickets bind real state into.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders the conversation thread and composer for a session: a thread region that fills the window height and scrolls independently, and a composer (text input + send button) pinned to the bottom edge. The thread now renders the **live** message list from the [session store](session-store.md) — streamed daemon replies appear as they arrive ([#69](../codebase/69.md)). The composer is now **wired**: typing a message and submitting it (send button or Enter) sends it and shows it in the thread immediately as an optimistic echo ([#66](../codebase/66.md) — see [Composer send](composer-send.md)).

The app bar, status row, tool-call chips, code blocks, session delimiters, and the mic icon shown in the Figma node are **deliberately out of scope** — they render conversation/connection/model state that lands in later slices. This screen builds the message thread and composer only.

A minimal seed of that future top app bar landed in [#166](../codebase/166.md): a slim header row above the thread holding an unpair escape hatch. See [Unpair control](conversation-shell-chrome.md#unpair-control-166) below.

A **proactive** twin of that escape hatch landed in [#167](../codebase/167.md): beneath the composer, a `Re-pair` button that appeared only when the connection had hit a terminal failure or the daemon had rejected the pairing, instead of requiring the user to notice the manual header control. [#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) folded it into the composer status row's own error slot as a filled button, in place of the block beneath the composer. See [Re-pair control](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963) below and [Composer — actionable-error button](conversation-shell-composer-status.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963).

A **third, prominent** read of the connection status landed in [#279](../codebase/279.md): a disconnected-only banner across the top of the thread, between the header row and the message list — distinct from both the composer's terse inline gate and the still-separate #149 two-dot indicator. See [Connection banner](conversation-shell-chrome.md#connection-banner-279) below.

A **pre-first-message workspace chip** landed in [#278](../codebase/278.md): a Material 3 pill above the empty new-discussion thread showing the workspace `cwd` the discussion will run in, with a disabled "Change" placeholder reserved for the #157 Workspace Picker sheet. Gone once the thread has its first message. See [Workspace chip](conversation-shell-workspace-and-run-config.md#workspace-chip-278) below.

The chip's "Change" placeholder was wired in [#383](../codebase/383.md): a bottom sheet (Figma node 20-2) listing the [recent-workspaces store](recent-workspaces-store.md) (#382), marking the row matching the active conversation's `cwd` with a "default" pill, and dispatching the existing [`changeWorkspace` command](conversation-workspace-change.md) (#379) on selection — the daemon's `conversation_updated` reply reflects the change into the conversation list for free, no optimistic update. Closes #157's split except for the "Other" section's create-folder dialog, deferred to #384. See [Workspace Picker sheet](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) below.

The status row and the "Run configuration" sheet it opens landed as a **chrome-only shell** in [#177](../codebase/177.md): a trigger row between the thread and the composer, and a host modal that renders no live data or sections yet. See [Run configuration sheet](conversation-shell-workspace-and-run-config.md#run-configuration-sheet-177) below.

The sheet's first section, **Log data** (a Download button for the debug bundle), landed in [#72](../codebase/72.md): the last child in the sheet body, beneath where Model/Effort/YOLO/Context-window will mount. See [Log data section](conversation-shell-workspace-and-run-config.md#log-data-section-72) below.

A second, **structured-stream** thread landed in [#203](../codebase/203.md): a `Timeline` view mounted beside `MessageThread`, rendering [thread-timeline store](conversation-timeline-store.md) items (the streamed assistant text, with a streaming cursor on the in-progress bubble) in a Strangler-Fig coexistence with the coarse thread above it. Inert (empty, zero footprint) in production until #179 flipped the `interactive` capability. See [Structured-stream timeline render](conversation-shell-turn-status.md#structured-stream-timeline-render-203) below.

`Timeline`'s structural twin over the store's coarse `phase` scalar landed in [#215](../codebase/215.md): a "Thinking…" affordance mounted right after `Timeline`, covering the pre-text window the daemon opens with `turn_state{thinking}` before any assistant delta — otherwise the thread shows nothing and a slow turn looks stalled. Also inert until #179 (below). See [Thinking indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967) below.

`ThinkingIndicator`'s own twin, over a second store scalar, landed in [#317](../codebase/317.md): a `StallIndicator` mounted as its sibling, showing a problem-state affordance when the daemon's onset-only `stall` signal (#315) fires and self-clearing on the next turn activity (client-derived in the reducer — there is no daemon "cleared" frame). A first supersede peer, `ApiRetryIndicator`, landed in [#493](../codebase/493.md) over the daemon's `api_retry` signal (#492); a **second**, `CompactingIndicator`, landed in [#496](../codebase/496.md) over `compacting` (#495), mounted right after `ApiRetryIndicator` and, like it, occluding the thinking indicator rather than co-rendering beside it. All three retired in [#967](https://github.com/pyrycode/pyrycode-desktop/issues/967), which folded their copy into `ThinkingIndicator`'s own widened label instead of three separate mounts. See [Thinking / working indicator § Retired by #967](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967) below.

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
\#583 (latest patch, shipped); visual design is #580's. See [Background-task panel](conversation-shell-turn-status.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)
below.

The screen gained an interactive **permission/trust modal** in [#224](../codebase/224.md): a centered M3 dialog overlaying `.conversation`, rendering the oldest [outstanding modal prompt](modal-store-bridge.md) — title, prompt text, and ordered option buttons with the fail-safe default visually marked. Mounts the modal bridge that had shipped dormant in [#223](../codebase/223.md). Its option buttons and a new leading Cancel affordance became **answerable** in [#237](../codebase/237.md): each dispatches `answerModalCommand`/`cancelModalCommand` (#236) and clears the prompt locally via the existing `dismissed` reducer arm. Selecting a non-default option now surfaces a client-side `Back`/`Confirm` sub-step before that command is sent — a second-confirm UX policy gated on `defaultOptionId`, since the wire carries no `destructive` signal ([#226](../codebase/226.md)); the held-option marker is scoped to the exact prompt it was selected on via the prompt's `modalId`, closing a same-class-prompt collision ([#511](../codebase/511.md)). Inert in production until #179 flipped the `interactive` capability. See [Permission modal](conversation-shell-permission-modal.md#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511) below.

## How it works

This screen is large enough that its surfaces live in their own documents. Each one keeps its original section headings, so an existing `#anchor` still resolves once you follow the link here.

- [Chrome and controls](conversation-shell-chrome.md) — The screen's structure and the persistent controls around the thread: layout, theme, the back, unpair and re-pair controls, and the connection surfaces in the header.
- [Workspace and run configuration](conversation-shell-workspace-and-run-config.md) — Choosing where a session runs and how it is configured: the workspace chip and picker, the run configuration sheet and its sections, and the log data section.
- [Turn status surfaces](conversation-shell-turn-status.md) — What the screen shows while a turn is running: the timeline render, the thinking indicator, the background-task panel, and the retry, compacting and stall indicators.
- [Composer](conversation-shell-composer.md) — The composer's own surfaces: its status row, error chip and footer row. The options panel is large enough to have its own document.
- [Composer options panel](conversation-shell-composer-options.md) — The composer's options panel: its resting appearance, placement, keyboard driving, and the live wiring behind each control.
- [Tool rows](conversation-shell-tool-rows.md) — How a tool call is painted from the moment it appears to the moment its result can be read: the pending and resolved rows, the expandable result, the collapsed headline and the input field list.
- [Tool row layout](conversation-shell-tool-row-layout.md) — Map only. The later redraw of the tool row: the shell command code block, the full-width bordered row, the header's groups and run routing, and the expanded body's own drawing (field values and result), split across six documents.
- [Conversation surfaces and modals](conversation-shell-conversation-and-modals.md) — Surfaces that act on the conversation as a whole rather than on one turn. Now a map itself: the interactive flip + thread cutover, the queued backlog, and screen-snapshot history stayed here; three larger topics split out on 2026-09-02 (below).
- [Actions menu and reader cutover](conversation-shell-actions-menu-and-reader-cutover.md) — The composer's Actions menu and the per-conversation timeline reader cutover.
- [Modals](conversation-shell-modals.md) — The permission/trust modal (with its rejection surface) and the question panel.
- [Session boundaries and channel info](conversation-shell-session-and-channel-info.md) — The session-boundary delimiter row and the Channel Info sheet, with its Rename/Archive/Delete actions.
- [Message bubble](conversation-shell-message-bubble.md) — The later redraw of the message bubble itself: the desktop `Message` shape, the meta row and its copy control.

The seams this screen exposes are in [Seams](conversation-shell-seams.md).
## Edge cases and limitations

- An **empty `items` array** renders a valid empty scroll region — no crash, no placeholder fallback (`Timeline` returns `null`). A just-connected session with no messages yet renders a clean empty thread. (Historical: before [#179](../codebase/179.md) this was the coarse `messages` array; `sessionStore.messages` still returns `[]` on initial state, but nothing reads it in production anymore.)
- Since [#179](../codebase/179.md), the timeline is the **only** thread surface — no split-brain, no empty second region. `MessageThread`/`selectMessages` are retained but unread residue.
- The send button is **wired** ([#66](../codebase/66.md)): a click (or Enter) sends the composed message and appends an optimistic echo, now into the timeline ([#179](../codebase/179.md)). A whitespace-only input does nothing; a send-bridge failure is swallowed (no crash). See [Composer send](composer-send.md).
- **Dark scheme only**; no responsive layout beyond flex reflow; no desktop-native layout (the plan defers that until the app is fully functioning).
- **Connection banner** ([#279](../codebase/279.md)) — renders across the top of the thread whenever `selectStatus` is not `connected`, disappearing on reconnect with no reload; text is always the client-owned `CONNECTION_BANNER_COPY`, never `ConnectionError.message`. Through [#968](../codebase/968.md) it coexisted with the composer's own terse caption (#31), both visible while disconnected by design; #968 dropped that caption, and the banner is now the only announcement of a non-connected state outside the `error` arm's status-row occupant (#797/#963).
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
  entry now opens a working dialog ([#398](../codebase/398.md)) whenever a conversation is active; it
  remains inert only in the same list-opened, no-active-conversation case as the rest of the sheet.
- **Background-task panel** ([#581](../codebase/581.md)) — a list-opened thread (no active conversation)
  reads `conversationId: null`, which `selectRosterFor` resolves to the "never observed" reading, so
  the panel opens gracefully with no crash and no rows, same posture as the Channel Info and Workspace
  Picker sheets. `panelOpen` is independent of the other three open-state booleans, so overlays could in
  principle stack — not reachable through normal use, no AC requires mutual exclusion. No terminal state
  is ever shown: a task leaves the list only by no longer appearing in the next roster, never by an
  explicit "done" render. Stale-list-after-reconnect is a known, out-of-scope limitation shared with the
  store itself (#569, blocked on a daemon change) — the panel does not paper over it.
- **Thread scroll pin** ([#601](../codebase/601.md), built on the dormant `isAtBottom` helper from
  [#600](../codebase/600.md)) — `.conversation__thread` now stays pinned to the bottom while a new item
  arrives, but only if the operator was already there; a screen-local `useRef` flag, written only by the
  container's own scroll events and re-asserted in a dependency-free layout effect, decides — never a
  measurement taken after the new content is already in the layout. `Timeline` gained one optional
  `scrollPin` prop bundling the ref and the scroll handler so the ~30 pre-existing render sites needed no
  edits. Every chrome sibling below the thread that can still mount or unmount there (`__queued`/
  `__interrupt`) does so with no risk of un-pinning a thread the operator never scrolled — a chrome mount
  only shrinks the thread's viewport, which cannot fire a scroll event. (Through #967 that list also
  included `__stall`/`__api-retry`/`__compacting`; all three retired along with the views that mounted
  them — see below.) **`.conversation__thinking` left this list in
  [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796):** its markup now lives inside the
  composer status row, a fixed-height element that is mounted at all times, so `turn_state{thinking}` no
  longer shrinks anything — it only swaps a label inside an already-present row.
  `thread-scroll-pin.spec.ts`'s fourth criterion existed specifically to prove a chrome mount shrinks the
  thread without un-pinning it; left pointed at the working indicator it would have kept passing against a
  viewport that had stopped moving, silently testing nothing. #796 repointed it onto the stall indicator
  (`.conversation__stall`), which kept its own bubble treatment and still shrank the region at the time —
  the daemon's `stall` frame drove it, with `conversationActivityBridge.ts`'s unconditional
  stall-clear-on-any-turn-state independently confirmed to make the subsequent `toHaveCount(0)` assertion
  correct rather than incidental.

  **[#967](https://github.com/pyrycode/pyrycode-desktop/issues/967) folded the stall block into the
  composer status row too** (see [Conversation shell — turn status § Retired by
  #967](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)),
  which took the criterion's subject away a second time — the same swap #796 made, for the same reason,
  now needed again. The criterion moved onto the [queued
  backlog](conversation-shell-conversation-and-modals.md#queued-backlog--drop-affordance-294-drop-since-296)
  (`.conversation__queued`), a region of dimmed rows large enough to shrink the viewport by tens of pixels
  (116px measured with a two-item backlog at the time) — deliberately not #963's 8px row-growth, which
  needs a terminal connection error the spec has no reason to stage. **The repoint exposed a real gap**:
  `useThreadScrollPin`'s re-assert is a dep-free layout effect that runs on **screen** renders, and
  `QueuedBacklogControl` (the region's container at the time) held its own queue-store subscription, so a
  `queue_state` push re-rendered that control alone and the pin never ran — the thread rested short of the
  bottom (116px with #967's setup) until some unrelated render re-pinned it. #967 filed that gap as
  [#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) rather than fix it (out of scope for a
  ticket that does not otherwise touch `useThreadScrollPin`) and pointed the criterion at the two-step
  shape the gap forced: shrink (a `queue_state` push), then a *following* screen render (the stall push)
  that must still re-pin, with the immediate case commented rather than asserted.

  **[#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) closed the gap.**
  `ConversationScreen` now reads the open conversation's backlog itself — a `useMemo`-stable
  `selectBacklogFor(openConversationId ?? '')` selector, the same idiom `selectOpenTimelineFor` uses one
  read above — and mounts the pure `QueuedBacklog` view directly; `QueuedBacklogControl` is retired.
  Because the read lives on the screen, a `queue_state` that mounts *or grows* the region is now a screen
  render like any other, so the existing dep-free effect covers it under the rule it already claimed to.
  Mount and re-pin land in the same commit — `setBacklog` changes the selector's array reference, React
  re-renders the screen, the DOM grows `.conversation__queued`, and the layout effect runs before paint —
  so `thread-scroll-pin.spec.ts` asserts pinned immediately after the queued rows appear, with no polling
  and no following render required. A second push that grows an already-mounted backlog (`n → n+1` rows)
  is asserted the same way, closing the case a fix keyed on "the backlog is non-empty" would miss: that
  boolean does not change while the region shrinks the viewport again. The scrolled-away case is
  unaffected — both pushes leave `scrollTop` exactly where the operator left it, since the tracked flag,
  not the geometry, still governs whether anything scrolls. The measured gap was **132px** at fix time (not
  #967's 116px — the quantity is the mounted region's height, and #969 had redrawn the message bubble in
  between; the order of magnitude, and the criterion's point, is unchanged).

  This is also why the two leaves the docblock now names as deliberately un-hoisted —
  `ComposerErrorSlotControl`'s own `sessionStore` read and `ComposerSlot`'s own question-batch read — stay
  un-hoisted rather than getting the same treatment: both arguments are about traffic the screen has no use
  for (a connection-status flap, a keystroke in the question panel), where the backlog read is the opposite
  on frequency, relevance and cost (`selectBacklogFor` returns the same reference, or the shared
  `EMPTY_BACKLOG`, for every conversation but the open one, so `Object.is` short-circuits and nothing
  re-renders for a snapshot elsewhere). Their own shrink — `ComposerErrorSlotControl`'s ~8px button growth,
  `ComposerSlot`'s question panel — was a known, uncovered latency gap at #1009: the flag stayed correct
  through it (no scroll event fires), so the next screen render still re-pinned, same as the queued backlog
  did before #1009. **[#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049) closed both as a free
  consequence of a mechanism built for a different case, not as its own deliverable:** its `ResizeObserver`
  watches `.conversation__thread` itself alongside every direct-child row, and both occupants' shrink is
  exactly a change to the container's own border box, so the observation fires and the shared write re-pins.
  Neither has a criterion of its own and neither was #1049's target — they are recorded here because the
  inventory above needs to stay true, not because either was measured.

  `overflow-anchor` stays unset — closed as indifferent by #601, confirmed on an observed e2e run rather
  than reasoned about, but that ruling covered only the screen-render cases #601 tested. **[#1046](https://github.com/pyrycode/pyrycode-desktop/issues/1046) found it decisive, not
  indifferent, for the one case those tests couldn't reach:** a growth that involves no React render
  anywhere. A thumbnail resolving **above** a bottom-resting reader is exactly that case, and anchoring
  already holds it. Growth **below** the reader — a thumbnail resolving in their own last row — is the one
  direction anchoring is indifferent to, left open by #1046 and closed by
  **[#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049)**: the same `ResizeObserver` above (the
  container and each direct-child row) re-runs the pin's one guarded write, `reassertPinnedToBottom`, on the
  row's own resize. The write is idempotent and the flag is the only hinge, so a scrolled-up reader is
  untouched and a picture-above reader sees the write as a no-op — anchoring has already moved `scrollTop` by
  the time resize observations are delivered. One trap surfaced only under measurement: a thumbnail settles
  in more than the two layout steps `useThreadScrollPin`'s docblock names — the `<img>` mount's 12px margin
  lands first, the decoded picture's 160px a frame or more later — and the pin's own re-pin on the first step
  queued a scroll event that `onScroll` read, against the second step's growth, as the operator scrolling
  away. The fix is `pinnedOffset`: the write records the offset it produced, only when it actually moved it,
  and `onScroll` declines to re-measure through exactly that one echo, clearing the record on every event so
  it can never outlive one. Measured at 172px short (`scrollHeight` 2028 → 2200) with no fix, 0 with it.
  **Send-forces-pin** ([#602](../codebase/602.md)) rides this exact
  mechanism with no second one: `useThreadScrollPin` now also returns `followBottom`, a single
  `following.current = true` re-arm, wired as a required `onMessageSent` prop on `Composer` and invoked
  inside `handleSubmit`'s existing `if (sent)` branch — so a submit that sends nothing (not connected,
  whitespace-only, no active conversation) never re-arms the flag and leaves no armed pin behind for the
  next unrelated arriving item to yank. Because the re-assert layout effect has no dependency array,
  "jump to the bottom now" and "stay pinned while the reply streams" are the same fact observed at two
  times — an operator who scrolls up again mid-stream still wins, unchanged from #601. **Re-entry lands at
  the bottom** ([#603](../codebase/603.md)) closes the family with zero production code: the original
  "open at the top of history" premise didn't survive refinement (no backfill exists — opening a
  *different* discussion always starts empty), so the only reachable case is re-opening the *same*
  discussion. That already worked, as an emergent product of the id-gated timeline reset
  (`activateConversation.ts:92-95`), Back unmounting `ConversationScreen` via a different-component-type
  swap (`PairedShell.tsx:88-97`), and `following`'s `true` initial value pinning before paint on the fresh
  mount — three independent facts, none added for this ticket, now locked by an e2e test rather than left
  as an untested accident.

  **A late-resolving image thumbnail ([#1046](https://github.com/pyrycode/pyrycode-desktop/issues/1046))
  is the third member of the docblock's own "known latency gap" class, and it closed on inspection rather
  than on a code change.** `BubbleAttachmentImage` ([Message bubble § The attachment image
  thumbnail](conversation-shell-message-bubble.md)) resolves in two events: its own `useState` flips
  `pending` → `ready`, a React render of the leaf alone that `ConversationScreen` never sees, and then the
  browser decodes and lays the picture out — up to 172px of growth (`.bubble__image`'s 160px `max-height`
  plus its 12px `margin-top`) with **no React render anywhere**. Hoisting the read, [#1009](../codebase/1009.md)'s
  fix for the queued-backlog gap, cannot reach this one: the hoisted render would still land before the
  image decodes. What closes it is Chromium's scroll anchoring, already live because `.conversation__thread`
  leaves `overflow-anchor` at its default — measured against the built app (172px of drift with
  `overflow-anchor: none` added, 0px without it) and now pinned by the last two tests in
  `thread-scroll-pin.spec.ts`, shown failing with that one line present. No production behaviour shipped;
  the two comment-only edits (this docblock and `.conversation__thread`'s own rule in `conversation.css`)
  exist so a future `ResizeObserver` addition — still on the docblock's list for the *other* two known
  gaps — does not get layered over a case the browser already handles for free. Anchoring is indifferent to
  growth **below** the reader (their own last bubble); that gap is unaffected and stays filed as
  [#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049).

## Related

- [Welcome screen](welcome-screen.md) — the mark's original home; [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) moved the shared `PyryMark` component into `theme/PyryMark.tsx` so the composer status row's icon and the welcome hero's mark are the same 12 KB path, not a drifted copy; the welcome screen's own call site and markup are unchanged.
- [App shell](app-shell.md) — the router that mounts the `paired`/`conversation` route (#80); gains the `onUnpaired` reverse-flip seam this screen's unpair control fires (#166)
- [Paired shell](paired-shell.md) — the second-level `list ⇄ thread` router now mounting this screen as its `thread` view (#140); source of the `onBack` seam this screen's back control fires; its `conversation_created` nav callback now also writes `activeConversationStore` (#278), routed since [#530](../codebase/530.md) through `activateConversation`, which clears the timeline and session id first when the active conversation's id actually changes; its `onUnpaired`/`onPairServerPaired` handlers clear `activeConversationStore` unconditionally since [#531](../codebase/531.md), via `clearPairingScopedState`, when the pairing itself ends
- [Session store](session-store.md) — the state the coarse thread rendered through #69–#178; the `MessageThread`/status seams bound to it (#2, bound in #69); gains the `reset` action the unpair control dispatches (#166); its `messages` slice is unread residue since [#179](../codebase/179.md) (status/`selectStatus` is still live, read by the composer's send gate)
- [Composer send](composer-send.md) — the composer's now-wired submit + optimistic echo (#66), retargeted from the session store into the timeline store since [#179](../codebase/179.md); the send half of this screen; also home of `shouldShowBanner`/`CONNECTION_BANNER_COPY` (#279), the connection banner's predicate + copy, co-located beside `composerAvailability`/`shouldOfferRepair` as a third read of `ConnectionStatus`
- [Unpair channel](unpair-channel.md) — the main-side bridge this screen's Re-pair control consumes via `runUnpair`; originally `window.pyry.unpair()`, the whole-collection channel (#173, consumed in #166, #167), migrated onto the per-server `window.pyry.unpairServer(serverId)` by [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163), which deleted the whole-collection channel outright
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
- [Queue store](queue-store.md) / [Dequeue message envelope](dequeue-message-envelope.md) — the store `ConversationScreen` reads via `selectBacklogFor(openConversationId ?? '')` (#293, consumed in #294, rekeyed off the active conversation id by #448, hoisted out of the retired `QueuedBacklogControl` and into the screen itself by [#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) so the region's mount and growth re-pin the thread), and the outbound command the drop affordance's `dropQueuedMessage` dispatches (#299/#300, consumed in #296) — the queue-drop family is now complete end to end.
- [Recent-workspaces store](recent-workspaces-store.md) — the dedicated store + dormant bridge `WorkspacePickerSheet` reads via `selectRecentWorkspaces` and mounts (`RecentWorkspacesData`), its first real consumer (#382, consumed in #383)
- [Conversation workspace change](conversation-workspace-change.md) — the `changeWorkspace` command `requestChangeWorkspace` dispatches on a row choice, its first real caller (#379, consumed in #383)
- [Background-task roster store](background-task-roster-store.md) — the store `BackgroundTaskPanel` reads via `selectRosterFor(conversationId)`, its first real consumer since the store shipped dormant at #573 (#581, extended to read `droppedTasks`/`truncatedFields` in #582 and `latestUpdate` in #583, see [Background-task panel](conversation-shell-turn-status.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583) above)
- [Assistant markdown renderer](assistant-markdown-renderer.md) — `AssistantMarkdown`, shipped dormant at #608, wired into this screen's `assistantText` settled branch by [#609](../codebase/609.md); the `.bubble__markdown` container and its block-rhythm/code-wrap CSS live in `conversation.css`, not in that module
- [Message bubble](conversation-shell-message-bubble.md) — the later redraw of `.bubble`/`.bubble--user`/`.bubble--daemon` from the mobile shape to the desktop `Message` component, the `title-small` token family it added, and the meta row + copy control it appended to both `TimelineRow` message arms (#969); the queued row and the unmounted `MessageBubble` residue take the CSS restyle but not the meta row
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md), [ADR 0002 — Remote head over relay](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#1 codebase notes](../codebase/1.md) · [#69 codebase notes](../codebase/69.md) · [#166 codebase notes](../codebase/166.md) · [#177 codebase notes](../codebase/177.md) · [#72 codebase notes](../codebase/72.md) · [#167 codebase notes](../codebase/167.md) · [#187 codebase notes](../codebase/187.md) · [#188 codebase notes](../codebase/188.md) · [#191 codebase notes](../codebase/191.md) · [#192 codebase notes](../codebase/192.md) · [#203 codebase notes](../codebase/203.md) · [#140 codebase notes](../codebase/140.md) · [#214 codebase notes](../codebase/214.md) · [#215 codebase notes](../codebase/215.md) · [#217 codebase notes](../codebase/217.md) · [#218 codebase notes](../codebase/218.md) · [#229 codebase notes](../codebase/229.md) · [#230 codebase notes](../codebase/230.md) · [#245 codebase notes](../codebase/245.md) · [#179 codebase notes](../codebase/179.md) · [#237 codebase notes](../codebase/237.md) · [#226 codebase notes](../codebase/226.md) · [#279 codebase notes](../codebase/279.md) · [#285 codebase notes](../codebase/285.md) · [#286 codebase notes](../codebase/286.md) · [#278 codebase notes](../codebase/278.md) · [#323 codebase notes](../codebase/323.md) · [#324 codebase notes](../codebase/324.md) · [#328 codebase notes](../codebase/328.md) · [#329 codebase notes](../codebase/329.md) · [#330 codebase notes](../codebase/330.md) · [#492 codebase notes](../codebase/492.md) · [#493 codebase notes](../codebase/493.md) · [#495 codebase notes](../codebase/495.md) · [#496 codebase notes](../codebase/496.md) · [#365 codebase notes](../codebase/365.md) · [#366 codebase notes](../codebase/366.md) · [#368 codebase notes](../codebase/368.md) · [#377 codebase notes](../codebase/377.md) · [#383 codebase notes](../codebase/383.md) · [#529 codebase notes](../codebase/529.md) · [#530 codebase notes](../codebase/530.md) · [#581 codebase notes](../codebase/581.md) · [#582 codebase notes](../codebase/582.md) · [#583 codebase notes](../codebase/583.md) · [#600 codebase notes](../codebase/600.md) · [#601 codebase notes](../codebase/601.md) · [#618 codebase notes](../codebase/618.md) · Spec: `docs/specs/architecture/1-app-shell-and-theme-tokens.md`
