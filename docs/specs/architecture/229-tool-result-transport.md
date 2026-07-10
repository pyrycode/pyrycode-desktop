# Spec #229 — Decode the daemon `tool_result` stream and resolve its timeline tool-call

**Size:** S · **security-sensitive** · Transport slice of the Phase-2 structured-streaming vertical
(ADR 0008). The **last** frame of the vertical. Split from #206 (transport #229 + render #230). Wires the
missing wire → transport → bridge chain that drives a `toolResult` `ThreadEvent`, which `reduceTimeline`
(#121) **correlates to its originating `toolCall` by `toolUseId`, filling `result` in place** —
`selectItems` / `timelineStore` (#202) already expose the resolved row. **No render** — the resolved-row
display (success / error styling) is the sibling slice **#230**, which consumes the `result` this slice
fills. **No `interactive` flip.** No UI surface (main-process transport + IPC types + two renderer bridge
cases), so there is no Figma / Design source section.

This is a near-exact **structural clone of #217** (the `tool_use` transport slice) — the **same six touch
points**. It differs from #217 in exactly two ways:

1. **One field is a boolean.** `is_error` is decoded with the existing `requireBoolean` helper (the
   snapshot `yolo` #180 / conversation `is_promoted` #139 idiom), **not** a fifth `requireString` and
   **not** a closed-enum check. The check is on the **type**, so `false` decodes as the value `false`,
   never treated as an absence (AC1). The daemon pins the full shape with no `omitempty` — `is_error:
   false` is a wire value, confirmed in the daemon's `internal/protocol` note ("`tool_result` with
   `is_error: false` are pinned exactly").
2. **The timeline arm resolves, it does not append.** #217's `toolUse` **appends** a pending `toolCall`
   (`result: null`); this slice's `toolResult` maps to a `ThreadEvent` that `reduceTimeline` folds through
   `fillResult` — **filling** the correlated call's `result` in place, with an orphan/duplicate as a
   deterministic same-reference no-op. That correlation logic **already exists** (`threadTimeline.ts`,
   #121); this slice only produces the event that drives it.

## Design source

N/A — main-process transport + IPC types + two renderer bridge cases; no UI surface. The resolved-row
visual (success / error chip styling) lands in the render sibling **#230**.

## Files to read first

Read these before writing a line. The whole design is "mirror the `tool_use` chain (#217) for one more
inbound event, but with four required strings + **one required boolean** (`is_error`), feeding a
`toolResult` `ThreadEvent` that **resolves** an existing `toolCall` in place instead of appending."

- `docs/specs/architecture/217-tool-use-transport.md` — **the direct template spec.** Its Design, Testing,
  Scope self-check, and Security sections map onto this one almost verbatim. Two deltas only: swap the fifth
  `requireString` for a `requireBoolean` on `is_error`, and the timeline-bridge arm maps to a **resolving**
  `toolResult` event (correlate-and-fill), not an **appending** `toolUse` event.
- `docs/knowledge/codebase/217.md` and `docs/knowledge/codebase/214.md` — **read end-to-end first.** The
  exact precedent chain, twice: wire type → `inboundMessage.ts` decode → `InboundDaemonMessage` kind →
  `daemonConnection.ts` consumer case → `DaemonEvent` arm → **both** renderer bridge cases (session no-op +
  timeline real). #229 is the same shape; the only per-file deltas are noted below.
- `src/shared/wire/types.ts:203-220` — `ToolUsePayload`: the doc-comment + interface style (name the mobile
  source, note "all always present, no `omitempty`", flag untrusted display text) to mirror for
  `ToolResultPayload`. The direct sibling to clone.
- `src/shared/wire/types.ts:135-151` — `ScreenSnapshotPayload`, specifically **`yolo: boolean`** (145-146)
  — the boolean-wire-field precedent, and the doc convention that a boolean's `false` is a value, never
  treated as absent. `is_error` mirrors it exactly.
- `src/shared/wire/types.ts:40-61` — `EnvelopeType` union (add `'tool_result'`, natural place: right after
  `'tool_use'` at line 55).
- `src/main/transport/inboundMessage.ts:141-150` — **`requireBoolean` — THE key delta helper.** Narrows one
  required boolean; a non-boolean (missing / string / number / object / `null`) throws `WireDecodeError`.
  The check is on the **type**, never truthiness — `false` is a valid value, not an absence. `is_error`
  uses this, **not** `requireString` and **not** an enum comparison.
- `src/main/transport/inboundMessage.ts:121-128` — `requireString`: the four string fields
  (`conversation_id`, `turn_id`, `tool_use_id`, `result_summary`) use it (category-only error message,
  never interpolating the value).
- `src/main/transport/inboundMessage.ts:239-252` — `parseScreenSnapshotPayload`: a parser that **mixes**
  `requireString` + `requireBoolean` (+ `requireNumber`) in one function — the exact mixed-field idiom to
  mirror. `yolo` at line 248 is the `is_error` template.
- `src/main/transport/inboundMessage.ts:309-327` — `parseToolUsePayload`: the parse-function shape
  (`isRecord` guard → per-field narrowers → return only known fields, extra keys tolerated but not copied).
  `parseToolResultPayload` is this with four strings + one boolean.
- `src/main/transport/inboundMessage.ts:99-112` — `InboundDaemonMessage` union (add one kind after the
  `tool-use` kind at line 109).
- `src/main/transport/inboundMessage.ts:558-572` — the `case 'tool_use'` switch arm: narrow **before**
  logging, content-free `inbound-decoded` log. The template for `case 'tool_result'`.
- `src/main/daemonConnection.ts:309-321` — the `case 'tool-use'` emit arm: fresh literal, snake→camel,
  **drop `conversation_id`**. The template for `case 'tool-result'`.
- `src/shared/ipc/events.ts:87-91` — `DaemonEvent` union; the `toolUse` arm at 91. Add one arm after it
  (see Design § 4). **No new import** — every field is a `string` or `boolean`.
- `src/renderer/src/store/daemonEventBridge.ts:58-73` — `translateDaemonEvent`; the
  `assistantDelta`/`turnEnd`/`turnState`/`toolUse` no-op group (58-64). Add `case 'toolResult'` to it
  (session store does not consume `toolResult`); forced by the `assertNever` at line 74.
- `src/renderer/src/store/timelineBridge.ts:36-55` — `translateTimelineEvent`; the **owned** block, esp.
  the `toolUse` arm (45-55). Add the **real** `case 'toolResult'` mapping here; forced by the `assertNever`
  at line 73. This is the arm that produces the `toolResult` `ThreadEvent`.
- `src/renderer/src/store/threadTimeline.ts:13-17,42-49,89-105,132-139,160` — the **already-shipped
  downstream**, do **not** modify: the `ToolResult { isError, resultSummary }` shape (13-17), the
  `ThreadEvent` `toolResult` arm (line 47), `fillResult` (89-105, the correlate-by-`toolUseId`-and-fill /
  same-ref-no-op logic), `reduceTimeline`'s `toolResult` arm (132-139), and `selectItems` (160). This slice
  **wires up to** these; it builds none of them.
- `src/renderer/src/store/timelineStore.ts` — `createTimelineStore` + `selectItems`: the end-to-end test
  target (drive events → assert `selectItems`).
- `src/main/diagnosticLog.ts:43` — `DiagnosticEvent.code?: string` is an **open optional string**.
  `code: 'tool_result'` needs **no** change here — do **not** touch this file (keeps #131's renderer
  type-pin intact).
- Test siblings to mirror: `src/main/transport/inboundMessage.test.ts` (the `tool_use` recognition +
  fail-closed cases), `src/main/daemonConnection.test.ts` (emit mapping), `daemonEventBridge.test.ts`
  (arm → null), `timelineBridge.test.ts` (owned-arm mapping + `subscribeTimeline` drives a real store),
  `src/shared/wire/types.test.ts` (type-level membership).

## Context

`tool_result` is the outcome half of the tool-call enrichment on desktop's Phase-2 structured stream
(ADR 0008). The daemon emits it mid-turn after a tool invocation finishes — success or error (pyrycode
#607 / ADR 025). Today a `tool_result` envelope is unmodeled and falls through `parseInboundMessage`'s
`default → inbound-unmodeled → null`.

The downstream is already built: `reduceTimeline`'s `toolResult` arm calls `fillResult`, which finds the
`toolCall` with a matching `toolUseId` **and** a still-`null` `result` and returns a new array with that
item's `result` filled `{ isError, resultSummary }`; an orphan (no such pending call) or duplicate (already
resolved) returns the **same** array reference → `reduceTimeline` returns the **same** state (deterministic
no-op, non-throwing, ADR 0008 / AC3). The `ToolResult` shape, the `ThreadEvent.toolResult` arm,
`selectItems`, and the `timelineStore` singleton all exist (#121 / #202); the pending `toolCall` is produced
by #217. What is missing is the chain that **feeds the resolution**. End state: a `tool_result` frame
resolves its correlated `toolCall`'s `result` in place, visible via `selectItems`; an uncorrelated result
is observably nothing.

Desktop withholds the `interactive` capability today (`codec.ts`, `helloExchange.ts`), so the daemon sends
none of this yet — flipping it on is **#179**. **Do not flip `interactive` here.** Build the decode path
Strangler-Fig alongside the coarse `message` path. The resolved-row **render** (success / error visual) is
**#230**, blocked on this.

## Design

Six thin, additive touchpoints, each mirroring the `tool_use` sibling. Nothing existing changes behaviour —
the coarse `message` / `message_chunk` path is untouched, and `threadTimeline.ts` is **not** modified.

### 1. Wire type — `src/shared/wire/types.ts`

Add a payload interface field-for-field with the daemon (pyrycode #607 / ADR 025, `protocol-mobile.md`),
all five fields required-present (no `omitempty`) — four strings and **one boolean**:

```ts
export interface ToolResultPayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  is_error: boolean
  result_summary: string
}
```

Add `'tool_result'` to the `EnvelopeType` union (after `'tool_use'`). Mirror the existing doc-comment
style: name the mobile source, note "all always present (no `omitempty`)"; note that **`is_error` is a
required boolean whose `false` is a value (success), never an absence** (the `yolo` #180 convention); and
note that **`result_summary` is an untrusted daemon-supplied string carried as opaque display text** (like
`input_summary` #217, `stop_reason` #199, `cwd` #139) — decoded, never interpreted, and that its DOM sink
is the render slice **#230** (render as plain text, never HTML). `tool_use_id` is the correlation key.

**No new wire enum** and **no new exported helper** — `requireBoolean` already exists. This slice adds
**one** exported type (`ToolResultPayload`).

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Add the union arm `| { kind: 'tool-result'; toolResult: ToolResultPayload }` to `InboundDaemonMessage`
  (kebab kind, after `tool-use`), and update that union's doc block to name the new arm (mirror the
  `tool-use` paragraph, noting the boolean field + that `result_summary` is opaque display text carried
  onward, its DOM sink being #230).
- Import `ToolResultPayload` alongside the existing `../wire/types` type imports.
- Add `parseToolResultPayload(payload: unknown): ToolResultPayload` — clone `parseToolUsePayload`
  (309-327): `isRecord` guard (throw `'malformed tool_result payload'`), then `requireString` for
  `conversation_id` / `turn_id` / `tool_use_id` / `result_summary` and **`requireBoolean` for `is_error`**
  (mirror `parseScreenSnapshotPayload`'s `yolo`, 248), returning exactly those five known fields. Extra
  server-added keys are tolerated (forward-compat) but not copied. **`is_error` uses `requireBoolean`, not
  `requireString`, not an enum** — the check is on the type so `false` is decoded as the value `false`, not
  an absence (AC1); a missing or non-boolean `is_error` throws `WireDecodeError` (never a partial value).
- Add `case 'tool_result'` to `parseInboundMessage`'s `switch (envelope.type)` (mirror `case 'tool_use'`,
  558-572): narrow **before** logging so a malformed frame throws first and leaves no record; emit
  `{ event: 'inbound-decoded', code: 'tool_result', bytes: plaintext.length, hash: hashPlaintext(plaintext) }`
  — **no decoded field** (`result_summary`, `is_error`, `tool_use_id`, `turn_id`, `conversation_id`) is
  logged; then `return { kind: 'tool-result', toolResult }`.

The existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails an oversized
frame closed for this type too — do not add a second guard.

### 3. Consumer emit — `src/main/daemonConnection.ts`

Add one `case 'tool-result'` to the inner `switch (inbound.kind)` (mirror `case 'tool-use'`, 309-321):
emit a fresh literal carrying the four render fields, snake→camel —

```ts
emitDaemonEvent(sink, {
  type: 'toolResult',
  turnId: inbound.toolResult.turn_id,
  toolUseId: inbound.toolResult.tool_use_id,
  isError: inbound.toolResult.is_error,
  resultSummary: inbound.toolResult.result_summary
})
```

**Drop `conversation_id`** (single active conversation, ADR 0004; #202's bridge scopes identity). Fresh
literal with named fields, never a spread of the decoded payload, so only the narrowed fields cross IPC.

### 4. `DaemonEvent` arm — `src/shared/ipc/events.ts`

Add one arm after the `toolUse` arm (91):

```ts
| { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
```

Carries only the four camelCase fields (`conversation_id` dropped at the emit) — no token, key, or raw
frame, preserving `events.ts`'s AC4-by-construction invariant. **No new import** (`string` / `boolean`).
Mirror the doc-comment on the `toolUse` arm (87-91): consumed by the **timeline** bridge (#202), not the
session store; `resultSummary` is opaque daemon display text whose DOM sink is #230.

### 5. Session bridge (no-op) — `src/renderer/src/store/daemonEventBridge.ts`

Add `case 'toolResult'` to the existing `assistantDelta`/`turnEnd`/`turnState`/`toolUse` no-op group
(58-64), so it falls through to `return null`. Required purely because the `assertNever` default (line 74)
makes a new `DaemonEvent` arm a compile error until every subscriber decides its mapping — the session store
does not consume `toolResult` (the timeline bridge does).

### 6. Timeline bridge (the real mapping) — `src/renderer/src/store/timelineBridge.ts`

Add to `translateTimelineEvent`'s **owned** block (mirror the `toolUse` arm at 45-55 — a fresh literal with
named fields, not a spread, not `return event`):

```ts
case 'toolResult':
  return {
    type: 'toolResult',
    turnId: event.turnId,
    toolUseId: event.toolUseId,
    isError: event.isError,
    resultSummary: event.resultSummary
  }
```

This is the arm that produces the `toolResult` `ThreadEvent` (`threadTimeline.ts:47`) which `reduceTimeline`
folds through `fillResult`. The `DaemonEvent` `toolResult` and the `ThreadEvent` `toolResult` are
field-for-field identical, so this is a filter-and-fresh-copy (arm selection), not a field remap. Do **not**
add `toolResult` to the null fall-through list — it is an **owned** arm; forced by the `assertNever` at
line 73.

### Data flow

```
relay socket (untrusted)
  → Noise decrypt → plaintext bytes
  → parseInboundMessage()             [transport boundary: fail-closed decode + content-free log]
      envelope.type 'tool_result' → parseToolResultPayload (4× requireString + 1× requireBoolean)
                                    → { kind:'tool-result', toolResult }
  → daemonConnection switch(inbound.kind)   [consumer: drop conversation_id]
      → emitDaemonEvent { type:'toolResult', turnId, toolUseId, isError, resultSummary }
  → IPC (DAEMON_EVENT_CHANNEL) → renderer
      → daemonEventBridge.translateDaemonEvent  → null   (session store: nothing)
      → timelineBridge.translateTimelineEvent   → { type:'toolResult', turnId, toolUseId, isError, resultSummary }
          → timelineStore.dispatch → reduceTimeline toolResult arm → fillResult(items, toolUseId, {isError, resultSummary})
             → correlated toolCall's result filled IN PLACE (new array); orphan/duplicate → same ref → same state (no-op)
```

## State + concurrency model

No new state, no new store, no new async task, no new IPC channel. Decode is a pure synchronous function;
the event rides the existing one-way `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent` on the existing driver
read loop. Correlation is **not** a new pending-request map — it is `reduceTimeline`'s existing
`fillResult` matching a result to a prior `toolCall` by `toolUseId` within the already-accumulated `items`
(no timers, no teardown). The two renderer bridges are two independent subscribers on the same channel
(already the case for `toolUse`): the session bridge no-ops `toolResult`, the timeline bridge owns it.
Fill-in-place, same-reference-on-no-op, and orphan/duplicate tolerance are all `fillResult`'s existing
properties (`threadTimeline.ts:89-105,132-139`), not new work here. Cancellation, socket lifecycle, and
reconnect are unchanged and owned upstream (`relaySupervisor` / `noiseRelayDriver`).

## Error handling

- **Any missing / non-string string-field** (`conversation_id`, `turn_id`, `tool_use_id`, `result_summary`)
  → `requireString` throws `WireDecodeError` (never a partial value).
- **Missing / non-boolean `is_error`** (absent, `undefined`, `'true'` the string, a number, `null`) →
  `requireBoolean` throws `WireDecodeError`. `false` is a valid decoded value (success), never an absence
  (AC1). This is the one field that differs from #217.
- **Payload not an object** (`'nope'`, `['a']`, `null`) → the `isRecord` guard throws `'malformed
  tool_result payload'` before any field read.
- **Oversized frame** → the existing `MAX_PLAINTEXT_BYTES` guard throws before decode.
- **Well-formed but unmodeled** other types → still fall to `default → inbound-unmodeled → null`, harmless
  drop. Only `tool_result` graduates here (`tool_result` no longer hits `inbound-unmodeled`, AC1).
- **Uncorrelated result at the reducer** — an orphan (`toolResult` with no matching pending `toolCall`) or a
  duplicate (call already resolved) is a **deterministic same-reference no-op**, non-throwing (`fillResult`
  existing behaviour, AC3). This slice adds no new code for it — it is a property of the wired chain.
- **`daemonConnection`'s existing `try/catch`** around `parseInboundMessage` drops a thrown frame — no
  event, no throw, no log (the caught error is dropped so it can't echo plaintext). No new catch needed.
- **Category-only error messages** — `requireString` / `requireBoolean` name the field only, never
  interpolating the value (`result_summary` could echo tool content); consistent with the decoder's uniform
  no-echo discipline.
- **Content-free diagnostics** — the new log call carries only `code` + `bytes` + `hash`, never a decoded
  field. The throw path stays unlogged (narrow before log).

## Testing strategy

Bullet scenarios; the developer writes the vitest code in the project idiom, mirroring the `tool_use` cases.
`npm test` + `npm run build` must stay green.

**`inboundMessage.test.ts`** (mirror the `tool_use` cases):
- Well-formed `tool_result{conversation_id, turn_id, tool_use_id, is_error, result_summary}` →
  `{ kind: 'tool-result', toolResult: {…} }`; all five fields verbatim.
- **`is_error: false` decodes as the value `false`** (not treated as an absence) → `toolResult.is_error ===
  false`; and `is_error: true` decodes as `true`. This is the AC1 boolean pin.
- Fail-closed — **throws `WireDecodeError`, no partial value** — for each of the five fields absent; for a
  non-string on any string field (number, object, `null`); for a **non-boolean `is_error`** (the string
  `'true'`, a number, `null`, an object); and for the payload not an object (`'nope'`, `['a']`).
- Extra server-added key is tolerated (decodes fine) but not copied onto the result.
- Content-free logging: with an injected `DiagnosticLog`, a decoded `tool_result` logs `code:'tool_result'`,
  `bytes`, `hash`, and the record contains **none** of `result_summary` / `is_error` / `tool_use_id` /
  `turn_id` / `conversation_id`. A malformed frame throws and logs **nothing**.

**`daemonConnection.test.ts`** (the safety net for the un-`assertNever`'d inner switch — a missing consumer
case silently drops):
- A `tool_result` frame delivered through the driver emits exactly one `{ type:'toolResult', turnId,
  toolUseId, isError, resultSummary }`; `conversation_id` is **absent** from the emitted event; `isError`
  survives both `true` and `false`.
- No regression: coarse `message` / `message_chunk` still emit `messageReceived` / `messagesReceived`.

**`daemonEventBridge.test.ts`**: `translateDaemonEvent` returns `null` for the `toolResult` arm (mirror the
`toolUse` case). This plus the `assertNever` guard is the compile-time + runtime proof the session bridge
handles the arm (AC4).

**`timelineBridge.test.ts`** (the end-to-end AC3 proof on the renderer side):
- `translateTimelineEvent({ type:'toolResult', … })` → `{ type:'toolResult', … }`, a **fresh** object with
  the four fields; and `toolResult` is **not** in the "returns null for every other arm" list.
- **Correlated fill through the real chain:** into an **isolated** `createTimelineStore()`, dispatch (via
  `subscribeTimeline`) a `toolUse` `DaemonEvent` then a `toolResult` `DaemonEvent` with the **same**
  `toolUseId` → `selectItems` shows the single `toolCall` with `result` = `{ isError, resultSummary }`
  filled in place (both `isError: true` and `isError: false` covered).
- **Orphan no-op:** a `toolResult` with **no** matching prior `toolCall` → `selectItems` unchanged (and,
  if verifiable, the same array reference — the deterministic no-op, AC3).
- **Duplicate no-op:** `toolUse` → `toolResult` → a **second** `toolResult` (same `toolUseId`) → the second
  is a no-op; `selectItems` after the second equals after the first (result not overwritten).

**`types.test.ts`**: the new `ToolResultPayload` interface and `'tool_result'` `EnvelopeType` member compile
(type-level membership, mirror the `tool_use` cases).

Type coverage: `npm run typecheck` — the two `assertNever` guards (`daemonEventBridge`, `timelineBridge`)
are the exhaustiveness proof that both subscribers handle the new arm (AC2).

## Scope self-check (6 production files — read this before flagging oversize)

This spec prescribes changes to **exactly 6 production `.ts` files, 0 new files** (`threadTimeline.ts` is
**not** among them — its `toolResult` arm, `ToolResult` shape, and `fillResult` already shipped in #121):

1. `src/shared/wire/types.ts` — `ToolResultPayload` + 1 `EnvelopeType` member
2. `src/main/transport/inboundMessage.ts` — 1 parse fn (4× `requireString` + 1× `requireBoolean`) + 1 kind + 1 switch case + 1 import
3. `src/main/daemonConnection.ts` — 1 consumer case
4. `src/shared/ipc/events.ts` — 1 `DaemonEvent` arm (no new import)
5. `src/renderer/src/store/daemonEventBridge.ts` — 1 `assertNever` case (join the no-op group → null)
6. `src/renderer/src/store/timelineBridge.ts` — 1 `assertNever` case (the real mapping)

This crosses the pre-commit ≥5-file self-check boundary, so the keep-as-S decision is **documented, not
assumed** — and it is an honest count (6), not an undercount rationalization (the failure mode that gate
targets: pyrycode #311 *claimed* 4 files, *actual* 13 / 300+ LOC):

- **6 is the architectural floor for this slice, verified.** Adding an inbound `DaemonEvent` that drives the
  timeline needs: wire type → decode → connection emit → event union → **both** renderer bridges (each is
  `assertNever`-guarded, so each is a compile error until it has a case). The only two exhaustive
  `DaemonEvent` switches are `daemonEventBridge` and `timelineBridge`; every other `DaemonEvent` reference
  is a non-exhaustive filter that ignores unknown arms (no case needed); `preload` forwards
  `DAEMON_EVENT_CHANNEL` generically. `InboundDaemonMessage` is consumed only by `daemonConnection`. There
  is no 7th file. The correlation/render downstream (`threadTimeline.ts`) is already built (#121), so this
  slice touches **fewer** downstream files than a greenfield reducer change.
- **Every file is a load-bearing, tiny, cloned edit** — 1–8 lines each, cloning the `tool_use` pattern that
  already lives in the same file. The accurate turn-budget proxies pass comfortably: **0 new files, ~45
  production + ~130 test ≈ ~175 total LOC** (well under the 600 total-LOC red line), **1 new exported type**
  (`ToolResultPayload`), **0 consumer call-site cascade** (the two bridge cases and the two switch cases are
  compile-forced single arms, no existing call site changes), **~6 reject paths** (five required-field
  checks + `isRecord`), **6 ACs** all facets of one change.
- **Multiple direct clean precedents shipped this exact chain as S**, code-review PASS, no salvage: **#217
  (the verbatim template, 6 prod files, one field delta simpler here)**, #214 (6), #199 (5), #180 (8), #139
  (8). #229 is strictly `≤` #217 in complexity (identical file set, one field is a `requireBoolean` instead
  of a `requireString`, and the reducer arm is already built so there is no new reducer logic). PO sized it
  S with the ≤6-file touch set stated explicitly in the ticket body, referencing the shipped #217 precedent
  — the file count is fully known upstream, not a discovered fan-out. There is no new information a PO bounce
  would surface.
- **Splitting is strictly worse and would ship dead code.** The only seam is wire+decode (files 1–2) vs.
  emit+event+bridges (files 3–6). Slice A would decode `tool_result` into an `InboundDaemonMessage` kind
  that `daemonConnection`'s un-`assertNever`'d inner switch **silently drops** — a decode with no consumer,
  observably nothing, a code smell a reviewer flags. The `tool_result` vertical is **already** split at the
  PO level (#206 → transport #229 + render #230); this is the minimal transport atom. Further splitting
  inverts the win.

Conclusion: genuine, verified, precedented S. Not an undercount — proceed.

## Open questions

- **Inner-switch exhaustiveness (deferred, not adopted).** `daemonConnection.ts`'s `switch (inbound.kind)`
  still has no `default: assertNever(inbound)`, so a missing consumer case silently drops rather than
  failing to compile. The `daemonConnection.test.ts` emit test is the deterministic safety net (same as
  #217 / #214). **Do not** expand scope to guard the switch here.
- **Untrusted `result_summary` reaches the render slice as free text (forward to #230).** Like #217's
  `input_summary`, `result_summary` is an arbitrary daemon-supplied string that DOES cross to the render
  slice — the same posture as `assistant_delta.text` (#199 → rendered as text-not-HTML by #203). #230 must
  render it as **plain text**, never HTML / `dangerouslySetInnerHTML`, and treat it as an opaque summary (no
  re-parsing). This slice carries it verbatim and never interprets it; flagged here so #230 inherits the
  constraint. `is_error` is a decoded boolean (not attacker text) and drives the success/error styling in
  #230.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The untrusted→trusted boundary (relay socket → decrypted plaintext →
  `parseInboundMessage`) gains one explicit, single-function fail-closed decoder (`parseToolResultPayload`),
  throwing `WireDecodeError` on any structural/type mismatch, never a partial value — the same named
  boundary that already owns `message` / `tool_use` / `turn_state`. The defence is **required-field
  presence with type checks**: four `requireString` (covers missing / `undefined` / number / object /
  `null`) plus **one `requireBoolean`** on `is_error` (covers a smuggled non-boolean — the string `'true'`,
  a number, an object — that a truthiness check would silently accept). A hostile daemon cannot smuggle a
  non-string, a `'__proto__'`-shaped structure, or a non-boolean onto a `toolResult`. Positive control
  against IPC-side unknown-key / prototype leakage: the consumer emits a **fresh object literal** with four
  named fields (`{ type:'toolResult', turnId, toolUseId, isError, resultSummary }`), never a spread of the
  decoded payload, so only the narrowed values cross IPC; the timeline bridge likewise reconstructs a fresh
  literal.
- **[Trust boundaries — forward to the render slice #230]** SHOULD FIX (design-directed, forwarded, not a
  gate on this slice). `result_summary` is an **untrusted daemon-supplied string carried as opaque display
  text** — decoded, never interpreted here, but it DOES reach the render slice (#230) as free text (same
  posture as `input_summary` #217 → #218, `assistant_delta.text` #199 → #203). Documented in Open Questions
  and the wire doc-comment (Design § 1): **#230 must render it as plain text**, never
  `dangerouslySetInnerHTML`. No DOM sink exists in *this* slice (transport + IPC only), so there is nothing
  to exploit here; the constraint is forwarded so it is not lost. `is_error` is a boolean (no content to
  inject).
- **[Tokens / secrets]** N/A by design. No token / key / credential is added, decoded, or carried. The one
  arm carries three opaque strings + a boolean; `conversation_id` is decoded at the boundary and **dropped**
  at the emit (single active conversation). No field on the arm can hold a key / token / raw frame
  (AC4/AC5), matching `events.ts`'s existing invariant.
- **[File / storage]** N/A — no filesystem or storage operation. `tool_use_id` / `result_summary` are never
  resolved into a path or opened; they are correlation-key / display text only (the `cwd` #139 discipline).
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, IPC channel,
  `ipcMain` handler, custom protocol, or preload method — the arm rides the existing one-way
  `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`) that `preload/index.ts` already forwards generically (no
  per-type preload change). Process placement preserved: decode lives in
  `src/main/transport/inboundMessage.ts` (main-only, imports `Buffer`, never re-exported to a renderer
  barrel); no key, socket, or raw frame moves toward the renderer. The three opaque strings + one boolean
  flowing main→renderer grant the renderer no new reach toward transport / keys.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code. `hashPlaintext` (BLAKE2s via
  `@noble/hashes`, note #101) is reused verbatim for content-free logging; no new or hand-rolled crypto.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard at the top of
  `parseInboundMessage` fails an oversized `tool_result` frame closed before decode — no new size cap
  needed, and it bounds `result_summary` (a potentially long summary) at the frame level. The payload is
  four flat string scalars + one boolean (no array, no nesting), so there is no decode amplification; each
  field is a single `typeof` check in O(1) with **no regex** (no ReDoS). No new socket / timeout / reconnect
  surface.
- **[Error messages, logs, telemetry]** No finding — the category the ticket is security-sensitive *for*,
  addressed head-on. The one new diagnostic call is **content-free** (`code:'tool_result'` + `bytes` +
  one-way `hash` only), emitted **after** the frame fully narrows so the throw path leaves no record;
  `requireString` / `requireBoolean` error messages name the failure **category only** (`missing required
  field: <field>` — never interpolating `result_summary` / `is_error` / `tool_use_id` or the
  conversation-correlating `conversation_id`); the `WireDecodeError` caught in `daemonConnection` is dropped,
  never logged or forwarded. `is_error` is a boolean and never enters the log regardless.
- **[Concurrency]** No finding — no new async task, timer, listener, or socket; decode is synchronous; the
  event rides the existing driver read loop. No shared-state check-then-act, nothing to cancel or leak. The
  two renderer bridges are pre-existing independent subscribers. `fillResult` is a pure reducer step (fresh
  array on match, same reference on no-op), no mutation across an await.
- **[Threat model alignment]** Addressed for the boundary this slice owns. *Malicious / compromised relay*
  (on-path, content-blind): a flood of malformed `tool_result` frames all throw and drop — no plaintext
  leak, no log record, no hang (synchronous, frame-bounded); an orphan/duplicate `tool_result` (reorder /
  replay of a resolved call) is a deterministic no-op, not a crash or a double-fill. *Hostile daemon
  response* (malformed / oversized inside the session): every field parsed defensively, fail-closed on
  required-field presence (including the boolean), frame size capped upstream — this slice's raison d'être.
  *Renderer compromise reaching transport*: unchanged — no new renderer capability; the only cross-boundary
  payload is three opaque strings + a boolean, and the one free-text field (`result_summary`) the render
  slice (#230) must treat as text (forwarded above).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
