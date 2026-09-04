import { describe, it, expect } from 'vitest'
import type { AttachmentUploadEvent, AttachmentUploadFailure } from '../../../../shared/ipc/attachmentUpload'
import {
  ATTACHMENT_UPLOAD_FAILURE_COPY,
  attachmentUploadOutcomeCopy,
  formatByteLimit,
  uploadProgressPercent
} from './attachmentUploadCopy'

// #863: the composer's copy for one attach outcome — the whole of AC3, provable by calling a function
// because the module is pure. Every sentence it can produce is a literal written in this repo; nothing on
// AttachmentUploadEvent can hold the file's bytes, its host path or its name, so these tests are about
// COVERAGE and SELECTION, never about escaping.

// One event of each shape, built here rather than in each test — the discriminator is what varies.
const failedWith = (reason: AttachmentUploadFailure): AttachmentUploadEvent => ({
  type: 'failed',
  uploadId: 'upload-id',
  reason
})

describe('ATTACHMENT_UPLOAD_FAILURE_COPY — the exhaustive failure map (#863 AC3)', () => {
  // THE EXHAUSTIVENESS ITSELF IS THE COMPILER'S, not this file's: the map is declared
  // Record<AttachmentUploadFailure, string>, so a member added upstream fails to typecheck rather than
  // rendering blank. What is provable at runtime is that no member the compiler accepted is EMPTY — and
  // Object.values walks the actual union, because the record literal is forced to be complete.
  //
  // DELIBERATELY NO COUNT AND NO RESTATED MEMBER LIST. The union has grown twice since this family
  // started (#999 added the two retrieval codes), and every number written in prose went stale when it
  // did — the shipped docblock now refuses to give one for that reason. A `toHaveLength(n)` here would be
  // the same mistake in a test, and an `AttachmentUploadFailure[]` fixture listing the members would be
  // worse: it would still typecheck when the union grew, and silently stop covering the new member.
  it('gives every failure member a non-blank sentence', () => {
    const values = Object.values(ATTACHMENT_UPLOAD_FAILURE_COPY)
    expect(values.length).toBeGreaterThan(0)
    for (const copy of values) {
      expect(typeof copy).toBe('string')
      expect(copy.trim()).not.toBe('')
    }
  })

  // The union's own docblock rules on these two: they answer a `request_attachment`, never an
  // `attachment_chunk`, so no upload ends this way and "no composer copy should be written for them" —
  // while a HOSTILE daemon can still correlate either code to a pending chunk, so they must not fall
  // through to blank either. One shared non-committal sentence is the resolution, not a contradiction.
  it('answers the two retrieval-leg codes with one shared non-committal sentence', () => {
    const notFound = ATTACHMENT_UPLOAD_FAILURE_COPY['attachment-not-found']
    const aborted = ATTACHMENT_UPLOAD_FAILURE_COPY['attachment-stream-aborted']
    expect(notFound).toBe(aborted)
    expect(notFound.trim()).not.toBe('')
    // Non-committal means it claims nothing about WHY. It must not be some other member's sentence
    // either — a shared string that happens to equal `unclassified`'s would read as a classification.
    const others = Object.entries(ATTACHMENT_UPLOAD_FAILURE_COPY).filter(
      ([reason]) => reason !== 'attachment-not-found' && reason !== 'attachment-stream-aborted'
    )
    for (const [, copy] of others) expect(copy).not.toBe(notFound)
  })

  // AC3's failure arm end to end, as EQUALITY rather than toContain. That is what forbids the
  // interpolation shortcut: `Upload failed: ${reason}` would satisfy a substring check while making the
  // rendered sentence daemon-SELECTED rather than client-authored, which is the property AC3 is about.
  it('selects the mapped sentence verbatim, with the reason never interpolated into it', () => {
    for (const reason of Object.keys(ATTACHMENT_UPLOAD_FAILURE_COPY) as AttachmentUploadFailure[]) {
      const copy = attachmentUploadOutcomeCopy(failedWith(reason))
      expect(copy).toBe(ATTACHMENT_UPLOAD_FAILURE_COPY[reason])
      expect(copy).not.toContain(reason)
    }
  })

  // ⭐ THE SECURITY REVIEW'S FIRST FINDING, as a test. `reason` arrives off ipcRenderer.on, where the
  // declared type is the compile-time half ONLY — nothing validates the runtime value. Against a bare
  // object literal, FAILURE_COPY['constructor'] returns a FUNCTION off Object.prototype; `?? fallback`
  // does not fall through, because a function is not nullish; React then throws "Objects are not valid as
  // a React child" out of the composer's render. The Map indirection is what makes this read total.
  //
  // The cast is deliberate and confined to this test: it is the one place the declared type is lied to,
  // which is exactly what the runtime boundary does. Delete the Map and this reddens.
  it('answers a prototype key with a client-owned string, never a function (security review 1)', () => {
    for (const hostile of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const copy = attachmentUploadOutcomeCopy(failedWith(hostile as AttachmentUploadFailure))
      expect(typeof copy).toBe('string')
      expect(copy.trim()).not.toBe('')
      expect(copy).not.toContain('function')
      expect(copy).not.toContain('[object')
    }
  })
})

