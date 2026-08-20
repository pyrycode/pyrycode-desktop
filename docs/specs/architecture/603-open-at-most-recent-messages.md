# #603 — open a discussion at the most recent messages

**Size:** S (held from PO). One test added to an existing e2e file; production code expected to be **zero**.
The `s` label is held rather than dropped to `xs` only because AC5's contingency — if the proof fails, the
fix lands inside `useThreadScrollPin` — has to fit inside the same ticket.

**Security-sensitive:** no (`security-sensitive` label absent → §3 security-review pass skipped).

---

## Files to read first

Codegraph is **not indexed for this worktree** (`.codegraph/` carries `config.json` only; every
`codegraph_*` call returns *"CodeGraph not initialized for this project"*). This list was assembled by
reading, and every line number below was re-verified against `main` at `1afd425` — the ticket body's
anchors predate the #602 and #607 merges and have all shifted.

| Path | What to extract |
|---|---|
| `e2e/thread-scroll-pin.spec.ts` (whole file, 363 lines) | The file this ticket appends one test to. Every helper the new test needs is already here: `primeOverflowingThread` (`:203`), `readThreadMetrics` (`:184`), `expectPinnedToBottom` (`:224`), `settleScrollEvent` (`:236`), `toolUseFrame` (`:105`), `buildReplyFrames` (`:160`), `REPLY_TURNS` (`:64`), `replyText` (`:65`). Test 3 (`:313-363`) is the closest structural sibling — copy its shape, not its content. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:157-161` | The comment this ticket converts from claim to proof: *"it must not survive a remount (ADR 0006), so a re-entered thread starts pinned again"*. `:161` is the hook call. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:345-399` | `useThreadScrollPin`. `:347` is `const following = useRef(true)` — the **mutation target** for AC4. `:361-366` is the dep-free layout effect that does the pinning. This is also the only seam AC5's contingency fix could touch. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:442-454` | `Timeline`. `:451` returns `<EmptyThread />` at zero items; `:454` is the `.conversation__thread` scroll node. Confirms the scroll container mounts on the *first* render after re-entry, because the rows are already in the store. |
| `src/renderer/src/PairedShell.tsx:87-97, 156-162` | Why Back unmounts the screen: `PairedShellView` returns `ChannelList` where it returned `ConversationScreen`, at the same position — a different component type, so React destroys the subtree. `:156-159` is the row-open → `activateConversation` → `dispatch({type:'open'})` path; `:162` is `onBack`. |
| `src/renderer/src/activateConversation.ts:68-80` | The id gate. `previous?.id !== conversation.id` is the *only* thing that resets the timeline, so re-opening the **same** row keeps every row. |
| `src/renderer/src/App.tsx:60` | `useTimelineBridge()` mounts at the app root, not inside the screen — the store keeps receiving daemon frames while the operator is on the channel list. Nothing in the leave/return path can drop rows. |
| `src/renderer/src/screens/conversation/threadScrollPosition.ts:43-64` | `AT_BOTTOM_TOLERANCE_PX = 4` and `isAtBottom`. The new test imports the constant (the file already does, `:4`) and never hardcodes 4. |
| `e2e/fixtures/launchPairedApp.ts:63-71, 231` | `SEEDED_ROW` (`id: 'seed-conversation'`) and the `.channel-list__row-open` click that the re-entry leg repeats. |
| `e2e/paired-shell-navigation.spec.ts:38-39, 49` | The three selectors the new leg borrows: `.conversation` for the thread root, `section[aria-label="Conversations"]` for the list, `.conversation__back` for Back. |
| `src/renderer/src/store/threadTimeline.ts:314` | `turn_end` appends a `turnBoundary` item. This is why the last assistant bubble carries no streaming cursor after the primer (`ConversationScreen.tsx:465` gates the cursor on `index === lastIndex`), and why the exact-text assertion stays valid after re-entry. |
| `vitest.config.ts:27` | `environment: 'node'` — no DOM, no layout. The reason this proof can only live in e2e. |

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The Conversation Thread Screen (`16:8`): a column of top app bar → scrolling message list (`16:21`) →
status row (`16:57`) → composer (`16:61`). The frame depicts the list resting at its live end — the last
bubble (`16:56`) is clipped mid-sentence at the bottom edge, which is precisely the state this ticket
proves the app returns to. **No visual treatment changes in this ticket**; the node is a layout reference
only, and the developer needs no token work. Code-review's visual-fidelity check has nothing to compare.

---

## Context

The ticket's original premise ("opening a conversation shows the top of the history") does not hold: this
app has no history backfill, so opening a *different* discussion always starts from an empty timeline.
PO rewrote the body around the one reachable form — **re-entry** — and that rewrite is correct. I
re-verified all three of its load-bearing claims independently:

