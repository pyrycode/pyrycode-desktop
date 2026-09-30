import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/wire/types'
import { partitionArchived, archivedSubtitle, tabCountLabel } from './archiveViewModel'

// The row factory cloned from channelListViewModel.test.ts — only the fields the view-model reads
// (is_archived, is_promoted, archived_at, last_used_at) matter; the rest are opaque filler.
function row(over: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'id',
    name: null,
    is_promoted: false,
    is_archived: false,
    cwd: '/tmp',
    last_message_ts: '2026-01-15T12:00:00.000Z',
    last_used_at: '2026-01-15T12:00:00.000Z',
    workspace_label: null,
    ...over
  }
}

describe('partitionArchived', () => {
  it('drops non-archived rows — only is_archived rows survive', () => {
    const rows = [
      row({ id: 'a', is_archived: true }),
      row({ id: 'live', is_archived: false }),
      row({ id: 'b', is_archived: true })
    ]
    const { channels, discussions } = partitionArchived(rows)
    expect([...channels, ...discussions].map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('splits the archived subset into channels (promoted) and discussions (unpromoted)', () => {
    const rows = [
      row({ id: 'c1', is_archived: true, is_promoted: true }),
      row({ id: 'd1', is_archived: true, is_promoted: false }),
      row({ id: 'live', is_archived: false, is_promoted: true }),
      row({ id: 'c2', is_archived: true, is_promoted: true })
    ]
    const { channels, discussions } = partitionArchived(rows)
    expect(channels.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(discussions.map((r) => r.id)).toEqual(['d1'])
  })

  it('yields both sections empty for an empty input', () => {
    const { channels, discussions } = partitionArchived([])
    expect(channels).toHaveLength(0)
    expect(discussions).toHaveLength(0)
  })

  it('yields an empty discussions list when every archived row is a channel', () => {
    const { channels, discussions } = partitionArchived([
      row({ is_archived: true, is_promoted: true })
    ])
    expect(channels).toHaveLength(1)
    expect(discussions).toHaveLength(0)
  })

  it('yields an empty channels list when every archived row is a discussion', () => {
    const { channels, discussions } = partitionArchived([
      row({ is_archived: true, is_promoted: false })
    ])
    expect(channels).toHaveLength(0)
    expect(discussions).toHaveLength(1)
  })
})

describe('archivedSubtitle', () => {
  const now = Date.parse('2026-01-15T12:00:00.000Z')
  const isoAgo = (msAgo: number): string => new Date(now - msAgo).toISOString()

  it('composes "Archived " + the selected relative time', () => {
    expect(archivedSubtitle(row({ archived_at: isoAgo(50 * 3_600_000) }), now)).toBe('Archived 2 days ago')
  })

  it('does NOT double the "ago" (formatLastActivity already embeds it)', () => {
    const out = archivedSubtitle(row({ archived_at: isoAgo(5 * 60_000) }), now)
    expect(out).toBe('Archived 5m ago')
    expect(out).not.toContain('ago ago')
  })

  it('renders a past-a-week timestamp as "Archived <short date>" with no "ago"', () => {
    // now - 10 days = 2026-01-05 (UTC) → "Jan 5"; the date carries no "ago".
    const out = archivedSubtitle(row({ archived_at: isoAgo(10 * 86_400_000) }), now)
    expect(out).toBe('Archived Jan 5')
    expect(out).not.toContain('ago')
  })

  it('yields a bare "Archived" (no trailing space) for a non-parseable timestamp', () => {
    expect(archivedSubtitle(row({ last_used_at: 'not-a-date' }), now)).toBe('Archived')
    expect(archivedSubtitle(row({ last_used_at: '' }), now)).toBe('Archived')
  })
})

describe('tabCountLabel', () => {
  it('appends the parenthesised live count to the base label', () => {
    expect(tabCountLabel('Channels', 3)).toBe('Channels (3)')
  })

  it('renders a loaded-zero count as "(0)", not a bare label', () => {
    expect(tabCountLabel('Discussions', 0)).toBe('Discussions (0)')
  })

  it('renders a bare label when the count is null (not yet loaded)', () => {
    expect(tabCountLabel('Channels', null)).toBe('Channels')
  })
})


describe('archive order', () => {
  it.each([true, false])('sorts mixed rows across hosts in each tab, promoted=%s, without mutation', (is_promoted) => {
    const rows = [
      { ...row({ id: 'old-stamp', archived_at: '2026-01-01T00:00:00Z', last_used_at: '2026-03-01T00:00:00Z' }), serverId: 'host-a' },
      { ...row({ id: 'absent', last_used_at: '2026-01-04T00:00:00Z' }), serverId: 'host-a' },
      { ...row({ id: 'null', archived_at: null, last_used_at: '2026-01-03T00:00:00Z' }), serverId: 'host-b' },
      { ...row({ id: 'invalid', archived_at: 'bad', last_used_at: '2026-01-02T00:00:00Z' }), serverId: 'host-b' },
      { ...row({ id: 'new-stamp', archived_at: '2026-01-05T00:00:00Z', last_used_at: 'bad' }), serverId: 'host-b' },
      row({ id: 'z-invalid', archived_at: 'bad', last_used_at: 'bad' }),
      row({ id: 'a-invalid', last_used_at: '' })
    ].map((r) => Object.freeze({ ...r, is_promoted, is_archived: true }))
    const before = [...rows]
    Object.freeze(rows)
    const result = partitionArchived(rows)
    expect(result[is_promoted ? 'channels' : 'discussions'].map((r) => r.id)).toEqual([
      'new-stamp', 'absent', 'null', 'invalid', 'old-stamp', 'a-invalid', 'z-invalid'
    ])
    expect(rows).toEqual(before)
    expect(result[is_promoted ? 'discussions' : 'channels']).toEqual([])
  })

  it('ties equivalent offset instants by UTF-16 id, keeping fully equal rows stable', () => {
    const first = row({ id: 'same', name: 'first', is_archived: true, archived_at: '2026-01-01T12:00:00Z' })
    const second = { ...first, name: 'second', archived_at: '2026-01-01T14:00:00+02:00' }
    const rows = [
      row({ id: '\uE000', is_archived: true, archived_at: '2026-01-01T07:00:00-05:00' }),
      second, row({ id: '😀', is_archived: true, archived_at: first.archived_at }), first
    ]
    expect(partitionArchived(rows).discussions).toEqual([second, first, rows[2], rows[0]])
  })

  it.each(['2026-01-15', 'January 15, 2026', '2026-01-15T12:00:00', '2026-02-30T00:00:00Z', '2026-01-15 12:00:00Z'])('does not select non-RFC3339 archive stamp %s', (archived_at) => {
    expect(archivedSubtitle(row({ archived_at, last_used_at: '2026-01-01T00:00:00Z' }), Date.parse('2026-01-15T12:00:00Z'))).toBe('Archived Jan 1')
  })
})


it('orders distinct sub-millisecond RFC3339 instants before applying id ties', () => {
  const older = row({ id: 'a', is_archived: true, archived_at: '2026-01-01T12:00:00.000000001Z' })
  const newer = row({ id: 'z', is_archived: true, archived_at: '2026-01-01T14:00:00.000000002+02:00' })
  expect(partitionArchived([older, newer]).discussions).toEqual([newer, older])
})


it('ties a parsed legacy format with an RFC3339 instant at the same millisecond', () => {
  const stamped = row({ id: 'z', is_archived: true, archived_at: '2026-01-01T12:00:00.001Z' })
  const legacy = row({ id: 'a', is_archived: true, last_used_at: '2026-01-01T12:00:00.001+0000' })
  expect(partitionArchived([stamped, legacy]).discussions).toEqual([legacy, stamped])
})
