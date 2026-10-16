# Thread timeline (conversation model)

[`threadTimeline.ts`](../../../src/renderer/src/store/threadTimeline.ts) retains
shared presentation and live-feedback declarations at their original path.
The renderer content reducer and its exclusive tests were deleted in #2030.
Accepted content comes from [daemon thread items](thread-item-store.md) through
[thread runtime](thread-runtime.md); local unaccepted sends use its pending store.

## Reference map

- [Current item presentation](conversation-shell-timeline-render.md#supplied-daemon-item-presentation) — supplied rows, ancestry and queue actions.
- [Live controls and reports](thread-runtime.md#live-controls-and-read-publication) — summary binding, composer feedback and read authority.
- [Earlier types and reducer internals](thread-timeline-internals.md), [limits](thread-timeline-limits.md) and [history](thread-timeline-history.md) — historical reconstruction contracts; the reducer, joins and row keys described there no longer exist.
- [ADR 0008](../decisions/0008-thread-timeline-model.md) — original model rationale, superseded for accepted content by daemon-built threads.

## What it does

`ThreadItem`, `ThreadEvent`, `TimelineState`, `TurnPhase` and related declarations
remain shared by presentation, live-state adapters and pending sends. Their
presence does not retain a reducer, a timeline store or any content subscription.
The renderer no longer coalesces raw deltas, looks back for open bubbles, fills
results, reconciles history or infers roster Agents to build accepted rows.

Canonical reports supply stop/banner/refusal presentation; admitted live readings
supply session errors, phase, model/configuration/session facts, MCP and status.
Missing snapshot/session authority creates no reconstructed report or activity.
Shared translators remain in `timelineBridge.ts` without a producer mount.

## Configuration and usage

Preserve these declarations in place when retiring surrounding implementations:
moving them would create a rename cascade without changing authority. The shared
saved-format declarations and main/IPC contracts survive until their own consumers
retire (#2026 and #2025 respectively). Renderer offline persistence uses complete
authoritative snapshots, not reconstructed rows or local echoes.

See [retirement scope and counted validation](thread-runtime.md#renderer-producer-retirement-validation)
and the [historical build-out](thread-timeline-history.md#configuration-and-usage).
