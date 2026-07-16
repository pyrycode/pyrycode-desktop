# #469 — Filter archived conversations out of the active Channel List

**Size:** XS · **Type:** bug · **Not security-sensitive** (no `security-sensitive` label — no security-review pass).

## Design source

N/A — behavioural bug fix to the already-designed Channel List (#141) and its empty state (#208/#347). No new visual surface, component, layout, or token is introduced; the fix changes only *which existing rows* render. The Channels / Recent-discussions sections and the "No conversations yet" empty state are already built and already match their Figma nodes. Visual-fidelity check is intentionally not applicable.

## Files to read first

- `src/renderer/src/screens/channels/channelListViewModel.ts:21-34` — `partitionByPromotion`, the shared split primitive. **Do NOT add the archive filter here** — it is shared (see next entry). Add the new `partitionActive` beside it.
- `src/renderer/src/screens/archive/archiveViewModel.ts:12-25` — `partitionArchived` = `partitionByPromotion(rows.filter((r) => r.is_archived))`. Your new function is its exact dual (inverted predicate). Mirror its doc-comment posture.
- `src/renderer/src/screens/channels/ChannelList.tsx:233-281` — `renderBody`: the one call site to switch, **and** the empty-state guard (`conversations.length === 0`) that must move after the partition (see Design § 2).
- `src/renderer/src/screens/channels/channelListViewModel.test.ts:39-73` — the existing `partitionByPromotion` `describe` block; add a sibling `partitionActive` block in the same shape.
- `src/renderer/src/screens/archive/archiveViewModel.test.ts:21-49` — the "drops non-archived rows" + "splits the subset" tests to mirror with the inverted predicate.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:14-39` — the `row` factory + `render` helper (`renderToStaticMarkup` idiom) to reuse for the two new render-level tests. Note the factory defaults `is_archived: false`, so an archived row is `row({ is_archived: true, name: '…' })`.
- `src/shared/wire/types.ts:516-527` — `ConversationSummary`: `is_promoted` and `is_archived` are both plain booleans (`false` is a value, not an absence).

## Context

Archived conversations render in **both** the active Channel List and the Archive screen. The store (`conversationListStore`) holds every row the daemon's `list_conversations` reply returns (pyrycode#880 returns archived rows **unfiltered**, each tagged `is_archived`). The Archive screen filters `is_archived === true` via `partitionArchived`; the active list's `renderBody` → `partitionByPromotion` splits only by `is_promoted` and never filters `is_archived`, so archived rows leak into the active sections.

This is the latent #366 regression: #366's AC "the archived conversation leaves the active channel list" was assumed free via the #275 `conversation_updated` → re-list, but the re-list returns the row still tagged `is_archived`, and nothing downstream drops it. Documented as "Gap B" in the merged fake twin #452 (`e2e/conversation-archive-lifecycle.spec.ts`), which had to route its archive assertions to the Archive view because the active list could not be trusted while this bug stood.

## Design

### 1. New pure predicate — `partitionActive` (the dual of `partitionArchived`)

Add to `channelListViewModel.ts`, beside `partitionByPromotion`:

```ts
export function partitionActive(rows: readonly ConversationSummary[]): {
  channels: readonly ConversationSummary[]
  discussions: readonly ConversationSummary[]
}
```

Behaviour: `partitionByPromotion(rows.filter((r) => !r.is_archived))` — filter out archived rows first, then delegate the promoted/unpromoted split to the shared primitive. Order-preserving (no sort). This is the exact inverse of `archiveViewModel.partitionArchived`, which filters `r.is_archived`.

**Why a new function, not a change to `partitionByPromotion`.** `partitionByPromotion` has exactly two production call sites (verified): `ChannelList.renderBody` (the active list) and `archiveViewModel.partitionArchived` (the archive screen, which passes an *already archived-filtered* subset). Baking `!is_archived` into `partitionByPromotion` would strip every row the archive screen feeds it and break the Archive screen entirely. Keeping `partitionByPromotion` as the neutral shared primitive, with `partitionActive` / `partitionArchived` as the two symmetric callers, is the elegant seam — and keeps the fix unit-testable without React, per the framework-free view-model idiom.

### 2. Switch the call site — and move the empty-state guard

In `renderBody` (`ChannelList.tsx`), two coupled changes:

- Import `partitionActive` (replace `partitionByPromotion` in the import from `./channelListViewModel`; `partitionByPromotion` is no longer referenced in this file).
- Call `partitionActive(conversations)` instead of `partitionByPromotion(conversations)`.
- **Move the empty-state decision after the partition.** The current guard is `if (conversations.length === 0)` — the *raw store count*. Once archived rows are filtered out of the render, a store that holds rows but where **every** row is archived has `conversations.length > 0` yet zero active rows to show. The current section guards (`channels.length > 0`, `discussions.length > 0`) would both fail and `renderBody` would return a blank body — no rows **and** no empty message. Decide the empty state from the *active* partition instead.

Contract for the revised `renderBody` control flow (not an implementation — the developer writes it):

1. `conversations === null` → return `null` (not-yet-loaded; unchanged, stays the first check to preserve the null-vs-loaded-zero tri-state per #208).
2. Compute `{ channels, discussions } = partitionActive(conversations)`.
3. `channels.length === 0 && discussions.length === 0` → return the `<p className="channel-list__empty">No conversations yet</p>` empty state. This one check now covers **both** loaded-zero (`[]`) and all-archived, replacing the old raw-length check.
4. Otherwise render the two sections + divider exactly as today (the section-guard / divider logic is unchanged; it already handles either section being empty).

The section/divider rendering below the guard is untouched — only the partition source and the empty-state predicate change.

## State + concurrency model

None. No store, transport, IPC, wire, async, or effect surface changes. Pure render-path filtering over the already-live `conversationListStore` slice. `partitionActive` is a pure function; `renderBody` stays a pure render given `(conversations, now, …handlers)`.

## Error handling

No new failure modes. `is_archived` is a non-null wire boolean (`types.ts:527`), so the predicate needs no null-guard. Untrusted-string handling (`titleFor`, `formatLastActivity`) is unchanged. No reject branches, no logging.

## Re-render correctness

`renderBody` already recomputes on every store-slice change via the container's `useConversationListStore(selectConversations)` read; adding a filter inside the pure render introduces no new memoization need and no new store subscription. Row `key={c.id}` stability is unchanged.

## Testing strategy

Test-first (a failing test before the fix). Two layers, both `npm test` (vitest); `npm run typecheck` covers the type surface.

**Pure unit tests — `channelListViewModel.test.ts`**, new `describe('partitionActive')` block mirroring the existing `partitionByPromotion` block and `archiveViewModel.test.ts:21-49`:

- Drops archived rows — given a mix of `is_archived: true` / `false`, only the non-archived ids survive across `channels` + `discussions` (the inverse of archive's "only archived survive").
- Splits the non-archived subset into `channels` (promoted) / `discussions` (unpromoted) — an archived promoted row must NOT appear in `channels`.
- Preserves store array order within each section (no re-sort).
- All-archived input → both `channels` and `discussions` are empty.

**Render-level tests — `ChannelList.test.tsx`** (reuse the `row` factory + `render` helper, `renderToStaticMarkup`):

- An archived row does not render in the active list: seed one active row (distinctive name, e.g. `is_archived: false, name: 'live-one'`) and one archived row (`is_archived: true, name: 'archived-one'`); assert the active name is present in the markup and the archived name is absent. This is the regression test that would have caught #366's missed AC.
- All-archived store renders the empty state: seed a non-empty list where every row has `is_archived: true`; assert the `channel-list__empty` "No conversations yet" copy is present and no row title renders. Guards the § 2 empty-state move.
- (Optional, cheap) A mixed list still renders active rows under their correct section headers — a light re-assertion that the promoted/unpromoted split is untouched for non-archived rows.

## Acceptance criteria

1. `partitionActive(rows)` returns only non-archived rows, split into `channels` (promoted) / `discussions` (unpromoted), preserving store order; `partitionByPromotion` and `partitionArchived` are unchanged and the Archive screen still shows archived rows.
2. The active Channel List (`renderBody`) renders no `is_archived` row in either section.
3. A store whose rows are all archived renders the "No conversations yet" empty state in the active list (not a blank body).
4. Unit tests for `partitionActive` and render-level tests for the archived-row-absent and all-archived-empty-state cases pass; `npm run build` (typecheck + build) is green.

## Open questions

None. The fix is fully determined by the existing `partitionArchived` dual and the two live `partitionByPromotion` call sites.
