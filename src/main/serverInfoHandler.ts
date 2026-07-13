// The single, typed seam the paired-server-info query passes through on the main side. A twin of
// pairingStatusHandler.ts (#79): same injected-target shape, single-registration / exact-teardown
// discipline, and stateless read (it holds nothing between calls, reads the paired-server store on
// each invoke, and takes NO request argument — the query carries no body). The composition root
// (#339's index.ts) calls this once with Electron's ipcMain and the already-constructed
// pairedServerStore; nothing Electron-specific is imported here — the target is injected structurally,
// so it unit-tests with a fake.
//
// It exposes ONLY the paired server's NON-SECRET identity to the renderer: a present record maps to
// the two non-secret fields (serverId ← record.server, relayUrl ← record.relay), built as an EXPLICIT
// two-field literal — never `...record`, never reading record.token / record.server_static_pubkey — so
// no credential can ride along even at runtime; the loaded record itself never leaves this module. It
// is LOG-FREE by construction — no console.* anywhere. A propagated decrypt-failure error can carry a
// filesystem path or OS-keychain detail, so the caught object is DROPPED (never logged, interpolated,
// or returned).
import { SERVER_INFO_CHANNEL, type ServerInfo } from '../shared/ipc/serverInfo'
import type { PairedServerStore } from './pairedServerStore'

/**
 * The minimal main-process invoke surface the handler needs. Electron's `ipcMain` satisfies this
 * structurally (its handle/removeHandler accept this shape); the unit test passes a fake
 * `{ handle: vi.fn(), removeHandler: vi.fn() }`, so no Electron harness is required. The listener
 * takes only the IpcMainInvokeEvent (typed `unknown`, stripped) — there is NO request argument,
 * because the query carries no body.
 */
export interface ServerInfoHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<ServerInfo>): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the paired-server-info query. Returns an unregister handle
 * that removes exactly the channel it added (mirrors pairingStatusHandler's exact teardown;
 * ipcMain.handle allows one handler per channel, so this is the sole registration site). Reuses the
 * already-constructed pairedServerStore — do not build a second store. Holds no state between calls.
 * Typed against the BASE PairedServerStore (only load() is needed) — not ClearablePairedServerStore.
 */
export function registerServerInfoHandler(
  target: ServerInfoHandleTarget,
  deps: { store: PairedServerStore }
): () => void {
  const { store } = deps

  const listener = async (): Promise<ServerInfo> => {
    try {
      // `null` is the ONLY not-paired path. load() reads through with no cache, so a re-pair is
      // observed immediately, and this independent read does not race the connect sequence. The two
      // fields are named EXPLICITLY — never a `...record` spread — so token / server_static_pubkey
      // cannot ride along even at runtime; only the non-secret server id + relay URL cross (AC "field
      // source": the at-rest record, available whether or not a live connection exists).
      const record = await store.load()
      return record === null
        ? { status: 'unavailable' }
        : { status: 'available', serverId: record.server, relayUrl: record.relay }
    } catch {
      // Classify-don't-forward: every throw (MalformedPairedServerRecordError OR a propagated decrypt
      // failure) collapses to the same `unavailable` outcome WITHOUT inspecting the error type. The
      // caught object is DROPPED: its message could echo a filesystem path or record bytes, so it is
      // never logged, interpolated, or returned. handle must resolve to a value, so this never
      // rethrows.
      return { status: 'unavailable' }
    }
  }

  target.handle(SERVER_INFO_CHANNEL, listener)
  return () => target.removeHandler(SERVER_INFO_CHANNEL)
}
