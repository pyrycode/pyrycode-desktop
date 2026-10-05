// The connection registry (#1117): the set of live daemon connections follows the set of stored
// paired records. Until this module the composition root built exactly ONE connection, passed it
// `serverId: null`, and treated both pairing lifecycle signals as "re-dial that same object" — so an
// operator with two paired machines reached only whichever was paired last. #1069 made the store hold
// a collection keyed by `server` and #1068 gave each connection its own origin id; this is the piece
// that turns those two into more than one connection.
//
// It is Electron-free, filesystem-free and socket-free: the store, the connection factory and the
// logger are all injected, following `DaemonConnectionDeps`' own `createDriver` / `now` / `mintToken`
// shape, so the unit tests drive fakes. `src/main/index.ts` has no unit test in this repo, which is
// exactly why the reconciliation lives here and the root keeps nothing but the wiring.
//
// LOG-FREE OF CONTENT BY CONSTRUCTION, like every module it sits beside: no `console.*` anywhere, and
// the two diagnostic events it emits carry a COUNT and a static code — never a server id, never a
// record. `DiagnosticEvent` has no server-id field and no index signature, so that is enforced by the
// type system rather than by discipline.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { DaemonConnection } from './daemonConnection'
import type { DiagnosticLog } from './diagnosticLog'
import type {
  MultiPairedServerStore,
  PairedServerRecord,
  PairedServerStore
} from './pairedServerStore'

/**
 * Every `DaemonConnection` member EXCEPT the three lifecycle ones, which the registry owns. This is
 * what the composition root's remaining call sites reach, so they keep their current shape while
 * the object underneath them starts answering for one server among several.
 *
 * `Omit` rather than the whole interface is the load-bearing half: it makes it structurally
 * impossible for a later call site to start, stop or re-dial ONE connection through the stand-in,
 * which is precisely the mistake this module exists to take away from the root. Routing the
 * remaining members per server is #1118/#1119/#1120; until then they reach the connection for the
 * most recently paired server, which is where they reach today after a re-pair.
 */
export type ActiveConnection = Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>

/** Injected dependencies. All three are seams the tests override; none is effectful here. */
export interface ConnectionRegistryDeps {
  /**
   * READ-ONLY BY CONSTRUCTION: a `Pick` without `clear` or `clearServer`, so the registry cannot
   * erase a pairing however it is called. `save` is present only because `PairedServerStore` requires
   * it on the per-server view handed to each connection — this module never calls it.
   */
  store: Pick<MultiPairedServerStore, 'save' | 'load' | 'loadById' | 'list'>
  /**
   * Builds one connection. The root closes the shared dependencies (device keypair, sink, device
   * name, client version, logger) into it and this module supplies the two that vary per server.
   * `serverId` is `null` only for the not-paired stand-in described below.
   */
  createConnection: (spec: {
    serverId: string | null
    pairedServer: PairedServerStore
  }) => DaemonConnection
  /** The one content-free logger (#126), shared with every other transport consumer. */
  diagnosticLog?: DiagnosticLog
}

