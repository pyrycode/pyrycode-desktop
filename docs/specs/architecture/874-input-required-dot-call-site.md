# #874 — light the input-required dot on a waiting conversation's row

The join. A fourth per-row store subscription in `ConversationStatusDotControl`, feeding the literal `false`
that `resolveConversationStatus` has been taking in first position since #873.

## Files to read first

Codegraph is **not indexed for this repo** — `codegraph_status` answers "CodeGraph not initialized", verified
on 2026-09-01 for the sibling ticket #873 and unchanged since. This list is grep- and Read-derived. Do not
spend a turn re-probing it.

- `src/renderer/src/screens/channels/ChannelList.tsx:713-777` — `ConversationStatusDotControl`, the whole
  deliverable. Read the header in full before editing: the WHY PER-ROW paragraph, the "Five things this must
  not become" list, and the honest-cost paragraph all need amending, and three of the five bullets are
  written against a count of three that becomes four.
- `src/renderer/src/screens/channels/ChannelList.tsx:22-38` — the import block for the three existing per-row
  reads, with the comment that states the id-stays-a-`Map`-key rule as a condition of those imports. The
  fourth import joins here.
- `src/renderer/src/store/modalStore.ts` (whole file, 45 lines) — `createModalStore` (`:27`), the singleton
  (`:36`), `useModalStore` (`:39`) and the `:45` re-export of `selectHasOutstandingFor`. The last line is
  why the selector is imported from here rather than from `modalPrompts`.
- `src/renderer/src/store/modalPrompts.ts:234-257` — `selectHasOutstandingFor`. Its docstring already settles
  every question this ticket could raise about it: `===` scan not a re-key, no prototype hazard, nothing to
  memoize, an unknown id answered `false`.
- `src/renderer/src/store/modalPrompts.ts:19-31` and `:52-79` — `ModalPrompt` and the `ModalEvent` union.
  The `shown` arm's field list is what the test's seed helper must construct; the `reconnected` arm is what
  the test's `afterEach` must dispatch.
- `src/renderer/src/store/modalPrompts.ts:202-220` — the `reconnected` reducer arm, so the clear-both-slices
  behaviour is read rather than assumed (see § The `resolved` trap).
