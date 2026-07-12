import { describe, it, expect, vi } from 'vitest'
import { requestScreenSnapshot } from './requestScreenSnapshot'
import { MILESTONE_CONVERSATION_ID } from './composerSend'

// requestScreenSnapshot is a pure, React-free helper (the sendInterrupt / requestRunConfigSnapshot
// precedent): its single effect — the guarded sendCommand — is injected, so it is exercised here with a
// plain spy (no store, no Electron, no DOM). It fires the EXISTING requestSnapshot command (#180), so this
// is the "activation → exactly one requestSnapshot command" (AC1/AC5) + "a bridge failure must not crash
// the window" coverage the `node` env cannot get by firing a click on the button.

describe('requestScreenSnapshot', () => {
  it('fires exactly one requestSnapshot for the milestone conversation (AC1)', () => {
    const sendCommand = vi.fn()

    requestScreenSnapshot({ sendCommand })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'requestSnapshot',
      payload: { conversation_id: MILESTONE_CONVERSATION_ID }
    })
  })

  it('swallows a send-bridge failure without throwing (the window stays up)', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => requestScreenSnapshot({ sendCommand })).not.toThrow()

    errorSpy.mockRestore()
  })
})
