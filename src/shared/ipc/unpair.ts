// The unpair request between the renderer window and the background process: one channel constant
// plus a sealed two-outcome response union, imported by both process sides. The renderer asks the
// background process to erase the stored pairing so the app can return to a clean, not-paired state
// (#173, on top of #172's ClearablePairedServerStore.clear()). The visible unpair control that calls
// it lands in the renderer follow-ups #166/#167; this module ships the contract ahead of any caller,
// the same way pairingStatus.ts (#80) shipped ahead of its consumer. Request/response via
// ipcRenderer.invoke / ipcMain.handle; the main-process handler is unpairHandler.ts.
//
// It ships TWO channels since #1149, deliberately, not one channel with two request shapes. The
// original UNPAIR_CHANNEL erases the WHOLE collection and still carries no body — the renderer
// invokes it with zero arguments. UNPAIR_SERVER_CHANNEL erases exactly ONE named record and carries
// an untrusted `serverId`. Keeping them apart is what makes "a malformed per-server request can
// never reach the whole-collection erase" a property of the TYPES rather than of a branch: the
// per-server handler is registered with a store handle that has no whole-collection `clear` on it at
// all, so there is no name for that erase to be reached by from this path. (#1152 migrates the one
// remaining no-arg caller and retires UNPAIR_CHANNEL wholesale; nothing migrates in #1149.)
//
// The per-server channel is therefore the FIRST untrusted request field this module has ever had,
// and it ships isUnpairServerRequest alongside it — the runtime guard the main handler applies at
// the renderer→main boundary, modelled on pairing.ts's isPairingRequest. (An earlier version of this
// header stated that "the request carries NO body … so there is no untrusted request field to
// validate at the boundary". That is true of UNPAIR_CHANNEL only, and is no longer true of this
// module: the renderer can now PARAMETERIZE an erase, not merely trigger one.)
//
// The response is value-free BY CONSTRUCTION: no member declares any field beyond the `result`
// discriminant, so the handler cannot serialize a token, server key, relay URL, keychain path, or
// any error detail back across the boundary. The error arm deliberately carries NO reason field —
// a coarse reason category could leak backend detail, and a compromised renderer must gain only the
// ability to TRIGGER an unpair, never to read a secret.
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not
// pull main-only code). Relative imports only — src/main and src/preload have no @shared alias.
import { MAX_PASTE_LENGTH } from './pairing'

/** The IPC channel the WHOLE-COLLECTION unpair request/response travels on, renderer ↔ main.
 *  Single source of truth: the preload invoker ships on it, the main handler registers on it.
 *  A mismatch would break the request, so both sides reference this constant. */
export const UNPAIR_CHANNEL = 'pyry:unpair' as const

/** The IPC channel the PER-SERVER unpair request/response travels on, renderer ↔ main (#1149).
 *  A second channel rather than a second request shape on the one above — see the header. Same
 *  single-source-of-truth discipline; same value-free UnpairResult comes back. */
export const UNPAIR_SERVER_CHANNEL = 'pyry:unpair-server' as const

/**
 * Upper bound on an accepted `serverId`, enforced at the guard (#1149).
 *
 * Aliased to `MAX_PASTE_LENGTH` rather than given an independently chosen number, and that is
 * load-bearing in one direction only: every persisted `server` id arrived inside a pairing paste
 * that this same bound already limited, so no held record can be made UNFORGETTABLE by this check —
 * whatever could be stored can be named. A tighter number would risk exactly that lockout, while
 * still buying nothing: the id is only ever compared with `===` against decoded entries.
 * The unit matches MAX_PASTE_LENGTH's — UTF-16 code units — because it IS that constant.
 */
export const MAX_SERVER_ID_LENGTH = MAX_PASTE_LENGTH

/**
 * A per-server unpair request: the id of the one server to forget, and nothing else (#1149). The
 * channel is the verb, so there is no `type` discriminant to carry; a second per-server verb would
 * take its own channel the same way this one did.
 *
 * `serverId` is UNTRUSTED renderer input. It is validated by isUnpairServerRequest at the boundary
 * and then compared with `===` against each decoded record's own `server` field — it never becomes
 * a store name, a filesystem path, or an object key anywhere downstream, so an id like `__proto__`
 * is inert rather than dangerous. Keep it that way.
 */
export type UnpairServerRequest = { serverId: string }

/**
 * The value-free outcome of "erase the stored pairing", discriminated on `result`:
 *   - ok    → the paired-server store's clear() completed (the record was erased, or was already
 *             absent — clear() is idempotent, so unpairing a clean state is success).
 *   - error → clear() threw. The handler maps EVERY throw here WITHOUT inspecting the error, so a
 *             live bearer token is never reported as erased while it may still sit on disk (fail-
 *             closed). No detail crosses back.
 *
 * Value-free BY CONSTRUCTION: no member has a field beyond the discriminant, so the handler cannot
 * serialize the token, server_static_pubkey, relay URL, keychain path, or any error detail back to
 * the renderer. Keep it minimal — no speculative error-sub-reason field; a future recovery flow
 * extends it additively if it ever needs to distinguish error sub-cases.
 *
 * SHARED by both channels (#1149), unchanged. On the per-server channel `error` additionally covers
 * a guard refusal and an id that names no held record — deliberately NOT distinguished from a failed
 * erase. A third member would answer "is this id paired?" for a compromised renderer; that it could
 * already learn the same from the server-info channel is a reason not to widen the surface, not a
 * reason to.
 */
export type UnpairResult = { result: 'ok' } | { result: 'error' }

/**
 * Runtime type guard for the untrusted renderer→main boundary on UNPAIR_SERVER_CHANNEL (#1149),
 * mirroring isPairingRequest. True iff `value` is a structurally valid UnpairServerRequest: a
 * non-null object carrying a `serverId` that is a string within MAX_SERVER_ID_LENGTH. Accepts
 * extra/unknown fields (structural minimum). Pure; never throws.
 *
 * `serverId` is REQUIRED, so — unlike isPairingRequest's optional `label`, which must accept a
 * present-but-undefined property because Electron's structured clone preserves one — a
 * `{ serverId: undefined }` request is REJECTED here. The typeof test does that on its own.
 *
 * The empty string is deliberately ACCEPTED. This guard is structural, and `parseRecord` only checks
 * a stored `server` for string-ness, so an empty id is storable; rejecting it here would make such a
 * record unforgettable through this path while buying nothing. Emptiness — like any id naming no
 * held record — is refused one step later, by the handler, without erasing anything.
 *
 * An array is rejected by the `serverId in value` test, so it needs no Array.isArray branch of its
 * own; the test below pins that.
 */
export function isUnpairServerRequest(value: unknown): value is UnpairServerRequest {
  if (typeof value !== 'object' || value === null || !('serverId' in value)) return false
  return typeof value.serverId === 'string' && value.serverId.length <= MAX_SERVER_ID_LENGTH
}
