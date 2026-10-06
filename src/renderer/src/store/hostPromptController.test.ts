import { describe, it, expect, vi } from 'vitest'
import { createHostPromptController } from './hostPromptController'
import type { StampedDaemonEvent } from '@shared/ipc/events'

function setup() {
  const send = vi.fn(), close = vi.fn()
  let n = 0
  const c = createHostPromptController('b', send, close, () => `attempt-${++n}`)
  c.open()
  const receive = (overrides: Partial<StampedDaemonEvent> = {}) => c.receive({
    type: 'hostSystemPromptReceived', serverId: 'b', requestId: 'attempt-1', operation: 'read',
    systemPrompt: '', defaultSystemPrompt: ' default\n', ...overrides
  } as StampedDaemonEvent)
  return { c, send, close, receive }
}

describe('host prompt interaction controller', () => {
  it('reads once, accepts empty, ignores wrong host and duplicate replies', () => {
    const { c, send, receive } = setup()
    receive({ serverId: 'a' }); expect(c.store.getState().type).toBe('reading')
    receive(); c.edit('draft'); receive({ systemPrompt: 'duplicate' })
    expect(c.store.getState()).toMatchObject({ type: 'ready', original: '', draft: 'draft' })
    expect(send).toHaveBeenCalledOnce()
    c.reset(); expect(c.store.getState()).toMatchObject({ draft: ' default\n' })
    expect(send).toHaveBeenCalledOnce()
    c.dispose(); receive(); expect(c.store.getState()).toMatchObject({ draft: ' default\n' })
  })
  it('locks across name save, waits for durable result and preserves failed draft for retry', async () => {
    const { c, send, close, receive } = setup()
    receive(); c.edit('  text\n')
    let finish!: (ok: boolean) => void
    const name = vi.fn(() => new Promise<boolean>(r => { finish = r }))
    const pending = c.save(name)
    c.edit('race'); c.reset(); void c.save(name)
    expect(name).toHaveBeenCalledOnce()
    finish(true); await pending
    expect(send).toHaveBeenLastCalledWith({ type: 'setHostSystemPrompt', serverId: 'b', requestId: 'attempt-2', payload: { system_prompt: '  text\n' } })
    expect(close).not.toHaveBeenCalled()
    c.receive({ type: 'hostSystemPromptFailed', serverId: 'b', requestId: 'attempt-2', operation: 'write' })
    expect(c.store.getState()).toMatchObject({ type: 'ready', draft: '  text\n', saveFailed: true })
    await c.save(async () => true)
    receive({ requestId: 'attempt-3', operation: 'write', systemPrompt: '  text\n' })
    expect(close).toHaveBeenCalledOnce()
  })
  it('disconnection and disposal invalidate name continuations and all late outcomes', async () => {
    const { c, send, close, receive } = setup()
    receive(); c.edit('changed')
    let finish!: (ok: boolean) => void
    const pending = c.save(() => new Promise(r => { finish = r }))
    c.connectionLost(); finish(true); await pending
    expect(send).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled()
    expect(c.store.getState()).toMatchObject({ type: 'ready', saveFailed: true })
    c.dispose(); await c.save(async () => true)
    expect(send).toHaveBeenCalledOnce()
  })
  it('only changed successfully read drafts write, including empty and inclusive multibyte bytes', async () => {
    const unread = setup(); await unread.c.save(async () => true)
    expect(unread.send).toHaveBeenCalledOnce(); expect(unread.close).toHaveBeenCalledOnce()
    const { c, send, receive } = setup(); receive({ systemPrompt: 'old' }); c.edit('')
    await c.save(async () => true)
    expect(send.mock.calls.at(-1)?.[0].payload).toEqual({ system_prompt: '' })
    const over = setup(); over.receive(); over.c.edit('é'.repeat(4097))
    const name = vi.fn(async () => true); await over.c.save(name); expect(name).not.toHaveBeenCalled()
    over.c.edit('é'.repeat(4096)); await over.c.save(name); expect(name).toHaveBeenCalledOnce()
  })
})

describe('host prompt read during local name save', () => {
  it('retains a read that arrives while a name write fails', async () => {
    const { c, receive } = setup()
    let finish!: (ok: boolean) => void
    const pending = c.save(() => new Promise(r => { finish = r }))
    receive({ systemPrompt: 'arrived during name save' })
    finish(false); await pending
    expect(c.store.getState()).toMatchObject({ type: 'ready', draft: 'arrived during name save' })
  })
})
