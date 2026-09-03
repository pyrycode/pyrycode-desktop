import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { storeAttachment, ATTACHMENT_DIR_NAME } from './attachmentStore'

// Exercises the real filesystem against a throwaway temp dir. Electron-free: this file's module
// graph never touches `electron`, only `node:fs`/`node:os`/`node:path`.
//
// The sibling rule attachmentPath.test.ts records binds here too: NEVER build a path expectation
// from the function's own return value — assert the three independent properties instead, or a build
// that wrote to the wrong place would still pass by comparing itself against itself.

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** The identifier shape the daemon mints, and the one `resolveAttachmentPath` admits. */
const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

/** A temp root plus the attachment dir path INSIDE it — deliberately not created, since the first
 *  write must create it (that is the row the 0o700 assertion needs). */
async function freshBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-attach-'))
  roots.push(root)
  return join(root, ATTACHMENT_DIR_NAME)
}

const bytesOf = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_unused, i) => (i * 31 + 7) % 251)

describe('storeAttachment — the happy path', () => {
  it('writes the exact bytes at the gate’s path for the identifier', async () => {
    const baseDir = await freshBase()
    const bytes = bytesOf(4096)

    const result = await storeAttachment(baseDir, ID, bytes)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Composed independently of `result.path`: absolute, a direct child of baseDir, named by the
    // identifier verbatim, and extension-less — the shape #814/#866/#867 read as a commitment.
    expect(isAbsolute(result.path)).toBe(true)
    expect(dirname(result.path)).toBe(baseDir)
    expect(basename(result.path)).toBe(ID)
    expect(extname(result.path)).toBe('')
    expect(new Uint8Array(await readFile(join(baseDir, ID)))).toEqual(bytes)
  })

  it('creates the directory on first write, owner-only, and writes the file owner-only', async () => {
    const baseDir = await freshBase()

    await storeAttachment(baseDir, ID, bytesOf(8))

    expect((await stat(baseDir)).mode & 0o777).toBe(0o700)
    expect((await stat(join(baseDir, ID))).mode & 0o777).toBe(0o600)
  })

  it('stores a zero-byte attachment as a zero-length file, not as an absence', async () => {
    const baseDir = await freshBase()

    const result = await storeAttachment(baseDir, ID, new Uint8Array(0))

    expect(result.ok).toBe(true)
    expect((await stat(join(baseDir, ID))).size).toBe(0)
  })

  it('replaces in place on a re-fetch rather than accumulating suffixed copies', async () => {
    const baseDir = await freshBase()
    await storeAttachment(baseDir, ID, bytesOf(16))

    const second = await storeAttachment(baseDir, ID, bytesOf(32))

    // The anti-saveDebugBundle row: that module must never overwrite because it protects a
    // user-facing Downloads name; this path is content-addressed, so the same id is the same file.
    expect(second.ok).toBe(true)
    expect(await readdir(baseDir)).toEqual([ID])
    expect(new Uint8Array(await readFile(join(baseDir, ID)))).toEqual(bytesOf(32))
  })

  it('leaves no temp file behind on success', async () => {
    const baseDir = await freshBase()

    await storeAttachment(baseDir, ID, bytesOf(64))

    expect(await readdir(baseDir)).toEqual([ID])
  })
})

describe('storeAttachment — refusals', () => {
  it.each([
    ['traversal', '../../etc/passwd'],
    ['a separator', 'a/b'],
    ['an absolute path', '/etc/passwd'],
    ['the empty identifier', ''],
    ['mixed case', '3F2504E0-4F89-41D3-9A0C-0305E82C3301']
  ])('refuses %s and touches nothing', async (_label, id) => {
    const baseDir = await freshBase()

    const result = await storeAttachment(baseDir, id, bytesOf(8))

    expect(result).toEqual({ ok: false, reason: 'store-failed' })
    // Not merely "no file": the directory itself is never created, so a refusal cannot be told from
    // a write by side effect either.
    await expect(stat(baseDir)).rejects.toThrow()
  })

  it('reports a failed write as the same static reason, with no path and no errno', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pyry-attach-'))
    roots.push(root)
    // A regular file where the attachment directory should be: mkdir cannot proceed.
    const baseDir = join(root, ATTACHMENT_DIR_NAME)
    await writeFile(baseDir, 'not a directory')

    const result = await storeAttachment(baseDir, ID, bytesOf(8))

    // A node:fs errno carries the offending path in its own message; returning a static reason
    // instead of rethrowing is what keeps an attachment path out of a caller's log.
    expect(result).toEqual({ ok: false, reason: 'store-failed' })
  })

  it('unlinks the temp file when the rename fails, so no partial artifact survives', async () => {
    const baseDir = await freshBase()
    await mkdir(baseDir, { recursive: true })
    // A directory sitting at the target path: the write succeeds, the rename onto it does not.
    await mkdir(join(baseDir, ID))

    const result = await storeAttachment(baseDir, ID, bytesOf(8))

    expect(result).toEqual({ ok: false, reason: 'store-failed' })
    expect(await readdir(baseDir)).toEqual([ID])
    expect((await stat(join(baseDir, ID))).isDirectory()).toBe(true)
  })
})

describe('attachmentStore — the composition-root seam', () => {
  it('names the one directory every composition root joins onto the app-data path', () => {
    expect(ATTACHMENT_DIR_NAME).toBe('attachments')
  })

  it('imports no electron: baseDir is a parameter, so the module graph stays Electron-free', () => {
    const source = readFileSync(resolve('src/main/attachmentStore.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([
      './attachmentPath',
      'node:crypto',
      'node:fs/promises'
    ])
  })
})
