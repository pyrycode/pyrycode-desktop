# Screen snapshot fetch (Model / Effort / YOLO) — removed

**Fully removed as of [#622](../codebase/622.md).** This doc originally described a full round trip —
the client sending `request_snapshot`, the daemon answering `screen_snapshot`. The client can no
longer send the request: `requestSnapshot`, `buildRequestSnapshot`, `RequestSnapshotPayload` and the
`request_snapshot` wire member were removed by [#620](../codebase/620.md). `snapshotReceived` and
`screenSnapshotReceived` were removed from the `DaemonEvent` union by [#621](../codebase/621.md),
along with the `case 'snapshot':` emit that produced them. **#622 removed the last surviving piece,
the inbound decode itself** — `parseScreenSnapshotPayload`, the `kind: 'snapshot'`
`InboundDaemonMessage` arm, and the `screen_snapshot`/`ScreenSnapshotPayload` wire types. Nothing in
this client can send, decode, or receive a screen-snapshot frame today. A well-formed `screen_snapshot`
arriving from the daemon now falls to `parseInboundMessage`'s tolerant `default` arm — logged
content-free as `inbound-unmodeled`, returns `null`, produces no event. §§2–5 below and the whole
"five pieces" table are historical, kept as the design record of a feature that shipped, was widened
twice, then was removed consumer-first over five tickets.

Originally: the **on-demand data path** that let the desktop client ask the pyry daemon for the
current session's model, reasoning effort, YOLO (permissions) posture, and context-window usage, so
the [Run configuration sheet](conversation-shell.md) could display how the session is running. A
client sent the `request_snapshot` v2 control envelope carrying a `conversation_id`; the daemon
answered `screen_snapshot` with `{conversation_id, text, ts, model, effort, yolo, used_tokens,
window_tokens}` — still true of the daemon today, but the desktop client no longer sends the request,
decodes the reply, or produces any event from one that arrives anyway.

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
the display slice needs them — [#318](https://github.com/pyrycode/pyrycode-desktop/issues/318), since
split into the store ([#323](../codebase/323.md)) and the action + view
([#324](../codebase/324.md)).

## Why this is always-available, not gated on `interactive`

`screen_snapshot` is ADR-025's **always-available, parser-independent** escape hatch (pyrycode
\#847/#848, closed on `main`) — deliberately *not* gated on the daemon's `interactive` capability. The
desktop client never advertises `interactive` (see the [hello exchange](hello-exchange.md), which
never hardcodes it), yet this fetch works today because the daemon serves `screen_snapshot` to any
paired, non-interactive connection.

## The five pieces (the `send_message` spine) — all now removed

| Piece | File | Role |
|---|---|---|
| ~~`RequestSnapshotPayload`~~ / ~~`ScreenSnapshotPayload`~~ | `src/shared/wire/types.ts` | `RequestSnapshotPayload` removed #620; `ScreenSnapshotPayload` removed #622 |
| ~~`buildRequestSnapshot`~~ | ~~`src/main/transport/requestSnapshotEnvelope.ts`~~ | **deleted #620** — was the pure outbound envelope builder |
| ~~`requestSnapshot(payload)`~~ / ~~`case 'snapshot':` emit~~ | `src/main/daemonConnection.ts` | **removed #620** (connection method, the `send` twin) / **removed #621** (the two-event emit) |
| ~~`parseScreenSnapshotPayload`~~ / ~~`snapshot` kind~~ | `src/main/transport/inboundMessage.ts` | **removed #622** — the fail-closed inbound decode; a `screen_snapshot` frame now falls to the tolerant `default` arm |
| ~~`requestSnapshot` command~~ / ~~`snapshotReceived`~~ / ~~`screenSnapshotReceived`~~ | `src/shared/ipc/commands.ts` / `events.ts` | the command member removed #620; both events removed #621 |

### 1. Wire types (`src/shared/wire/types.ts`) — removed #620 / #622

`RequestSnapshotPayload` was removed in #620; `ScreenSnapshotPayload` (the inbound reply shape) was
removed in #622. Historical:

```ts
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

`screen_snapshot` is a member of `EnvelopeType` (`request_snapshot` was removed alongside
`RequestSnapshotPayload` in #620). **All eight `ScreenSnapshotPayload`
fields are always present on the wire (no `omitempty`)** — an empty `model`/`effort` means
"inherited daemon default," `yolo: false` means "permissions enforced," and `window_tokens: 0` means
"usage seam unwired/unavailable" (a fresh session instead reports `window_tokens: 200000`,
`used_tokens: 0`), never "absent." This is why the decoder below treats every field as required, not
optional-with-fallback. `used_tokens`/`window_tokens` were added in [#191](../codebase/191.md)
(pyrycode/pyrycode#857); this ticket carries them faithfully as values without normalizing or
interpreting them (that's [#192](https://github.com/pyrycode/pyrycode-desktop/issues/192)'s job).

### 2. The outbound builder (`requestSnapshotEnvelope.ts`) — deleted #620

Historical — the file no longer exists. It was a structural clone of
[`buildSendMessage`](outbound-send-path.md) — **payload-carrying**, not the
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

### 3. The connection method (`daemonConnection.ts`) — removed #620

Historical — `requestSnapshot` no longer exists on `DaemonConnection`; see
[daemon connection](daemon-connection.md).

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

### 4. The inbound decode (`inboundMessage.ts`) — removed #622

Historical — extended `InboundDaemonMessage` with `{ kind: 'snapshot'; snapshot: ScreenSnapshotPayload
}` and added `parseScreenSnapshotPayload`, fail-closed like `parseMessagePayload`:

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

### 5. Content minimisation, its deliberate reversal, and the emit's removal (`daemonConnection.ts`) — historical

The whole `case 'snapshot':` block below was **deleted in [#621](../codebase/621.md)**. A well-formed
`screen_snapshot` frame is decoded (§4 still runs) and then simply dropped — no `emitDaemonEvent` call
remains for it, no daemon event is produced, and no log call was added in its place (a
security-reviewed requirement: the deleted block's own comment had said "no log call here", and #621's
review confirmed the diff adds zero log statements). Kept below as the historical record of what this
seam did across its lifetime.

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
was a **dedicated minimal shape**, deliberately *not* a reuse of `ScreenSnapshotPayload` — a
naive "reuse the wire type like the other events" would have put `text` one field away from a
compromised renderer's DevTools console. Making the event shape structurally incapable of holding
`text` is what the architect's security review flagged as the thing code review must confirm — and
code review did (PASS, no findings for #180; PASS again for #191's two-field extension, one
informational NIT on the deliberate snake_case field naming), verified by test as well as by
construction.

**[#316](../codebase/316.md) deliberately reversed that drop for `text`/`ts` specifically**, once a
real consumer existed: `conversation_id` still never crossed (no consumer), but `text`/`ts` rode a
**second, dedicated** `screenSnapshotReceived` emit — a fresh named-field literal, never a spread of
`inbound.snapshot`, so the widening was bounded to exactly those two fields. `snapshotReceived` itself
stayed untouched (byte-for-byte, verified by test) — the widening was isolated to the new arm, not
folded into the existing one. That was a security-reviewed policy change (ADR-025: the live-screen
view *is* the rendered `text`, the sanctioned design, not a leak), not a retraction of the #180/#191
minimisation discipline — see [#316's security review](https://github.com/pyrycode/pyrycode-desktop/issues/316)
for the full adversarial walkthrough. Neither arm ever found a production reader (`snapshotReceived`
lost its reader at #491/#500; `screenSnapshotReceived` never outlived its dormancy past #619), and
[#621](../codebase/621.md) removed both, consumer-first, once that was verified.

### The command + event surface (`commands.ts` / `events.ts`) — both removed

The `RendererCommand` member and its guard were removed in #620; the `DaemonEvent` members were
removed in #621 — nothing on this surface survives:

```ts
// DaemonEvent — both arms deleted #621, historical
| { type: 'snapshotReceived'; model: string; effort: string; yolo: boolean
    ; used_tokens: number; window_tokens: number }
| { type: 'screenSnapshotReceived'; text: string; ts: string }
```

The event used to ride the **existing generic** `onDaemonEvent` channel — no new IPC channel, no new
preload method. `isRendererCommand`'s `case 'requestSnapshot'` and the standalone
`isRequestSnapshotPayload` guard function are both gone (#620); a `{ type: 'requestSnapshot', … }`
shape now falls through the switch's default-deny (asserted by a positive test in `commands.test.ts`),
and `index.ts`'s `onCommand` switch no longer has a case that reaches `connection.requestSnapshot` —
that method doesn't exist either.

**Renderer touch, despite the original "zero renderer change" framing.** `daemonEventBridge.ts`'s
`translateDaemonEvent` was the exhaustive `DaemonEvent` consumer (`assertNever`-guarded) that forced a
`case 'snapshotReceived': return null` when the event was added — and the same `assertNever` guard is
what forced its removal at #621, along with the matching no-op arms in `timelineBridge.ts` and
`modalBridge.ts`. All three bridges still carry their `assertNever` default arm, so a new
`DaemonEvent` member remains a compile error. See [daemon-event bridge](daemon-event-bridge.md).

## Data flow

The whole round trip is now removed. Historical, as it stood at each stage:

```
[REMOVED #620] window → sendCommand({type:'requestSnapshot', payload:{conversation_id}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isRequestSnapshotPayload guard)
      → connection.requestSnapshot(payload)
      → buildRequestSnapshot → driver.sendMessage  [inert no-op if not connected]

daemon → screen_snapshot frame → onDriverEvent 'message' → parseInboundMessage
      [REMOVED #622] → {kind:'snapshot', snapshot}
      [REMOVED #621] → emitDaemonEvent {type:'snapshotReceived', model, effort, yolo, used_tokens, window_tokens}
      [REMOVED #621] → emitDaemonEvent {type:'screenSnapshotReceived', text, ts}
      → (today: parseInboundMessage's `default` arm — inbound-unmodeled log, returns null, no event)
```

Nothing in this client sends `request_snapshot` anymore, and since #622 nothing decodes a
`screen_snapshot` reply either — a frame arriving unprompted (correlation was
[always absent](#correlation-is-deliberately-absent)) now takes the exact same tolerant path as any
other unmodeled envelope type. See [Inbound message decode](inbound-message-decode.md) for that
boundary's current (post-#622) shape.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| ~~Renderer sends malformed `requestSnapshot`~~ | ~~`isRendererCommand`/`isRequestSnapshotPayload`~~ | **N/A since #620** — the shape now falls through to the switch's default-deny as an unrecognized command, same as any other unknown type |
| ~~Not connected when `requestSnapshot` called~~ | ~~`daemonConnection`~~ | **N/A since #620** — the method no longer exists |
| ~~Malformed / oversized / mistyped `screen_snapshot`~~ | ~~`parseScreenSnapshotPayload`~~ | **N/A since #622** — the parser no longer exists; any `screen_snapshot` payload, well-formed or not, decodes to `null` via the `default` arm without throwing |
| ~~Daemon answers `error` instead of `screen_snapshot`~~ | ~~existing `error → daemon-error` routing~~ | **N/A** — no reassembler or correlation was ever keyed to this reply |

## Correlation was deliberately absent

Historical. The daemon set `in_reply_to` on the reply, but the desktop transport never built a
correlation map for it — any `screen_snapshot` that arrived was decoded and emitted unconditionally.
Moot since #622: the decode itself is gone, so there is nothing left to correlate.

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
  [dedicated renderer store](screen-snapshot-store.md) that retained the latest value;
  [#324](../codebase/324.md) added the request action and the `<pre>` display that read it, removed
  in turn by [#618](../codebase/618.md), with the store and bridge themselves deleted by
  [#619](../codebase/619.md), the outbound half of this transport path removed by
  [#620](../codebase/620.md), both `DaemonEvent` members removed by [#621](../codebase/621.md), and
  the inbound decode itself removed by [#622](../codebase/622.md) — no piece of this feature survives.
- **Daemon `error` reply correlation** — see § Correlation above; moot since #622.

## Related

- [#622 codebase notes](../codebase/622.md) — removed the inbound decode itself
  (`parseScreenSnapshotPayload`, the `snapshot` `InboundDaemonMessage` kind) and the
  `screen_snapshot`/`ScreenSnapshotPayload` wire types; the last of the five removal slices, and the
  reason this doc is now fully historical.
- [#621 codebase notes](../codebase/621.md) — removed `snapshotReceived` and `screenSnapshotReceived`
  from the `DaemonEvent` union and the `case 'snapshot':` emit that produced them; a well-formed
  `screen_snapshot` frame decoded and was silently dropped from that point until #622 removed the
  decode too.
- [#620 codebase notes](../codebase/620.md) — removed the outbound half (`requestSnapshot`,
  `buildRequestSnapshot`, `RequestSnapshotPayload`, the `request_snapshot` wire member).
- [#180 codebase notes](../codebase/180.md) — implementation summary, patterns, lessons.
- [#191 codebase notes](../codebase/191.md) — the `used_tokens`/`window_tokens` extension to this
  feature (pyrycode/pyrycode#857).
- [#316 codebase notes](../codebase/316.md) — the deliberate, security-reviewed widening that
  surfaced `text`/`ts` via a second, dedicated `screenSnapshotReceived` emit at the same seam;
  unblocked the display slice, since split into #323 (store) + #324 (action + view); both event arms
  later removed by #621.
- [Screen-snapshot store](screen-snapshot-store.md) / [#323 codebase notes](../codebase/323.md) —
  the dedicated renderer store + reactive-only observer that retained this event's `text`/`ts`;
  deleted by [#619](../codebase/619.md).
- [#324 codebase notes](../codebase/324.md) — the request action + `<pre>` display, the first and
  only consumer of the store above; removed by [#618](../codebase/618.md).
- [Daemon connection](daemon-connection.md) — hosted `requestSnapshot()`, the `send` twin, until #620,
  and the `case 'snapshot':` emit until #621.
- [Inbound message decode](inbound-message-decode.md) — hosted `parseScreenSnapshotPayload` and the
  `snapshot` `InboundDaemonMessage` kind until [#622](../codebase/622.md) removed both.
- [Command channel](command-channel.md) — hosted the `requestSnapshot` `RendererCommand` member +
  guard until #620.
- [Daemon-event channel](daemon-event-channel.md) — hosted the `snapshotReceived` /
  `screenSnapshotReceived` `DaemonEvent` members until #621.
- [Daemon-event bridge](daemon-event-bridge.md) — the renderer-side `assertNever` consumer that
  tolerated both events by returning `null`, until #621 removed the arms it tolerated.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the `send_message` spine
  this whole feature mirrors field-for-field.
- [Debug-bundle request](debug-bundle-request.md) / [#115](../codebase/115.md) — the closest prior
  precedent for a connection-method twin of `send`; contrasted above on the no-consumer vs
  fail-the-consumer distinction.
- [Conversation shell](conversation-shell.md) — the Run configuration sheet this feature originally
  populated (via [Run configuration store](run-config-store.md), #187/#188), before the sheet moved
  onto the dedicated `runConfigReceived`/`session_settings` reply at #491/#500.
- [Run configuration store](run-config-store.md) / [#187 codebase notes](../codebase/187.md) — the
  original data-path consumer of this feature's `snapshotReceived` event, until #491/#500 moved it
  onto `runConfigReceived` instead.
- Daemon twin (QMD `pyrycode-docs`): `internal/protocol/snapshot.go` `ScreenSnapshotPayload`;
  `docs/protocol-mobile.md` § Screen snapshot; pyrycode #847/#848 (ADR-025 always-available snapshot).
