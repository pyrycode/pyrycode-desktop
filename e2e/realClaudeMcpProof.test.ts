import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import type { DaemonEvent } from '../src/shared/ipc/events'
import { mcpOutcome, readCreatedChat, readMcp, watchMcp } from './realClaudeMcpProof'

// Execute the actual page observer and snapshot callbacks with a controlled IPC publisher.
function controlledPage() {
  const listeners = new Set<(event: DaemonEvent) => void>()
  vi.stubGlobal('window', { pyry: { onDaemonEvent: (listener: (event: DaemonEvent) => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  } } })
  const page = { evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg) } as unknown as Page
  return { page, emit: (event: DaemonEvent) => listeners.forEach(listener => listener(event)), listeners }
}

const report = (conversationId: string, status = 'connected'): DaemonEvent => ({
  type: 'mcpStatus', conversationId, droppedServers: 0,
  servers: [{ name: 'pyry_files', status, error: '', scope: '', version: '' }]
})
const reconnectRefusal = (conversationId: string): DaemonEvent => ({
  type: 'mcpReconnectRejected', conversationId
})
const toggleRefusal = (conversationId: string): DaemonEvent => ({
  type: 'mcpToggleRejected', conversationId
})

const target = 'created-chat'
const foreign = 'another-chat'
afterEach(() => vi.unstubAllGlobals())

describe('the live MCP proof conversation evidence', () => {
  it('ignores foreign reports and refusals before baselines and during sheet-open waits', async () => {
    const { page, emit } = controlledPage()
    await watchMcp(page)
    emit(report(foreign))
    emit(reconnectRefusal(foreign))
    emit(toggleRefusal(foreign))
    emit(report(target))
    const before = await readMcp(page, target)
    expect(before.reports).toEqual([target])
    expect(before.refusals).toEqual([])
    expect(before.toggleRefusals).toEqual([])
    emit(report(foreign, 'disabled'))
    expect((await readMcp(page, target)).reports.length > before.reports.length).toBe(false)
    emit(report(target))
    expect((await readMcp(page, target)).reports.length > before.reports.length).toBe(true)
  })

  it('keeps toggle status aligned with target reports despite interleaved foreign reports', async () => {
    const { page, emit } = controlledPage()
    await watchMcp(page)
    emit(report(foreign, 'foreign-before'))
    emit(report(target))
    const beforeToggle = await readMcp(page, target)
    emit(report(foreign, 'foreign-during'))
    emit(report(target, 'disabled'))
    emit(report(foreign, 'foreign-after'))
    const answered = await readMcp(page, target)
    expect(answered.targetStatus[beforeToggle.reports.length]).toBe('disabled')
    expect(answered.reports.every(id => id === target)).toBe(true)
  })

  it('takes identity from UI creation rather than the latest MCP publication and unsubscribes', async () => {
    const { page, emit, listeners } = controlledPage()
    const stopWatching = await watchMcp(page)
    emit(report(foreign))
    expect(await readCreatedChat(page)).toBeNull()
    emit({ type: 'conversationCreated', conversation: { id: target } } as DaemonEvent)
    emit(report(foreign))
    emit({ type: 'conversationCreated', conversation: { id: foreign } } as DaemonEvent)
    expect(await readCreatedChat(page)).toBe(target)
    expect((await readMcp(page, target)).reports).toEqual([])
    await stopWatching()
    expect(listeners.size).toBe(0)
    emit(report(target))
    expect((await readMcp(page, target)).reports).toEqual([])
  })

  it.each([
    ['reconnect', 'report'], ['reconnect', 'refused'],
    ['toggle', 'report'], ['toggle', 'refused']
  ] as const)('only fresh target evidence settles the %s wait with %s', async (action, outcome) => {
    const { page, emit } = controlledPage()
    await watchMcp(page)
    // Foreign and historical target refusals precede the action baseline.
    emit(report(target))
    emit(reconnectRefusal(target))
    emit(toggleRefusal(target))
    emit(report(foreign))
    emit(reconnectRefusal(foreign))
    emit(toggleRefusal(foreign))
    const before = await readMcp(page, target)
    expect(mcpOutcome(await readMcp(page, target), before, action)).toBe('waiting')
    for (const event of [report(foreign), reconnectRefusal(foreign), toggleRefusal(foreign)]) {
      emit(event)
      const now = await readMcp(page, target)
      expect(now).toEqual(before)
      expect(mcpOutcome(now, before, action)).toBe('waiting')
    }
    // A refusal for the other target action also cannot settle this wait.
    emit(action === 'reconnect' ? toggleRefusal(target) : reconnectRefusal(target))
    expect(mcpOutcome(await readMcp(page, target), before, action)).toBe('waiting')
    emit(outcome === 'report' ? report(target, 'disabled')
      : action === 'reconnect' ? reconnectRefusal(target) : toggleRefusal(target))
    emit(report(foreign, 'foreign-trailing-status'))
    emit(reconnectRefusal(foreign))
    emit(toggleRefusal(foreign))
    const now = await readMcp(page, target)
    expect(mcpOutcome(now, before, action)).toBe(outcome)
    if (outcome === 'report') expect(now.targetStatus[before.reports.length]).toBe('disabled')
  })

  it.each(['reconnect', 'toggle'] as const)('retains the ambiguous target %s outcome as a failure', async action => {
    const { page, emit } = controlledPage()
    await watchMcp(page)
    const before = await readMcp(page, target)
    emit(report(target))
    emit(action === 'reconnect' ? reconnectRefusal(target) : toggleRefusal(target))
    expect(mcpOutcome(await readMcp(page, target), before, action)).toBe('both')
  })

})
