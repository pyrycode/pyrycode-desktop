import { describe, expect, it } from 'vitest'
import type { QueuedItem } from '@shared/wire/types'
import type { ThreadItem } from '../../store/threadTimeline'
import { foldQueuedRows as projectQueuedRows } from './foldQueuedRows'

// These fixtures explicitly represent local echoes. Received rows use an empty inventory.
const foldQueuedRows = (items: readonly ThreadItem[], queued: readonly QueuedItem[]) => projectQueuedRows(
  items, queued, items.flatMap((item, rowKey) => item.kind === 'userText' && item.messageId
    ? [{ rowKey, messageId: item.messageId, waiting: false }] : []))

// #1214: the correlation contract between the timeline's optimistic echoes and the daemon's replacement-
// truth backlog. A pure function of two lists, so every branch is provable here and nothing about it needs
// a DOM — the render fork it feeds is asserted from markup in ConversationScreen.test.tsx.

const echo = (text: string, messageId?: string): ThreadItem => ({
  kind: 'userText',
  text,
  ...(messageId === undefined ? {} : { messageId })
})

const assistant = (text: string): ThreadItem => ({ kind: 'assistantText', turnId: 't1', text })

const queued = (queued_msg_id: number, text: string, message_id?: string): QueuedItem => ({
  queued_msg_id,
  text,
  ts: '2026-09-07T00:00:00Z',
  ...(message_id === undefined ? {} : { message_id })
})

