# #996 — Fetch an attachment back from the host on the window's ask

The slice that joins the retrieval leg together. The wire contract (#993), the recognition layer (#998
chunks, #999 reject codes) and the reassemble-and-store path (#995) all landed unwired; nothing asks
the host for anything until this ticket. It adds the IPC surface the window asks over, the
correlation and timeout discipline in the transport, and the orchestrator that composes
`createAttachmentReassembler` with `storeAttachment` and reports one terminal.

Ships **unwired on the renderer side**, deliberately: #814 (save into Downloads), #866 (deliver bytes
to the window) and #867 (open in the OS viewer) are the consumers and each is blocked on this. The
upload leg shipped the same way.

## Files read

- `src/shared/ipc/attachmentUpload.ts` → `ATTACHMENT_UPLOAD_CHANNEL`, `ATTACHMENT_UPLOAD_EVENT_CHANNEL`,
  `AttachmentUploadFailure`, `AttachmentUploadEvent` — the two-channel IPC module this one mirrors, and
  the ruling that a feature outcome must not reach the daemon-event bridges.
- `src/main/attachmentUpload.ts` → `uploadAttachmentFile`, `driveUpload`, `AttachmentUploadDeps` — the
  never-rejects, one-terminal-per-intent flow shape, and the `reason: result.outcome` compile-forced
  correspondence idiom.
- `src/main/debugBundleDownload.ts` → `createDebugBundleDownload`, `categoryFor` — the orchestrator
  structure (per-request consumer, `complete` → store, `fail` → failure event) and the two deliberate
  departures this one makes from it.
- `src/main/attachmentStore.ts` → `storeAttachment`, `ATTACHMENT_DIR_NAME`, `StoreAttachmentResult` —
  the write, the directory name the composition root joins, and the rule that the returned path is a
  return value, never forwarded or logged.
- `src/main/attachmentPath.ts` → `resolveAttachmentPath` — the sole canonicity gate on an attachment
  identifier, and its own argument for why there must not be a second one.
- `src/main/transport/attachmentReassembler.ts` → `createAttachmentReassembler`,
  `AttachmentFailReason`, `AttachmentConsumer`, `AttachmentReassembler.fail` — the accumulator this
  ticket drives, its closed reason set, and the two-member pass-through door reserved for #996.
- `src/main/transport/requestAttachmentEnvelope.ts` → `buildRequestAttachment`,
  `RequestAttachmentInput.id` — the builder, and its statement that the payload carries no request id
  so the caller must retain the envelope id it sent under.
- `src/main/transport/inboundMessage.ts` → `DaemonErrorOutcome`, `RetrievedAttachmentChunk`, the
  `attachment-chunk` and `daemon-error` members of `InboundDaemonMessage` — the narrowed inputs this
  ticket routes, and the note that `attachment.not_found` answers two verbs, not retrieval alone.
- `src/main/daemonConnection.ts` → `pendingSettings`, `pendingCreateFolders`, `activeTransfers`,
  `transferForEnvelope`, `failAttachmentTransfers`, `failBundleStream`, `requestDebugBundle`,
  `uploadAttachment`, the `daemon-error` and `attachment-stored` inbound arms, `dial` — the
  in-repo precedent for correlating on `Envelope.in_reply_to`, the four teardown sites, and the
  arm-before-send discipline.
- `src/main/transport/relaySupervisor.ts` → the `timing.setTimer` / `timing.clearTimer` injection seam
  with a real-timer default — the repo's one testable-timer idiom, which AC4's new timeout copies.
- `src/main/transport/relayConnection.ts` → `WIRE_PONG_TIMEOUT_MS` — the 30 s figure this ticket's idle
  deadline restates, and the deterministic backstop one layer down.
- `src/shared/ipc/commands.ts` → `isRendererCommand` — the runtime shape guard at the untrusted
  renderer boundary, including the structured-clone lesson about an explicitly-`undefined` property.
- `src/preload/index.ts` → `requestAttachmentUpload`, `onAttachmentUploadEvent` — the fixed-channel
  sender / unsubscribing-listener pair this ticket adds a sibling to.
- `src/main/index.ts` → the `attachmentUploadListener` registration, `app.getPath('userData')`,
  `live.sink` — the composition-root edge, and why the answer rides `event.sender` rather than the sink.
