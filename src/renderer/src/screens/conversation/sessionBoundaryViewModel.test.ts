import { describe, it, expect } from 'vitest'
import type { ThreadItem } from '../../store/threadTimeline'
import { formatSessionBoundaryTime, sessionBoundaryTitle } from './sessionBoundaryViewModel'

type SessionBoundaryItem = Extract<ThreadItem, { kind: 'sessionBoundary' }>

// A minimal sessionBoundary item factory — only the three render fields the view-model reads.
function boundary(over: Partial<SessionBoundaryItem>): SessionBoundaryItem {
  return {
    kind: 'sessionBoundary',
    reason: 'workspace_change',
    workspaceCwd: '/home/user/project',
    occurredAt: '2026-01-15T12:00:00.000Z',
    ...over
  }
}

describe('formatSessionBoundaryTime — the long-form relative time', () => {
  // A fixed injected `now` keeps the buckets deterministic (never Date.now() inside the function).
  const now = Date.parse('2026-01-15T12:00:00.000Z')
  const isoAgo = (msAgo: number): string => new Date(now - msAgo).toISOString()

  it("clamps sub-minute deltas to 'just now'", () => {
    expect(formatSessionBoundaryTime(isoAgo(0), now)).toBe('just now')
    expect(formatSessionBoundaryTime(isoAgo(30_000), now)).toBe('just now')
  })

  it('spells minutes out in long form, singular at one', () => {
    expect(formatSessionBoundaryTime(isoAgo(60_000), now)).toBe('1 minute ago')
    expect(formatSessionBoundaryTime(isoAgo(5 * 60_000), now)).toBe('5 minutes ago')
  })

  it('spells hours out in long form, singular at one (the Figma copy is the hours bucket)', () => {
    expect(formatSessionBoundaryTime(isoAgo(3_600_000), now)).toBe('1 hour ago')
    expect(formatSessionBoundaryTime(isoAgo(2 * 3_600_000), now)).toBe('2 hours ago')
  })

  it("formats the 24-48h window as 'Yesterday'", () => {
    expect(formatSessionBoundaryTime(isoAgo(30 * 3_600_000), now)).toBe('Yesterday')
  })

  it("formats the 2-6 day window as 'N days ago'", () => {
    expect(formatSessionBoundaryTime(isoAgo(50 * 3_600_000), now)).toBe('2 days ago')
    expect(formatSessionBoundaryTime(isoAgo(6 * 86_400_000), now)).toBe('6 days ago')
  })

  it('formats older-than-a-week as a stable, timezone-independent date', () => {
    // now - 10 days = 2026-01-05 (UTC). Assert only a stable, TZ-independent substring.
    const out = formatSessionBoundaryTime(isoAgo(10 * 86_400_000), now)
    expect(out).not.toBe('')
    expect(out).toContain('Jan')
  })

  it("returns '' for a malformed / empty timestamp (title then renders label only)", () => {
    expect(formatSessionBoundaryTime('not-a-date', now)).toBe('')
    expect(formatSessionBoundaryTime('', now)).toBe('')
  })

  it("clamps a future timestamp (clock skew) to 'just now', never a negative delta", () => {
    expect(formatSessionBoundaryTime(isoAgo(-60_000), now)).toBe('just now')
  })
})

describe('sessionBoundaryTitle — reason-driven title over the long-form time', () => {
  const now = Date.parse('2026-01-15T12:00:00.000Z')
  const twoHoursAgo = new Date(now - 2 * 3_600_000).toISOString()

  it('workspace_change carries the path verbatim, then the time after an em dash (Figma 16-36)', () => {
    const title = sessionBoundaryTitle(
      boundary({ reason: 'workspace_change', workspaceCwd: '~/Workspace/Projects/KitchenClaw', occurredAt: twoHoursAgo }),
      now
    )
    expect(title).toBe('Workspace changed to ~/Workspace/Projects/KitchenClaw — 2 hours ago')
  })

  it('workspace_change with a null cwd degrades to the pathless label, never the literal null', () => {
    const title = sessionBoundaryTitle(
      boundary({ reason: 'workspace_change', workspaceCwd: null, occurredAt: twoHoursAgo }),
      now
    )
    expect(title).toBe('Workspace changed — 2 hours ago')
    expect(title).not.toContain('null')
  })

  it('clear renders the provisional pathless label', () => {
    const title = sessionBoundaryTitle(
      boundary({ reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo }),
      now
    )
    expect(title).toBe('New session — 2 hours ago')
  })

  it('idle_evict renders the provisional pathless label', () => {
    const title = sessionBoundaryTitle(
      boundary({ reason: 'idle_evict', workspaceCwd: null, occurredAt: twoHoursAgo }),
      now
    )
    expect(title).toBe('New session after idle — 2 hours ago')
  })

  it('drops the separator (and the time) when occurredAt is unparseable — label only', () => {
    const title = sessionBoundaryTitle(
      boundary({ reason: 'clear', workspaceCwd: null, occurredAt: 'not-a-date' }),
      now
    )
    expect(title).toBe('New session')
    expect(title).not.toContain('—')
  })
})
