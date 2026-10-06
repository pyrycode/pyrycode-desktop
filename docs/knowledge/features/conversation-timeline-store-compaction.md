# Conversation timeline store — Compaction

Live compaction rows and metadata in the [conversation timeline](conversation-timeline-store.md).

## What it does

An observed `compacting: true` → `false` transition appends one permanent
`compactionBoundary` row in the addressed conversation. Repeated false frames add
nothing; successive compactions retain separate rows. `compact_result === 'failed'`
or any nonempty `compact_error` classifies a failure, including whitespace-only
errors. Missing outcomes and unknown result strings keep the generic label unless
an error is present. Raw outcome strings are discarded when constructing the row.

`TimelineState.pendingCompaction` holds the latest non-failed completion awaiting
metadata. A later `compaction_boundary` for that conversation replaces the referenced
row in place, even after intervening content. A new rising edge supersedes the
association; consuming a boundary or resetting the timeline clears it. Without a
matching pending row, a boundary appends its own divider. Failed rows never become
pending, so later success metadata cannot rewrite a failure. The bridge routes both
frames by their own conversation id, including while another conversation is open.
See [divider labels and styling](conversation-shell-session-and-channel-info.md#compaction-dividers).

The pending association uses row identity rather than an array index: history
prepend and removal of an earlier optimistic echo can shift indices without
changing the held row. The reducer wrapper preserves this reference across other
events, including reconnect; `prependHistoryFor` preserves it with the held items.
[`store/compaction.test.ts`](../../../src/renderer/src/store/compaction.test.ts)
pins both index-shifting cases, association consumption and supersession, failure
preservation, conversation isolation and reconnect without a false completion.

