# Inbound message decode

The **untrusted→trusted boundary for a decrypted daemon message**. The [Noise relay driver](noise-relay-driver.md) hands each decrypted application frame up as opaque bytes (`RelaySessionEvent{ type: 'message'; plaintext }`); this is the layer that turns those bytes into a narrowed, typed `MessagePayload` the renderer can render — or drops them, failing closed, if a hostile or buggy daemon shaped them wrong. It is the inbound counterpart to the [hello exchange](hello-exchange.md) (`parseHelloAck`) and the [outbound send path](outbound-send-path.md) (`buildSendMessage`): same one-concern-per-file split under `src/main/transport/`.

Introduced in [#68](../codebase/68.md). It fills the last no-op arm the [daemon connection](daemon-connection.md) left behind — [#62](../codebase/62.md) wired the handshake-status path but left the inbound-message arm a `// TODO`. This ticket produces the `messageReceived` / `messagesReceived` events that feed the already-complete renderer pipeline: the [daemon-event channel](daemon-event-channel.md) ([#18](../codebase/18.md)) carries them, the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md)) translates them into `SessionAction`s, and the [session store](session-store.md) ([#2](../codebase/2.md)) appends them (deduped by `message_id`, arrival order preserved).

The decoder also handles interactive events, permission prompts and request replies. The chronological account of earlier extensions lives in [Extension history](inbound-message-decode-history.md); current field contracts and failure behavior are documented below and in the linked topics.

See [public contract](inbound-message-decode-contract.md), [internals](inbound-message-decode-internals.md),
and [edge cases and limits](inbound-message-decode-limits.md) for the type union, the decode/log detail,
and the fail-closed edge cases respectively.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Extension history](inbound-message-decode-history.md) — The chronological, kind-by-kind account of every additive extension to `InboundDaemonMessage`, from [#68](../codebase/68.md) through `attachment_offered` (#1619).
- [Public contract](inbound-message-decode-contract.md) — The decoder's public surface: what callers pass in, what they get back, and the guarantees attached to each.
- [Internals](inbound-message-decode-internals.md) — How a frame is actually decoded: payload narrowing, category-only error messages, the diagnostic logging around them, and the consumer arm that drives it.
- [Edge cases and limits](inbound-message-decode-limits.md) — The decoder's edge cases, including why it keeps an explicit size guard when the transport already bounds the plaintext.
- [Related documents](inbound-message-decode-related.md) — Sibling modules, downstream consumers, and a short per-ticket pointer for every additive extension to `InboundDaemonMessage`.

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

Interactive v2 `reply_suggestion` follows the same main-only decode boundary but
returns `{ kind: 'reply-suggestion', replySuggestion }`. The connection copies
only `conversation_id`, `session_id`, `revision` and `suggested_reply` into the
[named-field IPC event](daemon-event-channel.md#reply-suggestions), which feeds
transient composer state rather than message history. Generation and handshake
reconciliation remain daemon-owned; receiving a suggestion sends no request.

## Error handling

| Layer | Result | Failure behavior |
|---|---|---|
| `parseInboundMessage` (transport) | `InboundDaemonMessage \| null` | Throws a single type — `WireDecodeError` — on oversized / malformed / unparseable / mistyped. `null` for a well-formed but unmodeled envelope type (**not** a failure). |
| `case 'message'` arm (consumer) | `void` | `try/catch` → a throw is **dropped silently** (no event, no log, caught object not forwarded); `null` → ignored; a result → routed to its event or correlation consumer. **Never throws out of the module.** |
| UI | — | A dropped inbound frame surfaces **nothing** (no `failed`, no banner). A single malformed *message* frame is not connection-fatal — the session continues. Deliberately different from a malformed `hello_ack`, which **is** fatal (`failed('malformed-hello-ack')`) because the handshake cannot complete without it. |

### Daemon-error retryability

The decoded `daemon-error` arm carries optional `retryable?: boolean` alongside
`inReplyTo` and the existing client-owned rejection classifiers. It preserves
only literal `true` or `false` from a record payload. An absent field, null,
string, number or non-record payload leaves retryability `undefined` without
rejecting the frame or disabling other error consumers. Daemon message text
remains discarded; code strings are used only by the existing classifiers, never
forwarded verbatim. Decode diagnostics retain static `error`, byte count and
whole-frame hash, without payload text or retryability.

The [switch-rejection emit](daemon-event-channel.md#what-it-does) applies
`retryable ?? false`; the decoder itself keeps absence distinct from `false`.
Attachment outcome classifiers and their consumers keep their existing behavior.

### Reply-suggestion validation

`ReplySuggestionPayload` requires string `conversation_id` and `session_id`
(empty strings are accepted), a positive safe-integer `revision`, and
`suggested_reply: string | null`. Text must be nonblank, single-line Unicode scalar
text of at most 1024 UTF-8 bytes. The validator rejects CR, LF, U+2028 and U+2029,
lone UTF-16 surrogates, whitespace-only text and overlong strings; valid text,
including surrounding spaces, survives verbatim. The envelope's existing fatal
UTF-8 decoder and plaintext size cap apply before payload validation.

Only explicit null represents a clear. Omission, empty text, mistyped fields or
invalid revisions reject the whole frame without emitting IPC or altering held
suggestions. Extra payload keys are discarded by named-field reconstruction.
Payload rejection emits only `{ event: 'inbound-rejected',
code: 'reply-suggestion-invalid' }` and throws the static
`WireDecodeError('invalid reply suggestion')`; the connection drops the caught
object. Valid diagnostics carry only `inbound-decoded`, static code
`reply_suggestion`, byte count and whole-frame hash. Neither path logs suggestion
text, routing IDs or raw payload, or embeds them in exception messages.

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

### Optional assistant parent attribution

`AssistantDeltaPayload.parent_tool_use_id` names the spawning Agent/Task call for
helper text. `parseAssistantDeltaPayload` serves both live `assistant_delta` and
`decodeHistoryEvent`: `optionalString` preserves nonempty strings exactly, including
whitespace, and missing or empty strings become `undefined`. Supplied non-strings,
including `null`, throw `WireDecodeError`; live frames are dropped and malformed
history entries are skipped individually. Errors name only the static field,
never its value, and unknown payload keys are discarded by named-field copying.

The live connection and decoded history carry it as `parentToolUseId` through
`DaemonEvent`/`HistoryTimelineEvent` and `translateTimelineEvent` to assistant
timeline items. A parser-only check would miss a forwarding boundary that drops
the field: `inboundMessage.test.ts` covers both decode lanes,
`daemonConnection.test.ts` covers live and correlated history IPC, and
`timelineBridge.test.ts` covers renderer translation. See
[timeline attribution](conversation-timeline-store.md#assistant-parent-attribution)
and [version-1 persistence](chat-history.md#snapshot-contract).

The parent is a conversation-local display hint, never authority, a DOM attribute,
log content or a path. Tool-use/result decoding retains its existing contract.

### Optional roster launch ids

`BackgroundTask.tool_call_id?: string` matches [daemon #2753](https://github.com/pyrycode/pyrycode/issues/2753)
additively under [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md). Older rows
omit it and remain valid both on the wire and as typed inputs; narrow fixtures need
no migration. `parseBackgroundTask` checks field presence before `requireString`:
missing stays omitted, empty is preserved but means unknown to placement, and every
nonempty string survives exactly, including whitespace. A supplied non-string,
including null, throws `WireDecodeError` and rejects the entire roster rather than
partially publishing tasks. Making the id required would reject old valid rows;
treating null as absence would accept malformed declared data.

The parser builds a fresh named-field literal, retaining the optional id and dropping
unknown extras such as scalar patches. Existing malformed-frame handling and
content-free diagnostics apply; neither ids nor descriptions are logged. IPC and
`translateBackgroundTaskRoster` already pass parsed rows through. Ids are inert
conversation/owning-host equality hints, never DOM attributes, selectors or authority.
Descriptions remain untrusted escaped React text, bounded to 4096 characters with
ellipsis by the [Agent presentation](conversation-shell-tool-row-header-groups.md#started-background-agents).
Availability and metadata provenance are separate concerns in the
[roster store](background-task-roster-store-internals.md#retained-agent-timeline-evidence).

`inboundMessage.test.ts` covers old missing-id rows, empty/exact strings, supplied
non-string rejection and unknown-key filtering. This contract does not add
background-task history decoding or change the saved timeline format (#1781).

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

### Optional session capability flags

`SessionSettingsPayload.capabilities?: SessionCapabilitiesPayload` reports whether
the resolved session answers slash-command, MCP-status and context-breakdown
requests (pyrycode#2646/#2670), and accepts queued input during a running turn
(`mid_turn_input`, pyrycode#2730, desktop [#1726](https://github.com/pyrycode/pyrycode-desktop/issues/1726))
— true for a Claude session, false for a Codex one.
`parseSessionSettingsPayload` follows the `effective_effort` optional-field pattern
above: absent `capabilities` stays `undefined`; present is narrowed by
`parseSessionCapabilities` (\#1654), which rejects outright when the value is not a
record and otherwise reads `slash_commands`, `mcp_servers`, `context_usage_detail`
and `mid_turn_input` independently through its `optionalBoolean` helper, which
calls `requireBoolean` for a present value — each absent flag
stays `undefined` (distinct from `false`), and a present non-boolean rejects the
whole frame before it is logged. The parser returns a fresh literal of the four
flags only; the object's other upstream keys (`interrupt`,
`effort_levels`, `permission_modes`, `attachment_types`, `models`) are deliberately
never decoded.

`capabilities` only ever reaches a client that advertised `multi_agent`, and only
when the reply resolved a session. Production `loadDialConfig` advertises
`multi_agent`, so resolved-session replies supply these readings to the current UI.

The [event channel](daemon-event-channel.md#run-configuration-report) carries the
four flags as flat `slashCommands`/`mcpServers`/`contextUsageDetail`/`midTurnInput`
optional booleans. Send now requires explicit `midTurnInput === true`; absent
capabilities, an absent flag or `false` hides it. The other three flags retain
their absence-as-supported rule; see [run-config selection](run-config-store.md#session-capability-flags-1655).

### Optional memory-search report

`SessionSettingsPayload.memory_search?: MemorySearchPayload` is the daemon's
resolved-session search status. A complete report has aggregate `availability`
(`available`, `unavailable`, `absent` or `unknown`) and a `providers` array. Every
provider requires `id`, `display_name`, Boolean `installed` and `enabled`, and its
own availability from the same four values. The decoder retains `false` and an
empty provider array; the aggregate, not array length, states absence.

Omission leaves `memory_search` undefined, meaning no reading was supplied. A
present report with any missing or mistyped field, or an unfamiliar aggregate or
provider availability, becomes `{ availability: 'unknown', providers: [] }` as a
whole. It cannot confirm status from a partial provider list, and valid model,
effort, permission and usage settings still decode. An explicit daemon `unknown`
is a valid complete report. The [event channel](daemon-event-channel.md#run-configuration-report)
carries the result as `memorySearch`.

## Testing

[Reply-suggestion decoder tests](../../../src/main/transport/replySuggestion.test.ts)
cover text/null preservation, missing and mistyped fields, unsafe revisions,
blank/multiline/surrogate text, exact multibyte byte limits, invalid UTF-8 and
content-free diagnostics/exceptions. The
[connection tests](../../../src/main/daemonConnection.test.ts) drive encoded frames
through main to assert the exact host-stamped IPC fields and that malformed
suggestions emit nothing. Renderer lifecycle and mounted interaction coverage
are linked from the [message box](conversation-shell-composer-message-box.md#suggested-next-reply).

In `inboundMessage.test.ts`, wrap malformed array payloads in object rows such as
`{ effectiveEffort: [] }` before passing them to `it.each`. Vitest expands bare array
rows into callback arguments: `[]` can test `undefined`, and `['private-effort']`
can test a string, leaving array rejection untested. The connection mapping tests
use the same object-row shape to exercise rejection through the IPC boundary.

Decoder and fake-daemon tests expect `daemon-error.retryable` in exact result-shape
assertions while retaining their checks that daemon text is excluded. Widening
an assertion to ignore extra fields would lose that protection. Both booleans
and absent/mistyped flags have decoder coverage.

Construct oversized inbound fixtures with `Buffer.from(JSON.stringify(...))`.
Using `encodeEnvelope` can reject the fixture at its outbound size guard before
`parseInboundMessage` runs, so it cannot prove the inbound guard works.

For `session_settings` contract coverage, use the daemon's golden envelopes from
`internal/protocol/testdata/`: equivalent inline payloads can pass while the daemon
examples drift. The correlated event-path tests add only `in_reply_to`, which those
fixtures omit.

## Security properties

Ticket carries `security-sensitive`; the architect's security-review verdict is **PASS**. This is the "hostile daemon response" trust boundary — decrypted bytes from a relay peer on an internet-exposed surface.

- **A single explicit boundary.** The outer `payload: unknown` never escapes `parseInboundMessage`; downstream holds narrowed payloads and explicitly carried envelope metadata. Permission `reason` deliberately remains opaque JSON requiring consumer narrowing. For example, live `turnEnd.daemonTs` carries the envelope timestamp for the history/live join; its report strings remain display-only.
- **Fail-closed on declared shapes.** Malformed / oversized / unparseable frames, mistyped required fields, unknown `role`, non-array `messages`, or one bad element in a message chunk drop the frame. Present malformed permission-context fields also drop the frame; optional stopped-turn reports are independently discarded as described above.
- **Content-free-log by construction, secret-safe.** No `console.*` on any path; category-only `WireDecodeError` messages carry no field value; the consumer drops the caught object. Since [#130](../codebase/130.md) the module *does* log — but only content-free records: successful decodes carry type + `seq` + length + one-way hash, while rejected reply-suggestion payloads carry only a static rejection code, never a payload byte or a decoded field: the modeled arms log a static type literal, the unmodeled arm a **capped** peer type, and every record's `hash` is a full-frame BLAKE2s digest implicitly salted by the server-assigned `id`/`ts`/`message_id` (so the log can't confirm a guessed message). Pinned by a six-method `console`-spy (still green — #130 logs via the injected sink, never `console`), an assertion that a thrown message never contains the `role` / `text` / `conversation_id` value, and an AC4 test asserting the serialized log line contains the hash but **neither** planted secret. Message *content* reaching the renderer is the **intended data path**, not a leak — the [#18](../codebase/18.md) `DaemonEvent` union cannot hold a token/key/raw frame by construction.
- **Bounded per-frame work.** The size cap makes work O(size) with size capped; a `message_chunk` array is inherently small (each complete message > 60 bytes, cap 65519) and aborts on the first bad element. A hostile daemon cannot flood an unbounded frame; deep-nesting JSON fails closed via the codec's `RangeError` catch.

## Related

See [Related documents](inbound-message-decode-related.md) for the full cross-reference list: every
sibling module, downstream consumer, and a short per-ticket note for each additive extension to
`InboundDaemonMessage`, split out separately once the growing extension list pushed this document past
the size cap.
