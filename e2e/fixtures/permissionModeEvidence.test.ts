import { expect, it } from 'vitest'
import type { DaemonEvent } from '../../src/shared/ipc/events'
import { installPermissionModeEvidence } from './permissionModeEvidence'

it('counts two distinct completed turns while ignoring the same completion in a reconnect snapshot', () => {
  let observe: (event: DaemonEvent) => void = () => {}
  const target = { pyry: { onDaemonEvent: (listener: typeof observe) => { observe = listener; return () => {} } },
    permissionProof: undefined as undefined | { turns: string[] } }
  Object.assign(globalThis, { window: target })
  try {
    installPermissionModeEvidence()
    const item = { id: 21, rev: 21, kind: 'turn_end', content: { stop_reason: 'end_turn' } }
    observe({ type: 'threadUpdate', serverId: 'host', conversationId: 'chat', update: { type: 'thread_item_added',
      payload: { conversation_id: 'chat', epoch: 'epoch', version: 22, item } } } as DaemonEvent)
    observe({ type: 'threadReply', serverId: 'host', conversationId: 'chat', reply: { type: 'thread_items',
      payload: { conversation_id: 'chat', epoch: 'epoch', version: 22, items: [item] } } } as DaemonEvent)
    expect(target.permissionProof!.turns).toEqual(['chat'])
    observe({ type: 'threadUpdate', serverId: 'host', conversationId: 'chat', update: { type: 'thread_item_added',
      payload: { conversation_id: 'chat', epoch: 'epoch', version: 40, item: { ...item, id: 40 } } } } as DaemonEvent)
    expect(target.permissionProof!.turns).toEqual(['chat', 'chat'])
  } finally { Reflect.deleteProperty(globalThis, 'window') }
})
