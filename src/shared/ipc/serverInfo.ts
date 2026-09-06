// The paired-server-info query between the renderer window and the background process: one channel
// constant plus a sealed two-outcome response union, imported by both process sides. A Settings
// screen (#334) needs to tell the user WHICH server they are paired with — its server id and relay
// URL — including while disconnected, so it reads the at-rest paired-server record, never a live
// connection value. This module ships the contract ahead of any caller, the same way pairingStatus.ts
// (#80) and unpair.ts (#173) shipped ahead of their consumers; the renderer store that reads it is
// #340. Request/response via ipcRenderer.invoke / ipcMain.handle; the main-process handler is
// serverInfoHandler.ts.
//
// This module is a channel constant + a discriminated union with NO runtime logic — the same shape
// as pairingStatus.ts and unpair.ts. Like them, it ships NO request guard (no isServerInfoRequest
// sibling): the query carries NO body — the renderer invokes with zero arguments — so there is no
// untrusted request field to validate at the boundary.
//
// UNLIKE its fully value-free twins, the present arm DOES carry two fields PER ENTRY — but only the
// two NON-SECRET ones: `serverId` (the server id) and `relayUrl` (the relay URL). The credentials
// `token` and `server_static_pubkey` are STRUCTURALLY ABSENT from this union, so the handler cannot
// serialize them back across the boundary — value-free-by-construction relaxed to exactly two
// non-secret fields, statically enforced by the type (CLAUDE.md "Keep the transport out of the
// window"; ADR 0002). #1148 made the present arm LIST-shaped so Settings can name every paired
// server; that carries the rule forward per entry rather than dropping it, and it is what makes a
// `...record` spread in the handler's map cost one bearer token PER PAIRED SERVER.
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not pull
// main-only code). Relative imports only — src/main and src/preload have no @shared alias.

/** The IPC channel the paired-server-info query travels on, renderer ↔ main.
 *  Single source of truth: the preload invoker ships on it, the main handler registers on it.
 *  A mismatch would break the query, so both sides reference this constant. Separate from
 *  PAIRING_STATUS_CHANNEL: that carries the value-free existence enum; this carries the two
 *  non-secret identity fields. */
export const SERVER_INFO_CHANNEL = 'pyry:server-info' as const

/**
 * One paired server's NON-SECRET identity: serverId ← record.server, relayUrl ← record.relay, both
 * off the AT-REST paired-server record, so both are available whether or not a live connection exists.
 * The live hello_ack.server_id is a DISTINCT, daemon-asserted value and must NOT be used — a trap that
 * grew teeth with #1117, which dials one live connection per record and so makes a per-server live id
 * available to reach for.
 *
 * Keep it minimal: do NOT add a field here. These two are the whole relaxation.
 */
export interface ServerInfoEntry {
  serverId: string
  relayUrl: string
}

/**
 * Every paired server's NON-SECRET identity, discriminated on `status`, sourced from
 * pairedServerStore.list():
 *   - available   → at least one record was read; `servers` carries one entry per paired server in
 *                   list() order (oldest-saved first), which the handler passes through unsorted.
 *   - unavailable → no server info: nothing paired (list() → []) OR the stored collection could not be
 *                   read (list() threw MalformedPairedServerRecordError or a propagated decrypt
 *                   failure). Every non-readable case collapses here, together with the empty one; the
 *                   error type is never surfaced, and there is deliberately no third arm telling
 *                   empty from unreadable — no consumer reads that distinction.
 *
 * `servers` is non-empty on the available arm by handler construction (an empty collection returns the
 * absent arm instead). That invariant is documented, not encoded: nothing depends on it — the renderer
 * maps an empty `servers` to the same value it maps `unavailable` to — and a non-empty tuple type would
 * need an unchecked cast to satisfy, which production code here forbids.
 *
 * Value-free BY CONSTRUCTION, RELAXED to exactly two non-secret fields PER ENTRY: the present arm
 * declares ONLY a list of ServerInfoEntry, so the handler cannot serialize `token` or
 * `server_static_pubkey` back across the boundary (ADR 0002) — statically enforced by the union type.
 * Do NOT add an error-reason field to the absent arm either (a coarse category could leak backend
 * detail, and the ticket mandates the error type is not surfaced).
 */
export type ServerInfo =
  | { status: 'available'; servers: ServerInfoEntry[] }
  | { status: 'unavailable' }
