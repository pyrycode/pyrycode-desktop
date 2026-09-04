import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ATTACHMENT_MAX_UPLOAD_BYTES,
  ATTACHMENT_MAX_UPLOAD_CHUNKS,
  ATTACHMENT_PROGRESS_MIN_CHUNKS,
  CLIPBOARD_IMAGE_FILENAME_PREFIX,
  CLIPBOARD_IMAGE_MIME_TYPE,
  uploadAttachmentBytes,
  uploadAttachmentFile,
  uploadClipboardImage,
  type AttachmentUploadDeps
} from './attachmentUpload'
import { ATTACHMENT_CHUNK_DATA_BYTES } from '../shared/wire/types'
import type { AttachmentUploadEvent } from '../shared/ipc/attachmentUpload'
import type { AttachmentChunkPlanInput } from './transport/attachmentChunkPlan'
import type { AttachmentTransferResult } from './transport/attachmentTransfer'
import type { DiagnosticEvent } from './diagnosticLog'

// Exercises the real fs read against throwaway temp files. Electron-free: this file's module graph
// never touches `electron`, only `node:fs`/`node:os`/`node:path`.

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pyry-attach-'))
  roots.push(dir)
  return dir
}

// A DISTINCTIVE, non-ASCII basename. Two jobs at once: it is long enough per code point that the
// 255-BYTE bound and a 255-CHARACTER bound disagree, and it is rare enough that a substring search
// for it across every emitted event and log record is a meaningful leak assertion (AC5).
const NAME_STEM = 'Raportti-läpivienti-日本語'

async function fileWith(bytes: Uint8Array, name = `${NAME_STEM}.bin`): Promise<string> {
  const path = join(await freshDir(), name)
  await writeFile(path, bytes)
  return path
}

/** The captured collaborators. `result` is what the fake driver resolves for every call. */
function harness(result: AttachmentTransferResult = { ok: true }): {
  deps: AttachmentUploadDeps
  events: AttachmentUploadEvent[]
  uploads: AttachmentChunkPlanInput[]
  records: DiagnosticEvent[]
} {
  const events: AttachmentUploadEvent[] = []
  const uploads: AttachmentChunkPlanInput[] = []
  const records: DiagnosticEvent[] = []
  return {
    events,
    uploads,
    records,
    deps: {
      upload: async (input) => {
        uploads.push(input)
        return result
      },
      emit: (event) => events.push(event),
      diagnosticLog: { event: (fields) => records.push(fields) }
    }
  }
}

