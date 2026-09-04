import { describe, it, expect } from 'vitest'
import {
  ATTACHMENT_PASTE_SOURCE,
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL,
  MAX_UPLOAD_PATH_LENGTH,
  isAttachmentPasteRequest,
  isAttachmentUploadRequest,
  type AttachmentUploadEvent
} from './attachmentUpload'
import { DAEMON_EVENT_CHANNEL } from './events'
import { COMMAND_CHANNEL } from './commands'
import { DIAGNOSTIC_CHANNEL } from './diagnostics'
import { PAIRING_CHANNEL } from './pairing'
import { PAIRING_STATUS_CHANNEL } from './pairingStatus'
import { UNPAIR_CHANNEL } from './unpair'
import { SERVER_INFO_CHANNEL } from './serverInfo'
import { HOST_LABEL_CHANNEL } from './hostLabel'

describe('attachment-upload channels', () => {
  it('are two distinct names, and collide with no existing channel', () => {
    // A collision would silently cross two feeds: an upload outcome reaching the daemon-event
    // bridges hits an assertNever, and an intent landing on the command channel is dropped as a
    // malformed command. Both are one typo away, so the whole set is pinned in one assertion.
    const all = [
      ATTACHMENT_UPLOAD_CHANNEL,
      ATTACHMENT_UPLOAD_EVENT_CHANNEL,
      DAEMON_EVENT_CHANNEL,
      COMMAND_CHANNEL,
      DIAGNOSTIC_CHANNEL,
      PAIRING_CHANNEL,
      PAIRING_STATUS_CHANNEL,
      UNPAIR_CHANNEL,
      SERVER_INFO_CHANNEL,
      HOST_LABEL_CHANNEL
    ]
    expect(new Set(all).size).toBe(all.length)
  })

  it('carry the app-wide pyry: prefix', () => {
    expect(ATTACHMENT_UPLOAD_CHANNEL.startsWith('pyry:')).toBe(true)
    expect(ATTACHMENT_UPLOAD_EVENT_CHANNEL.startsWith('pyry:')).toBe(true)
  })
})

describe('AttachmentUploadEvent', () => {
  it('declares no field beyond the listed ones on any member', () => {
    // AC5 as a property of the TYPE: walked positively over one instance of each member, so a member
    // that later grew a `path` or a `filename` field would have to be added to this list to pass.
    // The type annotation is what makes the walk meaningful — an extra key would not typecheck.
    const members: AttachmentUploadEvent[] = [
      { type: 'refused', uploadId: 'u', reason: 'too-large', limitBytes: 1 },
      // #1032's refusal, and the KEY LIST BELOW IS ITS WHOLE POINT: `limitBytes` is ABSENT rather than
      // optional, because a clipboard that held no image has no limit to state. That absence is what
      // reddens `attachmentUploadOutcomeCopy` until its `refused` arm branches on `reason` — widening
      // the shipped member's `reason` in place would have typechecked and then rendered the too-large
      // sentence, limit figure and all, for a paste that found nothing.
      { type: 'refused', uploadId: 'u', reason: 'no-image' },
      { type: 'failed', uploadId: 'u', reason: 'unreadable' },
      { type: 'completed', uploadId: 'u' },
      // #864's in-flight member. Its two fields are FRAME COUNTS: neither can hold a byte of the
      // file, a path segment or a name, which is what keeps the union's argument covering every
      // member after this slice.
      { type: 'progress', uploadId: 'u', sentChunks: 1, totalChunks: 2 }
    ]

    expect(members.map((member) => Object.keys(member).sort())).toEqual([
      ['limitBytes', 'reason', 'type', 'uploadId'],
      ['reason', 'type', 'uploadId'],
      ['reason', 'type', 'uploadId'],
      ['type', 'uploadId'],
      ['sentChunks', 'totalChunks', 'type', 'uploadId']
    ])
  })

  // #864: the two counts are NUMBERS on every member that carries one, walked positively so a member
  // that later carried a count as a string — the shape `uploadProgressPercent` has to be total
  // against — would have to be added here to pass.
  it('carries every count as a number, never as a string', () => {
    const progress: AttachmentUploadEvent = {
      type: 'progress',
      uploadId: 'u',
      sentChunks: 7,
      totalChunks: 240
    }
    const refused: AttachmentUploadEvent = {
      type: 'refused',
      uploadId: 'u',
      reason: 'too-large',
      limitBytes: 23_040_000
    }
    expect([
      typeof progress.sentChunks,
      typeof progress.totalChunks,
      typeof refused.limitBytes
    ]).toEqual(['number', 'number', 'number'])
  })

  // ⭐ THIS TEST USED TO BE NAMED `discriminates on type across all four members`, AND THAT NAME WAS THE
  // TRAP #1032 WALKED INTO. It counted `type` strings in a Set, so a SECOND member sharing an existing
  // `type` — which is exactly the shape a no-image refusal takes — left it green while its own name went
  // stale and the union it claimed to cover had grown. AC4's proof has to be extended deliberately, so
  // the reason axis below is COMPILER-FORCED rather than counted: a third refusal reason fails to
  // typecheck here, the mechanism ATTACHMENT_UPLOAD_FAILURE_COPY's Record already uses one directory over.
  it('discriminates on type, and within refused on reason, across every member', () => {
    const types = new Set<AttachmentUploadEvent['type']>([
      'refused',
      'failed',
      'completed',
      'progress'
    ])
    expect(types.size).toBe(4)

    const refusalReasons: Record<
      Extract<AttachmentUploadEvent, { type: 'refused' }>['reason'],
      true
    > = {
      'too-large': true,
      'no-image': true
    }
    // Two DISTINCT reasons under one type, which is what makes `type` alone insufficient — and is why
    // the composer's switch has to branch twice to reach a sentence.
    expect(Object.keys(refusalReasons).sort()).toEqual(['no-image', 'too-large'])
  })
})

