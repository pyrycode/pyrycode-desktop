import { describe, it, expect } from 'vitest'
import { buildRecentWorkspaces } from './recentWorkspacesEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildListConversations: (id, ts) → serialized recent_workspaces bytes,
// no clock/counter/side-effects. recent_workspaces is a BARE control frame (empty payload), so there
// is no caller-supplied payload. It uses the REAL codec so the assertion pins actual wire bytes,
// exactly like listConversationsEnvelope.test.ts.
describe('buildRecentWorkspaces', () => {
  const FIXED_TS = '2026-07-14T12:00:00.000Z'

  it('round-trips to a bare recent_workspaces envelope carrying the exact id and ts', () => {
    const bytes = buildRecentWorkspaces({ id: 2, ts: FIXED_TS })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('recent_workspaces')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Present-but-empty payload: `{}` proves decodeEnvelope did not throw on an absent payload
    // (the "no payload" requirement is a present-but-empty value on the desktop side, never `null`).
    expect(envelope.payload).toEqual({})
  })
})
