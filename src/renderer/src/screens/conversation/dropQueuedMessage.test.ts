import { describe, it, expect, vi } from 'vitest'
import { dropQueuedMessage } from './dropQueuedMessage'
import { dequeueMessageCommand, type RendererCommand } from '@shared/ipc/commands'

// dropQueuedMessage is a pure, React-free helper (the composerSend / modalResolution precedent): its
// single effect — the guarded sendCommand — is injected, so it is exercised here with a plain spy (no
// store, no Electron, no DOM). It is cancelPrompt minus the local dispatch (AC3 forbids optimistic
// removal — the row disappears only on the next queue_state snapshot) and minus the rename (the wire
// fields are already snake_case). This is the "right ids → right command" + "a bridge failure must not
// crash the window" coverage the `node` env cannot get by firing clicks on the queued row.

describe('dropQueuedMessage', () => {
  it('sends exactly one dequeueMessage command carrying the conversation id + queued_msg_id (AC2)', () => {
    const sendCommand = vi.fn()

    dropQueuedMessage('default', 7, { sendCommand })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    // No camelCase→snake rename: the wire fields are already snake_case, so the ids pass straight through.
    expect(sendCommand).toHaveBeenCalledWith(
      dequeueMessageCommand({ conversation_id: 'default', queued_msg_id: 7 })
    )
    // The resulting command shape is the ungated dequeue command — no token, just the two routing fields.
    const command = sendCommand.mock.calls[0][0] as RendererCommand
    expect(command).toEqual({
      type: 'dequeueMessage',
      payload: { conversation_id: 'default', queued_msg_id: 7 }
    })
  })

  it('swallows a send-bridge failure (AC "unaffected window"): does not throw', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => dropQueuedMessage('default', 7, { sendCommand })).not.toThrow()

    errorSpy.mockRestore()
  })
})
