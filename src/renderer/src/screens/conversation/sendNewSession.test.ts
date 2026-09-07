import { describe, it, expect, vi } from 'vitest'
import { sendNewSession } from './sendNewSession'
import { newSessionCommand } from '@shared/ipc/commands'

// #1218 — sendNewSession is a pure, React-free helper whose single effect (the guarded sendCommand) is
// injected, so it is exercised here with a plain spy: no store, no Electron, no DOM. It is sendInterrupt
// with an address — a restart names the conversation whose claude to kill — and the two refusals below
// are the whole of AC2's added clause. Nothing in this repo can click, so the menu's pick reaching this
// helper is e2e/composer-new-session.spec.ts's; what is proved here is what the helper does once reached.

const CONVERSATION_ID = 'conv-1218'

describe('sendNewSession', () => {
  it('sends exactly one newSession command naming the conversation (AC2)', () => {
    const sendCommand = vi.fn()

    sendNewSession(CONVERSATION_ID, { sendCommand })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith(
      newSessionCommand({ conversation_id: CONVERSATION_ID })
    )
    // Spelled out as well as compared against the constructor: the command carries the id and NOTHING
    // else — no text, no token, no serverId that could disagree with the address.
    expect(sendCommand.mock.calls[0][0]).toEqual({
      type: 'newSession',
      payload: { conversation_id: CONVERSATION_ID }
    })
  })

  // AC2's added clause, and the `submitMessage` precedent: with no conversation open the composer footer
  // still renders, so `null` is reachable at the call site. Sending nothing is the whole behaviour —
  // there is no error, no dispatch and no frame.
  it('sends nothing at all when no conversation is open (AC2)', () => {
    const sendCommand = vi.fn()

    sendNewSession(null, { sendCommand })

    expect(sendCommand).not.toHaveBeenCalled()
  })

  // THE EMPTY ID IS NOT AN UNRESOLVABLE ID ON THIS VERB. The protocol gives an absent and an explicitly
  // empty `conversation_id` one meaning — restart whichever conversation the daemon's process-wide
  // follow-active cursor points at — so `''` is some OTHER conversation's claude killed mid-work
  // (pyrycode#2099). `isNewSessionPayload` refuses it at the untrusted boundary and remains the
  // load-bearing refusal; this assertion pins that the honest client never asks in the first place.
  it('sends nothing on an empty id, rather than a command naming none (AC2)', () => {
    const sendCommand = vi.fn()

    sendNewSession('', { sendCommand })

    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('swallows a send-bridge failure rather than crashing the window', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => sendNewSession(CONVERSATION_ID, { sendCommand })).not.toThrow()

    errorSpy.mockRestore()
  })
})
