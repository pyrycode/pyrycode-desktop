# Inbound message decode

The **untrusted→trusted boundary for a decrypted daemon message**. The [Noise relay driver](noise-relay-driver.md) hands each decrypted application frame up as opaque bytes (`RelaySessionEvent{ type: 'message'; plaintext }`); this is the layer that turns those bytes into a narrowed, typed `MessagePayload` the renderer can render — or drops them, failing closed, if a hostile or buggy daemon shaped them wrong. It is the inbound counterpart to the [hello exchange](hello-exchange.md) (`parseHelloAck`) and the [outbound send path](outbound-send-path.md) (`buildSendMessage`): same one-concern-per-file split under `src/main/transport/`.

Introduced in [#68](../codebase/68.md). It fills the last no-op arm the [daemon connection](daemon-connection.md) left behind — [#62](../codebase/62.md) wired the handshake-status path but left the inbound-message arm a `// TODO`. This ticket produces the `messageReceived` / `messagesReceived` events that feed the already-complete renderer pipeline: the [daemon-event channel](daemon-event-channel.md) ([#18](../codebase/18.md)) carries them, the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md)) translates them into `SessionAction`s, and the [session store](session-store.md) ([#2](../codebase/2.md)) appends them (deduped by `message_id`, arrival order preserved).

The decoder also handles interactive events, permission prompts and request replies. The chronological account of earlier extensions lives in [Extension history](inbound-message-decode-history.md); current field contracts and failure behavior are documented below and in the linked topics.

See [public contract](inbound-message-decode-contract.md), [internals](inbound-message-decode-internals.md),
and [edge cases and limits](inbound-message-decode-limits.md) for the type union, the decode/log detail,
and the fail-closed edge cases respectively.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Extension history](inbound-message-decode-history.md) — The chronological, kind-by-kind account of every additive extension to `InboundDaemonMessage`, from [#68](../codebase/68.md) through [#972](https://github.com/pyrycode/pyrycode-desktop/issues/972).
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

### Pairing rejection classification

The decoded `daemon-error` arm carries optional `pairingReject: 'pairing-rejected'` only when
the payload is a record whose `code` exactly equals `auth.invalid_token`. Unknown, suffixed or
mistyped codes leave it undefined; daemon message text is discarded. This category covers expired,
unknown and revoked credentials without claiming which occurred.

Keep it separate from `DaemonErrorOutcome`: that union also drives attachment-transfer failures,
so widening it for connection recovery would change unrelated consumers. This follows the existing
request-specific rejection fields, but [the connection](daemon-connection.md#pairing-rejection-lifetime)
consumes authentication rejection before request correlation. Decoder tests pin the exact comparison
and ensure private daemon text cannot appear in the result.

### Optional permission context

`parseModalShownPayload` preserves the seven required `ModalShownPayload` fields
and accepts these optional additions from [Modal (v2)](https://github.com/pyrycode/pyrycode/blob/main/docs/protocol-mobile.md#modal-v2):

| Wire field | `modalShown` IPC field | Accepted value when present |
|---|---|---|
| `reason` | `reason` | Any JSON value, held as `unknown` |
| `reason_type` | `reasonType` | Any string, including unknown categories |
| `blocked_path` | `blockedPath` | String |
| `description` | `description` | String |
| `default_to_no` | `defaultToNo` | Boolean |
| `always_allow` | `alwaysAllow` | Object with required Boolean `offered` and string array `rules` |

Presence is independent for every field. A category neither requires nor interprets
`reason`; null, arrays, objects, empty strings, zero and false survive intact.
The decoder retains reason object keys, including `__proto__` and `constructor`,
as opaque JSON data. Consumers must narrow before display and never merge those
keys into application state. JSON parsing and the existing plaintext cap bound
this path; there is no recursive reason normalization or additional size limit.

The offer preserves every rule in source order, including the unavailable
`{ offered: false, rules: [] }` shape. Current daemons send it on every modal;
accepting omission keeps older payloads and fixtures valid. Unknown payload and
offer keys are tolerated but filtered by named-field reconstruction; keys within
`reason` are retained. A malformed declared string, Boolean, offer or rule element
throws `WireDecodeError` and drops the entire frame, with no partial modal event.
The connection remains usable for the next valid frame.

`createDaemonConnection` copies each optional field by name only when present,
preserving absence through IPC instead of creating own properties holding
`undefined`. Modal/conversation IDs and the trusted host stamp keep their existing
roles. These values are untrusted display context, never filesystem inputs,
attributes, authorization or log content. Session grants remain daemon-owned;
see [modal answer carriage](daemon-connection-methods.md#modal-answers-and-cancellation).
The [renderer translator](modal-store-bridge.md#the-translator--binding-srcrenderersrcstoremodalbridgets)
and reducer retain `reason`, `reasonType`, `blockedPath`, `description` and `defaultToNo`
for the [permission panel](conversation-shell-permission-modal.md#presentation).
`alwaysAllow` remains outside renderer prompt state; #1409 owns its session-offer control.

Decoder tests cover complete JSON values and declared-shape rejection. Connection
tests drive encoded frames through that decoder to the IPC sink and use exact
property assertions: a parser-only test cannot catch an omitted event projection,
and a value-only check cannot distinguish absence from an own `undefined` field.

### Optional stopped-turn reports

`TurnEndPayload` in `src/shared/wire/types.ts` carries optional `outcome`, `is_error`,
`terminal_reason` and `error_category`. `parseTurnEndPayload` serves both live
`turn_end` and `decodeHistoryEvent`: required `conversation_id`, `turn_id` and
`stop_reason` remain string-validated; malformed optional metadata cannot discard
an otherwise valid boundary. Each report string must be at most 256 **UTF-8 bytes**;
wrong types and overlong values become `undefined`, without truncation. Unknown
strings are accepted. A boolean `false` and empty strings survive separately from
absence; empty strings provide no display detail.

Do not infer a clean finish from `outcome: 'success'`: it can accompany
`is_error: true`, including context overflow. Error categories are Claude's reports,
not verified account findings. The [event channel](daemon-event-channel.md#stopped-turn-metadata)
carries these fields to the [stopped-record formatter](conversation-shell-timeline-render.md#stopped-turn-records),
which owns control removal and escaped text rendering. Decode diagnostics retain
only their existing static type, byte count and hash, never report values.

**`TurnEndPayload` gained six optional numbers alongside these reports**
(`duration_ms`, `input_tokens`, `cache_read_tokens`, `cache_creation_tokens`,
`output_tokens`, `cost_usd_total` — claude's `result` numbers, pyrycode #2260/#2261,
carried by [#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565)),
widening the payload by a field, not a new kind — the #965 pattern. `parseTurnEndPayload`
reads each through a local `finiteNumber` guard (`typeof === 'number' && Number.isFinite`);
a non-number, `null` or non-finite value becomes `undefined`, never a reject, and nothing
is clamped — `0` and negatives are carried as received. `duration_api_ms` and `num_turns`
are deliberately not read: the former is a session running total routinely larger than the
per-turn `duration_ms`, and carrying it would invite showing a session figure as this turn's
own. All six are this turn's except `cost_usd_total`, the **session's** running total in US
dollars. `Number.isFinite` is load-bearing, not defensive: `JSON.parse('1e400')` returns
`Infinity`, so an out-of-range literal from the daemon reaches this guard as a real `number`
that fails `isFinite`, even though `JSON.stringify` can never produce one — a fixture built
through `encodeEnvelope` cannot exercise this path, so `src/main/transport/turnEndMetrics.test.ts`
hand-builds the frame bytes instead, the same fixture-construction trap the size-guard tests
under § Testing below already avoid. The six fields are re-mapped snake→camel as a fresh
named-field literal by the exported `turnEndMetricsOf`, shared by both the live emit in
[daemon connection](daemon-connection.md) and the `turn_end` arm of `decodeHistoryEvent`
above — never a spread of the parsed payload, so a later decoder field cannot cross into the
shared `TurnEndMetrics` IPC shape by accident. See [Thread timeline §
Types](thread-timeline-internals.md#types) for where they land on `turnBoundary`/`turnEnd`
and [Protected local chat history § API](chat-history.md#api) for why they never reach disk.

### Required model-refusal reports

`parseModelRefusalNoFallbackPayload` validates the common fields of both refusal
variants; `parseModelRefusalFallbackPayload` adds the required fallback model and
scope. Live and history decoding share these parsers. Unlike optional stopped-turn
metadata, every refusal field is required: missing/mistyped strings or nullable
string-array reports reject the payload. Empty strings and unknown scope/category
values are valid; report arrays preserve order and wire-key vocabulary.
See [the contract and routing](conversation-timeline-store.md#refusal-records-and-routing).
Display bounds belong to the [row](conversation-shell-turn-status.md#model-refusal-records),
so decoding never truncates the identifier Switch back must send unchanged.

### Optional effective-effort report

`SessionSettingsPayload.effective_effort?: string | null` reports confirmed applied
effort independently of the required `effort` saved choice. `parseSessionSettingsPayload`
preserves these states from [the daemon contract](https://github.com/pyrycode/pyrycode/issues/2517):

| Wire value | Decoded value | Meaning |
|---|---|---|
| Omitted | `undefined` | Applied reading unavailable or unsupported |
| `null` | `null` | No effort parameter |
| Any string | Unchanged string | Applied report, including empty, unfamiliar, whitespace or markup-like text |

The parser checks absence before `requireStringOrNull`; it never defaults the
report to saved `effort`, trims it or applies an effort allowlist. Original required
fields still undergo their existing checks, and unknown payload keys are dropped
by named-field reconstruction. A present Boolean, number, array or object throws
`WireDecodeError` and rejects the whole frame before diagnostics or IPC. Error
text names only the static field. Successful diagnostics retain the existing type,
byte count and hash without report content. `MAX_PLAINTEXT_BYTES` bounds the entire
frame before JSON decoding; there is no effort-specific length cap.

The [event channel](daemon-event-channel.md#run-configuration-report) carries the
report as `effectiveEffort`. Renderer snapshots, visible selection and remembered
choices belong to [#1549](https://github.com/pyrycode/pyrycode-desktop/issues/1549).

## Testing

In `inboundMessage.test.ts`, wrap malformed array payloads in object rows such as
`{ effectiveEffort: [] }` before passing them to `it.each`. Vitest expands bare array
rows into callback arguments: `[]` can test `undefined`, and `['private-effort']`
can test a string, leaving array rejection untested. The connection mapping tests
use the same object-row shape to exercise rejection through the IPC boundary.

Construct oversized inbound fixtures with `Buffer.from(JSON.stringify(...))`.
Using `encodeEnvelope` can reject the fixture at its outbound size guard before
`parseInboundMessage` runs, so it cannot prove the inbound guard works.

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS**. This is the "hostile daemon response" trust boundary — decrypted bytes from a relay peer on an internet-exposed surface.

- **A single explicit boundary.** The outer `payload: unknown` never escapes `parseInboundMessage`; downstream holds narrowed payloads and explicitly carried envelope metadata. Permission `reason` deliberately remains opaque JSON requiring consumer narrowing. For example, live `turnEnd.daemonTs` carries the envelope timestamp for the history/live join; its report strings remain display-only.
- **Fail-closed on declared shapes.** Malformed / oversized / unparseable frames, mistyped required fields, unknown `role`, non-array `messages`, or one bad element in a message chunk drop the frame. Present malformed permission-context fields also drop the frame; optional stopped-turn reports are independently discarded as described above.
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
- [#254 codebase notes](../codebase/254.md) — the eleventh additive extension: the `session_transition` kind, `parseSessionTransitionPayload`, the closed-enum idiom's third instance (`reason`, after `state` #214 and `class`/`source` #201), and `requireStringOrNull`'s third use (`workspace_cwd`). The consumer arm ([daemon connection](daemon-connection.md)) dropped four of the five decoded fields at the emit at the time — the #180 content-drop model's second application. [#285 codebase notes](../codebase/285.md) widened the emit to carry three of those four — `reason`, `occurredAt`, `workspaceCwd` — beside the pre-existing `newSessionId`, leaving only `previous_session_id` dropped; [#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192) later added a sixth decoded field, `conversation_id`, carried the same way as `conversationId`.
- [Session settings send](session-settings-send.md) / [#264 codebase notes](../codebase/264.md) — the twelfth and simplest additive extension: the `session_settings_updated` kind, `parseSessionSettingsUpdatedPayload` (a single `requireString`, no enum, no nullable), and the write-confirmation twin of `session_transition` — the consumer arm drops nothing at the emit, since the reply has only the one field to begin with.
- [#261 codebase notes](../codebase/261.md) — widened the `session-settings-updated` kind with `inReplyTo?: number`, propagating the already-decoded `Envelope.in_reply_to` for [daemon connection](daemon-connection.md)'s correlation lookup.
- [#269 codebase notes](../codebase/269.md) — widened the original `daemon-error` kind ([#116](../codebase/116.md)) with the same `inReplyTo?: number` carrier, letting [daemon connection](daemon-connection.md) correlate a rejection against the same `pendingSettings` map #261 built, ahead of the pre-existing bundle-reassembler and #248 modal-FIFO consumers of that kind.
- [#564 codebase notes](../codebase/564.md) — the sixteenth additive extension: the `background_task_started` kind, `parseBackgroundTaskStartedPayload` (`parseApiRetryPayload` scaled from four fields to six), and the new `requireStringArrayOrNull` field narrower — required-present with a nullable array value, borrowing `parseQueuedItem`'s posture (one bad element fails closed, empty array valid) but not its record-narrower shape, since this frame's array elements are bare strings. First of three sibling frames (#565/#566 follow); the consumer arm keeps `conversation_id`, unlike `api_retry`/`compacting`.
- [#565 codebase notes](../codebase/565.md) — the seventeenth additive extension, the subset twin of #564: the `background_task_updated` kind and `parseBackgroundTaskUpdatedPayload` (`parseBackgroundTaskStartedPayload` scaled from six fields to four — no new field narrower, reuses `requireStringArrayOrNull` unchanged). Gains `patch`, an opaque string never fed to `JSON.parse` (the daemon's own golden fixture is cut mid-token); `requireString`'s bare `typeof` check lets `patch: ''` through free while an omitted `patch` key still fails closed. Second of three sibling frames (#566 follows); the consumer arm keeps `conversation_id` and performs no join against `background_task_started` — ordering is claude's, not the daemon's. [#1560](https://github.com/pyrycode/pyrycode-desktop/issues/1560) widened it back to six fields — `status`/`summary`, the family's only finish signal, filled by claude's `system/task_notification` line while `patch` is filled by `system/task_updated`. Both are the first fields on this frame to tolerate omission: `optionalString(...) ?? ''`, not `requireString`, because a pre-2026-09-10 daemon sends neither key and `''` is already the in-domain value a mid-life frame carries on both, so absence and emptiness mean the same thing here; a present non-string still throws. `status` stays an open string, never narrowed to a union.
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
- [Attachment-stored wire types](attachment-stored-wire-types.md) — the twenty-third additive extension:
  the `attachment_stored` kind, `parseAttachmentStoredPayload`, and the file's newest field narrower,
  `requireNonEmptyString`. [Attachment chunk envelope](attachment-chunk-envelope.md) (#860) is the
  producer half this decodes the answer to; [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861)
  (send driver, not started) is the first intended consumer of both.
- [Daemon error outcome](daemon-error-outcome.md) — [#965](https://github.com/pyrycode/pyrycode-desktop/issues/965)
  widens the `daemon-error` kind by a field, not a new kind: the always-content-free rule since #116
  becomes scoped rather than absolute, narrowed onto a client-owned `DaemonErrorOutcome` for the
  attachment upload leg's six reject codes and still closed for everything else.
- [Model-list wire types](model-list-wire-types.md) — the
  `ModelListPayload`/`WireModelOption` vocabulary ([#971](https://github.com/pyrycode/pyrycode-desktop/issues/971)),
  `slash_command_list`'s sibling from the same `initialize` reply.
  [#972](https://github.com/pyrycode/pyrycode-desktop/issues/972) decodes it into the twenty-fourth kind
  (full account in [Extension history](inbound-message-decode-history.md)); no consumer arm exists yet —
  the IPC carry, the store and the run-configuration rows that replace `RunConfigSections.tsx`'s
  hardcoded `MODEL_CATALOG`/`EFFORT_LEVELS` are still to come.
- [Attachment-chunk retrieval decode](attachment-chunk-retrieval-decode.md) — the twenty-fifth
  additive extension: the `attachment_chunk` kind now claims its **retrieval** direction too (the
  upload direction is [#860](attachment-chunk-envelope.md)'s producer). `parseAttachmentChunkPayload`
  ([#998](https://github.com/pyrycode/pyrycode-desktop/issues/998)) scales `parseAttachmentStoredPayload`'s
  shape to eight fields plus a base64 decode via `base64StdDecode`, and introduces the file's first
  **required** `inReplyTo` on a kind that also has siblings typing it optional — a retrieval chunk
  cannot legitimately arrive unsolicited, where `daemon-error`/`session-settings`/
  `session-settings-updated` can. Also corrects `AttachmentChunkPayload`'s `filename`/`mime_type` field
  docs, true inbound and false outbound (the daemon sanitises/sniffs on the retrieval leg). Ships
  dormant: `daemonConnection.ts`'s inbound switch has no case for `'attachment-chunk'` yet — the
  reassembler is a later slice.
- [Request history send](request-history-send.md) — the twenty-sixth additive extension: the
  `history_page` kind, `parseHistoryPagePayload`/`parseHistoryEntry`, the file's first object-field
  narrower (`requireRecord`), and the sibling `HistoryRejectReason` narrower widening the pre-existing
  `daemon-error` kind with an optional `historyReject` field. [#1222](https://github.com/pyrycode/pyrycode-desktop/issues/1222)
  is also this boundary's first ticket with a live consumer at ship time — [daemon
  connection](daemon-connection.md)'s `pendingHistoryRequests` correlation map. The independent
  `historyPageBridge.ts` consumes `historyPageReceived` and `historyRequestFailed`;
  the four unrelated exhaustive renderer bridges intentionally return null. [#1227](https://github.com/pyrycode/pyrycode-desktop/issues/1227)
  followed up with a second stage in the same file: `decodeHistoryEvent`/`decodeHistoryPage` narrow each
  entry's *payload* (not just its envelope) against the same eleven live-lane parsers, so
  `HistoryEntry.payload` — opaque since #1222 — is now read by something. Not a new `InboundDaemonMessage`
  kind, so it isn't numbered in this chronology; the full account, including the security review that
  mandated a `switch` over an object-literal dispatch table for the untrusted `type` discriminant (a
  lesson worth generalising to any future "which types do we handle" set in this file), is in [Request
  history send](request-history-send.md#payload-decode-srcmaintransportinboundmessagets-1227).
- [System prompt send](system-prompt-send.md) — the twenty-seventh additive extension: the
  `system_prompt` kind, `parseSystemPromptPayload` + the new `narrowSessionPromptStatus` comparand
  narrower, and the file's first payload whose optional field (`system_prompt`) must keep three
  distinct states apart (absent / `''` / text) rather than collapsing to two.
  [#1230](https://github.com/pyrycode/pyrycode-desktop/issues/1230) is also this boundary's second
  ticket with a live consumer at ship time — [daemon connection](daemon-connection.md)'s new
  `pendingSystemPromptRequests` correlation map. The independent `systemPromptBridge.ts`
  consumes `systemPromptReceived`; unrelated exhaustive bridges intentionally return null.
  Unlike every other kind in this file, the verb it answers has **no**
  `daemon-error` counterpart to widen: `system_prompt` mints no wire error code at all.
- [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312) extended it once more, additively:
  the `thinking_progress` kind, `parseThinkingProgressPayload` (`parseApiRetryPayload`'s shape scaled
  down — one `requireString` plus two `requireNumber` calls, no new helper), and claude's only mid-turn
  proof of life on the stream-json surface, the daemon's translation of its `system/thinking_tokens`
  line (pyrycode#1386). A periodic reading, not a state transition — no rising/falling edge, no
  `turn_id`, takes no `FrameTimestamp`, and gains no arm in `decodeHistoryEvent` (AC3, a regression
  pin). Ships dormant, the two-step `question_shown` (#884/#885) and `modal_shown` (#870/#871) already
  took: `daemonConnection.ts`'s inbound switch has no catch-all, so the reading stops at this boundary
  until the carry slice claims it. Full account in [Extension history](inbound-message-decode-history.md).
- [#1318](https://github.com/pyrycode/pyrycode-desktop/issues/1318) extended it once more, additively:
  the `rate_limited` kind, `parseRateLimitedPayload` (`parseBackgroundTaskStartedPayload`'s shape minus
  two strings plus one number — three `requireString` calls, one `requireNumber`, the existing
  `requireStringArrayOrNull` for `truncated_fields`, no new helper), and claude's usage-limit window
  report, the daemon's translation of its top-level `rate_limit_event` line. `status`/`limit_type` are
  deliberately OPEN strings (the value set beyond the one measured-benign status is unmeasured, and a
  client MUST NOT branch security-relevant behaviour on `status`); `resets_at` is claude's number,
  deliberately unvalidated — never a scheduling input, since a delay derived from it fires immediately
  both when negative and when past `setTimeout`'s clamp. Takes no `FrameTimestamp`, and gains no arm in
  `decodeHistoryEvent` (AC5, a regression pin). Ships dormant, the same two-step: `daemonConnection.ts`'s
  inbound switch has no catch-all, so the report stops at this boundary until the carry slice claims it.
  Also corrected three comments left behind by #1312 that had named `rate_limited` as having no parser
  at all. Full account in [Extension history](inbound-message-decode-history.md).
- [#1454](https://github.com/pyrycode/pyrycode-desktop/issues/1454) extended it once more, additively:
  the `context_usage` kind, `parseContextUsagePayload` (`parseRateLimitedPayload`'s shape minus one
  string and its nullable list plus two numbers — two `requireString` calls, three `requireNumber`
  calls, no new helper), and claude's own report of what is in the context window, the display source
  that displaces the `session_settings`/`screen_snapshot` transcript-scan route (decided 2026-09-14).
  **This slice reads the frame's reading only** — `conversation_id`, `model`, `total_tokens`,
  `max_tokens`, `percentage`. The frame's three inventories (`categories`, `mcp_tools`, `memory_files`)
  and their three dropped counts were on every real frame from the start and were deliberately not
  declared or read at this slice: the fresh five-field literal tolerated and dropped them, which the
  follow-on slices (#1455, #1459, #1460) went on to decode — after which every key the daemon writes is
  declared and read. Provenance
  is mixed within the one payload — `conversation_id` is daemon-authored, `model` is claude-authored and
  unsanitized — and the reading is informational: no range check and no cross-field check on the three
  integers, since the daemon neither recomputes nor normalizes claude's figures. Takes no
  `FrameTimestamp` and gains no arm in `decodeHistoryEvent`, the `thinking_progress`/`rate_limited`
  precedent. Content-free-logged as `inbound-decoded(code: 'context_usage')` before the `default`
  branch; neither `model` nor the three integers nor `conversation_id` ever reaches a log line. Ships
  dormant: `daemonConnection.ts`'s inbound switch has no catch-all, so the reading stops here until the
  IPC carry slice (#1419) claims it; the store is #1420, the surfaces #1421. Full account in [Extension
  history](inbound-message-decode-history.md).
- [#1455](https://github.com/pyrycode/pyrycode-desktop/issues/1455) extended it once more, additively:
  the payload's first inventory, `categories: ContextUsageCategory[]` plus its own
  `dropped_categories: number`, via a per-row narrower on the `parseModelListPayload`/`parseModelOption`
  pattern. `categories` is never `null` — the daemon normalises a nil slice to `[]`, so an empty array is
  the positive statement that claude reported no categories, while `null`/absent/non-array fails the
  whole frame closed. The rows arrive as a prefix in descending-token order; `dropped_categories`
  accumulates two independent cuts and is never cross-checked against the retained length. One malformed
  row throws the whole frame rather than yielding a partial breakdown. `mcp_tools`/`memory_files` and
  their two dropped counts followed in #1459 and #1460 respectively. Full account in [Extension
  history](inbound-message-decode-history.md).
- [#1459](https://github.com/pyrycode/pyrycode-desktop/issues/1459) extended it once more, additively:
  the payload's second inventory, `mcp_tools: ContextUsageMCPTool[]` plus its own
  `dropped_mcp_tools: number`, via a per-row narrower, `parseContextUsageMCPTool`, one field wider than
  `parseContextUsageCategory` and otherwise its shape. `mcp_tools` is never `null` — an empty array is
  claude's positive report of no MCP tools, while `null`/absent/non-array fails the whole frame closed;
  the rows arrive as a prefix in descending-token order and `dropped_mcp_tools` is never cross-checked
  against the retained length, nor against `dropped_categories`. `server_name` is decoded as **inert**:
  its name collides with the actuation-crossing `ServerName` on the daemon's MCP reconnect payload, so it
  is never an actuation target, never an authorization input, and never joined against `mcp_status`, the
  same constraint `name` already carries. `memory_files` and its dropped count followed in #1460, the
  frame's last inventory, `../../../etc/passwd` included. Full account in [Extension
  history](inbound-message-decode-history.md).
- [#1460](https://github.com/pyrycode/pyrycode-desktop/issues/1460) extended it once more, additively —
  the last of the frame's three inventories: `memory_files: ContextUsageMemoryFile[]` plus its own
  `dropped_memory_files: number`, via a per-row narrower, `parseContextUsageMemoryFile` —
  `parseContextUsageMCPTool`'s shape with different key names (`path`, `type`, `tokens`). After this
  slice every key the daemon writes is declared and read. `memory_files` is never `null` — an empty array
  is claude's positive report of no memory files, while `null`/absent/non-array fails the whole frame
  closed; the rows arrive as a prefix in descending-token order and `dropped_memory_files` is never
  cross-checked against the retained length or against either sibling count. `path` is decoded as
  **inert** — path-shaped descriptive text, never a file handle: nothing joins, cleans, resolves or opens
  it, and the daemon's committed fixture carries `../../../etc/passwd`, crossing byte-for-byte and
  unnormalised, pinned by a test that checks both literal equality and non-normalisation structurally.
  `type` beside it is claude's label, never a discriminant — a field spelled `type` looks like one in a
  file whose every other `type` narrows an envelope, and it is not. A memory-file `path` is the strongest
  disclosure ground on the frame: it names who the user is and where they work, the fixture value alone
  leaking a home-directory username and a project name, and a POSIX path may legitimately contain a
  newline, extending the MCP inventory's forge-a-log-record ground to this field too. Full account in
  [Extension history](inbound-message-decode-history.md).
- [#1514](https://github.com/pyrycode/pyrycode-desktop/issues/1514) extended it once more, additively:
  the `resetting` kind, `parseResettingPayload` (`parseApiRetryPayload`'s shape with its two numbers
  replaced by two narrowed tokens), and the status-peer cluster's first daemon-authored frame — where
  `stall`/`api_retry`/`compacting` report what claude is doing, this reports what the daemon is doing
  to claude, which is why both `WireResetPhase` and `WireResetHandoff` are narrowed rather than left
  open like `rate_limited`'s claude-authored strings. `''` is a fourth accepted value on each closed
  set, admitted unconditionally regardless of `active`: it is the daemon's declared zero value on the
  falling edge, and gating it on `active` would be cross-field validation this decoder family refuses.
  Takes no `FrameTimestamp` and gains no arm in `decodeHistoryEvent` — `compacting`, its immediate
  neighbour in both files, is the wrong half of the family to copy on that point. Ships dormant: the
  IPC carry is #1515, whose consumer also owns the case this decode cannot cover — a daemon that never
  sends the falling edge. Full account in [Extension history](inbound-message-decode-history.md).
- [#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565) widened `TurnEndPayload` by
  six fields, not a new kind — the #965 pattern: claude's `result` numbers (duration, four token
  counts, the session's running cost) alongside the existing stopped-turn reports. Full account in
  [Optional stopped-turn reports](#optional-stopped-turn-reports) above.
