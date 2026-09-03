// Copies one attachment that is ALREADY ON THIS MACHINE out of the app's private attachment directory
// and into the operating system's Downloads folder, with no save dialog, then reveals it there with the
// file selected (#814). It does not fetch: #996 owns that, and a source file that is not there is a
// failure rather than a trigger to go and get it.
//
// THE TWO UNTRUSTED VALUES HAVE ONE GATE EACH, BOTH PRE-EXISTING AND CONSUMED VERBATIM. The identifier
// goes through `resolveAttachmentPath` (#818), which REFUSES a non-canonical one before any filesystem
// call — there is deliberately no second escape check here, because two divergent checks on one
// directory ends with one of them being weaker. The file name goes through `sanitizeAttachmentFilename`
// (#819), which REWRITES rather than refuses, and is re-run HERE, main-side, on the value the path is
// actually built from: a component that arrived over the bridge is an untrusted string like any other,
// and that re-run is the only thing that makes it safe. The raw name is never joined to anything — it
// does not even reach `copyIntoDownloads`, which takes an already-sanitised component.
//
// BOTH ELECTRON TOUCHES ARE INJECTED, so this module carries no `electron` import and unit-tests against
// a temp directory — saveDebugBundle's and attachmentStore's composition-root seam. `app.getPath('downloads')`
// and the reveal (`shell.showItemInFolder`, the one that SELECTS the file; `shell.openPath` opens the
// folder without selecting it and does not satisfy AC 4) are closed in at the root.
//
// NO OVERWRITE, AND THE GUARANTEE IS THE COPY ITSELF. `COPYFILE_EXCL` is O_CREAT|O_EXCL, so the
// collision check and the create are one syscall with no existsSync-then-write TOCTOU gap — this is
// saveDebugBundle's `flag: 'wx'` restated for a copy. It also means a symlink already sitting in
// Downloads under the target name cannot be written through: O_EXCL fails EEXIST on an existing path
// even when the symlink dangles, so the loop advances rather than following it.
//
// THE FILE'S BYTES NEVER ENTER THIS PROCESS. The copy is kernel-side, where `storeAttachment` had to
// hold the whole buffer. LOG-FREE by construction all the same: neither the name nor any path reaches a
// log or a diagnostic record — "sanitised" does not mean "safe to log", because the transform removes
// the log-injection half of the hazard and touches the privacy half not at all.
//
// IT NEVER REJECTS AND NEVER THROWS. Every path resolves to one terminal, which is what licenses the
// composition root's bare `void` — a property of this module rather than of a `.catch()` anyone must
// remember. Note in particular that saveDebugBundle's exhaustion `Error`, which interpolates its `dir`
// into the message, is NOT copied: no string carrying a path is built here at all.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { constants } from 'node:fs'
import { copyFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sanitizeAttachmentFilename } from './attachmentFilename'
import { resolveAttachmentPath } from './attachmentPath'
import type { DiagnosticLog } from './diagnosticLog'
import type { AttachmentSaveEvent, AttachmentSaveRequest } from '../shared/ipc/attachmentSave'

/**
 * Loop-termination insurance against a pathological all-names-taken Downloads folder; not a defence
 * against an observed attack. saveDebugBundle's constant and its reasoning — any generous number works.
 */
export const MAX_SAVE_ATTEMPTS = 10_000

/** The static event name every record from this module carries. */
const LOG_EVENT = 'attachment-save'

/** True for a Node fs error carrying an errno `code` (ENOENT, EEXIST, ENAMETOOLONG, …). */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/** The injected collaborators. Both directories are TRUSTED values from the composition root; the
 *  request's two fields are UNTRUSTED. Same type, different trust levels, so the distinction can only be
 *  said here. */
export interface AttachmentSaveDeps {
  /** The app-private attachment directory — `join(app.getPath('userData'), ATTACHMENT_DIR_NAME)`,
   *  computed at the root and never derived from anything the window sent. */
  attachmentDir: string
  /** The operating system's Downloads folder — `app.getPath('downloads')`. Never created by this
   *  module: it pre-exists and is user-owned (saveDebugBundle's rule for the same folder). */
  downloadsDir: string
  /** Reveal the saved file in the OS file manager WITH IT SELECTED — `shell.showItemInFolder`, closed
   *  in at the root. Called only after a successful copy, and only with a path this module built. */
  reveal: (path: string) => void
  /** The one content-free logger (#126). Optional: the flow is correct without it. */
  diagnosticLog?: DiagnosticLog
}

/**
 * Build the save driver: one function the composition root's channel listener calls with an
 * already-guarded ask, answering the terminal outcome.
 *
 * THE TERMINAL IS THE RESOLVED VALUE, not a pushed event, which is the one departure from
 * `createAttachmentRetrieval`. That driver carries an `emit` per ask because it holds cross-ask state
 * (a concurrency cap and coalescing) that must live longer than any one ask; this flow holds none, so
 * "exactly one terminal per ask" is bought by a promise settling once rather than by an invariant. The
 * closure exists only to bind the three trusted values once instead of threading them through every call.
 *
 * THERE IS NO CONCURRENCY CAP HERE, and that is a decision rather than an omission. Retrieval caps
 * because an unbounded fan-out voids a per-transfer memory bound; a copy streams kernel-side and
 * accumulates nothing. A cap would bound instantaneous parallelism and NOT total volume — the same
 * caller simply paces its asks — so it would read as a defence while closing nothing. Bounding disk
 * churn properly is a per-session budget across every channel that writes, which no acceptance criterion
 * describes; saveDebugBundle, an unbounded-repeat user-triggered write into this same folder, carries no
 * such bound either. Concurrent saves need no coordination regardless: exclusive-create makes the loser
 * advance a candidate rather than tear a file.
 */
