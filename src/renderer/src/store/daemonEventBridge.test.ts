import { describe, it, expect } from 'vitest'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import { createSessionStore } from './sessionStore'
import { translateDaemonEvent } from './daemonEventBridge'

// Fixtures — plain wire-shaped data, mirroring sessionStore.test.ts. No transport involved.
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

const wireErr: ErrorPayload = {
  code: 'unauthorized',
  message: 'pairing token rejected',
  retryable: false
}

function msg(message_id: string, role: MessagePayload['role'] = 'assistant'): MessagePayload {
  return { conversation_id: 'conv-1', message_id, role, text: `text ${message_id}` }
}

describe('translateDaemonEvent — each variant dispatched into a fresh store', () => {
  it('connecting → status connecting', () => {
    const store = createSessionStore()
    store.getState().dispatch(translateDaemonEvent({ type: 'connecting' }))
    expect(store.getState().status).toEqual({ type: 'connecting' })
  })

  it('connected → status connected carrying the ack by reference', () => {
    const store = createSessionStore()
    store.getState().dispatch(translateDaemonEvent({ type: 'connected', ack }))
    const status = store.getState().status
    expect(status).toEqual({ type: 'connected', ack })
    if (status.type === 'connected') {
      expect(status.ack).toBe(ack)
    }
  })

  it('disconnected → status disconnected', () => {
    const store = createSessionStore()
    store.getState().dispatch(translateDaemonEvent({ type: 'disconnected' }))
    expect(store.getState().status).toEqual({ type: 'disconnected' })
  })

  it('failed → status error copying the wire ErrorPayload into a fresh ConnectionError', () => {
    const store = createSessionStore()
    store.getState().dispatch(translateDaemonEvent({ type: 'failed', error: wireErr }))
    const status = store.getState().status
    expect(status).toEqual({
      type: 'error',
      error: { code: 'unauthorized', message: 'pairing token rejected', retryable: false }
    })
    // The conversion is a field-by-field copy, not a pass-through of the wire object.
    if (status.type === 'error') {
      expect(status.error).not.toBe(wireErr)
    }
  })

  it('messageReceived → appends the message by reference', () => {
    const store = createSessionStore()
    const message = msg('m1')
    store.getState().dispatch(translateDaemonEvent({ type: 'messageReceived', message }))
    expect(store.getState().messages).toHaveLength(1)
    expect(store.getState().messages[0]).toBe(message)
  })

  it('messagesReceived → appends the batch in order', () => {
    const store = createSessionStore()
    const batch = [msg('m1'), msg('m2'), msg('m3')]
    store.getState().dispatch(translateDaemonEvent({ type: 'messagesReceived', messages: batch }))
    expect(store.getState().messages.map((m) => m.message_id)).toEqual(['m1', 'm2', 'm3'])
  })
})
