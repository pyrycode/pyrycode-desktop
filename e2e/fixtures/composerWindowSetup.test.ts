import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { configureComposerWindow } from './composerWindowSetup'

const target = { width: 1280, height: 800 }
const transient = () => new Error('electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.')
type Outcome = 'before' | 'after' | 'partial' | Error | string | undefined

// Execute the serialized callbacks against native state; never fake confirmation answers.
function harness(outcomes: Outcome[] = []) {
  let size = [1100, 700]
  let zoom = 1
  let evaluations = 0
  const setSize = vi.fn((width: number, height: number) => { size = [width, height] })
  const setZoomFactor = vi.fn((factor: number) => { zoom = factor })
  const window = { getSize: () => size, setSize, getContentSize: () => [size[0], size[1] - 28],
    webContents: { getZoomFactor: () => zoom, setZoomFactor } }
  const electron = { BrowserWindow: { getAllWindows: () => [window] } }
  const callbacks: Array<() => Promise<unknown>> = []
  const app = { evaluate: async (callback: (electron: any, arg: any) => unknown, arg: unknown) => {
    callbacks.push(async () => callback(electron, arg))
    const outcome = outcomes[evaluations++]
    if (outcome === 'before') throw transient()
    if (outcome instanceof Error || typeof outcome === 'string' && !['after', 'partial'].includes(outcome)) throw outcome
    if (outcome === 'partial') {
      setSize(target.width, target.height)
      throw transient()
    }
    const value = await callback(electron, arg)
    if (outcome === 'after') throw transient()
    return value
  } } as Pick<ElectronApplication, 'evaluate'>
  return { app, electron, callbacks, setSize, setZoomFactor, get evaluations() { return evaluations } }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function configure(app: Pick<ElectronApplication, 'evaluate'>) {
  const pending = configureComposerWindow(app, target, 1.25)
  void pending.catch(() => {}) // Rejection assertions attach after draining the fake inspection timers.
  await vi.runAllTimersAsync()
  return pending
}

describe('configureComposerWindow', () => {
  it('confirms outer size and zoom and returns actual content size', async () => {
    const h = harness()
    expect(await configure(h.app)).toEqual([1280, 772])
    expect(h.setSize).toHaveBeenCalledTimes(1)
    expect(h.setZoomFactor).toHaveBeenCalledTimes(1)
    expect(h.evaluations).toBe(2)
    await configure(h.app)
    expect(h.setSize).toHaveBeenCalledTimes(1)
    expect(h.setZoomFactor).toHaveBeenCalledTimes(1)
  })

  it('resends only after confirmed absence when loss precedes the effect', async () => {
    const h = harness(['before'])
    await configure(h.app)
    expect(h.evaluations).toBe(6)
    expect(h.setSize).toHaveBeenCalledTimes(1)
    expect(h.setZoomFactor).toHaveBeenCalledTimes(1)
    await h.callbacks[0]() // A delayed original callback must not repeat either setter.
    expect(h.setSize).toHaveBeenCalledTimes(1)
    expect(h.setZoomFactor).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'control acknowledgement', outcomes: ['after'] },
    { label: 'read only', outcomes: [undefined, 'before'] },
    { label: 'control and one read', outcomes: ['after', 'before'] },
    { label: 'control and two reads', outcomes: ['after', 'before', 'before'] }
  ] satisfies Array<{ label: string; outcomes: Outcome[] }>)(
    'does not replay applied changes after loss of $label', async ({ outcomes }) => {
      const h = harness(outcomes)
      await configure(h.app)
      expect(h.setSize).toHaveBeenCalledTimes(1)
      expect(h.setZoomFactor).toHaveBeenCalledTimes(1)
      expect(h.evaluations).toBe(outcomes.length + 1)
    })

  it('resends only the unapplied field after partial execution', async () => {
    const h = harness(['partial'])
    await configure(h.app)
    expect(h.setSize).toHaveBeenCalledTimes(1)
    expect(h.setZoomFactor).toHaveBeenCalledTimes(1)
  })

  it.each(['before', 'after'])('fails permanent inspection loss after loss %s the effect', async loss => {
    const h = harness([loss, 'before', 'before', 'before'])
    await expect(configure(h.app)).rejects.toThrow('Could not inspect composer window')
    expect(h.evaluations).toBe(4)
    expect(h.setSize).toHaveBeenCalledTimes(loss === 'after' ? 1 : 0)
  })

  it('does not use an earlier mismatch to authorize resend after inconclusive final inspection', async () => {
    const h = harness(['before', undefined, undefined, 'before'])
    await expect(configure(h.app)).rejects.toThrow('Could not inspect composer window')
    expect(h.evaluations).toBe(4)
    expect(h.setSize).not.toHaveBeenCalled()
  })

  it('bounds control recovery to two attempts', async () => {
    const h = harness(['before', undefined, undefined, undefined, 'before'])
    await expect(configure(h.app)).rejects.toThrow('Could not configure composer window')
    expect(h.evaluations).toBe(8)
    expect(h.setSize).not.toHaveBeenCalled()
  })

  it('fails an acknowledged but unapplied change without resending', async () => {
    const h = harness()
    h.setSize.mockImplementation(() => {})
    await expect(configure(h.app)).rejects.toThrow('Composer window state did not match')
    expect(h.setSize).toHaveBeenCalledTimes(1)
    expect(h.evaluations).toBe(4)
  })

  it.each([0, 1])('preserves unrelated errors at control/inspection evaluation %s', async index => {
    const fatal = new Error('Target page, context or browser has been closed')
    const h = harness(index === 0 ? [fatal] : ['after', fatal])
    await expect(configure(h.app)).rejects.toBe(fatal)
    expect(h.evaluations).toBe(index + 1)
  })

  it.each([0, 1])('preserves non-Error throws at evaluation %s', async index => {
    const h = harness(index === 0 ? ['fatal'] : ['after', 'fatal'])
    await expect(configure(h.app)).rejects.toBe('fatal')
    expect(h.evaluations).toBe(index + 1)
  })

  it('fails if the native window is missing', async () => {
    const h = harness()
    h.electron.BrowserWindow.getAllWindows = () => []
    await expect(configure(h.app)).rejects.toThrow('Missing composer window')
  })
})
