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
  | { kind: 'compacting'; compacting: CompactingPayload; ts: string }
  | { kind: 'compaction-boundary'; boundary: CompactionBoundaryPayload }
  | { kind: 'model-announced'; modelAnnounced: ModelAnnouncedPayload }  // #587, additive — identity report
  | { kind: 'thinking-progress'; thinkingProgress: ThinkingProgressPayload }  // #1312, additive — a periodic reading, no rising/falling edge, no FrameTimestamp, ships dormant
  | { kind: 'rate-limited'; rateLimited: RateLimitedPayload }    // #1318, additive — a usage-limit window report, `status`/`limit_type` OPEN strings, `resets_at` unvalidated, no FrameTimestamp, ships dormant
  | { kind: 'context-usage'; contextUsage: ContextUsagePayload }  // #1454, additive — the reading (conversation_id/model/total_tokens/max_tokens/percentage); #1455 adds the category breakdown (categories/dropped_categories); mixed provenance, informational (no range/cross-field check), no FrameTimestamp, ships dormant
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
//                            `api_retry`/`compacting`/`compaction_boundary`/`model_announced`/`tool_use`/`modal_shown`/
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

**Compaction reports.** `CompactingPayload` requires string `conversation_id` and
boolean `active`, with optional open-string `compact_result` and `compact_error`.
`parseCompactingPayload` serves live and history decoding: absent outcomes support
older daemons, empty/unknown strings survive, and present non-strings reject the
payload. `CompactionBoundaryPayload` requires string `conversation_id` and `trigger`;
empty and unknown triggers are valid. Each optional nullable token count must be a
non-negative safe integer to survive as a number. Invalid counts become `undefined`
without dropping the boundary; null stays null and zero stays zero. Unknown fields
are discarded, and diagnostics contain only static type, byte count and hash.
The new boundary is live-only; history retains its existing compacting arm.
See [timeline association](conversation-timeline-store.md#what-it-does) and
[count display](conversation-shell-session-and-channel-info.md#compaction-dividers).

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

`assistant_delta` and `turn_end` decode through `parseAssistantDeltaPayload` and
`parseTurnEndPayload`. The former requires `conversation_id`, `turn_id`, `seq` and
`text`; zero sequence and empty text remain values. The latter requires string
`conversation_id`, `turn_id` and `stop_reason`, and preserves optional `outcome`,
`is_error`, `terminal_reason` and `error_category` under the
[stopped-turn compatibility contract](inbound-message-decode.md#optional-stopped-turn-reports).
Wrong-typed or overlong optional reports are omitted without rejecting the boundary;
required-field validation is unchanged. `decodeHistoryEvent` reuses the same parser
and maps the report fields to camelCase, matching live IPC delivery. Both kinds feed
the live [thread timeline](thread-timeline.md); assistant text and stopped-turn
reports deliberately cross IPC as display content, never as diagnostic values.

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

**Extended once more by [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312), additively.**
`thinking_progress` → `{ kind: 'thinking-progress', thinkingProgress: ThinkingProgressPayload }` via
`parseThinkingProgressPayload` — claude's only mid-turn proof of life on the stream-json surface, the
daemon's translation of its `system/thinking_tokens` line (pyrycode#1386, rate-bound to one frame per 64
tokens of accumulated delta). `ThinkingProgressPayload{conversation_id, estimated_tokens,
estimated_tokens_delta}` scales `parseApiRetryPayload`'s shape down from four fields to three and from
one boolean to none: one `requireString` plus two `requireNumber` calls, no new helper.

**A reading, not a state transition** — unlike `api_retry`/`compacting` it has no rising or falling
edge, carries no `turn_id`, and opens/closes no turn; the turn's thinking state is already `turn_state:
thinking`. **Deliberately not range- or monotonicity-checked**: `estimated_tokens` restarts near zero at
every inference-request boundary (four times inside one committed single-turn capture), so a
"the reading only grows" rule would fail-close ordinary traffic — the sharpest instance yet of the house
rule that a client-invented bound on a wire integer risks dropping valid future frames. **Takes no
`FrameTimestamp`** (see below) — the mix-in marks the ten arms `decodeHistoryEvent` draws, and this kind
gains no arm there (AC3, a regression pin: a stored `thinking_progress` still skips).

Content-free-logged as `inbound-decoded(code: 'thinking_progress')` before the `default` branch, and
neither the id nor either number ever reaches a log line — a reading of how much claude thought is a
side-channel on private work. It carries no claude-authored text at all (ADR 025), the one respect in
which it is safer than every sibling in its family: there is nothing here for a render sink to escape.
Ships dormant: `daemonConnection.ts`'s inbound switch has no catch-all, so the reading stops at this
boundary until the carry slice claims it, the same two-step `question_shown` (#884/#885) and
`modal_shown` (#870/#871) already took.

**Extended once more by [#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318), additively.**
`rate_limited` → `{ kind: 'rate-limited', rateLimited: RateLimitedPayload }` via
`parseRateLimitedPayload` — claude's usage-limit window report, the daemon's translation of its
top-level `rate_limit_event` claude line (not a `system/*` subtype like its two neighbours here, which
is why the daemon's own `system`-subtype count excludes it). `RateLimitedPayload{conversation_id,
status, limit_type, resets_at, truncated_fields}` is `parseBackgroundTaskStartedPayload`'s shape minus
two strings plus one number: three `requireString` calls, one `requireNumber` for `resets_at`, and
`truncated_fields` through the existing `requireStringArrayOrNull` — no new helper.

**`status` and `limit_type` are OPEN STRINGS, never closed enums, and here that is a SECURITY decision
as well as the usual no-drift one.** The daemon states the value set beyond the one measured-benign
status is UNMEASURED — no capture of a limit actually in force exists on any claude version — so a
closed set would drop the first real limit that fires, and narrowing either set is the first step of
branching on a value the daemon says a client MUST NOT branch security-relevant behaviour on. The empty
string decodes for both: the producer's cut-to-nothing case, reported by `truncated_fields` rather than
an absence. **`resets_at` is claude's number, unvalidated in both directions** — `0` means claude did
not report a reset instant, never the epoch, and negative/past/absurd magnitudes all decode; rejecting
one would be a validation rule with no captured negative case behind it. The security review named the
sharper hazard for the eventual carry slice: a "limit lifts" timer computed as `resets_at * 1000 -
Date.now()` fires *immediately* both when negative and when past `setTimeout`'s ~24.8-day 32-bit clamp
— `attachment_chunk`'s `total_chunks` "never allocate from a claim" family, one field over. **A FRAME IS
NOT PROOF THAT ANYTHING WAS BLOCKED** — the daemon's own named realistic client bug: the one measured
non-benign status, `allowed_warning` (2026-08-22, claude 2.1.239, `limit_type: seven_day`), fired while
every turn kept running normally, so a carry slice rendering "you are rate limited" would mislead the
operator.

**Takes no `FrameTimestamp`**, the `thinking_progress`/`model_announced` precedent — the mix-in marks
exactly the arms `decodeHistoryEvent` draws, and AC5 keeps this kind armless there (a regression pin:
even a fully well-formed stored `rate_limited` still skips). Content-free-logged as
`inbound-decoded(code: 'rate_limited')` before the `default` branch; neither `conversation_id`, `status`
nor `limit_type` ever reaches a log line — `status`/`limit_type` are claude-authored text that crossed
the subprocess trust boundary, unsanitized, and the pair together discloses the account's quota
posture. Ships dormant, the same two-step already taken for `question_shown` (#884/#885) and
`modal_shown` (#870/#871): `daemonConnection.ts`'s inbound switch has no catch-all, so the report stops
here until the carry slice claims it. This ticket also corrected three comments — the
`UnrecognizedMessagePayload` `WHAT THIS CLIENT DECODES` docblock, `decodeHistoryEvent`'s docblock, and
the AC3 skip-table comment in `inboundMessage.test.ts` — that had named `rate_limited` as the one type
with no parser at all, a claim left behind when [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312)
moved `thinking_progress` off that same list. Full account in [Extension
history](inbound-message-decode-history.md).

**Extended once more by [#1454](https://github.com/pyrycode/pyrycode-desktop/issues/1454), additively.**
`context_usage` → `{ kind: 'context-usage', contextUsage: ContextUsagePayload }` via
`parseContextUsagePayload` — claude's own report of what is in the context window, published after every
turn end on the interactive path (pyrycode#2370 shape / #2371 producer). Decided 2026-09-14: this becomes
the display source, displacing the `session_settings`/`screen_snapshot` transcript-scan route, which reads
0% for a conversation opened in a workspace and whose window half is a guess until a turn ends.
`ContextUsagePayload{conversation_id, model, total_tokens, max_tokens, percentage}` is
`parseRateLimitedPayload`'s shape minus one string and its nullable list plus two numbers: two
`requireString` calls, three `requireNumber` calls, no new helper.

**Extended once more by [#1455](https://github.com/pyrycode/pyrycode-desktop/issues/1455), additively.**
`ContextUsagePayload` gains its first inventory, `categories: ContextUsageCategory[]` plus its own
`dropped_categories: number`, via a per-row narrower, `parseContextUsageCategory`, on the
`parseModelListPayload` / `parseModelOption` pattern: an `isRecord` gate, `Array.isArray`-then-`raw.map`
over the rows, and a plain `requireNumber` for the dropped count. `ContextUsageCategory{name, tokens}`
takes no `Wire` prefix — its bare name is already qualified by its frame, the same reasoning that leaves
`BackgroundTask`/`QueuedItem`/`HistoryEntry` unprefixed despite each colliding with a daemon Go type name.

**`categories` is never `null` and an empty array is a positive statement, not an absence.** The daemon's
`MarshalJSON` normalises a nil slice to `[]` so a client never has to tell the two apart; `null`, an
absent key, or any non-array value fails the whole frame closed (`Array.isArray(null)` is `false`), while
`[]` decodes as claude reporting no categories and stays distinguishable from the `undefined` an
unobserved frame yields. **The rows arrive as a prefix in the producer's descending-token order**, any
cut taking entries off the tail, so a shortened list is never a list with holes. **`dropped_categories` is
independent and not inferable** — it accumulates two separate cuts, the producer's entry and string caps
plus the mapper's own frame-byte budget — so a retained list's length is no evidence of completeness in
either direction and `categories.length + dropped_categories` is the true size, never something to
reconcile; nothing cross-checks the two. One malformed row throws `WireDecodeError` for the whole frame
rather than yielding a partial breakdown, naming the failure category only — never a row's `name`, its
`tokens`, the row's index, or the frame's `conversation_id`.

**Extended once more by [#1459](https://github.com/pyrycode/pyrycode-desktop/issues/1459), additively.**
`ContextUsagePayload` gains its second inventory, `mcp_tools: ContextUsageMCPTool[]` plus its own
`dropped_mcp_tools: number`, via a per-row narrower, `parseContextUsageMCPTool`, one field wider than
`parseContextUsageCategory` and otherwise its shape: an `isRecord` gate, `Array.isArray`-then-`raw.map`
over the rows, a plain `requireNumber` for the dropped count. `ContextUsageMCPTool{name, server_name,
tokens}` takes no `Wire` prefix for the same reason `ContextUsageCategory` does not, and keeps the
acronym capitalised (`MCP`, the protocol's own casing) — `QrPayload` is the repo's only counter-example
and does not govern, since it names a house-side type with no daemon counterpart to mirror.

**The never-null / positive-empty / prefix-order rule and the independent-dropped-count rule both extend
to this second inventory rather than being restated** — the committed fixture's `5` sits beside exactly
two retained rows, same shape as `categories`' `3` beside two. The two inventories are never cross-read:
the daemon divides one envelope across three lists and can cut all three at once, so `dropped_categories`
is no evidence about `dropped_mcp_tools` and neither list's length says anything about the other's.

**What is new is `server_name`, and it is decoded as INERT.** Its name collides with the
actuation-crossing `ServerName` on the daemon's `MCPReconnectPayload`, which crosses an actuation seam
verbatim and is validated by nothing; this one names a contributor to a reading, never an actuation
target, an authorization input, or a value to join against `mcp_status`. `name` carries the same
constraint — a tool definition's label, never a selector. Both strings are narrowed with plain
`requireString`, never `requireNonEmptyString`: that helper exists for a field whose `''` is a *failed
lookup*, and nothing looks either of these strings up, so `''` is a display value the daemon's contract
keeps present rather than a resolution that silently found nothing — the two facts are one decision, to
be revisited together if a later slice ever makes `server_name` a lookup key. The committed fixture's
embedded newline (`query\ndocs`) and `remote<mcp>` metacharacters cross byte-for-byte and unescaped, the
escaping owed at the render sink (#1421), not here — and that embedded newline is why neither string may
reach a log field for an *integrity* reason as well as a privacy one: the diagnostic stream is
line-delimited JSON, so a logged tool name could forge a record.

**THE FRAME CARRIES TWO MORE KEYS THAT ARE STILL DELIBERATELY NOT DECLARED HERE.** `memory_files` and its
own dropped count ride the same wire; `parseContextUsagePayload` returns a fresh nine-field literal, so
the two are tolerated and dropped rather than copied through. A declared-but-unparsed field would put a
type on the wire surface with no narrowing behind it, so the declaration and the parsing of this last
inventory land together in [#1460](https://github.com/pyrycode/pyrycode-desktop/issues/1460), not split
across tickets. `../../../etc/passwd` as a `memory_files` path remains that slice's must-review item.

`name` (on either inventory's rows) is claude-authored descriptive text that crossed the subprocess trust
boundary, bounded by the producer and neither validated nor sanitized upstream — inert text only, safe
to render but never a lookup key, a React `key`, a `Map`-or-plain-object index, a path, a filename or a
log field. Decoding makes the row's *shape* trusted, never its *content*; the committed fixture's
`Messages <&>` (categories) and `query\ndocs` / `remote<mcp>` (MCP tools) each cross byte-for-byte,
unescaped, and the escaping is owed at the render sink (#1421), not here. A category figure and a
per-tool figure both join `model` and the three reading integers in the never-logged set — a per-row
token count discloses how the window is composed, a finer side-channel than the reading's own three
integers.

**PROVENANCE IS MIXED WITHIN THE ONE PAYLOAD**, the field-level fact a reader is likeliest to get wrong:
`conversation_id` is daemon-authored, `model` and every row's `name` are claude-authored descriptive text
that crossed the subprocess trust boundary and are neither validated nor sanitized upstream, and every
`server_name` is workspace configuration inert despite its colliding name (see #1459 above). Assuming one
provenance for the whole struct errs in the harmful direction most of the time — promoting one of these
strings to a checked value. `model` stays inert text: never a lookup key, a Map key, a path, an icon
name, an attribute or a URL, and never an identity to match against a model menu (`model_announced`
remains that authority).

**THE READING IS INFORMATIONAL — no range check and no cross-field check on any of the three integers.**
The daemon neither recomputes nor normalizes claude's figures, so nothing may assume `percentage` is
derivable from `total_tokens` and `max_tokens`; a client that recomputed it would disagree with the figure
claude reported, which is the whole reason this frame displaces the transcript route. `requireNumber`
checks the type, not truthiness, so `0` survives as `0` — exactly what the daemon's committed empty
fixture (`context_usage_empty.json`) carries for all three integers, alongside `''` for both strings via
the same posture in `requireString`. The unguarded-`Infinity` hazard a `max_tokens` of `0` creates belongs
to the render slice (#1421), where `contextUsagePercent` already documents it.

**Takes no `FrameTimestamp`**, the `thinking_progress`/`rate_limited` precedent — the mix-in marks exactly
the arms `decodeHistoryEvent` draws, and this kind gains no arm there (a regression pin: even a
fully well-formed stored `context_usage` still skips). Content-free-logged as `inbound-decoded(code:
'context_usage')` before the `default` branch; neither `conversation_id`, `model`, any row's `name` or
`server_name`, nor any of the three integers ever reaches a log line — `model` and every row's `name` are
unsanitized claude-influenced text, every `server_name` is workspace-configuration disclosure, and the
three integers disclose how much private work is in the window, a side-channel as unwelcome as the
correlating `conversation_id` beside them. Ships dormant, the same two-step already taken for
`question_shown` (#884/#885), `modal_shown` (#870/#871) and `thinking_progress`/`rate_limited`
themselves: `daemonConnection.ts`'s inbound switch has no catch-all, so the reading stops here until the
IPC carry slice claims it. This decode spans four slices replacing #1254's first criterion, on the
`rate_limited` precedent: the reading and category breakdown (#1454/#1455), the MCP-tool inventory here
(#1459), the memory-file inventory (#1460), then IPC carry #1419, store #1420, surfaces #1421. Architect (builder)
self-review PASS, no MUST FIX findings. Full account in [Extension
history](inbound-message-decode-history.md).

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

**[#1225](https://github.com/pyrycode/pyrycode-desktop/issues/1225) widens ten existing arms with a
mixed-in `FrameTimestamp`, not a new kind** — the #642/#773 shape (a widen, not an extension) applied to
a set of arms rather than one. `parseInboundMessage` already has the envelope's `ts` in scope by the time
it builds any of these arms; nothing upstream carried it onward before this ticket.

```ts
interface FrameTimestamp { ts: string }
```

applied inline as `& FrameTimestamp` to exactly the ten arms the timeline draws:
`assistant-delta`/`turn-end`/`turn-state`/`stall`/`api-retry`/`compacting`/`tool-use`/`tool-result`/
`session-transition`/`unrecognized-message`. **Ten, not all twenty-plus** — `history-page` does NOT gain
it, because a page's `ts` is per-**entry** and already carried on `HistoryTimelineEntry` (see [Request
history send](request-history-send.md)); stamping the envelope that carried the page would put the
answer's own clock where the entries' belong. `session-settings`, `conversations`, and every other kind
stay untouched — there is no live/history join for any of them to feed.

**Mixed in per arm, not carried as a bare top-level field on `InboundDaemonMessage`.** Each arm opts in at
its own union member, so the declaration's order and its ticket-by-ticket narrative above stay intact,
and a reader can see which ten carry it without cross-referencing a second list. The value is copied
verbatim from the decoded envelope's own `ts` — required there, since every envelope carries one — and
crosses to `daemonConnection.ts`'s ten emit sites as `daemonTs: inbound.ts`, one field, copied by name.
See [Daemon event channel — emit and subscribe §
`DaemonEventTimestamp`](daemon-event-channel-plumbing.md#daemoneventtimestamp--the-per-frame-comparand-1225)
for the IPC-side shape this feeds and why it is an intersection distributed over `DaemonEvent` rather than
a member added to each arm, and [Conversation timeline store — internals § The history/live
join](conversation-timeline-store-internals.md#the-historylive-join-1225) for what reads it.

The optional second parameter is the [content-free diagnostic logger](diagnostic-log.md) ([#130](../codebase/130.md)). Absent it, the module is silent and behaves exactly as before; injected, each of the two non-throwing outcomes leaves a content-free record (§ *Diagnostic logging*).

A **single throw type** (`WireDecodeError`) covers every failure, so the consumer's one `catch` handles oversized, malformed, unparseable, and mistyped alike — exactly the shape `parseHelloAck` uses for the `hello_ack` boundary.