/** Every string that reached the renderer or the log, for the positive leak walk. */
function everyStringEmitted(events: AttachmentUploadEvent[], records: DiagnosticEvent[]): string[] {
  const out: string[] = []
  for (const value of [...events, ...records]) {
    for (const field of Object.values(value)) {
      if (typeof field === 'string') out.push(field)
    }
  }
  return out
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uploadAttachmentFile', () => {
  it('uploads a chosen file and reports one completed terminal', async () => {
    // Edge byte values, to prove the bytes reach the driver verbatim with no transcoding.
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x1f, 0x8b])
    const path = await fileWith(bytes, 'report.pdf')
    const { deps, events, uploads } = harness()

    await uploadAttachmentFile(path, deps)

    expect(uploads).toHaveLength(1)
    expect(uploads[0].bytes).toEqual(bytes)
    expect(uploads[0].filename).toBe('report.pdf')
    expect(uploads[0].mime_type).toBe('application/pdf')
    expect(uploads[0].attachment_id).toMatch(UUID_V4)
    // Exactly one event, and it names the same transfer the driver was given.
    expect(events).toEqual([{ type: 'completed', uploadId: uploads[0].attachment_id }])
  })

  it('falls back to application/octet-stream for an unknown extension', async () => {
    const path = await fileWith(new Uint8Array([1]), 'notes.qqq')
    const { deps, uploads } = harness()

    await uploadAttachmentFile(path, deps)

    expect(uploads[0].mime_type).toBe('application/octet-stream')
  })

  it('bounds the upload at exactly ATTACHMENT_MAX_UPLOAD_BYTES', async () => {
    // The boundary a `>` vs `>=` slip moves: the bound itself is allowed through.
    const path = await fileWith(new Uint8Array(ATTACHMENT_MAX_UPLOAD_BYTES))
    const { deps, events, uploads } = harness()

    await uploadAttachmentFile(path, deps)

    expect(uploads).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('completed')
  })

  it('refuses one byte over the bound before anything is built or sent', async () => {
    const path = await fileWith(new Uint8Array(ATTACHMENT_MAX_UPLOAD_BYTES + 1))
    const { deps, events, uploads } = harness()

    await uploadAttachmentFile(path, deps)

    // AC2's load-bearing half: the driver — and therefore planAttachmentChunks and the wire — is
    // never reached at all, rather than reached and then abandoned.
    expect(uploads).toHaveLength(0)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      type: 'refused',
      uploadId: expect.stringMatching(UUID_V4),
      reason: 'too-large',
      limitBytes: ATTACHMENT_MAX_UPLOAD_BYTES
    })
  })

  it('states the bound in chunks of the mandated stride', () => {
    // The figure is anchored on how long a transfer takes at 45000 raw bytes per chunk, so it is
    // expressed in chunks. Pinning the product stops a later edit changing one half only.
    expect(ATTACHMENT_MAX_UPLOAD_BYTES).toBe(ATTACHMENT_MAX_UPLOAD_CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES)
    expect(ATTACHMENT_MAX_UPLOAD_CHUNKS).toBe(512)
  })

  it('reports a missing file as unreadable, distinct from a refusal, without rejecting', async () => {
    const path = join(await freshDir(), 'does-not-exist.bin')
    const { deps, events, uploads } = harness()

    // AC4's no-unhandled-rejection half: the promise RESOLVES on the throwing path.
    await expect(uploadAttachmentFile(path, deps)).resolves.toBeUndefined()

    expect(uploads).toHaveLength(0)
    expect(events).toEqual([{ type: 'failed', uploadId: expect.stringMatching(UUID_V4), reason: 'unreadable' }])
  })

  it('reports a chosen directory as unreadable', async () => {
    // The portable stand-in for the whole not-a-regular-file class. The case that actually motivates
    // the isFile() gate is a character device such as /dev/zero: it opens, stats at size 0, passes a
    // size-only bound, and then reads without end. That one is not portable to assert against.
    const path = join(await freshDir(), 'a-directory')
    await mkdir(path)
    const { deps, events, uploads } = harness()

    await uploadAttachmentFile(path, deps)

    expect(uploads).toHaveLength(0)
    expect(events).toEqual([{ type: 'failed', uploadId: expect.stringMatching(UUID_V4), reason: 'unreadable' }])
  })

  it('keeps a filename already inside the bound byte-identical', async () => {
    const path = await fileWith(new Uint8Array([1]), `${NAME_STEM}.png`)
    const { deps, uploads } = harness()

    await uploadAttachmentFile(path, deps)

    expect(uploads[0].filename).toBe(`${NAME_STEM}.png`)
    expect(uploads[0].mime_type).toBe('image/png')
  })

  it('mints a distinct id per intent so concurrent transfers never share one', async () => {
    const path = await fileWith(new Uint8Array([1]))
    const { deps, events, uploads } = harness()

    await Promise.all([uploadAttachmentFile(path, deps), uploadAttachmentFile(path, deps)])

    // AC3's uniqueness precondition for uploadAttachment, which does not enforce it itself.
    expect(uploads[0].attachment_id).not.toBe(uploads[1].attachment_id)
    expect(events).toHaveLength(2)
    expect(new Set(events.map((event) => event.uploadId)).size).toBe(2)
  })

  it('leaks neither the path, the basename, nor a file byte to the window or the log', async () => {
    // AC5, walked POSITIVELY over what was actually emitted rather than asserted as an absence.
    const path = await fileWith(new Uint8Array(ATTACHMENT_MAX_UPLOAD_BYTES + 1))
    const { deps, events, records } = harness()
    await uploadAttachmentFile(path, deps)

    const missing = join(await freshDir(), `${NAME_STEM}-gone.bin`)
    await uploadAttachmentFile(missing, deps)

    const ok = await fileWith(new Uint8Array([1]))
    await uploadAttachmentFile(ok, deps)

    expect(records.length).toBeGreaterThan(0)
    for (const value of everyStringEmitted(events, records)) {
      expect(value).not.toContain(NAME_STEM)
      expect(value).not.toContain('/')
      expect(value).not.toContain('\\')
    }
  })

  it('logs content-free stage codes and never the derived declaration', async () => {
    const path = await fileWith(new Uint8Array([1, 2, 3]), `${NAME_STEM}.png`)
    const { deps, records } = harness()

    await uploadAttachmentFile(path, deps)

    expect(records.every((record) => record.event === 'attachment-pick')).toBe(true)
    expect(records.map((record) => record.code)).toEqual(['started', 'completed'])
    expect(records[0].bytes).toBe(3)
    // Walked as a whitelist over the keys actually written, not as an absence assertion: a future
    // field carrying the name or the declared mime_type would have to be added here to pass.
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(
        record.code === 'started' ? ['bytes', 'code', 'event'] : ['code', 'event']
      )
    }
  })
})

