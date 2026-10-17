import { createThreadSendStore } from '../../store/threadSendStore'
import { describe, it, expect, vi } from 'vitest'
import {
  submitMessage,
  shouldSubmitOnKeyDown,
  shouldInterruptOnKeyDown,
  composerAvailability,
  shouldOfferRepair,
  shouldOfferReconnect,
  COMPOSER_RECONNECT_BUTTON_COPY,
  shouldShowBanner,
  CONNECTION_BANNER_COPY,
  COMPOSER_REPAIR_BUTTON_COPY
} from './composerSend'
import { sendMessageCommand, type RendererCommand } from '@shared/ipc/commands'
import type { MessageAttachment, ThreadEvent } from '../../store/threadTimeline'
import type { HelloAckPayload } from '@shared/wire/types'

// submitMessage is a pure, React-free function (the pairingState precedent): its three effects
// are injected, so it is exercised here with plain spies and a deterministic id stub — no store,
// no Electron bridge, no DOM.

const pending = () => ({ serverId: 'host', threadSend: { store: createThreadSendStore(), deviceId: 'device' } })
describe('submitMessage', () => {
  it('refuses empty input or no conversation before claiming attachments or minting identity', () => {
    const sendCommand = vi.fn(), newMessageId = vi.fn(), takeAttachments = vi.fn()
    for (const [text, chat] of [[' ', 'chat'], ['text', null]] as const) {
      expect(submitMessage(text, chat, { ...pending(), sendCommand, newMessageId, takeAttachments })).toBe(false)
    }
    expect(sendCommand).not.toHaveBeenCalled(); expect(newMessageId).not.toHaveBeenCalled()
    expect(takeAttachments).not.toHaveBeenCalled()
  })
  it('sends trimmed text and supplied attachment ids to the captured host after retaining the local row', () => {
    const own = pending(), rollback = vi.fn()
    const attachments = [{ attachmentId: 'file', filename: 'local.pdf' }]
    const sendCommand = vi.fn(command => {
      expect(own.threadSend.store.getState().select('host', 'chat').pending[0].item)
        .toMatchObject({ text: 'text', createdAt: 42, attachments })
    })
    expect(submitMessage(' text ', 'chat', { ...own, sendCommand, newMessageId: () => 'm', now: () => 42,
      takeAttachments: () => ({ attachments, rollback }) })).toBe(true)
    expect(sendCommand).toHaveBeenCalledWith(sendMessageCommand({ conversation_id: 'chat', message_id: 'm', text: 'text', attachment_ids: ['file'] }, 'host'))
    expect(rollback).not.toHaveBeenCalled()
  })
})

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

describe('connection recovery gates', () => {
  const ack: HelloAckPayload = { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] }

  it.each([
    ['pairing-rejected', true, false],
    ['transport', false, true],
    ['handshake', false, true],
    ['unpair', false, false],
    ['not-paired', false, false],
    ['unknown-terminal-code', false, true]
  ] as const)('classifies non-retryable %s disjointly', (code, repair, reconnect) => {
    const status = { type: 'error' as const, error: { code, message: 'private', retryable: false } }
    expect(shouldOfferRepair(status)).toBe(repair)
    expect(shouldOfferReconnect(status)).toBe(reconnect)
    expect(shouldOfferRepair(status) && shouldOfferReconnect(status)).toBe(false)
    const retryable = { ...status, error: { ...status.error, retryable: true } }
    expect(shouldOfferRepair(retryable)).toBe(false)
    expect(shouldOfferReconnect(retryable)).toBe(false)
  })

  it('rejects every non-error status for both actions', () => {
    for (const status of [{ type: 'connected', ack }, { type: 'connecting' }, { type: 'disconnected' }] as const) {
      expect(shouldOfferRepair(status)).toBe(false)
      expect(shouldOfferReconnect(status)).toBe(false)
    }
  })

  it('owns the exact reconnect wording', () => {
    expect(COMPOSER_RECONNECT_BUTTON_COPY).toBe('Connection error - Reconnect')
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

describe('the actionable-error button copy (#963)', () => {
  it('is apostrophe-free, so a server-rendered toContain matches it verbatim', () => {
    expect(COMPOSER_REPAIR_BUTTON_COPY).not.toContain("'")
  })

  // Pinned against the actual constants — never against hardcoded copies of them — so a future tweak to
  // either cannot silently collide with this label. The set held the three composer captions until #968
  // retired them. The chip copy stays in it even though the two never render together: they occupy the
  // SAME slot, so a reader who sees one and then the other must not read them as the same string.
  it('is lexically distinct from the connection explanation', () => {
    const others = [CONNECTION_BANNER_COPY]
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

describe('composer lifecycle diagnostics', () => {
  it('records queued before dispatch, including bridge failure, and refuses no-op submissions', () => {
    const id = '12345678-1234-4123-8123-123456789abc'
    const calls: string[] = []
    const deps = { ...pending(), diagnose: (record: { event: string; messageId: string }) => {
      expect(record.messageId).toBe(id); calls.push(record.event)
    }, sendCommand: () => { calls.push('dispatch'); throw new Error('SECRET') },
    newMessageId: () => id }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(submitMessage(' ', 'chat', deps)).toBe(false)
    expect(submitMessage('text', null, deps)).toBe(false)
    expect(calls).toEqual([])
    expect(submitMessage('text', 'chat', deps)).toBe(false)
    expect(calls).toEqual(['message-queued', 'dispatch', 'message-bridge-failed'])
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
  it('diagnostic failure cannot prevent sending', () => {
    const sendCommand = vi.fn()
    expect(submitMessage('text', 'chat', { ...pending(), sendCommand, diagnose: () => { throw new Error() },
      newMessageId: () => '12345678-1234-4123-8123-123456789abc' })).toBe(true)
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })
})
