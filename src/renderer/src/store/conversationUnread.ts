// Daemon history IDs are authoritative when complete; legacy rows retain local item-count semantics.
import type { TimelineState } from './threadTimeline'
import type { LastReadMark } from './conversationLastReadStore'
import type { ConversationSummary } from '@shared/wire/types'

/** The complete received contract; zero is present, while omission stays unknown. */
export function hasDaemonReadState(row: Pick<ConversationSummary, 'read_up_to' | 'latest_entry_id'> | undefined): row is { read_up_to: number; latest_entry_id: number } {
  return row?.read_up_to !== undefined && row.latest_entry_id !== undefined
}

/**
 * Uses durable daemon history IDs before consulting the nullable local fallback.
 * Legacy branch order is intentional: no held timeline means read; a held timeline
 * without a mark means unread, including an empty slice. Do not collapse null to zero.
 * Callers resolve their own row and keyed slices; this pure module reads no stores or IDs.
 */
export function isConversationUnread(
  timeline: TimelineState | null,
  lastRead: LastReadMark | null,
  row?: Pick<ConversationSummary, 'read_up_to' | 'latest_entry_id'>
): boolean {
  if (hasDaemonReadState(row)) return row.latest_entry_id > row.read_up_to
  if (timeline === null) return false
  if (lastRead === null) return true
  return timeline.items.length > lastRead
}
