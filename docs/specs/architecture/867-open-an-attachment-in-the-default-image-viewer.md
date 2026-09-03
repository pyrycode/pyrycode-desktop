# #867 — Open an attachment in the operating system's default image viewer

The background-process half of "hand the file to the OS viewer": one channel pair that takes an
attachment identifier from the window, resolves it through the existing gate, decides the file's type
from its own leading bytes against a closed raster set, materialises a suffixed derived copy in an
app-owned directory, and hands that path to `shell.openPath`. Nothing renders here. The thumbnail that
becomes the control calling this is #869; the thumbnail itself is #868.

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/main/attachmentPath.ts` | `resolveAttachmentPath`, `CANONICAL_ATTACHMENT_ID`, `ResolveAttachmentPathResult` | The one identifier gate, consumed verbatim. Its alphabet is what makes a suffixed derived name structurally unreachable from the window, and its header is the source of the no-second-check rule. |
| `src/main/attachmentBytes.ts` | `createAttachmentBytes`, `AttachmentBytesDeps` | The closest landed sibling: injected-directory seam, never-rejects driver, one-terminal-per-ask as a resolved promise, gate-before-any-filesystem-call ordering. |
| `src/main/attachmentSave.ts` | `createAttachmentSave`, `copyIntoDownloads`, `AttachmentSaveDeps` | The injected-Electron seam (`reveal`), the `COPYFILE_EXCL` no-overwrite/no-symlink-follow argument, the "no concurrency cap, and that is a decision" reasoning, and the already-sanitised-precondition docblock shape `derivedPath` copies. |
| `src/shared/ipc/attachmentBytes.ts` | `isAttachmentBytesRequest`, `AttachmentBytesFailure`, `AttachmentBytesEvent`, `MAX_BYTES_IDENTIFIER_LENGTH` | The channel-pair contract this one mirrors field for field, and the "split a failure only where the consumer's next action differs" test. |
| `src/shared/ipc/attachmentSave.ts` | `isAttachmentSaveRequest`, `AttachmentSaveFailure` | The other half of the guard precedent — shape-not-canonicity, `in`-guarded reads, `__proto__` disposition. |
| `src/main/attachmentStore.ts` | `ATTACHMENT_DIR_NAME`, `storeAttachment` | The sole writer into `attachmentDir`; its temp-file-plus-`rename` recipe is why a hard link would go stale, and its `mkdir(recursive, 0o700)` is the directory-creation pattern the derived directory copies. |
| `src/main/index.ts` | `setWindowOpenHandler`, `attachmentBytesListener`, `attachmentSaveListener`, the `attachmentDir` join | The composition root: the `file:` deny that must stay untouched, the listener posture this edge repeats, and the one place a directory is named. |
| `src/preload/index.ts` | `saveAttachment` / `onAttachmentSaveEvent`, `requestAttachmentBytes` / `onAttachmentBytesEvent`, `PyryApi` | The sender/subscriber pair shape; `PyryApi = typeof api` is why `index.d.ts` needs no edit. |
| `docs/knowledge/features/attachment-bytes.md` | § "Why a channel pair, not a protocol handler", § Security | The recorded reasons this slice inherits rather than re-derives, including the symlink and existence-oracle dispositions. |
| `docs/knowledge/features/attachment-path-resolution.md` | § on the extension-less path | Names #867 as the layer positioned to validate an image type before deciding what the OS sees. The design below is that layer. |
| `docs/knowledge/features/attachment-save.md` | § on `showItemInFolder` vs `openPath` | Records that `openPath` is this ticket's API, and that no live path uses it yet. |

## Design source

**Figma:** N/A — the ticket states there is no visible app UI in this slice and no Figma node applies.
The visual-fidelity check is intentionally skipped; the control that calls this channel is #869 and
carries its own design anchor.

## Context

A 160px preview is for recognition. Zoom and pan come free from the OS viewer, so the app hands the
file over rather than building a viewer (operator, 2026-08-22). The app deliberately blocks that path
today: `setWindowOpenHandler` denies every `file:` and custom-protocol URL so a hostile link cannot
open a local file, and that deny is **not** lifted. This feature gets its own channel instead — the
window sends an identifier, never a path, and the background process does the opening.

Three prerequisites landed: #995 put the flat, extension-less file at `resolveAttachmentPath`'s path,
#996 fetches it, and #866/#814 established the whole channel-pair template. This slice adds the two
things neither sibling needed: a **type decision made from the file's own bytes**, and a **suffixed
path** produced without disturbing the extension-less original.

The extension-less store is deliberate — an extension would be model-chosen, and a `.command`,
`.desktop`, `.app` or `.scpt` opens by *executing*. So the suffix is picked out of a closed set this
app writes down; the bytes choose which member and never supply one. SVG is excluded: it has no byte
signature, and its default handler is routinely a browser that executes script inside it.

No ADR is warranted. Every structural decision here is either inherited from #866/#814 with its
argument already recorded, or is the one new decision below, which belongs in this package overview
rather than in a cross-cutting record.

## Design

Five production files: three new, two modified. Nothing existing changes shape.

### 1. `src/shared/ipc/attachmentOpen.ts` (new)

`attachmentBytes.ts`'s contract with a wider failure union. Same posture throughout: two channel
constants, one request interface, one shape-only boundary guard, one sealed outcome union. It imports
nothing from `src/main` and holds no I/O and no state.

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

**One field, and no path or URL is declarable in either direction** (AC 1). `isAttachmentOpenRequest`
is `isAttachmentBytesRequest` verbatim under a new name: shape and size only, never canonicity, so a
`../..` identifier passes here and is refused at `resolveAttachmentPath`. Field reads are `in`-guarded
on a narrowed `object`, so a `__proto__`-keyed ask has no own property to find. A failing ask is
**dropped** — no filesystem call, no event — because there is no identifier to address a reply to.

**Four failure literals, split on what a consumer can do next** (AC 5), which is `storeAttachment`'s
test and the line `AttachmentBytesFailure` draws:

- `'refused'` — `resolveAttachmentPath` rejected the identifier before any filesystem call. Permanent;
  a consumer must not retry.
- `'unavailable'` — the identifier resolved and nothing readable is at that path. The one a consumer
  acts on: fetch (#996) and ask again. `attachmentBytes`'s member of the same name and meaning.
- `'unsupported-type'` — the leading bytes matched no member of the closed raster set. Permanent and
  **distinct from `'refused'`**: the identifier was fine and the file is there; fetching again changes
  nothing, and the window's answer is to offer the save leg (#814) instead of the open leg.
- `'open-failed'` — the derived copy or the hand-off to the OS failed. Not retryable by fetching, but
  it is the only one that can succeed on a plain retry, which is why it is not merged into
  `'unavailable'`.

`attachmentId` is echoed on every arm as the correlation key. It is the window's **own value coming
back**, never a wire-supplied one and never a value this process derived — AC 5's ban is on
*identifier-derived* strings (the suffixed file name), not on the correlation key three landed
siblings already echo.

`MAX_OPEN_IDENTIFIER_LENGTH` is boundary hygiene, `MAX_BYTES_IDENTIFIER_LENGTH`'s argument restated: a
size bound, not a shape one, so the single-gate argument stays intact.

### 2. `src/main/imageSignature.ts` (new)

A pure, synchronous, total function: bytes in, a suffix from a closed set or `null` out. No filesystem
call, no state, no `electron` import, no `console.` — `attachmentPath.ts`'s and
`attachmentFilename.ts`'s shape, which is why it is its own module rather than a private helper.

```ts
export const SIGNATURE_PREFIX_BYTES = 12
export type ImageSuffix = '.png' | '.jpg' | '.gif' | '.webp'
export function matchImageSignature(prefix: Uint8Array): ImageSuffix | null
```

**The set is closed and written down here; the bytes only choose a member** (AC 3). That is what
bounds the blast radius of a wrong answer to mis-picking between `.png` and `.jpg` — `.command` is not
in the set and no input can produce it. This is signature matching, not image validation: a file whose
header matches PNG and whose remainder is garbage is a corrupt image, which is the viewer's problem.

| Member | Leading bytes | Suffix |
|---|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` | `.png` |
| JPEG | `FF D8 FF` | `.jpg` |
| GIF | `47 49 46 38 37 61` / `47 49 46 38 39 61` (`GIF87a` / `GIF89a`) | `.gif` |
| WebP | `52 49 46 46` at 0 **and** `57 45 42 50` at 8 (`RIFF`…`WEBP`) | `.webp` |

