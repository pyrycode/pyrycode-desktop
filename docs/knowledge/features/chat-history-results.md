# Protected chat history results

Result states, local failure presentation and preservation rules for
[protected local chat history](chat-history.md).

## Results and failure preservation

Timeline reading shows “Loading saved messages…” while pending in either connection
state. Nonempty restored content shows “Offline. Showing saved messages.” only while
the selected host is unavailable; connected opening and reconnect show no offline
notice. Both `missing` and a stored empty timeline succeed and draw no notice at
all — a loaded, empty local read reads as the ordinary state of a chat opened for
the first time on this machine, not a fault (\#1447). Errors, rejected
IPC, invalid snapshots, unexpected result statuses and wrong host/conversation/kind
results instead show “Could not read saved messages on this device.” A local read
failure changes neither `SessionState.statuses` nor saved data and creates no
connection, working, permission or recovery state. The failed-host repair control
remains available. Stale failures cannot replace newer received content or attach
to a cleared/evicted slice. There is no automatic retry loop.

For sidebar restoration, both `missing` and a stored empty list settle as a loaded
empty host slot (`[]`, with `localListReads` set to `loaded`). Errors and rejected
IPC instead leave the list absent and mark that host `failed`; unexpected result
status, snapshot kind or host coordinates fail the same way. They never masquerade
as loaded-empty data.

`HostRow` shows “Could not read saved chats on this device.” beneath the affected
host in each sidebar tree. This local failure is separate from connection dots,
failed-connection styling and the repair control. It changes neither connection
status nor saved data and triggers no write, deletion, network request or retry
loop. A newer received list clears the local failure state. Stale failures cannot
attach an error to a newer list or a cleared host.

| Result | Meaning |
| --- | --- |
| `{ status: 'missing' }` | No matching snapshot exists in a readable or absent collection. |
| `{ status: 'stored', snapshot }` | A snapshot exists, including an explicitly saved empty list or timeline. |
| `{ status: 'ok' }` | A mutation completed, including an unchanged replacement or repeated removal. |
| `{ status: 'error', code }` | A static failure classification; no caught exception details. |

| Error code | Meaning |
| --- | --- |
| `invalid-request` | Request validation failed, including an unsupported version supplied for replacement. |
| `unknown-host` | No saved pairing exists, or removal invalidated the request's admission generation. |
| `membership-unavailable` | The saved-host lookup threw. |
| `unreadable` | Reading, decryption, UTF-8/JSON decoding or stored-record validation failed. Duplicate snapshot identities are invalid. |
| `unsupported-version` | The stored collection or a stored snapshot has a safe-integer numeric version other than 1. Malformed version values are `unreadable`. |
| `encryption-unavailable` | A required protected write raised `EncryptionUnavailableError`, including a removal that must rewrite remaining records. |
| `write-failed` | A replacement failed for another write/encryption reason. |
| `remove-failed` | A removal's replacement or deletion failed for another reason. |

Reads never write. Every mutation first reads and validates the entire collection;
an unreadable or unsupported collection is preserved, including on removal. It is
never treated as an empty default. A failed replacement leaves the previous
readable ciphertext intact and does not prevent subsequent operations. This
differs from the [paired-server store](paired-server-store.md)'s deliberate
malformed-record overwrite during re-pairing: chat history has no such recovery
exception.

Diagnostics contain only static lifecycle event names and operation/result codes:
`history-storage-operation`, `history-storage-result`, `history-handler-result`,
`history-writer-started`, `history-writer-result`, `history-flushed`,
`history-list-restore`, `history-timeline-restore` and `history-unpair-cleanup`
(static lifecycle/result codes).
They include no requests, coordinates, message content, keys, storage paths or
caught errors. Successful reads return the declared chat content; error replies
contain only their static classification.

Projection failures, rejected storage results and IPC exceptions stay local to
recording; they never dispatch connection failures or disable the live chat.
The drain remains usable for later changed content. A failed save is not an
automatic retry loop for an unchanged snapshot.

Conversation cleanup reports `history-writer-result: conversation-removed` only
after storage returns `status: 'ok'`. Classified failures report their static error
code, unexpected results report `remove-failed`, and thrown IPC failures report
`ipc-failed`, without coordinates or exception text. Failed removal preserves the
protected store's prior content and retains stale-save suppression; daemon
confirmation alone does not prove local cleanup succeeded. There is no automatic
removal retry, but another confirmed receipt can retry it.

