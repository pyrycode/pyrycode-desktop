import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { NOISE_PROTOCOL } from '../../shared/wire/types'
import type { HelloClientPayload, HelloAckPayload } from '../../shared/wire/types'
import { loadNoiseLib } from './noiseLib'
import {
  createNoiseSession,
  MAX_BUFFERED_SENDS,
  type NoiseSession,
  type NoiseSessionEvent
} from './noiseSession'
import type { DiagnosticEvent, DiagnosticLog } from '../diagnosticLog'

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
  // #111: act as the daemon initiating a rekey — AEAD-seal `rekeyRequestBytes` under the CURRENT
  // keys, send it, and enter the awaiting-rekey-init substate to answer the client's fresh msg1.
  initiateRekey(rekeyRequestBytes: Uint8Array): void
  close(): void
}

async function createNoiseResponder(config: {
  staticPrivateKey: Uint8Array
  prologue: Uint8Array
  helloAck: Uint8Array
  // #532: the double TAGS each outbound frame with its InnerFrameV2 `type`, exactly as the real
  // daemon and fakeDaemon do — the two handshake replies are `noise_resp`, every transport frame
  // (including the `rekey_request` control envelope) is `noise_msg`. The tag follows the FRAME,
  // never the state. Widening the callback forces no call-site edit: a one-parameter
  // `sendFrame: (f) => …` lambda stays assignable, so every pre-#532 fixture is untouched and keeps
  // feeding the session unlabelled frames.
  sendFrame: (frame: Uint8Array, type: string) => void
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
  let state: 'awaiting-init' | 'transport' | 'awaiting-rekey-init' | 'closed' = 'awaiting-init'

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
      if (state === 'awaiting-rekey-init') {
        // The client's fresh rekey msg1: run a fresh IK handshake as RESPONDER reusing the same
        // static, derive a new cipher pair, and atomically swap our own ciphers (install the new
        // pair, then free the old) — mirrors the daemon's awaitingRekeyInit substate.
        try {
          const fresh = lib.HandshakeState(NOISE_PROTOCOL, lib.constants.NOISE_ROLE_RESPONDER)
          fresh.Initialize(config.prologue.length > 0 ? config.prologue : null, config.staticPrivateKey, null, null)
          fresh.ReadMessage(frame, true) // discard the fresh early-data (empty on a rekey)
          const reply = fresh.WriteMessage(EMPTY_AD) // empty reply — no hello_ack on a rekey
          const pair = fresh.Split()
          const prevSend = send
          const prevRecv = recv
          send = pair[0]
          recv = pair[1]
          for (const obj of [prevSend, prevRecv]) {
            try {
              obj?.free()
            } catch {
              /* idempotent teardown */
            }
          }
          state = 'transport'
          config.sendFrame(reply, 'noise_resp') // a handshake reply — the rekey msg2
        } catch {
          // Surface a responder-side error; leave the existing (old-key) ciphers live and usable.
          config.onEvent({ type: 'error', reason: 'handshake-read-failed' })
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
        config.sendFrame(reply, 'noise_resp') // a handshake reply — the initial IK msg2
      } catch {
        hs = null
        state = 'closed'
        config.onEvent({ type: 'error', reason: 'handshake-read-failed' })
      }
    },
    sendMessage(plaintext) {
      // #532: `awaiting-rekey-init` serves too. This double swaps its ciphers ONLY inside the
      // awaiting-rekey-init handler above, so `send` here is still the live OLD cipher — the seal is
      // mechanically available, and serving it matches the real daemon, which keeps fanning out
      // transport frames under the OLD CipherStates for the whole awaiting-reply window (pyrycode
      // #450). That frame is exactly what the client's rekey window has to decrypt.
      if ((state !== 'transport' && state !== 'awaiting-rekey-init') || !send) return
      config.sendFrame(send.EncryptWithAd(EMPTY_AD, plaintext), 'noise_msg')
    },
    initiateRekey(rekeyRequestBytes) {
      if (state !== 'transport' || !send) return
      // Set state BEFORE sendFrame so the synchronous re-entrant fresh msg1 finds awaiting-rekey-init
      // (mirrors the session's set-state-before-send ordering). Seal under the CURRENT (old) key.
      const sealed = send.EncryptWithAd(EMPTY_AD, rekeyRequestBytes)
      state = 'awaiting-rekey-init'
      config.sendFrame(sealed, 'noise_msg') // a transport frame despite driving the rekey
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

describe('rekey re-handshake + atomic cipher swap (#111)', () => {
  // The extended responder (initiateRekey + awaiting-rekey-init) closes the JS<->JS rekey round-trip
  // synchronously, exactly as the mode-2 initial handshake does. Assertions read the initiator's
  // NoiseSessionEvent collector — the session boundary the ticket unit-tests against.
  async function pair(): Promise<{
    initiator: NoiseSession
    responder: NoiseResponder
    init: ReturnType<typeof collector<NoiseSessionEvent>>
    resp: ReturnType<typeof collector<NoiseResponderEvent>>
    /** Stop delivering the client's outbound frames to the responder — they queue instead. Arming
     *  this before initiateRekey() withholds the client's fresh rekey msg1, so the responder never
     *  swaps and both peers sit in the rekey window holding the OLD ciphers live (#532). */
    holdInitiatorFrames(): void
    /** Resume delivery and drain everything queued, in order — the withheld msg1 reaches the
     *  responder, which swaps and answers with the genuine `noise_resp` reply. */
    releaseInitiatorFrames(): void
  }> {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    // The withhold-and-release gate (#532), modelled on dropInitiatorFrames below but CAPTURING
    // rather than dropping — the held frames are replayed, not lost. No timer: release is an
    // explicit test call, so the ordering the rekey window depends on is exact.
    let holdingInitiator = false
    const heldInitiator: Uint8Array[] = []
    const initiator = await createNoiseSession({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame: (f) => {
        if (holdingInitiator) {
          heldInitiator.push(f)
          return
        }
        responder.onFrame(f)
      },
      onEvent: init.onEvent
    })
    responder = await createNoiseResponder({
      staticPrivateKey: respPriv,
      prologue: new Uint8Array(0),
      helloAck: enc(HELLO_ACK),
      // #532: thread the responder's own tag through to the session, exactly as the production
      // driver now forwards the decoded InnerFrameV2 `type` (noiseRelayDriver.onMessage).
      sendFrame: (f, t) => initiator.onFrame(f, t),
      onEvent: resp.onEvent
    })
    handles.push(initiator, responder)
    return {
      initiator,
      responder,
      init,
      resp,
      holdInitiatorFrames: () => {
        holdingInitiator = true
      },
      releaseInitiatorFrames: () => {
        holdingInitiator = false
        for (const f of heldInitiator.splice(0)) responder.onFrame(f)
      }
    }
  }

  const plaintexts = (events: NoiseSessionEvent[]): Uint8Array[] =>
    events
      .filter((e) => e.type === 'message')
      .map((e) => (e as { plaintext: Uint8Array }).plaintext)

  const respErrors = (events: NoiseResponderEvent[]): string[] =>
    events.filter((e) => e.type === 'error').map((e) => (e as { reason: string }).reason)

  // The mirror of `plaintexts` on the RESPONDER's collector — what actually reached the daemon side,
  // which is the only honest oracle for an outbound-direction ticket (#533).
  const respPlaintexts = (events: NoiseResponderEvent[]): Uint8Array[] =>
    events.filter((e) => e.type === 'message').map((e) => (e as { plaintext: Uint8Array }).plaintext)

  // The daemon's control envelope, exactly its wire shape (protocol-mobile.md § Re-key).
  const rekeyRequest = (): Uint8Array =>
    enc({ id: 42, type: 'rekey_request', ts: '2026-07-07T12:00:00Z', payload: { reason: 'scheduled' } })

  it('completes the re-handshake + swap and resumes encrypt/decrypt under the new keys (AC1/AC2/AC3)', async () => {
    const { initiator, responder, init, resp } = await pair()
    initiator.start()
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(true)

    // The daemon seals a rekey_request under the old keys and acts as the fresh-handshake responder;
    // the whole rekey completes inside this synchronous cascade.
    responder.initiateRekey(rekeyRequest())

    // Exactly one trigger surfaced; the swap itself emits no event (no rekey_ack) and no error.
    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)
    expect(initErrors(init.events)).toHaveLength(0)

    // Round-trip under the NEW keys, both directions.
    const app = new TextEncoder().encode('under the new keys, resp -> init')
    responder.sendMessage(app)
    const gotByInit = plaintexts(init.events)
    expect(gotByInit).toHaveLength(1)
    expect(bytes(gotByInit[0])).toEqual(bytes(app))

    const app2 = new TextEncoder().encode('under the new keys, init -> resp')
    initiator.sendMessage(app2)
    const gotByResp = resp.events.find((e) => e.type === 'message')
    expect(gotByResp).toBeDefined()
    expect(bytes((gotByResp as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(app2))
  })

  it('a frame sealed under the old keys no longer opens after the swap (AC3)', async () => {
    // Direction note: to prove the recv cipher was REPLACED (not merely a replay-of-a-consumed
    // frame), the held-back frame must be a still-unconsumed valid-K0 frame. A responder->initiator
    // frame cannot be held back for this: the AEAD stream is nonce-lockstep, so holding one back
    // desyncs the responder's send nonce from the initiator's recv nonce and the later rekey_request
    // (same direction) would fail to open — the rekey could never trigger. The initiator->responder
    // direction has no such conflict (the trigger travels responder->initiator), so we hold back an
    // initiator-sealed K0 frame and feed it to the RESPONDER after the swap. This proves the old
    // init-send / resp-recv key pair is dead post-swap; scenario 1 already proves the initiator's
    // recv cipher is the new key (a K1 responder frame decodes on the initiator).
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    const captured: Uint8Array[] = []
    let capturing = false
    const initiator = await createNoiseSession({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      // Capture-not-deliver one K0-sealed INITIATOR frame; otherwise deliver to the responder.
      sendFrame: (f) => {
        if (capturing) {
          captured.push(f)
          return
        }
        responder.onFrame(f)
      },
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
    initiator.start()

    // Seal one initiator frame under the OLD keys and hold it back (never delivered → the
    // responder's recv nonce stays put, so this frame WOULD still open under K0).
    capturing = true
    initiator.sendMessage(new TextEncoder().encode('sealed under K0, delivered later'))
    capturing = false
    expect(captured).toHaveLength(1)

    // Rekey K0 -> K1 (delivery restored; the rekey travels responder->initiator, unaffected by the
    // held-back init->resp frame, and the fresh msg1/reply are handshake frames, not transport).
    responder.initiateRekey(rekeyRequest())
    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)
    expect(initErrors(init.events)).toHaveLength(0)

    // The held-back K0 frame must NOT open under the swapped-in K1 recv cipher.
    responder.onFrame(captured[0])
    expect(respErrors(resp.events)).toContain('transport-decrypt-failed')
    expect(resp.events.filter((e) => e.type === 'message')).toHaveLength(0) // never surfaced
  })

  it('a failed fresh handshake leaves the session usable on the old keys (AC4)', async () => {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    let dropInitiatorFrames = false
    const initiator = await createNoiseSession({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame: (f) => {
        if (dropInitiatorFrames) return // swallow the fresh rekey msg1 — the responder never rekeys
        responder.onFrame(f)
      },
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
    initiator.start()
    expect(init.events.filter((e) => e.type === 'handshake-complete')).toHaveLength(1)

    // Drop the initiator's outbound frames so the fresh msg1 is lost; the responder stays on K0.
    dropInitiatorFrames = true
    // Plain seal (NOT initiateRekey): just a rekey_request under K0. The session recognizes it,
    // emits rekey-requested, sends the (dropped) msg1, and parks in awaiting-rekey-reply.
    responder.sendMessage(rekeyRequest())
    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)

    // A garbage rekey reply fails the fresh handshake read.
    initiator.onFrame(new Uint8Array(64).fill(0x5a))
    expect(initErrors(init.events).filter((r) => r === 'handshake-read-failed')).toHaveLength(1)
    // The rekey never completes a handshake — only the initial handshake-complete stands.
    expect(init.events.filter((e) => e.type === 'handshake-complete')).toHaveLength(1)

    // Proof the session stayed on K0 (both ciphers unchanged, never half-swapped, not closed): a
    // following K0-sealed responder message still opens. (responder->initiator uses the responder's
    // sendFrame = initiator.onFrame, unaffected by dropInitiatorFrames.)
    const app = new TextEncoder().encode('still alive on the old keys')
    responder.sendMessage(app)
    const got = plaintexts(init.events)
    expect(got).toHaveLength(1)
    expect(bytes(got[0])).toEqual(bytes(app))
  })

  // --- #532: routing inbound frames in the rekey window by inner frame type ---------------------
  // The daemon does not stop the world for a rekey: any app frame it fanned out after emitting
  // `rekey_request` but before processing the client's `noise_init` is TCP-ordered AHEAD of the
  // reply and lands while the client is parked in `awaiting-rekey-reply` (pyrycode #450). Two frame
  // kinds are legitimately in flight at once and only the inner-frame label separates them, so in
  // this ONE state the session consults it. The interleaved frame must be sealed DURING the window —
  // the responder->initiator AEAD stream is nonce-lockstep, so it cannot be sealed early and held
  // back (see the note at the capture-and-replay test above).

  it('serves an interleaved app frame in the rekey window, then still completes the swap (AC1/AC2/AC3)', async () => {
    const { initiator, responder, init, resp, holdInitiatorFrames, releaseInitiatorFrames } =
      await pair()
    initiator.start()
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(true)

    // Open the window: withhold the client's fresh rekey msg1 so the responder never reaches its
    // swap. Both peers now hold the OLD ciphers live, exactly as the real pair does mid-rekey.
    holdInitiatorFrames()
    responder.initiateRekey(rekeyRequest())
    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)

    // AC1: an ordinary app frame sealed under the pre-rekey send cipher, carrying the daemon's
    // transport tag, decrypts under the still-live old receive cipher and reaches the SAME consumer
    // it would have reached outside the window.
    const interleaved = new TextEncoder().encode('fanned out before the rekey msg1 landed')
    responder.sendMessage(interleaved)
    const inWindow = plaintexts(init.events)
    expect(inWindow).toHaveLength(1)
    expect(bytes(inWindow[0])).toEqual(bytes(interleaved))
    // AC3: no handshake-read-failed — and no error of ANY reason.
    expect(initErrors(init.events)).toHaveLength(0)

    // AC2: the daemon's actual reply, released now, still drives the cipher swap…
    releaseInitiatorFrames()
    expect(initErrors(init.events)).toHaveLength(0)

    // …and traffic in BOTH directions afterwards succeeds under the new ciphers.
    const k1In = new TextEncoder().encode('under the new keys, resp -> init')
    responder.sendMessage(k1In)
    const afterSwap = plaintexts(init.events)
    expect(afterSwap).toHaveLength(2)
    expect(bytes(afterSwap[1])).toEqual(bytes(k1In))

    const k1Out = new TextEncoder().encode('under the new keys, init -> resp')
    initiator.sendMessage(k1Out)
    const gotByResp = resp.events.find((e) => e.type === 'message')
    expect(gotByResp).toBeDefined()
    expect(bytes((gotByResp as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(k1Out))

    expect(initErrors(init.events)).toHaveLength(0)
    expect(respErrors(resp.events)).toHaveLength(0)
    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)
  })

  it('rejects an undecryptable non-reply frame in the window without consuming the reply slot (AC5)', async () => {
    const { initiator, responder, init, holdInitiatorFrames, releaseInitiatorFrames } = await pair()
    initiator.start()
    holdInitiatorFrames()
    responder.initiateRekey(rekeyRequest())

    // Garbage carrying the daemon's TRANSPORT tag: not the reply, and it opens under no cipher.
    initiator.onFrame(new Uint8Array(48).fill(0x33), 'noise_msg')
    // Non-terminal: the gentler transport-decrypt rejection, never handshake-read-failed.
    expect(initErrors(init.events)).toEqual(['transport-decrypt-failed'])

    // The one-shot handshake read was NOT burned — the genuine reply still completes the swap…
    releaseInitiatorFrames()
    expect(initErrors(init.events)).toEqual(['transport-decrypt-failed'])

    // …proven by a frame that only the NEW receive cipher can open.
    const k1 = new TextEncoder().encode('the rekey still completed')
    responder.sendMessage(k1)
    const got = plaintexts(init.events)
    expect(got).toHaveLength(1)
    expect(bytes(got[0])).toEqual(bytes(k1))
  })

  it('routes a noise_resp-tagged frame to the reply path — the label, not the bytes, decides (AC4)', async () => {
    const { initiator, responder, init, holdInitiatorFrames } = await pair()
    initiator.start()
    holdInitiatorFrames()
    responder.initiateRekey(rekeyRequest())

    // Byte-identical garbage to the AC5 scenario above, differing ONLY in its tag. As the daemon's
    // handshake reply it burns the one-shot handshake read and fails exactly as it did pre-#532.
    // This is the routing mutation control: under a negative-on-noise_msg rule, or a swapped
    // comparison, the two scenarios' reasons trade places and both die.
    initiator.onFrame(new Uint8Array(48).fill(0x33), 'noise_resp')
    expect(initErrors(init.events)).toEqual(['handshake-read-failed'])

    // Old ciphers intact and the session usable in `transport`, not closed: a following K0-sealed
    // responder frame still surfaces (the AC4 guarantee, unchanged from #111).
    const afterFail = new TextEncoder().encode('still alive on the old keys')
    responder.sendMessage(afterFail)
    const got = plaintexts(init.events)
    expect(got).toHaveLength(1)
    expect(bytes(got[0])).toEqual(bytes(afterFail))
  })

  // --- #533: buffering OUTBOUND sends across the rekey window ------------------------------------
  // The mirror direction of #532, and deliberately NOT the mirror fix. The client enters
  // `awaiting-rekey-reply` only AFTER handing its own noise_init to sendFrame, so every send issued
  // in the window is TCP-ordered BEHIND that frame; the daemon swaps BOTH ciphers the moment it
  // processes it. Sealing under the old send cipher would therefore fail the daemon's new recv and
  // take its tampered-frame branch (WS 4421 + session removal) — fatal, not lossy. So the session
  // holds the PLAINTEXT and re-seals under the new cipher after the swap. The same hold-and-release
  // gate #532 promoted into pair() parks both peers in the window, with no timers.

  it('flushes sends issued in the rekey window after the swap, in issue order (#533 AC1)', async () => {
    const { initiator, responder, init, resp, holdInitiatorFrames, releaseInitiatorFrames } =
      await pair()
    initiator.start()
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(true)

    holdInitiatorFrames()
    responder.initiateRekey(rekeyRequest())
    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)

    const inWindow = ['window send 1', 'window send 2', 'window send 3'].map((s) =>
      new TextEncoder().encode(s)
    )
    for (const p of inWindow) initiator.sendMessage(p)
    // Nothing escapes DURING the window — the daemon has not swapped yet, and an old-cipher frame
    // landing after its swap is the fatal 4421 case.
    expect(respPlaintexts(resp.events)).toHaveLength(0)

    // Release: the withheld msg1 reaches the responder, which swaps and answers with the genuine
    // noise_resp; the client's swap and the flush both land inside this one synchronous cascade.
    releaseInitiatorFrames()

    // Issued after the swap, so necessarily after onFrame returned — it must land LAST.
    const afterSwap = new TextEncoder().encode('issued after the swap')
    initiator.sendMessage(afterSwap)

    expect(respPlaintexts(resp.events).map(bytes)).toEqual([...inWindow, afterSwap].map(bytes))
    expect(initErrors(init.events)).toHaveLength(0)
    expect(respErrors(resp.events)).toHaveLength(0)
  })

  it('bounds the window buffer, surfaces the overflow, and drops the incoming send (#533 AC2)', async () => {
    const { initiator, responder, init, resp, holdInitiatorFrames, releaseInitiatorFrames } =
      await pair()
    initiator.start()
    holdInitiatorFrames()
    responder.initiateRekey(rekeyRequest())

    // Count driven off the exported const, never a hard-coded 8.
    const sends = Array.from({ length: MAX_BUFFERED_SENDS + 1 }, (_, i) =>
      new TextEncoder().encode(`window send ${i}`)
    )
    for (const p of sends) initiator.sendMessage(p)

    // Exactly one overflow error, and no other error of any reason.
    expect(initErrors(init.events)).toEqual(['rekey-send-buffer-full'])

    releaseInitiatorFrames()
    // The INCOMING send was dropped, not the oldest evicted: the first MAX_BUFFERED_SENDS arrive in
    // issue order and the overflowing one is absent.
    expect(respPlaintexts(resp.events).map(bytes)).toEqual(
      sends.slice(0, MAX_BUFFERED_SENDS).map(bytes)
    )
    expect(initErrors(init.events)).toEqual(['rekey-send-buffer-full'])
    expect(respErrors(resp.events)).toHaveLength(0)
  })

  it('discards buffered sends when the rekey fails, unsent, and stays usable on the old keys (#533 AC3)', async () => {
    // Clones the dropInitiatorFrames failure-path fixture above, but CAPTURES the swallowed frames
    // instead of discarding them: "the buffered plaintext was never sealed" is only observable as
    // "sendFrame was never called with it".
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const resp = collector<NoiseResponderEvent>()
    let responder: NoiseResponder
    let withholding = false
    const withheld: Uint8Array[] = []
    const initiator = await createNoiseSession({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame: (f) => {
        if (withholding) {
          withheld.push(f) // the fresh rekey msg1 never reaches the responder → it stays on K0
          return
        }
        responder.onFrame(f)
      },
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
    initiator.start()
    expect(init.events.filter((e) => e.type === 'handshake-complete')).toHaveLength(1)

    withholding = true
    // Plain seal (NOT initiateRekey): the session recognizes the trigger, emits the (withheld) msg1,
    // and parks in awaiting-rekey-reply while the responder stays in `transport` on K0.
    responder.sendMessage(rekeyRequest())
    expect(init.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)

    initiator.sendMessage(new TextEncoder().encode('issued into a rekey that never completes'))

    // A garbage rekey reply fails the fresh handshake read.
    initiator.onFrame(new Uint8Array(64).fill(0x5a))
    // Root cause first, then the loss — one emit per discard, never a count.
    expect(initErrors(init.events)).toEqual(['handshake-read-failed', 'rekey-send-abandoned'])
    // Never sealed under the SURVIVING old ciphers: only the rekey msg1 ever reached sendFrame.
    expect(withheld).toHaveLength(1)

    // AC3 tail — the session is usable, not closed: a K0-sealed responder frame still opens…
    const inbound = new TextEncoder().encode('still alive on the old keys')
    responder.sendMessage(inbound)
    const got = plaintexts(init.events)
    expect(got).toHaveLength(1)
    expect(bytes(got[0])).toEqual(bytes(inbound))

    // …and a following send goes out normally, in nonce lockstep — which is also the proof that no
    // discarded plaintext burned a send nonce on its way out.
    withholding = false
    const outbound = new TextEncoder().encode('sent after the failed rekey')
    initiator.sendMessage(outbound)
    expect(respPlaintexts(resp.events).map(bytes)).toEqual([bytes(outbound)])
    expect(respErrors(resp.events)).toHaveLength(0)
  })

  it('close() during the rekey window releases the buffer — no frame ever escapes (#533 AC4)', async () => {
    const { initiator, responder, init, resp, holdInitiatorFrames, releaseInitiatorFrames } =
      await pair()
    initiator.start()
    holdInitiatorFrames()
    responder.initiateRekey(rekeyRequest())
    initiator.sendMessage(new TextEncoder().encode('held when the window is torn down'))

    const eventsBeforeClose = init.events.length
    initiator.close()
    expect(init.events.length).toBe(eventsBeforeClose) // ordinary teardown emits nothing

    // The responder still swaps and answers, but the closed session ignores the reply, so there is
    // no flush. Buffer emptiness is not observable across the module boundary; "no frame ever
    // escapes after close" is the honest proxy, and it is the property that matters.
    releaseInitiatorFrames()
    expect(respPlaintexts(resp.events)).toHaveLength(0)
    expect(initErrors(init.events)).toHaveLength(0)

    expect(() => initiator.sendMessage(new Uint8Array([1, 2, 3]))).not.toThrow()
    expect(respPlaintexts(resp.events)).toHaveLength(0)
  })

  it('sendMessage stays inert AND buffers nothing outside the rekey window (#533 AC5)', async () => {
    const { initiator, init, resp, holdInitiatorFrames, releaseInitiatorFrames } = await pair()

    // idle — before start().
    initiator.sendMessage(new TextEncoder().encode('before start()'))

    // awaiting-handshake-reply — msg1 withheld, so the session parks there. Pre-handshake buffering
    // is deliberately NOT in scope: no session exists yet (sendCipher is null until Split), and the
    // composer gate is genuinely closed in that window.
    holdInitiatorFrames()
    initiator.start()
    initiator.sendMessage(new TextEncoder().encode('before the handshake reply'))

    releaseInitiatorFrames() // msg1 lands; the handshake completes
    expect(init.events.some((e) => e.type === 'handshake-complete')).toBe(true)
    // Assert the negative: driving the session to `transport` surfaces no deferred frame.
    expect(respPlaintexts(resp.events)).toHaveLength(0)
    expect(initErrors(init.events)).toHaveLength(0)

    // closed — and still nothing deferred.
    initiator.close()
    initiator.sendMessage(new TextEncoder().encode('after close'))
    expect(respPlaintexts(resp.events)).toHaveLength(0)
    expect(initErrors(init.events)).toHaveLength(0)
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

describe('pre-decryption safe-bytes diagnostics (#133)', () => {
  // A capture DiagnosticLog: records each content-free envelope so a test can assert the failing
  // frame bytes reached the diagnostic sink — and ONLY the sink, never onEvent (bytes must not
  // cross to the renderer path).
  function captureLog(): { captured: DiagnosticEvent[]; diagnosticLog: DiagnosticLog } {
    const captured: DiagnosticEvent[] = []
    return { captured, diagnosticLog: { event: (f) => void captured.push(f) } }
  }

  // The expected content-free encoding of a captured frame: lowercase hex of at most 64 raw bytes
  // (the session's MAX_SAFE_BYTES cap). The test frames are ≤ 64 bytes, so this is the whole frame.
  const toHex = (u: Uint8Array): string => Buffer.from(u.subarray(0, 64)).toString('hex')

  it('logs the ciphertext frame on transport-decrypt-failed, surfacing no bytes to onEvent (AC1/AC6)', async () => {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [respPriv, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const { captured, diagnosticLog } = captureLog()
    let responder: NoiseResponder
    const initiator = await createNoiseSession({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame: (f) => responder.onFrame(f),
      onEvent: init.onEvent,
      diagnosticLog
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

    // A garbage post-handshake transport frame fails AEAD open → transport-decrypt-failed.
    const garbage = new Uint8Array(48).fill(0x17)
    initiator.onFrame(garbage)

    // The diagnostic sink got the static code + the capped raw ciphertext bytes (safe: pre-decryption).
    expect(captured).toHaveLength(1)
    expect(captured[0].event).toBe('noise-frame-failed')
    expect(captured[0].code).toBe('transport-decrypt-failed')
    expect(captured[0].bytes).toBe(garbage.length)
    expect(captured[0].safeBytes).toBe(toHex(garbage))

    // onEvent still gets the static-reason error and nothing else — no bytes reach the renderer path.
    expect(init.events).toContainEqual({ type: 'error', reason: 'transport-decrypt-failed' })
    expect(JSON.stringify(init.events)).not.toContain(toHex(garbage))
  })

  it('logs the handshake message-2 frame on handshake-read-failed (AC1)', async () => {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const { captured, diagnosticLog } = captureLog()
    const initiator = await createNoiseSession({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame: () => {},
      onEvent: init.onEvent,
      diagnosticLog
    })
    handles.push(initiator)
    initiator.start()

    // A malformed message 2 fails the handshake read.
    const badMsg2 = new Uint8Array(64).fill(0x5a)
    initiator.onFrame(badMsg2)

    expect(captured).toHaveLength(1)
    expect(captured[0].event).toBe('noise-frame-failed')
    expect(captured[0].code).toBe('handshake-read-failed')
    expect(captured[0].bytes).toBe(badMsg2.length)
    expect(captured[0].safeBytes).toBe(toHex(badMsg2))
    expect(init.events).toContainEqual({ type: 'error', reason: 'handshake-read-failed' })
  })

  it('captures no bytes for the pre-start unexpected-frame path — only the three inbound-read sites (AC6)', async () => {
    const lib = await loadNoiseLib()
    const curve = lib.constants.NOISE_DH_CURVE25519
    const [initPriv] = lib.CreateKeyPair(curve)
    const [, respPub] = lib.CreateKeyPair(curve)
    const init = collector<NoiseSessionEvent>()
    const { captured, diagnosticLog } = captureLog()
    const initiator = await createNoiseSession({
      staticPrivateKey: initPriv,
      remoteStaticPublicKey: respPub,
      prologue: new Uint8Array(0),
      hello: enc(HELLO),
      sendFrame: () => {},
      onEvent: init.onEvent,
      diagnosticLog
    })
    handles.push(initiator)

    // A frame before start() is classified unexpected-frame. `frame` IS in scope at that catch, but
    // byte-capture is scoped to the three inbound-read failures only — nothing is logged here.
    initiator.onFrame(new Uint8Array(32).fill(0x01))

    expect(initErrors(init.events)).toContain('unexpected-frame')
    expect(captured).toHaveLength(0)
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
