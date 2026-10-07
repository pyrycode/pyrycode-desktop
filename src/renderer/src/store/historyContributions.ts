import { MAX_CHAT_HISTORY_ITEMS, type DurableThreadItem, type HistoryContribution } from '@shared/chatHistory'
import type { HistoryTimelineEntry } from '@shared/ipc/events'
import { joinKeyFor, translateTimelineEvent } from './timelineBridge'
import { initialTimelineState, isSubagentToolCall, openBubbleIndex, reduceTimeline, type ThreadItem, type TimelineState } from './threadTimeline'
import { withoutLiveEntries } from './historyPageBridge'

function contribution(entry: HistoryTimelineEntry, compaction?: ThreadItem): HistoryContribution | undefined {
  const event = translateTimelineEvent(entry.event)
  const fields = { id: entry.id, joinKey: entry.event.type === 'messageReceived' ? undefined : joinKeyFor(entry.event.type, entry.ts) }
  if (event?.type === 'toolResult') return { ...fields, kind: 'patch', toolUseId: event.toolUseId,
    parentToolUseId: event.parentToolUseId, result: { isError: event.isError, resultSummary: event.resultSummary, resultDetail: event.resultDetail } }
  if (event?.type === 'toolDenied') return event.turnId === '' || event.toolUseId === '' ? undefined
    : { ...fields, kind: 'patch', turnId: event.turnId, toolUseId: event.toolUseId, denial: event.denial }
  if (event === null) return undefined
  const item = event.type === 'compacting' ? compaction : reduceTimeline(initialTimelineState, event).items[0]
  if (item === undefined || item.kind === 'attachmentOffer') return undefined
  // Project terminal metrics away before retaining a display operation.
  const durable: DurableThreadItem = item.kind === 'turnBoundary'
    ? { kind: item.kind, turnId: item.turnId, stopReason: item.stopReason, outcome: item.outcome,
        isError: item.isError, terminalReason: item.terminalReason, errorCategory: item.errorCategory } : item
  return { ...fields, kind: 'row', item: durable }
}

type Group = { item: ThreadItem; members: HistoryContribution[]; key?: number; index: number }

/**
 * Reconcile display evidence only; no held live-state reducer is invoked.
 *
 * Invariant: a row already in the held timeline survives with its key, its position relative to
 * other held rows and its object. History may only merge content into it (an older text prefix, a
 * missing tool result or denial); a contribution's saved item never rebuilds it, so live updates and
 * live state referencing the row (pending compaction, echoes, arrival order, placements) stay attached.
 */
