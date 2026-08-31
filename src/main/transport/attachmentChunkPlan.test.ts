import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { planAttachmentChunks } from './attachmentChunkPlan'
import { base64StdDecode } from './codec'
import { ATTACHMENT_CHUNK_DATA_BYTES } from '../../shared/wire/types'

// The chunk planner is pure arithmetic over the WHOLE file's bytes: sha256 and size describe the
// file, `data` describes the slice. The receiver never inspects the stride — it refuses any transfer
// where `total_chunks != max(1, ceil(size / 45000))` (pyrycode #1776) — so 45000 is a MANDATED
// stride, not a ceiling to fit under. Every assertion on a non-final chunk's length is therefore
// `=== 45000`, never `<= 45000`: a `<=` assertion passes for a sender that chunks at its own buffer
// size, which is exactly the failure the daemon refuses at admission and no local size check sees.
describe('planAttachmentChunks', () => {
  const STRIDE = ATTACHMENT_CHUNK_DATA_BYTES

  /** A non-repeating pattern, so an off-by-one slice or a reversed order is visible in a diff —
   *  an all-zero buffer would hide both. 251 is prime and coprime with the stride. */
  const pattern = (length: number): Uint8Array =>
    Uint8Array.from({ length }, (_, index) => index % 251)

  const plan = (bytes: Uint8Array): ReturnType<typeof planAttachmentChunks> =>
    planAttachmentChunks({
      attachment_id: 'att-1',
      filename: 'notes.txt',
      mime_type: 'text/plain',
      bytes
    })

  const chunkLengths = (bytes: Uint8Array): number[] =>
    plan(bytes).map((chunk) => base64StdDecode(chunk.data).length)

  it('pins the mandated stride at 45000 raw bytes', () => {
    expect(STRIDE).toBe(45000)
  })

  it('splits a zero-byte file into exactly one chunk carrying zero bytes', () => {
    // The one input Math.max(1, ...) exists for: ceil(0 / 45000) is 0, so without it a zero-byte
    // file yields no chunks at all and the transfer carries nothing.
    const chunks = plan(new Uint8Array(0))

    expect(chunks).toHaveLength(1)
    expect(chunks[0].total_chunks).toBe(1)
    expect(chunks[0].index).toBe(0)
    expect(chunks[0].size).toBe(0)
    expect(chunks[0].data).toBe('')
    expect(base64StdDecode(chunks[0].data)).toHaveLength(0)
  })

  it('splits a one-byte file into one chunk carrying one byte', () => {
    expect(chunkLengths(pattern(1))).toEqual([1])
  })

  it('splits a 44999-byte file into one chunk carrying the remainder', () => {
    expect(chunkLengths(pattern(STRIDE - 1))).toEqual([STRIDE - 1])
  })

  it('splits an exactly-45000-byte file into one chunk of exactly 45000', () => {
    // The boundary a `>` vs `>=` slip moves: 45000 is one full chunk, never one plus an empty one.
    expect(chunkLengths(pattern(STRIDE))).toEqual([STRIDE])
  })

  it('splits a 45001-byte file into a full chunk plus a one-byte remainder', () => {
    expect(chunkLengths(pattern(STRIDE + 1))).toEqual([STRIDE, 1])
  })

  it('splits an exact multiple into exactly two full chunks — no trailing empty chunk', () => {
    // The row that catches a remainder-based formulation: size % 45000 === 0 tempts a final chunk
    // of `remainder` bytes, which is either a spurious third empty chunk or 45000 dropped bytes.
    const chunks = plan(pattern(STRIDE * 2))

    expect(chunks).toHaveLength(2)
    expect(chunks.every((chunk) => chunk.total_chunks === 2)).toBe(true)
    expect(chunkLengths(pattern(STRIDE * 2))).toEqual([STRIDE, STRIDE])
  })

  it('splits a multiple-plus-one into three chunks: two full and a one-byte tail', () => {
    expect(chunkLengths(pattern(STRIDE * 2 + 1))).toEqual([STRIDE, STRIDE, 1])
  })

  it('gives every chunk but the last exactly the stride — never merely at most the stride', () => {
    const chunks = plan(pattern(STRIDE * 2 + 7))
    const decoded = chunks.map((chunk) => base64StdDecode(chunk.data))

    for (const bytes of decoded.slice(0, -1)) {
      expect(bytes.length).toBe(STRIDE)
    }
    expect(decoded[decoded.length - 1].length).toBe(7)
  })

  it('reproduces the input exactly when the chunks are concatenated in index order', () => {
    const input = pattern(STRIDE * 2 + 1234)
    const chunks = plan(input)

    const reassembled = new Uint8Array(input.length)
    let offset = 0
    for (const chunk of [...chunks].sort((a, b) => a.index - b.index)) {
      const slice = base64StdDecode(chunk.data)
      reassembled.set(slice, offset)
      offset += slice.length
    }

    expect(offset).toBe(input.length)
    expect(reassembled).toEqual(input)
  })

  it('numbers the chunks 0..total_chunks-1, ascending, with no gaps and no duplicates', () => {
    const chunks = plan(pattern(STRIDE * 3 + 5))

    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2, 3])
    expect(chunks[0].total_chunks).toBe(4)
  })

  it('carries identical attachment_id, total_chunks, size and sha256 on every chunk', () => {
    // AC 4. The planner computes each of the four once and spreads them, so this is structural —
    // the assertion is what keeps it structural.
    const chunks = plan(pattern(STRIDE * 2 + 10))
    const first = chunks[0]

    for (const chunk of chunks) {
      expect(chunk.attachment_id).toBe(first.attachment_id)
      expect(chunk.total_chunks).toBe(first.total_chunks)
      expect(chunk.size).toBe(first.size)
      expect(chunk.sha256).toBe(first.sha256)
      expect(chunk.filename).toBe('notes.txt')
      expect(chunk.mime_type).toBe('text/plain')
    }
    expect(first.attachment_id).toBe('att-1')
  })

  it('declares size as the WHOLE file length, not this chunk length', () => {
    // Multi-chunk on purpose, so the two numbers differ and the assertion can actually fail.
    const chunks = plan(pattern(STRIDE + 3))

    expect(chunks).toHaveLength(2)
    expect(chunks[0].size).toBe(STRIDE + 3)
    expect(base64StdDecode(chunks[0].data).length).toBe(STRIDE)
  })

  it('digests the WHOLE file — pinned against known-answer vectors, never a recomputation', () => {
    const empty = plan(new Uint8Array(0))
    const abc = plan(new TextEncoder().encode('abc'))

    expect(empty[0].sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(abc[0].sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('emits sha256 as 64 lowercase hex characters', () => {
    const chunks = plan(pattern(STRIDE + 1))

    for (const chunk of chunks) {
      expect(chunk.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('emits data as standard PADDED base64 the strict decoder round-trips', () => {
    // A last chunk whose length is not a multiple of 3 must carry its `=` padding: base64StdDecode
    // is the canonical-form decoder and rejects url-safe and unpadded forms outright.
    const chunks = plan(pattern(STRIDE + 1))
    const last = chunks[chunks.length - 1]

    expect(last.data.endsWith('==')).toBe(true)
    expect(last.data).not.toMatch(/[-_]/)
    expect(() => base64StdDecode(last.data)).not.toThrow()
    expect(base64StdDecode(last.data)).toEqual(pattern(STRIDE + 1).subarray(STRIDE))
  })

  it('base64s only the chunk, never the whole backing store behind the view', () => {
    // The `Buffer.from(view.buffer)` trap: it copies the entire ArrayBuffer, silently putting the
    // whole file into every chunk. 60000 characters is exactly base64 of 45000 bytes (45000 is
    // divisible by 3, so no padding) — a whole-buffer copy would be four times that on chunk 0.
    const chunks = plan(pattern(STRIDE * 2))

    expect(chunks[0].data).toHaveLength(60000)
    expect(chunks[1].data).toHaveLength(60000)
    expect(chunks[0].data).not.toBe(chunks[1].data)
  })

  it('imports only the codec, the wire types and @noble/hashes, and makes no log call', () => {
    // Source text, not runtime: the property is about the module graph. Asserting the EXACT set
    // fires on a `node:fs` read, an `electron` import or a renderer import — the module is pure
    // arithmetic over bytes it is handed. The second grep pins the never-log rule: `filename` is
    // frequently private in itself and the file bytes are the most sensitive value here.
    const source = readFileSync(resolve('src/main/transport/attachmentChunkPlan.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([
      '../../shared/wire/types',
      './codec',
      '@noble/hashes/sha2'
    ])
    expect(source).not.toContain('console.')
  })
})
