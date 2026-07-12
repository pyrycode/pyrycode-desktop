import { describe, it, expect } from 'vitest'
import {
  createRelaySupervisor,
  DEFAULT_FATAL_CLOSE_CODES,
  NO_PAIRED_RECORD_CLOSE_CODE,
  type RelaySupervisorEvent
} from './relaySupervisor'
import {
  RelayNotConnectedError,
  type RelayConnection,
  type RelayConnectionConfig,
  type RelayEvent
} from './relayConnection'

// The supervisor is driven entirely through an injected fake connection factory and an
// injected fake scheduler — no real `ws` server, no wall-clock timers. The fakes let a test
// capture the exact scheduled backoff `ms`, fire timers synchronously, and simulate connect
// success / connect failure / mid-session drop / fatal-code close deterministically.

// --- fake connection factory ---------------------------------------------------------------
// Each fake RelayConnection mirrors #21's contract that matters here: `send` throws
// RelayNotConnectedError until the connection has emitted `connected` (i.e. is OPEN), so the
// supervisor's "throw during a backoff gap / before first connect" behaviour is exercised
// faithfully. `emit` drives an event into the captured onEvent sink.
interface FakeConnection {
  config: RelayConnectionConfig
  handle: RelayConnection
  sent: Array<string | Uint8Array>
  closed: boolean
  live: boolean
  emit: (event: RelayEvent) => void
}

function fakeConnectionFactory(): {
  createConnection: (config: RelayConnectionConfig) => RelayConnection
  connections: FakeConnection[]
} {
  const connections: FakeConnection[] = []
  function createConnection(config: RelayConnectionConfig): RelayConnection {
    const fake: FakeConnection = {
      config,
      sent: [],
      closed: false,
      live: false,
      emit(event) {
        if (event.type === 'connected') fake.live = true
        if (event.type === 'closed') fake.live = false
        config.onEvent(event)
      },
      handle: {
        send(frame) {
          if (!fake.live) throw new RelayNotConnectedError()
          fake.sent.push(frame)
        },
        close() {
          fake.closed = true
          fake.live = false
        }
      }
    }
    connections.push(fake)
    return fake.handle
  }
  return { createConnection, connections }
}

// --- fake scheduler ------------------------------------------------------------------------
interface FakeTimer {
  fn: () => void
  ms: number
  cancelled: boolean
  fired: boolean
}

