// Self-verifying round-trip for the in-process Noise_IK responder fake daemon (#91). It drives the
// REAL client initiator primitives (createNoiseSession + createRelayConnection + codec) through the
// #90 content-blind relay forwarder against the fake daemon, proving one genuine
// Noise_IK_25519_ChaChaPoly_BLAKE2s handshake + one sealed transport round-trip in CI — no Go
// toolchain, no network, unconditional under `npm test`.
//
// The core test IS AC4's coverage: a crossed Split send/recv mapping completes the handshake but
// MAC-fails the first transport frame, so the round-trip assertion (decrypted reply equals the
// probe) fails hard. It is a deterministic oracle for a detail the reasoning alone can't pin.
//
// Secrets discipline: every keypair is freshly generated in-process and the hello carries a DUMMY
// token — never a real PYRY_LIVE_* credential (see the spec's Security review).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import { startFakeRelayForwarder, type FakeRelayForwarder } from './fakeRelayForwarder'
import {
  startFakeDaemon,
  DEFAULT_REKEY_RESUME_MESSAGE,
  type FakeDaemon,
  type FakeDaemonOptions
} from './fakeDaemon'
import { createNoiseSession, type NoiseSession, type NoiseSessionEvent } from './noiseSession'
import { createRelayConnection, type RelayEvent, type RelayConnection } from './relayConnection'
import { loadNoiseLib } from './noiseLib'
import {
  base64StdEncode,
  base64StdDecode,
  encodeInnerFrame,
  decodeInnerFrame,
  encodeEnvelope
} from './codec'
import { buildClientHello, parseHelloAck } from './helloExchange'

const EMPTY = new Uint8Array(0)
const bytes = (u: Uint8Array): number[] => Array.from(u)
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const

// A transient pre-open dial reset (#104): under full-suite CPU starvation a raw dial to the
// already-listening forwarder can complete its HTTP upgrade abnormally — "socket hang up" /
// ECONNRESET, an accept-backlog ECONNREFUSED, a malformed-upgrade "Parse Error" (#311), or a
// non-101 "Unexpected server response: 404" (#336, this file's variant) — which an immediate re-dial
// clears. Post-close it simply exhausts attempts and rejects.
function isTransientDialError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    /socket hang up/i.test(err.message) ||
    /Parse Error/i.test(err.message) ||
    /Unexpected server response: 404/i.test(err.message) // #336 404-upgrade variant of the #104/#311 family
  )
}

// Dial a raw ws client and resolve once it is OPEN. A pre-open transient reset is re-dialled up to
// `attemptsLeft` times against the already-listening server — deterministic convergence on a
// recoverable reset, NOT a blind whole-test retry (no assertion re-runs, so a real logic bug is
// never masked; a genuinely-down target still fails fast once attempts are exhausted). On open the
// pre-open reject handler is swapped for a benign swallow so a later reset never crashes the process
// (mirrors fakeDaemon.ts's dial lifecycle).
function connect(url: string, attemptsLeft = 5): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const onDialError = (err: Error): void => {
      ws.terminate() // drop the half-open socket before re-dialling so none leaks
      if (attemptsLeft > 1 && isTransientDialError(err)) {
        setTimeout(() => resolve(connect(url, attemptsLeft - 1)), 20)
        return
      }
      reject(err)
    }
    ws.once('error', onDialError)
    ws.once('open', () => {
      ws.off('error', onDialError)
      ws.on('error', () => {})
      resolve(ws)
    })
  })
}

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) {
    try {
      await c()
    } catch {
      /* teardown */
    }
  }
})

// Warm the memoized wasm load ONCE before any console spy installs: the Emscripten glue prints a
// one-time streaming-compile fallback warning at first load — warm it away so the log-free
// assertion measures the harness + daemon alone (mirrors noiseSession.interop.test.ts).
beforeAll(async () => {
  await loadNoiseLib()
})

/**
 * A bounded waiter: resolves as soon as `check()` holds (re-checked on every notify), or after
 * `timeoutMs` (resolve, not reject — the caller asserts the resulting state). Keeps tests
 * deterministic and inside vitest's default timeout. Mirrors noiseSession.interop.test.ts.
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

/** Build a client `hello` carrying a synthetic dummy token — never a real credential. */
function buildTestHello(): Uint8Array {
  return buildClientHello({
    id: 1,
    ts: '2026-01-01T00:00:00Z',
    deviceName: 'fakedaemon-test-desktop',
    clientVersion: '0',
    token: 'dummy-fakedaemon-token-not-a-real-credential'
  })
}

/**
 * The inner `type` of a raw InnerFrameV2, or a static placeholder if it will not decode. Total by
 * construction — a throw here would break the relay's event dispatch and hang unrelated tests, so a
 * decode failure classifies rather than propagates (mirroring the fake's own discipline). Records
 * the type ONLY, never `.data` (base64 of the sealed transcript).
 */
function peekInnerType(frame: Uint8Array): string {
  try {
    return decodeInnerFrame(frame).type
  } catch {
    return 'undecodable' // static placeholder — the caught object is dropped, no bytes
  }
}

