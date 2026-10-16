# Stable protected thread bindings

Status: accepted. Implemented by [#2043](https://github.com/pyrycode/pyrycode-desktop/issues/2043).

## Context

Authoritative saved history originally encrypted each item with its held ordinal,
range association and replacement UUID. That same UUID invalidated page tokens.
Changing placement or evidence therefore required replacing item ciphertext,
preventing future owned writes from retaining unloaded rows independently.
Existing complete reads/imports and bounded main-only pages must share the new
layout without weakening protected associations or snapshot admission.

## Decision

Schema 6 separates stable payload ownership from mutable placement and continuation
identity. `thread_scopes.identity` remains stable across full replacements.
`thread_payloads(scope, item_id)` provides durable lookup, with numeric revision
and encrypted `{ scope, epoch, id, rev, value }`. The protected item contains no
held ordinal, range index or generation.

`thread_records` retains protected header, item-placement and range records.
Headers bind the stable owner and exact coordinates and carry a protected
generation UUID. Placements/ranges bind that generation and all their structural
indexes. Each placement holds id/revision and SHA-256 of the exact item ciphertext;
decoding verifies the digest, lookup revision and protected owner/epoch/id/revision
before admitting content. The digest is an association check; existing main-only
OS protection remains the confidentiality boundary.

Every full replacement rotates generation, including identical and empty content.
Unchanged items in the same epoch reuse exact ciphertext; changed items/epochs
receive new payloads. Removal cascades through both tables, and recreation gets
a new owner and generation. Tokens retain their compact format with generation
as `identity`.

The first authoritative operation on schema 5 validates every authoritative scope
using the old decoder and full admission, converts records and commits version 6
within the existing synchronous transaction. Each old owner becomes its initial
generation, preserving continuations through migration and fresh reopen. Earlier
supported schema chains still reach schema 5. Failed conversion or subsequent
operation rolls back together, allowing retry.

## Rationale

Stable ownership alone is insufficient: an older protected placement or range
could be replayed under the retained owner. Current-generation binding rejects
that replay while leaving payload ciphertext reusable. A plaintext index alone
cannot establish identity or evidence membership; protected placement facts and
the ciphertext digest must agree with the direct lookup.

Reusing existing placement/evidence records keeps bounded selection intact.
A single protected manifest would require whole-history decoding for each page.
After the one-time conversion, pages select only their header, held window,
referenced payloads and relevant ranges, including the newest-range anchor.

## Consequences

Full reads/replacements/imports immediately use the new format and retain complete
snapshot validation, cleanup and outer-transaction rollback contracts. Full reads
also reject orphan payloads; a bounded page validates only selected associations.
Replacement still validates/serializes a complete snapshot and rewrites placements
and ranges, so ciphertext retention is not an incremental-save performance promise.

Protection fails closed and stays in main; no renderer SQL/filesystem/key/ciphertext
capability or page IPC is added. Complete rollback of all protected disk state
remains outside the storage guarantees. Owned writes remain #2044 and partial
restoration/navigation remain #2041/#2042.

See [API and migration](../features/chat-history-api.md#api),
[regression fixtures](../features/chat-history-testing.md#stable-protected-authoritative-storage-and-pages)
and [OS protection](0005-secret-at-rest-safestorage-fail-closed.md).
