import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent, HistoryTimelineEntry } from '@shared/ipc/events'
import { reduceHistoryPage, subscribeHistoryPage } from './historyPageBridge'
import { reduceTimeline, initialTimelineState } from './threadTimeline'
import type { ThreadEvent, ThreadItem } from './threadTimeline'

// Pure-function tests over the page mapping plus spy-driven tests over its subscriber — the
// timelineBridge.test.ts idiom. No React, no DOM, no transport: `environment: 'node'` is global at
// vitest.config.ts, and this module is a pure fold plus one injected-callback subscriber.
//
// THE PAGE IS BUILT NEWEST-FIRST IN EVERY FIXTURE, because that is how the wire serves it
// (protocol-mobile.md § Conversation history: `entries` newest-first) and reversing is the half of
// AC1 that a fold written in the obvious direction gets silently backwards — the rows still appear,
// in the wrong order, and only an assertion on ORDER catches it.

/** One entry, newest-first position implied by its index in the array the tests build. */
function entry(id: number, event: HistoryTimelineEntry['event']): HistoryTimelineEntry {
  return { id, ts: `2026-09-07T10:00:0${id}Z`, event }
}

describe('reduceHistoryPage', () => {
  it('reduces a newest-first page oldest-first', () => {
    // Served newest-first: the SECOND delta of turn t is the page's first element.
    const items = reduceHistoryPage([
      entry(2, { type: 'assistantDelta', turnId: 't', seq: 2, text: 'world' }),
      entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'hello ' })
    ])

    // One coalesced bubble reading in arrival order — 'world hello ' is the un-reversed fold.
    expect(items).toEqual([{ kind: 'assistantText', turnId: 't', text: 'hello world', createdAt: undefined }])
  })

  it('produces the rows the live stream would have produced for the same events', () => {
    const live: ThreadEvent[] = [
      { type: 'assistantDelta', turnId: 't', seq: 1, text: 'a' },
      { type: 'toolUse', turnId: 't', toolUseId: 'u1', name: 'read', inputSummary: 'f.ts', input: undefined },
      { type: 'toolResult', turnId: 't', toolUseId: 'u1', isError: false, resultSummary: '3 lines', resultDetail: undefined },
      { type: 'assistantDelta', turnId: 't', seq: 2, text: 'b' },
      { type: 'turnEnd', turnId: 't', stopReason: 'end_turn' }
    ]
    const expected = live.reduce(reduceTimeline, initialTimelineState).items

    // The same five events as a served page: newest-first, so the live order reversed.
    const page = live
      .map((event, i) => entry(i + 1, event as HistoryTimelineEntry['event']))
      .reverse()

    expect(reduceHistoryPage(page)).toEqual(expected)
  })

  it('draws a stored message with role user as a user row, and one with role assistant as no row', () => {
    expect(
      reduceHistoryPage([
        entry(1, { type: 'messageReceived', message: { message_id: 'm1', role: 'user', text: 'why?' } })
      ])
    ).toEqual([
      { kind: 'userText', text: 'why?', createdAt: undefined, messageId: 'm1', attachments: undefined }
    ])

    expect(
      reduceHistoryPage([
        entry(1, { type: 'messageReceived', message: { message_id: 'm2', role: 'assistant', text: 'because' } })
      ])
    ).toEqual([])
  })

  it('contributes rows only — a stored chrome entry moves no thread state', () => {
    // Every chrome-bearing entry type the decode can hand over, in one page, with one real row.
    const items = reduceHistoryPage([
      entry(5, { type: 'compacting', active: true }),
      entry(4, { type: 'apiRetry', active: true, current: 2, total: 5 }),
      entry(3, { type: 'stallDetected' }),
      entry(2, { type: 'turnState', state: 'thinking' }),
      entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'hi' })
    ])

    // Only the delta drew. AC3's other half — that the HELD chrome is untouched — is the store's, since
    // this function returns rows and has no access to a held state to move.
    expect(items).toEqual([{ kind: 'assistantText', turnId: 't', text: 'hi', createdAt: undefined }])
  })

  it('adds no rows for an empty page or a page of undrawn entries', () => {
    expect(reduceHistoryPage([])).toEqual([])
    expect(reduceHistoryPage([entry(1, { type: 'turnState', state: 'idle' })])).toEqual([])
  })

  it('stamps no row with the time it was drawn', () => {
    const page = [
      entry(2, { type: 'messageReceived', message: { message_id: 'm', role: 'user', text: 'q' } }),
      entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'a' })
    ]
    // AC5: the same page reduced at two different moments produces identical rows. A clock reaching
    // the fold would make `createdAt` differ between these two calls and nothing else would fail.
    const first = reduceHistoryPage(page)
    const later = reduceHistoryPage(page)

    expect(first).toEqual(later)
    for (const item of first) {
      expect('createdAt' in item ? item.createdAt : undefined).toBeUndefined()
    }
  })

  it('does not mutate the page it is handed', () => {
    const page = [
      entry(2, { type: 'assistantDelta', turnId: 't', seq: 2, text: 'b' }),
      entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'a' })
    ]
    reduceHistoryPage(page)

    // An in-place `.reverse()` would leave the caller's array — a structured-clone copy the emitter
    // still holds no reference to, but a second consumer might — silently re-ordered.
    expect(page.map((e) => e.id)).toEqual([2, 1])
  })
})

describe('subscribeHistoryPage', () => {
  const page: DaemonEvent = {
    type: 'historyPageReceived',
    conversationId: 'c-1',
    entries: [entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'hi' })],
    cursor: 'cur',
    atStart: false
  }

  function harness() {
    let listener: ((event: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (event: DaemonEvent) => void) => {
      listener = l
      return off
    })
    const applyPage = vi.fn<(id: string, items: readonly ThreadItem[]) => void>()
    const stop = subscribeHistoryPage(onDaemonEvent, applyPage)
    return { emit: (e: DaemonEvent) => listener?.(e), applyPage, off, stop }
  }

  it('applies a page under the conversation id the event carries', () => {
    const h = harness()
    h.emit(page)

    expect(h.applyPage).toHaveBeenCalledWith('c-1', [
      { kind: 'assistantText', turnId: 't', text: 'hi', createdAt: undefined }
    ])
  })

  it('applies an empty page rather than dropping it', () => {
    // The store owns the no-op; a subscriber that filtered here would hide an empty page from a future
    // consumer that needs to know a page arrived at all.
    const h = harness()
    h.emit({ ...page, entries: [] })

    expect(h.applyPage).toHaveBeenCalledWith('c-1', [])
  })

  it('ignores every other daemon-event arm, the failure half included', () => {
    const h = harness()
    h.emit({ type: 'historyRequestFailed', conversationId: 'c-1', reason: 'history-unavailable', retryable: true })
    h.emit({ type: 'assistantDelta', conversationId: 'c-1', turnId: 't', seq: 1, text: 'live' })
    h.emit({ type: 'disconnected' })

    expect(h.applyPage).not.toHaveBeenCalled()
  })

  it('returns the unsubscribe handle it was given', () => {
    const h = harness()
    h.stop()

    expect(h.off).toHaveBeenCalledOnce()
  })
})
