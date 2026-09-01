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

## What it does

Gives the background process **one typed function** to emit a sealed daemon-event to the window, and gives the renderer **one typed function** to subscribe to those events. Every event travels on a single IPC channel; the union carries only wire payload types, so no token, key, or raw byte can cross the bridge.

## How it works

Three pieces, three layers:

| Piece | File | Layer |
|---|---|---|
| `DaemonEvent` union + `DAEMON_EVENT_CHANNEL` | `src/shared/ipc/events.ts` | shared |
| `emitDaemonEvent(sink, event)` | `src/main/emitDaemonEvent.ts` | background |
| `window.pyry.onDaemonEvent(listener)` | `src/preload/index.ts` | preload bridge |

`src/shared/ipc/` is the new IPC-contract module, mirroring how `src/shared/wire/` is the wire module. #18 creates one file in it; #17 later adds its command file (recommended: a sibling `commands.ts` with its own `COMMAND_CHANNEL`, so the two tickets never edit the same file).

### 1. The sealed union (`src/shared/ipc/events.ts`)

```ts
export type DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'

export const DAEMON_EVENT_CHANNEL = 'pyry:daemon-event' as const

export type DaemonEvent =
  | { type: 'connecting' }
  | { type: 'connected'; ack: HelloAckPayload }
  | { type: 'disconnected' }
  | { type: 'failed'; error: ErrorPayload }
  | { type: 'messageReceived'; message: MessagePayload }
  | { type: 'messagesReceived'; messages: readonly MessagePayload[] }
  | { type: 'debugBundleProgress'; chunksReceived: number }
  | { type: 'debugBundleSaved'; path: string }
  | { type: 'debugBundleFailed'; reason: DebugBundleFailure }
  | { type: 'runConfigReceived'; sessionId: string; model: string; effort: string; yolo: boolean
      ; used_tokens: number; window_tokens: number }
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'turnEnd'; turnId: string; stopReason: string }
  | { type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }
  | { type: 'turnState'; state: WireTurnState }
  | { type: 'stallDetected' }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string
      ; input?: Readonly<Record<string, string>> }
  | { type: 'modalShown'; conversationId: string; modalId: string; class: WireModalClass; title: string
      ; prompt: string; options: readonly WireModalOption[]; defaultOptionId: string }
  | { type: 'modalDismissed'; modalId: string; outcome: string; source: WireModalSource }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  | { type: 'queueState'; conversationId: string; queued: readonly QueuedItem[] }
  | { type: 'conversationCreated'; conversation: ConversationCreatedPayload }
  | { type: 'sessionTransition'; newSessionId: string; reason: WireSessionTransitionReason
      ; occurredAt: string; workspaceCwd: string | null }
  | { type: 'sessionSettingsUpdated'; sessionId: string; changeId: string }
  | { type: 'sessionSettingsRejected'; changeId: string }
```

`snapshotReceived` and `screenSnapshotReceived` — the two members that occupied this spot through
\#620 — are gone as of [#621](../codebase/621.md); `runConfigReceived` (added at #491, shown above at
its position between the debug-bundle members and `assistantDelta`) had already superseded
`snapshotReceived` as the run-config sheet's data source. See § History below the bullet list for what
the two removed members carried while they existed.

