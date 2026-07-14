# #348 — Archive screen: live per-tab counts and restore rows

**Size:** S · **Security-sensitive:** no · Split-child (content half) of #153; blockers #346 (transport) + #347 (scaffold) both merged (PR#357, PR#358).

This slice fills the empty `archive__tab-panel` the #347 scaffold left. It reads the already-live `conversationListStore`, filters to the archived rows, partitions them into Channels (promoted) / Discussions (not promoted), shows each tab's live count in its label, and renders a restore row per archived conversation whose control dispatches the dormant `unarchiveConversation` command (#346) — its first caller. **No new store, bridge, or list request.**

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=18-18

The populated tab body is a plain vertical list of rows (node 18-18). Each row (18-19) is a `flex` row, `align-items:center`, 12px gap, 16px horizontal / 12px vertical padding: on the left a `flex-col` text column (2px gap) with a **title** in M3 title-medium / on-surface (16px, weight 500) over a **subtitle** in M3 body-small / on-surface-variant (12px, weight 400, opacity 0.75) reading "Archived 2 weeks ago"; on the right a 40px icon frame holding a ~22px **restore control** (18-23/18-24) — a counter-clockwise undo/restore circular arrow. The tab labels (18-9, per #347) gain a parenthesised live count: "Channels (3)" / "Discussions (8)". Figma's coarse "weeks/months ago" buckets are intentionally NOT reproduced — see the honest-signal note under Design.

## Files to read first

- `src/renderer/src/screens/archive/ArchiveScreen.tsx` (whole file, 112 lines) — the #347 scaffold you extend: `ArchiveScreen` container (holds `selectedTab`), pure `ArchiveScreenView` (renders topbar + tabs + the **empty** `archive__tab-panel` you fill), `ArchiveTab` union, `ARCHIVE_TABS`, `ARCHIVE_COPY`, the `BackControl` icon-button idiom.
- `src/renderer/src/screens/archive/ArchiveScreen.test.tsx` (whole file, 79 lines) — the SSR test pattern (`renderToStaticMarkup` of the pure view with injected callbacks, `countOccurrences` helper). You extend the `renderView` helper and add count/row/restore/empty assertions.
- `src/renderer/src/screens/channels/ChannelList.tsx:37-312` — the container-reads / pure-view / `renderBody` tri-state idiom to mirror exactly: `useConversationListStore(selectConversations)` + `Date.now()` in the container (`:38-39`), `window.pyry` dereferenced only inside a click arrow (`:55`), the null/`[]`/non-empty tri-state in `renderBody` (`:207-253`), and the `Row` shape (`:270-312`) — note your archive row is a text **column** (title over subtitle), not ChannelList's horizontal title+time.
- `src/renderer/src/screens/channels/channelListViewModel.ts` (whole file, 77 lines) — the reuse source: `titleFor` (untitled fallback, AC3), `partitionByPromotion` (splits by `is_promoted`, apply to the archived subset), `formatLastActivity` (already embeds "ago"; **do NOT extend** — compose on top). Also the model for your new `archiveViewModel.ts`'s file-header + comment density.
- `src/renderer/src/screens/channels/channelListViewModel.test.ts:10-21` — the `row(over)` factory pattern for building `ConversationSummary` fixtures; clone it for `archiveViewModel.test.ts`.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx:95-104` — `requestPromoteConversation`: the exact dispatch-helper shape your `requestUnarchiveConversation` mirrors (inline `RendererCommand` literal, `sendCommand` injected, fire-and-forget `void`).
- `src/renderer/src/store/conversationListStore.ts:27-72` — `ConversationListState`, `selectConversations` (read surface), the null-vs-`[]` tri-state contract, and `selectArchivedCount` (`:71` — the **aggregate** archived total for Settings #351; **NOT** a per-tab count — do not mistake it for a ready-made selector).
- `src/renderer/src/store/conversationListBridge.ts:36-110` — proof the row-departure + count-recompute is free: `refreshOnChange` (`:45`) re-requests the whole list on every `conversationUpdated` broadcast (`:104-110`), which the daemon emits to confirm an unarchive. You add nothing here.
- `src/shared/ipc/commands.ts:88-89` — the `unarchiveConversation` member of `RendererCommand` (payload `UnarchiveConversationPayload`); confirm the shape before dispatching.
- `src/shared/wire/types.ts:515-523` — `ConversationSummary` fields (`is_archived`, `is_promoted`, `name: string|null`, `last_message_ts`); `:589-600` — `UnarchiveConversationPayload { conversation_id: string }`.
- `src/renderer/src/screens/archive/archive.css` (whole file, 132 lines) + `src/renderer/src/screens/channels/channels.css:43-127,280-289` — token idioms to clone for the new row/subtitle/restore/empty styles: `.channel-list__title` (title-medium/on-surface), `.channel-list__time` (body-small/on-surface-variant, opacity 0.75), `.channel-list__save` (icon-button, radius-full, on-surface-variant), `.channel-list__empty` (centered, body-medium/on-surface-variant).

## Context

The Archive screen's chrome and two-tab header landed in #347. The archived rows are **already** in `conversationListStore` (the daemon's `list_conversations` reply surfaces `is_archived` per pyrycode/pyrycode#880), so this slice is a pure render-and-derive over existing state — no read, no store, no bridge. The outbound `unarchive_conversation` command landed dormant in #346; this is its first caller. Restoring a conversation elicits a `conversation_updated` broadcast from the daemon, which the existing list bridge already re-requests on — so the restored row leaves the archived subset and both counts recompute with **no wiring added here**.

## Design

Two new symbols in a new framework-free view-model, plus additive changes to the existing scaffold component. No new file under `src/main`, `src/shared`, or the store.

### 1. New: `src/renderer/src/screens/archive/archiveViewModel.ts` (framework-free)

Mirrors `channelListViewModel.ts` (pure `.ts`, unit-tested with no React or store — AC1). Imports `partitionByPromotion` and `formatLastActivity` from `../channels/channelListViewModel`. Three pure functions:

- `partitionArchived(rows: readonly ConversationSummary[]): { channels: readonly ConversationSummary[]; discussions: readonly ConversationSummary[] }` — filter to `is_archived === true`, then delegate to `partitionByPromotion` on that subset. Order-preserving (no sort — the daemon's array order is authoritative). Returns both sections; either may be empty. **This is the AC1 derivation.** Note the returned object's keys (`channels`/`discussions`) are exactly the `ArchiveTab` union members — the view indexes it as `partition[tab]`, structurally welding the count and the body to the same key.
- `archivedSubtitle(iso: string, now: number): string` — the AC3 subtitle. Behavior: `const rel = formatLastActivity(iso, now)`; return `"Archived"` when `rel` is `''` (non-parseable timestamp — no trailing space), else `` `Archived ${rel}` `` (→ "Archived 2 days ago", "Archived Jul 4"). **The double-"ago" guard: `formatLastActivity` already embeds "ago", so this composes `"Archived " + rel`, NEVER `"Archived " + rel + " ago"`.** Do NOT extend `formatLastActivity` with weeks/months buckets — it is shared with the Channel List; keep this additive to the archive screen. (Honest-signal seam: `ConversationSummary` carries no `archived_at`, only `last_message_ts`; the subtitle is measured from that last-activity signal, the same posture `channelListViewModel.ts` documents. A true archived-at time and Figma's coarser buckets are deferred pending a daemon field.)
- `tabCountLabel(base: string, count: number | null): string` — the AC2 label. `count === null` (not-yet-loaded) → the bare `base`; otherwise `` `${base} (${count})` `` (including `count === 0` → "Channels (0)"). Keeps the null-vs-loaded tri-state in one testable unit.

### 2. Modified: `ArchiveScreen.tsx`

**Container `ArchiveScreen`** (mirror `ChannelList` `:38-39,55`): additionally read `const conversations = useConversationListStore(selectConversations)` and `const now = Date.now()` (both impure but SSR-safe — the store yields its initial `null` under `renderToStaticMarkup`, the ChannelList precedent). Pass `conversations`, `now`, and `onRestore={(id) => requestUnarchiveConversation(window.pyry.sendCommand, id)}` to the view. `window.pyry` is dereferenced only inside that click arrow, so the view stays server-renderable.

**Pure `ArchiveScreenView`** — three new **required** props: `conversations: readonly ConversationSummary[] | null`, `now: number`, `onRestore: (id: string) => void` (required, not optional — the "a view that cannot act is a bug" idiom). It computes once: `const partition = conversations === null ? null : partitionArchived(conversations)`.
  - **Tab labels:** in the `ARCHIVE_TABS.map`, replace `{tab.label}` with `tabCountLabel(tab.label, partition === null ? null : partition[tab.key].length)`. Everything else about the tab button (id, `aria-selected`, `aria-controls`, onClick) is unchanged.
  - **Tab panel:** replace the empty `<section className="archive__tab-panel" …/>` with the same element now rendering `renderArchivePanel(selectedTab, partition === null ? null : partition[selectedTab], now, onRestore)` as its children. Keep the existing `role`, `id`, and `aria-labelledby={`archive-tab-${selectedTab}`}` attributes intact (the #347 tab-switch proof).

**New `renderArchivePanel(selectedTab, rows: readonly ConversationSummary[] | null, now, onRestore)`** — the tri-state body, mirroring ChannelList `renderBody`:
  - `rows === null` → `return null` (not-yet-loaded → neutral first paint, no rows and no empty state — AC5's "not-yet-loaded" arm; theoretical, since reaching Archive means the list is loaded).
  - `rows.length === 0` → `<p className="archive__empty">{emptyCopyFor(selectedTab)}</p>` (loaded-zero-of-this-kind → per-tab empty state — AC5). Copy per tab: "No archived channels" / "No archived discussions".
  - non-empty → `rows.map((row) => <ArchiveRow key={row.id} row={row} now={now} onRestore={onRestore} />)`.

**New `ArchiveRow({ row, now, onRestore })`** — one archived row (Figma 18-19). A `<div className="archive__row">` flex container with:
  - a text column (`<div className="archive__row-text">`): `<span className="archive__title">{titleFor(row.name)}</span>` over `<span className="archive__subtitle">{archivedSubtitle(row.last_message_ts, now)}</span>`. Both are auto-escaped React children (untrusted daemon strings rendered as opaque text — never `dangerouslySetInnerHTML`).
  - the restore control: an icon-only `<button type="button" className="archive__restore" aria-label={ARCHIVE_COPY.restore} onClick={() => onRestore(row.id)}>` wrapping an `aria-hidden` 24px SVG (the `BackControl`/`ArchiveButton` icon-button idiom — the `aria-label` supplies the accessible name, AC4). Use a Material restore/undo circular-arrow glyph matching Figma 18-23 (a reasonable stand-in, the ChannelList save-bookmark precedent — the exact glyph is a small swap; developer confirms against 18-23).

**New exported `requestUnarchiveConversation(sendCommand: (command: RendererCommand) => void, conversationId: string): void`** — mirrors `requestPromoteConversation`: dispatch an inline `RendererCommand` literal `{ type: 'unarchiveConversation', payload: { conversation_id: conversationId } }`. Fire-and-forget (`sendCommand` is `void`). No constructor, keeping the change renderer-contained.

**`ARCHIVE_COPY`** gains `restore: 'Restore'`, `emptyChannels: 'No archived channels'`, `emptyDiscussions: 'No archived discussions'` (`emptyCopyFor(tab)` selects by tab key). Client-owned module-level copy, never daemon strings — the existing `SETTINGS_COPY` idiom.

### 3. Modified: `archive.css`

Add archive-scoped rules for `.archive__row` (flex, `align-items:center`, gap `--space-3`, padding `--space-3 --space-4`), `.archive__row-text` (flex-col, gap `--space-1`, `min-width:0` so the title ellipsizes), `.archive__title` (clone `.channel-list__title` tokens — title-medium/on-surface), `.archive__subtitle` (clone `.channel-list__time` tokens — body-small/on-surface-variant, opacity 0.75), `.archive__restore` (clone `.channel-list__save` — icon-button, `radius-full`, on-surface-variant, hover/focus-visible states), `.archive__empty` (clone `.channel-list__empty` — centered, body-medium/on-surface-variant). Duplicated (not extracted to a shared class) so this slice touches no adjacent stylesheet — the #347 archive.css convention. No color/type/spacing literals — theme tokens only.

## State + concurrency model

Pure render over the existing single source of truth. The only impurities are the container's `useConversationListStore(selectConversations)` read and `Date.now()`, both confined to the container (the pure view + view-model take them as props/args). No new store, no subscription, no effect, no async. `selectConversations` returns a narrow slice so the screen re-renders only when the list changes.

**The restore round-trip is event-driven and free:** the click dispatches `unarchiveConversation` fire-and-forget; navigation/list-mutation is decoupled. The daemon persists the cleared archived flag and confirms with a `conversation_updated` broadcast → the existing `conversationListBridge` `refreshOnChange` re-requests the full list → `setConversations` replaces the array → the restored row (now `is_archived:false`) falls out of `partitionArchived`'s filter → both tab counts recompute on the next render. **#348 adds none of that path** (AC4).

## Error handling

No new failure modes. Untrusted daemon-derived strings (`name`, `last_message_ts`) render as auto-escaped React children (opaque text). `titleFor` guards `null`/blank names (never a blank row). `formatLastActivity` degrades a non-parseable/future timestamp silently (`''` → `archivedSubtitle` yields bare "Archived"; future → "just now"). `unarchiveConversation` is fire-and-forget — no result to surface, matching the composer's send and `requestPromoteConversation`.

## Testing strategy

**`archiveViewModel.test.ts` (new)** — plain function tests, no React/store, clone the `row(over)` fixture factory from `channelListViewModel.test.ts`:
- `partitionArchived`: drops non-archived rows (only `is_archived:true` survive); splits the archived subset into `channels` (`is_promoted:true`) and `discussions` (`is_promoted:false`); preserves store order within each section; empty input → both sections `[]`; an archived-channels-only list → `discussions` empty (and the mirror).
- `archivedSubtitle`: composes "Archived " + relative time for an `iso`/`now` that yields "2 days ago" → exactly `"Archived 2 days ago"`; does **not** double the "ago" (assert the exact string, and assert it does not contain "ago ago"); a past-a-week `iso` → `"Archived Jul 4"` (short date, no "ago"); a non-parseable `iso` → exactly `"Archived"` (no trailing space).
- `tabCountLabel`: `('Channels', 3)` → "Channels (3)"; `('Discussions', 0)` → "Discussions (0)" (AC2 zero case); `('Channels', null)` → "Channels" (bare, not-loaded).

**`ArchiveScreen.test.tsx` (modify)** — extend the `renderView` helper to accept `conversations` (default `null`) and `now` (default `0`) and pass `onRestore={noop}`, so existing scaffold assertions keep passing unchanged. Add, all via `renderToStaticMarkup(<ArchiveScreenView …/>)` with injected props:
- Loaded list, Channels selected: tab labels show live counts — markup contains `>Channels (N)</button>` and `>Discussions (M)</button>` for the injected fixture's archived promoted/unpromoted counts (AC2).
- The selected (Channels) tab lists one restore row per archived channel: each fixture channel's title appears; each subtitle "Archived …" appears; the count of `aria-label="Restore"` equals the number of archived channels (AC3, AC4).
- Untitled fallback: an archived row with `name:null` renders the `UNNAMED_LABEL` title (AC3).
- Discussions selected → lists the archived discussions, not the channels (the body is a pure function of `selectedTab`).
- Empty state: a loaded list with zero archived rows of the selected kind → markup contains "No archived channels" (the `archive__empty` copy), not a blank body (AC5).
- Not-yet-loaded: `conversations={null}` → bare labels (markup does not contain "(0)"), no restore rows, no empty-state copy (AC5's neutral first-paint arm).
- `requestUnarchiveConversation(fakeSend, 'conv-42')`: `fakeSend` called exactly once with `{ type:'unarchiveConversation', payload:{ conversation_id:'conv-42' } }` (pins the wire contract; the click→dispatch glue is closed by composition, as ArchiveScreen.test never fires a button — the ChannelList/SaveAsChannelDialog precedent).

Type coverage: `npm run typecheck`. Full gate: `npm test` + `npm run build`.

## Open questions

- **Restore glyph.** Figma 18-23/18-24 is a counter-clockwise undo/restore circular arrow at ~22px. A 24px Material restore/undo glyph is a reasonable stand-in (the ChannelList save-bookmark precedent); the developer confirms the exact path against 18-23. Not load-bearing — the accessible name comes from `aria-label`, not the glyph.
