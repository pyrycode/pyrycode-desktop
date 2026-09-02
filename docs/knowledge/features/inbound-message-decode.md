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

See [public contract](inbound-message-decode-contract.md), [internals](inbound-message-decode-internals.md),
and [edge cases and limits](inbound-message-decode-limits.md) for the type union, the decode/log detail,
and the fail-closed edge cases respectively.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Public contract](inbound-message-decode-contract.md) — The decoder's public surface: what callers pass in, what they get back, and the guarantees attached to each.
- [Internals](inbound-message-decode-internals.md) — How a frame is actually decoded: payload narrowing, category-only error messages, the diagnostic logging around them, and the consumer arm that drives it.
- [Edge cases and limits](inbound-message-decode-limits.md) — The decoder's edge cases, including why it keeps an explicit size guard when the transport already bounds the plaintext.

## Where it lives

`src/main/transport/inboundMessage.ts` — sibling to `helloExchange.ts` (handshake `hello` / `hello_ack`) and `sendMessageEnvelope.ts` (outbound builder). **Main-process only:** it imports the [wire codec](wire-codec.md) (`codec.ts`, transitively Node `Buffer`) and the payload it narrows carries message plaintext. It is never re-exported through a renderer barrel — the plaintext and raw bytes must stay out of the web layer.

Crucially, it is **IPC-free**: it never imports `DaemonEvent` or `emitDaemonEvent`. The `transport/` directory holds the wire boundary; the [daemon connection](daemon-connection.md) — one level up at top-level `src/main/` — owns the IPC mapping. This preserves the placement rule [#62](../codebase/62.md) established (a module that imports both a `transport/` primitive **and** the IPC layer must sit above `transport/`).

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
- [Question-shown wire types](question-shown-wire-types.md) / [#884 codebase notes](../codebase/884.md)
  — the twentieth additive extension: the `question_shown` kind, three nested parsers
  (`parseQuestionShownPayload`/`parseQuestion`/`parseQuestionOption`, two nesting levels — the first
  kind in the file to need more than one), and the no-bound-by-design posture (no question/option
  count, no length check on any of the four claude-authored strings) that the wire type's own
  neighbourhood reads as contradicting until its "Bounds — deliberately not modelled" section is read
  alongside it. Ships dormant: `daemonConnection.ts`'s inbound switch has no `default` arm, so the new
  kind decodes and is simply unmatched until [#885](https://github.com/pyrycode/pyrycode-desktop/issues/885)
  carries it across IPC.
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
- [Slash-command-list wire types](slash-command-list-wire-types.md) — the
  `SlashCommandListPayload`/`WireSlashCommand` vocabulary ([#935](https://github.com/pyrycode/pyrycode-desktop/issues/935))
  [#936](https://github.com/pyrycode/pyrycode-desktop/issues/936) decodes into the twenty-second kind
  above and [#937](https://github.com/pyrycode/pyrycode-desktop/issues/937) carries onward as a
  `DaemonEvent` arm; [#681](https://github.com/pyrycode/pyrycode-desktop/issues/681) is the still-unclaimed
  renderer consumer, the Actions-menu alias match.
