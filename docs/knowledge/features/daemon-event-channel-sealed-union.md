# Daemon event channel — the sealed union

The event union itself: every arm the main process can emit to the renderer, and the rules that keep the switch over them exhaustive.

Part of [Daemon-event channel](daemon-event-channel.md); see that document for what the package does, its edge cases and its links.

## 1. The sealed union (`src/shared/ipc/events.ts`)

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
- **`questionShown{conversationId,questionBatchId,questions}`**
  ([#885](https://github.com/pyrycode/pyrycode-desktop/issues/885)) carries claude's
  `AskUserQuestion` batch the last hop across IPC — the wire vocabulary
  ([#883](https://github.com/pyrycode/pyrycode-desktop/issues/883)) and the fail-closed decode
  ([#884](https://github.com/pyrycode/pyrycode-desktop/issues/884)) already existed; this arm is the
  emit. It sits beside `modalShown`/`modalDismissed` rather than at the union's tail because it copies
  `modalShown`'s `conversationId`-scoping shape, but it is **not** a modal: a modal is a permission
  prompt gating an action, answered against `modalId`; this is claude asking the operator to *choose*,
  with its own nonce and — as yet — no answer frame anywhere in the daemon contract. Top-level fields
  are snake→camel (`conversation_id`→`conversationId`, `question_batch_id`→`questionBatchId`); unlike
  every prior nested-array member, **this family nests two levels, and the verbatim-row rule applies
  at both** — `questions: readonly WireQuestion[]` is the outer array (the `queueState`/
  `backgroundTaskRoster` precedent) and each question's own `options` is reused unchanged too, since
  #884's narrower already stripped every row to its known fields. `conversationId` is an outbound
  display-scoping key only; `questionBatchId` stays the sole correlation key, the split `modalShown`
  has carried since #870/#871. `question`, `header`, and every option's `label`/`description` are
  claude-authored, unbounded and unsanitized — decoded is not sanitized, so the eventual render slice
  owns the escaping (plain text only, never HTML, an attribute, a URL, a filename, a cache key, or a
  log). Consumed as a **permanent** no-op by the three *other* exhaustive bridges
  (`daemonEventBridge`/`timelineBridge`/`modalBridge`) — unlike `stallDetected`/`apiRetry`/`compacting`/
  `connected` (each shipped dormant and later flipped to an owned arm), this one cannot: its consumer,
  [#850](https://github.com/pyrycode/pyrycode-desktop/issues/850), is `questionBridge`, which at the
  time was a fourth independent subscriber on this channel (the `announcedModelBridge`/`queueBridge`/
  `backgroundTaskRosterBridge` shape), not a future case on session, timeline or modal state.
  [#900](question-batch-model.md) later folded `questionBridge` itself into the exhaustive-`assertNever`
  set, so the channel now has **four** exhaustive bridges, not three — three of them no-op this arm,
  and the fourth (`questionBridge`) is where it does real work rather than nothing.
- **`questionDismissed{questionBatchId,outcome,source}`**
  ([#895](https://github.com/pyrycode/pyrycode-desktop/issues/895)) carries the frame that retires the
  batch above — the wire vocabulary and fail-closed decode
  ([#894](https://github.com/pyrycode/pyrycode-desktop/issues/894)) already existed; this arm is the
  emit, placed immediately after `questionShown`. Flat, one level, three plain strings, built at the
  emit site (`daemonConnection.ts`) as a fresh named-field literal rather than a spread of the decoded
  payload, so a decoder that later grows a field cannot smuggle it across IPC. **No `conversationId`**,
  unlike `questionShown` — the batch nonce (`questionBatchId`) is the sole correlation key, and adding
  one "for symmetry with the batch" is forbidden by the wire contract, not merely omitted.
  **`source` is typed as a plain `string`, never `WireModalSource`** — the one mistake in this family
  that compiles and passes: `events.ts` already imports `WireModalSource` and the adjacent
  `modalDismissed` arm annotates its `source` with it, but the producer emits no member of that closed
  set, only the landed pair `outcome: "unanswered"` / `source: "no_answer"` for every terminal path
  (caller disconnect, elapsed window, and daemon shutdown are indistinguishable to the arbiter that
  emits it). Verified rather than asserted: narrowing the arm to `WireModalSource` and typechecking
  fails it at six call sites (the emit plus five typed bridge test fixtures). If a type error appears
  at the emit site, widen the arm — never cast the payload, and never reach for the `'timeout'` value
  sitting in upstream `question_dismissed.json`, a shape fixture minted before any producer existed.
  **Trust tier is the inverse of `questionShown`'s**: this arm carries no claude-authored byte at all —
  `questionBatchId` is daemon-asserted, `outcome` is an opaque producer-defined sentinel never carrying
  a claude-authored label — but "daemon-asserted" is the producer's promise, not a checked property;
  the transport boundary verifies only `typeof === 'string'`, so the doc comment must not read as "safe
  to render as trusted chrome". The **fail-closed reading rule** an eventual consumer needs: an
  unrecognised `source` means *resolved, cause unknown*, never an answer — read backwards it renders a
  daemon safe-deny as the operator's own choice. `daemonConnection.ts`'s emit deliberately does **not**
  copy the adjacent `modalDismissed` case's `outstandingAnswers` drain — that list holds `modal_id`s
  exclusively, this client sends no question answer at all (the outbound verb is upstream
  pyrycode#1907, unlanded), and a copied drain would search the *modal* correlation window with a
  `question_batch_id`, a cross-frame correlation-confusion path rather than a harmless no-op. Consumed
  as a **permanent** no-op by the three *other* exhaustive bridges, on the same #850/#900 grounds as
  `questionShown` above — `questionBridge` is the fourth exhaustive bridge and the one that does real
  work for this arm.
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
  [the announced-model store (#588, shipped)](announced-model-store.md) is an independent observer
  alongside the exhaustive bridges, which keep their no-ops permanently — **four** of them as of
  [#900](question-batch-model.md) (`daemonEventBridge`/`timelineBridge`/`modalBridge`/`questionBridge`),
  not the three that existed when this arm shipped.
- **`slashCommandList{conversationId,commands,droppedCommands}`**
  ([#937](https://github.com/pyrycode/pyrycode-desktop/issues/937)) carries the workspace's
  slash-command menu the last hop across IPC — the wire vocabulary
  ([#935](https://github.com/pyrycode/pyrycode-desktop/issues/935)) and the fail-closed decode
  ([#936](https://github.com/pyrycode/pyrycode-desktop/issues/936)) already existed; this arm is the
  emit. Placed at the union's tail rather than beside its wire neighbours the question arms:
  `questionShown` sits mid-file because it copies `modalShown`'s conversation-scoping shape and the two
  families are read together, but this arm opens its own family and has no such neighbour. Its
  structural relative is `backgroundTaskRoster` above — one id, the rows, and a drop count — and the
  name follows that precedent: a noun naming the snapshot, not a past participle naming an occurrence,
  and deliberately not `slashCommandsReceived` (the union's `…Received` arms name a reply to a request
  this client made; this frame is unsolicited). A **snapshot, not a delta**: each frame replaces a
  reader's view of the menu, and `commands: []` is a positive statement that claude offered nothing for
  that conversation — unlike `questionShown`'s empty array, which is out of contract, the two read
  alike and mean opposite things.

  Top-level fields are snake→camel (`conversation_id`→`conversationId`,
  `dropped_commands`→`droppedCommands`); **the row type is reused verbatim** —
  `commands: readonly WireSlashCommand[]` stays snake_case (`argument_hint`, `truncated_fields`), the
  `queueState`/`conversationsReceived`/`backgroundTaskRoster`/`questionShown` nested-array precedent,
  since #936's narrower already stripped every row to its known fields. This family nests one level,
  unlike `questionShown`'s two. All three fields are required, never optional — an assigned `undefined`
  survives the structured clone across this channel, so an optional field would invent an absence case
  the daemon never produces. `droppedCommands` is this frame's only truncation report at the frame level
  (`commands.length + droppedCommands` is the menu's true size, `0` a value never consulted for
  truthiness); each row's own `truncated_fields` names that row's own cut fields, `null` distinct from
  `[]`, never hoisted or flattened. A `truncated_fields` naming `aliases` is the only signal separating
  "cut to nothing" from "none" — reading it as "none" greys out a working command, since the Actions
  menu's own `reset` entry is an alias of `clear`, not a command name (#681).

  SECURITY: `name`, `argument_hint`, `description` and every string in `aliases` are
  **workspace-authored** — a lower trust tier than the claude-authored strings
  `modelAnnounced`/`questionShown` carry — bounded by the daemon and not sanitized; the render slice
  owes the escaping (plain text only, never HTML, an attribute, a URL, a filename, a cache key, or a
  log). `name` is not an identifier (one measured name is `__remote-workflow`). `conversationId` is an
  outbound routing/scoping key, not a nonce, unlike `questionShown`'s `questionBatchId` — the never-log
  rule applies here for log-forgery reasons (`0x0a` is the only sub-`0x20` byte measured across the
  capture), not for secrecy.

  Ships dormant no longer: [the slash-command-list store (#954, shipped)](slash-command-list-store.md)
  is a fifth, independent observer catching this arm in the `announcedModelBridge` posture, alongside
  the four exhaustive bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`, `questionBridge`),
  which keep their no-ops permanently — the call #937 left open, resolved in #954's favour of a
  dedicated subscriber over folding into an existing bridge. Nothing renders the store's held list yet;
  #940 and #681 are its first readers. See [Slash-command-list wire types](slash-command-list-wire-types.md)
  for the wire shape and [Inbound message decode](inbound-message-decode.md) for #936's decode.
- **`modelList{conversationId,models,droppedModels}`**
  ([#973](https://github.com/pyrycode/pyrycode-desktop/issues/973)) carries the daemon's published model
  menu the last hop across IPC — the wire vocabulary
  ([#971](https://github.com/pyrycode/pyrycode-desktop/issues/971)) and the fail-closed decode
  ([#972](https://github.com/pyrycode/pyrycode-desktop/issues/972)) already existed; this arm is the
  emit, structurally identical to `slashCommandList` above it: a fresh named-field literal built in
  `daemonConnection`'s `case 'model-list':`, never `return event` and never a spread of the decoded
  payload. Placed at the union's tail for `slashCommandList`'s own stated reason — the frame opens its
  own family and has no wire-neighbour to sit beside. A **noun naming the snapshot**, not a `…Received`
  participle: the union's `…Received` arms name a reply to a request this client made, and this frame is
  unsolicited (it rides a `control_response` but is not correlated by this client's outstanding-request
  memory).

  Top-level fields are snake→camel (`conversation_id`→`conversationId`,
  `dropped_models`→`droppedModels`); **the row type is reused verbatim** — `models: readonly
  WireModelOption[]` stays snake_case (`resolved_model`, `value`, `display_name`, `effort_levels`,
  `supports_auto_mode`, `truncated_fields`), the `queueState`/`conversationsReceived`/
  `backgroundTaskRoster`/`questionShown`/`slashCommandList` nested-array precedent, since #972's
  narrower already rebuilds every row as a fresh six-field literal. All three fields are required, never
  optional — an assigned `undefined` survives the structured clone across this channel, so an optional
  field would invent an absence case the daemon never produces. `droppedModels` is this frame's only
  truncation report at the frame level (`models.length + droppedModels` is the menu's true size, cut
  from the tail so the carried rows are claude's first N in his own order; `0` is a value, never
  consulted for truthiness); each row's own `truncated_fields` names that row's own cut fields, `null`
  distinct from `[]`, never hoisted or flattened. `models: []` is a positive statement that claude
  offered nothing for that conversation, and must still emit exactly one event — the same posture
  `slashCommandList`'s `commands: []` carries and the opposite of `questionShown`'s empty array, which is
  out of contract.

  **Exactly two other arms carry a field named `model`, and this one means a third thing.**
  `runConfigReceived.model` is the per-session *override* (`''` = "inherited default, no override");
  `modelAnnounced.model` is what claude announced *for the current turn*. This arm's rows are the
  *menu* — what claude will accept, not what was chosen or what ran.

  SECURITY: `resolved_model`, `value`, `display_name` and every string in `effort_levels` are
  **claude-authored** — a *higher* trust tier than `slashCommandList`'s workspace-authored strings,
  reachable by prompt injection in a way workspace text is not — bounded by the daemon and not
  sanitized; the render slice owes the escaping (plain text only, never HTML, an attribute, a URL, a
  filename, a cache key, or a log). The never-log clause rests on the *contract* here (the daemon bounds
  and does not sanitize, so a control byte is permitted rather than excluded), not on a measurement —
  `slashCommandList`'s `0x0a`-across-51-entries evidence is that sibling's and does not transfer.
  `conversationId` is an outbound routing/scoping key, not a nonce, the same posture `modalShown` and
  `questionShown` carry.

  Consumed as a no-op by all four exhaustive bridges (`daemonEventBridge`, `timelineBridge`,
  `modalBridge`, `questionBridge`), each documented **permanent**: none of the four will ever own
  this arm. Ships dormant no longer: [the model-list store (#974,
  shipped)](model-list-store.md) is a fifth, independent observer catching this arm in the
  `announcedModelBridge`/`slashCommandListBridge` posture. Nothing renders the store's held list
  yet; #975, #976, #683 and #682 are its queued readers. See [Model-list wire
  types](model-list-wire-types.md) for the wire shape and [Inbound message
  decode](inbound-message-decode.md) for #972's decode.
- **The two unions stay separately declared, per layer.** `DaemonEvent` lives in `shared/ipc`, `SessionAction` in the renderer store. The 1:1 correspondence is a convenience for #19, **not a coupling** — the IPC contract can evolve independently of the store's action vocabulary.
- **Members reuse the wire payload types verbatim** from `../wire/types` (imported by relative path — see below): `connected.ack` is `HelloAckPayload`, `messageReceived.message` is `MessagePayload`, `messagesReceived.messages` is a `MessagePayload[]`, `conversationsReceived.conversations` is a `readonly ConversationSummary[]`. No redefinition, no drift.
- **`failed.error` is the wire `ErrorPayload`**, not the store's `ConnectionError`. The union stays wire-typed; #19 maps `ErrorPayload → ConnectionError` (a trivial field copy) at the store boundary. Transport-level failures with **no** wire envelope — silent Noise-handshake failure, dropped socket (detected in #4/#7) — are emitted by *synthesizing* a valid `ErrorPayload` (`{ code: 'transport' | 'handshake', message, retryable }`). See [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md), which defined `ConnectionError` for exactly this.
- **`messagesReceived` carries complete messages, not partial tokens** — it mirrors the wire `message_chunk` (`MessageChunkPayload.messages`), a backfill batch. It flattens to the `messages` array directly, so `MessageChunkPayload` itself is *not* a member (its only field is the array the member already carries). `readonly` is a compile-time no-mutate signal; it is erased harmlessly across the IPC structured-clone boundary.
