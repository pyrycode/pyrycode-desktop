import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadItem, ThreadReply, ThreadUpdate } from '../../../shared/wire/thread'
import { createThreadItemStore } from './threadItemStore'
import { createThreadQueryCoordinator, type ThreadQueryState } from './threadQueryCoordinator'
import type { RendererCommand } from '../../../shared/ipc/commands'

const item = (id = 10, rev = 10, order = id): ThreadItem => ({ id, rev, order,
  kind: 'assistant_message', status: 'running', active: true, shown: true, summary: 'held', content: { text: String(rev) } })
function setup(onComplete?: (host: string, conversation: string, epoch: string, version: number) => void) {
  const store = createThreadItemStore(), commands: Extract<RendererCommand, { type: 'queryThread' }>[] = []
  const states: { host: string; conversation: string; state: ThreadQueryState }[] = []
  let id = 0
  const coordinator = createThreadQueryCoordinator({ store, requestId: () => `q${++id}`,
    sendCommand: command => commands.push(command), onComplete,
    onState: (host, conversation, state) => states.push({ host, conversation, state }) })
  const sync = (conversationId: string | null = 'c', connected = true, restorePending = false, serverId = 'h') =>
    coordinator.input({ type: 'sync', serverId, conversationId, connected, restorePending })
  const reply = (request: number, value: ThreadReply, serverId = commands[request].serverId, conversationId = value.payload.conversation_id) =>
    coordinator.input({ type: 'daemon', event: { type: 'threadReply', serverId, conversationId,
      requestId: commands[request].requestId, reply: value, correlation: { id: 1, ts: '1970-01-01T00:00:00Z', in_reply_to: 1 } } })
  const batch = (request = 0, items = [item()], version = 20, epoch = 'e') => reply(request,
    { type: 'thread_items', payload: { conversation_id: commands[request].query.payload.conversation_id, epoch, version, items, final: false } })
  const window = (request = 0, lower = 10, upper = 21, older = true, version = 20, epoch = 'e') => reply(request,
    { type: 'thread_items', payload: { conversation_id: commands[request].query.payload.conversation_id, epoch, version,
      items: [], final: true, lower_order: lower, upper_order: upper, continuation: lower, older_exists: older } })
  const complete = (request: number, from: number, version: number) => reply(request,
    { type: 'thread_items', payload: { conversation_id: 'c', epoch: 'e', version, items: [], final: true, from_version: from } })
  const live = (update: ThreadUpdate, serverId = 'h') => coordinator.input({ type: 'daemon', event: {
    type: 'threadUpdate', serverId, conversationId: update.payload.conversation_id, update, correlation: { id: 2, ts: '1970-01-01T00:00:00Z' } } })
  const older = (serverId = 'h') => coordinator.input({ type: 'older', serverId })
  const retry = () => coordinator.input({ type: 'retry', serverId: 'h' })
  const snapshot = () => store.getState().snapshot('h', 'c')
  return { store, coordinator, commands, states, sync, reply, batch, window, complete, live, older, retry, snapshot }
}
afterEach(() => vi.useRealTimers())

