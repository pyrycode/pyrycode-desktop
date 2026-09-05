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
}

/** Records every construction and every lifecycle call, so a test can assert which one was touched. */
function createFactoryFake() {
  const built: BuiltConnection[] = []
  const createConnection = (spec: {
    serverId: string | null
    pairedServer: PairedServerStore
  }): DaemonConnection => {
    const calls = { start: 0, stop: 0, reconnect: 0, interrupt: 0 }
    built.push({ serverId: spec.serverId, pairedServer: spec.pairedServer, calls })
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
      interrupt: () => {
        calls.interrupt += 1
      },
      send: noop,
      requestSessionSettings: noop,
      requestConversations: noop,
      requestRecentWorkspaces: noop,
      createConversation: noop,
      createWorkspaceFolder: noop,
      dequeueMessage: noop,
      promoteConversation: noop,
      archiveConversation: noop,
      unarchiveConversation: noop,
      deleteConversation: noop,
      renameConversation: noop,
      changeWorkspace: noop,
      setSessionSettings: noop,
      answerModal: noop,
      cancelModal: noop,
      answerQuestions: noop,
      refuseQuestions: noop,
      requestDebugBundle: noop,
      uploadAttachment: async () => ({ ok: true }),
      requestAttachment: noop
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

      registry.active.interrupt()
      expect(factory.for('beta').calls.interrupt).toBe(1)

      // A re-pair of alpha moves it to the end of the collection, so `store.load()` — and therefore
      // the active connection — becomes alpha's again.
      store.save(record('alpha', 'rotated-token'))
      registry.reconcile()
      await settle()

      registry.active.interrupt()
      expect(factory.for('alpha').calls.interrupt).toBe(1)
      expect(factory.for('beta').calls.interrupt).toBe(1)
    })

    it('is inert rather than throwing before the first store read resolves', () => {
      const { registry } = harness([record('alpha')])

      expect(() => registry.active.interrupt()).not.toThrow()
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
