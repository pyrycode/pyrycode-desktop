# #1514 — decode the daemon's `resetting` frame into an inbound arm

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, the `stall` / `api_retry` / `compacting` run — the
  status-peer cluster the new member joins, and the placement the grouping rationale dictates.
- `src/shared/wire/types.ts` → `ApiRetryPayload` — the nearest structural sibling: a
  conversation-scoped, two-edge status frame whose `active` is the edge and whose remaining fields ride
  BOTH edges. Its "`current: 0` alongside `total: 0` is legitimate, not a sentinel to coerce away"
  paragraph is the same shape as this frame's `''` reading.
- `src/shared/wire/types.ts` → `CompactingPayload` — the immediate neighbour; the new interface sits
  directly after it so interface order and `EnvelopeType` order agree at this point.
- `src/shared/wire/types.ts` → `RateLimitedPayload` — read to establish what this frame is NOT. Its
  fields are claude-authored open strings; every field here is daemon-authored, which is why this
  decoder narrows where that one deliberately does not. Copying its log rationale verbatim would be a
  false claim (§ Security review).
- `src/shared/wire/types.ts` → `WireSessionTransitionReason`, `WireUnrecognizedSite` and their
  docblocks — the closed-wire-enum declaration idiom, the `Wire` prefix rule for a scalar enum, and the
  "a closed wire enum, so the decoder compares against literals rather than accepting any string"
  wording the two new enums inherit.
- `src/shared/wire/types.ts` → `UnrecognizedMessagePayload`'s docblock, § WHAT THIS CLIENT DECODES —
  read to confirm it is a FALSE POSITIVE for this sweep and stays untouched (§ Design 5).
- `src/main/transport/inboundMessage.ts` → `parseSessionTransitionPayload` — the idiom this parser
  clones for both tokens: a closed-enum check covering non-string and unknown-string alike, narrowing
  without a cast.
- `src/main/transport/inboundMessage.ts` → `parseApiRetryPayload` — the structural template
  (`isRecord` gate, `requireString` + `requireBoolean`, fresh literal); this parser is that one with
  its two numbers replaced by two narrowed tokens.
- `src/main/transport/inboundMessage.ts` → `requireString`, `requireBoolean` — the two helpers this
  frame needs. Neither is invented, and `requireBoolean`'s "the check is on the TYPE, never
  truthiness" is load-bearing for the falling edge.
