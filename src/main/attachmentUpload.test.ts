import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ATTACHMENT_MAX_UPLOAD_BYTES,
  ATTACHMENT_MAX_UPLOAD_CHUNKS,
  uploadAttachmentBytes,
  uploadAttachmentFile,
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
