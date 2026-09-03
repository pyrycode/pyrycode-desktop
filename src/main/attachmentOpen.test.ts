import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createAttachmentOpen } from './attachmentOpen'
import type { AttachmentOpenEvent } from '../shared/ipc/attachmentOpen'
import type { DiagnosticEvent } from './diagnosticLog'

// Exercises the real filesystem against a throwaway temp dir with the OS hand-off injected —
// attachmentSave.test.ts's harness with a second app-owned directory instead of Downloads.
// Electron-free: this file's module graph never touches `electron`.

const PNG_ID = '7f3c1a2b-0000-4000-8000-0123456789ab'
const JPEG_ID = '0123abcd-0000-4000-8000-000000000001'
const GIF_ID = 'beef0000-0000-4000-8000-000000000002'
const WEBP_ID = 'cafe0000-0000-4000-8000-000000000003'
const TEXT_ID = 'dead0000-0000-4000-8000-000000000004'
const MISSING_ID = 'aaaa0000-0000-4000-8000-000000000005'
const DIRECTORY_ID = 'bbbb0000-0000-4000-8000-000000000006'
const EMPTY_ID = 'cccc0000-0000-4000-8000-000000000007'

/** A believable file of `label`'s type: the signature, then 64 bytes of distinguishable filler. */
function file(...leading: number[]): Uint8Array {
  const bytes = new Uint8Array(64 + leading.length).map((_, index) => (index * 7) % 251)
  bytes.set(leading)
  return bytes
}

