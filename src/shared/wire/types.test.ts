import { describe, it, expect } from 'vitest'
import { NOISE_PROTOCOL, PROTOCOL_VERSION, CAPABILITY_INTERACTIVE } from './types'
import type {
  EnvelopeType,
  DebugBundleChunkPayload,
  DebugBundleDonePayload,
  AssistantDeltaPayload,
  TurnEndPayload
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

describe('structured-stream wire vocabulary (#199)', () => {
  it('admits the two interactive-stream inbound envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const delta: EnvelopeType = 'assistant_delta'
    const end: EnvelopeType = 'turn_end'
    expect(delta).toBe('assistant_delta')
    expect(end).toBe('turn_end')
  })

  it('shapes AssistantDeltaPayload as { conversation_id, turn_id, seq, text } (mobile field-for-field)', () => {
    const payload: AssistantDeltaPayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      seq: 0,
      text: 'hello'
    }
    expect(payload).toEqual({ conversation_id: 'conv-1', turn_id: 'turn-1', seq: 0, text: 'hello' })
  })

  it('shapes TurnEndPayload as { conversation_id, turn_id, stop_reason }', () => {
    const payload: TurnEndPayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      stop_reason: 'end_turn'
    }
    expect(payload).toEqual({ conversation_id: 'conv-1', turn_id: 'turn-1', stop_reason: 'end_turn' })
  })
})
