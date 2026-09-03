# Attachment retrieval (ask, correlate, assemble, store, report)

The driver that joins the retrieval leg together: the window names a conversation and an attachment,
this feature asks the host over the live session, routes the answering stream to
[attachment reassembly and store](attachment-reassembly-and-store.md)'s two leaves, and pushes back
exactly one terminal. Before this ticket every piece of the return path — the wire contract
([#993](request-attachment-envelope.md)), the recognition layer ([#998](attachment-chunk-retrieval-decode.md)/[#999](daemon-error-outcome.md))
and the reassemble-and-store path ([#995](attachment-reassembly-and-store.md)) — existed unwired;
nothing asked the host for anything until this landed.

Introduced in [#996](https://github.com/pyrycode/pyrycode-desktop/issues/996), split from #687. Ships
**unwired on the renderer side**, deliberately, the upload leg's own shape: [attachment save](attachment-save.md)
([#814](https://github.com/pyrycode/pyrycode-desktop/issues/814), landed — save into Downloads),
[#866](https://github.com/pyrycode/pyrycode-desktop/issues/866) (deliver bytes to the window) and
[#867](https://github.com/pyrycode/pyrycode-desktop/issues/867) (open in the OS viewer) are the
consumers; the latter two are still blocked on this.

## Correlation is two different keys, and that's the design

Every `attachment_chunk` carries the transfer's own `attachment_id` **and** the envelope's
`in_reply_to` naming the request that asked. The reject is a **plain `error` envelope with no
attachment id at all** — it correlates on `in_reply_to` alone. A design routing on the attachment id
alone therefore cannot deliver a rejection to the request waiting for one; both keys are needed, and
they answer different questions (`in_reply_to`: which request; the payload id: which transfer — the
second catches the host answering the right ask with the wrong bytes).

This is the mirror image of [attachment transfer](attachment-transfer.md)'s (#861) send-leg
correlation, which matches the opposite way round for the opposite reason: there the success reply
names the chunk that *closed* the set (unpredictable to the sender), so it correlates on the payload
id and the rejects correlate on envelope ids. Here every answer to one ask names the same envelope id,
so `in_reply_to` alone routes both frame kinds; the payload id is a second, non-redundant check.

## Four pieces

### 1. The IPC surface — `src/shared/ipc/attachmentRetrieval.ts`

A retrieval-leg module beside [`attachmentUpload.ts`](attachment-upload.md), **not** a member on
`src/shared/ipc/events.ts` — the four renderer bridges (`timelineBridge`, `questionBridge`,
`modalBridge`, `daemonEventBridge`) each end their `DaemonEvent` switch in `assertNever`, so a member
there is a compile error in four files with nothing to do with attachments, for four no-op arms.
Mirrors the upload leg's ruling that an outcome must not reach the daemon-event bridges.

```ts
export const ATTACHMENT_RETRIEVAL_CHANNEL = 'pyry:attachment-retrieval' as const              // renderer → main
export const ATTACHMENT_RETRIEVAL_EVENT_CHANNEL = 'pyry:attachment-retrieval-event' as const   // main → renderer
export const MAX_RETRIEVAL_IDENTIFIER_LENGTH = 256   // UTF-16 code units, each field

export interface AttachmentRetrievalRequest { conversationId: string; attachmentId: string }
export function isAttachmentRetrievalRequest(value: unknown): value is AttachmentRetrievalRequest

export type AttachmentRetrievalFailure =
  | 'busy' | 'not-connected' | 'send-failed' | 'not-found' | 'daemon-error' | 'timed-out' | 'store-failed'
  // — from AttachmentFailReason (attachmentReassembler.ts) —
  | 'stream-contradiction' | 'too-large' | 'verification-failed' | 'stream-aborted' | 'connection-lost'

export type AttachmentRetrievalEvent =
  | { type: 'completed'; attachmentId: string }
  | { type: 'failed'; attachmentId: string; reason: AttachmentRetrievalFailure }
```

**The request is *not* bare, unlike `requestAttachmentUpload`.** That intent carries no payload
because the picker runs in the background process; this one carries two identifiers from an untrusted
renderer, so `isAttachmentRetrievalRequest` guards the boundary the way `isRendererCommand` guards
`COMMAND_CHANNEL`. It checks **shape and size only, never canonicity**: `resolveAttachmentPath` (via
`storeAttachment`) is the sole gate that decides whether an identifier may become a path component, on
its own argument that two divergent checks on one directory end with one of them weaker — a `../..`
identifier still passes here, goes to the daemon, and comes back `not-found`. `conversationId` gets no
validator at all: it goes to the daemon and never touches a local path, and naming a conversation is
not authorization on this wire (authorization is pairing, at the Noise handshake).

Both fields must be non-empty (`buildRequestAttachment`'s docblock names the zero-valued request as
the contract's silent failure: joining `''` onto a directory yields the directory) and no longer than
`MAX_RETRIEVAL_IDENTIFIER_LENGTH` — added in a follow-up fix (see § Revision below) after the
verifier found that an unbounded identifier is not merely absurd input but a live desync trigger.

**A request failing the guard is dropped** — no request frame, no filesystem call, no event. There is
no id to address an answer to, and a conforming renderer never sends one.

**`AttachmentRetrievalFailure` is declared once and imported by main**, which is where this parts from
`AttachmentUploadFailure`'s mechanical re-declaration. That union re-declares because
`AttachmentTransferFailure` lives in `src/main` and shared must not import main; here the transport
hands the *caller's* consumer this type, so `src/main` importing it from shared is the ordinary
direction and there is no mirror to keep in step. The correspondence with the reassembler's closed set
is kept by the **compiler**, not an import: `daemonConnection`'s `fail: (reason) => settleRetrieval(...)`
forwards an `AttachmentFailReason` into a call typed by this union, so a sixth reassembler reason
reddens that line instead of silently becoming unrepresentable — `AttachmentUploadFailure`'s
`reason: result.outcome` mechanism, restated for the leg that runs the other way.

**The daemon's own code vocabulary is deliberately not inherited.** `DaemonErrorOutcome`'s members
collapse to `'not-found'` (`attachment.not_found`, the one code this verb publishes) and a
`'daemon-error'` catch-all, rather than riding through the way the upload leg's do — the upload leg
already spends a paragraph explaining why two of its inherited members are unreachable, and repeating
that sevenfold here would buy nothing a consumer can act on. The catch-all is total by construction:
a tenth daemon code added upstream lands on `'daemon-error'` with no edit.

Two fields, both camelCase (a client-internal IPC contract, not a wire type): `daemonConnection`
rebuilds `request_attachment` as a **fresh literal** from these two fields, so no renderer-supplied key
can reach the envelope even when the ask carries extra ones (`createConversation`'s posture).

### 2. The preload pair — `src/preload/index.ts`

`requestAttachment(request)` sends on the fixed request channel; `onAttachmentRetrievalEvent(listener)`
subscribes on the fixed event channel and returns an unsubscribe handle — `requestAttachmentUpload` /
`onAttachmentUploadEvent`'s shape verbatim, including stripping the raw `IpcRendererEvent` before the
listener runs. **No caller is wired** — the consumers are #814/#866/#867.

### 3. Correlation and timeout — `src/main/daemonConnection.ts`

```ts
export interface AttachmentRetrievalConsumer {
  complete(bytes: Uint8Array): void
  fail(reason: AttachmentRetrievalFailure): void   // exactly one terminal per call; never throws
}
requestAttachment(payload: RequestAttachmentPayload, consumer: AttachmentRetrievalConsumer): void
```

State is `pendingRetrievals: Map<number, PendingRetrieval>` keyed by the envelope id of the
`request_attachment` this client sent — the only handle both answers publish — the
`pendingSettings`/`pendingCreateFolders` idiom (see [Daemon connection — correlation](daemon-connection-correlation.md)
§ Attachment-retrieval correlation), a fifth-and-sixth-tier map alongside `activeTransfers`. Each entry
holds the reassembler, the consumer and the live idle-deadline handle. The numeric envelope id stays
main-internal and never rides an event to the window.

`requestAttachment`:
- `driver === null` → `consumer.fail('not-connected')`, immediately — `requestDebugBundle`'s posture
  (a call owning an awaiting caller must never be a silent no-op).
- Otherwise **builds and sends first, registers the pending entry only once the frame is on the
  wire** — see § Revision below for why this order, not the arm-before-send order every other
  correlation map in this file uses, is the correct one here.
- A build/send throw settles the consumer immediately as `'send-failed'` and registers nothing.

Two answers, correlated differently:

- **`attachment-chunk`** — routed by `inReplyTo` to the pending entry; the reassembler independently
  refuses a chunk naming a different `attachment_id` (the non-redundant second check, § above). A frame
  matching no entry is dropped: no event, no log, no throw. Each accepted chunk **resets the idle
  timer** — cleared and re-armed before the chunk is fed in, since `chunk()` may settle synchronously
  and a timer armed after would run against a retrieval that no longer exists.
- **The `daemon-error` arm** — the retrieval correlation is the fourth member of the existing
  unique-per-request-envelope-id tier, checked alongside `pendingSettings`/`pendingCreateFolders`/
  `transferForEnvelope`. `attachment.stream_aborted` is routed **through the reassembler's two-member
  pass-through door** (`retrieval.reassembler.fail('stream-aborted')`) rather than settled directly,
  because that door is where the discard-the-partial obligation lives — everything accumulated goes
  with it. `attachment.not_found` settles `'not-found'` directly; any other code settles
  `'daemon-error'` directly — neither goes through the reassembler, since a reject yields no bytes and
  there is nothing accumulated to discard. `AttachmentFailReason` (the reassembler's own closed set) is
  **not widened** for either — the resolution the architecture doc's Open Question left for
  implementation.

One `settleRetrieval` choke point clears the timer, deletes the map entry and calls the consumer, so
"exactly one terminal" is a property of there being one exit rather than a guard at each call site.

**The idle deadline is genuinely new work** — there was no timer in any transfer path in this repo
before this ticket. It is an idle deadline, not a total-duration one: armed at send, reset on every
accepted chunk, 30 s (`RETRIEVAL_IDLE_TIMEOUT_MS`, restating `relayConnection`'s `WIRE_PONG_TIMEOUT_MS`
figure — the deterministic backstop one layer down). On fire it settles `'timed-out'` and releases the
reassembler's accumulated bytes by dropping the entry. Injected through a `timing?: { retrievalIdleTimeoutMs?;
setTimer?; clearTimer? }` seam on `DaemonConnectionDeps`, `createRelaySupervisor`'s idiom verbatim —
this repo's one testable-timer pattern, used because there is no fake-timer precedent in `src/main`.

`failAttachmentRetrievals()` — the teardown net, modelled on `failAttachmentTransfers` (the set-shaped
twin) rather than `failBundleStream` (the single-slot one): snapshot and clear the map, clear every
timer, then fail each consumer `'connection-lost'`. Called from the same four sites as its siblings —
`relay-link-down`, `terminal`, connection-level `error`, and `dial()` — so a connection lost
mid-retrieval fails every retrieval in flight, and a recycled envelope id after a re-dial can never
correlate on the fresh session.

### 4. The orchestrator — `src/main/attachmentRetrieval.ts`

[`debugBundleDownload.ts`](debug-bundle-reassembly.md)'s structure — a per-request consumer mapping
`complete` to the store and `fail` to a failure event — with two deliberate departures: **not
single-in-flight** (two attachments fetch concurrently) and its terminal event carries **no `path`**
where `debugBundleSaved` carries one (`attachmentStore`'s docblock: the path is a return value for
\#814/#866/#867, never something to forward or log).

```ts
export const ATTACHMENT_MAX_CONCURRENT_RETRIEVALS = 4

export interface AttachmentRetrievalDeps {
  requestAttachment: (payload, consumer: AttachmentRetrievalConsumer) => void
  store: (attachmentId: string, bytes: Uint8Array) => Promise<StoreAttachmentResult>
  diagnosticLog?: DiagnosticLog
}
export type AttachmentRetrievalEmit = (event: AttachmentRetrievalEvent) => void

export function createAttachmentRetrieval(
  deps: AttachmentRetrievalDeps
): (request: AttachmentRetrievalRequest, emit: AttachmentRetrievalEmit) => void
```

State is one `Map<string, AttachmentRetrievalEmit>` keyed by attachment id, doing four jobs: it bounds
concurrency at `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` (a `'busy'` refusal *before* the transport is
touched, so no reassembler is armed); it coalesces a duplicate ask for an id already in flight into a
total no-op (nothing sent, nothing reported — the live retrieval's own terminal, naming the same id,
answers both asks); it is what makes `attachmentId` a sound correlation key for the window (at most one
retrieval per id is live); and it holds the *asker's* emit, so a terminal reaches the window that
started the retrieval rather than whichever asked last. The entry is held **across** the async `store`
call and released only at the terminal — `debugBundleDownload`'s "holding the flag across the save"
argument, closing the window in which a duplicate ask could race the first one's write.

**Security cap, not just a nicety.** Without `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS`, an untrusted
renderer could open an unbounded number of concurrent retrievals with distinct ids, each accumulating
up to `ATTACHMENT_MAX_RETRIEVAL_BYTES` — voiding #995's per-transfer memory bound, which only bounds
anything multiplied by a bounded count. Four holds the peak footprint at ~92 MB conforming (~132 MB
against a host that ignores its own declared `size`).

`complete(bytes)` routes to `store`; the **store's settlement is the terminal**, not the call itself —
success emits `completed`, a rejection or `{ ok: false }` emits `store-failed` (a backstop:
`storeAttachment` is documented never to throw). `fail(reason)` emits `failed` verbatim — no second
mapping layer. **Never rejects**, licensing the composition root's bare `void`.

### 5. The composition root — `src/main/index.ts`

`ipcMain.on(ATTACHMENT_RETRIEVAL_CHANNEL, …)` beside the upload listener, removed on `will-quit`.
Applies `isAttachmentRetrievalRequest` and drops a failing ask. The attachment base directory is
computed here and only here — `join(app.getPath('userData'), ATTACHMENT_DIR_NAME)` — never from
anything the window sent, closed into `store`. **One driver for the app lifetime, not one per ask**:
its concurrency cap and its coalescing are state that only means anything across asks, so a
per-ask driver would silently disable both (the bug the first implementation attempt shipped — see
§ Revision below). The answer rides `event.sender`, captured per ask and closed into the `emit`
argument, guarded by `isDestroyed()` — a window closed mid-retrieval drops the outcome rather than
throwing. Cannot route through `live.sink`: its `send` re-supplies `DAEMON_EVENT_CHANNEL` regardless of
the channel argument given.

## Revisions during implementation

**`emit` moved from a construction dependency to a per-ask argument.** The design as first written
closed `emit` into `AttachmentRetrievalDeps` at construction, the `debugBundleDownload` shape. That is
internally inconsistent: the driver's concurrency cap and coalescing are process-lifetime state, but
the answer must go back to `event.sender`, a per-ask value — the two cannot both hold with `emit` fixed
at construction. The first implementation attempt built a driver *per ask* to reconcile them, which
silently disabled the cap and the coalescing outright (the security review's cap would have shipped as
a no-op). The fix: `createAttachmentRetrieval(deps)` returns `(request, emit) => void`, and the
in-flight set became a map from attachment id to that ask's `emit`, captured at start so a coalesced
duplicate cannot redirect a retrieval already under way to a different window.

**The pending entry is registered after the send, not before it** (fixed in a follow-up commit, review
of PR #1003). The original design armed `pendingRetrievals` *before* building and sending the frame —
`requestDebugBundle`'s stated discipline. But this client's envelope-id counter advances only on a
*successful* build, so an entry armed before a throw is left keyed to an id the *next* outbound
envelope re-mints; that entry then swallows the next envelope's reject, settling an unrelated retrieval
and starving the bundle net and the modal FIFO of a frame they were owed — plus the retrieval's own
terminal was wrong, `'timed-out'` 30 s later for a frame that never left the machine.

Why `requestDebugBundle`'s precedent didn't transfer: its single slot is **not keyed by an envelope
id**, so nothing it leaves behind can be re-minted. Both in-repo maps that *are* keyed by envelope id —
`pendingSettings`, `pendingCreateFolders` — already register *after* a successful send, for this exact
reason. Arming after the send is safe because an inbound frame reaches `onDriverEvent` through socket
I/O, which cannot run synchronously inside `driver.sendMessage`.

This also introduced `'send-failed'` as a new member on the shared union (mirroring
`AttachmentTransferFailure`'s member of the same name and meaning: a build/send throw, cause dropped
unexamined) and `MAX_RETRIEVAL_IDENTIFIER_LENGTH` at the IPC guard — an ~66 KB `attachmentId` is enough
to push the envelope over `MAX_PLAINTEXT_BYTES`, making the encode throw and the desync reachable from
the untrusted renderer rather than only from a main-side bug. The size bound is a **size** check, not a
canonicity one, so it does not duplicate `resolveAttachmentPath`'s gate.

## Error handling

| Failure | Detected by | Terminal |
|---|---|---|
| Malformed or over-length ask | `isAttachmentRetrievalRequest` at the main boundary | dropped — no frame, no fs call, no event |
| Duplicate ask, same id already in flight | orchestrator's in-flight map | no-op; the live retrieval's terminal answers it |
| 5th+ concurrent id | orchestrator's cap | `busy` |
| Not connected | `driver === null` | `not-connected` |
| Envelope build/send throws | `requestAttachment`'s catch | `send-failed` |
| `attachment.not_found` | correlated `daemon-error` | `not-found` |
| `attachment.stream_aborted` | correlated `daemon-error`, through the reassembler's door | `stream-aborted`, accumulated bytes discarded |
| Any other correlated daemon code | correlated `daemon-error` | `daemon-error` |
| Contradictory / oversized / unverifiable stream | the reassembler's own verdicts | `stream-contradiction` / `too-large` / `verification-failed` |
| Connection lost mid-retrieval | `failAttachmentRetrievals()`, four sites | `connection-lost` |
| Stream stops, no terminal frame | the idle deadline | `timed-out` |
| Write refused or failed | `storeAttachment` | `store-failed` |

## Security

Architect self-review verdict **PASS**, with one MUST FIX addressed before the initial commit (the
concurrency cap, § 4 above) and one addressed in the follow-up fix (the arm-after-send ordering plus
the identifier length bound, § Revisions above). Full findings in
`docs/specs/architecture/996-attachment-retrieval-driver.md` § Security review, including its
Revisions section. Load-bearing points not covered above:

- `conversationId` crosses to the wire deliberately unvalidated — naming a conversation is not
  authorization on this wire, and it never touches a local path on this side.
- `attachmentId` reaches a filesystem call through exactly one route — `storeAttachment` →
  `resolveAttachmentPath` — and this feature adds no second canonicity check.
- Logging is the static event name `attachment-fetch` plus a client-owned `code` and nothing else — no
  identifier, no byte length, no chunk count, no path, no digest. Narrower than the upload leg's on
  purpose: the byte length the upload leg logs is *this side's own file* there; here it is
  wire-derived information about a host file.
- A hostile daemon inside the session can serve arbitrary bytes with a matching digest (#995's inherent
  integrity-not-authenticity limit); can correlate a reject to a request never made (no entry, dropped);
  can correlate an upload-leg code to a retrieval (settles `daemon-error`, reported honestly).
- **Out of scope, accepted:** nothing evicts stored attachment files, so repeated fetches accumulate on
  disk — #995's documented limitation; retention has no ticket in any repo.

## Testing

All vitest — main-process and IPC-contract work with no renderer surface, so no Playwright spec.

- `src/shared/ipc/attachmentRetrieval.test.ts` — the guard's accept/refuse table (non-object, `null`,
  missing field, non-string, empty string, over-length, an explicitly-`undefined` field — structured
  clone preserves the property across the bridge, so `'x' in value` alone would pass one through); the
  two channel constants distinct from each other and from `DAEMON_EVENT_CHANNEL`.
- `src/main/attachmentRetrieval.test.ts` — `completed` on a successful store; `store-failed` on
  `{ ok: false }` and a rejected promise; every consumer reason reaching the window as itself; two
  different ids running concurrently with independent terminals; a duplicate ask for a live id starting
  nothing; a fifth concurrent id refused `busy` without reaching `requestAttachment`; the in-flight id
  held across the store's async gap; every emitted event and logged record checked field-by-field for
  the absence of a path.
- `src/main/daemonConnection.test.ts` — not-connected synchronous `not-connected` with no wire frame;
  the sent frame decoding to `request_attachment` with exactly the two ids as a fresh literal; a chunk
  correlated by `in_reply_to` reaching the right retrieval with no cross-feed between two concurrent
  ones; a chunk naming an unknown `in_reply_to` dropped; `attachment.not_found` / `.stream_aborted`
  (with accumulated-chunk discard) / another code / an uncorrelated error, each settling correctly; a
  teardown at each of the four sites failing every retrieval in flight; the injected idle timer firing
  `timed-out`, reset by an accepted chunk, cleared on every settle path.

A settle-once driver makes `request(); assert()` tests wrong at the wiring layer — the orchestrator's
terminal crosses a real microtask boundary through `store`, so terminal-state tests drain the microtask
queue rather than taking a single tick.

## Edge cases and limitations

- **The served case is narrower than the parent user story.** The only attachment identifiers this app
  knows are ones it minted itself when uploading (`randomUUID` in `attachmentUpload.ts`) — the daemon's
  inbound `message` payload carries no attachment ids and no list verb exists on the wire. So this
  serves fetching back the operator's own file after a reopen or from another machine, not an
  assistant-produced file; that needs a daemon-side change with no ticket in any repo.
- **Retry is out of scope.** `stream-aborted` is documented retryable after a backoff, but no automatic
  retry is built — the operator asks again.
- **No per-attachment eviction.** Repeated fetches of the same id simply replace the stored file
  (`storeAttachment`'s content-addressed behaviour); nothing ever deletes it.
- **The concurrency cap (4) and the idle deadline (30 s) are both fixed constants**, not configurable
  per request — revisit if a consumer ticket needs otherwise.

## Related

- [Attachment reassembly and store](attachment-reassembly-and-store.md) — the two leaves this drives
  (#995): `createAttachmentReassembler` and `storeAttachment`.
- [Request-attachment envelope](request-attachment-envelope.md) — the outbound builder (#993) this
  drives, and the first live caller of its `id`-retention contract.
- [Attachment-chunk retrieval decode](attachment-chunk-retrieval-decode.md) — the inbound decode (#998)
  whose `RetrievedAttachmentChunk` this feature routes.
- [Daemon error outcome](daemon-error-outcome.md) — the reject-code decode (#999 widened it to this
  leg's two codes) this feature narrows down to `not-found` / `daemon-error`.
- [Attachment transfer](attachment-transfer.md) / [Attachment upload](attachment-upload.md) — the
  send-leg mirror image: opposite correlation-key assignment for a structural reason (§ above), and the
  IPC/composition-root shape this feature's § 1/2/5 copy.
- [Daemon connection](daemon-connection.md) / [Daemon connection — correlation](daemon-connection-correlation.md)
  — the composition/wiring layer hosting `pendingRetrievals`, `requestAttachment`, and the
  attachment-retrieval correlation tier.
- `docs/specs/architecture/996-attachment-retrieval-driver.md` — the full architecture spec, including
  the security review and the two implementation-time Revisions this doc summarizes.
- [Attachment save](attachment-save.md) — #814, landed: the first consumer, copying a retrieved file
  out to Downloads.
- [#866](https://github.com/pyrycode/pyrycode-desktop/issues/866) / [#867](https://github.com/pyrycode/pyrycode-desktop/issues/867) —
  the two remaining consumers, each blocked on this; not started.
