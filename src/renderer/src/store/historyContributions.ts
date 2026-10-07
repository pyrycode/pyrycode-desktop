import { MAX_CHAT_HISTORY_ITEMS, type DurableThreadItem, type HistoryContribution } from '@shared/chatHistory'
import type { HistoryTimelineEntry } from '@shared/ipc/events'
import { joinKeyFor, translateTimelineEvent } from './timelineBridge'
import { initialTimelineState, reduceTimeline, type ThreadItem, type TimelineState } from './threadTimeline'
import { withoutLiveEntries } from './historyPageBridge'

function contribution(entry: HistoryTimelineEntry): HistoryContribution | undefined {
  const event = translateTimelineEvent(entry.event)
  const fields = { id: entry.id, joinKey: entry.event.type === 'messageReceived' ? undefined : joinKeyFor(entry.event.type, entry.ts) }
  if (event?.type === 'toolResult') return { ...fields, kind: 'patch', toolUseId: event.toolUseId,
    parentToolUseId: event.parentToolUseId, result: { isError: event.isError, resultSummary: event.resultSummary, resultDetail: event.resultDetail } }
  if (event?.type === 'toolDenied') return { ...fields, kind: 'patch', toolUseId: event.toolUseId, denial: event.denial }
  if (event === null) return undefined
  const item = reduceTimeline(initialTimelineState, event).items[0]
  if (item === undefined || item.kind === 'attachmentOffer') return undefined
  // Project terminal metrics away before retaining a display operation.
  const durable: DurableThreadItem = item.kind === 'turnBoundary'
    ? { kind: item.kind, turnId: item.turnId, stopReason: item.stopReason, outcome: item.outcome,
        isError: item.isError, terminalReason: item.terminalReason, errorCategory: item.errorCategory } : item
  return { ...fields, kind: 'row', item: durable }
}