- **The six session-lifecycle members map 1:1 onto [session-store](session-store.md) `SessionAction` arms** — the four connection-lifecycle events plus a single-message event and a message-**batch** event. Member and field names mirror `SessionAction`'s (`ack`, `error`, `message`, `messages`) so #19's mapping is nearly an identity.
- **The three debug-bundle members ([#168](../codebase/168.md)) map to *no* `SessionAction`.** `debugBundleProgress{chunksReceived}` / `debugBundleSaved{path}` / `debugBundleFailed{reason}` are consumed by the download UI ([#72](https://github.com/pyrycode/pyrycode-desktop/issues/72)), not the session store — the [daemon-event bridge](daemon-event-bridge.md)'s `translateDaemonEvent` maps all three to `null` and the bridge skips the dispatch. `DebugBundleFailure` is a **coarse, closed** three-value category enum by design: the [debug-bundle orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md), landed) collapses the transport's finer 5-value `BundleFailReason` ([debug-bundle reassembly](debug-bundle-reassembly.md)) plus any save errno onto these three, so the renderer never learns transport internals. None of the three carries a token, key, raw frame, or bundle bytes — only a count, a local filesystem path, and a category.
- **`snapshotReceived{model,effort,yolo,used_tokens,window_tokens}`** ([#180](../codebase/180.md);
  extended with the two usage ints by [#191](../codebase/191.md); **removed [#621](../codebase/621.md)**)
  mapped to *no* `SessionAction`, consumed by the [Run configuration store](run-config-store.md)'s data
  path ([#187](../codebase/187.md)) until [#491/#500](run-config-store.md#moved-off-screen_snapshot-491500)
  moved that store onto the dedicated `runConfigReceived` reply instead, leaving this member
  unconsumed. It was a **dedicated minimal shape**, deliberately **not** a reuse of the wire
  `ScreenSnapshotPayload` it was derived from — that wire type also carried `text` (the rendered
  screen) and `ts`/`conversation_id`, none of which this member had a field for. See [screen snapshot
  fetch](screen-snapshot-fetch.md) for the load-bearing content-minimisation control this was, not an
  incidental narrowing, and for the full removal history.
- **`screenSnapshotReceived{text,ts}`** ([#316](../codebase/316.md); **removed [#621](../codebase/621.md)**)
  also mapped to *no* `SessionAction`, emitted from the **same** `case 'snapshot'` seam as
  `snapshotReceived` — one `screen_snapshot` frame fired both events. Unlike `snapshotReceived`, it
  was a **deliberate, security-reviewed widening**: it carried exactly the two fields
  `snapshotReceived` was built to exclude (`text`, the rendered daemon screen, and `ts`, its RFC3339
  timestamp), reversing #180's drop once a consumer existed (the display slice #324, split from #318
  via the [screen-snapshot store](screen-snapshot-store.md)'s #323). Like `assistantDelta`, `text` WAS
  the render payload and crossed IPC on purpose — the boundary defended upstream was the fail-closed
  decode (`parseScreenSnapshotPayload`, which still exists — only the emit was removed), not this
  internal channel. The emit was a **fresh named-field literal**
  (`{ text: inbound.snapshot.text, ts: inbound.snapshot.ts }`), never a spread of the decoded payload, so
  the widening was bounded to exactly these two fields. `text` was untrusted daemon-relayed content:
  #324 rendered it as plain text, never HTML — but #324 was itself removed by
  [#618](../codebase/618.md), and this member never gained another reader before #619 deleted the
  store that held it and #621 deleted the member itself.
- **`assistantDelta{turnId,seq,text}` / `turnEnd{turnId,stopReason}`** ([#199](../codebase/199.md))
  also map to *no* `SessionAction`, consumed instead by the renderer timeline bridge
  [#202](../codebase/202.md) will build. Field names are renamed from the wire's `snake_case`
  (`AssistantDeltaPayload`/`TurnEndPayload`) to camelCase here — the snake→camel rename happens at
  this consumer boundary, same as every other member. **Unlike `snapshotReceived`, these are
  deliberately *not* content-minimised**: `assistantDelta.text` is the assistant reply text the
  thread renders, carried across IPC on purpose (it is the product, not a leak), so it has a field to
  occupy rather than being dropped. Both members do drop `conversation_id` — the single field neither
  arm carries — since [#202](../codebase/202.md)'s bridge scopes identity for a single active
  conversation, the same assumption [session store](session-store.md) makes for `messageReceived`.
- **`conversationsReceived{conversations}`** ([#139](../codebase/139.md)) also maps to *no*
  `SessionAction`, consumed instead by the conversation-list store
  [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208) (blocked on this ticket). Unlike
  `snapshotReceived`, it reuses the wire row type **verbatim** (snake_case, `ConversationSummary[]`)
  rather than a hand-built minimal shape — there is no sensitive field to strip, so
  `parseConversationSummary`'s own decode-only-known-fields narrowing is the sole minimisation
  control. See [conversation list fetch](conversation-list-fetch.md).
- **`turnState{state}`** ([#214](../codebase/214.md)) also maps to *no* `SessionAction`, consumed
  instead by the [conversation timeline store](conversation-timeline-store.md)'s bridge — the
  `timelineBridge`'s third owned arm, alongside `assistantDelta`/`turnEnd`. `state` reuses
  `WireTurnState` verbatim (the wire's own closed enum, no re-declaration); `conversation_id` is the
  one field dropped, same reasoning as `assistantDelta`/`turnEnd`. Unlike those two, this member
  drives the timeline's scalar `phase`, not an appended `ThreadItem` — see [ADR
  0008](../decisions/0008-thread-timeline-model.md).
- **`stallDetected{conversationId}`** ([#315](../codebase/315.md)) also maps to *no* `SessionAction`,
  consumed instead by the [conversation timeline store](conversation-timeline-store.md)'s bridge — a
  sixth owned arm as of [#317](../codebase/317.md), which claimed it out of that bridge's own no-op
  list once the render consumer (`StallIndicator`) existed. At ship time, unlike every prior member,
  it was **nullary** — the wire `StallPayload`'s one field (`conversation_id`) was dropped at the
  emit, so the arm carried no field at all. [#732](../codebase/732.md) widened it to carry
  `conversationId` by name — a daemon-asserted routing key that reaches no sink and stops at the
  timeline bridge (`ThreadEvent.stallDetected` stays nullary), so zero decoded daemon *content* still
  crosses this bridge for a `stall` frame. The daemon's onset-only liveness signal: emitted once on
  the rising edge, never repeated, no "cleared" counterpart — the client self-clears on next turn
  activity, in `reduceTimeline`'s `stalled`-scalar arms ([#317](../codebase/317.md)).
- **`toolUse{turnId,toolUseId,name,inputSummary,input?}`** ([#217](../codebase/217.md), `input` added by
  [#642](../codebase/642.md)) also maps to *no* `SessionAction`, consumed instead by the [conversation
  timeline store](conversation-timeline-store.md)'s bridge — the `timelineBridge`'s fourth owned arm.
  Unlike `turnState`, this is the first arm to drive a real, durable `ThreadItem` (an appended
  `toolCall`, `result: null`) rather than a scalar or text delta — see [ADR
  0008](../decisions/0008-thread-timeline-model.md). `name`/`inputSummary` are opaque daemon-supplied
  strings (the `stop_reason` #199 / `cwd` #139 posture); `conversation_id` is the one field dropped.
  `input` is absent when the wire omitted it (a pre-pyrycode#1678 daemon), otherwise a string→string
  record with the three prototype-reserved keys already stripped at decode; ships dormant, #643 is the
  first consumer.

[#643](../codebase/643.md) is that first consumer: the `timelineBridge`'s `toolUse` arm now assigns
`input: event.input` onto its `ThreadEvent`, unconditional and by reference — the field crosses this
channel's IPC boundary the same way every other field in the arm does, with no new drop and no new
copy. Still no render — [#645](https://github.com/pyrycode/pyrycode-desktop/issues/645) owns that.
- **`modalShown{conversationId,modalId,class,title,prompt,options,defaultOptionId}` /
  `modalDismissed{modalId,outcome,source}`** ([#201](../codebase/201.md)) also map to *no*
  `SessionAction`, consumed instead by the **third**, independent
  [modal store + bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md) — the existing
  session bridge and [conversation timeline store](conversation-timeline-store.md) bridge both map
  these to `null`. Field names/types mirror `ModalEvent` ([#122](../codebase/122.md)) field-for-field
  (the snake→camel decode already happened here, at the transport) — so the #223 bridge is a filter +
  fresh-literal copy, not a rename, except for the discriminant tag itself (`modalShown`→
  `type: 'shown'`, `modalDismissed`→`type: 'dismissed'`), which does change. At ship time neither arm
  carried a `conversation_id` to drop — the wire payload had one on neither frame.
  [#871](../codebase/871.md) widened `modalShown` with it ([pyrycode#1065](https://github.com/pyrycode/pyrycode/issues/1065),
  decoded by [#870](../codebase/870.md)); `modalDismissed` still carries none. `modalId` remains the
  sole correlation key for *answering* a prompt — the new field is outbound scoping only. It rode as a
  no-op through the #223 bridge until [#877](../codebase/877.md) carried it onto `ModalEvent`'s `shown`
  arm, and [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) carried it a hop further onto
  the held `ModalPrompt`, where `selectHasOutstandingFor` reads it. `title`/`prompt`/`options[].label`
  are untrusted `claude`-surfaced free text the render slice
  ([#224](https://github.com/pyrycode/pyrycode-desktop/issues/224)) must render as plain text, never
  HTML.
- **`toolResult{turnId,toolUseId,isError,resultSummary}`** ([#229](../codebase/229.md)) also maps to *no*
  `SessionAction`, consumed instead by the [conversation timeline store](conversation-timeline-store.md)'s
  bridge — the `timelineBridge`'s fifth owned arm, and the vertical's last transport slice. Unlike
  `toolUse` (appends a `toolCall`), this is the first arm whose mapping **resolves** an existing
  `ThreadItem` in place — see [ADR 0008](../decisions/0008-thread-timeline-model.md). `isError` is a
  required boolean whose `false` is a value, decoded via `requireBoolean` (the `yolo` #180 idiom);
  `resultSummary` is opaque daemon-supplied display text (the `input_summary` #217 / `stop_reason` #199
  posture); `conversation_id` is the one field dropped.
- **`queueState{conversationId,queued}`** ([#292](../codebase/292.md)) also maps to *no* `SessionAction`,
  consumed by **none** of the three existing bridges — the real consumer is the [queue
  store](queue-store.md)'s own fourth, independent subscriber ([#293](../codebase/293.md)). Reuses the
  wire `QueuedItem` row type verbatim (the `conversationsReceived` precedent) — no
  snake→camel remap on the array items, order preserved from the wire (enqueue order). Unlike `turnState`/
  `toolUse`/`toolResult` (which drop `conversation_id`), this member **keeps** it as `conversationId`: the
  daemon SSOT (pyrycode #720) fixes `queue_state` as a **replacement-truth snapshot** of the whole current
  backlog, and the [queue store](queue-store.md) keys its held backlog by conversation id. This is also
  the first member the ticket's own architecture spec explicitly rules **out** of the timeline:
  `queue_state` is daemon *state*, not part of claude's turn stream (#720's own framing), so
  `timelineBridge` nulls it alongside `daemonEventBridge`/`modalBridge` rather than owning it as a sixth
  arm. `text` (per queued item) is untrusted, client-originated transit content the eventual render slice
  (#294) must render as plain text, never HTML — this ticket has no DOM sink of its own.
- **`sessionTransition{newSessionId}`**, shipped [#254](../codebase/254.md), also maps to *no*
  `SessionAction`, consumed instead by the [session-id store](session-id-store.md)'s holder
  ([#259](../codebase/259.md)). Originally a **content-minimised** shape over the **five**-field wire
  payload (`SessionTransitionPayload`): `previous_session_id` / `reason` / `occurred_at` /
  `workspace_cwd` were decoded and fail-closed validated at the transport boundary but dropped at the
  emit — only `new_session_id` crossed IPC, the `snapshotReceived` dedicated-minimal-shape precedent
  applied to a second field family. **Widened by [#285](../codebase/285.md)** to also carry `reason`
  (the closed `WireSessionTransitionReason` union, not a bare string — keeps the delimiter render
  slice's title switch exhaustive), `occurredAt` (opaque RFC3339Nano string), and `workspaceCwd`
  (`string | null`, wire nullability preserved) — the three fields the delimiter render slice
  ([#286](https://github.com/pyrycode/pyrycode-desktop/issues/286), consumes them) needs. Only
  `previous_session_id` is dropped now — it still has no consumer. `workspaceCwd` is an **untrusted
  daemon-supplied filesystem path**: #286 must render it as plain text, never through an HTML sink
  (the `conversationCreated`/`conversationUpdated` warning applied to a third field family). The
  existing consumer ([#259](../codebase/259.md)) reads only `newSessionId` and is unaffected by the
  widen — none of the three exhaustive bridges needed a new `case`, since a required-field widen on an
  existing arm doesn't force one. No `conversation_id` to drop — a session boundary is attributed by
  the connection it arrives on, not a wire field.
- **`sessionSettingsUpdated{sessionId, changeId}`** — introduced with only `sessionId` in
  [#264](../codebase/264.md), widened with `changeId` in [#261](../codebase/261.md). Maps to *no*
  `SessionAction`, consumed by **none** of the three existing bridges — its consumer is the
  [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped).
  Unlike `sessionTransition` (five decoded fields, four
  dropped), `sessionId` is minimal because its wire payload (`SessionSettingsUpdatedPayload`) has only the
  one field to begin with — the `set_session_settings` (#263) confirmation echoes no applied settings,
  only the addressing id. `changeId` is **not** a wire field: it's the renderer-minted correlation key
  #261's `pendingSettings` map echoes back after matching the reply's `Envelope.in_reply_to`. The event
  deliberately still carries **no `inReplyTo`** — that numeric routing id stays main-internal; widening an
  existing arm's fields is transparent to all three exhaustive bridges (they switch on `type`, not
  fields), so none needed a code change, only a test-literal update for the now-required `changeId`.
- **`sessionSettingsRejected{changeId}`** ([#269](../codebase/269.md)) is the rejected twin of
  `sessionSettingsUpdated`, a **new** arm (not a field-widen, so it *does* force a compiler case in all
  three exhaustive bridges — each a one-line no-op, same as every other atomic-`DaemonEvent`-arm ticket).
  Maps to *no* `SessionAction`, consumed by **none** of the three existing bridges — its consumer is
  the [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped),
  same as `sessionSettingsUpdated`. Emitted by [daemon connection](daemon-connection.md)'s
  correlation gate when a content-free `daemon-error` (#116) arrives whose `Envelope.in_reply_to` matches
  a pending `set_session_settings` request. Carries **only** `changeId` — deliberately no `sessionId`
  (the wire `error` frame carries none, and `changeId` alone disambiguates two outstanding changes to the
  same session), no `inReplyTo`, and no error code/message.
- **`workspaceFolderRejected`** ([#396](../codebase/396.md)) is the rejected twin of
  `workspaceFolderCreated` (#381), a **new** arm (forces a compiler case in all three exhaustive
  bridges, the `sessionSettingsRejected` precedent). Maps to *no* `SessionAction`, consumed by **none**
  of the three existing bridges — its real consumer is the
  [create-folder round-trip store](new-folder-store.md) ([#397](../codebase/397.md)), a dedicated store
  + inbound-only bridge that folds both `workspaceFolderCreated` and `workspaceFolderRejected` in,
  gating the transition to only-while-in-flight. Emitted by [daemon connection](daemon-connection.md)'s
  correlation gate — the same `case 'daemon-error':` precedence tier as `sessionSettingsRejected`,
  checked against a new `pendingCreateFolders: Set<number>` rather than `pendingSettings`'s `Map`.
  **Bare** — carries no field at all, unlike `sessionSettingsRejected`'s `changeId` or
  `modalAnswerRejected`'s `modalId`: only one create-folder dialog is ever open, so there is no
  concurrency to disambiguate, and the success twin `workspaceFolderCreated` carries only `path` with no
  correlation key to mirror.
- **`backgroundTaskStarted{conversationId,taskId,toolCallId,description,taskType,truncatedFields}`**
  ([#564](../codebase/564.md)) also maps to *no* `SessionAction`, consumed by **none** of the three
  existing bridges. [The background-task-roster store (#573, shipped)](../codebase/573.md) is now live but
  consumes only `backgroundTaskRoster` below, not this arm — it stays dormant, awaiting #574. The frame
  announces claude work that **outlives the turn that spawned it** (pyrycode#1240); it carries no
  `turn_id` and opens/closes no turn, so — like `queueState` — it **keeps** `conversationId` rather than
  dropping it, following the same "turn-stream item vs daemon state" test #720 established. `toolCallId`
  is the wire `tool_call_id` (not `tool_use_id`, despite `toolUse`/`toolResult`'s spelling) but the same
  identifier value those two carry. `taskType` is an open string; `truncatedFields: null` means "nothing
  was cut" and must not collapse into `[]` — dropping it downstream would present claude's cut text as
  complete. `description`/`taskType` are untrusted, model-influenced daemon-relayed text (for
  `taskType: 'local_bash'`, `description` is the literal command line claude ran) — the render slice
  (#568) must treat both as plain text, never HTML, an attribute, or a URL sink. Ships dormant; first of
  three sibling frame members (#565 `background_task_updated`, #566 `background_task_roster` follow).
- **`backgroundTaskUpdated{conversationId,taskId,patch,truncatedFields}`** ([#565](../codebase/565.md))
  is the peer of `backgroundTaskStarted`, joined on `taskId`: that frame opens a task, this one reports
  what **changed** about it afterwards. **Four fields, not six** — no `toolCallId`, no `description`, no
  `taskType`; it gains `patch`, claude's patch object carried whole and unparsed as an opaque string
  (one key observed so far, `is_backgrounded`). Also **keeps** `conversationId`, the same in-family
  precedent `backgroundTaskStarted` established (no `turn_id`, opens/closes no turn, the `queueState`
  #720 rule). `patch` is an **opaque display blob that is not guaranteed to parse** — the daemon
  truncates it at construction (its own golden fixture is cut mid-token), so nothing on this path runs
  `JSON.parse`; a consumer that wants its keys must parse behind an error branch falling back to inert
  text, and must never enumerate a closed key set. `patch: ''` is a value ("claude sent no change"), not
  an absence; `truncatedFields: null` means "nothing was cut" and reports the cap cut **only** — `patch`
  may differ from claude's bytes without appearing there (the daemon separately scrubs invalid UTF-8 by
  deletion). SECURITY: `patch`'s keys may carry command text exactly as `description` does — render as
  plain text, never HTML/attribute/URL, never executed or re-shelled; this slice has no DOM sink, so the
  constraint is carried forward to #568. Consumed as a no-op by all three exhaustive bridges at ship
  time. [The background-task-roster store (#573, shipped)](../codebase/573.md) consumes only the
  `backgroundTaskRoster` arm below, not this one — it stays dormant, awaiting #574. Second of three
  sibling frame members (#566 `background_task_roster` follows).
- **`backgroundTaskRoster{conversationId,tasks,droppedTasks}`** ([#566](../codebase/566.md)) closes the
  family — the **aggregate peer** of the two scalar arms above: they report what happened to **one** task,
  this reports the **whole live set**. Also **keeps** `conversationId`, the same in-family precedent both
  siblings established (no `turn_id`, opens/closes no turn, the `queueState` #720 rule). Its **row type is
  reused verbatim, snake_case** — `tasks: readonly BackgroundTask[]` — the `queueState`/`conversationsReceived`
  nested-array precedent, not a snake→camel remap: the row narrower already stripped each row to its known
  fields, so there is nothing left to drop. A **snapshot, not a delta**: each frame replaces the reader's
  view of what is running, so [#573](../codebase/573.md) **replaces**, never merges, its held set per
  frame. `tasks: []` is a
  **positive statement that nothing is alive** — the payoff signal for pyrycode#1240 — and must be emitted
  and consumed, never dropped, filtered, or coalesced as "no news". `droppedTasks` is the frame's **only**
  truncation report (there is deliberately no top-level `truncatedFields`); the true roster size is
  `tasks.length + droppedTasks`, and `0` is a value, never consulted for truthiness. Each row's
  `truncated_fields: null` means nothing was cut **for that row**, distinct from `[]`, and is per-row —
  never hoisted or flattened across rows. SECURITY: each row's `description` is untrusted, model-influenced
  text and for `task_type: local_bash` is the literal command line claude ran — plain text only, never
  HTML, an attribute, or a URL; the daemon states the rule per row rather than delegating it to the scalar
  frames because **a list of command lines is a more tempting shape to feed somewhere structured than a
  single one** — treat `tasks` as a display list, never a structured work list. No terminal/finish event
  exists in this family by design; "finished" is a client conclusion that would have to be drawn from a
  task's absence in a later roster, never something the wire reports — and [#573](../codebase/573.md)
  deliberately declines to draw it, holding only what the daemon reported. Consumed as a no-op by all
  three exhaustive bridges at ship time. Ships dormant no longer: [the background-task-roster store
  (#573, shipped)](../codebase/573.md) is the first consumer, an independent subscriber outside the three
  exhaustive bridges. Third and last of the sibling frame members.
- **`modelAnnounced{model,truncated}`** ([#587](../codebase/587.md)) also maps to *no* `SessionAction`,
  consumed by **none** of the three existing bridges — the real consumer is
  [the announced-model store](announced-model-store.md), #588 (shipped, still dormant pending #560's
  render surface). Claude's own identity report for the turn (its `system`/`init` line),
  answering what the spawn argument cannot: the daemon knows what it *requested*, only claude knows what
  it *got*. **`model` collides by name with an arm above and means the opposite thing** —
  `runConfigReceived` carries a `model: string` meaning the per-session
  *override* (`''` = "inherited default, no override"); this one means what claude *announced*, and in
  the ordinary case the two disagree (the override is `''` while claude has named a concrete model).
  (Through [#621](../codebase/621.md), `snapshotReceived` carried the same colliding field too — the
  warning named both; it now names only the surviving arm.) The
  wire field name is kept (no drift, ADR 0002); the distinction is drawn in the arm's own comment, the
  way the daemon's own payload doc draws it. `model` is held verbatim — not reliably dated, need not
  appear in any published model list, so a lookup miss on #588's side is ordinary, not an error.
  `truncated` is load-bearing: sharper here than on `unrecognizedMessage`, because a cut identifier
  always misses #588's exact lookup and so always renders verbatim, looking exactly like a legitimate
  unrecognised model. At ship time `conversation_id` was dropped — the `turnState`/`stallDetected`/
  `apiRetry`/`compacting` convention (#588 held a single value replaced per announcement, so nothing
  downstream keyed by conversation). **[#714](../codebase/714.md) widened the emit to carry it onward as
  `conversationId`** — the last arm in the family (#724/#732/#737/#742 widened the other four) and the
  only one with a live consumer already built: a daemon-asserted routing key, never rendered, never a
  filename/cache key/lookup path, reaching no sink. It **stops at the announced-model bridge**
  (`translateModelAnnounced`), which still rebuilds a fresh `{ model, truncated }` literal — `AnnouncedModel`
  and [the announced-model store](announced-model-store.md) are unaffected, still holding one value. The
  arm's own security clause used to be arithmetic ("exactly one untrusted string crosses IPC … rather than
  two"); #714 replaced it rather than renumbering it, since counting to two would have asserted the id is
  untrusted text of `model`'s kind, which it is not. The per-conversation consumer is #588 / #674, not yet
  built. Not deduped: the transport holds no state, so N daemon frames (including a verbatim repeat)
  produce N events — that repeat is what tells #588 the value is still current. Ships dormant no longer:
  [the announced-model store (#588, shipped)](announced-model-store.md) is a fourth independent observer,
  alongside the three exhaustive bridges, which keep their no-ops permanently.
- **The two unions stay separately declared, per layer.** `DaemonEvent` lives in `shared/ipc`, `SessionAction` in the renderer store. The 1:1 correspondence is a convenience for #19, **not a coupling** — the IPC contract can evolve independently of the store's action vocabulary.
- **Members reuse the wire payload types verbatim** from `../wire/types` (imported by relative path — see below): `connected.ack` is `HelloAckPayload`, `messageReceived.message` is `MessagePayload`, `messagesReceived.messages` is a `MessagePayload[]`, `conversationsReceived.conversations` is a `readonly ConversationSummary[]`. No redefinition, no drift.
- **`failed.error` is the wire `ErrorPayload`**, not the store's `ConnectionError`. The union stays wire-typed; #19 maps `ErrorPayload → ConnectionError` (a trivial field copy) at the store boundary. Transport-level failures with **no** wire envelope — silent Noise-handshake failure, dropped socket (detected in #4/#7) — are emitted by *synthesizing* a valid `ErrorPayload` (`{ code: 'transport' | 'handshake', message, retryable }`). See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md), which defined `ConnectionError` for exactly this.
- **`messagesReceived` carries complete messages, not partial tokens** — it mirrors the wire `message_chunk` (`MessageChunkPayload.messages`), a backfill batch. It flattens to the `messages` array directly, so `MessageChunkPayload` itself is *not* a member (its only field is the array the member already carries). `readonly` is a compile-time no-mutate signal; it is erased harmlessly across the IPC structured-clone boundary.

### 2. The emit helper (`src/main/emitDaemonEvent.ts`)

```ts
export interface DaemonEventSink {
  isDestroyed(): boolean // #518 — required; the ONE member safe to call post-destruction
  webContents: { send(channel: string, event: DaemonEvent): void }
}
export function emitDaemonEvent(sink: DaemonEventSink, event: DaemonEvent): void {
  if (sink.isDestroyed()) return // #518
  sink.webContents.send(DAEMON_EVENT_CHANNEL, event)
}
```

- **The one and only path an event takes to the renderer.** Transport code (#10/#12) calls this after building a `DaemonEvent` from a validated wire envelope; nothing else sends on the channel.
- **A pure forwarder** — no transform, no clone, no logging. (A `console.log(event)` would leak `MessagePayload.text` message bodies to main-process stdout.)
- **Typed against a structural `DaemonEventSink`, not `BrowserWindow`.** A real `BrowserWindow` satisfies it structurally, and the unit tests pass fakes — so the helper needs **no `electron` import and no Electron harness**. Typing `send`'s second parameter as `DaemonEvent` also stops any non-event payload reaching the channel. Since [#519](../codebase/519.md), production no longer passes a captured `BrowserWindow` directly — the composition root's sink is `live.sink`, the [live-window](live-window.md) holder's process-lifetime forwarder, which also satisfies `DaemonEventSink` structurally and reports `isDestroyed()` as permanently `false` by design (see that doc for why).
- **`isDestroyed()` guard ([#518](../codebase/518.md)).** On macOS, closing the window destroys the `BrowserWindow` without quitting the app, and the connection keeps emitting into it; the `webContents` **accessor itself** throws once destroyed, before `send` is ever reached. The guard is checked first, above any `sink.webContents` access — nothing may hoist or alias `webContents` above it, since the property read *is* the throw. Required rather than optional, so an unguardable sink literal fails to compile. This one guard covers all 32 `daemonConnection.ts` call sites plus the debug-bundle orchestrator's injected `emit`.

### 3. The preload subscription (`src/preload/index.ts`)

```ts
onDaemonEvent: (listener: (event: DaemonEvent) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, event: DaemonEvent): void => listener(event)
  ipcRenderer.on(DAEMON_EVENT_CHANNEL, handler)
  return () => ipcRenderer.removeListener(DAEMON_EVENT_CHANNEL, handler)
}
```

- **Added to the existing `api` object**; `PyryApi = typeof api` flows the new method's type to `window.pyry` through the untouched `index.d.ts`. The `process.contextIsolated` guard and the `exposeInMainWorld('pyry', …)` shape are preserved.
- **`ipcRenderer` never crosses the bridge** — only the typed `onDaemonEvent` callback surface does.
- **The raw `IpcRendererEvent` first arg is stripped** — the wrapper calls `listener(event)` only. The renderer never sees the ipc event object (it exposes `.sender`/`.ports`, a capability leak).
- **Returns an unsubscribe closure** that calls `removeListener` with the *exact same* `handler` reference, so the handle removes precisely the listener it added — no leak, no double-fire. Multiple subscribers are allowed; each gets its own handler and its own unsubscribe.
- **Receive-only** — no `ipcRenderer.send`/`invoke`, no `ipcMain` handler. It grants the renderer **zero** new command capability toward the background process — that direction is the [command channel](command-channel.md) (#17).

### Data flow

```
 #10/#12 transport (later)          emitDaemonEvent            preload bridge              #19 (shipped)
 wire Envelope ──validate/parse──►  emitDaemonEvent(win, e) ──► webContents.send ──IPC──► onDaemonEvent(cb)
   hello_ack/message/error          (the ONLY send path)        DAEMON_EVENT_CHANNEL       cb(DaemonEvent)
                                                                 ipcRenderer.on(strip e)   → map → sessionStore.dispatch
```

`emitDaemonEvent` is the single choke point outbound; `onDaemonEvent` is the single subscription inbound. **Neither #18 file parses raw bytes** — validation of hostile daemon input happens upstream in #5 (codec) / #10 (hello), *before* a `DaemonEvent` is ever constructed. #18 forwards already-typed, already-validated events.

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
- **`compacting` is `apiRetry`'s peer, but banner-only.** [#495](../codebase/495.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, a fresh `{ type: 'compacting', active: inbound.compacting.active }` literal copied by name from the decoded `CompactingPayload` (never a spread) with `conversation_id` dropped. Like `apiRetry` the daemon frame is **not** onset-only (an explicit `active: false` falling edge) and **not** deduped, but unlike `apiRetry` there is no counter at all — the wire streams no compaction progress, so the arm carries exactly one boolean, the smallest non-nullary status-liveness shape in the file. Proven only by a round-trip test asserting the exact emitted-event sequence, the exact `['active','type']` key set (guarding against a future `...inbound.compacting` spread), and that the serialized event log never contains the planted conversation id. Ships dormant — all three exhaustive bridges no-op it until the render slice #496.
- **`toolUse` had a real producer but no traffic through #178 — same capability gate.** [#217](../codebase/217.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectItems` a real `toolCall` source for the first time; no `tool_use` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly, and by the reducer's existing text/tool/text split test, until then. Now live.
- **`modalShown`/`modalDismissed` had real producers but no traffic through #178 — same capability gate.** [#201](../codebase/201.md) wired `emitDaemonEvent` for both from the same `case 'message'` choke point; no `modal_shown`/`modal_dismissed` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Both `daemonEventBridge`/`timelineBridge` still discard the arms as `null`; the third, independent [modal store + bridge](modal-store-bridge.md) ([#223](../codebase/223.md), shipped) is the real consumer, mounted since [#224](../codebase/224.md). Proven only by unit tests driving `daemonConnection` and all three bridges directly, until #179. Now live and answerable end to end.
- **`toolResult` had a real producer but no traffic through #178 — same capability gate.** [#229](../codebase/229.md) wired `emitDaemonEvent` for it from the same `case 'message'` choke point, giving `selectItems` its first real *resolved* `toolCall`; no `tool_result` frame reached it until [#179](../codebase/179.md) flipped `interactive`. Proven only by unit tests driving `daemonConnection` and `timelineBridge` directly (the latter through a real `createTimelineStore()`), and by the reducer's existing `fillResult` correlation tests (#121), until then. Now live.
- **`queueState` is wired at the same `case 'message'` choke point as `toolUse`/`toolResult`, but its traffic is not known to be gated behind the `interactive` capability flip.** [#292](../codebase/292.md) added the emit from `daemonConnection.ts` directly, alongside `tool-use`/`tool-result`/`conversations`; unlike those turn-stream arms, `queue_state` is daemon **state** (#720) that can change independent of any turn being interactive, so — unlike the documented #178/#179 gate for `turnState`/`toolUse`/`toolResult`/`modalShown` — no capability precondition is asserted here. Proven only by unit tests driving `daemonConnection` and all three bridges directly; a live daemon `queue_state` frame has not yet been observed through #178.
- **`modalAnswerRejected` is correlated, not decoded.** [#248](../codebase/248.md) added a fifteenth member, `modalAnswerRejected{modalId}` — the only member built entirely from main-side memory rather than a wire field: the daemon `error` (#116) that follows a rejected `modal_answer` carries no `modal_id`, so `daemonConnection.ts` attributes it via a FIFO queue of its own outstanding answered ids (push-on-send, dequeue-on-error, drain-on-accept, reset-on-dial). Consumed by neither `daemonEventBridge` nor `timelineBridge` (both null it); the real, still-dormant owner is the [modal store + bridge](modal-store-bridge.md) — render lands in #249.
- **`screenSnapshotReceived` shared its producer's choke point with `snapshotReceived`, not a new one — and both were removed together.** [#316](../codebase/316.md) added the second `emitDaemonEvent` call inside the same `case 'snapshot'` block `snapshotReceived` already occupied — the first member to be emitted from an *existing* member's exact call site rather than a new `case` or a new orchestrator. Both fired on every `screen_snapshot` reply; `screen_snapshot` is always-available (ADR-025, not gated on `interactive` — see [screen snapshot fetch](screen-snapshot-fetch.md)), so unlike `assistantDelta`/`turnState`/`toolUse`, this member had live traffic from the moment #180 shipped the underlying request/reply, not gated behind [#179](../codebase/179.md). Sharing one choke point meant [#621](../codebase/621.md) removed both emits in the same deletion — there was no seam to split the removal on either.
- **`sessionSettingsRejected` is correlated by lookup, not by FIFO memory.** [#269](../codebase/269.md) added a seventeenth member, sharing the *same* `daemon-error` wire trigger as `modalAnswerRejected` above but a different attribution mechanism: unlike the FIFO (which cannot disambiguate two outstanding answers of the same kind and picks oldest-first), `daemon-error` here is looked up in `pendingSettings` by its own `Envelope.in_reply_to` — a precise per-request match, not a queue position. On a match this precedence gate **consumes the frame entirely**, skipping both the bundle reassembler and the `modalAnswerRejected` FIFO shift; on no match, both fire exactly as before #269. Consumed by none of the three existing bridges; the real consumer is the [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped), same as `sessionSettingsUpdated`.

## Security posture

AC4 ("no key material, raw frames, or bytes cross the bridge") is **enforced by the type, not by convention.** The union references only `HelloAckPayload` / `ErrorPayload` / `MessagePayload` for its session-lifecycle members, none of which has a token, key, or raw-byte field. `QrPayload` (token, `server_static_pubkey`), `HelloClientPayload` (token), and `InnerFrameV2` (base64 `data`) are **not** members and must never become members — a developer cannot serialize a secret here because no member has a field to hold one. `MessagePayload.text` does cross (messages are displayed — that is the product, not a leak) and must not be logged. The channel is **receive-only** and exposes no `ipcRenderer`, so a compromised renderer gains no command capability toward the transport, keys, or socket through #18. The [#168](../codebase/168.md) debug-bundle members hold the same invariant with different carriers: `debugBundleProgress.chunksReceived` is a count, `debugBundleSaved.path` is a local filesystem path, `debugBundleFailed.reason` is the closed `DebugBundleFailure` enum — never a token, key, raw frame, or bundle bytes. The closed enum is a deliberate information-minimisation boundary: a hostile daemon's raw error string cannot be assigned to `reason` (a `string` isn't a `DebugBundleFailure`), so the [orchestrator](debug-bundle-orchestrator.md) ([#169](../codebase/169.md)) is structurally forced to map transport internals down to one of the three categories before they can reach the renderer. [#199](../codebase/199.md)'s `assistantDelta`/`turnEnd` are the one deliberate exception to "minimise what crosses": `assistantDelta.text` carries real assistant-reply content (the render payload, same category as `messageReceived.text`) — the AC5 invariant it still satisfies is narrower ("never a token/key/raw frame"), not "never any content."

> Pre-existing hardening note (out of scope for #18): `src/main/index.ts` sets `sandbox: false`. The whole bridge surface is `sandbox: true`-compatible; route the flip to a dedicated hardening ticket. (#17, the command half, also left it untouched — still open.)

## Related

- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the #19 consumer that maps this union onto `SessionAction` and dispatches into the store; also the [#168](../codebase/168.md) consumer that tolerates the three debug-bundle members by returning `null`
- [Session store](session-store.md) — the `SessionAction` mapping target #19 dispatches into
- [Debug-bundle reassembly (inbound)](debug-bundle-reassembly.md) / [#116](../codebase/116.md) — source of the finer `BundleFailReason` (5 values) the [orchestrator](debug-bundle-orchestrator.md) (#169) maps onto this channel's coarse `DebugBundleFailure` (3 values)
- [Command channel](command-channel.md) / [#168](../codebase/168.md) — the mirror-image `requestDebugBundle` command that triggers the download this channel's three new members report on
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) / [#169](../codebase/169.md) — the real producer of the three debug-bundle members, wired at the composition root
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180](../codebase/180.md) — the `snapshotReceived` member (removed [#621](../codebase/621.md)), its `requestSnapshot` [command channel](command-channel.md) mirror (removed [#620](../codebase/620.md)), and the content-minimisation reasoning behind its dedicated (non-wire-type-reusing) shape
- [#621 codebase notes](../codebase/621.md) — removed `snapshotReceived` and `screenSnapshotReceived` from the `DaemonEvent` union and the shared `case 'snapshot'` emit that produced both; a well-formed `screen_snapshot` frame now decodes and is silently dropped, producing no event
- [Thread timeline (conversation model)](thread-timeline.md) / [#199](../codebase/199.md) — the `assistantDelta`/`turnEnd` members, the transport slice of the structured-stream render vertical, and the deliberate content-carrying divergence from `snapshotReceived`'s minimisation pattern
- [Inbound message decode](inbound-message-decode.md) / [#199](../codebase/199.md) — the `assistant_delta`/`turn_end` decode this channel's two new members are constructed from
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the `conversationsReceived` member, its `requestConversations` [command channel](command-channel.md) mirror, and why it reuses the wire row type verbatim instead of a hand-built minimal shape
- [Conversation timeline store](conversation-timeline-store.md) / [#214](../codebase/214.md) — the `turnState` member, the third arm the `timelineBridge` owns, and the closed-enum decode idiom cloned from `role`
- [#315 codebase notes](../codebase/315.md) — the `stallDetected` member, the eighteenth no-`SessionAction` arm and, at ship time, the only nullary one: the wire `StallPayload`'s sole field was dropped at the emit, so zero decoded daemon data crossed this bridge; shipped dormant (all three bridges nulled it). [#732 codebase notes](../codebase/732.md) later widened it with `conversationId`, a daemon-asserted routing key that still crosses this bridge as a no-op (all three bridges still null it) and reaches no sink.
- [#317 codebase notes](../codebase/317.md) — the render slice: the [conversation timeline store](conversation-timeline-store.md)'s bridge claims `stallDetected` as a sixth owned arm, feeding a new `stalled` scalar `StallIndicator` renders
- [#492 codebase notes](../codebase/492.md) — the `apiRetry` member, `stallDetected`'s status-liveness peer, carrying `active`/`current`/`total` (`conversation_id` dropped at the emit — unlike `stallDetected` after [#732](../codebase/732.md), `apiRetry` has not (yet) been widened to keep it; see #729). Not onset-only and not deduped, unlike every prior status-liveness member; consumed as a no-op by all three exhaustive bridges at ship time
- [#493 codebase notes](../codebase/493.md) — the render slice: the [conversation timeline store](conversation-timeline-store.md)'s bridge claims `apiRetry` as a seventh owned arm, feeding a new `apiRetry: ApiRetryStatus | null` scalar `ApiRetryIndicator` renders, with the clearing semantics deliberately inverted from `stalled`
- [#495 codebase notes](../codebase/495.md) — the `compacting` member, `apiRetry`'s peer but **banner-only**: carries only `active` (`conversation_id` dropped), since the wire streams no compaction progress for the render slice #496 to carry a counter from. Like `apiRetry`, not onset-only and not deduped; consumed as a no-op by all three exhaustive bridges at ship time
- [#316 codebase notes](../codebase/316.md) — the `screenSnapshotReceived` member (removed [#621](../codebase/621.md)), the nineteenth no-`SessionAction` arm and, unlike every prior member, a deliberate **widening** (not a minimisation): carried exactly the `text`/`ts` fields `snapshotReceived` (#180) was built to exclude, emitted from that same member's `case 'snapshot'` seam; consumed as a no-op by all three exhaustive bridges, real consumer was the [screen-snapshot store](screen-snapshot-store.md) (#323) and the display slice #324, both removed by #618/#619 before this member itself was
- [Conversation timeline store](conversation-timeline-store.md) / [#217](../codebase/217.md) — the `toolUse` member, the fourth arm the `timelineBridge` owns, and the first to drive a durable `toolCall` item rather than text or a scalar
- [#642 codebase notes](../codebase/642.md) — a field, not a member: `toolUse` widened with an optional fifth field, `input?: Readonly<Record<string, string>>`, still ships dormant on this arm — #643 is the first consumer
- [Modal-prompt model](modal-prompt-model.md) / [#201](../codebase/201.md) — the `modalShown`/`modalDismissed` members, the tenth and eleventh no-`SessionAction` arms, consumed by neither existing bridge; the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md), shipped in [#223](../codebase/223.md). [#871 codebase notes](../codebase/871.md) later widened `modalShown` with `conversationId`, the tenth arm in the `#675` family, copied by name and required; it crossed this bridge as a no-op ([#223](../codebase/223.md) rebuilt a fresh `ModalEvent`) until [#877 codebase notes](../codebase/877.md) carried it onto `ModalEvent`'s `shown` arm, and [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) carried it the rest of the way onto the held `ModalPrompt`, where `selectHasOutstandingFor` is the sink. `modalDismissed` is unaffected.
- [Conversation timeline store](conversation-timeline-store.md) / [#229](../codebase/229.md) — the `toolResult` member, the twelfth no-`SessionAction` arm and the vertical's last transport slice; the fifth arm the `timelineBridge` owns and the first to resolve an existing `ThreadItem` in place rather than append one or set a scalar
- [Conversation create](conversation-create.md) / [#241](../codebase/241.md) — the `conversationCreated` member, the thirteenth no-`SessionAction` arm and the write-side twin of `conversationsReceived` (#139); consumed by neither existing bridge, real consumer is the render sibling #242
- [#254 codebase notes](../codebase/254.md) — the `sessionTransition` member, the fourteenth no-`SessionAction` arm and the second (after `snapshotReceived`) to content-minimise its emit relative to its decoded wire payload; consumed by none of the three existing bridges, real consumer is the renderer holder #259, blocked on this ticket
- [#292 codebase notes](../codebase/292.md) — the `queueState` member, consumed by neither existing bridge; the only member to date that carries `conversationId` while every sibling turn-stream arm drops it, because the daemon SSOT (pyrycode #720) fixes `queue_state` as a replacement-truth snapshot the still-unbuilt #293 store must key by conversation
- [#248 codebase notes](../codebase/248.md) — the `modalAnswerRejected` member, the fifteenth no-`SessionAction` arm and the first built entirely from main-side correlation memory rather than a decoded wire field (the daemon `error` it reports on carries no `modal_id`); owned by the [modal store + bridge](modal-store-bridge.md), dormant until the render slice #249
- [#264 codebase notes](../codebase/264.md) — introduced the `sessionSettingsUpdated` member, the sixteenth no-`SessionAction` arm and, unlike every prior member, minimal not because a field was dropped at the emit but because the decoded wire payload itself has only one field
- [#261 codebase notes](../codebase/261.md) — widened `sessionSettingsUpdated` with `changeId`, the renderer-minted correlation key matched against `Envelope.in_reply_to`; consumed by none of the three existing bridges, real consumer is [#256](../codebase/256.md) (shipped)
- [#269 codebase notes](../codebase/269.md) — the `sessionSettingsRejected` member, the seventeenth no-`SessionAction` arm and the rejected twin of `sessionSettingsUpdated`; emitted by [daemon connection](daemon-connection.md)'s `pendingSettings`-lookup precedence gate on a correlated `daemon-error`, which on a match also suppresses that ticket's own `modalAnswerRejected` FIFO and the #116 bundle reassembler; consumed by none of the three existing bridges, real consumer is [#256](../codebase/256.md) (shipped)
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase notes](../codebase/256.md) — the pending→confirm/reject store consuming both `sessionSettingsUpdated` and `sessionSettingsRejected`; a fourth, independent App-level subscriber on this channel, alongside the three exhaustive bridges above
- [#396 codebase notes](../codebase/396.md) — the `workspaceFolderRejected` member, the rejected twin of `workspaceFolderCreated` (#381); emitted by [daemon connection](daemon-connection.md)'s `pendingCreateFolders`-lookup precedence gate (the `pendingSettings`/`sessionSettingsRejected` pattern applied to a `Set`, since the event is bare); consumed by none of the three existing bridges, real consumer is the [create-folder round-trip store](new-folder-store.md) ([#397](../codebase/397.md))
- [#564 codebase notes](../codebase/564.md) — the `backgroundTaskStarted` member, `apiRetry`/`compacting`'s peer on the v2 stream but widened to five strings plus a nullable string array; first of three sibling frame members (#565/#566 follow), and — like `queueState` — **keeps** `conversationId` because the frame is daemon state (no `turn_id`, opens/closes no turn) rather than a turn-stream item. Ships dormant, consumed by none of the three exhaustive bridges; [the background-task-roster store (#573, shipped)](../codebase/573.md) is live but consumes only the sibling `backgroundTaskRoster` member below, so this arm stays dormant, awaiting #574
- [#565 codebase notes](../codebase/565.md) — the `backgroundTaskUpdated` member, `backgroundTaskStarted`'s peer joined on `taskId` but narrowed to four fields (no `toolCallId`/`description`/`taskType`) plus the new opaque `patch` string, which is never typed as JSON and never parsed on this path — the daemon's own golden fixture is cut mid-token. Also **keeps** `conversationId`, the same in-family precedent as its sibling. Second of three sibling frame members (#566 follows). Ships dormant, consumed by none of the three exhaustive bridges; [the background-task-roster store (#573, shipped)](../codebase/573.md) is live but consumes only the sibling `backgroundTaskRoster` member below, so this arm stays dormant, awaiting #574
- [#566 codebase notes](../codebase/566.md) — the `backgroundTaskRoster` member, the **aggregate peer** of the two scalar arms above: they report what happened to one task, this reports the whole live set, as a snapshot, not a delta. Reuses the wire `BackgroundTask` row type verbatim (the `queueState`/`conversationsReceived` nested-array precedent — snake_case, no remap), keeps `conversationId` for the same in-family reason, and `tasks: []` is the payoff signal pyrycode#1240 needs — a positive statement that nothing is alive, never filtered out. `droppedTasks` is the frame's only truncation report. Third and last of the sibling frame members. Consumed by none of the three exhaustive bridges; ships dormant no longer — [the background-task-roster store (#573, shipped)](../codebase/573.md) is the first consumer
- [#587 codebase notes](../codebase/587.md) — the `modelAnnounced` member, an identity report (claude's
  resolved model for the turn) rather than a turn sub-state; collides by name with `snapshotReceived`/
  `runConfigReceived`'s `model` (the per-session override) and the arm's comment draws the distinction.
  `truncated` is load-bearing the same way `unrecognizedMessage`'s is, sharpened by the fact a cut
  identifier always misses the display-name lookup. `conversation_id` dropped, not deduped. Consumed by
  none of the three exhaustive bridges; ships dormant no longer — [the announced-model store (#588,
  shipped)](announced-model-store.md) is the first consumer, still dormant pending #560's render
  surface.
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — the normative contract these two arms are shaped to feed
- [ADR 0004 — Renderer session store: reducer + sealed actions + wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `failed → ErrorPayload → ConnectionError` seam
- [ADR 0001 — Stack: transport in the background process](../decisions/0001-stack-electron-react-typescript.md) · [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#18 codebase notes](../codebase/18.md) · Spec: `docs/specs/architecture/18-typed-daemon-event-channel.md` · [#168 codebase notes](../codebase/168.md) · Spec: `docs/specs/architecture/168-debug-bundle-ipc-contract.md`
