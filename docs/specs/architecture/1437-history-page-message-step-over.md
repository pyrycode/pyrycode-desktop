# #1437 — a page asked for after the operator's own message draws the reply twice

## Files read

- `src/renderer/src/store/historyPageBridge.ts` → `withoutLiveEntries` — the whole change; its ⭐ paragraph
  names the operator's own `message` among the entries that end the run, and that sentence is the bug.
- `src/renderer/src/store/historyPageBridge.ts` → `reduceHistoryPage` — the only caller. Its ROWS ONLY
  paragraph is what makes the scalars a `userText` fold writes structurally unable to escape the page.
- `src/renderer/src/store/timelineBridge.ts` → `joinKeyFor`, `liveJoinKeyFor` — the key composer and the
  emit-side reason a `messageReceived` entry can never carry a live key.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`, its `messageReceived` arm — maps a
  stored `message` with `role: 'user'` to a `userText` row, and `role: 'assistant'` to `null`.
- `src/renderer/src/store/threadTimeline.ts` → `reduceTimeline`, its `userText` arm — a fresh tail-append
  that reads no prior item; and the `latestTurnEnd` / `stoppingBanner` scalars a `userText` event does
  touch, both of which `reduceHistoryPage` discards.
- `src/renderer/src/store/conversationTimelineStore.ts` → `withoutHeldEchoes` — the second owner, which
  removes the page's copy of the operator's row by `messageId`. It stays the only owner of that decision.
- `src/shared/ipc/events.ts` → `HistoryTimelineEntry`, `HistoryTimelineEvent` — the decoded page entry;
  `event.type` is a client-owned discriminant narrowed main-side, only `ts` is remote.
- `src/renderer/src/store/historyPageBridge.test.ts` → the `withoutLiveEntries` describe block — where the
  new tests go, and where the AC5 test's expectation inverts.
- `docs/knowledge/features/conversation-timeline-store-internals.md` § "The history/live join (#1225)" —
  the fail-open posture the whole join is built on, and the reason a live key exists only where the live
  fold actually changed what the operator sees.

## Design source

**Figma:** N/A — the ticket's `## Figma` section states that no node draws a duplicate; the
[Chat Screen](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4) frame
draws one bubble per reply and one row per tool call, and this ticket adds no visuals. Nothing drawn
changes: the fix only stops rows from drawing that should never have drawn.

## Change

`withoutLiveEntries` keeps its signature and its fail-open posture; only the walk's stop rule changes. Today
the walk ends at the first entry whose key is undefined, ambiguous within the page, or absent from the live
set, and a `messageReceived` entry always fails the last of those — the daemon pushes no `message` frame on
the interactive lane, so `liveJoinKeyFor` mints nothing for that arm and no live key of that type can exist.
A page whose newest entry is the operator's own message therefore suppresses nothing, and the whole page —
the reply already on screen and its tool rows — draws a second time at the head.

The new rule, walking newest-first:

- A `messageReceived` entry is **kept and stepped over**: it does not end the run.
- Any other entry is dropped while its key is defined, occurs exactly once among the page's entries, and is
  held live — the three conditions unchanged.
- The first other entry that fails any of those ends the run; it and everything older are kept.
- The same array reference is returned when nothing was dropped, as now.

The survivors are no longer a suffix of the page, so the result is built as an order-preserving filter
rather than a `slice`. The counting pass over the page's keys is untouched.

**Why the survivors still fold correctly.** The run sits at the page's newest end, so after the change the
survivors are a chronological **prefix** (the stop entry and everything older) plus the **message entries
from inside the run**, which are chronologically newer than the stop entry and therefore fold last. The
prefix folds against exactly the state it would have seen inside the whole page, unchanged from #1225's
argument. The trailing message rows are independent of it in both directions: `translateTimelineEvent` maps
a message to a `userText` row, `reduceTimeline`'s `userText` arm is a fresh tail-append that reads no
existing item, and no `toolUse`, `toolResult`, `assistantDelta` or `turnEnd` arm reads a `userText` row. The
three pieces of state a `userText` event does touch — `localSendPending`, `stoppingBanner` and
`latestTurnEnd` — are scalars, and `reduceHistoryPage` folds against a scratch state and returns only
`items`, so none of them can escape the page. Neither of the two losses #1225's ⭐ paragraph refuses is
reachable: an orphaned `toolResult` needs a dropped `toolUse`, and a turn read backwards needs a surviving
older delta beneath a dropped newer one; both require a non-message entry to be stepped over, and none is.

**The whole type is safe, not just the `role: 'user'` case.** The daemon's only producer of a `message` log
entry is the operator-message write. A `role: 'assistant'` entry — the shape a hostile daemon would have to
plant — folds to `null` and draws nothing, so stepping over it changes no row.

**No held-echo input.** The walk learns nothing about `messageId`. `withoutHeldEchoes` in
`prependHistoryFor` already decides about operator rows by message id, and that decision keeps one owner:
the message row this walk now lets through is the one it removes. An operator message with no held echo —
one sent from another client — survives both and draws as a user row.

**Out of scope.** `sessionTransition` also ends the run and stays as it is, for a different reason:
`joinKeyToRecord` declines a key whose conversation was inferred rather than asserted, so its live twin may
have drawn without recording anything. #1192's second deliverable is what changes that.

## Testing strategy

