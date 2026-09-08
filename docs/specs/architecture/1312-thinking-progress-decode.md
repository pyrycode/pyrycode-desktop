# #1312 — decode the daemon's `thinking_progress` frame into an inbound arm

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `ApiRetryPayload`, `CompactingPayload`,
  `ModelAnnouncedPayload` — the mirror this new payload joins, and the three neighbours whose
  docblocks establish how a conversation-scoped, non-turn reading is documented here.
- `src/shared/wire/types.ts` → `UnrecognizedMessagePayload`'s docblock — carries one of the three
  no-parser pair claims AC4 retires (§ WHAT THIS CLIENT DECODES).
- `src/main/transport/inboundMessage.ts` → `parseApiRetryPayload` — the posture AC1 names: an
  `isRecord` guard, per-field `require*` helpers, a fresh literal, no invented range check.
- `src/main/transport/inboundMessage.ts` → `parseCompactingPayload`, `parseModelAnnouncedPayload` —
  the two nearest scaled-down siblings; the new parser sits beside the latter.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`, `FrameTimestamp` — the union the
  new arm joins, and the mix-in it deliberately does NOT take (see § Design).
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`'s `case 'api_retry'` and its
  `default` arm — the narrow-before-log idiom and the `inbound-unmodeled` record AC2 retires.
- `src/main/transport/inboundMessage.ts` → `decodeHistoryEvent` — gains no arm (AC3); its docblock
  carries the second no-parser pair claim.
- `src/main/transport/inboundMessage.test.ts` → the `decodeHistoryEvent` AC3 `it.each` skip table —
  already lists `thinking_progress`; its comment carries the third pair claim.
- `src/shared/wire/types.test.ts` → the `api-retry wire vocabulary (#492)` describe — the shape the
  new vocabulary describe mirrors.
- `docs/knowledge/features/inbound-message-decode-contract.md` — the extension narrative every prior
  arm in this family wrote itself into. Read for the house rules it records (fresh-literal
  prototype safety, one-bad-field-fails-the-frame, `requireNumber` type-not-truthiness). The
  documentation phase owns the fold; nothing here writes to it.
- `docs/knowledge/features/question-shown-wire-types.md` — the #884/#894 two-step this slice repeats:
  decode now, carry later, arm ships dormant.
- pyrycode `internal/protocol/interactive.go` → `ThinkingProgressPayload`; `internal/protocol/codes.go`
  → `TypeThinkingProgress`; `docs/protocol-mobile.md` § `thinking_progress` — the SSOT for the three
  fields, the wire name's provenance, and the five documented consumer hazards.

## Context

The daemon has emitted `thinking_progress` since pyrycode#1386. It is the daemon's translation of
claude's `system/thinking_tokens` line and claude's **only** mid-turn proof of life on the
stream-json surface: during a long assistant turn nothing else crosses the wire, so a client showing
"thinking" for three minutes cannot otherwise separate a slow answer from a wedged session.

This client has no arm for it. The frame reaches `parseInboundMessage`'s `default`, which writes one
content-free `inbound-unmodeled` record and returns `null`, so the reading is dropped and the log
line carries the wire-supplied `envelope.type` rather than a client-owned literal.

