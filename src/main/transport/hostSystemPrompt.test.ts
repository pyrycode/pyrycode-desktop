import { describe, it, expect } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'
import { isRendererCommand } from '../../shared/ipc/commands'
import { MAX_SYSTEM_PROMPT_BYTES } from '../../shared/wire/types'

const decode = (payload: unknown) => parseInboundMessage(encodeEnvelope({
  id: 10, type: 'host_system_prompt', ts: '2026-10-05T00:00:00Z', in_reply_to: 4, payload
}))

describe('host prompt contract', () => {
  it('preserves empty/current/default text and strips extras', () => {
    expect(decode({ system_prompt: '', default_system_prompt: ' Default\n ', conversation_id: 'ignored' }))
      .toEqual({ kind: 'host-system-prompt', hostSystemPrompt: { system_prompt: '', default_system_prompt: ' Default\n ' }, inReplyTo: 4 })
  })
  it('refuses missing, null and mistyped strings without quoting content', () => {
    for (const payload of [null, {}, { system_prompt: null, default_system_prompt: '' },
      { system_prompt: 'secret', default_system_prompt: 3 }]) {
      expect(() => decode(payload)).toThrow(/host system prompt/)
      try { decode(payload) } catch (e) { expect(String(e)).not.toContain('secret') }
    }
  })
  it('bounds both reply fields in UTF-8 inclusively', () => {
    const exact = 'é'.repeat(MAX_SYSTEM_PROMPT_BYTES / 2)
    expect(() => decode({ system_prompt: exact, default_system_prompt: exact })).not.toThrow()
    for (const key of ['system_prompt', 'default_system_prompt']) {
      expect(() => decode({ system_prompt: '', default_system_prompt: '', [key]: exact + 'é' })).toThrow()
    }
  })
  it('requires explicit host, bounded correlation and string write; empty clears', () => {
    const read = { type: 'requestHostSystemPrompt', serverId: 'host-b', requestId: 'open-1' }
    expect(isRendererCommand(read)).toBe(true)
    for (const serverId of [undefined, '', null, 3]) expect(isRendererCommand({ ...read, serverId })).toBe(false)
    for (const requestId of [undefined, '', 'a'.repeat(129)]) expect(isRendererCommand({ ...read, requestId })).toBe(false)
    const write = { ...read, type: 'setHostSystemPrompt', payload: { system_prompt: '' } }
    expect(isRendererCommand(write)).toBe(true)
    for (const system_prompt of [undefined, null, false]) {
      expect(isRendererCommand({ ...write, payload: { system_prompt } })).toBe(false)
    }
  })
})
