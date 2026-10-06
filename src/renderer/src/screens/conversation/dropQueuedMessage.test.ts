import { describe, it, expect, vi } from 'vitest'
import { dropQueuedMessage } from './dropQueuedMessage'
import { dequeueMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { ThreadEvent } from '../../store/threadTimeline'

// dropQueuedMessage is a pure, React-free helper (the composerSend / modalResolution precedent): its
// effects — the guarded sendCommand and, since #1213, the two timeline writes — are injected, so it is
// exercised here with plain spies (no store, no Electron, no DOM). This is the "right ids → right
// command", "the operator's own cancel takes the echo too" and "a bridge failure must not crash the
// window" coverage the `node` env cannot get by firing clicks on the queued row.
//
// #1213 SPLIT THIS HELPER'S POSTURE IN TWO, and the split is the point. The QUEUED ROW stays
// non-optimistic — #296 AC3 — because the daemon owns the backlog; it leaves only on the next
// queue_state. The TIMELINE ECHO is this window's own optimistic write, so this window takes it back at
// the click. The two halves are asserted separately below.

describe('dropQueuedMessage', () => {
  it('sends exactly one dequeueMessage command carrying the conversation id + queued_msg_id (AC2)', () => {
    const sendCommand = vi.fn()

    dropQueuedMessage('default', 7, 'm-1', {
      sendCommand,
      dispatch: vi.fn(),
      dispatchFor: vi.fn()
    })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    // No camelCase→snake rename: the wire fields are already snake_case, so the ids pass straight through.
    expect(sendCommand).toHaveBeenCalledWith(
      dequeueMessageCommand({ conversation_id: 'default', queued_msg_id: 7 })
    )
    // The resulting command shape is the ungated dequeue command — no token, just the two routing fields.
    // #1213 did NOT widen it: message_id is a purely local correlation key and never rides the wire here.
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

    expect(() =>
      dropQueuedMessage('default', 7, 'm-1', {
        sendCommand,
        dispatch: vi.fn(),
        dispatchFor: vi.fn()
      })
    ).not.toThrow()

    errorSpy.mockRestore()
  })

  // ==================================================================================================
  // #1213 — the echo removal. Dropping a queued message must take its delivered-looking timeline bubble
  // with it, or the transcript keeps a message claude was never handed.
  // ==================================================================================================

  it('#1213: dispatches the removal into BOTH stores, keyed by the row wire id (AC2)', () => {
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()

    dropQueuedMessage('conv-1', 7, 'wire-id-9', {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor
    })

    const expected: ThreadEvent = { type: 'dropUserText', messageId: 'wire-id-9' }
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(expected)
    // The keyed holder is the second place submitMessage wrote the echo (#756). A removal reaching only
    // one store leaves the other holding the lie, and switching conversations would bring it back.
    expect(dispatchFor).toHaveBeenCalledTimes(1)
    expect(dispatchFor).toHaveBeenCalledWith('conv-1', expected)
    // Built ONCE and handed to both write paths — the submitMessage discipline, asserted at identity so a
    // future "build it again for the keyed store" edit cannot pass silently.
    expect(dispatchFor.mock.calls[0][1]).toBe(dispatch.mock.calls[0][0])
  })

  it('#1213: relays the wire id VERBATIM — no trim, no case fold, no client-side mint (AC1)', () => {
    const dispatch = vi.fn()
    const wire = '  Mixed-Case-ID_7  '

    dropQueuedMessage('conv-1', 7, wire, {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor: vi.fn()
    })

    const [event] = dispatch.mock.calls[0] as [Extract<ThreadEvent, { type: 'dropUserText' }>]
    expect(event.messageId).toBe(wire)
  })

  it('#1213: removes NO echo when the row carries no id — a pre-#2092 daemon (AC1)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()

    dropQueuedMessage('conv-1', 7, undefined, { sendCommand, dispatch, dispatchFor })

    // The drop itself still goes: the row must still leave the backlog against an old daemon.
    expect(sendCommand).toHaveBeenCalledTimes(1)
    // But nothing correlates, so nothing is removed — never a guess at the wrong row.
    expect(dispatch).not.toHaveBeenCalled()
    expect(dispatchFor).not.toHaveBeenCalled()
  })

  it('#1213: removes NO echo for an EMPTY id, on the same terms as an absent one (AC1)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()

    dropQueuedMessage('conv-1', 7, '', { sendCommand, dispatch, dispatchFor })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
    expect(dispatchFor).not.toHaveBeenCalled()
  })

  it('#1213: removes NO echo when the send itself failed — the message is still queued', () => {
    // A frame that never went means the daemon holds the message and will still run it. Removing the
    // echo then would claim the message is gone when it is not — the exact lie this ticket exists to
    // stop, pointed the other way.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()

    dropQueuedMessage('conv-1', 7, 'wire-id-9', {
      sendCommand: vi.fn(() => {
        throw new Error('bridge down')
      }),
      dispatch,
      dispatchFor
    })

    expect(dispatch).not.toHaveBeenCalled()
    expect(dispatchFor).not.toHaveBeenCalled()
    // The swallowed error stays content-free — no id, no text, no conversation id (ADR 0007).
    expect(errorSpy).toHaveBeenCalledWith('drop queued message send failed')
    errorSpy.mockRestore()
  })
})

it('diagnoses cancellation as a local request even when the bridge fails', () => {
  const diagnose = vi.fn()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const deps = { diagnose, sendCommand: () => { throw new Error('SECRET') }, dispatch: vi.fn(), dispatchFor: vi.fn() }
  dropQueuedMessage('chat', 1, undefined, deps)
  expect(diagnose).not.toHaveBeenCalled()
  dropQueuedMessage('chat', 1, '12345678-1234-4123-8123-123456789abc', deps)
  expect(diagnose).toHaveBeenCalledWith({ event: 'message-cancel-requested', conversationId: 'chat', messageId: '12345678-1234-4123-8123-123456789abc' })
  expect(deps.dispatch).not.toHaveBeenCalled()
  error.mockRestore()
})
