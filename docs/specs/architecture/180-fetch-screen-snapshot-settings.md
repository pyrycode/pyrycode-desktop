# Spec — Fetch the session's Model / Effort / YOLO via `screen_snapshot` (#180)

Split A of #156. Delivers the **transport data path only**: an on-demand
`request_snapshot` → `screen_snapshot` round-trip in the Electron background
process, a field-for-field decode of the reply, and one typed daemon event
carrying `model` / `effort` / `yolo` to the window. No UI, no store facet — the
render sits in #181 (blocked on this).

## Files to read first

- `src/main/transport/sendMessageEnvelope.ts` — the **payload-carrying** outbound
  builder to mirror. `buildRequestSnapshot` is this file with a different
  `EnvelopeType` and payload. (NOT `requestDebugBundleEnvelope.ts`, which is a
  bare control frame — the wrong precedent; see Technical Notes in the ticket.)
- `src/main/transport/requestDebugBundleEnvelope.ts` — read only to confirm you
  are NOT copying it: `payload: {}` is for bare frames; `request_snapshot` has a
  real payload.
- `src/main/transport/inboundMessage.ts:52-249` — the inbound decode seam.
  `parseInboundMessage`'s `switch (envelope.type)`, the `InboundDaemonMessage`
  union, `parseMessagePayload` (the payload-narrowing pattern to mirror),
  `requireString` / `requireNumber` (add a `requireBoolean` sibling for `yolo`),
  and the content-free `diagnosticLog?.event(...)` shape.
- `src/main/daemonConnection.ts:81-109` — the `DaemonConnection` interface
  (`send` / `requestDebugBundle`); `:191-262` — `onDriverEvent`'s `case 'message'`
  and its inner `switch (inbound.kind)` (where the new `snapshot` kind is
  consumed → emit); `:364-379` — `send`'s body (the exact shape `requestSnapshot`
  mirrors: `driver === null` no-op, shared `nextEnvelopeId`, catch-and-drop).
- `src/shared/ipc/commands.ts` — `RendererCommand` union, `isRendererCommand`
  guard, `isSendMessagePayload` (the guard helper to mirror for the new payload).
- `src/shared/ipc/events.ts` — `DaemonEvent` union (add `snapshotReceived`).
- `src/shared/wire/types.ts:40-105` — `EnvelopeType`, `Envelope`,
  `SendMessagePayload` (the ported-payload shape to mirror), `MAX_PLAINTEXT_BYTES`.
- `src/main/index.ts:226-244` — the single `onCommand` switch (add
  `case 'requestSnapshot'` → `connection.requestSnapshot(command.payload)`).
- `src/main/receiveCommand.ts` and `src/main/emitDaemonEvent.ts` — read to CONFIRM
  they are **generic pass-throughs that need no change** (they carry the sealed
  unions verbatim), and that no preload / renderer edit is required.
- `src/main/daemonConnection.roundtrip.test.ts` and
  `src/main/transport/fakeDaemon.ts:88-99,300-312` — the `buildReply` seam and the
  assembled round-trip harness the AC5 E2E test extends.
- `src/main/transport/bundleReassembler.ts` — read only to confirm the snapshot
  path deliberately does **not** use a reassembler/consumer (single reply, no
  state machine); `send`, not `requestDebugBundle`, is the twin.

