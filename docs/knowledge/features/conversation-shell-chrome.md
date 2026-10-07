# Conversation shell — chrome and controls

The screen's structure and the persistent controls around the thread: layout, theme, the back, unpair and re-pair controls, and the connection surfaces in the header.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Structure

`App.tsx` mounts `<ConversationScreen />` as the **thread view** of the [paired shell](paired-shell.md)'s `list ⇄ thread` router, itself mounted on the `conversation` route ([#80](../codebase/80.md) — see [App shell](app-shell.md); before #80, `App` rendered it directly; before [#140](../codebase/140.md), `AppView` rendered it directly on the `conversation` route with no list and no way back). The conversation surface contains an independently scrolling thread with positioned controls:

```text
ConversationScreen                         .conversation (full-height containing block)
├── Covered pane                           .conversation__covered (absolute, inset: 0)
│   ├── Top chrome                         .conversation__top-chrome (level 1)
│   │   ├── Decorative fade/blur            .conversation__blur (non-interactive)
│   │   ├── ThreadOverflowMenu              .conversation__overflow (gated on onBack)
│   │   │   ├── Title/menu row              .conversation__overflow-content
│   │   │   └── Divider                     .conversation__overflow-rule
│   │   └── Connection/history notices      (included in measured occupied height)
│   ├── Message area                       .conversation__message-area (full pane, level 0)
│   │   ├── Timeline                       .conversation__thread (focusable scroll container)
│   │   │   └── TimelineRow × N             (stable identities; includes queued rows)
│   │   ├── TopOverlayControl              (pills below measured header)
│   │   └── BackgroundTaskPanel (if open)  .background-task-drawer
│   ├── Input chrome                       .conversation__input-chrome (level 1)
│   │   ├── Decorative fade/blur            .conversation__blur (non-interactive)
│   │   └── ComposerSlot                   (permission/question panel or composer)
│   │       ├── ComposerStatusArea         .composer-status
│   │       └── Composer                   (draft, attachments and desktop footer)
│   └── Sheets and dialogs (if open)       (existing modal precedence)
└── MarkdownReader (if open)               (independent overlay)
```

