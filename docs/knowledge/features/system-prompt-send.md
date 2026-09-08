# System prompt send (read half, transport leg)

The **transport-only** half of reading a conversation's system prompt: an outbound
`request_system_prompt` ask, a decoded `system_prompt` reply, and the correlated event that carries
both the stored prompt and whether the running session was started with a different one. A stored
prompt takes effect only at a conversation's *next* session start, so a client that could not itself
perform the write had no way to learn what a conversation holds, or that the child it is typing at
predates an edit — this slice teaches the transport to ask. The write half, pyrycode#2151, landed
client-side as [#1249](system-prompt-write.md).

Introduced in [#1230](../codebase/1230.md), split from #1078.
[#1231](https://github.com/pyrycode/pyrycode-desktop/issues/1231) closed the renderer read half: the
ask now fires on conversation activation and a dedicated store holds the correlated reply — see
[System-prompt store](system-prompt-store.md). Rendered by the [Channel info sheet's System prompt
section](conversation-shell-session-and-channel-info.md#system-prompt-section-1078) (#1078). The four
exhaustive renderer bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`, `questionBridge`)
keep their dormant no-op arm permanently — #1231 added a *fifth*, independent subscriber rather than
touching those four; see that document's § The bridge for why an exhaustive sixth switch here would be
a security regression.

Nearest shapes in the tree: [request-history-send](request-history-send.md) (#1222) is the closer
analogue — a reply naming no conversation, correlated purely by envelope id — copied for the
correlation map, the routing, and the fresh-literal emit. [Model-list wire types §
Outbound ask](model-list-wire-types.md#outbound-ask-1165) (#1165) is the closer analogue for the
outbound builder: a **required** scalar conversation id, unlike `request_session_settings`'s optional
one. This ticket diverges from both in the one place named below.

## The two facts that shape every piece

**A `system_prompt` reply carries no `conversation_id`.** Exactly `historyPageReceived`'s and
`runConfigReceived`'s argument: which conversation a reply describes is knowable only from which
envelope it answers, so the requester keeps its outstanding asks keyed by envelope id, and the
`conversationId` that crosses to the window is **client-owned** — never a string parsed off the
network. Here the omission is load-bearing rather than merely consistent: it is what makes an
**unhosted** conversation's reply byte-identical to a **hosted-but-quiet** one, so the verb cannot be
used as a conversation-membership oracle. A consumer must never try to repair that merge back apart.

**There is no error frame for this verb at all.** It mints no wire code and has no failure branch —
every unresolvable case upstream (no such conversation, no session, a request that named nothing)
already has a truthful constant answer (`no_session`), so there is nothing left for a code to
distinguish. Two consequences bind this client. First, **nothing retries and nothing may block** on
the reply — the rule [`modelListStore`'s header](model-list-store.md#edge-cases-and-limitations)
states. Second, and unlike every conversation-scoped sibling: an id this client cannot route must be
refused **before the send**, because an empty or unroutable id reaching the wire would draw an
ordinary-looking `no_session` reply with an absent prompt, and the correlation map would file that
false "no prompt, no session" reading against a real conversation — a reading nothing downstream can
tell from a true one. The refusal is the **routing lookup** at the IPC arm
(`router.route(id)?.…`) — deliberately not an emptiness check in the boundary guard or the builder,
both of which check type and shape as every sibling does.

## Where it lives

| Piece | File | Role |
|---|---|---|
| `RequestSystemPromptPayload` / `SystemPromptPayload` / `SessionPromptStatus` + `'request_system_prompt'`/`'system_prompt'` `EnvelopeType` members | `src/shared/wire/types.ts` | ported wire types, field-for-field with the daemon |
| `buildRequestSystemPrompt` | `src/main/transport/requestSystemPromptEnvelope.ts` (new) | pure outbound builder |
| `narrowSessionPromptStatus`, `parseSystemPromptPayload` | `src/main/transport/inboundMessage.ts` | fail-closed inbound decode |
| `requestSystemPrompt(conversationId)`, `pendingSystemPromptRequests` | `src/main/daemonConnection.ts` | connection method + envelope-id → conversation correlation |
| `requestSystemPrompt` command / `isRequestSystemPromptPayload` guard | `src/shared/ipc/commands.ts` | the sealed union member + untrusted-boundary guard |
| `case 'requestSystemPrompt'` | `src/main/index.ts` | conversation-routed dispatch, `router.route(id)?.…` |
| `requestSystemPrompt` delegate | `src/main/connectionRegistry.ts` | the stand-in's one added `viewOf` line |
| `systemPromptReceived` | `src/shared/ipc/events.ts` | the one `DaemonEvent` arm |
| dormant no-op arms | `daemonEventBridge.ts` / `timelineBridge.ts` / `modalBridge.ts` / `questionBridge.ts` | the four exhaustive bridges — present only for the `assertNever` guard |

## The wire types (`src/shared/wire/types.ts`)

```ts
export interface RequestSystemPromptPayload {
  conversation_id: string
}

export type SessionPromptStatus = 'matches' | 'differs' | 'no_session'

export interface SystemPromptPayload {
  system_prompt?: string
  session_prompt_status: SessionPromptStatus
}
```

`'request_system_prompt'` and `'system_prompt'` join `EnvelopeType`, sited adjacent so each member
comment can point at the other. SSOT `pyrycode/pyrycode` `docs/protocol-mobile.md` § *Reading a
conversation's system prompt* / `internal/protocol/system_prompt.go`.

- **`conversation_id` is required**, `RequestModelListPayload`'s rule rather than
  `RequestSessionSettingsPayload`'s optional one — an unnamed request has nothing to ask about, so the
  whole chain (wire type, command payload, boundary guard, connection method, builder input) types it
  required. It is client-owned and a routing id, never a secret: naming a conversation is not
  authorization, which is pairing, enforced structurally at the Noise IK handshake.
- **`system_prompt` is a tri-state, and all three states must survive a round trip.** The daemon
  encodes it `*string` with `omitempty`, testing the pointer rather than the pointee: key omitted → no
  prompt is stored; `""` → an explicitly empty prompt **is** stored; any string → the stored text. A
  `?? ''`, a `|| undefined`, or any truthiness read anywhere on this path collapses two of the three
  into one, which matters because a client must be able to read this value and write it straight back
  through `set_system_prompt` (pyrycode#2151) without changing what it meant. An explicit
  `system_prompt: null` is off-contract — the daemon's encoding never emits one — and is rejected
  rather than folded into either no-bytes state.
- **`SessionPromptStatus` is a closed, three-value union — always present, never `''`.** The daemon
  sets exactly one of the three on every path, including every unresolvable one, so a fourth value has
  no defined reading and is rejected at the decode. This diverges deliberately from
  `SessionSettingsPayload.permission_mode`'s no-allowlist posture: that field's read half carries a mode
  its write half refuses, so narrowing it client-side would fail-close valid traffic, where this field
  is a published enum with no such asymmetry.
- **`no_session` deliberately merges five daemon states**, among them *a conversation this daemon does
  not host* and *a request that named nothing*. That merge is the verb's entire error handling and is
  what stops it being a conversation-membership probe: an unhosted conversation's reply is
  byte-identical to a hosted-but-quiet one. Read it as **one** reading, never as a failure to repair —
  a client that tried to separate the merged states back out would rebuild the oracle upstream removed.
- **The two fields are independent; neither is derived from the other.** Text beside `no_session` is
  the ordinary "configured, applies at the next session start" reading. An **absent** key beside
  `matches` is a conversation holding no prompt whose live session spawned with none — the daemon
  compares the **collapsed** stored value (`Pool.SystemPromptFor` returns `""` for both no-bytes states
  by design), so both read as `matches` against a session spawned with nothing. Inferring "has bytes"
  from the key's presence would misreport a conversation storing an explicitly empty prompt, whose
  session spawned with none, as *differing*.
- **The spawned-with text is deliberately not carried.** `differs` says the two disagree and stops
  there, rather than echoing up to another 8192 bytes of operator text back over the wire to prove it.
- **SECURITY: `system_prompt` is untrusted operator text arriving over the network.** A value to be
  rendered later (#1078) and nothing else — never a lookup path, a cache key, a filename, an attribute
  or a URL, never into a raw-markup sink (no `innerHTML` / `dangerouslySetInnerHTML`), and never into a
  log line or an error message on any path, the decode-failure path included. Its length is **not** a
  client branch: the daemon caps it write-side at 8192 bytes, the way it caps `model` at 256;
  `MAX_PLAINTEXT_BYTES` on the envelope is the only size gate on this path.

## Outbound — `src/main/transport/requestSystemPromptEnvelope.ts` (new, main-only)

```ts
export interface RequestSystemPromptInput {
  id: number
  ts: string
  conversationId: string
}
export function buildRequestSystemPrompt(input: RequestSystemPromptInput): Uint8Array
```

A sibling to `requestModelListEnvelope.ts` — same one-concern-per-file split, same **fresh one-field
literal naming `conversation_id`, never a spread of the caller's object**, so a field smuggled past the
command guard is dropped here rather than sent.

**No emptiness check, and the reason diverges from `buildRequestModelList`'s rather than copying it.**
That builder declines one because an unresolvable id there draws a visible `conversation.not_found`,
which is the daemon's call to make. This verb has no error frame at all, so the refusal that keeps an
empty id off the wire is the **routing lookup** at the IPC arm one layer up, not a second, weaker bound
here that would only risk disagreeing with the router's. `''` reaches the wire exactly as written.

Main-process only — imports `codec.ts` (Node `Buffer`); never re-exported through a renderer barrel.

## The command + guard (`src/shared/ipc/commands.ts`)

```ts
| { type: 'requestSystemPrompt'; payload: RequestSystemPromptPayload }

function isRequestSystemPromptPayload(value: unknown): value is RequestSystemPromptPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}
```

Type, not emptiness — the same posture `requestModelList`'s guard takes, and worth reading before
"hardening" it: this verb's divergence from its neighbours pushes the *other* way. They tolerate `''`
because the daemon answers an unresolvable id visibly; this one has no visible answer at all, so
weakening this guard to reject `''` would not close the gap the routing lookup already closes, and
would only add a second rule to keep in agreement with it. (Contrast `newSession`'s guard, the one
member in this file that *does* reject `''` — there an empty id is a real wire meaning, the daemon's
process-wide follow-active cursor, and this verb has no such fallback to protect against.)

`src/main/index.ts`'s `case 'requestSystemPrompt':` is conversation-routed exactly like
`requestModelList`, reading `command.payload.conversation_id` once as both the routing key and the
field the builder consumes, so the id routed by and the id sent can never be two different
expressions. `connectionRegistry.ts`'s `viewOf` gained one delegate line.

## Inbound decode (`src/main/transport/inboundMessage.ts`)

New `InboundDaemonMessage` member: `{ kind: 'system-prompt'; systemPrompt: SystemPromptPayload;
inReplyTo?: number }` — `inReplyTo` optional, `session-settings`'s and `history-page`'s posture: a
reply without a correlation handle is merely *uncorrelatable*, not malformed, so the fail-closed drop
belongs one layer up.

- **`narrowSessionPromptStatus(value): SessionPromptStatus | null`** — a `switch` comparing the
  untrusted string against the three client-owned literals, returning `null` outside the set. The
  rejected value is never passed to this function's caller as anything but the boolean fact "narrowed
  or not" — it stays out of the function that could interpolate it into a message, a structural version
  of the never-log rule rather than one held by comment discipline. (This shipped as a split from the
  plan's single-function description — see § Revisions in the architecture spec.)
- **`parseSystemPromptPayload(payload)`** — `isRecord` guard, then `optionalString(payload,
  'system_prompt')` for the tri-state (the same helper already used for `permission_mode` and other
  optional wire strings: absent → `undefined`, `''` → `''`, text → text, `null`/non-string → throws),
  then `narrowSessionPromptStatus(requireString(payload, 'session_prompt_status'))`, throwing if it
  returns `null`. Returns a fresh two-field literal, so a server-added key — a `conversation_id` this
  reply deliberately does not carry, included — is tolerated for forward-compat but never copied
  through.
- **No length bound on the prompt**, deliberately: the daemon caps it write-side at 8192 bytes and the
  frame-level `MAX_PLAINTEXT_BYTES` guard already fails an oversized frame before this runs; a second,
  client-side bound here would either defend an unreachable failure or, set below the daemon's,
  fail-close a valid prompt.
- The `case 'system_prompt':` switch arm narrows **before** logging, then emits the existing
  content-free record (`event: 'inbound-decoded'`, `code: 'system_prompt'`, byte length, one-way hash).
  No decoded field — not the prompt, not the status — ever reaches a log line, and the messages
  `parseSystemPromptPayload` can throw name the failure category and the client-owned field constant
  only (`'malformed field: session_prompt_status'`), never the rejected value.

## Correlation (`src/main/daemonConnection.ts`)

An eighth correlation store, the `pendingConfigRequests`/`pendingHistoryRequests` shape exactly:
`pendingSystemPromptRequests: Map<number, string>` — envelope id → the conversation id the request
named. See [Daemon connection — correlation § System-prompt read correlation
(#1230)](daemon-connection-correlation.md#system-prompt-read-correlation-1230) for the full
walk-through; in outline:

- **Set only after a successful send.** `requestSystemPrompt(conversationId)` captures `envelopeId =
  nextEnvelopeId` into one local read three times (build, counter advance, map set), advances the
  counter only after a successful `buildRequestSystemPrompt`, calls `driver.sendMessage`, and only then
  records `pendingSystemPromptRequests.set(envelopeId, conversationId)`. A build or send that throws
  leaves no entry under an unspent id — an entry left there would answer whichever request next re-mints
  that id, handing one conversation's system prompt to another.
- **Match + delete, fail-closed.** `case 'system-prompt':` short-circuits before the lookup when
  `inReplyTo` is absent, short-circuits again on a map miss (a stale reply from a cleared connection, a
  duplicate of an already-matched reply, or a hostile daemon forging a prompt for a request this client
  never sent), and on a hit `delete`s the entry and emits `systemPromptReceived` as a **fresh
  named-field literal** — never a spread of `inbound.systemPrompt`.
- **No `daemon-error` tier member — there is nothing to correlate there.** This verb has no error
  frame, so unlike `pendingHistoryRequests`/`pendingConfigRequests` this map is checked in exactly one
  inbound arm, never in `case 'daemon-error':`.
- **Reset on `dial()`**, beside its seven siblings — a fresh connection recycles envelope ids from 2, so
  a surviving entry would attribute the new connection's first reply to a dead one's conversation.
- **No cap**, the same evidence-based, no-observed-failure posture every sibling store in this file
  takes; an entry costs one number and one string, and the only way to accumulate them is this client
  sending asks a daemon never answers.

## The `DaemonEvent` arm (`src/shared/ipc/events.ts`)

```ts
| { type: 'systemPromptReceived'
    conversationId: string
    systemPrompt: string | undefined
    sessionPromptStatus: SessionPromptStatus }
```

- **`conversationId` is client-owned**, carrying `runConfigReceived`'s and `historyPageReceived`'s
  provenance argument verbatim — the map's value, never a field of the decoded payload (the reply has
  none). The numeric `in_reply_to` it was resolved from is deliberately **not** carried.
- **`systemPrompt` is a required key of type `string | undefined`, not an optional property** — so no
  consumer can forget it and no producer can omit it. `undefined` is a structured-clone-supported
  value, so the tri-state survives the IPC bridge exactly as decoded: `undefined` (no prompt stored),
  `''` (an explicitly empty prompt stored), or the text.
- **`sessionPromptStatus` is independent of `systemPrompt`**, a client-owned literal narrowed at the
  decode boundary — no daemon string crosses on this field.
- The four exhaustive bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`, `questionBridge`)
  each gain one dormant no-op arm. Not bookkeeping: the `assertNever` guard each carries stringifies the
  **whole event** into an `Error` message, and `systemPrompt` is untrusted operator-authored text that
  reaches no other sink on any path — a missing arm would be the one route by which it lands in an
  `Error` message, a stack trace, and a crash reporter.

## Data flow

```
window → sendCommand({type:'requestSystemPrompt', payload:{conversation_id}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isRequestSystemPromptPayload)
      → router.route(conversation_id)?.requestSystemPrompt(conversation_id)   [no server hosts it ⇒ no wire at all]
      → buildRequestSystemPrompt (fresh 1-key literal) → driver.sendMessage
        → pendingSystemPromptRequests.set(envelopeId, conversationId)   [only after a successful send]

daemon → system_prompt frame → parseSystemPromptPayload (fail-closed)
      → { kind:'system-prompt', systemPrompt: SystemPromptPayload, inReplyTo }
      → daemonConnection matches inReplyTo against pendingSystemPromptRequests
      → hit:  delete entry → DaemonEvent{ systemPromptReceived, conversationId, systemPrompt, sessionPromptStatus }
      → miss / absent inReplyTo: dropped silently, no event

→ DAEMON_EVENT_CHANNEL → all four exhaustive bridges: dormant no-op
```

## Error handling

| Layer | Result | Failure behaviour |
|---|---|---|
| `buildRequestSystemPrompt` | `Uint8Array` | May throw `WireEncodeError` in principle; a fixed-shape ~110-byte envelope plus one conversation id can never approach `MAX_PLAINTEXT_BYTES`, but the sole caller catches anyway. |
| `isRequestSystemPromptPayload` | `boolean` | A missing/mistyped `conversation_id` is rejected at the untrusted→trusted boundary. |
| `router.route(conversationId)` | connection \| `null` | An id no server has claimed puts **no frame on any wire at all** — this is AC1's whole refusal, and it is this lookup, not a guard or builder check. |
| `parseSystemPromptPayload` | `SystemPromptPayload` | Throws `WireDecodeError` on a non-object payload, a non-string/`null` `system_prompt`, or a `session_prompt_status` outside the three published values. Never a partial value. |
| `parseInboundMessage` | frame-level | An oversized frame throws before any parse (`MAX_PLAINTEXT_BYTES`); the consumer's existing `catch` drops it with no event, no log. |
| `requestSystemPrompt` (connection method) | `void` | Inert no-op when `driver === null`. `try/catch` drops any thrown object silently — never logged, never forwarded, **no retry, ever**. |
| `case 'system-prompt'` (consumer) | `void` | Absent or unmatched `inReplyTo` → dropped silently. A hit → exactly one `systemPromptReceived`. |
| Daemon | — | **No error frame exists for this verb.** Every unresolvable case (no such conversation, no session, an unnamed request) comes back as an ordinary `no_session` reading with an absent prompt — ordinary traffic, not a failure this client can distinguish. A non-negotiated connection is answered with nothing at all, same as a dropped frame. |
| Window | — | `systemPromptReceived` ships dormant across the four exhaustive bridges; [System-prompt store](system-prompt-store.md)'s fifth, independent subscriber is the first consumer (#1231), fired from an ask on conversation activation. |

## Security properties

Ticket carries `security-sensitive`; builder self-review verdict **PASS**, one SHOULD FIX (the emitted
`conversationId` provenance — closed by a dedicated test, see below), one MUST FIX addressed in the
design before the review concluded (the four bridges' `assertNever` log-sink risk, closed by requiring
all four arms as an AC).

- **One boundary per direction, both named functions.** Inbound: `parseSystemPromptPayload` is the only
  place `system_prompt` bytes become a typed value, and it fails closed; past it, the payload is
  consumed once, at the emit, as a fresh literal. Outbound: `isRequestSystemPromptPayload` is the
  renderer→main guard, and `buildRequestSystemPrompt`'s fresh literal is the wire bound behind it — a
  field smuggled past the guard is dropped, not sent.
- **`conversationId` on the emitted event must come from the map, not the decoded payload — a rule the
  type system cannot enforce, only a test can.** Writing `inbound.systemPrompt.conversation_id` is
  impossible (the payload has no such field), but writing the *open* conversation's id, or emitting
  without the id at all, both typecheck. The deterministic guard is the test asserting a reply is
  attributed to the **requested** conversation and not to a second, open one — see § Testing strategy.
- **No credential of any kind minted, stored, read, or transported.** `conversation_id` is a routing id,
  not a secret; naming a conversation is not authorization, which is pairing at the Noise handshake.
- **No filesystem operation on this slice.** Neither the prompt nor the conversation id is ever joined
  into a path, filename, or cache key — the never-a-lookup-path rule stated on the wire type and the
  IPC arm both.
- **No new IPC channel, no new `contextBridge` member.** The command rides the existing
  `COMMAND_CHANNEL` through the generic `sendCommand`; the event rides the existing daemon-event
  channel. The one new attack-surface line is the `isRendererCommand` case, and it lands in the same
  commit as the `RendererCommand` member it guards (the lockstep rule: a member added without its case
  is *silently dropped* at the boundary rather than failing loudly).
- **No new cryptographic primitive, size gate, or retry policy.** The frame rides the established Noise
  session; `MAX_PLAINTEXT_BYTES` is the only size gate; nothing here retries, ever.
- **Content-free logging preserved.** The decode logs the existing static record only — never the
  prompt, never the status. `requestSystemPrompt`'s catch drops its caught object
  (classify-don't-forward), matching every sibling connection method.
- **Threat model: malicious relay** — addressed. It is on-path and content-blind; it can withhold this
  frame, costing a stale reading, never a forged one into a session it cannot read.
- **Threat model: hostile daemon inside the session** — the primary threat here, addressed. A forged
  reply for a request this client never sent matches no outstanding entry and is dropped entirely; a
  malformed or off-contract one fails the decode closed; an oversized one dies at
  `MAX_PLAINTEXT_BYTES` before any narrower runs.
- **Threat model: membership probe** — addressed by the daemon's own design, and this client must not
  undo it. `no_session` deliberately merges five daemon states including "not hosted here"; this slice
  branches on it nowhere and must never try to separate the merge back apart.
- **Threat model: renderer compromise** — addressed. A compromised renderer gains exactly one new
  capability, asking for any conversation's system prompt by id and reading back the answer — not a new
  capability in kind, since it can already send `requestSessionSettings`/`requestHistory`/`sendMessage`
  for the same ids, and the daemon serves only what the authenticated session is entitled to.

## Testing strategy

All vitest; no Playwright spec, since nothing in the window reaches this path in this slice.

- `requestSystemPromptEnvelope.test.ts` (new) — real codec bytes decoded back: the envelope carries the
  exact `id`/`ts`/`type`; the payload is exactly `{ conversation_id }`, always a string; the named
  conversation id crosses verbatim; an empty conversation id is sent as written, with no normalisation
  of its own.
- `inboundMessage.test.ts` — a full `system_prompt` decodes into `{ kind: 'system-prompt' }` carrying
  `inReplyTo`; the tri-state as three distinct outcomes (absent → `undefined`, `''` → `''`, text →
  text); each of the three published statuses narrows verbatim, independent of the prompt; an unknown
  server key is dropped, keeping only the two known fields; an absent `in_reply_to` narrows as
  `undefined` rather than failing the decode. Rejects: an explicit `system_prompt: null`; a non-string
  `system_prompt`; a `session_prompt_status` outside the three values; a missing or non-string
  `session_prompt_status`; a non-object payload. Log discipline: a well-formed decode logs the
  content-free record only; a malformed one logs **nothing at all**, and the thrown error's message
  quotes no prompt text.
- `daemonConnection.test.ts` — inert no-op before `start()`; exactly one `request_system_prompt` frame
  carrying the conversation id handed to it; a correlated reply emits `systemPromptReceived` carrying
  the **requested** conversation id, verified against a second, open conversation to close the
  provenance finding above; the tri-state and the independent status cross IPC distinct; an absent or
  unmatched `in_reply_to` emits nothing; a second reply reusing an already-matched id emits nothing (the
  entry was deleted); two interleaved asks each draw their own conversation back, keyed by envelope id;
  a malformed reply emits nothing and records no diagnostic; `dial()` clears outstanding asks so a stale
  id cannot correlate on a new connection.
- `commands.test.ts` — the guard accepts a well-formed `requestSystemPrompt`, checking type not
  emptiness (an empty `conversation_id` passes); rejects a missing payload, an explicitly-`undefined`
  payload, and a non-string id; a `@ts-expect-error` pins the payload as required (a bare send does not
  compile).
- `connectionRegistry.test.ts` — the delegation stub, so `viewOf` stays complete.

**Non-vacuity, mutation-checked and reverted** (recorded in the architecture spec's `## Revisions`):
weakening the correlation gate to `pendingSystemPromptRequests.get(inReplyTo) ?? '<some open
conversation>'` reddened 3 tests; collapsing the tri-state with `system_prompt ?? ''` at the emit
reddened 1. Both confirm the tests are load-bearing rather than merely present.

Fakes over mocks throughout: the existing `daemonConnection.test.ts` driver fake and the real codec.

## Related

- [System prompt write](system-prompt-write.md) — the write half's transport leg (#1249): the outbound
  `set_system_prompt` verb, the client-side byte bound, and the two correlated outcomes. **This
  document's "there is no error frame for this verb at all" is true only of the read verb** —
  `set_system_prompt` has two published reject codes and joins the `daemon-error` precedence tier; do
  not read this document's no-error-frame consequences (the routing lookup as the only refusal, the
  single correlation arm) as applying to the write half too.
- [System-prompt store](system-prompt-store.md) — the renderer read half (#1231): the store, the
  fifth-subscriber bridge, the activation ask, and the drop joining `runConfigStore`'s clear seam.
- [Daemon connection — correlation § System-prompt read correlation
  (#1230)](daemon-connection-correlation.md#system-prompt-read-correlation-1230) — the
  `pendingSystemPromptRequests` walk-through in full.
- [Daemon connection — methods](daemon-connection-methods.md) — the `requestSystemPrompt(conversationId)`
  entry in the public surface.
- [Daemon connection — conversation routing](daemon-connection-conversation-routing.md) — where
  `requestSystemPrompt` joined the conversation-routed set, and the `viewOf` delegate line.
- [Command channel](command-channel.md) — the `requestSystemPrompt` `RendererCommand` member +
  `isRequestSystemPromptPayload` guard this channel's union gained.
- [Inbound message decode — extension history](inbound-message-decode-history.md) — the `system_prompt`
  kind's place in the chronological account of every additive extension to `InboundDaemonMessage`.
- [Model-list wire types § Outbound ask](model-list-wire-types.md#outbound-ask-1165) — the closer
  analogue for the outbound builder (required scalar id, no emptiness check) and for the no-retry rule
  this verb inherits.
- [Request history send](request-history-send.md) — the closer analogue for the correlation map and the
  reply-names-no-conversation shape, and the sibling this ticket diverges from on the one point named
  above: that verb has an error frame and a `daemon-error` correlation tier; this one has neither.
- `docs/specs/architecture/1230-request-system-prompt.md` — the full architecture spec, including the
  sizing overage (12 production files against a 5-file ceiling, taken whole on the floor rule since the
  one available split would not have brought either half under 5 files either), the full security
  review (verdict PASS), and the `## Revisions` entry recording the `narrowSessionPromptStatus` split and
  the two reverted-mutation checks.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § *Reading a conversation's system
  prompt* — SSOT for the field tables and the `no_session` merge.
