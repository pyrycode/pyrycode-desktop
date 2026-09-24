// The markdown reader's save-to-device channel between the renderer window and the background process
// (#1632): one channel constant and one sealed outcome union, imported by both process sides. The
// window hands over the text it is showing and a display name; the background process writes that text
// into the operating system's Downloads folder, never over an existing file, and reveals it.
//
// THE REQUEST AND ITS GUARD ARE markdownOpen.ts's, imported rather than restated: the same two fields
// under the same bounds, so the text bound stays the one pinned against the largest retrievable file.
// The WRITE is not shared with the open — that one replaces an existing file through temp-and-rename,
// which a save must never do; this one goes through attachmentSave.ts's exclusive-create loop.
//
// ONE INVOKE CHANNEL, for markdownOpen.ts's reason: the request carries no correlation key, so a pushed
// outcome could land on a reader other than the one that asked.
//
// Channel constant + discriminated union; no I/O, no state, nothing from src/main.
// Relative imports only: src/main and src/preload have no @shared alias.

/** The ask and its answer, renderer ⇄ main (ipcRenderer.invoke / ipcMain.handle). */
export const MARKDOWN_SAVE_CHANNEL = 'pyry:markdown-save' as const

/** Why a save ended with nothing in Downloads, as CLIENT-OWNED literals: no path, name or OS message. */
export type MarkdownSaveFailure =
  /** The ask failed `isMarkdownOpenRequest`. A conforming window never sees this; the invoke settles. */
  | 'refused'
  /** Every write failure: no Downloads folder, a name the filesystem rejects, a full disk, no free name. */
  | 'save-failed'

/** The one answer per ask, discriminated on `type`. */
export type MarkdownSaveOutcome =
  /** The note is in Downloads. The reveal is best-effort and not reported. */
  | { type: 'saved' }
  | { type: 'failed'; reason: MarkdownSaveFailure }
