# Protected chat history results

Result states, local failure presentation and preservation rules for
[protected local chat history](chat-history.md).

## Results and failure preservation

Saved-thread reading shows “Loading saved messages…” while pending in either connection
state. Nonempty restored content shows “Offline. Showing saved messages.” only while
the selected host is unavailable; connected opening and reconnect show no offline
notice. Both `missing` and a stored empty daemon thread succeed and draw no notice at
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
| `{ status: 'missing' }` | No matching snapshot exists in readable storage. |
| `{ status: 'stored', snapshot }` | A snapshot exists, including an explicitly saved empty list, timeline or daemon thread. |
| `{ status: 'ok' }` | A mutation completed, including an unchanged replacement or repeated removal. |
| `{ status: 'error', code }` | A static failure classification; no caught exception details. |

| Error code | Meaning |
| --- | --- |
| `invalid-request` | Request validation failed, including an unsupported version supplied for replacement. |
| `unknown-host` | No saved pairing exists, or removal invalidated the request's admission generation. |
| `membership-unavailable` | The saved-host lookup threw. |
| `unreadable` | Reading, decryption, UTF-8/JSON decoding or stored-record validation failed. Duplicate snapshot identities are invalid. |
| `unsupported-version` | The stored collection or a stored snapshot has a safe-integer numeric version other than 1, or SQLite schema admission rejects an unfamiliar version/nonempty unversioned database. Malformed snapshot version values are `unreadable`. |
| `encryption-unavailable` | Protection is unavailable or raises `EncryptionUnavailableError`. The indexed backend checks availability before opening the database, including for reads/removals; collection removal can require encryption to rewrite remaining records. |
| `write-failed` | A replacement failed for another write/encryption reason. |
| `remove-failed` | A removal's replacement or deletion failed for another reason. |

Collection reads never write. Every collection mutation first reads and validates the entire collection;
an unreadable or unsupported collection is preserved, including on removal. It is
never treated as an empty default. A failed replacement leaves the previous
readable ciphertext intact and does not prevent subsequent operations. This
differs from the [paired-server store](paired-server-store.md)'s deliberate
malformed-record overwrite during re-pairing: chat history has no such recovery
exception.

