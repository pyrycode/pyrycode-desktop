import { describe, expect, it } from 'vitest'
import { createConversationTimelineStore, type ConversationSlice } from './conversationTimelineStore'
import type { ThreadEvent } from './threadTimeline'
import type { HistoryTimelineEntry } from '@shared/ipc/events'
import { parseChatHistorySnapshot } from '@shared/chatHistory'
import { reduceHistoryPage } from './historyPageBridge'
import { translateTimelineEvent } from './timelineBridge'

const text = (id: number, value: string, parentToolUseId?: string, turnId = 't'): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'assistantDelta', turnId, seq: id, text: value, parentToolUseId } })
const call = (id: number, turnId = 't'): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'toolUse', turnId, toolUseId: 'tool', name: 'Read', inputSummary: 'input' } })
const subcall = (id: number, parentToolUseId = 'agent'): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'toolUse', turnId: 't', toolUseId: 'tool', name: 'Read', inputSummary: 'input', parentToolUseId } })
const result = (id: number): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'toolResult', turnId: 't', toolUseId: 'tool', isError: false, resultSummary: 'done' } })
function harness() {
  const store = createConversationTimelineStore(undefined, () => 'host')
  const page = (entries: HistoryTimelineEntry[]) => {
    store.getState().prependHistoryFor('c', [], false, entries)
    store.getState().recordHistoryPage('c', 'opaque', false, entries.map(e => e.id))
  }
  const held = () => store.getState().timelines.get('c')!
  return { store, page, held }
}

const denial = (id: number, turnId = 't', toolUseId = 'tool'): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'toolDenied', turnId, toolUseId, toolName: 'Read', decisionReasonType: 'rule',
    decisionReason: 'denied', message: 'denied', truncatedFields: null, droppedFields: null } })
const failedEnd = { type: 'turnEnd', turnId: 't', stopReason: 'error', isError: true,
  outcome: 'failed', errorCategory: 'provider' } as const
const failedEntry: HistoryTimelineEntry = { id: 2, ts: 'ts-2', event: failedEnd }
function snapshotFor(h: ReturnType<typeof harness>) {
  const slice = h.held()
  return { version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: slice.timeline.items, prependedRows: slice.prependedRows, coverage: slice.coverage, display: slice.display,
    rowIdentity: { rowKeys: slice.timeline.rowKeys ?? [], nextRowKey: slice.timeline.nextRowKey ?? 0 } }
}
function restore(h: ReturnType<typeof harness>) {
  const fresh = harness()
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(JSON.parse(JSON.stringify(snapshotFor(h))))
  return fresh
}
/**
 * #1851's seam: history reconciliation meets the retained live timeline. Invariant under test: a row
 * already held keeps its key, position, object and attached live state; history only merges content
 * into it, and a live event matching retained display keeps the rows while applying its live effects.
 * Each case runs as-is and with a validated fresh restoration at its 'restore' step.
 */
type Step = { page: HistoryTimelineEntry[] } | { live: ThreadEvent; key?: string } | { echo: string; text?: string }
  | { mark: string } | 'restore'
type Run = { h: ReturnType<typeof harness>; marks: Map<string, ConversationSlice>; restored: boolean }

const message = (id: number, messageId = 'm'): HistoryTimelineEntry => ({ id, ts: `ts-${id}`,
  event: { type: 'messageReceived', message: { message_id: messageId, role: 'user', text: 'operator' } } })
const compacting = (id: number, active: boolean, report: { compactResult?: string; compactError?: string } = {}): HistoryTimelineEntry =>
  ({ id, ts: `ts-${id}`, event: { type: 'compacting', active, ...report } })
/** The same daemon event arriving live, with the join key the live lane records unless `keyed` is false. */
function live(entry: HistoryTimelineEntry, keyed = true): Step {
  const event = translateTimelineEvent(entry.event)
  if (event === null) throw new Error('Expected a display event')
  return { live: event, key: keyed ? `${entry.event.type} ${entry.ts}` : undefined }
}
const on = (event: ThreadEvent): Step => ({ live: event })
const completion: ThreadEvent = { type: 'compactionBoundary', trigger: 'manual', preTokens: 100, postTokens: 20 }
const completed = { kind: 'compactionBoundary', failed: false, manual: true, preTokens: 100, postTokens: 20 }
const retainedFalling: Step[] = [{ page: [compacting(2, false), compacting(1, true)] }, 'restore',
  on({ type: 'compacting', active: true }), { mark: 'rising' }, live(compacting(2, false)), { mark: 'falling' }]
const texts = (h: ReturnType<typeof harness>) => h.held().timeline.items.map(item => 'text' in item ? item.text : item.kind)
const unchanged = (before: ConversationSlice, after: ConversationSlice) => {
  expect(after.timeline.items).toBe(before.timeline.items)
  expect(after.timeline.rowKeys).toEqual(before.timeline.rowKeys)
  expect(after.timeline.nextRowKey).toBe(before.timeline.nextRowKey)
}

