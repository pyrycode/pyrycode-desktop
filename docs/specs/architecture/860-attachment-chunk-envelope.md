# #860 — Split a file into `attachment_chunk` envelopes

**Size:** S · **Files:** 3 production (1 modified, 2 new), 3 test (1 modified, 2 new)

## Design source

N/A — pure transport arithmetic and encoding. Nothing renders, so there is no Figma node and the
visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is wired but **not indexed** for this repo (`.codegraph/` holds only `.gitignore` +
`config.json`, no DB — confirmed again 2026-09-01), so every `codegraph_*` call errors
`CodeGraph not initialized`. This list was built by grep + Read; do not spend a turn re-probing.

| Path | What to extract |
|---|---|
| `src/shared/wire/types.ts:22-30` | `MAX_FRAME_BYTES` / `MAX_PLAINTEXT_BYTES` (65519) — AC 3 measures against this constant, never a fresh literal |
| `src/shared/wire/types.ts:40-127` | The `EnvelopeType` union and `Envelope` — where `'attachment_chunk'` joins, and why `type: EnvelopeType \| string` makes a round-trip test blind to a missing member |
| `src/shared/wire/types.ts:1188-1207` | `DebugBundleChunkPayload` / `DebugBundleDonePayload` — the existing *inbound* chunk payloads and their doc-comment register |
| `src/main/transport/dequeueMessageEnvelope.ts` (whole, 44 lines) | The exact builder shape to copy: header block, `…Input` interface, `build…` returning `encodeEnvelope(envelope)` |
| `src/main/transport/dequeueMessageEnvelope.test.ts` (whole, 43 lines) | The exact builder-test shape: round-trip via the **real** `decodeEnvelope`, plus the over-cap `WireEncodeError` case |
| `src/main/transport/codec.ts:51-73` | `base64StdEncode` (padded std base64, Go `StdEncoding`-compatible) — **reuse it**; and `base64StdDecode`'s strictness, which the tests decode through |
| `src/main/transport/codec.ts:103-118` | `encodeEnvelope` — already throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES`. This is the deterministic backstop the design leans on instead of a new validator |
| `src/main/transport/inboundMessage.ts:71-81` | `hashPlaintext` — the in-repo precedent for `@noble/hashes` + `Buffer…toString('hex')` producing lowercase hex |
| `src/main/pairingConfirmation.ts:22-30` | Why hashing goes through `@noble/hashes` and why the **non-deprecated subpath** matters (`/blake2` over `/blake2s`; the same choice here is `/sha2` over `/sha256`) |
| `src/main/transport/bundleReassembler.ts:1-35, 75-82` | **Read for contrast, then do the opposite.** Bundle chunks demand contiguous ascending `seq` and *append*; attachment chunks are index-addressed and may arrive in any order. The neighbouring rule is the obvious thing to copy and it is the wrong one here |
| `src/shared/wire/types.test.ts:40-60` | The compile-time `const x: EnvelopeType = '…'` membership idiom — this is how AC 1's "recognised rather than an unknown string" clause is closed |
| `docs/knowledge/features/attachment-filename-sanitiser.md` § Non-goals | The sibling slice's *declined* length bound and its reasoning — this spec declines the same bound for the same reason |
| `CLAUDE.md` § "Keep the transport out of the window" | Why both new modules are main-process-only and must never reach a renderer barrel |

## Context

The daemon publishes the attachment wire contract in `pyrycode/pyrycode` `docs/protocol-mobile.md`
§ Attachments. This slice ports the **producer half**: the `attachment_chunk` frame type and the
arithmetic that fills it. **Nothing sends.** The send driver is #861 and consumes this.

The receiver's whole validation stack has landed upstream (reassembly #1741, by-index accumulator
#1769, the `total_chunks`/`size` cross-check #1776, the per-upload byte bound #1777, the concurrency
cap #1778). What that stack makes binding is the thing this spec is mostly about:

> **45000 is a mandated stride, not a ceiling to fit under.** The receiver checks the two declared
> numbers against each other and refuses any transfer where
> `total_chunks ≠ max(1, ceil(size / 45000))`. It never inspects the stride directly. A sender that
> chunks at its own buffer size and declares the count that follows from *that* stride is refused at
> admission; one that declares the formula's count but emits a different stride clears admission and
> then fails on the assembled length. **Neither is a frame-size problem** — every such frame fits the
> envelope comfortably, so the failure is invisible to any local size check.

Note the published § Attachments section still opens with "Nothing emits, accepts or enforces any of
this yet." That line predates the closures above; read it as describing the contract, not the daemon.

## Design

Two modules, one concern each, matching the module's existing one-concern-per-file split.

```
whole file bytes + metadata
        │
        ▼
  planAttachmentChunks()        src/main/transport/attachmentChunkPlan.ts
   · sha256 over the WHOLE file (once)
   · total_chunks = max(1, ceil(size / 45000))
   · slice [i*45000, min((i+1)*45000, size)) → base64StdEncode
        │
        ▼  AttachmentChunkPayload[]        (one per chunk; no envelope, no clock, no id)
        │
        ▼  (caller supplies its id counter + clock, per chunk — #861)
  buildAttachmentChunk()        src/main/transport/attachmentChunkEnvelope.ts
        │
        ▼  Uint8Array (serialized envelope bytes)
```

### 1. `src/shared/wire/types.ts` — MODIFY

Add `| 'attachment_chunk'` to the `EnvelopeType` union, with a doc comment in the register of the
surrounding members. Emphasise the two things a reader gets wrong: **one frame carries both
directions** (upload client→daemon and retrieval daemon→client), and **there is no
`conversation_id`, and the omission is a security property** — an upload lands in the conversation
the authenticated session is already on, decided daemon-side, so a client cannot steer bytes into
another conversation's directory by naming one.

Add the payload interface. All eight fields always present in both directions, no `omitempty`, so a
decoder may rely on all eight:

```ts
export interface AttachmentChunkPayload {
  attachment_id: string   // identical on every chunk; ≤ 64 bytes; NOT a capability
  index: number           // 0-based, in [0, total_chunks); addresses, never appends
  total_chunks: number    // ≥ 1, identical on every chunk; why no completion frame exists
  filename: string        // display string + sanitiser input, NEVER a path; ≤ 255 bytes
  mime_type: string       // client's declared type — a hint, not a verified property; ≤ 255 bytes
  size: number            // WHOLE file, not this chunk
  sha256: string          // lowercase hex of the WHOLE file, always 64 chars; integrity, not authenticity
  data: string            // this chunk's raw bytes as standard PADDED base64
}
```

Add four constants beside it:

| Constant | Value | Status |
|---|---|---|
| `ATTACHMENT_CHUNK_DATA_BYTES` | `45000` | **Load-bearing.** The mandated stride the planner divides by. |
| `ATTACHMENT_ID_MAX_BYTES` | `64` | Documentary — no validator (see § Bounds below). |
| `ATTACHMENT_FILENAME_MAX_BYTES` | `255` | Documentary — no validator. |
| `ATTACHMENT_MIME_TYPE_MAX_BYTES` | `255` | Documentary — no validator. |

The stride constant's comment must say `45000` is **raw bytes of `data` before base64** — not base64
characters, not payload bytes, not envelope bytes. A sender that reads it as base64 characters
produces frames that fit and wastes a quarter of every one, and the receiver refuses the transfer at
admission because the declared count no longer matches the formula.

### 2. `src/main/transport/attachmentChunkPlan.ts` — NEW

```ts
export interface AttachmentChunkPlanInput {
  attachment_id: string   // caller-minted (#861); this module never mints one — it is stateless
  filename: string
  mime_type: string
  bytes: Uint8Array       // the WHOLE file, already in memory
}

/** Split a whole file into its complete, ordered chunk payloads. Total: every input has an answer,
 *  including a zero-byte file (exactly one chunk carrying zero bytes). Never throws. */
export function planAttachmentChunks(input: AttachmentChunkPlanInput): AttachmentChunkPayload[]
```

Behaviour, in order:

1. `size = bytes.length`; `sha256 = hex(sha256(bytes))` — computed **once**, over the whole file.
2. `total_chunks = Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_DATA_BYTES))`.
3. For `index` in `[0, total_chunks)`: `data = base64StdEncode(bytes.subarray(index * STRIDE, Math.min((index + 1) * STRIDE, size)))`.
4. `attachment_id`, `filename`, `mime_type`, `size`, `sha256`, `total_chunks` are computed once and
   spread into every payload — so AC 4's "identical on every chunk" is **structural**, not caller
   discipline. Assert it in tests anyway; the assertion is what keeps it structural.

**MAIN-PROCESS ONLY.** It imports `codec.ts` (Node `Buffer`) and holds raw file bytes. Never
re-export through a renderer barrel.

#### The four arithmetic traps

- **Slice by index, never by remainder.** `remainder = size % 45000` then "emit a final chunk of
  `remainder` bytes" is wrong on an exact multiple: `size = 90000` gives `remainder = 0` and you
  emit a spurious third, empty chunk (or drop 45000 bytes, depending on how the loop is written).
  The `subarray(i*STRIDE, min((i+1)*STRIDE, size))` form is correct for every size with no special
  case except step 2's `max`.
- **`Math.max(1, …)` is load-bearing for exactly one input.** `Math.ceil(0 / 45000) === 0`, so
  without it a zero-byte file yields zero chunks and the transfer carries nothing. For every
  `size > 0` the `max` is inert. This is what *defines* the zero-byte file as one chunk of zero
  bytes.
- **The stride is exact, not a maximum.** Every chunk but the last carries **exactly** 45000 raw
  bytes. Tests assert `=== 45000`, never `<= 45000` — a `<=` assertion passes for a sender that
  chunks at its own buffer size, which is precisely the failure the receiver refuses at admission.
- **Never pass `.buffer` to `base64StdEncode`.** `Buffer.from(uint8ArrayView)` copies the view's
  bytes and honours `byteOffset`/`length` correctly, which is what a `subarray` needs.
  `Buffer.from(view.buffer)` copies the **whole backing store**, silently base64-ing the entire file
  into every chunk. Pass the `Uint8Array` itself.

#### sha256 — `@noble/hashes/sha2`, not `node:crypto`

```ts
import { sha256 } from '@noble/hashes/sha2'
// hex: Buffer.from(sha256(bytes)).toString('hex')  — Node's hex output is already lowercase
```

`@noble/hashes@1.8.0` is already a dependency and already the repo's hashing story
(`inboundMessage.ts:hashPlaintext`, `pairingConfirmation.ts`). SHA-2 *is* present in Electron's
BoringSSL, so `createHash('sha256')` would also work — this is a consistency and blast-radius
choice, not a necessity: routing through `@noble` means no new `npm run check:electron-digest` gate
is needed to prove the digest survives the built app, which is the exact hazard `#101` recorded for
BLAKE2. Use the **`/sha2` subpath**; `@noble/hashes/sha256` is JSDoc-deprecated in v1.8.0, the same
`/blake2` vs `/blake2s` call already documented in `pairingConfirmation.ts:22-30`.

