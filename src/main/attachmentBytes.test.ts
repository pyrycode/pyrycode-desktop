import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ATTACHMENT_MAX_CONCURRENT_READS, createAttachmentBytes } from './attachmentBytes'
import type { AttachmentBytesEvent } from '../shared/ipc/attachmentBytes'
import type { DiagnosticEvent } from './diagnosticLog'

// Exercises the real filesystem against a throwaway temp dir — attachmentSave.test.ts's harness with
// one directory instead of two, since nothing is written and nothing is revealed.
// Electron-free: this file's module graph never touches `electron`.

const ID = '7f3c1a2b-0000-4000-8000-0123456789ab'
const MISSING_ID = '0123abcd-0000-4000-8000-000000000000'
const DIRECTORY_ID = 'beef0000-0000-4000-8000-000000000000'
const LARGE_ID = 'cafe0000-0000-4000-8000-000000000000'

// Deliberately under 4096 bytes: that is the regime where fs.readFile serves the buffer from Node's
// shared pool, which is the case the exact-buffer assertions below exist to catch.
const SMALL_BYTES = new Uint8Array([0x00, 0x80, 0xff, 0x7f, 0x1f, 0x8b, 0x0a, 0x00])
// Above the pool threshold, where readFile already allocates an exactly-sized buffer.
const LARGE_BYTES = new Uint8Array(5000).map((_, index) => index % 251)

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Harness {
  read: (request: { attachmentId: string }) => Promise<AttachmentBytesEvent>
  records: DiagnosticEvent[]
  attachmentDir: string
}

/** Build the driver over a fresh attachment dir, seeded unless `seed` is false. */
async function harness(options: { seed?: boolean } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'pyry-bytes-'))
  roots.push(root)
  const attachmentDir = join(root, 'attachments')
  if (options.seed !== false) {
    await mkdir(attachmentDir, { recursive: true, mode: 0o700 })
    await writeFile(join(attachmentDir, ID), SMALL_BYTES, { mode: 0o600 })
    await writeFile(join(attachmentDir, LARGE_ID), LARGE_BYTES, { mode: 0o600 })
    await mkdir(join(attachmentDir, DIRECTORY_ID))
  }
  const records: DiagnosticEvent[] = []
  const read = createAttachmentBytes({
    attachmentDir,
    diagnosticLog: { event: (fields) => records.push(fields) }
  })
  return { read, records, attachmentDir }
}

/** Narrow to the delivered arm, failing loudly rather than casting past a failure. */
function delivered(event: AttachmentBytesEvent): { attachmentId: string; bytes: Uint8Array } {
  if (event.type !== 'delivered') {
    throw new Error(`expected delivered, got failed/${event.reason}`)
  }
  return event
}

