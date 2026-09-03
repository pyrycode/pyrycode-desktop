# #995 — Reassemble a retrieved attachment and store it on this machine

## Files read

| Read | Why it matters |
|---|---|
| `src/main/transport/bundleReassembler.ts` → `createBundleReassembler`, `BundleConsumer`, `BundleFailReason`, `BundleReassembler` | The structural model named by the ticket: settle-once via a `settled` flag, an injected consumer called exactly once with `complete` XOR `fail`, a closed set of static reasons, log-free because it holds content-bearing bytes. Its contiguous-`seq` arithmetic is what this slice must **not** copy. |
| `src/main/transport/bundleReassembler.test.ts` → `makeConsumer` | The spy-consumer test harness shape (arrays for `completed` / `failed`), reused here. |
| `src/main/transport/inboundMessage.ts` → `RetrievedAttachmentChunk`, `parseAttachmentChunkPayload` | The exact input type and the exact set of per-frame checks already enforced upstream — integer `total_chunks >= 1`, integer `index` in `[0, total_chunks)`, non-empty `attachment_id`, strict base64 on `data`. Also records that `size` gets **only** `requireNumber` — no integer check — which is a check this slice must own. |
| `src/main/transport/inboundMessage.ts` → `DaemonErrorOutcome` member `attachment-stream-aborted` | Assigns the discard-the-partial obligation to this ticket by number, and states this is the retrieval leg's only negative signal. |
| `src/main/attachmentPath.ts` → `resolveAttachmentPath`, `ResolveAttachmentPathResult` | The identifier→path gate this slice consumes verbatim. Its docblock names this ticket as the writer it was built for and forbids a second escape check. |
| `src/main/fileSecretPersistence.ts` → `fileSecretPersistence` | The write recipe: `mkdir` recursive owner-only, unique temp suffix, `writeFile` owner-only, `rename` onto the target, `unlink` the temp on failure. That is what makes "no partial file" true rather than intended. |
| `src/main/saveDebugBundle.ts` → `saveDebugBundle` | The composition-root seam (`dir` is a parameter, so no `electron` import) — and the **rejected** half: its exclusive-create no-overwrite rule protects a user-facing Downloads name and must not be copied onto a content-addressed path. |
| `src/main/attachmentUpload.ts` → `ATTACHMENT_MAX_UPLOAD_CHUNKS`, `ATTACHMENT_MAX_UPLOAD_BYTES` | The sibling magnitude bound and the argument behind it (chunks, because chunks cost time), which transfers to this leg. |
| `src/shared/wire/types.ts` → `AttachmentChunkPayload`, `ATTACHMENT_CHUNK_DATA_BYTES`, `MAX_PLAINTEXT_BYTES` | The eight-field wire contract, the 45000 stride the cross-check divides by, and the per-frame cap that bounds one chunk's decoded bytes. |
| `~/Workspace/Projects/pyrycode` `internal/relay/v2attachmentstream.go` → `ReassembleAttachment`, `attachmentEnvelopes` | The receiver-contract oracle. Its check order, its duplicate refusal, its size-from-what-arrived assembly and its exact-hex digest comparison are what this module mirrors. |
| `~/Workspace/Projects/pyrycode` `internal/attachments/admission.go` → `CheckDeclaration` | The daemon-published cross-check, and its explicit statement that **magnitude is not checked here** and belongs to a sibling. |
| `docs/knowledge/features/attachment-path-resolution.md` § "The on-disk shape this commits future work to" | Records the extension-less flat-file commitment and that whether #687 stores a flat file or a directory was left open — this slice closes it as a flat file. |
| `docs/knowledge/features/debug-bundle-reassembly.md` § Testing, § Security properties | The coverage shape for a reassembler and the content-hygiene posture (never log, never build a path from a wire field). |
| `docs/knowledge/features/attachment-upload.md`, `attachment-chunk-retrieval-decode.md` | The send leg's terminal vocabulary (`refused` vs `failed`) and what the decode boundary already guarantees. |
| `CLAUDE.md` § Layout, § Conventions, § Build and test | Transport stays out of the window; renderer tests are static renders (irrelevant here — this is main-only); test-first. |

