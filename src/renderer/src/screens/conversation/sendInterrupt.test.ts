import { describe, it, expect, vi } from 'vitest'
import { sendInterrupt } from './sendInterrupt'
import { interruptCommand, type RendererCommand } from '@shared/ipc/commands'

// sendInterrupt is a pure, React-free helper (the dropQueuedMessage / composerSend precedent): its
// single effect — the guarded sendCommand — is injected, so it is exercised here with a plain spy (no
// store, no Electron, no DOM). It is dropQueuedMessage minus the ids (the interrupt command is BARE —
// daemon SSOT pyrycode #707: one Esc, no conversation selector) and minus the local dispatch (AC3
// forbids optimistic "stopping" state — the control retracts only on the daemon's turn_state{idle}).
// This is the "activation → exactly one interrupt command" (AC2) + "a bridge failure must not crash the
// window" coverage the `node` env cannot get by firing a click on the button.

describe('sendInterrupt', () => {
  it('sends exactly one bare interrupt command per activation (AC2)', () => {
    const sendCommand = vi.fn()

    sendInterrupt({ sendCommand })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith(interruptCommand())
    // The resulting command is the bare interrupt frame — no payload, no token, no conversation selector.
    const command = sendCommand.mock.calls[0][0] as RendererCommand
    expect(command).toEqual({ type: 'interrupt' })
  })

  it('swallows a send-bridge failure (AC "unaffected window"): does not throw', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => sendInterrupt({ sendCommand })).not.toThrow()

    errorSpy.mockRestore()
  })
})
