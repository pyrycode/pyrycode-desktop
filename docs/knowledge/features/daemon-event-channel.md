# Daemon-event channel

The typed **event pipe** from the background process to the renderer window: a sealed `DaemonEvent` union, a single background emit helper, and a receive-only preload subscription on `window.pyry`. It is how the Noise transport (which lives in the background process — see [ADR 0001](../decisions/0001-stack-electron-react-typescript.md)) will hand **already-typed, already-validated** events to the React window without the renderer ever holding a socket, key, or raw frame.

Introduced in [#18](../codebase/18.md). It is the **event-pipe half** of the background↔window bridge; the mirror-image **command half** (renderer→main) is the [command channel](command-channel.md) (#17, now shipped). No transport is wired yet — this ticket builds the emit *seam* that #10 (hello/hello-ack) and #12 (render reply) will call. The receive end is now consumed: [#19](../codebase/19.md) maps each `DaemonEvent` onto the [session store](session-store.md)'s `SessionAction` — see the [daemon-event bridge](daemon-event-bridge.md) feature doc.

[#168](../codebase/168.md) added the union's first members with **no** `SessionAction` counterpart: `debugBundleProgress` / `debugBundleSaved` / `debugBundleFailed`, consumed by the download UI ([#72](https://github.com/pyrycode/pyrycode-desktop/issues/72)) rather than the session store. The 1:1 `DaemonEvent`↔`SessionAction` correspondence #19 relied on was a convenience, not a guarantee — see below.

[#180](../codebase/180.md) added a fourth no-`SessionAction` member, `snapshotReceived` — the [screen
snapshot fetch](screen-snapshot-fetch.md) feature's reply, consumed by the [Run configuration
store](run-config-store.md)'s data path ([#187](../codebase/187.md)) instead of the session store.
[#191](../codebase/191.md) extended that member with two more always-present fields,
`used_tokens`/`window_tokens` (pyrycode/pyrycode#857) — the context-window usage figures the render
sibling [#192](https://github.com/pyrycode/pyrycode-desktop/issues/192) consumed. **Both `snapshotReceived`
and its `screenSnapshotReceived` sibling (below) are removed as of [#621](../codebase/621.md)** — the
run-config store moved onto the dedicated `runConfigReceived` reply at #491/#500, leaving
`snapshotReceived` unconsumed, and `screenSnapshotReceived` never outlived its dormancy past #619. Kept
in this doc's history below for context; neither is a current `DaemonEvent` member.

[#199](../codebase/199.md) added a fifth and sixth no-`SessionAction` member, `assistantDelta` /
`turnEnd` — the transport slice (L1) of the structured-stream render vertical, consumed by the
renderer timeline bridge [#202](../codebase/202.md) will build over the [thread
timeline](thread-timeline.md) model, not the session store. Unlike every member above,
`assistantDelta.text` deliberately **carries content across the bridge rather than minimising it** —
see below.

[#139](../codebase/139.md) added a seventh no-`SessionAction` member, `conversationsReceived` — the
[conversation list fetch](conversation-list-fetch.md) feature's reply, reusing the wire
`ConversationSummary[]` row type verbatim (snake_case, order preserved from the wire). Like
`assistantDelta`/`turnEnd`, nothing is dropped (no field is a secret) — but like `snapshotReceived`,
it's a fire-and-forget request/reply, not a streamed delta. Consumed by the conversation-list store
[#208](https://github.com/pyrycode/pyrycode-desktop/issues/208) (blocked on this), not the session
store.

[#214](../codebase/214.md) added an eighth no-`SessionAction` member, `turnState` — the coarse
turn-lifecycle scalar of the same v2 interactive stream `assistantDelta`/`turnEnd` belong to. Carries
only `state` (a closed 3-value `WireTurnState`); `conversation_id` is dropped at the emit. Consumed by
the [conversation timeline store](conversation-timeline-store.md)'s bridge — the third arm that bridge
owns — driving `phase`, not `items`; the session bridge still maps it to `null`.

[#217](../codebase/217.md) added a ninth no-`SessionAction` member, `toolUse` — the tool-call
enrichment of the same v2 interactive stream. Carries four camelCase fields (`turnId`, `toolUseId`,
`name`, `inputSummary`, all plain strings, no enum); `conversation_id` is dropped at the emit. Consumed
by the [conversation timeline store](conversation-timeline-store.md)'s bridge — the fourth arm that
bridge owns, and the first whose mapping produces a durable `ThreadItem` (a `toolCall`) rather than text
or a scalar. `name`/`inputSummary` are opaque daemon display text the render slice
([#218](https://github.com/pyrycode/pyrycode-desktop/issues/218)) must render as plain text.

[#642](../codebase/642.md) widened this member — no new member, one field added — with a fifth,
**optional** field: `input?: Readonly<Record<string, string>>`, the tool's own input fields as name →
value (pyrycode#1678). Assigned unconditionally at the emit, `undefined` when the wire omitted it (a
pre-#1678 daemon) — the consumer contract is `event.input === undefined`, never `'input' in event`.
An empty map is a distinct fact ("this daemon sent no fields for this call") never collapsed into
absence. Both keys and values are untrusted daemon display text under the same plain-text-never-HTML
constraint as `name`/`inputSummary`; the three reserved keys `__proto__`/`constructor`/`prototype` can
never appear (dropped at decode), so a consumer must iterate, never probe by key. Ships dormant; still
consumed by neither existing bridge — #643 is the first.

[#201](../codebase/201.md) added a tenth and eleventh no-`SessionAction` member, `modalShown` /
`modalDismissed` — the transport slice of the modal vertical ([ADR
0009](../decisions/0009-modal-prompt-model.md)), consumed by **neither** existing bridge; the real
consumer is the third, independent [modal store + bridge](modal-store-bridge.md), shipped in
[#223](../codebase/223.md). `modalShown` carries `class` (a closed
`WireModalClass`), `title`/`prompt` (untrusted `claude`-surfaced free text), an ordered
`options: readonly WireModalOption[]`, and `defaultOptionId`; `modalDismissed` carries `outcome`
(opaque) and `source` (a closed `WireModalSource`). At ship time **neither arm dropped a
`conversation_id`** — the wire payload carried one on neither frame; `modalId` was the sole
correlation key (a one-time nonce, ADR 0009).

[pyrycode#1065](https://github.com/pyrycode/pyrycode/issues/1065) put `conversation_id` on the
`modal_shown` frame only — `modal_dismissed` still carries none.
[#870](../codebase/870.md) decoded it in `parseModalShownPayload` but stopped there, and
[#871](../codebase/871.md) carried it the rest of the way, widening this arm with a required
`conversationId: string`, copied by name from the already-validated payload, read bare (the decode
already guarantees it, so no `?? ''` fallback). It is the tenth arm in the `#675` family — after
`turnState`/`stallDetected`/`apiRetry`/`compacting`/`assistantDelta`/`turnEnd`/`toolUse`/
`toolResult`/`unrecognizedMessage` — and, like the rest of that family, an **outbound scoping key
only**: `modalId` remains the sole correlation key for *answering* a prompt, unchanged. It shipped
dormant against this arm — [`translateModalEvent`](modal-store-bridge.md) rebuilt a fresh `ModalEvent`
literal and did not forward it — until [#877](../codebase/877.md) copied it by name onto `ModalEvent`'s
`shown` arm, and [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) carried it the rest of
the way onto the held `ModalPrompt`, where `selectHasOutstandingFor` reads it. `modalDismissed` is
unaffected and still carries no `conversation_id`.

[#229](../codebase/229.md) added a twelfth no-`SessionAction` member, `toolResult` — the outcome half of
`toolUse` (#217), the vertical's last transport slice. Carries four camelCase fields (`turnId`,
`toolUseId`, `isError`, `resultSummary`); `conversation_id` is dropped at the emit, like `toolUse`.
Consumed by the [conversation timeline store](conversation-timeline-store.md)'s bridge — the fifth arm
that bridge owns, and the first whose mapping **resolves** an existing `ThreadItem` (a `toolCall`'s
`result`, via `fillResult`, #121) rather than appending one or setting a scalar. `isError` is a boolean,
not attacker text; `resultSummary` is opaque daemon display text the render slice
([#230](https://github.com/pyrycode/pyrycode-desktop/issues/230)) must render as plain text.

[#773](../codebase/773.md) widened this member — no new member, one field added — with a sixth,
**optional** field: `resultDetail?: string`, the daemon's short précis of a tool's structured outcome
(pyrycode#2024, e.g. `"265 lines"`, `"110 of 1676 lines"`). Assigned unconditionally at the emit,
`undefined` when the wire omitted it — the consumer contract is `event.resultDetail === undefined`,
never `'resultDetail' in event`, `input`'s (#642) exact posture. Per the upstream contract the field
carries no `omitempty`, so absence here means only a daemon predating pyrycode#2024; an empty string is
a value in its own right and is never collapsed into absence. Unlike `input`, this field carries no
daemon-chosen keys to police — a scalar has none of that surface, so decode and this emit landed in one
ticket rather than split like #642/#643. Unit words and interior spaces are part of the value on purpose
(a client cannot tell a read from a search without switching on tool name); nothing on this path parses,
trims, or extracts a number from it. Ships dormant; consumed by the same [conversation timeline
store](conversation-timeline-store.md) bridge that already owns `toolResult` — the render slice is
[#856](https://github.com/pyrycode/pyrycode-desktop/issues/856).

[#241](../codebase/241.md) added a thirteenth no-`SessionAction` member, `conversationCreated` — the
[conversation create](conversation-create.md) feature's reply, the write-side twin of
`conversationsReceived` (#139). Reuses the wire `ConversationCreatedPayload` verbatim (its own 5-field
shape, **not** `ConversationSummary`) — nothing to drop, no secret field. Consumed by neither existing
bridge; the real consumer is the render sibling [#242](https://github.com/pyrycode/pyrycode-desktop/issues/242)
(blocked on this ticket), which must render `name`/`cwd` as plain text, never HTML — the doc-comment
on this arm carries that warning forward since this ticket has no DOM sink of its own.

[#316](../codebase/316.md) added a nineteenth no-`SessionAction` member, `screenSnapshotReceived` — a
**deliberate widening**, the opposite move from every content-minimised member above. It carried the
rendered-screen `text` (and its `ts`) that `snapshotReceived` ([#180](../codebase/180.md)) deliberately
dropped, once the display slice [#324](../codebase/324.md) needed it. Emitted from the **same**
`case 'snapshot'` seam as `snapshotReceived` — one decoded `screen_snapshot` frame fired both
events, each a fresh named-field literal bounding its own two/five fields. Consumed by neither
existing bridge; `screenSnapshotReceived` was held by the [screen-snapshot store](screen-snapshot-store.md)'s
observer (#323), whose sole reader, #324's `ScreenSnapshotControl`, was removed by
[#618](../codebase/618.md), and the store and bridge themselves by [#619](../codebase/619.md) — the
event kept firing into zero subscribers regardless, until
**[#621](../codebase/621.md) removed the member itself**, along with `snapshotReceived` and the
`case 'snapshot'` emit that produced both. See [screen snapshot fetch](screen-snapshot-fetch.md) for
the full data-flow history.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [The sealed union](daemon-event-channel-sealed-union.md) — The event union itself: every arm the main process can emit to the renderer, and the rules that keep the switch over them exhaustive.
- [Emit and subscribe](daemon-event-channel-plumbing.md) — The two ends of the channel: the helper the main process emits through, the preload subscription the renderer listens on, and the flow between them.

## What it does

Gives the background process **one typed function** to emit a sealed daemon-event to the window, and gives the renderer **one typed function** to subscribe to those events. Every event travels on a single IPC channel; the union carries only wire payload types, so no token, key, or raw byte can cross the bridge.

Since #1068, every event carries `serverId: string | null` — the id of the paired server it came from,
or `null` where no paired record was in hand when the emitter was bound. This rides beside the union
(`StampedDaemonEvent = DaemonEvent & { serverId }`) rather than inside it, so the 42 arms below are
unchanged; see [Emit and subscribe](daemon-event-channel-plumbing.md) for `bindServerOrigin` and the
full design. The production registry binds each connection to its saved host.
The [chat-history observer](chat-history.md#received-state-admission-and-ownership)
captures this origin during synchronous store updates so buffered content cannot
move to whichever host is active when its save runs.

## How it works

Three pieces, three layers:

| Piece | File | Layer |
|---|---|---|
| `DaemonEvent` union + `DAEMON_EVENT_CHANNEL` | `src/shared/ipc/events.ts` | shared |
| `emitDaemonEvent(sink, event)` | `src/main/emitDaemonEvent.ts` | background |
| `window.pyry.onDaemonEvent(listener)` | `src/preload/index.ts` | preload bridge |

`src/shared/ipc/` is the new IPC-contract module, mirroring how `src/shared/wire/` is the wire module. #18 creates one file in it; #17 later adds its command file (recommended: a sibling `commands.ts` with its own `COMMAND_CHANNEL`, so the two tickets never edit the same file).

### Run-configuration report

`runConfigReceived.effectiveEffort?: string | null` carries the daemon's confirmed
applied-effort report; `effort` remains the saved choice. The
[decoder](inbound-message-decode.md#optional-effective-effort-report) preserves
unavailable as `undefined`, explicit `null` as no effort parameter, and every string
verbatim. The named-field projection always assigns `effectiveEffort`, so check
`=== undefined`, not property presence or truthiness. Empty strings remain values.

The report passes the existing [request-correlation gate](daemon-connection-correlation-requests.md#run-configuration-read-attribution-correlation-1176):
`conversationId` comes from the pending request and `serverId` from the connection's
origin stamp, never payload keys. Out-of-order replies retain those identities;
missing/unmatched correlations, duplicates and abandoned replies after reconnect
emit nothing. Malformed reports fail decoding before consuming the pending request,
allowing a subsequent valid reply to match it.

This is untrusted display text, never a control input, raw markup, attribute, URL,
path, cache key or log value. Receiving it sends no settings write and must not
replace the remembered choice. Carriage currently ends at IPC; renderer snapshots,
footer selection and remembered-choice handling belong to
[#1549](https://github.com/pyrycode/pyrycode-desktop/issues/1549).

`runConfigReceived` also carries three flat optional booleans —
`slashCommands`, `mcpServers`, `contextUsageDetail` (pyrycode#2670, decoded at
[inbound message decode](inbound-message-decode.md#optional-session-capability-flags),
\#1654) — the daemon's own statement of which Claude-only features the resolved
session answers: true for Claude, false for Codex. `undefined` means not reported
(no `capabilities` on the reply, or a daemon predating the flags), distinct from
`false`; check `=== undefined`, the same posture as `effectiveEffort` above. Each
is copied by name from `inbound.sessionSettings.capabilities?.<flag>` — flat
rather than nested, so there is no partially-populated `capabilities` object for a
consumer to interpret. This is a statement of support, not a permission: the
daemon re-checks every request regardless of what these flags say. Ships dormant —
this app doesn't advertise `multi_agent` yet, so the flags won't arrive in
production until it does; [#1655](https://github.com/pyrycode/pyrycode-desktop/issues/1655)
is the first consumer.

`runConfigReceived.memorySearch?` carries the optional
[daemon memory-search report](inbound-message-decode.md#optional-memory-search-report)
by name from decoded `memory_search`. It retains aggregate availability and each
provider's `id`, `display_name`, `installed`, `enabled` and availability; `false`
flags and an empty provider array survive. An omitted report is `undefined` (no
reading), while a malformed or future report is a present whole-report
`{ availability: 'unknown', providers: [] }`. Neither an empty array nor missing
data establishes absence. This descriptive status adds no client command.

The existing pending `in_reply_to` request gate applies to this report too:
`conversationId` is the requesting conversation and `serverId` the connection's
host stamp. Out-of-order replies keep their own identities; unmatched, duplicate
and abandoned replies emit no `runConfigReceived`. Carriage ends at the event;
renderer storage and presentation belong to
[#1687](https://github.com/pyrycode/pyrycode-desktop/issues/1687).

### Stopped-turn metadata

Both `DaemonEvent.turnEnd` and `HistoryTimelineEvent.turnEnd` carry optional
`outcome?: string`, `isError?: boolean`, `terminalReason?: string` and
`errorCategory?: string`. The [wire parser](inbound-message-decode.md#optional-stopped-turn-reports)
checks types and the 256-byte UTF-8 string bound before either lane crosses IPC.
Named-field forwarding preserves false and empty strings; test absence with
`=== undefined`, not property presence or truthiness. These open strings are
display reports, consumed by the [timeline](thread-timeline-internals.md#stopped-turn-state),
never command text, attributes, URLs or logs.

### Model-refusal metadata

`ModelRefusalEvent` discriminates `modelRefusalFallback` (with `fallbackModel` and
open-string `scope`) from `modelRefusalNoFallback`. Both carry `originalModel`,
`refusalCategory`, `banner`, and nullable string-array `truncatedFields`/`droppedFields`.
Live `DaemonEvent` adds `conversationId` and optional `daemonTs`; `HistoryTimelineEvent`
uses the common shape without per-entry conversation identity. See [routing and lifetime](conversation-timeline-store.md#refusal-records-and-routing).
Validated shape does not confer authority on Claude's prose: rendering bounds and
escapes it, category remains inert, and no refusal frame changes model-label authority.

## Configuration and usage

- **Import from `src/main` / `src/preload`** by **relative path**: `import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'`. These sides have **no `@shared` alias** (it exists only in `tsconfig.web.json` / the renderer vite block); `@shared/ipc/events` fails the node typecheck and the main/preload build there.
- **Import from `src/renderer` (#19)** by alias: `import { type DaemonEvent } from '@shared/ipc/events'`, which resolves. Test files (vitest) may also use `@shared/...` regardless of side — vitest aliases it in `vitest.config.ts`.
- **Emitter (#10/#12):** `emitDaemonEvent(live.sink, event)` per event built from a validated envelope
  — `live.sink` since [#519](../codebase/519.md) (previously a captured `mainWindow`).
- **Subscriber (#19/#12):** `const off = window.pyry.onDaemonEvent(cb)`; call `off()` in a `useEffect` cleanup so listeners don't accumulate across remounts.

## Edge cases and limitations

- **Destroyed-window guard — closed by [#518](../codebase/518.md).** #18 deliberately deferred this (no live emitter to observe it at the time). Once the window was wired, closing it on macOS left the connection emitting into a destroyed `BrowserWindow` with nothing catching the throw. `emitDaemonEvent` now drops the event and returns on a destroyed sink instead of propagating.
- **Reaching a dock-reopened window — closed by [#519](../codebase/519.md).** #518's guard made a stale sink safe, not working: a captured `mainWindow` still pointed at the destroyed original after a reopen, so every event was dropped forever. The [live-window](live-window.md) holder's `sink` re-attaches to whichever window is current and additionally replays the last connection-status event into a freshly loaded window, so a reopened window converges on the live connection instead of sitting at `disconnected`.
- **Renderer-side cleanup is the subscriber's job.** `onDaemonEvent` returns the unsubscribe; #18 does not build the `useEffect` teardown that calls it. [#19](../codebase/19.md)'s `useDaemonEventBridge` now owns that teardown (returns the handle as effect cleanup — StrictMode-safe).
- **No runtime shape validation at the preload.** The producer is our own trusted main process; a `zod`-style validator would add a dependency to defend against a bug, not an attacker (a compromised main process is already game-over). Revisit only if a less-trusted producer ever sends on this channel.
- **`connected.ack` carries the whole `HelloAckPayload`.** Narrow to `{ server_id, conn_id }` later only if #19/#12 prove the UI needs less — mirrors [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)'s deferral.
- **The three debug-bundle members now have a real producer.** [#168](../codebase/168.md) declared them inert; the [debug-bundle orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md)) now calls `emitDaemonEvent` with `debugBundleProgress`/`debugBundleSaved`/`debugBundleFailed` from the composition root.
- **`snapshotReceived` had a real producer from the start, until #621 removed it.** [#180](../codebase/180.md) wired `emitDaemonEvent` for it directly from `daemonConnection.ts`'s inbound `case 'snapshot'` arm, the same choke point as `screenSnapshotReceived` below — no separate orchestrator, unlike the debug-bundle members. [#621](../codebase/621.md) deleted that whole `case` block, taking both members' emits with it.
- **`assistantDelta`/`turnEnd` had a real producer but no traffic through #178.** [#199](../codebase/199.md) wired `emitDaemonEvent` for both from the same `case 'message'` choke point; the daemon sent neither until [#179](../codebase/179.md) advertised the `interactive` capability — a Strangler-Fig decode path with a real emitter and zero live callers until then, proven only by unit tests driving `daemonConnection` directly. Now live.
- **`conversationsReceived` has a real producer, but no request trigger yet in this ticket.** [#139](../codebase/139.md) wires `emitDaemonEvent` for it from the same `case 'message'` choke point, and also adds the outbound `requestConversations` [command](command-channel.md) — but nothing calls `sendCommand({type:'requestConversations'})` until [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208)'s store fires it on connect. Unlike `assistantDelta`/`turnEnd` (blocked on a daemon capability flip), this is blocked only on the sibling ticket landing.
- **`turnState` had a real producer but no traffic through #178 — same capability gate as `assistantDelta`/`turnEnd`.** [#214](../codebase/214.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectPhase` a real source for the first time; no `turn_state` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly, and by the timeline store's own no-churn round-trip test, until then. Now live.
- **`stallDetected` had a real producer but no traffic through #178 — same capability gate, and at ship time it was the only member whose emit carried no decoded field at all.** [#315](../codebase/315.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point; no `stall` frame reached it until [#179](../codebase/179.md) flipped `interactive`. `StallPayload`'s one field (`conversation_id`) was dropped at the time, so the literal `{ type: 'stallDetected' }` carried nothing to prove wrong — proven only by a round-trip test asserting exactly one event fires and the serialized event log never contains the planted conversation id. Now live and rendered — the timeline store's bridge claimed it as an owned arm in #317. [#732](../codebase/732.md) widened the emit to carry `conversationId`, copied by name from the decoded payload; the round-trip test's leak guard inverted from `not.toContain` to `toContain` to match.
- **`apiRetry` is `stallDetected`'s peer, but non-nullary and reachable today (`interactive` is already advertised).** [#492](../codebase/492.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, a fresh `{ type: 'apiRetry', active, current, total }` literal copied by name from the decoded `ApiRetryPayload` (never a spread) with `conversation_id` dropped. Unlike `stall`, the daemon frame is **not** onset-only (an explicit `active: false` falling edge) and **not** deduped (the rising edge re-fires as the count climbs) — the dispatch is deliberately stateless, so N daemon frames produce N events with no coalescing. Proven only by a round-trip test asserting the exact emitted-event sequence and that the serialized event log never contains the planted conversation id. Now live and rendered — the timeline store's bridge claimed it as a seventh owned arm in #493.
- **Compaction status and metadata cross as separate events.** Main copies named
  fields into `compacting{conversationId, active, compactResult?, compactError?, daemonTs}`
  and `compactionBoundary{conversationId, trigger, preTokens?, postTokens?}`. The
  [decoder](inbound-message-decode-contract.md) validates outcomes and counts before
  IPC. Both live events route to the addressed timeline; the session, modal and
  question bridges return `null`. Emission stays stateless, one event per valid
  frame; edge idempotence and delayed association belong to the
  [timeline reducer](conversation-timeline-store.md#what-it-does). History's existing
  `compacting` event also carries outcomes, but has no boundary-metadata counterpart.
- **`toolUse` had a real producer but no traffic through #178 — same capability gate.** [#217](../codebase/217.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectItems` a real `toolCall` source for the first time; no `tool_use` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly, and by the reducer's existing text/tool/text split test, until then. Now live.
- **`modalShown`/`modalDismissed` had real producers but no traffic through #178 — same capability gate.** [#201](../codebase/201.md) wired `emitDaemonEvent` for both from the same `case 'message'` choke point; no `modal_shown`/`modal_dismissed` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Both `daemonEventBridge`/`timelineBridge` still discard the arms as `null`; the third, independent [modal store + bridge](modal-store-bridge.md) ([#223](../codebase/223.md), shipped) is the real consumer, mounted since [#224](../codebase/224.md). Proven only by unit tests driving `daemonConnection` and all three bridges directly, until #179. Now live and answerable end to end.
- **`toolResult` had a real producer but no traffic through #178 — same capability gate.** [#229](../codebase/229.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectItems` its first real *resolved* `toolCall`; no `tool_result` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly (the latter through a real `createTimelineStore()`), and by the reducer's existing `fillResult` correlation tests (#121), until then. Now live.
- **`queueState` is wired at the same `case 'message'` choke point as `toolUse`/`toolResult`, but its traffic is not known to be gated behind the `interactive` capability flip.** [#292](../codebase/292.md) added the emit from `daemonConnection.ts` directly, alongside `tool-use`/`tool-result`/`conversations`; unlike those turn-stream arms, `queue_state` is daemon **state** (#720) that can change independent of any turn being interactive, so — unlike the documented #178/#179 gate for `turnState`/`toolUse`/`toolResult`/`modalShown` — no capability precondition is asserted here. Proven only by unit tests driving `daemonConnection` and all three bridges directly; a live daemon `queue_state` frame has not yet been observed through #178.
- **`modalAnswerRejected` is correlated, not decoded.** [#248](../codebase/248.md) added a fifteenth member, `modalAnswerRejected{modalId}` — the only member built entirely from main-side memory rather than a wire field: the daemon `error` (#116) that follows a rejected `modal_answer` carries no `modal_id`, so `daemonConnection.ts` attributes it via a FIFO queue of its own outstanding answered ids (push-on-send, dequeue-on-error, drain-on-accept, reset-on-dial). Consumed by neither `daemonEventBridge` nor `timelineBridge` (both null it); the real, still-dormant owner is the [modal store + bridge](modal-store-bridge.md) — render lands in #249.
- **`screenSnapshotReceived` shared its producer's choke point with `snapshotReceived`, not a new one — and both were removed together.** [#316](../codebase/316.md) added the second `emitDaemonEvent` call inside the same `case 'snapshot'` block `snapshotReceived` already occupied — the first member to be emitted from an *existing* member's exact call site rather than a new `case` or a new orchestrator. Both fired on every `screen_snapshot` reply; `screen_snapshot` is always-available (ADR-025, not gated on `interactive` — see [screen snapshot fetch](screen-snapshot-fetch.md)), so unlike `assistantDelta`/`turnState`/`toolUse`, this member had live traffic from the moment #180 shipped the underlying request/reply, not gated behind [#179](../codebase/179.md). Sharing one choke point meant [#621](../codebase/621.md) removed both emits in the same deletion — there was no seam to split the removal on either.
- **`sessionSettingsRejected` is correlated by lookup, not by FIFO memory.** [#269](../codebase/269.md) added a seventeenth member, sharing the *same* `daemon-error` wire trigger as `modalAnswerRejected` above but a different attribution mechanism: unlike the FIFO (which cannot disambiguate two outstanding answers of the same kind and picks oldest-first), `daemon-error` here is looked up in `pendingSettings` by its own `Envelope.in_reply_to` — a precise per-request match, not a queue position. On a match this precedence gate **consumes the frame entirely**, skipping both the bundle reassembler and the `modalAnswerRejected` FIFO shift; on no match, both fire exactly as before #269. Consumed by none of the three existing bridges; the real consumer is the [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped), same as `sessionSettingsUpdated`.
- **`systemPromptWriteConfirmed`/`systemPromptWriteRejected` correlate a record this file's union had
  never correlated before: `conversationUpdated`.** [#1249](../codebase/1249.md) adds two members,
  reusing the reply to `set_system_prompt` (pyrycode#2151) — the *existing* `conversation_updated`
  broadcast for the confirm arm, and the *existing* `daemon-error` path for the reject arm, its **fifth**
  precedence-tier member (after `sessionSettingsRejected` above, `workspaceFolderRejected`, the
  debug-bundle reassembler, and the attachment-transfer reject correlation). Unlike
  `sessionSettingsRejected` above (looked up by a `Map` and then **consumes** the frame), the confirm
  half here is additive: `case 'conversation-updated':` keeps emitting the unconditional broadcast
  first, exactly as before this ticket — `conversationListBridge`'s live trigger — and only *then*
  checks `pendingSystemPromptWrites` for a match, emitting a **second**, separate event on a hit.
  Consuming the frame the way the reject half (and `sessionSettingsRejected`) does would have silently
  stopped the requester's own write from refreshing their own conversation row — the trap the ticket
  names explicitly and a mutation check confirms (reddens five tests). Both new members carry
  `conversationId` sourced from the correlation map's value, never from the ack record's own `id`
  field, keeping a hostile-or-confused daemon from misattributing the confirmation to the wrong
  conversation. See [System prompt write](system-prompt-write.md) for the full design and [Daemon
  connection — correlation § System-prompt write correlation
  (#1249)](daemon-connection-correlation-system-prompt-and-mcp.md#system-prompt-write-correlation-1249) for the correlation
  store. Ships dormant across all four exhaustive bridges (two arms each, eight total); the real
  consumer is #1250. **Not reflected in [the sealed union reference](daemon-event-channel-sealed-union.md)**
  — that file is at its 50000-byte cap with no heading structure to split at; `src/shared/ipc/events.ts`
  and this bullet are authoritative for these two members until it is split.
- **`thinkingProgress` is `modelAnnounced`'s shape peer, but a reading with no rising or falling
  edge.** [#1313](https://github.com/pyrycode/pyrycode-desktop/issues/1313) (decoded at
  [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)) wired `emitDaemonEvent` for it
  from `daemonConnection.ts`'s inbound switch, placed directly after `model-announced`; a fresh
  `{ type: 'thinkingProgress', estimatedTokens, conversationId }` literal copied by name from the
  decoded payload (never a spread), with `estimated_tokens_delta` the one field dropped — nothing
  consumes it, and the payload's own contract forbids summing it into a total. Like `apiRetry`/
  `compacting`, the emit is deliberately stateless: no dedup, no coalescing, no last-value memo — the
  wire re-fires as the count climbs and restarts near zero at every inference-request boundary, so a
  monotonic filter would eat legitimate traffic. Unlike either, it carries no `daemonTs`: the decode
  arm takes no `FrameTimestamp`, since a stored `thinking_progress` is still skipped and there is no
  served-page half to join against. Proven by a round-trip test asserting the exact emitted-event
  sequence (including a same-value repeat and a climb-then-restart sequence) and an exact
  `['conversationId','estimatedTokens','type']` key set. Ships dormant across all four exhaustive
  bridges — three permanently, `timelineBridge` dormantly — awaiting #1314.
- **`backgroundTaskProgress` is the background-task family's fourth frame — a running task is still
  working, and what it is doing right now.** [#1638](https://github.com/pyrycode/pyrycode-desktop/issues/1638)
  wired `emitDaemonEvent` from the same `case 'message'` choke point as `backgroundTaskStarted`/
  `backgroundTaskUpdated`/`backgroundTaskRoster` (see [Related](daemon-event-channel-related.md) for
  those three), a fresh nine-field literal copied by name from the decoded payload (never a spread),
  keeping `conversationId` for the same in-family reason (daemon state, no `turn_id`, opens/closes no
  turn). The wire's `description` — the task's *current activity*, e.g. "Reading alpha.txt" — crosses
  under the distinct name `currentActivity`, so a consumer can never join it with
  `backgroundTaskStarted.description` (the task's opening description, a different fact under the same
  wire name). The three counters (`totalTokens`, `toolUses`, `durationMs`) are claude's own readings,
  cumulative per task but not guaranteed monotonic, and cross exactly as received — no accumulation,
  diff or bound, the `thinkingProgress` posture. `truncatedFields: null` means nothing was cut, distinct
  from `[]`. Ships dormant across all four exhaustive bridges (`daemonEventBridge`, `modalBridge`,
  `questionBridge`, `timelineBridge` each no-op it) — `backgroundTaskRosterBridge` needed **no** change,
  since its switch already ends in `default: null` rather than an exhaustive `assertNever`; the ticket's
  own file list named it as a fifth bridge to touch, but the code disagreed. #1640 is the first consumer.

## Security posture

AC4 ("no key material, raw frames, or bytes cross the bridge") is **enforced by the type, not by convention.** The union references only `HelloAckPayload` / `ErrorPayload` / `MessagePayload` for its session-lifecycle members, none of which has a token, key, or raw-byte field. `QrPayload` (token, `server_static_pubkey`), `HelloClientPayload` (token), and `InnerFrameV2` (base64 `data`) are **not** members and must never become members — a developer cannot serialize a secret here because no member has a field to hold one. `MessagePayload.text` does cross (messages are displayed — that is the product, not a leak) and must not be logged. The channel is **receive-only** and exposes no `ipcRenderer`, so a compromised renderer gains no command capability toward the transport, keys, or socket through #18. The [#168](../codebase/168.md) debug-bundle members hold the same invariant with different carriers: `debugBundleProgress.chunksReceived` is a count, `debugBundleSaved.path` is a local filesystem path, `debugBundleFailed.reason` is the closed `DebugBundleFailure` enum — never a token, key, raw frame, or bundle bytes. The closed enum is a deliberate information-minimisation boundary: a hostile daemon's raw error string cannot be assigned to `reason` (a `string` isn't a `DebugBundleFailure`), so the [orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md)) is structurally forced to map transport internals down to one of the three categories before they can reach the renderer. [#199](../codebase/199.md)'s `assistantDelta`/`turnEnd` are the one deliberate exception to "minimise what crosses": `assistantDelta.text` carries real assistant-reply content (the render payload, same category as `messageReceived.text`) — the AC5 invariant it still satisfies is narrower ("never a token/key/raw frame"), not "never any content."

> Pre-existing hardening note (out of scope for #18): `src/main/index.ts` sets `sandbox: false`. The whole bridge surface is `sandbox: true`-compatible; route the flip to a dedicated hardening ticket. (#17, the command half, also left it untouched — still open.)

## Related

See [Related documents](daemon-event-channel-related.md) for the full cross-reference list: every
sibling document, downstream consumer, and a short per-ticket note for each additive extension to
`DaemonEvent`, split out separately once the growing extension list pushed this document past the size
cap.
