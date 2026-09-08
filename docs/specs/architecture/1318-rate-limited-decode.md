# #1318 — decode the daemon's `rate_limited` frame into an inbound arm

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` (the `model_announced` / `thinking_progress` members) —
  the grouping vocabulary the new member joins. `model_announced`'s comment already names this frame
  by description: "not a condition report **about a window**" is `rate_limited`, so the daemon's own
  taxonomy has a slot waiting.
- `src/shared/wire/types.ts` → `ThinkingProgressPayload` — the immediate neighbour (#1312, one slice
  earlier); the new interface sits directly after it so interface order and `EnvelopeType` order agree.
- `src/shared/wire/types.ts` → `BackgroundTaskStartedPayload`, `BackgroundTask` — where the
  `truncated_fields: string[] | null` contract and its "`null` is a VALUE, `[]` is not the same fact"
  trap are already written down; this payload inherits both verbatim.
- `src/shared/wire/types.ts` → `BackgroundTaskRosterPayload`'s docblock — the *opposite* nullability
  (`tasks: null` fails closed) that AC4 says must not be confused with this one. Read to keep the two
  apart.
- `src/shared/wire/types.ts` → `UnrecognizedMessagePayload`'s docblock, § WHAT THIS CLIENT DECODES —
  carries the first of the three no-parser pair claims AC5 retires.
- `src/main/transport/inboundMessage.ts` → `parseThinkingProgressPayload` — the posture the new parser
  copies: `isRecord` guard, per-field `require*`, fresh literal, no invented range check.
- `src/main/transport/inboundMessage.ts` → `parseBackgroundTaskStartedPayload` — the nearest structural
  sibling (a five-string-plus-`truncated_fields` narrower); this parser is that one minus two strings
  plus one number.
- `src/main/transport/inboundMessage.ts` → `requireString`, `requireNumber`, `requireStringArrayOrNull`
  (and `requireStringArray` beneath it) — every helper this frame needs. None is invented.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`, `FrameTimestamp` — the union the new
  arm joins and the mix-in it deliberately does not take (§ Design 3).
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`'s `case 'thinking_progress'` and its
  `default` arm — the narrow-before-log idiom, and the `inbound-unmodeled` record AC2 retires.
- `src/main/transport/inboundMessage.ts` → `decodeHistoryEvent` — gains no arm (AC5); its docblock
  carries the second pair claim.
- `src/main/transport/inboundMessage.test.ts` → the AC3 `it.each` skip table and the
  `skips a WELL-FORMED stored thinking_progress` test beside it — the third pair claim, and the exact
  shape AC5's regression pin follows.
- `src/main/transport/inboundMessage.test.ts` → `encodeThinkingProgress`, `THINKING_PROGRESS`,
  `encodeSnapshot` — the fixture idiom, and confirmation that the file's pinned *unmodeled* type is
  `screen_snapshot` / `ack`, never `rate_limited`, so no existing no-widening test reddens.
- `src/shared/wire/types.test.ts` → `thinking-progress wire vocabulary (#1312)` and
  `background-task-started wire vocabulary (#564)` — the two describes the new vocabulary describe
  merges: compile-time membership plus field shape from the first, the `truncated_fields: null`
  admission from the second.
- `docs/specs/architecture/1312-thinking-progress-decode.md` — this slice one frame earlier; its
  Design and Testing sections are the template, and its Open Question 1 (`FrameTimestamp`) resolves the
  same way here for the same reason.
- `docs/knowledge/features/inbound-message-decode-contract.md` — the house rules this family records
  (fresh-literal prototype safety, one-bad-field-fails-the-frame, `requireNumber` type-not-truthiness).
  The documentation phase owns the fold; nothing here writes to it.
- pyrycode `internal/protocol/interactive.go` → `RateLimitedPayload`; `internal/protocol/codes.go` →
  `TypeRateLimited`; `docs/protocol-mobile.md` § `rate_limited` — the SSOT, read 2026-09-08. Five
  fields, wire order `conversation_id, status, limit_type, resets_at, truncated_fields`, no
  `omitempty` on any of them, and no `MarshalJSON` (which is what makes `truncated_fields` a literal
  `null` rather than a normalised `[]`).

## Context

The daemon has emitted `rate_limited` since pyrycode #1410 (#1405 declared the shape). This client has
no parser for it, so the frame reaches `parseInboundMessage`'s `default`, which writes one content-free
`inbound-unmodeled` record and returns `null` — the reading is dropped, and the log line carries the
wire-supplied `envelope.type` instead of a client-owned literal. The only quota signal that reaches the
operator today is a generic retryable `error{code:'rate_limited'}` on the connection banner, which reads
as a broken daemon rather than an exhausted window.

This slice **stops in the background process**. `daemonConnection`'s inbound switch has no catch-all and
no `assertNever` on the `kind` union — verified, its inner switches document the absence explicitly — so
a decoded frame stops at the transport boundary until a carry slice claims it. That is the #1312 → #1313
two-step, and #870/#871 and #884/#885 before it.

No ADR is warranted: this adds a member to an existing wire vocabulary under a contract the daemon
already published, which is what ADR 0002 governs rather than something it needs amending for.

**One source discrepancy, recorded because the plan takes the wider reading.** `RateLimitedPayload`'s Go
docblock says `limit_type` was `five_hour` in all three captures; `docs/protocol-mobile.md`'s field table
is newer and names `five_hour` **and** `seven_day` as observed, the latter from the 2026-08-22
`allowed_warning` capture. Nothing in this slice turns on which is right — the field is an open string
either way — but the docblock written here follows the protocol doc.

## Design source

**Figma:** N/A — no UI-visible surface. This slice ends in the Electron background process; nothing
renders, so the visual-fidelity check is intentionally skipped.

## Design

### 1. The wire type — `src/shared/wire/types.ts`

Add `'rate_limited'` to `EnvelopeType` immediately after `'thinking_progress'`, and
`RateLimitedPayload` immediately after `ThinkingProgressPayload`, so the member order and the interface
order agree at this point. The member's comment records the grouping rationale in the file's established
style: the daemon groups this one alone as a **condition report about a usage-limit window** — the exact
category `model_announced`'s comment already excludes itself from — and it is a *top-level* claude line
type (`rate_limit_event`), not a `system/*` subtype like its two neighbours, which is why the daemon's
own `system`-subtype count deliberately excludes it.

```ts
export interface RateLimitedPayload {
  conversation_id: string
  status: string
  limit_type: string
  resets_at: number
  truncated_fields: string[] | null
}
```

`resets_at` is Go `int64` and lands as `number` — the file's existing posture for every wire integer;
no `bigint`, which no other member uses and which `JSON.parse` does not produce.

The docblock states, from the SSOT rather than inferred:

- **Conversation-scoped, not turn-scoped.** No `turn_id`; a usage-limit window is orthogonal to
  whichever turn observed it, so receiving one neither opens nor closes a turn. The bridge supplies
  `conversation_id` because the internal event carries none.
- **`status` and `limit_type` are OPEN STRINGS, never closed enums**, and the daemon states the reason:
  the value set beyond the one measured-benign status is *unmeasured* — no capture of a limit actually
  in force exists on any claude version. Closing either set drops the first real limit that fires. The
  producer's gate leans the same way on purpose: the benign status is silent and **any other non-empty
  status emits**, so an unrecognised status surfaces and a human looks.
- **A FRAME IS NOT PROOF THAT ANYTHING WAS BLOCKED**, and the daemon names this as the realistic client
  bug. The one measured non-benign value is `allowed_warning` (2026-08-22, claude 2.1.239,
  `limit_type: seven_day`): the account was inside its weekly warning band and every turn still ran
  normally. The frame's plain reading is "claude said something about the usage window worth repeating",
  and a client rendering it as "you are rate limited" tells the user they are blocked while their turns
  keep working. Stated in the type because the carry slice's wording decision is made against it.
- **`resets_at` is claude's number, unvalidated in both directions** — unix seconds, `0` meaning "claude
  did not report one" and **not** the epoch. Negative, zero and year-40000 values are all representable
  and none is rejected. Formatting it as a date without a range check is the named realistic bug; see
  the § Security review finding for the sharper timer version of it.
- **`truncated_fields` is load-bearing, not decoration.** It names the fields the producer cut to fit
  its cap, using these wire names (`status`, `limit_type`, in that order), and is a literal `null` when
  nothing was cut, never `[]` — which is why the Go type has no `MarshalJSON`. This is
  `BackgroundTask.truncated_fields`'s nullability, and explicitly **not**
  `BackgroundTaskRosterPayload.tasks`'s fail-closed shape; the docblock names that trap because this
  file already draws the distinction one screen away.
- **SECURITY**, restating the daemon's own constraint: `status` and `limit_type` are claude-authored
  text that crossed the subprocess trust boundary, bounded by the producer but not sanitized. Renderable
  later as inert text only — never into an HTML sink, an attribute or a URL — and a client **MUST NOT
  branch security-relevant behaviour on `status`**. Nothing on this leg renders them; what this leg owes
  is that neither reaches a log.

**`utilization` is not on the wire** and no sixth field is declared — the payload has exactly the five
fields above, and inventing one would drift the wire types ahead of the daemon, which CLAUDE.md forbids.

### 2. The parser — `src/main/transport/inboundMessage.ts`

```ts
function parseRateLimitedPayload(payload: unknown): RateLimitedPayload
```

Placed directly after `parseThinkingProgressPayload`. Structurally
`parseBackgroundTaskStartedPayload` minus two strings plus one number: an `isRecord` guard throwing
`WireDecodeError('malformed rate_limited payload')`, then `requireString` for `conversation_id` /
`status` / `limit_type`, `requireNumber` for `resets_at`, `requireStringArrayOrNull` for
`truncated_fields`, returning a fresh five-field literal. No helper is invented.

Four properties restated in the docblock because each is load-bearing here for its own reason:

- **No membership check on `status` or `limit_type`, and here that is a security decision as well as a
  drift one.** The house rule (a client-invented set fail-closes a valid future frame) applies, but the
  sharper reason is the daemon's: the set is unmeasured, and narrowing to a closed set is the first step
  of branching on a value the daemon forbids branching on. The empty string decodes — `requireString`
  checks `typeof`, so `''` passes free, which is the correct reading of a value the producer cut to
  nothing.
- **`requireNumber` checks the TYPE, never truthiness.** `resets_at: 0` is legal traffic meaning "claude
  did not report one"; a truthiness test reads it as an absence. No range check either: negative, zero
  and absurd magnitudes all decode, because rejecting one would be a validation rule with no captured
  negative case behind it, and because this boundary says only that the value is a number.
- **`truncated_fields` is required-present and nullable.** A literal `null` is the value "nothing was
  cut"; an omitted key is `undefined` and fails closed — the Go field has no `omitempty`, so the key is
  always written. The element names are deliberately not cross-validated against this frame's own field
  set (the `parseQueuedItem` no-cross-validate posture).
- **A fresh literal, never a spread**, so unknown server-added keys (a spurious `turn_id`, which this
  frame must never carry, or a planted `__proto__`) are tolerated for forward-compat but not copied —
  which is also what makes the narrower prototype-pollution-safe. Messages name the failure CATEGORY
  only: `conversation_id` correlates a conversation and the two strings are claude-authored text.

### 3. The union arm and the switch case

```ts
| { kind: 'rate-limited'; rateLimited: RateLimitedPayload }
```

placed after the `thinking-progress` arm, with the union docblock gaining a paragraph in the file's
per-kind style.

**It does NOT take the `FrameTimestamp` mix-in.** That intersection marks exactly the arms the timeline
draws — the ones with a matching arm in `decodeHistoryEvent`, which need `(type, ts)` as a live/history
join key. AC5 keeps `decodeHistoryEvent` armless for this type, so there is no page half for a `ts` to
join against and stamping one would advertise a join nothing can perform. `thinking-progress` and
`model-announced` are the precedent.

The `case 'rate_limited':` arm follows the `thinking_progress` arm's shape: narrow **before** logging so
a malformed frame throws first and leaves no record, then one `inbound-decoded` record whose `code` is
the **client-owned string literal** `'rate_limited'`, carrying the existing content-free field set
(`bytes` = plaintext length, `hash` = the one-way frame digest) and nothing decoded. No new
`DiagnosticEvent` field, so #131's renderer pin is untouched.

### 4. `decodeHistoryEvent` gains no arm (AC5)

Its `default: return null` is what makes a stored `rate_limited` skip, unchanged. This is a pin, not a
change: the type is already in the AC3 skip table and stays there.

### 5. Comment corrections (AC5)

Three comments state the claim as a pair (`thinking_progress` decoded, `rate_limited` not). Each is
rewritten so the pair dissolves rather than being deleted:

- `src/shared/wire/types.ts` → `UnrecognizedMessagePayload`'s docblock, § WHAT THIS CLIENT DECODES:
  "of the six frames above: five … `rate_limited` alone has none … a separate ticket adds its arm"
  becomes all six, with the trailing sentence about the pending ticket retired.
- `src/main/transport/inboundMessage.ts` → `decodeHistoryEvent`'s docblock: `rate_limited` moves out of
  "the one it has no parser for at all" and into the decoded-on-the-live-lane-never-drawn list; the
  count word moves with it (seven → eight).
- `src/main/transport/inboundMessage.test.ts` → the comment above the AC3 skip table.

**Two `rate_limited` mentions stay untouched, and they are the sweep's false positives**:
`composerSend.ts`'s comment and `codec.test.ts`'s fixture both concern `ErrorPayload.code`'s
`'rate_limited'` string — a retryable daemon wire-error code in a different namespace from the envelope
type, and both stay true. The package overviews under `docs/knowledge/features/` carry the same
no-parser claim and belong to the documentation phase — untouched here.

## State + concurrency model

None. A pure synchronous narrowing on an existing call path: no store, no async task, no subscription,
no timer, and therefore no cancellation path to define. The arm ships dormant, so no consumer state
machine changes either.

## Error handling

Unchanged and inherited: every failure is one `WireDecodeError` thrown by the parser, caught by the
existing single `catch` in the transport consumer, which drops the frame. Fail-closed — never a partial
value; one bad `truncated_fields` element throws the whole frame rather than yielding a partial list.
The frame-level `MAX_PLAINTEXT_BYTES` guard already in `parseInboundMessage` covers the oversized case;
no second cap is invented, because both strings are bounded by the producer at construction and a second
cap would be a second place the limit is decided. The throw path is never logged, matching every sibling
arm.

## Testing strategy

Vitest only (node environment). No renderer surface, so no static-render spec; no interaction, so
nothing for the Playwright tier.

`src/shared/wire/types.test.ts` — a `rate-limited wire vocabulary (#1318)` describe:

- `'rate_limited'` is assignable to `EnvelopeType` (compile-time membership).
- `RateLimitedPayload` is exactly its five fields, and carries no `turn_id`.
- `truncated_fields: null` is admissible — "nothing was cut", distinct from `[]`, with both expressed in
  the same test so the distinction is visible rather than asserted twice.
- The empty-string `status` and the `resets_at: 0` reading are both expressible (the producer's cut-to-
  nothing case and claude's did-not-report case).

`src/main/transport/inboundMessage.test.ts` — a fixture (`RATE_LIMITED`, built from the daemon's one
measured non-benign capture: `allowed_warning` / `seven_day`) plus `encodeRateLimited`, and three
describes:

- **Recognition.** A well-formed frame narrows to `{ kind: 'rate-limited', rateLimited }` carrying all
  five fields verbatim; it no longer reaches the unmodeled default; the arm carries no `ts`; the result
  holds exactly five keys even when the frame plants extras (fresh-literal pin).
- **Open-set and range pins (AC3).** An unrecognised `status`, an unrecognised `limit_type` and the
  empty string for each all decode; `resets_at` decodes at `0`, at a past instant, at a negative value
  and at an absurd magnitude. These are the tests that redden if someone later "hardens" the parser into
  the shape the daemon forbids.
- **Fail-closed (AC2) and `truncated_fields` (AC4).** A non-object payload and each of the five fields
  absent or mistyped each throw `WireDecodeError`; `truncated_fields` decodes across a populated array,
  a literal `null` (asserted `toBeNull()`, not `toEqual([])`, so the two are distinguished), and an
  omitted key that fails closed, plus a non-string element that throws the whole frame. And the
  category-only pin: a message carrying neither the conversation id nor the `status` text.
- **Diagnostics (AC2).** A decoded frame logs exactly one `inbound-decoded` record with
  `code: 'rate_limited'` and the exact content-free key set, no `inbound-unmodeled` record, and a line
  containing neither `status`, `limit_type` nor the conversation id. A malformed frame logs nothing.

`decodeHistoryEvent` (same file) — the AC5 pin sharpened. The existing `it.each` row stays, and one new
case feeds a **fully well-formed** stored `rate_limited` and asserts it still skips. That is the version
that discriminates: the existing row's payload would fail the new parser anyway, so on its own it could
not tell "skipped because the dispatch has no arm" from "skipped because the payload failed" — the
`thinking_progress` shape #1312 left behind, and the distinction the neighbouring
`skips by stored TYPE, not by payload failure` test draws.

## Open questions

1. Does the new arm take `FrameTimestamp`? **Resolved in § Design 3 before implementation:** no — the
   mix-in marks the arms `decodeHistoryEvent` draws, and AC5 keeps this type armless there.
2. Where does the member sit in `EnvelopeType`? Resolved: after `'thinking_progress'`, with the
   interface after `ThinkingProgressPayload`, so the two orders agree.
3. Does `resets_at` need `bigint` for a Go `int64`? Resolved: no — `number` is the file's posture for
   every wire integer, `JSON.parse` produces no `bigint`, and a value beyond `Number.MAX_SAFE_INTEGER`
   is already covered by the no-range-check rule rather than by a type change.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The design adds one narrowing at the existing untrusted→trusted
  boundary (`parseInboundMessage`), not a second boundary elsewhere: the frame arrives as opaque
  decrypted plaintext, `decodeEnvelope` does the structural narrowing, and `parseRateLimitedPayload`
  does the semantic narrowing in one function that either returns a fully-typed value or throws.
  **Decoding makes the SHAPE trusted and not the CONTENT** — the standing rule on this file, and it has
  a live subject here that #1312 lacked: `status` and `limit_type` are claude-authored strings, so the
  "render as inert text, escape at the sink" obligation is real rather than vacuous. It is written into
  `RateLimitedPayload`'s docblock because the type system carries no signal for it and the carry slice
  is where the sink appears.
- **[Trust boundaries]** No findings on `conversation_id`. A **daemon-asserted** routing key, not
  cross-checked against a known-conversation set here — the scoping posture #870 settled for
  `modal_shown`: this decoder polices type, not membership. On this leg it reaches no sink at all.
- **[Trust boundaries]** A finding considered and rejected: should the parser reject
  `status: 'allowed'`, the benign value the daemon suppresses? **No** — that is the membership check
  AC3 forbids, it would fail-close a frame from a daemon whose gate changed, and its worst case is one
  extra row. Rejecting it would also make the client's behaviour depend on a value the daemon says no
  behaviour may depend on.
- **[Tokens, secrets, credentials]** Not applicable, and structurally so: this frame carries no token,
  no nonce and no correlation secret. The contrast is `question_shown`, whose `question_batch_id` is an
  unguessable one-time nonce — there is no analogous field here, so the log rule below rests on
  correlation-leak and content-leak grounds only, not on secrecy.
- **[File / storage operations]** Not applicable. Nothing touches the filesystem, and no decoded field
  is resolved into a path, a filename or a cache key. Worth stating rather than skipping because
  `limit_type` (`five_hour`, `seven_day`) is exactly the shape of string a later consumer might reach
  for as a Map key or an icon-lookup path — it is claude-authored text and must not become either.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` API and
  no `ipcMain` handler is added, and the arm is unreachable from the renderer: it stops at the transport
  because `daemonConnection`'s inbound switch has no catch-all and no `assertNever` on the union, so
  adding a member forces no change there and creates no renderer-reachable path. The wire type lands in
  `src/shared/wire/`, which the renderer may import; that is safe and is what every sibling payload
  does, because it is a type declaration with no runtime value.
- **[Cryptographic primitives]** Not applicable — no key, nonce, handshake or comparison is added. The
  one primitive on the path, the frame digest in `hashPlaintext`, is reused unchanged.
- **[Network & I/O]** No findings on this leg, with **one SHOULD FIX obligation recorded for the carry
  slice**, which is the sharpest thing this review found. `resets_at` is an unvalidated,
  daemon-supplied, claude-authored number. The obvious consumer move — scheduling a "limit lifts"
  refresh with `setTimeout(cb, resets_at * 1000 - Date.now())` — turns a hostile or merely wrong number
  into either a negative delay that fires immediately (a spin loop if the handler re-arms) or a value
  past `setTimeout`'s ~24.8-day 32-bit clamp, which fires **immediately** rather than never. That is the
  same family as `attachment_chunk`'s `total_chunks`, whose rule this file already records as "never
  allocate from a claim": **never schedule, allocate or iterate from `resets_at` either.** It is not
  fixable here — there is no consumer to defend and the decode boundary can only say the value is a
  number — so it is recorded in the type's docblock and named here so it is findable when the carry
  slice is written. The frame-level `MAX_PLAINTEXT_BYTES` guard already standing in
  `parseInboundMessage` is the size bound; the design deliberately invents no second one, because both
  strings are bounded by the producer at construction.
- **[Error messages, logs, telemetry]** No findings. The `code` written to the diagnostic log is a
  client-owned string literal, never `envelope.type` — strictly safer than the `default:` arm it
  replaces for this type, which logged wire-supplied (capped, but peer-controlled) text. No decoded
  field is logged, which covers three distinct leaks: `conversation_id` is conversation-correlating in
  a log an operator may send off-box in a debug bundle; `status` and `limit_type` are claude-authored
  text, so logging them would put unsanitized model-influenced strings into a file whose readers assume
  it is machine-written; and the pair together disclose the account's quota posture, which is a fact
  about the operator's usage rather than about this frame. `requireString`'s message names the
  client-owned `field` constant only, so no value is interpolated. Narrowing happens before the log
  call, so a malformed frame leaves no record.
- **[Concurrency]** Not applicable, stated rather than assumed: one synchronous pure function plus one
  `switch` case. No task launched, no timer set, no listener registered — nothing to cancel, nothing to
  tear down, no check-then-act window across an `await`.
- **[Threat model alignment]** Addressed. *Hostile daemon response:* the parser is fail-closed on every
  field — a `null`, an array, a missing key, a JSON-string number, a non-string `truncated_fields`
  element all throw rather than yielding a partial value, and the fresh-literal return blocks prototype
  pollution from a planted `__proto__`. A hostile daemon's remaining power over this frame is to send
  arbitrary `status` / `limit_type` text, which is *by design* — the open-string decision is the
  daemon's, and the containment is that the frame is a **report, never a control input**: nothing in the
  daemon keys behaviour on it and this client must hold the same line, so a fabricated status costs at
  most one misleading row. *Malicious relay:* on-path but content-blind; it can drop, delay, reorder or
  duplicate. This frame carries no state transition, so a dropped one loses a reading and a duplicated
  one repeats a harmless value. *Renderer compromise reaching the transport:* unchanged, no new
  renderer-reachable surface. *Token theft from disk:* not applicable, nothing is persisted.
- **[Threat model alignment]** OUT OF SCOPE, named rather than silently deferred, all three for the
  carry slice: rendering `status` / `limit_type` as escaped inert text at whatever sink it chooses; the
  wording problem the daemon names (an `allowed_warning` frame must not be rendered as "you are
  blocked"); and any rate-limiting of a daemon that floods this frame. There is no consumer on this leg
  to defend, and the decode boundary can only say the frame was well-formed.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
