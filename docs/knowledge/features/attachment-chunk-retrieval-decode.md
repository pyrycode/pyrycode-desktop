# Attachment-chunk retrieval decode

The **inbound half of the retrieval leg's data stream**: recognising the `attachment_chunk` frames the
daemon streams back in answer to a `request_attachment`, and narrowing each into a typed [inbound
message](inbound-message-decode.md) arm — `RetrievedAttachmentChunk`, base64-decoded at the boundary.
One frame in, one typed value out. **Nothing consumes what it produces yet** — the reassembler that
concatenates chunks into a file is a later slice.

Introduced in [#998](https://github.com/pyrycode/pyrycode-desktop/issues/998), split from #994, itself
split from #687. SSOT is `pyrycode/pyrycode` `docs/protocol-mobile.md` § Attachments,
**Trust and content hygiene**, plus `internal/protocol/attachments.go` (`AttachmentChunkPayload`) —
the retrieval stream landed upstream as pyrycode#2053, its driving handler as #2054, both 2026-09-03.

## What it does

```ts
// src/main/transport/inboundMessage.ts
export interface RetrievedAttachmentChunk extends Omit<AttachmentChunkPayload, 'data'> {
  data: Uint8Array   // base64-decoded at this boundary; raw on the wire, bytes after decode
}

export type InboundDaemonMessage =
  | …
  | {
      kind: 'attachment-chunk'
      attachmentChunk: RetrievedAttachmentChunk
      inReplyTo: number   // REQUIRED — see § How it works
    }
```

`RetrievedAttachmentChunk` reuses [`AttachmentChunkPayload`](attachment-chunk-envelope.md) (#860) for
the seven metadata fields via `Omit<…, 'data'>` rather than restating them, so their doc comments,
byte ceilings, and any later daemon-side correction reach this type automatically. It is declared in
`inboundMessage.ts`, not `wire/types.ts` — a `Uint8Array` where the daemon has a base64 string is a
**decode product**, not a wire type, and putting it in the file that mirrors the daemon field-for-field
would drift that mirror. `DaemonErrorOutcome` is the file's other client-owned type derived from a wire
payload, for the same reason.

## How it works

**One frame, two directions, and this slice claims only the direction that was unclaimed.**
`attachment_chunk` already rode outbound for uploads ([#860](attachment-chunk-envelope.md) built the
envelope, [#861](attachment-transfer.md) drives it) — until this ticket, an *inbound* one fell through
`parseInboundMessage`'s `default:` arm and was dropped as unrecognised, logged content-free as
`inbound-unmodeled`.

**`inReplyTo` is REQUIRED, where the three kinds that already surface it — `daemon-error`,
`session-settings`, `session-settings-updated` — type it optional.** Those frames can legitimately
arrive unsolicited; a retrieval chunk cannot. Upstream sets `Envelope.in_reply_to` on every frame the
retrieval stream builds and asserts it in its own test
(`internal/relay/v2attachmentstream_test.go`, *"every retrieval chunk answers a request"*); its own
reader drops a chunk whose value is nil or mismatched
(`internal/relay/v2attachmentstream.go`). The daemon's committed `attachment_chunk_retrieval.json`
rides `in_reply_to: 91` against `request_attachment.json`'s `id: 91` — the same fixture pair
[`requestAttachmentEnvelope.test.ts`](request-attachment-envelope.md) (#993) already pins on the
outbound side. Typing it required makes a chunk without one **malformed, not an uncorrelated
variant**, keeping a can't-happen branch out of the reassembler rather than pushing it downstream.
`decodeEnvelope` assigns `in_reply_to` only when it decodes as a `number`, so an absent key, `null`,
and a non-numeric string all reach this arm identically as `undefined` — one `typeof` check covers all
three.

**Do not read [`attachment-stored`](attachment-stored-wire-types.md)'s no-`inReplyTo` decision as
precedent — the reasoning inverts.** There, `Envelope.in_reply_to` names *the chunk whose arrival
completed the transfer*, which no client can predict, so carrying it would offer a match key that
silently never fires; correlation instead rides the payload's `attachment_id`. Here `in_reply_to`
names the `request_attachment` the client itself sent — the only handle the answer carries, and the
one a consumer must correlate on. The two arms sit adjacent in the switch and each names the other's
opposite reasoning in its docblock.

**Chunks are index-addressed and may arrive in any order — `debug_bundle_chunk`'s strict ascending
`seq` is the neighbouring rule and the wrong one to copy here.** Recognition claims one frame at a
time and enforces no ordering; it only refuses an `index` outside `[0, total_chunks)`. **There is no
completion frame and none is coming**: `total_chunks` rides every chunk, so a receiver knows the
expected count from the first frame it sees — nothing analogous to `debug_bundle_done` exists on this
leg.

**The decode — `parseAttachmentChunkPayload`.** `parseAttachmentStoredPayload`'s shape (#964) scaled
to eight fields plus a base64 decode: an `isRecord` guard, then each field, returning a fresh
eight-key literal so unknown server-added keys are tolerated (forward-compat) but never copied
through — which also keeps the narrower prototype-pollution-safe. Every failure throws
`WireDecodeError`; nothing partial is ever returned.

| Field | Narrower | Why |
|---|---|---|
| `attachment_id` | `requireNonEmptyString` | Every key is optional to Go's `encoding/json`, so a truncated or hostile frame arrives with the field present, typed, and empty — `''` would be a success naming no transfer |
| `index` | `requireNumber` + integer + `[0, total_chunks)` | Daemon types it `integer`; a fractional index addresses nothing in an index-addressed accumulator |
| `total_chunks` | `requireNumber` + integer + `>= 1` | Narrowed **before** `index`, so the range check has its bound; `>= 1` is the daemon's own bound and what keeps `[0, total_chunks)` non-empty |
| `filename` / `mime_type` / `sha256` | `requireString` | Type only — emptiness is not a modelled failure on any of the three, and `sha256` gets no 64-char length check: this layer declares shapes and validates none, integrity is the reassembler's, against the assembled bytes |
| `size` | `requireNumber` | Type only |
| `data` | `base64StdDecode(requireString(…))` | STRICT — decodes then requires the input to be the exact base64-std re-encoding, so unpadded, non-canonical, or truncated input throws rather than silently shortening the file |

**No upper bound on `total_chunks` or `size`, deliberately.** This arm allocates from neither — its
one allocation is the base64 decode of `data`, already bounded by `parseInboundMessage`'s
`MAX_PLAINTEXT_BYTES` guard ahead of it. A ceiling here would be a client invention that fail-closes a
large but valid transfer; the reassembler has a **daemon-published invariant** to bound its own
pre-allocation instead — `total_chunks == max(1, ceil(size / 45000))`, the
[`ATTACHMENT_CHUNK_DATA_BYTES`](attachment-chunk-envelope.md) stride.

**No shape validation on `attachment_id`**, for `parseAttachmentStoredPayload`'s reason: the canonical
lowercase-UUIDv4 rule binds the side that *mints* ids — the outbound leg — and re-validating the shape
of a value this client originated fail-closes a valid frame the moment two copies disagree.

**The correlation is checked BEFORE the payload is parsed, and the order is load-bearing.** Parsing
base64-decodes up to 45000 raw bytes; a frame that cannot be correlated is rejected anyway, so parsing
first would let a hostile daemon spend this client's memory and CPU on frames already disqualified.
Both steps throw before the log, so the ordering changes no record.

**Narrow before log, and nothing decoded is logged — stricter here than upstream permits.** § Trust
and content hygiene says *"log the attachment id, the index and the total; never the bytes, and never
a raw filename."* This client logs none of the three. `data` is a user's own private file bytes and
`filename` is doubly out — often private in itself, and a client-supplied string in a line-oriented
log is a log-injection shape; `sha256`/`mime_type` follow. The id is out for
[#993](request-attachment-envelope.md)'s reason, not by inheritance: upstream permits logging an id
only *after its shape has been validated*, and nothing on this side validates. `index`/`total_chunks`
follow the `slash_command_list`/`model_list` posture — `DiagnosticEvent` already carries `count`, so
emitting one would cost nothing structurally, and is omitted anyway because how a user's file is
shaped is a fact about that file. The record is the existing four-field content-free set
(`event: 'inbound-decoded'`, `code: 'attachment_chunk'`, `bytes`, `hash`) — no new `DiagnosticEvent`
field, so the [#131](daemon-connection.md) renderer pin is untouched. Strictly safer than the
`default:` arm this replaces for the type, which logged the **wire-supplied** `envelope.type` capped
at `MAX_LOGGED_TYPE_CHARS`; the code here is a static literal.

## The provenance correction (`AttachmentChunkPayload` field docs)

Two field docs inside `AttachmentChunkPayload` were wrong on the retrieval leg and are corrected by
this ticket — nothing else in that interface, and nothing in
[`attachmentChunkPlan.ts`](attachment-chunk-envelope.md)'s docblock (correct, upload-leg-only), moved:

- **`filename`** — *"the client's own name for the file"* is true inbound, false outbound.
  `Intake.Receive` stores the bytes under a **sanitised** single path component, so on the retrieval
  leg the value is one the daemon authored, not an echo of the uploading client's string.
- **`mime_type`** — *"the client's declared media type"* is true inbound, false outbound. The declared
  type is **discarded outright** at admission; the daemon **sniffs** it from the stored bytes.

**The correction is narrow: provenance, not trust.** Deriving the media type host-side means those
fields are genuinely daemon-authored rather than attacker-chosen strings handed back — it says nothing
about their safety, since both are still computed from bytes an attacker chose. A sniffed `text/html`
is exactly as dangerous to render as a declared one. Every client obligation survives verbatim:
sanitise `filename` before rendering, never resolve it into a path or a filesystem name, never dispatch
on `mime_type` in a way that grants the content privileges. `filename` rides through this decode
**unsanitised, on purpose** — sanitising at the decode boundary would drift `wire/types.ts` from the
daemon's mirror and would hide the untrusted-ness behind a value that looks cleaned.

## Configuration and usage

`src/main/transport/inboundMessage.ts` — main-process only, IPC-free (see [inbound message
decode](inbound-message-decode.md) for the module's placement rule). Reach the type through
`parseInboundMessage`, never a bare cast on `Envelope.payload`.

Adding `attachment-chunk` to `InboundDaemonMessage` is additive: `daemonConnection.ts`'s inbound switch
has no `default:` and no exhaustiveness check, so nothing outside `inboundMessage.ts` is
compile-forced and no call site changes. **No consumer is wired in this slice** — the reassembler that
claims the arm is a later ticket.

## Edge cases and limitations

- **No consumer.** The switch arm decodes and returns; `daemonConnection.ts` has no `case
  'attachment-chunk':` yet, so a well-formed frame is decoded and then simply unmatched — the same
  dormancy `attachment_stored`/`slash_command_list`/`model_list` shipped through before their
  consumers landed.
- **Reordering is not an error at this boundary.** The arm is stateless and per-frame; chunks are
  index-addressed by contract, so out-of-order arrival is ordinary traffic. Drop and stall are the
  reassembler's timeout to own, not this arm's.
- **A required `inReplyTo` makes a chunk correlatable, not authentic.** A hostile daemon inside the
  session can answer a request the client never sent, or aim chunks at a different pending request.
  The reassembler must match against requests *this client minted*. Because `inReplyTo` is a `number`,
  a plain-object lookup keyed on it is prototype-safe by construction — unlike `attachment-stored`'s
  string `attachment_id`, which needs a `Map` to dodge `__proto__`. The `attachment_id` this frame also
  carries is still a string and still needs one.
- **`sha256` is carried, not verified, here.** The digest is over the whole file and this arm sees one
  chunk; verification is only possible at assembly. It is integrity, not authenticity — the same party
  supplies the bytes and the digest, so no constant-time comparison is needed once it happens.
- **A `Uint8Array` is structured-clonable.** A future IPC carry of this value into the renderer could
  ship a user's raw private file bytes into the web layer with no type error catching it. That is a
  decision for whichever later ticket adds that carry to argue on its own terms, not a side effect of
  this decode.

## Testing strategy

All vitest, node environment. No Playwright spec — this slice is entirely inside the background
process, adds no renderer surface, and nothing here can be clicked (`CLAUDE.md` § Build and test).

**`src/main/transport/inboundMessage.test.ts`** — an `attachment_chunk` pair of describe blocks beside
the `attachment_stored` ones, an `encodeAttachmentChunk(payload, inReplyTo)` helper mirroring
`encodeAttachmentStored`, and an `ATTACHMENT_CHUNK_RETRIEVAL` constant transcribed verbatim from the
daemon's committed `attachment_chunk_retrieval.json`:

- The retrieval fixture decodes to exactly `{ kind, attachmentChunk (8 fields, `data` as decoded
  bytes), inReplyTo: 91 }` — an **exact `toEqual` on the whole result**, so a field added later cannot
  leak through silently; `inReplyTo: 91` surfaces against the `request_attachment` fixture's `id: 91`
  #993 already pins.
- `data` decodes to the fixture's raw bytes, asserted as bytes (`toEqual` does compare `Uint8Array` by
  content on this vitest version, 2.1.9) rather than as a re-encoded string.
- Unknown server-added keys are dropped; only the eight survive. A non-canonical `attachment_id`
  decodes fine — this layer polices type, not shape. `attachment_id: '__proto__'` survives as an
  ordinary own property and alters no prototype, read back under the exact key.
- `index` at each end of the valid range (`0` and `total_chunks - 1`) decodes — the boundary is
  half-open and must not be off by one.
- **Fail-closed, one test per branch, each a single-field mutation of the retrieval fixture:**
  non-record payload; each of the eight fields absent; each wrong-typed; `in_reply_to` absent, `null`,
  and a non-numeric string (all three reach the arm as `undefined`); `index` at `-1` and at
  `total_chunks`, and fractional; `total_chunks` at `0` and `-1`, and fractional; `data` unpadded, with
  a non-alphabet character, and `null`. Plus the daemon's committed `attachment_chunk_zero.json` driven
  whole — the all-zero payload trips several branches at once, proving fail-closed against the
  daemon's own zero value rather than isolating one branch.
- The reject-vs-ignore pairing #964 established: one malformed payload down both paths — `throw` on
  the now-claimed `attachment_chunk`, `null` on a type this module has never claimed.
- Logging: a decoded chunk logs exactly the four-field content-free record and none of `filename`/
  `mime_type`/`sha256`/`attachment_id`/decoded bytes, driven with distinctive sentinel values; a
  malformed chunk logs nothing at all, driven from both throw sites (absent `in_reply_to` and a bad
  payload field) so the narrow-before-log ordering is pinned on both.

`src/shared/wire/types.test.ts` is **not** extended — `AttachmentChunkPayload` is unchanged as a type
(#860's vocabulary block already pins its shape); this ticket edits field-doc prose only.

One test-harness bug surfaced and was corrected during implementation, worth remembering for the next
frame in this family: `encodeAttachmentChunk(payload, undefined)` was meant to omit `in_reply_to`, but
passing `undefined` to a parameter with a default **takes the default** — the "no correlation" test was
silently asserting against a *correlated* frame. Fixed with an explicit `OMIT_IN_REPLY_TO` sentinel
rather than `undefined`.

## Security review

Verdict: **PASS** (builder self-review). Several SHOULD FIX items addressed in prose/docblocks rather
than new code, all owned by the not-yet-built reassembler rather than this decode:

- The decode makes the **shape** trusted and never the **content** — `filename`/`mime_type`/`sha256`
  are attacker-shaped text and `data` is attacker-chosen bytes even after narrowing. Stated on the
  union member's docblock so the reassembler's builder reads it there.
- `total_chunks`/`size` are unbounded claims; the sharp edge (`new Array(total_chunks)` from a claimed
  `2**53`) is downstream, in the reassembler's pre-allocation — this arm allocates from neither.
- The range-check messages are static category literals (`'invalid attachment_chunk index'`, not an
  interpolated `` `index ${index} outside […]` ``) so a `WireDecodeError` a future caller might log
  never carries a daemon-supplied number.
- A required `inReplyTo` makes a chunk correlatable, not authentic — the reassembler must still match
  against requests this client minted; see § Edge cases.
- No token, key, or credential in scope; no `contextBridge`/`ipcMain`/`BrowserWindow` surface added.

## Related

- [Attachment chunk envelope](attachment-chunk-envelope.md) — the producer half (#860): the same
  `AttachmentChunkPayload` and `EnvelopeType` member, on the **upload** leg. Its "no inbound decode of
  `attachment_chunk` itself" edge case is resolved by this ticket for the retrieval direction.
- [Request-attachment envelope](request-attachment-envelope.md) — the outbound ask (#993) this stream
  answers; the `in_reply_to: 91` / `id: 91` fixture pair both slices pin.
- [Attachment-stored wire types](attachment-stored-wire-types.md) — the upload leg's terminal (#964);
  its no-`inReplyTo` decision is **not** precedent here — see § How it works for why the reasoning
  inverts.
- [Attachment transfer](attachment-transfer.md) — the upload leg's send driver (#861); the retrieval
  leg's own driver/reassembler, once built, is this decode's first consumer.
- [Inbound message decode](inbound-message-decode.md) / [internals](inbound-message-decode-internals.md) /
  [extension history](inbound-message-decode-history.md) — the boundary this arm extends: the
  twenty-fifth additive kind, reusing `requireNonEmptyString` (#964) and `base64StdDecode` (wire codec)
  rather than adding a new field narrower.
- [Daemon error outcome](daemon-error-outcome.md) — the sibling failure path on this leg: an
  `attachment.not_found` or `attachment.stream_aborted` reject instead of a chunk stream, classified by
  [#999](https://github.com/pyrycode/pyrycode-desktop/issues/999); nothing consumes either outcome until
  #995.
- [Wire codec](wire-codec.md) — `base64StdDecode` (strict re-encoding check), `decodeEnvelope`'s
  `in_reply_to` handling, `MAX_PLAINTEXT_BYTES`.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
  — this slice mirrors a settled upstream contract and makes no desktop-side architectural choice of its
  own, so no new ADR was warranted (the same posture #964 and #993 recorded).
- `docs/specs/architecture/998-attachment-chunk-decode.md` — the full architecture spec, including the
  security review this doc summarizes.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § Attachments, **Trust and content
  hygiene** — SSOT for the corrected `filename`/`mime_type` provenance and the surviving client
  obligations.
