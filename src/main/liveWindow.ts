// The one thing in the composition root that knows which window is current (#519). On macOS the app
// outlives its window (index.ts quits only on non-darwin) and the connection keeps running, so the
// root cannot capture a BrowserWindow once and hand that reference to everything window-bound: after
// a close → dock-reopen every captured reference still points at the destroyed original. #518 made
// that safe — each callee guards on isDestroyed() — but safe is not working: the new window
// subscribes to the daemon-event channel and receives nothing, forever.
//
// This module is the indirection. The root routes through it instead of through a window, and
// `attach` makes the newest window current. Because it sits in the sink position it also sees every
// status transition go past, which is what lets a freshly created window be brought up to date
// (AC2) rather than merely subscribed — connection state reaches the renderer only as discrete
// events, and a fresh session store starts at `{ type: 'disconnected' }`, so on a stable connection
// a correctly-routed new window would otherwise sit at "disconnected" indefinitely.
//
// Electron-free and unit-testable: typed against the three structural interfaces its consumers
// declare, never against BrowserWindow, so it imports no `electron` module and the test injects
// fakes. It holds no reference to the connection at all — which is what makes AC4 ("closing and
// reopening a window does not restart or re-handshake") structural rather than behavioural.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { emitDaemonEvent, type DaemonEventSink } from './emitDaemonEvent'
import type { ActivatableWindow, FocusableWindow } from './fireNotification'
import type { DaemonEvent } from '../shared/ipc/events'

/**
 * What the root routes through. A real BrowserWindow satisfies it structurally, as it already
 * satisfies all three constituents separately.
 *
 * This is the answer to #518's open question 3 (do the three window interfaces collapse into one?):
 * they do NOT — they INTERSECT, here, in the one module that needs all three at once. Merging them
 * would force every leaf consumer to depend on members it does not use and would widen the four
 * existing sink fixtures for no gain, so no interface is edited and no fixture cascades.
 */
export type WindowTarget = DaemonEventSink & FocusableWindow & ActivatableWindow

/** The two faces the root routes through, plus the two operations it performs on them. */
export interface LiveWindow {
  /** Make `window` the current one. Replaces any predecessor; never touches the old window. */
  attach(window: WindowTarget): void
  /** The process-lifetime sink handed to the connection and the bundle orchestrator. */
  readonly sink: DaemonEventSink
  /** The current-window stand-in for the focus query and click activation. */
  readonly window: FocusableWindow & ActivatableWindow
  /**
   * Re-deliver every server's last recorded status event into the current window, in the order the
   * servers first reported. No-op if none has been recorded. Plural since #1121; the signature and
   * the single call site are unchanged, so `openWindow` does not learn how many servers exist.
   */
  replayStatus(): void
}

/**
 * The four connection-status members of DaemonEvent (events.ts) — the ONLY members the recorder
 * keys on. Deliberately not "the last event of any type": caching a `messageReceived` would retain
 * MessagePayload.text in main-process memory beyond its delivery, and none of these four carries a
 * token, key, or message body (`connecting`/`disconnected` are nullary, `failed` carries the closed
 * ErrorPayload, `connected` the HelloAckPayload).
 */
type StatusEvent = Extract<
  DaemonEvent,
  { type: 'connecting' } | { type: 'connected' } | { type: 'disconnected' } | { type: 'failed' }
>

function isStatusEvent(event: DaemonEvent): event is StatusEvent {
  switch (event.type) {
    case 'connecting':
    case 'connected':
    case 'disconnected':
    case 'failed':
      return true
    default:
      return false
  }
}

