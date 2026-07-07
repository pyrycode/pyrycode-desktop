import { describe, it, expect, vi } from 'vitest'
import { submitMessage, composerAvailability, MILESTONE_CONVERSATION_ID } from './composerSend'
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { SessionAction } from '../../store/sessionStore'
import type { HelloAckPayload } from '@shared/wire/types'

// submitMessage is a pure, React-free function (the pairingState precedent): its three effects
// are injected, so it is exercised here with plain spies and a deterministic id stub — no store,
// no Electron bridge, no DOM.

describe('submitMessage', () => {
  it('returns false and performs no effect for whitespace-only or empty input', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      const sendCommand = vi.fn()
      const dispatch = vi.fn()
      const newMessageId = vi.fn(() => 'unused')
      expect(submitMessage(blank, { sendCommand, dispatch, newMessageId })).toBe(false)
      expect(sendCommand).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
      expect(newMessageId).not.toHaveBeenCalled()
    }
  })

  it('sends exactly one sendMessage command carrying a SendMessagePayload for the milestone conversation', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const newMessageId = vi.fn(() => 'mint-1')

    const result = submitMessage('hello', { sendCommand, dispatch, newMessageId })

    expect(result).toBe(true)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    // The wire payload has NO role field (SendMessagePayload), unlike the store echo.
    expect(sendCommand).toHaveBeenCalledWith(
      sendMessageCommand({
        conversation_id: MILESTONE_CONVERSATION_ID,
        message_id: 'mint-1',
        text: 'hello'
      })
    )
  })

  it('dispatches a messageSent optimistic echo as a user-role MessagePayload with trimmed text', () => {
    const dispatch = vi.fn()

    submitMessage('  hey there  ', {
      sendCommand: vi.fn(),
      dispatch,
      newMessageId: () => 'echo-1'
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'messageSent',
      message: {
        conversation_id: MILESTONE_CONVERSATION_ID,
        message_id: 'echo-1',
        role: 'user',
        text: 'hey there'
      }
    })
  })

  it('mints one message_id and reuses it for both the wire command and the store echo', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const newMessageId = vi.fn(() => 'shared-id')

    submitMessage('hi', { sendCommand, dispatch, newMessageId })

    expect(newMessageId).toHaveBeenCalledTimes(1)
    const command = sendCommand.mock.calls[0][0] as RendererCommand
    const wireId = command.type === 'sendMessage' ? command.payload.message_id : undefined
    const action = dispatch.mock.calls[0][0] as SessionAction
    const echoId = action.type === 'messageSent' ? action.message.message_id : undefined
    expect(wireId).toBe('shared-id')
    expect(echoId).toBe('shared-id')
  })

  it('trims leading/trailing whitespace before both the send payload and the echo', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    submitMessage('\n  spaced  \t', { sendCommand, dispatch, newMessageId: () => 't1' })

    const command = sendCommand.mock.calls[0][0] as RendererCommand
    const sentText = command.type === 'sendMessage' ? command.payload.text : undefined
    const action = dispatch.mock.calls[0][0] as SessionAction
    const echoText = action.type === 'messageSent' ? action.message.text : undefined
    expect(sentText).toBe('spaced')
    expect(echoText).toBe('spaced')
  })

  it('swallows a send-bridge failure (AC4): still echoes optimistically and returns true', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const dispatch = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let result: boolean | undefined
    expect(() => {
      result = submitMessage('hello', { sendCommand, dispatch, newMessageId: () => 'g1' })
    }).not.toThrow()

    expect(result).toBe(true)
    // The optimistic echo is appended regardless of send outcome.
    expect(dispatch).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})

// composerAvailability is the pure gate (#31): a total mapping over ConnectionStatus's four arms
// governing whether the composer's send control accepts input, and — when it doesn't — a short
// caption saying why. React-free, so the send/no-send decision (AC1) and the "why" copy (AC2) are
// unit-testable without a DOM, the same reason submitMessage is pure.
describe('composerAvailability', () => {
  const ack: HelloAckPayload = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('connected → can send, no hint', () => {
    expect(composerAvailability({ type: 'connected', ack })).toEqual({ canSend: true, hint: null })
  })

  it('connecting → cannot send, with a non-empty hint', () => {
    const { canSend, hint } = composerAvailability({ type: 'connecting' })
    expect(canSend).toBe(false)
    expect(hint).toBeTruthy()
  })

  it('disconnected → cannot send, with a non-empty hint', () => {
    const { canSend, hint } = composerAvailability({ type: 'disconnected' })
    expect(canSend).toBe(false)
    expect(hint).toBeTruthy()
  })

  it('error → cannot send, with a hint that does NOT leak ConnectionError.message', () => {
    const { canSend, hint } = composerAvailability({
      type: 'error',
      error: { code: 'transport', message: 'BANNER-ONLY-TEXT', retryable: true }
    })
    expect(canSend).toBe(false)
    expect(hint).toBeTruthy()
    // ConnectionError.message is the connection banner's surface, explicitly out of scope for #31.
    // The composer hint is a short generic label and must not surface the banner's text.
    expect(hint).not.toContain('BANNER-ONLY-TEXT')
  })

  it('the three not-connected arms yield distinct hints tied to their status (AC2)', () => {
    const hints = [
      composerAvailability({ type: 'connecting' }).hint,
      composerAvailability({ type: 'disconnected' }).hint,
      composerAvailability({
        type: 'error',
        error: { code: 'transport', message: 'x', retryable: false }
      }).hint
    ]
    expect(new Set(hints).size).toBe(3)
  })
})
