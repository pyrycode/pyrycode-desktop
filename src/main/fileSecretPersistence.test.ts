import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileSecretPersistence } from './fileSecretPersistence'

// Exercises the real fs adapter against a throwaway temp dir. Electron-free: this file's module
// graph never touches `electron`, only `node:fs`/`node:os`/`node:path`.

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

// A fresh temp root per test. The persistence `dir` is a *non-existent* subdir so `write` is the
// one that creates it — that's what lets the perms test observe the dir mode the adapter sets.
async function freshDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-secrets-'))
  roots.push(root)
  return join(root, 'secrets')
}

describe('fileSecretPersistence', () => {
  it('round-trips bytes and keeps exactly one .bin file per secret', async () => {
    const dir = await freshDir()
    const store = fileSecretPersistence(dir)

    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x42])
    await store.write('server-record', bytes)
    expect(Array.from((await store.read('server-record')) ?? [])).toEqual(Array.from(bytes))

    const entries = await readdir(dir)
    expect(entries.filter((e) => e.endsWith('.bin'))).toHaveLength(1)
  })

  it('keeps a traversal-style name inside dir, encoded, never escaping it', async () => {
    const dir = await freshDir()
    const store = fileSecretPersistence(dir)

    const bytes = new Uint8Array([1, 2, 3])
    await store.write('../../etc/evil', bytes)

    // The name is base64url-encoded to a single inert token inside dir — no path separators, so
    // nothing is written outside dir. Round-trip still works by the same name.
    const entries = await readdir(dir)
    expect(entries.filter((e) => e.endsWith('.bin'))).toHaveLength(1)
    expect(entries[0]).not.toContain('/')
    expect(entries[0]).not.toContain('..')
    expect(Array.from((await store.read('../../etc/evil')) ?? [])).toEqual(Array.from(bytes))
  })

  it('resolves null for an absent name (ENOENT handled, not thrown)', async () => {
    const store = fileSecretPersistence(await freshDir())
    await expect(store.read('nope')).resolves.toBeNull()
  })

  it('deletes a secret and no-ops an absent-name delete', async () => {
    const store = fileSecretPersistence(await freshDir())

    await store.write('token', new Uint8Array([7, 7]))
    await store.delete('token')
    await expect(store.read('token')).resolves.toBeNull()
    await expect(store.delete('token')).resolves.toBeUndefined()
  })

  it('writes atomically, leaving no temp file and the full payload on success', async () => {
    const dir = await freshDir()
    const store = fileSecretPersistence(dir)

    const big = new Uint8Array(4096)
    for (let i = 0; i < big.length; i += 1) big[i] = i % 256
    await store.write('big', big)

    const entries = await readdir(dir)
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
    expect(Array.from((await store.read('big')) ?? [])).toEqual(Array.from(big))
  })

  it.runIf(process.platform !== 'win32')(
    'creates owner-only dir (0700) and files (0600)',
    async () => {
      const dir = await freshDir()
      const store = fileSecretPersistence(dir)
      await store.write('perm', new Uint8Array([1]))

      expect((await stat(dir)).mode & 0o777).toBe(0o700)
      const entries = await readdir(dir)
      const file = entries.find((e) => e.endsWith('.bin'))
      expect(file).toBeDefined()
      expect((await stat(join(dir, file ?? ''))).mode & 0o777).toBe(0o600)
    }
  )
})
