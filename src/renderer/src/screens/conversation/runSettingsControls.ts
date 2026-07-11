// The Run configuration write CONTROL — a framework-free, React-free helper co-located with the sheet
// (the modalResolution.ts shape): its whole job is the AC5 session-id gate over #256's already-built,
// already-tested submitSettingsChange. sessionIdStore holds `string | null` (null until the first
// session_transition marker, #259/#254); submitSettingsChange types `sessionId` NON-null. changeSetting
// is the seam that turns the nullable id into a gated call — null → no-op (no send, no dispatch), else
// delegate. Injected deps (sendCommand/dispatch/mintChangeId), so it is unit-testable under the `node`
// env with plain spies, exactly where the container's view cannot be (no DOM to fire clicks). It adds no
// send/dispatch logic of its own; the correlation-id mint, record-before-send, and single-command send
// all live in submitSettingsChange.
import type { RendererCommand } from '@shared/ipc/commands'
import { submitSettingsChange } from '../../store/runSettingsWriteBridge'
import type { RunSettingsWriteEvent, SettingsChange } from '../../store/runSettingsWriteStore'

/**
 * The effects changeSetting forwards, injected so the gate stays pure and deterministic in tests.
 * `sessionId` is the nullable sessionIdStore value — null is the "no marker yet" state the gate
 * no-ops on (AC5). `sendCommand` is `window.pyry.sendCommand` in the container; `dispatch` is the
 * runSettingsWriteStore's `dispatch`; `mintChangeId` is a test injection forwarded to
 * submitSettingsChange (which defaults it to `crypto.randomUUID()` in the app).
 */
export interface RunSettingsControlDeps {
  sessionId: string | null
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: RunSettingsWriteEvent) => void
  mintChangeId?: () => string
}

/**
 * Submit one Model / Effort / YOLO change for the current session, GATED on a known session id (AC5).
 * If `sessionId` is null the call is a no-op — nothing sent, nothing dispatched, no optimistic overlay —
 * the deterministic safety net behind the container's structural gate (it withholds the handler entirely
 * until a session id exists). Otherwise `sessionId` is narrowed to `string` and the change is forwarded
 * verbatim to submitSettingsChange, which mints the correlation `changeId`, records the optimistic
 * pending change (record-before-send), and sends exactly one `setSessionSettings` command carrying the
 * single changed field.
 */
export function changeSetting(deps: RunSettingsControlDeps, change: SettingsChange): void {
  const { sessionId } = deps
  if (sessionId === null) return
  submitSettingsChange(
    {
      sessionId,
      sendCommand: deps.sendCommand,
      dispatch: deps.dispatch,
      mintChangeId: deps.mintChangeId
    },
    change
  )
}
