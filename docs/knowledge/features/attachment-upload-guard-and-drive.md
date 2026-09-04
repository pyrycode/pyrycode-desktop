# Attachment upload — the guard and the drive (`src/main/attachmentUpload.ts`)

Child of [Attachment upload](attachment-upload.md) — split out 2026-09-04 because folding #1032's paste
entry into that document pushed it over the 50000-byte cap `npm run check:docs` enforces. This document
is `src/main/attachmentUpload.ts` in full: the Electron-free module that guards a chosen file (or, for a
paste, the bytes a clipboard reader returned) on size, reads it, declares it, and drives it through
[attachment transfer](attachment-transfer.md)'s `uploadAttachment`. The channel contract and the request-
shape guards that select which of the three entries below fires live in the parent, § Two files — read
that first for the union and the boundary guards this module is downstream of.

Electron-free — `node:fs/promises`, `node:path`, `node:crypto` only, the
[`saveDebugBundle`](save-debug-bundle.md) posture: the Electron-derived input (the picked path) is a
parameter, so the test module graph never touches `electron`.

```ts
export const ATTACHMENT_MAX_UPLOAD_CHUNKS = 512
export const ATTACHMENT_MAX_UPLOAD_BYTES = ATTACHMENT_MAX_UPLOAD_CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES
export const ATTACHMENT_PROGRESS_MIN_CHUNKS = 8   // #864 — see below

export function uploadAttachmentFile(path: string, deps: AttachmentUploadDeps): Promise<void>
export function uploadAttachmentBytes(file: AttachmentUploadFile, deps: AttachmentUploadDeps): Promise<void>
```

