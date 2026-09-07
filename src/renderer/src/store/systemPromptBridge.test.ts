import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { SessionPromptStatus } from '@shared/wire/types'
import {
  translateSystemPrompt,
  subscribeSystemPrompt,
  requestSystemPrompt,
  SystemPromptData
} from './systemPromptBridge'

// Framework-free data-path tests with injected spies (the modelListBridge / announcedModelBridge
// idiom): no React, no Electron, no store. The attribution gate is the subject of most of these
// cases, so the open-conversation getter is a spy whose answer the test controls per event.

function promptEvent(
  conversationId: string,
  systemPrompt: string | undefined,
  sessionPromptStatus: SessionPromptStatus
): DaemonEvent {
  return { type: 'systemPromptReceived', conversationId, systemPrompt, sessionPromptStatus }
}

describe('translateSystemPrompt', () => {
  it('maps the owned arm to a fresh two-field reading', () => {
    expect(translateSystemPrompt(promptEvent('conv-1', 'Be terse.', 'matches'))).toEqual({
      systemPrompt: 'Be terse.',
      sessionPromptStatus: 'matches'
    })
  })

  it('returns a FRESH literal carrying neither the type tag nor the conversation id', () => {
    const event = promptEvent('conv-1', 'Be terse.', 'matches')
    const reading = translateSystemPrompt(event)
    expect(reading).not.toBe(event)
    // A spread would have carried both into a write unit that never agreed to hold them.
    expect(reading).not.toHaveProperty('type')
    expect(reading).not.toHaveProperty('conversationId')
    expect(Object.keys(reading ?? {}).sort()).toEqual(['sessionPromptStatus', 'systemPrompt'])
  })

  // The tri-state, one case each — the collapse this guards against (`?? ''`, `|| undefined`, any
  // truthiness read) would typecheck and would silently make an explicitly-empty prompt unwritable.
  it('carries an absent prompt across as undefined, with the key present', () => {
    const reading = translateSystemPrompt(promptEvent('conv-1', undefined, 'no_session'))
    expect(reading?.systemPrompt).toBeUndefined()
    expect(reading !== null && 'systemPrompt' in reading).toBe(true)
  })

  it('carries an explicitly empty prompt across as "" — not collapsed into absent', () => {
    expect(translateSystemPrompt(promptEvent('conv-1', '', 'matches'))?.systemPrompt).toBe('')
  })

  it('carries prompt text across verbatim', () => {
    const text = '  Be terse.\nAnswer in one line.  '
    expect(translateSystemPrompt(promptEvent('conv-1', text, 'differs'))?.systemPrompt).toBe(text)
  })

  it.each<[SessionPromptStatus, string | undefined]>([
    ['matches', undefined],
    ['differs', 'Be terse.'],
    ['no_session', 'Be terse.'],
    ['no_session', ''],
    ['matches', '']
  ])('carries status %s across independently of prompt %j', (status, prompt) => {
    const reading = translateSystemPrompt(promptEvent('conv-1', prompt, status))
    expect(reading?.sessionPromptStatus).toBe(status)
    expect(reading?.systemPrompt).toBe(prompt)
  })

  it('maps every unrelated DaemonEvent to null — NOT OUR ARM, never "bad data"', () => {
    // Three shapes on purpose: a conversation-keyed arm carrying a row list, a conversation-keyed
    // correlated-reply arm, and a bare one. The filter switches on the DISCRIMINANT and never on field
    // names, so an arm sharing `conversationId` must not be picked up.
    const unrelated: DaemonEvent[] = [
      { type: 'modelList', conversationId: 'conv-1', models: [], droppedModels: 0 },
      {
        type: 'sessionTransition',
        conversationId: 'conv-1',
        newSessionId: 's-1',
        reason: 'clear',
        occurredAt: '2026-09-07T12:00:00Z',
        workspaceCwd: null
      },
      { type: 'turnState', conversationId: 'conv-1', state: 'idle' },
      { type: 'disconnected' }
    ]
    for (const event of unrelated) expect(translateSystemPrompt(event)).toBeNull()
  })
})