describe('uploadAttachmentFile — driver terminals', () => {
  const rows = [
    'not-connected',
    'connection-lost',
    'send-failed',
    'attachment-too-large',
    'attachment-integrity-failed',
    'unclassified'
  ] as const

  for (const outcome of rows) {
    it(`reports the driver's ${outcome} verdict verbatim`, async () => {
      const path = await fileWith(new Uint8Array([1]))
      const { deps, events } = harness({ ok: false, outcome })

      await uploadAttachmentFile(path, deps)

      expect(events).toEqual([
        { type: 'failed', uploadId: expect.stringMatching(UUID_V4), reason: outcome }
      ])
    })
  }

  it('logs the driver verdict as the stage code', async () => {
    const path = await fileWith(new Uint8Array([1]))
    const { deps, records } = harness({ ok: false, outcome: 'attachment-storage-failed' })

    await uploadAttachmentFile(path, deps)

    expect(records.map((record) => record.code)).toEqual(['started', 'attachment-storage-failed'])
  })

  it('resolves and reports send-failed when the driver itself throws', async () => {
    // uploadAttachment is documented never to reject, so this is a backstop rather than a live
    // branch — but the whole point of AC4 is that no path here leaves an unhandled rejection.
    const path = await fileWith(new Uint8Array([1]))
    const { events } = harness()
    const deps: AttachmentUploadDeps = {
      upload: async () => {
        throw new Error('contract violated')
      },
      emit: (event) => events.push(event)
    }

    await expect(uploadAttachmentFile(path, deps)).resolves.toBeUndefined()

    expect(events).toEqual([
      { type: 'failed', uploadId: expect.stringMatching(UUID_V4), reason: 'send-failed' }
    ])
  })
})

describe('uploadAttachmentBytes', () => {
  it('drives the same guard and terminal for a route that already holds bytes', async () => {
    // The seam #891 (paste) enters at: same size bound, same terminal, no disk touched.
    const { deps, events, uploads } = harness()

    await uploadAttachmentBytes(
      { bytes: new Uint8Array([1, 2]), filename: 'pasted.png', mimeType: 'image/png' },
      deps
    )

    expect(uploads).toHaveLength(1)
    expect(uploads[0].filename).toBe('pasted.png')
    expect(events[0].type).toBe('completed')
  })

  it('refuses an oversized buffer without calling the driver', async () => {
    const { deps, events, uploads } = harness()

    await uploadAttachmentBytes(
      {
        bytes: new Uint8Array(ATTACHMENT_MAX_UPLOAD_BYTES + 1),
        filename: 'pasted.png',
        mimeType: 'image/png'
      },
      deps
    )

    expect(uploads).toHaveLength(0)
    expect(events[0].type).toBe('refused')
  })

  it('trims a long non-ASCII filename on a UTF-8 BYTE boundary', async () => {
    // Both routes declare through this one trim, and only this entry can be handed a name over the
    // bound: 255 bytes is at or under every host filesystem's own component limit, so a path whose
    // basename is too long cannot be created to read back.
    //
    // 40 repeats of a 23-character / 30-byte stem is 920 characters and 1200 bytes — over the bound
    // both ways, so the assertion below is only satisfiable by counting bytes, not characters.
    const long = NAME_STEM.repeat(40)
    const { deps, uploads } = harness()

    await uploadAttachmentBytes({ bytes: new Uint8Array([1]), filename: long, mimeType: 'x/y' }, deps)

    const declared = uploads[0].filename
    expect(Buffer.byteLength(declared, 'utf8')).toBeLessThanOrEqual(255)
    expect(Buffer.byteLength(declared, 'utf8')).toBeGreaterThan(250)
    // The trim landed BETWEEN code points, not inside one: a byte-sliced multi-byte sequence decodes
    // to U+FFFD, and a split surrogate pair leaves a lone half that fails the round trip.
    expect(declared).not.toContain('�')
    expect(Buffer.from(declared, 'utf8').toString('utf8')).toBe(declared)
    expect(long.startsWith(declared)).toBe(true)
  })
})

