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
    // Narrow off the discriminant now the union also holds the bare requestDebugBundle member.
    if (command.type === 'sendMessage') {
      expect(command.payload).toBe(fields) // verbatim pass-through, no field remap
    }
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

  it('accepts the bare requestDebugBundle command (no payload — bundle is daemon-global)', () => {
    // The debug-bundle request carries nothing to parameterise, so its guard case is a bare
    // `return true`. A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(isRendererCommand({ type: 'requestDebugBundle' })).toBe(true)
    expect(isRendererCommand({ type: 'requestDebugBundle', extra: 'ignored' })).toBe(true)
  })

  it('types the bare requestDebugBundle member as part of the union', () => {
    // Compile-time proof the bare member is in RendererCommand, hence reachable through the
    // existing generic sendCommand bridge — no new preload method or IPC channel exists to test.
    const command: RendererCommand = { type: 'requestDebugBundle' }
    expect(isRendererCommand(command)).toBe(true)
  })

  it('accepts a well-formed requestSnapshot command carrying a string conversation_id (#180)', () => {
    // Compile-time proof the member is in RendererCommand, hence reachable through the existing
    // generic sendCommand bridge — no new preload method or IPC channel exists.
    const command: RendererCommand = { type: 'requestSnapshot', payload: { conversation_id: 'c1' } }
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(
      isRendererCommand({ type: 'requestSnapshot', payload: { conversation_id: 'c1' }, extra: 1 })
    ).toBe(true)
  })

  it('rejects a requestSnapshot with a missing payload or a non-string conversation_id (#180)', () => {
    expect(isRendererCommand({ type: 'requestSnapshot' })).toBe(false)
    expect(isRendererCommand({ type: 'requestSnapshot', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'requestSnapshot', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'requestSnapshot', payload: { conversation_id: 42 } })).toBe(
      false
    )
  })

  it('accepts the bare requestConversations command (no payload — the request carries nothing) (#139)', () => {
    // The list request carries nothing to parameterise, so its guard case is a bare `return true`.
    // A structurally-extra field is harmless (structural minimum), like requestDebugBundle.
    expect(isRendererCommand({ type: 'requestConversations' })).toBe(true)
    expect(isRendererCommand({ type: 'requestConversations', extra: 'ignored' })).toBe(true)
  })

  it('types the bare requestConversations member as part of the union (#139)', () => {
    // Compile-time proof the bare member is in RendererCommand, hence reachable through the existing
    // generic sendCommand bridge — no new preload method or IPC channel exists to test.
    const command: RendererCommand = { type: 'requestConversations' }
    expect(isRendererCommand(command)).toBe(true)
  })
})
