// The conversation router (#1118): a command about a conversation reaches the server that owns that
// conversation, and nothing else. Both seams are injected, so these tests drive a `connectionFor`
// fake over a plain Map and a recording sink — no Electron, no registry, no socket, no window.
import { describe, expect, it, vi } from 'vitest'
import {
  createConversationRouter,
  MAX_INDEXED_CONVERSATIONS,
  type ConversationRouter
} from './conversationRouter'
import type { DaemonEventSink } from './emitDaemonEvent'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent, type StampedDaemonEvent } from '../shared/ipc/events'
import type { ConversationSummary } from '../shared/wire/types'
import type { DiagnosticEvent } from './diagnosticLog'

it('routes an observed read only to its unique original host', () => {
  const connections = new Map([['a', { server: 'a' }], ['b', { server: 'b' }]])
  const router = createConversationRouter({ connectionFor: host => connections.get(host) ?? null })
  const sink = router.observe(createSinkFake().handle)
  sink.webContents.send(DAEMON_EVENT_CHANNEL, listEvent('a', 'c'))
  expect(router.route('c', 'a')).toBe(connections.get('a'))
  expect(router.route('c', 'b')).toBeNull()
  sink.webContents.send(DAEMON_EVENT_CHANNEL, listEvent('b', 'c'))
  expect(router.route('c', 'a')).toBeNull()
  expect(router.route('c', 'b')).toBeNull()
  sink.webContents.send(DAEMON_EVENT_CHANNEL, listEvent('a'))
  expect(router.route('c', 'a')).toBeNull()
  expect(router.route('c', 'b')).toBe(connections.get('b'))
  const deleted: StampedDaemonEvent = { type: 'conversationDeleted', id: 'c', serverId: 'b' }
  sink.webContents.send(DAEMON_EVENT_CHANNEL, deleted)
  expect(router.route('c', 'b')).toBeNull()
  connections.delete('b')
  expect(router.route('c', 'b')).toBeNull()
})

it.each(['list replacement', 'deletion', 'pairing removal'])('routes the surviving claim after last-indexed host %s', removal => {
  const h = harness()
  const a = h.connect('a')
  h.connect('b')
  emit(h.router, listEvent('a', 'c'))
  emit(h.router, listEvent('b', 'c'))
  expect(h.router.route('c', 'a')).toBeNull()
  expect(h.router.route('c', 'b')).toBeNull()
  if (removal === 'list replacement') emit(h.router, listEvent('b'))
  else if (removal === 'deletion') {
    const deleted: StampedDaemonEvent = { type: 'conversationDeleted', id: 'c', serverId: 'b' }
    emit(h.router, deleted)
  } else h.disconnect('b')
  expect(h.router.route('c', 'b')).toBeNull()
  expect(h.router.route('c', 'a')).toBe(a)
  expect(h.router.route('c', 'b')).toBeNull()
})

/** A stand-in connection. Identity is the whole contract — the router never calls a member. */
interface FakeConnection {
  readonly server: string
}

/** One conversation row, in the shape the wire decode hands the event. */
function row(id: string): ConversationSummary {
  return {
    id,
    name: null,
    is_promoted: false,
    is_archived: false,
    cwd: '/workspace',
    last_message_ts: '2026-09-05T00:00:00Z',
    last_used_at: '2026-09-05T00:00:00Z',
    workspace_label: null
  }
}

function listEvent(serverId: string | null, ...ids: string[]): StampedDaemonEvent {
  return { type: 'conversationsReceived', conversations: ids.map(row), serverId }
}

function createdEvent(serverId: string | null, id: string): StampedDaemonEvent {
  return {
    type: 'conversationCreated',
    conversation: {
      id,
      is_promoted: false,
      cwd: '/workspace',
      name: null,
      last_used_at: '',
      workspace_label: null
    },
    serverId
  }
}

