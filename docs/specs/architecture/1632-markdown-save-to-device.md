# #1632 — Save the markdown reader's note to Downloads

## Files read

- `src/main/attachmentSave.ts` → `createAttachmentSave`, `copyIntoDownloads`, `candidateName`, `MAX_SAVE_ATTEMPTS`, `isErrnoException`. The collision loop this ticket shares, and the Downloads-no-overwrite-reveal contract the note save repeats.
- `src/main/attachmentSave.test.ts` → the two-directory temp harness. The note save's tests sit beside it.
- `src/main/attachmentFilename.ts` → `sanitizeAttachmentFilename`, `FALLBACK_FILENAME`. The name gate. It has no length bound, so an over-long name surfaces as ENAMETOOLONG from the write.
- `src/shared/ipc/markdownOpen.ts` → `MarkdownOpenRequest`, `isMarkdownOpenRequest`, `MAX_MARKDOWN_OPEN_TEXT_LENGTH`. Reused verbatim as the save's request and guard, as the ticket allows. Its text bound is already pinned against `ATTACHMENT_MAX_RETRIEVAL_BYTES` in `src/main/markdownOpen.test.ts`.
- `src/main/markdownOpen.ts` → `createMarkdownOpen`. The shape to mirror for the driver (injected seams, never rejects, static codes). Its temp-and-rename write is NOT reused: it replaces an existing file, which the save must never do.
- `src/main/index.ts` → the `createAttachmentSave` wiring (`downloadsDir`, `shell.showItemInFolder`) and the `ipcMain.handle(MARKDOWN_OPEN_CHANNEL, …)` registration with its `removeHandler` on `will-quit`.
- `src/preload/index.ts` → `openMarkdownInApp`. The bridge method shape.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `markdownReaderMenuOptions`, `useMarkdownReader` (`openInApp`, `openInAppFailed`), `MarkdownReaderView`, `markdownFileName`. The menu row, the hook action and the notice to mirror.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `MarkdownReaderView` mount; two props pass through.
- `e2e/markdown-reader-menu.spec.ts` → pins the rows in order and which are disabled before load.

In-flight overlap: `feature/1634` edits `ConversationScreen.tsx` in other blocks. This ticket adds two props to the `MarkdownReaderView` element only; the edit is additive.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879 (reader and menu button: node 552-2404)

The options overlay is the dark rounded panel of single-line rows that `ComposerOptionsMenu` already draws, row text in on-surface and a highlighted row on hover. The new item is one more row of that panel, "Save to device", last, directly below Open in another app. No new styling. The failure notice reuses the reader's in-reader banner (`conversation__banner markdown-reader__notice`).

## Context

The sixth and last reader-menu item the operator fixed on 2026-09-24. On desktop the "existing attachment save" is `createAttachmentSave`: no dialog, straight into Downloads, browser-style suffix on collision, exclusive create, reveal with the file selected. The note save does the same with text the window already holds. No path crosses the bridge.

## Design

### Shared: `src/shared/ipc/markdownSave.ts` (new)

- `MARKDOWN_SAVE_CHANNEL = 'pyry:markdown-save'`, one invoke channel, for #1631's reason: the request has no correlation key.
- Request and guard: `MarkdownOpenRequest` and `isMarkdownOpenRequest`, imported from `markdownOpen.ts`, not restated. The text bound is therefore the one already pinned against the largest retrievable file.
- `type MarkdownSaveFailure = 'refused' | 'save-failed'`; `type MarkdownSaveOutcome = { type: 'saved' } | { type: 'failed'; reason: MarkdownSaveFailure }`.

### Main: `src/main/attachmentSave.ts`

