# Attachment open (hand a file to the OS's default image viewer)

Opens an attachment that is **already on this machine** in the operating system's default handler for
its type, so zoom and pan come from the OS viewer rather than from a viewer this app would otherwise
have to build (operator, 2026-08-22). Introduced in
[#867](https://github.com/pyrycode/pyrycode-desktop/issues/867), split from #691. The background-process
half only — no visible app UI ships in this slice. The thumbnail that becomes the control calling this
channel is [#869](https://github.com/pyrycode/pyrycode-desktop/issues/869); the thumbnail itself is
[#868](https://github.com/pyrycode/pyrycode-desktop/issues/868).

The fifth attachment channel pair, and the fourth reader of the one `attachmentDir`
[attachment path resolution](attachment-path-resolution.md) (#818) gates. It closes the on-disk-shape
open question that doc left for this ticket, and it is the last of the three consumers
[attachment reassembly and store](attachment-reassembly-and-store.md) (#995) was waiting on — the other
two, [attachment save](attachment-save.md) (#814) and [attachment bytes](attachment-bytes.md) (#866),
had already landed.

## Why this needed its own channel, not a relaxed `setWindowOpenHandler`

`setWindowOpenHandler` in `src/main/index.ts` drops every `file:` URL and every custom-protocol URL so
a hostile link cannot open a local file. That deny is untouched. The window sends only an attachment
identifier, on `ATTACHMENT_OPEN_CHANNEL`; the background process resolves it through
`resolveAttachmentPath` — the same gate [attachment save](attachment-save.md) and
[attachment bytes](attachment-bytes.md) consume verbatim, with no second escape check written anywhere
in this slice — and only the background process ever holds a path.

## The extension question — this ticket's crux, and now closed

The file [`storeAttachment`](attachment-reassembly-and-store.md) writes is deliberately extension-less:
an extension would be model-chosen (the assistant names the file it produced), and a model-chosen
extension is exactly what makes handing a path to the OS dangerous — a `.command`, `.desktop`, `.app` or
`.scpt` opens by *executing*. So the type the OS is told about is decided by the file's own leading
bytes, in `src/main/imageSignature.ts`, and never by the wire's declared `mime_type` (a claim, not a
verified property) and never by a file name.

```ts
export const SIGNATURE_PREFIX_BYTES = 12
export type ImageSuffix = '.png' | '.jpg' | '.gif' | '.webp'
export function matchImageSignature(prefix: Uint8Array): ImageSuffix | null
```

**The set is closed and written down in this app; the bytes only choose a member.** That is the whole
security property, and it is a consequence of the return type rather than of care taken in the
matching logic: even a matcher that got its answer completely wrong could only mis-pick between the
four raster suffixes, because no other string is spellable as an `ImageSuffix`. `matchImageSignature`
is pure, synchronous, total and import-free — no filesystem call, no state, pinned by a module-graph
test.

| Member | Leading bytes | Suffix |
|---|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` | `.png` |
| JPEG | `FF D8 FF` (SOI + first marker byte, common to JFIF/Exif/raw) | `.jpg` |
| GIF | `GIF87a` / `GIF89a` — two spellings of one type, one suffix | `.gif` |
| WebP | `RIFF` at offset 0 **and** `WEBP` at offset 8 (both runs load-bearing — `RIFF` alone is shared with `.wav`/`.avi`) | `.webp` |

`SIGNATURE_PREFIX_BYTES = 12` is exactly the widest member (WebP's `WEBP` tag ends at byte 11), which
is why the driver reads a prefix rather than a file — a dozen bytes decide every member, and reading a
whole ~23 MB attachment to look at twelve would be a regression against both landed siblings' care. A
short or empty prefix matches nothing; this is signature matching, not image validation, so a file
whose header matches but whose remainder is garbage is a corrupt image, the OS viewer's problem and not
a security one.

**SVG is deliberately absent**, even though it appears in the upload-side MIME map. It has no byte
signature (it is XML, recognisable only by heuristics), and the OS default handler for it is routinely
a browser, which executes script inside it. A raster-only set is what makes "open in the default
handler" a safe sentence — widening this set is a security decision, not a feature request.

## The driver — `src/main/attachmentOpen.ts`

```ts
export const ATTACHMENT_OPEN_DIR_NAME = 'attachment-views'

export interface AttachmentOpenDeps {
  attachmentDir: string                          // trusted, composition-root
  openDir: string                                // trusted, composition-root
  open: (path: string) => Promise<boolean>       // true iff the OS accepted the hand-off
  diagnosticLog?: DiagnosticLog
}
export function createAttachmentOpen(
  deps: AttachmentOpenDeps
): (request: AttachmentOpenRequest) => Promise<AttachmentOpenEvent>
```

Flow, ordering load-bearing:

1. `resolveAttachmentPath(attachmentDir, attachmentId)` — a refusal answers `failed / 'refused'`
   **before any filesystem call**.
2. Read the first 12 bytes of the source file (open → read → close, handle closed in a `finally`). Any
   error is dropped without being inspected (a `node:fs` `ErrnoException` carries the offending path in
   its own message) and answers `failed / 'unavailable'`. **This is also why no concurrency cap is
   owed**: only the prefix ever enters this process, so `attachmentSave`'s "no cap, and that is a
   decision rather than an omission" is the reasoning that transfers here, not `attachmentBytes`'s
   (which caps because whole files enter that process).
3. `matchImageSignature(prefix)` — `null` answers `failed / 'unsupported-type'`, before any derived
   file exists and before the OS is told anything.
4. `mkdir(openDir, { recursive: true, mode: 0o700 })`, then `copyFile(source, derivedPath, COPYFILE_EXCL
   | COPYFILE_FICLONE)`. `EEXIST` means a previous open already derived this file, and it is **reused**
   — a repeat open creates no second derived file. Any other errno answers `failed / 'open-failed'`
   after a best-effort unlink of the partial destination.
5. `await open(derived)` — `false` or a thrown seam answers `failed / 'open-failed'`; `true` answers
   `opened`.

Nothing throws out of the driver; every row resolves to a terminal, which is what licenses the
composition root's bare `void`. The closure holds no state at all — not even `attachmentBytes`'s
in-flight counter — since no cap is owed; it exists only to bind the trusted directories and the `open`
seam once.

### The one design decision this ticket owned: a copy into a dedicated derived directory, not a hard link or a suffixed sibling

**A dedicated app-owned directory (`attachment-views`, sibling to `attachmentDir`), not a suffixed name
inside the attachment directory itself.** `attachmentDir`'s invariant is that every file in it is named
by the canonical `[0-9a-f-]{1,64}` alphabet and written by exactly one writer, `storeAttachment`; three
landed consumers (#995, #866, #814) address it by `resolveAttachmentPath`'s exact path. Mixing derived
artefacts in would break both properties, and a future retention pass over that directory — which has
no ticket yet — would have to learn the difference. The derived directory is independently disposable:
deleting all of it costs nothing but a re-derive.

**A copy, not a hard link**, despite the link costing no bytes. Either reason below is sufficient:

- A hard link is the same inode under a second name, handed to an arbitrary application chosen by the
  user's file-type association. A viewer that saves in place would write straight through into the
  stored attachment, which three landed consumers depend on being unmodified. A copy isolates that by
  construction.
- `storeAttachment` writes via a temp file plus `rename`, so a re-store changes the inode. A link made
  before that would point at the old inode forever, with nothing to notice.

The bytes are not really the trade they look like: `copyFile` is kernel-side, so nothing accumulates
in this process, and `COPYFILE_FICLONE` asks for a copy-on-write clone first (APFS, this app's primary
platform; btrfs, XFS elsewhere), falling back to a full copy where unsupported.

`COPYFILE_EXCL` is `attachmentSave`'s exact argument: `O_CREAT|O_EXCL` makes the collision check and
the create one syscall with no `existsSync`-then-write TOCTOU gap, and it cannot be written through a
symlink already sitting at the derived path. The derived name is deterministic
(`<attachmentId><suffix>`), so the derived directory can never hold more than one file per stored
attachment — a quantity `createAttachmentReassembler` already bounds, which is why no separate disk
budget is owed.

`derivedPath` takes an already gate-passed identifier as a documented precondition and appends a
literal drawn from `ImageSuffix` — not a second escape check, and must not grow into one. A gate-passed
identifier is one path component from a 64-character alphabet with no `.`, no separator and no `:`, so
appending a suffix leaves it one component; containment follows from the gate that already ran. The
converse is what makes the derived file unreachable from the window: a name carrying a `.` is
unspellable in `resolveAttachmentPath`'s canonical alphabet, so no identifier the renderer can send
resolves to one of these files.

## `shell.openPath` never gets to say anything

`shell.openPath` does not throw — it resolves with the operating system's error message, empty on
success, and **that message carries the path**. The seam injected at the composition root is narrowed
to `Promise<boolean>`, not Electron's own `Promise<string>`:

```ts
open: async (path) => (await shell.openPath(path)).length === 0
```

Narrowing it to a bit at the composition root means the module that builds reasons and writes log
records never holds the string at all — a property of the seam rather than a rule someone has to
remember not to break. This is the repo's first live `shell.openPath` call;
[attachment save](attachment-save.md)'s `shell.showItemInFolder` is a different API for a different
job (reveal-in-folder, not open).

## The IPC contract — `src/shared/ipc/attachmentOpen.ts`

```ts
export const ATTACHMENT_OPEN_CHANNEL = 'pyry:attachment-open' as const              // renderer → main
export const ATTACHMENT_OPEN_EVENT_CHANNEL = 'pyry:attachment-open-event' as const  // main → renderer
export const MAX_OPEN_IDENTIFIER_LENGTH = 256   // UTF-16 code units

export interface AttachmentOpenRequest { attachmentId: string }
export function isAttachmentOpenRequest(value: unknown): value is AttachmentOpenRequest

export type AttachmentOpenFailure = 'refused' | 'unavailable' | 'unsupported-type' | 'open-failed'
export type AttachmentOpenEvent =
  | { type: 'opened'; attachmentId: string }
  | { type: 'failed'; attachmentId: string; reason: AttachmentOpenFailure }
```

`isAttachmentOpenRequest` is `isAttachmentBytesRequest`'s body verbatim under a new name: shape and
size only, never canonicity, so a `../..` identifier passes here and is refused at
`resolveAttachmentPath`. A malformed ask is **dropped** — no filesystem call, no event — because there
is no identifier to address a reply to.

**Four failure literals, split on what a consumer can do next** — `storeAttachment`'s test, applied
where this ticket draws the line:

- `'refused'` — the identifier never named a file here. Permanent; a consumer must not retry.
- `'unavailable'` — the identifier resolved but nothing readable is at that path. The one a consumer
  fetches for: get the attachment ([#996](attachment-retrieval.md)) and ask again.
  `AttachmentBytesFailure`'s member of the same name and meaning.
- `'unsupported-type'` — the leading bytes matched no member of the closed raster set. Permanent and
  distinct from `'refused'`: the identifier was fine and the file is there, so fetching again changes
  nothing — a consumer's move is to offer the save leg ([attachment save](attachment-save.md), #814)
  instead of the open leg. This is also the answer for a file the wire declared as an image: a declared
  type takes no part in the decision.
- `'open-failed'` — the derived copy or the hand-off to the OS failed. The only member a plain retry
  can resolve, which is why it is not merged into `'unavailable'`.

`attachmentId` is echoed on every arm as the correlation key — the window's own value coming back,
never a wire-supplied or process-derived one. AC 5's leak ban is on *identifier-derived* strings (the
suffixed file name), not on this key.

## Composition-root wiring — `src/main/index.ts` / `src/preload/index.ts`

The fourth reader of `attachmentDir` and the only new directory join since #996: `openDir =
join(app.getPath('userData'), ATTACHMENT_OPEN_DIR_NAME)`. `attachmentBytesListener`'s posture verbatim:
`isAttachmentOpenRequest` guards and drops a malformed ask, `event.sender` closes into the reply, an
`isDestroyed()` guard covers a window closed mid-open, registration is `ipcMain.on` with removal on
`will-quit`, and the bare `void` is licensed by the driver's never-rejects property.

`src/preload/index.ts` gains `openAttachment(request)` (fire-and-forget) and
`onAttachmentOpenEvent(listener)` (subscription returning an unsubscribe handle, raw
`IpcRendererEvent` stripped) — `requestAttachmentBytes`/`onAttachmentBytesEvent`'s shape verbatim. **No
caller is wired** — the thumbnail click that calls this channel is
[#869](https://github.com/pyrycode/pyrycode-desktop/issues/869), not started as of this writing.

## State and concurrency

None held. Not even `attachmentBytes`'s in-flight counter — no cap is owed, since only a 12-byte
prefix ever enters this process and the copy is kernel-side. Exactly one terminal per ask is structural
(a promise settles once), not an invariant to maintain. The file handle from the prefix read is closed
in a `finally` on every path. Concurrent opens of one attachment need no coordination: `COPYFILE_EXCL`
makes the loser reuse the winner's derived file rather than tear it.

## Error handling

| Failure | Detected by | Terminal |
|---|---|---|
| Malformed, empty or over-length ask | `isAttachmentOpenRequest` at the boundary | dropped — no event, no fs call |
| Non-canonical identifier (`..`, absolute, separator) | `resolveAttachmentPath`, before any fs call | `refused` |
| Source absent, unreadable, or a directory | the prefix read, error dropped uninspected | `unavailable` |
| Leading bytes match no member (incl. empty, short, SVG, PDF, Mach-O) | `matchImageSignature` → `null` | `unsupported-type` |
| Derived copy fails (permissions, space, `mkdir`) | `copyFile`/`mkdir` errno, partial best-effort unlinked | `open-failed` |
| Derived file already present | `copyFile` → `EEXIST` | reused; continues to the hand-off |
| OS refuses the hand-off (no handler, revoked file) | the seam answering `false` | `open-failed` |
| The seam itself throws | the `try` around it | `open-failed` |

## Security

Architect self-review verdict **PASS**, no MUST FIX. Full review in
`docs/specs/architecture/867-open-attachment-in-os-image-viewer.md`. Points not covered above:

- **The new trust boundary is the file's own bytes deciding a name.** A disk→trusted-decision
  crossing, explicit and single: `matchImageSignature`, bounded by construction (a closed four-member
  return type) rather than by care.
- **No custom protocol or privileged scheme is registered.** The new capability granted to a
  compromised renderer is "cause the OS to open one of this same user's own attachments, that this app
  already fetched, in an image viewer" — it cannot name a file outside `attachmentDir`, because no
  identifier that names one is spellable.
- **TOCTOU: no check-then-open exists anywhere.** No `existsSync`; the prefix read discovers absence by
  its own errno, and the derived file's collision check and create are one `O_CREAT|O_EXCL` syscall.
- **A symlink planted inside the attachment directory is followed** — out of scope, repeating #814's
  and #866's recorded disposition deliberately: an attacker who can already write there could redirect
  the prefix read and the copy at any file this user can read, and get it opened in a viewer. That
  write access already suffices to replace the secret-store ciphertexts. `O_NOFOLLOW` is not added,
  for #866's reason: it would make readers of one directory behave differently.
- **Hostile daemon content reaching an OS decoder is out of scope, and is the sharpest new exposure.**
  The bytes are daemon-supplied and this slice hands them to a system image decoder the app does not
  control — a malformed PNG exploiting a decoder bug is reachable. The signature gate is what
  guarantees the handler is an *image* handler rather than an executor, which is the difference between
  a memory-safety bug and arbitrary execution by design. [#868](https://github.com/pyrycode/pyrycode-desktop/issues/868)
  already routes these same bytes into Chromium's decoder via an `<img>`, so this adds a second decoder
  rather than a first. Un-closable by this app short of not shipping the feature.
- **A hostile file-type association is named and accepted.** `openPath` consults the machine's
  association; an attacker able to rewrite it already runs code as the user, so no privilege is gained.
- **No digest re-verification at open time**, deliberately: #995 verified the digest before storing,
  and re-checking here would need the expected digest to cross from an untrusted window.
- **Atomic writes are not owed for the derived file** — it is a reproducible cache, not state. A
  partial file left by a hard kill mid-copy is reused (and shows as a truncated image) on the next
  open; repaired by deleting the derived directory. Closing this properly would need a temp-plus-rename
  that gives up the free reuse `COPYFILE_EXCL` buys, so it is a named limitation rather than a defect.

## Testing

Unit tier only, plain vitest against a temp directory with the `open` seam injected —
`attachmentBytes.test.ts`'s and `attachmentSave.test.ts`'s harness. Nothing here belongs in Playwright,
which cannot observe an OS viewer appearing.

- `src/shared/ipc/attachmentOpen.test.ts` — the guard's accept/refuse table, the length bound, a
  `../../etc/passwd` identifier accepted here on shape (canonicity is the gate's), a `__proto__`-keyed
  ask built with `JSON.parse` refused, and the two channel constants distinct from every sibling pair.
- `src/main/imageSignature.test.ts` — one accept per member including both GIF versions, a `RIFF`
  container whose tag at byte 8 is not `WEBP` rejected, each member truncated one byte short rejected,
  empty input rejected, an SVG document/PDF/Mach-O header/shell script each rejected, and the property
  that every non-`null` answer is a member of the written-down set.
- `src/main/attachmentOpen.test.ts` — the happy path per member (seam called with the right suffix,
  derived bytes equal the source's, source untouched at its original path); a second open of the same
  attachment producing exactly one derived file and calling the seam again; `..`-traversal and
  absolute-path identifiers both `refused` **with the attachment directory absent**, proving no
  filesystem call decided it; an absent file and a directory at the resolved path both `unavailable`; a
  non-matching file answering `unsupported-type` with **no file created and the seam never called**; a
  seam answering `false` and a seam that throws both answering `open-failed`; every path resolving
  rather than rejecting; diagnostic records carrying static codes only; the event's keys exactly
  `type`/`attachmentId`/`reason`; a module-graph assertion pinning the exact import set (no `electron`)
  and no `console.` call.

## Edge cases and limitations

- **Nothing evicts the derived directory.** Bounded at one file per stored attachment, so this feature
  at worst doubles a quantity that already has no retention policy; deliberately not swept here, since
  attachment retention has no ticket in any repo and a sweep invented by one consumer would be a second
  retention policy for one directory pair.
- **`.jpg`, not `.jpeg`, for JPEG.** Both are universally associated on all three platforms; `.jpg` was
  chosen for being the more common association target. No behavioural difference is known.
- **Extension spoofing / Gatekeeper quarantine**, [attachment save](attachment-save.md)'s deferred
  question, is closed by this ticket for the open path specifically: the suffix comes from validated
  bytes, never from a claimed type. `copyFile` still does not set `com.apple.quarantine` on the derived
  file, which is accepted rather than fixed — see § Security above.
- **A symlink inside the attachment directory is followed** (§ Security) — out of scope, same
  disposition as #814 and #866.

## Related

- [Attachment path resolution](attachment-path-resolution.md) — `resolveAttachmentPath` (#818), the
  identifier gate consumed verbatim, no second escape check.
- [Attachment bytes](attachment-bytes.md) — #866, the closest landed sibling: injected-directory seam,
  never-rejects driver, one-terminal-per-ask, gate-before-any-filesystem-call ordering.
- [Attachment save](attachment-save.md) — #814, the source of the `COPYFILE_EXCL` no-overwrite pattern,
  the injected-Electron seam shape, and the extension-spoofing question this ticket closes.
- [Attachment reassembly and store](attachment-reassembly-and-store.md) — `storeAttachment` (#995), the
  sole writer into `attachmentDir`; its temp-file-plus-`rename` recipe is why a hard link would go
  stale, and its `mkdir(recursive, 0o700)` is the directory-creation pattern the derived directory
  copies.
- [Attachment retrieval](attachment-retrieval.md) — #996, the driver that fetches an attachment onto
  this machine before it can be opened.
- `docs/specs/architecture/867-open-attachment-in-os-image-viewer.md` — the full architecture spec,
  including the security review and the open questions this doc resolves.
- [#868](https://github.com/pyrycode/pyrycode-desktop/issues/868) /
  [#869](https://github.com/pyrycode/pyrycode-desktop/issues/869) — the thumbnail and the click that
  calls this channel, not started as of this writing.
