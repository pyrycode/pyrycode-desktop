# #1249 — `set_system_prompt`: send the write and correlate its ack and refusals

The **write half's transport leg**. An outbound conversation-keyed `set_system_prompt` verb carrying a
tri-state prompt, a renderer→main command member with its boundary guard, a client-side byte bound on
the operator's text, and the two correlated outcomes — a confirmation resolved off the reused
`conversation_updated` ack, and a refusal resolved off the existing `daemon-error` path — crossing to
the window as typed events. Nothing in the window sends it yet (#1250) and nothing renders it (#1078).

## Files read

- `docs/knowledge/features/system-prompt-send.md` → the read half's package overview. Three rules
  inherited wholesale and one **falsified**: the tri-state round-trip rule, the never-log rule and the
  fresh-literal rule all carry over; *"There is no error frame for this verb at all"* is true of
  `request_system_prompt` and false here, so its no-error-frame consequences (the routing lookup as the
  only refusal, the single correlation arm) do **not** transfer.
- `src/main/transport/requestSystemPromptEnvelope.ts` → `buildRequestSystemPrompt`,
  `RequestSystemPromptInput` — this feature's conventions for a pure outbound builder: explicit inputs,
  a fresh literal, main-process-only, no emptiness check.
- `src/main/transport/changeWorkspaceEnvelope.ts` → `buildChangeWorkspace`, `ChangeWorkspaceInput` —
  the closest conversation-keyed template, and the one that takes an already-built `payload` rather
  than scalars.
- `src/main/daemonConnection.ts` → `pendingSystemPromptRequests` (the correlation-map docblock this
  slice's ninth store copies), `requestSystemPrompt` (the record-after-send ordering), `changeWorkspace`
  / `renameConversation` (the fresh-literal write-method shape), the `case 'daemon-error':` correlation
  tier through `pendingHistoryRequests` (where the refusal arm joins), `case 'conversation-updated':`
  (the unconditional broadcast emit the ack must not displace), and `dial()`'s reset block.
- `src/main/transport/inboundMessage.ts` → `HistoryRejectReason` + `narrowHistoryRejectReason` (the
  template for a per-verb client-owned reject union), `DaemonErrorOutcome` + `narrowDaemonErrorOutcome`
  (the union this slice deliberately does **not** widen), the `daemon-error` and `conversation-updated`
  members of `InboundDaemonMessage`, and the `case 'error':` / `case 'conversation_updated':` arms.
- `src/shared/ipc/events.ts` → `HistoryRequestFailure` (the six-member failure union with its
  not-a-hedge argument for the catch-all member), `historyRequestFailed` (the `retryable`-is-carried
  reasoning that does **not** transfer here), `systemPromptReceived` (the read arm's provenance and
  tri-state prose), `workspaceFolderRejected` (the BARE-outcome anti-precedent the ticket names).
- `src/shared/ipc/commands.ts` → `isRequestSystemPromptPayload` / `isRequestModelListPayload` /
  `isChangeWorkspacePayload` — the structural-minimum boundary-guard idiom and the type-not-emptiness
  posture.
- `src/main/index.ts` → `case 'requestSystemPrompt':` (the one-local-read-twice routing idiom) and
  `case 'changeWorkspace':` (the payload-routed write idiom).
- `src/main/connectionRegistry.ts` → `viewOf` — the one delegate line per connection method.
- `src/shared/wire/types.ts` → `EnvelopeType`'s conversation write-verb group, `ConversationUpdatedPayload`
  (the `*string`-without-`omitempty` → `string | null` mirroring convention this slice copies for the
  prompt), `SystemPromptPayload` (the tri-state contract the write half must round-trip), `MAX_PLAINTEXT_BYTES`
  (the byte-constant siting precedent).
- `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge,questionBridge}.ts` → the
  `systemPromptReceived` dormant arms and the `assertNever` guard each ends with.
- QMD `pyrycode-docs` `knowledge/features/protocol-package-types-conversations-write-payloads.md` §
  `SetSystemPromptPayload` and `specs/architecture/2151-set-system-prompt-wire-verb.md` — the daemon
  SSOT: the `*string` field, the two error codes, and the reply record that deliberately grows no
  prompt field.

## Design source

**Figma:** N/A — transport-only. Nothing in this slice renders; the editor surface is #1078, which
carries the Figma anchor. The visual-fidelity check is intentionally skipped.

## Context

The daemon shipped the storage (pyrycode#2149), the spawn-time read (#2150), the write verb (#2151)
and the read verb (#2152). This client has the read leg (#1230 transport, #1231 store). This slice is
the write leg's transport: after it, a conversation's prompt can be set, replaced and cleared from
this app, and the caller learns whether the daemon took it.

Two things make it unlike its read half, and both are where the turns go.

**The ack is a record this client has never correlated.** `conversation_updated` today decodes with no
`inReplyTo` field at all and is emitted unconditionally as a broadcast; every existing
conversation-keyed write verb declines to correlate it. This slice is the first that must — and the
frame has a live second consumer, `conversationListBridge`, which treats every `conversationUpdated`
as a list-refresh trigger. So the correlation is **additive**: the broadcast emit stays, unconditional
and first, and the write confirmation is emitted *after* it on a match. The `daemon-error` tier's
consume-the-frame-entirely shape is the wrong template for the ack, and copying it would stop the
requester's own writes from refreshing their own conversation row.

**This verb has refusals.** They arrive on the existing `daemon-error` path correlated by
`in_reply_to`, so this slice joins that precedence tier as its fifth member, on `request_history`'s
template: a daemon `code` narrowed at the decode boundary against client-owned literals, so no daemon
string crosses IPC.

No ADR is warranted. Every piece adopts an existing pattern (the correlation map, the reject narrower,
the fresh-literal builder, the structural-minimum guard) and introduces no new architectural concept.
The one thing worth the documentation phase's attention is noted under § Rejected alternatives: the
`daemon-error` member now carries a *third* per-verb narrowed field, and a fourth correlated verb
should prompt a rethink of that shape rather than a fourth field.

### Size — over the table, stated

| Table line | Boundary | This plan |
|---|---|---|
| Production source files | ≤ 5 | **12** |
| Total written work | ≤ 800 | **~1500** |
| New exported types / components | ≤ 5 | 4 (`SetSystemPromptPayload`, `MAX_SYSTEM_PROMPT_BYTES`, `SystemPromptRejectReason`, `SystemPromptWriteFailure`) |
| Consumer call sites needing simultaneous update | ≤ 10 | 0 — purely additive; no existing signature changes |
| Acceptance criteria | ≤ 5 | 5 |
| Reject branches | ≤ 10 | 3 (`prompt-too-long`, `protocol-malformed`, `conversation-not-found`) + the catch-all |

**Depth-capped, so it ships whole.** The parent chain is #1249 → #1232 → #1078: a grandparent exists,
so no split is proposed and `needs-human:sizing` is on the ticket. The floor rule reaches the same
verdict independently, and the refiner's body makes the case in full: every available cut is a
one-consumer pair (builder→method→IPC arm→guard), set-and-clear is one nullable field rather than two
deliverables, and confirm-without-refuse would report every rejected write as still in flight. The one
seam that is not a one-consumer pair — outbound verb against inbound correlation — fails the floor from
the other side, stranding AC2's client-side refusal with nowhere to report.

## Design

### Wire types (`src/shared/wire/types.ts`)

```ts
export const MAX_SYSTEM_PROMPT_BYTES = 8192

export interface SetSystemPromptPayload {
  conversation_id: string
  system_prompt: string | null
}
```

- **`system_prompt` is `string | null`, a REQUIRED key** — the mirror of the daemon's `SystemPrompt
  *string` with **no** `omitempty`, exactly the convention `ConversationUpdatedPayload.name` already
  follows in this file. `null` clears, `''` is an explicitly-empty stored state, text is stored
  verbatim. Declared required rather than optional so the clear path must be *said*: a producer cannot
  omit the key and a consumer cannot forget it. `string | undefined` would be the wrong mirror — Go
  would emit `null`, not an absent key — and an optional property invites the `?? ''` collapse the read
  half's contract forbids.
- **`MAX_SYSTEM_PROMPT_BYTES` mirrors the daemon's `MaxSystemPromptBytes`**, sited beside
  `MAX_FRAME_BYTES` / `MAX_PLAINTEXT_BYTES`. It is a **bound on bytes of UTF-8**, not on UTF-16 code
  units, because that is what the daemon measures; the two disagree for any multi-byte prompt.
- **`'set_system_prompt'` joins `EnvelopeType`** in the conversation write-verb group beside
  `'change_workspace'`, mirroring the daemon's own placement. Its member comment records that it is
  keyed by **conversation**, not by session — the prompt must be settable with nothing running and
  outlives every session the conversation has — and that the session-keyed `set_session_settings` is a
  different verb this must not be modelled on.
- No new *inbound* payload type. The ack reuses `ConversationUpdatedPayload`, which deliberately grows
  no prompt field: the record is broadcast-shaped and only the requester asked about the value.

### Outbound builder — `src/main/transport/setSystemPromptEnvelope.ts` (new, main-only)

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
`changeWorkspace` / `renameConversation`, so a field smuggled past the structural-minimum guard is
dropped rather than sent. No length check here: the builder cannot emit an outcome, and a bound that
fails silently is the "thrown away" refusal AC2 forbids. No emptiness check on the id either — the
routing lookup one layer up is the refusal, as it is for every conversation-routed verb.

### Command + guard (`src/shared/ipc/commands.ts`)

```ts
| { type: 'setSystemPrompt'; payload: SetSystemPromptPayload }

function isSetSystemPromptPayload(value: unknown): value is SetSystemPromptPayload
```

The guard checks **three** things where its siblings check one: `conversation_id` present and a string;
`system_prompt` **present**; and `system_prompt` a `string` **or** exactly `null`. The presence check is
load-bearing — an absent key would be read as `undefined` downstream and the tri-state would have four
inhabitants, one of them meaningless. Type, not emptiness, and **not length**: the length verdict has to
produce an outcome, and a guard rejection produces none.

`src/main/index.ts` gains `case 'setSystemPrompt':`, conversation-routed off
`command.payload.conversation_id` in `changeWorkspace`'s shape. `connectionRegistry.ts`'s `viewOf`
gains one delegate line.

### Connection method + correlation (`src/main/daemonConnection.ts`)

```ts
setSystemPrompt(payload: SetSystemPromptPayload): void
```

Ordered deliberately:

1. **The byte bound runs FIRST, before the `driver === null` guard.** When `payload.system_prompt` is a
   string and `Buffer.byteLength(value, 'utf8') > MAX_SYSTEM_PROMPT_BYTES`, emit
   `systemPromptWriteRejected` with `reason: 'prompt-too-long'` and return — nothing is built, nothing
   is sent, no map entry is made. Length-first rather than connected-first because the verdict is about
   the value and is true whether or not a socket is up; a disconnected over-length write that vanished
   silently would be exactly the "thrown away" refusal AC2 names. `null` has no bytes and skips the
   check.
2. **Inert when `driver === null`**, every sibling's posture, producing no outcome.
3. **Build → advance the counter → send → record**, `requestSystemPrompt`'s ordering verbatim: one
   local for the envelope id read three times, the counter advanced only after a successful build, and
   `pendingSystemPromptWrites.set(envelopeId, payload.conversation_id)` only **after** a successful
   send, so a build or send that throws leaves no entry under an id the next request re-mints.
4. **`catch` drops the caught object** — it could quote the prompt. No log, no event, no retry.

`pendingSystemPromptWrites: Map<number, string>` — envelope id → the conversation id this client
named — is the ninth correlation store, sited beside `pendingSystemPromptRequests` and **cleared in
`dial()`** beside its siblings: a fresh connection recycles envelope ids from 2, so a surviving entry
would settle a new connection's write against a dead one's conversation. A `Map`, not a bare object,
for the reason its siblings state (the key is client-minted, and the shape must stay hostile-key-proof
if it is ever widened). No cap, on `pendingHistoryRequests`' evidence-based argument: an entry costs a
number and a string, every settle deletes one, every dial clears all, and the only way to accumulate
is this client sending writes a daemon never answers.

### Inbound decode (`src/main/transport/inboundMessage.ts`)

Three additive changes; **no new payload parser**.

- **`conversation-updated` gains `inReplyTo?: number`**, propagated from the already-decoded
  `envelope.in_reply_to` in `case 'conversation_updated':`. Optional, on `history-page`'s and
  `session-settings`' posture: a record without a handle is merely uncorrelatable, not malformed, and
  it is the ordinary case — the daemon also pushes this record unsolicited (pyrycode#2156's host-side
  `pyry channel new`). The existing member comment claiming the record is never correlated is corrected
  in the same edit; the daemon replies to the requester with `in_reply_to` on all six write verbs.
- **`SystemPromptRejectReason = 'protocol-malformed' | 'conversation-not-found'`** and
  **`narrowSystemPromptRejectReason(payload): SystemPromptRejectReason | undefined`** —
  `narrowHistoryRejectReason`'s twin exactly: `isRecord`, a `string` check, then a `switch` whose
  untrusted `code` is a **comparand against client-owned literals and is then dropped**, never an index,
  a join or a resolve. Total by construction: it never throws, for the reason its two neighbours state —
  an error frame is terminal because it *arrived*, and a throw here would hand a hostile daemon a
  one-frame kill switch over every `daemon-error` consumer.
- **`daemon-error` gains `systemPromptReject?: SystemPromptRejectReason`**, set in `case 'error':`
  beside `historyReject` off the same untrusted `code`. Optional for `historyReject`'s reason: absence
  has exactly one meaning — "outside this verb's published set" — read at exactly one emit, which maps
  it to the catch-all.

The `case 'error':` log record is untouched: the logged `code` stays the client-owned literal
`'error'`, never `envelope.payload.code`.

### The two `DaemonEvent` members (`src/shared/ipc/events.ts`)

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
  map's value — the id this client put in its own outbound frame — never the `id` the daemon echoes
  back on the ack record, which a hostile or confused daemon controls. Carrying it is what keeps these
  off the `workspaceFolderRejected` anti-precedent the ticket names: a BARE outcome would satisfy
  "exactly one confirmation outcome" while leaving the sibling unable to settle the write that caused
  it. The numeric `in_reply_to` the match was made on is deliberately not carried.
- **The confirmation carries nothing else, deliberately.** The ack does not carry the prompt and must
  not be made to look as though it does; what a conversation now holds is the read path's answer
  (#1230/#1231), not this one's. Telling the operator that a saved prompt does not touch the running
  session is #1078's job.
- **`prompt-too-long` is a distinct member from `protocol-malformed`**, though the daemon merges them
  under one code. The client-side refusal is a different fact: nothing reached the wire, and the repair
  is specifically "shorten the prompt", where the daemon's `protocol.malformed` also covers a payload
  that would not decode. Folding them would claim the daemon said something it never did.
- **`unclassified` is not a hedge**, `HistoryRequestFailure`'s argument transplanted: a correlated
  refusal must always settle the write, or #1250 reports a rejected write as permanently in flight. A
  code outside the two published ones lands here rather than being dropped.
- **No `retryable` flag.** Both published conditions are non-retryable and so is the client-side one, so
  a carried flag would be a constant. `historyRequestFailed` carries one because its set has exactly one
  retryable member; that reasoning does not transfer.
- Each of the four exhaustive bridges gains **two** dormant no-op arms — eight in all. Not bookkeeping:
  each bridge's `assertNever` stringifies the whole event into an `Error` message, and while neither of
  these events carries prompt text, `conversationId` is a routing key that reaches no other sink. The
  arms are what keep the union's exhaustiveness compile-forced as it grows.

### Rejected alternatives

- **Widening `DaemonErrorOutcome` with the two codes instead of a third narrowed field.** It would
  avoid a per-verb field, but that union is the "what class of failure is this" answer over *every*
  frame, mirrored member-for-member by `AttachmentUploadFailure`; two new members would ripple into
  consumers that have nothing to do with this verb. Rejected for blast radius. The honest cost is
  recorded instead: `daemon-error` now carries three per-verb narrowed fields, and a **fourth**
  correlated verb should prompt a rethink of the shape rather than a fourth field.
- **A client-minted `changeId` per write, on `setSessionSettings`' model.** It would tell two
  concurrent writes to the same conversation apart. AC3/AC4 specify conversation-level attribution, and
  a change id would push a minting obligation onto #1250 sight-unseen. Rejected; the limitation is
  stated below.
- **An optimistic local value on send.** Explicitly forbidden by the ticket: a saved prompt does not
  affect the running session, and this slice must not paper over that.

## State + concurrency model

No store, no async task, no subscription — this slice is main-process only. The one piece of mutable
state is `pendingSystemPromptWrites`, single-writer by the same argument as its eight siblings: every
mutation runs to completion inside a synchronous `setSystemPrompt` or `onDriverEvent` body, with no
`await` between a read and a write. Its whole lifecycle is set-after-send → delete-on-settle →
clear-on-`dial()`.

**Known limitation, stated rather than hidden.** Two writes to the same conversation in flight at once
produce two outcomes, each naming that conversation, and nothing distinguishes which write each
settles. Every write gets its own envelope id and its own entry, so no outcome is lost or duplicated;
what a consumer cannot do is pair the second outcome with the second write specifically. A
save-a-prompt UI reads the latest outcome, so this is adequate for #1250; if a later ticket needs
per-write identity, a client-minted change id is the seam.

## Error handling

| Layer | Result | Failure behaviour |
|---|---|---|
| `isSetSystemPromptPayload` | `boolean` | A missing/mistyped `conversation_id`, or a `system_prompt` that is absent, `undefined`, or neither string nor `null`, is rejected at the untrusted→trusted boundary. No outcome — a malformed command is a renderer bug, not an operator-visible refusal. |
| `router.route(conversation_id)` | connection \| `null` | An id no server has claimed puts no frame on any wire, having already refused and logged in `conversationRouter`. No outcome, the posture of every conversation-routed verb. |
| `setSystemPrompt` byte bound | `void` | Over-length → exactly one `systemPromptWriteRejected` with `'prompt-too-long'`, nothing built, nothing sent, no map entry. |
| `setSystemPrompt` when `driver === null` | `void` | Inert no-op, no outcome, no map entry. |
| `buildSetSystemPrompt` | `Uint8Array` | May throw `WireEncodeError`; an 8192-byte prompt plus a fixed envelope stays far under `MAX_PLAINTEXT_BYTES`, but the sole caller catches regardless and drops the send. |
| `setSystemPrompt` catch | `void` | Caught object dropped — it could quote the prompt. No log, no event, **no retry, ever**. |
| `narrowSystemPromptRejectReason` | `…\| undefined` | Total; never throws. `undefined` for any code outside the two published ones, mapped to `'unclassified'` at the single emit. |
| `case 'conversation-updated'` | `void` | The broadcast emit is unconditional and first. Absent or unmatched `inReplyTo` → no confirmation, and the broadcast still fires. |
| `case 'daemon-error'` | `void` | A match emits exactly one `systemPromptWriteRejected` and consumes the frame, as its four tier siblings do. No match falls through unchanged. |
| Daemon | — | Both published refusals are non-retryable and carry a static message echoing no supplied byte. Nothing is stored on any refusal. |
| Window | — | Both events ship dormant across the four exhaustive bridges; #1250 is the first consumer. |

**The never-log rule holds on every path.** The prompt is a log argument nowhere: not in the connection
method (which logs nothing at all), not in its catch (which drops the caught object), not in the
builder, and not in the decode — which never sees the prompt, since the outbound payload is not decoded
here and neither the ack nor the refusal carries it back. Its **length** is not logged either, and the
over-length branch emits an event rather than a diagnostic.

## Testing strategy

All vitest; no Playwright spec, since nothing in the window reaches this path in this slice.

- **`setSystemPromptEnvelope.test.ts` (new)** — real codec bytes decoded back: the envelope carries the
  exact `id` / `ts` / `type: 'set_system_prompt'`; the payload is exactly the two fields; text crosses
  verbatim; `''` crosses as `''`; `null` crosses as a **present key with a literal `null`**, not an
  absent key; an empty conversation id is sent as written.
- **`inboundMessage.test.ts`** — a `conversation_updated` frame carries `inReplyTo` when present and
  `undefined` when absent, with the decoded record unchanged in both; the log record is unchanged. The
  two published codes narrow to their client-owned members; a code outside the set (and a non-object /
  non-string-`code` payload) yields `undefined` rather than throwing; the narrowed value is independent
  of `outcome` and of `historyReject` on the same frame; the logged `code` stays the literal `'error'`.
- **`daemonConnection.test.ts`** — inert before `start()`; exactly one `set_system_prompt` frame
  carrying the payload handed to it, and the tri-state as three distinct frames; a correlated
  `conversation_updated` emits **both** `conversationUpdated` **and** exactly one
  `systemPromptWriteConfirmed` naming the requested conversation — the non-vacuity guard for the
  ticket's stated trap; an uncorrelated `conversation_updated` still emits the broadcast and no
  confirmation; a second ack reusing an already-matched id emits no second confirmation; a correlated
  `error` emits exactly one `systemPromptWriteRejected` with the narrowed reason, and an unpublished
  code yields `'unclassified'`; an over-length prompt measured **in UTF-8 bytes** (a multi-byte string
  under 8192 UTF-16 units but over 8192 bytes) emits `'prompt-too-long'` and puts **no frame on the
  wire**, while a prompt at exactly 8192 bytes is sent; the confirmation is attributed to the
  **requested** conversation, verified against a second, open one; `dial()` clears outstanding writes so
  a stale id cannot settle on a new connection.
- **`commands.test.ts`** — the guard accepts a well-formed `setSystemPrompt` with text, with `''`, and
  with `null`; rejects a missing payload, a missing `system_prompt` key, an explicitly-`undefined`
  `system_prompt`, a non-string non-null `system_prompt`, and a non-string `conversation_id`; checks
  type not emptiness (an empty id passes); a `@ts-expect-error` pins the payload as required.
- **`connectionRegistry.test.ts`** — the delegation stub, so `viewOf` stays complete.

Fakes over mocks throughout: the existing `daemonConnection.test.ts` driver fake and the real codec.

**Planned mutation checks** (recorded in `## Revisions` after they run): deleting the unconditional
`conversationUpdated` emit from the correlated path must redden a test; collapsing `system_prompt` with
`?? ''` in the connection method's fresh literal must redden a test; measuring the bound with `.length`
instead of `Buffer.byteLength` must redden a test.

## Open questions

1. **Does the client-side over-length refusal deserve its own reason member, or should it reuse
   `protocol-malformed`?** Resolved in this plan: its own member, because nothing reached the wire and
   the operator's repair is specific. Confirm nothing in #1250's body contradicts it.
2. **Should the ack correlation live before or after the broadcast emit?** Resolved: after, and the
   broadcast is unconditional, so the ordering cannot regress into the consume-the-frame shape.
3. **Does `conversationListBridge` need any change for the newly-correlated ack?** Expected no — the
   broadcast emit is byte-identical to today's. Verify during implementation and record here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No exploitable finding. Two boundaries, both single named functions. Inbound:
  `narrowSystemPromptRejectReason` is the only place a daemon `code` becomes a typed value on this path,
  and the untrusted string is a **comparand that is then dropped** — never an index, a join, a resolve or
  a retained field. Outbound: `isSetSystemPromptPayload` is the renderer→main guard, and the connection
  method's fresh two-field literal is the wire bound behind it, so a field smuggled past the
  structural-minimum guard is dropped rather than sent. The guard's `'key' in value` idiom walks the
  prototype chain, which is neutralised the way it is for every sibling: structured clone strips the
  prototype, so an IPC-delivered object is plain. One design decision worth naming rather than fixing:
  a `buildSetSystemPrompt` throw emits **no** outcome, a liveness gap for #1250 — it is unreachable in
  practice from both directions, since the prompt is bounded at 8192 bytes *before* the build and the
  conversation id is bounded by `router.route`, which resolves only against the daemon's own conversation
  index. Adding an outcome for it would be a defence for a failure mode that cannot occur.
- **[Tokens, secrets, credentials]** No finding — nothing here mints, stores, reads or transports a
  credential. `conversation_id` is a routing id; naming a conversation is not authorization, which is
  pairing, enforced structurally at the Noise IK handshake. The prompt is **not** a credential but is
  treated with credential-grade sink discipline anyway, because an operator may put anything in it: it
  is a value on its way to the wire and nothing else.
- **[File / storage operations]** No finding — this slice performs no filesystem operation. Neither the
  prompt nor the conversation id is joined into a path, filename, temp file or cache key on any branch,
  the refusal branches included. Nothing is persisted, so there is no at-rest, atomicity or TOCTOU
  surface.
- **[Inter-process / Electron attack surface]** OUT OF SCOPE, named. No new IPC channel and no new
  `contextBridge` member: the command rides the existing `COMMAND_CHANNEL` through the generic
  `sendCommand`, and both events ride the existing daemon-event channel. No window configuration
  changes. The one new attack-surface line is the `isRendererCommand` case, landing in the same commit
  as the `RendererCommand` member it guards — the lockstep rule, since a member added without its case
  is *silently dropped* at the boundary rather than failing loudly. The honest characterisation of the
  new capability: a compromised renderer gains the ability to write any conversation's system prompt by
  id. That is not a new capability in kind — it can already `sendMessage`, `setSessionSettings`,
  `renameConversation` and `changeWorkspace` for the same ids — but it is **more durable** than its
  neighbours, since a written prompt survives the compromise and shapes every future session of that
  conversation. The mitigation is an operator-facing confirmation surface, which is **#1078's** to own;
  this slice's obligation is narrower and is met: no path here synthesises, defaults or rewrites a
  prompt value, so the bytes on the wire are exactly the bytes the caller supplied or nothing at all.
- **[Cryptographic primitives]** No finding — no new primitive, RNG, key, nonce or secret comparison.
  The frame rides the established Noise session; the variant constant is untouched. The reject
  narrower's `switch` compares untrusted text against client-owned literals, which is not a secret
  comparison, so `timingSafeEqual` is not applicable.
- **[Network & I/O]** No finding — no new socket, no new timeout, no new reconnect path, and **no retry
  on any branch**, so neither refusal can spin against a relay that is merely withholding a frame.
  `MAX_PLAINTEXT_BYTES` remains the only frame-level size gate; the new 8192-byte bound is a strictly
  narrower client-side pre-flight check on one field and never a substitute for it. `Buffer.byteLength`
  measures without copying the string, so the check leaves no transient copy of the prompt.
- **[Error messages, logs, telemetry]** SHOULD FIX, with a deterministic guard. Every sink on the path
  was walked and the prompt reaches none: the connection method logs nothing, its `catch` drops the
  caught object (a `WireEncodeError` message could otherwise quote the payload), the builder logs
  nothing, the decode arms emit the existing content-free record whose `code` stays a client-owned
  literal, and `emitDaemonEvent` is log-free by construction. Neither new event carries prompt text.
  The residual risk is the **over-length branch**, which is exactly where an implementer reaches for a
  helpful diagnostic — and its two obvious fields, the prompt and its length, are both forbidden by AC5.
  Phase B closes it with a test asserting the over-length path records no diagnostic at all. The other
  remaining sink is the four bridges' `assertNever`, which stringifies the whole event into an `Error`
  message; that is why both members take explicit arms in all four bridges rather than relying on a
  `default`.
- **[Concurrency]** No finding — no async task, timer, listener or long-lived job is created, so there is
  no cancellation or teardown surface to thread an `AbortSignal` through. `pendingSystemPromptWrites` is
  single-writer on its eight siblings' argument: every mutation runs to completion inside a synchronous
  `setSystemPrompt` or `onDriverEvent` body with no `await` between a read and a write, so there is no
  check-then-act gap. One property falls out of the shared map and is worth stating because it makes an
  acceptance criterion **structural rather than promised**: the confirmation and refusal paths consume
  the *same* entry, so a daemon sending both an ack and an error for one write settles it exactly once —
  whichever frame arrives first wins and the second matches nothing. `dial()` clears the map, so no
  entry survives a reconnect into an id-recycling window.
- **[Threat model — malicious relay]** Addressed. It is on-path and content-blind; it can withhold or
  delay the ack, which costs a write reported as never settling, never a forged confirmation — a
  confirmation requires a frame inside the Noise session correlated to an envelope id this client
  minted.
- **[Threat model — hostile daemon inside the session]** The primary threat here, addressed. A forged ack
  or refusal for a write this client never sent matches no outstanding entry and is dropped entirely. A
  forged ack for a real write confirms something the daemon could equally have achieved by simply not
  storing the value, so there is no privilege gain. The sharper sub-case is **cross-conversation
  misattribution**: a daemon answering write A with a `conversation_updated` whose `id` names
  conversation B. It cannot mislead the outcome, because the emitted `conversationId` is the correlation
  map's value — the id this client put in its own outbound frame — and never the `id` the record
  carries. A malformed refusal payload cannot kill the tier either: the narrower is total by
  construction and yields `'unclassified'`, which still settles the write. An oversized frame dies at
  `MAX_PLAINTEXT_BYTES` before any narrower runs.
- **[Threat model — membership probe]** Examined specifically, because the read half's contract states
  that its `no_session` merge must never be repaired apart, and a careless reading would call this slice
  the repair. It is not. This verb's `conversation.not_found` is the daemon's own published answer for
  this verb, identical to what `rename_conversation`, `archive_conversation`, `delete_conversation`,
  `promote_conversation` and `change_workspace` already answer, so no oracle is created that did not
  already exist on five verbs; this client only ever writes ids drawn from its own conversation list,
  since `router.route` resolves against an index built from the daemon's own lists; and nothing here
  branches `conversation-not-found` back onto the read path or uses it to narrow a `no_session` reading.
  The two verbs' asymmetry is the daemon's design, and this slice inherits it without widening it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07