**The progress gate — `ATTACHMENT_PROGRESS_MIN_CHUNKS = 8` (#864).** Lands beside the size bound
because it reasons in the same vocabulary and owns the same kind of decision: whether a transfer is
worth telling the window about, in chunks rather than a clock. Eight chunks is 360000 raw bytes,
~480000 base64 characters on the wire — about half a second at the 1 MB/s effective uplink
`ATTACHMENT_MAX_UPLOAD_CHUNKS` already reasons in. Below it a progress line would flash and vanish
inside one blink, reading as a glitch rather than reassurance — worse than the silence it replaces.
It is evaluated **here**, in the background process, before any message crosses, which is what makes
a small upload cost no IPC at all rather than costing some and being filtered in the window.

`driveUpload` closes a `terminal` flag over `onProgress`, set to `true` immediately after
`deps.upload(...)` resolves and with no `await` before either terminal arm emits — a second guard in a
different module over different state from the transport's own `settled` check
([attachment transfer](attachment-transfer.md)), in this module's established classify-don't-forward
posture rather than as an invented defence: the same function already wraps `deps.upload` in a
backstop `try`/`catch` on the grounds that "a contract is not a guarantee" for an injected seam. A
report that arrived after the terminal is exactly the shape that would leave a stale percentage on
screen with no terminal left to replace it — see AC3 in `docs/specs/architecture/864-*.md`.

`AttachmentUploadDeps.upload` widens to accept an optional second `onProgress` parameter, passed
straight down into `connection.uploadAttachment` — see [attachment transfer](attachment-transfer.md)
for the seam it terminates in.

Both entries funnel through one `driveUpload`, so the size guard, the driver call and the exactly-one-
terminal discipline exist once. Neither ever rejects — #861's `uploadAttachment` already never rejects,
so the `fs` read this slice adds was the chain's last unhandled-main-process-rejection surface, and both
entries resolve `void` on every path, which is what licenses the composition root's bare `void` call.

**The size bound is expressed in chunks, because chunks are what cost time.** The receiver's stride is a
mandated 45000 raw bytes (`ATTACHMENT_CHUNK_DATA_BYTES`), so 512 chunks is ≈30.7 MB of base64 on the
wire (45000 raw bytes base64-encode to exactly 60000 characters) — at a 1 MB/s effective relay uplink a
≈30 s transfer, and a peak main-process footprint of the file plus its base64, ≈54 MB. Doubling the
figure doubles both. **It does not predict the daemon's answer**: the daemon's per-upload byte bound is
receiver-configured and unpublished (`pyrycode` `docs/protocol-mobile.md` § Attachments — a client
learns it by being rejected), so a file under this bound may still come back `attachment-too-large`,
which is the driver's `failed` to report, not this guard's `refused`. The only thing the bound buys is
not spending minutes streaming something with no chance of landing.

**Open-then-stat, never stat-then-open, and `isFile()` before the length.**
`readChosenFile` opens a `FileHandle`, stats *the handle*, refuses on size, then reads through the same
handle, closing it in a `finally`. Checking a path and then opening it leaves a swap-in-the-gap window
in which the bound is not the bound; the handle names one inode for the whole sequence — which is also
what makes the bound a real memory bound rather than a report after the fact, since an oversized file is
never read. The stat is gated on `stats.isFile()` **before** the length: `open()` follows symlinks, and a
character device or FIFO stats at size 0, so a size-only guard would wave `/dev/zero` through to a read
that never returns and never stops growing. Everything that is not a regular file — a directory, a FIFO,
a device — is `unreadable`, including the chosen-a-directory case that would otherwise be decided by
whichever errno the platform's read happens to raise. **This was a security-review finding, not a design
choice caught up front** — the first draft of the plan guarded on size alone; the `security-sensitive`
review pass's [File / storage] finding is what added the `isFile()` gate. See
[Attachment upload § Security](attachment-upload.md#security).

**Declaring `filename` and `mime_type`.** `basename(path)` trimmed to `ATTACHMENT_FILENAME_MAX_BYTES`
(255, from `src/shared/wire/types.ts`, documented not validated) on a UTF-8 **byte** boundary: the trim
walks code points with `for...of` (never splitting a surrogate pair) and accumulates whole ones until
the next would cross 255 bytes — `.slice(0, 255)` would count characters and mis-trim a macOS name of
255 non-ASCII characters, which is far over 255 bytes. `mime_type` comes from a small client-owned
`Map<string, string>` extension table (13 entries) with an `application/octet-stream` fallback; a `Map`
rather than an object literal so a lookup key can never reach `Object.prototype`. The daemon re-sanitises
both fields — this side owes correct declaration, not defence.

**The outcome route: `event.sender` closed into `emit`, never `live.sink`.** `live.sink`'s
`webContents.send` ignores the channel argument it is given and re-supplies `DAEMON_EVENT_CHANNEL`
(`liveWindow.ts`'s `sink` literal) — routing this channel through it type-checks (the sink's `send` is
bivariant on its payload) and then silently lands upload events on the daemon-event bridges instead. The
composition root instead captures the `WebContents` that sent the intent per-request, which sidesteps
[#519](https://github.com/pyrycode/pyrycode-desktop/issues/519)'s staleness problem entirely — there is
no process-lifetime reference to keep current. The send is guarded on `sender.isDestroyed()`
(`emitDaemonEvent`'s #518 discipline): a window closed mid-upload drops the outcome rather than throwing,
the same loss the daemon-event channel already takes in that gap.

**One dialog at a time.** `src/main/index.ts`'s composition root holds a `pickerOpen` flag, set before
`dialog.showOpenDialog` and cleared in a `finally` as soon as it settles —
[`debugBundleDownload`](debug-bundle-reassembly.md)'s single-in-flight posture, scoped to the *dialog*
rather than to the upload. A double-clicked button (or a renderer spamming the channel) cannot stack
pickers, while two concurrent transfers stay possible: the flag is already clear while the first file
uploads, so a second pick starts a second live transfer with its own `randomUUID`.

**Logging is content-free by the shape of `DiagnosticEvent`**, which has no field that can hold a
filename or a path: `event: 'attachment-pick'`, a client-owned `code`
(`'too-large' | 'unreadable' | 'started' | 'completed' | <AttachmentTransferFailure>`), and `bytes` (the
allowlisted content-free field #861 already logs) on the size-relevant records. The path, the basename,
the derived `mime_type` and the `uploadId` are never logged — the first two are the user's private data,
and `uploadId` is deliberately absent for the reason [attachment transfer](attachment-transfer.md)'s
header records: an id ever derived from the filename would leak the filename through a field that looks
safe. The caught `fs` error is **dropped unexamined** — Node's `ErrnoException` carries `.path`, so
classify-don't-forward (inherited #62) is load-bearing here, not stylistic.

## The paste entry — `uploadClipboardImage` (#1032)

```ts
export type ClipboardImageReader = () => Uint8Array | null
export const CLIPBOARD_IMAGE_MIME_TYPE = 'image/png'
export const CLIPBOARD_IMAGE_FILENAME_PREFIX = 'clipboard-image'
export async function uploadClipboardImage(
  readClipboardImage: ClipboardImageReader,
  deps: AttachmentUploadDeps
): Promise<void>
```

**The reader is a parameter, not a member of `AttachmentUploadDeps`** — `uploadAttachmentFile`'s path
parameter and `saveDebugBundle`'s `save` seam, in the same shape. `clipboard.readImage()` is Electron, so
the call stays at the composition root and this module's test graph never loads `electron`; it also keeps
the shared `deps` object free of a collaborator the other two entries can't use. A `null` or **zero-length**
read emits exactly one `{ type: 'refused', reason: 'no-image' }` under a freshly minted `randomUUID` (a
terminal that precedes any bytes has no upload to borrow an id from) and returns. **The zero-length check
is not redundant with the composition root's `isEmpty()`** — different fabric on purpose, the root asking
Electron whether the clipboard holds an image, this asking whether any bytes actually arrived — and it's
load-bearing, not defensive: routing an empty array on into `driveUpload` would *pass* the size guard and
attempt a real upload of an empty file. A throwing reader is caught and reported as the same refusal,
`readChosenFile`'s posture applied to an injected seam. Otherwise `driveUpload(randomUUID(), { bytes,
filename: <minted>, mimeType: CLIPBOARD_IMAGE_MIME_TYPE }, deps)` — the same guard, driver and terminal
discipline every entry shares.

**The minted filename** is `clipboard-image-<UTC stamp>.png`, from `toISOString()` with the separators
stripped. UTC and never a local getter: no time zone is pinned anywhere in this repo, so a local stamp
would name the same paste differently on two machines, and the sole other formatter in this codebase
(`channelListViewModel.ts`) already uses UTC getters for the same reason
([[no-tz-is-pinned-so-local-date-getters-need-local-constructed-test-inputs]]). Two pastes inside one
second mint the same display name — accepted, since the daemon keys on `attachment_id`, a fresh
`randomUUID` per call, so the collision is cosmetic. Logging is content-free the same way the picker's is:
the refusal logs `{ event: LOG_EVENT, code: 'no-image' }` with `bytes` *omitted* (optional on
`DiagnosticEvent`), so no length, dimension or flavour of what the clipboard held is ever written down.

**`uploadAttachmentBytes` was reserved for this entry and is not used by it — a shipped, unaddressed
SHOULD FIX.** #1032's verifier flagged that `uploadClipboardImage` calls `driveUpload` directly rather
than through `uploadAttachmentBytes`, leaving that function with no production caller while its own
docblock (and `AttachmentUploadFile`'s) still read "the seam #891 enters at" — true of the *design*
intent, false of what shipped. Non-blocking, and not fixed as of this writing: a future edit should either
route the paste entry through `uploadAttachmentBytes` or re-scope its docblock to "unused, reserved for a
future in-memory entry" rather than naming a ticket that took a different path.

## Related

- [Attachment upload](attachment-upload.md) — the parent document: the channel contract, the request-shape
  guards, the composition root, the bridge, the data flow, the error table, the security review and the
  testing strategy for all three entries this module serves.
- [Attachment transfer](attachment-transfer.md) — the driver `driveUpload` calls (#861).
