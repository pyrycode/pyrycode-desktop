# #1631 — Open the markdown reader's note in another app

## Files read

- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `markdownReaderMenuOptions`, `useMarkdownReader`, `MarkdownReaderView`, `markdownFileName`, `MARKDOWN_OPEN_FAILED_NOTICE`. The menu rows, the hook that owns the actions, and the display name the request carries.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `MarkdownReaderView` mount. It needs two new props passed through.
- `src/main/attachmentOpen.ts` → `createAttachmentOpen`, `AttachmentOpenDeps`, `ATTACHMENT_OPEN_DIR_NAME`. The precedent: injected directory, `open` narrowed to a boolean at the root, never rejects, content-free logging.
- `src/main/attachmentFilename.ts` → `sanitizeAttachmentFilename`, `FALLBACK_FILENAME`. The name gate. It has no length bound, and a bound added later must run after its prefix steps.
- `src/shared/ipc/attachmentOpen.ts`, `src/shared/ipc/workspaceFileRead.ts` → `isAttachmentOpenRequest`, `isWorkspaceFileReadRequest`. The guard layout: `in`-guarded fields on a narrowed object, with a size bound.
- `src/main/transport/attachmentReassembler.ts` → `ATTACHMENT_MAX_RETRIEVAL_BYTES`. The text bound must be at least this.
- `src/main/index.ts` → the `ipcMain.handle(CHAT_HISTORY_CHANNEL, …)` invoke registration and its `removeHandler`, plus the `createAttachmentOpen` wiring. These are the composition-root patterns.
- `src/preload/index.ts` → `openAttachment`, `readWorkspaceFile`, `pairingStatus` (invoke). The bridge method shape.
- `src/main/saveDebugBundle.ts` → the `flag: 'wx'` exclusive-create precedent.

In-flight overlap: `feature/1634` edits `ConversationScreen.tsx` in other blocks. This ticket adds two props to the `MarkdownReaderView` element only. The change is additive, so any later merge conflict should be small.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879 (reader and menu button: node 552-2404)

The options overlay is the dark rounded panel of single-line rows that `ComposerOptionsMenu` already draws, with the row text in on-surface and a highlighted row for hover. The new item is one more row of that panel, labelled "Open in another app", directly below Refresh. There is no new styling. The failure notice reuses the reader's existing in-reader banner (`conversation__banner markdown-reader__notice`).

## Context

The operator fixed the reader menu at six items on 2026-09-24. This is the fifth. The window holds the note's text. The main process writes that text to a file it owns and hands the file to the operating system's default `.md` app. No path crosses the bridge in either direction.

## Design

### Shared: `src/shared/ipc/markdownOpen.ts` (new)

- `MARKDOWN_OPEN_CHANNEL = 'pyry:markdown-open'`.
- `MAX_MARKDOWN_OPEN_TEXT_LENGTH = 32 * 1024 * 1024` (UTF-16 code units). A UTF-8 decode of N bytes yields at most N code units, so this covers the largest file the reader can receive. A test in `src/main` pins `>= ATTACHMENT_MAX_RETRIEVAL_BYTES`, because the shared module cannot import from main.
- `MAX_MARKDOWN_OPEN_NAME_LENGTH = 255`, which matches the reader's title cap (`markdownFileName`).
- `interface MarkdownOpenRequest { text: string; displayName: string }`.
- `isMarkdownOpenRequest(value: unknown): value is MarkdownOpenRequest` checks shape and size only. Each field must be an own string within its bound. Empty strings pass.
- `type MarkdownOpenFailure = 'refused' | 'write-failed' | 'open-failed'` and `type MarkdownOpenOutcome = { type: 'opened' } | { type: 'failed'; reason: MarkdownOpenFailure }`.

**This is one invoke channel, not a send/push pair. It departs from the ticket's "channel pair" wording.** The AC says the request carries only the text and the display name, so there is no correlation key. With a push channel and no key, a late outcome from an unmounted reader would land on the next reader's listener. An invoke resolves back to the exact caller, and the answer is short-lived: a local write plus the OS hand-off. The invoke precedents are chat history and pairing. A request that fails the guard is **dropped**: it makes no filesystem call and no OS call. The invoke still answers `refused` so the caller's promise settles. A conforming window never sees that answer.

### Main: `src/main/markdownOpen.ts` (new, Electron-free)