1. **The rows survive the round trip.** Back dispatches `back` (`PairedShell.tsx:162`) and touches no
   store. `activateConversation` resets the timeline only when the active conversation *id* changes
   (`activateConversation.ts:74-77`), and re-opening the seeded row carries the same
   `id: 'seed-conversation'`. `type: 'reset'` is dispatched from exactly two production sites —
   `activateConversation.ts:75` and `clearPairingScopedState.ts:92` (unpair / pair-another) — and neither
   is on this path.
2. **The screen genuinely unmounts.** `PairedShellView` returns a different component type at the same
   position (`PairedShell.tsx:88-97`), so React destroys the subtree: the `following` ref is discarded and
   the `.conversation__thread` node is rebuilt with `scrollTop = 0`.
3. **The fresh screen pins before paint.** `following` starts `true` (`:347`); the dep-free layout effect
   (`:361-366`) runs after the mounting commit and before paint, and the scroll node exists on that very
   first render because `items.length > 0` (`Timeline`, `:451`).

So the guarantee holds today, as an emergent product of three independent choices. The deliverable is the
proof. **No production change is expected.**

---

## Design

### One test, appended to `e2e/thread-scroll-pin.spec.ts`

No new file, no new helper, no new fixture. The file already declares every primitive; the new test is the
fourth in the file and reuses `buildReplyFrames`, so the daemon scripting is unchanged.

Suggested title, matching the file's sentence-shaped naming:

> `'re-opening a discussion lands at the most recent messages and leaves the thread pinned'`

### The drive, as ordered scenario steps

Each step's *reason* is what the developer should carry into the code comments; the code itself is the
file's existing idiom.

1. **Launch** with the scripted `buildReplyFrames` — `launchPairedApp({ buildReplyFrames })`, as all three
   siblings do.
2. **Prime** via `primeOverflowingThread(page)`. This is the shared overflow gate: it streams
   `REPLY_TURNS` assistant bubbles and asserts `scrollHeight > clientHeight` before anything is measured.
3. **Park at the top** — assign `scrollTop = 0` on `.conversation__thread`, then `await
   settleScrollEvent(page)`. The settle is **not optional and the hazard direction matters**: it is the
   same inversion test 3 documents at `:320-325`. Without it the queued scroll event has not yet cleared
   `following`, so a broken app (one whose flag survived the remount) would still land at the bottom and
   the test would pass vacuously.
4. **Guard the precondition** — assert `readThreadMetrics(page).scrollTop === 0`. Without it the test
   cannot distinguish "re-entry pulled the view down" from "the view was never up".
5. **Leave** — click `.conversation__back`, then await `section[aria-label="Conversations"]` visible. The
   list assertion is the unmount gate: the thread's DOM node is gone once the list is on screen.
6. **Re-enter the same row** — click `.channel-list__row-open`, then await `.conversation` visible. One
   seeded row means the bare selector stays unambiguous, and `setConversations` replaces rather than
   appends (`conversationListStore.ts:48`), so a re-fired `list_conversations` cannot duplicate it.
7. **Assert the rows survived, and are the recent ones** — `toHaveCount(REPLY_TURNS)` on
   `.bubble[data-thread-role="assistant"]`, and `toHaveText(replyText(REPLY_TURNS))` on `.last()`. The
   count is the "same conversation, no reset" claim; the text is the *"most recent messages"* claim in the
   user story. The exact-text form is safe here because `turn_end` appended a `turnBoundary`
   (`threadTimeline.ts:314`), so the trailing streaming cursor is not on that bubble — the same reason the
   primer's own exact-text gate works at `:209`.
8. **Assert non-vacuity, then the bottom** — re-read `readThreadMetrics` and assert
   `scrollHeight > clientHeight` **on the re-entered thread specifically** (AC2 asks for this on re-entry,
   not merely in the primer), then `expectPinnedToBottom(page)`.
9. **Assert it is pinned, not merely positioned** (AC3) — `daemon.pushFrame(toolUseFrame())`, await
   `.tool-row` count 1 with `STREAM_TIMEOUT_MS`, then `expectPinnedToBottom(page)` again. A `tool_use`
   frame rather than an assistant delta on purpose: it is one frame with one unambiguous arrival gate and
   no `turn_end` follow-up, so the step needs no second settle. Its row is tens of pixels tall — an order
   of magnitude above the 4px tolerance — so a thread that merely *sat* at the old bottom would now fail.

### Why `expectPinnedToBottom` may stay non-polling here

Its contract (`:215-223`) is that every call site first awaits a locator for an arriving element, and an
element becomes observable only after React's commit — layout effects included — has finished, because
that commit is one synchronous task. Both call sites above satisfy it: step 8 follows the bubble-count and
text waits, step 9 follows the `.tool-row` wait. **Do not** reach for `expect.poll` if a run looks
flaky — a poll here would paper over exactly the pre-paint guarantee the test exists to prove. A genuine
flake is a finding, not a tuning problem.

