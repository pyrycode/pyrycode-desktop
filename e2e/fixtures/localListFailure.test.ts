import { afterEach, describe, expect, it } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { installUnreadableLocalList } from './localListFailure'

const transient = () => new Error('electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.')
type Outcome = 'before' | 'after' | Error | string | undefined
const marker = '__localListFailureHandler'

// Execute the real serialized callbacks against IPC registration, not mocked confirmation answers.
function harness(outcomes: Outcome[] = []) {
  const original = () => ({ status: 'ok' })
  const handlers = new Map<string, Function>([['pyry:chat-history', original]])
  let replacements = 0
  let evaluations = 0
  const callbacks: Array<(electron: any) => unknown> = []
  const electron = { ipcMain: {
    _invokeHandlers: handlers,
    removeHandler: (channel: string) => { handlers.delete(channel) },
    handle: (channel: string, handler: Function) => { replacements++; handlers.set(channel, handler) }
  } }
  const app = { evaluate: async (callback: (electron: any) => unknown) => {
    callbacks.push(callback)
    const outcome = outcomes[evaluations++]
    if (outcome === 'before') throw transient()
    if (outcome instanceof Error || typeof outcome === 'string' && outcome !== 'after') throw outcome
    const value = await callback(electron)
    if (outcome === 'after') throw transient()
    return value
  } } as Pick<ElectronApplication, 'evaluate'>
  return { app, handlers, original, electron, callbacks,
    get replacements() { return replacements }, get evaluations() { return evaluations } }
}

afterEach(() => { delete (globalThis as any)[marker] })

describe('installUnreadableLocalList', () => {
  it('confirms the registered wrapper and preserves all non-list operations', async () => {
    const h = harness()
    expect(await installUnreadableLocalList(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 1, contextLosses: 0 })
    expect(h.replacements).toBe(1)
    const handler = h.handlers.get('pyry:chat-history')!
    expect(handler({}, { operation: 'readList' })).toEqual({ status: 'error', code: 'unreadable' })
    expect(handler({}, { operation: 'replaceList' })).toEqual(h.original())
  })

  it('confirms absence before resending a mutation lost before its effect', async () => {
    const h = harness(['before'])
    expect(await installUnreadableLocalList(h.app)).toEqual({ installationAttempts: 2, inspectionAttempts: 2, contextLosses: 1 })
    expect(h.replacements).toBe(1)
    expect(h.evaluations).toBe(4)
  })

  it('does not resend when acknowledgement is lost after the mutation took effect', async () => {
    const h = harness(['after'])
    expect(await installUnreadableLocalList(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 1, contextLosses: 1 })
    expect(h.replacements).toBe(1)
    expect(h.evaluations).toBe(2)
  })

  it('retries an inconclusive inspection without replaying the mutation', async () => {
    const h = harness(['after', 'before'])
    expect(await installUnreadableLocalList(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 2, contextLosses: 2 })
    expect(h.replacements).toBe(1)
  })

  it('fails after two mutations with confirmed absence', async () => {
    const h = harness(['before', undefined, 'before'])
    await expect(installUnreadableLocalList(h.app)).rejects.toThrow('Could not install unreadable local-list handler')
    expect(h.replacements).toBe(0)
    expect(h.evaluations).toBe(4)
  })

  it.each(['before', 'after'] as const)('fails permanent inspection loss after a mutation lost %s its effect', async loss => {
    const h = harness([loss, 'before', 'before', 'before'])
    await expect(installUnreadableLocalList(h.app)).rejects.toThrow('Could not inspect unreadable local-list handler')
    expect(h.replacements).toBe(loss === 'after' ? 1 : 0)
    expect(h.evaluations).toBe(4)
  })

  it('guards a late original callback against replacing the installed wrapper twice', async () => {
    const h = harness(['before'])
    await installUnreadableLocalList(h.app)
    await h.callbacks[0](h.electron)
    expect(h.replacements).toBe(1)
  })

  it.each([0, 1])('preserves a fatal error at evaluation %s unchanged', async index => {
    const fatal = new Error('Target page, context or browser has been closed')
    const h = harness(index === 0 ? [fatal] : ['after', fatal])
    await expect(installUnreadableLocalList(h.app)).rejects.toBe(fatal)
    expect(h.evaluations).toBe(index + 1)
  })

  it('preserves a non-Error installation failure', async () => {
    const h = harness(['fatal'])
    await expect(installUnreadableLocalList(h.app)).rejects.toBe('fatal')
    expect(h.evaluations).toBe(1)
  })

  it('fails if the original handler is missing', async () => {
    const h = harness()
    h.handlers.clear()
    await expect(installUnreadableLocalList(h.app)).rejects.toThrow('Missing chat history handler')
    expect(h.replacements).toBe(0)
  })

  it('fails if a marker no longer identifies the registered handler', async () => {
    const h = harness()
    await installUnreadableLocalList(h.app)
    h.handlers.set('pyry:chat-history', h.original)
    await expect(installUnreadableLocalList(h.app)).rejects.toThrow('Local-list failure handler changed')
    expect(h.replacements).toBe(1)
  })
})