function fakeScheduler(): {
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void
  pending: () => FakeTimer[]
  fireNext: () => void
  fireAll: () => void
  timers: FakeTimer[]
} {
  const timers: FakeTimer[] = []
  return {
    timers,
    setTimer(fn, ms) {
      const timer: FakeTimer = { fn, ms, cancelled: false, fired: false }
      timers.push(timer)
      return timer as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer(handle) {
      ;(handle as unknown as FakeTimer).cancelled = true
    },
    pending() {
      return timers.filter((t) => !t.cancelled && !t.fired)
    },
    fireNext() {
      const next = timers.find((t) => !t.cancelled && !t.fired)
      if (!next) throw new Error('no pending timer to fire')
      next.fired = true
      next.fn()
    },
    fireAll() {
      for (const t of timers) {
        if (!t.cancelled && !t.fired) {
          t.fired = true
          t.fn()
        }
      }
    }
  }
}

function makeSink(): { events: RelaySupervisorEvent[]; onEvent: (event: RelaySupervisorEvent) => void } {
  const events: RelaySupervisorEvent[] = []
  return { events, onEvent: (event) => void events.push(event) }
}

const terminals = (events: RelaySupervisorEvent[]) => events.filter((e) => e.type === 'terminal')
const connectedCount = (events: RelaySupervisorEvent[]) =>
  events.filter((e) => e.type === 'connected').length
const messages = (events: RelaySupervisorEvent[]) =>
  events.filter((e): e is Extract<RelaySupervisorEvent, { type: 'message' }> => e.type === 'message')
const relayCloseds = (events: RelaySupervisorEvent[]) =>
  events.filter(
    (e): e is Extract<RelaySupervisorEvent, { type: 'relay-closed' }> => e.type === 'relay-closed'
  )

// Wire the supervisor to the fakes with the wire-spec cadence pinned to round numbers so the
// backoff sequence (1000/2000/4000/8000/16000/30000) and the 60000 stability threshold are
// crisp to assert.
function setup(
  opts: {
    fatalCloseCodes?: ReadonlySet<number>
    random?: () => number
    resolveConnection?: () => Promise<Omit<RelayConnectionConfig, 'onEvent'> | null>
  } = {}
): {
  factory: ReturnType<typeof fakeConnectionFactory>
  scheduler: ReturnType<typeof fakeScheduler>
  sink: ReturnType<typeof makeSink>
  supervisor: ReturnType<typeof createRelaySupervisor>
} {
  const factory = fakeConnectionFactory()
  const scheduler = fakeScheduler()
  const sink = makeSink()
  const supervisor = createRelaySupervisor(
    {
      connection: { url: 'ws://relay.test', headers: {} },
      onEvent: sink.onEvent,
      fatalCloseCodes: opts.fatalCloseCodes,
      resolveConnection: opts.resolveConnection,
      createConnection: factory.createConnection
    },
    {
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      stableUptimeMs: 60_000,
      jitterRatio: 0.2,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
      random: opts.random ?? (() => 0.5)
    }
  )
  return { factory, scheduler, sink, supervisor }
}

const dropClosed = (reason = 'drop'): RelayEvent => ({ type: 'closed', code: 1006, reason })

// Flush the microtask queue: the async re-dial awaits resolveConnection(), so a macrotask turn
// drains its .then continuation deterministically (the supervisor owns no wall-clock timers here).
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createRelaySupervisor', () => {
  it('dials immediately on creation, with no timer firing first (immediate first dial)', () => {
    const { factory, scheduler } = setup()
    expect(factory.connections).toHaveLength(1)
    expect(scheduler.pending()).toHaveLength(0)
  })

  it('reconnects with capped exponential backoff on repeated failures (AC1)', () => {
    const { factory, scheduler, sink } = setup({ random: () => 0.5 })
    const expected = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]

    for (let i = 0; i < expected.length; i++) {
      factory.connections[factory.connections.length - 1].emit(dropClosed())
      const scheduled = scheduler.pending()
      expect(scheduled).toHaveLength(1)
      expect(scheduled[0].ms).toBe(expected[i])
      scheduler.fireNext()
      // a fresh connection is dialled after each backoff timer fires
      expect(factory.connections).toHaveLength(i + 2)
    }
    expect(terminals(sink.events)).toHaveLength(0)
  })

  it('applies ±20% jitter to each backoff step (AC1)', () => {
    // lower bound: random() === 0 → factor 0.8
    {
      const { factory, scheduler } = setup({ random: () => 0 })
      factory.connections[0].emit(dropClosed())
      expect(scheduler.pending()[0].ms).toBeCloseTo(800)
    }
    // upper bound: random() ≈ 1 → factor ≈ 1.2 (exclusive)
    {
      const { factory, scheduler } = setup({ random: () => 0.999 })
      const ms = (() => {
        factory.connections[0].emit(dropClosed())
        return scheduler.pending()[0].ms
      })()
      expect(ms).toBeGreaterThan(1000)
      expect(ms).toBeLessThan(1200)
    }
    // every scheduled step stays within [0.8·base, 1.2·base) across the sequence
    {
      const { factory, scheduler } = setup({ random: () => 0.999 })
      const bases = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]
      for (let i = 0; i < bases.length; i++) {
        factory.connections[factory.connections.length - 1].emit(dropClosed())
        const ms = scheduler.pending()[0].ms
        expect(ms).toBeGreaterThanOrEqual(0.8 * bases[i])
        expect(ms).toBeLessThan(1.2 * bases[i])
        scheduler.fireNext()
      }
    }
  })

  it('resets the backoff to the first step after a connection stays up ≥ threshold (AC2)', () => {
    const { factory, scheduler } = setup()
    // two failures climb the attempt counter
    factory.connections[0].emit(dropClosed())
    scheduler.fireNext()
    factory.connections[1].emit(dropClosed())
    scheduler.fireNext()
    // a connection comes up and stays up beyond the stable-uptime threshold
    factory.connections[2].emit({ type: 'connected' })
    const stability = scheduler.pending().find((t) => t.ms === 60_000)
    expect(stability).toBeDefined()
    scheduler.fireNext() // fire the stability timer → attempt reset to first step
    // next drop schedules the FIRST backoff step again
    factory.connections[2].emit(dropClosed())
    const backoff = scheduler.pending()
    expect(backoff).toHaveLength(1)
    expect(backoff[0].ms).toBe(1000)
  })

  it('does NOT reset the backoff when a connection drops before the threshold (AC2)', () => {
    const { factory, scheduler } = setup()
    factory.connections[0].emit(dropClosed())
    scheduler.fireNext()
    factory.connections[1].emit(dropClosed())
    scheduler.fireNext()
    // connects, then drops WITHOUT the stability timer firing
    factory.connections[2].emit({ type: 'connected' })
    factory.connections[2].emit(dropClosed())
    // backoff continues the sequence (step index 2 → 4000), not reset to 1000
    const backoff = scheduler.pending()
    expect(backoff).toHaveLength(1)
    expect(backoff[0].ms).toBe(4000)
    // the stability timer was cancelled on the drop
    const stability = scheduler.timers.find((t) => t.ms === 60_000)
    expect(stability?.cancelled).toBe(true)
  })

  it('treats a fatal close code as terminal — no reconnect (AC3)', () => {
    for (const code of [4401, 4421, 4426]) {
      const { factory, scheduler, sink } = setup()
      const conn = factory.connections[0]
      conn.emit({ type: 'closed', code, reason: 'rejected' })

      expect(sink.events).toContainEqual({ type: 'terminal', code, reason: 'rejected' })
      expect(factory.connections).toHaveLength(1) // no new dial
      expect(scheduler.pending()).toHaveLength(0) // no backoff scheduled
      // a late event from the dead connection is ignored (no second terminal)
      conn.emit(dropClosed('late'))
      expect(terminals(sink.events)).toHaveLength(1)
      expect(factory.connections).toHaveLength(1)
    }
  })

  it('treats a non-fatal close code as retryable — reconnects (AC3)', () => {
    for (const code of [4404, 1011, 1006, 1000]) {
      const { factory, scheduler, sink } = setup()
      factory.connections[0].emit({ type: 'closed', code, reason: 'transient' })
      expect(scheduler.pending()).toHaveLength(1) // backoff scheduled
      expect(terminals(sink.events)).toHaveLength(0)
    }
  })

  it('surfaces a retryable daemon-absent close (4404) upward AND still schedules a re-dial (#328)', () => {
    const { factory, scheduler, sink } = setup()
    factory.connections[0].emit({ type: 'closed', code: 4404, reason: 'binary-offline' })
    // The retryable close is now surfaced as its own relay-leg signal (the "offline"/"daemon-absent"
    // category the driver classifies one layer up), carrying the raw close code…
    expect(sink.events).toContainEqual({ type: 'relay-closed', code: 4404 })
    // …while the load-bearing re-dial is still armed (the drop is absorbed, not terminal).
    expect(scheduler.pending()).toHaveLength(1)
    expect(terminals(sink.events)).toHaveLength(0)
  })

  it('surfaces an ordinary retryable drop (1006) upward as relay-closed (#328)', () => {
    const { factory, sink } = setup()
    factory.connections[0].emit(dropClosed())
    expect(sink.events).toContainEqual({ type: 'relay-closed', code: 1006 })
  })

  it('does NOT surface relay-closed for a fatal close — only terminal (#328)', () => {
    const { factory, sink } = setup()
    factory.connections[0].emit({ type: 'closed', code: 4401, reason: 'rejected' })
    expect(sink.events).toContainEqual({ type: 'terminal', code: 4401, reason: 'rejected' })
    expect(relayCloseds(sink.events)).toHaveLength(0)
  })

  it('honours an injected fatal-close-code set over the default (AC3)', () => {
    // custom set makes 4404 fatal…
    {
      const { factory, sink } = setup({ fatalCloseCodes: new Set([4404]) })
      factory.connections[0].emit({ type: 'closed', code: 4404, reason: 'x' })
      expect(sink.events).toContainEqual({ type: 'terminal', code: 4404, reason: 'x' })
    }
    // …and makes 4401 (a default-fatal code) retryable
    {
      const { factory, scheduler, sink } = setup({ fatalCloseCodes: new Set([4404]) })
      factory.connections[0].emit({ type: 'closed', code: 4401, reason: 'x' })
      expect(scheduler.pending()).toHaveLength(1)
      expect(terminals(sink.events)).toHaveLength(0)
    }
    // the wire-spec default is exactly {4401, 4421, 4426} — excludes 4409 (binary leg) and 4404
    expect(DEFAULT_FATAL_CLOSE_CODES.size).toBe(3)
    for (const code of [4401, 4421, 4426]) expect(DEFAULT_FATAL_CLOSE_CODES.has(code)).toBe(true)
    expect(DEFAULT_FATAL_CLOSE_CODES.has(4409)).toBe(false)
    expect(DEFAULT_FATAL_CLOSE_CODES.has(4404)).toBe(false)
  })

  it('stops cleanly during a backoff gap, cancelling the pending timer (AC4)', () => {
    const { factory, scheduler, sink, supervisor } = setup()
    factory.connections[0].emit(dropClosed()) // schedules a backoff timer
    const backoff = scheduler.pending()[0]

    supervisor.stop()

    expect(backoff.cancelled).toBe(true)
    scheduler.fireAll()
    expect(factory.connections).toHaveLength(1) // no new connection dialled
    expect(terminals(sink.events)).toEqual([{ type: 'terminal', code: 1000, reason: 'stopped' }])
    expect(scheduler.pending()).toHaveLength(0) // no dangling timers
  })

  it('stops cleanly while connected, releasing the underlying connection (AC4)', () => {
    const { factory, scheduler, sink, supervisor } = setup()
    const conn = factory.connections[0]
    conn.emit({ type: 'connected' })
    const stability = scheduler.pending().find((t) => t.ms === 60_000)

    supervisor.stop()

    expect(conn.closed).toBe(true) // underlying connection released
    expect(stability?.cancelled).toBe(true)
    expect(terminals(sink.events)).toHaveLength(1)
    // the connection's later async `closed` produces neither a second terminal nor a reconnect
    conn.emit(dropClosed('late'))
    expect(terminals(sink.events)).toHaveLength(1)
    expect(factory.connections).toHaveLength(1)
  })

  it('is idempotent under repeated stop() (AC4)', () => {
    const { supervisor, sink } = setup()
    supervisor.stop()
    supervisor.stop()
    expect(terminals(sink.events)).toHaveLength(1)
  })

  it('forwards inbound frames byte-for-byte, opaque bytes unchanged (AC5)', () => {
    const { factory, sink } = setup()
    const conn = factory.connections[0]
    conn.emit({ type: 'connected' })

    const jsonBytes = new Uint8Array(Buffer.from(JSON.stringify({ hello: 'world' })))
    const rawBytes = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80])
    conn.emit({ type: 'message', frame: jsonBytes })
    conn.emit({ type: 'message', frame: rawBytes })

    const msgs = messages(sink.events)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].frame).toBe(jsonBytes) // same reference, no copy
    expect(Array.from(msgs[0].frame)).toEqual(Array.from(jsonBytes))
    expect(Array.from(msgs[1].frame)).toEqual([0x00, 0x01, 0xff, 0x7f, 0x80])
  })

  it('absorbs a transient drop and re-connects without a terminal (AC5)', () => {
    const { factory, scheduler, sink } = setup()
    factory.connections[0].emit({ type: 'connected' })
    factory.connections[0].emit(dropClosed()) // transient — absorbed, not surfaced
    scheduler.fireNext() // backoff → re-dial
    factory.connections[1].emit({ type: 'connected' })

    expect(connectedCount(sink.events)).toBe(2)
    expect(terminals(sink.events)).toHaveLength(0)
    expect(factory.connections).toHaveLength(2)
    // exactly one connection is live at a time (replace, don't stack)
    expect(factory.connections[0].live).toBe(false)
    expect(factory.connections[1].live).toBe(true)
  })

  it('delegates send to the live connection and throws when none is live', () => {
    const { factory, supervisor } = setup()
    // before first connect — the connection exists but is not OPEN
    expect(() => supervisor.send(new Uint8Array([1]))).toThrow(RelayNotConnectedError)

    factory.connections[0].emit({ type: 'connected' })
    supervisor.send(new Uint8Array([1, 2, 3]))
    expect(factory.connections[0].sent).toHaveLength(1)
    expect(Array.from(factory.connections[0].sent[0] as Uint8Array)).toEqual([1, 2, 3])

    // during a backoff gap after a drop — no live connection
    factory.connections[0].emit(dropClosed())
    expect(() => supervisor.send('x')).toThrow(RelayNotConnectedError)
  })
})