Codegraph is not indexed for this repo (`.codegraph/` holds a config and no database; `codegraph_*` returns *"CodeGraph not initialized"*, recorded 2026-08-24). This list was built with grep and Read.

## Design source

N/A — two main-process modules with no consumer wired in this slice and nothing UI-visible. The ticket body carries no `## Figma` section for that reason, and the visual-fidelity check is intentionally skipped.

## Context

The host serves a retrieval as a stream of `attachment_chunk` frames and never sends a completion frame. `parseInboundMessage` already claims each frame and hands up a `RetrievedAttachmentChunk` with `data` decoded to raw bytes. Nothing turns that stream into a file. This slice does, and it also answers the question three other tickets are waiting on — **where a fetched attachment lives on this machine**.

It ships **unwired**: #996 is the driver that routes frames by `inReplyTo`, composes the two entry points here, and owns the terminal the window sees. That is the same ordering `bundleReassembler.ts` landed in ahead of `debugBundleDownload.ts`.

Two things the design deliberately does not do, both because a neighbour already does them:

- **No index-range check.** `parseAttachmentChunkPayload` refuses `index` outside `[0, total_chunks)` per frame, and the declaration-agreement branch below pins `total_chunks` for the whole transfer, so a re-check here would be dead code that reads as diligence.
- **No second escape check.** `resolveAttachmentPath` owns the identifier→path gate and its docblock forbids a divergent copy.

**Sizing, re-counted against this plan.** Two production files, four new exported types, zero consumer call sites, five acceptance criteria, and nine reject branches in the reassembler state machine (eight decided plus the pass-through door) with two more arms in the store's linear write — every line of the size-S table holds except total written work, which lands around 1200 lines against a 800-line ceiling. The overage is stated rather than hidden and it is not split, because the floor rule outranks the ceiling here: cutting the write off the reassembly yields a reassembler whose only consumer is the writer, and a writer with nothing to write — the second half of that pair changes nothing observable on its own and could not be verified alone. The same shape held for the five siblings in this feature (#860 at 1214 lines, #861 at 1859, #862 at 1529, #964 at 1095, #965 at 1062), each of which shipped clean as one ticket.

**This design deserves no ADR.** The two decisions a reader might expect one for — the flat-file extension-less on-disk shape, and refusing a duplicate index rather than absorbing it — are both already recorded upstream: the first in `docs/specs/architecture/818-attachment-identifier-path-resolution.md` and `docs/knowledge/features/attachment-path-resolution.md` as an open question this slice closes, the second in the daemon's own published receiver rules. The documentation phase should fold both into `docs/knowledge/features/` rather than mint a decision record.

## Design

Two new production files, plus their tests. Nothing existing is modified.

### 1. `src/main/transport/attachmentReassembler.ts` — the accumulator

Pure, synchronous, state-holding, log-free, filesystem-free. Mirrors `bundleReassembler`'s posture and its consumer contract; the arithmetic is the oracle's, not the neighbour's.

```ts
/** The closed set of failure reasons. Static strings — no wire value is ever interpolated. */
export type AttachmentFailReason =
  | 'stream-contradiction'   // the stream contradicts itself or the transfer it claims to be
  | 'too-large'              // the declared size exceeds this client's magnitude bound
  | 'verification-failed'    // assembled length or digest disagrees with the declaration
  | 'stream-aborted'         // pushed in: the host abandoned the retrieval (#999)
  | 'connection-lost'        // pushed in: the connection dropped mid-stream

export interface AttachmentConsumer {
  /** The one success terminal: the whole verified file, in index order. */
  complete(bytes: Uint8Array): void
  /** The one failure terminal: a static reason, never a wire value. */
  fail(reason: AttachmentFailReason): void
}

export interface AttachmentReassembler {
  /** Accept one already-decoded chunk. Settles the consumer on the completing chunk or on a refusal. */
  chunk(chunk: RetrievedAttachmentChunk): void
  /** The pass-through door for externally-signalled abandonment. Not a decision this module makes. */
  fail(reason: 'stream-aborted' | 'connection-lost'): void
}

/** This client's magnitude bound on one retrieval; the send leg's figure and argument, restated. */
export const ATTACHMENT_MAX_RETRIEVAL_CHUNKS = 512
export const ATTACHMENT_MAX_RETRIEVAL_BYTES: number  // = CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES

export function createAttachmentReassembler(
  attachmentId: string,
  consumer: AttachmentConsumer
): AttachmentReassembler
```

