// Automated transport round-trip integration test (#89). It drives the ASSEMBLED background relay
// client — `createDaemonConnection` (bootstrap → the REAL `createNoiseRelayDriver` → real Noise
// session → real loopback relay socket) — through pair, a genuine
// `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake, send, and a streamed reply, against the in-process
// fake target that landed in this ticket's blockers: `startFakeRelayForwarder` (#90, the content-
// blind two-leg splice) + `startFakeDaemon` (#91, the Noise_IK responder). It asserts the reply
// reaches the renderer bridge as `messageReceived` / `messagesReceived` with the session still open.
//
// The value over `transport/noiseSession.interop.test.ts` is the LAYER under test: that test wires
// the primitives directly (createNoiseSession + createRelayConnection + codec); this one drives the
// whole assembled stack at its real entry point (`createDaemonConnection.start()`), leaving the
// `createDriver` seam at its default so the real driver + real handshake run. Only the outer seams
// `daemonConnection.test.ts` already fakes are injected: the two stores (`ensure()` / `load()`) and
// a captured `sink`.
//
// TEST-ONLY. Because this is a `.test.ts`, importing the permissive-`ws://` `fakeDaemon` /
// `fakeRelayForwarder` doubles keeps them out of the production graph — exactly as those doubles are
// used today. It performs no logging beyond the one module-load skip notice on the gated live path,
// and asserts on event TYPES/counts (never serialized payloads) so no message plaintext — and on the
// live path, no credential — is ever echoed into a failure message.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  createDaemonConnection,
  type DaemonConnection
} from './daemonConnection'
import type { DaemonEvent } from '../shared/ipc/events'
import type { DaemonEventSink } from './emitDaemonEvent'
import type { DeviceKeyPair } from './deviceKeypair'
import type { PairedServerRecord } from './pairedServerStore'
import { startFakeRelayForwarder } from './transport/fakeRelayForwarder'
import { startFakeDaemon, type FakeDaemon } from './transport/fakeDaemon'
import { loadNoiseLib } from './transport/noiseLib'
import { base64StdEncode, encodeEnvelope } from './transport/codec'
import type { BundleConsumer, BundleFailReason } from './transport/bundleReassembler'
import type { HelloAckPayload, MessagePayload, SendMessagePayload } from '../shared/wire/types'

// A fixed clock for the fake-target run — the fake daemon decodes the `hello`/`send_message`
// envelopes structurally (id/ts must be number/string) but never inspects the ts value, so a fixed
// timestamp keeps the run deterministic and wall-clock-free. The live path uses the real clock.
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// A synthetic literal, NEVER a real credential (Security review: fake-target token discipline). The
// relay requires a non-empty X-Pyrycode-Token but ignores its value under v2; the Noise static-key
// handshake is the real gate.
const DUMMY_TOKEN = 'dummy-token-not-a-real-credential'

// hello_ack overrides the fake daemon seals into msg2, chosen here (not the daemon's defaults) so the
// `connected` assertion pins the ack that round-tripped through the REAL handshake to the renderer
// bridge rather than coupling to the fake's internal defaults.
const HELLO_ACK_OVERRIDES: Partial<HelloAckPayload> = {
  server_id: 'roundtrip-srv',
  conn_id: 'roundtrip-conn'
}
const EXPECTED_ACK: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'roundtrip-srv',
  conn_id: 'roundtrip-conn',
  capabilities: []
}

// Generous per-step bounds: whenReady/connect absorb the one-time wasm compile + the real handshake
// on a cold CI runner; they stay well under the per-test timeout so a genuine hang still fails fast
// with a descriptive assertion (the waiter resolves-on-timeout, never rejects).
const READY_TIMEOUT_MS = 10_000
const CONNECT_TIMEOUT_MS = 8_000
const MESSAGE_TIMEOUT_MS = 5_000

