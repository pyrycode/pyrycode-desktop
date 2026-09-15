# System prompt write (transport leg)

The **write half's transport leg**: an outbound conversation-keyed `set_system_prompt` verb carrying a
tri-state prompt, a renderer→main command member with its boundary guard, a client-side byte bound on
the operator's text, and the two correlated outcomes — a confirmation resolved off the reused
`conversation_updated` ack, and a refusal resolved off the existing `daemon-error` path — crossing to
the window as typed events. #1250 added the window-side send and store; #1078's [System prompt
section](conversation-shell-session-and-channel-info.md#system-prompt-section-1078) renders it.

Introduced in [#1249](../codebase/1249.md), split from #1232. The daemon side is `pyrycode/pyrycode`
\#2149 (storage) / #2150 (applied at next spawn) / #2151 (this write verb) / #2152 (the read verb, the
`request_system_prompt`/`system_prompt` pair [System prompt send](system-prompt-send.md) already
carries). This slice closes the write leg the read leg's own overview flagged as "not this client's
yet."

Nearest shapes in the tree: [Daemon connection — correlation](daemon-connection-correlation.md)'s
`pendingConfigRequests`/`pendingHistoryRequests` shape is the correlation-map template;
`changeWorkspaceEnvelope.ts` is the closest conversation-keyed outbound-builder template (an
already-built `payload` rather than scalars); [Request history send](request-history-send.md) (#1222)
is the closest analogue for a per-verb narrowed `daemon-error` field.

## The two things that make this slice unlike its read half

**1. The ack is a record this client had never correlated before this ticket.** The reply is the
reused `conversation_updated` record, correlated by `in_reply_to`. It confirms the write and
deliberately **does not carry the prompt** — that record is broadcast to every client on the
server-id, so carrying it would widen the audience for a value only the requester asked about. Before
this ticket `conversation_updated` decoded with **no `inReplyTo` field at all** and was emitted
unconditionally as a broadcast; every earlier conversation-keyed write verb (`change_workspace`,
`archive`, `unarchive`, `rename`, `promote`) declines to correlate it. This is the first that must —
and the frame has a **live second consumer**, `conversationListBridge`, which treats every
`conversationUpdated` as a list-refresh trigger (#275). The `daemon-error` tier's consume-the-frame
shape (see [Daemon connection — correlation](daemon-connection-correlation.md)'s later members) is the
wrong template for the ack: copying it would stop the requester's own write from refreshing their own
conversation row. So the correlation is **additive**: the broadcast emit stays, unconditional and
first, and the write confirmation is emitted *after* it on a match.

**2. This verb has refusals; the read verb had none.** [System prompt send](system-prompt-send.md)
states "there is no error frame for this verb at all" — true of `request_system_prompt` and false
here. Refusals arrive on the existing `daemon-error` path correlated by `in_reply_to`, joining that
precedence tier as its fifth member, on `request_history`'s template: a daemon `code` narrowed at the
decode boundary against client-owned literals, so no daemon string crosses IPC.

## Where it lives

| Piece | File | Role |
|---|---|---|
| `SetSystemPromptPayload` + `MAX_SYSTEM_PROMPT_BYTES` + `'set_system_prompt'` `EnvelopeType` member | `src/shared/wire/types.ts` | ported wire types |
| `buildSetSystemPrompt` | `src/main/transport/setSystemPromptEnvelope.ts` (new) | pure outbound builder |
| `conversation-updated`'s new `inReplyTo?`, `SystemPromptRejectReason` + `narrowSystemPromptRejectReason`, `daemon-error`'s new `systemPromptReject?` | `src/main/transport/inboundMessage.ts` | additive inbound decode |
| `setSystemPrompt(payload)`, `pendingSystemPromptWrites` | `src/main/daemonConnection.ts` | connection method + correlation |
| `setSystemPrompt` command / `isSetSystemPromptPayload` guard | `src/shared/ipc/commands.ts` | the sealed union member + untrusted-boundary guard |
| `case 'setSystemPrompt'` | `src/main/index.ts` | conversation-routed dispatch |
| `setSystemPrompt` delegate | `src/main/connectionRegistry.ts` | the stand-in's one added `viewOf` line |
| `SystemPromptWriteFailure`, `systemPromptWriteConfirmed`/`systemPromptWriteRejected` | `src/shared/ipc/events.ts` | the two new `DaemonEvent` arms |
| dormant no-op arms (×2) | `daemonEventBridge.ts` / `timelineBridge.ts` / `modalBridge.ts` / `questionBridge.ts` | eight arms across the four exhaustive bridges |

## The wire types (`src/shared/wire/types.ts`)

```ts
export const MAX_SYSTEM_PROMPT_BYTES = 8192

export interface SetSystemPromptPayload {
  conversation_id: string
  system_prompt: string | null
}
```

- **`system_prompt` is `string | null`, a REQUIRED key** — the mirror of the daemon's `SystemPrompt
  *string` with **no** `omitempty`, the convention `ConversationUpdatedPayload.name` already follows in
  this file. `null` clears, `''` is an explicitly-empty stored state, text is stored verbatim. Declared
  required rather than optional so the clear path must be *said*: a producer cannot omit the key and a
  consumer cannot forget it. `string | undefined` would be the wrong mirror — Go would emit `null`, not
  an absent key — and an optional property invites the `?? ''` collapse the read half's contract
  forbids. **The tri-state must survive the whole chain** — TypeScript type, IPC command payload,
  boundary guard, envelope literal — or the clear path is unreachable; a `?? ''` or `|| undefined`
  anywhere collapses two of the three states into one.
- **`MAX_SYSTEM_PROMPT_BYTES` mirrors the daemon's `MaxSystemPromptBytes`**, sited beside
  `MAX_FRAME_BYTES`/`MAX_PLAINTEXT_BYTES`. A bound on **bytes of UTF-8**, not UTF-16 code units — the
  two disagree for any multi-byte prompt, and the daemon measures bytes.
- **`'set_system_prompt'` joins `EnvelopeType`** in the conversation write-verb group beside
  `'change_workspace'`. Its member comment records that it is keyed by **conversation, not session** —
  the prompt must be settable with nothing running and outlives every session the conversation has —
  and that the session-keyed `set_session_settings` is a different verb this must not be modelled on.
- No new *inbound* payload type. The ack reuses `ConversationUpdatedPayload`, which deliberately grows
  no prompt field: the record is broadcast-shaped and only the requester asked about the value.
- **The byte bound is not the bound the read half argued against.** [System prompt send](system-prompt-send.md)
  declines a client-side length check on the *inbound* prompt, because the daemon caps it write-side
  and `MAX_PLAINTEXT_BYTES` already fails an oversized frame. This is the **outbound** direction, where
  the operator's own text is bounded before a non-retryable refusal is spent on it — the read half's
  posture does not forbid this one.

## Outbound builder — `src/main/transport/setSystemPromptEnvelope.ts` (new, main-only)

```ts
export interface SetSystemPromptInput {
  id: number
  ts: string
  payload: SetSystemPromptPayload
}
export function buildSetSystemPrompt(input: SetSystemPromptInput): Uint8Array
```

`buildChangeWorkspace`'s shape — an already-validated payload rather than scalars, since there are two
fields. The **fresh two-field literal that bounds the wire lives in the connection method**, matching
`changeWorkspace`/`renameConversation`, so a field smuggled past the structural-minimum guard is
dropped rather than sent. No length check here — the builder cannot emit an outcome, and a bound that
fails silently would be the "thrown away" refusal the ticket's AC2 forbids. No emptiness check on the
id either — the routing lookup one layer up is the refusal, as it is for every conversation-routed
verb. Main-process only, never re-exported through a renderer barrel.

## The command + guard (`src/shared/ipc/commands.ts`)

```ts
| { type: 'setSystemPrompt'; payload: SetSystemPromptPayload }

function isSetSystemPromptPayload(value: unknown): value is SetSystemPromptPayload
```

The guard checks **three** things where its siblings check one: `conversation_id` present and a
string; `system_prompt` **present**; and `system_prompt` a `string` **or** exactly `null`. The presence
check is load-bearing — an absent key would be read as `undefined` downstream and the tri-state would
have four inhabitants, one of them meaningless. Type, not emptiness, and **not length**: the length
verdict must produce an outcome, and a guard rejection produces none.

`src/main/index.ts` gains `case 'setSystemPrompt':`, conversation-routed off
`command.payload.conversation_id` in `changeWorkspace`'s shape (reads the id once, both as routing key
and as the field the builder consumes). `connectionRegistry.ts`'s `viewOf` gained one delegate line.

## Connection method + correlation (`src/main/daemonConnection.ts`)

```ts
setSystemPrompt(payload: SetSystemPromptPayload): void
```

Ordered deliberately:

1. **The byte bound runs FIRST, before the `driver === null` guard.** When `payload.system_prompt` is a
   string and `Buffer.byteLength(value, 'utf8') > MAX_SYSTEM_PROMPT_BYTES`, emit
   `systemPromptWriteRejected` with `reason: 'prompt-too-long'` and return — nothing is built, nothing
   is sent, no map entry is made. Length-first rather than connected-first because the verdict is about
   the value and is true whether or not a socket is up; a disconnected over-length write that vanished
   silently would be exactly the "thrown away" refusal the ticket forbids. `null` has no bytes and
   skips the check. **Measured with `Buffer.byteLength`, never `.length`** — a mutation check confirmed
   `.length` (UTF-16 code units) reddens a test seeded with a multi-byte string under 8192 UTF-16 units
   but over 8192 bytes. The comparison is strict `>`, not `>=` — a mutation check confirmed `>=` would
   fail-close a prompt at exactly 8192 bytes, which the daemon accepts.
2. **Inert when `driver === null`**, every sibling's posture — no outcome.
3. **Build → advance the counter → send → record**, `requestSystemPrompt`'s ordering verbatim: one
   local for the envelope id read three times, the counter advanced only after a successful build, and
   `pendingSystemPromptWrites.set(envelopeId, payload.conversation_id)` only **after** a successful
   send, so a build or send that throws leaves no entry under an id the next request re-mints.
4. **`catch` drops the caught object** — it could quote the prompt. No log, no event, no retry.

`pendingSystemPromptWrites: Map<number, string>` — envelope id → the conversation id this client
named — is the **ninth** correlation store in `daemonConnection.ts`, sited beside
`pendingSystemPromptRequests` and **cleared in `dial()`** beside its siblings: a fresh connection
recycles envelope ids from 2, so a surviving entry would settle a new connection's write against a dead
one's conversation. A `Map`, not a bare object, for the reason its siblings state (the key is
client-minted, and the shape must stay hostile-key-proof if it is ever widened). No cap, on
`pendingHistoryRequests`' evidence-based argument. See [Daemon connection — correlation § System-prompt
write correlation (#1249)](daemon-connection-correlation.md#system-prompt-write-correlation-1249) for
the full walk-through.

## Inbound decode (`src/main/transport/inboundMessage.ts`)

Three additive changes; **no new payload parser**.

- **`conversation-updated` gains `inReplyTo?: number`**, propagated from the already-decoded
  `envelope.in_reply_to` in `case 'conversation_updated':`. Optional, on `history-page`'s and
  `session-settings`' posture: a record without a handle is merely uncorrelatable, not malformed, and
  it is the *ordinary* case — the daemon also pushes this record unsolicited (pyrycode#2156's host-side
  `pyry channel new`). The pre-existing member comment claiming the record is **never** correlated was
  corrected in the same edit — the daemon replies to the requester with `in_reply_to` on all six write
  verbs, this one included; `daemonConnection.ts`'s `case 'conversation-updated':` emit stays
  **unconditional and first**, so nothing about today's broadcast behaviour changes.
- **`SystemPromptRejectReason = 'protocol-malformed' | 'conversation-not-found'`** and
  **`narrowSystemPromptRejectReason(payload): SystemPromptRejectReason | undefined`** —
  `narrowHistoryRejectReason`'s twin exactly: `isRecord`, a `string` check, then a `switch` whose
  untrusted `code` is a **comparand against client-owned literals and is then dropped**, never an
  index, a join, or a resolve. Total by construction: never throws, for the reason its neighbours
  state — an error frame is terminal because it *arrived*, and a throw here would hand a hostile daemon
  a one-frame kill switch over every `daemon-error` consumer.
- **`daemon-error` gains `systemPromptReject?: SystemPromptRejectReason`**, set in `case 'error':`
  beside `historyReject` off the same untrusted `code`. Optional on `historyReject`'s posture: absence
  has exactly one meaning — "outside this verb's published set" — read at exactly one emit, mapped to
  `'unclassified'`. Two collateral test edits were needed in `inboundMessage.test.ts`: `toEqual` ignores
  an `undefined` property but fails on a *defined* one, so the moment this narrower started classifying
  `protocol.malformed`, two pre-existing whole-object assertions on the `daemon-error` kind went red.
  Both were fixed by naming the sibling field explicitly rather than loosening to `toMatchObject`, which
  would have retired the strictness that surfaced them.

The `case 'error':` log record is untouched: the logged `code` stays the client-owned literal
`'error'`, never `envelope.payload.code`.

## The two `DaemonEvent` members (`src/shared/ipc/events.ts`)

```ts
export type SystemPromptWriteFailure =
  | 'prompt-too-long'
  | 'protocol-malformed'
  | 'conversation-not-found'
  | 'unclassified'

| { type: 'systemPromptWriteConfirmed'; conversationId: string }
| { type: 'systemPromptWriteRejected'; conversationId: string; reason: SystemPromptWriteFailure }
```

- **Both carry `conversationId`, and it is the correlation handle #1250 plans against.** It is the
  map's value — the id this client put in its own outbound frame — never the `id` the ack record
  echoes back, which a hostile or confused daemon controls. Carrying it is what keeps these off the
  `workspaceFolderRejected` anti-precedent: a **bare** outcome ("carries NOTHING", per
  `src/shared/ipc/events.ts`'s own docblock for that member) would satisfy a careless reading of
  "exactly one confirmation outcome" while leaving the sibling ticket unable to settle the write that
  caused it. The numeric `in_reply_to` the match was made on is deliberately not carried.
- **The confirmation carries nothing else, deliberately.** The ack does not carry the prompt and must
  not be made to look as though it does; what a conversation now holds is the read path's answer
  ([System prompt send](system-prompt-send.md)/[System-prompt store](system-prompt-store.md)), not this
  one's. Telling the operator that a saved prompt does not touch the running session is #1078's job.
- **`prompt-too-long` is a distinct member from `protocol-malformed`**, though the daemon merges them
  under one code. The client-side refusal is a different fact: nothing reached the wire, and the repair
  is specifically "shorten the prompt", where the daemon's `protocol.malformed` also covers a payload
  that would not decode. Folding them would claim the daemon said something it never did.
- **`unclassified` is not a hedge**, `HistoryRequestFailure`'s argument transplanted: a correlated
  refusal must always settle the write, or #1250 reports a rejected write as permanently in flight. A
  code outside the two published ones lands here rather than being dropped.
- **No `retryable` flag.** Both published conditions are non-retryable and so is the client-side one, so
  a carried flag would be a constant — unlike `historyRequestFailed`, whose set has exactly one
  retryable member.
- **Both were widened onto `DaemonErrorOutcome`'s sibling-narrower shape, not onto `DaemonErrorOutcome`
  itself** — see [Daemon error outcome](daemon-error-outcome.md#the-fourth-verb-caution) for why, and
  for the standing caution this ticket adds: `daemon-error` now carries a **third** per-verb narrowed
  field, and a fourth correlated verb should prompt a rethink of that shape rather than a fourth field.
- Each of the four exhaustive bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`,
  `questionBridge`) gains **two** dormant no-op arms — eight in all. Not bookkeeping: each bridge's
  `assertNever` stringifies the whole event into an `Error` message, and while neither event carries
  prompt text, `conversationId` is a routing key that reaches no other sink. The arms keep the union's
  exhaustiveness compile-forced as it grows.

**The `daemon-event-channel-sealed-union.md` reference doc is not updated with these two members.**
That file sits at 49753 bytes against the 50000-byte cap `npm run check:docs` enforces, with no
internal heading structure to split at — a pre-existing condition, not one this ticket created. Adding
either the type-union lines or a commentary bullet there would push it over. This document and
`src/shared/ipc/events.ts` are the source of truth for the two new members until that file is split.

## The correlated-ack pattern, stated once for reuse

This is the first verb in the tree to correlate a record that was previously an unconditional
broadcast, and the shape is worth restating for whichever verb needs it next: **emit the broadcast
first, unconditionally, exactly as before; then look up the correlation map; on a match, emit a
*second*, additional event and delete the entry.** Never make the correlated emit replace the
broadcast, and never gate the broadcast on whether a correlation was found — a verb with a live second
consumer of the unconditional emit (here, `conversationListBridge`) would silently break the moment the
correlated path swallowed the frame the way the `daemon-error` precedence tier's members do.

## Data flow

```
window → sendCommand({type:'setSystemPrompt', payload:{conversation_id, system_prompt}})
      → COMMAND_CHANNEL → onCommand (isRendererCommand → isSetSystemPromptPayload)
      → router.route(conversation_id)?.setSystemPrompt(payload)

daemonConnection.setSystemPrompt(payload):
  over-length string → systemPromptWriteRejected{conversationId, reason:'prompt-too-long'}  [no frame sent]
  driver === null → no-op
  else → buildSetSystemPrompt (fresh 2-key literal) → driver.sendMessage
       → pendingSystemPromptWrites.set(envelopeId, conversation_id)   [only after a successful send]

daemon → conversation_updated frame → decode → { kind:'conversation-updated', conversationUpdated, inReplyTo }
      → emit conversationUpdated   [UNCONDITIONAL, always first — conversationListBridge's trigger]
      → pendingSystemPromptWrites lookup by inReplyTo
        hit:  delete entry → systemPromptWriteConfirmed{conversationId}   [second, additional event]
        miss/absent inReplyTo: no confirmation, broadcast still fired

daemon → error frame → narrowSystemPromptRejectReason(code) → daemon-error{systemPromptReject}
      → pendingSystemPromptWrites lookup by inReplyTo
        hit:  delete entry → systemPromptWriteRejected{conversationId, reason}, frame consumed, return
        miss: falls through to the tier's existing members unchanged

→ DAEMON_EVENT_CHANNEL → all four exhaustive bridges: dormant no-op (×2 arms)
```

## Error handling

| Layer | Result | Failure behaviour |
|---|---|---|
| `isSetSystemPromptPayload` | `boolean` | A missing/mistyped `conversation_id`, or a `system_prompt` that is absent, `undefined`, or neither string nor `null`, is rejected at the untrusted→trusted boundary. No outcome — a malformed command is a renderer bug, not an operator-visible refusal. |
| `router.route(conversation_id)` | connection \| `null` | An id no server has claimed puts no frame on any wire, refused and logged in `conversationRouter`. No outcome, the posture of every conversation-routed verb. |
| `setSystemPrompt` byte bound | `void` | Over-length → exactly one `systemPromptWriteRejected` with `'prompt-too-long'`, nothing built, nothing sent, no map entry. |
| `setSystemPrompt` when `driver === null` | `void` | Inert no-op, no outcome, no map entry. |
| `buildSetSystemPrompt` | `Uint8Array` | May throw `WireEncodeError`; an 8192-byte prompt plus a fixed envelope stays far under `MAX_PLAINTEXT_BYTES`, but the sole caller catches regardless and drops the send. Emits **no** outcome on this throw — see § Security properties. |
| `setSystemPrompt` catch | `void` | Caught object dropped — it could quote the prompt. No log, no event, **no retry, ever**. |
| `narrowSystemPromptRejectReason` | `…\| undefined` | Total; never throws. `undefined` for any code outside the two published ones, mapped to `'unclassified'` at the single emit. |
| `case 'conversation-updated'` | `void` | The broadcast emit is unconditional and first. Absent or unmatched `inReplyTo` → no confirmation, broadcast still fires. |
| `case 'daemon-error'` | `void` | A match emits exactly one `systemPromptWriteRejected` and consumes the frame, as its tier siblings do. No match falls through unchanged. |
| Daemon | — | Both published refusals are non-retryable and carry a static message echoing no supplied byte. Nothing is stored on any refusal. |
| Window | — | Both events ship dormant across the four exhaustive bridges; #1250 is the first consumer. |

**The never-log rule holds on every path.** The prompt is a log argument nowhere: not in the connection
method (which logs nothing at all), not in its catch (which drops the caught object), not in the
builder, and not in the decode — which never sees the prompt on this path (neither the ack nor the
refusal carries it). Its **length** is not logged either; the over-length branch emits an event rather
than a diagnostic.

## Security properties

Ticket carries `security-sensitive`; builder self-review verdict **PASS**, one SHOULD FIX (see below),
no MUST FIX.

- **One design decision named rather than fixed**: a `buildSetSystemPrompt` throw emits **no** outcome
  — a liveness gap for #1250. Judged unreachable in practice from both directions, since the prompt is
  bounded at 8192 bytes *before* the build and the conversation id is bounded by `router.route`, which
  resolves only against the daemon's own conversation index. Adding an outcome for it would be a defence
  for a failure mode that cannot occur — the pipeline's evidence-based-fix-selection posture applied
  directly.
- **SHOULD FIX, closed by a deterministic test**: every sink on the path was walked and the prompt
  reaches none, but the over-length branch is exactly where an implementer reaches for a helpful
  diagnostic — and its two obvious fields (the prompt, its length) are both forbidden. A test asserts
  the over-length path records no diagnostic at all.
- **Cross-conversation misattribution, the sharpest hostile-daemon sub-case**: a daemon answering write
  A with a `conversation_updated` whose `id` names conversation B cannot mislead the outcome, because
  the emitted `conversationId` is the correlation map's value — the id this client put in its own
  outbound frame — never the `id` the record carries.
- **Membership-probe check, done explicitly** because a careless reading could call this the repair the
  read half's contract forbids. It is not: `conversation.not_found` is this verb's own published answer,
  identical to what `rename_conversation`/`archive_conversation`/`delete_conversation`/
  `promote_conversation`/`change_workspace` already answer — no new oracle on five existing verbs — and
  this slice never branches `conversation-not-found` back onto the read path or uses it to narrow a
  `no_session` reading.
- **A forged ack or refusal for a write never sent** matches no outstanding map entry and is dropped
  entirely. A malformed refusal payload cannot kill the tier either — the narrower is total and yields
  `'unclassified'`, which still settles the write.
- **The Inter-process/Electron surface is unchanged in kind, wider in durability.** No new IPC channel,
  no new `contextBridge` member — the command rides `COMMAND_CHANNEL`/`sendCommand`, both events ride
  the existing daemon-event channel. A compromised renderer gains the ability to write any
  conversation's system prompt by id — not new in kind (it can already `sendMessage`/
  `setSessionSettings`/`renameConversation`/`changeWorkspace` for the same ids) but **more durable**,
  since a written prompt survives the compromise and shapes every future session of that conversation.
  The mitigation is an operator-facing confirmation surface, **#1078's** to own; this slice's own
  obligation — that no path here synthesises, defaults, or rewrites a prompt value — is met.
- **No new cryptographic primitive, size gate, or retry policy.** The frame rides the established Noise
  session; `MAX_PLAINTEXT_BYTES` remains the only frame-level size gate, and the new 8192-byte bound is
  a strictly narrower client-side pre-flight check on one field, never a substitute. `Buffer.byteLength`
  measures without copying the string, leaving no transient copy of the prompt.
- **Concurrency: single-writer, no async gap.** `pendingSystemPromptWrites` is mutated only inside a
  synchronous `setSystemPrompt` or `onDriverEvent` body, no `await` between a read and a write. A
  structural property falls out of the shared map: the confirmation and refusal paths consume the
  *same* entry, so a daemon sending both an ack and an error for one write settles it exactly once —
  whichever frame arrives first wins, the second matches nothing.

**Known limitation, stated rather than hidden.** Two writes to the same conversation in flight at once
produce two outcomes, each naming that conversation, and nothing distinguishes which write each
settles. Every write gets its own envelope id and its own map entry, so no outcome is lost or
duplicated; what a consumer cannot do is pair the second outcome with the second write specifically. A
save-a-prompt UI reads the latest outcome, adequate for #1250; if a later ticket needs per-write
identity, a client-minted change id (`setSessionSettings`' `changeId` model) is the seam — rejected here
because AC3/AC4 specify conversation-level attribution and a change id would push a minting obligation
onto #1250 sight-unseen.

## Testing strategy

All vitest; no Playwright spec, since nothing in the window reaches this path in this slice.

- **`setSystemPromptEnvelope.test.ts` (new)** — real codec bytes decoded back: the envelope carries the
  exact `id`/`ts`/`type: 'set_system_prompt'`; the payload is exactly the two fields; text crosses
  verbatim; `''` crosses as `''`; `null` crosses as a **present key with a literal `null`**, not an
  absent key; an empty conversation id is sent as written.
- **`inboundMessage.test.ts`** — a `conversation_updated` frame carries `inReplyTo` when present and
  `undefined` when absent, decoded record unchanged in both; the log record is unchanged. Both published
  codes narrow to their client-owned members; a code outside the set (and a non-object/non-string-`code`
  payload) yields `undefined` rather than throwing; the narrowed value is independent of `outcome` and
  of `historyReject` on the same frame; the logged `code` stays the literal `'error'`.
- **`daemonConnection.test.ts`** — inert before `start()`; exactly one `set_system_prompt` frame
  carrying the payload handed to it, and the tri-state as three distinct frames; a correlated
  `conversation_updated` emits **both** `conversationUpdated` **and** exactly one
  `systemPromptWriteConfirmed` naming the requested conversation; an uncorrelated `conversation_updated`
  still emits the broadcast and no confirmation; a second ack reusing an already-matched id emits no
  second confirmation; a correlated `error` emits exactly one `systemPromptWriteRejected` with the
  narrowed reason, an unpublished code yields `'unclassified'`; an over-length prompt measured in
  **UTF-8 bytes** (a multi-byte string under 8192 UTF-16 units but over 8192 bytes) emits
  `'prompt-too-long'` and puts **no frame on the wire**, a prompt at exactly 8192 bytes is sent; the
  confirmation is attributed to the **requested** conversation, verified against a second, open one;
  `dial()` clears outstanding writes so a stale id cannot settle on a new connection.
- **`commands.test.ts`** — the guard accepts a well-formed `setSystemPrompt` with text, with `''`, and
  with `null`; rejects a missing payload, a missing `system_prompt` key, an explicitly-`undefined`
  `system_prompt`, a non-string non-null `system_prompt`, and a non-string `conversation_id`; checks
  type not emptiness (an empty id passes); a `@ts-expect-error` pins the payload as required.
- **`connectionRegistry.test.ts`** — the delegation stub, so `viewOf` stays complete.

**Mutation-checked and reverted** — five mutations, each confirmed to redden before being reverted:

| Mutation | Reddened |
|---|---|
| The ack arm consumes the frame on a match (the ticket's named trap) | 5 tests |
| `system_prompt: payload.system_prompt ?? ''` in the connection method's fresh literal | 1 test |
| `prompt.length` instead of `Buffer.byteLength(prompt, 'utf8')` | 1 test |
| The confirmation reads `inbound.conversationUpdated.id` instead of the map's value | 3 tests |
| The byte bound as `>=` rather than `>` (fail-closing a prompt the daemon accepts) | 1 test |

Fakes over mocks throughout: the existing `daemonConnection.test.ts` driver fake and the real codec.

## A process note worth keeping

A mutation-check loop that reverted with `git checkout --` while the implementation was still
uncommitted discarded the whole of `daemonConnection.ts`'s in-progress work in one step; it had to be
reconstructed and the checks re-run after committing. The rule that follows: commit the working
implementation before running any revert-based mutation experiment, not merely before opening a PR —
the plan-then-code commit discipline is what turned this into a reconstruction rather than a loss.

## Live proof (#1433)

The family — this write leg, [System prompt send](system-prompt-send.md)'s read leg, and #1078's Channel
info editor — shipped end to end without ever being watched working against real claude. #1078 closed
behind a green real-claude gate, but none of the tier's specs touched the prompt, so that green said
nothing about this vertical. `e2e/real-claude-system-prompt.spec.ts` is the first behavioural proof, and it
establishes two things with one marker token saved through Channel info:

- **A prompt saved before a conversation's session has a child reaches claude when that child spawns** —
  the first reply carries the marker. A freshly created conversation starts `stateEvicted` on the daemon
  and defers its child to the first message (pyrycode#2085), so a prompt saved before that message is
  composed into the spawn.
- **A prompt saved while a session is already running does not reach it** — no reply in that session ever
  carries the marker, because the marker exists only in the system prompt textarea, never in a composer
  message, so a model cannot echo an instruction it was never shown.

**What it does *not* establish, and why the spec's own title differs from the ticket's.** The ticket asked
for the positive half to run after the **New session** control action, on the reasoning that `new_session`
is the conversation's next session start and `set_system_prompt`'s own contract says a stored prompt takes
effect there. The live gate ran exactly that shape and failed: `refreshSystemPrompt`, the only code that
recomposes a session's appended system-prompt file from the stored value, has exactly one caller
(`Pool.Activate`), which returns early for a session already `stateActive`. `new_session` never reaches
it — `RestartFresh` relaunches the child from the frozen argv through the runner's own loop, and
`RotateForNewSession` only rekeys, persists and notifies. **A prompt saved during a live session cannot
currently reach the child that `New session` spawns**, contradicting the daemon's own contract. Filed
upstream as `pyrycode/pyrycode#2436`.

The shipped spec proves the family on the path the product actually has (first spawn) instead, keeps the
original `New session` shape as an executable `test.fixme` naming #2436, and pairs the two conversations
in one test so the same prompt text that produces nothing in a running session is also shown producing the
marker at a spawn — closing the gap a lone negative assertion would have left (it would go green against a
daemon with no prompt support at all). See [live-e2e-runbook.md § Current real-claude gate state](live-e2e-runbook.md)
for the gate run detail.

## Related

- [System prompt send](system-prompt-send.md) — the read half (#1230/#1231) this slice's write half
  completes; the tri-state round-trip rule, the never-log rule, and the fresh-literal rule are all
  inherited from there. Its "no error frame for this verb at all" claim is true only of the *read* verb
  — false here, and this document's own § The two things that make this slice unlike its read half is
  where that divergence is argued in full.
- [System-prompt store](system-prompt-store.md) — the renderer read half (#1231): what a conversation's
  prompt reads as today. This slice reports whether a write landed, not what the conversation now
  holds — that is the read path's job.
- [Daemon connection — correlation § System-prompt write correlation
  (#1249)](daemon-connection-correlation.md#system-prompt-write-correlation-1249) — the
  `pendingSystemPromptWrites` walk-through in full, and the ninth store in that document's chronological
  catalogue.
- [Daemon error outcome](daemon-error-outcome.md) — `systemPromptReject`'s place as a third per-verb
  narrowed sibling field on `daemon-error`, and the standing caution that a fourth correlated verb
  should prompt a rethink of the shape.
- [Request history send](request-history-send.md) — the closer analogue for a per-verb `daemon-error`
  narrower (`HistoryRejectReason`) and for the "reason must always settle the write" argument
  `SystemPromptWriteFailure.unclassified` transplants.
- [Command channel](command-channel.md) — the `setSystemPrompt` `RendererCommand` member +
  `isSetSystemPromptPayload` guard this channel's union gained.
- [Daemon-event channel](daemon-event-channel.md) — the growth-log entry for the two new
  `DaemonEvent` members; the canonical [sealed union](daemon-event-channel-sealed-union.md) reference
  is **not** updated with them (see § The two `DaemonEvent` members above) because that file sits at the
  50000-byte cap with no heading structure to split at.
- `docs/specs/architecture/1249-set-system-prompt-transport.md` — the full architecture spec: the size
  overage against the table (12 files/~1900 lines against the 5-file/800-line boundary, taken whole on
  the floor rule), the full security review (verdict PASS), and the `## Revisions` entry recording the
  three resolved Open Questions and the five mutation checks.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § *Setting a conversation's system
  prompt* — SSOT for the field tables and the two published reject codes.