// #890: the boundary guard the widened intent owes. The channel carried NO request body until this
// slice; an argument-free send still means "open the picker", and a send carrying a request means
// "upload this path". Everything below is the second door's lock.
describe('isAttachmentUploadRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isAttachmentUploadRequest({ path: '/Users/someone/Pictures/photo.png' })).toBe(true)
  })

  it('accepts a request carrying extra keys, which are never read', () => {
    // isAttachmentBytesRequest's posture restated: nothing downstream rebuilds a value from this
    // object's other keys, so a smuggled field reaches nothing. Refusing extras would buy nothing and
    // would make the guard brittle against a future additive field.
    expect(isAttachmentUploadRequest({ path: '/tmp/a', filename: 'b', bytes: [1, 2] })).toBe(true)
  })

  it('rejects everything that is not an object with a usable path', () => {
    // Table-driven so the rejected set is readable as a set. `null` is the typeof trap the guard's
    // first line exists for; the array and the empty object are the two shapes that pass a naive
    // `typeof value === 'object'` and then have no `path` at all.
    const rejected: unknown[] = [
      null,
      undefined,
      '/tmp/a',
      42,
      true,
      [],
      ['/tmp/a'],
      {},
      { path: null },
      { path: 42 },
      { path: ['/tmp/a'] },
      { path: {} },
      { pathname: '/tmp/a' }
    ]
    expect(rejected.map(isAttachmentUploadRequest)).toEqual(rejected.map(() => false))
  })

  it('rejects an empty path, which is what a page-constructed File resolves to', () => {
    // THE LOAD-BEARING CASE. `webUtils.getPathForFile` answers '' for a File the page built itself, so
    // this line is what turns "only a file the OS delivered is backed by a path" into a refusal main
    // actually performs, rather than a property the preload merely observes.
    expect(isAttachmentUploadRequest({ path: '' })).toBe(false)
  })

  it('bounds the path, accepting the limit and refusing one character past it', () => {
    expect(isAttachmentUploadRequest({ path: 'a'.repeat(MAX_UPLOAD_PATH_LENGTH) })).toBe(true)
    expect(isAttachmentUploadRequest({ path: 'a'.repeat(MAX_UPLOAD_PATH_LENGTH + 1) })).toBe(false)
  })

  it('rejects a __proto__-carrying literal and alters no prototype reading it', () => {
    // BUILT WITH JSON.parse, NEVER AS AN OBJECT LITERAL: `{ __proto__: {...} }` in source creates no
    // own key at all — it sets the prototype — so a literal fixture would pass this test vacuously
    // while proving nothing. JSON.parse round-trips `__proto__` as an ordinary OWN key, which is the
    // shape a hostile renderer can actually put on the wire.
    const hostile: unknown = JSON.parse('{"__proto__": {"path": "/etc/passwd"}}')
    expect(isAttachmentUploadRequest(hostile)).toBe(false)
    // The polluting object has no OWN `path`, and the guard's `in` test is followed by a typeof on the
    // value actually found — so nothing inherited from Object.prototype can satisfy it either.
    expect(Object.prototype).not.toHaveProperty('path')
    expect(isAttachmentUploadRequest(JSON.parse('{"__proto__": {"path": "/x"}, "path": ""}'))).toBe(
      false
    )
  })
})