// --- reusable waiter (copied verbatim from noiseSession.interop.test.ts) ---------------------
/**
 * A bounded waiter: resolves as soon as `check()` holds (re-checked on every notify), or after
 * `timeoutMs` (resolve, not reject — the caller asserts the resulting state). Resolve-on-timeout
 * keeps a failed handshake surfacing as a descriptive assertion (`expected connected; observed …`)
 * rather than an opaque vitest timeout.
 */
function makeWaiter(): { notify(): void; wait(check: () => boolean, timeoutMs?: number): Promise<void> } {
  const waiters: Array<{ check: () => boolean; done: () => void; timer: ReturnType<typeof setTimeout> }> = []
  return {
    notify() {
      for (const w of [...waiters]) {
        if (w.check()) {
          clearTimeout(w.timer)
          const i = waiters.indexOf(w)
          if (i >= 0) waiters.splice(i, 1)
          w.done()
        }
      }
    },
    wait(check, timeoutMs = 2000) {
      return new Promise<void>((resolve) => {
        if (check()) return resolve()
        const timer = setTimeout(() => {
          const i = waiters.findIndex((w) => w.timer === timer)
          if (i >= 0) waiters.splice(i, 1)
          resolve()
        }, timeoutMs)
        waiters.push({ check, done: resolve, timer })
      })
    }
  }
}

// --- teardown (LIFO) -------------------------------------------------------------------------
// Load-bearing order: connection.stop() (pushed LAST) runs FIRST — it sets the module's stopped
// flag, tears down the driver, suppresses the clean terminal, and quiesces the supervisor so it does
// not auto-reconnect when the forwarder drops; then daemon.close() (frees wasm + terminates its leg);
// then forwarder.close(). Stopping the client before closing the forwarder is what prevents
// supervisor reconnect churn / a spurious `failed` at teardown. Reversing the splice gives that LIFO
// order; the array shape still mirrors the interop test, and a mid-test throw still tears everything
// down because every double is registered the moment it is created.
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) {
    try {
      await c()
    } catch {
      /* teardown */
    }
  }
})

// Warm the memoized wasm load ONCE before any test drives the real driver, so the first test's
// connect budget is not spent on the cold Emscripten compile (mirrors the sibling harness tests).
beforeAll(async () => {
  await loadNoiseLib()
})

// --- helpers ---------------------------------------------------------------------------------
/** Type-safe finder — narrows a DaemonEvent union member off `events` without a cast. */
function findEvent<T extends DaemonEvent['type']>(
  events: DaemonEvent[],
  type: T
): Extract<DaemonEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<DaemonEvent, { type: T }> => e.type === type)
}

/** Event types in arrival order — for descriptive failure messages that carry no payloads/secrets. */
function types(events: DaemonEvent[]): string {
  return events.map((e) => e.type).join(', ') || '(none)'
}

/** Mint a REAL device static keypair via the shared noise-c CSPRNG (never Math.random). */
async function mintDeviceKeypair(): Promise<DeviceKeyPair> {
  const lib = await loadNoiseLib()
  const [privateKey, publicKey] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)
  return { privateKey, publicKey }
}

interface RoundTripContext {
  connection: DaemonConnection
  daemon: FakeDaemon
  events: DaemonEvent[]
  waiter: ReturnType<typeof makeWaiter>
}

/**
 * Stand up forwarder + fake daemon + the assembled client, drive it to `connected` (or `failed`),
 * and return the driven pieces. Ordering is load-bearing: the daemon's `/v1/server` leg is OPEN
 * before the client dials `/v1/client`, so the client's msg1 is never dropped. The record's `relay`
 * is the forwarder's client leg verbatim — the real driver dials it directly (no scheme seam).
 */