const seam: { name: string; steps: Step[]; check: (run: Run) => void }[] = [
  ...[false, true].flatMap(suppressed => [false, true].map(done => ({
    name: `older main text joins across a subagent call, suppressed=${suppressed}, done=${done}`,
    steps: [
      ...(suppressed ? [live(subcall(2))] : [{ page: [subcall(2)] }]),
      { live: { type: 'assistantDelta', turnId: 't', seq: 3, text: 'world', createdAt: 123 }, key: 'assistantDelta ts-3' },
      on({ type: 'toolProgress', turnId: 't', toolUseId: 'tool', elapsedSeconds: 5 }),
      ...(done ? [on({ type: 'toolResult', turnId: 't', toolUseId: 'tool', isError: false, resultSummary: 'live result' })] : []),
      { mark: 'live' }, { page: [text(3, 'world'), subcall(2)] }, 'restore', { mark: 'held' },
      { page: [subcall(2), text(1, 'hello ')] }, { mark: 'joined' },
      { page: [text(3, 'world'), subcall(2), text(1, 'hello ')] }
    ] satisfies Step[],
    check: ({ h, marks }: Run) => {
      const held = marks.get('held')!.timeline
      const joined = marks.get('joined')!
      expect(texts(h)).toEqual(['toolCall', 'hello world'])
      expect(h.held().timeline.rowKeys).toEqual(marks.get('live')!.timeline.rowKeys)
      expect(h.held().timeline.items[0]).toBe(held.items[0])
      expect(h.held().timeline.items[1]).not.toBe(held.items[1])
      expect(h.held().timeline.items[1]).toMatchObject({ text: 'hello world', createdAt: 123 })
      if (done) {
        expect(h.held().timeline.items[0]).toMatchObject({ result: { resultSummary: 'live result' } })
        expect((h.held().timeline.items[0] as { result: unknown }).result).toBe((held.items[0] as { result: unknown }).result)
      } else expect(h.held().timeline.items[0]).toMatchObject({ result: null, elapsedSeconds: 5 })
      unchanged(joined, h.held())
    }
  }))),
  ...[
    { name: 'main tool', entry: { ...call(3), event: { ...call(3).event, toolUseId: 'main' } } },
    { name: 'empty-parent tool', entry: { ...subcall(3, ''), event: { ...subcall(3, '').event, toolUseId: 'main' } } },
    { name: 'subagent text', entry: text(3, 'child', 'agent') },
    { name: 'other turn', entry: text(3, 'other turn', undefined, 'other') },
    { name: 'operator', entry: message(3) }
  ].map(({ name, entry }) => ({
    name: `a ${name} remains a barrier beside a suppressed subagent call`,
    steps: [live(subcall(2)), live(entry), live(text(4, 'after')),
      { page: [text(4, 'after'), entry, subcall(2)] }, 'restore', { mark: 'held' },
      { page: [subcall(2), text(1, 'before')] }, { mark: 'joined' },
      { page: [text(4, 'after'), entry, subcall(2), text(1, 'before')] }
    ] satisfies Step[],
    check: ({ h, marks }: Run) => {
      const held = marks.get('held')!.timeline
      expect(texts(h)).toEqual(['before', 'toolCall', ...held.items.slice(1).map(item => 'text' in item ? item.text : item.kind)])
      expect(h.held().timeline.rowKeys!.slice(1)).toEqual(held.rowKeys)
      held.items.forEach((item, index) => expect(h.held().timeline.items[index + 1]).toBe(item))
      unchanged(marks.get('joined')!, h.held())
    }
  })),
  { name: 'an unrepresented held operator remains a barrier beside a suppressed subagent call',
    steps: [live(subcall(2)), { echo: 'm' }, live(text(4, 'after')),
      { page: [text(4, 'after'), subcall(2)] }, 'restore', { mark: 'held' },
      { page: [subcall(2), text(1, 'before')] }],
    check: ({ h, marks }) => {
      const held = marks.get('held')!.timeline
      expect(texts(h)).toEqual(['before', 'toolCall', 'operator', 'after'])
      expect(h.held().timeline.rowKeys!.slice(1)).toEqual(held.rowKeys)
      held.items.forEach((item, index) => expect(h.held().timeline.items[index + 1]).toBe(item))
      expect(h.held().timeline.localEchoes).toBe(held.localEchoes)
      expect(h.held().timeline.localSendPending).toBe(held.localSendPending)
    } },
  { name: 'new history after the final bound tool precedes an unrepresented held suffix',
    steps: [{ page: [call(2)] }, on({ type: 'assistantDelta', turnId: 'live', seq: 1, text: 'live suffix' }),
      'restore', { mark: 'held' }, { page: [message(4), call(2)] }],
    check: ({ h, marks }) => {
      const held = marks.get('held')!.timeline
      expect(texts(h)).toEqual(['toolCall', 'operator', 'live suffix'])
      expect([0, 2].map(index => h.held().timeline.rowKeys![index])).toEqual(held.rowKeys)
      expect(h.held().timeline.items[0]).toBe(held.items[0])
      expect(h.held().timeline.items[2]).toBe(held.items[1])
    } },
  ...[false, true].map(split => ({ name: `main reply coalesces across subagent tools, split=${split}`,
    steps: [{ page: split ? [subcall(2), text(1, 'hello ')] : [text(3, 'world'), subcall(2), text(1, 'hello ')] },
      'restore', { mark: 'held' }, { page: [text(3, 'world'), subcall(2), text(1, 'hello ')] }] satisfies Step[],
    check: ({ h, marks }: Run) => {
      expect(h.held().timeline.items).toEqual(reduceHistoryPage([text(3, 'world'), subcall(2), text(1, 'hello ')]))
      expect(h.held().timeline.rowKeys).toEqual(marks.get('held')!.timeline.rowKeys)
      expect(h.held().timeline.items[1]).toBe(marks.get('held')!.timeline.items[1])
    } })),
  { name: 'older main text joins after a newer subagent page without reordering held rows',
    steps: [{ page: [text(3, 'world'), subcall(2)] }, 'restore', { mark: 'held' },
      { page: [subcall(2), text(1, 'hello ')] }],
    check: ({ h, marks }) => {
      expect(texts(h)).toEqual(['toolCall', 'hello world'])
      expect(h.held().timeline.rowKeys).toEqual(marks.get('held')!.timeline.rowKeys)
      expect(h.held().timeline.items[0]).toBe(marks.get('held')!.timeline.items[0])
    } },
  { name: 'a subagent lookback uses the last held boundary before an unrepresented suffix',
    steps: [{ page: [text(3, 'world'), subcall(2)] }, on({ type: 'assistantDelta', turnId: 'live', seq: 1, text: 'live suffix' }),
      'restore', { mark: 'held' }, { page: [message(4), text(3, 'world'), subcall(2), text(1, 'hello ')] }],
    check: ({ h, marks }) => {
      expect(texts(h)).toEqual(['toolCall', 'hello world', 'operator', 'live suffix'])
      expect([0, 1, 3].map(index => h.held().timeline.rowKeys![index])).toEqual(marks.get('held')!.timeline.rowKeys)
      expect(h.held().timeline.items[3]).toBe(marks.get('held')!.timeline.items[2])
    } },
  // Verifier round 1: suppressed operator chronology, page-local compaction, denial correlation.
  { name: 'an operator row stays a chronological barrier and keeps its key',
    steps: [{ echo: 'm' }, { mark: 'echo' }, { page: [text(3, 'after'), message(2), text(1, 'before')] }, 'restore',
      { page: [text(3, 'after'), message(2), text(1, 'before'), text(0, 'older ')] }],
    check: ({ h, marks }) => {
      expect(texts(h)).toEqual(['older before', 'operator', 'after'])
      expect(h.held().timeline.rowKeys![1]).toBe(marks.get('echo')!.timeline.rowKeys![0])
    } },
  ...[{ compactResult: 'success' }, { compactResult: 'failed' }, { compactError: 'private error' }].map(report => {
    const entries = [text(4, 'after'), compacting(3, false, report), compacting(2, true), text(1, 'before')]
    return { name: `a page-local compaction ${JSON.stringify(report)} separates text and leaves live compacting alone`,
      steps: [on({ type: 'compacting', active: true }), on({ type: 'turnState', state: 'responding' }), { page: entries },
        { mark: 'paged' }, 'restore', { page: [...entries, text(0, 'older ')] }] satisfies Step[],
      check: ({ h, marks, restored }: Run) => {
        const paged = marks.get('paged')!.timeline
        expect(paged.items).toEqual(reduceHistoryPage(entries))
        expect(paged).toMatchObject({ compacting: true, phase: 'responding' })
        expect(h.held().timeline.items).toMatchObject([{ text: 'older before' },
          { kind: 'compactionBoundary', failed: report.compactResult !== 'success' }, { text: 'after' }])
        expect(h.held().timeline.rowKeys).toEqual(paged.rowKeys)
        expect(h.held().timeline.compacting).toBe(!restored)
        expect(JSON.stringify(snapshotFor(h))).not.toContain('private error')
      } }
  }),
  { name: 'an orphan denial attaches only to the call of its own turn',
    steps: [{ page: [denial(3, 'other')] }, 'restore', { page: [call(2, 'other'), call(1)] }],
    check: ({ h }) => {
      expect(h.held().timeline.items[0]).not.toHaveProperty('denial', expect.anything())
      expect(h.held().timeline.items[1]).toMatchObject({ turnId: 'other', denial: { message: 'denied' } })
    } },
  ...[['other', 'tool'], ['', 'tool'], ['t', ''], ['', '']].map(([turnId, toolUseId]) => ({
    name: `a denial with identities ${JSON.stringify([turnId, toolUseId])} never attaches to turn t's call`,
    steps: [{ page: [denial(2, turnId, toolUseId), call(1)] }, 'restore', { page: [denial(2, turnId, toolUseId), call(1)] }] satisfies Step[],
    check: ({ h }: Run) => expect(h.held().timeline.items[0]).not.toHaveProperty('denial', expect.anything()) })),
  // Verifier round 2: suppressed assistant fragments join, while tools, parents and operators separate.
  { name: 'older text joins a suppressed live assistant row once, on its key',
    steps: [live(text(2, 'world')), { mark: 'live' }, { page: [text(2, 'world')] }, 'restore', { page: [text(1, 'hello ')] },
      { page: [text(2, 'world'), text(1, 'hello ')] }, { page: [text(1, 'hello '), text(0, 'say ')] }],
    check: ({ h, marks }) => {
      expect(texts(h)).toEqual(['say hello world'])
      expect(h.held().timeline.rowKeys).toEqual(marks.get('live')!.timeline.rowKeys)
    } },
  { name: 'several suppressed fragments and an unkeyed live suffix join without duplication',
    steps: [{ page: [text(1, 'hello ')] }, { mark: 'paged' }, live(text(2, 'world')), live(text(3, '!')),
      { page: [text(3, '!'), text(2, 'world'), text(1, 'hello ')] }, live(text(4, ' live'), false), 'restore',
      { page: [text(3, '!'), text(2, 'world'), text(1, 'hello '), text(0, 'say ')] }],
    check: ({ h, marks }) => {
      expect(texts(h)).toEqual(['say hello world! live'])
      expect(h.held().timeline.rowKeys).toEqual(marks.get('paged')!.timeline.rowKeys)
    } },
  { name: 'a suppressed live tool and a different assistant parent stay text barriers',
    steps: [live(call(2)), { page: [call(2)] }, live(text(4, 'child', 'tool')), { page: [text(4, 'child', 'tool')] }, { mark: 'live' },
      { page: [text(4, 'child', 'tool'), text(3, 'after'), call(2), text(1, 'before')] }, { mark: 'paged' }, 'restore',
      { page: [text(0, 'older ')] }],
    check: ({ h, marks }) => {
      expect(h.held().timeline.items).toMatchObject([{ text: 'older before' }, { kind: 'toolCall' }, { text: 'after' },
        { text: 'child', parentToolUseId: 'tool' }])
      expect(h.held().timeline.rowKeys).toEqual(marks.get('paged')!.timeline.rowKeys)
      expect([1, 3].map(index => h.held().timeline.rowKeys![index])).toEqual(marks.get('live')!.timeline.rowKeys)
    } },
  { name: 'an unrepresented held operator separates older text from a suppressed assistant',
    steps: [{ echo: 'm' }, live(text(2, 'world')), { mark: 'live' }, { page: [text(2, 'world')] }, 'restore', { page: [text(1, 'hello ')] }],
    check: ({ h, marks }) => {
      expect(texts(h)).toEqual(['hello ', 'operator', 'world'])
      expect(h.held().timeline.rowKeys!.slice(1)).toEqual(marks.get('live')!.timeline.rowKeys)
    } },
  // Verifier round 3: retained display arriving live applies its live effects without redrawing.
  { name: 'a retained assistant fragment arriving live clears a stall',
    steps: [{ page: [text(1, 'once')] }, 'restore', on({ type: 'stallDetected' }), { mark: 'stalled' }, live(text(1, 'once')),
      { mark: 'cleared' }, { page: [text(1, 'once'), text(0, 'older ')] }],
    check: ({ h, marks }) => {
      const [stalled, cleared] = [marks.get('stalled')!, marks.get('cleared')!]
      expect([stalled.timeline.stalled, cleared.timeline.stalled]).toEqual([true, false])
      unchanged(stalled, cleared)
      expect(cleared.display).toBe(stalled.display)
      expect(cleared.liveKeys).toBe(stalled.liveKeys)
      expect(texts(h)).toEqual(['older once'])
      expect(h.held().timeline.rowKeys).toEqual(stalled.timeline.rowKeys)
    } },
  { name: 'a retained tool call and result arriving live clear stalls',
    steps: [{ page: [result(2), call(1)] }, 'restore', on({ type: 'stallDetected' }), { mark: 'a' }, live(call(1)), { mark: 'b' },
      on({ type: 'stallDetected' }), { mark: 'c' }, live(result(2)), { mark: 'd' }],
    check: ({ marks }) => {
      for (const [before, after] of [['a', 'b'], ['c', 'd']]) {
        expect([marks.get(before)!.timeline.stalled, marks.get(after)!.timeline.stalled]).toEqual([true, false])
        unchanged(marks.get(before)!, marks.get(after)!)
      }
    } },
  { name: 'a retained failed finish arriving live clears thinking and reports the failure',
    steps: [{ page: [failedEntry] }, 'restore', { mark: 'paged' }, on({ type: 'turnState', state: 'thinking' }),
      on({ type: 'thinkingProgress', estimatedTokens: 123 }), { mark: 'thinking' }, { live: failedEnd, key: 'turnEnd ts-2' }],
    check: ({ h, marks }) => {
      expect(marks.get('paged')!.timeline.latestTurnEnd).toBeUndefined()
      expect(marks.get('thinking')!.timeline.thinkingTokens).toBe(123)
      expect(h.held().timeline).toMatchObject({ thinkingTokens: null, latestTurnEnd: failedEnd, phase: 'thinking' })
      unchanged(marks.get('thinking')!, h.held())
    } },
  { name: 'a waiting operator echo settles behind a retained finish arriving live',
    steps: [{ page: [failedEntry, text(1, 'reply')] }, 'restore', on({ type: 'turnState', state: 'responding' }),
      { echo: 'm', text: 'queued' }, on({ type: 'assistantDelta', turnId: 'later', seq: 1, text: 'later' }), { mark: 'waiting' },
      { live: failedEnd, key: 'turnEnd ts-2' }, { mark: 'finished' },
      on({ type: 'userText', received: true, text: 'queued', messageId: 'm', queuedMsgId: 9 })],
    check: ({ h, marks }) => {
      const [waiting, finished] = [marks.get('waiting')!.timeline, marks.get('finished')!.timeline]
      const boundaryKey = waiting.rowKeys![1]
      const echoKey = waiting.localEchoes![0].rowKey
      expect(finished.localEchoes).toMatchObject([{ waiting: true, afterKey: boundaryKey }])
      expect(finished.localSendPending).toBe(waiting.localSendPending)
      unchanged(marks.get('waiting')!, marks.get('finished')!)
      expect(texts(h)).toEqual(['reply', 'turnBoundary', 'queued', 'later'])
      expect(h.held().timeline.rowKeys![2]).toBe(echoKey)
      expect(h.held().timeline.localEchoes).toMatchObject([{ settled: true, queuedMsgId: 9, afterKey: boundaryKey }])
      expect(h.held().timeline.rowArrivalOrder?.get(echoKey)).toBe(finished.nextRowKey)
    } },
  { name: 'a retained compaction falling edge arriving live owns the completion',
    steps: [...retainedFalling, on(completion)],
    check: ({ h, marks }) => {
      const [rising, falling] = [marks.get('rising')!, marks.get('falling')!]
      expect(falling.timeline.compacting).toBe(false)
      expect(falling.timeline.pendingCompaction).toBe(rising.timeline.items[0])
      unchanged(rising, falling)
      expect(h.held().timeline.items).toEqual([completed])
      expect(h.held().timeline.rowKeys).toEqual(rising.timeline.rowKeys)
    } },
  // Verifier round 4: reconciliation keeps a held boundary's live details and pending association.
  { name: 'a completed retained compaction keeps its live details through a later page',
    steps: [...retainedFalling, on(completion), { mark: 'completed' }, { page: [text(0, 'older')] }],
    check: ({ h, marks }) => {
      const before = marks.get('completed')!.timeline
      expect(h.held().timeline.items).toMatchObject([{ text: 'older' }, completed])
      expect(h.held().timeline.items[1]).toBe(before.items[0])
      expect(h.held().timeline.rowKeys![1]).toBe(before.rowKeys![0])
    } },
  { name: 'a pending retained compaction keeps its completion association through a later page',
    steps: [...retainedFalling, { page: [text(0, 'older')] }, { mark: 'paged' }, on(completion)],
    check: ({ h, marks }) => {
      const paged = marks.get('paged')!.timeline
      expect(paged.pendingCompaction).toBe(paged.items[1])
      expect(h.held().timeline.items).toEqual([expect.objectContaining({ text: 'older' }), completed])
      expect(h.held().timeline.rowKeys).toEqual(paged.rowKeys)
      expect(paged.rowKeys![1]).toBe(marks.get('falling')!.timeline.rowKeys![0])
    } },
  { name: 'a completed compaction restored from storage keeps its details through a later page',
    steps: [{ page: [compacting(2, false), compacting(1, true)] }, on({ type: 'compacting', active: true }),
      live(compacting(2, false)), on(completion), { mark: 'completed' }, 'restore', { page: [text(0, 'older')] }],
    check: ({ h, marks }) => {
      expect(h.held().timeline.items).toMatchObject([{ text: 'older' }, completed])
      expect(h.held().timeline.rowKeys![1]).toBe(marks.get('completed')!.timeline.rowKeys![0])
    } },
  // Neighbours: live state established first must survive a later page untouched.
  { name: 'phase, pending send, echo, thinking, stall, retry and compacting survive a later page',
    steps: [{ page: [text(2, 'history')] }, 'restore', on({ type: 'turnState', state: 'responding' }),
      on({ type: 'userText', text: 'pending', messageId: 'pending' }), on({ type: 'thinkingProgress', estimatedTokens: 42 }),
      on({ type: 'stallDetected' }), on({ type: 'apiRetry', active: true, current: 1, total: 3 }),
      on({ type: 'compacting', active: true }), { mark: 'live' }, { page: [text(1, 'older ')] }],
    check: ({ h, marks }) => {
      const { items: _items, rowKeys: _keys, ...state } = h.held().timeline
      const { items: _before, rowKeys: _beforeKeys, ...before } = marks.get('live')!.timeline
      expect(state).toEqual(before)
      expect(state).toMatchObject({ phase: 'responding', thinkingTokens: 42, stalled: true, compacting: true })
      expect(texts(h)).toEqual(['older history', 'pending'])
    } },
  { name: 'live failed-turn feedback survives a later page',
    steps: [{ page: [text(1, 'history')] }, 'restore', on(failedEnd), { mark: 'failed' }, { page: [text(1, 'history'), text(0, 'older ')] }],
    check: ({ h, marks }) => {
      expect(h.held().timeline.latestTurnEnd).toBe(marks.get('failed')!.timeline.latestTurnEnd)
      expect(h.held().timeline.latestTurnEnd).toEqual(failedEnd)
      expect(h.held().timeline.items[1]).toBe(marks.get('failed')!.timeline.items[1])
    } },
  { name: 'a held delivery receipt and pending send survive the operator join',
    steps: [{ page: [text(1, 'history')] }, 'restore', { echo: 'm' }, on({ type: 'messageDelivery', messageId: 'm', status: 'waiting' }),
      { mark: 'held' }, { page: [message(2), text(1, 'history')] }],
    check: ({ h, marks }) => {
      const held = marks.get('held')!
      expect(held.timeline.localEchoes).toMatchObject([{ held: true, delivery: 'waiting' }])
      expect(h.held().timeline.localEchoes).toEqual(held.timeline.localEchoes)
      expect(h.held().timeline.localSendPending).toBe(held.timeline.localSendPending)
      unchanged(held, h.held())
    } },
  { name: 'a waiting echo keeps its finish association through a later page and settles behind it',
    steps: [{ page: [text(1, 'history')] }, 'restore', on({ type: 'turnState', state: 'responding' }), { echo: 'm', text: 'queued' },
      on({ type: 'assistantDelta', turnId: 't', seq: 3, text: 'later' }), on({ type: 'turnEnd', turnId: 't', stopReason: 'end_turn' }),
      { mark: 'finished' }, { page: [text(1, 'history'), text(0, 'older ')] },
      on({ type: 'userText', received: true, text: 'queued', messageId: 'm', queuedMsgId: 9 })],
    check: ({ h, marks }) => {
      const finished = marks.get('finished')!.timeline
      expect(finished.localEchoes).toMatchObject([{ waiting: true, afterKey: finished.rowKeys!.at(-1) }])
      expect(texts(h)).toEqual(['older history', 'later', 'turnBoundary', 'queued'])
      expect(h.held().timeline.rowKeys!.slice(1)).toEqual([2, 3, 1].map(index => finished.rowKeys![index]))
      expect(h.held().timeline.localEchoes).toMatchObject([{ settled: true, afterKey: finished.rowKeys!.at(-1) }])
    } },
  { name: 'a live-only compaction keeps its pending association and completed details through later pages',
    steps: [{ page: [text(2, 'history')] }, 'restore', on({ type: 'compacting', active: true }), on({ type: 'compacting', active: false }),
      { page: [text(1, 'older ')] }, { mark: 'paged' }, on(completion), { mark: 'completed' }, { page: [text(0, 'oldest ')] }],
    check: ({ h, marks }) => {
      const paged = marks.get('paged')!.timeline
      expect(paged.pendingCompaction).toBe(paged.items[1])
      expect(h.held().timeline.items).toEqual([expect.objectContaining({ text: 'oldest older history' }), completed])
      expect(h.held().timeline.items[1]).toBe(marks.get('completed')!.timeline.items[1])
      expect(h.held().timeline.rowKeys).toEqual(paged.rowKeys)
    } },
  { name: 'held tool calls keep their object, live progress and live result through later pages',
    steps: [{ page: [call(1, 'first')] }, 'restore', on({ type: 'toolProgress', turnId: 'first', toolUseId: 'tool', elapsedSeconds: 5 }),
      live({ ...call(2), event: { ...call(2).event, toolUseId: 'second' } as HistoryTimelineEntry['event'] }), { mark: 'running' },
      { page: [{ ...call(2), event: { ...call(2).event, toolUseId: 'second' } as HistoryTimelineEntry['event'] }, call(1, 'first')] },
      on({ type: 'toolResult', turnId: 't', toolUseId: 'second', isError: false, resultSummary: 'live' }), { mark: 'done' },
      { page: [text(0, 'older')] }],
    check: ({ h, marks }) => {
      const running = marks.get('running')!.timeline
      expect(running.items[0]).toMatchObject({ elapsedSeconds: 5 })
      expect(h.held().timeline.items.slice(1)).toEqual(marks.get('done')!.timeline.items)
      expect(h.held().timeline.items[1]).toBe(running.items[0])
      expect(h.held().timeline.items[2]).toBe(marks.get('done')!.timeline.items[1])
      expect(h.held().timeline.items[2]).toMatchObject({ result: { resultSummary: 'live' } })
      expect(h.held().timeline.rowKeys!.slice(1)).toEqual(running.rowKeys)
    } }
]

