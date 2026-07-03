import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { NOISE_PROTOCOL } from '../../shared/wire/types'
import type { HelloClientPayload, HelloAckPayload } from '../../shared/wire/types'
import {
  createNoiseInitiator,
  loadNoiseLib,
  type NoiseInitiator,
  type NoiseInitiatorEvent
} from './noiseSpike'

// The #29 Noise spike is proven two ways, both deterministic and credential-free (no socket,
// no daemon, no key on disk):
//   Mode 1 — hash conformance against the load-bearing BLAKE2s constraint, using the library
//            directly (the trap this ticket names: a library that silently hashes with BLAKE2b).
//   Mode 2 — a JS-initiator (the harness) <-> JS-responder (the inline helper below) IK
//            round-trip that carries a real hello/hello_ack early-data payload with a dummy
//            device token inside message 1, then exchanges one AEAD-sealed frame each way.
// The byte-for-byte CROSS-IMPLEMENTATION vector match (Go flynn/noise reference bytes) and the
// final recommend/reject verdict are #30's, per the spec.

const EMPTY_AD = new Uint8Array(0)

const enc = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj))
const bytes = (u: Uint8Array): number[] => Array.from(u)

// A hello-shaped body carrying a DUMMY device token (never a real credential) — imitates the
// production HelloClientPayload so mode 2 proves the token rides inside IK message 1.
const HELLO: HelloClientPayload = {
  role: 'client',
  device_name: 'noise-spike-desktop',
  client_version: '0',
  protocol_versions: ['v2'],
  token: 'dummy-device-token-not-a-real-credential',
  capabilities: ['interactive']
}
const HELLO_ACK: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'noise-spike-server',
  conn_id: 'spike-conn-1',
  capabilities: ['interactive']
}

// --- inline IK responder, TEST-ONLY (closes the JS<->JS loop; #30 replaces it with the real
// daemon). Same send-out / frame-in shape as the harness. It recovers the initiator's hello
// early-data, replies with a hello_ack, splits, then decrypts inbound / encrypts outbound. ---
type NoiseResponderEvent =
  | { type: 'handshake-complete'; hello: Uint8Array }
  | { type: 'message'; plaintext: Uint8Array }
  | { type: 'error'; reason: string }

interface NoiseResponder {
  onFrame(frame: Uint8Array): void
  sendMessage(plaintext: Uint8Array): void
  close(): void
}

async function createNoiseResponder(config: {
  staticPrivateKey: Uint8Array
  prologue: Uint8Array
  helloAck: Uint8Array
  sendFrame: (frame: Uint8Array) => void
  onEvent: (event: NoiseResponderEvent) => void
}): Promise<NoiseResponder> {
  const lib = await loadNoiseLib()
  let hs: ReturnType<typeof lib.HandshakeState> | null = lib.HandshakeState(
    NOISE_PROTOCOL,
    lib.constants.NOISE_ROLE_RESPONDER
  )
  hs.Initialize(config.prologue.length > 0 ? config.prologue : null, config.staticPrivateKey, null, null)
  let send: ReturnType<typeof hs.Split>[0] | null = null
  let recv: ReturnType<typeof hs.Split>[1] | null = null
  let state: 'awaiting-init' | 'transport' | 'closed' = 'awaiting-init'

  return {
    onFrame(frame) {
      if (state === 'closed') return
      if (state === 'transport') {
        if (!recv) return
        try {
          config.onEvent({ type: 'message', plaintext: recv.DecryptWithAd(EMPTY_AD, frame) })
        } catch {
          config.onEvent({ type: 'error', reason: 'transport-decrypt-failed' })
        }
        return
      }
      if (!hs) return
      try {
        const hello = hs.ReadMessage(frame, true) ?? new Uint8Array(0)
        const reply = hs.WriteMessage(config.helloAck)
        const pair = hs.Split()
        hs = null
        send = pair[0]
        recv = pair[1]
        state = 'transport'
        config.onEvent({ type: 'handshake-complete', hello })
        config.sendFrame(reply)
      } catch {
        hs = null
        state = 'closed'
        config.onEvent({ type: 'error', reason: 'handshake-read-failed' })
      }
    },
    sendMessage(plaintext) {
      if (state !== 'transport' || !send) return
      config.sendFrame(send.EncryptWithAd(EMPTY_AD, plaintext))
    },
    close() {
      state = 'closed'
      for (const obj of [hs, send, recv]) {
        try {
          obj?.free()
        } catch {
          /* idempotent teardown */
        }
      }
      hs = null
      send = null
      recv = null
    }
  }
}

