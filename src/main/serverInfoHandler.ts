// The single, typed seam the paired-server-info query passes through on the main side. A twin of
// pairingStatusHandler.ts (#79): same injected-target shape, single-registration / exact-teardown
// discipline, and stateless read (it holds nothing between calls, reads the paired-server store on
// each invoke, and takes NO request argument — the query carries no body). The composition root
// (#339's index.ts) calls this once with Electron's ipcMain and the already-constructed
// pairedServerStore; nothing Electron-specific is imported here — the target is injected structurally,
// so it unit-tests with a fake.
//
// It exposes ONLY the paired servers' NON-SECRET identities to the renderer: each record maps to the
// two non-secret fields (serverId ← record.server, relayUrl ← record.relay), built as an EXPLICIT
// two-field literal — never `...record`, never reading record.token / record.server_static_pubkey — so
// no credential can ride along even at runtime; the loaded records themselves never leave this module.
// Since #1148 that literal sits inside a `.map`, which is what makes a spread cost one bearer token PER
// PAIRED SERVER rather than one — the explicitness below is load-bearing, not stylistic. It is LOG-FREE
// by construction — no console.* anywhere. A propagated decrypt-failure error can carry a filesystem
// path or OS-keychain detail, so the caught object is DROPPED (never logged, interpolated, or returned).
import { SERVER_INFO_CHANNEL, type ServerInfo } from '../shared/ipc/serverInfo'
import type { MultiPairedServerStore } from './pairedServerStore'

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
 * Typed against `Pick<MultiPairedServerStore, 'list'>` — the narrowest surface carrying the one method
 * it calls, following hostLabelHandler's `Pick<HostLabelStore, 'load'>` and connectionRegistry's own
 * Pick. Naming the whole interface would drag save / clear / loadById / clearServer into the type and
 * into every fake for no gain, and would put a mutator within this read channel's reach.
 */
export function registerServerInfoHandler(
  target: ServerInfoHandleTarget,
  deps: { store: Pick<MultiPairedServerStore, 'list'> }
): () => void {
  const { store } = deps

  const listener = async (): Promise<ServerInfo> => {
    try {
      // An EMPTY collection is the not-paired path, and it collapses to the same absent outcome as an
      // unreadable one — no third arm. list() reads through with no cache, so a re-pair is observed
      // immediately, and this independent read does not race the connect sequence (it takes a single
      // consistent snapshot: fileSecretPersistence writes temp-then-rename, so an interleaving save
      // yields the pre- or post-write collection, never a torn one).
      const records = await store.list()
      if (records.length === 0) return { status: 'unavailable' }

      // The two fields are named EXPLICITLY, per entry — never a `...record` spread, never a
      // pass-through of the record object — so token / server_static_pubkey cannot ride along even at
      // runtime, however many servers are paired; only the non-secret server id + relay URL cross.
      // Both come off the AT-REST record and so are available whether or not that server's connection
      // is live: the live hello_ack.server_id is a distinct, daemon-asserted value and must NOT be
      // sourced here, even though #1117 now dials one connection per record and makes one available.
      // Order is list()'s own (oldest-saved first) and is passed through unsorted.
      return {
        status: 'available',
        servers: records.map((record) => ({ serverId: record.server, relayUrl: record.relay }))
      }
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
