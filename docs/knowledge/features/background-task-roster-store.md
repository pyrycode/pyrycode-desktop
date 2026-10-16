# Background-task roster store

The inferred roster store, its bridge/app mount and exclusive tests were deleted
in #2030 after roster-backed presentation retired in #2023.
[`backgroundTaskRosterStore.ts`](../../../src/renderer/src/store/backgroundTaskRosterStore.ts)
retains only shared task presentation declarations, including `HeldBackgroundTask`
and its update/summary/progress shapes. It no longer owns a Zustand singleton,
roster inference, setters or pending Stop bookkeeping.

## Configuration and usage

Task membership, activity, attribution and saved presentation come from linked
daemon items. The [task drawer](conversation-shell-background-tasks.md) and composer
count share the authoritative projection. Stop retains item identity, recorded
agent and owning-host capability checks; raw roster events cannot invent tasks,
launches or provisional row identity. Missing item authority supplies no inferred
roster. See [thread runtime](thread-runtime.md#sending-and-authenticated-identity).

The former implementation is described in [model](background-task-roster-store-model.md),
[internals](background-task-roster-store-internals.md),
[edge cases](background-task-roster-store-edge-cases.md) and
[related history](background-task-roster-store-related.md). Those pages explain
retired reconstruction APIs, not current imports or mounts. Main/IPC contracts
remain pending #2025; renderer producer retirement does not remove wire decoding.