/** Reconcile display evidence only; no held live-state reducer is invoked. */
export function reconcileHistory(
  timeline: TimelineState,
  retained: readonly HistoryContribution[] | undefined,
  entries: readonly HistoryTimelineEntry[],
  liveKeys: ReadonlySet<string>,
  reserveBoundary: boolean
) {
  const oldItems = timeline.items
  const oldKeys = timeline.rowKeys ?? oldItems.map((_, index) => index)
  let nextRowKey = timeline.nextRowKey ?? oldItems.length
  const reserved = nextRowKey
  const tailBoundary = oldKeys[0] ?? reserved
  if (reserveBoundary) nextRowKey++
  const heldKeys = new Set(oldKeys)
  const retainedRows = retained?.filter(d => d.rowKey === undefined || heldKeys.has(d.rowKey))
  const known = new Map(retainedRows?.map(d => [d.id, { ...d }]))
  const sorted = [...entries].sort((a, b) => b.id - a.id)
  const admitted = new Set(withoutLiveEntries(sorted, liveKeys))
  const ranges = (retainedRows ?? []).filter(d => d.lastId !== undefined)
  for (const entry of sorted) {
    if (known.has(entry.id) || ranges.some(d => entry.id >= d.id && entry.id <= (d.lastId ?? d.id))) continue
    const d = contribution(entry)
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
  const represented = new Set(retainedRows?.flatMap(d => d.kind === 'row' && d.rowKey !== undefined ? [d.rowKey] : []))
  const groups: { item: DurableThreadItem; members: HistoryContribution[]; key?: number }[] = []
  const oldPosition = new Map(oldKeys.map((key, index) => [key, index]))
  const previousTexts = new Map<number, string>()
  for (const d of retainedRows ?? []) {
    if (d.kind === 'row' && d.item.kind === 'assistantText' && d.rowKey !== undefined) {
      previousTexts.set(d.rowKey, (previousTexts.get(d.rowKey) ?? '') + d.item.text)
    }
  }
  let previousRowKey: number | undefined
  for (const d of contributions) {
    if (d.kind !== 'row') continue
    const item = d.item
    const tail = groups.at(-1)
    const left = previousRowKey === undefined ? undefined : oldPosition.get(previousRowKey)
    const right = d.rowKey === undefined ? undefined : oldPosition.get(d.rowKey)
    const barrier = left !== undefined && right !== undefined && oldKeys.slice(left + 1, right).some(k => !represented.has(k))
    if (!barrier && tail?.item.kind === 'assistantText' && item.kind === 'assistantText' &&
      tail.item.turnId === item.turnId && tail.item.parentToolUseId === item.parentToolUseId) {
      tail.item = { ...tail.item, text: tail.item.text + item.text }
      tail.members.push(d)
      tail.key ??= d.rowKey
    } else groups.push({ item, members: [d], key: d.rowKey })
    previousRowKey = d.rowKey ?? previousRowKey
  }
  const used = new Set<number>()
  for (const group of groups) {
    if (group.item.kind === 'userText' && group.item.messageId) {
      const messageId = group.item.messageId
      const echo = oldItems.findIndex(item => item.kind === 'userText' && item.messageId === messageId)
      const held = oldItems[echo]
      if (held?.kind === 'userText') { group.key = oldKeys[echo]; group.item = held }
    }
    const heldIndex = group.key === undefined ? -1 : oldPosition.get(group.key) ?? -1
    const held = oldItems[heldIndex]
    if (group.item.kind === 'assistantText' && held?.kind === 'assistantText') {
      const previousText = group.key === undefined ? '' : previousTexts.get(group.key) ?? ''
      if (held.text.startsWith(previousText)) group.item = { ...group.item,
        text: group.item.text + held.text.slice(previousText.length), createdAt: held.createdAt }
    }
    if (group.item.kind === 'toolCall' && held?.kind === 'toolCall') group.item = { ...group.item,
      result: held.result, denial: held.denial, elapsedSeconds: held.elapsedSeconds }
    if (group.key === undefined || used.has(group.key)) group.key = nextRowKey++
    used.add(group.key)
    for (const d of group.members) d.rowKey = group.key
  }
  const items: ThreadItem[] = []
  const keys: number[] = []
  const groupPositions = new Map(groups.map((g, index) => [g.key, index]))
  let groupIndex = 0
  for (let index = 0; index < oldItems.length; index++) {
    const key = oldKeys[index]
    const target = groupPositions.get(key) ?? -1
    if (target !== -1) {
      while (groupIndex <= target) {
        const group = groups[groupIndex++]
        if (group.key !== undefined) { items.push(group.item); keys.push(group.key) }
      }
    } else if (!represented.has(key)) {
      // New older rows precede the unknown/live suffix; known boundaries keep interior rows in place.
      if (groupIndex === 0) {
        const firstHeld = groups.findIndex(g => g.key !== undefined && oldPosition.has(g.key))
        const before = firstHeld === -1 ? groups.length : firstHeld
        while (groupIndex < before) {
          const group = groups[groupIndex++]
          if (group.key !== undefined) { items.push(group.item); keys.push(group.key) }
        }
      }
      items.push(oldItems[index]); keys.push(key)
    }
  }
  while (groupIndex < groups.length) {
    const group = groups[groupIndex++]
    if (group.key !== undefined) { items.push(group.item); keys.push(group.key) }
  }
  for (const d of contributions) {
    if (d.kind !== 'patch') continue
    const index = items.findIndex(item => item.kind === 'toolCall' && item.toolUseId === d.toolUseId)
    const item = items[index]
    if (item?.kind !== 'toolCall') continue
    d.rowKey = keys[index]
    items[index] = { ...item, result: item.result ?? d.result ?? null, denial: item.denial ?? d.denial,
      parentToolUseId: item.parentToolUseId ?? d.parentToolUseId,
      elapsedSeconds: d.result ? undefined : item.elapsedSeconds }
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
  if (display.length > MAX_CHAT_HISTORY_ITEMS) {
    const retired = new Set<number>()
    let remaining = display.length
    const counts = new Map<number, number>()
    for (const d of display) if (d.rowKey !== undefined) counts.set(d.rowKey, (counts.get(d.rowKey) ?? 0) + 1)
    for (const d of display) {
      if (remaining <= MAX_CHAT_HISTORY_ITEMS) break
      if (d.rowKey === undefined || retired.has(d.rowKey)) continue
      const item = items[keys.indexOf(d.rowKey)]
      if (item?.kind === 'toolCall' && item.result === null && item.denial === undefined) continue
      retired.add(d.rowKey)
      remaining -= counts.get(d.rowKey) ?? 0
    }
    display = display.filter(d => d.rowKey === undefined || !retired.has(d.rowKey)).slice(-MAX_CHAT_HISTORY_ITEMS)
  }
  const sameItems = items.length === oldItems.length && items.every((item, index) => JSON.stringify(item) === JSON.stringify(oldItems[index]))
  const rowContributions = contributions.filter(d => d.kind !== 'patch' && d.rowKey !== undefined)
  const positions = new Map(keys.map((key, index) => [key, index]))
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
  return { timeline: { ...timeline, items: sameItems ? oldItems : items, rowKeys: keys, nextRowKey }, display,
    boundaries, inserted: keys.filter(key => !oldPosition.has(key)).length }
}