/** The handle the composition root holds for the process lifetime. */
export interface ConnectionRegistry {
  /**
   * Dial every held connection. Idempotent — it runs on EVERY window's `did-finish-load`, not once —
   * and deferred behind the first store read, so a load that beats that read still dials the right
   * set. A connection built later dials as it is built.
   */
  start(): void
  /** Permanent teardown: stop every held connection and refuse to build another. Idempotent. */
  stop(): void
  /**
   * Re-read the store and make the connection set match it. Synchronous, void and non-throwing, so
   * it satisfies `onPaired` / `onUnpaired`'s must-not-throw `() => void` contract exactly as
   * `reconnect()` does today.
   */
  reconcile(): void
  /** Re-dial exactly one held server; unknown ids and the not-paired stand-in are no-ops. */
  reconnect(serverId: string): void
  /** The stable stand-in the root binds once; see `ActiveConnection`. */
  readonly active: ActiveConnection
  /**
   * The connection for ONE named server, or `null` when no entry holds it — an unpair, or a server
   * that was never paired. `active` answers for the most recently paired server; this answers for the
   * one named, which is the whole difference between a command reaching the right daemon and reaching
   * whichever was paired last (#1118).
   *
   * `ActiveConnection`-shaped like `active`, and by the same construction rather than by a cast: the
   * returned object carries the 22 delegating members and NOTHING ELSE, so a routing call site cannot
   * start, stop or re-dial one connection even by casting. That structural guarantee is this module's
   * to keep, so the member list is written once — see `viewOf`.
   *
   * `serverId` is a `string`, so the not-paired stand-in (whose id is `null`) is unreachable through
   * it: with nothing paired, every conversation-scoped command refuses rather than reaching the inert
   * connection. That is the deterministic half of #1118's AC4 — a known conversation whose server has
   * no entry refuses HERE, whether or not that ticket's index still holds the mapping.
   */
  connectionFor(serverId: string): ActiveConnection | null
  /**
   * The single held entry when there is EXACTLY ONE, else `null`. #1120's bounded fallback: the six
   * server-scoped commands carry no id of any kind to route by, so the window names its server — and
   * until each of its senders has a per-server surface to name one from (#1070/#1085/#1086), an
   * unnamed one reaches the sole connection, or refuses. Never an arbitrary server.
   *
   * ONE ENTRY, NOT ONE PAIRED RECORD, and the difference is load-bearing. The entry list is never
   * empty: with nothing paired it holds a single stand-in built with `serverId: null`, and that
   * stand-in's dial IS the `connecting` → `failed(not-paired)` settle. So an unpaired launch has
   * exactly one entry and those commands stay the inert no-ops they are today. An accessor written as
   * "exactly one paired record" would answer `null` on that path and turn a no-op into a refusal.
   *
   * The untrusted `server` id is not consulted at ALL here — a length check, not a lookup — so this
   * member trivially satisfies the never-an-object-key rule its two siblings state. Its view is built
   * by the same `viewOf` helper, so the `ActiveConnection` `Omit` is enforced by construction on all
   * three accessors rather than by a third hand-copied literal.
   */
  soleConnection(): SoleConnection | null
}

/**
 * One resolved server: the connection to speak to, and the routing key that names it. `serverId` is
 * `null` for exactly one entry — the not-paired stand-in.
 *
 * The id rides beside the connection because one consumer needs both: #1120's debug bundle keys its
 * per-server orchestrator by this id and binds that orchestrator's event sink with it. Answering the
 * connection alone would leave the root re-deriving the key from the renderer's own string, which is
 * the value the resolution exists to stop trusting.
 */
export interface SoleConnection {
  serverId: string | null
  connection: ActiveConnection
}

/**
 * One held connection, plus the two things the registry needs to reason about it: which server it
 * speaks to, and the record it was last dialled against.
 *
 * `record` is what makes a re-pair distinguishable from an untouched server. The values it holds
 * (the bearer `token`, the `server_static_pubkey`) are the same ones the connection beside it already
 * holds inside its `hello` blob and its relay headers, they live no longer than that connection, and
 * they never reach a log, an event or any return value. `serverId`/`record` are `null` together, and
 * only for the stand-in.
 */
interface Entry {
  serverId: string | null
  record: PairedServerRecord | null
  connection: DaemonConnection
}

/**
 * Field-for-field record equality. Written out by name rather than as a key loop or a JSON compare so
 * a field added to `QrPayload` is a compile error here instead of a silently-ignored difference that
 * would leave a stale connection dialling the old value.
 */
function sameRecord(a: PairedServerRecord, b: PairedServerRecord): boolean {
  return (
    a.server === b.server &&
    a.relay === b.relay &&
    a.token === b.token &&
    a.server_static_pubkey === b.server_static_pubkey
  )
}

/**
 * Build the registry. Construction is SYNCHRONOUS and does its own store read afterwards, which is
 * what lets `app.whenReady().then(() => { … })` stay non-`async`: two shipped comments in the root
 * argue that registering a handler late in that callback is safe *because* the whole callback
 * completes in one tick, and an `await` there would silently retire that argument.
 *
 * THE ENTRY LIST IS NEVER EMPTY, and that is the invariant everything else rests on. When no record
 * is stored it holds exactly one connection built with `serverId: null` over the WHOLE store — which
 * is byte-for-byte the connection the root built before this module existed. So the not-paired
 * behaviour AC4 preserves is not re-emitted from a second place; it is produced by running the same
 * code, and `active` needs no null branch and no duplicated `not-connected` literals.
 */