- `src/renderer/src/store/conversationStatus.ts:59-94` — the resolver's docstring and body. Note that
  parameter order IS the precedence order and that positions 1 and 3 are both `boolean`; that is the one
  hazard `tsc` cannot see here.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:28-66` — the three-store mock block and the header
  paragraph explaining why seeding a singleton is invisible to `renderToStaticMarkup`. The fourth mock is
  this shape, verbatim.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:710-856` — the whole `#801` describe: the
  `afterEach` and its trap comment, the three seed helpers, `threeRows()`, `chunkFor`, and the eight cases
  that must keep passing untouched.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:163-178` — the status-dot marker constants and why
  they pin the FULL class attribute value. The fourth marker follows.
- `src/renderer/src/store/modalPrompts.test.ts:13-34` — the `shown(...)` fixture builder, including the
  ruling that `conversationId` is derived from but never equal to `modalId` so a transposition is catchable.
  The test seed here borrows that discipline; it does not import the builder.
- `src/renderer/src/screens/conversation/PermissionModal.tsx:192-194` — the shipped `useModalStore(selector)`
  call shape, and the proof that a `(s: ModalState) => T` selector is accepted where `(s: ModalStore) => T`
  is declared.
- `docs/knowledge/features/channel-list.md:302-326` — the shipped doc for this component, including the
  paragraph that names this ticket as what replaces the literal.
- `docs/knowledge/features/conversation-status.md` — the resolver's doc: the mutation-check discipline and
  the note that a precedence-test failure alone is ambiguous.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2968

Read on 2026-09-01: node `103:2968` (`Channel`) is a 340×24 row — `padding: 4px 16px`, `gap: 10px` — whose
two children are the 6×14 `Status dot` frame (`106:3051`) and the title in M3 `body/small` on
`--schemes/on-surface`. The dot leads at x=16 and the title follows at x=32, which is 16 + 6 + 10. **None of
that changes here.** The row's geometry, the dot's box and its leading position all shipped with #801, and
the dot node has a single drawn state with no variants — the amber paint this ticket makes reachable shipped
with #873 (`channels.css:901`). This ticket changes only *which* status resolves into the slot the design
already has.

## Context

Every row in both sidebar trees draws exactly one status dot, resolved per row from that row's own
conversation id. `resolveConversationStatus` has taken `inputRequired` as its first, required parameter and
ranked it above working since #873, and `selectHasOutstandingFor(conversationId): boolean` has answered the
question since #878. The one production call site passes a hardcoded `false` (`ChannelList.tsx:771`), with an
in-code comment naming this ticket.

So `input-required` is a status the type has, the resolver returns, the label map names, the stylesheet
paints and no row can ever reach. This slice is the wire between the store and the resolver, and it is one
subscription plus one argument.

The three blockers (#870/#871/#877 put the `conversation_id` on the wire, onto `DaemonEvent` and onto
`ModalEvent`; #878 onto the held `ModalPrompt` with its selector; #873 the status, branch, label and paint)
have all merged. Every `file:line` in this spec was re-verified against the current tree on 2026-09-01.

## Design

### 1. The import

One new import statement in `ChannelList.tsx`, after the last-read store's (`:33-36`), pulling **both**
`useModalStore` and `selectHasOutstandingFor` from `'../../store/modalStore'`.

From `modalStore`, not from `modalPrompts`. The selector is defined on the pure reducer module and
**re-exported** at `modalStore.ts:45` precisely so consumers take the read surface from one site; that line
says so, and `PermissionModal.tsx:192-194` is the shipped precedent. Importing it from `modalPrompts` also
splits the test's mock target from the hook's, for no gain.

Extend the `:22-25` comment that introduces this group: it says "#801's three per-row reads and the two pure
modules that reduce them … none takes a `conversationId` except the three selector FACTORIES". Make it four
reads and four factories. The rule the sentence states is unchanged and is what the fourth import obeys.

### 2. The subscription

One line in `ConversationStatusDotControl`, alongside the three that are already there:

```ts
const inputRequired = useModalStore(selectHasOutstandingFor(conversationId))
```

Fourth in the list is fine; ordering among the four reads is not load-bearing (they are independent reads in
a single-threaded renderer — see § State and concurrency). Reading it last and passing it first is not a
contradiction worth reordering for, but placing it first to mirror the argument order is equally acceptable.
Pick one and do not comment on the choice.

**No memoization, no hoisted constant, no `useMemo`.** The existing header bans merging the three
subscriptions into one selector because each of those returns a held reference or `null`, and an
object-building selector would return a fresh object every call and loop `useSyncExternalStore`. That
argument does not transfer to this one and must not be restated as though it did: `selectHasOutstandingFor`
returns a **plain `boolean`**, which `Object.is`-compares by value, so a fresh `false` is identical to the
last `false` and this row re-renders only when its own conversation's answer flips. `modalPrompts.ts:247-249`
states this and is the citation to use. The factory closure itself is one allocation per render, exactly like
the three shipped ones, and never a re-subscription.

### 3. The argument

Replace the literal `false` at `:771` with `inputRequired`, and **delete** the three-line comment above it
(`:768-770`) that names this ticket as what replaces it. Nothing else in the call changes.

### 4. The docstring updates, all in `ChannelList.tsx:713-755`

Five edits, none of them optional — the header is written against a count of three in five places and a
reader who trusts it after this change is misled:

1. `:718` — "Read the three narrow per-id slices" → four.
2. `:733-735`, the first must-not-become bullet — "THE THREE SUBSCRIPTIONS MERGED INTO ONE SELECTOR
   returning `{ activity, timeline, lastRead }`" → four, and the object gains `inputRequired`. Add one
   clause recording that the ban still holds for the fourth but for a **different reason**: the merged
   object would be freshly allocated regardless of what its fields are, so the boolean's value-stability
   buys nothing there. Without that clause the bullet reads as a claim about the boolean that is false.
3. `:745`, the id bullet — "THE `conversationId` ANYWHERE BUT THE THREE SELECTOR FACTORIES" → four. The
   rule itself is unchanged and this ticket's whole discipline: the id goes into
   `selectHasOutstandingFor(...)` and stops there.
4. `:751-755`, the honest cost — "reads three more singletons" → four, and name the modal store in the
   server-render sentence. That sentence stays **true**: the modal store hydrates to `initialModalState`
   (`modalPrompts.ts:226`) with an empty `outstanding`, so every unseeded row still server-renders as `idle`.
5. `:714` — the header's `(#801, Figma 103:2968)` may gain `#874`; the node is the same one this ticket
   reads. Cosmetic, take it or leave it.

The `:723-729` WHY PER-ROW paragraph needs **no** change. Hooks still cannot be called from the two `.map()`
callbacks, which is why this component exists; and the per-conversation-wake argument holds for the modal
store too, since `outstanding` is a single array and a `shown` for conversation A flips only A's boolean.

### 5. What this ticket does not touch

`Row` gains no store subscription — the ticket says so and the shipped design says so. `conversationStatus.ts`
is not edited: its signature, branch, docstring and security paragraph are all already correct for a wired
call site. `ConversationStatusDot.tsx`, `channels.css` and `ConversationStatusDot.test.tsx` are untouched;
#873 finished them. No new file, no new export, no wire change, no daemon change.

## State, concurrency, and error handling

Four back-to-back store reads in one render, then two pure calls. **Not a torn read, and nothing here needs
a merged snapshot across the four stores — do not build one.** `conversationUnread.ts:78-84` rules this for
two stores in a single-threaded renderer with no `await` between the reads; the fourth changes nothing about
that argument, and the ban is already the third bullet of the component's own must-not-become list.

No new async work, no subscription this component owns explicitly, no `AbortController`, no teardown.
`useStore` owns subscribe/unsubscribe and unmounting a row disposes the fourth binding exactly as it disposes
the three.

**No error handling, because there is no failure mode.** `selectHasOutstandingFor` is total: an unknown or
never-seen conversation id is a legitimate query answered `false`, not a throw and not a miss
(`modalPrompts.ts:251-252`). `resolveConversationStatus` is total. There is nothing to surface in a banner, a
dialog or silently, and **no `console.*` on any path** — all four stores and both pure modules are log-free
by construction and the component's header states it as a rule.

**Security, unchanged and load-bearing.** `conversationId` is daemon-asserted. It enters
`selectHasOutstandingFor(conversationId)` as a `Map`-key-equivalent scan value and stops. It must not reach
`resolveConversationStatus` (whose signature deliberately has no id parameter), and must not become a class
name, an attribute value, a `title`, an object key or a log line. This is the pattern the three existing
per-row facts already follow and the condition three separate module headers state about their own
signatures. No daemon **text** is involved at all: the selector returns a boolean and the resolver returns a
client-owned literal, so nothing untrusted has a path to the render.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) plus `npm run typecheck`. **Do not add a DOM environment.** All
work is in `ChannelList.test.tsx`; no other test file changes.

