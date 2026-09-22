# #1254 — Context reading opens a breakdown popover

## Files read

- `src/renderer/src/store/reportedContextStore.ts` → `ReportedContextReading`, `selectReportedContextFor`, `useReportedContextStore` — the only read surface; its header and docblock are binding (inert text, no logs, no sizing from integers, `Map` for any index, `type` is a label).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ContextUsageControl`, `ContextUsageReading` — the footer reading this ticket turns into a trigger. `ContextUsageReading`'s exact markup is pinned by tests and stays unchanged.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsMenu` (open/close/focus-return/outside-click lifecycle to mirror), `useComposerOptionsClamp` (the right-edge clamp and window width bound, reused as is).
- `src/renderer/src/screens/conversation/composerOptionsPlacement.ts` → `composerOptionsShiftPx`, `composerOptionsMaxWidthPx` — reached through the hook, not called directly.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-options`, `.composer-options__item`, `.composer-options-anchor`, `.composer__context`, `.composer__footer-button` — the panel style reused; the footer's shrink policy (the reading never gives).
- `src/renderer/src/screens/conversation/shortenPath.ts` → `shortenPath` — memory-file path display.
- `src/renderer/src/screens/conversation/turnStats.ts` → `formatCount` (module-private) — the house `12.4k` formatting this ticket's figures match.
- `src/shared/wire/types.ts` → `ContextUsageCategory`, `ContextUsageMCPTool`, `ContextUsageMemoryFile` — row shapes.
- `e2e/composer-context-claude-reading.spec.ts` → `contextUsageFrame` — the frame builder the new spec extends with non-empty inventories.
- `e2e/composer-footer-overflow.spec.ts` — asserts `.composer__footer .composer-options-anchor` has count 4, so the new anchor must NOT wear that class; also relies on the reading never shrinking.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

No dedicated drawing. The panel reuses the footer options panel (121:3879): a dark navy column (`--color-on-primary-fixed`, `--radius-xs`, 2px vertical bands) opening upward from its trigger, rows in M3 body/small at `--color-primary` inset `--space-3`, the current-row fill `--color-on-primary`. Here nothing is selectable: rows are plain list items, the category bar's track is `--color-on-primary` and its fill `--color-primary`. No new tokens.

## Context

The footer reading shows claude's own percentage but not what fills the window. The held `ReportedContextReading` already carries three inventories; this ticket renders them. Read-only panel, no product decision beyond the ticket; no ADR needed.

## Design

### New module `ContextBreakdownPopover.tsx` (screens/conversation)

- `formatContextTokens(tokens: number): string` — `< 1000` → integer text; else one decimal `k` with a trailing `.0` dropped (`12.4k`, `80k`, `200k`); non-finite → `'?'`. Figure only, never a size.
- `contextBarPercent(tokens: number, maxTokens: number): number` — `tokens / maxTokens * 100` clamped to `[0, 100]`; `0` for a non-positive or non-finite max or a non-finite result. The only number that reaches an attribute (an inline `width: N%` style), and it is bounded.
- `groupMcpToolsByServer(tools): ReadonlyMap<string, readonly ContextUsageMCPTool[]>` — a `Map` keyed by `server_name`, groups in first-appearance order and rows in held order (so the producer's descending order is kept within each group). Iterates the row array only.
- `ContextBreakdownPanel({ reading: ReportedContextReading | null })` — pure view, `role="dialog"`, `aria-label` a client-owned constant, class `composer-options context-breakdown` (placement + fill from the shared panel). Content:
  - `reading === null` → one `<p>` with the client-owned `CONTEXT_BREAKDOWN_PENDING` line ("A context reading arrives after the next turn.").
  - otherwise a header (`model` as text, then `"<total> of <max> tokens"`), then a category `<ul>` (rows: name + ` · <figure>` + a bar), then an **MCP tools** `<details>` (per server: the server name as a sub-heading, then its tool rows), then a **Memory files** `<details>` (rows: `shortenPath(path)` + figure). Each list is followed by a `+N more` line only when its dropped count is `> 0`. A group (and the category list) renders only when it has rows or a positive dropped count. `<details>` gives collapsibility natively, closed by default, with no state and full static-render testability.
  - React `key`s are array indices, never a name or path. Every daemon string is a JSX text child only; `memoryFiles[].type` is not read.
- `ContextBreakdownPopover({ reading, children })` — the interaction container, mirroring `ComposerOptionsMenu`'s lifecycle: component-local `open`, an anchor `<div class="context-breakdown-anchor">` wrapping a `<button type="button" class="composer__context-trigger" aria-haspopup="dialog" aria-expanded>` whose content is `children` (the unchanged `ContextUsageReading` span), and `{open && <ContextBreakdownPanel/>}`. Close paths: trigger click toggles; Escape via the anchor's `onKeyDown`; outside click via a document `mousedown` listener attached only while open. `close()` sets closed and focuses the trigger. `useComposerOptionsClamp({ anchorRef, panelRef, active: open })` is reused for the right-edge clamp and the window width bound.

### `ConversationScreen.tsx` → `ContextUsageControl`

Keeps reading the store exactly as now. When `contextUsagePercent` of the chosen pair is `null` it returns `null` (no trigger, unchanged behaviour); otherwise it renders `<ContextBreakdownPopover reading={reported}><ContextUsageReading …/></ContextBreakdownPopover>`. `reported` is the `selectReportedContextFor` record, so the popover reads nothing from `runConfigStore`: when the reading shown is the settings fallback, `reported` is `null` and the panel shows the pending line.

### `conversation.css`

- `.context-breakdown-anchor` — `position: relative; display: flex; flex: 0 0 auto`. Its own class so the footer-overflow spec's anchor count stays 4, and `flex: 0 0 auto` keeps #1107's "the reading never gives".
- `.composer__context-trigger` — button reset (no border, background, padding; `font: inherit`; `cursor: pointer`), focus ring kept.
- `.context-breakdown` — padding, a fixed width for the bars (bounded by `--composer-options-max-width`, which the shared hook writes), `max-height` with `overflow-y: auto`; rows, header, group summary, sub-heading and `+N more` in body-small; name spans ellipsize, figure spans `white-space: pre` and never shrink; bar track and fill.

## State + concurrency model

Only component-local `open` state. Two effects, both torn down on close and unmount: the document `mousedown` listener and the clamp hook's `resize` listener. No async work, no IPC.

## Error handling

No failure modes of its own: the reading is already decoded and narrowed upstream. Hostile values are handled by construction — bar widths clamped, figures formatted from numbers, strings rendered as text only, dropped counts shown as a figure and never iterated. **No logging**: the store header forbids any log on this path, including content-free ones.

## Testing strategy

- `ContextBreakdownPopover.test.tsx` (vitest, static markup):
  - `formatContextTokens` table (999, 1000, 12_400, 200_000, NaN).
  - `contextBarPercent` clamps (>max → 100, negative → 0, max 0 → 0).
  - `groupMcpToolsByServer`: first-appearance group order, held order within a group, a `__proto__` server name is an ordinary group.
  - Panel: pending line for `null`; header; category rows in held order with bar widths; `+N more` only when positive; MCP and memory groups absent when empty with zero dropped, present with only `+N more` when dropped > 0; paths shortened; a hostile `<img onerror>` name/path appears escaped and in no attribute; `<details>` closed by default.
  - Container: closed render has `aria-expanded="false"`, `aria-haspopup="dialog"`, and no panel.
- Existing `ConversationScreen.test.tsx` footer assertions locate `composer__context` as a substring; they keep passing because the span is unchanged.
- `e2e/composer-context-breakdown.spec.ts` (fake daemon): open before any reading → pending line, close by outside click; push a frame with all three inventories → open, assert header, category rows and order, `+N more`, expand MCP (grouped by server) and memory groups, Escape closes with focus back on the trigger; push a categories-only frame → open, assert no MCP or memory group, re-click the reading closes with focus back on the trigger.

## Open questions

- Outside click and focus: `ComposerOptionsMenu` focuses the trigger on close, then the browser's own mousedown focus moves focus to whatever was clicked, so focus lands where the user clicked rather than being pulled back. This popover keeps that shared contract rather than pulling focus back from a textarea the user just clicked. The e2e asserts focus return for Escape and the trigger click, and only closure for an outside click.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: fold the popover into the conversation composer footer overview (`docs/knowledge/features/`, the owning context-reading topic).

## Revisions

**2026-09-23 — placement is right-aligned, and the clamp hook is not used.** The visual check found that the footer menus' placement fails for this panel at the 800px minimum. The window-width bound squeezed the fixed-width panel to about 130px. Without that bound, the right-edge shift moves the panel to the window's edge, 20px past `.paired-shell__pane`, whose `overflow: hidden` clipped the panel's right side. `.context-breakdown` now sets `right: 0; left: auto` against `.context-breakdown-anchor`, which is the `--bottom-end` precedent. The reading's right edge is always inside the pane, and 280px to its left clears the sidebar at every allowed width. `ContextBreakdownPopover` therefore does not call `useComposerOptionsClamp`, and `ContextBreakdownPanel` takes no `panelRef`. The fixed 280px width remains the bound for untrusted text.

**Open question resolved.** An outside click closes the panel and leaves focus where the user clicked, as the shared menu does. The e2e checks that Escape and a second click on the reading return focus to it, and checks only that an outside click (at the window's corner) closes the panel.
