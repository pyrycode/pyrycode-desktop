import { describe, it, expect, vi } from 'vitest'
import { createLiveWindow, type WindowTarget } from './liveWindow'
import { emitDaemonEvent } from './emitDaemonEvent'
import { activateWindow, windowHasFocus } from './fireNotification'
import {
  DAEMON_EVENT_CHANNEL,
  type DaemonEvent,
  type StampedDaemonEvent
} from '../shared/ipc/events'
import type { ErrorPayload, HelloAckPayload } from '../shared/wire/types'

// A structural stand-in for a real BrowserWindow across all three interfaces WindowTarget
// intersects (#519). Two fixture properties are load-bearing, both learned from #518:
//
//   * every spy is a HANDLE on the return value, never reached through `win.webContents.send` —
//     because `webContents` is a getter that throws once destroyed, so an assertion that read
//     through the window would itself blow up on exactly the tests that matter;
//   * that throwing getter models a real destroyed BrowserWindow, where the property READ is the
//     throw. It is what proves a forward goes through emitDaemonEvent's guard rather than around it.
//
// No Electron harness — the helper is typed against the three minimal interfaces, not BrowserWindow.
//
// Every emit below is driven through the REAL emitDaemonEvent, and every focus/activate through the
// REAL windowHasFocus / activateWindow, the way #518's AC4 test composes the root's actual wiring.
// Calling `live.sink.webContents.send` directly would skip the outer isDestroyed() check that
// production performs, leaving the sink's never-destroyed property asserted only in isolation —
// which is exactly the property the gap case depends on.
function fakeWindow(): {
  win: WindowTarget
  destroy(): void
  setFocused(focused: boolean): void
  setMinimized(minimized: boolean): void
  send: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
} {
  let destroyed = false
  let focused = false
  let minimized = false
  const send = vi.fn()
  const webContents = { send }
  const isFocused = vi.fn(() => focused)
  const isMinimized = vi.fn(() => minimized)
  const restore = vi.fn()
  const show = vi.fn()
  const focus = vi.fn()
  return {
    win: {
      isDestroyed: () => destroyed,
      get webContents(): { send(channel: string, event: DaemonEvent): void } {
        if (destroyed) throw new Error('Object has been destroyed')
        return webContents
      },
      isFocused,
      isMinimized,
      restore,
      show,
      focus
    },
    destroy(): void {
      destroyed = true
    },
    setFocused(value: boolean): void {
      focused = value
    },
    setMinimized(value: boolean): void {
      minimized = value
    },
    send,
    isFocused,
    isMinimized,
    restore,
    show,
    focus
  }
}

const ACK: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

const NOT_PAIRED: ErrorPayload = { code: 'not-paired', message: 'no pairing', retryable: false }

describe('createLiveWindow — routing (#519 AC1)', () => {
  it('forwards an event through the sink into the attached window, by reference', () => {
    const live = createLiveWindow()
    const a = fakeWindow()
    const event: DaemonEvent = { type: 'connecting' }

    live.attach(a.win)
    emitDaemonEvent(live.sink, event)

    expect(a.send).toHaveBeenCalledTimes(1)
    // Channel from the exported constant, and the same object reference — a pure forward.
    expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, event)
    expect(a.send.mock.calls[0][1]).toBe(event)
  })

  it('routes to the replacement window after the original is destroyed and a new one attaches', () => {
    // The core AC1 assertion: the macOS close → dock-reopen sequence. Before this ticket every
    // captured reference still pointed at the destroyed original, so the new window got nothing.
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()
    const event: DaemonEvent = {
      type: 'messageReceived',
      message: { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi' }
    }

    live.attach(a.win)
    a.destroy()
    live.attach(b.win)
    emitDaemonEvent(live.sink, event)

    expect(b.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, event)
    expect(a.send).not.toHaveBeenCalled()
  })

  it('drops an event when the attached window is destroyed and no replacement exists', () => {
    const live = createLiveWindow()
    const a = fakeWindow()

    live.attach(a.win)
    a.destroy()

    expect(() => emitDaemonEvent(live.sink, { type: 'connecting' })).not.toThrow()
    expect(a.send).not.toHaveBeenCalled()
  })

  it('drops an event emitted before any window is attached, and never queues it', () => {
    const live = createLiveWindow()
    const a = fakeWindow()
    const event: DaemonEvent = { type: 'notificationActivated' }

    expect(() => emitDaemonEvent(live.sink, event)).not.toThrow()

    // Attaching afterwards does not deliver it: the recorder holds one status event, never a queue.
    live.attach(a.win)
    expect(a.send).not.toHaveBeenCalled()
  })

  it('reports the sink as never destroyed, even while the attached window is', () => {
    // The crux of the design, asserted directly. The sink is the process-lifetime channel TO
    // whatever window is current, not a window: it must stay above #518's guard so a status change
    // during the closed-window gap is still recorded. An honest isDestroyed() here would make
    // emitDaemonEvent return early and replayStatus() deliver a STALE status into the new window.
    const live = createLiveWindow()
    const a = fakeWindow()

    expect(live.sink.isDestroyed()).toBe(false)
    live.attach(a.win)
    expect(live.sink.isDestroyed()).toBe(false)
    a.destroy()
    expect(live.sink.isDestroyed()).toBe(false)
  })
})

