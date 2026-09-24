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
[attachment bytes](attachment-bytes.md)
([#866](https://github.com/pyrycode/pyrycode-desktop/issues/866), landed — deliver bytes to the window)
and [attachment open](attachment-open.md)
([#867](https://github.com/pyrycode/pyrycode-desktop/issues/867), landed — open in the OS viewer) are
the consumers, all three now landed on the background-process side.

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
listener runs. **The first caller landed in #816** — see [§ The renderer click
(#816)](#the-renderer-click-816) below — **and the second in #1044** — see [§ The renderer image source
(#1044)](#the-renderer-image-source-1044) below. The three background-process consumers are [attachment
save](attachment-save.md) (#814), [attachment bytes](attachment-bytes.md) (#866) and [attachment
open](attachment-open.md) (#867); #816 wires the first of them and #1044 wires the second, by way of
[attachment bytes](attachment-bytes.md). The third consumer's own click,
[#869](conversation-shell-message-bubble-attachments.md#the-attachment-image-thumbnail-1045), shipped
without this pair: the drawn thumbnail is itself proof this driver's retrieval already ran, so the
open-in-viewer ask needs no request/subscribe of its own — see [attachment open](attachment-open.md)
§ Composition-root wiring.

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

## The renderer click (#816)

[#816](https://github.com/pyrycode/pyrycode-desktop/issues/816) gave the [attachment file
row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816) its click, and wired it to
this driver first — not to [attachment save](attachment-save.md) (#814) directly, because the save
channel does not fetch and this driver's retrieval leg is the only writer of the directory it copies
from. `src/renderer/src/screens/conversation/downloadAttachment.ts` (new) subscribes to
`onAttachmentRetrievalEvent`, **then** calls `requestAttachment({ conversationId, attachmentId })` —
subscribe-before-ask is load-bearing, since `busy`/`not-connected` are decided synchronously in main and
the reverse order would be a race by construction. The listener ignores every event not naming this row's
`attachmentId`, tears itself down on the first one that does, and calls `saveAttachment({ attachmentId,
filename })` only on that event's own `completed` — never on `failed`, and never a second time. Full
design, including the fetch/save sequencing rationale, the button and accessible-name shape, and the
per-activation listener lifetime, is in [Conversation shell — message bubble § The attachment file
row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816).

**A pre-ask bound on *both* identifiers, not just `attachmentId`.** A malformed ask is dropped by
`isAttachmentRetrievalRequest` with no terminal at all (§ above), which would leak the renderer's
subscription forever if taken for an ask the guard was always going to drop. `downloadAttachment.ts`
therefore refuses to subscribe or ask when either identifier is empty or exceeds
`MAX_RETRIEVAL_IDENTIFIER_LENGTH`, imported rather than restated. This is a listener-lifetime
precondition, not a second security gate — `resolveAttachmentPath` stays the sole canonicity check. The
architect's security review's one MUST FIX against the first draft: `attachmentId` is client-minted, but
`conversationId` comes from `activeConversationStore`, which holds the daemon's
`ConversationCreatedPayload` **verbatim** off the wire — checking only the attachment id would leave a
hostile or buggy daemon able to make every activation's ask fail the guard while the listener still got
taken, accumulating one leaked `ipcRenderer` listener per click.

**No de-duplication on the renderer side**, deliberately: a second activation of the same row simply
fetches again, and this driver's own in-flight map (§ 4 above) already collapses a duplicate ask for an
attachment already being fetched into the live retrieval's single terminal, which every registered
listener receives — so two clicks on one row yield two save asks and two Downloads copies, accepted as
\#814's collision suffix to resolve, not this ticket's.

## The renderer image source (#1044)

[#1044](https://github.com/pyrycode/pyrycode-desktop/issues/1044) is the second renderer caller of this
driver, and the first to chain it into [attachment bytes](attachment-bytes.md): full design in
[Attachment image source](attachment-image-source.md). Where #816's `downloadAttachment.ts` fetches and
then saves to Downloads, `attachmentImageSource.ts` fetches and then *reads the same file back* over the
bytes channel, mints a `blob:` URL from what comes back, and answers its own caller with that URL rather
than with nothing.

The one wrinkle #816 didn't have to handle: **this driver's coalescing reaches every caller of one
attachment, and #1044's own AC4 depends on that.** Two concurrent asks for the same attachment id from
this module both go through `awaitTerminal`, subscribing before either asks; the in-flight map here (§ 4
above) collapses the second `requestAttachment` call into a no-op, so main sends one `request_attachment`
and pushes one `attachment-chunk`/completion terminal on the window's `webContents` — and both of
`attachmentImageSource`'s listeners are still registered when it arrives, so both settle from that single
event. A spec asserting two retrieval events for two asks here would be asserting the wrong thing; the
[attachment bytes](attachment-bytes.md) leg that follows behaves oppositely (no coalescing, two events),
which is the asymmetry [attachment image source § two callers](attachment-image-source.md#two-callers-and-the-two-legs-disagree-on-what-that-means)
is built around.

Same pre-ask bound as #816's click — both `conversationId` and `attachmentId` pass `addressable` before
either leg is subscribed, `MAX_RETRIEVAL_IDENTIFIER_LENGTH` imported rather than restated — for the
identical reason: a malformed ask is dropped with no terminal at all, so subscribing first would leak a
listener with nothing to ever tear it down.

## The `read_workspace_file` leg (#1626)

[#1626](https://github.com/pyrycode/pyrycode-desktop/issues/1626) reuses this driver's whole
correlation machinery for a second ask that has nothing to do with attachment storage: the in-app
markdown reader (#1627, Refresh in #1623) needs a file's current text from a conversation's workspace,
fetched live from the host with nothing saved on this machine. The daemon answers `read_workspace_file`
exactly as it answers `request_attachment` — a chunk stream correlated by `in_reply_to`, or one reject —
except that it **mints the transfer id itself**, so there is nothing for the client to pin in advance.

**`daemonConnection.ts`'s `requestAttachment` body became a shared `startRetrieval(build, pinnedId,
consumer)`.** `requestAttachment` is now `startRetrieval(id => buildRequestAttachment(...), payload.attachment_id,
consumer)`; the new `readWorkspaceFile(payload, consumer)` is `startRetrieval(id =>
buildReadWorkspaceFile(...), null, consumer)`. Everything after the send — the one `pendingRetrievals`
map keyed by envelope id, chunk routing, reject routing, the idle deadline and the four-site teardown
net — is untouched and shared by both verbs; only the frame and the reassembler's pin differ.

**The reassembler's pin became `attachmentId: string | null`.** `null` means adopt the first chunk's
`attachment_id` as `pinned` and hold every later chunk to it — still catches a stream that switches
transfers mid-flight, the same way the string-pinned mode does. What it cannot catch, because there was
never an id to ask for, is the host answering the right ask with the wrong bytes; that oracle only
exists when the client names the transfer itself, as `request_attachment` still does.

**Correlation on the IPC boundary is a window-minted request key, not the path.** A retrieval's outcome
addresses by attachment id because at most one retrieval per id is ever live (§ 4's coalescing); a
read has no such invariant — the reader's Refresh asks for the *same path* again, so the path cannot
tell two asks apart. `src/shared/ipc/workspaceFileRead.ts` mints its own channel pair
(`WORKSPACE_FILE_READ_CHANNEL` / `WORKSPACE_FILE_READ_EVENT_CHANNEL`, off `DAEMON_EVENT_CHANNEL` for
this doc's own § 1 reason) carrying `WorkspaceFileReadRequest { requestKey; conversationId; path }`.
`requestKey` is a client-internal token, echoed on the outcome and never sent to the daemon.
`isWorkspaceFileReadRequest` reuses `MAX_RETRIEVAL_IDENTIFIER_LENGTH` for `requestKey`/`conversationId`
and adds `MAX_WORKSPACE_FILE_PATH_LENGTH = 4096` (UTF-16 code units — PATH_MAX's order) for `path`; a
test builds the worst-case JSON-escaped envelope (6 bytes per code unit) and asserts it still encodes
under `MAX_PLAINTEXT_BYTES`. Shape and size only, exactly this driver's posture — the path gets no
canonicity check because nothing on this side resolves it; the daemon's confinement is the one gate,
and it is out of scope here by design (upstream pyrycode#2598).

**`WorkspaceFileReadFailure` is `Exclude<AttachmentRetrievalFailure, 'store-failed'> | 'not-text'`.**
`store-failed` is dropped because this leg writes nothing to disk for it to mean anything about;
`not-text` is new — the verified bytes decoded, but a fatal `TextDecoder('utf-8', { fatal: true
}).decode(bytes)` threw. The main flow's `fail(reason)` collapses a `store-failed` it can never
legitimately receive to `daemon-error` rather than forwarding it, so the event type stays honest about
a leg that never stores.

**`src/main/workspaceFileRead.ts`'s `createWorkspaceFileRead` copies § 4's orchestrator shape** — a
process-lifetime driver, a per-ask `emit`, a concurrency cap answered `busy` before the transport is
touched — with two departures. **No coalescing**: every ask, Refresh included, sends a fresh frame;
nothing is cached or deduplicated between asks, because the reader wants the file *as it is right now*,
not the first answer it got. **Nothing is stored**: `complete(bytes)` decodes in memory and the text
goes only to `emit`; there is no `store` call and no path ever exists on this side to log. The cap is
`ATTACHMENT_MAX_CONCURRENT_RETRIEVALS`, imported rather than restated, but counted in its **own**
in-flight number — reads and retrievals do not share one counter, so the accepted worst case is both
caps full at once (recorded as an open question in `docs/specs/architecture/1626-read-workspace-file.md`,
deferred until observed memory pressure says otherwise).

**Composition root and preload copy this driver's shapes exactly.** `src/main/index.ts` routes
`readWorkspaceFile` by conversation through the same router `attachmentRetrieval`'s registration uses,
fails `not-connected` on no owner, and guards the reply with `isDestroyed()`, removed on `will-quit`.
`src/preload/index.ts` adds `readWorkspaceFile(request)` (fire-and-forget send) and
`onWorkspaceFileReadEvent(listener)` (strip-`IpcRendererEvent`-and-resubscribe) beside the retrieval
pair. No renderer caller is wired yet — the reader (#1627) is the first consumer.

**Testing lesson: a "one terminal per ask" test that only checks a later ask is admitted can pass even
when a double settle double-decrements the in-flight counter.** The counter would read low enough to
admit one more ask than the cap allows, and a test that stops at "the next ask succeeds" never notices.
The check has to push a real ask *past* the cap and assert `busy`, not merely that admission continued.

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
- [Attachment bytes](attachment-bytes.md) — #866, landed: the second consumer, delivering the bytes
  to the window for display.
- [Attachment open](attachment-open.md) — #867, landed: the third consumer, opening a file in the OS
  image viewer.
- [Attachment image source](attachment-image-source.md) — #1044, landed: the second renderer caller of
  this driver, chaining its `completed` terminal into [attachment bytes](attachment-bytes.md) and
  minting a `blob:` URL from what comes back — see [§ The renderer image source
  (#1044)](#the-renderer-image-source-1044) above.
- `docs/specs/architecture/1626-read-workspace-file.md` — the full architecture spec for the
  `read_workspace_file` leg (§ above), including its security review and the accepted open question
  on the two legs' separate in-flight caps.
- `src/main/transport/readWorkspaceFileEnvelope.ts` — the `read_workspace_file` builder,
  [request-attachment envelope](request-attachment-envelope.md)'s `{id, ts, payload}` shape restated
  for a payload the daemon, not the client, mints a transfer id for.
- `src/shared/ipc/workspaceFileRead.ts` / `src/main/workspaceFileRead.ts` — the read leg's own IPC
  contract and main-process driver, § above.
