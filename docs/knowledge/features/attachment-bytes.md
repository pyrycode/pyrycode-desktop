# Attachment bytes (deliver to the window for display)

The fourth attachment channel pair, and the first one that is not content-free: the window names an
attachment already on this machine by identifier, and the background process answers exactly one
terminal — the file's bytes, or a client-owned failure literal. Nothing renders here. The thumbnail
that consumes these bytes is [#868](https://github.com/pyrycode/pyrycode-desktop/issues/868) and the
click that opens a file in the OS viewer is
[#867](https://github.com/pyrycode/pyrycode-desktop/issues/867), each its own ticket.

Introduced in [#866](https://github.com/pyrycode/pyrycode-desktop/issues/866), split from #691. The
second consumer of [attachment retrieval](attachment-retrieval.md)'s directory to land, after
[attachment save](attachment-save.md) (#814); [attachment path resolution](attachment-path-resolution.md)
(#818) is the gate it consumes verbatim.

## Why a channel pair, not a protocol handler

`setWindowOpenHandler` drops every `file:` URL and every custom-protocol URL, precisely so a hostile
link cannot open a local file or launch a registered handler, and that block stays untouched — it is
the reason this channel exists at all. A privileged-scheme registration was the rejected alternative,
decisively: its only failure surface is a response status, so a refused identifier and a missing file
would both reach the window as one indistinguishable image error. The channel pair keeps the two
outcomes tellable apart (see § Three failure reasons below), matching the shape of the three sibling
pairs — upload, retrieval, save.

## No size ceiling on delivery

The bytes are already bounded at the only writer into the attachment directory:
`createAttachmentReassembler` refuses a declared size over `ATTACHMENT_MAX_RETRIEVAL_BYTES` and
`storeAttachment` is the sole path in. A second ceiling on one quantity here would be the same
anti-pattern as a second escape check on the identifier — see below.

## The shared IPC contract — `src/shared/ipc/attachmentBytes.ts`

A sibling to `attachmentSave.ts`, **not** a member on `events.ts`'s `DaemonEvent` union — that
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
**shape only, never canonicity** — a `../..` identifier passes here and is refused by
`resolveAttachmentPath`, keeping the single-gate argument intact. Field reads are `in`-guarded on a
narrowed `object`, so a `__proto__`-keyed ask has no own property to find. `MAX_BYTES_IDENTIFIER_LENGTH`
is boundary hygiene, `MAX_SAVE_IDENTIFIER_LENGTH`'s argument restated for the one attachment ask that
never reaches the wire — the real ceiling is the gate's 64-character alphabet, two orders of magnitude
below it.

**The channel carries bytes and nothing else** — no path, no directory, no URL, no filename, no media
type, no errno, in either direction. The retrieval leg never kept a filename or a MIME type
(`attachmentReassembler` reads neither, and the stored file is extension-less on purpose), so there is
nothing main-side to read one back from. Whether a consumer needs a type at all is #868's question.

### Three failure reasons, split on what a consumer can do next

The same distinction `storeAttachment`'s test applies, drawn where this ticket's AC 4 requires it —
and the one place this leg departs from `AttachmentSaveFailure`, which *merges* a refusal and an
absent file into one retryable reason:

- **`'refused'`** — the identifier never named a file here; `resolveAttachmentPath` rejected it before
  any filesystem call. A consumer must **not** retry: fetching cannot make a non-canonical identifier
  resolvable.
- **`'unavailable'`** — the identifier resolved and nothing readable is at that path (absent,
  unreadable, or not a file). The one a consumer can act on: fetch via
  [attachment retrieval](attachment-retrieval.md) and ask again.
- **`'busy'`** — more reads are already in flight than this client will run at once.
  `AttachmentRetrievalFailure`'s member of the same name and meaning.

Every inhabitant is a literal written in this repo, so a value of this type provably carries no path,
errno, filename, or any part of the identifier.

## The main-process driver — `src/main/attachmentBytes.ts`

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

`attachmentDir` is a parameter, so this module carries no `electron` import and its test graph stays
Electron-free — `attachmentSave`'s and `attachmentStore`'s seam. It is the only dependency besides the
optional logger: unlike save there is no other Electron touch at all here (no `reveal`, no second
directory).

**The terminal is the resolved value** — `createAttachmentSave`'s shape rather than
`createAttachmentRetrieval`'s pushed `emit`. "Exactly one answer per ask" is then bought by a promise
settling once rather than by an invariant to maintain, and that is what licenses the composition
root's bare `void`: the driver never rejects.

Flow, in order, with the ordering load-bearing:

1. `resolveAttachmentPath(attachmentDir, attachmentId)` — a refusal answers `failed / 'refused'`
   **before any filesystem call and before a slot is taken**. Refusing ahead of the concurrency cap is
   deliberate: a refusal costs no memory, so it is answered honestly under pressure rather than
   reported as `busy`, and a caller spraying malformed identifiers cannot displace a real read.
2. The cap: `inFlight >= ATTACHMENT_MAX_CONCURRENT_READS` answers `failed / 'busy'` before anything is
   read.
3. `inFlight += 1`, `await readFile(resolved.path)`, decrement in a `finally` so a throwing read
   cannot leak a slot.
4. Any read failure — absent, unreadable, a directory, any errno — answers `failed / 'unavailable'`.
   The caught object is dropped **without being inspected at all**, one step past `attachmentSave`
   (which still reads `.code`): every read failure maps to the same one reason, and a `node:fs`
   `ErrnoException` carries the offending path in its own message.
5. Otherwise answer `delivered` with the bytes.

### The exact-buffer copy is load-bearing, not tidiness

`fs.readFile` serves any file under 4096 bytes from Node's shared 8 KB buffer pool, so the `Buffer` it
returns is a window into memory holding *other, unrelated* allocations. Structured clone — what
carries this value over `webContents.send` — serializes a typed array as its **whole backing
`ArrayBuffer` plus an offset and a length**, so handing that view straight to the window would copy
the entire pool across: up to 8 KB of adjacent main-process heap, in a process that also holds
decrypted daemon plaintext.

`exactBytes` closes this with one line, unconditionally for every input:

```ts
function exactBytes(view: Uint8Array): Uint8Array {
  return new Uint8Array(view)
}
```

`new Uint8Array(contents)` allocates a fresh buffer of exactly the file's length and copies into it, so
the returned view spans its own `ArrayBuffer` whole. Pinned by a test on a sub-4096-byte file asserting
`byteOffset === 0` and `bytes.buffer.byteLength === bytes.length` — nothing else in the type system
would catch its removal. The conditional version (copy only when the view doesn't already span its
buffer whole, true for every file ≥ 4096 bytes) is correct but was rejected: it trades a branch whose
unsafe arm is the rare one for a memcpy that is negligible against the copy the IPC layer performs on
these same bytes regardless.

**Any future channel that returns file bytes to the window inherits this same trap.**

### The concurrency cap, and why it is not optional here

Unlike `attachmentSave`, which declines a cap because its copy is kernel-side and accumulates nothing
in this process, these bytes **do** enter this process — `createAttachmentRetrieval`'s reasoning
transfers verbatim. Four holds the accumulated footprint to `4 × ATTACHMENT_MAX_RETRIEVAL_BYTES`
(~92 MB), the same ceiling `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` already encodes, while staying far
above the realistic use of a handful of images a person is looking at.

**A concurrency cap tests deterministically only while the check and the increment share one
synchronous block, before the first `await`.** Two asks arriving in one tick cannot both observe a
free slot, because JavaScript's run-to-completion is what makes the bound sound — moving the increment
after the `await` turns it into a check-then-act across a suspension point and the cap silently stops
binding, with no other test noticing. Firing `CAP + 1` asks in one tick without awaiting is the
timing-free proof: four `delivered`, one `busy`.

**The driver must be constructed once at the composition root, not per ask** — the in-flight count is
only meaningful *across* asks, so a per-ask closure would reset it to zero every time and disable the
cap silently, `createAttachmentRetrieval`'s own recorded trap.

### No coalescing — the departure from `createAttachmentRetrieval`

That driver drops a duplicate ask for an identifier already in flight because its *pushed* terminal
names the same identifier and so answers both askers, and because a second concurrent write of one
content-addressed file is pointless. Neither reason holds here: this driver's terminal is a promise
returned to **one caller**, so a dropped duplicate would leave its caller with no answer at all. The
in-flight state is therefore a plain counter, not a map keyed by identifier — two asks for one
attachment are two independent reads.

## The composition root — `src/main/index.ts`

The fourth attachment edge, and the **third reader** of the one `attachmentDir` the root already
joins for the retrieval store and the Downloads copy — no new `app.getPath` call, no second join. The
listener is `attachmentSaveListener`'s shape verbatim: guard with `isAttachmentBytesRequest` and
**drop** a malformed ask (no filesystem call, no event — the only sound answer when there is no
identifier to address a reply to), close `event.sender` into the reply, guard `isDestroyed()` for a
window closed mid-read, register with `ipcMain.on`, remove on `will-quit`. `setWindowOpenHandler`'s
`file:` and custom-protocol denies stay untouched.

## The preload pair — `src/preload/index.ts`

`requestAttachmentBytes(request)` — fire-and-forget on the fixed channel — and
`onAttachmentBytesEvent(listener)` — subscription returning an unsubscribe handle, the raw
`IpcRendererEvent` stripped — copy `saveAttachment` / `onAttachmentSaveEvent` exactly. `index.d.ts`
needed no edit: `PyryApi` is `typeof api`. No caller is wired yet — the first consumer is #868.

## The one property no tier in this repo can pin

The bytes make two hops: `webContents.send` → `ipcRenderer.on` (blink's structured serializer, which
copies a typed array), then the `contextBridge` callback into the main world, which copies
non-function values through the same serializer. Renderer tests here are node-environment static
renders and the bridge only exists in the built app, so neither hop is observable from vitest, and
this slice wires no renderer consumer to exercise it. Documented rather than hidden: #868 is the first
end-to-end proof. If the second hop ever proved lossy, the repair is local to the preload listener
(re-wrap the incoming value), not to this contract.

## State and concurrency model

One integer in the driver's closure — `inFlight` — and nothing else. No map, no timer, no store slice
(this slice has no renderer state; #868 owns that). The slot is released in a `finally` on every path.
Cancellation: none is owed — each ask is one bounded `readFile` with no long-lived job to tear down; a
window that closes mid-read drops its terminal at the `isDestroyed()` guard, the same accepted loss
the retrieval, upload and save edges already take.

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

Nothing throws out of the driver; every row above resolves to a terminal event, which licenses the
composition root's bare `void`.

## Security

Architect self-review verdict **PASS**, no MUST FIX. Full review in
`docs/specs/architecture/866-deliver-attachment-bytes-to-the-window.md`. Points not covered above:

- **The new boundary is the outbound one.** This is the first attachment channel that returns file
  content to the window, so main→renderer stops being purely content-free. What crosses is bounded by
  the inbound gate's own alphabet — a direct child of one app-private directory named `[0-9a-f-]{1,64}`,
  whose sole writer is `storeAttachment`. A compromised renderer gains only the ability to read back
  this same user's own attachments in this same app; it cannot reach the secret store, the device
  token, or any path outside that directory, because no identifier that names one is spellable.
- **No digest re-verification at read time**, restating #814's reasoning: #995 verified the digest
  before the bytes were stored, and re-checking here would require the expected digest to cross the
  bridge from an untrusted window.
- **A symlink planted inside the attachment directory is followed** — out of scope, on #814's recorded
  reasoning: an attacker who could already write there could already replace the secret-store
  ciphertexts, so no privilege is gained. The consequence differs in kind from save's (bytes reach a
  script-reachable surface rather than the Downloads folder), and the deferral is repeated deliberately
  rather than inherited silently.
- **The failure union is a one-bit-turned-three-valued existence oracle** ("is attachment X on this
  machine"), bounded to uninteresting by the same argument `attachment-save.md` records: the asker can
  probe only `[0-9a-f-]{1,64}` identifiers inside one app-private directory holding this same user's
  own attachments, which it already knows it fetched.
- No primitive, RNG or comparison is used on this path; no telemetry is added; no byte length is
  logged, though the logging rule would permit one — a length is a size oracle over the user's own
  content and no sibling records one.

## Testing

Unit tier only — a main-process filesystem module plus a boundary guard, both directly unit-testable
against a temp directory the way `attachmentSave.test.ts` is. No Playwright coverage is owed; the
interaction that would need `e2e/` arrives with #868.

- `src/shared/ipc/attachmentBytes.test.ts` — the guard's accept/refuse table, the identifier length
  bound at and past the limit, a `../../etc/passwd` identifier **accepted** here on shape (canonicity
  is `resolveAttachmentPath`'s), a `__proto__`-keyed ask built with `JSON.parse` refused, and the two
  channel constants distinct from each other and from the three sibling pairs.
- `src/main/attachmentBytes.test.ts` — the happy path with bytes byte-identical to the source and the
  event's keys exactly `type`/`attachmentId`/`bytes`; the exact-buffer property on a sub-4096-byte file
  (`byteOffset === 0`, `bytes.buffer.byteLength === bytes.length`, `Buffer.isBuffer` false) and on a
  file above 4096 bytes, so the copy is not size-conditional; a `..`-traversal identifier answering
  `refused` even when the attachment directory does not exist (proof no filesystem call decided it); an
  absolute-path identifier answering `refused`; an absent file and a directory at the resolved path
  both answering `unavailable`, asserted distinct from `refused`; `CAP + 1` asks fired in one tick
  yielding four `delivered` and one `busy`; the slot released on the failure path (`CAP` asks for an
  absent file, then a real ask succeeds); a refused ask consuming no slot; every path resolving rather
  than rejecting; diagnostic records carrying static codes only, with a positive control; and a
  module-graph assertion pinning the exact import set (no `electron`) and no `console.` call.

## Edge cases and limitations

- **No file-size ceiling on delivery**, by design — see § above.
- **No digest re-verification at read time**, by design — see § Security.
- **A symlink planted inside the attachment directory is followed** — deferred, see § Security.
- **The `contextBridge` hop is unobservable from this repo's test tiers** — see § "The one property no
  tier in this repo can pin". #868 is the first end-to-end proof.
- **Nothing evicts attachment files.** Retention has no ticket in any repo.
- **Is `4` the right concurrency cap?** It matches `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` and its
  ceiling argument exactly. Left as-is; revisit only if a consumer needs a larger simultaneous fan-out
  (e.g. many thumbnails at once).

## Related

- [Attachment path resolution](attachment-path-resolution.md) — `resolveAttachmentPath` (#818), the
  identifier gate consumed verbatim, no second escape check.
- [Attachment save](attachment-save.md) — #814, the closest analogue: same directory, same gate, same
  composition-root seam, same never-rejects driver answering its terminal as a resolved value.
- [Attachment retrieval](attachment-retrieval.md) — #996, the driver that puts bytes in the attachment
  directory this feature reads from, and the source of the concurrency-cap reasoning this feature's cap
  inherits (and the coalescing reasoning it deliberately does not).
- [Attachment reassembly and store](attachment-reassembly-and-store.md) — `storeAttachment` (#995), the
  sole writer into the directory this module reads, and the source of the size bound this module relies
  on rather than duplicates.
- `docs/specs/architecture/866-deliver-attachment-bytes-to-the-window.md` — the full architecture spec,
  including the security review and the two open questions this doc resolves as documented, not
  blocking.
- [#868](https://github.com/pyrycode/pyrycode-desktop/issues/868) — the thumbnail, the first renderer
  consumer of this channel and the first end-to-end proof of the `contextBridge` hop; not started.
- [#867](https://github.com/pyrycode/pyrycode-desktop/issues/867) — open in the OS image viewer, the
  other remaining consumer of [attachment retrieval](attachment-retrieval.md)'s directory; not started.