export function createConnectionRegistry(deps: ConnectionRegistryDeps): ConnectionRegistry {
  const { store, createConnection } = deps

  // Three cells, all module-local. No timer, no listener, no subscription — each connection owns its
  // own driver, supervisor and generation fence, so there is nothing here to cancel that `stop()`
  // does not already reach.
  let entries: Entry[] = []
  // ONE flag, not a "start was asked for" plus a "start has happened": it flips inside the deferred
  // callback, which is the single place any connection is dialled at the transition. A second
  // `did-finish-load` scheduling a second callback finds it already true and returns, so the plural
  // start is idempotent the way each connection's own `start()` is.
  let dialling = false
  let stopped = false

  /**
   * The per-server view of the collection. Structurally a `PairedServerStore`, so `loadDialConfig`
   * reads THAT server's record with zero changes to `daemonConnection.ts` — on the first dial and on
   * every automatic supervisor re-dial, which re-sources through the same provider.
   *
   * `loadById`, never `load()`: `load()` answers the most recently saved entry, so a second pairing
   * would silently re-point the first connection at the new record — dialling one server's relay and
   * static key with another server's token. `serverId` never becomes a store name, a path or an
   * object key; the store matches it with `===` against its own decoded entries.
   */
  const viewFor = (serverId: string): PairedServerStore => ({
    save: (record) => store.save(record),
    load: () => store.loadById(serverId)
  })

  /**
   * ONE `serverId` local, minted once from the record and used twice — as the connection's origin
   * stamp and as its view's key. A drift between those two is the worst bug this module could ship
   * (a connection presenting one server's token against another's static key), so they are not
   * allowed to be two expressions.
   */
  const build = (record: PairedServerRecord): Entry => {
    const serverId = record.server
    return {
      serverId,
      record,
      connection: createConnection({ serverId, pairedServer: viewFor(serverId) })
    }
  }

  /**
   * The not-paired stand-in: `serverId: null` over the whole store, exactly today's root connection.
   * A fresh one each time, because `stop()` sets a permanent flag — a stopped connection can never be
   * reused.
   */
  const buildStandIn = (): Entry => ({
    serverId: null,
    record: null,
    connection: createConnection({ serverId: null, pairedServer: store })
  })

  entries = [buildStandIn()]

  /** The connection every `active` member reaches. Total: `entries` is never empty. */
  const current = (): DaemonConnection => entries[entries.length - 1].connection

  /**
   * An `ActiveConnection` view over a resolver: delegation only, adding no behaviour of its own, with
   * every member resolving its connection at CALL time.
   *
   * THE MEMBER LIST IS WRITTEN EXACTLY ONCE, here, and that is the point of the helper rather than a
   * tidiness preference. `active` and `connectionFor` both hand a caller an object that must carry the
   * every non-lifecycle member and NOT the three lifecycle ones; a second hand-copied literal could drift, and
   * returning a bare `DaemonConnection` typed as `ActiveConnection` would satisfy the type while
   * leaving `start` / `stop` / `reconnect` reachable at runtime by a cast. A fresh object with only
   * these members makes the `Omit` true of the value, not just of its type.
   */
  const viewOf = (resolve: () => DaemonConnection): ActiveConnection => ({
    requestHostSystemPrompt: (requestId) => resolve().requestHostSystemPrompt(requestId),
    setHostSystemPrompt: (text, requestId) => resolve().setHostSystemPrompt(text, requestId),
    send: (payload) => resolve().send(payload),
    requestSessionSettings: (conversationId) => resolve().requestSessionSettings(conversationId),
    requestModelList: (conversationId) => resolve().requestModelList(conversationId),
    requestContextUsage: (conversationId) => resolve().requestContextUsage(conversationId),
    requestMcpStatus: (conversationId) => resolve().requestMcpStatus(conversationId),
    reconnectMcpServer: (conversationId, serverName) => resolve().reconnectMcpServer(conversationId, serverName),
    toggleMcpServer: (conversationId, serverName, enabled) =>
      resolve().toggleMcpServer(conversationId, serverName, enabled),
    stopBackgroundTask: (conversationId, taskId) => resolve().stopBackgroundTask(conversationId, taskId),
    requestHistory: (payload) => resolve().requestHistory(payload),
    requestSystemPrompt: (conversationId) => resolve().requestSystemPrompt(conversationId),
    requestConversations: () => resolve().requestConversations(),
    requestRecentWorkspaces: () => resolve().requestRecentWorkspaces(),
    createConversation: (payload) => resolve().createConversation(payload),
    createWorkspaceFolder: (payload) => resolve().createWorkspaceFolder(payload),
    dequeueMessage: (payload) => resolve().dequeueMessage(payload),
    interrupt: (conversationId) => resolve().interrupt(conversationId),
    newSession: (conversationId) => resolve().newSession(conversationId),
    promoteConversation: (payload) => resolve().promoteConversation(payload),
    archiveConversation: (payload) => resolve().archiveConversation(payload),
    unarchiveConversation: (payload) => resolve().unarchiveConversation(payload),
    deleteConversation: (payload) => resolve().deleteConversation(payload),
    renameConversation: (payload) => resolve().renameConversation(payload),
    changeWorkspace: (payload) => resolve().changeWorkspace(payload),
    renameWorkspace: (payload, attemptId) => resolve().renameWorkspace(payload, attemptId),
    setSystemPrompt: (payload) => resolve().setSystemPrompt(payload),
    setConversationMuted: (payload, attemptId) => resolve().setConversationMuted(payload, attemptId),
    setSessionSettings: (payload, changeId) => resolve().setSessionSettings(payload, changeId),
    answerModal: (payload) => resolve().answerModal(payload),
    cancelModal: (payload) => resolve().cancelModal(payload),
    answerQuestions: (payload) => resolve().answerQuestions(payload),
    refuseQuestions: (payload) => resolve().refuseQuestions(payload),
    requestDebugBundle: (consumer) => resolve().requestDebugBundle(consumer),
    uploadAttachment: (input, onProgress) => resolve().uploadAttachment(input, onProgress),
    requestAttachment: (payload, consumer) => resolve().requestAttachment(payload, consumer),
    readWorkspaceFile: (payload, consumer) => resolve().readWorkspaceFile(payload, consumer)
  })

  /** Dial a freshly built entry if the set is already dialling; otherwise `start()` will reach it. */
  const adopt = (entry: Entry): Entry => {
    if (dialling) entry.connection.start()
    return entry
  }

  const runReconcile = async (): Promise<void> => {
    if (stopped) return
    let records: PairedServerRecord[]
    try {
      records = await store.list()
    } catch {
      // The stored collection is present but unreadable (#1069's `MalformedPairedServerRecordError`),
      // or the keychain is unavailable. CHANGE NOTHING: a set that is running must not be torn down
      // because one read failed, and at launch the stand-in is still the only entry, so it dials and
      // its own bootstrap settles `failed(connect-failed)` — today's behaviour exactly. The caught
      // object is DROPPED (classify-don't-forward): a decode or keychain message can echo the blob.
      deps.diagnosticLog?.event({ event: 'registry-reconcile-failed', code: 'unreadable-collection' })
      return
    }
    // Re-checked after the await, mirroring `bootstrap`'s own post-await `stopped` check: a
    // `will-quit` landing while this was suspended must not resume into building and dialling relay
    // sockets after the app has stopped.
    if (stopped) return

    const previous = entries
    const paired = records.map((record) => {
      // A linear scan with `===`, never an object lookup: `server` is untrusted QR/paste input, and a
      // `Record<string, Entry>` indexed by `__proto__` would be prototype pollution reachable from a
      // pasted payload. `decodeCollection` already rejects a repeated id, so this can never have to
      // choose between two entries for one server.
      const held = previous.find((entry) => entry.serverId === record.server)
      if (held === undefined) return adopt(build(record))
      // A record changing under a live connection IS a re-pair (`save` replaces by `server` key), so
      // re-dial that one alone — what today's `reconnect()` does. An identical record is an untouched
      // server: no reconnect, no re-handshake, which is what lets one code path serve both the
      // pairing and the unpair signal.
      if (held.record !== null && !sameRecord(held.record, record)) {
        held.connection.reconnect()
      }
      return { serverId: held.serverId, record, connection: held.connection }
    })

    // The set is never empty: with no record it is the not-paired stand-in. An already-held stand-in
    // is REUSED rather than rebuilt, so the common unpaired launch — construct, then reconcile to the
    // same empty set — neither builds a second one nor stops the connection whose dial IS the
    // not-paired settle. A fresh one is built only when the last record has just been cleared.
    const heldStandIn = previous.length === 1 && previous[0].serverId === null ? previous[0] : null
    const next = paired.length > 0 ? paired : [heldStandIn ?? adopt(buildStandIn())]

    // Everything that did not survive — including the stand-in as soon as any record exists. `stop()`
    // closes the relay socket and suppresses the resulting terminal, so a drop is silent.
    for (const entry of previous) {
      if (!next.some((survivor) => survivor.connection === entry.connection)) entry.connection.stop()
    }

    entries = next
    deps.diagnosticLog?.event({ event: 'registry-reconciled', count: entries.length })
  }

  // Reconciles run ONE AT A TIME through this chain — `pairedServerStore`'s own `mutate` idiom, and
  // for the same reason: the body is a read-modify-write across an `await`, so two signals arriving
  // in quick succession would each compute their target set from the same stale snapshot and both
  // build a connection for the new record. The chain continues across a rejected operation
  // (`then(op, op)`) so one failure cannot wedge the registry, and its own copy of the outcome is
  // swallowed so a rejection is never unhandled.
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = (): Promise<unknown> => {
    const run = queue.then(runReconcile, runReconcile)
    queue = run.then(
      () => undefined,
      () => undefined
    )
    return queue
  }

  // The first read, kicked synchronously so the constructor returns in the caller's tick. Everything
  // `start()` does waits behind it.
  const ready = enqueue()

  return {
    start(): void {
      if (stopped || dialling) return
      // Deferred behind the first read rather than dialling whatever is held right now: a
      // `did-finish-load` that beat that read would otherwise dial the stand-in and have it torn down
      // microseconds later. `stopped` is re-checked when this fires, for the reconcile body's reason,
      // and `dialling` again — two loads can both schedule before the first read answers.
      void ready.then(() => {
        if (stopped || dialling) return
        dialling = true
        for (const entry of entries) entry.connection.start()
      })
    },
    stop(): void {
      if (stopped) return
      stopped = true
      // Every entry, not just the active one — a quit that reached one connection would leak the rest
      // of the sockets. Each `stop()` is itself idempotent.
      for (const entry of entries) entry.connection.stop()
    },
    reconcile(): void {
      void enqueue()
    },
    reconnect(serverId: string): void {
      // Exact scan like connectionFor: the id is never an object key, and null cannot match.
      const held = entries.find((entry) => entry.serverId === serverId)
      held?.connection.reconnect()
    },
    /**
     * ONE object, built once, whose members resolve the current connection at CALL time — so the root
     * binds it once and its call sites never hold a stale reference. Delegation only: this adds no
     * behaviour of its own, and no member can reach a connection's lifecycle (see `ActiveConnection`).
     */
    active: viewOf(current),
    connectionFor(serverId: string): ActiveConnection | null {
      // A linear scan with `===`, never an object lookup, for `runReconcile`'s reason: `server` is
      // untrusted QR/paste input and a `Record<string, Entry>` indexed by `__proto__` would be
      // prototype pollution reachable from a pasted payload. `null` on the stand-in too — its id is
      // `null` and this parameter is a `string`, so the two can never match.
      const held = entries.find((entry) => entry.serverId === serverId)
      if (held === undefined) return null
      // Resolves through the entry at call time, like `active`. The caller uses the view in the same
      // tick, so it cannot go stale in practice — and a stale one is inert rather than dangerous:
      // every member is a documented no-op once the connection has been `stop()`ped, so a view over a
      // dropped connection puts nothing on any wire.
      return viewOf(() => held.connection)
    },
    soleConnection(): SoleConnection | null {
      // `entries` is never empty, so this is "more than one" rather than "none or more than one" —
      // and it reads the LENGTH, never an id, so no untrusted string is compared or indexed by here
      // at all. The stand-in is a held entry like any other, which is what makes the unpaired launch
      // answer rather than refuse.
      if (entries.length !== 1) return null
      const held = entries[0]
      // Resolves through the entry at call time, like both siblings, and built by the same `viewOf`
      // so the lifecycle members are absent from the VALUE and not merely from its type.
      return { serverId: held.serverId, connection: viewOf(() => held.connection) }
    }
  }
}