### What must NOT be added

- **No new helper extracted for this one drive.** The leave/return leg happens once.
- **No `settleScrollEvent` before the pushed frame in step 9.** The only outstanding scroll event there is
  the one the pin's own write queued, and it computes at-bottom → `true`, the value the flag already
  holds. Test 3 documents this asymmetry at `:348-352`.
- **No second send.** `buildReplyFrames` answers only `PRIMER_TEXT` (`:166`), and resting the re-entry leg
  on rows already in the store is what makes this a "content already present on open" proof rather than a
  second live stream.
- **No `data-*` test hook** on any production element. Every selector this test needs already exists.

---

## Mutation control (AC4)

**Required.** Change `ConversationScreen.tsx:347` from `useRef(true)` to `useRef(false)`, run
`npx playwright test e2e/thread-scroll-pin.spec.ts`, record the failure in the PR, revert.

Expected shape: steps 1–7 still pass (the primer asserts overflow, not position; step 3's assignment of an
already-zero `scrollTop` fires no event and step 4 still reads 0), and step 8's `expectPinnedToBottom`
fails with `scrollHeight - scrollTop - clientHeight` at roughly the full overflow distance instead of
`≤ 4`. Record the actual number. Note in the PR that this mutation also fails the file's other tests —
that is expected collateral; the observation that counts is the **new** test's assertion.

**Recommended second control** (drop it if the turn budget is tight — the required one satisfies the AC).
The mutation above is also killed by #601's tests, so on its own it does not show that *this* test covers
anything new. The sharper one does: hoist the flag out of the hook, `const following = { current: true }`
at module scope, so it survives the remount. #601's and #602's tests stay green; the new test fails at the
same step 8 assertion. That is the ticket's actual thesis — "the flag must not survive a remount" — under
test.

---

## Error handling / failure modes

There is no new failure path in production; the failure modes are the test's.

| Mode | Expected reading |
|---|---|
| Step 8 fails on first run | The guarantee does **not** hold and AC5's contingency is live. Fix inside `useThreadScrollPin` (`:345-399`) only — it is the sole owner of the flag and the pin. Do not fix it by widening a prop, adding a store slice, or reaching for `scrollIntoView`. |
| Step 7's count is `0` | The timeline was reset on re-entry. That means the id gate (`activateConversation.ts:74`) saw different ids — a real bug, and a different ticket. Report it; do not work around it by re-sending. |
| Step 6 hits a strict-mode violation on `.channel-list__row-open` | The list holds more than one row; check that the spec's `buildReplyFrames` default arm still returns the single shared `seedConversationsFrame()`. |
| Flake at step 8 or 9 | Do not add polling or timeouts. Re-read the settle reasoning above and report what actually raced. |

---

## Testing strategy

- **e2e (`npx playwright test e2e/thread-scroll-pin.spec.ts`)** — the only tier that can prove this. Run
  the whole file, not just the new test: the new one shares `buildReplyFrames` and the helpers with three
  others, and a regression in a helper must show up.
- **vitest** — nothing to add. `vitest.config.ts:27` runs the `node` environment: renderer tests are
  `renderToStaticMarkup` string assertions, effects never run, and there is no `scrollTop` to read. The
  pure at-bottom arithmetic is already covered by `threadScrollPosition.test.ts`. **Do not** manufacture a
  unit test here — there is no new arithmetic and no new pure function.
- **`npm run build`** — the standing salvage/QA gate. `e2e/` sits outside both tsconfig projects, so the
  new test crosses no typecheck boundary; the build must still be green.
- **AC5's explicit statement** — the PR body must say *"no production change was needed"* in those terms
  (or describe the change, if step 8 forced one). An implied zero-diff does not satisfy the criterion.

---

## Open questions

None blocking. One thing to watch and report rather than solve: the re-entry pin depends on the mounting
commit's layout being final (no late-loading font or image reflows the 20 bubbles after the layout effect
has already run). In a warm app window every font is loaded, so this is expected to be a non-issue — but
if step 8 fails by a few pixels rather than by the full overflow distance, that is the suspect, and it is
worth a comment in the PR rather than a tolerance bump.

---

## Scope check

| Red line | This spec |
|---|---|
| New files | 0 |
| Total written lines | ~70–90 (one test + comments, in an existing file) |
| New exported types / components | 0 |
| Consumer call sites to update | 0 |
| Acceptance criteria | 5, all satisfied by one drive plus a mutation run |
| Reject / error branches | 0 |
| **Production source files (`*.ts`/`*.tsx`, excluding tests) created or modified** | **0** — the §4 ≥5-file gate is not approached. |
