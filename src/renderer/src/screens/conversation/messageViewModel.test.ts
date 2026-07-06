import { describe, it, expect } from 'vitest'
import type { MessagePayload } from '@shared/wire/types'
import { toMessageViewModel } from './messageViewModel'

// Fixtures — plain wire-shaped data, mirroring sessionStore.test.ts. The adapter is
// framework-free, so no store or React is involved here.
function payload(role: MessagePayload['role']): MessagePayload {
  return { conversation_id: 'conv-1', message_id: 'm1', role, text: 'hello there' }
}

describe('toMessageViewModel', () => {
  it("maps role 'assistant' → type 'daemon'", () => {
    expect(toMessageViewModel(payload('assistant')).type).toBe('daemon')
  })

  it("maps role 'user' → type 'user'", () => {
    expect(toMessageViewModel(payload('user')).type).toBe('user')
  })

  it('maps message_id → id and carries text through unchanged', () => {
    const vm = toMessageViewModel(payload('assistant'))
    expect(vm.id).toBe('m1')
    expect(vm.text).toBe('hello there')
  })

  it('drops conversation_id — the view model has exactly id, type, text', () => {
    const vm = toMessageViewModel(payload('user'))
    expect(Object.keys(vm).sort()).toEqual(['id', 'text', 'type'])
    expect('conversation_id' in vm).toBe(false)
  })
})