describe('retained rows keep identity and live state across reconciliation', () => {
  it.each(seam.flatMap(c => [false, true].map(restored => ({ ...c, restored }))))('$name, restored=$restored', ({ steps, check, restored }) => {
    let h = harness()
    const marks = new Map<string, ConversationSlice>()
    const pages: HistoryTimelineEntry[][] = []
    for (const step of steps) {
      if (step === 'restore') { if (restored) h = restore(h) }
      else if ('page' in step) { h.page(step.page); pages.push(step.page) }
      else if ('live' in step) h.store.getState().dispatchFor('c', step.live, step.key)
      else if ('echo' in step) h.store.getState().dispatchLocalEcho('host', 'c', { type: 'userText', text: step.text ?? 'operator', messageId: step.echo })
      else marks.set(step.mark, h.held())
    }
    check({ h, marks, restored })
    // Every page seen again changes nothing, live state included.
    const settled = h.held()
    for (const page of pages) h.page(page)
    expect(h.held().timeline.items).toBe(settled.timeline.items)
    expect(h.held().timeline).toEqual(settled.timeline)
    expect(h.held().timeline.pendingCompaction).toBe(settled.timeline.pendingCompaction)
    expect(h.held().display).toEqual(settled.display)
    // The held rows survive a validated protected round trip with their keys.
    const fresh = restore(h)
    expect(fresh.held().localRead).toBe('loaded')
    expect(fresh.held().timeline.items).toEqual(h.held().timeline.items)
    expect(fresh.held().timeline.rowKeys).toEqual(h.held().timeline.rowKeys)
  })
})

