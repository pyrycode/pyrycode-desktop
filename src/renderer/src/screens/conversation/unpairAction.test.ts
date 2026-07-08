import { describe, it, expect, vi } from 'vitest'
import { runUnpair } from './unpairAction'
import type { SessionAction } from '../../store/sessionStore'
import type { UnpairResult } from '@shared/ipc/unpair'

// runUnpair is a pure, React-free helper (the composerSend precedent): its three effects — the
// unpair invoke, the store dispatch, and the App route flip — are injected, so it is exercised here
// with plain spies. No React, no store, no Electron bridge, no DOM. The confirm-phase glue in the
// container is trivial useState (untested, like Composer's `text`); the branch logic lives here.

describe('runUnpair', () => {
  it('ok → dispatches exactly one reset, calls onUnpaired once, resolves ok', async () => {
    const dispatch = vi.fn()
    const onUnpaired = vi.fn()
    const unpair = vi.fn(async (): Promise<UnpairResult> => ({ result: 'ok' }))

    const outcome = await runUnpair({ unpair, dispatch, onUnpaired })

    expect(outcome).toBe('ok')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'reset' })
    expect(onUnpaired).toHaveBeenCalledTimes(1)
  })

  it('ok → resets the store BEFORE flipping the route (reset-then-onUnpaired order)', async () => {
    const order: string[] = []
    const dispatch = vi.fn(() => void order.push('reset'))
    const onUnpaired = vi.fn(() => void order.push('onUnpaired'))
    const unpair = vi.fn(async (): Promise<UnpairResult> => ({ result: 'ok' }))

    await runUnpair({ unpair, dispatch, onUnpaired })

    // Reset before the flip so neither the pairing screen nor an immediate relaunch sees stale state.
    expect(order).toEqual(['reset', 'onUnpaired'])
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
