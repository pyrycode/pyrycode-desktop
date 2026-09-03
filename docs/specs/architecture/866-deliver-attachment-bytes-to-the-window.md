# #866 — Deliver an attachment's bytes to the window for display

The fourth attachment channel pair. The window names an attachment by identifier; the background
process resolves that identifier inside the app-private attachment directory, reads the file, and
answers exactly one terminal — the bytes, or a client-owned failure literal. Nothing renders here:
the thumbnail that consumes these bytes is #868 and the OS-viewer open is #867.

## Files read

| Path | Symbol that matters | Why |
|---|---|---|
| `src/main/attachmentSave.ts` | `createAttachmentSave` | The closest analogue by a wide margin: same directory, same gate, same composition-root seam, and the never-rejects driver that answers its terminal as a **resolved value** rather than pushing it. This slice's driver is that shape with the copy replaced by a read. |
| `src/shared/ipc/attachmentSave.ts` | `isAttachmentSaveRequest`, `AttachmentSaveEvent` | The template for the shared half: two channel constants, a size-bounded shape guard that is deliberately *not* a canonicity check, a sealed outcome union of client-owned literals. |
| `src/main/attachmentPath.ts` | `resolveAttachmentPath`, `CANONICAL_ATTACHMENT_ID` | The gate to consume verbatim. Its alphabet is what makes traversal unspellable rather than checked, and its header is the source of the no-second-escape-check rule this slice obeys. |
| `src/main/attachmentRetrieval.ts` | `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS`, `createAttachmentRetrieval` | The half of the concurrency argument that **does** transfer (bytes entering this process must be bounded), and the coalescing behaviour that deliberately does **not** transfer. |
| `src/shared/ipc/attachmentRetrieval.ts` | `AttachmentRetrievalEvent` | The content-free-by-construction posture this event is the first to depart from, and the docblock naming this ticket as the consumer of the path `attachmentStore` returns. |
| `src/main/index.ts` | `attachmentDir`, `attachmentSaveListener` | The one `app.getPath('userData')`-derived join, and the listener shape (guard → drop, `event.sender` closed in, `isDestroyed()`, `will-quit` removal) copied here. |
| `src/preload/index.ts` | `saveAttachment`, `onAttachmentSaveEvent` | The fire-and-forget sender + unsubscribe-returning listener pair copied here. `index.d.ts` needs no edit — `PyryApi` is `typeof api`. |
| `src/main/attachmentStore.ts` | `ATTACHMENT_DIR_NAME` | The directory name joined once at the root; this slice is its third reader, not a fourth join. |
| `docs/knowledge/features/attachment-save.md` | § "Two new modules, two composition-root edges", § Security | The prior ticket's recorded lessons: the two-bound distinction, the symlink-at-source deferral, the failure union read as a one-bit existence oracle. |
| `docs/knowledge/features/attachment-path-resolution.md` | — | Why containment is structural and why the gate makes no filesystem call. |

## Design source

**Figma:** N/A — this slice has no renderer surface. It adds a main-process module, a shared IPC
contract and two preload functions; nothing is rendered and no component is touched. The visual
work that consumes this channel is #868.

## Context

