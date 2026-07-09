# Screen snapshot fetch (Model / Effort / YOLO)

The **on-demand data path** that lets the desktop client ask the pyry daemon for the current
session's model, reasoning effort, and YOLO (permissions) posture, so the [Run configuration
sheet](conversation-shell.md) can display how the session is running. A client sends the
`request_snapshot` v2 control envelope carrying a `conversation_id`; the daemon answers
`screen_snapshot` with `{conversation_id, text, ts, model, effort, yolo}`.

Introduced in [#180](../codebase/180.md), split A of [#156](../codebase/156.md). Transport data path
only — request → reply → one typed event. No UI, no store facet; the render, the conversation-id
choice, and the trigger policy (sheet-open vs on-connect) are [#181](https://github.com/pyrycode/pyrycode-desktop/issues/181),
blocked on this.

## Why this is always-available, not gated on `interactive`

`screen_snapshot` is ADR-025's **always-available, parser-independent** escape hatch (pyrycode
#847/#848, closed on `main`) — deliberately *not* gated on the daemon's `interactive` capability. The
desktop client never advertises `interactive` (see the [hello exchange](hello-exchange.md), which
never hardcodes it), yet this fetch works today because the daemon serves `screen_snapshot` to any
paired, non-interactive connection.

## The five pieces (the `send_message` spine)

| Piece | File | Role |
|---|---|---|
| `RequestSnapshotPayload` / `ScreenSnapshotPayload` | `src/shared/wire/types.ts` | ported wire types, field-for-field with the daemon |
| `buildRequestSnapshot` | `src/main/transport/requestSnapshotEnvelope.ts` (new) | pure outbound envelope builder |
| `requestSnapshot(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin |
| `parseScreenSnapshotPayload` + `snapshot` kind | `src/main/transport/inboundMessage.ts` | fail-closed inbound decode |
| `requestSnapshot` command / `snapshotReceived` event | `src/shared/ipc/commands.ts` / `events.ts` | the two sealed-union members |

### 1. Wire types (`src/shared/wire/types.ts`)

```ts
export interface RequestSnapshotPayload {
  conversation_id: string
}

export interface ScreenSnapshotPayload {
  conversation_id: string
  text: string       // rendered screen — decoded, NEVER surfaced past transport
  ts: string          // RFC3339
  model: string       // '' = inherited daemon default (never treated as absent)
  effort: string      // '' = inherited daemon default
  yolo: boolean       // false = permissions enforced
}
```

`request_snapshot` / `screen_snapshot` join `EnvelopeType`. **All six `ScreenSnapshotPayload` fields
are always present on the wire (no `omitempty`)** — an empty `model`/`effort` means "inherited daemon
default," and `yolo: false` means "permissions enforced," never "absent." This is why the decoder
below treats every field as required, not optional-with-fallback.

### 2. The outbound builder (`requestSnapshotEnvelope.ts`, new)

A structural clone of [`buildSendMessage`](outbound-send-path.md) — **payload-carrying**, not the
bare [`buildRequestDebugBundle`](debug-bundle-request.md). The daemon rejects an empty/unknown
`conversation_id` with `conversation.not_found`, so (unlike the debug bundle, which is daemon-global)
there is a real payload to wrap:

```ts
export interface RequestSnapshotInput {
  id: number
  ts: string
  payload: RequestSnapshotPayload
}

export function buildRequestSnapshot(input: RequestSnapshotInput): Uint8Array
// Envelope { id, type: 'request_snapshot', ts, payload } → encodeEnvelope() UTF-8 bytes.
```

MAY throw `WireEncodeError` over `MAX_PLAINTEXT_BYTES`; the sole caller (`daemonConnection.requestSnapshot`)
catches and drops.

### 3. The connection method (`daemonConnection.ts`)

```ts
function requestSnapshot(payload: RequestSnapshotPayload): void {
  if (driver === null) return              // inert no-op — a snapshot has no consumer to fail
  try {
    const bytes = buildRequestSnapshot({ id: nextEnvelopeId, ts: now(), payload })
    nextEnvelopeId += 1                     // shares the one counter with send/requestDebugBundle
    driver.sendMessage(bytes)
  } catch {
    // Never throw out of the module (parity #490). Dropped, no log, no event.
  }
}
```

The **`send` twin, not the `requestDebugBundle` twin**: `requestDebugBundle`'s signature
(post-[#116](debug-bundle-reassembly.md)) takes a `BundleConsumer` and fails it explicitly when not
connected, because a debug-bundle download has a UI waiting on a result. A snapshot fetch has no
consumer — a request sent while disconnected simply produces no reply, exactly like `send`. Shares
the one module-local `nextEnvelopeId` with `send`/`requestDebugBundle`; ids stay unique across
interleaved calls because the daemon correlates by `id` and there is no `await` between build and
send (single-writer, race-free).

### 4. The inbound decode (`inboundMessage.ts`)

Extends `InboundDaemonMessage` with `{ kind: 'snapshot'; snapshot: ScreenSnapshotPayload }` and adds
`parseScreenSnapshotPayload`, fail-closed like `parseMessagePayload`:

```ts
function requireBoolean(payload: Record<string, unknown>, field: string): boolean {
  const value = payload[field]
  if (typeof value !== 'boolean') throw new WireDecodeError(`missing required field: ${field}`)
  return value
}

function parseScreenSnapshotPayload(payload: unknown): ScreenSnapshotPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed screen_snapshot payload')
  return {
    conversation_id: requireString(payload, 'conversation_id'),
    text: requireString(payload, 'text'),
    ts: requireString(payload, 'ts'),
    model: requireString(payload, 'model'),
    effort: requireString(payload, 'effort'),
    yolo: requireBoolean(payload, 'yolo')
  }
}
```

`requireBoolean` is the `yolo` sibling of `requireString`/`requireNumber` — it checks the value's
*type*, never its truthiness, so `false` decodes as a real value (permissions enforced), not a missing
field. Any missing/mistyped field throws `WireDecodeError` — never a partial value. Narrowed **before**
the content-free diagnostic log fires, so a malformed snapshot throws first and leaves no record
(reuses the existing `{event, code, bytes, hash}` fields — no new `DiagnosticEvent` field, so the #131
renderer-side pin is untouched). `MAX_PLAINTEXT_BYTES` already bounds an oversized reply — no new size
guard needed.

### 5. Content minimisation at the emit site (`daemonConnection.ts`'s consumer arm)

```ts
case 'snapshot':
  emitDaemonEvent(sink, {
    type: 'snapshotReceived',
    model: inbound.snapshot.model,
    effort: inbound.snapshot.effort,
    yolo: inbound.snapshot.yolo
  })
  return
```

This is the **load-bearing content-minimisation seam**: `text` / `ts` / `conversation_id` are decoded
(so a malformed frame still fails closed) but **dropped here** — only the three settings fields cross
IPC. The `snapshotReceived` `DaemonEvent` member is a **dedicated minimal shape**, deliberately *not*
a reuse of `ScreenSnapshotPayload` — a naive "reuse the wire type like the other events" would put
`text` (the rendered screen, potentially sensitive terminal output) one field away from a compromised
renderer's DevTools console. Making the event shape structurally incapable of holding `text` is what
the architect's security review flagged as the thing code review must confirm — and code review did
(PASS, no findings), verified by test as well as by construction.

### The command + event surface (`commands.ts` / `events.ts`)

```ts
// RendererCommand
| { type: 'requestSnapshot'; payload: RequestSnapshotPayload }

function isRequestSnapshotPayload(value: unknown): value is RequestSnapshotPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

// DaemonEvent
| { type: 'snapshotReceived'; model: string; effort: string; yolo: boolean }
```

Both ride the **existing generic** `sendCommand`/`onDaemonEvent` channels — no new IPC channel, no
new preload method. `isRequestSnapshotPayload` is the untrusted renderer→main boundary guard (mirrors
`isSendMessagePayload`) and is the reason this ticket carries `security-sensitive`. `index.ts`'s
`onCommand` switch routes `requestSnapshot` directly to `connection.requestSnapshot(command.payload)`
— no facade, unlike `requestDebugBundle`'s orchestrator, because a snapshot has no download-progress
state to coordinate.

**Renderer touch, despite the "zero renderer change" framing.** `daemonEventBridge.ts`'s
`translateDaemonEvent` is the only exhaustive `DaemonEvent` consumer (`assertNever`-guarded), so
adding `snapshotReceived` forced one case there too: `case 'snapshotReceived': return null` — no
`SessionAction`, consumed instead by #181's render bridge. See [daemon-event bridge](daemon-event-bridge.md).

## Data flow

```
window → sendCommand({type:'requestSnapshot', payload:{conversation_id}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isRequestSnapshotPayload guard)
      → connection.requestSnapshot(payload)
      → buildRequestSnapshot → driver.sendMessage  [inert no-op if not connected]

daemon → screen_snapshot frame → onDriverEvent 'message' → parseInboundMessage
      → {kind:'snapshot', snapshot} → emitDaemonEvent
        {type:'snapshotReceived', model, effort, yolo}   [text/ts/conversation_id dropped here]
      → DAEMON_EVENT_CHANNEL → daemonEventBridge (→ null, no SessionAction) → #181 render bridge
```

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed `requestSnapshot` | `isRendererCommand`/`isRequestSnapshotPayload` | dropped at boundary |
| Not connected when `requestSnapshot` called | `daemonConnection` | inert no-op; no throw, no event |
| Over-cap / driver throw on send | try/catch | caught, dropped |
| Malformed / oversized / mistyped `screen_snapshot` | `parseScreenSnapshotPayload` | throws `WireDecodeError`; dropped at the consumer's catch; no event |
| Missing settings field | `parseScreenSnapshotPayload` | throws — never a partial value |
| Daemon answers `error` instead of `screen_snapshot` | existing `error → daemon-error` routing | no reassembler in flight → no-op; no event, no hang |

## Correlation is deliberately absent

The daemon sets `in_reply_to` on the reply, but the desktop transport has no correlation map. Any
`screen_snapshot` that arrives is decoded and emitted unconditionally. Safe today because only the
authenticated daemon (inside the Noise session) can produce one, and there is a single in-flight
fetch against a single conversation. Correlating a daemon `error` (`conversation.not_found` /
`server.binary_offline`) back to the request — for a "snapshot unavailable" UX — is deferred until
that failure is actually observed (evidence-based-fix).

## Out of scope

- **Which `conversation_id`, and the trigger policy** (sheet-open vs on-connect) — #181.
- **Store facet + render** — #181.
- **Context-window usage** — [#182](https://github.com/pyrycode/pyrycode-desktop/issues/182), blocked on pyrycode/pyrycode#855 (no daemon message exists yet).
- **The `text` field's use** — decoded and validated, never surfaced; a future live-screen feature
  would need its own event.
- **Daemon `error` reply correlation** — see § Correlation above.

## Related

- [#180 codebase notes](../codebase/180.md) — implementation summary, patterns, lessons.
- [Daemon connection](daemon-connection.md) — hosts `requestSnapshot()`, the `send` twin.
- [Inbound message decode](inbound-message-decode.md) — hosts `parseScreenSnapshotPayload` and the
  `snapshot` `InboundDaemonMessage` kind.
- [Command channel](command-channel.md) — the `requestSnapshot` `RendererCommand` member + guard.
- [Daemon-event channel](daemon-event-channel.md) — the `snapshotReceived` `DaemonEvent` member.
- [Daemon-event bridge](daemon-event-bridge.md) — the renderer-side `assertNever` consumer that
  tolerates `snapshotReceived` by returning `null`.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the `send_message` spine
  this whole feature mirrors field-for-field.
- [Debug-bundle request](debug-bundle-request.md) / [#115](../codebase/115.md) — the closest prior
  precedent for a connection-method twin of `send`; contrasted above on the no-consumer vs
  fail-the-consumer distinction.
- [Conversation shell](conversation-shell.md) — the Run configuration sheet this feature's data will
  populate (via #181).
- Daemon twin (QMD `pyrycode-docs`): `internal/protocol/snapshot.go` `ScreenSnapshotPayload`;
  `docs/protocol-mobile.md` § Screen snapshot; pyrycode #847/#848 (ADR-025 always-available snapshot).
