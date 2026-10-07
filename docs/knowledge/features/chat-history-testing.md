# Protected local chat history — testing

Verification reference for [protected local chat history](chat-history.md).
Received ownership and storage behavior are defined in the parent overview.

## Demand and snapshot contracts

[`historyDemand.test.ts`](../../../src/renderer/src/store/historyDemand.test.ts)
checks unknown/restored/complete coverage, discarded pending demand, failure retry
from the retained cursor and host isolation. Main connection tests cover abandoned
requests and late replies. [`history-on-open.spec.ts`](../../../e2e/history-on-open.spec.ts)
now tests explicit demand: its main IPC observer is installed before pairing and
activation, so zero commands cannot be confused with commands discarded by host
routing. Genuine wheel/keyboard input is compared with composer navigation,
synthetic events and programmatic movement, including empty/short threads and
reconnect. An empty page needs a later received live frame as a receipt barrier;
row count alone cannot prove that the empty response has settled.

[`chatHistory.test.ts`](../../../src/shared/chatHistory.test.ts) checks row shapes, projection,
detached inputs, limits and coordinates. Read-ID cases round-trip zero/safe maximum, restore older
omitted fields and reject invalid values. Attribution cases round-trip parented/older parentless
rows and reject malformed parents; `toolGroups.test.tsx` checks restored grouping.
[`chatHistoryStore.test.ts`](../../../src/main/chatHistoryStore.test.ts) uses real
temporary files with injected reversible encryption to cover fresh-instance
reads, empty-versus-missing records, host separation, retained unlisted timelines,
held overlapping writes/removals and preservation after read/write/delete failures.
These tests exercise the storage seams without proving the OS keychain adapter.
[`chatHistoryHandler.test.ts`](../../../src/main/chatHistoryHandler.test.ts)
covers membership, rejected requests before record access, ordering and contained
failures for all six operations.

## Recording and removal

[`chatHistoryWriter.test.ts`](../../../src/renderer/src/store/chatHistoryWriter.test.ts)
injects stores, receipt context, scheduling and storage to prove coalescing,
return-to-saved-value suppression, newest-during-write retention, failure recovery,
successful coverage, attribution refusal and capture before eleven-chat eviction.
Equal-id cases alternate stamped hosts before and after buffered writes flush,
checking distinct text, turn completion and coverage without crossover. Explicit
saved restoration followed by a same-host receipt must keep recording even when
both lists claim the id. Separate refusal cases retain unknown/directly installed
rows through a later stamp and reject missing origins and ambiguous local echoes;
a store-cleared host replacement must not be treated as retained contamination.
Cancellation regressions must include later live content and retained coverage;
checking only echo addition or its immediate removal misses a writer that has
silently stopped recording the held chat.

Removal regressions hold membership checks and protected writes, then use fresh
storage instances to verify absent lists and omitted timelines, stale admission
rejection, other-host preservation and fresh saves after re-pairing. Writer tests
also hold removal through shutdown for both outcomes.
[`chat-history-removal.test.ts`](../../../e2e/chat-history-removal.test.ts) combines
receipt-stamped holders, the real scoped-clear selector and protected storage.
Its same-session re-pair must save only fresh text for an omitted timeline. Manually
clearing all timelines or restarting before re-pairing masks the retained-slice bug.
The recording Playwright scenario re-pairs before restart, then checks persistence
after restart and no added history downloads.

