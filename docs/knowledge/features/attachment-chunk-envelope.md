# Attachment chunk envelope

The **producer half** of the daemon's attachment wire contract: the `attachment_chunk` frame type,
the pure arithmetic that splits a whole file into chunk payloads, and the pure builder that wraps one
chunk into serialized envelope bytes. Nothing here sends, reads a file, or holds state.

Introduced in [#860](https://github.com/pyrycode/pyrycode-desktop/issues/860). The daemon publishes
the contract in `pyrycode/pyrycode` `docs/protocol-mobile.md` § Attachments (SSOT pyrycode #1752 the
frame, #1753 the 45000-byte stride, #1751 the client-facing contract). The consumer that mints
`attachment_id`, reads a file, and actually sends is [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861) —
**not started**; this slice ships unreferenced.

## What it does

Two pure, main-process-only modules plus a wire-type addition:

```ts
// src/shared/wire/types.ts
export const ATTACHMENT_CHUNK_DATA_BYTES = 45000       // load-bearing stride, raw bytes of `data`
export const ATTACHMENT_ID_MAX_BYTES = 64               // documented, not validated
export const ATTACHMENT_FILENAME_MAX_BYTES = 255        // documented, not validated
export const ATTACHMENT_MIME_TYPE_MAX_BYTES = 255       // documented, not validated

export interface AttachmentChunkPayload {
  attachment_id: string   // identical on every chunk; NOT a capability, never resolved into a path
  index: number            // 0-based, in [0, total_chunks); addresses, never appends
  total_chunks: number     // >= 1, identical on every chunk; why there is no completion frame
  filename: string         // display string + sanitiser input, NEVER a path
  mime_type: string        // client's declared type — a hint, not a verified property
  size: number              // the WHOLE file, not this chunk
  sha256: string            // lowercase hex of the WHOLE file, always 64 chars — integrity, not a fetch key
  data: string               // this chunk's raw bytes as standard PADDED base64
}
```

```ts
// src/main/transport/attachmentChunkPlan.ts
export function planAttachmentChunks(input: {
  attachment_id: string; filename: string; mime_type: string; bytes: Uint8Array
}): AttachmentChunkPayload[]   // total — every input has an answer, including empty; never throws

// src/main/transport/attachmentChunkEnvelope.ts
export function buildAttachmentChunk(input: {
  id: number; ts: string; payload: AttachmentChunkPayload
}): Uint8Array                 // MAY throw WireEncodeError above MAX_PLAINTEXT_BYTES
```

`'attachment_chunk'` joins the `EnvelopeType` union so a round-trip test can actually detect a missing
member — `Envelope.type` is `EnvelopeType | string`, so without the union member a decode/re-encode
round-trip passes silently on an unknown string.

## How it works

**One frame carries both directions.** `attachment_chunk` rides upload (client → daemon) and
retrieval (daemon → client) alike, and all eight fields are always present in both — no `omitempty`,
so a decoder may rely on all eight. This slice only ever produces the frame; decoding an inbound one
is a later slice's job (see Non-goals).

**There is no `conversation_id`, and the omission is a security property.** An upload lands in the
conversation the authenticated session is already on, decided daemon-side from session context, so a
client cannot steer bytes into another conversation's directory by naming one. Do not add one "for
clarity" — that would reopen exactly the hole the omission closes.

**`planAttachmentChunks` — the arithmetic.**

- `size = bytes.length`; `sha256 = hex(sha256(bytes))`, computed **once** over the whole file via
  `@noble/hashes/sha2` (the `/sha2` subpath — `/sha256` is JSDoc-deprecated in the installed v1.8.0,
  the same non-deprecated-subpath call as `pairingConfirmation.ts`'s `/blake2` over `/blake2s`).
  `@noble/hashes` is already this repo's hashing story (`inboundMessage.ts:hashPlaintext`); routing
  through it rather than `node:crypto` means no new `check:electron-digest` gate is needed to prove
  the digest survives the built app — a consistency choice, not a necessity, since SHA-2 is present in
  Electron's BoringSSL too.
- `total_chunks = Math.max(1, Math.ceil(size / 45000))`. The `max(1, …)` is what *defines* the
  zero-byte file: `ceil(0/45000)` is `0`, so without it a zero-byte file yields no chunks at all and
  the transfer carries nothing. For every `size > 0` the `max` is inert.
- Chunk `i` slices `bytes.subarray(i * 45000, min((i+1) * 45000, size))` — **by index, never by a
  `size % 45000` remainder**. A remainder-based loop is wrong on an exact multiple: `size = 90000`
  gives `remainder = 0`, tempting either a spurious empty third chunk or a dropped final 45000 bytes.
  The index form has no special case beyond the one `max`.
- `attachment_id`, `total_chunks`, `size`, and `sha256` are computed once and spread onto every
  payload, so "identical on every chunk of one transfer" is structural, not caller discipline.
- **45000 is a mandated stride, not a ceiling to fit under.** The receiver's validation stack
  (reassembly #1741, by-index accumulator #1769, the `total_chunks`/`size` cross-check #1776) refuses
  any transfer where `total_chunks != max(1, ceil(size/45000))` and never inspects the stride itself.
  A sender that chunks at its own buffer size and declares the count that follows from *that* stride
  is refused at admission; one that declares the formula's count but emits a different stride clears
  admission and fails on the assembled length. Neither shows up as a frame-size problem — every such
  frame fits the envelope comfortably. Tests assert a non-final chunk's decoded length `=== 45000`,
  never `<= 45000`, for exactly this reason.
- `base64StdEncode` is called on the `Uint8Array` **view** (`bytes.subarray(...)`), never on
  `view.buffer` — `Buffer.from(view)` copies the view's own bytes and honours `byteOffset`/`length`;
  `Buffer.from(view.buffer)` copies the whole backing ArrayBuffer, silently base64-ing the entire file
  into every chunk.

**`buildAttachmentChunk` — the envelope.** A direct structural sibling of
[`buildDequeueMessage`](dequeue-message-envelope.md): `{id, ts, payload}` in, `Envelope{id, type:
'attachment_chunk', ts, payload}` through [`encodeEnvelope`](wire-codec.md) out. **One envelope per
chunk** — it takes a single payload, not a whole plan, so each chunk gets its own id and timestamp
from the consumer's own counter and clock; iterating a `planAttachmentChunks()` result is #861's job.
`encodeEnvelope` already throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES` (65519) — that inherited,
deterministic backstop is the *only* validator on this path.

### Why `bundleReassembler.ts` is the wrong precedent

`bundleReassembler.ts` is the existing *inbound* chunk analogue and demands strict, contiguous
ascending `seq`, appending as each arrives. `attachment_chunk` is **index-addressed and may arrive in
any order** — the receiver addresses by `index` and never appends. Copying the neighbouring rule here
would be wrong; the contrast is deliberate and is why the payload has `index`/`total_chunks` rather
than a `seq` counter.

## Bounds — documented, not validated

`ATTACHMENT_ID_MAX_BYTES` (64), `ATTACHMENT_FILENAME_MAX_BYTES` (255), and
`ATTACHMENT_MIME_TYPE_MAX_BYTES` (255) exist as named constants but nothing in either module checks a
payload against them. Deliberate, on the same grounds
[attachment-filename-sanitiser.md](attachment-filename-sanitiser.md) already used for its own declined
length bound: no observed failure (#861 hasn't landed, nothing produces an attachment name yet), the
sibling slice already made this call, and a deterministic backstop already exists in different fabric
— `encodeEnvelope`'s `WireEncodeError`. All three ceilings count **bytes of encoded UTF-8, not runes**
— a `.length` check on a JS string is wrong for any non-ASCII value; the test suite proves this with
one two-byte (`é`) and one four-byte (`🙂`) fixture, each built to exactly 255 bytes via
`Buffer.byteLength(s, 'utf8')`.

Measured on this branch, a maximal chunk (45000 raw bytes of `data`, every metadata field at its byte
ceiling) serializes to **60,832 bytes ASCII / 63,702 bytes worst-case JSON-escaped**, against
`MAX_PLAINTEXT_BYTES` = 65,519 — a little under the architecture spec's estimated 60,851 / 63,721; the
gap is the envelope's own `id`/`ts` width, not the payload arithmetic. base64 of exactly 45000 raw
bytes is exactly 60,000 characters (45000 divides evenly by 3, so there is no padding), which is the
arithmetic justification for the stride number itself.

## Configuration and usage

Both modules are **main-process only** (`src/main/transport/`) — they import `codec.ts` (Node
`Buffer`) and hold raw file bytes, so neither may ever be re-exported through a renderer barrel
(CLAUDE.md "keep the transport out of the window"). Neither logs anything — no `console.*` call in
either file, asserted by a module-graph test — because `filename` is frequently private in itself and
the file bytes are the most sensitive value either module touches.

There is no consumer wired yet. #861 will: read a file into memory, mint `attachment_id`, call
`planAttachmentChunks` once, then call `buildAttachmentChunk` per element of the result with its own
id-counter and clock, catching `WireEncodeError` to drop an over-cap send.

## Edge cases and limitations

- **Materializes the whole plan.** For an N-byte file, `planAttachmentChunks` holds N bytes of input
  plus ~1.33N bytes of base64 simultaneously — the whole file must already be in memory to compute
  `size`/`sha256` up front. #861 owns whether that profile is acceptable for large attachments; the
  function → generator conversion is signature-compatible at its one call site if it needs to change.
- **No `attachment_id` minting.** It is a caller-supplied input, never generated here — minting is
  state and this module has none, and the id is explicitly not a capability (not secret, not
  unguessable), so there is nothing for a random generator to buy.
- **No inbound decode.** `inboundMessage.ts` is untouched. The retrieval direction reuses this same
  frame, but decoding and reassembling it — index-addressed, any order — is a later slice.
- **A source-purity test can match its own disclaimer.** A test that greps a module's source for the
  literal string `'console.'` to prove it never logs will also match a header comment that names that
  string while explaining the module *doesn't* call it. `attachmentChunkPlan.ts`'s header was worded
  around this ("makes no log call at all" rather than quoting `console.`) — worth remembering before
  writing the next module that documents the rule it obeys.

## Related

- [Dequeue message envelope](dequeue-message-envelope.md) — the structural template `buildAttachmentChunk` copies: same `{id, ts, payload}` input shape, same `encodeEnvelope` call, same propagate-`WireEncodeError`-unchanged contract.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`decodeEnvelope`/`base64StdEncode`/`WireEncodeError`/`MAX_PLAINTEXT_BYTES`, all reused unchanged.
- [Attachment filename sanitiser](attachment-filename-sanitiser.md) / [Attachment path resolution](attachment-path-resolution.md) — the receiving-side siblings in the same attachment family (#818/#819); the filename sanitiser's declined-length-bound reasoning is the precedent this slice's own declined metadata-length validators follow.
- `docs/specs/architecture/860-attachment-chunk-envelope.md` — the full architecture spec, including the security review this doc summarizes (verdict: PASS).
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § Attachments — the source-of-truth contract this slice ports the producer half of.
- #861 (send driver, not started) — the intended consumer: reads the file, mints `attachment_id`, iterates a plan into per-chunk envelopes, and owns the actual send/retry/progress.
- [Question-shown wire types](question-shown-wire-types.md) — the other wire-vocabulary-only slice
  that reuses this doc's "documented, not validated" bound discipline (#883), shipped unreferenced
  ahead of its consumer for the same reason.
