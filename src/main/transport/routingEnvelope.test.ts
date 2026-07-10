import { describe, it, expect } from 'vitest'
import { encodeRoutingEnvelope, decodeRoutingEnvelope } from './routingEnvelope'

// The pure JSON routing-envelope codec — the daemon-side wrapper the fake routing relay writes on
// its /v1/server leg. No `ws`, no I/O: these assertions pin the wire text directly. The client
// frame is opaque (spliced verbatim, never parsed); only conn_id / token / close_code are the
// relay's own fields.
describe('encodeRoutingEnvelope', () => {
  it('splices frameText VERBATIM into the frame position — never re-serialised (content-blind)', () => {
    // Distinctive key order + interior whitespace a JSON round-trip would normalise away: the
    // frame must survive byte-identical, proving the relay never parses/re-emits the payload.
    const frameText = '{"type":"noise_msg",  "v":2,"data":"AAECf4A="}'
    const out = encodeRoutingEnvelope('c-1', frameText)

    expect(out).toContain(`"frame":${frameText}`)
    // The wrapper is still valid JSON and its frame value round-trips to the same object.
    const parsed = JSON.parse(out)
    expect(parsed.conn_id).toBe('c-1')
    expect(parsed.frame).toEqual({ type: 'noise_msg', v: 2, data: 'AAECf4A=' })
  })

  it('emits token only when provided AND non-empty; conn_id always; close_code never', () => {
    const frameText = '{"a":1}'

    const withToken = JSON.parse(encodeRoutingEnvelope('c-1', frameText, 'tok-xyz'))
    expect(withToken).toEqual({ conn_id: 'c-1', frame: { a: 1 }, token: 'tok-xyz' })
    expect('close_code' in withToken).toBe(false)

    const noToken = JSON.parse(encodeRoutingEnvelope('c-1', frameText))
    expect('token' in noToken).toBe(false)
    expect(noToken.conn_id).toBe('c-1')

    // Empty string is treated as absent (Go `omitempty`): first-frame with no header injects nothing.
    const emptyToken = JSON.parse(encodeRoutingEnvelope('c-1', frameText, ''))
    expect('token' in emptyToken).toBe(false)
  })

  it('escapes conn_id and token so a value with quotes/backslashes cannot break the JSON wrapper', () => {
    const out = encodeRoutingEnvelope('c-"1"', '{"a":1}', 'tok"\\evil')

    const parsed = JSON.parse(out) // must not throw — no JSON-injection into the wrapper
    expect(parsed.conn_id).toBe('c-"1"')
    expect(parsed.token).toBe('tok"\\evil')
    expect(parsed.frame).toEqual({ a: 1 })
  })
})

describe('decodeRoutingEnvelope', () => {
  it('unwraps conn_id, re-serialises frame to text, and reads close_code', () => {
    const env = decodeRoutingEnvelope(
      '{"conn_id":"c-2","frame":{"v":2,"type":"x","data":"AA=="},"close_code":4401}'
    )

    expect(env).not.toBeNull()
    expect(env?.connId).toBe('c-2')
    expect(env?.closeCode).toBe(4401)
    // frame comes back as text the client's tolerant decodeInnerFrame accepts.
    expect(JSON.parse(env?.frameText ?? '')).toEqual({ v: 2, type: 'x', data: 'AA==' })
  })

  it('treats an absent or JSON-null frame as a close-only envelope (frameText === null)', () => {
    expect(
      decodeRoutingEnvelope('{"conn_id":"c-1","frame":null,"close_code":4408}')?.frameText
    ).toBeNull()
    expect(decodeRoutingEnvelope('{"conn_id":"c-1","close_code":4408}')?.frameText).toBeNull()
  })

  it('defaults close_code to 0 when absent or non-numeric', () => {
    expect(decodeRoutingEnvelope('{"conn_id":"c-1","frame":{"a":1}}')?.closeCode).toBe(0)
    expect(
      decodeRoutingEnvelope('{"conn_id":"c-1","frame":{"a":1},"close_code":"nope"}')?.closeCode
    ).toBe(0)
  })

  it('is fail-closed: malformed JSON, a non-object top level, or a bad conn_id → null (never throws)', () => {
    expect(decodeRoutingEnvelope('not json{')).toBeNull()
    expect(decodeRoutingEnvelope('[1,2,3]')).toBeNull()
    expect(decodeRoutingEnvelope('"just a string"')).toBeNull()
    expect(decodeRoutingEnvelope('null')).toBeNull()
    expect(decodeRoutingEnvelope('{"frame":{"a":1}}')).toBeNull() // missing conn_id
    expect(decodeRoutingEnvelope('{"conn_id":42,"frame":{}}')).toBeNull() // mistyped conn_id
  })
})
