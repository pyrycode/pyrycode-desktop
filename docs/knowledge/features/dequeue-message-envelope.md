# Dequeue message envelope (outbound)

The **outbound** half of the queue-drop path: the wire type, the pure fail-closed transport builder,
and the full renderer→main command path the desktop uses to remove one queued-but-not-yet-run message
from a conversation's backlog before it runs. The renderer UI that dispatches the command — a drop
affordance on each queued row — shipped in [#296](../codebase/296.md); the path is now complete
end to end. [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) (PR
[#1215](https://github.com/pyrycode/pyrycode-desktop/pull/1215)) later widened what a drop does client-side
— see § Configuration and usage — without touching the wire frame itself, which stays exactly as below.

Introduced in [#299](../codebase/299.md) (the wire type + `buildDequeueMessage`), split from
[#295](https://github.com/pyrycode/pyrycode-desktop/issues/295) along the #235/#236 seam (memory:
\#295 tripped the ≥5-file split gate and was re-split). Wired to the renderer→main command path in
[#300](../codebase/300.md) (shipped): a `dequeueMessage` `RendererCommand` member, its
`isDequeueMessagePayload` boundary guard, and a `daemonConnection.dequeueMessage` method.
[#296](../codebase/296.md) (shipped) adds the render slice that calls `dequeueMessageCommand`.

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

- **Producer, shipped ([#296](../codebase/296.md), widened by
  [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213)):** the drop affordance on each
  queued row (a per-row icon button, `QueuedRowDrop` in `ConversationScreen.tsx` since
  [#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) folded the row off the deleted
  `QueuedBacklog` view and onto the merged timeline row) calls the pure
  `dropQueuedMessage(conversation_id, queued_msg_id, message_id, deps)` helper (`dropQueuedMessage.ts`),
  which calls `dequeueMessageCommand({ conversation_id, queued_msg_id })` and passes the result to the
  injected `deps.sendCommand` (`window.pyry.sendCommand` in production) — byte-identical to the frame
  #296 shipped. The `queued_msg_id` it selects by comes from the [queue store](queue-store.md)'s held
  `QueuedItem` rows, folded into `Timeline`'s rows by `foldQueuedRows` since #1214 (previously read
  directly by #294's `QueuedBacklog`); `conversation_id` is the container's open conversation id (the row
  itself carries no conversation id — the "conversation-id wall"). Since
  #1213, `deps` also carries `dispatch`/`dispatchFor` — the same two [thread
  timeline](thread-timeline.md) writes `submitMessage` used to post the echo — and the row's
  `QueuedItem.message_id` (pyrycode#2092) rides along as the third positional argument, so a drop that
  actually reaches the daemon (the send did not throw) also removes the correlated
  `userText` echo from both timeline stores via the `dropUserText` arm; an absent or empty
  `message_id` — a pre-#2092 daemon, or a row this window never sent — still drops the queued row and
  removes no echo. Full design: `docs/specs/architecture/1213-drop-queued-message-removes-echo.md`.
- **Consumer, already wired:** `main/index.ts`'s `onCommand` switch → `connection.dequeueMessage`.
  Fire-and-forget — no reply is expected; the daemon's re-broadcast `queue_state` snapshot (decoded
  by #292, rendered by #294) is the observable effect. **The queued row itself is still never
  removed optimistically** — #296's ruling stands unchanged, and the row leaves only via this existing
  snapshot-replace path. #1213 does not transfer that ruling to the *echo*: the echo is this window's
  own optimistic write (`submitMessage` posted it before any daemon acknowledgement), so undoing it at
  the click is symmetric rather than a new claim — see [thread timeline § Edge
  cases](thread-timeline-limits.md#edge-cases-and-limitations) for the reasoning and its bounded cost (a drop
  the daemon silently no-ops, e.g. an out-of-range `queued_msg_id`, leaves the echo removed locally
  until the next snapshot re-draws the queued row — display-only, and strictly better than the
  permanent delivered-looking lie it replaces).

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
- **Row-dimmed drop control.** The [#296](../codebase/296.md) drop button inherits
  `.message-row--queued`'s 50%-opacity dimming (moved off the deleted `.conversation__queued` region by
  [#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214), same compositing group, same
  effect) — a child element's own `opacity: 1` cannot escape a parent's opacity compositing group, so the
  button cannot be rendered at full brightness without restructuring the row-level dimming. Shipped
  dimmed by design; see [#296 codebase notes](../codebase/296.md) Lessons learned.

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
- [#299 codebase notes](../codebase/299.md) / [#300 codebase notes](../codebase/300.md) /
  [#296 codebase notes](../codebase/296.md) — implementation summaries for the wire+builder,
  command-path, and render (drop affordance) slices — the full path, now shipped end to end.
- [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) (PR
  [#1215](https://github.com/pyrycode/pyrycode-desktop/pull/1215)) — widened `dropQueuedMessage` to also
  remove the sending window's `userText` echo, correlated on `QueuedItem.message_id` (pyrycode#2092).
  The wire frame this doc describes is unchanged; the new behaviour is two additional, purely local
  store writes gated on the send succeeding. Full design:
  `docs/specs/architecture/1213-drop-queued-message-removes-echo.md`.
- [#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) — deleted `QueuedBacklog` and moved
  the drop control onto the merged timeline row (`QueuedRowDrop`); the wire frame, `dropQueuedMessage`'s
  contract and its two positional values (`queuedMsgId`, `messageId`) are all unchanged. See
  [Conversation shell — conversation surfaces and modals § Queued rows folded into the
  thread](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213).
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § Queue; pyrycode #720 (queue
  security model — dequeue is ungated for any paired client).
