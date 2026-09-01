# 884 — Decode the `question_shown` batch fail-closed into an inbound arm

Ticket: [#884](https://github.com/pyrycode/pyrycode-desktop/issues/884) (split from #849, blocker #883 merged).

## Files read

- `src/main/transport/inboundMessage.ts` → `parseInboundMessage` — the switch whose `default:` arm
  currently swallows `question_shown` into `inbound-unmodeled`; the arm this slice adds sits beside
  `case 'modal_shown'`.
- `src/main/transport/inboundMessage.ts` → `parseModalShownPayload`, `parseModalOption` — the
  structural precedent this slice mirrors at two nesting levels: `isRecord` guard → required strings
  → `Array.isArray` check → `.map(perElementParser)`, category-only messages, unknown keys tolerated
  but not copied.
- `src/main/transport/inboundMessage.ts` → `isRecord`, `requireString`, `requireBoolean`,
  `WireDecodeError` — the shared helpers every reject branch routes through. `requireBoolean`'s
  doc comment already states the rule AC 2 needs: the check is on the TYPE, never truthiness.
- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` — the union the new arm joins.
- `src/shared/wire/types.ts` → `QuestionShownPayload`, `WireQuestion`, `WireQuestionOption` — the
  shape SSOT (#883). Their doc comments carry the per-field provenance this decode is built from.
- `src/main/daemonConnection.ts` → the `switch (inbound.kind)` at its inbound dispatch — verified
  **non-exhaustive** (`default`-terminated), so a new union arm forces no call-site update. The
  emit across IPC is #885.
- `docs/knowledge/features/question-shown-wire-types.md` § "The two caveats a consumer gets wrong by
  default" and § "Bounds — deliberately not modelled" — the pair of sections that read as
  contradicting AC 5; the reconciliation is in **Context** below.
- `docs/knowledge/features/inbound-message-decode-contract.md` — the family's fail-closed posture.
- `~/Workspace/Projects/pyrycode` `internal/protocol/testdata/question_shown{,_empty,_zero}.json` —
  the daemon's own committed encoder output, lifted verbatim as this slice's test fixtures.

## Design source

**Figma:** N/A — transport decode, nothing user-visible. The question panel is a later slice; the
visual-fidelity check is intentionally skipped.

## Context

An inbound `question_shown` frame reaches `parseInboundMessage`, matches no `case`, falls to
`default:`, logs `inbound-unmodeled` and returns `null`. The frame vanishes. #883 landed the wire
vocabulary; this slice adds the validating narrower that turns those bytes into a typed
`InboundDaemonMessage`. It stops at the union arm — IPC carry is #885, and no store consumer lands
here.

**The AC 5 / shipped-docs reconciliation.** Both `WireQuestionOption`'s neighbourhood in
`src/shared/wire/types.ts` and `question-shown-wire-types.md` § "The two caveats" say an over-long
field "must be a fail-closed **reject** for the decode slice rather than a silent trim." That
sentence chooses between two wrong behaviours *if* a bound ever becomes enforceable. It introduces
no threshold, because none exists: both documents state a few lines later, under § "Bounds —
deliberately not modelled", that the daemon enforces no maximum length on any of the four strings as
of 2026-09-01, and that the `header` cap is documented 12 but observed 14 runes — a client rejecting
at 12 would reject the one real header ever captured. The operative half of the caveat here is the
negative one: **never silently trim.** Copying verbatim satisfies it. This slice adds no length
check, no max constant, and no truncation.

**No ADR is warranted.** This slice makes no desktop-side architectural choice of its own — it
applies `parseModalShownPayload`'s settled posture to a second frame family. The documentation phase
should fold its lessons into a package overview rather than open a decision record.

## Design

Three parsers, bottom-up, each private to `inboundMessage.ts`, each mirroring `parseModalOption` /
`parseModalShownPayload` in posture and message discipline:

```ts
function parseQuestionOption(payload: unknown): WireQuestionOption
function parseQuestion(payload: unknown): WireQuestion
function parseQuestionShownPayload(payload: unknown): QuestionShownPayload
```

Each returns a **fresh object holding exactly the known keys**. Unknown server-added keys are
tolerated (forward-compat) but not copied — the `parseModalOption` rule, and it also stops an
array-borne or object-borne extra property riding into a consumer.

`parseQuestionOption`: `isRecord` guard, then `requireString` on `label` and `description`.

`parseQuestion`: `isRecord` guard, `requireString` on `question` and `header`, `Array.isArray` check
on `options` then `.map(parseQuestionOption)`, and `requireBoolean` on `multi_select`. The boolean
is the family's only one, and `requireBoolean` already checks `typeof === 'boolean'`, so the string
`"false"` fails closed rather than decoding as `true` (AC 2).

`parseQuestionShownPayload`: `isRecord` guard, `requireString` on `conversation_id` and
`question_batch_id`, `Array.isArray` check on `questions` then `.map(parseQuestion)`.

**The nesting is the one thing a reader pattern-matching off the modal family gets wrong**:
`options` hangs off each question, not off the payload. A comment on `parseQuestion` says so.

New union member on `InboundDaemonMessage`:

```ts
| { kind: 'question-shown'; questionShown: QuestionShownPayload }
```

New `case 'question_shown':` beside `case 'modal_shown':`, following the arm's established order —
**narrow first, log second, return third** — so a malformed frame throws before it leaves any record.

Import: add `QuestionShownPayload`, `WireQuestion`, `WireQuestionOption` to the existing
`import type { … } from '../../shared/wire/types'` block.

**Allocation is from what arrived, never from a claimed count.** `.map` over the array the frame
actually carried is what makes that true; there is no count field in this shape to trust, and the
batch stays bounded by the codec's existing `MAX_PLAINTEXT_BYTES` guard at the top of
`parseInboundMessage`. Nothing here adds a bound; it relies on the absence of a trusted one.

## State + concurrency model

None. `parseInboundMessage` is a pure synchronous function over a byte array — no store slice, no
async task, no stream, no subscription, nothing to cancel or tear down. The decoded value is
returned to `daemonConnection.ts`'s existing inbound loop, whose lifecycle this slice does not touch.

## Error handling

`WireDecodeError` at every reject, thrown from `isRecord`/`Array.isArray` guards this slice writes
or from the shared `requireString` / `requireBoolean` helpers. One failure type, so the consumer's
existing single `catch` in `daemonConnection.ts` covers it unchanged — no new result type and no new
error class.

**Twelve reject branches**, all fail-closed, none partial:

| Level | Branch |
|---|---|
| payload | non-record; non-string `conversation_id`; non-string `question_batch_id`; non-array `questions` |
| question | non-record; non-string `question`; non-string `header`; non-array `options`; non-boolean `multi_select` |
| option | non-record; non-string `label`; non-string `description` |

One malformed option throws the **whole batch** closed rather than dropping that option — the
`parseModalOption` posture, propagated by `.map` (AC 2). An empty `questions` or `options` array
decodes without throwing: out of contract daemon-side and a producer bug, but this decoder polices
type, not membership, and a client must not crash on one (AC 3).

**Message discipline.** Every message names the failure **category** only. `requireString` /
`requireBoolean` emit `missing required field: <field>` — a wire key, never a value. The three
guards this slice writes emit fixed strings (`malformed question_shown payload`, `malformed
question`, `malformed question options`, `malformed questions`). No message interpolates
`question`, `header`, `label`, `description`, `conversation_id` or `question_batch_id` (AC 4): the
four strings are untrusted claude-authored text, `conversation_id` is a routing key and
`question_batch_id` is an unguessable nonce.

The throw path is never logged, matching the file's existing rule. The success path logs the
existing content-free field set — `event`, `code: 'question_shown'`, `bytes`, `hash` — and no
decoded field (AC 4).

## Testing strategy

All vitest, in the existing `src/main/transport/inboundMessage.test.ts`, following the file's own
block layout: a `recognition (#884, additive)` describe, a `fail-closed (#884)` describe, plus
additions to the existing content-free-log and secret-safety describes. No renderer surface, no
Playwright spec — this slice has no interaction to drive.

**Fixtures lifted verbatim from the daemon's own committed encoder output** (`question_shown.json`,
`_empty`, `_zero` under the upstream `internal/protocol/testdata/`), as #883 did, so a contract
change surfaces as a fixture diff rather than a disagreement between two hand-written guesses. A
module-level `QUESTION_SHOWN` constant plus an `encodeQuestionShown` helper mirroring
`encodeModalShown`.

Scenarios:

- A full two-question batch decodes to `{ kind: 'question-shown', questionShown }` carrying every
  field verbatim, nested options in wire order, `multi_select` both `false` and `true` (AC 1).
- It no longer reaches the `inbound-unmodeled` arm — asserted on the log record's `event`/`code`,
  which is what actually distinguishes decoded from swallowed (AC 1).
- Empty `questions` decodes to `{ questions: [] }`; empty `options` on a question decodes likewise
  (AC 3).
- The all-zero fixture decodes — every string empty is a valid value, not an absence.
- Each of the twelve reject branches throws `WireDecodeError`, grouped into `bad: unknown[]` tables
  per level in the file's existing idiom, with absent / wrong-type variants per field.
- `multi_select: "false"` and `multi_select: "true"` (strings), `0`, `1`, `null` each throw — the
  real-boolean check, the branch a truthiness test would pass green while broken (AC 2).
- One malformed option inside an otherwise-valid batch throws the whole batch closed; one malformed
  question likewise (AC 2).
- Unknown extra keys at all three levels are tolerated and **not copied** — asserted by exact
  `toEqual`, which is what catches a spread-through.
- A 10 000-character `question` and a 40-rune `header` both decode **verbatim and untruncated**,
  with an exact length assertion (AC 5). This is the test that would pass green while broken if
  written as a plain decode assertion, so it pins the length explicitly.
- Content-free log: exactly `['bytes', 'code', 'event', 'hash', 'seq', 'ts']`, and the six sensitive
  values planted as distinctive sentinels are absent from the emitted line (AC 4).
- No log line on any throw path.
- Secret-safety: a malformed frame whose *valid* sibling fields carry sentinel values throws a
  message containing none of them (AC 4).

## Open questions

1. **Does `parseQuestion`'s `options` guard need a message distinct from `parseQuestionShownPayload`'s
   `questions` guard?** Two array checks at two levels; a shared string would make a decode failure
   ambiguous in a log-free path where the message is the only signal. Leaning distinct
   (`malformed question options` vs `malformed questions`), since both name a wire key and neither
   echoes a value. Resolve while writing the parsers.
2. **Does the `header`-length test belong here or is it over-specifying?** AC 5 makes "no
   truncation" a stated deliverable, and the two shipped documents read as requiring the opposite,
   so a test is the durable record of which reading shipped. Keeping it.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** SHOULD FIX — the decode makes the *shape* trusted while the four strings
  stay untrusted claude-authored text, and the type system carries no signal for that (`string` is
  `string`; there is no branded type). Nothing is exploitable today because this slice hands the
  value to no consumer, but #885 reads this arm as its input and must not read "decoded" as
  "sanitized". Phase B: the switch arm's comment states the provenance explicitly, exactly as the
  `modal_shown` arm's comment does for `title` / `prompt` / `options[].label`. The verifier should
  check it landed.
- **[Tokens, secrets]** No findings — `question_batch_id` is the unguessable one-time nonce here. It
  never reaches a log (the arm emits the fixed content-free field set, pinned by a test asserting
  the exact key set *and* the sentinel's absence from the emitted line) and never reaches an error
  message (`requireString` emits the field **name**, not its value). No comparison against it
  happens in this slice; the answer path is upstream pyrycode#1907.
- **[File / storage]** N/A by design — a pure in-memory decode over a byte array. No path is
  constructed, no `fs` call, no write, nothing reaches `userData`. No traversal or TOCTOU surface
  exists to reason about.
- **[Electron attack surface]** No findings, one of them **verified rather than assumed**:
  `daemonConnection.ts`'s `switch (inbound.kind)` has **no `default:` arm** and no `assertNever`
  (the `modal-shown` arm's own comment records the latter). A newly-added union member is therefore
  decoded and then silently ignored, not forwarded by a generic catch-all — so adding this arm
  cannot leak the batch across IPC ahead of #885. Had that switch carried a forwarding default, this
  would have been a MUST FIX. `inboundMessage.ts` stays main-process-only per its header rule; this
  slice adds no `contextBridge` API, no `ipcMain` channel, and touches no window config.
- **[Cryptographic primitives]** N/A — none introduced. The BLAKE2s `hashPlaintext` in the log call
  is pre-existing and reused unchanged; no RNG, no key, no nonce, no secret comparison. (#883's note
  that `question_batch_id` wants plain `===` over `timingSafeEqual` governs the eventual
  answer/dismissal path, not this one.)
- **[Network & I/O]** No findings — memory exhaustion from a hostile or buggy producer is the
  applicable threat, and it is bounded upstream: `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` guard
  is the function's first statement and runs **before** `decodeEnvelope` does the parse (verified in
  the source, not inferred from its comment). The decode then allocates only from what arrived —
  `.map` over the parsed arrays, never from a claimed count, and this shape carries no count field
  to trust. No amplification: each element is visited once and the two levels nest rather than
  cross-product, so an N-byte frame yields O(N) objects.
- **[Errors, logs, telemetry]** No findings, and this is the category the slice mostly *is*. Messages
  name the failure category only; the shared helpers emit a wire key, never a value; the three
  guards emit fixed strings. This reaches past this file: `daemonConnection.ts` catches
  `WireDecodeError`, so a value interpolated into a message could ride into a caller's log — the
  discipline is what makes that safe, and the secret-safety test pins it. Strictly *safer* than the
  status quo in one respect: the `default:` arm logs `envelope.type.slice(0, MAX_LOGGED_TYPE_CHARS)`,
  a wire-supplied string, whereas the new case logs the static literal `'question_shown'`.
  Narrow-before-log ordering keeps the throw path unlogged, pinned by test.
- **[Concurrency]** N/A — `parseInboundMessage` is pure and synchronous. No `await`, no timer, no
  listener, no shared mutable state; each parser returns a fresh object, so there is no cross-call
  aliasing and nothing to cancel or tear down.
- **[Threat model alignment]** **Hostile daemon response** is the threat this slice exists to answer,
  and after it every field on the frame is checked. **Malicious / compromised relay:** content-blind
  but on-path — a flooded batch is bounded by the frame cap above, and a *dropped* one is the
  residual cost. That cost is a chosen tradeoff rather than an oversight: a rejected batch parks the
  session (claude waits on an answer the operator never sees), which #883 records as the price of the
  all-required mirror, and widening it would be a coordinated change with the daemon. **Renderer
  compromise reaching the transport:** unchanged — nothing crosses to the renderer in this slice.
  OUT OF SCOPE, named: the IPC carry and the renderer's escaping/render boundary (#885 and its
  consumer); the outbound answer verb (upstream pyrycode#1907); `question_dismissed`
  (pyrycode#1974, sibling slice).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-01