/** Every event the wrapper forwarded, with the channel it went out on. */
function createSinkFake(): {
  sent: { channel: string; event: DaemonEvent }[]
  destroyed: boolean
  handle: DaemonEventSink
} {
  const sent: { channel: string; event: DaemonEvent }[] = []
  const state = { destroyed: false }
  return {
    sent,
    get destroyed(): boolean {
      return state.destroyed
    },
    set destroyed(next: boolean) {
      state.destroyed = next
    },
    handle: {
      isDestroyed: () => state.destroyed,
      webContents: {
        send: (channel: string, event: DaemonEvent): void => void sent.push({ channel, event })
      }
    }
  }
}

function createLogFake(): { events: DiagnosticEvent[]; handle: { event(f: DiagnosticEvent): void } } {
  const events: DiagnosticEvent[] = []
  return { events, handle: { event: (fields: DiagnosticEvent): void => void events.push(fields) } }
}

function harness(): {
  router: ConversationRouter<FakeConnection>
  log: ReturnType<typeof createLogFake>
  connections: Map<string, FakeConnection>
  /** Give `server` a live connection and hand back the object `route` must answer with. */
  connect(server: string): FakeConnection
  /** Drop `server`'s connection — an unpair, from the router's point of view. */
  disconnect(server: string): void
} {
  const log = createLogFake()
  const connections = new Map<string, FakeConnection>()
  const router = createConversationRouter<FakeConnection>({
    connectionFor: (serverId) => connections.get(serverId) ?? null,
    diagnosticLog: log.handle
  })
  return {
    router,
    log,
    connections,
    connect(server: string): FakeConnection {
      const connection: FakeConnection = { server }
      connections.set(server, connection)
      return connection
    },
    disconnect(server: string): void {
      connections.delete(server)
    }
  }
}

/** Feed one event through a fresh wrapper, the way one connection's producer would. */
function emit(router: ConversationRouter<FakeConnection>, event: DaemonEvent): void {
  const sink = createSinkFake()
  router.observe(sink.handle).webContents.send(DAEMON_EVENT_CHANNEL, event)
}

