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
[Composer attach](composer-attach.md) (#863, #890). #1032 adds no renderer surface itself — the paste
keystroke that calls it, and the mount-point/predicate design, are
[Composer attach § The paste entry](composer-attach-paste.md) (#1033, landed).

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
  | { type: 'completed'; uploadId: string; filename: string }               // #1038
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
size of a file its own user just picked is far inside the blast radius #862 already accepts. **A
member that ever wanted to carry more than a count owed this paragraph a re-read** — #1038's
`completed.filename` is that member, and the re-read is below.

**`completed.filename` (#1038) is not a size, so the argument above does not simply extend to it —
three things license it instead.** *Direction:* #862's containment governs renderer→main; this field
moves main→window, telling an operator's own window what main already knows about a transfer that
operator's own gesture started, which is a disclosure question, not a validation one — the two request
guards above are untouched. *Provenance, which differs by entry:* the picker and the drop name the
file `basename(path)` — the operator's own filename, one path component, never a directory — while a
pasted image is named by `clipboardImageFilename` (`src/main/attachmentUpload.ts`): a client-owned
stem, a UTC stamp and `.png`, so that entry discloses nothing whatsoever about what the clipboard held.
*Size of the disclosure:* what a compromised renderer learns is what its own operator called a file
that operator just attached, in a window that already holds the whole conversation timeline — no host
path, no directory, no byte. It is supplied at all because the merged save leg cannot be driven
without it: `AttachmentSaveRequest` (`attachmentSave.ts`) is `{ attachmentId, filename }`, and main
does not have the name — only the renderer does, from the settled attachment in its own timeline.
`filename` is the **same** value that rode the wire, not a second, differently-bounded copy: `driveUpload`
(`src/main/attachmentUpload.ts`) trims the name to `ATTACHMENT_FILENAME_MAX_BYTES` once, into a const,
and reads that const twice — the chunk envelope and this field — so the two cannot drift the way two
independent `trimToBytes` calls could at exactly 255 bytes. It is display text whose only onward use is
the save leg, where main re-runs `sanitizeAttachmentFilename` on the value it actually builds a path
from, so nothing is stripped here. It is a single path component by construction — `basename` returns
one and a trim that cuts only between code points introduces no separator — but that is *not* the same
as "contains no separator character": `\` is a legal filename character on macOS and Linux, so a file
genuinely named `a\b.txt` yields a name containing one, and the save leg rewrites it to `_` regardless.
`filename` is required, never optional, for the `no-image` refusal's reason one member up: an optional
field renders `undefined` into a sentence instead of failing to build. Empty is representable and
unreachable — `basename` answers `''` only for a path the read guard already refuses — so a consumer
must not assume non-empty without checking. The diagnostic log is untouched: it stays content-free
exactly as before, and only the *event*-side leak walk narrows, by this one field.

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

**Every ask names its conversation, and the picker has an ask (#1205).** pyrycode#2143 made the daemon file
an upload under the conversation the chunk names and refuse one naming none, so `conversationId` is
*required* on all three asks under one rule, `hasValidConversationId` (non-empty, bounded), and the
argument-free picker intent is retired: an ask has to carry the id, so the picker names itself with a
second literal (`ATTACHMENT_PICK_SOURCE` / `isAttachmentPickRequest`) and a bare send matches no guard.
Unlike `serverId` the id is acted on — it rides every chunk — but as a claim the daemon validates against
its registry, never a capability. Sentences below saying "argument-free" or "no ask object" describe the
channel before #1205.

### The request body and its guard (#890)

```ts
export const MAX_UPLOAD_PATH_LENGTH = 4096
export interface AttachmentUploadRequest { path: string; serverId?: string }
export function isAttachmentUploadRequest(value: unknown): value is AttachmentUploadRequest
```

One field, camelCase (client-internal IPC, not a wire type) — the path of a file the operator **dropped**,
resolved in the preload by `webUtils.getPathForFile` (see § The bridge below). Extra keys are accepted and
never read, since nothing downstream rebuilds a value from anything but `path`.

**`serverId?: string` (#1129) — the last entry point to name which paired server a file is for**, and it
retired `registry.active` (`src/main/index.ts`) outright. It is checked by a module-local
`hasValidServerId(value: object): boolean`, shared by both guards on this channel, that accepts absent,
explicitly-`undefined`, or a string, and rejects anything else — the same rule `hasValidServerId` in
`src/shared/ipc/commands.ts` states for #1120's six server-scoped commands, restated rather than
imported (no production module under `src/shared/ipc/` imports a sibling). It is a routing key, never a
capability: resolved against the connection registry's held entry set by `servers.route`/`servers.resolve`
and retained as local-upload ownership only after success, reaching no filename, byte,
path component, wire field or log line. See [Daemon connection —
per-server routing § The attachment upload names its
server](daemon-connection-attachment-upload-routing.md#the-attachment-upload-names-its-server-and-the-stand-in-retires-1129)
for the full routing design, including why the refusal for an unresolvable id is surfaced as
`not-connected` rather than a dedicated failure literal.

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
export interface AttachmentPasteRequest { source: typeof ATTACHMENT_PASTE_SOURCE; serverId?: string }
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
`AttachmentPasteRequest` carried no information beyond which entry fired until #1129; `uploadClipboardImage`
(below) still reads no field off it at all — the routing key is read at the composition root, never inside
the flow module. **The two guards are tried path-first in the main listener** — see §
Composition root.

**#1129 widens this ask by one field, `serverId?: string`, and that is a genuine tension with "nothing
else" rather than a free addition — the docblock says so and amends itself in place.** The ask's central
security property was never *literal emptiness*; it was that nothing renderer-supplied reaches *a
filename, a byte or the wire*. A routing key is none of the three — `hasValidServerId` (§ The request
body and its guard, above) is the whole of its rule, and it is resolved against the registry's held
entry set and discarded, the same as on the drop ask. What is conceded, named rather than glossed: a
compromised renderer can now choose *which already-paired* server receives a pasted image, where before
it always landed on whichever host was paired most recently — it still cannot reach a server the
operator never paired. The amendment is made in the three places the old "nothing else" sentence was
asserted, all at once, so the repo does not end up contradicting itself in some but not all of them:
this docblock, `pasteAttachmentImage`'s (`src/preload/index.ts`) "takes no argument at all", and
`pasteImage`'s (`src/renderer/src/screens/conversation/ComposerAttach.tsx`) "IT CARRIES NOTHING" —
plus, found on a sweep for the property's other spellings after the fact, the module header's two
restatements above and `attachmentUpload.test.ts`'s extra-keys acceptance, which asserted the stronger
"nothing downstream reads *any* field off this ask", now false as written. Six sites in total, not
three. Neither shipped sender emits the field yet — see [Daemon connection — per-server routing § The
attachment upload names its
server](daemon-connection-attachment-upload-routing.md#the-attachment-upload-names-its-server-and-the-stand-in-retires-1129)
for why, and for the picker arm, which has no ask object at all and so never carries one.

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
the no-op; otherwise `void uploadAttachmentFile(picked, pickerDeps)`, safe as a bare `void` because the
callee never rejects. `ipcMain.on` registers the listener; `app.on('will-quit', ...)` removes the exact
listener, symmetric with the rest of the app's `ipcMain` registrations.

**One listener, three arms (#890, #1032, #1129).** `attachmentUploadListener` reads a second,
`unknown`-typed parameter — `unknown` because the renderer is untrusted at this boundary regardless of
any declared type. The two guarded shapes are tried **path-first**, and the ordering is load-bearing
rather than stylistic: `isAttachmentUploadRequest(request)` is tried before `isAttachmentPasteRequest(request)`,
so an ask carrying a valid `path` reaches the drop arm exactly as it did before a third shape existed,
extras included — nothing an operator can produce changes arm now that a second guarded shape is
accepted. A passing drop request calls `uploadAttachmentFile` with the path and deps retaining it;
a passing paste request calls `uploadClipboardImage` with deps carrying the owner but no local path
(below). An ask that carried something and matched neither guard is dropped outright — no filesystem
call, no clipboard read, no event, and deliberately no log, denying a looping renderer a way to drive
the main-process logger — and, since #1129, no `buildDeps` call either, so it cannot reach
`servers.resolve`'s own logging. `isAttachmentPickRequest` selects the picker arm. After the dialog succeeds,
its selected path and requested owner supply `buildDeps`; cancellation builds nothing. **`pickerOpen` stays scoped to the dialog**: neither the drop arm nor the
paste arm opens one, so neither reads nor sets that flag, and several transfers may be live at once (one
per arm, or several drops, or several pastes) by this flow's existing design.

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

**The `deps` object, one per ask rather than one per arm — a shape #1032 established by hoisting it and
\#1129 kept while changing what it is.** Two entries each building their own `deps` closure is the shape
that lets "one driver, one outcome channel" drift into two: a future edit to how progress is forwarded,
or which channel an outcome lands on, would have to be made twice and could land once. `event.sender` is
still closed in for [#519](https://github.com/pyrycode/pyrycode-desktop/issues/519)'s reason, and the
`emitDaemonEvent`-style `sender.isDestroyed()` guard is unchanged.

**The per-ask factory is `buildDeps(serverId, conversationId, localPath?)`, a factory
called exactly once per ask, from *inside* whichever arm the ask selects.** The deps now depend on the
ask's resolved server, which is knowable only once an arm has matched, so a single object built at
listener-construction time could no longer express them. This is *stronger* than the old hoisted
literal, not weaker: there is still exactly one construction site and one call per ask, and having one
body rather than one object makes it structurally impossible for two arms to be handed differently-built
`emit`s. It is also a security property, not a style choice: `buildDeps`'s `upload` calls
`servers.resolve(serverId)`, which logs `server-route-refused` on both of its refusal branches, so calling
it before the guards discriminate would hand a looping renderer the exact lever the neither-guard-matched
return above exists to deny. See [Daemon connection — per-server routing § The attachment upload names
its
server](daemon-connection-attachment-upload-routing.md#the-attachment-upload-names-its-server-and-the-stand-in-retires-1129)
for the routing decision `buildDeps`'s `upload` arrow makes, including why an unresolvable route reports
`not-connected` rather than a dedicated failure literal.

## Bridge — `src/preload/index.ts`

Four members on the existing `api` literal (#1032 added the fourth; #1205 gave the first three a
`{ conversationId }` argument): `requestAttachmentUpload({ conversationId }): void` (fire-and-forget
`send` of a self-named pick ask), `dropAttachmentFile(file: File, { conversationId }): void` (#890,
below), `pasteAttachmentImage({ conversationId }): void` (#1032, below), and `onAttachmentUploadEvent(listener):
() => void` (the `onDaemonEvent` shape — strips the raw `IpcRendererEvent`, returns an unsubscribe handle
that removes the exact handler). All four are called from [Composer attach](composer-attach.md) (#863's
button and outcome view, #890's drop handler, #1033's paste handler).

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

All three asks carry a conversation ID and optional server ID. Main tries the drop,
paste and picker guards in that order; malformed asks do nothing. The picker gate
covers the dialog only and clears before file reading or upload begins.

```text
picker → selected path ─┐
drop → preload path ────┴→ uploadAttachmentFile → open → stat regular file/size → read
paste → main clipboard → PNG bytes ────────────────────────────────────────────┐
                          guarded local bytes ─────────────────────────────────┤
                                                                              ↓
                         driveUpload: client UUID, bounded filename, MIME type
                                                                              ↓
                         buildDeps.upload: resolve server, capture upload owner
                                                                              ↓
                         connection.uploadAttachment → progress → terminal
                           ok + local path → remember original → completed
                           ok + paste      → completed without registration
                           failure         → failed without registration
```

A cancelled picker emits nothing. Read failures emit `unreadable`, oversized files
emit `refused: too-large`, and absent/empty clipboard images emit `refused: no-image`.
See [the guard and drive](attachment-upload-guard-and-drive.md) for byte and progress
bounds and [the bridge](#bridge--srcpreloadindexts) for the drop's path-backed `File` check.

Successful picker/drop uploads register the absolute original path in
`createLocalAttachments` (`src/main/localAttachments.ts`), constructed once in main
([#1524](https://github.com/pyrycode/pyrycode-desktop/issues/1524)). Before awaiting the
transfer, the upload seam captures the client-created attachment ID, input conversation
ID and actual server returned by `servers.resolve`, including an unnamed sole host.
Only `ok` with a local path and resolved server records an association. Paste, cancelled,
refused, failed and thrown uploads cannot register; subsequent chat/host selection
cannot change the captured owner. First registration wins for an attachment ID.

The map survives chat and window navigation for this main-process lifetime, with no
persistence. Paths never return to the renderer, enter the wire or appear in logs;
filenames neither register nor select them. Activation uses the current contents at
that path, not a snapshot of the uploaded bytes. Earlier-run attachments retain the
fallback described in [attachment open](attachment-open.md#the-driver--srcmainattachmentopents)
and [attachment save](attachment-save.md#2-the-copy-driver--srcmainattachmentsavets).

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

**#1129's review, self-reviewed, PASS.** The one new untrusted→trusted crossing is `serverId` on both
guarded asks, contained by `hasValidServerId` and then looked up (never trusted) against the connection
registry's held entry set — `connectionFor` is an array scan with `===`, never an object-key access, so
`__proto__`/`constructor`/`toString` are ordinary non-matching strings there, not a prototype-pollution
path. **What genuinely widens:** a compromised renderer gains the ability to choose *which
already-paired* server receives a dropped or pasted file, where before it always got whichever host was
paired most recently — it does not gain the ability to reach a server the operator never paired. Accepted
on the same grounds #1118 and #1120 already accepted the same choice for every conversation- and
server-scoped command. `serverId` reaches no path segment, no filename, no map key and no log field —
`DiagnosticEvent` stays `{ event, code? }`, so a server id is structurally unrepresentable there. Full
findings: [Daemon connection — per-server routing § The attachment upload names its
server](daemon-connection-attachment-upload-routing.md#the-attachment-upload-names-its-server-and-the-stand-in-retires-1129)
and `docs/specs/architecture/1129-attachment-upload-server-routing.md` § Security review.

## Testing

Split into its own document because folding #1129's routing-key coverage into this section pushed the
parent over the size cap: see [Attachment upload — testing](attachment-upload-testing.md) for the full
detail — the channel-contract guard tests including #1129's routing-key describe, the flow-module
tests, the copy tests, the progress-gate tests and the e2e proof.

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
- **Two pastes inside one second mint the same display name (#1032), and since #1038 the window can see
  it.** Cosmetic only — the daemon keys on `attachment_id`, a fresh `randomUUID` per call, never on the
  filename — but a rapid double-paste now surfaces two identically-named completions to a renderer,
  where before neither carried a name at all.
- **`completed.filename` ships with no consumer (#1038).** `attachmentUploadCopy.ts`'s `completed` arm
  still returns a constant; #1039 is the first consumer, and inherits the layout bound and the
  non-empty assumption named in the `completed` arm's own docblock.
- **Every sender names a server now.** `useAttachmentUpload` (`ComposerAttach.tsx`) reads the open
  chat's host off the conversation list at the gesture, through `attachmentAskTarget`, and the three
  preload senders forward it. The unnamed path survives only for a chat the list does not hold: the
  sole connection with one paired server, a refusal with more than one. Before this the senders sent
  no id, waiting on #1086, and an operator with two hosts paired could not attach at all — the router
  refused every ask as `ambiguous-server`, rendered as the `not-connected` sentence.

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
  [Composer attach § The drop entry](composer-attach-drop.md) for the renderer-visible half.
  `docs/specs/architecture/890-composer-file-drop.md` has the full plan and security review.
- [#1032](https://github.com/pyrycode/pyrycode-desktop/issues/1032) (paste, split from #891) — landed;
  the third entry into this flow, via `uploadClipboardImage` — not `uploadAttachmentBytes`, see the SHOULD
  FIX noted above. No composer surface of its own: the keystroke that calls `pasteAttachmentImage()` is
  [Composer attach § The paste entry](composer-attach-paste.md) (#1033, landed).
  `docs/specs/architecture/1032-paste-clipboard-image-attach.md` and
  `docs/specs/architecture/1033-paste-image-to-attach.md` have the full plans and security reviews.
- [#1038](https://github.com/pyrycode/pyrycode-desktop/issues/1038) — landed; the `completed` arm gains
  a required `filename`, the missing supply for [Attachment save](attachment-save.md)'s
  `AttachmentSaveRequest`. Ships with no consumer — #1039 wires it.
  `docs/specs/architecture/1038-completed-upload-carries-the-display-name.md` has the full plan and
  security review.
- [Daemon connection — per-server routing](daemon-connection-routing.md) (#1129) — landed; both guarded
  asks gain an optional `serverId`, `buildDeps` becomes a per-ask factory, and `registry.active` is
  retired with no consumer left anywhere in the composition root. `docs/specs/architecture/1129-attachment-upload-server-routing.md`
  has the full plan and security review.
