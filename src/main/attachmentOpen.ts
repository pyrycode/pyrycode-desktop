// Opens one attachment that is ALREADY ON THIS MACHINE in the operating system's default handler
// for its type (#867). It does not fetch: #996 owns that, and a file that is not there is a failure
// to REPORT rather than a trigger to go and get it — attachmentBytes.ts and attachmentSave.ts draw
// the same boundary, in those words.
//
// THE UNTRUSTED IDENTIFIER HAS ONE GATE, PRE-EXISTING AND CONSUMED VERBATIM. `resolveAttachmentPath`
// (#818) REFUSES a non-canonical identifier before any filesystem call — there is deliberately no
// second escape check here, because two divergent checks on one directory ends with one of them
// being weaker than the other.
//
// THE TYPE COMES FROM THE FILE'S OWN LEADING BYTES AND FROM NOTHING ELSE. The stored file is
// extension-less on purpose (attachmentPath.ts), so this module is the layer that decides what the
// operating system is told. `matchImageSignature` picks a suffix out of a closed set this app writes
// down; the wire's `mime_type`, a file name, and every other daemon-supplied value take no part —
// none of them even reaches this process. A file matching no member is REFUSED rather than opened.
//
// THE OPENED PATH IS A DERIVED COPY IN A SECOND APP-OWNED DIRECTORY, and the stored extension-less
// file is left exactly where it is. Three landed consumers address that path — #995's write, #866's
// read and #814's copy — so renaming or suffixing it in place is not available. A COPY RATHER THAN A
// HARD LINK, for two reasons either of which is sufficient: a link is the same inode under a second
// name, and that name is handed to an arbitrary application chosen by the user's file-type
// association, so a viewer that saves in place would write straight through into the stored
// attachment; and `storeAttachment` writes via a temp file plus rename, so a re-store changes the
// inode and a link made earlier would point at the old one forever. The bytes are not the trade they
// look like — the copy is kernel-side, and COPYFILE_FICLONE asks for a copy-on-write clone first.
//
// A SEPARATE DIRECTORY RATHER THAN A SUFFIXED SIBLING. `attachmentDir`'s invariant is that every
// file in it is named by the canonical alphabet and written by exactly one writer; mixing derived
// artefacts in would break both, and a future retention pass over that directory — which has no
// ticket, so it will be written without this context — would have to learn the difference. The
// derived directory is independently disposable: deleting all of it costs a re-derive and nothing
// else.
//
// THERE IS NO CONCURRENCY CAP, and that is a decision rather than an omission. attachmentBytes caps
// because whole files enter that process; here only SIGNATURE_PREFIX_BYTES ever do, and the copy is
// kernel-side, so attachmentSave's reasoning is the one that transfers. Nor is a disk budget owed:
// the derived name is deterministic per attachment, so this directory can never hold more than one
// file per stored attachment — a quantity `createAttachmentReassembler` already bounds.
//
// BOTH DIRECTORIES AND THE OS HAND-OFF ARE INJECTED, so this module carries no `electron` import and
// unit-tests against a temp directory — attachmentSave's and attachmentStore's composition-root seam.
//
// IT NEVER REJECTS AND NEVER THROWS. Every path resolves to one terminal, which is what licenses the
// composition root's bare `void` — a property of this module rather than of a `.catch()` anyone must
// remember. LOG-FREE of content by construction: no string carrying a path, a derived name, a matched
// type or an errno is ever built here, and no caught error is inspected beyond its errno code.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { constants } from 'node:fs'
import { copyFile, mkdir, open as openFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveAttachmentPath } from './attachmentPath'
import { SIGNATURE_PREFIX_BYTES, matchImageSignature } from './imageSignature'
import type { ImageSuffix } from './imageSignature'
import type { DiagnosticLog } from './diagnosticLog'
import type { AttachmentOpenEvent, AttachmentOpenRequest } from '../shared/ipc/attachmentOpen'

/**
 * The directory the derived, suffixed copies live in, joined onto `app.getPath('userData')` at the
 * composition root — ATTACHMENT_DIR_NAME's role for this feature's own directory.
 *
 * Deliberately a SIBLING of the attachment directory rather than a child of it: a child would be
 * visible to anything walking the attachment directory, and `resolveAttachmentPath` makes no
 * filesystem claim about what is at the path it returns, so a directory sitting there under a
 * canonical-looking name is exactly the confusion worth avoiding.
 */
