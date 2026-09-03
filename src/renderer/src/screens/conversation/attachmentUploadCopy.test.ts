import { describe, it, expect } from 'vitest'
import type { AttachmentUploadEvent, AttachmentUploadFailure } from '../../../../shared/ipc/attachmentUpload'
import {
  ATTACHMENT_UPLOAD_FAILURE_COPY,
  attachmentUploadOutcomeCopy,
  formatByteLimit
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
