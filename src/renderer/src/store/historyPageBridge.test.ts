import { describe, it, expect, vi } from 'vitest'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent, HistoryRequestFailure, HistoryTimelineEntry } from '@shared/ipc/events'
import type { HistoryRequestState } from './conversationTimelineStore'
import {
  reduceHistoryPage,
  requestOpeningHistory,
  subscribeHistoryPage
} from './historyPageBridge'
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
    const applyPage =
      vi.fn<(id: string, items: readonly ThreadItem[], cursor: string, atStart: boolean) => void>()
    const settleFailure =
      vi.fn<(id: string, reason: HistoryRequestFailure, retryable: boolean) => void>()
    const stop = subscribeHistoryPage(onDaemonEvent, applyPage, settleFailure)
    return { emit: (e: DaemonEvent) => listener?.(e), applyPage, settleFailure, off, stop }
  }

  it('applies a page under the conversation id the event carries, with its cursor and atStart', () => {
    const h = harness()
    h.emit(page)

    expect(h.applyPage).toHaveBeenCalledWith(
      'c-1',
      [{ kind: 'assistantText', turnId: 't', text: 'hi', createdAt: undefined }],
      'cur',
      false
    )
    expect(h.settleFailure).not.toHaveBeenCalled()
  })

  it('applies an empty page rather than dropping it', () => {
    // The store owns the no-op; a subscriber that filtered here would hide an empty page from a
    // consumer that needs to know a page arrived at all — which since #1259 is how a conversation
    // predating the log settles rather than staying permanently in flight.
    const h = harness()
    h.emit({ ...page, entries: [], cursor: '', atStart: true })

    expect(h.applyPage).toHaveBeenCalledWith('c-1', [], '', true)
  })

  // #1259 claims the failure arm #1223 declined. All six members settle IDENTICALLY: the arm copies
  // `reason` and `retryable` and branches on neither, so a future per-reason behaviour cannot be added
  // without a test moving.
  it('settles every refusal the same way, drawing nothing', () => {
    const reasons: readonly HistoryRequestFailure[] = [
      'conversation-not-found',
      'history-invalid-request',
      'history-invalid-page-size',
      'history-invalid-cursor',
      'history-unavailable',
      'unclassified'
    ]
    const h = harness()
    for (const reason of reasons) {
      h.emit({ type: 'historyRequestFailed', conversationId: 'c-1', reason, retryable: false })
    }

    expect(h.settleFailure.mock.calls).toEqual(reasons.map((reason) => ['c-1', reason, false]))
    expect(h.applyPage).not.toHaveBeenCalled()
  })

  it('carries the retryable flag as sent rather than re-deriving it', () => {
    // `history.unavailable` is the set's one retryable member, computed at the single emit precisely so
    // a walk driver cannot re-derive it wrong. Reading a value the event did not carry is the defect.
    const h = harness()
    h.emit({
      type: 'historyRequestFailed',
      conversationId: 'c-2',
      reason: 'history-unavailable',
      retryable: true
    })

    expect(h.settleFailure).toHaveBeenCalledWith('c-2', 'history-unavailable', true)
  })

  it('ignores every arm it does not own', () => {
    const h = harness()
    h.emit({ type: 'assistantDelta', conversationId: 'c-1', turnId: 't', seq: 1, text: 'live' })
    h.emit({ type: 'disconnected' })

    expect(h.applyPage).not.toHaveBeenCalled()
    expect(h.settleFailure).not.toHaveBeenCalled()
  })

  it('returns the unsubscribe handle it was given', () => {
    const h = harness()
    h.stop()

    expect(h.off).toHaveBeenCalledOnce()
  })
})

// #1259 — the opening ask. The whole decision is a pure function of the conversation's held reading, so
// it is provable here: `vitest.config.ts` is `environment: 'node'`, no renderer spec runs an effect, and
// the activation seam's wiring is otherwise structurally uncoverable.
describe('requestOpeningHistory', () => {
  function deps(held: HistoryRequestState | null) {
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const markRequested = vi.fn<(id: string) => void>()
    const getHeld = vi.fn<(id: string) => HistoryRequestState | null>(() => held)
    return { sendCommand, markRequested, getHeld }
  }

  it('asks for the newest page when nothing is held, marking before sending', () => {
    const d = deps(null)
    requestOpeningHistory(d, 'c-1')

    // An empty cursor is the normal OPENING value of a walk, never a missing one, and `limit: 0` is the
    // published "you choose" value `buildRequestHistory` normalises a non-positive ask to.
    expect(d.sendCommand).toHaveBeenCalledWith({
      type: 'requestHistory',
      payload: { conversation_id: 'c-1', cursor: '', limit: 0 }
    })
    expect(d.markRequested).toHaveBeenCalledWith('c-1')
    // Mark FIRST: the invariant that matters is "never ask twice" (a duplicate ask duplicates rows),
    // and a mark left standing over a send that threw is repaired by the next eviction.
    expect(d.markRequested.mock.invocationCallOrder[0]).toBeLessThan(
      d.sendCommand.mock.invocationCallOrder[0]
    )
  })

  it('does not ask again for a conversation already asking, drawn or refused', () => {
    const settled: readonly (HistoryRequestState | null)[] = [
      { status: 'requested' },
      { status: 'loaded', cursor: 'cur', atStart: false },
      { status: 'loaded', cursor: '', atStart: true },
      { status: 'failed', reason: 'history-unavailable', retryable: true },
      { status: 'failed', reason: 'conversation-not-found', retryable: false }
    ]
    for (const held of settled) {
      const d = deps(held)
      requestOpeningHistory(d, 'c-1')

      // AC2 for the retained case, AC4 for the refused one — including the RETRYABLE refusal, which is
      // recorded and not acted on: no timer, no backoff, no automatic re-ask anywhere in this slice.
      expect(d.sendCommand).not.toHaveBeenCalled()
      expect(d.markRequested).not.toHaveBeenCalled()
    }
  })

  it('sends exactly once across two activations of the same conversation, and again once evicted', () => {
    // The production sequence: `requestConversationConfig` fires on EVERY activation, including a
    // re-click of the row already open, so the gate has to live here rather than at the seam.
    let held: HistoryRequestState | null = null
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const d = {
      sendCommand,
      getHeld: () => held,
      markRequested: () => {
        held = { status: 'requested' }
      }
    }
    requestOpeningHistory(d, 'c-1')
    held = { status: 'loaded', cursor: 'cur', atStart: false }
    requestOpeningHistory(d, 'c-1')

    expect(sendCommand).toHaveBeenCalledOnce()

    // AC3: an evicted slice takes its reading with it, so the reading is `null` again and the re-open
    // refills from history rather than starting empty.
    held = null
    requestOpeningHistory(d, 'c-1')
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('sends nothing for an unaddressable conversation, and never consults the store for one', () => {
    for (const id of [null, '']) {
      const d = deps(null)
      requestOpeningHistory(d, id)

      expect(d.sendCommand).not.toHaveBeenCalled()
      expect(d.markRequested).not.toHaveBeenCalled()
      expect(d.getHeld).not.toHaveBeenCalled()
    }
  })
})
