import type { ConversationSummary } from '@shared/wire/types'

/** Received owning-host shown/read watermarks are the only unread evidence. */
export function isConversationUnread(
  row?: Pick<ConversationSummary, 'read_up_to' | 'last_shown_version'> & { serverId?: string | null }
): boolean {
  return typeof row?.serverId === 'string' && row.last_shown_version !== undefined && row.read_up_to !== undefined &&
    row.last_shown_version > row.read_up_to
}
