import { describe, it, expect, vi } from 'vitest'
import { answerPrompt, cancelPrompt, selectOption, MODAL_CANCEL_OUTCOME } from './modalResolution'
import { answerModalCommand, cancelModalCommand, type RendererCommand } from '@shared/ipc/commands'
import type { ModalPrompt } from '../../store/modalPrompts'

// answerPrompt / cancelPrompt are pure, React-free helpers (the composerSend precedent): their two
// effects — the guarded sendCommand and the unconditional local `dismissed` dispatch — are injected,
// so they are exercised here with plain spies (no store, no Electron, no DOM). This is the behavioral
// coverage the `node` test environment cannot get by firing clicks on the view.

describe('answerPrompt', () => {
  it('sends the answerModal command with the camelCase→snake_case rename, then dispatches dismissed', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    answerPrompt('m1', 'allow-once', { sendCommand, dispatch })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    // The rename to the snake_case wire vocabulary happens here, at the dispatch site.
    expect(sendCommand).toHaveBeenCalledWith(
      answerModalCommand({ modal_id: 'm1', option_id: 'allow-once' })
    )
    // The optimistic local clear carries the chosen option_id as its outcome + source 'local'.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'dismissed',
      modalId: 'm1',
      outcome: 'allow-once',
      source: 'local'
    })
  })

  it('carries only modal_id + option_id — never an answer_token (Omit-excluded by construction)', () => {
    const sendCommand = vi.fn()

    answerPrompt('m1', 'deny', { sendCommand, dispatch: vi.fn() })

    const command = sendCommand.mock.calls[0][0] as RendererCommand
    const payload = command.type === 'answerModal' ? command.payload : undefined
    expect(payload).toEqual({ modal_id: 'm1', option_id: 'deny' })
    expect(payload).not.toHaveProperty('answer_token')
  })

  it('swallows a send-bridge failure (AC4): does not throw, still dispatches dismissed exactly once', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const dispatch = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => answerPrompt('m1', 'allow-once', { sendCommand, dispatch })).not.toThrow()
    // The local clear is unconditional — it posts after the guarded send regardless of the throw.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'dismissed',
      modalId: 'm1',
      outcome: 'allow-once',
      source: 'local'
    })
    errorSpy.mockRestore()
  })
})

// #226: selectOption is the pure second-confirm gate — it routes a just-clicked option to one of two
// injected effects (answer straight through, or hold pending a confirm) purely on prompt.defaultOptionId,
// sending/dispatching nothing itself. The container binds `answer` to answerPrompt and `requestConfirm`
// to the transient confirm state; both are plain spies here (the container/pure-view split, AC3).
describe('selectOption — the second-confirm gate', () => {
  const PROMPT: ModalPrompt = {
    modalId: 'm1',
    class: 'permission',
    title: 'Allow file write',
    prompt: 'claude wants to write to schema.ts',
    options: [
      { id: 'allow-once', label: 'Allow once' },
      { id: 'deny', label: 'Deny' },
      { id: 'allow-always', label: 'Allow always' }
    ],
    defaultOptionId: 'deny'
  }

  it('routes the default (fail-safe deny) option straight through to answer, ungated (AC2)', () => {
    const answer = vi.fn()
    const requestConfirm = vi.fn()

    selectOption(PROMPT, 'deny', { answer, requestConfirm })

    expect(answer).toHaveBeenCalledTimes(1)
    expect(answer).toHaveBeenCalledWith('deny')
    expect(requestConfirm).not.toHaveBeenCalled()
  })

  it('holds a non-default option pending confirm, never answering directly (AC1)', () => {
    const answer = vi.fn()
    const requestConfirm = vi.fn()

    selectOption(PROMPT, 'allow-once', { answer, requestConfirm })

    expect(requestConfirm).toHaveBeenCalledTimes(1)
    expect(requestConfirm).toHaveBeenCalledWith('allow-once')
    expect(answer).not.toHaveBeenCalled()
  })

  it('leaves the degenerate single-option-is-default prompt ungated (the only choice is the safe default)', () => {
    const single: ModalPrompt = {
      modalId: 'm3',
      class: 'trust',
      title: 'Trust this workspace',
      prompt: 'Grant access',
      options: [{ id: 'ok', label: 'OK' }],
      defaultOptionId: 'ok'
    }
    const answer = vi.fn()
    const requestConfirm = vi.fn()

    selectOption(single, 'ok', { answer, requestConfirm })

    expect(answer).toHaveBeenCalledTimes(1)
    expect(answer).toHaveBeenCalledWith('ok')
    expect(requestConfirm).not.toHaveBeenCalled()
  })
})

describe('cancelPrompt', () => {
  it('sends the cancelModal command, then dispatches dismissed with the cancel sentinel', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    cancelPrompt('m1', { sendCommand, dispatch })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith(cancelModalCommand({ modal_id: 'm1' }))
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'dismissed',
      modalId: 'm1',
      outcome: MODAL_CANCEL_OUTCOME,
      source: 'local'
    })
  })

  it('uses the "cancelled" sentinel outcome (the daemon OutcomeCancelled vocabulary)', () => {
    expect(MODAL_CANCEL_OUTCOME).toBe('cancelled')
  })

  it('swallows a send-bridge failure (AC4): does not throw, still dispatches dismissed exactly once', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const dispatch = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => cancelPrompt('m1', { sendCommand, dispatch })).not.toThrow()
    expect(dispatch).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
