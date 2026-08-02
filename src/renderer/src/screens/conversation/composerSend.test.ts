import { describe, it, expect, vi } from 'vitest'
import {
  submitMessage,
  shouldSubmitOnKeyDown,
  composerAvailability,
  shouldOfferRepair,
  shouldShowBanner
} from './composerSend'
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { ThreadEvent } from '../../store/threadTimeline'
import type { HelloAckPayload } from '@shared/wire/types'

// submitMessage is a pure, React-free function (the pairingState precedent): its three effects
// are injected, so it is exercised here with plain spies and a deterministic id stub — no store,
// no Electron bridge, no DOM.

describe('submitMessage', () => {
  it('returns false and performs no effect for whitespace-only or empty input', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      const sendCommand = vi.fn()
      const dispatch = vi.fn()
      const newMessageId = vi.fn(() => 'unused')
      expect(submitMessage(blank, 'conv-1', { sendCommand, dispatch, newMessageId })).toBe(false)
      expect(sendCommand).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
      expect(newMessageId).not.toHaveBeenCalled()
    }
  })

  // #448: sending without an active conversation is a no-op, NOT a send to a placeholder id. The
  // daemon rejects an unknown conversation_id with an error frame, so a null active conversation
  // must gate the send exactly like not-connected does: no wire command, no optimistic echo, input
  // preserved (return false).
  it('returns false and performs no effect when the active conversation id is null (#448)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const newMessageId = vi.fn(() => 'unused')
    expect(submitMessage('hello', null, { sendCommand, dispatch, newMessageId })).toBe(false)
    expect(sendCommand).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(newMessageId).not.toHaveBeenCalled()
  })

  it('sends exactly one sendMessage command targeting the ACTIVE conversation id (#448)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const newMessageId = vi.fn(() => 'mint-1')

    const result = submitMessage('hello', '130648a8-real-id', { sendCommand, dispatch, newMessageId })

    expect(result).toBe(true)
    expect(newMessageId).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    // The wire payload still mints and carries a message_id (SendMessagePayload), unlike the
    // timeline echo below, which carries only text.
    expect(sendCommand).toHaveBeenCalledWith(
      sendMessageCommand({
        conversation_id: '130648a8-real-id',
        message_id: 'mint-1',
        text: 'hello'
      })
    )
  })

  it('dispatches exactly one userText timeline echo carrying the trimmed text (#179 AC3)', () => {
    const dispatch = vi.fn()

    submitMessage('  hey there  ', 'conv-1', {
      sendCommand: vi.fn(),
      dispatch,
      newMessageId: () => 'echo-1'
    })

    // The echo now routes into timelineStore as a userText ThreadEvent — no message_id,
    // conversation_id, or role (the userText model carries only text). The daemon re-echo dedup
    // is retired: interactive mode has no user-message DaemonEvent arm, so this is the sole source.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'userText', text: 'hey there' })
  })

  it('trims leading/trailing whitespace before both the send payload and the timeline echo', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    submitMessage('\n  spaced  \t', 'conv-1', { sendCommand, dispatch, newMessageId: () => 't1' })

    const command = sendCommand.mock.calls[0][0] as RendererCommand
    const sentText = command.type === 'sendMessage' ? command.payload.text : undefined
    const event = dispatch.mock.calls[0][0] as ThreadEvent
    const echoText = event.type === 'userText' ? event.text : undefined
    expect(sentText).toBe('spaced')
    expect(echoText).toBe('spaced')
  })

  it('swallows a send-bridge failure (AC4): still echoes optimistically and returns true', () => {
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })
    const dispatch = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let result: boolean | undefined
    expect(() => {
      result = submitMessage('hello', 'conv-1', { sendCommand, dispatch, newMessageId: () => 'g1' })
    }).not.toThrow()

    expect(result).toBe(true)
    // The optimistic echo is appended regardless of send outcome.
    expect(dispatch).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})

// shouldSubmitOnKeyDown is the keystroke-intent predicate (#512), tested with plain values: there is
// no DOM harness here (vitest `environment: 'node'`), and `Composer` is module-local so it cannot be
// rendered at all — the decision is lifted out of the handler exactly so it can be exercised this way.
describe('shouldSubmitOnKeyDown', () => {
  it('plain Enter with no composition in progress submits (AC2)', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
  })

  // #512, the fix: the Enter that COMMITS an IME candidate reports an in-progress composition. It
  // must not submit — submitting there sends half-composed text and blanks the input mid-word.
  it('Enter that commits an IME composition does not submit (AC1)', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })

  it('Shift+Enter does not submit — the newline is preserved (AC2)', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
  })

  it('both suppressors at once still does not submit — neither cancels the other', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: true, isComposing: true })).toBe(false)
  })

  // The predicate matches on `key`, not `code`. 'NumpadEnter' is a `code`, and a real browser reports
  // `key === 'Enter'` for that physical key; it appears here only as a "not the string Enter" case.
  it('no other key submits, under any shift/composition combination', () => {
    for (const key of ['a', 'Escape', 'Tab', 'NumpadEnter']) {
      for (const shiftKey of [false, true]) {
        for (const isComposing of [false, true]) {
          expect(shouldSubmitOnKeyDown({ key, shiftKey, isComposing })).toBe(false)
        }
      }
    }
  })
})

