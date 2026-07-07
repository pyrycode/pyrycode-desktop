import { describe, it, expect } from 'vitest'
import { routeForStatus } from './appRoute'
import type { PairingStatus } from '@shared/ipc/pairingStatus'

// routeForStatus is the pure launch-status→screen mapping (the composerSend/routeForStatus
// precedent): a total function tested here without React, store, or Electron. Its whole job is
// AC2's fail-safe — only a genuine `paired` reaches the conversation screen; every other resolved
// outcome routes to the pairing screen.
describe('routeForStatus', () => {
  it("maps a genuine 'paired' outcome to the conversation screen", () => {
    expect(routeForStatus({ status: 'paired' })).toBe('conversation')
  })

  it("maps 'not-paired' to the pairing screen", () => {
    expect(routeForStatus({ status: 'not-paired' })).toBe('pairing')
  })

  it("maps 'error' to the pairing screen — never masked as never-paired (AC2, ADR 0005)", () => {
    // The fail-safe invariant: an unreadable stored pairing must NOT reach the conversation screen.
    expect(routeForStatus({ status: 'error' })).toBe('pairing')
  })

  it('routes ONLY paired to conversation; every other member fails safe to pairing (AC2)', () => {
    const cases: { status: PairingStatus; expected: 'pairing' | 'conversation' }[] = [
      { status: { status: 'paired' }, expected: 'conversation' },
      { status: { status: 'not-paired' }, expected: 'pairing' },
      { status: { status: 'error' }, expected: 'pairing' }
    ]
    for (const { status, expected } of cases) {
      expect(routeForStatus(status)).toBe(expected)
    }
    // The conversation screen is the destination of exactly one outcome.
    const conversationOutcomes = cases.filter((c) => c.expected === 'conversation')
    expect(conversationOutcomes).toHaveLength(1)
    expect(conversationOutcomes[0].status.status).toBe('paired')
  })
})