describe('attachmentUploadOutcomeCopy — the three arms (#863 AC3)', () => {
  // AC3's refusal arm. The limit is READ OFF THE EVENT, never a constant of this module's own — two
  // different limits must produce two different sentences, which is what stops the copy drifting from the
  // bound the background process actually enforced.
  it('names the limit it was handed, and a different limit reads differently', () => {
    const at23 = attachmentUploadOutcomeCopy({
      type: 'refused',
      uploadId: 'a',
      reason: 'too-large',
      limitBytes: 23_040_000
    })
    const at1 = attachmentUploadOutcomeCopy({
      type: 'refused',
      uploadId: 'b',
      reason: 'too-large',
      limitBytes: 1_000_000
    })
    expect(at23).toContain('23 MB')
    expect(at1).toContain('1 MB')
    expect(at23).not.toBe(at1)
  })

  // ⭐ THE SECURITY REVIEW'S SECOND FINDING. `limitBytes` is the CLIENT's own bound, and the union's
  // docblock is explicit that a file under it can still come back `attachment-too-large` from the daemon.
  // Copy claiming the host will not accept files over this figure would state a fact the renderer does not
  // have — and would mislead exactly when someone is working out why an upload failed. The refusal speaks
  // for this app; `attachment-too-large` is the sentence that speaks for the host.
  it('attributes the refusal limit to this app, never to the host', () => {
    const refused = attachmentUploadOutcomeCopy({
      type: 'refused',
      uploadId: 'a',
      reason: 'too-large',
      limitBytes: 23_040_000
    })
    expect(refused).toContain('this app')
    expect(refused.toLowerCase()).not.toContain('host')
    expect(ATTACHMENT_UPLOAD_FAILURE_COPY['attachment-too-large'].toLowerCase()).toContain('host')
  })

  // ⭐ #1032's refusal arm — a SECOND member under one `type`, which is what forced the switch to branch
  // twice. It is a refusal and not a failure (the ticket's second criterion), so it must not read as one
  // and must not have been smuggled into ATTACHMENT_UPLOAD_FAILURE_COPY.
  it('states the clipboard reason, with no limit figure and nothing from the clipboard', () => {
    const copy = attachmentUploadOutcomeCopy({ type: 'refused', uploadId: 'a', reason: 'no-image' })

    // It names WHY, so the reader learns nothing was there rather than that something broke.
    expect(copy.toLowerCase()).toContain('clipboard')
    expect(copy.trim()).not.toBe('')
    // No figure of any kind: this refusal has no limit to state, and inventing one would be a lie the
    // too-large arm's own test forbids in the other direction.
    expect(copy).not.toMatch(/\d/)
    // It is not one of the failure sentences, and the reason literal is not interpolated — the same
    // selection-not-rendering property the failure arm is held to.
    expect(Object.values(ATTACHMENT_UPLOAD_FAILURE_COPY)).not.toContain(copy)
    expect(copy).not.toContain('no-image')
  })

  it('reads differently from the too-large refusal, which keeps its limit', () => {
    // THE WHOLE POINT OF THE SPLIT, as one assertion. Widening `reason` in place would have typechecked
    // and rendered the too-large sentence — limit figure and all — for a clipboard that held no image,
    // so these two must not be the same string and the shipped one must still name its bound.
    const noImage = attachmentUploadOutcomeCopy({
      type: 'refused',
      uploadId: 'a',
      reason: 'no-image'
    })
    const tooLarge = attachmentUploadOutcomeCopy({
      type: 'refused',
      uploadId: 'a',
      reason: 'too-large',
      limitBytes: 23_040_000
    })
    expect(noImage).not.toBe(tooLarge)
    expect(tooLarge).toContain('23 MB')
    expect(noImage).not.toContain('23 MB')
  })

  // AC3's third arm. #815 is not started, so nothing else anywhere is evidence that a file was stored —
  // a silent success would be indistinguishable from a cancelled picker, which reports nothing at all.
  it('acknowledges a completed upload rather than saying nothing', () => {
    const copy = attachmentUploadOutcomeCopy({ type: 'completed', uploadId: 'a' })
    expect(copy.trim()).not.toBe('')
    // It reads as success, not as one of the failure sentences.
    expect(Object.values(ATTACHMENT_UPLOAD_FAILURE_COPY)).not.toContain(copy)
  })

  // The uploadId is on every member and is deliberately UNREAD: the renderer cannot correlate it to a
  // click (requestAttachmentUpload returns void), so surfacing it could only invite a correlation that
  // does not exist. It must reach no sentence.
  it('never puts the uploadId in a sentence', () => {
    const id = 'b3f1c0de-0000-4000-8000-000000000000'
    expect(attachmentUploadOutcomeCopy({ type: 'completed', uploadId: id })).not.toContain(id)
    expect(attachmentUploadOutcomeCopy(failedWith('unreadable'))).not.toContain(id)
    expect(
      attachmentUploadOutcomeCopy({
        type: 'refused',
        uploadId: id,
        reason: 'too-large',
        limitBytes: 23_040_000
      })
    ).not.toContain(id)
  })
})