async function standUpRoundTrip(
  buildReply: () => Uint8Array,
  daemonOpts?: { rekeyResumeMessage?: Uint8Array; buildReplyFrames?: (inbound: Uint8Array) => Uint8Array[] }
): Promise<RoundTripContext> {
  const forwarder = await startFakeRelayForwarder()
  cleanups.push(() => forwarder.close())
  const daemon = await startFakeDaemon({
    url: forwarder.url,
    buildReply,
    helloAck: HELLO_ACK_OVERRIDES,
    // buildReplyFrames (when present in daemonOpts) takes precedence over buildReply in the fake.
    ...daemonOpts
  })
  cleanups.push(() => daemon.close())

  const record: PairedServerRecord = {
    server: 'fake-srv',
    relay: `${forwarder.url}/v1/client`,
    token: DUMMY_TOKEN,
    server_static_pubkey: base64StdEncode(daemon.staticPublicKey)
  }
  const devicePair = await mintDeviceKeypair()

  const events: DaemonEvent[] = []
  const waiter = makeWaiter()
  const sink: DaemonEventSink = {
    webContents: {
      send(_channel, event) {
        events.push(event)
        waiter.notify()
      }
    }
  }

  const connection = createDaemonConnection({
    deviceKeypair: { ensure: async () => devicePair },
    pairedServer: { load: async () => record, save: async () => {} },
    sink,
    deviceName: 'roundtrip-desktop',
    clientVersion: '0',
    now: () => FIXED_TS
    // createDriver omitted → the REAL createNoiseRelayDriver runs the genuine handshake.
  })
  cleanups.push(() => connection.stop())

  connection.start()
  // Explicit checkpoint that both legs spliced — a clearer failure than waiting only on `connected`.
  await forwarder.whenReady(READY_TIMEOUT_MS)
  // Wait for connected OR failed so a broken handshake fails fast, not after the full timeout.
  await waiter.wait(
    () => events.some((e) => e.type === 'connected' || e.type === 'failed'),
    CONNECT_TIMEOUT_MS
  )
  return { connection, daemon, events, waiter }
}

