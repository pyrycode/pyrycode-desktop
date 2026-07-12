# Spec — #276 Thread overflow menu: top-app-bar entry point for the Channel Info sheet

**Size:** s (confirmed — 1 production `.tsx` file, 1 new exported symbol, 1 optional prop with no call-site fan-out, 5 AC, 0 reject branches). Not `security-sensitive` (pure renderer; no keys/sockets/Noise).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-16

The trailing `more_vert` affordance (node 16-17, a 24px three-dot glyph) sits inside a 48px touch frame (node 16-16) at the right edge of the Conversation Thread top app bar (node 16-9), balancing the leading `arrow_back` (16-11) on the left with the title between. Reproduce it as an on-surface icon-only button in the top-right corner of `.conversation`, mirroring `BackControl`'s glyph-in-48px-frame treatment.

The **opened menu surface has no Figma frame** — the mobile file draws native Android overflow menus, and per the recurring #144–#158 Figma-gap finding it only draws populated screens. So the popup's layout (a right-anchored list of `role="menuitem"` rows dropping below the trigger) is client-designed against the M3 menu idiom, consistent with #277/#278/#279. The menu's eventual primary destination is the Channel Info sheet (node 20-48, ticket #155) — not built here.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:40-50` — `ConversationScreenProps`; you add one optional prop here (`onChannelInfo?`). Note `onBack?`/`onUnpaired?` are the established optional-prop idiom.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:52-131` — `ConversationScreen` body + the `.conversation` child list; mount the new control at ~line 87, right after `<BackControl onBack={onBack} />`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:859-881` — `BackControl`: the optional-prop-gated, icon-only, glyph-in-48px pattern to mirror. The comment at :864 names "the overflow menu from Figma 16-9 are future tickets" — this ticket is that future; update/absorb the comment.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:616-644` — `StatusRow`: the icon-only-button + `aria-haspopup` + `aria-label`-for-accessible-name idiom already in the file.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:790-857` — `RepairPrompt` (pure view) / `RepairControl` (in-file container reading state) and `ConnectionBanner`/`ConnectionBannerControl`: the exported-pure-view + thin-in-file-container split you replicate.
- `src/renderer/src/screens/conversation/conversation.css:9-19` — `.conversation` is `position: relative` (the containing block; the overflow wrapper anchors to it).
- `src/renderer/src/screens/conversation/conversation.css:33-65` — `.conversation__back` geometry, hover (`--color-surface-container-high`), focus-visible (`--color-outline`), radius (`--radius-full`); your trigger reuses this treatment.
- `src/renderer/src/PairedShell.tsx:30` — the **only** real render site (`<ConversationScreen onUnpaired={…} onBack={…} />`). It stays untouched this ticket; #155 adds `onChannelInfo={…}` here.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-25` — the `renderToStaticMarkup` (no-jsdom) harness and the exported-view import block.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:460-520` — `InterruptButton` / `QueuedBacklog` tests: the exact precedent for server-rendering a pure view that takes callback props (`onInterrupt={noop}`), including the note that `renderToStaticMarkup` cannot fire clicks.

## Context

