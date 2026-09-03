# 861 — Send an attachment's chunks and resolve the transfer

## Files read

| Path | Symbols that matter | Why it matters |
|---|---|---|
| `src/main/transport/attachmentChunkPlan.ts` | `planAttachmentChunks`, `AttachmentChunkPlanInput` | The producer half this driver iterates. Its input type is the driver's input type verbatim — `attachment_id` is caller-minted, and `size` / `sha256` / `total_chunks` are spread onto every chunk structurally. Its docblock names this ticket as the owner of the materialise-the-whole-plan memory profile. |
| `src/main/transport/attachmentChunkEnvelope.ts` | `buildAttachmentChunk`, `AttachmentChunkInput` | One envelope per chunk, built from the consumer's own id counter and clock. MAY throw `WireEncodeError` on an over-cap envelope; its docblock says the caller catches and drops. |
| `src/main/transport/inboundMessage.ts` | `DaemonErrorOutcome`, `InboundDaemonMessage`'s `daemon-error` and `attachment-stored` members | #961/#964's decode boundary. `daemon-error` carries a client-owned `outcome` plus an optional numeric `inReplyTo`; `attachment-stored` carries the payload and **deliberately no `inReplyTo`** — the docblock is the primary argument for this slice's two-key correlation. |
| `src/main/transport/bundleReassembler.ts` | `createBundleReassembler`, `BundleReassembler`, `BundleFailReason` | The settle-once precedent: a `settled` flag makes every method inert after the one terminal, and the failure reason vocabulary is a closed set of static client-owned strings. Its structure is what `createAttachmentTransfer` mirrors. |
| `src/main/daemonConnection.ts` | `createDaemonConnection`, `onDriverEvent`, `pendingSettings`, `pendingCreateFolders`, `failBundleStream`, `dial`, `requestDebugBundle`, `createWorkspaceFolder` | The wiring layer. `createWorkspaceFolder` is the capture-the-id-before-the-build send template; `requestDebugBundle` is the arm-before-send + fail-on-not-connected template; `failBundleStream` is the connection-teardown net (four call sites) this slice's twin joins; `dial` is where per-connection correlation state is cleared. |
| `src/main/diagnosticLog.ts` | `DiagnosticEvent` | The content-free log envelope. It has **no field shaped to carry a filename, a path, or payload bytes** — AC4's guarantee is the type, not a scrubber. |
| `src/main/transport/fakeDaemon.ts` | `attachmentStoredReplyFrames`, `attachmentRejectReplyFrames`, `AttachmentRejectCode` | The simulated daemon replies #964/#965 added, so this slice drives against them rather than inventing its own. |
| `docs/knowledge/features/attachment-chunk-envelope.md` | § "Why `bundleReassembler.ts` is the wrong precedent", § "Edge cases and limitations" | `attachment_chunk` is index-addressed and may be reassembled in any order — the reason the success reply cannot be correlated by envelope id. Also records that a source-purity test grepping for `'console.'` matches a header comment that merely names the string. |
| `docs/knowledge/features/attachment-stored-wire-types.md` | — | The `attachment_stored` decode's own overview; confirms #861 is the first consumer of both halves. |

## Design source

**Figma:** N/A — this slice ships no renderer change. It is a main-process transport driver whose scope
boundary (ticket § Scope boundary) explicitly excludes IPC, daemon events, and the window. There is
nothing visual to reproduce, so the verifier's visual-fidelity check is intentionally skipped.

## Context

