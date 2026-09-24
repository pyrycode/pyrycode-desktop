import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createAttachmentSave, createMarkdownSave } from './attachmentSave'
import type { MarkdownSaveOutcome } from '../shared/ipc/markdownSave'
import type { DiagnosticEvent } from './diagnosticLog'

// Exercises the real filesystem against throwaway temp dirs — saveDebugBundle.test.ts's harness with
// two directories instead of one (the app-private attachment store, and a stand-in for Downloads).
// Electron-free: this file's module graph never touches `electron`.

const ID = '7f3c1a2b-0000-4000-8000-0123456789ab'
const SOURCE_BYTES = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x1f, 0x8b])

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Harness {
  save: (request: { attachmentId: string; filename: string }) => Promise<unknown>
  revealed: string[]
  records: DiagnosticEvent[]
  attachmentDir: string
  downloadsDir: string
  root: string
}

/** Build the driver over fresh dirs, with the source file seeded unless `seed` is false. */
async function harness(options: { seed?: boolean; reveal?: () => void } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-save-'))
  roots.push(root)
  const attachmentDir = join(root, 'attachments')
  const downloadsDir = join(root, 'downloads')
  await mkdir(attachmentDir, { recursive: true, mode: 0o700 })
  await mkdir(downloadsDir, { recursive: true })
  if (options.seed !== false) {
    await writeFile(join(attachmentDir, ID), SOURCE_BYTES, { mode: 0o600 })
  }
  const revealed: string[] = []
  const records: DiagnosticEvent[] = []
  const save = createAttachmentSave({
    attachmentDir,
    downloadsDir,
    reveal: (path: string) => {
      revealed.push(path)
      options.reveal?.()
    },
    diagnosticLog: { event: (fields) => records.push(fields) }
  })
  return { save, revealed, records, attachmentDir, downloadsDir, root }
}