- `docs/knowledge/features/attachment-reassembly-and-store.md` § Security review, § Edge cases — the
  aggregate-footprint bound, the "no timeout is minted here" note assigning the deadline to this
  ticket, and the `stream-aborted` translation obligation.
- `src/shared/wire/types.ts` → `RequestAttachmentPayload` — two fields and no third, and why naming a
  conversation is not authorization.

## Design source

**Figma:** N/A — this slice is main-process and IPC-contract work with no renderer surface. The visual
consumers are #814/#866/#867 and each carries its own Figma anchor.

## Context

An attachment can be uploaded and the host stores it; nothing can fetch one back. Every piece of the
return path exists as an unwired leaf. This ticket is the driver: it makes the window able to ask, it
routes the answering frames to the retrieval that asked, and it reports one terminal.

The case it serves today is narrower than the parent's user story: the only attachment identifiers
this app knows are the ones `src/main/attachmentUpload.ts` minted itself (`randomUUID`), because the
daemon's inbound `message` payload carries no attachment ids and no list verb exists on the wire. So
the served case is the operator's own file, fetched back after a reopen or from another machine.

No ADR is warranted — every architectural decision here is an application of one already recorded
(ADR 0001 process placement, ADR 0002 wire contract).

## Design

### 1. The IPC surface — `src/shared/ipc/attachmentRetrieval.ts` (new)

A retrieval-leg module beside `attachmentUpload.ts`, with its own request and event channels.
**Not** a member on `src/shared/ipc/events.ts`: four renderer bridges end their `DaemonEvent` switch
in `assertNever`, so a member there is a compile error in four files that have nothing to do with
attachments, for four no-op arms.

```ts
export const ATTACHMENT_RETRIEVAL_CHANNEL = 'pyry:attachment-retrieval' as const
export const ATTACHMENT_RETRIEVAL_EVENT_CHANNEL = 'pyry:attachment-retrieval-event' as const

export interface AttachmentRetrievalRequest { conversationId: string; attachmentId: string }
export function isAttachmentRetrievalRequest(value: unknown): value is AttachmentRetrievalRequest

export type AttachmentRetrievalEvent =
  | { type: 'completed'; attachmentId: string }
  | { type: 'failed'; attachmentId: string; reason: AttachmentRetrievalFailure }
```

**The request is NOT bare, unlike `requestAttachmentUpload`.** That intent carries no payload because
the picker runs in main; this one carries two identifiers from an untrusted renderer, so the channel
owes a shape check at the main boundary the way `isRendererCommand` guards `COMMAND_CHANNEL`. The
guard accepts an object with exactly two **non-empty strings** and nothing else.

- **Shape only, no canonicity check.** `resolveAttachmentPath` is the sole gate that decides whether an
  identifier may become a path component, and its own header argues that two divergent checks on one
  directory end with one of them weaker. The conversation id gets no validator at all: it goes to the
  daemon and never touches a local path, and naming a conversation is not authorization on this wire.
- **Non-empty is required** rather than merely `typeof === 'string'`, because `buildRequestAttachment`
  names the zero-valued request as the contract's specific silent failure: joining the empty string
  onto a directory yields the directory.
- **A request failing the guard is dropped**, no event and no frame — `onCommand`'s posture for a
  malformed command. There is no id to address an answer to, and a conforming renderer never sends one.