it('rejects saved denial patches with missing, empty or inconsistent correlation identities', () => {
  const h = harness()
  h.page([call(1)])
  const patch = { id: 2, kind: 'patch', toolUseId: 'tool', turnId: 't', rowKey: h.held().timeline.rowKeys![0],
    denial: { toolName: 'Read', decisionReasonType: 'rule', decisionReason: 'denied', message: 'denied',
      truncatedFields: null, droppedFields: null } }
  for (const malformed of [ { ...patch, turnId: undefined }, { ...patch, turnId: '' },
    { ...patch, toolUseId: '' }, { ...patch, turnId: 'other' } ]) {
    expect(() => parseChatHistorySnapshot({ ...snapshotFor(h), display: [malformed] })).toThrow()
  }
})

it.each(['toolResult', 'toolDenied'])('rejects a saved patch with the mismatched source %s', source => {
  const h = harness()
  h.page([source === 'toolResult' ? denial(2) : result(2), call(1)])
  const display = h.held().display!.map(d => d.kind === 'patch' ? { ...d, joinKey: `${source} ts-2` } : d)
  expect(() => parseChatHistorySnapshot({ ...snapshotFor(h), display })).toThrow()
  const fresh = harness()
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(JSON.parse(JSON.stringify({ ...snapshotFor(h), display })))
  expect(fresh.held().localRead).toBe('failed')
  for (const entry of [call(1), result(2)]) {
    fresh.store.getState().dispatchFor('c', translateTimelineEvent(entry.event)!, `${entry.event.type} ${entry.ts}`)
  }
  expect(fresh.held().timeline.items[0]).toMatchObject({ result: { resultSummary: 'done' } })
})