describe('createAttachmentSave', () => {
  it('copies the resolved file into Downloads under the sanitised name and reveals it', async () => {
    const h = await harness()

    const event = await h.save({ attachmentId: ID, filename: 'report.pdf' })

    expect(event).toEqual({ type: 'saved', attachmentId: ID })
    const saved = join(h.downloadsDir, 'report.pdf')
    expect(Array.from(await readFile(saved))).toEqual(Array.from(SOURCE_BYTES))
    // AC 4: the reveal selects the SAVED FILE, not the folder — one absolute path inside Downloads.
    expect(h.revealed).toEqual([saved])
    expect(isAbsolute(h.revealed[0])).toBe(true)
    expect(dirname(h.revealed[0])).toBe(h.downloadsDir)
  })

  it('leaves the source in place — it copies, never moves', async () => {
    const h = await harness()
    await h.save({ attachmentId: ID, filename: 'report.pdf' })
    expect(Array.from(await readFile(join(h.attachmentDir, ID)))).toEqual(Array.from(SOURCE_BYTES))
  })

  it('reduces a traversal name to ONE component inside Downloads, touching nothing outside', async () => {
    const h = await harness()

    const event = await h.save({ attachmentId: ID, filename: '../../etc/passwd' })

    expect(event).toEqual({ type: 'saved', attachmentId: ID })
    // sanitizeAttachmentFilename's answer: both separators mapped, then the leading-dot prefix.
    expect(await readdir(h.downloadsDir)).toEqual(['_.._.._etc_passwd'])
    // The parent of Downloads holds only the two dirs the harness made — nothing escaped upward.
    expect((await readdir(h.root)).sort()).toEqual(['attachments', 'downloads'])
  })

  it('uses the sanitiser’s fallback when nothing in the name survives', async () => {
    const h = await harness()
    await h.save({ attachmentId: ID, filename: '///' })
    expect(await readdir(h.downloadsDir)).toEqual(['attachment'])
  })

  it('never overwrites: three saves of one name advance the browser-style suffix', async () => {
    const h = await harness()

    await h.save({ attachmentId: ID, filename: 'report.pdf' })
    await h.save({ attachmentId: ID, filename: 'report.pdf' })
    await h.save({ attachmentId: ID, filename: 'report.pdf' })

    expect((await readdir(h.downloadsDir)).sort()).toEqual([
      'report (1).pdf',
      'report (2).pdf',
      'report.pdf'
    ])
    expect(h.revealed).toHaveLength(3)
    expect(new Set(h.revealed).size).toBe(3)
  })

  it('never overwrites a file that was already in Downloads under the target name', async () => {
    const h = await harness()
    const existing = join(h.downloadsDir, 'report.pdf')
    await writeFile(existing, 'someone else’s file')

    await h.save({ attachmentId: ID, filename: 'report.pdf' })

    // The pre-existing file is byte-for-byte untouched; the copy landed beside it.
    expect(await readFile(existing, 'utf-8')).toBe('someone else’s file')
    expect(Array.from(await readFile(join(h.downloadsDir, 'report (1).pdf')))).toEqual(
      Array.from(SOURCE_BYTES)
    )
  })

  it('splits the suffix at the LAST dot, so a double extension keeps its tail', async () => {
    const h = await harness()
    await h.save({ attachmentId: ID, filename: 'archive.tar.gz' })
    await h.save({ attachmentId: ID, filename: 'archive.tar.gz' })
    expect((await readdir(h.downloadsDir)).sort()).toEqual(['archive.tar (1).gz', 'archive.tar.gz'])
  })

  it('appends the suffix whole when the component carries no extension', async () => {
    const h = await harness()
    await h.save({ attachmentId: ID, filename: 'notes' })
    await h.save({ attachmentId: ID, filename: 'notes' })
    expect((await readdir(h.downloadsDir)).sort()).toEqual(['notes', 'notes (1)'])
  })

  it('refuses a non-canonical identifier BEFORE any filesystem call', async () => {
    const h = await harness()

    const event = await h.save({ attachmentId: '../../etc/passwd', filename: 'report.pdf' })

    expect(event).toEqual({ type: 'failed', attachmentId: '../../etc/passwd', reason: 'source-unavailable' })
    // Nothing was created and nothing was revealed — the resolve gate ran before the copy.
    expect(await readdir(h.downloadsDir)).toEqual([])
    expect(h.revealed).toEqual([])
  })

  it('answers source-unavailable when the source file is not on this machine', async () => {
    const h = await harness({ seed: false })

    const event = await h.save({ attachmentId: ID, filename: 'report.pdf' })

    expect(event).toEqual({ type: 'failed', attachmentId: ID, reason: 'source-unavailable' })
    expect(await readdir(h.downloadsDir)).toEqual([])
    expect(h.revealed).toEqual([])
  })

  it('answers save-failed on an over-long name (ENAMETOOLONG), leaving nothing partial', async () => {
    const h = await harness()

    // Past every filesystem's 255-byte NAME_MAX, and every character survives the allowlist verbatim.
    const event = await h.save({ attachmentId: ID, filename: `${'a'.repeat(300)}.pdf` })

    expect(event).toEqual({ type: 'failed', attachmentId: ID, reason: 'save-failed' })
    expect(await readdir(h.downloadsDir)).toEqual([])
    expect(h.revealed).toEqual([])
  })

  it('answers a failure when the Downloads folder does not exist, and never creates it', async () => {
    const h = await harness()
    await rm(h.downloadsDir, { recursive: true })

    const event = await h.save({ attachmentId: ID, filename: 'report.pdf' })

    // The stated conflation: copyFile reports ENOENT for an absent DESTINATION directory exactly as it
    // does for an absent source, and the two are not distinguishable without a check-then-act on a path.
    expect(event).toEqual({ type: 'failed', attachmentId: ID, reason: 'source-unavailable' })
    await expect(stat(h.downloadsDir)).rejects.toThrow()
    expect(h.revealed).toEqual([])
  })

  it('still answers saved when the reveal throws — the bytes are on disk by then', async () => {
    const h = await harness({
      reveal: () => {
        throw new Error('no file manager')
      }
    })

    const event = await h.save({ attachmentId: ID, filename: 'report.pdf' })

    expect(event).toEqual({ type: 'saved', attachmentId: ID })
    expect(Array.from(await readFile(join(h.downloadsDir, 'report.pdf')))).toEqual(
      Array.from(SOURCE_BYTES)
    )
  })

  it('never rejects: every failure path resolves to a terminal event', async () => {
    const h = await harness({ seed: false })
    const asks = [
      { attachmentId: '../nope', filename: 'a.pdf' },
      { attachmentId: ID, filename: 'a.pdf' },
      { attachmentId: ID, filename: `${'a'.repeat(300)}.pdf` }
    ]
    const events = await Promise.all(asks.map((ask) => h.save(ask)))
    for (const event of events) expect(event).toMatchObject({ type: 'failed' })
  })

  it.runIf(process.platform !== 'win32')(
    'does not widen the copy’s permissions beyond the owner-only source',
    async () => {
      const h = await harness()
      await h.save({ attachmentId: ID, filename: 'report.pdf' })
      const mode = (await stat(join(h.downloadsDir, 'report.pdf'))).mode
      expect(mode & 0o077).toBe(0)
    }
  )

  it('logs static codes only — never the file name, the identifier or a path', async () => {
    const h = await harness()
    await h.save({ attachmentId: ID, filename: 'report.pdf' })
    await h.save({ attachmentId: '../../etc/passwd', filename: 'secret-invoice.pdf' })

    expect(h.records.map((record) => record.code)).toEqual([
      'started',
      'saved',
      'started',
      'source-unavailable'
    ])
    expect(new Set(h.records.map((record) => record.event))).toEqual(new Set(['attachment-save']))

    const serialized = JSON.stringify(h.records)
    for (const forbidden of ['report', 'secret-invoice', '.pdf', ID, h.downloadsDir, '/']) {
      expect(serialized).not.toContain(forbidden)
    }
    // Positive control: the predicate DOES fire when the value is present, so the negatives above are
    // not vacuous.
    expect(JSON.stringify([{ event: 'x', code: 'report.pdf' }])).toContain('report')
  })

  it('imports no electron and makes no log call — the module graph is Electron-free', () => {
    // Source text, not runtime: the property is about the module graph, and once vitest has resolved
    // the graph there is nothing left at runtime to observe. Asserting the EXACT set fires on an
    // `electron` import and on a renderer import alike. The second grep is the deterministic half of
    // the never-log rule — "sanitised" does not mean "safe to log", and a comment would not enforce it.
    const source = readFileSync(resolve('src/main/attachmentSave.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([
      '../shared/ipc/attachmentSave',
      '../shared/ipc/markdownOpen',
      '../shared/ipc/markdownSave',
      './attachmentFilename',
      './attachmentPath',
      './diagnosticLog',
      'node:fs',
      'node:fs/promises',
      'node:path'
    ])
    expect(source).not.toContain('console.')
  })
})

