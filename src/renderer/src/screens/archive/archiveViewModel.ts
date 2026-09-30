// Archive-only derivations; the store and other list views retain their own order.
import type { ConversationSummary } from '@shared/wire/types'
import { partitionByPromotion, formatLastActivity } from '../channels/channelListViewModel'

// Date.parse accepts bare dates and normalizes impossible calendar dates. Archive stamps must
// include an RFC3339 time and zone, with a valid calendar day, before they can displace last use.
const RFC3339 = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[tT](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[zZ]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

function isArchiveInstant(iso: string): boolean {
  const match = RFC3339.exec(iso)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = month === 2 ? (leap ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31)
  return day <= days && Number.isFinite(Date.parse(iso))
}

/** One selected instant supplies both the order and the subtitle. Strings never become log data. */
function archiveInstant(row: ConversationSummary): { iso: string; time: number; fraction: string } | null {
  const iso = typeof row.archived_at === 'string' && isArchiveInstant(row.archived_at)
    ? row.archived_at : row.last_used_at
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  // Preserve RFC3339 sub-millisecond precision for ordering; Date.parse alone would create false ties.
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(iso)?.[1]?.slice(3).replace(/0+$/, '') ?? ''
  return { iso, time, fraction }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareArchived(left: ConversationSummary, right: ConversationSummary): number {
  const a = archiveInstant(left)
  const b = archiveInstant(right)
  if (a !== null && b !== null) {
    const instantOrder = b.time - a.time || compareText(b.fraction, a.fraction)
    if (instantOrder !== 0) return instantOrder
  } else if (a !== null || b !== null) {
    return a === null ? 1 : -1
  }
  return compareText(left.id, right.id)
}

/** Sort fresh per-tab arrays across hosts; stable sort retains input order on fully equal keys/ids. */
export function partitionArchived(rows: readonly ConversationSummary[]): {
  channels: readonly ConversationSummary[]
  discussions: readonly ConversationSummary[]
} {
  const { channels, discussions } = partitionByPromotion(rows.filter((r) => r.is_archived))
  return {
    channels: [...channels].sort(compareArchived),
    discussions: [...discussions].sort(compareArchived)
  }
}

/** Keep the existing relative buckets and short-date format, without doubling “ago”. */
export function archivedSubtitle(row: ConversationSummary, now: number): string {
  const instant = archiveInstant(row)
  if (instant === null) return 'Archived'
  return `Archived ${formatLastActivity(instant.iso, now)}`
}

/**
 * A tab's label with its live archived count (AC2). `count === null` (the list is not yet loaded) →
 * the bare `base`; otherwise `` `${base} (${count})` `` — including `count === 0` → "Channels (0)", so
 * a loaded-but-empty tab shows "(0)" rather than a bare label. Keeps the null-vs-loaded tri-state in
 * one testable unit.
 */
export function tabCountLabel(base: string, count: number | null): string {
  return count === null ? base : `${base} (${count})`
}
