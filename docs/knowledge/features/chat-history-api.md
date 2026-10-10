# Protected chat history — API and operations

Part of [Protected local chat history](chat-history.md). The fixed IPC surface and
main-process handler authorize saved-host operations independently of connection.

## API

[`src/shared/chatHistory.ts`](../../../src/shared/chatHistory.ts) defines
`ChatHistorySnapshot`, `ThreadSnapshot`, `DurableThreadItem`, `ChatHistoryRequest` and
`ChatHistoryResult`, plus the pure `parseChatHistorySnapshot` and
`parseChatHistoryRequest` validators. Shared code imports no renderer implementation.
The [thread item store](thread-item-store.md) re-exports `ThreadSnapshot` from this
contract. `kind: 'daemon-items'` records contain `{ version: 1, serverId,
conversationId, thread }`; `thread.hostId` and `thread.conversationId` must match
the outer coordinates. The outer format version and held thread's applied version
are separate values. Version-1 `timeline` records keep app-built rows and merge
evidence for the one-release fallback. They coexist with daemon records at the same
host/conversation, and legacy reads never convert rows into authoritative items.

[`createChatHistoryStore({ secureStore, log })`](../../../src/main/chatHistoryStore.ts)
returns `execute(request: unknown): Promise<ChatHistoryResult>`.
[`createChatHistoryHandler({ store, pairedServers, log })`](../../../src/main/chatHistoryHandler.ts)
returns an injected listener `(event: unknown, request: unknown)` with the same
result. It validates and copies the request synchronously, then checks
`pairedServers.loadById(serverId)` for existence before accessing chat storage.
Saved hosts are eligible while disconnected or pairing-rejected; a live
connection is never consulted.
The store validates independently but has no pairing dependency, so saved-host
authorization belongs to the handler. Pairing records are reduced to membership,
never forwarded to the caller.

[`src/main/index.ts`](../../../src/main/index.ts) registers one handler over one
store for the app lifetime, sharing the existing secure store and paired-server
store. Preload exposes `window.pyry.chatHistory(request): Promise<ChatHistoryResult>`
on the fixed `pyry:chat-history` channel; `PyryApi` carries its type into the window.
Reads and replacements need no handshake.

The callable handler also exposes main-only `clearServer(serverId, clearCredentials)`.
The composition root supplies it to the existing unpair handler: credential erasure
and protected `removeServer` run in the same queue as history membership checks and
storage operations. Earlier admitted work finishes before removal. Each history
request captures a host generation at admission; a matched credential erase advances
that generation before releasing the queue, even if history cleanup fails. Requests
queued behind removal with the old generation return `unknown-host`, including after
same-server re-pairing. Fresh requests still require saved-host membership. Calling
renderer `removeServer` after erasing credentials cannot replace this coordination:
it would fail membership validation.

A credential erase that throws or matches no record leaves history and the generation
untouched. After a matched erase, cleanup failure or a thrown cleanup error preserves
the successful credential outcome, so label cleanup, connection teardown and the
unpaired-state transition continue. `history-unpair-cleanup` records only static
`ok` or `failed`; successful unpair alone does not establish successful history deletion.
Successful cleanup removes the list and every timeline/daemon-item record for that
`server` identity, including off-screen conversations absent from the latest list,
while preserving other hosts' equal conversation/item ids.

Every request has `operation` and `serverId`. Additional fields are operation-specific:

| Operation | Additional fields | Effect |
| --- | --- | --- |
| `readList` | None | Read the host's ordered list snapshot. |
| `replaceList` | `snapshot` of kind `list` | Replace that list; omitted conversation records remain saved. |
| `readTimeline` | `conversationId` | Read only the addressed legacy timeline. |
| `replaceTimeline` | `conversationId`, `snapshot` of kind `timeline` | Replace only that legacy timeline in full, preserving supplied row order. |
| `readThread` | `conversationId` | Read only the addressed daemon-item record. |
| `replaceThread` | `conversationId`, `snapshot` of kind `daemon-items` | Replace only that held thread snapshot in full. |
| `removeConversation` | `conversationId` | Atomically remove both conversation formats and its entry from the host's saved list. |
| `removeServer` | None | Remove every snapshot for that host, including conversations absent from its latest list. |

Unknown request keys, malformed snapshots, a wrong snapshot kind, or mismatched
snapshot/request coordinates produce `invalid-request` before any record access.
Callers cannot supply a storage path or blob name. Snapshot schema extensions are
discarded on projection rather than rejected, except unknown fields inside held
daemon items, which remain inert JSON. Declared legacy tool `input` remains a
string-to-string map with its supplied keys.

Daemon validation requires nonnegative safe-integer item ids/revisions and progress,
unique held ids, checkpoint no greater than applied version, and ordered,
nonoverlapping ranges with valid endpoints. A declared repair starts at checkpoint
and cannot end below it; `uncommittedVersion` cannot exceed applied version but may
be at or below checkpoint. Optional `arrivalOrder` must be a complete permutation
of held ids, with no missing, duplicate, unknown or invalid ids. Optional
`olderAvailable` is boolean; omission remains absent. See
[unfinished-progress defaults](thread-item-store.md#repair-and-unfinished-batch-checkpoint-fences).

Held items validate id/kind/revision rather than full-add wire optional fields:
patch-produced nulls and unknown attribution/content fields must survive. JSON
copying preserves own `__proto__`/`constructor` keys as data, rejects non-JSON values,
cycles, nesting beyond 64 and more than 100,000 aggregate item JSON nodes, and uses
the existing string/array bounds. Invalid requests are classified before storage;
malformed saved metadata uses `unreadable`. Neither path replaces valid saved data,
and diagnostics remain static event/code values without content or coordinates.

`createChatHistoryWriter` accepts optional `threads` alongside existing stores;
changed owned snapshots use `replaceThread` through its coalescing drain. Hydration
is excluded from saves, and later received changes remain eligible. Confirmed
deletion clears that held scope and suppresses both saved formats; successful
unpair invalidates all that host's held threads and reads. See
[storage ordering](chat-history.md#storage-and-concurrency).

`readSavedTimeline` accepts optional `threads` and then uses `readThread`; without
it, legacy callers keep `readTimeline`. It returns `{ done, cancel }` and checks
record kind and exact coordinates before completing the store-owned local read.
`beginLocalRead(host, conversation)` returns null for held scopes; otherwise its
one-shot complete/fail/cancel handle uses a process-local token. A replacement read,
admitted state or scoped cleanup invalidates it, even when identity strings are
reused. Delayed stored, missing or failed reads cannot replace admitted facts.
Restoration sends no transport requests or raw events and certifies no progress.
Production thread lifecycle activation remains
[#1908](https://github.com/pyrycode/pyrycode-desktop/issues/1908).
