import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileRotatingSink, stdoutSink } from './diagnosticLogSinks'

// Mirrors fileSecretPersistence.test.ts: a throwaway temp root per test, cleaned in afterEach;
// freshDir() returns a *non-existent* subdir so the sink's first write is what creates it (letting
// the perms test observe the dir mode the sink sets). Electron-free: only node:fs/os/path.
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function freshDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-logs-'))
  roots.push(root)
  return join(root, 'logs')
}

describe('stdoutSink', () => {
  it('writes one record per line with a trailing newline (AC2)', () => {
    const chunks: string[] = []
    const sink = stdoutSink((chunk) => chunks.push(chunk))

    sink.write('{"event":"a"}')
    sink.write('{"event":"b"}')

    expect(chunks).toEqual(['{"event":"a"}\n', '{"event":"b"}\n'])
  })
})

describe('fileRotatingSink', () => {
  it('appends records to main.log in order (AC2)', async () => {
    const dir = await freshDir()
    const sink = fileRotatingSink(dir)

    sink.write('{"seq":0}')
    sink.write('{"seq":1}')

    expect(await readFile(join(dir, 'main.log'), 'utf8')).toBe('{"seq":0}\n{"seq":1}\n')
  })

  it('creates the log dir on first write (no existsSync/TOCTOU)', async () => {
    const dir = await freshDir() // non-existent until the first write
    const sink = fileRotatingSink(dir)

    sink.write('{"seq":0}')

    expect(await readdir(dir)).toContain('main.log')
  })

  it('rotates by size and keeps at most maxFiles rotated files however many writes (AC2)', async () => {
    const dir = await freshDir()
    // Tiny cap so a few writes cross it repeatedly; small retention so the discard is observable.
    const sink = fileRotatingSink(dir, { maxBytes: 40, maxFiles: 2 })

    for (let i = 0; i < 50; i += 1) sink.write(`{"seq":${i},"x":"yy"}`)

    const entries = await readdir(dir)
    expect(entries).toContain('main.log')
    const rotated = entries.filter((e) => e !== 'main.log')
    // Never more than maxFiles rotated files, no matter how many writes — the set stays bounded.
    expect(rotated.length).toBeLessThanOrEqual(2)
    expect(entries.length).toBeLessThanOrEqual(3)
  })

  it('discards the oldest content on rotation — the file set does not grow (AC2)', async () => {
    const dir = await freshDir()
    const sink = fileRotatingSink(dir, { maxBytes: 40, maxFiles: 2 })

    // A distinctive first record that must be rotated out (beyond .maxFiles) once enough newer
    // records push past it.
    sink.write('{"seq":0,"marker":"OLDEST"}')
    for (let i = 1; i < 50; i += 1) sink.write(`{"seq":${i},"x":"yy"}`)

    const entries = await readdir(dir)
    const all = await Promise.all(entries.map((e) => readFile(join(dir, e), 'utf8')))
    expect(all.join('')).not.toContain('OLDEST')
  })

  it.runIf(process.platform !== 'win32')(
    'creates an owner-only dir (0700) and log file (0600)',
    async () => {
      const dir = await freshDir()
      const sink = fileRotatingSink(dir)
      sink.write('{"seq":0}')

      expect((await stat(dir)).mode & 0o777).toBe(0o700)
      expect((await stat(join(dir, 'main.log'))).mode & 0o777).toBe(0o600)
    }
  )
})