// --- fake-target run (unconditional under `npm test`) — AC1, AC2, AC3 ------------------------
describe('createDaemonConnection round-trip (in-process fake target)', () => {
  it(
    'drives pair → handshake → send → a streamed message reply through the assembled stack',
    async () => {
      // A well-formed inbound `message` envelope (NOT the default verbatim echo, which re-sends the
      // client's own send_message that parseInboundMessage correctly ignores).
      const reply: MessagePayload = {
        conversation_id: 'c1',
        message_id: 'reply-1',
        role: 'assistant',
        text: 'pong'
      }
      const buildReply = (): Uint8Array =>
        encodeEnvelope({ id: 99, type: 'message', ts: FIXED_TS, payload: reply })

      const { connection, daemon, events, waiter } = await standUpRoundTrip(buildReply)

      // Handshake completed: a `connected` carrying the parsed HelloAckPayload the daemon sealed.
      const connected = findEvent(events, 'connected')
      expect(connected, `expected connected; observed ${types(events)}`).toBeDefined()
      expect(connected?.ack).toEqual(EXPECTED_ACK)

      // Encrypt a send_message onto the live session and observe the streamed reply come back.
      const outbound: SendMessagePayload = { conversation_id: 'c1', message_id: 'out-1', text: 'ping' }
      connection.send(outbound)
      await waiter.wait(() => events.some((e) => e.type === 'messageReceived'), MESSAGE_TIMEOUT_MS)

      const received = findEvent(events, 'messageReceived')
      expect(received, `expected messageReceived; observed ${types(events)}`).toBeDefined()
      expect(received?.message).toEqual(reply)

      // The two deterministic sync points: the daemon settled ok (session stayed open after the
      // single reply — it is a single-round-trip responder), and no `failed` ever followed.
      expect(await daemon.whenSettled()).toEqual({ ok: true })
      expect(findEvent(events, 'failed'), `unexpected failed; observed ${types(events)}`).toBeUndefined()
    },
    15_000
  )

  it(
    'streams a message_chunk reply back as a single ordered messagesReceived',
    async () => {
      const batch: MessagePayload[] = [
        { conversation_id: 'c1', message_id: 'chunk-1', role: 'assistant', text: 'pong-a' },
        { conversation_id: 'c1', message_id: 'chunk-2', role: 'assistant', text: 'pong-b' }
      ]
      const buildReply = (): Uint8Array =>
        encodeEnvelope({ id: 100, type: 'message_chunk', ts: FIXED_TS, payload: { messages: batch } })

      const { connection, daemon, events, waiter } = await standUpRoundTrip(buildReply)

      expect(findEvent(events, 'connected'), `expected connected; observed ${types(events)}`).toBeDefined()

      connection.send({ conversation_id: 'c1', message_id: 'out-1', text: 'ping' })
      await waiter.wait(() => events.some((e) => e.type === 'messagesReceived'), MESSAGE_TIMEOUT_MS)

      const received = findEvent(events, 'messagesReceived')
      expect(received, `expected messagesReceived; observed ${types(events)}`).toBeDefined()
      expect(received?.messages).toEqual(batch)

      expect(await daemon.whenSettled()).toEqual({ ok: true })
      expect(findEvent(events, 'failed'), `unexpected failed; observed ${types(events)}`).toBeUndefined()
    },
    15_000
  )

  it(
    'survives a daemon-initiated rekey and resumes messaging under the new keys',
    async () => {
      // Distinct known payloads: the daemon's reply-builder output (both round-trip legs) and the
      // post-swap resume frame — so each `messageReceived` in order pins which cipher generation
      // and which channel it rode.
      const reply: MessagePayload = {
        conversation_id: 'c1',
        message_id: 'reply-1',
        role: 'assistant',
        text: 'pong'
      }
      const resumePayload: MessagePayload = {
        conversation_id: 'c1',
        message_id: 'resume-1',
        role: 'assistant',
        text: 'resumed under new keys'
      }
      const buildReply = (): Uint8Array =>
        encodeEnvelope({ id: 99, type: 'message', ts: FIXED_TS, payload: reply })
      const rekeyResumeMessage = encodeEnvelope({ id: 77, type: 'message', ts: FIXED_TS, payload: resumePayload })

      const { connection, daemon, events, waiter } = await standUpRoundTrip(buildReply, { rekeyResumeMessage })

      // Handshake completed (K0).
      expect(findEvent(events, 'connected'), `expected connected; observed ${types(events)}`).toBeDefined()

      const received = (): MessagePayload[] =>
        events
          .filter((e): e is Extract<DaemonEvent, { type: 'messageReceived' }> => e.type === 'messageReceived')
          .map((e) => e.message)

      // Baseline K0 round-trip — the pre-rekey channel works.
      connection.send({ conversation_id: 'c1', message_id: 'out-0', text: 'ping k0' })
      await waiter.wait(() => received().length >= 1, MESSAGE_TIMEOUT_MS)
      expect(received()[0], `expected 1 messageReceived; observed ${types(events)}`).toEqual(reply)

      // The daemon initiates the rekey: seal rekey_request (K0) → the real client recognizes it →
      // the driver frames the fresh msg1 as noise_init (Part 1) → the daemon reads it and swaps →
      // msg2 + resume frame stream back → the client swaps. The resume frame decrypting under the
      // client's NEW recv cipher IS the "resumed under the new keys" signal.
      daemon.initiateRekey()
      await waiter.wait(() => received().length >= 2, MESSAGE_TIMEOUT_MS)
      expect(received()[1], `expected the resume frame; observed ${types(events)}`).toEqual(resumePayload)

      // A full bidirectional round-trip under K1: the client's send opens under the daemon's new
      // recv cipher (the implicit ack) and the reply comes back under K1.
      connection.send({ conversation_id: 'c1', message_id: 'out-1', text: 'ping k1' })
      await waiter.wait(() => received().length >= 3, MESSAGE_TIMEOUT_MS)
      expect(received()[2], `expected the K1 reply; observed ${types(events)}`).toEqual(reply)

      // No failure across the whole sequence; the daemon settled ok on the baseline round-trip.
      expect(findEvent(events, 'failed'), `unexpected failed; observed ${types(events)}`).toBeUndefined()
      expect(await daemon.whenSettled()).toEqual({ ok: true })
    },
    20_000
  )
})

