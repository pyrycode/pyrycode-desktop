import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { NOISE_PROTOCOL } from '../../shared/wire/types'
import type { HelloClientPayload, HelloAckPayload } from '../../shared/wire/types'
import { loadNoiseLib } from './noiseLib'
import {
  createNoiseSession,
  type NoiseSession,
  type NoiseSessionEvent
} from './noiseSession'

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

const initErrors = (events: NoiseSessionEvent[]): string[] =>
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
    initiator: NoiseSession
    responder: NoiseResponder
    init: ReturnType<typeof collector<NoiseSessionEvent>>
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
    const init = collector<NoiseSessionEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    const initiator = await createNoiseSession({
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

describe('rekey_request recognition — daemon in-session rekey trigger (#108)', () => {
  // Mirrors the mode-2 pair() fixture (the file's per-block-owns-its-setup idiom): the production
  // session under test wired to the test-only responder, each with its own event collector. The
  // responder AEAD-seals a real frame via sendMessage; assertions read the initiator's
  // NoiseSessionEvent collector (AC5) — recognition is proven at the session's own onEvent.
  async function pair(): Promise<{
    initiator: NoiseSession
    responder: NoiseResponder
    init: ReturnType<typeof collector<NoiseSessionEvent>>
    resp: ReturnType<typeof collector<NoiseResponderEvent>>
  }> {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    const initiator = await createNoiseSession({
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
      onEvent: resp.onEvent
    })
    handles.push(initiator, responder)
    return { initiator, responder, init, resp }
  }

  const plaintexts = (events: NoiseSessionEvent[]): Uint8Array[] =>
    events
      .filter((e) => e.type === 'message')
      .map((e) => (e as { plaintext: Uint8Array }).plaintext)

  it('recognizes a sealed rekey_request control envelope as the trigger, not a message (AC1)', async () => {
    const { initiator, responder, init } = await pair()
    initiator.start()
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(true)

    // A full control Envelope, exactly the daemon's shape (protocol-mobile.md § Re-key).
    responder.sendMessage(
      enc({ id: 42, type: 'rekey_request', ts: '2026-07-07T12:00:00Z', payload: { reason: 'scheduled' } })
    )

    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)
    expect(init.events.some((e) => e.type === 'message')).toBe(false)
    expect(initErrors(init.events)).toHaveLength(0)
  })

  it('leaves an ordinary app-message frame surfacing as message with identical plaintext (AC2)', async () => {
    const { initiator, responder, init } = await pair()
    initiator.start()

    const sealed = enc({
      id: 7,
      type: 'message',
      ts: '2026-07-07T12:00:00Z',
      payload: { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi' }
    })
    responder.sendMessage(sealed)

    const got = plaintexts(init.events)
    expect(got).toHaveLength(1)
    expect(bytes(got[0])).toEqual(bytes(sealed)) // recognition never transforms/re-narrows the plaintext
    expect(init.events.some((e) => e.type === 'rekey-requested')).toBe(false)
  })

  it('falls through unmodeled-control + non-Envelope plaintext to message without corruption or crash (AC3)', async () => {
    const { initiator, responder, init } = await pair()
    initiator.start()

    // (a) a well-formed Envelope whose type is a control type this module does not model.
    const control = enc({ id: 1, type: 'some_unknown_control', ts: '2026-07-07T12:00:00Z', payload: {} })
    expect(() => responder.sendMessage(control)).not.toThrow()

    // (b) bytes that do not decode as an Envelope at all (malformed JSON) — the recognizer's own
    // decode failure must reproduce today's behavior, not a new rejection.
    const garbage = new TextEncoder().encode('not-json{{')
    expect(() => responder.sendMessage(garbage)).not.toThrow()

    const got = plaintexts(init.events)
    expect(got).toHaveLength(2)
    expect(bytes(got[0])).toEqual(bytes(control))
    expect(bytes(got[1])).toEqual(bytes(garbage))
    expect(init.events.some((e) => e.type === 'rekey-requested')).toBe(false)
    expect(initErrors(init.events)).toHaveLength(0)

    // Strengthening (no cipher corruption): after two fall-throughs the recv cipher advanced
    // correctly, so a following ordinary app message still surfaces intact.
    const after = enc({
      id: 2,
      type: 'message',
      ts: '2026-07-07T12:00:01Z',
      payload: { conversation_id: 'c1', message_id: 'm2', role: 'assistant', text: 'ok' }
    })
    responder.sendMessage(after)
    const all = plaintexts(init.events)
    expect(all).toHaveLength(3)
    expect(bytes(all[2])).toEqual(bytes(after))
  })
})

describe('harness contract, lifecycle, and error classification', () => {
  async function loneInitiator(sendFrame: (f: Uint8Array) => void): Promise<{
    initiator: NoiseSession
    init: ReturnType<typeof collector<NoiseSessionEvent>>
  }> {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const initiator = await createNoiseSession({
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
    const init = collector<NoiseSessionEvent>()
    let responder: NoiseResponder
    const initiator = await createNoiseSession({
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

describe('close-during-handshake safety invariant (mobile #497 parity)', () => {
  // Mobile #497 synchronized handshake-phase crypto against a socket close racing on ANOTHER
  // THREAD (Kotlin coroutines). Desktop's session is single-threaded with synchronous wasm crypto
  // and has NO `await` inside any entry point, so that interleaving is structurally impossible
  // here — porting mobile's mutex would defend a non-race (pipeline: Evidence-Based Fix Selection).
  //
  // COVERAGE BOUNDARY — read before trusting green. These tests use close-THEN-call ordering:
  // close() runs to completion, then a fresh entry point is invoked. They CANNOT reproduce a true
  // mid-flight interleaving (onFrame yields at an `await` → close() frees → onFrame resumes into
  // freed state), because the current synchronous code has no yield point to interleave at. What
  // they pin is the POST-CLOSE SHORT-CIRCUIT GUARDS in each entry point (`state === 'closed'` /
  // `hs === null` / `*Cipher === null`): the mechanism that keeps a future async refactor from
  // re-entering freed noise-c.wasm state. Green here is NOT a proof that a hypothetical async entry
  // point is race-free; it is a tripwire — drop or weaken a guard and a post-close
  // onFrame/sendMessage would reach null.ReadMessage / null.DecryptWithAd / null.Encrypt and throw,
  // failing the not.toThrow assertions below.

  // Local fixtures mirror loneInitiator/pair above. Each describe block owns its setup — the file's
  // idiom (the transport-decrypt test likewise inlines the pair wiring); this keeps the block a
  // purely additive regression fixture, leaving the existing helpers untouched (don't-touch-adjacent).
  async function loneInitiator(sendFrame: (f: Uint8Array) => void): Promise<{
    initiator: NoiseSession
    init: ReturnType<typeof collector<NoiseSessionEvent>>
  }> {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const initiator = await createNoiseSession({
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

  async function pair(): Promise<{
    initiator: NoiseSession
    init: ReturnType<typeof collector<NoiseSessionEvent>>
    resp: ReturnType<typeof collector<NoiseResponderEvent>>
  }> {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    const initiator = await createNoiseSession({
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
      onEvent: resp.onEvent
    })
    handles.push(initiator, responder)
    return { initiator, init, resp }
  }

  it('close() before start() (idle → closed) leaves the session inert — no frame, no event', async () => {
    const sent: Uint8Array[] = []
    const { initiator, init } = await loneInitiator((f) => sent.push(f))
    initiator.close()
    // Absent the close, start() would WriteMessage msg 1 and push exactly one frame. Post-close it
    // returns at the `state !== 'idle' || hs === null` guard (state is 'closed', hs is null).
    expect(() => initiator.start()).not.toThrow()
    expect(sent).toHaveLength(0)
    expect(init.events).toHaveLength(0)
  })

  it('close() while awaiting the handshake reply leaves onFrame inert — no read, no throw, no event', async () => {
    const sent: Uint8Array[] = []
    const { initiator, init } = await loneInitiator((f) => sent.push(f))
    initiator.start()
    expect(sent).toHaveLength(1) // msg 1 sent; session is now awaiting-handshake-reply
    const eventsAfterStart = init.events.length
    initiator.close()
    // A garbage message 2 after teardown. Absent the close, hs.ReadMessage would fail MAC and emit
    // `handshake-read-failed`; post-close it must hit the `state === 'closed'` guard and drop it.
    expect(() => initiator.onFrame(new Uint8Array(64).fill(0x5a))).not.toThrow()
    expect(sent).toHaveLength(1) // no new frame
    expect(init.events.length).toBe(eventsAfterStart)
    expect(initErrors(init.events)).not.toContain('handshake-read-failed')
  })

  it('close() after handshake-complete (transport → closed) leaves sendMessage and onFrame inert', async () => {
    const { initiator, init, resp } = await pair()
    initiator.start() // drives the full IK handshake to completion synchronously
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(true)
    const initCount = init.events.length
    const respMessages = (): number => resp.events.filter((e) => e.type === 'message').length
    const respMessagesBefore = respMessages()
    initiator.close()

    // onFrame in transport would DecryptWithAd garbage → transport-decrypt-failed; post-close it
    // returns at the `state === 'closed'` guard without touching the freed recvCipher.
    expect(() => initiator.onFrame(new Uint8Array(48).fill(0x17))).not.toThrow()
    expect(init.events.length).toBe(initCount)
    expect(initErrors(init.events)).not.toContain('transport-decrypt-failed')

    // sendMessage would seal a frame the responder decrypts into a `message`; post-close it emits
    // nothing (returns at the `state !== 'transport' || sendCipher === null` guard).
    expect(() => initiator.sendMessage(new Uint8Array([1, 2, 3]))).not.toThrow()
    expect(respMessages()).toBe(respMessagesBefore)
  })

  it('close() is idempotent — a double-close neither throws nor double-frees', async () => {
    const { initiator } = await loneInitiator(() => {})
    initiator.start()
    // The second close returns at the `state === 'closed'` guard before reaching freeAll(); freeAll
    // itself guards each obj?.free() in try/catch, so a double-free is structurally impossible.
    expect(() => {
      initiator.close()
      initiator.close()
    }).not.toThrow()
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
      const initiator = await createNoiseSession({
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