describe('foldQueuedRows — one row per message (#1214)', () => {
  it('returns the timeline unchanged, every row delivered, against an empty backlog', () => {
    const items = [echo('sent', 'm1'), assistant('reply')]
    const rows = foldQueuedRows(items, [])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.item)).toEqual(items)
    expect(rows.every((r) => r.queued === null)).toBe(true)
  })

  it('marks the echo whose messageId the backlog names, and only it (AC1)', () => {
    const rows = foldQueuedRows(
      [echo('ran', 'm1'), echo('waiting', 'm2')],
      [queued(7, 'waiting', 'm2')]
    )
    // One row per message: the backlog contributes NO extra row when it correlates.
    expect(rows).toHaveLength(2)
    expect(rows[0].queued).toBeNull()
    expect(rows[1].queued).toEqual({ queuedMsgId: 7, messageId: 'm2' })
  })

  it('keeps a marked row at its own index when timeline rows follow it (AC3)', () => {
    // The queued row must not jump to the tail just because the daemon is still holding it.
    const rows = foldQueuedRows(
      [echo('waiting', 'm1'), assistant('a reply that landed after'), echo('later', 'm2')],
      [queued(7, 'waiting', 'm1')]
    )
    expect(rows).toHaveLength(3)
    expect(rows[0].queued).not.toBeNull()
    expect(rows[1].item.kind).toBe('assistantText')
    expect(rows[2].queued).toBeNull()
  })

  it('keeps two identical texts with distinct ids as two distinct rows (AC4)', () => {
    // Correlation is by message_id, never by text: the SECOND echo is the one the backlog names.
    const rows = foldQueuedRows(
      [echo('same words', 'm1'), echo('same words', 'm2')],
      [queued(7, 'same words', 'm2')]
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].queued).toBeNull()
    expect(rows[1].queued).toEqual({ queuedMsgId: 7, messageId: 'm2' })
  })

  it('attributes each of two identical texts queued back to back to its own row (AC4)', () => {
    const rows = foldQueuedRows(
      [echo('same words', 'm1'), echo('same words', 'm2')],
      [queued(7, 'same words', 'm1'), queued(8, 'same words', 'm2')]
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].queued).toEqual({ queuedMsgId: 7, messageId: 'm1' })
    expect(rows[1].queued).toEqual({ queuedMsgId: 8, messageId: 'm2' })
  })

  it('leaves the second correctly attributed when the first of that pair is dropped (AC4)', () => {
    // The drop takes the first echo out (#1213's dropUserText) and the daemon's next snapshot omits it.
    const rows = foldQueuedRows([echo('same words', 'm2')], [queued(8, 'same words', 'm2')])
    expect(rows).toHaveLength(1)
    expect(rows[0].queued).toEqual({ queuedMsgId: 8, messageId: 'm2' })
  })

  it('draws its own tail row for a queued item matching no echo in this window (AC4)', () => {
    const rows = foldQueuedRows([echo('mine', 'm1')], [queued(9, 'from another device', 'zz')])
    expect(rows).toHaveLength(2)
    // The delivered echo is untouched and stays first…
    expect(rows[0].item).toEqual(echo('mine', 'm1'))
    expect(rows[0].queued).toBeNull()
    // …and the unmatched item becomes a synthesized userText row carrying its text and nothing else.
    expect(rows[1].item).toEqual({ kind: 'userText', text: 'from another device' })
    expect(rows[1].queued).toEqual({ queuedMsgId: 9, messageId: 'zz' })
  })

  it('keeps several unmatched items in snapshot order at the tail (AC1)', () => {
    const rows = foldQueuedRows(
      [assistant('reply')],
      [queued(9, 'first queued', 'x'), queued(10, 'second queued', 'y')]
    )
    expect(rows.map((r) => r.queued?.queuedMsgId ?? null)).toEqual([null, 9, 10])
  })

  it('correlates nothing for an absent or empty message_id on the backlog item', () => {
    // The empty-id rule's first appearance in THIS path: '' is a legal value that names no message.
    const rows = foldQueuedRows(
      [echo('sent', 'm1'), echo('also sent', '')],
      [queued(7, 'no id at all'), queued(8, 'empty id', '')]
    )
    expect(rows).toHaveLength(4)
    expect(rows[0].queued).toBeNull()
    expect(rows[1].queued).toBeNull()
    expect(rows[2].queued).toEqual({ queuedMsgId: 7, messageId: undefined })
    expect(rows[3].queued).toEqual({ queuedMsgId: 8, messageId: '' })
  })

  it('never marks an echo that carries no messageId, including against an empty backlog id', () => {
    const rows = foldQueuedRows([echo('backfilled')], [queued(7, 'backfilled', '')])
    expect(rows[0].queued).toBeNull()
    expect(rows[1].item).toEqual({ kind: 'userText', text: 'backfilled' })
  })

  it('never marks a row that is not a userText echo', () => {
    // messageId lives on the userText arm alone, so this is typed rather than filtered — pinned so a
    // future widening of the field is a deliberate change and not an accident.
    const rows = foldQueuedRows(
      [assistant('daemon said this'), { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }],
      [queued(7, 'daemon said this', 'm1')]
    )
    expect(rows[0].queued).toBeNull()
    expect(rows[1].queued).toBeNull()
    expect(rows[2].queued).toEqual({ queuedMsgId: 7, messageId: 'm1' })
  })

  it('claims first-come and leaves the duplicate unmatched when two items share one id', () => {
    const rows = foldQueuedRows([echo('once', 'm1')], [queued(7, 'once', 'm1'), queued(8, 'once', 'm1')])
    expect(rows).toHaveLength(2)
    expect(rows[0].queued).toEqual({ queuedMsgId: 7, messageId: 'm1' })
    expect(rows[1].item).toEqual({ kind: 'userText', text: 'once' })
    expect(rows[1].queued).toEqual({ queuedMsgId: 8, messageId: 'm1' })
  })

  it('carries the matched item through by reference, with no field rewritten', () => {
    // The fold marks; it never edits. attachments/createdAt must survive onto the queued form.
    const item: ThreadItem = {
      kind: 'userText',
      text: 'with a file',
      messageId: 'm1',
      createdAt: 1757203200000,
      attachments: [{ attachmentId: 'a1', filename: 'notes.txt' }]
    }
    const rows = foldQueuedRows([item], [queued(7, 'with a file', 'm1')])
    expect(rows[0].item).toBe(item)
  })

  it('returns no rows at all when both inputs are empty (the empty-thread branch)', () => {
    expect(foldQueuedRows([], [])).toEqual([])
  })

  it('returns rows for a backlog with no timeline at all — never the empty thread', () => {
    // A reconnect into another device's backlog, or a conversation opened fresh in this window.
    const rows = foldQueuedRows([], [queued(9, 'somebody else queued this', 'zz')])
    expect(rows).toHaveLength(1)
    expect(rows[0].queued).toEqual({ queuedMsgId: 9, messageId: 'zz' })
  })
})
