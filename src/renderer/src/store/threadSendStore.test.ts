import { describe, expect, it, vi } from 'vitest'
import { createThreadSendStore } from './threadSendStore'
import type { ThreadSnapshot } from './threadItemStore'
import { submitMessage } from '../screens/conversation/composerSend'

const row = (id = 100, status = 'queued', device_id: unknown = 'device', message_id: unknown = 'm') => ({
  id, rev: id, kind: 'user_message', shown: status !== 'dropped', active: status === 'queued', status,
  content: { device_id, message_id, text: 'daemon truth', queued_msg_id: 7 }
})
const snapshot = (items = [row()], hostId = 'host', conversationId = 'chat'): ThreadSnapshot => ({
  hostId, conversationId, epoch: 'epoch', items, version: 100, checkpoint: 100, ranges: [], repair: null
})
function setup() {
  const store = createThreadSendStore()
  const deps = { serverId: 'host', threadSend: { store, deviceId: 'device' },
    newMessageId: () => 'm', sendCommand: vi.fn(), dispatch: vi.fn(), dispatchFor: vi.fn() }
  const send = (text = 'local text', chat = 'chat', deviceId: string | null = 'device') =>
    submitMessage(text, chat, { ...deps, threadSend: { store, deviceId } })
  return { store, deps, send, state: () => store.getState().select('host', 'chat') }
}

describe('scoped daemon send settlement', () => {
  it('retains multiple sends across scopes and captures each supplied device identity', () => {
    const { store, deps, send, state } = setup()
    send(); send('second', 'chat', 'device-2'); send('other', 'other-chat')
    expect(state().pending.map(p => p.deviceId)).toEqual(['device', 'device-2'])
    store.getState().settle(snapshot())
    expect(state().pending.map(p => p.deviceId)).toEqual(['device-2'])
    expect(store.getState().select('host', 'other-chat').pending).toHaveLength(1)
    expect(deps.dispatch).not.toHaveBeenCalled(); expect(deps.dispatchFor).not.toHaveBeenCalled()
  })

  it('requires both usable identities in the exact scope, never text or message id alone', () => {
    const { store, send, state } = setup(); send()
    for (const s of [snapshot([row()], 'peer-host'), snapshot([row()], 'host', 'peer-chat'),
      snapshot([row(1, 'queued', 'peer')]), snapshot([row(1, 'queued', '')]),
      snapshot([row(1, 'queued', null)]), snapshot([row(1, 'queued', 'device', '')])]) {
      store.getState().settle(s); expect(state().pending).toHaveLength(1)
    }
    for (const marker of ['truncated_fields', 'dropped_fields']) {
      const r = row(); r.content = { ...r.content, [marker]: ['device_id'] }
      store.getState().settle(snapshot([r])); expect(state().pending).toHaveLength(1)
      store.getState().settle(snapshot([{ ...row(), [marker]: ['content.message_id'] }]))
      expect(state().pending).toHaveLength(1)
    }
    store.getState().settle(snapshot()); expect(state().pending).toHaveLength(0)
  })

  it.each(['delivered', 'dropped', 'lost'])('settles a first catch-up observation already %s', status => {
    const { store, send, state } = setup(); send()
    store.getState().settle(snapshot([row(100, status)]))
    expect(state().pending).toHaveLength(0); expect(state().localSendPending).toBeNull()
  })

  it('settles repeated snapshots once, transitions queued feedback and ignores later transport feedback', () => {
    const { store, send, state } = setup(); send()
    expect(state().localSendPending).toEqual({ messageId: 'm', queued: false })
    store.getState().settle(snapshot())
    expect(state().localSendPending).toEqual({ messageId: 'm', queued: true })
    const settled = state()
    store.getState().settle(snapshot()); expect(state()).toBe(settled)
    store.getState().feedback('host', 'chat', { type: 'messageDelivery', messageId: 'm', status: 'not-sent' })
    expect(state()).toBe(settled)
    store.getState().settle(snapshot([row(100, 'lost')]))
    expect(state().localSendPending).toBeNull(); expect(state().pending).toHaveLength(0)
  })

  it('cannot settle when trusted sender identity was unavailable at submission', () => {
    const { store, send, state } = setup(); send('local', 'chat', null)
    store.getState().settle(snapshot()); expect(state().pending).toHaveLength(1)
  })

  it('follows an accepted item after identity fields become unavailable and fences epoch reuse', () => {
    const { store, send, state } = setup(); send(); store.getState().settle(snapshot())
    store.getState().settle(snapshot([{ ...row(100, 'lost'), content: { ...row().content, device_id: null, message_id: null } }]))
    expect(state().localSendPending).toBeNull()
    store.getState().settle({ ...snapshot([row(100, 'queued', 'peer')]), epoch: 'new-epoch' })
    expect(state().localSendPending).toBeNull(); expect(state().pending).toHaveLength(0)
  })

  it('settles older pending sends without changing the newest feedback', () => {
    const { store, deps, send, state } = setup(); send()
    submitMessage('newest', 'chat', { ...deps, newMessageId: () => 'new' })
    store.getState().settle(snapshot([row(100, 'delivered')]))
    expect(state().pending.map(p => p.messageId)).toEqual(['new'])
    expect(state().localSendPending).toEqual({ messageId: 'new', queued: false })
    store.getState().settle(snapshot([row(100, 'delivered'), row(101, 'queued', 'device', 'new')]))
    expect(state().pending).toHaveLength(0)
    expect(state().localSendPending).toEqual({ messageId: 'new', queued: true })
  })

  it('preserves rollback and local feedback, while synchronous acceptance wins over a bridge exception', () => {
    const { store, deps, state } = setup()
    const rollback = vi.fn(), attachments = [{ attachmentId: 'file', filename: 'local.pdf' }]
    const fail = () => { throw new Error('bridge') }
    expect(submitMessage('draft', 'chat', { ...deps, sendCommand: fail,
      takeAttachments: () => ({ attachments, rollback }) })).toBe(false)
    expect(rollback).toHaveBeenCalledOnce(); expect(state().pending[0].delivery).toBe('not-sent')
    expect(state().pending[0].item.attachments).toEqual(attachments)
    expect(state().localSendPending).toBeNull()
    store.getState().feedback('host', 'chat', { type: 'messageDelivery', messageId: 'm', status: 'waiting' })
    expect(state().pending[0].delivery).toBe('waiting')
    expect(submitMessage('draft', 'chat', { ...deps, newMessageId: () => 'm2', sendCommand: () => {
      store.getState().settle(snapshot([row(101, 'delivered', 'device', 'm2')])); fail()
    } })).toBe(false)
    expect(state().pending).toHaveLength(1); expect(state().localSendPending).toBeNull()
  })

  it('retires one scope, a host and the owner without leaking rows on reopen', () => {
    const { store, send, state } = setup(); send(); send('other', 'other')
    store.getState().deleteConversation('host', 'chat'); expect(state().pending).toHaveLength(0)
    expect(store.getState().select('host', 'other').pending).toHaveLength(1)
    store.getState().removeHost('host'); expect(store.getState().select('host', 'other').pending).toHaveLength(0)
    send(); store.getState().dispose(); send(); expect(state().pending).toHaveLength(0)
  })
})
