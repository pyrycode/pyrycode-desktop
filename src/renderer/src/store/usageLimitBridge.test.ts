import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import { translateRateLimited, subscribeUsageLimit, UsageLimitData } from './usageLimitBridge'
import { createUsageLimitStore, selectUsageLimitFor } from './usageLimitStore'

// Framework-free data-path tests with injected spies (the announcedModelBridge idiom): no React, no
// Electron. The real store is wired only for the nothing-held → held seam tests.
//
// The routing decision is what this file mostly pins. `subscribeUsageLimit` sends an arriving reading to
// ONE OF TWO store mutations on a single exact-equality comparison against a client-owned constant, so
// every case below names which of the two spies it expects and asserts the other was not called. The
// `allowed_warning` case is the sharpest: it is the only non-benign status ever measured, it STARTS WITH
// the benign one, and a `startsWith` or `includes` comparison would silently discard the single reading
// this whole vertical exists to show.

const NOW = 1_700_000_000
const RESETS_AT = 1_800_000_000

/** Read one conversation's reading out of a real store instance, well inside its window. */
const readingFor = (
  store: ReturnType<typeof createUsageLimitStore>,
  conversationId: string
): { status: string; limitType: string; resetsAt: number } | null =>
  selectUsageLimitFor(conversationId, NOW)(store.getState())

/** The owned arm, extracted from the union. `Omit<DaemonEvent, 'type'>` would NOT do: `Omit` over a
 *  union keeps only the keys every member shares, so every field this helper overrides would be
 *  rejected — and `npm run build` is the only gate that says so, since vitest strips types. */
type RateLimitedEvent = Extract<DaemonEvent, { type: 'rateLimited' }>

const rateLimited = (over: Partial<Omit<RateLimitedEvent, 'type'>> = {}): DaemonEvent => ({
  type: 'rateLimited',
  conversationId: 'conv-1',
  status: 'allowed_warning',
  limitType: 'seven_day',
  resetsAt: RESETS_AT,
  ...over
})

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateRateLimited', () => {
  it('maps a rateLimited to its four fields (the owned arm)', () => {
    expect(translateRateLimited(rateLimited())).toEqual({
      conversationId: 'conv-1',
      status: 'allowed_warning',
      limitType: 'seven_day',
      resetsAt: RESETS_AT
    })
  })

  it('returns a FRESH literal, not the event — `type` never reaches the store', () => {
    const event = rateLimited()
    const result = translateRateLimited(event)
    expect(result).not.toBeNull()
    expect(result === null || 'type' in result).toBe(false)
    expect(result).not.toBe(event)
  })

  it('carries both claude-authored strings VERBATIM — no trim, no case fold, no allow-list', () => {
    // The daemon bounds them at construction and does NOT sanitize them, and the value set beyond the
    // benign status is UNMEASURED, so a client that narrows either drops the first real limit that
    // fires. #1321 selects client-owned copy by these with a generic fallback on a miss.
    expect(
      translateRateLimited(
        rateLimited({ status: '  Weekly_Limit_Reached\n', limitType: 'unmeasured_new_kind' })
      )
    ).toEqual({
      conversationId: 'conv-1',
      status: '  Weekly_Limit_Reached\n',
      limitType: 'unmeasured_new_kind',
      resetsAt: RESETS_AT
    })
  })

  it('carries resetsAt VERBATIM, including 0, a negative and a far-future value', () => {
    // Unvalidated in both directions: `0` means claude reported no reset (NOT the epoch), and negative
    // and year-40000 values are representable and rejected nowhere. The translate step re-decides none
    // of that; the store's selector is the only place the number means anything.
    for (const resetsAt of [0, -1, 1_000_000_000_000]) {
      expect(translateRateLimited(rateLimited({ resetsAt }))).toMatchObject({ resetsAt })
    }
  })

  it('carries the routing key VERBATIM, whatever the daemon asserted', () => {
    // Daemon-asserted and NOT normalised, allow-listed or checked against the open conversation here —
    // it is carried onward as the map key it will become, and an id matching no conversation a reader
    // can select simply lands under its own key. There is no `?? activeConversation` fallback on this
    // path and no filter that could be a weaker no-match than that.
    for (const conversationId of ['matches-no-conversation', '__proto__', 'constructor', '']) {
      expect(translateRateLimited(rateLimited({ conversationId }))).toMatchObject({ conversationId })
    }
  })

  it('returns null for a sample of unrelated daemon events', () => {
    // `thinkingProgress` and `runConfigReceived` are the two nearest neighbours on the union — the
    // first is the other conversation-scoped reading with no `turn_id`, the second the reply-only arm
    // this bridge must never pick up.
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'thinkingProgress', estimatedTokens: 42, conversationId: 'conv-1' },
      {
        type: 'runConfigReceived',
        conversationId: 'conv-1',
        sessionId: 's',
        model: 'some-override',
        effort: '',
        yolo: false,
        permissionMode: 'default',
        used_tokens: 0,
        window_tokens: 0
      },
      { type: 'compacting', active: true, conversationId: 'conv-1' },
      { type: 'conversationsReceived', conversations: [] }
    ]
    for (const event of others) expect(translateRateLimited(event)).toBeNull()
  })
})

