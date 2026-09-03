# #814 — Save an attachment into the Downloads folder without a dialog

A renderer names an attachment identifier and a display file name; the background process resolves the
identifier inside the app's own attachment directory, reduces the name to one safe path component,
copies the file into the operating system's Downloads folder without a save dialog under a
collision-free name, and reveals it in the OS file manager with the file selected. Exactly one terminal
outcome goes back to the window that asked.

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/main/attachmentPath.ts` → `resolveAttachmentPath`, `ResolveAttachmentPathResult` | The identifier → path gate this ticket consumes verbatim. Its header forbids a second escape check, which is why nothing here re-validates the identifier. |
| `src/main/attachmentFilename.ts` → `sanitizeAttachmentFilename`, `FALLBACK_FILENAME` | The untrusted-name → one-component rewrite. Its header names *this* ticket as the caller that must re-run it main-side on the value the path is actually built from. |
| `src/main/attachmentStore.ts` → `storeAttachment`, `ATTACHMENT_DIR_NAME` | Establishes where the source file lives: a flat, extension-less child of `join(userData, ATTACHMENT_DIR_NAME)` named by the identifier. Also the precedent that the returned path is a return value, never something to forward or log. |
| `src/main/saveDebugBundle.ts` → `saveDebugBundle`, `candidateName`, `isErrnoException` | The exclusive-create collision loop this ticket restates with `COPYFILE_EXCL` instead of `flag: 'wx'`. The `EEXIST` → next-candidate → best-effort-unlink-then-rethrow shape is copied. |
| `src/shared/ipc/attachmentRetrieval.ts` → `ATTACHMENT_RETRIEVAL_CHANNEL`, `isAttachmentRetrievalRequest`, `AttachmentRetrievalEvent` | The channel-pair precedent: own pair rather than a `DaemonEvent` member, a shape guard on the untrusted ask, a closed union of client-owned literals. |
| `src/main/attachmentRetrieval.ts` → `createAttachmentRetrieval` | The Electron-free driver shape: injected deps, static log codes, one terminal per ask, never rejects. |
| `src/main/index.ts` → `setWindowOpenHandler` (in `createWindow`), the `downloadsDir` read beside `createDebugBundleDownload`, `attachmentRetrievalListener` | The composition root. The `file:` deny stays untouched; `app.getPath('downloads')` is already read here; the retrieval listener is the registration/teardown shape this one mirrors. |
| `src/preload/index.ts` → `requestAttachment`, `onAttachmentRetrievalEvent` | The bridge pair this ticket adds a sibling to: a fixed channel, `ipcRenderer` never crossing, the raw `IpcRendererEvent` stripped. |
| `src/main/diagnosticLog.ts` → `DiagnosticEvent` | The content-free field allowlist. `event` + `code` are the only fields this feature can honestly fill. |
| `docs/knowledge/features/attachment-filename-sanitiser.md` § "Non-goals" | Records that the no-length-bound decision is deliberate and that an over-long name is *expected* to surface as `ENAMETOOLONG` from this ticket's write — the lesson that shapes AC 5's test rather than adding a truncation here. |
| `docs/knowledge/features/attachment-path-resolution.md` § "Containment is structural" | Names the conditions that would put a `realpath` check back on the table — one of them is "a consumer that opens a path it did not resolve through this module". This ticket opens only what it resolved, so the reasoning survives. |
| `docs/knowledge/features/save-debug-bundle.md` | The sibling save feature's shipped posture (never creates the directory, never overwrites, emits no logs). |

## Design source

**Figma:** N/A — this ticket adds no UI. It is a shared IPC contract, a main-process filesystem module,
and two composition-root edges. The file row that calls this channel is #815/#816 and carries its own
Figma anchor. The visual-fidelity check is intentionally skipped.

## Context

#996 landed the retrieval leg: an attachment fetched from the host is written to an app-private
directory under Electron's per-user app-data location, as a flat, extension-less file named by its
identifier. Nothing yet gets one of those files out to somewhere a person can see it. This ticket is
that step, and it is the last one of #686's family that has no consumer: #815 draws the file row and
#816 makes it the control that calls this channel.

The operator decided on 2026-08-22 that there is **no save dialog** — the file lands in the OS Downloads
folder directly and the folder is then opened with the file selected. That decision is what makes this a
main-process filesystem module rather than a `dialog.showSaveDialog` wrapper, and it is what makes the
name question below load-bearing: with no dialog, nothing asks a human what the file should be called.

**Where the saved name comes from.** Main does not have it. The retrieval leg deliberately never keeps
it — `attachmentReassembler` never reads `filename` or `mime_type` at all, the stored file is
extension-less on purpose, and `AttachmentRetrievalEvent` is content-free by construction. The renderer
does have it, from the settled attachment in the timeline. So the name crosses the bridge as untrusted
renderer-supplied text and main re-runs `sanitizeAttachmentFilename` on the value it actually builds the
path from. This is exactly the crossing `attachmentFilename.ts`'s header anticipates. The name is
**display-derived, not addressing**: the bytes are selected by the identifier alone, so a wrong or
hostile name saves the right file under a poor name, never a different file.

**No ADR is owed.** Every decision here is an application of one already recorded — #818's refuse-don't-rewrite
gate, #819's rewrite-don't-refuse sanitiser, and `saveDebugBundle`'s exclusive-create no-overwrite rule.
The documentation phase should fold this slice into a package overview, not a decision record.

**Size.** The refiner's estimate is ~1200 lines across 4 production files. That is over the 800-line
guidance and is being built as one ticket anyway, stated here rather than buried: every other line of
the size table holds comfortably (4 production files of 5, 0 existing call sites to update, 5 acceptance
criteria, 4 error branches, 4 new exported types), and the only available split — the shared contract as
one child, the copy module as the other — produces a child whose sole consumer is its sibling, which the
sizing floor says is not a ticket. Split depth was checked: parent #686, no grandparent, so a split was
permitted and was declined on the floor rule, not on the depth cap.

## Design

Three pieces, matching the retrieval leg's shape one-for-one.

### 1. `src/shared/ipc/attachmentSave.ts` — the contract (new)

A sibling to `attachmentRetrieval.ts`, **not a `DaemonEvent` member**, for that module's own recorded
reason: four renderer bridges end their `DaemonEvent` switch in `assertNever`, so a member there is a
compile error in four unrelated files for four no-op arms.

```ts
export const ATTACHMENT_SAVE_CHANNEL = 'pyry:attachment-save'
export const ATTACHMENT_SAVE_EVENT_CHANNEL = 'pyry:attachment-save-event'
export const MAX_SAVE_IDENTIFIER_LENGTH = 256
export const MAX_SAVE_FILENAME_LENGTH = 4096

