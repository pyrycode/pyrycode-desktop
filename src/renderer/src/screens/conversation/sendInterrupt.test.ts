import { describe, it, expect, vi } from 'vitest'
import { sendInterrupt } from './sendInterrupt'
import { interruptCommand, type RendererCommand } from '@shared/ipc/commands'

// sendInterrupt is a pure, React-free helper (the dropQueuedMessage / composerSend precedent): its
// single effect — the guarded sendCommand — is injected, so it is exercised here with a plain spy (no
// store, no Electron, no DOM). It is `sendNewSession` for the twin verb: the same guarded-send, the
// same null/empty refusal, and no local dispatch (AC3 forbids optimistic "stopping" state — the
// control retracts only on the daemon's turn_state{idle}). This is the "activation → exactly one
// interrupt command" + "a bridge failure must not crash the window" coverage the `node` env cannot get
// by firing a click on the button.

describe('sendInterrupt', () => {
  it('sends exactly one interrupt command naming the open conversation per activation', () => {
    const sendCommand = vi.fn()

    sendInterrupt('conv-42', { sendCommand })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith(interruptCommand({ conversation_id: 'conv-42' }))
    // ONE field and nothing else — no token, no server selector (#1092 AC1).
    const command = sendCommand.mock.calls[0][0] as RendererCommand
    expect(command).toEqual({ type: 'interrupt', payload: { conversation_id: 'conv-42' } })
  })

  it('sends the id it is given on each activation, so two chats produce two different frames', () => {
    // The container reads `activeConversationId` at interaction time, and this helper must not
    // interpose any memory of its own between that read and the command.
    const sendCommand = vi.fn()

    sendInterrupt('conv-a', { sendCommand })
    sendInterrupt('conv-b', { sendCommand })

    expect(sendCommand.mock.calls.map(([c]) => (c as { payload: { conversation_id: string } }).payload)).toEqual([
      { conversation_id: 'conv-a' },
      { conversation_id: 'conv-b' }
    ])
  })

  it('sends NOTHING when no conversation is open (#1092 AC3)', () => {
    // `null` is reachable: the composer footer renders whether or not a conversation is open, so the
    // container's `activeConversationId` is `activeConversation?.id ?? null` all the way down. An
    // inert no-op — no command, so no frame, no error and no crash.
    const sendCommand = vi.fn()

    sendInterrupt(null, { sendCommand })

    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('sends NOTHING for an empty id — the form that would ship looking correct (#1092 AC3)', () => {
    // `''` is not an unresolvable id on this verb: the protocol gives no payload, `{}`, an absent id
    // and an explicitly empty one ONE wire meaning — stop the turn in whichever conversation the
    // daemon's process-wide follow-active cursor points at, which is some OTHER chat's turn as often
    // as it is this one's. `isInterruptPayload` remains the load-bearing refusal at the untrusted
    // boundary; this is defence in depth so the honest client never asks, and does not make that one
    // redundant. Do not relax either believing the other covers it: a command the boundary guard
    // rejects is dropped in silence, so both a `?? ''` here and a relaxed clause there compile,
    // typecheck and pass every gate.
    const sendCommand = vi.fn()

    sendInterrupt('', { sendCommand })

    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('swallows a send-bridge failure (AC "unaffected window"): does not throw', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => sendInterrupt('conv-42', { sendCommand })).not.toThrow()

    // The error alone reaches the log — never the conversation id, the sibling helpers' content-free
    // rule. This assertion is the guard against a well-meant "which chat failed?" edit.
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('conv-42')

    errorSpy.mockRestore()
  })
})