describe('formatByteLimit', () => {
  // Decimal units, not binary: the figure is user-facing and this is how the desktop states file sizes.
  it('reads the shipped bound as a whole number of MB', () => {
    expect(formatByteLimit(23_040_000)).toBe('23 MB')
  })

  it('keeps one decimal where the figure needs it, and drops a trailing zero', () => {
    expect(formatByteLimit(1_500_000)).toBe('1.5 MB')
    expect(formatByteLimit(2_000_000)).toBe('2 MB')
  })

  // THE UNIT CHAIN IS WHY THIS FUNCTION EXISTS. A bare `bytes / 1e6` would print "0 MB" for a small
  // bound — a limit the user cannot act on and, worse, one that is false. The bound is client-owned and
  // ~23 MB today, but the formatter must not lie for a value it may be handed later.
  it('never prints a zero figure — it steps down a unit instead', () => {
    expect(formatByteLimit(4_096)).toBe('4.1 kB')
    expect(formatByteLimit(1_000)).toBe('1 kB')
    expect(formatByteLimit(999)).toBe('999 bytes')
    expect(formatByteLimit(0)).toBe('0 bytes')
  })
})

// #864: the in-flight sentence. It is the one figure in this module the CLIENT computes rather than
// selects, which is why it needs a totality proof the other arms do not: `sentChunks`/`totalChunks`
// arrive off `ipcRenderer.on`, where the declared type is the compile-time half only.
const progressWith = (sentChunks: number, totalChunks: number): AttachmentUploadEvent => ({
  type: 'progress',
  uploadId: 'upload-id',
  sentChunks,
  totalChunks
})