describe('createConversationRouter', () => {
  describe('learning the index from stamped events (AC1)', () => {
    it('routes every row of a conversationsReceived to the server that reported it', () => {
      const h = harness()
      const alpha = h.connect('alpha')
      emit(h.router, listEvent('alpha', 'conv-1', 'conv-2'))

      expect(h.router.route('conv-1')).toBe(alpha)
      expect(h.router.route('conv-2')).toBe(alpha)
    })

    it('routes a conversationCreated to the server that created it', () => {
      const h = harness()
      const beta = h.connect('beta')
      emit(h.router, createdEvent('beta', 'conv-new'))

      expect(h.router.route('conv-new')).toBe(beta)
    })

    it('re-points a conversation to the server that reported it last, and logs the change', () => {
      const h = harness()
      h.connect('alpha')
      const beta = h.connect('beta')
      emit(h.router, listEvent('alpha', 'conv-1'))
      emit(h.router, listEvent('beta', 'conv-1'))

      expect(h.router.route('conv-1')).toBe(beta)
      expect(h.log.events).toEqual([{ event: 'conversation-reindexed', code: 'reassigned' }])
    })

    it('logs nothing when the same server re-reports a conversation it already owns', () => {
      const h = harness()
      h.connect('alpha')
      emit(h.router, listEvent('alpha', 'conv-1'))
      emit(h.router, listEvent('alpha', 'conv-1'))

      expect(h.log.events).toEqual([])
    })

    it('indexes nothing from an event stamped with no server, or with no stamp at all', () => {
      const h = harness()
      h.connect('alpha')
      emit(h.router, listEvent(null, 'conv-standin'))
      emit(h.router, { type: 'conversationsReceived', conversations: [row('conv-unbound')] })

      expect(h.router.route('conv-standin')).toBeNull()
      expect(h.router.route('conv-unbound')).toBeNull()
    })
  })

  describe('observing is transparent (AC5)', () => {
    it('forwards every event to the target unchanged, arms it does not index included', () => {
      const h = harness()
      const sink = createSinkFake()
      const wrapped = h.router.observe(sink.handle)
      const indexed = listEvent('alpha', 'conv-1')
      const ignored: StampedDaemonEvent = { type: 'notificationActivated', serverId: 'alpha' }

      wrapped.webContents.send(DAEMON_EVENT_CHANNEL, indexed)
      wrapped.webContents.send(DAEMON_EVENT_CHANNEL, ignored)

      expect(sink.sent).toEqual([
        { channel: DAEMON_EVENT_CHANNEL, event: indexed },
        { channel: DAEMON_EVENT_CHANNEL, event: ignored }
      ])
      // The very same objects, not copies: the wrapper transforms nothing.
      expect(sink.sent[0].event).toBe(indexed)
      expect(sink.sent[1].event).toBe(ignored)
    })

    it('records BEFORE it forwards, so a consumer reached by the send already routes', () => {
      const h = harness()
      const alpha = h.connect('alpha')
      let seen: FakeConnection | null | 'unset' = 'unset'
      const target: DaemonEventSink = {
        isDestroyed: () => false,
        webContents: {
          send: (): void => {
            seen = h.router.route('conv-1')
          }
        }
      }

      h.router.observe(target).webContents.send(DAEMON_EVENT_CHANNEL, listEvent('alpha', 'conv-1'))

      expect(seen).toBe(alpha)
    })

    it('delegates isDestroyed and never reads webContents at wrap time', () => {
      const h = harness()
      const sink = createSinkFake()
      const wrapped = h.router.observe(sink.handle)
      expect(wrapped.isDestroyed()).toBe(false)
      sink.destroyed = true
      expect(wrapped.isDestroyed()).toBe(true)

      // A real destroyed BrowserWindow THROWS on the `webContents` property read, so wrapping one
      // must not touch it (emitDaemonEvent's ordering rule, inherited across the extra hop).
      const hostile: DaemonEventSink = {
        isDestroyed: () => true,
        get webContents(): never {
          throw new Error('Object has been destroyed')
        }
      }
      expect(() => h.router.observe(hostile)).not.toThrow()
      expect(h.router.observe(hostile).isDestroyed()).toBe(true)
    })
  })

  describe('refusing an id it cannot place (AC3)', () => {
    it('answers null and logs a static code for an unknown conversation', () => {
      const h = harness()
      h.connect('alpha')

      expect(h.router.route('never-seen')).toBeNull()
      expect(h.log.events).toEqual([
        { event: 'conversation-route-refused', code: 'unknown-conversation' }
      ])
    })

    it('refuses an absent id on the same path, with no separate branch', () => {
      const h = harness()

      expect(h.router.route(undefined)).toBeNull()
      expect(h.log.events).toEqual([
        { event: 'conversation-route-refused', code: 'unknown-conversation' }
      ])
    })

    it('logs an event name and a code and NOTHING else — no conversation id, no server id', () => {
      const h = harness()
      h.connect('alpha')
      emit(h.router, listEvent('alpha', 'conv-1'))
      h.disconnect('alpha')
      h.router.route('conv-1')
      h.router.route('secret-conversation')

      for (const event of h.log.events) expect(Object.keys(event).sort()).toEqual(['code', 'event'])
      const serialized = JSON.stringify(h.log.events)
      expect(serialized).not.toContain('conv-1')
      expect(serialized).not.toContain('secret-conversation')
      expect(serialized).not.toContain('alpha')
    })
  })

  describe('an unpaired server cannot stay routable (AC4)', () => {
    it('refuses a known conversation whose server has no live connection', () => {
      const h = harness()
      h.connect('alpha')
      emit(h.router, listEvent('alpha', 'conv-1'))
      h.disconnect('alpha')

      expect(h.router.route('conv-1')).toBeNull()
      expect(h.log.events).toEqual([
        { event: 'conversation-route-refused', code: 'server-not-connected' }
      ])
    })

    it('DROPS the mapping, so re-connecting that server does not make the id routable again', () => {
      const h = harness()
      h.connect('alpha')
      emit(h.router, listEvent('alpha', 'conv-1'))
      h.disconnect('alpha')
      h.router.route('conv-1')

      h.connect('alpha')
      expect(h.router.route('conv-1')).toBeNull()
      // The second refusal is the UNKNOWN one: the mapping is gone, not merely gated.
      expect(h.log.events.map((event) => event.code)).toEqual([
        'server-not-connected',
        'unknown-conversation'
      ])
    })

    it('routes again once the server re-reports the conversation', () => {
      const h = harness()
      h.connect('alpha')
      emit(h.router, listEvent('alpha', 'conv-1'))
      h.disconnect('alpha')
      h.router.route('conv-1')

      const alpha = h.connect('alpha')
      emit(h.router, listEvent('alpha', 'conv-1'))
      expect(h.router.route('conv-1')).toBe(alpha)
    })
  })

  describe('bounds and hostile input (AC5)', () => {
    it('treats a conversation id of __proto__ as an ordinary key and pollutes nothing', () => {
      const h = harness()
      const alpha = h.connect('alpha')
      emit(h.router, listEvent('alpha', '__proto__', 'constructor'))

      expect(h.router.route('__proto__')).toBe(alpha)
      expect(h.router.route('constructor')).toBe(alpha)
      expect(Object.prototype.hasOwnProperty.call({}, 'alpha')).toBe(false)
      expect(({} as Record<string, unknown>).alpha).toBeUndefined()
    })

    it('treats a server id of __proto__ as an ordinary value', () => {
      const h = harness()
      const hostile = h.connect('__proto__')
      emit(h.router, listEvent('__proto__', 'conv-1'))

      expect(h.router.route('conv-1')).toBe(hostile)
    })

    it('ignores an empty conversation id and an empty server id', () => {
      const h = harness()
      h.connect('alpha')
      h.connect('')
      emit(h.router, listEvent('alpha', ''))
      emit(h.router, listEvent('', 'conv-1'))

      expect(h.router.route('')).toBeNull()
      expect(h.router.route('conv-1')).toBeNull()
    })

    it('stops learning new ids at the cap, still re-points known ones, and logs once', () => {
      const h = harness()
      const alpha = h.connect('alpha')
      const beta = h.connect('beta')
      const filled = Array.from({ length: MAX_INDEXED_CONVERSATIONS }, (_, index) => `conv-${index}`)
      emit(h.router, listEvent('alpha', ...filled))

      emit(h.router, listEvent('alpha', 'one-too-many', 'and-another'))
      expect(h.router.route('one-too-many')).toBeNull()
      expect(h.router.route('and-another')).toBeNull()

      // An overwrite does not grow the map, so a known id still re-points at the cap.
      emit(h.router, listEvent('beta', 'conv-0'))
      expect(h.router.route('conv-0')).toBe(beta)
      expect(h.router.route('conv-1')).toBe(alpha)

      expect(h.log.events.filter((event) => event.event === 'conversation-index-full')).toEqual([
        { event: 'conversation-index-full', code: 'cap-reached' }
      ])
    })

    it('reaches no console method on any path', () => {
      const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
      const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
      try {
        const h = harness()
        h.connect('alpha')
        emit(h.router, listEvent('alpha', 'conv-1'))
        emit(h.router, createdEvent('alpha', 'conv-2'))
        emit(h.router, listEvent(null, 'conv-3'))
        h.router.route('conv-1')
        h.router.route(undefined)
        h.disconnect('alpha')
        h.router.route('conv-2')

        for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      } finally {
        for (const spy of spies) spy.mockRestore()
      }
    })
  })

  describe('the router is correct with no logger at all', () => {
    it('routes and refuses identically when diagnosticLog is omitted', () => {
      const connections = new Map<string, FakeConnection>([['alpha', { server: 'alpha' }]])
      const router = createConversationRouter<FakeConnection>({
        connectionFor: (serverId) => connections.get(serverId) ?? null
      })
      emit(router, listEvent('alpha', 'conv-1'))

      expect(router.route('conv-1')).toBe(connections.get('alpha'))
      expect(router.route('missing')).toBeNull()
    })
  })
})
