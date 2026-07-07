// An in-process Noise_IK **responder** "fake daemon" — TEST-ONLY infrastructure (#91). It speaks
// the responder side of the wire protocol so automated tests can drive the REAL client initiator
// through a genuine `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake and one sealed transport
// round-trip in CI, with no Go toolchain and no network. It is the content-aware peer the
// content-blind #90 forwarder splices frames to: the daemon dials the forwarder's `/v1/server`
// leg, the client under test dials `/v1/client`.
//
// It MIRRORS noiseSession.ts as a responder: HandshakeState(NOISE_ROLE_RESPONDER), ReadMessage on
// IK message 1 (recovering the client static and the `hello` early-data), WriteMessage(hello_ack)
// on message 2, then Split into transport ciphers. It uses the exact NOISE_PROTOCOL constant and
// the production `codec` framing (encodeEnvelope / encodeInnerFrame / base64Std*) — NOT a
// hand-rolled shortcut — so a lax fake can't pass while diverging from the real daemon (AC3).
//
// Split() send/recv role-mapping (AC4, load-bearing): `noise-c.wasm` returns the two transport
// ciphers already role-adjusted as `[send, recv]` for BOTH roles (noise-c.wasm.d.ts:47-51,
// confirmed against the 0.4.0 wrapper's `[send, receive]` doc + the noise-c C API), so the
// responder uses the SAME mapping as the initiator — sendCipher = split[0], recvCipher = split[1],
// no swap. The flynn/noise responder swaps because flynn returns the raw pair; noise-c does not.
// Crossing the mapping still completes the handshake but MAC-fails the first transport frame — so
// the round-trip self-test (fakeDaemon.test.ts) is the deterministic oracle that pins this.
//
// TEST-ONLY — it holds a Noise static key and a permissive `ws://` dialer, so it MUST NEVER be
// imported into the production graph (src/main/index.ts, src/preload, src/renderer). Its only
// importers are *.test.ts and (later) the #89 round-trip consumer, exactly like fakeRelayForwarder.
//
// LOG-FREE by construction (mirrors noiseSession.ts / codec.ts): no console.*, and NO key, token,
// or frame/plaintext bytes in any diagnostic. Every caught wasm/codec error is CLASSIFIED into a
// static FakeDaemonErrorReason and the caught object dropped — a library error string can echo
// transcript bytes. All observable behaviour is via the handle and the spliced frames.
import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import { type NoiseCipherState } from 'noise-c.wasm'
import { NOISE_PROTOCOL, MAX_FRAME_BYTES, type HelloAckPayload } from '../../shared/wire/types'
import { loadNoiseLib } from './noiseLib'
import {
  encodeEnvelope,
  decodeEnvelope,
  encodeInnerFrame,
  decodeInnerFrame,
  base64StdEncode,
  base64StdDecode
} from './codec'

// Empty associated-data for every transport frame — the v2 suite's mandate, matching noiseSession
// and the daemon (its CipherState has no AD parameter). Shared, never mutated.
const EMPTY_AD = new Uint8Array(0)

// Fixed, deterministic hello_ack envelope framing. The client's parseHelloAck reads only the four
// payload fields; `id`/`ts` are required to be a number/string but their values are not inspected,
// so a fixed pair keeps the fake deterministic and wall-clock-free.
const HELLO_ACK_ID = 1
const HELLO_ACK_TS = '2026-01-01T00:00:00Z'

/** Config for one fake daemon. Test-only; nothing is persisted, no real credential is read. */
export interface FakeDaemonOptions {
  /** Base forwarder URL, no trailing path (from startFakeRelayForwarder().url). The daemon dials
   *  `${url}/v1/server`. */
  url: string
  /** Reply builder: given the decrypted inbound plaintext, return the reply plaintext to seal and
   *  stream back. Default: echo the inbound plaintext verbatim. */
  buildReply?: (inboundPlaintext: Uint8Array) => Uint8Array
  /** hello_ack payload overrides. Defaults: protocol_version 'v2', server_id 'fake-daemon',
   *  conn_id 'conn-1', capabilities []. */
  helloAck?: Partial<HelloAckPayload>
  /** Forwarded to loadNoiseLib as its load deadline; omit for the loader default. */
  loadTimeoutMs?: number
}