`attachmentId` is the identifier **this client asked for**, supplied by #996. It is the second half of the two-key correlation: `inReplyTo` (#996's half) says which request a frame answers; the payload id says which transfer it belongs to, and the failure only the payload id catches is the host answering the right ask with the wrong bytes.

**State.** A `Map<number, Uint8Array>` keyed by index; the captured `total` / `size` / `digest` from the first accepted chunk; a `started` flag and a `settled` flag. A `Map` rather than a pre-sized array so that literally nothing is allocated or reserved from either declared number, and so the prototype-pollution hazard of a plain-object index does not arise at all. Completion is `map.size === total` — a count of **distinct indices**, never a count of frames.

**`chunk()` order, and the order is the design.** Every step below is a `stream-contradiction` unless named otherwise:

1. Inert if already settled.
2. `chunk.attachment_id !== attachmentId` → refuse. Checked on every chunk including the first.
3. **First accepted chunk only** — the declaration gate, run before anything is sized:
   1. `Number.isInteger(size)` false or `size < 0` → refuse. `parseAttachmentChunkPayload` gives `size` only a `requireNumber`, so `NaN`, `Infinity` and a fractional value all reach here. `Number.isInteger` is false for all three, so this one predicate covers them; a separate `isFinite` would be dead.
   2. `size > ATTACHMENT_MAX_RETRIEVAL_BYTES` → **`too-large`**. This runs *before* the cross-check, not after, and that ordering carries the whole soundness argument for step 3.3: the bound is 23,040,000, far below `Number.MAX_SAFE_INTEGER`, so once it passes, `size` is an exact integer and every arithmetic derived from it is exact. Upstream's banned `(size + bound - 1) / bound` overflow does not transfer — a JS number is a double and does not wrap — but its cousin does: above `MAX_SAFE_INTEGER` a declared size is no longer an exact integer, so an equality derived from it is unsound. Refusing on magnitude first is what closes that, which is why this bound is not merely a memory-footprint nicety.
   3. `total_chunks !== Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_DATA_BYTES))` → refuse. The daemon-published cross-check (`CheckDeclaration`), which is what makes `total_chunks` trustworthy relative to `size`. **No client-invented chunk-count ceiling** is added: the magnitude bound plus this equality already put `total_chunks` at 512 or below, and an invented ceiling would fail-close a large valid transfer.
   4. Capture `total`, `size`, `digest`; set `started`.
4. **Every later chunk** — `total_chunks`, `size` or `sha256` differing from the captured triple → refuse. `filename` and `mime_type` are deliberately **not** cross-checked: they are display strings with no addressing or verification consequence, and the oracle does not compare them either.
5. `map.has(index)` → refuse. A repeat is refused, not absorbed: absorbing would need either a second and weaker comparison of the two copies, or a silent choice of one, and this transport is ordered and reliable so a repeat is not a retransmit.
6. Store the chunk. If `map.size !== total`, return with no terminal.
7. **Completion.** Concatenate indices `0 … total-1` from the map — sized from the lengths that actually arrived, never from `size`. Then, in this order: assembled length `!== size` → `verification-failed`; `createHash('sha256').update(bytes).digest('hex') !== sha256` → `verification-failed`. Only then `complete(bytes)`.

The digest is **integrity, not authenticity** — the same party supplies the bytes and the digest — and it is checked because a truncated or reordered stream is the realistic failure and, with no completion frame, the count is the only other signal there is. Comparison is exact equality on lowercase hex over the whole file (`digest('hex')` is lowercase): a prefix or case-insensitive comparison would be a hole, and the decode layer deliberately does not length-check `sha256`. No constant-time primitive: neither side is a secret.

