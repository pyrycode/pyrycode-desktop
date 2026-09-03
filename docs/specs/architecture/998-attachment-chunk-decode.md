# 998 — Decode a retrieved attachment's chunk frames

The **inbound half of the retrieval leg's data stream**: one new `InboundDaemonMessage` kind,
`attachment-chunk`, narrowed from the `attachment_chunk` frames the daemon streams back in answer to
the `request_attachment` [#993](https://github.com/pyrycode/pyrycode-desktop/issues/993) already
builds. One frame in, one typed value out. **Nothing consumes what it produces** — the reassembler
that concatenates chunks into a file is
[#995](https://github.com/pyrycode/pyrycode-desktop/issues/995).

Split from [#994](https://github.com/pyrycode/pyrycode-desktop/issues/994), itself split from #687.

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/main/transport/inboundMessage.ts` | `InboundDaemonMessage` | The union the new kind joins; its docblock carries the per-kind argument and gains a paragraph |
| | `parseAttachmentStoredPayload` | The #964 template for a decode arm in this family — `isRecord` guard, required fields, fresh literal |
| | `parseDebugBundleChunkPayload` | The only other arm that base64-decodes at this boundary; the shape `data: Uint8Array` follows |
| | `requireString` / `requireNonEmptyString` / `requireNumber` | The field narrowers, and the argument for when emptiness is a failure rather than a value |
| | `parseInboundMessage` | The switch this arm joins, the `MAX_PLAINTEXT_BYTES` guard ahead of it, and the `default:` arm the frame currently falls through to |
| | `narrowDaemonErrorOutcome` | The `error` arm's `envelope.in_reply_to` propagation — the shape the required correlation follows |
| `src/main/transport/codec.ts` | `base64StdDecode` | STRICT: decodes then requires the input to be the exact re-encoding, so non-canonical / unpadded input throws `WireDecodeError` |
| | `decodeEnvelope` | Assigns `in_reply_to` only when it decodes as a **number** — an absent key and a non-numeric one both reach this decoder as `undefined` |
| `src/shared/wire/types.ts` | `AttachmentChunkPayload` | The eight fields this arm narrows, and the two field docs AC4 corrects |
| | `AttachmentStoredPayload` | Its docblock argues the *opposite* correlation decision; read to know why the reasoning does not transfer |
| | `RequestAttachmentPayload` | The frame this stream answers; states the correlation-rides-the-envelope rule the required `inReplyTo` enforces |
| | `EnvelopeType` `attachment_chunk` / `attachment_stored` / `request_attachment` members | Three anchors that name `attachment_chunk` in order to contrast against it — correct, and out of AC4's blast radius |
| `src/main/transport/attachmentChunkPlan.ts` | `planAttachmentChunks` docblock | The **second, CORRECT** site of the provenance claim, on the outbound upload leg; must not be touched |
| `src/main/transport/inboundMessage.test.ts` | `encodeAttachmentStored`, the `#964` describe blocks | The fixture-helper and reject-branch shape this slice mirrors, including the reject-vs-ignore pairing |
| `docs/knowledge/features/request-attachment-envelope.md` | § How it works, § Configuration and usage | The sibling slice's lesson that the daemon permits logging an id only after shape validation, and nothing on this side validates — so nothing on this side logs one |
| `docs/knowledge/features/inbound-message-decode-internals.md` § `parseAttachmentStoredPayload` | | Why `requireNonEmptyString` exists as a sibling of `requireString` rather than a tightening of it |
| `pyrycode` `docs/protocol-mobile.md` § Attachments → `attachment_chunk`, **Trust and content hygiene** | | SSOT for AC4's corrected sentences and for the surviving client obligations |
| `pyrycode` `internal/protocol/testdata/attachment_chunk_retrieval.json`, `attachment_chunk_zero.json`, `request_attachment.json` | | The daemon-authored bytes AC1 and AC2 assert against |

## Design source

**Figma:** N/A — this slice is main-process only. It adds no renderer surface, no component and no
IPC channel, so the visual-fidelity check is intentionally skipped.

## Context

`parseInboundMessage` has no `attachment_chunk` arm at all. The frame rides outbound only today, for
uploads (#860 built its envelope, #861 drives it), so a retrieval chunk falls through to `default:`
and is dropped as an unrecognised type — logged content-free as `inbound-unmodeled` and returned as
`null`. This repo can already *ask* for an attachment and is deaf to every frame that comes back.

Upstream landed the stream (`pyrycode/pyrycode#2053`) and the handler that drives it (`#2054`) on
2026-09-03, and committed both halves of the correlation as fixtures, so the contract is provable in
bytes rather than prose.

**No ADR is warranted.** This slice mirrors a settled upstream contract and makes no desktop-side
architectural choice of its own — the same posture #964 and #993 recorded against ADR 0002.

## Design

### The decoded type — `RetrievedAttachmentChunk`, declared in `inboundMessage.ts`

The frame's `data` is padded base64 on the wire and raw bytes after decode, so the decoded shape
cannot be `AttachmentChunkPayload`. It reuses that type for the seven metadata fields rather than
restating them:

```ts
export interface RetrievedAttachmentChunk extends Omit<AttachmentChunkPayload, 'data'> {
  /** This chunk's RAW bytes — base64-decoded at this boundary, so the reassembler stays byte-pure. */
  data: Uint8Array
}
```

**It is declared in `src/main/transport/inboundMessage.ts`, not in `src/shared/wire/types.ts`, and
that placement is a decision.** `wire/types.ts` mirrors the daemon field-for-field (CLAUDE.md
§ Wire protocol); a `Uint8Array` where the daemon has a base64 string is a *decode product*, not a
wire type, and putting it there would drift the mirror. The file's own precedent agrees:
`DaemonErrorOutcome` — the other client-owned type derived from a wire payload — is exported from
here, and `bundle-chunk`'s `data: Uint8Array` is declared inline on the union member. This one earns
a name rather than an inline literal only because it carries eight fields instead of two. #995
imports it from here.

### The union member

```ts
| { kind: 'attachment-chunk'; attachmentChunk: RetrievedAttachmentChunk; inReplyTo: number }
```

**`inReplyTo` is REQUIRED, where the three kinds that already surface it type it optional**
(`daemon-error`, `session-settings`, `session-settings-updated`). Those frames can legitimately
arrive unsolicited; a retrieval chunk cannot. Upstream sets `InReplyTo` on every frame the retrieval
stream builds and asserts it (`internal/relay/v2attachmentstream_test.go`, *"every retrieval chunk
answers a request"*), and upstream's own reader drops a chunk whose `InReplyTo` is nil or mismatches
(`internal/relay/v2attachmentstream.go`). Typing it required makes a chunk without one **malformed,
not an uncorrelated variant**, and keeps a can't-happen branch out of #995 instead of pushing it
downstream.

**`attachment-stored`'s no-`inReplyTo` decision is not precedent here and the reasoning inverts.**
There the envelope field names the chunk *whose arrival completed the transfer*, which no client can
predict, so carrying it would offer a match key that silently never fires. Here it names the
`request_attachment` the client itself sent — the only handle the answer carries, and the one a
consumer must correlate on. The two arms will sit adjacent in the switch saying opposite things; both
docblocks say so explicitly, in both directions.

**It rides the union member, not the payload object**, following the three kinds that already carry
one. `in_reply_to` is an *envelope* field; folding it into a payload-shaped value would misfile it
and would break the `Omit<AttachmentChunkPayload, 'data'>` reuse.

### The parse function

```ts
function parseAttachmentChunkPayload(payload: unknown): RetrievedAttachmentChunk
```

Contract: an `isRecord` guard, then the eight fields, returning a **fresh eight-key literal** so
unknown server-added keys are tolerated (forward-compat) but not copied through — which is also what
makes it prototype-pollution-safe, per `parseAttachmentStoredPayload`'s argument. Every failure
throws `WireDecodeError`; nothing partial is ever returned. Its messages name the failure CATEGORY
and the static field name only — never a value, because `daemonConnection` catches
`WireDecodeError` into a caller that may log it.

Field-by-field narrowing, and the one non-obvious choice per field:

| Field | Narrower | Note |
|---|---|---|
| `attachment_id` | `requireNonEmptyString` | #964's argument transfers verbatim: every key is optional to Go's `encoding/json`, so a truncated or hostile frame arrives with the field present, typed and empty, and `''` is a success naming no transfer |
| `index` | `requireNumber` + `Number.isInteger` + `[0, total_chunks)` | The daemon types it `integer`; a fractional index would address nothing in #995's index-addressed accumulator |
| `total_chunks` | `requireNumber` + `Number.isInteger` + `>= 1` | Same; `>= 1` is the daemon's own bound, and it is what makes `[0, total_chunks)` a non-empty range |
| `filename` | `requireString` | **Type only.** Emptiness is not a modelled failure here and a second rule would fail-close valid traffic — the `requireString` posture is correct everywhere except the id |
| `mime_type` | `requireString` | Type only, same reason |
| `size` | `requireNumber` | Type only — see the allocation note below |
| `sha256` | `requireString` | Type only. **No 64-character length check**: this layer declares shapes and validates none, and integrity is #995's, against the assembled bytes |
| `data` | `base64StdDecode(requireString(…))` | STRICT — decodes then requires the input to be the exact base64-std re-encoding, so unpadded, non-canonical or truncated input throws |

`total_chunks` is narrowed **before** `index` so the range check has its bound; the returned literal
is written in wire order regardless, since it is a decoded object and not encoded bytes.

**No upper bound on `total_chunks` or `size`, deliberately.** This arm allocates from neither — the
only allocation it makes is the base64 decode of `data`, already bounded by `parseInboundMessage`'s
`MAX_PLAINTEXT_BYTES` guard ahead of it. Upstream's *"a client should bound what it allocates from an
outbound `size` / `total_chunks` against its own memory budget"* binds the component that
pre-allocates the assembly buffer, which is #995. Inventing a ceiling here would enforce nothing and
would fail-close a large but valid transfer.

**No shape validation on `attachment_id`**, for `parseAttachmentStoredPayload`'s reason: the
canonical lowercase-UUIDv4 rule binds the side that MINTS ids (the outbound leg), and re-validating
the shape of a value this client originated fail-closes a valid frame the moment the two copies
disagree.

### The switch arm

Placed between the `attachment_stored` and `error` cases, so the two attachment arms that disagree
about `in_reply_to` sit adjacent and each names the other.

```
case 'attachment_chunk':
  1. reject unless `typeof envelope.in_reply_to === 'number'`   ← throws WireDecodeError
  2. parseAttachmentChunkPayload(envelope.payload)              ← throws WireDecodeError
  3. content-free diagnostic record
  4. return { kind: 'attachment-chunk', attachmentChunk, inReplyTo }
```

**The correlation is checked BEFORE the payload is parsed, and the order is load-bearing.** Step 2
base64-decodes up to 45000 raw bytes; a frame that cannot be correlated is rejected anyway, so doing
that work first would let a hostile daemon spend this client's memory and CPU on frames it has
already disqualified. Both steps throw before the log, so neither ordering changes what is recorded.

`decodeEnvelope` assigns `in_reply_to` only when it decodes as a number, so an absent key, a `null`,
and a string all reach this arm identically as `undefined` — one check covers all three.

### Logging

`{ event: 'inbound-decoded', code: 'attachment_chunk', bytes, hash }` — the existing content-free
field set, no new `DiagnosticEvent` field, so #131's renderer pin is untouched. Narrowed before
logging, so a malformed chunk leaves no record.

**Nothing decoded is logged, and here that diverges from what upstream permits.** § Trust and content
hygiene says *"Log the attachment id, the index and the total; never the bytes, and never a raw
filename."* This client logs none of the three. `filename`, `mime_type`, `sha256` and `data` are out
by AC4 and by upstream's own rule — `data` is a user's private file bytes and a filename is both
often private in itself and a log-injection shape in a line-oriented log. The id, index and total are
out for #993's reason, which transfers exactly: upstream permits logging an id only *after its shape
has been validated*, and nothing on this side validates, so raw the id stays out entirely. `index`
and `total_chunks` follow the `slash_command_list` / `model_list` posture — `DiagnosticEvent` already
carries `count`, so emitting one would cost nothing structurally and is omitted on purpose, because
how a user's file is shaped is a fact about that file.

Still strictly safer than the `default:` arm this replaces for the type, which logs a **wire-supplied**
`envelope.type` capped at `MAX_LOGGED_TYPE_CHARS`; the code here is a static literal.

### AC4 — the provenance correction in `wire/types.ts`

Exactly **two field docs inside `AttachmentChunkPayload`** are wrong, and the edit touches nothing
else:

- `filename` — *"The client's own name for the file"* is true inbound and false outbound. `Intake.Receive`
  stores the bytes under a **sanitised** filename, so on the retrieval leg the value is one safe path
  component the daemon authored.
- `mime_type` — *"The client's DECLARED media type"* is true inbound and false outbound. The declared
  type is **discarded outright** at admission, so the daemon **sniffs** it from the stored bytes.

**The correction is narrow and is not widened.** Deriving the media type host-side improves those
fields' *provenance* — genuinely daemon-authored rather than attacker-chosen strings handed back —
and not their *trust*: both are still computed from bytes an attacker chose, so a sniffed `text/html`
is exactly as dangerous to render as a declared one. The three client obligations survive the edit
**verbatim**: sanitise `filename` before rendering, never resolve it into a path or a filesystem
name, never dispatch on `mime_type` in a way that grants the content privileges. Both byte ceilings
and the never-log clause survive too.

**What is deliberately NOT touched**, because a grep for `attachment_chunk` in that file returns
mostly *anchors* rather than the claim:

- the `attachment_stored` and `request_attachment` `EnvelopeType` member comments, which turn on
  `attachment_chunk` riding both legs — correct;
- `AttachmentStoredPayload`'s docblock, which cites the frame three more times for the
  no-`conversation_id` and never-log arguments — correct, and it already says the daemon's sanitiser
  produces the stored name;
- `AttachmentChunkPayload`'s own interface docblock — the index-addressing contrast and the
  no-completion-frame statement are both correct and stay;
- **`src/main/transport/attachmentChunkPlan.ts`**, which documents the same two fields the same way
  on the **outbound upload** leg, where the claim is true. A grep for the claim returns both sites;
  only the `wire/types.ts` one is wrong.

**Docblock-orphaning discipline.** Both edited files are dense with docblocks and no gate catches an
orphan. Every insertion in this slice lands *after a complete declaration*: the union member at the
end of `InboundDaemonMessage`, the new interface between two complete type declarations, the parse
function between `parseAttachmentStoredPayload`'s closing brace and `narrowDaemonErrorOutcome`'s
docblock, the switch arm between two complete `case` blocks. The `types.ts` edit inserts no
declaration at all — it rewrites two existing field docs in place.

## State + concurrency model

None. `parseInboundMessage` is a pure function of its two arguments; this slice adds no store slice,
no async task, no stream, no listener and no cancellation path. There is nothing to tear down.

**No consumer is wired, deliberately.** Adding a member to `InboundDaemonMessage` is additive: the
switch on `inbound.kind` in `src/main/daemonConnection.ts` has no `default:` and no exhaustiveness
check, so nothing outside these two files is compile-forced and no call site changes. The frame stops
at the decode boundary until #995 claims it.

## Error handling

Two failure signals, and **they are different tests** — the ambiguity this file's `fails closed`
phrasing hides:

- **`return null`** — *this decoder does not claim that frame type.* Unchanged for every type this
  slice does not add.
- **`throw WireDecodeError`** — *a claimed type carried a malformed payload.* What AC2 wants. Six
  branches: a missing payload field, a wrong-typed field, an absent envelope `in_reply_to`, an
  `index` outside `[0, total_chunks)`, a `total_chunks` below 1, and `data` that is not valid padded
  base64. Plus the inherited non-record-payload guard.

Both are **indistinguishable downstream** — `daemonConnection` wraps `parseInboundMessage` in a bare
`catch { return }` that drops the frame with no event and no log — so the unit boundary is the only
place the difference is observable, and the test that drives one malformed payload down both paths is
what keeps them apart.

Nothing partial is ever returned, and no error message interpolates a wire value.

## Testing strategy

All vitest, node environment. **No Playwright spec**: this slice is entirely inside the background
process, adds no renderer surface, and nothing can be clicked (`CLAUDE.md` § Build and test).

`src/main/transport/inboundMessage.test.ts` — a new `attachment_chunk` pair of describe blocks beside
the #964 ones, plus two records in the diagnostic-log block. A local `encodeAttachmentChunk(payload,
inReplyTo)` helper mirroring `encodeAttachmentStored`, and an `ATTACHMENT_CHUNK_RETRIEVAL` constant
transcribed verbatim from the daemon's committed `attachment_chunk_retrieval.json`.

**Recognition (AC1, AC3):**

- The daemon's committed retrieval fixture decodes to exactly `{ kind, attachmentChunk (8 fields,
  `data` as the decoded bytes), inReplyTo: 91 }` — an **exact `toEqual` on the whole result**, which
  is what makes AC3's "no field the frame did not carry" falsifiable. A subset match would pass with
  a smuggled field.
- `inReplyTo: 91` surfaces against the `request_attachment` fixture's `id: 91` — asserted against the
  literal #993's `requestAttachmentEnvelope.test.ts` already pins, so the two halves of the pair
  agree in this repo the way they do upstream.
- `data` decodes to the fixture's raw bytes, asserted as bytes rather than as a re-encoded string.
- Unknown server-added keys are dropped; only the eight survive.
- A non-canonical `attachment_id` (not a UUID, uppercase) decodes fine — this layer polices type, not
  shape.
- `attachment_id: '__proto__'` survives as an ordinary own property and alters no prototype, read
  back under the exact key (per the recall that a `toEqual` alone would not prove that, and that a
  literal `{__proto__: …}` fixture is inert — the hostile value goes in as an ordinary string).
- An `index` at each end of the valid range (`0` and `total_chunks - 1`) decodes — the boundary is
  half-open and must not be off by one.
- A `message` still routes to its existing kind — additive.

**Fail-closed (AC2):** one test per branch, each a **single-field mutation** of the retrieval fixture
so the branch is isolated:

- non-record payload; each of the eight fields absent; each wrong-typed;
- `in_reply_to` absent, `null`, and a non-numeric string — all three reach the arm as `undefined`;
- `index` at `-1` and at `total_chunks`, and a fractional `index`;
- `total_chunks` at `0` and `-1`, and a fractional `total_chunks`;
- `data` unpadded, with a non-alphabet character, and `null`.

Plus the daemon's committed **`attachment_chunk_zero.json`** driven whole — it trips several branches
at once, so it proves fail-closed against the daemon's own zero value rather than isolating one
branch, and the isolation is what the single-field mutations above are for.

Plus the **reject-vs-ignore pairing** #964 established: one malformed payload down both paths —
`throw` on the now-claimed `attachment_chunk`, `null` on a type this module has never claimed.

**Logging (AC4's second sentence):**

- A decoded chunk logs exactly `{event, code, bytes, hash, seq, ts}` — asserted as a **whole key
  set**, since the AC is a negative — and the line contains none of the frame's `filename`,
  `mime_type`, `sha256`, `attachment_id` or decoded bytes, driven with distinctive sentinel values.
- A malformed chunk logs nothing at all, driven from both throw sites (the absent `in_reply_to` and a
  bad payload field) so the narrow-before-log ordering is pinned on both.

`src/shared/wire/types.test.ts` is **not** extended: `AttachmentChunkPayload` is unchanged as a type,
and #860's `attachment-chunk wire vocabulary` block already pins its shape. AC4 edits prose only.

## Open questions

1. **Does `requireNonEmptyString` on `attachment_id` risk fail-closing valid retrieval traffic?**
   Reasoned no — on this leg the daemon echoes the id from the request it is answering, so an empty
   one can only come from a truncated or hostile frame. Resolve by confirming against the fixture,
   whose id is a canonical UUID.
2. **Does `toEqual` compare `Uint8Array` by content in this vitest version?** Believed yes. If it
   does not, the exact-equality assertion AC3 rests on has to compare `data` separately via
   `Array.from`, and the whole-result equality then runs over the result with `data` normalised —
   never downgraded to `toMatchObject`, which would delete the property AC3 exists to police.
   Resolve in RED.

Each resolution that changes the design is recorded in a `## Revisions` entry.

## Revisions

**2026-09-03 — both open questions resolved in RED/GREEN; the design is unchanged.**

1. **`requireNonEmptyString` on `attachment_id` does not fail-close valid traffic.** The daemon's
   committed retrieval fixture carries a canonical lowercase UUID, and on this leg the daemon echoes
   the id from the request it is answering — an empty one can only come from a truncated or hostile
   frame. Kept as designed.
2. **`toEqual` does compare `Uint8Array` by content in this vitest (2.1.9).** The exact-equality
   assertion AC3 rests on passes against the whole result with `data` as bytes, so no fallback and no
   downgrade to `toMatchObject` was needed. A separate byte-level assertion via `Array.from` was kept
   anyway, because it is the one that would distinguish "decoded to bytes" from "carried the base64
   string through" if the equality semantics ever changed.

**One test-harness correction, made in GREEN and worth recording because it produced a
false-negative rather than a failure.** `encodeAttachmentChunk(payload, undefined)` was intended to
build the envelope with no `in_reply_to` key, but passing `undefined` to a parameter that has a
default *takes the default* — so the "envelope carries no correlation" test was asserting against a
correlated frame and read as if it covered the reject branch. Replaced with an explicit
`OMIT_IN_REPLY_TO` symbol sentinel. The bug surfaced only because the arm's implementation was
already correct and the test failed to throw; had the implementation been written first, the test
would have passed green while proving nothing.

## Security review

**Verdict:** PASS

This arm *is* a trust boundary, so the review is not a formality: every category below is answered on
this frame's own ground rather than by transcribing a neighbour's argument.

**Findings:**

- **[Trust boundaries] SHOULD FIX — the decode makes the SHAPE trusted and never the CONTENT, and the
  type system carries no signal for that** (a `string` is a `string`, and a `Uint8Array` is a
  `Uint8Array`). After this arm, `filename`, `mime_type` and `sha256` are attacker-shaped text and
  `data` is attacker-chosen bytes, all held in types that look settled. Addressed in Phase B by
  stating the three surviving obligations on the union member's docblock, where #995's builder will
  read them: sanitise `filename` before rendering, never resolve it into a path or filesystem name,
  never dispatch on `mime_type` in a way that grants the content privileges. Deriving `mime_type`
  host-side improved these fields' *provenance*, not their *trust* — that distinction is AC4's whole
  point and it must not read as a relaxation.
- **[File / storage] OUT OF SCOPE (#995) — `filename` is passed through UNSANITISED, on purpose.**
  This slice touches no filesystem. Sanitising at the decode boundary was considered and rejected: it
  would drift `wire/types.ts` from the daemon's field-for-field mirror and, worse, would *hide* the
  untrusted-ness behind a value that looks cleaned. The daemon already stores under a sanitised single
  path component, so a `/` or `..` arriving here means a daemon bug or a hostile daemon — a failure
  mode nothing has observed, so no reject branch is invented for it. Named on the docblock instead.
- **[Network & I/O] SHOULD FIX — `total_chunks` and `size` are UNBOUNDED claims, and the sharp edge is
  downstream.** This arm allocates from neither; its only allocation is the base64 decode of `data`,
  bounded by `parseInboundMessage`'s `MAX_PLAINTEXT_BYTES` guard ahead of it, so a chunk flood costs
  ~49KB per frame and nothing accumulates. #995 accumulates, and `new Array(total_chunks)` from a
  claimed `2**53` is an instant OOM. A ceiling *here* would be a client invention that fail-closes a
  large valid transfer. What #995 has instead is a **daemon-published invariant** rather than an
  invented bound — `total_chunks == max(1, ceil(size / 45000))`, the admission check
  `ATTACHMENT_CHUNK_DATA_BYTES`'s docblock already records — and Phase B names it on the union
  member so #995 does not invent one.
- **[Errors, logs, telemetry] SHOULD FIX — the range-check messages are the one place a wire value
  could reach a message this module promises is category-only.** The natural phrasing,
  `` `index ${index} outside [0, ${total_chunks})` ``, interpolates two daemon-supplied numbers into a
  `WireDecodeError` that `daemonConnection` catches into a caller that may log it. Phase B keeps both
  messages static literals, and a test asserts the exact message text rather than merely
  `toThrow(WireDecodeError)`. Every other narrower already interpolates only this module's own static
  field names. The record itself is content-free and the throw path is never logged — both pinned by
  tests.
- **[Threat model — hostile daemon] No findings.** This is the modelled threat and the reason the arm
  exists. Every one of the eight fields is defensively narrowed, nothing partial is ever returned, and
  the required `inReplyTo` rejects an uncorrelatable chunk at the boundary instead of pushing a
  can't-happen branch into #995.
- **[Threat model — malicious relay] No findings.** The relay is content-blind but on-path: it can
  drop, delay, reorder or flood. Reorder is a non-event at this boundary — the arm is stateless and
  per-frame, and chunks are index-addressed by contract, so out-of-order arrival is ordinary traffic
  rather than an error. Drop and stall are #995's timeout, not this arm's.
- **[Threat model — correlation forgery] SHOULD FIX, addressed on the docblock.** A required
  `inReplyTo` makes a chunk *correlatable*, not *authentic*: a hostile daemon inside the session can
  answer a request the client never sent, or aim chunks at a different pending request. #995 must
  match against requests **this client minted**. One structural note worth carrying forward: because
  `inReplyTo` is a `number`, a plain-object lookup is prototype-safe by construction here, where
  `attachment_stored`'s string `attachment_id` needed a `Map` to dodge `__proto__` — so the two arms'
  consumer obligations differ, and #995 must not copy #861's reasoning wholesale. The
  `attachment_id` it also carries is still a string and still needs a `Map`.
- **[Cryptographic primitives] OUT OF SCOPE (#995) — `sha256` is carried, not verified.** It cannot be
  verified here: the digest is over the WHOLE file and this arm sees one chunk, so verification is
  only possible at assembly. Carrying it through is exactly what lets #995 do it. It is INTEGRITY and
  not authenticity — the same party supplies the bytes and the digest — and comparing it needs no
  constant-time primitive, since neither side of the comparison is a secret. This slice introduces no
  RNG, no key, no nonce and no comparison against a secret.
- **[Tokens, secrets, credentials] No findings.** The frame carries no token, key or credential, and
  the arm mints, stores and rotates nothing. `attachment_id` is not a capability — not secret, not
  unguessable, never the only thing between a caller and a file — and it is kept out of the
  diagnostic log anyway, per #993's argument that upstream permits logging an id only after its shape
  is validated and nothing on this side validates.
- **[Electron attack surface] No findings, with one obligation named.** No `contextBridge` API, no
  `ipcMain` channel, no `BrowserWindow`, no navigation and no protocol handler. `inboundMessage.ts`'s
  module header already binds the file main-process-only and forbids re-export through any renderer
  barrel, and `RetrievedAttachmentChunk` inherits that. The obligation worth naming for later slices:
  a `Uint8Array` is structured-clonable, so a future IPC carry could ship a user's raw private file
  bytes into the web layer without any type error — that is a decision to argue on its own ticket,
  not a side effect of decoding.
- **[Concurrency] No findings.** `parseAttachmentChunkPayload` and its switch arm are pure functions
  of their arguments: no async, no shared state, no timer, no listener, no store slice, nothing to
  cancel and nothing to tear down. Two concurrent retrievals interleaving on the wire is ordinary
  traffic here and a keying problem for #995, named above.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
