# Inbound message decode — extension history (early extensions)

Part of [Inbound message decode — extension history](inbound-message-decode-history.md); see that
document for the split's own rationale. This half covers every additive extension from the boundary's
introduction ([#68](../codebase/68.md)) through `attachment_stored` (#964). Split 2026-09-08 once the
combined history again exceeded the size cap; each entry keeps the wording it had in the parent.

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

[#884](../codebase/884.md) added a twentieth kind, `question_shown` → `question-shown` — the transport
slice of claude's clarifying-question batch (the [question-shown wire types](question-shown-wire-types.md)
vocabulary, #883). Not a status peer of `stall`/`api_retry`/`compacting` and not a v2 interactive-stream
member: it is the question family's own frame, deliberately kept out of `modal_shown`'s payload rather
than grown into it, since a clarifying question has no deny option and `modal_shown`'s
`default_option_id` invariant is total on that field. Three parsers, not one, nested two levels deep —
the first kind in the file to need that: `parseQuestionShownPayload` (`isRecord` guard, two
`requireString` fields, an `Array.isArray` check on `questions`) maps each element through
`parseQuestion` (two `requireString` fields, an `Array.isArray` check on `options`, a `requireBoolean`
on `multi_select`), which itself maps each option through `parseQuestionOption` (two `requireString`
fields, no `id` — claude's answer protocol selects by `label`). One bad option or one bad question
fails the whole batch closed, mirroring `parseModalOption`'s posture, propagated for free by nested
`.map`; an empty `questions` or `options` array is tolerated, the same "type not membership"
posture `parseConversationsPayload` established. `multi_select` is the family's only boolean, so it is
the one field where a truthiness check would have been wrong: `requireBoolean` makes the string
`"false"` fail closed rather than decode as `true`. **No contract bound is enforced by design** — no
1–4 question count, no 2–4 option count, and no length check on any of the four claude-authored strings
(`question`/`header`/`label`/`description`), each copied through verbatim. This reads as contradicting
the wire type's "an over-long field must be a fail-closed reject" caveat until the caveat's own next
section is read: that sentence picks between two wrong responses to a bound that might someday exist,
and none exists today — the daemon enforces no maximum on any of the four strings, and `header`'s cap is
documented 12 runes but observed 14 in the one real header ever captured, so rejecting at 12 would
reject valid traffic. Copying verbatim, never trimming, is what satisfies the caveat's operative half.
Ships dormant and unclaimed: `daemonConnection.ts`'s inbound switch has no `default` arm, so the new
`question-shown` kind decodes and is then simply not matched — no IPC emit, no store consumer. The IPC
carry is [#885](https://github.com/pyrycode/pyrycode-desktop/issues/885).

[#894](https://github.com/pyrycode/pyrycode-desktop/issues/894) added a twenty-first kind,
`question_dismissed` → `question-dismissed` — the frame that retires the `question_shown` batch above,
the dismissal half of the [question-shown wire types](question-shown-wire-types.md) vocabulary.
`QuestionDismissedPayload{question_batch_id, outcome, source}` mirrors `parseModalDismissedPayload`'s
flat three-`requireString` shape minus its closed `source` enum — **deliberately not closed to
`WireModalSource`**, since two of the producer's three terminal paths (a caller disconnect, a daemon
shutdown) have no member in `{remote, local, timeout}` at all, and its single dismissal-arbiter closure
cannot tell the three apart, so every path emits the one landed pair, `outcome: 'unanswered'` /
`source: 'no_answer'`. Closing the enum would reject the only traffic that exists — this decoder
polices type, not membership; the fail-closed *reading* rule (an unrecognised `source` means
resolved-cause-unknown, never an answer) is the eventual consumer's. No `conversation_id` — the batch
nonce is the sole correlation key, unchanged from `question_shown`'s own design. The architect's
security review flags this kind's sharpest finding: the frame's published daemon-asserted provenance is
the honest producer's *promise*, not a property this decode *verifies* — the only check run is `typeof
=== 'string'`, so a compromised daemon can put anything, at any length the frame cap allows, into
`outcome`/`source`. The switch arm's comment states this explicitly so [#895](https://github.com/pyrycode/pyrycode-desktop/issues/895)
(the IPC carry) does not read "decoded" as "sanitized" — and #895's own `DaemonEvent` arm doc comment
restates the same split a second time, since it is the last typed surface before #850's render slice.
`daemonConnection.ts`'s inbound switch now has a `case 'question-dismissed':` (#895), emitting the
`questionDismissed` `DaemonEvent` arm; it still ships with no renderer store reading it, the same
dormancy `question_shown` carried through #885 — see [Daemon event channel — the sealed
union](daemon-event-channel-sealed-union.md).

[#936](https://github.com/pyrycode/pyrycode-desktop/issues/936) added a twenty-second kind,
`slash_command_list` → `slash-command-list` — the fail-closed decode of the workspace's slash-command
menu into the [slash-command-list wire types](slash-command-list-wire-types.md) vocabulary
([#935](https://github.com/pyrycode/pyrycode-desktop/issues/935)), which had shipped dormant. Two new
parsers, the file's first two-level nesting since `question_shown` (#884):
`parseSlashCommandListPayload` (`isRecord` guard, a required `conversation_id`, an `Array.isArray` check
on `commands` mapped through the row parser, a plain `requireNumber` for `dropped_commands`) clones
`parseBackgroundTaskRosterPayload`'s shape exactly, trap included — within one frame `commands: null`
fails closed (`Array.isArray(null)` is `false`) while a row's own `truncated_fields: null` is a valid
value. `parseSlashCommand` narrows the row's five fields and needed one new helper, `requireStringArray`
— the never-`null` sibling of `requireStringArrayOrNull` (now a one-line delegation to it) — because a
row's `aliases` must reject exactly the `null` that `truncated_fields`, one field over, accepts.
Deliberately absent from `parseSlashCommand`: any charset/identifier check on `name` (one measured name
is `__remote-workflow`), any length check on any of the four strings, and any trim/normalise/strip — they
are carried verbatim, since they are **workspace-authored** text (a lower trust tier than the
claude-authored strings `model_list`/`question_shown` carry) that the daemon bounds but does not
sanitize, and `0x0a` is the only sub-`0x20` byte measured across the capture's 51 entries. Nothing
cross-checks `dropped_commands` against `commands.length`, and nothing caps the entry count — two
producer cuts feed the number and either can fire first.
[#937](https://github.com/pyrycode/pyrycode-desktop/issues/937) has since claimed this arm — a
`case 'slash-command-list':` in `daemonConnection.ts`'s inbound switch emits the decoded value onward as
the `slashCommandList` `DaemonEvent` arm, a fresh named-field literal built at the emit rather than a
spread of this decode's payload. See [Daemon event channel — the sealed
union](daemon-event-channel-sealed-union.md). Architect self-review PASS.

[#964](https://github.com/pyrycode/pyrycode-desktop/issues/964) added a twenty-third kind,
`attachment_stored` → `attachment-stored` — the upload leg's one positive terminal, into the
[attachment-stored wire types](attachment-stored-wire-types.md) vocabulary. `parseAttachmentStoredPayload`
is `parseQuestionDismissedPayload`'s shape minus two fields, but its single field goes through a new
helper, `requireNonEmptyString`, not `requireString` — a sibling, not a replacement, since every key is
optional to Go's `encoding/json` and a truncated frame decodes daemon-side to `{"attachment_id": ""}`,
which plain `requireString` would pass as a success naming no transfer. The kind deliberately carries no
`inReplyTo`: correlation rides the payload's `attachment_id`, not the envelope's `in_reply_to`, which
names whichever chunk closed the set — not the highest index, and not predictable — so surfacing it would
hand a consumer a match key that silently never fires. Content-free-logged as `inbound-decoded(code:
'attachment_stored')` before the `default` branch, narrowed before logging so a malformed frame leaves no
record. Ships dormant and unclaimed, the same shape `question_shown`/`slash_command_list` shipped: the
consumer arm below has no case for `'attachment-stored'` yet, and `daemonConnection.ts`'s inbound switch
has no catch-all, so the send driver, [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861)
(not started), is the first intended consumer.
