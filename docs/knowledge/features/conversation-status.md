# Conversation status resolver

The join between [conversation activity store](conversation-activity-store.md)'s four booleans and
[conversation unread predicate](conversation-unread.md)'s shipped boolean: one sealed `ConversationStatus`
union and one total pure function that maps both onto exactly one status a sidebar row can draw. Renders
nothing, reads no store, holds no state.

Introduced in [#799](https://github.com/pyrycode/pyrycode-desktop/pull/805), split from #676. The
[dot component](conversation-status-dot.md) ([#800](https://github.com/pyrycode/pyrycode-desktop/issues/800))
draws its type as a type import; [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801) is the
first module to call `resolveConversationStatus` in production, composed per row in
[`ChannelList.tsx`'s `ConversationStatusDotControl`](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801).

## What it does

Three states are buildable today from the sidebar's design (empty dot / green dot / blue slow-blink dot):
idle, new messages, working. Each of the two consumers would otherwise join the two source facts itself,
in two places, with two chances to get the precedence backwards. This module ships the join once.

## How it works

- **The type**, declared in precedence order so it reads as the rule:

  ```ts
  export type ConversationStatus =
    | 'working'       // the assistant is mid-work in this conversation
    | 'new-messages'  // content this client holds that the operator has not read
    | 'idle'          // nothing to report
  ```

  A string-literal union, not a discriminated union of objects — none of the three carries a payload, and
  a payload-free closed set is a literal union repo-wide (`PairingRejectReason`, `FingerprintRejectReason`,
  `WireModalClass`). CLAUDE.md's "discriminated unions on a `type` field" rule is scoped to events and
  actions; a status is a value. Kebab-case, matching every other client-owned union in the repo — the
  snake_case of `src/shared/wire/` is a wire convention and doesn't apply, since none of these three
  strings ever crosses the wire and none is ever rendered directly (#800 maps them to display copy).

- **The function**, `resolveConversationStatus(activity: ConversationActivityEntry | null, unread: boolean): ConversationStatus`.
  Total — every input is a defined reading, no throw path, no failure mode. Parameter order is the
  precedence order: `activity` first because working outranks new messages.

- **Precedence, a flat sequence of early returns, one line per level:**
  1. **Input required** — reserved, not buildable yet. `modal_shown` now carries a `conversation_id` on
     the wire ([#870](../codebase/870.md), pyrycode#1065, ADR 0009 amended) and
     [Inbound message decode](inbound-message-decode.md) narrows it, but the consumer emit deliberately
     drops it there — it isn't on `DaemonEvent` (`src/shared/ipc/events.ts:637`) yet, so this resolver
     still has nothing to attribute a prompt to a conversation with. [#871](../codebase/871.md) carries
     it onto `DaemonEvent`; [#872](../codebase/872.md) is the ticket that inserts this precedence level,
     above working, once the modal store holds it. No unreachable branch is written for it in the
     meantime — the reserved docstring slot is the whole affordance.
  2. **Working** — any of the four activity facts.
  3. **New messages** — the `unread` boolean, already derived by `isConversationUnread` at the call site;
     this module never re-derives it.
  4. **Idle** — otherwise.

  A conversation that is both working and unread resolves to working. The flat early-return shape (not a
  switch, not a lookup table) is what makes inserting slot 0 later a one-line edit at a marked point.

- **`isWorking`, a module-private helper, not exported:** any of `turnRunning`, `stalled`, `apiRetrying`,
  `compacting`, each named explicitly — never `Object.values(entry).some(Boolean)`, which reads
  behaviourally identical today but would silently absorb a fifth field the day
  `ConversationActivityEntry` grows one, and truthy-reads a non-boolean. "Not idle" rather than "a turn is
  strictly in flight" is the deliberate ruling: a stalled turn, an API retry and a compaction are all the
  assistant mid-work, and reading any of them as idle would be a false negative on the one state the
  operator most wants to see. Narrowing this to `turnRunning` alone, if ever wanted, is a change to this
  one helper and three tests, nothing else.

- **The `null` guard is null-safety, not precedence.** An absent activity key ("no frame has ever arrived
  for this conversation") and a present all-false entry ("observed; nothing is happening") *agree* here —
  both read as not-working — unlike in `conversationUnread.ts`, where the equivalent branch order resolves
  a real disagreement between two absent-readings. `selectActivityFor` keeps the two distinct upstream on
  purpose, for readers other than this one.

- **Zero runtime imports, checkable by grep.** The only import is `import type { ConversationActivityEntry } from './conversationActivityStore'`.
  Dropping the `type` keyword is no type error and no failing test, but `conversationActivityStore.ts`
  constructs an app-wide singleton at module load, so a value import would drag it — and, transitively,
  `conversationLastReadStore`'s `localStorage` port if `isConversationUnread` were imported too — into
  this module's runtime graph and every test that imports the resolver. `conversationUnread.ts` set this
  same precedent for the same reason.

- **No `conversationId` parameter, deliberately.** #801 resolves an id to an activity entry and an unread
  boolean through the two source stores' own selectors *before* calling in, so the untrusted
  daemon-asserted id never enters this file. No `Map` lookup here, no object literal keyed by an id, no
  computed keys. Log-free by construction — a `null` entry is a defined reading, not a miss to report.

## Configuration and usage

- File: `src/renderer/src/store/conversationStatus.ts`. Two exports: the `ConversationStatus` type and
  `resolveConversationStatus`. `isWorking` stays module-private.
- One consumer: [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801) composes
  `selectActivityFor(id)` and `isConversationUnread(timeline, lastRead)` at its own call site
  ([`ConversationStatusDotControl`](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801)) and
  passes both results straight in; this module still does not read either source store itself.
- Lives beside its two inputs under `store/`, not `screens/`, for the reason `conversationUnread.ts`
  already gives: its inputs are store slices rather than wire rows, and its consumer is the sidebar rather
  than any one screen. `threadTimeline.ts` (pure) beside `timelineStore.ts` (a store) is the naming pair
  this follows — no `Store` suffix, since this module is not one.

## Edge cases and limitations

- **The one AC no test in this file can defend:** widening the return annotation to `string` typechecks
  and passes every test in `conversationStatus.test.ts` unchanged. [The dot component](conversation-status-dot.md)'s
  (#800) prop type is what defends it, not this module's own suite.
- **Mutation-checked, not just test-green**, following `conversationUnread.ts`'s discipline. Three checks
  confirmed to fail at least one test each: swapping the working/new-messages branch order (fails only the
  precedence test), dropping one disjunction clause (fails only that fact's single-fact test), and an
  `&&` in place of the first `||` (fails that fact's single-fact test *and* the precedence test — a
  broader blast radius than initially predicted for the `turnRunning` clause specifically, since the
  precedence fixture is a single-fact entry and `turnRunning && stalled` is false for it whenever
  `turnRunning` alone was meant to carry the case; see the PR's own lesson on this). A precedence-test
  failure alone is therefore not a clean signal that the branch order was swapped — it can also mean the
  first fact's disjunction broke. The single-fact tests are what disambiguate between the two.

## Related decisions

- [Conversation status dot](conversation-status-dot.md) — the presentational leaf that draws this type's
  three values (#800), and this module's first consumer.
- [Conversation activity store](conversation-activity-store.md) — the four booleans this module reads
  through `ConversationActivityEntry`, the only symbol this module imports (as a type).
- [Conversation unread predicate](conversation-unread.md) — the sibling pure-join module this one is
  shaped after (posture, not logic): store-slice inputs, no store of its own, `import type`-only,
  mutation-checked.
- [ADR 0009 — Modal prompt model](../decisions/0009-modal-prompt-model.md) — why input-required is
  reserved rather than built: the wire carries a `conversation_id` on `modal_shown` since
  [#870](../codebase/870.md), but it stops at decode until [#871](../codebase/871.md)/
  [#872](../codebase/872.md) carry it onto `DaemonEvent` and into the modal store.
