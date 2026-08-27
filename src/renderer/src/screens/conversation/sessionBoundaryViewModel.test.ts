import { describe, it, expect } from 'vitest'
import type { ThreadItem } from '../../store/threadTimeline'
import { sessionBoundaryTitle } from './sessionBoundaryViewModel'

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

describe('sessionBoundaryTitle — the reason-driven delimiter label (#690)', () => {
  // Every case asserts with toBe, never toContain: an exact match is the only form that FAILS if a
  // relative time is ever re-appended, which is #690s AC3 in the pure tier.
  it('clear reads as the plain reset (the Figma copy)', () => {
    expect(sessionBoundaryTitle(boundary({ reason: 'clear', workspaceCwd: null }))).toBe(
      'Session reset'
    )
  })

  it('idle_evict names the idle timeout, distinct from an operator-requested reset', () => {
    expect(sessionBoundaryTitle(boundary({ reason: 'idle_evict', workspaceCwd: null }))).toBe(
      'Session reset after idle'
    )
  })

  it('workspace_change carries the path verbatim', () => {
    const title = sessionBoundaryTitle(
      boundary({ reason: 'workspace_change', workspaceCwd: '~/Workspace/Projects/KitchenClaw' })
    )
    expect(title).toBe('Workspace changed to ~/Workspace/Projects/KitchenClaw')
  })

  it('workspace_change with a null cwd degrades to the pathless label, never the literal null', () => {
    const title = sessionBoundaryTitle(
      boundary({ reason: 'workspace_change', workspaceCwd: null })
    )
    expect(title).toBe('Workspace changed')
    expect(title).not.toContain('null')
  })

  it('occurredAt never reaches the copy — an hours-old boundary still reads as the bare label', () => {
    // Under #286 this exact item rendered `New session — 2 hours ago`. The timestamp stays on the
    // ThreadItem (the store owns it); it simply has no reader here any more.
    const twoHoursAgo = new Date(Date.parse('2026-01-15T12:00:00.000Z') - 2 * 3_600_000).toISOString()
    const title = sessionBoundaryTitle(
      boundary({ reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo })
    )
    expect(title).toBe('Session reset')
    expect(title).not.toContain('ago')
    expect(title).not.toContain('—')
  })
})
