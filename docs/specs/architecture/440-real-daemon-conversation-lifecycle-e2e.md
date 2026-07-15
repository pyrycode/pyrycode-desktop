# #440 — real-daemon e2e: conversation lifecycle (archive → restore → delete) over the real wire

**Size:** S · **Security-sensitive:** no (test-only, no product code; same ruling as #420/#439) · **Figma:** N/A (see below)

## Design source

N/A — test-only ticket. This spec asserts *existing* UI (archive #366/#347/#348, unarchive/restore #348/#346, delete #375/#376/#377, New-discussion FAB #241/#242) over the real wire and changes **zero** product code. There is no new visual surface, so the visual-fidelity check is intentionally skipped. The design intent it exercises is already anchored by the merged fake twin #452.

## Files to read first

Read these before writing the spec. The first two are the load-bearing templates — this spec is a near-verbatim graft of #452's assertion surface onto #439's real-daemon harness.

- `e2e/conversation-archive-lifecycle.spec.ts` (whole, 1–169) — **THE primary reference.** The merged fake twin (#452, PR#454). It drives create → archive → restore → delete on one FAB-created conversation and documents the identical Gap A/B constraint. Mirror its assertion surface field-for-field; the divergences are enumerated in **Design → Divergences from the fake twin** below.
- `e2e/real-daemon-rename.spec.ts` (whole, 1–100) — **the real-daemon template.** Copy its shape: `test.use({ spawnClaude: false, seedPromoted: true })`, the pairing drive (`encodePairingPayload` → paste box → Pair → fingerprint → Confirm), the timeout constants, and the readiness gate on a promoted-row selector under `HANDSHAKE_TIMEOUT_MS`.
- `e2e/fixtures/realDaemon.ts:106–316` — the fixture consumed by both. Note: `RealDaemonOptions` (`spawnClaude`, `seedPromoted`); the `relay → daemon → page` LIFO chain; `seedRegistry` (444–448) writes **no `name`** field → the seeded row renders `titleFor(null)` = "Untitled" (the collision that dictates the count-delta / affordance-scoped assertions here); `encodePairingPayload` (320); the skip-gate (126–129) that gates on `pyry` alone in claude-less mode.
- `src/renderer/src/screens/channels/ChannelList.tsx:233–366` — `renderBody` splits rows into **Channels** (promoted) and **Recent discussions** (non-promoted); a promoted row (the seed) carries `.channel-list__rename`, a non-promoted row (the FAB conversation) carries `.channel-list__save`. This affordance asymmetry is the re-entry discriminator (see Design).
- `src/renderer/src/PairedShell.tsx:83–125` — `onOpen` records the clicked row as `activeConversation` (#448, lines 112–115) **before** navigating; the create-nav (`useConversationCreatedNav`, 91–94) records the FAB conversation the same way. So a row-click re-targets every thread-scoped wire action (including delete) at the clicked row's real id — the re-entry click MUST land on the created row, not the seed.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:900–1030` — the Channel Info sheet: the Archive pill is `.channel-info__action` with accessible name "Archive" (**not** class-unique — three pills), the two-step Delete is the `.channel-info__action--danger` "Delete" arm (1022–1024) → the confirm prompt "Delete this conversation permanently? This cannot be undone." (1006) → the `--danger` "Delete" confirm (1013–1014). Both `onArchive` and `onDelete` call `onClose()`, so no `.status-sheet__close` before `.conversation__back`.
- `src/renderer/src/store/conversationCreatedBridge.ts:23–31` — `requestNewConversation` sends `{ type: 'createConversation', payload: { is_promoted: false, name: null, cwd: defaultCwd } }`. With a fresh `--user-data-dir` no default workspace is set → `cwd: null` → "take the daemon default" (the harness's `-pyry-workdir`). This is the claude-less-create open question.
- `src/renderer/src/screens/archive/ArchiveScreen.tsx:100–239` — the Archive view: `role="tab"` tabs named `"<Label> (<count>)"` (e.g. `"Discussions (1)"`), `.archive__restore`, `.archive__back`, and the empty-state copy "No archived discussions" (`archiveViewModel.ts:22`). Already exercised green by #452 — read for the tab-count render only.
- `playwright.config.ts:14` (`testIgnore: /real-.*\.spec\.ts$/`) and `playwright.real-claude.config.ts:14` (`testMatch: /real-.*\.spec\.ts$/`) — the filename gate. `package.json:17` — the `e2e:real-claude` script. A `real-`-prefixed filename is excluded from `npm run e2e` and included in `npm run e2e:real-claude` structurally.

## Context

This is the credential-light real-daemon tier (#439) that would have caught the `promote_conversation` gap (pyrycode/pyrycode#949): the daemon defined the type but registered no handler, so save-as-channel answered `unsupported` on the real wire while the *entire* fake-daemon suite stayed green — a fake answers anything. Archive, restore (unarchive), and delete are pure registry ops daemon-side (they never touch claude), so they run against a real spawned `pyry` on the `fakeRoutingRelay` — deterministic, credential-light, `spawnClaude:false`.

**This spec is the real-daemon twin of the merged fake-stack spec #452.** #452 already drives the exact chain against the `conversationStateFake` and hit the structural constraints below; #440 runs the same chain, with the same assertion surface, against a real spawned `pyry`. Swap only the fake `buildReplyFrames` seed for the #439 real-daemon fixture spawn. **Zero product code.**

Two facts fix the assertion surface (both code-confirmed, identical to what #452 documents):

- **The subject is the FAB-created conversation, not the seed.** Archive and Delete live only on the Channel Info sheet, whose pills are gated on `activeConversation !== null`. Per #448, that store is written by *any* row-open and by the FAB create-nav — so the gate itself is reachable from a seed row too. But the seeded conversation is inert extra state (promoted, never archived); the lifecycle chain must run on a conversation the spec mints in-session via the FAB, and the delete step's target is whichever conversation was recorded active by the **last** row-open / create-nav. This is why the re-entry click must be scoped precisely (see Design).
- **The assertions target the Archive view + gone-from-store, never active-list departure/return.** *Gap A* — a FAB-created conversation never enters the active list at create time (`conversationListBridge.shouldRefreshList` is `false` for `conversationCreated`); archiving is the first mutation that re-lists it, so it first surfaces in the Archive view's Discussions tab. *Gap B* — the active list never filters archived rows (`partitionByPromotion` splits by `is_promoted` only), so an archived conversation keeps rendering in the active list; "leaves the list on archive" is false (a latent product bug, filed as #469, out of scope). DELETE is the one step where "gone" holds everywhere — the daemon removes the registry row, so the correlated re-list returns a list without it.

## Design

One new file: **`e2e/real-daemon-conversation-lifecycle.spec.ts`**. One `test`, one real-daemon spawn + pairing, one indivisible sequential drive. `test.use({ spawnClaude: false, seedPromoted: true })`.

`seedPromoted: true` makes the seed a promoted Channel so it (a) renders `.channel-list__rename` — the readiness gate, exactly as the rename spec uses it; (b) stays in the Channels section and never enters the Archive view's Discussions tab — the crisp control proving the destructive verbs hit only the created row; (c) is the row that must *remain* after delete.

### Timeouts (mirror `real-daemon-rename.spec.ts`, contract only)

- `HANDSHAKE_TIMEOUT_MS = 45_000` — absorbs real daemon startup + a handshake re-dial or two; used only on the readiness gate.
- `ROUNDTRIP_TIMEOUT_MS = 15_000` — one registry op + its `conversation_updated`/`conversation_deleted` → re-list → re-render; used on each mutation assertion.
- `SPEC_TIMEOUT_MS = 120_000` via `test.setTimeout(...)` — handshake + four fast registry round-trips + headroom; comfortably under the config's 300s default. (Developer may tighten; keep it well below 300s.)

### The drive (ordered steps — selectors + assertions; developer writes the Playwright in #452's idiom)

1. **Pair** against the real daemon — verbatim from `real-daemon-rename.spec.ts:47–64`: build `encodePairingPayload({ server, relay: `${relay.url}/v1/client`, token, server_static_pubkey })` from `daemon.pairFields`, fill `textarea[aria-label="Pairing code"]`, click Pair, await `[aria-label="Server key fingerprint"]`, click Confirm.
2. **Readiness gate** — `await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })`. The promoted seed's pencil renders only after handshake → session `connected` → the auto-fired `list_conversations` returned the seeded promoted row → it rendered in Channels. **The real-daemon path lands on `route='list'` post-pairing — there is NO opening `.conversation__back`** (unlike #452, whose `launchPairedApp` starts inside the seed thread).
3. **Baseline — Archive view empty.** `.channel-list__archive` → assert `tab "Channels (0)"` and `tab "Discussions (0)"` visible (exact) → `.archive__back`.
4. **FAB create-nav (AC2, Gap A).** `.channel-list__fab` → `create_conversation` → `conversation_created` → `useConversationCreatedNav` records `activeConversation` = created + routes `thread`. Assert `await expect(page.locator('.conversation__overflow-trigger')).toBeVisible()` — thread navigation, **NOT** active-list membership. A timeout here = missing `create_conversation` handler (#949-class).
5. **Archive (AC3).** `.conversation__overflow-trigger` → `menuitem "Channel info"` → `button "Archive"` (exact — `.channel-info__action` is not class-unique). `archive_conversation` → `conversation_updated` (correlated to the requester, **not** a broadcast; pyrycode#881) → re-list lands the created row now `is_archived:true`. `onArchive` calls `onClose()`, so the sheet unmounts — no `.status-sheet__close`. Then `.conversation__back` → `.channel-list__archive`. Assert `tab "Discussions (1)"` visible (`timeout: ROUNDTRIP_TIMEOUT_MS`) and `tab "Channels (0)"` visible — the archived non-promoted created row lands in Discussions; the promoted seed never leaks in.
6. **Restore (AC4).** Click `tab "Discussions (1)"` (restore rows render only for the selected tab) → assert `.archive__restore` visible → click it. `unarchive_conversation` → `conversation_updated` → re-list. Assert `tab "Discussions (0)"` visible (`timeout: ROUNDTRIP_TIMEOUT_MS`) and `getByText('No archived discussions')` visible.
7. **Re-enter the created thread (real-daemon divergence — see below).** `.archive__back` → the active list now holds the promoted seed (Channels) and the restored non-promoted created row (Recent discussions), **both titled "Untitled"**. Scope the created row by its section affordance, not its title:
   `page.locator('.channel-list__row').filter({ has: page.locator('.channel-list__save') }).locator('.channel-list__row-open').click()`.
   `.channel-list__save` is present only on the single non-promoted row (the created conversation); the promoted seed carries `.channel-list__rename` instead. `onOpen` re-records `activeConversation` = the created row (already so; harmless re-set) and routes `thread`.
8. **Delete via the two-step confirm (AC5).** `.conversation__overflow-trigger` → `menuitem "Channel info"` → `button "Delete"` (exact) to arm → assert `getByText('Delete this conversation permanently? This cannot be undone.')` visible (pins the arm→confirm transition so the second click cannot race) → `button "Delete"` (exact) to confirm. `delete_conversation` → `conversation_deleted { id }` (correlated by `in_reply_to`) → re-list returns a list without the created row. `onDelete` calls `onClose()` — no `.status-sheet__close`. Then `.conversation__back` → list. Assert (all `timeout: ROUNDTRIP_TIMEOUT_MS` on the count):
   - `.channel-list__row-open` `toHaveCount(1)` — only one row remains.
   - `.channel-list__rename` `toHaveCount(1)` **and** `.channel-list__save` `toHaveCount(0)` — the survivor is the promoted seed; the non-promoted created row is gone. (Title-free: **do not** assert `getByText('Untitled')` count — the seed is also "Untitled".)
   - Then `.channel-list__archive` → `tab "Discussions (0)"` and `tab "Channels (0)"` visible — gone from the Archive view too.

### Divergences from the fake twin #452 (the only deltas; everything else is verbatim)

| Concern | #452 (fake) | #440 (real daemon) — why it differs |
|---|---|---|
| Fixture / seed | `conversationStateFake({ conversations: [SEED] })` via `launchPairedApp` | `realDaemon` fixture, `test.use({ spawnClaude:false, seedPromoted:true })`; a real spawned `pyry` replies to the same verbs |
| Starting screen | Lands **inside** the seed thread → opening `.conversation__back` | Lands on **`route='list'`** → **no** opening back; add a `.channel-list__rename` readiness gate under `HANDSHAKE_TIMEOUT_MS` |
| Seed title | `name: 'Seeded channel'` (unique) | Fixture seeds **no name** → seed renders "Untitled" too |
| Re-entry scope (step 7) | `.filter({ hasText: UNTITLED })` (title-unique) | `.filter({ has: '.channel-list__save' })` — title collides, so scope by the non-promoted-row affordance |
| Post-delete "survivor" assert | `getByText('Seeded channel')` visible + `getByText(UNTITLED)` count 0 | `.channel-list__rename` count 1 + `.channel-list__save` count 0 (count-delta / affordance, not title) |
| Pairing | handled inside `launchPairedApp` | explicit `encodePairingPayload` + Pair/Confirm drive (from `real-daemon-rename.spec.ts`) |
| Timeouts | single `ROUNDTRIP_TIMEOUT_MS = 15_000` | + `HANDSHAKE_TIMEOUT_MS = 45_000`, `SPEC_TIMEOUT_MS = 120_000` (four round-trips + real spawn) |

## State + concurrency model

- **No renderer state changes.** The spec drives the existing single-active-conversation model unchanged: `activeConversation` is set by the FAB create-nav (step 4) and re-set by the step-7 row-open; every thread-scoped action reads that slice. No new store, selector, or bridge.
- **Re-render is deterministic and already wired — a timeout is a real gap, not a flake.** `conversationListBridge.shouldRefreshList` re-lists on `conversation_updated` (archive/unarchive's correlated reply) and `conversation_deleted` (delete's correlated reply). Each mutation assertion auto-waits its round-trip via `toBeVisible/toHaveCount({ timeout })`. Same client path #439/rename proved green.
- **Teardown** is the fixture's LIFO `page → daemon → relay` chain (realDaemon.ts): the app closes first so its supervisor cannot churn-reconnect on the daemon/relay drop; the daemon subprocess (process-group reaped) and its two temp dirs are removed on setup failure, test failure, and success.

## Error handling / failure modes

- **Machine without `pyry`** → `testInfo.skip` (fixture skip-gate, realDaemon.ts:126–129) fires before any resource is created. An unrun test is the correct outcome on the agent machine — never a hard failure. No `claude`, no Anthropic credential required (`spawnClaude:false`).
- **A missing daemon handler** (`create_conversation` / `archive_conversation` / `unarchive_conversation` / `delete_conversation`) answers `unsupported` on the real wire → the corresponding assertion times out. **That is the #949-class gap this tier exists to catch — file it separately (mirroring #439's liveness note); do NOT paper over it** with a longer timeout or a softened assertion. Precondition: the `pyry` binary must be built with all four handlers registered (`create_conversation` #677; `archive_conversation` + `unarchive_conversation` #881; `delete_conversation` #822) on top of the #820/#854-inclusive tree the fixture already requires.
- **Secret hygiene (AC5).** Every assertion reads DOM text / visibility / counts only. No failure diagnostic serialises the pairing token, keys, or the transcript — the pairing payload is built exactly as `real-daemon-rename.spec.ts` does and never echoed; the fixture surfaces only content-free daemon stderr, and only on a startup failure before any message flows.

## Testing strategy

The spec **is** the test — no unit tests, no product code, so no `npm test` / `npm run typecheck` surface changes beyond the new file compiling. It runs under `npm run e2e:real-claude` (its `real-`-prefixed filename matches `playwright.real-claude.config.ts`'s `testMatch`) and is excluded from the default `npm run e2e` by `playwright.config.ts`'s identical-pattern `testIgnore`. `npm run build` (the salvage/QA gate) must stay green; the standalone e2e tsc pass applies (e2e/ is not covered by either project tsconfig — see the `e2e-not-typechecked-by-project-config` note; follow the sibling real-* spec's typecheck path).

Scenario coverage (one drive, five ACs):
- **AC1** — new `real-`-prefixed spec, `spawnClaude:false`, skips cleanly without `pyry`, no credential, correct config routing.
- **AC2** — FAB create → thread nav asserted (`.conversation__overflow-trigger`), active-list membership NOT asserted (Gap A).
- **AC3** — archive → Archive-view Discussions `0→1`, Channels stays `0`.
- **AC4** — restore → Archive-view Discussions `1→0` + empty-state copy.
- **AC5** — delete via two-step confirm → gone from active list (row-count `2→1`, survivor is the promoted seed via `.channel-list__rename`/`.channel-list__save` counts) and from the Archive view (both tabs `0`); DOM-only assertions, no secret serialised.

## Open questions

1. **Does the FAB create stay claude-less on the real daemon?** Evidence says **yes** — `create_conversation` mints a session *record* (#677) and #439 proved claude spawns lazily only on the first `send_message` (its no-op `-pyry-claude` placeholder is never invoked at boot). So the fixture's `exit 0` placeholder suffices as-is. **Do not pre-build a fallback** (Evidence-Based Fix Selection): escalate to #439's documented long-lived `exec sleep` placeholder *only if* the real daemon is observed to spawn a claude process on create. The developer confirms this the first time the spec runs against a live `pyry`.
2. **`cwd: null` → daemon default resolves claude-lessly?** The FAB sends `cwd: null` (no default workspace set under a fresh `--user-data-dir`) → the daemon resolves its default, which the harness points at `-pyry-workdir` (a real temp dir). Expected to resolve without a claude turn (create mints a record, not a turn). Same first-run confirmation as (1); a hang here is itself a reportable finding, not something to mask.
3. **Handler-tree freshness.** #881 (archive/unarchive) and #822 (delete) landed later than the #820/#854 tree the fixture's comment cites as its floor. Confirm the operator's `pyry` build includes them before treating any timeout as a client bug — a missing handler is exactly the signal to surface, not suppress.
