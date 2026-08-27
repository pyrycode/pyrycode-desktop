// The single, typed seam the stored-host-label query passes through on the main side. A twin of
// serverInfoHandler.ts (#339): same injected-target shape, single-registration / exact-teardown
// discipline, and stateless read (it holds nothing between calls, reads the host-label store on each
// invoke, and takes NO request argument — the query carries no body). The composition root's index.ts
// calls this once with Electron's ipcMain and the already-constructed hostLabelStore; nothing
// Electron-specific is imported here — the target is injected structurally, so it unit-tests with a
// fake.
//
// It reads AT-REST state only — no relay connection, no supervisor, no session value is in scope — so
// the query answers whether or not a connection is live.
//
// The label off disk is UNTRUSTED and unbounded (hostLabelStore deliberately validates nothing and
// hands that obligation on), so this boundary re-applies the write path's bound against the SAME
// constant, MAX_HOST_LABEL_LENGTH. It is LOG-FREE by construction — no console.* anywhere, on any path
// including every error path; the label is an opaque local, never a named field of a logged object. A
// propagated decrypt-failure error can carry a filesystem path or OS-keychain detail, so the caught
// object is DROPPED (never logged, interpolated, or returned).
import { HOST_LABEL_CHANNEL, type HostLabelResult } from '../shared/ipc/hostLabel'
import { MAX_HOST_LABEL_LENGTH } from '../shared/ipc/pairing'
import type { HostLabelStore } from './hostLabelStore'

/**
 * The minimal main-process invoke surface the handler needs. Electron's `ipcMain` satisfies this
 * structurally (its handle/removeHandler accept this shape); the unit test passes a fake
 * `{ handle: vi.fn(), removeHandler: vi.fn() }`, so no Electron harness is required. The listener
 * takes only the IpcMainInvokeEvent (typed `unknown`, never read — .sender / .ports stay
 * unreachable) — there is NO request argument, because the query carries no body.
 */
export interface HostLabelHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<HostLabelResult>): void
  removeHandler(channel: string): void
}

/**
 * Register the single invoke handler for the stored-host-label query. Returns an unregister handle
 * that removes exactly the channel it added (mirrors serverInfoHandler's exact teardown;
 * ipcMain.handle allows one handler per channel, so this is the sole registration site). Reuses the
 * already-constructed hostLabelStore — do not build a second store. Holds no state between calls.
 *
 * Typed against `Pick<HostLabelStore, 'load'>`, not the full interface: this read channel is
 * structurally write-proof and erase-proof, so it cannot mutate at-rest state even by accident. The
 * mirror image of #823, which gave the pairing handler a `save`-only handle. Erasing is #827.
 */
export function registerHostLabelHandler(
  target: HostLabelHandleTarget,
  deps: { store: Pick<HostLabelStore, 'load'> }
): () => void {
  const { store } = deps

  const listener = async (): Promise<HostLabelResult> => {
    try {
      // load() reads through with no cache, so a label written at pairing confirm is visible on the
      // very next invoke, with no invalidation step.
      const label = await store.load()
      // STRICT null, never a truthiness test. `''` is falsy, so `if (!label)` would type-check, read
      // naturally, pass any test that only exercises a non-empty label, and silently collapse a
      // STORED EMPTY label into absence — at the last boundary where #822's and #823's never-stored
      // vs stored-empty distinction still exists (hostLabelStore.ts:135-139).
      if (label === null) return { status: 'not-stored' }
      // The read bound, the exact negation of isPairingRequest's `label.length <=
      // MAX_HOST_LABEL_LENGTH` (pairing.ts:116) against the SAME imported constant and the same unit
      // (UTF-16 code units): whatever the write guard accepts this accepts, and whatever it rejects
      // this rejects. A byte length or a code-point count would disagree for any non-ASCII label.
      // The bound is re-applied here because MAX_HOST_LABEL_LENGTH bounds what can be WRITTEN through
      // the IPC guard, not what is already on disk — a value stored before the bound existed, or by
      // tampering that still decrypts. The over-long string is dropped WHOLE: no truncation, no
      // prefix, no length reported. Ordered after the null check, which has no `.length`.
      if (label.length > MAX_HOST_LABEL_LENGTH) return { status: 'error' }
      // Verbatim — no trim, no normalize, no escape, no case fold, no fallback substitution. The
      // sidebar row (#826) owns what an empty or absent label falls back to on screen, and owns
      // rendering this untrusted text as escaped text only.
      return { status: 'stored', label }
    } catch {
      // Classify-don't-forward: every throw (MalformedHostLabelError OR a propagated decrypt failure)
      // collapses to the same `error` outcome WITHOUT inspecting the error type. The caught object is
      // DROPPED: its message could echo a filesystem path or keychain detail, so it is never logged,
      // interpolated, or returned. handle must resolve to a value, so this never rethrows — a
      // rejection would cross as an Electron-serialized error carrying a main-process stack trace.
      return { status: 'error' }
    }
  }

  target.handle(HOST_LABEL_CHANNEL, listener)
  return () => target.removeHandler(HOST_LABEL_CHANNEL)
}