- The two fields are **camelCase**, not the wire's snake_case: this is a client-internal IPC contract,
  and the wire literal is rebuilt fresh in `daemonConnection` so no renderer-supplied key reaches the
  envelope (`createConversation`'s fresh-literal posture).

`AttachmentRetrievalFailure` is a closed set of **client-owned literals**, so a value of the type
provably carries no daemon text and nothing derived from the file:

```ts
export type AttachmentRetrievalFailure =
  | 'busy' | 'not-connected' | 'not-found' | 'daemon-error' | 'timed-out' | 'store-failed'
  // — from AttachmentFailReason (src/main/transport/attachmentReassembler.ts) —
  | 'stream-contradiction' | 'too-large' | 'verification-failed' | 'stream-aborted' | 'connection-lost'
```

**Declared ONCE and imported by main**, which is where this departs from `AttachmentUploadFailure`'s
mechanical re-declaration. That union re-declares because `AttachmentTransferFailure` lives in
`src/main` and shared must not import main. Here the type flows the other way — the transport hands
the *caller's* consumer this type — so `src/main` importing it from shared is the ordinary direction
(`src/main/attachmentUpload.ts` already imports `AttachmentUploadEvent`), and one declaration means
zero drift to keep in step. The correspondence with the transport's closed set stays **compile-forced**
at the forwarding call described in § 3.

**The daemon's own code vocabulary is NOT inherited.** `DaemonErrorOutcome`'s nine members collapse to
`'not-found'` (its `attachment-not-found`) and a `'daemon-error'` catch-all, rather than riding through
the way the upload leg's do. Passing them through would put seven codes on this union that cannot
conformingly answer a `request_attachment` — the upload leg already spends a paragraph explaining why
*two* of its inherited members are unreachable, and doing that again sevenfold in the mirror direction
buys nothing a consumer can act on. The catch-all is total by construction, so a tenth outcome added
upstream lands on `'daemon-error'`, which is the right answer with no edit.

### 2. The preload pair — `src/preload/index.ts`

`requestAttachment(request)` sends on the fixed request channel; `onAttachmentRetrievalEvent(listener)`
subscribes on the fixed event channel and returns an unsubscribe handle. The
`requestAttachmentUpload` / `onAttachmentUploadEvent` shape verbatim, including stripping the raw
`IpcRendererEvent` before the listener runs and removing the exact handler registered. No caller is
wired — the consumers are #814/#866/#867.

### 3. Correlation and timeout — `src/main/daemonConnection.ts`

A new interface method plus one exported consumer type:

```ts
export interface AttachmentRetrievalConsumer {
  complete(bytes: Uint8Array): void
  fail(reason: AttachmentRetrievalFailure): void
}
// Exactly one terminal per call. Never throws.
requestAttachment(payload: RequestAttachmentPayload, consumer: AttachmentRetrievalConsumer): void
```

State is `pendingRetrievals: Map<number, PendingRetrieval>` keyed by the **envelope id of the
`request_attachment` this client sent** — the `pendingSettings` / `pendingCreateFolders` idiom, and the
only correlation the answers publish. Each entry holds the reassembler, the consumer, and the idle
timer handle. **The numeric id stays main-internal and never rides an event to the window.**

`requestAttachment`:
- `driver === null` → `consumer.fail('not-connected')` and return, `requestDebugBundle`'s posture (a
  call that owns an awaiting caller must never be a silent no-op).
- Otherwise **arm before send**: capture `nextEnvelopeId`, build the reassembler, record the entry, arm
  the idle timer, then build and send the frame — so a fast reply cannot race ahead of an armed slot.
