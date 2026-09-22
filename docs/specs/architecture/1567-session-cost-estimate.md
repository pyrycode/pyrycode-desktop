# #1567 — the session's running cost in the channel info sheet, as Claude's estimate

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen` (the `items` of the open conversation's timeline, already read at screen level; the `channelInfoOpen` mount), `ChannelInfoSheet` (the container that forwards props), `ChannelInfoSheetView` (the Session section's label/value rows).
- `src/renderer/src/screens/conversation/turnStats.ts` → `formatTurnStats` — the sibling #1566 formatter; its "finite and above 0" rule is the one this ticket applies to cost.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem` — the `turnBoundary` arm carries `TurnEndMetrics`, including `costUsdTotal`.
- `src/shared/ipc/events.ts` → `TurnEndMetrics` — `costUsdTotal` is the SESSION's running total, claude's estimate.
- `src/renderer/src/screens/conversation/SessionFacts.test.tsx` → the static-markup tests of the Session section, which the new view tests sit beside.
- `e2e/turn-stats-hover.spec.ts`, `e2e/channel-session-facts.spec.ts` → the `send_message` → `assistant_delta` + `turn_end` reply shape and the sheet-opening steps the new spec reuses.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

The Channel info sheet: a column of full-width label/value rows (label left in body text, value right-aligned in the secondary ink) under small section headers. The cost row has no drawn state, so it is one more `.channel-info__row` in the Session section, styled exactly like the Claude version and permission-mode rows above it. No new CSS or token.

## Change

A new module `src/renderer/src/screens/conversation/sessionCost.ts` exports two pure functions:

- `latestSessionCostUsd(items: readonly ThreadItem[]): number | null` — scans backwards and returns the `costUsdTotal` of the latest `turnBoundary` whose value is finite and above 0; `null` when none. Never sums: each value already includes the earlier ones. A later boundary with the value absent, 0, negative or non-finite is skipped, so it does not replace an earlier one.
- `formatSessionCost(usd: number): string` — `$0.42 est.`, rounded to cents via `toFixed(2)`.

`ConversationScreen` computes `latestSessionCostUsd(items)` inside the `channelInfoOpen` branch (so the scan runs only while the sheet is mounted) and passes it to `ChannelInfoSheet` as `sessionCostUsd`, which forwards it to `ChannelInfoSheetView`. The view gains an optional `sessionCostUsd?: number | null` prop (default `null`, so every existing call site and test is untouched) and, inside the existing `conversation !== null` Session block, renders one more row after the two facts rows when it is non-null: label `Cost (Claude's estimate)`, value `formatSessionCost(...)`. The value is a number formatted by the client, rendered as a React text child, never logged. With no positive value there is no row at all.

Production files: `ConversationScreen.tsx` (modified), `sessionCost.ts` (new).

## Testing strategy

- `sessionCost.test.ts` (vitest): 0.10 then 0.42 → 0.42 (not 0.52); a later absent / 0 / negative / NaN value leaves the earlier one; no boundaries, or only non-positive values → `null`; format `0.42` → `$0.42 est.`, `0.4213` → `$0.42 est.`, `12` → `$12.00 est.`.
- `SessionFacts.test.tsx` (static markup): `sessionCostUsd={0.42}` renders the label (escaped apostrophe) and `$0.42 est.` inside the Session section; absent → neither.
- `e2e/channel-info-session-cost.spec.ts` (fake transport): open the sheet before any turn → no cost row; send twice, the replies' `turn_end` carrying `cost_usd_total` 0.10 then 0.42, then a third whose `turn_end` carries none; open the sheet → the row labelled `Cost (Claude's estimate)` reads `$0.42 est.`.

## Open questions

- A `sessionBoundary` (a `/clear` or new session) is not treated as a reset: the ticket's rule is "the most recent positive value in the open conversation's timeline", and the next turn's value replaces the old session's anyway. Followed literally.

## Documentation handoff

The ticket names no documentation requirement. Pending for the documentation stage: record the cost row in the channel-info package overview, as it owns the Session section.
