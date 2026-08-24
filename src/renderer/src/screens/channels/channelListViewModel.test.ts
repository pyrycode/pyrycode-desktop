import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/wire/types'
import {
  UNNAMED_LABEL,
  UNKNOWN_WORKSPACE_LABEL,
  titleFor,
  partitionByPromotion,
  partitionActive,
  workspaceLabelFor,
  groupByWorkspace,
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

// #703: `cwd` is untrusted daemon text used as an opaque grouping key and a display label — never a
// filesystem argument. The function must be TOTAL over `string` (no throw path, since a thrown error
// would carry the offending cwd into an error boundary) and must never blank a label.
describe('workspaceLabelFor', () => {
  it('returns the last path segment, not the full path (AC2)', () => {
    expect(workspaceLabelFor('/home/me/pyrycode')).toBe('pyrycode')
  })

  it('skips a trailing separator, repeated separators and a whitespace-only tail segment', () => {
    expect(workspaceLabelFor('/home/me/pyrycode/')).toBe('pyrycode')
    expect(workspaceLabelFor('/home/me/pyrycode//')).toBe('pyrycode')
    expect(workspaceLabelFor('/home/me/  ')).toBe('me')
  })

  it('returns a relative single-segment cwd verbatim', () => {
    expect(workspaceLabelFor('pyrycode')).toBe('pyrycode')
  })

  it('survives an unfamiliar separator convention without throwing or blanking', () => {
    // `\` is deliberately NOT a separator: treating it as one would be an assumption about the daemon's
    // host OS, and it would corrupt a legal Unix directory whose name contains a backslash. With no `/`
    // present the whole value is its own single segment — survived, not silently reinterpreted. This
    // row pins today's behaviour so a future Windows-daemon change is visible rather than silent.
    expect(workspaceLabelFor('C:\\Users\\me\\proj')).toBe('C:\\Users\\me\\proj')
  })

  it('returns null when there is no usable segment at all (AC3)', () => {
    expect(workspaceLabelFor('')).toBeNull()
    expect(workspaceLabelFor('   ')).toBeNull()
    expect(workspaceLabelFor('/')).toBeNull()
    expect(workspaceLabelFor('//')).toBeNull()
  })

  it('does no parsing of its own — a markup-shaped segment comes back as an ordinary string', () => {
    expect(workspaceLabelFor('/home/<script>alert(1)')).toBe('<script>alert(1)')
  })
})

describe('groupByWorkspace', () => {
  it('groups rows with an identical cwd into one group, in array order (AC1, AC4)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/home/me/alpha' }),
      row({ id: 'b', cwd: '/home/me/alpha' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('alpha')
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('normalises nothing — two spellings of one directory stay two groups (AC1)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '/home/me/alpha' }),
      row({ id: 'b', cwd: '/home/me/alpha/' })
    ])
    expect(groups.map((g) => g.key)).toEqual(['/home/me/alpha', '/home/me/alpha/'])
    // Same label on both: the honest surface the ticket asks for, not a silent merge.
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'alpha'])
  })

  it('orders groups by first appearance and keeps interleaved rows in array order (AC4)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a1', cwd: '/w/alpha' }),
      row({ id: 'b1', cwd: '/w/beta' }),
      row({ id: 'a2', cwd: '/w/alpha' })
    ])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'beta'])
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(groups[1].rows.map((r) => r.id)).toEqual(['b1'])
  })

  it('keeps first-appearance order for an integer-like cwd (AC4 — a Map, not a plain object)', () => {
    // A plain-object accumulator enumerates integer-like string keys FIRST, in numeric order, whatever
    // the insertion order — so `'2'` would jump ahead of `'/x'`. `cwd` is arbitrary untrusted text, so a
    // relative cwd of `'2'` is a legal key. This is the test that makes "no sort anywhere" real.
    const groups = groupByWorkspace([row({ id: 'a', cwd: '/x' }), row({ id: 'b', cwd: '2' })])
    expect(groups.map((g) => g.label)).toEqual(['x', '2'])
  })

  it('collapses every unusable cwd into ONE clearly-labelled fallback group (AC3)', () => {
    const groups = groupByWorkspace([
      row({ id: 'a', cwd: '' }),
      row({ id: 'b', cwd: '   ' }),
      row({ id: 'c', cwd: '/' })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe(UNKNOWN_WORKSPACE_LABEL)
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('orders the fallback group by first appearance too, never pinned last (AC4)', () => {
    const groups = groupByWorkspace([row({ id: 'a', cwd: '/' }), row({ id: 'b', cwd: '/w/beta' })])
    expect(groups.map((g) => g.label)).toEqual([UNKNOWN_WORKSPACE_LABEL, 'beta'])
  })

  it('never folds a real workspace named like the fallback into the fallback group (AC3)', () => {
    // The grouping key is the cwd itself, never a comparison against the fallback COPY — deriving it by
    // comparing labels would swallow a real directory literally named "Unknown workspace".
    const groups = groupByWorkspace([
      row({ id: 'real', cwd: UNKNOWN_WORKSPACE_LABEL }),
      row({ id: 'unusable', cwd: '/' })
    ])
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['real'], ['unusable']])
    // Both render the same label — the #716 display ambiguity — but they stay distinct groups.
    expect(groups.map((g) => g.label)).toEqual([UNKNOWN_WORKSPACE_LABEL, UNKNOWN_WORKSPACE_LABEL])
  })

  it('returns an empty array for empty input', () => {
    expect(groupByWorkspace([])).toEqual([])
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
