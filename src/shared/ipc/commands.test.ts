import { describe, it, expect } from 'vitest'
import {
  COMMAND_CHANNEL,
  isRendererCommand,
  sendMessageCommand,
  answerModalCommand,
  cancelModalCommand,
  type RendererCommand,
  type AnswerModalCommandPayload
} from './commands'
import type { SendMessagePayload, ModalCancelPayload } from '../wire/types'

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

describe('answerModalCommand / cancelModalCommand (#236)', () => {
  it('wraps answer fields into an answerModal command, fields unchanged (no token minted here)', () => {
    const fields: AnswerModalCommandPayload = { modal_id: 'md-1', option_id: 'opt-1' }

    const command = answerModalCommand(fields)

    // Discriminant comes from the module, not a bare literal a rename could silently pass.
    expect(command).toEqual({ type: 'answerModal', payload: fields })
    if (command.type === 'answerModal') {
      // Verbatim pass-through: no field remap, and no answer_token — that is minted main-side (#236's
      // daemonConnection.answerModal), never in this pure renderer-side constructor.
      expect(command.payload).toBe(fields)
    }
  })

  it('wraps a modal_id into a cancelModal command, fields unchanged', () => {
    const fields: ModalCancelPayload = { modal_id: 'md-1' }

    const command = cancelModalCommand(fields)

    expect(command).toEqual({ type: 'cancelModal', payload: fields })
    if (command.type === 'cancelModal') {
      expect(command.payload).toBe(fields)
    }
  })

  it('cannot carry an answer_token on the answer command type (AC1: no member carries a token)', () => {
    // Compile-time proof the answer command's fields are Omit-excluded of answer_token — the mint is
    // main-side. The excess-property check fires on the object literal; typecheck (the build gate)
    // enforces it, so this line must stay a compile error.
    // @ts-expect-error answer_token is not assignable to AnswerModalCommandPayload (Omit-excluded).
    answerModalCommand({ modal_id: 'md-1', option_id: 'opt-1', answer_token: 'nope' })
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

  it('accepts a well-formed answerModal command carrying string modal_id + option_id (#236)', () => {
    const command: RendererCommand = answerModalCommand({ modal_id: 'md-1', option_id: 'opt-1' })
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like sendMessage.
    expect(
      isRendererCommand({
        type: 'answerModal',
        payload: { modal_id: 'md-1', option_id: 'opt-1' },
        extra: 1
      })
    ).toBe(true)
  })

  it('accepts an answerModal payload carrying an extra answer_token (mint is main-side, not rejected here) (#236)', () => {
    // The command TYPE structurally excludes answer_token (Omit), but the runtime guard is a
    // structural minimum: a smuggled answer_token still guards true. It is the main-side sender's
    // fresh-literal construction — not this boundary guard — that ignores a renderer-supplied token
    // (proven in daemonConnection.test.ts). This pins that the guard does not reject the field.
    expect(
      isRendererCommand({
        type: 'answerModal',
        payload: { modal_id: 'md-1', option_id: 'opt-1', answer_token: 'smuggled' }
      })
    ).toBe(true)
  })

  it('rejects an answerModal with a missing payload or a missing/non-string modal_id or option_id (#236)', () => {
    expect(isRendererCommand({ type: 'answerModal' })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: { modal_id: 'md-1' } })).toBe(false)
    expect(isRendererCommand({ type: 'answerModal', payload: { option_id: 'opt-1' } })).toBe(false)
    expect(
      isRendererCommand({ type: 'answerModal', payload: { modal_id: 42, option_id: 'opt-1' } })
    ).toBe(false)
    expect(
      isRendererCommand({ type: 'answerModal', payload: { modal_id: 'md-1', option_id: 42 } })
    ).toBe(false)
  })

  it('accepts a well-formed cancelModal command carrying a string modal_id (#236)', () => {
    const command: RendererCommand = cancelModalCommand({ modal_id: 'md-1' })
    expect(isRendererCommand(command)).toBe(true)
    // A structurally-extra field is harmless (structural minimum), like requestSnapshot.
    expect(isRendererCommand({ type: 'cancelModal', payload: { modal_id: 'md-1' }, extra: 1 })).toBe(
      true
    )
  })

  it('rejects a cancelModal with a missing payload or a missing/non-string modal_id (#236)', () => {
    expect(isRendererCommand({ type: 'cancelModal' })).toBe(false)
    expect(isRendererCommand({ type: 'cancelModal', payload: null })).toBe(false)
    expect(isRendererCommand({ type: 'cancelModal', payload: {} })).toBe(false)
    expect(isRendererCommand({ type: 'cancelModal', payload: { modal_id: 42 } })).toBe(false)
  })
})
