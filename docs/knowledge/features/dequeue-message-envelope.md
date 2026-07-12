# Dequeue message envelope (outbound)

The **outbound** half of the queue-drop path: the wire type and the pure, fail-closed transport
builder the desktop will use to remove one queued-but-not-yet-run message from a conversation's
backlog before it runs. This slice ships **only** the wire contract and the builder — no command
wiring, no `daemonConnection` method, no renderer UI.

Introduced in [#299](../codebase/299.md), the wire+builder base slice split from
[#295](https://github.com/pyrycode/pyrycode-desktop/issues/295) along the #235/#236 seam (memory:
#295 tripped the ≥5-file split gate and was re-split). Blocks
[#300](https://github.com/pyrycode/pyrycode-desktop/issues/300) — the `daemonConnection.dequeueMessage`
method + IPC command that will call this builder, and the eventual renderer affordance's dispatch
target.

## What it does

Defines the byte-exact shape of the frame the desktop sends **back** to the daemon to drop one
queued entry, and a pure function that wraps an already-formed payload into a serialized `Envelope`:

- `dequeue_message{ conversation_id, queued_msg_id }` — `queued_msg_id` selects the entry the
  daemon's `msgqueue.Remove` deletes. It is the **same** per-conversation integer counter already
  decoded on the inbound side as [`QueuedItem.queued_msg_id`](queue-store.md) (#292), so the outbound
  type is symmetric: a plain JSON number, never a string.

Unlike the [modal resolution envelope](modal-resolution-envelope.md)'s `modal_answer`, this frame is
**ungated**: it carries no nonce and no answer token. Any paired client may drop a queued message —
project security model, daemon SSOT pyrycode #720. The daemon's `msgqueue.Remove` is a no-op for an
unknown id; the builder does not police `queued_msg_id`'s range, mirroring the inbound decoder's
"narrows the type but does not police it" stance (#292).

## How it works

### Wire types (`src/shared/wire/types.ts`)

```ts
export type EnvelopeType =
  | ...
  | 'queue_state'        // inbound (#292)
  | 'dequeue_message'     // outbound — new
  | ...

export interface DequeueMessagePayload {
  conversation_id: string
  queued_msg_id: number   // symmetric with the inbound QueuedItem.queued_msg_id
}
```

Both fields are always present (no `omitempty`), wire order `conversation_id` then `queued_msg_id`,
placed immediately after `QueueStatePayload` — the outbound counterpart sits beside its inbound
sibling in the same Queue feature family, the modal frames' inbound-then-outbound grouping precedent.

### The builder (`src/main/transport/dequeueMessageEnvelope.ts`, new, MAIN-PROCESS ONLY)

```ts
export interface DequeueMessageInput { id: number; ts: string; payload: DequeueMessagePayload }
export function buildDequeueMessage(input: DequeueMessageInput): Uint8Array
// → Envelope{ id, type: 'dequeue_message', ts, payload } → encodeEnvelope(); MAY throw WireEncodeError
```

A verbatim structural clone of `buildRequestSnapshot` ([screen-snapshot fetch](screen-snapshot-fetch.md))
— pure, synchronous, no clock/counter read (`id`/`ts`/`payload` are all caller-injected), no side
effects. `encodeEnvelope` (see [wire codec](wire-codec.md)) throws `WireEncodeError` above
`MAX_PLAINTEXT_BYTES`; the builder propagates it unchanged — the eventual caller (#300's
`daemonConnection.dequeueMessage`) catches it and drops the send, the same posture as
`buildSendMessage`/`buildRequestSnapshot`/the [modal resolution](modal-resolution-envelope.md)
builders. No barrel — never re-exported through the renderer; raw bytes stay in main.

## Configuration and usage

**Not yet consumed.** [#300](https://github.com/pyrycode/pyrycode-desktop/issues/300) is expected to
add `daemonConnection.dequeueMessage(payload)` (the `requestSnapshot` shape — inert no-op when not
connected, shares the module's `nextEnvelopeId` counter) plus a `dequeueMessage` `RendererCommand`
member and `isDequeueMessagePayload` boundary guard, routed through `main/index.ts`'s `onCommand`
switch. The renderer affordance that dispatches it (e.g. a remove control on the [queued backlog
render](conversation-shell.md)) is deferred further, blocked on #300.

## Edge cases and limitations

- **No decode path.** The frame is outbound-only — there is nothing for `inboundMessage.ts` to parse
  here, mirroring #235's modal-resolution slice.
- **No validation of `queued_msg_id` against the held backlog.** That belongs to the future caller,
  which holds the live [queue store](queue-store.md) state; the builder serializes whatever payload
  it is given.
- **Ungated by design.** No token, no nonce — the sole gate on dropping a queued message is #300's
  future IPC-edge validation of the renderer-supplied `conversation_id`/`queued_msg_id`, plus the
  operation's inherently low severity (a user can only drop their own not-yet-run queued entry, and
  an unknown id is a daemon-side no-op). This is the project security model (#720), not an oversight.
- **Zero `EnvelopeType` consumer cascade.** No production code does an exhaustive `switch` over
  `EnvelopeType` (unlike the `DaemonEvent` union, which has three independent exhaustive switches) —
  adding the member needed no companion `assertNever` fix-up anywhere.

## Related

- [Queue store](queue-store.md) / [#292 codebase notes](../codebase/292.md) — the inbound half of the
  Queue family (`queue_state` decode + `QueuedItem`) this outbound frame is symmetric with.
- [Modal resolution envelope](modal-resolution-envelope.md) / [#235 codebase notes](../codebase/235.md)
  — the closest prior wire+builder-only base slice, split along the same seam this ticket reuses.
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the `buildRequestSnapshot` precedent this
  builder is a structural clone of.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`WireEncodeError`/`MAX_PLAINTEXT_BYTES`, unchanged by
  this slice.
- [#299 codebase notes](../codebase/299.md) — implementation summary.
- Blocks [#300](https://github.com/pyrycode/pyrycode-desktop/issues/300) — the `daemonConnection`
  method + IPC command that will call `buildDequeueMessage`.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § Queue; pyrycode #720 (queue
  security model — dequeue is ungated for any paired client).
