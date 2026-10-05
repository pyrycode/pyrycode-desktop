// The connection registry (#1117): the set of live connections follows the set of stored paired
// records. Every seam is injected, so these tests drive a store fake over a plain array and a
// connection-factory fake that records each construction spec — no keychain, no filesystem, no
// Electron, no socket.
import { describe, expect, it, vi } from 'vitest'
import { createConnectionRegistry } from './connectionRegistry'
import type { DaemonConnection } from './daemonConnection'
import type { PairedServerRecord, PairedServerStore } from './pairedServerStore'
import type { DiagnosticEvent } from './diagnosticLog'

/** A record whose four fields are all derived from `server`, so a mix-up is visible in an assertion. */
function record(server: string, token = `token-${server}`): PairedServerRecord {
  return {
    server,
    relay: `wss://relay.example/${server}`,
    token,
    server_static_pubkey: `key-${server}`
  }
}

/**
 * The collection, in `list()` order, behind the four accessors the registry is given. `save` mirrors
 * `pairedServerStore`'s filter-then-push, which is what makes the just-saved record LAST — the
 * property the registry's "active" invariant rests on.
 */
function createStoreFake(initial: PairedServerRecord[] = []) {
  let records = [...initial]
  let listError: Error | null = null
  let gate: Promise<void> | null = null
  const saves: PairedServerRecord[] = []

  return {
    /** Persist the way the real store does: replace by `server` key, then append. */
    save(next: PairedServerRecord): void {
      records = records.filter((entry) => entry.server !== next.server)
      records.push(next)
    },
    /** `clearServer`, from the registry's point of view: the record is simply gone. */
    remove(serverId: string): void {
      records = records.filter((entry) => entry.server !== serverId)
    },
    /** Make every later `list()` throw — the unreadable-blob state (#1069). */
    failList(error: Error | null): void {
      listError = error
    },
    /** Park the next `list()` until the returned release is called. */
    hold(): () => void {
      let open: () => void = () => {}
      gate = new Promise<void>((resolve) => {
        open = resolve
      })
      return () => {
        gate = null
        open()
      }
    },
    /** Every record the registry wrote. Must stay empty: the registry only ever forwards `save`. */
    saves,
    handle: {
      save: async (next: PairedServerRecord): Promise<void> => {
        saves.push(next)
      },
      load: async (): Promise<PairedServerRecord | null> => records[records.length - 1] ?? null,
      loadById: async (serverId: string): Promise<PairedServerRecord | null> =>
        records.find((entry) => entry.server === serverId) ?? null,
      list: async (): Promise<PairedServerRecord[]> => {
        if (gate !== null) await gate
        if (listError !== null) throw listError
        return [...records]
      }
    }
  }
}

interface BuiltConnection {
  serverId: string | null
  pairedServer: PairedServerStore
  calls: { start: number; stop: number; reconnect: number; interrupt: number }
  /**
   * The conversation ids this connection's `newSession` was handed (#1217), recorded BESIDE `calls`
   * rather than inside it. Two tests assert `calls` as a whole object, so a member added there is a
   * cascade into assertions about lifecycle counting — which this is not about — and this one needs
   * the argument, not a count: the delegate that dropped it would still count right.
   */
  newSessions: string[]
  contextRequests: string[]
  mcpStatusRequests: string[]
  mcpReconnects: Array<[string, string]>
  mcpToggles: Array<[string, string, boolean]>
  /**
   * The conversation ids this connection's `interrupt` was handed (#1092), recorded beside `calls` for
   * the reason `newSessions` is: `calls.interrupt` survives as this file's lifecycle-delegation probe
   * (two tests assert `calls` as a whole object), and a count cannot tell a delegate that forwards its
   * argument from one that drops it.
   */
  interrupts: string[]
}

