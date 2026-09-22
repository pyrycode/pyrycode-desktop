import { describe, expect, it } from 'vitest'
import { initialTimelineState, reduceTimeline } from './threadTimeline'
import { translateTimelineEvent } from './timelineBridge'
import { reduceHistoryPage } from './historyPageBridge'

// #1565: the six turn-end numbers ride the timeline bridge and the reducer onto the `turnBoundary`
// item, on the live path and through history replay, carried as received.
const metrics = { durationMs: 61234, inputTokens: 0, cacheReadTokens: 40000, cacheCreationTokens: -3, outputTokens: 850, costUsdTotal: 1.2345 }
const end = { type: 'turnEnd' as const, turnId: 't', stopReason: 'end_turn' }
const keys = Object.keys(metrics)

describe('turn end metrics on the turn boundary', () => {
  it('carries all six through the live bridge and the reducer onto the boundary item', () => {
    const event = translateTimelineEvent({ ...end, ...metrics, conversationId: 'c' })
    expect(event).toEqual({ ...end, ...metrics })
    const next = reduceTimeline(initialTimelineState, event ?? end)
    expect(next.items).toEqual([{ kind: 'turnBoundary', turnId: 't', stopReason: 'end_turn', ...metrics }])
  })

  it('carries all six onto the boundary item when the frame arrives through history replay', () => {
    expect(reduceHistoryPage([{ id: 1, ts: 'ts', event: { ...end, ...metrics } }])).toEqual([
      { kind: 'turnBoundary', turnId: 't', stopReason: 'end_turn', ...metrics }
    ])
  })

  it('leaves a boundary without them exactly as before', () => {
    const [item] = reduceTimeline(initialTimelineState, end).items
    expect(item).toEqual({ kind: 'turnBoundary', turnId: 't', stopReason: 'end_turn' })
    for (const key of keys) expect(item).not.toHaveProperty(key, expect.anything())
    const [replayed] = reduceHistoryPage([{ id: 1, ts: 'ts', event: end }])
    for (const key of keys) expect(replayed).not.toHaveProperty(key, expect.anything())
  })
})
