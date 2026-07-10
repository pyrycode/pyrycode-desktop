# Spec #217 — Decode the daemon `tool_use` stream into a timeline `toolCall`

**Size:** S · **security-sensitive** · Transport slice of the Phase-2 structured-streaming vertical
(ADR 0008). Split from #205. Wires the missing wire → transport → bridge chain that feeds a `toolCall`
`ThreadItem` (`result: null`) into the timeline `reduceTimeline` (#121) / `selectItems` / `timelineStore`
(#202) already reduce and expose. **No render** — the tool row that displays the call is the sibling slice
(#218), blocked on this one. **No `interactive` flip.** No UI surface (main-process transport + IPC types +
two renderer bridge cases), so there is no Figma / Design source section.

This is a near-exact **structural clone of #214** (the `turn_state` transport slice, which itself cloned
#199's `assistant_delta` chain) — the **same six touch points**. It differs from #214 in exactly two ways:
its payload is **five all-required-string fields, no wire enum** (so the decode is the `requireString`
idiom of `parseTurnEndPayload`, **not** the `state` closed-enum check), and its timeline-bridge arm maps to
a **real content item** (`toolCall`) rather than the coarse `phase` scalar.

## Files to read first

Read these before writing a line. The whole design is "mirror the `turn_state` chain (#214) for one more
inbound event, but with five required strings and no enum, feeding a `toolCall` item instead of `phase`."

- `docs/knowledge/codebase/214.md` and `docs/knowledge/codebase/199.md` — **read end-to-end first.** The
  exact precedent chain, twice: wire type → `inboundMessage.ts` decode → `InboundDaemonMessage` kind →
  `daemonConnection.ts` consumer case → `DaemonEvent` arm → **both** renderer bridge cases (session no-op +
  timeline real). #217 is the same shape; the only per-file deltas are noted below.
- `docs/specs/architecture/214-decode-turn-state-phase.md` — the direct template spec; its Design,
  Testing, Scope, and Security sections map onto this one almost verbatim (swap the enum check for
  five `requireString`s, swap `phase` for a `toolCall` item).
- `src/shared/wire/types.ts:150-177` — `AssistantDeltaPayload` / `TurnEndPayload`: the doc-comment +
  interface style (name the mobile source, note "all always present, no `omitempty`") to mirror for
  `ToolUsePayload`. `TurnEndPayload` (three required strings) is the closest field-shape precedent.
- `src/shared/wire/types.ts:40-58` — `EnvelopeType` union (add `'tool_use'`).
- `src/main/transport/inboundMessage.ts:102-109` — **`requireString` — THE key reference.** The required-
  string presence helper: a non-string (missing / number / object / `null`) throws `WireDecodeError` with a
  **category-only** message. Every `ToolUsePayload` field uses it. There is **no enum** here — do not clone
  the `state` / `role` three-way comparison; five `requireString`s is the whole decode.
- `src/main/transport/inboundMessage.ts:243-267` — `parseAssistantDeltaPayload` / `parseTurnEndPayload`:
  the parse-function shape (`isRecord` guard → per-field narrowers → return only known fields, extra keys
  tolerated but not copied) to mirror for `parseToolUsePayload`. `parseTurnEndPayload` (three
  `requireString`s) is the exact idiom, extended to five fields.
- `src/main/transport/inboundMessage.ts:83-93` — `InboundDaemonMessage` union (add one kind).
- `src/main/transport/inboundMessage.ts:414-451` — the `case 'assistant_delta'` / `case 'turn_end'` /
  `case 'turn_state'` switch arms: narrow **before** logging, content-free `inbound-decoded` log. The
  template for `case 'tool_use'`.
- `src/main/daemonConnection.ts:283-308` — the `case 'assistant-delta'` / `case 'turn-end'` /
  `case 'turn-state'` emit arms: fresh literal, snake→camel, **drop `conversation_id`**. The template for
  `case 'tool-use'`.
- `src/shared/ipc/events.ts:56-89` — `DaemonEvent` union; the `assistantDelta` / `turnEnd` / `turnState`
  arms at 78-83. Add one arm after them (see Design § 4). **No new import** — every field is a `string`.
- `src/renderer/src/store/daemonEventBridge.ts:58-63` — `translateDaemonEvent`; the
  `assistantDelta` / `turnEnd` / `turnState` no-op group. Add `case 'toolUse'` to it (session store does
  not consume `toolUse`); forced by the `assertNever` at line 69.
- `src/renderer/src/store/timelineBridge.ts:36-44` — `translateTimelineEvent`; the **owned** block
  (`assistantDelta` / `turnEnd` / `turnState`). Add the **real** `case 'toolUse'` mapping here; forced by
  the `assertNever` at line 60. This is the arm that produces the `toolUse` `ThreadEvent`.
- `src/renderer/src/store/threadTimeline.ts:24-49,113-131` — the **already-shipped downstream**: the
  `toolCall` `ThreadItem` member (24-34, `result: ToolResult | null`), the `ThreadEvent` `toolUse` arm
  (line 46), and `reduceTimeline`'s `toolUse` arm (117-131) that **appends** a `toolCall` with `result:
  null` in arrival order (splitting a turn's text into two items around the call). This slice **wires up
  to** these; it does not build them. Confirms the timeline-bridge arm is a thin rename, not new logic.
- `src/renderer/src/store/timelineStore.ts:33-51` — `createTimelineStore` + `selectItems`: the end-to-end
  test target (drive event → assert `selectItems`).
- `src/main/diagnosticLog.ts:43` — `DiagnosticEvent.code?: string` is an **open optional string**.
  `code: 'tool_use'` needs **no** change here — do **not** touch this file (keeps #131's renderer type-pin
  intact).
- Test siblings to mirror: `src/main/transport/inboundMessage.test.ts` (the `assistant_delta` /
  `turn_end` / `turn_state` recognition + fail-closed cases), `src/main/daemonConnection.test.ts` (emit
  mapping), `src/renderer/src/store/daemonEventBridge.test.ts` (arm → null),
  `src/renderer/src/store/timelineBridge.test.ts` (owned-arm mapping + `subscribeTimeline` drives a real
  store), `src/shared/wire/types.test.ts:1-40` (type-level membership tests).

## Context

`tool_use` is the tool-call enrichment of desktop's Phase-2 structured stream (ADR 0008) — a durable,
ordered **timeline item**, unlike `turn_state`'s coarse `phase` scalar. The daemon emits `tool_use` mid-turn
when the assistant invokes a tool (pyrycode #607 / ADR 025). Today a `tool_use` envelope is unmodeled and
falls through `parseInboundMessage`'s `default → inbound-unmodeled → null`.

The downstream is already built: `reduceTimeline`'s `toolUse` arm appends a `toolCall` `ThreadItem`
(`result: null`) in arrival order, splitting a turn into two `assistantText` items around the call
(`threadTimeline.ts:117-131`); `selectItems` and the `timelineStore` singleton exist (#121 / #202); the
render container landed (#203). What is missing is the chain that feeds it. End state: a `tool_use` frame
drives one `toolCall` item onto `timelineStore`, visible via `selectItems`, in arrival order. Correlating
the later `tool_result` to that call by `toolUseId` is **#206**. The tool **row** that renders the call is
**#218**, blocked on this. Desktop withholds the `interactive` capability today (`codec.ts`,
`helloExchange.ts`), so the daemon sends none of this yet — flipping it on is **#179**. **Do not flip
`interactive` here.** Build the decode path Strangler-Fig alongside the coarse `message` path.

## Design

Six thin, additive touchpoints, each mirroring the `turn_end` / `turn_state` siblings. Nothing existing
changes behaviour — the coarse `message` / `message_chunk` path is untouched.

### 1. Wire type — `src/shared/wire/types.ts`

Add a payload interface field-for-field with the daemon (pyrycode #607 / ADR 025, `protocol-mobile.md`),
all five fields required-present (no `omitempty`), all plain strings — the `assistant_delta` / `turn_end`
precedent exactly:

```ts
export interface ToolUsePayload {
  conversation_id: string
  turn_id: string
  tool_use_id: string
  name: string
  input_summary: string
}
```

Add `'tool_use'` to the `EnvelopeType` union. Mirror the existing doc-comment style: name the mobile
source, note "all always present (no `omitempty`)", and note that `name` / `input_summary` are **untrusted
daemon-supplied strings carried as opaque display text** (like `stop_reason` #199, `cwd` #139) — decoded,
never interpreted, and that `input_summary` is the **daemon's human-readable précis of the tool input, not
the raw input** (pyrycode `internal/turnbridge`), carried verbatim.

**No new wire enum** (unlike #214's `WireTurnState`): every field is a bare `string`, so this slice adds
**one** exported type (`ToolUsePayload`), not two.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts`

- Add the union arm `| { kind: 'tool-use'; toolUse: ToolUsePayload }` to `InboundDaemonMessage` (kebab
  kind, consistent with `assistant-delta` / `turn-end` / `turn-state`).
- Import `ToolUsePayload` alongside the existing `../wire/types` type imports.
- Add `parseToolUsePayload(payload: unknown): ToolUsePayload` — clone `parseTurnEndPayload`
  (`inboundMessage.ts:259-267`): `isRecord` guard (throw `'malformed tool_use payload'`), then five
  `requireString` calls (`conversation_id`, `turn_id`, `tool_use_id`, `name`, `input_summary`), returning
  exactly those five known fields. Extra server-added keys are tolerated (forward-compat) but not copied.
  **There is no enum to validate** — do **not** reach for the `state` / `role` three-way comparison; the
  fail-closed defence here is required-string presence, and `requireString` already covers missing / non-
  string alike with a category-only message that never interpolates the value. Behaviour asserted by the
  fail-closed + happy-path tests.
- Add `case 'tool_use'` to `parseInboundMessage`'s `switch (envelope.type)` (mirror `case 'turn_state'`,
  `inboundMessage.ts:440-451`): narrow **before** logging so a malformed frame throws first and leaves no
  record; emit `{ event: 'inbound-decoded', code: 'tool_use', bytes: plaintext.length, hash:
  hashPlaintext(plaintext) }` — **no decoded field** (`name`, `input_summary`, `tool_use_id`, `turn_id`,
  `conversation_id`) is logged; then `return { kind: 'tool-use', toolUse }`.

The existing `MAX_PLAINTEXT_BYTES` guard at the top of `parseInboundMessage` already fails an oversized
frame closed for this type too — do not add a second guard.

### 3. Consumer emit — `src/main/daemonConnection.ts`

Add one `case 'tool-use'` to the inner `switch (inbound.kind)` (mirror `case 'turn-state'`,
`daemonConnection.ts:303-308`): emit a fresh literal carrying the four camelCase fields —

```ts
emitDaemonEvent(sink, {
  type: 'toolUse',
  turnId: inbound.toolUse.turn_id,
  toolUseId: inbound.toolUse.tool_use_id,
  name: inbound.toolUse.name,
  inputSummary: inbound.toolUse.input_summary
})
```

**Drop `conversation_id`** (single active conversation, ADR 0004; #202's bridge scopes identity). Fresh
literal with the four named fields, never a spread of the decoded payload, so only the narrowed fields
cross IPC.

### 4. `DaemonEvent` arm — `src/shared/ipc/events.ts`

Add one arm after the `turnState` arm (83):

```ts
| { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string }
```

Carries only the four camelCase fields (`conversation_id` dropped at the emit) — no token, key, or raw
frame, preserving `events.ts`'s AC4-by-construction invariant. **No new import** (all `string`). Mirror the
doc-comment on the `assistantDelta` / `turnEnd` / `turnState` arms (74-83) — note it is consumed by the
**timeline** bridge (#202), not the session store, and that `name` / `inputSummary` are opaque daemon
display text.

### 5. Session bridge (no-op) — `src/renderer/src/store/daemonEventBridge.ts`

Add `case 'toolUse'` to the existing `assistantDelta` / `turnEnd` / `turnState` no-op group
(`daemonEventBridge.ts:58-63`), so it falls through to `return null`. Required purely because the
`assertNever` default (line 69) makes a new `DaemonEvent` arm a compile error until every subscriber decides
its mapping — the session store does not consume `toolUse` (the timeline bridge does).

### 6. Timeline bridge (the real mapping) — `src/renderer/src/store/timelineBridge.ts`

Add `case 'toolUse': return { type: 'toolUse', turnId: event.turnId, toolUseId: event.toolUseId, name:
event.name, inputSummary: event.inputSummary }` to `translateTimelineEvent`'s **owned** block (mirror
`assistantDelta` at 37-38 — a fresh literal with named fields, not a spread, not `return event`). This is
the arm that produces the `toolUse` `ThreadEvent` (`threadTimeline.ts:46`) which `reduceTimeline` folds into
a `toolCall` item. The `DaemonEvent` `toolUse` and the `ThreadEvent` `toolUse` are field-for-field
identical, so this is a filter-and-fresh-copy (arm selection), not a field remap. Do **not** add `toolUse`
to the null fall-through list — it is an **owned** arm.

### Data flow

```
relay socket (untrusted)
  → Noise decrypt → plaintext bytes
  → parseInboundMessage()             [transport boundary: fail-closed decode + content-free log]
      envelope.type 'tool_use' → parseToolUsePayload (5× requireString) → { kind:'tool-use', toolUse }
  → daemonConnection switch(inbound.kind)   [consumer: drop conversation_id]
      → emitDaemonEvent { type:'toolUse', turnId, toolUseId, name, inputSummary }
  → IPC (DAEMON_EVENT_CHANNEL) → renderer
      → daemonEventBridge.translateDaemonEvent  → null   (session store: nothing)
      → timelineBridge.translateTimelineEvent   → { type:'toolUse', turnId, toolUseId, name, inputSummary }
          → timelineStore.dispatch → reduceTimeline toolUse arm
             → appends { kind:'toolCall', …, result: null } in arrival order (splits turn text)
```

## State + concurrency model

No new state, no new store, no new async task, no new IPC channel. Decode is a pure synchronous function;
the event rides the existing one-way `DAEMON_EVENT_CHANNEL` via `emitDaemonEvent` on the existing driver
read loop — no correlation map, no pending request, no teardown to add. (Correlating the later `tool_result`
to this `toolCall` by `toolUseId` is #206; this slice appends the pending call with `result: null` and
stops.) The two renderer bridges are two independent subscribers on the same channel (already the case for
`assistantDelta` / `turnEnd` / `turnState`): the session bridge no-ops `toolUse`, the timeline bridge owns
it. Arrival-order append and the text→tool→text split are `reduceTimeline`'s existing properties
(`threadTimeline.ts:117-131`), not new work here. Cancellation, socket lifecycle, and reconnect are
unchanged and owned upstream (`relaySupervisor` / `noiseRelayDriver`).

## Error handling

- **Any missing / non-string field** (`conversation_id`, `turn_id`, `tool_use_id`, `name`, or
  `input_summary`) → `parseToolUsePayload` throws `WireDecodeError` via `requireString` (never a partial
  value). `daemonConnection`'s existing `try/catch` around `parseInboundMessage` drops the frame — no event,
  no throw, no log (the caught error is dropped so it can't echo plaintext). No new catch needed.
- **Payload not an object** (`'nope'`, `['a']`, `null`) → the `isRecord` guard throws `'malformed tool_use
  payload'` before any field read.
- **Oversized frame** → the existing `MAX_PLAINTEXT_BYTES` guard throws before decode.
- **Well-formed but unmodeled** (e.g. `tool_result` before #206) → still falls to `default →
  inbound-unmodeled → null`, harmless drop. Only `tool_use` graduates here.
- **Category-only error messages** — `requireString` names the field only, never interpolating the value
  (a `name` / `input_summary` value could echo tool content); consistent with the decoder's uniform
  no-echo discipline.
- **Content-free diagnostics** — the new log call carries only `code` + `bytes` + `hash`, never a decoded
  field. The throw path stays unlogged (narrow before log).

## Testing strategy

Bullet scenarios; the developer writes the vitest code in the project idiom, mirroring the `turn_state`
cases. `npm test` + `npm run build` must stay green.

**`inboundMessage.test.ts`** (mirror the `turn_end` / `turn_state` cases):
- Well-formed `tool_use{conversation_id, turn_id, tool_use_id, name, input_summary}` →
  `{ kind: 'tool-use', toolUse: {…} }`; all five fields verbatim.
- Fail-closed — **throws `WireDecodeError`, no partial value** — for each of the five fields absent, and for
  a non-string field (number, object, `null`); and for the payload not an object (`'nope'`, `['a']`).
- Extra server-added key is tolerated (decodes fine) but not copied onto the result.
- Content-free logging: with an injected `DiagnosticLog`, a decoded `tool_use` logs `code:'tool_use'`,
  `bytes`, `hash`, and the record contains **none** of `name` / `input_summary` / `tool_use_id` / `turn_id`
  / `conversation_id`. A malformed frame throws and logs **nothing**.

**`daemonConnection.test.ts`** (the safety net for the un-`assertNever`'d inner switch — a missing consumer
case silently drops):
- A `tool_use` frame delivered through the driver emits exactly one `{ type:'toolUse', turnId, toolUseId,
  name, inputSummary }`; `conversation_id` is **absent** from the emitted event.
- No regression: coarse `message` / `message_chunk` still emit `messageReceived` / `messagesReceived`.

**`daemonEventBridge.test.ts`**: `translateDaemonEvent` returns `null` for the `toolUse` arm (mirror the
`turnState` case). This plus the `assertNever` guard is the compile-time + runtime proof the session bridge
handles the arm.

**`timelineBridge.test.ts`** (the end-to-end AC5 proof on the renderer side):
- `translateTimelineEvent({ type:'toolUse', … })` → `{ type:'toolUse', … }`, a **fresh** object with the
  four fields; and `toolUse` is **not** in the "returns null for every other arm" list.
- Through `subscribeTimeline` into an **isolated** `createTimelineStore()`: emitting a `toolUse`
  `DaemonEvent` appends exactly one `toolCall` item (`result: null`) with the four fields, visible via
  `selectItems`, in arrival order.
- **The reducer's split (AC5):** an `assistantDelta` (same turn) → then a `toolUse` → then another
  `assistantDelta` yields `selectItems` = `[assistantText, toolCall, assistantText]` (the existing
  `appendDelta` tail-check, `threadTimeline.ts:74-79`). This asserts the wired chain reproduces #121's
  documented split, end-to-end from a `DaemonEvent`.

**`types.test.ts`**: the new `ToolUsePayload` interface and `'tool_use'` `EnvelopeType` member compile
(type-level membership, mirror `types.test.ts:1-40`).

Type coverage: `npm run typecheck` — the two `assertNever` guards (`daemonEventBridge`, `timelineBridge`)
are the exhaustiveness proof that both subscribers handle the new arm.

## Scope self-check (6 production files — read this before flagging oversize)

This spec prescribes changes to **exactly 6 production `.ts` files, 0 new files** (verified below by reading
every `DaemonEvent` / `InboundDaemonMessage` consumer; no hidden cascade):

1. `src/shared/wire/types.ts` — `ToolUsePayload` + 1 `EnvelopeType` member
2. `src/main/transport/inboundMessage.ts` — 1 parse fn (5× `requireString`) + 1 kind + 1 switch case + 1 import
3. `src/main/daemonConnection.ts` — 1 consumer case
4. `src/shared/ipc/events.ts` — 1 `DaemonEvent` arm (no new import)
5. `src/renderer/src/store/daemonEventBridge.ts` — 1 `assertNever` case (join the no-op group → null)
6. `src/renderer/src/store/timelineBridge.ts` — 1 `assertNever` case (the real mapping)

This crosses the pre-commit ≥5-file self-check boundary, so the keep-as-S decision is **documented, not
assumed** — and it is an honest count (6), not an undercount rationalization (the failure mode that gate
targets: pyrycode #311 *claimed* 4 files, *actual* 13 / 300+ LOC):

- **6 is the architectural floor for this slice, verified.** Adding an inbound `DaemonEvent` that drives the
  timeline needs: wire type → decode → connection emit → event union → **both** renderer bridges (each is
  `assertNever`-guarded, so each is a compile error until it has a case). Grep confirmed the boundary: the
  **only** two exhaustive `DaemonEvent` switches are `daemonEventBridge` and `timelineBridge`; every other
  `DaemonEvent` reference (`logDataDownload`, `runConfigSnapshot`, `conversationListBridge`,
  `receiveCommand`, `emitDaemonEvent`, `preload/index.ts`) is a **non-exhaustive filter** that ignores
  unknown arms — no case needed. `preload` forwards `DAEMON_EVENT_CHANNEL` generically (no per-type change).
  `InboundDaemonMessage` is consumed only by `daemonConnection`. There is no 7th file.
- **Every file is a load-bearing, tiny, cloned edit** — 1–7 lines each, cloning a pattern that already
  lives in the same file (`turn_state` / `assistant_delta` is the template for all six). The accurate
  turn-budget proxies pass comfortably: **0 new files, ~45 production + ~120 test ≈ ~165 total LOC** (well
  under 600), **1 new exported type** (`ToolUsePayload` — the kind / arm are union members, not exports),
  **0 consumer call-site cascade** (the two bridge cases and the two switch cases are compile-forced single
  arms, no existing call site changes), **1 reject path** (required-string presence; simpler than #214's
  enum check), **6 ACs** all facets of one change.
- **Four direct clean precedents shipped this exact chain as S**, code-review PASS, no salvage: #214
  (**6** prod files, the identical shape), #199 (5), #180 (8), #139 (8) — the same wire → decode → emit →
  event → bridge slice. #217 is strictly `≤` #214 in complexity (one fewer exported type, no enum branch,
  same file set) and shipped known-good at ~15–25 turns.
- **Splitting is strictly worse and would ship dead code.** The only seam is wire+decode (files 1–2) vs.
  emit+event+bridges (files 3–6). Slice A would decode `tool_use` into an `InboundDaemonMessage` kind that
  `daemonConnection`'s un-`assertNever`'d inner switch **silently drops** — a decode with no consumer,
  observably nothing, a code smell a reviewer flags. It does not stand alone. The `tool_use` vertical is
  **already** split at the PO level (#205 → transport #217 + render #218); this is the minimal transport
  atom. Further splitting inverts the win.

Conclusion: genuine, verified, precedented S. Not an undercount — proceed.

## Open questions

- **Inner-switch exhaustiveness (deferred, not adopted).** `daemonConnection.ts`'s `switch (inbound.kind)`
  still has no `default: assertNever(inbound)`, so a missing consumer case silently drops rather than
  failing to compile. The `daemonConnection.test.ts` emit test is the deterministic safety net (same as
  #199 / #214). **Do not** expand scope to guard the switch here.
- **Untrusted `name` / `input_summary` reach the render slice as free text (forward to #218).** Unlike
  #214's `state` (a 3-value enum), these two fields are arbitrary daemon-supplied strings and DO cross to
  the render slice — the same posture as `assistant_delta.text` (#199 → rendered as text-not-HTML by #203).
  #218 must render them as **plain text**, never as HTML / `dangerouslySetInnerHTML`, and treat
  `input_summary` as an opaque précis (no re-parsing / re-summarizing). This slice carries them verbatim and
  never interprets them; flagged here so #218 inherits the constraint.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST-FIX. The untrusted→trusted boundary (relay socket → decrypted plaintext →
  `parseInboundMessage`) gains one explicit, single-function fail-closed decoder (`parseToolUsePayload`),
  throwing `WireDecodeError` on any structural/type mismatch, never a partial value — the same named
  boundary that already owns `message` / `assistant_delta` / `turn_state`. The defence here is **required-
  string presence**: all five fields must be present strings (`requireString` covers missing, `undefined`,
  number, object, `null`, and a non-object payload alike), so a hostile daemon cannot smuggle a
  non-string, an object, or a `'__proto__'`-shaped structure onto a `toolCall`. Positive control against
  IPC-side unknown-key / prototype leakage: the consumer emits a **fresh object literal** with four named
  fields (`{ type:'toolUse', turnId, toolUseId, name, inputSummary }`), never a spread of the decoded
  payload, so only the narrowed values cross IPC; the timeline bridge likewise reconstructs a fresh literal.
- **[Trust boundaries — forward to the render slice #218]** SHOULD FIX (design-directed, forwarded, not a
  gate on this slice). `name` and `input_summary` are **untrusted daemon-supplied strings carried as opaque
  display text** — decoded, never interpreted here, but they DO reach the render slice (#218) as free text
  (unlike #214's enum `state`, which had no untrusted-text-at-DOM concern). This is the same posture as
  `assistant_delta.text` (#199 → #203 renders as text, not HTML). Documented in Open Questions and in the
  wire doc-comment (Design § 1): **#218 must render both as plain text**, never `dangerouslySetInnerHTML`,
  and must not re-parse `input_summary`. No DOM sink exists in *this* slice (transport + IPC only), so there
  is nothing to exploit here; the constraint is forwarded so it is not lost.
- **[Tokens / secrets]** N/A by design. No token / key / credential is added, decoded, or carried. The one
  arm carries four opaque display strings; `conversation_id` is decoded at the boundary and **dropped** at
  the emit (single active conversation). No field on the arm can hold a key / token / raw frame (AC4/AC5),
  matching `events.ts`'s existing invariant.
- **[File / storage]** N/A — no filesystem or storage operation. `tool_use_id` / `name` / `input_summary`
  are never resolved into a path or opened; they are display text only (the `cwd` #139 discipline).
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, IPC channel,
  `ipcMain` handler, custom protocol, or preload method — the arm rides the existing one-way
  `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`) that `preload/index.ts` already forwards generically (verified:
  no per-type preload change). Process placement preserved: decode lives in
  `src/main/transport/inboundMessage.ts` (main-only, imports `Buffer`, never re-exported to a renderer
  barrel); no key, socket, or raw frame moves toward the renderer. The four opaque strings flowing
  main→renderer grant the renderer no new reach toward transport / keys.
- **[Cryptographic primitives]** N/A — no RNG, key, nonce, or handshake code. `hashPlaintext` (BLAKE2s via
  `@noble/hashes`, note #101) is reused verbatim for content-free logging; no new or hand-rolled crypto.
- **[Network & I/O]** No finding. The existing `MAX_PLAINTEXT_BYTES` (65519) guard at the top of
  `parseInboundMessage` fails an oversized `tool_use` frame closed before decode — no new size cap needed,
  and it bounds `input_summary` (a potentially long précis) at the frame level. The payload is five flat
  string scalars (no array, no nesting), so there is no decode amplification; each field is a single
  `typeof` check in O(1) with **no regex** (no ReDoS). No new socket / timeout / reconnect surface.
- **[Error messages, logs, telemetry]** No finding — the category the ticket is security-sensitive *for*,
  addressed head-on. The one new diagnostic call is **content-free** (`code:'tool_use'` + `bytes` +
  one-way `hash` only), emitted **after** the frame fully narrows so the throw path leaves no record;
  `requireString`'s error message names the failure **category only** (`missing required field: <field>` —
  never interpolating `name` / `input_summary` / `tool_use_id` or the conversation-correlating
  `conversation_id`); the `WireDecodeError` caught in `daemonConnection` is dropped, never logged or
  forwarded.
- **[Concurrency]** No finding — no new async task, timer, listener, or socket; decode is synchronous; the
  event rides the existing driver read loop. No shared-state check-then-act, nothing to cancel or leak. The
  two renderer bridges are pre-existing independent subscribers. The `toolCall` append is a pure reducer
  step (fresh array), no mutation across an await.
- **[Threat model alignment]** Addressed for the boundary this slice owns. *Malicious / compromised relay*
  (on-path, content-blind): a flood of malformed `tool_use` frames all throw and drop — no plaintext leak,
  no log record, no hang (synchronous, frame-bounded). *Hostile daemon response* (malformed / oversized
  inside the session): every field parsed defensively, fail-closed on required-string presence, frame size
  capped upstream — this slice's raison d'être. *Renderer compromise reaching transport*: unchanged — no
  new renderer capability; the only cross-boundary payload is four opaque strings, which the render slice
  (#218) must treat as text (forwarded above).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-10