- `MARKDOWN_OPEN_DIR_NAME = 'markdown-views'`, joined onto `userData` at the root. It is a sibling of `attachment-views`.
- `markdownOpenFileName(displayName: string): string` is pure. It runs `sanitizeAttachmentFilename`, strips a trailing `.md` to get the stem, clamps the stem to 252 characters (255 NAME_MAX minus `.md`), and appends `.md`. The clamp runs after the sanitiser's prefix steps and cuts from the tail, so the sanitiser's postconditions hold. A name that already ends in `.md` comes back unchanged when it is within the bound.
- `createMarkdownOpen(deps: { openDir; open: (path) => Promise<boolean>; diagnosticLog? }): (request) => Promise<MarkdownOpenOutcome>` never rejects and never throws.
  1. `mkdir(openDir, { recursive, mode: 0o700 })`.
  2. Write the text to a temp file `.<uuid>.tmp` in `openDir` with `flag: 'wx'` and mode `0o600`, then `rename` it onto `resolve(openDir, name)`. The rename **replaces** whatever entry sits at the target, a symlink included, and never writes through it. The same display name overwrites its earlier file, so the directory holds at most one file per distinct sanitised name. A temp name begins with `.` and a sanitised name never does, so the two cannot collide. On failure the temp file is unlinked (best effort) and the outcome is `write-failed`.
  3. `open(target)` answers false or rejects → `open-failed`. True → `opened`.
- Logging: event `markdown-open`, with codes `started` / `opened` / `write-failed` / `open-failed` only. No caught error is inspected. The text, the name and the path are never put in a log record.

### Composition root: `src/main/index.ts`

`ipcMain.handle(MARKDOWN_OPEN_CHANNEL, …)` runs the guard first. The OS hand-off is `open: async (path) => (await shell.openPath(path)).length === 0`, narrowed to a boolean as #867 does it. `removeHandler` runs on `will-quit`.

### Preload: `src/preload/index.ts`

`openMarkdownInApp(request: MarkdownOpenRequest): Promise<MarkdownOpenOutcome>` calls `ipcRenderer.invoke` on the fixed channel.

### Renderer: `MarkdownReader.tsx` + `ConversationScreen.tsx`

- `markdownReaderMenuOptions` adds `{ id: 'open-in-app', label: 'Open in another app', unavailable: noContent, action: { type: 'open-in-app' } }` after Refresh.
- `useMarkdownReader` returns `openInApp()` and `openInAppFailed: boolean`. The flag is UI-local `useState`. The next attempt and `back` clear it, and the `alive` ref stops a late answer from setting it after unmount. `openInApp` acts on the text shown at the moment of the choice. It sends `{ text, displayName: markdownFileName(path) }`. When the answer is not `opened`, or the promise rejects, it sets the flag. Diagnostics: `open-in-app` and `open-in-app-failed`.
- `MarkdownReaderView` takes `openInAppFailed` and `onOpenInApp`. When the flag is set it draws `MARKDOWN_OPEN_IN_APP_FAILED_NOTICE = 'Could not open the note in another app.'` in the existing notice banner. This is static client-owned text.
- `ConversationScreen` passes the two new values through.

## State + concurrency model

No store. Each choice makes one awaited invoke. The main-side write goes through a temp file and a rename, so two concurrent opens of the same name end with the last rename winning, and both hand the same path to the OS. The main process holds no long-lived work, so there is nothing to cancel. Nothing in the renderer holds a subscription.

## Error handling

Every failure is a closed literal: `refused` (guard), `write-failed` (mkdir, temp write or rename) or `open-failed` (the OS declined, or the seam rejected). The renderer merges all three into one static notice.

## Testing strategy

- `src/shared/ipc/markdownOpen.test.ts`: the guard accepts a valid request and empty strings, and it accepts both fields at their bounds. It drops non-objects, missing fields, non-strings, a value one over either bound, and an inherited `__proto__` field. The channel is distinct from its neighbours.
- `src/main/markdownOpen.test.ts` runs against a temp dir with an injected `open`.
  - The written file contains the text and sits at `openDir/<name>.md`.
  - `../../x`, an absolute path and `''` all land directly inside `openDir` (the resolved `dirname` equals `openDir`).
  - A name already ending in `.md` gets no second suffix, and an over-long name is clamped to 255.
  - The same name twice overwrites: one file, holding the second text.
  - A symlink pre-placed at the target is replaced, and the file it pointed at is unchanged.
  - A blocked directory gives `write-failed`, with `open` never called and no temp file left behind.
  - `open` answering false gives `open-failed`, and `open` rejecting also gives `open-failed`.
  - Log records carry no text, name or path.
  - The bound relation `MAX_MARKDOWN_OPEN_TEXT_LENGTH >= ATTACHMENT_MAX_RETRIEVAL_BYTES` is pinned.
