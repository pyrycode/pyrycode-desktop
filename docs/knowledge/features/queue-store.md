# Queue store

The renderer `queueStore.ts`, `queueBridge.ts`, `QueueData` mount and exclusive
tests were deleted in #2030 after legacy queue presentation retired in #2023.
Pairing cleanup no longer clears an exclusive backlog map. Daemon queue items
and local unaccepted sends retain separate authority in [thread runtime](thread-runtime.md).

## What it does

Shown queued `user_message` items supply queued rows. Pending sends settle only
when canonical content matches the exact host/conversation and captured device/
message identity. Queue snapshots, equal text and another device's message ID
cannot settle a local row. Reconnect recovery uses authoritative items and
certified queries rather than legacy backlog resets or echo reconciliation.

## How it works

### The store (`src/renderer/src/store/queueStore.ts`)

The former backlog map and its setter/reset/selectors no longer exist.

### The data path (`src/renderer/src/store/queueBridge.ts`)

The former queue snapshot subscription and `QueueData` mount are deleted.

Drop and Send now use the supplied item's exact positive-safe-integer
`content.queued_msg_id` and owning host. The enclosing item ID is not a queue
handle. Truncation, inactive/hidden state, missing callback, disconnected host or
missing Send now capability suppress the corresponding action. Changes become
visible through daemon item revisions, never local row deletion. See
[queue presentation and actions](conversation-shell-behavior.md#what-it-does).

### Data flow

Authoritative item revisions feed row presentation and settle scoped local sends.
No queue snapshot is folded into a legacy content holder.

## Configuration and usage

`QueuedRowHandle` remains at `screens/conversation/foldQueuedRows.ts` for shared
presentation; the folding implementation was already removed. The unused legacy
`dropQueuedMessage` and `sendQueuedNow` helper modules and their exclusive tests
are deleted. Existing authoritative queue command/action paths remain intact.
Main/IPC request and recovery retirement (#2025) and saved-format/indexed legacy
storage retirement (#2026) are separate boundaries.

## Edge cases and limitations

Missing snapshot/session authority never activates a backlog or legacy echo
fallback. A retained queue handle has no independent content or settlement
authority. Offline cache, host/device collision tests and authoritative
queue-recovery coverage remain; see [counted validation](thread-runtime.md#renderer-producer-retirement-validation).

## Related

- [Historical queue store](../codebase/293.md) and [reconnect resets](../codebase/197.md) — retired implementation history.
- [Dequeue envelope](dequeue-message-envelope.md) — surviving command contract.
- [Thread item presentation](conversation-shell-timeline-render.md#supplied-daemon-item-presentation) — current row/action admission.
