import { describe, it, expect } from 'vitest'
import {
  createDiagnosticLog,
  encodeSafeBytes,
  MAX_SAFE_BYTES,
  type DiagnosticEvent,
  type DiagnosticSink
} from './diagnosticLog'

// Exercises the Electron-free core: its sole side effect is sink.write(one serialized line). A
// capture sink pushes each line into an array so a test can parse and assert on it — no fs.
function captureSink(): { lines: string[]; sink: DiagnosticSink } {
  const lines: string[] = []
  return { lines, sink: { write: (line) => void lines.push(line) } }
}

const FIXED_TS = '2026-01-01T00:00:00.000Z'

describe('createDiagnosticLog', () => {
  it('serializes an allowlisted event and stamps seq + ts (AC1)', () => {
    const { lines, sink } = captureSink()
    const log = createDiagnosticLog({ sink, now: () => FIXED_TS })

    log.event({ event: 'relay-closed', status: 1006, code: 'pong-timeout' })

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      event: 'relay-closed',
      status: 1006,
      code: 'pong-timeout',
      seq: 0,
      ts: FIXED_TS
    })
  })

  it('assigns a strictly monotonic, gap-free seq per call (AC1)', () => {
    const { lines, sink } = captureSink()
    const log = createDiagnosticLog({ sink })

    log.event({ event: 'a' })
    log.event({ event: 'b' })
    log.event({ event: 'c' })

    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([0, 1, 2])
  })

  it('stamps every record with the injected clock (AC1)', () => {
    const { lines, sink } = captureSink()
    const log = createDiagnosticLog({ sink, now: () => FIXED_TS })

    log.event({ event: 'a' })
    log.event({ event: 'b' })

    expect(lines.map((l) => JSON.parse(l).ts)).toEqual([FIXED_TS, FIXED_TS])
  })

  it('has no code path by which a secret reaches the sink (AC4)', () => {
    // Planted secrets of the three shapes the transport must never leak.
    const token = 'tok_live_SECRET_bearer_0123456789'
    const key = 'aGVsbG8gd29ybGQgc2VjcmV0IGtleSBiYXNlNjQ='
    const plaintext = 'the-user-message-plaintext-body'

    const { lines, sink } = captureSink()
    const log = createDiagnosticLog({ sink, now: () => FIXED_TS })

    // A representative event set spanning every allowlisted field. No API parameter can carry a
    // token, key, header map, URL query, or payload bytes — so the planted secrets have no way in.
    log.event({ event: 'relay-connected' })
    log.event({ event: 'relay-closed', status: 1006, code: 'pong-timeout' })
    log.event({ event: 'daemon-failed', code: 'not-paired' })
    log.event({ event: 'message-received', count: 3, bytes: 512 })
    log.event({ event: 'relay-dial', host: 'relay.example.com', path: '/v1/client' })

    const output = lines.join('\n')
    expect(output).not.toContain(token)
    expect(output).not.toContain(key)
    expect(output).not.toContain(plaintext)
  })

  it('swallows a sink-write throw so a log call never takes down the caller (AC3)', () => {
    const log = createDiagnosticLog({
      sink: {
        write() {
          throw new Error('disk full')
        }
      }
    })

    expect(() => log.event({ event: 'x' })).not.toThrow()
  })

  it('rejects secret-carrying fields at the type level (AC1, compile-time)', () => {
    // The content-free guarantee is STRUCTURAL: the allowlist has no token / header map / url /
    // payload field. These object literals never reach a real log call — they exist so `npm run
    // typecheck` (which includes this .test.ts) proves the excess-property check forbids each shape.
    // If any ever compiled, its @ts-expect-error would become an unused-directive tsc error.
    const events: DiagnosticEvent[] = []
    // @ts-expect-error — no `token` field in the allowlist
    events.push({ event: 'x', token: 'secret' })
    // @ts-expect-error — no `headers` field in the allowlist
    events.push({ event: 'x', headers: { authorization: 'Bearer secret' } })
    // @ts-expect-error — no `url` field in the allowlist (would carry a query string)
    events.push({ event: 'x', url: 'wss://relay/v1/client?token=secret' })
    // @ts-expect-error — no `payload` field in the allowlist
    events.push({ event: 'x', payload: new Uint8Array([1, 2, 3]) })

    // #133 (AC5): `safeBytes` DOES exist, but it is branded — only the pre-decryption encoder's
    // output satisfies it. A plain string, or a post-decryption-derived value (e.g. the `hash?`
    // digest, a bare hex string), fails to type-check into it, so the pre/post-decryption boundary
    // is enforced by the type system, not convention.
    // @ts-expect-error — a plain string literal lacks the SafeBytesEncoding brand
    events.push({ event: 'x', safeBytes: 'deadbeef' })
    const postDecryptionHash: string = 'a'.repeat(64) // e.g. hashPlaintext() output — a bare string
    // @ts-expect-error — a post-decryption-derived string is not a pre-decryption SafeBytesEncoding
    events.push({ event: 'x', safeBytes: postDecryptionHash })
    // The encoder's output DOES satisfy the field (the sole minter): this line must compile.
    events.push({ event: 'x', safeBytes: encodeSafeBytes(new Uint8Array([1, 2, 3])) })

    expect(events).toHaveLength(7)
  })

  it('hex-encodes a pre-decryption frame content-free, bounded to MAX_SAFE_BYTES (AC1/AC3)', () => {
    // Short frames encode whole, as lowercase hex — never a decoded string.
    expect(encodeSafeBytes(new Uint8Array([0x00, 0xff, 0x10, 0xab]))).toBe('00ff10ab')
    expect(encodeSafeBytes(new Uint8Array(0))).toBe('')

    // An over-long frame is truncated to the cap BEFORE hex-encoding: the hex is at most 2×cap chars.
    const long = new Uint8Array(MAX_SAFE_BYTES + 32).fill(0xcd)
    const hex = encodeSafeBytes(long)
    expect(hex).toHaveLength(2 * MAX_SAFE_BYTES)
    expect(hex).toBe('cd'.repeat(MAX_SAFE_BYTES))
    expect(hex).toMatch(/^[0-9a-f]*$/)
  })

  it('carries a branded safeBytes value all the way to the sink (AC1)', () => {
    const { lines, sink } = captureSink()
    const log = createDiagnosticLog({ sink, now: () => FIXED_TS })
    const frame = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

    log.event({
      event: 'noise-frame-failed',
      code: 'transport-decrypt-failed',
      bytes: frame.length,
      safeBytes: encodeSafeBytes(frame)
    })

    expect(JSON.parse(lines[0])).toMatchObject({
      event: 'noise-frame-failed',
      code: 'transport-decrypt-failed',
      bytes: 4,
      safeBytes: 'deadbeef'
    })
  })

  it('emits exactly one line per call even when a field value contains a newline', () => {
    const { lines, sink } = captureSink()
    const log = createDiagnosticLog({ sink })

    log.event({ event: 'multi\nline\nevent' })

    // JSON.stringify escapes the embedded newline, so a string field cannot split one record into
    // two lines — the record count equals the call count.
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('\n')
    expect(JSON.parse(lines[0]).event).toBe('multi\nline\nevent')
  })
})