/** Closed set of static reasons — NEVER carries key/token/frame/plaintext bytes. */
export type FakeDaemonErrorReason =
  | 'frame-decode-failed' // decodeInnerFrame/base64StdDecode threw at the leg boundary
  | 'handshake-read-failed' // msg1 ReadMessage MAC-failed / malformed / wrong-suite peer
  | 'transport-decrypt-failed' // an inbound transport frame failed to open
  | 'closed' // close() ran before the round-trip completed

/** The outcome of one fake-daemon run. `whenSettled()` resolves this once and caches it. */
export type FakeDaemonOutcome = { ok: true } | { ok: false; reason: FakeDaemonErrorReason }

/** Handle for one fake daemon. */
export interface FakeDaemon {
  /** Responder static X25519 public key (32B). The client uses this as its remoteStaticPublicKey —
   *  the QR-known server static the real client pins. */
  staticPublicKey: Uint8Array
  /** Resolves once the responder has completed the handshake and streamed one reply (ok:true), or
   *  hit a daemon-side failure (ok:false + static reason). Never rejects. close() before completion
   *  resolves it { ok:false, reason:'closed' }. Cached: repeated calls share one promise. */
  whenSettled(): Promise<FakeDaemonOutcome>
  /** Tear down the WS leg + free the wasm handshake/cipher state. Idempotent. */
  close(): Promise<void>
}

type DaemonState = 'awaiting-msg1' | 'transport' | 'closed'

/**
 * Stand up the fake daemon: load the shared wasm, generate a responder static keypair, dial the
 * `/v1/server` leg, and arm the responder. Resolves once the leg is OPEN with handlers armed — so
 * the client's msg1 (sent only after forwarder.whenReady()) is never dropped. Rejects with
 * NoiseLoadError only if the shared wasm load fails/times out (no handle exists yet, so a rejection
 * is the correct async shape — mirrors createNoiseSession).
 */
