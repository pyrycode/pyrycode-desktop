# Retained daemon thread items

`createThreadItemStore` in
[`threadItemStore.ts`](../../../src/renderer/src/store/threadItemStore.ts) retains
decoded daemon facts for sync and cache consumers. Its vanilla Zustand factory has
no production singleton, React hook, transport or subscription. The existing
[conversation timeline holder](conversation-timeline-holder.md) continues to render
rows reconstructed through `reduceTimeline`; these retained items never pass through
that reducer, timestamp matching, receipt reconciliation or roster inference.

The input types are `ThreadItem` and `ThreadUpdate` from `src/shared/wire/thread.ts`;
[main's thread receiver](inbound-message-decode-limits.md#complete-live-thread-validation)
owns wire validation and complete logical-update assembly.

## Identity, placement and full items

Nested Maps scope state by host then conversation; daemon item ids are unique only
inside that conversation's accepted epoch. Equal conversation/item ids on another
host share no state. Changes publish immutable scoped snapshots while untouched
conversations retain reference identity. `snapshot(hostId, conversationId)` returns
`null` when absent, distinct from an accepted epoch with an empty item list.

Items sort by supplied numeric `order` alone. Unordered items stay at the tail;
equal orders and unordered ties keep first-arrival order. Updating an existing id
does not reset its arrival position, but supplying its order moves it to that
position. Hidden items, parents, recorded session/agent/turn attribution and unknown
kind/status/content/fields remain held. `shown` and `active` are independent supplied
facts, never inferred from status. Active items and parents outside loaded ranges
do not establish additional history coverage.

Full live additions and `batch.applyItems(items, version)` use each item's `rev`,
independently of reply arrival time or conversation version. A newer revision
replaces the whole held item, removing omitted optional fields; equal/older
revisions preserve held content. A kind conflict requests repair even when the
incoming revision is older. A delayed reply cannot roll back newer live content,
and receiving an older item cannot regress the held conversation version.

## Exact-base changes, appends and inert JSON

`applyUpdate(hostId, update)` accepts changes/appends only when the item exists,
its held `rev` equals `base_rev`, and the target `rev` increases. Any own `id` or
`kind` entry in `changes` is incompatible, even if its value is unchanged. Changes
replace supplied own fields shallowly: omission preserves the held field, while
empty strings, false, zero and null replace it. `content` replaces its whole value,
including an empty object or null; nested content is never deep-merged.

An append requires kind `user_message` or `assistant_message` and an existing
object `content` with an own string `text`. It appends the suffix while preserving
other content fields; an empty suffix still advances the item revision. Replaying
an append encounters a base mismatch and requests repair without duplicating text.

Missing items, mismatched bases, incompatible updates and kind conflicts return
scoped `repair` results with static reasons `missing`, `base`, `incompatible` or
`kind`. They leave the rejected item/revision, applied version and checkpoint
unchanged while recording repair progress. Other results are `applied`, `ignored`
and `stale`; absent or mismatched epoch ownership is stale. `requireRepair` lets a
caller establish the same fence after a delivery failure.

Inputs are detached with structured cloning and recursively frozen. Own JSON keys
such as `__proto__` and `constructor` survive as inert item/content properties,
without prototype pollution or merging into application state objects. Held items
guarantee id/kind/revision and retain other fields as unknown JSON, allowing explicit
null clears even where the full-item DTO's optional fields require another type.
Optional diagnostics emit only static event/code values, never content or scope ids.

## Snapshots and completed batches

`ThreadSnapshot` is the host/conversation-scoped sync/cache read surface:

| Field | Meaning |
| --- | --- |
| `hostId`, `conversationId`, `epoch` | Accepted ownership of the held facts. |
| `items` | Ordered immutable retained items, including hidden and out-of-range items. |
| `version` | Greatest applied conversation version, including uncertified batch progress. |
| `checkpoint` | Last complete resumable conversation version. |
| `ranges` | Caller-certified loaded order ranges; item presence alone proves no range. |
| `olderAvailable` | Optional availability reading for the oldest certified boundary. |
| `repair` | Missing-progress fence `{ fromVersion, throughVersion }`, or null. |

Versions can skip integers. Newer held facts may accompany an earlier complete
checkpoint; caching them does not certify the intervening progress. Envelope replay
cursors and fragment progress are [separate transport facts](inbound-message-decode-interface.md#complete-live-thread-updates).

`beginBatch(hostId, conversationId, epoch)` returns null without matching ownership.
Its handle has `applyItems`, `commit` and `abandon`. Applying full items can publish
facts and applied version, but never checkpoint, ranges or older availability.
Application is per item: a rejected item does not roll back prior successful items,
but any repair result makes that handle ineligible to commit. Abandonment retains
received facts and leaves complete progress unchanged.

Only the sync coordinator in [#1902](https://github.com/pyrycode/pyrycode-desktop/issues/1902)
certifies a completed server reply. The store consumes client-owned
`ThreadBatchCertificate` fields `fromVersion`, `version`, `ranges` and optional
`olderAvailable`; it cannot prove reply completion itself. `commit` is one-shot,
including a rejected commit. Failed, abandoned, settled or stale handles return
`stale`. Invalid bounds or insufficient repair coverage return scoped repair reason
`coverage` without publishing progress: version/range bounds must be nonnegative
safe integers, starts cannot exceed ends, and `fromVersion` cannot exceed the held
checkpoint. An existing repair interval must be covered in full.

A successful commit preserves held items, monotonically advances version/checkpoint,
unions overlapping certified ranges and clears the covered repair. Disjoint ranges
remain disjoint; held active items and supplied parents cannot widen their paging
boundaries. Older availability follows the oldest supplied certified boundary;
later-boundary replies cannot replace it, and a delayed reply cannot reopen an
exhausted (`false`) reading at the same boundary.

## Repair and unfinished-batch checkpoint fences

Live successes may advance checkpoint only without a repair or outstanding
uncertified batch progress. Repair starts at the held checkpoint and extends through
the greatest missing version; later successful live updates can change held facts
without bypassing that interval. A completed page outside the interval cannot
repair it. Certification must start at or before the repair's lower bound and
reach its upper bound.

Exact item bases alone cannot establish complete conversation progress: a live
append can succeed against an item from an unfinished reply. The slice therefore
also retains a private highest uncommitted batch version. Abandoning that batch does
not remove the fence. A delayed completion advances only to its certified version,
preserving newer held facts; if it falls below pending batch progress, later live
successes remain fenced even after `repair` becomes null.

Equal/older batch revisions must record this pending version even when neither held
content nor applied version changes. For example, checkpoint 100 and missing
progress through 150 can coexist with live facts at version 300. An ignored,
abandoned batch at 250 still prevents a repair certificate through 200 followed by
a live success at 400 from moving checkpoint beyond 200. A completed certificate
covering 250 releases that fence; a subsequent live success can resume progress.
A content-only no-op check would lose this obligation and falsely certify recovery.

## Epochs and cleanup ownership

`acceptEpoch(hostId, conversationId, epoch)` explicitly establishes ownership;
updates cannot choose a new epoch. Reaccepting the same epoch is idempotent. A new
epoch resets only that conversation's items, version/checkpoint, ranges, older
availability, repair and private pending progress, and creates a new generation.

Batch handles capture a process-local generation symbol rather than trusting epoch
text alone. Replacement invalidates earlier handles even if the old epoch string
is later reused. The cleanup APIs release every corresponding slice, including
off-screen conversations:

- `deleteConversation(hostId, conversationId)` removes one conversation.
- `removeHost(hostId)` removes all that host's conversations.
- `clearAll()` clears pairing-wide state.

Cleared scopes read absent and repeated cleanup is a no-op. Other hosts/conversations
keep their held references. Old batch application/commit cannot recreate a cleared
scope, including after the same host/conversation/epoch is accepted again.

Requests, recovery and reply certification remain with #1902; disk persistence with
[#1903](https://github.com/pyrycode/pyrycode-desktop/issues/1903); lifecycle subscriptions,
consumer migration and production capability activation with
[#1908](https://github.com/pyrycode/pyrycode-desktop/issues/1908). These APIs alone claim
no production daemon integration or live-Claude validation.

## Testing

[`threadItemStore.test.ts`](../../../src/renderer/src/store/threadItemStore.test.ts)
uses supplied complete-item and certificate fixtures without Electron, a daemon or
Claude. It covers revision races, replayed/empty appends, atomic replacement presence,
inert JSON, repair/unfinished-batch fencing, certified boundaries and generation reuse
after each cleanup operation.

The [verifier's re-review](https://github.com/pyrycode/pyrycode-desktop/pull/1920#issuecomment-6099461564)
on 2026-10-10 records 2 executed, 2 passed, 0 failed and 32 skipped by its name filter.
Both `retains uncertified progress from equal batch revisions during repair` and
`retains uncertified progress from older batch revisions during repair` were present
and passed. This counted evidence covers those two permanent checkpoint regressions.
