import { describe, it, expect, vi } from 'vitest'
import { emitDaemonEvent, type DaemonEventSink } from './emitDaemonEvent'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../shared/ipc/events'
import type { HelloAckPayload, MessagePayload } from '../shared/wire/types'

// A structural stand-in for a BrowserWindow: only webContents.send, spied. No Electron
// harness needed — the helper is typed against the minimal sink, not BrowserWindow.
function fakeSink(): DaemonEventSink & { webContents: { send: ReturnType<typeof vi.fn> } } {
  return { webContents: { send: vi.fn() } }
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
