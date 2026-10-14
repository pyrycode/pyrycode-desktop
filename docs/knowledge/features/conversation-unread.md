# Conversation unread predicate

The pure unread predicate uses the received daemon history IDs on a
[conversation list row](conversation-list-store.md). Rows without both IDs retain the comparison
between [held timeline](conversation-timeline-holder.md) item count and
[local last-read mark](conversation-last-read-store.md). No store, bridge, IPC arm or render lives here.

Introduced in [#778](https://github.com/pyrycode/pyrycode-desktop/pull/795), split from #677, unblocked
by #777 (which stamps the open conversation's mark). [#676](https://github.com/pyrycode/pyrycode-desktop/issues/676)
draws the green "New messages" dot from it and carries the Figma reference.

[Conversation status resolver](conversation-status.md) (#799) is the first module to consume this
predicate's *output* rather than its inputs: it takes the resulting `boolean` as a parameter and joins it
with the activity store's four facts. It does not call `isConversationUnread` itself and never touches
the source stores — [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801) landed
that composition, in [`ChannelList.tsx`'s `ConversationStatusDotControl`](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801),
per row. [App badge](app-badge.md) is the other production consumer; both pass the actual row's read
state rather than looking up an arbitrary matching conversation ID from another host.

## What it does

`isConversationUnread(timeline, lastRead, row?)` answers one boolean from a row's optional
`read_up_to` / `latest_entry_id` and the nullable `selectTimelineFor(id)` / `selectLastReadFor(id)`
outputs. `hasDaemonReadState(row)` tests whether both daemon fields are present, including zero.

## How it works

- **Daemon comparison comes first.** With both fields, unread means
  `latest_entry_id > read_up_to`, even when no timeline or local mark is held. These are durable
  per-conversation history entry IDs, independent of envelope IDs, replay event IDs and local item
  counts. Equal IDs, including `0` / `0`, read as read. Wire and saved-list parsers admit only
  non-negative safe integers; the presence predicate does not perform boundary validation.
- **Live/replayed durable IDs restore attention before a list refresh.** The timeline bridge raises
  the owning host's existing row `latest_entry_id` from validated `history_entry_id`, even while the
  conversation is closed. Delayed lists cannot lower either known latest IDs or confirmed read marks.
  Acknowledging displayed tail 10 with known latest 12 leaves `12 > 10` unread; receipt of a newer
  unseen entry never becomes visibility proof. See [received read state](conversation-list-store.md#received-read-state).
- **Publication and confirmation are separate.** The focused, uncovered committed newest-message
  tail supplies a host-bound observation through the [read publisher](conversation-last-read-store.md#how-it-works).
  Sending the command changes neither daemon read state nor this predicate's answer; a received
  owning-host mark advances the comparison. Reusing observation setup still requires the latest
  committed target and current sole host ownership on every observation; duplicate claims or a
  mismatch with the displayed slice's host cannot create a new claim. Receipt of an uncommitted
  delta cannot advance the observed target. Missing frame identity on a complete daemon row cannot
  restore local read authority. Daemons without the received contract retain local count persistence,
  stamps and pairing/per-server clears and receive no read command.
- **Incomplete or absent daemon contract uses three legacy branches, in this order:**
  1. `timeline === null` → **read**. Nothing is held for this conversation (never fed, or evicted at
     [conversation timeline holder](conversation-timeline-holder.md)'s ten-slice cap), so there is no
     locally held content to compare, whatever local mark it carries. This branch runs first because it is what
     resolves the one state where the two absent-readings disagree: at launch no slices are held and no
     marks exist for conversations never opened, and a mark-first reading would light the entire sidebar
     on every start — the failure #776's persistence was built to prevent.
  2. `lastRead === null` → **unread**. A timeline is held and this client has no record of reading it, so a
     chat another client has driven is never invisible. Opening it clears the mark by the ordinary path
     (`stampLastReadFor`) for legacy rows; this module never writes.
  3. otherwise → `timeline.items.length > lastRead`. Strict `>` — an exact match reads as read.
- **No `?? 0`, `?? initialTimelineState`, `||`, default parameter, or non-null assertion anywhere.** Both
  inputs stay nullable on purpose; each absent case is its own written-out branch. `items.length > (lastRead
  ?? 0)` typechecks identically and collapses branch 2 into branch 3 — the same collapse both source
  stores' headers ban at their own read sites.
- **Hard import constraint, checkable by grep: all of this module's imports are `import type`, and it has
  no value import at all.** `TimelineState` from `./threadTimeline`, `LastReadMark` from
  `./conversationLastReadStore`, plus `ConversationSummary` from `@shared/wire/types`. A value import of a store
  would construct `conversationLastReadStore`'s app-wide singleton and pull the `localStorage` port into
  this module's graph and into every test that imports the predicate. Written as `import type`, the module
  has zero runtime dependencies.
- **The conversation id never enters this file.** The caller resolves an id to a slice and a mark through
  the two source stores' own `Map` lookups before calling in; the predicate takes only the two already-
  resolved values and row read fields. No `conversationId` parameter, no `Map` lookup here, and daemon message text is likewise
  unreachable — the only field read off `TimelineState` is `.items.length`, never an element.
- **Reading two stores back to back is not a torn read.** No `await` sits between the two selector reads;
  zustand's vanilla `setState` reassigns state and only then calls its listeners, and the renderer is
  single-threaded, so there is no suspension point for a write to land in between. A pair drawn from
  adjacent commits is at most one render stale and self-corrects on the next — a momentary dot, never a
  wrong resting state. Do not "fix" this into a combined snapshot or a `useMemo` over both stores.
- **Log-free by construction**, matching both source stores — no `console.*` on any path. An absent input is
  a defined reading, not an error to report.

### Two legacy corners decided, not open

- **A present but empty slice with no mark reads as unread.** Falls out of branch 2 running ahead of branch
  3. It is reachable: `dispatchFor` creates a slice on an absent key unconditionally, including for arms
  that never touch `items` (`turnState`, `stallDetected`, `apiRetry`, `reconnected`), so a
  turn running in a conversation the operator has never opened mints an empty slice with no mark — reading
  that as unread is the honest answer, since a slice minted without a row is still evidence of activity in
  a conversation this client has never read.
- **A recreated slice below a stale mark reads as read.** A mark of `47` against a recreated count of `1`
  (after eviction and later recreation at [conversation timeline
  holder](conversation-timeline-holder.md)'s ten-slice cap) is `1 > 47` → read. This answers the open
  question [conversation last-read store § Edge cases](conversation-last-read-store.md#edge-cases-and-limitations)
  left open, in the direction the ticket states: a missed mark beats a stuck one nobody can clear. Recovering
  it would need a history backfill this app does not have.

## Configuration and usage

- File: `src/renderer/src/store/conversationUnread.ts`; exports `isConversationUnread` and
  `hasDaemonReadState`. The optional row accepts only the two read fields through
  `Pick<ConversationSummary, 'read_up_to' | 'latest_entry_id'>`.
- [`ConversationStatusDotControl`](channel-list-status-dot.md) composes the row with its two keyed
  store reads; [`conversationStatusNow(row)`](app-badge.md) performs the equivalent synchronous
  composition for the badge. A `useConversationUnread(id)` hook was declined because static renderer
  tests cannot execute it.

## Edge cases and limitations

- **Omission is unknown, never zero.** A row with only one daemon field retains the local fallback.
  A complete row ignores local counts, so opening it or receiving timeline content cannot clear
  daemon unread locally: both stamp paths are guarded. Desktop publication requires the
  [committed visible-tail observation](conversation-last-read-store.md#how-it-works).
- **Read advances are host-scoped and monotonic while held.** The [list store](conversation-list-store.md)
  advances existing read/latest IDs before refresh replies; stale lists cannot undo either. A later list
  or live/replayed entry with a higher latest ID can make the row unread again. Timeline eviction does
  not affect a complete row's comparison. Pending input and working still outrank unread in the
  [status resolver](conversation-status.md).
- **A forged large `localStorage` mark suppresses a legacy conversation's dot — accepted, not fixed.** An
  attacker with write access to the renderer's `localStorage` can store a mark of, say,
  `Number.MAX_SAFE_INTEGER`; `decodeLastReadMarks` bounds the mark's *type*, not its magnitude, so branch 3
  reads that conversation as read for as long as the mark stands. Bounded and self-healing by mechanisms
  that already ship: `stampLastReadFor` assigns rather than `Math.max`s, so opening the conversation resets
  the mark downward, and #779's pairing-boundary clear floors the whole map. Not fixed here — a magnitude
  cap belongs in #776/#779's decoder, against a failure nobody has observed.
- **No whole-map read surface.** No `selectAllUnread`, no set of unread ids — [conversation activity
  store](conversation-activity-store.md#configuration-and-usage)'s sidebar already reads one row at a time,
  so a whole-map surface here would ship unread.
- **Mutation-checked, not just test-green.** Three deliberately-wrong implementations — swapped branch
  order, an `?? 0` collapse, `>=` for `>` — were each run against the suite to confirm they fail at least
  one test; all three typecheck clean and pass 7–9 of the 10 tests, so a green suite alone would not have
  distinguished them (PR #795).

## Related decisions

- [Conversation last-read store](conversation-last-read-store.md) — `LastReadMark`/`selectLastReadFor`, one
  of this predicate's two inputs, and the open question this ticket answers.
- [Conversation timeline holder](conversation-timeline-holder.md) — `TimelineState`/`selectTimelineFor`,
  the other input, and `MAX_RETAINED_TIMELINES`, the source of the eviction discontinuity above.
- [Thread timeline](thread-timeline.md) — `TimelineState.items`, the quantity a mark is a sample of.
- [Channel list](channel-list.md) and [Archive screen](archive-screen.md) — `channelListViewModel.ts` /
  `archiveViewModel.ts`, the framework-free pure-derivation shape this module's shape (not its location)
  copies.
- [ADR 0007 — Content-free diagnostics by construction](../decisions/0007-content-free-diagnostics-by-construction.md)
  — why an absent input stays a silent, defined reading rather than a log line.