it('a validated restored denial does not suppress a live result with the same timestamp', () => {
  const h = harness()
  h.page([denial(2), call(1)])
  const fresh = restore(h)
  expect(fresh.held().localRead).toBe('loaded')
  const key = fresh.held().timeline.rowKeys![0]
  const event = translateTimelineEvent(result(2).event)!
  fresh.store.getState().dispatchFor('c', event, 'toolResult ts-2')
  expect(fresh.held().timeline.items[0]).toMatchObject({ result: { resultSummary: 'done' }, denial: { message: 'denied' } })
  expect(fresh.held().timeline.rowKeys).toEqual([key])
})

describe('durable history contributions', () => {
  it.each([
    [text(4, 'after'), call(3), subcall(2), text(1, 'before')],
    [text(4, 'after'), subcall(3, ''), subcall(2), text(1, 'before')],
    [text(4, 'after'), text(3, 'child', 'agent'), subcall(2), text(1, 'before')],
    [text(4, 'after'), message(3), subcall(2), text(1, 'before')],
    [text(4, 'after'), text(3, 'other turn', undefined, 'other'), subcall(2), text(1, 'before')]
  ] satisfies HistoryTimelineEntry[][])('preserves real row and parent barriers across subagent lookback: %j', (...entries) => {
    const h = harness()
    h.page(entries.slice(1))
    const fresh = restore(h)
    fresh.page(entries)
    expect(fresh.held().timeline.items).toEqual(reduceHistoryPage(entries))
    const settled = fresh.held()
    fresh.page(entries)
    expect(fresh.held().timeline.items).toBe(settled.timeline.items)
    expect(fresh.held().timeline.rowKeys).toEqual(settled.timeline.rowKeys)
  })

  it('joins partial overlap in durable order and preserves the held text identity', () => {
    const h = harness()
    h.page([text(3, 'world'), text(2, ' ' )])
    const key = h.held().timeline.rowKeys![0]
    h.page([text(2, ' '), text(1, 'hello')])
    h.page([text(3, 'world'), text(2, ' '), text(1, 'hello')])
    expect(h.held().timeline.items).toMatchObject([{ text: 'hello world' }])
    expect(h.held().timeline.rowKeys).toEqual([key])
  })

  it('retains an orphan across a validated fresh restoration and fills the call once', () => {
    const h = harness()
    h.page([result(3)])
    const slice = h.held()
    const snapshot = parseChatHistorySnapshot({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
      items: slice.timeline.items, prependedRows: slice.prependedRows, coverage: slice.coverage,
      display: slice.display, rowIdentity: { rowKeys: slice.timeline.rowKeys ?? [], nextRowKey: slice.timeline.nextRowKey ?? 0 } })
    const fresh = harness()
    fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(JSON.parse(JSON.stringify(snapshot)))
    fresh.page([result(3), call(2)])
    fresh.page([call(2)])
    expect(fresh.held().timeline.items).toMatchObject([{ kind: 'toolCall', result: { resultSummary: 'done' } }])
  })

  it('keeps text separated by a tool row or a different parent distinct', () => {
    const h = harness()
    h.page([text(5, 'child', 'tool'), text(4, 'after'), call(3)])
    h.page([text(2, 'before'), text(1, 'start ')])
    expect(h.held().timeline.items).toMatchObject([
      { text: 'start before' }, { kind: 'toolCall' }, { text: 'after' }, { text: 'child' }
    ])
  })
})

