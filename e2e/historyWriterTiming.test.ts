import { describe, expect, it } from 'vitest'
import { writerWorkloadDuration } from './historyWriterTiming'

describe('native writer completion clock', () => {
  it('accepts an on-time flush even when the runner observes it after the deadline', () => {
    const evidence = { admittedAt: 1200, completedAt: 61200, observedAt: 65000 }
    expect(writerWorkloadDuration(evidence)).toBe(60000)
  })

  it('rejects actual completion beyond 60 seconds', () => {
    expect(() => writerWorkloadDuration({ admittedAt: 1200, completedAt: 61200.01 }))
      .toThrow('overdue')
  })

  it.each([
    { admittedAt: null, completedAt: null },
    { admittedAt: 0, completedAt: null },
    { admittedAt: 100, completedAt: 99 },
    { admittedAt: NaN, completedAt: 100 },
    { admittedAt: 0, completedAt: Infinity }
  ])('rejects missing or invalid completion: %j', evidence => {
    expect(() => writerWorkloadDuration(evidence)).toThrow('missing or invalid')
  })
})