`SIGNATURE_PREFIX_BYTES = 12` is exactly the widest member (WebP's `WEBP` tag ends at byte 11), which
is why the driver reads a prefix rather than a file. Matching runs against however many bytes actually
arrived, and every member requires its full length, so a short file simply matches nothing. An empty
file matches nothing. **No suffix, media type or string from `mime_type`, from a file name or from any
daemon-supplied value takes part** — the function's only parameter is the prefix.

**SVG is deliberately absent** and the module says so: it has no byte signature (XML, recognisable
only by heuristics) and its default handler is routinely a browser, which executes script inside it.
A raster-only set is what makes "open in the default handler" a safe sentence.

### 3. `src/main/attachmentOpen.ts` (new)

The driver. `createAttachmentBytes`'s shape: `electron`-free, injected dependencies, never rejects,
answers exactly one terminal as a resolved value.

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
   **before any filesystem call** (AC 2). The sole gate; no second escape check is written anywhere in
   this slice.
2. Read the first `SIGNATURE_PREFIX_BYTES` bytes of `source.path` via `open` → `read` → `close` in a
   `finally`. **The prefix, not the file** — a dozen bytes decide every member, and reading 23 MB to
   look at twelve would be a regression against both siblings. Any error answers
   `failed / 'unavailable'`, the caught object dropped without being inspected (`createAttachmentBytes`
   exactly: a `node:fs` `ErrnoException` carries the offending path in its own message). This is also
   why **no concurrency cap is owed** — nothing whole enters this process, so `attachmentSave`'s "no
   cap, and that is a decision rather than an omission" is the reasoning that transfers, not
   `attachmentBytes`'s.
3. `matchImageSignature(prefix)` — `null` answers `failed / 'unsupported-type'`, **before any derived
   file exists and before the OS is told anything** (AC 3).
4. `mkdir(openDir, { recursive: true, mode: 0o700 })`, then
   `copyFile(source.path, derivedPath(...), COPYFILE_EXCL)`. `EEXIST` means a previous open already
   derived this file and it is **reused** (AC 4: no second derived file). Any other errno answers
   `failed / 'open-failed'` after a best-effort `unlink` of the partial destination —
   `copyIntoDownloads`'s disposition. The stored extension-less file is opened read-only and never
   renamed, moved or written.
5. `await open(derived)` inside a `try` — `false` or a thrown seam answers `failed / 'open-failed'`;
   `true` answers `opened`.

```ts
/** PRECONDITION: `attachmentId` has already passed `resolveAttachmentPath`. */
function derivedPath(openDir: string, attachmentId: string, suffix: ImageSuffix): string
```

`copyIntoDownloads`'s already-sanitised-component precondition, restated. This is **not** a second
path build from untrusted input: the identifier reaching it has passed `CANONICAL_ATTACHMENT_ID`, so
it is one component from a 64-character alphabet with no `.`, `/`, `\` or `:`, and appending a literal
from `ImageSuffix` keeps it one component. Containment is a consequence of the gate that already ran;
restating it as a check here would be the anti-pattern `attachmentPath.ts`'s header warns about.

#### The one decision this ticket owns: a copy into a dedicated derived directory

**A dedicated app-owned directory, not a suffixed sibling in `attachmentDir`.** `attachmentDir`'s
invariant is that every file in it is named `[0-9a-f-]{1,64}` and written by exactly one writer,
`storeAttachment`; three landed consumers address it by `resolveAttachmentPath`'s exact path. Mixing
derived artefacts in would break both properties, and any future retention pass over that directory —
which has no ticket, so it will be written by someone without this context — would have to learn the
difference. A separate directory is independently disposable: deleting all of it costs nothing but a
re-derive. It costs one extra `join` at the composition root.

**A copy, not a hard link**, despite the link costing no bytes. Two reasons, either sufficient:

- A hard link is the same inode under a second name, and that name is handed to an **arbitrary
  application chosen by the user's file-type association**. A viewer that saves in place writes
  straight through into the stored attachment, which AC 4 requires be left unmodified and which #866
  reads and #814 copies. A copy isolates that by construction.
- `storeAttachment` writes to a temp file and `rename`s it into place, so a re-store changes the
  inode. A link made before that points at the old inode forever, with nothing to notice.

The bytes are not really the trade they look like: the copy is kernel-side (`copyFile`), so nothing
accumulates in this process, and on APFS the flag set below asks for a clone first.

**`COPYFILE_EXCL | COPYFILE_FICLONE`.** `EXCL` is `attachmentSave`'s exact argument: `O_CREAT|O_EXCL`
makes the collision check and the create one syscall with no `existsSync`-then-write gap, and it
cannot be written through a symlink already sitting at the derived path. `FICLONE` is a hint — a
copy-on-write clone where the filesystem supports it (APFS, the primary platform; btrfs, XFS), a
normal full copy everywhere else — so the common case costs no bytes *and* keeps a write to the clone
isolated from the original.

**The derived name is deterministic per attachment**, `<attachmentId><suffix>`, so repeat opens reuse
rather than accumulate (AC 4). The derived directory can therefore never hold more than one file per
stored attachment, which bounds it by a quantity `createAttachmentReassembler` already bounds — the
reason no separate disk budget is owed here.

#### `shell.openPath` never gets to say anything

The seam is `(path: string) => Promise<boolean>`, **not** Electron's `Promise<string>`. `openPath`
does not throw: it resolves with the OS error message, empty on success, and **that message carries
the path**. Narrowing it to a bit at the composition root — `async (p) => (await
shell.openPath(p)).length === 0` — means the module that builds reasons and writes log records never
holds the string at all. A driver that received the string and remembered not to forward it would be
one careless edit from AC 5; this shape has nothing to forward.

### 4. `src/main/index.ts` (modified)

The fifth attachment edge and the **fourth reader** of the one `attachmentDir` the root already joins.
One new `join` for `openDir` — `join(app.getPath('userData'), ATTACHMENT_OPEN_DIR_NAME)` — and one new
Electron touch, the `open` seam above. `attachmentBytesListener`'s posture verbatim: guard with
`isAttachmentOpenRequest` and drop a malformed ask, close `event.sender` into the reply, `isDestroyed()`
guard, `ipcMain.on`, remove on `will-quit`, bare `void` licensed by the driver's never-rejects
property. `setWindowOpenHandler`'s `file:` and custom-protocol denies are untouched (AC 1).

### 5. `src/preload/index.ts` (modified)

`openAttachment(request)` — fire-and-forget on the fixed channel — and `onAttachmentOpenEvent(listener)`
— subscription returning an unsubscribe handle with the raw `IpcRendererEvent` stripped. Copies
`requestAttachmentBytes` / `onAttachmentBytesEvent` exactly. `index.d.ts` needs no edit: `PyryApi` is
`typeof api`. No caller is wired — that is #869.

## State + concurrency model

**No state at all.** Not even `attachmentBytes`'s counter: no cap is owed (see step 2 above), so the
closure exists only to bind the trusted values once. The driver may therefore be constructed at the
root without the once-for-the-app-lifetime caveat, though it is constructed once anyway for symmetry.

Exactly one terminal per ask is structural: the driver answers a promise, and a promise settles once.
No async job outlives an ask — a prefix read, a copy and a hand-off, each bounded — so no
`AbortSignal` and no teardown handle is owed. The file handle from step 2 is closed in a `finally` on
every path. A window that closes mid-open drops its terminal at the `isDestroyed()` guard, the same
accepted loss the four sibling edges take.

Concurrent opens of one attachment need no coordination: `COPYFILE_EXCL` makes the loser reuse the
winner's file rather than tear it, which is `copyIntoDownloads`'s property restated for a fixed name.

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

Nothing throws out of the driver; every row resolves to a terminal, which licenses the root's bare
`void`. Every reason is a client-owned literal written in this repo, so no value of this type can
carry a path, an errno, a file name, a `mime_type` or an OS message (AC 5). Logging is the same set of
static codes plus `started`, through the shared `DiagnosticLog` — no byte length, no matched type, no
identifier.

## Testing strategy

Unit tier only, plain vitest against a temp directory with the `open` seam injected —
`attachmentBytes.test.ts`'s and `attachmentSave.test.ts`'s harness. Nothing here belongs in
Playwright, which cannot observe an OS viewer appearing.

- **`src/shared/ipc/attachmentOpen.test.ts`** — the guard's accept/refuse table; the length bound at
  and past the limit; a `../../etc/passwd` identifier **accepted** here on shape, since canonicity is
  the gate's; a `__proto__`-keyed ask built with `JSON.parse` refused (a literal `{__proto__:{…}}`
  creates no own key and would be an inert fixture); the two channel constants distinct from each
  other and from the four sibling pairs.
- **`src/main/imageSignature.test.ts`** — one accept per member including both GIF versions; a `RIFF`
  container whose tag at byte 8 is not `WEBP` rejected; each member truncated one byte short of its
  signature rejected; empty input rejected; an SVG document, a PDF, a Mach-O header and a shell script
  each rejected; and the property that every non-`null` answer is a member of the written-down set, so
  no input can produce a suffix the module does not declare.
- **`src/main/attachmentOpen.test.ts`** — the happy path for each of the four members, asserting the
  seam was called with a path ending in the right suffix and that the derived file's bytes equal the
  source's; the source file byte-identical and at its original path afterwards; a second open of the
  same attachment producing exactly one file in the derived directory and calling the seam again; a
  `..`-traversal identifier and an absolute-path identifier both `refused` **with the attachment
  directory absent**, proving no filesystem call decided it; an absent file and a directory at the
  resolved path both `unavailable`; a file whose bytes match nothing answering `unsupported-type` with
  **no file created in the derived directory and the seam never called**; a seam answering `false` and
  a seam that throws both answering `open-failed`; every path resolving rather than rejecting;
  diagnostic records carrying static codes only, with a positive control; the event's keys exactly
  `type`/`attachmentId`/`reason`; and a module-graph assertion pinning the exact import set (no
  `electron`) and no `console.` call.

## Open questions

1. **Should the derived directory be swept at startup?** Nothing evicts it, and it is bounded at one
   file per stored attachment — the same bound the attachment directory itself has, so this feature at
   worst doubles a quantity that already has no retention policy. Deliberately not added here:
   attachment retention has no ticket in any repo, and a sweep invented by one consumer would be the
   second retention policy for one directory pair. Resolve as documented, not as work.
2. **Is `.jpg` the right suffix for JPEG rather than `.jpeg`?** Both are universally associated on all
   three platforms. `.jpg` is chosen for being the more common association target. No behavioural
   difference is known; if one appears, the change is one literal in `imageSignature.ts`.

## Security review

**Verdict:** PASS — no MUST FIX.

**Findings:**

- **[Trust boundaries]** No findings on the inbound half, and it is unchanged in kind from #866: two
  named gates in order — `isAttachmentOpenRequest` (shape and size, at `ipcMain.on`) and
  `resolveAttachmentPath` (canonicity, before any filesystem call) — with downstream holding a
  discriminated `ResolveAttachmentPathResult` so a refusal cannot be used as a path by forgetting a
  check. `attachmentDir`, `openDir` and the `open` seam are trusted composition-root values;
  `attachmentId` is untrusted and typed identically, which is why every declaration carrying both says
  so.
  **The new boundary is the file's own bytes deciding a name.** That is a disk→trusted-decision
  crossing, and it is explicit and single: `matchImageSignature`, a pure function whose only parameter
  is a 12-byte prefix. It is bounded by construction rather than by care — its return type is a closed
  union of four literals, so even a totally wrong answer mis-picks between raster suffixes and can
  never produce `.command`, `.desktop`, `.app` or `.scpt`. Nothing from the wire (`mime_type`), from a
  file name, or from any daemon-supplied value is in scope of that function.
- **[Electron attack surface]** No findings. `webPreferences` is untouched (`sandbox: true`,
  `contextIsolation: true`, `nodeIntegration: false`); the preload adds two typed functions on fixed
  channel constants and never exposes `ipcRenderer`; the IPC surface accepts exactly one validated
  string and answers one sealed union. **No custom protocol or privileged scheme is registered**, and
  `setWindowOpenHandler`'s `file:` and custom-protocol denies stay exactly as written — the window
  never holds a path or a URL, which is this feature's whole reason for being a channel. The new
  capability granted to a compromised renderer is "cause the OS to open one of this same user's own
  attachments, that this app already fetched, in an image viewer" — it cannot name a file outside
  `attachmentDir`, because no identifier that names one is spellable.
- **[File / storage operations]** Path traversal: closed structurally by the consumed gate, with no
  second escape check (AC 2). The one new path construction is `derivedPath`, which takes an already
  gate-passed identifier as a documented precondition and appends a literal from a closed union — no
  separator, no `.` from the identifier side, so still one component.
  TOCTOU: **no check-then-open exists.** There is no `existsSync` anywhere; the prefix read discovers
  absence by its own errno, and the derived file's collision check and create are one `O_CREAT|O_EXCL`
  syscall. `COPYFILE_EXCL` additionally cannot be written through a symlink already at the derived
  path.
  Storage scope: both directories are under `app.getPath('userData')`, `mkdir` at `0o700`, and
  `copyFile` gives the derived file the source's `0o600`. Nothing lands in a temp or synced folder.
  Atomic writes: not owed — the derived file is a reproducible cache, not state, and a partial one
  left by a hard kill mid-copy would be reused on a later open. Named as a limitation rather than
  hidden: the consequence is a truncated image in a viewer, it is repaired by deleting the derived
  directory, and closing it properly means a temp-plus-rename that would give up the free reuse
  `EXCL` buys. SHOULD FIX only if a report of it appears.
  OUT OF SCOPE, repeating #814's and #866's recorded disposition deliberately rather than inheriting
  it silently: **a symlink planted inside the attachment directory is followed**, so an attacker who
  can already write there could redirect the prefix read and the copy at any file this user can read,
  and get it opened in a viewer. That write access already suffices to replace the secret-store
  ciphertexts. `O_NOFOLLOW` is not added here for #866's reason — it would make readers of one
  directory behave differently, and this slice must not be where that quietly diverges. Note the
  signature gate narrows this attacker's reach further than it narrows #866's: a redirected read only
  opens if the target's own leading bytes are a raster image.
- **[Threat model — hostile daemon content reaching an OS decoder]** OUT OF SCOPE, and the sharpest
  new exposure worth naming plainly. The bytes are daemon-supplied and this slice hands them to a
  system image decoder the app does not control, so a malformed PNG that exploits a decoder bug is
  reachable. Three things bound it and none of them close it: the ticket's premise is the operator's
  ruling to hand files to the OS; the signature gate is what guarantees the handler is an *image*
  handler rather than an executor, which is the difference between a memory-safety bug and arbitrary
  execution by design; and #868 already routes these same bytes into Chromium's decoder via an
  `<img>`, so this adds a second decoder rather than a first. Un-closable by this app short of not
  shipping the feature. No ticket; it is a standing property of the decision.
- **[Threat model — a hostile file-type association]** Named and accepted. On Windows a user (or
  malware already on the machine) can associate `.png` with something that executes. `openPath`
  consults the machine's association, so the app cannot exclude that. An attacker able to rewrite the
  user's associations already runs code as the user; no privilege is gained.
- **[Error messages, logs, telemetry]** No findings, and this is where the slice's own trap lives.
  `shell.openPath` **does not throw — it resolves with the OS error message, which carries the path.**
  The design makes forwarding it structurally impossible rather than a rule to remember: the seam is
  narrowed to `Promise<boolean>` at the composition root, so the driver never holds the string. Four
  client-owned literals, every one written in this repo, plus static log codes; no path, no
  identifier-derived name, no matched type, no byte length, no errno and no OS message reaches the
  window or a log. The caught read error is dropped without being inspected, `attachmentBytes`'s
  posture.
- **[Tokens, secrets, credentials]** Not applicable as a decision rather than an absence: this slice
  reads, mints and stores no token, key or credential and adds no `safeStorage` call. The adjacency
  worth naming is that the secret store lives under `userData` beside both directories; it is
  structurally unreachable, since the gate's alphabet admits no `.`, `/`, `\` or `:` and both paths
  are therefore direct children named by the identifier.
- **[Cryptographic primitives]** Not applicable: no primitive, RNG or comparison is used on this path.
  Signature matching is a byte-prefix equality over public constants, not a secret comparison, so
  `timingSafeEqual` is not owed and using it would misdescribe what is being compared. In particular
  there is **no digest re-verification**, restating #814's and #866's reasoning: #995 verified the
  digest before storing, and re-checking here would need the expected digest to cross from an
  untrusted window.
- **[Network & I/O]** No findings — this path opens no socket and builds no frame. It is the second
  attachment ask that never reaches the wire, so no envelope cap applies and
  `MAX_OPEN_IDENTIFIER_LENGTH` is boundary hygiene. The I/O analogue of a frame cap is a memory bound,
  and it is stronger here than in #866: only 12 bytes ever enter this process, which is why no
  concurrency cap is owed.
- **[Concurrency]** No findings. No long-lived async task is launched and no state is held, so there
  is nothing to cancel and no check-then-act across an `await` — the one place shared state could race
  is the derived file, and `O_CREAT|O_EXCL` makes concurrent opens of one attachment resolve to reuse
  rather than to a torn file. The file handle is closed in a `finally`. Shutdown mid-copy leaves the
  partial-file case already recorded above.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03

## Size

**A stated overage against the 800-line ceiling, not a miss** — the refiner's estimate of ~1600 lines
across 4–5 production files is re-derived here as ~1575: three new modules with their tests (~1030),
two composition edits (~95), and this plan (~450). Every other line of the size table holds:
**5** production source files (at the boundary), **5** new exported types (`AttachmentOpenRequest`,
`AttachmentOpenFailure`, `AttachmentOpenEvent`, `AttachmentOpenDeps`, `ImageSuffix` — at the
boundary), **0** consumer call sites needing simultaneous update (every change is additive), **5**
acceptance criteria, **5** reject branches. The measured norm for this family is 1569 (#866) and 1566
(#814), both single clean tickets.

The floor is what keeps it one ticket, and per the sizing rule the floor wins over the ceiling:
`matchImageSignature` has exactly one consumer and nothing outside this family would call it, the
derived-path step is not observable on its own, and a channel that opens nothing is not a deliverable.
