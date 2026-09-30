# Alphabetical active sidebar (#1693)

## Files read

- `src/renderer/src/screens/channels/channelListViewModel.ts` — `titleFor`, `partitionActive`, `partitionByPromotion`, `groupByServer`: title contract, active-only sorting seam and order-preserving attribution.
- `src/renderer/src/screens/channels/channelListViewModel.test.ts` — `partitionActive` tests: replace the obsolete active-order assertion and exercise the complete comparator.
- `src/renderer/src/screens/channels/ChannelList.tsx` — `renderBody`, `Row`: partition before grouping; keys, selected state and actions retain row identity.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` — `render`, host-first sidebar tests: successive static snapshots and host/section boundaries.
- `src/renderer/src/screens/archive/archiveViewModel.ts` — `partitionArchived`: shared partition must remain order-preserving.
- `e2e/fixtures/conversationStateFake.ts` — `conversationStateFake`: rename broadcasts trigger re-list; create appends and promotion preserves identity.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp`: seed one row before launch; second host and post-launch pushes support interaction proof.
- `e2e/conversation-create-rename.spec.ts`, `e2e/save-as-channel-promote.spec.ts`, `e2e/sidebar-create-channel.spec.ts` — existing dialog and command-observation patterns.
- `docs/knowledge/features/channel-list.md` — “The view-model” and “Server grouping”: stable IDs and preserved server stamps; pure derivation needs no store changes.
- `docs/knowledge/features/development-verification.md` — static renders cannot prove events; Electron fixture requires one clickable launch seed.

Codegraph context was attempted but the index is unavailable; repository reads and searches provided the caller map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=132-3902

The screenshot shows a 400px sidebar with a toolbar and vertically stacked hosts, inset Channels and Chats sections, compact body-small rows, status dots and trailing pens. Existing `ChannelListView` and its theme tokens supply this presentation; this ticket changes row order only, keeping the host/section structure and existing assets.

## Context and sizing

One deliverable: deterministic alphabetical order for the active sidebar. Estimate approximately 350–450 written lines including this plan, tests and an e2e spec; one production file, zero new exported types/components/stores, one existing production caller, three acceptance criteria, zero new error branches. The #469 analogue added 94 lines across its production and tests; this ticket's comparator edge cases and identity interactions explain the larger test surface. All six boundaries hold. No in-flight feature branch overlaps the planned files after refreshing origin.

## Design

`partitionActive<T>` retains its signature, filters archived rows and delegates to `partitionByPromotion`, then sorts each fresh partition by a private comparator. `groupByServer` preserves this order within each host and fallback while paired host order remains client-owned. No input array or row is modified; generic row stamps and references survive.

Comparison uses `titleFor(row.name).trim()` for the label, then `normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase()` for the key. Compare keys with UTF-16 `<`/`>`, then trimmed labels, then IDs with the same operators. No locale or natural-number comparison. Displayed names remain verbatim. `partitionByPromotion` and `partitionArchived` remain order-preserving.

## State + concurrency model

No new state, async work, subscriptions or teardown. Every render derives fresh partitions from the latest list snapshot. Existing rename/update broadcasts and list bridge deliver snapshots; stable row IDs retain selection, dot subscriptions and action targeting through reorder.

## Error handling

No new I/O or failure mode. Sorting is a pure renderer derivation and emits no logs containing daemon labels or IDs. Existing mutation lifecycle/error logging remains at the action boundaries.

## Testing strategy

- Vitest RED before production edits: worked example in both partitions; null/blank placeholders; trim without display mutation; compatibility/accent/case folding; numeric and UTF-16 ordering; label and ID ties; frozen inputs/reference identity; excluded archive rows and archive/shared input order.
- Static `ChannelList.test.tsx`: interleaved unsorted rows in both sections of two hosts plus both fallbacks; paired host and section boundaries; successive renamed/auto-named snapshots reorder rows. Update the old active-order assertion.
- New focused fake-transport spec reusing existing fixtures: create another chat after single-row launch, rename the open chat across it, distinguish its status dot, reopen its pen and assert prefill/command ID; promote that chat and assert its ID; section creates after reorder address each host. Capture the integrated sidebar at 1280×800 for visual comparison.
- Run touched unit files and `npm run build`, then only the focused fake-transport spec via the approved Electron launcher. Full regression belongs to the dispatcher.

## Open questions

None. The sorting contract and existing action identity are explicit.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/channel-list.md`, under “What it does”, “The view-model” and “Server grouping”, to describe alphabetical active-sidebar ordering and its tie-breaks. Preserve the shared partition's order-preserving Archive contract.