/**
 * Which slot a status event is filed under (#1121). THREE kinds of key, and the distinction between
 * the last two is deliberate rather than incidental — events.ts's ServerOrigin header draws it:
 *
 *   - a `string` — one slot per paired server, which is the whole point of the widening;
 *   - `null` — a PRESENT null: a producer bound while no paired record was in hand. Live, not
 *     hypothetical: connectionRegistry's not-paired stand-in is built with `serverId: null` and is
 *     dialled like any other, so its `failed(not-paired)` genuinely lands here;
 *   - `undefined` — no property at all, meaning a producer that never went through a binding.
 *     Unreachable in production (bindServerOrigin's header: every producer is bound exactly once,
 *     and `live.sink` is a bind target, never a producer's sink) but reachable from the tests, which
 *     emit bare literals. Recording it keeps the recorder TOTAL — an unbound producer's status is
 *     replayed rather than silently dropped — which is the same choice #519 made for a status
 *     emitted before any window exists.
 *
 * Coalescing `undefined` into `null` would erase that distinction in the one place it is observable.
 */
type StatusOrigin = string | null | undefined

/**
 * Read the origin off an event that has already been through `bindServerOrigin`.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the
 * sink's parameter as `StampedDaemonEvent`: at a `DaemonEventSink`-typed hole the static type is the
 * BARE union (#1068 carries the stamp beside the union, not inside its arms), so the property arrives
 * structurally while the type stays silent about it, and a re-declared parameter would compile only
 * because method parameters are bivariant — sound-looking and unsound. `conversationRouter`'s
 * `originOf` is the same idiom; this one keeps the three cases apart where that one folds them.
 *
 * The origin is read ONLY from the stamp, NEVER from the payload — in particular never from
 * `connected`'s `ack.server_id`, which is a DISTINCT, daemon-supplied value. The stamp is bound at
 * construction from a client-held paired record, so a hostile or confused daemon cannot make its
 * events claim another server's slot and overwrite that server's cached status; a wire-sourced id
 * would hand it exactly that. `serverInfo.ts` and ServerOrigin's header both already rule this.
 */
function originOf(event: DaemonEvent): StatusOrigin {
  if (!('serverId' in event)) return undefined
  const { serverId } = event
  if (serverId === null) return null
  // The `in` guard narrows the property to `unknown`, so the type is re-established here rather than
  // asserted. A value that is neither a string nor null files under the unstamped slot: no producer
  // can emit one (bindServerOrigin takes a `string | null` scalar), and answering with a slot rather
  // than throwing is what keeps this total.
  return typeof serverId === 'string' ? serverId : undefined
}

/**
 * Build the live-window holder. Exactly two pieces of mutable state, both plain fields: the current
 * window and the status index. No store, no timer, no listener, no async work — so there is nothing
 * to cancel and no new leak surface. Every read is a call-time query, so the answer is correct
 * regardless of when the window was destroyed relative to the last event, and there is no
 * check-then-act gap (record, guard, and send are consecutive synchronous statements, and window
 * destruction happens on the same thread).
 */
