# Protected saved traversal recovery

Status: accepted. Implemented by [#2064](https://github.com/pyrycode/pyrycode-desktop/issues/2064).
Extends [ADR 0014](0014-authenticated-owned-thread-mutations.md).

## Context

Every owned commit rotates protected continuation generation, including metadata-only
saves. Ordinary held-rank continuations must reject after that rotation. Independent
saved traversal lets users load omitted saved content offline or while a server reply
is held, but saves can invalidate its next position at any loaded depth.

Reopening newest and replaying the loaded pages makes recovery work proportional to
depth. Resuming at the boundary's current held rank can miss an unvisited identity
moved across that boundary. A renderer inventory would grow with residency, and
accepting a stale generation would weaken authenticated selection. Removed boundaries
and same-epoch replacement must remain recoverable; epoch/reset/deletion/unpair
are ownership fences, even when coordinate and epoch strings are reused.

## Decision

Mutable held pages with a continuation return a separate opaque `recovery` capability.
The existing saved-host-authorized `beforeThreadPage` request may echo it alongside
that exact continuation. Shared admission detaches and bounds both strings;
`threadHistoryCodec.page` admits the returned capability as residency metadata.
Opening remains a separate shown-window selection and cannot seed held traversal.
No daemon wire-protocol change or additional transport command is introduced.

Main protects the capability with existing OS-backed `SecretEncryption`. It binds
the stable scope owner, SHA-256 epoch digest, digest of the exact decoded continuation
and retained numeric boundary identity. Before rebasing, main validates token shapes,
exact scoped owner/header, epoch and continuation binding. Only a generation mismatch
with a matching capability authorizes new selection. Ordinary stale tokens still
reject; malformed tokens, substituted capabilities and generic failures grant no
recovery authority. Tokens stay opaque, memory-only in renderer and absent from logs.

Recovery selects bounded windows in a circular authenticated identity pass: descend
ids below the boundary, then wrap through those at/above it. The id radix tree proves
selection even when the boundary no longer exists. Verified sequence ranks return
each selected window in current held order, with sparse first-arrival positions and
relevant saved evidence. Identity selection order is private traversal state, separate
from display order and daemon `before_order`. The continuation carries current
generation-bound ring state and a new paired capability. Later invalidation can rebase
a later demand; after writes settle, a complete pass visits every remaining identity.
Overlapping resident facts merge by id/revision with admitted facts winning ties.

Selection, proof validation and token minting share one synchronous transaction under
the existing serialized storage owner. One user demand makes one IPC call and one
selection attempt, selecting at most 200 identities plus relevant range evidence.
Selected payload work is independent of loaded depth and unrelated history;
authenticated lookup and at most 200 sequence-rank proofs have logarithmic structure
work. There is no automatic retry loop. Failure retains displayed valid content and
settles into the existing content-free local failure; explicit Retry starts another
bounded attempt. Repeated input coalesces independently of network state.

Same-epoch replacement preserves the owner and, for indexed scopes, rebuilds the
authenticated indexes in its full replacement transaction. Deferring index rebuild
would charge whole-snapshot conversion to recovery. Initial retained conversion is
still measured separately. Epoch-changing replacement receives a fresh owner, so
returning to an old epoch string cannot revive a capability. Explicit reset,
deletion/recreation and unpair likewise retire ownership. Renderer read tokens,
selection and store generations fence late success and failure after cleanup.

## Rationale

A circular identity pass covers movement across held-order boundaries without an
unbounded visited set or depth replay. Returning selected items in authenticated
held order preserves the existing renderer merge and anchor behavior. Separate
capability authentication preserves strict ordinary generation checks while granting
only bounded current-scope selection. It does not reinterpret an old rank as current.
Keeping index rebuild with replacement places full-snapshot work with the operation
that already owns it, rather than with the next user scroll.

## Consequences

Recovery can revisit resident identities and may need another pass after further
writes. Identity merging prevents duplicate rows, retains compatible higher revisions,
optional-field clears and sparse arrival ties, and keeps newer progress. Retaining
resident rows lets the scroll pin preserve the same surviving row and viewport offset;
removing a saved boundary does not seek newest.

Recovery tokens, residency and exhaustion certify no daemon coverage or completeness,
advance no checkpoint, clear no repair, overwrite no boundary-owned older availability
and acknowledge no read. Hydration emits no owned save or new certificate. Fragmented
saved ranges remain fragmented until the coordinator certifies the hole. Local failure
and pending state remain independent of network state; unknown completeness offline
still needs a connection. No second writer, legacy fallback or renderer database/key
access is introduced.

See the [API contract](../features/chat-history-api.md#bounded-authoritative-opening-and-pages),
[runtime ownership](../features/thread-runtime.md#independent-saved-traversal),
[restart/lifecycle evidence](../features/chat-history-testing-restoration.md#counted-saved-traversal-recovery-validation)
and [selected/structural/native measurements](../features/chat-history-testing-native.md#counted-saved-traversal-recovery-validation).
