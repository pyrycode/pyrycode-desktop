# Attachment transfer (send driver)

The **drive** in the middle of the attachment upload chain: [`planAttachmentChunks`](attachment-chunk-envelope.md)
(#860) splits a file into ordered `attachment_chunk` payloads; [`parseInboundMessage`](attachment-stored-wire-types.md)
(#964/#965) narrows the daemon's two terminal answers; this feature puts every chunk on the live session,
watches for the one terminal, and resolves the transfer exactly once. Ships **no IPC command, no daemon
event, and no renderer change** — the outcome is a value returned to the caller. Surfacing it to the window
is [#862](https://github.com/pyrycode/pyrycode-desktop/issues/862)'s job.

Introduced in [#861](https://github.com/pyrycode/pyrycode-desktop/issues/861), split from #685 (the
terminal-answer decode was carved into #961→#964/#965 during refinement). SSOT for the wire contract is
`pyrycode/pyrycode` `docs/protocol-mobile.md` § Attachments.

## Correlation is the design

`daemonConnection.ts` already has two correlate-a-reply-to-a-request patterns before this ticket —
`pendingSettings` (a `Map` from envelope id) and `pendingCreateFolders` (a `Set` used the same way), see
[Daemon connection — correlation](daemon-connection-correlation.md). Copying either wholesale would produce
a driver that never resolves:

- **Rejects fit the envelope-id shape.** An `error` frame's `in_reply_to` names a chunk this transfer sent,
  and every id it minted is known here — a membership test is exactly right.
- **The success reply does not.** Its `in_reply_to` names *the chunk whose arrival completed the transfer*,
  not the chunk with the highest index. Chunks are index-addressed and may be reassembled in any order, so
  which id will close the set is unpredictable to the sender. `InboundDaemonMessage`'s `attachment-stored`
  arm deliberately carries no `inReplyTo` for this reason (see
  [Attachment-stored wire types](attachment-stored-wire-types.md)) — the payload's `attachment_id`, a value
  *this client chose*, is the only handle that works.

**Match the success on the attachment id, the rejects on the envelope ids — both, not one.**

## Two layers

### 1. State machine — `src/main/transport/attachmentTransfer.ts` (new)

A settle-once handle, structurally a sibling of
[`createBundleReassembler`](debug-bundle-reassembly.md): a `settled` flag makes every method inert after
the first settle, so "exactly one terminal" is a property of construction, not of a guard at each call site.

```ts
export type AttachmentTransferFailure =
  | DaemonErrorOutcome        // every daemon-mapped verdict, both legs (#965, widened #999)
  | 'not-connected'           // no live session when the upload was requested
  | 'connection-lost'         // the session went away mid-transfer
  | 'send-failed'             // this client could not put a chunk on the wire

export type AttachmentTransferResult = { ok: true } | { ok: false; outcome: AttachmentTransferFailure }

export interface AttachmentTransferDeps {
  sendChunk: (payload: AttachmentChunkPayload) => number   // MAY throw; returns the envelope id sent
  yieldToEventLoop?: () => Promise<void>                    // default: a setImmediate macrotask
  onProgress?: AttachmentTransferProgress                   // #864 — see below
  diagnosticLog?: DiagnosticLog
}

export type AttachmentTransferProgress = (sentChunks: number, totalChunks: number) => void

export interface AttachmentTransfer {
  readonly attachmentId: string
  start(): void                              // idempotent; begins the send loop
  sentEnvelope(envelopeId: number): boolean  // the REJECT correlation key
  stored(): void                             // settles ok
  fail(outcome: AttachmentTransferFailure): void
  readonly result: Promise<AttachmentTransferResult>   // resolves exactly once; NEVER rejects
}

export function createAttachmentTransfer(
  input: AttachmentChunkPlanInput,   // reused verbatim from attachmentChunkPlan.ts — not re-declared
  deps: AttachmentTransferDeps
): AttachmentTransfer
```

**Armed, not driving.** The factory sends nothing; `start()` is a separate call. Not ceremony: an `async`
body runs synchronously to its first `await`, so a factory that also drove would put chunk 0 on the wire
*before* its caller could record the handle in the correlation slot, and a fast reply would race an unarmed
slot. `requestDebugBundle` solves the same problem by arming the reassembler before building the request
frame; here the send is the driver's own loop, so the seam is the explicit `start()`.

**Why the loop yields.** The send loop checks the `settled` flag before each chunk and `await`s
`yieldToEventLoop()` between chunks — a real `setImmediate` macrotask, not a microtask. Inbound frames
arrive on socket events, which are macrotasks; a microtask yield would let the whole plan drain before any
reject could be observed, and "no further chunks go out after a settle" would be unenforceable. This also
keeps a large file from buffering its whole base64 into the socket in one synchronous turn.

**Reporting how far the transfer has got — `onProgress` (#864).** The plan's `chunks.length` and the
`sentEnvelopes.size` this module already tracked were both invisible one layer up, which is why a large
upload looked like a hang in the composer before this ticket. `drive()`'s loop calls a `reportProgress`
helper after `sentEnvelopes.add(envelopeId)` and before the `yieldToEventLoop` await — after the set has
grown so the reported count matches what the settle log would report for the same moment, and before the
yield so no report is ever a chunk behind. `reportProgress` re-reads `settled` itself (the same flag the
loop checks, not a second rule kept in step with it) and returns without calling `onProgress` if it is
already true — sound because the check and the call are synchronous with each other, and the only settle
that can land mid-drive arrives during the loop's `await`, never between these two lines. That single
flag is the entire mechanism behind "no progress survives the terminal" (AC3 of #864): a report and a
chunk stop for the same reason.

The call is wrapped in its own `try`/`catch` that drops the caught object unexamined — `drive()` is
documented never to reject and `onProgress` is the first foreign callback inside its loop, so a consumer
that throws (a window destroyed between a liveness check and its send, one layer up) must not turn
`void drive()` into an unhandled main-process rejection. Classify-don't-forward, inherited #62.

`AttachmentTransferProgress` returns `void`, and the loop never `await`s it — a constraint the return
type enforces rather than a style choice. The `yieldToEventLoop` macrotask between chunks is what creates
the window in which an inbound reject can be observed; an awaited consumer would let a slow renderer
stall the send loop and stretch that window arbitrarily, turning a display concern into a transport one.

**Whether a report becomes anything is not this module's decision.** Every chunk of every transfer is
reported; the threshold that decides whether a small upload is worth an IPC message at all —
`ATTACHMENT_PROGRESS_MIN_CHUNKS` — lives with the client's other bounds in
[attachment upload](attachment-upload.md)'s `src/main/attachmentUpload.ts`, one layer up. No
new log record for it, either: a per-chunk diagnostic line would put up to `ATTACHMENT_MAX_UPLOAD_CHUNKS`
entries in one upload's debug bundle, and the existing `started` and settle records already carry the
same two figures (`count`, `bytes`).

**Envelope-id minting stays outside this module.** `sendChunk` *returns* the id it sent under rather than
minting one, because ids come from `daemonConnection`'s single monotonic counter and `transport/` must not
reach into it — resolved as Open Question 1 during implementation, matching the design as proposed.

**No retry, deliberately.** Every reject on this leg is either permanent for the file or carries a
MUST-back-off obligation with no `retry_after_s` on the wire to derive a delay from (see
[Daemon error outcome](daemon-error-outcome.md)), and the user can attach again. A retry loop defends a
failure mode nobody has observed on this client; it earns its own ticket once one is, and only with a real
backoff.

**Content-free log, structurally, not by a scrubber.** `DiagnosticEvent` has no field shaped to carry a
filename, a path, or payload bytes, so the file's name and contents are unrepresentable in a record. What
this module logs: a static `event` name (`'attachment-upload'`), the client-owned `code` (`'started'` /
`'stored'` / an `AttachmentTransferFailure`), the chunk `count`, and — on `start()` only — the file's
`bytes` length. `count` and `bytes` are explicitly allowlisted content-free fields; the relay already
observes per-chunk ciphertext lengths, so neither is a new disclosure. **`attachment_id` is deliberately
never logged**, even though it is not a capability and would be a convenient correlation handle: it is
minted by this module's caller (#862) from material this module cannot see, so an id ever derived from the
filename would leak the filename through a field that looks safe.

**Declined: converting `planAttachmentChunks` to a generator.** The ticket left this slice's memory
profile (an N-byte file materialises N bytes of input plus ~1.33N of base64, simultaneously, for the whole
round trip) as this ticket's call. Declined: the saving would be only the base64 (`size`/`sha256` are over
the whole file, so the input must stay resident regardless), the client-side size bound that decides how
large N gets is #862's, and nothing has been observed to strain on the current profile. See
[Attachment chunk envelope](attachment-chunk-envelope.md) for where the signature-compatible conversion
would land if a future ticket needs it.

### 2. Wiring — `src/main/daemonConnection.ts`

- **`const activeTransfers = new Set<AttachmentTransfer>()`** — a `Set`, not the debug bundle's single
  slot: two files can be attached in one session, and a lone slot would have to abandon the first to admit
  the second. Membership plus a scan is the whole query — the success reply is looked up by `attachmentId`,
  the rejects by `sentEnvelope` — over a handful of entries at most. Single-writer, the `pendingSettings`
  rationale: every mutation runs to completion inside a synchronous body.
- **`uploadAttachment(input, onProgress?): Promise<AttachmentTransferResult>`**, added to the
  `DaemonConnection` interface. `requestDebugBundle`'s posture, not `send`'s silent no-op: resolves `{ ok:
  false, outcome: 'not-connected' }` when `driver === null`, because this call has a caller awaiting a
  terminal. Otherwise constructs the transfer with a `sendChunk` closure that captures `nextEnvelopeId`
  *before* the build increments it (the `createWorkspaceFolder` template), **arms before driving** —
  `activeTransfers.add` then `start()`, so both inbound correlations can find the transfer before chunk 0
  goes out — and `await`s the result inside a `try`/`finally` that always removes the entry. Never throws
  and never rejects out of the module (parity #490, restated for a promise-returning method): a
  synchronous construction throw is caught and resolves `send-failed`.
  **`onProgress` (#864) is a second parameter, not a field on `input`** — `input` is the plan's own input
  and is spread onto every chunk payload, so a callback has no business there — and it is passed straight
  into the transfer's deps with no policy added at this hop: both early exits (the `not-connected` return
  and the construction-throw backstop) return before any transfer exists, so neither can report progress.
- **`sendAttachmentChunk(payload)`** — the `sendChunk` seam: captures `nextEnvelopeId`, builds the envelope
  via `buildAttachmentChunk`, advances the counter only on a successful build, sends, and returns the id.
- **Inbound `attachment-stored` arm** — the only inbound arm in this file that correlates on a **payload
  field** rather than `Envelope.in_reply_to`: scans `activeTransfers` for `attachmentId ===` match and calls
  `.stored()`, returning on the first hit. At most one transfer settles per reply even under a caller that
  violated the id-uniqueness contract. No match (a stale reply, or a daemon naming a transfer never
  started) is dropped — no event, no log, no throw. Emits **no** `DaemonEvent`.
- **Inbound `daemon-error` arm** — a third correlation in the existing unique-per-request-envelope-id tier
  (see [Daemon connection — correlation](daemon-connection-correlation.md)), checked after
  `pendingCreateFolders` inside the `if (inReplyTo !== undefined)` block. A match (`transferForEnvelope`)
  consumes the frame entirely — calls `.fail(inbound.outcome)` and `return`s, skipping both
  `reassembler?.fail` and the modal FIFO shift, on the same argument its two siblings already carry: an
  envelope id is minted once, so at most one of the three correlation stores can hold it. The outcome
  carried is the client-owned `DaemonErrorOutcome` #965 already mapped off the daemon's `code` string —
  nothing here re-parses it. Since #999 widened that type to the retrieval leg's two codes as well, this
  arm can in principle receive one of them from a hostile daemon (a forged `error` frame whose
  `in_reply_to` correlates to a pending upload chunk); from a conforming daemon only the six upload-leg
  values ever reach here, because a retrieval reject correlates to a `request_attachment` id, never a
  chunk's — see [Daemon error outcome](daemon-error-outcome.md#security-review).
- **Teardown net — `failAttachmentTransfers()`**, `failBundleStream`'s twin: snapshots and clears the set
  **before** failing each entry `'connection-lost'` (release-then-fail, so the module holds no reference to
  an abandoned transfer). Called at all four `failBundleStream` sites — `relay-link-down`, `terminal`,
  connection-level `error`, and `dial()` — because a teardown re-dials into a fresh Noise session the
  daemon-side transfer does not survive, and this is also what makes `dial()`'s reset of `nextEnvelopeId` to
  2 safe: every live transfer is failed before ids recycle, so a stale id can never mis-correlate on the
  reconnected session.

## Data flow

```
uploadAttachment(input)
  driver === null? ──yes──▶ { ok:false, outcome:'not-connected' }
  │no
  createAttachmentTransfer(input, { sendChunk: sendAttachmentChunk, onProgress, diagnosticLog })
  activeTransfers.add(transfer)        ◀── ARM
  transfer.start()                     ◀── DRIVE (loop yields between chunks, reports progress before each yield)
  await transfer.result
  finally: activeTransfers.delete(transfer)

Inbound 'message' → parseInboundMessage → kind:
  'attachment-stored' → scan activeTransfers by attachmentId → transfer.stored()      → { ok:true }
  'daemon-error' with inReplyTo → transferForEnvelope(inReplyTo) → transfer.fail(outcome) → { ok:false, outcome }

Connection teardown (relay-link-down / terminal / error / dial()) → failAttachmentTransfers()
  → every live transfer.fail('connection-lost')
```

## Error handling

| Failure | Detected at | Outcome |
|---|---|---|
| No live session at request time | `uploadAttachment` guard | `not-connected` |
| `WireEncodeError` on an over-cap envelope, or a driver throw | `sendChunk` throws → caught by the loop | `send-failed` — the caught object is dropped, never inspected (it could echo the envelope's base64) |
| Daemon reject correlated to a sent chunk | `daemon-error` arm → `transferForEnvelope` | the decoded `DaemonErrorOutcome` — six values reachable from a conforming daemon on this leg ([#965](daemon-error-outcome.md)); the type also carries the retrieval leg's two ([#999](daemon-error-outcome.md)), not reachable here except from a hostile daemon |
| Socket drop / relay close / driver error / re-dial mid-transfer | `failAttachmentTransfers()` | `connection-lost` |
| Daemon success naming this transfer | `attachment-stored` arm | `{ ok: true }` |

All outcomes are client-owned literals; nothing throws out of either module, and no caught object is
inspected or forwarded (classify-don't-forward, inherited #62).

## Security properties

`security-sensitive`; architect self-review verdict **PASS**, four SHOULD FIX items addressed in prose
rather than new code (see `docs/specs/architecture/861-attachment-send-driver.md` § Security review for
the full findings):

- **Trust boundaries.** The decoded `attachment_id`, the reject `code`, and the numeric `in_reply_to` are
  all used as comparands and dropped — never stored, never a lookup path. `AttachmentTransferFailure`'s
  every inhabitant is a literal written in this repo, so a value of that type provably holds no daemon
  text. The residual is a buggy-caller case (#862 minting a duplicate `attachment_id`), stated as
  `uploadAttachment`'s uniqueness precondition rather than defended against — a duplicate requires a
  caller contract violation, and a settled transfer has already left `activeTransfers`.
- **No filesystem I/O.** This slice never resolves, joins, opens, or writes a path — it receives
  `bytes: Uint8Array` already in memory.
- **First `async` method on `DaemonConnection`.** Every sibling is `void`/never-throws; `uploadAttachment`
  wraps its construction so every path resolves a value and the method **never rejects**, closing the
  unhandled-main-process-rejection surface a forgotten `.catch()` in #862 would otherwise open.
- **Per-transfer deadline: deliberately absent, and named as a residual.** A live session whose daemon
  accepts every chunk and never answers leaves the transfer unsettled indefinitely. The deterministic
  backstop is in different fabric one layer down — `relayConnection.ts`'s `WIRE_PONG_TIMEOUT_MS` (30s)
  self-terminates a dead socket, whose terminal fails every active transfer — so only a *live-but-silent*
  daemon reaches the residual. Not defended here: no such hang has been observed, and inventing a timeout
  constant for it would be exactly the unobserved-failure-mode defence the pipeline forbids
  (Evidence-Based Fix Selection). A future ticket that observes one owns the fix.
- **Concurrency.** The send loop is owned by its handle and cancelled by the settle itself — there is no
  cancellable I/O to `AbortSignal`, no timer, no listener. `settled` is re-read after every `await`, never
  cached across the gap. `failAttachmentTransfers` clears the set before failing a snapshot of it, so no
  mutation occurs during iteration.
- **Threat model.** A malicious content-blind relay can drop, delay, reorder, or flood, none of which
  produce a wrong terminal (reordering is harmless — the receiver is index-addressed — and the Noise AEAD
  prevents forging an in-session frame). A hostile daemon's every field is fail-closed decoded before
  reaching this module; a daemon that lies about storage success is inside the trust boundary the
  authenticated session establishes and is accepted, not defended against. The renderer has no path to
  this code in this slice. Unbounded memory on a very large file is real and out of scope — the
  client-side size bound is #862's.
- **`onProgress` (#864) — the two guards are each synchronous with the action they guard, so there is no
  gap for a concurrent settle to land in.** `settled` is re-read and `onProgress` called within one loop
  iteration with no `await` between them. The disclosure this seam ultimately carries — `totalChunks`
  reveals the chosen file's size to within `ATTACHMENT_CHUNK_DATA_BYTES`, the first field on
  `AttachmentUploadEvent` derived from the file rather than a client-owned constant — is accepted at the
  wire-contract layer, not decided here; see [Attachment upload](attachment-upload.md) and
  `docs/specs/architecture/864-attachment-upload-progress.md` § Security review. This module's own
  obligation is narrower: never await the callback (a `void` return type makes that unavailable), and
  never let a throwing consumer escape `drive()`.

## Testing

- **`src/main/transport/attachmentTransfer.test.ts`** — the state machine against a fake `sendChunk` and
  an immediate `yieldToEventLoop`: every chunk sent in index order carrying the same `attachment_id` /
  `size` / `sha256` / `total_chunks` (a count-and-identity check, not a hand-written expected list); a
  zero-byte file sends exactly one chunk; `stored()` / `fail(o)` resolve the matching result for a
  representative outcome from each failure row; **settling mid-loop stops the send** (a `sendChunk` that
  settles on chunk 0 leaves chunk 1 unsent, never also resolving `{ ok: true }`); `stored()` after
  `fail()`, `fail()` after `stored()`, and a double `fail()` are all inert — the promise settles once; a
  throwing `sendChunk` resolves `send-failed` and sends no further chunk; `sentEnvelope` is true for every
  id `sendChunk` returned and false otherwise; `start()` twice sends each chunk once; a captured
  `DiagnosticLog`'s records never carry the filename or any file byte, walked positively rather than
  assumed absent.
- **`src/main/daemonConnection.test.ts`** (extended) — against `fakeDaemon.ts`'s existing scaffolding:
  `uploadAttachment` before connect resolves `not-connected`; driving against
  `attachmentStoredReplyFrames` with a *completing index other than the last* resolves `{ ok: true }` —
  the case an envelope-id-only correlation would fail; driving against `attachmentRejectReplyFrames`
  resolves the mapped outcome without also failing an in-flight bundle or shifting the modal FIFO; an
  `attachment_stored` naming an id no transfer holds resolves nothing; a connection terminal mid-transfer
  and a `dial()` both resolve `connection-lost`; two concurrent transfers each resolve on their own reply.

One consequence surfaced while writing the wiring-layer specs: at that layer, *how far* the send loop got
when a reject lands is genuinely racy (a real `setImmediate` racing a real `setTimeout`), so "no further
chunks go out" is asserted one layer down in `attachmentTransfer.test.ts`, where the yield seam is injected
and the gap is deterministic. The wiring layer asserts only the terminal.

**`onProgress` (#864)**, added to `attachmentTransfer.test.ts`: fires once per chunk with the running
`sentEnvelopes.size` and the plan's `chunks.length`; does not fire after a settle arrives mid-transfer
(the existing mid-transfer reject fixture, extended); a throwing `onProgress` neither stops the loop nor
rejects the transfer, which still delivers its single terminal; a transfer built with no `onProgress`
behaves exactly as it did before this ticket. One layer up, in `attachmentUpload.test.ts`'s
`reportingHarness`, the fixture for "no progress survives the terminal" needs `after` reports that land
once the driver has already answered — see [Attachment upload](attachment-upload.md) § Testing for why
that fixture has to be a macrotask (`setTimeout`) rather than a microtask (`queueMicrotask`).

## Edge cases and limitations

- **No per-transfer deadline.** See § Security properties above — a live-but-silent daemon leaves the
  transfer unsettled until the relay's own pong timeout eventually tears the connection down.
- **`attachment_id` uniqueness is the caller's contract, not enforced here.** Two transfers sharing an id
  would let a single success reply resolve whichever the scan reaches first. #862 owns minting it.
- **Two concurrent transfers never cross.** Disjoint envelope ids (one monotonic counter) and distinct
  attachment ids mean neither correlation can mis-attribute a reply between them, even though their chunks
  interleave on the wire — the receiver tolerates that, addressing by `attachment_id` + `index`.
- **A transfer that resolves failed is resolved, not retried, and not reported anywhere by this module** —
  surfacing the outcome to the window is #862's slice.
- **A withheld terminal leaves progress stuck, never the transfer.** This module's own state settles
  exactly once regardless of whether the daemon ever answers a fully-sent transfer; what a withheld
  terminal leaves stuck is the *composer's rendered figure*, one layer up — see
  [Attachment upload](attachment-upload.md) § Edge cases.

## Related

- [Attachment chunk envelope](attachment-chunk-envelope.md) — the producer half this drives:
  `planAttachmentChunks` / `buildAttachmentChunk` (#860), and the declined generator-conversion this
  ticket's own docblock left open.
- [Attachment-stored wire types](attachment-stored-wire-types.md) — the positive-terminal decode (#964)
  this drives on, including the `attachment_id`-not-envelope-id correlation argument this feature's design
  is built from.
- [Daemon error outcome](daemon-error-outcome.md) — the reject-code decode (#965, extended to the
  retrieval leg by #999) whose `DaemonErrorOutcome` union this feature widens whole into its own
  `AttachmentTransferFailure`, on purpose: narrowing it back down here would reintroduce a runtime branch
  for a frame the wire cannot produce on this leg.
- [Debug-bundle reassembly](debug-bundle-reassembly.md) — the settle-once / connection-teardown-net
  structural precedent (`bundleReassembler.ts`, `failBundleStream`) this feature's `attachmentTransfer.ts`
  and `failAttachmentTransfers` mirror.
- [Daemon connection](daemon-connection.md) / [Daemon connection — correlation](daemon-connection-correlation.md)
  — the composition/wiring layer hosting `activeTransfers`, `uploadAttachment`, and the two inbound
  correlation arms; the correlation doc's § Attachment-upload correlation is the third-tier sibling of
  the settings/create-folder correlations.
- [Fake daemon](fake-daemon.md#attachment-upload-scaffolding-964) — `attachmentStoredReplyFrames` /
  `attachmentRejectReplyFrames`, the scaffolding this feature's wiring-layer specs drive against rather
  than adding their own.
- `docs/specs/architecture/861-attachment-send-driver.md` — the full architecture spec, including the
  security review this doc summarizes and the three open questions (all resolved as designed — see the
  spec's § Revisions).
- [Attachment upload (pick, guard, drive, report)](attachment-upload.md) — [#862](https://github.com/pyrycode/pyrycode-desktop/issues/862),
  the caller: picks the file, guards its size, mints `attachment_id`, and reports the outcome to the
  window on its own dedicated channel. [#864](https://github.com/pyrycode/pyrycode-desktop/issues/864)
  is the sibling that owns the progress *threshold* (`ATTACHMENT_PROGRESS_MIN_CHUNKS`) and the
  post-terminal `terminal` guard one layer above this module's `onProgress` seam.
