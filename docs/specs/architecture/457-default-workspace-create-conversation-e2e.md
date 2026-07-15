# 457 — fake e2e: default-workspace preference applied to create_conversation

**Size:** S (test-only — one new e2e spec file, a single `test()` block, ~130–160 LOC). No production code, no fixture change, no new exported types.
**Security-sensitive:** No (e2e/ only, no keys/sockets/tokens — the #456/#451/#452/#423 posture). No `security-sensitive` label → the security-review pass is skipped.
**Design source:** N/A — drives already-shipped UI (#404 Settings row / #383 picker / #242 FAB), no visual change, no Figma reference.

Split from #424. Rides the merged fixtures #433 (`launchPairedApp`) + #434/#456 (`conversationStateFake` with the `recentWorkspaces` option). Blocked by #456 (merged, PR #458) — which is satisfied by the **shared fixture**, not by riding #456's picker spec (see Context). Blocks nothing.

---

## Files to read first

- `e2e/save-as-channel-promote.spec.ts:83-100` — the `promoteFake` compose-over shape to clone: construct `conversationStateFake({...})`, then `(inbound) => { const env = decodeEnvelope(inbound); … return stateFake(inbound) }`. **#457's wrapper is strictly SIMPLER**: insert `captured.push(env)` after the decode and delegate EVERY verb to `stateFake` — no spec-local `create_workspace_folder` reply (that was #456's addition; #457 sends no verb the shared fake doesn't already answer).
- `e2e/save-as-channel-promote.spec.ts:1-32` — the import idiom (`test, expect` from `./fixtures/launchPairedApp`; `conversationStateFake` from `./fixtures/conversationStateFake`; `decodeEnvelope` from `../src/main/transport/codec`; wire types from `../src/shared/wire/types` — the `@shared` alias is unavailable to e2e), the `ROUNDTRIP_TIMEOUT_MS` headroom constant, and the fixed-literal seed shape.
- `e2e/fixtures/conversationStateFake.ts:68-101` — the merged `recentWorkspaces?: RecentWorkspace[]` option (default `[]`). Pass `conversationStateFake({ conversations: [SEED], recentWorkspaces: RECENTS })` — no fixture edit needed.
- `e2e/fixtures/conversationStateFake.ts:110-126, 170-174` — the two arms this spec exercises through the fake: `create_conversation` → `conversation_created` (mints a row with `cwd: payload.cwd ?? DEFAULT_CREATED_CWD` — carries the chosen cwd verbatim; this reply is what fires the nav-into-thread), and `recent_workspaces` → `recent_workspaces_list { workspaces: recents }`.
- `e2e/fixtures/launchPairedApp.ts:60-97` — `SEEDED_ROW` (a clickable `is_promoted:false` row), the `buildReplyFrames` override contract (a scripted frames-builder OVERRIDES the fixture's default one-row seed, so the wrapper OWNS answering the auto-fired `list_conversations` — `conversationStateFake` does exactly that from its seeded list), and the `PairedApp` handle (`{ page, app, daemon }`).
- `e2e/fixtures/launchPairedApp.ts:118-200` — the land-on-thread drive (real pairing → list → `.channel-list__row-open` click → thread, Send enabled) and, **load-bearing twice over:** (a) the fake daemon runs in the TEST process (in-process forwarder + `startFakeDaemon`), so a spec-held `captured` array written inside the scripted `buildReplyFrames` is directly readable from the test body; (b) the throwaway per-run `--user-data-dir` (`mkdtemp`, line 127) means `localStorage` starts empty every run — the default-workspace key is unset, so the Settings row renders "scratch" with no reset step.
- `src/renderer/src/screens/settings/DefaultWorkspaceRow.tsx` (whole, 141 lines) — the Settings drive target. `.settings__default-workspace-row` button opens `DefaultWorkspacePickerSheet`; `.settings__default-workspace-value` shows the stored path or the `'scratch'` placeholder when the store is `null` (line 53); `onChoose(path)` → `defaultWorkspaceStore.getState().setDefaultWorkspace(path)` then `onClose()` — **NO daemon command** (lines 133-136); the picker is mounted with NO `onCreateFolder`, so its "Create new folder" entry renders disabled.
- `src/renderer/src/screens/channels/ChannelList.tsx:47, 71, 145-173, 203-231` — `.channel-list__settings` (aria-label "Settings", opens Settings), and the `.channel-list__fab` (aria-label "New discussion") whose click calls `requestNewConversation(window.pyry.sendCommand, defaultWorkspace)` reading the reactive default-workspace slice.
- `src/renderer/src/store/conversationCreatedBridge.ts:23-31, 81-95` — `requestNewConversation` sends `create_conversation { is_promoted: false, name: null, cwd: defaultCwd }` (the outbound frame this spec asserts); `useConversationCreatedNav` subscribes to `conversationCreated` → drives the list→thread `open` nav.
- `src/renderer/src/store/defaultWorkspaceStore.ts:36, 47-57, 77-89` — the localStorage key `pyry.defaultWorkspace`, the `typeof window` import-safety guard, and the singleton `setDefaultWorkspace` write-then-set. The FIRST e2e to drive a localStorage-backed store — determinism comes free from launchPairedApp's fresh user-data-dir.
- `src/renderer/src/PairedShell.tsx:83-125` — the nav wiring: `.settings__back` / `.conversation__back` both dispatch `back` → the `list` route; `useConversationCreatedNav((created) => { setActiveConversation(created); dispatch({ type: 'open' }) })` drives the nav into the created thread on the fake's `conversation_created` reply.
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx:139-200` — the shared picker view the Settings sheet reuses: one `.workspace-picker__row` per recent (enabled because the Settings sheet supplies `onChoose`), each row's `.workspace-picker__path` is the opaque path text (the `hasText` locator target), and the `activeCwd` "default" pill (irrelevant here — the default starts `null`, so no pill).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:121` — the `.conversation` root element = the nav-into-thread assertion target.
- `src/shared/wire/types.ts:546-556, 570-574` — the exact wire shapes (do NOT drift): `RecentWorkspace { path, last_used_at }`, `RecentWorkspacesPayload { workspaces }`, `CreateConversationPayload { is_promoted: boolean|null, name: string|null, cwd: string|null }` (all three present-and-nullable on the wire).
- `playwright.config.ts:9-14` + `package.json:16` — `testDir: './e2e'`, `testIgnore: /real-.*\.spec\.ts$/`. The new filename must NOT start with `real-` so `npm run e2e` (`npm run build && playwright test`) picks it up.
- Standing lesson `[[e2e-not-typechecked-by-project-config]]` — neither tsconfig includes `e2e/`, so `npm run typecheck` does NOT cover this file. Validate types with a standalone `tsc` pass over `e2e/**` (as #456 did); do not introduce new `tsc` errors.

---

## Context

Tier-1 fake-stack UI e2e proving one client preference reaches the wire: the Settings "Default workspace" choice must land in the `create_conversation` payload's `cwd` when the FAB creates the next discussion. The full path is already shipped and unit-covered per hop; no e2e drives it end-to-end. Zero production code — this spec drives merged UI over the merged fakes.

**The path under test.** The Settings "Default workspace" row (#404) opens the Settings variant of `WorkspacePickerSheetView`; choosing a recent row calls `onChoose(path)`, which writes the client-owned `defaultWorkspaceStore` (#403) and closes the picker — **no wire traffic on the choose** (the row records a client pref, it does not dispatch the daemon `change_workspace`; the only frame the picker emits is its own `recent_workspaces` fetch on open). The channel-list FAB (#242) then reads that store and calls `requestNewConversation(sendCommand, defaultWorkspace)`, emitting `create_conversation { is_promoted: false, name: null, cwd: <default> }`.

**Why blocker #456 is satisfied by the shared fixture, not by riding #456's spec.** The `recent_workspaces` → `recent_workspaces_list { workspaces }` answer landed in the SHARED `conversationStateFake` (merged in #456): passing `recentWorkspaces: RECENTS` answers the picker's fetch from the seeded list. Setting a default through the real Settings UI needs a non-empty recents list, because the Settings picker's "Create new folder" entry is disabled (no `onCreateFolder` wired), so a recent row is the only selectable way to choose. This spec is a fresh consumer of that shared option — no fixture edit.

**Why the assertion is the outbound wire frame.** The chosen `cwd` never surfaces as thread/list DOM text (the #440/#456 unrealizable-active-list trap for cwd). The load-bearing observable is the `create_conversation` frame the fake receives, captured spec-locally by wrapping the `buildReplyFrames` passed to `launchPairedApp`: decode each inbound envelope into a spec-owned array, then delegate to `conversationStateFake`. The fake daemon runs in the test process, so the array is directly readable; frames arrive async, so assert with `expect.poll`. Two supporting DOM observables keep the drive honest: the Settings row's value flips from `'scratch'` to the chosen path (proving the store write landed), and the FAB create navigates into the new thread (proving the fake's `conversation_created` reply drove `useConversationCreatedNav`).

**Realizability — seed promotion is IRRELEVANT here (a correction vs #456).** #456's `is_promoted:false` seed constraint was specific to the thread `WorkspaceChip`'s self-gate. #457 never touches that chip: it drives the SETTINGS picker, which gates on nothing beyond a non-empty recents list. The seed only needs ≥1 clickable row so `launchPairedApp` can land in a thread (any promotion state renders `.channel-list__row-open`). A single `is_promoted:false` row is used for simplicity; either state works.

---

## Design

One deliverable, under `e2e/`: a new spec file (e.g. `e2e/default-workspace.spec.ts`; any non-`real-*` name). No fixture change — the `recentWorkspaces` option is already merged.

### The capturing compose-over fake (spec-local, PURE decode + push + delegate)

A spec-local factory that clones `promoteFake`'s compose-over shape and adds ONE line — the frame capture — with NO spec-local verb handling:

```
function capturingDefaultWorkspaceFake(
  seed: ConversationSummary,
  recents: RecentWorkspace[],
  captured: Envelope[]           // spec-owned; the factory pushes every decoded inbound in wire order
): (inbound: Uint8Array) => Uint8Array[]
```

Behavior (contract, not implementation):
- Construct `const stateFake = conversationStateFake({ conversations: [seed], recentWorkspaces: recents })`.
- Return `(inbound) => { const env = decodeEnvelope(inbound); captured.push(env); return stateFake(inbound) }`.
- Every verb the drive sends (`list_conversations`, `recent_workspaces`, `create_conversation`) is already answered by the shared fake — the wrapper adds no arms. `create_conversation` → `conversation_created` (the shared fake's arm) is what fires the nav-into-thread.
- The double-decode (capture, then `stateFake` decodes again) is pure and harmless (the #423/#456 note). `decodeEnvelope` throwing here would be a genuine app-under-test bug — let it surface, don't swallow.

### One `test()` block

A single continuous drive, not two blocks. Rationale: the drive sets a default, then creates once — one launch, one `captured` array, no mid-drive array bookkeeping, and (load-bearing) one launch keeps ONE throwaway user-data-dir, so `localStorage` stays empty for the "scratch" baseline assertion. (#456 needed two blocks only because promotion is one-way and its two flows couldn't share a seed; #457 has one linear flow.)

Fixed deterministic literals only (the fakeDaemon convention — no `Date.now()`, no randomness):
- `SEED` — one `is_promoted:false` discussion row (id, name, cwd, timestamps as fixed literals), so `launchPairedApp` lands in its thread.
- `RECENTS` — 2+ `RecentWorkspace` rows with **distinct, mutually-non-substring** paths (so a `hasText` row locator resolves uniquely — the #423 substring caution). Their `path`s are the picker rows.
- `CHOSEN` — the `RECENTS` path the drive clicks; the value the `create_conversation.cwd` assertion expects verbatim.

`ROUNDTRIP_TIMEOUT_MS` (~15s, the sibling value) gives `expect.poll` / element waits headroom on a cold runner.

---

## State + concurrency model

- **No production state change.** Zero production code; no fixture edit (the `recentWorkspaces` option is merged). The spec constructs a per-run `captured: Envelope[]` and reads the merged stores through the real UI.
- **Capture channel.** `captured` lives in the test process (the fake runs there via the loopback forwarder), so the scripted `buildReplyFrames` pushes each inbound synchronously as it is decrypted and forwarded. The test body reads it directly — no IPC, no daemon-handle accessor (`FakeDaemon` exposes no received-frame log; the spec owns the closure).
- **localStorage determinism.** `defaultWorkspaceStore` reads `pyry.defaultWorkspace` at construction. `launchPairedApp`'s fresh `mkdtemp` user-data-dir means the key is absent → the store starts `null` → the Settings row renders `'scratch'`. The single-launch shape preserves this baseline (a second launch would be a fresh empty dir anyway, but one launch needs no reasoning about it).
- **Async arrival.** Frames traverse renderer → preload → main → Noise → loopback before reaching the fake, so a captured frame appears after the click resolves. Assert with `expect.poll(() => captured.find(e => e.type === 'create_conversation')?.payload)`, not a bare `expect`.
- **Frame ordering underwrites the negative guard.** The single in-order Noise channel means every frame the Settings choose could emit is captured strictly BEFORE the FAB's `create_conversation`. So once `create_conversation` is polled and seen, `captured` already holds any choose-emitted frame — making an "absence of `change_workspace`" assertion deterministic rather than a race (see Testing strategy).

---

## Error handling / failure modes

- **Fail-closed decode, proven green.** The production `recent_workspaces_list` decoder throws on a non-array `workspaces` or a bad row; the shared fake emits a well-formed `{ workspaces }`, so a green picker render proves the real decoder accepted it. Trusted input in the fake (the app's own outbound) → the existing per-verb posture, no defensive narrowing added.
- **Chain-hang as a caught failure.** If the fake failed to answer `create_conversation`, `useConversationCreatedNav` would never fire and the nav-into-thread assertion would time out; if it failed to answer `recent_workspaces`, the picker would render zero rows and the row-click would time out. Both are end-to-end proofs, the same shape #423/#456 rely on.
- **Secret hygiene (carried verbatim).** Every assertion reads DOM text/visibility/count and captured wire frames only. `SEED`/`RECENTS`/`CHOSEN` are non-secret display literals; the pairing plumbing (synthetic token, fake static key) lives in `launchPairedApp` and is never echoed. No failure diagnostic serializes a token, key, or plaintext; remote paths (`RECENTS`/`CHOSEN`) are opaque display strings, never resolved locally (the #380/#139 posture).

---

## Testing strategy

The spec **is** the test — one `test()` block under `npm run e2e` (which runs `npm run build` first — the salvage/QA gate). Scenarios as bullets (the developer writes them in Playwright idiom):

- `const captured: Envelope[] = []`; `launchPairedApp({ buildReplyFrames: capturingDefaultWorkspaceFake(SEED, RECENTS, captured) })`; the drive lands on `SEED`'s empty thread.
- Navigate to the channel list: click `.conversation__back`.
- Baseline: open Settings (`.channel-list__settings`, aria "Settings"), then assert `.settings__default-workspace-value` reads `'scratch'` (the null-store placeholder, proving the localStorage key started empty).
- Open the Settings picker: click `.settings__default-workspace-row`. This mounts `RecentWorkspacesData` → fires `recent_workspaces` → the fake answers `recent_workspaces_list`.
- Assert `.workspace-picker__row` count === `RECENTS.length` (the `recent_workspaces` → `recent_workspaces_list` round-trip rendered).
- Choose: click the `.workspace-picker__row` filtered by `CHOSEN`'s path text (`.locator('.workspace-picker__row', { hasText: CHOSEN })` — unique by the distinct-path seed).
- Assert the store write landed and the picker closed: `.settings__default-workspace-value` now reads `CHOSEN` (flipped off `'scratch'`) AND `.workspace-picker__row` count === 0.
- Return to the list: click `.settings__back` (aria "Back") — one screen is mounted at a time, so the shared "Back" accessible name resolves uniquely.
- Create the discussion: click `.channel-list__fab` (aria "New discussion").
- **Primary assertion** — `expect.poll(() => captured.find(e => e.type === 'create_conversation')?.payload).toEqual({ is_promoted: false, name: null, cwd: CHOSEN })` (with `ROUNDTRIP_TIMEOUT_MS` headroom). This is AC3's load-bearing proof: the chosen default reached the wire.
- **Nav proof** — assert the app navigated into the created thread: `.conversation` is visible (the fake's `conversation_created` reply drove `useConversationCreatedNav`). Equivalently the Send button re-enables; `.conversation` visibility is the crispest.
- **Negative guard (include — deterministic per State + concurrency model)** — assert `captured.filter(e => e.type === 'change_workspace')` has length 0. The Settings choose writes the store with no wire traffic, unlike #456's thread picker; because any choose-emitted frame would precede the already-captured `create_conversation` on the in-order channel, this absence is a race-free assertion, placed AFTER the primary poll.

No new unit tests: the merged fixture case and the merged UI are exercised end-to-end here, and the picker/row/store/bridge units carry their own suites. Type additions are none (spec-local `Envelope`/wire-type imports are existing types); the standalone `tsc` pass over `e2e/**` guards against a new type error.

---

## Open questions

- **`RECENTS` count** — 2 distinct, mutually-non-substring paths suffice to prove render + a specific-path pick; the developer may use 2–3, keeping paths non-substring.
- **Nav-proof selector** — `.conversation` visibility is specified; if a future ConversationScreen refactor renames the root, the Send-button-enabled wait is the equivalent fallback (both mean "route flipped to thread").
