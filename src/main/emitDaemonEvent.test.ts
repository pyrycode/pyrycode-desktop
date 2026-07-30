import { describe, it, expect, vi } from 'vitest'
import { emitDaemonEvent, type DaemonEventSink } from './emitDaemonEvent'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'
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
