import { describe, it, expect } from 'vitest'
import {
  ATTACHMENT_PASTE_SOURCE,
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL,
  ATTACHMENT_PICK_SOURCE,
  MAX_UPLOAD_CONVERSATION_ID_LENGTH,
  MAX_UPLOAD_PATH_LENGTH,
  isAttachmentPasteRequest,
  isAttachmentPickRequest,
  isAttachmentUploadRequest,
  type AttachmentUploadEvent
} from './attachmentUpload'
import { DAEMON_EVENT_CHANNEL } from './events'
import { COMMAND_CHANNEL } from './commands'
import { DIAGNOSTIC_CHANNEL } from './diagnostics'
import { PAIRING_CHANNEL } from './pairing'
import { PAIRING_STATUS_CHANNEL } from './pairingStatus'
import { UNPAIR_SERVER_CHANNEL } from './unpair'
import { SERVER_INFO_CHANNEL } from './serverInfo'
import { HOST_LABEL_CHANNEL } from './hostLabel'

// #1205: every ask carries the open conversation's id, so every fixture below that is meant to be
// refused for SOME OTHER reason carries a valid one too — the refusal each test names stays the only
// refusal in play. The rule for the id itself is asserted in its own describe at the bottom.
const CONV = { conversationId: 'conv-1' } as const

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
      UNPAIR_SERVER_CHANNEL,
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
      // #1038's widened terminal, and the KEY LIST BELOW IS WHERE ITS SCOPE IS PROVED: `filename` is on
      // THIS member and on no other, so the walk is simultaneously the proof that the completed arm
      // names the file and that every sibling still carries no string but its own uploadId and reason.
      // Required rather than optional — omitting it here would not compile.
      { type: 'completed', uploadId: 'u', filename: 'report.pdf' },
      // #864's in-flight member. Its two fields are FRAME COUNTS: neither can hold a byte of the
      // file, a path segment or a name, which is what keeps the union's argument covering every
      // member after this slice.
      { type: 'progress', uploadId: 'u', sentChunks: 1, totalChunks: 2 }
    ]

    expect(members.map((member) => Object.keys(member).sort())).toEqual([
      ['limitBytes', 'reason', 'type', 'uploadId'],
      ['reason', 'type', 'uploadId'],
      ['reason', 'type', 'uploadId'],
      ['filename', 'type', 'uploadId'],
      ['sentChunks', 'totalChunks', 'type', 'uploadId']
    ])
  })

  // #1038 as a property of the TYPE rather than of the emitter: the display name is scoped to the one
  // terminal that reports a stored file. Walked over the member list above rather than restated, so a
  // `filename` added to a second arm has to change this assertion to pass.
  it('scopes the display name to the completed terminal and to no other member', () => {
    const members: AttachmentUploadEvent[] = [
      { type: 'refused', uploadId: 'u', reason: 'too-large', limitBytes: 1 },
      { type: 'refused', uploadId: 'u', reason: 'no-image' },
      { type: 'failed', uploadId: 'u', reason: 'unreadable' },
      { type: 'completed', uploadId: 'u', filename: 'report.pdf' },
      { type: 'progress', uploadId: 'u', sentChunks: 1, totalChunks: 2 }
    ]

    const naming = members.filter((member) => 'filename' in member)
    expect(naming).toEqual([{ type: 'completed', uploadId: 'u', filename: 'report.pdf' }])
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
    expect(isAttachmentUploadRequest({ path: '/Users/someone/Pictures/photo.png', ...CONV })).toBe(true)
  })

  it('accepts a request carrying extra keys, which are never read', () => {
    // isAttachmentBytesRequest's posture restated: nothing downstream rebuilds a value from this
    // object's other keys, so a smuggled field reaches nothing. Refusing extras would buy nothing and
    // would make the guard brittle against a future additive field.
    expect(isAttachmentUploadRequest({ path: '/tmp/a', filename: 'b', bytes: [1, 2], ...CONV })).toBe(true)
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
    expect(isAttachmentUploadRequest({ path: '', ...CONV })).toBe(false)
  })

  it('bounds the path, accepting the limit and refusing one character past it', () => {
    expect(isAttachmentUploadRequest({ path: 'a'.repeat(MAX_UPLOAD_PATH_LENGTH), ...CONV })).toBe(true)
    expect(isAttachmentUploadRequest({ path: 'a'.repeat(MAX_UPLOAD_PATH_LENGTH + 1), ...CONV })).toBe(false)
  })

  it('rejects a __proto__-carrying literal and alters no prototype reading it', () => {
    // BUILT WITH JSON.parse, NEVER AS AN OBJECT LITERAL: `{ __proto__: {...} }` in source creates no
    // own key at all — it sets the prototype — so a literal fixture would pass this test vacuously
    // while proving nothing. JSON.parse round-trips `__proto__` as an ordinary OWN key, which is the
    // shape a hostile renderer can actually put on the wire.
    const hostile: unknown = JSON.parse('{"__proto__": {"path": "/etc/passwd"}, "conversationId": "conv-1"}')
    expect(isAttachmentUploadRequest(hostile)).toBe(false)
    // The polluting object has no OWN `path`, and the guard's `in` test is followed by a typeof on the
    // value actually found — so nothing inherited from Object.prototype can satisfy it either.
    expect(Object.prototype).not.toHaveProperty('path')
    expect(isAttachmentUploadRequest(JSON.parse('{"__proto__": {"path": "/x"}, "path": "", "conversationId": "conv-1"}'))).toBe(
      false
    )
  })
})