- `src/main/transport/inboundMessage.ts` → `parseQueuedItem`'s docblock — the no-cross-validate posture
  the ticket cites by name, and the reason `active:true` with `phase:''` decodes rather than throwing.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage`, `FrameTimestamp` — the union the new
  arm joins and the mix-in it deliberately does not take (§ Design 3).
- `src/main/transport/inboundMessage.ts` → `parseInboundMessage`'s `case 'rate_limited'` and its
  `default` arm — the narrow-before-log idiom, the client-owned code literal, and the
  `inbound-unmodeled` record AC4 retires for this type.
- `src/main/transport/inboundMessage.ts` → `decodeHistoryEvent` and its docblock — gains no arm (AC5);
  the docblock's enumeration of live-lane-decoded-but-never-drawn types is the one comment this change
  makes stale (§ Design 5).
- `src/main/transport/inboundMessage.test.ts` → `encodeRateLimited`, `RATE_LIMITED`, the AC3 skip
  table, and the `skips a WELL-FORMED stored rate_limited` pin — the fixture idiom and the exact shape
  AC5's regression pin follows.
- `src/shared/wire/types.test.ts` → `api-retry wire vocabulary (#492)` and
  `rate-limited wire vocabulary (#1318)` — the vocabulary-describe template: compile-time membership,
  field shape, and one test per legitimate-reading-that-looks-like-an-absence.
- `docs/knowledge/features/inbound-message-decode-contract.md` — the house rules this family records
  (fresh-literal prototype safety, one-bad-field-fails-the-frame, type-not-truthiness). The
  documentation phase owns the fold; nothing here writes to it.
- `docs/specs/architecture/1318-rate-limited-decode.md` — the template for this slice per the ticket's
  technical notes.
- pyrycode `internal/protocol/interactive.go` → `ResettingPayload` and the `ResetPhase*` /
  `ResetHandoff*` constants; `cmd/pyry/resetting_v2.go` → the emitter — the SSOT, as described by the
  ticket body from the closed pyrycode #2453 / #2478.

## Context

pyrycode #2453 declared the `resetting` frame and #2478 shipped its producer; both are on pyrycode
`main`. This client has no parser for it, so the frame reaches `parseInboundMessage`'s `default`, which
returns `null` and writes one `inbound-unmodeled` record under the **wire-supplied** `envelope.type`.
Decoding it replaces that with a client-owned literal and yields a typed value.

This slice **stops in the background process**. `daemonConnection`'s inbound switch has no catch-all and
no `assertNever` on the `kind` union (verified by grep across `src/main/`), so adding a union member
forces no change there and creates no renderer-reachable path. The IPC carry is #1515; its two
consumers follow it. That is the #1312 → #1313 and #1318 two-step.

No ADR is warranted: this adds a member to an existing wire vocabulary under a contract the daemon has
already published, which is what ADR 0002 governs rather than something it needs amending for.

**Size note, stated rather than hidden.** The refiner's estimate (~890 lines) sits above the 800-line
one-ticket boundary, and the overage is the spec doc. The floor rule decides it: the only seam here is
between the wire type and its parser, and a type-only slice would have no observable contract of its
own — nothing decodes, nothing throws, no test can tell it from a no-op. The floor wins over the
ceiling, so this builds as one ticket. This plan is written tight to keep the total near the line.

## Design source

**Figma:** N/A — no UI-visible surface. This slice ends in the Electron background process; nothing
renders and nothing is emitted, so the visual-fidelity check is intentionally skipped.

### 1. The wire types — `src/shared/wire/types.ts`

`'resetting'` joins `EnvelopeType` **immediately after `'compacting'`**, making the status-peer run
contiguous (`stall | api_retry | compacting | resetting`). Placement follows the grouping rationale
the file already uses rather than append order: this is a two-edge sub-state report gated on the
negotiated `interactive` capability, not a translation of a claude line like the
`model_announced` / `thinking_progress` / `rate_limited` cluster further down. Its comment records that
rationale in the file's established style, plus the one thing that separates it from every neighbour:
`api_retry` and `compacting` report what CLAUDE is doing, while this reports what the DAEMON is doing
to claude — every field on it is the daemon's own.

Two closed wire enums land directly before the interface, following `WireSessionTransitionReason`'s
declaration idiom and the `Wire` prefix rule for a scalar whose bare name a renderer store would
otherwise want:

```ts
export type WireResetPhase = 'wrapping_up' | 'restarting' | ''
export type WireResetHandoff = 'pending' | 'written' | 'skipped' | ''
```

`''` IS INSIDE EACH UNION, not bolted on as `WireResetPhase | ''`, and that is the whole design
decision of this slice. The daemon declares no `omitempty`, so every key is always on the wire and
`''` is its declared zero value once the reset is over. It is a member of neither named constant set
upstream — it is Go's zero — but it IS a member of the wire's accepted value set for each field, and
the type says what the wire says. The docblock states the three emitted rows verbatim
(`wrapping_up`/`pending`, `restarting`/`written`, `restarting`/`skipped`, then `false`/`''`/`''`) so a
reader can see that the falling edge carries both as `''`.

`ResettingPayload` follows immediately after `CompactingPayload`:

```ts
export interface ResettingPayload {
  conversation_id: string
  active: boolean
  phase: WireResetPhase
  handoff: WireResetHandoff
}
```

The docblock carries, from the SSOT rather than inferred:

- **Two edges, like `api_retry` and `compacting`, never onset-only like `stall`.** `active: true` is
  the rising edge and `active: false` the explicit falling edge, so a consumer never derives "cleared"
  from turn activity. The rising edge RE-FIRES as the phase advances (`wrapping_up` → `restarting`).
- **Conversation-scoped, not turn-scoped.** No `turn_id`; receiving one neither opens nor closes a
  turn. A reset is orthogonal to whichever turn was running.
- **`''` IS ACCEPTED WHATEVER `active` SAYS, and that is deliberate, not an oversight.** A membership
  check admitting only the two phases and the three handoffs rejects every falling edge and leaves the
  window with an indicator nothing can clear. Upstream's "gate on `active` rather than inventing a
  fourth token" is addressed to a CONSUMER switching over either set — that is #1515's — and applied
  here it would be cross-field validation, which this decoder family refuses by name.
- **The pair the daemon never emits decodes rather than throwing.** `active: true` with `phase: ''` is
  not on the producer's list, and this decoder accepts it, because rejecting it would be a defence for
  an unobserved failure mode and a cross-field rule in a family that has none.
- **EVERY FIELD IS DAEMON-AUTHORED, which is why both tokens are narrowed** — the deliberate contrast
  with `RateLimitedPayload` one screen down, whose `status` and `limit_type` are claude's and stay open
  for that reason. Nothing on this frame crossed the subprocess trust boundary: the id is one the
  daemon assigned, `active` a bool it computed, both tokens its own constants.
- **SECURITY: narrowed is not trusted.** A closed type is a shape claim, not a capability. Both tokens
  are a REPORT about a reset the daemon is driving, never an authorization or a control input, and a
  consumer must not branch security-relevant behaviour on either. `handoff: 'written'` describes a file
  the daemon wrote and the frame deliberately carries NO PATH, so nothing downstream can open, resolve
  or join one. `conversation_id` is a daemon-asserted routing key, never an authorization signal.
  Nothing decoded reaches a log (§ Design 4).

### 2. The parser — `src/main/transport/inboundMessage.ts`

```ts
function parseResettingPayload(payload: unknown): ResettingPayload
```

Placed directly after `parseCompactingPayload`. Structurally `parseApiRetryPayload` with its two
numbers replaced by two narrowed tokens: an `isRecord` guard throwing
`WireDecodeError('malformed resetting payload')`, `requireString` for `conversation_id`,
`requireBoolean` for `active`, then `parseSessionTransitionPayload`'s `reason` check cloned once per
token — a chain of `!==` comparisons against literals, which covers non-string and unknown-string alike
and narrows without a cast. Returns a fresh four-field literal. No helper is invented.

Four properties in the docblock, each load-bearing for its own reason:

- **`''` is in each comparand chain unconditionally**, per § Design 1. Not `requireString` followed by
  a set check — the chain IS the type check, and a non-string falls out of it for free.
- **`requireBoolean` checks the TYPE, never truthiness.** `active: false` is the entire falling edge;
  a truthiness test reads the one reading that matters most as an absence.
- **No cross-field validation**, stated explicitly so a later reader does not "tighten" it: the
  `parseQueuedItem` posture, and the reason `active:true` with `phase:''` decodes.
- **A fresh literal, never a spread**, so unknown server-added keys (a spurious `turn_id`, a planted
  `__proto__`) are tolerated for forward-compat but not copied — which is also what makes the narrower
  prototype-pollution-safe. **And no table dispatch**: the narrowing compares values and touches no
  prototype chain, which is `decodeHistoryEvent`'s switch-never-a-lookup-table rule one level down.
  Messages name the failure CATEGORY only (`missing required field: phase`), never a value.

### 3. The union arm and the switch case

```ts
| { kind: 'resetting'; resetting: ResettingPayload }
```

placed directly after the `compacting` arm, with the union docblock gaining a paragraph in the file's
per-kind style.

**It does NOT take the `FrameTimestamp` mix-in.** That intersection marks exactly the arms the timeline
draws — those with a matching arm in `decodeHistoryEvent`, which need `(type, ts)` as a live/history
join key. AC5 keeps `decodeHistoryEvent` armless here, so there is no page half for a `ts` to join
against and stamping one would advertise a join nothing can perform. `rate-limited` and
`thinking-progress` are the precedent; the neighbouring `compacting` arm DOES mix it in, which makes it
the wrong half of the family to copy, and the docblock says so.

The `case 'resetting':` arm sits directly after `case 'compacting':` and follows the `rate_limited`
arm's shape: narrow **before** logging so a malformed frame throws first and leaves no record, then one
`inbound-decoded` record whose `code` is the **client-owned string literal** `'resetting'`, carrying
the existing content-free field set (`bytes` = plaintext length, `hash` = the one-way frame digest) and
nothing decoded. No new `DiagnosticEvent` field, so #131's renderer pin is untouched.

### 4. `decodeHistoryEvent` gains no arm (AC5)

Its `default: return null` is what makes a stored `resetting` skip, unchanged. `resetting` is ephemeral
status: no replay ring and no durable history upstream, so there is nothing to draw.

### 5. Comment corrections, and the one false positive

`decodeHistoryEvent`'s docblock enumerates the types its `default` silently covers — "the eight this
client DOES decode on the live lane and never draws in a thread". The list is already one stale
(`context_usage` joined at #1454 without being added) and this change makes it staler. One edit brings
it current: both types added, the count word with them. The same enumeration in the test file's AC3
skip-table comment ("the first nine") moves to ten.

**`UnrecognizedMessagePayload`'s § WHAT THIS CLIENT DECODES is a FALSE POSITIVE and stays untouched.**
Its "six frames above / all six" claim is scoped to the frames the daemon's STREAM PARSER maps from
claude lines. `resetting` is not one of them — it is daemon-driven, emitted by `cmd/pyry`, not
translated from anything claude said — so the claim stays true. Recorded here so the next reader does
not "fix" it. The package overviews under `docs/knowledge/features/` belong to the documentation phase
and are untouched (§ Documentation handoff).

## State + concurrency model

None. A pure synchronous narrowing on an existing call path: no store, no async task, no subscription,
no timer, and therefore no cancellation path to define. The arm ships dormant, so no consumer state
machine changes either.

## Error handling

Unchanged and inherited: every failure is one `WireDecodeError` thrown by the parser, caught by the
existing single `catch` in the transport consumer, which drops the frame without disturbing the
connection. Fail-closed — never a partial value. The frame-level `MAX_PLAINTEXT_BYTES` guard already in
`parseInboundMessage` covers the oversized case; no second cap is invented, since both tokens are
closed sets whose longest member is eleven characters. The throw path is never logged, matching every
sibling arm.

## Testing strategy

Vitest only (node environment). No renderer surface, so no static-render spec; no interaction, so
nothing for the Playwright tier.

`src/shared/wire/types.test.ts` — a `resetting wire vocabulary (#1514)` describe:

- `'resetting'` is assignable to `EnvelopeType` (compile-time membership).
- `ResettingPayload` is exactly its four fields, and carries no `turn_id`.
- The three rising rows the daemon emits are each expressible with the exact token pairing.
- The falling edge is expressible: `active: false` with both tokens `''` — and `''` is admissible for
  each field independently, which is the compile-time half of the trap.

`src/main/transport/inboundMessage.test.ts` — a `RESETTING` fixture (the rising `wrapping_up`/`pending`
row) plus `encodeResetting`, and four describes:

- **Recognition (AC1).** Each of the four wire rows narrows to `{ kind: 'resetting', resetting }`
  carrying all four fields verbatim, driven from an `it.each` table of the daemon's emitted rows plus
  the falling edge; the frame no longer reaches the unmodeled default; the arm carries no `ts`; the
  result holds exactly four keys even when the frame plants extras (fresh-literal pin, AC3).
- **Closed-set pins (AC1/AC2).** `''` decodes for each token independently AND together; `active: true`
  with `phase: ''` decodes (the no-cross-validate pin — the test that reddens if someone later gates
  the token set on `active`); an unknown non-empty token throws for each field.
- **Fail-closed (AC2).** A non-object payload, and each of the four fields absent or mistyped (a
  number, `null`, an object, a non-boolean `active`, a non-string token) each throw `WireDecodeError`.
  Plus the category-only pin: a message carrying neither the conversation id nor either token's value.
- **Diagnostics (AC4).** A decoded frame logs exactly one `inbound-decoded` record with
  `code: 'resetting'` and the exact content-free key set, no `inbound-unmodeled` record, and a line
  containing neither the conversation id nor either token. A malformed frame logs nothing at all.

`decodeHistoryEvent` (same file) — the AC5 pin: `'resetting'` joins the existing `it.each` skip table,
plus one case feeding a **fully well-formed** stored `resetting` that still skips. That second one is
what discriminates: the table row's payload would fail the new parser anyway, so on its own it could
not tell "skipped because the dispatch has no arm" from "skipped because the payload failed" — the
distinction the neighbouring `skips by stored TYPE` test draws, and the shape #1312/#1318/#1454 left.

## Open questions

1. Does the new arm take `FrameTimestamp`? **Resolved in § Design 3 before implementation:** no. The
   neighbouring `compacting` arm takes it, which makes it the wrong half of the family to copy; the
   mix-in marks the arms `decodeHistoryEvent` draws and AC5 keeps this type armless there.
2. Does `''` belong inside `WireResetPhase` / `WireResetHandoff`, or outside as a `| ''`? **Resolved in
   § Design 1:** inside. The type states the wire's accepted value set, and the wire accepts `''` for
   both fields on every frame.
3. Where does the member sit in `EnvelopeType`? **Resolved:** after `'compacting'`, making the
   status-peer run contiguous, with the interface after `CompactingPayload` so the two orders agree.

## Documentation handoff

Owned by the documentation stage, pending: fold this decode into
`docs/knowledge/features/inbound-message-decode.md`, where #1318's own fold landed. Nothing else is
owed — no overview describes a `resetting` consumer, because none exists until #1515. This ticket
writes no file under `docs/knowledge/`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX, and one finding worth naming. The design adds one narrowing at
  the existing untrusted→trusted boundary (`parseInboundMessage`), not a second boundary elsewhere:
  `decodeEnvelope` does the structural narrowing, `parseResettingPayload` the semantic one, in a
  function that either returns a fully-typed value or throws. **The finding is that this frame inverts
  the family's usual hazard.** Every sibling here carries claude-authored open strings and the standing
  rule is "decoding makes the SHAPE trusted, not the CONTENT". Here the content is daemon-authored, so
  both tokens ARE narrowed — and the risk is the mirror image: a closed union is a compile-time
  invitation for #1515 to `switch (phase)` and read the result as settled fact. A narrowed value is
  still a claim by a peer. A hostile daemon can send all sixteen combinations, including the four the
  producer never emits, so the containment recorded in `ResettingPayload`'s docblock is that both
  tokens are a REPORT, never a control input or an authorization signal, and that a consumer must
  handle every combination rather than only the producer's three. SHOULD FIX, recorded for #1515.
- **[Trust boundaries]** No findings on `conversation_id`. A daemon-asserted routing key, not
  cross-checked against a known-conversation set here — the scoping posture #870 settled for
  `modal_shown`: this decoder polices type, not membership. On this leg it reaches no sink at all.
- **[Trust boundaries]** A finding considered and REJECTED: should the parser reject `active: true`
  with `phase: ''`, the pair the producer never emits? **No.** It is cross-field validation in a family
  that refuses it by name, it would be a defence for an unobserved failure mode, and its failure mode
  is the expensive direction — a daemon that adds a phase or reorders its edges would have valid frames
  dropped at the boundary with no diagnostic beyond a generic decode error.
- **[Tokens, secrets, credentials]** Not applicable, and structurally so: the frame carries no token,
  no nonce and no correlation secret. The contrast is `question_shown`, whose `question_batch_id` is an
  unguessable one-time nonce; there is no analogous field here, so the log rule below rests on
  correlation and workflow-disclosure grounds only, never on secrecy.
- **[File / storage operations]** Not applicable, and worth stating rather than skipping BECAUSE this
  frame talks about a file. `handoff: 'written' | 'skipped'` reports whether the daemon wrote a handoff
  document — and the payload deliberately carries **no path, no filename and no handle**, so there is
  nothing for a consumer to `path.join`, resolve, open, render as an `href` or hand to
  `shell.openExternal`. Nothing here touches the filesystem, and no decoded field becomes a path, a
  cache key or a Map key. The token is a three-value status, not a locator.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` API and
  no `ipcMain` handler is added, and the arm is unreachable from the renderer: it stops at the
  transport because `daemonConnection`'s inbound switch has no catch-all and no `assertNever` on the
  union (verified by grep across `src/main/`), so adding a member forces no change there. The wire type
  lands in `src/shared/wire/`, which the renderer may import; that is safe and is what every sibling
  payload does, because it is a type declaration with no runtime value.
- **[Cryptographic primitives]** Not applicable — no key, nonce, handshake or comparison is added. The
  one primitive on the path, the frame digest in `hashPlaintext`, is reused unchanged. The narrowing
  uses plain `!==` against client-owned literals, which is correct here precisely because neither token
  is a secret; `timingSafeEqual` would be cargo-culted.
- **[Network & I/O]** No findings, and one hazard class is structurally ABSENT rather than defended:
  this payload contains no number at all, so `rate_limited`'s "never schedule, allocate or iterate from
  `resets_at`" trap has no subject here. The frame-level `MAX_PLAINTEXT_BYTES` guard already standing
  in `parseInboundMessage` is the size bound; no second cap is invented, because both tokens are closed
  sets whose longest member is eleven characters, so an oversized value cannot survive the narrowing
  regardless.
- **[Error messages, logs, telemetry]** No MUST FIX, and two findings stated honestly rather than
  copied from the sibling. First, the rationale that fits: `rate_limited`'s "unsanitized model text in
  a log" argument does NOT apply — both tokens are daemon constants, not claude's — so the reason
  nothing decoded is logged is the remaining one, that `conversation_id` plus a phase discloses which
  conversation the operator reset and whether a handoff was written, a fact about the operator's
  workflow in a log they may send off-box in a debug bundle. Writing the sibling's reason here would be
  a false claim in a security comment, which is worse than no comment. Second, a residual channel
  accepted without change: the `bytes` field is `plaintext.length`, and `wrapping_up` and `restarting`
  differ in length, so the record weakly discloses the phase even with no decoded field on it. Every
  sibling arm has this property, the record already announces that a reset happened via its
  client-owned `code`, and padding the frame would be a novel defence for an unobserved failure mode.
  The `code` written is a client-owned literal, never `envelope.type` — strictly safer than the
  `default:` arm it replaces for this type, which logged wire-supplied (capped, but peer-controlled)
  text. Narrowing happens before the log call, so a malformed frame leaves no record at all.
- **[Concurrency]** Not applicable, stated rather than assumed: one synchronous pure function plus one
  `switch` case. No task launched, no timer set, no listener registered — nothing to cancel, nothing to
  tear down, no check-then-act window across an `await`.
- **[Threat model alignment]** Addressed. *Hostile daemon response:* the parser is fail-closed on every
  field — a `null`, an array, a number, a missing key, an unknown token all throw rather than yielding
  a partial value, and the fresh-literal return blocks prototype pollution from a planted `__proto__`
  while the comparand chain (never a lookup table) keeps an untrusted string off any prototype chain. A
  hostile daemon's remaining power is to send any of the sixteen combinations; the containment is the
  report-never-a-control-input rule above. *Malicious relay:* on-path but content-blind — it can drop,
  delay, reorder or duplicate. This frame carries no state transition on this leg, so a dropped one
  loses a reading and a duplicated one repeats a value. *Renderer compromise reaching the transport:*
  unchanged, no new renderer-reachable surface. *Token theft from disk:* not applicable, nothing is
  persisted.
- **[Threat model alignment]** OUT OF SCOPE, named rather than silently deferred, all for #1515 and its
  consumers. **The sharpest one is the falling edge that never arrives.** This decoder fixes the
  version of the stuck-indicator bug that it can fix — rejecting `''` would drop every falling edge —
  but it cannot fix the version where a crashed, killed or hostile daemon simply never sends
  `active: false`. A consumer that clears its indicator ONLY on receiving the falling edge will pin it
  on forever, and nothing at this boundary can defend that; #1515's consumer needs an independent
  clearing path (disconnect, conversation exit, turn activity). Also deferred: the wording chosen for
  each phase; whether the never-emitted `active:true`/`phase:''` pair renders as a blank indicator or a
  generic one; and any rate-limiting of a daemon that floods this frame.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-16