- **The shared loop.** `copyIntoDownloads` becomes `writeIntoDownloads(dir: string, component: string, create: (target: string) => Promise<void>): Promise<string>`, module-private: both drivers live in this file. It walks `candidateName(component, n)` for `n < MAX_SAVE_ATTEMPTS`, calls `create(resolve(dir, candidate))`, advances on EEXIST without unlinking, and on any other errno best-effort unlinks the target and rethrows. Precondition on `create`: it must create `target` exclusively (O_CREAT|O_EXCL) and reject EEXIST when anything is there. The attachment save passes `copyFile(source, target, COPYFILE_EXCL)`; behaviour unchanged, and its existing tests are the proof.
- **The note save.** `createMarkdownSave(deps: { downloadsDir; reveal: (path) => void; diagnosticLog? }): (request: MarkdownOpenRequest) => Promise<MarkdownSaveOutcome>`. It sanitises `displayName` with `sanitizeAttachmentFilename` (no `.md` appended: the attachment save keeps the sanitised name verbatim, and the display name is a file name that already carries its extension), then `writeIntoDownloads` with `create = writeFile(target, text, { flag: 'wx' })`. Any rejection → `save-failed`; the caught error is dropped unread. Success → guarded `reveal(saved)`, then `saved`. Never rejects, never throws. It lives here rather than in a new module so the loop has no second home, and the ticket's file count holds.
- Logging: event `markdown-save`, codes `started` / `saved` / `save-failed` only.

### Composition root: `src/main/index.ts`

`createMarkdownSave({ downloadsDir, reveal: (path) => shell.showItemInFolder(path), diagnosticLog })`, and `ipcMain.handle(MARKDOWN_SAVE_CHANNEL, …)` that runs `isMarkdownOpenRequest` first and answers `{ type: 'failed', reason: 'refused' }` on a malformed ask. `removeHandler` on `will-quit`.

### Preload: `src/preload/index.ts`

`saveMarkdownToDevice(request: MarkdownOpenRequest): Promise<MarkdownSaveOutcome>` → `ipcRenderer.invoke(MARKDOWN_SAVE_CHANNEL, request)`.

### Renderer: `MarkdownReader.tsx` + `ConversationScreen.tsx`

- `markdownReaderMenuOptions` appends `{ id: 'save', label: 'Save to device', unavailable: noContent, action: { type: 'save' } }`.
- `MARKDOWN_SAVE_FAILED_NOTICE = 'Could not save the note.'`, static and client-owned.
- `useMarkdownReader` gains `saveFailed: boolean` and `save(): void`, mirroring `openInApp`: only in `loaded`, clears the flag, sends the text and `markdownFileName(state.path)`, sets the flag on a failed outcome or a rejected invoke (behind `alive`). `back` clears it. Diagnostics `save` / `save-failed`.
- `MarkdownReaderView` gains `saveFailed` and `onSave`; `choose` routes `save`. The notice renders in the same banner as the open failure. `ConversationScreen` passes `reader.saveFailed` and `reader.save`.

## State + concurrency model

No store. One UI-local boolean in the hook, cleared by the next attempt and by back; a conversation switch remounts and drops it. Each save is one awaited invoke; no long-lived work. Concurrent saves of one name need no coordination: exclusive create makes the loser advance a candidate.

## Error handling

Guard failure → `refused` without a filesystem call. Every write failure (missing Downloads, ENAMETOOLONG, ENOSPC, exhaustion) → `save-failed`, with the partial target unlinked by the shared loop. A throwing reveal still answers `saved`. The renderer shows the static notice for any non-`saved` answer or a rejected invoke. No text, name or path is logged anywhere.

## Testing strategy

Vitest, `src/main/attachmentSave.test.ts` (real filesystem, temp dirs), new `describe('createMarkdownSave')`:
- writes the text into Downloads under the sanitised name and reveals that path;
- `../../x`, an absolute path (`/etc/passwd`) and `''` each land as one file directly inside Downloads, nothing outside it;
- a second save of one name, and a pre-existing file, get `notes (1).md`, the existing file untouched;
- a symlink planted at the target name is not written through;
- a missing Downloads and an over-long name answer `save-failed` and leave nothing behind;
- a throwing reveal still answers `saved`;
- log records carry only static codes, never the text, the name or a path.
The existing `createAttachmentSave` tests prove the loop extraction changed nothing.

