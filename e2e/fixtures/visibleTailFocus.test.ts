import { describe, expect, it, vi } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { focusVisibleTailWindow } from './visibleTailFocus'

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
  const window = { isVisible: () => visible, isFocused: () => focused, show, focus }
  const electron = { BrowserWindow: { getAllWindows: () => [window] } }
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
    expect(h.evaluations).toBe(6)
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
    expect(h.evaluations).toBe(6)
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
    const h = harness([loss, 'before', 'before', 'before'])
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Could not inspect visible-tail window')
    expect(h.evaluations).toBe(4)
    expect(h.show).toHaveBeenCalledTimes(loss === 'after' ? 1 : 0)
  })

  it('never uses an earlier mismatch to authorize resend after a final unavailable read', async () => {
    const h = harness(['before', undefined, undefined, 'before'])
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Could not inspect visible-tail window')
    expect(h.evaluations).toBe(4)
    expect(h.show).not.toHaveBeenCalled()
  })

  it('bounds recovery to two control attempts', async () => {
    const h = harness(['before', undefined, undefined, undefined, 'before'])
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Could not focus visible-tail window')
    expect(h.evaluations).toBe(8)
    expect(h.show).not.toHaveBeenCalled()
  })

  it('fails acknowledged mismatches without resending controls', async () => {
    const h = harness()
    h.focusEffect.mockImplementation(() => {})
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Visible-tail window is not visible and focused')
    expect(h.evaluations).toBe(4)
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
    const windows = h.electron.BrowserWindow.getAllWindows()
    let calls = 0
    h.electron.BrowserWindow.getAllWindows = () => calls++ < index ? windows : []
    await expect(focusVisibleTailWindow(h.app)).rejects.toThrow('Missing visible-tail window')
  })
})