Conversation-deletion regressions hold real protected-store list and timeline writes,
deliver confirmation with buffered and later stale captures, and await flush/stop
before fresh-instance reads. They check both removed records, same-host peers and
another host's equal id. Empty/partial lists and eviction must retain timelines;
failed cleanup must preserve content without a success diagnostic. The recording
Playwright test holds confirmation after the delete command, proves retention, then
waits for the actual `removeConversation` result to be `ok` before asserting absence
and restarting. Renderer disappearance or an early missing read cannot prove cleanup
or ordering; the scenario withholds list refresh responses throughout deletion. Its two
`__conversationRemovals` counter reads go through the shared `readMainProcess` helper, bounded at
five seconds, so a transient loss of Electron's inspection context does not redden the scenario (see
[E2E test harness § Tolerating a transient inspection-context loss on
reads](e2e-harness.md#tolerating-a-transient-inspection-context-loss-on-reads)); the counting
wrapper's own install stays a single un-retried call.

## Restoration

[`savedTimelineRestorer.test.ts`](../../../src/renderer/src/store/savedTimelineRestorer.test.ts)
covers explicit admission, row identity metadata and coverage, equal-id host
isolation, delayed success/failure after invalidation, and eleven-chat eviction
and reload. Echo regressions cover same-host reopening, cross-host replacement and
rejection of a delayed read after sending. Writer tests pair restoration with a
subsequent same-host receipt:
restoration and eviction must write nothing, but later content must save with the
restored owner and coverage. Static screen tests cover local notices, host-bound
display and partial-row cursor suppression both connected and offline, normal rendering
after live receipts, and held versus restored queue visibility. Healthy-host interaction
tests assert no `.conversation__banner` at all, so they still reject an additional
connection warning caused by another host's failure.
`beginLocalTimelineRead(host, id)!.complete(null)` is the shortest way to stage a
settled-empty local read in a static screen test: it parses a synthesized empty
snapshot and settles `localRead: 'loaded'` with no items, which is otherwise awkward
to reach through the store's public surface. Removing a piece of rendered copy
silently deletes every `not.toContain`/absence assertion aimed at it too — those
assertions keep passing against a screen that renders nothing at all, so a copy
removal needs a sweep for such assertions and a flip to a positive claim about what
does render (\#1447).

[`savedListRestorer.test.ts`](../../../src/renderer/src/store/savedListRestorer.test.ts)
covers ordered host isolation with equal ids, missing/empty/error results, duplicate
admission and delayed success/failure after received lists, clears and cancellation.
It runs the real writer alongside restoration: installing and clearing local lists
must schedule no save, while a later received list must still record.

[`received-read-marks.spec.ts`](../../../e2e/received-read-marks.spec.ts) separates immediate mounted
dot/badge clearing from persistence: after host A's push, saved host marks remain the received
list values `[0, 2]`. A store update alone cannot prove a saved mark. See
[counted verifier evidence](development-verification.md#what-each-test-tier-proves).

## Browser persistence and lifecycle

[`message-reply.spec.ts`](../../../e2e/message-reply.spec.ts)'s enabled
`received history is saved for equal ids on different hosts and replies reopen offline`
uses two hosts advertising `seed-conversation` with distinct assistant replies.
It polls each protected `readTimeline` result, visits the second chat, disconnects
the first host, then reopens its saved chat offline and quotes only its original
reply into that host's draft. Both saved timelines remain independent afterward.
Draft isolation and ordinary saved/offline reply tests remain enabled: either
could pass while received persistence is broken, so neither substitutes for this
regression. See [counted fake-transport evidence](development-verification.md#equal-id-received-history).

[`chat-history-recording.spec.ts`](../../../e2e/chat-history-recording.spec.ts)
exercises the mounted production observer and handler, real composer cancellation,
quit/relaunch and window close/reopen. It freezes renderer timers after earlier
saves, verifies the final content is still absent on disk, then closes: a test
that waits for the debounce before quitting cannot prove the flush. Reusing the
user-data directory proves disconnected local reads without a new handshake,
including the last list, partial live text and loaded older page. The suite also
covers pairing-rejected access, saved-host validation and zero added history
requests. It also proves restored sidebar browsing after normal quit/relaunch,
a rejected host beside a usable connected host, and mounted local read failures.
The pairing-recovery regression must expect the saved row after startup rejection;
row absence no longer proves rejection. Keep the decoded rejection and actual
repair-click assertions. Restored message UI is exercised by opening and copying
received content after restart, including a rejected host beside a connected one.
A held-IPC result crosses repair opening/cancellation before release, then proves
reading and copying without renderer commands during opening or scrolling. Command
observation must precede main's host routing: absent socket traffic can hide a
renderer command discarded offline. In the held-IPC scenario, observing
`pyry:command` at main avoids CDP function-breakpoint observation stalling the test.
Reload fixtures wait for saved-list persistence and use a newly named received row
as their receipt barrier; saved rows can return without a status replay, so row
count alone is not that barrier. The test encryption backend does not prove the OS
keychain adapter.

## History continuity and overlap

The continuity scenario starts with incomplete saved coverage, restarts offline,
reads, reconnects and receives new same-host text, then demands one older page with
the saved cursor. A connected restart checks ordered older/restored/new content and
the advanced coverage, with no duplicate rows on reopening. Holding the local read
and observing commands before host routing proves opening, pending demand, settlement
and reconnect send zero history requests; only fresh qualifying input requests a page.
Overlap fixtures must place the live overlap at the newest end of the newest-first
page. Putting an unmatched older entry first exercises the intentional
stop-at-first-unmatched rule in `withoutLiveEntries`, producing a duplicate instead
of testing overlap suppression. A `messageReceived` entry is the one exception to
that stop rule (#1437): the daemon never pushes a live frame for the operator's own
message, so that entry no longer ends the walk — it is kept and stepped over, and an
unmatched entry beneath it still stops the walk as before. A fixture placing the
operator's own message at the newest end therefore does not, by itself, exercise
stop-at-first-unmatched; put the unmatched entry there instead.

A unit test's comment can cite an e2e spec as corroboration for a stop-rule assertion
that the spec never actually reaches. `e2e/real-daemon-history-on-open.spec.ts`
archives before re-opening, so its page always joins against an empty live key set
and `withoutLiveEntries` returns on the `liveKeys.size === 0` early exit before the
walk runs at all — it was never evidence about the walk's stop rule, and the #1437
fix (above) inverted the unit assertion that comment was defending. Check that a
cited spec's fixture actually drives the code path the comment claims, rather than
trusting the citation.

## Durable type contract

The exact `DurableThreadItem`/`ThreadItem` equality assertion lives in
[`store/chatHistoryContract.test.ts`](../../../src/renderer/src/store/chatHistoryContract.test.ts).
A shared test importing renderer types crosses the composite Node project's file
boundary; the renderer test project can see both contracts without changing
production layering. Exact equality catches added optional fields that mutual
assignability can miss. This proof depends on the web project's TypeScript check
in `npm run build`; running Vitest alone does not establish it. Runtime parser
fixtures still need to cover newly added fields.

**The guard compares against `ThreadItem` minus a named exclusion, not against
`ThreadItem` itself, since [#1565](https://github.com/pyrycode/pyrycode-desktop/issues/1565).**
`turnBoundary`'s six `TurnEndMetrics` fields are deliberately
[live-only](chat-history.md#snapshot-contract), so the old
`expectTypeOf<DurableThreadItem>().toEqualTypeOf<ThreadItem>()` no longer typechecks once they
exist on `ThreadItem`. A local `PersistedThreadItem` type omits `keyof TurnEndMetrics` from the
`turnBoundary` arm and leaves every other arm untouched, and the assertion compares against that
instead. The fix for a live-only field belongs here, narrowing the guard's comparison type —
never widening `DurableThreadItem` to carry a field the persistence layer must keep stripping.