Vitest, `MarkdownReader.test.tsx`: six labels in order, Save to device unavailable while loading and available once loaded; the save-failure notice renders from state alone.

Playwright, `e2e/markdown-reader-menu.spec.ts`: six rows, Save to device disabled before load and enabled after. It is listed and gated, never chosen, so an e2e run neither writes into the real Downloads nor opens Finder.

## Documentation handoff

The ticket has no Documentation handoff section. Pending for the documentation stage: fold the note save and the shared `writeIntoDownloads` loop into the reader's and the attachment save's package overviews.

## Open questions

- None blocking. Whether a success confirmation is wanted: not in the AC; the reveal is the confirmation, as for a file row.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. One explicit boundary: `isMarkdownOpenRequest` (own string fields, text ≤ 32 Mi code units, name ≤ 255), run in the `MARKDOWN_SAVE_CHANNEL` handler before any filesystem call. Then `sanitizeAttachmentFilename`, re-run main-side in `createMarkdownSave` on the value the path is built from. The directory is `app.getPath('downloads')`, a trusted value closed in at the root. The window supplies no path, directory or extension.
- [Tokens] No findings. No secret is involved and no randomness is needed.
- [File / storage] No findings on traversal: the sanitiser's allowlist admits no separator, so the candidate is one component under `downloadsDir`; tests pin `../../x`, an absolute path and `''`. No TOCTOU and no overwrite: `writeFile` with `wx` is O_CREAT|O_EXCL, so the collision check and create are one syscall, and O_EXCL fails EEXIST on an existing symlink (dangling or not), so the loop advances rather than writing through it; tested. Partial writes: any non-EEXIST failure unlinks the target the loop just created. That unlink runs only after `create` rejected with something other than EEXIST, which with O_EXCL means the file at `target` is ours or absent, so it never removes someone else's file.
- [File / storage] SHOULD FIX, in Phase B. The shared loop's correctness now depends on `create` being exclusive, which the type cannot express. State the precondition on `writeIntoDownloads` and keep it module-private, so its only two callers are the two drivers in `attachmentSave.ts`, each passing an exclusive create that a test proves never overwrites.
- [File / storage] Accepted by design: the note lands in plaintext in Downloads, user-owned and outside the app's data directory. That is the feature: the operator asked for a copy on the machine. Its mode is the process umask default, as for a saved attachment.
- [Electron attack surface] No findings. One new bridge method on a fixed invoke channel; `ipcRenderer` is never exposed. `setWindowOpenHandler`'s `file:` deny is untouched: the reveal runs in main on a path main built. A compromised renderer gains one capability it already had through the attachment save: creating a bounded, never-overwriting file in Downloads and revealing it.
- [Electron attack surface] OUT OF SCOPE. A compromised renderer can repeat the ask to fill Downloads with up to 32 Mi code units per file. The attachment save and the debug-bundle save carry the same unbounded user-triggered write into this folder, and the renderer-compromise threat already includes stronger capabilities. A per-session write budget is deferred until observed; no ticket filed.
- [Crypto] No findings. None used.
- [Network & I/O] No findings. No socket. The request is size-bounded at the guard.
- [Logs] No findings. Main records carry `markdown-save` with `started` / `saved` / `save-failed` only; the caught error is dropped unread because a node:fs error message carries the path; the exhaustion error builds no path string. The renderer notice is a client-owned constant; renderer diagnostics are the static codes `save` / `save-failed`.
- [Concurrency] No findings. Each ask is one awaited invoke. Concurrent saves of one name each get a distinct candidate through exclusive create. The hook's `alive` ref stops a late answer from setting state after unmount.
- [Threat model] No findings. Hostile daemon text is written as bytes and never interpreted by this app; the name is sanitised. What the operator later does with the file in Downloads is outside this app, as for any saved attachment.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
