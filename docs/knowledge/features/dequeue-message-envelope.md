# Dequeue message envelope (outbound)

The **outbound** half of the queue-drop path: the wire type, the pure fail-closed transport builder,
and the full renderer→main command path the desktop uses to remove one queued-but-not-yet-run message
from a conversation's backlog before it runs. No renderer UI yet — the drop affordance that dispatches
the command is a separate later slice, #296.

Introduced in [#299](../codebase/299.md) (the wire type + `buildDequeueMessage`), split from
[#295](https://github.com/pyrycode/pyrycode-desktop/issues/295) along the #235/#236 seam (memory:
#295 tripped the ≥5-file split gate and was re-split). Wired to the renderer→main command path in
[#300](../codebase/300.md) (shipped): a `dequeueMessage` `RendererCommand` member, its
`isDequeueMessagePayload` boundary guard, and a `daemonConnection.dequeueMessage` method. Blocks
#296 — the render slice that adds the drop affordance and calls `dequeueMessageCommand`.

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
`MAX_PLAINTEXT_BYTES`; the builder propagates it unchanged — `daemonConnection.dequeueMessage` (#300)
catches it and drops the send, the same posture as `buildSendMessage`/`buildRequestSnapshot`/the
[modal resolution](modal-resolution-envelope.md) builders. No barrel — never re-exported through the
renderer; raw bytes stay in main.

### The command path (`src/shared/ipc/commands.ts`, `src/main/daemonConnection.ts`,
`src/main/index.ts` — [#300](../codebase/300.md))

```ts
// src/shared/ipc/commands.ts
export type RendererCommand = ... | { type: 'dequeueMessage'; payload: DequeueMessagePayload }
export function dequeueMessageCommand(fields: DequeueMessagePayload): RendererCommand
function isDequeueMessagePayload(value: unknown): value is DequeueMessagePayload
// conversation_id present-and-string, queued_msg_id present-and-number — typeof only,
// no integer/positive/range check (mirrors the #292 decode guard's requireNumber-alone posture)

// src/main/daemonConnection.ts
dequeueMessage(payload: DequeueMessagePayload): void
// driver === null → no-op; fresh-literal { conversation_id, queued_msg_id } (never a spread of
// payload — bounds the wire regardless of what the structural-minimum guard let through); shares
// the one monotonic nextEnvelopeId with send/requestSnapshot/createConversation; try/catch drops
// the caught object (classify-don't-forward); never throws out of the module (parity #490)
```

The wire payload is reused **verbatim** on the command — no `Omit`-derivative, unlike
`answerModal`'s token-excluded payload (#236), because dequeue is ungated and there is no token to
strip. `main/index.ts`'s `onCommand` switch forwards `case 'dequeueMessage'` directly to
`connection.dequeueMessage(command.payload)` — no orchestrator, mirroring `requestSnapshot`. Full
detail: [#300 codebase notes](../codebase/300.md).

## Configuration and usage

- **Producer (deferred to #296):** the drop affordance will call `dequeueMessageCommand({
  conversation_id, queued_msg_id })` and pass the result to `window.pyry.sendCommand`. The
  `queued_msg_id` it selects by comes from the [queue store](queue-store.md)'s held `QueuedItem` rows.
- **Consumer, already wired:** `main/index.ts`'s `onCommand` switch → `connection.dequeueMessage`.
  Fire-and-forget — no reply is expected; the daemon's re-broadcast `queue_state` snapshot (decoded
  by #292, rendered by #294) is the observable effect, existing machinery outside this feature.
- No renderer surface exists yet. `dequeueMessageCommand` is exported ahead of its first consumer,
  the same shape every prior command has shipped in (e.g. `createConversation` before #242).

## Edge cases and limitations

- **No decode path.** The frame is outbound-only — there is nothing for `inboundMessage.ts` to parse
  here, mirroring #235's modal-resolution slice.
- **No validation of `queued_msg_id` against the held backlog.** Neither the builder nor the
  boundary guard checks it against the [queue store](queue-store.md)'s held rows — an unknown id is a
  daemon-side no-op, not a client-side error.
- **Ungated by design.** No token, no nonce — the boundary guard (`isDequeueMessagePayload`, #300) is
  a `typeof`-only structural check, not an authorization gate; a smuggled extra field passes it and is
  dropped instead by the connection method's fresh-literal construction. Dropping your own queued
  message has inherently low severity (a user can only affect their own not-yet-run entry, and an
  out-of-range id is a daemon-side no-op). This is the project security model (#720), not an
  oversight.
- **Zero `EnvelopeType` consumer cascade.** No production code does an exhaustive `switch` over
  `EnvelopeType` (unlike the `DaemonEvent` union, which has three independent exhaustive switches) —
  adding the member needed no companion `assertNever` fix-up anywhere.
- **No renderer surface.** #300 is command-path only by explicit scope boundary; there is no button,
  row control, or dispatch site until #296 lands.

## Related

- [Queue store](queue-store.md) / [#292 codebase notes](../codebase/292.md) — the inbound half of the
  Queue family (`queue_state` decode + `QueuedItem`) this outbound frame is symmetric with, and the
  future #296 drop affordance's source for `queued_msg_id`.
- [Command channel](command-channel.md) — the `RendererCommand`/`isRendererCommand` seam #300 extends
  with the `dequeueMessage` member.
- [Modal resolution envelope](modal-resolution-envelope.md) / [#235 codebase notes](../codebase/235.md)
  — the closest prior wire+builder-only base slice, split along the same seam this ticket reuses.
- [Conversation create](conversation-create.md) / [#241 codebase notes](../codebase/241.md) — the
  `createConversation` template #300's connection method and command clone (minus the token mint).
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the `buildRequestSnapshot` precedent this
  builder is a structural clone of.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`WireEncodeError`/`MAX_PLAINTEXT_BYTES`, unchanged by
  this slice.
- [#299 codebase notes](../codebase/299.md) / [#300 codebase notes](../codebase/300.md) —
  implementation summaries for the wire+builder and command-path slices.
- Blocks #296 — the render slice (drop affordance) that will call `dequeueMessageCommand`.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § Queue; pyrycode #720 (queue
  security model — dequeue is ungated for any paired client).
