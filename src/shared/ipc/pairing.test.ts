import { describe, it, expect } from 'vitest'
import { PAIRING_CHANNEL, MAX_PASTE_LENGTH, isPairingRequest } from './pairing'

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
})
