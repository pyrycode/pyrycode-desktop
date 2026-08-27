# 801 — draw a status dot on every chat and channel row

**Size:** S (confirmed, not overridden). Two production source files (`ChannelList.tsx`, `channels.css`),
one existing spec file extended (`ChannelList.test.tsx`). No new module, no new exported type, no consumer
cascade — `ConversationStatusDot` and `resolveConversationStatus` both ship with **zero** call sites and
this ticket is the first for each, so the edit fan-out is one render site.

## Files to read first

Codegraph is wired but **not indexed** for this repo (`.codegraph/` holds a config and no DB;
`codegraph_status` errors with "CodeGraph not initialized"), so this list was assembled by hand.

- `src/renderer/src/screens/channels/ChannelList.tsx:606-689` — `Row`, the render site. The whole
  production edit lands here plus one new sibling component above it.
- `src/renderer/src/screens/channels/ChannelList.tsx:303-375` — `HostConnectionDots` +
  `HostConnectionDotsControl`. **The shape to copy**: a presentational dot leaf, and a tiny store-bound
  `*Control` beside it that reads narrow selectors so a store write re-renders the dot and not the row.
  Its doc comment also records the honest cost of a store read inside the "pure" view.
- `src/renderer/src/screens/channels/ConversationStatusDot.tsx` — the leaf being wired. Read the header:
  it declares itself store-free, which is why the store-bound control does **not** go in that file.
- `src/renderer/src/store/conversationStatus.ts:56-118` — `resolveConversationStatus(activity, unread)`.
  Parameter order is precedence order; there is deliberately no `conversationId` parameter.
- `src/renderer/src/store/conversationUnread.ts:41-97` — `isConversationUnread(timeline, lastRead)`. The
  branch order is the contract; branch 2 (slice held, no mark ⇒ unread) is what makes a cheap test seed work.
- `src/renderer/src/store/conversationActivityStore.ts:98-102, 233-266` — the four setters (test seeding)
  and `selectActivityFor`.
- `src/renderer/src/store/conversationTimelineStore.ts:153-157, 377-413` — `dispatchFor` / `clearAllTimelines`
  and `selectTimelineFor`.
- `src/renderer/src/store/conversationLastReadStore.ts:246-257, 291-294, 413-451` — the `typeof window`
  guard that makes this store safe under `environment: 'node'`, `recordLastRead` / `clearAllLastRead`, and
  `selectLastReadFor`.
- `src/renderer/src/store/threadTimeline.ts:99-172` — the `ThreadEvent` union. `{ type: 'reconnected' }`
  (`:172`) is the zero-payload arm that mints a timeline slice without appending an item.
- `src/renderer/src/screens/channels/channels.css:192-223` — `.channel-list__row` / `__row-open` /
  `:hover` / `:focus-visible`. The two rules this ticket edits.
- `src/renderer/src/screens/channels/channels.css:798-867` — #800's shipped dot block. **Do not edit it**;
  the component owns its own geometry and colour. This ticket adds a call-site positioning rule only.
- `src/renderer/src/screens/channels/channels.css:488-501` — the `position: relative` parent +
  `position: absolute` child idiom already in this file.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:61-155` — the marker + tag-slicing idiom
  (`ROW_MARKER`, `ROW_OPEN_MARKER`, `DOT_TAG_PREFIX`, `hostDotTagsIn`). New assertions clone it.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx:262-285` — the repo's existing ruling on a
  named `role="img"` inside an interactive row: the informative state is labelled, the neutral state is
  `aria-hidden`. Load-bearing for the placement decision below.
- `docs/knowledge/features/conversation-status-dot.md:86-104` — #800's edge cases, including the two items
  explicitly handed forward to this ticket (the announced idle label; "measure the vertical alignment").
- `docs/knowledge/features/conversation-unread.md`, `docs/knowledge/features/conversation-activity-store.md`
  — the two upstream contracts in prose.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2968

The `Channel` row is a 340×24 flex row, `padding: 4px 16px`, `gap: 10px`, `align-items: flex-start`: a
6×14 `Status dot` instance leads at **x = 16**, the title follows at **x = 32** (body-small,
`--color-on-surface`). Page context is [node 102-4](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4).

**Vertical alignment, measured rather than inherited** (#800's code review handed this forward
explicitly). In the Figma frame the dot instance occupies y = 4…18 and its circle is at `cy = 11` inside
that 14px box, so the painted dot's centre sits at y = 15 in a 24px row whose centre is y = 12 — **3px
below centre**, and 3px below the title's own centre. That offset does **not** port: the shipped row is
not the design's 24px row (it carries `--space-3` vertical padding, a `--text-title-medium` title, and a
trailing `.channel-list__time` the desktop node does not have), so an absolute 3px drop measured against a
24px frame lands somewhere arbitrary in a ~44px row. **Centre the dot on the row**, and record the
measurement and this reasoning in the CSS comment so the next reader does not re-open it. Converging the
row's full geometry on node 103-2968 (row height, title type scale, dropping the time) is a separate pass
and is not this ticket.

