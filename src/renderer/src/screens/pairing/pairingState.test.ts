import { describe, it, expect, vi } from 'vitest'
import {
  initialPairingState,
  pairingReducer,
  runSubmit,
  runConfirm,
  groupFingerprint,
  type PairingBridge,
  type PairingState
} from './pairingState'

const FINGERPRINT = 'aa:bb:cc:dd:ee:ff:11:22'

describe('pairingReducer', () => {
  it('starts editing with an empty paste and no error', () => {
    expect(initialPairingState).toEqual({ phase: 'editing', paste: '', error: null })
  })

  it('paste-changed updates the paste and clears any prior error', () => {
    const errored: PairingState = { phase: 'editing', paste: 'old', error: 'invalid-paste' }
    expect(pairingReducer(errored, { type: 'paste-changed', paste: 'pyry://x' })).toEqual({
      phase: 'editing',
      paste: 'pyry://x',
      error: null
    })
  })

  it('editing + submit → submitting, preserving the paste', () => {
    const editing: PairingState = { phase: 'editing', paste: 'pyry://x', error: null }
    expect(pairingReducer(editing, { type: 'submit' })).toEqual({
      phase: 'submitting',
      paste: 'pyry://x'
    })
  })

  it('submitting + submit-succeeded → reviewing, carrying the fingerprint', () => {
    const submitting: PairingState = { phase: 'submitting', paste: 'pyry://x' }
    expect(
      pairingReducer(submitting, { type: 'submit-succeeded', fingerprint: FINGERPRINT })
    ).toEqual({ phase: 'reviewing', paste: 'pyry://x', fingerprint: FINGERPRINT })
  })

  it('submitting + submit-failed → editing with the reason and the paste preserved', () => {
    const submitting: PairingState = { phase: 'submitting', paste: 'pyry://x' }
    expect(pairingReducer(submitting, { type: 'submit-failed', reason: 'invalid-paste' })).toEqual({
      phase: 'editing',
      paste: 'pyry://x',
      error: 'invalid-paste'
    })
  })

  it('reviewing + confirm → confirming', () => {
    const reviewing: PairingState = { phase: 'reviewing', paste: 'pyry://x', fingerprint: FINGERPRINT }
    expect(pairingReducer(reviewing, { type: 'confirm' })).toEqual({
      phase: 'confirming',
      paste: 'pyry://x',
      fingerprint: FINGERPRINT
    })
  })

  it('confirming + confirm-succeeded → paired', () => {
    const confirming: PairingState = {
      phase: 'confirming',
      paste: 'pyry://x',
      fingerprint: FINGERPRINT
    }
    expect(pairingReducer(confirming, { type: 'confirm-succeeded' })).toEqual({ phase: 'paired' })
  })

  it('confirming + confirm-failed → editing with the paste preserved (fresh submit needed)', () => {
    const confirming: PairingState = {
      phase: 'confirming',
      paste: 'pyry://x',
      fingerprint: FINGERPRINT
    }
    expect(
      pairingReducer(confirming, { type: 'confirm-failed', reason: 'persist-failed' })
    ).toEqual({ phase: 'editing', paste: 'pyry://x', error: 'persist-failed' })
  })

  it('cancel from reviewing → initial editing state, discarding the paste', () => {
    const reviewing: PairingState = { phase: 'reviewing', paste: 'pyry://x', fingerprint: FINGERPRINT }
    expect(pairingReducer(reviewing, { type: 'cancel' })).toEqual(initialPairingState)
  })

  it('cancel from editing → initial editing state, discarding the paste', () => {
    const editing: PairingState = { phase: 'editing', paste: 'pyry://x', error: 'invalid-key' }
    expect(pairingReducer(editing, { type: 'cancel' })).toEqual(initialPairingState)
  })

  it('leaves state unchanged for an out-of-phase event (confirm while editing)', () => {
    const editing: PairingState = { phase: 'editing', paste: 'pyry://x', error: null }
    expect(pairingReducer(editing, { type: 'confirm' })).toBe(editing)
  })
})

