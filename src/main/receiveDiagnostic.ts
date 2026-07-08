// The single, typed seam an incoming renderer diagnostic record passes through on the main side.
// The composition root (src/main/index.ts) calls this once with Electron's ipcMain and the ONE
// #126 diagnosticLog instance; a record forwarded here lands in the same debug bundle as the
// transport logs. Mirror image of receiveCommand.ts: same one-way, boundary-validated shape,
// carrying a content-free DiagnosticEvent instead of a RendererCommand.
//
// The deviation from onCommand: onCommand forwards the validated RAW object to its handler (safe
// there — the handler only reads command.payload). Here the record reaches logger.event(), which
// SPREADS its argument (diagnosticLog.ts:87), so a raw-forward would spread a planted extra field
// onto the log line. projectDiagnosticEvent returns a fresh allowlisted object; this receiver
// forwards ONLY that.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { DIAGNOSTIC_CHANNEL, projectDiagnosticEvent } from '../shared/ipc/diagnostics'
import type { DiagnosticLog } from './diagnosticLog'

/**
 * The minimal main-process surface the receiver needs. Electron's `ipcMain` satisfies this
 * structurally; the unit test passes a fake `{ on: vi.fn(), removeListener: vi.fn() }`, so no
 * Electron harness is required. Defined locally (parallel to CommandSource) to keep the two
 * receivers decoupled. `event`/`record` are typed `unknown` on purpose — the first arg is
 * stripped, the second is projected before use.
 */
export interface DiagnosticSource {
  on(channel: string, listener: (event: unknown, record: unknown) => void): void
  removeListener(channel: string, listener: (event: unknown, record: unknown) => void): void
}

/**
 * Register the single inbound handler for renderer diagnostic records. Returns an unsubscribe
 * handle that removes the exact listener it added. The listener:
 *  - strips the IpcMainEvent first arg (never forwarded — it exposes .sender/.ports, a capability
 *    leak),
 *  - projects the record at the untrusted→trusted boundary; forwards to `logger.event` only if the
 *    projection is non-null; on null, drops with a fixed-string warn carrying no renderer data
 *    (parity with onCommand),
 *  - wraps its body in try/catch so no projection/forwarding failure escapes (AC3). logger.event
 *    already swallows sink throws (#126); this is the belt-and-suspenders outer net, so a
 *    diagnostics fault cannot take down the window it observes.
 *
 * The receiver never constructs a logger — it forwards to the injected one.
 */
export function onDiagnostic(source: DiagnosticSource, logger: DiagnosticLog): () => void {
  const listener = (_event: unknown, raw: unknown): void => {
    try {
      const projected = projectDiagnosticEvent(raw)
      if (projected === null) {
        console.warn('pyry:diagnostic — dropped malformed record')
        return
      }
      logger.event(projected)
    } catch {
      // Swallow: a diagnostics channel observing the renderer must not crash the window it
      // observes (AC3). The swallow hides a fault; it never widens what is logged.
    }
  }
  source.on(DIAGNOSTIC_CHANNEL, listener)
  return () => source.removeListener(DIAGNOSTIC_CHANNEL, listener)
}