export const ATTACHMENT_OPEN_DIR_NAME = 'attachment-views'

/** The static event name every record from this module carries. */
const LOG_EVENT = 'attachment-open'

/** True for a Node fs error carrying an errno `code` (ENOENT, EEXIST, ENOTDIR, …). */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/** The injected collaborators. Both directories are TRUSTED values from the composition root; the
 *  request's one field is UNTRUSTED. Same type, different trust levels, so the distinction can only
 *  be said here. */
export interface AttachmentOpenDeps {
  /** The app-private attachment directory — `join(app.getPath('userData'), ATTACHMENT_DIR_NAME)`,
   *  computed at the root and never derived from anything the window sent. Read-only to this
   *  module: nothing here writes, renames or unlinks inside it. */
  attachmentDir: string
  /** The app-private directory the derived suffixed copies live in —
   *  `join(app.getPath('userData'), ATTACHMENT_OPEN_DIR_NAME)`, computed at the root the same way.
   *  Created on first use, owner-only. */
  openDir: string
  /**
   * Hand a path to the operating system's default handler, answering whether it accepted —
   * `shell.openPath`, closed in at the root, the way `reveal` is for attachmentSave.
   *
   * A BOOLEAN, NOT ELECTRON'S OWN `Promise<string>`, and that narrowing is load-bearing.
   * `shell.openPath` does not throw: it resolves with the operating system's error MESSAGE, empty
   * on success, and THAT MESSAGE CARRIES THE PATH. Narrowing it to a bit at the root means this
   * module — the one that builds reasons and writes log records — never holds the string at all,
   * so AC 5 is a property of the seam rather than a rule someone must remember not to break.
   */
  open: (path: string) => Promise<boolean>
  /** The one content-free logger (#126). Optional: the flow is correct without it. */
  diagnosticLog?: DiagnosticLog
}

/**
 * Build the open driver: one function the composition root's channel listener calls with an
 * already-guarded ask, answering the terminal outcome.
 *
 * THE TERMINAL IS THE RESOLVED VALUE, `createAttachmentSave`'s and `createAttachmentBytes`'s shape
 * rather than `createAttachmentRetrieval`'s pushed emit: "exactly one terminal per ask" is then
 * bought by a promise settling once rather than by an invariant to maintain.
 *
 * THE CLOSURE HOLDS NO STATE — not even attachmentBytes' in-flight counter, since no cap is owed
 * here. It exists only to bind the three trusted values once instead of threading them through every
 * call, so unlike that driver there is nothing that breaks if it is rebuilt per ask. The root still
 * builds it once, for symmetry with its four siblings.
 */
export function createAttachmentOpen(
  deps: AttachmentOpenDeps
): (request: AttachmentOpenRequest) => Promise<AttachmentOpenEvent> {
  const { attachmentDir, openDir, open, diagnosticLog } = deps

  /** The one exit: log the static code, answer the terminal. */
  function settle(event: AttachmentOpenEvent): AttachmentOpenEvent {
    diagnosticLog?.event({
      event: LOG_EVENT,
      code: event.type === 'opened' ? 'opened' : event.reason
    })
    return event
  }

  return async function openAttachment(request: AttachmentOpenRequest): Promise<AttachmentOpenEvent> {
    const { attachmentId } = request
    diagnosticLog?.event({ event: LOG_EVENT, code: 'started' })

    // The identifier gate, BEFORE any filesystem call. It is also the distinction the window acts
    // on — a refusal is permanent, where an absent file is fetched and asked for again.
    const source = resolveAttachmentPath(attachmentDir, attachmentId)
    if (!source.ok) {
      return settle({ type: 'failed', attachmentId, reason: 'refused' })
    }

    let prefix: Uint8Array
    try {
      prefix = await readPrefix(source.path)
    } catch {
      // Absent, unreadable, or not a file at all — one reason, because a consumer's answer to every
      // one of them is to fetch the attachment and ask again. The caught object is DROPPED WITHOUT
      // BEING INSPECTED: a node:fs ErrnoException carries the offending path in its own message.
      return settle({ type: 'failed', attachmentId, reason: 'unavailable' })
    }

    // The type gate. A file matching no member is refused HERE — before any derived file exists and
    // before the operating system has been told anything at all.
    const suffix = matchImageSignature(prefix)
    if (suffix === null) {
      return settle({ type: 'failed', attachmentId, reason: 'unsupported-type' })
    }

    try {
      // One try for both steps on purpose: a failed derive and a declined hand-off are one reason,
      // because a consumer's answer to both is the same plain retry. It also puts a REJECTING seam
      // under the same catch, so a `shell.openPath` that broke its documented contract could not
      // escape as a rejected promise and break the never-rejects property the root's `void` rests on.
      const derived = await derive(source.path, openDir, attachmentId, suffix)
      if (!(await open(derived))) {
        return settle({ type: 'failed', attachmentId, reason: 'open-failed' })
      }
    } catch {
      return settle({ type: 'failed', attachmentId, reason: 'open-failed' })
    }

    return settle({ type: 'opened', attachmentId })
  }
}