### The fourth mock

Extend the file's `:28-66` block with a fourth per-file store instance and a fourth `vi.mock`, in exactly the
shape of the three above it: a `createModalStore()` instance at file level, and
`vi.mock('../../store/modalStore', …)` spreading `...(await importActual<…>())` and overriding **only** the
`useModalStore` binding to `<T,>(selector: (s: ModalStore) => T): T => selector(promptStore.getState())`.

- Keeping `...importActual` is what leaves the real `selectHasOutstandingFor` in place, so the row's id →
  boolean lookup runs for real. That is the whole point; a hand-stubbed selector would test the mock.
- Name the local instance something other than `modalStore` — `promptStore` reads well. The module's own
  singleton export is called `modalStore` and the mock factory spreads it; a same-named local const is legal
  but invites a misread about which one a seed writes to.
- The `vi.mock` hoisting question is already answered by the `:42-43` comment and the answer is the same
  here: `createModalStore`'s body runs at import time and touches no const below it; only the returned hook
  reads `promptStore`, and it is not called until a render inside a test.
- Import `createModalStore` and `type ModalStore` from `'../../store/modalStore'` — the mocked path, resolved
  through `importActual`, exactly as the three existing factories are imported from their mocked paths.

### The `resolved` trap — read the reducer before writing the `afterEach`

