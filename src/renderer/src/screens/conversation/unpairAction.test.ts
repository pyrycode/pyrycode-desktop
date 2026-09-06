import { describe, it, expect, vi } from 'vitest'
import { runUnpair } from './unpairAction'
import type { SessionAction } from '../../store/sessionStore'
import type { UnpairResult } from '@shared/ipc/unpair'

// runUnpair is a pure, React-free helper (the composerSend precedent): its three effects — the
// unpair invoke, the store dispatch, and the App route flip — are injected, so it is exercised here
// with plain spies. No React, no store, no Electron bridge, no DOM. The confirm-phase glue in the
// container is trivial useState (untested, like Composer's `text`); the branch logic lives here.

describe('runUnpair', () => {
  it('ok → dispatches nothing, calls onUnpaired once, resolves ok', async () => {
    const dispatch = vi.fn()
    const onUnpaired = vi.fn()
    const unpair = vi.fn(async (): Promise<UnpairResult> => ({ result: 'ok' }))

    const outcome = await runUnpair({ unpair, dispatch, onUnpaired })

    expect(outcome).toBe('ok')
    // #531: the session reset is NOT dispatched here any more. It moved into the shared
    // clearPairingScopedState, which PairedShell runs on the unpair path so the whole pairing-scoped
    // set is enumerated in one place. Leaving a second reset here would be runtime-harmless (the arm
    // is idempotent by reference) but would put one member of that set outside the interface the
    // thirteen-key pin checks — a store with two owners, one of them invisible to the test that
    // exists to enumerate them. #531 argued this from a second consequence too, that a later reader
    // deleting the helper's session reset because "runUnpair already does it" would silently break
    // the pair-another path; #1141 retired that half by taking the clear off the pair-another path
    // altogether (adding a server ends no pairing). This assertion pins the single owner on the
    // ground that survives.
    expect(dispatch).not.toHaveBeenCalled()
    expect(onUnpaired).toHaveBeenCalledTimes(1)
  })

  it('error → dispatches one failed (error.code "unpair"), never flips the route, resolves error', async () => {
    const dispatch = vi.fn()
    const onUnpaired = vi.fn()
    const unpair = vi.fn(async (): Promise<UnpairResult> => ({ result: 'error' }))

    const outcome = await runUnpair({ unpair, dispatch, onUnpaired })

    expect(outcome).toBe('error')
    expect(onUnpaired).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    const action = dispatch.mock.calls[0][0] as SessionAction
    expect(action.type).toBe('failed')
    if (action.type === 'failed') {
      expect(action.error.code).toBe('unpair')
    }
  })

  it('a rejected unpair() invoke is coerced to the error path — does not throw', async () => {
    const dispatch = vi.fn()
    const onUnpaired = vi.fn()
    const unpair = vi.fn(async (): Promise<UnpairResult> => {
      throw new Error('handler absent')
    })

    const outcome = await runUnpair({ unpair, dispatch, onUnpaired })

    expect(outcome).toBe('error')
    expect(onUnpaired).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect((dispatch.mock.calls[0][0] as SessionAction).type).toBe('failed')
  })
})
