import { describe, it, expect } from 'vitest'
import { NOISE_PROTOCOL, PROTOCOL_VERSION, CAPABILITY_INTERACTIVE } from './types'
import type {
  EnvelopeType,
  DebugBundleChunkPayload,
  DebugBundleDonePayload
} from './types'

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

describe('debug-bundle wire vocabulary (#116)', () => {
  it('admits the two streamed bundle envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const chunk: EnvelopeType = 'debug_bundle_chunk'
    const done: EnvelopeType = 'debug_bundle_done'
    expect(chunk).toBe('debug_bundle_chunk')
    expect(done).toBe('debug_bundle_done')
  })

  it('shapes DebugBundleChunkPayload as { seq, data } — data is base64-std on the wire', () => {
    // Mirrors the daemon golden fixture testdata/debug_bundle_chunk.json field-for-field.
    const payload: DebugBundleChunkPayload = { seq: 0, data: 'aGVsbG8sIGJ1bmRsZQ==' }
    expect(payload.seq).toBe(0)
    expect(payload.data).toBe('aGVsbG8sIGJ1bmRsZQ==')
  })

  it('shapes DebugBundleDonePayload as { total }', () => {
    const payload: DebugBundleDonePayload = { total: 4 }
    expect(payload.total).toBe(4)
  })
})