// --- debug-bundle reassembly through the real handshake (#116, AC5) --------------------------
/** A never-invoked buildReply stub: the bundle tests drive the fake via buildReplyFrames, which
 *  takes precedence, so buildReply is required by standUpRoundTrip but is never called. */
const UNUSED_BUILD_REPLY = (): Uint8Array => new Uint8Array(0)

/** Split raw archive bytes into ordered debug_bundle_chunk envelopes + a final debug_bundle_done. */
function bundleFrames(raw: Uint8Array, chunkSize: number): Uint8Array[] {
  const frames: Uint8Array[] = []
  let seq = 0
  for (let off = 0; off < raw.length; off += chunkSize) {
    const slice = raw.subarray(off, off + chunkSize)
    frames.push(
      encodeEnvelope({
        id: seq,
        type: 'debug_bundle_chunk',
        ts: FIXED_TS,
        payload: { seq, data: base64StdEncode(slice) }
      })
    )
    seq += 1
  }
  frames.push(encodeEnvelope({ id: seq, type: 'debug_bundle_done', ts: FIXED_TS, payload: { total: seq } }))
  return frames
}

/** A spy consumer that also pokes the waiter so the bounded wait resolves on the terminal (bundle
 *  frames emit no DaemonEvent, so the sink's own notify never fires for a completion). */
function bundleConsumer(waiter: ReturnType<typeof makeWaiter>): {
  consumer: BundleConsumer
  completed: Uint8Array[]
  failed: BundleFailReason[]
} {
  const completed: Uint8Array[] = []
  const failed: BundleFailReason[] = []
  return {
    completed,
    failed,
    consumer: {
      complete: (bytes) => {
        completed.push(bytes)
        waiter.notify()
      },
      fail: (reason) => {
        failed.push(reason)
        waiter.notify()
      }
    }
  }
}

describe('createDaemonConnection debug-bundle round-trip (in-process fake target, #116)', () => {
  it(
    'reassembles a streamed multi-chunk bundle end-to-end to the served bytes',
    async () => {
      // A 50-byte archive split at 16 bytes → 4 chunks + done (5 frames) — more than one chunk.
      const archive = new Uint8Array(50)
      for (let i = 0; i < archive.length; i++) archive[i] = (i * 37 + 11) % 256
      const frames = bundleFrames(archive, 16)

      const { connection, events, waiter } = await standUpRoundTrip(UNUSED_BUILD_REPLY, {
        buildReplyFrames: () => frames
      })
      expect(findEvent(events, 'connected'), `expected connected; observed ${types(events)}`).toBeDefined()

      const { consumer, completed, failed } = bundleConsumer(waiter)
      connection.requestDebugBundle(consumer)
      await waiter.wait(() => completed.length + failed.length > 0, MESSAGE_TIMEOUT_MS)

      expect(failed, `unexpected fail; observed ${types(events)}`).toEqual([])
      expect(completed).toHaveLength(1)
      expect([...completed[0]]).toEqual([...archive])
      // The session stays open — a bundle stream is not a connection-level failure.
      expect(findEvent(events, 'failed'), `unexpected failed; observed ${types(events)}`).toBeUndefined()
    },
    15_000
  )

  it(
    'fails the consumer daemon-error when the daemon replies with a single error frame',
    async () => {
      const errorFrame = encodeEnvelope({
        id: 0,
        type: 'error',
        ts: FIXED_TS,
        payload: { code: 'server.binary_offline', message: 'bundle unavailable', retryable: true }
      })
      const { connection, events, waiter } = await standUpRoundTrip(UNUSED_BUILD_REPLY, {
        buildReplyFrames: () => [errorFrame]
      })
      expect(findEvent(events, 'connected'), `expected connected; observed ${types(events)}`).toBeDefined()

      const { consumer, completed, failed } = bundleConsumer(waiter)
      connection.requestDebugBundle(consumer)
      await waiter.wait(() => completed.length + failed.length > 0, MESSAGE_TIMEOUT_MS)

      expect(completed).toEqual([])
      expect(failed).toEqual(['daemon-error'])
      // The error is an application frame, not a connection drop: no `failed` DaemonEvent.
      expect(findEvent(events, 'failed'), `unexpected failed; observed ${types(events)}`).toBeUndefined()
    },
    15_000
  )
})