This slice **stops in the background process**. `daemonConnection`'s inbound switch has no
catch-all — verified: its only `default:` is in the unrelated failure-copy helper — so a decoded
frame stops at the transport boundary until the carry slice claims it. That is the two-step this
repo already took for `question_shown` (#884 decode, #885 carry) and `modal_shown` (#870, #871).

No ADR is warranted: this adds a member to an existing wire vocabulary under a contract the daemon
already published, which is exactly what ADR 0002 governs rather than something it needs amending
for.

## Design source

**Figma:** N/A — no UI-visible surface. This slice ends in the Electron background process; nothing
renders, so the visual-fidelity check is intentionally skipped.

## Design

### 1. The wire type — `src/shared/wire/types.ts`

Add `'thinking_progress'` to `EnvelopeType`, placed immediately after `'model_announced'`. The two
belong together: both are daemon translations of a claude `system/*` subtype, and the daemon's own
`codes.go` groups this one *alone* rather than with `api_retry`/`compacting` (no show/clear edges) or
with the background-task three (not turn-independent work) — it is a periodic **reading**, with no
edges at all. The member carries a docblock comment naming that grouping rationale and the
provenance of the name: the wire word is the daemon's (`progress`), never claude's (`tokens`), so a
claude rename lands in one upstream place instead of breaking every client.

Add the payload interface beside `ModelAnnouncedPayload`, mirroring the daemon field-for-field in
wire order:

```ts
export interface ThinkingProgressPayload {
  conversation_id: string
  estimated_tokens: number
  estimated_tokens_delta: number
}
```

Its docblock states, from the SSOT rather than inferred:

- **Conversation-scoped, not turn-scoped.** No `turn_id`; receiving one neither opens nor closes a
  turn. The turn's thinking state is already `turn_state: thinking`.
- **No `truncated_fields`, and the absence is a decision.** Unlike every sibling in that family this
  payload carries no claude-authored *text*, so nothing is ever cut and a permanently-`null` field
  would claim a bound that does not exist. There is likewise no producer byte cap to mirror.
- **The three consumer hazards a reader gets wrong by default**, each measured upstream on one
  committed capture: the frames are rate-bounded to one per 64 tokens of accumulated delta and do
  **not** enumerate claude's lines (33 lines became 8 frames); `estimated_tokens` is **not
  monotonic** — it restarts near zero at every inference-request boundary, four times inside that
  capture's single turn — so two readings must never be subtracted expecting a non-negative result;
  and the deltas received **do not sum** to the turn's total (674 arrived as 243) with no field
  reporting the residue.
- **Absence proves nothing**, for two separate reasons that both apply: the PTY surface emits none
  at all, and on the emitting surface a gap may only mean the 64-token bound has not been crossed. A
  consumer must not infer a stall from either; `stall` is the daemon's separate signal.
- **It carries no reasoning text** (ADR 025). A consumer that tries to render it as text has nothing
  to render — so this frame adds no untrusted-display-string surface at all, the one respect in
  which it is *safer* than every neighbour in its family.

The last two bullets are stated here rather than delegated because they are the difference between a
progress reading and a liveness indicator, and this type is the only place a client-side reader will
look.

### 2. The parser — `src/main/transport/inboundMessage.ts`

```ts
function parseThinkingProgressPayload(payload: unknown): ThinkingProgressPayload
```

Placed directly after `parseModelAnnouncedPayload`. `parseApiRetryPayload`'s shape exactly, scaled
from four fields to three and from one boolean to none: an `isRecord` guard throwing
`WireDecodeError('malformed thinking_progress payload')`, then `requireString` for
`conversation_id` and `requireNumber` for each of `estimated_tokens` / `estimated_tokens_delta`,
returning a fresh three-field literal.

Four properties inherited from that sibling, restated in the docblock because each is load-bearing
here for its own reason:

- **`requireNumber` checks the TYPE, never truthiness.** `0` is a legal reading — neither struct
  field carries `omitempty`, so the daemon's zero value round-trips — and a truthiness test would
  read it as an absence.
- **No range check and no integer check on either number.** There is no house precedent for
  range-validating a wire integer (`seq`, `total`, `used_tokens`, `queued_msg_id` are all bare
  `requireNumber`), and a client-invented bound silently drops valid future frames. On *this* frame a
  monotonicity or non-negativity rule would be worse than merely unprecedented: `estimated_tokens`
  restarts at every inference-request boundary by design, so a check that "the reading only grows"
  would fail-close ordinary traffic.
- **A fresh literal, never a spread.** Unknown server-added keys are tolerated (forward-compat) but
  not copied, which is also what makes the narrower prototype-pollution-safe.
- **Messages name the failure CATEGORY only.** `conversation_id` is conversation-correlating and the
  two numbers are a side-channel on how much claude thought; neither is interpolated into an error.

### 3. The union arm and the switch case

```ts
| { kind: 'thinking-progress'; thinkingProgress: ThinkingProgressPayload }
```

placed after the `model-announced` arm, with the union docblock gaining a paragraph in the file's
established per-kind style.

**It does NOT take the `FrameTimestamp` mix-in**, and that is the design decision most worth reading
back. That intersection marks exactly the arms the timeline draws — the ten that have a matching arm
in `decodeHistoryEvent` and so need `(type, ts)` as a live/history join key. AC3 keeps
`decodeHistoryEvent` armless for this type, so there is no page half for a `ts` to join against;
stamping it would advertise a join that nothing can perform. `model-announced`, `question-shown` and
every other non-drawn arm are the precedent.

The `case 'thinking_progress':` arm in `parseInboundMessage` follows the `api_retry` arm's shape:
narrow **before** logging so a malformed frame throws first and leaves no record, then one
`inbound-decoded` record whose `code` is the **client-owned string literal** `'thinking_progress'`,
carrying the existing content-free field set (`bytes` = plaintext length, `hash` = the one-way frame
digest) and nothing decoded. No new `DiagnosticEvent` field, so #131's renderer pin is untouched.

### 4. `decodeHistoryEvent` gains no arm (AC3)

Its `default: return null` is what makes a stored `thinking_progress` skip, unchanged. This is a pin,
not a change: the type is already in the AC3 skip table and stays there.

### 5. Comment corrections (AC4)

Three comments in the touched files state the claim as a pair. Each is corrected so that
`thinking_progress` moves to the decoded side and `rate_limited` stays alone on the no-parser side:

- `src/shared/wire/types.ts` → `UnrecognizedMessagePayload`'s docblock, § WHAT THIS CLIENT DECODES
  ("of the six frames above: four" → five; the pair splits).
- `src/main/transport/inboundMessage.ts` → `decodeHistoryEvent`'s docblock, the list of types its
  `default` silently covers (`thinking_progress` moves from "no parser at all" into "decodes on the
  live lane and never draws in a thread"; the count word moves with it).
- `src/main/transport/inboundMessage.test.ts` → the comment above the AC3 skip table.

A `rate_limited`-only sweep of the four touched files confirms these three are the whole set; the
one other `thinking_progress` mention in `types.ts` describes the *daemon's* `thinking_tokens`
mapping and stays true. The package overviews under `docs/knowledge/features/` carry the same claim
and belong to the documentation phase — untouched here.

## State + concurrency model

None. This is a pure synchronous narrowing on an existing call path: no store, no async task, no
subscription, no timer, and therefore no cancellation path to define. The arm ships dormant, so no
consumer state machine changes either.

## Error handling

Unchanged and inherited: every failure is one `WireDecodeError` thrown by the parser, caught by the
existing single `catch` in the transport consumer, which drops the frame. Fail-closed — never a
partial value. The frame-level `MAX_PLAINTEXT_BYTES` guard already in `parseInboundMessage` covers
the oversized case; no second cap is invented here. The throw path is never logged, matching every
sibling arm.

## Testing strategy

Vitest only (node environment). No renderer surface, so no static-render spec; no interaction, so
nothing for the Playwright tier.

`src/shared/wire/types.test.ts` — a `thinking-progress wire vocabulary (#1312)` describe mirroring
the `api-retry` one:

- `'thinking_progress'` is assignable to `EnvelopeType` (compile-time membership).
- `ThinkingProgressPayload` is exactly its three fields.
- The all-zero reading is expressible — the daemon's zero value round-trips, since neither field
  carries `omitempty`.
- A non-monotonic pair of readings is expressible, pinning hazard 3 in the type's own test.

`src/main/transport/inboundMessage.test.ts` — three describes:

- **Recognition.** A well-formed frame narrows to `{ kind: 'thinking-progress', thinkingProgress }`
  carrying all three fields verbatim; the arm carries **no** `ts`; the result holds exactly three
  keys even when the frame plants an extra one (fresh-literal pin).
- **Fail-closed.** A non-object payload, and each of the three fields absent or mistyped, each throws
  `WireDecodeError`. Plus the negative pin the posture demands: a negative delta and a very large
  `estimated_tokens` both decode — the decoder polices type, never range.
- **Diagnostics.** A decoded frame logs exactly one `inbound-decoded` record with
  `code: 'thinking_progress'` and no `inbound-unmodeled` record (AC2), and the line contains neither
  the conversation id nor either number. A malformed frame logs nothing.

`decodeHistoryEvent` (same file) — the AC3 pin sharpened. The existing `it.each` entry stays, and one
new case feeds a **fully well-formed** `thinking_progress` payload and asserts it still skips. That
is the version that discriminates: the existing entry's payload would fail the new parser anyway, so
on its own it could not tell "skipped because the dispatch has no arm" from "skipped because the
payload failed" — the same distinction the neighbouring
`skips by stored TYPE, not by payload failure` test draws.

## Open questions

1. Does the new arm take `FrameTimestamp`? **Resolved in § Design before implementation:** no —
   the mix-in marks the arms `decodeHistoryEvent` draws, and AC3 keeps this type armless there.
2. Where does the payload interface sit relative to its neighbours in each file? Resolved: beside
   `ModelAnnouncedPayload` in `types.ts` and `parseModelAnnouncedPayload` in `inboundMessage.ts`, so
   the `EnvelopeType` order and the interface order agree at this point.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The design adds one narrowing at the existing
  untrusted→trusted boundary (`parseInboundMessage`), not a second boundary elsewhere: the frame
  arrives as opaque decrypted plaintext, `decodeEnvelope` does the structural narrowing, and
  `parseThinkingProgressPayload` does the semantic narrowing in one function that either returns a
  fully-typed value or throws. Downstream holds `ThinkingProgressPayload`, whose three fields are a
  daemon-asserted routing key and two daemon-asserted integers. **Decoding makes the SHAPE trusted
  and not the CONTENT** — the standing rule on this file, restated in the type's docblock because
  the type system carries no signal for it. It is stated as a *narrower* obligation here than on the
  neighbours, and deliberately: this payload carries no claude-authored text at all, so the usual
  "escape it at the render sink" clause has no subject.
- **[Trust boundaries]** No findings on `conversation_id`. It is a **daemon-asserted** routing key
  and is *not* cross-checked against a known-conversation set here — the same scoping posture #870
  settled for `modal_shown`: this decoder polices type, not membership. On this leg it reaches no
  sink at all, since the arm ships dormant and the log record is content-free. When the carry slice
  claims it, the field becomes a display-scoping key and never an authorization signal.
- **[Tokens, secrets, credentials]** Not applicable, and the reason is structural rather than
  incidental: this frame carries no token, no nonce, and no correlation secret. The contrast worth
  naming is `question_shown`, whose `question_batch_id` is an unguessable one-time nonce that must
  never reach a log — there is no analogous field here, so the log rule below rests on
  correlation-leak and side-channel grounds only, not on secrecy.
- **[File / storage operations]** Not applicable. Nothing in the design touches the filesystem, and
  no decoded field is resolved into a path, a filename, or a cache key. `conversation_id` in
  particular is never joined into a path — the standing CLAUDE.md rule, unchanged and untested-by
  this slice because no code here has a path to join it into.
- **[Inter-process / Electron attack surface]** No findings. The slice adds no IPC channel, no
  `contextBridge` API and no `ipcMain` handler, and the arm is unreachable from the renderer: it
  stops at the transport because `daemonConnection`'s inbound switch has no catch-all (verified —
  the file's only `default:` is in an unrelated failure-copy helper). The module stays
  main-process-only and is not re-exported through any renderer barrel. The wire type lands in
  `src/shared/wire/`, which the renderer may import; that is safe and is what every sibling payload
  does, because it is a type declaration with no runtime value and no code.
- **[Cryptographic primitives]** Not applicable — no key, nonce, handshake or comparison is added.
  The one primitive on the path, the BLAKE2s frame digest in `hashPlaintext`, is reused unchanged
  and is not re-derived here.
- **[Network & I/O]** No findings, with one hazard named. The frame-level `MAX_PLAINTEXT_BYTES`
  guard already standing in `parseInboundMessage` is the size bound, and the design deliberately
  invents no second one. **The memory-exhaustion question that sank a neighbour does not arise
  here:** `attachment_chunk`'s `total_chunks` is an unbounded daemon-supplied number that a naive
  consumer would allocate from, and the rule there is "never allocate from a claim". These two
  numbers are read and stored, never used to size an allocation, index a buffer, or bound a loop.
  That property is a **SHOULD FIX obligation on the eventual carry slice** rather than a fix here —
  a future consumer that renders `estimated_tokens` as a progress bar must not allocate or iterate
  proportionally to it. Recorded so the obligation is findable when that slice is written.
- **[Error messages, logs, telemetry]** No findings. The `code` written to the diagnostic log is a
  client-owned string literal, never `envelope.type` — which is strictly safer than the `default:`
  arm this replaces for the type, since that one logged wire-supplied text (capped, but
  peer-controlled). No decoded field is logged. That covers two distinct leaks rather than one:
  `conversation_id` is conversation-correlating in a log an operator may send off-box in a debug
  bundle, and the two integers are a **side-channel on how much claude thought** — a reading of
  private work that a content-free log has no business carrying. Error messages name the failure
  category only and interpolate no value. Narrowing happens before the log call, so a malformed
  frame leaves no record.
- **[Concurrency]** Not applicable, and stated rather than assumed: the addition is one synchronous
  pure function plus one `switch` case. No task is launched, no timer set, no listener registered,
  so there is nothing to cancel, nothing to tear down, and no check-then-act window across an
  `await`.
- **[Threat model alignment]** Addressed. *Hostile daemon response:* the parser is fail-closed on
  every field — a `null`, an array, a missing key, a JSON-string number and a `NaN`-shaped value all
  throw rather than yielding a partial value, and the fresh-literal return blocks prototype
  pollution from a planted `__proto__` key. *Malicious relay:* it is on-path but content-blind and
  can only drop, delay, reorder or duplicate; this frame carries no state transition, so a dropped
  one loses a reading and a duplicated one repeats a harmless value — which is why the type's
  "absence proves nothing" clause is a security property and not only a UX note, and why the design
  forbids inferring a stall from a gap. *Renderer compromise reaching the transport:* unchanged; no
  new renderer-reachable surface. *Token theft from disk:* not applicable, nothing is persisted.
- **[Threat model alignment]** OUT OF SCOPE, named rather than silently deferred: whether a consumer
  may attribute a reading to a conversation it does not host, and any rate-limiting of a daemon that
  floods this frame, belong to the carry slice — there is no consumer on this leg to defend, and the
  decode boundary can only say the frame was well-formed.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