describe('createAttachmentBytes', () => {
  it('answers the resolved file’s bytes unchanged, with the identifier echoed back', async () => {
    const h = await harness()

    const event = await h.read({ attachmentId: ID })

    expect(event.attachmentId).toBe(ID)
    expect(Array.from(delivered(event).bytes)).toEqual(Array.from(SMALL_BYTES))
    // AC 1: no path, no directory and no URL is even declarable — the event has exactly three keys.
    expect(Object.keys(event).sort()).toEqual(['attachmentId', 'bytes', 'type'])
  })

  it('delivers bytes that span their OWN ArrayBuffer whole, leaking no adjacent heap', async () => {
    // The file is under 4096 bytes, so fs.readFile serves it from Node's shared 8 KB pool and the
    // returned view is a window into memory holding unrelated allocations. Structured clone
    // serializes a typed array as its whole backing ArrayBuffer plus an offset and a length, so
    // sending that view would copy the entire pool to the renderer. The exact-sized copy is what
    // closes that, and nothing else in the type system or the suite would catch its removal.
    const h = await harness()

    const bytes = delivered(await h.read({ attachmentId: ID })).bytes

    expect(bytes.byteOffset).toBe(0)
    expect(bytes.buffer.byteLength).toBe(bytes.length)
    expect(bytes.length).toBe(SMALL_BYTES.length)
    // A Buffer is a Uint8Array subclass, so the declared type would not catch one crossing.
    expect(Buffer.isBuffer(bytes)).toBe(false)
  })

  it('round-trips a file above the pool threshold identically, and just as exactly', async () => {
    const h = await harness()

    const bytes = delivered(await h.read({ attachmentId: LARGE_ID })).bytes

    expect(Array.from(bytes)).toEqual(Array.from(LARGE_BYTES))
    expect(bytes.byteOffset).toBe(0)
    expect(bytes.buffer.byteLength).toBe(bytes.length)
  })

  it('leaves the source in place — it reads, never moves or removes', async () => {
    const h = await harness()
    await h.read({ attachmentId: ID })
    await h.read({ attachmentId: ID })
    expect(Array.from(delivered(await h.read({ attachmentId: ID })).bytes)).toEqual(
      Array.from(SMALL_BYTES)
    )
  })

  it.each([
    ['a traversal identifier', '../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a bare parent reference', '..'],
    ['a separator', 'a/b'],
    ['an over-long identifier', 'a'.repeat(65)],
    ['an uppercase identifier', '7F3C1A2B'],
    ['the empty identifier', '']
  ])('refuses %s through the existing gate', async (_label, attachmentId) => {
    const h = await harness()

    const event = await h.read({ attachmentId })

    expect(event).toEqual({ type: 'failed', attachmentId, reason: 'refused' })
  })

  it('refuses a non-canonical identifier BEFORE any filesystem call', async () => {
    // The attachment directory does not exist at all, so a refusal here can only have come from the
    // resolve gate — a read would have answered `unavailable` (AC 2).
    const h = await harness({ seed: false })

    const refused = await h.read({ attachmentId: '../../etc/passwd' })
    const missing = await h.read({ attachmentId: MISSING_ID })

    expect(refused).toMatchObject({ type: 'failed', reason: 'refused' })
    expect(missing).toMatchObject({ type: 'failed', reason: 'unavailable' })
  })

  it('reports a missing file as a failure DISTINCT from a refusal', async () => {
    // AC 4: a consumer's answer to the two differs — an absent file is fetched via #996 and asked
    // for again, a refused identifier never will be — so the two reasons must not be merged.
    const h = await harness()

    const missing = await h.read({ attachmentId: MISSING_ID })
    const refused = await h.read({ attachmentId: '../../etc/passwd' })

    // Two literals, and the pair of assertions is what pins them apart: collapsing either onto the
    // other would redden exactly one of these lines.
    expect(missing).toEqual({ type: 'failed', attachmentId: MISSING_ID, reason: 'unavailable' })
    expect(refused).toEqual({
      type: 'failed',
      attachmentId: '../../etc/passwd',
      reason: 'refused'
    })
  })

  it('reports an unreadable path as unavailable', async () => {
    // A directory at the resolved path — readFile answers EISDIR on every platform, unlike a chmod.
    const h = await harness()

    const event = await h.read({ attachmentId: DIRECTORY_ID })

    expect(event).toEqual({ type: 'failed', attachmentId: DIRECTORY_ID, reason: 'unavailable' })
  })

  it('bounds the reads in flight, answering the ask over the bound rather than dropping it', async () => {
    // Fired in ONE tick without awaiting: the cap check and the increment both run before the first
    // suspension point, so the (CAP + 1)th ask deterministically observes a full set of slots. If the
    // increment were ever moved after the await, every one of these would be delivered.
    const h = await harness()

    const asks = Array.from({ length: ATTACHMENT_MAX_CONCURRENT_READS + 1 }, () =>
      h.read({ attachmentId: ID })
    )
    const events = await Promise.all(asks)

    expect(events.slice(0, ATTACHMENT_MAX_CONCURRENT_READS).map((event) => event.type)).toEqual(
      Array.from({ length: ATTACHMENT_MAX_CONCURRENT_READS }, () => 'delivered')
    )
    expect(events[ATTACHMENT_MAX_CONCURRENT_READS]).toEqual({
      type: 'failed',
      attachmentId: ID,
      reason: 'busy'
    })
  })

  it('answers two concurrent asks for ONE attachment separately — it never coalesces', async () => {
    // The departure from createAttachmentRetrieval: that driver drops a duplicate ask because the
    // live retrieval's pushed terminal answers both. Here the terminal is a returned promise, and
    // AC 1 requires exactly one answer PER ASK, so a dropped duplicate would hang its caller.
    const h = await harness()

    const [first, second] = await Promise.all([
      h.read({ attachmentId: ID }),
      h.read({ attachmentId: ID })
    ])

    expect(Array.from(delivered(first).bytes)).toEqual(Array.from(SMALL_BYTES))
    expect(Array.from(delivered(second).bytes)).toEqual(Array.from(SMALL_BYTES))
    // Two independent reads, so two independent buffers — neither caller can mutate the other's.
    expect(delivered(first).bytes).not.toBe(delivered(second).bytes)
  })

  it('releases a slot on the FAILURE path, not only on success', async () => {
    const h = await harness()

    const failures = await Promise.all(
      Array.from({ length: ATTACHMENT_MAX_CONCURRENT_READS }, () =>
        h.read({ attachmentId: MISSING_ID })
      )
    )
    const after = await h.read({ attachmentId: ID })

    for (const event of failures) expect(event).toMatchObject({ reason: 'unavailable' })
    expect(Array.from(delivered(after).bytes)).toEqual(Array.from(SMALL_BYTES))
  })

  it('spends no slot on a refused ask — a spray of bad identifiers cannot displace a real read', async () => {
    const h = await harness()

    const asks = Array.from({ length: 10 }, () => h.read({ attachmentId: '../nope' }))
    asks.push(h.read({ attachmentId: ID }))
    const events = await Promise.all(asks)

    expect(events[10]).toMatchObject({ type: 'delivered' })
  })

  it('never rejects: every failure path resolves to a terminal event', async () => {
    const h = await harness()
    const asks = [
      { attachmentId: '../nope' },
      { attachmentId: MISSING_ID },
      { attachmentId: DIRECTORY_ID },
      { attachmentId: ID }
    ]
    const events = await Promise.all(asks.map((ask) => h.read(ask)))
    expect(events.map((event) => event.type)).toEqual([
      'failed',
      'failed',
      'failed',
      'delivered'
    ])
  })

  it('logs static codes only — never the identifier, a path, a length or the content', async () => {
    const h = await harness()
    await h.read({ attachmentId: ID })
    await h.read({ attachmentId: '../../etc/passwd' })
    await h.read({ attachmentId: MISSING_ID })

    expect(h.records.map((record) => record.code)).toEqual([
      'started',
      'delivered',
      'started',
      'refused',
      'started',
      'unavailable'
    ])
    expect(new Set(h.records.map((record) => record.event))).toEqual(new Set(['attachment-bytes']))

    // No length either, though the logging rule would permit one: a length is a size oracle over the
    // user's own content. Asserting the exact key set is what proves its absence — a `bytes` or
    // `length` field added later cannot hide inside a substring check.
    for (const record of h.records) expect(Object.keys(record).sort()).toEqual(['code', 'event'])

    const serialized = JSON.stringify(h.records)
    for (const forbidden of [ID, MISSING_ID, 'etc', 'passwd', h.attachmentDir, '/']) {
      expect(serialized).not.toContain(forbidden)
    }
    // Positive control: the predicate DOES fire when the value is present, so the negatives above
    // are not vacuous.
    expect(JSON.stringify([{ event: 'x', code: ID }])).toContain(ID)
  })

  it('imports no electron and makes no log call — the module graph is Electron-free', () => {
    // Source text, not runtime: the property is about the module graph, and once vitest has resolved
    // the graph there is nothing left at runtime to observe. Asserting the EXACT set fires on an
    // `electron` import and on a renderer import alike. AC 3: no Electron touch, so the base
    // directory can only have arrived as a parameter.
    const source = readFileSync(resolve('src/main/attachmentBytes.ts'), 'utf-8')
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual([
      '../shared/ipc/attachmentBytes',
      './attachmentPath',
      './diagnosticLog',
      'node:fs/promises'
    ])
    expect(source).not.toContain('console.')
  })
})
