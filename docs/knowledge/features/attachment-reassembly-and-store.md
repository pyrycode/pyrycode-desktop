# Attachment reassembly and store

Turns the retrieval leg's stream of `attachment_chunk` frames into one whole, verified file, and puts
it on this machine — the answer to **where a fetched attachment lives**, which #814 (save into
Downloads), #866 (deliver bytes to the window) and #867 (open in the OS viewer) were all waiting on.
Two main-process modules, both leaves: [`createAttachmentReassembler`](#1-the-accumulator---srcmaintransportattachmentreassemblerts)
(accumulate, verify) and [`storeAttachment`](#2-the-write---srcmainattachmentstorets) (write).

Introduced in [#995](https://github.com/pyrycode/pyrycode-desktop/issues/995), split from #687. Ships
**unwired**: no `case 'attachment-chunk':` exists in `daemonConnection.ts` yet, so nothing calls either
module from a live session. [#996](https://github.com/pyrycode/pyrycode-desktop/issues/996) is the
driver — it routes frames by `inReplyTo`, composes the two entry points here, translates
[`DaemonErrorOutcome`](daemon-error-outcome.md)'s `attachment-stream-aborted` into this module's own
`stream-aborted`, and owns the terminal the window sees.

## What it does

### 1. The accumulator — `src/main/transport/attachmentReassembler.ts`

```ts
export type AttachmentFailReason =
  | 'stream-contradiction'   // the stream contradicts itself or the transfer it claims to be
  | 'too-large'               // declared size exceeds this client's magnitude bound
  | 'verification-failed'     // assembled length or digest disagrees with the declaration
  | 'stream-aborted'          // pushed in by #996: host abandoned the retrieval
  | 'connection-lost'         // pushed in by #996: connection dropped mid-stream

export interface AttachmentConsumer {
  complete(bytes: Uint8Array): void
  fail(reason: AttachmentFailReason): void
}

export interface AttachmentReassembler {
  chunk(chunk: RetrievedAttachmentChunk): void
  fail(reason: 'stream-aborted' | 'connection-lost'): void   // the pass-through door only
}

export const ATTACHMENT_MAX_RETRIEVAL_CHUNKS = 512
export const ATTACHMENT_MAX_RETRIEVAL_BYTES = ATTACHMENT_MAX_RETRIEVAL_CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES

export function createAttachmentReassembler(
  attachmentId: string,
  consumer: AttachmentConsumer
): AttachmentReassembler
```

Pure, synchronous, state-holding, log-free, filesystem-free — structurally
[`bundleReassembler`](debug-bundle-reassembly.md)'s twin: a `settled` flag, an injected consumer
called exactly once with `complete` XOR `fail`, a closed reason set. The arithmetic is deliberately
**not** copied from that neighbour — `bundleReassembler`'s contiguous ascending `seq` is the wrong
model here, because attachment chunks are **index-addressed and may arrive in any order**, and
`total_chunks` rides every chunk so there is no completion frame to wait for at all.

State is a `Map<number, Uint8Array>` keyed by index, plus the `total`/`size`/`digest` triple captured
from the first accepted chunk. A `Map` rather than a pre-sized array so nothing is ever allocated or
reserved from either declared number, and so the plain-object `__proto__` hazard cannot arise — the
keys are numbers, never strings. **Completion is `map.size === total` — a count of distinct indices,
never of frames received.** A zero-byte file is one chunk carrying zero bytes against a declared total
of 1 (the daemon fixes `total_chunks = max(1, ceil(size / 45000))` precisely to define that case), so
"no bytes" and "no chunks" are different things and only the second is an incomplete transfer.

**`chunk()`'s check order carries the whole soundness argument, and it is not interchangeable:**

1. Inert once `settled`.
2. `chunk.attachment_id !== attachmentId` → `stream-contradiction`, checked on every chunk including
   the first. This is the **second half of a correlation checked twice on purpose**: #996 routes a
   frame to this transfer by `inReplyTo` (which request it answers); the payload id says which
   transfer it belongs to. The failure only the payload id catches is the host answering the right
   ask with the wrong bytes.
3. **First accepted chunk only** — the declaration gate, in this exact order:
   1. `Number.isInteger(size)` false or `size < 0` → `stream-contradiction`. [`parseAttachmentChunkPayload`](attachment-chunk-retrieval-decode.md)
      gives `size` only a `requireNumber` — deliberately no integer check — so `NaN`, `±Infinity` and a
      fractional value all reach here; one `Number.isInteger` predicate covers all three.
   2. `size > ATTACHMENT_MAX_RETRIEVAL_BYTES` → `too-large`, checked **before** the cross-check below.
      This ordering is the point: the bound (23,040,000) sits far below `Number.MAX_SAFE_INTEGER`, so
      once it passes, `size` is an exact integer and every later equality derived from it is sound.
      The daemon's own banned ceiling form (`(size + bound - 1) / bound`, which overflows `int64` and
      launders a huge declaration back into a count of 1) does not transfer — a JS number is a double
      and does not wrap — but its cousin does: above `MAX_SAFE_INTEGER` a declared size is no longer an
      exact integer, so an equality derived from it is unsound. Refusing on magnitude first closes that.
   3. `total_chunks !== Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_DATA_BYTES))` → `stream-contradiction`.
      The daemon-published cross-check (`CheckDeclaration` in `pyrycode`'s `internal/attachments/admission.go`),
      which is what makes `total_chunks` trustworthy relative to `size`. **No client-invented
      chunk-count ceiling is added** — the magnitude bound plus this equality already put
      `total_chunks` at 512 or below, and an invented ceiling would fail-close a large valid transfer.
4. **Every later chunk** — `total_chunks`, `size` or `sha256` differing from the captured triple →
   `stream-contradiction`. `filename`/`mime_type` are deliberately **not** cross-checked: display
   strings with no addressing or verification role, and the oracle doesn't compare them either.
5. `map.has(index)` → `stream-contradiction`. **A repeated index is refused, not absorbed** — absorbing
   would need either a second, weaker digest comparison or a silent pick of one copy, and this
   transport is ordered and reliable, so a repeat is not a retransmit; it is a stream that is not the
   one the daemon publishes.
6. Store the chunk. If the map isn't yet full, return with no terminal.
7. **Completion** — concatenate indices `0..total-1` (sized from what actually arrived, never from
   `size`), then: assembled length `!== size` → `verification-failed`; else
   `sha256('hex') !== digest` → `verification-failed`; only then `complete(bytes)`. The digest is
   **integrity, not authenticity** — the same party supplies the bytes and the digest — checked because
   a truncated or reordered stream is the realistic failure and, with no completion frame, the count is
   the only other signal there is. Comparison is exact equality on lowercase hex over the whole file;
   no constant-time primitive, since neither side is a secret.

**`ATTACHMENT_MAX_RETRIEVAL_BYTES` is minted here, not imported from [`attachmentUpload.ts`](attachment-upload.md)'s
`ATTACHMENT_MAX_UPLOAD_BYTES`.** Importing it would invert this repo's `main/ → transport/` direction
and drag `node:fs`, the IPC event types and `DiagnosticLog` into a module whose whole value is being
small and dependency-light. Instead the figure and argument (512 chunks, because chunks are what cost
time) are restated, and **a test pins the two constants equal** so a later divergence reddens
deterministically instead of drifting into two ceilings nobody reconciles. The daemon's own default
per-upload bound is 16 MiB — below this figure — so the bound fails nothing a default host could have
stored.

The `fail()` door on `AttachmentReassembler` takes **only** `'stream-aborted' | 'connection-lost'` —
every other member of `AttachmentFailReason` is a verdict this module reaches on its own, and a driver
must not be able to assert one externally.

### 2. The write — `src/main/attachmentStore.ts`

```ts
export const ATTACHMENT_DIR_NAME = 'attachments'

export type StoreAttachmentResult = { ok: true; path: string } | { ok: false; reason: 'store-failed' }

export async function storeAttachment(
  baseDir: string,
  attachmentId: string,
  bytes: Uint8Array
): Promise<StoreAttachmentResult>
```

Resolves the identifier through [`resolveAttachmentPath`](attachment-path-resolution.md)'s gate —
**no second escape check written here** — then follows [`fileSecretPersistence`](secure-store.md)'s
recipe: `mkdir(baseDir, { recursive: true, mode: 0o700 })`, write to a `randomBytes(6)`-suffixed temp
path at `mode: 0o600`, `rename` onto the target, best-effort `unlink` the temp on any throw. That
temp-then-rename is what makes "no partial file survives" true rather than merely intended, and
`rename` **replaces** whatever sits at the target rather than following a symlink there — the same
property [`saveDebugBundle`](save-debug-bundle.md) gets from `O_EXCL`, arriving here by a different
route, since the temp name is unguessable and nothing can be pre-planted at it.

**Never throws**, a containment decision rather than a style one: a `node:fs` `ErrnoException` carries
the offending path in its own message, and swallowing the errno behind the static `store-failed` reason
keeps an attachment path out of a future caller's log structurally, rather than resting on that
caller's discipline.

**Two branches, one reason.** A refused identifier and a failed write both return `store-failed` — a
consumer's answer to either is identical (the bytes are not on disk, do not present the file), and the
ticket's own instruction was to merge a further failure mode into an existing reason rather than mint a
ninth and tenth. They stay separately testable by observable effect: the refusal creates no directory
at all.

**Deliberately not copied from `saveDebugBundle`: its exclusive-create no-overwrite rule.** That
protects a user-facing Downloads name; this path is content-addressed by identifier, so re-fetching the
same attachment must land on the **same** file rather than accumulate suffixed copies — a second store
of one identifier simply replaces the first.

`baseDir` is a parameter, so this module carries no `electron` import and its test graph is
Electron-free; `app.getPath('userData')` stays at the composition-root edge, where the future
composition root joins `ATTACHMENT_DIR_NAME` onto it. `ATTACHMENT_DIR_NAME` is exported so #996, #814,
\#866 and #867 read one string rather than four that drift.

**The stored file is extension-less** — [`attachment-path-resolution.md`](attachment-path-resolution.md#the-on-disk-shape-this-commits-future-work-to)'s
open question, closed here as a **flat file, not a per-attachment directory**: a direct child of
`baseDir` named by the identifier verbatim. `filename` and `mime_type` ride every chunk and never reach
a path segment — nothing about an attachment's type may be inferred from its on-disk name. #867 owns
the consequences of that for opening a file in the OS; #814's Downloads copy takes its name from the
wire through [`sanitizeAttachmentFilename`](attachment-filename-sanitiser.md), never from this name.

## Composition (stated for #996, which owns it)

`reassembler.complete(bytes)` fires **synchronously**; `storeAttachment` is the asynchronous step
after it. The window-visible terminal must not fire before the file exists. Two obligations this
slice cannot enforce and states in its own doc comments instead:

- The identifier handed to `storeAttachment` must be the one this client asked for — the same value
  passed to `createAttachmentReassembler` — never `chunk.attachment_id` read back off the wire. The two
  are provably equal by the time `complete` fires (a chunk naming a different transfer is refused), so
  this is a fragility to avoid rather than a hole to close.
- The `path` on a successful store is a return value, not something to log or forward.

## Error handling

| Branch | Reason |
|---|---|
| `attachment_id` names another transfer | `stream-contradiction` |
| `size` not a non-negative integer | `stream-contradiction` |
| `size` above `ATTACHMENT_MAX_RETRIEVAL_BYTES` | `too-large` |
| `total_chunks` disagrees with the size cross-check | `stream-contradiction` |
| a later chunk declares a different `total_chunks` / `size` / `sha256` | `stream-contradiction` |
| a duplicate index | `stream-contradiction` |
| assembled length ≠ declared `size` | `verification-failed` |
| digest ≠ declared `sha256` | `verification-failed` |
| host abandoned the stream / connection lost (pushed in by #996) | `stream-aborted` / `connection-lost` |
| identifier refused by the path gate, or the write failed | `store-failed` |

Neither module logs. Both hold or write a user's decrypted file bytes, so a diagnostic record could
echo them; every failure is a static string from a closed set, carrying no size, index, filename,
digest or path.

## Testing

Vitest only, `environment: 'node'`. No Playwright spec — this slice is unwired and changes nothing a
user can drive.

`attachmentReassembler.test.ts` builds a conforming `RetrievedAttachmentChunk` set from a byte array
(real `sha256`, `total_chunks` from the published formula) so a scenario perturbs exactly one field:
out-of-order arrival still completing with the exact bytes (the differentiator from `bundleReassembler`);
the zero-byte-file row; a stream missing one index producing **no terminal at all**, asserted after a
real microtask drain rather than a single tick; the declaration table (`size` negative/fractional/`NaN`/`Infinity`,
`total_chunks` off by one, boundary rows at `size` 0/45000/45001); the magnitude table (`size` at the
bound admitted — asserted as *no* terminal so the row is non-vacuous — one over refused, `2**60`
refused rather than producing any equality-derived verdict); settle-once coverage; and
`ATTACHMENT_MAX_RETRIEVAL_BYTES` pinned equal to both `ATTACHMENT_MAX_UPLOAD_BYTES` and
`512 × ATTACHMENT_CHUNK_DATA_BYTES`.

`attachmentStore.test.ts` runs against a throwaway temp directory, [`saveDebugBundle.test.ts`](save-debug-bundle.md)'s
harness shape. Per `attachment-path-resolution.md`'s recorded rule, path expectations are built
**independently** of the function's own return value (`isAbsolute`, `dirname === baseDir`,
`basename === id`, `extname === ''`), never by string equality against it. Covers: the directory
created on first write at `0o700` and the file at `0o600`; a second store of the same identifier
replacing in place (one directory entry, new content — the anti-`saveDebugBundle` row); a
non-canonical identifier refused with **no directory created**; a write failure (`baseDir` pointed at
an existing regular file, so `mkdir` fails `ENOTDIR`) leaving no file and no `.tmp` anywhere; zero-byte
bytes landing as a zero-length file, not an absence.

Two lessons surfaced during implementation, worth carrying into the next module that assembles bytes
from parts:

- **`Buffer.concat` through a `Uint8Array`-typed signature is a subtype leak only a test catches.**
  `toEqual` distinguishes a `Buffer` from a `Uint8Array` (it carries a `type: "Buffer"` marker in the
  diff), so a `Buffer.concat`-based assembly reddens at the assertion rather than at the contract.
  Assembling with `new Uint8Array(n)` + `.set()` instead fixes it at the source, matches the Go
  oracle's `make([]byte, 0, n)`, and drops the `Buffer` global from the module entirely.
  `bundleReassembler` has the same latent shape today and has not yet been bitten by it.
- **`mkdir(..., { mode: 0o700 })` does not re-chmod a directory that already exists.** The owner-only
  claim holds only for a directory this code created — the test pins the mode on a freshly-created
  directory rather than overclaiming a re-run's mode on one that already existed.

## Security review

Architect self-review verdict: **PASS**. Full findings in `docs/specs/architecture/995-attachment-reassembly-and-store.md`
§ Security review; the load-bearing ones:

- The strongest property is what the reassembler **does not read**: `filename`/`mime_type` are never
  touched at all; `index` is only ever a numeric `Map` key (no `__proto__` hazard); `total_chunks` and
  `size` are compared and cross-checked and never allocated from; `sha256` is a comparand; `data` is
  concatenated. `storeAttachment`'s `baseDir` is trusted composition-root input, `attachmentId` is
  untrusted — a distinction the type system can't carry, so the doc comment states it.
- First place this app writes **decrypted daemon-supplied content** to disk. `safeStorage` is rejected
  for it on purpose — it's built for short strings, not a multi-MB file, and would raise nothing an
  attacker with `userData` read access doesn't already have. The posture is instead the diagnostic
  log's: owner-only directory, owner-only file, under the per-user app-data path.
- Two bounded residuals, no MUST FIX: `mkdir`'s mode doesn't re-chmod an existing directory (bounded by
  `userData` already being per-user ACL'd, and by the file's own `0o600`); a symlink planted *inside*
  the attachment directory is not defended against — the same accepted residual `attachment-path-resolution.md`
  records — but `rename` replaces a symlink at the target rather than writing through it, so the write
  itself can't be redirected.
- A hostile daemon inside the session can serve arbitrary bytes with a matching digest, because it
  supplies both. The digest is integrity, not authenticity, and that limit is inherent to the leg
  rather than a hole in this module.
- No timeout is minted here. The deterministic backstop is one layer down in `relayConnection`'s
  wire-pong timeout, surfaced through #996's teardown as `connection-lost`.

## Edge cases and limitations

- **Aggregate footprint before the length check.** A non-conforming host could send `total_chunks`
  chunks each up to `MAX_PLAINTEXT_BYTES` of decoded data, so the accumulated buffer is bounded at
  roughly 512 × 64 KB ≈ 33 MB rather than at `size`, and the disagreement is caught only at the
  completion length check. Deliberately not defended with a running-total early-exit — an unobserved
  failure mode at the same magnitude as the accepted one.
- **No per-transfer deadline in this module.** A relay that stalls a stream mid-transfer pins one
  reassembler's buffer indefinitely; released only by the `fail()` door, which #996 must call on
  teardown. The deterministic backstop is `relayConnection`'s wire-pong timeout, one layer down.
- **A process kill between `writeFile(tmp)` and `rename` leaves an orphan `.tmp`.** Not a partial
  *attachment* — its name is not a canonical identifier, so `resolveAttachmentPath` can never hand it to
  a consumer — but it is litter. Retention/cleanup has no ticket and is not this slice's to invent.
- **No index-range re-check.** `parseAttachmentChunkPayload` already refuses `index` outside
  `[0, total_chunks)` per frame, and the declaration-agreement branch here pins `total_chunks` for the
  whole transfer, so a re-check would be dead code that reads as diligence.
- **Nothing evicts stored attachment files.** Retention has no ticket.

## Related

- [Attachment-chunk retrieval decode](attachment-chunk-retrieval-decode.md) — the recognition layer
  (#998) whose `RetrievedAttachmentChunk` is this module's exact input, and whose per-frame checks
  (integer `total_chunks >= 1`, integer `index` in range, non-empty `attachment_id`, strict base64)
  this module deliberately does not re-run.
- [Attachment path resolution](attachment-path-resolution.md) — the identifier→path gate `storeAttachment`
  consumes verbatim (#818); its "on-disk shape" open question is what this ticket closes.
- [Debug-bundle reassembly](debug-bundle-reassembly.md) — the settle-once, injected-consumer structural
  model this module copies, and deliberately does not copy the contiguous-`seq` arithmetic from.
- [Save debug bundle](save-debug-bundle.md) — the composition-root seam (`baseDir` as a parameter, no
  `electron` import) `attachmentStore.ts` reuses.
- [Secure store](secure-store.md) — hosts `fileSecretPersistence`, the temp-then-rename write recipe
  `storeAttachment` follows.
- [Daemon error outcome](daemon-error-outcome.md) — `attachment-stream-aborted`'s discard-the-partial
  obligation, which this module's `fail('stream-aborted')` door exists to satisfy once #996 translates
  the daemon-mapped outcome into it; this module does not import `DaemonErrorOutcome` itself.
- [Attachment upload](attachment-upload.md) — `ATTACHMENT_MAX_UPLOAD_BYTES`/`_CHUNKS`, the send-leg
  sibling this module's magnitude bound restates rather than imports, and pins equal by test.
- [Attachment transfer](attachment-transfer.md) — the mirror-image send driver (#861); the structural
  precedent both it and this module trace back to `bundleReassembler`.
- `docs/specs/architecture/995-attachment-reassembly-and-store.md` — the full architecture spec,
  including the security review this doc summarizes.
- [#996](https://github.com/pyrycode/pyrycode-desktop/issues/996) — the driver that wires both modules
  into a live session; not started.
