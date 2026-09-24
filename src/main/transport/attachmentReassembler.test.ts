import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
  createAttachmentReassembler,
  ATTACHMENT_MAX_RETRIEVAL_BYTES,
  ATTACHMENT_MAX_RETRIEVAL_CHUNKS,
  type AttachmentConsumer,
  type AttachmentFailReason
} from './attachmentReassembler'
import { ATTACHMENT_CHUNK_DATA_BYTES } from '../../shared/wire/types'
import { ATTACHMENT_MAX_UPLOAD_BYTES } from '../attachmentUpload'
import type { RetrievedAttachmentChunk } from './inboundMessage'

// The reassembler is a pure, synchronous, crypto-light accumulator — no codec, no Noise, no IPC, no
// filesystem. A spy consumer records the single terminal (complete XOR fail), in bundleReassembler's
// harness shape. Every scenario starts from a CONFORMING chunk set and perturbs exactly one field, so
// a row that reddens names the rule it broke rather than a fixture that drifted.

const STRIDE = ATTACHMENT_CHUNK_DATA_BYTES

/** The identifier this client asked for. The canonical lowercase-UUIDv4 shape the daemon mints. */
const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function makeConsumer(): {
  consumer: AttachmentConsumer
  completed: Uint8Array[]
  failed: AttachmentFailReason[]
} {
  const completed: Uint8Array[] = []
  const failed: AttachmentFailReason[] = []
  return {
    completed,
    failed,
    consumer: {
      complete: (bytes) => completed.push(bytes),
      fail: (reason) => failed.push(reason)
    }
  }
}

/** Deterministic, position-dependent bytes: a reorder that lands wrong cannot pass by symmetry. */
function bytesOf(n: number): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) out[i] = (i * 31 + 7) % 251
  return out
}

const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** The conforming chunk set for `bytes`: published stride, published total, the real digest. */
function conformingChunks(bytes: Uint8Array): RetrievedAttachmentChunk[] {
  const total = Math.max(1, Math.ceil(bytes.length / STRIDE))
  const sha256 = digestOf(bytes)
  const chunks: RetrievedAttachmentChunk[] = []
  for (let index = 0; index < total; index += 1) {
    chunks.push({
      attachment_id: ID,
      index,
      total_chunks: total,
      filename: 'quarterly-report.pdf',
      mime_type: 'application/pdf',
      size: bytes.length,
      sha256,
      data: bytes.slice(index * STRIDE, Math.min((index + 1) * STRIDE, bytes.length))
    })
  }
  return chunks
}

/** A single conforming first chunk for a small file, with one or more fields perturbed. */
function firstChunk(over: Partial<RetrievedAttachmentChunk> = {}): RetrievedAttachmentChunk {
  return { ...conformingChunks(bytesOf(10))[0], ...over }
}

/** ~32 microtask turns. The module is synchronous by contract; this exists so a "never settles" row
 *  proves an ABSENCE rather than merely observing one before anything could have run. */
async function drain(): Promise<void> {
  for (let i = 0; i < 32; i += 1) await Promise.resolve()
}

describe('createAttachmentReassembler — completion', () => {
  it('reassembles ordered chunks into the original bytes', () => {
    const bytes = bytesOf(STRIDE * 2 + 17)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    for (const chunk of conformingChunks(bytes)) r.chunk(chunk)

    expect(failed).toEqual([])
    expect(completed).toHaveLength(1)
    expect(completed[0]).toEqual(bytes)
  })

  it('reassembles the same bytes when the chunks arrive in any order', () => {
    const bytes = bytesOf(STRIDE * 2 + 17)
    const chunks = conformingChunks(bytes)
    expect(chunks).toHaveLength(3)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    // 2, 0, 1 — the middle chunk last, so a build that appends in arrival order cannot pass.
    r.chunk(chunks[2])
    r.chunk(chunks[0])
    r.chunk(chunks[1])

    expect(failed).toEqual([])
    expect(completed[0]).toEqual(bytes)
  })

  it('completes a single-chunk transfer', () => {
    const bytes = bytesOf(9)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    for (const chunk of conformingChunks(bytes)) r.chunk(chunk)

    expect(failed).toEqual([])
    expect(completed[0]).toEqual(bytes)
  })

  it('completes a zero-byte file: one empty chunk with a declared total of 1', () => {
    const bytes = new Uint8Array(0)
    const chunks = conformingChunks(bytes)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].total_chunks).toBe(1)
    expect(chunks[0].size).toBe(0)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(chunks[0])

    expect(failed).toEqual([])
    expect(completed).toHaveLength(1)
    expect(completed[0]).toHaveLength(0)
  })

  it('settles synchronously, so a composing driver can order the write after it', () => {
    const bytes = bytesOf(4)
    const { consumer, completed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(conformingChunks(bytes)[0])

    // No await between the feed and the assertion: the terminal has already fired.
    expect(completed).toHaveLength(1)
  })

  it('never completes when one index is missing — completion counts indices, not frames', async () => {
    const bytes = bytesOf(STRIDE * 2 + 1)
    const chunks = conformingChunks(bytes)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(chunks[0])
    r.chunk(chunks[2])
    await drain()

    expect(completed).toEqual([])
    expect(failed).toEqual([])
  })
})