describe('createLiveWindow — status convergence (#519 AC2)', () => {
  it('replays the recorded status into a window attached after it was emitted', () => {
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()
    const connected: DaemonEvent = { type: 'connected', ack: ACK }

    live.attach(a.win)
    emitDaemonEvent(live.sink, connected)
    a.destroy()
    live.attach(b.win)
    b.send.mockClear()

    live.replayStatus()

    expect(b.send).toHaveBeenCalledTimes(1)
    expect(b.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connected)
    expect(b.send.mock.calls[0][1]).toBe(connected)
  })

  it('replays a stamped status with its server origin intact (#1068)', () => {
    // The recorder is the ONE place an event is stored and re-sent, so it is the one place a stamp
    // could be silently lost. It sits DOWNSTREAM of every binding — the connection stamps, then
    // forwards into this sink — so what it records is already stamped and must replay that way. A
    // reopened window learning `connected` with no origin would be told which state, but not whose.
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()
    const connected: StampedDaemonEvent = { type: 'connected', ack: ACK, serverId: 'srv-a' }

    live.attach(a.win)
    emitDaemonEvent(live.sink, connected)
    a.destroy()
    live.attach(b.win)
    b.send.mockClear()

    live.replayStatus()

    expect(b.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connected)
    expect((b.send.mock.calls[0][1] as StampedDaemonEvent).serverId).toBe('srv-a')
  })

  it('replays the status that changed WHILE no window was live, not the one before it', () => {
    // The gap case, and the single test that fails if the recorder sits BELOW #518's guard. Unpair
    // (#504) is the real sequence: the session settles permanently at failed(not-paired) with no
    // further event ever, so a window reopened afterwards must be told `failed`. Told `connected`
    // it would claim a live connection forever — replaying a stale status is worse than none.
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()
    const failed: DaemonEvent = { type: 'failed', error: NOT_PAIRED }

    live.attach(a.win)
    emitDaemonEvent(live.sink, { type: 'connected', ack: ACK })
    a.destroy()
    emitDaemonEvent(live.sink, failed) // into the gap: dropped, but recorded
    live.attach(b.win)

    live.replayStatus()

    expect(b.send).toHaveBeenCalledTimes(1)
    expect(b.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, failed)
  })

  it('records a status emitted before any window exists', () => {
    // Unreachable in production — openWindow() runs synchronously before any emit can arrive — but
    // total by construction, so the recorder cannot depend on a window having been attached.
    const live = createLiveWindow()
    const a = fakeWindow()
    const connecting: DaemonEvent = { type: 'connecting' }

    emitDaemonEvent(live.sink, connecting)
    live.attach(a.win)
    live.replayStatus()

    expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connecting)
  })

  it('does not let a non-status event overwrite the recorded status', () => {
    const live = createLiveWindow()
    const a = fakeWindow()
    const connected: DaemonEvent = { type: 'connected', ack: ACK }

    live.attach(a.win)
    emitDaemonEvent(live.sink, connected)
    emitDaemonEvent(live.sink, {
      type: 'messageReceived',
      message: { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'secret' }
    })
    a.send.mockClear()

    live.replayStatus()

    // Only status is cached: caching any-event would retain MessagePayload.text in main-process
    // memory beyond its delivery, which the security review calls out as a MUST-FIX shape.
    expect(a.send).toHaveBeenCalledTimes(1)
    expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connected)
  })

  it('records every status member, last write wins', () => {
    // Table-driven over DaemonEvent's four status members — the set the recorder keys on. A fifth
    // status member added upstream and not recorded here shows up as a gap.
    //
    // Since #1121 the recorder holds one slot PER ORIGIN, and these four literals are unstamped, so
    // they all share the one unstamped slot: what this asserts is last-write-wins WITHIN an origin,
    // which is the property it always asserted. That it passes unedited is the evidence that the
    // per-server widening left the single-origin behaviour alone.
    const statuses: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'connected', ack: ACK },
      { type: 'disconnected' },
      { type: 'failed', error: NOT_PAIRED }
    ]

    for (const status of statuses) {
      const live = createLiveWindow()
      const a = fakeWindow()
      live.attach(a.win)
      emitDaemonEvent(live.sink, status)
      a.send.mockClear()

      live.replayStatus()

      expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, status)
    }

    // Last write wins across the whole set: replay reflects the final transition, not the first.
    const live = createLiveWindow()
    const a = fakeWindow()
    live.attach(a.win)
    for (const status of statuses) emitDaemonEvent(live.sink, status)
    a.send.mockClear()

    live.replayStatus()

    expect(a.send).toHaveBeenCalledTimes(1)
    expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, statuses[3])
  })

  it('sends nothing when replaying with no status recorded — the first window’s path', () => {
    const live = createLiveWindow()
    const a = fakeWindow()

    live.attach(a.win)
    expect(() => live.replayStatus()).not.toThrow()

    expect(a.send).not.toHaveBeenCalled()
  })

  it('sends nothing when replaying with a status recorded but no live window', () => {
    const live = createLiveWindow()
    const a = fakeWindow()

    live.attach(a.win)
    emitDaemonEvent(live.sink, { type: 'connecting' })
    a.destroy()

    expect(() => live.replayStatus()).not.toThrow()
  })
})

