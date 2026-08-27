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

  // The host label (#825) is typed on the paste phase but sent two phases later, on confirm, so it
  // rides the phase union exactly as `paste` does rather than living in a component-local useState —
  // which is also what makes `cancel` discard both in one already-tested move.
  it('label-changed sets the label, preserving the paste AND any existing error', () => {
    const errored: PairingState = { phase: 'editing', paste: 'pyry://x', error: 'invalid-paste' }
    expect(pairingReducer(errored, { type: 'label-changed', label: 'Pyrybox' })).toEqual({
      phase: 'editing',
      paste: 'pyry://x',
      label: 'Pyrybox',
      error: 'invalid-paste'
    })
  })

  // The deliberate asymmetry with `paste-changed`, which DOES clear the error: editing the pairing
  // code invalidates the complaint about that code, while typing a host name says nothing about it.
  // Wiping the operator's only feedback on an unrelated keystroke would be a regression.
  it('label-changed does NOT clear the error the way paste-changed does', () => {
    const errored: PairingState = { phase: 'editing', paste: 'bad', error: 'invalid-key' }
    const next = pairingReducer(errored, { type: 'label-changed', label: 'x' })
    expect(next.phase === 'editing' && next.error).toBe('invalid-key')
  })

  it('label-changed outside editing is a no-op returning the identical state', () => {
    const submitting: PairingState = { phase: 'submitting', paste: 'pyry://x' }
    expect(pairingReducer(submitting, { type: 'label-changed', label: 'Pyrybox' })).toBe(submitting)
  })

  it('submit carries the label forward alongside the paste', () => {
    const editing: PairingState = {
      phase: 'editing',
      paste: 'pyry://x',
      label: 'Pyrybox',
      error: null
    }
    expect(pairingReducer(editing, { type: 'submit' })).toEqual({
      phase: 'submitting',
      paste: 'pyry://x',
      label: 'Pyrybox'
    })
  })

  it('submit-succeeded carries the label into reviewing', () => {
    const submitting: PairingState = { phase: 'submitting', paste: 'pyry://x', label: 'Pyrybox' }
    expect(
      pairingReducer(submitting, { type: 'submit-succeeded', fingerprint: FINGERPRINT })
    ).toEqual({
      phase: 'reviewing',
      paste: 'pyry://x',
      label: 'Pyrybox',
      fingerprint: FINGERPRINT
    })
  })

  it('confirm carries the label into confirming', () => {
    const reviewing: PairingState = {
      phase: 'reviewing',
      paste: 'pyry://x',
      label: 'Pyrybox',
      fingerprint: FINGERPRINT
    }
    expect(pairingReducer(reviewing, { type: 'confirm' })).toEqual({
      phase: 'confirming',
      paste: 'pyry://x',
      label: 'Pyrybox',
      fingerprint: FINGERPRINT
    })
  })

  it('submit-failed returns to editing with both the paste and the label intact', () => {
    const submitting: PairingState = { phase: 'submitting', paste: 'pyry://x', label: 'Pyrybox' }
    expect(pairingReducer(submitting, { type: 'submit-failed', reason: 'invalid-paste' })).toEqual({
      phase: 'editing',
      paste: 'pyry://x',
      label: 'Pyrybox',
      error: 'invalid-paste'
    })
  })

  // A persist-failed retry is a FRESH submit (see the confirm-failed rationale above), so the
  // operator must not have to retype the name they already gave the host.
  it('confirm-failed returns to editing with both the paste and the label intact', () => {
    const confirming: PairingState = {
      phase: 'confirming',
      paste: 'pyry://x',
      label: 'Pyrybox',
      fingerprint: FINGERPRINT
    }
    expect(pairingReducer(confirming, { type: 'confirm-failed', reason: 'persist-failed' })).toEqual(
      { phase: 'editing', paste: 'pyry://x', label: 'Pyrybox', error: 'persist-failed' }
    )
  })

  // AC4. The key must be ABSENT, not merely falsy: `initialPairingState` is what the field reads
  // back through `state.label ?? ''`, and a lingering '' would be indistinguishable at the render
  // tier but a different value at the confirm boundary.
  it('cancel discards the typed label along with the paste, leaving no label key at all', () => {
    const reviewing: PairingState = {
      phase: 'reviewing',
      paste: 'pyry://x',
      label: 'Pyrybox',
      fingerprint: FINGERPRINT
    }
    const next = pairingReducer(reviewing, { type: 'cancel' })
    expect(next).toEqual(initialPairingState)
    expect(Object.keys(next)).not.toContain('label')
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

  // AC1 — the label rides the confirm TRIMMED of surrounding whitespace. Trimming can only shorten,
  // so a value that passed the field's MAX_HOST_LABEL_LENGTH bound cannot exceed the guard's.
  it('sends the label trimmed of surrounding whitespace', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(),
      confirmPairing: vi.fn().mockResolvedValue({ ok: true })
    }
    await runConfirm(bridge, '  Pyrybox  ')
    expect(bridge.confirmPairing).toHaveBeenCalledTimes(1)
    expect(bridge.confirmPairing).toHaveBeenCalledWith('Pyrybox')
  })

  // AC2 — an empty or whitespace-only label is NO LABEL AT ALL, not an empty string. The argument is
  // asserted explicitly: `toHaveBeenCalledTimes(1)` alone would pass for `''`, and the preload omits
  // the key only for `undefined` (index.ts:70), which is what makes the property structural. Main
  // saves the label verbatim whenever it is present, `''` included (pairingHandler.ts:101-128), so
  // this collapse has to happen HERE.
  it.each([
    ['an empty string', ''],
    ['spaces only', '   '],
    ['tabs and newlines only', '\t\n'],
    ['an absent label', undefined]
  ])('sends no label at all for %s', async (_name, label) => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(),
      confirmPairing: vi.fn().mockResolvedValue({ ok: true })
    }
    await runConfirm(bridge, label)
    expect(bridge.confirmPairing).toHaveBeenCalledWith(undefined)
  })

  it('called with no second argument at all still passes undefined through', async () => {
    const bridge: PairingBridge = {
      submitPairingPaste: vi.fn(),
      confirmPairing: vi.fn().mockResolvedValue({ ok: true })
    }
    await runConfirm(bridge)
    expect(bridge.confirmPairing).toHaveBeenCalledWith(undefined)
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
