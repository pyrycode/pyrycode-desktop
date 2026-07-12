# #292 — Observe `queue_state`: decode the queued-backlog snapshot into a typed event

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/292
**Size:** S · **Label:** `security-sensitive`
**Split from #145** (5-way: **#292 decode** / #293 store / #294 render / #295 command / #296 drop). No blockers.

## Context

When the daemon is mid-turn, a message the desktop sends is buffered in the daemon's
per-conversation queue. The daemon emits an **unsolicited** `queue_state` snapshot carrying the
whole current backlog whenever it changes — not a reply to any request. Desktop does not decode it
today. This slice adds **only the inbound decode**: `queue_state` → a typed daemon event carrying
the ordered backlog, threaded through the transport → IPC boundary so a later slice (#293) can hold
it. **No app state, no UI.**

This is the canonical inbound-decode slice, structurally identical to #201 (modal), #214
(`turn_state`), #229 (`tool_result`), #241 (`conversation_created`), #273 (`conversation_updated`)
— all DONE as one `size:s` each. The developer's job is to clone that pattern for one more envelope
type. See **Scope note** for why the file count is what it is.

**Wire contract is fixed by daemon SSOT (pyrycode #720, `docs/protocol-mobile.md` § Queue).** Do not
drift it:

- `queue_state` (daemon → client) = `{ conversation_id, queued: [{ queued_msg_id, text, ts }] }`.
- `queued` is **always present** and **enqueue-ordered**; an empty backlog is `[]` (never omitted, never null).
- `queued_msg_id` is a plain per-conversation counter (an integer, ≥ 1) and **MUST decode as a number, never a string.**
- `text` is **untrusted, client-originated transit content** (carried as opaque display text — decoded, never interpreted).
- `ts` is the enqueue time (RFC3339), a plain string on the wire (not parsed by the decoder).

**Load-bearing decision (#720):** `queue_state` is daemon **state**, not part of claude's turn
stream. It gets its **own** daemon event and is **NOT** folded into the thread-timeline reducer
(`reduceTimeline` / `threadTimeline.ts`). Where the backlog is *held* is #293's decision, not this
slice's.

## Files to read first

| Path | Lines | What to extract |
|------|-------|-----------------|
| `src/shared/wire/types.ts` | 40–71 | `EnvelopeType` union — add `'queue_state'` member |
| `src/shared/wire/types.ts` | 247–322 | `TurnStatePayload` / `ToolResultPayload` — the payload-interface + doc-comment shape to mirror (SSOT ref, wire order, always-present, untrusted-`text` note) |
| `src/main/transport/inboundMessage.ts` | 120–160 | `InboundDaemonMessage` union — add `{ kind: 'queue-state'; queueState: QueueStatePayload }` |
| `src/main/transport/inboundMessage.ts` | 162–211 | `isRecord` / `requireString` / `requireNumber` helpers — `requireNumber` (typeof `number`) is what rejects a JSON-string `queued_msg_id` |
| `src/main/transport/inboundMessage.ts` | 454–482 | **`parseConversationSummary` + `parseConversationsPayload`** — the closest template: a row parser + `payload.<arr>` `Array.isArray` guard + `raw.map(parseRow)` |
| `src/main/transport/inboundMessage.ts` | 344–354 | `parseTurnStatePayload` — the flat single-object parse shape |
| `src/main/transport/inboundMessage.ts` | 707–793 | `turn_state` / `tool_result` / `conversations` decode arms — **narrow-before-log** discipline + return shape |
| `src/main/transport/inboundMessage.ts` | 607–618, 868–879 | `parseInboundMessage` entry + `default` arm — unknown type → `null` (ignored, AC5); oversized frame pre-capped |
| `src/shared/ipc/events.ts` | 14–26, 62–193 | `DaemonEvent` union + import block — add `queueState` arm; `conversationsReceived` (line 149) and `toolResult` (143) are the precedents |
| `src/main/emitDaemonEvent.ts` | whole | The single emit path (pure forwarder, no transform) |
| `src/main/daemonConnection.ts` | 324–345, 483–508 | `parseInboundMessage` try/catch (drops frame on `WireDecodeError`, AC4) + the `tool-result` / `conversations` emit cases to clone; switch is **not** `assertNever`-guarded, so the new case must be added manually |
| `src/renderer/src/store/daemonEventBridge.ts` | 27–101 | Exhaustive `assertNever` switch — add `case 'queueState': return null` |
| `src/renderer/src/store/timelineBridge.ts` | 36–113 | Exhaustive `assertNever` switch — add `'queueState'` to the **null fall-through group** (NOT a timeline item, #720) |
| `src/renderer/src/store/modalBridge.ts` | 41–90 | Exhaustive `assertNever` switch — add `'queueState'` to the null fall-through group |
| `src/main/diagnosticLog.ts` | 43 | `code?: string` is an **open** string — pass `code: 'queue_state'`, no enum to widen |

Test files to extend (mirror the `#229 tool_result` additions): `src/shared/wire/types.test.ts`,
`src/main/transport/inboundMessage.test.ts`, `src/main/daemonConnection.test.ts`,
`src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge}.test.ts`.

## Design

Data flow (all synchronous, post-decryption):

```
relay socket → Noise decrypt (upstream) → parseInboundMessage(plaintext)
  → parseQueueStatePayload  [untrusted→trusted boundary; fail-closed WireDecodeError]
  → InboundDaemonMessage { kind: 'queue-state', queueState }
  → daemonConnection maps → emitDaemonEvent({ type: 'queueState', conversationId, queued })
  → DAEMON_EVENT_CHANNEL (existing IPC channel)
  → 3 exhaustive renderer bridges each no-op it (real consumer = #293 store)
```

### 1. Wire types — `src/shared/wire/types.ts`

Add `'queue_state'` to the `EnvelopeType` union. Add **two** exported interfaces (per the ticket's
"two payload types" note), doc-commented in the `TurnStatePayload` house style (SSOT #720 ref, wire
order, all-fields-always-present, the untrusted-`text` warning):

```ts
export interface QueuedItem {
  queued_msg_id: number   // plain per-conversation counter (integer ≥ 1); decodes as NUMBER, never string
  text: string            // UNTRUSTED client-originated transit content; opaque display text
  ts: string              // enqueue time (RFC3339); plain wire string, not parsed
}

export interface QueueStatePayload {
  conversation_id: string
  queued: QueuedItem[]     // always present, enqueue-ordered; [] when empty
}
```

These are the **only two new exported symbols** in the slice. Field names stay snake_case (they
mirror the daemon SSOT field-for-field — the `ConversationSummary` / `MessagePayload` convention).

### 2. Decode — `src/main/transport/inboundMessage.ts`

Add a member to the `InboundDaemonMessage` union:

```ts
| { kind: 'queue-state'; queueState: QueueStatePayload }
```

Add two parse functions modelled on `parseConversationSummary` + `parseConversationsPayload` (the
array template) — signatures + behaviour, developer writes the bodies:

- `parseQueuedItem(payload: unknown): QueuedItem` — `isRecord` guard (`throw new WireDecodeError('malformed queued item')`), then `requireNumber(payload, 'queued_msg_id')` + `requireString(payload, 'text')` + `requireString(payload, 'ts')`. Returns the three known fields; unknown keys tolerated, not copied.
- `parseQueueStatePayload(payload: unknown): QueueStatePayload` — `isRecord` guard (`'malformed queue_state payload'`), `requireString(payload, 'conversation_id')`, then `const raw = payload.queued; if (!Array.isArray(raw)) throw new WireDecodeError('malformed queued list')`, then `raw.map(parseQueuedItem)`. **An empty array is valid** (`[].map()` → `[]`, AC3).

Add the decode arm in the `switch (envelope.type)` (narrow-before-log, mirroring `tool_result`):

```ts
case 'queue_state': {
  const queueState = parseQueueStatePayload(envelope.payload)
  diagnosticLog?.event({ event: 'inbound-decoded', code: 'queue_state', bytes: plaintext.length, hash: hashPlaintext(plaintext) })
  return { kind: 'queue-state', queueState }
}
```

**No over-validation.** `requireNumber` enforces `typeof === 'number'`, which is exactly what
rejects a JSON-string `queued_msg_id` (AC4) — the `bundle seq/total` precedent. **Do NOT** add an
integer/`≥ 1`/range check: the "integer ≥ 1" property is a daemon guarantee, and enforcing it here
would defend an unobserved failure mode, diverging from the codebase's fail-closed-but-not-
over-validating posture (see `parseSessionTransitionPayload`, which deliberately does not
cross-validate the `workspace_cwd` invariant). Narrow the type; do not police the range.

### 3. IPC event — `src/shared/ipc/events.ts`

Import `QueuedItem` from `../wire/types`. Add the arm (reuse the wire row type **verbatim**, the
`conversationsReceived: readonly ConversationSummary[]` precedent):

```ts
| { type: 'queueState'; conversationId: string; queued: readonly QueuedItem[] }
```

- `conversation_id` → `conversationId` at the emit — the camelCase top-level-scalar convention (`turnId`, `newSessionId`). **This slice carries `conversationId`** (unlike `turnState`/`toolUse`, which drop it) because AC2 explicitly requires the event carry the conversation id, and #293 keys its replacement-truth backlog by it.
- `queued` reuses `QueuedItem` verbatim (no snake→camel remap of items — the nested-wire-row precedent). `readonly` matches `messagesReceived` / `conversationsReceived`.
- Doc comment (in the house style): consumed by the #293 store, not the session/timeline/modal store; `text` is untrusted daemon-relayed content the eventual render slice (#294) must render as **plain text, never HTML** (inherited constraint, no DOM sink in this slice); no token / key / raw frame can ride the arm (AC-by-construction).

### 4. Emit — `src/main/daemonConnection.ts`

Add the case to the `switch (inbound.kind)` (fresh literal, `queued` by reference — the
`conversations` / modal-`options` precedent):

```ts
case 'queue-state':
  emitDaemonEvent(sink, {
    type: 'queueState',
    conversationId: inbound.queueState.conversation_id,
    queued: inbound.queueState.queued
  })
  return
```

This switch is **not** `assertNever`-guarded, so omitting the case would silently drop the event —
it is required for AC2/AC5, not compile-forced.

### 5. The three exhaustive bridges (compile-forced)

Each of these `switch`es on `DaemonEvent.type` ends in `default: return assertNever(event)`, so the
new arm is a **compile error** until each handles it. All three no-op it:

- `daemonEventBridge.ts` — `case 'queueState': return null` (comment: consumed by the #293 store, not the session store; present only for the `assertNever` guard).
- `timelineBridge.ts` — add `'queueState'` to the null fall-through group. **Comment must state: `queue_state` is daemon state, not a turn-stream item (#720) — deliberately NOT folded into `reduceTimeline`.**
- `modalBridge.ts` — add `'queueState'` to the null fall-through group.

The other bridges (`conversationListBridge`, `conversationCreatedBridge`, `sessionIdBridge`,
`runSettingsWriteBridge`) use `default: return null` over `DaemonEvent` (not `assertNever`) — they
do **not** need touching.

## State + concurrency model

None new. The decode is synchronous; the emit is a single `webContents.send`. No store slice, no
async task, no timer, no listener is added by this slice. The frame is bounded by
`parseInboundMessage`'s existing `MAX_PLAINTEXT_BYTES` guard (`inboundMessage.ts:615`) **before**
decode, so the `queued[]` array cannot exceed the plaintext cap.

## Error handling

| Failure | Layer | Result | Surfaced to UI |
|---------|-------|--------|----------------|
| Payload not an object | `parseQueueStatePayload` | `throw WireDecodeError('malformed queue_state payload')` | Frame dropped (`daemonConnection.ts:330` catch); no event, no throw past decoder |
| `conversation_id` missing / non-string | `requireString` | `throw WireDecodeError('missing required field: conversation_id')` | dropped |
| `queued` missing / non-array | `parseQueueStatePayload` | `throw WireDecodeError('malformed queued list')` | dropped |
| A `queued` item not an object | `parseQueuedItem` | `throw WireDecodeError('malformed queued item')` | dropped |
| `queued_msg_id` a JSON string (or missing) | `requireNumber` | `throw WireDecodeError('missing required field: queued_msg_id')` | dropped (**AC4**) |
| `text` / `ts` missing / non-string | `requireString` | `throw WireDecodeError(...)` | dropped |
| `queued: []` (empty) | — | **valid**: event with `queued: []` (**AC3**) | emitted |

All failures are **fail-closed**, consistent with existing inbound-decode handling: the throw is
caught in `daemonConnection`'s `parseInboundMessage` try/catch and the frame is dropped (no partial
event). `WireDecodeError` messages name the **category only** — never interpolate `text`,
`queued_msg_id`, or `conversation_id` (all correlating / user content).

## Testing strategy

Vitest (`npm test`) + `npm run typecheck`. Extend the sibling test files; mirror #229's additions.
Scenarios (developer writes the bodies in the project idiom):

**`types.test.ts` — pin the shape (AC1, no-drift):**
- A well-formed `QueueStatePayload` literal (2 items) type-checks with `conversation_id: string`, `queued: QueuedItem[]`, each item `{ queued_msg_id: number, text: string, ts: string }`. A `queued_msg_id: '1'` (string) is a **type error** (compile-time pin that the counter is a number).

**`inboundMessage.test.ts` — decode (drive `parseInboundMessage` directly):**
- Well-formed 2-item `queue_state` frame → `{ kind: 'queue-state', queueState }`; both items' `queued_msg_id` (**as numbers**), `text`, `ts` preserved **in enqueue order** (AC2).
- `queued: []` → `{ kind: 'queue-state', queueState: { …, queued: [] } }` — empty list, **not null, not an error** (AC3).
- `queued_msg_id` as a JSON string (e.g. `"7"`) → throws `WireDecodeError`, no partial return (AC4).
- Missing `queued`, and `queued` a non-array (e.g. `{}`) → throws `WireDecodeError` (AC4).
- Missing per-item field (`text` / `ts` / `queued_msg_id`) → throws `WireDecodeError`.
- Diagnostic log (with an injected logger): a well-formed frame logs exactly `{ event: 'inbound-decoded', code: 'queue_state', bytes, hash }` — **no** `text` / `queued_msg_id` / `conversation_id`. A malformed frame (bad `queued_msg_id`) logs **nothing** (narrow-before-log: throw leaves no record).

**`daemonConnection.test.ts` — emit mapping (AC2/AC5):**
- A decoded `queue-state` `InboundDaemonMessage` drives `emitDaemonEvent` once with `{ type: 'queueState', conversationId, queued }`; order preserved; fresh literal (not the same object reference at top level).

**`daemonEventBridge.test.ts` / `timelineBridge.test.ts` / `modalBridge.test.ts` — no-op (AC5):**
- A `queueState` event → `null` (no `SessionAction` / no `ThreadEvent` / no `ModalEvent`). The `assertNever` guard compiles (exhaustiveness holds). One test per bridge suffices; these are pins on the "existing consumers ignore it, no behaviour change" contract.

## Scope note (why 7 files, and why it stays one `size:s`)

This slice touches **7 production `.ts` files, creates 0**: `types.ts`, `inboundMessage.ts`,
`events.ts`, `daemonConnection.ts`, and the 3 bridges. That count trips the "≥ 5 production files"
commit self-check — but this is the **documented, type-forced false-positive** for the DaemonEvent
inbound-decode pattern:

- The fan-out is **atomic and unsplittable**: the 3 renderer bridges each end in `assertNever`, so a
  new `DaemonEvent` arm is a compile error until **all three** handle it. Splitting produces either a
  non-compiling intermediate (arm added, bridges not) or dead code (payload types with no arm),
  pushing the fan-out downstream into #293 — strictly worse.
- **Precedent is dispositive:** #201, #214, #229, #241, #273 are the same pattern, each touched the
  same ~7-file set, each shipped as one `size:s` and is DONE (#229's own notes flag "7 files").
- **Every step-1 primary red line passes with margin:** 0 new files (≤ 3); ~400 total LOC incl. tests
  (< 600); **2** new exported types — `QueuedItem`, `QueueStatePayload` (≤ 5); ~5 edit sites, one
  `DaemonEvent` arm with 3 exhaustive consumers + 1 emit + 1 decode (≤ 10 call sites); **5** AC
  (≤ 5); ~4 reject branches (≤ 10).

The file count is honestly 7 and irreducible; it is not an undercounted-scope smell. This is the
same adjudication the #145 split recorded for #292 up front.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX — this slice *is* the untrusted→trusted boundary. It is a single, explicit choke point: `parseQueueStatePayload` inside `parseInboundMessage` (`inboundMessage.ts`), which fail-closes with `WireDecodeError` on any structural/type mismatch. Downstream holds a fully-narrowed `QueueStatePayload` (typed, no `unknown`). The untrusted field is `text` (client-originated transit content, relayed by a content-blind relay): it is decoded and carried as opaque display text, **never interpreted, and has no DOM sink in this slice** (all three renderer bridges no-op the arm). SHOULD FIX inherited downstream: the eventual render slice (#294) must render `text` and `conversation_id` as **plain text, never HTML** — documented on the `queueState` arm comment; code-review of #294 must enforce it.
- **[Tokens, secrets, credentials]** N/A — no token, key, or credential is read, written, compared, or logged. The `queueState` arm carries `conversationId` + `QueuedItem[]` only; by construction no field can hold a secret (the `snapshotReceived` / `sessionTransition` "no secret field" convention).
- **[File / storage operations]** N/A — this slice performs no filesystem or storage I/O. Nothing is persisted; the decoded event is forwarded on the existing IPC channel and dropped by the bridges.
- **[Inter-process / Electron attack surface]** No findings — the decode + emit stay entirely in the **main** process (transport). No new `BrowserWindow`, no new `contextBridge` API, no new `ipcMain` channel: the event rides the **existing** `DAEMON_EVENT_CHANNEL` (`emitDaemonEvent`), whose payload is typed to `DaemonEvent`, so no non-event / raw-frame data can be sent. Keys, sockets, and the Noise session are untouched and remain in main.
- **[Cryptographic primitives]** N/A — decode is **post-decryption**; the Noise_IK session, key schedule, and AEAD framing are upstream and unchanged. No RNG, no comparison, no nonce handling in this slice.
- **[Network & I/O]** No findings — a hostile daemon could send an oversized `queued[]` array as a memory-exhaustion attempt, but `parseInboundMessage` enforces `MAX_PLAINTEXT_BYTES` (`inboundMessage.ts:615`) **before** `decodeEnvelope`/parse runs, so the array is bounded by the existing plaintext cap. No new socket, timeout, reconnect, or TLS surface is added.
- **[Error messages, logs, telemetry]** No findings — **narrow-before-log** discipline (the `tool_result` precedent): the diagnostic fires only *after* the payload fully narrows, so a malformed frame throws first and leaves **no** record. The logged event is content-free (`{ event, code: 'queue_state', bytes, hash }`) — `text`, `queued_msg_id`, and `conversation_id` never enter the log. `WireDecodeError` messages name the failure **category only** (`'malformed queue_state payload'`, `'missing required field: queued_msg_id'`) — never interpolating `text` or a correlating id. The caught error is **dropped** at `daemonConnection.ts:330` (classify-don't-forward), never surfaced to a log or the renderer.
- **[Concurrency]** N/A — synchronous decode plus a single `webContents.send`. No async task, timer, listener, or shared-state mutation is introduced; nothing to cancel on teardown.
- **[Threat model alignment]** No findings — the applicable desktop threat is **hostile daemon response** (malformed / mistyped / oversized data from the daemon or something impersonating it inside the session). The design parses **defensively and fail-closed**: every field is type-checked, the array is validated, a JSON-string `queued_msg_id` is rejected (AC4), and any failure drops the frame with no partial event. The **malicious/compromised relay** is content-blind and on-path only; it cannot forge a `queue_state` inside the Noise session, and a dropped/reordered/flooded frame is handled by the fail-closed decode (a flood is bounded by the plaintext cap). No protocol-level threat is newly exposed by adding one decode arm.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12

## Open questions

None. The wire contract (#720), the carry-`conversationId` decision (AC2), the not-a-timeline-item
decision (#720), and the no-range-validation posture are all settled above. The backlog holder and
its replacement-truth semantics are #293's, out of scope here.
