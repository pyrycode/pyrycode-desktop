import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildClientHello, parseHelloAck } from './helloExchange'
import { encodeEnvelope, decodeEnvelope, makeHelloClientPayload, WireDecodeError } from './codec'
import type { ClientHelloInput } from './helloExchange'
import type { Envelope, HelloAckPayload } from '../../shared/wire/types'

// Fixtures build hello_ack bytes through the real serializer (encodeEnvelope), so the tests
// exercise the wire form the driver actually feeds parseHelloAck, not hand-typed JSON that
// could drift from the codec. Mirrors codec.test.ts's round-trip idiom.

const utf8 = new TextDecoder('utf-8')
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)

const baseInput: ClientHelloInput = {
  id: 1,
  ts: '2026-07-04T12:00:00Z',
  deviceName: 'desktop-1',
  clientVersion: '0.1.0',
  token: 'secret-token'
}

/** Serialize a hello_ack envelope the way the daemon would; `extra` overrides envelope fields. */
const ackBytes = (payload: unknown, extra: Partial<Envelope> = {}): Uint8Array =>
  encodeEnvelope({ id: 1, type: 'hello_ack', ts: '2026-07-04T12:00:00Z', payload, ...extra })

describe('buildClientHello', () => {
  it('encodes the replay position and omits absent replay and timestamp fields', () => {
    const withCursor = decodeEnvelope(buildClientHello({ ...baseInput, lastEventId: 42 }))
    expect(withCursor.payload).toMatchObject({ last_event_id: 42 })
    expect(withCursor.payload).not.toHaveProperty('last_seen_ts')
    const fresh = decodeEnvelope(buildClientHello(baseInput))
    expect(fresh.payload).not.toHaveProperty('last_event_id')
    expect(fresh.payload).not.toHaveProperty('last_seen_ts')
  })
  it('wraps a defaults-injected HelloClientPayload in a hello envelope with the input id/ts', () => {
    const decoded = decodeEnvelope(buildClientHello(baseInput))
    expect(decoded.id).toBe(1)
    expect(decoded.type).toBe('hello')
    expect(decoded.ts).toBe('2026-07-04T12:00:00Z')
    expect(decoded.payload).toEqual(
      makeHelloClientPayload({
        deviceName: 'desktop-1',
        clientVersion: '0.1.0',
        token: 'secret-token'
      })
    )
  })

  it('reports client_version as pyrycode-desktop/<version>, the format the daemon parses', () => {
    const json = utf8.decode(buildClientHello(baseInput))
    expect(json).toContain('"client_version":"pyrycode-desktop/0.1.0"')
  })

  it('defaults capabilities to [] and never advertises interactive when none is passed', () => {
    const json = utf8.decode(buildClientHello(baseInput))
    expect(json).toContain('"capabilities":[]')
    expect(json).not.toContain('interactive')
  })

  it('threads passed capabilities through to the payload verbatim', () => {
    const decoded = decodeEnvelope(buildClientHello({ ...baseInput, capabilities: ['message'] }))
    expect((decoded.payload as { capabilities: string[] }).capabilities).toEqual(['message'])
  })

  it('includes last_seen_ts when provided and omits it (no null) when absent', () => {
    const withLast = utf8.decode(buildClientHello({ ...baseInput, lastSeenTs: '2026-07-01T00:00:00Z' }))
    expect(withLast).toContain('"last_seen_ts":"2026-07-01T00:00:00Z"')

    const withoutLast = utf8.decode(buildClientHello(baseInput))
    expect(withoutLast).not.toContain('last_seen_ts')
    expect(withoutLast).not.toContain('null')
  })

  it('is deterministic: identical inputs produce byte-identical output', () => {
    expect(buildClientHello(baseInput)).toEqual(buildClientHello(baseInput))
  })
})

