// The session store's diagnostics observer: maps each dispatched SessionAction to a content-free
// record and emits it through the renderer→main diagnostics channel (#131), so a state-layer fault
// leaves a footprint in the debug bundle alongside the transport logs (#126). This is the ONLY
// place the store layer touches window.pyry, which keeps sessionStore.ts a pure state container
// ("no IPC, no preload bridge, no transport", sessionStore.ts:2).
//
// Content-free by construction (AC4): the record is built from exactly the action `type` (a static
// enum member) and the post-reduce message count — never a message payload, ack contents, or error
// text. The main-side projectDiagnosticEvent (#131) re-validates the same guarantee at the
// untrusted boundary, so it is upheld twice with different fabric.
import type { RendererDiagnosticEvent } from '@shared/ipc/diagnostics'
import type { SessionAction, SessionState } from './sessionStore'

/**
 * Map a state transition to its content-free diagnostic record. Pure. The three output fields are
 * named explicitly, so the record is structurally incapable of carrying a payload value:
 *  - `event` — the static transition name.
 *  - `code`  — the action `type` (a static enum member; 1:1 with the resulting status name for the
 *              status actions, modulo the documented `failed`→`error` naming).
 *  - `count` — `state.messages.length` AFTER reduce (the resulting message count).
 * No `seq`: ordering is stamped by the #126 logger, and RendererDiagnosticEvent has no such field
 * (AC2) — a seq the store tried to emit would not typecheck and would be dropped by the boundary
 * projection regardless.
 */
export function toDiagnosticRecord(
  action: SessionAction,
  state: SessionState
): RendererDiagnosticEvent {
  return { event: 'store-transition', code: action.type, count: state.messages.length }
}

/**
 * Emit one record per dispatched action through window.pyry.sendDiagnostic (AC1, AC3). Guarded and
 * non-throwing by construction (AC5): `typeof window` never throws on an undeclared global, the
 * optional chain tolerates a defined window with no `pyry`/`sendDiagnostic`, and both the reads
 * (action.type, messages.length) and the plain-primitive record are throw-free — so no try/catch is
 * warranted. When the channel is unavailable (the renderer-only vitest node env, or any pre-bridge
 * context) it degrades to a silent no-op and the store still reduces normally.
 */
export function logSessionTransition(action: SessionAction, state: SessionState): void {
  const send = typeof window !== 'undefined' ? window.pyry?.sendDiagnostic : undefined
  if (!send) return
  send(toDiagnosticRecord(action, state))
}
