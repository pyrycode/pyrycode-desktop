# Conversation shell — chrome and controls

The screen's structure and the persistent controls around the thread: layout, theme, the back, unpair and re-pair controls, and the connection surfaces in the header.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Structure

`App.tsx` mounts `<ConversationScreen />` as the **thread view** of the [paired shell](paired-shell.md)'s `list ⇄ thread` router, itself mounted on the `conversation` route ([#80](../codebase/80.md) — see [App shell](app-shell.md); before #80, `App` rendered it directly; before [#140](../codebase/140.md), `AppView` rendered it directly on the `conversation` route with no list and no way back). The screen is a flex column:

```
ConversationScreen            .conversation        (flex column, full height, position: relative)
├── ThreadOverflowMenu         .conversation__overflow (trigger + menu, gated on onBack, #276; grew from 1 to 3 items in #962; the band's last survivor since #1064 deleted the leading arrow it used to balance; the card's own drawn in-flow top bar since #1444 — a 24px trigger justified to the trailing edge over a full-width 1px rule, no longer an absolute box)
├── ConnectionBannerControl    .conversation__banner (null unless not-connected, top of thread, #279; the first thing under the overflow menu's gate since #1061 deleted the header row that used to sit here — and, since #1064, the first thing in `.conversation` at all)
├── WorkspaceChip              .conversation__workspace-chip (null unless empty + unpromoted, #278; onChange opens WorkspacePickerSheet, #383)
├── Timeline                  .conversation__thread (null when empty; the single thread surface since #179, #203)
│   └── TimelineRow × N       .message-row--user/.bubble--user (userText, #179) · .message-row--daemon/.bubble--daemon (assistantText) · .tool-row/.tool-row__chip (toolCall, #218; resolved modifiers #230)
├── (ApiRetryIndicator / CompactingIndicator / StallIndicator — the three problem-state bubbles right after Timeline; unaffected by #796, see below)
├── (the region between the thread and the composer is EMPTY since #962 — the run-config row (#177) and the background-task trigger (#581) that used to mount here are retired; both overlays still open, now from the overflow menu above)
├── ComposerStatusArea         .composer-status     (content-sized row above the composer; NEVER null, #796; min-height not height since #963)
│   ├── ThinkingIndicator       .composer-status__label ("Thinking…"/"Working…"/"Running <tool>…", #648, #649; off the daemon-bubble surface since #796)
│   └── ComposerErrorSlotControl .composer-status__error (row's trailing slot, right-aligned; null unless the `error` connection arm, #797; button vs chip since #963, see the composer doc)
├── Composer                  .composer            (pinned)
│   ├── ComposerActionsMenu     .composer__footer    (leading item, opens the shared options panel — #680)
│   └── ContextUsageControl     .composer__footer    (second child, below `.composer__row`; the other three desktop-layout slots (#682/#683/#685) stay empty, #811)
├── StatusSheet (if open)     .status-sheet-overlay (absolute overlay, #177)
├── ChannelInfoSheet (if open) .status-sheet-overlay (absolute overlay, #365)
├── WorkspacePickerSheet (if open) .status-sheet-overlay (absolute overlay, #383)
├── BackgroundTaskPanel (if open)  .status-sheet-overlay (absolute overlay, interim chrome pending #580, #581)
└── PermissionModal (if any)  .permission-modal-overlay (absolute overlay, last child, null when no outstanding prompt, #224)
```

