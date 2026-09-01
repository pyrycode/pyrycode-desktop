# Inbound message decode

The **untrusted→trusted boundary for a decrypted daemon message**. The [Noise relay driver](noise-relay-driver.md) hands each decrypted application frame up as opaque bytes (`RelaySessionEvent{ type: 'message'; plaintext }`); this is the layer that turns those bytes into a narrowed, typed `MessagePayload` the renderer can render — or drops them, failing closed, if a hostile or buggy daemon shaped them wrong. It is the inbound counterpart to the [hello exchange](hello-exchange.md) (`parseHelloAck`) and the [outbound send path](outbound-send-path.md) (`buildSendMessage`): same one-concern-per-file split under `src/main/transport/`.

Introduced in [#68](../codebase/68.md). It fills the last no-op arm the [daemon connection](daemon-connection.md) left behind — [#62](../codebase/62.md) wired the handshake-status path but left the inbound-message arm a `// TODO`. This ticket produces the `messageReceived` / `messagesReceived` events that feed the already-complete renderer pipeline: the [daemon-event channel](daemon-event-channel.md) ([#18](../codebase/18.md)) carries them, the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md)) translates them into `SessionAction`s, and the [session store](session-store.md) ([#2](../codebase/2.md)) appends them (deduped by `message_id`, arrival order preserved).

[#180](../codebase/180.md) extended this boundary again, additively, with a `screen_snapshot` →
`snapshot` kind for the [screen snapshot fetch](screen-snapshot-fetch.md) feature. **Removed by
[#622](../codebase/622.md)** — see below.

[#199](../codebase/199.md) extended it a fourth time, additively, with `assistant_delta` →
`assistant-delta` and `turn_end` → `turn-end` kinds — the transport slice (L1) of the structured-stream
render vertical that feeds the [thread timeline](thread-timeline.md) model, once [#202](../codebase/202.md)'s
bridge lands — see below.

[#139](../codebase/139.md) extended it a fifth time, additively, with a `conversations` kind — the
decode half of the [conversation list fetch](conversation-list-fetch.md) feature, and the codec's
first nullable-field wire type — see below.

[#214](../codebase/214.md) extended it a sixth time, additively, with a `turn_state` →
`turn-state` kind — the coarse turn-lifecycle scalar of the same v2 interactive stream `assistant_delta`/
`turn_end` belong to, decoded with a closed-enum idiom instead of `requireString` — see below.

[#217](../codebase/217.md) extended it a seventh time, additively, with a `tool_use` → `tool-use` kind —
the tool-call enrichment of the same v2 interactive stream, decoded via the `requireString`
required-presence idiom scaled to five fields (no enum, unlike `turn_state`'s `state`) — see below.

[#201](../codebase/201.md) extended it an eighth time, additively, with `modal_shown` → `modal-shown`
and `modal_dismissed` → `modal-dismissed` kinds — the transport slice of the [modal-prompt
model](modal-prompt-model.md) vertical (ADR 0009). Two closed-enum checks (`class`/`source`, the
`role`/`state` idiom's third and fourth instances) plus a new per-element narrower mapped over an
ordered nested array (`options`) — see below.

[#229](../codebase/229.md) extended it a ninth time, additively, with a `tool_result` → `tool-result`
kind — the outcome half of `tool_use` (#217) and the vertical's last transport slice. Four
`requireString` fields plus **one `requireBoolean` field** (`is_error` — the `yolo` #180 idiom, `false`
decodes as a value, never an absence) — see below.

[#241](../codebase/241.md) extended it a tenth time, additively, with a `conversation_created` →
`conversation-created` kind — the write-side twin of `conversations` (#139), decoding the daemon's
create-reply into its own 5-field `ConversationCreatedPayload` (**not** a reuse of
`ConversationSummary`). Four `requireString` fields plus one `requireBoolean` (`is_promoted`) plus one
`requireStringOrNull` (`name`, reusing #139's nullable-field checker verbatim) — see below.

[#254](../codebase/254.md) extended it an eleventh time, additively, with a `session_transition` →
`session-transition` kind — the interactive session-boundary marker (pyrycode/pyrycode#656),
`SessionTransitionPayload`. Three `requireString` fields (`previous_session_id`/`new_session_id`/
`occurred_at`) plus one `requireStringOrNull` (`workspace_cwd`, reusing #139's nullable-field checker)
plus a **closed three-way `reason` enum check cloned from `parseTurnStatePayload`'s `state` check**
(`role`/`state`/`reason` is now the idiom's third instance) — deliberately not `requireString`, which
would accept any string and defeat the closed-enum boundary this slice exists to defend. Unlike every
prior kind, the consumer arm (`daemonConnection.ts`) drops **four** of the five decoded fields at the
emit — only `new_session_id` crosses IPC, the #180 content-drop model applied to a second wire type —
see [daemon connection](daemon-connection.md).

[#264](../codebase/264.md) extended it a twelfth time, additively, with a `session_settings_updated` →
`session-settings-updated` kind — the `set_session_settings` (#263) confirmation reply,
`SessionSettingsUpdatedPayload`. A single `requireString` field (`session_id`) — no enum, no nullable, no
cross-field validation: `parseSessionTransitionPayload` scaled to its minimum, since the reply has only
one field to begin with. Unlike `session_transition`, the consumer arm drops **nothing** at the emit —
there is nothing else on the reply to strip.

[#261](../codebase/261.md) widened the `session-settings-updated` kind itself (not a new kind) with an
optional `inReplyTo?: number` — the numeric `Envelope.in_reply_to` routing id. `decodeEnvelope` had
always decoded it (codec.ts); this is the first consumer to propagate it past the envelope, and it does
so by **reading the already-decoded value**, not re-parsing anything — `{ ...,  inReplyTo:
envelope.in_reply_to }`. `undefined` when the frame omits it, which is exactly what makes the consumer's
(`daemonConnection`'s) correlation lookup fail closed. Not logged — the diagnostic log stays
`bytes`/`hash` only; a routing id, not content, but still outside the allowlisted field set.

[#315](../codebase/315.md) extended it a thirteenth time, additively, with a `stall` → `stall` kind —
the daemon's onset-only liveness signal on the same v2 interactive stream `turn_state`/`tool_use`
belong to (pyrycode #638 wire vocab, #639 fan-out). `StallPayload{conversation_id}` is
`TurnStatePayload` scaled to its one always-present field, so `parseStallPayload` is a single
`requireString` call with **no enum check** — `stall` has no `state` to close over. Ships dormant; the
render slice #317 is the first consumer, feeding a new `stalled` timeline-store scalar. **[#732](../codebase/732.md)
widened the consumer arm to carry `conversation_id` onward** (`conversationId`, copied by name) —
until then it was dropped on the same single-active-conversation assumption `turn_state` shed in #724,
which had made `stallDetected` the one arm in the file whose doc comments turned the drop itself into
a security argument ("a nullary arm — nothing can ride it"). #732 replaces that argument rather than
patching it, with the one #724 already established for `turnState`: a daemon-asserted routing key,
never rendered as markup, never a filename/cache key/lookup path, and reaching no log sink. The id
still stops at the renderer timeline bridge; `ThreadEvent.stallDetected` stays nullary.

[#492](../codebase/492.md) added a fourteenth kind, `api_retry` → `api-retry` — the PTY-derived status peer
of `stall` the daemon fans out while claude retries against an API error (pyrycode #1074). Unlike `stall`
this is **not** onset-only: `ApiRetryPayload{conversation_id, active, current, total}` carries an explicit
falling edge (`active: false`) as well as the rising one, and the rising edge **re-fires as the count
climbs** with no wire dedup, so the decoder (and everything downstream) must not dedup or coalesce either.
`parseApiRetryPayload` scales `parseStallPayload` from one field to four, but invents no new check: all
four map onto existing helpers (`requireString` / `requireBoolean` / two `requireNumber` calls), so
`current: 0` / `total: 0` ("count unknown") and `active: false` (the falling edge) both decode as values,
never coerced or treated as absent. At ship time the consumer arm dropped only `conversation_id`,
carrying `active` / `current` / `total` onward — the first payload since `turn_state` to survive the emit
as more than a bare `conversation_id`-dropped scalar or a nullary literal. Shipped dormant; the render
slice #493 is now the first consumer, feeding a new `apiRetry: ApiRetryStatus | null` timeline-store
scalar — `stalled`'s peer with the clearing semantics inverted (an explicit falling edge, not a
client-derived self-clear). [#737](../codebase/737.md) later carried `conversation_id` onward too, as
`conversationId`, the same daemon-asserted-routing-key widening [#724](../codebase/724.md) and
[#732](../codebase/732.md) gave `turn_state` and `stall`; it stops at the renderer timeline bridge, so
`ThreadEvent.apiRetry` keeps its four fields.

[#495](../codebase/495.md) added a fifteenth kind, `compacting` → `compacting` — the PTY-derived status
peer of `stall`/`api_retry` the daemon fans out while claude auto-compacts the conversation (pyrycode
\#1074; detector tui-driver #298). Unlike `api_retry` it is **banner-only**: `CompactingPayload{
conversation_id, active}` carries the explicit falling edge (`active: false`) but no counter, percentage,
or elapsed time — there is nothing on the wire to invent one from. `parseCompactingPayload` is
`parseApiRetryPayload` minus its two `requireNumber` lines; both remaining fields map onto existing
helpers (`requireString` / `requireBoolean`), so no new helper and no numeric-range question arises at
all. At ship time the consumer arm dropped `conversation_id`, carrying only `active` onward — a fresh
two-field decode, one-field emit, `stall`'s content-drop shape rather than `api_retry`'s
carry-three-fields one. Ships dormant; the render slice #496 is the first consumer.
[#742](../codebase/742.md) later carried `conversation_id` onward too, as `conversationId`, the same
daemon-asserted-routing-key widening [#737](../codebase/737.md) gave `api_retry`; it stops at the
renderer timeline bridge, so `ThreadEvent.compacting` keeps its one field.

[#564](../codebase/564.md) added a sixteenth kind, `background_task_started` → `background-task-started` —
the first of three sibling frames (`background_task_updated` #565, `background_task_roster` #566) that
report claude work outliving the turn that spawned it (pyrycode#1240; lane confirmed as the v2 interactive
stream, pyrycode#1394). `BackgroundTaskStartedPayload` scales `parseApiRetryPayload` from four fields to
six: five map onto `requireString`, and the sixth, `truncated_fields: string[] | null`, needed a new field
narrower, `requireStringArrayOrNull`, added directly after `requireStringOrNull`. It widens that helper's
"a literal `null` is a VALUE, not an absence" semantic from a scalar to an array with no extra check: an
omitted key (`undefined`) is neither `null` nor an array, so fail-closed-on-absence falls out of the shape.
Its element check is a bare `typeof === 'string'`, not a record narrower like `parseQueuedItem` — the only
other array narrowing in this file maps elements through a record because its elements *are* records; this
frame's elements are bare wire field names. At ship time, unlike `api_retry`/`compacting` — both of
which still dropped `conversation_id` at the emit — this consumer emit (see [daemon
connection](daemon-connection.md)) **kept** it: the frame carries no `turn_id` and opens/closes no
turn, so it is daemon state (the `queue_state` #720 rule), not a turn-stream item. [#737](../codebase/737.md)
and [#742](../codebase/742.md) later widened `api_retry` and `compacting` too, but for the different
reason of being a daemon-asserted routing key rather than daemon state — the "turn-stream item, or
daemon state?" test (`events.ts`) is what still tells the two families apart.
Ships dormant — [the background-task-roster store (#573, shipped)](../codebase/573.md) consumes only the
`background_task_roster` sibling below, not this arm, which stays dormant awaiting #574.

[#565](../codebase/565.md) added a seventeenth kind, `background_task_updated` → `background-task-updated`
— the second sibling frame, the peer of `background_task_started` joined on `task_id`: that frame opens a
task, this one reports what **changed** about it afterwards. `BackgroundTaskUpdatedPayload` is a strict
subset of `BackgroundTaskStartedPayload` — **four fields, not six**: no `tool_call_id`, no `description`,
no `task_type`, and it gains `patch`, claude's patch object carried whole and unparsed as an opaque
string. `parseBackgroundTaskUpdatedPayload` scales `parseBackgroundTaskStartedPayload` down to three
`requireString` calls plus one `requireStringArrayOrNull` call — **no new field narrower**: #564's
`requireStringArrayOrNull` already encodes this frame's exact `truncated_fields` contract (its docstring
names this ticket verbatim), so it is called, not re-derived or forked. `patch` needs no new helper
either — `requireString`'s bare `typeof` check lets an empty string (`''`, "claude sent no change")
through free, the same type-not-truthiness posture `requireBoolean` documents for `false`, while an
*omitted* `patch` key still fails closed. `patch` is never parsed here: the daemon truncates it at
construction, so a truncated object is no longer valid JSON, and its own golden fixture is cut mid-token
(`{"is_backgrounded":tr`) — the canonical proof that nothing on this path may run `JSON.parse`. Like its
sibling, the consumer emit **keeps** `conversation_id`, and performs **no join** against
`background_task_started`: ordering is claude's, not the daemon's, so an `updated` frame for a task never
seen opened is a legal frame that emits, not something to buffer. Ships dormant — [the
background-task-roster store (#573, shipped)](../codebase/573.md) consumes only the `background_task_roster`
sibling below, not this arm, which stays dormant awaiting #574.

[#566](../codebase/566.md) added an eighteenth kind, `background_task_roster` → `background-task-roster` —
the third and last sibling frame, the **aggregate peer** of the two above: they report what happened to
**one** task, this reports **what is alive**, a snapshot rather than a delta. `BackgroundTaskRosterPayload`
is `{ conversation_id, tasks, dropped_tasks }` — a required string, a required **plain array** (never
`BackgroundTask[] | null`), and a required number. `parseBackgroundTaskRosterPayload` takes `tasks` through
`parseQueueStatePayload`'s inline shape (`Array.isArray` check, then `raw.map(parseBackgroundTask)`), **not**
`requireStringArrayOrNull` — the trap this ticket exists to get right: within this one frame `tasks: null`
must fail closed (`Array.isArray(null)` is `false`) while a **row's** `truncated_fields: null` is a valid
value, because the daemon's only custom `MarshalJSON` normalises a nil `Tasks` to `[]` and deliberately does
not normalise `truncated_fields` the same way. The new row narrower, `parseBackgroundTask`, clones
`parseQueuedItem`'s posture (one bad row fails the whole frame, an empty array is valid, a fresh literal
out) rather than `parseBackgroundTaskStartedPayload`'s shape — the row is **four fields and not the scalar
siblings' four**: no `tool_call_id`, no `patch`. `dropped_tasks` decodes through plain `requireNumber` — the
frame's **only** truncation report (the true roster size is `tasks.length + dropped_tasks`); no new helper,
no cross-check against `tasks.length`. The consumer emit **keeps** `conversation_id`, the same in-family
precedent both siblings established, and passes the already-narrowed row array through **by reference**,
snake_case — the `queue_state` nested-array precedent, not a remap. Ships dormant no longer — [the
background-task-roster store (#573, shipped)](../codebase/573.md) is the first consumer, holding `tasks`/
`droppedTasks` verbatim per `conversationId`.

[#587](../codebase/587.md) added a nineteenth kind, `model_announced` → `model-announced` — claude's own
report of the model it resolved for the turn, off its `system` / `init` line (pyrycode#1616 shape,
\#1638 producer). Not a claude sub-state like `stall`/`api_retry`/`compacting`, and not a daemon mapping
gap like `unrecognized_message`: an **identity** report, carrying no `turn_id` and opening/closing no
turn. `ModelAnnouncedPayload{conversation_id, model, truncated}` is `parseUnrecognizedMessagePayload`'s
shape minus `site`/`message_type` — three fields, all mapping onto existing helpers (`requireString` ×2,
`requireBoolean`), so **no new helper**. `model` is held **verbatim**: no length check, no charset
check, no allow-list, no normalisation — the producer's own 256-byte cap
(`internal/streamsup/parser.go:338`) and the frame-level `MAX_PLAINTEXT_BYTES` backstop already cover
it, and a client-invented rule would silently drop identifiers claude legitimately announces (not
reliably dated, need not appear in any published list). `truncated` goes through `requireBoolean` and is
never optional or defaulted — a defaulting reader would present a cut identifier as a complete one. At
ship time the consumer arm carried `model`/`truncated` onward and dropped `conversation_id` (#588 held a
single value replaced per announcement). [#714](../codebase/714.md) later carried `conversation_id`
onward too, as `conversationId` — the same daemon-asserted-routing-key widening
[#724](../codebase/724.md)/[#732](../codebase/732.md)/[#737](../codebase/737.md)/[#742](../codebase/742.md)
gave the other four turn-stream-adjacent arms, and the last one in the family. It stops at the
announced-model bridge (`translateModelAnnounced`), so [the announced-model
store](announced-model-store.md) is unaffected — still holding one value, still not deduped. Ships dormant
no longer: [the announced-model store (#588, shipped)](announced-model-store.md) is the first consumer,
still dormant pending #560's render surface.

## Where it lives

`src/main/transport/inboundMessage.ts` — sibling to `helloExchange.ts` (handshake `hello` / `hello_ack`) and `sendMessageEnvelope.ts` (outbound builder). **Main-process only:** it imports the [wire codec](wire-codec.md) (`codec.ts`, transitively Node `Buffer`) and the payload it narrows carries message plaintext. It is never re-exported through a renderer barrel — the plaintext and raw bytes must stay out of the web layer.

Crucially, it is **IPC-free**: it never imports `DaemonEvent` or `emitDaemonEvent`. The `transport/` directory holds the wire boundary; the [daemon connection](daemon-connection.md) — one level up at top-level `src/main/` — owns the IPC mapping. This preserves the placement rule [#62](../codebase/62.md) established (a module that imports both a `transport/` primitive **and** the IPC layer must sit above `transport/`).

## Public contract

```ts
// Which modeled app-message the envelope carried. NOT a wire type and NOT a DaemonEvent —
// an internal transport result the daemon-connection consumer maps onto the IPC channel.
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }   // #116, additive
  | { kind: 'bundle-done'; total: number }                    // #116, additive
  | { kind: 'daemon-error'; inReplyTo?: number }               // #116, additive — content-free; inReplyTo added by #269
  // { kind: 'snapshot'; snapshot: ScreenSnapshotPayload } — #180, additive; REMOVED #622
  | { kind: 'assistant-delta'; delta: AssistantDeltaPayload }  // #199, additive
  | { kind: 'turn-end'; turnEnd: TurnEndPayload }              // #199, additive
  | { kind: 'conversations'; conversations: ConversationSummary[] }  // #139, additive
  | { kind: 'turn-state'; turnState: TurnStatePayload }         // #214, additive
  | { kind: 'stall'; stall: StallPayload }                      // #315, additive
  | { kind: 'api-retry'; apiRetry: ApiRetryPayload }            // #492, additive — NOT nullary
  | { kind: 'compacting'; compacting: CompactingPayload }       // #495, additive — banner-only
  | { kind: 'model-announced'; modelAnnounced: ModelAnnouncedPayload }  // #587, additive — identity report
  | { kind: 'tool-use'; toolUse: ToolUsePayload }               // #217, additive
  | { kind: 'modal-shown'; modalShown: ModalShownPayload }      // #201, additive
  | { kind: 'modal-dismissed'; modalDismissed: ModalDismissedPayload }  // #201, additive
  | { kind: 'tool-result'; toolResult: ToolResultPayload }      // #229, additive
  | { kind: 'conversation-created'; conversationCreated: ConversationCreatedPayload }  // #241, additive
  | { kind: 'session-transition'; sessionTransition: SessionTransitionPayload }  // #254, additive
  | { kind: 'session-settings-updated'; sessionSettingsUpdated: SessionSettingsUpdatedPayload; inReplyTo?: number }  // #264, additive; inReplyTo added by #261
  | { kind: 'background-task-started'; backgroundTaskStarted: BackgroundTaskStartedPayload }  // #564, additive
  | { kind: 'background-task-updated'; backgroundTaskUpdated: BackgroundTaskUpdatedPayload }  // #565, additive
  | { kind: 'background-task-roster'; backgroundTaskRoster: BackgroundTaskRosterPayload }  // #566, additive

// Decode + route + narrow one decrypted app-message plaintext:
//  • InboundDaemonMessage  — a `message`/`message_chunk`/bundle/`error`/
//                            `assistant_delta`/`turn_end`/`conversations`/`turn_state`/`stall`/
//                            `api_retry`/`compacting`/`model_announced`/`tool_use`/`modal_shown`/
//                            `modal_dismissed`/`tool_result`/`conversation_created`/`session_transition`/
//                            `session_settings_updated`/`background_task_started`/
//                            `background_task_updated`/`background_task_roster`
//                            envelope, fully narrowed (`screen_snapshot` was modeled here #180-#622;
//                            removed, now falls to the unmodeled `default` arm)
//  • null                  — a well-formed envelope of any OTHER type (ignored)
//  • throws WireDecodeError — oversized / malformed / unparseable / mistyped payload (fail-closed)
export function parseInboundMessage(
  plaintext: Uint8Array,
  diagnosticLog?: DiagnosticLog       // #130 — optional injected content-free logger; absent ⇒ silent
): InboundDaemonMessage | null
```

**Extended by [#116](../codebase/116.md), additively.** The `message` / `message_chunk` recognition and narrowing described below are unchanged byte-for-byte. Three more kinds are now recognized *before* the `default` (unmodeled) branch: `debug_bundle_chunk` → `{ kind: 'bundle-chunk', seq, data }` (base64-decoded via the codec's **strict** `base64StdDecode` right at this boundary, so the [reassembler](debug-bundle-reassembly.md) downstream stays byte-pure), `debug_bundle_done` → `{ kind: 'bundle-done', total }`, and `error` → `{ kind: 'daemon-error' }` (content-free — no `ErrorPayload` field is narrowed). A new `requireNumber` helper sits beside `requireString` for the two numeric fields (`seq`/`total`). Modeling `error` is a deliberate, generally-applicable change: it moves from silently-dropped `inbound-unmodeled` to a modeled, content-free `inbound-decoded(code: 'error')` for **every** `error` frame, bundle-related or not — see the diagnostic-logging table below.

**Extended again by [#180](../codebase/180.md), additively; removed by [#622](../codebase/622.md).**
Historical: `screen_snapshot` → `{ kind: 'snapshot', snapshot: ScreenSnapshotPayload }` via
`parseScreenSnapshotPayload`, the [screen snapshot fetch](screen-snapshot-fetch.md) feature's decode
half. It introduced the `requireBoolean` helper (beside `requireString`/`requireNumber`) for the
reply's `yolo` field — checking the value's *type*, never its truthiness, so `false` decoded as a real
value rather than a missing field; that helper is still used by every later boolean field
(`is_error`, `is_promoted`, `active`, …) and outlived the kind that introduced it. Unlike the bundle
kinds, `snapshot` carried the **full** decoded payload — including `text`, the rendered screen —
through this boundary; [#621](../codebase/621.md) deleted the `daemonConnection.ts` consumer arm that
minimised it before emit, and [#622](../codebase/622.md) then deleted the decode itself: `parseInboundMessage`
no longer produces a `snapshot` kind at all, and a `screen_snapshot` envelope now falls to the
`default` arm below like any other unmodeled type.

**Extended a third time by [#191](../codebase/191.md), additively; removed with the kind by [#622](../codebase/622.md).**
Historical: two more required numeric fields joined `ScreenSnapshotPayload` after `yolo` —
`used_tokens` / `window_tokens` (pyrycode/pyrycode#857) — via two more `requireNumber` calls
(`ScreenSnapshotPayload` reached eight always-present fields). `0` decoded as the value `0`, never as
absence — the same discipline the bundle `seq`/`total` had already established, and every later
numeric field (`current`/`total` on `api_retry`, `dropped_tasks`) still follows.

**Extended a fourth time by [#199](../codebase/199.md), additively.** `assistant_delta` → `{ kind: 'assistant-delta', delta: AssistantDeltaPayload }` via `parseAssistantDeltaPayload`, and `turn_end` → `{ kind: 'turn-end', turnEnd: TurnEndPayload }` via `parseTurnEndPayload` — both built on the existing `isRecord`/`requireString`/`requireNumber` helpers verbatim, no new helper needed (neither payload has a boolean). `AssistantDeltaPayload{conversation_id, turn_id, seq, text}` (`seq: 0` and `text: ''` decode as real values, never absences — same type-not-truthiness discipline as `yolo`) and `TurnEndPayload{conversation_id, turn_id, stop_reason}` are both four-or-fewer required strings/numbers, no `omitempty`. These are the two v2 interactive-stream events (pyrycode #607, `protocol-mobile.md`) that will replace the coarse `message` fan-out once [#179](https://github.com/pyrycode/pyrycode-desktop/issues/179) flips the `interactive` capability on — until then this decode path sits Strangler-Fig alongside the coarse path, receiving nothing. **Unlike every kind above, the consumer arm carries the decoded `text` onward rather than minimising it** — see § The consumer arm and [thread timeline](thread-timeline.md) for why this is a deliberate divergence, not a lapse.

**Extended a fifth time by [#139](../codebase/139.md), additively.** `conversations` → `{ kind:
'conversations', conversations: ConversationSummary[] }` via `parseConversationsPayload` +
`parseConversationSummary`, the [conversation list fetch](conversation-list-fetch.md) feature's
decode half. A new `requireStringOrNull` helper sits beside `requireString`/`requireNumber`/
`requireBoolean` for the row's `name` field — the codec's **first nullable** wire field: it admits a
literal `null` as a valid value (a distinct "unnamed" conversation) while still failing closed on a
missing/`undefined`/mistyped field, the same type-not-truthiness discipline `requireBoolean`
established for `yolo`. `is_promoted`/`is_archived` reuse `requireBoolean` verbatim. Every row is
required-present (no `omitempty`); one bad row in the `conversations` array fails the whole reply
closed, mirroring `parseMessageChunkPayload`'s one-bad-element rule (an empty array is valid). Like
`assistant_delta`/`turn_end`, the consumer arm carries the decoded array onward unminimised — but for
a different reason: not because a field is the render payload, but because none of the seven fields
is a secret.

**Extended a sixth time by [#214](../codebase/214.md), additively.** `turn_state` → `{ kind:
'turn-state', turnState: TurnStatePayload }` via `parseTurnStatePayload`, the coarse turn-lifecycle
scalar of the same v2 interactive stream `assistant_delta`/`turn_end` belong to (pyrycode #607/#794,
`protocol-mobile.md`). `TurnStatePayload{conversation_id, state}` mirrors `MessagePayload` in shape —
`conversation_id` via `requireString`, but `state` is narrowed by the **same closed three-way literal
comparison** `parseMessagePayload` uses for `role` (`state !== 'thinking' && state !== 'responding' &&
state !== 'idle'` → throw), *not* `requireString` — a `requireString` would accept any string and
defeat the enum boundary this decode exists to defend. This is the idiom's second instance in the
file; a future closed-enum wire field should reach for it by default. **[#724](../codebase/724.md)
widened the consumer arm to carry `conversation_id` onward** (`conversationId`, copied by name) —
until then it was dropped on a single-active-conversation assumption the desktop sidebar has since
retired. `state` was always kept; there is no content-minimisation question for either field, since a
3-value enum and a daemon-asserted routing key both reach no sink.

**Extended a seventh time by [#217](../codebase/217.md), additively.** `tool_use` → `{ kind: 'tool-use',
toolUse: ToolUsePayload }` via `parseToolUsePayload`, the tool-call enrichment of the same v2 interactive
stream (pyrycode #607, ADR 025, `protocol-mobile.md`). `ToolUsePayload{conversation_id, turn_id,
tool_use_id, name, input_summary}` is five plain strings, all always present — narrowed with **five
`requireString` calls, no enum check** (unlike `turn_state`'s `state`), cloning `parseTurnEndPayload`'s
idiom scaled from three fields to five. At ship time the consumer arm dropped `conversation_id`; `name`
and `input_summary` are opaque daemon display text (the `stop_reason` #199 / `cwd` #139 posture) carried
onward to the render slice ([#218](https://github.com/pyrycode/pyrycode-desktop/issues/218)) verbatim,
never interpreted here. [#763](../codebase/763.md) later carried `conversation_id` onward too, as
`conversationId`, the same daemon-asserted-routing-key widening #751/#752/#724/#732/#737/#742 gave the
other turn-stream and daemon-state arms — copied by name, required never optional, read bare because the
decode's five `requireString` calls already guarantee it (no decode change was needed).

**[#642](../codebase/642.md) widens the `tool_use` payload by a field, not a kind** — the ordinal count
above tracks new members joining `InboundDaemonMessage`, and this ticket adds none. `ToolUsePayload`
gains a sixth, **optional** field, `input?: Record<string, string>` (pyrycode#1678) — the tool's own
input fields,
name → value. Decoded by a new module-private helper, `optionalStringMap`, placed directly after
`requireStringArrayOrNull` (whose posture it rotates from a list to a map): an omitted key decodes as
`undefined` (a pre-#1678 daemon — optional *to the client*, not on the wire), `{}` decodes as a fresh,
distinct empty map, and any present-but-wrong-typed container or any object with a non-string own value
throws the **whole frame** closed, never a partial map. This is the first narrower in the file where the
**daemon chooses the object keys**; the three keys that reach `Object.prototype`'s own members
(`__proto__`, `constructor`, `prototype`) are dropped from the fresh container rather than carried or
thrown on — throwing would let the model suppress its own tool row by naming a parameter `__proto__`,
and the value-type check still runs before the skip, so `{"__proto__": {…}}` throws (non-string value)
rather than being quietly dropped. The failure message is a new category, `malformed optional field:`,
naming only the client-owned field constant — no daemon-supplied key or value is interpolated. Ships
dormant; #643 carries it into the timeline store, #645 draws it.

**Extended an eighth time by [#201](../codebase/201.md), additively.** `modal_shown` → `{ kind:
'modal-shown', modalShown: ModalShownPayload }` via `parseModalShownPayload`, and `modal_dismissed` →
`{ kind: 'modal-dismissed', modalDismissed: ModalDismissedPayload }` via `parseModalDismissedPayload` —
the transport slice of the [modal-prompt model](modal-prompt-model.md) vertical (pyrycode
`protocol-mobile.md § Modal (v2)`, SSOT #701, ADR 0009). Two new pieces beyond the established idioms:

- **A second field in the same payload closed by the `role`/`state` literal-comparison idiom.**
  `class` (`ModalShownPayload`) and `source` (`ModalDismissedPayload`) each get their own closed
  three-way (well, two-way for `class`) `!==` chain — `cls !== 'permission' && cls !== 'trust'` → throw
  — never `requireString`, which would silently defeat the enum boundary. `outcome` on
  `ModalDismissedPayload` stays a plain `requireString` (opaque — an option id or a producer sentinel,
  never enum-checked).
- **A new per-element narrower mapped over a nested ordered array.** `ModalShownPayload.options` must
  be `Array.isArray`, then `raw.map(parseModalOption)` — `parseModalOption` is a fresh two-`requireString`
  narrower (`id`/`label`), cloning `parseConversationsPayload`'s `raw.map(parseConversationSummary)`
  shape. One bad option element throws the whole `modal_shown` frame closed; an empty array is
  tolerated (the `conversations` precedent).

**Neither payload carried `conversation_id`** at ship time — `modal_id` was the sole correlation key
(a one-time nonce; ADR 0009), so at #201 there was no "which field does the consumer arm drop" question
to answer for identity. `title`/`prompt`/each `options[].label` are untrusted `claude`-surfaced free
text carried onward unminimised (the `assistant_delta`/`tool_use` posture, not `screen_snapshot`'s) —
the render slice ([#224](https://github.com/pyrycode/pyrycode-desktop/issues/224)) must render them as
plain text.

**[#870](../codebase/870.md) mirrors the daemon's `ModalShownPayload.ConversationID` (pyrycode#1065,
merged 2026-07-17) into `ModalShownPayload` and `parseModalShownPayload`** — the field is now first in
wire order, a required `requireString` like every other field on this payload, and fail-closed exactly
like its siblings (absent or non-string → throw before any return). `ModalDismissedPayload` is
untouched and still carries no `conversation_id`; ADR 0009's claim there stands. At this slice the
consumer arm at `daemonConnection.ts` deliberately **dropped the newly-decoded field** — a fresh
named-field literal, no spread — so no renderer-visible surface changed yet;
[#871](../codebase/871.md) is the one that carried it onward as `conversationId`, by name, off the same
fresh literal. Unlike a prior scoping field's arc (`turn_state`,
`stall`, `api_retry`, `model_announced`), where the consumer dropped the field at ship and a *later*
ticket flipped it to carry-onward, `conversation_id` here is an **outbound display-scoping key only** —
the daemon asserts it from its own active-conversation cursor so a client filters which conversation's
prompt it renders, never an authorization signal, and it is **not** cross-checked against any
known-conversation set at decode (a scoping concern for #872, not this decoder, which polices type,
not membership). `modal_id` remains the sole *inbound* correlation key: `modal_answer`/`modal_cancel`
still carry no `conversation_id`, so a client cannot assert which conversation an answer targets — this
change does not loosen that anti-forgery model.

**Extended a ninth time by [#229](../codebase/229.md), additively.** `tool_result` → `{ kind:
'tool-result', toolResult: ToolResultPayload }` via `parseToolResultPayload`, the outcome half of
`tool_use` (#217) and the vertical's last transport slice. `ToolResultPayload{conversation_id, turn_id,
tool_use_id, is_error, result_summary}` is four strings plus one boolean, all always present — narrowed
with **four `requireString` calls plus one `requireBoolean` call** on `is_error` (the `yolo` #180 idiom:
the check is on the *type*, so `is_error: false` decodes as the value `false`, never treated as an
absence — the one delta from `parseToolUsePayload`'s all-string shape). At ship time the consumer arm
dropped `conversation_id`; `result_summary` is opaque daemon display text (the `input_summary` #217
posture) carried onward to the render slice ([#230](https://github.com/pyrycode/pyrycode-desktop/issues/230))
verbatim, never interpreted here. `is_error` is a decoded boolean, not attacker text.
[#766](../codebase/766.md) later carried `conversation_id` onward too, as `conversationId` — the last
arm in the #675 family to do so, completing it — copied by name, required, read bare because the decode
already guarantees it; it stops at the renderer timeline bridge.

The optional second parameter is the [content-free diagnostic logger](diagnostic-log.md) ([#130](../codebase/130.md)). Absent it, the module is silent and behaves exactly as before; injected, each of the two non-throwing outcomes leaves a content-free record (§ *Diagnostic logging*).

A **single throw type** (`WireDecodeError`) covers every failure, so the consumer's one `catch` handles oversized, malformed, unparseable, and mistyped alike — exactly the shape `parseHelloAck` uses for the `hello_ack` boundary.

## How it works

`parseInboundMessage` layers the semantic narrowing the codec deliberately defers (`Envelope.payload` stays `unknown`) onto `decodeEnvelope`'s structural boundary, plus the oversized guard `decodeEnvelope` omits:

1. **Size guard.** `plaintext.length > MAX_PLAINTEXT_BYTES` (65519) → throw. `decodeEnvelope` does **not** size-check, so this is the only thing that fails an oversized-but-valid-JSON frame closed at this boundary. (Belt-and-suspenders: the upstream Noise transport already bounds the plaintext, but this boundary re-checks what it owns — the unit test drives this function directly, and a future driver change must not silently un-bound it. See § Why the explicit size guard.)
2. **`decodeEnvelope(plaintext)`** — inherits the codec's fail-closed rejection of bad UTF-8, malformed JSON, a non-object top-level, and a missing `id` / `type` / `ts` / `payload`.
3. **Route on `envelope.type`:**
   - `'message'` → `{ kind: 'message', message: parseMessagePayload(payload) }`
   - `'message_chunk'` → `{ kind: 'chunk', messages: parseMessageChunkPayload(payload).messages }`
   - `'debug_bundle_chunk'` / `'debug_bundle_done'` / `'error'` → the three additive kinds ([#116](../codebase/116.md), see above) — narrowed and content-free-logged as `inbound-decoded` before the `default` branch is ever reached. `'error'`'s `daemon-error` kind widened with the already-decoded `Envelope.in_reply_to` as `inReplyTo?: number` ([#269](../codebase/269.md)) — propagated, not re-parsed; still no `ErrorPayload` field is narrowed.
   - `'assistant_delta'` → `{ kind: 'assistant-delta', delta }` / `'turn_end'` → `{ kind: 'turn-end', turnEnd }` ([#199](../codebase/199.md)) — narrowed via `parseAssistantDeltaPayload` / `parseTurnEndPayload`, each content-free-logged as `inbound-decoded(code: 'assistant_delta' | 'turn_end')` before the `default` branch. The two v2 interactive-stream kinds that graduate out of `inbound-unmodeled` once #179 flips `interactive` on.
   - `'conversations'` → `{ kind: 'conversations', conversations }` ([#139](../codebase/139.md)) — narrowed via `parseConversationsPayload`, content-free-logged as `inbound-decoded(code: 'conversations')` before the `default` branch — **deliberately no `count` field**, unlike `message_chunk`'s log (a conversation count is more identifying than a message-batch size).
   - `'turn_state'` → `{ kind: 'turn-state', turnState }` ([#214](../codebase/214.md)) — narrowed via `parseTurnStatePayload` (the `role`-style closed-enum check on `state`), content-free-logged as `inbound-decoded(code: 'turn_state')` before the `default` branch. The third v2 interactive-stream kind to graduate out of `inbound-unmodeled`, alongside `assistant_delta`/`turn_end`.
   - `'stall'` → `{ kind: 'stall', stall }` ([#315](../codebase/315.md)) — narrowed via `parseStallPayload` (one `requireString` call, no enum), content-free-logged as `inbound-decoded(code: 'stall')` before the `default` branch. The onset-only liveness signal on the same v2 interactive stream as `turn_state`/`tool_use`; shipped dormant, the render slice #317 is now the first consumer (a sixth owned arm on the timeline bridge).
   - `'api_retry'` → `{ kind: 'api-retry', apiRetry }` ([#492](../codebase/492.md)) — narrowed via `parseApiRetryPayload` (four required fields: one `requireString`, one `requireBoolean`, two `requireNumber` calls, no enum), content-free-logged as `inbound-decoded(code: 'api_retry')` before the `default` branch. The PTY-derived status peer of `stall`, but **not** onset-only (an explicit `active: false` falling edge) and **not** deduped (the rising edge re-fires as the count climbs); shipped dormant, the render slice #493 is now the first consumer.
   - `'tool_use'` → `{ kind: 'tool-use', toolUse }` ([#217](../codebase/217.md)) — narrowed via `parseToolUsePayload` (five `requireString` calls, no enum), content-free-logged as `inbound-decoded(code: 'tool_use')` before the `default` branch. The fourth v2 interactive-stream kind to graduate out of `inbound-unmodeled`.
   - `'modal_shown'` → `{ kind: 'modal-shown', modalShown }` / `'modal_dismissed'` → `{ kind: 'modal-dismissed', modalDismissed }` ([#201](../codebase/201.md)) — narrowed via `parseModalShownPayload` (the `class` closed-enum check + the `parseModalOption`-mapped `options` array) / `parseModalDismissedPayload` (the `source` closed-enum check), each content-free-logged as `inbound-decoded(code: 'modal_shown' | 'modal_dismissed')` before the `default` branch. Not part of the same v2 interactive-stream family as `assistant_delta`/`turn_state`/`tool_use` — a modal is the permission/trust prompt `claude` raises, gated behind the same `interactive` capability. `modal_shown` gained a `conversation_id` field ([#870](../codebase/870.md), pyrycode#1065) — decoded there, and carried across at the consumer emit by [#871](../codebase/871.md); `modal_dismissed` still carries none.
   - `'tool_result'` → `{ kind: 'tool-result', toolResult }` ([#229](../codebase/229.md)) — narrowed via `parseToolResultPayload` (four `requireString` calls plus one `requireBoolean` call on `is_error`), content-free-logged as `inbound-decoded(code: 'tool_result')` before the `default` branch. The fifth and last v2 interactive-stream kind to graduate out of `inbound-unmodeled`, alongside `assistant_delta`/`turn_end`/`turn_state`/`tool_use`.
   - `'session_settings_updated'` → `{ kind: 'session-settings-updated', sessionSettingsUpdated, inReplyTo: envelope.in_reply_to }` ([#264](../codebase/264.md), `inReplyTo` added by [#261](../codebase/261.md)) — narrowed via `parseSessionSettingsUpdatedPayload` (a single `requireString` call, no enum), content-free-logged as `inbound-decoded(code: 'session_settings_updated')` before the `default` branch. The `set_session_settings` (#263) confirmation reply; `inReplyTo` is propagated from the already-decoded `Envelope.in_reply_to`, not re-parsed.
   - anything else → `return null` — a well-formed `ack` / `hello_ack` / `backfill_since` / etc. is **not an error**, it is simply not modeled here. Since [#130](../codebase/130.md) it is also **logged content-free** (`inbound-unmodeled`, § *Diagnostic logging*) before the `return null`, so an unforeseen envelope kind leaves a footprint instead of vanishing; the return value and the "not surfaced to the UI" behavior are unchanged. (`error` was in this bucket until [#116](../codebase/116.md) promoted it to modeled — see above.)

### Payload narrowing

Two private validators (tested through `parseInboundMessage`, never exported), built on two **local copies** of `isRecord` / `requireString` — the same deliberate duplication [`helloExchange.ts`](hello-exchange.md) uses, for the same reason: the codec's `isRecord` is unexported, and copying it keeps this the edge that validates the opaque payload. No shared validators module; `helloExchange.ts` is not refactored.

- **`parseMessagePayload`** — `isRecord` guard, then `conversation_id` / `message_id` / `text` via `requireString`, then a single `role` enum check (`!== 'user' && !== 'assistant'` → throw). That one check subsumes non-string **and** unknown-string, narrowing to `WireRole` without a cast. Returns only the four known fields; unknown server-added keys are tolerated but dropped (forward-compat, matching `parseHelloAck`).
- **`parseMessageChunkPayload`** — `isRecord` guard, `messages` must be `Array.isArray`, then `raw.map(parseMessagePayload)`: **one bad element throws, failing the whole chunk closed.** An **empty array is valid** — a zero-length batch, harmless downstream (the store handles it as a no-op append).

### Category-only error messages

Every `WireDecodeError` names the failure **category only** (`'missing required field: role'`, `'malformed message payload'`, `'inbound plaintext exceeds max size'`) — it **never interpolates a field value**. `role`, `text`, and `conversation_id` are user conversation content; a `` `bad role: ${role}` `` message would echo that content into an error string a future caller might surface. The consumer drops the caught object today, so this is defense-in-depth — but it becomes load-bearing the moment any caller logs the message. Matches `codec.ts` / `helloExchange.ts`.

### Diagnostic logging (#130)

The module's header once declared *"This module performs no logging."* [#130](../codebase/130.md) deliberately flips that invariant **for this file only**, wiring in the merged [content-free diagnostic logger](diagnostic-log.md) ([#126](../codebase/126.md)) so a wire-integrity fault — a message recurring, changing between send and receive, truncating, or arriving as an unforeseen kind — leaves a footprint. Each of the two **non-throwing** outcomes emits one content-free record; the record carries the envelope type, the plaintext byte length, a one-way hash of the frame, and the logger's own monotonic `seq` — **never the payload value or any decoded field**:

| Outcome | Event | Fields |
|---|---|---|
| modeled `message` | `inbound-decoded` | `code: 'message'`, `bytes: plaintext.length`, `hash` |
| modeled `message_chunk` | `inbound-decoded` | `code: 'message_chunk'`, `bytes`, `count: messages.length`, `hash` |
| modeled `debug_bundle_chunk` / `debug_bundle_done` / `error` ([#116](../codebase/116.md)) | `inbound-decoded` | `code: <the type>`, `bytes`, `hash` — never `seq`/`total`/`data`/the daemon's `ErrorPayload` text, and (since [#269](../codebase/269.md) widened `error`'s decode) never its `inReplyTo` either — a routing id, not logged |
| modeled `assistant_delta` / `turn_end` ([#199](../codebase/199.md)) | `inbound-decoded` | `code: 'assistant_delta' \| 'turn_end'`, `bytes`, `hash` — never `text`/`turn_id`/`seq`/`stop_reason`/`conversation_id`, even though the consumer arm carries `text` onward to the renderer (the log stays content-free regardless of what the event carries) |
| modeled `conversations` ([#139](../codebase/139.md)) | `inbound-decoded` | `code: 'conversations'`, `bytes`, `hash` — never `id`/`name`/`cwd`/`is_promoted`/`is_archived`/`last_message_ts`/`last_used_at`, and deliberately **no `count`** |
| modeled `turn_state` ([#214](../codebase/214.md)) | `inbound-decoded` | `code: 'turn_state'`, `bytes`, `hash` — never `state`/`conversation_id` |
| modeled `stall` ([#315](../codebase/315.md)) | `inbound-decoded` | `code: 'stall'`, `bytes`, `hash` — never `conversation_id` |
| modeled `api_retry` ([#492](../codebase/492.md)) | `inbound-decoded` | `code: 'api_retry'`, `bytes`, `hash` — never `conversation_id`/`active`/`current`/`total` |
| modeled `compacting` ([#495](../codebase/495.md)) | `inbound-decoded` | `code: 'compacting'`, `bytes`, `hash` — never `conversation_id`/`active` |
| modeled `tool_use` ([#217](../codebase/217.md), `input` added by [#642](../codebase/642.md)) | `inbound-decoded` | `code: 'tool_use'`, `bytes`, `hash` — never `name`/`input_summary`/`tool_use_id`/`turn_id`/`conversation_id`/`input` (neither its keys nor its values) |
| modeled `modal_shown` / `modal_dismissed` ([#201](../codebase/201.md); `modal_shown` gained `conversation_id` in [#870](../codebase/870.md)) | `inbound-decoded` | `code: 'modal_shown' \| 'modal_dismissed'`, `bytes`, `hash` — never `conversation_id`/`modal_id`/`class`/`title`/`prompt`/any `options[].label`/`default_option_id`/`outcome`/`source` |
| modeled `tool_result` ([#229](../codebase/229.md)) | `inbound-decoded` | `code: 'tool_result'`, `bytes`, `hash` — never `result_summary`/`is_error`/`tool_use_id`/`turn_id`/`conversation_id` |
| modeled `session_settings_updated` ([#264](../codebase/264.md)) | `inbound-decoded` | `code: 'session_settings_updated'`, `bytes`, `hash` — never `session_id` |
| modeled `background_task_started` ([#564](../codebase/564.md)) | `inbound-decoded` | `code: 'background_task_started'`, `bytes`, `hash` — never `conversation_id`/`task_id`/`tool_call_id`/`description`/`task_type`/`truncated_fields`; narrows before logging, so a malformed frame leaves no record |
| modeled `background_task_updated` ([#565](../codebase/565.md)) | `inbound-decoded` | `code: 'background_task_updated'`, `bytes`, `hash` — never `conversation_id`/`task_id`/`patch`/`truncated_fields`, least of all `patch` (whose keys may carry command text); narrows before logging, so a malformed frame leaves no record |
| modeled `background_task_roster` ([#566](../codebase/566.md)) | `inbound-decoded` | `code: 'background_task_roster'`, `bytes`, `hash` — never `conversation_id`/`tasks`/`dropped_tasks`, least of all a row's `description` (a literal command line); deliberately **no `count`** either, though `DiagnosticEvent` already has one — the roster size is itself a fact about the user's session; narrows before logging, so a malformed frame leaves no record |
| modeled `model_announced` ([#587](../codebase/587.md)) | `inbound-decoded` | `code: 'model_announced'`, `bytes`, `hash` — never `conversation_id`/`model`/`truncated`, least of all `model` (claude-authored text that crossed the subprocess trust boundary); narrows before logging, so a malformed frame leaves no record |
| unmodeled (`default`) | `inbound-unmodeled` | `code: envelope.type.slice(0, 64)`, `bytes`, `hash` |

**A removal moves a type's traffic between rows, and can flip whether a malformed frame logs at
all.** `screen_snapshot` was a modeled `inbound-decoded` row through [#621](../codebase/621.md); since
[#622](../codebase/622.md) removed the kind, it logs via the `unmodeled` row instead —
`code: 'screen_snapshot'` still appears (the daemon-supplied `envelope.type`, capped as always), but
the event name changed and, because the modeled arm's fail-closed parser is gone, a **malformed**
`screen_snapshot` now also logs (previously the throw happened before any `event()` call and left no
record at all). The two outcomes are deliberately indistinguishable beyond `bytes`/`hash` — see
[#622's codebase notes](../codebase/622.md) for the test that pins this as a property.

Load-bearing details:

- **Log AFTER the narrower returns.** Each modeled-arm `event()` fires *after* `parseMessagePayload` / `parseMessageChunkPayload` succeeds, so a frame that fails to narrow throws first and produces **no** record. The size guard and `decodeEnvelope` throws also precede the switch. Ordering — not a flag — is what keeps the **throw path unlogged** (the pre-decryption raw-byte case is sibling [#133](https://github.com/pyrycode/pyrycode-desktop/issues/133); a content-free log for the *post-decryption semantic* throw is a deferred open question).
- **`hash` = BLAKE2s-256 of the plaintext FRAME, not `envelope.payload`.** `hashPlaintext` runs `blake2s(plaintext, { dkLen: 32 })` → 64-char hex, over the input bytes. Hashing the whole frame (not just the payload text) is a **security** choice as much as a determinism one: the digest is implicitly salted by the server-assigned `id` / `ts` / `message_id`, so a read-the-log dictionary attack ("did the user type X?") must reconstruct the entire frame, not merely guess the text. `blake2s` comes from `@noble/hashes`, not `node:crypto` — Electron's BoringSSL has no BLAKE2 ([#101](../codebase/101.md)).
- **The one peer-controlled string is capped.** The modeled arms log a **static type literal** into `code`; the unmodeled arm logs the daemon-supplied `envelope.type` — capped `slice(0, MAX_LOGGED_TYPE_CHARS)` (64). Lossless for real wire types (all < 16 chars); a deterministic bound on a hostile daemon that could otherwise stuff up to `MAX_PLAINTEXT_BYTES` of text into `type`. The [#126](../codebase/126.md) serializer JSON-escapes it, so a crafted `type` cannot split one record into two lines.
- **Absent-logger costs nothing.** `diagnosticLog?.event({ … hash: hashPlaintext(plaintext) })` — the `?.` short-circuits the whole call *including* the hash when no logger is injected, so existing callers pay zero and cannot throw (the AC5 backward-compat property, mirroring `relayConnection`).

The allowlist extension is a single additive optional field on `DiagnosticEvent` — `hash?: string`; the length reuses the pre-existing `bytes?`. See [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md) for the allowlist-not-scrubber contract.

### The consumer arm (`daemonConnection.ts`)

The [daemon connection](daemon-connection.md)'s `case 'message'` arm is a thin `InboundDaemonMessage → DaemonEvent` mapper — the module's single IPC choke point. As of [#116](../codebase/116.md) it routes on `inbound.kind` via a `switch`, additively: the `message`/`chunk` arms are unchanged, and the three bundle kinds are routed to the [debug-bundle reassembler](debug-bundle-reassembly.md) instead of the IPC channel (bundle frames emit **no** `DaemonEvent`):

```ts
case 'message': {
  let inbound: InboundDaemonMessage | null
  try {
    inbound = parseInboundMessage(event.plaintext, deps.diagnosticLog)   // #130: thread the logger
  } catch {
    return                                            // fail-closed: drop the frame, no event, no throw
  }
  if (inbound === null) return                        // other envelope type: ignored, no event
  switch (inbound.kind) {
    case 'message':
      emitDaemonEvent(sink, { type: 'messageReceived', message: inbound.message })
      return
    case 'chunk':
      emitDaemonEvent(sink, { type: 'messagesReceived', messages: inbound.messages })
      return
    case 'bundle-chunk':
      reassembler?.chunk(inbound.seq, inbound.data)     // #116: routed to the reassembler, not IPC
      return
    case 'bundle-done':
      reassembler?.done(inbound.total)
      return
    case 'daemon-error':
      reassembler?.fail('daemon-error')
      return
    // case 'snapshot' — emit REMOVED #621, kind itself REMOVED #622. Through #620 this
    // content-minimised text/ts/conversation_id and emitted only the settings fields plus the two
    // usage ints (#191) as `snapshotReceived` (and, since #316, a second
    // `screenSnapshotReceived{text,ts}` widening emit alongside it). Both events, this case, and the
    // `InboundDaemonMessage` kind that fed it are all gone — `inbound.kind` can no longer be
    // `'snapshot'` at all; a screen_snapshot frame is now `null` before this switch is even reached.
    case 'assistant-delta':
      // #199: UNLIKE the old 'snapshot' kind (removed #622), text IS carried onward — it's the render payload, not a secret.
      // #751 widened this arm with conversationId — a daemon-asserted routing key, copied by name, required
      // never optional. It stops at the renderer timeline bridge; ThreadEvent still doesn't carry it.
      // A fresh named-field literal, never a spread of the decoded payload.
      emitDaemonEvent(sink, {
        type: 'assistantDelta',
        turnId: inbound.delta.turn_id,
        seq: inbound.delta.seq,
        text: inbound.delta.text,
        conversationId: inbound.delta.conversation_id
      })
      return
    case 'turn-end':
      // #752 widened this arm with conversationId too, on the same terms as assistant-delta above —
      // copied by name, required never optional. It stops at the renderer timeline bridge;
      // ThreadEvent still doesn't carry it.
      emitDaemonEvent(sink, {
        type: 'turnEnd',
        turnId: inbound.turnEnd.turn_id,
        stopReason: inbound.turnEnd.stop_reason,
        conversationId: inbound.turnEnd.conversation_id
      })
      return
    case 'conversations':
      // #139: nothing to drop (no secret field) — the already-minimal decoded array passes through
      // verbatim, snake_case intact. Mirrors messagesReceived, NOT the snapshot content-drop.
      emitDaemonEvent(sink, {
        type: 'conversationsReceived',
        conversations: inbound.conversations
      })
      return
    case 'turn-state':
      // #214, widened by #724: fresh named-field literal, mirrors 'assistant-delta'. conversationId
      // now crosses too — copied by name, never a spread — as the routing key #674's per-conversation
      // phase needs. It stops at the renderer timeline bridge; ThreadEvent still doesn't carry it.
      emitDaemonEvent(sink, {
        type: 'turnState',
        state: inbound.turnState.state,
        conversationId: inbound.turnState.conversation_id
      })
      return
    case 'stall':
      // #315, widened by #732: fresh named-field literal, mirrors 'turn-state'. conversationId now
      // crosses too — copied by name, never a spread — as the routing key #674's per-conversation
      // liveness needs. It stops at the renderer timeline bridge; ThreadEvent still doesn't carry it.
      // Onset-only; self-clear is #317's concern.
      emitDaemonEvent(sink, {
        type: 'stallDetected',
        conversationId: inbound.stall.conversation_id
      })
      return
    case 'tool-use':
      // #217: fresh named-field literal, mirrors 'turn-state'. name/input_summary carried onward as
      // opaque display text for the render slice. #642 added a sixth field, input — the already-narrowed
      // fresh map, by reference, unconditional (undefined when the wire omitted it; a pre-pyrycode#1678
      // daemon). #763 widened this arm with conversationId too, on the same terms as assistant-delta/
      // turn-end/turn-state/stall above — copied by name, required never optional, read bare because the
      // decode already guarantees it. It stops at the renderer timeline bridge; ThreadEvent still doesn't
      // carry it.
      emitDaemonEvent(sink, {
        type: 'toolUse',
        conversationId: inbound.toolUse.conversation_id,
        turnId: inbound.toolUse.turn_id,
        toolUseId: inbound.toolUse.tool_use_id,
        name: inbound.toolUse.name,
        inputSummary: inbound.toolUse.input_summary,
        input: inbound.toolUse.input
      })
      return
    case 'modal-shown':
      // #201: fresh named-field literal. options reused verbatim (parseModalOption already stripped
      // each to {id,label}). #871 widened this arm with conversationId — the payload's
      // conversation_id (pyrycode#1065, decoded by #870), copied by name and read bare, since
      // parseModalShownPayload already requires it. Outbound scoping only; it stops at the modal
      // bridge (#223), dormant until #872.
      emitDaemonEvent(sink, {
        type: 'modalShown',
        conversationId: inbound.modalShown.conversation_id,
        modalId: inbound.modalShown.modal_id,
        class: inbound.modalShown.class,
        title: inbound.modalShown.title,
        prompt: inbound.modalShown.prompt,
        options: inbound.modalShown.options,
        defaultOptionId: inbound.modalShown.default_option_id
      })
      return
    case 'modal-dismissed':
      // #201: fresh named-field literal. NO conversation_id — a dismissal carries none (modal_shown
      // does, and rides it across as of #871).
      emitDaemonEvent(sink, {
        type: 'modalDismissed',
        modalId: inbound.modalDismissed.modal_id,
        outcome: inbound.modalDismissed.outcome,
        source: inbound.modalDismissed.source
      })
      return
  }
  return
}
```

The caught `WireDecodeError` is **dropped** (classify-don't-forward): its message could echo message plaintext, so it never reaches a log or an event. A bundle frame with no active (or already-settled) `reassembler` is a no-op via optional chaining — preserving the pre-#116 drop behavior when no bundle request is in flight.

## Data flow

```
relay socket → supervisor → noiseRelayDriver (Noise decrypt)
  → RelaySessionEvent{ type:'message', plaintext }
    → daemonConnection.onDriverEvent  case 'message'
      → parseInboundMessage(plaintext)     [transport: size guard + decodeEnvelope + route + narrow]
        ├─ throw  → catch → drop (no event)
        ├─ null   → ignore (no event)
        ├─ {kind:'message'} → emitDaemonEvent messageReceived
        └─ {kind:'chunk'}   → emitDaemonEvent messagesReceived
          → DAEMON_EVENT_CHANNEL → #19 bridge → #2 store (appendUnique: dedupe + order)
```

## Error handling

| Layer | Result | Failure behavior |
|---|---|---|
| `parseInboundMessage` (transport) | `InboundDaemonMessage \| null` | Throws a single type — `WireDecodeError` — on oversized / malformed / unparseable / mistyped. `null` for a well-formed but unmodeled envelope type (**not** a failure). |
| `case 'message'` arm (consumer) | `void` | `try/catch` → a throw is **dropped silently** (no event, no log, caught object not forwarded); `null` → ignored; a result → exactly one `DaemonEvent`. **Never throws out of the module.** |
| UI | — | A dropped inbound frame surfaces **nothing** (no `failed`, no banner). A single malformed *message* frame is not connection-fatal — the session continues. Deliberately different from a malformed `hello_ack`, which **is** fatal (`failed('malformed-hello-ack')`) because the handshake cannot complete without it. |

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS**. This is the "hostile daemon response" trust boundary — decrypted bytes from a relay peer on an internet-exposed surface.

- **A single explicit boundary.** `payload: unknown` never escapes `parseInboundMessage`; downstream (the consumer arm, `DaemonEvent`, the store) holds only concrete wire types. Envelope metadata (`id` / `ts` / `in_reply_to` / `event_id`) is never forwarded — only `type` (for routing) and the narrowed payload cross.
- **Fail-closed on every hostile shape.** Malformed / oversized / unparseable / mistyped / unknown-`role` / non-array `messages` / one-bad-element chunk each drops the frame — no partial value ever surfaces.
- **Content-free-log by construction, secret-safe.** No `console.*` on any path; category-only `WireDecodeError` messages carry no field value; the consumer drops the caught object. Since [#130](../codebase/130.md) the module *does* log — but only a content-free record (type + `seq` + length + one-way hash), never a payload byte or a decoded field: the modeled arms log a static type literal, the unmodeled arm a **capped** peer type, and every record's `hash` is a full-frame BLAKE2s digest implicitly salted by the server-assigned `id`/`ts`/`message_id` (so the log can't confirm a guessed message). Pinned by a six-method `console`-spy (still green — #130 logs via the injected sink, never `console`), an assertion that a thrown message never contains the `role` / `text` / `conversation_id` value, and an AC4 test asserting the serialized log line contains the hash but **neither** planted secret. Message *content* reaching the renderer is the **intended data path**, not a leak — the [#18](../codebase/18.md) `DaemonEvent` union cannot hold a token/key/raw frame by construction.
- **Bounded per-frame work.** The size cap makes work O(size) with size capped; a `message_chunk` array is inherently small (each complete message > 60 bytes, cap 65519) and aborts on the first bad element. A hostile daemon cannot flood an unbounded frame; deep-nesting JSON fails closed via the codec's `RangeError` catch.

## Edge cases and limitations

- **No dedupe, no reorder — arrival order only.** Two `message` frames with the same `message_id` produce two `messageReceived` events. Ordering and dedupe are the renderer store's responsibility ([`appendUnique`, ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)); this module deliberately does neither.
- **`message_chunk` carries complete messages, not partial tokens** — no token coalescing here (see the store's `SessionAction` doc comment). A chunk is a batch of whole `MessagePayload`s.
- **An empty `message_chunk` emits `messagesReceived` with `[]`.** A zero-length batch is a valid, harmless event. If the daemon is later found to never send empty chunks, dropping them is a trivial future tightening — not this boundary's concern.
- **Unmodeled envelope types are ignored but no longer *silent*.** `ack` / `backfill_since` / etc. still return `null` and emit no `DaemonEvent` — decoding/routing them is out of scope. Since [#130](../codebase/130.md) they *are* logged content-free (`inbound-unmodeled` — capped type + size + hash), so an unforeseen kind leaves a diagnosable footprint even though the runtime behavior is unchanged. `error` was in this bucket until [#116](../codebase/116.md) promoted it to a modeled, content-free `daemon-error` kind (see above) — it is no longer in the unmodeled set.
- **The three bundle kinds emit no `DaemonEvent` at this boundary.** Unlike `message`/`message_chunk`, `bundle-chunk`/`bundle-done`/`daemon-error` never map to a `DaemonEvent` *here* — `parseInboundMessage` only produces the `InboundDaemonMessage` kind; routing it onward is the consumer's ([daemon connection](daemon-connection.md)) job. `bundle-chunk`/`bundle-done` always route to the [debug-bundle reassembler](debug-bundle-reassembly.md)'s injected `BundleConsumer` instead ([#116](../codebase/116.md)). `daemon-error` did too, unconditionally, until [#269](../codebase/269.md): the consumer now correlates its (this ticket's) `inReplyTo` against a pending `set_session_settings` request *first*, and on a match emits `sessionSettingsRejected` instead of routing to the reassembler/modal-FIFO — see [daemon connection](daemon-connection.md) § Set-session-settings rejected correlation. A caller that also waits on daemon events must drive its own wait from the consumer's `complete`/`fail`, not the event sink, for the no-match case.
- **The `snapshot` kind used to emit a *narrower* `DaemonEvent` than it decoded ([#180](../codebase/180.md)/[#191](../codebase/191.md), both removed [#622](../codebase/622.md)).** Historical precedent: `screen_snapshot` decoded all eight fields here but the consumer arm emitted only five (`model`/`effort`/`yolo`/`used_tokens`/`window_tokens`) — `text`/`ts`/`conversation_id` were dropped at `daemonConnection.ts`, not at this boundary. See [screen snapshot fetch](screen-snapshot-fetch.md) for the full history; the kind and its decode no longer exist.
- **`assistant-delta`/`turn-end` deliberately broke that narrowing pattern ([#199](../codebase/199.md)).** The consumer arm carries `turn_id`/`seq`/`text` (renamed to camelCase) or `turn_id`/`stop_reason` onward in full — `text` is the render payload, not a secret to minimise. Don't generalize "new inbound kind ⇒ the consumer strips fields" from the old `snapshot` precedent; check whether the field is sensitive-to-the-renderer (drop it, like `screen_snapshot.text` used to be) or is the thing the renderer exists to show (carry it, like this). [#751](../codebase/751.md) carried `conversation_id` onward as `conversationId` too, by name, required — the same routing-key widening the four status arms already had — and [#752](../codebase/752.md) did the same for `turn-end` next; both v2 interactive-stream arms now forward it on identical terms.
- **`assistant_delta`/`turn_end` were received by nobody through #178.** Desktop withheld the `interactive` capability until [#179](../codebase/179.md) turned it on; until then these two cases were exercised only by direct unit tests, not a live daemon — a textbook Strangler-Fig: the decode path existed and was tested before the traffic that would use it did. Now live.
- **`conversations` has no request trigger yet either, but for a different reason.** [#139](../codebase/139.md) ships both the decode path *and* the outbound `requestConversations` command, but nothing in this ticket calls `sendCommand({type:'requestConversations'})` — that's [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208)'s on-connect trigger. Unlike `assistant_delta`/`turn_end`, this is blocked only on a sibling renderer ticket, not a daemon capability flip — the daemon would answer today if asked.
- **`turn_state` was received by nobody through #178, for the same reason as `assistant_delta`/`turn_end`.** [#214](../codebase/214.md) sat on the same `interactive`-capability gate, live since [#179](../codebase/179.md). Unlike those two, its consumer arm has nothing to carry-vs-drop debate over: `state` is a closed 3-value enum, so there's no sensitive-vs-render-payload distinction to make; only `conversation_id` is dropped.
- **`stall` sat on the same `interactive`-capability gate, live since #179.** [#315](../codebase/315.md) mirrors `turn_state`'s decode shape (a single `requireString`, no enum); `StallPayload` has only the one field, `conversation_id`. At ship time the consumer arm dropped it, emitting a nullary `stallDetected` — zero decoded daemon data crossed IPC, the strongest content-minimisation posture of any kind in the file at the time. [#732](../codebase/732.md) later carried `conversation_id` onward as `conversationId`, the same daemon-asserted-routing-key widening [#724](../codebase/724.md) gave `turn_state`; it stops at the renderer timeline bridge. Onset-only throughout: the daemon does not repeat it while the stall persists and sends no "cleared" frame; the client-side self-clear on next turn activity is the render slice [#317](https://github.com/pyrycode/pyrycode-desktop/issues/317)'s concern, not this boundary's.
- **`tool_use` was received by nobody through #178, same capability gate — and its two untrusted strings forward a render constraint.** [#217](../codebase/217.md) sat on the same `interactive`-capability gate, live since [#179](../codebase/179.md). Like `assistant_delta`/`turn_end` (and unlike `turn_state`), the consumer arm carries content onward rather than minimising it: `name`/`input_summary` are opaque daemon-supplied strings that reach the render slice ([#218](../codebase/218.md)) as free text — rendered as plain text, never `dangerouslySetInnerHTML`, never re-parsed.
- **`modal_shown`/`modal_dismissed` were received by nobody through #178, same capability gate.** [#201](../codebase/201.md) sat on the same `interactive`-capability gate, live since [#179](../codebase/179.md). The session and timeline bridges still discard the resulting `DaemonEvent` arms as `null` — the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md) ([#223](../codebase/223.md), shipped), with `useModalBridge` mounted since [#224](../codebase/224.md). `title`/`prompt`/each `options[].label` are untrusted `claude`-surfaced free text the render slice (#224) renders as plain text, the same constraint `tool_use` forwards.
- **`default_option_id ∈ options[].id` is not cross-checked at this boundary.** `ModalShownPayload.default_option_id` decodes as a required string with no structural relationship enforced to `options`. A daemon sending a mismatched default is not rejected here — the cross-field invariant is deferred to the render slice ([#224](https://github.com/pyrycode/pyrycode-desktop/issues/224)), where a mismatch just means nothing pre-highlights (harmless; answering still needs an explicit user action).
- **`tool_result` was received by nobody through #178, same capability gate — it was the vertical's last kind to graduate.** [#229](../codebase/229.md) sat on the same `interactive`-capability gate, live since [#179](../codebase/179.md). Like `tool_use`, `result_summary` is opaque daemon-supplied text that reaches the render slice ([#230](../codebase/230.md)) as free text — rendered as plain text, never `dangerouslySetInnerHTML`. Unlike every prior kind, one field (`is_error`) is a **boolean**, decoded via `requireBoolean` rather than `requireString` or a closed-enum `!==` chain — the type check alone distinguishes a smuggled non-boolean from the valid value `false`.
- **`session_settings_updated` is the simplest kind in the file — one required string, nothing else.** [#264](../codebase/264.md) is the write-confirmation counterpart of `set_session_settings` (#263): the reply echoes no applied settings, so there is no enum, no nullable, and (unlike `session_transition`) nothing for the consumer arm to drop at the emit — the decoded payload and the emitted event carry the identical one field. [#261](../codebase/261.md) added the optional `inReplyTo` carrier — the first field this kind gained after shipping, and the first `InboundDaemonMessage` kind to carry envelope-level (not payload-level) data. Its consumer is the [Run configuration write store](run-settings-write-store.md) ([#256](../codebase/256.md), shipped).
- **`daemon-error` gained the same envelope-level `inReplyTo` carrier as `session-settings-updated`, but on the file's *original* content-free kind.** [#269](../codebase/269.md) widens `{ kind: 'daemon-error' }` ([#116](../codebase/116.md)) with `inReplyTo?: number`, propagated the same way #261 propagated it onto `session-settings-updated` — never re-decoded, no `ErrorPayload` field ever parsed. Unlike every other kind's widen, this one changes what the *consumer* does with an existing `InboundDaemonMessage → DaemonEvent` mapping rather than adding a new mapping: see the bundle-kinds bullet above and [daemon connection](daemon-connection.md) § Set-session-settings rejected correlation.

### Why the explicit size guard, given the transport already bounds the plaintext

A Noise transport message is ≤ 65535 bytes, so a single decrypted plaintext is structurally ≤ `MAX_PLAINTEXT_BYTES`. But this module's trust boundary is its **own function argument**, not the socket: the unit test drives `parseInboundMessage` directly (the transport cap is not in the loop), and a future change to the driver's guarantees must not silently un-bound this arm. The guard is one deterministic line, directly satisfies the "oversized" AC, and is testable at this boundary — belt (upstream Noise cap) and suspenders (this check), both deterministic code. It does **not** modify `decodeEnvelope` (shared with the ack path), so there is no drift.

## Related

- [#68 codebase notes](../codebase/68.md) — implementation summary, patterns, lessons (the boundary's introduction).
- [Debug-bundle reassembly (inbound)](debug-bundle-reassembly.md) / [#116 codebase notes](../codebase/116.md) — the additive extension of this boundary: three new recognized kinds, the `error`-modeling change, and the `requireNumber` narrowing helper.
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180 codebase notes](../codebase/180.md) — the second additive extension: the `snapshot` kind, `parseScreenSnapshotPayload`, and the new `requireBoolean` helper; the content-minimisation drop of `text`/`ts`/`conversation_id` happened one layer up in [daemon connection](daemon-connection.md), not here. Removed by [#622](../codebase/622.md).
- [#191 codebase notes](../codebase/191.md) — the third additive extension: two more `requireNumber` fields (`used_tokens`/`window_tokens`) on `ScreenSnapshotPayload`. Removed with the rest of the type by [#622](../codebase/622.md).
- [#622 codebase notes](../codebase/622.md) — removed the `screen_snapshot` kind, `parseScreenSnapshotPayload`, and the `ScreenSnapshotPayload`/`screen_snapshot` wire types outright; the last of #180/#191's additions to fall. A `screen_snapshot` frame now routes through the `default` (unmodeled) arm, pinned by test rather than assumed, given the open `EnvelopeType | string` union.
- [#199 codebase notes](../codebase/199.md) — the fourth additive extension: `assistant_delta`/`turn_end`, the two v2 interactive-stream kinds, and the deliberate content-carrying divergence from the `snapshot` kind's minimisation pattern.
- [Conversation list fetch](conversation-list-fetch.md) / [#139 codebase notes](../codebase/139.md) — the fifth additive extension: the `conversations` kind, `parseConversationSummary`/`parseConversationsPayload`, and the new `requireStringOrNull` helper (the codec's first nullable-field checker).
- [Conversation timeline store](conversation-timeline-store.md) / [#214 codebase notes](../codebase/214.md) — the sixth additive extension: the `turn_state` kind, `parseTurnStatePayload`, and the closed-enum idiom's second instance (cloned from `role`, not `requireString`).
- [#315 codebase notes](../codebase/315.md) — the thirteenth additive extension: the `stall` kind, `parseStallPayload` (`turn_state`'s decode shape scaled to one field, no enum), and the onset-only liveness signal whose consumer arm, at ship time, emitted a nullary `stallDetected` — the strongest content-minimisation posture in the file, since the one decoded field was the one dropped.
- [#732 codebase notes](../codebase/732.md) — widened the `stallDetected` consumer arm to carry `conversation_id` onward as `conversationId`, replacing the retired "nullary ⇒ nothing can ride it" doc claim with the daemon-asserted-routing-key argument; the id stops at the renderer timeline bridge, and `ThreadEvent.stallDetected` stays nullary.
- [#317 codebase notes](../codebase/317.md) — the render slice: consumes `stallDetected` as the timeline bridge's sixth owned arm, feeding the new `stalled` scalar `StallIndicator` renders.
- [#492 codebase notes](../codebase/492.md) — the fourteenth additive extension: the `api_retry` kind, `parseApiRetryPayload` (`parseStallPayload`'s one-field template scaled to four, every field mapping onto an existing helper — `requireString`/`requireBoolean`/two `requireNumber` calls, no new check invented), and the not-onset-only, not-deduped peer of `stall` — the consumer arm carries `active`/`current`/`total` onward instead of emitting a nullary literal.
- [#493 codebase notes](../codebase/493.md) — the render slice: the first consumer of `api_retry`, feeding a new `apiRetry: ApiRetryStatus | null` timeline-store scalar cleared only by the decoded `active: false` falling edge.
- [#495 codebase notes](../codebase/495.md) — the fifteenth additive extension: the `compacting` kind, `parseCompactingPayload` (`parseApiRetryPayload` minus its two `requireNumber` lines), the banner-only peer of `api_retry` with no counter to carry, and the `stall` content-drop shape (one field dropped, one field carried) rather than `api_retry`'s three-field carry. Ships dormant; the render slice #496 is the first consumer.
- [Conversation timeline store](conversation-timeline-store.md) / [#217 codebase notes](../codebase/217.md) — the seventh additive extension: the `tool_use` kind, `parseToolUsePayload`, and the required-string-presence idiom scaled to five fields with no enum.
- [#642 codebase notes](../codebase/642.md) — a field, not a kind, added to `ToolUsePayload`: the sixth, optional `input`, the new `optionalStringMap` helper (`requireStringArrayOrNull`'s posture rotated from a list to a map), and the reserved-key-drop prototype-pollution defence — the first narrower in this file where the daemon chooses the object keys.
- [Modal-prompt model](modal-prompt-model.md) / [#201 codebase notes](../codebase/201.md) — the eighth additive extension: the `modal_shown`/`modal_dismissed` kinds, `parseModalShownPayload`/`parseModalDismissedPayload`/`parseModalOption`, the closed-enum idiom's third and fourth instances (`class`/`source`), and the array-of-structs narrower's second use (`options`).
- [Conversation timeline store](conversation-timeline-store.md) / [#229 codebase notes](../codebase/229.md) — the ninth and last additive extension of the v2 interactive-stream family: the `tool_result` kind, `parseToolResultPayload`, and `requireBoolean`'s second use (`is_error`, after `yolo` #180) alongside four `requireString` calls.
- [Conversation create](conversation-create.md) / [#241 codebase notes](../codebase/241.md) — the tenth additive extension, the write-side twin of #139: the `conversation_created` kind, `parseConversationCreatedPayload`, and `requireStringOrNull`'s second use (`name`) alongside `requireBoolean` (`is_promoted`) and four `requireString` calls.
- [#254 codebase notes](../codebase/254.md) — the eleventh additive extension: the `session_transition` kind, `parseSessionTransitionPayload`, the closed-enum idiom's third instance (`reason`, after `state` #214 and `class`/`source` #201), and `requireStringOrNull`'s third use (`workspace_cwd`). The consumer arm ([daemon connection](daemon-connection.md)) drops four of the five decoded fields at the emit — the #180 content-drop model's second application.
- [Session settings send](session-settings-send.md) / [#264 codebase notes](../codebase/264.md) — the twelfth and simplest additive extension: the `session_settings_updated` kind, `parseSessionSettingsUpdatedPayload` (a single `requireString`, no enum, no nullable), and the write-confirmation twin of `session_transition` — the consumer arm drops nothing at the emit, since the reply has only the one field to begin with.
- [#261 codebase notes](../codebase/261.md) — widened the `session-settings-updated` kind with `inReplyTo?: number`, propagating the already-decoded `Envelope.in_reply_to` for [daemon connection](daemon-connection.md)'s correlation lookup.
- [#269 codebase notes](../codebase/269.md) — widened the original `daemon-error` kind ([#116](../codebase/116.md)) with the same `inReplyTo?: number` carrier, letting [daemon connection](daemon-connection.md) correlate a rejection against the same `pendingSettings` map #261 built, ahead of the pre-existing bundle-reassembler and #248 modal-FIFO consumers of that kind.
- [#564 codebase notes](../codebase/564.md) — the sixteenth additive extension: the `background_task_started` kind, `parseBackgroundTaskStartedPayload` (`parseApiRetryPayload` scaled from four fields to six), and the new `requireStringArrayOrNull` field narrower — required-present with a nullable array value, borrowing `parseQueuedItem`'s posture (one bad element fails closed, empty array valid) but not its record-narrower shape, since this frame's array elements are bare strings. First of three sibling frames (#565/#566 follow); the consumer arm keeps `conversation_id`, unlike `api_retry`/`compacting`.
- [#565 codebase notes](../codebase/565.md) — the seventeenth additive extension, the subset twin of #564: the `background_task_updated` kind and `parseBackgroundTaskUpdatedPayload` (`parseBackgroundTaskStartedPayload` scaled from six fields to four — no new field narrower, reuses `requireStringArrayOrNull` unchanged). Gains `patch`, an opaque string never fed to `JSON.parse` (the daemon's own golden fixture is cut mid-token); `requireString`'s bare `typeof` check lets `patch: ''` through free while an omitted `patch` key still fails closed. Second of three sibling frames (#566 follows); the consumer arm keeps `conversation_id` and performs no join against `background_task_started` — ordering is claude's, not the daemon's.
- [#566 codebase notes](../codebase/566.md) — the eighteenth additive extension, the third and last sibling frame: the `background_task_roster` kind and `parseBackgroundTaskRosterPayload` + the new row narrower `parseBackgroundTask`. `tasks` takes `parseQueueStatePayload`'s inline shape (`Array.isArray` + `raw.map`), not `requireStringArrayOrNull` — the trap: `tasks: null` fails closed while a row's `truncated_fields: null` (decoded via the existing `requireStringArrayOrNull`, per row) is a valid value, because the daemon's only custom `MarshalJSON` normalises a nil `Tasks` to `[]` and deliberately does not normalise `truncated_fields`. The row is four fields, not the scalar siblings' four (no `tool_call_id`, no `patch`) — cloned from `parseQueuedItem`'s posture, not `parseBackgroundTaskStartedPayload`'s shape. `dropped_tasks` is the frame's only truncation report, via plain `requireNumber`. Consumer arm keeps `conversation_id` and passes the row array through by reference, snake_case.
- [#587 codebase notes](../codebase/587.md) — the nineteenth additive extension: the `model_announced`
  kind, `parseModelAnnouncedPayload` (`parseUnrecognizedMessagePayload`'s shape minus `site`/
  `message_type` — three fields, no new helper), and the identity-report grouping (no `turn_id`, opens
  and closes no turn) that keeps it out of the `stall`/`api_retry`/`compacting` status cluster despite
  sitting beside it in `InboundDaemonMessage`. `model` is held verbatim (no length/charset check, no
  allow-list); `truncated` is required and never defaulted. Ships dormant no longer: [the announced-model
  store (#588, shipped)](announced-model-store.md) is the first consumer, still dormant
  pending #560's render surface.
- [#714 codebase notes](../codebase/714.md) — the last arm in the `conversationId`-widening family
  (after #724/#732/#737/#742): carries `conversation_id` onward as `conversationId` on the
  `model-announced` consumer emit, copied by name, `parseModelAnnouncedPayload` untouched. Retired the
  arm's arithmetic security clause ("exactly one untrusted string … rather than two") by replacing it
  rather than renumbering it. Stops at the announced-model bridge; [the announced-model
  store](announced-model-store.md) is unaffected.
- [Thread timeline (conversation model)](thread-timeline.md) / [ADR 0008](../decisions/0008-thread-timeline-model.md) — the renderer-local `ThreadEvent`/`reduceTimeline` model these two kinds ultimately feed, once [#202](../codebase/202.md)'s bridge maps this boundary's `assistant-delta`/`turn-end` `DaemonEvent` arms onto it.
- [#130 codebase notes](../codebase/130.md) — the content-free diagnostic logging added at this boundary (`inbound-decoded` / `inbound-unmodeled`); the ticket that flipped this module's "performs no logging" invariant.
- [Content-free diagnostic log](diagnostic-log.md) / [#126](../codebase/126.md) — the logger injected here as the optional 2nd param; `parseInboundMessage` is its third consumer (after the relay leg #127 and daemon leg #128), and the `hash?` field on `DiagnosticEvent` was added additively for this boundary. Allowlist-not-scrubber contract: [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md).
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — hosts the `case 'message'` arm that calls this and maps its result onto the IPC channel; owns the single choke point and the classify-don't-forward discipline this inherits.
- [Hello exchange](hello-exchange.md) / [#10](../codebase/10.md) — `parseHelloAck`, the fail-closed narrowing shape this mirrors (`isRecord` guard → per-field checks → `WireDecodeError`, category-only messages). The local `isRecord` / `requireString` copies follow its precedent.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the outbound sibling under `transport/`; `sendMessageEnvelope.ts`'s header conventions this file mirrors.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — `decodeEnvelope` (structural boundary, `payload: unknown`, `WireDecodeError` source) + the `MessagePayload` / `MessageChunkPayload` / `MAX_PLAINTEXT_BYTES` types this narrows to.
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — the `messageReceived` / `messagesReceived` `DaemonEvent` members this feeds.
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) + [Session store](session-store.md) / [#2](../codebase/2.md) + [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the renderer half that dedupes by `message_id` and preserves arrival order.
- [Noise relay driver](noise-relay-driver.md) / [#50](../codebase/50.md) — surfaces the `message{plaintext}` event this decodes.
- Daemon/mobile peer (QMD `pyrycode-docs`): `internal/protocol` v1 messaging structs (#272 — `MessageChunkPayload.Messages` reuses `MessagePayload`, "same shape as `message.payload`, multiple") + `protocol-mobile.md` § application message types — the Go side that emits the `message` / `message_chunk` envelopes this narrows.
