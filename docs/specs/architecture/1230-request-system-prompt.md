# #1230 — Ask the daemon for a conversation's system prompt and route the correlated reply

The background-process half of the read: the outbound ask, the correlation bookkeeping, the
fail-closed decode, and the typed event crossing IPC. It lands with **no renderer consumer** — the
store and the fire-on-open wiring are #1231, the editor surface is #1078.

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/main/transport/requestModelListEnvelope.ts` → `buildRequestModelList` / `RequestModelListInput` | The builder to copy: required conversation id, fresh one-field literal, no `?? ''`, no emptiness check. |
| `src/main/transport/requestSessionSettingsEnvelope.ts` → `buildRequestSessionSettings` | The other precedent, and the one that diverges — its optional id and `?? ''` are what this verb must **not** copy. |
| `src/main/daemonConnection.ts` → `pendingConfigRequests`, `requestSessionSettings`, the `session-settings` arm of `onDriverEvent` | The #1176 correlation mechanism, verbatim: record after a successful send, match on `Envelope.in_reply_to`, delete, emit with the client-owned id. |
| `src/main/daemonConnection.ts` → `pendingHistoryRequests`, `requestHistory`, the `history-page` arm | The second application of the same mechanism (#1222), which is what makes it a pattern rather than a one-off. Its map header carries the unbounded-growth argument this ticket inherits. |
| `src/main/daemonConnection.ts` → `requestModelList` | The send twin with a **required** scalar id and no correlation map — the exact shape this verb needs, plus its no-retry catch. |
| `src/main/transport/inboundMessage.ts` → `optionalString` | The tri-state narrower already in the tree: key absent → `undefined`, `''` → `''`, text → text, `null`/non-string → throw. Exactly AC2. |
| `src/main/transport/inboundMessage.ts` → `parseSessionSettingsPayload`, the `session_settings` dispatch arm | Narrow-before-log discipline and the content-free `inbound-decoded` record. |
| `src/main/transport/inboundMessage.ts` → `narrowDaemonErrorOutcome`, `HistoryRejectReason` | The comparand idiom for narrowing an untrusted string against client-owned literals. |
| `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` | Where the new `system-prompt` member goes, and the `inReplyTo?: number` convention its `history-page`/`session-settings` neighbours set. |
| `src/shared/wire/types.ts` → `EnvelopeType`, `RequestModelListPayload`, `ModelListPayload` | Where the two new members and the two new payload types go, and the docblock register they are written in. |
| `src/shared/ipc/events.ts` → the `runConfigReceived` and `historyPageReceived` arms | The client-owned-`conversationId` provenance paragraph both arms carry, which this arm must carry too. |
| `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `isRequestModelListPayload` | The command member, the lockstep `isRendererCommand` case, and the type-not-emptiness boundary guard. |
| `src/main/index.ts` → the `requestModelList` case of the `onCommand` switch | `router.route(id)?.…` — the routing lookup **is** the refusal (AC1). One local, read twice. |
| `src/main/connectionRegistry.ts` → `viewOf` | Every `DaemonConnection` member is delegated once here; a new method is a compile error until it is. |
| `src/renderer/src/store/questionBridge.ts` → `assertNever` | The exhaustiveness guard **stringifies the whole event into an `Error` message**. This is why the four bridge arms are an AC4 requirement, not just a compile fix. |
| `docs/knowledge/features/model-list-wire-types.md` | The declare → decode → carry-across-IPC → store → render sequencing this ticket's slice sits inside. |
| pyrycode `docs/knowledge/features/protocol-package-types-system-prompt-payloads.md` | Daemon SSOT for the pair: `SystemPrompt *string` + `omitempty`, `SessionPromptStatus` never `""`, the two fields independent. |
| pyrycode `docs/knowledge/features/v2-session-manager-state-machine-inbound-request-system-prompt-systempromptfor-seam.md` | The collapse table, the no-error-frame posture, and the log-discipline lesson AC4 restates: check the rule against what a **shared helper's wrapped error can quote**, not only the attributes a new log line names. |

## Design source

**Figma:** N/A — no UI in this slice. Nothing renders; the ticket ends at a typed event crossing IPC
with no consumer. The editor surface is #1078 and carries its own Figma anchor.

## Context