// ================================================================================================
// #864 — the progress gate. The transfer reports every chunk of every transfer; THIS module decides
// whether a report is worth an IPC message, against one named chunk threshold. The gate's input is
// the reported total rather than the file, so these drive it through a fake driver with a one-byte
// file — what the total is really derived from (the plan's length) is proved one layer down, in
// daemonConnection.test.ts.
// ================================================================================================

/** A harness whose fake driver reports the given (sent, total) pairs before it resolves. */
function reportingHarness(
  reports: Array<[number, number]>,
  result: AttachmentTransferResult = { ok: true },
  after: Array<[number, number]> = []
): { deps: AttachmentUploadDeps; events: AttachmentUploadEvent[] } {
  const events: AttachmentUploadEvent[] = []
  return {
    events,
    deps: {
      upload: async (_input, onProgress) => {
        for (const [sent, total] of reports) onProgress?.(sent, total)
        // `after` reports land once the driver has already answered — the shape a driver that ignored
        // its own settle contract would produce.
        //
        // A MACROTASK, AND THAT IS LOAD-BEARING. A `queueMicrotask` here runs BEFORE the awaiting
        // caller resumes, so these reports would arrive while the transfer is still legitimately in
        // flight and the test would prove nothing about what happens after the terminal. A timer runs
        // after the whole microtask chain that emits it.
        setTimeout(() => {
          for (const [sent, total] of after) onProgress?.(sent, total)
        }, 0)
        return result
      },
      emit: (event) => events.push(event)
    }
  }
}

