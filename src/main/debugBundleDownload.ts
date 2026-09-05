// The debug-bundle download orchestrator (#169) — the composition-root consumer that turns the
// bare `requestDebugBundle` command into a single terminal DaemonEvent. On a request it builds the
// per-download BundleConsumer, drives request → reassemble → save, reports progress, and emits one
// terminal result to the window. This is the ONLY debug-bundle slice that touches IPC (via the
// injected `emit`); the transport (#116) and persistence (#117) slices stay IPC-free.
//
// INFORMATION-MINIMISING BOUNDARY. The renderer is untrusted and the reassembled bundle is
// sensitive. The transport's finer BundleFailReason set plus any save errno collapse here onto the
// three coarse DebugBundleFailure categories; the only fields that ever reach `emit` are a chunk
// count (number), a local filesystem path (string), and the closed category enum — never a token,
// key, raw frame, save errno, or bundle byte. `complete`'s bytes go only to `save` (disk).
//
// PER SERVER SINCE #1120. The bundle is a whole SERVER's, so a request names its server and the
// download runs against that server's connection: `createDebugBundleDownloads` below holds one
// orchestrator per server, each with its own in-flight gate and its own origin-bound sink, so two
// servers can download at once while one server still cannot be asked twice. What each orchestrator
// does NOT hold is a connection — that arrives per ask, see `DebugBundleDownload.request`.
//
// MAIN-PROCESS ONLY, but Electron-free and unit-testable: the composition root injects the live deps
// (a dir-closed saveDebugBundle, an origin-bound emitDaemonEvent) and supplies the connection's
// `requestDebugBundle` at each ask.
//
// LOG-FREE by construction: a diagnostic here could echo the saved path or become a seam that later
// logs the dropped errno/bytes. The save-reject errno is caught and discarded, never logged.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { BundleConsumer, BundleFailReason } from './transport/bundleReassembler'
import type { DaemonEvent, DebugBundleFailure } from '../shared/ipc/events'

/**
 * The injected collaborators, all Electron-free so the orchestrator unit-tests without a window.
 *
 * PER SERVER SINCE #1120, and `requestDebugBundle` is deliberately NOT among them — see `request`.
 * `emit` is bound to ONE server's origin (`bindServerOrigin(live.sink, serverId)`, bound once per
 * server exactly as each connection's is), so the progress and terminal events an orchestrator emits
 * carry the id of the server whose bundle they describe.
 */
export interface DebugBundleDownloadDeps {
  /** Persist the archive, resolving the written absolute path — a `dir`-closed saveDebugBundle. */
  save: (bytes: Uint8Array) => Promise<string>
  /** The one path to the window — `e => emitDaemonEvent(bindServerOrigin(live.sink, serverId), e)`. */
  emit: (event: DaemonEvent) => void
}

/** The orchestrator handle: the one method the composition-root command switch calls. */
export interface DebugBundleDownload {
  /**
   * Start a download, unless one is already in flight (single-in-flight short-circuit).
   *
   * THE ARMING FUNCTION IS AN ARGUMENT, NOT A CONSTRUCTION DEP (#1120), and that is the whole shape
   * of "one orchestrator per server, one connection per ask". The state this object holds — the
   * in-flight gate, and through it the transport's reassembler slot — only means anything ACROSS asks,
   * so it must outlive any single request; a connection must not. A server unpaired and re-paired gets
   * a NEW `DaemonConnection` (the registry drops and `stop()`s the old entry), and a captured view over
   * the stopped one is permanently inert, so a held orchestrator closing over its first connection
   * would fail every later bundle request for that server as `unavailable` with no recovery short of a
   * relaunch. Passing it in per ask removes the state that could go stale instead of documenting that
   * it must not.
   *
   * A short-circuited ask's function is never called: the in-flight download keeps the connection it
   * was armed with, exactly as it keeps its consumer.
   */
  request(requestDebugBundle: (consumer: BundleConsumer) => void): void
}

/**
 * The per-server orchestrator set (#1120 AC3): one `DebugBundleDownload` per server, built on first
 * ask and held for the process lifetime. Two servers can therefore download at once — separate gates —
 * while one server cannot be asked twice, because a repeat ask returns the HELD gate rather than a
 * fresh one.
 */
export interface DebugBundleDownloads {
  /** The orchestrator for one server. Built on first ask; the same one thereafter. */
  for(serverId: string | null): DebugBundleDownload
}

/** Compile-time exhaustiveness guard for the fail-map (mirrors daemonEventBridge's idiom). A
 *  reached call would carry only a static enum string — never a secret. */
function assertNever(reason: never): never {
  throw new Error(`Unhandled bundle fail reason: ${String(reason)}`)
}

