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
 * `sessionId` is the nullable sessionIdStore value. Both null ("never observed") and '' ("the
 * daemon says it has no session to address") are states the gate no-ops on — see
 * isAddressableSessionId below. `sendCommand` is `window.pyry.sendCommand` in the container; `dispatch` is the
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
 * Whether a session id can actually be written to. The single definition of the sheet's operability
 * rule, used by BOTH gate sites (this module's safety net and RunConfigSections' structural gate) so
 * the rule lives in exactly one place and has a unit-test seam.
 *
 * `null` = never observed. `''` = the daemon explicitly said it has no session to address. Both are
 * inert, for different reasons that reach the same conclusion: there is nothing to address.
 *
 * The store deliberately holds '' VERBATIM rather than coercing it to null (see sessionIdStore),
 * because "the daemon told me there is no session" and "I have not heard yet" are different facts
 * worth keeping apart. This predicate is where they converge. Without it, an '' would open the gate
 * and every write would go out with an empty address for the daemon to reject — strictly worse than
 * staying inert.
 */
export function isAddressableSessionId(sessionId: string | null): sessionId is string {
  return sessionId !== null && sessionId !== ''
}

/**
 * Submit one Model / Effort / YOLO change for the current session, GATED on an addressable session
 * id. If there is none the call is a no-op — nothing sent, nothing dispatched, no optimistic overlay
 * — the deterministic safety net behind the container's structural gate (it withholds the handler
 * entirely until a session id exists). Otherwise `sessionId` is narrowed to `string` and the change
 * is forwarded verbatim to submitSettingsChange, which mints the correlation `changeId`, records the
 * optimistic pending change (record-before-send), and sends exactly one `setSessionSettings` command
 * carrying the single changed field.
 */
export function changeSetting(deps: RunSettingsControlDeps, change: SettingsChange): void {
  const { sessionId } = deps
  if (!isAddressableSessionId(sessionId)) return
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
