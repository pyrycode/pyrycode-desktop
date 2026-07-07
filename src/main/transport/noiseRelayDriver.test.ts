import { describe, it, expect, vi } from 'vitest'
import {
  createNoiseRelayDriver,
  MAX_PENDING_FRAMES,
  type RelaySessionEvent,
  type SessionMaterial,
  type DialConfigProvider
} from './noiseRelayDriver'
import {
  DEFAULT_FATAL_CLOSE_CODES,
  type RelaySupervisorConfig,
  type RelaySupervisor,
  type RelaySupervisorEvent
} from './relaySupervisor'
import { RelayNotConnectedError } from './relayConnection'
import {
  type NoiseSession,
  type NoiseSessionConfig,
  type NoiseSessionEvent
} from './noiseSession'
import { base64StdEncode, encodeInnerFrame, decodeInnerFrame } from './codec'

// The driver is a pure in-process composition adapter, so its tests inject fakes at the two I/O
// boundaries only — a fake supervisor factory (drive `connected`/`message`/`terminal` in) and a
// fake async session factory (a scripted NoiseSession) — while using the REAL #5 codec so the
// assertions pin actual wire bytes (`noise_init`/`noise_msg` tagging, base64-std framing). This
// mirrors relaySupervisor.test.ts's injected-fake idiom one layer up.

// --- fake async session factory ------------------------------------------------------------
// Captures the NoiseSessionConfig the driver builds, records the lifecycle call order (so the
// async-create-gap ordering is assertable), and lets the test drive the session by calling the
// captured `config.sendFrame` / `config.onEvent`.
const FAKE_MSG1 = new Uint8Array([0x11, 0x12, 0x13]) // the handshake message-1 bytes start() emits
const FAKE_SEALED = new Uint8Array([0x21, 0x22, 0x23]) // the sealed bytes sendMessage() emits

interface FakeSession {
  config: NoiseSessionConfig
  calls: string[]
  received: Uint8Array[]
  closed: boolean
  handle: NoiseSession
}

function makeFakeSession(config: NoiseSessionConfig, sealed: Uint8Array): FakeSession {
  const fake: FakeSession = {
    config,
    calls: [],
    received: [],
    closed: false,
    handle: {
      start() {
        fake.calls.push('start')
        config.sendFrame(FAKE_MSG1) // msg 1 → the driver tags it noise_init
      },
      onFrame(frame) {
        fake.calls.push('onFrame')
        fake.received.push(frame)
      },
      sendMessage() {
        fake.calls.push('sendMessage')
        config.sendFrame(sealed) // → the driver tags it noise_msg
      },
      close() {
        fake.calls.push('close')
        fake.closed = true
      }
    }
  }
  return fake
}

/** A factory that resolves each createSession synchronously (one microtask hop). */
function resolvedSessionFactory(opts: { sealed?: Uint8Array } = {}): {
  createSession: (config: NoiseSessionConfig) => Promise<NoiseSession>
  sessions: FakeSession[]
} {
  const sessions: FakeSession[] = []
  return {
    sessions,
    createSession(config) {
      const fake = makeFakeSession(config, opts.sealed ?? FAKE_SEALED)
      sessions.push(fake)
      return Promise.resolve(fake.handle)
    }
  }
}

/** A factory that defers each createSession until the test resolves it — exercises the gap. */
function deferredSessionFactory(): {
  createSession: (config: NoiseSessionConfig) => Promise<NoiseSession>
  sessions: FakeSession[]
  resolveNext: () => void
} {
  const sessions: FakeSession[] = []
  const resolvers: Array<() => void> = []
  return {
    sessions,
    createSession(config) {
      const fake = makeFakeSession(config, FAKE_SEALED)
      sessions.push(fake)
      return new Promise<NoiseSession>((resolve) => {
        resolvers.push(() => resolve(fake.handle))
      })
    },
    resolveNext() {
      const next = resolvers.shift()
      if (!next) throw new Error('no pending createSession to resolve')
      next()
    }
  }
}

/** A factory whose createSession always rejects (wasm load failure / timeout surface). */
function rejectingSessionFactory(): (config: NoiseSessionConfig) => Promise<NoiseSession> {
  return () => Promise.reject(new Error('wasm load failed — MUST NOT reach the sink'))
}

