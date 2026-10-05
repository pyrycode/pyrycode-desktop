# #1770 — Send `stop_background_task` and report its refusal

## Files read

- `docs/specs/architecture/1586-mcp-toggle.md` and commit `d42c91fb` → the precedent. This slice is the same send, bound, correlate, clear shape; every section below is a delta against it.
- `src/shared/wire/types.ts` → `CAPABILITY_INTERACTIVE`, `CAPABILITY_MULTI_AGENT`, `EnvelopeType` (the `'mcp_toggle'` member), `MCPTogglePayload`. The new constant, envelope type and payload go beside them.
- `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isMCPTogglePayload`, and `isInterruptPayload`, the non-empty `conversation_id` guard the new one copies for both fields.
- `src/shared/ipc/events.ts` → the `mcpToggleRejected` arm of `BaseDaemonEvent`; the background-task arms carry `taskId: string`, the name the new arm reuses.
- `src/main/transport/mcpToggleEnvelope.ts` → `buildMcpToggle`, the fresh-payload builder the new one copies.
- `src/main/daemonConnection.ts` → `loadDialConfig`'s `buildClientHello` capabilities list; `DaemonConnection.toggleMcpServer` and its body; `MAX_PENDING_MCP_TOGGLES`; `pendingMcpToggles`; the toggle-refusal match in the `daemon-error` arm; the per-dial reset block that clears the pending maps.
- `src/main/daemonConnection.test.ts` → the `advertises the interactive and multi_agent capabilities` test, which pins the hello list and must gain the third entry; the `toggleMcpServer (#1586)` describe the new tests mirror.
- `src/main/connectionRegistry.ts` → the delegating `DaemonConnection`; `src/main/connectionRegistry.test.ts` → its full fake, which must gain the method to typecheck.
- `src/main/index.ts` → the `'toggleMcpServer'` case, routed by conversation through `router.route`.
- `src/renderer/src/store/{daemonEventBridge,modalBridge,questionBridge,timelineBridge}.ts` → the `case 'mcpToggleRejected'` arms in each `assertNever` switch.
- `e2e/real-daemon-multi-agent.spec.ts` `ADVERTISED` and `e2e/fixtures/daemonCapabilityGate.ts` → a probe's own advertise list, not the app's hello, so they do not change.

Overlap: `feature/1726` (Send now on a queued message) adds a sibling verb to the same seven files, and `feature/1544` touches `daemonConnection.ts`. Neither is a dependency; edits here are additive, so a later merge may touch those files.

## Design source

N/A. Transport and IPC only. Nothing in the window renders the new event yet; the Stop task button is a separate ticket.

## Context