/**
 * Wire the REAL client initiator (createNoiseSession) to the forwarder's /v1/client leg exactly as
 * the live path does (noiseSession.interop.test.ts:388-447), pointed at the in-process forwarder
 * instead of the live relay: on `connected` start the handshake; on `message` decode the inner
 * frame, base64-decode, and feed the raw Noise bytes to the initiator. Returns the driven
 * initiator, its observed events, and a bounded waiter.
 */
async function driveClient(opts: {
  forwarderUrl: string
  remoteStaticPublicKey: Uint8Array
  hello: Uint8Array
  /** Reuse a device static across a reconnect leg (#416). Omitted → a fresh in-process static, the
   *  pre-#416 behaviour. IK recovers whatever static the initiator presents, so the daemon completes
   *  the handshake either way; passing it lets a reconnect leg present the SAME device identity as the
   *  first, mirroring the real driver's material reuse across a reconnect. */
  clientPrivateKey?: Uint8Array
}): Promise<{
  initiator: NoiseSession
  events: NoiseSessionEvent[]
  waiter: ReturnType<typeof makeWaiter>
  clientPrivateKey: Uint8Array
  /** Arm the inbound gate (#524): later inbound frames are captured in `held` instead of being fed
   *  to the initiator, so a test can hold the client in `transport` while the daemon has already
   *  entered `awaiting-rekey-init`. */
  holdInbound(): void
  /** Disarm the gate — later inbound frames flow to the initiator again. Already-held frames stay held. */
  resumeInbound(): void
  /** Raw InnerFrameV2 frames captured while the gate was armed, in arrival order. */
  held: Uint8Array[]
  /** Every inbound frame's inner `type`, in arrival order — held frames included (the tap sits above
   *  the gate). The ONLY oracle for the daemon's outbound tagging, since the client discards it (#525). */
  inboundTypes: string[]
  /** Feed `held[i]` through the normal decode + initiator.onFrame path, as if it had just arrived. */
  deliverHeld(i: number): void
  /** Send `raw` as a `noise_msg` InnerFrameV2, bypassing the initiator's ciphers (#524, AC4). */
  sendRaw(raw: Uint8Array): void
}> {
  const lib = await loadNoiseLib()
  const clientPriv = opts.clientPrivateKey ?? lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)[0] // fresh in-process static
  const events: NoiseSessionEvent[] = []
  const waiter = makeWaiter()
  let firstOut = true
  // Mirrors the production driver's SECOND init latch (noiseRelayDriver.ts:196/203/225-226): the
  // session emits `rekey-requested` and then hands its fresh rekey msg1 to sendFrame synchronously
  // within the same onFrame turn (noiseSession.ts:225-229), so arming here tags exactly that one
  // frame `noise_init` — the routing signal the daemon's rekey window reads (#524).
  let rekeyInitPending = false
  // The inbound gate (#524): while armed, an inbound frame is captured raw instead of delivered.
  let holdingInbound = false
  const held: Uint8Array[] = []
  // The passive tagging tap (#525). Shared by a replaced relay on the bounded pre-`connected`
  // re-dial path (#336) exactly as `held` is — safe, since no inbound frame can arrive before
  // `connected` (the daemon's first outbound answers a msg1 the client only sends from that handler).
  const inboundTypes: string[] = []
  let initiator!: NoiseSession

  // Bounded transient re-dial for the pre-`connected` 404-upgrade race (#336). createRelayConnection
  // suppresses a 404 into a silent closed{1006,'connect-error'} (relayConnection.ts's
  // unexpected-response handler), so the re-dial trigger here is that `closed` RelayEvent, not a
  // message match. Re-dial fires ONLY before the first `connected`: the Noise initiator is created
  // once and start()s only after a successful connect, so every attempt hands a pristine initiator
  // (msg1 never sent) — no half-advanced handshake is re-driven, no assertion re-runs, no Noise
  // nonce reuse. A terminal `closed` after connect, or an exhausted budget, is a no-op, so a
  // genuinely dead dial still fails fast via the existing wait/assert path.
  let connectedOnce = false
  let dialAttemptsLeft = 5
  let activeRelay!: RelayConnection
  // The single inbound delivery path — shared by live arrival and by a gated replay, so a released
  // frame goes through exactly the decode the live path uses.
  const deliverFrame = (frame: Uint8Array): void => {
    try {
      const inner = decodeInnerFrame(frame)
      // #532: hand the inner `type` down with the raw bytes, exactly as the production driver now
      // does (noiseRelayDriver.onMessage). Discarding it here would leave this whole suite blind to
      // the client's rekey-window routing while claiming to drive the real client faithfully.
      initiator.onFrame(base64StdDecode(inner.data), inner.type)
    } catch {
      /* fail-closed on a malformed frame; the bounded wait converts it to a timeout */
    }
  }
  const makeRelay = (): RelayConnection =>
    createRelayConnection({
      url: `${opts.forwarderUrl}/v1/client`,
      headers: {
        'X-Pyrycode-Server': 'fake-daemon',
        'X-Pyrycode-Token': 'dummy-fakedaemon-token-not-a-real-credential',
        'User-Agent': 'pyrycode-desktop-fakedaemon-test/0'
      },
      onEvent: (e: RelayEvent) => {
        if (e.type === 'connected') {
          connectedOnce = true
          initiator.start()
        } else if (e.type === 'message') {
          inboundTypes.push(peekInnerType(e.frame)) // above the gate, so a held frame is recorded too
          if (holdingInbound) {
            held.push(e.frame) // raw InnerFrameV2 bytes — the tests inspect `type` and the sealed length
            waiter.notify()
            return
          }
          deliverFrame(e.frame)
        } else if (e.type === 'closed' && !connectedOnce && dialAttemptsLeft > 1) {
          dialAttemptsLeft -= 1
          setTimeout(() => {
            if (!connectedOnce) activeRelay = makeRelay()
          }, 20)
        }
      }
    })
  activeRelay = makeRelay()
  cleanups.push(() => activeRelay.close())

  initiator = await createNoiseSession({
    staticPrivateKey: clientPriv,
    remoteStaticPublicKey: opts.remoteStaticPublicKey,
    prologue: EMPTY,
    hello: opts.hello,
    // Tag a handshake init noise_init, every other outbound noise_msg; base64-std the raw Noise
    // bytes into an InnerFrameV2 at the relay boundary (the codec, composed unchanged). Both latches
    // are one-shot, exactly as the production driver's (noiseRelayDriver.ts:203-205).
    sendFrame: (raw) => {
      const type = firstOut || rekeyInitPending ? 'noise_init' : 'noise_msg'
      firstOut = false
      rekeyInitPending = false
      activeRelay.send(encodeInnerFrame({ v: 2, type, data: base64StdEncode(raw) }))
    },
    onEvent: (e) => {
      if (e.type === 'rekey-requested') rekeyInitPending = true
      events.push(e)
      waiter.notify()
    }
  })
  cleanups.push(() => initiator.close())
  return {
    initiator,
    events,
    waiter,
    clientPrivateKey: clientPriv,
    holdInbound: () => {
      holdingInbound = true
    },
    resumeInbound: () => {
      holdingInbound = false
    },
    held,
    inboundTypes,
    deliverHeld: (i) => deliverFrame(held[i]),
    sendRaw: (raw) =>
      activeRelay.send(encodeInnerFrame({ v: 2, type: 'noise_msg', data: base64StdEncode(raw) }))
  }
}

