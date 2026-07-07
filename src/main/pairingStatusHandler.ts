// The single, typed seam the launch-time "does a stored pairing exist?" query passes through on the
// main side. A smaller sibling of pairingHandler.ts (#54): same injected-target shape and
// single-registration / exact-teardown discipline, but stateless — it holds nothing between calls
// (no pendingConfirm), reads the paired-server store on each invoke, and takes NO request argument
// (the query carries no body). The composition root (#79's index.ts) calls this once with Electron's
// ipcMain and the already-constructed pairedServerStore; nothing Electron-specific is imported here —
// the target is injected structurally, so it unit-tests with a fake.
//
// It exposes ONLY pairing EXISTENCE to the renderer: the response is the value-free PairingStatus
// enum, and the loaded record (token / server_static_pubkey / relay) never leaves this module. It is
// LOG-FREE by construction — no console.* anywhere. A propagated decrypt-failure error can carry a
// filesystem path or OS-keychain detail, so the caught object is DROPPED (never logged, interpolated,
// or returned); unlike pairingHandler (which logs one fixed string on a malformed request), this
// handler has no untrusted-request path and therefore no reason to log at all.
import { PAIRING_STATUS_CHANNEL, type PairingStatus } from '../shared/ipc/pairingStatus'
import type { PairedServerStore } from './pairedServerStore'

/**
 * The minimal main-process invoke surface the handler needs. Electron's `ipcMain` satisfies this
 * structurally (its handle/removeHandler accept this shape); the unit test passes a fake
 * `{ handle: vi.fn(), removeHandler: vi.fn() }`, so no Electron harness is required. The listener
 * takes only the IpcMainInvokeEvent (typed `unknown`, stripped) — there is NO request argument,
 * because the query carries no body.
 */
export interface PairingStatusHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<PairingStatus>): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the launch-time pairing-status query. Returns an unregister
 * handle that removes exactly the channel it added (mirrors pairingHandler's exact teardown;
 * ipcMain.handle allows one handler per channel, so this is the sole registration site). Reuses the
 * already-constructed pairedServerStore — do not build a second store. Holds no state between calls.
 */
export function registerPairingStatusHandler(
  target: PairingStatusHandleTarget,
  deps: { store: PairedServerStore }
): () => void {
  const { store } = deps

  const listener = async (): Promise<PairingStatus> => {
    try {
      // `null` is the ONLY path to not-paired; a present record is paired. load() reads through with
      // no cache, so this is an independent read that does not race the connect sequence (AC2).
      const record = await store.load()
      return record === null ? { status: 'not-paired' } : { status: 'paired' }
    } catch {
      // Classify-don't-forward: every throw (MalformedPairedServerRecordError OR a propagated
      // decrypt failure) maps to `error` WITHOUT inspecting the error type — ADR 0005 forbids
      // collapsing an unreadable record into not-paired. The caught object is DROPPED: its message
      // could echo a filesystem path or record bytes, so it is never logged or returned. handle must
      // resolve to a value, so this never rethrows.
      return { status: 'error' }
    }
  }

  target.handle(PAIRING_STATUS_CHANNEL, listener)
  return () => target.removeHandler(PAIRING_STATUS_CHANNEL)
}
