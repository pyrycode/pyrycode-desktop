# Screen snapshot fetch (Model / Effort / YOLO)

The **on-demand data path** that lets the desktop client ask the pyry daemon for the current
session's model, reasoning effort, YOLO (permissions) posture, and context-window usage, so the
[Run configuration sheet](conversation-shell.md) can display how the session is running. A client
sends the `request_snapshot` v2 control envelope carrying a `conversation_id`; the daemon answers
`screen_snapshot` with `{conversation_id, text, ts, model, effort, yolo, used_tokens,
window_tokens}`.

Introduced in [#180](../codebase/180.md), split A of [#156](../codebase/156.md). Transport data path
only — request → reply → one typed event. No UI, no store facet; those landed as a second-level
split of [#181](https://github.com/pyrycode/pyrycode-desktop/issues/181) (itself split from #156):
[#187](../codebase/187.md) (the conversation-id choice, the sheet-open trigger policy, and the
[dedicated store](run-config-store.md)) and [#188](https://github.com/pyrycode/pyrycode-desktop/issues/188)
(the render, blocked on #187). Extended in [#191](../codebase/191.md) (pyrycode/pyrycode#857) to
carry two more always-present fields, `used_tokens`/`window_tokens` — the transport slice of the
context-window usage feature (split from #182); the gauge render is
[#192](https://github.com/pyrycode/pyrycode-desktop/issues/192), blocked on #191 + #188. Widened again
in [#316](../codebase/316.md), split from #147: `case 'snapshot'` now fires a **second**, dedicated
`screenSnapshotReceived` event alongside the unchanged `snapshotReceived`, deliberately surfacing the
`text`/`ts` fields §5 below used to drop — a security-reviewed reversal of that minimisation now that
the display slice [#318](https://github.com/pyrycode/pyrycode-desktop/issues/318) needs them.

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
  used_tokens: number    // current context size on the latest usage-bearing entry; NOT a running total (#191)
  window_tokens: number  // context-window size (200000 today); 0 = usage seam unwired (#191)
}
```

`request_snapshot` / `screen_snapshot` join `EnvelopeType`. **All eight `ScreenSnapshotPayload`
fields are always present on the wire (no `omitempty`)** — an empty `model`/`effort` means
"inherited daemon default," `yolo: false` means "permissions enforced," and `window_tokens: 0` means
"usage seam unwired/unavailable" (a fresh session instead reports `window_tokens: 200000`,
`used_tokens: 0`), never "absent." This is why the decoder below treats every field as required, not
optional-with-fallback. `used_tokens`/`window_tokens` were added in [#191](../codebase/191.md)
(pyrycode/pyrycode#857); this ticket carries them faithfully as values without normalizing or
interpreting them (that's [#192](https://github.com/pyrycode/pyrycode-desktop/issues/192)'s job).

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
    yolo: requireBoolean(payload, 'yolo'),
    used_tokens: requireNumber(payload, 'used_tokens'),      // #191
    window_tokens: requireNumber(payload, 'window_tokens')   // #191
  }
}
```

`requireBoolean` is the `yolo` sibling of `requireString`/`requireNumber` — it checks the value's
*type*, never its truthiness, so `false` decodes as a real value (permissions enforced), not a missing
field. `used_tokens`/`window_tokens` (#191) reuse `requireNumber` verbatim — the same helper the
debug-bundle `seq`/`total` use — so `0` decodes as the value `0`, never as absence (AC3). Any
missing/mistyped field throws `WireDecodeError` — never a partial value. Narrowed **before**
the content-free diagnostic log fires, so a malformed snapshot throws first and leaves no record
(reuses the existing `{event, code, bytes, hash}` fields — no new `DiagnosticEvent` field, so the #131
renderer-side pin is untouched). `MAX_PLAINTEXT_BYTES` already bounds an oversized reply — no new size
guard needed.

### 5. Content minimisation — and its deliberate reversal (`daemonConnection.ts`'s consumer arm)

```ts
case 'snapshot':
  emitDaemonEvent(sink, {
    type: 'snapshotReceived',
    model: inbound.snapshot.model,
    effort: inbound.snapshot.effort,
    yolo: inbound.snapshot.yolo,
    used_tokens: inbound.snapshot.used_tokens,      // #191
    window_tokens: inbound.snapshot.window_tokens   // #191
  })
  emitDaemonEvent(sink, {
    type: 'screenSnapshotReceived',                 // #316
    text: inbound.snapshot.text,
    ts: inbound.snapshot.ts
  })
  return
```

Through #191 this was the **load-bearing content-minimisation seam**: `text` / `ts` /
`conversation_id` were decoded (so a malformed frame still fails closed) but **dropped here** — only
the settings fields plus the two usage ints crossed IPC. The `snapshotReceived` `DaemonEvent` member
is still a **dedicated minimal shape**, deliberately *not* a reuse of `ScreenSnapshotPayload` — a
naive "reuse the wire type like the other events" would put `text` one field away from a compromised
renderer's DevTools console. Making the event shape structurally incapable of holding `text` is what
the architect's security review flagged as the thing code review must confirm — and code review did
(PASS, no findings for #180; PASS again for #191's two-field extension, one informational NIT on the
deliberate snake_case field naming), verified by test as well as by construction.

**[#316](../codebase/316.md) deliberately reverses that drop for `text`/`ts` specifically**, once a
real consumer existed: `conversation_id` still never crosses (no consumer), but `text`/`ts` now ride a
**second, dedicated** `screenSnapshotReceived` emit — a fresh named-field literal, never a spread of
`inbound.snapshot`, so the widening is bounded to exactly those two fields. `snapshotReceived` itself
is untouched (byte-for-byte, verified by test) — the widening is isolated to the new arm, not folded
into the existing one. This is a security-reviewed policy change (ADR-025: the live-screen view *is*
the rendered `text`, the sanctioned design, not a leak), not a retraction of the #180/#191 minimisation
discipline — see [#316's security review](https://github.com/pyrycode/pyrycode-desktop/issues/316) for
the full adversarial walkthrough.

### The command + event surface (`commands.ts` / `events.ts`)

```ts
// RendererCommand
| { type: 'requestSnapshot'; payload: RequestSnapshotPayload }

function isRequestSnapshotPayload(value: unknown): value is RequestSnapshotPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

// DaemonEvent
| { type: 'snapshotReceived'; model: string; effort: string; yolo: boolean
    ; used_tokens: number; window_tokens: number }
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
`SessionAction`, consumed instead by the [Run configuration store](run-config-store.md)'s data path
(#187). See [daemon-event bridge](daemon-event-bridge.md).

## Data flow

```
window → sendCommand({type:'requestSnapshot', payload:{conversation_id}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isRequestSnapshotPayload guard)
      → connection.requestSnapshot(payload)
      → buildRequestSnapshot → driver.sendMessage  [inert no-op if not connected]

daemon → screen_snapshot frame → onDriverEvent 'message' → parseInboundMessage
      → {kind:'snapshot', snapshot} → emitDaemonEvent
        {type:'snapshotReceived', model, effort, yolo, used_tokens, window_tokens}
        [conversation_id dropped here; used_tokens/window_tokens added #191]
      → DAEMON_EVENT_CHANNEL → daemonEventBridge (→ null, no SessionAction) → run-config store (#187,
        still 3-field — usage consumption is #192)
      → emitDaemonEvent {type:'screenSnapshotReceived', text, ts}   [#316, second emit, same frame]
      → DAEMON_EVENT_CHANNEL → all three bridges (→ null, dormant) → display slice #318
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

- **Which `conversation_id`, and the trigger policy** (sheet-open vs on-connect) — landed in
  [#187](../codebase/187.md) (see [Run configuration store](run-config-store.md)).
- **Render** — [#188](https://github.com/pyrycode/pyrycode-desktop/issues/188), blocked on #187.
- **Rendering / interpreting the context-window usage figures** — the "N% used" gauge, and
  normalizing the `window_tokens == 0` seam-unwired signal, are
  [#192](https://github.com/pyrycode/pyrycode-desktop/issues/192) (blocked on #191 + #188). This
  feature (as of [#191](../codebase/191.md)) carries `used_tokens`/`window_tokens` faithfully as
  values and performs no interpretation.
- **Extending the run-config store to hold usage** — also #192; the store stays three-field
  ([#187](../codebase/187.md)) through #191.
- **Rendering the `text` field** — [#316](../codebase/316.md) surfaced `text`/`ts` across IPC via the
  dedicated `screenSnapshotReceived` event (see §5 above); [#323](../codebase/323.md) added the
  [dedicated renderer store](screen-snapshot-store.md) that retains the latest value, but actually
  rendering it as the live-screen view (and the action that triggers it) is
  [#324](https://github.com/pyrycode/pyrycode-desktop/issues/324), blocked on #323.
- **Daemon `error` reply correlation** — see § Correlation above.

## Related

- [#180 codebase notes](../codebase/180.md) — implementation summary, patterns, lessons.
- [#191 codebase notes](../codebase/191.md) — the `used_tokens`/`window_tokens` extension to this
  feature (pyrycode/pyrycode#857).
- [#316 codebase notes](../codebase/316.md) — the deliberate, security-reviewed widening that
  surfaces `text`/`ts` via a second, dedicated `screenSnapshotReceived` emit at the same seam;
  unblocks the display slice #318.
- [Screen-snapshot store](screen-snapshot-store.md) / [#323 codebase notes](../codebase/323.md) —
  the dedicated renderer store + reactive-only observer that retains this event's `text`/`ts`,
  unblocking the display slice #324.
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
- [Conversation shell](conversation-shell.md) — the Run configuration sheet this feature's data
  populates (via [Run configuration store](run-config-store.md), #187/#188).
- [Run configuration store](run-config-store.md) / [#187 codebase notes](../codebase/187.md) — the
  data-path consumer of this feature's `snapshotReceived` event.
- Daemon twin (QMD `pyrycode-docs`): `internal/protocol/snapshot.go` `ScreenSnapshotPayload`;
  `docs/protocol-mobile.md` § Screen snapshot; pyrycode #847/#848 (ADR-025 always-available snapshot).