**The magnitude bound is minted here rather than imported.** `ATTACHMENT_MAX_UPLOAD_BYTES` lives in `src/main/attachmentUpload.ts`, which pulls `node:fs/promises`, `node:crypto`, the IPC event types and `DiagnosticLog`. Importing it would invert this repo's `main/ → transport/` direction and drag that graph into a module whose whole value is being small and dependency-light. Instead the retrieval sibling is derived from the shared wire constant with the same argument — 512 chunks × 45000 raw bytes = 23,040,000, ~30s at a 1 MB/s relay uplink, a main-process footprint of the file plus its accumulated chunks — and **a test pins the two equal**, so drift reddens deterministically without coupling the production graphs. For calibration, the daemon's own default per-upload bound is 16 MiB, which sits below this figure, so the bound fails nothing a default host could have stored.

### 2. `src/main/attachmentStore.ts` — the write

```ts
/** The one directory name every composition root joins onto Electron's per-user app-data path. */
export const ATTACHMENT_DIR_NAME = 'attachments'

export type StoreAttachmentResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'store-failed' }

export async function storeAttachment(
  baseDir: string,
  attachmentId: string,
  bytes: Uint8Array
): Promise<StoreAttachmentResult>
```

Body: `resolveAttachmentPath(baseDir, attachmentId)`; on refusal return `store-failed` having touched nothing. Then `mkdir(baseDir, { recursive: true, mode: 0o700 })`, `writeFile(tmp, bytes, { mode: 0o600 })` where `tmp` is the target plus a `randomBytes(6)` hex suffix and `.tmp`, then `rename(tmp, target)`. On any throw: best-effort `unlink(tmp)`, return `store-failed`.

**Never throws, and that is a containment decision rather than a style one.** A `node:fs` `ErrnoException` carries the offending path in its own message, and a caller that catches and logs it would put an attachment path into a log that AC 5 forbids one from reaching. Swallowing the errno behind a static reason keeps that structural instead of relying on every future caller's discipline.

**`rename` rather than a direct `writeFile(target)` also closes a symlink redirect.** `rename` replaces whatever sits at the target — following a symlink there is not something it does — whereas a plain write to the target would follow one and write through it. The temp path is unguessable (`randomBytes(6)`), so nothing can be pre-planted there either. This is the same property `saveDebugBundle` gets from `O_EXCL` and it arrives here by a different route.

**Two branches, one reason.** The path refusal and the write failure are separate branches with one `store-failed` reason. A consumer's action is identical in both — the bytes are not on disk, do not present the file — and the ticket's own instruction is to merge a further failure mode into an existing reason rather than mint a ninth and tenth. The two branches stay separately testable by their observable effect: the refusal creates no directory at all.

**What is deliberately not copied from `saveDebugBundle`:** its exclusive-create no-overwrite rule. That exists to protect a user-facing Downloads name; this path is content-addressed by identifier, so re-fetching the same attachment must land on the same file rather than accumulate suffixed copies. Temp-then-rename is the `fileSecretPersistence` recipe instead, which is an atomic replace.

`baseDir` is a parameter, so the module carries no `electron` import and its test graph is Electron-free. `ATTACHMENT_DIR_NAME` is exported so #996, #814, #866 and #867 read one string rather than four that drift; joining it onto `app.getPath('userData')` stays at the composition-root edge.

**The stored file is extension-less and that is a commitment other tickets read** (`attachment-path-resolution.md` § "The on-disk shape"): nothing about an attachment's type may be inferred from its on-disk name. `filename` and `mime_type` ride every chunk and never reach a path segment.

### Composition (#996's, stated so the seam is legible)

`reassembler.complete(bytes)` fires **synchronously**; the store is the asynchronous step after it. #996 owns the window-visible terminal and must not fire it before the file exists.

Two obligations this slice cannot enforce and therefore states, both recorded in the modules' own doc comments:

- **The identifier handed to `storeAttachment` is the one this client asked for**, the same value passed to `createAttachmentReassembler` — never `chunk.attachment_id` read back off the wire. The two are provably equal by the time `complete` fires, since a chunk naming a different transfer is refused, so this is a fragility to avoid rather than a hole to close.
- **The `path` on a successful store is a return value, not something to log or forward.** #814, #866 and #867 consume it; nothing may write it to a diagnostic record or send it to the window.