Indexed operations validate only the affected scope(s) in their own family, as
described in [the API](chat-history-api.md#api). Content records, encrypted evidence, scope identity and
schema migration share one SQLite transaction. An insertion/deletion, encryption,
decryption or validation failure rolls back changes and preserves the last committed
snapshot; later operations remain usable. Even reads can commit the schema-1 key
migration, schema-3 receipt-start index and schema-4 authoritative tables, but cannot
commit them if selected validation or full reconstruction fails. Unreadable data and
unsupported schemas are never recreated or overwritten as recovery.

Authoritative replacement and conversation removal fully validate the existing
addressed snapshot; host removal validates all authoritative scopes for that exact
host before deleting any. Their removals affect only `thread_scopes` and cascading
`thread_records`, preserving legacy rows/evidence, lists and other hosts' equal ids.
Every committed replacement receives a fresh UUID, even when identical or empty.
Malformed saved metadata or index associations return `unreadable`, never an empty
default. Validation failures precede mutation; later protection/SQL failures use
`write-failed` or `remove-failed` and preserve the previous committed snapshot.
Unavailable encryption is checked before opening/migrating either indexed family.

New indexed legacy writes encrypt an envelope containing `indexedLegacyRecord: 1`, the
committed `snapshotId` and the complete structural record with its payload. Decode
compares the UUID and kind/order/parent/evidence indexes before record validation.
The original row ciphertext held no row-key/order binding: validating a selected
row's shape alone could accept ciphertext substituted under another structural
identity. The encrypted envelope closes that substitution for new writes.
Original unwrapped records remain readable, using selected codec/index checks for
pages and canonical whole-scope checks for full reads. Reads do not rewrite them.

Authoritative header, item and range envelopes each bind their payload to the
committed UUID and every structural index. The header contains scalar metadata,
item/range counts and arrival-presence only; it contains no item, range or arrival
arrays. Full reconstruction compares canonical records and indexes after shared
snapshot validation. Selected reads compare envelopes and selected associations,
including each item's protected containing-range ordinal, so missing or substituted
evidence is `unreadable` without decoding unrelated history.

Each indexed `payload` is protected by main-process `SecretEncryption` before it
reaches SQLite, including header coverage/cursors, rows, attachment metadata, raw
unknown display text, authoritative scalar/item/range facts and individual evidence
payloads. Production encryption keeps the existing Linux `basic_text` rejection.
No content payload is SQL plaintext,
including in journals or temporary files; `temp_store` is `MEMORY`. The reviewed
unencrypted columns are:

| Location | Columns and allowed values |
| --- | --- |
| `legacy_scopes` | `identity`: locally generated UUID; `server`, `conversation`: UTF-16LE BLOBs of admitted bounded ownership strings, compared byte for byte. |
| `legacy_records` ownership | `scope`: committed-snapshot UUID referencing `legacy_scopes.identity`. |
| Record selection/order | `kind`: `header`, `row`, `served`, `receipt`, `receipt-id`, `display`, `gap`, `gap-key` or `gap-refused`; `ordinal`, `parent`: nonnegative array positions (zero for unparented records). |
| Evidence indexes | `entry_id`, `last_id`, `older_id`, `newer_id`: nonnegative safe integers or null; `row_key`: signed safe integer or null. |
| `thread_scopes` | `identity`: fresh locally generated UUID; `server`, `conversation`: exact UTF-16LE ownership BLOBs, including NUL/lone-surrogate distinctions. |
| `thread_records` ownership/order | `scope`: committed UUID; `kind`: `header`, `item` or `range`; `ordinal`: nonnegative held/range position (zero for header). |
| Authoritative selection indexes | `arrival`: original nonnegative first-arrival position or null; `item_order`: nonnegative safe integer or null; `range_ordinal`: containing saved range position or null; `range_start`, `range_end`: nonnegative safe-integer range bounds or null. Unused indexes are null. |
| Schema/index metadata | `user_version`: integer 4 after successful operation migration (base creation uses 2); indexes, including `legacy_receipt_start` and `thread_ranges`, duplicate only reviewed ownership and structural columns. |

`payload` is a ciphertext BLOB. Timestamps, join strings, opaque cursors, attachment
fields, message text and raw unknown objects never become plaintext lookup/order
columns. Ownership coordinates are intentionally unencrypted structural data, not
filenames or authorization tokens. Authoritative epoch, item id/kind/revision,
unknown JSON and scalar progress/repair/availability remain protected payloads.

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

## Bounded page results

The [authoritative page operations](chat-history-api.md#main-only-bounded-authoritative-pages)
return `{ status: 'page', page: { partial: true, metadata, items, ranges,
arrivalPositions?, continuation } }`. Both newest and before use this result;
neither is a `stored` full snapshot. `arrivalPositions`, when present, align only
with selected items. Ranges retain intact saved bounds and include the newest
boundary anchor, but are only a selected subset. Unordered items add no coverage.
`metadata` retains the saved ownership, epoch, applied version, complete checkpoint,
unfinished version, repair and optional older availability. A null local
continuation means only that no earlier held items remain; short/empty pages and
local exhaustion change none of these daemon facts.

Authoritative malformed/over-limit/wrong-format tokens, cross-owner tokens, stale
UUIDs and invalid boundaries use `invalid-request`, including after deletion or
identical replacement and fresh-instance reopen. Selected payload/header/index
failures use `unreadable`; unavailable protection and unsupported schemas retain
their static codes. Token generation that exceeds the shared encoded-size bound
also fails closed as `unreadable`. Errors expose no content or exception text.
These classifications do not certify unselected records: full read/replacement/
removal still validate the whole affected authoritative scope.

Rejected authoritative continuations leave the transaction through a private
static sentinel before mapping to `invalid-request`. Returning an error normally
inside that transaction would commit an additive migration despite rejecting the
read. Selected failures roll back schema/version changes as well as records.
Diagnostics use `history-storage-operation: thread-page` and
`history-storage-result: page` on success, or the existing static failure code;
they include no coordinates, tokens or payloads.

The [legacy page methods](chat-history-api.md#main-only-bounded-legacy-pages)
return distinct `newest-page` and `before-page` successes, with ordered selected
items/keys, `savedCoverage`, partial evidence and a local continuation or null.
These are page results, never `stored` snapshots. Only newest lookup can return
`missing`; a newest lookup of a saved-empty scope succeeds with empty arrays.
`savedCoverage` remains scope-level evidence; receipt/gap `partial: true` projections and separate
`cursorAnchors` certify no additional daemon coverage. Local exhaustion, short
pages and empty pages do not establish daemon completeness.

Malformed requests, invalid limits and malformed, cross-owner, wrong-format,
invalid-boundary or stale continuations return only
`{ status: 'error', code: 'invalid-request' }`. A before-page scope deleted since
the preceding read is also invalid. Selected decryption, decoding, record/index
association or row/contribution binding failures return `unreadable` without
content. Existing `encryption-unavailable` and `unsupported-version` classifications
remain intact. Unselected payloads are not read or validated by paging, so a
successful page does not certify the entire saved scope as readable. Full reads,
replacement and removal retain their whole-scope validation contract.

Each page and its evidence come from one transaction and committed UUID. Failed
selected reads preserve saved records and roll back any schema migration; they
never repair or discard data. Diagnostics use the existing static storage events:
operation codes `readTimelineNewestPage`/`readTimelineBeforePage` and result code
`stored` on success or a static error code. Requests, coordinates, continuations,
payloads and caught exceptions never enter diagnostics.