The thread top app bar (Figma 16-9) already carries the back arrow (#140) and — as a separate seed row — the Unpair control (#166), but its trailing `more_vert` (16-16) is undrawn on desktop. Mobile carries an overflow menu here as the single entry point to per-conversation actions, opening the Channel Info sheet first. This ticket delivers **the button, the open/close menu surface, and a documented extension slot** — not the actions. It is the seam #155 (Channel Info sheet) hangs off; #155 is re-pointed to depend on this ticket. Later actions (Save-as-channel #274, archive/rename #153/#154) each add their own `role="menuitem"` rows through the same slot.

Split from #148; siblings #277 (empty-thread), #278 (workspace chip), #279 (connection banner) are all merged and on `main`.

## Design

Two symbols added to `ConversationScreen.tsx`, plus one optional prop and one mount line. Mirrors the file's pervasive **pure exported view + thin in-file container** split (`RepairPrompt`/`RepairControl`, `ConnectionBanner`/`ConnectionBannerControl`, `WorkspaceChip`).

### 1. `ConversationScreenProps.onChannelInfo?` — the documented extension point (AC4)

Add to the interface at :40:

```ts
// #276→#155: the overflow menu's Channel-info item invokes this. Optional and absent this ticket, so
// selecting the item just closes the menu (a no-op); #155 passes it from PairedShell to open the
// Channel Info sheet (Figma 20-48). Same optional-callback seam as WorkspaceChip's onChange? (#278).
onChannelInfo?: () => void
```

Destructure it in `ConversationScreen({ onUnpaired, onBack, onChannelInfo })` and forward it to the container (below). **No change to `PairedShell.tsx`** — it renders `<ConversationScreen>` without `onChannelInfo`, so the menu item is a live no-op today; #155's whole change is threading `onChannelInfo` to line 30.

### 2. Mount site — gate on `onBack` presence (AC1)

At ~:87, immediately after `<BackControl onBack={onBack} />`:

```tsx
{onBack && <ThreadOverflowMenu onChannelInfo={onChannelInfo} />}
```

`onBack` presence is the established "mounted in the paired shell" signal (`PairedShell` passes it; a bare `<ConversationScreen />` does not). **Render-site gating, not self-gating** — `ThreadOverflowMenu` holds hooks (`useState`/`useRef`), so an early `if (!visible) return null` inside it would violate rules-of-hooks. Gating at the mount site keeps hooks unconditional and leaves the bare-render tests (AC1: "`<ConversationScreen />` unchanged") emitting no overflow markup.

### 3. `ThreadOverflowMenuView` — exported pure view (the tested contract)

Props-in / markup-out; **no state, no effects** so `renderToStaticMarkup` renders both open and closed. This is the entire test surface for AC1/AC2/AC4.

```ts
export function ThreadOverflowMenuView(props: {
  open: boolean
  onToggle: () => void            // trigger click
  onSelect: () => void            // item click → container closes + returns focus + onChannelInfo?()
  triggerRef?: Ref<HTMLButtonElement>  // forwarded for focus-return; omitted in tests
}): JSX.Element
```

Renders:
- A trigger `<button ref={triggerRef} type="button" className="conversation__overflow-trigger" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>` wrapping a `more_vert` SVG. Use the Material `more_vert` path (inline like `BackControl`'s glyph): `M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z`, in a 24×24 `viewBox`, `fill="currentColor"`, `aria-hidden="true"`.
- When `open`: a `<div className="conversation__overflow-menu" role="menu">` containing one `<button type="button" role="menuitem" className="conversation__overflow-item" onClick={onSelect}>Channel info</button>`. When closed, the menu is not rendered.

Notes:
- `aria-expanded={open}` serializes to `"true"`/`"false"` under `renderToStaticMarkup` (React stringifies aria booleans) — both states are directly assertable.
- The item is **enabled and routed to a no-op** (not `disabled`) so AC3's "dismisses on selecting an item" is genuinely live this ticket rather than dormant behind a disabled control. It is labelled `Channel info` — **apostrophe-free** (see Error handling).
- Copy `More actions` / `Channel info`: both apostrophe-free.

### 4. `ThreadOverflowMenu` — in-file container (untested reviewed glue)

Not exported; the interaction shell around the pure view. Holds:
- `const [open, setOpen] = useState(false)` — screen-local, resets to closed on remount (AC5; ADR 0006, the `sheetOpen` precedent at :80).
- `const wrapperRef = useRef<HTMLDivElement>(null)` and `const triggerRef = useRef<HTMLButtonElement>(null)`.
- `close()` = `setOpen(false)` then `triggerRef.current?.focus()` (AC3 focus-return-to-trigger).
- `toggle()` = `setOpen((o) => !o)`.
- `select()` = `setOpen(false); onChannelInfo?.(); triggerRef.current?.focus()` (this ticket: `onChannelInfo` undefined → just closes + returns focus).
- Renders `<div ref={wrapperRef} className="conversation__overflow"><ThreadOverflowMenuView open={open} onToggle={toggle} onSelect={select} triggerRef={triggerRef} /></div>`.

Dismiss-on-outside-click and dismiss-on-Escape (AC3) via one `useEffect` gated on `open`: while open, attach `mousedown` and `keydown` listeners to `document`; `mousedown` outside `wrapperRef` → `close()`; `keydown` `Escape` → `close()`; cleanup removes both on close/unmount. `useEffect` never runs under `renderToStaticMarkup`, so this stays out of the static test — it ships as reviewed glue exactly like `Composer.handleKeyDown` (Enter-to-send) and `UnpairControl`'s phase transitions.

### CSS — `conversation.css` (append a `/* #276 */` block)

- `.conversation__overflow` — `position: absolute; top: var(--space-1); right: var(--space-1);` anchored to the `position: relative` `.conversation`. The back arrow is left-aligned (`align-self: flex-start`), so the top-right corner of the top-bar band is empty. Give it a z-index above the message list so the open menu overlays the thread.
- `.conversation__overflow-trigger` — reuse `.conversation__back`'s 48px square, `--radius-full`, transparent background, `--color-on-surface`, `:hover` → `--color-surface-container-high`, `:focus-visible` → `1px solid var(--color-outline)`.
- `.conversation__overflow-menu` — `position: absolute; top: 100%; right: 0;` drops the list below the trigger, right-aligned. Surface-container background, `--radius` corners, a subtle elevation border/shadow using existing tokens (match the `.status-sheet` surface treatment; no new color literals), z-index above the trigger.
- `.conversation__overflow-item` — full-width left-aligned text button, body/label typography, `:hover`/`:focus-visible` surface tint.

### Data flow / re-render seams

`onChannelInfo` flows `App → PairedShell (#155) → ConversationScreen prop → ThreadOverflowMenu → select()`. Menu open/close is entirely local to `ThreadOverflowMenu`'s `useState`; it never touches the session store and never re-renders `ConversationScreen` or the timeline. `ConversationScreen`'s existing store selectors are untouched — no new subscription, no new store slice.

## State + concurrency model

- **Single screen-local boolean** (`useState`) for open/closed (AC5). No store slice, no Zustand — this is ephemeral UI state, the `sheetOpen`/`Composer.text` category (ADR 0006). Remount resets it to closed for free.
- **No async, no streams, no transport.** Pure renderer; nothing subscribes to the daemon.
- **Teardown:** the `useEffect`'s cleanup detaches the `document` listeners when the menu closes or the screen unmounts, so no listener outlives an open menu. No `AbortController` needed (synchronous DOM listeners only).

## Error handling

No network/socket/parse/permission surface — pure UI. The only "failure mode" is the **apostrophe-escaping trap** that reworded #279: `renderToStaticMarkup` escapes `'` → `&#x27;`, so any asserted copy containing an apostrophe fails `toContain`. Both strings here (`More actions`, `Channel info`) are deliberately apostrophe-free; keep them so if reworded.

## Testing strategy

`npm test` (vitest, `environment: 'node'`, `renderToStaticMarkup`) + `npm run typecheck` + `npm run build`. Add `ThreadOverflowMenuView` to the test file's import block. All interaction (open, Escape, outside-click, focus-return) is untested reviewed glue — the repo has no DOM harness (config comment: "DOM harness deferred to #2"), the `Composer.handleKeyDown` / `UnpairControl` precedent. Cover the **static rendered contract** of the pure view:

- **Closed state** — `renderToStaticMarkup(<ThreadOverflowMenuView open={false} onToggle={noop} onSelect={noop} />)`: contains the trigger with `aria-label="More actions"`, `aria-haspopup="menu"`, `aria-expanded="false"`; does **not** contain `role="menu"`.
- **Open state** — same with `open={true}`: `aria-expanded="true"`; contains `role="menu"`, a `role="menuitem"`, and the text `Channel info`.
- **Gating (AC1)** — a bare `<ConversationScreen />` (no `onBack`) renders **no** `conversation__overflow`/`aria-haspopup="menu"` markup; the existing bare-render assertions stay green untouched. (An `onBack`-present render of the full screen requires the store harness the file already sets up for `ConversationScreen` container tests — mirror whichever the existing `onBack`/BackControl gating test uses; if the file only tests BackControl gating at the unit level, gate coverage rides on the pure view's closed/open pair plus a `not.toContain` in the bare-screen test.)

Do **not** attempt to test open→close, Escape, outside-click, or focus-return — `renderToStaticMarkup` cannot fire events (the `InterruptButton`/`QueuedBacklog` tests state this explicitly). Overstating coverage here would be a false teeth claim.

## Open questions

- **Trigger vs. Unpair-row vertical clearance.** The absolute trigger sits in the top-bar band (aligned with `BackControl`); the `.conversation__header` Unpair row is right-aligned one band below. They should not overlap, but the developer must visually confirm during `/verify` — if they collide on a short window, nudge the trigger's `top` or align it to the header row's right edge. Layout-only; no contract change.
- **Menu z-index vs. StatusSheet / PermissionModal overlays.** Those overlays mount later in the child list and cover the whole surface; an open overflow menu should not need to compete with them (you cannot open the menu while a sheet/modal is up). Pick a z-index above the thread but below the sheet overlay; confirm no stacking regression.
- **Focus-into-menu on open** (keyboard affordance beyond AC) is deferred — AC3 only requires Escape-dismiss and focus-return-to-trigger, both handled. If a later ticket adds arrow-key menu navigation, the first-item-focus-on-open effect lands there.
