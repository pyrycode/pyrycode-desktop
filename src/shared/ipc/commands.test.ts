import { describe, it, expect } from 'vitest'
import {
  COMMAND_CHANNEL,
  isRendererCommand,
  sendMessageCommand,
  type RendererCommand
} from './commands'
import type { SendMessagePayload } from '../wire/types'

describe('command channel', () => {
  it('pins the IPC channel string both process sides depend on', () => {
    // The preload sender ships on this channel and the main receiver listens on it; a drift
    // between the two would silently drop every command. Pin it like the event constant.
    expect(COMMAND_CHANNEL).toBe('pyry:command')
  })
})

describe('sendMessageCommand', () => {
  it('wraps a SendMessagePayload into a sendMessage command, fields unchanged', () => {
    const fields: SendMessagePayload = {
      conversation_id: 'c1',
      message_id: 'm1',
      text: 'hello'
    }

    const command = sendMessageCommand(fields)

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'sendMessage', payload: fields })
    expect(command.payload).toBe(fields) // verbatim pass-through, no field remap
  })
})

describe('isRendererCommand', () => {
  it('accepts a well-formed send-message command, including one from the constructor', () => {
    const command: RendererCommand = sendMessageCommand({
      conversation_id: 'c1',
      message_id: 'm1',
      text: 'hi'
    })

    expect(isRendererCommand(command)).toBe(true)
  })

  it('accepts a command carrying an extra harmless field (structural minimum)', () => {
    const command = {
      type: 'sendMessage',
      payload: { conversation_id: 'c1', message_id: 'm1', text: 'hi' },
      extra: 'ignored'
    }

    expect(isRendererCommand(command)).toBe(true)
  })

  it('rejects null, undefined, and non-object values', () => {
    expect(isRendererCommand(null)).toBe(false)
    expect(isRendererCommand(undefined)).toBe(false)
    expect(isRendererCommand('sendMessage')).toBe(false)
    expect(isRendererCommand(42)).toBe(false)
  })

  it('rejects a missing, empty, or unknown type', () => {
    const payload = { conversation_id: 'c1', message_id: 'm1', text: 'hi' }
    expect(isRendererCommand({ payload })).toBe(false)
    expect(isRendererCommand({ type: '', payload })).toBe(false)
    expect(isRendererCommand({ type: 'connect', payload })).toBe(false)
  })

  it('rejects a send-message command with no payload', () => {
    expect(isRendererCommand({ type: 'sendMessage' })).toBe(false)
    expect(isRendererCommand({ type: 'sendMessage', payload: null })).toBe(false)
  })

  it('rejects a payload whose fields are missing or non-string', () => {
    const t = 'sendMessage'
    expect(isRendererCommand({ type: t, payload: { message_id: 'm1', text: 'hi' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', text: 'hi' } })).toBe(false)
    expect(isRendererCommand({ type: t, payload: { conversation_id: 'c1', message_id: 'm1' } })).toBe(
      false
    )
    expect(
      isRendererCommand({ type: t, payload: { conversation_id: 1, message_id: 'm1', text: 'hi' } })
    ).toBe(false)
  })
})