`MessageBubble` and `Composer` are **in-file functions** inside `ConversationScreen.tsx` — they are tiny. (`UnpairControl` was a third until [#1061](https://github.com/pyrycode/pyrycode-desktop/issues/1061) deleted it — see [Unpair control](#unpair-control-166-deleted-by-1061) below.) `MessageThread` and `StatusSheet` are also in-file but **exported** ([#69](../codebase/69.md), [#177](../codebase/177.md)), so tests server-render them as pure views — `RepairPrompt` joined them in [#167](../codebase/167.md) and was retired, folded into `ComposerErrorSlot`, by [#963](https://github.com/pyrycode/pyrycode-desktop/issues/963); see [Re-pair control](#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963) below. `PermissionModal`/`PermissionModalView` live in their own file, `PermissionModal.tsx` ([#224](../codebase/224.md)), the same split one level up. `ConversationScreen` is the store-bound container; `MessageThread`/`StatusSheet`/`PermissionModalView` are the props-in/markup-out views — the same container/view split `PairingScreen`/`PairingView` uses ([#55](../codebase/55.md)). The load-bearing contracts are the props/types, not the file boundaries (see Seams).

## Data shape (coarse path — retired residue since #179)

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

**[#179](../codebase/179.md) removed this read from `ConversationScreen`** along with the `MessageThread` mount — `Message`/`toMessageViewModel`/`MessageThread`/`MessageBubble`/`selectMessages` are kept as dead-but-tested residue (a later cleanup ticket removes them), but nothing in production reads or renders them anymore. The live thread's data shape is `ThreadItem` (see [Thread timeline](thread-timeline.md)), read via `useTimelineStore(selectItems)` — see [The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below.

`toMessageViewModel` (in `messageViewModel.ts`) is a pure, exhaustive `switch (m.role)`: `role: 'user' → type: 'user'`, `role: 'assistant' → type: 'daemon'`, `message_id → id`, `text` carried through, `conversation_id` dropped; an `assertNever` default makes a future third `WireRole` a compile error. Selecting only the `messages` slice keeps connection-status changes from re-rendering the thread. Each bubble carries `data-message-role={message.type}` — the test hook the structural render test asserts against.

## Layout contract

Independent scroll rests on three rules; get these right and AC1/AC5 follow:

- `index.css` — `html, body, #root { height: 100% }` establishes the full-height chain; `body { margin: 0 }`.
- `.conversation__thread` — `flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none`. The **`min-height: 0`** is load-bearing: without it a flex item refuses to shrink below its content, so the whole window scrolls instead of the thread region. Since [#1074](https://github.com/pyrycode/pyrycode-desktop/issues/1074) the thread hides its scrollbar to match the design — the Figma message area stacks 1026px of content in a 780px column with no strip reserved for a bar at any depth. `scrollbar-width: none` is the operative declaration on Chromium 130; a separate top-level `.conversation__thread::-webkit-scrollbar { display: none }` rule sits below it as an inert fallback (once the standard property is set, the pseudo-element is never consulted — it's kept for an engine that lacks the property, and written flat rather than nested, since this repo's nine stylesheets use no CSS nesting anywhere). It's a paint change only: `overflow-y: auto` stays, `overflow-anchor` stays absent from the rule (see the drift comment above), and no `tabindex` is added — the wheel, the trackpad and the four scroll keys still reach the region through Chromium's own sequential-focus starting point after a click inside it, and that keyboard path was measured working *before* either declaration landed, so it was never dependent on a bar being drawn.
- `.composer` — `flex: 0 0 auto`: pinned, never grows or shrinks.

**Proving "no scrollbar" needs a computed-style read, not a geometry one, and a neighbour read to rule out a vacuous pass.** `offsetWidth - clientWidth === 0` looks like the natural detector but passes on any machine already drawing overlay scrollbars (no gutter reserved) even with the hiding rule deleted — and this app can't assume the overlay case away, since the composer textarea's own measurement (`clientWidth` 616 → 601 when its own bar appears; see [message box § the box grows with the draft](conversation-shell-composer-message-box.md#the-box-grows-with-the-draft-to-a-five-line-ceiling-1056)) is a layout-taking bar on this same app. The working detector is `getComputedStyle(el).scrollbarWidth`, read together with `.channel-list` and `.composer__input` in the same run so `'auto'` there rules out an engine that just answers `'none'` for every element — one read that both proves the thread hides its bar and proves the sidebar and the composer's deliberate bar are untouched (`e2e/thread-scrollbar.spec.ts`, #1074). Driving the keyboard leg of that same spec needs a raw-coordinate `page.mouse.click` into the thread's own padding strip rather than a locator click: a locator click auto-scrolls its target into view first, which perturbs the very scroll offset the test then asserts on.

Bubbles use `max-width: min(680px, 75%)` (not a fixed width) so they reflow as the window resizes — the desktop divergence from the mock's fixed `330px`. Bubble corners are asymmetric via `border-radius` (order **TL TR BR BL**): the user bubble clips its bottom-right, the daemon bubble its bottom-left.

## Theme

Every style references a token from `theme/tokens.css` — no color/type/spacing literal in `conversation.css`. Bare structural geometry (`100%`, flex ratios, the `48px` send button, the bubble measure) stays literal; those are layout, not theme. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

**`.conversation` paints no background since #1058.** It used to paint `--color-surface`, the same
colour the paired shell paints behind it, which is why the pane never read as a pane; the card (a
`--color-scrim` wash + 6px corner) now lives one level out, on `.paired-shell__pane`. `.conversation`'s
pre-existing `position: relative` (kept for the run-config sheet's containing block) already lifts this
whole subtree above that wrapper's `::before`, so the chat pane needed no stacking fix the sidebar
did. See [Paired shell § the pane card](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670).

## Back control (#140, deleted by #1064)

**Deleted outright, not gated or hidden — kept here as history.** The thread's leading return-to-list
affordance, added when the [paired shell](paired-shell.md) gave the conversation screen somewhere to
return *to*. `ConversationScreenProps` gained an **optional** `onBack?: () => void` — the exact
`onUnpaired?` precedent ([#166](../codebase/166.md)): a bare `<ConversationScreen />` with no `onBack`
rendered identically either way, since the in-file `BackControl({ onBack })` returned `null` when the
prop was absent. When present, it rendered a 48px icon-only `<button aria-label="Back">` holding a 24px
inline `arrow_back` SVG glyph (Figma node 16-11, `on-surface`) as the **first child** of `.conversation`.
`PairedShellView` wired it to a nav dispatch (`{ type: 'back' }`) that unmounted this thread. Before
[#670](../codebase/670.md) that also remounted the list screen (`list`/`thread` were mutually
exclusive); since #670 the sidebar list is permanently mounted alongside the thread, so `back` only
emptied the chat pane — "deselect," not "navigate away" — which is what made the control redundant: the
list it deselected *to* was already on screen.

[#1064](https://github.com/pyrycode/pyrycode-desktop/issues/1064) (operator ruling, 2026-09-04) deleted
`BackControl`, its four CSS rules (`.conversation__back`, `:hover`, `:focus-visible`,
`.conversation__back-icon`) and its call site — the desktop drawing's `Content` frame (Figma 106:3321)
has no leading affordance above the thread at all, matching #1061's reading of the same frame for the
header row below. **`onBack` itself survives the control it was named for**: it is the screen's "am I
mounted in the paired shell" signal, and `ThreadOverflowMenu` is gated on its presence ([#276](#structure)
above) — dropping the prop would unmount the overflow menu too, which was not the ask. Nothing inside
`ConversationScreen` calls `onBack` any more; `PairedShellView` still wires it, unused.

The empty pane `back` used to reach from inside the thread is not gone — it is still reachable three
other ways, all landing on route `list` (`back` is absolute in `nextPairedRoute`): the shell enters at
`list`, [Settings](#unpair-control-166-deleted-by-1061) and Archive return there through their own back
controls, and the delete and archive exits dispatch `back` too. What went is the deselect *from inside
the open thread* — the arrow was its only source.

**Through #1064 to #1444**, the thread started ~56px higher (the deleted control's 48px plus its
`--space-1` margins, in a flex column with no top padding) and `.conversation__overflow` —
`position: absolute`, reserving no flow space — floated alone over the thread's top-right corner rather
than sitting beside a control in flow. Both were expected consequences of the deletion, not regressions
to compensate for: no padding, spacer or reserved band was added to hold the old offset.
[#1444](../../specs/architecture/1444-chat-top-bar-and-inset.md) ended that interim by drawing the card's
own top bar (Figma `Content` 106:3321): `.conversation` gained the card's 24/20/16 inset,
`.conversation__overflow` became an in-flow bar — a 24px trigger justified to the trailing edge, a 1px
`--color-primary` rule at 60% opacity 20px under it, 16px of the bar's own foot — and the first message
row now sits at the drawn 97px below the card's top edge. The back affordance is still not coming back;
only the interim absolute-positioned overflow trigger that stood in for it is gone.

The back arrow used to sit ahead of a separate unpair header row, a deliberate interim pending a future
top-app-bar ticket that would consolidate back + title + overflow + unpair into the one bar Figma 16-9
shows. [#1061](https://github.com/pyrycode/pyrycode-desktop/issues/1061) deleted that header row rather
than folding it into such a bar, and #1064 finished the same reading of Figma 106:3321 by deleting the
arrow itself: the bar that eventually gets drawn carries a channel title and a channel settings button,
not unpair or a leading arrow — see [Unpair control](#unpair-control-166-deleted-by-1061) below for
where unpair goes instead. Two comments elsewhere still cite `BackControl` as design provenance rather
than as a rule (`SettingsScreen.tsx` ×2, `ChannelList.tsx` ×1, both naming it as the precedent their own
`BackControl`s mirror) — left as-is; #1064 scoped its comment sweep to citations of the deleted
`.conversation__back` **rule**, not the surviving symbol name that `SettingsScreen`'s and `ArchiveScreen`'s
own, still-live `BackControl`s are named after.

## Unpair control (#166, deleted by #1061)

**Deleted outright, not gated or hidden — kept here as history.** The escape hatch off a stale/dead
conversation screen (no in-app way back to pairing existed before #120's split). Through #1061 this was
a `.conversation__header` row above the thread, right-aligned, holding `UnpairControl` — a screen-local
`useState<'idle' | 'confirming' | 'unpairing'>` phase machine: `idle` showed an `Unpair` trigger;
`confirming` showed `Forget this pairing?` + `Cancel`/`Confirm` (the AC3 accidental-unpair guard);
`unpairing` disabled both buttons while the request was in flight. It called the pure `runUnpair` helper
(`unpairAction.ts`, the `composerSend.ts` precedent: injected effects, spy-tested, no React), which at
the time invoked a now-deleted nullary `window.pyry.unpair()` — the whole-collection arm of the [unpair
channel](unpair-channel.md) (#173), deleted by
[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) — and either dispatched
`{ type: 'reset' }` into the [session store](session-store.md) then called `onUnpaired` (on `ok`), or
dispatched `{ type: 'failed', error: { code: 'unpair', ... } }` and stayed put (on `error` or a rejected
invoke).

[#1061](https://github.com/pyrycode/pyrycode-desktop/issues/1061) (operator ruling, 2026-09-04) deleted
the component, its mount, and the `.conversation__header` rule — the desktop `Content` frame (Figma
106:3321) draws a message area straight onto an input area with no header row at all. Explicit host
removal now lives in
[Settings](settings-screen-how-it-works.md#the-per-row-unpair-action-1162). Composer Re-pair opens
[non-destructive recovery](paired-shell-routing.md#host-recovery-and-navigation-lifetime);
`onUnpaired?` remains only as a compatibility prop on `ConversationScreen`. See
[#166 codebase notes](../codebase/166.md) for the original control and the
[#1061 architecture spec](../../specs/architecture/1061-hide-the-unpair-control.md) for its deletion.

## Re-pair control (#167, folded into the composer status row's error slot by #963)

**Retired as a separate surface by #963 — kept here as history.** Through #167 this was the
**proactive** twin of the unpair control above: a bare `Re-pair` text button in its own
`.composer__repair` block beneath the composer, surfaced the moment the stored pairing could no
longer be used — a terminal transport/handshake failure or a non-retryable daemon rejection.
Closed the live incident (2026-07-07, #120) where a dead connection left the user staring at a
disabled composer with no recovery. #963 replaced it with a filled button in the composer status
row's own right-hand slot — the surface [#797's error chip](conversation-shell-composer-status.md#composer-error-chip-797)
already occupies — on Juhana's 2026-09-02 ruling that an error the operator can act on becomes a
button in that slot rather than a second surface below the composer. `RepairPrompt` and
`RepairControl` (both formerly exported/module-private from this file) no longer exist;
`.composer__repair` no longer exists in the stylesheet. See [Conversation shell — composer §
Actionable-error button](conversation-shell-composer-status.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963)
for the current shape — `ComposerErrorSlot`/`ComposerErrorSlotControl`, beside `ComposerErrorChip`.

The gating predicate is unchanged, reused byte-for-byte, and still lives in `composerSend.ts`
beside `composerAvailability` (see [Composer send](composer-send.md)):

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

The button now opens the host's recovery pane without an erase or preliminary confirmation.
The existing pairing form still requires fingerprint confirmation before saving new credentials.
`ComposerErrorSlotControl` resolves its status and repair target from the open conversation's server;
its click delegates to the shell and never invokes `runUnpair`. See
[the current control](conversation-shell-composer-status.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963)
and [recovery navigation](paired-shell-routing.md#host-recovery-and-navigation-lifetime).

## Connection banner (#279)

A third, independent read of the same `ConnectionStatus` slice `composerAvailability` and
`shouldOfferRepair` already read (see [Composer send](composer-send.md)) — prominent and
disconnected-only, distinct from both `composerAvailability`'s send gate and the separate, always-on #149
two-dot Relay/Pyrycode indicator (not built here). Closes the gap where the thread gave no prominent
disconnected signal. Through [#968](../codebase/968.md), the composer also carried its own muted caption
above the message box for the same fact; that caption is retired and this banner is now the sole
announcement of a non-connected state outside the `error` arm's status-row occupant (#797/#963).

Split from #148 alongside #276/#277/#278; no Figma frame exists (the mobile file draws only the
connected thread), so the copy and accent are design-doc-sourced defaults, mirroring
[#277](../codebase/277.md)'s "no Figma frame" justification shape.

Mirrored the [Re-pair control](#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963)
split exactly, before that control was retired as a separate surface by #963:

- **`shouldShowBanner(status: ConnectionStatus): boolean`** — in `composerSend.ts`, beside
  `composerAvailability`/`shouldOfferRepair`: `status.type !== 'connected'`. True for
  `disconnected`/`connecting`/`error`; false only for `connected`. Unlike `composerAvailability`, this
  is **not** an exhaustive per-arm switch — every non-connected arm maps to the same behavior (show the
  banner), so "show unless connected" is the honest shape, and a hypothetical future 5th
  `ConnectionStatus` arm defaults to *showing* the banner rather than silently hiding it.
- **`CONNECTION_BANNER_COPY`** — also in `composerSend.ts`: a single client-owned string constant
  (`'Cannot reach pyrybox — your messages will not send until the connection is back.'`), lexically
  distinct from the status row's remaining strings (`COMPOSER_ERROR_CHIP_COPY`, `COMPOSER_REPAIR_BUTTON_COPY`
  — [#968](../codebase/968.md) retired the three `composerAvailability` hints this was originally argued
  distinct from) so the prominent banner and the row directly above the message box never read as the
  same string stacked twice. This is the generic non-connected copy; classified pairing rejection
  uses the fixed recovery notice described below.
- **`ConnectionBanner({ status })`** — exported pure view in `ConversationScreen.tsx`. Returns
  `null` when connected; otherwise a `role="status"` paragraph. `pairing-rejected` selects exactly:
  "Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect." Other
  non-connected states use `CONNECTION_BANNER_COPY`. Both are client-owned strings; the view never
  renders `ConnectionError.message`.
- **`ConnectionBannerControl()`** — uses `useOpenConnectionStatus`, shared with the composer send
  gate and repair/error slot. It selects the open conversation's host, falling back to disconnected
  for missing attribution or an unreported host, never to another server's status. See
  [Session store](session-store.md#one-slot-per-server-since-1133).

Mounted directly above `<Timeline />` — the first thing under the overflow menu's gate since #1061
deleted the header row that used to precede it — "the top of the thread." Styled
`.conversation__banner` (`conversation.css`), token-only, following the
`.modal-rejection` (#249) error-accent idiom: `--color-error` left border over
`--color-surface-container-high`, sized to body-medium — deliberately a step up from a muted body-small
caption (the distinction was originally drawn against `.composer__hint`, retired by
[#968](../codebase/968.md)) — `flex: 0 0 auto` so it pushes the thread down rather than overlaying it,
never growing or shrinking.

Not security-sensitive: a pure renderer read of already-store-held status, no transport/crypto/socket
code touched. See [#279 codebase notes](../codebase/279.md) for the full design, the code-review record,
and the apostrophe-escaping test lesson.

## Two-dot Relay/Pyrycode connection-status leg mapping (#330, its render retired from this screen by #962)

Split from [#149](../codebase/149.md): [#328](../codebase/328.md) (relay-leg transport) →
[#329](../codebase/329.md) (renderer [relay-link store](relay-link-store.md)) → #330 (render, in a
`StatusRow`-hosted `ConnectionStatusIndicator`, Figma node `16-58`, mirroring mobile's
`ConnectionStatusLine`). **#962 deleted `ConnectionStatusIndicator` and its store-bound container
`ConnectionStatusIndicatorControl`, along with the `StatusRow` that hosted them** — the desktop design
draws nothing in that region (see [above](#structure)). What survives in this file is the two
exported pure mapping functions below: `relayLeg`/`daemonLeg`/`ConnectionLeg` are still imported by
`channels/ChannelList.tsx`, whose `HostConnectionDots` (#718) has rendered the same two legs on the
sidebar's host row since before this ticket and is now the app's **only** two-dot connection surface.
See the [Channel List home screen](channel-list-host-row.md#the-host-rows-connection-dots-channellisttsx-added-by-718)
doc for the current UI, and [below](#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962)
for what replaced the row that hosted this indicator.

Two independently-read legs — the relay-socket leg from `relayLinkStore` and the daemon-session leg
from [session store](session-store.md)'s `ConnectionStatus` — turn into two labelled, colour-coded
dots. Complements the disconnected-only [Connection banner](#connection-banner-279) — the banner
announces failure, the dots are the persistent at-a-glance state.

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
| `error` with `pairing-rejected` | down | `Pyrycode Pairing rejected` |
| Other `error` | down | `Pyrycode Offline` — error message text is never rendered |

Both functions `switch` with an explicit `ConnectionLeg` return type and **no `default`** — the
standing desktop exhaustive-switch guard (TS2366), so a future `RelayLinkStatus`/`ConnectionStatus`
member fails the build here. **Neither leg's category ever references the other** — this is
structural, not a convention: after a fatal session close (`4401`/`4421`/`4426`) the relay leg is
left at its last value (typically `connected`) by design (#328's forward decision), so relay = up
while daemon = down is a legitimate, intended render, not a bug the mapping functions reconcile. A
retryable `daemon-absent` (4404) close similarly leaves the daemon leg at `connecting` (in-progress,
never down) while the relay leg reads up/"Reachable" — both legs are honest about their own hop only.

**Retired by #962 (kept as history — the render no longer exists, the mapping below still does).**
`ConnectionStatusIndicator({ relay, daemon })` used to be the exported pure view: a
`<span className="status-row__connection" role="group" aria-label="Connection status">` holding one
`.conn-leg` per leg (relay first, then daemon), each a `.conn-dot--{category}` (`aria-hidden`,
decorative — colour is redundant with the label) plus a `.conn-leg__label` span, mounted inside
`StatusRow`'s `.status-row__summary` span by a store-bound container, `ConnectionStatusIndicatorControl`
(`useRelayLinkStore(selectRelayLinkStatus)` + `useSessionStore(selectStatus)`, the
two-independent-store precedent `QueuedBacklogControl` used to set before
[#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) retired it — re-anchored here by
[#618](../codebase/618.md) after the original, `ScreenSnapshotControl`, was removed). Initial state was one Unknown dot and one
Offline dot — the relay leg's `null` sentinel reads `unknown`/`Relay Unknown` since
[#719](../codebase/719.md) (previously collapsed into a second `down`/`Relay Offline`, #330's original
choice), while the daemon leg's `disconnected` still reads `down`/`Pyrycode Offline`; that initial-state
fact still holds for `HostConnectionDots` on the sidebar, the surface that now owns this render. Its
`useRelayLinkStore`/`selectRelayLinkStatus` import went with it — `ConversationScreen.tsx` no longer
reads the relay-link store at all.

New theme token `--color-warning: #ffca45` (`tokens.css`, after `--color-error`) drives the
in-progress category — M3 has no warning role and the design-system file has no such variable (the
two-dot line post-dates the 2026-05-08 Figma lock, a code-era addition like the dots themselves).
[#719](../codebase/719.md)'s `unknown` category reuses the existing `--color-outline` token (no new
token added) — the same achromatic fill already used for the `.run-config__switch-knob`/
`.settings__switch-knob` off-state chips, chosen because it is the only achromatic option among the
four categories and carries no success/failure valence. `.conn-leg__label` (`.status-row__connection`'s
per-leg text, retired with it) was `body-small` on `--color-on-surface-variant`, `white-space: nowrap`
— `.conn-dot`, the shared 8px-circle base both this indicator and the sidebar dot once could have worn,
had no consumer once this indicator went and was deleted with it; **[#962 confirmed that before
deleting it](channel-list-host-row.md#the-host-rows-connection-dots-channellisttsx-added-by-718)** — the
sidebar dots wear the four category modifiers flat, with no base class, and always have.

Not security-sensitive: pure presentation over already-classified, content-free store state (#328's
guarantee) — no transport, crypto, or socket code touched. See [#330 codebase
notes](../codebase/330.md) for the full original design, the leg → category → label matrix tests, and
the code-review record — and [#962](https://github.com/pyrycode/pyrycode-desktop/issues/962) for the
retirement.

**The four `.conn-dot--*` colour rules moved to `channels.css` in #962**, landing beside
`.channel-list__host-dot` — the block's own comment had instructed whoever deleted the rest of
`.status-row__connection` to move rather than drop them, since the sidebar wears the modifiers with no
base class and a lost binding would blank its dots silently, invisible to the `renderToStaticMarkup`
unit tier. `e2e/connection-dot-colours.spec.ts` now reads the shipped `getComputedStyle().backgroundColor`
back off all four to guard exactly that regression. `relayLeg`/`daemonLeg`/`ConnectionLeg` — the TS
mapping above — stayed in this file and are imported into `channels/ChannelList.tsx` unchanged, whose
`HostConnectionDots` (#718) has rendered the same two legs as a label-less dot pair on the sidebar's
host row (host leg first, the reverse of this section's retired `ConnectionStatusIndicator(relay,
daemon)` order) since before this ticket, and is now the app's only two-dot connection surface. See the
[Channel List home screen](channel-list-host-row.md#the-host-rows-connection-dots-channellisttsx-added-by-718)
doc and [#718 codebase notes](../codebase/718.md) for the sidebar's own design, and
[below](#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962)
for what happened to the row and trigger that used to sit either side of this indicator.

## Run-configuration row and background-task trigger retired, overflow menu grows to three items (#962)

The desktop design (Figma `102:4`) stacks the message area straight onto the input area, so the region
between the thread and the composer is empty — nothing is drawn there. Two mobile-era controls used to
mount in that region and both are retired: the run-configuration trigger row, `StatusRow` (#177, which
hosted the two-dot indicator just above), and the background-task trigger, `BackgroundTaskTrigger`
(#581, the clock icon — see [Background-task panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)).
Both overlays they opened — `StatusSheet` and `BackgroundTaskPanel` — stay: the sheet is still the
only surface for the model/effort/YOLO writes until #683 lands and the only home of the log-data
download (#72), and the panel is unchanged pending #580's drawing of its final form and trigger.

Both keep an entry point in the thread's overflow menu (`ThreadOverflowMenu` / `ThreadOverflowMenuView`,
\#276 — see the [structure diagram](#structure) above and
[Channel Info sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) for the
menu's first item), which grows from one hardcoded `Channel info` item to three, in order: `Channel
info`, `Run configuration`, `Background tasks`. The three labels are **literals inside the pure view**
(`ThreadOverflowMenuView`), mapped from a local array rather than injected as props — deliberately: the
container `ThreadOverflowMenu` is in-file and not exported, the screen gates the menu on `onBack`, and
the `renderToStaticMarkup`-only unit tier fires no clicks, so this view is the only surface on which
the unit tier can see the shipped copy and its order at all, and those two new strings are also the
accessible names the e2e suite's re-pointed opens locate by. `ThreadOverflowMenu`'s single `select`
became a factory (`select = (action) => () => { close; action(); returnFocus }`) so the same
close → invoke → return-focus sequence AC2 asks for is written once and shared by all three items, and
its three action props (`onChannelInfo`, `onRunConfiguration`, `onBackgroundTasks`) are now **required**
rather than #276's optional `onChannelInfo?` — that optionality only ever existed because the menu
shipped before #365 wired its one item; with all three wired at the single mount site now, a required
prop turns a forgotten wire into a compile error instead of a menu item that silently closes and does
nothing. None of the three items advertises `aria-haspopup="dialog"`, matching `Channel info`'s existing
posture — a hint on two of three items and not the first would read as a difference between them, and
the bare-tree `aria-haspopup="menu"` count assertion stays correct at 1.

The two retired triggers' bodies moved verbatim onto the menu: `onRunConfiguration={() =>
setSheetOpen(true)}` and `onBackgroundTasks={() => setPanelOpen(true)}` are exactly what the deleted
`StatusRow`/`BackgroundTaskTrigger` did from their own mounts — the overlays and their `useState`
open/closed cells ([ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)) are
untouched, only the affordance that flips them moved. `ThreadOverflowMenu` is itself mobile-era chrome
that a later ticket retires together with the sheet, once #683 lands the footer's model and effort
controls.

**One known gap, left deliberately.** The `Background tasks` item's wire (`onBackgroundTasks={() =>
setPanelOpen(true)}`) has no test at any tier — the unit tier sees the menuitem's label and position but
not what it flips, and no e2e spec touches the panel at all (a gap #581 shipped with, not one #962
opened). Code review flagged it [SHOULD FIX], not blocking: the sibling wire through the identical
`select` factory and the identical menu shape is proven end to end by `run-config-settings.spec.ts` and
`stall-bundle.spec.ts`, so a structural bug in the factory would redden there, and #580 owns the panel's
final trigger and will re-point whatever lands here anyway. A ~10-line fake-tier spec (overflow trigger
→ menuitem `Background tasks` → `.background-task-panel` visible) is the fix, whenever #580 lands.

Four comments elsewhere had to be corrected on the move (`channels.css`'s `.channel-list__host-dot`
comment — see [above](#two-dot-relaypyrycode-connection-status-leg-mapping-330-its-render-retired-from-this-screen-by-962)
— and its two `.conversation-status-dot` doc comments, plus `ChannelList.tsx`'s `HostConnectionDots`
comment, both documented in the [Channel List home screen](channel-list.md) doc). Nineteen other sites
naming the deleted classes and components are left untouched — prose anchors citing a precedent that
did exist, not claims about current state.
