import { describe, it, expect } from 'vitest'
import {
  ATTACHMENT_SAVE_CHANNEL,
  ATTACHMENT_SAVE_EVENT_CHANNEL,
  MAX_SAVE_FILENAME_LENGTH,
  MAX_SAVE_IDENTIFIER_LENGTH,
  isAttachmentSaveRequest
} from './attachmentSave'
import {
  ATTACHMENT_RETRIEVAL_CHANNEL,
  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL
} from './attachmentRetrieval'

// The untrusted renderer→main boundary guard for the save channel. Pure, no I/O — the same register as
// attachmentRetrieval.test.ts, with one field more and one bound that differs in kind.

const valid = { attachmentId: '7f3c1a2b-0000-4000-8000-0123456789ab', filename: 'report.pdf' }

describe('the save channel constants', () => {
  it('are two distinct channels, and distinct from the retrieval pair', () => {
    // Four values, four distinct strings: the ask direction cannot be confused with the answer
    // direction, and neither can be confused with the retrieval leg's own pair.
    const all = [
      ATTACHMENT_SAVE_CHANNEL,
      ATTACHMENT_SAVE_EVENT_CHANNEL,
      ATTACHMENT_RETRIEVAL_CHANNEL,
      ATTACHMENT_RETRIEVAL_EVENT_CHANNEL
    ]
    expect(new Set(all).size).toBe(4)
  })
})

describe('isAttachmentSaveRequest', () => {
  it('accepts a well-shaped ask', () => {
    expect(isAttachmentSaveRequest(valid)).toBe(true)
  })

  it('accepts an ask carrying extra keys — the main side rebuilds nothing from them', () => {
    expect(isAttachmentSaveRequest({ ...valid, path: '/etc/passwd', directory: '/' })).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'report.pdf'],
    ['a number', 7],
    ['a boolean', true]
  ])('refuses a non-object ask (%s)', (_label, value) => {
    expect(isAttachmentSaveRequest(value)).toBe(false)
  })

  it('refuses an array — it has neither own property', () => {
    expect(isAttachmentSaveRequest([valid.attachmentId, valid.filename])).toBe(false)
  })

  it.each([
    ['attachmentId missing', { filename: 'report.pdf' }],
    ['filename missing', { attachmentId: valid.attachmentId }],
    ['both missing', {}],
    ['attachmentId not a string', { attachmentId: 7, filename: 'report.pdf' }],
    ['filename not a string', { attachmentId: valid.attachmentId, filename: 7 }],
    ['attachmentId empty', { attachmentId: '', filename: 'report.pdf' }],
    ['filename empty', { attachmentId: valid.attachmentId, filename: '' }]
  ])('refuses a malformed ask (%s)', (_label, value) => {
    expect(isAttachmentSaveRequest(value)).toBe(false)
  })

  it('bounds the identifier, accepting the limit and refusing one past it', () => {
    const at = { ...valid, attachmentId: 'a'.repeat(MAX_SAVE_IDENTIFIER_LENGTH) }
    const past = { ...valid, attachmentId: 'a'.repeat(MAX_SAVE_IDENTIFIER_LENGTH + 1) }
    expect(isAttachmentSaveRequest(at)).toBe(true)
    expect(isAttachmentSaveRequest(past)).toBe(false)
  })

  it('bounds the file name, accepting the limit and refusing one past it', () => {
    const at = { ...valid, filename: 'a'.repeat(MAX_SAVE_FILENAME_LENGTH) }
    const past = { ...valid, filename: 'a'.repeat(MAX_SAVE_FILENAME_LENGTH + 1) }
    expect(isAttachmentSaveRequest(at)).toBe(true)
    expect(isAttachmentSaveRequest(past)).toBe(false)
  })

  it('leaves the ENAMETOOLONG outcome reachable — the file-name bound is far above NAME_MAX', () => {
    // The bound is a DROP bound at an untrusted boundary, not the truncation the sanitiser's non-goals
    // forbid. AC 5 names ENAMETOOLONG as an outcome, so every name a filesystem could reject must still
    // pass the guard and reach the copy. 255 is the largest NAME_MAX in play (APFS, ext4, NTFS).
    expect(MAX_SAVE_FILENAME_LENGTH).toBeGreaterThan(255)
    expect(isAttachmentSaveRequest({ ...valid, filename: 'a'.repeat(300) })).toBe(true)
  })

  it('refuses a non-canonical identifier only on SHAPE — canonicity is resolveAttachmentPath’s', () => {
    // A traversal identifier is well-SHAPED and passes here on purpose: two divergent checks on one
    // directory ends with one of them being weaker. It is refused main-side, before any filesystem call.
    expect(isAttachmentSaveRequest({ ...valid, attachmentId: '../../etc/passwd' })).toBe(true)
  })

  it('refuses a prototype-polluting ask built so __proto__ is an OWN key', () => {
    // Built with JSON.parse, not an object literal: a literal `{ __proto__: ... }` creates no own
    // property at all, so it would be an inert fixture that passes while proving nothing.
    const polluted: unknown = JSON.parse('{"__proto__":{"attachmentId":"aaa","filename":"x.pdf"}}')
    expect(isAttachmentSaveRequest(polluted)).toBe(false)
    // And nothing was written onto the prototype chain by the parse itself.
    expect(({} as Record<string, unknown>).attachmentId).toBeUndefined()
  })
})
