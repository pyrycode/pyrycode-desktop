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
// MAIN-PROCESS ONLY, but Electron-free and unit-testable: the composition root injects the three
// live deps (daemonConnection.requestDebugBundle, a dir-closed saveDebugBundle, emitDaemonEvent).
//
// LOG-FREE by construction: a diagnostic here could echo the saved path or become a seam that later
// logs the dropped errno/bytes. The save-reject errno is caught and discarded, never logged.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { BundleConsumer, BundleFailReason } from './transport/bundleReassembler'
import type { DaemonEvent, DebugBundleFailure } from '../shared/ipc/events'

/** The injected collaborators, all Electron-free so the orchestrator unit-tests without a window. */
export interface DebugBundleDownloadDeps {
  /** Arm the transport reassembler + send the request frame — daemonConnection.requestDebugBundle. */
  requestDebugBundle: (consumer: BundleConsumer) => void
  /** Persist the archive, resolving the written absolute path — a `dir`-closed saveDebugBundle. */
  save: (bytes: Uint8Array) => Promise<string>
  /** The one path to the window — `e => emitDaemonEvent(live.sink, e)` (#519). */
  emit: (event: DaemonEvent) => void
}

/** The orchestrator handle: the one method the composition-root command switch calls. */
export interface DebugBundleDownload {
  /** Start a download, unless one is already in flight (single-in-flight short-circuit). */
  request(): void
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
  const { requestDebugBundle, save, emit } = deps
  let active = false

  function request(): void {
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
