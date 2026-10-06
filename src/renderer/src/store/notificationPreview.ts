// The notification body preview (#1737): what a desktop notification says about the moment that raised
// it — the start of the agent's reply on a turn end, or the action a permission prompt awaits. A pure
// read of the conversation timeline store at the moment the event arrives, with no refetch: the deltas
// and the `toolUse` that feed it arrive before the `turnEnd` or `modalShown` they describe, and
// timelineBridge files them under their own conversation whichever one is open.
//
// The result is UNTRUSTED daemon-derived plain text. It only ever rides the `notify` payload, where main
// cleans and caps it again (fireNotification's notificationBody) and falls back to the fixed copy; nothing
// here logs it. The cut below is the renderer's half of that contract: it keeps a long reply far below
// the main-side guard's bound, so the reply still gets its notification.
import type { StampedDaemonEvent } from '@shared/ipc/events'
import { markdownPlainText } from '../screens/conversation/MarkdownReader'
import { toolHeadline } from '../screens/conversation/toolHeadline'
import type { ConversationTimelineState } from './conversationTimelineStore'
import type { ThreadItem } from './threadTimeline'

/** The three daemon events that raise a notification, as they arrive stamped with their server. */
export type NotifyEvent = Extract<StampedDaemonEvent, { type: 'turnEnd' | 'modalShown' | 'questionShown' }>

/** The most characters a preview keeps, the trailing `…` included — main's body cap, and mobile's. */
export const NOTIFICATION_PREVIEW_CHARS = 200

/**
 * The preview for `event`, or `null` when there is none and the notification keeps its fixed copy.
 *
 * The timeline map is keyed by conversation id alone, so the slice must also belong to the event's own
 * server: one stamped with a different `serverId` never supplies the preview (an unstamped one may, the
 * store's own `receivedSlice` reading). A conversation with no slice — never seen, or evicted past
 * `MAX_RETAINED_TIMELINES` — has no preview.
 *
 * - `turnEnd`: the newest assistant text item carrying the ending turn's id, markdown stripped to the
 *   text a reader sees (link text and code content kept). Another turn's text is never used.
 * - a `permission` modal: `Wants to run <tool>: <target>`, where `<tool>` is the modal's `prompt` (the
 *   daemon's stream approval path sets it to the tool name) and `<target>` is the collapsed row's
 *   headline for the newest result-less `toolCall` of that name.
 * - a `trust` modal and a question batch: none.
 */
export function notificationPreviewIn(state: ConversationTimelineState, event: NotifyEvent): string | null {
  const slice = state.timelines.get(event.conversationId)
  if (slice === undefined) return null
  if (slice.serverId !== undefined && slice.serverId !== event.serverId) return null
  const items = slice.timeline.items
  switch (event.type) {
    case 'turnEnd': {
      const reply = newest(items, (item) => item.kind === 'assistantText' && item.turnId === event.turnId)
      return reply?.kind === 'assistantText' ? boundPreview(markdownPlainText(reply.text)) : null
    }
    case 'modalShown': {
      if (event.class !== 'permission') return null
      const tool = event.prompt
      const call = newest(items, (item) => item.kind === 'toolCall' && item.result === null && item.name === tool)
      return call?.kind === 'toolCall' ? boundPreview(`Wants to run ${tool}: ${toolHeadline(call)}`) : null
    }
    case 'questionShown':
      return null
  }
}

function newest(items: readonly ThreadItem[], matches: (item: ThreadItem) => boolean): ThreadItem | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (matches(items[i])) return items[i]
  }
  return undefined
}

/**
 * Whitespace collapsed, ends trimmed, then cut to NOTIFICATION_PREVIEW_CHARS code points ending in `…`.
 * Collapsing BEFORE cutting is what keeps the `…` once main collapses again: a raw cut full of line
 * breaks would shrink under main's rules and arrive looking whole. `null` when nothing is left.
 */
function boundPreview(text: string): string | null {
  const chars = [...text.replace(/\s+/gu, ' ').trim()]
  if (chars.length === 0) return null
  if (chars.length <= NOTIFICATION_PREVIEW_CHARS) return chars.join('')
  return `${chars.slice(0, NOTIFICATION_PREVIEW_CHARS - 1).join('').trimEnd()}…`
}
