# Conversation promote (transport)

The **transport data path** that lets the desktop client ask the pyry daemon to promote an
existing discussion into a saved channel, so the [Save-as-channel dialog](save-as-channel-dialog.md)
can flip `ConversationSummary.is_promoted` on a row the [Channel List](channel-list.md)'s
`partitionByPromotion` already reads. A client sends `promote_conversation{conversation_id, name,
cwd}` (all three **required** strings); the daemon confirms by **broadcasting**
`conversation_updated` to every client on the server-id — not a correlated reply.

Introduced in [#273](../codebase/273.md), split from #143. Transport data path only — command →
broadcast → one typed event. The direct twin of [conversation create](conversation-create.md)
(#241), field-for-field in structure, with two deliberate divergences the daemon contract dictates
(spec #274 in `pyrycode-docs`). The renderer-facing [Save-as-channel dialog](save-as-channel-dialog.md)
(desktop [#274](../codebase/274.md), shipped) and the live-list reflection that flips a row from
discussion to channel ([#275](../codebase/275.md), shipped) are separate tickets that consume what
this slice introduces.

## The wire contract

```ts
// request (client → daemon) — all three REQUIRED, the opposite of create's nullable trio
export interface PromoteConversationPayload {
  conversation_id: string
  name: string
  cwd: string
}

// reply (daemon → client, BROADCAST — no in_reply_to correlation)
export interface ConversationUpdatedPayload {
  id: string
  is_promoted: boolean
  name: string | null   // note: BEFORE cwd, unlike ConversationCreatedPayload's cwd-before-name
  cwd: string
  last_used_at: string  // RFC3339
}
```

**Required, not nullable-and-present.** Where `CreateConversationPayload`'s three fields are `T |
null` ("take the server default"), `PromoteConversationPayload`'s three are plain `string`: a
promoted conversation must carry a real name and an effective cwd, and the id must resolve to an
existing row — the daemon's Go struct has no pointers and no `omitempty`. The command guard,
`isPromoteConversationPayload`, is therefore a clone of `isSendMessagePayload` (present-and-string
×3), **not** `isCreateConversationPayload` — a literal `null` is rejected here, unlike create.

`ConversationUpdatedPayload.name` stays `string | null` (present, nullable, never absent) exactly
like `ConversationSummary.name` / `ConversationCreatedPayload.name`. The one field-order divergence
from `ConversationCreatedPayload` — `name` before `cwd` — is intentional (spec #274 flags the
reordering) and is enforced by a `types.test.ts` key-order assertion, not by the (key-driven)
decoder, which is order-independent.

## The ten pieces

| Piece | File | Role |
|---|---|---|
| `PromoteConversationPayload` / `ConversationUpdatedPayload` | `src/shared/wire/types.ts` | ported wire types, field-for-field with the daemon |
| `promoteConversation` command / `isPromoteConversationPayload` guard | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildPromoteConversation` | `src/main/transport/promoteConversationEnvelope.ts` (new) | pure payload-carrying outbound envelope builder |
| `promoteConversation(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `parseConversationUpdatedPayload` + `conversation-updated` kind | `src/main/transport/inboundMessage.ts` | fail-closed inbound decode |
| `conversationUpdated` event | `src/shared/ipc/events.ts` | the `DaemonEvent` arm |
| `case 'promoteConversation':` | `src/main/index.ts` | `onCommand` dispatch |
| `case 'conversationUpdated': return null` (×3) | `daemonEventBridge.ts` / `timelineBridge.ts` / `modalBridge.ts` | forced by `assertNever`; real consumer is [#275](../codebase/275.md) |

### 1. The outbound builder (`promoteConversationEnvelope.ts`, new)

A **payload-carrying** builder, cloned from `createConversationEnvelope.ts` / `sendMessageEnvelope.ts`:

```ts
export interface PromoteConversationInput { id: number; ts: string; payload: PromoteConversationPayload }

export function buildPromoteConversation(input: PromoteConversationInput): Uint8Array
// Envelope { id, type: 'promote_conversation', ts, payload: input.payload } → encodeEnvelope() bytes.
```

Simpler than create's builder: all three fields are required strings, so there is no
explicit-`null` preservation concern — the payload serializes verbatim. The fresh literal that
bounds the field set lives one layer up, in the connection method.

### 2. The connection method (`daemonConnection.ts`)

```ts
function promoteConversation(payload: PromoteConversationPayload): void {
  if (driver === null) return              // inert no-op — a promote request has no consumer to fail
  try {
    // FRESH literal naming exactly the three modeled fields — never a spread of `payload`.
    const bytes = buildPromoteConversation({
      id: nextEnvelopeId,
      ts: now(),
      payload: { conversation_id: payload.conversation_id, name: payload.name, cwd: payload.cwd }
    })
    nextEnvelopeId += 1                     // shares the one counter with send/createConversation/…
    driver.sendMessage(bytes)
  } catch {
    // Never throw out of the module (parity #490). Dropped, no log, no event.
  }
}
```

The **`send` twin**, same rationale as `createConversation`/`requestSnapshot`: a promote request
has no download-progress state to coordinate, so a request sent while disconnected simply produces
no reply — and since the reply is an unsolicited broadcast anyway, there is no correlation memory
to leave dangling either way. The **fresh literal is the deterministic security net** (the #236
posture): the guard is a structural minimum tolerating a smuggled extra key, so the outbound wire's
three-field shape is guaranteed here, not at the boundary guard.

### 3. The inbound decode (`inboundMessage.ts`)

Extends `InboundDaemonMessage` with `{ kind: 'conversation-updated'; conversationUpdated:
ConversationUpdatedPayload }` and adds:

```ts
function parseConversationUpdatedPayload(payload: unknown): ConversationUpdatedPayload {
  if (!isRecord(payload)) throw new WireDecodeError('malformed conversation_updated payload')
  return {
    id: requireString(payload, 'id'),
    is_promoted: requireBoolean(payload, 'is_promoted'),
    name: requireStringOrNull(payload, 'name'),   // reuses #139's nullable-field checker
    cwd: requireString(payload, 'cwd'),
    last_used_at: requireString(payload, 'last_used_at')
  }
}
```

Fail-closed like `parseConversationCreatedPayload`, in the reply's own field order (`name` before
`cwd`): a missing/mistyped field throws (`WireDecodeError`, category-only message — `name`/`cwd`
could otherwise echo a title or workspace path); `name: null` is a valid, distinct value. Narrowed
**before** the content-free diagnostic log fires, so a malformed broadcast leaves no record; the
log reuses the existing `{event, code: 'conversation_updated', bytes, hash}` shape, deliberately no
`count` (the #241 posture).

### 4. The emit site (`daemonConnection.ts`'s consumer arm)

```ts
case 'conversation-updated':
  emitDaemonEvent(sink, { type: 'conversationUpdated', conversation: inbound.conversationUpdated })
  return
```

Verbatim passthrough — the `conversation-created` precedent: `parseConversationUpdatedPayload`
already returns only the five known fields, nothing left to strip. Emitted **unconditionally** on
every successful decode — there is no `in_reply_to` correlation to gate on (see § below).

### The command + event surface (`commands.ts` / `events.ts`)

```ts
// RendererCommand — payload-carrying, ninth member
| { type: 'promoteConversation'; payload: PromoteConversationPayload }

// isRendererCommand
case 'promoteConversation':
  return 'payload' in value && isPromoteConversationPayload(value.payload)

// DaemonEvent
| { type: 'conversationUpdated'; conversation: ConversationUpdatedPayload }
```

No constructor: like `requestSnapshot`/`createConversation`, the render side (#274) builds the
literal inline. `index.ts`'s `onCommand` switch routes `promoteConversation` directly to
`connection.promoteConversation(payload)` — no orchestrator, since a promote request has no
consumer/reassembler.

By #273, three independent `assertNever`-guarded `DaemonEvent` switches exist
(`daemonEventBridge.ts`, [`timelineBridge.ts`](conversation-timeline-store.md),
[`modalBridge.ts`](modal-store-bridge.md)), so adding `conversationUpdated` forced a one-line case
in all three — all return/fold to `null`, since the real consumer is the list-reflect slice #275,
not any of the three exhaustive bridges.

## Data flow

```
Save-as-channel dialog (#274) → sendCommand({type:'promoteConversation', payload:{conversation_id,name,cwd}})
  → COMMAND_CHANNEL → onCommand (isPromoteConversationPayload ✓) → connection.promoteConversation(payload)
  → buildPromoteConversation({id,ts,payload:{fresh literal}}) → driver.sendMessage  [inert no-op if not connected]

daemon → conversation_updated frame (BROADCAST, to every client on the server-id)
  → onDriverEvent 'message' → parseInboundMessage
  → {kind:'conversation-updated', conversationUpdated} → emitDaemonEvent
    {type:'conversationUpdated', conversation}
  → DAEMON_EVENT_CHANNEL → all three assertNever bridges → null (no store consumer)
                          → the list-reflect slice's own subscription ([#275](../codebase/275.md))
```

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Renderer sends malformed command (missing/mistyped/null field) | `isPromoteConversationPayload` | rejected at boundary; never reaches `onCommand` |
| Not connected when `promoteConversation` called | `daemonConnection` | inert no-op; no throw, no event |
| Over-cap / driver throw on send | try/catch | caught, dropped |
| Renderer smuggles an extra payload field | connection method's fresh literal | never crosses the wire — the guard tolerates it, the literal excludes it |
| `payload` not an object, or a required field missing/mistyped | `parseConversationUpdatedPayload` | throws `WireDecodeError`, category-only message; frame dropped, no partial event |
| `name: null` on the wire | `requireStringOrNull` | decodes to `null` — a valid distinct value |
| Oversized plaintext | existing `MAX_PLAINTEXT_BYTES` guard | throws before parsing begins |

## Correlation is deliberately absent — the reply is a broadcast, not a response

Unlike [conversation create](conversation-create.md#correlation-is-deliberately-absent) (where
correlation is *possible* via `in_reply_to` but simply unused), `conversation_updated` is not a
reply to `promote_conversation` at the protocol level at all — the daemon fans it out to **every**
client on the server-id (the `assistant_delta` pattern: an unsolicited event, not a request/response
pair). This slice therefore adds **no** outstanding-request memory (unlike the correlated
`set_session_settings` #261/#269 paths that keep a `pendingSettings` map keyed by `in_reply_to`).
The promoting client also receives its own broadcast, and a broadcast could in principle name an id
the local store has never seen — both were **#275's** concern, and both dissolved there by choosing
a re-request over an in-place patch: the daemon's authoritative reply is idempotent regardless of
who triggered it, so no dedup or id reconciliation was needed.

## Out of scope

- **Self-broadcast dedup / spurious-id reconciliation** — resolved by [#275](../codebase/275.md)'s
  choice of re-request over an in-place store patch (see above); no code needed either concern.
- **Resolving `cwd` into a real filesystem path** — untrusted daemon-supplied text, carried only as
  opaque display text; the daemon owns server-side `cwd` resolution.

## Related

- [Conversation create](conversation-create.md) / [#241 codebase notes](../codebase/241.md) — the
  direct twin this transport slice clones, with the required-vs-nullable and
  broadcast-vs-correlated divergences called out throughout.
- [#273 codebase notes](../codebase/273.md) — implementation summary, patterns, lessons.
- [Conversation list fetch](conversation-list-fetch.md) / [#139 codebase notes](../codebase/139.md) —
  the read-side origin of `requireStringOrNull`, reused here for the reply's `name`.
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the
  render slice already partitioning rows by `is_promoted`, kept in sync with this transport's
  broadcast by [#275](../codebase/275.md)'s re-request trigger in
  [conversation list store](conversation-list-store.md).
- [Save-as-channel dialog](save-as-channel-dialog.md) / [#274 codebase notes](../codebase/274.md) —
  the renderer UI that dispatches `promoteConversation`, the sole caller of this slice's command.
- [Daemon connection](daemon-connection.md) — hosts `promoteConversation(payload)`, the `send` twin
  with the fresh-literal security net.
- [Inbound message decode](inbound-message-decode.md) — hosts `parseConversationUpdatedPayload` and
  the `conversation-updated` `InboundDaemonMessage` kind.
- [Command channel](command-channel.md) — the `promoteConversation` `RendererCommand` member + guard.
- [Daemon-event channel](daemon-event-channel.md) — the `conversationUpdated` `DaemonEvent` member.
- [Daemon-event bridge](daemon-event-bridge.md) / [Conversation timeline store](conversation-timeline-store.md)
  / [Modal-prompt model](modal-prompt-model.md) — the three exhaustive `DaemonEvent` consumers that
  tolerate `conversationUpdated` by returning `null`.
- [#236 codebase notes](../codebase/236.md) — the fresh-literal-vs-spread security posture this
  reaffirms for a security-sensitive outbound command.
- Daemon twin (QMD `pyrycode-docs`): `internal/protocol/conversations_write.go`
  `PromoteConversationPayload`/`ConversationUpdatedPayload` (spec #274); `docs/protocol-mobile.md §§
  promote_conversation, conversation_updated`.
