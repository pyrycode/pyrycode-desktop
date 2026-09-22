import { describe, expect, it } from 'vitest'
import type { ThreadItem } from '../../store/threadTimeline'
import { formatSessionCost, latestSessionCostUsd } from './sessionCost'

const boundary = (turnId: string, costUsdTotal?: number): ThreadItem =>
  ({ kind: 'turnBoundary', turnId, stopReason: 'end_turn', costUsdTotal })

describe('latestSessionCostUsd', () => {
  it('takes the latest running total rather than summing the turns', () => {
    expect(latestSessionCostUsd([boundary('t1', 0.1), boundary('t2', 0.42)])).toBe(0.42)
  })

  it('keeps the earlier total when a later turn reports none or a non-positive value', () => {
    for (const later of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(latestSessionCostUsd([boundary('t1', 0.42), boundary('t2', later)])).toBe(0.42)
    }
  })

  it('skips items that are not turn boundaries', () => {
    const items: ThreadItem[] = [
      boundary('t1', 0.42),
      { kind: 'userText', text: 'after' }
    ]
    expect(latestSessionCostUsd(items)).toBe(0.42)
  })

  it('is null with no positive total', () => {
    expect(latestSessionCostUsd([])).toBeNull()
    expect(latestSessionCostUsd([boundary('t1'), boundary('t2', 0)])).toBeNull()
  })
})

describe('formatSessionCost', () => {
  it('rounds to cents and marks the figure as an estimate', () => {
    expect(formatSessionCost(0.42)).toBe('$0.42 est.')
    expect(formatSessionCost(0.4213)).toBe('$0.42 est.')
    expect(formatSessionCost(12)).toBe('$12.00 est.')
  })
})
