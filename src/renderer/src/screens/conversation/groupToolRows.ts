import type { ThreadItem } from '../../store/threadTimeline'

export interface GroupedToolRow {
  index: number
  depth: number
  ancestors: number[]
  count: number
  running: boolean
}

/** Display projection only. Identifiers are equality hints local to this conversation. */
export function groupToolRows(items: readonly ThreadItem[]): GroupedToolRow[] {
  const owners = new Map<string, number>()
  items.forEach((item, index) => {
    if (item.kind === 'toolCall' && (item.name === 'Agent' || item.name === 'Task') && !owners.has(item.toolUseId)) {
      owners.set(item.toolUseId, index)
    }
  })
  const parents = items.map((item) => item.kind === 'toolCall' && item.parentToolUseId
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
    rows.push({ ...entry, depth: Math.min(entry.ancestors.length, 2), count: 0,
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
  return rows
}
