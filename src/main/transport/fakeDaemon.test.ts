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
import { startFakeRelayForwarder } from './fakeRelayForwarder'
import {
  startFakeDaemon,
  DEFAULT_REKEY_RESUME_MESSAGE,
  type FakeDaemon,
  type FakeDaemonOptions
} from './fakeDaemon'
import { createNoiseSession, type NoiseSession, type NoiseSessionEvent } from './noiseSession'
import { createRelayConnection, type RelayEvent } from './relayConnection'
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
}): Promise<{ initiator: NoiseSession; events: NoiseSessionEvent[]; waiter: ReturnType<typeof makeWaiter> }> {
  const lib = await loadNoiseLib()
  const [clientPriv] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519) // fresh in-process static
  const events: NoiseSessionEvent[] = []
  const waiter = makeWaiter()
  let firstOut = true
  let initiator!: NoiseSession

  const relay = createRelayConnection({
    url: `${opts.forwarderUrl}/v1/client`,
    headers: {
      'X-Pyrycode-Server': 'fake-daemon',
      'X-Pyrycode-Token': 'dummy-fakedaemon-token-not-a-real-credential',
      'User-Agent': 'pyrycode-desktop-fakedaemon-test/0'
    },
    onEvent: (e: RelayEvent) => {
      if (e.type === 'connected') initiator.start()
      else if (e.type === 'message') {
        try {
          const { data } = decodeInnerFrame(e.frame)
          initiator.onFrame(base64StdDecode(data))
        } catch {
          /* fail-closed on a malformed frame; the bounded wait converts it to a timeout */
        }
      }
    }
  })
  cleanups.push(() => relay.close())

  initiator = await createNoiseSession({
    staticPrivateKey: clientPriv,
    remoteStaticPublicKey: opts.remoteStaticPublicKey,
    prologue: EMPTY,
    hello: opts.hello,
    // Tag the first outbound frame noise_init, the rest noise_msg; base64-std the raw Noise bytes
    // into an InnerFrameV2 at the relay boundary (the codec, composed unchanged).
    sendFrame: (raw) => {
      const type = firstOut ? 'noise_init' : 'noise_msg'
      firstOut = false
      relay.send(encodeInnerFrame({ v: 2, type, data: base64StdEncode(raw) }))
    },
    onEvent: (e) => {
      events.push(e)
      waiter.notify()
    }
  })
  cleanups.push(() => initiator.close())
  return { initiator, events, waiter }
}

/** Stand up a forwarder + fake daemon pair, registering teardown. */
async function standUp(daemonOpts?: Omit<FakeDaemonOptions, 'url'>): Promise<{
  forwarderUrl: string
  whenReady: () => Promise<void>
  daemon: FakeDaemon
}> {
  const forwarder = await startFakeRelayForwarder()
  cleanups.push(() => forwarder.close())
  const daemon = await startFakeDaemon({ url: forwarder.url, ...daemonOpts })
  cleanups.push(() => daemon.close())
  return { forwarderUrl: forwarder.url, whenReady: () => forwarder.whenReady(), daemon }
}

describe('in-process Noise_IK fake daemon round-trip', () => {
  it('completes the handshake and one sealed round-trip through the forwarder (AC1–AC6)', async () => {
    const { forwarderUrl, whenReady, daemon } = await standUp()
    const hello = buildTestHello()
    const { initiator, events, waiter } = await driveClient({
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

  it('initiates a rekey: the real client swaps and resumes messaging under the new keys (AC2, AC3)', async () => {
    const { forwarderUrl, whenReady, daemon } = await standUp()
    const { initiator, events, waiter } = await driveClient({
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
      const raw = new WebSocket(`${forwarder.url}/v1/client`)
      cleanups.push(() => raw.terminate())
      await new Promise<void>((resolve, reject) => {
        raw.once('open', () => resolve())
        raw.once('error', reject)
      })
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