describe('subscribeUsageLimit', () => {
  /** A fake onDaemonEvent that captures the listener and hands back an off spy. */
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
    off: ReturnType<typeof vi.fn>
    subscribeCalls: () => number
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listener = l
      return off
    })
    return {
      onDaemonEvent,
      emit: (e) => listener?.(e),
      off,
      subscribeCalls: () => onDaemonEvent.mock.calls.length
    }
  }

  it('subscribes exactly once and returns the off handle', () => {
    const bridge = fakeBridge()
    const unsubscribe = subscribeUsageLimit(bridge.onDaemonEvent, vi.fn(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
    expect(unsubscribe).toBe(bridge.off)
  })

  it('records a non-benign reading through setUsageLimit (AC1)', () => {
    const bridge = fakeBridge()
    const setUsageLimit = vi.fn()
    const clearUsageLimitFor = vi.fn()
    subscribeUsageLimit(bridge.onDaemonEvent, setUsageLimit, clearUsageLimitFor)

    bridge.emit(rateLimited())

    expect(setUsageLimit).toHaveBeenCalledTimes(1)
    expect(setUsageLimit).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      status: 'allowed_warning',
      limitType: 'seven_day',
      resetsAt: RESETS_AT
    })
    expect(clearUsageLimitFor).not.toHaveBeenCalled()
  })

  it('an `allowed` reading clears that conversation’s entry instead of recording it (AC2)', () => {
    const bridge = fakeBridge()
    const setUsageLimit = vi.fn()
    const clearUsageLimitFor = vi.fn()
    subscribeUsageLimit(bridge.onDaemonEvent, setUsageLimit, clearUsageLimitFor)

    bridge.emit(rateLimited({ status: 'allowed' }))

    expect(clearUsageLimitFor).toHaveBeenCalledTimes(1)
    expect(clearUsageLimitFor).toHaveBeenCalledWith('conv-1')
    expect(setUsageLimit).not.toHaveBeenCalled()
  })

  it('the clear takes the id and NOTHING else — no daemon content crosses into the store', () => {
    const bridge = fakeBridge()
    const clearUsageLimitFor = vi.fn()
    subscribeUsageLimit(bridge.onDaemonEvent, vi.fn(), clearUsageLimitFor)

    bridge.emit(rateLimited({ status: 'allowed', limitType: 'seven_day', resetsAt: RESETS_AT }))

    expect(clearUsageLimitFor.mock.calls[0]).toEqual(['conv-1'])
  })

  it('`allowed_warning` RECORDS rather than clears — the comparison is exact equality (AC2)', () => {
    // The sharpest edge in the slice, and one keystroke away: `allowed_warning` is the ONLY non-benign
    // status ever measured (2026-08-22, claude 2.1.239, `limit_type: seven_day`, every turn still
    // running) and it starts with the benign string. A `startsWith` or `includes` test would swallow
    // exactly the reading this vertical exists to surface.
    const bridge = fakeBridge()
    const setUsageLimit = vi.fn()
    const clearUsageLimitFor = vi.fn()
    subscribeUsageLimit(bridge.onDaemonEvent, setUsageLimit, clearUsageLimitFor)

    bridge.emit(rateLimited({ status: 'allowed_warning' }))

    expect(setUsageLimit).toHaveBeenCalledTimes(1)
    expect(clearUsageLimitFor).not.toHaveBeenCalled()
  })

  it.each(['Allowed', 'ALLOWED', ' allowed', 'allowed ', 'allowed_reset', ''])(
    '%j is not the benign status and RECORDS — no case fold, no trim, no prefix test',
    (status) => {
      const bridge = fakeBridge()
      const setUsageLimit = vi.fn()
      const clearUsageLimitFor = vi.fn()
      subscribeUsageLimit(bridge.onDaemonEvent, setUsageLimit, clearUsageLimitFor)

      bridge.emit(rateLimited({ status }))

      expect(setUsageLimit).toHaveBeenCalledTimes(1)
      expect(clearUsageLimitFor).not.toHaveBeenCalled()
    }
  )

  it('an unrelated event calls neither mutation', () => {
    const bridge = fakeBridge()
    const setUsageLimit = vi.fn()
    const clearUsageLimitFor = vi.fn()
    subscribeUsageLimit(bridge.onDaemonEvent, setUsageLimit, clearUsageLimitFor)

    bridge.emit({ type: 'connecting' })
    bridge.emit({ type: 'messageReceived', message })
    bridge.emit({ type: 'thinkingProgress', estimatedTokens: 7, conversationId: 'conv-1' })

    expect(setUsageLimit).not.toHaveBeenCalled()
    expect(clearUsageLimitFor).not.toHaveBeenCalled()
  })

  it('lands each reading under its OWN conversation, leaving siblings untouched (AC1)', () => {
    const bridge = fakeBridge()
    const store = createUsageLimitStore()
    subscribeUsageLimit(
      bridge.onDaemonEvent,
      (s) => store.getState().setUsageLimit(s),
      (id) => store.getState().clearUsageLimitFor(id)
    )

    bridge.emit(rateLimited({ conversationId: 'conv-a', status: 'status_on_a' }))
    bridge.emit(rateLimited({ conversationId: 'conv-b', status: 'status_on_b', resetsAt: 0 }))

    expect(readingFor(store, 'conv-a')).toMatchObject({ status: 'status_on_a' })
    expect(readingFor(store, 'conv-b')).toMatchObject({ status: 'status_on_b' })
    // ...and a conversation neither reading named still reads nothing.
    expect(readingFor(store, 'never-reported')).toBeNull()
  })

  it('an `allowed` reading clears only its own conversation end to end (AC2)', () => {
    const bridge = fakeBridge()
    const store = createUsageLimitStore()
    subscribeUsageLimit(
      bridge.onDaemonEvent,
      (s) => store.getState().setUsageLimit(s),
      (id) => store.getState().clearUsageLimitFor(id)
    )

    bridge.emit(rateLimited({ conversationId: 'conv-a' }))
    bridge.emit(rateLimited({ conversationId: 'conv-b' }))
    bridge.emit(rateLimited({ conversationId: 'conv-a', status: 'allowed' }))

    expect(readingFor(store, 'conv-a')).toBeNull()
    expect(readingFor(store, 'conv-b')).not.toBeNull()
  })

  it('an `allowed` reading for a conversation holding nothing is a silent no-op (AC2)', () => {
    const bridge = fakeBridge()
    const store = createUsageLimitStore()
    subscribeUsageLimit(
      bridge.onDaemonEvent,
      (s) => store.getState().setUsageLimit(s),
      (id) => store.getState().clearUsageLimitFor(id)
    )
    const before = store.getState().readings

    expect(() => bridge.emit(rateLimited({ status: 'allowed' }))).not.toThrow()

    expect(store.getState().readings).toBe(before)
  })

  it('a later reading replaces an earlier one for the same conversation end to end (AC1)', () => {
    const bridge = fakeBridge()
    const store = createUsageLimitStore()
    subscribeUsageLimit(
      bridge.onDaemonEvent,
      (s) => store.getState().setUsageLimit(s),
      (id) => store.getState().clearUsageLimitFor(id)
    )

    bridge.emit(rateLimited({ status: 'first', limitType: 'five_hour' }))
    bridge.emit(rateLimited({ status: 'second', limitType: 'seven_day' }))

    expect(readingFor(store, 'conv-1')).toEqual({
      status: 'second',
      limitType: 'seven_day',
      resetsAt: RESETS_AT
    })
  })

  it('a hostile conversation id lands under its own key and reaches no other entry', () => {
    const bridge = fakeBridge()
    const store = createUsageLimitStore()
    subscribeUsageLimit(
      bridge.onDaemonEvent,
      (s) => store.getState().setUsageLimit(s),
      (id) => store.getState().clearUsageLimitFor(id)
    )

    bridge.emit(rateLimited({ conversationId: '__proto__', status: 'hostile' }))

    expect(readingFor(store, '__proto__')).toMatchObject({ status: 'hostile' })
    expect(readingFor(store, 'conv-1')).toBeNull()
    expect(store.getState().readings.size).toBe(1)
  })
})

describe('UsageLimitData (container)', () => {
  // Server-render sanity — the AnnouncedModelData idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (deps / StrictMode) is verified by inspection
  // against the off-handle-as-cleanup idiom, not unit-tested — this repo's renderer tests are static
  // server renders that mount no effects.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(UsageLimitData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