const FIXTURES: Record<string, Uint8Array> = {
  [PNG_ID]: file(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  [JPEG_ID]: file(0xff, 0xd8, 0xff, 0xe0),
  [GIF_ID]: file(0x47, 0x49, 0x46, 0x38, 0x39, 0x61),
  [WEBP_ID]: file(0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50),
  // A shell script: no member matches, and its own extension-less name is what keeps it inert.
  [TEXT_ID]: new TextEncoder().encode('#!/bin/sh\nrm -rf ~\n'),
  [EMPTY_ID]: new Uint8Array(0)
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Harness {
  openAttachment: (request: { attachmentId: string }) => Promise<AttachmentOpenEvent>
  /** Every path the OS hand-off was asked to open, in order. */
  opened: string[]
  records: DiagnosticEvent[]
  attachmentDir: string
  openDir: string
}

/**
 * Build the driver over a fresh pair of directories, seeded unless `seed` is false.
 * `answer` is what the injected hand-off resolves to; `throws` makes it reject instead.
 */
async function harness(
  options: { seed?: boolean; answer?: boolean; throws?: boolean; blockOpenDir?: boolean } = {}
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-open-'))
  roots.push(root)
  const attachmentDir = join(root, 'attachments')
  const openDir = join(root, 'attachment-views')
  if (options.seed !== false) {
    await mkdir(attachmentDir, { recursive: true, mode: 0o700 })
    for (const [id, bytes] of Object.entries(FIXTURES)) {
      await writeFile(join(attachmentDir, id), bytes, { mode: 0o600 })
    }
    await mkdir(join(attachmentDir, DIRECTORY_ID))
  }
  // A plain file where the derived directory must be: mkdir cannot create it, so the derive fails.
  if (options.blockOpenDir) await writeFile(openDir, 'not a directory')

  const opened: string[] = []
  const records: DiagnosticEvent[] = []
  const openAttachment = createAttachmentOpen({
    attachmentDir,
    openDir,
    open: async (path) => {
      opened.push(path)
      if (options.throws) throw new Error(`no application knows how to open ${path}`)
      return options.answer ?? true
    },
    diagnosticLog: { event: (fields) => records.push(fields) }
  })
  return { openAttachment, opened, records, attachmentDir, openDir }
}

/** Narrow to the failed arm, failing loudly rather than casting past a success. */
function failure(event: AttachmentOpenEvent): string {
  if (event.type !== 'failed') throw new Error('expected failed, got opened')
  return event.reason
}

describe('createAttachmentOpen — the happy path', () => {
  it.each([
    ['PNG', PNG_ID, '.png'],
    ['JPEG', JPEG_ID, '.jpg'],
    ['GIF', GIF_ID, '.gif'],
    ['WebP', WEBP_ID, '.webp']
  ])('opens a %s at a path carrying the suffix its own bytes chose', async (_l, id, suffix) => {
    // AC 3 + AC 4: the type is decided by the leading bytes, and the path handed to the OS carries
    // the suffix that decision picked. Nothing from a wire field or a file name is in scope.
    const { openAttachment, opened, openDir } = await harness()
    expect(await openAttachment({ attachmentId: id })).toEqual({ type: 'opened', attachmentId: id })
    expect(opened).toEqual([join(openDir, `${id}${suffix}`)])
    expect(new Uint8Array(await readFile(opened[0]))).toEqual(FIXTURES[id])
  })

  it('leaves the stored extension-less file in place and unmodified', async () => {
    // AC 4: three landed consumers address that exact path. The derived copy is a second file.
    const { openAttachment, attachmentDir } = await harness()
    const before = await readFile(join(attachmentDir, PNG_ID))
    await openAttachment({ attachmentId: PNG_ID })
    expect(new Uint8Array(await readFile(join(attachmentDir, PNG_ID)))).toEqual(new Uint8Array(before))
    expect(await readdir(attachmentDir)).toEqual(
      expect.arrayContaining([PNG_ID, JPEG_ID, GIF_ID, WEBP_ID])
    )
    // And no suffixed sibling was created beside it — the derived file lives in its own directory.
    expect((await readdir(attachmentDir)).filter((name) => name.includes('.'))).toEqual([])
  })

  it('creates no second derived file when the same attachment is opened again', async () => {
    // AC 4: the derived name is deterministic per attachment, so repeat opens reuse rather than
    // accumulate — nothing evicts these files, so accumulation would be a real cost.
    const { openAttachment, opened, openDir } = await harness()
    await openAttachment({ attachmentId: PNG_ID })
    await openAttachment({ attachmentId: PNG_ID })
    expect(await readdir(openDir)).toEqual([`${PNG_ID}.png`])
    // Both asks still reached the OS: reuse is about the file, not about swallowing the second open.
    expect(opened).toHaveLength(2)
  })

  it('reuses an already-derived file rather than overwriting it', async () => {
    // The reuse is bought by O_CREAT|O_EXCL, which is also what stops a symlink already sitting at
    // the derived path from being written through. Proven by content that survives the second open.
    const { openAttachment, openDir } = await harness()
    await mkdir(openDir, { recursive: true })
    const derived = join(openDir, `${PNG_ID}.png`)
    await writeFile(derived, 'previously derived')
    expect(await openAttachment({ attachmentId: PNG_ID })).toEqual({
      type: 'opened',
      attachmentId: PNG_ID
    })
    expect(await readFile(derived, 'utf-8')).toBe('previously derived')
  })

  it('creates the derived directory owner-only', async () => {
    const { openAttachment, openDir } = await harness()
    await openAttachment({ attachmentId: PNG_ID })
    expect((await stat(openDir)).mode & 0o777).toBe(0o700)
  })
})

describe('createAttachmentOpen — the identifier gate', () => {
  it.each([
    ['a traversal identifier', '../../etc/passwd'],
    ['a dotted identifier', '..'],
    ['an absolute path', '/etc/passwd'],
    ['a separator', 'a/b'],
    ['a backslash', 'a\\b'],
    ['an uppercase identifier', 'ABCDEF'],
    ['a suffixed identifier', `${PNG_ID}.png`]
  ])('refuses %s before any filesystem call', async (_label, attachmentId) => {
    // AC 2: the refusal is decided by resolveAttachmentPath alone, with no second escape check
    // written here. Run with BOTH directories absent, so nothing on disk could have decided it.
    const { openAttachment, opened } = await harness({ seed: false })
    expect(failure(await openAttachment({ attachmentId }))).toBe('refused')
    expect(opened).toEqual([])
  })

  it('tells a refusal apart from an absent file', async () => {
    // AC 5: a refusal is permanent; an absent file is fetched and asked for again.
    const { openAttachment } = await harness()
    expect(failure(await openAttachment({ attachmentId: '../x' }))).toBe('refused')
    expect(failure(await openAttachment({ attachmentId: MISSING_ID }))).toBe('unavailable')
  })
})

describe('createAttachmentOpen — what it refuses to open', () => {
  it.each([
    ['an absent file', MISSING_ID],
    ['a directory at the resolved path', DIRECTORY_ID]
  ])('answers unavailable for %s', async (_label, attachmentId) => {
    const { openAttachment, opened } = await harness()
    expect(failure(await openAttachment({ attachmentId }))).toBe('unavailable')
    expect(opened).toEqual([])
  })

  it('answers unavailable when the attachment directory does not exist at all', async () => {
    const { openAttachment } = await harness({ seed: false })
    expect(failure(await openAttachment({ attachmentId: PNG_ID }))).toBe('unavailable')
  })

  it.each([
    ['a file whose leading bytes match no member', TEXT_ID],
    ['an empty file', EMPTY_ID]
  ])('answers unsupported-type for %s, deriving nothing and opening nothing', async (_l, id) => {
    // AC 3: a file that matches no signature is REFUSED rather than opened, whatever it claims to
    // be — and the refusal lands before any derived file exists and before the OS is told anything.
    const { openAttachment, opened, openDir } = await harness()
    expect(failure(await openAttachment({ attachmentId: id }))).toBe('unsupported-type')
    expect(opened).toEqual([])
    await expect(readdir(openDir)).rejects.toThrow()
  })

  it('answers open-failed when the derived copy cannot be made', async () => {
    const { openAttachment, opened } = await harness({ blockOpenDir: true })
    expect(failure(await openAttachment({ attachmentId: PNG_ID }))).toBe('open-failed')
    expect(opened).toEqual([])
  })

  it('answers open-failed when the operating system declines the hand-off', async () => {
    // The trap this seam exists for: shell.openPath does not throw — it resolves with the OS error
    // MESSAGE, which carries the path. The seam is narrowed to a boolean at the composition root,
    // so the driver has no message to forward into a reason or a log.
    const { openAttachment, opened } = await harness({ answer: false })
    expect(failure(await openAttachment({ attachmentId: PNG_ID }))).toBe('open-failed')
    expect(opened).toHaveLength(1)
  })

  it('answers open-failed when the hand-off itself throws', async () => {
    const { openAttachment } = await harness({ throws: true })
    expect(failure(await openAttachment({ attachmentId: PNG_ID }))).toBe('open-failed')
  })

  it('keeps all four reasons distinguishable from one another', async () => {
    // AC 5: #869 acts on the difference — retry, fetch-then-retry, offer the save leg instead, or
    // surface a generic error.
    const { openAttachment } = await harness({ answer: false })
    const reasons = [
      failure(await openAttachment({ attachmentId: '../x' })),
      failure(await openAttachment({ attachmentId: MISSING_ID })),
      failure(await openAttachment({ attachmentId: TEXT_ID })),
      failure(await openAttachment({ attachmentId: PNG_ID }))
    ]
    expect(reasons).toEqual(['refused', 'unavailable', 'unsupported-type', 'open-failed'])
  })
})

describe('createAttachmentOpen — the terminal', () => {
  it('resolves on every path rather than rejecting', async () => {
    // This is what licenses the composition root's bare `void` — a property of this module, not of
    // a `.catch()` anyone must remember.
    const { openAttachment } = await harness({ throws: true })
    const asks = ['../x', MISSING_ID, DIRECTORY_ID, TEXT_ID, PNG_ID, EMPTY_ID].map((attachmentId) =>
      openAttachment({ attachmentId })
    )
    const settled = await Promise.allSettled(asks)
    expect(settled.map((result) => result.status)).toEqual(Array(6).fill('fulfilled'))
  })

  it('answers exactly the declared keys, carrying no path and no derived name', async () => {
    // AC 5: the event may carry the window's OWN identifier back as the correlation key and nothing
    // else. No path, no suffixed file name, no matched type, no errno, no OS message.
    const { openAttachment } = await harness()
    const opened = await openAttachment({ attachmentId: PNG_ID })
    expect(Object.keys(opened).sort()).toEqual(['attachmentId', 'type'])
    const failed = await openAttachment({ attachmentId: TEXT_ID })
    expect(Object.keys(failed).sort()).toEqual(['attachmentId', 'reason', 'type'])
    expect(JSON.stringify(failed)).not.toContain('.png')
  })

  it('echoes the asked identifier on every arm', async () => {
    const { openAttachment } = await harness()
    expect((await openAttachment({ attachmentId: MISSING_ID })).attachmentId).toBe(MISSING_ID)
    expect((await openAttachment({ attachmentId: '../x' })).attachmentId).toBe('../x')
  })
})

describe('createAttachmentOpen — logging', () => {
  it('records static codes only, never a path, an identifier or a matched type', async () => {
    const { openAttachment, records } = await harness()
    for (const attachmentId of ['../x', MISSING_ID, TEXT_ID, PNG_ID]) {
      await openAttachment({ attachmentId })
    }
    const codes = new Set(records.map((record) => record.code))
    expect([...codes].sort()).toEqual([
      'opened',
      'refused',
      'started',
      'unavailable',
      'unsupported-type'
    ])
    expect(records.every((record) => record.event === 'attachment-open')).toBe(true)
    // Positive control: the logger really was called, so an empty record list cannot pass above.
    expect(records.length).toBeGreaterThan(4)
    const serialised = JSON.stringify(records)
    expect(serialised).not.toContain(PNG_ID)
    expect(serialised).not.toContain('.png')
    expect(serialised).not.toContain(tmpdir())
  })

  it('runs correctly with no logger at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pyry-open-'))
    roots.push(root)
    const attachmentDir = join(root, 'attachments')
    await mkdir(attachmentDir, { recursive: true })
    await writeFile(join(attachmentDir, PNG_ID), FIXTURES[PNG_ID])
    const openAttachment = createAttachmentOpen({
      attachmentDir,
      openDir: join(root, 'views'),
      open: async () => true
    })
    expect(await openAttachment({ attachmentId: PNG_ID })).toEqual({
      type: 'opened',
      attachmentId: PNG_ID
    })
  })
})

describe('createAttachmentOpen — the module graph', () => {
  it('imports no electron and makes no log call — the module graph is Electron-free', () => {
    // Source text, not runtime: the property is about the module graph, and once vitest has
    // resolved the graph there is nothing left at runtime to observe. Asserting the EXACT set fires
    // on an `electron` import and on a renderer import alike, and is what proves both directories
    // and the OS hand-off can only have arrived as parameters.
    const source = readFileSync(resolve('src/main/attachmentOpen.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([
      '../shared/ipc/attachmentOpen',
      './attachmentPath',
      './diagnosticLog',
      './imageSignature',
      'node:fs',
      'node:fs/promises',
      'node:path'
    ])
    expect(source).not.toContain('console.')
  })
})