// #83 — the optional per-dial connection provider. The first dial keeps using config.connection
// (built synchronously on construction); every AUTOMATIC re-dial re-sources the connection through
// resolveConnection so a re-pair mid-session dials the fresh relay/server/token, and a null (no
// record) fails closed with the synthetic close code instead of spinning on a phantom.
describe('createRelaySupervisor — reload-per-dial provider (#83)', () => {
  const connB = (): Omit<RelayConnectionConfig, 'onEvent'> => ({
    url: 'ws://relay-b.test',
    headers: { 'X-Pyrycode-Server': 'srv-B' }
  })

  it('uses config.connection (not the provider) for the immediate first dial', () => {
    const { factory } = setup({ resolveConnection: () => Promise.resolve(connB()) })
    // Built synchronously on construction, before any timer or await, from config.connection.
    expect(factory.connections).toHaveLength(1)
    expect(factory.connections[0].config.url).toBe('ws://relay.test')
  })

  it('re-sources the connection via resolveConnection on an automatic re-dial (AC1/AC2)', async () => {
    const { factory, scheduler } = setup({ resolveConnection: () => Promise.resolve(connB()) })
    // A transient drop schedules a backoff timer; firing it runs the async re-dial.
    factory.connections[0].emit(dropClosed())
    scheduler.fireNext()
    await tick()

    expect(factory.connections).toHaveLength(2)
    expect(factory.connections[1].config.url).toBe('ws://relay-b.test')
    expect(factory.connections[1].config.headers['X-Pyrycode-Server']).toBe('srv-B')
  })

  it('fails closed with the synthetic close code when resolveConnection returns null on re-dial (AC3)', async () => {
    const { factory, scheduler, sink } = setup({ resolveConnection: () => Promise.resolve(null) })
    factory.connections[0].emit({ type: 'connected' })
    factory.connections[0].emit(dropClosed())
    scheduler.fireNext()
    await tick()

    expect(terminals(sink.events)).toEqual([
      { type: 'terminal', code: NO_PAIRED_RECORD_CLOSE_CODE, reason: 'no-paired-record' }
    ])
    expect(factory.connections).toHaveLength(1) // no phantom re-dial
    expect(scheduler.pending()).toHaveLength(0) // no dangling timers
  })

  it('does not dial when stop() races an in-flight reload (AC4)', async () => {
    let resolveDeferred: (v: Omit<RelayConnectionConfig, 'onEvent'> | null) => void = () => {}
    const deferred = new Promise<Omit<RelayConnectionConfig, 'onEvent'> | null>((res) => {
      resolveDeferred = res
    })
    const { factory, sink, scheduler, supervisor } = setup({ resolveConnection: () => deferred })
    factory.connections[0].emit({ type: 'connected' })
    factory.connections[0].emit(dropClosed())
    scheduler.fireNext() // the async re-dial is now awaiting the deferred reload

    supervisor.stop()
    resolveDeferred(connB()) // reload finishes AFTER stop — the post-await fence must abort the dial
    await tick()

    expect(factory.connections).toHaveLength(1) // no new connection dialled after stop
    expect(terminals(sink.events)).toEqual([{ type: 'terminal', code: 1000, reason: 'stopped' }])
    expect(scheduler.pending()).toHaveLength(0)
  })

  it('still re-dials synchronously from config.connection when no provider is set (unchanged)', () => {
    // The whole existing suite exercises this, but pin it explicitly: no provider → the sync path
    // on every dial, including re-dials (no await, no tick needed).
    const { factory, scheduler } = setup()
    factory.connections[0].emit(dropClosed())
    scheduler.fireNext()
    expect(factory.connections).toHaveLength(2)
    expect(factory.connections[1].config.url).toBe('ws://relay.test')
  })
})