/** Records every construction and every lifecycle call, so a test can assert which one was touched. */
function createFactoryFake() {
  const built: BuiltConnection[] = []
  const createConnection = (spec: {
    serverId: string | null
    pairedServer: PairedServerStore
  }): DaemonConnection => {
    const calls = { start: 0, stop: 0, reconnect: 0, interrupt: 0 }
    const newSessions: string[] = []
    const contextRequests: string[] = []
    const mcpStatusRequests: string[] = []
    const mcpReconnects: Array<[string, string]> = []
    const mcpToggles: Array<[string, string, boolean]> = []
    const interrupts: string[] = []
    built.push({
      serverId: spec.serverId,
      pairedServer: spec.pairedServer,
      calls,
      newSessions,
      contextRequests,
      mcpStatusRequests,
      mcpReconnects,
      mcpToggles,
      interrupts
    })
    const noop = (): void => {}
    return {
      start: () => {
        calls.start += 1
      },
      stop: () => {
        calls.stop += 1
      },
      reconnect: () => {
        calls.reconnect += 1
      },
      interrupt: (conversationId: string) => {
        calls.interrupt += 1
        interrupts.push(conversationId)
      },
      newSession: (conversationId: string) => {
        newSessions.push(conversationId)
      },
      send: noop,
      requestSessionSettings: noop,
      requestModelList: noop,
      requestContextUsage: (conversationId) => { contextRequests.push(conversationId) },
      requestMcpStatus: (conversationId) => { mcpStatusRequests.push(conversationId) },
      reconnectMcpServer: (conversationId, serverName) => { mcpReconnects.push([conversationId, serverName]) },
      toggleMcpServer: (conversationId, serverName, enabled) => {
        mcpToggles.push([conversationId, serverName, enabled])
      },
      requestHistory: noop,
      requestSystemPrompt: noop,
      requestConversations: noop,
      requestRecentWorkspaces: noop,
      createConversation: noop,
      createWorkspaceFolder: noop,
      dequeueMessage: noop,
      sendQueuedNow: noop,
      promoteConversation: noop,
      archiveConversation: noop,
      unarchiveConversation: noop,
      deleteConversation: noop,
      renameConversation: noop,
      changeWorkspace: noop,
      renameWorkspace: noop,
      setSystemPrompt: noop,
      setConversationMuted: noop,
      setSessionSettings: noop,
      answerModal: noop,
      cancelModal: noop,
      answerQuestions: noop,
      refuseQuestions: noop,
      requestDebugBundle: noop,
      uploadAttachment: async () => ({ ok: true }),
      requestAttachment: noop,
      readWorkspaceFile: noop
    }
  }
  return {
    /** Every construction, in order. Entry 0 is always the constructor's not-paired stand-in. */
    built,
    /** Just the ones built for a real record. */
    get paired(): BuiltConnection[] {
      return built.filter((entry) => entry.serverId !== null)
    },
    /** The one connection built for `serverId`. Fails loudly if the registry built two. */
    for(serverId: string): BuiltConnection {
      const found = built.filter((entry) => entry.serverId === serverId)
      expect(found).toHaveLength(1)
      return found[0]
    },
    createConnection
  }
}

function createLogFake() {
  const events: DiagnosticEvent[] = []
  return { events, handle: { event: (fields: DiagnosticEvent): void => void events.push(fields) } }
}