// --- fake supervisor factory ---------------------------------------------------------------
// Captures the RelaySupervisorConfig, records the encoded inner frames the driver sends (always
// strings), and exposes `emit` to drive supervisor events into the driver's handler. `send` can
// be flipped to throw RelayNotConnectedError to exercise the outbound-failure boundary.
interface FakeSupervisor {
  config: RelaySupervisorConfig
  sent: string[]
  stopCalls: number
  throwOnSend: boolean
  emit: (event: RelaySupervisorEvent) => void
  handle: RelaySupervisor
}

function fakeSupervisorFactory(): {
  createSupervisor: (config: RelaySupervisorConfig) => RelaySupervisor
  supervisors: FakeSupervisor[]
} {
  const supervisors: FakeSupervisor[] = []
  return {
    supervisors,
    createSupervisor(config) {
      const fake: FakeSupervisor = {
        config,
        sent: [],
        stopCalls: 0,
        throwOnSend: false,
        emit: (event) => config.onEvent(event),
        handle: {
          send(frame) {
            if (fake.throwOnSend) throw new RelayNotConnectedError()
            fake.sent.push(frame as string)
          },
          stop() {
            fake.stopCalls++
            // The real supervisor emits terminal exactly once, guarded — mirror that here.
            if (fake.stopCalls === 1) config.onEvent({ type: 'terminal', code: 1000, reason: 'stopped' })
          }
        }
      }
      supervisors.push(fake)
      return fake.handle
    }
  }
}

function makeSink(): { events: RelaySessionEvent[]; onEvent: (event: RelaySessionEvent) => void } {
  const events: RelaySessionEvent[] = []
  return { events, onEvent: (event) => void events.push(event) }
}

const errorsOf = (events: RelaySessionEvent[]) => events.filter((e) => e.type === 'error')
const terminalsOf = (events: RelaySessionEvent[]) => events.filter((e) => e.type === 'terminal')

const SESSION_MATERIAL: SessionMaterial = {
  staticPrivateKey: new Uint8Array(32).fill(0xaa),
  remoteStaticPublicKey: new Uint8Array(32).fill(0xbb),
  prologue: new Uint8Array(0),
  hello: new TextEncoder().encode('hello-early-data')
}

// A distinct record's session material — what a re-pair mid-session would reload (#83).
const SESSION_B: SessionMaterial = {
  staticPrivateKey: new Uint8Array(32).fill(0xcc),
  remoteStaticPublicKey: new Uint8Array(32).fill(0xdd),
  prologue: new Uint8Array(0),
  hello: new TextEncoder().encode('hello-early-data-B')
}

function setup(opts: {
  createSession: (config: NoiseSessionConfig) => Promise<NoiseSession>
  fatalCloseCodes?: ReadonlySet<number>
  loadDialConfig?: DialConfigProvider
}): {
  driver: ReturnType<typeof createNoiseRelayDriver>
  sink: ReturnType<typeof makeSink>
  supervisor: () => FakeSupervisor
} {
  const supFactory = fakeSupervisorFactory()
  const sink = makeSink()
  const driver = createNoiseRelayDriver({
    connection: { url: 'ws://relay.test', headers: {} },
    session: SESSION_MATERIAL,
    onEvent: sink.onEvent,
    fatalCloseCodes: opts.fatalCloseCodes,
    loadDialConfig: opts.loadDialConfig,
    createSupervisor: supFactory.createSupervisor,
    createSession: opts.createSession
  })
  return { driver, sink, supervisor: () => supFactory.supervisors[0] }
}

// Flush the microtask queue (the createSession promise's .then/.catch). The driver owns no
// timers, so a single macrotask turn drains every pending microtask deterministically.
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Wrap raw Noise bytes into the on-the-wire inner-frame bytes the supervisor would deliver. */
const wrapInbound = (type: string, raw: Uint8Array): Uint8Array =>
  new TextEncoder().encode(encodeInnerFrame({ v: 2, type, data: base64StdEncode(raw) }))

/** Decode an inner frame the driver sent (a string) back through the real codec. */
const decodeSent = (sent: string) => decodeInnerFrame(new TextEncoder().encode(sent))