- `MarkdownReader.test.tsx`:
  - Five labels in order, and the new row is unavailable while loading and available once loaded.
  - The failure notice is drawn from props alone.
- There is no Playwright spec. Per the ticket, an e2e run must never launch a real external app, and the unit tests on the injected `open` seam carry that proof.

## Size

There are 6 production files: two new modules, preload, main index, `MarkdownReader.tsx` and `ConversationScreen.tsx`. That is one over the 5-file line. The sixth file gets a two-prop pass-through. Splitting it off would produce a slice whose only consumer is this ticket, so the floor rule keeps it here. Total written work is about 650 lines.

## Documentation handoff

The ticket names no documentation requirement. It is pending for the documentation stage to fold the new channel and the `markdown-views` directory into the conversation-shell overview as it sees fit.

## Open questions

- None blocking. `.MD` (uppercase) is not treated as `.md`, per the AC's literal "ends in `.md`".

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. There is one explicit boundary: `isMarkdownOpenRequest` (shape and size), then `markdownOpenFileName` (the name gate, which is `sanitizeAttachmentFilename`, the repo's one sanctioned crossing from daemon-derived text to a path component). The directory is a trusted value joined at the composition root. The window supplies no path, directory or extension.
- [Tokens] No findings. No secret is involved. The temp name comes from `crypto.randomUUID`. That is not a security property, because exclusive create carries the safety.
- [File / storage] No findings on traversal. The sanitiser's allowlist admits no separator. The final name is always `<stem>.md`, so the OS is always told `.md`, and a name like `x.command.md` still ends in `.md`. Containment is proven by tests for `../../x`, an absolute path and `''`. There is no TOCTOU and no symlink write-through. The temp file is created with `wx` (`O_EXCL` fails on any existing entry, a symlink included), and `rename` replaces the target entry rather than following it. A pre-placed symlink is tested. The write is atomic: temp plus rename, so a killed write never leaves a torn `<name>.md`. Scope: under `userData`, directory `0700`, files `0600`. Accepted by design: the note's text persists in plaintext in that directory after the reader closes, because the external app must be able to read it. It is workspace text, not a credential.
- [File / storage] OUT OF SCOPE. A process killed between the temp write and the rename leaves one hidden `.<uuid>.tmp` behind. That is bounded by kills, not by use. No ticket is filed. A retention pass over the app's derived directories (`attachment-views` has the same shape) would own it.
- [Electron attack surface] No findings. The bridge adds one method on a fixed invoke channel, and it never exposes `ipcRenderer`. The guard runs before any filesystem or OS call. `setWindowOpenHandler`'s `file:` and custom-protocol denies are untouched: the OS hand-off runs in main, on a path main computed. A compromised renderer gains one capability: writing a bounded `.md` file into one app-owned directory and asking the user's `.md` handler to open it.
- [Electron attack surface] OUT OF SCOPE. A compromised renderer can vary the display name to create many distinct files, each up to the text bound, which grows the directory on disk. A conforming renderer sends only names of notes the operator opens, and the same name overwrites. The renderer-compromise threat already includes stronger capabilities (driving the daemon). An eviction cap is deferred until growth is observed, and no ticket is filed.
- [Crypto] No findings. No cryptographic primitive is used.
- [Network & I/O] No findings. No socket is involved. The request is size-bounded at the guard (text ≤ 32 Mi code units, name ≤ 255).
- [Logs] No findings. Records carry only the static codes `started`, `opened`, `write-failed` and `open-failed`. Caught errors are never inspected, since a node:fs error message carries the path. `shell.openPath`'s path-bearing message is narrowed to a boolean at the root. The renderer notice is static client-owned text. The renderer diagnostics are the static codes `open-in-app` and `open-in-app-failed`.
- [Concurrency] No findings. Each ask is one awaited invoke with no long-lived work. Concurrent opens of one name use distinct temp files and atomic renames, so the last one wins and neither file is torn. The renderer's `alive` ref stops a late answer from setting state after unmount.
- [Threat model] No findings. Hostile daemon text is written as bytes and never interpreted by this app. The name is sanitised. What the user's own `.md` app does with the content is outside this app, the same as opening any downloaded note.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25

## Revisions

- 2026-09-25, during implementation: `e2e/markdown-reader-menu.spec.ts` (#1630) pinned the menu at four rows, so it now expects five. It checks that Open in another app is disabled while the first fetch is withheld and enabled once the note has loaded. It never chooses the item, so the no-external-app rule holds. The testing strategy's "no Playwright spec" still means no new spec.