The connected empty timeline keeps `EmptyThread` inside the focusable scroller for
history input. An empty offline chat can omit `Timeline`, but the pane, notices and
Top overlay remain mounted and measured. Reader opening hides the covered subtree
without unmounting the composer. The [Markdown reader](conversation-shell-markdown-reader.md#pane-wiring)
has its own full-pane scrollport and measured fixed header using the same translucent treatment.

The top bar reads the current name through `ConversationScreen`'s existing
`selectActiveConversation` subscription. A null name or absent snapshot displays
`Unnamed conversation`. Conversation switches update the title; renames and automatic
naming arrive through the mounted [list reseed bridge](paired-shell-conversation-exits.md#the-list-reseed-activeconversationreseedbridgets-1184)
without reactivating the chat. The name is escaped paragraph text. Its title-large tokens
give Roboto Regular, 22px/28px, zero tracking and On Primary Container (`#cfe4ff`).

Only the title clips: `flex: 1 1 0`, `min-width: 0`, `white-space: nowrap` and ellipsis
let it shrink beside the non-shrinking anchor, with a 16px gap. Clipping the whole row
would also clip the popup. `ThreadOverflowMenu` mounts the shared
[`ComposerOptionsMenu`](conversation-shell-composer-options-panel.md) with
`placement="bottom-end"` and the existing icon named by `triggerAriaLabel="More actions"`.
The panel opens immediately below the 24px button, aligned to its right edge
(`top: 100%; right: 0`); its three fixed labels fit inside the window at the 800px minimum.
The shared anchor owns the outside-click ref as well as positioning. Moving that ref
onto the full row would make title clicks count as inside the menu.

The bare `.conversation__overflow-trigger` paints a hover-only `::before` layer
4px beyond its 24×24px frame (`--space-1`), yielding a 32×32px rectangle in
`--color-state-hover` with `--radius-xs` (6px) corners. Absolute positioning and
`pointer-events: none` preserve control/glyph/header geometry and hit targets.
The button uses `position: relative; isolation: isolate` with the layer at
`z-index: -1`, behind its glyph. Keyboard focus retains the existing 1px
`--color-outline` outline and creates no hover layer by itself. The
[sidebar toolbar](channel-list-section-header-pair-control.md#the-hoverfocus-name-pill-channelscsschannellisttsx-added-by-1304)
uses positioned glyphs instead of isolation to preserve its fixed name pill's paint order.

The menu lists Channel info, Run configuration and Background tasks in that order,
with `currentId={null}` so no row has a selected-value highlight. Enter/Space opens
with focus already on Channel info; Up/Down wrap, and Enter/Space activates the focused
action, closing the menu and opening its existing sheet or panel. Escape closes and
returns focus to More actions. Outside clicks, including the title, dismiss; clicking
a focusable control lets that control receive focus.

The divider's 60% opacity creates a stacking context, so the bottom-end menu
anchor retains `z-index: 2` above it. Full-pane scrolling adds two outer contexts:
`.conversation__message-area` at level 0 contains rows, pills and drawer, while top
and input chrome sit at level 1. Menus therefore paint above rows and pills without
raising chrome above existing level-2 sheets or later dialog siblings; Create chat
retains level 3. Raising the sheet to level 3 would let it intercept a dialog opened
from it. Preserve both scrim hit-testing with a menu still mounted and actual dialog
clicks. See [verification](development-verification.md#layout-and-input) and the
[translucent-control design](../../specs/architecture/1733-translucent-thread-controls.md).

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

The covered pane and message area are absolute with `inset: 0`. The existing
`.conversation__thread` fills that area; rows can scroll behind both fixed controls.
`html, body, #root { height: 100% }` and `body { margin: 0 }` keep the height chain.
The thread retains `flex: 1 1 auto`, `min-height: 0`, `overflow-y: auto` and hidden
scrollbars. `Timeline` supplies `tabIndex={0}` and the accessible label `Conversation
history`; native `overflow-anchor` remains at its default.

Measured header/input border boxes become `--thread-header-height` and
`--thread-input-height`. Thread padding is header height plus 12px at the top,
20px horizontally, and occupied input height at the bottom. At connected history
start this keeps the existing 97px first-row clearance; input growth changes bottom
padding rather than viewport height. See [scroll pin](conversation-shell-scroll-pin.md#thread-scroll-pin)
for resize/zoom following and separate temporary prepend compensation.

Both chrome wrappers have `pointer-events: none`; sharp direct children restore
`pointer-events: auto`, while decorative blur layers remain non-interactive. Header
and footer controls receive input above rows. Pills begin 12px below the occupied
header, including notices, even with no Timeline. The non-modal drawer's top and
bottom follow the measured chrome heights. Its width is `min(360px, pane width −
20px right inset)`, preventing clipping outside the minimum-width pane and leaving
the composer usable. Its existing Escape and conversation-switch behavior remains.

**Proving "no scrollbar" needs a computed-style read on an overflowing scrollport.**
`offsetWidth - clientWidth === 0` passes on machines drawing overlay scrollbars even with the hiding
rule deleted. `e2e/thread-scrollbar.spec.ts` instead reads
`getComputedStyle(el).getPropertyValue('scrollbar-width')`: the thread, `.composer__input` and
`.channel-list__tree` all return `none`. The composer (#1525) and sidebar (#1527) now share the
thread's policy, so neither is a visible-scrollbar control. Their own overflowing states need
separate interaction coverage: `e2e/composer-message-box.spec.ts` covers [composer scrolling and
editing](conversation-shell-composer-message-box.md#the-box-grows-with-the-draft-to-a-five-line-ceiling-1056),
and `e2e/sidebar-scrollbar.spec.ts` covers [sidebar wheel and focus scrolling](channel-list.md#css-channelscss).
The sidebar test also checks the WebKit fallback's computed `display: none`; geometry remains a
separate assertion for insets and the fixed top bar.

Driving the keyboard leg of the thread spec needs a raw-coordinate `page.mouse.click` into the thread's
own padding strip rather than a locator click: a locator click auto-scrolls its target into view first,
which perturbs the very scroll offset the test then asserts on.

Bubbles use `max-width: min(680px, 75%)` (not a fixed width) so they reflow as the window resizes — the desktop divergence from the mock's fixed `330px`. Bubble corners are asymmetric via `border-radius` (order **TL TR BR BL**): the user bubble clips its bottom-right, the daemon bubble its bottom-left.

[`chat-top-bar-geometry.spec.ts`](../../../e2e/chat-top-bar-geometry.spec.ts) checks the
bar against an actually scrolling thread. At 800px and 1280px it also proves real text
overflow beside a usable open menu; an ellipsis style alone cannot establish truncation.
Visibility and bounding boxes likewise passed with the divider covering Channel info.
`elementFromPoint` probes now check panel padding, every row and the divider intersection
before and after wheel scrolling, with an assertion that a real message overlaps the
panel. Sheet/dialog precedence needs both surfaces mounted: the spec programmatically
opens the menu beneath an existing overlay before checking that the scrim wins the hit
test. An ordinary outside click would dismiss the menu and make that check vacuous.
List-reply refresh checks retain an unsent draft, distinguishing a title update from
chat reactivation. Static renders prove the named/null/escaped text cases, but cannot
prove these updates, geometry or dismissal; see [test boundaries](development-verification.md#what-each-test-tier-proves).

## Top overlay hover

Actionable `.top-overlay-pill` surfaces paint the same `--color-state-hover` layer
inside their existing `--radius-xs` (6px) corners. A `linear-gradient` background
image overlays the variant's background colour instead of replacing its fill:
Default retains `--color-primary-container`; Error retains `--color-error-container`.
No padding, border, margin or size changes occur, and native keyboard outlines on
Re-pair and dismiss buttons remain unsuppressed.

The selectors are `button.top-overlay-pill:hover` and
`.top-overlay-pill:has(> .top-overlay-pill__dismiss):hover`. Re-pair is a full-pill
button; usage warnings and permission-resolution notices acquire the layer across
the pill while their X remains the dismiss action. Non-dismissible usage and
session-error notices remain inert with their resting paint. Pointer exit removes
the image; keyboard focus alone does not add it. See the
[Top overlay occupants](conversation-shell.md#what-it-does) for state and dismissal.

### Chrome hover evidence

[`e2e/chrome-hover.spec.ts`](../../../e2e/chrome-hover.spec.ts) covers all three bare
controls, a dismissible Default usage warning and the Error Re-pair button at
1280×800 and 800×800. It observes confirmed `:hover` together with computed paint,
checks bare-layer extents/radius/pointer transparency, compares control, glyph and
toolbar/header rectangles, retains both pill fills and keyboard outlines, and
excludes an inert usage notice. See [hover observation](development-verification.md#layout-and-input)
for why a completed pointer move alone cannot establish the hovered state.

The 2026-10-07 dispatcher browser gate at
`66cf65c730e702a1e92b8a61cb6003c8452da750` recorded **344 executed, 344 passed,
0 failed, 4 skipped**. The
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1871#issuecomment-6045161790)
confirms both `chrome hover preserves layout, pill fills and keyboard focus at 1280px`
and `chrome hover preserves layout, pill fills and keyboard focus at 800px` were
present, executed and passed (2 passed, 0 failed, 0 skipped in this spec).

The same verdict compared integrated synthetic captures with fresh Figma references
for [menu](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=840-16218),
[add host](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=840-9403) and
[pill](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6618), confirming
visible rounded layers and retained pill colours. Evidence, references, capture
script and revision/hash manifest are retained under `/tmp/verifier-1871/`, with
gate captures in `gate-captures/`. The builder's original captures are
`/tmp/builder-1866/{conversation__overflow-trigger,channel-list__menu,channel-list__pair,warning,repair}-{1280,800}.png`,
at revision `aac1ebda`. A separate verifier probe recorded 1 executed, 1 passed,
0 failed and 0 skipped for bare-control hover/focus at both widths. Pair new host
tooltip crops were pixel-identical with the pre-change toolbar CSS restored in the
mounted page, establishing that its existing overlap was preserved. These are
recorded verification results; no live-Claude acceptance is required.

## Theme

Spacing, typography and shared roles use `theme/tokens.css`; see
[ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

The shared M3 hover state layer is `--color-state-hover`, declared beside
`--color-on-surface` in `:root` as
`color-mix(in srgb, var(--color-on-surface) 8%, transparent)`. It resolves to On Surface
RGB `(224, 226, 232)` at alpha `0.08` in the default scheme. Overriding On Surface on
`:root` updates the layer's RGB while retaining that alpha; hardcoding the resolved
colour would lose this dependency. It supplies the chrome and actionable-pill layers
above, [composer footer hover](conversation-shell-composer-message-box.md) and sidebar
row/action layers. Hover paint preserves geometry and keyboard focus styling.
See the [hover token plan](../../specs/architecture/1862-shared-hover-state-token.md).

A source-string assertion alone cannot prove `color-mix` resolution or theme override
behavior. The [verifier's Chromium probe](https://github.com/pyrycode/pyrycode-desktop/pull/1867#issuecomment-6039679156)
against the real stylesheet executed 2 cases: 2 passed, 0 failed, 0 skipped. Both the
default colour and a root On Surface override to red passed, with red resolving to
`color(srgb 1 0 0 / 0.08)`.

Translucent control treatment values are local custom properties on `.conversation`, shared by
the covered thread and its reader sibling:
header `#09141D` → transparent, input transparent → `rgb(11 14 17 / 60%)` by 20% of
its height, and backdrop samples of 10px, 8px, 5px and 2px blended by vertical masks.
The header eases down to zero blur; the input rises from zero to 10px across its top
fifth. These layers are siblings behind controls, so control text stays sharp.
Figma's generated uniform 0px/5px blur does not describe the intended progression.
Header title and composer status text use `--shadow-thread`; header/status glyphs
use the equivalent local drop-shadow. The shared Default shadow is black at 20%,
offset (0, 4), radius 5. Existing glyphs and global token ownership are retained.

For the [messaging top-bar design](../../specs/architecture/1541-channel-name-top-bar.md),
Figma's generated-code fallback colors use a different scheme. Resolved variables and
the screenshot establish On Primary Container for the title and Inverse Primary for
the divider; the menu glyph keeps Primary. Check these roles separately rather than
copying fallback hex values or assuming the divider and glyph share a color.

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
own top bar (Figma `Content` 106:3321): `.conversation` gained the card's 24/20/16 inset
and `.conversation__overflow` became an in-flow bar outside the message scroller.
The [current design](../../specs/architecture/1541-channel-name-top-bar.md) uses a 28px
name/menu row with the 24×24px trigger at its top right. A full-width 1px divider sits
16px below the row, using `--color-inverse-primary` (`#32628d`) at 60% opacity, followed
by 16px bottom padding. The bar remains 61px tall (`28 + 16 + 1 + 16`) and has the
6px `--radius-xs` corners. With the card's 24px top inset and the 12px gap below the
bar, the first message still starts 97px below the card's top. The bar stays visible
while the thread scrolls.

The back arrow used to sit ahead of a separate unpair header row, a deliberate interim pending a future
top-app-bar ticket that would consolidate back + title + overflow + unpair into the one bar Figma 16-9
shows. [#1061](https://github.com/pyrycode/pyrycode-desktop/issues/1061) deleted that header row rather
than folding it into such a bar, and #1064 finished the same reading of Figma 106:3321 by deleting the
arrow itself. The current bar carries the conversation title and overflow menu; see
[Unpair control](#unpair-control-166-deleted-by-1061) below for
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
row's own right-hand slot — the surface [#797's error chip](conversation-shell-composer-error-chip.md#composer-error-chip-797)
already occupies — on Juhana's 2026-09-02 ruling that an error the operator can act on becomes a
button in that slot rather than a second surface below the composer. `RepairPrompt` and
`RepairControl` (both formerly exported/module-private from this file) no longer exist;
`.composer__repair` no longer exists in the stylesheet. See [Conversation shell — composer §
Actionable-error button](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963)
for the current shape — `ComposerErrorSlot`/`ComposerErrorSlotControl`, beside `ComposerErrorChip`.

The current `shouldOfferRepair` predicate lives in `composerSend.ts` beside
`composerAvailability` (see [Composer send](composer-send.md)) and requires an explicit
pairing rejection:

```ts
status.type === 'error' && !status.error.retryable && status.error.code === 'pairing-rejected'
```

The sealed `error` envelope with code `auth.invalid_token` is classified as
`pairing-rejected`; with `retryable: false` it shows the Top overlay's Re-pair pill.
A terminal socket closure instead offers Reconnect through `shouldOfferReconnect`.
The earlier broad terminal-error predicate would conflate those recovery actions.
Retryable failures and the `unpair`/`not-paired` errors offer neither action.

The button now opens the host's recovery pane without an erase or preliminary confirmation.
The existing pairing form still requires fingerprint confirmation before saving new credentials.
`ComposerErrorSlotControl` resolves its status and repair target from the open conversation's server;
its click delegates to the shell and never invokes `runUnpair`. See
[the current control](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963)
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
[#968](../codebase/968.md)). It now lives inside the measured top chrome: its height
adds start-of-history clearance and moves pills below the occupied header while the
thread viewport continues behind the controls.

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

Both keep an entry point in `ThreadOverflowMenu`, following
[Channel info](conversation-shell-session-and-channel-info.md#channel-info-sheet-365):
Channel info, Run configuration, Background tasks. The local array now supplies stable
ids, literal labels and callbacks to `ComposerOptionsMenu`; the former
`ThreadOverflowMenuView`, separate interaction state and surface CSS were removed by
[#1542](https://github.com/pyrycode/pyrycode-desktop/issues/1542). The shared container
owns close → invoke → return-focus for all three actions. The three callback props
(`onChannelInfo`, `onRunConfiguration`, `onBackgroundTasks`) remain required, making a
forgotten wire a compile error. The screen still gates this in-file consumer on `onBack`;
see [Structure](#structure) for its placement and keyboard contract.

The two retired triggers' bodies moved verbatim onto the menu: `onRunConfiguration={() =>
setSheetOpen(true)}` and `onBackgroundTasks={() => setPanelOpen(true)}` are exactly what the deleted
`StatusRow`/`BackgroundTaskTrigger` did from their own mounts — the overlays and their `useState`
open/closed cells ([ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)) are
untouched; the shared-menu migration retains these callbacks.

`e2e/chat-top-bar-geometry.spec.ts` now checks the labels and order in the open shared
menu and activates all three destinations at 800px and 1280px, including the previously
uncovered Background tasks callback. Static renders pin the collapsed icon trigger and
placement modifier; they cannot open the menu or exercise its callbacks.

Four comments elsewhere had to be corrected on the move (`channels.css`'s `.channel-list__host-dot`
comment — see [above](#two-dot-relaypyrycode-connection-status-leg-mapping-330-its-render-retired-from-this-screen-by-962)
— and its two `.conversation-status-dot` doc comments, plus `ChannelList.tsx`'s `HostConnectionDots`
comment, both documented in the [Channel List home screen](channel-list.md) doc). Nineteen other sites
naming the deleted classes and components are left untouched — prose anchors citing a precedent that
did exist, not claims about current state.
