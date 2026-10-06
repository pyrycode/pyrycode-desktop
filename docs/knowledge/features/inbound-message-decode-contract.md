# Inbound message decode — public contract

The decoder's public surface: what callers pass in, what they get back, and the guarantees attached to each.

Part of [Inbound message decode](inbound-message-decode.md); see that document for what the package does, its edge cases and its links.

## Public contract

- [Transport interface](inbound-message-decode-interface.md#public-contract): decoded result union, timestamps and failure outcomes.
- [Payload contracts](inbound-message-decode-payloads.md): field admission and frame-specific compatibility.
- [Message receipts and timestamps](#message-receipts-and-timestamps): queue metadata, mounted propagation and display time.

## Message receipts and timestamps

`MessagePayload` admits optional `queued_msg_id`
and `sent_now` alongside conversation id, message id, role and text. `queued_msg_id`
must be a positive safe integer; zero, negatives, fractions, unsafe integers, strings
and null reject the frame with `WireDecodeError`. `sent_now` must be a boolean,
including false; strings, numbers and null reject the frame. Neither field is coerced,
and omitted keys stay absent for older daemons. Unknown fields are discarded.
`messageQueueReceipt.test.ts` pins validation, false preservation and omission.
This stricter queue-id validation applies to message receipts; queue snapshot ids
retain their existing numeric decoder contract.

The parsed payload passes through `messageReceived` and typed IPC unchanged.
`translateTimelineEvent` maps only role-user receipts to `userText{ received: true }`,
renaming the fields `queuedMsgId` and `sentNow`. Mounted encrypted fake-transport
coverage in `e2e/queued-own-settlement.spec.ts` exercises both modes and snapshot orders.
Queue ids identify conversation-scoped entries, not turns. Only retained local facts
establish ownership; ordinary echoed Claude delivery precedes its answering stream,
while Codex commit-at-write and no-echo idle fallback cannot guarantee that opening.
See [settlement and duplicate receipts](thread-timeline-internals.md#queued-own-echo-settlement).

`FrameTimestamp{ ts: string }` carries the required daemon envelope timestamp on live
timeline-bearing results, including `message`. It is per-frame, independent of the
bind-time server origin. `parseInboundMessage` returns `{ kind: 'message', message,
ts: envelope.ts }`; `createDaemonConnection` emits `{ type: 'messageReceived', message,
daemonTs: inbound.ts }`. IPC-side `DaemonEventTimestamp` remains optional, and
`message_chunk` stays unstamped. History entries carry their own timestamps; their
page envelope does not gain this mix-in.

`decodeEnvelope` checks string shape, not date syntax. The role-user translator
accepts only finite `Date.parse` results after a 64-character bound. Missing, empty,
overlong or invalid values draw no time, never the desktop arrival clock. History-only
rows also remain unstamped; assistant deltas use their injected arrival clock.
Receipt settlement retains the held echo's original time and attachments.

`liveJoinKeyFor` excludes `messageReceived`: timestamp forwarding supplies display,
not identity or sorting. Raw timestamps and receipt ids never become rendered chrome,
logs, paths, filenames, URLs or React keys. Diagnostics remain static codes, byte
counts and hashes. Decode/connection tests pin timestamp forwarding;
`liveUserReceipts.test.ts` pins finite conversion and no-time fallbacks.

The optional second parameter is the [content-free diagnostic logger](diagnostic-log.md) ([#130](../codebase/130.md)). Absent it, the module is silent and behaves exactly as before; injected, each of the two non-throwing outcomes leaves a content-free record (§ *Diagnostic logging*).

A **single throw type** (`WireDecodeError`) covers every failure, so the consumer's one `catch` handles oversized, malformed, unparseable, and mistyped alike — exactly the shape `parseHelloAck` uses for the `hello_ack` boundary.
