import type { ThreadItem } from '../../store/threadTimeline'

type Compaction = Extract<ThreadItem, { kind: 'compactionBoundary' }>

function validCount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function tokenCount(value: number): string {
  return value < 1000 ? String(value) : `${(Math.round(value / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
}

/** Only client-owned copy and validated numbers reach the label. */
export function compactionBoundaryTitle(item: Compaction): string {
  if (item.failed) return 'Compaction failed'
  const counts = validCount(item.preTokens) && validCount(item.postTokens)
    ? `, ${tokenCount(item.preTokens)} → ${tokenCount(item.postTokens)} tokens` : ''
  return `Conversation compacted${counts}${item.manual ? ' by you' : ''}`
}