describe('runSubmit', () => {
  it('calls submitPairingPaste once with the paste (submit invokes the IPC)', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn().mockResolvedValue({ ok: true, fingerprint: FINGERPRINT }),
      confirmPairing: vi.fn()
    }
    await runSubmit(bridge, 'pyry://x')
    expect(bridge.submitPairingPaste).toHaveBeenCalledTimes(1)
    expect(bridge.submitPairingPaste).toHaveBeenCalledWith('pyry://x')
  })

  it('maps an ok response to submit-succeeded carrying the fingerprint', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn().mockResolvedValue({ ok: true, fingerprint: FINGERPRINT }),
      confirmPairing: vi.fn()
    }
    expect(await runSubmit(bridge, 'pyry://x')).toEqual({
      type: 'submit-succeeded',
      fingerprint: FINGERPRINT
    })
  })

  it('maps a not-ok response to submit-failed carrying the reason', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn().mockResolvedValue({ ok: false, reason: 'invalid-paste' }),
      confirmPairing: vi.fn()
    }
    expect(await runSubmit(bridge, 'bad')).toEqual({ type: 'submit-failed', reason: 'invalid-paste' })
  })

  it('resolves (never rejects) to submit-failed when the invoke rejects', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn().mockRejectedValue(new Error('boom')),
      confirmPairing: vi.fn()
    }
    // toEqual against the exact literal: nothing from the caught error (message, stack, cause)
    // and no `paste` may ride along into renderer state.
    expect(await runSubmit(bridge, 'pyry://x')).toEqual({
      type: 'submit-failed',
      reason: 'malformed-request'
    })
  })

  it('resolves to submit-failed when the invoke throws synchronously', async () => {
    // Pins the `try` around the CALL, not just the `await` — hoisting the call out fails here.
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(() => {
        throw new Error('sync')
      }),
      confirmPairing: vi.fn()
    }
    expect(await runSubmit(bridge, 'pyry://x')).toEqual({
      type: 'submit-failed',
      reason: 'malformed-request'
    })
  })
})

describe('runConfirm', () => {
  it('calls confirmPairing once (confirm triggers persist)', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(),
      confirmPairing: vi.fn().mockResolvedValue({ ok: true })
    }
    await runConfirm(bridge)
    expect(bridge.confirmPairing).toHaveBeenCalledTimes(1)
  })

  it('maps an ok response to confirm-succeeded', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(),
      confirmPairing: vi.fn().mockResolvedValue({ ok: true })
    }
    expect(await runConfirm(bridge)).toEqual({ type: 'confirm-succeeded' })
  })

  it('maps a not-ok response to confirm-failed carrying the reason', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(),
      confirmPairing: vi.fn().mockResolvedValue({ ok: false, reason: 'no-pending-pairing' })
    }
    expect(await runConfirm(bridge)).toEqual({ type: 'confirm-failed', reason: 'no-pending-pairing' })
  })

  it('resolves (never rejects) to confirm-failed when the invoke rejects', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(),
      confirmPairing: vi.fn().mockRejectedValue(new Error('boom'))
    }
    expect(await runConfirm(bridge)).toEqual({
      type: 'confirm-failed',
      reason: 'malformed-request'
    })
  })
})

describe('groupFingerprint', () => {
  it('splits the 23-char fingerprint into 8 verbatim two-char groups', () => {
    const groups = groupFingerprint(FINGERPRINT)
    expect(groups).toEqual(['aa', 'bb', 'cc', 'dd', 'ee', 'ff', '11', '22'])
  })

  it('round-trips: joining the groups on ":" reproduces the input byte-for-byte', () => {
    expect(groupFingerprint(FINGERPRINT).join(':')).toBe(FINGERPRINT)
  })
})