// composerAvailability is the pure gate (#31): a total mapping over ConnectionStatus's four arms
// governing whether the composer's send control accepts input, and — when it doesn't — a short
// caption saying why. React-free, so the send/no-send decision (AC1) and the "why" copy (AC2) are
// unit-testable without a DOM, the same reason submitMessage is pure.
describe('composerAvailability', () => {
  const ack: HelloAckPayload = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('connected → can send, no hint', () => {
    expect(composerAvailability({ type: 'connected', ack })).toEqual({ canSend: true, hint: null })
  })

  it('connecting → cannot send, with a non-empty hint', () => {
    const { canSend, hint } = composerAvailability({ type: 'connecting' })
    expect(canSend).toBe(false)
    expect(hint).toBeTruthy()
  })

  it('disconnected → cannot send, with a non-empty hint', () => {
    const { canSend, hint } = composerAvailability({ type: 'disconnected' })
    expect(canSend).toBe(false)
    expect(hint).toBeTruthy()
  })

  it('error → cannot send, with a hint that does NOT leak ConnectionError.message', () => {
    const { canSend, hint } = composerAvailability({
      type: 'error',
      error: { code: 'transport', message: 'BANNER-ONLY-TEXT', retryable: true }
    })
    expect(canSend).toBe(false)
    expect(hint).toBeTruthy()
    // ConnectionError.message is the connection banner's surface, explicitly out of scope for #31.
    // The composer hint is a short generic label and must not surface the banner's text.
    expect(hint).not.toContain('BANNER-ONLY-TEXT')
  })

  it('the three not-connected arms yield distinct hints tied to their status (AC2)', () => {
    const hints = [
      composerAvailability({ type: 'connecting' }).hint,
      composerAvailability({ type: 'disconnected' }).hint,
      composerAvailability({
        type: 'error',
        error: { code: 'transport', message: 'x', retryable: false }
      }).hint
    ]
    expect(new Set(hints).size).toBe(3)
  })
})

// shouldOfferRepair is the pure predicate (#167) deciding when the app proactively surfaces a re-pair
// escape hatch: true ONLY for a terminal, non-retryable connection `error`. React-free and store-free,
// the same discipline as composerAvailability, so the whole true/false matrix is unit-testable without
// a DOM. The three retryability sources are validated against the merged transport in the spec.
describe('shouldOfferRepair', () => {
  const ack: HelloAckPayload = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('true for a terminal transport error (supervisor gave up / fatal close code — always non-retryable)', () => {
    expect(
      shouldOfferRepair({
        type: 'error',
        error: { code: 'transport', message: 'gave up', retryable: false }
      })
    ).toBe(true)
  })

  it('true for a terminal handshake error (daemon rejected a stale/unknown device, close 4401)', () => {
    expect(
      shouldOfferRepair({
        type: 'error',
        error: { code: 'handshake', message: 'unauthorized', retryable: false }
      })
    ).toBe(true)
  })

  it('false for connected / connecting / disconnected — not the error arm', () => {
    expect(shouldOfferRepair({ type: 'connected', ack })).toBe(false)
    expect(shouldOfferRepair({ type: 'connecting' })).toBe(false)
    expect(shouldOfferRepair({ type: 'disconnected' })).toBe(false)
  })

  // AC4: a retryable daemon wire-error (server.binary_offline, rate_limited) is a transient daemon-side
  // condition, not a broken pairing — the composer keeps its plain error hint, no re-pair prompt.
  it('false for a retryable daemon error (server.binary_offline)', () => {
    expect(
      shouldOfferRepair({
        type: 'error',
        error: { code: 'server.binary_offline', message: 'binary offline', retryable: true }
      })
    ).toBe(false)
  })

  // AC5: runUnpair dispatches UNPAIR_FAILED_ERROR { code: 'unpair', retryable: false } when the clear
  // itself fails. Without the code guard, a failed re-pair would immediately re-offer itself in a loop.
  it("false for the self-inflicted unpair-failure error (code 'unpair')", () => {
    expect(
      shouldOfferRepair({
        type: 'error',
        error: { code: 'unpair', message: 'Could not forget this pairing.', retryable: false }
      })
    ).toBe(false)
  })
})

// shouldShowBanner is the pure predicate (#279) deciding when the prominent, disconnected-only
// connection banner shows: true for every non-connected arm, false only when connected. React-free
// and store-free, the same discipline as composerAvailability / shouldOfferRepair, so the whole
// truth table is unit-testable without a DOM. The `!== 'connected'` shape (not an exhaustive switch)
// is deliberate: every non-connected arm maps to the SAME behavior (show the banner).
describe('shouldShowBanner', () => {
  const ack: HelloAckPayload = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('false when connected — the banner is absent (AC2)', () => {
    expect(shouldShowBanner({ type: 'connected', ack })).toBe(false)
  })

  it('true when disconnected (AC1)', () => {
    expect(shouldShowBanner({ type: 'disconnected' })).toBe(true)
  })

  it('true when connecting (AC1)', () => {
    expect(shouldShowBanner({ type: 'connecting' })).toBe(true)
  })

  it('true when in a connection error (AC1)', () => {
    expect(
      shouldShowBanner({
        type: 'error',
        error: { code: 'transport', message: 'gave up', retryable: false }
      })
    ).toBe(true)
  })
})