export interface AttachmentSaveRequest { attachmentId: string; filename: string }
export function isAttachmentSaveRequest(value: unknown): value is AttachmentSaveRequest

export type AttachmentSaveFailure = 'source-unavailable' | 'save-failed'
export type AttachmentSaveEvent =
  | { type: 'saved'; attachmentId: string }
  | { type: 'failed'; attachmentId: string; reason: AttachmentSaveFailure }
```

Two channels rather than an `invoke`, mirroring retrieval: the terminal arrives after a resolve, a
sanitise, a bounded copy loop and a reveal, and the pair keeps the two directions unconfusable. No path
and no directory crosses in either direction — the request carries an identifier and a display name, the
event carries the identifier back and a client-owned literal.

`isAttachmentSaveRequest` is `isAttachmentRetrievalRequest`'s posture: **shape only, not canonicity**
(`resolveAttachmentPath` is the single gate and a second divergent check ends with one of them being
weaker), non-empty on both fields, `in`-guarded property reads on a narrowed `object` so a
`__proto__`-built ask has no own property to find, and bounded on both fields.

**The two bounds differ in kind and both need their reason stated.**
`MAX_SAVE_IDENTIFIER_LENGTH` is `MAX_RETRIEVAL_IDENTIFIER_LENGTH`'s argument minus the envelope clause —
this ask never reaches the wire, so the bound is boundary hygiene, and the real ceiling is
`resolveAttachmentPath`'s 64-character alphabet.
`MAX_SAVE_FILENAME_LENGTH` is a **drop** bound at an untrusted boundary, **not** the truncation the
sanitiser's non-goals forbid: nothing here shortens the name that becomes the path component. It exists
because `sanitizeAttachmentFilename` walks its input code point by code point, so an unbounded string
from a compromised renderer is a main-process stall, which is `MAX_PASTE_LENGTH`'s reason for existing
one channel over. 4096 sits an order of magnitude above every filesystem's 255-byte `NAME_MAX`, so the
`ENAMETOOLONG` outcome AC 5 names stays reachable for every name that could plausibly arrive.

**Two failure reasons, and the boundary between them.** `'source-unavailable'` means no readable source
file could be addressed by this identifier — a refused identifier, an absent file, an unreadable one —
and it is the one a consumer can act on by fetching the attachment (#996) and retrying.
`'save-failed'` is everything else: `ENAMETOOLONG`, a permission or space failure, an exhausted
candidate count. `ENAMETOOLONG` gets no member of its own; the ticket's technical notes are explicit that
it is the same errno shape as any other failed copy and therefore a test case, not new behaviour.

### 2. `src/main/attachmentSave.ts` — the copy (new)

```ts
export const MAX_SAVE_ATTEMPTS = 10_000

