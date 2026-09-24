import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, lstat, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createMarkdownOpen, markdownOpenFileName } from './markdownOpen'
import { ATTACHMENT_MAX_RETRIEVAL_BYTES } from './transport/attachmentReassembler'
import { MAX_MARKDOWN_OPEN_TEXT_LENGTH, type MarkdownOpenOutcome } from '../shared/ipc/markdownOpen'
import type { DiagnosticEvent } from './diagnosticLog'

// #1631 — the real filesystem against a throwaway temp dir, with the OS hand-off injected so no test ever
// launches an app. Electron-free: this file's module graph never touches `electron`.

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Harness {
  openNote: (request: { text: string; displayName: string }) => Promise<MarkdownOpenOutcome>
  /** Every path the OS hand-off was asked to open, in order. */
  opened: string[]
  records: DiagnosticEvent[]
  root: string
  openDir: string
}

async function harness(
  options: { answer?: boolean; throws?: boolean; blockOpenDir?: boolean } = {}
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-md-open-'))
  roots.push(root)
  const openDir = join(root, 'markdown-views')
  // A plain file where the directory must be: mkdir cannot create it, so the write fails.
  if (options.blockOpenDir) await writeFile(openDir, 'not a directory')
  const opened: string[] = []
  const records: DiagnosticEvent[] = []
  const openNote = createMarkdownOpen({
    openDir,
    open: async (path) => {
      opened.push(path)
      if (options.throws) throw new Error(`cannot open ${path}`)
      return options.answer ?? true
    },
    diagnosticLog: { event: (record) => records.push(record) }
  })
  return { openNote, opened, records, root, openDir }
}

describe('markdownOpenFileName (#1631)', () => {
  it('appends .md unless the sanitised name already ends in it', () => {
    expect(markdownOpenFileName('Plan.md')).toBe('Plan.md')
    expect(markdownOpenFileName('Plan')).toBe('Plan.md')
    expect(markdownOpenFileName('notes.txt')).toBe('notes.txt.md')
  })

  it('rewrites hostile names to one component', () => {
    expect(markdownOpenFileName('../../x')).toBe('_.._.._x.md')
    expect(markdownOpenFileName('/etc/passwd')).toBe('_etc_passwd.md')
    expect(markdownOpenFileName('')).toBe('attachment.md')
  })

  it('keeps an over-long name within one path component', () => {
    expect(markdownOpenFileName('a'.repeat(300))).toBe(`${'a'.repeat(252)}.md`)
    expect(markdownOpenFileName(`${'a'.repeat(300)}.md`)).toBe(`${'a'.repeat(252)}.md`)
  })
})

describe('createMarkdownOpen (#1631)', () => {
  it('writes the text into the app-owned directory and opens that file', async () => {
    const h = await harness()
    expect(await h.openNote({ text: '# Plan\n\nBody', displayName: 'Plan.md' })).toEqual({ type: 'opened' })
    expect(h.opened).toEqual([join(h.openDir, 'Plan.md')])
    expect(await readFile(join(h.openDir, 'Plan.md'), 'utf8')).toBe('# Plan\n\nBody')
    expect(await readdir(h.openDir)).toEqual(['Plan.md'])
    expect((await lstat(join(h.openDir, 'Plan.md'))).mode & 0o777).toBe(0o600)
  })

  it('lands a traversal, an absolute path and an empty name inside the directory', async () => {
    const h = await harness()
    for (const displayName of ['../../x', '/etc/passwd', '']) {
      expect(await h.openNote({ text: 'Body', displayName })).toEqual({ type: 'opened' })
    }
    for (const path of h.opened) expect(dirname(path)).toBe(h.openDir)
    expect((await readdir(h.openDir)).sort()).toEqual(['_.._.._x.md', '_etc_passwd.md', 'attachment.md'])
    expect(await readdir(h.root)).toEqual(['markdown-views'])
  })

  it('overwrites the earlier file of the same name rather than accumulating', async () => {
    const h = await harness()
    await h.openNote({ text: 'first', displayName: 'Plan.md' })
    await h.openNote({ text: 'second', displayName: 'Plan.md' })
    expect(await readdir(h.openDir)).toEqual(['Plan.md'])
    expect(await readFile(join(h.openDir, 'Plan.md'), 'utf8')).toBe('second')
  })

  it('replaces a symlink at the target instead of writing through it', async () => {
    const h = await harness()
    await h.openNote({ text: 'seed', displayName: 'Other.md' })
    const outside = join(h.root, 'outside.txt')
    await writeFile(outside, 'untouched')
    await symlink(outside, join(h.openDir, 'Plan.md'))
    expect(await h.openNote({ text: 'note', displayName: 'Plan.md' })).toEqual({ type: 'opened' })
    expect(await readFile(outside, 'utf8')).toBe('untouched')
    expect((await lstat(join(h.openDir, 'Plan.md'))).isSymbolicLink()).toBe(false)
    expect(await readFile(join(h.openDir, 'Plan.md'), 'utf8')).toBe('note')
  })

  it('answers write-failed without asking the OS when the write fails', async () => {
    const h = await harness({ blockOpenDir: true })
    expect(await h.openNote({ text: 'Body', displayName: 'Plan.md' })).toEqual({ type: 'failed', reason: 'write-failed' })
    expect(h.opened).toEqual([])
  })

  it('leaves no temp file behind when the rename fails', async () => {
    const h = await harness()
    await h.openNote({ text: 'seed', displayName: 'Other.md' })
    // A non-empty directory at the target: the rename cannot replace it.
    await mkdir(join(h.openDir, 'Plan.md', 'inner'), { recursive: true })
    expect(await h.openNote({ text: 'Body', displayName: 'Plan.md' })).toEqual({ type: 'failed', reason: 'write-failed' })
    expect((await readdir(h.openDir)).sort()).toEqual(['Other.md', 'Plan.md'])
  })

  it('answers open-failed when the OS declines or the seam rejects', async () => {
    const declined = await harness({ answer: false })
    expect(await declined.openNote({ text: 'Body', displayName: 'Plan.md' })).toEqual({ type: 'failed', reason: 'open-failed' })
    const rejecting = await harness({ throws: true })
    expect(await rejecting.openNote({ text: 'Body', displayName: 'Plan.md' })).toEqual({ type: 'failed', reason: 'open-failed' })
  })

  it('logs static codes only — never the text, the name or the path', async () => {
    const h = await harness()
    await h.openNote({ text: 'secret body', displayName: 'Private-plan.md' })
    const failing = await harness({ answer: false })
    await failing.openNote({ text: 'secret body', displayName: 'Private-plan.md' })
    const blocked = await harness({ blockOpenDir: true })
    await blocked.openNote({ text: 'secret body', displayName: 'Private-plan.md' })
    const records = [...h.records, ...failing.records, ...blocked.records]
    expect(records.map((record) => record.code)).toEqual([
      'started', 'opened', 'started', 'open-failed', 'started', 'write-failed'
    ])
    const serialised = JSON.stringify(records)
    for (const leak of ['secret', 'Private', h.root, failing.root, blocked.root]) {
      expect(serialised).not.toContain(leak)
    }
  })
})

describe('the text bound (#1631)', () => {
  it('admits the largest file the reader can receive', () => {
    // UTF-8 decoding N bytes yields at most N UTF-16 code units.
    expect(MAX_MARKDOWN_OPEN_TEXT_LENGTH).toBeGreaterThanOrEqual(ATTACHMENT_MAX_RETRIEVAL_BYTES)
  })
})
