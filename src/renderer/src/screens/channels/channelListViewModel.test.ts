import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/wire/types'
import {
  UNNAMED_LABEL,
  titleFor,
  partitionByPromotion,
  partitionActive,
  formatLastActivity
} from './channelListViewModel'

// A minimal row factory — only the fields the view-model reads matter; the rest are opaque filler.
function row(over: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'id',
    name: null,
    is_promoted: false,
    is_archived: false,
    cwd: '/tmp',
    last_message_ts: '2026-01-15T12:00:00.000Z',
    last_used_at: '2026-01-15T12:00:00.000Z',
    ...over
  }
}

describe('titleFor', () => {
  it('returns a present, non-blank name verbatim', () => {
    expect(titleFor('kitchenclaw refactor')).toBe('kitchenclaw refactor')
  })

  it('falls back to the unnamed label for null (AC3: never a blank row)', () => {
    expect(titleFor(null)).toBe(UNNAMED_LABEL)
  })

  it('falls back to the unnamed label for empty and whitespace-only names', () => {
    expect(titleFor('')).toBe(UNNAMED_LABEL)
    expect(titleFor('   ')).toBe(UNNAMED_LABEL)
  })
})

describe('partitionByPromotion', () => {
  it('splits promoted into channels and unpromoted into discussions', () => {
    const rows = [
      row({ id: 'c1', is_promoted: true }),
      row({ id: 'd1', is_promoted: false }),
      row({ id: 'c2', is_promoted: true }),
      row({ id: 'd2', is_promoted: false })
    ]
    const { channels, discussions } = partitionByPromotion(rows)
    expect(channels.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(discussions.map((r) => r.id)).toEqual(['d1', 'd2'])
  })

  it('preserves the store array order within each section (no re-sort)', () => {
    const rows = [
      row({ id: 'c-late', is_promoted: true }),
      row({ id: 'c-early', is_promoted: true })
    ]
    const { channels } = partitionByPromotion(rows)
    // Order is the daemon's; the view must not re-sort.
    expect(channels.map((r) => r.id)).toEqual(['c-late', 'c-early'])
  })

  it('yields an empty discussions list when every row is promoted', () => {
    const { channels, discussions } = partitionByPromotion([row({ is_promoted: true })])
    expect(channels).toHaveLength(1)
    expect(discussions).toHaveLength(0)
  })

  it('yields an empty channels list when every row is unpromoted', () => {
    const { channels, discussions } = partitionByPromotion([row({ is_promoted: false })])
    expect(channels).toHaveLength(0)
    expect(discussions).toHaveLength(1)
  })
})

// The exact dual of archiveViewModel.partitionArchived: the active list keeps only non-archived rows.
describe('partitionActive', () => {
  it('drops archived rows — only non-archived rows survive across both sections (#469)', () => {
    const rows = [
      row({ id: 'live', is_archived: false }),
      row({ id: 'gone', is_archived: true }),
      row({ id: 'live2', is_archived: false })
    ]
    const { channels, discussions } = partitionActive(rows)
    expect([...channels, ...discussions].map((r) => r.id).sort()).toEqual(['live', 'live2'])
  })

  it('splits the non-archived subset into channels (promoted) / discussions (unpromoted)', () => {
    const rows = [
      row({ id: 'c1', is_archived: false, is_promoted: true }),
      row({ id: 'd1', is_archived: false, is_promoted: false }),
      // An archived promoted row must NOT leak into channels.
      row({ id: 'archived-channel', is_archived: true, is_promoted: true }),
      row({ id: 'c2', is_archived: false, is_promoted: true })
    ]
    const { channels, discussions } = partitionActive(rows)
    expect(channels.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(discussions.map((r) => r.id)).toEqual(['d1'])
  })

  it('preserves the store array order within each section (no re-sort)', () => {
    const rows = [
      row({ id: 'c-late', is_archived: false, is_promoted: true }),
      row({ id: 'c-early', is_archived: false, is_promoted: true })
    ]
    const { channels } = partitionActive(rows)
    expect(channels.map((r) => r.id)).toEqual(['c-late', 'c-early'])
  })

  it('yields both sections empty when every row is archived', () => {
    const { channels, discussions } = partitionActive([
      row({ id: 'a', is_archived: true, is_promoted: true }),
      row({ id: 'b', is_archived: true, is_promoted: false })
    ])
    expect(channels).toHaveLength(0)
    expect(discussions).toHaveLength(0)
  })
})

describe('formatLastActivity', () => {
  // A fixed injected `now` keeps the buckets deterministic (no Date.now() inside the function).
  const now = Date.parse('2026-01-15T12:00:00.000Z')
  const isoAgo = (msAgo: number): string => new Date(now - msAgo).toISOString()

  it("clamps sub-minute deltas to 'just now'", () => {
    expect(formatLastActivity(isoAgo(0), now)).toBe('just now')
    expect(formatLastActivity(isoAgo(30_000), now)).toBe('just now')
  })

  it('formats minutes and hours', () => {
    expect(formatLastActivity(isoAgo(5 * 60_000), now)).toBe('5m ago')
    expect(formatLastActivity(isoAgo(3 * 3_600_000), now)).toBe('3h ago')
  })

  it("formats the 24-48h window as 'Yesterday'", () => {
    expect(formatLastActivity(isoAgo(30 * 3_600_000), now)).toBe('Yesterday')
  })

  it("formats the 2-6 day window as 'N days ago'", () => {
    expect(formatLastActivity(isoAgo(50 * 3_600_000), now)).toBe('2 days ago')
    expect(formatLastActivity(isoAgo(6 * 86_400_000), now)).toBe('6 days ago')
  })

  it('formats older-than-a-week as a stable, timezone-independent date', () => {
    // now - 10 days = 2026-01-05 (UTC). The exact rendering is the developer's choice; the test
    // asserts only a stable, non-empty substring that does not depend on the runner's timezone.
    const out = formatLastActivity(isoAgo(10 * 86_400_000), now)
    expect(out).not.toBe('')
    expect(out).toContain('Jan')
  })

  it("returns '' for a malformed / non-parseable timestamp (row renders title only)", () => {
    expect(formatLastActivity('not-a-date', now)).toBe('')
    expect(formatLastActivity('', now)).toBe('')
  })

  it("clamps a future timestamp (clock skew) to 'just now', never a negative delta", () => {
    expect(formatLastActivity(isoAgo(-60_000), now)).toBe('just now')
  })
})
