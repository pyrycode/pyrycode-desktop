import { describe, expect, it } from 'vitest'
import {
  decideCapabilityGate,
  readDaemonCapabilities,
  type CapabilityReadFailure
} from './daemonCapabilityGate'
import { startFakeRoutingRelay } from '../../src/main/transport/fakeRoutingRelay'

// Unit cover for #933's skip decision. This is the only part of the capability gate that CAN be
// unit-tested: nothing in this repo can assert on its own Playwright skip, and the probe that
// produces the `CapabilityRead` is an effectful edge over the real wasm plus a real socket (the
// noiseKeyPairGenerator.ts precedent — an effectful edge is proven by the integration path, not by
// vitest). Keeping the decision pure is what makes the fixture thin wiring.
//
// It is a `.test.ts` under e2e/ deliberately: the function belongs beside the fixture that calls
// it, and the suffix is what keeps the two runners apart (vitest.config.ts's `include` /
// playwright.config.ts's `testMatch`).

const requireQuestion = ['question'] as const

describe('decideCapabilityGate', () => {
  // AC1 — a spec that declares no capabilities is gated exactly as it was before this ticket: on
  // the `pyry` binary alone. That has to hold for a FAILED read too, because the fixture only
  // short-circuits the dial as an optimisation; the invariant belongs in the decision itself.
  it('never skips when nothing is required, even when the read failed', () => {
    expect(decideCapabilityGate([], { ok: false, cause: 'timeout' })).toEqual({ skip: false })
  })

  it('never skips when nothing is required and the daemon advertises nothing', () => {
    expect(decideCapabilityGate([], { ok: true, capabilities: [] })).toEqual({ skip: false })
  })

  // AC5's client half: against a pyrycode#2020-inclusive daemon the question spec must NOT skip.
  it('does not skip when every required capability is advertised', () => {
    const decision = decideCapabilityGate(requireQuestion, {
      ok: true,
      capabilities: ['interactive', 'question']
    })
    expect(decision).toEqual({ skip: false })
  })

  // AC2 — a stale daemon. The reason has to be actionable in the way the credential skip's
  // `security find-generic-password …` line is: name the capability, name the DAEMON as the stale
  // thing (not the spec), and give the rebuild-and-install command.
  it('skips naming the missing capability, the stale daemon, and how to rebuild it', () => {
    const decision = decideCapabilityGate(requireQuestion, {
      ok: true,
      capabilities: ['interactive']
    })
    expect(decision.skip).toBe(true)
    const reason = decision.skip ? decision.reason : ''
    expect(reason).toContain('question')
    expect(reason).toContain('stale')
    expect(reason).toContain('go build -o ~/.local/bin/pyry ./cmd/pyry')
    expect(reason).toContain('PYRY_BIN')
  })

  // parseHelloAck maps an ABSENT `capabilities` key to [] on purpose (the daemon marshals it
  // omitempty), so a pre-#2020 daemon and one advertising nothing are the same value here. Both are
  // "missing" — that is correct, not a bug to distinguish.
  it('skips when the daemon advertises nothing at all', () => {
    expect(decideCapabilityGate(requireQuestion, { ok: true, capabilities: [] }).skip).toBe(true)
  })

  it('names every missing capability, not just the first', () => {
    const decision = decideCapabilityGate(['question', 'attachments'], {
      ok: true,
      capabilities: ['interactive']
    })
    expect(decision.skip).toBe(true)
    const reason = decision.skip ? decision.reason : ''
    expect(reason).toContain('question')
    expect(reason).toContain('attachments')
  })

  // AC3 — fail closed. Every way the read can fail to complete ends as a skip naming that cause,
  // never as a failure.
  const causes: CapabilityReadFailure[] = ['handshake-failed', 'malformed-ack', 'timeout']
  for (const cause of causes) {
    it(`skips naming the cause when the read fails with ${cause}`, () => {
      const decision = decideCapabilityGate(requireQuestion, { ok: false, cause })
      expect(decision.skip).toBe(true)
      const reason = decision.skip ? decision.reason : ''
      expect(reason).toContain(cause)
      expect(reason).toContain('question')
      expect(reason).toContain('go build -o ~/.local/bin/pyry ./cmd/pyry')
    })
  }

  // AC4, and the direct proof of the provenance rule in the plan's security review: the reason is
  // built from client-owned constants and from `required` ONLY. `capabilities` comes off the wire,
  // and ZeroExecutedGate prints this string verbatim into the operator's (salvaged) run log, so no
  // daemon-typed byte may reach it. Computing the missing set as a filter over `capabilities`
  // instead of over `required` is the mistake this catches.
  it('never echoes a daemon-supplied capability string into the reason', () => {
    const hostile = 'interactive[2Jtoken=SUPER-SECRET'
    const decision = decideCapabilityGate(requireQuestion, {
      ok: true,
      capabilities: [hostile, 'also-not-mine']
    })
    expect(decision.skip).toBe(true)
    const reason = decision.skip ? decision.reason : ''
    expect(reason).not.toContain(hostile)
    expect(reason).not.toContain('SUPER-SECRET')
    expect(reason).not.toContain('also-not-mine')
    expect(reason).toContain('question')
  })
})

// The two halves of AC3 that are reachable WITHOUT a real daemon: the read must fail closed and must
// not hang. Both run fully in-process (the fake routing relay is in-process, and the wasm loads under
// vitest exactly as it does in noiseSession.test.ts), so they cost a fraction of a second and need no
// real stack. The live half — a genuine handshake against a running daemon — stays an operator
// observation under `npm run e2e:real:gate`, the convention every real-stack claim here follows.
describe('readDaemonCapabilities (fail-closed edges)', () => {
  // Any 32 raw bytes: neither of these cases ever reaches a key agreement.
  const VALID_SHAPED_SERVER_KEY = Buffer.alloc(32, 7).toString('base64')

  it('resolves timeout, never hangs, when no daemon is on the relay server leg', async () => {
    const relay = await startFakeRoutingRelay()
    try {
      const read = await readDaemonCapabilities({
        relayUrl: relay.url,
        pairFields: {
          server: 'test',
          token: 'not-a-real-token',
          server_static_pubkey: VALID_SHAPED_SERVER_KEY
        },
        advertise: ['question'],
        attemptTimeoutMs: 150,
        deadlineMs: 300
      })
      // The relay silently DROPS a client frame while no server leg is registered, so the probe's
      // hello never reaches a daemon and nothing ever replies — the exact shape of a run against a
      // relay whose daemon has not registered yet. It must end as a bounded `timeout`, not a hang.
      expect(read).toEqual({ ok: false, cause: 'timeout' })
      expect(decideCapabilityGate(['question'], read).skip).toBe(true)
    } finally {
      await relay.close()
    }
  })

  it('resolves handshake-failed, without dialling, on an undecodable server static pubkey', async () => {
    const read = await readDaemonCapabilities({
      relayUrl: 'ws://127.0.0.1:1',
      pairFields: { server: 'test', token: 'not-a-real-token', server_static_pubkey: 'too-short' },
      advertise: ['question'],
      attemptTimeoutMs: 150,
      deadlineMs: 300
    })
    expect(read).toEqual({ ok: false, cause: 'handshake-failed' })
  })
})
