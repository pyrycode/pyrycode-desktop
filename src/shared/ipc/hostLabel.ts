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
// It ships TWO channels since #1157, deliberately, not one channel with two request shapes — the cut
// unpair.ts made in #1149, for the same reasons plus one of its own. The original HOST_LABEL_CHANNEL
// asks "what host label is stored?" and still carries no body; HOST_LABEL_SERVER_CHANNEL asks it of
// ONE NAMED machine and carries an untrusted `serverId`. Keeping them apart is what lets the keyed
// handler be registered with a `loadFor`-only store handle while the body-free one keeps its
// `load`-only handle, so neither can reach the other's read — a property of the TYPES rather than of
// a branch. It is also forced here: the renderer's current caller passes `window.pyry.hostLabel` as
// a BARE FUNCTION REFERENCE into a one-shot loader that calls it with no arguments, so a newly
// required parameter would break that caller at the type level and be refused at the guard at
// runtime. #1070 migrates the sidebar onto the keyed channel; nothing migrates in #1157.
//
// The keyed channel is therefore the FIRST untrusted request field this module has ever had, and it
// ships isHostLabelServerRequest alongside it — the runtime guard the main handler applies at the
// renderer→main boundary, modelled on unpair.ts's isUnpairServerRequest. (An earlier version of this
// header stated that this module "ships NO request guard … the query carries NO body — the renderer
// invokes with zero arguments — so there is no untrusted request field to validate at the boundary",
// and named per-server keying as the deferred change that would give the query an argument and need
// a guard. That is true of HOST_LABEL_CHANNEL only, and is no longer true of this module: #1157 IS
// that deferred change. The pointer it carried into hostLabelStore.ts was to a comment that has
// since retracted the keying mechanism it described — see HOST_LABEL_NAME there.)
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not pull
// main-only code). Relative imports only — src/main and src/preload have no @shared alias.
import { MAX_SERVER_ID_LENGTH } from './unpair'

/** The IPC channel the stored-host-label query travels on, renderer ↔ main.
 *  Single source of truth: the preload invoker ships on it, the main handler registers on it.
 *  A mismatch would break the query silently, so both sides reference this constant. Separate from
 *  SERVER_INFO_CHANNEL: that reads the paired-server record's non-secret identity; this reads a
 *  different at-rest name, with a different outcome cardinality. */
export const HOST_LABEL_CHANNEL = 'pyry:host-label' as const

/** The IPC channel the PER-SERVER stored-host-label query travels on, renderer ↔ main (#1157).
 *  A second channel rather than a second request shape on the one above — see the header. Same
 *  single-source-of-truth discipline; the same three-outcome HostLabelResult comes back, now
 *  answering for the named machine alone. */
export const HOST_LABEL_SERVER_CHANNEL = 'pyry:host-label-server' as const

/**
 * A per-server stored-host-label query: the id of the one machine to name, and nothing else (#1157).
 * The channel is the verb, so there is no `type` discriminant to carry.
 *
 * `serverId` is UNTRUSTED renderer input. It is validated by isHostLabelServerRequest at the
 * boundary and then compared with `===` against each decoded entry's own `server` field by
 * hostLabelStore's loadFor — it never becomes a store name, a filesystem path, or an object key
 * anywhere downstream, so an id like `__proto__` is inert rather than dangerous. Composing the
 * persistence name from the id is the mechanism HOST_LABEL_NAME explicitly rejects. Keep it that way.
 */
export type HostLabelServerRequest = { serverId: string }

/**
 * The three outcomes of "what host label is stored?", discriminated on `status`, sourced from
 * hostLabelStore.load() — and since #1157 from loadFor() on the keyed channel, which returns the
 * same three answers for ONE named server:
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
 * SHARED by both channels (#1157), unchanged. On the keyed channel the three answers are per server,
 * and `error` additionally covers a GUARD REFUSAL — deliberately NOT distinguished from an
 * unreadable label. A distinct refusal outcome would tell a compromised renderer which of its
 * guesses was well-formed. `not-stored` there additionally covers a blob predating the keyed
 * envelope, which reads as never-stored for every id: a documented one-way loss (the store has no
 * view of the paired records and so cannot name the server a bare string belonged to), not an error
 * and never that bare text.
 *
 * What the renderer DOES with each outcome — what an empty or absent label falls back to on screen —
 * is #826's decision, not this contract's.
 */
export type HostLabelResult =
  | { status: 'stored'; label: string }
  | { status: 'not-stored' }
  | { status: 'error' }

/**
 * Runtime type guard for the untrusted renderer→main boundary on HOST_LABEL_SERVER_CHANNEL (#1157),
 * mirroring isUnpairServerRequest. True iff `value` is a structurally valid HostLabelServerRequest:
 * a non-null object carrying a `serverId` that is a string within MAX_SERVER_ID_LENGTH. Accepts
 * extra/unknown fields (structural minimum). Pure; never throws.
 *
 * The bound is IMPORTED from unpair.ts rather than given a number of its own, and that is the point:
 * it aliases MAX_PASTE_LENGTH, so every persisted `server` id — having arrived inside a pairing
 * paste that same bound already limited — stays addressable here. A second number could drift and
 * make a held record's label unreadable through this path while buying nothing, since the id is only
 * ever compared with `===` against decoded entries.
 *
 * A separate function rather than a reuse of isUnpairServerRequest: the two are structurally
 * identical today but guard two channels with two different verbs, and naming one after the other
 * would make a later divergence in either read as a bug in both.
 *
 * `serverId` is REQUIRED, so a `{ serverId: undefined }` request is REJECTED — the typeof test does
 * that on its own, and it matters because Electron's structured clone PRESERVES an own property
 * whose value is undefined. The empty string is deliberately ACCEPTED: this guard is structural, and
 * `parseEntry` only checks a stored `server` for string-ness, so an empty id is storable and
 * rejecting it here would make such a record's label unreadable through this path. Emptiness — like
 * any id naming no held entry — is answered one step later, by the store, as `not-stored`.
 *
 * An array is rejected by the `serverId in value` test, so it needs no Array.isArray branch of its
 * own; the test pins that. Both rulings are #1149's, settled there and applied here unchanged.
 */
export function isHostLabelServerRequest(value: unknown): value is HostLabelServerRequest {
  if (typeof value !== 'object' || value === null || !('serverId' in value)) return false
  return typeof value.serverId === 'string' && value.serverId.length <= MAX_SERVER_ID_LENGTH
}
