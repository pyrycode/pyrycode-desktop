import { describe, it, expect } from 'vitest'
import {
  ATTACHMENT_OPEN_CHANNEL,
  ATTACHMENT_OPEN_EVENT_CHANNEL,
  MAX_OPEN_IDENTIFIER_LENGTH,
  isAttachmentOpenRequest
} from './attachmentOpen'
import { ATTACHMENT_BYTES_CHANNEL, ATTACHMENT_BYTES_EVENT_CHANNEL } from './attachmentBytes'
import {
  ATTACHMENT_RETRIEVAL_CHANNEL,
  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL
} from './attachmentRetrieval'
import { ATTACHMENT_SAVE_CHANNEL, ATTACHMENT_SAVE_EVENT_CHANNEL } from './attachmentSave'
import {
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL
} from './attachmentUpload'

// The untrusted renderer→main boundary guard for the open channel. Pure, no I/O —
// attachmentBytes.test.ts's register verbatim, since the request shape is identical.

const valid = { attachmentId: '7f3c1a2b-0000-4000-8000-0123456789ab' }

it('validates optional local ownership and local-only intent', () => {
  expect(isAttachmentOpenRequest({ ...valid, conversationId: 'chat', serverId: 'host', localOnly: true })).toBe(true)
  for (const extra of [
    { conversationId: '' }, { conversationId: 'x'.repeat(257) },
    { conversationId: 1 }, { serverId: 1 }, { localOnly: 'true' },
    { localOnly: true }
  ]) expect(isAttachmentOpenRequest({ ...valid, ...extra })).toBe(false)
})

describe('the open channel constants', () => {
  it('are two distinct channels, and distinct from all three sibling pairs', () => {
    // Ten values, ten distinct strings: the ask direction cannot be confused with the answer
    // direction, and neither can be confused with the upload, retrieval, save or bytes legs.
    const all = [
      ATTACHMENT_OPEN_CHANNEL,
      ATTACHMENT_OPEN_EVENT_CHANNEL,
      ATTACHMENT_BYTES_CHANNEL,
      ATTACHMENT_BYTES_EVENT_CHANNEL,
      ATTACHMENT_RETRIEVAL_CHANNEL,
      ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
      ATTACHMENT_SAVE_CHANNEL,
      ATTACHMENT_SAVE_EVENT_CHANNEL,
      ATTACHMENT_UPLOAD_CHANNEL,
      ATTACHMENT_UPLOAD_EVENT_CHANNEL
    ]
    expect(new Set(all).size).toBe(10)
  })
})

describe('isAttachmentOpenRequest', () => {
  it('accepts a well-shaped ask', () => {
    expect(isAttachmentOpenRequest(valid)).toBe(true)
  })

  it('accepts an ask carrying extra keys — the main side rebuilds nothing from them', () => {
    // AC 1: no path, directory or URL crosses. An ask that smuggles one is accepted and its extras
    // are never read — both paths this flow builds come from attachmentId and the root's own two
    // directories alone.
    expect(
      isAttachmentOpenRequest({ ...valid, path: '/etc/passwd', directory: '/', url: 'file:///etc' })
    ).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '7f3c1a2b'],
    ['a number', 7],
    ['a boolean', true]
  ])('refuses a non-object ask (%s)', (_label, value) => {
    expect(isAttachmentOpenRequest(value)).toBe(false)
  })

  it('refuses an array — it has no own attachmentId', () => {
    expect(isAttachmentOpenRequest([valid.attachmentId])).toBe(false)
  })

  it.each([
    ['attachmentId missing', {}],
    ['attachmentId not a string', { attachmentId: 7 }],
    ['attachmentId null', { attachmentId: null }],
    ['attachmentId empty', { attachmentId: '' }]
  ])('refuses a malformed ask (%s)', (_label, value) => {
    expect(isAttachmentOpenRequest(value)).toBe(false)
  })

  it('bounds the identifier, accepting the limit and refusing one past it', () => {
    expect(isAttachmentOpenRequest({ attachmentId: 'a'.repeat(MAX_OPEN_IDENTIFIER_LENGTH) })).toBe(
      true
    )
    expect(
      isAttachmentOpenRequest({ attachmentId: 'a'.repeat(MAX_OPEN_IDENTIFIER_LENGTH + 1) })
    ).toBe(false)
  })

  it('bounds well above the canonical alphabet’s own ceiling', () => {
    // The real ceiling is resolveAttachmentPath's 64 characters. This bound is boundary hygiene —
    // the ask never reaches the wire — so it must not be the thing that decides canonicity.
    expect(MAX_OPEN_IDENTIFIER_LENGTH).toBeGreaterThan(64)
  })

  it('refuses a non-canonical identifier only on SHAPE — canonicity is resolveAttachmentPath’s', () => {
    // AC 2: a traversal identifier is well-SHAPED and passes here on purpose. Two divergent checks on
    // one directory ends with one of them being weaker; it is refused main-side, before any fs call.
    expect(isAttachmentOpenRequest({ attachmentId: '../../etc/passwd' })).toBe(true)
    expect(isAttachmentOpenRequest({ attachmentId: '/etc/passwd' })).toBe(true)
  })

  it('refuses a prototype-polluting ask built so __proto__ is an OWN key', () => {
    // Built with JSON.parse, not an object literal: a literal `{ __proto__: ... }` creates no own
    // property at all, so it would be an inert fixture that passes while proving nothing.
    const polluted: unknown = JSON.parse('{"__proto__":{"attachmentId":"aaa"}}')
    expect(isAttachmentOpenRequest(polluted)).toBe(false)
    // And nothing was written onto the prototype chain by the parse itself.
    expect(({} as Record<string, unknown>).attachmentId).toBeUndefined()
  })
})