describe('supplied thread query coordination', () => {
  it.each(['host', 'conversation', 'request', 'incomplete', 'projection'])(
    'keeps the outstanding slot after %s terminal receipt', mismatch => {
      const f = setup(); f.sync()
      f.coordinator.observeTerminal({ type: 'threadReply', serverId: mismatch === 'host' ? 'other' : 'h',
        conversationId: mismatch === 'conversation' ? 'other' : 'c', correlation: { id: 1, ts: '' },
        requestId: mismatch === 'request' ? 'other' : f.commands[0].requestId,
        reply: { type: 'thread_items', payload: { conversation_id: 'c', epoch: 'e', version: 20,
          ...(mismatch === 'incomplete' ? { items: [], final: false } : { items: [], final: true,
            lower_order: 0, upper_order: 21, continuation: 0, older_exists: false }),
          ...(mismatch === 'projection' ? { projection: 'compact-v1' as const } : {}) } } })
      f.sync('next'); expect(f.commands).toHaveLength(1)
      f.window(); expect(f.commands).toHaveLength(2)
      expect(f.snapshot()).toBeNull()
      f.coordinator.dispose()
    })

  it('notifies completed progress once after publishing a coherent live batch, and never certifies repair', () => {
    const completed = vi.fn(), f = setup(completed)
    f.sync(); f.batch(); f.window(); completed.mockClear()
    const published = vi.fn(); f.store.subscribe(published)
    f.coordinator.batch(() => {
      for (let id = 21; id <= 40; id++) f.live({ type: 'thread_item_added', payload: {
        conversation_id: 'c', epoch: 'e', version: id, item: item(id, 1) } })
      expect(completed).not.toHaveBeenCalled()
      expect(published).not.toHaveBeenCalled()
    })
    expect(completed).toHaveBeenCalledOnce()
    expect(completed).toHaveBeenCalledWith('h', 'c', 'e', 40)
    expect(published).toHaveBeenCalledOnce()
    f.coordinator.batch(() => {
      f.live({ type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e', version: 50,
        item_id: 999, base_rev: 1, rev: 2, text: 'missing' } })
    })
    expect(completed).toHaveBeenCalledOnce()
    expect(f.snapshot()?.repair).not.toBeNull()
    f.coordinator.dispose()
  })

  it('defers restore and uses the saved checkpoint on reopening', () => {
    const f = setup(), s = f.store.getState()
    f.sync('c', false); expect(f.commands).toHaveLength(0)
    f.sync('c', true, true); expect(f.commands).toHaveLength(0)
    const read = s.beginLocalRead('h', 'c')!
    read.complete({ hostId: 'h', conversationId: 'c', epoch: 'e', version: 99, checkpoint: 20,
      uncommittedVersion: 99, items: [item()], ranges: [{ start: 10, end: 21 }], repair: null })
    f.sync(); f.sync()
    expect(f.commands).toHaveLength(1)
    expect(f.commands[0].query).toEqual({ type: 'thread_catch_up', payload: { conversation_id: 'c', epoch: 'e', version: 20 } })
    f.complete(0, 20, 99); f.sync(null); f.sync()
    expect(f.commands[1].query.payload).toMatchObject({ epoch: 'e', version: 99 })
    f.coordinator.dispose()
  })

  it('certifies an empty reply only at its success marker', () => {
    const f = setup(); f.sync()
    expect(f.commands[0].query.payload).toEqual({ conversation_id: 'c', epoch: '', version: 0 })
    f.batch(0, [], 50)
    expect(f.snapshot()?.checkpoint).toBe(0)
    f.window(0, 0, 51, false, 50)
    expect(f.snapshot()).toMatchObject({ checkpoint: 50, ranges: [{ start: 0, end: 51 }], olderAvailable: false })
    f.older(); expect(f.commands).toHaveLength(1)
    expect(f.states.at(-1)?.state).toEqual({ type: 'idle' })
    f.coordinator.dispose()
  })

  it('retains incomplete facts on disconnect and rejects late completion', () => {
    const f = setup(); f.sync(); f.batch(); f.sync('c', false)
    expect(f.snapshot()).toMatchObject({ checkpoint: 0, version: 20, items: [item()] })
    expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'disconnected', retryable: true })
    f.window(); expect(f.snapshot()?.checkpoint).toBe(0)
    f.sync(); expect(f.commands).toHaveLength(2)
    f.window(); expect(f.snapshot()?.checkpoint).toBe(0)
    f.window(1); expect(f.snapshot()?.checkpoint).toBe(20)
    f.coordinator.dispose()
  })

  it('serializes navigation on one host and isolates other hosts', () => {
    const f = setup(); f.sync(); f.sync('other'); f.sync('discarded', true, true); f.sync('last')
    f.sync('c', true, false, 'other-host')
    expect(f.commands.map(c => c.serverId)).toEqual(['h', 'other-host'])
    f.batch(); expect(f.snapshot()).toBeNull()
    f.window(); expect(f.commands).toHaveLength(3)
    expect(f.commands[2].query.payload.conversation_id).toBe('last')
    f.window(1, 0, 21, false)
    expect(f.store.getState().snapshot('other-host', 'c')?.checkpoint).toBe(20)
    expect(f.snapshot()).toBeNull()
    f.coordinator.dispose()
  })

  it('repairs from the checkpoint despite newer live facts', () => {
    const f = setup(); f.sync(); f.batch(); f.window()
    f.live({ type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e', version: 30,
      item_id: 10, base_rev: 9, rev: 30, text: 'missing' } })
    expect(f.commands[1].query.payload).toMatchObject({ version: 20 })
    f.live({ type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 100, item: item(10, 100) } })
    f.batch(1, [item(10, 40)], 40)
    expect(f.snapshot()?.items[0].rev).toBe(100)
    expect(f.snapshot()?.checkpoint).toBe(20)
    f.complete(1, 20, 40)
    expect(f.snapshot()).toMatchObject({ version: 100, checkpoint: 40, repair: null })
    f.sync(null); f.sync(); expect(f.commands[2].query.payload).toMatchObject({ version: 40 })
    f.coordinator.dispose()
  })

  it('resets only the affected scope and bounds automatic recovery', () => {
    const f = setup(); f.sync(); f.batch(); f.window()
    f.store.getState().acceptEpoch('h', 'neighbor', 'e')
    const neighbor = f.store.getState().snapshot('h', 'neighbor')
    f.sync(null); f.sync()
    const reset: ThreadReply = { type: 'thread_reset', payload: { conversation_id: 'c', epoch: 'e', version: 999 } }
    f.reply(1, reset)
    expect(f.snapshot()).toMatchObject({ items: [], checkpoint: 0, version: 0, ranges: [], repair: null })
    expect(f.store.getState().hosts.get('h')?.get('c')?.owned).toMatchObject({ acceptEpoch: true, resetId: expect.any(String) })
    expect(f.store.getState().snapshot('h', 'neighbor')).toBe(neighbor)
    expect(f.commands[2].query.payload).toEqual({ conversation_id: 'c', epoch: 'e', version: 0 })
    f.reply(1, reset); expect(f.commands).toHaveLength(3)
    f.reply(2, reset); expect(f.commands).toHaveLength(3)
    expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'recovery' })
    f.older(); expect(f.commands).toHaveLength(3)
    f.retry(); expect(f.commands[3].query.type).toBe('thread_catch_up')
    f.window(3, 0, 5, false, 4); expect(f.snapshot()?.checkpoint).toBe(4)
    f.coordinator.dispose()
  })

  it('rejects generation replacement and disposed replies', () => {
    const f = setup(); f.sync(); f.batch()
    f.store.getState().deleteConversation('h', 'c'); f.store.getState().acceptEpoch('h', 'c', 'e')
    f.window(); expect(f.snapshot()?.checkpoint).toBe(0)
    expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'generation' })
    f.retry(); f.coordinator.dispose(); f.batch(1); f.window(1); f.sync()
    expect(f.snapshot()?.items).toEqual([]); expect(f.commands).toHaveLength(2)
  })

  it('pages certified continuity without parent or disjoint-range inference', () => {
    const f = setup(); f.sync(); f.older(); f.older(); expect(f.commands).toHaveLength(1)
    f.batch(0, [item(1, 1, 1), item(10)], 20); f.window(0, 10, 21)
    expect(f.commands[1].query).toEqual({ type: 'thread_page', payload: { conversation_id: 'c', before_order: 10 } })
    f.older(); f.older(); expect(f.commands).toHaveLength(2)
    f.batch(1, [item(2, 2, 2), item(9)], 20); f.window(1, 8, 10)
    expect(f.snapshot()?.ranges).toEqual([{ start: 8, end: 21 }])
    f.older(); expect(f.commands[2].query.payload).toMatchObject({ before_order: 8 })
    f.window(2, 0, 8, false); f.older(); expect(f.commands).toHaveLength(3)
    expect(f.snapshot()?.ranges).toEqual([{ start: 0, end: 21 }])
    f.coordinator.dispose()

    const g = setup(), s = g.store.getState(); s.acceptEpoch('h', 'c', 'e')
    s.beginBatch('h', 'c', 'e')!.commit({ fromVersion: 0, version: 20,
      ranges: [{ start: 2, end: 4 }, { start: 10, end: 21 }], olderAvailable: true })
    g.sync(); g.complete(0, 20, 20); g.older()
    expect(g.commands[1].query.payload).toMatchObject({ before_order: 10 })
    g.window(1, 8, 9)
    expect(g.snapshot()?.ranges).toEqual([{ start: 2, end: 4 }, { start: 10, end: 21 }])
    expect(g.states.at(-1)?.state).toMatchObject({ type: 'failed' })
    g.coordinator.dispose()
  })

  it('renews the idle deadline and retries transport failure', () => {
    vi.useFakeTimers(); const f = setup(); f.sync()
    vi.advanceTimersByTime(29000); f.batch()
    vi.advanceTimersByTime(29000); expect(f.states.at(-1)?.state.type).toBe('loading')
    vi.advanceTimersByTime(1000); expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'timeout' })
    expect(f.snapshot()?.checkpoint).toBe(0)
    f.retry(); expect(f.commands).toHaveLength(2)
    f.window(); expect(f.snapshot()?.checkpoint).toBe(0)
    f.coordinator.input({ type: 'daemon', event: { type: 'threadQueryFailed', serverId: 'h', conversationId: 'c',
      requestId: f.commands[1].requestId, inReplyTo: 2, reason: 'daemon-error' } })
    expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'daemon-error' })
    f.retry(); f.window(2); expect(vi.getTimerCount()).toBe(0)
    f.coordinator.dispose()
  })

  it('does not let pages substitute for newly required recovery', () => {
    const f = setup(); f.sync(); f.batch(); f.window(); f.older()
    f.coordinator.input({ type: 'daemon', event: { type: 'threadRepairNeeded', serverId: 'h', conversationId: 'c', reason: 'expired' } })
    f.window(1, 0, 10, false)
    expect(f.snapshot()?.checkpoint).toBe(20)
    expect(f.snapshot()?.ranges).toEqual([{ start: 10, end: 21 }])
    expect(f.commands[2].query.type).toBe('thread_catch_up')
    f.coordinator.dispose()
  })

  it('correlates host conversation and request before admitting an epoch', () => {
    const f = setup(); f.sync()
    const marker: ThreadReply = { type: 'thread_items', payload: { conversation_id: 'c', epoch: 'e', version: 20,
      items: [], final: true, lower_order: 10, upper_order: 21, continuation: 10, older_exists: true } }
    f.reply(0, marker, 'wrong'); f.reply(0, marker, 'h', 'wrong')
    expect(f.snapshot()).toBeNull()
    f.window(); expect(f.snapshot()?.checkpoint).toBe(20)
    f.coordinator.dispose()
  })

  it('settles sender exceptions and synchronous terminal delivery', () => {
    vi.useFakeTimers()
    const states: ThreadQueryState[] = [], store = createThreadItemStore()
    let throws = true, count = 0
    const c = createThreadQueryCoordinator({ store, requestId: () => String(++count),
      onState: (_host, _id, state) => states.push(state), sendCommand: command => {
        if (throws) throw new Error('transport')
        c.input({ type: 'daemon', event: { type: 'threadReply', serverId: command.serverId, conversationId: 'c',
          requestId: command.requestId, correlation: { id: 1, ts: '1970-01-01T00:00:00Z' }, reply: { type: 'thread_items', payload: {
            conversation_id: 'c', epoch: 'e', version: 0, final: true, items: [],
            lower_order: 0, upper_order: 0, continuation: 0, older_exists: false } } } })
      } })
    c.input({ type: 'sync', serverId: 'h', conversationId: 'c', connected: true })
    expect(states.at(-1)).toMatchObject({ type: 'failed', reason: 'send-failed' })
    expect(vi.getTimerCount()).toBe(0)
    throws = false; c.input({ type: 'retry', serverId: 'h' })
    expect(store.getState().snapshot('h', 'c')?.ranges).toEqual([{ start: 0, end: 0 }])
    expect(states.at(-1)).toEqual({ type: 'idle' }); expect(vi.getTimerCount()).toBe(0)
    c.dispose()
  })

  it('releases host cleanup without letting reused coordinates complete a successor', () => {
    vi.useFakeTimers(); const f = setup(); f.sync(); f.batch()
    f.coordinator.cancelHost('h'); f.coordinator.cancelHost('h')
    expect(vi.getTimerCount()).toBe(0)
    f.sync(); f.window(); expect(f.snapshot()?.checkpoint).toBe(0)
    f.window(1); expect(f.snapshot()?.checkpoint).toBe(20)
    f.coordinator.dispose(); expect(vi.getTimerCount()).toBe(0)
  })

  it('stops failed application recovery until explicit retry', () => {
    const f = setup(); f.sync(); f.batch(); f.window(); f.sync(null); f.sync()
    f.batch(1, [{ ...item(), kind: 'notice' }], 30); f.complete(1, 20, 30)
    expect(f.commands[2].query.payload).toMatchObject({ version: 20 })
    f.batch(2, [{ ...item(), kind: 'notice' }], 40); f.complete(2, 20, 40)
    expect(f.commands).toHaveLength(3)
    expect(f.snapshot()?.checkpoint).toBe(20)
    expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'recovery' })
    f.live({ type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 100, item: item(10, 100) } })
    f.older(); expect(f.commands).toHaveLength(3)
    f.retry(); f.batch(3, [item(10, 110)], 110); f.complete(3, 20, 110)
    expect(f.snapshot()).toMatchObject({ checkpoint: 110, repair: null })
    f.coordinator.dispose()
  })

  it('does not dispatch demand cancelled by a synchronous presentation callback', () => {
    vi.useFakeTimers(); const commands: RendererCommand[] = []
    const c = createThreadQueryCoordinator({ store: createThreadItemStore(), requestId: () => 'q',
      sendCommand: command => commands.push(command), onState: (_host, _id, state) => {
        if (state.type === 'loading') c.input({ type: 'sync', serverId: 'h', conversationId: null, connected: true })
      } })
    c.input({ type: 'sync', serverId: 'h', conversationId: 'c', connected: true })
    expect(commands).toEqual([]); expect(vi.getTimerCount()).toBe(0)
    c.dispose()
  })

  it.each(['epoch', 'host', 'global'])('rejects %s replacement before initial admission', mode => {
    const f = setup(), s = f.store.getState(); s.acceptEpoch('h', 'c', 'e'); f.sync()
    if (mode === 'epoch') { s.acceptEpoch('h', 'c', 'other'); s.acceptEpoch('h', 'c', 'e') }
    else { if (mode === 'host') s.removeHost('h'); else s.clearAll(); s.acceptEpoch('h', 'c', 'e') }
    f.batch(); f.window()
    expect(f.snapshot()).toMatchObject({ items: [], checkpoint: 0 })
    expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'generation' })
    f.coordinator.dispose()
  })

  it('keeps off-screen repair scoped without creating off-screen demand', () => {
    const f = setup(); f.sync(); f.window()
    f.store.getState().acceptEpoch('h', 'off-screen', 'e')
    f.live({ type: 'thread_text_append', payload: { conversation_id: 'off-screen', epoch: 'e', version: 30,
      item_id: 10, base_rev: 10, rev: 30, text: 'missing' } })
    expect(f.commands).toHaveLength(1)
    expect(f.store.getState().snapshot('h', 'off-screen')?.repair).toMatchObject({ throughVersion: 30 })
    f.sync('c', false); f.sync()
    expect(f.commands[1].query.payload.conversation_id).toBe('c')
    f.coordinator.dispose()
  })

  it('holds an invalidated unfinished slot through explicit retry', () => {
    const f = setup(); f.sync(); f.batch()
    f.store.getState().deleteConversation('h', 'c'); f.store.getState().acceptEpoch('h', 'c', 'e')
    f.batch(); expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'generation' })
    f.retry(); expect(f.commands).toHaveLength(1)
    f.window(); expect(f.commands).toHaveLength(2)
    expect(f.snapshot()?.checkpoint).toBe(0)
    f.window(1); expect(f.snapshot()?.checkpoint).toBe(20)
    f.coordinator.dispose()
  })

  it('exposes retry when reopening cannot complete a retained repair', () => {
    const f = setup(), s = f.store.getState(); s.acceptEpoch('h', 'c', 'e')
    s.beginBatch('h', 'c', 'e')!.commit({ fromVersion: 0, version: 20, ranges: [] })
    s.requireRepair('h', 'c', 'e', 100)
    f.sync(); f.complete(0, 20, 40)
    expect(f.commands).toHaveLength(1)
    expect(f.states.at(-1)?.state).toMatchObject({ type: 'failed', reason: 'recovery' })
    expect(f.snapshot()?.checkpoint).toBe(20)
    f.retry(); f.complete(1, 20, 100)
    expect(f.snapshot()).toMatchObject({ checkpoint: 100, repair: null })
    f.coordinator.dispose()
  })

  it('requests a fresh newest window when a repair query resets', () => {
    const f = setup(); f.sync(); f.batch(); f.window()
    f.live({ type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e', version: 30,
      item_id: 10, base_rev: 9, rev: 30, text: 'missing' } })
    f.reply(1, { type: 'thread_reset', payload: { conversation_id: 'c', epoch: 'new', version: 500 } })
    expect(f.commands[2].query.payload).toEqual({ conversation_id: 'c', epoch: 'new', version: 0 })
    expect(f.snapshot()?.checkpoint).toBe(0)
    f.window(2, 0, 51, false, 50, 'new')
    expect(f.snapshot()).toMatchObject({ epoch: 'new', checkpoint: 50, repair: null })
    f.coordinator.dispose()
  })
})