describe('parseHelloAck — happy path', () => {
  it('parses a full ack into a typed HelloAckPayload with every field equal', () => {
    const payload: HelloAckPayload = {
      protocol_version: 'v2',
      server_id: 'srv-1',
      conn_id: 'conn-1',
      capabilities: ['interactive']
    }
    expect(parseHelloAck(ackBytes(payload))).toEqual(payload)
  })

  it('defaults capabilities to [] when the daemon omits the field (omitempty case)', () => {
    // The daemon marshals hello_ack with capabilities omitempty, so a legitimate ack omits it.
    // Treating it as required would fail-closed on a real response — this pins that it does not.
    const bytes = ackBytes({ protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1' })
    expect(parseHelloAck(bytes)).toEqual({
      protocol_version: 'v2',
      server_id: 'srv-1',
      conn_id: 'conn-1',
      capabilities: []
    })
  })

  it('tolerates unknown extra keys but returns only the four known fields', () => {
    const bytes = ackBytes(
      {
        protocol_version: 'v2',
        server_id: 'srv-1',
        conn_id: 'conn-1',
        capabilities: ['interactive'],
        server_added_field: 'ignored'
      },
      { in_reply_to: 1 }
    )
    expect(parseHelloAck(bytes)).toEqual({
      protocol_version: 'v2',
      server_id: 'srv-1',
      conn_id: 'conn-1',
      capabilities: ['interactive']
    })
  })
})

describe('parseHelloAck — fails closed (WireDecodeError)', () => {
  const goodPayload = {
    protocol_version: 'v2',
    server_id: 'srv-1',
    conn_id: 'conn-1',
    capabilities: ['interactive']
  }

  it('rejects an envelope whose type is not hello_ack', () => {
    for (const type of ['message', 'error', 'hello']) {
      expect(() => parseHelloAck(ackBytes(goodPayload, { type }))).toThrow(WireDecodeError)
    }
  })

  it('rejects a non-record payload (string, number, array, null)', () => {
    for (const payload of ['a string', 42, [1, 2, 3], null]) {
      expect(() => parseHelloAck(ackBytes(payload))).toThrow(WireDecodeError)
    }
  })

  it('rejects a missing or non-string protocol_version', () => {
    expect(() => parseHelloAck(ackBytes({ server_id: 'srv-1', conn_id: 'conn-1' }))).toThrow(
      WireDecodeError
    )
    expect(() =>
      parseHelloAck(ackBytes({ protocol_version: 2, server_id: 'srv-1', conn_id: 'conn-1' }))
    ).toThrow(WireDecodeError)
  })

  it('rejects a missing or non-string server_id', () => {
    expect(() => parseHelloAck(ackBytes({ protocol_version: 'v2', conn_id: 'conn-1' }))).toThrow(
      WireDecodeError
    )
    expect(() =>
      parseHelloAck(ackBytes({ protocol_version: 'v2', server_id: 5, conn_id: 'conn-1' }))
    ).toThrow(WireDecodeError)
  })

  it('rejects a missing or non-string conn_id', () => {
    expect(() => parseHelloAck(ackBytes({ protocol_version: 'v2', server_id: 'srv-1' }))).toThrow(
      WireDecodeError
    )
    expect(() =>
      parseHelloAck(ackBytes({ protocol_version: 'v2', server_id: 'srv-1', conn_id: true }))
    ).toThrow(WireDecodeError)
  })

  it('rejects a capabilities that is present but not an array of strings', () => {
    for (const capabilities of ['x', [1, 2], {}]) {
      expect(() =>
        parseHelloAck(
          ackBytes({ protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1', capabilities })
        )
      ).toThrow(WireDecodeError)
    }
  })

  it('surfaces the codec decode failures through this function', () => {
    expect(() => parseHelloAck(new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow(WireDecodeError) // invalid UTF-8
    expect(() => parseHelloAck(bytesOf('{not json'))).toThrow(WireDecodeError) // malformed JSON
    expect(() => parseHelloAck(bytesOf('[1,2,3]'))).toThrow(WireDecodeError) // not an object
    expect(() => parseHelloAck(bytesOf('{"type":"hello_ack","ts":"t","payload":{}}'))).toThrow(
      WireDecodeError
    ) // envelope missing id
  })
})

describe('parseHelloAck — secret-safety of error messages (AC #4)', () => {
  it('names the failure category only; never echoes ack field values', () => {
    let caught: unknown
    try {
      // conn_id has the wrong type; server_id carries a distinctive value that must not leak.
      parseHelloAck(ackBytes({ protocol_version: 'v2', server_id: 'DO-NOT-ECHO-ME', conn_id: 99 }))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(WireDecodeError)
    expect((caught as WireDecodeError).message).toContain('conn_id')
    expect((caught as WireDecodeError).message).not.toContain('DO-NOT-ECHO-ME')
  })
})

describe('hello exchange — no console output anywhere (AC #4)', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never calls console across happy build/parse and every reject branch', () => {
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))

    buildClientHello(baseInput)
    buildClientHello({ ...baseInput, capabilities: ['message'], lastSeenTs: '2026-07-01T00:00:00Z' })
    parseHelloAck(
      ackBytes({ protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1', capabilities: [] })
    )
    parseHelloAck(ackBytes({ protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1' }))

    const rejects: Array<() => void> = [
      () => parseHelloAck(ackBytes({ protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1' }, { type: 'message' })),
      () => parseHelloAck(ackBytes('not-a-record')),
      () => parseHelloAck(ackBytes({ server_id: 'srv-1', conn_id: 'conn-1' })),
      () => parseHelloAck(ackBytes({ protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1', capabilities: [1] })),
      () => parseHelloAck(bytesOf('{not json'))
    ]
    for (const run of rejects) {
      expect(run).toThrow(WireDecodeError)
    }

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
    }
  })
})

describe('parseHelloAck workspace root', () => {
  const base = { protocol_version: 'v2', server_id: 'srv', conn_id: 'conn', capabilities: [] }
  it.each(['/home/pyry/pyry-workspace', '/', '', 'relative'])('preserves string %s verbatim', (workspace_root) => {
    expect(parseHelloAck(ackBytes({ ...base, workspace_root }))).toEqual({ ...base, workspace_root })
  })
  it('keeps an omitted root absent for older hosts', () => {
    expect(parseHelloAck(ackBytes(base))).not.toHaveProperty('workspace_root')
  })
  it.each([null, 1, true, [], { private: 'do-not-echo' }])('rejects a present non-string root', (workspace_root) => {
    expect(() => parseHelloAck(ackBytes({ ...base, workspace_root }))).toThrow(WireDecodeError)
    expect(() => parseHelloAck(ackBytes({ ...base, workspace_root }))).not.toThrow('do-not-echo')
  })
})
