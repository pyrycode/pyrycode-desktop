# Conversation shell

The renderer's first screen: a scrollable message thread above a bottom-pinned composer, styled from the mobile **Conversation Thread** screen (Figma node `16-8`) stretched to the desktop window. It is the surface later tickets bind real state into.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders the conversation thread and composer for a session: a thread region that fills the window height and scrolls independently, and a composer (text input + send button) pinned to the bottom edge. The thread now renders the **live** message list from the [session store](session-store.md) — streamed daemon replies appear as they arrive ([#69](../codebase/69.md)). The composer is now **wired**: typing a message and submitting it (send button or Enter) sends it and shows it in the thread immediately as an optimistic echo ([#66](../codebase/66.md) — see [Composer send](composer-send.md)).

The app bar, status row, tool-call chips, code blocks, session delimiters, and the mic icon shown in the Figma node are **deliberately out of scope** — they render conversation/connection/model state that lands in later slices. This screen builds the message thread and composer only.

A minimal seed of that future top app bar landed in [#166](../codebase/166.md): a slim header row above the thread holding an unpair escape hatch. See [Unpair control](#unpair-control-166) below.

A **proactive** twin of that escape hatch landed in [#167](../codebase/167.md): beneath the composer, a `Re-pair` button that appears only when the connection has hit a terminal failure or the daemon has rejected the pairing, instead of requiring the user to notice the manual header control. See [Re-pair control](#re-pair-control-167) below.

A **third, prominent** read of the connection status landed in [#279](../codebase/279.md): a disconnected-only banner across the top of the thread, between the header row and the message list — distinct from both the composer's terse inline gate and the still-separate #149 two-dot indicator. See [Connection banner](#connection-banner-279) below.

A **pre-first-message workspace chip** landed in [#278](../codebase/278.md): a Material 3 pill above the empty new-discussion thread showing the workspace `cwd` the discussion will run in, with a disabled "Change" placeholder reserved for the #157 Workspace Picker sheet. Gone once the thread has its first message. See [Workspace chip](#workspace-chip-278) below.

The chip's "Change" placeholder was wired in [#383](../codebase/383.md): a bottom sheet (Figma node 20-2) listing the [recent-workspaces store](recent-workspaces-store.md) (#382), marking the row matching the active conversation's `cwd` with a "default" pill, and dispatching the existing [`changeWorkspace` command](conversation-workspace-change.md) (#379) on selection — the daemon's `conversation_updated` reply reflects the change into the conversation list for free, no optimistic update. Closes #157's split except for the "Other" section's create-folder dialog, deferred to #384. See [Workspace Picker sheet](#workspace-picker-sheet-383) below.

The status row and the "Run configuration" sheet it opens landed as a **chrome-only shell** in [#177](../codebase/177.md): a trigger row between the thread and the composer, and a host modal that renders no live data or sections yet. See [Run configuration sheet](#run-configuration-sheet-177) below.

The sheet's first section, **Log data** (a Download button for the debug bundle), landed in [#72](../codebase/72.md): the last child in the sheet body, beneath where Model/Effort/YOLO/Context-window will mount. See [Log data section](#log-data-section-72) below.

A second, **structured-stream** thread landed in [#203](../codebase/203.md): a `Timeline` view mounted beside `MessageThread`, rendering [thread-timeline store](conversation-timeline-store.md) items (the streamed assistant text, with a streaming cursor on the in-progress bubble) in a Strangler-Fig coexistence with the coarse thread above it. Inert (empty, zero footprint) in production until #179 flipped the `interactive` capability. See [Structured-stream timeline render](#structured-stream-timeline-render-203) below.

`Timeline`'s structural twin over the store's coarse `phase` scalar landed in [#215](../codebase/215.md): a "Thinking…" affordance mounted right after `Timeline`, covering the pre-text window the daemon opens with `turn_state{thinking}` before any assistant delta — otherwise the thread shows nothing and a slow turn looks stalled. Also inert until #179 (below). See [Thinking indicator](#thinking-indicator-215) below.

`ThinkingIndicator`'s own twin, over a second store scalar, landed in [#317](../codebase/317.md): a `StallIndicator` mounted as its sibling, showing a problem-state affordance when the daemon's onset-only `stall` signal (#315) fires and self-clearing on the next turn activity (client-derived in the reducer — there is no daemon "cleared" frame). See [Stall indicator](#stall-indicator-317) below.

A **second** supersede peer for `ThinkingIndicator` landed in [#496](../codebase/496.md): a `CompactingIndicator` showing "Compacting the conversation…" while the daemon's `compacting` signal (#495) is live, mounted right after `ApiRetryIndicator` and, like it, occluding the thinking indicator rather than co-rendering beside it. See [Compacting indicator](#compacting-indicator-496) below.

**The cutover landed in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse `message` fan-out stops daemon-side, the composer's optimistic echo routes into the timeline as a `userText` item, and the coarse `MessageThread` mount is retired. `Timeline` is now the conversation's **single** thread surface — every "inert until #179" render slice below (the structured-stream thread, the thinking indicator, the tool-call rows, the permission modal) is now live. See [The interactive flip + thread cutover](#the-interactive-flip--thread-cutover-179) below.

This screen is now the **thread view** of the [paired shell](paired-shell.md), landed in [#140](../codebase/140.md): the paired region enters at a list first, and opening a conversation mounts this screen, which gained a leading back affordance to return to the list. See [Back control](#back-control-140) below.

A **queued backlog** landed in [#294](../codebase/294.md): the messages queued while the daemon is
busy render as a dimmed, not-yet-run tail below the thread, reusing the delivered user-bubble
treatment. Each row gained a **drop / cancel affordance** in [#296](../codebase/296.md): an
icon-only button that dispatches a removal for that entry, with no optimistic UI — the row leaves
only when the daemon's next queue snapshot confirms it. See [Queued backlog + drop
affordance](#queued-backlog--drop-affordance-294-drop-since-296) below.

A **screen-snapshot request + display** landed in [#324](../codebase/324.md) and was **removed in
[#618](../codebase/618.md)**: the feature answered by photographing claude's terminal, which was
deleted upstream (pyrycode#1348), leaving the button enabled and silently inert. See
[Screen-snapshot action & display](#screen-snapshot-action--display-324-removed-618) below.

An **openable background-task panel** landed in [#581](../codebase/581.md): a `StatusRow`-sibling
trigger between the thread and the composer opens an overlay listing the tasks
[`backgroundTaskRosterStore`](background-task-roster-store.md) (#573/#576/#577) holds alive for the
open conversation — work that outlives a turn, which the chat's turn-shaped rendering has no way to
express, without adding a single row to the timeline. The store's three `selectRosterFor` readings
(never-observed, observed-with-nothing-alive, populated) render as three structurally distinct
outputs. This slice is the shell: chrome, the trigger, the three-way branch, and one row per task
showing `description` + `taskType` only. Split from #568 alongside #582 (truncation/cap reports) and
#583 (latest patch, shipped); visual design is #580's. See [Background-task panel](#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)
below.

The screen gained an interactive **permission/trust modal** in [#224](../codebase/224.md): a centered M3 dialog overlaying `.conversation`, rendering the oldest [outstanding modal prompt](modal-store-bridge.md) — title, prompt text, and ordered option buttons with the fail-safe default visually marked. Mounts the modal bridge that had shipped dormant in [#223](../codebase/223.md). Its option buttons and a new leading Cancel affordance became **answerable** in [#237](../codebase/237.md): each dispatches `answerModalCommand`/`cancelModalCommand` (#236) and clears the prompt locally via the existing `dismissed` reducer arm. Selecting a non-default option now surfaces a client-side `Back`/`Confirm` sub-step before that command is sent — a second-confirm UX policy gated on `defaultOptionId`, since the wire carries no `destructive` signal ([#226](../codebase/226.md)); the held-option marker is scoped to the exact prompt it was selected on via the prompt's `modalId`, closing a same-class-prompt collision ([#511](../codebase/511.md)). Inert in production until #179 flipped the `interactive` capability. See [Permission modal](#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511) below.

## How it works

### Structure

`App.tsx` mounts `<ConversationScreen />` as the **thread view** of the [paired shell](paired-shell.md)'s `list ⇄ thread` router, itself mounted on the `conversation` route ([#80](../codebase/80.md) — see [App shell](app-shell.md); before #80, `App` rendered it directly; before [#140](../codebase/140.md), `AppView` rendered it directly on the `conversation` route with no list and no way back). The screen is a flex column:

```
ConversationScreen            .conversation        (flex column, full height, position: relative)
├── BackControl                .conversation__back   (leading icon button, #140, null when onBack absent)
├── UnpairControl              .conversation__header (slim header row, #166)
├── ConnectionBannerControl    .conversation__banner (null unless not-connected, top of thread, #279)
├── WorkspaceChip              .conversation__workspace-chip (null unless empty + unpromoted, #278; onChange opens WorkspacePickerSheet, #383)
├── Timeline                  .conversation__thread (null when empty; the single thread surface since #179, #203)
│   └── TimelineRow × N       .message-row--user/.bubble--user (userText, #179) · .message-row--daemon/.bubble--daemon (assistantText) · .tool-row/.tool-row__chip (toolCall, #218; resolved modifiers #230)
├── (ApiRetryIndicator / CompactingIndicator / StallIndicator — the three problem-state bubbles right after Timeline; unaffected by #796, see below)
├── StatusRow                 .status-row          (trigger, between thread and composer, #177)
│   └── ConnectionStatusIndicatorControl .status-row__connection (two dots, inside .status-row__summary, #330)
├── BackgroundTaskTrigger      .background-task-trigger (StatusRow sibling, unconditional, #581)
├── ComposerStatusArea         .composer-status     (fixed-height row above the composer; NEVER null, #796)
│   ├── ThinkingIndicator       .composer-status__label ("Thinking…"/"Working…"/"Running <tool>…", #648, #649; off the daemon-bubble surface since #796)
│   └── ComposerErrorChipControl .composer-status__error (row's trailing slot, right-aligned; null unless the `error` connection arm, #797)
├── Composer                  .composer            (pinned)
│   └── ContextUsageControl     .composer__footer    (third row, below `.composer__row`; holds one reading today — the other four desktop-layout slots (#680/#682/#683/#685) stay empty, #811)
├── RepairControl              .composer__repair    (conditional, beneath composer, #167)
├── StatusSheet (if open)     .status-sheet-overlay (absolute overlay, #177)
├── ChannelInfoSheet (if open) .status-sheet-overlay (absolute overlay, #365)
├── WorkspacePickerSheet (if open) .status-sheet-overlay (absolute overlay, #383)
├── BackgroundTaskPanel (if open)  .status-sheet-overlay (absolute overlay, interim chrome pending #580, #581)
└── PermissionModal (if any)  .permission-modal-overlay (absolute overlay, last child, null when no outstanding prompt, #224)
```

`MessageBubble`, `Composer`, `UnpairControl`, `StatusRow`, and `RepairControl` are **in-file functions** inside `ConversationScreen.tsx` — they are tiny. `MessageThread`, `StatusSheet`, and `RepairPrompt` are also in-file but **exported** ([#69](../codebase/69.md), [#177](../codebase/177.md), [#167](../codebase/167.md)), so tests server-render them as pure views. `PermissionModal`/`PermissionModalView` live in their own file, `PermissionModal.tsx` ([#224](../codebase/224.md)), the same split one level up. `ConversationScreen` is the store-bound container; `MessageThread`/`StatusSheet`/`RepairPrompt`/`PermissionModalView` are the props-in/markup-out views — the same container/view split `PairingScreen`/`PairingView` uses ([#55](../codebase/55.md)). The load-bearing contracts are the props/types, not the file boundaries (see Seams).

### Data shape (coarse path — retired residue since #179)

The thread's view model is a discriminated union on `type`, following the project's sealed-event convention. It lives in `messageViewModel.ts` (relocated from the deleted `placeholderMessages.ts` in [#69](../codebase/69.md)):

```ts
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }
```

The data source was the [session store](session-store.md), which holds wire `MessagePayload` verbatim (ADR 0004). `ConversationScreen` used to read the messages slice and adapt each payload at the store-read boundary:

```ts
const messages = useSessionStore(selectMessages).map(toMessageViewModel)
```

**[#179](../codebase/179.md) removed this read from `ConversationScreen`** along with the `MessageThread` mount — `Message`/`toMessageViewModel`/`MessageThread`/`MessageBubble`/`selectMessages` are kept as dead-but-tested residue (a later cleanup ticket removes them), but nothing in production reads or renders them anymore. The live thread's data shape is `ThreadItem` (see [Thread timeline](thread-timeline.md)), read via `useTimelineStore(selectItems)` — see [The interactive flip + thread cutover](#the-interactive-flip--thread-cutover-179) below.

`toMessageViewModel` (in `messageViewModel.ts`) is a pure, exhaustive `switch (m.role)`: `role: 'user' → type: 'user'`, `role: 'assistant' → type: 'daemon'`, `message_id → id`, `text` carried through, `conversation_id` dropped; an `assertNever` default makes a future third `WireRole` a compile error. Selecting only the `messages` slice keeps connection-status changes from re-rendering the thread. Each bubble carries `data-message-role={message.type}` — the test hook the structural render test asserts against.

### Layout contract

Independent scroll rests on three rules; get these right and AC1/AC5 follow:

- `index.css` — `html, body, #root { height: 100% }` establishes the full-height chain; `body { margin: 0 }`.
- `.conversation__thread` — `flex: 1 1 auto; min-height: 0; overflow-y: auto`. The **`min-height: 0`** is load-bearing: without it a flex item refuses to shrink below its content, so the whole window scrolls instead of the thread region.
- `.composer` — `flex: 0 0 auto`: pinned, never grows or shrinks.

Bubbles use `max-width: min(680px, 75%)` (not a fixed width) so they reflow as the window resizes — the desktop divergence from the mock's fixed `330px`. Bubble corners are asymmetric via `border-radius` (order **TL TR BR BL**): the user bubble clips its bottom-right, the daemon bubble its bottom-left.

### Theme

Every style references a token from `theme/tokens.css` — no color/type/spacing literal in `conversation.css`. Bare structural geometry (`100%`, flex ratios, the `48px` send button, the bubble measure) stays literal; those are layout, not theme. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

### Back control (#140)

The thread's leading return-to-list affordance, added when the [paired shell](paired-shell.md) gave
the conversation screen somewhere to return *to*. `ConversationScreenProps` gained an **optional**
`onBack?: () => void` — the exact `onUnpaired?` precedent ([#166](../codebase/166.md)): a bare
`<ConversationScreen />` with no `onBack` renders identically to before this ticket (AC3), since the
in-file `BackControl({ onBack })` returns `null` when the prop is absent. When present, it renders a
48px icon-only `<button aria-label="Back">` holding a 24px inline `arrow_back` SVG glyph
(Figma node 16-11, `on-surface`) as the **first child** of `.conversation`, ahead of `UnpairControl`'s
header row. The [paired shell](paired-shell.md)'s `PairedShellView` wires it to a nav dispatch
(`{ type: 'back' }`) that unmounts this thread. Before [#670](../codebase/670.md) that also remounted
the list screen (`list`/`thread` were mutually exclusive); since #670 the sidebar list is permanently
mounted alongside the thread, so `back` now only empties the chat pane — "deselect," not "navigate away."
The back arrow and the unpair header are two separate rows for now — a deliberate interim; a future
top-app-bar ticket consolidates back + title + overflow + unpair into the one bar Figma 16-9 shows.

### Unpair control (#166)

The escape hatch off a stale/dead conversation screen (no in-app way back to pairing existed
before #120's split). A `.conversation__header` row above the thread, right-aligned, holding
`UnpairControl` — a screen-local `useState<'idle' | 'confirming' | 'unpairing'>` phase machine:
`idle` shows an `Unpair` trigger; `confirming` shows `Forget this pairing?` + `Cancel`/`Confirm`
(the AC3 accidental-unpair guard); `unpairing` disables both buttons while the request is in
flight.

`ConversationScreen` takes an **optional** `onUnpaired?: () => void` prop — mirroring
`PairingScreen`'s `onPaired?`/`onCancel?` — so the existing bare `<ConversationScreen />`
server-render tests stay green. Confirm calls the pure `runUnpair` helper
(`unpairAction.ts`, the `composerSend.ts` precedent: injected effects, spy-tested, no React) which
invokes `window.pyry.unpair()` — the [unpair channel](unpair-channel.md) (#173) bridge — and
either dispatches `{ type: 'reset' }` into the [session store](session-store.md) then calls
`onUnpaired` (on `ok`), or dispatches `{ type: 'failed', error: { code: 'unpair', ... } }` and
stays put (on `error` or a rejected invoke). `window.pyry.unpair` is dereferenced only inside the
click handler, never during render, so the server-rendered smoke test never touches the preload
bridge. Styled with existing tokens only — no new `--color-error` (desktop has none; the mobile
`#BA1A1A` destructive color is deliberately not carried over for this minimal control). See
[#166 codebase notes](../codebase/166.md) for the full design and the [App shell](app-shell.md)
for the route-flip half.

### Re-pair control (#167)

The **proactive** twin of the unpair control above: instead of requiring the user to notice the
header's manual `Unpair`, the screen surfaces a `Re-pair` button beneath the composer the moment
the stored pairing can no longer be used — a terminal transport/handshake failure or a
non-retryable daemon rejection. Closes the live incident (2026-07-07, #120) where a dead
connection left the user staring at a disabled composer with no recovery.

Gating is a single pure predicate, `shouldOfferRepair(status: ConnectionStatus): boolean` in
`composerSend.ts` beside `composerAvailability` (see [Composer send](composer-send.md)):

```ts
status.type === 'error' && !status.error.retryable && status.error.code !== 'unpair'
```

`!retryable` admits a terminal transport/handshake failure (`daemonConnection.ts`'s `emitFailed`
always reports `retryable: false`) and excludes a **retryable** daemon wire-error
(`server.binary_offline`, `rate_limited` — transient, not a broken pairing). `code !== 'unpair'`
excludes the self-inflicted `UNPAIR_FAILED_ERROR` `runUnpair` itself dispatches on a failed clear —
without it, a failed re-pair would immediately re-satisfy the predicate and re-offer itself in a
loop. A transient transport drop never reaches `error` at all (the relay supervisor absorbs and
re-dials), so it never reaches this predicate either.

The affordance is split along the file's pure-view/store-bound-container seam:

- **`RepairPrompt({ status, onRepair })`** — exported pure view; returns `null` unless
  `shouldOfferRepair(status)`, else a single `Re-pair` text button reusing the
  `.conversation__unpair` de-emphasized treatment. `status` is a **prop**, not a store read, because
  the populated true-branch isn't reachable under `renderToStaticMarkup` (zustand v5's
  server-snapshot gotcha — see [#69 codebase notes](../codebase/69.md)); tests server-render this
  view directly with an arbitrary status to prove the true/false matrix.
- **`RepairControl({ onUnpaired })`** — in-file container, mounted right after `<Composer />`.
  Selects `status`/`dispatch` from the [session store](session-store.md) independently of
  `ConversationScreen` (which selects only `messages`), so a status change re-renders `Composer` and
  this control only, never the thread. `handleRepair` fires the **same** `runUnpair` wiring
  `UnpairControl` uses (`window.pyry.unpair` → `dispatch({ reset })` → `onUnpaired`) — no second
  clear path.

Unlike `UnpairControl`, there is **no confirm phase and no busy guard** — the button only ever
appears in an already-terminal error, so a confirm step is pure friction, and the affordance
self-hides on both outcomes (`ok` → store resets to `disconnected`, route unmounts the screen;
`error` → store lands on `code: 'unpair'`, which the predicate excludes). `runUnpair` never
rejects, so `handleRepair` fires it as a bare `void` with no `.then`. See
[#167 codebase notes](../codebase/167.md) for the full design, patterns, and code-review NITs.

### Connection banner (#279)

A third, independent read of the same `ConnectionStatus` slice `composerAvailability` and
`shouldOfferRepair` already read (see [Composer send](composer-send.md)) — prominent and
disconnected-only, distinct from both the composer's terse inline gate and the separate, always-on #149
two-dot Relay/Pyrycode indicator (not built here). Closes the gap where the thread gave no prominent
disconnected signal, only the composer's muted caption.

Split from #148 alongside #276/#277/#278; no Figma frame exists (the mobile file draws only the
connected thread), so the copy and accent are design-doc-sourced defaults, mirroring
[#277](../codebase/277.md)'s "no Figma frame" justification shape.

Mirrors the [Re-pair control](#re-pair-control-167) split exactly:

- **`shouldShowBanner(status: ConnectionStatus): boolean`** — in `composerSend.ts`, beside
  `composerAvailability`/`shouldOfferRepair`: `status.type !== 'connected'`. True for
  `disconnected`/`connecting`/`error`; false only for `connected`. Unlike `composerAvailability`, this
  is **not** an exhaustive per-arm switch — every non-connected arm maps to the same behavior (show the
  banner), so "show unless connected" is the honest shape, and a hypothetical future 5th
  `ConnectionStatus` arm defaults to *showing* the banner rather than silently hiding it.
- **`CONNECTION_BANNER_COPY`** — also in `composerSend.ts`: a single client-owned string constant
  (`'Cannot reach pyrybox — your messages will not send until the connection is back.'`), lexically
  distinct from the three `composerAvailability` hints (`Connecting…` / `Not connected` / `Connection
  error`) so the prominent banner and the terse composer gate never read as the same string stacked
  twice. One constant, not a per-arm map — a second three-way copy split would be the duplication this
  ticket's AC5 warns against; the composer already carries the per-arm nuance.
- **`ConnectionBanner({ status })`** — exported pure view in `ConversationScreen.tsx`. Returns `null`
  unless `shouldShowBanner(status)`, else a single `role="status"` `<p className="conversation__banner">`
  holding only `CONNECTION_BANNER_COPY` — nothing derived from `status`, so no daemon-supplied string
  (`ConnectionError.message`) can ever reach it, a structural guarantee (the `EMPTY_THREAD_COPY`/
  `ThinkingIndicator` idiom) rather than a convention. `status` is a **prop**, so the shown/hidden matrix
  server-renders directly, unlike `RepairPrompt`'s populated branch (which needs an `error` status not
  reachable from the store's server-snapshot).
- **`ConnectionBannerControl()`** — in-file, unexported container: `useSessionStore(selectStatus)` then
  `<ConnectionBanner status={status} />`. Selecting only `status` re-renders it exactly on a connection
  transition, never on a timeline delta — the same narrow-slice seam the composer gate and
  `RepairControl` already use.

Mounted between `<UnpairControl />` and `<Timeline />` — below the header row, above the message list,
"the top of the thread." Styled `.conversation__banner` (`conversation.css`), token-only, following the
`.modal-rejection` (#249) error-accent idiom: `--color-error` left border over
`--color-surface-container-high`, sized to body-medium — a step up in prominence from
`.composer__hint`'s muted body-small caption — `flex: 0 0 auto` so it pushes the thread down rather than
overlaying it, never growing or shrinking.

Not security-sensitive: a pure renderer read of already-store-held status, no transport/crypto/socket
code touched. See [#279 codebase notes](../codebase/279.md) for the full design, the code-review record,
and the apostrophe-escaping test lesson.

### Two-dot Relay/Pyrycode connection-status indicator (#330)

The final slice of the two-dot connection indicator, split from [#149](../codebase/149.md):
[#328](../codebase/328.md) (relay-leg transport) → [#329](../codebase/329.md) (renderer [relay-link
store](relay-link-store.md)) → this ticket (render). Two independently-read legs — the relay-socket
leg from `relayLinkStore` and the daemon-session leg from [session store](session-store.md)'s
`ConnectionStatus` — render as two labelled, colour-coded dots inside `StatusRow`'s
`.status-row__summary` slot (Figma node `16-58`), mirroring mobile's `ConnectionStatusLine`
(mobile #397/#398, not itself drawn in the locked Figma file). Complements the disconnected-only
[Connection banner](#connection-banner-279) — the banner announces failure, this is the persistent
at-a-glance state.

Two exported pure mapping functions turn each leg's raw status into a `{ category, label }` pair —
`category: 'up' | 'in-progress' | 'down' | 'unknown'` (the fourth member added by
[#719](../codebase/719.md)) drives the dot's colour class; `label` is the full visible status word,
baked in so the pure view stays dumb (a coloured dot + its label, nothing else) and status is
legible without colour perception:

```ts
export function relayLeg(status: RelayLinkStatus | null): ConnectionLeg
export function daemonLeg(status: ConnectionStatus): ConnectionLeg
```

| `relayLeg(status)` | category | label |
| --- | --- | --- |
| `'connected'` | up | `Relay Connected` |
| `'daemon-absent'` | up | `Relay Reachable` — distinct label; a missing daemon behind a reachable relay is the **daemon leg's** story, not a relay failure |
| `'offline'` | down | `Relay Offline` |
| `null` | unknown | `Relay Unknown` — no status has arrived yet, distinct from `'offline'` since [#719](../codebase/719.md) (was `down`/`Relay Offline` under #330's original mapping) |

`daemonLeg` never produces `unknown`: `ConnectionStatus` starts at `disconnected` and has no null,
so the host leg has nothing to be not-yet-known about — the fourth category is the relay leg's
alone.

| `daemonLeg(status.type)` | category | label |
| --- | --- | --- |
| `connected` | up | `Pyrycode Connected` |
| `connecting` | in-progress | `Pyrycode Connecting` |
| `disconnected` | down | `Pyrycode Offline` |
| `error` | down | `Pyrycode Offline` — `ConnectionError.message` never reaches this indicator, the banner (#279) owns error text |

Both functions `switch` with an explicit `ConnectionLeg` return type and **no `default`** — the
standing desktop exhaustive-switch guard (TS2366), so a future `RelayLinkStatus`/`ConnectionStatus`
member fails the build here. **Neither leg's category ever references the other** — this is
structural, not a convention: after a fatal session close (`4401`/`4421`/`4426`) the relay leg is
left at its last value (typically `connected`) by design (#328's forward decision), so relay = up
while daemon = down is a legitimate, intended render, not a bug the mapping functions reconcile. A
retryable `daemon-absent` (4404) close similarly leaves the daemon leg at `connecting` (in-progress,
never down) while the relay leg reads up/"Reachable" — both legs are honest about their own hop only.

`ConnectionStatusIndicator({ relay, daemon })` is the exported pure view: a
`<span className="status-row__connection" role="group" aria-label="Connection status">` holding one
`.conn-leg` per leg (relay first, then daemon), each a `.conn-dot--{category}` (`aria-hidden`,
decorative — colour is redundant with the label) plus a `.conn-leg__label` span. A static
`role="group"`, not a live region — the banner (#279) already announces disconnect transitions, so a
second live region here would double-announce. `ConnectionStatusIndicatorControl`, the in-file
container, reads `useRelayLinkStore(selectRelayLinkStatus)` and `useSessionStore(selectStatus)` (the
`QueuedBacklogControl` two-independent-store precedent — re-anchored here by [#618](../codebase/618.md)
after the original, `ScreenSnapshotControl`, was removed) and passes the mapped legs down; no
`window.pyry`, no IPC, no effects, so the server-rendered smoke test touches no bridge. Initial state
is one Unknown dot and one Offline dot — the relay leg's `null` sentinel reads `unknown`/`Relay
Unknown` since [#719](../codebase/719.md) (previously collapsed into a second `down`/`Relay
Offline`, #330's original choice), while the daemon leg's `disconnected` still reads `down`/`Pyrycode
Offline`.

Mounted inside `StatusRow`'s previously-empty `.status-row__summary` span, now a flex row
(`gap: var(--space-3); min-width: 0`) so the dots and #181/#182's future run-config summary text
("Opus 4.7 · high · 73% used") can sit side by side — this slice does not claim the slot
exclusively. New theme token `--color-warning: #ffca45` (`tokens.css`, after `--color-error`) drives
the in-progress dot — M3 has no warning role and the design-system file has no such variable (the
two-dot line post-dates the 2026-05-08 Figma lock, a code-era addition like the dots themselves).
[#719](../codebase/719.md)'s `unknown` category reuses the existing `--color-outline` token (no new
token added) — the same achromatic fill already used for the `.run-config__switch-knob`/
`.settings__switch-knob` off-state chips, chosen because it is the only achromatic option among the
four categories and carries no success/failure valence. `.conn-dot` is an 8px circle (structural
component geometry, the `.run-config__context-bar` precedent, not a spacing token); `.conn-leg__label`
is `body-small` on `--color-on-surface-variant`, `white-space: nowrap`.

**Screen-reader note (accepted, not a gap):** the indicator sits inside `StatusRow`, a `<button
aria-label="Run configuration">` — the button's `aria-label` overrides its inner text as the
accessible *name*, so the connection labels are visible content but not announced as part of the
button's name. This satisfies AC2 (colour-independence via visible text) and matches Figma's summary
placement inside the row button; a dedicated live-region announcement was left out of scope, since
the banner (#279) already announces the disconnect transition.

Not security-sensitive: pure presentation over already-classified, content-free store state (#328's
guarantee) — no transport, crypto, or socket code touched. See [#330 codebase
notes](../codebase/330.md) for the full design, the leg → category → label matrix tests, and the
code-review record.

**Second consumer since [#718](../codebase/718.md).** `relayLeg`/`daemonLeg`/`ConnectionLeg` are now
also imported into `channels/ChannelList.tsx`, whose `HostConnectionDots` renders the same two legs
as a label-less dot pair on the sidebar's host row (host leg first, the reverse of this section's
`ConnectionStatusIndicator(relay, daemon)` order). The TS mapping has one copy, imported across
screens; the CSS category → colour binding (`.conn-dot--up/--in-progress/--down/--unknown`, just
above, four rules since [#719](../codebase/719.md)) also has one copy, worn by the sidebar dot
without the `.conn-dot` 8px base it sits beside here — so removing this indicator would need to
relocate those four rules rather than deleting them. See the [Channel List home
screen](channel-list.md) doc and [#718 codebase notes](../codebase/718.md).

### Workspace chip (#278)

A pre-first-message pill at the top of the empty new-discussion thread, showing the workspace `cwd`
the discussion will run in before the user sends the first message, with a "change" affordance
reserved for the not-yet-built [#157](https://github.com/pyrycode/pyrycode-desktop/issues/157)
Workspace Picker sheet. Split from #148 alongside #276/#277/#279; no Figma frame exists (the mobile
file draws only the populated thread), so the design is sourced from the locked mobile design doc
(a Material 3 pill, "Workspace: … (change)", pre-first-message only; mobile #137) rather than a node.

A new discussion is an unpromoted conversation created via the [new-discussion
FAB](new-discussion-fab.md) (#242): the renderer fires `createConversation` and the daemon replies
with `conversationCreated` carrying the chosen `cwd`. That reply already reached [`PairedShell`'s nav
callback](paired-shell.md) — which dropped the payload after triggering the `open` transition. This
ticket is the first consumer of that payload beyond navigation.

**`activeConversationStore.ts` (new)** — a dedicated Zustand store, the `sessionIdStore` /
`conversationListStore` DI-factory → singleton → hook → selector shape, holding
`ConversationCreatedPayload | null` (`null` = "no conversation created/opened this session yet") **verbatim**
— snake_case, no camelCase remap, the `conversationListStore` doctrine — so the chip derives `cwd` and
`is_promoted` at the read boundary rather than the store drifting from the wire shape. `setActiveConversation`,
unconditional whole-value replace (most-recent-wins, no merge). [PairedShell's
`conversation_created` callback](paired-shell.md#the-pure-view--container-pairedshelltsx) is the sole
writer; `WorkspaceChip` (below) is the sole reader — no other consumer exists yet.

[#529](../codebase/529.md) added a second mutation, `clearActiveConversation`, returning the state to
the exported `initialActiveConversationState` constant — for when the conversation context that scoped
the payload ends. Named setters rather than a reducer: the two mutations are independent whole-value
writes, neither reading prior state nor constraining the other's ordering. Shipped with **no production
caller**. `PairedShell.tsx`'s `setActiveConversation` call site was the obvious-looking place to wire a
clear from, and [#530](../codebase/530.md) (navigation, shipped) did touch exactly that call site — but
deliberately did **not** call `clearActiveConversation` there: `setActiveConversation` stays
unconditional (a conversation switch still *records* the new conversation, it just also clears the
timeline and session id first via the new `activateConversation` helper — see [Paired
shell](paired-shell.md#the-pure-view--container-pairedshelltsx)). [#531](../codebase/531.md) (unpair /
pair-another-server, shipped) is `clearActiveConversation`'s sole caller, wired unconditionally into
[`clearPairingScopedState`](paired-shell.md#the-pure-view--container-pairedshelltsx) — the pairing
context itself ending, rather than the active conversation merely changing, is exactly the case that
call site was reserved for.

Rejected alternative: correlating `sessionIdStore`'s session id against a `conversationListStore` row.
There is no join key — `sessionIdStore` holds a daemon *session* routing id from `sessionTransition`,
`ConversationSummary` is keyed by conversation `id`, and the two are orthogonal ids; a lookup by the
synthetic `MILESTONE_CONVERSATION_ID` send-id would usually miss the daemon's real `conversations` list
too. The `conversationCreated` payload already in hand from the create round-trip is the narrow, correct
source — "the workspace this discussion will run in" is exactly what it carries.

**`WorkspaceChip` (`ConversationScreen.tsx`)** — the exact `ThinkingIndicator` idiom: the container
derives a value and passes it down, the pure exported view self-gates to `null`, no store read inside
the view. Mounted as a **sibling above `Timeline`**, below `ConnectionBannerControl`:

```tsx
<ConnectionBannerControl />
<WorkspaceChip conversation={activeConversation} isEmpty={items.length === 0} />
<Timeline items={items} />
```

```ts
export function WorkspaceChip({
  conversation,   // ConversationCreatedPayload | null — activeConversationStore's held value
  isEmpty,        // items.length === 0 — the pre-first-message window
  onChange        // optional () => void — the #157 seam; absent here
}: WorkspaceChipProps): JSX.Element | null {
  if (!isEmpty || conversation === null || conversation.is_promoted) return null
  // … renders a pill: WORKSPACE_CHIP_LABEL, conversation.cwd, and a Change button
}
```

**Gate:** `isEmpty && conversation != null && !conversation.is_promoted`. `is_promoted === false` is
the wire signal for a *discussion* (vs. a channel) — this is what makes the chip a new-discussion,
pre-first-message affordance only (AC1/AC3): once the first message lands, `items.length` flips
non-zero and the chip disappears; a promoted conversation never shows it at all.

**`cwd` is rendered whole and opaque** (AC2): plain React children (auto-escaped), never
`dangerouslySetInnerHTML`, and never split/basenamed/otherwise interpreted as a filesystem path (a
`cwd.split('/').pop()` would itself be "interpreting it as a path" — the toolCall/sessionBoundary
untrusted-string posture already in this file). An HTML-ish `cwd` (`<b>hi</b>`) renders as escaped text
(`&lt;b&gt;hi&lt;/b&gt;`), never markup. The client-owned `WORKSPACE_CHIP_LABEL = 'Workspace'` constant
is the `EMPTY_THREAD_COPY` idiom — apostrophe-free (`renderToStaticMarkup` escapes `'` → `&#x27;`) and
never a daemon string, so the label itself carries no untrusted content.

**"Change" affordance (AC4):** a `<button disabled={!onChange} onClick={onChange}>`. This ticket's
container passes no `onChange`, so the button ships visibly `disabled` — an honest placeholder, not a
silently-missing feature. #157 lands as a pure additive: pass an `onChange` that opens the Workspace
Picker sheet (Figma node 20-2) and the button un-disables, with no other change to this view — the same
optional-prop extension seam #276 originally reserved for #155's `onChannelInfo?` — [#365](../codebase/365.md)
later retired that speculative prop in favor of `ConversationScreen` owning the Channel Info sheet's
open-state itself (see [Channel Info sheet](#channel-info-sheet-365) below), so `onChange?` here was, for
a time, the pattern's only live instance. **[#383](../codebase/383.md) bound it:** `ConversationScreen`
passes `onChange={() => setPickerOpen(true)}` (a `pickerOpen` `useState` twin of `channelInfoOpen`), which
un-disables the button — no other change to this view. See [Workspace Picker
sheet](#workspace-picker-sheet-383) below.

**Why a sibling, not nested inside `EmptyThread`.** #277's `.conversation__empty` surface pins the chip
"to the top of this surface" per its own CSS comment, but `WorkspaceChip` does **not** thread
`conversation`/`onChange` through `Timeline` → `EmptyThread` — that would widen `Timeline`'s
`{ items, now }` contract for an orthogonal concern and cascade its many bare-render test call sites. A
sibling `flex: 0 0 auto` chip above `Timeline` yields the identical visual result (pill on top, empty
surface filling below) with `Timeline`'s contract untouched and zero edits to its existing tests.

Styled `.conversation__workspace-chip*` (`conversation.css`) — token-only, no new token: `--radius-full`
for the Material 3 pill shape (`.tool-row__chip`'s corner at the time, `--radius-sm`, made fully round —
#722 later moved the tool-row chip on to `--radius-xs` for the desktop redraw, so the precedent is
historical rather than a live cross-reference), `--color-surface-container-high` fill +
`--color-outline-variant` border (the `.conversation__banner` fill), `min-width: 0` +
`text-overflow: ellipsis` on the `cwd` run so an unbounded daemon path can't blow out the layout (the
`.tool-row__summary` treatment, still current).

Not security-sensitive: a pure renderer read of an already-decoded store value, rendered on React's
default-safe escaped path — no transport/crypto/socket surface touched. See [#278 codebase
notes](../codebase/278.md) for the full design and patterns established.

### Workspace Picker sheet (#383)

The UI slice of #157 (Figma node 20-2): a bottom sheet, opened from the `WorkspaceChip`'s "Change"
button, that lists the [recent-workspaces store](recent-workspaces-store.md) (#382), marks the row
matching the active conversation's current `cwd`, and dispatches the existing [`changeWorkspace`
command](conversation-workspace-change.md) (#379) on selection. Everything it consumes — the store +
its dormant data-path bridge (#382), the command (#379), `formatLastActivity` (#141), and the
`.status-sheet__*` chrome (#177/#365) — was already merged; this ticket adds one new file:
`WorkspacePickerSheet.tsx` (a pure view, a one-line dispatch helper, and an in-file container — the
`ChannelInfoSheetView`/`ChannelInfoSheet` split), plus an ~8-line wiring delta in `ConversationScreen`.
No new command, no new transport plumbing, no store change.

```
.conversation
└── WorkspacePickerSheet                (mounted beside ChannelInfoSheet, when pickerOpen)
    ├── RecentWorkspacesData             (#382's dormant bridge — mounted only while open, so
    │                                     each open fires a fresh one-shot requestRecentWorkspaces)
    └── WorkspacePickerSheetView
        ├── .status-sheet-overlay__scrim         (onClick → onClose)
        └── .status-sheet  role="dialog" aria-labelledby="workspace-picker-sheet-title"
            ├── .status-sheet__handle
            ├── .status-sheet__header             "Choose workspace" + close
            └── .status-sheet__body
                ├── "Recent" section-header
                ├── .workspace-picker__row × N     path (mono) + "Last used …" + "default" pill (if cwd match)
                ├── .workspace-picker__empty        "No recent workspaces" (workspaces === [])
                │                                   — no row, no empty copy at all when workspaces === null
                ├── "Other" section-header
                └── .workspace-picker__other        "Create new folder under <cwd>" (#398) — disabled only
                │                                     with no active conversation
                    └── CreateFolderDialog           (#398, mounted picker-scoped when open)
                        ├── NewFolderData             (#397's dormant bridge — mounted dialog-scoped)
                        └── CreateFolderDialogView    "Create workspace" dialog (Figma 19-44)
```

**Null-vs-empty store (AC1).** `workspaces` (from `useRecentWorkspacesStore(selectRecentWorkspaces)`)
is `null` while the one-shot request is in flight — the section header renders with no rows and no
empty copy — versus a delivered `[]`, which renders the header plus a client-owned
`.workspace-picker__empty` line. The two are structurally distinct output, the #141/#324 null-vs-empty
precedent, and neither branch crashes.

**"default" pill (AC2).** `activeCwd` — `conversation?.cwd ?? null`, sourced from
`activeConversationStore` (#278) — is compared by exact string equality against each row's `path`; a
match renders `.workspace-picker__default-pill` (secondary-container fill, Figma 20:36). `activeCwd
=== null` (a list-opened thread never populates `activeConversationStore`) marks no row — the same
graceful-empty posture the [Channel Info sheet](#channel-info-sheet-365) established for the same
store.

**Choose → dispatch → close (AC3).** Each row is `disabled={!onChoose}`; the container supplies
`onChoose` only when `conversation !== null`, so a list-opened thread's rows render inert — the
`WorkspaceChip` disabled-until-wired idiom, reused for the same reason (no `conversation_id` to
dispatch with). When wired, choosing a row calls the new exported `requestChangeWorkspace(sendCommand,
conversationId, path)` — an inline `{ type: 'changeWorkspace', payload: { conversation_id: cwd }
}` literal (the `requestArchiveConversation` clone), mapping the row's `path` into the wire's `cwd`
field — then `onClose()`. Fire-and-forget, no optimistic update: the conversation **list** picks up the
new workspace only once the daemon's existing `conversation_updated` reply re-triggers the #275 re-list
(see [Conversation workspace change](conversation-workspace-change.md)). The active-conversation chip
itself does not live-update on that reply (`activeConversationStore` is written only on
`conversation_created`) — reopening the picker right after a change still marks the *old* `cwd` until
the next create, a pre-existing #278 limitation, not fixed here.

**"Other" entry — create-folder dialog (#398).** The create-folder row is `disabled={!onCreateFolder}`;
the container now supplies `onCreateFolder` whenever `conversation !== null` (the same gating as
`onChoose` — the dialog needs the `conversation_id` its switch reflects onto), opening a new
`CreateFolderDialog` mounted picker-scoped. The label is now parent-specific — `` `Create new folder
under ${activeCwd}` `` — falling back to the generic `'Create new folder…'` only when there is no active
conversation to derive a parent from. The dialog is a near-clone of `RenameConversationDialog.tsx`
(Figma 19-44: "Create workspace" title, "What should this workspace be called?" field, Cancel/Create
actions), drives the [create-folder round-trip store](new-folder-store.md) (#397) — mounting its
previously-dormant `NewFolderData` bridge dialog-scoped so the daemon reply actually resolves — and on
the `created` outcome switches the conversation to the daemon's **returned** path verbatim via
`requestChangeWorkspace` (never a client-reconstructed path — the #288 EvalSymlinks lesson), then closes
both the dialog and the picker (`onCreated` is the picker's own `onClose`). A `rejected` outcome shows a
generic, apostrophe-free failure line and stays open for retry. See [#398 codebase
notes](../codebase/398.md) for the full implementation and lessons learned.

**Untrusted strings.** `path` renders as auto-escaped React children, never
`dangerouslySetInnerHTML`, never split/basenamed/otherwise resolved as a filesystem path — the
`WorkspaceChip`/`RecentWorkspace` posture carried forward. `last_used_at` is fed only to
`formatLastActivity`, which degrades an unparseable value to `''` (the `|| '—'` fallback) and never
throws.

Two glyphs (`FolderIcon`/`FolderPlusIcon`) are inline `currentColor` Material SVGs, not the Figma's
asset images or accent colors — the app's standing "no asset fetch, no hardcoded illustration hex"
posture, flagged as a non-gating NIT in code review for designer awareness. Styled entirely with
`.workspace-picker__*` classes in `conversation.css` — token-only, no new CSS token (the pill reuses
`--color-secondary-container`/`--color-on-secondary-container`, already introduced by earlier tickets).

Not security-sensitive: a pure renderer read of two already-decoded stores plus a dispatch of an
already-guarded command; no transport/crypto/socket surface touched. Code review PASS, two non-gating
NITs (glyph coloring, the deferred create-folder label). See [#383 codebase
notes](../codebase/383.md) for the full design and patterns established.

### Background-task panel (#581, cap and cut display since #582, latest patch since #583)

An openable surface listing the tasks claude has running in the background for the open conversation
— the first reader of [`backgroundTaskRosterStore`](background-task-roster-store.md), shipped and
unread since #573. The store joins three daemon frames (roster, started, updated); this slice reads
only two of the held per-task fields, `description` and `taskType`. Split from #568 (whose panel work
was itself split three ways: #581 → #582 → #583). No Figma node exists for this surface — it is
desktop-only (pyrycode#1241) and the canonical mobile file has no counterpart; visual design is #580's,
so the chrome deliberately reuses the shared `.status-sheet__*` overlay vocabulary as an interim
placeholder rather than anything #580 would have to unwind.

```
.conversation
├── BackgroundTaskTrigger              .background-task-trigger (StatusRow sibling, always rendered)
└── BackgroundTaskPanel (if panelOpen)
    └── BackgroundTaskPanelView
        ├── .status-sheet-overlay__scrim        (onClick → onClose)
        └── .status-sheet  role="dialog" aria-labelledby="background-task-panel-title"
            ├── .status-sheet__handle
            ├── .status-sheet__header             "Background tasks" + close
            └── .status-sheet__body
                ├── entry.droppedTasks > 0    → .background-task-panel__partial     "Partial list (N not shown)"
                │                                 (sibling of the branch below, not nested in any arm — #582)
                └── entry === null            → .background-task-panel__unobserved  "No background-task report yet"
                  · entry.tasks.size === 0    → .background-task-panel__empty       "No background tasks"
                  · otherwise                 → .background-task-panel__list > .background-task-panel__row × N
                                                  (description + taskType, roster order, each field followed
                                                  by .background-task-panel__cut-description / -cut-type
                                                  "Truncated by the daemon" when truncatedFields names it — #582;
                                                  then task.latestUpdate !== null            → one of:
                                                    patch === ''  → .background-task-panel__no-change  "No change reported"
                                                    patch !== ''  → .background-task-panel__patch       <patch text, escaped>
                                                  followed by .background-task-panel__cut-patch "Truncated by the daemon"
                                                  when update.truncatedFields (not task.truncatedFields) names "patch" — #583)
```

**No bridge mount.** Unlike `WorkspacePickerSheet` (which mounts `RecentWorkspacesData` inside itself),
`<BackgroundTaskRosterData />` is already the seventh headless leaf in `App.tsx` — this panel is a pure
reader, and mounting a second data path here would be a second, wrong write path.

**The three-way branch is the ticket's hardest AC**, and is deliberately written on two different
things in this order: `entry === null` (no background-task frame has ever arrived) before
`entry.tasks.size === 0` (observed — nothing alive), before the populated row list. Reaching for
`entry?.tasks` (via `.values()`, `.size ?? 0`, or `?? new Map()`) before branching collapses the first
two readings into one — compiles clean, breaks no other test — which is exactly the collapse
`selectRosterFor`'s `?? null` return refuses to make. Each reading is its **own element with its own
class and copy**, not a shared "empty" element and not `null`: unlike `WorkspacePickerSheetView`'s
not-loaded branch (which renders `null`, since that sheet has other content), this branch *is* the
whole panel body, so a `null` render would read as broken.

**The container** (`BackgroundTaskPanel`) clones `QueuedBacklogControl`'s conversation-id idiom:
`activeConversation?.id ?? null` derived inline at the `ConversationScreen` mount site (no second
subscription), a `useMemo`-stable `selectRosterFor(conversationId ?? '')` selector, and
`useBackgroundTaskRosterStore(selectRoster)`. The `''` sentinel matches no store key, so "no active
conversation" reads as `null` — the correct "never observed" reading — for free. An Escape `keydown`
effect closes the panel; open/closed state is a fourth screen-local `useState` boolean in
`ConversationScreen` (the `pickerOpen`/`channelInfoOpen`/`sheetOpen` twin, [ADR
0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)).

**Trigger.** An icon-only `.background-task-trigger` button (`aria-label="Background tasks"`,
`aria-haspopup="dialog"`), mounted unconditionally as a `StatusRow` sibling — not gated on tasks
existing, since gating would make both non-populated readings unreachable through the UI. Chosen over
the overflow menu (hardcoded to one item; routing through it means generalising the menu) and
`WorkspaceChip`'s "Change" button (self-gates to `null` once the thread has a message — exactly when
background tasks exist). Carries no task-count badge; a badge would need its own roster subscription,
left to #580.

**SECURITY.** For `taskType: local_bash`, `description` is the literal shell command claude ran —
untrusted, model-influenced text the daemon bounds but does not sanitize. Rendered as auto-escaped
React children only: never `dangerouslySetInnerHTML`, never an attribute (not even `title=`), never a
key, never executed or re-shelled. Rows are deliberately non-interactive (no `<button>`, no `onClick`)
so there is no handler for a future "run this" affordance to grow from. The list itself is not treated
as a work list: `entry.tasks.values()` is spread once, inline, into `<li>` children — no join, no
clipboard, no export, no `data-*` attribute carrying a task field. Architect self-review PASS (security-
sensitive label); code review PASS with zero findings.

**Cap and cut display (#582).** Two independent bounds the daemon reports and now displays: a
**partial-list notice** (`.background-task-panel__partial`, `` `Partial list (${entry.droppedTasks} not
shown)` ``) whenever the entry reports a nonzero `droppedTasks`, and a **per-field cut marker**
(`.background-task-panel__cut-description` / `-cut-type`, both reading `Truncated by the daemon`)
immediately after any field a task's `truncatedFields` names. The notice is a sibling of the three-way
branch above, not nested in any of its arms, so it shows whichever branch the task list itself takes —
the placement is the acceptance criterion, since the count belongs to the entry, not to the list. The
marker match is the ticket's central trap: `truncatedFields`' contents cross IPC unconverted, so the
panel holds `task.taskType` but must match the wire string `task_type`, not the held name. Neither
reading is styled as an error — a bounded report is the daemon working as designed, reported honestly.
Architect self-review PASS (security-sensitive label); code review PASS with zero findings. See [#582
codebase notes](../codebase/582.md).

**Latest patch (#583).** The held `latestUpdate: HeldBackgroundTaskUpdate | null` pair — the last field
of `entry` the panel had left unread — now renders as the third element of each row, appended after the
description and task-type fields and their own markers. Three readings, each rendered distinctly:
`latestUpdate === null` (no update has ever matched this task) renders **no element at all**;
`latestUpdate.patch === ''` (claude reported no change — the field always arrives on the wire, so an
empty string is a value, not an absence) renders `.background-task-panel__no-change`, "No change
reported"; a non-empty patch renders `.background-task-panel__patch` holding the patch as **inert,
auto-escaped text** — never parsed, since the daemon truncates it at construction and its own golden
fixture is cut mid-token, so a truncated patch no longer parses. The branch is on `latestUpdate !== null`
then `patch === ''`, never on the patch's truthiness — `{latestUpdate?.patch && …}` would render a
recorded empty patch exactly as the never-updated reading, #582's `droppedTasks` truthiness trap one
field over, quieter still because an empty string leaves no visible trace.

The update's own cut marker (`.background-task-panel__cut-patch`, "Truncated by the daemon") is a
sibling of the two-arm ternary, gated on the same `latestUpdate !== null` guard, and reads **only**
`latestUpdate.truncatedFields` — a second list, over a different vocabulary (`task_id` / `patch`) from
the task's own `truncatedFields` (`task_id` / `task_type` / `description`), matched against a third
`CUT_FIELD_PATCH` constant. Reading the task's list for the patch marker, or the update's list for the
description/task-type markers, compiles and type-checks (both are `readonly string[] | null`) and never
matches — the crossover both directions guard against. Neither list ever reaches the markup; names are
matched, never displayed. No history: `latestUpdate` is latest-wins, one record per task — the panel
does not accumulate patches into a list, a ref, or component state. Nothing here is read as a terminal
signal: this frame family reports no finish event by design, so a task simply stops appearing in the
roster rather than being shown as done, and no copy or class in this slice names completion, failure, or
success. No prop, type, store, bridge or wire change; same `entry` prop #581 shipped. Architect
self-review PASS (security-sensitive label); code review PASS with two non-blocking SHOULD FIX
(both test-coverage gaps, not production defects — see [#583 codebase notes](../codebase/583.md)).

See [#581 codebase notes](../codebase/581.md) for the shell's full design, test posture, and
code-review record.

### Run configuration sheet (#177)

The host modal for the session's Model / Effort / YOLO controls, context-window state, and
Log-data download — each section is a follow-up ticket (#181 — since split into #187/#188, #182,
#72) that owns both its header and its content. This ticket ships only the chrome: the trigger and
the empty, dismissible sheet.

`StatusRow` is a full-width icon-only `<button aria-label="Run configuration" aria-haspopup="dialog">`
between `MessageThread` and `Composer` (Figma node `16-57`), with a top border separating it from
the thread. Its left summary region (`model · effort · context%`) was originally intentionally empty —
that live text is the collapsed mirror of the sheet's read sections, owned by #188/#182, not this shell.
[#330](../codebase/330.md) turned `.status-row__summary` into a flex row and mounted the two-dot
connection indicator as its first child (see [Two-dot Relay/Pyrycode connection-status
indicator](#two-dot-relaypyrycode-connection-status-indicator-330) below); the `model · effort ·
context%` text itself is still unbuilt and, per #330's design, lands as a **sibling** beside the dots,
not a replacement of them.
Clicking it calls `onExpand`, which flips `sheetOpen` (a single `useState(false)` in
`ConversationScreen` — the "trivial single-value local UI state" case carved out by
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md), not its `useReducer`
phase-machine case). It resets to closed on remount for free — a guarantee [#670](../codebase/670.md)
had to restore explicitly via `ConversationScreen`'s `key` once a sidebar-driven conversation switch
could otherwise leave the route on `thread` with no remount at all; see [the paired shell's `paneKey`
fix](paired-shell.md#the-conversation-switch-remount-bug-and-the-panekey-fix).

`StatusSheet` (Figma node `20-100`) renders as the screen's last child when `sheetOpen` is true:

```
.status-sheet-overlay          absolute, inset: 0, flex column, justify-content: flex-end
├── .status-sheet-overlay__scrim   absolute, inset: 0, --color-scrim @ opacity 0.4, onClick=onClose
└── .status-sheet                 role="dialog" aria-modal="true" aria-labelledby=<title id>
    ├── .status-sheet__handle       32×4 decorative drag bar, aria-hidden
    ├── .status-sheet__header       title (left) + × close control (right, aria-label="Close")
    └── .status-sheet__body         empty, flex:1 1 auto; min-height:0; overflow-y:auto
```

It is an **absolutely-positioned overlay inside `.conversation`** (which gained `position: relative`
for this), not a React portal — no App-level z-index coordination, fully self-contained in the
screen. The scrim is a **separate element**, not the overlay's own background, so the opaque panel
sibling is never dimmed and no bare `rgba()`/`color-mix` literal is needed; it doubles as a
near-free backdrop-click dismissal. The `×` close control is the **authoritative** dismissal path
(clicking it or the scrim both call `onClose`, which flips `sheetOpen` back to `false`); Esc-to-close
was left out (optional per spec, unobservable under the server-render harness).

Two M3 dark-scheme tokens were ported into `tokens.css` ahead of their other consumers (sanctioned
by that file's header comment): `--color-surface-container-low` (the panel fill) and
`--color-scrim` (applied only via `opacity`, never as a raw color-with-alpha literal). Icons are
inline `currentColor` SVGs, the `.composer__send` precedent — no remote asset fetch (CSP blocks it).

Not wired yet at shell-landing time: no live summary text in `StatusRow`, no focus trap/restore on
open-close (accepted for a shell with a single focusable control; worth adding once more than one
section is interactive — see [#177 codebase notes](../codebase/177.md) for the full code-review
record). `StatusRow`'s summary slot gained its first content in [#330](../codebase/330.md) — the
two-dot connection indicator, not the run-config text this paragraph originally meant. The sheet
body itself gained its first section in [#72](#log-data-section-72) below; all
four read-only sections (Model/Effort/YOLO, #188, and Context window, #192) have since landed. See
[#177 codebase notes](../codebase/177.md) for the shell's full design and lessons learned.

A **headless data path** for the Model/Effort/YOLO/Context-window sections landed in
[#187](../codebase/187.md): `<RunConfigData/>`, mounted as the sheet body's first child (ahead of
`<RunConfigSections/>` and `<LogDataSection/>`), requests a fresh `screen_snapshot` on every sheet
open and holds `model`/`effort`/`yolo` (and, since [#192](../codebase/192.md), `usedTokens`/
`windowTokens`) in a dedicated [Run configuration store](run-config-store.md). The Model/Effort/YOLO
render landed in [#188](../codebase/188.md); the Context window render landed in
[#192](../codebase/192.md). See [Run configuration data path](#run-configuration-data-path-187),
[Run configuration Model/Effort/YOLO sections](#run-configuration-modeleffortyolo-sections-188), and
[Run configuration Context window section](#run-configuration-context-window-section-192) below.

### Run configuration data path (#187)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

`RunConfigData` is a headless container (`(): null`) — no markup, no header, no rows; it exists
purely to drive the fetch-and-hold data path the moment the sheet opens, ahead of #188 rendering
anything from it. Because the sheet body is conditionally mounted
(`{sheetOpen && <StatusSheet>…}`), `RunConfigData`'s own mount **is** the sheet's open transition,
so "request once per open" reduces to "request once per mount" — a `useRef(false)` guard makes that
hold even under React StrictMode's dev double-invoke. A second effect subscribes to
`window.pyry.onDaemonEvent` (off-handle cleanup, the `daemonEventBridge` idiom) and writes each
arriving `runConfigReceived` verbatim into the [Run configuration store](run-config-store.md)'s
single setter (originally `snapshotReceived`, moved onto the dedicated reply at #491/#500 — see [Run
configuration store § Moved off screen_snapshot](run-config-store.md#moved-off-screen_snapshot-491500)).
See [Run configuration store](run-config-store.md) for the full data-path design and
[#187 codebase notes](../codebase/187.md) for patterns established.

### Run configuration Model/Effort/YOLO sections (#188)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188)
│   └── RunConfigView                  (pure: three primitive props in, markup out)
│       ├── ModelSection                .status-sheet__section-header "Model" + 3-row radio list
│       ├── EffortSection                .status-sheet__section-header "Effort" + 5-segment control
│       └── YoloSection                  .status-sheet__section-header "YOLO mode" + labelled switch
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The three sections the sheet's Model/Effort/YOLO controls needed, mounted between `RunConfigData`
and `LogDataSection`. `RunConfigView` is the exported pure view — three primitive props
(`model`/`effort`/`yolo`) in, markup out, no store read and no `window.pyry`, so it
server-renders with no mock, the same seam `LogDataView`/`RunConfigData` use. `RunConfigSections` is
the thin exported container: `useRunConfigStore(selectSnapshot)` reads one narrow slice and
coalesces `snapshot ?? { model: '', effort: '', yolo: false }` before handing the triple to
`RunConfigView` — so the store's pre-load `null` and a real all-defaults `screen_snapshot` render
through the identical code path (both are AC4's blessed default: no radio filled, no segment marked,
switch off).

- **Model** — a static catalog (Opus 4.7 / Sonnet 4.6 / Haiku 4.5, each with a one-line descriptor)
  is renderer content from the design, not daemon data; the snapshot's `model` string only selects a
  row via `matchedFamily`, a case-insensitive substring match against each catalog entry's family
  token (`opus`/`sonnet`/`haiku`). That handles both the short alias the wire fixture uses
  (`"opus"`) and a full `claude --model` id (`"claude-opus-4-7"`) with one rule, and degrades to no
  selection for `''` or anything unrecognized. The selected row's radio is `role="img"
  aria-label="Current model"`; the others are `aria-hidden`. [#590](../codebase/590.md) added a
  fourth entry, `Fable 5` / `newest in the Fable family` (family token `fable`), between Sonnet and
  Haiku — the published family the catalog previously made unreachable from the app; matching,
  layout and the read-only render posture above are unchanged, since the row is emitted by the same
  `map` and no vector collides two family tokens.
- **Effort** — five fixed segments (`low`/`medium`/`high`/`xhigh`/`max`) matched by exact equality;
  the current level carries `aria-current="true"`, which is both the accessibility marker and the
  CSS hook (`[aria-current='true']`) for the filled-pill style — no parallel modifier class.
- **YOLO** — a between-justified "Auto-accept tool calls" row with a switch rendered `role="switch"
  aria-checked={yolo} aria-readonly="true"`: honestly read-only (not focusable) until
  [#183](https://github.com/pyrycode/pyrycode-desktop/issues/183) drops `aria-readonly` and wires an
  `onClick`. Figma pins only the off state; the on state (`--color-primary` track, `--color-surface`
  knob) mirrors M3 on-switch semantics with tokens already in the palette — no new token, and
  low-risk since production data is always `yolo: false` until #183 lands the write path.

One more M3 token landed: `--color-surface-container-highest` (the switch's off-track fill; reused by
[#192](../codebase/192.md)'s context-window track below). See [#188 codebase notes](../codebase/188.md)
for the full design and patterns established.

An unconfirmed in-flight change to any of the three ([#558](../codebase/558.md)) no longer renders
identically to a settled one: the owning wrapper (the model list, the effort row, or the switch itself)
carries `aria-busy="true"` plus a dashed `--color-warning` ring/border, sourced from
[#256](../codebase/256.md)'s `selectPendingFields`, clearing through the same reject/confirm/reconnect
paths [Run configuration write store](run-settings-write-store.md) already converges on.

### Run configuration Context window section (#192)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188/#192)
│   └── RunConfigView                  (pure: five primitive props in, markup out)
│       ├── ModelSection
│       ├── EffortSection
│       ├── YoloSection
│       └── ContextWindowSection         .status-sheet__section-header "Context window" + usage gauge
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The fourth and last section of the read-only surface, mounted between `YoloSection` and the sibling
`LogDataSection` per Figma order. Widens the [Run configuration store](run-config-store.md)'s held
`RunConfigSnapshot` (and the `toRunConfigSnapshot` copy) by the two usage figures [#191](../codebase/191.md)
already carries on the transport event (originally `snapshotReceived`, now `runConfigReceived`,
#491/#500) — `usedTokens`/`windowTokens` — and renders them as:

- **Available (`windowTokens > 0`):** a usage line — `` `${pct}% used (${abbreviateTokens(usedTokens)}
  of ${abbreviateTokens(windowTokens)} tokens)` `` — above a `role="progressbar"` track/fill whose fill
  width is set inline per render (`aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-label`
  complete the honest a11y contract). `pct` is `used/window` rounded and clamped to `[0, 100]`, so an
  over-full session reads "100% used" with a full (not overflowing) bar, while the raw abbreviated
  figures stay honest about the overflow (e.g. "210K of 200K tokens").
- **Unavailable (`windowTokens <= 0`):** a single muted "Context usage unavailable" line in place of
  the usage line and bar — no progressbar role, no division ever runs.

The container's null-default gained `usedTokens: 0, windowTokens: 0` — the same move [#188](../codebase/188.md)
made for `model`/`effort`/`yolo`, one step further: **the not-yet-loaded default and the daemon's
`window_tokens == 0` "usage unavailable" signal collapse into the identical `windowTokens > 0` branch**,
so there is exactly one guard, not two, and the division genuinely never executes on either falsy
path (AC5 — no NaN, no Infinity, no divide-by-zero). `abbreviateTokens` (1000+ → `"146K"`, else a raw
count) stays an in-file, unexported one-liner; zero new public exports, zero new theme tokens (reuses
`--color-success` and #188's `--color-surface-container-highest`). See
[#192 codebase notes](../codebase/192.md) for the full design and patterns established.

**The percentage itself moved out to a shared function, `contextUsagePercent` (#811).** This section's
own inline expression — `Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)))`
behind `windowTokens > 0` — is now `contextUsagePercent(usedTokens, windowTokens)`, in the new
`src/renderer/src/screens/conversation/contextUsage.ts`, so this gauge and the
[composer footer row](#composer-footer-row-811)'s "Context: N%" reading share one guard and one clamp
rather than two that could drift apart. `ContextWindowSection` calls it and derives nothing itself —
`pct !== null` replaces the old `available` ternary — and every other line in the section (the usage
string, the `role="progressbar"` triple, the inline fill width, the unavailable line) is byte-identical
to before the extraction; `RunConfigSections.test.tsx`'s existing assertions pass unedited, which is the
extraction's own behaviour-preservation proof. **The guard also gained `Number.isFinite(windowTokens)`**,
closing a real hole the old clamp had: `used_tokens`/`window_tokens` cross the wire through a bare
`typeof === 'number'` check with no range test (`inboundMessage.ts:611-622` rules that deliberately —
a client-invented bound would drop valid future frames, so *"the render slice formats the counter
defensively instead"*), so a daemon frame carrying `used_tokens: 1e999, window_tokens: 1e999` parsed to
`Infinity`/`Infinity` and the pre-#811 clamp rendered `NaN% used` with a `width: NaN%` fill. `windowTokens
<= 0` and non-finite now collapse into the identical unavailable branch — an architect self-review
security finding (MUST FIX), closed in the same extraction rather than as a follow-up.

### Log data section (#72)

The sheet's **first populated section** — the sole user-facing entry point for the client debug-bundle
download (the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) family, whose background
chain — request/reassemble/save/[orchestrator](debug-bundle-orchestrator.md) — was already merged and
inert for want of a UI driver). Mounted as `<LogDataSection/>`, the sheet body's last child (`<RunConfigSections/>`, #188, now
precedes it), last in document order ("beneath Context-window" per Figma node `20-100` subtree
`98:2`/`98:16`):

```
.status-sheet__body
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription)
    └── LogDataView                    (pure: props in, markup out)
        ├── .status-sheet__section-header   "Log data" (reused across future sections)
        └── .log-data
            ├── button.log-data__download   full-width filled-tonal pill, "Download"/"Downloading…"
            └── p.log-data__status[role=status]   count / saved path / mapped error (only when non-null)
```

The download state (`idle` / `downloading{chunks}` / `saved{path}` / `failed{reason}`) is a small,
**pure, total, phase-agnostic** reducer (`logDataDownload.ts`, the `composerSend.ts`/`pairingState.ts`
idiom) driven by `useReducer` per [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)
— never the session store, since [`translateDaemonEvent`](daemon-event-bridge.md) already returns
`null` for all three `debugBundle*` events. The container's single `onDaemonEvent` subscription filters
those three events via `toDownloadAction` (the `translateDaemonEvent` analogue) and is torn down on
unmount, so a sheet close/reopen nets exactly one live listener. Pressing Download sends the bare
`requestDebugBundle` command and **optimistically** dispatches `requested` (not gated on the first
daemon event — the `unavailable` failure path emits no progress at all). Single-in-flight is
belt-and-suspenders: the button disables while busy and `onDownload` re-checks the phase, with the
deterministic backstop being the [#169 orchestrator](debug-bundle-orchestrator.md)'s own `active`
flag, not a second authoritative guard here. Failure text is drawn from a closed `reason → sentence`
map — never the raw `DebugBundleFailure` token, an errno, or a stack (AC5).

Two more M3 tokens landed for the button: `--color-secondary-container` / `--color-on-secondary-container`
(filled-tonal fill/text). See [#72 codebase notes](../codebase/72.md) for the full design, patterns,
and the one copy-only deviation from spec.

### Structured-stream timeline render (#203)

The render slice (L3) of the Phase-2 structured-streaming vertical (transport [#199](../codebase/199.md)
→ store [#202](../codebase/202.md) → render #203), mounted immediately after `<MessageThread/>`:

```
.conversation
├── MessageThread              messages={useSessionStore(selectMessages).map(toMessageViewModel)}
└── Timeline                   items={useTimelineStore(selectItems)}
```

`Timeline({ items }: { items: readonly ThreadItem[] })` is `MessageThread`'s twin — a pure, exported,
in-file component (props-in/markup-out, server-rendered in tests from an injected `ThreadItem[]`, no
store, no IPC). It reuses `MessageThread`'s scroll region class (`.conversation__thread`) and the
coarse path's daemon-bubble treatment (`.message-row--daemon` / `.bubble--daemon`) verbatim — no new
bubble styling. `ThreadItem` (from [thread-timeline](thread-timeline.md)) is already the render model
(camelCase, `conversation_id`-free, ADR 0008), so the container passes `selectItems`'s result straight
through — no adapter, unlike the coarse path's `toMessageViewModel`.

Per-item render, by `kind`, with **no `default`/`assertNever`** (an exhaustive switch that degrades an
unsourced-today kind to `null` rather than throwing — the render-path counterpart to the store
bridges' hard `assertNever`, see [#203 codebase notes § Patterns established](../codebase/203.md)):

- `assistantText` → one bubble, carrying `data-thread-role="assistant"` as the test hook
  (`MessageThread`'s `data-message-role` counterpart). Since [#609](../codebase/609.md), the bubble
  forks on the same `inProgress` prop the streaming cursor below reads — no new state:
  - **In progress** (the tail, still growing): unchanged from #199/#607 — text as React children
    (never `dangerouslySetInnerHTML`, so HTML inside a delta renders as visible characters), plus the
    dedicated `.bubble--assistant-text` modifier (`white-space: pre-wrap`) so a multi-paragraph reply
    keeps its blank lines and space runs instead of collapsing to one run-on line. Hung on its own
    class rather than `.bubble--daemon` so the four chrome affordances below
    (thinking/stall/api-retry/compacting) and the coarse path's `.bubble--user` stay structurally
    unreachable by the rule.
  - **Settled** (every other item, and the tail once its turn's `turn_end` arrives): renders through
    [`AssistantMarkdown`](assistant-markdown-renderer.md) (#608, wired in by #609) inside a
    `<div className="bubble__markdown">` — a flex column with `gap: var(--space-2)` for Figma `16:43`'s
    8px block rhythm, `margin-block: 0` on direct children (`index.css` resets only `body`, so UA block
    margins would otherwise stack on top of the flex gap), and `pre { white-space: pre-wrap }` so
    fenced code wraps within the bubble's measure instead of spilling out of it. `bubble--assistant-text`
    is **not** carried here — the settled branch never gets the class at all, making "markdown owns the
    whitespace" true by construction rather than by an override one level down. `React.memo` was
    considered and declined (unmeasured cost, no test tier in this repo can observe a skipped
    re-render); the seam is named in a code comment at the render site.

  The fork exists because the daemon emits one event per *complete* content block and the store
  coalesces a turn's deltas in place, so a settled item's text is always a whole document — a fenced
  block never arrives half-open — while the in-progress tail must never be shown half-parsed, which is
  why it stays plain text permanently rather than gaining markdown once "enough" of it has streamed in.
- `toolCall` → the tool-row chip ([#218](#pending-tool-call-row-218), below) — no longer a no-op as
  of that ticket; the resolved success/error treatment ([#230](#resolved-tool-call-row-230), below)
  lifted the pending dimming and added the error accent.
- `turnBoundary` → `null` (structural only; Figma has no per-turn divider).

**Streaming cursor** (Figma `16:56`, glyph `▎` U+258E): a trailing `<span class="bubble__cursor"
aria-hidden="true">` inside the in-progress bubble, rendered only on the tail item when
`item.kind === 'assistantText'` — derived from array position, never from `selectPhase` (which had no
source at the time; [#214](../codebase/214.md) later wired one up, but this render still doesn't read
it — the thinking indicator is a separate, still-open slice). CSS blink guarded by
`@media (prefers-reduced-motion: reduce)`. Since #607's `pre-wrap` rule, a reply whose text ends in a
newline now carries the cursor onto the following line — the whitespace rule working as intended, not
a regression; the cursor `<span>` sits flush against `{item.text}` in the JSX with no intervening
whitespace so no extra blank line is introduced by the markup itself.

**React key = array index**, deliberately: the reducer's `appendDelta`/`fillResult` invariants
guarantee the list is append-only with tail-mutation, never reordering or inserting mid-list, so index
identity is stable per logical item (`turnId` alone would collide once #205 lets a tool split one turn
into two `assistantText` items; a text-bearing key would remount the growing bubble every delta).

**Strangler-Fig coexistence at ship time, not a cutover** — as originally shipped, `Timeline` sat
directly beside `MessageThread`; the coarse path was completely untouched and stayed the *live* one,
`Timeline` returning `null` on an empty `items` array (not an empty `<div>`) for zero layout footprint
so the thread was pixel-identical to before this ticket. The store stayed empty in production until
`interactive` flipped (a non-interactive v2 connection receives no structured stream), so this entire
render path was inert at ship time.

**Reconciled in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse
`message` fan-out stopped daemon-side, and `MessageThread` was retired rather than left as an empty
dead region — `Timeline` is now the conversation's single thread surface. See
[The interactive flip + thread cutover](#the-interactive-flip--thread-cutover-179) below and
[#203 codebase notes](../codebase/203.md) for the original design and code review record.

### Thinking / working indicator (#215, held for the whole running turn since #648, tool-named since #649, opens on send since #650)

`Timeline`'s structural twin over the coarse `phase` scalar (`TurnPhase`, [ADR 0008](../decisions/0008-thread-timeline-model.md))
rather than the `items` list. Through #796 it mounted immediately after `Timeline`; **since
[#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) it mounts as the sole child of
`ComposerStatusArea`**, the fixed-height row directly above the composer — see [Composer status
row](#composer-status-row-796) below for the row itself:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
└── ComposerStatusArea         isRunning={isTurnRunning(phase)}
    └── ThinkingIndicator      state={workingIndicatorStateWithLocalSend(
                                         { phase, apiRetry, compacting }, localSendPending)}
                                toolName={openToolName(items)}
```

The daemon opens a turn with `turn_state{thinking}` before any `assistant_delta` (pyrycode #632), so
during that window `Timeline` is `null` (no items yet) and, before #215, the thread showed nothing — a
slow turn was indistinguishable from a stalled one. `ThinkingIndicator({ state })` is `Timeline`'s twin:
pure, exported, in-file, server-rendered from an injected value, never a store read of its own. `state
=== null` → `null` (zero footprint, the `Timeline`-on-empty-`items` precedent) — **as of #796, "zero
footprint" describes the label only, not the row**, since `ComposerStatusArea` always renders and holds
its height regardless (AC2, see below); otherwise a single `<span
className="conversation__thinking composer-status__label">` (a `<div className="bubble bubble--daemon
bubble--thinking">` through #796; the bubble treatment retired when the label moved into the row — see
[Composer status row](#composer-status-row-796)) with `THINKING_COPY` (`'Thinking…'`) when `state ===
'thinking'` or `WORKING_COPY` (`'Working…'`) when `state === 'working'`. The label now inherits
`--color-primary` from the row's `.composer-status__activity` group rather than carrying its own muted
tint — both labels are still static, client-owned constants, never `phase` itself.

**Union input, not `phase` and not a `string` — the label CHOICE stays a type-level guarantee; naming
the tool is a deliberate, narrow exception to it, since [#649](../codebase/649.md).** The view's `state`
prop is `state: WorkingIndicatorState | null` (`WorkingIndicatorState = 'thinking' | 'working'`), never
`phase: TurnPhase` (which would make the illegal `'idle'` branch representable) and never a plain
`string` (which would reopen the hole the type exists to close). Through #648 this was "no
daemon-supplied string is rendered by this slice, full stop" — the prop's only inhabitants were two
client-owned literals and `null`. #649 named the daemon's currently-open tool in the label (per the
operator's 2026-08-20 decision: the tool row two lines above the indicator already renders the same
`name` as an escaped inert React child, so the indicator adds no new exposure) and had to reverse that
guarantee to do it. What survives, narrowed rather than dropped: the **label choice** (`state`) is still
a closed client-owned union, unwidened; the daemon string rides a second, separately-typed, *required*
`toolName: string | null` prop; the fixed copy around the name (`toolWorkingCopy`) stays a client-owned
constant; and the name reaches the DOM only as an auto-escaped text child, never through an HTML sink.
`state === null` is checked first, so #493's and #496's supersede rules still hide the indicator entirely
in either phase — an open tool cannot resurrect it. The container does both derivations
(`workingIndicatorState` and `openToolName`) over values it already holds, not the view. No animation
shipped (an optional pulse was explicitly non-load-bearing per spec); through #796 the interim treatment
stayed deliberately minimal, since the locked mobile design (`g2HIq2UyPhslEoHRokQmHG`, node `16-8`) has no
dedicated working-indicator node. **#796 is the deferred desktop-design pass this paragraph used to await**
— the desktop layout's own Figma node (`111:3525`) exists, and consuming it moved the label off the
daemon-bubble surface into the fixed-height row above the composer and added the one genuinely new piece,
a turning icon; see [Composer status row](#composer-status-row-796) below.

**Opens locally on send since [#650](../codebase/650.md), closes robustly.** Through #649 the
indicator stayed dark from Enter until the daemon's first event — the composer's optimistic echo
landed as a `userText` timeline item, but `phase` stayed `idle` until `turn_state{thinking}`
arrived, so a slow network round-trip looked identical to a dead app. #650 closes that window with
a new [timeline-store](conversation-timeline-store.md) scalar, `localSendPending: boolean`, set by
the same `userText` dispatch that posts the echo (no new event: that dispatch already *is* the
composer's accept signal). `phase` itself stays daemon-only — a wire mirror, and the one field the
composer's stop variant reads (`InterruptControl` read it here until [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678)
folded the affordance into `Composer`'s own send button; see [Interrupt envelope § The render
affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678)) — so the
local open cannot arm the interrupt affordance. The mount site
now calls a second exported derivation, `workingIndicatorStateWithLocalSend(status,
localSendPending)`, composed *on top of* `workingIndicatorState` rather than folded into
`ThreadStatus`: the daemon's answer wins when non-null, otherwise a pending local send re-calls the
same gate with `phase: 'thinking'` substituted, inheriting #493's/#496's supersede clauses for
free and picking the flicker-free `'thinking'` label (the daemon's first real `turn_state{thinking}`
then changes nothing at the seam). Closes on any daemon `turn_state`, on a reconnect reconcile (the
sharpest form of the #538 hazard — a locally-opened window has no daemon-side edge to wait for at
all if the send never arrives, corroborated by pyrycode #1062), and for free on a timeline `reset`
(conversation switch, unpair). `ThreadStatus`, `shouldShowThinking` and `workingIndicatorState`
stay textually untouched. See [#650 codebase notes](../codebase/650.md) for the full reducer
arm-by-arm classification and the e2e mount-timing repair it also required.

Was dormant until [#179](../codebase/179.md) flipped `interactive` (`phase` stayed `idle` in
production until then, the same posture as `Timeline`); now live. Code review flagged one non-gating
NIT: the label has no live region (`role="status"`), so a screen reader won't announce it appearing,
disappearing, **or its label changing mid-turn since #648, or naming a tool since #649** — still
unaddressed. #796's own spec logged this as an open question rather than a NIT and left it standing on
the same reasoning: a live region beside a rotating icon is its own a11y decision, and no AC has ever
covered it. See [#215 codebase notes](../codebase/215.md) for
the full original design, [#648 codebase notes](../codebase/648.md) for the whole-turn broadening,
[#649 codebase notes](../codebase/649.md) for the tool-naming reversal, patterns established, and the
deferred stale-open-`toolCall` risk (cross-referenced against pyrycode #1243), and
[#650 codebase notes](../codebase/650.md) for the local-send open/close and the e2e mount-timing
repair it forced.

**Gate narrowed in [#493](../codebase/493.md), narrowed again in [#496](../codebase/496.md), broadened
in [#648](../codebase/648.md), composed on — not touched — by [#650](../codebase/650.md):**
`shouldShowThinking(status)` is `isTurnRunning(status.phase) &&
status.apiRetry === null && !status.compacting` — reusing the same `isTurnRunning` predicate the
composer's stop variant gates on (`thinking || responding`), rather than the bare `phase ===
'thinking'` comparison #215 shipped. A separate, new `workingIndicatorState(status)` composes **on top
of** that gate rather than folding into it: `null` when `!shouldShowThinking(status)`, else `'thinking'`
when `status.phase === 'thinking'`, else `'working'` (`'idle'` is unreachable in that second branch
because the gate already excluded it). `shouldShowThinking` itself keeps its name, its `ThreadStatus`
parameter, its `boolean` return, and both supersede clauses (`apiRetry === null && !compacting`)
textually untouched — while either is live, the corresponding status below still supersedes this
indicator, in **either** running phase now, not only `thinking`. #496 extended the same `ThreadStatus`
record and predicate by exactly one field and one clause — the seam #493 built by name for this ticket,
not a second parallel gate. See [Api-retry indicator](#api-retry-indicator-493) and [Compacting
indicator](#compacting-indicator-496) below.

**Why broaden rather than add a second indicator.** The daemon emits `turn_state{thinking}` only while
claude is producing thinking text; the first reply token or the first tool step flips `phase` to
`responding`, and no further `turn_state` arrives until the turn ends (pyrycode
`cmd/pyry/interactive_turn_v2.go`). For a tool-heavy turn `responding` is the phase that *lasts*, and it
was exactly the phase in which #215's gate showed nothing — the operator's first real use of the desktop
app (2026-08-20) surfaced this as a screen that looked frozen for most of a turn. Because the client
receives no signal finer than `responding` inside the tool loop, `WORKING_COPY` ("Working…") is
deliberately generic rather than naming tool activity — a copy like "Running tools…" would be a lie
whenever the turn is actually still streaming text.

**Named since [#649](../codebase/649.md): `WORKING_COPY` is superseded by the specific tool name whenever
one is actually open**, closing the operator's remaining complaint that `WORKING_COPY` read identically
for a 40 ms file read and a four-minute build. This doesn't reopen the lie #215 avoided, because it isn't
derived from `phase` at all — it's a direct, independent read of `items` (`openToolName`): a `toolCall`
item (`threadTimeline.ts:42-50`) carries `name` and starts `result: null`, filled in place when the
correlated `toolResult` arrives, so "a tool is open right now" and "which one, if more than one" (the
last such item in array order — `items` is append-only, `fillResult` fills in place without reordering)
are both facts already sitting in the store, not an inference over `phase`. `openToolName(items)` is
computed alongside `workingIndicatorState` at the same call site and passed as the indicator's second,
required `toolName: string | null` prop; when it is non-null it replaces the phase-derived copy with
`` `Running ${name}…` `` (`toolWorkingCopy`) rather than sitting beside it, and reverts to the generic copy
the moment the tool's `toolResult` fills the item — no further `turn_state` needed. Renders through a
`.tool-row__summary`-style one-line-ellipsis bound (not `.tool-row__name`'s never-truncates one — see
[#649 codebase notes](../codebase/649.md)) so a long tool name never wraps to a second line or moves the
composer — through #796 via `.bubble--tool-label`, backstopped by `.bubble`'s own `max-width: min(680px,
75%)`; **since #796 via `.composer-status__label--tool`**, and the backstop changed with it: `.bubble` is
gone from this label's ancestry, so the bound is now a three-link flex chain instead — see [Composer
status row § the truncation bound](#composer-status-row-796) below for the replacement and why it had to
be re-derived rather than copied. One deliberately undefended edge: an interrupted turn can leave a
`toolCall` permanently `result: null`, so the *next* turn's indicator could name that stale tool — the
timeline already shows that call as a permanently pending, dimmed row (#230), so the label would mirror
what's already on screen rather than contradict it; the fix if ever observed is scoping the scan to stop
at the current turn's `turnBoundary`.

### Composer status row (#796)

The desktop layout's own fixed-height status area directly above the message box (Figma `111:3525`,
780×24), replacing the loose region the working indicator used to float in. `ComposerStatusArea({
isRunning, children })` is an in-file `ConversationScreen.tsx` function, mounted as `StatusRow`/
`BackgroundTaskTrigger`'s next sibling and `Composer`'s immediate predecessor:

```
.conversation
├── StatusRow
├── BackgroundTaskTrigger
├── ComposerStatusArea         .composer-status
│   ├── .composer-status__activity
│   │   ├── PyryMark            .composer-status__icon(--spinning)  (14×16, from theme/PyryMark.tsx)
│   │   └── {children}          → <ThinkingIndicator/>
│   └── {trailing}              → <ComposerErrorChipControl/>       (row's own slot, #797, see below)
└── Composer
```

**Never returns `null` — the one deliberate departure from every sibling indicator's zero-footprint
posture (AC2).** `ApiRetryIndicator`/`CompactingIndicator`/`StallIndicator`/`ThinkingIndicator` itself all
still return `null` at rest; this row's *height* is what must be reserved regardless, so the composer no
longer moves under the operator's cursor each time the label appears or disappears — the same reasoning
`ComposerSendButton` (#678) already applies to never returning `null` either. A turning icon beside no
label is consequently a **legal, expected** render (a live api-retry or compaction still supersedes the
label per #493/#496 while the raw phase reading keeps the icon turning) and the held height is what makes
that read as intentional rather than broken.

**`isRunning: boolean`, not `phase: TurnPhase` — the `ComposerSendButton` precedent, not a new one.** The
view structurally cannot receive the store enum, so `'idle'` is not representable inside the spinning
branch and no daemon string can reach this prop. The container supplies `isTurnRunning(phase)`, the same
exported predicate the composer's stop-button variant already gates on — reused, not re-derived.

**`children`, not a `label: string` prop — the `StatusSheet({ onClose, children })` precedent.** Keeps the
row independent of where its text comes from. `children` is the activity group's slot (`<ThinkingIndicator/>`);
the row gained a second, sibling slot of its own, `trailing`, in
[#797](https://github.com/pyrycode/pyrycode-desktop/issues/797) — see [Composer error chip](#composer-error-chip-797)
below. Through #796 that right-hand slot was empty and got **no placeholder element**, relying on the
row's own `height: 24px` to reserve the space (the Figma error frame is itself 24 tall, so a second flex
child was never going to grow it); #797 kept that posture when filling it — `trailing` still renders bare,
with no wrapper div, so the three non-error arms emit nothing there today either.

**The turning state is a CSS class, never a resolved style.** `.composer-status__icon--spinning` drives a
`composer-status-spin` keyframe (`1.6s linear infinite`, a client-owned constant — the Figma node is a
static vector with no motion spec); a `@media (prefers-reduced-motion: reduce)` rule turns the animation
off while leaving the class and the icon in place, `.bubble__cursor`'s existing shape verbatim. The class
being static markup (rather than an inline style resolved at paint time) is what makes AC3's
running-vs-still distinction visible to a `renderToStaticMarkup` renderer spec, and it is the repo's
**first reduced-motion coverage anywhere** — no renderer spec can reach a media query, so
`e2e/composer-status-reduced-motion.spec.ts` (Playwright fake tier) is the sole check, and it self-verifies
the emulation took effect (`matchMedia('(prefers-reduced-motion: reduce)').matches` asserted before
anything else) before asserting the icon's computed `animationName`. A control arm — the same class,
`reducedMotion: 'no-preference'`, `animationName` asserted **not** `'none'` — is what makes the spec able
to fail at all; without it, `'none'` on a stylesheet that never declared the keyframe would also pass.
`page.emulateMedia` does reach an Electron window over CDP as shipped, so the `--force-prefers-reduced-motion`
launch-arg fallback the architecture spec held in reserve was never needed.

**The icon is `PyryMark`** (`theme/PyryMark.tsx`), the pyrycode snowflake mark **moved out of
`WelcomeScreen.tsx`'s module-private `PyrycodeMark`** so the two screens share one 12 KB path instead of a
second, driftable copy — see [Welcome screen § The two SVGs](welcome-screen.md#the-two-svgs--inline-jsx-no-svg-file).
Confirmed to be the *same* glyph the welcome hero draws, numerically rather than assumed: this node's
Figma coordinates and viewport both divide the welcome mark's by exactly 6.5. Rendered **unflipped** here,
diverging from `.welcome__mark`'s own `transform: scaleY(-1)` — a glyph that spends its visible life
rotating has no observable orientation, so the flip buys nothing and was left off; the architecture spec's
stated reason for this ("the same orientation as the welcome hero") did not survive contact with
`welcome.css:84` and the code comment now records the real relationship instead of repeating the
now-false one.

**The truncation bound is a re-derived three-link chain, not a copy of the retired one.** Through #796,
`.bubble--tool-label`'s one-line-ellipsis bound leaned on `.bubble`'s own `max-width: min(680px, 75%)` as
its backstop — measured: removing that max-width blew the label out to 3089px against a 396-char name.
This move deletes `.bubble` from the label's ancestry entirely, so that backstop is gone. The replacement,
verified by measurement rather than assumed (a 3000-char daemon tool name leaves `.composer-status` at
640px with no horizontal overflow on `.conversation` or `document.body`): `.composer-status` is a
block-level flex item of `.conversation` (a definite width) → `.composer-status__activity` is `flex: 1 1
auto; min-width: 0` (without which a flex item's automatic content minimum floors at the label's full
intrinsic width) → `.composer-status__label--tool` is `min-width: 0; overflow: hidden; text-overflow:
ellipsis; white-space: nowrap` (`nowrap` also collapses an embedded newline, so a daemon name can't break
the line either). All three links are required; dropping any one reopens the #649 hazard this bound
exists to close. `text-overflow` needs a block container and the label is a `<span>` — it works because a
flex item is blockified, the load-bearing detail nearest a future "make it a span again" refactor.

**Scope boundary, held exactly as ticketed.** `ApiRetryIndicator`, `CompactingIndicator`, and
`StallIndicator` keep their pre-#796 mount site (right after `Timeline`), their bubble treatments, and
their mutual precedence rule — none of that was reopened. Only `ThinkingIndicator`'s markup moved. One
second-order consequence: `.conversation__thinking` no longer changes the thread's viewport size when it
mounts or unmounts, because it now lives inside a row that is *always* mounted — see the **Thread scroll
pin** edge case below, where `thread-scroll-pin.spec.ts`'s fourth criterion had to be repointed onto the
stall indicator for exactly this reason. `conversation__thinking` itself is **retained**
as a class on the label purely as an identity hook (two Electron-launch e2e specs locate it as their
turn-liveness gate) — it styles nothing any more; that is ordinary BEM, not drift.

**Test-file vacuity repoint, the same hazard the row's own class-string rename created elsewhere.** Once
`bubble--thinking` exists nowhere in production, the three pre-existing `ConversationScreen.test.tsx`
assertions checking the stall/api-retry/compacting renders' `not.toContain('bubble--thinking')` — i.e.
"this problem state is visually distinct from the working indicator" — would pass against a string no
component can emit, silently testing nothing; #796 repointed all three onto `not.toContain('composer-status__label')`
so the claim stays falsifiable, the same fix `.bubble--tool-label`'s own naming comment was written to
avoid ([#649 codebase notes](../codebase/649.md)).

Code review PASS, with one non-blocking SHOULD FIX left open: `ThinkingIndicator`'s own comment block still
says "there is no Figma node for this state; the indicator is one muted run" — both clauses are now false
(node `111:3525` is precisely what this ticket consumes, and the label inherits `--color-primary`, not a
muted tint) even though the paragraph's conclusion (one text run, so overflow draws a single ellipsis) is
still correct and still load-bearing. Left as prose upkeep rather than a gate. See [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796).

### Composer error chip (#797)

Fills the composer status row's `trailing` slot (Figma error frame `112:3529`) with a red pill reading
`COMPOSER_ERROR_CHIP_COPY` (`'Host connection down!'`, [composer send § 8](composer-send.md#8-error-chip-copy-composersendts-797)),
shown in the `error` connection arm and in no other — the **fourth** read of `sessionStore`'s
`ConnectionStatus`, beside `composerAvailability`'s terse hint, `shouldOfferRepair`'s re-pair gate, and
`shouldShowBanner`'s prominent band (all in [composer send](composer-send.md)).

`ComposerErrorChip({ status })` is the pure, exported view (the `ConnectionBanner` pattern):
`status.type !== 'error'` → `null`; otherwise one `<div className="composer-status__error">` holding a
hidden `<span className="composer-status__error-prefix">Error: </span>` ahead of the visible copy.
`ComposerErrorChipControl` is the module-private, store-bound container — `useSessionStore(selectStatus)`,
the same narrow slice `ConnectionBannerControl` already reads — mounted as `ComposerStatusArea`'s
`trailing` prop.

**It never destructures `status.error`.** The whole of AC2 is that structural fact, restated one component
over from `CONNECTION_BANNER_COPY`'s own guarantee: neither `message` nor `code` has a rendering path to
the DOM, an attribute, a `title`, or a log, so there is nothing to escape, length-bound, or strip a
newline from. The design carries this independently too — the mock's text node is a single 132×16 line, a
relayed `ErrorPayload.message` would not fit it.

**A `<div>`, not the banner's `<p>`.** The chip lives in `.composer-status`'s hard `height: 24px` row, and
this repo ships no global `box-sizing`/margin reset (the row's own comment records that), so a `<p>`'s UA
margin would be a live layout hazard for no semantic gain.

**No live region.** No `role="status"`, no `role="alert"`, no `aria-live` — the `ConnectionStatusIndicator`
ruling applies verbatim: the banner already politely announces disconnects, and `shouldShowBanner` is true
on the same `error` arm, so a `connected → error` transition mounts the banner and this chip in the same
commit. A second polite region would announce one fact twice.

**AC4's marking is hidden text, not an `aria-label`.** A bare `<div>`/`<span>` maps to `role="generic"`,
which ARIA 1.2 puts on the name-prohibited list — an `aria-label` there asserts green in a markup test and
is silently dropped by a real screen reader. The hidden prefix's trailing space is load-bearing: it is the
separator a screen reader needs to concatenate the two runs into "Error: Host connection down!"; an
editor's trim would silently degrade the announcement, which is why `composerSend.test.ts` pins it.

**CSS (`conversation.css`, after `.composer-status__label--tool`):** `.composer-status__error` is
`flex: 0 0 auto` (required, not decorative — without it the chip would be a shrink candidate alongside
`.composer-status__activity`'s `flex: 1 1 auto; min-width: 0`, and an oversized daemon tool name would
squeeze the chip instead of ellipsizing the label, inverting the truncation chain above and making it
remotely triggerable); `white-space: nowrap` (the row's hard height means a wrapped chip would overflow
rather than grow it); no `height` declaration — under this repo's content-box default, `line-height: 16px`
plus `padding: 4px 0` already sums to the Figma's own 24px construction, and an explicit `height: 24px`
alongside that padding would render a 32px chip. `.composer-status__error`'s truncation-chain interaction
was **re-measured with the chip up** (not assumed from #796's empty-slot numbers): a 3000-char tool name
still leaves `.composer-status` at 640×24 with no horizontal overflow, the chip unshrunk at its full
content width and the activity group absorbing the whole squeeze.

**New token:** `--color-error-container: #93000a` (`tokens.css`, beside `--color-error`) — the M3 dark
`Schemes/Error Container`, read from `get_variable_defs` on Figma node `112:3529`, never from the export's
light-scheme fallback `#ffdad6` (the same trap `.status-row` and this row's own comment already record).
One consumer today; the next slot needing an error container should reuse it rather than re-derive the hex.

**Testing gotcha: the container's showing branch needed a `getInitialState` spy, not `setState`.** The
architecture spec assumed the container `describe`'s existing `beforeEach` (which `setState`s the session
store) would make the `error` arm reachable through the mounted `ConversationScreen`, the same way it does
for `ConnectionBannerControl`. It doesn't: zustand v5's `useStore` reads `getInitialState()` under
`renderToStaticMarkup`, never `getState()`, so a `setState` in `beforeEach` never surfaces there —
`ComposerErrorChipControl` turned out to share `RepairControl`'s situation (see [Re-pair
control](#re-pair-control-167) above and [#69 codebase notes](../codebase/69.md)), not the banner's. The
shipped test spies `sessionStore.getInitialState` directly, mocks its return once, and restores it in a
`finally`. Worth remembering for the next container test whose visible branch is not the store's initial
`disconnected` snapshot — check which read path the mount actually uses before trusting a `beforeEach`
`setState` to reach it.

Code review PASS (architect self-review) — see the ticket's own security review for the trust-boundary and
attribute-sink analysis; both concluded no findings, on the strength of the "never destructures
`status.error`" structural guarantee above.

### Composer footer row (#811)

The desktop layout's fixed-height row **below** the message box (Figma `110:3494`, 780×20, the third
child of the `Input area` symbol after `Status area`/`ComposerStatusArea` and `Message input`) — not to
be confused with [Composer status row](#composer-status-row-796), which sits *above* the message box.
The desktop layout puts five affordances in this row — Actions (#680), permission mode (#682), model and
effort (#683), this ticket's context-usage reading, and attach (#685) — and four of them are blocked on
daemon work that doesn't exist yet. #811 builds the row itself and lands the one occupant that isn't
blocked; **the other four slots stay genuinely empty, no placeholder element, no disabled control**:

```
Composer
├── .composer__hint             (unchanged, #31)
├── .composer__row              (unchanged — textarea + ComposerSendButton)
└── .composer__footer           (new, third child)
    └── ContextUsageControl     null until a real snapshot has loaded, then <ContextUsageReading/>
```

Inline BEM children of `.composer`, not a component of their own — consistent with `.composer__hint`/
`.composer__row` already being inline JSX rather than extracted, and it keeps the ticket's exported
surface to two symbols.

**`contextUsagePercent(usedTokens, windowTokens): number | null`** — new file,
`src/renderer/src/screens/conversation/contextUsage.ts`, React-free and dependency-free (the
`composerSend.ts` idiom: a pure module beside the screen with its own `.test.ts`). This is the one
computation [Run configuration Context window section](#run-configuration-context-window-section-192)
used to own inline; see that section above for the extraction and the `Number.isFinite` guard it added.
Returning `number | null` (not a number beside a separate `available` boolean) is what makes the two
surfaces structurally unable to disagree about whether a reading exists — the guard is the return type,
not a convention repeated at each call site.

**`ContextUsageReading({ usedTokens, windowTokens })`** — the pure view, beside `ComposerErrorChip` in
`ConversationScreen.tsx` (the exact pair this ticket clones, [Composer error chip](#composer-error-chip-797)
above). Returns `null` when `contextUsagePercent` does; otherwise exactly one
`<span className="composer__context">Context: {pct}%</span>`, a single template-literal text run. Every
property `ComposerErrorChip` established carries over unedited: a `<span>` (this repo ships no global
box-sizing/margin reset, so a `<p>`'s UA margin is a live layout hazard against the row's held height),
no attribute beyond `className` (no `onClick`, `tabIndex`, `role`, `title`, `aria-*` — it is a reading,
not a control), and no live region (`aria-live` would announce a percentage after every turn once #810
made the figures live). Unlike the error chip, there is no daemon-supplied *string* on this path at all —
the only interpolated value is an integer in `[0, 100]`, so none of #796/#797's escaping/attribute-sink
questions apply here.

**`ContextUsageControl()`** — module-private container, the `ComposerErrorChipControl` shape: one
`useRunConfigStore(selectSnapshot)` read (not two narrow field selectors — both figures must come from
the same store tick, or a tear could show a percentage of two unrelated snapshots), coalescing
`snapshot?.usedTokens ?? 0` / `snapshot?.windowTokens ?? 0` — [`RunConfigSections`'s own
container](#run-configuration-context-window-section-192) verbatim, so the not-yet-loaded state and the
daemon's `window_tokens: 0` "unavailable" signal collapse into the identical rendered absence on both
surfaces. Reads [Run configuration store](run-config-store.md)'s app-lifetime `RunConfigLiveData` feed
(#810) — this ticket adds no store, no subscription, and no event of its own.

**`.composer__footer` reserves its own height (20px) unconditionally**, the same `.composer-status`
guarantee ([Composer status row](#composer-status-row-796) above): a null reading cannot move
`.composer__row` because the row's box exists whether or not it holds a child. No vertical padding
(no global box-sizing reset), `align-items: center`, `padding: 0 var(--space-4)` — aligned with the
input's *text* start (`.composer__hint`'s treatment), deliberately not with `.composer-status`'s
box-edge alignment; the two rows are inset differently by design. `gap: var(--space-5)` is declared now
(the design's measured 20px item rhythm) though inert with one child today, so #680/#682/#683 inherit the
row's spacing instead of each re-deriving it.

### Composer options panel (#838, placed #839, keyboard-driven since #840)

The one panel surface that all four remaining footer slots and one message-box consumer will open
rather than each building its own: Actions (#680), permission mode (#682), model and effort (#683),
and #694's slash-command type-ahead. #838 shipped only the panel's **resting appearance** — its
surface, its rows, its one new colour token — with no host anywhere in the app yet. #839 placed it in
the footer; #840 completed the interaction — opening, dismissing and driving it from the keyboard.
The panel is now feature-complete but still **ships dormant**: nothing mounts `ComposerOptionsPanel`
or `ComposerOptionsMenu` in production today, and that stays true until #680 draws the first real
footer button. Deliberate, not a gap.

**New file, not `ConversationScreen.tsx`.** `ComposerOptionsPanel.tsx` follows the
`PermissionModal.tsx` / `WorkspacePickerSheet.tsx` split: five named future consumers across two later
tickets want an addressable module, and `ConversationScreen.tsx`/`.test.tsx` (~2700/~3000 lines) are
merge hot-spots for those same sibling tickets. It adds no CSS import of its own — styles live in
`conversation.css`, and `ConversationScreen.tsx:13` stays that stylesheet's single importer, the
`PermissionModal.tsx` precedent.

```ts
export interface ComposerOptionsPanelOption {
  id: string      // stable identity — the wire/model value, not the display string
  label: string   // the visible row text
}

export interface ComposerOptionsPanelProps {
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null   // the chosen option for a value menu; null for a command list
  onSelect: (id: string) => void
  ariaLabel: string
  focusedIndex: number       // #840: the roving-tabindex row — required, like every other prop
  panelRef?: Ref<HTMLDivElement>  // #840: optional, `ThreadOverflowMenuView`'s `triggerRef` convention
}
```

A pure view — props in, markup out, no state, no effect, no store read, no `window.pyry` — the
`ThreadOverflowMenuView`/`ComposerSendButton` posture, and every prop is required (`ConversationScreen.tsx:2033`'s
"a view that cannot answer is a bug" rule) except `panelRef`, added alongside `focusedIndex` in #840 and
optional for the same reason `ThreadOverflowMenuView`'s `triggerRef` is: an ordinary prop rather than
`forwardRef`, omitted in tests since a static render cannot exercise a ref anyway. `id` is separate from
`label` because #683's model menu shows `Opus 5` for `claude-opus-5` and #682's permission menu shows
`Accept edits` for `acceptEdits`; matching on the label would force both to invent a lookup.
`currentId: string | null`, not optional — `null` is "a menu of commands is a list of actions rather
than a choice: same panel, no row highlighted," and a `currentId` matching no option takes the
identical no-highlight branch, so a stale model id or a renamed effort level can't crash the panel.
There is still no `open` prop and no trigger on the view itself: the trigger's *behaviour* now belongs
to `ComposerOptionsMenu` (below), and mounting the view *is* opening — the container writes
`{open && <ComposerOptionsPanel … />}`, the same seam `ThreadOverflowMenuView` uses.

Markup is one `<button role="menuitem" type="button">` per option in array order (the panel never
sorts), inside a `<div className="composer-options" role="menu" aria-label={ariaLabel}>`. The current
row alone carries `composer-options__item--current` **and** `aria-current="true"`, base class kept
(`conversation.css:779-781`'s modifier-without-base vacuity guard). `aria-current` was chosen over a
`menuitemradio` role branch because it's a global ARIA attribute meaning exactly "the current item
within a set" — branching the role on `currentId` would make one panel two different widgets, which
#694 (a type-ahead, not a menu) would then have to fight. Labels render as ordinary React text
children — escaped, no `dangerouslySetInnerHTML`, no attribute or URL sink — load-bearing once #694
feeds it workspace-authored command names, per CLAUDE.md's daemon-text ruling.

Since #840, each row also carries `tabIndex={index === focusedIndex ? 0 : -1}` — a **roving
tabindex**: one row is in the tab order, the rest are reachable only programmatically, and the
already-shipped `.composer-options__item:focus-visible` outline (`conversation.css:3239-3241`) paints
on whichever row holds real DOM focus. It is declared *before* `className` in the JSX, not after —
this file's tests match whole attribute runs, and inserting it later would have broken five of the
eight pre-existing assertions (#838's code review flagged that coupling as a NIT; reorder only
alongside those assertions). `aria-current` and `tabIndex` are independent axes and stay so: the
current value is what the menu reads, the focused row is where the arrows are, and they coincide only
on the frame the panel opens. An `aria-activedescendant` approach was rejected — it needs a generated
unique id per row (four consumers can share one screen) and it leaves DOM focus on the panel, which
would make the `:focus-visible` outline dead and "every close path returns focus to the trigger"
unwritable. An out-of-range `focusedIndex` marks no row, the same no-special-case posture a stale
`currentId` gets in the markup above; the container can never produce one, since
`resolveComposerOptionsKey` (below) normalises every index it emits.

**The new token**, added to `tokens.css` between `--color-on-primary` and
`--color-on-primary-container`: `--color-on-primary-fixed: #001d34` (M3 `Schemes/On Primary Fixed`,
read from the Figma *variable*, not the generated export). It's the file's first `*-fixed` token, and
the light/dark-transposition warnings on its neighbours don't apply to it — M3's `*Fixed` roles are
defined to resolve identically in both schemes, so there's no transposed fallback to be trapped by.

**CSS (`conversation.css`, appended).** The Figma nests two fills the other way — frame `On Primary`,
four of five rows `On Primary Fixed`, the current row left unfilled so the frame shows through — but
AC1/AC4 pin the collapsed shape this ships as: `.composer-options` paints the dark
`--color-on-primary-fixed` panel fill, `.composer-options__item--current` alone paints the lighter
`--color-on-primary`. Same picture, two declarations instead of six; the one visible trade is that the
2px top/bottom bands read the dark fill rather than the frame's. Hover (`--color-primary-container`)
is declared *after* the current-row rule; both are specificity (0,2,0), so source order — not the
cascade rules — is what makes hover win over the selection fill on the current row, deliberately (AC2
states the hover fill unconditionally). `padding: 2px 0` is a literal (this stylesheet's own `gap: 2px`
precedent), and with no global `box-sizing` reset in this repo, that padding on a column of five 28px
rows totals 144px — the Figma frame height exactly; keep the panel's vertical padding and the row
height in different boxes. `width: max-content` is the content-driven-width AC3 asks for — not a fixed
or minimum width — so the panel's resting size stays independent of whatever host #839 drops it into;
the drawn 81px is that particular menu's longest label, not a size (#683's model menu will be much
wider). #838 shipped no `position`, no offset and no `z-index` anywhere in the block (AC5) —
deliberately: the panel cannot be an in-flow child of `.composer__footer`, which holds a hard
`height: 20px`, and #839 (below) is the ticket that fills the gap in. The **no-`z-index`** half holds
unchanged even once positioned, for the reason `.conversation__overflow`'s comment records at
`conversation.css:2325-2334` (#276): a positioned element already paints above the non-positioned
thread, and later-in-DOM overlays (the status sheets, the permission modal) keep painting above it by
DOM order alone. This is a **new surface**, not a variant of `.conversation__overflow-menu` — only its
button reset and its no-`z-index` reasoning are copied; none of its light-surface-card visual treatment
is.

**One shipped deviation from the architecture spec, confirmed correct in review.** The spec read the
node as drawing no radius; `get_design_context` on `121:3879` returns `rounded-[6px]` on the frame
root, so the panel ships `border-radius: var(--radius-xs)` (6px, already established in this
stylesheet) — the design tool refutes the spec's claim about the node, not the diff. Deliberately
*not* paired with `overflow: hidden`: the only clip would be a ~1.5px corner sliver on an end row
(`6 − √(6² − 4²) ≈ 1.53px`, code review's correction of the PR's own estimate of what that sliver sits
against), and clipping would eat #840's future `:focus-visible` outline on exactly those rows. If a
visual pass ever wants the corner clean, code review recorded the fix that costs neither the radius nor
the outline: `overflow: hidden` paired with `outline-offset: -1px` on the focus ring, drawing it inside
the row's box where clipping can't reach it — not applied, since nothing hosts the panel yet. The
row's right inset (12px, mirroring the pinned 12px left inset) was the spec's own open call with no
design authority cited; `get_design_context` returns `px-[12px]` on every Option button instance, so
`padding: 0 var(--space-3)` is confirmed as the literal translation and that open question is closed
rather than carried into #839.

**Testing** is `renderToStaticMarkup` only (`ComposerOptionsPanel.test.tsx`) — no jsdom in this repo,
so nothing here can click, focus or measure. AC4 (the current-value modifier) is the only criterion
with a vitest detector; AC2/AC3/AC5 are stylesheet declarations, and per the ruling at
`ConversationScreen.test.tsx:1128-1132` the tests pin that the class hooks are *on* the elements rather
than inventing a DOM measurement path. To still get real evidence for the declaration-only ACs without
adding a DOM environment to vitest (a separate, deliberate decision per CLAUDE.md) or an e2e spec for a
component with no host, the PR rendered `conversation.css` in headless Chromium as a scratchpad
harness (not part of the diff) and measured the real computed styles — 144×83px, five 28px rows, the
12px inset, the exact fill/type values, hover resolving above the current row, `z-index: auto`
throughout. A reusable technique for a future renderer ticket whose ACs are pure CSS and whose
component has no live host yet.

One lesson worth carrying to a future row-button component: `.conversation__overflow-item` (the reset
this panel's rows clone) declares `width: 100%` alongside its horizontal padding. Copying that
literally onto `.composer-options__item` would have overflowed the panel — with no global `box-sizing`
reset, `width: 100%` plus `padding: 0 var(--space-3)` adds the row's 24px on *top of* the panel's
`max-content` width. The flex column's default `align-items: stretch` already runs each row the
panel's full width for free, so the correct row rule declares no `width` at all.

Code review PASS, two non-blocking NITs (the corner-clip magnitude's backdrop description, and the
test's coupling to exact JSX attribute order) — see [PR #841](https://github.com/pyrycode/pyrycode-desktop/pull/841).

**Placement (#839).** Three declarations appended to the `.composer-options` rule
(`conversation.css:3158-3160`), resolving against a new sibling wrapper block,
`.composer-options-anchor` (`conversation.css:3248-3251` — its own block rather than
`.composer-options__anchor`, since it wraps a *trigger* the panel knows nothing about, and #694 will
put it on the message box rather than on a button):

- **`bottom: 100%`** puts the panel's bottom edge on the anchor's top edge — AC1, with no gap. This is
  `.conversation__overflow-menu`'s `top: 100%` (`conversation.css:2405`) mirrored, the repo's one other
  anchored overlay and the idiom copied here.
- **`left: calc(-1 * var(--space-3) - var(--composer-options-shift, 0px))`** — written as the negation
  of `--space-3`, never as `-12px`, because the alignment number *is*
  `.composer-options__item`'s left padding: a footer button's label starts at the button's own left
  edge (Figma `115:3688` — text at x=0, chevron at x=28), so pulling the panel 12px left of the button
  puts an option's label horizontally flush with the button's label (AC2, the operator's instruction of
  2026-08-22). Neither centred on the button nor left-aligned to it — both put the labels out of line.
  If the row inset ever moves, this must move with it or the labels drift; writing the token rather
  than the literal makes that automatic.
- **`--composer-options-shift`** is AC3's right-edge clamp, defaulting to `0px` so the resting rule
  stands with no consumer setting it. It is computed by `composerOptionsShiftPx()`, a new file,
  `composerOptionsPlacement.ts`, built to the `threadScrollPosition.ts` shape: framework-free, DOM-free,
  a total function over three named plain numbers (`anchorLeft`, `panelWidth`, `windowWidth` — named
  rather than positional so `panelWidth`↔`windowWidth` can't transpose silently at the untested call
  site). One expression and one `Math.max(0, …)`, no guards: the resting left edge is
  `anchorLeft − COMPOSER_OPTIONS_LABEL_INSET_PX` (12, paired by comment with `--space-3` on both sides —
  there is no detector for that coupling since #838 forbids reading `conversation.css` as text from a
  test, so it is carried by comments plus a pinning test, exactly as `AT_BOTTOM_TOLERANCE_PX` is), and
  the shift is that plus `panelWidth − windowWidth`, floored at zero. **`windowWidth` is the window's
  own right edge, not the chat pane's** — a deliberate geometry call: at the 800px minimum the pane's
  right edge is 780 while the window's is 800, so a clamped panel may overhang that 20px
  `.paired-shell` gutter, which is empty backdrop with the sidebar on the other side. **There is no left
  clamp**: the sidebar is `flex: 0 0 400px` and never shrinks, so the leftmost footer button's left edge
  is `20 + 400 + 20 + 12 + 16 = 468` at every window width and the panel's leftmost resting edge is
  456 — unreachable by construction, so a guard for it would be an untestable branch defending an
  unobservable failure. Ships dormant, exactly like `threadScrollPosition.ts` ahead of #601: no footer
  button exists yet to open the panel from, so no caller was added to "prove it works."
- The custom property is set on the **anchor**, not the panel, so inheritance carries the shift down
  without widening `ComposerOptionsPanel`'s four-prop surface or forwarding a ref into it — the value
  must carry a unit, or the whole `left` declaration goes invalid at computed-value time and the panel
  falls to `left: auto`.

**Why the wrapper is `display: flex` with no padding and no border.** A block wrapper around an
inline-block `<button>` establishes an inline formatting context, and the line box's strut leading
makes the wrapper measurably taller than the button — breaking AC1's "the button's top edge" and
overflowing `.composer__footer`'s hard `height: 20px`. Flex has no strut, so the anchor's box matches
the button's on all four edges; any padding or border on the anchor would equally detune AC1/AC2, since
`left`/`bottom` resolve against the element's *padding* box. `position: relative` on the anchor is what
makes `left`/`bottom` resolve against the button at all — without it they'd resolve against
`.conversation`, the next positioned ancestor (line 18), landing the panel somewhere in the chat pane.

Verified out-of-band the same way #838 was (no vitest detector exists for stylesheet declarations, per
the ruling at `ConversationScreen.test.tsx:1128-1132`): a throwaway Playwright harness loading the
repo's real `tokens.css`/`pairedShell.css`/`conversation.css` at an 800px viewport. One trap worth
keeping for the next ticket that reaches for this technique: **a `file://` stylesheet will not load
into a page put up with Playwright's `setContent`** — that page stays on `about:blank`, so the links
are cross-origin and silently dropped, and everything measures as though unstyled. `page.goto('file://…')`
loads them; assert `document.styleSheets.length` before trusting any measurement taken this way, since
an unstyled page measures fine, it just measures the wrong thing.

Code review PASS on both — #838's two non-blocking NITs above, and #839's two NITs (a stale line
reference in a coupling comment, and `window.innerWidth` vs. `document.documentElement.clientWidth` for
a scrollbar edge case neither worth fixing without a live consumer) — see
[PR #841](https://github.com/pyrycode/pyrycode-desktop/pull/841) and
[PR #843](https://github.com/pyrycode/pyrycode-desktop/pull/843).

**Interaction (#840).** Two pieces complete the panel: `composerOptionsKeyboard.ts`, a DOM-free total
function holding the whole keyboard contract, and `ComposerOptionsMenu`, an exported container in
`ComposerOptionsPanel.tsx` beside the view — the `ThreadOverflowMenuView`/`ThreadOverflowMenu` split
(`ConversationScreen.tsx:2653-2710`) extended rather than reinvented. Unlike `ThreadOverflowMenu` it is
exported: #680, #682 and #683 each import it from another file, so the ARIA contract lands once instead
of three times. **The trigger's behaviour and ARIA are the container's — `aria-haspopup="menu"`,
`aria-expanded`, the toggle `onClick` — its label and appearance stay the consumer's**, passed in as
`triggerContent` and `triggerClassName`. No `aria-label` goes on the trigger: `triggerContent` is
visible text ("Max", "Opus 5"), and an `aria-label` would override it and break WCAG 2.5.3's
label-in-name. State is component-local `useState` (`open`, `focusedIndex`), never the session store —
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)'s `sheetOpen` precedent —
so it resets to closed on remount for free.

`resolveComposerOptionsKey({ optionCount, focusedIndex, key })` returns a sealed
`{ type: 'focus' | 'pick' | 'dismiss' | 'ignore' }` union and is total: it never throws, every `focus`
index it emits is in `[0, optionCount)`, and `pick` is range-guarded so `options[index]` is always
addressable. Four decisions were settled explicitly rather than left to the implementation:

- **Focus opens on the current option, or the first when there is none** —
  `initialFocusedOptionIndex(options, currentId)`, one `findIndex` with `-1` falling back to `0`. A value
  menu (#682, #683) opens where the arrows should be relative to what it currently reads; a command list
  (#680, #694 — `currentId: null`) opens on its first entry; a **stale** id lands on the first entry
  through the identical branch, no special case, mirroring how the view already handles a stale
  `currentId` in its markup.
- **Arrows wrap.** `ArrowDown`/`ArrowUp` step by ±1 through `(((focusedIndex + delta) % optionCount) +
  optionCount) % optionCount` — the doubled modulo is load-bearing twice: `-1 % n` is negative in
  JavaScript, so the first `+ optionCount` is what keeps a wrap off the top addressing a real row, and
  the second `%` runs on a non-negative number, which is what rules out `-0` (`Object.is(-0, 0)` is
  `false`, so a negative zero passes every range check and only fails a later strict-equality
  assertion). The totality property test asserts `Object.is(index, -0) === false` explicitly rather than
  trusting the bounds — worth remembering for any future roving-index wrap.
- **`Enter` is intercepted; `Space` is not.** Enter must be, or the focused row's native button
  activation would fire `onSelect` a second time on top of the `pick`; Space returns `ignore`, runs no
  `preventDefault`, and the row's own `onClick` picks it — two paths to the same outcome, on purpose.
- **`Home`, `End`, `ArrowLeft`, `ArrowRight` and `Tab` fall through unhandled.** None is an acceptance
  criterion; Left/Right belong to a menubar that doesn't exist here, and Tab moving focus off the panel
  while it stays open is a deliberately open question for #680 to decide on a real user, not invented
  glue here.

**One keydown path, not two — a deliberate deviation from `ThreadOverflowMenu`.** That container
dismisses on Escape through a *document* listener because it never moves focus into its menu, so a
React handler on the wrapper would never see the key. `ComposerOptionsMenu` does move focus in via a
plain `useEffect` (`querySelectorAll('.composer-options__item')[focusedIndex]?.focus()`, optional-chained
throughout), so its own `onKeyDown` on the anchor `<div>` sees every keystroke — the trigger's and the
rows' both — and `event.preventDefault()` runs for every outcome except `ignore`, which is what stops
the arrows scrolling the thread and stops Enter double-firing. A document `mousedown` listener still
handles outside click, kept verbatim from `ThreadOverflowMenu`'s shape (attached only while open, torn
down on close and unmount, target narrowed with `instanceof Node`, read through
`DocumentEventMap['mousedown']` for the same shadowing reason `ConversationScreen.tsx:2681-2683`
records). One accepted deviation from a literal reading of "every close path returns focus to the
trigger": `close()`'s `.focus()` runs before the browser's own mousedown focus action, so on the
outside-click path focus lands where the user clicked rather than on the trigger. Code review
considered and did not flag this — the alternative (`preventDefault` in that handler) would also
suppress caret placement when the outside click is into the message box, the most likely outside click
there is, and `ThreadOverflowMenu` has shipped the identical shape since its own AC.

**Testing is split at the DOM boundary, deliberately.** `composerOptionsKeyboard.test.ts` executes the
whole keyboard contract with no DOM, including a totality property (every `optionCount` 1–5, every
`focusedIndex` from `-1` to `optionCount`, both arrow keys → a `focus` index always in range). The
markup half extends `ComposerOptionsPanel.test.tsx` with a `focusedIndex` parameter on `renderPanel`
(defaulted, so the eight pre-existing tests are untouched — the proof the change is additive), plus one
static-render assertion of the container's *collapsed* markup (`aria-haspopup="menu"`,
`aria-expanded="false"`, no `role="menu"` anywhere — reachable because `useState(false)` is what a
static render sees). **What has no detector**: the container's `useState` transitions, the document
listener and the focus calls are untested reviewed glue, the same ruling `ConversationScreen.test.tsx:2523-2528`
gives #276's container — `environment: 'node'` fires no clicks and runs no effects, and adding jsdom to
reach them is the separate, deliberate decision CLAUDE.md reserves. The in-app interaction proof rides
#680, the first consumer with a real trigger in a real footer.

Code review PASS with one deferred SHOULD FIX: the `switch (outcome.type)` in `handleKeyDown` has no
`default: return assertNever(outcome)`, the exhaustiveness-guard convention this repo otherwise applies
uniformly (`composerSend.ts`, `messageViewModel.ts`, `pairingState.ts`, and others). Its absence is
silent today — every outcome is handled — but a fifth outcome added later (the module's own docblock
names Home/End as a two-line follow-up) would be swallowed by the switch with no type error and no test
catching it, since the container is untested-by-design. Folding the guard into #680's first live mount
was the call recorded on the PR rather than a rework cycle here — worth doing at that point, not
forgotten. Two accepted NITs alongside it: `Enter` on a Shift-Tabbed-back trigger resolves to `pick`
rather than toggling the menu shut (unreachable without the still-open Tab question above, deferred to
the same ticket), and the container's trigger assertions don't yet pin `type="button"` the way the
panel's own row test pins it on each option — see
[PR #845](https://github.com/pyrycode/pyrycode-desktop/pull/845).

### Api-retry indicator (#493)

`ThinkingIndicator`'s twin over a third timeline-store scalar (`apiRetry: ApiRetryStatus | null`),
`ThinkingIndicator`'s **supersede peer** — a relationship carried entirely by `workingIndicatorState`
reading `apiRetry`/`compacting`, not by DOM adjacency, so it survived [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796)
moving `ThinkingIndicator`'s own markup down into the composer status row unchanged. Mounted immediately
after `Timeline` and before `StallIndicator`:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
├── ApiRetryIndicator           retry={useTimelineStore(selectApiRetry)}
├── CompactingIndicator         isCompacting={useTimelineStore(selectCompacting)} — #496, see below
└── StallIndicator              isStalled={useTimelineStore(selectStalled)}
                                 (ThinkingIndicator itself moved to the composer status row by #796 — see above)
```

The daemon emits `api_retry` when claude hits an API error and retries, carrying an explicit
`active`/`current`/`total` counter ([#492](../codebase/492.md) decodes it into a non-nullary `apiRetry`
`DaemonEvent`). Unlike `stall`, the frame has an **explicit falling edge** (`active: false`) and no
wire-side dedup — the rising edge re-fires as the count climbs, and a verbatim repeat is a same-state
no-op rather than a re-render. `reduceTimeline` holds the live counter as `ApiRetryStatus | null`,
cleared only by the falling edge — turn activity (`assistantDelta`/`toolUse`/`toolResult`/`turnState`)
leaves it showing, the deliberate inverse of `stalled`'s self-clear.

`ApiRetryIndicator({ retry })` is `StallIndicator`'s structural twin: pure, exported, in-file,
server-rendered from an injected `ApiRetryStatus | null`. `retry === null` → `null` (zero footprint);
present → a `flex: 0 0 auto` `.conversation__api-retry` wrapper (`.conversation__stall`'s shape) holding
`<div className="bubble bubble--daemon bubble--api-retry">API error — retrying…</div>`, plus, when
`retry.total > 0`, a nested `<span className="api-retry__counter"> attempt {current}/{total}</span>`.
When the counter is unknown (`current`/`total` both `0`) the span is omitted entirely — no `"0/0"` is
ever rendered, and the count is never computed as a fraction (`current / total` would be `NaN` at
`0/0`).

**Record input, not a boolean — the same AC1 posture as #215/#317, adapted for a counter.** The prop is
`ApiRetryStatus | null` (two numbers, no string field), never the store's `TimelineState` or the raw
`ThreadEvent`, so "no daemon-supplied string is ever rendered" stays a type-level guarantee even though
this view — unlike `StallIndicator` — does render daemon-derived digits.

**Visually distinct from both siblings.** `.bubble--api-retry` reuses `.bubble--daemon`'s fill/radius
and diverges to `--color-error` text (the same error role as `.bubble--stall`) but **omits** the left
accent bar that is `.bubble--stall`'s distinguishing mark — keeping the two problem states separable
from each other. Through #796 both were also distinct from the muted `.bubble--thinking`; since #796
retired that class, the comparison point is the composer status row's label instead, which now reads in
`--color-primary` rather than muted — still a distinct role from either problem state's `--color-error`.
No new design token.

May still co-render with `StallIndicator` (and, since #496, `CompactingIndicator`) — AC5 scopes mutual
exclusion to `ThinkingIndicator` only, #317's "distinct facts, adjacent flex rows" posture for stall is
unchanged. No Figma node (same documented gap as #215/#277/#279/#305/#317); a dedicated degraded-state
visual remains a Figma-side follow-up for Juhana. See
[#493 codebase notes](../codebase/493.md) for the full design, patterns established, and open questions.

### Compacting indicator (#496)

`ThinkingIndicator`'s **second** supersede peer, over a fourth timeline-store scalar (`compacting:
boolean`), mounted immediately after `ApiRetryIndicator` and before `StallIndicator` — through #796 this
grouped the two thinking-superseders (#493, #496) contiguously below the indicator they occlude; since
[#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) moved `ThinkingIndicator`'s markup into
the composer status row, this trio is contiguous below `Timeline` instead, unaffected in every way that
matters — the supersede relationship lives in `workingIndicatorState`, not DOM position:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
├── ApiRetryIndicator           retry={useTimelineStore(selectApiRetry)}
├── CompactingIndicator         isCompacting={useTimelineStore(selectCompacting)}
└── StallIndicator              isStalled={useTimelineStore(selectStalled)}
```

The daemon emits `compacting` while claude auto-compacts its context — tens of seconds of total
silence on the content channel ([#495](../codebase/495.md) decodes it into a non-nullary `compacting`
`DaemonEvent`, `{ active: boolean }`, no counter). Like `apiRetry`, the frame has an **explicit falling
edge** and no wire-side dedup, but carries no progress data at all — banner-only. `reduceTimeline` holds
the live state as a plain `boolean` (not `| null`: there's no counter to discard on clear, so a boolean
is the honest representation), cleared only by the falling edge — turn activity leaves it showing, the
same deliberate inverse of `stalled` that `apiRetry` established.

`CompactingIndicator({ isCompacting })` is `StallIndicator`'s structural twin: pure, exported, in-file,
server-rendered from an injected boolean, not a record — there are no digits to render, so (unlike
`ApiRetryIndicator`) a boolean prop is sufficient to make "no daemon-supplied string is ever rendered" a
type-level guarantee. `isCompacting === false` → `null` (zero footprint); `true` → a `flex: 0 0 auto`
`.conversation__compacting` wrapper (`.conversation__api-retry`'s shape) holding `<div className="bubble
bubble--daemon bubble--compacting">Compacting the conversation…</div>`. `COMPACTING_COPY` is exported,
apostrophe-free, ends in U+2026, and is asserted distinct from `'Thinking…'`/`STALL_COPY`/
`API_RETRY_COPY`.

**Compaction is progress, not a problem — deliberately does not reuse the error role.**
`.bubble--stall` and `.bubble--api-retry` both use `--color-error` because both signal a degrading
session; compaction is claude working normally, so `.bubble--compacting` instead uses the muted
`--color-on-surface-variant` text treatment — through #796 this matched the daemon-bubble surface's own
`.bubble--thinking` — with a left accent bar in the **primary** role (`--color-primary`,
`.bubble--stall`'s bar structure with the error role swapped out). Through #796 this completed a four-way
text-role × left-bar matrix with every cell distinct: thinking (muted/no-bar), stall (error/error-bar),
api-retry (error/no-bar), compacting (muted/primary-bar). **Since [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796)
retired `.bubble--thinking`** and moved the working label off the daemon-bubble surface entirely (see
[Composer status row](#composer-status-row-796) above, where the label's own colour also changed, to
`--color-primary`), this is now a three-way matrix among the indicators that stayed behind: stall
(error/error-bar), api-retry (error/no-bar), compacting (muted/primary-bar) — `.bubble--compacting`'s own
rule is untouched, and the muted register it picked still reads correctly on its own terms even though the
class it was originally matched against is gone. No new design token — the matrix was already saturated
on both axes with four cells; three leaves headroom for one more before a third visual axis is needed.

May co-render with `ApiRetryIndicator` and `StallIndicator` — AC4 scopes exclusion to `ThinkingIndicator`
only, the same #493 posture. No Figma node (same documented gap as #215/#277/#279/#305/#317/#493). See
[#496 codebase notes](../codebase/496.md) for the full design, patterns established, and open questions.

### Stall indicator (#317)

`ThinkingIndicator`'s own twin, over a second timeline-store scalar (`stalled: boolean`); through #796
mounted immediately after `ThinkingIndicator` in the DOM, now mounted last of the three problem-state
indicators that stayed behind when [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) moved
`ThinkingIndicator`'s markup into the composer status row — kept its own bubble treatment and
null-at-rest posture, which is exactly why `thread-scroll-pin.spec.ts`'s viewport-shrink criterion was
repointed onto this indicator rather than the one it used to sit beside (see [Composer status
row](#composer-status-row-796) above and the **Thread scroll pin** edge case below):

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
├── ApiRetryIndicator           retry={useTimelineStore(selectApiRetry)} — #493, see above
├── CompactingIndicator         isCompacting={useTimelineStore(selectCompacting)} — #496, see above
└── StallIndicator              isStalled={useTimelineStore(selectStalled)}
```

The daemon emits a one-shot `stall` signal when claude goes quiet mid-turn or the screen parser
degrades ([#315](../codebase/315.md) decodes it into a `stallDetected` `DaemonEvent`, nullary at ship
time and later widened with `conversationId` by [#732](../codebase/732.md); the id stops at the
renderer timeline bridge, so this view is unaffected). Because
the daemon sends onset-only with no "cleared" frame, `reduceTimeline` self-clears the `stalled` scalar
client-side on the next turn-activity event (`assistantDelta`/`toolUse`/`toolResult`/`turnState`) —
this view only renders whatever the store currently holds. `StallIndicator({ isStalled })` is
`ThinkingIndicator`'s structural twin: pure, exported, in-file, server-rendered from an injected
boolean. `isStalled === false` → `null` (zero footprint); `isStalled === true` → a `flex: 0 0 auto`
`.conversation__stall` wrapper (`.conversation__thinking`'s shape) holding `<div className="bubble
bubble--daemon bubble--stall">The turn seems to have stalled…</div>` — the daemon-bubble surface,
diverging to the error role rather than the muted thinking treatment.

**Boolean input, not the store type — the same AC4 posture as #215.** The prop is `isStalled:
boolean`, never the store's `TimelineState`, so "no daemon-supplied string is ever rendered" is a
type-level guarantee, reinforced here by the daemon frame carrying no content to begin with (#315's
nullary emit) — there is no field to leak even if the type were looser.

**Visually distinct by design (AC4).** `.bubble--stall` reuses `.bubble--daemon`'s fill/radius but
diverges to `--color-error` — `color: var(--color-error)` plus a leading `border-left: 4px solid
var(--color-error)` accent (the connection-banner/rejection-line precedents) — so a stall reads as a
problem state. Through #796 that distinguished it from the muted `.bubble--thinking`; since #796 retired
that class, the comparison point is the composer status row's own label, which now reads in
`--color-primary` — still never confusable with `--color-error`. No new design token; `--color-error`
is the only error-role token on desktop.

Both indicators can show at once (a stall onset arriving mid-`thinking`) — accepted as correct, since
they occupy adjacent flex rows and convey different facts; no mutual-exclusion coordination was built.
**[#493](../codebase/493.md) narrowed `ThinkingIndicator`'s own gate to also exclude a live api-retry
status (see [Api-retry indicator](#api-retry-indicator-493) above), and [#496](../codebase/496.md)
narrowed it again to exclude a live compaction status (see [Compacting
indicator](#compacting-indicator-496) above), but both left this stall/thinking co-render posture
untouched** — AC5/AC4 each scoped mutual exclusion to thinking only, so `StallIndicator`,
`ApiRetryIndicator`, and `CompactingIndicator` may all show at once. No Figma node (same documented gap
as #215/#277/#279/#305 — the mobile file draws only the populated steady-state thread, node `16-8`). See
[#317 codebase notes](../codebase/317.md) for the full design, patterns established, and open
questions.

`Timeline`'s `toolCall` arm gained its pending render in [#218](../codebase/218.md): a compact chip —
tool name and one-line input summary — replaces the earlier `case 'toolCall': return null` no-op, at
50% opacity for the unresolved (`result: null`) state. [#230](../codebase/230.md) later taught the
same arm to resolve that chip in place once `result` fills. Both were dormant until
[#179](../codebase/179.md); now live. See
[Pending tool-call row](#pending-tool-call-row-218) and
[Resolved tool-call row](#resolved-tool-call-row-230) below.

### The open-conversation reader cutover (#758)

Every tree above this point reads `useTimelineStore(select*)` — the flat, single-conversation store.
As of this ticket none of them do: the six reads (`items`, `phase`, `stalled`, `apiRetry`, `compacting`,
`localSendPending`) collapse into one subscription to the [conversation timeline
holder](conversation-timeline-holder.md)'s `selectTimelineFor(openConversationId)`, and `TimelineRow`,
`Timeline`, `ThinkingIndicator`, `ApiRetryIndicator`, `CompactingIndicator`, and `StallIndicator` all keep
their existing signatures and every line of JSX under them — the six local names destructured out of the
slice are `TimelineState`'s own six field names, so the diff is the read block and the import block only,
not the render tree. This is what makes leaving a chat and coming back show that chat's thread as it now
stands (Figma node 132-4171 redraws nothing; the anchor being rebound is the surface, not the shapes):
`activateConversation.ts`'s flat-store reset still fires on every switch, but now fires into a store
nothing renders from, while the per-conversation slice in the holder keeps whatever arrived while the
operator was elsewhere.

`activeConversation` (`useActiveConversationStore(selectActiveConversation)`, already read here since
[#278](#workspace-chip-278)) moved above the timeline read, because the timeline read now needs its id —
same hook, same selector, same single subscription, only its position in the hook list changed. The id
is derived as `activeConversation?.id ?? null` (the `:281`/`:1955` spelling this file already used), then
run through a `useMemo`-stable selector so a fresh closure per render does not churn the subscription:

```ts
const selectOpenTimeline = useMemo(() => selectOpenTimelineFor(openConversationId), [openConversationId])
const openTimeline = useConversationTimelineStore(selectOpenTimeline)
const thread = openTimeline === null ? initialTimelineState : openTimeline
const { items, phase, stalled, apiRetry, compacting, localSendPending } = thread
```

`selectOpenTimelineFor` (exported from `ConversationScreen.tsx`) branches on the id rather than
substituting a sentinel: `null` in → the module-level `selectNothingHeld` (`(): null => null`, a stable
identity, no map lookup at all); an id in → `selectTimelineFor(id)`. **This is deliberately not
`selectTimelineFor(openConversationId ?? '')`** — [Background-task
panel](#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)'s idiom, safe
there and not here: `''` is an ordinary key in the holder (`dispatchFor` mints a slice for whatever
`conversation_id` the daemon asserts, `''` included), so a hostile or buggy daemon emitting one frame
with an empty `conversation_id` would plant a slice the sentinel spelling would then render as the open
conversation's thread while nothing is open. Branching to `selectNothingHeld` makes that misattribution
structurally unavailable rather than merely unlikely — see the architecture spec's security review
(`docs/specs/architecture/758-open-conversation-timeline-reader.md`) for the full reasoning.

The `openTimeline === null` branch means **no conversation is open**, not "the open one has no rows": by
the time this renders, [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786)'s `markViewed` has
already created the open conversation's slice at the activation seam, so an open conversation always has
one. The reachable `null` cases are the nullary notification `open` before any conversation was activated
([Paired shell](paired-shell.md)) and a bare `<ConversationScreen />` in a test — both resolve to the same
shipped empty thread (`Timeline`'s existing zero-`items` render), which is AC3's "empty thread that fills
from the next live event," not a new empty state.

`InterruptControl` (see [Interrupt envelope § The render
affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678)) took
`phase: TurnPhase` as a required prop from the container instead of its own
`useTimelineStore(selectPhase)` subscription — the seventh read this ticket enumerates, wired the same
way rather than duplicating the id derivation and the memoised selector in a second component. Its one
mount became `<InterruptControl phase={phase} />`; `window.pyry.sendCommand` stayed dereferenced only
inside its click closure, never during render. **`InterruptControl` itself is gone as of
[#678](https://github.com/pyrycode/pyrycode-desktop/issues/678)**, which folded the affordance into
`Composer`'s own send button — the same `phase` prop this section describes now reaches `<Composer
phase={phase} onMessageSent={followBottom} />` instead, one line below.

**Nothing else changes.** The flat `timelineStore` stays imported (the composer's `dispatch` write at
`composerSend.ts`) and stays dual-written by the bridge fan-out and the composer's echo; retiring it is
its own ticket. See [Conversation timeline holder § The open-conversation reader
cutover](conversation-timeline-holder.md), [Conversation timeline
store](conversation-timeline-store.md), and
[#758 spec](../../specs/architecture/758-open-conversation-timeline-reader.md) for the full design, the
security review, and the AC-by-AC test scenarios (`ConversationScreen.test.tsx`'s `store binding`
describe) and `e2e/conversation-switch-keeps-both-threads.spec.ts` for the end-to-end proof.

### Pending tool-call row (#218)

The render half of the `toolCall` `ThreadItem` (the transport half, [#217](../codebase/217.md), decodes
the daemon's `tool_use` stream into the item; this ticket only teaches `TimelineRow` to draw it).
Split from #205 alongside #217, mirroring the transport/render split every #199-family slice has taken.

`TimelineRow`'s `case 'toolCall'` (previously `return null`) now renders a compact bordered chip —
Figma node `16:28` — left-aligned in the thread, in the reducer's arrival order beside the
`assistantText` bubbles:

```html
<div class="tool-row">
  <div class="tool-row__chip" data-thread-role="tool">
    <span class="tool-row__name">{item.name}</span>
    <span class="tool-row__summary">{item.inputSummary}</span>
  </div>
</div>
```

(The second run's text source changed under [#705](#collapsed-tool-row-headline-705) — see below; the
element, classes and escaping posture described here are unchanged.)

`name` and `inputSummary` — the daemon's untrusted `tool_use` précis, flagged for plain-text-only
rendering back at the #217 decode boundary — are React children (auto-escaped), never
`dangerouslySetInnerHTML`, the identical posture to the `assistantText` arm one case up.
`data-thread-role="tool"` (not `"assistant"`) is the render's own test hook and deliberately keeps
`threadBubbleCount` (which matches only `"assistant"`) at 0 for tool rows — a tool row is not a
message bubble. `Timeline`'s array-index key strategy is untouched; `toolUseId` stays on the item,
unread here, reserved for [#206](https://github.com/pyrycode/pyrycode-desktop/issues/206)'s result
correlation.

This is the **pending** (`result: null`) treatment only — the whole `.tool-row` sits at 50% opacity,
the unresolved-state dimming. #206 (later split into transport #229 + render #230) fills `result` and
owns lifting (or overriding) that dimming plus the success/error visual; this ticket's chip styling
stays untouched by that follow-up. Every value in the three new `.tool-row*` CSS rules is a token
(`--font-mono`, `--color-tertiary`, `--color-surface-container`, `--color-outline-variant`,
`--color-on-surface-variant`, `--text-body-small-*`, `--space-2`/`--space-3`, `--radius-sm`) — no
hex/rgb/px literal. Was dormant until [#179](../codebase/179.md) flipped `interactive` (no `tool_use`
frames arrived while it was off, the same posture as `Timeline`/`ThinkingIndicator`); now live. See
[#218 codebase notes](../codebase/218.md) for the full design and patterns established.

### Resolved tool-call row (#230)

The render half of the `toolResult`-fills-`toolCall` correlation (the transport half,
[#229](../codebase/229.md), decodes the daemon's `tool_result` stream and resolves the item's
`result` in place via `fillResult`, #121; this ticket only teaches `TimelineRow` to draw the filled
state). Split from #206 alongside #229, the vertical's **last** render slice — extends #218's pending
chip rather than adding a new component.

`TimelineRow`'s `case 'toolCall'` now reads `item.result` (`ToolResult | null`) and derives the
wrapper `className`; the chip's inner markup — the two spans — is **byte-identical** to #218:

```html
<!-- result === null (unchanged) -->
<div class="tool-row"> … </div>

<!-- result filled, isError: false -->
<div class="tool-row tool-row--resolved"> … </div>

<!-- result filled, isError: true -->
<div class="tool-row tool-row--resolved tool-row--error"> … </div>
```

`tool-row--resolved` lifts the pending 50% dimming (`opacity: 1`) for **both** outcomes — the
resolved-success treatment is exactly the mock's chip with the dimming lifted, no accent added.
`tool-row--error` layers on top only when `result.isError`, retinting `.tool-row__chip`'s border from
the neutral `--color-outline-variant` to a new token, `--color-error` (`#ffb4ab` — M3 default dark
error role, tone 80; desktop's **first** error-family token, mirrored from the same M3 scheme
`tokens.css`'s header names as the palette's source, since no Figma node in this file references an
error scheme to copy from directly). `result.resultSummary` is **deliberately not rendered** — the
Figma mock has no result-text slot, and not-surfacing it (rather than surfacing-then-escaping) keeps
the untrusted-text surface at exactly `name` + `inputSummary`, unchanged from #218. `Timeline`'s
array-index key strategy is untouched: `fillResult` replaces the `toolCall` at its own index, so a
resolving row never remounts.

Was dormant until [#179](../codebase/179.md) flipped `interactive`, the same posture as every other
structured-stream render slice; now live. See [#230 codebase notes](../codebase/230.md) for the full
design, the token-provenance rationale, and patterns established.

### Expandable tool-call result (#696, toggle #697)

#230 shipped resolved/error chip styling but deliberately did not surface `result.resultSummary` — no
result-text slot existed in the Figma mock. #696 reversed that: `ToolRow` was extracted out of
`TimelineRow`'s `toolCall` arm (`case 'toolCall': return <ToolRow item={item} />`, both signatures
otherwise untouched) and gained a body, a sibling of the chip rather than a child (the chip is a
single-line `inline-flex; overflow: hidden` pill — nesting a stacked body inside it would force a new
wrapper and break the collapsed markup):

```html
<div class="tool-row tool-row--resolved tool-row--expanded">
  <button type="button" class="tool-row__chip tool-row__chip--toggle" data-thread-role="tool"
          aria-expanded="true">
    <span class="tool-row__name">{item.name}</span>
    <span class="tool-row__summary">{item.inputSummary}</span>
  </button>
  <pre class="tool-row__result">{result.resultSummary}</pre>
</div>
```

(As above, the second run's text source is [#705](#collapsed-tool-row-headline-705)'s picker, not raw
`inputSummary`, as of that ticket.)

`const body = expanded ? result : null` drives both the wrapper's `tool-row--expanded` modifier and the
body element, so a pending row (`result === null`) is structurally incapable of showing a body no matter
what the flag says. The result text's only sink is `<pre>` text children (`white-space: pre`, so
daemon-emitted newlines survive — the machine-output side of the same reflow-vs-preserve rule
`.unrecognized-row__raw` established), bounded to `max-height: 240px` + `overflow: auto` (that literal
copied from `.unrecognized-row__raw`, the file's only other `overflow: auto` result body — **neither has
a `tabindex`**, a known pre-existing gap in both, not yet fixed). An empty result
(`resultSummary === ''`, exact) renders the client-owned `TOOL_RESULT_EMPTY_COPY` ("No output") instead
of a blank gap; an error result gets its own `tool-row__body--error` modifier on the body container,
independent of the pre-existing `tool-row--error` on the chip's wrapper.

**#696 shipped the body with no way to reach it** — the production call site passed no `expanded` flag,
so the branch existed only for the DOM-less `renderToStaticMarkup` test tier to exercise directly (this
repo's unit tier has no jsdom/happy-dom/@testing-library — see `e2e-harness.md` — so nothing there could
ever click). **#697 supplied the control.** The chip on a *resolved* row becomes the disclosure control
itself — the Figma pill (node `16-28`, chip `16-29`) has two runs and no third slot, so the whole pill
forks between a `<div>` (pending) and a real `<button aria-expanded>` (resolved), gated on `result`, the
same condition the wrapper's `--resolved` modifier already reads. A pending row keeps its original `<div
className="tool-row__chip" data-thread-role="tool">` byte-for-byte and offers no affordance at all —
"activated while pending" is unreachable rather than guarded. The prop that controls the body
(`ToolRow`'s `expanded`) was renamed `defaultExpanded` at the same time: under #696 it was a controlled
value; under #697 the toggle owns a component-local `useState(defaultExpanded)` and the prop is only the
mount-time initial value, so the old name would have been a quiet lie about what a re-render could do.

**Where the boolean lives is the interesting design call**, and it's the same shape
the repo's other expand/collapse row, `UnrecognizedRow`, has shipped with since it landed —
component-local `useState`, not a hoisted `toolUseId`-keyed set on the screen container,
per [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)'s "lowest scope that
resets correctly." It resets for free rather than by explicit teardown: `Timeline`'s array-index key
strategy plus `fillResult`'s in-place `items.map` replacement (never insert, never reorder — [ADR
0008](../decisions/0008-thread-timeline-model.md)) keep a row's component instance — and its boolean —
bound to one logical tool call across its whole pending → resolved life, and a thread `reset` empties
`items` to `[]`, unmounting every row (including across the in-thread `conversation_created` reset path
that leaves the screen mounted, `activateConversation.ts:93`). No row can inherit another's expansion,
and none survives a reset, with nothing to clear explicitly.

One additive CSS rule, `.tool-row__chip--toggle` (appended after `.tool-row__chip`, which is not
edited), supplies only what a UA `<button>` would otherwise inject or override — `font-family:
var(--font-sans)` (load-bearing: `.tool-row__summary` inherits it from `.conversation` and a bare
`<button>` would silently re-parent that to the UA font), `color`, `text-align: left`, `box-sizing:
content-box` (a UA button defaults to border-box; holding content-box keeps both chip branches bounded
identically so a resolving row doesn't shift width), `cursor: pointer` and a hover tint lifted from
`.unrecognized-row__summary`. Deliberately silent on `border`, so `.tool-row--error .tool-row__chip`'s
higher-specificity border retint keeps winning on failed rows.

**Security posture (both tickets).** `name`, `inputSummary`, `toolUseId` and `resultSummary` are all
daemon-supplied and untrusted; the only sanctioned sink is React text children, never
`dangerouslySetInnerHTML`, never `AssistantMarkdown` (which would let a daemon-relayed result emit an
`<img src>` beacon from a privileged renderer), never an attribute, a log line, or a lookup key. #697's
control makes this posture load-bearing rather than belt-and-braces — it is the first ticket that makes
the result text reachable in the shipped product — and declines five specific attribute/log sinks a
disclosure control invites (`aria-label`, `aria-controls`/`id`, `title`, a toggle diagnostic, and
enriching the body through markdown); see the `SAFETY` comment block in `ConversationScreen.tsx` and
[#697 codebase notes](../codebase/697.md) for the full walk.

See [#696 codebase notes](../codebase/696.md) and [#697 codebase notes](../codebase/697.md) for the full
design, testing strategy, and patterns established.

### Collapsed tool-row headline (#705)

`inputSummary` was never designed as a headline — it's the daemon's whole tool input squeezed onto one
line and cut for length, so for an `Edit` that is mostly replacement text the file path was usually
truncated away entirely. #705 replaces the chip's second run with a headline picked from the tool's own
input fields (`item.input?: Readonly<Record<string, string>>`, carried onto the item since #642/#643),
falling back to `inputSummary` when nothing in `input` qualifies. No markup, class or CSS changed — only
the text of `.tool-row__summary`, in both the pending `<div>` and the resolved `<button>` (both read the
same `chipRuns` fragment, declared once in `ConversationScreen.tsx`), so this section supersedes the
`{item.inputSummary}` shown above wherever the second run's *content* is concerned.

`toolHeadline(source)` (`src/renderer/src/screens/conversation/toolHeadline.ts`) is one fallback chain,
deliberately dumb — the expanded body ([#696/#697](#expandable-tool-call-result-696-toggle-697), and
[#706's per-field list](#full-input-field-list-706)) is one click away, so a wrong guess costs almost
nothing, which is the argument against a smarter classifier here:

1. `name === 'Bash'` exactly → `description`, else `command`. The fallback is load-bearing: measured
   over 6459 real `Bash` calls, 1397 (22%) carry no `description` at all.
2. Otherwise the first present, non-empty match in a fixed order: `file_path`, `path`, `notebook_path`,
   `command`, `pattern`, `url`, `query`, `description`.
3. Otherwise the first non-empty entry of `input`, in iteration order, whose value contains no line
   break — this is what makes MCP tools work, since their input names (`symbol`, `fileKey`, `nodeId`, …)
   mostly aren't on any fixed list.
4. Otherwise `inputSummary`, exactly as before #705.

Rule 1 is a precedence *override* for one tool name, not a terminal branch — when it selects nothing the
chain falls through into rule 2, which is what makes "never blank" structural. Every rung requires a
value that is present and `!== ''` (never `.trim() !== ''` — a real but unobserved residual, left
unguarded per the ticket's own "don't improve the picker without new data" instruction). `input` absent
and `input: {}` read identically: rules 1–3 have nothing to look at either way, so both fall through to
rule 4 — the distinction between "pre-#642 daemon" and "daemon sent no fields" survives at the item but
is not surfaced in the row.

**Shortening is keyed on the field name the value came from, not on which rule fired.** [#644](../codebase/644.md)'s
`shortenPath` runs only when the key is `file_path`, `path` or `notebook_path`; a `Bash` command line, a
`pattern`, a `url`, a `query`, a `description` and a rule-3 catch-all all render unshortened — shortening
a command line or a search pattern would mangle it into something that reads like a path and is not one.
`shortenPath` itself stays a total function of one string that never decides *whether* its argument is a
path; #705 is its first caller, and the doc comment it shipped with (describing a `kind`/`subject` shape
that never made it onto the wire) was corrected in the same PR, comment-only.

**Security posture**, extending #697's SAFETY block rather than restating it: the headline reaches the
DOM only as auto-escaped React children of the same `.tool-row__summary` span that carried `inputSummary`
before it — never `title=` (a natural next edit once shortening visibly discards information, and
forbidden by CLAUDE.md's 2026-08-20 ruling), never linkified through `AssistantMarkdown` (rule 2 can
promote a field literally named `url` into the render path), and the picked *value* only — never the
input *key*, which is daemon-controlled display text too and drawing it is #706's separately reviewed
call. No log line names the picked field or its value (ADR 0007's content-free rule).

Wire facts this rests on ([#642](../codebase/642.md)'s spec, not the daemon ticket):
key order on the wire is alphabetical (a Go map-marshalling artefact, so rule 3's order is deterministic
per call); every value is already a string daemon-side, so `null`/`true`/`[1,2]` can arrive as those
literal strings and rule 3 can land on one (an accepted miss — #706's field list covers the rest); the
map may be incomplete (the daemon's 8500-rune total bound drops fields and names none), which is why rule
4 keeps `inputSummary` as the whole-input fallback rather than retiring it; and a daemon-truncated value
ends in `…` and renders that way.

See [#705 codebase notes](../codebase/705.md) for the full design, the `noUncheckedIndexedAccess` trap
(off in `tsconfig.web.json`, so `input[key]` types `string` while being `undefined` at runtime for an
absent key), and patterns established.

### Full input field list (#706)

The headline (#705) picks one field; this ticket lists all of them, literally, in the expanded body
([#696/#697](#expandable-tool-call-result-696-toggle-697)) — the form that covers the headline's misses.
Every entry of `item.input`, name above value, in arrival order, above the unchanged result block:

```html
<div class="tool-row__body">
  <div class="tool-row__input">
    <span class="tool-row__input-name">{name}</span>
    <pre class="tool-row__input-value">{value}</pre>
  </div>
  <!-- … one per entry … -->
  <pre class="tool-row__result">{result.resultSummary}</pre>
</div>
```

`listedInputFields(item)` — since [#780](#shell-command-code-block-780) moved the entries call out of the
render tree and into `toolBody.ts` — is `Object.entries(item.input ?? NO_INPUT_FIELDS)`, filtered for a
`Bash` call only (below). No `.sort()`, no path shortening, no salience pick, and — for every tool but
`Bash` — no skipping the field #705's headline already promoted: literal is the whole point, since a field
silently missing from a "full input" list is worse than one repeated in both places. `NO_INPUT_FIELDS` is
a named `Readonly<Record<string, string>> = {}` module constant (now declared in `toolBody.ts`, moved with
the entries call it exists for), not a bare `{}` literal at the call site: the bare form widens the union
`Object.entries` sees and silently resolves it to the `any`-valued overload (neither
`noUncheckedIndexedAccess` nor `exactOptionalPropertyTypes` is on in this repo, so nothing else catches it).

**No list-wrapper element, no `.length > 0` guard.** The per-field `<div class="tool-row__input">`s are
direct children of the body; zero entries renders nothing. This is what makes "an absent, empty, or (since
#780) fully carved-out `input` all render no field list and no empty container" structural rather than a
second condition that could drift from the render — #643's absent-vs-`{}` distinction survives only at the
item, and the *display* decision that all three draw nothing is made once, in `listedInputFields`.

**One carve-out, added by #780, that does not weaken the rule above.** A `Bash` call's list drops
`description` and `command` — see [Shell command code block (#780)](#shell-command-code-block-780) for why
that is "promoted elsewhere in the body," not "silently missing from it," and why the carve-out is keyed
on the tool name and not on which field the headline happened to pick.

**The value is a `<pre>`** (line breaks preserved, the `.tool-row__result` newline-handling precedent);
**the name is a `<span>`**, mono but `--color-on-surface-variant` — the muted label colour
`.tool-row__summary`/`.tool-row__empty` use, not `--color-tertiary` (reserved for the tool's own
identity) — with `word-break: break-word` stated explicitly, since `.tool-row` is not a `.bubble`
descendant and a field name (no spaces, unlike a value) would otherwise widen the row unbounded. CSS-wise,
`.tool-row__input-value` **joins** the existing `.tool-row__result` selector rather than copying its ten
declarations, so "the field list takes the result block's visual language rather than inventing a third"
(the same answer #696 gave to the same "no expanded-state Figma frame" gap) is a fact by construction. The
failed-tool accent (`.tool-row__body--error .tool-row__result`, a descendant selector naming
`.tool-row__result` alone) gains nothing from that join — the field list stays untinted on a failed tool,
deliberately: a failed tool's *input* is not itself an error.

**Security posture**, extending #697's SAFETY block a second time: unlike #705, this ticket *does* draw
the input **key**, for the first time — a name is exactly as daemon-controlled as the value beside it (an
MCP tool can name a field anything), so both reach the DOM only as auto-escaped React children, never
`AssistantMarkdown`, never `title=`, never a linkified `url` field, never a log line. `key={name}` on the
wrapping `<div>` is a React reconciliation identity, never serialised to the DOM and not a new exposure —
the same string is already rendered as a visible text child beside it.

See [#706 codebase notes](../codebase/706.md) for the full design, the `Object.entries`-on-a-union
TypeScript trap, the arrival-order test lesson, and patterns established.

### Shell command code block (#780)

The headline (#705) already reads a `Bash` call's `description` (or falls back to `command`), and the
field list (#706) already listed `command` a second time as a plain value beneath it — so opening a shell
call showed the sentence the headline already said, and showed its command, the thing the row was opened
for, as a name/value row rather than as code. #780 promotes the command into a code block leading the
body and drops both `description` and `command` from the list beneath it, keyed on the tool name being
exactly `Bash` — the same `===` test `toolHeadline.ts` rule 1 already uses for its `description`/`command`
precedence override.

**Why the carve-out doesn't break #706's rule.** #706's list exists to cover the headline's misses, so a
field silently missing from it is worse than one repeated. That's true for every tool whose headline is a
*guess* — but `Bash`'s headline is not a guess: `firstNonEmpty(input, BASH_FIELDS)` on `description` then
`command` never falls through past a non-empty `description`, so a non-empty `description` is *always* on
the headline and a non-empty `command` is *always* in the block. Neither carved-out field is ever silently
missing — both are promoted elsewhere in the same body. Every other tool, including `BashOutput` (a real,
distinct tool name), keeps the unfiltered list; the `===` test is what buys that for free instead of as a
second guard.

Two new pure, framework-free functions in `src/renderer/src/screens/conversation/toolBody.ts` — the
expanded body's counterpart to `toolHeadline.ts` (the collapsed row's), and for the same reason: the
renderer test tier is `renderToStaticMarkup` string assertions with no DOM, so a rule expressed inside the
component could only ever be asserted through markup, while here each rule is a value in and a value out:

```ts
export function shellCommandBlock(source: ToolBodySource): string | null
export function listedInputFields(source: ToolBodySource): readonly (readonly [string, string])[]
```

`shellCommandBlock` returns the command for a `Bash` call carrying a non-empty `command`, and `null` in
every other case — not-`Bash`, no `input`, no `command`, `command === ''` — collapsed into one value
rather than a status, so the render-site guard is `command !== null` and an empty bordered box is
structurally unreachable rather than conditionally avoided (`AssistantMarkdown.tsx`'s `language !== null`
guard is the precedent this borrows). `listedInputFields` is `Object.entries(input ?? NO_INPUT_FIELDS)`,
filtered by `.includes(name)` against `['description', 'command']` — an exact-name test, never
`startsWith`, so `command_timeout` / `commands` / `description_url` all survive — and only when the tool
is `Bash`; every other tool's entries pass through untouched. Both functions route their tool-name check
through one private predicate reading `BASH_TOOL_NAME`, **imported from `toolHeadline.ts`, never
re-declared**: which tool is the shell tool is genuinely one fact, and the coupling is load-bearing — the
carve-out's whole safety argument is that *this same tool's* headline is a fixed rule, so if the name ever
diverged between the two files the list would drop `description` from a call whose headline no longer
promoted it. The two-field omission list (`OMITTED_SHELL_FIELDS`) is declared independently of
`toolHeadline.ts`'s own `BASH_FIELDS`, even though both hold `['description', 'command']` today — a probe
*order* and an omission *set* are unrelated facts, and deriving one from the other would let a future
reorder of the picker silently change what the body draws (the `PREFERRED_FIELDS`/`PATH_FIELDS` precedent
one file over).

`ToolRow` renders the block as the body's first child, above the field list and the result:

```html
<div class="code-block">
  <pre class="code-block__body">{command}</pre>
</div>
```

The same two elements and the same two classes `AssistantMarkdown.tsx`'s `pre` override emits for a fenced
block in a message (see [Assistant markdown renderer](assistant-markdown-renderer.md)) — no
`.code-block__header` (AC1 forbids a language header, and #721's divider is a `border-bottom` on the
header specifically so a headerless block draws no doubled edge) and no `<code>` child (nothing here needs
a `language-*` class, and the `.code-block__body, .code-block__body code` font-mono pair already applies
to a bare `<pre>`). Sharing the classes rather than extracting a component is what makes "a later restyle
of one lands on both" a CSS-only fact — the same way #721 itself shipped as a pure CSS restyle across zero
TSX files.

**The chrome's wrapping pair didn't travel with the classes, and that was the one real trap.**
`white-space: pre-wrap` lived on `.bubble__markdown pre` — a descendant selector scoped to the markdown
container — and `word-break: break-word` was inherited from `.bubble`. Neither reaches `.tool-row__body`,
which is not a `.bubble` descendant, so reusing `.code-block`/`.code-block__body` outside a bubble would
silently have dropped both and let a long command overflow the row instead of wrapping. Both declarations
moved onto `.code-block__body` itself, and `.bubble__markdown pre` was deleted rather than left
duplicated — safe by construction, since `AssistantMarkdown`'s `pre` override is total over the `<pre>`
element and no `rehype-raw` means no other `<pre>` can exist under `.bubble__markdown`. Both computed
values inside a bubble are unchanged, so `e2e/assistant-whitespace.spec.ts` needed no assertion edits —
only a comment fix naming the rule that moved (three other CSS comments and one e2e comment cited
`.bubble__markdown pre` as a precedent and were corrected in the same commit; a deleted rule strands any
comment that cites it as one). No `max-height`/`overflow` on the block, in either location — it diverges
from `.tool-row__result`'s 240px cap on purpose: a result can reach 64KB, a command is bounded by the
daemon at 4000 runes, and the command is the thing the reader opened the row to see.

**What does not suppress the repeat.** On the 11.2% of shell calls with no `description`, the headline
falls through to `command`, so the header and the code block carry the same text. That repeat is
*wanted*, not a bug: the header ellipsises on one line, the block does not, and a command long enough to
be cut is exactly the call the row was opened for. `shellCommandBlock` never looks at what the headline
picked, so the repeat is unreachable-to-suppress rather than a declined branch — adding a "skip the block
when the headline already shows it" guard would be a regression, not a fix.

**Security posture**, extending #706's SAFETY block a third time: the command was already rendered twice
before this ticket (headline, list-row value); after it, the same set of untrusted strings reaches the DOM
through one fewer sink, not one more. Four sinks this ticket made newly tempting are declined and named in
`ToolRow`'s own comment as MUST-FIX-if-reintroduced: routing the command through `AssistantMarkdown` (the
ticket's own "same chrome as a fenced code block" phrasing makes this the obvious-looking shortcut, and it
would yield links/images from daemon text and let a crafted command break out of a synthesized fence), a
`language-*` class on a `<code>` child, `title={command}`, and linkifying a detected URL inside the
command. The one new index read, `input[COMMAND_FIELD]`, is safe for the same two reasons
`toolHeadline.ts`'s `firstNonEmpty` already documents: the key is a client-owned constant, and `'command'`
collides with no `Object.prototype` member.

**Testing**, unit tier only (no DOM, so no e2e tier is needed): `toolBody.test.ts` covers both functions as
values in/values out (12 scenarios, including the `startsWith`-would-wrongly-catch guard on
`command_timeout`/`commands`/`description_url`, and the `===`-not-`startsWith` proof against `BashOutput`).
The sharpest regression check is free rather than written: every fixture in `ConversationScreen.test.tsx`
before this ticket has the tool name `read_file`, and two of them (`:675-688`, `:691-705`) already pass a
`command` field into an *expanded* row and assert it renders as a `tool-row__input-value` list row. Both
stayed green **unedited** — if either had needed a change, the carve-out would have been keyed on the
field name instead of the tool name, which is exactly the mistake AC4 exists to forbid.

Code review: PASS, four non-blocking NITs (comment line-wrap and title-wording only). See the merged PR
(#844) for the full record; there is no `docs/knowledge/codebase/780.md` — that directory was frozen
2026-08-26, and this section is #780's only home.

### Full-width bordered tool row (#722)

Restyles the chip from the mobile mock's hug-width pill to the desktop design's full-width bordered box
(Figma `134:4939`) — the same treatment `.code-block` (#721) already ships, adopted rather than invented.
CSS and one theme token only: the markup, the class names and the collapsed prefix are byte-stable, so
every existing tool-row assertion in `ConversationScreen.test.tsx` passed unedited. The third run (a
per-call count), the chevron and the description-first headline choice that the redrawn Figma component
(`155-553`) also draws are held for #773/#774; the expanded body (`.tool-row__result`, and the
`.code-block` #780 puts inside it) is untouched and deliberately not redrawn here.

**The width mechanic**, the one part with consequences. `.tool-row` was already a stretch item of
`.conversation__thread`'s flex column — the row was always full width, only the chip hugged.
`.tool-row__chip`'s `max-width: 100%` (a ceiling on a hug-width box) becomes `width: 100%`, with
`box-sizing: border-box` added alongside it (`index.css` sets no global box-sizing; `.paired-shell:20-22`
is the file-family precedent for stating it at the call site), and both land on the *base* rule so they
reach the `<button>` and the `<div>` branches identically — that's what makes a resolving row not shift,
pinned by three new width assertions in `e2e/tool-row-toggle.spec.ts` (pending vs. resolved vs. expanded,
each compared against the row's own width with a 0.5px float tolerance), since a rendered width is
invisible to the `renderToStaticMarkup` unit tier. `.tool-row__chip--toggle`'s `box-sizing: content-box` —
held there specifically so `max-width: 100%` bounded both branches alike — is deleted rather than flipped,
since under `width: 100%` it would be exactly backwards: the button would overflow its row by 2×12px
padding plus 2×1px border.

`width: 100%`, not a flex remedy: `.tool-row` flips `flex-direction` between collapsed (`row`) and
expanded (`column`), so `flex: 1` would fill the row collapsed but grow the chip *vertically* expanded,
and `align-self: stretch` would do the reverse. The direction-agnostic form is what `.status-row` and
`.unrecognized-row__summary` already use for the same job, and the e2e's expanded-state assertion is the
one that would go red under a flex-based remedy.

**`.tool-row--expanded`'s `align-items: flex-start` stays, its reason doesn't.** It used to be
load-bearing because `stretch` would blow the hug-width pill out to the full row — the thing this ticket
now wants, so that reason is dead. It survives for a different one: `.tool-row__body` is the column's
*other* child, and under `stretch` the body (and the `.code-block` #780 puts inside it) would go full
width too — a change to the expanded body, which stays #774's. The chip itself is unaffected either way,
since it now carries its own `width: 100%`. **The general lesson, not just this rule's:** three shipped
comments in this region argued *against* the box this ticket builds, and two of the declarations they
guarded still had to stay, for different reasons than the stale comment gave. Grep the region's comments
for the property being changed before changing it, rather than assuming a comment's presence still matches
its reasoning.

**The box treatment**, every value a token, read off the Figma variables rather than assumed: fill
`--color-surface` (the thread's own background — no separate fill step); border colour
`--color-outline-variant` → `--color-primary-container`; corner `--radius-sm` (12px) → `--radius-xs`
(6px); run gap `--space-2` → `--space-3` (8px → 12px, padding unchanged). Both type runs move onto
`--text-body-medium-*`; the headline's ink lifts `--color-on-surface-variant` → `--color-on-surface`. The
design's primary-container variable prints `#134a74`, which agrees with the dark token — no
light-scheme-fallback transposition to correct here, unlike the trap `--color-inverse-primary` and
`.code-block`'s own comment warn about elsewhere in this file.

**One new token**, `--text-tool-name-line: 16px` in `tokens.css`, immediately after `--text-code-body-line`
— the same shape for the same reason. The tool-name run's 14/16 is bound to no type style in Figma, and no
14px step in the scale carries a 16px line (`body-medium` and `label-large` both pair 14px with 20px; 16px
belongs only to a 12px or 11px step). Borrowing `--text-body-small-line` would couple a 14px run to a 12px
step's quartet for no reason beyond convenience. There is no `--text-tool-name-size`: the size is
`--text-body-medium-size`, the same step the sans sibling run takes whole.

**The hover fill moved with the resting one.** Resting dropped `--color-surface-container` →
`--color-surface`, so the outgoing hover value (`--color-surface-container-highest`, two rungs up the
ladder) would have become a three-rung jump. `.status-row:hover` had already answered this exact
question — a full-width `<button>` resting on `--color-surface` and hovering to
`--color-surface-container` — so that value is taken rather than picked fresh: one ladder rung, and still
a visible step over the now-unfilled resting background.

**What the ticket held, and how each survives untouched:** the pending row's 50% dimming
(`.tool-row { opacity: 0.5 }` / `.tool-row--resolved`, neither edited) and its `<div>` fork (TSX, not
edited); the error border (`.tool-row--error .tool-row__chip`, not edited, still outspecifying the base
rule at (0,2,0) against (0,1,0) — `.tool-row__chip--toggle` still declares no `border` in any form, which
is the one thing that would silently kill the error accent on every failed row if it ever did); the
headline's single-line ellipsis (`min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` +
`white-space: nowrap`, all unchanged — a wider box gives an untrusted string more room, it does not make
the geometric bound optional, and `nowrap` still collapses an embedded newline to a space so it cannot
break the row).

Code review: PASS, four non-blocking NITs. Two are worth carrying forward rather than re-discovering: the
new border's contrast against the surface fill, `--color-primary-container` on `--color-surface`, computes
to roughly 1.97:1 — under WCAG 1.4.11's 3:1 for a UI-component boundary. Not gating (the design binds the
value, the outgoing pairing was comparably low, and `.code-block`'s "decorative chrome, not a state-bearing
graphic" ruling from #721 already covers the identical case) — but this box goes from decorative to
interactive once resolved, unlike `.code-block`, so it is flagged for whoever adds the chevron in #774.
The other: `.conversation__workspace-chip-pill`'s comment (`:159`, outside the edited region) still cites
"the `.tool-row__chip` idiom (inline-flex, `--space-2` gap, `--space-2`/`--space-3` padding,
max-width/min-width/overflow…)" — that idiom moved under this ticket (`--space-3` gap, `width: 100%`,
`--radius-xs`) and the chip is no longer a pill at all. Nothing regresses visually, since the two rules
hold independent declarations, but the citation now points at a shape the tool-row region no longer draws.

See PR #846 for the full record; there is no `docs/knowledge/codebase/722.md` — that directory was frozen
2026-08-26, and this section is #722's only home.

### Permission modal (#224, answerable since #237, second-confirm since #226, rejection surface since #249, confirm marker scoped to its prompt since #511)

The render half of the modal vertical (ADR [0009](../decisions/0009-modal-prompt-model.md)):
[#223](../codebase/223.md) shipped the store + bridge but left `useModalBridge` dormant, so
`modalStore` never populated. #224 closed that loop — it mounts the bridge at App level (beside
`useDaemonEventBridge`/`useTimelineBridge` in `App.tsx`) and renders the store's outstanding prompt.
[#237](../codebase/237.md) then made the rendered prompt **answerable**, closing the modal vertical.
[#226](../codebase/226.md) then inserted a **client-side second-confirm gate** in front of an allow
answer: there is no machine-readable `destructive` class on the wire (ADR 0009), so "a consequential
action needs a second confirm" can only be a renderer UX policy, gated on the one signal available —
`prompt.defaultOptionId`. [#249](../codebase/249.md) then added a **rejection surface**: because
#237's answer path clears the prompt optimistically, an ungranted device's answer round-tripping to a
daemon `error` (correlated by [#248](../codebase/248.md)) had nothing left on screen to show it — see
§ Rejection surface below.

`PermissionModal.tsx`, mirroring `RepairPrompt`/`RepairControl`:

- **`PermissionModalView({ prompt, pendingOption, onSelect, onConfirm, onBack, onCancel })`** — pure,
  exported. Renders a centered M3 dialog (Figma "Dialogs", node `22-3`) reusing `StatusSheet`'s
  overlay+scrim *structure* (`role="dialog"`, `aria-modal="true"`, a dedicated scrim, an opaque panel,
  absolutely positioned inside `.conversation`, no portal) but centers the panel instead of
  bottom-anchoring it, and uses a distinct class set (`.permission-modal-overlay`/`.permission-modal`/…)
  rather than the status-sheet classes — the two modals share a chrome pattern, not a stylesheet.
  `title`/`prompt`/`options[].label` render as React children (auto-escaped, never
  `dangerouslySetInnerHTML`). The `pendingOption: ModalOption | null` prop (#226) selects one of two
  render modes — a **prop**, not internal `useState`, so both modes stay SSR-testable:
  - **List mode** (`pendingOption === null`) — one `<button type="button">` per option in array order,
    keyed by `option.id`, each `onClick={() => onSelect(prompt.modalId, option.id)}` (renamed from
    #237's `onAnswer` — every click now routes through the container's gate rather than answering
    directly). The option whose `id` matches `defaultOptionId` carries the
    `permission-modal__option--default` modifier — a filled-tonal pill (`--color-secondary-container`)
    against the plain `--color-primary` text-button treatment of the others. A leading cancel button,
    `.permission-modal__cancel` (its own class, not `.permission-modal__option`), is prepended to the
    action row with `onClick={() => onCancel(prompt.modalId)}` and the client-owned label `Cancel`; CSS
    gives it `margin-right: auto` so it sits at the row's far left while the daemon options stay
    right-aligned — a code-review SHOULD-FIX from #237 flagged this as diverging from the Figma Dialogs
    reference (which clusters Cancel at the trailing/right edge next to the confirm action) and asked
    the PO/architect to confirm the placement; **still unresolved**, see [#237 codebase
    notes](../codebase/237.md).
  - **Confirm mode** (`pendingOption` set, #226) — the same chrome, title still shown, a client-owned
    confirm sentence naming `pendingOption.label` (auto-escaped, since the held option's label is still
    untrusted daemon text even quoted back to the user), and a two-button row: leading `Back`
    (`.permission-modal__back`, `onClick={() => onBack()}`) / trailing `Confirm`
    (`.permission-modal__confirm`, `onClick={() => onConfirm(prompt.modalId, pendingOption.id)}`). The
    daemon option list is **not** rendered in this mode.
- **`PermissionModal()`** — the store-bound container: `useModalStore(selectOutstanding)` plus
  `useModalStore(s => s.dispatch)` (#237), renders `outstanding[0]` via `PermissionModalView`, or `null`
  when nothing is outstanding. One dialog at a time, oldest-first FIFO; no `selectCurrentModal` selector
  (ADR 0009 defers it — the container derives `[0]` locally). Gained one `useState<PendingConfirm |
  null>` (#226, re-keyed by [#511](../codebase/511.md)), `pending` — declared **before** the
  early-return (rules-of-hooks) — holding `{ modalId, optionId }`, not a bare option id. Daemon option
  ids are a closed per-class vocabulary (`permission` → `allow_once`/`allow_always`/`reject_once`/
  `reject_always`, `trust` → `proceed`/`exit`), not per-prompt nonces, so a bare-id marker was
  guaranteed to match same-class prompts other than the one it was armed on — #511 fixed this. A new
  pure `resolvePendingOption(prompt, pending)` in `modalResolution.ts` derives `pendingOption` every
  render against the **current** prompt, not a cached snapshot: `null` unless `pending.modalId ===
  prompt.modalId` (the correlation key, and the actual fix — `modalId` is a daemon-minted
  `crypto/rand` UUIDv4, distinct per prompt) **and** `prompt.options` still contains that `optionId`
  (retained as the within-prompt net for a `shown` re-delivery that changes the option set, and how the
  `ModalOption` the confirm sentence names is obtained). Re-deriving rather than clearing on a prompt
  change means a stale marker is inert — it can only ever match the prompt it was minted against — so
  the empty-`outstanding` window (the container returns `null` but stays mounted, per
  `ConversationScreen.tsx`) is structurally safe rather than defended. `onSelect` routes through the
  pure `selectOption` gate in `modalResolution.ts` (unchanged by #511): the default option answers
  straight through (`answerPrompt`, unchanged from #237); any other option calls `setPending({ modalId,
  optionId })` — the identity captured from the click's own `modalId`, not re-read from a possibly-newer
  store — and holds. `onConfirm` calls `answerPrompt` then clears the pending marker; `onBack` just
  clears it (no send). `onCancel` is unchanged from #237 (`cancelPrompt`, never gated). All handlers
  dereference `window.pyry.sendCommand` only inside the closures (#237's discipline). Since
  [#249](../codebase/249.md), also reads `useModalStore(selectRejections)` and renders
  `RejectionSurfaceView` alongside `PermissionModalView` — see § Rejection surface below.

Mounted as the **last child** of `.conversation` in `ConversationScreen.tsx`, after the conditional
`StatusSheet`, so it overlays the whole conversation surface. Selecting the default option or clicking
Cancel dispatches `answerModalCommand`/`cancelModalCommand` (#236) immediately, exactly as #237 shipped
it; selecting any other option now holds (#226) until `Confirm` dispatches the same
`answerModalCommand` or `Back` returns to the list with no send. Either terminal path (answer or
cancel) clears the prompt **locally and optimistically** via the existing `dismissed` reducer arm — no
new store representation, no new event arm, no wire change for #226 or #511. Was inert in production
until [#179](../codebase/179.md) flipped the `interactive` capability (previously no `modal_shown` frame
arrived, so nothing to answer); now live. See [#224 codebase notes](../codebase/224.md) for the
original render design, [#237 codebase notes](../codebase/237.md) for the answer-path design and the
still-open code-review items (Cancel placement, focus trap/`Escape`, programmatic default-option cue),
[#226 codebase notes](../codebase/226.md) for the second-confirm gate design, and [#511 codebase
notes](../codebase/511.md) for the pending-marker fix — the staleness gap #226 and #510's code reviews
both flagged against the bare-option-id key is now resolved, not still open.

#### Rejection surface (#249)

Because the answer path (#237) clears `outstanding` **optimistically** on click, an ungranted device's
answer round-tripping to a daemon `error` (correlated main-side by [#248](../codebase/248.md) into a
content-free `modalAnswerRejected` event) had no prompt left on screen to attach to — the user just
watched it vanish with no explanation. This slice adds a second, **orthogonal** surface at the same
host, fed by a new `rejections: readonly string[]` slice on `ModalState` (arrival-ordered,
de-duplicated `modalId`s — see [Modal-prompt model](modal-prompt-model.md)):

- **`RejectionSurfaceView({ rejections, onDismiss })`** — new, exported, pure, SSR-testable, mirroring
  `PermissionModalView`. Returns `null` on an empty list (the `Timeline`/`ThinkingIndicator`
  zero-layout-footprint idiom). Else renders `.modal-rejections`, one `.modal-rejection` banner per id
  (**keyed by `modalId`**), each with `role="alert"` (a live region — a screen reader announces the
  failure on arrival), the client-owned category copy **"Your answer was rejected."**, and a `Dismiss`
  button calling `onDismiss(modalId)`. The `modalId` is used **only** as the React key and the
  `onDismiss` argument — never rendered as visible text (it is meaningless to a human and the prompt
  title is already gone). No daemon content anywhere: the event carries none, the copy is a client
  constant. `onDismiss` is a **required** injected prop (the "a view that cannot answer is a bug" rule).
- **`PermissionModal()`** — extended, not forked: reads the new `selectRejections` slice alongside
  `selectOutstanding`; the early return now fires only when **both** are empty
  (`if (!prompt && rejections.length === 0) return null`), since a rejection can render with no
  outstanding prompt; `pendingOption` is guarded on `prompt` existing (it can be `undefined` while a
  rejection shows alone). Returns a fragment: `<PermissionModalView>` only when `prompt` exists, plus
  `<RejectionSurfaceView>` unconditionally, wired with an inline
  `dispatch({ type: 'rejectionDismissed', modalId })` — deliberately not a `modalResolution.ts` helper,
  since it neither sends a command nor renames to the wire.
- **Styling** (`conversation.css`) — `.modal-rejections` is a bottom-anchored absolute stack inside
  `.conversation`, `pointer-events: none` so it never blocks the composer beneath it (each
  `.modal-rejection` banner re-enables its own `pointer-events: auto`). Each banner is a
  `--color-surface-container-high` card with a `--color-error` `border-left` accent (a leading accent,
  not a filled error container — only the bare `--color-error` role token exists, #230). No new theme
  tokens. No bespoke Figma design exists for this surface yet (PO-confirmed gap in node `22-3`); the
  chrome is a placeholder reusing the modal/M3 tokens pending a follow-up.

Not security-sensitive — a pure renderer reading an already-typed, content-free event; no keys, sockets,
tokens, or raw bytes (the guarantee was defended upstream by #248). See [#248 codebase
notes](../codebase/248.md) for the transport half and [#249 codebase notes](../codebase/249.md) for the
full render design, testing strategy, and lessons learned.

### The interactive flip + thread cutover (#179)

The on-switch for the whole structured surface above. `loadDialConfig` (`daemonConnection.ts`) now
passes `capabilities: [CAPABILITY_INTERACTIVE]` to `buildClientHello` — the single production call
site, previously always `[]`. `interactive` is the only capability in the vocabulary, so advertising
it turns on everything the daemon offers a paired interactive client: the v2 structured stream (turn
state, deltas, tool use/result, thinking) and the `modal_shown` prompts, all decoded by the
already-shipped, previously-inert transport (#199–#230) and rendered by the already-mounted pipeline
above. The daemon's accepted set echoes back on `hello_ack.capabilities`, surfaced unchanged on the
`connected{ack}` event (`parseHelloAck` already did this — no production change needed for that half).

Advertising `interactive` stops the daemon's coarse `message` fan-out in the same instant
(pyrycode #699), so the flip and the render cutover **land in one commit**:

- **The composer's echo retargets.** `Composer`'s `dispatch` now reads
  `useTimelineStore((s) => s.dispatch)` instead of `useSessionStore((s) => s.dispatch)`;
  `composerSend.ts`'s `submitMessage` dispatches `{ type: 'userText', text: trimmed }` (the
  [#245](../codebase/245.md) event) instead of a `messageSent` `SessionAction`. The `message_id`
  minted in `submitMessage` is now used for the **wire** command only — the old "reuse the id so the
  daemon's re-echo dedupes" rationale is retired: in interactive mode the `DaemonEvent` union carries
  no user-message arm and the coarse fan-out is off, so the optimistic echo is the sole source of the
  user's own message and needs no dedup key.
- **`TimelineRow`'s `case 'userText'`** (the [#245](../codebase/245.md) dormant placeholder) now draws
  the right-aligned user bubble — `.message-row--user` / `.bubble--user` (`data-thread-role="user"`,
  distinct from `MessageBubble`'s `data-message-role`), reusing the coarse thread's own user-bubble
  treatment verbatim (no new CSS). Text renders as auto-escaped React children, never
  `dangerouslySetInnerHTML`.
- **`MessageThread` is retired.** Its mount (`<MessageThread messages={messages} />`) and the
  `useSessionStore(selectMessages)` read are removed from `ConversationScreen`. `MessageThread` /
  `MessageBubble` / `messageViewModel.ts` / `selectMessages` all stay as **dead-but-tested residue**
  (deliberate — a later cleanup ticket removes them); `sessionStore.messages` is populated but unread.

`Timeline` is now the conversation's **single** thread surface: the user's `userText` echo and the
daemon's structured reply share the one ordered `timelineStore.items` array, so arrival order gives
one continuous thread with no split-brain and no empty second region. See
[#179 codebase notes](../codebase/179.md) for the full design, the security review, and lessons
learned.

### Session-boundary delimiter (#286, redrawn #690)

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
Picker](#workspace-picker-sheet-383) sheets still read it for their own relative-time lines.

The row is now two identically-classed `.session-delimiter__rule` siblings bracketing the centred label,
each `flex: 1 0 0` inside a `nowrap` flex row — equal halves at every container width by construction,
nothing kept in sync via a width or percentage. The label takes `--color-primary` and `--font-sans`
body-small (no `font-family` declaration — `.conversation` already sets `--font-sans` and a `<p>` has no
UA font-family to fight); the two hairlines take a new token, `--color-inverse-primary` (`#32628d`, M3
Schemes/Inverse Primary, `tokens.css`), at the Figma's own 60% opacity. `workspaceCwd` (an untrusted
daemon filesystem path) still reaches the DOM only inside the label string as auto-escaped React
children — the `toolCall`/`userText` posture, unchanged since #286. Both rules stay decorative
`aria-hidden` styled `div`s, not semantic `<hr>`s.

Row clearance (16px above/below) is the *sum* of `.conversation__thread`'s `gap: var(--space-3)` (12px)
and the row's own `--space-1` padding (4px) — not `--space-4`, which would double the container's
existing gap into 28px. AC5 (equal halves under resize; a long unbroken workspace path wrapping inside
the row rather than stranding a rule) was settled as review-by-inspection in the spec, since nothing
under `renderToStaticMarkup` can measure layout — but the PR discovered that the Playwright Electron tier
actually *can* resize the window (`app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
.setSize(w, h))`; `page.setViewportSize` still does not apply to an Electron page), so AC5 was verified
by measuring real rects at 800px and 1600px rather than only inspected. The explanatory sentence and
`Install` affordance (Figma 16-38, #286's mobile file) remain out of scope, deferred with the
memory-plugin subsystem neither ticket depends on. See [#286 codebase notes](../codebase/286.md) for
#286's original design and patterns established.

### Queued backlog + drop affordance (#294, drop since #296)

The [queue store](queue-store.md)'s held backlog (per-conversation `QueuedItem` rows the daemon has
accepted but not yet run) renders as `QueuedBacklog`, an exported pure view mounted after
`<ThinkingIndicator/>` and before the status row's `<StatusRow/>` trigger. Empty → `null` (no
region, no chrome — the `ThinkingIndicator` posture); non-empty → one row per item, in enqueue
order, inside a `.conversation__queued` wrapper dimmed to 50% opacity (the `.tool-row` pending
precedent, the single "waiting / not yet run" signal). Each row reuses the delivered user-bubble
treatment (`message-row--user` / `bubble--user`) but is tagged `data-thread-role="queued"` —
distinct from a delivered row's `data-thread-role="user"`. `QueuedBacklogControl`, the in-file
container, binds a module-scope-hoisted `selectBacklogFor(MILESTONE_CONVERSATION_ID)` (the same
milestone constant the composer sends under — this screen has no conversation id in nav scope, and
the spec explicitly ruled out threading one through for this slice).

[#296](../codebase/296.md) added a **drop / cancel affordance** to each row: an icon-only button, a
leading sibling of the bubble (the row is right-aligned, so leading sits it at the inner edge),
carrying a client-owned `aria-label="Drop queued message"` and an inline `aria-hidden` SVG glyph.
`onDrop` is a **required** injected-effect prop on `QueuedBacklog` (the `PermissionModal` "a view
that cannot answer is a bug" rule) — the container binds it to the pure `dropQueuedMessage` helper
(`dropQueuedMessage.ts`), supplying `MILESTONE_CONVERSATION_ID` and dereferencing
`window.pyry.sendCommand` only inside the click closure. Activating it dispatches
`dequeueMessageCommand` (see [Dequeue message envelope](dequeue-message-envelope.md)) and nothing
else — **no optimistic removal**: the row disappears only when the daemon's next `queue_state`
snapshot replaces the backlog and this same store subscription re-renders. The button exists only
inside `QueuedBacklog`; `Timeline` draws every delivered row and is untouched, so "affordance only
on queued rows" and "delivered rows unaffected" are structural guarantees, not conventions. The
drop button inherits the region's 50% dimming (a child's own opacity cannot escape a parent opacity
compositing group) — shipped dimmed by design; see [#296 codebase notes](../codebase/296.md).

No Figma coverage for either the queued row or its drop control — the same documented gap as
[#148](../codebase/148.md)'s thread-chrome states: the mobile file draws only the populated,
delivered thread (node 16-8/16-21). See [#294 codebase notes](../codebase/294.md) and [#296
codebase notes](../codebase/296.md) for full design and patterns established.

### Screen-snapshot action & display (#324, removed #618)

The view half of #318's store/render split (store half: [#323](../codebase/323.md)) — a request
button between `<StatusRow/>` and `<InterruptControl/>` (`ScreenSnapshotControl`, `.screen-snapshot`)
that fired the `requestSnapshot` command, plus a bounded `<pre>` panel (`.screen-snapshot__screen`,
`max-height: 240px; overflow: auto`) showing the daemon's held rendered-screen text, with a distinct
`.screen-snapshot__empty` placeholder before any reply arrived.

**Removed in [#618](../codebase/618.md).** The feature it exposed — photographing claude's terminal
— was deleted upstream (pyrycode#1348); the daemon now wires `Snapshotter: nil`, so the button
rendered enabled and did nothing, with no error shown. #618 took only this visible surface:
`ScreenSnapshotView`, `ScreenSnapshotControl`, both copy constants, `requestScreenSnapshot.ts`, and
the `.screen-snapshot*` CSS block are all gone, and the mount between `StatusRow` and
`InterruptControl` reverts to the two sitting adjacent. A raw-event view to replace this was
discussed and deliberately deferred, not built.

**What stayed, and what's since gone.** [`screenSnapshotStore`](screen-snapshot-store.md) and its
bridge stayed reader-less through #618's scope, then were deleted outright by
[#619](../codebase/619.md). The outbound `requestSnapshot` IPC command and its wire type were then
removed by [#620](../codebase/620.md); the inbound decode and its two events remain #621/#622's
removals. See [#324 codebase notes](../codebase/324.md) for the original design and patterns
established, [#618 codebase notes](../codebase/618.md) for the visible-surface removal and its comment
re-anchors, [#619 codebase notes](../codebase/619.md) for the state-layer removal, and [#620 codebase
notes](../codebase/620.md) for the outbound-transport removal.

### Channel Info sheet (#365)

Makes the thread overflow menu's **Channel info** item (#276, previously a live no-op) open a new
bottom sheet (Figma node 20-48), reusing the Run-configuration `StatusSheet`'s `.status-sheet__*`
chrome verbatim — the second sheet to do so. Renders the active conversation's **About** detail
(Workspace `cwd` + Last activity), an empty **Actions** section slot, and a monospace **Channel ID**
footer. Renderer-contained: no transport, IPC, or wire code.

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
                ├── "Actions" section-header
                ├── .channel-info__actions          mount point for #366/#367/#368 (Rename+Archive built, Delete #367 open)
                └── .channel-info__footer           "Channel ID: {id}" (omitted when conversation === null)
```

**Open-state ownership stays local, not threaded through `PairedShell`.** `channelInfoOpen` is a new
`useState(false)` in `ConversationScreen` — the `sheetOpen` precedent (ADR 0006) — flipped by the
overflow menu's `onChannelInfo={() => setChannelInfoOpen(true)}`. This is a deliberate divergence from
#276's original design: #276 shipped a speculative `ConversationScreenProps.onChannelInfo?` seam
assuming the sheet would live *above* `ConversationScreen` (opened by `PairedShell`). #365 retired that
prop instead (removed from the interface and the destructure) because the sheet's trigger, data
(`activeConversationStore`), and chrome are all `ConversationScreen`-local, exactly like `StatusSheet` —
splitting one sheet's control across two files for zero behavioral gain would have contradicted the very
precedent the seam was named after. No caller ever passed `onChannelInfo` (`PairedShell`, `App.tsx`, and
every test constructed props without it), so the removal is a pure simplification, not a breaking change.

**`conversation === null` renders gracefully, not a crash.** [`activeConversationStore`](#workspace-chip-278)
is written on exactly one path — the FAB create-nav callback — so a thread opened from the channel list
never populates it (the app's single-active-conversation interim). The sheet still opens: chrome + a
`CHANNEL_INFO_EMPTY_COPY` placeholder line in place of the About rows, and the Channel ID footer omitted
entirely (there is no id to show). `conversation.name === null` (an unnamed scratch conversation) is a
separate, narrower case — the title falls back to `UNNAMED_CONVERSATION_LABEL` — distinct from no
conversation at all.

**Deferred, not invented:** Figma 20-48 also shows Created / Total sessions / Total messages rows and a
Memory section — none has a field on the desktop `ConversationCreatedPayload`, so none is built. The
Channel ID footer ships at the app's `body-small` (12px) mono token rather than Figma's 11px — a
type-scale simplification (the app's fixed vocabulary is the fidelity ceiling, not a literal Figma
pixel match), not drift.

Escape-to-dismiss is wired via the same `document`-`keydown`-listener-scoped-to-mount-lifetime idiom
#276 established (`DocumentEventMap['keydown']`, not a bare `KeyboardEvent` — this file's top-level
`import { type KeyboardEvent } from 'react'` shadows the DOM type). Untested here, same as #276's
Escape/outside-click and `StatusSheet`'s open-on-click wiring — the suite is `renderToStaticMarkup`-only,
no jsdom, so interactive effects are reviewed glue, not asserted. Not security-sensitive: the only daemon
strings rendered (`name`/`cwd`/`id`) are already rendered elsewhere in this file as auto-escaped React
children, same posture as `WorkspaceChip`. See [#365 codebase notes](../codebase/365.md) for the full
design and patterns established.

**Rename action ([#368](../codebase/368.md)).** The Actions slot's first filler: a Material 3 tonal
pill (Figma 20:89, `.channel-info__action`) rendered only when the container supplies an `onRename?`
callback — supplied exactly in the `conversation !== null` branch, so the null-conversation
graceful-empty case (above) offers no Rename control either. Activating it seeds and opens the
existing [Rename dialog](rename-conversation-dialog.md) (`RenameConversationDialogView`, #360) via a
second screen-local `useState` pair (`renameOpen`/`renameName`) the `ChannelInfoSheet` container
grows, mirroring `ChannelList.tsx`'s row-level rename state shape; Save dispatches the already-shipped
`renameConversation` command (#359) via `requestRenameConversation`, imported verbatim rather than
cloned. That helper's `row` param narrowed from `ConversationSummary` to `Pick<ConversationSummary,
'id'>` (it only ever read `.id`) so the sheet's `ConversationCreatedPayload` — a narrower 5-field
shape lacking `is_archived`/`last_message_ts` — passes directly, no adapter, no cast; the existing
`ChannelList` call site is unaffected (a wider shape still satisfies the narrower `Pick`). No new
transport, IPC, or wire code. See [#368 codebase notes](../codebase/368.md) for the full design and
patterns established.

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

## Seams (bound + still open)

- **`onBack?: () => void`** — **bound in [#140](../codebase/140.md).** Optional, gated exactly like `onUnpaired?`; wired by the [paired shell](paired-shell.md) when this screen is mounted as its `thread` view, absent for a bare `<ConversationScreen />`. See [Back control](#back-control-140) above.
- **`MessageThread({ messages })`** — **bound in [#69](../codebase/69.md); unmounted (retired to dead-but-tested residue) in [#179](../codebase/179.md).** `ConversationScreen` fed this prop from `useSessionStore(selectMessages).map(toMessageViewModel)` from #69 through #178; #179 removed the mount and the read. `MessageThread` itself is untouched and still server-render-tested as a pure `Message[]`-in view, but nothing in production calls it.
- **`Composer`** — **bound in [#66](../codebase/66.md); echo retargeted in [#179](../codebase/179.md).** A thin controlled container: `useState` input, an `onChange`/`onKeyDown` on the `<textarea>`, and an `onClick` on the send button, all delegating to the pure `submitMessage` in `composerSend.ts` (submit mints a `message_id` for the wire command, and dispatches an optimistic `userText` echo into the timeline store since #179 — previously a `messageSent` action into the session store). The submit logic lives in its own `.ts` file (the pairing container/pure-logic split); `Composer` itself stayed in-file. Auto-grow was not built (cosmetic, no AC). See [Composer send](composer-send.md).
- **`UnpairControl`** — **bound in [#166](../codebase/166.md).** A screen-local confirm-phase container delegating its decision logic to the pure `runUnpair` in `unpairAction.ts`, the same pattern as `Composer`/`composerSend.ts`. See [Unpair control](#unpair-control-166) above.
- **`RepairPrompt({ status, onRepair })` / `RepairControl`** — **bound in [#167](../codebase/167.md).** `RepairPrompt` is the exported pure view (`status` as a prop, gated by `shouldOfferRepair`); `RepairControl` is the in-file container reusing `runUnpair`. See [Re-pair control](#re-pair-control-167) above.
- **`ConnectionBanner({ status })` / `ConnectionBannerControl`** — **bound in [#279](../codebase/279.md).** `ConnectionBanner` is the exported pure view (`status` as a prop, gated by `shouldShowBanner`); `ConnectionBannerControl` is the in-file container reading only `selectStatus`, mounted between `UnpairControl` and `Timeline`. See [Connection banner](#connection-banner-279) above.
- **`StatusRow({ onExpand })` / `StatusSheet({ onClose, children })`** — **shell landed in [#177](../codebase/177.md); the `children` seam bound its first section in [#72](../codebase/72.md); the headless data path in [#187](../codebase/187.md); the Model/Effort/YOLO render in [#188](../codebase/188.md); the Context window render in [#192](../codebase/192.md); the summary slot's first content in [#330](../codebase/330.md).** `StatusRow`'s summary region now holds the two-dot connection indicator (#330); the `model · effort · context%` run-config text itself is still unbuilt and lands as a sibling beside the dots. `StatusSheet`'s body now renders `<RunConfigData/>` (holds data, no markup), then `<RunConfigSections/>` (all four read-only sections, reading the store #187/#192 populate), then `<LogDataSection/>` — the full read-only surface the sheet needed is now built. See [Run configuration sheet](#run-configuration-sheet-177), [Run configuration data path](#run-configuration-data-path-187), [Run configuration Model/Effort/YOLO sections](#run-configuration-modeleffortyolo-sections-188), [Run configuration Context window section](#run-configuration-context-window-section-192), and [Two-dot Relay/Pyrycode connection-status indicator](#two-dot-relaypyrycode-connection-status-indicator-330) above.
- **`ConnectionStatusIndicator({ relay, daemon })` / `ConnectionStatusIndicatorControl`** — **bound in [#330](../codebase/330.md).** `ConnectionStatusIndicator` is the exported pure view (both legs as props, matrix proven by direct server-render); `ConnectionStatusIndicatorControl` is the in-file container reading `useRelayLinkStore(selectRelayLinkStatus)` and `useSessionStore(selectStatus)`, mounted inside `StatusRow`'s summary slot. See [Two-dot Relay/Pyrycode connection-status indicator](#two-dot-relaypyrycode-connection-status-indicator-330) above.
- **`Timeline({ items })`** — **bound in [#203](../codebase/203.md); became the sole thread surface in [#179](../codebase/179.md); source moved to the open conversation's own slice in [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758).** Reads the [conversation timeline holder](conversation-timeline-holder.md)'s `selectTimelineFor(openConversationId)` (was the flat [conversation timeline store](conversation-timeline-store.md)'s `selectItems` through #758). Was inert (empty, `null`) in production until #179 flipped `interactive`; now carries both the `userText` echo and the daemon's structured reply, for the conversation on screen. See [Structured-stream timeline render](#structured-stream-timeline-render-203), [The interactive flip + thread cutover](#the-interactive-flip--thread-cutover-179), and [The open-conversation reader cutover](#the-open-conversation-reader-cutover-758) above. `TimelineRow`'s `toolCall` arm gained its pending render in [#218](../codebase/218.md) — see [Pending tool-call row](#pending-tool-call-row-218) above — and its resolved render in [#230](../codebase/230.md) — see [Resolved tool-call row](#resolved-tool-call-row-230) above.
- **`ThinkingIndicator({ state, toolName })`** — **bound in [#215](../codebase/215.md); went live in [#179](../codebase/179.md); prop widened and gate broadened to hold across the whole running turn in [#648](../codebase/648.md); gained the required `toolName` prop naming the open tool in [#649](../codebase/649.md); source moved to the open conversation's own slice in [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758); markup moved into the new `ComposerStatusArea` in [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796).** `Timeline`'s twin over the open slice's `phase` (plus `apiRetry`/`compacting`) and, since #649, a second independent derivation `openToolName(items)` over the same `items` slice `Timeline` reads; its props and their derivations are untouched by #796, only the returned markup (one `<span>` instead of a `.bubble` wrapper) and the mount site (inside `ComposerStatusArea`, not a sibling of `Timeline`) changed. See [Thinking / working indicator](#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649), [Composer status row](#composer-status-row-796), and [The open-conversation reader cutover](#the-open-conversation-reader-cutover-758) above.
- **`ComposerStatusArea({ isRunning, children, trailing })`** — **bound in [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796); gained the optional `trailing` slot in [#797](https://github.com/pyrycode/pyrycode-desktop/issues/797).** In-file `ConversationScreen.tsx` function; the container supplies `isRunning={isTurnRunning(phase)}`, mounts `<ThinkingIndicator/>` as `children`, and — since #797 — `<ComposerErrorChipControl/>` as `trailing`, the row's own sibling slot rendered bare. See [Composer status row](#composer-status-row-796) and [Composer error chip](#composer-error-chip-797) above.
- **`ComposerErrorChip({ status })` / `ComposerErrorChipControl`** — **bound in [#797](https://github.com/pyrycode/pyrycode-desktop/issues/797).** `ComposerErrorChip` is the exported pure view (`status` as a prop, gated on `status.type === 'error'`, never destructuring `status.error`); `ComposerErrorChipControl` is the module-private, store-bound container reading only `selectStatus`, mounted as `ComposerStatusArea`'s `trailing`. See [Composer error chip](#composer-error-chip-797) above.
- **`StallIndicator({ isStalled })`** — **bound in [#317](../codebase/317.md); source moved to the open conversation's own slice in [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758).** `ThinkingIndicator`'s own twin over the open slice's `stalled` field, mounted as its sibling right after it. See [Stall indicator](#stall-indicator-317) and [The open-conversation reader cutover](#the-open-conversation-reader-cutover-758) above.
- **`ApiRetryIndicator({ retry })`** — **bound in [#493](../codebase/493.md); source moved to the open conversation's own slice in [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758).** `ThinkingIndicator`'s supersede peer over the open slice's `apiRetry` field, mounted right after `Timeline` and before `StallIndicator` (through #796, `ThinkingIndicator` itself sat between them in the DOM; #796 moved its markup into the composer status row, leaving this trio contiguous below `Timeline` — the mount order between `ApiRetryIndicator`/`CompactingIndicator`/`StallIndicator` is unchanged); also narrows `ThinkingIndicator`'s own gate via the new `shouldShowThinking` predicate. See [Api-retry indicator](#api-retry-indicator-493) and [The open-conversation reader cutover](#the-open-conversation-reader-cutover-758) above.
- **`CompactingIndicator({ isCompacting })`** — **bound in [#496](../codebase/496.md); source moved to the open conversation's own slice in [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758).** `ThinkingIndicator`'s second supersede peer over the open slice's `compacting` field, mounted right after `ApiRetryIndicator` and before `StallIndicator`; extends `shouldShowThinking` by one field and one clause. See [Compacting indicator](#compacting-indicator-496) and [The open-conversation reader cutover](#the-open-conversation-reader-cutover-758) above.
- **`PermissionModal()`** — **bound in [#224](../codebase/224.md); made answerable in [#237](../codebase/237.md); gained a second-confirm gate in [#226](../codebase/226.md); gained a rejection surface in [#249](../codebase/249.md); its second-confirm marker was re-keyed from a bare option id to `{modalId, optionId}` in [#511](../codebase/511.md).** Reads the [modal store](modal-store-bridge.md)'s `selectOutstanding`, `selectRejections`, and `dispatch`, mounted as the last child of `.conversation`. `null` only when both the outstanding prompt and the rejection list are empty; the default option and Cancel dispatch a command and clear the prompt locally immediately, any other option holds pending a `Back`/`Confirm` sub-step first scoped to the prompt it was selected on, and a round-tripped rejection renders a dismissible banner independent of the prompt. See [Permission modal](#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511) above.
- **`TimelineRow`'s `case 'sessionBoundary'`** — **bound in [#286](../codebase/286.md); redrawn as one hairline/label/hairline row and re-copied in [#690](https://github.com/pyrycode/pyrycode-desktop/issues/690).** Reads the fifth `ThreadItem` kind [thread timeline](thread-timeline.md) gained, deriving its label from the exhaustive `sessionBoundaryTitle(item)` in `sessionBoundaryViewModel.ts` — no `now` input since #690 dropped the row's relative time. See [Session-boundary delimiter](#session-boundary-delimiter-286-redrawn-690) above.
- **`QueuedBacklog({ items, onDrop })` / `QueuedBacklogControl`** — **render bound in [#294](../codebase/294.md); `onDrop` (required) bound in [#296](../codebase/296.md).** `QueuedBacklogControl` reads the [queue store](queue-store.md)'s `selectBacklogFor(MILESTONE_CONVERSATION_ID)` and binds `onDrop` to the pure `dropQueuedMessage` (`dropQueuedMessage.ts`), which dispatches `dequeueMessageCommand` and nothing else — no local mutation. See [Queued backlog + drop affordance](#queued-backlog--drop-affordance-294-drop-since-296) above.
- **`ScreenSnapshotView({ snapshot, canRequest, onRequest })` / `ScreenSnapshotControl`** — **bound in [#324](../codebase/324.md); removed in [#618](../codebase/618.md).** Read `useSessionStore(selectStatus)` and the [screen-snapshot store](screen-snapshot-store.md)'s `selectScreenSnapshot`, and mounted between `StatusRow` and `InterruptControl`, until #618 took the view, its container and `requestScreenSnapshot.ts` out; the store itself was then deleted outright by [#619](../codebase/619.md). See [Screen-snapshot action & display](#screen-snapshot-action--display-324-removed-618) above.
- **`WorkspacePickerSheetView({ workspaces, activeCwd, now?, onClose, onChoose?, onCreateFolder? })` /
  `WorkspacePickerSheet`** — **bound in [#383](../codebase/383.md).** `WorkspacePickerSheetView` is the
  exported pure view; `WorkspacePickerSheet` is the in-file container mounting `RecentWorkspacesData`
  (#382), reading `useRecentWorkspacesStore(selectRecentWorkspaces)`, deriving `activeCwd` from
  `activeConversationStore`, and supplying `onChoose` only for a non-null active conversation.
  `WorkspaceChip`'s `onChange` now calls `() => setPickerOpen(true)` — see [Workspace Picker
  sheet](#workspace-picker-sheet-383) above.
- **`BackgroundTaskPanelView({ entry, onClose })` / `BackgroundTaskPanel` / `BackgroundTaskTrigger({ onOpen })`** — **bound in [#581](../codebase/581.md).** `BackgroundTaskPanelView` is the exported pure view (`entry` as `selectRosterFor`'s exact return type — the nullable prop is what forces the three-way branch at a testable boundary); `BackgroundTaskPanel` is the in-file container reading [`backgroundTaskRosterStore`](background-task-roster-store.md) via a `useMemo`-stable selector and owning the Escape effect; `BackgroundTaskTrigger` is a `StatusRow`-sibling icon button, mounted unconditionally. **Gained the partial-list notice and per-task cut markers in [#582](../codebase/582.md)**, and **the held `latestUpdate` patch, its own empty/non-empty reading, and its own cut marker in [#583](../codebase/583.md)**, all read straight off the same `entry` prop with no signature change. See [Background-task panel](#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583) above.
- **`ChannelInfoSheetView({ conversation, now?, onClose })` / `ChannelInfoSheet`** — **shell + About detail bound in [#365](../codebase/365.md).** `ChannelInfoSheetView` is the exported pure view (`conversation` as a prop, sourced from `activeConversationStore`); `ChannelInfoSheet` is the in-file container owning only the Escape effect. The `ThreadOverflowMenu`'s `onChannelInfo` now calls `() => setChannelInfoOpen(true)` — the speculative `ConversationScreenProps.onChannelInfo?` prop #276 reserved is **retired**, not bound; see [Channel Info sheet](#channel-info-sheet-365) above. **Rename bound in [#368](../codebase/368.md):** the `.channel-info__actions` slot's first filler, an `onRename?` prop supplied by the container only in the `conversation !== null` branch, opening the reused [Rename dialog](rename-conversation-dialog.md) (#360) — see [Channel Info sheet](#channel-info-sheet-365) above. **Archive bound in [#366](../codebase/366.md):** the slot's second filler, an `onArchive?` prop under the same null-guard, dispatching the already-shipped [`archiveConversation` command](conversation-archive.md) (#363) then closing the sheet — see [Channel Info sheet](#channel-info-sheet-365) above. **Delete bound in [#377](../codebase/377.md), completing the slot:** the third and final filler, gated the same way (`onDelete?` supplied only for a non-null active conversation) but dispatch is two-step — `onDelete` opens an inline confirm (a client-owned invention, no Figma node, the #226 second-confirm posture) that swaps in for the pill; confirming dispatches the already-shipped [`deleteConversation` command](conversation-delete.md) (#364) via a new `requestDeleteConversation` helper then closes the sheet, cancelling returns to the pill with no wire effect. The pill and confirm's destructive styling is a new `.channel-info__action--danger` modifier (error-tinted outline via `box-shadow: inset`, since desktop has no error-container fill token). `window.pyry` is dereferenced only inside the confirm handler; the confirm's own open state (`deleteConfirmOpen`) is screen-local `useState`, the `renameOpen` twin.

## Edge cases and limitations

- An **empty `items` array** renders a valid empty scroll region — no crash, no placeholder fallback (`Timeline` returns `null`). A just-connected session with no messages yet renders a clean empty thread. (Historical: before [#179](../codebase/179.md) this was the coarse `messages` array; `sessionStore.messages` still returns `[]` on initial state, but nothing reads it in production anymore.)
- Since [#179](../codebase/179.md), the timeline is the **only** thread surface — no split-brain, no empty second region. `MessageThread`/`selectMessages` are retained but unread residue.
- The send button is **wired** ([#66](../codebase/66.md)): a click (or Enter) sends the composed message and appends an optimistic echo, now into the timeline ([#179](../codebase/179.md)). A whitespace-only input does nothing; a send-bridge failure is swallowed (no crash). See [Composer send](composer-send.md).
- **Dark scheme only**; no responsive layout beyond flex reflow; no desktop-native layout (the plan defers that until the app is fully functioning).
- **Connection banner** ([#279](../codebase/279.md)) — renders across the top of the thread whenever `selectStatus` is not `connected`, disappearing on reconnect with no reload; text is always the client-owned `CONNECTION_BANNER_COPY`, never `ConnectionError.message`. Coexists with the composer's own terse hint (#31) — both remain visible while disconnected, by design (distinct copy registers, not a duplicate).
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
  edits. Every chrome sibling below the thread (`__stall`/`__api-retry`/`__compacting`/`__queued`/
  `__interrupt`) can mount or unmount with no risk of un-pinning a thread the operator never scrolled — a
  chrome mount only shrinks the thread's viewport, which cannot fire a scroll event. **`.conversation__thinking`
  left this list in [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796):** its markup now lives
  inside the composer status row, a fixed-height element that is mounted at all times, so
  `turn_state{thinking}` no longer shrinks anything — it only swaps a label inside an already-present row.
  `thread-scroll-pin.spec.ts`'s fourth criterion existed specifically to prove a chrome mount shrinks the
  thread without un-pinning it; left pointed at the working indicator it would have kept passing against a
  viewport that had stopped moving, silently testing nothing. #796 repointed it onto the stall indicator
  (`.conversation__stall`), which kept its own bubble treatment and still shrinks the region — the daemon's
  `stall` frame drives it, with `conversationActivityBridge.ts`'s unconditional stall-clear-on-any-turn-state
  independently confirmed to make the subsequent `toHaveCount(0)` assertion correct rather than incidental.
  `overflow-anchor` stays unset (closed as indifferent, confirmed on an observed
  e2e run, not just reasoning). **Send-forces-pin** ([#602](../codebase/602.md)) rides this exact
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

## Related

- [Welcome screen](welcome-screen.md) — the mark's original home; [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) moved the shared `PyryMark` component into `theme/PyryMark.tsx` so the composer status row's icon and the welcome hero's mark are the same 12 KB path, not a drifted copy; the welcome screen's own call site and markup are unchanged.
- [App shell](app-shell.md) — the router that mounts the `paired`/`conversation` route (#80); gains the `onUnpaired` reverse-flip seam this screen's unpair control fires (#166)
- [Paired shell](paired-shell.md) — the second-level `list ⇄ thread` router now mounting this screen as its `thread` view (#140); source of the `onBack` seam this screen's back control fires; its `conversation_created` nav callback now also writes `activeConversationStore` (#278), routed since [#530](../codebase/530.md) through `activateConversation`, which clears the timeline and session id first when the active conversation's id actually changes; its `onUnpaired`/`onPairServerPaired` handlers clear `activeConversationStore` unconditionally since [#531](../codebase/531.md), via `clearPairingScopedState`, when the pairing itself ends
- [Session store](session-store.md) — the state the coarse thread rendered through #69–#178; the `MessageThread`/status seams bound to it (#2, bound in #69); gains the `reset` action the unpair control dispatches (#166); its `messages` slice is unread residue since [#179](../codebase/179.md) (status/`selectStatus` is still live, read by the composer's send gate)
- [Composer send](composer-send.md) — the composer's now-wired submit + optimistic echo (#66), retargeted from the session store into the timeline store since [#179](../codebase/179.md); the send half of this screen; also home of `shouldShowBanner`/`CONNECTION_BANNER_COPY` (#279), the connection banner's predicate + copy, co-located beside `composerAvailability`/`shouldOfferRepair` as a third read of `ConnectionStatus`
- [Unpair channel](unpair-channel.md) — the main-side `window.pyry.unpair()` bridge this screen's unpair control consumes (#173, consumed in #166); the re-pair control reuses the same bridge via `runUnpair` (#167)
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) — the main-process consumer the Log data section's Download button and its three daemon events finally drive (#169, consumed in #72)
- [Run configuration store](run-config-store.md) — the dedicated store the headless data path `<RunConfigData/>` feeds (#187) and `<RunConfigSections/>` reads via `selectSnapshot` (#188, widened by #192); mounted as the sheet body's first two children, ahead of `<LogDataSection/>`; since #810 also fed app-lifetime by `RunConfigLiveData`, which is what lets [Composer footer row](#composer-footer-row-811)'s `ContextUsageControl` read a live figure with no sheet ever opened
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the original transport data path (#180, extended #191) `<RunConfigData/>` consumed via `snapshotReceived` until #491/#500 moved it onto [Run configuration store](run-config-store.md)'s `runConfigReceived`; also hosted the `requestSnapshot` command (removed #620), the `screenSnapshotReceived` event #324's now-removed control used to send and render (#316, #324, removed #618), and both events removed outright by [#621](../codebase/621.md)
- [Screen-snapshot store](screen-snapshot-store.md) — the dedicated store (#323), reader-less since [#618](../codebase/618.md) removed `ScreenSnapshotControl`, its former sole consumer (#324), then deleted outright by [#619](../codebase/619.md)
- [Relay-link store](relay-link-store.md) — the dedicated store (#329) `<ConnectionStatusIndicatorControl/>` reads via `selectRelayLinkStatus`, its first real consumer; combined at render time with [session store](session-store.md)'s `ConnectionStatus` (#330)
- [Conversation timeline store](conversation-timeline-store.md) / [Thread timeline (conversation model)](thread-timeline.md) — the flat store and model this screen read through [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758): `<Timeline/>` via `selectItems` (#203); the `useTimelineBridge()` twin of `useDaemonEventBridge()` mounted in `App.tsx` (still mounted, still dual-writing); `<ThinkingIndicator/>` via `selectPhase` (#215); the `toolCall` items `TimelineRow`'s pending chip renders (#218, transport #217) and now resolves in place once `result` fills (#230, transport #229); `Composer` writes to this store's `dispatch` as the `userText` producer (unchanged — still the flat store, see below), and `TimelineRow`'s `case 'userText'` draws the echo (#179) — the vertical's last piece; the fifth `ThreadItem` kind, `sessionBoundary`, is translated by the bridge and drawn by `TimelineRow`'s new case (#286, transport #285); `<StallIndicator/>` via `selectStalled` (#317, transport #315); `<ApiRetryIndicator/>` via `selectApiRetry`, and the exported `shouldShowThinking` predicate reading it alongside `selectPhase` to narrow `<ThinkingIndicator/>`'s gate (#493, transport #492); `<CompactingIndicator/>` via `selectCompacting`, and `shouldShowThinking` gaining a second clause reading it to narrow `<ThinkingIndicator/>`'s gate again (#496, transport #495)
- [Conversation timeline holder](conversation-timeline-holder.md) — as of [#758](https://github.com/pyrycode/pyrycode-desktop/issues/758), the store all six reads above and (until [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678) retired `InterruptControl`) its `phase` actually come from: one subscription to `selectTimelineFor(openConversationId)` on this screen, keyed by `activeConversationStore`'s open id. The flat store above stays mounted and dual-written (the bridge fan-out, `Composer`'s echo) but is read only by nothing in this screen any more. See [The open-conversation reader cutover](#the-open-conversation-reader-cutover-758) above.
- [Interrupt envelope](interrupt-envelope.md) — since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678), the stop-a-running-turn affordance this screen renders is a variant of `Composer`'s own send button (`ComposerSendButton`), not a standalone control; the `phase` prop plumbed through this screen feeds it directly.
- [Modal store + bridge](modal-store-bridge.md) — the store `<PermissionModal/>` reads via `selectOutstanding` (#224) and now also `dispatch` (#237); the `useModalBridge()` third independent subscriber mounted in `App.tsx` beside `useDaemonEventBridge()`/`useTimelineBridge()`, live since [#179](../codebase/179.md) flipped `interactive` (dormant #223–#178)
- [Modal resolution envelope](modal-resolution-envelope.md) / [Command channel](command-channel.md) — the `answerModalCommand`/`cancelModalCommand` this screen's `PermissionModal` now dispatches through `modalResolution.ts` (#237), routed main-side by [Daemon connection](daemon-connection.md)'s `answerModal`/`cancelModal` (#236); gated behind a `selectOption` client-side second-confirm on `defaultOptionId` for any non-default answer (#226) — no wire/envelope change, the gate lives entirely in `modalResolution.ts`/`PermissionModal.tsx`
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — `class` is `permission | trust` only, no `destructive` wire class; the premise #226's second-confirm gate is a client-side stand-in for
- [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `role→'daemon'` / `message_id→id` adapter seam deferred to this screen
- [ADR 0006 — ephemeral screen-local state](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the `useState` boolean the Run configuration sheet's open/close toggle follows (#177); the `useReducer` phase-machine the Log data download state follows (#72)
- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md) — gains `--color-surface-container-low` + `--color-scrim` (#177); gains `--color-secondary-container` + `--color-on-secondary-container` (#72); gains `--color-surface-container-highest` (#188, reused by #192's context-window track — 0 new tokens)
- [Queue store](queue-store.md) / [Dequeue message envelope](dequeue-message-envelope.md) — the store `<QueuedBacklogControl/>` reads via `selectBacklogFor(MILESTONE_CONVERSATION_ID)` (#293, consumed in #294), and the outbound command the drop affordance's `dropQueuedMessage` dispatches (#299/#300, consumed in #296) — the queue-drop family is now complete end to end.
- [Recent-workspaces store](recent-workspaces-store.md) — the dedicated store + dormant bridge `WorkspacePickerSheet` reads via `selectRecentWorkspaces` and mounts (`RecentWorkspacesData`), its first real consumer (#382, consumed in #383)
- [Conversation workspace change](conversation-workspace-change.md) — the `changeWorkspace` command `requestChangeWorkspace` dispatches on a row choice, its first real caller (#379, consumed in #383)
- [Background-task roster store](background-task-roster-store.md) — the store `BackgroundTaskPanel` reads via `selectRosterFor(conversationId)`, its first real consumer since the store shipped dormant at #573 (#581, extended to read `droppedTasks`/`truncatedFields` in #582 and `latestUpdate` in #583, see [Background-task panel](#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583) above)
- [Assistant markdown renderer](assistant-markdown-renderer.md) — `AssistantMarkdown`, shipped dormant at #608, wired into this screen's `assistantText` settled branch by [#609](../codebase/609.md); the `.bubble__markdown` container and its block-rhythm/code-wrap CSS live in `conversation.css`, not in that module
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md), [ADR 0002 — Remote head over relay](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#1 codebase notes](../codebase/1.md) · [#69 codebase notes](../codebase/69.md) · [#166 codebase notes](../codebase/166.md) · [#177 codebase notes](../codebase/177.md) · [#72 codebase notes](../codebase/72.md) · [#167 codebase notes](../codebase/167.md) · [#187 codebase notes](../codebase/187.md) · [#188 codebase notes](../codebase/188.md) · [#191 codebase notes](../codebase/191.md) · [#192 codebase notes](../codebase/192.md) · [#203 codebase notes](../codebase/203.md) · [#140 codebase notes](../codebase/140.md) · [#214 codebase notes](../codebase/214.md) · [#215 codebase notes](../codebase/215.md) · [#217 codebase notes](../codebase/217.md) · [#218 codebase notes](../codebase/218.md) · [#229 codebase notes](../codebase/229.md) · [#230 codebase notes](../codebase/230.md) · [#245 codebase notes](../codebase/245.md) · [#179 codebase notes](../codebase/179.md) · [#237 codebase notes](../codebase/237.md) · [#226 codebase notes](../codebase/226.md) · [#279 codebase notes](../codebase/279.md) · [#285 codebase notes](../codebase/285.md) · [#286 codebase notes](../codebase/286.md) · [#278 codebase notes](../codebase/278.md) · [#323 codebase notes](../codebase/323.md) · [#324 codebase notes](../codebase/324.md) · [#328 codebase notes](../codebase/328.md) · [#329 codebase notes](../codebase/329.md) · [#330 codebase notes](../codebase/330.md) · [#492 codebase notes](../codebase/492.md) · [#493 codebase notes](../codebase/493.md) · [#495 codebase notes](../codebase/495.md) · [#496 codebase notes](../codebase/496.md) · [#365 codebase notes](../codebase/365.md) · [#366 codebase notes](../codebase/366.md) · [#368 codebase notes](../codebase/368.md) · [#377 codebase notes](../codebase/377.md) · [#383 codebase notes](../codebase/383.md) · [#529 codebase notes](../codebase/529.md) · [#530 codebase notes](../codebase/530.md) · [#581 codebase notes](../codebase/581.md) · [#582 codebase notes](../codebase/582.md) · [#583 codebase notes](../codebase/583.md) · [#600 codebase notes](../codebase/600.md) · [#601 codebase notes](../codebase/601.md) · [#618 codebase notes](../codebase/618.md) · Spec: `docs/specs/architecture/1-app-shell-and-theme-tokens.md`
