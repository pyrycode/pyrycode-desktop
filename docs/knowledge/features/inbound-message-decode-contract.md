# Inbound message decode — public contract

The decoder's public surface: what callers pass in, what they get back, and the guarantees attached to each.

Part of [Inbound message decode](inbound-message-decode.md); see that document for what the package does, its edge cases and its links.

# Public contract

```ts
// Which modeled app-message the envelope carried. NOT a wire type and NOT a DaemonEvent —
// an internal transport result the daemon-connection consumer maps onto the IPC channel.
export type InboundDaemonMessage =
  | { kind: 'message'; message: MessagePayload }
  | { kind: 'chunk'; messages: MessagePayload[] }
  | { kind: 'bundle-chunk'; seq: number; data: Uint8Array }   // #116, additive
  | { kind: 'bundle-done'; total: number }                    // #116, additive
  | { kind: 'daemon-error'; inReplyTo?: number; outcome: DaemonErrorOutcome }  // #116, additive; inReplyTo added
                                                                 // by #269; outcome added by #965 — content-free
                                                                 // rule now SCOPED, not absolute (see below)
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
  | { kind: 'question-shown'; questionShown: QuestionShownPayload }  // #884, additive — ships dormant, no consumer arm yet
  | { kind: 'question-dismissed'; questionDismissed: QuestionDismissedPayload }  // #894, additive — ships dormant, no consumer arm yet
  | { kind: 'slash-command-list'; slashCommandList: SlashCommandListPayload }  // #936, additive — ships dormant, no consumer arm yet
  | { kind: 'model-list'; modelList: ModelListPayload }          // #972, additive — ships dormant, no consumer arm yet

// Decode + route + narrow one decrypted app-message plaintext:
//  • InboundDaemonMessage  — a `message`/`message_chunk`/bundle/`error`/
//                            `assistant_delta`/`turn_end`/`conversations`/`turn_state`/`stall`/
//                            `api_retry`/`compacting`/`model_announced`/`tool_use`/`modal_shown`/
//                            `modal_dismissed`/`tool_result`/`conversation_created`/`session_transition`/
//                            `session_settings_updated`/`background_task_started`/
//                            `background_task_updated`/`background_task_roster`/`question_shown`/
//                            `question_dismissed`/`slash_command_list`/`model_list`
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

**[#773](../codebase/773.md) widens `tool_result` by a field, not a kind** — the #642 pattern applied to
a scalar, so decode and carry land in one ticket rather than two, since a scalar has none of #642's
daemon-chosen-keys surface to split off. `ToolResultPayload` gains a sixth field, **optional**,
`result_detail?: string` (pyrycode#2024) — the daemon's short précis of a tool's structured outcome
(`"265 lines"`, `"110 of 1676 lines"`). Decoded by a new module-private helper, `optionalString`, placed
directly after `optionalStringMap` and sharing its posture minus the map walk: an absent key →
`undefined`, a present `string` (`""` included) → returned verbatim, anything else → throws
`WireDecodeError`, reusing `optionalStringMap`'s failure category (`malformed optional field:`), naming
only the field constant. Per the upstream declaration the field carries no `omitempty` — a current
daemon always writes it, empty when there is no count — so `undefined` here means only "a daemon
predating pyrycode#2024"; absence and `''` carry no different *meaning*, but both are carried faithfully
rather than collapsed into each other, since collapsing is the lossy transform this ticket exists not to
perform. The value's alphabet (digits, spaces, ASCII letters) is a statement about an honest producer,
not a wire guarantee, so it is handled exactly like `result_summary`: narrowed to a string and carried,
never alphabet-validated and never parsed for its embedded count — the render slice
([#856](https://github.com/pyrycode/pyrycode-desktop/issues/856)) is the sole consumer and the sole
eventual sink.

**Extended a twentieth time by [#884](../codebase/884.md), additively.** `question_shown` → `{ kind:
'question-shown', questionShown: QuestionShownPayload }` via `parseQuestionShownPayload`, the transport
slice of the [question-shown wire types](question-shown-wire-types.md) vocabulary (#883). The first kind
in the file needing **two nesting levels**: `parseQuestionShownPayload` (`isRecord` guard, two
`requireString` fields, `Array.isArray` on `questions`) maps each element through `parseQuestion` (two
`requireString` fields, `Array.isArray` on `options`, one `requireBoolean` on `multi_select`), which
maps each element through `parseQuestionOption` (two `requireString` fields — no `id`, since claude's
answer protocol selects an option by its `label`). One bad question or one bad option throws the whole
batch closed, the `parseModalOption` posture propagated by nested `.map`; an empty `questions` or
`options` array is tolerated — this decoder polices type, not membership.

**No contract bound is enforced, by design.** No 1–4 question count, no 2–4 option count, and no length
check on any of the four claude-authored strings (`question`/`header`/`label`/`description`) — each is
copied through verbatim. Nothing enforces any of these daemon-side as of 2026-09-01, and `header`'s cap
is documented 12 runes but observed 14 in the one real header ever captured, so rejecting at a length
would reject valid traffic. The wire type's "an over-long field must be a fail-closed reject" caveat
picks between two wrong responses *if* a bound ever becomes enforceable; its operative half today is the
negative one — never silently trim — which copying verbatim satisfies without inventing a threshold.

**Extended a twenty-first time by [#894](https://github.com/pyrycode/pyrycode-desktop/issues/894),
additively.** `question_dismissed` → `{ kind: 'question-dismissed', questionDismissed:
QuestionDismissedPayload }` via `parseQuestionDismissedPayload`, the frame that retires the batch above
— the dismissal half of the same [question-shown wire types](question-shown-wire-types.md) vocabulary.
Flat, one level, four reject branches: an `isRecord` guard then three `requireString` calls
(`question_batch_id`/`outcome`/`source`), mirroring `parseModalDismissedPayload`'s shape minus its
closed `source` enum check. **That is the one deliberate divergence** — `source` stays a plain string
because the producer's dismissal arbiter cannot distinguish a caller disconnect or a daemon shutdown
from the approval window elapsing, so two of the three real terminal paths have no member in
`WireModalSource`'s `{remote, local, timeout}` set at all; closing the enum would reject the only
traffic that exists. `outcome` is likewise carried verbatim, never enum-checked, exactly as
`ModalDismissedPayload.outcome` is. Unknown extra keys (a planted `conversation_id` in the test suite)
are tolerated but not copied — the returned object holds exactly the three known fields, which is also
what keeps a stray correlation key from riding into a consumer that would then hold two.

**Extended a twenty-second time by [#936](https://github.com/pyrycode/pyrycode-desktop/issues/936),
additively.** `slash_command_list` → `{ kind: 'slash-command-list', slashCommandList:
SlashCommandListPayload }` via `parseSlashCommandListPayload` + the new row narrower `parseSlashCommand`
— the decode half of the [slash-command-list wire types](slash-command-list-wire-types.md) vocabulary
(#935). Structurally `parseBackgroundTaskRosterPayload`'s shape exactly (an `isRecord` guard, a required
`conversation_id`, `Array.isArray` + `raw.map` over the rows, a plain `requireNumber` for the dropped
count), trap included: `commands: null` fails the whole frame closed while a row's own
`truncated_fields: null` is a valid value. One new helper: `requireStringArray`, the never-`null` sibling
of `requireStringArrayOrNull` (added by [#564](../codebase/564.md)) — needed because a row's `aliases`
must reject exactly the `null` that its own `truncated_fields`, one field over, accepts.
`requireStringArrayOrNull` is now a one-line delegation to it (`null` → `null`, else
`requireStringArray`), behaviour-identical and covered by the existing #564–#566 tests.
[#937](https://github.com/pyrycode/pyrycode-desktop/issues/937) has since claimed the decoded menu with
a `case 'slash-command-list':` in `daemonConnection.ts`'s inbound switch, emitting it onward as the
`slashCommandList` `DaemonEvent` arm.

**Extended a twenty-fourth time by [#972](https://github.com/pyrycode/pyrycode-desktop/issues/972),
additively.** `model_list` → `{ kind: 'model-list', modelList: ModelListPayload }` via
`parseModelListPayload` + the new row narrower `parseModelOption` — the decode half of the
[model-list wire types](model-list-wire-types.md) vocabulary (#971), `slash_command_list`'s sibling from
the same `initialize` reply. `parseModelOption` is `parseSlashCommand`'s five-field shape scaled to six
(three `requireString` calls, `requireStringArray` for `effort_levels`, `requireBoolean` for
`supports_auto_mode`, `requireStringArrayOrNull` for `truncated_fields`); `parseModelListPayload` clones
`parseSlashCommandListPayload`'s shape exactly, trap included — `models: null` fails the whole frame
closed (`Array.isArray(null)` is `false`) while a row's own `truncated_fields: null` is a valid value.
No new helper: both array checkers already existed, added by [#564](../codebase/564.md) and
[#936](https://github.com/pyrycode/pyrycode-desktop/issues/936). Every string on this frame goes through
`requireString`, never `requireNonEmptyString` — the daemon's all-zero fixture is legal traffic, since
neither struct carries `omitempty` on any key. Full account, including the trust-tier argument that
does **not** transfer from `slash_command_list`'s measured-`0x0a` evidence, in [Extension
history](inbound-message-decode-history.md). Ships dormant: `daemonConnection.ts`'s inbound switch has
no case for `'model-list'` yet.

**[#965](https://github.com/pyrycode/pyrycode-desktop/issues/965) widens `daemon-error` by a field, not a
kind** — the same #642/#773 shape applied to the file's one deliberately content-free kind. Since
[#116](../codebase/116.md) this arm parsed no `ErrorPayload` field at all; that invariant is now
**scoped** rather than absolute, narrowed for the attachment upload leg's six reject codes and still
closed for everything else. A new module-private `narrowDaemonErrorOutcome(payload: unknown):
DaemonErrorOutcome` reads exactly one field, `code`, as a **comparand** in an explicit `switch` — never a
`Record`-keyed lookup, which would make untrusted text a lookup path — and is **total**: it never throws
and has no failure return, the file's one deliberate exception to the throw-on-malformed-payload idiom,
because a thrown `error` frame would silently kill the four correlations `daemonConnection.ts` drives off
this kind (see [Daemon connection — correlation](daemon-connection-correlation.md)). `outcome` is
**required** on the kind, not optional, so a malformed payload lands on `'unclassified'` rather than on
absence. Full account — the six-code table, the `payload:null`-vs-no-`payload`-key split, the fake
daemon's reject-answer counterpart, and a docblock-placement lesson from the first attempt — in
[Daemon error outcome](daemon-error-outcome.md).

The optional second parameter is the [content-free diagnostic logger](diagnostic-log.md) ([#130](../codebase/130.md)). Absent it, the module is silent and behaves exactly as before; injected, each of the two non-throwing outcomes leaves a content-free record (§ *Diagnostic logging*).

A **single throw type** (`WireDecodeError`) covers every failure, so the consumer's one `catch` handles oversized, malformed, unparseable, and mistyped alike — exactly the shape `parseHelloAck` uses for the `hello_ack` boundary.
