// The markdown reader's open-in-another-app channel between the renderer window and the background
// process (#1631): one channel constant, the request shape plus its boundary guard, and one sealed
// outcome union, imported by both process sides. The window hands over the text it is showing and a
// display name; the background process writes that text into a directory it owns and hands the file to
// the operating system's default app for `.md`.
//
// NO PATH CROSSES IN EITHER DIRECTION. The window names neither the directory nor the final file name;
// the display name is a hint that main rewrites with `sanitizeAttachmentFilename` before it becomes a
// path component, and the outcome carries a static reason and nothing else.
//
// ONE INVOKE CHANNEL, NOT attachmentOpen.ts's SEND/PUSH PAIR. The request carries only the text and
// the name, so there is no correlation key, and a pushed outcome with no key would land on whichever
// reader is listening, including one mounted after the asker unmounted. An invoke answers exactly the
// caller, and the answer is a local write plus the OS hand-off, not a long wait.
//
// Channel constant + discriminated union + one pure guard; no I/O, no state, nothing from src/main.
// Relative imports only: src/main and src/preload have no @shared alias.

/** The ask and its answer, renderer ⇄ main (ipcRenderer.invoke / ipcMain.handle). */
export const MARKDOWN_OPEN_CHANNEL = 'pyry:markdown-open' as const

/**
 * Upper bound on the text, in UTF-16 code units. Decoding N bytes of UTF-8 yields at most N code
 * units, so this admits the largest file the reader can receive (ATTACHMENT_MAX_RETRIEVAL_BYTES in
 * src/main/transport/attachmentReassembler.ts, ~23 MB). That relation is pinned by a test in
 * src/main/markdownOpen.test.ts, because this module cannot import from src/main.
 */
export const MAX_MARKDOWN_OPEN_TEXT_LENGTH = 32 * 1024 * 1024

/** Upper bound on the display name: the reader's own title cap, one path component. */
export const MAX_MARKDOWN_OPEN_NAME_LENGTH = 255

/** What the window hands over: the text on screen and the last component of the path it came from. */
export interface MarkdownOpenRequest {
  /** The note as the reader shows it. Daemon-supplied: written as bytes, never logged. */
  text: string
  /** UNTRUSTED name hint. Main sanitises it into one component; it never becomes a path as sent. */
  displayName: string
}

/**
 * The runtime guard the main handler applies at the untrusted renderer → main boundary. A failing ask
 * is DROPPED: no filesystem call and no OS call. Shape and size only; empty strings pass, since an empty
 * note is loaded content and the sanitiser has a fallback for an empty name. The `in` checks run on a
 * narrowed object, so a `__proto__`-smuggled field is not an own property and is refused.
 */
export function isMarkdownOpenRequest(value: unknown): value is MarkdownOpenRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('text' in value) || !('displayName' in value)) return false
  const { text, displayName } = value
  return (
    typeof text === 'string' &&
    text.length <= MAX_MARKDOWN_OPEN_TEXT_LENGTH &&
    typeof displayName === 'string' &&
    displayName.length <= MAX_MARKDOWN_OPEN_NAME_LENGTH
  )
}

/** Why an open ended with nothing in an app, as CLIENT-OWNED literals: no path, name or OS message. */
export type MarkdownOpenFailure =
  /** The ask failed the guard. A conforming window never sees this; it exists so the invoke settles. */
  | 'refused'
  /** The directory, the temp write or the rename onto the final name failed. */
  | 'write-failed'
  /** The file was written and the operating system declined to open it. */
  | 'open-failed'

/** The one answer per ask, discriminated on `type`. */
export type MarkdownOpenOutcome =
  /** The operating system accepted the hand-off. What the app then shows is outside this app. */
  | { type: 'opened' }
  | { type: 'failed'; reason: MarkdownOpenFailure }
