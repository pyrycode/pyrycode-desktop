import { expect, it, vi } from 'vitest'
import { createRunSettingsWriteStore } from './runSettingsWriteStore'
import { subscribeRefusalRecovery } from './runSettingsWriteBridge'

it('forwards only new model selections for the open conversation and detaches on teardown', () => {
  const writes = createRunSettingsWriteStore(), selected = vi.fn()
  const dispatch = writes.getState().dispatch
  let open: string | null = 'a'
  dispatch({ type: 'changeDispatched', changeId: 'prior', change: { field: 'model', value: 'old' } })
  const off = subscribeRefusalRecovery(writes, () => open, selected)
  expect(selected).not.toHaveBeenCalled()
  dispatch({ type: 'changeDispatched', changeId: 'effort', change: { field: 'effort', value: 'high' } })
  dispatch({ type: 'changeDispatched', changeId: 'one', change: { field: 'model', value: 'new' } })
  dispatch({ type: 'settingsRejected', changeId: 'one' })
  open = 'b'
  dispatch({ type: 'changeDispatched', changeId: 'two', change: { field: 'model', value: 'other' } })
  open = null
  dispatch({ type: 'changeDispatched', changeId: 'closed', change: { field: 'model', value: 'none' } })
  off(); open = 'a'
  dispatch({ type: 'changeDispatched', changeId: 'after', change: { field: 'model', value: 'none' } })
  expect(selected.mock.calls).toEqual([['a', 'one'], ['b', 'two']])
})