it('preserves live state, held tool identity, and live suffix content through later pages', () => {
  const h = harness()
  h.page([call(2), text(1, 'old')])
  const toolKey = h.held().timeline.rowKeys![1]
  h.store.getState().dispatchFor('c', { type: 'turnState', state: 'responding' })
  h.store.getState().dispatchFor('c', { type: 'userText', text: 'pending', messageId: 'pending' })
  const pending = h.held().timeline.localSendPending
  h.page([result(3), call(2)])
  expect(h.held().timeline.rowKeys![1]).toBe(toolKey)
  expect(h.held().timeline.phase).toBe('responding')
  expect(h.held().timeline.localSendPending).toBe(pending)
  expect(h.held().timeline.items).toMatchObject([{ text: 'old' }, { result: { resultSummary: 'done' } }, { text: 'pending' }])
  const other = harness()
  other.page([text(2, 'history')])
  other.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 3, text: ' live' })
  other.page([text(1, 'older ')])
  expect(other.held().timeline.items).toMatchObject([{ text: 'older history live' }])
})

it('suppresses unique live timestamps in both orders, while ambiguous page keys draw both', () => {
  const first = harness()
  first.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 1, text: 'once' }, 'assistantDelta ts-1')
  first.page([text(1, 'once')])
  expect(first.held().timeline.items).toMatchObject([{ text: 'once' }])
  const second = harness()
  second.page([text(1, 'once')])
  second.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 1, text: 'once' }, 'assistantDelta ts-1')
  expect(second.held().timeline.items).toMatchObject([{ text: 'once' }])
  second.page([{ ...text(2, 'ambiguous'), ts: 'ts-1' }])
  second.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 3, text: ' live' }, 'assistantDelta ts-1')
  expect(second.held().timeline.items).toMatchObject([{ text: 'onceambiguous live' }])
  const third = harness()
  third.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 't', seq: 1, text: 'live' }, 'assistantDelta same')
  third.page([{ ...text(2, 'b'), ts: 'same' }, { ...text(1, 'a'), ts: 'same' }])
  expect(third.held().timeline.items).toMatchObject([{ text: 'ab' }, { text: 'live' }])
})

