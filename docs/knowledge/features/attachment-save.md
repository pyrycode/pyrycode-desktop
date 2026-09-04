# Attachment save (copy to Downloads, no dialog)

Copies an attachment that is **already on this machine** out of the app's private attachment
directory and into the operating system's Downloads folder, with no save dialog, then reveals it
there with the file selected. Introduced in
[#814](https://github.com/pyrycode/pyrycode-desktop/issues/814), split from #686.

This is the last unwired consumer of [attachment retrieval](attachment-retrieval.md) (#996) to land:
[attachment path resolution](attachment-path-resolution.md) (#818) and
[attachment filename sanitiser](attachment-filename-sanitiser.md) (#819) both named this ticket as
their first real caller, and both gates are consumed here verbatim, with no second copy and no second
escape check. It does not fetch — #996 owns that, and a source file that is not there is a failure
(`source-unavailable`), never a trigger to go and get it. The file row this channel will be called from
has since shipped, drawn only — [Conversation shell — message bubble § The attachment file
row](conversation-shell-message-bubble.md#the-attachment-file-row-815) (#815) — but wiring its click to
this channel is still [#816](https://github.com/pyrycode/pyrycode-desktop/issues/816), not yet started.

## Where the saved name comes from

Main does not have it. The retrieval leg deliberately never keeps one — `attachmentReassembler` never
reads `filename` or `mime_type`, the stored file is flat and extension-less, and
`AttachmentRetrievalEvent` is content-free by construction, so there is no store, map or sidecar to
read a name back from. The renderer has it, from the settled attachment in the timeline. It therefore
crosses the bridge as **untrusted, model-chosen** text, and main re-runs `sanitizeAttachmentFilename`
on the value it actually builds the path from — the exact crossing that module's own header
anticipates. The name is **display-derived, not addressing**: the bytes are selected by the
attachment identifier alone, so a wrong or hostile name saves the right file under a poor name, never
a different file.

**For an attachment the window's own operator just uploaded, the supply is
[Attachment upload](attachment-upload.md#1038)'s `completed.filename` (#1038).** Before that slice,
`AttachmentUploadEvent`'s `completed` arm was content-free — `{ type: 'completed'; uploadId }` — so
this channel's `filename` had no source for an upload the window itself had just driven; the design
above predates its own supply by four tickets. #1038 closes that gap for the picker, drop and paste
entries alike, deriving the value from the same bounded const the wire itself was told.

## Two new modules, two composition-root edges

### 1. The IPC contract — `src/shared/ipc/attachmentSave.ts`

A sibling to `attachmentRetrieval.ts`, **not** a member on `src/shared/ipc/events.ts`'s `DaemonEvent`
union — that module's own recorded reason: four renderer bridges (`timelineBridge`, `questionBridge`,
`modalBridge`, `daemonEventBridge`) each end their switch in `assertNever`, so a member there is a
compile error in four unrelated files for four no-op arms.

```ts
export const ATTACHMENT_SAVE_CHANNEL = 'pyry:attachment-save' as const              // renderer → main
export const ATTACHMENT_SAVE_EVENT_CHANNEL = 'pyry:attachment-save-event' as const  // main → renderer
export const MAX_SAVE_IDENTIFIER_LENGTH = 256   // UTF-16 code units
export const MAX_SAVE_FILENAME_LENGTH = 4096    // UTF-16 code units

export interface AttachmentSaveRequest { attachmentId: string; filename: string }
export function isAttachmentSaveRequest(value: unknown): value is AttachmentSaveRequest

export type AttachmentSaveFailure = 'source-unavailable' | 'save-failed'
export type AttachmentSaveEvent =
  | { type: 'saved'; attachmentId: string }
  | { type: 'failed'; attachmentId: string; reason: AttachmentSaveFailure }
```

Two channels, not an invoke — the terminal arrives after a resolve, a sanitise, a bounded copy loop
and a reveal, matching the retrieval and upload pairs. No path and no directory crosses in either
direction; the ask carries an identifier and a display name, the event carries the identifier back
plus a client-owned literal.

`isAttachmentSaveRequest` is `isAttachmentRetrievalRequest`'s posture: **shape only, never
canonicity** — `resolveAttachmentPath` is the sole gate that decides whether an identifier may become
a path component, so a `../../etc/passwd` identifier still passes here and is refused there, keeping
that module's single-gate argument intact. Field reads are `in`-guarded on a narrowed `object`, so a
`__proto__`-keyed ask has no own property to find. There is no name *check* beyond non-empty and
bounded: `sanitizeAttachmentFilename` is total (every input has a safe answer), so refusing a name
here would offer nothing the rewrite doesn't already give.

**The two length bounds differ in kind.** `MAX_SAVE_IDENTIFIER_LENGTH` is boundary hygiene — this ask
never reaches the wire, so it's `MAX_RETRIEVAL_IDENTIFIER_LENGTH`'s argument minus the envelope
clause; the real ceiling is `resolveAttachmentPath`'s 64-character alphabet, two orders of magnitude
below it. `MAX_SAVE_FILENAME_LENGTH` is a **drop** bound, not the truncation
`attachment-filename-sanitiser.md`'s non-goals forbid: nothing here or downstream shortens the
component. It exists because `sanitizeAttachmentFilename` walks its input code point by code point, so
an unbounded string from a compromised renderer is a main-process stall — the hazard
`MAX_PASTE_LENGTH` closes one channel over. 4096 sits an order of magnitude above every filesystem's
255-byte `NAME_MAX`, so an over-long name still reaches the copy and surfaces as `ENAMETOOLONG` rather
than being silently dropped at the guard.

**Two failure reasons, split on what a consumer can do next** (the same test `storeAttachment`
applies): `'source-unavailable'` — a refused identifier, an absent source, an unreadable one — is the
one a consumer can act on by fetching the attachment (#996) and retrying. `'save-failed'` is
everything else, including `ENAMETOOLONG`: the ticket's technical notes are explicit that an over-long
name is the same errno shape as any other failed copy, so it gets no member of its own.

### 2. The copy driver — `src/main/attachmentSave.ts`

```ts
export const MAX_SAVE_ATTEMPTS = 10_000

export interface AttachmentSaveDeps {
  attachmentDir: string                  // trusted, composition-root
  downloadsDir: string                   // trusted, composition-root
  reveal: (path: string) => void         // shell.showItemInFolder
  diagnosticLog?: DiagnosticLog
}
export function createAttachmentSave(
  deps: AttachmentSaveDeps
): (request: AttachmentSaveRequest) => Promise<AttachmentSaveEvent>
```

`electron` is never imported — both Electron touches are injected, `saveDebugBundle`'s and
`attachmentStore`'s composition-root seam, which is what keeps this module unit-testable against a
temp directory. Enforced deterministically rather than by discipline: a module-graph test asserts the
source imports no `electron` and contains no `console.` call.

**The terminal is a resolved value, not a pushed event** — the one departure from
`createAttachmentRetrieval`. That driver takes an `emit` because it holds cross-ask state (a
concurrency cap, coalescing) that outlives one ask; this flow holds none, so "exactly one terminal per
ask" is bought by a promise settling once rather than by an invariant to maintain. **There is
deliberately no concurrency cap.** Retrieval caps because an unbounded fan-out voids a per-transfer
memory bound; a copy streams kernel-side and accumulates nothing in this process, so a cap would bound
instantaneous parallelism and not total volume — the same caller just paces its asks. A real answer is
a per-session write budget across every disk-writing channel, which no acceptance criterion describes
and which `saveDebugBundle` (an unbounded-repeat write into this same folder) doesn't have either.

Flow, in order:

1. `resolveAttachmentPath(attachmentDir, attachmentId)` — a refusal answers
   `failed / 'source-unavailable'` **before any filesystem call**.
2. `sanitizeAttachmentFilename(request.filename)`, main-side. `copyIntoDownloads` takes the already
   -sanitised **component**, never the request, so building a path from the raw field would take
   editing two functions rather than one line (the architecture review's Phase-B item, shipped).
3. The copy loop.
4. `reveal(savedPath)` on success only.

**The copy loop** is `saveDebugBundle`'s (`src/main/saveDebugBundle.ts`), with
`copyFile(source, candidate, COPYFILE_EXCL)` in place of `writeFile(..., { flag: 'wx' })`.
`COPYFILE_EXCL` is `O_CREAT|O_EXCL`, so the collision check and the create are one syscall — no
`existsSync`-then-write TOCTOU gap, and **the guarantee this buys is stronger than a debug-bundle
write**: a pre-planted symlink already sitting in Downloads under the target name cannot be written
through, because `O_EXCL` fails `EEXIST` on an existing path even when the symlink dangles. On
`EEXIST` the loop advances to the next candidate **without unlinking** (that file is not ours); on any
other errno it best-effort-unlinks the partial destination and stops. `MAX_SAVE_ATTEMPTS` is loop
-termination insurance, not a defence against an observed attack.

Candidate naming is browser-style, `saveDebugBundle`'s `candidateName` restated: `n === 0` is the
component verbatim, `n >= 1` inserts a browser-style ` (n)` **before the extension**, split at the
**last** dot when its index is greater than 0 — `archive.tar.gz` → `archive.tar (1).gz` (Chrome's
answer), a component with no dot gets the suffix appended whole. Index 0 is unreachable
(`sanitizeAttachmentFilename` guarantees the component never begins with `.`), and the `> 0` test is
what makes losing that guarantee harmless — a suffix appended whole — rather than a hidden-file bug.

**Error → reason mapping, with one conflation stated rather than hidden:** `ENOENT` answers
`'source-unavailable'`, everything else `'save-failed'`. `copyFile` reports `ENOENT` for an absent
*destination* directory exactly as for an absent source, so a missing Downloads folder is reported as
if the attachment were never fetched. Accepted rather than repaired: distinguishing the two needs a
check-then-act on a path, the mis-report costs one wasted retry, and `app.getPath('downloads')` naming
a directory that doesn't exist is a pathological environment. Pinned by a test so the behaviour is
recorded rather than rediscovered.

**Never rejects, never throws a message carrying a path.** Every path resolves to one terminal, which
licenses the composition root's bare `void`. The exhaustion branch deliberately does **not** copy
`saveDebugBundle`'s `Error` message, which interpolates its `dir` — the architecture review's
adversarial pass caught that this precedent, copied verbatim, would have built a string carrying a
path one `console.error` away from the leak AC 5 forbids; this module constructs no such string at
all.

**The reveal cannot fail the save.** `reveal(saved)` runs inside a `try`/`catch` whose `catch` still
answers `saved` — the bytes are already on disk, and reporting a save failure that didn't happen would
be a lie the window acts on.

**Logging** is `attachmentRetrieval`'s shape: one static event name (`attachment-save`) and a static
`code` per outcome (`started`, `saved`, `source-unavailable`, `save-failed`). Neither the file name nor
any path nor an errno reaches a record — the caught error object is dropped past its `code`, never
inspected further, because a `node:fs` `ErrnoException` carries the offending path in its own message.

### 3. The composition-root edges

`src/main/index.ts` reuses the `downloadsDir` already read for the debug bundle and the
`attachmentDir` already joined for the retrieval store — **no new `app.getPath` call is added**.
`shell.showItemInFolder` is the reveal (not `shell.openPath`, which opens the folder without
selecting the file and does not satisfy AC 4), closed in alongside the two directories so
`attachmentSave.ts` stays Electron-free. The listener (`attachmentRetrievalListener`'s shape) guards
the untrusted ask with `isAttachmentSaveRequest` and **drops** a malformed one — no filesystem call,
no folder opened, no event — closes `event.sender` into the reply, guards `isDestroyed()` for a window
closed mid-save, registers with `ipcMain.on`, and removes on `will-quit`.

**`setWindowOpenHandler`'s `file:` deny is untouched**, and is why this feature needed its own channel
at all: the reveal is a main-process `shell.showItemInFolder` call on a path main computed, never a
URL the window supplied.

`src/preload/index.ts` gains `saveAttachment(request)` (fire-and-forget on the fixed channel) and
`onAttachmentSaveEvent(listener)` (subscription returning an unsubscribe handle, raw
`IpcRendererEvent` stripped) — `requestAttachment`/`onAttachmentRetrievalEvent`'s shape verbatim. No
caller is wired yet; the click that calls this is #816.

## State and concurrency

None to hold. Each ask is an independent bounded copy with no cross-ask state, no wire traffic and no
timer — unlike `createAttachmentRetrieval` there is no in-flight map, no concurrency cap, no
coalescing. Concurrent saves of one attachment under one name are correct without coordination: each
`copyFile` is exclusive-create, so the loser sees `EEXIST` and advances — two clicks produce
`report.pdf` and `report (1).pdf`, never a torn file. A window that closes mid-save drops the terminal
at the `isDestroyed()` guard, the same loss the retrieval and upload edges already take.

## Error handling

| Failure | Detected by | Terminal |
|---|---|---|
| Malformed or over-length ask | `isAttachmentSaveRequest` at the boundary | dropped — no event, no fs call |
| Non-canonical identifier | `resolveAttachmentPath`, before any fs call | `source-unavailable` |
| Source file absent or unreadable | `copyFile` → `ENOENT` | `source-unavailable` |
| Downloads folder absent | `copyFile` → `ENOENT` (stated conflation) | `source-unavailable` |
| Over-long name | `copyFile` → `ENAMETOOLONG` | `save-failed` |
| Any other copy errno | `copyFile`, after a best-effort unlink | `save-failed` |
| Candidates exhausted (10,000) | the loop bound | `save-failed` |
| Reveal throws | the injected `reveal` | `saved` — the bytes are already on disk |

## Security

Architect self-review verdict **PASS**, no MUST FIX. Full review in
`docs/specs/architecture/814-save-attachment-to-downloads.md`. Points not covered above:

- **The file's bytes never enter this process's memory.** `copyFile` is a kernel-side copy, unlike
  `storeAttachment`, which had to hold the whole buffer.
- **`COPYFILE_EXCL` gives the destination the source's mode.** `storeAttachment` writes `0o600`, so
  the Downloads copy is owner-only rather than umask-derived — the fail-safe direction, pinned by a
  `mode & 0o077 === 0` test.
- **A symlink at the source, not the destination, is followed.** An attacker who could already write
  inside `join(userData, 'attachments')` could redirect one save to an arbitrary readable file.
  Deferred on [attachment path resolution](attachment-path-resolution.md)'s recorded reasoning: that
  write access already suffices to replace the secret-store ciphertexts, so this is strictly weaker
  than what such an attacker already holds.
- **The failure union is a one-bit existence oracle** ("is attachment X cached on this machine"),
  bounded to uninteresting by `resolveAttachmentPath`'s alphabet: the renderer can probe only
  `[0-9a-f-]{1,64}` identifiers inside one app-private directory, all of them this same user's own
  attachments, which it already knows it fetched.
- **No digest re-verification at save time**, deliberately: #995 verified the digest before the bytes
  were stored, and re-checking here would require the expected digest to cross the bridge — an
  untrusted value deciding whether a file is presented as good.
- **Extension spoofing / macOS quarantine is out of scope for this save leg.** `copyFile` does not set
  `com.apple.quarantine`, and the daemon chooses the extension. It doesn't bite here because AC 4
  *reveals* the file and never opens it — the user performs the same double-click they would for any
  received file. [Attachment open](attachment-open.md) (#867, landed) is the ticket that hands a path
  to `shell.openPath`, and closes the question by deriving its own suffix from validated bytes rather
  than from this feature's extension-chosen-by-the-daemon name.

## Testing

Unit tier only — a main-process filesystem module plus a boundary guard, both directly unit-testable
against a temp directory the way `saveDebugBundle.test.ts` and `attachmentStore.test.ts` are. This
slice has no renderer surface, so no Playwright coverage is owed.

- `src/shared/ipc/attachmentSave.test.ts` — the guard's accept/refuse table, a `__proto__` ask built
  with `JSON.parse` (a `__proto__` *literal* creates no own property and would be an inert fixture),
  and the two channel constants distinct from each other and from the retrieval pair.
- `src/main/attachmentSave.test.ts` — against two `mkdtemp` directories (one standing in for the
  attachment store, one for Downloads): a successful copy-and-reveal under the sanitised name; a
  hostile display name (`../../etc/passwd`) landing as one component inside Downloads with the parent
  directory untouched; three saves of one name yielding `report.pdf`, `report (1).pdf`,
  `report (2).pdf`; a pre-existing file under the target name never overwritten;
  `archive.tar.gz` colliding to `archive.tar (1).gz`; a non-canonical identifier answering
  `source-unavailable` with Downloads left **empty**; an absent source and an absent Downloads
  directory each answering `source-unavailable`; a 300-character name answering `save-failed`;
  `reveal` never called on a failure path; every path resolving rather than rejecting; diagnostic
  records carrying only static codes; the module-graph assertion (no `electron` import, no `console.`
  call).

## Edge cases and limitations

- **No concurrency cap or write budget**, by design (see § 2 above) — revisit only if a per-session
  disk-write budget is ever specified for the app as a whole.
- **The Downloads-folder-absent / source-absent conflation** (§ error mapping) is accepted, not fixed.
- **No digest re-verification** at save time (§ Security).
- **Extension spoofing / Gatekeeper quarantine** for the *open* path is closed by
  [attachment open](attachment-open.md) (#867, landed), not this ticket's; this ticket's own leg only
  reveals, never opens.

## Related

- [Attachment path resolution](attachment-path-resolution.md) — `resolveAttachmentPath` (#818), the
  identifier gate consumed verbatim, no second escape check.
- [Attachment filename sanitiser](attachment-filename-sanitiser.md) — `sanitizeAttachmentFilename`
  (#819), re-run main-side on the value the path is built from.
- [Save debug bundle](save-debug-bundle.md) — the exclusive-create no-overwrite precedent
  (`candidateName`, `isErrnoException`) this module restates with `COPYFILE_EXCL`.
- [Attachment retrieval](attachment-retrieval.md) — the driver that puts bytes in the attachment
  directory this feature reads from (#996); the channel-pair and composition-root shape this feature
  copies.
- [Attachment reassembly and store](attachment-reassembly-and-store.md) — `storeAttachment` (#995),
  the sibling write that established the flat, extension-less on-disk shape this module reads.
- `docs/specs/architecture/814-save-attachment-to-downloads.md` — the full architecture spec,
  including the security review.
- [Conversation shell — message bubble § The attachment file
  row](conversation-shell-message-bubble.md#the-attachment-file-row-815) — #815, shipped (drawn, not
  wired). [#816](https://github.com/pyrycode/pyrycode-desktop/issues/816) gives it the click that calls
  this channel; still not started.
- [Attachment open](attachment-open.md) — #867, landed: open in the OS image viewer, the feature that
  closes the extension-spoofing / quarantine question this one declines.
