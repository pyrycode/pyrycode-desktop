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
[#873](https://github.com/pyrycode/pyrycode-desktop/issues/873) added the fourth state, `input-required`, and
its leading `inputRequired` parameter; the call site still passes a literal `false` for it until
[#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) composes `selectHasOutstandingFor` there.

## What it does

All four states the sidebar's design calls for are now buildable: input required (amber), working (blue
slow-blink), new messages (green), idle (empty). Each of the two consumers would otherwise join the source
facts itself, in two places, with two chances to get the precedence backwards. This module ships the join
once.

## How it works

- **The type**, declared in precedence order so it reads as the rule:

  ```ts
  export type ConversationStatus =
    | 'input-required' // a permission or trust prompt is outstanding; the operator is the blocker
    | 'working'         // the assistant is mid-work in this conversation
    | 'new-messages'    // content this client holds that the operator has not read
    | 'idle'            // nothing to report
  ```

  A string-literal union, not a discriminated union of objects — none of the four carries a payload, and
  a payload-free closed set is a literal union repo-wide (`PairingRejectReason`, `FingerprintRejectReason`,
  `WireModalClass`). CLAUDE.md's "discriminated unions on a `type` field" rule is scoped to events and
  actions; a status is a value. Kebab-case, matching every other client-owned union in the repo — the
  snake_case of `src/shared/wire/` is a wire convention and doesn't apply, since none of these four
  strings ever crosses the wire and none is ever rendered directly (#800/#873 map them to display copy).

- **The function**, `resolveConversationStatus(inputRequired: boolean, activity: ConversationActivityEntry | null, unread: boolean): ConversationStatus`.
  Total — every input is a defined reading, no throw path, no failure mode. Parameter order is the
  precedence order: `inputRequired` first because it outranks everything else, `activity` next because
  working outranks new messages. `inputRequired` is required and leading rather than optional-and-trailing
  — [#873](https://github.com/pyrycode/pyrycode-desktop/issues/873)'s spec: an optional parameter cannot
  hold first position in TypeScript, and keeping the order the rule outranked leaving the #801 call site
  untouched. The resulting `tsc` red at that one call until it passed a value was the enforcement, not a
  cost.

- **Precedence, a flat sequence of early returns, one line per level:**
  1. **Input required** — a permission or trust prompt is outstanding for this conversation. The one
     state blocked on the *operator*, so it outranks everything below and must never hide behind a
     busier-looking status — including when that same conversation is also working, also unread, or both
     ([#873](https://github.com/pyrycode/pyrycode-desktop/issues/873) AC2). A plain boolean, never a
     `conversationId` — see the SECURITY note below. Landed correct-but-unreachable: the one production
     call site ([`ConversationStatusDotControl`](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801))
     still passes a literal `false`, until
     [#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) composes
     `selectHasOutstandingFor(conversationId)` (`modalPrompts.ts:254`) there — the same way #799 and #800
     each landed before #801 wired them.
  2. **Working** — any of the four activity facts.
  3. **New messages** — the `unread` boolean, already derived by `isConversationUnread` at the call site;
     this module never re-derives it.
  4. **Idle** — otherwise.

  The flat early-return shape (not a switch, not a lookup table) is what made inserting slot 0 a one-line
  edit at a marked point — the reserved-slot comment this replaced predicted exactly that.

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

- **No `conversationId` parameter, deliberately — and `inputRequired` is a boolean for the same reason.**
  #801 resolves an id to an activity entry and an unread boolean through the two source stores' own
  selectors *before* calling in, and [#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) will
  do the same for `selectHasOutstandingFor` — so the untrusted daemon-asserted id never enters this file.
  No `Map` lookup here, no object literal keyed by an id, no computed keys. Daemon text is likewise
  unreachable: this module reads booleans only and returns one of four client-owned literals. Log-free by
  construction — a `null` entry is a defined reading, not a miss to report.

## Configuration and usage

- File: `src/renderer/src/store/conversationStatus.ts`. Two exports: the `ConversationStatus` type and
  `resolveConversationStatus`. `isWorking` stays module-private.
- One consumer: [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801) composes
  `selectActivityFor(id)` and `isConversationUnread(timeline, lastRead)` at its own call site
  ([`ConversationStatusDotControl`](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801)) and
  passes both results straight in, alongside a literal `false` in the leading `inputRequired` position;
  this module still does not read any source store itself.
  [#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) replaces that literal with
  `selectHasOutstandingFor(conversationId)`.
- Lives beside its two inputs under `store/`, not `screens/`, for the reason `conversationUnread.ts`
  already gives: its inputs are store slices rather than wire rows, and its consumer is the sidebar rather
  than any one screen. `threadTimeline.ts` (pure) beside `timelineStore.ts` (a store) is the naming pair
  this follows — no `Store` suffix, since this module is not one.

## Edge cases and limitations

- **The one AC no test in this file can defend:** widening the return annotation to `string` typechecks
  and passes every test in `conversationStatus.test.ts` unchanged. [The dot component](conversation-status-dot.md)'s
  (#800) prop type is what defends it, not this module's own suite.
- **Mutation-checked, not just test-green**, following `conversationUnread.ts`'s discipline. Checks
  confirmed to fail at least one test each: swapping the working/new-messages branch order (fails only the
  precedence test), dropping one disjunction clause (fails only that fact's single-fact test), an
  `&&` in place of the first `||` (fails that fact's single-fact test *and* the precedence test — a
  broader blast radius than initially predicted for the `turnRunning` clause specifically, since the
  precedence fixture is a single-fact entry and `turnRunning && stalled` is false for it whenever
  `turnRunning` alone was meant to carry the case; see the PR's own lesson on this), and, since
  [#873](https://github.com/pyrycode/pyrycode-desktop/issues/873), moving the `inputRequired` return below
  `isWorking` (fails only the input-required-AND-working and full-strength scenarios). A precedence-test
  failure alone is therefore not a clean signal about which branch order broke — it can mean any adjacent
  pair swapped, or a fact's own disjunction broke. The single-fact tests are what disambiguate between
  them; both precedence levels now have a dedicated pair (working-AND-unread; input-required-AND-working).

## Related decisions

- [Conversation status dot](conversation-status-dot.md) — the presentational leaf that draws this type's
  four values (#800/#873), and this module's first consumer.
- [Conversation activity store](conversation-activity-store.md) — the four activity booleans this module
  reads through `ConversationActivityEntry`, the only symbol this module imports (as a type).
- [Conversation unread predicate](conversation-unread.md) — the sibling pure-join module this one is
  shaped after (posture, not logic): store-slice inputs, no store of its own, `import type`-only,
  mutation-checked.
- [ADR 0009 — Modal prompt model](../decisions/0009-modal-prompt-model.md) /
  [Modal-prompt model](modal-prompt-model.md) — the wire carries a `conversation_id` on `modal_shown`
  since [#870](../codebase/870.md), and [#871](../codebase/871.md)/[#877](../codebase/877.md)/
  [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) carried it all the way onto the held
  `ModalPrompt` and a `selectHasOutstandingFor(conversationId): boolean` selector. #873 (this doc) is the
  branch that consumes that boolean; [#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) is the
  one piece of the chain still unwired — composing the selector at the #801 call site.