it('joins operator IDs in both arrival orders without settling pending send from history', () => {
  const message: HistoryTimelineEntry = { id: 4, ts: 'same', event: {
    type: 'messageReceived', message: { message_id: 'm', role: 'user', text: 'operator' } } }
  const h = harness()
  h.store.getState().dispatchLocalEcho('host', 'c', { type: 'userText', messageId: 'm', text: 'operator' })
  const before = h.held().timeline
  h.page([message])
  expect(h.held().timeline.items).toEqual(before.items)
  expect(h.held().timeline.rowKeys).toEqual(before.rowKeys)
  expect(h.held().timeline.localSendPending).toBe(before.localSendPending)
  const fresh = harness()
  fresh.page([message])
  fresh.store.getState().dispatchFor('c', { type: 'userText', received: true, messageId: 'm', text: 'operator' })
  expect(fresh.held().timeline.items).toHaveLength(1)
})

it('does not infer display retention from receipts or legacy row timestamps', () => {
  const h = harness()
  h.store.getState().beginLocalTimelineRead('host', 'c')!.complete({ version: 1, kind: 'timeline', serverId: 'host',
    conversationId: 'c', items: [{ kind: 'assistantText', turnId: 'legacy', text: 'unknown', createdAt: 123 }],
    prependedRows: 0, coverage: { status: 'received', cursor: 'old', atStart: false },
    served: { ids: [1], highestId: 1, receipts: [{ ids: [1], cursor: 'old', atStart: false }] } })
  expect(h.held().display).toBeUndefined()
  h.page([text(1, 'known')])
  expect(h.held().timeline.items).toMatchObject([{ text: 'known' }, { text: 'unknown', createdAt: 123 }])
  h.page([text(1, 'known')])
  expect(h.held().timeline.items).toHaveLength(2)
})

