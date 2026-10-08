// The conversation router (#1118): a command about a conversation reaches the server that OWNS that
// conversation, and no other. #1117 made the number of connections follow the number of stored paired
// records, but left one way out of the registry — `active`, whose members resolve to the LAST entry at
// call time — so the composition root's command switch still reached a single connection; it was just
// no longer the right one. With two servers paired, a message about a conversation on host A went to
// whichever host was paired most recently. This module is what stops that.
//
// THE DECISION LIVES HERE RATHER THAN IN THE SWITCH because nothing could test it there:
// `src/main/index.ts` has no unit test in this repo and never has (`connectionRegistry.ts`'s header
// says so, and says that is exactly why #1117 put its reconciliation in an injectable module), and the
// fake e2e tier cannot easily produce an unknown conversation id. Ten hand-written guard blocks in the
// switch would make the refusal — the safety property — provable by nothing. The root keeps its
// per-case one-liners; this module owns the lookup, the refusal and the log.
//
// REFUSING IS THE POINT, NOT A CONVENIENCE. There is no fallback to "the first connection" or "the
// most recent one" anywhere below: a message addressed to a conversation on host A must not reach host
// B under any circumstance, which is the whole reason this index lives in the background process
// instead of trusting a routing hint from the window.
//
// It is Electron-free, socket-free and store-free, and it never calls a connection member — it looks
// one up and hands it back. Hence the type parameter: the concrete `ActiveConnection` would be false
// coupling here, and the `Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>` guarantee is spent
// at the registry's accessor, where it belongs.
//
// LOG-FREE OF CONTENT BY CONSTRUCTION, like every module it sits beside: no `console.*` anywhere, and
// every diagnostic it emits is a static event name plus a static code. `DiagnosticEvent` has no
// identifier-shaped field and no index signature, so a conversation id CANNOT be logged from here
// without widening a renderer-facing security contract (#126's allowlist, mirrored by
// `RendererDiagnosticEvent` and pinned by `receiveDiagnostic.test.ts`'s Omit) — deliberately out of
// scope for a main-process routing slice.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { DaemonEventSink } from './emitDaemonEvent'
import type { DaemonEvent } from '../shared/ipc/events'
import type { DiagnosticLog } from './diagnosticLog'

/**
 * Upper bound on the conversation→server index, in entries.
 *
 * The index only ever GROWS — a later list never un-knows a conversation, because the window's open
 * thread holds its id independently of the list store, and un-knowing one would turn a conforming
 * command into a refusal. That is the right trade, and this is what pays for it: a hostile or
 * confused daemon spraying distinct ids is bounded at roughly this many pairs of short strings (≈1 MB)
 * rather than at main-process memory.
 *
 * FAILS CLOSED. At the cap a NEW id is not learned, so it refuses rather than mis-routes; an EXISTING
 * id may still re-point, since an overwrite does not grow the map. 10 000 is three orders of magnitude
 * above what any real daemon reports, so no operator reaches it. The repo's own idiom — a code-level
 * cap, not a stochastic rule (`MAX_SAFE_BYTES`, `MAX_RETRIEVAL_IDENTIFIER_LENGTH`,
 * `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS`).
 */
export const MAX_INDEXED_CONVERSATIONS = 10_000

/** Injected dependencies. Both are seams the tests override; neither is effectful here. */
export interface ConversationRouterDeps<C> {
  /**
   * The registry's per-server accessor. `null` means that server has no live connection — an unpair,
   * or a server that was never paired at all.
   *
   * THIS LOOKUP IS THE BOUNDARY, not the index's own bookkeeping. A known conversation whose server
   * has no entry refuses on this side whether or not the index still holds the mapping, so an unpair
   * cannot leave anything routable. The mapping deletion beside it (see `route`) is hygiene.
   */
  connectionFor: (serverId: string) => C | null
  /** The one content-free logger (#126), shared with every other transport consumer. */
  diagnosticLog?: DiagnosticLog
}

/** The handle the composition root holds for the process lifetime. */
export interface ConversationRouter<C> {
  /**
   * Wrap one producer's sink: record the conversation→server mapping off each stamped conversation
   * event, then forward the event UNCHANGED. Applied once per connection, in the `sink:` position of
   * `createDaemonConnection` — see the recording function below for why that position is the one that
   * works.
   */
  observe(target: DaemonEventSink): DaemonEventSink
  /**
   * The connection that owns this conversation, or `null` HAVING ALREADY REFUSED AND LOGGED. That is
   * what keeps the root's ten call sites one-liners (`router.route(id)?.send(payload)`) while leaving
   * the whole decision in a module the tests can drive.
   *
   * Takes `string | undefined` so `requestSessionSettings`' optional id needs no separate branch at
   * the call site: an absent id is not a known conversation, so it refuses on the ordinary path.
   */
  route(conversationId: string | undefined, observedHost?: string): C | null
}

/**
 * Read the server origin off an event that has already been through `bindServerOrigin`.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the
 * wrapper's parameter as `StampedDaemonEvent`: at a `DaemonEventSink`-typed hole the static type is
 * the BARE union (#1068 carries the stamp beside the union, not inside its arms), and a re-declared
 * parameter would compile only because method parameters are bivariant — sound-looking and unsound.
 * `isAttachmentRetrievalRequest`'s idiom, applied to the one property this module reads.
 *
 * `null` for the registry's not-paired stand-in (which owns no conversation) and for an unbound
 * producer (which `bindServerOrigin`'s header forbids); both are skipped rather than trusted.
 */
function originOf(event: DaemonEvent): string | null {
  if (!('serverId' in event)) return null
  const { serverId } = event
  return typeof serverId === 'string' && serverId.length > 0 ? serverId : null
}

