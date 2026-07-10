# Inbound message decode

The **untrusted→trusted boundary for a decrypted daemon message**. The [Noise relay driver](noise-relay-driver.md) hands each decrypted application frame up as opaque bytes (`RelaySessionEvent{ type: 'message'; plaintext }`); this is the layer that turns those bytes into a narrowed, typed `MessagePayload` the renderer can render — or drops them, failing closed, if a hostile or buggy daemon shaped them wrong. It is the inbound counterpart to the [hello exchange](hello-exchange.md) (`parseHelloAck`) and the [outbound send path](outbound-send-path.md) (`buildSendMessage`): same one-concern-per-file split under `src/main/transport/`.

Introduced in [#68](../codebase/68.md). It fills the last no-op arm the [daemon connection](daemon-connection.md) left behind — [#62](../codebase/62.md) wired the handshake-status path but left the inbound-message arm a `// TODO`. This ticket produces the `messageReceived` / `messagesReceived` events that feed the already-complete renderer pipeline: the [daemon-event channel](daemon-event-channel.md) ([#18](../codebase/18.md)) carries them, the [daemon-event bridge](daemon-event-bridge.md) ([#19](../codebase/19.md)) translates them into `SessionAction`s, and the [session store](session-store.md) ([#2](../codebase/2.md)) appends them (deduped by `message_id`, arrival order preserved).

[#180](../codebase/180.md) extended this boundary again, additively, with a `screen_snapshot` →
`snapshot` kind for the [screen snapshot fetch](screen-snapshot-fetch.md) feature — see below.

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
  | { kind: 'daemon-error' }                                  // #116, additive — content-free
  | { kind: 'snapshot'; snapshot: ScreenSnapshotPayload }      // #180, additive
  | { kind: 'assistant-delta'; delta: AssistantDeltaPayload }  // #199, additive
  | { kind: 'turn-end'; turnEnd: TurnEndPayload }              // #199, additive
  | { kind: 'conversations'; conversations: ConversationSummary[] }  // #139, additive
  | { kind: 'turn-state'; turnState: TurnStatePayload }         // #214, additive
  | { kind: 'tool-use'; toolUse: ToolUsePayload }               // #217, additive
  | { kind: 'modal-shown'; modalShown: ModalShownPayload }      // #201, additive
  | { kind: 'modal-dismissed'; modalDismissed: ModalDismissedPayload }  // #201, additive
  | { kind: 'tool-result'; toolResult: ToolResultPayload }      // #229, additive

// Decode + route + narrow one decrypted app-message plaintext:
//  • InboundDaemonMessage  — a `message`/`message_chunk`/bundle/`error`/`screen_snapshot`/
//                            `assistant_delta`/`turn_end`/`conversations`/`turn_state`/`tool_use`/
//                            `modal_shown`/`modal_dismissed`/`tool_result` envelope, fully narrowed
//  • null                  — a well-formed envelope of any OTHER type (ignored)
//  • throws WireDecodeError — oversized / malformed / unparseable / mistyped payload (fail-closed)
export function parseInboundMessage(
  plaintext: Uint8Array,
  diagnosticLog?: DiagnosticLog       // #130 — optional injected content-free logger; absent ⇒ silent
): InboundDaemonMessage | null
```

**Extended by [#116](../codebase/116.md), additively.** The `message` / `message_chunk` recognition and narrowing described below are unchanged byte-for-byte. Three more kinds are now recognized *before* the `default` (unmodeled) branch: `debug_bundle_chunk` → `{ kind: 'bundle-chunk', seq, data }` (base64-decoded via the codec's **strict** `base64StdDecode` right at this boundary, so the [reassembler](debug-bundle-reassembly.md) downstream stays byte-pure), `debug_bundle_done` → `{ kind: 'bundle-done', total }`, and `error` → `{ kind: 'daemon-error' }` (content-free — no `ErrorPayload` field is narrowed). A new `requireNumber` helper sits beside `requireString` for the two numeric fields (`seq`/`total`). Modeling `error` is a deliberate, generally-applicable change: it moves from silently-dropped `inbound-unmodeled` to a modeled, content-free `inbound-decoded(code: 'error')` for **every** `error` frame, bundle-related or not — see the diagnostic-logging table below.

**Extended again by [#180](../codebase/180.md), additively.** `screen_snapshot` → `{ kind: 'snapshot', snapshot: ScreenSnapshotPayload }` via `parseScreenSnapshotPayload`, the [screen snapshot fetch](screen-snapshot-fetch.md) feature's decode half. A new `requireBoolean` helper sits beside `requireString`/`requireNumber` for the reply's `yolo` field — it checks the value's *type*, never its truthiness, so `false` decodes as a real value (permissions enforced) rather than a missing field; the same discipline applies to `model`/`effort`, where `''` means "inherited daemon default," never "absent" (all fields are always present on the wire, no `omitempty`). Unlike the bundle kinds, the `snapshot` kind carries the **full** decoded payload — including `text`, the rendered screen — through this boundary; the content-minimisation drop of `text`/`ts`/`conversation_id` happens one layer up, at the `daemonConnection.ts` consumer arm (see [daemon connection](daemon-connection.md) and [screen snapshot fetch](screen-snapshot-fetch.md)), not here.

**Extended a third time by [#191](../codebase/191.md), additively.** Two more required numeric fields join `ScreenSnapshotPayload` after `yolo` — `used_tokens` / `window_tokens` (pyrycode/pyrycode#857) — decoded via two more `requireNumber` calls (`ScreenSnapshotPayload` now has eight always-present fields). `0` decodes as the value `0`, never as absence (the same discipline the bundle `seq`/`total` already established). These two ints are **not** dropped at the content-minimisation seam one layer up — unlike `text`/`ts`/`conversation_id`, they cross to the renderer as part of the `snapshotReceived` event (see [screen snapshot fetch](screen-snapshot-fetch.md)).

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
file; a future closed-enum wire field should reach for it by default. Unlike `assistant_delta`/
`turn_end`, the consumer arm drops **only** `conversation_id` (single active conversation) and keeps
`state` — there is no separate content-minimisation question here, since a 3-value enum has no field
worth stripping either way.

**Extended a seventh time by [#217](../codebase/217.md), additively.** `tool_use` → `{ kind: 'tool-use',
toolUse: ToolUsePayload }` via `parseToolUsePayload`, the tool-call enrichment of the same v2 interactive
stream (pyrycode #607, ADR 025, `protocol-mobile.md`). `ToolUsePayload{conversation_id, turn_id,
tool_use_id, name, input_summary}` is five plain strings, all always present — narrowed with **five
`requireString` calls, no enum check** (unlike `turn_state`'s `state`), cloning `parseTurnEndPayload`'s
idiom scaled from three fields to five. The consumer arm drops only `conversation_id`; `name` and
`input_summary` are opaque daemon display text (the `stop_reason` #199 / `cwd` #139 posture) carried
onward to the render slice ([#218](https://github.com/pyrycode/pyrycode-desktop/issues/218)) verbatim,
never interpreted here.

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

**Neither payload carries `conversation_id`** — `modal_id` is the sole correlation key (a one-time
nonce; ADR 0009), so unlike every prior extension there is no "which field does the consumer arm drop"
question to answer for identity — nothing is dropped because nothing beyond the modal's own fields was
ever decoded. `title`/`prompt`/each `options[].label` are untrusted `claude`-surfaced free text carried
onward unminimised (the `assistant_delta`/`tool_use` posture, not `screen_snapshot`'s) — the render
slice ([#224](https://github.com/pyrycode/pyrycode-desktop/issues/224)) must render them as plain text.

**Extended a ninth time by [#229](../codebase/229.md), additively.** `tool_result` → `{ kind:
'tool-result', toolResult: ToolResultPayload }` via `parseToolResultPayload`, the outcome half of
`tool_use` (#217) and the vertical's last transport slice. `ToolResultPayload{conversation_id, turn_id,
tool_use_id, is_error, result_summary}` is four strings plus one boolean, all always present — narrowed
with **four `requireString` calls plus one `requireBoolean` call** on `is_error` (the `yolo` #180 idiom:
the check is on the *type*, so `is_error: false` decodes as the value `false`, never treated as an
absence — the one delta from `parseToolUsePayload`'s all-string shape). The consumer arm drops only
`conversation_id`; `result_summary` is opaque daemon display text (the `input_summary` #217 posture)
carried onward to the render slice ([#230](https://github.com/pyrycode/pyrycode-desktop/issues/230))
verbatim, never interpreted here. `is_error` is a decoded boolean, not attacker text.

The optional second parameter is the [content-free diagnostic logger](diagnostic-log.md) ([#130](../codebase/130.md)). Absent it, the module is silent and behaves exactly as before; injected, each of the two non-throwing outcomes leaves a content-free record (§ *Diagnostic logging*).

A **single throw type** (`WireDecodeError`) covers every failure, so the consumer's one `catch` handles oversized, malformed, unparseable, and mistyped alike — exactly the shape `parseHelloAck` uses for the `hello_ack` boundary.

## How it works

`parseInboundMessage` layers the semantic narrowing the codec deliberately defers (`Envelope.payload` stays `unknown`) onto `decodeEnvelope`'s structural boundary, plus the oversized guard `decodeEnvelope` omits:

1. **Size guard.** `plaintext.length > MAX_PLAINTEXT_BYTES` (65519) → throw. `decodeEnvelope` does **not** size-check, so this is the only thing that fails an oversized-but-valid-JSON frame closed at this boundary. (Belt-and-suspenders: the upstream Noise transport already bounds the plaintext, but this boundary re-checks what it owns — the unit test drives this function directly, and a future driver change must not silently un-bound it. See § Why the explicit size guard.)
2. **`decodeEnvelope(plaintext)`** — inherits the codec's fail-closed rejection of bad UTF-8, malformed JSON, a non-object top-level, and a missing `id` / `type` / `ts` / `payload`.
3. **Route on `envelope.type`:**
   - `'message'` → `{ kind: 'message', message: parseMessagePayload(payload) }`
   - `'message_chunk'` → `{ kind: 'chunk', messages: parseMessageChunkPayload(payload).messages }`
   - `'debug_bundle_chunk'` / `'debug_bundle_done'` / `'error'` → the three additive kinds ([#116](../codebase/116.md), see above) — narrowed and content-free-logged as `inbound-decoded` before the `default` branch is ever reached.
   - `'screen_snapshot'` → `{ kind: 'snapshot', snapshot }` ([#180](../codebase/180.md), extended [#191](../codebase/191.md)) — narrowed via `parseScreenSnapshotPayload` (fail-closed, all eight fields required-present), then content-free-logged as `inbound-decoded(code: 'screen_snapshot')` before the `default` branch.
   - `'assistant_delta'` → `{ kind: 'assistant-delta', delta }` / `'turn_end'` → `{ kind: 'turn-end', turnEnd }` ([#199](../codebase/199.md)) — narrowed via `parseAssistantDeltaPayload` / `parseTurnEndPayload`, each content-free-logged as `inbound-decoded(code: 'assistant_delta' | 'turn_end')` before the `default` branch. The two v2 interactive-stream kinds that graduate out of `inbound-unmodeled` once #179 flips `interactive` on.
   - `'conversations'` → `{ kind: 'conversations', conversations }` ([#139](../codebase/139.md)) — narrowed via `parseConversationsPayload`, content-free-logged as `inbound-decoded(code: 'conversations')` before the `default` branch — **deliberately no `count` field**, unlike `message_chunk`'s log (a conversation count is more identifying than a message-batch size).
   - `'turn_state'` → `{ kind: 'turn-state', turnState }` ([#214](../codebase/214.md)) — narrowed via `parseTurnStatePayload` (the `role`-style closed-enum check on `state`), content-free-logged as `inbound-decoded(code: 'turn_state')` before the `default` branch. The third v2 interactive-stream kind to graduate out of `inbound-unmodeled`, alongside `assistant_delta`/`turn_end`.
   - `'tool_use'` → `{ kind: 'tool-use', toolUse }` ([#217](../codebase/217.md)) — narrowed via `parseToolUsePayload` (five `requireString` calls, no enum), content-free-logged as `inbound-decoded(code: 'tool_use')` before the `default` branch. The fourth v2 interactive-stream kind to graduate out of `inbound-unmodeled`.
   - `'modal_shown'` → `{ kind: 'modal-shown', modalShown }` / `'modal_dismissed'` → `{ kind: 'modal-dismissed', modalDismissed }` ([#201](../codebase/201.md)) — narrowed via `parseModalShownPayload` (the `class` closed-enum check + the `parseModalOption`-mapped `options` array) / `parseModalDismissedPayload` (the `source` closed-enum check), each content-free-logged as `inbound-decoded(code: 'modal_shown' | 'modal_dismissed')` before the `default` branch. Not part of the same v2 interactive-stream family as `assistant_delta`/`turn_state`/`tool_use` — a modal is the permission/trust prompt `claude` raises, gated behind the same `interactive` capability but carrying no `conversation_id`.
   - `'tool_result'` → `{ kind: 'tool-result', toolResult }` ([#229](../codebase/229.md)) — narrowed via `parseToolResultPayload` (four `requireString` calls plus one `requireBoolean` call on `is_error`), content-free-logged as `inbound-decoded(code: 'tool_result')` before the `default` branch. The fifth and last v2 interactive-stream kind to graduate out of `inbound-unmodeled`, alongside `assistant_delta`/`turn_end`/`turn_state`/`tool_use`.
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
| modeled `debug_bundle_chunk` / `debug_bundle_done` / `error` ([#116](../codebase/116.md)) | `inbound-decoded` | `code: <the type>`, `bytes`, `hash` — never `seq`/`total`/`data`/the daemon's `ErrorPayload` text |
| modeled `screen_snapshot` ([#180](../codebase/180.md), extended [#191](../codebase/191.md)) | `inbound-decoded` | `code: 'screen_snapshot'`, `bytes`, `hash` — never `text`/`conversation_id`/`model`/`effort`/`yolo`/`used_tokens`/`window_tokens` |
| modeled `assistant_delta` / `turn_end` ([#199](../codebase/199.md)) | `inbound-decoded` | `code: 'assistant_delta' \| 'turn_end'`, `bytes`, `hash` — never `text`/`turn_id`/`seq`/`stop_reason`/`conversation_id`, even though the consumer arm carries `text` onward to the renderer (the log stays content-free regardless of what the event carries) |
| modeled `conversations` ([#139](../codebase/139.md)) | `inbound-decoded` | `code: 'conversations'`, `bytes`, `hash` — never `id`/`name`/`cwd`/`is_promoted`/`is_archived`/`last_message_ts`/`last_used_at`, and deliberately **no `count`** |
| modeled `turn_state` ([#214](../codebase/214.md)) | `inbound-decoded` | `code: 'turn_state'`, `bytes`, `hash` — never `state`/`conversation_id` |
| modeled `tool_use` ([#217](../codebase/217.md)) | `inbound-decoded` | `code: 'tool_use'`, `bytes`, `hash` — never `name`/`input_summary`/`tool_use_id`/`turn_id`/`conversation_id` |
| modeled `modal_shown` / `modal_dismissed` ([#201](../codebase/201.md)) | `inbound-decoded` | `code: 'modal_shown' \| 'modal_dismissed'`, `bytes`, `hash` — never `modal_id`/`class`/`title`/`prompt`/any `options[].label`/`default_option_id`/`outcome`/`source` |
| modeled `tool_result` ([#229](../codebase/229.md)) | `inbound-decoded` | `code: 'tool_result'`, `bytes`, `hash` — never `result_summary`/`is_error`/`tool_use_id`/`turn_id`/`conversation_id` |
| unmodeled (`default`) | `inbound-unmodeled` | `code: envelope.type.slice(0, 64)`, `bytes`, `hash` |

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
    case 'snapshot':
      // #180: content-minimisation seam — text/ts/conversation_id are decoded but dropped HERE;
      // only the settings fields plus the two usage ints (#191) cross to the renderer.
      emitDaemonEvent(sink, {
        type: 'snapshotReceived',
        model: inbound.snapshot.model,
        effort: inbound.snapshot.effort,
        yolo: inbound.snapshot.yolo,
        used_tokens: inbound.snapshot.used_tokens,
        window_tokens: inbound.snapshot.window_tokens
      })
      return
    case 'assistant-delta':
      // #199: UNLIKE 'snapshot', text IS carried onward — it's the render payload, not a secret.
      // conversation_id is still dropped (single active conversation; #202's bridge scopes identity).
      // A fresh named-field literal, never a spread of the decoded payload.
      emitDaemonEvent(sink, {
        type: 'assistantDelta',
        turnId: inbound.delta.turn_id,
        seq: inbound.delta.seq,
        text: inbound.delta.text
      })
      return
    case 'turn-end':
      emitDaemonEvent(sink, {
        type: 'turnEnd',
        turnId: inbound.turnEnd.turn_id,
        stopReason: inbound.turnEnd.stop_reason
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
      // #214: fresh named-field literal, mirrors 'assistant-delta'. conversation_id dropped (single
      // active conversation); state carried onward — a 3-value enum, nothing left to minimise.
      emitDaemonEvent(sink, { type: 'turnState', state: inbound.turnState.state })
      return
    case 'tool-use':
      // #217: fresh named-field literal, mirrors 'turn-state'. conversation_id dropped (single active
      // conversation); name/input_summary carried onward as opaque display text for the render slice.
      emitDaemonEvent(sink, {
        type: 'toolUse',
        turnId: inbound.toolUse.turn_id,
        toolUseId: inbound.toolUse.tool_use_id,
        name: inbound.toolUse.name,
        inputSummary: inbound.toolUse.input_summary
      })
      return
    case 'modal-shown':
      // #201: fresh named-field literal. NO conversation_id to drop — the wire carries none on a
      // modal. options reused verbatim (parseModalOption already stripped each to {id,label}).
      emitDaemonEvent(sink, {
        type: 'modalShown',
        modalId: inbound.modalShown.modal_id,
        class: inbound.modalShown.class,
        title: inbound.modalShown.title,
        prompt: inbound.modalShown.prompt,
        options: inbound.modalShown.options,
        defaultOptionId: inbound.modalShown.default_option_id
      })
      return
    case 'modal-dismissed':
      // #201: fresh named-field literal. NO conversation_id to drop.
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
- **The three bundle kinds emit no `DaemonEvent`.** Unlike `message`/`message_chunk`, `bundle-chunk`/`bundle-done`/`daemon-error` never reach the [daemon-event channel](daemon-event-channel.md) — they route to the [debug-bundle reassembler](debug-bundle-reassembly.md)'s injected `BundleConsumer` instead ([#116](../codebase/116.md)). A caller that also waits on daemon events must drive its own wait from the consumer's `complete`/`fail`, not the event sink.
- **The `snapshot` kind emits a *narrower* `DaemonEvent` than it decodes ([#180](../codebase/180.md), extended [#191](../codebase/191.md)).** Unlike the bundle kinds (no event) or `message`/`message_chunk` (event mirrors the decode), `screen_snapshot` decodes all eight fields here but the consumer arm emits only five (`model`/`effort`/`yolo`/`used_tokens`/`window_tokens`) — `text`/`ts`/`conversation_id` are dropped at `daemonConnection.ts`, not at this boundary. See [screen snapshot fetch](screen-snapshot-fetch.md) for why the drop happens one layer up.
- **`assistant-delta`/`turn-end` deliberately break that narrowing pattern ([#199](../codebase/199.md)).** The consumer arm drops only `conversation_id` and carries `turn_id`/`seq`/`text` (renamed to camelCase) or `turn_id`/`stop_reason` onward in full — `text` is the render payload, not a secret to minimise. Don't generalize "new inbound kind ⇒ the consumer strips fields" from the `snapshot` precedent; check whether the field is sensitive-to-the-renderer (drop it, like `screen_snapshot.text`) or is the thing the renderer exists to show (carry it, like this).
- **`assistant_delta`/`turn_end` are received by nobody yet.** Desktop withholds the `interactive` capability ([#179](https://github.com/pyrycode/pyrycode-desktop/issues/179) turns it on), so these two cases are exercised only by direct unit tests today, not a live daemon — a textbook Strangler-Fig: the decode path exists and is tested before the traffic that will use it does.
- **`conversations` has no request trigger yet either, but for a different reason.** [#139](../codebase/139.md) ships both the decode path *and* the outbound `requestConversations` command, but nothing in this ticket calls `sendCommand({type:'requestConversations'})` — that's [#208](https://github.com/pyrycode/pyrycode-desktop/issues/208)'s on-connect trigger. Unlike `assistant_delta`/`turn_end`, this is blocked only on a sibling renderer ticket, not a daemon capability flip — the daemon would answer today if asked.
- **`turn_state` is received by nobody yet, for the same reason as `assistant_delta`/`turn_end`.** [#214](../codebase/214.md) sits on the same `interactive`-capability gate ([#179](https://github.com/pyrycode/pyrycode-desktop/issues/179)) — exercised only by direct unit tests today. Unlike those two, its consumer arm has nothing to carry-vs-drop debate over: `state` is a closed 3-value enum, so there's no sensitive-vs-render-payload distinction to make; only `conversation_id` is dropped.
- **`tool_use` is received by nobody yet, same capability gate — and its two untrusted strings forward a render constraint.** [#217](../codebase/217.md) sits on the same `interactive`-capability gate ([#179](https://github.com/pyrycode/pyrycode-desktop/issues/179)) — exercised only by direct unit tests today. Like `assistant_delta`/`turn_end` (and unlike `turn_state`), the consumer arm carries content onward rather than minimising it: `name`/`input_summary` are opaque daemon-supplied strings that reach the render slice ([#218](https://github.com/pyrycode/pyrycode-desktop/issues/218)) as free text — that sibling ticket must render them as plain text, never `dangerouslySetInnerHTML`, and must not re-parse `input_summary`.
- **`modal_shown`/`modal_dismissed` are received by nobody yet, same capability gate.** [#201](../codebase/201.md) sits on the same `interactive`-capability gate ([#179](https://github.com/pyrycode/pyrycode-desktop/issues/179)), exercised only by direct unit tests today. Unlike `assistant_delta`/`turn_end`/`turn_state`/`tool_use`, even once a live frame arrives, the session and timeline bridges still discard the resulting `DaemonEvent` arms as `null` — the real consumer is the third, independent [modal store + bridge](modal-store-bridge.md) ([#223](../codebase/223.md), shipped), but its `useModalBridge` isn't mounted until [#224](https://github.com/pyrycode/pyrycode-desktop/issues/224), so no live frame reaches it in production yet. `title`/`prompt`/each `options[].label` are untrusted `claude`-surfaced free text the eventual render slice (#224) must render as plain text, the same constraint `tool_use` forwards.
- **`default_option_id ∈ options[].id` is not cross-checked at this boundary.** `ModalShownPayload.default_option_id` decodes as a required string with no structural relationship enforced to `options`. A daemon sending a mismatched default is not rejected here — the cross-field invariant is deferred to the render slice ([#224](https://github.com/pyrycode/pyrycode-desktop/issues/224)), where a mismatch just means nothing pre-highlights (harmless; answering still needs an explicit user action).
- **`tool_result` is received by nobody yet, same capability gate — and it is the vertical's last kind to graduate.** [#229](../codebase/229.md) sits on the same `interactive`-capability gate ([#179](https://github.com/pyrycode/pyrycode-desktop/issues/179)) — exercised only by direct unit tests today. Like `tool_use`, `result_summary` is opaque daemon-supplied text that reaches the render slice ([#230](https://github.com/pyrycode/pyrycode-desktop/issues/230)) as free text — that sibling ticket must render it as plain text, never `dangerouslySetInnerHTML`. Unlike every prior kind, one field (`is_error`) is a **boolean**, decoded via `requireBoolean` rather than `requireString` or a closed-enum `!==` chain — the type check alone distinguishes a smuggled non-boolean from the valid value `false`.

### Why the explicit size guard, given the transport already bounds the plaintext

A Noise transport message is ≤ 65535 bytes, so a single decrypted plaintext is structurally ≤ `MAX_PLAINTEXT_BYTES`. But this module's trust boundary is its **own function argument**, not the socket: the unit test drives `parseInboundMessage` directly (the transport cap is not in the loop), and a future change to the driver's guarantees must not silently un-bound this arm. The guard is one deterministic line, directly satisfies the "oversized" AC, and is testable at this boundary — belt (upstream Noise cap) and suspenders (this check), both deterministic code. It does **not** modify `decodeEnvelope` (shared with the ack path), so there is no drift.

## Related

- [#68 codebase notes](../codebase/68.md) — implementation summary, patterns, lessons (the boundary's introduction).
- [Debug-bundle reassembly (inbound)](debug-bundle-reassembly.md) / [#116 codebase notes](../codebase/116.md) — the additive extension of this boundary: three new recognized kinds, the `error`-modeling change, and the `requireNumber` narrowing helper.
- [Screen snapshot fetch](screen-snapshot-fetch.md) / [#180 codebase notes](../codebase/180.md) — the second additive extension: the `snapshot` kind, `parseScreenSnapshotPayload`, and the new `requireBoolean` helper; the content-minimisation drop of `text`/`ts`/`conversation_id` happens one layer up in [daemon connection](daemon-connection.md), not here.
- [#191 codebase notes](../codebase/191.md) — the third additive extension: two more `requireNumber` fields (`used_tokens`/`window_tokens`) on `ScreenSnapshotPayload`.
- [#199 codebase notes](../codebase/199.md) — the fourth additive extension: `assistant_delta`/`turn_end`, the two v2 interactive-stream kinds, and the deliberate content-carrying divergence from the `snapshot` kind's minimisation pattern.
- [Conversation list fetch](conversation-list-fetch.md) / [#139 codebase notes](../codebase/139.md) — the fifth additive extension: the `conversations` kind, `parseConversationSummary`/`parseConversationsPayload`, and the new `requireStringOrNull` helper (the codec's first nullable-field checker).
- [Conversation timeline store](conversation-timeline-store.md) / [#214 codebase notes](../codebase/214.md) — the sixth additive extension: the `turn_state` kind, `parseTurnStatePayload`, and the closed-enum idiom's second instance (cloned from `role`, not `requireString`).
- [Conversation timeline store](conversation-timeline-store.md) / [#217 codebase notes](../codebase/217.md) — the seventh additive extension: the `tool_use` kind, `parseToolUsePayload`, and the required-string-presence idiom scaled to five fields with no enum.
- [Modal-prompt model](modal-prompt-model.md) / [#201 codebase notes](../codebase/201.md) — the eighth additive extension: the `modal_shown`/`modal_dismissed` kinds, `parseModalShownPayload`/`parseModalDismissedPayload`/`parseModalOption`, the closed-enum idiom's third and fourth instances (`class`/`source`), and the array-of-structs narrower's second use (`options`).
- [Conversation timeline store](conversation-timeline-store.md) / [#229 codebase notes](../codebase/229.md) — the ninth and last additive extension of the v2 interactive-stream family: the `tool_result` kind, `parseToolResultPayload`, and `requireBoolean`'s second use (`is_error`, after `yolo` #180) alongside four `requireString` calls.
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