The daemon accepts a per-task stop (pyrycode#2796) and advertises it (pyrycode#2797); contract in pyrycode `docs/protocol-mobile.md` § Stop background task (v2). This ticket lays the send path and the refusal event so the button ticket builds on something that already works. No ADR, no decode change: as with #1586, the refusal match reads only `inReplyTo`.

## Design

### Hello

`types.ts`: `export const CAPABILITY_STOP_BACKGROUND_TASK = 'stop_background_task' as const`. `loadDialConfig` advertises `[CAPABILITY_INTERACTIVE, CAPABILITY_MULTI_AGENT, CAPABILITY_STOP_BACKGROUND_TASK]`. The echo already reaches the window on `connected`'s ack; nothing reads it yet.

### Outbound

- `types.ts`: `'stop_background_task'` added to `EnvelopeType` after `'mcp_toggle'`; `export interface StopBackgroundTaskPayload { conversation_id: string; task_id: string }`.
- `commands.ts`: `| { type: 'stopBackgroundTask'; payload: StopBackgroundTaskPayload }`. `isStopBackgroundTaskPayload` requires a non-null object with both fields present, strings and non-empty. Unlike the MCP guards, empty is refused: the ticket requires it, and the daemon refuses an empty id anyway.
- New `src/main/transport/stopBackgroundTaskEnvelope.ts`: `buildStopBackgroundTask({ id, ts, conversationId, taskId }): Uint8Array`, a fresh two-field payload so extra renderer fields never reach the wire.
- `DaemonConnection.stopBackgroundTask(conversationId: string, taskId: string): void`: `toggleMcpServer`'s body. Own map `pendingBackgroundTaskStops: Map<number, { conversationId: string; taskId: string }>`, cap `MAX_PENDING_BACKGROUND_TASK_STOPS` = 32, oldest evicted, recorded after the send. Log events with fixed names only: `background-task-stop-refused`/`unavailable`, `background-task-stop-sent`, `background-task-stop-failed`/`build-or-send-failed`.
- `connectionRegistry`: one delegate. `index.ts`: a `'stopBackgroundTask'` case, `router.route(id)?.stopBackgroundTask(id, command.payload.task_id)`.

### The refusal

- `events.ts`: `{ type: 'backgroundTaskStopRejected'; conversationId: string; taskId: string }`. No code, message or `in_reply_to`.
- `daemon-error` arm: a match after the toggle one, `pendingBackgroundTaskStops.get(inReplyTo)`. On a hit: delete, log `background-task-stop-rejected`, emit the event built from the recorded entry only, return. It never reads `inbound.outcome`, so the documented `stop_background_task.refused`, an unknown code and an unreadable payload all settle the same way. A second error at the same id finds no entry and falls through to the existing handling, which emits no refusal event.
- The per-dial reset block gains `pendingBackgroundTaskStops.clear()`.
- The four bridges get `case 'backgroundTaskStopRejected':` beside `case 'mcpToggleRejected':`.

## State + concurrency model

One new per-connection map in main, created only after a successful send, removed by a correlated `error`, by eviction past 32, or by the next dial. An accepted stop gets no reply, so entries for accepted stops sit until evicted or the next dial; that is why the map is bounded. Synchronous; no timers, no retries.

## Error handling

| Failure | Result |
|---|---|
| Malformed command (a field missing, not a string, or empty) | `isRendererCommand` rejects it; main's switch never sees it |
| Unknown or unrouted conversation | `router.route` returns `null`, nothing sent |
| Not connected or not authenticated | refused log, nothing sent, no throw |
| Build or send throws | caught, content-free log, no entry, no retry |
| No reply (accepted, or daemon cannot act) | nothing happens |
| Correlated `error`, any code or none | one `backgroundTaskStopRejected` with the recorded ids |
| Uncorrelated, repeated or stale `error` | existing handling, unchanged |

## Testing strategy

Unit tests only; nothing in the window is driven.

- `stopBackgroundTaskEnvelope.test.ts`: `it.each` over awkward strings; type, id, ts and exactly the two payload fields, extras dropped, compared byte-exact against a hand-built `encodeEnvelope` of the expected frame.
- `commands.test.ts`: accepts non-empty strings with extras; rejects missing/non-object payload, missing, `null`, numeric and empty `conversation_id` or `task_id`; a `@ts-expect-error` block for a bare command and a missing `task_id`.
- `daemonConnection.test.ts`:
  - The hello test now expects `['interactive', 'multi_agent', 'stop_background_task']`.
  - New describe: one frame with the exact payload, nothing re-sent over 60 s of fake timers; inert before start, unauthenticated and after stop with no ids in logs; a send failure caught, not retried, and a later error at that id emits nothing; `it.each` over `stop_background_task.refused`, an unknown code and a non-string code → exactly one `{ type: 'backgroundTaskStopRejected', conversationId: 'conv-42', taskId: 'task-7' }` even when the error carries a different `conversation_id` and a `task_id`; ids, the daemon message and the reflected conversation never in logs; an uncorrelated error and a second error at the same id emit nothing; the 33rd stop evicts the oldest; a new dial clears outstanding entries; routing through `onCommand` with `createConversationRouter` strips extras and refuses an empty id and unknown hosts.
- `connectionRegistry.test.ts`: the delegate forwards both arguments only to the named host.
- Bridges: `npm run build` proves the exhaustive switches.

## Open Questions

- None blocking. Names: `CAPABILITY_STOP_BACKGROUND_TASK`, `StopBackgroundTaskPayload`, `buildStopBackgroundTask`, `stopBackgroundTask` (command and method), `backgroundTaskStopRejected`.

## Documentation handoff

The ticket has no Documentation handoff section. Pending for the documentation stage: fold the `stop_background_task` send, its capability and its refusal into `docs/knowledge/features/daemon-connection-correlation-system-prompt-and-mcp.md` beside the `mcp_toggle` entry.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. Renderer to main: the `stopBackgroundTask` arm of `isRendererCommand` requires both ids present, strings and non-empty, so a renderer cannot send a blank or non-string id; `buildStopBackgroundTask` rebuilds a fresh two-field payload, so a smuggled `serverId` or `token` never reaches the wire; `router.route` refuses a conversation no host claims. Daemon to main: the refusal match reads only `inReplyTo`. Both event fields come from `pendingBackgroundTaskStops`, so a hostile daemon cannot make a refusal name a conversation or task this app did not try to stop, and it cannot settle an MCP toggle or reconnect as a stop refusal or the reverse, because each verb has its own map and ids come from one sequence.
- [Untrusted ids] No findings, by design. Both ids are opaque daemon strings. They are builder arguments and the stored values of a map keyed by envelope number, never a map key, a log field, a path, a URL or markup. Tests assert neither appears in logs.
- [Tokens] No findings. No credential is created, read or carried.
- [File / storage] No findings. Nothing touches disk.
- [Electron attack surface] SHOULD FIX, folded into the design. A compromised renderer could fire stops in a loop, and an accepted stop gets no reply that would consume its entry, so the map is capped at 32 with oldest-first eviction. The renderer could already send any typed command, and the daemon decides whether each stop is allowed, so this adds no new capability. No new bridge API; the command rides the existing `sendCommand` channel.
- [Crypto] No findings. The frame goes through the existing Noise session via `driver.sendMessage`.
- [Network & I/O] No findings. Nothing is retried after a send failure, a missing reply or a refusal, so a silent or hostile daemon cannot induce a request loop. Inbound frames stay bounded by the existing `MAX_PLAINTEXT_BYTES` guard. Advertising the capability only widens what the daemon may accept from this client, and a daemon without the verb drops it from the echo.
- [Logs] No findings. Event names are static and `code` is a client-owned literal or absent. The daemon's code and message, the reflected `conversation_id`, both ids and the caught exception are all dropped.
- [Concurrency] No findings. Synchronous in main; the entry is recorded after the send; the per-dial reset clears the map, so a recycled envelope id cannot settle against a dead connection.
- [Threat model] OUT OF SCOPE: presenting the refusal, re-enabling the row and the live stop-and-refuse round-trip belong to the Stop task button ticket split from #1753.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05
