# #1626 — fetch a workspace markdown file's current text for the window

## Files read

- `src/main/daemonConnection.ts` → `requestAttachment`, `PendingRetrieval`, `pendingRetrievals`, `settleRetrieval`, `armRetrievalDeadline`, `failAttachmentRetrievals`, the `attachment_chunk` arm and the `error` arm of `onDriverEvent` — the whole retrieval correlation machinery this ticket reuses unchanged; only the ask differs.
- `src/main/transport/attachmentReassembler.ts` → `createAttachmentReassembler` — pinned to the asked id today; gains a "pin on first chunk" mode.
- `src/main/transport/requestAttachmentEnvelope.ts` → `buildRequestAttachment` — the builder the new one mirrors.
- `src/main/attachmentRetrieval.ts` → `createAttachmentRetrieval`, `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` — the main-side flow the new one mirrors (process-lifetime driver, per-ask emit, cap answered `busy`).
- `src/shared/ipc/attachmentRetrieval.ts` → `isAttachmentRetrievalRequest`, `MAX_RETRIEVAL_IDENTIFIER_LENGTH`, `AttachmentRetrievalFailure` — guard idiom, identifier bound and failure vocabulary reused.
- `src/main/index.ts` → the `createAttachmentRetrieval` registration and `attachmentRetrievalListener` — the composition-root shape the new registration copies (route by conversation, `not-connected` on no owner, `isDestroyed` guard).
- `src/main/connectionRegistry.ts` → the stand-in facade object — every `DaemonConnection` method needs a forwarding line, so a new method is a forced one-line edit here.
- `src/preload/index.ts` → `requestAttachment`, `onAttachmentRetrievalEvent` — bridge shape to copy.
- `src/shared/wire/types.ts` → `EnvelopeType`, `RequestAttachmentPayload` — where the wire mirror lands.
- pyrycode `internal/protocol/attachments.go` → `ReadWorkspaceFilePayload` — SSOT: `conversation_id`, `path`, both always present; markdown only; every refusal is `attachment.not_found`; never log or echo the path.

## Design source

**Figma:** N/A — main-process transport and IPC only; nothing renders. The reader is #1627.

## Context

