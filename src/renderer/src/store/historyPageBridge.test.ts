import { describe, it, expect, vi } from 'vitest'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent, HistoryRequestFailure, HistoryTimelineEntry } from '@shared/ipc/events'
import type { HistoryRequestState } from './conversationTimelineStore'
import {
  reduceHistoryPage,
  requestOlderHistory,
  requestOpeningHistory,
  subscribeHistoryPage,
  withoutLiveEntries
} from './historyPageBridge'
import { joinKeyFor } from './timelineBridge'
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

/** The live half of the key for each entry, as `subscribeTimeline` would have minted it (#1225). */
function liveKeysFor(...entries: HistoryTimelineEntry[]): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const e of entries) {
    const key = joinKeyFor(e.event.type, e.ts)
    if (key !== undefined) keys.add(key)
  }
  return keys
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

// #1260 — the scroll-back walk. Same posture as the opening ask above and for the same reason: the whole
// decision is a pure function of the conversation's held reading plus one boolean about where the reader
// is, so it is provable here while the scroll handler that supplies that boolean is not.
describe('requestOlderHistory', () => {
  function deps(held: HistoryRequestState | null) {
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const markRequested = vi.fn<(id: string) => void>()
    const getHeld = vi.fn<(id: string) => HistoryRequestState | null>(() => held)
    return { sendCommand, markRequested, getHeld }
  }

  const loaded = (cursor: string, atStart: boolean): HistoryRequestState => ({
    status: 'loaded',
    cursor,
    atStart
  })

  it('asks for the page before the oldest loaded one, echoing the cursor verbatim', () => {
    const d = deps(loaded('opaque-cursor-1', false))
    requestOlderHistory(d, 'c-1', true)

    // ECHOED, not derived: the cursor goes from the held reading into the payload untouched. Nothing
    // parses it, compares it, or builds anything out of it — the daemon owns its shape entirely.
    expect(d.sendCommand).toHaveBeenCalledWith({
      type: 'requestHistory',
      payload: { conversation_id: 'c-1', cursor: 'opaque-cursor-1', limit: 0 }
    })
    expect(d.markRequested).toHaveBeenCalledWith('c-1')
    // Mark FIRST, the opening ask's ordering and its argument.
    expect(d.markRequested.mock.invocationCallOrder[0]).toBeLessThan(
      d.sendCommand.mock.invocationCallOrder[0]
    )
  })

  it('sends exactly one ask however often the reader fires the detector', () => {
    // ⭐ THE ONE-ASK-IN-FLIGHT PROOF, and it needs the second firing to read a MOVED reading. `onScroll`
    // fires at frame rate while the reader sits in the band, and a `markRequested` moved AFTER the send
    // would pass every single-firing case in this describe while sending on every frame.
    let held: HistoryRequestState | null = loaded('opaque-cursor-1', false)
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const d = {
      sendCommand,
      getHeld: (): HistoryRequestState | null => held,
      markRequested: (): void => {
        held = { status: 'requested' }
      }
    }

    requestOlderHistory(d, 'c-1', true)
    requestOlderHistory(d, 'c-1', true)
    requestOlderHistory(d, 'c-1', true)

    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('asks again with the new cursor once a page has settled', () => {
    // The walk STEPPING, which is the other half of the case above: the gate is the reading, not a
    // one-shot latch, so a page landing between two firings produces a second ask carrying its cursor.
    let held: HistoryRequestState | null = loaded('opaque-cursor-1', false)
    const sendCommand = vi.fn<(command: RendererCommand) => void>()
    const d = {
      sendCommand,
      getHeld: (): HistoryRequestState | null => held,
      markRequested: (): void => {
        held = { status: 'requested' }
      }
    }

    requestOlderHistory(d, 'c-1', true)
    held = loaded('opaque-cursor-2', false)
    requestOlderHistory(d, 'c-1', true)

    expect(sendCommand).toHaveBeenCalledTimes(2)
    expect(sendCommand.mock.calls[1][0]).toEqual({
      type: 'requestHistory',
      payload: { conversation_id: 'c-1', cursor: 'opaque-cursor-2', limit: 0 }
    })
  })

  it('stops walking once a page reports the start of the log', () => {
    // AC3. `atStart` is the ONLY stop: nothing here counts entries, so neither an empty page nor a short
    // one can end a walk, and only the daemon's own flag can.
    const d = deps(loaded('opaque-cursor-3', true))
    requestOlderHistory(d, 'c-1', true)

    expect(d.sendCommand).not.toHaveBeenCalled()
    expect(d.markRequested).not.toHaveBeenCalled()
  })

  it('does not ask while an ask is already on the wire, after a refusal, or with nothing held', () => {
    // The three declining readings. `requested` is the in-flight gate; `failed` is terminal, with no
    // branch on `reason` and no read of `retryable` — there is no timer, no backoff and no re-ask
    // anywhere in this family. `null` belongs to the opening path: a walk never restarts itself
    // mid-screen from an empty cursor, and an evicted slice reads as `null` exactly as a never-opened
    // one does.
    const readings: (HistoryRequestState | null)[] = [
      { status: 'requested' },
      { status: 'failed', reason: 'history-unavailable' as HistoryRequestFailure, retryable: true },
      { status: 'failed', reason: 'unknown-conversation' as HistoryRequestFailure, retryable: false },
      null
    ]

    for (const held of readings) {
      const d = deps(held)
      requestOlderHistory(d, 'c-1', true)
      expect(d.sendCommand).not.toHaveBeenCalled()
      expect(d.markRequested).not.toHaveBeenCalled()
    }
  })

  it('does not ask while the reader is anywhere but near the top', () => {
    // The asking reading with the detector clear — the case that proves the position is a real term in
    // the decision rather than a parameter the function ignores.
    const d = deps(loaded('opaque-cursor-1', false))
    requestOlderHistory(d, 'c-1', false)

    expect(d.sendCommand).not.toHaveBeenCalled()
    expect(d.markRequested).not.toHaveBeenCalled()
  })

  it('does not reach the wire, or the store, for an unaddressable conversation', () => {
    // `requestOpeningHistory`'s guard verbatim and for its reason: `''` is the same failure as `null`
    // spelled differently, not a second case. It returns BEFORE consulting the store, so an unusable id
    // cannot read a reading either.
    for (const id of [null, '']) {
      const d = deps(loaded('opaque-cursor-1', false))
      requestOlderHistory(d, id, true)
      expect(d.sendCommand).not.toHaveBeenCalled()
      expect(d.markRequested).not.toHaveBeenCalled()
      expect(d.getHeld).not.toHaveBeenCalled()
    }
  })
})

// #1225 — the join. A page entry and a live row describing the SAME logical event must draw once, and
// anything the key cannot resolve must draw twice rather than not at all: a duplicated row is a cosmetic
// fault, a silently dropped one is a lost message. Every case below is a pure function of state.
describe('withoutLiveEntries — joining a served page to what the live stream already drew (#1225)', () => {
  const DELTA_1 = { type: 'assistantDelta', turnId: 't', seq: 1, text: 'a' } as const
  const DELTA_2 = { type: 'assistantDelta', turnId: 't', seq: 2, text: 'b' } as const

  it('drops an entry the live stream already drew, keyed on (type, ts)', () => {
    // Newest-first, so the entry the live lane drew is the page's FIRST element — the seam the two lanes
    // meet at. `older` is the page-only remainder.
    const drawn = entry(2, DELTA_2)
    const older = entry(1, DELTA_1)

    expect(withoutLiveEntries([drawn, older], liveKeysFor(drawn))).toEqual([older])
  })

  it('drops the whole run of drawn entries at the page\'s newest end', () => {
    const newest = entry(3, { type: 'turnEnd', turnId: 't', stopReason: 'end_turn' })
    const drawn = entry(2, DELTA_2)
    const older = entry(1, DELTA_1)

    expect(withoutLiveEntries([newest, drawn, older], liveKeysFor(newest, drawn))).toEqual([older])
  })

  it('⭐ STOPS at the newest entry the live lane did NOT draw, keeping every older one', () => {
    // The run rule, asserted directly. `older` IS held live, but a newer entry is not, so suppressing it
    // would cut a hole in the middle of a page the fold reads as a sequence. Nothing is dropped; both
    // lanes draw `older` — a duplicate, which is the fail-open side.
    const undrawn = entry(3, { type: 'turnEnd', turnId: 't', stopReason: 'end_turn' })
    const older = entry(1, DELTA_1)
    const page = [undrawn, older]

    expect(withoutLiveEntries(page, liveKeysFor(older))).toBe(page)
  })

  it('keeps an entry the live stream never drew', () => {
    const fresh = entry(2, DELTA_2)
    expect(withoutLiveEntries([fresh], liveKeysFor(entry(1, DELTA_1)))).toEqual([fresh])
  })

  it('does NOT join on the type alone — a same-type entry at a different ts stays', () => {
    const drawn = entry(1, DELTA_1)
    const other = { ...entry(9, DELTA_2), ts: '2026-09-07T11:11:11Z' }
    expect(withoutLiveEntries([other], liveKeysFor(drawn))).toEqual([other])
  })

  it('does NOT join on the ts alone — a same-ts entry of a different type stays', () => {
    const drawn = entry(1, DELTA_1)
    const other: HistoryTimelineEntry = {
      id: 1,
      ts: drawn.ts,
      event: { type: 'turnEnd', turnId: 't', stopReason: 'end_turn' }
    }
    expect(withoutLiveEntries([other], liveKeysFor(drawn))).toEqual([other])
  })

  it('draws BOTH when two page entries share one key — a comparison that cannot separate two entries drops neither (AC4)', () => {
    // Two genuinely distinct entries the daemon happened to stamp identically. The key cannot say which
    // of them the live row was, so neither is suppressed.
    const a: HistoryTimelineEntry = { id: 1, ts: 'T', event: DELTA_1 }
    const b: HistoryTimelineEntry = { id: 2, ts: 'T', event: DELTA_2 }
    expect(withoutLiveEntries([a, b], liveKeysFor(a))).toEqual([a, b])
  })

  it('suppresses nothing when no live key is held', () => {
    const page = [entry(2, DELTA_2), entry(1, DELTA_1)]
    expect(withoutLiveEntries(page, new Set())).toBe(page)
  })

  it('hands back the SAME array reference when nothing was dropped', () => {
    const page = [entry(2, DELTA_2)]
    expect(withoutLiveEntries(page, liveKeysFor(entry(1, DELTA_1)))).toBe(page)
  })

  it('never suppresses the operator\'s own message row — the live lane mints no key of that type (AC5)', () => {
    // WHERE THE GUARANTEE LIVES: at the EMIT, not here. The daemon writes the operator's message to its
    // log and pushes no `message` frame on the interactive lane, so `daemonConnection.ts` never stamps
    // `messageReceived` and no live key of that type can exist — asserted there, in
    // `daemonConnection.test.ts`. `withoutLiveEntries` has no type-level exclusion and would drop the
    // entry if handed a key spelled for it; what this asserts is the consequence of that emit-side
    // guarantee against a REALISTIC key set — one holding keys only for the two arms the live lane does
    // stamp. The entry survives, and since no live key can exist for it, it also STOPS the run, so the
    // older delta beneath it survives too. This is the structural reason
    // `e2e/real-daemon-history-on-open.spec.ts`'s closing toHaveCount(1) survives the join.
    const drawn = entry(3, DELTA_2)
    const own: HistoryTimelineEntry = {
      id: 2,
      ts: '2026-09-07T10:00:02Z',
      event: {
        type: 'messageReceived',
        message: { message_id: 'm-1', role: 'user', text: 'history marker' }
      }
    }
    const older = entry(1, DELTA_1)

    expect(withoutLiveEntries([drawn, own, older], liveKeysFor(drawn, older))).toEqual([own, older])
  })

  it('refuses to key an over-length ts, so a hostile timestamp suppresses nothing', () => {
    const hostile: HistoryTimelineEntry = { id: 1, ts: 'x'.repeat(4096), event: DELTA_1 }
    expect(joinKeyFor(hostile.event.type, hostile.ts)).toBeUndefined()
    expect(withoutLiveEntries([hostile], new Set(['assistantDelta ' + hostile.ts]))).toEqual([hostile])
  })
})

describe('reduceHistoryPage — the join runs ahead of the fold (#1225)', () => {
  it('folds only what survived the join, and in the live stream\'s own position (AC3)', () => {
    // An entry appended between the ask and the answer: the live lane already drew `seq: 2`, so the
    // page's copy must not draw a second bubble at the head.
    const drawn = entry(2, { type: 'assistantDelta', turnId: 't', seq: 2, text: 'world' })
    const older = entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'hello ' })
    const liveKeys = new Set([joinKeyFor(drawn.event.type, drawn.ts) as string])

    expect(reduceHistoryPage([drawn, older], liveKeys)).toEqual([
      { kind: 'assistantText', turnId: 't', text: 'hello ', createdAt: undefined }
    ])
  })

  it('⭐ keeps a served tool_result whose tool_use the live lane drew, and draws the row filled', () => {
    // The fold is NOT entry-independent: `fillResult` writes into a `toolCall` row an EARLIER entry
    // created. Suppressing the `toolUse` while keeping the `toolResult` would fold the result against a
    // page that has no row to fill, `reduceTimeline` would discard it, and the live row — pending, its
    // result frame lost to the reconnect this scenario models — would never be refilled by anything.
    // Under the run rule the undrawn newest entry stops the walk, so the page draws the pair complete.
    const use: ThreadEvent = {
      type: 'toolUse',
      turnId: 't',
      toolUseId: 'u1',
      name: 'read',
      inputSummary: 'f.ts',
      input: undefined
    }
    const result: ThreadEvent = {
      type: 'toolResult',
      turnId: 't',
      toolUseId: 'u1',
      isError: false,
      resultSummary: '3 lines',
      resultDetail: undefined
    }
    const drawnUse = entry(1, use as HistoryTimelineEntry['event'])
    const undrawnResult = entry(2, result as HistoryTimelineEntry['event'])

    // The whole pair, exactly as the live stream would have drawn it — result filled, nothing lost.
    expect(reduceHistoryPage([undrawnResult, drawnUse], liveKeysFor(drawnUse))).toEqual(
      [use, result].reduce(reduceTimeline, initialTimelineState).items
    )
  })

  it('⭐ keeps a turn\'s older deltas when its newer ones were not drawn, so the text reads in order', () => {
    // The second loss the run rule closes. Dropping the older deltas would leave the newer ones folding
    // into a bubble `prependHistoryFor` puts at the HEAD — above the live bubble holding the older text —
    // and the reply would read back-to-front. Nothing is dropped, so the page's bubble reads in order.
    const older = entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'hello ' })
    const newer = entry(2, { type: 'assistantDelta', turnId: 't', seq: 2, text: 'world' })

    expect(reduceHistoryPage([newer, older], liveKeysFor(older))).toEqual([
      { kind: 'assistantText', turnId: 't', text: 'hello world', createdAt: undefined }
    ])
  })

  it('suppresses nothing when no keys are passed — the fail-open default every existing call site keeps', () => {
    const page = [entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'hello' })]
    expect(reduceHistoryPage(page)).toEqual(reduceHistoryPage(page, new Set()))
  })
})

