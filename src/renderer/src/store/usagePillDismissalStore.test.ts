import { describe, it, expect } from 'vitest'
import { createUsagePillDismissalStore } from './usagePillDismissalStore'

describe('usagePillDismissalStore (#1604)', () => {
  it('starts with nothing dismissed', () => {
    expect(createUsagePillDismissalStore().getState().dismissed).toBeNull()
  })

  it('remembers exactly the dismissed triple, as its own copy', () => {
    const store = createUsagePillDismissalStore()
    const reading = { status: 'allowed_warning', limitType: 'seven_day', resetsAt: 42 }
    store.getState().dismiss(reading)
    expect(store.getState().dismissed).toEqual(reading)
    expect(store.getState().dismissed).not.toBe(reading)
  })

  it('replaces the remembered triple on a later dismissal', () => {
    const store = createUsagePillDismissalStore()
    store.getState().dismiss({ status: 'allowed_warning', limitType: 'seven_day', resetsAt: 1 })
    store.getState().dismiss({ status: 'allowed_warning', limitType: 'five_hour', resetsAt: 2 })
    expect(store.getState().dismissed).toEqual({ status: 'allowed_warning', limitType: 'five_hour', resetsAt: 2 })
  })
})
