import type { BackgroundAgentTimeline } from '../../store/backgroundTaskRosterStore'
import type { ThreadItem } from '../../store/threadTimeline'

export interface GroupedToolRow {
  marker?: boolean
  background?: boolean
  relocated?: boolean
  index: number
  depth: number
  ancestors: number[]
  count: number
  hasChildren: boolean
  running: boolean
}

/** Display projection only. Identifiers are equality hints local to this conversation. */
export function groupToolRows(
  items: readonly ThreadItem[],
  evidence: ReadonlyMap<string, BackgroundAgentTimeline> = new Map(),
  rowKeys: readonly number[] = items.map((_, index) => index),
  historyCount = 0
): GroupedToolRow[] {
  const owners = new Map<string, number>()
  items.forEach((item, index) => {
    if (item.kind === 'toolCall' && (item.name === 'Agent' || item.name === 'Task') && !owners.has(item.toolUseId)) {
      owners.set(item.toolUseId, index)
    }
  })
  const parents = items.map((item) => (item.kind === 'toolCall' || item.kind === 'assistantText') && item.parentToolUseId
    ? owners.get(item.parentToolUseId) : undefined)
  // A cycle is not ancestry. Disconnect its members before projecting any rows.
  parents.forEach((_, index) => {
    const path = new Set<number>()
    let current: number | undefined = index
    while (current !== undefined && !path.has(current)) {
      path.add(current)
      current = parents[current]
    }
    if (current !== undefined) {
      let member: number | undefined = current
      do {
        const next: number | undefined = parents[member]
        parents[member] = undefined
        member = next
      } while (member !== undefined && member !== current)
    }
  })
  const children = new Map<number, number[]>()
  const roots: number[] = []
  parents.forEach((parent, index) => {
    if (parent === undefined) roots.push(index)
    else {
      const siblings = children.get(parent) ?? []
      siblings.push(index)
      children.set(parent, siblings)
    }
  })
  const rows: GroupedToolRow[] = []
  const stack: { index: number; ancestors: number[] }[] = [...roots].reverse().map((index) => ({ index, ancestors: [] }))
  while (stack.length) {
    const entry = stack.pop()
    if (!entry) break
    const item = items[entry.index]
    rows.push({ ...entry, depth: Math.min(entry.ancestors.length, 2), count: 0, hasChildren: children.has(entry.index),
      running: item?.kind === 'toolCall' && item.result === null && item.denial === undefined })
    for (const index of [...(children.get(entry.index) ?? [])].reverse()) {
      stack.push({ index, ancestors: [...entry.ancestors, entry.index] })
    }
  }
  const byIndex = new Map(rows.map((row) => [row.index, row]))
  const distinct = new Map<number, Set<string>>()
  for (const row of rows) {
    const item = items[row.index]
    if (item?.kind !== 'toolCall') continue
    for (const index of row.ancestors) {
      const ancestor = byIndex.get(index)
      if (!ancestor) continue
      const ids = distinct.get(index) ?? new Set<string>()
      ids.add(item.toolUseId)
      distinct.set(index, ids)
      ancestor.count = ids.size
      ancestor.running ||= row.running
    }
  }
  const agents = new Map<number, BackgroundAgentTimeline>()
  for (const entry of evidence.values()) {
    const index = owners.get(entry.toolCallId)
    if (entry.confirmed && entry.toolCallId.length > 0 && index !== undefined &&
        items[index]?.kind === 'toolCall' && items[index].name === 'Agent' && !agents.has(index)) agents.set(index, entry)
  }
  if (agents.size === 0) return rows
  const groups = new Map<number, GroupedToolRow[]>()
  const ordinary: GroupedToolRow[] = []
  for (const row of rows) {
    const owner = agents.has(row.index) ? row.index : [...row.ancestors].reverse().find(index => agents.has(index))
    if (owner === undefined) ordinary.push(row)
    else {
      const entry = agents.get(owner)
      if (!entry) continue
      const ancestors = row.index === owner ? [] : row.ancestors.slice(row.ancestors.indexOf(owner))
      const group = groups.get(owner) ?? []
      group.push({ ...row, ancestors, depth: Math.min(ancestors.length, 2),
        relocated: true, background: row.index === owner, running: row.index === owner ? entry.finishBefore === null : row.running })
      groups.set(owner, group)
      if (row.index === owner) ordinary.push({ ...row, marker: true, ancestors: [], depth: 0, running: entry.finishBefore === null, hasChildren: false })
    }
  }
  const settled = [...agents].filter(([, entry]) => entry.finishBefore !== null)
    .sort((a, b) => (a[1].finishBefore ?? 0) - (b[1].finishBefore ?? 0))
  for (const [index, entry] of settled) {
    const boundary = entry.finishBefore
    const at = ordinary.findIndex(row => !row.marker && !row.relocated && row.index >= historyCount && boundary !== null && (rowKeys[row.index] ?? Infinity) >= boundary)
    ordinary.splice(at === -1 ? ordinary.length : at, 0, ...(groups.get(index) ?? []))
  }
  for (const [index, entry] of agents) if (entry.finishBefore === null) ordinary.push(...(groups.get(index) ?? []))
  return ordinary
}
