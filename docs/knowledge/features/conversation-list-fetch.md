# Conversation list fetch

The **transport data path** that lets the desktop client ask the pyry daemon for the live
conversation list, so a future navigation/archive/channel-management UI (mirror mobile #312) can
show more than the single milestone conversation. A client sends a bare `list_conversations` v2
control envelope; the daemon answers `conversations` with an ordered `{ conversations:
ConversationSummary[] }`.

Introduced in [#139](../codebase/139.md). Transport data path only — request → reply → one typed
event. The renderer store slice and the on-connect request trigger are the sibling
[Conversation list store](conversation-list-store.md) (#208, shipped), which in turn unblocks the
list UI (#141/#142).

## The wire contract

```ts
export interface ConversationSummary {
  id: string
  name: string | null          // null = unnamed scratch conversation, NEVER '' 
  is_promoted: boolean         // true = a saved channel; false = an ad-hoc discussion
  is_archived: boolean
  is_muted?: boolean
  agent?: WireAgent
  read_up_to?: number          // non-negative safe integer; zero is present, omission unknown
  latest_entry_id?: number     // durable history entry ID, not an envelope/replay ID
  cwd: string                  // untrusted display text — never resolved to a real fs path here
  last_message_ts: string      // RFC3339 — a TIMESTAMP, not preview text (no message text on this wire)
  last_used_at: string         // RFC3339
  archived_at?: string | null  // optional for old saved rows and fixtures
  workspace_label: string | null
}

export interface ConversationsPayload {
  conversations: ConversationSummary[]   // decode preserves wire order; views derive their own order
}
```

The eight required `ConversationSummary` fields must be present on the wire. There is
**no `kind` enum and no preview text on the wire** — "discussion vs channel" is derived from
`is_promoted` downstream, and a relative "last active" time is derived from `last_message_ts`
(#141's job, not this ticket's).

The nullable archive stamp from [daemon PR #2700](https://github.com/pyrycode/pyrycode/pull/2700)
is retained as an unparsed string or `null`; a missing live field normalizes to `null`. Any other
value type fails the whole list closed. Invalid timestamp strings remain valid wire values so
the [Archive screen](archive-screen.md#the-view-model-archiveviewmodelts) can select its last-use
fallback. [Saved snapshots](chat-history.md#snapshot-contract) also retain strings/null but preserve
absence on older rows. `is_muted` defaults to `false`; optional `agent` passes through `agentFromWire`.

Optional `read_up_to` and `latest_entry_id` use `Number.isSafeInteger(value) && value >= 0`, with
no coercion or rounding. Null, negative, fractional, nonnumeric and unsafe values fail the whole
list decode; omission adds no key and never defaults to zero. `conversation_updated` replies and
unsolicited pushes admit optional `read_up_to` by the same rule, but carry no `latest_entry_id`.
These IDs identify durable per-conversation history entries. [Saved lists](chat-history.md#snapshot-contract)
preserve admitted fields and accept older rows without them; [attention](conversation-unread.md)
uses the daemon comparison only when both are known. Desktop publication remains
[#1826](https://github.com/pyrycode/pyrycode-desktop/issues/1826).

## The eight pieces

| Piece | File | Role |
|---|---|---|
| `ListConversationsPayload` / `ConversationSummary` / `ConversationsPayload` | `src/shared/wire/types.ts` | ported wire types, field-for-field with the daemon |
| `buildListConversations` | `src/main/transport/listConversationsEnvelope.ts` (new) | pure **bare** outbound envelope builder |
| `requestConversations()` | `src/main/daemonConnection.ts` | connection method — the `send` twin |
| `parseConversationSummary` / `parseConversationsPayload` + `conversations` kind | `src/main/transport/inboundMessage.ts` | fail-closed inbound decode |
| `requestConversations` command / `conversationsReceived` event | `src/shared/ipc/commands.ts` / `events.ts` | the two sealed-union members |
| `case 'requestConversations':` | `src/main/index.ts` | `onCommand` dispatch |
| `case 'conversationsReceived': return null` | `src/renderer/src/store/daemonEventBridge.ts` | forced by `assertNever`, real consumer is the [conversation list store](conversation-list-store.md) (#208) |

### 1. The outbound builder (`listConversationsEnvelope.ts`, new)

A **bare** control-frame builder — cloned from [`buildRequestDebugBundle`](debug-bundle-request.md),
not the payload-carrying `buildRequestSnapshot` — because `list_conversations` selects nothing (the
daemon returns every conversation):

```ts
export interface ListConversationsInput { id: number; ts: string }

export function buildListConversations(input: ListConversationsInput): Uint8Array
// Envelope { id, type: 'list_conversations', ts, payload: {} } → encodeEnvelope() UTF-8 bytes.
```

"No payload" is a **present-but-empty `payload: {}`**, not an omission: the daemon's own
`ListConversationsPayload struct{}` would tolerate an absent/`{}`/`null` payload, but the desktop's
own `decodeEnvelope` (`codec.ts`) requires a *present* `payload`, and `Envelope.payload` stays
required to avoid a wire-type drift touching every consumer. `{}` over `null` upholds the module's
"never emit `null` on the wire" posture — the same accepted divergence from mobile that
`requestDebugBundle` established.

### 2. The connection method (`daemonConnection.ts`)

```ts
function requestConversations(): void {
  if (driver === null) return              // inert no-op — a list request has no consumer to fail
  try {
    const bytes = buildListConversations({ id: nextEnvelopeId, ts: now() })
    nextEnvelopeId += 1                     // shares the one counter with send/requestSnapshot/requestDebugBundle
    driver.sendMessage(bytes)
  } catch {
    // Never throw out of the module (parity #490). Dropped, no log, no event.
  }
}
```

The **`send` twin, not the `requestDebugBundle` twin** — same rationale as
[`requestSnapshot`](screen-snapshot-fetch.md#3-the-connection-method-daemonconnectionts): a list
request has no download-progress state to coordinate, so a request sent while disconnected simply
produces no reply. `requestConversations` had **no caller in this ticket** — the [conversation list
store](conversation-list-store.md) (#208) now triggers it via `sendCommand` on the rising edge to
`connected`, exactly as #181 triggered `requestSnapshot`.

### 3. The inbound decode (`inboundMessage.ts`)

Extends `InboundDaemonMessage` with `{ kind: 'conversations'; conversations: ConversationSummary[] }`
and adds a new nullable-field helper plus two parse functions:

```ts
function requireStringOrNull(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field]
  if (typeof value !== 'string' && value !== null) {
    throw new WireDecodeError(`missing required field: ${field}`)
  }
  return value
}

function parseConversationSummary(payload: unknown): ConversationSummary {
  if (!isRecord(payload)) throw new WireDecodeError('malformed conversation summary')
  return {
    id: requireString(payload, 'id'),
    name: requireStringOrNull(payload, 'name'),
    is_promoted: requireBoolean(payload, 'is_promoted'),
    is_archived: requireBoolean(payload, 'is_archived'),
    is_muted: payload.is_muted === undefined ? false : requireBoolean(payload, 'is_muted'),
    cwd: requireString(payload, 'cwd'),
    last_message_ts: requireString(payload, 'last_message_ts'),
    last_used_at: requireString(payload, 'last_used_at'),
    archived_at: payload.archived_at === undefined ? null : requireStringOrNull(payload, 'archived_at'),
    workspace_label: requireStringOrNull(payload, 'workspace_label'),
    ...optionalAgent(payload),
    ...optionalReadId(payload, 'read_up_to'),
    ...optionalReadId(payload, 'latest_entry_id')
  }
}

function parseConversationsPayload(payload: unknown): ConversationSummary[] {
  if (!isRecord(payload)) throw new WireDecodeError('malformed conversations payload')
  const raw = payload.conversations
  if (!Array.isArray(raw)) throw new WireDecodeError('malformed conversations list')
  return raw.map(parseConversationSummary)   // one bad row fails the whole reply closed
}
```

`requireStringOrNull` is the codec's first nullable-field checker — the `name` sibling of
`requireString`/`requireBoolean`. It admits a literal `null` as a **valid value** (AC2's distinct
"unnamed" signal) while still failing closed on a missing/`undefined`/numeric/object field (`name` is
never absent on the wire) — the explicit `typeof value !== 'string' && value !== null` check is what
keeps `undefined` rejected while `null` passes. `is_promoted`/`is_archived` reuse `requireBoolean`
verbatim (checks type, not truthiness, so `false` decodes as a real value). Narrowed **before** the
content-free diagnostic log fires (throw path leaves no record); the log reuses the existing
`{event, code, bytes, hash}` shape — **deliberately no `count`** field (unlike the `message_chunk`
arm's log), since a conversation count is more identifying than a message-batch size. No new
`DiagnosticEvent` field, so the #131 renderer-side pin is untouched.

### 4. The emit site (`daemonConnection.ts`'s consumer arm)

```ts
case 'conversations':
  emitDaemonEvent(sink, {
    type: 'conversationsReceived',
    conversations: inbound.conversations
  })
  return
```

Unlike `screen_snapshot`'s content-drop, there is **nothing to drop here** — `parseConversationSummary`
already returns only allowlisted fields (unknown server-added keys are decoded-but-not-copied at
parse time, not filtered at emit time), so passing the decoded array reference through verbatim is
safe. This mirrors `messagesReceived: inbound.messages`, not `snapshotReceived`'s hand-built minimal
shape. Field names stay **snake_case** — the event reuses the wire `ConversationSummary` row type
directly, so the [conversation list store](conversation-list-store.md) (#208) reads snake_case and
derives the discussion/channel label itself.

### The command + event surface (`commands.ts` / `events.ts`)

```ts
// RendererCommand — bare, no payload
| { type: 'requestConversations' }

// isRendererCommand
case 'requestConversations':
  return true   // bare member: a well-formed `type` is complete acceptance

// DaemonEvent
| { type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }
```

Both ride the **existing generic** `sendCommand`/`onDaemonEvent` channels — no new IPC channel, no
new preload method. The bare `isRendererCommand` case is the untrusted renderer→main boundary edit
that makes this ticket security-sensitive (there is no payload to validate — a well-formed `type`
string is the complete acceptance criterion). `index.ts`'s `onCommand` switch routes
`requestConversations` directly to `connection.requestConversations()` — no orchestrator, since a
list request has no consumer/reassembler.

`daemonEventBridge.ts`'s `translateDaemonEvent` is the only exhaustive `DaemonEvent` consumer
(`assertNever`-guarded), so adding `conversationsReceived` forced one case there too: `case
'conversationsReceived': return null` — no `SessionAction`, consumed instead by the [conversation
list store](conversation-list-store.md) (#208). See [daemon-event bridge](daemon-event-bridge.md).

## Data flow

```
conversation list store (#208, on `connected`)
  → sendCommand({type:'requestConversations'})
  → COMMAND_CHANNEL → onCommand (isRendererCommand ✓, bare) → connection.requestConversations()
  → buildListConversations({id,ts}) → driver.sendMessage  [inert no-op if not connected]

daemon → conversations frame → onDriverEvent 'message' → parseInboundMessage
  → {kind:'conversations', conversations} → emitDaemonEvent
    {type:'conversationsReceived', conversations}
  → DAEMON_EVENT_CHANNEL → daemonEventBridge (→ null, no SessionAction)
  → conversation list store's own subscription lands it (#208)
```

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed command | `isRendererCommand` | rejected at boundary; never reaches `onCommand` |
| Not connected when `requestConversations` called | `daemonConnection` | inert no-op; no throw, no event |
| Over-cap / driver throw on send | try/catch | caught, dropped |
| `payload` not an object / `conversations` missing or not an array | `parseConversationsPayload` | throws `WireDecodeError` |
| A row missing a required field, or `name`/`is_promoted`/`is_archived` mistyped | `parseConversationSummary` | throws — one bad row fails the whole reply closed, never a partial value |
| `name: null` on the wire | `requireStringOrNull` | decodes to `null` — a valid distinct value, never a failure, never `''` |
| Invalid present read/latest ID | `optionalReadId` | throws static `WireDecodeError('malformed conversation read ID')`; no coerced or rounded ID reaches state |
| Oversized plaintext | existing `MAX_PLAINTEXT_BYTES` guard | throws before parsing begins |

## Correlation is deliberately absent

Same posture as [screen snapshot fetch](screen-snapshot-fetch.md#correlation-is-deliberately-absent):
no `in_reply_to` map. Any `conversations` reply that arrives — solicited or not — is decoded and
emitted unconditionally; safe because only the authenticated daemon (inside the Noise session) can
produce one. The [conversation list store](conversation-list-store.md) (#208) is the idempotent
source of truth for what the UI shows. Replacement keeps higher held read marks for matching rows
in that host, so a delayed reply cannot undo a received read advance; other metadata still replaces.

## Out of scope

- **Any UI** — #141/#142 (list UI), consuming the [conversation list store](conversation-list-store.md)
  (#208, shipped) that in turn consumes `conversationsReceived`.
- **Deriving "discussion" vs "channel" from `is_promoted`, or a relative "last active" label from
  `last_message_ts`** — downstream UI concerns, not this transport ticket or the store (#208).
- **Resolving `cwd` into a real filesystem path** — `cwd` is untrusted daemon-supplied text, carried
  here only as opaque display text. Any future consumer that performs a real fs operation on it
  **must** boundary-check (`path.resolve` + known-root prefix check) — flagged by the architect's
  security review, not gated on this ticket since no fs op happens here.
- **Message-text preview** — the wire carries only `last_message_ts` (a timestamp), never message
  content; a text preview would need a separate daemon-side wire change.
- **Daemon `error` reply correlation** — see § Correlation above.

## Related

- [Conversation list store](conversation-list-store.md) / [#208 codebase notes](../codebase/208.md)
  — the renderer store + on-connect trigger built on this transport half.
- [#139 codebase notes](../codebase/139.md) — implementation summary, patterns, lessons.
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180 codebase notes](../codebase/180.md) — the
  exact precedent this feature clones (both the inbound decode chain and the outbound
  `RendererCommand` plumbing), including the "8 files, not 5" shape for a two-directional ticket.
- [Daemon connection](daemon-connection.md) — hosts `requestConversations()`, the `send` twin.
- [Inbound message decode](inbound-message-decode.md) — hosts `parseConversationSummary` /
  `parseConversationsPayload` and the `conversations` `InboundDaemonMessage` kind.
- [Command channel](command-channel.md) — the `requestConversations` `RendererCommand` member + guard.
- [Daemon-event channel](daemon-event-channel.md) — the `conversationsReceived` `DaemonEvent` member.
- [Daemon-event bridge](daemon-event-bridge.md) — the renderer-side `assertNever` consumer that
  tolerates `conversationsReceived` by returning `null`.
- [Debug-bundle request](debug-bundle-request.md) / [#115](../codebase/115.md) — the bare-builder
  precedent (`payload: {}`, not an omission) `buildListConversations` clones.
- Daemon twin (QMD `pyrycode-docs`): `internal/protocol/conversations_read.go`
  `ConversationSummary`/`ListConversationsPayload` (post-#880/#881 shape); mobile #312.
