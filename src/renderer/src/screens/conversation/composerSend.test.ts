import { describe, it, expect, vi } from 'vitest'
import {
  submitMessage,
  shouldSubmitOnKeyDown,
  shouldInterruptOnKeyDown,
  composerAvailability,
  shouldOfferRepair,
  shouldShowBanner,
  CONNECTION_BANNER_COPY,
  COMPOSER_ERROR_CHIP_COPY,
  COMPOSER_ERROR_CHIP_PREFIX_COPY,
  COMPOSER_REPAIR_BUTTON_COPY
} from './composerSend'
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { MessageAttachment, ThreadEvent } from '../../store/threadTimeline'
import type { HelloAckPayload } from '@shared/wire/types'

// submitMessage is a pure, React-free function (the pairingState precedent): its three effects
// are injected, so it is exercised here with plain spies and a deterministic id stub — no store,
// no Electron bridge, no DOM.

describe('submitMessage', () => {
  it('returns false and performs no effect for whitespace-only or empty input', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      const sendCommand = vi.fn()
      const dispatch = vi.fn()
      const dispatchFor = vi.fn()
      const newMessageId = vi.fn(() => 'unused')
      expect(
        submitMessage(blank, 'conv-1', { sendCommand, dispatch, dispatchFor, newMessageId })
      ).toBe(false)
      expect(sendCommand).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
      // #756: the keyed write sits beside the flat one, so it is gated by the same early return.
      expect(dispatchFor).not.toHaveBeenCalled()
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
    const dispatchFor = vi.fn()
    const newMessageId = vi.fn(() => 'unused')
    expect(
      submitMessage('hello', null, { sendCommand, dispatch, dispatchFor, newMessageId })
    ).toBe(false)
    expect(sendCommand).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    // #756: with no conversation to attribute the echo to, there is nothing to route it into either.
    expect(dispatchFor).not.toHaveBeenCalled()
    expect(newMessageId).not.toHaveBeenCalled()
  })

  it('sends exactly one sendMessage command targeting the ACTIVE conversation id (#448)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()
    const newMessageId = vi.fn(() => 'mint-1')

    const result = submitMessage('hello', '130648a8-real-id', {
      sendCommand,
      dispatch,
      dispatchFor,
      newMessageId
    })

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
      dispatchFor: vi.fn(),
      newMessageId: () => 'echo-1'
    })

    // The echo now routes into timelineStore as a userText ThreadEvent — no message_id,
    // conversation_id, or role (the userText model carries only text). The daemon re-echo dedup
    // is retired: interactive mode has no user-message DaemonEvent arm, so this is the sole source.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'userText', text: 'hey there' })
  })

  // #756: the echo is the timeline's second row-adding writer, so it routes into the conversation it
  // was SENT TO — the id already handed to submitMessage, never a re-read of anything.
  it('#756: routes the echo into the keyed holder under the conversation it was sent to', () => {
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()

    submitMessage('  hey there  ', 'conv-b', {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor,
      newMessageId: () => 'echo-2'
    })

    expect(dispatchFor).toHaveBeenCalledTimes(1)
    expect(dispatchFor).toHaveBeenCalledWith('conv-b', { type: 'userText', text: 'hey there' })
    // Built ONCE and handed to both write paths: the same reference, not two equal literals. Safe
    // because reduceTimeline is pure (conversationTimelineStore.ts:268-270), and asserting identity
    // is what keeps a future "build it again for the keyed store" edit from passing silently.
    expect(dispatchFor.mock.calls[0][1]).toBe(dispatch.mock.calls[0][0])
  })

  // #1013: the echo is stamped at the moment of send, from an injected clock. The container wires
  // `now: Date.now`; a spec injects a constant and asserts the exact value, so nothing here reads the
  // machine's wall clock (AC3).
  it('#1013: stamps the echo with the injected clock, the same value on both write paths', () => {
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()
    const now = vi.fn(() => 1_700_000_000_000)

    submitMessage('hey there', 'conv-1', {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor,
      newMessageId: () => 'echo-3',
      now
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'userText',
      text: 'hey there',
      createdAt: 1_700_000_000_000
    })
    expect(dispatchFor).toHaveBeenCalledWith('conv-1', {
      type: 'userText',
      text: 'hey there',
      createdAt: 1_700_000_000_000
    })
    // One echo object, so one read of the clock — the two stores cannot record different instants for
    // the same message. This is the built-ONCE property, asserted at the clock rather than at identity.
    expect(now).toHaveBeenCalledTimes(1)
  })

  it('#1013: leaves the echo unstamped when no clock is injected (the standing-fixture guarantee)', () => {
    const dispatch = vi.fn()

    submitMessage('hey there', 'conv-1', {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor: vi.fn(),
      newMessageId: () => 'echo-4'
    })

    const [echo] = dispatch.mock.calls[0] as [{ createdAt?: number }]
    expect(echo.createdAt).toBe(undefined)
  })

  it('#1013: does not read the clock when the submit is refused', () => {
    const now = vi.fn(() => 1_700_000_000_000)
    const deps = {
      sendCommand: vi.fn(),
      dispatch: vi.fn(),
      dispatchFor: vi.fn(),
      newMessageId: () => 'unused',
      now
    }
    expect(submitMessage('   ', 'conv-1', deps)).toBe(false)
    expect(submitMessage('hi', null, deps)).toBe(false)
    expect(now).not.toHaveBeenCalled()
  })

  // ================================================================================================
  // #1039 — the attachments the send records. `takeAttachments` is read once, past both `false`
  // returns, exactly where the clock above is: that placement IS the fourth criterion, because the
  // hook's take is also its CLEAR. A submit that sends nothing never calls it, so nothing is cleared.
  // ================================================================================================

  const REPORT: MessageAttachment = { attachmentId: 'upload-1', filename: 'report.pdf' }
  const SHOT: MessageAttachment = { attachmentId: 'upload-2', filename: 'clipboard-2026.png' }

  /** A take whose rollback is a spy, so a test can assert whether the send put the set back (#1055). */
  const takeOf = (
    attachments: readonly MessageAttachment[]
  ): { attachments: readonly MessageAttachment[]; rollback: ReturnType<typeof vi.fn> } => ({
    attachments,
    rollback: vi.fn()
  })

  it('#1039: records the taken attachments on the echo, the same list on both write paths', () => {
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()
    const pending = [REPORT, SHOT]
    const takeAttachments = vi.fn(() => takeOf(pending))

    submitMessage('here you go', 'conv-1', {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor,
      newMessageId: () => 'a1',
      takeAttachments
    })

    // Taken ONCE, so the flat store and the keyed holder cannot record two different sets for one
    // message — the built-once property asserted at the take, the way #1013 asserts it at the clock.
    expect(takeAttachments).toHaveBeenCalledTimes(1)
    const [echo] = dispatch.mock.calls[0] as [Extract<ThreadEvent, { type: 'userText' }>]
    expect(echo.attachments).toBe(pending)
    expect(dispatchFor.mock.calls[0][1]).toBe(echo)
  })

  // AC2: nothing pending ⇒ the field is ABSENT, not an empty list. The composer is where that
  // normalisation happens, so the store never sees `[]` and "absent means none" stays the only reading.
  it('#1039: leaves the field absent when the take answers an empty list (AC2)', () => {
    const dispatch = vi.fn()

    submitMessage('just text', 'conv-1', {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor: vi.fn(),
      newMessageId: () => 'a2',
      takeAttachments: () => takeOf([])
    })

    const [echo] = dispatch.mock.calls[0] as [Extract<ThreadEvent, { type: 'userText' }>]
    expect(echo.attachments).toBe(undefined)
  })

  // The shape the thirteen shipped deps literals in this file keep: an unwired take is an unstamped
  // echo, `now`'s rule exactly, and no field appears where none did before.
  it('#1039: leaves the field absent when no take is wired at all', () => {
    const dispatch = vi.fn()

    submitMessage('just text', 'conv-1', {
      sendCommand: vi.fn(),
      dispatch,
      dispatchFor: vi.fn(),
      newMessageId: () => 'a3'
    })

    const [echo] = dispatch.mock.calls[0] as [Extract<ThreadEvent, { type: 'userText' }>]
    expect(echo.attachments).toBe(undefined)
    expect(dispatch).toHaveBeenCalledWith({ type: 'userText', text: 'just text' })
  })

  // ⭐ AC4's second half, and the whole reason the take sits below both `false` returns: the hook's take
  // is destructive, so a submit that sends nothing must not perform it — the operator's attached file
  // has to survive a blank Enter and a send with no active conversation.
  it('#1039: does not take when the submit is refused, so the pending set survives (AC4)', () => {
    const takeAttachments = vi.fn(() => takeOf([REPORT]))
    const deps = {
      sendCommand: vi.fn(),
      dispatch: vi.fn(),
      dispatchFor: vi.fn(),
      newMessageId: () => 'unused',
      takeAttachments
    }
    expect(submitMessage('   ', 'conv-1', deps)).toBe(false)
    expect(submitMessage('hi', null, deps)).toBe(false)
    expect(takeAttachments).not.toHaveBeenCalled()
  })

  // ================================================================================================
  // #1055 — the outbound half. The ids ride the frame, so the take now happens ABOVE the guarded send
  // (the payload literal needs them), and the send's outcome is what decides whether it stands.
  // ================================================================================================

  /** The payload as it reaches the WIRE: what buildSendMessage hands to JSON.stringify. */
  const sentPayload = (sendCommand: ReturnType<typeof vi.fn>): Record<string, unknown> => {
    const [command] = sendCommand.mock.calls[0] as [RendererCommand]
    if (command.type !== 'sendMessage') throw new Error(`unexpected command ${command.type}`)
    return JSON.parse(JSON.stringify(command.payload)) as Record<string, unknown>
  }

  it('#1055: names the taken attachment ids on the frame, in the pending set order (AC1)', () => {
    const sendCommand = vi.fn()

    submitMessage('here you go', 'conv-1', {
      sendCommand,
      dispatch: vi.fn(),
      dispatchFor: vi.fn(),
      newMessageId: () => 'w1',
      takeAttachments: () => takeOf([REPORT, SHOT])
    })

    // Ids only — the filename is the window's own display supply and has no field on this frame.
    expect(sentPayload(sendCommand)).toEqual({
      conversation_id: 'conv-1',
      message_id: 'w1',
      text: 'here you go',
      attachment_ids: ['upload-1', 'upload-2']
    })
  })

  // AC1's second half, asserted on the SERIALIZED form rather than on the object: `undefined` is
  // assigned unconditionally (the `createdAt` idiom) and JSON.stringify is what drops the key, so the
  // in-memory payload legitimately carries `attachment_ids: undefined` while the wire carries no key.
  it('#1055: carries NO attachment_ids key at all when nothing was taken (AC1)', () => {
    for (const take of [() => takeOf([]), undefined]) {
      const sendCommand = vi.fn()
      submitMessage('just text', 'conv-1', {
        sendCommand,
        dispatch: vi.fn(),
        dispatchFor: vi.fn(),
        newMessageId: () => 'w2',
        takeAttachments: take
      })
      const payload = sentPayload(sendCommand)
      expect('attachment_ids' in payload).toBe(false)
      expect(payload).toEqual({ conversation_id: 'conv-1', message_id: 'w2', text: 'just text' })
    }
  })

  it('#1055: the frame and the echo name exactly the same attachments (AC2)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    submitMessage('with files', 'conv-1', {
      sendCommand,
      dispatch,
      dispatchFor: vi.fn(),
      newMessageId: () => 'w3',
      takeAttachments: () => takeOf([REPORT, SHOT])
    })

    const [echo] = dispatch.mock.calls[0] as [Extract<ThreadEvent, { type: 'userText' }>]
    expect(sentPayload(sendCommand).attachment_ids).toEqual(
      (echo.attachments ?? []).map((attachment) => attachment.attachmentId)
    )
  })

  // ⭐ AC3, and what it retires: the #1039 contract said a bridge failure "still records and still
  // clears". It cannot, now that the ids ride the frame — if the frame did not go it named nothing, so
  // the echo records nothing and the files stay attached for the retry. The alternative (echo shows
  // them AND they stay pending) would duplicate them on the next send.
  it('#1055: a throwing send rolls the take back and records nothing on the echo (AC3)', () => {
    const dispatch = vi.fn()
    const dispatchFor = vi.fn()
    const take = takeOf([REPORT])
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = submitMessage('with a file', 'conv-1', {
      sendCommand: () => {
        throw new Error('bridge down')
      },
      dispatch,
      dispatchFor,
      newMessageId: () => 'a4',
      takeAttachments: () => take
    })

    // The guarded-send contract is unchanged: swallowed, echo still posts, still `true`.
    expect(result).toBe(true)
    expect(take.rollback).toHaveBeenCalledTimes(1)
    const [echo] = dispatch.mock.calls[0] as [Extract<ThreadEvent, { type: 'userText' }>]
    expect(echo.attachments).toBe(undefined)
    // Both writes share the one object, so neither can disagree with the frame either.
    expect(dispatchFor.mock.calls[0][1]).toBe(echo)
    errorSpy.mockRestore()
  })

  it('#1055: a send that does NOT throw keeps the take — no rollback (AC3)', () => {
    const take = takeOf([REPORT])

    submitMessage('with a file', 'conv-1', {
      sendCommand: vi.fn(),
      dispatch: vi.fn(),
      dispatchFor: vi.fn(),
      newMessageId: () => 'a5',
      takeAttachments: () => take
    })

    expect(take.rollback).not.toHaveBeenCalled()
  })

  it('trims leading/trailing whitespace before both the send payload and the timeline echo', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    submitMessage('\n  spaced  \t', 'conv-1', {
      sendCommand,
      dispatch,
      dispatchFor: vi.fn(),
      newMessageId: () => 't1'
    })

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
    const dispatchFor = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let result: boolean | undefined
    expect(() => {
      result = submitMessage('hello', 'conv-1', {
        sendCommand,
        dispatch,
        dispatchFor,
        newMessageId: () => 'g1'
      })
    }).not.toThrow()

    expect(result).toBe(true)
    // The optimistic echo is appended regardless of send outcome.
    expect(dispatch).toHaveBeenCalledTimes(1)
    // #756: the guarded-send contract covers sendCommand only, so the keyed write is reached too.
    expect(dispatchFor).toHaveBeenCalledTimes(1)
    expect(dispatchFor).toHaveBeenCalledWith('conv-1', { type: 'userText', text: 'hello' })
    // The swallowed error stays content-free — no conversation id and no message text (ADR 0007).
    expect(errorSpy).toHaveBeenCalledWith('composer send failed', expect.anything())
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

// shouldInterruptOnKeyDown is the SECOND keystroke-intent predicate (#1072), sharing the first's record
// and its tier: plain values, no DOM, no React. Both of its mounts — the message box's handleKeyDown and
// the stop control's own onKeyDown — are inside `Composer`/`ComposerSendButton`, whose event wiring the
// node environment structurally cannot exercise, which is exactly why the decision is lifted out here.
describe('shouldInterruptOnKeyDown', () => {
  // The record every case below varies from. `shiftKey` is present because ComposerKeyEvent carries it,
  // NOT because this predicate reads it — see the shift case.
  const escape = { key: 'Escape', shiftKey: false, isComposing: false }

  it('Escape while a turn is running interrupts (AC1/AC2)', () => {
    expect(shouldInterruptOnKeyDown(escape, true)).toBe(true)
  })

  it('Escape at idle does not interrupt (AC3)', () => {
    expect(shouldInterruptOnKeyDown(escape, false)).toBe(false)
  })

  // The load-bearing case, and the reason `isComposing` is among the inputs at all: the type-ahead's own
  // handler returns false on a composing keystroke EVEN WHILE ITS PANEL IS OPEN, so the Escape that
  // cancels a half-typed IME candidate falls straight through to the composer's handler. Without this
  // clause a CJK operator cancelling a candidate mid-turn would stop the turn.
  it('Escape that cancels an IME composition does not interrupt, running or not', () => {
    expect(shouldInterruptOnKeyDown({ ...escape, isComposing: true }, true)).toBe(false)
    expect(shouldInterruptOnKeyDown({ ...escape, isComposing: true }, false)).toBe(false)
  })

  // `shiftKey` is DELIBERATELY not read: Escape has no meaningful shifted variant, and a `!shiftKey`
  // clause would be a defence for a failure mode nobody has observed (the same evidence rule that kept
  // `keyCode === 229` out of shouldSubmitOnKeyDown). This case pins the non-read, so a later "tidy" that
  // adds the clause for symmetry with shouldSubmitOnKeyDown reddens here rather than silently shipping.
  it('Shift+Escape still interrupts — shiftKey is not among this predicate inputs', () => {
    expect(shouldInterruptOnKeyDown({ ...escape, shiftKey: true }, true)).toBe(true)
  })

  // AC5's closing clause, and what leaves Enter's send path (#678 AC4) untouched: no key but Escape ever
  // interrupts, under any shift/composition combination and even with a turn running.
  it('no other key interrupts, under any shift/composition combination', () => {
    for (const key of ['Enter', 'a', 'Tab', 'ArrowDown', 'Esc']) {
      for (const shiftKey of [false, true]) {
        for (const isComposing of [false, true]) {
          expect(shouldInterruptOnKeyDown({ key, shiftKey, isComposing }, true)).toBe(false)
        }
      }
    }
  })
})

// composerAvailability is the pure gate (#31): a total mapping over ConnectionStatus's four arms
// governing whether the composer's send control accepts input. React-free, so the send/no-send decision
// (AC1) is unit-testable without a DOM, the same reason submitMessage is pure.
//
// #968 retired the "why" caption it used to return beside `canSend`. Every arm below asserts with an
// EXACT toEqual rather than reading `.canSend` off the result: exactness is what proves the record holds
// canSend alone in that arm, and it is the assertion that would redden if a future ticket re-introduced a
// copy field. Never relax one of these to toMatchObject.
describe('composerAvailability', () => {
  const ack: HelloAckPayload = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('connected → can send', () => {
    expect(composerAvailability({ type: 'connected', ack })).toEqual({ canSend: true })
  })

  it('connecting → cannot send', () => {
    expect(composerAvailability({ type: 'connecting' })).toEqual({ canSend: false })
  })

  it('disconnected → cannot send', () => {
    expect(composerAvailability({ type: 'disconnected' })).toEqual({ canSend: false })
  })

  // The sentinel outlives the caption it was written for. ConnectionError.message is the connection
  // banner's surface, and this arm is the only one that could ever have carried it into the composer;
  // asserting the WHOLE returned record against { canSend: false } proves structurally that nothing
  // daemon-supplied leaves this function, not merely that one field was sanitised.
  it('error → cannot send, returning nothing derived from ConnectionError.message', () => {
    expect(
      composerAvailability({
        type: 'error',
        error: { code: 'transport', message: 'BANNER-ONLY-TEXT', retryable: true }
      })
    ).toEqual({ canSend: false })
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
  // condition, not a broken pairing — the status row keeps #797's plain error chip, no re-pair button.
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

// #797: the error chip's two client-owned strings — the chip copy is one of the three this module owns
// about the one ConnectionStatus fact (#968 retired the three composerAvailability captions), and the
// prefix rides with it. Their three-part contract is CONNECTION_BANNER_COPY's, and the pieces that can
// break silently are pinned here: the apostrophe-free rule (renderToStaticMarkup escapes `'` → `&#x27;`,
// so an apostrophe makes every toContain on these constants fail without a copy change being suspected),
// the lexical distinctness from the banner and the re-pair button, and the prefix's trailing space,
// which is what separates the two runs when a screen reader concatenates them.
describe('the composer error chip copy (#797)', () => {
  it('is apostrophe-free, so a server-rendered toContain matches it verbatim', () => {
    expect(COMPOSER_ERROR_CHIP_COPY).not.toContain("'")
    expect(COMPOSER_ERROR_CHIP_PREFIX_COPY).not.toContain("'")
  })

  // Pinned against the actual banner constant — not a hardcoded copy of it — so a future tweak to either
  // cannot silently collide. The set held the three composer captions too until #968 retired them; the
  // button that shares this chip's slot is compared in its own describe below.
  it('is lexically distinct from the banner copy', () => {
    const others = [CONNECTION_BANNER_COPY]
    expect(others).not.toContain(COMPOSER_ERROR_CHIP_COPY)
    for (const other of others) {
      expect(other).not.toContain(COMPOSER_ERROR_CHIP_COPY)
      expect(COMPOSER_ERROR_CHIP_COPY).not.toContain(other)
    }
  })

  // The trailing space is load-bearing, not incidental formatting: it is the whole separator in the
  // announced "Error: Host connection down!". An editor's trim would silently degrade that.
  it('keeps the prefix separated from the copy by its trailing space', () => {
    expect(COMPOSER_ERROR_CHIP_PREFIX_COPY).toMatch(/ $/)
    expect(COMPOSER_ERROR_CHIP_PREFIX_COPY.trim()).not.toBe('')
  })
})

// #963: the actionable-error button's label — the FIFTH string this module owns about the one
// ConnectionStatus fact, and the first that is also an ACCESSIBLE NAME (the button has no aria-label, so
// the visible text is the whole name). The chip describe above pins the same three-part contract for its
// two strings; this one adds the button's own reason for the apostrophe rule and the distinctness set
// grows to include the chip copy the button REPLACES in its slot.
describe('the actionable-error button copy (#963)', () => {
  it('is apostrophe-free, so a server-rendered toContain matches it verbatim', () => {
    expect(COMPOSER_REPAIR_BUTTON_COPY).not.toContain("'")
  })

  // Pinned against the actual constants — never against hardcoded copies of them — so a future tweak to
  // either cannot silently collide with this label. The set held the three composer captions until #968
  // retired them. The chip copy stays in it even though the two never render together: they occupy the
  // SAME slot, so a reader who sees one and then the other must not read them as the same string.
  it('is lexically distinct from the chip copy and the banner copy', () => {
    const others = [COMPOSER_ERROR_CHIP_COPY, CONNECTION_BANNER_COPY]
    for (const other of others) {
      expect(other).not.toContain(COMPOSER_REPAIR_BUTTON_COPY)
      expect(COMPOSER_REPAIR_BUTTON_COPY).not.toContain(other)
    }
  })

  // The design's label pattern is "Type of error - Action", and both halves are load-bearing: the type
  // is what makes the button self-describing to a screen reader without the chip's hidden `Error: `
  // prefix (AC4), and the action is what makes it a button rather than a status. A trim to just the
  // action would pass every other assertion here.
  it('names the error type ahead of the action, so the accessible name says both', () => {
    const [type, action] = COMPOSER_REPAIR_BUTTON_COPY.split(' - ')
    expect(type).toBe('Pairing error')
    expect(action).toBe('Re-pair')
  })
})
