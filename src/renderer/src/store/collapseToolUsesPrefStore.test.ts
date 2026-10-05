import { describe, expect, it } from 'vitest'
import {
  COLLAPSE_TOOL_USES_KEY,
  createCollapseToolUsesPrefStore,
  decodeCollapseToolUsesPref,
  localStorageCollapseToolUsesPref,
  selectCollapseToolUses
} from './collapseToolUsesPrefStore'

function fakeStorage(raw: string | null = null) {
  return {
    read: () => decodeCollapseToolUsesPref(raw),
    write: (value: boolean) => { raw = String(value) },
    stored: () => raw
  }
}

describe('collapse tool uses preference', () => {
  it.each([null, '', 'maybe', 'TRUE', '0', 'null'])('defaults missing or corrupt %s to on', (raw) => {
    expect(decodeCollapseToolUsesPref(raw)).toBeNull()
    expect(selectCollapseToolUses(createCollapseToolUsesPrefStore(fakeStorage(raw)).getState())).toBe(true)
  })

  it.each([true, false])('hydrates exact stored %s without replacing false with the default', (value) => {
    expect(decodeCollapseToolUsesPref(String(value))).toBe(value)
    expect(createCollapseToolUsesPrefStore(fakeStorage(String(value))).getState().collapseToolUses).toBe(value)
  })

  it('persists off and on and restores each into a fresh store', () => {
    const storage = fakeStorage()
    const store = createCollapseToolUsesPrefStore(storage)
    for (const value of [false, true]) {
      store.getState().setCollapseToolUses(value)
      expect(storage.stored()).toBe(String(value))
      expect(selectCollapseToolUses(store.getState())).toBe(value)
      expect(createCollapseToolUsesPrefStore(storage).getState().collapseToolUses).toBe(value)
    }
  })

  it('notifies readers after persistence and unsubscribes cleanly', () => {
    const storage = fakeStorage()
    const store = createCollapseToolUsesPrefStore(storage)
    const values: boolean[] = []
    const unsubscribe = store.subscribe((state) => {
      expect(storage.stored()).toBe(String(state.collapseToolUses))
      values.push(selectCollapseToolUses(state))
    })
    store.getState().setCollapseToolUses(false)
    unsubscribe()
    store.getState().setCollapseToolUses(true)
    expect(values).toEqual([false])
  })

  it('uses its own key and is safe to import without window', () => {
    expect(COLLAPSE_TOOL_USES_KEY).toBe('pyry.collapseAssistantToolUses')
    const storage = localStorageCollapseToolUsesPref()
    expect(storage.read()).toBeNull()
    expect(() => storage.write(false)).not.toThrow()
  })
})
