import { describe, it, expect } from 'vitest'
import {
  PAIRING_CHANNEL,
  MAX_PASTE_LENGTH,
  MAX_HOST_LABEL_LENGTH,
  isPairingRequest
} from './pairing'

describe('pairing channel', () => {
  it('pins the IPC channel string both process sides depend on', () => {
    // The preload invoker ships on this channel and the main handler registers on it; a drift
    // between the two would break every pairing round-trip. Pin it like the command constant.
    expect(PAIRING_CHANNEL).toBe('pyry:pairing')
  })
})

describe('isPairingRequest', () => {
  it('accepts a submit with a string paste and a bare confirm', () => {
    expect(isPairingRequest({ type: 'submit', paste: 'x' })).toBe(true)
    expect(isPairingRequest({ type: 'confirm' })).toBe(true)
  })

  it('accepts each request carrying an extra harmless field (structural minimum)', () => {
    expect(isPairingRequest({ type: 'submit', paste: 'x', extra: 'ignored' })).toBe(true)
    expect(isPairingRequest({ type: 'confirm', extra: 'ignored' })).toBe(true)
  })

  it('rejects null, undefined, and non-object values', () => {
    expect(isPairingRequest(null)).toBe(false)
    expect(isPairingRequest(undefined)).toBe(false)
    expect(isPairingRequest('submit')).toBe(false)
    expect(isPairingRequest(42)).toBe(false)
  })

  it('rejects a missing, empty, or unknown type', () => {
    expect(isPairingRequest({ paste: 'x' })).toBe(false)
    expect(isPairingRequest({ type: '', paste: 'x' })).toBe(false)
    expect(isPairingRequest({ type: 'connect', paste: 'x' })).toBe(false)
  })

  it('rejects a submit whose paste is not a string (the mandated non-string rejection)', () => {
    expect(isPairingRequest({ type: 'submit', paste: 42 })).toBe(false)
    expect(isPairingRequest({ type: 'submit', paste: undefined })).toBe(false)
    expect(isPairingRequest({ type: 'submit' })).toBe(false)
  })

  it('bounds the paste length: accepts exactly MAX_PASTE_LENGTH, rejects one over', () => {
    expect(isPairingRequest({ type: 'submit', paste: 'a'.repeat(MAX_PASTE_LENGTH) })).toBe(true)
    expect(isPairingRequest({ type: 'submit', paste: 'a'.repeat(MAX_PASTE_LENGTH + 1) })).toBe(false)
  })

  it('accepts a confirm carrying an operator-typed host label (#823)', () => {
    expect(isPairingRequest({ type: 'confirm', label: 'Pyrybox' })).toBe(true)
  })

  it('accepts a confirm whose label is the empty string (a supplied value, not absence)', () => {
    // '' is a value the operator supplied; the host-label store keeps it distinct from never-stored,
    // so the guard must not collapse it into "no label" (erasing the label is #827, not this).
    expect(isPairingRequest({ type: 'confirm', label: '' })).toBe(true)
  })

  it('accepts BOTH an absent label and a PRESENT `label: undefined` (the no-label pairing)', () => {
    // Deliberately asymmetric with submit's `paste: undefined` rejection above: `paste` is required,
    // `label` is optional, and `label?: string` means exactly "absent or undefined". The
    // present-undefined case is reachable, not hypothetical: Electron's IPC uses the structured clone
    // algorithm, which PRESERVES an own property whose value is undefined (unlike JSON.stringify,
    // which drops it), so a renderer building `{ type: 'confirm', label }` with an undefined label
    // delivers a request where `'label' in request` is true.
    expect(isPairingRequest({ type: 'confirm' })).toBe(true)
    expect(isPairingRequest({ type: 'confirm', label: undefined })).toBe(true)
  })

  it('rejects a confirm whose label is not a string', () => {
    expect(isPairingRequest({ type: 'confirm', label: 42 })).toBe(false)
    expect(isPairingRequest({ type: 'confirm', label: null })).toBe(false)
    expect(isPairingRequest({ type: 'confirm', label: { toString: () => 'Pyrybox' } })).toBe(false)
    expect(isPairingRequest({ type: 'confirm', label: ['Pyrybox'] })).toBe(false)
  })

  it('bounds the label length: accepts exactly MAX_HOST_LABEL_LENGTH, rejects one over', () => {
    expect(isPairingRequest({ type: 'confirm', label: 'a'.repeat(MAX_HOST_LABEL_LENGTH) })).toBe(
      true
    )
    expect(
      isPairingRequest({ type: 'confirm', label: 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1) })
    ).toBe(false)
  })
})
