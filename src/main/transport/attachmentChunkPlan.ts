// The attachment chunk planner: a whole file's bytes in, the complete ordered list of
// AttachmentChunkPayloads out. It is the producer half of the daemon's attachment contract
// (pyrycode docs/protocol-mobile.md § Attachments) — the arithmetic that fills the frame, in one
// place instead of inlined at a send site. NOTHING SENDS HERE: building the envelopes is
// attachmentChunkEnvelope.ts and driving the send is #861, which supplies the attachment_id.
//
// The load-bearing rule is that 45000 is a MANDATED STRIDE, not a ceiling to fit under. The receiver
// refuses any transfer where `total_chunks != max(1, ceil(size / 45000))` and never inspects the
// stride itself, so chunking at some other size — even a smaller one, even one that fits the
// envelope comfortably — is refused at admission or fails on the assembled length. Every chunk but
// the last carries EXACTLY ATTACHMENT_CHUNK_DATA_BYTES.
//
// TOTAL: every input has an answer and nothing throws. A zero-byte file is one chunk carrying zero
// bytes — that is what the `max(1, ...)` defines, and it is the only input the max is live for.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`) and holds the raw file bytes. Never
// re-export it through any renderer barrel — the bytes must stay out of the web layer (CLAUDE.md
// "Keep the transport out of the window"). It is also LOG-FREE by construction: it makes no log call
// at all. `filename` is frequently private in itself and the file bytes are the most sensitive value
// this module touches.
import { sha256 } from '@noble/hashes/sha2'
import { base64StdEncode } from './codec'
import { ATTACHMENT_CHUNK_DATA_BYTES } from '../../shared/wire/types'
import type { AttachmentChunkPayload } from '../../shared/wire/types'

/**
 * What the caller (#861) supplies: the file's whole bytes plus the metadata that describes them.
 * `attachment_id` is an INPUT, never minted here — minting is state and this module has none, and
 * the id is explicitly not a capability (not secret, not unguessable), so there is nothing for a
 * random generator to buy.
 */
export interface AttachmentChunkPlanInput {
  /** The transfer id, caller-minted. Copied verbatim onto every chunk. */
  attachment_id: string
  /** The client's own name for the file — a display string, never a path. Copied verbatim. */
  filename: string
  /** The client's declared media type. A hint the daemon does not verify. Copied verbatim. */
  mime_type: string
  /** The WHOLE file, already in memory. `size` and `sha256` are over all of it. */
  bytes: Uint8Array
}

/**
 * Split a whole file into its complete, ordered `attachment_chunk` payloads.
 *
 * `total_chunks = max(1, ceil(size / ATTACHMENT_CHUNK_DATA_BYTES))`; chunk `i` carries the raw bytes
 * `[i * stride, min((i + 1) * stride, size))` as standard padded base64. Slicing by index rather
 * than by a `size % stride` remainder is what makes an exact multiple correct: a remainder-based
 * loop emits a spurious trailing empty chunk (or drops a full one) precisely when `size % stride`
 * is 0.
 *
 * `attachment_id`, `total_chunks`, `size` and `sha256` are computed once and spread onto every
 * chunk, so "identical on every chunk of one transfer" is structural rather than caller discipline.
 *
 * Never throws. The whole plan is materialised: for an N-byte file this holds N bytes of input plus
 * ~1.33N bytes of base64 at once. #861 owns that profile; converting this to a generator is a
 * signature-compatible change at its one call site.
 */
export function planAttachmentChunks(input: AttachmentChunkPlanInput): AttachmentChunkPayload[] {
  const size = input.bytes.length
  // Over the WHOLE file, once — not per chunk. @noble/hashes rather than node:crypto for the same
  // reason pairingConfirmation.ts states: it is already this repo's hashing story and computes
  // identical bytes under Node and Electron, so no digest-availability gate is needed in the built
  // app. `/sha2` is the non-deprecated subpath in the installed v1.8.0 (`/sha256` is JSDoc-
  // deprecated), the same call as `/blake2` over `/blake2s`. Node's hex output is already lowercase.
  const digest = Buffer.from(sha256(input.bytes)).toString('hex')
  const totalChunks = Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_DATA_BYTES))

  const chunks: AttachmentChunkPayload[] = []
  for (let index = 0; index < totalChunks; index++) {
    const start = index * ATTACHMENT_CHUNK_DATA_BYTES
    const end = Math.min(start + ATTACHMENT_CHUNK_DATA_BYTES, size)
    // The `Uint8Array` view itself, never `view.buffer`: Buffer.from(view) copies the view's own
    // bytes and honours byteOffset/length, while Buffer.from(view.buffer) copies the whole backing
    // store — silently base64-ing the entire file into every chunk.
    chunks.push({
      attachment_id: input.attachment_id,
      index,
      total_chunks: totalChunks,
      filename: input.filename,
      mime_type: input.mime_type,
      size,
      sha256: digest,
      data: base64StdEncode(input.bytes.subarray(start, end))
    })
  }
  return chunks
}
