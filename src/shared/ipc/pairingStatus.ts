// The launch-time pairing-existence query between the renderer window and the background
// process: one channel constant plus a sealed three-outcome response union, imported by both
// process sides. The renderer calls this BEFORE first paint to decide which screen to show
// (#80), instead of inferring pairing state from a late, error-shaped connection event
// (daemonConnection's `failed{ code: 'not-paired' }`). Request/response via
// ipcRenderer.invoke / ipcMain.handle; the main-process handler is #79's pairingStatusHandler.ts.
//
// This module is a channel constant + a discriminated union with NO runtime logic — the same
// shape as events.ts. Unlike pairing.ts, it ships NO request guard (no isPairingRequest sibling):
// the query carries NO request body — the renderer invokes with zero arguments — so there is no
// untrusted request field to validate at the boundary. The only untrusted-input surface pairing.ts
// guards (the pasted payload) simply does not exist here.
//
// The response is value-free BY CONSTRUCTION: no member declares any field beyond the `status`
// discriminant, so the handler cannot serialize a token, server key, relay URL, or record field
// back across the boundary (the events.ts / pairing.ts argument). This mirrors how QrPayload's
// secrets never appear on the event channel.
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not
// pull main-only code). Relative imports only — src/main and src/preload have no @shared alias.

/** The IPC channel the launch-time pairing-status query travels on, renderer ↔ main.
 *  Single source of truth: the preload invoker ships on it, the main handler registers on it.
 *  A mismatch would break the query, so both sides reference this constant. Separate from
 *  PAIRING_CHANNEL: that carries the stateful submit→confirm round-trip; this is a stateless read. */
export const PAIRING_STATUS_CHANNEL = 'pyry:pairing-status' as const

/**
 * The three launch-time outcomes of "does a stored pairing exist?", discriminated on `status`,
 * sourced from pairedServerStore.load():
 *   - paired      → load() returned a present, valid record.
 *   - not-paired  → load() returned null — the ONLY not-paired path.
 *   - error       → load() threw: a decoded-but-malformed record OR a propagated decrypt failure
 *                   (tamper / keychain rotation). ADR 0005 forbids masking an unreadable record as
 *                   never-paired, so `error` is deliberately DISTINCT from `not-paired`.
 *
 * Value-free BY CONSTRUCTION: no member has a field beyond the discriminant, so the handler cannot
 * serialize the token, server_static_pubkey, relay URL, or any record field back to the renderer.
 * Keep it minimal — no speculative error-sub-reason field; #43/#44 own recovery policy and will
 * extend additively if they ever need to distinguish the two error sub-cases. What the renderer
 * DOES with each outcome (re-pair prompt vs. hard error) is #80's / #43/#44's decision, not this
 * contract's.
 */
export type PairingStatus =
  | { status: 'paired' }
  | { status: 'not-paired' }
  | { status: 'error' }
