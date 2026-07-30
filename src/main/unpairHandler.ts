// The single, typed seam the "erase the stored pairing" request passes through on the main side. A
// sibling of pairingStatusHandler.ts (#79): same injected-target shape and single-registration /
// exact-teardown discipline, and equally stateless — it holds nothing between calls, takes NO
// request argument (the request carries no body), and each invoke reads through to the store. The
// composition root (#173's index.ts) calls this once with Electron's ipcMain and the already-
// constructed ClearablePairedServerStore; nothing Electron-specific is imported here — the target is
// injected structurally, so it unit-tests with a fake.
//
// It exposes ONLY the ability to TRIGGER an erase to the renderer: the response is the value-free
// UnpairResult enum, and no token / server_static_pubkey / relay URL / keychain path ever leaves
// this module. It is LOG-FREE by construction — no console.* anywhere. #172's clear() is fail-closed
// (a secureStore.delete failure propagates rather than being swallowed), and a propagated error can
// carry a filesystem path or OS-keychain detail, so the caught object is DROPPED (never logged,
// interpolated, or returned). The `error` arm is the fail-closed boundary that turns that throw into
// a value-free result: only the SUCCESSFUL completion of clear() maps to `ok`, so a live bearer
// token is never reported as erased while it may still sit on disk.
import { UNPAIR_CHANNEL, type UnpairResult } from '../shared/ipc/unpair'
import type { ClearablePairedServerStore } from './pairedServerStore'

/**
 * The minimal main-process invoke surface the handler needs. Electron's `ipcMain` satisfies this
 * structurally (its handle/removeHandler accept this shape); the unit test passes a fake
 * `{ handle: vi.fn(), removeHandler: vi.fn() }`, so no Electron harness is required. The listener
 * takes only the IpcMainInvokeEvent (typed `unknown`, stripped) — there is NO request argument,
 * because the request carries no body.
 */
export interface UnpairHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<UnpairResult>): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the unpair request. Returns an unregister handle that
 * removes exactly the channel it added (mirrors pairingStatusHandler's exact teardown;
 * ipcMain.handle allows one handler per channel, so this is the sole registration site). Reuses the
 * already-constructed ClearablePairedServerStore — do not build a second store. Holds no state
 * between calls; the store dep is typed against the concrete ClearablePairedServerStore (which
 * carries clear()), not base PairedServerStore.
 */
export function registerUnpairHandler(
  target: UnpairHandleTarget,
  deps: {
    store: ClearablePairedServerStore
    /**
     * Called once after clear() erases the record — the teardown-on-unpair trigger (#504). A
     * trusted in-process callback, value-free (no record/token/key crosses), mirroring onPaired's
     * contract (pairingHandler.ts:51-57). Never called when clear() throws. MUST NOT throw; a throw
     * is DROPPED rather than downgrading the already-completed erase to `error` — see the listener.
     */
    onUnpaired?: () => void
  }
): () => void {
  const { store, onUnpaired } = deps

  const listener = async (): Promise<UnpairResult> => {
    try {
      // The listener's ONLY store interaction is clear() — never load/save. It erases; it does not
      // read. clear() is idempotent (a not-paired store clears cleanly), so success covers both
      // "record erased" and "already absent".
      await store.clear()
    } catch {
      // Classify-don't-forward: every throw maps to `error` WITHOUT inspecting the error type. The
      // caught object is DROPPED — its message could echo a keychain/filesystem path, so it is never
      // logged, interpolated, or returned. This is the fail-closed boundary: it never resolves `ok`
      // while a live bearer token may still be on disk. handle must resolve to a value, so this never
      // rethrows. The teardown below is skipped: nothing was erased, so nothing must be torn down.
      return { result: 'error' }
    }
    // The record is gone: fire the teardown trigger (#504) so the live daemon session cannot outlive
    // the record that authorised it. Deliberately OUTSIDE the fail-closed catch above and guarded by
    // its own — unlike onPaired, which sits inside its try (pairingHandler.ts:103). runUnpair coerces
    // BOTH `error` and a rejected invoke to "stay on the conversation screen", so reporting a throw
    // here would leave a paired-looking UI over an already-erased record: the precise inverse
    // half-state runUnpair exists to prevent. By this point the erase has resolved — and the wired
    // callback, connection.reconnect(), arms the event fence in dial()'s first statement — so `ok` is
    // the truthful answer. The caught object is DROPPED, keeping this module log-free by construction.
    try {
      onUnpaired?.()
    } catch {
      // Intentionally empty — see above.
    }
    return { result: 'ok' }
  }

  target.handle(UNPAIR_CHANNEL, listener)
  return () => target.removeHandler(UNPAIR_CHANNEL)
}
