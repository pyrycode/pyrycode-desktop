import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAttachmentTransfer } from './attachmentTransfer'
import type { AttachmentTransferFailure } from './attachmentTransfer'
import { ATTACHMENT_CHUNK_DATA_BYTES } from '../../shared/wire/types'
import type { AttachmentChunkPayload } from '../../shared/wire/types'
import type { DiagnosticEvent, DiagnosticLog } from '../diagnosticLog'

// The send driver is the stateful middle of an assembled chain: the plan (#860) is above it, the
// terminal-answer decode (#961/#964) is below it, and this file proves the drive itself — every chunk
// on the wire in index order, exactly one terminal, and nothing about the file in a log record.
//
// The two correlation keys are tested apart on purpose. `sentEnvelope` is the REJECT key (envelope
// ids this transfer minted); `attachmentId` is the SUCCESS key. A driver that correlated the success
// on an envelope id would pass every other test in this file and never resolve in production, because
// the daemon answers the chunk whose ARRIVAL COMPLETED the transfer — not the last one sent.
describe('createAttachmentTransfer', () => {
  const STRIDE = ATTACHMENT_CHUNK_DATA_BYTES

  /** A non-repeating pattern, so an off-by-one slice or a reversed order shows in a diff. */
  const pattern = (length: number): Uint8Array =>
    Uint8Array.from({ length }, (_, index) => index % 251)

  const input = (bytes: Uint8Array): Parameters<typeof createAttachmentTransfer>[0] => ({
    conversation_id: 'conv-1',
    attachment_id: 'att-1',
    filename: 'notes.txt',
    mime_type: 'text/plain',
    bytes
  })

  /** Capture the sent payloads and hand back ascending envelope ids from 7 (an arbitrary non-zero
   *  base, so a test that accidentally asserts an index where an envelope id belongs fails). */
  const recordingSender = (): {
    sent: AttachmentChunkPayload[]
    ids: number[]
    sendChunk: (payload: AttachmentChunkPayload) => number
  } => {
    const sent: AttachmentChunkPayload[] = []
    const ids: number[] = []
    return {
      sent,
      ids,
      sendChunk: (payload): number => {
        sent.push(payload)
        const id = 7 + ids.length
        ids.push(id)
        return id
      }
    }
  }

  const captureLog = (): { records: DiagnosticEvent[]; log: DiagnosticLog } => {
    const records: DiagnosticEvent[] = []
    return { records, log: { event: (fields: DiagnosticEvent): void => void records.push(fields) } }
  }

  /** Every test drives the loop with an immediate yield — the settled-flag check between chunks is
   *  what this file exercises, not the macrotask the production default schedules. */
  const immediate = (): Promise<void> => Promise.resolve()

  /**
   * Let the send loop drain before settling the transfer. Load-bearing, not ceremony: a `stored()`
   * called straight after `start()` settles the transfer while chunk 1 is still queued, and the loop
   * correctly stops — so a test that wants to see the WHOLE plan on the wire has to wait for it.
   * Deterministic under the immediate seam: each iteration costs a bounded number of microtask turns,
   * and this awaits well past the longest plan any test here builds. It also mirrors production,
   * where the reply arrives on a socket macrotask and never mid-loop.
   */
  const drain = async (): Promise<void> => {
    for (let turn = 0; turn < 32; turn++) await Promise.resolve()
  }

  it('sends every chunk in index order, each carrying the transfer-wide metadata', async () => {
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: sender.sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    expect(sender.sent).toHaveLength(3)
    expect(sender.sent.map((chunk) => chunk.index)).toEqual([0, 1, 2])
    // The transfer-wide fields asserted as a CARDINALITY, not against a hand-written expected value:
    // "identical on every chunk" is the claim, and a set of size 1 is exactly that claim. Writing the
    // expected sha256 out would prove the planner's arithmetic a second time and prove nothing here.
    expect(new Set(sender.sent.map((chunk) => chunk.attachment_id)).size).toBe(1)
    expect(new Set(sender.sent.map((chunk) => chunk.sha256)).size).toBe(1)
    expect(new Set(sender.sent.map((chunk) => chunk.size)).size).toBe(1)
    expect(new Set(sender.sent.map((chunk) => chunk.total_chunks)).size).toBe(1)
    expect(sender.sent[0].total_chunks).toBe(3)
    expect(sender.sent[0].size).toBe(STRIDE * 2 + 5)
  })

  it('sends exactly one chunk for a zero-byte file', async () => {
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(new Uint8Array(0)), {
      sendChunk: sender.sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0].total_chunks).toBe(1)
  })

  it('exposes the transfer id as the success correlation key', () => {
    const transfer = createAttachmentTransfer(input(pattern(10)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate
    })

    expect(transfer.attachmentId).toBe('att-1')
  })

  it('resolves ok when stored', async () => {
    const transfer = createAttachmentTransfer(input(pattern(10)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    transfer.stored()

    await expect(transfer.result).resolves.toEqual({ ok: true })
  })

  it.each<AttachmentTransferFailure>([
    'attachment-invalid-chunk',
    'attachment-integrity-failed',
    'attachment-too-large',
    'attachment-too-many-uploads',
    'attachment-storage-failed',
    'message-too-long',
    'unclassified',
    'connection-lost',
    'send-failed',
    'not-connected'
  ])('resolves failed carrying the %s outcome verbatim', async (outcome) => {
    const transfer = createAttachmentTransfer(input(pattern(10)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    transfer.fail(outcome)

    await expect(transfer.result).resolves.toEqual({ ok: false, outcome })
  })

  it('stops sending the moment the transfer settles mid-loop', async () => {
    // AC3's load-bearing case: a reject correlated to chunk 0 lands while chunks 1 and 2 are still
    // queued. The fake settles from INSIDE the send, which is the only way to reach the gap
    // deterministically; in production the settle arrives on a socket macrotask the loop yields to.
    const sender = recordingSender()
    let transferRef: ReturnType<typeof createAttachmentTransfer> | null = null
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: (payload): number => {
        const id = sender.sendChunk(payload)
        if (payload.index === 0) transferRef?.fail('attachment-too-large')
        return id
      },
      yieldToEventLoop: immediate
    })
    transferRef = transfer

    transfer.start()

    await expect(transfer.result).resolves.toEqual({
      ok: false,
      outcome: 'attachment-too-large'
    })
    expect(sender.sent).toHaveLength(1)
  })

  it('never reports complete after it has reported failed', async () => {
    const transfer = createAttachmentTransfer(input(pattern(10)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    transfer.fail('connection-lost')
    transfer.stored()
    transfer.fail('attachment-storage-failed')

    await expect(transfer.result).resolves.toEqual({ ok: false, outcome: 'connection-lost' })
  })

  it('never reports failed after it has reported complete', async () => {
    const transfer = createAttachmentTransfer(input(pattern(10)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    transfer.stored()
    transfer.fail('connection-lost')

    await expect(transfer.result).resolves.toEqual({ ok: true })
  })

  it('resolves send-failed and sends nothing further when a chunk cannot go out', async () => {
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: (payload): number => {
        if (payload.index === 1) throw new Error('socket refused the frame')
        return sender.sendChunk(payload)
      },
      yieldToEventLoop: immediate
    })

    transfer.start()

    await expect(transfer.result).resolves.toEqual({ ok: false, outcome: 'send-failed' })
    expect(sender.sent).toHaveLength(1)
  })

  it('claims every envelope id it minted and no other', async () => {
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: sender.sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    expect(sender.ids).toHaveLength(3)
    for (const id of sender.ids) expect(transfer.sentEnvelope(id)).toBe(true)
    // The neighbouring ids on either side of the minted run — a Set membership test that accidentally
    // became a range check would pass the loop above and fail here.
    expect(transfer.sentEnvelope(sender.ids[0] - 1)).toBe(false)
    expect(transfer.sentEnvelope(sender.ids[sender.ids.length - 1] + 1)).toBe(false)
  })

  it('sends each chunk once when started twice', async () => {
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(pattern(STRIDE + 5)), {
      sendChunk: sender.sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    expect(sender.sent.map((chunk) => chunk.index)).toEqual([0, 1])
  })

  it('yields to the event loop between chunks so an inbound terminal can land', async () => {
    const yields = vi.fn(immediate)
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: yields
    })

    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    // At least once per gap between the three chunks. A driver that sent the whole plan in one
    // synchronous turn would report zero, and no reject could ever interrupt it in production.
    expect(yields.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('does not throw when no yield seam and no diagnosticLog are injected', async () => {
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(pattern(10)), {
      sendChunk: sender.sendChunk
    })

    transfer.start()
    transfer.stored()

    await expect(transfer.result).resolves.toEqual({ ok: true })
    expect(sender.sent).toHaveLength(1)
  })

  // ==========================================================================================
  // #864 — the chunk count, reported upward. The module already held both figures (the plan's
  // length and the sentEnvelopes set) and reported neither; these prove it now does, and that a
  // report can never outlive the terminal.
  // ==========================================================================================

  it('reports the running count against the plan total, once per chunk that reached the wire', async () => {
    const reports: Array<[number, number]> = []
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate,
      onProgress: (sent, total) => void reports.push([sent, total])
    })

    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    // The numerator is what actually reached the wire and the denominator is the WHOLE plan from the
    // first report on — a progress line that grew its own total as it went would read as a transfer
    // getting longer the further it got.
    expect(reports).toEqual([
      [1, 3],
      [2, 3],
      [3, 3]
    ])
  })

  it('reports nothing after a terminal settles the transfer mid-flight', async () => {
    const reports: Array<[number, number]> = []
    let transferRef: ReturnType<typeof createAttachmentTransfer> | null = null
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 4 + 5)), {
      sendChunk: (payload): number => {
        // The reject correlated to chunk 0 lands while the loop is still walking the plan — the same
        // shape as the shipped mid-transfer reject test one block up.
        if (payload.index === 1) transferRef?.fail('attachment-invalid-chunk')
        return 7 + payload.index
      },
      yieldToEventLoop: immediate,
      onProgress: (sent, total) => void reports.push([sent, total])
    })
    transferRef = transfer

    transfer.start()
    await drain()

    await expect(transfer.result).resolves.toEqual({
      ok: false,
      outcome: 'attachment-invalid-chunk'
    })
    // Chunk 0's report stands; chunk 1 reached the wire before the settle was visible to the loop and
    // reports nothing, and chunks 2-4 never went out at all. What this forbids is any report at index
    // 2 or beyond — a progress line that kept climbing after the composer had already stated a failure.
    expect(reports.map(([sent]) => sent)).toEqual([1])
  })

  it('survives a throwing progress consumer without stopping the loop or rejecting', async () => {
    // drive() is documented never to reject, and this is the first foreign callback inside it: an
    // unhandled rejection here would surface in the main process from `void drive()`, with no caller
    // to catch it. The throw is dropped unexamined rather than classified — nothing about a renderer
    // send failure is actionable, and its message is not this module's to read.
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: sender.sendChunk,
      yieldToEventLoop: immediate,
      onProgress: () => {
        throw new Error('the window went away')
      }
    })

    transfer.start()
    await drain()
    transfer.stored()

    await expect(transfer.result).resolves.toEqual({ ok: true })
    expect(sender.sent.map((chunk) => chunk.index)).toEqual([0, 1, 2])
  })

  it('drives exactly as before when no progress consumer is injected', async () => {
    // The seam is optional, so every shipped caller keeps compiling and behaving — the yield seam's
    // own precedent one block up.
    const sender = recordingSender()
    const transfer = createAttachmentTransfer(input(pattern(STRIDE + 5)), {
      sendChunk: sender.sendChunk,
      yieldToEventLoop: immediate
    })

    transfer.start()
    await drain()
    transfer.stored()

    await expect(transfer.result).resolves.toEqual({ ok: true })
    expect(sender.sent.map((chunk) => chunk.index)).toEqual([0, 1])
  })

  it('adds no diagnostic record per chunk — the count is reported, not logged', async () => {
    // A record per chunk would put up to ATTACHMENT_MAX_UPLOAD_CHUNKS lines in one upload's debug
    // bundle. The started record already carries the plan's count and the settle record carries how
    // far the transfer got, so the two the module already writes are the whole of it.
    const captured = captureLog()
    const transfer = createAttachmentTransfer(input(pattern(STRIDE * 2 + 5)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate,
      onProgress: () => {},
      diagnosticLog: captured.log
    })

    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    expect(captured.records).toHaveLength(2)
    expect(captured.records.map((record) => record.code)).toEqual(['started', 'stored'])
  })

  it('logs the lifecycle content-free — no filename, mime type, id or file byte in any record', async () => {
    // AC4. A POSITIVE check first (the module did log, so this cannot pass by silence), then the
    // no-leak check over every record's serialized form — which catches a leak in ANY field, including
    // one a future DiagnosticEvent grows, rather than only the fields named here.
    const captured = captureLog()
    const filename = 'quarterly-severance-list.xlsx'
    const mimeType = 'application/vnd.ms-excel'
    const attachmentId = 'att-secret-9f2b'
    const bytes = pattern(STRIDE + 5)
    const transfer = createAttachmentTransfer(
      { conversation_id: 'conv-1', attachment_id: attachmentId, filename, mime_type: mimeType, bytes },
      { sendChunk: recordingSender().sendChunk, yieldToEventLoop: immediate, diagnosticLog: captured.log }
    )

    transfer.start()
    await drain()
    transfer.stored()
    await transfer.result

    expect(captured.records.length).toBeGreaterThan(0)
    expect(captured.records.every((record) => record.event === 'attachment-upload')).toBe(true)
    // The terminal record names the outcome and how many chunks went out — both client-owned.
    expect(captured.records.at(-1)).toMatchObject({ code: 'stored', count: 2 })
    for (const record of captured.records) {
      const line = JSON.stringify(record)
      expect(line).not.toContain(filename)
      expect(line).not.toContain(mimeType)
      expect(line).not.toContain(attachmentId)
      // No slice of the file's base64 either — the first chunk's leading characters stand in for
      // "any file byte", since a record that carried `data` would carry them.
      expect(line).not.toContain(Buffer.from(bytes.subarray(0, 24)).toString('base64'))
    }
  })

  it('logs the classified outcome, never a daemon string, when the transfer fails', async () => {
    const captured = captureLog()
    const transfer = createAttachmentTransfer(input(pattern(10)), {
      sendChunk: recordingSender().sendChunk,
      yieldToEventLoop: immediate,
      diagnosticLog: captured.log
    })

    transfer.start()
    transfer.fail('attachment-integrity-failed')
    await transfer.result

    expect(captured.records.at(-1)).toMatchObject({
      event: 'attachment-upload',
      code: 'attachment-integrity-failed'
    })
  })

  it('imports nothing outside the main-process transport layer and never calls console', () => {
    // Source text, not runtime: the property is about the module graph. It holds the file's raw bytes
    // and its base64, so an electron / IPC / renderer import here would be the leak CLAUDE.md's
    // "keep the transport out of the window" forbids. The console grep pins the never-log rule the
    // record assertions above check from the other side.
    const source = readFileSync(resolve('src/main/transport/attachmentTransfer.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([
      '../../shared/wire/types',
      '../diagnosticLog',
      './attachmentChunkPlan',
      './inboundMessage'
    ])
    expect(source).not.toContain('console.')
  })
})
