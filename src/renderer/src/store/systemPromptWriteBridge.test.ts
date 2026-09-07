import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RendererCommand } from '@shared/ipc/commands'
import {
  translateSystemPromptWriteEvent,
  subscribeSystemPromptWrite,
  submitSystemPrompt,
  SystemPromptWriteData,
  type SystemPromptWriteEvent
} from './systemPromptWriteBridge'

// Framework-free data-path tests with injected spies (the runSettingsWriteBridge / systemPromptBridge
// idiom): no React, no Electron, no store. The outbound half's two obligations — the tri-state
// crossing verbatim and the record-before-send ordering — are the subject of most of these cases.

const A = 'conv-a'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('translateSystemPromptWriteEvent', () => {
  it('maps the confirmation to a fresh event carrying only the conversation it names', () => {
    const event: DaemonEvent = { type: 'systemPromptWriteConfirmed', conversationId: A }
    const translated = translateSystemPromptWriteEvent(event)
    expect(translated).toEqual({ type: 'writeConfirmed', conversationId: A })
    expect(translated).not.toBe(event)
  })

  it('maps the refusal, carrying its reason through unchanged', () => {
    expect(
      translateSystemPromptWriteEvent({
        type: 'systemPromptWriteRejected',
        conversationId: A,
        reason: 'prompt-too-long'
      })
    ).toEqual({ type: 'writeRejected', conversationId: A, reason: 'prompt-too-long' })
  })

  it('maps the connected edge to the payload-free clear, ignoring its ack', () => {
    const connected = {
      type: 'connected',
      ack: { server_id: 's-1', server_name: 'box', protocol_version: 1 }
    } as unknown as DaemonEvent
    expect(translateSystemPromptWriteEvent(connected)).toEqual({ type: 'reconnected' })
  })

  it('returns null for every unrelated arm, the read arm and disconnected included', () => {
    const unrelated: DaemonEvent[] = [
      { type: 'disconnected' } as unknown as DaemonEvent,
      {
        type: 'systemPromptReceived',
        conversationId: A,
        systemPrompt: 'Be terse.',
        sessionPromptStatus: 'matches'
      },
      { type: 'sessionSettingsUpdated', changeId: 'c1' } as unknown as DaemonEvent
    ]
    for (const event of unrelated) expect(translateSystemPromptWriteEvent(event)).toBeNull()
  })
})

describe('subscribeSystemPromptWrite', () => {
  function harness() {
    const dispatched: SystemPromptWriteEvent[] = []
    let listener: ((event: DaemonEvent) => void) | null = null
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (event: DaemonEvent) => void) => {
      listener = l
      return off
    })
    const handle = subscribeSystemPromptWrite(onDaemonEvent, (e) => void dispatched.push(e))
    return { dispatched, emit: (e: DaemonEvent) => listener?.(e), off, handle }
  }

  it('dispatches each owned arm and returns the off handle it was given', () => {
    const h = harness()
    h.emit({ type: 'systemPromptWriteConfirmed', conversationId: A })
    h.emit({ type: 'systemPromptWriteRejected', conversationId: A, reason: 'unclassified' })
    expect(h.dispatched).toEqual([
      { type: 'writeConfirmed', conversationId: A },
      { type: 'writeRejected', conversationId: A, reason: 'unclassified' }
    ])
    expect(h.handle).toBe(h.off)
  })

  it('no-ops on an unrelated event', () => {
    const h = harness()
    h.emit({
      type: 'systemPromptReceived',
      conversationId: A,
      systemPrompt: 'Be terse.',
      sessionPromptStatus: 'matches'
    })
    expect(h.dispatched).toEqual([])
  })

  it('passes an outcome for ANY conversation through — the keyed store is the attribution', () => {
    // Deliberately ungated, unlike the read bridge: an outcome naming a conversation with nothing in
    // flight settles nothing by construction, so a gate here would be a second implementation of one
    // decision.
    const h = harness()
    h.emit({ type: 'systemPromptWriteConfirmed', conversationId: 'some-other-chat' })
    expect(h.dispatched).toEqual([{ type: 'writeConfirmed', conversationId: 'some-other-chat' }])
  })
})