The daemon shipped the whole system-prompt cluster (pyrycode #2149–#2152); this client speaks none of
it. Before an operator can see or edit a conversation's system prompt, the background process has to
be able to ask for it and to attribute the answer.

The answer carries **no `conversation_id`**. Correlation rides `in_reply_to` alone, exactly as
`session_settings` does — a deliberate shape upstream, since it is what lets an unhosted
conversation's reply be byte-identical to a hosted-but-quiet one. So the routing key a decoded reply
needs does not exist until the request side records it, which is why the ask and the decode are one
ticket.

No ADR is warranted: this adds a frame family to an existing, twice-applied correlation mechanism
(#1176, #1222) and takes no new architectural position. ADR 0002 (wire types mirror mobile) already
governs the payload shapes.

### Size — over the table on two lines, stated

| Limit | Boundary | This ticket |
|---|---|---|
| Production source files | ≤ 5 | **12** |
| Total written work | ≤ 800 | **~1200** |
| New exported types | ≤ 5 | 4 |
| Consumer call sites needing simultaneous update | ≤ 10 | 6 |
| Acceptance criteria | ≤ 5 | 5 |
| Reject branches in a state machine | ≤ 10 | 0 |

The refiner stated 8 production files. The real count is **12**: it missed
`src/main/connectionRegistry.ts` (every `DaemonConnection` member is delegated once in `viewOf`) and
the four exhaustive renderer bridges (`daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts`,
`questionBridge.ts`), each of which needs a no-op case or its `assertNever` guard fails the build. It
also over-counted `src/preload/index.ts`, which forwards `RendererCommand` generically through
`sendCommand` and needs no edit.

**Built whole anyway, because the floor wins over the ceiling.** The one seam available is
request-side-first / decode-second, and the request half's only deliverable — an outbound ask whose
reply is dropped on the floor — is consumed by exactly one sibling in the same family. That is the
case the sizing guide's floor rule names, and the floor beats the ceiling when the two disagree.
Splitting also would not buy the file line back: the inbound half alone touches 8 production files,
four of them the bridges, so **neither child would come in under 5 either**. The line count is the
only boundary a split would satisfy, at the cost of a refiner pass plus an extra builder run.

Split depth checked: parent #1078, no grandparent — a split would have been permitted, and is
declined on the floor rule rather than on the depth cap.

## Design

### Wire vocabulary — `src/shared/wire/types.ts`

Two `EnvelopeType` members, in the docblock register the file uses, each stating the divergence a
reader would otherwise pattern-match wrong:

- `'request_system_prompt'` — client → daemon, v2 control frame, gated on the negotiated
  `interactive` capability and **inert** on a conn that did not negotiate it (no reply, no error).
- `'system_prompt'` — daemon → client, unicast to the conn that asked, correlated by `in_reply_to`,
  carrying no `event_id` and no `conversation_id`.

```ts
export type SessionPromptStatus = 'matches' | 'differs' | 'no_session'
export interface RequestSystemPromptPayload { conversation_id: string }
export interface SystemPromptPayload {
  system_prompt?: string          // ABSENT ≠ '' — three stored states, never collapsed
  session_prompt_status: SessionPromptStatus
}
```

`system_prompt` is optional **on the wire and in the type**, mirroring the daemon's
`*string` + `omitempty`: `nil` omits the key, a pointer to `""` emits `"system_prompt": ""`. The two
fields are independent — text with `no_session` is "configured, applies at next session start", an
absent key with `matches` is "holds nothing, session spawned with nothing" (the daemon compares the
*collapsed* stored value). Neither is derived from the other anywhere in this slice.

`SessionPromptStatus` is a **closed** client-side union, which diverges from `permission_mode`'s
deliberate no-allowlist posture. The divergence is upstream's: `permission_mode`'s read half carries a
mode its write half refuses, so narrowing there would fail-close valid traffic, whereas the daemon
publishes exactly three status constants, never `""`, and sets one on every path including the
unresolvable ones. AC2 requires the fourth value be rejected rather than folded into one of the three.

### Outbound — `src/main/transport/requestSystemPromptEnvelope.ts` (new)

```ts
export interface RequestSystemPromptInput { id: number; ts: string; conversationId: string }
export function buildRequestSystemPrompt(input: RequestSystemPromptInput): Uint8Array
```

`buildRequestModelList`'s shape exactly: a fresh one-field literal naming `conversation_id` (never a
spread), no `?? ''` normalisation, and **no emptiness check**. Main-process only; imports `codec`.

The header records why the emptiness question matters *more* here than on the model-list twin: that
verb's unresolvable id draws a visible `error` frame, while this one has no error path at all, so an
empty id reaching the wire would draw an ordinary-looking `no_session` reply with an absent prompt and
the correlation map would file that false "no prompt, no session" reading against a real conversation.
The refusal that keeps it off the wire is the routing lookup at the IPC arm, not a check here.

### Correlation and send — `src/main/daemonConnection.ts`

- `pendingSystemPromptRequests: Map<number, string>` — envelope id → the conversation the request
  named. `pendingConfigRequests`' rationale verbatim: a `Map` because the key is client-**minted**
  (`nextEnvelopeId`), so no prototype setter is reachable under any inbound frame; cleared on `dial()`.
- `requestSystemPrompt(conversationId: string): void` on the `DaemonConnection` interface and in the
  returned object — `requestSessionSettings`' body with a required scalar id: `driver === null` inert
  guard, **one local** for the envelope id read three times, advance the counter only on a successful
  build, `pendingSystemPromptRequests.set(envelopeId, conversationId)` **after** the send so a throw
  leaves no entry under an id the next request re-mints, and a catch that drops its caught object with
  no log, no event, **no retry**.
- One delegation line in `connectionRegistry.ts`'s `viewOf`.

### Inbound decode — `src/main/transport/inboundMessage.ts`

- `parseSystemPromptPayload(payload: unknown): SystemPromptPayload` — `isRecord` gate, then
  `optionalString(payload, 'system_prompt')` for the tri-state, then a `requireString` +
  comparand-against-client-owned-literals narrow for `session_prompt_status`. Fail-closed; the throw
  message names the **field constant only**, never the value.
- A new `InboundDaemonMessage` member
  `{ kind: 'system-prompt'; systemPrompt: SystemPromptPayload; inReplyTo?: number }` — `inReplyTo`
  optional, for `history-page`'s stated reason: a reply without a correlation handle is
  *uncorrelatable*, not malformed, and the fail-closed drop belongs one layer up.
- A `case 'system_prompt'` dispatch arm: narrow **before** logging, then the existing content-free
  `inbound-decoded` record (`code` a client-owned literal, `bytes`, `hash`) — no new
  `DiagnosticEvent` field, no decoded value.

### Inbound routing — the `system-prompt` arm of `onDriverEvent`

The `session-settings` arm's four lines, unchanged in shape: `inReplyTo === undefined` → return;
map miss → return; delete; emit. Both drops are **silent** — the only values a diagnostic could carry
are the conversation id and the wire routing id. The drop is total rather than "emit without the id",
for the reason both precedents give: a reply this client cannot attribute is exactly the input a
consumer must not accept.

### IPC event — `src/shared/ipc/events.ts`

```ts
| { type: 'systemPromptReceived'
    conversationId: string          // CLIENT-OWNED — the map's value, never off the wire
    systemPrompt: string | undefined // absent ≠ '' — preserved across structured clone
    sessionPromptStatus: SessionPromptStatus }
```

A fresh literal at the emit, never a spread of the decoded payload. `conversationId` carries the
`runConfigReceived` provenance paragraph — it is the one id on this union the daemon did not assert,
and the numeric `in_reply_to` it was resolved from is deliberately **not** carried. `systemPrompt` is
declared as a required key of type `string | undefined` rather than an optional property, so a
consumer cannot forget it; `undefined` is a structured-clone-supported value, so absent-vs-empty
survives the bridge intact.

### The four bridge arms

`daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts`, `questionBridge.ts` each get a no-op
`case 'systemPromptReceived':` beside their `historyPageReceived` neighbours, marked **dormant**
(#1231 subscribes with its own bridge, in the `historyPageBridge` / `announcedModelBridge` posture).
This is an AC4 requirement, not bookkeeping: their `assertNever` guard interpolates
`JSON.stringify(event)` into an `Error` message, so a missing arm would put the operator's prompt text
on the frame there.

## State + concurrency model

No store, no async task, no subscription — the slice is synchronous request/response inside the
existing driver event loop.

`pendingSystemPromptRequests` is **single-writer**: every mutation runs to completion inside a
synchronous `requestSystemPrompt` / `onDriverEvent` body with no `await` between a read and a write,
the invariant `nextEnvelopeId`, `outstandingAnswers`, `pendingSettings`, `pendingConfigRequests` and
`pendingHistoryRequests` all already rely on. It shares the one monotonic `nextEnvelopeId`, so ids
stay unique across interleaved calls.

Teardown is `dial()`'s existing clear, beside its siblings. Unbounded growth is
`pendingHistoryRequests`' argument unchanged: an entry costs one number and one string, every match
deletes one, every dial clears all, so the only way to accumulate is for **this client** to send asks
a daemon never answers — a rate this client controls.

Ordering: the daemon acquires its registry and pool locks separately, so a reply may describe a status
one rotation stale. Correctable by repeating the request; nothing in this slice branches on it.

## Error handling

There is no error frame for this verb — the daemon mints no code and has no failure branch — so
**nothing here retries and nothing blocks on the reply**, the rule `modelListStore`'s header states.
A non-negotiated conn is answered with nothing at all, which is one more reason.

| Failure | Where | Behaviour |
|---|---|---|
| Not connected | `requestSystemPrompt` | Inert no-op (`driver === null`), no id consumed. |
| Id no server has claimed | `main/index.ts` `router.route(id)?.…` | **No frame on any wire.** Already refused and logged by `conversationRouter`. |
| Build or send throws | `requestSystemPrompt` catch | Caught object **dropped** — no log, no event, no map entry, no retry. |
| Malformed payload / off-contract status / explicit `null` prompt | `parseSystemPromptPayload` | `WireDecodeError`, category-only message; the frame is dropped whole by the existing catch in `onDriverEvent`, which drops the caught error. |
| Reply with absent `in_reply_to` | the `system-prompt` arm | Dropped silently, before the map lookup. |
| Reply matching no outstanding request | the `system-prompt` arm | Dropped silently — never attributed to whichever conversation is open, never a partial event. |
| Renderer sends a malformed command payload | `isRequestSystemPromptPayload` | Refused at the boundary. Checks **type, not emptiness**. |

## Testing strategy

All vitest, node environment. No Playwright spec: nothing renders and nothing is clickable in this
slice.

- **`requestSystemPromptEnvelope.test.ts` (new)** — round-trips through the real codec: the envelope
  carries the exact id, ts and `type`; the payload is exactly `{ conversation_id }`; `''` reaches the
  wire as written (no emptiness policy in the builder); a caller-smuggled extra field does not.
- **`inboundMessage.test.ts`** — the tri-state, asserted as three distinct outcomes: key absent →
  `system_prompt` property absent/`undefined`; `''` → `''`; text → that text verbatim. Rejects:
  explicit `system_prompt: null`, a non-string prompt, a `session_prompt_status` outside the three,
  a missing `session_prompt_status`, a non-record payload. Plus: `inReplyTo` propagates from the
  envelope; the `inbound-decoded` record names a client-owned `code` and carries **no** decoded value;
  a malformed frame leaves **no** diagnostic record at all (narrow-before-log).
- **`daemonConnection.test.ts`** — one `request_system_prompt` frame carrying the id it was handed;
  inert when not connected; a `system_prompt` reply correlated by `in_reply_to` emits
  `systemPromptReceived` with the **requested** conversation id, not one from the payload; a reply
  with no `in_reply_to` emits nothing; a reply matching no outstanding request emits nothing; a
  second reply under an already-matched id emits nothing (the entry was deleted); the three prompt
  states cross IPC distinct.
- **`commands.test.ts`** — `isRendererCommand` accepts a well-formed `requestSystemPrompt`, accepts
  `conversation_id: ''` (type, not emptiness), rejects a missing payload, an explicitly-`undefined`
  payload, a `null` id and a non-string id.
- **`connectionRegistry.test.ts`** — the delegation stub, so `viewOf` stays complete.
- **Never-log witness** — a decode-failure test asserting the prompt text appears in no
  `diagnosticLog` record **and** in no thrown error's message, exercised with a prompt string unique
  enough to grep for. This is AC4's "checked against what a caught or wrapped error can quote"
  discipline, and the daemon side's own overview names its absence there as a known gap worth porting.

Fakes over mocks throughout: the existing `daemonConnection.test.ts` driver fake and the real codec.

## Open questions

1. **Does `systemPrompt: string | undefined` or `systemPrompt?: string` read better on the IPC arm?**
   Resolved in Design: the required-key form, because a consumer cannot forget it and `undefined`
   survives structured clone as a value. Revisit only if a bridge cannot narrow it.
2. **Does any existing test enumerate every `DaemonEvent` arm** (an events.test.ts inventory) beyond
   the four bridge switches? Checked during implementation; a fifth site is a one-line addition, not a
   design change.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings — two explicit boundaries, one per direction, each a single named
  function.** Inbound: `parseSystemPromptPayload` is the only place `system_prompt` bytes become a
  typed value, and it fails closed. Past it, the payload is consumed once, at the emit, as a fresh
  literal — nothing off the `JSON.parse` result survives into the event, so the decoder cannot smuggle
  a grown field across. Outbound: `isRequestSystemPromptPayload` is the renderer→main guard and
  `buildRequestSystemPrompt`'s fresh literal is the wire bound behind it, so a field smuggled past the
  structural-minimum guard is dropped rather than sent. The renderer stays untrusted relative to main
  in both directions.

- **[Trust boundaries] SHOULD FIX — the emitted `conversationId` must come from the map, and the
  reviewer's own eye is the only thing enforcing it.** Writing
  `conversationId: inbound.systemPrompt.conversation_id` is impossible (the payload has no such
  field), but writing the *open* conversation's id, or making the arm emit without the id, both
  typecheck. The test asserting a reply is attributed to the **requested** conversation and not to a
  second, open one is the deterministic guard; it is in the Testing strategy above and must land.

- **[Tokens, secrets, credentials] Not applicable by construction — this slice mints, stores, reads
  and transports no credential.** The two new payload types carry a conversation id and operator text;
  neither reaches `safeStorage`, disk, or `localStorage`. `RequestSystemPromptPayload.conversation_id`
  is a **routing id, not a secret** (the repo's standing convention), and naming a conversation is not
  authorization — the daemon validates it against its own registry, and authorization is pairing,
  enforced structurally at the Noise IK handshake.

- **[File / storage operations] Not applicable — no path is constructed, opened, or written.** The
  live risk in this category would be the prompt or the conversation id becoming a path component;
  the design forbids both explicitly and the IPC arm says so in the `runConfigReceived` register. Note
  the daemon's own seam doc flags the mirror-image hazard on its side (`request_history`'s tolerated
  decode is safe only because that id reaches a registry lookup and never a path).

- **[Inter-process / Electron attack surface] No findings — no new IPC channel, no new
  `contextBridge` member, no window.** The command rides the existing `COMMAND_CHANNEL` through the
  generic `sendCommand`, and the event rides the existing daemon-event channel. The one new
  attack-surface line is the `isRendererCommand` case, and the lockstep rule is the trap: a
  `RendererCommand` member added without its `isRendererCommand` case is **silently dropped** at the
  boundary rather than failing loudly. Both land in the same commit.

- **[Cryptographic primitives] Not applicable — no key, nonce, RNG, comparison against a secret, or
  handshake change.** The frame rides the established Noise session; `MAX_PLAINTEXT_BYTES` on the
  envelope is the only size gate on this path and no second one is invented.

- **[Network & I/O] No findings — the slice adds no socket, no timeout, no reconnect policy, and
  deliberately no retry.** Frame size is bounded by the existing `MAX_PLAINTEXT_BYTES` guard at the
  top of `parseInboundMessage`, applied before any narrower runs, with the relay socket's `maxPayload`
  behind it. The prompt's length is **not** a client branch — the daemon caps it write-side at 8192
  bytes and the client relies on that bound the way it relies on the 256-byte bound for `model`. A
  hostile relay can drop, delay, reorder or flood; every one of those outcomes here is "no reply",
  which every consumer must already tolerate because nothing blocks on this frame.

- **[Error messages, logs, telemetry] MUST FIX (addressed in the design above, before this pass
  concluded) — the `assertNever` guard in the four renderer bridges is a log sink for the prompt.**
  `questionBridge.ts`'s `assertNever` throws
  ``new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)``, and an `Error` message reaches a
  stack trace, a crash reporter, and anything that catches and logs. A `systemPromptReceived` arm
  missing from any of the four switches would put the whole event — the operator's prompt text
  included — into that string. TypeScript catches the omission at build time, but the finding is worth
  naming because the fix reads like bookkeeping and could be dropped as "not my ticket's files". The
  design now lists all four as required edits and states the reason on each arm.

  Three further sinks, each closed structurally rather than by argument, per the daemon side's own
  lesson that a "never log X" AC must be checked against what a **shared helper's wrapped error can
  quote**, not only the attributes a new log line names:
  - `parseSystemPromptPayload`'s throw messages name the client-owned `field` constant only. The
    existing `optionalString` already does this (`malformed optional field: ${field}`); the
    status narrow must not interpolate the rejected value.
  - `onDriverEvent`'s `parseInboundMessage` catch **drops** its caught object entirely — already true,
    and it is what makes the decode-failure path leak-free without relying on message discipline alone.
  - `requestSystemPrompt`'s catch drops its caught object with no log line, matching every sibling.

  The `inbound-decoded` diagnostic carries `code` (a client-owned literal), `bytes` and `hash` — no
  new `DiagnosticEvent` field, so the renderer-side allowlist pin is untouched and no decoded value is
  reachable from the record.

- **[Concurrency] No findings — one `Map`, single-writer, no async task, no listener, no timer.**
  Every mutation runs to completion inside a synchronous body with no `await` between a read and a
  write. The record-**after**-send ordering is load-bearing and is stated in the map's header: a build
  or send that throws advances no envelope id, so an entry left under an unspent id would answer
  whichever request re-mints it — here handing one conversation's prompt to another. Growth is bounded
  by the client's own send rate, not a remote one; `dial()` clears the map.

- **[Threat model alignment] The four desktop threats, each named:**
  - *Malicious / compromised relay* — content-blind and on-path. It can withhold this frame; the
    design's response is that nothing retries and nothing blocks, so a withheld frame costs a stale
    reading rather than a spin. It cannot forge one into a session it cannot read.
  - *Hostile daemon inside the session* — the live threat here, and the one the correlation gate
    answers: a forged `system_prompt` for a request this client never sent matches no outstanding
    entry and is dropped entirely. A malformed or off-contract one fails the decode closed. An
    oversized one dies at `MAX_PLAINTEXT_BYTES` before any narrower runs.
  - *Membership probe* — `no_session` deliberately merges five daemon states including "not hosted
    here". This client must **not** repair that merge into a membership signal; it is treated as one
    reading, and this slice branches on it nowhere.
  - *Renderer compromise reaching the transport* — a compromised renderer can send
    `requestSystemPrompt` for any conversation id it can name, and read back the prompt. That is not a
    new capability: it can already send `requestSessionSettings`, `requestHistory` and `sendMessage`
    for the same ids, and the daemon serves only what the authenticated session is entitled to. The
    boundary that matters — keys, sockets and raw bytes staying in the background process — is
    untouched, and the guard admits exactly one string.
  - *Token theft from disk* — out of scope; this slice writes nothing to disk.

- **[Out of scope]** Rendering the prompt (#1078) inherits the untrusted-operator-text rules stated on
  the IPC arm: plain text only, never a raw-markup sink, an attribute, a URL, a filename, a cache key
  or a lookup path. The write-back round trip (`set_system_prompt`, pyrycode #2151) is not this
  ticket's; what this ticket owes it is the tri-state preserved unchanged, which AC2 pins.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07

## Revisions

**2026-09-07 — Phase B, open questions closed. No design change.**

1. **`systemPrompt: string | undefined` vs `systemPrompt?: string`** — the required-key form shipped, as
   the Design section specified. Both bridges and `daemonConnection`'s emit typecheck against it and
   the three states cross intact.
2. **A fifth `DaemonEvent` enumeration site** — there is none. `src/shared/ipc/events.test.ts` does not
   inventory the union, and the four bridge switches are the only exhaustive readers, so the arm count
   in the size table stands at 12 production files.

**One implementation refinement worth naming.** The plan described the off-contract-status rejection as
a check inside `parseSystemPromptPayload`. It shipped split: `narrowSessionPromptStatus` maps the
untrusted string onto one of three client-owned literals or returns `null`, and the caller turns `null`
into the throw. The rejected value therefore never enters the function that could interpolate it into a
message — a structural version of AC4's rule rather than one held by comment discipline. It also
avoids an `as SessionPromptStatus` cast, which an `includes`-based guard would have needed.

**Non-vacuity, mutation-checked and reverted.** Weakening the correlation gate in the `system-prompt`
arm to `pendingSystemPromptRequests.get(inReplyTo) ?? '<some open conversation>'` reddened 3 tests;
collapsing the tri-state with `system_prompt ?? ''` at the emit reddened 1. Both were reverted.
