// The typed request/response pairing pipe between the renderer window and the background process:
// one channel, a sealed discriminated REQUEST union, a runtime boundary guard, and the typed
// RESPONSE shapes. Unlike the fire-and-forget command channel (#17, commands.ts) and event channel
// (#18, events.ts), pairing needs a request/response round-trip — the renderer submits a pasted
// payload and gets back a fingerprint to confirm, then sends a bare confirm and gets back
// success/failure. This module is the shared contract for that channel (Electron
// ipcRenderer.invoke / ipcMain.handle); the main-process handler is #54's pairingHandler.ts.
//
// The producer is the UNTRUSTED renderer (as with commands), so this ships isPairingRequest — the
// runtime guard the main handler applies at the renderer→main boundary. AC4 ("only the fingerprint
// or a value-free reason crosses back") is enforced BY CONSTRUCTION: no response arm has a field
// that could hold the token or server_static_pubkey, so the handler cannot serialize a secret back.
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not
// pull main-only code). Relative imports only — src/main and src/preload have no @shared alias.

/** The IPC channel the pairing request/response round-trip travels on, renderer ↔ main.
 *  Single source of truth: the preload invoker ships on it, the main handler registers on it.
 *  A mismatch would break every pairing call, so both sides reference this constant. */
export const PAIRING_CHANNEL = 'pyry:pairing' as const

/**
 * Upper bound on an accepted paste, enforced at the guard. A valid pairing paste is base64url of a
 * four-field JSON (relay URL, server id, token, 32-byte base64 key) — realistically < 1 KB; 8 KiB
 * is comfortably above any legitimate input while rejecting absurd sizes at the IPC trust boundary,
 * before parse touches them with regex / base64-decode / JSON.parse.
 */
export const MAX_PASTE_LENGTH = 8192

/**
 * A single typed pairing request from the renderer window to the background process. Sealed
 * discriminated union on `type`: a `submit` carrying the untrusted paste to parse + fingerprint,
 * and a bare `confirm` that carries NO record (the #53 hand-off — the renderer sends only a confirm
 * signal, never the fingerprinted record). Extend additively, and grow isPairingRequest's switch in
 * lockstep, or a new member is silently rejected at the boundary.
 */
export type PairingRequest = { type: 'submit'; paste: string } | { type: 'confirm' }

/**
 * The self-contained response error vocabulary. Value-free category strings — safe to surface to
 * the operator (in #55) and safe to cross the boundary. The handler MAPS #52's eight parse reasons
 * and #53's two fingerprint reasons onto these coarse categories: shared cannot import those
 * main-only unions, and the operator's recovery action is per-category, not per-reason.
 */
export type PairingErrorReason =
  | 'malformed-request' // the guard rejected the request shape (incl. a non-string / over-length paste)
  | 'invalid-paste' // parse/validation failed (any ParsePairingResult reason)
  | 'invalid-key' // structurally valid paste, malformed server key (any FingerprintRejectReason)
  | 'no-pending-pairing' // confirm with nothing prepared
  | 'persist-failed' // confirm's store.save threw (e.g. keychain unavailable)

/**
 * The submit response: the display fingerprint (a hash, safe to surface) on success, or a
 * value-free reason. No token / server_static_pubkey / raw-record field anywhere — AC4 by
 * construction.
 */
export type PairingSubmitResponse =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: PairingErrorReason }

/** The confirm response: success carries nothing, failure a value-free reason. */
export type PairingConfirmResponse = { ok: true } | { ok: false; reason: PairingErrorReason }

/**
 * Runtime type guard for the untrusted renderer→main boundary, mirroring isRendererCommand. True
 * iff `value` is a structurally valid PairingRequest: a non-null object with a known `type`; for
 * `submit`, `paste` must be a string within MAX_PASTE_LENGTH (the mandated non-string-paste
 * rejection from the #52/#53 hand-off, plus a length bound validated HERE — the IPC trust boundary
 * — so main never runs regex / base64-decode / JSON.parse over an absurd input); for `confirm`,
 * nothing more. Accepts extra/unknown fields (structural minimum). Pure; never throws. Grow the
 * switch in lockstep with the union.
 */
export function isPairingRequest(value: unknown): value is PairingRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  switch (value.type) {
    case 'submit':
      return (
        'paste' in value &&
        typeof value.paste === 'string' &&
        value.paste.length <= MAX_PASTE_LENGTH
      )
    case 'confirm':
      return true
    default:
      return false
  }
}
