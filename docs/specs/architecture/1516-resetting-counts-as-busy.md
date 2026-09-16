# #1516 — count a resetting conversation as busy on its channel-list row

A conversation mid-reset is the assistant mid-work. This adds the fifth fact to the per-conversation
activity store, feeds it from #1515's `resetting` daemon arm, and reads it in the sidebar row's
working derivation.

## Files read

- `src/renderer/src/store/conversationActivityStore.ts` → `ConversationActivityEntry`, `idleActivity`,
  `ConversationActivityStore`, `setCompacting`, `writeEntry`, `selectActivityFor` — the holder the
  fifth fact joins, and the per-setter same-value guard whose docblock says a fifth fact means a fifth
  setter carrying its own guard.
- `src/renderer/src/store/conversationActivityBridge.ts` → `ConversationActivityWrite`,
  `translateConversationActivity`, `assertNever`, `ConversationActivityDeps`,
  `subscribeConversationActivity`, `ConversationActivityData` — the four-arm translator, the apply
  switch whose `assertNever` makes a fifth fact without a dispatch case a type error, and the
  composition root.
- `src/renderer/src/store/conversationStatus.ts` → `isWorking`, `resolveConversationStatus` — the
  derivation, and the docblock that bans `Object.values(entry).some(Boolean)` in writing so that a
  fifth fact is a deliberate edit here.
- `src/shared/ipc/events.ts` → the `resetting` arm — two edges, the rising edge re-fires as the phase
  advances, not deduped, and the standing obligation that a consumer must not rely on the falling edge
  arriving.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ConversationStatusDotControl` — where the
  four selectors meet `resolveConversationStatus`; unchanged by this ticket, and that is the point.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `seedWorking` and the `#801` status-dot
  describe with its four-store `afterEach` — the row proof's existing hook.
- `src/renderer/src/store/conversationActivityStore.test.ts` → `idle`, `facts`, `activityFor`; and
  `src/renderer/src/store/conversationActivityBridge.test.ts` → `wired`, `seam`, `holdAllFour` — the
  fixtures the fifth fact extends.
- `src/renderer/src/store/conversationStatus.test.ts` → `activity` — already a spread over an all-false
  base, written so a fifth fact breaks in one place rather than in every test.
- `docs/knowledge/features/conversation-activity-store.md` — the package overview. Two lessons carried
  forward: the per-setter guard exists so a fifth fact cannot silently stop an existing setter from
  writing, and the "no fifth fact" entry in its limitations is scoped to `localSendPending`.

## Design source