// #1032: the PASTE entry. The clipboard read is a parameter, not a dep, so every branch below runs
// without touching the operator's real clipboard and this file's module graph still never loads
// `electron`. The bytes stand in for a PNG — nothing here decodes them, and nothing may.
describe('uploadClipboardImage', () => {
  // Edge byte values with a PNG-ish head, to prove they reach the driver verbatim with no transcoding.
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x80, 0xff, 0x7f])

  it('uploads the clipboard image as PNG under a minted name, with one completed terminal', async () => {
    const { deps, events, uploads } = harness()

    await uploadClipboardImage(() => PNG_BYTES, deps)

    expect(uploads).toHaveLength(1)
    expect(uploads[0].bytes).toEqual(PNG_BYTES)
    // The declared type is this client's own constant, never sniffed from the bytes: the background
    // process asked the clipboard for PNG and that is what it encoded.
    expect(uploads[0].mime_type).toBe(CLIPBOARD_IMAGE_MIME_TYPE)
    expect(uploads[0].mime_type).toBe('image/png')
    // A CLIENT-OWNED PATTERN CARRYING A TIMESTAMP, asserted as a shape rather than as a value: the
    // stamp is UTC (no TZ is pinned anywhere in this repo, so a local one would read differently on a
    // machine in another zone) and the prefix is the exported constant.
    expect(uploads[0].filename).toMatch(
      new RegExp(`^${CLIPBOARD_IMAGE_FILENAME_PREFIX}-\\d{8}T\\d{6}\\.png$`)
    )
    expect(uploads[0].attachment_id).toMatch(UUID_V4)
    expect(events).toEqual([{ type: 'completed', uploadId: uploads[0].attachment_id }])
  })

  it('mints a fresh id per paste, so two are distinguishable in flight', async () => {
    // `uploadAttachment`'s stated precondition. The name may repeat inside one second — the daemon keys
    // on attachment_id and the name is a display string — but the id may not.
    const { deps, uploads } = harness()

    await uploadClipboardImage(() => PNG_BYTES, deps)
    await uploadClipboardImage(() => PNG_BYTES, deps)

    expect(uploads).toHaveLength(2)
    expect(uploads[0].attachment_id).not.toBe(uploads[1].attachment_id)
  })

  // ⭐ THE TICKET'S SECOND CRITERION, over all three ways the read can yield no image. Each is a
  // REFUSAL naming that reason — never a failure, never an error, never a silent no-op — and none of
  // them starts a transfer.
  it.each([
    ['the clipboard holds no image', () => null],
    // NOT REDUNDANT with the composition root's isEmpty(): they are different fabric on purpose. Zero
    // bytes PASSES the size guard, so routing an empty array on would attempt a real upload of an empty
    // file rather than refusing.
    ['the read yields zero bytes', () => new Uint8Array(0)],
    // The reader is an INJECTED seam, and a contract is not a guarantee for one — the same argument
    // driveUpload's catch already makes about `upload`. A throw here must not become an unhandled
    // main-process rejection, since the composition root calls this with a bare `void`.
    [
      'the read itself throws',
      () => {
        throw new Error('clipboard unavailable')
      }
    ]
  ])('refuses with no-image when %s, without driving an upload', async (_case, read) => {
    const { deps, events, uploads } = harness()

    await uploadClipboardImage(read as () => Uint8Array | null, deps)

    expect(uploads).toHaveLength(0)
    expect(events).toEqual([
      { type: 'refused', uploadId: expect.any(String), reason: 'no-image' }
    ])
    // `limitBytes` is ABSENT, not undefined. That absence is what reddens the composer's switch until
    // it branches on `reason`, so asserting the key list is asserting the mechanism.
    expect(Object.keys(events[0]).sort()).toEqual(['reason', 'type', 'uploadId'])
    expect(events[0].uploadId).toMatch(UUID_V4)
  })

  it('logs the refusal with a client-owned code and invents no byte figure', async () => {
    const { deps, records } = harness()

    await uploadClipboardImage(() => null, deps)

    expect(records).toEqual([{ event: 'attachment-pick', code: 'no-image' }])
    // `bytes` is optional on DiagnosticEvent, so a refusal with nothing to count omits it rather than
    // reporting a zero that would read as a measurement.
    expect(records[0]).not.toHaveProperty('bytes')
  })

  it('lets no clipboard content reach an event or a log record', async () => {
    // The ticket's fourth criterion at the emitter. A DISTINCTIVE byte run stands in for the image, and
    // the walk covers every string that crossed on the success path — where the most is emitted.
    const { deps, events, records } = harness()

    await uploadClipboardImage(() => PNG_BYTES, deps)

    const strings = everyStringEmitted(events, records)
    // AS AN EXHAUSTIVE LIST, not as a substring search, and that is the difference between a real
    // assertion and a vacuous one: a `not.toContain(String(bytes.length))` over a short length matches
    // digits inside the uploadId and would fail or pass by accident. Naming every string that may cross
    // admits nothing — no base64, no length, no flavour, no dimension, and no minted filename, which is
    // declared to the daemon rather than reported to the window.
    expect(strings).toEqual([
      'completed',
      events[0].uploadId,
      'attachment-pick',
      'started',
      'attachment-pick',
      'completed'
    ])
    expect(strings).not.toContain(Buffer.from(PNG_BYTES).toString('base64'))
    expect(strings.some((value) => value.includes(CLIPBOARD_IMAGE_FILENAME_PREFIX))).toBe(false)
  })
})

const TINY: Parameters<typeof uploadAttachmentBytes>[0] = {
  bytes: new Uint8Array([1]),
  filename: 'tiny.bin',
  mimeType: 'application/octet-stream'
}