## State + concurrency model

No store slice, no React, no IPC — both modules are main-process leaves. The reassembler holds one transfer's state for the life of one retrieval and has nothing to cancel: it launches no async work, sets no timer and registers no listener. Its teardown path is the injected `fail()` door, which #996 calls on `attachment-stream-aborted` or on connection teardown; after it, `settled` makes every later frame inert, so a stray chunk arriving after abandonment cannot resurrect the buffer or re-settle the consumer. There is no per-transfer deadline, matching `attachmentTransfer.ts`'s recorded stance: the deterministic backstop is one layer down in `relayConnection`'s wire-pong timeout, and #996's teardown net turns that into this module's `connection-lost`.

`storeAttachment` is a single `await` chain with no shared mutable state and no check-then-act gap: `mkdir` is idempotent under `recursive: true`, the temp name is unique per call, and `rename` is atomic on one filesystem, so two concurrent stores of the same identifier both land whole and the loser is simply overwritten. Nothing here outlives the promise it returns.

## Error handling

Every failure is one static string from a closed set, carrying no wire value — no size, no index, no filename, no digest, no path.

| Branch | Terminal |
|---|---|
| `attachment_id` names another transfer | `stream-contradiction` |
| `size` not a non-negative integer | `stream-contradiction` |
| `size` above the magnitude bound | `too-large` |
| `total_chunks` disagrees with the size cross-check | `stream-contradiction` |
| a later chunk declares a different `total_chunks` / `size` / `sha256` | `stream-contradiction` |
| a duplicate index | `stream-contradiction` |
| assembled length ≠ declared `size` | `verification-failed` |
| digest ≠ declared `sha256` | `verification-failed` |
| host abandoned the stream / connection lost (pushed in) | `stream-aborted` / `connection-lost` |
| identifier refused by the path gate, or the write failed | `store-failed` |

Eight decided reject branches in the reassembler plus the pass-through door, and two in the store. The reason set is smaller than the branch set on purpose: what a consumer must tell apart is a structural contradiction, a size refusal, a verification failure, a host-signalled abort, a lost connection, and a local store failure.

Neither module logs. Both hold or write content-bearing bytes, so a diagnostic could echo them; the recognition layer already emits the only content-free records for this feature.

## Testing strategy

Vitest only, `environment: 'node'`. No Playwright spec: this slice is unwired and changes nothing a user can drive.

**`src/main/transport/attachmentReassembler.test.ts`** — a spy consumer in `bundleReassembler.test.ts`'s shape, plus a helper that builds a conforming `RetrievedAttachmentChunk` set from a byte array (real `sha256`, `total_chunks` from the published formula) so a scenario perturbs exactly one field:

- ordered multi-chunk → `complete` with the exact bytes; **out-of-order arrival → the same bytes** (the differentiator from the neighbour);
- one chunk; the zero-byte file (one empty chunk, `size` 0, `total_chunks` 1) → a zero-length `complete`;
- a stream missing one index → **no terminal at all** (asserted after a real microtask drain, not a single tick);
- duplicate index; a later chunk perturbing each of `total_chunks` / `size` / `sha256`; a chunk naming another `attachment_id` → `stream-contradiction`;
- declaration table: `size` negative / fractional / `NaN` / `Infinity` → `stream-contradiction`; `total_chunks` off by one either way → `stream-contradiction`; boundary rows at `size` 0, 45000, 45001 admitted;
- magnitude: `size` at the bound admitted (assert *no* terminal, so the row is non-vacuous), one over → `too-large`, and `2 ** 60` → `too-large` rather than any equality-derived verdict;
- assembled length ≠ `size` with a passing cross-check, and a digest perturbation → `verification-failed`;
- the pushed-in door for each external reason; settle-once (a chunk after `complete`, a second `fail`, a chunk after `fail` — all inert);
- `ATTACHMENT_MAX_RETRIEVAL_BYTES` pinned equal to `ATTACHMENT_MAX_UPLOAD_BYTES` **and** to `512 × ATTACHMENT_CHUNK_DATA_BYTES`;
- a module-graph assertion over the file's own source text: no `electron`, no `node:fs`.

