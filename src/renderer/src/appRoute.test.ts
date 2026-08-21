import { describe, it, expect } from 'vitest'
import { routeForStatus } from './appRoute'
import type { PairingStatus } from '@shared/ipc/pairingStatus'

// routeForStatus is the pure launch-status→screen mapping (the composerSend/routeForStatus
// precedent): a total function tested here without React, store, or Electron. Its whole job is
// AC2's fail-safe — only a genuine `paired` reaches the conversation screen; every other resolved
// outcome routes to the welcome screen (#662 moved that fallback off the pairing screen, which is
// now reachable only by user action).
describe('routeForStatus', () => {
  it("maps a genuine 'paired' outcome to the conversation screen", () => {
    expect(routeForStatus({ status: 'paired' })).toBe('conversation')
  })

  it("maps 'not-paired' to the welcome screen", () => {
    expect(routeForStatus({ status: 'not-paired' })).toBe('welcome')
  })

  it("maps 'error' to the welcome screen — never masked as never-paired (AC2, ADR 0005)", () => {
    // The fail-safe invariant: an unreadable stored pairing must NOT reach the conversation screen.
    expect(routeForStatus({ status: 'error' })).toBe('welcome')
  })

  it('routes ONLY paired to conversation; every other member fails safe to welcome (AC2)', () => {
    const cases: { status: PairingStatus; expected: 'welcome' | 'conversation' }[] = [
      { status: { status: 'paired' }, expected: 'conversation' },
      { status: { status: 'not-paired' }, expected: 'welcome' },
      { status: { status: 'error' }, expected: 'welcome' }
    ]
    for (const { status, expected } of cases) {
      expect(routeForStatus(status)).toBe(expected)
    }
    // The conversation screen is the destination of exactly one outcome.
    const conversationOutcomes = cases.filter((c) => c.expected === 'conversation')
    expect(conversationOutcomes).toHaveLength(1)
    expect(conversationOutcomes[0].status.status).toBe('paired')
    // #662's new invariant: pairing is no longer a LAUNCH destination at all — it is reached only by
    // user action (the welcome CTA, and the pinned mid-session unpair flip). Non-vacuous against the
    // three-case table above: before this ticket two of those three answers were 'pairing'.
    for (const { status } of cases) {
      expect(routeForStatus(status)).not.toBe('pairing')
    }
  })
})
