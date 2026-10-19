# Authenticated owned thread mutations

Status: accepted. Implemented by [#2044](https://github.com/pyrycode/pyrycode-desktop/issues/2044).
Extended by [#2088](https://github.com/pyrycode/pyrycode-desktop/issues/2088) for independent split-save persistence.
Extends [ADR 0013](0013-stable-protected-thread-bindings.md).

## Context

Stable item ciphertext alone does not bound save work. Schema 6 still decoded the
whole saved thread and rewrote generation-bound placements/ranges for each complete
replacement. A renderer holding only part of a thread could erase unloaded history
by submitting its held snapshot. Keeping placement generations unchanged would
permit stale page continuations; dropping generation binding without another proof
would permit old protected record replay.

Progress ownership also exceeds a holder's current scalar metadata. A completed
interval can precede newer live facts or unfinished work. Combining a certification
boolean with the latest checkpoint falsely certifies that later progress. A recreated
holder cannot compare availability against older unloaded exhaustion evidence.

## Decision

Ordinary saves use `mutateThread` through the existing typed bridge, saved-host
handler, serialized application store and yielding atomic database transaction. Shared
admission detaches changed complete items, explicit removals, new ranges, exact
coordinates/epoch, epoch/reset intent and ordered progress observations. Restoration
publishes no owned change. Omission and memory-only holder loss grant no deletion
or reset authority; full replacement/import remain supported for retained callers.

Schema 7 adds `thread_auth(scope, tree, path, payload)`. Mutable headers protect
current roots, counts, stable ordinal/arrival allocators, aggregate item JSON-node
count, reset identity and oldest availability boundary. The indexes are:

- Fixed-width radix trees for item ids, numeric order plus stable first arrival,
  and normalized range starts.
- An authenticated AVL sequence for held order, keyed by stable placement ordinal
  and carrying subtree counts/heights. Ordinals identify records independently of
  display rank. Rotations rewrite index nodes, preserving untouched placements.
- Parent rows used only as rank hints. Rank first collects the hinted route, then
  verifies every root-to-node reference and count against the protected root.

SHA-256 binds each index address and canonical node text, including child hashes,
counts and leaf facts. Leaves bind exact protected placement/range ciphertext;
placements bind id/revision and exact item ciphertext digest. Item envelopes retain
stable owner/epoch/id/revision binding. Plaintext index paths, hashes and structural
facts confer no authority without the protected roots and verified record envelopes.
OS `SecretEncryption` remains the confidentiality boundary; this adds no cipher or
credential. Replayed placements, ranges or branches fail against current roots.
Complete rollback of all protected disk records remains outside the guarantee.

Mutation authenticates only changed items and necessary metadata/evidence paths.
New/order-changing items locate saved neighbors through numeric-order/arrival lookup,
including unloaded neighbors. Higher revisions win; revisions retain first arrival,
and removals leave gaps. Range changes update authenticated evidence without rewriting
unaffected placements. Path updates accumulate inside the transaction and flush once
per path before the protected header commits. Changed records, roots and header
commit atomically. Continuation generation rotates independently on every mutation,
including metadata-only work, invalidating old tokens without rewriting untouched
placements/ranges.

The first owned operation creates schema 7 transactionally. Each addressed retained
scope is fully decoded and validated before conversion; exact item payload bytes,
supplied held order and arrival order survive. Placements/ranges are rebound once
from generation to stable owner and authenticated by current roots. Other scopes
retain their full/page representation. Earlier schema migrations still chain through
schema 6. Existing fractional-index scopes convert once to the AVL sequence after
full validation, retaining placement ciphertext. Conversion, version marker and
requested operation roll back together on failure.

Incremental admission maintains the protected aggregate item JSON-node count by
subtracting only removed/revised old items and adding changed items. Overflow of
the shared 100,000-node limit rejects the transaction. Per-request admission alone
could commit individually valid additions whose combined history is unreadable by
retained full/page readers. Full reads reconstruct and validate complete snapshots;
pages traverse authenticated rank counts and range predecessor proofs, returning
selected containing ranges plus the newest anchor. Both readers support retained
and mutable scopes. No renderer page IPC is introduced.

Progress observations retain exact completion `{ fromVersion, version }` and optional
certified availability `{ start, available }` through bounded coalescing and exact request retry.
Main folds observations in order: completion must start at/below the saved checkpoint,
and fenced advancement stops at its certified version. Uncovered saved/pending repair
and unfinished work survive. Older availability boundaries win; exhaustion wins at
an equal boundary. Later-boundary or metadata-only readings cannot erase older
exhaustion. New epochs start from empty progress. Already-covered repair replay is
ignored, while a new obligation raised at the current checkpoint remains valid.

An explicit daemon reset generates a unique `resetId`, even in the same epoch.
It supersedes earlier pending ownership. Main records the last applied reset;
retrying that identity after a lost acknowledgement cannot erase subsequently saved
facts. Independent handler host/conversation generations still fence admitted work
after deletion/unpair, and durable import completion prevents retained-source replay.
Matching host/conversation/epoch/reset strings are not authorization.

A finite writer backlog is an ordered linked queue with at most 32 units per
capture/coalescing/submission: items, removals, ranges and ordered progress, including
the final observation. Capture retains immutable changes; only an unstarted tail of
distinct items/metadata may combine within that bound. Owner/reset barriers,
removals, ranges and repeated identities stay serial. Split requests submit data
before original ordered progress; neutral prefixes confer no completion authority.
Each request passes shared and independent main admission, and main reuses the
existing 16-unit yielding transaction generator. See the
[exact writer contract](../features/chat-history-api.md#owned-authoritative-mutations).

Split saves carry internal `persistence: { id, part, parts }`, independent of daemon
progress. A protected header pending marker and stable persistence owner bind the
UUID, next ordered part and total to the exact host/conversation/epoch/reset
lifecycle. Schema 8's indexed `history_save_parts` journal retains encrypted owner
bindings and accepted request digests, without item content. First prefix, obligation
and receipt commit atomically; each next part and receipt do too. Only the matching
expected last part clears its obligation. Wrong sequence/total, changed replay and
unrelated mutations fail without altering pending content. Exact accepted replays,
including a lost final acknowledgement during a newer save, succeed without folding
progress again or clearing that newer obligation.

Public full/opening/newest/before reads return `unreadable` while a save is pending,
even after fresh-owner reopen; the committed prefix stays on disk. Exact retry
finishes it. Authorized epoch/reset supersession, full replacement and deletion can
retire it; internal validation may inspect pending content. Same-epoch replacement
rotates persistence ownership. Receipts remain after completion and scope deletion
to reject stale parts against reused coordinates. A local UUID grants no host,
reset or daemon-completion authority. No completion certificate, repair or unfinished
version is synthesized, and completing persistence alone clears no daemon fence.
Older executables reject schema 8; snapshot version 1 and daemon wire stay unchanged.

## Rationale

Dense ordinals require unrelated placement rewrites. Fractional hexadecimal positions
initially appeared bounded in replacement-seeded tests, but successive production
appends lengthened paths with history size. AVL balancing bounds sequence mutation
and page traversal; fixed-width radix lookup avoids dependence on held subset size.
A whole-thread protected manifest would require full decoding for each mutation.
A plaintext sequence or trusted parent hint could select substituted records without
a valid proof from the current root.

## Consequences

Ordinary one-item payload validation, serialization and protection stay constant;
sequence/index work is logarithmic, evidence work follows changed ranges, and progress
folding follows received observations. One-time conversion and retained full operations
remain proportional to saved history. Fresh-owner regression fixtures cover successive
additions, unchanged placement bytes, movement/removal, replay, aggregate overflow,
conversion/commit rollback, subset saves, reset retries and ordered progress folding.
See [testing and counted Linux evidence](../features/chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation).

A neutral prefix cannot lower a saved checkpoint that already covers the incoming
version. Without an independent obligation, interruption could expose a completed
31-item prefix of a 100-item save at checkpoint 100. Covered-checkpoint regressions
therefore exercise incoming versions 100 and 50 with/without completion, every public
read path and exact retry. Retained receipts cost persistent space deliberately:
discarding acknowledged identities would lose stale-replay rejection after scope reuse.

Failed writer work retains its exact request/cursor until a later explicit flush or
received-event retry; acknowledgement alone advances the current queue. There is
no self-retry loop. Between submissions a one-shot MessageChannel closes both ports
before resuming, preserving real task yields with frozen renderer timers. Timer-based
yields can suspend shutdown; independent posted-task assertions prove the boundary.
Deletion/unpair suppression and graceful shutdown remain ordered. Stop unsubscribes,
waits for host-removal settlement and drains with the same bounded, finite retry
policy; repeated failure leaves the obligation protected, never falsely completed.
Protection fails closed in main, diagnostics use static classifications,
and the renderer gains no SQL, filesystem, key or ciphertext access. Partial
restoration and traversal use the authorized partial-page bridge;
[ADR 0015](0015-protected-saved-traversal-recovery.md) extends generation-bound
continuations with a separate authenticated bounded-recovery capability.
