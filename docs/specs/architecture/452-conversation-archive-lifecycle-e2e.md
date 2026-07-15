# 452 — fake e2e: conversation archive → restore → delete lifecycle

**Ticket:** [#452](https://github.com/pyrycode/pyrycode-desktop/issues/452) · Size **S** · split from #422
**Labels:** `enhancement`, `size:s` — **not** `security-sensitive`, no `## Figma` section.

This is a **test-only** ticket: one new Playwright e2e spec, **zero production code**. It rides the two merged
fixtures (`launchPairedApp` #433 / `conversationStateFake` #434) and asserts existing UI. There is no new
attack surface (assertions read DOM text / visibility / counts only) and no new UI (nothing to design), so
neither a security-review pass nor a Design source section applies. Same ruling as the sibling #451 (PR#453,
merged) and the real-daemon twin #440.

This is the fake-stack twin of the real-daemon lifecycle spec #440. Both drive archive → restore → delete
against the same renderer and hit the same structural constraint (Gaps A/B below): assertions target the
**Archive view** and **gone-from-store**, never active-Channel-List departure/return.

---

## Files to read first

Codegraph is not initialized for this repo (see the `codegraph-not-initialized` project memory), so this list
was built by Read/grep, not `codegraph_context`. Read the sibling spec + test first — this spec is that shape
plus the archive/restore/delete steps.

- `docs/specs/architecture/451-conversation-create-rename-e2e.md` (whole) — **the sibling spec.** Same
  fixtures, same sheet, same FAB-create-into-thread opening; this spec reuses its Design vocabulary and adds
  the three destructive flows. Read it to avoid re-deriving the create-nav / sheet-open mechanics.
- `e2e/conversation-create-rename.spec.ts` (whole, 111 lines) — **the pattern to clone.** The exact shape:
  `conversationStateFake({ conversations: [SEED] })` → `launchPairedApp({ buildReplyFrames })` → one back-nav
  → FAB create → overflow → Channel-info sheet → pill-by-name. Clone its imports, hygiene header, `SEED`
  literal, `ROUNDTRIP_TIMEOUT_MS`. **Note its line 98–99:** after a *rename* it clicks `.status-sheet__close`
  before `.conversation__back` because the rename dialog leaves the sheet open. **#452 does NOT need that**
  (see the Design "sheet auto-close" note) — do not cargo-cult it.
- `e2e/conversation-state-fake.spec.ts` (whole, 79 lines) — the base demonstrator; the seed/passthrough/one-
  back-nav skeleton both specs share.
- `e2e/fixtures/conversationStateFake.ts:95-175` — the stateful verb switch. `archive_conversation` (126-132)
  / `unarchive_conversation` (134-140) flip the held row's `is_archived` and reply `conversation_updated`;
  `delete_conversation` (160-167) splices the row and replies `conversation_deleted { id }` with the request
  id echoed as `in_reply_to`. **Line 195-211 is load-bearing: `conversation_updated` OMITS `is_archived`**, so
  the archived flag reaches the store only via the follow-up `list_conversations` re-list, not the broadcast.
- `e2e/fixtures/launchPairedApp.ts:88, 134-135, 189, 199` — `LaunchPairedAppOptions = Omit<FakeDaemonOptions,
  'url'>` (the `buildReplyFrames` passthrough); the **single** `.channel-list__row-open` click that lands in
  the seeded thread (so seed **exactly one** clickable row); returns `{ page, app, daemon }`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:989-1027` — the Actions slot: **three**
  `.channel-info__action` pills (Rename / Archive / Delete). `.channel-info__action` is **not unique** —
  target Archive/Delete by accessible name. Delete is a **two-step inline confirm** (1000-1027): the initial
  `--danger` "Delete" arms; the confirm block replaces it with a prompt line + "Cancel" + a second `--danger`
  "Delete". **Exactly one button named "Delete" renders at a time** (arm state: the pill; confirm state: the
  confirm button) — so `getByRole('button', { name: 'Delete', exact: true })` is unambiguous in both states.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1117-1139` — the sheet's callback wiring.
  **`onArchive` (1120-1123) and `onDeleteConfirm` (1134-1137) both call `onClose()` after dispatching**, so
  the sheet auto-closes on Archive and on Delete-confirm. `onDelete` (1129) only opens the confirm (no wire
  traffic); `onDeleteCancel` (1139) dismisses it.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:128, 180-186` — the overflow trigger opens
  the Channel-info item; the sheet is mounted gated on `channelInfoOpen` with `onClose` = `setChannelInfoOpen
  (false)`, so `onClose()` **unmounts** the full-surface overlay → `.conversation__back` is clickable again
  with no scrim.
- `src/renderer/src/screens/archive/ArchiveScreen.tsx:100-131` — the two `role="tab"` buttons whose labels
  carry live counts via `tabCountLabel` ("Discussions (1)"); the `role="tabpanel"` body. Counts render for
  **both** tabs regardless of selection; the restore rows render only for the **selected** tab.
- `src/renderer/src/screens/archive/ArchiveScreen.tsx:194-214, 235-250` — `.archive__restore` (icon button,
  `aria-label="Restore"`) and `.archive__back` (`aria-label="Back"`, returns to the `list` view).
- `src/renderer/src/screens/archive/archiveViewModel.ts:20-49` — `partitionArchived` filters `is_archived ===
  true` **then** splits promoted→channels / non-promoted→discussions. The FAB-created row is **non-promoted**,
  so once archived it lands in **Discussions**, not Channels. `tabCountLabel` renders `(0)` for a loaded-empty
  tab.
- `src/renderer/src/screens/channels/ChannelList.tsx:181-200` — the `.channel-list__archive` entry
  (`aria-label="Archive"`) that dispatches `openArchive` → route `archive`.
- `src/renderer/src/screens/channels/ChannelList.tsx:299-318` — the `Row`: `.channel-list__row` wrapper →
  `.channel-list__row-open` button containing `.channel-list__title` = `titleFor(row.name)`. To click one of
  two rows, scope `.channel-list__row` by its title then click its `.channel-list__row-open`.
- `src/renderer/src/screens/channels/channelListViewModel.ts:9, 16, 26-32` — `titleFor(null)` = `'Untitled'`
  (the created row's displayed title, since #452 never renames it); `partitionByPromotion` filters
  `is_promoted` only, **no `is_archived` filter** — this is **Gap B** (archived rows keep rendering in the
  active Channel List; latent product bug, out of scope, flag-only).
- `src/renderer/src/PairedShell.tsx:112-118` — `onOpen` sets `setActiveConversation(conversation)` **then**
  dispatches `open`, so clicking the created list row re-enters its thread with the pills re-gated on it;
  `onOpenArchive` → route `archive`.
- `src/shared/wire/types.ts` — `ConversationSummary` (the `SEED` shape). **Import wire types by RELATIVE
  path** from e2e (`../src/shared/wire/types`); the `@shared` alias is not available to e2e.

**Lessons / environment (grep/Read won't surface these):** e2e is **not** typechecked by any project
tsconfig; a fresh worktree needs `npm install` before `npm run e2e`; run the built binary via
`./node_modules/.bin/playwright`, never `npx` (the `conversationStateFake` project memory).

---

## Context

Tier-1 fake-stack UI e2e: full renderer → IPC → main → Noise wire → decode → render round-trips against the
scripted `conversationStateFake` on the `launchPairedApp` fixture. Today only pair-and-send and (via #451)
create/rename have e2e coverage; the **archive**, **restore**, and **delete** flows are unguarded. This child
covers the destructive lifecycle; #451 (its sibling, also split from #422) covers create / list / sheet-rename
and is **independent** — both ride the same merged fixtures and add disjoint brand-new spec files.

### The two gaps that dictate the assertion surface (code-confirmed)

- **Gap A** — a FAB-created conversation never enters the active list at create time
  (`conversationListBridge.shouldRefreshList` is `false` for `conversationCreated`). So the created row lives
  only in the fake's state until the first *mutation* re-lists it.
- **Gap B** — the active Channel List never filters archived rows (`partitionByPromotion` splits by
  `is_promoted` only). So an archived conversation keeps rendering in the active list — active-list
  departure/return is **unrealizable** (the exact #440 contradiction). Latent product bug, out of scope.

Two consequences drive the whole design:

1. **Archive is what first lands the created row in the renderer store.** Create issues no re-list (Gap A);
   archiving fires `conversation_updated` → the app re-lists → the follow-up `list_conversations` returns the
   row now `is_archived: true` → `partitionArchived` surfaces it in the Archive view's **Discussions** tab.
   That is why the **Archive-view Discussions 0→1** delta is the sound first assertion.
2. **Delete is the one step where "gone" holds everywhere.** Delete *splices* the row from the fake's list
   (not a tag), so the re-list returns a list without it — gone from both the Channel List **and** the Archive
   view.

The seed is a **promoted, never-archived** channel, so it stays out of the Discussions tab throughout and its
presence/absence is the crisp control for "delete was targeted, not a wipe."

---

## Design

A **single** `test`, a **single** `launchPairedApp` launch (a fresh launch + pairing costs ~15–60s), one
sequential drive. Clone the sibling's imports, hygiene header, and `SEED` / `ROUNDTRIP_TIMEOUT_MS` constants.

### Fixtures / constants (contract)

```ts
// One PROMOTED, NAMED seed → "Channels" section, never archived. EXACTLY ONE clickable row (launchPairedApp
// clicks a single `.channel-list__row-open`; a second seed strict-violates at launch). Fixed literals only.
const SEED: ConversationSummary = { id: 'seed-conversation', name: 'Seeded channel',
  is_promoted: true, is_archived: false, cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z', last_used_at: '2026-07-07T12:00:00.000Z' }
const UNTITLED = 'Untitled'                // the FAB-created row's displayed title: titleFor(null); #452 never renames it
const ROUNDTRIP_TIMEOUT_MS = 15_000        // headroom over the 5s default for the mutate → broadcast → re-list loop (sibling's value)
```

Seed via `conversationStateFake({ conversations: [SEED] })`; pass its return straight through as
`launchPairedApp({ buildReplyFrames })`. The scripted `buildReplyFrames` owns answering every inbound
(including the auto-fired `list_conversations`) from held state.

### Drive (sequence + selectors + expected auto-wait)

The launch lands **in the seeded row's thread** (the fixture clicked it), with `activeConversation` = SEED.

1. **Back to the list** — `.conversation__back` click. Route → `list`; the store holds SEED (listed on the
   connected edge).
2. **Baseline — Archive view starts empty.** `.channel-list__archive` click (`aria-label="Archive"`) → route
   `archive`. Assert both tabs read zero: `getByRole('tab', { name: 'Channels (0)' })` and
   `getByRole('tab', { name: 'Discussions (0)' })` visible (the seed is unarchived → nothing in either tab).
   This is the observed **0** of the 0→1. Then `.archive__back` click (`aria-label="Back"`) → route `list`.
3. **FAB create-nav (Gap A).** `.channel-list__fab` click → `requestNewConversation` (`name: null`) →
   `conversation_created` → nav → route `thread`. Assert **navigation**, not list membership: wait for
   `.conversation__overflow-trigger` visible (absent on the list, present on a thread → its auto-wait *is* the
   create-nav gate). Do **not** assert the created row in the active list here (Gap A).
4. **Open the Channel-info sheet.** `.conversation__overflow-trigger` click → `getByRole('menuitem', { name:
   'Channel info' })` click → the sheet mounts with `conversation` = the created payload (non-null → the pills
   render).
5. **Archive (AC2).** The Archive pill is one of three `.channel-info__action` buttons → target by name:
   `getByRole('button', { name: 'Archive', exact: true })` click. This fires `archive_conversation` → the fake
   sets `is_archived: true` → `conversation_updated` → re-list → the store gains the created row now archived.
   **`onArchive` also closes the sheet** (it calls `onClose()`), so the overlay unmounts and we are back on the
   bare thread — no `.status-sheet__close` needed.
6. **Nav to the Archive view.** `.conversation__back` click (sheet already closed → no scrim) → route `list` →
   `.channel-list__archive` click → route `archive`.
7. **AC2 — Discussions 0→1.** Assert `getByRole('tab', { name: 'Discussions (1)', exact: true })` visible with
   `{ timeout: ROUNDTRIP_TIMEOUT_MS }` (it auto-waits the archive → broadcast → re-list loop). Optionally also
   assert `getByRole('tab', { name: 'Channels (0)' })` to prove the promoted seed does not leak into
   Discussions and Gap-B's active-list bleed did not miscount the archive view.
8. **Switch to Discussions + Restore (AC3).** Click the Discussions tab (`getByRole('tab', { name:
   'Discussions (1)' })`) to render its panel → assert `.archive__restore` visible → click `.archive__restore`.
   This fires `unarchive_conversation` → `is_archived: false` → `conversation_updated` → re-list.
9. **AC3 — Discussions 1→0.** The same Archive screen re-renders in place (restore does not navigate): assert
   `getByRole('tab', { name: 'Discussions (0)', exact: true })` visible with `{ timeout: ROUNDTRIP_TIMEOUT_MS }`
   and the panel empty state `getByText('No archived discussions')` visible. `.archive__restore` is now gone.
10. **Re-enter the created thread for delete.** `.archive__back` click → route `list`. The list now shows two
    rows — SEED ("Channels") and the restored created row ("Untitled", "Recent discussions"). Click the created
    row's open control, scoped by its title so it does not strict-violate against SEED's row-open:
    `page.locator('.channel-list__row').filter({ hasText: UNTITLED }).locator('.channel-list__row-open')`
    click → `onOpen` sets `activeConversation` = the created row and routes `thread`.
11. **Open the sheet, two-step Delete (AC4).** `.conversation__overflow-trigger` click →
    `getByRole('menuitem', { name: 'Channel info' })` click. **Arm:** `getByRole('button', { name: 'Delete',
    exact: true })` click (the initial `--danger` pill → `onDelete` opens the confirm, no wire traffic).
    Assert the confirm prompt `getByText('Delete this conversation permanently? This cannot be undone.')`
    visible (gates the arm→confirm transition deterministically). **Confirm:** `getByRole('button', { name:
    'Delete', exact: true })` click again — in the confirm state this uniquely resolves to the confirm
    `--danger` button (the initial pill is replaced; only one "Delete" renders) → `onDeleteConfirm` fires
    `delete_conversation` and closes the sheet. The fake splices the row and replies `conversation_deleted
    { id }` correlated by `in_reply_to` → the app re-lists → the list returns only SEED.
12. **AC4 — gone from the Channel List (the distinguishing assertion).** `.conversation__back` click → route
    `list`. Assert the created row is gone and only the seed remains — assert `page.locator('.channel-list__
    row-open')` has count `1` with `{ timeout: ROUNDTRIP_TIMEOUT_MS }` (the 2→1 drop, auto-waiting the delete
    re-list), then assert SEED (`.channel-list` → `getByText('Seeded channel', { exact: true })`) visible and
    `.channel-list` → `getByText(UNTITLED, { exact: true })` has count `0`. (This is the one surface where the
    created row *was* visible pre-delete — Gap B kept it in the list even while archived — so its removal here
    is the sound "deleted from store" proof.)
13. **AC4 — gone from the Archive view.** `.channel-list__archive` click → route `archive`. Assert
    `getByRole('tab', { name: 'Discussions (0)' })` and `getByRole('tab', { name: 'Channels (0)' })` visible —
    the spliced row is in neither tab.

### Why the archived/deleted thread is provably the created conversation

The sheet pills render only when `activeConversation` is non-null, and only the create-nav path (step 3) or a
list-open (step 10) populates it. Step 4 is reached from the **list** via the FAB, so the only thing that set
`activeConversation` before the Archive click is `useConversationCreatedNav(created)`. Step 10 re-enters via
the created row's own `.channel-list__row-open` (scoped by `UNTITLED`, distinct from SEED), so the Delete
targets the created row's real id. The seed — promoted, never archived, still present in step 12 — is the
control proving the destructive verbs did not touch it.

### Sheet auto-close vs the #451 scrim lesson

#451 learned the Channel-info sheet is a full-surface `.status-sheet-overlay` whose scrim obscures
`.conversation__back`, and had to click `.status-sheet__close` first — **because its rename path leaves the
sheet open** (the rename dialog's `onSave` closes only the dialog). #452's Archive and Delete-confirm both call
`onClose()` (ConversationScreen.tsx:1122, 1136), unmounting the sheet, so the scrim is gone before every
`.conversation__back` in this drive. **Do not add `.status-sheet__close`** after Archive/Delete — the button
no longer exists and the click would fail.

---

## State + concurrency model

- **One launch, one store lifetime.** Every flow shares the app-singleton conversation-list store, the
  `activeConversationStore`, and the fake's single held list — no reseeding, no relaunch. The fake is a closure
  over one mutable list that create appends to, archive/unarchive tags, and delete splices.
- **Async confirmations, Playwright auto-wait.** Archive / restore / delete are fire-and-forget on the wire;
  their store effects arrive as daemon events (`conversation_updated` → re-list; `conversation_deleted` →
  re-list). Every assertion/click auto-waits the arrival — no manual sleeps, no polling. Give each
  count-delta / gone assertion `ROUNDTRIP_TIMEOUT_MS` headroom.
- **Determinism.** The fake uses fixed ids/ts, no clock/random, so a failure is a real regression, never
  flake. `created-1` is the minted id; the store round-trips it deterministically.
- **Route transitions** are `useReducer`-driven in `PairedShell` (`open` / `back` / `openArchive`), screen-
  local. The spec never touches the store directly — only real product UI (back, FAB, archive entry, overflow,
  pills, tabs, restore, row-open).
- **Selection state** — `ArchiveScreen`'s `selectedTab` is screen-local `useState`, reset to `channels` on
  remount; step 8 switches to Discussions, and the same screen instance re-renders in place across restore.
- **Teardown** is owned entirely by the `launchPairedApp` fixture (LIFO: app → daemon → forwarder →
  `rm(userDataDir)`), firing on pass and fail. This spec adds nothing.

---

## Error handling / failure modes

- **Archive never re-lists** → the `Discussions (1)` tab assertion (step 7) times out. `ROUNDTRIP_TIMEOUT_MS`
  gives a cold runner headroom; a true miss surfaces the expected-vs-actual tab label.
- **Restore never re-lists** → the `Discussions (0)` / empty-state assertion (step 9) times out on the same
  screen.
- **Delete never removes** → the `.channel-list__row-open` count stays `2` (step 12) and times out against the
  expected `1`, or the `UNTITLED` count-`0` assertion fails — either way the exact mismatch is reported.
- **`.channel-info__action` ambiguity** — three pills share the class; selecting by class alone strict-
  violates. By-name `getByRole('button', { name: 'Archive' | 'Delete', exact: true })` is unambiguous (the
  list is unmounted while the thread + sheet are up, so `.channel-list__rename` never competes).
- **Two-step Delete resolution** — exactly one button named "Delete" renders per state (arm: the pill; confirm:
  the confirm button), so the two sequential by-name clicks are each unambiguous; the interposed confirm-prompt
  assertion pins the transition so the second click cannot race the arm.
- **Two competing row-open buttons** (step 10) — after restore the list holds SEED + the created row, both
  rendering `.channel-list__row-open`; the `.channel-list__row` `filter({ hasText: UNTITLED })` scoping targets
  exactly the created row (SEED's title contains no "Untitled").
- **Secret hygiene** (carry the sibling's header verbatim): every assertion reads DOM text / visibility /
  counts only; `SEED.name` and `UNTITLED` are non-secret display literals; the pairing plumbing (synthetic
  token, fake static key) lives in `launchPairedApp` and is never echoed; no failure diagnostic serializes a
  token, key, or plaintext.

---

## Testing strategy

This spec **is** the test — one end-to-end archive → restore → delete lifecycle against the fake stack.

- **Runs under `npm run e2e`** — the filename `conversation-archive-lifecycle.spec.ts` does **not** match the
  Playwright config's `real-*` `testIgnore`, so it is in the default suite (unlike the real-daemon specs).
- **QA gate:** `npm run e2e` green (AC5). e2e is outside every tsconfig, so the spec must compile under
  Playwright's own TS handling (relative imports, no `@shared`).
- **No unit tests, no fakes to write** — `conversationStateFake` (#434) and `launchPairedApp` (#433) are the
  merged infrastructure this consumes; the seven verbs' semantics are already unit-covered by #434.

---

## Open questions

- **Literal 0→1 baseline (step 2).** The drive visits the Archive view before archiving to observe the `(0)`
  baseline, making the 0→1 an observed delta rather than an implied one. If the developer prefers the leaner
  sibling posture (assert only the post-archive `(1)`, taking `(0)` as implied since the seed is never
  archived), dropping step 2 is acceptable — the ticket's intent (the archived row surfaces in Discussions) is
  still proven. Recommended: keep step 2; it is three cheap clicks and it also proves the archive-view entry
  and the seed-exclusion up front.
- **Archive-view-after-delete assertion (step 13).** Discussions is already `(0)` after restore, so step 13
  does not *distinguish* delete from restore — the Channel-List absence (step 12) is the load-bearing "gone
  from store" proof. Step 13 satisfies the AC's literal "nor the Archive view" clause cheaply; keep it, but the
  developer should understand step 12 is the real assertion.
- **`cwd` of the created row.** The FAB sends `cwd: defaultWorkspace` (client default #403), unset in the
  isolated e2e user-data dir → `null` → the fake resolves it to `/fake/workspace`. Not load-bearing for any
  assertion (we assert titles / counts, not cwd).