describe('the progress gate (#864 AC1-AC4)', () => {
  it('emits nothing at all for a transfer under the chunk threshold', async () => {
    // AC2. Under the bound the composer stays silent until the terminal, and — because the decision is
    // made here rather than in the window — the upload costs no IPC for progress at all.
    const under = ATTACHMENT_PROGRESS_MIN_CHUNKS - 1
    const { deps, events } = reportingHarness([
      [1, under],
      [under, under]
    ])

    await uploadAttachmentBytes(TINY, deps)

    expect(events.map((event) => event.type)).toEqual(['completed'])
  })

  it('emits one progress per report at the threshold, carrying both counts', async () => {
    const total = ATTACHMENT_PROGRESS_MIN_CHUNKS
    const { deps, events } = reportingHarness([
      [1, total],
      [2, total]
    ])

    await uploadAttachmentBytes(TINY, deps)

    // AC1: the figure advances, and it is the chunks on the wire against the plan's total.
    expect(events).toEqual([
      { type: 'progress', uploadId: expect.any(String), sentChunks: 1, totalChunks: total },
      { type: 'progress', uploadId: expect.any(String), sentChunks: 2, totalChunks: total },
      { type: 'completed', uploadId: expect.any(String) }
    ])
    // One transfer, one id: every event of an upload carries the id its own intent minted.
    expect(new Set(events.map((event) => event.uploadId)).size).toBe(1)
  })

  it('ends a reported transfer with exactly one terminal and no progress after it', async () => {
    // AC3, and the reason this module keeps a flag of its own rather than trusting the transfer's.
    // `upload` is an INJECTED seam: this module already ships a backstop around it on the stated
    // grounds that a contract is not a guarantee, and a report arriving after the answer is exactly
    // the shape that would leave a stale percentage on screen with no terminal left to replace it.
    const total = ATTACHMENT_PROGRESS_MIN_CHUNKS
    const { deps, events } = reportingHarness(
      [[1, total]],
      { ok: false, outcome: 'connection-lost' },
      [
        [2, total],
        [3, total]
      ]
    )

    await uploadAttachmentBytes(TINY, deps)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events.map((event) => event.type)).toEqual(['progress', 'failed'])
    // A connection lost mid-transfer clears the indicator on the same path a completion does: the
    // terminal is the last thing the window is told either way.
    expect(events.at(-1)).toMatchObject({ type: 'failed', reason: 'connection-lost' })
  })

  it('puts no string but the uploadId on a progress event, and no new key', async () => {
    // AC4 at the emitter rather than at the type: a member that grew a filename would show up here as
    // a fifth key and as a second string in the leak walk the rest of this file already applies.
    const total = ATTACHMENT_PROGRESS_MIN_CHUNKS
    const { deps, events } = reportingHarness([[1, total]])

    await uploadAttachmentBytes(TINY, deps)

    const progress = events.filter((event) => event.type === 'progress')
    expect(progress).toHaveLength(1)
    expect(Object.keys(progress[0]).sort()).toEqual([
      'sentChunks',
      'totalChunks',
      'type',
      'uploadId'
    ])
    expect(everyStringEmitted(progress, [])).toEqual(['progress', progress[0].uploadId])
  })

  it('refuses without reporting, so no progress can precede a refusal', async () => {
    // AC3's parenthesis: a refused file never starts, so the driver is never called and there is
    // nothing to report. Proved by the driver never running at all.
    let driven = false
    const events: AttachmentUploadEvent[] = []
    const deps: AttachmentUploadDeps = {
      upload: async () => {
        driven = true
        return { ok: true }
      },
      emit: (event) => events.push(event)
    }

    await uploadAttachmentBytes(
      { ...TINY, bytes: new Uint8Array(ATTACHMENT_MAX_UPLOAD_BYTES + 1) },
      deps
    )

    expect(driven).toBe(false)
    expect(events.map((event) => event.type)).toEqual(['refused'])
  })
})

describe('ATTACHMENT_PROGRESS_MIN_CHUNKS', () => {
  it('is a chunk count strictly inside this client’s own upload bound', () => {
    // A threshold at or above the bound would make the feature unreachable: no transfer this client
    // is willing to attempt could ever clear it.
    expect(Number.isInteger(ATTACHMENT_PROGRESS_MIN_CHUNKS)).toBe(true)
    expect(ATTACHMENT_PROGRESS_MIN_CHUNKS).toBeGreaterThan(1)
    expect(ATTACHMENT_PROGRESS_MIN_CHUNKS).toBeLessThan(ATTACHMENT_MAX_UPLOAD_CHUNKS)
  })
})
