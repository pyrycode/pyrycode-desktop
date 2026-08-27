// The stored-host-label query between the renderer window and the background process: one channel
// constant plus a sealed three-outcome response union, imported by both process sides. The operator
// types the label at pairing time (#823) and it persists in the background process (#822); the window
// has had no way to read it back. This module ships the contract ahead of any caller, the same way
// pairingStatus.ts (#80), unpair.ts (#173) and serverInfo.ts (#339) shipped ahead of theirs; the
// renderer store and the sidebar host row that render it are #826. Request/response via
// ipcRenderer.invoke / ipcMain.handle; the main-process handler is hostLabelHandler.ts.
//
// The label is at-rest state, so the query answers whether or not a connection is live — nothing on
// this path reads a session value.
//
// This module is a channel constant + a discriminated union with NO runtime logic — the same shape as
// pairingStatus.ts and serverInfo.ts, and like them it ships NO request guard (no isHostLabelRequest
// sibling): the query carries NO body — the renderer invokes with zero arguments — so there is no
// untrusted request field to validate at the boundary. Per-server-id keying (hostLabelStore.ts:70-76)
// is the deferred multi-host change that would give this query an argument; at that point it needs a
// guard, and the missing one here is not an oversight.
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not pull
// main-only code). Relative imports only — src/main and src/preload have no @shared alias.

/** The IPC channel the stored-host-label query travels on, renderer ↔ main.
 *  Single source of truth: the preload invoker ships on it, the main handler registers on it.
 *  A mismatch would break the query silently, so both sides reference this constant. Separate from
 *  SERVER_INFO_CHANNEL: that reads the paired-server record's non-secret identity; this reads a
 *  different at-rest name, with a different outcome cardinality. */
export const HOST_LABEL_CHANNEL = 'pyry:host-label' as const

/**
 * The three outcomes of "what host label is stored?", discriminated on `status`, sourced from
 * hostLabelStore.load():
 *   - stored     → a label was read. `''` IS a stored label (the operator supplied an empty one), not
 *                  absence — hostLabelStore keeps that distinction end-to-end and this boundary is the
 *                  last place it could be thrown away.
 *   - not-stored → load() returned null — never stored, and the ONLY not-stored path.
 *   - error      → the stored label could not be read: load() threw (MalformedHostLabelError, or a
 *                  propagated decrypt failure from tamper / keychain rotation), OR what it returned
 *                  exceeds MAX_HOST_LABEL_LENGTH. ADR 0005 forbids masking an unreadable record as
 *                  never-stored, so `error` is deliberately DISTINCT from `not-stored` — the same
 *                  argument PairingStatus makes, and hostLabelStore.ts:56-58 states it for the label
 *                  directly: a consumer branches to a re-enter-the-label recovery rather than treating
 *                  corruption as never-stored.
 *
 * Three arms, not ServerInfo's two: that union deliberately COLLAPSES not-paired and unreadable into
 * one `unavailable` arm, which is exactly the distinction this query must keep.
 *
 * `label` is the ONLY field on the whole union, and it lives only on `stored`. Both other arms are
 * value-free BY CONSTRUCTION, so the handler cannot serialize a token, a server key, a keychain path,
 * an error message, or a truncated label prefix on them. Keep it that way: no error-reason field, now
 * or later — a coarse category still leaks backend detail (the pairingStatus.ts argument).
 *
 * `not-stored` declares NO `label` key rather than `label: undefined`. Electron's IPC uses the
 * structured clone algorithm, which PRESERVES an own property whose value is undefined (unlike
 * JSON.stringify, which drops it), so `{ status: 'not-stored', label: undefined }` would arrive with
 * `'label' in result` true and a renderer using an `in` test would misread absence. Declaring the key
 * on the `stored` arm alone makes that unrepresentable.
 *
 * What the renderer DOES with each outcome — what an empty or absent label falls back to on screen —
 * is #826's decision, not this contract's.
 */
export type HostLabelResult =
  | { status: 'stored'; label: string }
  | { status: 'not-stored' }
  | { status: 'error' }
