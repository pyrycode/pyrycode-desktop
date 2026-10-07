import type { QueuedItem } from '@shared/wire/types'
import type { ThreadItem, TimelineState } from '../../store/threadTimeline'

// Queue snapshots remain replacement truth. Only retained local echo facts establish ownership.

/** The drop affordance's two values for one queued row — exactly what `dropQueuedMessage` takes, and
 *  never `text` or `ts`. Minted here rather than handing the row its whole `QueuedItem`, which resolves
 *  #1213 § Open questions 1 in the stronger direction: the row cannot leak a field back down and up
 *  because it never holds one. `messageId` is `string | undefined` because a pre-pyrycode#2092 daemon
 *  sends none; the container already treats that as "correlates with nothing". */
export interface QueuedRowHandle {
  queuedMsgId: number
  messageId: string | undefined
}

/** One row of the merged thread. `queued` is non-null exactly while the daemon's last snapshot reported
 *  this row's message queued — the whole "not yet run" signal, carried as data so the render fork is a
 *  pure function of it. */
export interface FoldedRow {
  item: ThreadItem
  itemIndex: number
  queued: QueuedRowHandle | null
}

/** Project pending own rows at the tail while retaining source indices for row state. */
export function foldQueuedRows(
  items: readonly ThreadItem[],
  queued: readonly QueuedItem[],
  localEchoes: TimelineState['localEchoes'] = [],
  rowKeys: TimelineState['rowKeys'] = items.map((_, index) => index)
): readonly FoldedRow[] {
  const handles = new Map<number, QueuedRowHandle>()
  const claimed = new Set<number>()
  const pending = new Set<number>()
  for (const echo of localEchoes) {
    if (echo.settled && echo.queuedMsgId === undefined) continue
    const index = rowKeys.indexOf(echo.rowKey)
    if (index === -1 || items[index]?.kind !== 'userText') continue
    if (echo.delivery === 'waiting') pending.add(index)
    const entry = echo.queuedMsgId === undefined
      ? queued.find(q => q.message_id === echo.messageId && !claimed.has(q.queued_msg_id) &&
          !localEchoes.some(other => other.queuedMsgId === q.queued_msg_id))
      : queued.find(q => q.queued_msg_id === echo.queuedMsgId)
    if (entry) {
      claimed.add(entry.queued_msg_id)
      handles.set(index, { queuedMsgId: entry.queued_msg_id, messageId: entry.message_id })
    }
    if (echo.waiting && !echo.settled && (echo.queuedMsgId !== undefined || entry)) pending.add(index)
  }
  const rows = items.map((item, itemIndex) => ({ item, itemIndex, queued: handles.get(itemIndex) ?? null }))
  const projected = rows.filter(row => !pending.has(row.itemIndex))
  projected.push(...rows.filter(row => pending.has(row.itemIndex)))
  for (const entry of queued) {
    if (claimed.has(entry.queued_msg_id)) continue
    projected.push({ item: { kind: 'userText', text: entry.text }, itemIndex: -1,
      queued: { queuedMsgId: entry.queued_msg_id, messageId: entry.message_id } })
  }
  return projected
}