export async function startFakeDaemon(options: FakeDaemonOptions): Promise<FakeDaemon> {
  const lib = await loadNoiseLib({ timeoutMs: options.loadTimeoutMs })

  // A fresh, synthetic, in-process responder static (noise-c CSPRNG, never Math.random). `staticPub`
  // is the "QR-known server static" the client pins as remoteStaticPublicKey.
  const [staticPriv, staticPub] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)

  // `hs` is nulled the moment it is consumed (Split) or auto-freed by the library on a thrown
  // error, so no entry point ever calls into a freed wasm handshake object.
  let hs: ReturnType<typeof lib.HandshakeState> | null = lib.HandshakeState(
    NOISE_PROTOCOL,
    lib.constants.NOISE_ROLE_RESPONDER
  )
  // Responder in IK: pass the local static private; rs is null (the initiator static is recovered
  // from msg1). Empty prologue → null, matching the client's empty-prologue handshake.
  hs.Initialize(null, staticPriv, null, null)

  let sendCipher: NoiseCipherState | null = null
  let recvCipher: NoiseCipherState | null = null
  let state: DaemonState = 'awaiting-msg1'
  let leg: WebSocket | null = null
  let closePromise: Promise<void> | null = null

  const buildReply = options.buildReply ?? ((plaintext: Uint8Array) => plaintext)
  const helloAck: HelloAckPayload = {
    protocol_version: 'v2',
    server_id: 'fake-daemon',
    conn_id: 'conn-1',
    capabilities: [],
    ...options.helloAck
  }

  // Settle-once deferred. No-op initialiser keeps the synchronous executor from needing a
  // definite-assignment `!`. It never rejects — a daemon-side failure is a resolved { ok:false }.
  let settled = false
  let resolveSettled: (outcome: FakeDaemonOutcome) => void = () => {}
  const settledPromise = new Promise<FakeDaemonOutcome>((resolve) => {
    resolveSettled = resolve
  })
  function settle(outcome: FakeDaemonOutcome): void {
    if (settled) return
    settled = true
    resolveSettled(outcome)
  }

  // Free every wasm object we still own. Each free is guarded so teardown is idempotent and never
  // throws (mirrors noiseSession.freeAll).
  function freeAll(): void {
    for (const obj of [hs, sendCipher, recvCipher]) {
      try {
        obj?.free()
      } catch {
        /* already freed / teardown */
      }
    }
    hs = null
    sendCipher = null
    recvCipher = null
  }

  // Frame + send one raw Noise output as an InnerFrameV2 text frame, mirroring the client. Every
  // outbound is tagged `noise_msg` (both msg2 and transport replies) — faithful and safe because
  // the client does not branch on the inbound `type` (noiseRelayDriver.onMessage).
  function sendNoise(raw: Uint8Array): void {
    if (leg === null || leg.readyState !== WebSocket.OPEN) return
    leg.send(encodeInnerFrame({ v: 2, type: 'noise_msg', data: base64StdEncode(raw) }))
  }

  function handleMsg1(raw: Uint8Array): void {
    if (hs === null) return
    try {
      const hello = hs.ReadMessage(raw, true) ?? EMPTY_AD
      // Faithfulness (AC3): the recovered `hello` early-data must be a well-formed envelope, exactly
      // as the real daemon parses it. A malformed hello fail-closes to handshake-read-failed.
      decodeEnvelope(hello)
      const msg2 = hs.WriteMessage(
        encodeEnvelope({ id: HELLO_ACK_ID, type: 'hello_ack', ts: HELLO_ACK_TS, payload: helloAck })
      )
      // noise-c returns [send, recv] role-adjusted for the responder — no swap (see the module note).
      const split = hs.Split() // consumes + frees hs
      hs = null
      sendCipher = split[0]
      recvCipher = split[1]
      sendNoise(msg2)
      state = 'transport'
    } catch {
      hs = null // the library auto-freed the handshake state on the throw
      settle({ ok: false, reason: 'handshake-read-failed' })
      void close()
    }
  }

  function handleTransport(raw: Uint8Array): void {
    if (recvCipher === null || sendCipher === null) return
    let plaintext: Uint8Array
    try {
      plaintext = recvCipher.DecryptWithAd(EMPTY_AD, raw)
    } catch {
      // A crossed Split mapping surfaces HERE (MAC failure on the first transport frame). The
      // cipher survives; the session stays open (non-terminal for this single-round-trip fake).
      settle({ ok: false, reason: 'transport-decrypt-failed' })
      return
    }
    sendNoise(sendCipher.EncryptWithAd(EMPTY_AD, buildReply(plaintext)))
    settle({ ok: true }) // first reply settles ok; cached thereafter, session stays open (AC2)
  }

  // The one untrusted→trusted boundary. Inert after close so a frame arriving post-freeAll never
  // touches a freed wasm object (mirrors noiseSession.onFrame). The inner `type` is NOT branched
  // on — the Noise state machine + AEAD decide interpretation, so a hostile `type` can't misroute.
  function onMessage(data: RawData): void {
    if (state === 'closed') return
    let raw: Uint8Array
    try {
      raw = base64StdDecode(decodeInnerFrame(toBytes(data)).data)
    } catch {
      settle({ ok: false, reason: 'frame-decode-failed' }) // caught object dropped — no bytes
      void close()
      return
    }
    if (state === 'awaiting-msg1') handleMsg1(raw)
    else handleTransport(raw)
  }

  function close(): Promise<void> {
    if (closePromise !== null) return closePromise
    state = 'closed'
    settle({ ok: false, reason: 'closed' }) // no-op if the run already settled
    freeAll()
    const socket = leg
    leg = null
    closePromise = new Promise<void>((resolve) => {
      if (socket === null) {
        resolve()
        return
      }
      socket.terminate() // synchronous forced teardown; cancels an in-flight dial too
      resolve()
    })
    return closePromise
  }

  const socket = new WebSocket(`${options.url}/v1/server`, { maxPayload: MAX_FRAME_BYTES })
  leg = socket
  // Attach the message handler synchronously so no inbound frame is missed once the leg opens.
  socket.on('message', (data: RawData) => onMessage(data))

  await new Promise<void>((resolve, reject) => {
    const onDialError = (err: Error): void => reject(err) // pre-open failure: no handle yet
    socket.once('error', onDialError)
    socket.once('open', () => {
      socket.off('error', onDialError)
      // Post-open lifecycle: a dropped leg drives teardown so an awaiter of whenSettled never hangs.
      socket.on('error', () => void close())
      socket.on('close', () => void close())
      resolve()
    })
  })

  return {
    staticPublicKey: staticPub,
    whenSettled: () => settledPromise,
    close
  }
}

/**
 * Normalise one inbound WS message to a single Uint8Array. `ws` delivers a Buffer (a Uint8Array
 * subclass — no copy) in the default nodebuffer mode; the array/ArrayBuffer arms cover fragmented
 * and arraybuffer-mode delivery. Loss-less re-assembly, not inspection — reused verbatim from
 * relayConnection's toFrame / the forwarder's toBytes.
 */
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}