function collector<E>(): { events: E[]; onEvent: (e: E) => void } {
  const events: E[] = []
  return { events, onEvent: (e) => events.push(e) }
}

const initErrors = (events: NoiseInitiatorEvent[]): string[] =>
  events.filter((e) => e.type === 'error').map((e) => (e as { reason: string }).reason)

// Warm the memoized wasm load ONCE before any spy is installed: the Emscripten glue prints a
// one-time streaming-compile fallback warning at first load, which is the library's, not the
// harness's — warming here keeps the log-free assertion measuring the harness alone.
beforeAll(async () => {
  await loadNoiseLib()
})

const handles: Array<{ close: () => void }> = []
afterEach(() => {
  for (const h of handles.splice(0)) {
    try {
      h.close()
    } catch {
      /* teardown */
    }
  }
})

describe('mode 1 — Noise_IK_25519_ChaChaPoly_BLAKE2s hash conformance (library directly)', () => {
  it('constructs the exact suite as both IK roles without error', async () => {
    const lib = await loadNoiseLib()
    expect(NOISE_PROTOCOL).toBe('Noise_IK_25519_ChaChaPoly_BLAKE2s')
    const init = lib.HandshakeState(NOISE_PROTOCOL, lib.constants.NOISE_ROLE_INITIATOR)
    const resp = lib.HandshakeState(NOISE_PROTOCOL, lib.constants.NOISE_ROLE_RESPONDER)
    expect(init).toBeTruthy()
    expect(resp).toBeTruthy()
    init.free()
    resp.free()
  })

  it('rejects a wrong-hash / bogus suite name — the name is genuinely parsed, not defaulted', async () => {
    const lib = await loadNoiseLib()
    // If the library silently defaulted the hash, a bogus hash token would still construct.
    expect(() =>
      lib.HandshakeState('Noise_IK_25519_ChaChaPoly_BLAKE2z', lib.constants.NOISE_ROLE_INITIATOR)
    ).toThrow(/UNKNOWN_NAME/)
  })

  // Completing a real IK handshake and reading the channel-binding hash. BLAKE2s is a 256-bit
  // hash (32 bytes); BLAKE2b/SHA-512 are 512-bit (64 bytes). A library that silently used
  // BLAKE2b for the BLAKE2s suite name — the exact trap this ticket names — would surface a
  // 64-byte hash here. Both sides must also derive the identical hash (channel binding).
  const runHandshakeHash = (
    lib: Awaited<ReturnType<typeof loadNoiseLib>>,
    hashName: string
  ): { initHash: Uint8Array; respHash: Uint8Array } => {
    const proto = `Noise_IK_25519_ChaChaPoly_${hashName}`
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = lib.HandshakeState(proto, lib.constants.NOISE_ROLE_INITIATOR)
    init.Initialize(null, initPriv, respPub, null)
    const resp = lib.HandshakeState(proto, lib.constants.NOISE_ROLE_RESPONDER)
    resp.Initialize(null, respPriv, null, null)
    resp.ReadMessage(init.WriteMessage(enc(HELLO)), true)
    init.ReadMessage(resp.WriteMessage(enc(HELLO_ACK)), true)
    const initHash = init.GetHandshakeHash()
    const respHash = resp.GetHandshakeHash()
    for (const cs of [...init.Split(), ...resp.Split()]) cs.free()
    return { initHash, respHash }
  }

  it('derives a 32-byte channel-binding hash identical on both sides (256-bit, not BLAKE2b)', async () => {
    const lib = await loadNoiseLib()
    const { initHash, respHash } = runHandshakeHash(lib, 'BLAKE2s')
    expect(initHash).toHaveLength(32)
    expect(bytes(initHash)).toEqual(bytes(respHash))
  })

  it('the BLAKE2b suite yields a 64-byte hash — so the BLAKE2s name is not silently BLAKE2b', async () => {
    const lib = await loadNoiseLib()
    expect(runHandshakeHash(lib, 'BLAKE2b').initHash).toHaveLength(64)
  })

  // Published BLAKE2s known-answer (RFC 7693 Appendix B) reproduced by the runtime's reference
  // BLAKE2s. This pins the reference bytes #30 uses for its cross-implementation match and
  // confirms a genuine BLAKE2s (not BLAKE2b) primitive is available. It does NOT by itself
  // pin noise-c's internal hash — that is the elimination argument above + #30's Go interop.
  it('reproduces the published RFC 7693 BLAKE2s known-answer from the vendored fixture', () => {
    const fixture = JSON.parse(
      readFileSync(fileURLToPath(new URL('./noiseSpike.vectors.json', import.meta.url)), 'utf8')
    ) as { hash: string; cases: Array<{ input_utf8: string; digest_hex: string }> }
    expect(fixture.hash).toBe('BLAKE2s-256')
    expect(fixture.cases.length).toBeGreaterThan(0)
    for (const c of fixture.cases) {
      expect(createHash('blake2s256').update(c.input_utf8, 'utf8').digest('hex')).toBe(c.digest_hex)
    }
  })
})