// #1032: the THIRD entry's guard. The channel carries three asks — a path is a drop, this one is a
// paste, and since #1205 the picker names itself too (below). Presence alone could no longer tell them
// apart once there were three, so an ask names itself with a client-owned literal and the guard
// compares against it.
describe('isAttachmentPasteRequest', () => {
  it('accepts the well-formed ask', () => {
    expect(isAttachmentPasteRequest({ source: ATTACHMENT_PASTE_SOURCE, ...CONV })).toBe(true)
  })

  it('accepts an ask carrying extra keys, which are never read', () => {
    // The sibling guard's posture restated, and it costs almost as little here: nothing downstream
    // reads any field off this ask ABOUT THE IMAGE — `uploadClipboardImage` takes no argument from it
    // — so a smuggled field reaches nothing at all. #1129's `serverId` is the one field main does read,
    // and it is looked up against the registry and discarded rather than acted on; it is not an
    // unread extra and has its own rule, asserted in the routing-key describe at the bottom of this
    // file.
    expect(isAttachmentPasteRequest({ source: ATTACHMENT_PASTE_SOURCE, path: '/etc/passwd', ...CONV })).toBe(
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
    const hostile: unknown = JSON.parse('{"__proto__": {"source": "clipboard-image"}, "conversationId": "conv-1"}')
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
    expect(isAttachmentUploadRequest({ source: ATTACHMENT_PASTE_SOURCE, ...CONV })).toBe(false)
    expect(isAttachmentPasteRequest({ path: '/Users/someone/Pictures/photo.png', ...CONV })).toBe(false)
  })

  it('an ask carrying both shapes is a PATH ask, because the path guard runs first', () => {
    // Stated as a fact about the guards rather than about the listener, since this is where it can be
    // proved. Both accept it; the ordering in `attachmentUploadListener` is what resolves it, and
    // resolving it towards the shipped arm is what keeps #890's behaviour byte-for-byte unchanged.
    const both = { path: '/tmp/a', source: ATTACHMENT_PASTE_SOURCE, ...CONV }
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

// ⭐ #1129: the optional routing key, on BOTH guarded asks. The field is what lets a dropped or
// pasted file reach the server whose chat is open rather than whichever host was paired most
// recently, and the rule it is checked against is the one `hasValidServerId` (commands.ts) already
// states for the six server-scoped commands: ABSENT-OR-UNDEFINED-OR-STRING. It is restated here
// rather than imported — no production module under src/shared/ipc imports from a sibling — so
// these assertions are what keep the two copies from drifting, and they are written against the
// rule rather than against the helper.
//
// The picker's ask gained an object in #1205 and takes the same rule; it is asserted in its own
// describe below rather than woven in here. An ask with no id takes the unnamed path, which is
// `serverRouter.resolve(undefined)`'s
// sole-connection branch.
describe('the optional routing key on both asks', () => {
  it('accepts an ask that names a server, on either entry', () => {
    expect(isAttachmentUploadRequest({ path: '/tmp/a', ...CONV, serverId: 'server-a' })).toBe(true)
    expect(
      isAttachmentPasteRequest({
        source: ATTACHMENT_PASTE_SOURCE,
        ...CONV,
        serverId: 'server-a'
      })
    ).toBe(true)
  })

  it('accepts an ask with no serverId key, which a sender emits for a chat its list does not hold', () => {
    // The load-bearing half of "absent-or-undefined-or-string" in the REFUSAL direction: the composer
    // omits the key outright when the conversation list does not hold the chat, so a present-key
    // REJECTION would refuse that ordinary bare ask.
    expect(isAttachmentUploadRequest({ path: '/tmp/a', ...CONV })).toBe(true)
    expect(isAttachmentPasteRequest({ source: ATTACHMENT_PASTE_SOURCE, ...CONV })).toBe(true)
  })

  it('accepts an explicitly-undefined serverId, which is what structured clone delivers', () => {
    // ⭐ THE OPTIONAL-FIELD TRAP, made provable rather than left in a comment. Structured clone
    // PRESERVES an own property whose value is `undefined` across the IPC bridge, so a sender that
    // writes `{ path, serverId }` from an absent variable puts an own `serverId: undefined` key on
    // the wire. A bare `'serverId' in value` check would read that as a supplied value and refuse
    // it.
    expect(isAttachmentUploadRequest({ path: '/tmp/a', ...CONV, serverId: undefined })).toBe(true)
    expect(
      isAttachmentPasteRequest({
        source: ATTACHMENT_PASTE_SOURCE,
        ...CONV,
        serverId: undefined
      })
    ).toBe(true)
  })

  it('accepts an empty serverId, which is refused one layer later by the resolver', () => {
    // TYPE, NOT EMPTINESS, and not canonical shape either — commands.ts's rule inherited whole.
    // `''` is a present string, so `serverRouter.resolve` takes its NAMED branch and refuses: no
    // held entry's id is empty, and the not-paired stand-in's is `null`, which no string can match.
    // Refusing it here would buy nothing the resolution does not already buy, and would put a
    // second, weaker opinion about the id at a boundary that is not the one holding the entry set.
    expect(isAttachmentUploadRequest({ path: '/tmp/a', ...CONV, serverId: '' })).toBe(true)
    expect(
      isAttachmentPasteRequest({
        source: ATTACHMENT_PASTE_SOURCE,
        ...CONV,
        serverId: ''
      })
    ).toBe(true)
  })

  it('rejects a serverId that is not a string, on either entry', () => {
    // Table-driven so the rejected set is readable as a set, its siblings' idiom. `null` is the
    // trap a `!== undefined` test alone would miss (`typeof null` is `'object'`); the array and the
    // toString-carrying object are the two shapes that would coerce to a usable id if anything
    // downstream ever interpolated one instead of looking it up.
    const invalid: unknown[] = [
      null,
      42,
      true,
      [],
      ['server-a'],
      {},
      { toString: () => 'server-a' }
    ]
    const drops = invalid.map((serverId) => ({ path: '/tmp/a', ...CONV, serverId }))
    const pastes = invalid.map((serverId) => ({
      source: ATTACHMENT_PASTE_SOURCE,
      ...CONV,
      serverId
    }))
    expect(drops.map(isAttachmentUploadRequest)).toEqual(invalid.map(() => false))
    expect(pastes.map(isAttachmentPasteRequest)).toEqual(invalid.map(() => false))
  })

  it('makes serverId the one extra key that is no longer free-form', () => {
    // The two acceptances above ("accepts a request carrying extra keys, which are never read")
    // stay true of every OTHER key, and that is the whole distinction this slice draws: `serverId`
    // stops being an unread extra and becomes a read field, so it acquires a rule while nothing
    // else does.
    expect(
      isAttachmentUploadRequest({
        path: '/tmp/a',
        ...CONV,
        serverIds: 42,
        filename: 'b'
      })
    ).toBe(true)
    expect(isAttachmentPasteRequest({ source: ATTACHMENT_PASTE_SOURCE, ...CONV, server: 42 })).toBe(true)
    expect(isAttachmentUploadRequest({ path: '/tmp/a', ...CONV, serverId: 42 })).toBe(false)
    expect(
      isAttachmentPasteRequest({
        source: ATTACHMENT_PASTE_SOURCE,
        ...CONV,
        serverId: 42
      })
    ).toBe(false)
  })
})

// #1205: the REQUIRED destination, on all three asks, and the picker's own ask. pyrycode #2143 made
// the daemon refuse a chunk naming no conversation, so an ask that names none is refused HERE — at
// the boundary, with no filesystem call and no event — rather than reaching the composer as "the host
// rejected part of the upload". One rule, `hasValidConversationId`, checked by all three guards.
describe('the required conversation on every ask (#1205)', () => {
  const asks = {
    drop: (extra: object) => isAttachmentUploadRequest({ path: '/tmp/a', ...extra }),
    paste: (extra: object) => isAttachmentPasteRequest({ source: ATTACHMENT_PASTE_SOURCE, ...extra }),
    pick: (extra: object) => isAttachmentPickRequest({ source: ATTACHMENT_PICK_SOURCE, ...extra })
  }
  const entries = Object.values(asks)

  it('accepts a non-empty string on every entry', () => {
    expect(entries.map((ask) => ask({ conversationId: 'conv-1' }))).toEqual([true, true, true])
  })

  it('refuses an ask with no conversationId key, on every entry — there is no unnamed path for it', () => {
    // The asymmetry with `serverId` is the point: a server falls back to the sole connection, a
    // conversation falls back to nothing, because the daemon has had no cursor to fall back to since
    // pyrycode #2143. Accepting an absent id here would only move the refusal to the operator's screen.
    expect(entries.map((ask) => ask({}))).toEqual([false, false, false])
  })

  it('refuses undefined, empty and non-string ids, on every entry', () => {
    const invalid: unknown[] = [undefined, '', null, 42, true, [], ['conv-1'], {}, { toString: () => 'c' }]
    for (const ask of entries) {
      expect(invalid.map((conversationId) => ask({ conversationId }))).toEqual(invalid.map(() => false))
    }
  })

  it('bounds the id, accepting the limit and refusing one character past it', () => {
    for (const ask of entries) {
      expect(ask({ conversationId: 'c'.repeat(MAX_UPLOAD_CONVERSATION_ID_LENGTH) })).toBe(true)
      expect(ask({ conversationId: 'c'.repeat(MAX_UPLOAD_CONVERSATION_ID_LENGTH + 1) })).toBe(false)
    }
  })

  it("takes the retrieval channel's bound, so one identifier rule holds across both attachment legs", () => {
    expect(MAX_UPLOAD_CONVERSATION_ID_LENGTH).toBe(256)
  })

  it('refuses a __proto__-carrying id, on every entry', () => {
    // The polluting object has no OWN `conversationId`; the `in` test is followed by a typeof on the
    // value actually found, so nothing inherited can satisfy it. JSON.parse for the sibling tests' reason.
    expect(
      isAttachmentUploadRequest(JSON.parse('{"path": "/tmp/a", "__proto__": {"conversationId": "conv-1"}}'))
    ).toBe(false)
    expect(
      isAttachmentPickRequest(
        JSON.parse('{"source": "file-picker", "__proto__": {"conversationId": "conv-1"}}')
      )
    ).toBe(false)
    expect(Object.prototype).not.toHaveProperty('conversationId')
  })
})

describe('isAttachmentPickRequest (#1205)', () => {
  it('accepts the well-formed ask, with and without a server', () => {
    expect(isAttachmentPickRequest({ source: ATTACHMENT_PICK_SOURCE, ...CONV })).toBe(true)
    expect(isAttachmentPickRequest({ source: ATTACHMENT_PICK_SOURCE, ...CONV, serverId: 'server-a' })).toBe(
      true
    )
    expect(isAttachmentPickRequest({ source: ATTACHMENT_PICK_SOURCE, ...CONV, serverId: undefined })).toBe(
      true
    )
  })

  it('rejects a bare send — the argument-free picker intent is retired', () => {
    // The channel's original shape. It cannot carry a destination, so since #1205 it matches no guard
    // and the listener drops it: no dialog, no event, no log.
    expect(isAttachmentPickRequest(undefined)).toBe(false)
    expect(isAttachmentUploadRequest(undefined)).toBe(false)
    expect(isAttachmentPasteRequest(undefined)).toBe(false)
  })

  it('rejects everything that is not an object naming this exact source', () => {
    const rejected: unknown[] = [
      null,
      'file-picker',
      42,
      [],
      {},
      { ...CONV },
      { source: null, ...CONV },
      { source: '', ...CONV },
      { source: 'file', ...CONV },
      { source: 'file-picker-x', ...CONV },
      { source: ATTACHMENT_PASTE_SOURCE, ...CONV }
    ]
    expect(rejected.map(isAttachmentPickRequest)).toEqual(rejected.map(() => false))
  })

  it('rejects a serverId that is not a string, like its siblings', () => {
    expect(isAttachmentPickRequest({ source: ATTACHMENT_PICK_SOURCE, ...CONV, serverId: 42 })).toBe(false)
  })

  it('names a source that collides with neither a path nor the paste literal', () => {
    expect(ATTACHMENT_PICK_SOURCE).toBe('file-picker')
    expect(ATTACHMENT_PICK_SOURCE).not.toContain('/')
    expect(ATTACHMENT_PICK_SOURCE).not.toBe(ATTACHMENT_PASTE_SOURCE)
    expect(isAttachmentPasteRequest({ source: ATTACHMENT_PICK_SOURCE, ...CONV })).toBe(false)
    expect(isAttachmentUploadRequest({ source: ATTACHMENT_PICK_SOURCE, ...CONV })).toBe(false)
  })
})