- A build/send throw is caught and dropped (`requestDebugBundle`'s never-throw-out-of-the-module rule);
  the entry stays armed and the teardown net or the idle timer settles it.

Two answers arrive, correlated differently, and this is the part that gets done wrong if skimmed:

- **`attachment-chunk`** carries a required `inReplyTo` *and* the transfer's own `attachment_id`. It is
  routed to the entry by `inReplyTo`; the reassembler independently refuses a chunk naming a different
  `attachment_id`. Non-redundant: the payload id is what catches the host answering the right ask with
  the wrong bytes. A frame matching no entry is dropped. Each accepted chunk **resets the idle timer**.
- **The reject is a plain `error` envelope with no attachment id at all**, so it correlates on
  `inReplyTo` alone. The retrieval correlation joins the existing unique-per-request-envelope-id tier in
  the `daemon-error` arm, beside `pendingSettings` / `pendingCreateFolders` / `transferForEnvelope`; a
  match consumes the frame entirely. Order among the four is immaterial — an envelope id is minted once.
  `attachment.not_found` correlated to a *`send_message`* instead (the second verb it answers, per
  `DaemonErrorOutcome`'s docblock) matches no entry and falls through unchanged.

Terminal routing inside the `daemon-error` arm:
- `attachment-stream-aborted` → `entry.reassembler.fail('stream-aborted')`, **through the door**, because
  there are accumulated bytes to discard and that door exists for exactly this translation (AC3).
- `attachment-not-found` → settle `'not-found'` directly. `unclassified` and every other code → settle
  `'daemon-error'` directly. Neither goes through the reassembler: a reject yields no bytes, so there is
  nothing accumulated to discard — which is the resolution of the closed-set asymmetry the ticket asks
  for. **`AttachmentFailReason` is NOT widened**, and `src/main/transport/attachmentReassembler.ts` is
  not a sixth production file.

One `settle(entry, reason)` choke point clears the timer, deletes the map entry, and calls the
consumer — so "exactly one terminal" is a property of there being one exit. The reassembler's consumer
forwards explicitly rather than by bare method reference:

```ts
fail: (reason) => settle(entry, reason)   // reason: AttachmentFailReason → AttachmentRetrievalFailure
```

That assignment is the **compile-forced check** that the shared union still covers the transport's
closed set — the `reason: result.outcome` mechanism, restated for this leg. A sixth `AttachmentFailReason`
added upstream reddens this line instead of silently becoming unrepresentable. (A bare
`fail: consumer.fail` would not: `AttachmentConsumer.fail` is declared method-style, and TypeScript
checks method parameters bivariantly even under `strictFunctionTypes`.)

**The timeout is genuinely new work** — there is no timer in any transfer path in this repo. It is an
**idle deadline**, not a total-duration one: armed at send, reset on every accepted chunk, so a large
legitimate transfer is never killed for taking long, while a stream that simply stops — the third
failure mode, which the protocol offers nothing for — settles as `'timed-out'`. On fire it deletes the
entry and settles the consumer; dropping the entry releases the reassembler's accumulated bytes, which
is `failBundleStream`'s stated byte-release hygiene rather than terminal correctness. Duration is
`WIRE_PONG_TIMEOUT_MS`'s 30 s figure restated: a stream silent that long is dead, and the relay's own
wire-pong timeout is the deterministic backstop one layer down at the same magnitude. The timer is
injected through a `timing?: { retrievalIdleTimeoutMs?; setTimer?; clearTimer? }` seam on
`DaemonConnectionDeps`, defaulting to the real `setTimeout` / `clearTimeout` — `createRelaySupervisor`'s
idiom verbatim, which is this repo's one testable-timer pattern.

`failAttachmentRetrievals()` is the teardown net, modelled on `failAttachmentTransfers` (the set-shaped
one) rather than `failBundleStream` (the single-slot one): snapshot and clear the map, clear every
timer, then fail each consumer `'connection-lost'`. Called from the same four sites as its twin —
`relay-link-down`, `terminal`, `error`, and `dial()` — so a connection lost mid-retrieval fails every
retrieval in flight rather than leaving one pending forever, and a recycled envelope id after a re-dial
can never correlate on the fresh session.

### 4. The orchestrator — `src/main/attachmentRetrieval.ts` (new)

`debugBundleDownload.ts`'s structure, with the departures the ticket names. Electron-free and
unit-testable; the composition root injects the three live deps.

```ts
export interface AttachmentRetrievalDeps {
  requestAttachment: (payload: RequestAttachmentPayload, consumer: AttachmentRetrievalConsumer) => void
  store: (attachmentId: string, bytes: Uint8Array) => Promise<StoreAttachmentResult>
  emit: (event: AttachmentRetrievalEvent) => void
  diagnosticLog?: DiagnosticLog
}
export function createAttachmentRetrieval(
  deps: AttachmentRetrievalDeps
): (request: AttachmentRetrievalRequest) => void
```

- **Not single-in-flight** (AC2): a `Set<string>` of attachment ids currently being retrieved, so two
  retrievals of different attachments run at once and cannot cross-feed. The IPC event is keyed by
  `attachmentId` — the renderer's *own* value coming back, never a wire-supplied one — which is what
  makes it a sound correlation key for the window.
- **A duplicate ask for an id already in flight is a no-op**: no second retrieval, no failure event. The
  live retrieval's terminal names that `attachmentId` and therefore answers both asks. This is what
  keeps the event key unambiguous, and it is the cancelled-picker precedent (an ask that starts nothing
  reports nothing).
- **A concurrency cap**, `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS = 4`, fails a further request `'busy'`
  immediately. See § Security review finding 1: without it an untrusted renderer voids #995's
  per-transfer memory bound simply by asking for many distinct ids.
- `complete(bytes)` routes the bytes to `store` and lets the **store's settlement** be the terminal —
  `debugBundleDownload`'s "holding the flag across the save" argument, which is what closes the async
  window in which a second ask could start a duplicate retrieval. Success emits
  `{ type: 'completed', attachmentId }`; a rejection or `{ ok: false }` emits `'store-failed'`. **The
  returned path is dropped**: it is a return value for #814/#866/#867, and the terminal event carries no
  path where `debugBundleSaved` carries one.
- `fail(reason)` emits `{ type: 'failed', attachmentId, reason }` verbatim — no second mapping layer.
- **Never rejects**, so the composition root's bare `void` is licensed by a property of this module.

### 5. The composition root — `src/main/index.ts`

An `ipcMain.on(ATTACHMENT_RETRIEVAL_CHANNEL, …)` listener beside the upload one, removed on
`will-quit`. It applies `isAttachmentRetrievalRequest` to the IPC argument and drops a failing one. The
attachment base directory is computed here and only here, by joining `ATTACHMENT_DIR_NAME` onto
`app.getPath('userData')` — never from anything the window sent — and closed into the `store` dep, the
`downloadsDir`/`saveDebugBundle` seam restated. The answer rides `event.sender` closed into `emit` with
`isDestroyed()` guarding it, so it goes back to the window that asked; it cannot route through
`live.sink`, whose send re-supplies `DAEMON_EVENT_CHANNEL`.

## State + concurrency model

- **Ownership.** One `pendingRetrievals` entry per live retrieval in `daemonConnection`, one
  `Set<string>` membership per live retrieval in the orchestrator. Both are single-writer: every
  mutation runs to completion inside a synchronous body with no `await` between a read and a write —
  the `nextEnvelopeId` / `pendingSettings` rationale. The one asynchronous gap is the orchestrator's
  `store`, and the id stays in the set across it precisely so the gap is not a check-then-act race.
- **Cancellation.** Every long-lived piece has a defined teardown: the idle timer is cleared at the
  single `settle` choke point and by `failAttachmentRetrievals`; the map entry is deleted at the same
  point; the `will-quit` handler removes the IPC listener. No promise is left floating — the store's
  promise is `void`-ed with both settlements handled.
- **Re-dial.** `dial()` clears the map through the teardown net before `nextEnvelopeId` resets to 2, so
  a stale envelope id can never correlate an answer on the reconnected session.

## Error handling

| Failure | Detected by | Terminal |
|---|---|---|
| Malformed ask | `isAttachmentRetrievalRequest` at the main boundary | dropped, no frame, no fs call |
| Duplicate ask, same id | orchestrator's in-flight set | no-op; the live retrieval's terminal answers it |
| More than 4 concurrent | orchestrator's cap | `busy` |
| Not connected | `driver === null` | `not-connected` |
| `attachment.not_found` | correlated `daemon-error` | `not-found` |
| `attachment.stream_aborted` | correlated `daemon-error` | `stream-aborted`, **through the reassembler's door** |
| Any other correlated code | correlated `daemon-error` | `daemon-error` |
| Contradictory / oversized / unverifiable stream | the reassembler's own verdicts | `stream-contradiction`, `too-large`, `verification-failed` |
| Connection lost mid-retrieval | teardown net, four sites | `connection-lost` |
| Stream stops, no terminal frame | this client's idle deadline | `timed-out` |
| Write refused or failed | `storeAttachment` | `store-failed` |

Exceptions never leak: `requestAttachment` never throws, the orchestrator never rejects, and the caught
objects are dropped unexamined — an `fs` `ErrnoException` carries the path in `.path` and its message.

**Logging is the static event name `attachment-fetch` plus a client-owned `code` and nothing else.** No
identifier, no byte length, no chunk count, no path, no digest. The byte length the upload leg logs as
allowlisted is *this side's own file* there; here it is wire-derived information about a host file, and
the ids are renderer-supplied, which `attachmentPath.ts` names as a log-injection vector.

## Testing strategy

All vitest; this slice is main-process and IPC-contract work with no renderer surface, so no Playwright
spec is added (`e2e/stall-bundle.spec.ts` is the precedent had one been cheap, and the criteria do not
ask for one).

`src/shared/ipc/attachmentRetrieval.test.ts`
- The guard accepts a well-formed request; refuses a non-object, `null`, a missing field, a non-string
  field, an empty-string field, and an **explicitly-`undefined`** field (structured clone preserves the
  property across the bridge, so `'x' in value` alone would pass one through).
- The two channel constants are distinct from each other and from `DAEMON_EVENT_CHANNEL`.

`src/main/attachmentRetrieval.test.ts`
- `completed` on a successful store; the event carries no path and no field beyond `type`/`attachmentId`.
- `store-failed` on `{ ok: false }` and on a rejected store promise.
- Each consumer reason reaches the window as itself.
- Two different ids run concurrently and each gets its own terminal; a duplicate ask for a live id
  starts nothing and emits nothing; a fifth concurrent id gets `busy` without reaching `requestAttachment`.
- The in-flight id is still held across the store's async gap.
- Every emitted event and every logged record is checked field-by-field for the absence of a path.

`src/main/daemonConnection.test.ts`
- Not connected → `not-connected` synchronously, with no frame on the wire.
- The sent frame decodes to `request_attachment` with exactly the two ids, rebuilt as a fresh literal.
- A chunk correlated by `in_reply_to` reaches the right retrieval; two concurrent retrievals of
  different attachments do not cross-feed; a chunk naming an unknown `in_reply_to` is dropped.
- A correlated `attachment.not_found` settles `not-found`; a correlated `attachment.stream_aborted`
  settles `stream-aborted` **and** the accumulated chunks are discarded; another code settles
  `daemon-error`; an uncorrelated error still reaches the existing bundle/modal fallthrough unchanged.
- A teardown at each of the four sites fails every retrieval in flight `connection-lost`.
- The injected timer fires `timed-out` when no chunk arrives; an accepted chunk resets it; the timer is
  cleared on every settle path so a late fire cannot produce a second terminal.

Fakes over mocks throughout: the existing fake driver in `daemonConnection.test.ts`, an injected
`timing` seam rather than `vi.useFakeTimers()` (the repo has no fake-timer precedent in `src/main` and
`createRelaySupervisor` establishes the injection), and hand-written `store` / `emit` doubles.

**A settle-once driver makes `request(); assert()` wrong.** The orchestrator's terminal crosses a real
microtask boundary through `store`, so the terminal-state tests drain the microtask queue rather than
taking a single tick, and the transport-layer tests assert only what that layer decides.

## Open questions

1. **Is 4 the right concurrency cap?** It bounds the peak accumulated footprint at 4 × 23 MB conforming
   (4 × ~33 MB against a non-conforming host, per #995's aggregate-footprint note). Resolve during
   implementation only if the arithmetic argues otherwise; a lower figure is the safer error.
2. **Should the idle deadline be configurable per request?** Assumed no — one constant, one argument,
   the neighbouring `WIRE_PONG_TIMEOUT_MS`'s figure. Revisit if a consumer ticket needs a longer wait.

## Size

The ticket states an overage and this plan confirms it: ~1400 lines of total written work against the
size-S table's 800. Every other line holds — **5** production source files (the shared IPC module, the
preload, the orchestrator, `daemonConnection.ts`, `index.ts`), **5** new exported types
(`AttachmentRetrievalRequest`, `AttachmentRetrievalFailure`, `AttachmentRetrievalEvent`,
`AttachmentRetrievalConsumer`, `AttachmentRetrievalDeps`), **0** consumer call sites beyond the
registrations, **5** acceptance criteria, and **8** terminal branches against a limit of 10.

It is built rather than split because the floor rule beats the ceiling: the only seam is the IPC
contract, whose sole consumer is the orchestrator in the same family, so a split produces a child that
changes nothing observable on its own and cannot be verified alone. The overage is the norm in this
feature — #860 landed 1214 lines, #861 1859, #862 1529, #964 1095, #995 1062, all single tickets that
shipped clean. Keeping `attachmentReassembler.ts` off the list (§ 3) is what holds the file count at 5.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] MUST FIX — addressed in the plan before commit.** The renderer→main boundary is
  a single named function, `isAttachmentRetrievalRequest`, and downstream code holds only its narrowed
  type. Walking it adversarially found one hole in the first draft: the guard bounds each ask, but
  *nothing bounded the number of asks*. A compromised renderer could open an unbounded number of
  concurrent retrievals with distinct identifiers, each accumulating up to `ATTACHMENT_MAX_RETRIEVAL_BYTES`
  (~23 MB conforming, ~33 MB against a non-conforming host per #995's aggregate-footprint note) — which
  voids the per-transfer memory bound `createAttachmentReassembler` exists to enforce, since that bound
  is only meaningful multiplied by a bounded count. Fixed in § 4 by
  `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS = 4` with a `'busy'` terminal beyond it, refused *before* the
  transport is called so no reassembler is armed. Residual, accepted: the cap lives in the orchestrator,
  one layer above the memory it bounds; `daemonConnection.requestAttachment` is uncapped and relies on
  the orchestrator being its only caller, which is the same reliance `requestDebugBundle` already has.
- **[Trust boundaries] No further findings.** `conversationId` crosses to the wire deliberately
  unvalidated: naming a conversation is not authorization on this wire, the daemon validates it against
  its own registry before it becomes a path component, and it never touches a local path on this side.
  `attachmentId` is the only untrusted value that can become a path component, and it reaches a
  filesystem call through exactly one route — `storeAttachment` → `resolveAttachmentPath`, which refuses
  a non-canonical identifier before any `fs` call. The plan adds no second canonicity check, on
  `attachmentPath.ts`'s own argument that two divergent gates on one directory end with one weaker.
- **[Tokens] No findings — none minted, read, stored or transported.** The retrieval events have no
  field shaped to hold one; correlation is a numeric envelope id (main-internal) and the renderer's own
  identifier.
- **[File / storage] No findings.** The write is #995's `storeAttachment` unchanged: `resolveAttachmentPath`
  gate, `mkdir` owner-only, temp-then-`rename` (atomic, and it *replaces* a symlink at the target rather
  than writing through it), file `0o600`, under `app.getPath('userData')`. This ticket adds only the
  `baseDir` join at the composition root, computed from `app.getPath('userData')` and never from
  anything the window sent. The id handed to `storeAttachment` is the one **this client asked for**, not
  `chunk.attachment_id` read back off the wire — the fragility that module's docblock names. No
  check-then-open anywhere; no TOCTOU introduced. `safeStorage` is deliberately not used: #995 rejected
  it for multi-MB file content and that decision is inherited, not re-opened.
- **[Electron / IPC attack surface] No findings.** No window is created or reconfigured, so
  `contextIsolation` / `sandbox` / `nodeIntegration` and the `will-navigate` + `setWindowOpenHandler`
  guards are untouched. The two new bridge functions expose fixed channel constants and nothing else —
  `ipcRenderer` never crosses. The request channel is validated at `ipcMain.on`; the event channel is
  main→renderer only and is deliberately separate from `DAEMON_EVENT_CHANNEL`, so a retrieval outcome
  can never reach a daemon-event bridge. The answer rides `event.sender` with the `isDestroyed()` guard,
  so it goes to the asking window and a window closed mid-retrieval drops the outcome rather than
  throwing. No custom protocol, no deep link, no remote content. Every socket, key and raw byte stays in
  the background process; the window learns a client-owned literal and its own identifier.
- **[Cryptographic primitives] No findings — none added.** The `sha256` verification is #995's, over
  `crypto.createHash`. It is integrity, not authenticity: a hostile daemon inside the session supplies
  both bytes and digest, an inherent limit of the leg that this ticket does not widen. No comparison
  here is against a secret, so `timingSafeEqual` is not applicable — the reassembler's `attachment_id`
  comparand and the digest are both public to the peer that sent them.
- **[Network & I/O] No findings — this ticket *adds* the missing timeout discipline.** Before it, no
  transfer path in this repo had a deadline (`daemonConnection`'s own comment records that an unfailed
  consumer never settles). The idle deadline bounds the two hostile-relay shapes: a stall settles at
  `timed-out`, and a slow drip cannot pin a retrieval indefinitely because the reassembler counts
  *distinct* indices and refuses a repeat, so at most `total_chunks` ≤ 512 chunks can arrive before it
  must settle one way or the other. The relay's own `WIRE_PONG_TIMEOUT_MS` remains the deterministic
  backstop one layer down. Frame-size caps, TLS enforcement, relay-URL validation and reconnect backoff
  are all inherited unchanged from the connection this rides on.
- **[Error messages, logs, telemetry] No findings.** Every reason on the union is a literal written in
  this repo, so no daemon text, filename, media type, digest or host path can inhabit one. Logging is
  narrower than the upload leg's on purpose: event name + client-owned `code` only, with no byte length
  (wire-derived information about a host file) and no identifier (renderer-supplied, and
  `attachmentPath.ts` names an identifier in a log as an injection vector). The store's returned path is
  dropped rather than emitted or logged — the one place `debugBundleSaved`'s shape must *not* be copied.
  Caught `fs` and codec errors are dropped unexamined.
- **[Concurrency] No findings.** Every long-lived piece has a named owner and a teardown: the idle timer
  is cleared at the single `settle` choke point and by `failAttachmentRetrievals`; the map entry is
  deleted there too; the IPC listener is removed on `will-quit`; the store promise is `void`-ed with
  both settlements handled, so no floating rejection. The one check-then-act across an `await` is the
  orchestrator's in-flight id, and it is deliberately held *across* the store so the gap is not a race —
  `debugBundleDownload`'s argument for holding its flag across the save. Four teardown sites fail every
  retrieval in flight, and `dial()` clears the map before `nextEnvelopeId` recycles, so a stale id
  cannot correlate on a fresh session. Accepted residual: a store in flight at `app.quit` is not
  awaited, the same loss the upload leg already takes; the temp file is unlinked on failure and cannot
  be mistaken for an attachment (its name is not a canonical identifier).
- **[Threat model alignment] No new findings; three inherited residuals named.** Malicious relay: it is
  content-blind and on-path, and the timeout plus the reassembler's verification cover drop/delay/stall
  without leaking plaintext or hanging. Hostile daemon inside the session: it can serve arbitrary bytes
  with a matching digest (#995's inherent limit), can correlate a reject to a request the client never
  made (no entry, dropped), and can correlate an upload-leg code to a retrieval (settles `daemon-error`,
  reported honestly rather than coerced into a failure that did not happen). Renderer compromise: it can
  ask for attachment identifiers — a capability class it already has over `COMMAND_CHANNEL`, now bounded
  additionally by the concurrency cap — and cannot reach keys, the socket, or a path.
  **OUT OF SCOPE:** nothing evicts stored attachment files, so repeated fetches accumulate on disk;
  that is #995's documented limitation, retention has no ticket in any repo, and this ticket does not
  invent one.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03

## Revisions

### 2026-09-03 — `emit` moved from a construction dep to a per-ask argument

**What changed.** `AttachmentRetrievalDeps` no longer carries `emit`; the driver's returned function
takes it as a second argument (`(request, emit) => void`), and the in-flight `Set<string>` became a
`Map<string, AttachmentRetrievalEmit>` so a terminal reaches the window that started the retrieval.

**What drove it.** The design as written was internally inconsistent, and implementing § 5 surfaced it.
The driver must be **process-lifetime** — its concurrency cap and its coalescing are state that only
means anything across asks — while the answer must go back to the window that asked, which is
`event.sender`, a **per-ask** value. Those two cannot both hold with `emit` fixed at construction. The
first attempt at the composition root built a driver per ask, which silently disabled the cap and the
coalescing outright; the security review's MUST FIX would have shipped as a no-op.

**Alternatives rejected.** Routing to the current window instead of the asker (`debugBundleDownload`'s
shape) is unavailable: `live.sink`'s send re-supplies `DAEMON_EVENT_CHANNEL` and `live.window` exposes
no `webContents`, so it would need `LiveWindow` widened — a sixth production file. Keeping an
`attachmentId → sender` correlation map in `src/main/index.ts` works, but puts stateful routing logic
in the one file this repo does not unit-test.

**New contract.** The driver is `createAttachmentRetrieval(deps): (request, emit) => void`. The emit is
captured with the in-flight entry at start, so a coalesced duplicate ask cannot redirect a retrieval
already under way to a different window, and a `busy` refusal is answered on the refused ask's own emit
because there is no entry to look one up from. Both are pinned by tests. Nothing else in the design
moves: the failure union, the correlation model, the timeout and the teardown net are unchanged, and
`AttachmentRetrievalEmit` is a type alias for the function shape rather than a sixth exported type in
the counted sense (it replaces the dep field it was extracted from).
