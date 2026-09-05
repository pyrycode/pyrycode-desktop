import { describe, it, expect, vi } from 'vitest'
import { emitDaemonEvent, bindServerOrigin, type DaemonEventSink } from './emitDaemonEvent'
import {
  DAEMON_EVENT_CHANNEL,
  type DaemonEvent,
  type StampedDaemonEvent
} from '../shared/ipc/events'
import type { HelloAckPayload, MessagePayload } from '../shared/wire/types'

// A structural stand-in for a BrowserWindow: webContents.send, spied, plus the destroyed query
// (#518). `destroy()` flips it, modelling the window being closed mid-session. No Electron
// harness needed — the helper is typed against the minimal sink, not BrowserWindow.
function fakeSink(): DaemonEventSink & {
  webContents: { send: ReturnType<typeof vi.fn> }
  destroy(): void
} {
  let destroyed = false
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
    destroy(): void {
      destroyed = true
    }
  }
}

// A destroyed BrowserWindow as Electron really behaves (#518): `isDestroyed()` answers true and
// the `webContents` ACCESSOR itself throws — the property read is the throw, before `send` is
// ever reached. A throwing getter body satisfies the declared property type, so no cast is needed.
function destroyedSink(): DaemonEventSink {
  return {
    isDestroyed: () => true,
    get webContents(): { send(channel: string, event: DaemonEvent): void } {
      throw new Error('Object has been destroyed')
    }
  }
}

describe('emitDaemonEvent', () => {
  it('sends the event exactly once on the daemon-event channel', () => {
    const sink = fakeSink()
    const event: DaemonEvent = { type: 'connecting' }

    emitDaemonEvent(sink, event)

    expect(sink.webContents.send).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(sink.webContents.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, event)
  })

  it('forwards a payload-bearing event by reference, without transforming it', () => {
    const sink = fakeSink()
    const ack: HelloAckPayload = {
      protocol_version: 'v2',
      server_id: 'srv-1',
      conn_id: 'conn-1',
      capabilities: ['interactive']
    }
    const event: DaemonEvent = { type: 'connected', ack }

    emitDaemonEvent(sink, event)

    const [channel, forwarded] = sink.webContents.send.mock.calls[0]
    expect(channel).toBe(DAEMON_EVENT_CHANNEL)
    expect(forwarded).toBe(event) // same reference — pure forward, no clone/transform
  })

  it('forwards a complete-message batch unchanged', () => {
    const sink = fakeSink()
    const messages: MessagePayload[] = [
      { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi' },
      { conversation_id: 'c1', message_id: 'm2', role: 'assistant', text: 'there' }
    ]
    const event: DaemonEvent = { type: 'messagesReceived', messages }

    emitDaemonEvent(sink, event)

    expect(sink.webContents.send).toHaveBeenCalledTimes(1)
    expect(sink.webContents.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, event)
  })
})

describe('emitDaemonEvent — destroyed sink (#518)', () => {
  it('drops the event and returns normally when the sink reports itself destroyed', () => {
    const sink = fakeSink()
    sink.destroy()

    expect(() => emitDaemonEvent(sink, { type: 'connecting' })).not.toThrow()
    expect(sink.webContents.send).not.toHaveBeenCalled()
  })

  it('does not read webContents on a destroyed sink — the accessor itself throws', () => {
    // The ordering pin: a guard placed AFTER any `sink.webContents` read (a destructure, an early
    // alias) still throws here, because on a real destroyed BrowserWindow the property read is the
    // throw. This is the only assertion that catches that mistake.
    expect(() => emitDaemonEvent(destroyedSink(), { type: 'connecting' })).not.toThrow()
  })

  it('still sends exactly once on a live sink after another sink was destroyed', () => {
    // No behaviour change while a window is alive (AC5): the guard is a per-call query, so one
    // destroyed sink cannot mute a live one.
    const dead = fakeSink()
    dead.destroy()
    const live = fakeSink()
    const event: DaemonEvent = { type: 'connecting' }

    emitDaemonEvent(dead, event)
    emitDaemonEvent(live, event)

    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    expect(live.webContents.send).toHaveBeenCalledWith(DAEMON_EVENT_CHANNEL, event)
  })
})

/** What the target actually received, in order — the raw channel payloads, stamp included. */
function forwarded(sink: ReturnType<typeof fakeSink>): StampedDaemonEvent[] {
  return sink.webContents.send.mock.calls.map((call) => call[1] as StampedDaemonEvent)
}

describe('bindServerOrigin (#1068)', () => {
  it('stamps the bound id onto every event it forwards, leaving the original fields intact', () => {
    const target = fakeSink()
    const bound = bindServerOrigin(target, 'srv-a')
    const message: MessagePayload = {
      conversation_id: 'c1',
      message_id: 'm1',
      role: 'assistant',
      text: 'hi'
    }

    emitDaemonEvent(bound, { type: 'connecting' })
    emitDaemonEvent(bound, { type: 'messageReceived', message })

    expect(target.webContents.send).toHaveBeenCalledTimes(2)
    // Channel from the exported constant, as the unstamped path asserts — the wrapper re-supplies it.
    expect(target.webContents.send.mock.calls[0][0]).toBe(DAEMON_EVENT_CHANNEL)
    expect(forwarded(target)).toEqual([
      { type: 'connecting', serverId: 'srv-a' },
      { type: 'messageReceived', message, serverId: 'srv-a' }
    ])
  })

  it('stamps a null binding as a PRESENT null, never an absent property', () => {
    // The distinction the renderer reads: `null` is "no paired record was in hand", `undefined` would
    // mean an emitter that never went through a binding at all. The type promises `string | null`.
    const target = fakeSink()

    emitDaemonEvent(bindServerOrigin(target, null), { type: 'disconnected' })

    const [event] = forwarded(target)
    expect(event.serverId).toBeNull()
    expect('serverId' in event).toBe(true)
  })

  it('makes two bindings over one target distinguishable by the field alone (AC3)', () => {
    // The mechanism #1084 is written against, proven at the seam: same target, same event shape, two
    // origins. Only `serverId` separates them.
    const target = fakeSink()

    emitDaemonEvent(bindServerOrigin(target, 'srv-a'), { type: 'connecting' })
    emitDaemonEvent(bindServerOrigin(target, 'srv-b'), { type: 'connecting' })

    expect(forwarded(target)).toEqual([
      { type: 'connecting', serverId: 'srv-a' },
      { type: 'connecting', serverId: 'srv-b' }
    ])
  })

  it('does not mutate the event object the caller still holds', () => {
    const target = fakeSink()
    const event: DaemonEvent = { type: 'connecting' }

    emitDaemonEvent(bindServerOrigin(target, 'srv-a'), event)

    expect(event).toEqual({ type: 'connecting' })
    expect(forwarded(target)[0]).not.toBe(event)
  })

  it('drops the event when the target reports itself destroyed (#518 survives the extra hop)', () => {
    const target = fakeSink()
    target.destroy()

    expect(() => emitDaemonEvent(bindServerOrigin(target, 'srv-a'), { type: 'connecting' })).not.toThrow()
    expect(target.webContents.send).not.toHaveBeenCalled()
  })

  it('does not read webContents on a destroyed target', () => {
    // The ordering pin, restated one layer up: the wrapper must not alias or destructure the target's
    // `webContents` at bind time or above its own guard — on a real destroyed BrowserWindow that
    // property READ is the throw. Binding a destroyed target must itself be safe, too.
    const dead = destroyedSink()

    expect(() => emitDaemonEvent(bindServerOrigin(dead, 'srv-a'), { type: 'connecting' })).not.toThrow()
  })
})
