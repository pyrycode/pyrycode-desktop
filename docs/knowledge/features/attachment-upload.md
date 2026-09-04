# Attachment upload (pick, guard, drive, report)

The attach affordance's whole flow minus the button: an intent from the window opens the system file
picker in the background process, names a path the window resolved from a dropped file (#890), or (#1032)
names nothing at all and lets the background process read the operator's clipboard itself. Whichever
entry, the file is guarded — on an **open handle** for a path, on the bytes a clipboard reader returned
for a paste — and read, declared with a byte-trimmed filename and a derived `mime_type`, and driven
through [attachment transfer](attachment-transfer.md)'s (#861) `uploadAttachment` under a `randomUUID`
transfer id. Exactly one terminal — `completed`, one of two `refused` reasons (the client's own size
bound, or `no-image` for a paste that found nothing, #1032), or `failed` with the driver's outcome — is
pushed back to the window on a dedicated channel pair, optionally preceded by in-flight `progress` events
for a large file (#864, below). A cancelled picker, and a malformed or unrecognised ask on either guarded
shape, are all a total no-op: nothing read, nothing sent, nothing emitted. **Nothing renders here** — this
slice ends at the bridge; the button and the outcome's appearance, and the drop gesture itself, are
[Composer attach](composer-attach.md) (#863, #890). #1032 adds no renderer surface either — the paste
keystroke that calls it is #1033, blocked by #1032 and not yet started.

Introduced in [#862](https://github.com/pyrycode/pyrycode-desktop/issues/862), split from #685.
In-flight progress added in [#864](https://github.com/pyrycode/pyrycode-desktop/issues/864). The
drag-and-drop entry, and this channel's request body, added in
[#890](https://github.com/pyrycode/pyrycode-desktop/issues/890). The pasted-image entry, and the
`refused` member's split into two, added in
[#1032](https://github.com/pyrycode/pyrycode-desktop/issues/1032).

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
  | { type: 'progress'; uploadId: string; sentChunks: number; totalChunks: number }  // #864
```

**The outcome takes a dedicated channel, not a `DaemonEvent` member.** The union must carry more than
one message per intent — [#864](https://github.com/pyrycode/pyrycode-desktop/issues/864) puts
in-flight `progress` on it *before* the terminal — which a request/response `invoke` cannot express,
and a new `DaemonEvent` arm would have been a compile-forced edit in the four renderer bridges that
each end their switch in `assertNever` (`timelineBridge.ts`, `questionBridge.ts`, `modalBridge.ts`,
`daemonEventBridge.ts`), pushing this slice over its file boundary. Pushed with `ipcRenderer.on` rather
than replied with `invoke`, for the same reason.

**`progress` (#864) — the fourth member, and the one qualification #862's containment argument did not
carry.** `sentChunks` / `totalChunks` are both counts of frames the transport has already put on or
plans to put on the wire — `totalChunks` is the plan's `total_chunks`
([attachment chunk envelope](attachment-chunk-envelope.md)), `sentChunks` is
`sentEnvelopes.size` read off [attachment transfer](attachment-transfer.md) at the moment each chunk
lands. Zero or more `progress` events precede exactly one terminal; none follows one — see
[attachment transfer](attachment-transfer.md) for the two independent guards that make that hold, and
[Composer attach](composer-attach.md) for how the renderer's single nullable makes "no second indicator
beside the outcome" true by construction rather than by arbitration.

`totalChunks` is the first field on this union derived from the **chosen file** rather than from a
client-owned constant — it states the file's size to within `ATTACHMENT_CHUNK_DATA_BYTES`, which
qualifies #862's "a compromised renderer cannot read back what was sent". The resolution is to state
it, not hide it: at one event per chunk a renderer can already count events and derive the same
number, so a bare percentage would withhold nothing while being less honest about the cost. Accepted
on its size — a window that already holds the whole conversation timeline learning the approximate
size of a file its own user just picked is far inside the blast radius #862 already accepts.

Whether `progress` is emitted at all is decided in the background process against one named chunk
constant, `ATTACHMENT_PROGRESS_MIN_CHUNKS` (below) — never against a clock, so the decision is the
same on a fast link and a slow one, and a small upload costs no IPC at all.

**The intent was value-free at first, and the request body it grew stays optional (#890).** #862 shipped
this channel with the renderer sending no argument at all: no untrusted request field to validate, no
renderer-supplied string that could reach a host path, a declared filename, or the wire. That door was
left value-free deliberately, so the obligation would be visible the day something wanted to widen it —
[#890](https://github.com/pyrycode/pyrycode-desktop/issues/890) (drag-and-drop) is that day. Presence, not
a discriminator field, tells the two apart: an argument-free send still means *open the picker* and
reaches no request field, exactly as before; a send carrying a well-formed `AttachmentUploadRequest`
means *upload this path* and is refused outright by `isAttachmentUploadRequest` unless it passes. There is
still exactly one place a path enters main from the window — see § The request body and its guard below
for the full shape.

### The request body and its guard (#890)

```ts
export const MAX_UPLOAD_PATH_LENGTH = 4096
export interface AttachmentUploadRequest { path: string }
export function isAttachmentUploadRequest(value: unknown): value is AttachmentUploadRequest
```

One field, camelCase (client-internal IPC, not a wire type) — the path of a file the operator **dropped**,
resolved in the preload by `webUtils.getPathForFile` (see § The bridge below). Extra keys are accepted and
never read, since nothing downstream rebuilds a value from anything but `path`.

`isAttachmentUploadRequest` is `attachmentBytes.ts`'s `isAttachmentBytesRequest` shape, applied to a path
instead of a byte identifier: narrow to non-null `object`, `in`-guard the key, `typeof` the value actually
found, bound the length at `MAX_UPLOAD_PATH_LENGTH` (4096 — `MAX_SAVE_FILENAME_LENGTH`'s figure, and the
platform ceiling for a path a real drop can produce). **The empty-string refusal is the load-bearing
line, not the length bound above it**: `webUtils.getPathForFile` answers `''` for a `File` the page
constructed itself, so this is where "only an operator gesture delivers a path-backed `File`" stops being
a property the preload merely observes and becomes a refusal main actually performs. The `in`-guarded read
on a narrowed `object` is what makes a `__proto__`-carrying literal refuse itself — the polluting object
has no *own* `path`, so the typeof test never sees the prototype's.

**A size bound, not a shape or canonicity one, deliberately** — the single-gate argument stays intact:
`readChosenFile` (below) remains the sole thing that decides whether a path names a readable regular file,
and it decides that by *opening* the path, never by inspecting the string. There is no root to confine the
path to, either: dropping a file from anywhere on the operator's own disk is the whole feature, so a
prefix check would be the wrong thing to add here, not a redundant one.

**A rejected request makes no filesystem call and emits no event** — the same posture every other
attachment channel documents. Nothing an operator can physically do produces one: a real drop always
carries a real path, so an empty or malformed request means a page-constructed `File` or a compromised
renderer, and neither is owed a sentence in the composer.

**The honest containment claim is narrower than "only a drop is possible", and wider too.**
`dropAttachmentFile` (§ The bridge) is callable by any renderer code holding any `File`, so the accurate
property is *only an operator gesture mints a path-backed `File`* — a drop, or a file-system picker (this
app renders no `<input type=file>`). The marginal capability a compromised renderer gains is forwarding a
path-backed `File` it already holds from an earlier gesture, not naming an arbitrary path on disk. That
property holds only while the preload stays the sole resolver and main refuses an empty or non-string path
outright, which is exactly what this guard is for.

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

### The paste ask, and the `refused` split (#1032)

```ts
export const ATTACHMENT_PASTE_SOURCE = 'clipboard-image' as const
export interface AttachmentPasteRequest { source: typeof ATTACHMENT_PASTE_SOURCE }
export function isAttachmentPasteRequest(value: unknown): value is AttachmentPasteRequest
```

**Presence alone stopped being enough with a third entry, and that is this slice's whole substance.** The
shipped picker sender can't be given a discriminator without changing what a conforming renderer puts on
the wire, so the *new* ask names itself and both shipped shapes — argument-free, and `{ path }` — stay
untouched. `isAttachmentPasteRequest` is `isAttachmentUploadRequest`'s shape verbatim: narrow to a
non-null `object`, `in`-guard `source`, compare against the one accepted literal — the comparison against
a constant, not a bare `typeof`, is the load-bearing line here the way the empty-string refusal is for the
path guard, since a renderer could otherwise invent any string. A `__proto__`-carrying ask refuses on the
same `in`-guard: the polluting object has no *own* `source`. A named field rather than `{}`, deliberately
— an empty object would be indistinguishable from a malformed ask and would turn "anything object-shaped
that isn't a path ask" into an upload trigger, the guard getting *blunter* rather than sharper.
`AttachmentPasteRequest` carries no information beyond which entry fired; `uploadClipboardImage` (below)
reads no field off it at all. **The two guards are tried path-first in the main listener** — see §
Composition root.

**`refused` splits into two members sharing one `type`, forced by measurement rather than chosen for
tidiness:**

```ts
| { type: 'refused'; uploadId: string; reason: 'too-large'; limitBytes: number }
| { type: 'refused'; uploadId: string; reason: 'no-image' }             // #1032
```

Widening the shipped member's `reason` in place *typechecks* and then silently renders the too-large
sentence, limit figure included, for a clipboard that held no image —
[Composer attach's copy switch](composer-attach.md#attachmentuploadcopyts---the-copy-is-a-selection-not-a-rendering)
reads `event.limitBytes` and never branched on `reason`. A separate member with `limitBytes` *absent*
(never optional) is what turns that silent mis-render into a compile error — observed in Phase B as
exactly one `TS2339`, nothing else in the repo reading that field. The new member is declared *below* the
shipped one, each keeping its own docblock, so neither orphans the other
([[inserting-a-declaration-between-a-docblock-and-its-symbol-orphans-it]]).

**Neither shipped union test caught the split on its own** — both pass unchanged over a fifth member: the
field-walk is a hand-written instance list, and `discriminates on type across all four members` counts
`type` strings, which a second `refused` variant doesn't change. #1032 made the reason axis
compiler-forced instead of counted (`Record<Extract<AttachmentUploadEvent, { type: 'refused'
}>['reason'], true>`), so a third refusal reason now fails to typecheck there rather than passing by
accident — the `ATTACHMENT_UPLOAD_FAILURE_COPY` mechanism, applied to the axis that had gone stale.
`AttachmentUploadFailure` is untouched: AC2 ruled the no-image case out of it on purpose — nothing was
attempted and nothing went wrong, so it's a refusal, never a failure.

### 2. `src/main/attachmentUpload.ts` — the guard and the drive

Split into its own document because folding #1032's paste entry into this section pushed the parent over
the size cap: see [Attachment upload — the guard and the drive](attachment-upload-guard-and-drive.md)
for the full detail — `uploadAttachmentFile`,
`uploadAttachmentBytes`, `driveUpload`'s exactly-one-terminal discipline, the progress gate (#864), the
open-then-stat / `isFile()` guard (a security-review finding, not an up-front design choice),
`filename`/`mime_type` declaration, the outcome route, `pickerOpen`, content-free logging, and the paste
entry `uploadClipboardImage` (#1032) — including the unaddressed `uploadAttachmentBytes` SHOULD FIX
flagged at review and still open.

## Composition root — `src/main/index.ts`

The dialog cannot be Electron-free, so it stays at the composition-root edge, which is what keeps the
guard and the drive unit-testable either side of it and makes cancellation provable without a real
dialog: `dialog.showOpenDialog({ properties: ['openFile'] })` → `canceled` or an empty `filePaths` is
the no-op; otherwise `void uploadAttachmentFile(picked, deps)`, safe as a bare `void` because the callee
never rejects. `ipcMain.on` registers the listener; `app.on('will-quit', ...)` removes the exact
listener, symmetric with the rest of the app's `ipcMain` registrations.

**One listener, three arms (#890, #1032).** `attachmentUploadListener` reads a second, `unknown`-typed
parameter — `unknown` because the renderer is untrusted at this boundary regardless of any declared type.
The two guarded shapes are tried **path-first**, and the ordering is load-bearing rather than stylistic:
`isAttachmentUploadRequest(request)` is tried before `isAttachmentPasteRequest(request)`, so an ask
carrying a valid `path` reaches the drop arm exactly as it did before a third shape existed, extras
included — nothing an operator can produce changes arm now that a second guarded shape is accepted. A
passing drop request calls `uploadAttachmentFile(request.path, deps)`; a passing paste request calls
`uploadClipboardImage(readClipboardImagePng, deps)` (below). An ask that carried something and matched
neither guard is dropped outright — no filesystem call, no clipboard read, no event, and deliberately no
log, denying a looping renderer a way to drive the main-process logger. `request === undefined` selects
the picker arm, byte-for-byte what #862 shipped. **`pickerOpen` stays scoped to the dialog**: neither the
drop arm nor the paste arm opens one, so neither reads nor sets that flag, and several transfers may be
live at once (one per arm, or several drops, or several pastes) by this flow's existing design.

**The clipboard read is injected at the composition root, `saveDebugBundle`'s `save` seam (#1032):**

```ts
const readClipboardImagePng = (): Uint8Array | null => {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const png = image.toPNG()
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength)
}
```

`clipboard` joins the existing `electron` import — this closure is the paste entry's **only** Electron
touch, which is what keeps `attachmentUpload.ts` Electron-free and lets the no-image branch unit-test
without reaching the operator's real clipboard. The PNG buffer is handed on as a true `Uint8Array` **view**
honouring `byteOffset`/`byteLength` — `readChosenFile`'s idiom, mattering more here because a small
`Buffer` from native code may sit in a pooled `ArrayBuffer`. **This closure is the argument the ticket's
`security-sensitive` label is for**, owed in full rather than by analogy to the standing "the permission
allowlist must never grow to `clipboard-read`" instruction a few lines above it in the same file — see §
Security below.

**The `deps` object moved to the top of the listener, shared by every arm — a change forced by adding the
second entry, not a tidy-up.** It used to live inside the picker's own `.then`. Two entries each building
their own `deps` closure is the shape that lets "one driver, one outcome channel" drift into two: a future
edit to how progress is forwarded, or which channel an outcome lands on, would have to be made twice and
could land once. Hoisting it keeps that structural rather than a matter of discipline — `event.sender` is
still closed in for [#519](https://github.com/pyrycode/pyrycode-desktop/issues/519)'s reason, and the
`emitDaemonEvent`-style `sender.isDestroyed()` guard is unchanged.

## Bridge — `src/preload/index.ts`

Four members on the existing `api` literal (#1032 added the fourth): `requestAttachmentUpload(): void`
(fire-and-forget `send`, no argument — the picker intent, unchanged), `dropAttachmentFile(file: File):
void` (#890, below), `pasteAttachmentImage(): void` (#1032, below), and `onAttachmentUploadEvent(listener):
() => void` (the `onDaemonEvent` shape — strips the raw `IpcRendererEvent`, returns an unsubscribe handle
that removes the exact handler). All four are called from [Composer attach](composer-attach.md) (#863's
button and outcome view, #890's drop handler); `pasteAttachmentImage`'s only caller is #1033, blocked by
\#1032 and not yet landed.

**`dropAttachmentFile` (#890) is the one place on the window side that may touch a host path** — the
deliberate, narrow exception to "the renderer names an intent, main owns the path", and the reason the
ticket that added it carried `security-sensitive`. It exists because a drop is delivered by the operating
system to the *window*, as a DOM `File` on the drop event, so there is nowhere else on the window side the
path can be recovered: Electron 33 (this repo's version) removed `File.path`, and `webUtils.getPathForFile`
is the sanctioned replacement — available in a sandboxed preload, which this app runs (`sandbox: true`).

```ts
dropAttachmentFile: (file: File): void => {
  let path: string
  try {
    path = webUtils.getPathForFile(file)
  } catch {
    return
  }
  if (path === '') return
  ipcRenderer.send(ATTACHMENT_UPLOAD_CHANNEL, { path })
}
```

Two silent ways out, both before anything crosses the bridge: `getPathForFile` **throws** when handed
something that is not a `File`, so the call is wrapped in a `try` — which stops that throw from crossing
the bridge as much as it filters non-`File` input — and an empty result (a page-constructed `File`) sends
nothing. Neither is trusted as the actual defence: the window is untrusted at this boundary regardless of
the declared parameter type, so `isAttachmentUploadRequest` re-checks on the main side and drops a
malformed ask there regardless of what the preload let through. The resolved string is a local in this
function's frame and the function returns `void`, so it reaches no renderer state, no log line, and no
diagnostic record — the `File` handle is all the window ever holds. `webUtils` itself never crosses the
bridge, any more than `ipcRenderer` does, and `ATTACHMENT_UPLOAD_CHANNEL` is fixed in the closure so the
renderer cannot address an arbitrary channel.

**`pasteAttachmentImage` (#1032) is the narrowest of the three senders — the reverse of
`dropAttachmentFile`'s posture.** A drop had to admit a host path because the OS hands a dropped file to
the *window*; a clipboard is readable from the *background process*, so the reverse cut is taken instead:
the window names an intent and nothing else.

```ts
pasteAttachmentImage: (): void => {
  const request: AttachmentPasteRequest = { source: ATTACHMENT_PASTE_SOURCE }
  ipcRenderer.send(ATTACHMENT_UPLOAD_CHANNEL, request)
}
```

No argument, nothing to throw, nothing to filter — unlike `dropAttachmentFile`, there's no `File` to
resolve and no empty-string case. `ipcRenderer` never crosses the bridge and the channel is fixed in the
closure, the same posture every sender here shares. `PyryApi` is inferred from `api`, so
`src/preload/index.d.ts` needed no edit.

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

The drop entry (#890) joins the same diagram one step later, at the listener — path guard tried first
(#1032, see § Composition root):

```
renderer: window.pyry.dropAttachmentFile(file)
  preload: webUtils.getPathForFile(file)
    throws (not a File)  ──▶ nothing sent
    ''  (page-built File) ──▶ nothing sent
    │a path
    ipcRenderer.send(ATTACHMENT_UPLOAD_CHANNEL, { path })   ── an argument, this time ──▶

main: ipcMain.on(ATTACHMENT_UPLOAD_CHANNEL, (event, request) => …)
  isAttachmentUploadRequest(request)?
    │true
    uploadAttachmentFile(request.path, deps)   ── same deps, same driveUpload, same terminal ──▶
    │false
  isAttachmentPasteRequest(request)?  ── the paste arm, below ──
    │false
  request !== undefined?  ──yes──▶ dropped: no filesystem call, no clipboard read, no event
    │no → the picker arm, unchanged above
```

The paste entry (#1032) joins at the same listener, tried after the path guard:

```
renderer: window.pyry.pasteAttachmentImage()   ── { source: ATTACHMENT_PASTE_SOURCE }, no path, no bytes ──▶

main: isAttachmentUploadRequest(request)?  ──false──▶  (not a path ask)
  isAttachmentPasteRequest(request)?
    false ──▶ dropped: no clipboard read, no filesystem call, no event
    │true
    readClipboardImagePng()   ── clipboard.readImage(), main process only ──▶
      null (no image) / zero bytes / reader throws  ──▶ emit refused:'no-image'
      │bytes
    driveUpload(randomUUID(), { bytes, filename: <minted>, mimeType: 'image/png' }, deps)   ── same as above ──▶
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
| Dropped `File` not backed by a path (page-constructed) | preload's empty-string check | nothing — the send never happens |
| Something other than a `File` handed to `dropAttachmentFile` | preload `try`/`catch` | nothing |
| Malformed / oversized / non-string / `__proto__` request | `isAttachmentUploadRequest` in main | nothing — no filesystem call, no event |
| Clipboard holds no image (#1032) | composition root's `isEmpty()` → `null` | `refused: 'no-image'` |
| Clipboard yields zero bytes (#1032) | `uploadClipboardImage`'s length check | `refused: 'no-image'` |
| `clipboard.readImage()`/`toPNG()` throws (#1032) | `uploadClipboardImage`'s `try`/`catch` | `refused: 'no-image'` |
| Malformed / unrecognised paste request (#1032) | `isAttachmentPasteRequest` in main | nothing — no clipboard read, no event |

Every path emits at most one event and every entry function resolves `void`; none rejects, so the
composition root's `void` calls cannot leave an unhandled main-process rejection.

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

**#890's review, also self-reviewed, PASS.** The one new untrusted→trusted crossing is the request body
itself, contained by `isAttachmentUploadRequest` above; the plan's initial containment sentence was
folded in as a SHOULD-FIX (the honest claim is *only an operator gesture mints a path-backed `File`*, not
"only a drop" — see § The request body and its guard). Repetition on the drop arm is unbounded, stated
and accepted rather than fixed, since `pickerOpen` scopes to the dialog by design — see the edge-case
note above. Full findings: `docs/specs/architecture/890-composer-file-drop.md` § Security review.

**#1032's review, self-reviewed, PASS — this is the ticket the `security-sensitive` label names.** The
one new untrusted→trusted crossing is the paste ask itself, contained by `isAttachmentPasteRequest` and
narrower than #890's: `uploadClipboardImage` reads no field off the ask at all. The finding the label is
for is the clipboard **read** capability: `src/main/index.ts`'s permission allowlist carries a standing
instruction that it must never grow to `clipboard-read`, because reading exfiltrates whatever the operator
last copied — routinely a password-manager secret. This slice doesn't touch that allowlist and grants the
renderer no permission at all; what it adds instead is a main-side handler acting on the clipboard *for*
the renderer, argued PASS on two facts: the outcome union stays content-free by construction (no member
can hold a byte, a pixel, a dimension or decoded text), and the background process reads the clipboard
itself rather than trusting anything the ask claims, so a text-flavoured secret cannot become an
attachment however the ask is forged. **What genuinely widens:** a compromised renderer can cause an
*unprompted* upload of an image the operator happens to be holding, unbounded by `pickerOpen` (scoped to
the dialog, #890's precedent) — bounded instead by the per-upload byte guard and the daemon's own
concurrency answer, and named as a residual rather than fixed. A gesture-bound ask (a confirmation, or
correlating the ask to a real key event) is the stated fallback if that residual is later judged too wide
— #1033's surface, not this one's. Full findings:
`docs/specs/architecture/1032-paste-clipboard-image-attach.md` § Security review.

## Testing

- **`src/shared/ipc/attachmentUpload.test.ts`** — the two channel constants are distinct from each other
  and from `DAEMON_EVENT_CHANNEL` / `COMMAND_CHANNEL`; the union is value-free beyond the fields listed,
  a positive walk over `Object.keys` rather than an absence assertion. **(#890)** `isAttachmentUploadRequest`
  accepts a well-formed request and one carrying extra keys; rejects `null`, `undefined`, a string, a
  number, an array, `{}`, a non-string `path`, an empty `path`, a path one over `MAX_UPLOAD_PATH_LENGTH`,
  and a `__proto__`-carrying literal built with `JSON.parse` (never as an object literal — a literal
  `{ __proto__: {...} }` creates no own key at all and would pass the guard vacuously). **(#1032)**
  `isAttachmentPasteRequest` accepts the well-formed ask and one carrying extra keys; rejects the same
  hostile shapes as above plus a wrong `source` literal, a non-string `source`, and a `{ path }` ask — and
  **mutual exclusivity is asserted in both directions**, neither guard accepting the other's ask, which is
  what keeps the discriminator sharp with three shapes on one channel. The field-walk gained the fifth
  member (proving it declares `type`/`uploadId`/`reason` and nothing else — no `limitBytes`); the stale
  `all four members` count was replaced by a compiler-forced `Record` over refusal reasons, per § The
  paste ask above.
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
  `uploadAttachmentBytes` instead, which both routes share. **(#1032)** `uploadClipboardImage` over the
  same `harness`: bytes reach the driver verbatim, `mime_type` is `image/png`, `filename` matches the
  minted pattern, `attachment_id` is a fresh UUID each call, exactly one `completed` is emitted; the three
  no-image inputs (`null`, zero-length, a throwing reader) each produce exactly one `refused`/`no-image`
  with no `limitBytes` key and the driver never called. The leak walk (`everyStringEmitted`) is an
  **exhaustive string list**, not a substring search — the first draft's `not.toContain(String(bytes
  .length))` matched a digit inside the `uploadId` by accident, so naming every string that may cross
  (`completed`, the id, the two log records' fields) replaced it, admitting nothing at all and unable to
  collide.
- **`attachmentUploadCopy.test.ts` (#1032)** — the no-image sentence is non-blank, differs from the
  too-large sentence and from every `ATTACHMENT_UPLOAD_FAILURE_COPY` value, names the clipboard, states no
  byte figure, and doesn't contain the `uploadId`; the too-large arm's shipped assertions stay green,
  proving the split didn't disturb it. See [Composer attach's copy
  section](composer-attach.md#attachmentuploadcopyts---the-copy-is-a-selection-not-a-rendering).
- **No Playwright spec for the paste entry (#1032), stated rather than skipped.** Nothing in the fake tier
  can fire `pasteAttachmentImage` — the keystroke that calls it is #1033, which adds no composer surface
  here. Driving it through `app.evaluate` would prove the composition-root join but would also clobber the
  machine's clipboard without restoring it, `e2e/message-copy.spec.ts`'s already-accepted price for that
  route; #1033 is the slice that can pay it once for the whole chain.
- **No test for `index.ts`'s wiring or the preload members, `dropAttachmentFile` and `pasteAttachmentImage`
  included (#890, #1032)** — the
  composition root and the preload are Electron-bound and untested here by existing convention; the
  path-carrying leg is proven instead by the shared guard's unit tests above plus this file's existing
  real-temp-file coverage of `uploadAttachmentFile`, since a page-built `File` in the e2e tier has no real
  path to carry across the boundary in the first place. See [Composer attach § Testing the drop
  entry](composer-attach.md) for what the e2e tier proves about the gesture itself.
- **The progress gate (#864)** — a fake driver reports arbitrary `(sent, total)` pairs before
  resolving; a transfer whose total is under `ATTACHMENT_PROGRESS_MIN_CHUNKS` emits no `progress`
  event at all (AC2); one at or above it emits `progress` then exactly one terminal (AC3); every
  emitted `progress` event carries exactly its four declared keys, walked positively.
- **A `queueMicrotask`-seeded "after the terminal" report proves the wrong thing.** The fixture for "no
  progress survives the terminal" needs reports that land once the driver has already answered. The
  first draft seeded them with `queueMicrotask`, which runs *before* the awaiting `driveUpload` resumes
  from its own `await` — so those reports arrived while the transfer was still legitimately in flight,
  and the test measured the in-flight case while claiming to measure the post-terminal one; it only
  caught the missing `terminal` guard by accident. `setTimeout(..., 0)` is the fixture that actually
  runs after the whole microtask chain that emits the terminal, and is what `reportingHarness`'s `after`
  parameter uses in `attachmentUpload.test.ts`. The general shape: a same-tick microtask callback cannot
  stand in for "after an async function's caller observed its resolution" — only a macrotask can.

## Edge cases and limitations

- **The client bound is not the daemon's bound.** A file under `ATTACHMENT_MAX_UPLOAD_BYTES` can still
  come back `attachment-too-large` from the driver — that is a `failed`, never a `refused`.
- **No per-transfer or per-read deadline.** See § Security.
- **Cancellation of an in-flight upload is not offered.** The ticket's terminal is one outcome per
  intent; a cancel affordance is a separate deliverable. The one long-lived `await` is #861's driver,
  which owns its own teardown net.
- **`pickerOpen` bounds the dialog, not the upload.** Two files can be mid-transfer at once; only a
  second *dialog* is refused while one is already open.
- **No per-transfer deadline means a withheld terminal leaves progress stuck at 100%.** A hostile or
  merely slow daemon that accepts every chunk and never answers leaves the composer reading
  `Uploading… 100%` indefinitely — the pre-existing no-per-transfer-deadline gap
  ([attachment transfer](attachment-transfer.md) § Security properties), now visible on screen instead
  of silent. Not defended here: no such hang has been observed, and inventing a timeout for it would be
  exactly the unobserved-failure-mode defence this pipeline declines by default (#864 security review).
- **The emission rate is not paced by the uplink.** `sendAttachmentChunk` calls `sendMessage`, which
  returns `void` and buffers, and nothing awaits socket drain — so up to `ATTACHMENT_MAX_UPLOAD_CHUNKS`
  `progress` events (and re-renders of the whole `Composer` subtree) can burst at scheduler cadence
  rather than spread across the transfer's wire time. Deliberately left uncoarsened: nothing has been
  observed to strain and the live-region concern that would motivate coarsening is already solved by
  the non-live element (below). A future ticket that measures real jank owns the fix, which belongs
  beside the `ATTACHMENT_PROGRESS_MIN_CHUNKS` gate in `driveUpload`'s closure.
- **Two concurrently live transfers interleave into one composer slot.** The window cannot correlate a
  click, a drop or a paste to its own upload's progress — none of `requestAttachmentUpload()`,
  `dropAttachmentFile()` or `pasteAttachmentImage()` returns anything — so a second concurrent attach's
  reports and terminal interleave with the first's in the same nullable. Shipped property of #863, made
  visible rather than introduced; neither #890 nor #1032 added correlation when they widened the channel,
  so this remains open for a future ticket to fix by having the intent return an id.
- **Repetition on the drop arm is unbounded by design (#890), and the paste arm shares the same shape
  (#1032).** `pickerOpen` bounds the dialog, not the upload, and neither arm reads or sets it — neither a
  drop nor a paste opens one. A compromised renderer can loop either sender and start many concurrent
  transfers from a single gesture. Bounded by #862's per-upload byte guard and, host-side, by the daemon's
  own concurrency answer (`attachment.too_many_uploads` → a `failed`); accepted as a self-DoS by a
  renderer that already holds the command channel, and left for a client-side concurrency cap to join
  #861's bound rather than being added here.
- **`uploadAttachmentBytes` currently has no production caller (#1032).** It was reserved for the pasted-
  image entry, but `uploadClipboardImage` calls `driveUpload` directly instead — a non-blocking SHOULD FIX
  flagged by #1032's reviewer and not yet fixed. Its docblock (and `AttachmentUploadFile`'s) still name
  #891 as the seam that enters it; nothing does. See § `src/main/attachmentUpload.ts` above.
- **Two pastes inside one second mint the same display name (#1032).** Cosmetic only — the daemon keys on
  `attachment_id`, a fresh `randomUUID` per call, never on the filename.

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
- [Composer attach](composer-attach.md) (#863) — the button and the rendered outcome, including the
  in-flight line #864 adds to it. Landed.
- `docs/specs/architecture/864-attachment-upload-progress.md` — the in-flight progress spec, including
  its security review and the two rework-leg revisions (a vacuous string-coercion test, and a
  re-render-rate figure reasoned from a clock the send loop does not have).
- [#890](https://github.com/pyrycode/pyrycode-desktop/issues/890) (drag-and-drop) — landed; the second
  entry into this flow via `uploadAttachmentFile`, riding this channel's now-optional request body. See
  § The request body and its guard above, § The bridge's `dropAttachmentFile`, and
  [Composer attach § The drop entry](composer-attach.md) for the renderer-visible half.
  `docs/specs/architecture/890-composer-file-drop.md` has the full plan and security review.
- [#1032](https://github.com/pyrycode/pyrycode-desktop/issues/1032) (paste, split from #891) — landed;
  the third entry into this flow, via `uploadClipboardImage` — not `uploadAttachmentBytes`, see the SHOULD
  FIX noted above. No composer surface of its own: the keystroke that calls `pasteAttachmentImage()` is
  [#1033](https://github.com/pyrycode/pyrycode-desktop/issues/1033), blocked by #1032 and not yet started.
  `docs/specs/architecture/1032-paste-clipboard-image-attach.md` has the full plan and security review.
