import type { ThreadItem } from '../../store/threadTimeline'
import type { GroupedToolRow } from './groupToolRows'

export interface ToolRun {
  index: number
  members: number[]
  count: number
  running: boolean
  failed: number
}

/** Projection excludes undrawn rows. Fold roots independently of inner expansion and retain ownership. */
export function foldToolRuns(items: readonly ThreadItem[], projection: readonly GroupedToolRow[]): ToolRun[] {
  const runs: ToolRun[] = []
  let current: ToolRun | undefined
  const finish = () => {
    if (current && current.count >= 2) runs.push(current)
    current = undefined
  }
  for (const group of projection) {
    const item = items[group.index]
    if (item?.kind !== 'toolCall') {
      finish()
      continue
    }
    if (group.ancestors.length === 0) {
      current ??= { index: group.index, members: [], count: 0, running: false, failed: 0 }
      current.count++
      current.running ||= group.running
      if (item.denial !== undefined || item.result?.isError === true) current.failed++
    }
    current?.members.push(group.index)
  }
  finish()
  return runs
}