describe('createAttachmentReassembler — the stream contradicts itself', () => {
  it('refuses a repeated index rather than absorbing it', () => {
    const bytes = bytesOf(STRIDE + 1)
    const chunks = conformingChunks(bytes)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(chunks[0])
    r.chunk(chunks[0])

    expect(completed).toEqual([])
    expect(failed).toEqual(['stream-contradiction'])
  })

  it('refuses a chunk naming another attachment_id, which in_reply_to alone cannot catch', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    // A hostile id with every shape a reason must never echo — the exact-reason assertion below is
    // itself the no-leak proof.
    r.chunk(firstChunk({ attachment_id: '../../etc/passwd' }))

    expect(completed).toEqual([])
    expect(failed).toEqual(['stream-contradiction'])
  })

  it('refuses a first chunk whose id differs, before any declaration is captured', () => {
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(firstChunk({ attachment_id: 'a0000000-4f89-41d3-9a0c-0305e82c3301' }))

    expect(failed).toEqual(['stream-contradiction'])
  })

  it('with no id to pin in advance, adopts the first chunk’s id and completes the transfer (#1626)', () => {
    // `read_workspace_file`: the daemon mints the transfer id, so the client cannot name it. The
    // first chunk's id is adopted, whatever it is, and the rest of the stream is held to it.
    const bytes = bytesOf(STRIDE + 1)
    const minted = 'e7a0c1d2-0b3c-4d5e-8f60-718293a4b5c6'
    const chunks = conformingChunks(bytes).map((chunk) => ({ ...chunk, attachment_id: minted }))
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(null, consumer)

    r.chunk(chunks[1])
    r.chunk(chunks[0])

    expect(failed).toEqual([])
    expect(completed).toEqual([bytes])
  })

  it('with no id to pin in advance, refuses a later chunk naming a different transfer (#1626)', () => {
    const bytes = bytesOf(STRIDE + 1)
    const chunks = conformingChunks(bytes)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(null, consumer)

    r.chunk(chunks[0])
    r.chunk({ ...chunks[1], attachment_id: 'a0000000-4f89-41d3-9a0c-0305e82c3301' })

    expect(completed).toEqual([])
    expect(failed).toEqual(['stream-contradiction'])
  })

  it.each([
    ['total_chunks', { total_chunks: 9 }],
    ['size', { size: 11 }],
    ['sha256', { sha256: digestOf(bytesOf(11)) }]
  ] as const)('refuses a later chunk declaring a different %s', (_field, over) => {
    const bytes = bytesOf(STRIDE + 1)
    const chunks = conformingChunks(bytes)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(chunks[0])
    r.chunk({ ...chunks[1], ...over })

    expect(completed).toEqual([])
    expect(failed).toEqual(['stream-contradiction'])
  })

  it('does not cross-check filename or mime_type — display strings with no addressing role', () => {
    const bytes = bytesOf(STRIDE + 1)
    const chunks = conformingChunks(bytes)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(chunks[0])
    r.chunk({ ...chunks[1], filename: 'something-else.bin', mime_type: 'text/html' })

    expect(failed).toEqual([])
    expect(completed[0]).toEqual(bytes)
  })
})

describe('createAttachmentReassembler — the declaration gate', () => {
  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY]
  ])('refuses a %s size — parseAttachmentChunkPayload gives size no integer check', (_label, size) => {
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(firstChunk({ size, total_chunks: 1 }))

    expect(failed).toEqual(['stream-contradiction'])
  })

  it.each([
    ['one below the published count', 1],
    ['one above the published count', 3]
  ])('refuses a total_chunks %s', (_label, total_chunks) => {
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    // size 45001 publishes a count of exactly 2.
    r.chunk(firstChunk({ size: STRIDE + 1, total_chunks }))

    expect(failed).toEqual(['stream-contradiction'])
  })

  it.each([
    ['a zero-byte file', 0, 1],
    ['exactly one stride', STRIDE, 1],
    ['one byte past a stride', STRIDE + 1, 2]
  ])('admits the published count for %s', async (_label, size, total_chunks) => {
    const { consumer, failed, completed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(firstChunk({ size, total_chunks, data: new Uint8Array(0) }))
    await drain()

    // The one-chunk rows settle on verification (the data is a stub); none settles on the gate.
    expect(failed).not.toContain('stream-contradiction')
    expect(completed).toEqual([])
  })
})