export function createLiveWindow(): LiveWindow {
  let current: WindowTarget | null = null
  /**
   * One slot per origin (#1121), replacing the single cell #519 shipped. That cell held one server,
   * and since #1117 the registry holds one connection per paired server — all of them emitting into
   * this one sink — so each write erased the last and a reopened window learned the state of
   * whichever connection emitted most recently and nothing about the others. On a healthy connection
   * the next status change is never, so every other server's dot stayed wrong for the window's life.
   *
   * A Map, NEVER a bare object. events.ts's ServerOrigin docblock rules it for any consumer that
   * indexes by the id ("if a consumer indexes by it, THE INDEX IS A Map") — a `__proto__` id would
   * write through Object.prototype on a `Record<string, StatusEvent>` — and this module is the first
   * main-side consumer to index by it. `conversationRouter`'s index is the same ruling applied.
   *
   * Iteration is insertion-ordered and re-`set`ting an existing key leaves its position alone, so
   * the replay order is the order the servers first reported and a server that changes state keeps
   * its slot. That is where the stable order comes from; this module maintains nothing.
   *
   * Growth is bounded by the distinct-origin count — one per paired server plus at most the two
   * non-server keys — so no daemon can mint a slot. Nothing is evicted: a torn-down server's last
   * status is `failed` or `disconnected`, which is exactly what a reopened window should be told.
   */
  const statuses = new Map<StatusOrigin, StatusEvent>()

  /** One hop down into #518's guard, which drops the event when the current window is destroyed. */
  const forward = (event: DaemonEvent): void => {
    if (current === null) return
    emitDaemonEvent(current, event)
  }

  const sink: DaemonEventSink = {
    /**
     * ALWAYS false, and this is the load-bearing decision in the module rather than an oversight.
     *
     * The recorder below must sit ABOVE #518's destroyed-window guard. Were this honest, an event
     * emitted while no window exists would return early in emitDaemonEvent and never be recorded —
     * so a status change during the closed-window gap would be missed and replayStatus() would
     * deliver a STALE value into the new window. That is not theoretical: unpair (#504) tears the
     * session down and settles permanently at failed(not-paired) with no further event ever, so a
     * window reopened afterwards would be told `connected` and would keep saying so forever.
     * Replaying a stale status is worse than replaying none.
     *
     * So this is not a window pretending to be one. It is the process-lifetime channel TO whatever
     * window is current: it is never destroyed, it accepts every event, and it drops one hop down
     * inside `forward` — through emitDaemonEvent, whose guard therefore stays load-bearing rather
     * than becoming dead code. DaemonEventSink is a sink interface, not a window interface (every
     * existing test fixture satisfies it with a non-window), so this is a legitimate implementation.
     */
    isDestroyed: () => false,
    webContents: {
      /** `channel` is re-supplied by emitDaemonEvent on the forward, so it is ignored here. */
      send: (_channel: string, event: DaemonEvent): void => {
        if (isStatusEvent(event)) statuses.set(originOf(event), event)
        forward(event)
      }
    }
  }

  /**
   * The opposite requirement from the sink: windowHasFocus and activateWindow decide whether to act
   * by asking isDestroyed() first, so here the truthful "there is no window right now" is exactly
   * what is wanted — a closed window cannot hold focus (so a notification still fires), and a click
   * with no window stays the total no-op #518 made it.
   *
   * The five members below delegate when a window is attached and are inert when none is, so the
   * face is total rather than relying on its callers' guard ordering. They do NOT swallow the
   * destroyed case: this is a faithful stand-in for the current window, so a destroyed one is
   * reported destroyed and its callees' guards handle it, exactly as for a real BrowserWindow. A
   * second layer of #518's guard here would only make that one dead.
   */
  const window: FocusableWindow & ActivatableWindow = {
    isDestroyed: () => current === null || current.isDestroyed(),
    isFocused: () => (current === null ? false : current.isFocused()),
    isMinimized: () => (current === null ? false : current.isMinimized()),
    restore: () => current?.restore(),
    show: () => current?.show(),
    focus: () => current?.focus()
  }

  return {
    /**
     * Assignment only. It does NOT clear the recorded statuses — connection state is independent of
     * windows, and the records surviving the gap are precisely what makes the gap case correct — and
     * it does NOT replay, because at attach time (window creation) the renderer has not subscribed
     * yet. No `'closed'` listener either: a cached destroyed-flag would be a second source of truth
     * that can disagree with the object, so isDestroyed() is queried at call time instead.
     */
    attach(next: WindowTarget): void {
      current = next
    },
    sink,
    window,
    /**
     * One forward per held server. Each goes through `forward`'s own null check and #518's guard, so
     * a window destroyed part-way through drops the remaining events exactly as it drops a single
     * one — no partial-state handling and nothing to unwind. Synchronous with no await, and `forward`
     * bottoms out in a `webContents.send` that posts rather than calling back into the sink, so no
     * slot can be added or replaced mid-iteration.
     */
    replayStatus(): void {
      for (const status of statuses.values()) forward(status)
    }
  }
}
