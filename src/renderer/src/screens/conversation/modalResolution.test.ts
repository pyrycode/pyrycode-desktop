import { describe, it, expect, vi } from 'vitest'
import {
  answerPrompt,
  confirmPrompt,
  hasSessionPermission,
  cancelPrompt,
  selectOption,
  resolvePendingOption,
  MODAL_CANCEL_OUTCOME
} from './modalResolution'
import { answerModalCommand, cancelModalCommand, type RendererCommand } from '@shared/ipc/commands'
import type { ModalOption, ModalPrompt } from '../../store/modalPrompts'

describe('confirmed session permission', () => {
  const prompt: ModalPrompt = { conversationId: 'chat', modalId: 'grant', class: 'permission',
    title: 'Permission', prompt: 'Review', defaultOptionId: 'reject_once',
    options: ['allow_once', 'allow_always', 'reject_once', 'reject_always', 'proceed'].map(id => ({ id, label: id })),
    alwaysAllow: { offered: true, rules: ['Read', 'Bash(touch:*)'] } }

  it.each(['allow_once', 'allow_always', 'reject_once', 'reject_always', 'proceed'])(
    'grants only supplied allow options on Confirm: %s', optionId => {
      const sendCommand = vi.fn()
      confirmPrompt(prompt, { modalId: prompt.modalId, optionId }, prompt, { sendCommand, dispatch: vi.fn() })
      expect(sendCommand).toHaveBeenCalledWith(answerModalCommand({ modal_id: 'grant', option_id: optionId,
        ...(['allow_once', 'allow_always'].includes(optionId) ? { always_allow: true } : {}) }))
    })

  it('never grants unchecked, stale, unavailable or trust consent', () => {
    const sendCommand = vi.fn()
    const replacements: ModalPrompt[] = [{ ...prompt, alwaysAllow: undefined },
      { ...prompt, alwaysAllow: { offered: false, rules: [] } }, { ...prompt, class: 'trust' },
      { ...prompt, modalId: 'other' }, { ...prompt, conversationId: 'other-chat' },
      { ...prompt, alwaysAllow: { ...prompt.alwaysAllow!, rules: ['Read'] } }]
    for (const current of replacements) {
      expect(hasSessionPermission(current, prompt)).toBe(false)
      confirmPrompt(current, { modalId: current.modalId, optionId: 'allow_once' }, prompt, { sendCommand, dispatch: vi.fn() })
      expect(sendCommand.mock.lastCall![0].payload).not.toHaveProperty('always_allow')
    }
    confirmPrompt(prompt, { modalId: 'grant', optionId: 'allow_once' }, null, { sendCommand, dispatch: vi.fn() })
    expect(sendCommand.mock.lastCall![0].payload).not.toHaveProperty('always_allow')
  })

  it('does not answer an invalid request or removed option', () => {
    const sendCommand = vi.fn()
    for (const pending of [null, { modalId: 'other', optionId: 'allow_once' }, { modalId: 'grant', optionId: 'missing' }]) {
      confirmPrompt(prompt, pending, prompt, { sendCommand, dispatch: vi.fn() })
    }
    expect(sendCommand).not.toHaveBeenCalled()
  })
})

// answerPrompt / cancelPrompt are pure, React-free helpers (the composerSend precedent): their two
// effects — the guarded sendCommand and the unconditional local `dismissed` dispatch — are injected,
// so they are exercised here with plain spies (no store, no Electron, no DOM). This is the behavioral
// coverage the `node` test environment cannot get by firing clicks on the view.

