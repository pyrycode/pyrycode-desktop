# 894 — Model `question_dismissed` and decode it fail-closed into an inbound arm

Ticket: [#894](https://github.com/pyrycode/pyrycode-desktop/issues/894) (split from #886; chain
`894 → 886 → 849`).

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` — the open union the new member joins, beside
  `'question_shown'`.
- `src/shared/wire/types.ts` → `ModalDismissedPayload`, `WireModalSource` — the nearest precedent.
  Its **structure** is what this slice copies; its closed `source` type is what it must not.
- `src/shared/wire/types.ts` → `QuestionShownPayload` — the sibling frame this one retires, and the
  family's provenance conventions. Its `question_batch_id` paragraph is the nonce's SSOT.
- `src/main/transport/inboundMessage.ts` → `parseModalDismissedPayload` — the flat three-field
  narrower this one mirrors minus the closed-enum check.
- `src/main/transport/inboundMessage.ts` → `parseQuestionShownPayload`, `parseInboundMessage`,
  `isRecord`, `requireString`, `WireDecodeError`, `InboundDaemonMessage` — the switch whose
  `default:` arm currently swallows this frame, the shared helpers, and the union the arm joins.
- `src/main/daemonConnection.ts` → the `switch (inbound.kind)` at its inbound dispatch — re-verified
  **non-exhaustive** for this tree: the file's only `default:` is in an unrelated earlier switch, and
  there is no `assertNever`. A new union member forces no call-site update and cannot leak across IPC
  ahead of #895.
- `docs/knowledge/features/question-shown-wire-types.md` § "No `question_dismissed`" and § "Edge
  cases and limitations" — the sibling's own note that this frame was left to a later slice, plus the
  two lessons that govern it: `question_batch_id` comparisons want plain `===` rather than
  `timingSafeEqual`, and the `EnvelopeType` membership test in `types.test.ts` is what catches a
  dropped member, since a decode/re-encode round trip passes silently on an unknown string.
- `docs/knowledge/features/inbound-message-decode-contract.md` — the family's fail-closed posture and
  the `InboundDaemonMessage` additive-extension convention.
- `~/Workspace/Projects/pyrycode` at `b62ca3b4` — the Go source, read rather than reasoned from the
  doc: `internal/protocol/codes.go` `TypeQuestionDismissed` (and the doc block above it carrying the
  per-value carry-over reading), `internal/protocol/questions.go` `QuestionDismissedPayload`,
  `cmd/pyry/modal_resolve_v2.go` `retireQuestion` (the sole emit site) and the
  `outcomeQuestionUnanswered` / `sourceQuestionNoAnswer` constants beside it,
  `docs/protocol-mobile.md` § Question (v2) → `question_dismissed`.
- `~/Workspace/Projects/pyrycode` `internal/protocol/testdata/question_dismissed.json` — read
  precisely to confirm it is **not** usable as a value fixture; see **Context**.

## Design source

**Figma:** N/A — a wire type plus a main-process decode. Nothing is rendered, so the visual-fidelity
check is intentionally skipped. The question panel that will eventually consume this is a later
slice.

## Context

A well-formed `question_dismissed` frame reaches `parseInboundMessage`, matches no `case`, falls to
`default:`, logs `inbound-unmodeled` and returns `null`. Nothing downstream can ever learn that a
batch was resolved, timed out, or died with its caller. This slice adds the wire vocabulary and the
validating narrower that turn those bytes into a typed `InboundDaemonMessage`. It stops at the union
arm — the IPC carry is #895, and matching a dismissal to a held batch is #850's.

**The upstream fixture is a trap, and this is the one place a careful implementer goes wrong.**
`internal/protocol/testdata/question_dismissed.json` carries `source: "timeout"`. It is a *shape*
fixture from the declaring slice (pyrycode#1974), minted before any producer existed, and its value
is contradicted by the landed producer: `retireQuestion` emits the compile-time constants
`outcomeQuestionUnanswered` / `sourceQuestionNoAnswer` — `"unanswered"` and `"no_answer"` — on every
one of its three terminal paths. So this slice lifts the fixture's *keys* and writes its own
*values*, which inverts #883/#884's "lift the daemon's committed output verbatim" habit. The
inversion is deliberate and is the reason a local fixture is hand-written here.

**`source` must not be closed to `WireModalSource`.** Two of the producer's three terminal paths — a
caller disconnect and a daemon shutdown — have no member in `{remote, local, timeout}` at all, and
the arbiter is a single closure the control server defers on every `Await` return, so it cannot tell
the three apart. Closing the enum would reject the only traffic that actually exists. Nothing emits
`timeout`, `remote` or `local`: the latter two belong to the not-yet-landed answer half
(pyrycode#1907).

**No ADR is warranted.** This slice makes no desktop-side architectural choice of its own — it
applies `parseModalDismissedPayload`'s settled posture to a second frame family, minus one check.
The documentation phase should fold its lessons into a package overview rather than open a decision
record.

## Design

**`src/shared/wire/types.ts`.** One new `EnvelopeType` member, `'question_dismissed'`, placed
immediately after `'question_shown'` so the family reads together, with a comment recording that it
is its own type rather than a reused `modal_dismissed` and why. One new interface, placed after
`QuestionShownPayload` — the `ModalShownPayload` → `ModalDismissedPayload` ordering, mirrored:

```ts
export interface QuestionDismissedPayload {
  question_batch_id: string
  outcome: string
  source: string
}
```

Three required strings, wire order, no `omitempty` upstream so no optional key. **No
`conversation_id`** — the batch nonce is the sole correlation key, and a shape carrying both would
admit a disagreeing pair someone has to adjudicate.

Its doc comment carries three things the type itself cannot: that `source` is deliberately a plain
string rather than `WireModalSource` and the fail-closed reading rule that follows from it (an
unrecognised value means *resolved, cause unknown*, and **never** an answer, because reading it as an
answer renders a daemon safe-deny as the operator's own choice); that `outcome` is an opaque
producer-defined sentinel that never carries a claude-authored option label, which is why this frame
— unlike the batch — carries no claude-authored byte at all and sits at a different trust tier from
its sibling; and that `question_batch_id` is the batch's own unguessable nonce echoed back, dead once
this frame lands, whose receipt is not a capability.

**`src/main/transport/inboundMessage.ts`.** One private narrower mirroring
`parseModalDismissedPayload` with the closed-enum check replaced by a third `requireString`:

```ts
function parseQuestionDismissedPayload(payload: unknown): QuestionDismissedPayload
```

`isRecord` guard throwing `malformed question_dismissed payload`, then `requireString` on
`question_batch_id`, `outcome` and `source`. Returns a **fresh object holding exactly the three known
keys** — unknown server-added keys are tolerated (forward-compat) but not copied, which is also what
keeps a stray `conversation_id` from riding into a consumer that would then have two disagreeing
correlation keys.

One new `InboundDaemonMessage` member:

```ts
| { kind: 'question-dismissed'; questionDismissed: QuestionDismissedPayload }
```

One new `case 'question_dismissed':` beside `case 'question_shown':`, following the arm's established
order — **narrow first, log second, return third** — so a malformed frame throws before it leaves any
record. Import: add `QuestionDismissedPayload` to the existing `import type { … } from
'../../shared/wire/types'` block.

## State + concurrency model

None. `parseInboundMessage` is a pure synchronous function over a byte array — no store slice, no
async task, no stream, no subscription, nothing to cancel or tear down. The decoded value returns to
`daemonConnection.ts`'s existing inbound loop, whose lifecycle this slice does not touch.

## Error handling

`WireDecodeError` at every reject, thrown from the `isRecord` guard this slice writes or from the
shared `requireString`. One failure type, so the consumer's existing single `catch` covers it
unchanged — no new result type and no new error class.

**Four reject branches**, all fail-closed, none partial: a non-record payload, and a missing or
non-string `question_batch_id` / `outcome` / `source`. Flat, one level, no `.map` and no nesting —
the sibling batch's twelve branches across three levels do not transfer.

**No value is enum-checked.** `outcome` and `source` are both carried verbatim. That is the whole
difference from `parseModalDismissedPayload`, and the comment says so at the code site so a later
reader tightening the two files toward each other does not "fix" it.

**Message discipline.** Every message names the failure **category** only. `requireString` emits
`missing required field: <field>` — a wire key, never a value. The one guard this slice writes emits
the fixed string `malformed question_dismissed payload`. No message interpolates `question_batch_id`
(an unguessable nonce) or `outcome` / `source` (producer sentinels that are not secret but have no
business in an error a caller may log).

The throw path is never logged, matching the file's existing rule. The success path logs the
established content-free field set — `event: 'inbound-decoded'`, `code: 'question_dismissed'`,
`bytes`, `hash` — and no decoded field.

## Testing strategy

All vitest; no renderer surface and no interaction, so no Playwright spec.

`src/main/transport/inboundMessage.test.ts`, following the file's own block layout: an
`encodeQuestionDismissed` helper beside `encodeQuestionShown`, a `QUESTION_DISMISSED` fixture, a
`recognition (#894, additive)` describe, a `fail-closed (#894)` describe, plus additions to the
existing content-free-log and secret-safety describes.

The fixture carries the **producer's** pair, not the upstream fixture's: `{ question_batch_id:
'qb-7f3a', outcome: 'unanswered', source: 'no_answer' }`. Its three values are **pairwise distinct on
purpose** — `outcome` and `source` are both plain `string`, so a transposition between them is
invisible to `tsc` and only an exact `toEqual` over distinct values catches it. Upstream reached the
same conclusion about its own fixture for the same reason.

Scenarios:

- A full frame decodes to `{ kind: 'question-dismissed', questionDismissed }` carrying all three
  fields verbatim (AC 1, AC 4).
- `source: 'no_answer'` decodes — the live producer's value, which `WireModalSource` would reject.
  Asserted alongside `'timeout'`, `'remote'`, `'local'` and an arbitrary unknown string, all of which
  decode identically: the test that would go red if someone later closed the enum (AC 2).
- `outcome` carries an arbitrary sentinel verbatim, never enum-checked.
- It no longer reaches the `inbound-unmodeled` arm — asserted on the log record's `event`/`code`,
  which is what actually distinguishes decoded from swallowed (AC 4).
- Unknown extra keys are tolerated and **not copied**, with `conversation_id` as the planted extra —
  the sharpest available pin on the deliberate absence, and the `modal_dismissed` block's own idiom
  (AC 1).
- Empty strings decode as values, not absences.
- Each of the four reject branches throws `WireDecodeError`, in the file's `bad: unknown[]` table
  idiom, with absent and wrong-type variants per field (AC 3).
- Content-free log: exactly `['bytes', 'code', 'event', 'hash', 'seq', 'ts']`, and three distinctive
  sentinel values absent from the emitted line (AC 4).
- No log line on the throw path.
- Secret-safety: a malformed frame whose *valid* sibling fields carry sentinels throws a message
  containing none of them (AC 3).

`src/shared/wire/types.test.ts`, a small `question_dismissed wire vocabulary (#894)` block: the
`EnvelopeType` membership assertion and an exact-shape `toEqual` on a typed literal. This is not
redundant with the decode tests — see Open question 2.

## Open questions

1. **Should this slice export a `no_answer` constant for the consuming slice, or stay purely
   structural?** The AC says *recognise `no_answer`, do not enforce it*, and nothing in a decoder
   branches on `source`. Leaning purely structural: publishing a vocabulary constant from a slice
   that has no consumer would decide a consumer-facing API on #850's behalf, and the doc comment
   records the vocabulary durably either way. Resolve while writing the narrower.
2. **Is the `types.test.ts` block redundant, given `tsc` on `inboundMessage.ts` already forces
   `QuestionDismissedPayload` to exist?** For the interface, largely yes. For the `EnvelopeType`
   member, no: `Envelope.type` is `EnvelopeType | string`, so `case 'question_dismissed':` compiles
   green whether or not the member was ever added, and the membership assertion is the only thing
   that catches a dropped one — the gap the question-shown overview names. Leaning keep, narrowed to
   membership plus one shape assertion.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** SHOULD FIX, and it is this slice's sharpest finding — **the frame's
  "daemon-asserted" provenance is a contract the honest producer keeps, not a property this decode
  verifies, and the plan as first written risked encoding the former as the latter.** The published
  contract says all three fields are daemon-asserted and that `outcome` never carries a
  claude-authored option label; a consumer reading that as "so this text is safe to render as trusted
  chrome" would be exactly wrong, because the only thing checked at this boundary is `typeof ===
  'string'`. A compromised daemon, or anything impersonating it inside the Noise session, puts
  whatever it likes in `outcome` and `source` — including a claude-authored label, and including
  ~65 KB of it, since the open vocabulary the contract mandates leaves no length bound to enforce
  here. The type system carries no signal for this (`string` is `string`; there is no branded type).
  Nothing is exploitable today because this slice hands the value to no consumer. Phase B: the switch
  arm's comment must state that the provenance is the producer's promise rather than a checked
  property, that `outcome` and `source` are unbounded producer-controlled strings, and that the
  escaping and length-bounding boundary is the eventual render slice's — exactly as the
  `question_shown` arm's comment does for its four claude-authored strings. #895 reads this arm as
  its input and must not read "decoded" as "sanitized". The verifier should check it landed.
- **[Tokens, secrets]** No findings. `question_batch_id` is the unguessable one-time nonce. It never
  reaches a log (the arm emits the fixed content-free field set, pinned by a test asserting the exact
  key set *and* the sentinel's absence from the emitted line) and never reaches an error message
  (`requireString` emits the field **name**, not its value). No token is minted, stored, rotated or
  compared in this slice. Receiving the nonce is **not a capability** and disclosure widens nothing:
  upstream's own reasoning is that the nonce is dead once this frame lands — a retired batch resolves
  nothing server-side, the way a stale `modal_id` resolves nothing under first-answer-wins — and it
  is echoed to exactly the capability-gated audience that already received it on `question_shown`.
- **[File / storage]** N/A by design — a pure in-memory decode over a byte array. No path is
  constructed, no `fs` call, no write, nothing reaches `userData`. No traversal or TOCTOU surface
  exists to reason about.
- **[Electron attack surface]** No findings, and the load-bearing one is **verified rather than
  assumed**: `daemonConnection.ts`'s `switch (inbound.kind)` has **no `default:` arm** and no
  `assertNever` — the file's only `default:` belongs to an earlier, unrelated switch. A newly-added
  union member is therefore decoded and then silently ignored, not forwarded by a generic catch-all,
  so adding this arm cannot leak the dismissal across IPC ahead of #895. Had that switch carried a
  forwarding default, this would have been a MUST FIX. `inboundMessage.ts` stays main-process-only
  per its header rule; this slice adds no `contextBridge` API, no `ipcMain` channel, and touches no
  window config.
- **[Cryptographic primitives]** N/A — none introduced. The BLAKE2s `hashPlaintext` in the log call
  is pre-existing and reused unchanged; no RNG, no key, no nonce minted, no secret comparison. The
  eventual match of a dismissal against a held batch wants plain `===` rather than
  `crypto.timingSafeEqual` — a local routing decision between two values the client already holds,
  not a secret compared against an attacker's guess — but that path is #850's, not this one's.
- **[Network & I/O]** No findings, and this arm is the **least** amplifying in the family. Memory
  exhaustion from a hostile or buggy producer is the applicable threat and it is bounded upstream:
  `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` guard is the function's first statement and runs
  **before** `decodeEnvelope` parses (verified in the source, not inferred from its comment). Unlike
  the sibling batch, this shape is flat with three scalar strings and no array at all — no `.map`, no
  per-element allocation, no nesting, no count field to trust. The decode allocates one object
  holding three references into the already-parsed JSON, so it is O(1) beyond the parse.
- **[Errors, logs, telemetry]** No findings, and this is the category the slice mostly *is*. The one
  guard emits a fixed string; `requireString` emits a wire key, never a value; nothing interpolates
  the nonce or either sentinel. This reaches past this file — `daemonConnection.ts` catches
  `WireDecodeError`, so a value interpolated into a message could ride into a caller's log — and the
  secret-safety test pins it. Strictly *safer* than the status quo in one respect: the `default:` arm
  this replaces for the type logs `envelope.type.slice(0, MAX_LOGGED_TYPE_CHARS)`, a wire-supplied
  string, whereas the new case logs the static literal `'question_dismissed'`. The frame's log record
  moves from `inbound-unmodeled` to `inbound-decoded`, which the operator-shareable debug bundle
  carries; the field set is unchanged and content-free, so that move discloses nothing new.
  Narrow-before-log ordering keeps the throw path unlogged, pinned by test.
- **[Concurrency]** N/A — `parseInboundMessage` is pure and synchronous. No `await`, no timer, no
  listener, no shared mutable state; the parser returns a fresh object, so there is no cross-call
  aliasing and nothing to cancel or tear down.
- **[Threat model alignment]** **Hostile daemon response** is the threat this slice exists to answer,
  and after it all three fields are type-checked; the residual — unconstrained *values* — is not
  fixable here without rejecting the only traffic that exists, which is what the trust-boundary
  finding above exists to carry forward. **Malicious / compromised relay:** content-blind and inside
  the Noise session, so it can neither read nor forge this frame; it can *drop* one, and the residual
  cost is a later slice's panel staying up on a batch that is already dead. That cost is bounded
  rather than open-ended, and the bound is upstream's: a retired batch resolves nothing server-side,
  so a stale panel is a UI-staleness cost and not a security one. **Renderer compromise reaching the
  transport:** unchanged — nothing crosses to the renderer in this slice. **Token theft from disk:**
  N/A, nothing is stored. OUT OF SCOPE, named: the IPC carry and the renderer's escaping and
  length-bounding boundary (#895 and its consumer); matching a dismissal to a held batch, including
  the plain-`===` note above (#850); the outbound answer verb and its `remote` / `local` sources
  (upstream pyrycode#1907).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-01

## Revisions

### 2026-09-01 — Open questions resolved, and the size actual against the plan's own estimate

**Open question 1 — export a `no_answer` constant, or stay purely structural: resolved purely
structural**, as the plan leaned. Nothing is exported. The live vocabulary lives in
`QuestionDismissedPayload`'s doc comment, in `parseQuestionDismissedPayload`'s, and in the
`QUESTION_DISMISSED` test fixture's — three places a later reader lands, none of them a consumer-facing
API this slice has no consumer to decide for. The decode branches on nothing, which is the point: it
polices type, and the fail-closed *reading* rule is #850's to enforce. No design change.

**Open question 2 — keep the `types.test.ts` block: kept**, as the plan leaned, and the RED settled the
argument empirically rather than by reasoning. With `QuestionDismissedPayload` and the `EnvelopeType`
member both absent, `npx vitest run src/shared/wire/types.test.ts` reported **87 passed** — the file
imports these with `import type`, which vitest erases and never typechecks, so every runtime assertion
in the new block passed green against types that did not exist. `npm run typecheck` produced the two
real errors (`no exported member 'QuestionDismissedPayload'`, and `'question_dismissed' is not
assignable to type 'EnvelopeType'`). That is the #883 finding reproduced exactly, and it is the reason
the membership assertion earns its place: it is `tsc`-only evidence, invisible to the test runner.
No design change.

**Size: the estimate held, unusually.** Planned ~450 lines of total written work; actual **697** — 130
production (72 `types.ts`, 58 `inboundMessage.ts`), 275 test (222 `inboundMessage.test.ts`, 53
`types.test.ts`), 292 plan. Both boundaries the ticket cared about held: 2 production files, 0 consumer
call sites, 4 reject branches. The overshoot is entirely in the two halves that are always
under-counted and were under-counted again here — doc comment and plan prose. Of the 130 production
lines, roughly 95 are comment: the *why* behind the open `source` is the whole deliverable of the type
half, and recording it at the code site is what stops a later reader tightening the new narrower toward
its modal twin. The plan itself ran 292 against ~150 planned, most of it the security review the
`security-sensitive` label mandates.

That confirms rather than weakens the `needs-human:sizing` marker filed at the start: 697 against a
400-line boundary, on a ticket whose refiner estimate was ~250. The finding stands unchanged — the only
available cut (wire vocabulary, then decode) manufactures a child whose sole consumer is its sibling,
which the floor rule forbids, so this slice is simply larger than the size-S envelope rather than
mis-split.
