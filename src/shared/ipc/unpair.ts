// The unpair request between the renderer window and the background process: one channel constant
// plus a sealed two-outcome response union, imported by both process sides. The renderer asks the
// background process to erase the stored pairing so the app can return to a clean, not-paired state
// (#173, on top of #172's ClearablePairedServerStore.clear()). The visible unpair control that calls
// it lands in the renderer follow-ups #166/#167; this module ships the contract ahead of any caller,
// the same way pairingStatus.ts (#80) shipped ahead of its consumer. Request/response via
// ipcRenderer.invoke / ipcMain.handle; the main-process handler is unpairHandler.ts.
//
// This module is a channel constant + a discriminated union with NO runtime logic — the same shape
// as pairingStatus.ts. Like pairingStatus.ts, it ships NO request guard (no isUnpairRequest
// sibling): the request carries NO body — the renderer invokes with zero arguments — so there is no
// untrusted request field to validate at the boundary.
//
// The response is value-free BY CONSTRUCTION: no member declares any field beyond the `result`
// discriminant, so the handler cannot serialize a token, server key, relay URL, keychain path, or
// any error detail back across the boundary. The error arm deliberately carries NO reason field —
// a coarse reason category could leak backend detail, and a compromised renderer must gain only the
// ability to TRIGGER an unpair, never to read a secret.
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not
// pull main-only code). Relative imports only — src/main and src/preload have no @shared alias.

/** The IPC channel the unpair request/response travels on, renderer ↔ main.
 *  Single source of truth: the preload invoker ships on it, the main handler registers on it.
 *  A mismatch would break the request, so both sides reference this constant. */
export const UNPAIR_CHANNEL = 'pyry:unpair' as const

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
 */
export type UnpairResult = { result: 'ok' } | { result: 'error' }