N/A — the dot is already designed and already drawn (#799/#800). This ticket changes only when it
lights and adds no visual, so the verifier's visual-fidelity check is intentionally skipped.

## Context

`isWorking` resolves a sidebar row's dot from the four booleans `ConversationActivityEntry` holds. A
reset is the assistant mid-work by exactly the reading #799 gave the other four, so it becomes the
fifth fact. The blocker (#1515) has landed: the window now receives a `resetting` `DaemonEvent`
carrying `conversationId`, `active`, `phase` and `handoff`. `conversationActivityBridge` is not one of
the four exhaustive bridges #1515 no-opped past — its translator ends in `default: []` — so nothing on
this leg is already wired and nothing is half-wired.

**Sizing overage, stated rather than split.** The one-ticket boundary's consumer-call-site line is
tripped: adding a required field to `ConversationActivityEntry` forces the field into every **full**
entry literal, and there are sixteen — `idleActivity` in production, six in
`conversationActivityStore.test.ts`, one in `conversationStatus.test.ts` (its `activity` helper
spreads, so it is one site rather than six), and eight inline `toEqual` literals in
`conversationActivityBridge.test.ts`. The other five lines of the boundary hold: three production
files, no new exported type or component, four acceptance criteria, no state machine, and roughly 600
lines of total written work. The ticket is built as one ticket anyway, on the floor rule. The only
split available cuts the write (store + bridge) from the read (`isWorking` + the row), and the write
half's sole consumer is the read half — a one-consumer child, which the floor rule says belongs to its
sibling. It would also not bound the cost it was called for: the type change lives in the write half,
so all sixteen literal sites land in that child regardless and the read child carries almost none. The
fan-out is intrinsic to adding a field to a shared entry type and is not sliceable. Floor beats
ceiling, so this builds as filed.

No ADR is warranted — every decision here is an application of a rule the two modules already state in
their own docblocks.

## Design

**The fact.** `ConversationActivityEntry` gains `resetting: boolean`, a plain boolean beside the other
four, and `idleActivity` seeds it `false`. `ConversationActivityStore` gains `setResetting`, the fifth
named setter, composed the same way as its four siblings: its own same-value guard against its own
named field, over the shared `writeEntry`. No reducer, no generic `setFact`, no shared multi-field
comparison — the store's own docblock argues each of those, and this fact is the case that argument
was written for.

**Only `active` crosses.** The translator builds a fresh named-field literal carrying `event.active`
and nothing else. Neither `phase` nor `handoff` is held in the entry, named in the write union, or read
by the derivation. This is the same rule that keeps `apiRetry`'s `current` / `total` out of this store:
it holds liveness, and a spread would carry the arm's `type` tag and both tokens into a write unit that
never agreed to hold them.

**The write union grows a fifth member**,
`{ fact: 'resetting'; conversationId: string; resetting: boolean }` — payload field named after the
fact, as the union's docblock requires, so a cross-wire is a type error rather than a tag swap that
compiles. `assertNever` in the apply switch then makes the dispatch case mandatory: the fifth fact does
not compile until `subscribeConversationActivity` routes it.

**`ConversationActivityDeps` gains `setResetting`**, and `ConversationActivityData` gains one line
wiring it to the store singleton. The named-object shape is unchanged and still load-bearing — the new
member collapses onto the other four setters' `(string, boolean) => void` signature exactly as they
collapse onto each other, so it is a named member for the same reason they are.

**`isWorking` gains a fifth named read**, `|| entry.resetting`. Not
`Object.values(entry).some(Boolean)`: that is banned in writing in this function's own docblock,
precisely so a fifth fact is a deliberate edit here rather than an accident there. The `null` guard is
untouched and stays null-safety rather than precedence. `resolveConversationStatus` is not touched at
all — its precedence order is unchanged, and input-required still outranks a resetting conversation.

**`ChannelList.tsx` is not touched.** `ConversationStatusDotControl` already reads the whole entry
through `selectActivityFor` and hands it to `resolveConversationStatus`, so the row lights with no edit
at the call site. That the row proof passes against an unchanged component is the evidence that the
fact reaches the dot through the shipped composition rather than through a second derivation.

**Prose reconciled, not deleted.** `ConversationActivityEntry`'s "there is deliberately NO fifth fact"
paragraph is an argument about `localSendPending` — the one renderer-sourced scalar, opened by the
operator's own send, which only the open conversation has a composer to open. That argument stays true
of `localSendPending` and is kept, rewritten to say what it was always about rather than being
falsified by a fifth fact it never covered. The same paragraph in the package overview's limitations is
the documentation phase's to reconcile, not this ticket's.

## State + concurrency model

One slice, `conversationActivityStore`'s `entries` map, written through one more synchronous setter
under zustand's own store lock with no `await` inside it. No new async task, no timer, no subscription,
no teardown: the fifth fact rides the bridge's single app-lifetime listener, which already dispatches
every arm synchronously in daemon arrival order.

**Edge semantics are `apiRetrying`'s and `compacting`'s, not `stalled`'s.** The wire's own falling edge
is the clear, and `resetting` is deliberately **not** added to `turnState`'s clear set. That is sharper
here than for its two peers: the wrap-up turn runs *inside* the reset, so its own `turn_state`
transitions would otherwise clear the very fact they are part of. A `turnState` for that conversation
must leave the fact showing.

**The re-fire needs no handling of its own.** The rising edge fires again as the phase advances
(`wrapping_up` → `restarting`). Both rising edges write the same `true`, so the store's per-field
same-value guard returns the state object itself and zustand's `Object.is` short-circuit fires — the
second edge churns no listener. This is a property of the guard, not a suppression added here, and the
arm must stay un-deduped upstream because a suppressed repeat would eat the signal that the phase
moved.

**The falling-edge obligation is discharged by the clears this store already owns.** #1515's arm
contract rides one obligation forward by name: a consumer must not rely on the falling edge arriving,
because a daemon killed mid-reset sends no `active: false`. Three independent triggers answer it, all
of them already built and none of them specific to this fact — `dropConversation` on the delete arm,
`resetActivityFor` on the reconnecting server's own `connected` edge, and `clearAllActivity` at the
pairing boundary. No timer and no heuristic is added. The residue is the one the other four facts
already carry and is bounded the same way: an entry for a conversation in no server's list survives a
reconnect and is collected at the next pairing boundary.

## Error handling

There is no failure mode to handle. Every value added is a boolean the transport already narrowed, and
the untrusted `conversationId` stays exactly what it already is — a `Map` key, never rendered, never
concatenated, never a filename, a cache key or a URL. Both modules stay log-free by construction: no
`console.*` on any path, since the only value a diagnostic here could carry is that id, and together
with the reset it would disclose which conversation the operator reset. No result type, no UI error
path, no throw except the existing unreachable `assertNever`.

Not security-sensitive and unlabelled: three renderer store modules, no keys, no sockets, no untrusted
text reaching a sink. #1514 and #1515 carry the label because they touch `src/main/`; this leg does
not.

## Testing strategy

Vitest only, all four files static and React-free or server-rendered. No Playwright spec: nothing here
is a transition the user drives — the daemon drives it, and the renderer proof is a static markup
assertion of the kind the existing status-dot cases already are.

`conversationActivityStore.test.ts` — the fifth fact joins the table-driven `facts` cases, so it
inherits both per-setter properties (creates the entry; a first write of `false` still creates it).
`idle`, the four `live` literals and the one inline entry assertion gain `resetting: false`. One added
case: the fifth fact is independent of the other four, and a repeat write of the same value hands back
the state object itself.

`conversationActivityBridge.test.ts` — translator cases for the rising edge, the falling edge, and that
neither `phase` nor `handoff` reaches the write (asserted as absent properties, the shape the `apiRetry`
counter case already uses). A dispatch case: `resetting` reaches `setResetting` alone. Seam cases
against the real store: a `turnState` mid-reset leaves the fact set while flipping `turnRunning`; a
second rising edge as the phase advances leaves it set; the falling edge clears it; the fact lands for
a conversation never opened, and is dropped by a delete and by that server's own reconnect but not by
another server's. The eight inline entry assertions gain the field.

`conversationStatus.test.ts` — the `activity` helper gains the field in its one place. One added case:
working when `resetting` alone is true, which is the only assertion in the file that catches a dropped
fifth clause. The two all-facts cases widen to five.

`ChannelList.test.tsx` — a `seedResetting` beside `seedWorking` in the `#801` describe, and one case:
a row whose conversation is mid-reset draws the working dot while its two neighbours stay idle. That is
AC3 pinned at the row rather than only at the derivation, and it passes against an unchanged
`ChannelList.tsx`.

## Open questions

- Whether the row proof belongs in the existing `#801` status-dot describe or a new one. Leaning to the
  existing one: its `afterEach` calls `clearAllActivity`, which drops whole entries and so already
  clears a fifth fact with no edit, and its three-row fixture is what makes the neighbour assertions
  possible.
- Whether the four `live` literals in the store test should become spreads over `idle` rather than
  gaining a field each. Leaning to gaining the field: they are spelled out deliberately, so that the
  file stays free of the computed-key construct the store forbids, and restructuring them is adjacent
  refactoring this ticket has no need for.

## Documentation handoff

The ticket body names no documentation requirement and has no documentation-only acceptance criterion.
Two reconciliations are nonetheless owed to the documentation phase and are **pending** for it, not
done here:

- `docs/knowledge/features/conversation-activity-store.md` — "What it does" lists four booleans and the
  write path names four setters; "Edge cases and limitations" carries a **No fifth fact for
  `localSendPending`** entry whose heading now reads wrong even though its argument is still correct.
  The entry should be renamed to what it is about rather than deleted.
- `docs/knowledge/features/conversation-status.md` — `isWorking` is described there as the four-fact
  disjunction.

## Revisions

**2026-09-16, implementation.** No design change; both open questions resolved as the plan leaned, and
both are recorded here rather than left for the reader to infer from the diff.

- The row proof went into the existing `#801` status-dot describe. Its `afterEach` calls
  `clearAllActivity`, which drops whole entries and so cleared the fifth fact with no edit, and its
  three-row fixture is what makes the neighbour assertions possible. Two cases landed there rather than
  one — the working-dot case and AC4's never-opened case at the row.
- The four `live` literals in the store test gained the field rather than becoming spreads over `idle`.
  They are spelled out deliberately, so that the file stays free of the computed-key construct the store
  forbids.

One thing the implementation added that the plan did not name: the translator gained a test that the
fact is read from `active` alone with the phase varied in both directions. It is the assertion that
catches a translator branching on `phase` — reading `restarting` as "no longer resetting" — which every
other case in that file passes.