describe('mode 2 — JS<->JS IK round-trip with early-data + post-handshake AEAD', () => {
  async function pair(): Promise<{
    initiator: NoiseInitiator
    responder: NoiseResponder
    init: ReturnType<typeof collector<NoiseInitiatorEvent>>
    resp: ReturnType<typeof collector<NoiseResponderEvent>>
    hello: Uint8Array
    helloAck: Uint8Array
  }> {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const hello = enc(HELLO)
    const helloAck = enc(HELLO_ACK)
    const init = collector<NoiseInitiatorEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    const initiator = await createNoiseInitiator({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello,
      sendFrame: (f) => responder.onFrame(f),
      onEvent: init.onEvent
    })
    responder = await createNoiseResponder({
      staticPrivateKey: respPriv,
      prologue: new Uint8Array(0),
      helloAck,
      sendFrame: (f) => initiator.onFrame(f),
      onEvent: resp.onEvent
    })
    handles.push(initiator, responder)
    return { initiator, responder, init, resp, hello, helloAck }
  }

  it('carries the device token inside message 1 — responder recovers hello byte-for-byte', async () => {
    const { initiator, resp, hello } = await pair()
    initiator.start()
    const complete = resp.events.find((e) => e.type === 'handshake-complete')
    expect(complete).toBeDefined()
    expect(bytes((complete as { hello: Uint8Array }).hello)).toEqual(bytes(hello))
  })

  it('recovers hello_ack from message 2 on the initiator side byte-for-byte', async () => {
    const { initiator, init, helloAck } = await pair()
    initiator.start()
    const complete = init.events.find((e) => e.type === 'handshake-complete')
    expect(complete).toBeDefined()
    expect(bytes((complete as { helloAck: Uint8Array }).helloAck)).toEqual(bytes(helloAck))
  })

  it('exchanges one AEAD-sealed message each way after the handshake', async () => {
    const { initiator, responder, init, resp } = await pair()
    initiator.start()

    const appOut = new TextEncoder().encode('hello from the desktop initiator')
    initiator.sendMessage(appOut)
    const gotByResp = resp.events.find((e) => e.type === 'message')
    expect(gotByResp).toBeDefined()
    expect(bytes((gotByResp as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(appOut))

    const replyOut = new TextEncoder().encode('reply from the responder')
    responder.sendMessage(replyOut)
    const gotByInit = init.events.find((e) => e.type === 'message')
    expect(gotByInit).toBeDefined()
    expect(bytes((gotByInit as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(replyOut))
  })
})

describe('harness contract, lifecycle, and error classification', () => {
  async function loneInitiator(sendFrame: (f: Uint8Array) => void): Promise<{
    initiator: NoiseInitiator
    init: ReturnType<typeof collector<NoiseInitiatorEvent>>
  }> {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseInitiatorEvent>()
    const initiator = await createNoiseInitiator({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame,
      onEvent: init.onEvent
    })
    handles.push(initiator)
    return { initiator, init }
  }

  it('the factory sends nothing; start() writes message 1 exactly once', async () => {
    const sent: Uint8Array[] = []
    const { initiator } = await loneInitiator((f) => sent.push(f))
    expect(sent).toHaveLength(0) // factory constructed + Initialized, but did not dial
    initiator.start()
    expect(sent).toHaveLength(1) // message 1, carrying the hello early-data
    expect(sent[0].length).toBeGreaterThan(0)
  })

  it('classifies a malformed handshake reply as handshake-read-failed with no completion', async () => {
    const { initiator, init } = await loneInitiator(() => {})
    initiator.start()
    // A wrong-suite / tampered / malformed message 2: garbage that fails MAC verification.
    initiator.onFrame(new Uint8Array(64).fill(0x5a))
    expect(initErrors(init.events)).toContain('handshake-read-failed')
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(false)
  })

  it('classifies a tampered post-handshake frame as transport-decrypt-failed', async () => {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseInitiatorEvent>()
    let responder: NoiseResponder
    const initiator = await createNoiseInitiator({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame: (f) => responder.onFrame(f),
      onEvent: init.onEvent
    })
    responder = await createNoiseResponder({
      staticPrivateKey: respPriv,
      prologue: new Uint8Array(0),
      helloAck: enc(HELLO_ACK),
      sendFrame: (f) => initiator.onFrame(f),
      onEvent: () => {}
    })
    handles.push(initiator, responder)
    initiator.start()
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(true)
    // Feed a garbage transport frame straight to the initiator.
    initiator.onFrame(new Uint8Array(48).fill(0x17))
    expect(initErrors(init.events)).toContain('transport-decrypt-failed')
  })

  it('classifies a frame arriving before start() as unexpected-frame', async () => {
    const { initiator, init } = await loneInitiator(() => {})
    initiator.onFrame(new Uint8Array(32).fill(0x01))
    expect(initErrors(init.events)).toContain('unexpected-frame')
  })

  it('close() is idempotent and leaves start()/onFrame/sendMessage inert (no throw, no events)', async () => {
    const { initiator, init } = await loneInitiator(() => {})
    initiator.start()
    const countAfterStart = init.events.length
    initiator.close()
    initiator.close() // idempotent
    // After close every entry point is inert: no call into freed wasm, no new events, no throw.
    expect(() => initiator.onFrame(new Uint8Array(48).fill(0x9))).not.toThrow()
    expect(() => initiator.sendMessage(new Uint8Array([1, 2, 3]))).not.toThrow()
    expect(() => initiator.start()).not.toThrow()
    expect(init.events.length).toBe(countAfterStart)
  })
})

describe('security — log-free by construction', () => {
  it('emits no console output while driving a full handshake and transport exchange', async () => {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      let responder: NoiseResponder
      const initiator = await createNoiseInitiator({
        staticPrivateKey: initPriv,
        remoteStaticPublicKey: respPub,
        prologue: new Uint8Array(0),
        hello: enc(HELLO),
        sendFrame: (f) => responder.onFrame(f),
        onEvent: () => {}
      })
      responder = await createNoiseResponder({
        staticPrivateKey: respPriv,
        prologue: new Uint8Array(0),
        helloAck: enc(HELLO_ACK),
        sendFrame: (f) => initiator.onFrame(f),
        onEvent: () => {}
      })
      handles.push(initiator, responder)
      initiator.start()
      initiator.sendMessage(new TextEncoder().encode('probe'))
      responder.sendMessage(new TextEncoder().encode('probe-reply'))
      // Also exercise the error path — it must classify without logging bytes.
      initiator.onFrame(new Uint8Array(48).fill(0x33))
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
