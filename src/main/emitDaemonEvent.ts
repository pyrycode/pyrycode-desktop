// The single, typed path a daemon event takes from the background process to the renderer
// window. Transport code (#10/#12) calls this after building a DaemonEvent from a validated
// wire envelope; nothing else sends on the channel. A pure forwarder — no transform, and no
// logging (a console.log of the event would leak MessagePayload.text to main-process stdout).
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'

/**
 * The minimal window surface the emitter needs. A real Electron BrowserWindow satisfies this
 * structurally (its webContents.send accepts (channel, ...args)); the unit test passes a fake
 * `{ webContents: { send: vi.fn() } }`, so no Electron harness is required. Typing `send`'s
 * second parameter as DaemonEvent also stops any non-event payload reaching the channel.
 */
export interface DaemonEventSink {
  webContents: { send(channel: string, event: DaemonEvent): void }
}

/**
 * The one and only path a typed event takes from the background process to the renderer.
 * Sends `event` on DAEMON_EVENT_CHANNEL — no transform, no clone, no logging.
 */
export function emitDaemonEvent(sink: DaemonEventSink, event: DaemonEvent): void {
  sink.webContents.send(DAEMON_EVENT_CHANNEL, event)
}
