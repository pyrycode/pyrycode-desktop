# Channel List — the row's status dot

Split out of [Channel List home screen](channel-list.md) to keep that document under the doc-guard's
50000-byte cap (`npm run check:docs`) — a pure size move, no content change. This page covers the
`ChannelList.tsx` section on the per-row status dot; everything else about the screen (the view-model, the
host row, workspace grouping, CSS) stays on the parent page.

## The row's status dot (`ChannelList.tsx`, added by #801, wired to `input-required` by #874)

Split from #676, the last of the three ([#799](conversation-status.md)'s resolver,
[#800](conversation-status-dot.md)'s leaf, and this ticket's wiring). A module-private, nullary-prop-free
`ConversationStatusDotControl({ row })` derives `conversationId` from the actual row and composes
its received read fields with five narrow per-id subscriptions —
`useModalStore(selectHasOutstandingFor(id))`,
`useQuestionBatchStore((s) => selectBatchFor(id)(s) !== undefined)`,
`useConversationActivityStore(selectActivityFor(id))`, `useConversationTimelineStore(selectTimelineFor(id))`,
`useConversationLastReadStore(selectLastReadFor(id))` — reduced through
[`isConversationUnread`](conversation-unread.md) then [`resolveConversationStatus`](conversation-status.md)
and handed straight to `ConversationStatusDot`. It renders as `Row`'s **first child**, ahead of the
`.channel-list__row-open` button, in both `renderBody` map sites (`:558`, `:589`) — so both trees, every
workspace group, get exactly one unconditional dot, idle included.

With both daemon fields, `isConversationUnread(timeline, lastRead, row)` compares
`latest_entry_id > read_up_to` even without a held timeline. Passing the actual host-stamped row
keeps equal IDs on different hosts independent; an ID-only lookup could silently select the other
host's read state. A received read advance clears that row's green dot before any refresh reply,
while local opening/timeline stamps are suppressed. Incomplete rows keep the local-count fallback.
Permission/trust prompts and pending questions still take precedence, followed by working, new
messages and idle. Archived rows remain outside the active sidebar; muting affects badge and
notifications, not this dot. No geometry, colour or animation changes accompany received read state.

[#873](https://github.com/pyrycode/pyrycode-desktop/issues/873) added
[`resolveConversationStatus`](conversation-status.md)'s leading `inputRequired` parameter, landing
correct-but-unreachable behind a literal `false` at this call site.
[#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) closed that seam: a fourth per-id
subscription, `useModalStore(selectHasOutstandingFor(conversationId))` imported from `modalStore` (the
`selectHasOutstandingFor` re-export site, `modalStore.ts:45` — `PermissionModal.tsx:192-194` is the shipped
precedent for taking the read surface from that one site rather than from `modalPrompts` directly), replaces
the literal. `selectHasOutstandingFor` is total and answers an unseen id `false`
([modal-prompt model](modal-prompt-model.md)), so it needs no memoization: it returns a plain `boolean`,
`Object.is`-stable by value, and the merged-selector ban the three original subscriptions justify by
held-reference stability does not transfer to it — the header now records that the ban holds for this
fourth read too, but for a different reason (a merged object would be freshly allocated regardless of what
its fields are). No change to `Row`, to `resolveConversationStatus`, or to `ConversationStatusDot` — the
join is entirely inside this control.

The fifth subscription reads [question-batch state](question-batch-model.md). `inputRequired` is true
when either an outstanding permission or trust prompt or a pending question batch belongs to this row
([#1700](https://github.com/pyrycode/pyrycode-desktop/issues/1700)). A question alone therefore draws the
gold waiting dot, even during a running turn. The question selector returns batch presence as
a boolean, keeping its result `Object.is`-stable when batch content changes and keeping question text
out of the row component. Answer and Cancel both dispatch `dismissed`, removing that batch; once no
prompt or batch remains, the resolver falls back to working, new messages or idle from the other facts.

The [leaf's paint contract](conversation-status-dot.md) uses a dot-only gold token for input required,
solid primary blue for working and solid success green for new messages. Only idle has a ring, at
opacity 0.5 with a transparent centre even on hovered/open rows. Paint does not alter the five-source
status resolution or the centred 6px geometry.

**The one wrong answer a green typecheck hides.** `resolveConversationStatus(inputRequired, activity,
unread)` takes `boolean` in both first and third position, so a call transposing them —
`resolveConversationStatus(isConversationUnread(...), activity, inputRequired)` — typechecks and builds
clean. A precedence test that seeds input-required, working, and unread all on the *same* row cannot catch
this: the transposed call reads that row's own `unread === true` in first position and still resolves
`input-required`, for the wrong reason. The test gives each rival its own row instead — the row holding
input-required against working with nothing else unread is the one a transposition actually mis-resolves.
Worth remembering wherever a resolver's precedence order and its parameter order are the same list.

**Test teardown trap: the modal store's clear must be `reconnected`, never `dismissed` per seeded prompt.**
`dismissed` moves the id onto the `resolved` slice, and the `shown` arm treats a seen-then-resolved id as a
no-op rather than an append ([modal-prompt model](modal-prompt-model.md)). A `dismissed`-based `afterEach`
therefore leaves a later test's seed silently doing nothing, and that test renders `--idle` while asserting
`--input-required` — a failure that reads as a bug in the wiring rather than in the test's own teardown.
`reconnected` clears `outstanding` and `resolved` together and is the only teardown that returns the store to
its initial state.

This is also the answer to the question [`conversationUnread.ts`](conversation-unread.md) deliberately left
open — **where unread composition lives.** It lives here, using the actual row and that row's own
conversation id for local selectors, so a chat the operator has never opened still shows its
working or unread state correctly.

**Placement — a sibling of the open button, not a child of it.** `ConversationStatusDot` ships a named
`role="img" aria-label` on all four statuses, idle included, so nesting the dot inside
`.channel-list__row-open` would fold "Idle" (and, live, "Assistant working") into the button's own
accessible name, mutating it as the daemon works. `RunConfigSections.tsx:270-280` already declined exactly
this shape for the run-config sheet's unselected radios — a named `role="img"` stays a sibling of an
interactive row, not nested in it. As a sibling the dot is announced in reading order and the button's
name stays the row's title — since [#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097)
deleted the trailing time, that is the button's whole text, where it used to read title + time.

The geometry cost of that choice is real and is paid in CSS, not layout: in the row's ordinary flex flow
the dot would push the button's left edge to x≈22, notching the `:hover`/`:focus-visible` fill short of the
row's leading edge. `channels.css` instead takes the dot **out of flow** —
`.channel-list__row { position: relative }` plus `.channel-list__row > .conversation-status-dot { position:
absolute; left: var(--space-4); top: 50%; transform: translateY(-50%); pointer-events: none }` — landing
both of the Figma's x-values (16px dot, 32px title) exactly while the button keeps spanning the full row and
its hover/focus rectangles unchanged. `.channel-list__row-open`'s own left padding widened from `--space-4`
to `--space-8` to reserve the 32px the dot no longer claims in flow (sidebar-only: `channel-list__row*`
appears in this file alone, so the archive screen's rows are untouched). `pointer-events: none` is what
keeps a click on the dot's box opening the conversation rather than being swallowed by it; it has no effect
on the accessibility tree, so the dot's `role="img"` label is still announced.

Making `.channel-list__row` a positioned element was checked for blast radius rather than assumed
harmless: at the time, it moved the row into the positioned-descendants paint layer, where the two sticky
top-right siblings (`.channel-list__actions`, `.channel-list__fab`) won on document order alone — both
already carried `z-index: 1`, so rows still painted under them, and no fixed-position element rendered
inside a row. No regression, but worth recording since it was the one edit here whose cost wasn't local
to the row itself. **Both siblings are gone since**: the FAB was deleted in
[#1426](https://github.com/pyrycode/pyrycode-desktop/issues/1426), and
[#1443](https://github.com/pyrycode/pyrycode-desktop/issues/1443) moved `.channel-list__actions` into the
card's own Top bar, outside `.channel-list__tree` entirely — it no longer shares a scroller or a
stacking-context slot with a row at all, so this concern has no live sibling to apply to any more.

**Vertical alignment is a measurement, not an inheritance — and it doesn't work the way this file's own
prior reasoning for `.channel-list__host-dot` claimed.** The Figma frame's `Status dot` instance sits a few
pixels below the `Channel` row title's own centre (`cy` at row-relative y=15 in a 24px frame whose centre is
y=12). At the time #801 shipped this, porting that 3px offset onto the row would have been meaningless
anyway, since the shipped row wasn't yet the design's 24px frame — it carried its own vertical padding, a
larger title type scale, and a trailing `.channel-list__time` the design node has no equivalent for — so
\#801 centred the dot (`top: 50%; transform: translateY(-50%)`) and deferred the question to the pass that
would converge the row's full geometry.

[#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097) is that pass (see
[the row's desktop geometry](channel-list-desktop-row-geometry.md)), and it **settles** the question
rather than re-deferring it: the row is now the design's
24px frame, so the excuse for not measuring expired. Measured directly, the 3px drop is an artifact of the
Figma component's own 14px-tall, 6px-wide dot *wrapper* — its painted circle sits at `cy=11` inside that
wrapper, landing at y=15 in a 24px row whose centre is y=12. The app draws a bare 6px dot with no such
wrapper, so porting the offset would copy the wrapper's internal padding without the wrapper itself. The dot
stays centred, and the CSS comment records this as a ruling rather than a deferral — cheap to flip later
(one `top` value) if the drawn offset turns out to be wanted. [The dot's own
doc](conversation-status-dot.md#edge-cases-and-limitations) records the matching correction: its "no
wrapper needed to centre a 6px dot against the row's line box" claim, written for
`.channel-list__host-dot`, does not hold for this node's Figma metadata and did not transfer here.

**Testing: two traps in wiring a store into a `renderToStaticMarkup` component, not specific to this
ticket.** Both surfaced while extending `ChannelList.test.tsx` and apply to any future row that reads a
Zustand store under this repo's `environment: 'node'` renderer tier:

- **Seeding a store singleton's setter is invisible to the render.** React's server renderer resolves
  `useSyncExternalStore` through `getServerSnapshot()` and never subscribes, and Zustand v5 wires that
  argument to `api.getInitialState()` — the snapshot captured at the store's **module-load** creation, which
  no setter ever moves. Calling `conversationActivityStore.getState().setTurnRunning(id, true)` before
  rendering therefore renders as if nothing were seeded; the naive "seed the singleton, then
  `renderToStaticMarkup`" fixture shape (the one the architecture spec itself proposed) passes green while
  asserting nothing. The fix is a `vi.mock` per test file that redirects only the five `useXStore` **React
  bindings** onto a fresh per-file `createXStore()` instance, keeping `...importActual` for everything else
  — the selectors, the predicate, the resolver — so the real logic under test stays real and only the
  binding that `renderToStaticMarkup` can't see gets swapped.
- **An `indexOf`-based ordering assertion passes vacuously when the needle is absent**, since `-1` compares
  less than every real index. "The dot leads the row" cases must pin presence (`indexOf !== -1`) before
  they pin ordering, or a row that draws no dot at all reads as a passing test.

The question-only case seeds `createQuestionBatchStore()` through the same binding redirect, then
checks that only the matching row is input-required and that dismissal restores its working dot.
Teardown dispatches `reconnected` to clear all held batches. These fresh static renders prove status
composition, not live React subscription behavior.

The original wiring's four ACs are statically assertable in the unit tier with seeded stores (a per-row
chunk sliced out of the markup by title, mirroring the file's existing `ROW_MARKER`/`ROW_OPEN_MARKER`
slicing idiom), and the live path that feeds the activity store for a non-open conversation is #748's
shipped coverage. Paint requires browser checks: `e2e/sidebar-status-dot-fills.spec.ts` covers all four
paints, working-only animation and reduced motion; `e2e/sidebar-row-geometry.spec.ts` verifies that idle
stays an unfilled half-opacity ring on real resting, open and hovered rows.

**Every idle row's status dot is still announced.** Since [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801)
wired the [status dot](conversation-status-dot.md) into every row, a long sidebar of mostly-idle
conversations announces "Idle" once per row (`role="img" aria-label="Idle"` ships on all four
statuses). Built exactly as #799/#800/#801's specs intend and confirmed in #801's code review;
the cheap fix, if wanted, is `aria-hidden` on the dot's idle branch — a change to
`ConversationStatusDot` alone, not a conditional wrapper here. Not filed as a follow-up ticket yet.

## Related

- [Channel List home screen](channel-list.md) — the parent page: the view-model, the host row, workspace
  grouping, and the CSS this section's classes live in.
- [Conversation status dot](conversation-status-dot.md) / [#800](https://github.com/pyrycode/pyrycode-desktop/issues/800)
  — the presentational leaf every row leads with; see § above for the #801/#874 call site.
- [Conversation status resolver](conversation-status.md) / [#799](https://github.com/pyrycode/pyrycode-desktop/issues/799)
  — the pure join `ConversationStatusDotControl` calls after composing the five per-id store reads;
  [#873](https://github.com/pyrycode/pyrycode-desktop/issues/873) added its leading `inputRequired`
  parameter.
- [Conversation unread predicate](conversation-unread.md) / [#778](https://github.com/pyrycode/pyrycode-desktop/pull/795)
  — composed at the row alongside the resolver above; #801 is the ticket that finally answers where this
  composition lives.
- [Conversation activity store](conversation-activity-store.md) / [#747](../codebase/747.md) and
  [conversation timeline holder](conversation-timeline-holder.md) / [conversation last-read
  store](conversation-last-read-store.md) — three of the five per-id stores `ConversationStatusDotControl`
  subscribes to through their shipped selector factories.
- [Modal-prompt model](modal-prompt-model.md) and [modal store bridge](modal-store-bridge.md) — the
  reducer and store `selectHasOutstandingFor(conversationId)` is defined on, re-exported from
  `modalStore.ts` and read as the fourth per-id subscription by
  [#874](https://github.com/pyrycode/pyrycode-desktop/issues/874).
- [Question-batch model](question-batch-model.md) — the fifth per-id source; `selectBatchFor` is
  re-exported from `questionBatchStore.ts` and reduced to a presence boolean for the row.
- [App icon attention badge](app-badge.md) / [#1592](https://github.com/pyrycode/pyrycode-desktop/issues/1592)
  — a second consumer of the same five-source status composition, counting each eligible conversation
  once even when both a prompt and question batch are pending.
- [#801 spec](../../specs/architecture/801-sidebar-row-status-dot.md) — the row's status dot.
- [#874 spec](../../specs/architecture/874-input-required-dot-call-site.md) — the fourth subscription that
  composes the input-required status into it.
- [the row's desktop geometry](channel-list-desktop-row-geometry.md) — [#1097 spec](../../specs/architecture/1097-desktop-24px-sidebar-row.md)'s
  convergence on the desktop 24px node, including the dot's settled centring.
- Deferred: a possible follow-up to suppress the idle dot's announced label (see above).