### 3. `src/main/transport/attachmentChunkEnvelope.ts` — NEW

A direct sibling of `dequeueMessageEnvelope.ts`. Same header block, same `…Input` shape, same body.

```ts
export interface AttachmentChunkInput {
  id: number                      // the envelope id counter — never read from a global
  ts: string                      // RFC3339, the consumer's clock — never the wall clock here
  payload: AttachmentChunkPayload // one element of a planAttachmentChunks() result
}

/** Build one `attachment_chunk` envelope's bytes. MAY throw WireEncodeError above
 *  MAX_PLAINTEXT_BYTES; the eventual caller (#861) catches it and drops the send. */
export function buildAttachmentChunk(input: AttachmentChunkInput): Uint8Array
```

**One envelope per chunk.** The builder takes a single payload, not the array — each chunk gets its
own envelope id and its own timestamp from the consumer's counter and clock, exactly as every other
builder in this directory works. Iterating the plan is #861's job.

## Bounds, and what enforces them

The three metadata ceilings (64 / 255 / 255) are **documented, not validated**. This is a deliberate
non-goal, on three grounds:

1. **No observed failure.** Nothing produces an attachment name in this app yet — #861 has not
   landed and the retrieval side (#818/#819) does not feed this module. A validator here would be a
   defence for a failure mode that has not happened.
2. **The sibling slice already made this call.** `attachment-filename-sanitiser.md` § Non-goals
   declines a length bound with the same reasoning and names `ENAMETOOLONG` from the eventual write
   as the surfacing point. Adding one here and not there would leave the pair inconsistent.
3. **A deterministic backstop already exists, in different fabric.** `encodeEnvelope` throws
   `WireEncodeError` above `MAX_PLAINTEXT_BYTES`. That is code, not an agent rule, and it fails
   closed — an over-cap envelope never reaches the wire and is never silently truncated.

What the design *does* owe is proof that a legitimate maximal chunk clears the cap. Measured
2026-09-01 against `MAX_PLAINTEXT_BYTES = 65519`:

| Case | Envelope bytes | Headroom |
|---|---|---|
| 45000 raw bytes `data`, all three metadata fields at their byte ceiling, ASCII | 60,851 | 4,668 |
| Same, but every metadata byte a control character (6-char `\u00XX` JSON escaping — the worst case) | 63,721 | 1,798 |

base64 of 45000 raw bytes is exactly 60,000 characters (45000 is divisible by 3, so there is no
padding). That is the arithmetic justification for the number 45000, and AC 3's test is what pins it.

If #861 wants a friendlier pre-flight rejection than `WireEncodeError`, it owns that; it has the
user-facing surface and this module does not.

## Error handling

There is one failure path and it is inherited, not new.

| Layer | Failure | Result |
|---|---|---|
| `planAttachmentChunks` | — | **Total.** Every `Uint8Array` has an answer, including empty. No throw, no reject branch, no result union. |
| `buildAttachmentChunk` | Serialized envelope over `MAX_PLAINTEXT_BYTES` | `WireEncodeError` from `encodeEnvelope`, propagated unwrapped — the `buildSendMessage` / `buildDequeueMessage` contract |
| Consumer (#861) | catches `WireEncodeError` | Drops the send. Not this slice's. |

No new error type. No logging anywhere in either module — `filename` is often private in itself and
the never-reaches-a-log rule binds it here as hard as anywhere.

## State + concurrency model

None. Both modules are pure functions: no filesystem read, no socket, no store, no clock, no
counter, no `randomUUID`. `attachment_id` is an **input**, minted by #861. Nothing to cancel, nothing
to tear down.

One hand-off to #861 worth recording: `planAttachmentChunks` **materialises the whole plan** — for
an N-byte file it holds N bytes of input plus ~1.33N bytes of base64 simultaneously. The ticket
sanctions this ("whether that stays true for large attachments is the send driver's problem"). If
#861 finds the profile unacceptable it converts this function to a generator, which is a
signature-compatible change at one call site.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) plus `npm run typecheck`. No DOM, no fixture files, no
temp dir — neither module touches anything.

### `src/shared/wire/types.test.ts` — MODIFY (AC 1, type half)

Add one `describe` block in the file's established register:

- **Compile-time membership**: `const chunk: EnvelopeType = 'attachment_chunk'` — assigns only if the
  member is in the union. This is what closes AC 1's "recognised rather than passing as an unknown
  string": `Envelope.type` is `EnvelopeType | string`, so the round-trip test below passes with or
  without the union member and cannot detect the hole. `npm run typecheck` is the gate, and it runs
  inside `npm run build`.
- **Shape**: an `AttachmentChunkPayload` literal with all eight fields, asserting each reads back.
  A literal missing any field, or carrying a ninth, fails to typecheck.

### `src/main/transport/attachmentChunkPlan.test.ts` — NEW (AC 2, AC 4)

Bullet scenarios; write them in the project's idiom.

**Chunk count and stride**
- 0 bytes → exactly 1 chunk, `total_chunks === 1`, `data === ''`, and `base64StdDecode(data)` gives a
  zero-length array. The row that makes the `Math.max(1, …)` live.
- 1 byte → 1 chunk carrying 1 byte.
- 44999 bytes → 1 chunk carrying 44999.
- 45000 bytes → 1 chunk carrying **exactly** 45000. The boundary that a `>` vs `>=` slip moves.
- 45001 bytes → 2 chunks; chunk 0 decodes to exactly 45000 bytes, chunk 1 to exactly 1.
- 90000 bytes (an exact multiple) → **exactly 2** chunks, both exactly 45000, and **no third, empty
  chunk**. The row that catches the remainder-based formulation.
- 90001 bytes → 3 chunks: 45000, 45000, 1.
- For a multi-chunk case, assert every chunk but the last decodes to `=== 45000` bytes — never
  `<= 45000`.

**Reassembly fidelity**
- Concatenating `base64StdDecode(chunk.data)` **in `index` order** reproduces the input bytes exactly
  (use a non-repeating pattern such as `i % 251`, so an off-by-one slice or a reversed order is
  visible; an all-zero buffer would hide both).
- `index` values are exactly `0…total_chunks-1`, ascending, no gaps, no duplicates.

**Per-transfer invariants (AC 4)**
- Across every chunk of one multi-chunk plan, `attachment_id`, `total_chunks`, `size` and `sha256`
  are identical.
- `size` equals the whole input's length on every chunk — *not* that chunk's length. Use a
  multi-chunk input so the two numbers differ and the assertion can fail.
- `sha256` is the digest of the **whole** file, pinned against a **literal** known-answer vector
  (e.g. the empty string's `e3b0c442…b855`, and one short ASCII input), never against the function's
  own recomputed output. It is 64 characters and matches `/^[0-9a-f]{64}$/` — the lowercase half is
  a real assertion, not decoration.
- `data` is standard **padded** base64: for an input whose last chunk length is not a multiple of 3,
  assert the trailing `=` padding is present and that `base64StdDecode` (the strict decoder, which
  rejects url-safe and non-canonical forms) round-trips it.

**Purity**
- A module-graph style assertion in the spirit of `attachmentFilename.test.ts`: the source contains
  no `console.` call and imports no `node:fs`.

### `src/main/transport/attachmentChunkEnvelope.test.ts` — NEW (AC 1 wire half, AC 3)

Modelled directly on `dequeueMessageEnvelope.test.ts`.

- Round-trips through the **real** `decodeEnvelope`: `type === 'attachment_chunk'`, and `id`, `ts`,
  `payload` come back exactly as supplied.
- **AC 3, the cap case.** Build a payload with `data` = base64 of 45000 raw bytes and
  `attachment_id` / `filename` / `mime_type` each at its byte ceiling, `sha256` at 64 characters.
  Assert `buildAttachmentChunk(...)` does **not** throw and that the returned
  `bytes.length <= MAX_PLAINTEXT_BYTES` — measured against the imported constant, never a literal
  `65519`. Expect ≈ 60,851 bytes for the ASCII fixture.
  - **The byte-vs-rune trap lands here.** The ceilings are on encoded UTF-8, so a
    `'f'.repeat(255)` fixture is only 255 bytes because it is ASCII. If a row uses a non-ASCII
    filename, build it to 255 **bytes** (check with `Buffer.byteLength(s, 'utf8')`), not 255
    `.length`. Include at least one multi-byte row so the distinction is exercised rather than
    assumed.
- **Over-cap.** A payload whose `filename` is `'x'.repeat(MAX_PLAINTEXT_BYTES + 1)` throws
  `WireEncodeError` — the inherited backstop, asserted here so it is a tested guarantee rather than
  an assumed one.

## Explicit non-goals

- **No sending, no socket, no queue, no retry, no progress.** #861.
- **No filesystem read.** The whole file arrives in memory as a `Uint8Array`.
- **No `attachment_id` minting.** Caller-supplied; minting is state and this module has none.
- **No inbound path.** `inboundMessage.ts` is untouched. The retrieval direction reuses this same
  frame, but decoding and reassembling it is a later slice, and its accumulator is **index-addressed
  in any order** — not `bundleReassembler.ts`'s contiguous-`seq` append.
- **No metadata length validator.** See § Bounds.
- **No knowledge-base doc.** The documentation phase folds this into the package overview after code
  review.

## Open questions

1. **Does #861 need a streaming plan?** Deferred by the ticket; the array→generator conversion is
   signature-compatible at one call site if it does.
2. **Where does `mime_type` come from?** #861's concern. It is a declared hint the daemon does not
   verify, so a wrong or absent value is not this module's failure mode. Worth confirming that #861
   sends something rather than `''` — the wire permits `''` and nothing here rejects it.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This module sits on the **outbound** path only and creates no
  new boundary: it consumes bytes the main process already holds and produces bytes the existing
  `encodeEnvelope` serializes. There is no inbound parse, no renderer input, and no `contextBridge`
  or `ipcMain` surface added — nothing crosses untrusted→trusted here. The one boundary this design
  deliberately *declines* to be is the inbound `attachment_chunk` decode, named as a non-goal above
  so a later slice cannot assume this module already validated the frame.
- **[Trust boundaries — the `filename` carve-out]** No finding, but recorded because it is the one
  place this ticket touches a documented CLAUDE.md prohibition. `filename` is "a display string and a
  sanitiser input, **never a path**." This module **never resolves it, never joins it, never opens
  it** — it is copied verbatim into a JSON field and serialized. The sanctioned crossing of the
  never-a-filename rule is `sanitizeAttachmentFilename` (#819), on the *receiving* side; there is no
  second crossing here and none may be added.
- **[Tokens, secrets, credentials]** No findings. `attachment_id` is explicitly **not a capability** —
  not secret, not unguessable (daemon contract, published). It is therefore correct that this module
  does not mint it with `randomBytes`, and correct that a caller may reuse a predictable id; the
  design must not be "hardened" into minting one, because that would imply a secrecy property the
  daemon does not honour. No token, key, or credential is read, held, or emitted anywhere in either
  module.
- **[File / storage operations]** Not applicable by construction: no filesystem call, no path
  construction, no `fs` import, no temp file, no TOCTOU window. The tests assert the absence
  (`node:fs` is not imported). The file is read by #861 and arrives here as bytes.
- **[Inter-process / Electron attack surface]** No findings. No `BrowserWindow`, no `webPreferences`,
  no IPC channel, no `contextBridge` API, no custom protocol. Both modules are **main-process-only**
  and their header blocks must say so: they import `codec.ts` (Node `Buffer`) and hold raw file
  bytes, so a renderer barrel re-export would drag both into the web layer — the CLAUDE.md
  "keep the transport out of the window" rule, and a MUST-FIX if code review ever sees one.
- **[Cryptographic primitives]** No findings, with the choice named so it is not misread as
  hand-rolled crypto. SHA-256 comes from `@noble/hashes@1.8.0` — a vetted, audited implementation
  already a dependency and already this repo's hashing story, gated in-runtime by
  `npm run check:electron-digest` for its BLAKE2 sibling. It is **not** re-implemented here. No RNG
  is used (nothing random is generated), so the `Math.random()` question does not arise. No key, no
  nonce, no comparison against a secret — so no `timingSafeEqual` site exists.
  `sha256` here is **integrity, not authenticity**: the same party supplies the bytes and the digest,
  so it detects corruption in transit and nothing more. It is also **not a fetch key** — retrieval
  names a conversation and an attachment, never a hash — and no code may start treating it as one.
- **[Network & I/O]** No findings. No socket is opened, no URL is parsed, no timeout is owned here.
  The one I/O-adjacent guarantee is the frame-size cap, and it is **inherited deterministic code**:
  `encodeEnvelope` throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES` rather than emitting or
  truncating an over-cap envelope. Measured headroom at the contract's worst case (every metadata
  field at its byte ceiling, every byte a 6-char JSON escape) is 1,798 bytes — positive, so a
  legitimate maximal chunk cannot trip the cap, and a payload that *does* trip it is out-of-contract
  by construction and correctly rejected.
- **[Error messages, logs, telemetry]** No findings. **Neither module logs at all** — no `console.*`,
  asserted by test. This is load-bearing rather than stylistic: `filename` is frequently private in
  itself, and the plaintext file bytes are the most sensitive value either module touches. The one
  error that escapes is `WireEncodeError`, whose message names the failure category only and never
  echoes a field value (`codec.ts:39-47`); nothing in this design widens it.
- **[Concurrency]** Not applicable. Both functions are synchronous and pure — no `await`, no timer,
  no listener, no `AbortController`, no shared mutable state, so there is no cancellation path to
  thread, no check-then-act race, and no shutdown hazard. The memory profile of materialising the
  whole plan is recorded above as a #861 hand-off; it is a resource-shape note, not a security
  finding, since the input size is chosen by the local user rather than by a remote party.
- **[Threat model alignment]**
  - *Malicious / compromised relay* — addressed structurally rather than by this module: the relay is
    content-blind and sees only Noise ciphertext. Chunk metadata rides **inside** the encrypted
    envelope, so an on-path relay learns nothing about `filename`, `sha256`, or the file's bytes
    beyond approximate size and chunk count. A relay that drops, delays, or reorders chunks is a
    #861 concern (retry, timeout), and the frame is **index-addressed precisely so reordering is
    harmless** — the deliberate contrast with `bundleReassembler.ts`'s contiguous-`seq` append.
  - *Cross-conversation write* — closed by the wire contract and worth naming: there is **no
    `conversation_id` on this frame**, so a client cannot steer bytes into another conversation's
    directory by naming one. The daemon decides placement from authenticated session context. Adding
    a `conversation_id` field "for clarity" would reopen exactly that, and is why the payload
    interface's doc comment must state the omission as a security property rather than an oversight.
  - *Hostile daemon response* — out of scope for this slice by design: nothing here parses an inbound
    frame. When the retrieval direction lands, every one of the eight fields is attacker-influenced
    and must be validated at that decoder; the non-goals section says so explicitly so the next slice
    cannot inherit a false assumption of prior validation.
  - *Renderer compromise reaching the transport* — unchanged and unweakened: both modules stay
    main-process-only with no IPC surface, so a compromised renderer gains no new reach. This is the
    property the barrel-export prohibition protects.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-09-01