describe('answerPrompt', () => {
  it('logs static lifecycle/error codes without response or exception content', () => {
    const sendDiagnostic = vi.fn()
    vi.stubGlobal('window', { pyry: { sendDiagnostic } })
    try {
      answerPrompt('private-request', 'allow_once', { sendCommand: () => { throw new Error('private-content') }, dispatch: vi.fn() }, true)
      expect(sendDiagnostic.mock.calls).toEqual([
        [{ event: 'permission-response', code: 'session-grant-requested' }],
        [{ event: 'permission-response', code: 'answer-send-failed' }]
      ])
    } finally { vi.unstubAllGlobals() }
  })

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
    // #878: derived from, but never equal to, the modal id — both are `string`, so only distinct values
    // can catch a transposition of the two adjacent fields.
    conversationId: 'conv-m1',
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
      conversationId: 'conv-m3',
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

// #511: resolvePendingOption is the pure derivation that scopes the #226 marker to the prompt it was
// selected on. Daemon option ids are a CLOSED per-class vocabulary (`permission` → allow_once /
// allow_always / reject_once / reject_always, `trust` → proceed / exit), so two prompts of the same
// class share their ENTIRE id set — the pre-#511 option-id-only marker was GUARANTEED to match the
// next prompt, not merely likely. The fixtures below therefore use the real daemon sets: a pair with
// disjoint ids would not exercise the bug at all (AC1).
describe('resolvePendingOption — the prompt-scoped second-confirm marker (#511)', () => {
  const PERMISSION_OPTIONS: readonly ModalOption[] = [
    { id: 'allow_once', label: 'Allow once' },
    { id: 'allow_always', label: 'Allow always' },
    { id: 'reject_once', label: 'Reject once' },
    { id: 'reject_always', label: 'Reject always' }
  ]

  function permissionPrompt(modalId: string): ModalPrompt {
    return {
      conversationId: `conv-${modalId}`,
      modalId,
      class: 'permission',
      title: `Allow Bash (${modalId})`,
      prompt: `claude wants to run the build (${modalId})`,
      options: PERMISSION_OPTIONS,
      defaultOptionId: 'reject_once'
    }
  }

  // Two distinct prompts drawing from the identical id set — the shape the daemon actually produces
  // for two consecutive permission requests.
  const A = permissionPrompt('mdl-a')
  const B = permissionPrompt('mdl-b')
  // What the user armed by clicking A's non-default "Allow always" (selectOption holds, never answers).
  const ARMED_ON_A = { modalId: 'mdl-a', optionId: 'allow_always' }

  it('returns the held option when the rendered prompt IS the one it was selected on', () => {
    expect(resolvePendingOption(A, ARMED_ON_A)).toEqual({ id: 'allow_always', label: 'Allow always' })
  })

  it('returns null when the rendered prompt is a DIFFERENT prompt sharing the same id set (AC1)', () => {
    // The precondition that makes this non-vacuous: B genuinely offers the held id, so a null result
    // can only come from the modalId guard — never from an accidental id mismatch.
    expect(B.options.some((o) => o.id === ARMED_ON_A.optionId)).toBe(true)
    expect(resolvePendingOption(B, ARMED_ON_A)).toBeNull()
  })

  it('returns null while nothing is outstanding (the empty-outstanding window, AC2)', () => {
    expect(resolvePendingOption(undefined, ARMED_ON_A)).toBeNull()
  })

  it('returns null with no marker held — list mode', () => {
    expect(resolvePendingOption(A, null)).toBeNull()
  })

  it('returns null when the SAME prompt is re-delivered without the held option (within-prompt net)', () => {
    // The retained option-id lookup, redemoted to its real job: a `shown` re-delivery replaces the
    // prompt in place (modalPrompts.ts) and may carry a changed option set.
    const reDelivered: ModalPrompt = {
      ...A,
      options: [
        { id: 'reject_once', label: 'Reject once' },
        { id: 'reject_always', label: 'Reject always' }
      ]
    }
    expect(resolvePendingOption(reDelivered, ARMED_ON_A)).toBeNull()
  })

  it('scopes by modalId in the `trust` vocabulary too (proceed / exit), the second closed id set', () => {
    function trustPrompt(modalId: string): ModalPrompt {
      return {
        conversationId: `conv-${modalId}`,
        modalId,
        class: 'trust',
        title: 'Trust this workspace',
        prompt: 'Grant access',
        options: [
          { id: 'proceed', label: 'Proceed' },
          { id: 'exit', label: 'Exit' }
        ],
        defaultOptionId: 'exit'
      }
    }
    const t1 = trustPrompt('mdl-t1')
    const t2 = trustPrompt('mdl-t2')
    const armedOnT1 = { modalId: 'mdl-t1', optionId: 'proceed' }

    expect(t2.options.some((o) => o.id === armedOnT1.optionId)).toBe(true)
    expect(resolvePendingOption(t2, armedOnT1)).toBeNull()
    // The guard is the modalId, not the class — the same marker still resolves on its own prompt.
    expect(resolvePendingOption(t1, armedOnT1)).toEqual({ id: 'proceed', label: 'Proceed' })
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