/** Drain the reconcile chain. One macrotask turn runs every pending `.then` behind it. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function harness(initial: PairedServerRecord[] = []) {
  const store = createStoreFake(initial)
  const factory = createFactoryFake()
  const log = createLogFake()
  const registry = createConnectionRegistry({
    store: store.handle,
    createConnection: factory.createConnection,
    diagnosticLog: log.handle
  })
  return { store, factory, log, registry }
}

describe('createConnectionRegistry', () => {
  describe('explicit named-host reconnect', () => {
    it('reconnects only the exact held host on every request', async () => {
      const { registry, factory } = harness([record('alpha'), record('beta')])
      await settle()

      registry.reconnect('alpha')
      expect(factory.paired.map((entry) => entry.calls.reconnect)).toEqual([1, 0])
      registry.reconnect('beta')
      registry.reconnect('alpha')
      expect(factory.paired.map((entry) => entry.calls.reconnect)).toEqual([2, 1])
      expect(factory.built[0].calls.reconnect).toBe(0)
    })

    it('ignores unknown ids without falling back to another host', async () => {
      const { registry, factory } = harness([record('alpha'), record('beta')])
      await settle()

      for (const id of ['unknown', 'Alpha', '', '__proto__', 'constructor', 'toString']) {
        expect(registry.reconnect(id)).toBeUndefined()
      }
      expect(factory.built.map((entry) => entry.calls.reconnect)).toEqual([0, 0, 0])
    })

    it('never reconnects the not-paired stand-in for a string id', async () => {
      const { registry, factory } = harness()
      await settle()

      for (const id of ['alpha', '', 'null', '__proto__', 'constructor', 'toString']) {
        expect(registry.reconnect(id)).toBeUndefined()
      }
      expect(factory.built).toHaveLength(1)
      expect(factory.built[0].calls.reconnect).toBe(0)
    })

    it.each(['', '__proto__', 'constructor', 'toString'])(
      'matches the ordinary string id %j when held',
      async (id) => {
        const { registry, factory } = harness([record(id), record('beta')])
        await settle()

        registry.reconnect(id)
        expect(factory.for(id).calls.reconnect).toBe(1)
        expect(factory.for('beta').calls.reconnect).toBe(0)
      }
    )
  })

  describe('the set follows the records (AC1)', () => {
    it('builds one connection per stored record, each stamped with its own server id', async () => {
      const { factory } = harness([record('alpha'), record('beta')])
      await settle()

      // Entry 0 is the constructor's stand-in, dropped as soon as the first read answers records.
      expect(factory.built.map((entry) => entry.serverId)).toEqual([null, 'alpha', 'beta'])
    })

    it("gives each connection a view that reads THAT server's record, not the most recent one", async () => {
      const { factory } = harness([record('alpha'), record('beta')])
      await settle()

      await expect(factory.for('alpha').pairedServer.load()).resolves.toEqual(record('alpha'))
      await expect(factory.for('beta').pairedServer.load()).resolves.toEqual(record('beta'))
    })

    it('dials every held connection on start()', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()

      registry.start()
      await settle()

      expect(factory.paired.map((entry) => entry.calls.start)).toEqual([1, 1])
      // The stand-in is dropped before start() fires, so it never dials.
      expect(factory.built[0].calls.start).toBe(0)
    })

    it('dials both when start() lands before the first store read resolves', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])

      registry.start()
      await settle()

      expect(factory.paired.map((entry) => entry.calls.start)).toEqual([1, 1])
    })

    it('stays idempotent across a second window did-finish-load (AC4)', async () => {
      const { factory, registry } = harness([record('alpha')])
      await settle()

      registry.start()
      await settle()
      registry.start()
      await settle()

      expect(factory.for('alpha').calls.start).toBe(1)
    })
  })

  describe('a pairing signal (AC2)', () => {
    it('builds and dials one connection for a server that had none, leaving the others untouched', async () => {
      const { store, factory, registry } = harness([record('alpha')])
      await settle()
      registry.start()
      await settle()

      store.save(record('beta'))
      registry.reconcile()
      await settle()

      expect(factory.paired.map((entry) => entry.serverId)).toEqual(['alpha', 'beta'])
      expect(factory.for('beta').calls.start).toBe(1)
      expect(factory.for('alpha').calls).toEqual({ start: 1, stop: 0, reconnect: 0, interrupt: 0 })
    })

    it('re-dials the one connection whose record changed, and only that one', async () => {
      const { store, factory, registry } = harness([record('alpha'), record('beta')])
      await settle()
      registry.start()
      await settle()

      store.save(record('alpha', 'rotated-token'))
      registry.reconcile()
      await settle()

      expect(factory.paired).toHaveLength(2)
      expect(factory.for('alpha').calls.reconnect).toBe(1)
      expect(factory.for('beta').calls.reconnect).toBe(0)
      expect(factory.for('beta').calls.stop).toBe(0)
    })

    it('builds one connection when two signals arrive back to back', async () => {
      const { store, factory, registry } = harness()
      await settle()

      store.save(record('alpha'))
      registry.reconcile()
      registry.reconcile()
      await settle()

      expect(factory.paired.filter((entry) => entry.serverId === 'alpha')).toHaveLength(1)
    })
  })

  describe('teardown (AC3)', () => {
    it('stops and drops the connection whose record is gone, leaving the rest live', async () => {
      const { store, factory, registry } = harness([record('alpha'), record('beta')])
      await settle()
      registry.start()
      await settle()

      store.remove('alpha')
      registry.reconcile()
      await settle()

      expect(factory.for('alpha').calls.stop).toBe(1)
      expect(factory.for('beta').calls).toEqual({ start: 1, stop: 0, reconnect: 0, interrupt: 0 })
    })

    it('stops every connection on quit', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()
      registry.start()
      await settle()

      registry.stop()

      expect(factory.paired.map((entry) => entry.calls.stop)).toEqual([1, 1])
    })

    it('builds nothing once stopped', async () => {
      const { store, factory, registry } = harness([record('alpha')])
      await settle()
      registry.stop()

      store.save(record('beta'))
      registry.reconcile()
      await settle()

      expect(factory.paired).toHaveLength(1)
    })

    it('builds and dials nothing when a quit lands while a reconcile is suspended', async () => {
      const { store, factory, registry } = harness([record('alpha')])
      await settle()
      registry.start()
      await settle()

      const release = store.hold()
      store.save(record('beta'))
      registry.reconcile()
      await settle()
      registry.stop()
      release()
      await settle()

      expect(factory.paired).toHaveLength(1)
      expect(factory.for('alpha').calls.stop).toBe(1)
    })
  })

  describe('one record and none behave as they do today (AC4)', () => {
    it('holds exactly one connection for one record, bound to that record', async () => {
      const { factory } = harness([record('alpha')])
      await settle()

      expect(factory.paired).toHaveLength(1)
      expect(factory.paired[0].serverId).toBe('alpha')
    })

    it('holds one null-bound connection over the whole store when nothing is paired', async () => {
      const { store, factory } = harness()
      store.save(record('alpha'))
      await settle()

      // Built before the read resolved, so it is the not-paired stand-in: the id is null and the view
      // is the whole store, exactly the connection the composition root builds today.
      expect(factory.built[0].serverId).toBeNull()
      await expect(factory.built[0].pairedServer.load()).resolves.toEqual(record('alpha'))
    })

    it('replaces the stand-in once a record exists, and reinstates one when the last is cleared', async () => {
      const { store, factory, registry } = harness()
      await settle()
      registry.start()
      await settle()

      store.save(record('alpha'))
      registry.reconcile()
      await settle()
      store.remove('alpha')
      registry.reconcile()
      await settle()

      expect(factory.built.map((entry) => entry.serverId)).toEqual([null, 'alpha', null])
      expect(factory.built[0].calls.stop).toBe(1)
      expect(factory.for('alpha').calls.stop).toBe(1)
      expect(factory.built[2].calls.start).toBe(1)
    })

    it('leaves the set as it stands when the collection cannot be read, and logs it content-free', async () => {
      const { store, factory, log, registry } = harness([record('alpha')])
      await settle()
      registry.start()
      await settle()

      store.failList(new Error('stored paired-server record is malformed'))
      registry.reconcile()
      await settle()

      expect(factory.paired).toHaveLength(1)
      expect(factory.for('alpha').calls.stop).toBe(0)
      expect(log.events).toContainEqual({
        event: 'registry-reconcile-failed',
        code: 'unreadable-collection'
      })
    })

    it('keeps the stand-in when the collection is unreadable at launch, so a failure still settles', async () => {
      const store = createStoreFake([record('alpha')])
      store.failList(new Error('stored paired-server record is malformed'))
      const factory = createFactoryFake()
      const registry = createConnectionRegistry({
        store: store.handle,
        createConnection: factory.createConnection
      })
      await settle()
      registry.start()
      await settle()

      expect(factory.built).toHaveLength(1)
      expect(factory.built[0].serverId).toBeNull()
      expect(factory.built[0].calls.start).toBe(1)
    })
  })

  describe('the active stand-in', () => {
    it('reaches the connection for the most recently saved record, and follows a re-pair', async () => {
      const { store, factory, registry } = harness([record('alpha'), record('beta')])
      await settle()

      registry.active.interrupt('conv-1')
      expect(factory.for('beta').calls.interrupt).toBe(1)

      // A re-pair of alpha moves it to the end of the collection, so `store.load()` — and therefore
      // the active connection — becomes alpha's again.
      store.save(record('alpha', 'rotated-token'))
      registry.reconcile()
      await settle()

      registry.active.interrupt('conv-1')
      expect(factory.for('alpha').calls.interrupt).toBe(1)
      expect(factory.for('beta').calls.interrupt).toBe(1)
    })

    it('is inert rather than throwing before the first store read resolves', () => {
      const { registry } = harness([record('alpha')])

      expect(() => registry.active.interrupt('conv-1')).not.toThrow()
    })
  })

  // The per-server accessor #1118 routes through. `active` answers for the most recently paired
  // server; this answers for the one NAMED, which is the whole difference between a command reaching
  // the right daemon and reaching whichever was paired last.
  describe('the per-server accessor', () => {
    it('forwards context requests only to the named host', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()
      registry.connectionFor('alpha')?.requestContextUsage('conv-42')
      expect(factory.for('alpha').contextRequests).toEqual(['conv-42'])
      expect(factory.for('beta').contextRequests).toEqual([])
    })

    it('forwards MCP status requests only to the named host', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()
      registry.connectionFor('beta')?.requestMcpStatus('conv-42')
      expect(factory.for('beta').mcpStatusRequests).toEqual(['conv-42'])
      expect(factory.for('alpha').mcpStatusRequests).toEqual([])
    })

    it('forwards MCP reconnects with both arguments only to the named host (#1582)', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()
      registry.connectionFor('beta')?.reconnectMcpServer('conv-42', 'docs')
      expect(factory.for('beta').mcpReconnects).toEqual([['conv-42', 'docs']])
      expect(factory.for('alpha').mcpReconnects).toEqual([])
    })

    it('forwards MCP toggles with all three arguments only to the named host (#1586)', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()
      registry.connectionFor('beta')?.toggleMcpServer('conv-42', 'docs', false)
      registry.connectionFor('beta')?.toggleMcpServer('conv-42', 'docs', true)
      expect(factory.for('beta').mcpToggles).toEqual([['conv-42', 'docs', false], ['conv-42', 'docs', true]])
      expect(factory.for('alpha').mcpToggles).toEqual([])
    })

    it('reaches the named server, not the most recently paired one', async () => {
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()

      registry.connectionFor('alpha')?.interrupt('conv-1')

      expect(factory.for('alpha').calls.interrupt).toBe(1)
      expect(factory.for('beta').calls.interrupt).toBe(0)
    })

    it('forwards interrupt to the named server with the conversation id verbatim (#1092)', async () => {
      // `viewOf` writes the delegating member list exactly once, and every member there is a hand-typed
      // arrow. `interrupt` acquired a parameter in this ticket, and a view that kept the old
      // `() => resolve().interrupt()` shape would still type-check against a widened signature and
      // still count right — it would just send the daemon an `undefined` id, i.e. the bare frame this
      // ticket exists to stop sending. Asserting the recorded ARGUMENT is what catches that.
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()

      registry.connectionFor('beta')?.interrupt('conv-42')

      expect(factory.for('beta').interrupts).toEqual(['conv-42'])
      expect(factory.for('alpha').interrupts).toEqual([])
    })

    it('forwards newSession to the named server with the conversation id verbatim (#1217)', async () => {
      // The `viewOf` delegate is one line, but it is the line that decides WHICH daemon kills a
      // claude process. A view that resolved the wrong entry, or dropped the argument, would restart
      // someone else's conversation silently — the frame is fire-and-forget with no reply to notice.
      const { factory, registry } = harness([record('alpha'), record('beta')])
      await settle()

      registry.connectionFor('alpha')?.newSession('conv-1')

      expect(factory.for('alpha').newSessions).toEqual(['conv-1'])
      expect(factory.for('beta').newSessions).toEqual([])
    })

    it('answers null for an unheld server, and for every id when nothing is paired', async () => {
      const unpaired = harness()
      await settle()
      expect(unpaired.registry.connectionFor('alpha')).toBeNull()

      const paired = harness([record('alpha')])
      await settle()
      expect(paired.registry.connectionFor('beta')).toBeNull()
      expect(paired.registry.connectionFor('__proto__')).toBeNull()
    })

    it('answers null once that server is unpaired, so nothing stays routable', async () => {
      const { store, registry } = harness([record('alpha'), record('beta')])
      await settle()
      expect(registry.connectionFor('alpha')).not.toBeNull()

      store.remove('alpha')
      registry.reconcile()
      await settle()

      expect(registry.connectionFor('alpha')).toBeNull()
      expect(registry.connectionFor('beta')).not.toBeNull()
    })

    it('hands back a view with no lifecycle member AT RUNTIME, as `active` does', async () => {
      const { registry } = harness([record('alpha')])
      await settle()

      const view = registry.connectionFor('alpha')
      expect(view).not.toBeNull()
      for (const surface of [view, registry.active] as Record<string, unknown>[]) {
        // Not merely absent from the type: absent from the object, so a cast at a routing call site
        // recovers no way to start, stop or re-dial one connection (#1117's `ActiveConnection`).
        expect(surface.start).toBeUndefined()
        expect(surface.stop).toBeUndefined()
        expect(surface.reconnect).toBeUndefined()
        expect(typeof surface.send).toBe('function')
      }
    })
  })

  // The sole-entry accessor #1120 routes an ABSENT server id through. The six server-scoped commands
  // carry no id of any kind, so they name their server — and when the window has no per-server
  // surface to name one from yet, this is the bounded, observable fallback: exactly one entry, or the
  // command refuses.
  describe('the sole-entry accessor', () => {
    it('answers the single paired server, with its id beside the connection', async () => {
      const { factory, registry } = harness([record('alpha')])
      await settle()

      const sole = registry.soleConnection()
      expect(sole?.serverId).toBe('alpha')
      sole?.connection.interrupt('conv-1')
      expect(factory.for('alpha').calls.interrupt).toBe(1)
    })

    it('answers the not-paired stand-in, whose id is null, rather than null (#1120 AC4)', async () => {
      // ONE ENTRY, NOT ONE PAIRED RECORD. With nothing paired the registry holds a single stand-in
      // built with `serverId: null`, whose dial IS the failed(not-paired) settle. An accessor written
      // as "exactly one paired record" would answer null here and turn today's inert no-ops into
      // refusals on the unpaired path.
      const { registry } = harness()
      await settle()

      const sole = registry.soleConnection()
      expect(sole).not.toBeNull()
      expect(sole?.serverId).toBeNull()
      expect(() => sole?.connection.interrupt('conv-1')).not.toThrow()
    })

    it('answers null while more than one server is paired, so an unnamed command refuses', async () => {
      const { registry } = harness([record('alpha'), record('beta')])
      await settle()

      expect(registry.soleConnection()).toBeNull()
    })

    it('starts answering again once the set falls back to one entry', async () => {
      const { store, registry } = harness([record('alpha'), record('beta')])
      await settle()
      expect(registry.soleConnection()).toBeNull()

      store.remove('beta')
      registry.reconcile()
      await settle()

      expect(registry.soleConnection()?.serverId).toBe('alpha')
    })

    it('hands back a view with no lifecycle member AT RUNTIME, as `active` and `connectionFor` do', async () => {
      const { registry } = harness([record('alpha')])
      await settle()

      const surface = registry.soleConnection()?.connection as unknown as Record<string, unknown>
      expect(surface.start).toBeUndefined()
      expect(surface.stop).toBeUndefined()
      expect(surface.reconnect).toBeUndefined()
      expect(typeof surface.send).toBe('function')
    })
  })

  describe('secrets stay put (AC5)', () => {
    it('never writes to the store', async () => {
      const { store, registry } = harness([record('alpha')])
      await settle()

      store.save(record('beta'))
      registry.reconcile()
      await settle()
      registry.start()
      await settle()

      expect(store.saves).toEqual([])
    })

    it('treats a server id of __proto__ as an ordinary key and pollutes nothing', async () => {
      const { factory } = harness([record('__proto__'), record('constructor')])
      await settle()

      expect(factory.paired.map((entry) => entry.serverId)).toEqual(['__proto__', 'constructor'])
      expect(Object.prototype.hasOwnProperty.call({}, 'serverId')).toBe(false)
      await expect(factory.for('__proto__').pairedServer.load()).resolves.toEqual(record('__proto__'))
    })

    it('logs a count and a static code, never a server id or a record', async () => {
      const { log } = harness([record('alpha'), record('beta')])
      await settle()

      const serialized = JSON.stringify(log.events)
      expect(log.events).toContainEqual({ event: 'registry-reconciled', count: 2 })
      expect(serialized).not.toContain('alpha')
      expect(serialized).not.toContain('token-')
      expect(serialized).not.toContain('key-')
    })

    it('reaches no console method on any path, the unreadable-collection one included', async () => {
      const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
      const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
      try {
        const { store, registry } = harness([record('alpha')])
        await settle()
        registry.start()
        await settle()
        store.failList(new Error('stored paired-server record is malformed'))
        registry.reconcile()
        await settle()
        registry.stop()

        for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      } finally {
        for (const spy of spies) spy.mockRestore()
      }
    })
  })
})
