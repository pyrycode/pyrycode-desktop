import { describe, it, expect, vi } from 'vitest'
import { runUnpairServer, type UnpairServerDeps } from './unpairServerAction'
import type { UnpairResult } from '@shared/ipc/unpair'
import type { ServerInfoValue } from '../../store/serverInfoStore'

// runUnpairServer is a pure, React-free helper (the runUnpair / composerSend precedent): its three
// effects — the per-server unpair invoke, the server-info refresh, and the App route flip — are
// injected, so it is exercised here with plain spies. No React, no store, no Electron bridge, no DOM.
// The per-row confirm phase in ServerRowControl is trivial useState glue; the branch logic lives here.

const SURVIVOR: ServerInfoValue = { serverId: 'pyrybox-2', relayUrl: 'wss://second-relay.example' }

/** Build the deps with plain spies, so each test names only the arm it varies. */
function deps(
  overrides: Partial<UnpairServerDeps> = {}
): UnpairServerDeps & {
  unpairServer: ReturnType<typeof vi.fn>
  refreshServers: ReturnType<typeof vi.fn>
  onLastServerUnpaired: ReturnType<typeof vi.fn>
} {
  return {
    unpairServer: vi.fn(async (): Promise<UnpairResult> => ({ result: 'ok' })),
    refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => [SURVIVOR]),
    onLastServerUnpaired: vi.fn(),
    ...overrides
  } as never
}

describe('runUnpairServer', () => {
  it('erases exactly the named server, once (AC1)', async () => {
    const d = deps()

    await runUnpairServer(d, 'fake-daemon')

    expect(d.unpairServer).toHaveBeenCalledTimes(1)
    expect(d.unpairServer).toHaveBeenCalledWith('fake-daemon')
  })

  it('ok with servers remaining → refreshes the list, does NOT flip the route (AC3)', async () => {
    const d = deps()

    const outcome = await runUnpairServer(d, 'fake-daemon')

    expect(outcome).toBe('ok')
    // The refresh is what makes the departed row leave — nothing mutates the list locally.
    expect(d.refreshServers).toHaveBeenCalledTimes(1)
    // A non-empty refreshed list means records remain, so the app stays in the paired shell and
    // nothing is cleared. This is the assertion the whole slice exists for: the flip stopped being
    // unconditional.
    expect(d.onLastServerUnpaired).not.toHaveBeenCalled()
  })

  it('ok with an empty refreshed list → flips the route exactly once (AC4)', async () => {
    const d = deps({ refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => []) })

    const outcome = await runUnpairServer(d, 'fake-daemon')

    expect(outcome).toBe('ok')
    expect(d.onLastServerUnpaired).toHaveBeenCalledTimes(1)
  })

  it('refreshes BEFORE deciding, so the count that routes is the post-erase one', async () => {
    const order: string[] = []
    const d = deps({
      refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => {
        order.push('refresh')
        return []
      }),
      onLastServerUnpaired: vi.fn(() => order.push('flip'))
    })

    await runUnpairServer(d, 'fake-daemon')

    expect(order).toEqual(['refresh', 'flip'])
  })

  it('result:error → no refresh, no flip, resolves error', async () => {
    const d = deps({
      unpairServer: vi.fn(async (): Promise<UnpairResult> => ({ result: 'error' }))
    })

    const outcome = await runUnpairServer(d, 'fake-daemon')

    expect(outcome).toBe('error')
    // Fail-safe by construction, inherited from runUnpair: nothing downstream of the erase runs on a
    // non-ok outcome, so a refused or failed erase can never leave the list — or the route — claiming
    // a server was forgotten while its record may still sit on disk.
    expect(d.refreshServers).not.toHaveBeenCalled()
    expect(d.onLastServerUnpaired).not.toHaveBeenCalled()
  })

  it('a rejected unpairServer() invoke is coerced to the error path — does not throw', async () => {
    const d = deps({
      unpairServer: vi.fn(async (): Promise<UnpairResult> => {
        throw new Error('handler absent')
      })
    })

    const outcome = await runUnpairServer(d, 'fake-daemon')

    expect(outcome).toBe('error')
    expect(d.refreshServers).not.toHaveBeenCalled()
    expect(d.onLastServerUnpaired).not.toHaveBeenCalled()
  })

  it('carries no session-store write on ANY path', async () => {
    // The failure-path constraint, pinned as a fact about the interface rather than about a branch:
    // one server's failed erase must not put the whole app into a `failed` session status while the
    // OTHER server is connected and its conversation is fine. runUnpair dispatches
    // UNPAIR_FAILED_ERROR into the one app-wide sessionStore; this helper deliberately has no
    // dispatch dep at all, so there is no name here by which such a write could be reached.
    //
    // The type annotation is the detector: adding a `dispatch` member to UnpairServerDeps makes this
    // exhaustive object literal a compile error (excess-property checking runs the other way, so the
    // pin is the missing-member error a widened interface would raise on the *production* wiring —
    // and this literal is what forces the interface to be re-read when that happens).
    const exhaustive: UnpairServerDeps = {
      unpairServer: async () => ({ result: 'error' }),
      refreshServers: async () => [],
      onLastServerUnpaired: () => {}
    }
    expect(Object.keys(exhaustive).sort()).toEqual([
      'onLastServerUnpaired',
      'refreshServers',
      'unpairServer'
    ])
  })
})