The describe's `afterEach` (`:715-719`) gains a fourth clear, and **the clear must be
`promptStore.getState().dispatch({ type: 'reconnected' })`**, not a `dismissed` per seeded prompt.

`dismissed` moves the `modalId` onto the `resolved` slice, and the `shown` arm treats a seen-then-resolved id
as a **no-op rather than an append** (`modalPrompts.ts:154`, the slice documented at `:95-105`). So a
`dismissed`-based teardown leaves a later test's seed silently doing nothing, and that test renders an
`--idle` row while asserting `--input-required` — a failure that reads as a product bug in the wiring this
ticket just added. `reconnected` clears `outstanding` and `resolved` together (`:202-220`) and is the only
teardown that returns the store to its initial state.

This is the same class of hazard as the trap comment already standing above that `afterEach`, and deserves
its own sentence there.

### The seed helper

One helper beside the three existing ones, named for the status it produces — `seedInputRequired(id)` —
dispatching a `shown` event for that conversation id. Construct the event literal inline; do **not** import
`modalPrompts.test.ts`'s `shown(...)` builder across files.

Borrow one discipline from that builder (`modalPrompts.test.ts:20-24`): derive the `modalId` from the
conversation id without making it equal to it (`` `m-${id}` ``). Both fields are `string`, so only distinct
values can catch a code path that scans the wrong one.

### The marker

A fourth marker constant beside `:169-172`, the **full** class attribute value including the closing quote —
`class="conversation-status-dot conversation-status-dot--input-required"` — for the reason the block's
comment already gives: the base class never ships alone, so a prefix-with-quote form would match nothing, and
the full value pins base and modifier together. `ConversationStatusDot.test.tsx:17` already has this exact
string; restate it here rather than importing it, matching the file's three siblings.

### New cases, in the `#801` describe

Four scenarios. Each is chunk-scoped through the existing `chunkFor` helper, never document-scoped — the
file's `:228-231` comment explains why a document-scoped `toContain` passes no matter which row carries the
dot.

- **A waiting conversation's row draws the dot (AC1).** Seed a prompt for `d1` only. The
  `Help me debug auth flow` chunk carries the input-required marker; the other two chunks carry `--idle`;
  the whole-markup count of the input-required marker is 1 and of `STATUS_DOT_PREFIX` is still 3. The count
  pair is what says "one row, one dot, no extra element".
- **It outranks working and new messages on the same row (AC2).** Seed input-required **and** working **and**
  unread on `d1`. The chunk contains the input-required marker and contains **neither** `STATUS_DOT_WORKING`
  nor `STATUS_DOT_NEW_MESSAGES`. This is the case the ticket exists to make true and the one that catches the
  hazard below; the resolver's own suite pins the same rule one layer down, and restating it here is
  deliberate — this is where the four stores actually meet.
- **Three rows, three different statuses, one render (AC3).** Seed a prompt on `d1`, working on `c1`, unread
  on `d2`. Assert each chunk's own marker. A row with no outstanding prompt draws exactly what it drew
  before, and the fourth fact does not leak across rows — one render proves both, and neither is provable
  from a single-row fixture.
