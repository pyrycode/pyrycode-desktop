import { describe, it, expect } from 'vitest'
import { NOISE_PROTOCOL, PROTOCOL_VERSION, CAPABILITY_INTERACTIVE } from './types'

describe('wire protocol constants', () => {
  it('pins the Noise variant to the daemon contract', () => {
    expect(NOISE_PROTOCOL).toBe('Noise_IK_25519_ChaChaPoly_BLAKE2s')
  })

  it('defaults to protocol v2', () => {
    expect(PROTOCOL_VERSION).toBe('v2')
  })

  it('advertises the interactive capability', () => {
    expect(CAPABILITY_INTERACTIVE).toBe('interactive')
  })
})
