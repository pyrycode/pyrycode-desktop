import { expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { EventEmitter } from 'node:events'
import { installHistoryQueryEvidence } from './historyQueryEvidence'

it.each(['acknowledged', 'lost after execution', 'lost before execution'] as const)('retains one listener and all observations when installation is %s', async fate => {
  const ipcMain = new EventEmitter()
  let calls = 0
  const evaluate = vi.fn(async (read: Function, kind: string) => {
    const first = calls++ === 0
    const result = first && fate === 'lost before execution' ? undefined : read({ ipcMain }, kind)
    if (first && fate !== 'acknowledged') throw new Error('Execution context was destroyed')
    return result
  })
  try {
    const app = { evaluate } as unknown as ElectronApplication
    await installHistoryQueryEvidence(app, 'resume')
    ipcMain.emit('pyry:command', {}, { type: 'queryThread', query: { type: 'thread_catch_up', payload: { version: 7 } } })
    await installHistoryQueryEvidence(app, 'resume')
    expect(ipcMain.listenerCount('pyry:command')).toBe(1)
    expect((globalThis as any).__threadHistoryAsks).toEqual([{ type: 'thread_catch_up', version: 7 }])
    if (fate === 'lost after execution') expect(evaluate.mock.calls.length).toBe(4)
  } finally {
    delete (globalThis as any).__threadHistoryEvidence
    delete (globalThis as any).__threadHistoryAsks
  }
})

it('does not retry an unrelated installation failure', async () => {
  const error = new Error('app closed')
  const evaluate = vi.fn().mockRejectedValue(error)
  await expect(installHistoryQueryEvidence({ evaluate } as unknown as ElectronApplication, 'page')).rejects.toBe(error)
  expect(evaluate).toHaveBeenCalledOnce()
})
