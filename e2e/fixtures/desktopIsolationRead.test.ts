import { expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { readDesktopIsolation } from './desktopIsolation'

it('reads actual isolation after a lost inspector promise without accepting the failed read', async () => {
  const state = { switchesApplied: [], windows: 0, visibleWindows: 0 }
  const evaluate = vi.fn()
    .mockRejectedValueOnce(new Error('electronApplication.evaluate: Execution context was destroyed'))
    .mockResolvedValueOnce(state)
  expect(await readDesktopIsolation({ evaluate } as unknown as ElectronApplication)).toBe(state)
  expect(evaluate).toHaveBeenCalledTimes(2)
  expect(evaluate.mock.calls[1]).toEqual(evaluate.mock.calls[0])
})

it('fails immediately for a closed app rather than retrying a fatal inspection error', async () => {
  const error = new Error('Target page, context or browser has been closed')
  const evaluate = vi.fn().mockRejectedValue(error)
  await expect(readDesktopIsolation({ evaluate } as unknown as ElectronApplication)).rejects.toBe(error)
  expect(evaluate).toHaveBeenCalledTimes(1)
})