// #1632 — the markdown reader's note, written into Downloads through the same collision loop.
describe('createMarkdownSave (#1632)', () => {
  interface NoteHarness {
    saveNote: (request: { text: string; displayName: string }) => Promise<MarkdownSaveOutcome>
    revealed: string[]
    records: DiagnosticEvent[]
    downloadsDir: string
    root: string
  }

  async function noteHarness(options: { reveal?: () => void } = {}): Promise<NoteHarness> {
    const root = await mkdtemp(join(tmpdir(), 'pyry-md-save-'))
    roots.push(root)
    const downloadsDir = join(root, 'downloads')
    await mkdir(downloadsDir, { recursive: true })
    const revealed: string[] = []
    const records: DiagnosticEvent[] = []
    const saveNote = createMarkdownSave({
      downloadsDir,
      reveal: (path: string) => {
        revealed.push(path)
        options.reveal?.()
      },
      diagnosticLog: { event: (fields) => records.push(fields) }
    })
    return { saveNote, revealed, records, downloadsDir, root }
  }

  it('writes the text into Downloads under the sanitised name and reveals that file', async () => {
    const h = await noteHarness()

    const outcome = await h.saveNote({ text: '# Plan\n\nBody ä', displayName: 'Plan.md' })

    expect(outcome).toEqual({ type: 'saved' })
    const saved = join(h.downloadsDir, 'Plan.md')
    expect(await readFile(saved, 'utf-8')).toBe('# Plan\n\nBody ä')
    expect(h.revealed).toEqual([saved])
  })

  it('lands a traversal, an absolute path and an empty name as one file inside Downloads', async () => {
    const h = await noteHarness()

    for (const displayName of ['../../x', '/etc/passwd', '']) {
      expect(await h.saveNote({ text: 'n', displayName })).toEqual({ type: 'saved' })
    }

    expect((await readdir(h.downloadsDir)).sort()).toEqual(['_.._.._x', '_etc_passwd', 'attachment'])
    for (const path of h.revealed) expect(dirname(path)).toBe(h.downloadsDir)
    // Nothing escaped upward: the harness root holds only the Downloads stand-in.
    expect(await readdir(h.root)).toEqual(['downloads'])
  })

  it('never overwrites: a repeat save and a pre-existing file both advance the suffix', async () => {
    const h = await noteHarness()
    await writeFile(join(h.downloadsDir, 'notes.md'), 'someone else’s file')

    await h.saveNote({ text: 'first', displayName: 'notes.md' })
    await h.saveNote({ text: 'second', displayName: 'notes.md' })

    expect(await readFile(join(h.downloadsDir, 'notes.md'), 'utf-8')).toBe('someone else’s file')
    expect(await readFile(join(h.downloadsDir, 'notes (1).md'), 'utf-8')).toBe('first')
    expect(await readFile(join(h.downloadsDir, 'notes (2).md'), 'utf-8')).toBe('second')
  })

  it.runIf(process.platform !== 'win32')('never writes through a symlink planted at the target name', async () => {
    const h = await noteHarness()
    const outside = join(h.root, 'outside.md')
    await writeFile(outside, 'untouched')
    await symlink(outside, join(h.downloadsDir, 'notes.md'))

    expect(await h.saveNote({ text: 'note', displayName: 'notes.md' })).toEqual({ type: 'saved' })

    expect(await readFile(outside, 'utf-8')).toBe('untouched')
    expect((await lstat(join(h.downloadsDir, 'notes.md'))).isSymbolicLink()).toBe(true)
    expect(await readFile(join(h.downloadsDir, 'notes (1).md'), 'utf-8')).toBe('note')
  })

  it('answers save-failed on an over-long name and on a missing Downloads, leaving nothing behind', async () => {
    const h = await noteHarness()

    expect(await h.saveNote({ text: 'n', displayName: `${'a'.repeat(300)}.md` })).toEqual({
      type: 'failed',
      reason: 'save-failed'
    })
    expect(await readdir(h.downloadsDir)).toEqual([])

    await rm(h.downloadsDir, { recursive: true })
    expect(await h.saveNote({ text: 'n', displayName: 'notes.md' })).toEqual({
      type: 'failed',
      reason: 'save-failed'
    })
    await expect(stat(h.downloadsDir)).rejects.toThrow()
    expect(h.revealed).toEqual([])
  })

  it('still answers saved when the reveal throws — the note is on disk by then', async () => {
    const h = await noteHarness({
      reveal: () => {
        throw new Error('no file manager')
      }
    })
    expect(await h.saveNote({ text: 'n', displayName: 'notes.md' })).toEqual({ type: 'saved' })
    expect(await readFile(join(h.downloadsDir, 'notes.md'), 'utf-8')).toBe('n')
  })

  it('logs static codes only — never the text, the name or a path', async () => {
    const h = await noteHarness()
    await h.saveNote({ text: 'private body', displayName: 'secret-plan.md' })
    await h.saveNote({ text: 'private body', displayName: `${'a'.repeat(300)}.md` })

    expect(h.records.map((record) => record.code)).toEqual(['started', 'saved', 'started', 'save-failed'])
    expect(new Set(h.records.map((record) => record.event))).toEqual(new Set(['markdown-save']))
    const serialized = JSON.stringify(h.records)
    for (const forbidden of ['private', 'secret-plan', '.md', 'aaaa', h.downloadsDir, '/']) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