export interface AttachmentSaveDeps {
  attachmentDir: string                  // trusted, from the composition root
  downloadsDir: string                   // trusted, from the composition root
  reveal: (path: string) => void         // shell.showItemInFolder, closed in at the root
  diagnosticLog?: DiagnosticLog
}

export function createAttachmentSave(
  deps: AttachmentSaveDeps
): (request: AttachmentSaveRequest) => Promise<AttachmentSaveEvent>
```

`electron` is never imported — both Electron touches are injected, which is `saveDebugBundle`'s and
`attachmentStore`'s composition-root seam and what keeps this module unit-testable against a temp
directory. The returned function **never rejects**; that is a property of the module, not of a `.catch()`
a future caller must remember, and it is what licenses the bare `void` at the edge. Returning the
terminal as a resolved promise rather than taking an `emit` is the one departure from
`createAttachmentRetrieval`, and it is bought by this flow having no cross-ask state to hold: exactly one
terminal per ask is then structural (a promise settles once) rather than an invariant to maintain.

Flow, in order:

1. `resolveAttachmentPath(attachmentDir, request.attachmentId)`. A refusal answers
   `failed / 'source-unavailable'` **before any filesystem call**, which is AC 1's second sentence.
2. `sanitizeAttachmentFilename(request.filename)` — main-side, on the value the path is built from. The
   raw name is never joined to anything.
3. The copy loop, below.
4. `reveal(savedPath)` on success only.

**The copy loop** is `saveDebugBundle`'s, with `copyFile(source, candidate, COPYFILE_EXCL)` in place of
`writeFile(..., { flag: 'wx' })`. That single syscall is both the no-overwrite guarantee and the
collision-race close, with no `existsSync`-then-write TOCTOU gap. On `EEXIST` the loop advances to the
next candidate **without unlinking** — that file is not ours. On any other errno it best-effort-unlinks
the partial destination (AC 5's "nothing partial is left in Downloads") and stops. `MAX_SAVE_ATTEMPTS`
is loop-termination insurance, not a defence against an observed attack, and exhausting it is a
`'save-failed'`.

Candidate naming is browser-style, from `saveDebugBundle`'s `candidateName`: `n === 0` yields the
component verbatim, `n >= 1` yields `stem (n)ext`. The stem/extension split is at the **last** dot when
its index is greater than 0, so `archive.tar.gz` → `archive.tar (1).gz` (Chrome's answer) and a
component with no dot gets the suffix appended whole. Index 0 is unreachable — `sanitizeAttachmentFilename`
guarantees the component never begins with `.` — and the `> 0` test is what makes that guarantee's loss
harmless rather than a hidden hidden-file bug.

**Error → reason mapping**, with one conflation stated honestly: `ENOENT` answers `'source-unavailable'`,
everything else answers `'save-failed'`. `copyFile` also reports `ENOENT` when the *destination*
directory is missing, so an absent Downloads folder is reported as if the source were absent. That is
accepted rather than repaired: distinguishing the two needs a check-then-act on a path, the mis-report
costs a consumer one wasted re-fetch, and `app.getPath('downloads')` returning a directory that does not
exist is a pathological environment. It is pinned by a test so the behaviour is recorded, not assumed.

**Logging** is `attachmentRetrieval`'s: one static event name and a static `code` per outcome
(`started`, `saved`, `source-unavailable`, `save-failed`). Neither the file name nor any path nor an
errno reaches a record — "sanitised" does not mean "safe to log", and a file name is often private in
itself.

**The reveal cannot fail the save.** It runs inside a `try`/`catch` whose `catch` still answers `saved`:
the bytes are on disk by then, and reporting a save failure that did not happen would be a lie the
window acts on. This is the same "never rejects" obligation applied to the one injected effect.

### 3. The edges

`src/preload/index.ts` gains `saveAttachment(request)` (fire-and-forget on the fixed channel) and
`onAttachmentSaveEvent(listener)` (subscription returning an unsubscribe handle, raw `IpcRendererEvent`
stripped) — `requestAttachment` / `onAttachmentRetrievalEvent` verbatim in shape.

`src/main/index.ts` reuses the `downloadsDir` already read for the debug bundle and the `attachmentDir`
already joined for the retrieval store, so **no new `app.getPath` call is added**; `shell` is already
imported for `openExternal`. The listener is `attachmentRetrievalListener`'s: guard the untrusted ask and
**drop** a malformed one (no event, no filesystem call, no folder opened — AC 1), close `event.sender`
into the reply, guard `isDestroyed()`, register with `ipcMain.on`, remove on `will-quit`.

`setWindowOpenHandler` is **not touched**. Its `file:` deny is why this feature needs its own channel:
the reveal is a main-process `shell.showItemInFolder` call on a path main computed, never a URL the
window supplied.

## State + concurrency model

There is none to hold. Each ask is an independent bounded copy with no cross-ask state, no wire traffic,
no accumulating buffer and no timer, so — unlike `createAttachmentRetrieval` — there is no in-flight map,
no concurrency cap and no coalescing. `createAttachmentSave` still returns a closure rather than a bare
function so the three trusted values are bound once at the composition root instead of being threaded
through every call.

Concurrent saves of one attachment under one name are correct without coordination: each `copyFile` is
exclusive-create, so the loser sees `EEXIST` and advances, and two clicks produce `report.pdf` and
`report (1).pdf` rather than a torn file. There is nothing to cancel on window close — a copy is short,
owns no listener and no socket — and a window that closes mid-save drops the terminal at the
`isDestroyed()` guard, the same loss the retrieval and upload edges already take.

## Error handling

| Failure | Where it is detected | Reported as |
|---|---|---|
| Malformed ask (wrong shape, empty field, over-long field) | `isAttachmentSaveRequest` at the edge | **Dropped** — no event, no filesystem call |
| Non-canonical identifier | `resolveAttachmentPath`, before any filesystem call | `failed / 'source-unavailable'` |
| Source file absent or unreadable | `copyFile` → `ENOENT` | `failed / 'source-unavailable'` |
| Downloads folder absent | `copyFile` → `ENOENT` (the stated conflation) | `failed / 'source-unavailable'` |
| Over-long name | `copyFile` → `ENAMETOOLONG` | `failed / 'save-failed'` |
| Any other copy errno | `copyFile` | `failed / 'save-failed'`, after a best-effort unlink |
| Candidates exhausted | the loop bound | `failed / 'save-failed'` |
| Reveal throws | the injected `reveal` | `saved` — the file is on disk |

No errno, no path and no file name reaches the event or the log. The caught object is dropped rather
than inspected, because a `node:fs` `ErrnoException` carries the offending path in its own message.

## Testing strategy

Unit tier only, per the ticket: a main-process filesystem module plus a boundary guard, both directly
unit-testable the way `saveDebugBundle.test.ts` and `attachmentStore.test.ts` are. Renderer specs here
are static server renders with nothing that can click, and this slice has no renderer surface at all, so
no renderer or Playwright coverage is owed.

`src/shared/ipc/attachmentSave.test.ts` — the guard, in `attachmentRetrieval.test.ts`'s register:
non-object / `null` / array asks refused; each field missing, wrong-typed, empty, and one over its bound;
an ask built with `JSON.parse` so `__proto__` is an own key (a `__proto__` *literal* creates no own
property and would be an inert fixture that passes while proving nothing); extra keys accepted, because
the main side rebuilds nothing from them; the two channel constants distinct from each other and from the
retrieval pair.

`src/main/attachmentSave.test.ts` — against `mkdtemp` directories, one for the attachment store and one
standing in for Downloads:
- copies the resolved file into Downloads under the sanitised name, returns `saved`, and reveals exactly
  that absolute path
- a hostile display name (`../../etc/passwd`) lands as one sanitised component inside Downloads, and the
  parent of Downloads is untouched
- three saves of one name yield `report.pdf`, `report (1).pdf`, `report (2).pdf`, each with its own bytes
  and the first intact
- a file already in Downloads under the target name is never overwritten
- `archive.tar.gz` collides to `archive.tar (1).gz`
- a non-canonical identifier answers `source-unavailable` and leaves Downloads **empty** — the assertion
  that "before any filesystem call" is real
- an absent source answers `source-unavailable`
- a 300-character name answers `save-failed` and leaves nothing in Downloads
- an absent Downloads directory answers `source-unavailable`, the stated conflation, pinned
- `reveal` is not called on any failure path
- every failure path resolves rather than rejects
- the diagnostic records carry static codes only, and no record's JSON contains the fixture file name,
  the identifier, or a path separator
- a module-graph assertion in `attachmentFilename.test.ts`'s style: the source imports no `electron` and
  contains no `console.` call

## Open questions

1. **Should a save be coalesced or concurrency-capped like a retrieval?** Resolved: no. Retrieval caps
   because an unbounded fan-out voids a per-transfer memory bound; a copy streams kernel-side and
   accumulates nothing in this process. A cap here would also break the legitimate "save the same
   attachment twice under two names" case that AC 3's suffix sequence exists to serve.
2. **Should `ENAMETOOLONG` be its own reason?** Resolved: no, per the ticket's technical notes.
3. **Does the browser-style suffix belong before or after the extension?** Resolved: before, at the last
   dot — Chrome's answer, and the one that keeps the OS handler association the extension carries.

## Security review

**Verdict:** PASS (no MUST FIX)

### 1. Trust boundaries

Two untrusted values cross one boundary — `ipcMain.on(ATTACHMENT_SAVE_CHANNEL)` — and each has exactly
one gate, both pre-existing and consumed verbatim: `attachmentId` → `resolveAttachmentPath`,
`filename` → `sanitizeAttachmentFilename`. No second escape check is added, per that module's header.
`attachmentDir` and `downloadsDir` are trusted and carry the same `string` type as the untrusted values,
so the distinction lives in `AttachmentSaveDeps`' docblock — `resolveAttachmentPath`'s own posture for the
same problem, not a new weakness. **SHOULD FIX (Phase B):** make the raw name structurally unreachable
past step 2 — the copy helper takes an already-sanitised `component: string`, never the request — so the
bypass `attachmentFilename.ts`'s header warns about (building a path from the raw field) requires editing
two functions rather than one line.

### 2. Tokens, secrets, credentials

No token, key, or credential is read, written, or derived. Stronger than N/A: the user's file **bytes
never enter this process's memory** — `copyFile` is a kernel-side copy, where `storeAttachment` had to
hold the whole buffer. There is no new at-rest secret and no `safeStorage` decision to make.

### 3. File / storage operations

- **Traversal** is structurally impossible on both inputs: `resolveAttachmentPath`'s alphabet admits no
  `.`, `/`, `\` or `:`, and `sanitizeAttachmentFilename`'s positive allowlist admits no separator.
- **TOCTOU: none, by construction.** There is no `existsSync`-then-write anywhere. `COPYFILE_EXCL` is
  `O_CREAT|O_EXCL`, so the collision check and the create are one syscall.
- **A pre-planted symlink in Downloads cannot be written through.** `O_CREAT|O_EXCL` fails `EEXIST` on an
  existing path even when it is a dangling symlink, so a `report.pdf` symlink aimed at `~/.ssh/…` yields
  `EEXIST`, the loop advances, and nothing follows it. This matters more here than for the debug bundle:
  Downloads is the folder most likely to already hold attacker-supplied content.
- **A symlink at the SOURCE is followed**, so an attacker who can write inside
  `join(userData, 'attachments')` could redirect one save to an arbitrary readable file. Deferred on
  `attachment-path-resolution.md`'s recorded reasoning: that write access already suffices to replace the
  secret-store ciphertexts, so this is strictly weaker than what such an attacker holds. The trigger to
  revisit is the one that overview names — an attachment directory shared between principals.
- **Permissions.** `copyFile` gives the destination the source's mode, and `storeAttachment` writes
  `0o600`, so the Downloads copy is owner-only rather than umask-derived. That is the fail-safe direction;
  it is not widened here, and a test pins it so the inheritance is a recorded property rather than an
  accident.
- **Partial state.** A non-`EEXIST` errno best-effort-unlinks the destination. A `SIGKILL` mid-copy can
  still leave a partial file — out of scope, and the same exposure `saveDebugBundle` and every other write
  in this repo carries.

### 4. Inter-process / Electron attack surface

`webPreferences` is untouched (`sandbox: true`, `contextIsolation: true` already), no remote content is
loaded, and **`setWindowOpenHandler`'s `file:` deny is not weakened** — that block is why this feature gets
its own channel: the reveal is a main-process `shell.showItemInFolder` on a path *main computed*, never a
URL the window supplied. The bridge exposes two functions on two fixed channels; `ipcRenderer` never
crosses, and the raw `IpcRendererEvent` is stripped before the listener runs.

The capability this grants a **compromised renderer** is: copy files from one app-private directory into
Downloads under names it chooses, and open a file-manager window. Concretely that is unbounded disk
consumption (each ask writes a fresh suffixed copy of up to `ATTACHMENT_MAX_RETRIEVAL_BYTES`) plus libuv
threadpool occupancy. **OUT OF SCOPE, deliberately and not by omission:** a concurrency cap — the shape
`createAttachmentRetrieval` uses — would bound instantaneous parallelism and *not* total volume, because
the same attacker simply paces its asks. It would read as a defence while closing nothing. A real answer
is a per-session write budget across every channel that writes to disk, which no acceptance criterion
describes and which belongs at the edge for all of them at once. `saveDebugBundle`, an unbounded-repeat
user-triggered write into the same folder, carries no such bound either. Revisit if a volume budget is
ever specified, or if this channel becomes reachable from anything but a person's click.

The failure union is a **one-bit existence oracle** ("is attachment X cached on this machine"). Bounded to
be uninteresting by `resolveAttachmentPath`'s alphabet: the renderer can probe only
`[0-9a-f-]{1,64}` names inside one app-private directory, all of them this same user's own attachments,
and it already knows which ones it fetched.

### 5. Cryptographic primitives

None used, and one deliberate absence: the stored file's digest is **not** re-verified at save time. #995
verified it before the bytes were stored, and re-checking here would require the expected digest to cross
the bridge — adding an untrusted value that decides whether a file is presented as good. `randomBytes` is
not needed either; the candidate suffix is a counter, and unguessability is not a property this loop
needs (`COPYFILE_EXCL` supplies the safety that `storeAttachment`'s unguessable temp name supplies there).

### 6. Network & I/O

No socket, no wire frame, no timeout, no reconnect. The only I/O is one `copyFile` per ask on the libuv
threadpool, so a large file cannot stall the main thread. Threadpool occupancy under a spammed channel is
the same finding as § 4 and shares its disposition.

### 7. Error messages, logs, telemetry

- The event union's `reason` is a closed set of two literals written in this repo, so an event provably
  carries no path, errno, or file name. The caught error object is **dropped, never inspected** — a
  `node:fs` `ErrnoException` carries the offending path in its own message.
- Diagnostic records carry `event` + a static `code` only. `DiagnosticEvent` has no index signature and no
  field shaped to hold a name, so this is enforced by the type at the call site, not by discipline.
- **SHOULD FIX (Phase B): do not inherit `saveDebugBundle`'s exhaustion message.** That module throws
  ``new Error(`… no free filename after ${MAX_ATTEMPTS} attempts in ${dir}`)`` — it interpolates the
  directory. Copying the precedent verbatim would build a string carrying a path, one `console.error` away
  from the leak AC 5 forbids. This module never throws; exhaustion returns `'save-failed'` and no such
  message is constructed at all.
- The never-log rule is closed **deterministically, not by comment**: the module-graph test asserts the
  source contains no `console.` call, the same fabric `attachmentFilename.test.ts` uses.

### 8. Concurrency

No long-lived task, no timer, no `AbortController` to thread, and no shared mutable state, so there is no
check-then-act race and nothing to cancel. The single `ipcMain.on` listener is removed on `will-quit`,
symmetric with its siblings. A save still in flight when the window closes resolves into the
`isDestroyed()` guard and drops its terminal — the same loss the retrieval and upload edges already take.
Concurrent saves need no coordination: exclusive-create makes the loser advance a candidate rather than
tear a file.

### 9. Threat model alignment

- **Hostile daemon / compromised host.** The one protocol-level threat that reaches this ticket: the
  saved *name* originates on the wire, model-chosen. It is bounded to one ASCII path component by
  `sanitizeAttachmentFilename`, run main-side on the value the path is built from. The name selects
  nothing — the bytes are addressed by identifier alone — so a hostile name saves the right file badly
  named, never a different file.
- **Extension spoofing / macOS quarantine — OUT OF SCOPE, assigned to #867.** The daemon chooses the
  extension, and `copyFile` does not set `com.apple.quarantine`, so a file arriving from another machine
  lands without Gatekeeper's downloaded-from-elsewhere prompt. Electron exposes no supported API to set
  that attribute. It does not bite here: AC 4 *reveals* the file in a folder and never opens it, so the
  user still performs the same double-click they would for any received file. #867 is the ticket that
  hands a path to `shell.openPath`, and `attachment-path-resolution.md` already names it as the consumer
  where "the OS executes it with whatever handler the extension implies".
- **Malicious relay:** no traffic crosses here at all. **Renderer compromise reaching the transport:** this
  channel touches no key, no socket, and no wire; § 4 states the capability it does grant.
  **Token theft from disk:** no token is involved.