/**
 * Read the first `SIGNATURE_PREFIX_BYTES` of `path`, or fewer if the file is shorter.
 *
 * THE PREFIX, NOT THE FILE. A dozen bytes decide every member of the signature set, and attachments
 * are bounded at ~23 MB each — reading one whole to look at twelve would be a regression against
 * both landed siblings' care, and it is what lets this path skip the concurrency cap attachmentBytes
 * needs. A short read is not an error: it simply matches nothing downstream.
 *
 * Rejects with the underlying errno for the caller to classify — nothing here builds a message, and
 * the error is never inspected. The handle is closed in a `finally` on every path, including the
 * EISDIR a directory at this path produces.
 */
async function readPrefix(path: string): Promise<Uint8Array> {
  const handle = await openFile(path, 'r')
  try {
    const buffer = new Uint8Array(SIGNATURE_PREFIX_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, SIGNATURE_PREFIX_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Materialise the suffixed copy `attachmentId` opens as, and answer its path. Rejects with the
 * underlying error for the caller to classify.
 *
 * EXCLUSIVE CREATE, SO A REPEAT OPEN REUSES RATHER THAN ACCUMULATES. `COPYFILE_EXCL` is
 * `O_CREAT|O_EXCL`, so the collision check and the create are one syscall with no existsSync-then-
 * write TOCTOU gap — attachmentSave's `copyIntoDownloads` restated for a fixed name. It also means a
 * symlink already sitting at the derived path cannot be written through, and that two concurrent
 * opens of one attachment resolve to reuse rather than to a torn file. EEXIST is therefore the
 * SUCCESS case for a second open, not a failure.
 *
 * `COPYFILE_FICLONE` is a hint on top: a copy-on-write clone where the filesystem supports it (APFS,
 * this app's primary platform), a full copy everywhere else. It costs nothing when unsupported and
 * keeps writes to the clone isolated from the original when it works.
 *
 * On any other error the partial destination is best-effort unlinked before the error propagates, so
 * a half-written file is not left behind to be reused by the next open.
 */
async function derive(
  source: string,
  openDir: string,
  attachmentId: string,
  suffix: ImageSuffix
): Promise<string> {
  await mkdir(openDir, { recursive: true, mode: 0o700 })
  const target = derivedPath(openDir, attachmentId, suffix)
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'EEXIST') {
      await unlink(target).catch(() => undefined)
      throw error
    }
  }
  return target
}

/**
 * The derived file's path: the identifier verbatim, with the matched suffix appended, inside the
 * derived directory. DETERMINISTIC PER ATTACHMENT, which is what makes a repeat open reuse rather
 * than accumulate — nothing evicts these files, so accumulation would be a real cost.
 *
 * PRECONDITION: `attachmentId` HAS ALREADY PASSED `resolveAttachmentPath`. This function takes it
 * rather than being inlined so that is a precondition a caller must satisfy on purpose —
 * `copyIntoDownloads`'s already-sanitised-component contract, restated.
 *
 * That precondition is also why this is NOT a second escape check and must not grow into one.
 * A gate-passed identifier is one path component drawn from a 64-character alphabet with no `.`,
 * no separator and no `:`, so appending a literal drawn from `ImageSuffix` leaves it one component
 * and containment follows from the gate that already ran. Restating it here would be exactly the
 * duplication `attachmentPath.ts`'s header warns ends with one of the two checks being weaker.
 *
 * Note the converse, which is what makes the derived file unreachable from the window: a name
 * carrying a `.` is unspellable in that alphabet, so no identifier the renderer can send resolves to
 * one of these files.
 */
function derivedPath(openDir: string, attachmentId: string, suffix: ImageSuffix): string {
  return resolve(openDir, `${attachmentId}${suffix}`)
}