describe('uploadProgressPercent — the computed figure (#864 AC1)', () => {
  it('reports the chunks on the wire against the plan total, floored', () => {
    expect(uploadProgressPercent(0, 200)).toBe(0)
    expect(uploadProgressPercent(1, 200)).toBe(0)
    expect(uploadProgressPercent(50, 200)).toBe(25)
    expect(uploadProgressPercent(199, 200)).toBe(99)
  })

  it('reaches 100 when every chunk is on the wire, and the terminal is still to come', () => {
    // 100% states that this client has put the whole file out, which is exactly what "how far the
    // transfer has got" measures. Capping at 99 to reserve the figure for the terminal would make the
    // reading never arrive at the number it counts towards, and the terminal says the rest.
    expect(uploadProgressPercent(200, 200)).toBe(100)
  })

  it('is total against a value that never came from this app', () => {
    // Nothing validates what crosses the bridge, so every one of these is reachable from a
    // non-conforming sender and none may render as "NaN%" or as a figure outside the scale.
    expect(uploadProgressPercent(1, 0)).toBe(0)
    expect(uploadProgressPercent(1, -5)).toBe(0)
    expect(uploadProgressPercent(-3, 10)).toBe(0)
    expect(uploadProgressPercent(500, 10)).toBe(100)
    expect(uploadProgressPercent(Number.NaN, 10)).toBe(0)
    expect(uploadProgressPercent(1, Number.NaN)).toBe(0)
    expect(uploadProgressPercent(Number.POSITIVE_INFINITY, 10)).toBe(0)
    expect(uploadProgressPercent(1, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('rejects a count that is a string, which the global isFinite would have accepted', () => {
    // `Number.isFinite` does not coerce and the global `isFinite` does: `isFinite('5')` is true, so a
    // guard written with the global would let a string reach the arithmetic and state a figure derived
    // from it.
    //
    // ASSERTED AS WHOLE-SENTENCE EQUALITY, NEVER AS A SUBSTRING. This test shipped as
    // `toContain('0%')` against '5'/'10' and detected nothing: the coercing guard states `Uploading…
    // 50%`, which CONTAINS "0%" and contains no "NaN", so both assertions held under both guards while
    // the comment told the next reader they were covered. A substring of a percent figure is a
    // sub-figure of every percent figure that ends in it.
    const hostile = { type: 'progress', uploadId: 'u', sentChunks: '5', totalChunks: '8' }
    const sentence = attachmentUploadOutcomeCopy(hostile as unknown as AttachmentUploadEvent)
    expect(sentence).not.toContain('NaN')
    expect(sentence).toBe(attachmentUploadOutcomeCopy(progressWith(0, 8)))
    // ...and the equality above is one this module can FAIL: read as numbers, the very same counts state
    // a different sentence. Without this line the assertion would still pass against an implementation
    // that had stopped distinguishing its inputs at all, which is the failure being repaired here.
    expect(attachmentUploadOutcomeCopy(progressWith(5, 8))).not.toBe(sentence)
  })
})

describe('attachmentUploadOutcomeCopy — the progress arm (#864 AC1)', () => {
  it('states the figure as one sentence that changes, carrying no id', () => {
    const sentence = attachmentUploadOutcomeCopy(progressWith(50, 200))
    expect(sentence).toContain('25%')
    expect(sentence).not.toContain('upload-id')
    // The counts themselves are not spelled out: what the composer states is how far, not how the
    // transport is chunked.
    expect(sentence).not.toContain('200')
    expect(sentence.trim()).not.toBe('')
  })

  it('advances as further chunks go out, and each figure is distinct', () => {
    const early = attachmentUploadOutcomeCopy(progressWith(20, 200))
    const late = attachmentUploadOutcomeCopy(progressWith(180, 200))
    expect(early).toContain('10%')
    expect(late).toContain('90%')
    expect(early).not.toBe(late)
  })

  it('says something different from every terminal sentence', () => {
    // The progress line and the terminal occupy the same slot, so a reader must be able to tell which
    // one is showing from the text alone.
    const progress = attachmentUploadOutcomeCopy(progressWith(1, 8))
    const terminals = [
      attachmentUploadOutcomeCopy({ type: 'completed', uploadId: 'u' }),
      attachmentUploadOutcomeCopy(failedWith('connection-lost')),
      attachmentUploadOutcomeCopy({
        type: 'refused',
        uploadId: 'u',
        reason: 'too-large',
        limitBytes: 23_040_000
      })
    ]
    for (const terminal of terminals) expect(progress).not.toBe(terminal)
  })
})
