import { expect, it } from 'vitest'
import type { DaemonEvent } from '../../src/shared/ipc/events'
import { installTurnCompletionEvidence } from './turnCompletionEvidence'

it('counts only distinct successful top-level completions across reconnect snapshots', () => {
  let observe: (event: DaemonEvent) => void = () => {}
  const target = { pyry: { onDaemonEvent: (listener: typeof observe) => { observe = listener; return () => {} } },
    turnCompletionEvidence: undefined as undefined | { count: () => number } }
  Object.assign(globalThis, { window: target })
  try {
    installTurnCompletionEvidence()
    const item = { id: 21, rev: 21, kind: 'turn_end', content: { stop_reason: 'end_turn' } }
    const emit = (items: unknown[], epoch = 'epoch') => observe({ type: 'threadReply', serverId: 'host',
      conversationId: 'chat', reply: { type: 'thread_items', payload: { conversation_id: 'chat', epoch,
        version: 21, items } } } as DaemonEvent)
    emit([{ ...item, parent: 1 }, { ...item, content: { stop_reason: 'cancelled' } },
      { ...item, content: { stop_reason: 'end_turn', is_error: true } }])
    expect(target.turnCompletionEvidence!.count()).toBe(0)
    emit([item]); emit([item])
    expect(target.turnCompletionEvidence!.count()).toBe(1)
    emit([item], 'new-epoch')
    expect(target.turnCompletionEvidence!.count()).toBe(2)
  } finally { Reflect.deleteProperty(globalThis, 'window') }
})