The in-app markdown reader (#1627, Refresh in #1623) needs the current text of a file in a conversation's workspace, fetched live from the host with nothing stored on this machine. The daemon answers `read_workspace_file` exactly as it answers `request_attachment` (chunk stream by `in_reply_to`, or one reject), except that the daemon mints the transfer id. So the transport reuses the retrieval leg wholesale; the new parts are the ask, the first-chunk pin, the UTF-8 decode and a request-key-correlated IPC pair.

**Size overage, stated per the floor rule.** Nine production files (ceiling 5): the eight the ticket names plus `connectionRegistry.ts`, whose facade gains one forwarding line because `DaemonConnection` gains a method. Each transport piece has this flow as its only consumer, so no slice would be observable on its own; the refiner's estimate already records this. Overlapping in-flight branches: none found at plan time.

## Design

### Wire (`src/shared/wire/types.ts`)
- `EnvelopeType` gains `'read_workspace_file'`.
- `ReadWorkspaceFilePayload { conversation_id: string; path: string }`, beside `RequestAttachmentPayload`, no optionals.

### Builder (`src/main/transport/readWorkspaceFileEnvelope.ts`, new)
- `buildReadWorkspaceFile({ id, ts, payload }): Uint8Array` — `buildRequestAttachment`'s shape. No validation, no log.

### Reassembler (`attachmentReassembler.ts`)
- `createAttachmentReassembler(attachmentId: string | null, consumer)`. `null` = pin to the first chunk's `attachment_id`; every later chunk must match (else `stream-contradiction`). A string keeps today's behaviour exactly (first chunk naming another id is refused).

### Transport (`daemonConnection.ts`)
- `requestAttachment`'s body becomes a module-internal `startRetrieval(build: (envelopeId: number) => Uint8Array, pinnedId: string | null, consumer)`: not-connected check, build + send + counter advance, `send-failed` on throw, register entry with reassembler and deadline. Behaviour identical.
- `requestAttachment` = `startRetrieval(id => buildRequestAttachment(...fresh literal...), payload.attachment_id, consumer)`.
- New `DaemonConnection.readWorkspaceFile(payload: ReadWorkspaceFilePayload, consumer: AttachmentRetrievalConsumer): void` = `startRetrieval(id => buildReadWorkspaceFile(...fresh literal { conversation_id, path }...), null, consumer)`.
- Chunk routing, reject routing (`attachment-not-found` → `not-found`, `attachment-stream-aborted` → reassembler abort, else `daemon-error`), idle deadline and connection-loss net are the existing ones keyed by envelope id — no edit.

### Registry (`connectionRegistry.ts`)
- One forwarding line `readWorkspaceFile: (payload, consumer) => resolve().readWorkspaceFile(payload, consumer)`.

### IPC contract (`src/shared/ipc/workspaceFileRead.ts`, new)
- `WORKSPACE_FILE_READ_CHANNEL = 'pyry:workspace-file-read'`, `WORKSPACE_FILE_READ_EVENT_CHANNEL = 'pyry:workspace-file-read-event'` — off `DAEMON_EVENT_CHANNEL` for `attachmentRetrieval.ts`'s header reason.
- `MAX_WORKSPACE_FILE_PATH_LENGTH = 4096` UTF-16 code units. Envelope bound argument: worst-case JSON escaping is 6 bytes per code unit (`\u00XX`), so path ≤ 24 576 bytes plus conversation id ≤ 1 536 bytes plus a ~100-byte frame stays well under `MAX_PLAINTEXT_BYTES` (65 519). A test builds the worst-case envelope and asserts it encodes.
- `WorkspaceFileReadRequest { requestKey: string; conversationId: string; path: string }`.
- `isWorkspaceFileReadRequest(value): value is WorkspaceFileReadRequest` — `isAttachmentRetrievalRequest`'s idiom: object, own `in` checks, strings; `requestKey` and `conversationId` non-empty and ≤ `MAX_RETRIEVAL_IDENTIFIER_LENGTH`; `path` non-empty and ≤ `MAX_WORKSPACE_FILE_PATH_LENGTH`. Shape and size only; no path canonicity (the daemon confines).
- `WorkspaceFileReadFailure = Exclude<AttachmentRetrievalFailure, 'store-failed'> | 'not-text'` — nothing is stored, so `store-failed` has no meaning here; `not-text` is bytes that are not valid UTF-8.
- `WorkspaceFileReadEvent = { type: 'loaded'; requestKey; text } | { type: 'failed'; requestKey; reason: WorkspaceFileReadFailure }`.

### Main flow (`src/main/workspaceFileRead.ts`, new)
- `createWorkspaceFileRead({ readWorkspaceFile, diagnosticLog? }) => (ask, emit) => void`. Process-lifetime driver, per-ask emit.
- In-flight **count** (no coalescing — every ask sends a fresh envelope; no cache). At `ATTACHMENT_MAX_CONCURRENT_RETRIEVALS` → `emit({ type: 'failed', requestKey, reason: 'busy' })`, transport untouched.
- Calls `readWorkspaceFile({ conversation_id: ask.conversationId, path: ask.path }, consumer)` — fresh literal.
- `complete(bytes)`: `new TextDecoder('utf-8', { fatal: true }).decode(bytes)`; success → `loaded` with text; throw → `not-text` (caught object dropped).
- `fail(reason)`: forwarded; the type-level `store-failed` (never produced by the transport on this leg) collapses to `daemon-error` so the event type stays honest.
- Exactly one terminal per started ask; slot released before emit. Logs `{ event: 'workspace-file-read', code }` only — static codes, never path, key or text.

### Composition root (`src/main/index.ts`)
- Build the driver with `readWorkspaceFile: (payload, consumer) => router.route(payload.conversation_id)?.readWorkspaceFile(...)`, `consumer.fail('not-connected')` when no owner.
- `ipcMain.on(WORKSPACE_FILE_READ_CHANNEL, ...)`: drop unless `isWorkspaceFileReadRequest`; emit via `event.sender.send(WORKSPACE_FILE_READ_EVENT_CHANNEL, ...)` behind `isDestroyed()`; remove on `will-quit`.

### Preload (`src/preload/index.ts`)
- `readWorkspaceFile(request: WorkspaceFileReadRequest): void` (fixed channel send) and `onWorkspaceFileReadEvent(listener): () => void` (strips the IpcRendererEvent, returns unsubscribe). No consumer wired — #1627.

## State + concurrency model

- Transport: one `pendingRetrievals` map shared by both verbs, keyed by envelope id; unchanged single-writer synchronous mutation; deadline re-armed per chunk; `failAttachmentRetrievals` covers reads on every teardown.
- Flow: a number counter; incremented at start, decremented in the single `settle`. The decode runs synchronously inside `complete`, so no await gap exists.
- Teardown: window closed mid-read → emit dropped by `isDestroyed`; connection lost → `connection-lost` via the existing net; silence → `timed-out` via the existing deadline.

## Error handling

Every outcome is a static client-owned literal on the window's own `requestKey`: `busy`, `not-connected`, `send-failed`, `not-found`, `daemon-error`, `timed-out`, `stream-contradiction`, `too-large`, `verification-failed`, `stream-aborted`, `connection-lost`, `not-text`. No path, filename, daemon message or byte count on any event or log. Nothing touches disk.

## Testing strategy (vitest, fake transport)

- `readWorkspaceFileEnvelope.test.ts`: type, id, ts, payload exactly `{conversation_id, path}`; worst-case bounded path + id envelope encodes under the cap.
- `attachmentReassembler.test.ts`: `null` pin adopts the first chunk's id and completes multi-chunk; later chunk with another id → `stream-contradiction`. (Existing pinned-mode refusal tests stay.)
- `daemonConnection.test.ts` (`readWorkspaceFile` block): not-connected sends nothing; one envelope with exactly the two keys; two asks → two envelopes; chunks with a daemon-minted id complete; changed id on chunk 2 fails; `attachment.not_found`, `attachment.stream_aborted`, other code, relay-link-down, idle deadline each settle once with the right reason.
- `shared/ipc/workspaceFileRead.test.ts`: channels distinct from neighbours; guard accepts valid; rejects non-object, missing field, non-string, empty and over-bound path, over-bound / empty key and conversation id, inherited `__proto__` keys.
- `workspaceFileRead.test.ts` (main flow): fresh-literal payload with no smuggled key; `loaded` with text and key; invalid UTF-8 → `not-text`; each transport reason forwarded with key; `busy` at cap without touching transport; slot freed after terminal; one terminal per ask; logs carry only static codes (no path/text/key).
- Composition root and preload are wiring only (not unit-tested in this repo); `npm run build` typechecks them.

## Documentation handoff

Pending for the documentation stage: fold the `read_workspace_file` leg (the first-chunk pin, request-key correlation, `not-text`) into the attachment-retrieval package overview under `docs/knowledge/features/`. The ticket names no other documentation requirement.

## Open questions

- Should reads share the retrieval cap's counter rather than hold their own? Plan: own counter, same figure. Revisit only on observed memory pressure.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — two boundaries, each a single named function. Renderer → main: `isWorkspaceFileReadRequest` bounds all three strings before anything runs; `createWorkspaceFileRead` and `daemonConnection.readWorkspaceFile` each rebuild a fresh literal so a smuggled key never reaches the envelope. Daemon → main: the unchanged `attachment_chunk` decode plus the reassembler's declaration, size and sha256 checks, then a fatal UTF-8 decode; only a `string` crosses back.
- [Trust boundaries] SHOULD FIX (addressed in design) — the path is attacker-influenced (it is a link target the assistant wrote). It is never resolved, joined, stat'ed or used locally on this side; it goes only into the envelope. The verifier should confirm no `path`/`fs` import in the new flow module.
- [Tokens] No findings — no token, key or secret is created, stored or read; the transport's keys stay in `daemonConnection`'s driver.
- [File / storage] No findings — nothing is written to disk and nothing is read locally; the text lives in main memory for one synchronous decode and one IPC send. No path is built from any input.
- [Electron attack surface] No findings — one new `ipcMain.on` channel with a guard that drops malformed asks; preload exposes a fixed-channel sender and a listener that strips the `IpcRendererEvent`; no `ipcRenderer` crosses the bridge; no window or webPreferences change. Returned text is daemon content; rendering it safely (no `innerHTML`) is the reader's (#1627) obligation under the CLAUDE.md daemon-text rule.
- [Crypto] No findings — sha256 via `node:crypto` in the existing reassembler; no new primitive.
- [Network & I/O] No findings — size bounded by `ATTACHMENT_MAX_RETRIEVAL_BYTES` per read and by the in-flight cap in count; silence bounded by the existing idle deadline; envelope size provably under `MAX_PLAINTEXT_BYTES` via the guard bounds (tested).
- [Network & I/O] Note — reads hold their own cap of 4, so aggregate worst-case accumulation across retrieval and read is 8 × ~23 MB. Accepted; recorded as the open question.
- [Logs] No findings — logs carry only `workspace-file-read` plus static codes; the path, request key, text and daemon message never reach a log or an event; caught decode/build errors are dropped uninspected.
- [Concurrency] No findings — the single-writer map, per-chunk re-arm and teardown net are reused; the flow's counter is released at one exit before emit; one terminal per ask by construction (entry removal in `settleRetrieval`).
- [Threat model] No findings — hostile relay: drops/delays end in `timed-out` or `connection-lost`; hostile daemon: wrong/changed transfer id, oversize, bad digest and non-UTF-8 each end in a static failure; renderer compromise gains only the ability to ask the paired daemon for a markdown file in a conversation workspace, which the daemon confines — the same capability the reader grants legitimately. Path confinement is upstream's (pyrycode#2598) and OUT OF SCOPE here by design.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