describe('subscribeSystemPrompt', () => {
  // A minimal onDaemonEvent fake: captures the listener so the test can emit, and hands back a spy as
  // the off handle.
  function harness(openIds: (string | null)[]) {
    let listener: (event: DaemonEvent) => void = () => {}
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (event: DaemonEvent) => void) => {
      listener = l
      return off
    })
    const setReading = vi.fn()
    const queue = [...openIds]
    // Per-event getter: each call answers with the NEXT id, so a listener that resolved it once at
    // subscribe time reads a frozen value and fails the two-event case below.
    const getOpenConversationId = vi.fn(() => (queue.length > 1 ? queue.shift()! : queue[0]))
    const unsubscribe = subscribeSystemPrompt(onDaemonEvent, setReading, getOpenConversationId)
    return { emit: (event: DaemonEvent) => listener(event), setReading, off, unsubscribe }
  }

  it('writes a reply naming the OPEN conversation (AC4)', () => {
    const h = harness(['conv-1'])
    h.emit(promptEvent('conv-1', 'Be terse.', 'matches'))
    expect(h.setReading).toHaveBeenCalledTimes(1)
    expect(h.setReading).toHaveBeenCalledWith({
      systemPrompt: 'Be terse.',
      sessionPromptStatus: 'matches'
    })
  })

  it('DROPS a reply naming any conversation but the open one (AC4)', () => {
    const h = harness(['conv-1'])
    h.emit(promptEvent('conv-2', 'Another chat prompt.', 'differs'))
    // Dropped, never held under a `?? openConversation` fallback.
    expect(h.setReading).not.toHaveBeenCalled()
  })

  it('DROPS a reply arriving with no conversation open — lands nowhere, never latches (AC4)', () => {
    const h = harness([null])
    h.emit(promptEvent('conv-1', 'Be terse.', 'matches'))
    expect(h.setReading).not.toHaveBeenCalled()
  })

  it('reads the open conversation PER EVENT, never once at subscription (AC4)', () => {
    // Two events across a getter whose answer moves between them. A closure capture at subscribe time
    // would compile, pass every single-event case above, and hold the SECOND reply too.
    const h = harness(['conv-1', 'conv-2'])
    h.emit(promptEvent('conv-1', 'First chat.', 'matches'))
    h.emit(promptEvent('conv-1', 'First chat, late reply.', 'differs'))
    expect(h.setReading).toHaveBeenCalledTimes(1)
    expect(h.setReading).toHaveBeenCalledWith({
      systemPrompt: 'First chat.',
      sessionPromptStatus: 'matches'
    })
  })

  it('no-ops on every unrelated event without consulting the store', () => {
    const h = harness(['conv-1'])
    h.emit({ type: 'disconnected' })
    h.emit({ type: 'modelList', conversationId: 'conv-1', models: [], droppedModels: 0 })
    expect(h.setReading).not.toHaveBeenCalled()
  })

  it('writes an absent prompt and an empty one as distinct readings past the gate', () => {
    const h = harness(['conv-1'])
    h.emit(promptEvent('conv-1', undefined, 'no_session'))
    h.emit(promptEvent('conv-1', '', 'matches'))
    expect(h.setReading.mock.calls[0][0].systemPrompt).toBeUndefined()
    expect(h.setReading.mock.calls[1][0].systemPrompt).toBe('')
  })

  it('returns the injected off handle as the unsubscribe', () => {
    const h = harness(['conv-1'])
    expect(h.unsubscribe).toBe(h.off)
  })
})

describe('requestSystemPrompt', () => {
  it('sends exactly one requestSystemPrompt naming the conversation (AC1)', () => {
    const sendCommand = vi.fn()
    requestSystemPrompt(sendCommand, 'conv-1')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'requestSystemPrompt',
      payload: { conversation_id: 'conv-1' }
    })
  })

  it('builds a FRESH one-field payload — nothing can widen the frame from the renderer', () => {
    const sendCommand = vi.fn()
    requestSystemPrompt(sendCommand, 'conv-1')
    expect(Object.keys(sendCommand.mock.calls[0][0].payload)).toEqual(['conversation_id'])
  })

  // The security half of AC1: this verb has NO error frame, so an unroutable id would draw an
  // ordinary-looking `no_session` reply that nothing downstream can tell from a true reading. Main's
  // routing lookup is the enforcing half; this guard keeps a bare send from reaching it.
  it.each([
    ['null', null],
    ['an empty string', '']
  ])('sends NOTHING when the conversation id is %s (AC1)', (_label, conversationId) => {
    const sendCommand = vi.fn()
    requestSystemPrompt(sendCommand, conversationId)
    expect(sendCommand).not.toHaveBeenCalled()
  })
})

describe('SystemPromptData', () => {
  it('renders nothing and derefs window.pyry only inside its effect', () => {
    // No window.pyry stub: a render-time dereference would throw here, which is the App.test
    // no-window-stub invariant this leaf has to preserve.
    expect(renderToStaticMarkup(createElement(SystemPromptData))).toBe('')
  })
})