**`src/main/attachmentStore.test.ts`** — against a throwaway temp dir, `saveDebugBundle.test.ts`'s harness shape. Per `attachment-path-resolution.md`'s recorded rule, path expectations are built **independently** of the function's own return value (`isAbsolute`, `dirname === baseDir`, `basename === id`, `extname === ''`), never by string equality against it:

- writes the exact bytes at the gate's path; creates the directory on first write, `0o700`; the file `0o600`;
- a second store of the same identifier replaces in place — one entry in the directory, new content (the anti-`saveDebugBundle` row);
- a non-canonical identifier → `store-failed` and **no directory created**;
- a write failure (a `baseDir` whose path is an existing regular file, so `mkdir` fails `ENOTDIR`) → `store-failed`, no file and no `.tmp` left anywhere;
- zero-byte bytes → a zero-length file, not an absence;
- an Electron-free module-graph assertion.

Fakes over mocks throughout: there is no transport boundary here to fake, and the filesystem is exercised for real against a temp directory.

## Open questions

- **Should the consumer carry a `progress` callback?** `bundleReassembler` has one; no acceptance criterion here needs it, and #996 feeds every chunk in so it can count them itself. Omitted as an unevidenced addition — resolve it in #996 if that ticket's window reporting actually wants it.
- **Aggregate footprint before the length check.** A non-conforming host could send `total_chunks` chunks each up to `MAX_PLAINTEXT_BYTES` of decoded data, so the accumulated buffer is bounded at roughly 512 × 64 KB ≈ 33 MB rather than at `size`, and the disagreement is caught only at the completion length check. Deliberately not defended with a running-total early-exit: that is an unobserved failure mode, the bound is the same magnitude as the accepted one, and the ticket is explicit that no eviction or streaming-to-disk is to be invented here.
- **Retention.** Nothing evicts these files; that has no ticket and is not this slice's to invent.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.** The untrusted→trusted crossing is upstream at `parseAttachmentChunkPayload`, which makes the *shape* trusted and never the *content* — its own docblock says so. The strongest property this design has is what it **does not read**: of the eight fields, `filename` and `mime_type` are never touched at all, which is the never-into-a-path rule made structural rather than checked. `attachment_id` is only ever a comparand against a client-held value; `index` is only ever a numeric `Map` key (so the `__proto__` hazard that bites a string-keyed plain object cannot arise); `total_chunks` and `size` are compared and cross-checked and never allocated from; `sha256` is a comparand; `data` is concatenated. The second boundary is `storeAttachment`'s signature, where `baseDir` is trusted composition-root input and `attachmentId` is untrusted — a distinction the type system cannot carry, so the doc comment states it, exactly as `resolveAttachmentPath` does.
- **[Tokens, secrets, credentials] Not applicable, with the storage choice stated.** Nothing here mints, stores, rotates or revokes a credential. `randomBytes(6)` from `node:crypto` supplies the temp-file suffix — collision avoidance, not a secret, and deliberately not `Math.random()`. What *is* new is that this is the first place this app writes **decrypted daemon-supplied content** to disk. `safeStorage` is rejected for it on purpose: it is built for short strings, not a 23 MB file, and it would raise nothing — an attacker with read access to `userData` already holds the secret-store ciphertexts, and the OS keychain is unlocked for that same user session. The posture is instead the diagnostic log's: owner-only directory, owner-only file, under the per-user app-data path.
- **[File / storage] Two bounded residuals, no MUST FIX.** Traversal is closed structurally by `resolveAttachmentPath`'s alphabet and no second check is written. There is no check-then-open anywhere — no `existsSync`, `mkdir` idempotent under `recursive`, a unique temp then an atomic `rename` — so there is no TOCTOU gap. Two residuals: (1) `mkdir(…, { mode: 0o700 })` does **not** re-chmod a directory that already exists, so the owner-only claim holds only for a directory this code created; bounded by `userData` already being per-user ACL'd and by the file's own `0o600`, and the test pins the mode on a directory this code created rather than overclaiming. (2) A symlink planted *inside* the attachment directory is not defended against, the same accepted residual `attachment-path-resolution.md` records — but note `rename` **replaces** a symlink at the target rather than writing through it, so the write itself cannot be redirected, and the temp path is unguessable.
- **[Inter-process / Electron attack surface] SHOULD FIX, handled by a doc line.** This slice adds no `BrowserWindow`, no `webPreferences`, no `contextBridge` API, no `ipcMain` channel and no protocol handler; `src/main/index.ts` is untouched. The live hazard is the inverse: both modules hold or write a user's decrypted file bytes, and a renderer barrel re-exporting either would put them in the web layer. The module-graph tests pin Electron-freeness but cannot pin renderer-freeness. Mitigated the way `attachmentTransfer.ts` already mitigates the identical hazard — an explicit "never re-export through a renderer barrel" line in the file header — which is the repo's established (advisory) control rather than a new mechanism invented here.
- **[Cryptographic primitives] No findings.** One primitive, `createHash('sha256')` from `node:crypto` — standard, not hand-rolled, no Noise involvement, no key and no nonce. Constant-time comparison is explicitly **not** used and the plan says why: neither the computed digest nor the declared one is a secret, both being functions of bytes the peer chose, so `timingSafeEqual` would protect nothing. The comparison that matters is exactness — lowercase hex over the whole file, never a prefix and never case-insensitive.
- **[Network & I/O] No findings; the memory bound is named.** No socket, no URL, no TLS decision here. Per-frame size is capped upstream by `MAX_PLAINTEXT_BYTES`; per-transfer size is capped by this client's own magnitude bound, refused *before* any arithmetic trusts the declaration. A relay that stalls a stream mid-transfer pins one reassembler's buffer — bounded at roughly 512 × 64 KB per in-flight retrieval, and released by the `fail()` door, which is what makes that door required rather than a convenience. There is deliberately no timeout minted here: the deterministic backstop is in different fabric one layer down, `relayConnection`'s wire-pong timeout, surfaced through #996's teardown as `connection-lost`.
- **[Error messages, logs, telemetry] No findings.** Both modules are log-free by construction. Every failure is a static string from a closed set; no size, index, filename, digest or path is interpolated into one. The load-bearing detail is that `storeAttachment` returns a result rather than rethrowing: a `node:fs` errno carries the offending path in its own message, so swallowing it behind `store-failed` keeps an attachment path out of any future caller's log structurally instead of by discipline. The success `path` is a return value that #996 must not log or forward — stated as a consumer obligation.
- **[Concurrency] OUT OF SCOPE — one residual, pointed at retention.** Nothing long-lived is launched: no timer, no listener, no async work in the reassembler, and one `await` chain with no shared state in the store. `settled` makes a post-abandonment frame inert, so a stray chunk cannot resurrect a discarded buffer or re-settle a consumer. The residual is a **process kill between `writeFile(tmp)` and `rename`**, which leaves an orphan `.tmp` in the attachment directory. It is not a partial *attachment*: its name is not a canonical identifier, so `resolveAttachmentPath` can never hand it to a consumer, and no partial target file can exist. It is litter, and litter belongs to retention — which has no ticket, is named in § Open questions, and is not this slice's to invent.
- **[Threat model alignment] No findings; the accepted limit is stated in the design.** Walking a **hostile daemon inside the session**, which picks every field: truncation and reordering are caught by the distinct-index count, the assembled-length check and the digest; cross-transfer contamination is caught by the payload-id check that `inReplyTo` alone cannot catch; memory exhaustion is caught by the magnitude bound; a path escape is unspellable and `filename`/`mime_type` are never read. What it **can** do is serve arbitrary bytes with a matching digest, because it supplies both — the design says outright that the digest is integrity and not authenticity, and that limit is inherent to the leg rather than a hole in this module. A **malicious relay** is content-blind and on-path: it can drop, delay or reorder; reorder is correct by design, and drop simply never completes until the teardown net fires. A **compromised renderer** reaches neither module — the most it can do is ask #996 to fetch an identifier, and a non-canonical one is refused by the gate before any filesystem call.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