// One slot per server (#1121). The recorder held a single cell until now, so every connection wrote
// the same one and each write erased the last: a reopened window learned the state of whichever
// connection emitted most recently and nothing about the others. Since #1117 the registry holds one
// connection per paired server, so that is a live defect rather than a prospective one.
//
// Every case below reuses the ONE `ACK` for two different origins on purpose. The slot is chosen by
// the stamp `bindServerOrigin` applied from a client-held paired record — never by the payload's own
// `ack.server_id`, which is a distinct, daemon-supplied value. Were the recorder to key on that, a
// confused daemon could overwrite another server's cached status and a reopened window would render
// it as that server's state; reusing an ACK whose `server_id` matches neither origin is what makes
// keying on it fail here rather than in production.
describe('createLiveWindow — per-server status convergence (#1121)', () => {
  const connectedA: StampedDaemonEvent = { type: 'connected', ack: ACK, serverId: 'srv-a' }
  const failedA: StampedDaemonEvent = { type: 'failed', error: NOT_PAIRED, serverId: 'srv-a' }
  const connectingB: StampedDaemonEvent = { type: 'connecting', serverId: 'srv-b' }
  const disconnectedB: StampedDaemonEvent = { type: 'disconnected', serverId: 'srv-b' }

  it('replays a status for every server, each with its own origin intact', () => {
    // The headline case, and the one the single cell cannot pass: with one cell `connectedA` is
    // erased by `disconnectedB` and the reopened window is told nothing about srv-a at all.
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()

    live.attach(a.win)
    emitDaemonEvent(live.sink, connectedA)
    emitDaemonEvent(live.sink, disconnectedB)
    a.destroy()
    live.attach(b.win)
    b.send.mockClear()

    live.replayStatus()

    expect(b.send).toHaveBeenCalledTimes(2)
    expect(b.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connectedA)
    expect(b.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, disconnectedB)
    // By reference, and stamped: the window is told which state AND whose.
    const replayed = b.send.mock.calls.map((call) => call[1] as StampedDaemonEvent)
    expect(replayed.map((event) => event.serverId)).toEqual(['srv-a', 'srv-b'])
  })

  it('replaces one server’s status and leaves every other server’s untouched', () => {
    // srv-a transitions twice while srv-b never moves. Per-slot last-write-wins: srv-a's replay is
    // its LATEST, and srv-b's is not collateral damage.
    const live = createLiveWindow()
    const a = fakeWindow()

    live.attach(a.win)
    emitDaemonEvent(live.sink, connectedA)
    emitDaemonEvent(live.sink, connectingB)
    emitDaemonEvent(live.sink, failedA)
    a.send.mockClear()

    live.replayStatus()

    expect(a.send).toHaveBeenCalledTimes(2)
    expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, failedA)
    expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connectingB)
    expect(a.send).not.toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connectedA)
  })

  it('replays in insertion order, and a replacement does not move its server to the back', () => {
    // AC2's stable order. It is a property of Map — re-`set`ting an existing key leaves its position
    // alone — rather than something this module maintains, so it is asserted rather than engineered:
    // srv-a reported first and still replays first even though its LATEST status is the newest of
    // the three. Ordered assertion, not a set membership one, or the property would go untested.
    const live = createLiveWindow()
    const a = fakeWindow()

    live.attach(a.win)
    emitDaemonEvent(live.sink, connectedA)
    emitDaemonEvent(live.sink, connectingB)
    emitDaemonEvent(live.sink, failedA)
    a.send.mockClear()

    live.replayStatus()

    expect(a.send.mock.calls.map((call) => call[1])).toEqual([failedA, connectingB])
  })

  it('keeps a null origin, an unstamped event and a server id in three distinct slots', () => {
    // `null` and absent are NOT the same thing, and events.ts's ServerOrigin header draws exactly
    // that distinction: a present `null` is a producer bound while holding no paired record — the
    // registry's not-paired stand-in is built that way and genuinely emits status — while an absent
    // property is a producer that never went through a binding at all. Coalescing them here would
    // erase the distinction in the one place it becomes observable, so each keys its own slot.
    const live = createLiveWindow()
    const a = fakeWindow()
    const nullBound: StampedDaemonEvent = { type: 'failed', error: NOT_PAIRED, serverId: null }
    const unstamped: DaemonEvent = { type: 'connecting' }

    live.attach(a.win)
    emitDaemonEvent(live.sink, nullBound)
    emitDaemonEvent(live.sink, unstamped)
    emitDaemonEvent(live.sink, connectedA)
    a.send.mockClear()

    live.replayStatus()

    expect(a.send.mock.calls.map((call) => call[1])).toEqual([nullBound, unstamped, connectedA])
  })

  it('records a second server’s status that arrives while no window is live', () => {
    // The gap case (#519), now per server: the recorder still sits ABOVE #518's destroyed-window
    // guard, so a transition during the closed-window gap is recorded even though it is dropped —
    // and it must land in ITS OWN slot rather than erasing the server that was already there.
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()

    live.attach(a.win)
    emitDaemonEvent(live.sink, connectedA)
    a.destroy()
    emitDaemonEvent(live.sink, disconnectedB) // into the gap: dropped, but recorded
    live.attach(b.win)

    live.replayStatus()

    expect(b.send.mock.calls.map((call) => call[1])).toEqual([connectedA, disconnectedB])
  })

  it('does not open a slot for a stamped non-status event', () => {
    // The retention rule is unchanged by the widening: a stamped `messageReceived` must not mint a
    // slot for its server, or MessagePayload.text would be retained in main-process memory beyond
    // its delivery — the shape the #519 security review calls a MUST FIX.
    const live = createLiveWindow()
    const a = fakeWindow()
    const chatter: StampedDaemonEvent = {
      type: 'messageReceived',
      message: { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'secret' },
      serverId: 'srv-c'
    }

    live.attach(a.win)
    emitDaemonEvent(live.sink, connectedA)
    emitDaemonEvent(live.sink, chatter)
    a.send.mockClear()

    live.replayStatus()

    expect(a.send).toHaveBeenCalledTimes(1)
    expect(a.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, connectedA)
  })
})