Daemon wire contract (source of truth, do not drift — CLAUDE.md): the daemon's
`internal/protocol/snapshot.go` `ScreenSnapshotPayload` is
`{conversation_id, text, ts, model, effort, yolo}` — `model`/`effort` strings,
`yolo` bool, **all always present (no `omitempty`)**, `ts` an RFC3339 string.
Empty `model`/`effort` = inherited daemon default; `yolo: false` = permissions
enforced. (pyrycode #847, closed on `main`.)

## Context

The Run configuration sheet (#177 shell, merged) must display how the session is
running: its model, reasoning effort, and YOLO/permissions posture. The daemon
surfaces these in its **always-available** `screen_snapshot` reply — ADR-025's
parser-independent escape hatch, **not** gated on the `interactive` capability —
so this desktop client can fetch them today even though it withholds
`interactive`. A client sends the `request_snapshot` v2 control envelope carrying
a `conversation_id`; the daemon answers `screen_snapshot`.

This ticket is the wire/transport half. The render half (#181) owns which
conversation, the trigger policy (sheet-open vs on-connect), and the store facet.

## Design source

N/A — transport data path, no UI surface. The visual design lands in #181.

## Scope & size (auditable)

Sized **S**. Honest touch count: **7 production files** — 1 new
(`requestSnapshotEnvelope.ts`) + 6 modified (`types.ts`, `commands.ts`,
`events.ts`, `inboundMessage.ts`, `daemonConnection.ts`, `index.ts`). That is
above the ≥5-file self-check line, so here is why it is not split:

- **No clean seam exists.** The new inbound member is a discriminated-union
  *triple* — its declaration (`types.ts` / `InboundDaemonMessage`), its producer
  (`inboundMessage.ts`), and its **exhaustive** consumer
  (`daemonConnection.ts`'s `switch (inbound.kind)`) must change together or the
  `switch` stops type-checking. Likewise the command member pairs `commands.ts`
  with its exhaustive `index.ts` consumer. TypeScript exhaustiveness makes these
  atomic; they cannot be delivered in separate tickets.
- **Every candidate split is worse.** A request-vs-reply split double-touches
  `daemonConnection.ts` (the single event choke point) and `types.ts` → a
  guaranteed merge conflict (the §1.5 failure mode). A contract-vs-behaviour
  split peels ~40 LOC of boilerplate (enum strings, union arms, one guard) into
  an XS while leaving 100% of the turn risk — the AC5 E2E round-trip test, which
  spans the full loop — in the remaining child.
- **The numbers are small.** ~250–300 LOC total written (≈110 production, the
  rest tests); 2 new exported types; **zero** call-site cascade (purely
  additive, no existing signature changes); the four "extra" files are 1–4 line
  union/enum additions. Precedent: #116 (3-file inbound slice) and #168 (3-file
  command-surface slice) shipped this exact per-file shape clean at S.

If an operator disagrees, the split to prefer is contract (`types` + `commands` +
`events`, XS) → behaviour (builder + `inboundMessage` + `daemonConnection` +
`index` + E2E, S, blocked-by the contract).

## Design

Five thin additions along the existing `send_message` spine (command member +
guard → outbound builder → connection method → inbound decode → one event), plus
the two sealed-union one-liners.

### 1. Wire types — `src/shared/wire/types.ts` (additive)

Add two `EnvelopeType` members and two ported payload interfaces, field-for-field
with the daemon (decode is by field name, so wire order is irrelevant to the
desktop; the interfaces mirror the daemon for no-drift review):

```ts
export type EnvelopeType =
  | /* …existing… */
  | 'request_snapshot'
  | 'screen_snapshot'

export interface RequestSnapshotPayload {
  conversation_id: string
}

export interface ScreenSnapshotPayload {
  conversation_id: string
  text: string       // rendered screen — decoded, NEVER surfaced past transport
  ts: string         // RFC3339
  model: string      // '' = inherited daemon default (never treated as absent)
  effort: string     // '' = inherited daemon default
  yolo: boolean       // false = permissions enforced
}
```

### 2. Outbound builder — `src/main/transport/requestSnapshotEnvelope.ts` (new)

Mirror `sendMessageEnvelope.ts` exactly — a payload-carrying builder, not a bare
frame.

- Input: `{ id: number; ts: string; payload: RequestSnapshotPayload }` (same
  shape as `SendMessageInput`; explicit `id`/`ts`, no clock/counter read).
- `buildRequestSnapshot(input): Uint8Array` — wraps
  `{ id, type: 'request_snapshot', ts, payload }` and returns
  `encodeEnvelope(envelope)`. MAY throw `WireEncodeError` (the sole caller
  catches). Main-process only; imports `codec.ts`. Never re-export through a
  renderer barrel.
- Invariant test: builds a `request_snapshot` envelope whose decoded payload
  round-trips the supplied `conversation_id` (mirror
  `sendMessageEnvelope.test.ts`).

### 3. Inbound decode — `src/main/transport/inboundMessage.ts` (additive)

- Extend `InboundDaemonMessage` with `| { kind: 'snapshot'; snapshot: ScreenSnapshotPayload }`.
- Add `parseScreenSnapshotPayload(payload: unknown): ScreenSnapshotPayload` —
  fail-closed like `parseMessagePayload`: `isRecord` guard, then
  `requireString` for `conversation_id` / `text` / `ts` / `model` / `effort`,
  and a new `requireBoolean(payload, 'yolo')` sibling of `requireNumber`. Any
  missing/mistyped field throws `WireDecodeError` — never a partial value (AC2,
  AC3: all three settings fields required-present; `''` and `false` are valid
  values, not absences). Returns only the six known fields; unknown server keys
  tolerated but not copied (forward-compat, matching `parseMessagePayload`).
- Add `case 'screen_snapshot'` to `parseInboundMessage`'s `switch`: narrow, then
  the content-free `diagnosticLog?.event({ event: 'inbound-decoded', code:
  'screen_snapshot', bytes: plaintext.length, hash: hashPlaintext(plaintext) })`
  (reuses existing diagnostic fields — **no new `DiagnosticEvent` field**, so the
  #131 renderer-pin is untouched). Narrow-then-log so the throw path stays
  unlogged. Return `{ kind: 'snapshot', snapshot }`.
- The `MAX_PLAINTEXT_BYTES` size guard at the top already covers an oversized
  snapshot — no change needed.

### 4. Connection method — `src/main/daemonConnection.ts` (additive)

- Extend the `DaemonConnection` interface with
  `requestSnapshot(payload: RequestSnapshotPayload): void` and document it as the
  `send` twin: encrypts a `request_snapshot` onto the live session; **inert
  no-op when not connected** (`driver === null` → return) — *not*
  `requestDebugBundle`'s `consumer.fail`, because a snapshot has no consumer
  (AC1). Never throws out of the module.
- Body mirrors `send` (`:364-379`): `if (driver === null) return`; then
  `try { const bytes = buildRequestSnapshot({ id: nextEnvelopeId, ts: now(),
  payload }); nextEnvelopeId += 1; driver.sendMessage(bytes) } catch { /* drop */ }`.
  Shares the one `nextEnvelopeId` counter (no second counter; the daemon
  correlates by `id`).
- Add `case 'snapshot'` to `onDriverEvent`'s inner `switch (inbound.kind)`
  (`:226-242`): `emitDaemonEvent(sink, { type: 'snapshotReceived', model:
  inbound.snapshot.model, effort: inbound.snapshot.effort, yolo:
  inbound.snapshot.yolo })`. **This line is the content-minimisation seam** —
  `text` / `ts` / `conversation_id` are decoded but dropped here; only the three
  settings fields cross to the renderer (see Security review).
- Add `import { buildRequestSnapshot } from './transport/requestSnapshotEnvelope'`
  and expose `requestSnapshot` in the returned object.

### 5. Command surface — `src/shared/ipc/commands.ts` (additive)

- `RendererCommand` gains `| { type: 'requestSnapshot'; payload: RequestSnapshotPayload }`
  (mirrors `sendMessage`; reuses the wire type verbatim, so no field is remapped
  and no field can hold a secret — `conversation_id` is not a secret).
- `isRendererCommand` gains `case 'requestSnapshot': return 'payload' in value &&
  isRequestSnapshotPayload(value.payload)`.
- Add `isRequestSnapshotPayload(value): value is RequestSnapshotPayload`
  mirroring `isSendMessagePayload` — one `conversation_id` string check. This is
  the untrusted renderer→main boundary guard, the reason the ticket is
  `security-sensitive`.
- Import `RequestSnapshotPayload` from `../wire/types`.

### 6. Event surface — `src/shared/ipc/events.ts` (additive)

- `DaemonEvent` gains `| { type: 'snapshotReceived'; model: string; effort:
  string; yolo: boolean }`. A **dedicated minimal shape**, deliberately *not*
  reusing `ScreenSnapshotPayload` (which carries `text` — see Security review).
  Maps to no `SessionAction`; the render bridge (#181) consumes it.

### 7. Composition wiring — `src/main/index.ts` (additive)

- One `onCommand` case (`:234-243`): `case 'requestSnapshot':
  connection.requestSnapshot(command.payload); return`. No facade wrapper (unlike
  `requestDebugBundle`, which routes through the download orchestrator) — the
  connection method is called directly, mirroring `case 'sendMessage'`.
- `receiveCommand.ts`, `emitDaemonEvent.ts`, `preload`, and the renderer need
  **zero** change — the command and event ride the existing generic channels.

### Data flow

```
window → sendCommand({type:'requestSnapshot', payload:{conversation_id}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand guard)
      → connection.requestSnapshot(payload)
      → buildRequestSnapshot → driver.sendMessage  [inert no-op if not connected]

daemon → screen_snapshot frame → onDriverEvent 'message' → parseInboundMessage
      → {kind:'snapshot', snapshot} → emitDaemonEvent
        {type:'snapshotReceived', model, effort, yolo}   [text dropped here]
      → DAEMON_EVENT_CHANNEL → window (#181)
```

## State + concurrency model

- **No new state.** No reassembler slot, no consumer, no pending-request map —
  a snapshot is one fire-and-forget request and one independent reply. The reply
  is recognised purely by `envelope.type`, exactly like `message`.
- **Envelope id.** `requestSnapshot` shares the single module-local
  `nextEnvelopeId` with `send` / `requestDebugBundle`. `send` has no `await`, so
  the increment is race-free (single-writer, synchronous).
- **Correlation deliberately absent.** The daemon sets `in_reply_to` on the
  reply, but the desktop transport has no correlation map yet, so the decode is
  unconditional: any `screen_snapshot` that arrives is decoded and emitted. With
  a single in-flight fetch and a single conversation (desktop milestone), this is
  correct. Correlation is a future concern (see Out of scope).
- **Teardown.** Nothing to cancel — no timer, no consumer to strand. A snapshot
  request sent just before the socket drops simply produces no reply; the render
  ticket owns any "no response" UX.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed `requestSnapshot` (no/bad `payload`) | `isRendererCommand` | dropped at boundary, logged as the existing fixed string, never reaches transport |
| Not connected when `requestSnapshot` called | `daemonConnection` | inert no-op (`driver === null` → return); no throw, no event |
| Over-cap / driver throw on send | `daemonConnection` try/catch | caught object dropped (could echo plaintext); never thrown out of module |
| Malformed / oversized / mistyped `screen_snapshot` | `parseScreenSnapshotPayload` | throws `WireDecodeError`; `onDriverEvent`'s `case 'message'` catch drops it (fail-closed, AC4); no event |
| Missing settings field (`model`/`effort`/`yolo`) | `parseScreenSnapshotPayload` | throws — treated as malformed, never a partial value (AC3) |
| Daemon answers with `error` instead of `screen_snapshot` | `inboundMessage` `case 'error'` → `daemon-error` → `reassembler?.fail` | no reassembler in flight → no-op; no event, no hang (Out of scope) |

All decode error messages name the failure **category** only — no `text`,
`conversation_id`, `model`, or raw bytes interpolated (mirrors
`parseMessagePayload`).

## Testing strategy

`npm test` (vitest), `npm run typecheck`, `npm run build` (salvage gate).

- **`requestSnapshotEnvelope.test.ts`** (new) — mirror `sendMessageEnvelope.test.ts`:
  a built envelope decodes to `type: 'request_snapshot'` with the supplied
  `conversation_id`; the `id`/`ts` are passed through verbatim.
- **`inboundMessage.test.ts`** (extend) — decode scenarios:
  - a full `screen_snapshot` → `{kind:'snapshot', snapshot}` with all six fields;
  - empty `model`/`effort` and `yolo:false` decode as those values (present, not
    dropped — AC3), not as absent;
  - missing any of `conversation_id`/`text`/`ts`/`model`/`effort`/`yolo` throws
    `WireDecodeError`;
  - `yolo` non-boolean (string/number) throws;
  - oversized plaintext (> `MAX_PLAINTEXT_BYTES`) throws;
  - unknown extra server keys are tolerated.
- **`commands.test.ts`** (extend) — `isRendererCommand` accepts a well-formed
  `requestSnapshot` (payload with string `conversation_id`), and rejects: missing
  `payload`, non-string `conversation_id`, unknown `type`.
- **AC5 — E2E round-trip** (`daemonConnection.roundtrip.test.ts` extend, or a
  focused `fakeDaemon` `buildReply` test): drive the assembled
  `createDaemonConnection` through the real handshake; call
  `connection.requestSnapshot({conversation_id})`; the `fakeDaemon`'s `buildReply`
  inspects the inbound plaintext (assert `type === 'request_snapshot'` and
  `payload.conversation_id` matches), then returns a crafted `screen_snapshot`
  envelope; assert the captured `sink` receives exactly one `snapshotReceived`
  with the expected `model`/`effort`/`yolo` — and that `text` never appears on any
  emitted event. Include the empty-`model`/`effort` and `yolo:false` default
  cases. Assert on event **type/fields**, never serialized frames.

## Out of scope

- **Daemon `error` reply → "snapshot unavailable" event.** Correlating an
  `error` (`conversation.not_found` / `server.binary_offline`) back to the
  snapshot request needs `in_reply_to` correlation the transport lacks. Today a
  bundle-less `error` is dropped (no regression). A follow-up adds correlation +
  an unavailable event *if that failure is observed* (evidence-based).
- **Which `conversation_id`, and the trigger policy** (sheet-open vs on-connect)
  — #181.
- **Store facet + render** — #181.
- **Context-window usage** — #182 (blocked on pyrycode #855); no daemon message
  exists yet.
- **The `text` field's use** — decoded and validated, but not surfaced anywhere;
  a future live-screen feature would add its own event.

## Open questions

- **Command payload shape: nested vs flat.** Spec uses nested `payload:
  RequestSnapshotPayload` to mirror `sendMessage` and reuse the wire type
  verbatim. A flat `{type:'requestSnapshot', conversation_id}` would also work; the
  nested form keeps the guard uniform with `isSendMessagePayload`. Developer may
  keep flat if the guard reads cleaner, provided the wire type is still reused.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — two explicit, single-function
  untrusted→trusted boundaries. (a) Renderer→main: `isRendererCommand` +
  `isRequestSnapshotPayload` validate the `requestSnapshot` command before it
  reaches transport; downstream holds a typed `RequestSnapshotPayload`. (b)
  Daemon→parsed: `parseScreenSnapshotPayload` narrows the reply fail-closed at
  the existing `parseInboundMessage` seam; downstream holds a typed
  `ScreenSnapshotPayload`. Both mirror existing siblings (`isSendMessagePayload`,
  `parseMessagePayload`), so the boundary discipline is unchanged, not invented.
- **[Tokens / secrets]** No findings — the ticket introduces no token, key, or
  credential. The command reuses only wire types (`conversation_id` is a routing
  id, not a secret); no member has a field that could hold a token/key/frame, so
  AC5's by-construction guarantee holds. Nothing new is stored or logged.
- **[File / storage]** N/A — no filesystem or storage operation. The snapshot is
  request→reply→emit in memory; no path, no write, no cache.
- **[Electron attack surface]** No findings — **no new IPC channel and no new
  preload / `contextBridge` API**. The command rides the existing generic
  `COMMAND_CHANNEL` (validated by `isRendererCommand`), the event the existing
  `DAEMON_EVENT_CHANNEL`. The renderer gains no new capability — worst case a
  compromised renderer triggers a snapshot *request*, which is a benign read of
  non-secret session settings it could already see. **Load-bearing content
  minimisation:** the decoded `ScreenSnapshotPayload.text` (rendered screen —
  potentially sensitive terminal output) is dropped at the `daemonConnection`
  choke point; only `model`/`effort`/`yolo` cross to the renderer. The dedicated
  minimal `snapshotReceived` event shape (NOT a reuse of `ScreenSnapshotPayload`)
  makes this hard to get wrong; code-review must confirm `text` never reaches the
  event, since a naive "reuse the wire type like the other events" would leak it
  to the renderer (and its DevTools console). This is a SHOULD-FIX guardrail for
  code-review, not a defect in the spec (the spec designs the drop in).
- **[Cryptographic primitives]** N/A — rides the established Noise session; no
  new handshake, key, nonce, or comparison. The `request_snapshot` frame is
  sealed and the `screen_snapshot` frame decrypted by the existing
  `noiseSession` / driver, unchanged.
- **[Network & I/O]** No findings — the outbound frame is a small fixed-shape
  payload; the inbound reply is bounded by the existing `MAX_PLAINTEXT_BYTES`
  guard at the top of `parseInboundMessage`. No new socket, timeout, or reconnect
  path. `conversation_id` length is not separately capped at the guard (matching
  `isSendMessagePayload`), but the outbound `encodeEnvelope` cap bounds it and an
  over-cap send is caught and dropped — no amplification. A hostile daemon
  flooding `screen_snapshot` frames is the same inherited exposure as
  `message_chunk` flooding (all inside the authenticated session); not introduced
  here.
- **[Error messages, logs, telemetry]** No findings — `parseScreenSnapshotPayload`
  emits category-only error messages (no `text`/`conversation_id`/`model`/bytes
  interpolated), mirroring `parseMessagePayload`. The one diagnostic reuses the
  existing content-free `{event, code, bytes, hash}` fields (`hash` is BLAKE2s
  over opaque frame bytes) — **no new `DiagnosticEvent` field**, so the #131
  renderer main-process pin is untouched. `text` is never logged.
- **[Concurrency]** No findings — `requestSnapshot` shares the single
  synchronous `nextEnvelopeId` counter with `send` (no `await`, single-writer,
  no check-then-act race). No new long-lived task, timer, listener, or
  reassembler slot to leak or cancel; inert no-op when not connected; nothing to
  strand on teardown (fire-and-forget, no consumer).
- **[Threat model alignment]** No findings.
  - *Hostile / compromised relay:* content-blind and cannot forge an in-session
    frame (it lacks the Noise session keys), so it can only drop/delay/reorder
    the reply. A dropped reply produces no event and no hang (fire-and-forget, no
    consumer waiting). This is why the deliberate absence of `in_reply_to`
    correlation is safe: only the authenticated daemon can emit a
    `screen_snapshot`, and an unsolicited one merely reflects the daemon's real
    settings.
  - *Hostile daemon response:* malformed/oversized/mistyped `screen_snapshot`
    fails closed (`parseScreenSnapshotPayload` throws → dropped at
    `onDriverEvent`'s catch → no event); an oversized `text` is bounded by
    `MAX_PLAINTEXT_BYTES` and dropped before the renderer boundary regardless.
  - *Renderer compromise reaching transport:* process isolation is unchanged; the
    renderer never gains keys, token, or socket, and the new command only reads
    non-secret settings.
- **[OUT OF SCOPE]** Daemon `error` reply → "snapshot unavailable" event needs
  `in_reply_to` correlation the transport lacks; deferred to a future ticket
  (evidence-based, only if the failure is observed). An availability gap, not a
  security hole — a rejected request produces no event and no hang.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