export function createAttachmentSave(
  deps: AttachmentSaveDeps
): (request: AttachmentSaveRequest) => Promise<AttachmentSaveEvent> {
  const { attachmentDir, downloadsDir, reveal, diagnosticLog } = deps

  /** The one exit: log the static code, answer the terminal. */
  function settle(event: AttachmentSaveEvent): AttachmentSaveEvent {
    diagnosticLog?.event({
      event: LOG_EVENT,
      code: event.type === 'saved' ? 'saved' : event.reason
    })
    return event
  }

  return async function save(request: AttachmentSaveRequest): Promise<AttachmentSaveEvent> {
    const { attachmentId } = request
    diagnosticLog?.event({ event: LOG_EVENT, code: 'started' })

    // The identifier gate, BEFORE any filesystem call (AC 1). A refusal and an absent file are one
    // reason: a consumer's answer to both is to fetch the attachment and ask again.
    const source = resolveAttachmentPath(attachmentDir, attachmentId)
    if (!source.ok) {
      return settle({ type: 'failed', attachmentId, reason: 'source-unavailable' })
    }

    // The name gate. From here on the raw name is out of scope — `copyIntoDownloads` is given the
    // component and never the request, so building a path from the raw field would take editing two
    // functions rather than one line.
    const component = sanitizeAttachmentFilename(request.filename)

    let saved: string
    try {
      saved = await copyIntoDownloads(source.path, downloadsDir, component)
    } catch (error) {
      // The caught object is DROPPED, never inspected beyond its errno: a node:fs ErrnoException
      // carries the offending path in its own message. ENOENT is also what copyFile reports for an
      // absent DESTINATION directory, so an absent Downloads folder is answered as if the source were
      // absent — accepted, because distinguishing the two needs a check-then-act on a path, the
      // mis-report costs one wasted retry, and app.getPath('downloads') naming a directory that does
      // not exist is a pathological environment.
      const missing = isErrnoException(error) && error.code === 'ENOENT'
      return settle({
        type: 'failed',
        attachmentId,
        reason: missing ? 'source-unavailable' : 'save-failed'
      })
    }

    // AC 4. Guarded because the bytes are already on disk by this point: a reveal that fails must not
    // be reported as a save that did not happen, and it must not break the never-rejects property.
    try {
      reveal(saved)
    } catch {
      // Nothing to do and nothing safe to say about it — the path is the only detail it could carry.
    }
    return settle({ type: 'saved', attachmentId })
  }
}

/**
 * Copy `source` into `dir` under the first free browser-style candidate of `component`, and answer the
 * absolute path written. Rejects with the underlying errno for the caller to classify — nothing here
 * builds a message, and the errno is the only thing ever read off it.
 *
 * `component` is ALREADY SANITISED: exactly one path segment, never empty, never `.` or `..`, never
 * beginning with `.`, no separator, ASCII. This function takes it rather than the raw name so that
 * property is a precondition a caller must satisfy on purpose.
 *
 * On EEXIST the loop advances WITHOUT unlinking — that file is not ours, and removing it is the
 * overwrite AC 3 forbids. On any other errno the partial destination is best-effort unlinked before the
 * error propagates, so nothing partial is left in Downloads (AC 5).
 */
async function copyIntoDownloads(source: string, dir: string, component: string): Promise<string> {
  for (let n = 0; n < MAX_SAVE_ATTEMPTS; n += 1) {
    const target = resolve(dir, candidateName(component, n))
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL)
      return target
    } catch (error) {
      if (isErrnoException(error) && error.code === 'EEXIST') continue
      await unlink(target).catch(() => undefined)
      throw error
    }
  }
  // Exhaustion is a save failure like any other. Deliberately NOT saveDebugBundle's message, which
  // interpolates its directory: no string carrying a path is constructed in this module.
  throw new Error('attachment-save: no free filename')
}

/**
 * Candidate `n` for `component`: n === 0 is the component verbatim, n >= 1 inserts a browser-style
 * ` (n)` before the extension — `report.pdf` → `report (1).pdf`, `archive.tar.gz` → `archive.tar (1).gz`
 * (Chrome's answer), `notes` → `notes (1)`.
 *
 * The split is at the LAST dot, and only when its index is greater than 0. `sanitizeAttachmentFilename`
 * already guarantees the component never begins with `.`, so index 0 is unreachable — the `> 0` test is
 * what makes losing that guarantee harmless (a suffix appended whole) rather than a hidden-file bug.
 */
function candidateName(component: string, n: number): string {
  if (n === 0) return component
  const dot = component.lastIndexOf('.')
  if (dot > 0) return `${component.slice(0, dot)} (${n})${component.slice(dot)}`
  return `${component} (${n})`
}