describe('subscribeHistoryPage — the live keys reach the join (#1225)', () => {
  it('asks the injected getter for the page\'s own conversation and folds against what it returns', () => {
    const drawn = entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'a' })
    const applyPage = vi.fn()
    const getLiveKeys = vi.fn(() => new Set([joinKeyFor(drawn.event.type, drawn.ts) as string]))
    let listener: ((event: DaemonEvent) => void) | undefined
    subscribeHistoryPage(
      (l) => {
        listener = l
        return () => {}
      },
      applyPage,
      vi.fn(),
      getLiveKeys
    )

    listener?.({
      type: 'historyPageReceived',
      conversationId: 'c-1',
      entries: [drawn],
      cursor: 'cur',
      atStart: false
    })

    expect(getLiveKeys).toHaveBeenCalledWith('c-1')
    expect(applyPage).toHaveBeenCalledWith('c-1', [], 'cur', false)
  })

  it('suppresses nothing when no getter is injected', () => {
    const drawn = entry(1, { type: 'assistantDelta', turnId: 't', seq: 1, text: 'a' })
    const applyPage = vi.fn()
    let listener: ((event: DaemonEvent) => void) | undefined
    subscribeHistoryPage(
      (l) => {
        listener = l
        return () => {}
      },
      applyPage,
      vi.fn()
    )

    listener?.({
      type: 'historyPageReceived',
      conversationId: 'c-1',
      entries: [drawn],
      cursor: 'cur',
      atStart: false
    })

    expect(applyPage).toHaveBeenCalledWith(
      'c-1',
      [{ kind: 'assistantText', turnId: 't', text: 'a', createdAt: undefined }],
      'cur',
      false
    )
  })
})
