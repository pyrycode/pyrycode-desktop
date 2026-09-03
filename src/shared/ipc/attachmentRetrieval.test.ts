import { describe, it, expect } from 'vitest'
import {
  ATTACHMENT_RETRIEVAL_CHANNEL,
  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
  isAttachmentRetrievalRequest,
  MAX_RETRIEVAL_IDENTIFIER_LENGTH
} from './attachmentRetrieval'
import { DAEMON_EVENT_CHANNEL } from './events'
import {
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL
} from './attachmentUpload'

const VALID = {
  conversationId: '7a1f6b2c-9e04-4d3a-8f52-13c6b0d9a4e1',
  attachmentId: 'c0ffee00-1111-4222-8333-444455556666'
}

describe('attachment-retrieval channels', () => {
  it('are distinct from each other and from every neighbouring channel', () => {
    // The event channel must not be DAEMON_EVENT_CHANNEL: a retrieval outcome reaching the daemon-event
    // bridges is exactly what this module's own channel pair exists to prevent.
    const channels = [
      ATTACHMENT_RETRIEVAL_CHANNEL,
      ATTACHMENT_RETRIEVAL_EVENT_CHANNEL,
      DAEMON_EVENT_CHANNEL,
      ATTACHMENT_UPLOAD_CHANNEL,
      ATTACHMENT_UPLOAD_EVENT_CHANNEL
    ]
    expect(new Set(channels).size).toBe(channels.length)
  })
})

describe('isAttachmentRetrievalRequest', () => {
  it('accepts a well-formed ask', () => {
    expect(isAttachmentRetrievalRequest(VALID)).toBe(true)
  })

  it('accepts an identifier of any shape within the bound, leaving canonicity to resolveAttachmentPath', () => {
    // Shape-only by design: the id becomes a path component ONLY through resolveAttachmentPath, which
    // refuses a non-canonical one before storeAttachment writes. A second gate here would fork the check.
    expect(isAttachmentRetrievalRequest({ conversationId: 'c', attachmentId: '../../etc/passwd' })).toBe(
      true
    )
  })

  it('refuses a non-object, null and an array', () => {
    expect(isAttachmentRetrievalRequest(null)).toBe(false)
    expect(isAttachmentRetrievalRequest(undefined)).toBe(false)
    expect(isAttachmentRetrievalRequest('ask')).toBe(false)
    expect(isAttachmentRetrievalRequest(7)).toBe(false)
  })

  it('refuses a missing field', () => {
    expect(isAttachmentRetrievalRequest({ conversationId: VALID.conversationId })).toBe(false)
    expect(isAttachmentRetrievalRequest({ attachmentId: VALID.attachmentId })).toBe(false)
    expect(isAttachmentRetrievalRequest({})).toBe(false)
  })

  it('refuses a non-string field', () => {
    expect(isAttachmentRetrievalRequest({ ...VALID, conversationId: 7 })).toBe(false)
    expect(isAttachmentRetrievalRequest({ ...VALID, attachmentId: { id: 'x' } })).toBe(false)
    expect(isAttachmentRetrievalRequest({ ...VALID, attachmentId: null })).toBe(false)
  })

  it('refuses an explicitly-undefined field, which an `in` check alone would pass through', () => {
    // Structured clone PRESERVES an explicitly-undefined property across the IPC bridge (the events go
    // out through webContents.send, not JSON.stringify), so `'attachmentId' in value` is true here.
    const explicitlyUndefined = { conversationId: VALID.conversationId, attachmentId: undefined }
    expect('attachmentId' in explicitlyUndefined).toBe(true)
    expect(isAttachmentRetrievalRequest(explicitlyUndefined)).toBe(false)
  })

  it('refuses an empty identifier, the contract’s named zero-valued request', () => {
    // buildRequestAttachment's docblock: joining the empty string onto a directory yields that
    // directory, so a zero-valued request is the specific silent failure the wire contract warns about.
    expect(isAttachmentRetrievalRequest({ ...VALID, attachmentId: '' })).toBe(false)
    expect(isAttachmentRetrievalRequest({ ...VALID, conversationId: '' })).toBe(false)
  })

  it('refuses an identifier over the size bound, on either field', () => {
    // #1003 review: an unbounded identifier is not merely absurd input. At ~66 KB it pushes the
    // request_attachment envelope over MAX_PLAINTEXT_BYTES, so the builder throws and the ask never
    // reaches the wire — a whole failure class the boundary keeps out of the background process.
    const over = 'x'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH + 1)
    expect(isAttachmentRetrievalRequest({ ...VALID, attachmentId: over })).toBe(false)
    expect(isAttachmentRetrievalRequest({ ...VALID, conversationId: over })).toBe(false)
    expect(isAttachmentRetrievalRequest({ conversationId: over, attachmentId: over })).toBe(false)
  })

  it('accepts an identifier at exactly the bound', () => {
    // Inclusive, like MAX_PASTE_LENGTH's: the bound is the largest accepted value, not the first
    // refused one, and a UUID is ~7× under it either way.
    const atLimit = 'y'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH)
    expect(isAttachmentRetrievalRequest({ conversationId: atLimit, attachmentId: atLimit })).toBe(true)
  })

  it('accepts an ask carrying an extra key, which the fresh wire literal drops', () => {
    // The guard bounds the two fields it reads; daemonConnection rebuilds the wire payload as a fresh
    // literal, so a smuggled key cannot reach the envelope regardless (createConversation's posture).
    expect(isAttachmentRetrievalRequest({ ...VALID, path: '/etc/shadow' })).toBe(true)
  })

  it('refuses a prototype-polluting ask read back under its own key', () => {
    const hostile = JSON.parse('{"conversationId":"c","__proto__":{"attachmentId":"a"}}') as unknown
    expect(isAttachmentRetrievalRequest(hostile)).toBe(false)
  })
})
