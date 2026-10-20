import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { focusVisibleTailWindow as confirmFocus } from './visibleTailFocus'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
async function focusVisibleTailWindow(app: Pick<ElectronApplication, 'evaluate'>) {
  const pending = confirmFocus(app).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
  await vi.runAllTimersAsync()
  const result = await pending
  if (!result.ok) throw result.error
}

const transient = () => new Error('electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.')
type Outcome = 'before' | 'after' | 'partial' | 'late' | Error | string | undefined

// Run the serialized setup and inspection callbacks against native state.
function harness(outcomes: Outcome[] = []) {
  let visible = false, focused = false, evaluations = 0, partial = false
  const show = vi.fn(() => { visible = true })
  const focusEffect = vi.fn(() => { focused = true })
  const focus = vi.fn(() => {
    if (partial) { partial = false; throw transient() }
    focusEffect()
  })
  const window = { isVisible: () => visible, isFocused: () => focused, isDestroyed: () => false, show, focus }
  const electron = { app: {}, BrowserWindow: { getAllWindows: () => [window] } }
  const callbacks: Array<() => unknown> = []
  const app = { evaluate: async (callback: (electron: any) => unknown) => {
    callbacks.push(() => callback(electron))
    const outcome = outcomes[evaluations++]
    if (outcome === 'before') throw transient()
    if (outcome instanceof Error || typeof outcome === 'string' && !['after', 'partial', 'late'].includes(outcome)) throw outcome
    if (outcome === 'late') callbacks[0]()
    partial = outcome === 'partial'
    const value = callback(electron)
    if (outcome === 'after') throw transient()
    return value
  } } as Pick<ElectronApplication, 'evaluate'>
  return { app, electron, callbacks, show, focus, focusEffect, get evaluations() { return evaluations } }
}

describe('focusVisibleTailWindow', () => {
  it('waits for acknowledged native focus without replaying the control', async () => {
    const h = harness()
    const apply = h.focusEffect.getMockImplementation()!
    h.focusEffect.mockImplementation(() => { setTimeout(apply, 250) })
    await focusVisibleTailWindow(h.app)
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focus).toHaveBeenCalledTimes(1)
    expect(h.electron.BrowserWindow.getAllWindows()[0].isFocused()).toBe(true)
  })

  it('confirms the captured native window even when the window list changes', async () => {
    const h = harness()
    const original = h.electron.BrowserWindow.getAllWindows()[0]
    const apply = h.focusEffect.getMockImplementation()!
    h.focusEffect.mockImplementation(() => {
      h.electron.BrowserWindow.getAllWindows = () => [{ ...original, isFocused: () => true }]
      setTimeout(apply, 250)
    })
    await focusVisibleTailWindow(h.app)
    expect(original.isFocused()).toBe(true)
    expect(h.focus).toHaveBeenCalledTimes(1)
  })

  it('confirms visibility and focus; repeated setup leaves completed fields alone', async () => {
    const h = harness()
    await focusVisibleTailWindow(h.app)
    expect(h.evaluations).toBe(2)
    await focusVisibleTailWindow(h.app)
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
    // Replaying an inspection can never show or focus the window.
    h.callbacks[1]()
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
  })

  it('confirms absence before resending after loss before effects', async () => {
    const h = harness(['before'])
    await focusVisibleTailWindow(h.app)
    expect(h.evaluations).toBe(24)
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
    h.callbacks[0]() // The late original callback cannot repeat completed fields.
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'control acknowledgement', outcomes: ['after'] },
    { label: 'one inspection', outcomes: [undefined, 'before'] },
    { label: 'control and one inspection', outcomes: ['after', 'before'] },
    { label: 'control and two inspections', outcomes: ['after', 'before', 'before'] }
  ] satisfies Array<{ label: string; outcomes: Outcome[] }>)(
    'confirms applied effects without replay after losing $label', async ({ outcomes }) => {
      const h = harness(outcomes)
      await focusVisibleTailWindow(h.app)
      expect(h.evaluations).toBe(outcomes.length + 1)
      expect(h.show).toHaveBeenCalledTimes(1)
      expect(h.focusEffect).toHaveBeenCalledTimes(1)
    })

  it('recovers partial execution without showing twice', async () => {
    const h = harness(['partial'])
    await focusVisibleTailWindow(h.app)
    expect(h.evaluations).toBe(24)
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focus).toHaveBeenCalledTimes(2)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
    h.callbacks[0]()
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
  })

  it('recognizes late execution during confirmation without resending', async () => {
    const h = harness(['before', undefined, undefined, 'late'])
    await focusVisibleTailWindow(h.app)
    expect(h.evaluations).toBe(4)
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
  })

  it.each(['before', 'after'])('fails unavailable confirmation after loss %s effects', async loss => {
    const h = harness([loss, ...Array<Outcome>(21).fill('before')])
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Could not inspect visible-tail window')
    expect(h.evaluations).toBe(22)
    expect(h.show).toHaveBeenCalledTimes(loss === 'after' ? 1 : 0)
  })

  it('never uses an earlier mismatch to authorize resend after a final unavailable read', async () => {
    const h = harness(['before', ...Array<Outcome>(20).fill(undefined), 'before'])
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Could not inspect visible-tail window')
    expect(h.evaluations).toBe(22)
    expect(h.show).not.toHaveBeenCalled()
  })

  it('bounds recovery to two control attempts', async () => {
    const h = harness(['before', ...Array<Outcome>(21).fill(undefined), 'before'])
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Could not focus visible-tail window')
    expect(h.evaluations).toBe(44)
    expect(h.show).not.toHaveBeenCalled()
  })

  it('fails acknowledged mismatches without resending controls', async () => {
    const h = harness()
    h.focusEffect.mockImplementation(() => {})
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Visible-tail window is not visible and focused')
    expect(h.evaluations).toBe(22)
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.focusEffect).toHaveBeenCalledTimes(1)
  })

  it.each([0, 1])('preserves unrelated errors at control/inspection evaluation %s', async index => {
    const fatal = new Error('Target page, context or browser has been closed')
    const h = harness(index === 0 ? [fatal] : ['after', fatal])
    await expect(focusVisibleTailWindow(h.app)).rejects.toBe(fatal)
    expect(h.evaluations).toBe(index + 1)
  })

  it.each([0, 1])('preserves non-Error throws at evaluation %s', async index => {
    const h = harness(index === 0 ? ['fatal'] : ['after', 'fatal'])
    await expect(focusVisibleTailWindow(h.app)).rejects.toBe('fatal')
    expect(h.evaluations).toBe(index + 1)
  })

  it.each([0, 1])('fails a missing native window at control/inspection %s', async index => {
    const h = harness()
    if (index === 0) h.electron.BrowserWindow.getAllWindows = () => []
    else {
      let calls = 0
      h.electron.BrowserWindow.getAllWindows()[0].isDestroyed = () => calls++ > 0
    }
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Missing visible-tail window')
  })
})