The upload leg is an assembled chain missing its middle. `planAttachmentChunks` (#860) turns a file
into ordered `attachment_chunk` payloads; `buildAttachmentChunk` (#860) serialises one into envelope
bytes; `parseInboundMessage` (#964/#965) narrows the daemon's two terminal answers onto client-owned
values. Nothing drives the send, so nothing resolves. This slice is that drive: put every chunk on the
live session, watch for the one terminal answer, and settle the transfer exactly once.

**Correlation is the design.** `daemonConnection.ts` has two correlate-a-reply-to-a-request patterns —
`pendingSettings` (a `Map` from envelope id) and `pendingCreateFolders` (a `Set` used the same way) —
and copying either wholesale produces a driver that never resolves. The rejects fit that shape: a
reject is an `error` envelope whose `in_reply_to` names a chunk this transfer sent, and those ids are
all known here. The success reply does not: its `in_reply_to` names *the chunk whose arrival completed
the transfer*, and since chunks are index-addressed and may be reassembled in any order, the sender
cannot predict which of its ids that will be. `parseInboundMessage`'s `attachment-stored` member omits
`inReplyTo` for exactly this reason, so the mistake is structurally unavailable rather than merely
warned against. **Match the success on the attachment id, the rejects on the envelope ids — both.**

No ADR is warranted: this slice introduces no new decision, it consumes two already recorded ones
(ADR 0002's process boundary, and #964's omit-the-envelope-id argument).

## Design

Two production files. One new module holds the transfer state machine; `daemonConnection.ts` wires it
to the live session and to the inbound switch.

### `src/main/transport/attachmentTransfer.ts` (new)

A settle-once handle, structurally a sibling of `createBundleReassembler`: a `settled` flag makes every
method inert after the one terminal, so "exactly one terminal" is a property of construction rather
than of a guard at each call site.

```ts
/** The closed set of ways a transfer can fail. The seven DaemonErrorOutcome members are the
 *  daemon's verdicts (#965); the three below are this client's own. Every inhabitant is a literal
 *  written in this repo — no daemon text ever reaches it. */
export type AttachmentTransferFailure =
  | DaemonErrorOutcome
  | 'not-connected'    // no live session when the upload was requested
  | 'connection-lost'  // the session went away mid-transfer
  | 'send-failed'      // this client could not put a chunk on the wire

export type AttachmentTransferResult = { ok: true } | { ok: false; outcome: AttachmentTransferFailure }

export interface AttachmentTransferDeps {
  /** Put one chunk on the wire; returns the envelope id it went out under. Throws when the
   *  envelope could not be built or the session refused it. */
  sendChunk: (payload: AttachmentChunkPayload) => number
  /** Yield to the event loop between chunks so an inbound terminal can land mid-transfer.
   *  Default: a `setImmediate` macrotask. A DI seam, like daemonConnection's `now`. */
  yieldToEventLoop?: () => Promise<void>
  diagnosticLog?: DiagnosticLog
}

export interface AttachmentTransfer {
  /** The id this transfer's success reply must name. */
  readonly attachmentId: string
  /** Begin the send loop. Idempotent — a second call is a no-op. */
  start(): void
  /** True iff `envelopeId` names a chunk this transfer put on the wire. */
  sentEnvelope(envelopeId: number): boolean
  /** The daemon stored the transfer. Settles ok; inert once settled. */
  stored(): void
  /** A terminal failure. Settles failed; inert once settled. */
  fail(outcome: AttachmentTransferFailure): void
  /** Resolves exactly once with the single terminal. NEVER rejects. */
  readonly result: Promise<AttachmentTransferResult>
}

export function createAttachmentTransfer(
  input: AttachmentChunkPlanInput,
  deps: AttachmentTransferDeps
): AttachmentTransfer
```

`AttachmentChunkPlanInput` is reused verbatim rather than re-declared — the driver's input *is* the
planner's input, and re-declaring it would let the two drift.

**Arm before drive.** The factory builds the plan and returns the handle without sending anything;
`start()` is a separate call. This is not ceremony: an `async` body runs synchronously to its first
`await`, so a factory that also drove would put chunk 0 on the wire *before* its caller could record
the handle in the correlation slot, and a fast reply would race an unarmed slot. `requestDebugBundle`
solves the same problem by arming the reassembler before building the request frame; here the send is
the driver's own loop, so the seam is an explicit `start()`.

**Why the loop yields.** AC3 requires that no further chunks go out after a settle. A fully synchronous
loop cannot honour that — inbound frames arrive on socket events, which are macrotasks, so a reject
could never be observed mid-loop. The loop therefore checks the settled flag before each send and
awaits `yieldToEventLoop()` between chunks. This also keeps a large file from buffering its whole
base64 into the socket in one turn.

### `src/main/daemonConnection.ts` (modified)

- **State:** `const activeTransfers = new Set<AttachmentTransfer>()`. A `Set`, not the debug bundle's
  single slot: two files can be attached in a session, and a single slot would have to fail the first
  one to admit the second. Membership is the only query, and both correlations are a scan over a
  handful of entries. Single-writer, on the `pendingSettings` rationale — every mutation runs to
  completion inside a synchronous body.
- **`uploadAttachment(input: AttachmentChunkPlanInput): Promise<AttachmentTransferResult>`**, added to
  the `DaemonConnection` interface. Resolves `{ ok: false, outcome: 'not-connected' }` when
  `driver === null` — `requestDebugBundle`'s posture, not `send`'s silent no-op, because this call has
  a caller awaiting a terminal. Otherwise: construct the transfer with a `sendChunk` closure that
  captures `nextEnvelopeId` *before* the build increments it (the `createWorkspaceFolder` template),
  add it to the set, `start()`, and `await` its result in a `try`/`finally` that removes it from the
  set. NEVER throws out of the module (parity #490).
- **Inbound `attachment-stored` arm:** find the active transfer whose `attachmentId` equals the decoded
  payload's, call `.stored()`. No match — a stale reply, or a hostile daemon naming a transfer this
  client never started — is dropped.
- **Inbound `daemon-error` arm:** a third correlation in the existing unique-per-request-envelope-id
  tier, added after the `pendingCreateFolders` check inside the `if (inReplyTo !== undefined)` block. A
  match consumes the frame entirely (`return`), skipping both `reassembler?.fail` and the modal FIFO
  shift, on the same argument the two siblings already carry: an error correlated by a unique
  per-request id is unambiguously the reply to that request. Order relative to the two siblings is
  immaterial — an envelope id is minted once, so at most one of the three can hold it.
- **Teardown net:** `failAttachmentTransfers()`, the `failBundleStream` twin, clears the set first then
  fails each entry `'connection-lost'` (release-then-fail, so the module holds no reference to a
  transfer it has already abandoned). Called at all four `failBundleStream` sites — `relay-link-down`,
  `terminal`, `error`, and `dial()` — because every one of them is transfer-fatal for the same reason
  it is stream-fatal: the daemon-side transfer does not survive a fresh Noise session.

### Declined: converting `planAttachmentChunks` to a generator

The ticket leaves this to this slice. Declining. The saving is the ~1.33N bytes of base64, not the N
bytes of input (`size` and `sha256` are over the whole file, so it must be in memory regardless), and
the client-side size bound that decides how large N gets lands in #862. Nothing has been observed to
strain on it. Converting it would also change a tested contract in a file this ticket otherwise does
not touch. Recorded here so the verifier reads it as a decision rather than an omission.

## State + concurrency model

No store slice and no IPC — this slice is entirely inside the background process.

- **Ownership.** Each transfer's async send loop is owned by its handle. The loop's every iteration is
  gated on the `settled` flag, so a settle from any source ends it at the next check; there is no
  timer, no listener, and nothing to unsubscribe.
- **Cancellation.** The settle *is* the cancellation path. `fail()` is reachable from the teardown net
  (all four connection-fatal events plus `dial()`), from a correlated reject, and from a local send
  throw. No `AbortController` is threaded because there is no cancellable I/O call to abort — the
  loop's only await is a yield to the event loop.
- **Check-then-act.** `settled` is read and written only inside synchronous method bodies; the loop
  re-reads it after each `await` rather than caching it across the gap.
- **Interleaving.** Two concurrent transfers hold disjoint envelope ids (one monotonic counter) and
  distinct attachment ids, so neither correlation can cross them. Chunks of two transfers interleave on
  the wire, which the receiver tolerates — it addresses by `attachment_id` + `index`.
- **Shutdown.** `stop()` stops the driver, whose terminal reaches `onDriverEvent`'s `terminal` arm and
  fails every active transfer. A transfer never outlives its connection.

## Error handling

Every failure resolves as `{ ok: false, outcome }` where `outcome` is a client-owned literal; nothing
throws out of either module, and no caught object is inspected or forwarded (classify-don't-forward,
inherited #62).

| Failure | Detected at | Outcome |
|---|---|---|
| No live session at request time | `uploadAttachment` guard | `not-connected` |
| `WireEncodeError` on an over-cap envelope, or a driver throw | `sendChunk` throws → caught by the loop | `send-failed` |
| Daemon reject correlated to a sent chunk | `daemon-error` arm | the decoded `DaemonErrorOutcome` (seven values, #965) |
| Socket drop / relay close / driver error / re-dial mid-transfer | `failAttachmentTransfers()` | `connection-lost` |
| Daemon success naming this transfer | `attachment-stored` arm | `{ ok: true }` |

**No retry, deliberately** (ticket § No automatic retry). Every reject on this leg is either permanent
for that file or carries a MUST-back-off obligation with no `retry_after_s` on the wire to derive a
delay from, and the user can attach again. A retry loop defends a failure mode nobody has observed on
this client; it earns its own ticket once one is, and only with a real backoff.

**Reject codes are never re-parsed here.** #965 already mapped the daemon's `code` string onto a
client-owned outcome at the decode boundary; this module receives the outcome and carries it. Per
`CLAUDE.md` the daemon's string must never become a lookup path, a filename, or a cache key.

## Testing strategy

All vitest (node environment). No renderer change, so no `renderToStaticMarkup` spec; no interaction,
so no Playwright spec.

**`src/main/transport/attachmentTransfer.test.ts` (new)** — the state machine against a fake
`sendChunk` and an immediate `yieldToEventLoop`:

- Every chunk goes out in index order, each carrying the same `attachment_id`, `size`, `sha256` and
  `total_chunks` (AC1). Asserted as a *count-and-identity* check over the captured payloads, not a
  hand-written expected list.
- A zero-byte file sends exactly one chunk; a file spanning several strides sends `total_chunks`.
- `stored()` resolves `{ ok: true }`; `fail(o)` resolves `{ ok: false, outcome: o }` for a
  representative outcome from each of the four failure rows above.
- **Settling mid-loop stops the send** (AC3): a `sendChunk` that settles the transfer on chunk 0 leaves
  chunk 1 unsent, and the result is the failure — never also `{ ok: true }`.
- **Exactly one terminal**: `stored()` after `fail()`, `fail()` after `stored()`, and a double
  `fail()` are all inert; the promise settles once.
- A `sendChunk` that throws resolves `send-failed` and sends no further chunk.
- `sentEnvelope` is true for every id `sendChunk` returned and false for one it did not.
- `start()` twice sends each chunk once.
- **AC4**: with a captured `DiagnosticLog`, no record's field equals the filename or contains any file
  byte. Asserted by walking every captured record's own values — a positive check over what was
  logged, so it cannot pass by the module simply never logging under test.

**`src/main/daemonConnection.test.ts` (extended)** — the wiring against the existing `fakeDaemon`
builders:

- `uploadAttachment` before connect resolves `not-connected`.
- Driving against `attachmentStoredReplyFrames` with a *completing index other than the last* resolves
  `{ ok: true }` — the AC2 case the envelope-id shape would fail.
- Driving against `attachmentRejectReplyFrames` resolves the mapped outcome, and the frame does not
  also fail an in-flight bundle or shift the modal-answer FIFO.
- An `attachment_stored` naming an id no transfer holds resolves nothing and is dropped.
- A connection terminal mid-transfer resolves `connection-lost`; a `dial()` does the same.
- Two concurrent transfers each resolve on their own reply.

## Open questions

1. **Does `sendChunk` return the envelope id, or does the transfer mint it?** Resolved in favour of
   returning it: envelope-id minting belongs to `daemonConnection`'s single monotonic counter, which
   `transport/` must not reach into.
2. **Single in-flight slot or a set?** Resolved to a `Set` — see the Design note. If implementation
   shows the scan is awkward, a `Map` keyed by attachment id is the fallback, and the change is
   recorded under `## Revisions`.
3. **Does the loop need a real macrotask yield, or does a microtask suffice?** A microtask does not let
   socket I/O land, so the default is `setImmediate`. Confirm nothing in the built app lacks it.

## Size check

Re-counted against this written plan, not the § A1 sketch:

| Limit | Boundary | This plan |
|---|---|---|
| Production source files created or modified | ≤ 5 | **2** — `attachmentTransfer.ts` (new), `daemonConnection.ts` |
| Total written work | ≤ 800 | **~1000, over** — see below |
| New exported types / interfaces / components / stores | ≤ 5 | **4** — `AttachmentTransferFailure`, `AttachmentTransferResult`, `AttachmentTransferDeps`, `AttachmentTransfer` |
| Consumer call sites needing simultaneous update | ≤ 10 | **0** — purely additive; no signature changes, no renames |
| Acceptance criteria | ≤ 5 | **4** |
| Distinct error/reject branches in a state machine | ≤ 10 | **5** settle paths — the seven daemon verdicts were already collapsed to one value by #965 |

**One line is over, and it is not split.** The only seam in this design is state-machine / wiring, and
the state machine's sole consumer is the wiring, in the same family — the floor rule fires, and the
floor wins over the ceiling: a slice whose only deliverable is consumed by exactly one sibling is part
of that sibling. Split depth is also checked: parent #685, no grandparent. The overage is stated rather
than engineered away by cutting the teardown net from the driver or the tests from the state machine.
Every other boundary has a wide margin, and the five other numbers are the ones that measured as
binding on prior runs (call-site cascade on #29/#75, reject-branch fan-out on #445/#446).

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** SHOULD FIX — the design has three untrusted→trusted crossings, all already
  narrowed upstream: the decoded `attachment_id` (a `requireNonEmptyString` result, so `''` cannot
  match a transfer), the reject `code` (already collapsed to a client-owned `DaemonErrorOutcome` by
  #965), and the numeric `in_reply_to`. All three are used as **comparands and dropped** — never
  stored, never a lookup path. The type is the downstream signal: `AttachmentTransferFailure`'s every
  inhabitant is a literal written in this repo, so a value of that type provably holds no daemon text.
  The finding is the **buggy-caller** case: nothing here stops #862 from minting the same
  `attachment_id` for two transfers, and a reply would then resolve whichever the scan reaches first.
  Phase B states the uniqueness precondition on `uploadAttachment`'s docblock and resolves at most one
  transfer per reply. Not escalated further: a duplicate id requires a caller contract violation, a
  settled transfer has already left `activeTransfers`, and a connection-lost destroys the daemon-side
  transfer with the session.
- **[Tokens, secrets, credentials]** No findings, by design rather than by absence of thought: nothing
  here generates, stores, rotates, or revokes a credential. `attachment_id` is explicitly **not a
  capability** (`attachmentChunkPlan.ts` — not secret, not unguessable), which is why it is compared
  with `===` and why `timingSafeEqual` would be *wrong* here: it would falsely signal that the id is a
  secret. The sensitive value this module holds is the **file bytes**, covered under Logs and Threat
  model below.
- **[File / storage operations]** No findings — structurally inapplicable. This slice performs **no
  filesystem I/O**: it receives `bytes: Uint8Array` already in memory and never resolves, joins, opens,
  or writes a path. Path traversal, TOCTOU, atomic writes and storage scope have no surface to appear
  on. `filename` is a display string copied verbatim onto the wire and never used as a path, per #860's
  contract; the daemon-side sanitiser (#818) owns it at the far end and #862 owns what the renderer is
  allowed to supply.
- **[Inter-process / Electron attack surface]** SHOULD FIX — this slice adds **no IPC channel, no
  `contextBridge` API, no `ipcMain` handler, no window, no protocol handler, and no navigation**, so
  the renderer cannot reach `uploadAttachment` at all; #862 owns that boundary and its validation.
  Process placement is correct and must stay so: the module lives under `src/main/transport/`, holds
  raw file bytes, and must never be re-exported through a renderer barrel — Phase B carries that header
  rule, as `attachmentChunkPlan.ts` and `attachmentChunkEnvelope.ts` already do. The finding is that
  `uploadAttachment` is the **first `async` method on `DaemonConnection`**; every sibling is `void` and
  "never throws out of the module". A synchronous throw during construction would surface as an
  unhandled main-process rejection if #862 forgets a `catch`. Phase B wraps the construction so every
  path resolves a value and the method **never rejects**.
- **[Cryptographic primitives]** No findings — no RNG, no key, no nonce, no handshake, and no
  hand-rolled anything in this slice. The transfer's `sha256` is computed once by `planAttachmentChunks`
  over the whole file via `@noble/hashes` (a vetted library, already this repo's hashing story) and is
  the daemon's integrity check; this driver copies it and never recomputes or re-derives it. No value
  here is compared against a secret, per the Tokens finding.
- **[Network & I/O]** OUT OF SCOPE, named — the socket, `maxPayload`, TLS, connect/idle deadlines and
  reconnect backoff are inherited unchanged from `relayConnection` / `noiseRelayDriver` /
  `relaySupervisor`; this slice opens no socket and sets no option. The residual is a **per-transfer
  deadline**: a live session whose daemon accepts every chunk and never answers leaves the transfer
  unsettled indefinitely. The deterministic backstop in different fabric is real and verified —
  `relayConnection`'s `WIRE_PONG_TIMEOUT_MS` (30s) self-terminates a dead socket, whose terminal fails
  every active transfer — so only a *live-but-silent* daemon reaches the residual. Deliberately not
  defended here: no such hang has been observed, and inventing a timeout constant would be exactly the
  unobserved-failure-mode defence the pipeline forbids. Phase B records the absence in the module so a
  future ticket that observes one knows where the gap is.
- **[Error messages, logs, telemetry]** SHOULD FIX, and this is AC4. The guarantee is **structural, not
  a scrubber**: `DiagnosticEvent` has no field shaped to carry a filename, a path, or payload bytes, so
  the file's name and bytes are unrepresentable in a record by construction. What this module logs is
  `event` (a static literal), `code` (a client-owned outcome), `count` (chunks) and `bytes` (the file's
  length) — `bytes` and `count` are the explicitly allowlisted content-free fields, and the relay
  already observes per-chunk ciphertext lengths, so neither is a new disclosure. The finding is that
  **`attachment_id` must not be logged** even though it is not a capability and would be a convenient
  correlation handle: it is minted by #862 from material this module cannot see, so an id ever derived
  from the filename would leak the filename through a field that looks safe. Phase B logs no id, and no
  daemon `message` string reaches a record on any path.
- **[Concurrency]** No findings — every question the checklist asks has an owner in the design.
  The send loop is owned by its handle and cancelled by the settle itself (there is no cancellable I/O
  to `AbortSignal`, no timer, no listener). `settled` is re-read after each `await`, never cached across
  the gap. `failAttachmentTransfers` clears the set **before** failing a snapshot of it, so no mutation
  occurs during iteration and the module holds no reference to a transfer it has abandoned. All four
  connection-fatal paths plus `dial()` fail every transfer, which is what makes `dial()`'s reset of
  `nextEnvelopeId` to 2 safe — recycled envelope ids can never mis-correlate against a dead session's
  transfer, the same argument `pendingSettings.clear()` already carries. The `finally` delete always
  runs because the result promise never rejects.
- **[Threat model alignment]** No findings; each desktop-specific threat is addressed or named.
  **Malicious relay** (on-path, content-blind): it can drop, delay, reorder or flood, and none of those
  produce a wrong terminal — reordering is harmless because the receiver is index-addressed, and it
  cannot forge an in-session frame through the Noise AEAD, so it can neither fake a success nor fake a
  reject. Dropping chunks degrades to the Network & I/O residual above. **Hostile daemon response**:
  every field it sends is fail-closed decoded by #964/#965 before reaching this module, and a daemon
  that lies about having stored a file is *inside* the trust boundary the authenticated session
  establishes — a compromised daemon can lie about anything, so this is accepted, not defended.
  **Renderer compromise reaching the transport**: the renderer has no path to this code in this slice.
  **Token theft from disk**: nothing here touches disk. **Unbounded memory** (a 2GB file materialising
  ~4.66GB across input plus base64) is real and is OUT OF SCOPE by the ticket's own assignment — the
  client-side size bound is #862's, and this driver's memory profile is unbounded by design until it
  lands.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
