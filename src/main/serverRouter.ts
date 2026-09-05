// The server router (#1120): a command that is about a WHOLE server — list its conversations, create
// a chat on it, interrupt its running turn, pull its debug bundle — reaches the server it names, and
// no other. #1117 made the number of connections follow the number of stored paired records; #1118
// and #1119 then routed everything carrying an id of its own. What was left on `registry.active` is
// everything with NO id of any kind to route by, and with two servers paired each of those reached
// whichever host was paired most recently.
//
// THIS IS NOT A THIRD INDEX, AND THAT IS THE WHOLE DIFFERENCE FROM ITS TWO SIBLINGS.
// `conversationRouter.ts` and `correlationRouter.ts` learn a server id off a STAMPED DAEMON EVENT and
// refuse anything they have not seen; they can trust what they hold because a daemon put it there.
// Here the id comes from the WINDOW, which is untrusted, so "resolve against the registry, never
// trust the hint" is the security property rather than a style note. There is no map, no cell, no
// cap and no `observe` below — a lookup against the held entry set plus a refusal is the entire
// module, and it holds no state at all.
//
// THE DECISION LIVES HERE RATHER THAN IN THE SWITCH, for #1118's recorded reason: `src/main/index.ts`
// has no unit test in this repo and never has, so six hand-written guard blocks in the command switch
// would make the refusal — the safety property — provable by nothing. The root keeps its per-case
// one-liners; this module owns the lookup, the refusal and the log.
//
// REFUSING IS THE POINT, NOT A CONVENIENCE. There is no fallback to "the first connection" or "the
// most recent one" anywhere below. The one-connection fallback is not such a fallback: it is bounded
// and observable — exactly one held entry, or refuse — and it exists so that today's single-server
// behaviour is unchanged while the window's senders acquire a per-server surface to name (#1070,
// #1085, #1086) one at a time.
//
// It is Electron-free, socket-free and store-free, and it never calls a connection member — it looks
// one up and hands it back. Hence the type parameter: the concrete `ActiveConnection` would be false
// coupling here, and the `Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>` guarantee is spent
// at the registry's accessors, where it belongs.
//
// LOG-FREE OF CONTENT BY CONSTRUCTION, like every module it sits beside: no `console.*` anywhere, and
// every diagnostic it emits is a static event name plus a static code. `DiagnosticEvent` has no
// identifier-shaped field and no index signature, so a server id CANNOT be logged from here without
// widening a renderer-facing security contract (#126's allowlist, mirrored by
// `RendererDiagnosticEvent` and pinned by `receiveDiagnostic.test.ts`'s Omit) — deliberately out of
// scope for a main-process routing slice, as it was for #1118 and #1119.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { DiagnosticLog } from './diagnosticLog'

/**
 * One resolved server: the connection to speak to, and the routing key that names it.
 *
 * The id rides BESIDE the connection because one consumer needs both. The debug bundle keys its
 * per-server orchestrator by this id and binds that orchestrator's event sink with it, so a
 * connection alone would leave the root re-deriving a key the resolution already computed — and
 * re-deriving it from the renderer's own string, which is precisely the value this module exists to
 * stop trusting.
 *
 * `serverId` is `null` for exactly one entry: the registry's not-paired stand-in, reachable only
 * through the one-connection fallback (a NAMED request cannot reach it — see `resolve`).
 */
export interface ServerTarget<C> {
  serverId: string | null
  connection: C
}

/** Injected dependencies. Both lookups are the registry's; neither is effectful here. */
export interface ServerRouterDeps<C> {
  /**
   * The registry's per-server accessor. `null` means that server has no live connection — an unpair,
   * or a server that was never paired at all.
   *
   * THIS LOOKUP IS THE BOUNDARY. The window can name a server; it cannot conjure one. An id that no
   * held entry matches refuses here, whatever the renderer believes about it.
   */
  connectionFor: (serverId: string) => C | null
  /**
   * The registry's sole-entry accessor: the single held entry when there is exactly one, else `null`.
   *
   * ONE ENTRY, NOT ONE PAIRED RECORD. The entry list is never empty — with nothing paired it holds a
   * single stand-in whose dial IS the `connecting` → `failed(not-paired)` settle — so an unpaired
   * launch has exactly one entry and the commands below stay the inert no-ops they are today.
   */
  soleConnection: () => ServerTarget<C> | null
  /** The one content-free logger (#126), shared with every other transport consumer. */
  diagnosticLog?: DiagnosticLog
}

/** The handle the composition root holds for the process lifetime. */
export interface ServerRouter<C> {
  /**
   * The server this command is for, or `null` HAVING ALREADY REFUSED AND LOGGED — with the routing
   * key beside the connection. The debug bundle takes this form; every other call site takes `route`.
   *
   * Takes `string | undefined` (#1118's own shape) so the optional command field needs no separate
   * branch at any call site: an absent id is the one-connection fallback, on the ordinary path.
   */
  resolve(serverId: string | undefined): ServerTarget<C> | null
  /**
   * `resolve`'s connection alone, so the five plain call sites stay the one-liners #1118 established:
   * `servers.route(command.serverId)?.requestConversations()`. The `?.` is the refusal, not a silent
   * shrug — an unresolvable id puts a frame on no wire at all.
   */
  route(serverId: string | undefined): C | null
}

/**
 * Build the router. Construction is synchronous and total: no store read, no timer, no listener, no
 * async work and no state — so there is nothing here for `will-quit` to tear down, and no
 * check-then-act gap, because a lookup and its use are one expression in one tick.
 */
export function createServerRouter<C>(deps: ServerRouterDeps<C>): ServerRouter<C> {
  const { connectionFor, soleConnection, diagnosticLog } = deps

  /**
   * The whole decision, written once so the safety property has one implementation rather than two.
   * Exactly three outcomes, and no fallback to an arbitrary server:
   *
   * 1. an id naming a connected server → that server;
   * 2. an id naming no connected server → refused, `server-not-connected`;
   * 3. an absent id → the sole entry when the registry holds exactly one, else refused,
   *    `ambiguous-server`.
   *
   * `''` IS A NAME, NOT AN OMISSION. It is a present string, so it takes the named branch and refuses
   * (no record's `server` is empty). Special-casing it as absent would let a renderer reach the sole
   * connection by sending nothing meaningful, which is the arbitrary-server fallback under a
   * different spelling.
   *
   * A NAMED REQUEST CANNOT REACH THE NOT-PAIRED STAND-IN: `connectionFor` takes a `string` and the
   * stand-in's id is `null`, so the two can never match — the structural guarantee `connectionFor`'s
   * own docblock states for #1118, inherited here rather than re-argued.
   */
  const resolve = (serverId: string | undefined): ServerTarget<C> | null => {
    if (serverId === undefined) {
      const sole = soleConnection()
      if (sole === null) {
        diagnosticLog?.event({ event: 'server-route-refused', code: 'ambiguous-server' })
        return null
      }
      return sole
    }
    const connection = connectionFor(serverId)
    if (connection === null) {
      diagnosticLog?.event({ event: 'server-route-refused', code: 'server-not-connected' })
      return null
    }
    // `serverId` has narrowed to `string`, so the key this target carries CANNOT disagree with the id
    // it was resolved for. There is nothing to delete on this branch, unlike #1118/#1119's hygiene
    // deletes — this module holds no mapping that could go stale.
    return { serverId, connection }
  }

  return {
    resolve,
    route(serverId: string | undefined): C | null {
      const target = resolve(serverId)
      return target === null ? null : target.connection
    }
  }
}