describe('createAttachmentReassembler — the magnitude bound', () => {
  it('is this client’s own number, equal to the send leg’s and derived the same way', () => {
    expect(ATTACHMENT_MAX_RETRIEVAL_CHUNKS).toBe(512)
    expect(ATTACHMENT_MAX_RETRIEVAL_BYTES).toBe(ATTACHMENT_MAX_RETRIEVAL_CHUNKS * STRIDE)
    // One number and one trade-off across the two legs; a later divergence reddens here rather than
    // drifting silently into two ceilings nobody reconciles.
    expect(ATTACHMENT_MAX_RETRIEVAL_BYTES).toBe(ATTACHMENT_MAX_UPLOAD_BYTES)
  })

  it('admits a declaration exactly at the bound', async () => {
    const { consumer, failed, completed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(
      firstChunk({
        size: ATTACHMENT_MAX_RETRIEVAL_BYTES,
        total_chunks: ATTACHMENT_MAX_RETRIEVAL_CHUNKS,
        data: bytesOf(4)
      })
    )
    await drain()

    // Non-vacuity: a build that refused everything would fail this row rather than score green.
    expect(failed).toEqual([])
    expect(completed).toEqual([])
  })

  it('refuses one byte over the bound', () => {
    const size = ATTACHMENT_MAX_RETRIEVAL_BYTES + 1
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(firstChunk({ size, total_chunks: Math.ceil(size / STRIDE) }))

    expect(failed).toEqual(['too-large'])
  })

  it('refuses a size beyond MAX_SAFE_INTEGER on magnitude, never on an equality derived from it', () => {
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    // Above 2^53 a declared size is no longer an exact integer, so the cross-check would be unsound.
    // The bound runs first, which is what keeps every later arithmetic exact.
    r.chunk(firstChunk({ size: 2 ** 60, total_chunks: 1 }))

    expect(failed).toEqual(['too-large'])
  })
})

describe('createAttachmentReassembler — verification before anything is handed on', () => {
  it('refuses when the assembled length disagrees with the declared size', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    // A cross-check-conforming declaration (10 bytes is one chunk) carrying five bytes.
    r.chunk(firstChunk({ size: 10, total_chunks: 1, data: bytesOf(5) }))

    expect(completed).toEqual([])
    expect(failed).toEqual(['verification-failed'])
  })

  it('refuses a digest that does not match the assembled bytes', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(firstChunk({ sha256: digestOf(bytesOf(11)) }))

    expect(completed).toEqual([])
    expect(failed).toEqual(['verification-failed'])
  })

  it('compares the digest case-sensitively — an uppercase hex match is not a match', () => {
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(firstChunk({ sha256: digestOf(bytesOf(10)).toUpperCase() }))

    expect(failed).toEqual(['verification-failed'])
  })

  it('compares the whole digest — a correct prefix is not a match', () => {
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    // The decode layer deliberately does not length-check sha256, so a prefix comparison here would
    // be a hole a shortened declaration walks straight through.
    r.chunk(firstChunk({ sha256: digestOf(bytesOf(10)).slice(0, 32) }))

    expect(failed).toEqual(['verification-failed'])
  })
})

describe('createAttachmentReassembler — abandonment and the exactly-once terminal', () => {
  it.each(['stream-aborted', 'connection-lost'] as const)(
    'passes %s through from the composing driver',
    (reason) => {
      const { consumer, completed, failed } = makeConsumer()
      const r = createAttachmentReassembler(ID, consumer)

      r.chunk(conformingChunks(bytesOf(STRIDE + 1))[0])
      r.fail(reason)

      expect(completed).toEqual([])
      expect(failed).toEqual([reason])
    }
  )

  it('discards the partial: a chunk arriving after an abort can never complete the transfer', () => {
    const bytes = bytesOf(STRIDE + 1)
    const chunks = conformingChunks(bytes)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(chunks[0])
    r.fail('stream-aborted')
    r.chunk(chunks[1])

    expect(completed).toEqual([])
    expect(failed).toEqual(['stream-aborted'])
  })

  it('absorbs a chunk arriving after completion', () => {
    const bytes = bytesOf(9)
    const chunks = conformingChunks(bytes)
    const { consumer, completed, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.chunk(chunks[0])
    r.chunk(chunks[0])

    expect(completed).toHaveLength(1)
    expect(failed).toEqual([])
  })

  it('absorbs a second fail', () => {
    const { consumer, failed } = makeConsumer()
    const r = createAttachmentReassembler(ID, consumer)

    r.fail('connection-lost')
    r.fail('stream-aborted')

    expect(failed).toEqual(['connection-lost'])
  })
})

describe('attachmentReassembler — module graph', () => {
  it('imports no electron and no filesystem: it holds a user’s decrypted file bytes', () => {
    // Source text, not runtime: once vitest has resolved the graph there is nothing left to observe.
    // The exact set fires on an `electron` import, a `node:fs` import, and any renderer import.
    const source = readFileSync(resolve('src/main/transport/attachmentReassembler.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([
      '../../shared/wire/types',
      './inboundMessage',
      'node:crypto'
    ])
  })
})