`setWindowOpenHandler` drops every `file:` and custom-protocol URL, and the standing rule keeps
sockets, keys and raw bytes in the background process. So the window cannot hold a path, and an
attachment must be addressed by **identifier**, with the background process turning that identifier
into bytes. Three channel pairs of exactly this shape already ship (upload #862, retrieval #996,
save #814); this is the fourth and the last one the display path needs.

Both questions the original body deferred are settled by the ticket and are not reopened here:
the bytes cross as an **IPC payload on a sibling channel pair**, not through a custom protocol
handler (a handler cannot express AC 4 — its only failure surface is a response status, so a refusal
and a missing file would reach the window as one indistinguishable image error); and **no size
ceiling belongs on delivery**, because `createAttachmentReassembler` already refuses a declared size
over `ATTACHMENT_MAX_RETRIEVAL_BYTES` at `storeAttachment`, the sole writer into that directory.

No ADR is warranted: this slice introduces no decision the three shipped siblings have not already
recorded. The one genuinely new property — a channel that returns file **content** to the window —
is argued in § Security review below and belongs in the package overview the documentation phase
writes, not in a decision record.

**Stated size overage.** ~1050 lines of total written work against the 800-line guidance. Every
other line of the size table holds with room: 4 production files (≤5), 4 new exported types (≤5),
0 consumer call sites needing simultaneous update (≤10), 4 acceptance criteria (≤5), 3 terminal
failure branches (≤10). It is not split because every candidate seam is a one-consumer pair, which
the floor rule forbids — the shared contract has exactly one consumer (the main-side reader), the
reader has exactly one consumer (the composition-root wiring), and neither half changes anything
observable on its own. #814 landed the identical shape at 1225 lines in one clean run.

## Design

Four production files, two of them new.

### 1. `src/shared/ipc/attachmentBytes.ts` (new)

A sibling to `attachmentSave.ts`, **not** a member on `events.ts`'s `DaemonEvent` union, for that
module's recorded reason: four renderer bridges end their switch in `assertNever`, so a member there
is a compile error in four unrelated files for four no-op arms.

```ts
export const ATTACHMENT_BYTES_CHANNEL = 'pyry:attachment-bytes' as const              // renderer → main
export const ATTACHMENT_BYTES_EVENT_CHANNEL = 'pyry:attachment-bytes-event' as const  // main → renderer
export const MAX_BYTES_IDENTIFIER_LENGTH = 256   // UTF-16 code units

export interface AttachmentBytesRequest { attachmentId: string }
export function isAttachmentBytesRequest(value: unknown): value is AttachmentBytesRequest

export type AttachmentBytesFailure = 'refused' | 'unavailable' | 'busy'
export type AttachmentBytesEvent =
  | { type: 'delivered'; attachmentId: string; bytes: Uint8Array }
  | { type: 'failed'; attachmentId: string; reason: AttachmentBytesFailure }
```

`isAttachmentBytesRequest` is `isAttachmentSaveRequest`'s posture with one field instead of two:
**shape only, never canonicity**, so a `../..` identifier passes here and is refused by
`resolveAttachmentPath`, keeping the single-gate argument intact (AC 2). Field reads are `in`-guarded
on a narrowed `object`, so a `__proto__`-keyed ask has no own property to find.
`MAX_BYTES_IDENTIFIER_LENGTH` is boundary hygiene in `MAX_SAVE_IDENTIFIER_LENGTH`'s sense — this ask
never reaches the wire, and the real ceiling is the gate's 64-character alphabet, two orders of
magnitude below it.

**This is the first attachment event that is not content-free, and that is the point of the ticket.**
The three siblings each state "no member declares a field that can hold the file's bytes"; this one
declares exactly that field and nothing else. What survives unchanged is everything *around* the
bytes: no path, no directory, no URL, no filename, no media type and no errno is declarable in either
direction (AC 1). The channel carries bytes and nothing else — the retrieval leg never kept a name or
a MIME type (`attachmentReassembler` reads neither, and the stored file is extension-less on purpose),
so there is nothing main-side to read one back from. Whether the consumer needs a type at all is
#868's question.

**Three failure reasons, split on what a consumer can do next** — `storeAttachment`'s test, applied
where AC 4 draws the line:

- `'refused'` — the identifier never named a file here. `resolveAttachmentPath` rejected it before any
  filesystem call. A consumer must **not** retry: fetching cannot make a non-canonical identifier
  resolvable.
- `'unavailable'` — the identifier resolved and nothing readable is at that path. **The one a consumer
  can act on**: fetch via #996 and ask again. This is the distinction AC 4 requires, and it is why the
  two are not merged the way `attachmentSave` merges them (that channel's consumer answers both with
  the same retry; this one does not).
- `'busy'` — more reads are already in flight than this client will run at once. A client-owned
  refusal that states a limit the caller can act on by waiting, `AttachmentRetrievalFailure`'s member
  of the same name and meaning.

Every inhabitant is a literal written in this repo, so a value of this type provably carries no path,
no errno, no filename and no part of the identifier (AC 4).

### 2. `src/main/attachmentBytes.ts` (new)

```ts
export const ATTACHMENT_MAX_CONCURRENT_READS = 4

export interface AttachmentBytesDeps {
  attachmentDir: string          // trusted, composition-root
  diagnosticLog?: DiagnosticLog
}
export function createAttachmentBytes(
  deps: AttachmentBytesDeps
): (request: AttachmentBytesRequest) => Promise<AttachmentBytesEvent>
```

`attachmentDir` is a **parameter**, so this module carries no `electron` import and its test graph
stays Electron-free (AC 3) — `attachmentSave`'s and `attachmentStore`'s seam, pinned by a
module-graph test rather than by this paragraph. It is the only dep besides the optional logger:
unlike save there is no Electron touch at all here, no `reveal` and no second directory.

**The terminal is the resolved value**, `createAttachmentSave`'s shape rather than
`createAttachmentRetrieval`'s pushed `emit`: "exactly one answer per ask" (AC 1) is then bought by a
promise settling once rather than by an invariant to maintain. **It never rejects**, which is what
licenses the composition root's bare `void`.

Flow, in order, with the ordering itself load-bearing:

1. Log the static `started` code.
2. `resolveAttachmentPath(attachmentDir, attachmentId)` — a refusal answers `failed / 'refused'`
   **before any filesystem call and before a slot is taken** (AC 2). Refusing ahead of the cap is
   deliberate: a refusal costs no memory, so it should be answered honestly under pressure rather
   than reported as `busy`, and a caller spraying malformed identifiers cannot displace real reads.
3. The cap: `inFlight >= ATTACHMENT_MAX_CONCURRENT_READS` answers `failed / 'busy'`. Nothing is read,
   so nothing accumulates.
4. `inFlight += 1`, then `await readFile(resolved.path)`, with the decrement in a `finally` so a
   throwing read cannot leak a slot.
5. Any read failure — absent, unreadable, a directory, any errno — answers `failed / 'unavailable'`.
   The caught object is **dropped without being inspected at all**, one step past `attachmentSave`,
   which still reads `.code`: every read failure maps to one reason here, so there is nothing to
   read off the error and a `node:fs` `ErrnoException` carries the offending path in its own message.
6. Otherwise answer `delivered` with the bytes.

**The bytes are copied into an exactly-sized `Uint8Array` before they cross the bridge, and that copy
is load-bearing rather than incidental.** `fs.readFile` returns a `Buffer` allocated from Node's
shared 8 KB pool whenever the file is under 4096 bytes, so the returned view is a window into memory
holding *other, unrelated* allocations. Structured clone serializes a typed array as its **backing
ArrayBuffer plus an offset and a length**, so handing that view to `webContents.send` would copy the
whole pool to the renderer — up to 8 KB of adjacent main-process heap, in a process that also holds
decrypted daemon plaintext. `new Uint8Array(contents)` allocates a fresh buffer of exactly the file's
length and copies into it, so the view spans its own ArrayBuffer whole and nothing adjacent can ride
along. Pinned by a test on a sub-4096-byte file asserting `byteOffset === 0` and
`bytes.buffer.byteLength === bytes.length`.

*Rejected alternative:* the conditional zero-copy — reuse the buffer when the view already spans it
whole (true for every file ≥ 4096 bytes) and copy only in the pooled case. It is correct, but it
trades a branch whose unsafe arm is the rare one for a memcpy that is negligible against the copy
the IPC layer performs on the same bytes regardless. Unconditional copy: one line, provably exact
for every input, no arm that can rot.

**There is no file-size ceiling here** (the ticket's ruling): the bytes are bounded at the only
writer into that directory, and a second ceiling on one quantity is the same anti-pattern as a second
escape check.

**There IS a concurrency cap, and unlike `attachmentSave` that is not optional.** Save declines one
because its copy is kernel-side and accumulates nothing in this process; these bytes *do* enter this
process, so retrieval's reasoning applies verbatim — an untrusted window can otherwise open unbounded
concurrent reads whose peak footprint is unbounded. Four holds the accumulated footprint to
4 × `ATTACHMENT_MAX_RETRIEVAL_BYTES` (~92 MB), the same ceiling `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS`
already encodes, while staying far above the realistic use of a handful of thumbnails.

**No coalescing, and that is a departure from `createAttachmentRetrieval` rather than an omission.**
That driver coalesces a duplicate ask because a second concurrent *write* of one content-addressed
file is pointless, and because the live retrieval's terminal names the same identifier and so answers
both asks. Here the terminal is a promise returned to one caller, and AC 1 requires exactly one
answer **per ask**: coalescing would leave the second ask unanswered. The in-flight state is
therefore a plain counter, not a map — nothing is keyed by identifier and two asks for one attachment
are two independent reads.

**Logging** is the siblings' shape: one static event name (`attachment-bytes`) and a static `code`
per outcome (`started`, `delivered`, `refused`, `unavailable`, `busy`). **No byte length is logged**,
though the general logging rule permits one: a length is a size oracle over the user's own content,
the three siblings record none, and nothing needs it.

### 3. `src/main/index.ts` (modified)

The fourth attachment edge, and the **third reader** of the one `attachmentDir` the root already
joins for the retrieval store and the Downloads copy — no new `app.getPath` call and no second join
(AC 3). The listener is `attachmentSaveListener`'s verbatim: guard with `isAttachmentBytesRequest`
and **drop** a malformed ask (no filesystem call, no event — the only sound answer when there is no
identifier to address a reply to, AC 1), close `event.sender` into the reply, guard `isDestroyed()`
for a window closed mid-read, register with `ipcMain.on`, remove on `will-quit`. The bare `void` is
licensed by the driver's never-rejects property. `setWindowOpenHandler`'s `file:` and
custom-protocol denies stay untouched — that block is the reason this channel exists.

### 4. `src/preload/index.ts` (modified)

`requestAttachmentBytes(request)` — fire-and-forget on the fixed channel — and
`onAttachmentBytesEvent(listener)` — subscription returning an unsubscribe handle, raw
`IpcRendererEvent` stripped — copying `saveAttachment` / `onAttachmentSaveEvent` exactly.
`src/preload/index.d.ts` needs no edit: `PyryApi` is `typeof api`.

**The one property no test in this repo can pin.** The bytes make two hops: `webContents.send` →
`ipcRenderer.on` (blink's `CloneableMessage`, the V8 structured serializer, which copies a typed
array), then the `contextBridge` callback into the main world, which copies non-function values
through the same serializer. Renderer tests here are node-environment static renders and the bridge
only exists in the built app, so neither hop is observable from vitest and this slice wires no
renderer consumer to exercise it. Recorded rather than hidden: #868 is the first consumer and the
first end-to-end proof. If the second hop ever proved lossy, the repair is local to the preload
listener (re-wrap the incoming value), not to this contract.

## State + concurrency model

One integer in the driver's closure — `inFlight` — and nothing else. No map, no timer, no listener
beyond the `ipcMain.on` the root removes on `will-quit`, and no store slice (this slice has no
renderer state; #868 owns that).

**The check-then-act is safe because it never crosses an `await`.** The cap comparison and the
increment run in the same synchronous block before the first suspension point, so two asks in one
tick cannot both observe a free slot — JavaScript's run-to-completion is what makes it sound, and
that is exactly why the increment must not be moved after the `await`. The same fact is what makes
the cap deterministically testable: firing `CAP + 1` asks in one tick without awaiting gives four
in-flight reads and one `busy`, with no timing dependence.

The slot is released in a `finally`, so it is returned on the failure path as well as the success
path; a test fires `CAP` asks for an absent file and then a real one to prove it.

Cancellation: none is owed. Each ask is one bounded `readFile` that resolves or rejects on its own;
there is no long-lived job, no stream and no subscription to tear down. A window that closes
mid-read drops its terminal at the `isDestroyed()` guard — the same accepted loss the retrieval,
upload and save edges already take.

## Error handling

| Failure | Detected by | Terminal |
|---|---|---|
| Malformed, empty or over-length ask | `isAttachmentBytesRequest` at the boundary | dropped — no event, no fs call |
| Non-canonical identifier (`..`, absolute, separator) | `resolveAttachmentPath`, before any fs call | `refused` |
| Too many reads already in flight | the counter, before the read | `busy` |
| Source file absent | `readFile` → `ENOENT` | `unavailable` |
| Source unreadable (permissions) | `readFile` → `EACCES` | `unavailable` |
| A directory at the resolved path | `readFile` → `EISDIR` | `unavailable` |
| Any other read errno | `readFile`, error dropped uninspected | `unavailable` |

Nothing throws out of the driver: every row above resolves to a terminal event, which is what
licenses the composition root's bare `void`.

## Testing strategy

Unit tier only. A main-process filesystem module plus a boundary guard, both directly unit-testable
against a temp directory the way `attachmentSave.test.ts` is. This slice wires no renderer consumer,
so no Playwright coverage is owed — `attachmentSave` drew the same line, and the interaction that
would need `e2e/` arrives with #868.

`src/shared/ipc/attachmentBytes.test.ts` — pure, no I/O:

- the two channel constants are distinct from each other and from the three sibling pairs (six
  values, six distinct strings)
- the guard's accept table: a well-shaped ask; an ask carrying extra keys (nothing downstream
  rebuilds from them)
- the guard's refuse table: non-objects, an array, a missing / non-string / empty `attachmentId`
- the identifier bound, accepted at the limit and refused one past it
- a `../../etc/passwd` identifier is **accepted** here on shape — canonicity is
  `resolveAttachmentPath`'s, and the test says so
- a `__proto__`-keyed ask built with `JSON.parse` is refused (an object *literal* creates no own
  property and would be an inert fixture that passes while proving nothing)

`src/main/attachmentBytes.test.ts` — against an `mkdtemp` attachment directory:

- the happy path: `delivered`, the identifier echoed, bytes byte-identical to the source, and the
  event's keys exactly `type` / `attachmentId` / `bytes` (AC 1 — no path, directory or URL is even
  declarable)
- **the exact-buffer property**, on a sub-4096-byte file (the pooled-`Buffer` regime):
  `byteOffset === 0` and `bytes.buffer.byteLength === bytes.length`, plus `Buffer.isBuffer` false, so
  no adjacent main-process heap can ride along the structured clone
- a file above 4096 bytes round-trips identically, so the copy is not size-conditional
- a `..`-traversal identifier answers `refused` **even when the attachment directory does not
  exist** — the proof that no filesystem call decided it (AC 2)
- an absolute-path identifier answers `refused` (AC 2)
- an absent file answers `unavailable`, and the test asserts the two reasons **differ** (AC 4)
- a directory at the resolved path answers `unavailable` (EISDIR — platform-independent, unlike a
  chmod)
- `CAP + 1` asks fired in one tick: four `delivered`, one `busy`
- the slot is released on the failure path: `CAP` asks for an absent file, awaited, then a real ask
  succeeds
- a refused ask consumes no slot: ten refusals then a real ask succeeds
- every path resolves — the driver never rejects
- diagnostic records carry static codes only; the serialized records contain no identifier, no path,
  no file content and no length, with a positive control so the negatives are not vacuous
- the module graph asserts the exact import set (no `electron`) and no `console.` call

## Open questions

1. **Does a `Uint8Array` survive the `contextBridge` hop unchanged?** Documented as yes (non-function
   values are copied through the V8 structured serializer), unobservable from this repo's test tiers,
   and assigned to #868 as the first end-to-end consumer. Recorded in § 4 above with the repair if it
   is ever false. Not a blocker: no alternative encoding is worth adopting without evidence.
2. **Is `4` the right cap?** It matches `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` and its ceiling
   argument exactly. If #868 renders many thumbnails at once it may want more; raising it raises the
   footprint ceiling proportionally, and that is the trade the constant encodes. Left as-is —
   no such consumer exists yet, and a cap chosen for an imagined fan-out is a guess either way.

## Security review

**Verdict:** PASS — no MUST FIX.

**Findings:**

- **[Trust boundaries]** No findings on the inbound half. Two named gates, in order, both pre-existing
  in kind: `isAttachmentBytesRequest` (shape and size, at `ipcMain.on`) and `resolveAttachmentPath`
  (canonicity, before any filesystem call). Downstream holds a `ResolveAttachmentPathResult`
  discriminated union, so a refusal cannot be used as a path by forgetting a check. `attachmentDir`
  is trusted and composition-root-computed; `attachmentId` is untrusted and typed identically, which
  is why the distinction is stated at every declaration that carries both.
  **The new boundary is the OUTBOUND one**: this is the first attachment channel that returns file
  *content* to the window, so main→renderer stops being purely content-free. What crosses is bounded
  by the inbound gate's own alphabet — a direct child of one app-private directory named
  `[0-9a-f-]{1,64}`, whose sole writer is `storeAttachment`. A compromised renderer therefore gains
  the ability to read back attachments belonging to this same user in this same app, and nothing
  else; it cannot reach the secret store, the device token, or any path outside that directory,
  because no identifier that names one is spellable. Guessing an unknown identifier is a 36-character
  UUID search, not an enumeration.

- **[Process placement / CLAUDE.md § Don't]** No finding, but stated so it is not misread as a
  violation: the repo rule is that **keys, sockets and raw wire bytes** stay in the background
  process. Decrypted attachment content that the window was asked to display is none of those, and
  the ticket is the decision that it crosses. The Noise session, the relay socket, the frame codec
  and every key remain untouched by this slice, and this module imports nothing from
  `src/main/transport/`.

- **[Electron attack surface]** SHOULD FIX, designed in and to be verified in Phase B — **the pooled
  `Buffer` structured-clone leak.** `fs.readFile` serves any file under 4096 bytes from Node's shared
  8 KB buffer pool, so the returned view is a window into memory holding unrelated allocations, and
  structured clone serializes a typed array as its whole backing `ArrayBuffer` plus offset and
  length. Sending that view would hand the renderer up to 8 KB of adjacent main-process heap — in a
  process that also holds decrypted daemon plaintext. The design copies into an exactly-sized
  `Uint8Array`; the verifier must confirm the copy landed and that the sub-4096-byte test asserting
  `byteOffset === 0` and `bytes.buffer.byteLength === bytes.length` is present, because this is a
  leak no type and no other test would catch.
  No other finding here: `webPreferences` is untouched (`contextIsolation: true`,
  `nodeIntegration: false`), the preload exposes two typed functions on fixed channel constants and
  never `ipcRenderer` itself, the IPC surface accepts exactly one validated string and returns
  exactly one sealed union, and **no custom protocol or privileged scheme is registered** —
  `setWindowOpenHandler`'s `file:` and custom-protocol denies stay exactly as they are, which is the
  ticket's stated reason for choosing a channel pair over a protocol handler.

- **[Tokens, secrets, credentials]** No findings — this slice reads, mints and stores no token, key
  or credential, and adds no `safeStorage` call. The adjacency worth naming is that other app state
  lives under `app.getPath('userData')` beside the attachment directory; it is structurally
  unreachable from here, since `CANONICAL_ATTACHMENT_ID` admits no `.`, `/`, `\` or `:` and the
  resolved path is therefore always a direct child of `attachmentDir` named by the identifier itself.

- **[File / storage operations]** Path traversal: closed structurally by the consumed gate, with no
  second escape check written anywhere (AC 2) — two divergent checks on one directory is the shape
  that ends with one of them being weaker.
  TOCTOU: **no check-then-open exists in this design.** There is deliberately no `existsSync` before
  the read; a single `readFile` opens and reads, and absence is discovered by that call's own errno.
  There is nothing to swap in a gap because there is no gap.
  OUT OF SCOPE, on #814's recorded reasoning: **a symlink planted inside the attachment directory is
  followed**, so an attacker who can already write there could redirect one read to any file this
  user can read. That write access already suffices to replace the secret-store ciphertexts, so no
  privilege is gained — but the consequence differs from save's in kind (bytes reach a script-
  reachable surface rather than the user's Downloads folder), and the deferral is repeated
  deliberately rather than inherited silently. `O_NOFOLLOW` is not added: it is unobserved, it would
  make two readers of one directory behave differently, and this slice must not be the place that
  quietly diverges from `attachmentSave`. Revisit if the directory ever stops being single-principal.
  Same attacker, same disposition: **the absent file-size ceiling.** The ticket's ruling is sound
  given `storeAttachment` is the sole writer and `createAttachmentReassembler` caps what it writes;
  the residual — a planted oversized file OOM-ing the read — is the identical local-write attacker
  already accepted above, and a second ceiling would be the same anti-pattern as a second gate.
  Attachments are stored unencrypted at `0o600` by #995; that is a pre-existing decision this slice
  neither makes nor changes.

- **[Cryptographic primitives]** Not applicable, stated as a decision rather than an absence: no
  primitive, RNG or comparison is used on this path. In particular there is **no digest
  re-verification at read time**, restating #814's reasoning — #995 verified the digest before the
  bytes were stored, and re-checking here would require the expected digest to cross the bridge from
  an untrusted window, making it that window's decision whether a file is presented as good.

- **[Network & I/O]** No findings — this path opens no socket and builds no frame. It is the one
  attachment ask that never reaches the wire, so no envelope cap applies and
  `MAX_BYTES_IDENTIFIER_LENGTH` is boundary hygiene rather than a `MAX_PLAINTEXT_BYTES` guard. The
  I/O analogue of a frame-size cap is the memory bound, and it is present in two layers: the writer's
  per-file ceiling and `ATTACHMENT_MAX_CONCURRENT_READS` multiplying it by a bounded count.

- **[Error messages, logs, telemetry]** No findings. Three client-owned literals, every one written
  in this repo, so no reason can carry a path, an errno, a filename or any part of the identifier
  (AC 4). The caught read error is **never inspected at all** — one step past `attachmentSave`, which
  still reads `.code` — so an `ErrnoException`'s path-carrying message has no route to a record. No
  byte length is logged although the logging rule would permit one: a length is a size oracle over
  the user's own content and no sibling records one. Nothing is written to the renderer console and
  no telemetry is added.
  Named and accepted: the failure union is a **one-bit existence oracle** ("is attachment X on this
  machine"), now three-valued because AC 4 requires `refused` and `unavailable` to be tellable apart.
  Bounded to uninteresting by the same argument `attachment-save.md` records — the asker can probe
  only `[0-9a-f-]{1,64}` identifiers inside one app-private directory holding this same user's own
  attachments, which it already knows it fetched.

- **[Concurrency]** SHOULD FIX as an implementation constraint, and the reason the design says it
  twice: **the cap check and the increment must stay in one synchronous block before the first
  `await`.** Moving the increment after the read begins turns the counter into a check-then-act
  across a suspension point, where two asks in one tick both observe a free slot and the bound
  silently stops binding. The `CAP + 1`-in-one-tick test is what would redden if that happened.
  Same class, same file: **the driver must be constructed once at the composition root**, not per
  ask — a per-ask closure would reset the counter to zero every time and disable the cap without any
  test failing, the trap `createAttachmentRetrieval`'s own comment records.
  No findings otherwise: the slot is released in a `finally` so a throwing read cannot leak one,
  there is no timer, no stream, no `AbortController` is owed (one bounded `readFile` per ask, nothing
  long-lived to cancel), the single `ipcMain.on` is removed on `will-quit`, and a window closing
  mid-read drops its terminal at the `isDestroyed()` guard — the loss the three sibling edges already
  take. Accepted and named: serializing up to ~23 MB into a structured clone blocks the main process
  briefly; it is bounded, and chunking is a design no acceptance criterion asks for.

- **[Threat model alignment]** A malicious or compromised relay is not on this path — no frame is
  built and no socket is touched. A hostile daemon response was already parsed defensively and digest
  -verified by #995 before any byte reached this directory; this slice re-reads what that verified,
  and the residual (on-disk modification afterwards) is the local-write attacker dispositioned above.
  Renderer compromise reaching the transport: unchanged and unreachable — process isolation, the
  fixed channel allowlist and the identifier alphabet together bound a compromised window to reading
  back this user's own attachments. Token theft from disk is untouched by this slice.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