/**
 * Build the router. Construction is synchronous and total: two module-local cells, no store read, no
 * timer, no listener, no async work — so there is nothing here for `will-quit` to tear down and no
 * check-then-act gap between learning a mapping and using it.
 */
export function createConversationRouter<C>(deps: ConversationRouterDeps<C>): ConversationRouter<C> {
  const { connectionFor, diagnosticLog } = deps

  // A Map, NEVER a bare object. Both the key and the value are daemon-supplied strings, and a
  // `Record<string, string>` written through `__proto__` is prototype pollution reachable from a
  // hostile or confused daemon. `events.ts`'s ServerOrigin docblock already rules this for the server
  // id ("if a consumer indexes by it, THE INDEX IS A Map"); it holds identically for the conversation
  // id, which arrives on the same wire.
  const index = new Map<string, string>()
  // Latched, so a daemon spraying rows past the cap produces ONE record rather than one per row. The
  // two other diagnostics below are either renderer-driven at one line per refused command (bounded by
  // the rotating sink) or gated on an actual change; this one is the only daemon-driven-per-row site.
  let capLogged = false

  /**
   * Learn one conversation's owner. The stamp is the origin `bindServerOrigin` already wrote — this
   * module adds no second stamping path, and could not: it reads what the renderer reads, so the index
   * can never disagree with the list the window renders.
   *
   * LAST WRITE WINS, which is the re-point AC1 asks for. A conversation genuinely can move hosts (a
   * daemon restored on new hardware), and first-write-wins would make a moved conversation permanently
   * unroutable; the renderer's own conversation-list store has the same property, so an index with a
   * different rule would show a row under one host while the message went to another. A re-point that
   * actually CHANGES the owner is logged: it is the one state change a hostile paired host could use
   * to claim another host's conversation (it would still need that host's unguessable UUIDv4), so it
   * leaves a trace in the bundle instead of none.
   */
  const claims = new Map<string, Set<string>>()
  const learn = (conversationId: string, serverId: string): void => {
    if (conversationId.length === 0) return
    const held = index.get(conversationId)
    if (held === serverId) return
    if (held === undefined && index.size >= MAX_INDEXED_CONVERSATIONS) {
      if (!capLogged) {
        capLogged = true
        diagnosticLog?.event({ event: 'conversation-index-full', code: 'cap-reached' })
      }
      return
    }
    index.set(conversationId, serverId)
    if (held !== undefined) {
      diagnosticLog?.event({ event: 'conversation-reindexed', code: 'reassigned' })
    }
  }

  /** The two arms that name a conversation and its server. Every other arm is read for nothing. */
  const record = (event: DaemonEvent): void => {
    const serverId = originOf(event)
    if (serverId === null) return
    if (event.type === 'conversationsReceived') {
      for (const [id, owners] of claims) {
        owners.delete(serverId)
        if (owners.size === 0) claims.delete(id)
      }
      for (const conversation of event.conversations) {
        learn(conversation.id, serverId)
        if (!index.has(conversation.id)) continue
        const owners = claims.get(conversation.id) ?? new Set<string>()
        owners.add(serverId); claims.set(conversation.id, owners)
      }
      return
    }
    if (event.type === 'conversationDeleted') {
      const owners = claims.get(event.id)
      owners?.delete(serverId)
      if (owners?.size === 0) claims.delete(event.id)
    }
    if (event.type === 'conversationCreated') learn(event.conversation.id, serverId)
  }

  return {
    observe(target: DaemonEventSink): DaemonEventSink {
      return {
        // #518 IS PRESERVED ACROSS THE EXTRA HOP, and the ordering is emitDaemonEvent's own.
        // `target.webContents` is read ONLY inside `send`'s body — never here, never aliased or
        // destructured above — because on a real destroyed BrowserWindow that property read IS the
        // throw. Wrapping a destroyed target is therefore itself safe.
        isDestroyed: () => target.isDestroyed(),
        webContents: {
          send: (channel: string, event: DaemonEvent): void => {
            // RECORD BEFORE FORWARD. This is the whole no-race argument: anything the window can name,
            // the index has already seen. Reversing these two lines would open a window in which a
            // renderer that acts on an event synchronously routes against a stale index.
            record(event)
            target.webContents.send(channel, event)
          }
        }
      }
    },
    route(conversationId: string | undefined, observedHost?: string): C | null {
      let serverId = conversationId === undefined ? undefined : index.get(conversationId)
      // Both halves in one condition, so `conversationId` narrows to `string` below and the delete
      // needs no cast — an absent id and an unplaceable one are the same refusal either way.
      if (conversationId === undefined || serverId === undefined) {
        diagnosticLog?.event({ event: 'conversation-route-refused', code: 'unknown-conversation' })
        return null
      }
      if (observedHost !== undefined) {
        const owners = [...(claims.get(conversationId) ?? [])].filter(host => connectionFor(host) !== null)
        if (owners.length !== 1 || owners[0] !== observedHost) {
          diagnosticLog?.event({ event: 'conversation-route-refused', code: 'observed-host-mismatch' })
          return null
        }
        // Current claims can outlive the last-indexed host's list, deletion or pairing.
        serverId = observedHost
      }
      const connection = connectionFor(serverId)
      if (connection === null) {
        // The refusal above is the boundary; this deletion is hygiene, applied at the one moment the
        // stale mapping could ever have mattered. There is deliberately NO reconcile-driven sweep:
        // `registry.reconcile()` is asynchronous, so a prune called beside it would run before the
        // registry had dropped anything and be a no-op on exactly the unpair path it was written for.
        index.delete(conversationId)
        claims.delete(conversationId)
        diagnosticLog?.event({ event: 'conversation-route-refused', code: 'server-not-connected' })
        return null
      }
      return connection
    }
  }
}
