# Conversation last-read store

The local item-count store, persistence codec, singleton, selectors and pairing/
server cleanup were deleted in #2030 after navigation stamping retired in #2028.
`conversationLastReadStore.ts` and its exclusive tests no longer exist. Current
read state uses received host-qualified shown/read watermarks.

## What it does

The surviving `conversationLastReadBridge.ts` wrapper mounts only
`useReadPublication` in `PairedShell`. Removing that wrapper would silently remove
authoritative publication too. Opening, switching, receiving content and sending
messages create no local-count read evidence.

## How it works

[`conversationReadPublisher.ts`](../../../src/renderer/src/store/conversationReadPublisher.ts)
retains `readTargetFor(inputs)`, authoritative `useReadObservation` and
`createReadPublisher`. The old row-key/display-receipt branch and legacy DOM
observer are deleted. Eligibility requires an authoritative epoch and received
shown watermark; `latest_entry_id` cannot substitute for missing metadata.

Observation pairs a committed immutable snapshot with received owning summary
and certified newest/catch-up completion. Checkpoint, coverage, unfinished/repair,
visibility, focus, reader and actual source-row geometry fences remain. A newer
summary received before React commits cannot upgrade an old observation. See the
[full read contract](conversation-shell.md#authoritative-thread-read-publication).

Read-target, observer-setup and observer diagnostics are best-effort. Missing
transport or exceptions from an injected sink, bridge lookup or send cannot change
eligibility, observer lifetime, geometry, publication or deduplication. The catch
surrounds diagnostic emission only; domain evaluation and publication retain
their existing behavior. A throwing `reused` diagnostic must still allow the
retained callback to observe and publish an eligible target exactly once.

These producers emit only static client-owned `event` and `code` fields through
`window.pyry.sendDiagnostic`, retaining the unchanged receiver projection and the
logger's normal `seq`/`ts` stamps. They emit no host, conversation, epoch, item or
request identities, content, DOM text or raw errors. See the
[event/reason reference](conversation-shell.md#read-observation-diagnostics).

The publisher coalesces evidenced targets by host/conversation/epoch. Sending is
an attempt; only received `read_up_to` reaching the target confirms it. A lower
clamp or send failure leaves it pending. Each reconnect permits one retry of the
already evidenced target, even while blurred; a higher target requires new
committed visible content. Epoch replacement, deletion, owner loss, missing
metadata and teardown retain their authority and listener cleanup fences. Main
still independently refuses ambiguous connected-owner routing.

## Configuration and usage

`useConversationLastRead()` remains the shell-lifetime publication wrapper.
`ThreadItemsTimeline` supplies authoritative read inputs for committed observation.
There is no count store import, hydration or `recordLastRead`/clear API. The former
`pyry.conversationLastRead` key is no longer read or written by this machinery;
renderer retirement introduces no storage migration.

## Testing

Publisher units retain retry, acknowledgement and ownership cases with explicit
authoritative epochs and shown watermarks. Both committed-visible-read widths in
`e2e/thread-items.spec.ts` are present and passed in the
[counted Linux retirement gate](thread-runtime.md#renderer-producer-retirement-validation):
435 executed/passed, 0 failed, 3 skipped overall; all 12 thread-items cases passed.
The retired ID-less receipt browser case and local-count tests were removed with
their producer, while the authoritative observer and publisher coverage remain.

## Edge cases and limitations

A successful send or renderer attempt count proves neither wire delivery nor read
acknowledgement. Pending publication survives navigation only while its owning
route epoch remains valid; another host cannot inherit it. Missing snapshot,
completion or received metadata supplies no observation and activates no fallback.

## Related decisions

- [Unread predicate](conversation-unread.md) — received shown/read comparison only.
- [Thread runtime](thread-runtime.md) — exact send settlement, restore and removal ownership.
- [Mounted read evidence](development-verification.md#authoritative-thread-read-evidence) — processing/commit barriers and wire versus acknowledgement proof.
- [Historical local-count implementation](../codebase/775.md) — frozen record of the retired store.
