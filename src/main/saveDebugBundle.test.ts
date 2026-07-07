import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, dirname, join } from 'node:path'
import { saveDebugBundle } from './saveDebugBundle'

// Exercises the real fs persistence against a throwaway temp dir. Electron-free: this file's
// module graph never touches `electron`, only `node:fs`/`node:os`/`node:path`.

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

// A fresh, already-existing temp dir per test. Unlike the fileSecretPersistence harness, `dir`
// must EXIST up front: the downloads folder pre-exists and is user-owned, and this module must
// never create it. mkdtemp both creates the dir and registers it for cleanup.
async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pyry-bundle-'))
  roots.push(dir)
  return dir
}

// A path under a fresh root that does NOT exist — for the "must not create the dir" scenarios.
async function missingDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-bundle-'))
  roots.push(root)
  return join(root, 'does-not-exist')
}

describe('saveDebugBundle', () => {
  it('writes bytes verbatim and returns the absolute path inside dir', async () => {
    const dir = await freshDir()
    // Edge byte values to prove a verbatim, opaque write with no transcoding.
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x1f, 0x8b])

    const path = await saveDebugBundle(dir, bytes)

    expect(isAbsolute(path)).toBe(true)
    expect(dirname(path)).toBe(dir)
    expect(path.endsWith('.tar.gz')).toBe(true)
    expect(Array.from(await readFile(path))).toEqual(Array.from(bytes))
  })

  it('never overwrites: successive saves yield distinct files, each equal to its own input', async () => {
    const dir = await freshDir()
    const first = new Uint8Array([1, 1, 1])
    const second = new Uint8Array([2, 2, 2, 2])
    const third = new Uint8Array([3])

    const p1 = await saveDebugBundle(dir, first)
    const p2 = await saveDebugBundle(dir, second)
    const p3 = await saveDebugBundle(dir, third)

    // Three distinct destinations; the suffix sequence advances.
    expect(new Set([p1, p2, p3]).size).toBe(3)

    // The first save is intact — the second and third never clobbered it.
    expect(Array.from(await readFile(p1))).toEqual(Array.from(first))
    expect(Array.from(await readFile(p2))).toEqual(Array.from(second))
    expect(Array.from(await readFile(p3))).toEqual(Array.from(third))

    // Exactly three .tar.gz files landed in the dir.
    const entries = await readdir(dir)
    expect(entries.filter((e) => e.endsWith('.tar.gz'))).toHaveLength(3)
  })

  it.runIf(process.platform !== 'win32')('creates the file owner-only (0600)', async () => {
    const dir = await freshDir()
    const path = await saveDebugBundle(dir, new Uint8Array([1]))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('rejects (catchably) when dir does not exist, with an errno code and no byte values', async () => {
    const bytes = new Uint8Array([0x11, 0x22, 0x33])

    const err = await saveDebugBundle(await missingDir(), bytes).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    // Carries a filesystem errno the caller can map to a user-facing error.
    expect((err as NodeJS.ErrnoException).code).toBeTruthy()
    // Never leaks the bundle byte values in the rejection.
    const text = `${(err as Error).message} ${(err as NodeJS.ErrnoException).code}`
    for (const b of bytes) expect(text).not.toContain(String(b))
  })

  it('rejects when dir is a regular file (ENOTDIR-style), without creating anything', async () => {
    const root = await freshDir()
    const asFile = join(root, 'a-file')
    await writeFile(asFile, 'x')

    await expect(saveDebugBundle(asFile, new Uint8Array([9]))).rejects.toThrow()
  })

  it('does not create the target directory — a missing dir rejects, it is never mkdir-ed', async () => {
    const dir = await missingDir()

    await expect(saveDebugBundle(dir, new Uint8Array([1]))).rejects.toThrow()

    // The module must not have silently created the directory.
    await expect(stat(dir)).rejects.toThrow()
  })

  it('writes an empty payload to a 0-byte file and returns its path', async () => {
    const dir = await freshDir()
    const path = await saveDebugBundle(dir, new Uint8Array(0))
    expect((await readFile(path)).length).toBe(0)
  })
})