// #1032: the THIRD entry's guard. The channel now carries three asks — argument-free is the picker, a
// path is a drop, and this one is a paste. Presence alone can no longer tell them apart, so this ask
// names itself with a client-owned literal and the guard compares against it.
describe('isAttachmentPasteRequest', () => {
  it('accepts the well-formed ask', () => {
    expect(isAttachmentPasteRequest({ source: ATTACHMENT_PASTE_SOURCE })).toBe(true)
  })

  it('accepts an ask carrying extra keys, which are never read', () => {
    // The sibling guard's posture restated, and it costs even less here: nothing downstream reads ANY
    // field off this ask — `uploadClipboardImage` takes no argument from it — so a smuggled field
    // reaches nothing at all.
    expect(isAttachmentPasteRequest({ source: ATTACHMENT_PASTE_SOURCE, path: '/etc/passwd' })).toBe(
      true
    )
  })

  it('rejects everything that is not an object naming this exact source', () => {
    // Table-driven so the rejected set is readable as a set. The near-misses matter most: a source that
    // is a different literal, one that is a prefix, and one that is not a string at all are the three
    // shapes a renderer would produce by accident or on purpose.
    const rejected: unknown[] = [
      null,
      undefined,
      'clipboard-image',
      42,
      true,
      [],
      ['clipboard-image'],
      {},
      { source: null },
      { source: 42 },
      { source: '' },
      { source: 'clipboard' },
      { source: 'clipboard-image-x' },
      { source: ['clipboard-image'] },
      { source: { source: 'clipboard-image' } },
      { sources: 'clipboard-image' }
    ]
    expect(rejected.map(isAttachmentPasteRequest)).toEqual(rejected.map(() => false))
  })

  it('rejects a __proto__-carrying literal and alters no prototype reading it', () => {
    // BUILT WITH JSON.parse, NEVER AS AN OBJECT LITERAL: `{ __proto__: {...} }` in source creates no own
    // key at all — it sets the prototype — so a literal fixture would pass vacuously. JSON.parse
    // round-trips `__proto__` as an ordinary OWN key, which is the shape a hostile renderer can put on
    // the wire.
    const hostile: unknown = JSON.parse('{"__proto__": {"source": "clipboard-image"}}')
    expect(isAttachmentPasteRequest(hostile)).toBe(false)
    expect(Object.prototype).not.toHaveProperty('source')
  })
})

// ⭐ THE ARM ORDER IS LOAD-BEARING, and this is the assertion that keeps it honest. The main listener
// tries the path guard FIRST, so an ask carrying a valid path reaches the drop arm exactly as it does
// today — including one that also carries extra keys, which the shipped guard documents as accepted and
// never read. Mutual exclusivity is what makes that ordering a documentation choice rather than a
// behaviour one for every ask an operator can actually produce.
describe('the two request guards, side by side', () => {
  it('neither guard accepts the other entry’s ask', () => {
    expect(isAttachmentUploadRequest({ source: ATTACHMENT_PASTE_SOURCE })).toBe(false)
    expect(isAttachmentPasteRequest({ path: '/Users/someone/Pictures/photo.png' })).toBe(false)
  })

  it('an ask carrying both shapes is a PATH ask, because the path guard runs first', () => {
    // Stated as a fact about the guards rather than about the listener, since this is where it can be
    // proved. Both accept it; the ordering in `attachmentUploadListener` is what resolves it, and
    // resolving it towards the shipped arm is what keeps #890's behaviour byte-for-byte unchanged.
    const both = { path: '/tmp/a', source: ATTACHMENT_PASTE_SOURCE }
    expect(isAttachmentUploadRequest(both)).toBe(true)
    expect(isAttachmentPasteRequest(both)).toBe(true)
  })

  it('names a source that cannot collide with a path', () => {
    // The literal is client-owned and is never derived from anything the window sends. A source that
    // looked like a path would make the two asks confusable at a glance in a log or a review.
    expect(ATTACHMENT_PASTE_SOURCE).toBe('clipboard-image')
    expect(ATTACHMENT_PASTE_SOURCE).not.toContain('/')
  })
})
