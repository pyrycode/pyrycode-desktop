// The single, typed path a daemon event takes from the background process to the renderer
// window. Transport code (#10/#12) calls this after building a DaemonEvent from a validated
// wire envelope; nothing else sends on the channel. A pure forwarder — no transform, and no
// logging (a console.log of the event would leak MessagePayload.text to main-process stdout).
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'

/**
 * The minimal window surface the emitter needs. A real Electron BrowserWindow satisfies this
 * structurally (its webContents.send accepts (channel, ...args)); the unit test passes a fake,
 * so no Electron harness is required. Typing `send`'s second parameter as DaemonEvent also stops
 * any non-event payload reaching the channel.
 */
export interface DaemonEventSink {
  /**
   * True once the window has been destroyed (#518). REQUIRED, not optional: an optional member
   * would let a future sink silently opt out of the guard below. This is the ONE member safe to
   * call on a destroyed BrowserWindow — every other access, `webContents` included, throws.
   */
  isDestroyed(): boolean
  webContents: { send(channel: string, event: DaemonEvent): void }
}

/**
 * The one and only path a typed event takes from the background process to the renderer.
 * Sends `event` on DAEMON_EVENT_CHANNEL — no transform, no clone, no logging.
 *
 * DESTROYED-WINDOW GUARD (#518). On macOS, closing the window destroys the BrowserWindow but does
 * not quit the app (index.ts:393-395 quits only on non-darwin), so the connection keeps emitting
 * into a destroyed object; the transport calls this from a ws message handler with no try/catch,
 * so a throw here is an uncaught main-process exception. A destroyed window drops the event and
 * returns — the guard covers all 32 daemonConnection call sites plus the bundle orchestrator's
 * injected emit, so nothing downstream needs its own.
 *
 * NOTHING MAY READ `sink.webContents` ABOVE THE GUARD — no destructure, no early alias. The
 * property read IS the throw ("Object has been destroyed"), before `send` is ever reached.
 *
 * No try/catch: it could not tell destruction from a genuine send fault (a non-cloneable payload,
 * a channel-name bug) and would turn real defects into silent drops. No logging on the drop
 * either — this module is log-free by construction (see the header).
 */
export function emitDaemonEvent(sink: DaemonEventSink, event: DaemonEvent): void {
  if (sink.isDestroyed()) return
  sink.webContents.send(DAEMON_EVENT_CHANNEL, event)
}
