# Thread timeline (conversation model)

A heterogeneous, ordered conversation-timeline data model — the foundation the structured
event-stream render vertical builds on. Introduced **alongside**
[session store](session-store.md)'s flat `MessagePayload[]` as a Strangler Fig. The cutover shipped in
[#179](../codebase/179.md): the coarse `message`/`message_chunk` render path (`MessageThread`) is
retired to dead-but-tested residue, and this model — via [timelineStore](conversation-timeline-store.md) —
is now the conversation's single thread surface.

Live structured events arrive through the [daemon connection](daemon-connection.md) and
[store bridge](conversation-timeline-store.md), then render in the
[conversation shell](conversation-shell.md). The original transport/store/render build-out is
recorded in [Thread timeline — history](thread-timeline-history.md).

Introduced in [#121](../codebase/121.md). Lives at
`src/renderer/src/store/threadTimeline.ts`. Pure renderer state — no IPC operations, preload bridge,
transport or React. Refusal records reuse the shared `ModelRefusalEvent` type through
a type-only import. See [ADR 0008](../decisions/0008-thread-timeline-model.md) for
the full rationale and normative reducer contract.

## Reference map

- [How it works](thread-timeline-internals.md) — Types, correlation and reducer behavior.
- [Edge cases and limitations](thread-timeline-limits.md) — State invariants and rendering constraints.
- [Related](thread-timeline-related.md) — Related features and historical references.

## What it does

Models interleaved messages and tool calls as a pure value type and reducer. Zustand
integration belongs to the [timeline store](conversation-timeline-store.md).
Stopped-turn metadata remains on retained boundary rows; the separate
[latest live stop](thread-timeline-internals.md#stopped-turn-state) supplies transient
composer recovery without letting older history restore it.
Refusal reports use retained `modelRefusal` rows and a separate live
[refusal offer](conversation-timeline-store.md#refusal-offer-lifetime), whose lifetime
extends across ordinary turns and conversation navigation.
Compaction completions retain `compactionBoundary` rows; a separate pending row
reference lets [delayed metadata](conversation-timeline-store.md#what-it-does)
enrich the original position across intervening content and history prepend.

[Protected local chat history](chat-history.md#snapshot-contract) defines a shared
durable contract for these display rows, separately from running state, pending
permissions and recovery offers. The app records received rows and local echoes
through an app-lifetime observer; restoration remains a separate integration.
The [exact contract test](chat-history.md#testing) lives in the
renderer test project so the shared/main project never imports this implementation.

## Configuration and usage

The full ticket-by-ticket build-out — every arm, scalar and field this model has grown, transport slice
through render slice — moved to [Thread timeline — history](thread-timeline-history.md) on 2026-09-04 to
stay under the size cap. What follows here is enough to place the module; that page has the rest.

The module is consumed through the transport → store → render path:
[#199](../codebase/199.md) built the wire types and `DaemonEvent` arms this module's `ThreadEvent` union
targets; [#202](../codebase/202.md) added the [store + bridge](conversation-timeline-store.md);
[#203](../codebase/203.md) rendered the streamed text, gating #179; [#179](../codebase/179.md) flipped the
`interactive` capability, wired `userText`'s producer (the composer echo) and retired the coarse
`MessageThread` mount — the vertical is complete. See
[Thread timeline — history § Configuration and usage](thread-timeline-history.md#configuration-and-usage)
for every ticket in between and since, including [#1039](../codebase/1039.md), which widened `userText`
with the `attachments` field documented in [Types](thread-timeline-internals.md#types).
