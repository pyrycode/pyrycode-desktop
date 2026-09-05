// The single, typed path a daemon event takes from the background process to the renderer
// window. Transport code (#10/#12) calls this after building a DaemonEvent from a validated
// wire envelope; nothing else sends on the channel. A pure forwarder — no transform, and no
// logging (a console.log of the event would leak MessagePayload.text to main-process stdout).
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import {
  DAEMON_EVENT_CHANNEL,
  type DaemonEvent,
  type StampedDaemonEvent
} from '../shared/ipc/events'

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
 * returns — the guard covers all 39 daemonConnection call sites plus the bundle orchestrator's
 * injected emit and the notification-click emit, so nothing downstream needs its own. (39, not the 32
 * this said until #1068 recounted it against the tree.)
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

/**
 * Bind one server origin to one producer (#1068). Returns a sink that stamps every event it forwards
 * with `serverId` and hands it to `target` — so a producer emits exactly as it always has and the
 * origin rides along without any of its call sites naming, holding, or being able to vary it. In
 * `daemonConnection.ts` that is what keeps all 39 emit sites origin-free BY CONSTRUCTION rather than
 * by discipline: the local they emit into is the only thing that knows the id.
 *
 * BIND EXACTLY ONCE PER PRODUCER. A second binding over an already-bound sink silently wins — the
 * outer spread overwrites the inner `serverId` with no error — so a doubly-bound producer would
 * mis-attribute every event it emits. That is also why the composition root binds each of its three
 * emitters separately instead of wrapping the shared `live.sink` once: one binding over the shared
 * sink would stamp all three with a single id, which is exactly what a per-server registry (#1084)
 * cannot use. Nothing may emit into an unbound sink; `live.sink` is a bind target, never a producer's
 * sink.
 *
 * `serverId` is the paired record's `server`, never `hello_ack.server_id` and never the record's
 * `token` — the two are indistinguishable to the type system here, and only this call site can tell
 * them apart. A `string | null` scalar crosses, never a record, so no credential is reachable from
 * this path.
 *
 * #518 IS PRESERVED ACROSS THE EXTRA HOP, and the ordering is the same one emitDaemonEvent states.
 * `isDestroyed` delegates, so a destroyed target is still reported destroyed and the event is dropped
 * one layer up before anything here runs. `target.webContents` is read ONLY inside `send`'s body —
 * never at bind time, never aliased or destructured above — because on a real destroyed BrowserWindow
 * that property read IS the throw. Binding a destroyed target is therefore itself safe.
 *
 * Non-mutating: the stamp is a fresh object, so an event the caller still holds is untouched. Log-free
 * like the rest of this module — it handles whole events, so a console.log here would leak
 * MessagePayload.text to main-process stdout.
 */
export function bindServerOrigin(target: DaemonEventSink, serverId: string | null): DaemonEventSink {
  return {
    isDestroyed: () => target.isDestroyed(),
    webContents: {
      send: (channel: string, event: DaemonEvent): void => {
        // Bound to its own const, not passed inline: a fresh object literal in argument position is
        // excess-property-checked against the parameter's bare DaemonEvent and `serverId` would be
        // rejected. As a typed local it is a StampedDaemonEvent, which IS a DaemonEvent.
        const stamped: StampedDaemonEvent = { ...event, serverId }
        target.webContents.send(channel, stamped)
      }
    }
  }
}