// --- opt-in live variant (operator-gated) — AC4 ----------------------------------------------
// Reuses the interop test's env-var names + skip convention VERBATIM (do not invent a new one). The
// real PYRY_LIVE_DEVICE_TOKEN is sourced from the environment only — never committed, logged, echoed
// into a failure message, or used inside an expect(...). A fresh in-process device keypair completes
// the handshake (the token in the encrypted hello authorizes; IK recovers whatever static the
// initiator presents), matching the interop live path.
interface LiveConfig {
  url: string
  serverId: string
  token: string
  serverStaticPub: string
  deviceName: string
}

function readLiveEnv(): LiveConfig | null {
  const url = process.env.PYRY_LIVE_RELAY_URL
  const serverId = process.env.PYRY_LIVE_SERVER_ID
  const token = process.env.PYRY_LIVE_DEVICE_TOKEN
  const serverStaticPub = process.env.PYRY_LIVE_SERVER_STATIC_PUB
  if (!url || !serverId || !token || !serverStaticPub) return null
  return { url, serverId, token, serverStaticPub, deviceName: process.env.PYRY_LIVE_DEVICE_NAME ?? 'pyrycode-desktop-roundtrip' }
}

const live = readLiveEnv()
if (!live) {
  // Operator-visible signal that the live proof was skipped. Static string, never a credential.
  console.info(
    '[daemon round-trip] live path skipped: set PYRY_LIVE_RELAY_URL/SERVER_ID/DEVICE_TOKEN/SERVER_STATIC_PUB to enable'
  )
}

describe.skipIf(!live)(
  'live round-trip — set PYRY_LIVE_RELAY_URL/SERVER_ID/DEVICE_TOKEN/SERVER_STATIC_PUB to enable',
  () => {
    it(
      'reaches the daemon post-handshake open state over the real relay',
      async () => {
        const cfg = live as LiveConfig
        const record: PairedServerRecord = {
          server: cfg.serverId,
          relay: cfg.url, // the operator supplies the full client-leg dial URL, consumed verbatim
          token: cfg.token,
          server_static_pubkey: cfg.serverStaticPub
        }
        const devicePair = await mintDeviceKeypair() // fresh in-process static

        const events: DaemonEvent[] = []
        const waiter = makeWaiter()
        const sink: DaemonEventSink = {
          webContents: {
            send(_channel, event) {
              events.push(event)
              waiter.notify()
            }
          }
        }

        const connection = createDaemonConnection({
          deviceKeypair: { ensure: async () => devicePair },
          pairedServer: { load: async () => record, save: async () => {} },
          sink,
          deviceName: cfg.deviceName,
          clientVersion: '0'
          // now omitted → real wall clock (the live daemon may validate ts).
        })
        cleanups.push(() => connection.stop())

        connection.start()
        await waiter.wait(
          () => events.some((e) => e.type === 'connected' || e.type === 'failed'),
          10_000
        )

        // The session-open outcome is the deterministic assertion (handshake + no decrypt-class fail).
        expect(
          findEvent(events, 'connected'),
          `expected connected; observed ${types(events)}`
        ).toBeDefined()
        expect(findEvent(events, 'failed'), `unexpected failed; observed ${types(events)}`).toBeUndefined()

        // Best-effort probe: a live daemon's reply to a synthetic probe is not guaranteed, so this is
        // NOT hard-asserted (matches the interop live path, which asserts handshake + no decrypt error).
        connection.send({ conversation_id: 'live-probe', message_id: 'probe-1', text: 'round-trip probe' })
        await waiter.wait(() => events.some((e) => e.type === 'messageReceived'), 8_000)
      },
      20_000
    )
  }
)
