import { describe, it, expect } from 'vitest'
import { NOISE_PROTOCOL, PROTOCOL_VERSION, CAPABILITY_INTERACTIVE } from './types'
import type {
  EnvelopeType,
  DebugBundleChunkPayload,
  DebugBundleDonePayload,
  AssistantDeltaPayload,
  TurnEndPayload,
  TurnStatePayload,
  WireTurnState,
  ToolUsePayload,
  ToolResultPayload,
  WireModalClass,
  WireModalSource,
  WireModalOption,
  ModalShownPayload,
  ModalDismissedPayload,
  ModalAnswerPayload,
  ModalCancelPayload
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

describe('turn-state wire vocabulary (#214)', () => {
  it('admits the turn_state inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const state: EnvelopeType = 'turn_state'
    expect(state).toBe('turn_state')
  })

  it('shapes TurnStatePayload as { conversation_id, state } with state a closed wire enum', () => {
    const payload: TurnStatePayload = { conversation_id: 'conv-1', state: 'thinking' }
    expect(payload).toEqual({ conversation_id: 'conv-1', state: 'thinking' })
  })

  it('admits exactly the three WireTurnState values (mobile field-for-field, no named enum)', () => {
    const states: WireTurnState[] = ['thinking', 'responding', 'idle']
    expect(states).toEqual(['thinking', 'responding', 'idle'])
  })
})

describe('tool-use wire vocabulary (#217)', () => {
  it('admits the tool_use inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const toolUse: EnvelopeType = 'tool_use'
    expect(toolUse).toBe('tool_use')
  })

  it('shapes ToolUsePayload as { conversation_id, turn_id, tool_use_id, name, input_summary } — all strings', () => {
    const payload: ToolUsePayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      name: 'Read',
      input_summary: 'reads /etc/hosts'
    }
    expect(payload).toEqual({
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      name: 'Read',
      input_summary: 'reads /etc/hosts'
    })
  })
})

describe('tool-result wire vocabulary (#229)', () => {
  it('admits the tool_result inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const toolResult: EnvelopeType = 'tool_result'
    expect(toolResult).toBe('tool_result')
  })

  it('shapes ToolResultPayload as { conversation_id, turn_id, tool_use_id, is_error, result_summary } — is_error a boolean', () => {
    const payload: ToolResultPayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      is_error: false,
      result_summary: 'read 12 lines'
    }
    expect(payload).toEqual({
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      is_error: false,
      result_summary: 'read 12 lines'
    })
    // is_error is a boolean whose false is a value (success), not an absence (the yolo #180 idiom).
    const failed: ToolResultPayload = { ...payload, is_error: true }
    expect(failed.is_error).toBe(true)
  })
})

describe('modal wire vocabulary (#201)', () => {
  it('admits the two inbound modal envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const shown: EnvelopeType = 'modal_shown'
    const dismissed: EnvelopeType = 'modal_dismissed'
    expect(shown).toBe('modal_shown')
    expect(dismissed).toBe('modal_dismissed')
  })

  it('admits exactly the two WireModalClass values — no destructive class (ADR 0009)', () => {
    const classes: WireModalClass[] = ['permission', 'trust']
    expect(classes).toEqual(['permission', 'trust'])
  })

  it('admits exactly the three WireModalSource values (closed set)', () => {
    const sources: WireModalSource[] = ['remote', 'local', 'timeout']
    expect(sources).toEqual(['remote', 'local', 'timeout'])
  })

  it('shapes WireModalOption as { id, label } — ordered by array position', () => {
    const option: WireModalOption = { id: 'allow', label: 'Allow' }
    expect(option).toEqual({ id: 'allow', label: 'Allow' })
  })

  it('shapes ModalShownPayload as { modal_id, class, title, prompt, ordered options, default_option_id }', () => {
    const payload: ModalShownPayload = {
      modal_id: 'mdl-7f3a',
      class: 'permission',
      title: 'Allow Bash?',
      prompt: 'claude wants to run: rm -rf build/',
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' }
      ],
      default_option_id: 'deny'
    }
    expect(payload).toEqual({
      modal_id: 'mdl-7f3a',
      class: 'permission',
      title: 'Allow Bash?',
      prompt: 'claude wants to run: rm -rf build/',
      options: [
        { id: 'allow', label: 'Allow' },
        { id: 'deny', label: 'Deny' }
      ],
      default_option_id: 'deny'
    })
    // No conversation_id — modal_id is the sole correlation key (ADR 0009).
    expect(payload).not.toHaveProperty('conversation_id')
  })

  it('shapes ModalDismissedPayload as { modal_id, outcome, source } with source a closed wire enum', () => {
    const payload: ModalDismissedPayload = {
      modal_id: 'mdl-7f3a',
      outcome: 'allow',
      source: 'remote'
    }
    expect(payload).toEqual({ modal_id: 'mdl-7f3a', outcome: 'allow', source: 'remote' })
  })
})

describe('outbound modal wire vocabulary (#235)', () => {
  it('admits the two outbound modal envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const answer: EnvelopeType = 'modal_answer'
    const cancel: EnvelopeType = 'modal_cancel'
    expect(answer).toBe('modal_answer')
    expect(cancel).toBe('modal_cancel')
  })

  it('shapes ModalAnswerPayload as { modal_id, option_id, answer_token } — single option_id', () => {
    const payload: ModalAnswerPayload = {
      modal_id: 'mdl-7f3a',
      option_id: 'allow',
      answer_token: 'tok-9c2e'
    }
    expect(payload).toEqual({
      modal_id: 'mdl-7f3a',
      option_id: 'allow',
      answer_token: 'tok-9c2e'
    })
    // A single option_id — NOT the stale ADR-025 multi-select option_ids[].
    expect(payload).not.toHaveProperty('option_ids')
    // No conversation_id — modal_id is the sole correlation key (ADR 0009).
    expect(payload).not.toHaveProperty('conversation_id')
  })

  it('shapes ModalCancelPayload as { modal_id } — the sole correlation key', () => {
    const payload: ModalCancelPayload = { modal_id: 'mdl-7f3a' }
    expect(payload).toEqual({ modal_id: 'mdl-7f3a' })
    // No conversation_id — modal_id is the sole correlation key (ADR 0009).
    expect(payload).not.toHaveProperty('conversation_id')
  })
})