export function reconcileHistory(
  timeline: TimelineState,
  retained: readonly HistoryContribution[] | undefined,
  entries: readonly HistoryTimelineEntry[],
  liveKeys: ReadonlySet<string>,
  reserveBoundary: boolean,
  disjointNewest = false
) {
  const oldItems = timeline.items
  const oldKeys = timeline.rowKeys ?? oldItems.map((_, index) => index)
  const oldPosition = new Map(oldKeys.map((key, index) => [key, index]))
  let nextRowKey = timeline.nextRowKey ?? oldItems.length
  const reserved = nextRowKey
  const tailBoundary = oldKeys[0] ?? reserved
  if (reserveBoundary) nextRowKey++
  const retainedRows = retained?.filter(d => d.rowKey === undefined || oldPosition.has(d.rowKey)) ?? []
  const known = new Map(retainedRows.map(d => [d.id, { ...d }]))
  const sorted = [...entries].sort((a, b) => b.id - a.id)
  const admitted = new Set(withoutLiveEntries(sorted, liveKeys))
  const ranges = retainedRows.filter(d => d.lastId !== undefined)
  let scratch = initialTimelineState
  for (const entry of [...sorted].reverse()) {
    // Reconstruct original page edges before overlap filtering; never reduce held live state.
    const event = translateTimelineEvent(entry.event)
    const compacted = event?.type === 'compacting' ? reduceTimeline(scratch, event) : undefined
    const compaction = compacted?.items[0]
    if (compacted !== undefined) scratch = { ...compacted, items: [] }
    if (known.has(entry.id) || ranges.some(d => entry.id >= d.id && entry.id <= (d.lastId ?? d.id))) continue
    const d = contribution(entry, compaction)
    if (d === undefined) continue
    const messageId = d.kind === 'row' && d.item.kind === 'userText' ? d.item.messageId : undefined
    const echoIndex = messageId ? oldItems.findIndex(item => item.kind === 'userText' && item.messageId === messageId) : -1
    if (echoIndex !== -1) known.set(entry.id, { id: d.id, kind: 'suppressed', rowKey: oldKeys[echoIndex] })
    else if (admitted.has(entry)) known.set(entry.id, d)
    else {
      const matches = d.kind === 'row' ? oldItems.flatMap((item, index) => {
        const same = item.kind === 'toolCall' && d.item.kind === 'toolCall' && item.toolUseId === d.item.toolUseId ||
          item.kind === 'assistantText' && d.item.kind === 'assistantText' && item.turnId === d.item.turnId && item.parentToolUseId === d.item.parentToolUseId ||
          item.kind === 'turnBoundary' && d.item.kind === 'turnBoundary' && item.turnId === d.item.turnId
        return same ? [oldKeys[index]] : []
      }) : []
      known.set(entry.id, { id: d.id, kind: 'suppressed', joinKey: d.joinKey,
        rowKey: matches.length === 1 ? matches[0] : undefined })
    }
  }
  const contributions = [...known.values()].sort((a, b) => a.id - b.id)
  // Group contributions in durable order. A group binds at most one held row and never rebuilds it.
  const represented = new Set(retainedRows.flatMap(d => d.kind === 'row' && d.rowKey !== undefined ? [d.rowKey] : []))
  const accounted = new Map<number, string>()
  for (const d of retainedRows) {
    if (d.kind === 'row' && d.item.kind === 'assistantText' && d.rowKey !== undefined) {
      accounted.set(d.rowKey, (accounted.get(d.rowKey) ?? '') + d.item.text)
    }
  }
  const groups: Group[] = []
  const groupItems: ThreadItem[] = []
  const bound = new Map<number, Group>()
  let anchor: number | undefined
  let barrierIndex = 0
  let open = false
  for (const d of contributions) {
    if (d.kind === 'patch') continue
    const position = d.rowKey === undefined ? undefined : oldPosition.get(d.rowKey)
    const held = position === undefined ? undefined : oldItems[position]
    if (d.kind === 'suppressed' && (held === undefined || held.kind === 'attachmentOffer')) {
      // A live row whose held position is unknown still separates text unless it was only a patch.
      if (!/^tool(Result|Denied) /.test(d.joinKey ?? '')) {
        open = false
        barrierIndex = groups.length
      }
      continue
    }
    const item = held ?? (d.kind === 'row' ? d.item : undefined)
    if (item === undefined) continue
    const existing = d.rowKey === undefined ? undefined : bound.get(d.rowKey)
    // Share the live/page reducer's main-reply lookback across concurrent subagent tool calls.
    const candidate = groups[item.kind === 'assistantText' && !item.parentToolUseId
      ? openBubbleIndex(groupItems) : groups.length - 1]
    const separated = position !== undefined &&
      oldKeys.slice(anchor === undefined ? 0 : anchor + 1, position).some(key => !represented.has(key))
    let group: Group
    if (existing !== undefined) {
      group = existing
      group.members.push(d)
    } else if (open && !separated && candidate !== undefined && candidate.index >= barrierIndex &&
      candidate.item.kind === 'assistantText' && item.kind === 'assistantText' &&
      candidate.item.turnId === item.turnId && candidate.item.parentToolUseId === item.parentToolUseId &&
      (d.rowKey === undefined || candidate.key === undefined || candidate.key === d.rowKey)) {
      group = candidate
      if (d.kind === 'row' && d.item.kind === 'assistantText' && group.key === undefined) {
        group.item = { ...candidate.item, text: candidate.item.text + d.item.text }
      }
      group.members.push(d)
      group.key ??= d.rowKey
    } else {
      group = { item, members: [d], key: d.rowKey, index: groups.length }
      groups.push(group)
    }
    groupItems[group.index] = group.item
    if (group.key !== undefined) bound.set(group.key, group)
    if (position !== undefined) anchor = position
    // A suppressed concurrent subagent call leaves the main reply joinable just like a retained call.
    open = isSubagentToolCall(item) || d.kind === 'row' && (existing === undefined || existing === candidate)
  }
  // Held rows keep their order; new groups enter before the first later bound row, older ones on top.
  // Every group key here is a held key, so an unbound group is exactly a new row.
  const items: ThreadItem[] = []
  const keys: number[] = []
  const unbound = groups.filter(group => group.key === undefined)
  const finalBoundPosition = groups.reduce((last, group) => group.key === undefined ? last
    : Math.max(last, oldPosition.get(group.key) ?? -1), -1)
  let entered = 0
  const enter = (limit: number) => {
    while (entered < unbound.length && unbound[entered].index < limit) {
      const group = unbound[entered++]
      group.key = nextRowKey++
      items.push(group.item); keys.push(group.key)
    }
  }
  const firstBound = groups.find(group => group.key !== undefined)
  if (firstBound !== undefined || !disjointNewest) enter(firstBound?.index ?? Infinity)
  oldItems.forEach((held, index) => {
    const group = bound.get(oldKeys[index])
    if (group !== undefined) enter(group.index)
    items.push(group === undefined ? held : merged(held, group, accounted.get(oldKeys[index]) ?? ''))
    keys.push(oldKeys[index])
    // Trailing history belongs at this known boundary, before the unknown live/restored suffix.
    if (index === finalBoundPosition) enter(Infinity)
  })
  enter(Infinity)
  for (const group of groups) for (const d of group.members) d.rowKey = group.key

  const calls = new Map<string, number>()
  const denialCalls = new Map<string, Map<string, number>>()
  items.forEach((item, index) => {
    if (item.kind !== 'toolCall') return
    if (!calls.has(item.toolUseId)) calls.set(item.toolUseId, index)
    const turn = denialCalls.get(item.turnId) ?? new Map<string, number>()
    if (!turn.has(item.toolUseId)) turn.set(item.toolUseId, index)
    denialCalls.set(item.turnId, turn)
  })
  for (const d of contributions) {
    if (d.kind !== 'patch') continue
    if (d.denial !== undefined && (!d.turnId || !d.toolUseId)) continue
    const index = (d.denial !== undefined ? denialCalls.get(d.turnId ?? '')?.get(d.toolUseId) : calls.get(d.toolUseId)) ?? -1
    const item = items[index]
    if (item?.kind !== 'toolCall') continue
    d.rowKey = keys[index]
    // A patch only fills what the held call lacks; an already-complete call keeps its object.
    const result = item.result ?? d.result ?? null
    const denial = item.denial ?? d.denial
    const parentToolUseId = item.parentToolUseId ?? d.parentToolUseId
    if (result !== item.result || denial !== item.denial || parentToolUseId !== item.parentToolUseId) {
      items[index] = { ...item, result, denial, parentToolUseId, elapsedSeconds: d.result || d.denial ? undefined : item.elapsedSeconds }
    }
  }
  // Retire whole represented groups only for the explicit capacity limit, never receipt expiry.
  let display = contributions
  if (display.length > MAX_CHAT_HISTORY_ITEMS) {
    const compacted: HistoryContribution[] = []
    for (const d of display) {
      const prior = compacted.at(-1)
      if (prior?.kind === 'row' && prior.item.kind === 'assistantText' && d.kind === 'row' &&
        d.item.kind === 'assistantText' && prior.rowKey === d.rowKey && (prior.lastId ?? prior.id) + 1 === d.id) {
        compacted[compacted.length - 1] = { ...prior, joinKey: undefined, lastId: d.lastId ?? d.id,
          item: { ...prior.item, text: prior.item.text + d.item.text } }
      } else compacted.push(d)
    }
    display = compacted
  }
  const positions = new Map(keys.map((key, index) => [key, index]))
  if (display.length > MAX_CHAT_HISTORY_ITEMS) {
    const retired = new Set<number>()
    let remaining = display.length
    const counts = new Map<number, number>()
    for (const d of display) if (d.rowKey !== undefined) counts.set(d.rowKey, (counts.get(d.rowKey) ?? 0) + 1)
    for (const d of display) {
      if (remaining <= MAX_CHAT_HISTORY_ITEMS) break
      if (d.rowKey === undefined || retired.has(d.rowKey)) continue
      const item = items[positions.get(d.rowKey) ?? -1]
      if (item?.kind === 'toolCall' && item.result === null && item.denial === undefined) continue
      retired.add(d.rowKey)
      remaining -= counts.get(d.rowKey) ?? 0
    }
    display = display.filter(d => d.rowKey === undefined || !retired.has(d.rowKey)).slice(-MAX_CHAT_HISTORY_ITEMS)
  }
  const rowContributions = contributions.filter(d => d.kind !== 'patch' && d.rowKey !== undefined)
  let boundaryIndex = 0
  const boundaries = [...entries].sort((a, b) => a.id - b.id).map(entry => {
    while (boundaryIndex < rowContributions.length && rowContributions[boundaryIndex].id < entry.id) boundaryIndex++
    const next = rowContributions[boundaryIndex]
    if (next?.rowKey !== undefined) return next.rowKey
    const prior = rowContributions[boundaryIndex - 1]
    const position = prior?.rowKey === undefined ? -1 : positions.get(prior.rowKey) ?? -1
    return position === -1 ? tailBoundary : keys[position + 1] ?? reserved
  })
  boundaries.push(tailBoundary)
  const same = items.length === oldItems.length && items.every((item, index) => item === oldItems[index])
  const next: TimelineState = { ...timeline, items: same ? oldItems : items, rowKeys: keys, nextRowKey }
  // Live state that references a row object follows the row's key.
  const pendingIndex = timeline.pendingCompaction === undefined ? -1 : oldItems.indexOf(timeline.pendingCompaction)
  const pending = pendingIndex === -1 ? undefined : next.items[positions.get(oldKeys[pendingIndex]) ?? -1]
  if (pending?.kind === 'compactionBoundary') next.pendingCompaction = pending
  return { timeline: next, display, boundaries, inserted: keys.filter(key => !oldPosition.has(key)).length }
}

function merged(held: ThreadItem, group: Group, accounted: string): ThreadItem {
  if (held.kind !== 'assistantText' || !held.text.startsWith(accounted)) return held
  const history = group.members.map(d => d.kind === 'row' && d.item.kind === 'assistantText' ? d.item.text : '').join('')
  const text = history + held.text.slice(accounted.length)
  return text === held.text ? held : { ...held, text }
}
