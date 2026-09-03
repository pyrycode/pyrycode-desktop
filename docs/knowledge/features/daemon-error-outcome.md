# Daemon error outcome — narrowing `daemon-error` onto client-owned reject codes

The **reject** half of the attachment upload leg's wire contract — the counterpart to
[Attachment-stored wire types](attachment-stored-wire-types.md)'s positive terminal. Where that
document is the one `attachment_stored` success reply, this one is the six ways an `error` envelope can
terminate the same transfer, each mapped onto a client-owned value at the decode boundary.

Introduced in [#965](https://github.com/pyrycode/pyrycode-desktop/issues/965), split from #961, unblocked
by [Attachment-stored wire types](attachment-stored-wire-types.md) (#964, which built the fake daemon's
chunk-answering scaffolding this ticket extends). SSOT re-verified 2026-09-03 in `pyrycode`:
`internal/protocol/codes.go` (`CodeAttachmentInvalidChunk` … `CodeAttachmentStorageFailed`,
`CodeMessageTooLong`) and the emit table at `internal/relay/v2session_attachment.go`
(`attachmentReplyError` marshals a closed `{Code, Message, Retryable}` literal; the `rejectInvalidChunk`
… `rejectStorageFailed` retryable flags are `false, false, false, true, true`, read off that table rather
than inferred from the code names).

## What it does

`ErrorPayload` (`src/shared/wire/types.ts`) has been modelled since [#116](../codebase/116.md) but never
read — `parseInboundMessage`'s `error` arm has always returned `{ kind: 'daemon-error', inReplyTo }` and
nothing else, a deliberate, absolute invariant. The attachment upload leg is the first caller that
genuinely needs the code: its six reject codes mean six different things to a client, and "something
failed" is not a reason anyone can act on. So the invariant becomes **scoped** rather than absolute —
narrowed for the codes this leg names, still closed for everything else.

| Wire code | `DaemonErrorOutcome` | Retryable | What it means to a client |
|---|---|---|---|
| `attachment.invalid_chunk` | `attachment-invalid-chunk` | no | Framing claims are inconsistent (duplicate index, index out of range, disagreeing `total_chunks`). The receiver discards the whole in-flight stream; repair by re-chunking. |
| `attachment.integrity_failed` | `attachment-integrity-failed` | no | Assembled bytes or length disagree with the declared `sha256`/`size`. Repair by re-deriving the metadata from the file, never by retrying the same bytes against the same claims. |
| `attachment.too_large` | `attachment-too-large` | no | The **whole transfer** exceeds the receiver's per-upload byte bound — permanent for that file, distinct from `message-too-long`. |
| `attachment.too_many_uploads` | `attachment-too-many-uploads` | after a backoff | The receiver's concurrency bound is hit; clears only when *other* uploads finish. |
| `attachment.storage_failed` | `attachment-storage-failed` | after a backoff | The host write failed. Static daemon message, never a path or filesystem error; the condition may not clear at all. |
| `message.too_long` | `message-too-long` | no | **One envelope** was oversized — a producer bug on this side, raised by the transport rather than the attachment path. |
| anything else, or an unparseable payload | `unclassified` | — | This client declined to classify the failure. |

`attachment.not_found` and `attachment.stream_aborted` exist upstream but are **deliberately absent** —
both belong to the retrieval direction (#687), not this upload leg, and modelling them here would assert
a contract this leg does not have. The per-upload byte bound and the concurrency bound are
receiver-configured and unpublished: a client learns them only by being rejected.

**`message.too_long` has no known upstream emit site.** `CodeMessageTooLong` is declared in
`codes.go` but nothing in the Go tree sends it (checked 2026-09-03) — the mapping does not depend on
that; the `switch` keys on the code string wherever it originates.

## How it works

### The outcome type is the trust boundary, by construction

```ts
// src/main/transport/inboundMessage.ts
export type DaemonErrorOutcome =
  | 'attachment-invalid-chunk'
  | 'attachment-integrity-failed'
  | 'attachment-too-large'
  | 'attachment-too-many-uploads'
  | 'attachment-storage-failed'
  | 'message-too-long'
  | 'unclassified'
```

Every inhabitant is a literal written in this file, so the type itself is the trust signal: a value of
this type provably holds no daemon text. `ErrorPayload.code` is untrusted text from an internet-exposed
boundary, and per `CLAUDE.md` it may never become a lookup path, a filename or a cache key — so it is
compared against these constants and dropped, never carried.

**Retryability is documented on each member's docblock, not computed.** No `isRetryable` helper ships.
`retry_after_s` is never sent on this leg (`attachmentReplyError`'s literal is closed over three fields;
the field is `*int,omitempty`), so a client cannot learn a backoff duration from the wire — "after a
backoff" is **client-owned policy**, and policy belongs to the consumer that acts on it (#861), not to a
decode boundary whose whole job is to say *which* failure this was.

### `narrowDaemonErrorOutcome` — total, never throws

```ts
function narrowDaemonErrorOutcome(payload: unknown): DaemonErrorOutcome
```

- non-record payload (`null`, string, number, array) → `'unclassified'`
- record with a missing or non-string `code` → `'unclassified'`
- record with a string `code` → an explicit `switch` over the six literals, `default: 'unclassified'`

The `switch` **compares** the untrusted string against client-owned constants and **returns** a
client-owned constant; the daemon's string is never the operand of an index, a join, or a resolve. A
`Record`-keyed lookup table is the shape this deliberately avoids — that would make untrusted text a
lookup path, the exact thing `CLAUDE.md` forbids. The inline literal comparison mirrors
`parseTurnStatePayload`'s `state` check (see
[inbound message decode — internals](inbound-message-decode-internals.md)), this module's established
idiom for narrowing a closed enum without a cast.

Nothing is retained from the payload, so `code` needs no length bound — `MAX_LOGGED_TYPE_CHARS` (see
[limits](inbound-message-decode-limits.md)) exists because the *unmodeled* branch logs a wire-supplied
string; this narrower logs nothing wire-supplied, and `MAX_PLAINTEXT_BYTES` already bounds a hostile
oversized frame before the switch runs.

**Reading `payload.code` off a `JSON.parse` result is prototype-safe.** A `__proto__` key round-trips as
an ordinary own data property, and this function only *reads* — it never assigns — so the one real
`__proto__` hazard (assignment) does not apply here.

### `outcome` is required, not optional — and that is load-bearing

```ts
| { kind: 'daemon-error'; inReplyTo?: number; outcome: DaemonErrorOutcome }
```

Every `error` envelope produces an outcome — an unparseable payload lands on `'unclassified'` rather than
on absence — so a consumer has no "field missing" state to mishandle, and no `if (outcome)` branch that
behaves differently for a malformed frame than for a recognised one. Making it optional would reintroduce,
one layer down, exactly the ambiguity this slice exists to remove.

`inReplyTo` keeps its pre-existing optionality and meaning (see § Correlations below); nothing about it
changes.

### A malformed payload must stay terminal — the module's one deliberate exception

The module's usual answer for a malformed payload of a claimed type is `throw new WireDecodeError` (as
`parseMessagePayload` does). That answer is **wrong** for `error`: `daemonConnection.ts` wraps
`parseInboundMessage` in a bare `catch { return }` that drops the frame with no event and no log. A throw
here would silently kill all four behaviours the `daemon-error` case drives — see
[Daemon connection — correlation](daemon-connection-correlation.md) for the four (`sessionSettingsRejected`
\#269, `workspaceFolderRejected` #396, `reassembler.fail('daemon-error')` #116, `modalAnswerRejected` #248).
None of them reads error content — each correlates on `in_reply_to` and emits a client-minted id — so all
four must keep firing for **every** `error` envelope, however mangled its payload. **An `error` frame is
terminal because it arrived, not because its payload parsed.** So `narrowDaemonErrorOutcome` has exactly
one failure mode and it is a value, `'unclassified'`, never a throw and never `null` — the deliberate
inversion of the file's own fail-closed-by-throwing idiom, recorded in the function's own comment so a
later reader does not "fix" it into conformity.

**"Payload absent" splits into two distinct cases, and only one is reachable over the wire.**
`decodeEnvelope` requires the `payload` **key** to be present and throws `WireDecodeError` when it is
missing — before the `error` arm is ever reached, identically for all ~28 frame types. So:

- **`payload: null`** — the reachable "absent value" shape, what a peer omitting the field actually
  produces once it survives envelope decoding — lands on `'unclassified'` as a terminal `daemon-error`.
- **An envelope with no `payload` key at all** is a malformed **envelope**, rejected upstream by
  `decodeEnvelope`, pre-existing behaviour predating this slice by many tickets. Admitting a key-less
  frame would weaken the envelope contract for every arm in the module — out of scope here.

`narrowDaemonErrorOutcome` still handles a direct-call `undefined` correctly; it is simply not reachable
over the wire, and a test records that split explicitly rather than looking like a hole in the narrower.

### The `error` arm's log stays content-free

```ts
diagnosticLog?.event({ event: 'inbound-decoded', code: 'error', bytes: plaintext.length, hash: hashPlaintext(plaintext) })
```

`code: 'error'` is a client-owned literal and must stay one. [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md)'s
allowlist is enforced over field *names*, not values, so `code: envelope.payload.code` would typecheck
cleanly and ship a daemon-controlled string into a JSON-lines log an operator can send off-box in a debug
bundle. The deterministic guard is a unit test asserting the emitted record does not contain the wire
code string — the log's no-leak property (pinned since [#116](../codebase/116.md) for `message`) now also
covers `code`, the field this slice newly reads.

### `ErrorPayload`'s docblock states the rule, not a borrowed measurement

`ErrorPayload` (`src/shared/wire/types.ts`) sits among payload interfaces whose docblocks argue from
measurements taken on their own frames — a byte observed in a real value, a survey of who authors a
string. None of that transfers to `ErrorPayload`, so its new docblock argues on **contract ground**
instead: `code` is read as a comparand only; `message` is not surfaced (the daemon's promise that
`storage_failed`'s message is static is a statement about the daemon's own behaviour, not a property this
client can rely on for any code); `retryable` is a per-code constant in the daemon's own reject table and
a value an untrusted daemon picks, so it carries nothing the outcome does not already encode; `retry_after_s`
is absent from every attachment reject because the emitter's literal is closed over three fields.

## The fake daemon's reject answer (`fakeDaemon.ts`)

```ts
export type AttachmentRejectCode =
  | 'attachment.invalid_chunk' | 'attachment.integrity_failed' | 'attachment.too_large'
  | 'attachment.too_many_uploads' | 'attachment.storage_failed' | 'message.too_long'

export function attachmentRejectReplyFrames(
  rejectedIndex: number,
  code: AttachmentRejectCode
): (inboundPlaintext: Uint8Array) => Uint8Array[]
```

The sibling of [`attachmentStoredReplyFrames`](fake-daemon.md#attachment-upload-scaffolding-964) —
same `buildReplyFrames` shape, opposite terminal. Answers the `attachment_chunk` at `rejectedIndex` with
one `error` envelope whose `in_reply_to` is that chunk's envelope id and whose payload is a faithful
`{ code, message, retryable }` mirrored from the daemon's own reject table (`ATTACHMENT_REJECTS`) — a real
reject, not a code in an empty shell, which is what makes the client-side "nothing but the outcome
crosses" assertions prove something. `message.too_long`'s message is **fake-owned**, static and path-free
like the five it mirrors, and labelled as such — there is nothing upstream to be faithful to (§ What it
does). A non-`attachment_chunk` frame, a chunk at another index, or an undecodable frame all yield `[]`.

**The parameter is `rejectedIndex`, not `attachmentStoredReplyFrames`'s `completingIndex` — the
difference is real.** A reject names the chunk that *triggered* the condition, which for
`attachment-too-many-uploads` or `attachment-storage-failed` can be any chunk in the stream, not the one
that closed the set.

Stateless by construction, mirroring the sibling: the closure holds one number and one string, no arrival
set, so interleaved transfers cannot race and there is nothing to reset between tests. Fixed
`ATTACHMENT_REJECT_ID`/`ATTACHMENT_REJECT_TS` constants keep the fake wall-clock-free.

## Testing strategy

`src/main/transport/inboundMessage.test.ts`:

- Each of the six codes decodes to its own outcome, and a spurious `retry_after_s` on the fixture (no real
  reject sends one) does not leak — every assertion is an exact `toEqual`, so a leaked field reddens.
- The six outcomes are pairwise distinct, asserted as a set size rather than a list of literals (a list
  would only restate the mapping the code already states).
- An unrecognised code (`server.binary_offline`) and every malformed-payload shape — `null`, a string, an
  array, a record with no `code`, a record with a non-string `code` — land on `'unclassified'`, asserted as
  neither a throw nor `null`, with `in_reply_to` still crossing (the property the four correlations depend
  on). A separate test pins that an envelope with **no `payload` key at all** is rejected upstream by
  `decodeEnvelope`, not reached by this arm at all — the split noted in § A malformed payload must stay
  terminal.
- **Prototype safety, and why the fixture had to be rebuilt once.** `{ __proto__: { code: … } }` as an
  object **literal** is the prototype-*setter* form — it creates no own property, so `encodeEnvelope`'s
  `JSON.stringify` would emit `"payload":{}` and the test would silently duplicate the plain-`{}` case one
  test above, passing while proving nothing. The fixture is built with `JSON.parse` instead (the idiom the
  file's reserved-key tests already use), and it now asserts the *encoded* bytes contain `"__proto__"` —
  proving the fixture is real rather than asking a future reader to remember why literal form is wrong.
- The log no-leak test (pinned since #116 for `message`) gains an assertion that the emitted record does
  not contain the wire `code` string either.
- The three pre-existing exact-`toEqual` `daemon-error` assertions are repaired by adding
  `outcome: 'unclassified'`, kept as `toEqual` rather than loosened to `toMatchObject` — their fixtures
  already carry codes outside the six, so they become catch-all coverage, and the exactness is what makes
  a leaked `code`/`message` field fail the suite.

`src/main/transport/fakeDaemon.test.ts`: `attachmentRejectReplyFrames` answers the named chunk with the
named code (`in_reply_to` set to that chunk's envelope id) and returns `[]` for a different index, a
non-`attachment_chunk` type, or an undecodable frame; a round-trip test feeds a frame the builder produced
through `parseInboundMessage` and asserts the matching outcome and, by exact `toEqual`, nothing else.

## A docblock-placement lesson worth generalising

The first attempt at this slice inserted `DaemonErrorOutcome`'s declaration **between** `InboundDaemonMessage`'s
~223-line contract docblock and the union declaration itself — leaving two `/** … */` blocks stacked with
no declaration between them. TypeScript binds a docblock to the declaration that *follows* it, so the
union — the module's central published type, read at ~40 sites — was left with zero docs, caught only by
verifying with the TypeScript compiler API (each type should report exactly one jsdoc block) rather than
by eye. `DaemonErrorOutcome` now sits **above** the union's docblock, which also reads in the right order
— the union's own prose names the outcome type, so its referent is defined first. In this file a docblock
is load-bearing contract documentation, so *where* a new top-level declaration is inserted is part of the
change, not a formatting detail: after adding one near an existing declaration, confirm every neighbouring
docblock still touches its own declaration.

## Security review

Verdict: **PASS** (builder self-review), one SHOULD FIX addressed. The untrusted→trusted crossing is one
named function whose type signature is the trust proof (§ How it works). Three hostile-daemon scenarios
were dispositioned: **(a)** a forged reject on a healthy upload — accepted and inherent, the daemon is the
authority on whether an upload succeeded, so this is confusion, not escalation. **(b)** a malformed payload
used to suppress the four existing correlations — the sharpest attack the slice could have created, and
exactly why the narrower returns `'unclassified'` instead of throwing (§ A malformed payload must stay
terminal). **(c)** an oversized or adversarial `code` string — bounded by the existing frame-level
`MAX_PLAINTEXT_BYTES` guard and never retained. The SHOULD FIX (log leak via `code: payload.code`
typechecking cleanly under ADR 0007's name-only allowlist) is closed by the deterministic log-no-leak test,
not by prose alone — belt-and-suspenders means different fabric: the stochastic "keep the literal" rule
gets a deterministic test as its safety net.

## Edge cases and limitations

- **`attachment.not_found` / `attachment.stream_aborted` are not modelled here.** Both exist upstream but
  belong to the retrieval direction (#687); a client asking after them on this leg gets `'unclassified'`.
- **`outcome` now has a reader.** [Attachment transfer](attachment-transfer.md) (#861, landed) added a
  fifth check inside `case 'daemon-error':`'s `if (inReplyTo !== undefined)` block — `transferForEnvelope`,
  after `pendingSettings` and `pendingCreateFolders` — that reads `inbound.outcome` and passes it straight
  to the matching transfer's `fail()`, unmodified. Nothing re-parses or re-classifies it downstream.
- **No length bound on `code`.** Deliberate — a cap would imply the value is retained somewhere, which is
  the impression to avoid; nothing is copied, concatenated, or kept past the `switch`.

## Related

- [Attachment-stored wire types](attachment-stored-wire-types.md) — the positive-terminal sibling on the
  same upload leg (#964); together they are the whole `attachment_chunk` reply space.
- [Attachment chunk envelope](attachment-chunk-envelope.md) — the producer half both replies answer.
- [Inbound message decode](inbound-message-decode.md) / [contract](inbound-message-decode-contract.md) /
  [internals](inbound-message-decode-internals.md) / [limits](inbound-message-decode-limits.md) — the
  boundary `daemon-error` lives in; `parseTurnStatePayload`'s closed-enum idiom this narrower reuses;
  `MAX_PLAINTEXT_BYTES`/`MAX_LOGGED_TYPE_CHARS`, the bounds this slice leans on rather than duplicates.
- [Daemon connection — correlation](daemon-connection-correlation.md) — the `daemon-error` consumers this
  slice's terminal-not-throw design keeps firing unconditionally: `sessionSettingsRejected` #269,
  `workspaceFolderRejected` #396, the debug-bundle reassembler #116, `modalAnswerRejected` #248, and —
  landed after this doc was written — the attachment-transfer reject correlation, #861, the first reader
  of `outcome` itself.
- [Fake daemon](fake-daemon.md#attachment-upload-scaffolding-964) — `attachmentStoredReplyFrames`, the
  sibling `attachmentRejectReplyFrames` mirrors member for member.
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md)
  — the name-only allowlist this slice's log-no-leak test backstops with a deterministic assertion.
- `docs/specs/architecture/965-daemon-error-outcome-narrowing.md` — the full architecture spec, including
  the security review this doc summarizes and the two resolved open questions (no upstream message for
  `message.too_long`; `'unclassified'` kept over `'unknown'`).
- [Attachment transfer](attachment-transfer.md) — [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861),
  landed: the attachment upload send driver, and the first consumer of `outcome`.
