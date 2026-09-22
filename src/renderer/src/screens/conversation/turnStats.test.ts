import { describe, it, expect } from 'vitest'
import { formatTurnStats, turnStatsByItemIndex } from './turnStats'
import type { ThreadItem } from '../../store/threadTimeline'

describe('formatTurnStats', () => {
  it('formats the whole input, the output and the duration', () => {
    expect(formatTurnStats({
      inputTokens: 9, cacheReadTokens: 12000, cacheCreationTokens: 440, outputTokens: 800, durationMs: 41999
    })).toBe('12.4k in · 800 out · 41s')
  })

  it('counts an absent or non-positive input part as 0', () => {
    expect(formatTurnStats({ inputTokens: -5, cacheReadTokens: 0, cacheCreationTokens: 700 })).toBe('700 in')
    expect(formatTurnStats({ inputTokens: 12 })).toBe('12 in')
  })

  it('shows counts under 1000 in full and from 1000 in thousands to one decimal', () => {
    expect(formatTurnStats({ outputTokens: 999 })).toBe('999 out')
    expect(formatTurnStats({ outputTokens: 1000 })).toBe('1.0k out')
    expect(formatTurnStats({ outputTokens: 12449 })).toBe('12.4k out')
    expect(formatTurnStats({ outputTokens: 12450 })).toBe('12.5k out')
  })

  it('shows the duration in whole seconds, then minutes and seconds past a minute', () => {
    expect(formatTurnStats({ durationMs: 999 })).toBeNull()
    expect(formatTurnStats({ durationMs: 1000 })).toBe('1s')
    expect(formatTurnStats({ durationMs: 41000 })).toBe('41s')
    expect(formatTurnStats({ durationMs: 59999 })).toBe('59s')
    expect(formatTurnStats({ durationMs: 60000 })).toBe('1m 0s')
    expect(formatTurnStats({ durationMs: 125000 })).toBe('2m 5s')
    expect(formatTurnStats({ durationMs: 4503000 })).toBe('75m 3s')
  })

  it('omits each non-positive or absent segment and keeps the separator between the rest', () => {
    expect(formatTurnStats({ inputTokens: 5, outputTokens: 0, durationMs: 41000 })).toBe('5 in · 41s')
    expect(formatTurnStats({ outputTokens: 800, durationMs: -1 })).toBe('800 out')
    expect(formatTurnStats({ outputTokens: 800, durationMs: 2000 })).toBe('800 out · 2s')
  })

  it('returns null when every segment is omitted', () => {
    expect(formatTurnStats({})).toBeNull()
    expect(formatTurnStats({ inputTokens: 0, outputTokens: 0, durationMs: 500, costUsdTotal: 1.5 })).toBeNull()
  })
})

describe('turnStatsByItemIndex', () => {
  const assistant = (text: string, turnId = 't1'): ThreadItem => ({ kind: 'assistantText', turnId, text })
  const boundary = (turnId = 't1', outputTokens?: number): ThreadItem =>
    ({ kind: 'turnBoundary', turnId, stopReason: 'end_turn', outputTokens })

  it("maps the turn's last assistant bubble, not an earlier one or the user bubble", () => {
    const items: ThreadItem[] = [
      { kind: 'userText', text: 'hi' }, assistant('a'), assistant('b'), boundary('t1', 800)
    ]
    expect([...turnStatsByItemIndex(items)]).toEqual([[2, '800 out']])
  })

  it('is not moved by tool rows between the bubble and the boundary', () => {
    const items: ThreadItem[] = [
      assistant('a'),
      { kind: 'toolCall', turnId: 't1', toolUseId: 'u', name: 'Read', inputSummary: '', result: null },
      boundary('t1', 5)
    ]
    expect([...turnStatsByItemIndex(items)]).toEqual([[0, '5 out']])
  })

  it('maps nothing for an open turn, a turn without assistant text, or a boundary without numbers', () => {
    expect(turnStatsByItemIndex([assistant('open')]).size).toBe(0)
    expect(turnStatsByItemIndex([assistant('a'), boundary('t1'), boundary('t2', 5)]).size).toBe(0)
  })
})