Three vitest cases in the `withoutLiveEntries` describe block of `historyPageBridge.test.ts`, plus the
inversion of the existing AC5 case. All pure over the two inputs — no store, no DOM, nothing to click, which
is what `environment: 'node'` allows here.

- **The report's scenario (AC1).** A page of `[message(newest), turnEnd, toolResult, toolUse, delta]` with
  live keys for all four non-message entries folds to the message entry alone. Asserted on
  `withoutLiveEntries`, and once more through `reduceHistoryPage` to show the rows it yields are a single
  `userText` — the row `withoutHeldEchoes` then removes.
- **The stop rule for a non-message entry is unchanged (AC4).** A page whose newest entry is an unheld
  `turnEnd` above a held delta returns the same reference, as today.
- **An operator message with no held echo still draws (AC3).** The message survives, and an older entry the
  live lane did not key survives with it.
- **AC5 inverts.** `historyPageBridge.test.ts`'s "never suppresses the operator's own message row" case
  keeps its name and its `own` survivor, but the `drawn` entry beneath it — held live, previously saved by
  the message ending the walk — is now expected to be dropped, and its comment stops resting on the old
  stop rule. Its closing citation of `e2e/real-daemon-history-on-open.spec.ts` goes with it: that spec
  archives before re-opening, so its page joins against an empty live key set and `withoutLiveEntries`
  returns early on `liveKeys.size === 0` — it never reaches the walk, so it cannot be evidence about it.

No e2e is needed: the pure function carries the whole change, and no spec's fixture drives a page against a
non-empty live key set.

## Open questions

None. The one thing worth confirming during implementation — that `reduceTimeline`'s `userText` arm writes
no state a later survivor reads — was settled while reading it, and is recorded in the Change section above.

## Documentation handoff

Pending, owned by the documentation stage. Both edits are carried verbatim from the ticket:

- `docs/knowledge/features/conversation-timeline-store-internals.md` — under `## The history/live join
  (#1225)`, the page-half description and the `### Error handling — every row fails open` table both state
  that the operator's own message ends the run. Record the step-over instead.
- `docs/knowledge/features/chat-history.md` — the overlap-fixture paragraph beginning "Overlap fixtures must
  place the live overlap at the newest end" should say a `messageReceived` entry no longer ends the walk.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and one design decision worth recording because the tempting broader
  rule is exploitable. The step-over is keyed on `entry.event.type === 'messageReceived'` — a client-owned
  discriminant from the closed `HistoryTimelineEvent` union that #1227's main-side decode already narrowed —
  never on the daemon-supplied `role` string and **never on "this entry could not be keyed"**. The broader
  spelling looks equivalent (a `messageReceived` entry is exactly one that never matches a live key) and is
  not: a hostile daemon could stamp an over-length `ts` on an `assistantDelta` belonging to a turn whose
  newer deltas it also serves, the walk would step over that older delta and drop the newer ones against
  their real live keys, and the surviving older delta would fold into a bubble `prependHistoryFor` places
  ABOVE the live bubble holding the newer text — #1225's documented "A TURN READ BACKWARDS" corruption, made
  daemon-triggerable. Scoping the step-over to the one entry type whose row is independent of every other
  arm is what keeps that unreachable. Only the `ts` half of any entry is remote.
- **[Threat model — hostile daemon, suppression]** No findings. The change widens what the run can reach
  past, never what it can drop: every dropped entry still needs its own key to be defined, to occur exactly
  once in the page, and to be present in the live set — and a live key exists only where the live fold
  actually changed what the operator sees (#1225's `dispatchFor` rule). So a crafted `message` entry used as
  a bridge can only suppress page copies of events this client genuinely drew, which are duplicates by
  definition. A `messageReceived` entry is itself never dropped, in any position, so no crafted page can
  make an operator message disappear.
- **[Threat model — hostile daemon, corruption]** No findings beyond the class #1225 already accepted. A
  widened run can drop a `toolResult` whose `toolUse` lies beyond the stop, leaving the page's `toolUse` row
  pending — but that requires a live-drawn result above a live-undrawn use, which the existing suffix rule
  already admits and which the docblock already names. The step-over reaches further into the same class; it
  does not create a new one. Ordering is unreachable as a fault: the filter preserves order, and the only
  survivors newer than the stop entry are message rows that fold last and depend on nothing.
- **[Concurrency]** Not applicable — `withoutLiveEntries` is a pure function of two arguments with no
  timers, no listeners, no I/O and no shared state; there is nothing to own, cancel or tear down.
- **[Network & I/O, file/storage, crypto, tokens]** Not applicable — nothing here opens a socket, touches
  the filesystem, composes a path, holds a key or reads a credential. The page arrived inside one
  `MAX_PLAINTEXT_BYTES` frame and is already decoded; no daemon-chosen number sizes an allocation, and the
  added filter is O(n) over that bounded array.
- **[Electron attack surface]** Not applicable — renderer-only pure code, no IPC channel added, no
  `contextBridge` surface widened, no window options touched. The composed key stays a comparand reaching a
  `Map`/`Set` membership test and nothing else: never a lookup path on a bare object, a filename, a URL, an
  attribute, a React key or a log field.
- **[Error messages, logs, telemetry]** No findings — the function logs nothing and throws nothing, and no
  replayed text reaches a message or a log sink on this path.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