// The window face is exercised through the REAL windowHasFocus / activateWindow, the way #518's AC4
// test composes the real emitDaemonEvent: that is what proves the face genuinely satisfies both
// FocusableWindow and ActivatableWindow at run time, rather than merely type-checking against them.
describe('createLiveWindow — window face (#519 AC3)', () => {
  it('reports itself destroyed when no window has ever been attached', () => {
    const live = createLiveWindow()
    expect(live.window.isDestroyed()).toBe(true)
  })

  it('reports itself live while a live window is attached, and destroyed once it is not', () => {
    const live = createLiveWindow()
    const a = fakeWindow()

    live.attach(a.win)
    expect(live.window.isDestroyed()).toBe(false)

    a.destroy()
    expect(live.window.isDestroyed()).toBe(true)
  })

  it('reports unfocused with no window, and delegates to the attached window when there is one', () => {
    const live = createLiveWindow()
    const a = fakeWindow()

    // "There is no window right now" is the truthful answer AC3's parenthetical asks for, and a
    // window that does not exist cannot hold focus — so the notification still fires.
    expect(windowHasFocus(live.window)).toBe(false)

    live.attach(a.win)
    a.setFocused(true)
    expect(windowHasFocus(live.window)).toBe(true)
    a.setFocused(false)
    expect(windowHasFocus(live.window)).toBe(false)
  })

  it('queries the new window for focus after a reopen, never the closed one', () => {
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()

    live.attach(a.win)
    a.destroy()
    live.attach(b.win)
    b.setFocused(true)

    expect(windowHasFocus(live.window)).toBe(true)
    expect(a.isFocused).not.toHaveBeenCalled()
  })

  it('activates the attached window, un-minimizing it first', () => {
    const live = createLiveWindow()
    const a = fakeWindow()
    a.setMinimized(true)

    live.attach(a.win)
    activateWindow(live.window)

    expect(a.restore).toHaveBeenCalledTimes(1)
    expect(a.show).toHaveBeenCalledTimes(1)
    expect(a.focus).toHaveBeenCalledTimes(1)
  })

  it('activates the reopened window on a notification click, never the closed one', () => {
    // The one live sequence #519 fixes for `notify`: a notification raised while the window was
    // open but unfocused, the window then closed, the notification clicked after a dock reopen.
    const live = createLiveWindow()
    const a = fakeWindow()
    const b = fakeWindow()

    live.attach(a.win)
    a.destroy()
    live.attach(b.win)

    activateWindow(live.window)

    expect(b.show).toHaveBeenCalledTimes(1)
    expect(b.focus).toHaveBeenCalledTimes(1)
    expect(a.isMinimized).not.toHaveBeenCalled()
    expect(a.show).not.toHaveBeenCalled()
    expect(a.focus).not.toHaveBeenCalled()
  })

  it('is a total no-op when activating with no live window', () => {
    const live = createLiveWindow()
    const a = fakeWindow()

    // Never attached: the click stays the no-op #518 made it (creating a window is out of scope).
    expect(() => activateWindow(live.window)).not.toThrow()

    // Attached then destroyed: same answer, via the same call-time query.
    live.attach(a.win)
    a.destroy()
    expect(() => activateWindow(live.window)).not.toThrow()
    expect(a.isMinimized).not.toHaveBeenCalled()
    expect(a.show).not.toHaveBeenCalled()
    expect(a.focus).not.toHaveBeenCalled()
  })
})