describe('submitSystemPrompt', () => {
  /** Narrow the sent command to the one arm this helper may produce, so the tri-state assertions read
   *  the real `SetSystemPromptPayload` rather than a cast that would survive a changed shape. */
  function payloadOf(command: RendererCommand) {
    if (command.type !== 'setSystemPrompt') throw new Error(`unexpected command: ${command.type}`)
    return command.payload
  }

  function deps() {
    const sent: RendererCommand[] = []
    const dispatched: SystemPromptWriteEvent[] = []
    const order: string[] = []
    return {
      sent,
      dispatched,
      order,
      d: {
        sendCommand: (command: RendererCommand) => {
          order.push('send')
          sent.push(command)
        },
        dispatch: (event: SystemPromptWriteEvent) => {
          order.push('dispatch')
          dispatched.push(event)
        }
      }
    }
  }

  it('stores a value: exactly one command carrying exactly the two wire fields (AC1)', () => {
    const h = deps()
    submitSystemPrompt(h.d, A, 'Answer in Finnish.')
    expect(h.sent).toEqual([
      { type: 'setSystemPrompt', payload: { conversation_id: A, system_prompt: 'Answer in Finnish.' } }
    ])
    expect(Object.keys(payloadOf(h.sent[0])).sort()).toEqual(['conversation_id', 'system_prompt'])
  })

  it("stores an explicitly empty prompt as '' — never collapsed to null or dropped (AC1)", () => {
    const h = deps()
    submitSystemPrompt(h.d, A, '')
    const payload = payloadOf(h.sent[0])
    expect(payload.system_prompt).toBe('')
    expect(payload.system_prompt).not.toBeNull()
  })

  it('clears with a literal null — a present key, never absent and never an empty string (AC1)', () => {
    const h = deps()
    submitSystemPrompt(h.d, A, null)
    const payload = payloadOf(h.sent[0])
    expect('system_prompt' in payload).toBe(true)
    expect(payload.system_prompt).toBeNull()
  })

  it('records the in-flight marker BEFORE the send (AC1)', () => {
    // A `prompt-too-long` refusal is this client's own verdict, raised before any frame is built, so a
    // send placed first could draw a refusal with nothing to settle.
    const h = deps()
    submitSystemPrompt(h.d, A, 'x')
    expect(h.order).toEqual(['dispatch', 'send'])
    expect(h.dispatched).toEqual([{ type: 'writeSubmitted', conversationId: A }])
  })

  it('records no text with the marker (AC3)', () => {
    const h = deps()
    submitSystemPrompt(h.d, A, 'a secret prompt')
    expect(Object.keys(h.dispatched[0]).sort()).toEqual(['conversationId', 'type'])
    expect(JSON.stringify(h.dispatched[0])).not.toContain('a secret prompt')
  })

  it('an unaddressable conversation neither sends nor records a marker', () => {
    // An unroutable id draws no outcome ever, so a marker recorded for one would stand until a
    // reconnect swept it.
    const h = deps()
    submitSystemPrompt(h.d, '', 'x')
    expect(h.sent).toEqual([])
    expect(h.dispatched).toEqual([])
  })

  it('logs nothing on any path', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {})
    )
    const h = deps()
    submitSystemPrompt(h.d, A, 'Answer in Finnish.')
    submitSystemPrompt(h.d, '', null)
    translateSystemPromptWriteEvent({
      type: 'systemPromptWriteRejected',
      conversationId: A,
      reason: 'prompt-too-long'
    })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('SystemPromptWriteData', () => {
  it('renders nothing and dereferences window.pyry only inside its effect', () => {
    expect(renderToStaticMarkup(createElement(SystemPromptWriteData))).toBe('')
  })
})
