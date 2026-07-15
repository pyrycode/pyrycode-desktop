# 451 — fake e2e: conversation create + list render + Channel-info sheet rename

**Ticket:** [#451](https://github.com/pyrycode/pyrycode-desktop/issues/451) · Size **S** · split from #422
**Labels:** `enhancement`, `size:s` — **not** `security-sensitive`, no `## Figma` section.

This is a **test-only** ticket: one new Playwright e2e spec, **zero production code**. It rides the two
merged fixtures (`launchPairedApp` #433 / `conversationStateFake` #434) and asserts existing UI. There is
no new attack surface (assertions read DOM text / visibility only) and no new UI (nothing to design), so
neither a security-review pass nor a Design source section applies.

---

## Files to read first

Read the demonstrator in full first — this spec is that spec plus three flows (FAB create-nav, the
Channel-info sheet rename entry point, and the grown two-row list).

- `e2e/conversation-state-fake.spec.ts` (whole, 79 lines) — **the pattern to clone.** Shows the exact
  shape: seed `conversationStateFake({ conversations: [SEED] })`, pass its return straight through as
  `launchPairedApp({ buildReplyFrames })`, the one back-nav (the fixture lands in the thread), and the
  rename-dialog drive (`.rename-conversation` → `.rename-conversation__input` → `.rename-conversation__save`)
  with the round-trip auto-wait + secret-hygiene header. **This spec = this file + the FAB/sheet/multi-row
  steps below.** Do not re-prove the list-row (`.channel-list__rename` pencil) rename — this file owns it.
- `e2e/fixtures/launchPairedApp.ts:60-101, 118-200` — `LaunchPairedAppOptions` (`buildReplyFrames`
  passthrough), the **single** `.channel-list__row-open` click that lands in the seeded thread, the
  `PairedApp` handle (`{ page, app, daemon }`). Confirms: seed **exactly one** clickable row; the launch
  ends "paired, on the seeded thread, Send enabled." A second clickable seed strict-violates the row click.
- `e2e/fixtures/conversationStateFake.ts:83-175` — the stateful factory. `create_conversation` mints
  `created-N` with `name: payload.name` (**null** from the FAB) + `is_promoted: false`, pushes it, and
  replies `conversation_created`; `rename_conversation` mutates the held row and broadcasts
  `conversation_updated`; `list_conversations` answers from **current** state. This is why the list grows
  to two after create, and why the rename's re-list surfaces the created row under its new name.
- `src/renderer/src/PairedShell.tsx:83-125` — the create→nav bridge (`useConversationCreatedNav` →
  `setActiveConversation(created)` **then** `dispatch({ type: 'open' })`) and the list-open path (line 112,
  also sets active). Confirms the FAB path lands in the **created** thread with `activeConversation` = the
  created payload — which is what gates the sheet's Rename pill.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:105-186` — `channelInfoOpen` state, the
  overflow-menu → Channel-info wiring (line 128: `onChannelInfo={() => setChannelInfoOpen(true)}`), and the
  `ChannelInfoSheet` mount reading the `activeConversation` slice (lines 180-186).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:983-1035` — the Actions slot: **three**
  `.channel-info__action` pills (Rename / Archive / Delete) render for a non-null conversation, so
  `.channel-info__action` is **not unique** — target the Rename pill by its accessible name (see Design).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1070-1154` — the `ChannelInfoSheet`
  container: the Rename pill opens `RenameConversationDialogView` (the same dialog the list-row rename
  uses), so the demonstrator's dialog drive applies unchanged.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1450-1497` — `ThreadOverflowMenuView`:
  `.conversation__overflow-trigger` (aria-label "More actions") → `role="menu"` → the single
  `role="menuitem"` reading "Channel info".
- `src/renderer/src/screens/channels/ChannelList.tsx:140, 211-231, 261-278` — the FAB
  (`.channel-list__fab`, aria-label "New discussion") dispatches `requestNewConversation`; the seeded
  promoted row renders under the **"Channels"** header, the FAB-created non-promoted row under **"Recent
  discussions"** — the two-section grown list.
- `src/renderer/src/store/conversationCreatedBridge.ts:23-31` — `requestNewConversation` sends
  `{ is_promoted: false, name: null, cwd: <default|null> }`, so the created row is **initially unnamed**
  ("Untitled"); the sheet rename gives it its first real name.
- `src/shared/wire/types.ts` — `ConversationSummary` (the seed shape) + `ConversationCreatedPayload`.
  **Import wire types by RELATIVE path** from e2e (`../src/shared/wire/types`) — the `@shared` alias is not
  available to e2e, mirroring the demonstrator's imports.

**Lessons / environment (not code — grep/Read won't surface these):** e2e is **not** typechecked by any
project tsconfig; a fresh worktree needs `npm install` before `npm run e2e`; run the built binary via
`./node_modules/.bin/playwright`, never `npx`.

---

## Context

Tier-1 fake-stack UI e2e: full renderer → IPC → main → Noise wire → decode → render round-trips against the
scripted `conversationStateFake` on the `launchPairedApp` fixture. Today only pair-and-send has any e2e
coverage; the **create-and-navigate** flow, the **Channel-info sheet** rename entry point, and a **multi-row**
Channel List are all unguarded. This child covers those; its sibling (also split from #422) covers
archive → restore → delete.

The list-row rename entry point (`.channel-list__rename` pencil) is already proven by
`e2e/conversation-state-fake.spec.ts` and is **out of scope** here — do not duplicate it.

---

## Design

A **single** `test`, a **single** `launchPairedApp` launch (a fresh launch + pairing costs ~15–60s), one
sequential drive. Clone the demonstrator's imports, hygiene header, and timeout constant.

### Fixtures / constants (contract)

```ts
// One PROMOTED, NAMED seed → renders in the "Channels" section (mirrors the demonstrator). Exactly one
// clickable row: launchPairedApp reaches the thread by clicking a single `.channel-list__row-open`, so a
// second seed would strict-violate at launch. Fixed literals only (the fakeDaemon convention).
const SEED: ConversationSummary = { id: 'seed-conversation', name: 'Seeded channel',
  is_promoted: true, is_archived: false, cwd: '/fake/workspace',
  last_message_ts: FIXED_TS, last_used_at: FIXED_TS }
const NEW_TITLE = 'Created then renamed'   // distinct from SEED.name so both assertions stay crisp
const ROUNDTRIP_TIMEOUT_MS = 15_000        // headroom over the 5s default for a cold runner (demonstrator's value)
```

Seed via `conversationStateFake({ conversations: [SEED] })`; pass its return straight through as
`launchPairedApp({ buildReplyFrames })`. Because a scripted `buildReplyFrames` overrides the fixture's
default seed, the factory owns answering every inbound (including the auto-fired `list_conversations`).

### Drive (sequence + selectors + expected auto-wait)

The launch lands **in the seeded row's thread** (the fixture clicked it), with `activeConversation` = SEED.

1. **Back to the list** — `page.locator('.conversation__back').click()`. Route → `list`; the
   conversation-list store already holds SEED (listed on the connected edge).
2. **AC2 — baseline list render.** Assert SEED renders: `page.locator('.channel-list').getByText('Seeded
   channel', { exact: true })` is visible. (The `.channel-list` scope keeps the assertion off any incidental
   match elsewhere.)
3. **AC3 — FAB create-nav.** `page.locator('.channel-list__fab').click()` → `requestNewConversation`
   (`name: null`) → `conversation_created` → `useConversationCreatedNav` sets active + dispatches `open` →
   route `thread`. Assert **navigation into a thread**, not list membership (Gap A): wait for the created
   thread's chrome — `page.locator('.conversation__overflow-trigger')` visible. This locator is absent on
   the list, so its auto-wait **is** the create-nav gate. Do **not** assert the created row in the active
   list here (Gap A: `shouldRefreshList` is `false` for `conversationCreated`).
4. **Open the Channel-info sheet.** `.conversation__overflow-trigger` click → the `role="menu"` drops →
   `page.getByRole('menuitem', { name: 'Channel info' })` click → the sheet mounts with
   `conversation` = the created payload (non-null → the Rename pill renders).
5. **AC4 — sheet Rename round-trip.** The Rename pill is one of three `.channel-info__action` buttons, so
   target it by name: `page.getByRole('button', { name: 'Rename', exact: true })`. Click it →
   `RenameConversationDialogView` opens (`.rename-conversation`) prefilled "Untitled" (the created row is
   unnamed) → `.rename-conversation__input` `.fill(NEW_TITLE)` (fill replaces the prefill) →
   `.rename-conversation__save` click. This fires `rename_conversation` → the fake mutates its held row →
   `conversation_updated` broadcast → `shouldRefreshList` true → re-request `list_conversations` → the fake
   answers from **updated** state (now two rows: SEED + the renamed created row).
6. **Reflect on the re-listed Channel List** (**not** the thread — `activeConversationStore` is not
   rewritten by `conversation_updated`, so the open thread's own title may not update; the observable
   reflection is the re-list). `page.locator('.conversation__back').click()` → route `list`.
7. **AC4 — multi-row render + rename reflection.** Assert **both**, scoped to `.channel-list`, exact text:
   SEED (`'Seeded channel'`, "Channels" section) **and** the created row under `NEW_TITLE` ("Recent
   discussions" section). Give the created-row assertion the `ROUNDTRIP_TIMEOUT_MS` headroom (it auto-waits
   the full rename → broadcast → re-list → re-render loop).

### Why the created thread is provably the created conversation

The Rename pill renders only when `activeConversation` is non-null, and only the create-nav path (or a
list-open) populates it. We arrive at step 4 from the **list** via the FAB, so the only thing that set
`activeConversation` between the back-nav and here is `useConversationCreatedNav(created)`. The round-trip
in step 5 landing the created row under `NEW_TITLE` (a `created-N` id the fake minted, distinct from SEED)
is the end-to-end confirmation.

---

## State + concurrency model

- **One launch, one store lifetime.** All flows share the app-singleton conversation-list store, the
  `activeConversationStore`, and the fake daemon's single held list — no reseeding, no relaunch.
- **Async confirmations, Playwright auto-wait.** Create and rename are fire-and-forget on the wire; their
  effects (nav, re-list) arrive as daemon events. Every step's assertion/click auto-waits the arrival — no
  manual sleeps, no polling. The fake is deterministic (fixed ids/ts, no clock/random), so a failure means a
  real regression, never flake.
- **Route transitions** are `useReducer`-driven in `PairedShell` (`open` / `back`), screen-local and reset
  on remount — the spec never touches the store directly, only real product UI (row-open, FAB, back,
  overflow, pills, dialog).
- **Teardown** is owned entirely by the `launchPairedApp` fixture (LIFO: app → daemon → forwarder →
  `rm(userDataDir)`), firing on pass and fail. This spec adds nothing.

---

## Error handling / failure modes

- **Create never navigates** → `.conversation__overflow-trigger` never appears → Playwright fails step 3
  with a clear locator-timeout naming the missing selector. (The fake always replies `conversation_created`,
  so this only trips on a renderer/bridge regression.)
- **Rename never reflects** → the `NEW_TITLE` assertion in step 7 times out against the re-listed
  `.channel-list`. `ROUNDTRIP_TIMEOUT_MS` gives a cold runner headroom; a true miss surfaces the exact
  expected-vs-actual text.
- **`.channel-info__action` ambiguity** — three pills share the class; selecting by class alone would
  strict-violate. The by-name `getByRole('button', { name: 'Rename' })` is unambiguous (the list is
  unmounted while the thread+sheet are up, so no `.channel-list__rename` competes).
- **Secret hygiene** (carry the demonstrator's header verbatim): every assertion reads DOM text /
  visibility / counts only; `SEED.name` and `NEW_TITLE` are non-secret display literals; the pairing
  plumbing (synthetic token, fake static key) lives in `launchPairedApp` and is never echoed; no failure
  diagnostic serializes a token, key, or plaintext.

---

## Testing strategy

This spec **is** the test. It exercises the create → nav and sheet-rename → re-list round-trips end to end
against the fake stack.

- **Runs under `npm run e2e`** — the filename `conversation-create-rename.spec.ts` does **not** match the
  Playwright config's `real-*` `testIgnore`, so it is in the default suite (unlike the real-daemon specs).
- **QA gate:** `npm run e2e` green (AC5). `npm run build` still typechecks the app, but e2e is outside every
  tsconfig — the spec must simply compile under Playwright's own TS handling (relative imports, no `@shared`).
- **No unit tests, no fakes to write** — `conversationStateFake` (#434) and `launchPairedApp` (#433) are the
  merged infrastructure this consumes; the seven verbs' semantics are already unit-covered by #434.

---

## Open questions

- **`cwd` of the created row.** The FAB sends `cwd: defaultWorkspace` (client default #403), which in the
  isolated e2e user-data dir is unset → `null` → the fake resolves it to `/fake/workspace`. Not load-bearing
  for any assertion (we assert names/sections, not cwd), so no seeding of a default is needed. Flagged only
  so the developer isn't surprised the created row lands in a non-empty workspace.
- **Section-membership assertion granularity.** Step 7 asserts both titles are visible in `.channel-list`.
  If a stricter "SEED under Channels / NEW_TITLE under Recent discussions" is wanted, scope each `getByText`
  under the respective `.channel-list__section-header` sibling — optional; the two-title visibility already
  proves the grown two-row list + the rename reflection. Developer's call at write time.