/**
 * Collapse the transport's closed 5-set BundleFailReason onto the coarse, user-facing category. A
 * total, exhaustive `switch` with a `never` default: a sixth reason added upstream becomes a
 * compile error here. The save-errno → `write-failed` mapping is a SEPARATE path (the save-reject
 * handler), never routed through this switch.
 */
function categoryFor(reason: BundleFailReason): DebugBundleFailure {
  switch (reason) {
    case 'daemon-error':
    case 'not-connected':
    case 'connection-lost':
      return 'unavailable'
    case 'seq-mismatch':
    case 'total-mismatch':
      return 'stream-corrupt'
    default:
      return assertNever(reason)
  }
}

/**
 * Build the single-in-flight download orchestrator. State is one `active` flag: it is set true
 * synchronously before the transport call and cleared at exactly the three terminal-emit sites
 * (save-resolve, save-reject, `fail`), so it stays true across the async save. Because a second
 * request is short-circuited while active, the transport's reassembler slot is never replaced out
 * from under an in-flight download — the first always runs to its single terminal (AC4).
 */
export function createDebugBundleDownload(deps: DebugBundleDownloadDeps): DebugBundleDownload {
  const { save, emit } = deps
  let active = false

  function request(requestDebugBundle: (consumer: BundleConsumer) => void): void {
    // Single-in-flight short-circuit: ignore a request while one is active (build no consumer, make
    // no transport call), so a spamming renderer cannot orphan the in-flight download's reassembler.
    if (active) return
    // Set BEFORE the transport call: a `not-connected` request fails the consumer SYNCHRONOUSLY
    // inside requestDebugBundle, whose `fail` handler clears `active` — setting it afterwards would
    // leave the flag stuck true. request() has no `await`, so two calls never interleave mid-body.
    active = true

    const consumer: BundleConsumer = {
      // Not terminal — the running count only; does not clear `active`.
      progress: (chunksReceived) => emit({ type: 'debugBundleProgress', chunksReceived }),
      // Synchronous, but the terminal is the SAVE outcome, not this call: route the bytes to disk
      // and let the settlement emit the terminal + clear `active` (below). Holding the flag across
      // the save is what closes AC4's async window.
      complete: (bytes) => {
        void save(bytes).then(
          (path) => {
            emit({ type: 'debugBundleSaved', path })
            active = false
          },
          () => {
            // Catch the fs errno and DROP it — never emit it or the bytes; only the category crosses.
            emit({ type: 'debugBundleFailed', reason: 'write-failed' })
            active = false
          }
        )
      },
      // The transport failure terminal: collapse the reason to a category, emit, then clear.
      fail: (reason) => {
        emit({ type: 'debugBundleFailed', reason: categoryFor(reason) })
        active = false
      }
    }

    requestDebugBundle(consumer)
  }

  return { request }
}

/**
 * Build the per-server orchestrator set (#1120 AC3). `build` is called AT MOST ONCE per id — the
 * composition root closes the downloads directory and that server's own bound sink into it — so the
 * gate an id resolves to is the same object across every ask for that server, which is exactly what
 * makes "one server cannot be asked twice" true and "two servers can download at once" true at the
 * same time.
 *
 * A `Map`, NEVER a bare object, for the reason every id-keyed structure in this family states: a
 * `Record<string, …>` written through `__proto__` would be prototype pollution. `null` is a legal key
 * here and is the not-paired stand-in's, distinct from every string.
 *
 * IT IS KEYED BY THE RESOLVED ID, NOT BY THE RENDERER'S HINT, and the root's call site is what keeps
 * that true: `serverRouter.resolve` answers a `serverId` that a held registry entry matched, so the
 * key set is bounded by the servers this process has actually held. Keying it before resolution would
 * make the map renderer-driven and unbounded — one entry, and one bound sink, per fabricated id.
 *
 * Nothing is ever evicted. There is no registry signal to hang an eviction on (`reconcile()` is
 * asynchronous, so a prune called beside it would run before the registry had dropped anything —
 * \#1118 ruled exactly this for its own index), and an orchestrator for an unpaired server is
 * unreachable anyway: the router refuses before it is selected.
 */
export function createDebugBundleDownloads(
  build: (serverId: string | null) => DebugBundleDownload
): DebugBundleDownloads {
  const held = new Map<string | null, DebugBundleDownload>()
  return {
    for(serverId: string | null): DebugBundleDownload {
      // Get-build-set with no `await` between the three, so two asks can never interleave into two
      // orchestrators — and therefore two gates — for one server.
      const existing = held.get(serverId)
      if (existing !== undefined) return existing
      const created = build(serverId)
      held.set(serverId, created)
      return created
    }
  }
}
