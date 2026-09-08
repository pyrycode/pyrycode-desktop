import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/wire/types'
import { partitionArchived, archivedSubtitle, tabCountLabel } from './archiveViewModel'

// The row factory cloned from channelListViewModel.test.ts — only the fields the view-model reads
// (is_archived, is_promoted, last_message_ts) matter; the rest are opaque filler.
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

  it('preserves the store array order within each section (no re-sort)', () => {
    const rows = [
      row({ id: 'c-late', is_archived: true, is_promoted: true }),
      row({ id: 'c-early', is_archived: true, is_promoted: true })
    ]
    const { channels } = partitionArchived(rows)
    expect(channels.map((r) => r.id)).toEqual(['c-late', 'c-early'])
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

  it('composes "Archived " + the relative last-activity time', () => {
    expect(archivedSubtitle(isoAgo(50 * 3_600_000), now)).toBe('Archived 2 days ago')
  })

  it('does NOT double the "ago" (formatLastActivity already embeds it)', () => {
    const out = archivedSubtitle(isoAgo(5 * 60_000), now)
    expect(out).toBe('Archived 5m ago')
    expect(out).not.toContain('ago ago')
  })

  it('renders a past-a-week timestamp as "Archived <short date>" with no "ago"', () => {
    // now - 10 days = 2026-01-05 (UTC) → "Jan 5"; the date carries no "ago".
    const out = archivedSubtitle(isoAgo(10 * 86_400_000), now)
    expect(out).toBe('Archived Jan 5')
    expect(out).not.toContain('ago')
  })

  it('yields a bare "Archived" (no trailing space) for a non-parseable timestamp', () => {
    expect(archivedSubtitle('not-a-date', now)).toBe('Archived')
    expect(archivedSubtitle('', now)).toBe('Archived')
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
