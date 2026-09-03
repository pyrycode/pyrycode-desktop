# #862 — Upload the file the user picks, or state why not

The attach affordance's whole flow minus the button: an intent from the window opens the system file
picker in the background process, the choice is guarded and read, the bytes go to #861's upload
driver, and exactly one terminal outcome is pushed back to the window. Nothing renders here — this
slice ends at the bridge. The button and the rendering are #863.

## Files read

- `docs/knowledge/features/attachment-transfer.md` — #861's overview. Two lessons shape this slice:
  `uploadAttachment` takes `bytes` already in memory (turning a path into bytes is this slice's job),
  and it **never rejects**, so the unhandled-rejection surface this slice must close is the `fs` read
  it adds, not the driver call.
- `src/main/daemonConnection.ts` → `uploadAttachment` — the driver seam this slice calls. Its
  `not-connected` guard and its arm-before-drive/`finally` discipline mean this slice needs no
  connection state of its own.
- `src/main/transport/attachmentChunkPlan.ts` → `AttachmentChunkPlanInput` — the input contract this
  slice fills: `attachment_id` (caller-minted), `filename`, `mime_type`, `bytes`.
- `src/main/transport/attachmentTransfer.ts` → `AttachmentTransferResult`,
  `AttachmentTransferFailure` — the terminal this slice reports. Every inhabitant is a literal
  written in this repo, so passing outcomes through to the renderer provably carries no daemon text.
- `src/main/transport/inboundMessage.ts` → `DaemonErrorOutcome` — the seven daemon-mapped verdicts
  `AttachmentTransferFailure` widens; the source of the failure literals mirrored on the channel.
- `src/shared/wire/types.ts` → `ATTACHMENT_CHUNK_DATA_BYTES` (45000, a mandated stride),
  `ATTACHMENT_FILENAME_MAX_BYTES` / `ATTACHMENT_MIME_TYPE_MAX_BYTES` (both 255, **documented not
  validated**, counting UTF-8 bytes) — the bounds this side owes correct declaration against.
- `src/main/debugBundleDownload.ts` → `createDebugBundleDownload` — the orchestrator precedent:
  Electron-free, injected `emit`, log-free, information-minimising at the renderer boundary.
- `src/main/saveDebugBundle.ts` → `saveDebugBundle` — the precedent for a main-side module that uses
  `node:fs/promises` directly and takes its Electron-derived input as a parameter, so its test module
  graph stays Electron-free.
- `src/main/receiveCommand.ts` → `onCommand` / `CommandSource` — the `ipcMain.on` registration idiom
  (structural source interface, exact-listener unregister). This slice deliberately diverges on one
  point: it needs `event.sender`, which `onCommand` strips.
- `src/main/liveWindow.ts` → `createLiveWindow`, `LiveWindow.sink` — read to decide the push route.
  **`live.sink` cannot carry this channel**: its `webContents.send` ignores the channel argument and
  re-supplies `DAEMON_EVENT_CHANNEL` (`liveWindow.ts`'s `sink` literal). Using it would land upload
  events on the daemon-event channel. See § Design, "The outcome route".
- `src/main/emitDaemonEvent.ts` → `emitDaemonEvent`, `DaemonEventSink` — the destroyed-window guard
  (#518) this slice's push mirrors, and the reason its `send` is narrowed to `DaemonEvent`.
- `src/shared/ipc/pairingStatus.ts` → `PAIRING_STATUS_CHANNEL`, `PairingStatus` — the shape the
  ticket names for a dedicated channel: one channel constant plus a sealed, value-free union, no
  runtime logic, no `src/main` import.
- `src/main/index.ts` → the `app.whenReady` composition root — where the `dialog` call, the
  `ipcMain.on` registration and the `will-quit` unregister go.
- `src/preload/index.ts` → the `api` literal — where the two bridge members go, fixed-channel, with
  `ipcRenderer` never crossing.
- `src/main/attachmentPath.ts` (header) and `src/main/attachmentFilename.ts` (header) — the inbound
  leg's mirror-image gates. Read to confirm neither applies here: both defend against *daemon*-chosen
  text reaching a host path. This slice's direction is the reverse.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent` — the allowlisted content-free field set
  (`event`, `code`, `bytes`, `count`, …). It has no field shaped to carry a filename or a path.

## Design source

**Figma:** N/A — nothing renders in this slice. The ticket carries no `## Figma` section and none is
owed: the flow ends at the bridge, and #863 owns the button and the outcome's appearance. The
visual-fidelity check is intentionally skipped.

## Context

#861 landed a driver that takes bytes and answers with one terminal; pyrycode#1897 gave it a daemon
that answers. Nothing calls it. This slice is the caller: it obtains the bytes, mints the transfer
id, bounds what the app will attempt, and gives the window a channel to hear the answer on.

It is the attachment family's hub, so its two seams are contracts rather than internal choices — #890
(drop) and #891 (paste) are second entries into this same flow, and #864 puts progress on the same
outcome channel before the terminal.

No ADR is warranted. The two decisions worth recording — why the outcome gets a dedicated channel
rather than a `DaemonEvent` member, and why the client's size bound is expressed in chunks — belong
in `docs/knowledge/features/` prose, which the documentation phase owns.

## Design

Four production files; two new, two extended.

### 1. `src/shared/ipc/attachmentUpload.ts` (new) — the channel contract

Channel constants plus a sealed union, no runtime logic — `pairingStatus.ts`'s shape. Imports
nothing from `src/main` (shared is loaded by preload and renderer).

```ts
export const ATTACHMENT_UPLOAD_CHANNEL = 'pyry:attachment-upload'              // renderer → main
export const ATTACHMENT_UPLOAD_EVENT_CHANNEL = 'pyry:attachment-upload-event'  // main → renderer

export type AttachmentUploadFailure = 'unreadable' | <the four AttachmentTransferFailure
  transport literals> | <the seven DaemonErrorOutcome literals>

export type AttachmentUploadEvent =
  | { type: 'refused'; uploadId: string; reason: 'too-large'; limitBytes: number }
  | { type: 'failed'; uploadId: string; reason: AttachmentUploadFailure }
  | { type: 'completed'; uploadId: string }
```

**The intent carries no request body.** The renderer sends on `ATTACHMENT_UPLOAD_CHANNEL` with no
argument, exactly as `pairingStatus` invokes with none — so there is no untrusted request field to
validate at the boundary and no renderer-supplied string can reach a path, a filename or the wire.
#890 will widen this additively when it hands over a path; that widening owes a request guard, and
saying so here is the whole point of leaving the door value-free today.

**`AttachmentUploadFailure` is a re-declaration, checked by the compiler, not by discipline.** Shared
cannot import `AttachmentTransferFailure` from `src/main/transport/`, so the literals are restated.
The assignment in `reportResult` (below) is what makes drift a compile error: a twelfth outcome added
upstream fails to typecheck here rather than silently becoming unrepresentable.

**`uploadId` is the minted `attachment_id`.** One value, one name on the bridge. It is `randomUUID()`
— never derived from the filename, the path, or the bytes — which is what makes it safe to cross,
and it is the discriminator #864's progress and two concurrent uploads need. It is not a capability
(#818's header records that reasoning for the inbound direction).

### 2. `src/main/attachmentUpload.ts` (new) — the guard and the drive

Electron-free; `node:fs/promises` and `node:crypto` only, the `saveDebugBundle` posture. Deps
injected so the picker and the driver are both fakeable:

```ts
export const ATTACHMENT_MAX_UPLOAD_CHUNKS = 512
export const ATTACHMENT_MAX_UPLOAD_BYTES = ATTACHMENT_MAX_UPLOAD_CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES

export interface AttachmentUploadDeps {
  upload: (input: AttachmentChunkPlanInput) => Promise<AttachmentTransferResult>
  emit: (event: AttachmentUploadEvent) => void
  diagnosticLog?: DiagnosticLog
}

/** Read `path`, guard it, drive the upload, emit exactly one terminal. Never rejects. */
export function uploadAttachmentFile(path: string, deps: AttachmentUploadDeps): Promise<void>

/** The same flow from the size guard on, for a route that already holds bytes (#891). */
export function uploadAttachmentBytes(
  file: { bytes: Uint8Array; filename: string; mimeType: string },
  deps: AttachmentUploadDeps
): Promise<void>
```

**The size bound is expressed in chunks, because chunks are what cost time.** `512 *
ATTACHMENT_CHUNK_DATA_BYTES` = 23 040 000 bytes. 512 chunks is ≈30.7 MB of base64 on the wire (45000
raw bytes base64-encode to exactly 60000 characters), so at a 1 MB/s effective relay uplink the
transfer takes ≈30 s, and peak main-process memory is the file plus its base64 ≈54 MB. Doubling it
doubles both. The figure is a stop-the-app-wasting-minutes bound, **not a prediction of the daemon's
answer**: the daemon's per-upload bound is receiver-configured and unpublished (`pyrycode`
`docs/protocol-mobile.md` § Attachments — a client learns it by being rejected), so a file under this
bound may still come back `attachment-too-large`, and that is the driver's outcome to report, not
this guard's failure.

**Open-then-stat, never stat-then-open.** `uploadAttachmentFile` opens a `FileHandle`, stats *the
handle*, refuses on size, then reads through the same handle, closing it in a `finally`. Checking a
path and then opening it leaves a swap-in-the-gap window in which the bound is not the bound; the
handle names one inode for the whole sequence. This is also what makes the bound a real memory bound
rather than a report after the fact — an oversized file is never read.

**The stat gate is `isFile()` first, size second.** A size bound only bounds a regular file. `open()`
follows symlinks, a character device or a FIFO stats at size 0, and a read from one is unbounded — so
a size-only guard passes `/dev/zero` straight through to a read that never returns and never stops
growing. `stats.isFile()` is therefore checked before the length, and anything else is `unreadable`.
It also gives the chosen-a-directory case a decided answer instead of leaving it to whichever errno
the platform's read happens to raise.

**Declaring `filename` and `mime_type`.** `basename(path)` trimmed to
`ATTACHMENT_FILENAME_MAX_BYTES` **on a UTF-8 byte boundary**: the trim accumulates whole code points
(`for (const cp of value)`, which iterates code points and so never splits a surrogate pair) until
the next one would cross 255 bytes. A macOS name of 255 non-ASCII characters is far over 255 bytes,
which is exactly the case a `.slice(0, 255)` gets wrong. `mime_type` comes from a small client-owned
extension table with an `application/octet-stream` fallback — a hint the daemon does not verify, and
bounded by construction (every entry is a short literal in this repo), so it needs no runtime trim.
The daemon re-sanitises both; this side owes correct declaration, not defence.

**The outcome route.** `emit` is a dep, and the composition root closes `event.sender` (the
`WebContents` that sent the intent) into it. That is the whole reason this needs no `liveWindow`
change: the answer goes back to the window that asked, captured per-request rather than held for the
process lifetime, so there is no stale-reference problem for #519 to solve. `live.sink` is unusable
for this channel — it re-supplies `DAEMON_EVENT_CHANNEL` and would land upload events on the daemon
bridges. The send is guarded on `sender.isDestroyed()`, `emitDaemonEvent`'s #518 discipline: a window
closed mid-upload drops the outcome rather than throwing, the same loss the daemon-event channel
already takes in the closed-window gap.

### 3. `src/main/index.ts` (extended) — the composition-root edge

The dialog cannot be Electron-free, so it stays here, injected as the seam that makes cancellation
provable without a real dialog:

- `dialog.showOpenDialog({ properties: ['openFile'] })` → `canceled` or an empty `filePaths` means
  **no-op**: nothing read, nothing sent, **no event emitted**.
- `ipcMain.on(ATTACHMENT_UPLOAD_CHANNEL, listener)` — the listener captures `event.sender`, opens the
  dialog, and on a choice calls `void uploadAttachmentFile(picked, { upload: connection.uploadAttachment, emit, diagnosticLog })`.
  The `void` is safe **because the callee never rejects**, which is a property of both this slice's
  module and #861's `uploadAttachment`, not of a `.catch()` anyone must remember.
- **One dialog at a time.** A `pickerOpen` flag, set before `showOpenDialog` and cleared in a
  `finally` as soon as it settles — `debugBundleDownload`'s single-in-flight posture, scoped to the
  *dialog* rather than to the upload. A double-clicked button (and a renderer spamming the channel)
  therefore cannot stack pickers, while AC3's concurrency is untouched: the flag is already clear
  while the first file uploads, so a second pick starts a second live transfer.
- `app.on('will-quit', unregister)` — the exact listener removed, symmetric with `unregisterCommands`.

### 4. `src/preload/index.ts` (extended) — the bridge

Two members on the existing `api` literal, both fixed-channel, `ipcRenderer` never crossing:
`requestAttachmentUpload(): void` (fire-and-forget `send`, no argument) and
`onAttachmentUploadEvent(listener): () => void` (the `onDaemonEvent` shape — strip the
`IpcRendererEvent`, return an unsubscribe handle that removes the exact handler).

## State + concurrency model

No store, no timer, no listener beyond the one `ipcMain.on` registration, no `AbortSignal`. The whole
flow is one `async` function per intent, and its only long-lived work is `await deps.upload(...)`,
which #861 owns and settles on its own teardown net (`failAttachmentTransfers` on every connection
terminal). Cancellation of an in-flight upload is therefore not this slice's to add — and is not
offered: the ticket's terminal is one outcome, and a cancel affordance is a separate deliverable.

The one `FileHandle` is closed in a `finally` on every path, including the refusal.

**Concurrent uploads are permitted and do not cross.** Each intent mints its own `randomUUID()`, which
satisfies `uploadAttachment`'s stated uniqueness precondition (`attachment-transfer.md` § Edge cases)
across live transfers, and each carries its own `emit` closure. No shared mutable state exists, so
there is no check-then-act gap across the two `await`s.

## Error handling

| Failure | Detected at | Reported as |
|---|---|---|
| Dialog cancelled / no file chosen | composition root | nothing — no event at all |
| Not a regular file (directory, FIFO, device) | `stats.isFile()` on the open handle | `failed: 'unreadable'` |
| Size over the client bound | `uploadAttachmentFile`, on the open handle's stat | `refused` + `limitBytes` |
| `open` / `stat` / `read` throws (ENOENT, EACCES, EISDIR, …) | one `try` around the read | `failed: 'unreadable'` |
| Driver terminal, failed | `await deps.upload(...)` | `failed: <AttachmentTransferFailure>` |
| Driver terminal, stored | `await deps.upload(...)` | `completed` |

Every path emits at most one event and the function resolves `void`; **it never rejects**, so the
composition root's `void` call cannot leave an unhandled main-process rejection. The caught fs error
is **dropped, never inspected or forwarded** — Node's `ErrnoException` carries `.path`, so
classify-don't-forward (inherited #62) is load-bearing here rather than stylistic.

## Logging

Through the injected `DiagnosticLog`, content-free by the shape of `DiagnosticEvent` (it has no field
that can hold a filename or a path): `event: 'attachment-pick'` with `code` in
`'too-large' | 'unreadable' | 'started' | 'completed' | <failure>`, plus `bytes` (the file's length —
the allowlisted content-free field #861 already logs) on `started` and `too-large`. **The path, the
basename, the derived `mime_type` and the `uploadId` are never logged** — the first two are the
user's private data, and the last is deliberately absent from #861's records for a reason this slice
inherits.

## Testing strategy

Vitest, node environment. No renderer test (nothing renders) and no Playwright spec (#863 covers the
click in `e2e/`).

- **`src/shared/ipc/attachmentUpload.test.ts`** — the two channel constants are distinct and distinct
  from `DAEMON_EVENT_CHANNEL` / `COMMAND_CHANNEL`; the union is value-free beyond the fields listed
  (a positive walk over `Object.keys` of one instance of each member, not an absence assertion).
- **`src/main/attachmentUpload.test.ts`** — the flow, against real temp files (the
  `saveDebugBundle.test.ts` posture) and a fake `upload` / `emit` / `DiagnosticLog`:
  - a small file uploads: `upload` is called once with `bytes` byte-identical to the file, a
    `filename` equal to the basename, a `mime_type` from the table, and a `randomUUID`-shaped
    `attachment_id`; `completed` is emitted once, carrying that same id.
  - a file of exactly `ATTACHMENT_MAX_UPLOAD_BYTES` uploads; one byte more is **refused with
    `upload` never called** — the "before any chunk is built" assertion — and the emitted
    `limitBytes` equals the exported constant.
  - a path that does not exist, and a path that is a directory, both emit `failed: 'unreadable'`
    with `upload` never called; neither the promise rejects nor any emitted field or log record
    contains the path. The directory case is the portable stand-in for the whole not-a-regular-file
    class (a character device such as `/dev/zero` is the case that actually motivates the guard, but
    it is not portable to assert against).
  - each representative `AttachmentTransferFailure` row round-trips onto `failed.reason`; a
    `{ ok: true }` becomes `completed`. Exactly one event per run, asserted by count.
  - two concurrent runs over the same file mint different ids and emit two independent terminals.
  - AC5 as a positive walk: over every emitted event and every captured log record, no string field
    contains the temp path, the basename, or any file byte. The filename is chosen to be a
    distinctive non-ASCII string so a substring search is meaningful.
  - a >255-byte UTF-8 basename is trimmed to ≤255 **bytes** and the result still decodes (no lone
    surrogate, no replacement character) — `Buffer.byteLength(name, 'utf8') <= 255` plus a
    round-trip, not a character count.
  - `uploadAttachmentBytes` drives the same guard and the same terminals without touching the disk.
- **No test for `index.ts`'s wiring or the preload members** — the composition root is Electron-bound
  and untested here by existing convention (the `onCommand` switch is too), and the dialog seam it
  closes is exactly what the injected deps make provable one layer down.

## Open questions

1. **Does the intent channel need a request guard now?** Proposed: no — it carries no argument, so
   there is nothing to validate; the guard is owed by #890, which adds a path. To be re-checked in
   Phase B against the actual `ipcMain.on` listener signature.
2. **Should the trim preserve the file extension?** Proposed: no. The daemon re-sanitises the name
   and `mime_type` rides the same frame, so a truncated extension costs nothing that matters, and a
   255-byte name is already pathological.

## Size

**Over the 800-line ceiling, stated rather than split — the floor rule wins.** Estimated ~880 lines
of total written work (this plan ≈230, production ≈330, tests ≈320). Every other boundary holds:
4 production files (≤5), 3 new exported types (≤5), 0 consumer call sites needing simultaneous
update — every change is additive — 5 acceptance criteria (≤5), 2 new reject branches (≤10).

The three candidate cuts are the size guard, the channel, and the dialog wiring. Each has **exactly
one consumer inside this slice**: the guard is called only by the drive, the channel is written only
by the drive and read only by a renderer that does not exist yet, and the dialog exists only to
produce the path the guard takes. Splitting any of them produces a child nothing outside the family
calls, which the sizing floor merges back. #862's split depth is already 1 (parent #685), and the
refiner reached the same conclusion with the same reasoning in its `Estimate:` line.

## Security review

**Verdict:** PASS (first pass FAILED on finding 3.1; the design above was revised and re-walked).

**The design's central security property**, which the findings below are measured against: *the
renderer names an intent, never a file.* The intent channel carries no argument, so no
renderer-supplied string reaches a path, a filename, or the wire; the path exists only between the OS
dialog and `open()`, and the bytes only between `readFile` and the driver. A fully compromised
renderer can cause a picker to appear — it cannot choose what it opens, and it cannot read back what
was sent.

**Findings:**

- [Trust boundaries] No findings. Three boundaries, each explicit and each a named function.
  *Renderer → main*: `ipcMain.on`'s listener reads **neither** trailing IPC argument — the intent is
  its own arrival, so there is no untrusted field, which is why it ships without a request guard
  (`pairingStatus.ts`'s argument, restated). *Disk → main*: `uploadAttachmentFile`, and the value it
  produces is `Uint8Array` + two declared strings, never a handle or a path held past the `finally`.
  *Daemon → main*: only `AttachmentTransferResult` crosses, whose failure type is a closed union of
  literals written in this repo, so a value of that type provably holds no daemon text (#861's
  property, inherited). *Main → renderer*: `AttachmentUploadEvent`, which has **no field shaped to
  carry** a path, a name, or a byte — AC5 is structural, not a review promise.
- [Tokens] No findings — no token, key, or credential is read, minted, stored, or logged. `uploadId`
  is `randomUUID()` from `node:crypto` (CSPRNG-backed). It does **not** need to be unguessable — the
  daemon's ceiling on an attachment id is explicitly not a safety property and containment is the
  receiver's resolution check (`attachmentPath.ts`'s header) — but it does need to be unique across
  live transfers, which is `uploadAttachment`'s stated precondition, and v4 uniqueness discharges it.
  It is derived from nothing about the file, which is what makes it safe to put on the bridge where
  #861 deliberately keeps it out of the log.
- [File / storage] **MUST FIX, found and folded into § Design before this section was written** — the
  first draft's guard was size-only. `open()` follows symlinks, and a character device or FIFO stats
  at size 0, so `/dev/zero` (reachable from the macOS dialog via Cmd-Shift-G) passed the bound and
  reached an unbounded `readFile` — main-process memory exhaustion from an ordinary user action, with
  the bound reporting success. Fixed by gating on `stats.isFile()` **before** the length. Otherwise
  no findings: nothing is written to disk, so atomicity, storage scope and encryption-at-rest do not
  arise; no untrusted value is concatenated into a path (`basename` derives a *display name*, and the
  daemon re-sanitises it); TOCTOU is closed by open-then-stat-the-handle rather than stat-then-open,
  which is the checklist's own preference.
- [Electron attack surface] **SHOULD FIX, folded in** — the bridge grants the renderer one new
  capability, "make a file picker appear". Minimal and non-parameterised, but unbounded repetition of
  it is a denial-of-attention: the `pickerOpen` flag in § Design bounds it to one, and also fixes the
  ordinary double-click. No `webPreferences` change (`sandbox: true`, `contextIsolation: true`,
  `nodeIntegration` off, all unchanged); no protocol handler, no navigation change; `ipcRenderer`
  still never crosses `contextBridge`; the bytes, the path, and the socket all stay in main.
- [Cryptographic primitives] No findings — this slice performs no cryptography. The transfer's
  `sha256` is `planAttachmentChunks`' (#860) and unchanged; the Noise session is untouched.
- [Network & I/O] No findings from this slice. Two inherited residuals, named not fixed: **#861's
  absent per-transfer deadline** (a live-but-silent daemon leaves a transfer unsettled until
  `relayConnection.ts`'s `WIRE_PONG_TIMEOUT_MS` tears the socket down), and **no read deadline on the
  file** (a stalled network volume leaves one promise pending and one handle open). Neither has been
  observed; inventing a timeout constant for either is the unobserved-failure-mode defence the
  pipeline forbids. Neither wedges the affordance — `pickerOpen` clears before the read begins.
- [Errors, logs, telemetry] No findings, one load-bearing decision. The caught fs error is **dropped
  unexamined**: Node's `ErrnoException` carries `.path`, so forwarding or logging it would put the
  user's host path in a diagnostic bundle through a field that looks safe. `DiagnosticEvent` has no
  field that can hold a filename, and the path, basename, derived `mime_type` and `uploadId` are all
  absent from every record by choice, not by scrubbing. No telemetry, no renderer console write.
- [Concurrency] No findings. One `async` function per intent, no shared mutable state but the
  `pickerOpen` boolean (single-writer on the main thread; set and cleared around one `await`), no
  timer, no listener beyond the single `ipcMain.on` registration removed on `will-quit`. The
  `FileHandle` is closed in a `finally` on every path including the refusal and the throw. The
  long-lived work — the transfer — is owned and cancelled by #861's handle and its teardown net.
- [Threat model] Aligned, with one residual named. A **hostile relay** is content-blind and on-path;
  it can drop, delay, reorder or flood, none of which produce a wrong terminal (#861's argument,
  unchanged), and the file's *size* was already observable to it as a chunk count. A **hostile
  daemon** reaches this module only through the closed literal union. **Renderer compromise** is the
  interesting one and is contained by the design's central property above. The residual: `ipcMain`
  does not tell us *which frame* sent the intent, and this slice does not check `event.senderFrame`.
  Three existing controls make a non-app sender unreachable rather than merely unlikely — the window
  loads only its own document, `will-navigate` confines in-place navigation to that document,
  `setWindowOpenHandler` denies every child window, and the app embeds no `<webview>` or remote
  iframe. Out of scope for this ticket; the ticket to file is a repo-wide sender-frame assertion
  across **all** `ipcMain` channels, not one bolted onto the newest.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