it('keeps display evidence when receipts expire and isolates host replacement and eviction', () => {
  let host = 'a'
  const store = createConversationTimelineStore(undefined, () => host)
  store.getState().prependHistoryFor('c', [], false, [text(1, 'a')])
  store.getState().recordHistoryPage('c', 'one', false, [1])
  store.getState().recordHistoryPage('c', 'large', false, Array.from({ length: 100_001 }, (_, i) => i))
  expect(store.getState().timelines.get('c')?.served).toBeUndefined()
  store.getState().prependHistoryFor('c', [], false, [text(1, 'a')])
  expect(store.getState().timelines.get('c')?.timeline.items).toHaveLength(1)
  host = 'b'
  store.getState().prependHistoryFor('c', [], false, [text(1, 'b')])
  expect(store.getState().timelines.get('c')?.timeline.items).toMatchObject([{ text: 'b' }])
  store.getState().clearTimelineFor('c')
  expect(store.getState().timelines.has('c')).toBe(false)
})

it('rejects malformed declared contribution IDs, operations and retained-row references', () => {
  const base = { version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c', prependedRows: 0,
    coverage: { status: 'unknown' }, items: [{ kind: 'assistantText', turnId: 't', text: 'kept' }],
    rowIdentity: { rowKeys: [3], nextRowKey: 4 } }
  const valid = { id: 0, kind: 'row', rowKey: 3, item: base.items[0] }
  for (const malformed of [
    { ...valid, id: -1 }, { ...valid, id: 0.1 }, { ...valid, id: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, lastId: -1 }, { ...valid, lastId: 0.1 },
    { ...valid, lastId: 2, joinKey: 'assistantDelta ts' },
    { ...valid, rowKey: 2 }, { ...valid, rowKey: undefined }, { ...valid, kind: 'permission' },
    { ...valid, item: { ...base.items[0], turnId: 'wrong' } },
    { id: 1, kind: 'patch', toolUseId: 'tool', result: null },
    { id: 1, kind: 'patch', toolUseId: 'tool', result: { isError: false, resultSummary: 'done' }, rowKey: 3 }
  ]) expect(() => parseChatHistorySnapshot({ ...base, display: [malformed] })).toThrow()
  expect(() => parseChatHistorySnapshot({ ...base, display: [valid, valid] })).toThrow()
  expect(() => parseChatHistorySnapshot({ ...base, display: null })).toThrow()
  const parsed = parseChatHistorySnapshot({ ...base, display: [{ ...valid, token: 'drop', item: { ...base.items[0], token: 'drop' } }] })
  expect(JSON.stringify(parsed)).not.toContain('drop')
})

it('bounds fragment retention before capture without retiring evidence on receipt expiry', () => {
  const h = harness()
  h.page(Array.from({ length: 100_001 }, (_, id) => text(id + 1, id === 0 ? 'first' : 'x')))
  expect(h.held().display!.length).toBeLessThanOrEqual(100_000)
  expect(h.held().timeline.items).toMatchObject([{ text: 'first' + 'x'.repeat(100_000) }])
  h.store.getState().dispatchFor('c', { type: 'userText', text: 'later' })
  const slice = h.held()
  expect(() => parseChatHistorySnapshot({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: slice.timeline.items, prependedRows: slice.prependedRows, coverage: slice.coverage,
    display: slice.display, rowIdentity: { rowKeys: slice.timeline.rowKeys, nextRowKey: slice.timeline.nextRowKey } })).not.toThrow()
  expect(slice.timeline.items.at(-1)).toMatchObject({ text: 'later' })
  expect(slice.display).toMatchObject([{ id: 1, lastId: 100_001, rowKey: slice.timeline.rowKeys![0] }])
  const fresh = harness()
  fresh.store.getState().beginLocalTimelineRead('host', 'c')!.complete(JSON.parse(JSON.stringify({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: slice.timeline.items, prependedRows: slice.prependedRows, coverage: slice.coverage,
    display: slice.display, rowIdentity: { rowKeys: slice.timeline.rowKeys, nextRowKey: slice.timeline.nextRowKey } })))
  fresh.page([text(100_000, 'x'), text(0, 'older ')])
  expect(fresh.held().timeline.items).toMatchObject([{ text: 'older first' + 'x'.repeat(100_000) }, { text: 'later' }])
})


it('a later history join preserves live settlement of an echoed operator row', () => {
  const h = harness()
  h.store.getState().dispatchLocalEcho('host', 'c', { type: 'userText', messageId: 'echo', text: 'operator' })
  const message: HistoryTimelineEntry = { id: 4, ts: 'operator', event: {
    type: 'messageReceived', message: { message_id: 'echo', role: 'user', text: 'operator' } } }
  h.page([message, text(1, 'history')])
  h.store.getState().dispatchFor('c', { type: 'messageDelivery', messageId: 'echo', status: 'waiting' })
  h.store.getState().dispatchFor('c', { type: 'assistantDelta', turnId: 'live', seq: 0, text: 'live response' })
  h.store.getState().dispatchFor('c', { type: 'userText', received: true, sentNow: true, queuedMsgId: 7, messageId: 'echo', text: 'operator' })
  const settled = h.held().timeline
  h.page([message, text(1, 'history')])
  expect(h.held().timeline.items).toEqual(settled.items)
  expect(h.held().timeline.rowKeys).toEqual(settled.rowKeys)
  expect(h.held().timeline.localEchoes).toEqual(settled.localEchoes)
  expect(h.held().timeline.items).toMatchObject([{ text: 'history' }, { text: 'live response' }, { text: 'operator' }])
})
