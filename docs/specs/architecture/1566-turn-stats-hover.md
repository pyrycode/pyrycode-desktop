# #1566 — tokens and time per turn on hover of the turn's last assistant meta row

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `TimelineRow`, `BubbleMeta` — where the row is chosen and where the meta row is drawn. `Timeline` already derives per-row facts from `items` during render (the `inProgress` flag); the stats selection is one more such derivation.
- `src/renderer/src/screens/conversation/foldQueuedRows.ts` → `foldQueuedRows` — rows below `items.length` are `items` in order, index for index; unmatched queued rows are appended after. So an item index is a valid row index for the lookup.
- `src/shared/ipc/events.ts` → `TurnEndMetrics` — the five fields this ticket reads (`costUsdTotal` is #1567's).
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem` — `turnBoundary` carries `TurnEndMetrics`; `assistantText` carries `turnId` and `createdAt`.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__meta`, `.bubble__copy` — the row's body-small type, `--color-inverse-primary` ink, 8px gap and 16px min-height, all of which the new span inherits.
- `src/shared/wire/types.ts` → `TurnEndPayload` — the snake_case fields the e2e spec pushes.
- `e2e/message-copy.spec.ts` → `buildReplyFrames` — the `assistant_delta` + `turn_end` push shape.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4379

The assistant meta row (instance `132:4446` in message `132-4443`): a single body-small line in `--color-inverse-primary`, timestamp then the copy glyph, left-aligned. The hover content has no drawn state, so it is one more text run in that same row, with the row's own type and ink, and it occupies no space at all until hovered.

## Context

#1565 put each turn's `durationMs` and token counts on its `turnBoundary`. Nothing renders them. The operator wants to tell a heavy turn from a light one without anything added inline.

## Design

### Formatter — new module `src/renderer/src/screens/conversation/turnStats.ts`

- `formatTurnStats(metrics: TurnEndMetrics): string | null` — the ticket's format, `12.4k in · 800 out · 41s`. A value counts only when it is a finite number above 0 (absent, `0`, negative → omitted). `in` sums the three input parts, each counted as 0 unless positive. Counts below 1000 are rounded whole numbers; from 1000 up, `(Math.round(n / 100) / 10).toFixed(1)` + `k`. Duration is `Math.floor(ms / 1000)` seconds, omitted under 1; under 60 `Ns`, otherwise `Mm Ss` with minutes unbounded. Segments join with ` · `; no segment → `null`.
- `turnStatsByItemIndex(items: readonly ThreadItem[]): ReadonlyMap<number, string>` — one forward pass. Tracks the index of the last `assistantText` seen since the previous `turnBoundary`; on each `turnBoundary`, if one was seen and `formatTurnStats` yields a string, map that index to it; then reset. Tool rows and every other kind neither set nor reset the tracker, so tool rows between the bubble and the boundary do not change which bubble it is. A turn without a boundary (still open) never maps; a turn with no assistant text maps nothing.

The reset is on `turnBoundary` only, never on `userText`: a message sent while a turn runs echoes into `items` before that turn's boundary, and resetting there would drop the running turn's stats.

### Render — `ConversationScreen.tsx`

- `Timeline` computes `turnStatsByItemIndex(items)` once per render and passes `turnStats={map.get(group.index)}` to `TimelineRow` (row index = item index below `items.length`, see `foldQueuedRows`).
- `TimelineRow` gains an optional `turnStats?: string` prop, read only in the `assistantText` arm, which forwards it to `BubbleMeta`.
- `BubbleMeta` gains optional `turnStats?: string`. When present it appends `<span className="bubble__turn-stats">{turnStats}</span>` after the copy button. React text child only — never an attribute, never `title`, never logged (CLAUDE.md daemon-text rule). When absent the markup is byte-identical to today, so every existing exact-markup assertion is untouched.

### Style — `conversation.css`

- `.bubble__turn-stats { display: none; white-space: nowrap; }` and `.bubble__meta:hover .bubble__turn-stats { display: inline; }`. `display: none` rather than `visibility: hidden`: the latter would reserve width and could widen a short bubble while unhovered. Type and colour are inherited from `.bubble__meta`; no new token.

## State + concurrency model

None. A pure derivation over `items` during render; hover is CSS. No store, no async work, nothing to tear down.

## Error handling

No failure modes: missing or non-positive numbers are omitted segments, all-omitted is `null` and draws nothing. Saved offline threads carry no metrics (`DurableThreadItem`), so they draw nothing, by design. Nothing is logged: there is no lifecycle event or error to log, and the values are daemon-supplied.

## Testing strategy

- `turnStats.test.ts` (vitest): full string `12.4k in · 800 out · 41s`; `in` sums the three parts and ignores absent / non-positive parts; count boundaries `999`, `1000` → `1.0k`, `12449` → `12.4k`; duration `999` omitted, `41000` → `41s`, `60000` → `1m 0s`, `125000` → `2m 5s`, `4503000` → `75m 3s`; each segment omitted independently keeps ` · `; all absent → `null`. `turnStatsByItemIndex`: last of two assistant bubbles in a turn is chosen; tool rows between bubble and boundary do not move it; open turn maps nothing; boundary of a turn with no assistant text does not attach to the previous turn's bubble; boundary with no numbers maps nothing.
- `ConversationScreen.test.tsx` (static markup): a two-bubble turn with a metric-carrying boundary renders exactly one `bubble__turn-stats`, after the second bubble's text; the user bubble has none.
- `e2e/turn-stats-hover.spec.ts` (fake transport): two sends; the first reply's `turn_end` carries all numbers, the second's none. Asserts the first assistant bubble's stats are hidden unhovered, then after hovering its meta row show exactly the formatted string; the meta row's height is unchanged across hover; the second bubble has no stats element and hovering adds nothing.

## Open questions

- None blocking. Keyboard focus reveal (`:focus-within`) is not asked for and not added.

## Documentation handoff

The ticket has no Documentation handoff section. Pending for the documentation stage: record the hover stats row in `docs/knowledge/features/conversation-shell-message-bubble.md`.