- **A conversation the operator has never opened (AC4).** Seed a prompt for `d2` and assert, as `:807-808`
  already does for the working case, that `d2` is absent from **both** the timeline and last-read stores
  before asserting its input-required dot. `ChannelListView` takes no active-conversation prop and this
  component has no open-conversation concept anywhere, so AC4 is structural; this case pins the observable
  half of it.

The eight existing cases in the describe need **no edit** and are AC3's standing regression guard — the modal
store starts empty, so every one of them resolves exactly as before.

### The one hazard `tsc` will not catch

`resolveConversationStatus(inputRequired, activity, unread)` has `boolean` in **both** the first and third
positions. A transposed call —

```ts
resolveConversationStatus(isConversationUnread(timeline, lastRead), activity, inputRequired)
```

— typechecks clean, builds clean, and passes the salvage gate. It fails the AC1 case (a prompt with nothing
unread resolves `new-messages`), the AC2 case, and the shipped unread case at `:812-822` (which now doubles
as the counterpart guard and still needs no edit). Name this in the PR alongside the mutation check below;
it is the only wrong answer this ticket can ship that a green typecheck would hide.

**Mutation check**, in the form the resolver's doc already uses: passing a literal `false` in first position
instead of `inputRequired` fails all four new cases and nothing else; transposing the first and third
arguments fails the AC1 and AC2 cases plus the shipped `:812-822` unread case, and nothing else.

### What is not covered, and must not be claimed as covered

**The amber itself.** Renderer specs are `renderToStaticMarkup` with no DOM and no CSSOM, so this tier proves
the subscription, the argument position, the resolved class token and the per-row scoping — never a computed
colour. The colour keeps exactly the standing #873 gave it: a CSS-level guarantee. Do not write an assertion
that appears to check it.

**Interaction.** Nothing in this repo can click; there is no case where a prompt arrives and a dot changes
mid-session at this tier, by construction. e2e coverage for this component stays at zero, as it has since
#800 — see Open question 2.

## Scope

| File | Change |
| --- | --- |
| `src/renderer/src/screens/channels/ChannelList.tsx` | one import, one subscription, one argument, five docstring counts |
| `src/renderer/src/screens/channels/ChannelList.test.tsx` | fourth mock, marker, seed helper, `afterEach` clear, four cases |

**One production `.tsx` file, one test file, no new files, no new exports, no signature change anywhere.**
`resolveConversationStatus` keeps its 11 call sites and `ConversationStatusDotControl` keeps its single one
(`ChannelList.tsx:819`, inside `Row`) — this ticket adds no consumer and changes no contract, so the edit
fan-out is zero. Projected total written work ~110 lines. Size **XS**, agreeing with PO.

No branch overlap: `git fetch origin --prune` on 2026-09-01, then a diff of all 19 `origin/feature/<n>`
branches against `main`, found no other in-flight branch touching either file.

## Open questions

1. **The dot drops for the length of a reconnect, and that is correct.** `reconnected` clears `outstanding`
   on every supervisor handshake (`modalPrompts.ts:202-220`), so during a relay gap every row's amber dot
   goes idle until the daemon's connect-time reconcile re-sends the still-outstanding prompts. That is the
   per-connection-truth ruling #415/#510 made deliberately, and it now becomes visible in the sidebar for the
   first time. Do not "fix" it here; if the flicker proves annoying in use, it is a ticket against the modal
   store's reconnect policy, not against this call site.
2. **e2e is now reachable for the first time and is still not a deliverable.** The fake tier could drive a
   modal frame and assert an amber dot on a named sidebar row, which no tier can do today. Worth filing if
   the operator wants it; explicitly out of scope here, and adding it would push this past XS.
3. **Row ordering is unchanged — #873's open question 2, now live.** The sidebar sorts by recency, not by
   status, so a conversation waiting on an answer can sit far down a long list where an amber dot is easy to
   miss. Out of scope for this ticket too; worth filing separately now that the dot actually lights.
