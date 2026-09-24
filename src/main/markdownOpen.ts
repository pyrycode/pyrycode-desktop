// Opens the markdown reader's note in the operating system's default app for `.md` (#1631). The
// window hands over the text it shows and a display name; this module writes the text into a directory
// the app owns and hands that file to the OS. attachmentOpen.ts (#867) is the precedent for the shape.
//
// THE NAME HAS ONE GATE, `sanitizeAttachmentFilename`. Its allowlist admits no separator, so whatever
// the window sent becomes exactly one component inside `openDir`; the `.md` suffix is appended after it,
// so the OS is always told `.md`.
//
// WRITE THROUGH A TEMP FILE, THEN RENAME. The temp file is created exclusively (`wx`), so nothing
// already at that name — a symlink included — is ever opened. `rename` then REPLACES whatever entry sits
// at the final name rather than following it, so a symlink planted there is swapped out, never written
// through. It is also what bounds the directory: the same display name overwrites its earlier file, so
// there is at most one file per distinct sanitised name. A killed write never leaves a torn note.
//
// THE DIRECTORY AND THE OS HAND-OFF ARE INJECTED, so this module carries no `electron` import and
// unit-tests against a temp directory. IT NEVER REJECTS: every path resolves to one outcome, which is
// what the composition root's handler returns. LOG-FREE of content: records carry static codes only,
// and no caught error is inspected, since a node:fs error message carries the path.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeAttachmentFilename } from './attachmentFilename'
import type { DiagnosticLog } from './diagnosticLog'
import type { MarkdownOpenOutcome, MarkdownOpenRequest } from '../shared/ipc/markdownOpen'

/** The directory the notes are written to, joined onto `app.getPath('userData')` at the root. */
export const MARKDOWN_OPEN_DIR_NAME = 'markdown-views'

const LOG_EVENT = 'markdown-open'

const SUFFIX = '.md'

/** NAME_MAX on the platforms this app ships for, in bytes; every sanitised character is one ASCII byte. */
const MAX_COMPONENT_LENGTH = 255

export interface MarkdownOpenDeps {
  /** `join(app.getPath('userData'), MARKDOWN_OPEN_DIR_NAME)`, never derived from the request. Created on
   *  first use, owner-only. */
  openDir: string
  /** `shell.openPath`, narrowed to a boolean at the root so the OS message — which carries the path —
   *  never reaches this module. */
  open: (path: string) => Promise<boolean>
  diagnosticLog?: DiagnosticLog
}

/**
 * The file name a display name is written under: sanitised, then `.md` appended unless it already ends
 * in `.md`. The stem is clamped from the tail to fit one component, which keeps the sanitiser's
 * guarantees about the front of the name. Pure.
 */
export function markdownOpenFileName(displayName: string): string {
  const safe = sanitizeAttachmentFilename(displayName)
  const stem = safe.endsWith(SUFFIX) ? safe.slice(0, -SUFFIX.length) : safe
  return `${stem.slice(0, MAX_COMPONENT_LENGTH - SUFFIX.length)}${SUFFIX}`
}

/** Build the open driver the composition root's handler calls with an already-guarded ask. */
export function createMarkdownOpen(
  deps: MarkdownOpenDeps
): (request: MarkdownOpenRequest) => Promise<MarkdownOpenOutcome> {
  const { openDir, open, diagnosticLog } = deps

  function settle(outcome: MarkdownOpenOutcome): MarkdownOpenOutcome {
    diagnosticLog?.event({ event: LOG_EVENT, code: outcome.type === 'opened' ? 'opened' : outcome.reason })
    return outcome
  }

  return async function openNote(request: MarkdownOpenRequest): Promise<MarkdownOpenOutcome> {
    diagnosticLog?.event({ event: LOG_EVENT, code: 'started' })
    const target = join(openDir, markdownOpenFileName(request.displayName))
    // A leading dot: sanitised names never begin with one, so a temp name cannot collide with a note.
    const temp = join(openDir, `.${randomUUID()}.tmp`)
    try {
      await mkdir(openDir, { recursive: true, mode: 0o700 })
      await writeFile(temp, request.text, { flag: 'wx', mode: 0o600 })
      await rename(temp, target)
    } catch {
      await unlink(temp).catch(() => undefined)
      return settle({ type: 'failed', reason: 'write-failed' })
    }
    try {
      // Under the catch too, so a seam that broke its contract cannot make this promise reject.
      if (!(await open(target))) return settle({ type: 'failed', reason: 'open-failed' })
    } catch {
      return settle({ type: 'failed', reason: 'open-failed' })
    }
    return settle({ type: 'opened' })
  }
}