describe('createNoiseRelayDriver', () => {
  it('drives the connect → handshake → transport happy path (AC1/AC2/AC3)', async () => {
    const factory = resolvedSessionFactory()
    const { driver, sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()

    // A session was created with the injected key material + hello, and started.
    expect(factory.sessions).toHaveLength(1)
    const session = factory.sessions[0]
    expect(session.config.staticPrivateKey).toBe(SESSION_MATERIAL.staticPrivateKey)
    expect(session.config.remoteStaticPublicKey).toBe(SESSION_MATERIAL.remoteStaticPublicKey)
    expect(session.config.hello).toBe(SESSION_MATERIAL.hello)
    expect(session.config.prologue).toBe(SESSION_MATERIAL.prologue)
    expect(session.calls).toContain('start')

    // Message 1 went out tagged noise_init, base64-std wrapped.
    expect(supervisor().sent).toHaveLength(1)
    expect(decodeSent(supervisor().sent[0])).toEqual({
      v: 2,
      type: 'noise_init',
      data: base64StdEncode(FAKE_MSG1)
    })

    // The session's handshake-complete forwards through the sink.
    const helloAck = new Uint8Array([0x31, 0x32])
    session.config.onEvent({ type: 'handshake-complete', helloAck })
    expect(sink.events).toContainEqual({ type: 'handshake-complete', helloAck })

    // A post-handshake app message is tagged noise_msg (the first-frame flag has flipped).
    driver.sendMessage(new Uint8Array([0x41]))
    expect(supervisor().sent).toHaveLength(2)
    expect(decodeSent(supervisor().sent[1])).toEqual({
      v: 2,
      type: 'noise_msg',
      data: base64StdEncode(FAKE_SEALED)
    })

    // An inbound frame is decoded and its raw Noise bytes fed to the session verbatim.
    const inboundRaw = new Uint8Array([0x51, 0x52, 0x53])
    supervisor().emit({ type: 'message', frame: wrapInbound('noise_msg', inboundRaw) })
    expect(session.received).toHaveLength(1)
    expect(session.received[0]).toEqual(inboundRaw)

    // The session's decrypted message forwards through the sink.
    const plaintext = new Uint8Array([0x61, 0x62])
    session.config.onEvent({ type: 'message', plaintext })
    expect(sink.events).toContainEqual({ type: 'message', plaintext })
  })

  it('re-arms noise_init for the rekey msg1 driven by the session emit-then-send (AC1)', async () => {
    const factory = resolvedSessionFactory()
    const { driver, sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    const session = factory.sessions[0]

    // Baseline: the connection's first frame (msg 1) is noise_init.
    expect(decodeSent(supervisor().sent[0]).type).toBe('noise_init')

    // Handshake completes; a post-handshake app message is noise_msg.
    session.config.onEvent({ type: 'handshake-complete', helloAck: new Uint8Array([1]) })
    driver.sendMessage(new Uint8Array([0x41]))
    expect(decodeSent(supervisor().sent[1]).type).toBe('noise_msg')

    // Drive the rekey exactly as the real session does within one onFrame turn: emit the
    // rekey-requested trigger, THEN hand the fresh handshake msg1 to sendFrame.
    const FAKE_REKEY_MSG1 = new Uint8Array([0x55, 0x56, 0x57])
    const beforeTrigger = sink.events.length
    session.config.onEvent({ type: 'rekey-requested' })
    // The trigger is not propagated to the sink (RelaySessionEvent has no such member).
    expect(sink.events).toHaveLength(beforeTrigger)
    session.config.sendFrame(FAKE_REKEY_MSG1)

    // The rekey msg1 goes out tagged noise_init — so the real daemon routes it to its rekey
    // responder rather than transport-decrypting the raw handshake bytes (WS 4421).
    expect(supervisor().sent).toHaveLength(3)
    expect(decodeSent(supervisor().sent[2])).toEqual({
      v: 2,
      type: 'noise_init',
      data: base64StdEncode(FAKE_REKEY_MSG1)
    })

    // The latch is one-shot: a following app message is noise_msg again.
    driver.sendMessage(new Uint8Array([0x42]))
    expect(supervisor().sent).toHaveLength(4)
    expect(decodeSent(supervisor().sent[3]).type).toBe('noise_msg')
  })

  it('re-handshakes on reconnect with no leaked state (AC4)', async () => {
    const factory = resolvedSessionFactory()
    const { sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    const sessionA = factory.sessions[0]
    sessionA.config.onEvent({ type: 'handshake-complete', helloAck: new Uint8Array([1]) })

    // Second connect: session A is closed, a distinct session B is created and started.
    supervisor().emit({ type: 'connected' })
    await tick()
    expect(factory.sessions).toHaveLength(2)
    const sessionB = factory.sessions[1]
    expect(sessionB).not.toBe(sessionA)
    expect(sessionA.closed).toBe(true)
    expect(sessionB.calls).toContain('start')

    // B's first frame is tagged noise_init again — the per-connection first-frame flag reset.
    expect(supervisor().sent).toHaveLength(2)
    expect(decodeSent(supervisor().sent[1]).type).toBe('noise_init')

    // A subsequent inbound frame routes to B, never the closed A.
    const inboundRaw = new Uint8Array([0x71])
    supervisor().emit({ type: 'message', frame: wrapInbound('noise_msg', inboundRaw) })
    expect(sessionB.received).toEqual([inboundRaw])
    expect(sessionA.received).toEqual([])

    // No stray events leaked from the superseded session A.
    expect(sink.events.filter((e) => e.type === 'handshake-complete')).toHaveLength(1)
  })

  it.each([4426, 4421, 4401])('surfaces terminal{%i} and tears the session down (AC3)', async (code) => {
    const factory = resolvedSessionFactory()
    const { driver, sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    const session = factory.sessions[0]
    session.config.onEvent({ type: 'handshake-complete', helloAck: new Uint8Array([1]) })

    supervisor().emit({ type: 'terminal', code, reason: 'fatal' })
    expect(sink.events).toContainEqual({ type: 'terminal', code, reason: 'fatal' })
    expect(session.closed).toBe(true)

    // sendMessage is inert after terminal — no new outbound frame.
    const sentBefore = supervisor().sent.length
    driver.sendMessage(new Uint8Array([0x99]))
    expect(supervisor().sent).toHaveLength(sentBefore)
  })

  it('forwards a session error without treating it as terminal (AC3)', async () => {
    const factory = resolvedSessionFactory()
    const { sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    factory.sessions[0].config.onEvent({ type: 'error', reason: 'transport-decrypt-failed' })

    expect(sink.events).toContainEqual({ type: 'error', reason: 'transport-decrypt-failed' })
    expect(terminalsOf(sink.events)).toHaveLength(0)
  })

  it('fails closed on a malformed inbound frame — the session never sees it', async () => {
    const factory = resolvedSessionFactory()
    const { sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    const session = factory.sessions[0]

    supervisor().emit({ type: 'message', frame: new TextEncoder().encode('not-an-inner-frame{') })
    expect(session.received).toEqual([])
    expect(errorsOf(sink.events)).toContainEqual({ type: 'error', reason: 'inbound-frame-decode-failed' })
  })

  it('surfaces an outbound over-cap failure without throwing back into the session', async () => {
    // A sealed frame whose base64-std wrap exceeds MAX_FRAME_BYTES (256 KiB) so encodeInnerFrame throws.
    const overCap = new Uint8Array(200_000).fill(0x7f)
    const factory = resolvedSessionFactory({ sealed: overCap })
    const { driver, sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    factory.sessions[0].config.onEvent({ type: 'handshake-complete', helloAck: new Uint8Array([1]) })

    expect(() => driver.sendMessage(new Uint8Array([1]))).not.toThrow()
    expect(errorsOf(sink.events)).toContainEqual({ type: 'error', reason: 'outbound-frame-encode-failed' })
  })

  it('surfaces an outbound send failure (not connected) without throwing back into the session', async () => {
    const factory = resolvedSessionFactory()
    const { driver, sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    factory.sessions[0].config.onEvent({ type: 'handshake-complete', helloAck: new Uint8Array([1]) })
    supervisor().throwOnSend = true

    expect(() => driver.sendMessage(new Uint8Array([1]))).not.toThrow()
    expect(errorsOf(sink.events)).toContainEqual({ type: 'error', reason: 'outbound-frame-encode-failed' })
  })

  it('buffers frames during the async-create gap and replays them after start() (ordering)', async () => {
    const factory = deferredSessionFactory()
    const { supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' }) // create is pending — no session installed yet
    const bufferedRaw = new Uint8Array([0x81, 0x82])
    supervisor().emit({ type: 'message', frame: wrapInbound('noise_init', bufferedRaw) })

    factory.resolveNext()
    await tick()

    const session = factory.sessions[0]
    // start() (msg 1 out) ran BEFORE the buffered frame replayed to onFrame — order preserved.
    expect(session.calls).toEqual(['start', 'onFrame'])
    expect(session.received).toEqual([bufferedRaw])
  })

  it('bounds the pending buffer during the async-create gap (security)', async () => {
    const factory = deferredSessionFactory()
    const { supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    const overflow = MAX_PENDING_FRAMES + 4
    for (let i = 0; i < overflow; i++) {
      supervisor().emit({ type: 'message', frame: wrapInbound('noise_msg', new Uint8Array([i])) })
    }

    factory.resolveNext()
    await tick()

    // Only up to the cap replayed; the excess was dropped fail-safe.
    expect(factory.sessions[0].received).toHaveLength(MAX_PENDING_FRAMES)
  })

  it('tears down on stop() and is idempotent (AC4-adjacent)', async () => {
    const factory = resolvedSessionFactory()
    const { driver, sink, supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    const session = factory.sessions[0]
    session.config.onEvent({ type: 'handshake-complete', helloAck: new Uint8Array([1]) })

    driver.stop()
    expect(supervisor().stopCalls).toBe(1)
    expect(sink.events).toContainEqual({ type: 'terminal', code: 1000, reason: 'stopped' })
    expect(session.closed).toBe(true)

    driver.stop()
    expect(terminalsOf(sink.events)).toHaveLength(1)
  })

  it('surfaces session-load-failed when createSession rejects, gen-guarded', async () => {
    const { sink, supervisor } = setup({ createSession: rejectingSessionFactory() })

    supervisor().emit({ type: 'connected' })
    await tick()

    expect(errorsOf(sink.events)).toContainEqual({ type: 'error', reason: 'session-load-failed' })
  })

  it('drops a session-load-failed error when the generation has already moved on', async () => {
    const rejectors: Array<() => void> = []
    // A factory that defers a rejection so a terminal can supersede it before it settles.
    const createSession = (): Promise<NoiseSession> =>
      new Promise<NoiseSession>((_resolve, reject) => {
        rejectors.push(() => reject(new Error('load failed')))
      })
    const { sink, supervisor } = setup({ createSession })

    supervisor().emit({ type: 'connected' }) // create pending
    supervisor().emit({ type: 'terminal', code: 4426, reason: 'fatal' }) // supersedes the generation
    rejectors[0]()
    await tick()

    // The stale rejection is gen-guarded — no session-load-failed reaches the sink.
    expect(errorsOf(sink.events).some((e) => e.type === 'error' && e.reason === 'session-load-failed')).toBe(false)
  })

  it('defaults fatalCloseCodes to DEFAULT_FATAL_CLOSE_CODES on the supervisor it constructs', () => {
    const factory = resolvedSessionFactory()
    const { supervisor } = setup({ createSession: factory.createSession })
    // The driver passes its (undefined) fatalCloseCodes straight through; the supervisor applies
    // the default. Constructing with no override leaves the config's field undefined by design.
    expect(supervisor().config.fatalCloseCodes).toBeUndefined()
    expect(DEFAULT_FATAL_CLOSE_CODES.has(4426)).toBe(true)
  })

  // #83 — reload the session material on an automatic reconnect. The driver's resolveConnection
  // wrapper is the single per-dial load(); it feeds the supervisor's connection AND stashes the
  // session for the next onConnected, so headers and key come from the same fresh record snapshot.
  it('reloads the session material on reconnect when loadDialConfig is set (AC2)', async () => {
    const factory = resolvedSessionFactory()
    const loadDialConfig: DialConfigProvider = () =>
      Promise.resolve({ connection: { url: 'ws://relay-b.test', headers: {} }, session: SESSION_B })
    const { supervisor } = setup({ createSession: factory.createSession, loadDialConfig })

    // First connect uses the construction-time config.session (the firstConnect gate).
    supervisor().emit({ type: 'connected' })
    await tick()
    expect(factory.sessions[0].config.remoteStaticPublicKey).toBe(SESSION_MATERIAL.remoteStaticPublicKey)

    // Simulate the supervisor's pre-re-dial reload, then the resulting reconnect.
    await supervisor().config.resolveConnection?.()
    supervisor().emit({ type: 'connected' })
    await tick()

    expect(factory.sessions).toHaveLength(2)
    expect(factory.sessions[1].config.remoteStaticPublicKey).toBe(SESSION_B.remoteStaticPublicKey)
    expect(factory.sessions[1].config.hello).toBe(SESSION_B.hello)
  })

  it('uses config.session on the first connect even when loadDialConfig is present (firstConnect gate)', async () => {
    const factory = resolvedSessionFactory()
    const loadDialConfig: DialConfigProvider = () =>
      Promise.resolve({ connection: { url: 'ws://relay-b.test', headers: {} }, session: SESSION_B })
    const { supervisor } = setup({ createSession: factory.createSession, loadDialConfig })

    supervisor().emit({ type: 'connected' })
    await tick()

    expect(factory.sessions[0].config.remoteStaticPublicKey).toBe(SESSION_MATERIAL.remoteStaticPublicKey)
    expect(factory.sessions[0].config.hello).toBe(SESSION_MATERIAL.hello)
  })

  it('fails closed (resolves null, never rejects) when loadDialConfig throws on reload (AC3)', async () => {
    const factory = resolvedSessionFactory()
    const loadDialConfig: DialConfigProvider = () =>
      Promise.reject(new Error('malformed record — MUST NOT reach the supervisor await'))
    const { supervisor } = setup({ createSession: factory.createSession, loadDialConfig })

    await expect(supervisor().config.resolveConnection?.()).resolves.toBeNull()
  })

  it('emits session-load-failed if a reconnect fires with no reloaded material (defensive)', async () => {
    // resolveConnection returns null (no record) → pendingSession left null. A connected that then
    // (structurally unreachably — the supervisor fail-closes first) fires must not deref null.
    const factory = resolvedSessionFactory()
    const loadDialConfig: DialConfigProvider = () => Promise.resolve(null)
    const { sink, supervisor } = setup({ createSession: factory.createSession, loadDialConfig })

    supervisor().emit({ type: 'connected' }) // first connect flips the firstConnect gate
    await tick()
    await supervisor().config.resolveConnection?.() // null → pendingSession = null
    supervisor().emit({ type: 'connected' })
    await tick()

    expect(errorsOf(sink.events)).toContainEqual({ type: 'error', reason: 'session-load-failed' })
  })

  it('uses config.session on every connect and sets no resolveConnection when loadDialConfig is absent', async () => {
    const factory = resolvedSessionFactory()
    const { supervisor } = setup({ createSession: factory.createSession })

    supervisor().emit({ type: 'connected' })
    await tick()
    supervisor().emit({ type: 'connected' })
    await tick()

    expect(factory.sessions[0].config.remoteStaticPublicKey).toBe(SESSION_MATERIAL.remoteStaticPublicKey)
    expect(factory.sessions[1].config.remoteStaticPublicKey).toBe(SESSION_MATERIAL.remoteStaticPublicKey)
    // No provider → the supervisor gets no resolveConnection (its sync fallback path).
    expect(supervisor().config.resolveConnection).toBeUndefined()
  })

  it('is log-free by construction across connect → handshake → transport → error', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      const factory = resolvedSessionFactory()
      const { driver, supervisor } = setup({ createSession: factory.createSession })

      supervisor().emit({ type: 'connected' })
      await tick()
      const session = factory.sessions[0]
      session.config.onEvent({ type: 'handshake-complete', helloAck: new Uint8Array([1]) })
      driver.sendMessage(new Uint8Array([1]))
      supervisor().emit({ type: 'message', frame: wrapInbound('noise_msg', new Uint8Array([2])) })
      session.config.onEvent({ type: 'error', reason: 'transport-decrypt-failed' })
      supervisor().emit({ type: 'message', frame: new TextEncoder().encode('junk{') })
      supervisor().emit({ type: 'terminal', code: 4426, reason: 'fatal' })

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
