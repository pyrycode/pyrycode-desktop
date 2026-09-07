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
  clearServerScopedState: ReturnType<typeof vi.fn>
} {
  return {
    unpairServer: vi.fn(async (): Promise<UnpairResult> => ({ result: 'ok' })),
    refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => [SURVIVOR]),
    onLastServerUnpaired: vi.fn(),
    clearServerScopedState: vi.fn(),
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
      onLastServerUnpaired: () => {},
      clearServerScopedState: () => {}
    }
    expect(Object.keys(exhaustive).sort()).toEqual([
      'clearServerScopedState',
      'onLastServerUnpaired',
      'refreshServers',
      'unpairServer'
    ])
  })

  // #1196 — the arm that was missing entirely. Until now this helper reached renderer state through one
  // conditional line, so forgetting one of several servers cleared nothing at all and the departed
  // machine's rows, threads and open chat stayed.
  it('ok with servers remaining → clears exactly the erased server’s state (AC1–AC3)', async () => {
    const d = deps()

    await runUnpairServer(d, 'fake-daemon')

    expect(d.clearServerScopedState).toHaveBeenCalledTimes(1)
    // The ERASED id, not one the call site closed over: the server whose state is dropped is by
    // construction the server this helper just forgot.
    expect(d.clearServerScopedState).toHaveBeenCalledWith('fake-daemon')
  })

  it('the LAST server’s unpair runs the whole-app clear and NOT the scoped one (AC5)', async () => {
    // An `else`, not a second statement. The last-server path is unchanged — `onLastServerUnpaired`
    // reaches `applyPairingChange`'s `unpaired` arm, which drops all thirteen stores — and the two
    // clears can never both fire, so nothing on that path is cleared twice or in a new order.
    const d = deps({ refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => []) })

    await runUnpairServer(d, 'fake-daemon')

    expect(d.onLastServerUnpaired).toHaveBeenCalledTimes(1)
    expect(d.clearServerScopedState).not.toHaveBeenCalled()
  })

  it('clears only AFTER the refresh, so nothing is dropped on a path that never completed', async () => {
    const order: string[] = []
    const d = deps({
      refreshServers: vi.fn(async (): Promise<ServerInfoValue[]> => {
        order.push('refresh')
        return [SURVIVOR]
      }),
      clearServerScopedState: vi.fn(() => order.push('clear'))
    })

    await runUnpairServer(d, 'fake-daemon')

    expect(order).toEqual(['refresh', 'clear'])
  })

  it('neither error arm clears anything — fail-safe extends to the new effect', async () => {
    const refused = deps({
      unpairServer: vi.fn(async (): Promise<UnpairResult> => ({ result: 'error' }))
    })
    const rejected = deps({
      unpairServer: vi.fn(async (): Promise<UnpairResult> => {
        throw new Error('handler absent')
      })
    })

    expect(await runUnpairServer(refused, 'fake-daemon')).toBe('error')
    expect(await runUnpairServer(rejected, 'fake-daemon')).toBe('error')

    expect(refused.clearServerScopedState).not.toHaveBeenCalled()
    expect(rejected.clearServerScopedState).not.toHaveBeenCalled()
  })
})