## Context

`ConversationStatusDot` (#800) and `resolveConversationStatus` (#799) both shipped dormant. This ticket is
the first consumer of each, and it answers the question `conversationUnread.ts` deliberately left open:
**where the two-store unread composition lives**. Answer: at the row, in a per-row leaf component, keyed
by the row's own conversation id.

## Design

### Placement: the dot is a SIBLING of `.channel-list__row-open`, not a child of it

This is the ticket's named open choice. **Picked: sibling — the first child of `.channel-list__row`.**

Why, on the a11y reading:

- `ConversationStatusDot` labels **all three** states, idle included (`STATUS_LABELS`,
  `ConversationStatusDot.tsx:32-36`, pinned by its own unit spec across `ALL_STATUSES`). Nesting it inside
  the row's `<button>` folds that label into the button's accessible name — so the *common* row would
  announce "Idle, kitchenclaw refactor, 3h ago, button", and the button's name would mutate as the daemon
  works. A control's accessible name should say what activating it does, and stay put.
- The repo has already ruled on this exact shape once. `RunConfigSections.tsx:270-280` puts a named
  `role="img"` inside an interactive row for the *selected* model and makes the neutral siblings
  `aria-hidden` — precisely to keep the neutral state out of the control's name. Nesting here would ship
  the noise that precedent avoids, and the only way to avoid it while nesting is to change #800's shipped
  contract, which is out of scope (see Open questions).
- As a sibling the dot stays fully exposed — `role="img"` with its label is announced in reading order —
  while the row button's name stays `title + time`, exactly as it is today.

Why the geometry works out (the ticket's counter-argument to the sibling option, resolved):

- Placing the dot in the row's **flex flow** would push the `<button>`'s left edge to x≈22, so the
  `:hover` / `:focus-visible` fill would stop short of the row's leading edge and leave a visible notch
  around the dot. That is the real cost of the naive sibling, and it is why the dot is **positioned**
  instead of laid out in flow.
- Absolutely positioning the dot at the row's 16px inset and widening the button's own left padding to
  32px reaches **both** Figma x-values exactly, keeps the button spanning the full row (hover and focus
  rectangles unchanged), and keeps the dot out of the button's subtree.

Locator safety, both directions (AC4): `.channel-list__row` and `.channel-list__row-open` keep their exact
class strings and their ancestry; the dot is an **added leading child** of the row wrapper, which
`ChannelList.tsx:481` and `:545` already establish as the permitted kind of change. `conversation-status-dot`
shares no substring with any `channel-list__*` token (#800 already checked this against
`launchPairedApp.ts:224`'s unfiltered `.channel-list__row-open` and the 28 specs riding it), and the dot
emits **no text node**, so every `hasText`-filtered `.channel-list__row` locator in `e2e/` is unaffected.
`ChannelList.test.tsx:72`'s exact `class="channel-list__row-open"` still matches — the button's class token
stays sole.

### The composition site

Add one module-private component to `ChannelList.tsx`, directly above `Row`, mirroring
`HostConnectionDotsControl`'s position relative to `HostConnectionDots`:

```tsx
function ConversationStatusDotControl({ conversationId }: { conversationId: string }): JSX.Element
```

Behaviour, in one sentence: read the three narrow per-id slices, reduce them to one status, render the
dot. Contract sketch — three subscriptions, then two pure calls, then the leaf:

- `useConversationActivityStore(selectActivityFor(conversationId))` → `ConversationActivityEntry | null`
- `useConversationTimelineStore(selectTimelineFor(conversationId))` → `TimelineState | null`
- `useConversationLastReadStore(selectLastReadFor(conversationId))` → `LastReadMark | null`
- `resolveConversationStatus(activity, isConversationUnread(timeline, lastRead))` → `ConversationStatus`
- returns `<ConversationStatusDot status={…} />` and nothing else — no wrapper element.

Not exported. The unit tier reaches all three statuses by seeding the singletons (which AC2 requires
anyway — see Testing strategy), so an exported pure seam would be an unread read surface, the rule
`backgroundTaskRosterStore.ts:418-420` states and both upstream modules already follow.

Five things this component must not become, none of them a type error:

- **The subscriptions must not be merged into one selector returning an object.** The three shipped
  selectors each hand back a *held* reference or `null`, which is what keeps `useSyncExternalStore` stable;
  a selector building `{ activity, timeline, lastRead }` returns a fresh object every call and loops.
- **`isConversationUnread` / `resolveConversationStatus` are called on the selector RESULTS, never inside a
  selector.** Same reason, plus it keeps both pure modules out of the store's read path.
- **No `useMemo`, no combined snapshot.** `conversationUnread.ts:78-84` rules explicitly that reading two
  stores back-to-back in a single-threaded renderer is not a torn read, and that #801 must not build a
  merged snapshot. Two function calls per row per render is not a cost to design around.
- **No `conversationId` anywhere but the three selector factories.** The id is daemon-asserted. It stays a
  `Map` key: never a class-name interpolation, never an attribute value, never a `title`, never an object
  key, never a log line. This is the condition both upstream headers state as part of their own signatures.
- **No `console.*` on any path.** Both source stores and both pure modules are log-free by construction;
  there is no read miss to report, since `null` is a defined reading.

### The render site

`Row` (`ChannelList.tsx:622-689`) gains exactly one line: `<ConversationStatusDotControl conversationId={row.id} />`
as the **first child** of `.channel-list__row`, ahead of the `<button>`. Nothing else in `Row` changes —
`onOpen`, `onRename`, `onSaveAsChannel`, the title and the time are untouched. Both trees render through
this one component, so Channels and Chats are covered by the single edit, in every workspace group, in
both `renderBody` map sites (`:558`, `:589`) — where hooks cannot be called, which is why the subscriptions
live in the per-row component and not in the callbacks.

The dot is unconditional: every row draws exactly one, idle included (AC1).

### CSS (three small edits in `channels.css`, all at the call site)

`.conversation-status-dot`'s own block (`:798-867`) is #800's and stays untouched — it owns the 6px box,
the ring and the blink. This ticket adds only where the dot sits:

```css
.channel-list__row { position: relative; }              /* added to the existing rule */

.channel-list__row > .conversation-status-dot {
  position: absolute;
  left: var(--space-4);                                  /* 16px — the design's leading inset */
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;                                  /* the 6px box must not shadow the open button */
}

/* the existing shorthand, left value only: var(--space-3) var(--space-4) var(--space-3) var(--space-8) */
```

Three notes the comment should carry: the dot is taken out of flow so the `<button>` keeps spanning the
row and its hover/focus rectangles are unchanged; `pointer-events: none` is what keeps a click on the dot
opening the conversation (it does not affect the accessibility tree); and `--space-8` (32px) is the
design's title inset, which the dot's absolute box no longer reserves.

## State + concurrency model

No new state, no new store, no store write, no IPC, no wire traffic, no async work — this ticket is a
**read composition** only. Three existing singletons are subscribed per row through their shipped
per-id selector factories.

Re-render seam: `conversationActivityStore`'s write path keeps every other conversation's held entry
referentially identical, and all three selectors return the held reference (or `null`), so a write for
conversation A wakes only A's dot. Because the subscriptions sit in `ConversationStatusDotControl` rather
than in `Row`, a status flip re-renders one `<span>` and not the row's title, time or icon buttons. The
blink is compositor-owned, so a working dot costs zero React renders.

Liveness is inherited, not built here: the green dot rides `isConversationUnread`'s `items.length`
criterion, which moves on content arrival; `ConversationSummary.last_message_ts` does not and must not be
consulted (`conversationUnread.ts:12-18`).

Honest cost, to be recorded in the control's doc comment: `ChannelListView` drifts a little further from
its "pure view" docstring, since its subtree now reads three more singletons. This is the same posture
`HostConnectionDotsControl` (`ChannelList.tsx:353-364`) already took and documented, and it is safe under
`renderToStaticMarkup` in Node — the activity and timeline stores hydrate to empty maps, and the last-read
store's `localStorage` port short-circuits on `typeof window === 'undefined'`
(`conversationLastReadStore.ts:246-257`), so every unseeded row resolves to `idle`.

## Error handling

There is no failure mode to surface. Every input is a defined reading: an absent key in any of the three
maps is `null`, `isConversationUnread` and `resolveConversationStatus` are both total with no throw path,
and `ConversationStatusDot` is a pure function of a closed three-value union. No result type, no error
branch, no banner, no dialog, no log line. An unknown or hostile id resolves to three `null`s and an idle
dot — an explicit no-match that can never land on a neighbour's entry, which is exactly why the id-to-entry
lookup was pushed into the selector factories.

## Testing strategy

All new coverage goes in the existing `src/renderer/src/screens/channels/ChannelList.test.tsx` — no new
spec file. Static `renderToStaticMarkup` renders under `environment: 'node'`, asserting on emitted markup,
per the repo's renderer-test rule.

Fixture mechanics (this file is the first to seed these singletons, so state the mechanics once at the
top of the new `describe`):

- **working** — `conversationActivityStore.getState().setTurnRunning(id, true)`.
- **new messages** — `conversationTimelineStore.getState().dispatchFor(id, { type: 'reconnected' })` mints
  a slice with no mark, which is `isConversationUnread` branch 2 (`conversationUnread.ts:59-60`,
  `:63-71`). Cheapest honest seed; no item append needed.
- **read** — the seed above plus `recordLastRead(id, 0)` on `conversationLastReadStore`.
- **idle** — seed nothing.
- **`afterEach` must clear all three** (`clearAllActivity`, `clearAllTimelines`, `clearAllLastRead`).
  These are module-level singletons shared by every `it` in the file; without the reset a seed from one
  case silently colours a later case's render. This is the one real trap in the new suite.

Markers, cloning the file's exact-attribute-value idiom (`ChannelList.test.tsx:86-98`, `:139`): the dot
always wears two class tokens, so pin the **full** value per status
(`class="conversation-status-dot conversation-status-dot--working"` and its two siblings) and keep a
`class="conversation-status-dot ` prefix, trailing space included, for counting dots regardless of status.
Add a per-row slicer: split the markup on `ROW_MARKER` so each chunk is one row, and pick the chunk by the
title it contains — every per-row assertion below is chunk-scoped, not document-scoped.

Scenarios:

- **One dot per row, both trees (AC1).** A fixture with promoted and unpromoted rows across two workspaces:
  the dot count equals the `ROW_MARKER` count, and every row chunk holds exactly one.
- **The dot leads the row (AC1).** In each row chunk the dot's index is below the `.channel-list__title`
  index.
- **The dot is a sibling, not a child of the open button (the placement decision).** In each row chunk the
  dot's index is below `ROW_OPEN_MARKER`'s — so a later edit that nests it fails here rather than silently
  changing every row button's accessible name.
- **Each row resolves from its OWN id (AC2).** Three rows, activity seeded for the middle one only: that
  row's chunk carries `--working`, the other two carry `--idle`. This is the assertion the whole ticket
  exists for; it must render more than one row.
- **A row the operator has never opened still shows working (AC2).** Same shape, with the seeded id absent
  from both the timeline and last-read stores — no "open conversation" concept is involved anywhere.
- **The unread input is the shipped predicate (AC3).** A row with a seeded timeline slice and no mark
  renders `--new-messages`; recording a mark that covers the slice flips the same row to `--idle`.
- **Precedence holds at the call site (AC3).** A row seeded as both working and unread renders `--working`.
  A literal argument swap is a type error, so what this catches is the composition going wrong in a way
  `tsc` cannot see: a locally re-derived status, a hand-rolled unread boolean, or `working` and
  `new-messages` traded by an over-clever branch. It is the resolver's own most-missed assertion
  (`conversationStatus.ts:72-73`), and it is worth restating once at the call site.
- **AC4 regression guard.** The existing `ROW_MARKER` / `ROW_OPEN_MARKER` counts, the Rename and
  Save-as-channel markers and the host/workspace-row assertions all keep their current expected values —
  no existing case in the file should need editing. If one does, the structure changed more than it should
  have.

`npm run typecheck` covers the `ConversationStatus` union's exhaustiveness end to end; `npm run build` and
`npm test` are the gates.

## Out of scope

- **The reduced-motion e2e spec**, per the ticket body — `channels.css:862` hands it forward, but a
  per-component clone of `e2e/composer-status-reduced-motion.spec.ts` is a separate concern. File it
  separately if wanted.
- **Any other e2e spec.** All four ACs are statically assertable in the unit tier with seeded stores, and
  the live path that feeds the activity store for a non-open conversation is #748's shipped coverage, not
  this ticket's.
- **The archive screen's rows** (per the ticket) — they use their own class names, and nothing in this
  ticket reaches them. Note that widening `.channel-list__row-open`'s left padding is sidebar-only:
  `channel-list__row*` appears in `ChannelList.tsx` alone.
- **The row's remaining geometric convergence on node 103-2968** — 24px height, body-small title, dropping
  the trailing time, the 10px gap. See Design source.
- **`ConversationStatusDot`, `conversationStatus.ts`, `conversationUnread.ts` and the three stores.** All
  five are consumed exactly as shipped; none is edited. In particular, do not add a `conversationId`
  parameter to either pure module.

## Open questions

1. **Should the idle dot's label be suppressed?** #800's feature doc flags it for the operator: with one
   dot per row, a long sidebar announces "Idle" once per conversation. This ticket ships it as specified
   (the ACs are silent, and #800's spec decided it deliberately). If the operator does want suppression,
   the cheap and correct place is inside `ConversationStatusDot` — `aria-hidden` on the idle branch,
   changing one component and its unit spec — **not** a conditional wrapper at this call site. Out of scope
   here; file it if wanted.
2. **`#802`'s fourth status (input required)** inserts above `working` in the resolver. Nothing in this
   ticket needs to anticipate it: the control passes whatever the resolver returns straight through, and
   `STATUS_LABELS`' `Record` makes the new member a typecheck failure at the leaf rather than a silent gap.
