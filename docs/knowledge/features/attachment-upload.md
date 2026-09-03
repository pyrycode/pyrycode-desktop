# Attachment upload (pick, guard, drive, report)

The attach affordance's whole flow minus the button: an intent from the window opens the system file
picker in the background process, the choice is guarded on an **open handle** and read, declared with
a byte-trimmed filename and a derived `mime_type`, and driven through
[attachment transfer](attachment-transfer.md)'s (#861) `uploadAttachment` under a `randomUUID` transfer
id. Exactly one terminal — `completed`, `refused` with the client's own size bound, or `failed` with
the driver's outcome — is pushed back to the window on a dedicated channel pair. A cancelled picker is
a total no-op: nothing read, nothing sent, nothing emitted. **Nothing renders here** — this slice ends
at the bridge; the button and the outcome's appearance are [#863](https://github.com/pyrycode/pyrycode-desktop/issues/863).

Introduced in [#862](https://github.com/pyrycode/pyrycode-desktop/issues/862), split from #685.

## Two files

### 1. `src/shared/ipc/attachmentUpload.ts` — the channel contract

Channel constants plus a sealed union, no runtime logic — [`pairingStatus.ts`](pairing-status-signal.md)'s
shape:

```ts
export const ATTACHMENT_UPLOAD_CHANNEL = 'pyry:attachment-upload'              // renderer → main, send/on
export const ATTACHMENT_UPLOAD_EVENT_CHANNEL = 'pyry:attachment-upload-event'  // main → renderer, push

export type AttachmentUploadFailure =
  | 'unreadable'                    // added by this slice
  | 'not-connected' | 'connection-lost' | 'send-failed'                 // AttachmentTransferFailure's own three
  | 'attachment-invalid-chunk' | 'attachment-integrity-failed' | 'attachment-too-large'
  | 'attachment-too-many-uploads' | 'attachment-storage-failed' | 'message-too-long'  // DaemonErrorOutcome, upload leg
  | 'attachment-not-found' | 'attachment-stream-aborted'                // DaemonErrorOutcome, retrieval leg (#999) —
                                                                          // representable, not reachable from a conforming daemon
  | 'unclassified'

export type AttachmentUploadEvent =
  | { type: 'refused'; uploadId: string; reason: 'too-large'; limitBytes: number }
  | { type: 'failed'; uploadId: string; reason: AttachmentUploadFailure }
  | { type: 'completed'; uploadId: string }
```

**The outcome takes a dedicated channel, not a `DaemonEvent` member.** The union must carry more than
one message per intent — [#864](https://github.com/pyrycode/pyrycode-desktop/issues/864) puts
in-flight progress on it *before* the terminal — which a request/response `invoke` cannot express, and
a new `DaemonEvent` arm would be a compile-forced edit in the four renderer bridges that each end their
switch in `assertNever` (`timelineBridge.ts`, `questionBridge.ts`, `modalBridge.ts`,
`daemonEventBridge.ts`), pushing this slice over its file boundary. Pushed with `ipcRenderer.on` rather
than replied with `invoke`, for the same reason.

**The intent carries no request body**, and that is the design's central security property, not a
convenience: the renderer sends with no argument, so there is no untrusted request field to validate
and no renderer-supplied string can reach a host path, a declared filename, or the wire. A fully
compromised renderer can make a picker appear; it cannot choose what the picker opens, and it cannot
read back what was sent. [#890](https://github.com/pyrycode/pyrycode-desktop/issues/890) (drag-and-drop)
will widen the intent to carry a dropped path, and *that* widening owes a request guard — the door is
left value-free today so the obligation is visible when it arrives.

**`AttachmentUploadFailure` is a re-declaration, checked by the compiler, not by discipline.** Shared
cannot import `AttachmentTransferFailure` from `src/main/transport/`, so its inherited literals are
restated. `driveUpload`'s `reason: result.outcome` assignment (below) is what makes drift a compile
error: an outcome added upstream fails to typecheck there rather than silently becoming unrepresentable
here — and that check has already fired for real, not just in theory. [#999](daemon-error-outcome.md)
widened `DaemonErrorOutcome` with the retrieval leg's two codes and reddened `driveUpload` until this
union grew by the same two; the fix widens rather than `Exclude`s them, because a hostile daemon can
still put either code on a forged `error` frame correlated to a pending upload chunk (see
[Attachment transfer](attachment-transfer.md) and [Daemon error outcome § Security
review](daemon-error-outcome.md#security-review)), and excluding them would make a value a hostile
daemon can cause **unrepresentable**, forcing the main side to coerce it into some other outcome and
report a failure that never happened. The two are documented above as representable on this union but
not reachable from a *conforming* daemon — no upload ends this way, and no composer copy should be
written for them.

**`uploadId` is the minted `attachment_id`**, one value under one name on the bridge —
`randomUUID()`, never derived from the filename, the path, or the bytes, which is what makes it safe
to cross. It is not a capability ([attachment path resolution](attachment-path-resolution.md)'s header
records that reasoning for the inbound direction); it exists to satisfy `uploadAttachment`'s
uniqueness precondition across concurrently live transfers and to give the renderer a discriminator for
two concurrent uploads and for #864's progress to correlate on.

### 2. `src/main/attachmentUpload.ts` — the guard and the drive

Electron-free — `node:fs/promises`, `node:path`, `node:crypto` only, the
[`saveDebugBundle`](save-debug-bundle.md) posture: the Electron-derived input (the picked path) is a
parameter, so the test module graph never touches `electron`.

```ts
export const ATTACHMENT_MAX_UPLOAD_CHUNKS = 512
export const ATTACHMENT_MAX_UPLOAD_BYTES = ATTACHMENT_MAX_UPLOAD_CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES

export function uploadAttachmentFile(path: string, deps: AttachmentUploadDeps): Promise<void>
export function uploadAttachmentBytes(file: AttachmentUploadFile, deps: AttachmentUploadDeps): Promise<void>
```

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
review pass's [File / storage] finding is what added the `isFile()` gate. See § Security below.

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

## Composition root — `src/main/index.ts`

The dialog cannot be Electron-free, so it stays at the composition-root edge, which is what keeps the
guard and the drive unit-testable either side of it and makes cancellation provable without a real
dialog: `dialog.showOpenDialog({ properties: ['openFile'] })` → `canceled` or an empty `filePaths` is
the no-op; otherwise `void uploadAttachmentFile(picked, { upload: connection.uploadAttachment, emit,
diagnosticLog })`, safe as a bare `void` because the callee never rejects. `ipcMain.on` registers the
listener; `app.on('will-quit', ...)` removes the exact listener, symmetric with the rest of the app's
`ipcMain` registrations.

## Bridge — `src/preload/index.ts`

Two members on the existing `api` literal: `requestAttachmentUpload(): void` (fire-and-forget `send`, no
argument) and `onAttachmentUploadEvent(listener): () => void` (the `onDaemonEvent` shape — strips the
raw `IpcRendererEvent`, returns an unsubscribe handle that removes the exact handler). Neither is called
yet; wiring the button and rendering the outcome is #863.

## Data flow

```
renderer: window.pyry.requestAttachmentUpload()   ── no argument ──▶

main: ipcMain.on(ATTACHMENT_UPLOAD_CHANNEL) → pickerOpen? ──yes──▶ ignored (one dialog at a time)
  │no
  pickerOpen = true
  dialog.showOpenDialog({ properties: ['openFile'] })
    canceled / no file ──▶ pickerOpen = false, nothing else happens
    │a path
    pickerOpen = false                                    ◀── cleared once the DIALOG settles
    uploadAttachmentFile(path, { upload, emit, diagnosticLog })
      readChosenFile(path)  ── open → isFile()? → size? → read, one handle throughout
        not a regular file / open|stat|read throws ──▶ emit failed:'unreadable'
        size > ATTACHMENT_MAX_UPLOAD_BYTES            ──▶ emit refused:'too-large' + limitBytes
        │ok
      driveUpload(uploadId, file, deps)
        deps.upload({ attachment_id: uploadId, filename, mime_type, bytes })  ── #861 ──▶
          { ok: true }              ──▶ emit completed
          { ok: false, outcome }    ──▶ emit failed: outcome

main → renderer: sender.send(ATTACHMENT_UPLOAD_EVENT_CHANNEL, event)   ── exactly one, or none ──▶
```

## Error handling

| Failure | Detected at | Reported as |
|---|---|---|
| Dialog cancelled / no file chosen | composition root | nothing — no event at all |
| Not a regular file (directory, FIFO, device) | `stats.isFile()` on the open handle | `failed: 'unreadable'` |
| `open` / `stat` / `read` throws (ENOENT, EACCES, EISDIR, …) | one `try` around the read | `failed: 'unreadable'` |
| Size over the client's own bound | the open handle's stat | `refused` + `limitBytes` |
| Driver terminal, failed | `await deps.upload(...)` | `failed: <AttachmentUploadFailure>` |
| Driver terminal, stored | `await deps.upload(...)` | `completed` |

Every path emits at most one event and both entry functions resolve `void`; neither rejects, so the
composition root's `void` call cannot leave an unhandled main-process rejection.

## Security

Architect self-review, first pass **FAILED** on a size-only guard (`/dev/zero` reachable from the macOS
dialog via Cmd-Shift-G passes an `open()`-followed symlink/device check that stats at size 0, then reads
unbounded — main-process memory exhaustion from an ordinary user action, with the bound reporting
success); the design was revised to gate on `stats.isFile()` before the length, and the re-walk
**PASSED**. One Electron-surface SHOULD-FIX — the bridge grants the renderer a new but minimal,
non-parameterised capability ("make a file picker appear") — is bounded by the `pickerOpen` flag rather
than left as unbounded repetition. Two residuals are named, not fixed, per the pipeline's
evidence-based-fix rule: no per-transfer deadline (inherited from #861 — a live-but-silent daemon leaves
a transfer unsettled until the relay's own pong timeout), and no read deadline on the file (a stalled
network volume leaves one promise pending and one handle open). Neither has been observed, and the
`pickerOpen` flag already clears before either could wedge the affordance. Full findings:
`docs/specs/architecture/862-attachment-upload-pick-and-report.md` § Security review.

## Testing

- **`src/shared/ipc/attachmentUpload.test.ts`** — the two channel constants are distinct from each other
  and from `DAEMON_EVENT_CHANNEL` / `COMMAND_CHANNEL`; the union is value-free beyond the fields listed,
  a positive walk over `Object.keys` rather than an absence assertion.
- **`src/main/attachmentUpload.test.ts`** — against real temp files (the `saveDebugBundle.test.ts`
  posture) and a fake `upload` / `emit` / `DiagnosticLog`: a small file uploads with byte-identical
  `bytes`, a basename `filename`, a table-derived `mime_type`, and a `randomUUID`-shaped `attachment_id`;
  a file of exactly `ATTACHMENT_MAX_UPLOAD_BYTES` uploads and one byte more is refused with `upload`
  never called; a missing path and a directory both emit `failed: 'unreadable'` with `upload` never
  called and the path absent from every emitted field and log record; every representative
  `AttachmentTransferFailure` row round-trips onto `failed.reason`; two concurrent runs mint distinct
  ids and emit two independent terminals; a >255-byte UTF-8 basename trims to ≤255 bytes and still
  decodes cleanly; `uploadAttachmentBytes` drives the same guard and terminals without touching disk.
  **The >255-byte trim could not be proven through the path route** — 255 bytes sits at or under every
  host filesystem's own component limit, so no file could be created to exercise it — and is proven at
  `uploadAttachmentBytes` instead, which both routes share.
- **No test for `index.ts`'s wiring or the preload members** — the composition root is Electron-bound
  and untested here by existing convention; the dialog seam it closes is exactly what the injected deps
  make provable one layer down.

## Edge cases and limitations

- **The client bound is not the daemon's bound.** A file under `ATTACHMENT_MAX_UPLOAD_BYTES` can still
  come back `attachment-too-large` from the driver — that is a `failed`, never a `refused`.
- **No per-transfer or per-read deadline.** See § Security.
- **Cancellation of an in-flight upload is not offered.** The ticket's terminal is one outcome per
  intent; a cancel affordance is a separate deliverable. The one long-lived `await` is #861's driver,
  which owns its own teardown net.
- **`pickerOpen` bounds the dialog, not the upload.** Two files can be mid-transfer at once; only a
  second *dialog* is refused while one is already open.

## Related

- [Attachment transfer](attachment-transfer.md) — the driver this flow calls (#861); its § Edge cases
  named this flow as the intended caller before it existed.
- [Attachment chunk envelope](attachment-chunk-envelope.md) / [Attachment-stored wire types](attachment-stored-wire-types.md) —
  the wire-level neighbours `ATTACHMENT_CHUNK_DATA_BYTES` and the filename/mime-type byte bounds are
  drawn from.
- [Attachment path resolution](attachment-path-resolution.md) / [Attachment filename sanitiser](attachment-filename-sanitiser.md) —
  the inbound leg's mirror-image gates (daemon-chosen text → host path); read and confirmed not to apply
  here, since this flow's direction is host path → wire, never the reverse.
- [Pairing status signal](pairing-status-signal.md) — the value-free-argument / dedicated-channel shape
  `attachmentUpload.ts` follows.
- [Attachment reassembly and store](attachment-reassembly-and-store.md) — the retrieval leg's magnitude
  bound, `ATTACHMENT_MAX_RETRIEVAL_BYTES` (#995), restates this file's `ATTACHMENT_MAX_UPLOAD_BYTES`
  figure and argument rather than importing it (a `main/ → transport/` module-graph direction issue),
  and a test pins the two equal.
- `docs/specs/architecture/862-attachment-upload-pick-and-report.md` — the full architecture spec,
  including the security review this doc summarizes.
- [#863](https://github.com/pyrycode/pyrycode-desktop/issues/863) — the button and the rendered outcome;
  not started.
- [#864](https://github.com/pyrycode/pyrycode-desktop/issues/864) — in-flight progress on the same
  channel, before the terminal; not started.
- [#890](https://github.com/pyrycode/pyrycode-desktop/issues/890) (drag-and-drop) / [#891](https://github.com/pyrycode/pyrycode-desktop/issues/891) (paste) —
  second entries into this flow via `uploadAttachmentFile` / `uploadAttachmentBytes`; neither goes
  through the dialog. Not started.
