import { describe, it, expect } from 'vitest'
import {
  ATTACHMENT_BYTES_CHANNEL,
  ATTACHMENT_BYTES_EVENT_CHANNEL,
  MAX_BYTES_IDENTIFIER_LENGTH,
  isAttachmentBytesRequest
} from './attachmentBytes'
import {
  ATTACHMENT_RETRIEVAL_CHANNEL,
  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL
} from './attachmentRetrieval'
import { ATTACHMENT_SAVE_CHANNEL, ATTACHMENT_SAVE_EVENT_CHANNEL } from './attachmentSave'

// The untrusted renderer→main boundary guard for the bytes channel. Pure, no I/O — the same register
// as attachmentSave.test.ts with one field instead of two.

const valid = { attachmentId: '7f3c1a2b-0000-4000-8000-0123456789ab' }

describe('the bytes channel constants', () => {
  it('are two distinct channels, and distinct from both sibling pairs', () => {
    // Six values, six distinct strings: the ask direction cannot be confused with the answer
    // direction, and neither can be confused with the retrieval or save legs' own pairs.
    const all = [
      ATTACHMENT_BYTES_CHANNEL,
      ATTACHMENT_BYTES_EVENT_CHANNEL,
      ATTACHMENT_RETRIEVAL_CHANNEL,
      ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
      ATTACHMENT_SAVE_CHANNEL,
      ATTACHMENT_SAVE_EVENT_CHANNEL
    ]
    expect(new Set(all).size).toBe(6)
  })
})

describe('isAttachmentBytesRequest', () => {
  it('accepts a well-shaped ask', () => {
    expect(isAttachmentBytesRequest(valid)).toBe(true)
  })

  it('accepts an ask carrying extra keys — the main side rebuilds nothing from them', () => {
    // AC 1: no path or directory crosses. An ask that smuggles one is accepted and its extras are
    // never read — the resolved path is built from attachmentId and the root's own directory alone.
    expect(isAttachmentBytesRequest({ ...valid, path: '/etc/passwd', directory: '/' })).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '7f3c1a2b'],
    ['a number', 7],
    ['a boolean', true]
  ])('refuses a non-object ask (%s)', (_label, value) => {
    expect(isAttachmentBytesRequest(value)).toBe(false)
  })

  it('refuses an array — it has no own attachmentId', () => {
    expect(isAttachmentBytesRequest([valid.attachmentId])).toBe(false)
  })

  it.each([
    ['attachmentId missing', {}],
    ['attachmentId not a string', { attachmentId: 7 }],
    ['attachmentId null', { attachmentId: null }],
    ['attachmentId empty', { attachmentId: '' }]
  ])('refuses a malformed ask (%s)', (_label, value) => {
    expect(isAttachmentBytesRequest(value)).toBe(false)
  })

  it('bounds the identifier, accepting the limit and refusing one past it', () => {
    expect(isAttachmentBytesRequest({ attachmentId: 'a'.repeat(MAX_BYTES_IDENTIFIER_LENGTH) })).toBe(
      true
    )
    expect(
      isAttachmentBytesRequest({ attachmentId: 'a'.repeat(MAX_BYTES_IDENTIFIER_LENGTH + 1) })
    ).toBe(false)
  })

  it('bounds well above the canonical alphabet’s own ceiling', () => {
    // The real ceiling is resolveAttachmentPath's 64 characters. This bound is boundary hygiene —
    // the ask never reaches the wire — so it must not be the thing that decides canonicity.
    expect(MAX_BYTES_IDENTIFIER_LENGTH).toBeGreaterThan(64)
  })

  it('refuses a non-canonical identifier only on SHAPE — canonicity is resolveAttachmentPath’s', () => {
    // AC 2: a traversal identifier is well-SHAPED and passes here on purpose. Two divergent checks on
    // one directory ends with one of them being weaker; it is refused main-side, before any fs call.
    expect(isAttachmentBytesRequest({ attachmentId: '../../etc/passwd' })).toBe(true)
    expect(isAttachmentBytesRequest({ attachmentId: '/etc/passwd' })).toBe(true)
  })

  it('refuses a prototype-polluting ask built so __proto__ is an OWN key', () => {
    // Built with JSON.parse, not an object literal: a literal `{ __proto__: ... }` creates no own
    // property at all, so it would be an inert fixture that passes while proving nothing.
    const polluted: unknown = JSON.parse('{"__proto__":{"attachmentId":"aaa"}}')
    expect(isAttachmentBytesRequest(polluted)).toBe(false)
    // And nothing was written onto the prototype chain by the parse itself.
    expect(({} as Record<string, unknown>).attachmentId).toBeUndefined()
  })
})
