# #1565 — carry a turn's token counts, duration and session cost onto the turn boundary

## Files read

- `src/shared/wire/types.ts` → `TurnEndPayload`: the snake_case wire mirror that gains six optional numbers.
- `src/main/transport/inboundMessage.ts` → `parseTurnEndPayload` (the lenient optional-field idiom `boundedReport` sets the pattern), `decodeHistoryEvent`'s `turn_end` case, `DecodedHistoryEvent`: the parse and the history-replay translation.
- `src/main/daemonConnection.ts` → the `turn-end` case of the inbound switch: the live emit, copies named fields, never spreads the payload.
- `src/shared/ipc/events.ts` → `DaemonEvent`'s and `HistoryTimelineEvent`'s `turnEnd` arms: the IPC contract. `daemonConnection.ts` assigns `DecodedHistoryEvent` to `HistoryTimelineEvent`, so the two history arms must move together.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`'s `turnEnd` case: rebuilds a `ThreadEvent` by named fields.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadEvent` / `ThreadItem` `turnEnd` / `turnBoundary` arms and `reduceTimeline`'s `turnEnd` case. `latestTurnEnd` is `Extract<ThreadEvent, …>`, so it widens with no edit.
- `src/shared/chatHistory.ts` → `DurableThreadItem` and `threadItem`: the on-disk row. Out of scope; its parser rebuilds `turnBoundary` from named fields, so the new numbers never reach disk.
- `src/renderer/src/store/chatHistoryContract.test.ts`: a type-level drift guard, `DurableThreadItem` equal to `ThreadItem`. Widening `turnBoundary` breaks it (the web tsconfig includes tests), so the guard must be narrowed to say "equal, except the turn metrics that are deliberately not persisted".
- Analogue: #1560 (`84a0ee3a`), two optional fields carried through the same parse, IPC and test-double sites.

## Design source

N/A — this slice adds nothing visible; the display tickets #1566 and #1567 carry the Figma.

## Context

The daemon's `turn_end` now carries claude's `result` numbers (pyrycode #2260, #2261). The desktop drops them at `parseTurnEndPayload`. This slice carries six of them to the `turnBoundary` timeline item so the display tickets can render them. `duration_api_ms` and `num_turns` are deliberately not carried (the ticket explains why).

## Design

One shared camelCase shape, declared once in `src/shared/ipc/events.ts` beside the arms that use it (the renderer already imports `ModelRefusalEvent` from there, so the direction is established):

```ts
export interface TurnEndMetrics {
  durationMs?: number          // this turn's wall time
  inputTokens?: number         // this turn's uncached input tokens
  cacheReadTokens?: number
  cacheCreationTokens?: number
  outputTokens?: number
  costUsdTotal?: number        // the SESSION's running total, USD
}
```

It is intersected (`& TurnEndMetrics`) into these five arms: the live `DaemonEvent` `turnEnd`, `HistoryTimelineEvent` `turnEnd`, `DecodedHistoryEvent` `turnEnd`, `ThreadEvent` `turnEnd` and `ThreadItem` `turnBoundary`.

Wire: `TurnEndPayload` gains `duration_ms?`, `input_tokens?`, `cache_read_tokens?`, `cache_creation_tokens?`, `output_tokens?`, `cost_usd_total?`, all `number`.

Parse: `parseTurnEndPayload` reads each through a local `finiteNumber` guard (`typeof === 'number' && Number.isFinite`), otherwise `undefined`. It is lenient like `boundedReport`: a bad value is dropped and never rejects the frame. No clamping, so `0` and negatives pass through.

Copy hops, each by named field and never by spreading a payload:
- **Main (both paths):** one helper `turnEndMetricsOf(p: TurnEndPayload): TurnEndMetrics`, exported from `inboundMessage.ts`, maps snake to camel as a fresh literal. The history `turn_end` case and the `daemonConnection.ts` live emit both spread its result. It is a fresh named-field literal, so a later decoder field still cannot cross.
- **Renderer:** `translateTimelineEvent` and `reduceTimeline` copy the six fields by name, matching how they copy `outcome` and the rest today.

Missing values are explicit `undefined` properties, the same as `outcome` today. Structured clone keeps them, and `toEqual` reads them as absent.

## State + concurrency model

No new state, no async work. `turnBoundary` items gain optional fields and `latestTurnEnd` widens through its `Extract`. No subscription changes.

## Error handling

No new failure mode. A non-numeric or non-finite value is dropped to `undefined` and the frame decodes as before. Nothing is logged. The numbers are not secrets, but no existing log line carries turn-end fields, and this adds none.

## Persistence

`DurableThreadItem` stays as it is (ticket out of scope), and `threadItem` already rebuilds `turnBoundary` by named fields, so a reloaded chat's boundaries carry no metrics. `chatHistoryContract.test.ts` changes from strict equality with `ThreadItem` to equality with `ThreadItem` after the `TurnEndMetrics` keys are omitted from the `turnBoundary` arm. The drift guard still catches any other divergence.

## Testing strategy

Vitest only. There is no interaction to drive.
- `inboundMessage.test.ts`: a live `turn_end` carrying all six numbers decodes them onto `turnEnd` (snake → wire fields). One carrying `0` and negatives keeps them as given. Strings, `null`, missing keys (and non-finite values through the parser, if reachable) come back `undefined`, and the frame still decodes. The history decode of a `turn_end` entry yields the camelCase fields.
- `daemonConnection.test.ts`: a live `turn_end` frame emits a `turnEnd` event carrying the six camelCase fields.
- `timelineBridge.test.ts`: `translateTimelineEvent` copies the six fields, both for a live event and a history event.
- `threadTimeline.test.ts`: `reduceTimeline` puts them on the appended `turnBoundary`, `0` and negatives included, and an event without them yields a boundary without them.
- `chatHistoryContract.test.ts`: the narrowed type guard.

## Size

6 production files, one over the five-file line. The refiner accepted this under the floor rule, since the main half has no consumer besides the renderer half. Around 350 lines of written work. One new exported type (`TurnEndMetrics`) and one exported helper.

## Documentation handoff

Pending for the documentation stage: fold the new `turnBoundary` metrics and the narrowed chat-history contract guard into the timeline-store and wire overviews under `docs/knowledge/features/`. The ticket names no specific reference-doc section.

## Open questions

- Can a non-finite number reach `parseTurnEndPayload` at all? `JSON.parse` never yields one. The guard stays as defence and is tested directly if the parse is reachable with a constructed payload.