/** Stand up a forwarder + fake daemon pair, registering teardown. */
async function standUp(daemonOpts?: Omit<FakeDaemonOptions, 'url'>): Promise<{
  forwarder: FakeRelayForwarder
  forwarderUrl: string
  whenReady: () => Promise<void>
  daemon: FakeDaemon
}> {
  const forwarder = await startFakeRelayForwarder()
  cleanups.push(() => forwarder.close())
  const daemon = await startFakeDaemon({ url: forwarder.url, ...daemonOpts })
  cleanups.push(() => daemon.close())
  return { forwarder, forwarderUrl: forwarder.url, whenReady: () => forwarder.whenReady(), daemon }
}

describe('in-process Noise_IK fake daemon round-trip', () => {
  it('completes the handshake and one sealed round-trip through the forwarder (AC1–AC6)', async () => {
    const { forwarderUrl, whenReady, daemon } = await standUp()
    const hello = buildTestHello()
    const { initiator, events, waiter, inboundTypes } = await driveClient({
      forwarderUrl,
      remoteStaticPublicKey: daemon.staticPublicKey,
      hello
    })
    await whenReady()

    // Handshake completes: msg2 read + hello_ack built via the production codec (AC1, AC3).
    await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))
    const complete = events.find((e) => e.type === 'handshake-complete')
    expect(complete, 'handshake must complete against the fake daemon').toBeDefined()
    expect(parseHelloAck((complete as { helloAck: Uint8Array }).helloAck)).toEqual({
      protocol_version: 'v2',
      server_id: 'fake-daemon',
      conn_id: 'conn-1',
      capabilities: []
    })

    // One sealed transport round-trip (AC2). A crossed Split mapping MAC-fails HERE (AC4): the
    // client would emit transport-decrypt-failed and never a `message`, so this assertion is the
    // deterministic oracle for the send/recv role-mapping.
    const probe = encodeEnvelope({
      id: 2,
      type: 'send_message',
      ts: '2026-01-01T00:00:01Z',
      payload: { conversation_id: 'c1', message_id: 'm1', text: 'round-trip probe #91' }
    })
    initiator.sendMessage(probe)
    await waiter.wait(() => events.some((e) => e.type === 'message'))
    const message = events.find((e) => e.type === 'message')
    expect(message, 'a sealed transport frame must round-trip through the daemon cipher states').toBeDefined()
    expect(bytes((message as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(probe))

    // Outbound tagging on the wire (#525): the IK msg2 is a handshake reply (`noise_resp`), the
    // transport reply is not (`noise_msg`). Whole-array equality pins BOTH directions — a handshake
    // site regressing to `noise_msg` and a transport site wrongly becoming `noise_resp` fail the
    // same assertion. The client discards the inbound type, so the wire bytes are the only oracle.
    expect(inboundTypes).toEqual(['noise_resp', 'noise_msg'])

    // No client error — in particular no transport-decrypt-failed; the daemon settled ok.
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(await daemon.whenSettled()).toEqual({ ok: true })

    // Ran on loopback ws only, no Go toolchain (AC6).
    expect(forwarderUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)
  })

  it('honours a custom buildReply and streams it back sealed while keeping the session open (AC2)', async () => {
    const canned = encodeEnvelope({
      id: 99,
      type: 'message',
      ts: '2026-01-01T00:00:02Z',
      payload: { conversation_id: 'c1', message_id: 'm2', role: 'assistant', text: 'canned daemon reply' }
    })
    const { forwarderUrl, whenReady, daemon } = await standUp({ buildReply: () => canned })
    const { initiator, events, waiter } = await driveClient({
      forwarderUrl,
      remoteStaticPublicKey: daemon.staticPublicKey,
      hello: buildTestHello()
    })
    await whenReady()
    await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))

    initiator.sendMessage(encodeEnvelope({ id: 3, type: 'send_message', ts: '2026-01-01T00:00:03Z', payload: { conversation_id: 'c1', message_id: 'm3', text: 'ping' } }))
    await waiter.wait(() => events.some((e) => e.type === 'message'))
    const first = events.find((e) => e.type === 'message')
    expect(bytes((first as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(canned))

    // Session stays open — a second inbound frame decrypts + replies again (AC2).
    initiator.sendMessage(encodeEnvelope({ id: 4, type: 'send_message', ts: '2026-01-01T00:00:04Z', payload: { conversation_id: 'c1', message_id: 'm4', text: 'ping-2' } }))
    await waiter.wait(() => events.filter((e) => e.type === 'message').length >= 2)
    expect(events.filter((e) => e.type === 'message').length).toBe(2)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('streams every buildReplyFrames envelope as its own sealed frame, in order (#116)', async () => {
    // Three distinct plaintext envelopes — the client must receive exactly three `message` events,
    // byte-equal and in order (the debug-bundle [chunk0, chunk1, done] streaming shape).
    const frames = [
      encodeEnvelope({ id: 1, type: 'debug_bundle_chunk', ts: '2026-01-01T00:00:07Z', payload: { seq: 0, data: base64StdEncode(new Uint8Array([1, 2, 3])) } }),
      encodeEnvelope({ id: 2, type: 'debug_bundle_chunk', ts: '2026-01-01T00:00:08Z', payload: { seq: 1, data: base64StdEncode(new Uint8Array([4, 5])) } }),
      encodeEnvelope({ id: 3, type: 'debug_bundle_done', ts: '2026-01-01T00:00:09Z', payload: { total: 2 } })
    ]
    const { forwarderUrl, whenReady, daemon } = await standUp({ buildReplyFrames: () => frames })
    const { initiator, events, waiter } = await driveClient({
      forwarderUrl,
      remoteStaticPublicKey: daemon.staticPublicKey,
      hello: buildTestHello()
    })
    await whenReady()
    await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))

    initiator.sendMessage(encodeEnvelope({ id: 4, type: 'send_message', ts: '2026-01-01T00:00:10Z', payload: { conversation_id: 'c1', message_id: 'm', text: 'req' } }))
    await waiter.wait(() => events.filter((e) => e.type === 'message').length >= 3)

    const received = events.filter((e) => e.type === 'message') as { plaintext: Uint8Array }[]
    expect(received).toHaveLength(3)
    expect(received.map((e) => bytes(e.plaintext))).toEqual(frames.map(bytes))
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(await daemon.whenSettled()).toEqual({ ok: true })
  })

  it('initiates a rekey: the real client swaps and resumes messaging under the new keys (AC2, AC3)', async () => {
    const { forwarderUrl, whenReady, daemon } = await standUp()
    const { initiator, events, waiter, inboundTypes } = await driveClient({
      forwarderUrl,
      remoteStaticPublicKey: daemon.staticPublicKey,
      hello: buildTestHello()
    })
    await whenReady()

    // Initial handshake + one K0 round-trip — the pre-rekey baseline (default buildReply echoes).
    await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))
    const probe0 = encodeEnvelope({
      id: 2,
      type: 'send_message',
      ts: '2026-01-01T00:00:01Z',
      payload: { conversation_id: 'c1', message_id: 'm1', text: 'k0 probe' }
    })
    initiator.sendMessage(probe0)
    await waiter.wait(() => events.filter((e) => e.type === 'message').length >= 1)

    // The daemon initiates the rekey. The REAL client recognizes the trigger, runs its fresh
    // handshake as INITIATOR, and swaps its ciphers.
    daemon.initiateRekey()

    // The daemon's post-swap resume frame decrypts under the client's NEW recv cipher and surfaces
    // as a message — the deterministic client-side signal that the client swapped to the new keys.
    await waiter.wait(() => events.filter((e) => e.type === 'message').length >= 2)
    const resume = events.filter((e) => e.type === 'message')[1]
    expect(bytes((resume as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(DEFAULT_REKEY_RESUME_MESSAGE))
    // Exactly one recognition of the trigger on the client.
    expect(events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)

    // A K1 round-trip: the client's send opens under the daemon's new recv cipher and the reply
    // comes back under K1 — proving the client's send cipher is the new key too.
    const probe1 = encodeEnvelope({
      id: 3,
      type: 'send_message',
      ts: '2026-01-01T00:00:02Z',
      payload: { conversation_id: 'c1', message_id: 'm2', text: 'k1 probe' }
    })
    initiator.sendMessage(probe1)
    await waiter.wait(() => events.filter((e) => e.type === 'message').length >= 3)
    const reply1 = events.filter((e) => e.type === 'message')[2]
    expect(bytes((reply1 as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(probe1))

    // No client error — in particular no transport-decrypt-failed (the crossed-Split oracle for a
    // wrong rekey cipher mapping) — and the daemon settled ok on the initial round-trip.
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(await daemon.whenSettled()).toEqual({ ok: true })

    // Outbound tagging across the whole rekey (#525), in arrival order: the initial IK msg2, the K0
    // reply, the `rekey_request` control envelope, the rekey msg2, the post-swap resume frame, the
    // K1 reply. Only the two handshake replies are `noise_resp` — the `rekey_request` is a transport
    // frame despite driving the rekey, so the tag follows the FRAME, never the state.
    expect(inboundTypes).toEqual([
      'noise_resp',
      'noise_msg',
      'noise_msg',
      'noise_resp',
      'noise_msg',
      'noise_msg'
    ])
  })

  it('honours a custom rekeyResumeMessage streamed under the new keys (AC2)', async () => {
    const resume = encodeEnvelope({
      id: 42,
      type: 'message',
      ts: '2026-01-01T00:00:06Z',
      payload: { conversation_id: 'c1', message_id: 'resume-x', role: 'assistant', text: 'custom resume' }
    })
    const { forwarderUrl, whenReady, daemon } = await standUp({ rekeyResumeMessage: resume })
    const { initiator, events, waiter } = await driveClient({
      forwarderUrl,
      remoteStaticPublicKey: daemon.staticPublicKey,
      hello: buildTestHello()
    })
    await whenReady()
    await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))
    initiator.sendMessage(encodeEnvelope({ id: 2, type: 'send_message', ts: '2026-01-01T00:00:01Z', payload: { conversation_id: 'c1', message_id: 'm1', text: 'k0' } }))
    await waiter.wait(() => events.filter((e) => e.type === 'message').length >= 1)

    daemon.initiateRekey()
    await waiter.wait(() => events.filter((e) => e.type === 'message').length >= 2)
    const streamed = events.filter((e) => e.type === 'message')[1]
    expect(bytes((streamed as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(resume))
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('serves a non-noise_init frame inside the rekey window and still completes the swap (#524, AC2/AC3/AC5)', async () => {
    // The whole interleave runs through the newly widened routing arm — a new path across the
    // untrusted→trusted boundary, so it must stay as log-free as every other.
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      // Long enough that `canned.length + 16` cannot be confused with a 48-byte IK msg2 or an
      // empty frame — the sealed length is what distinguishes a SERVED reply from a handshake reply.
      const canned = encodeEnvelope({
        id: 55,
        type: 'message',
        ts: '2026-01-01T00:00:11Z',
        payload: {
          conversation_id: 'c1',
          message_id: 'interleaved-1',
          role: 'assistant',
          text: 'served under the old cipher while the daemon awaits the rekey init'
        }
      })
      const { forwarderUrl, whenReady, daemon } = await standUp({ buildReply: () => canned })
      const client = await driveClient({
        forwarderUrl,
        remoteStaticPublicKey: daemon.staticPublicKey,
        hello: buildTestHello()
      })
      await whenReady()
      await client.waiter.wait(() => client.events.some((e) => e.type === 'handshake-complete'))

      // Deliberately NO baseline round-trip: settle() is first-wins (fakeDaemon.ts:212-216) and
      // handleTransport settles { ok: true } on its first reply (:387), so a baseline would swallow
      // every later reason and make this test's oracle unobservable. initiateRekey only requires
      // `transport` (:271-272).

      // Withhold the rekey_request from the initiator. The client therefore stays in `transport` (its
      // sendMessage is not dropped by the session's state guard, noiseSession.ts:311) while the
      // daemon is already in `awaiting-rekey-init` — initiateRekey assigns state synchronously
      // BEFORE it sends (fakeDaemon.ts:280-281), so the ordering is exact with no timer.
      client.holdInbound()
      daemon.initiateRekey()
      await client.waiter.wait(() => client.held.length >= 1)
      expect(client.held, 'the rekey_request must be withheld from the initiator').toHaveLength(1)

      // The interleaved old-cipher app frame — what the real daemon fans out after `rekey_request`
      // but before the client's `noise_init` lands.
      const probe = encodeEnvelope({
        id: 2,
        type: 'send_message',
        ts: '2026-01-01T00:00:12Z',
        payload: { conversation_id: 'c1', message_id: 'm1', text: 'interleaved probe' }
      })
      client.initiator.sendMessage(probe)
      await client.waiter.wait(() => client.held.length >= 2)

      // AC2 — the must-fail-first assertion. Under state-based routing this frame reaches
      // handleRekeyInit, ReadMessage throws, and the run settles { ok:false,'handshake-read-failed' }.
      // { ok: true } is reachable from exactly one line, handleTransport:387, and only after
      // recvCipher.DecryptWithAd succeeded and the reply was sealed and streamed.
      expect(await daemon.whenSettled()).toEqual({ ok: true })
      expect(client.held).toHaveLength(2)
      const served = decodeInnerFrame(client.held[1])
      expect(served.type).toBe('noise_msg')
      // Sealed under the CURRENT (pre-swap) send cipher: the canned reply plus the ChaChaPoly tag.
      expect(base64StdDecode(served.data).length).toBe(canned.length + 16)

      // AC3: release ONLY the withheld rekey_request and let the swap run to completion.
      // held[1] is never delivered — a client in `awaiting-rekey-reply` consumes the next inbound
      // frame as its handshake reply (noiseSession.ts:256-268), so feeding it the interleaved
      // old-cipher frame desyncs the client. That is #507's bug, explicitly out of scope here.
      client.resumeInbound()
      client.deliverHeld(0)

      // The post-swap resume frame decrypts under the client's NEW recv cipher. This is also the
      // oracle for "the daemon stayed in `awaiting-rekey-init`": had the served frame reset the state
      // to `transport`, the client's noise_init would route to handleReconnect, whose decodeEnvelope
      // over the rekey's EMPTY early-data throws (fakeDaemon.ts:336-337) → handshake-read-failed +
      // close → no resume frame at all.
      await client.waiter.wait(() => client.events.some((e) => e.type === 'message'))
      const resume = client.events.find((e) => e.type === 'message')
      expect(resume, 'the post-swap resume frame must arrive under the new keys').toBeDefined()
      expect(bytes((resume as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(DEFAULT_REKEY_RESUME_MESSAGE))
      expect(client.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)
      expect(client.events.some((e) => e.type === 'error')).toBe(false)

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('fails an undecryptable frame inside the rekey window via the transport path (#524, AC4)', async () => {
    const { forwarderUrl, whenReady, daemon } = await standUp()
    const client = await driveClient({
      forwarderUrl,
      remoteStaticPublicKey: daemon.staticPublicKey,
      hello: buildTestHello()
    })
    await whenReady()
    await client.waiter.wait(() => client.events.some((e) => e.type === 'handshake-complete'))

    // No baseline round-trip — see the interleave test: settle() is first-wins, so a baseline would
    // swallow the reason this test asserts.
    client.holdInbound()
    daemon.initiateRekey()
    await client.waiter.wait(() => client.held.length >= 1)

    // Garbage tagged `noise_msg`, sent past the initiator's ciphers so it is neither a valid
    // noise_init nor decryptable under the daemon's current recv cipher.
    client.sendRaw(new Uint8Array(48).fill(0x33))

    // Must-fail-first: under state-based routing the reason is handshake-read-failed.
    expect(await daemon.whenSettled()).toEqual({ ok: false, reason: 'transport-decrypt-failed' })

    // And no reply: handleTransport's catch returns before sealing anything. Not vacuous — the
    // interleave test above uses the identical gate and DOES capture a served reply as held[1].
    await client.waiter.wait(() => client.held.length >= 2, 300)
    expect(client.held).toHaveLength(1)
  })

  it('decrypts a daemon frame interleaved into the CLIENT rekey window, then completes the swap (#532, AC1/AC2/AC3)', async () => {
    // The mirror of the #524 test above: there the daemon's rekey window had to keep serving, here
    // the CLIENT's window has to keep receiving. This is the whole production stack — real codec,
    // real socket, real createNoiseSession — so it is the end-to-end proof that the inner-frame tag
    // survives the wire and reaches the session's routing decision.
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const { forwarderUrl, whenReady, daemon } = await standUp()
      const client = await driveClient({
        forwarderUrl,
        remoteStaticPublicKey: daemon.staticPublicKey,
        hello: buildTestHello()
      })
      await whenReady()
      await client.waiter.wait(() => client.events.some((e) => e.type === 'handshake-complete'))

      // Deliberately NO baseline round-trip: settle() is first-wins, so a baseline { ok: true }
      // would swallow any later daemon-side failure reason (the #524 tests' rationale, unchanged).

      // Hold both daemon frames at the relay boundary so the TEST, not the wire, fixes their
      // ordering against the client's state. The client stays in `transport` while both are captured.
      client.holdInbound()
      daemon.initiateRekey() // held[0] — the sealed `rekey_request`
      await client.waiter.wait(() => client.held.length >= 1)

      // The interleaved app frame: the daemon fans it out DURING its own rekey window, sealed under
      // the still-live old send cipher and tagged `noise_msg` (pushFrame, now permitted in
      // `awaiting-rekey-init`). Nonce-lockstep forbids sealing it earlier and delivering it late, so
      // it has to be produced here.
      const interleaved = encodeEnvelope({
        id: 55,
        type: 'message',
        ts: '2026-01-01T00:00:11Z',
        payload: {
          conversation_id: 'c1',
          message_id: 'interleaved-1',
          role: 'assistant',
          text: 'fanned out before the rekey noise_init landed'
        }
      })
      daemon.pushFrame(interleaved) // held[1]
      await client.waiter.wait(() => client.held.length >= 2)
      expect(client.held, 'the fake must serve a pushFrame inside its own rekey window').toHaveLength(2)

      // Release, then deliver both held frames in ONE synchronous turn: the daemon's rekey msg2 is a
      // full network round-trip away, so it cannot land between them. deliverHeld(0) parks the client
      // in `awaiting-rekey-reply` (its `noise_init` goes out in flight); deliverHeld(1) is then the
      // interleaved frame arriving in exactly the window this ticket is about.
      client.resumeInbound()
      client.deliverHeld(0)
      client.deliverHeld(1)

      // AC1 — the must-fail-first assertion. Pre-#532 the client consumes held[1] as its handshake
      // reply, ReadMessage MAC-fails, and this surfaces `error{handshake-read-failed}` and zero
      // messages instead.
      const inWindow = client.events.filter((e) => e.type === 'message')
      expect(inWindow).toHaveLength(1)
      expect(bytes((inWindow[0] as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(interleaved))

      // AC2: the genuine `noise_resp` reply still drives the swap — proven by the post-swap resume
      // frame, which only the client's NEW recv cipher can open.
      await client.waiter.wait(() => client.events.filter((e) => e.type === 'message').length >= 2)
      const resume = client.events.filter((e) => e.type === 'message')[1]
      expect(bytes((resume as { plaintext: Uint8Array }).plaintext)).toEqual(
        bytes(DEFAULT_REKEY_RESUME_MESSAGE)
      )

      // …and the other direction under K1: the client's send opens under the daemon's new recv
      // cipher and the echo comes back sealed under the new send cipher.
      const probe = encodeEnvelope({
        id: 3,
        type: 'send_message',
        ts: '2026-01-01T00:00:12Z',
        payload: { conversation_id: 'c1', message_id: 'm2', text: 'k1 probe' }
      })
      client.initiator.sendMessage(probe)
      await client.waiter.wait(() => client.events.filter((e) => e.type === 'message').length >= 3)
      const echo = client.events.filter((e) => e.type === 'message')[2]
      expect(bytes((echo as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(probe))

      // AC3: no error of any reason reached the client, and the daemon never classified a failure.
      expect(client.events.some((e) => e.type === 'error')).toBe(false)
      expect(client.events.filter((e) => e.type === 'rekey-requested')).toHaveLength(1)
      expect(await daemon.whenSettled()).toEqual({ ok: true })

      // The ordered tag sequence across the whole interleave (#525's oracle): the initial IK msg2,
      // the `rekey_request`, the interleaved app frame, the rekey msg2, the resume frame, the K1
      // echo. Only the two handshake replies are `noise_resp`. Whole-array equality catches a
      // handshake site regressing to `noise_msg` AND a transport site wrongly becoming `noise_resp`
      // in one assertion — and element 2 is precisely the tag the client's window routing reads.
      expect(client.inboundTypes).toEqual([
        'noise_resp',
        'noise_msg',
        'noise_msg',
        'noise_resp',
        'noise_msg',
        'noise_msg'
      ])

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('survives a client drop and runs a fresh responder handshake on the reconnect noise_init (#416, AC2/AC3/AC4)', async () => {
    // The whole reconnect path — fresh responder handshake + the sealed re-send — under console spies:
    // the fake must not leak transcript bytes across a reconnect any more than across the initial connect.
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      // A canned server-pushed frame: used BOTH as the mid-session pushFrame payload (AC3, server-
      // initiated push) and as the reconnectResendFrames re-send after the reconnect handshake.
      const canned = encodeEnvelope({
        id: 7,
        type: 'message',
        ts: '2026-01-01T00:00:07Z',
        payload: { conversation_id: 'c1', message_id: 'pushed-1', role: 'assistant', text: 'server push' }
      })
      const { forwarder, forwarderUrl, whenReady, daemon } = await standUp({ reconnectResendFrames: [canned] })
      const hello = buildTestHello()
      const first = await driveClient({
        forwarderUrl,
        remoteStaticPublicKey: daemon.staticPublicKey,
        hello
      })
      await whenReady()

      // Initial handshake + one K0 round-trip (default echo) — the pre-reconnect baseline.
      await first.waiter.wait(() => first.events.some((e) => e.type === 'handshake-complete'))
      const probe0 = encodeEnvelope({
        id: 2,
        type: 'send_message',
        ts: '2026-01-01T00:00:01Z',
        payload: { conversation_id: 'c1', message_id: 'm1', text: 'k0 probe' }
      })
      first.initiator.sendMessage(probe0)
      await first.waiter.wait(() => first.events.filter((e) => e.type === 'message').length >= 1)

      // AC3: a server-initiated push mid-session — pushFrame seals `canned` under the CURRENT send
      // cipher and streams it, arriving as a `message` with no client request.
      daemon.pushFrame(canned)
      await first.waiter.wait(() => first.events.filter((e) => e.type === 'message').length >= 2)
      const pushed = first.events.filter((e) => e.type === 'message')[1]
      expect(bytes((pushed as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(canned))

      // Outbound tagging on the first leg (#525): the initial IK msg2, then the K0 reply and the
      // server-initiated push — neither of the latter a handshake reply.
      expect(first.inboundTypes).toEqual(['noise_resp', 'noise_msg', 'noise_msg'])

      // AC1: drop the client leg. The forwarder nulls it on close so a fresh /v1/client dial re-splices
      // to the still-connected server leg (the daemon), instead of being terminated.
      forwarder.dropClientLeg()

      // A fresh initiator re-dials with the SAME device static + hello. Its first outbound is tagged
      // noise_init, so the transport-state daemon routes it to handleReconnect — a fresh RESPONDER
      // handshake reusing the same static. driveClient's built-in transient re-dial converges past the
      // old leg's close (a raced dial that lands before the close is nulled is retried).
      const second = await driveClient({
        forwarderUrl,
        remoteStaticPublicKey: daemon.staticPublicKey,
        hello,
        clientPrivateKey: first.clientPrivateKey
      })

      // AC2: the reconnect handshake completes with the SAME hello_ack the initial handshake sealed —
      // proving a faithful fresh responder handshake, not a MAC-failed transport frame.
      await second.waiter.wait(() => second.events.some((e) => e.type === 'handshake-complete'))
      const complete2 = second.events.find((e) => e.type === 'handshake-complete')
      expect(complete2, 'the reconnect noise_init must drive a fresh responder handshake').toBeDefined()
      expect(parseHelloAck((complete2 as { helloAck: Uint8Array }).helloAck)).toEqual({
        protocol_version: 'v2',
        server_id: 'fake-daemon',
        conn_id: 'conn-1',
        capabilities: []
      })

      // AC3: reconnectResendFrames streams `canned` sealed under the NEW send cipher, right after the
      // reconnect hello_ack — the fresh session receives it as a `message`.
      await second.waiter.wait(() => second.events.some((e) => e.type === 'message'))
      const resent = second.events.find((e) => e.type === 'message')
      expect(bytes((resent as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(canned))

      // A post-reconnect round-trip under the NEW keys: the client's send opens under the daemon's new
      // recv cipher and the echoed reply comes back under the new send cipher (the crossed-Split oracle).
      const probe1 = encodeEnvelope({
        id: 3,
        type: 'send_message',
        ts: '2026-01-01T00:00:02Z',
        payload: { conversation_id: 'c1', message_id: 'm2', text: 'post-reconnect probe' }
      })
      second.initiator.sendMessage(probe1)
      await second.waiter.wait(() => second.events.filter((e) => e.type === 'message').length >= 2)
      const reply1 = second.events.filter((e) => e.type === 'message')[1]
      expect(bytes((reply1 as { plaintext: Uint8Array }).plaintext)).toEqual(bytes(probe1))

      // Outbound tagging on the reconnect leg (#525): the reconnect msg2 is a handshake reply, while
      // the re-sent frame and the post-reconnect echo are ordinary transport.
      expect(second.inboundTypes).toEqual(['noise_resp', 'noise_msg', 'noise_msg'])

      // No client error across either leg (no transport-decrypt-failed → the reconnect cipher mapping
      // is correct), and the fake stayed log-free across the whole reconnect path.
      expect(first.events.some((e) => e.type === 'error')).toBe(false)
      expect(second.events.some((e) => e.type === 'error')).toBe(false)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('drives the full handshake + transport + a client error path with zero console output (security)', async () => {
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const { forwarderUrl, whenReady, daemon } = await standUp()
      const { initiator, events, waiter } = await driveClient({
        forwarderUrl,
        remoteStaticPublicKey: daemon.staticPublicKey,
        hello: buildTestHello()
      })
      await whenReady()
      await waiter.wait(() => events.some((e) => e.type === 'handshake-complete'))
      initiator.sendMessage(encodeEnvelope({ id: 5, type: 'send_message', ts: '2026-01-01T00:00:05Z', payload: { conversation_id: 'c1', message_id: 'm5', text: 'log-free probe' } }))
      await waiter.wait(() => events.some((e) => e.type === 'message'))
      // Exercise the client error path too — a garbage transport frame must classify without logging.
      initiator.onFrame(new Uint8Array(48).fill(0x33))
      await waiter.wait(() => events.some((e) => e.type === 'error'), 500)
      expect(await daemon.whenSettled()).toEqual({ ok: true })
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('fail-closes a non-InnerFrameV2 frame at the leg boundary to frame-decode-failed (security)', async () => {
    const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const forwarder = await startFakeRelayForwarder()
      cleanups.push(() => forwarder.close())
      const daemon = await startFakeDaemon({ url: forwarder.url })
      cleanups.push(() => daemon.close())

      // A raw ws on the client leg keeps this at the byte level, without a full Noise initiator.
      // Bounded transient re-dial (connect): a raw dial has no createRelayConnection
      // unexpected-response handler, so the pre-open 404-upgrade race (#336) surfaces here as a raw
      // throw and is recovered by re-dial rather than crashing the test.
      const raw = await connect(`${forwarder.url}/v1/client`)
      cleanups.push(() => raw.terminate())
      await forwarder.whenReady()
      raw.send('{not json') // a non-InnerFrameV2 text frame

      expect(await daemon.whenSettled()).toEqual({ ok: false, reason: 'frame-decode-failed' })
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('close() is idempotent and settles a pre-completion close as closed', async () => {
    const forwarder = await startFakeRelayForwarder()
    cleanups.push(() => forwarder.close())
    const daemon = await startFakeDaemon({ url: forwarder.url })

    const p1 = daemon.close()
    const p2 = daemon.close()
    await expect(p1).resolves.toBeUndefined()
    await expect(p2).resolves.toBeUndefined()
    expect(await daemon.whenSettled()).toEqual({ ok: false, reason: 'closed' })
  })
})
