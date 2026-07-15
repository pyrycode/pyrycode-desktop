# 456 — fake e2e: workspace picker (recent-pick + create-folder)

**Size:** S (test-only — one new e2e spec + a small additive `conversationStateFake` fixture case/option). No production code, no new UI.
**Security-sensitive:** No (e2e/ only, no keys/sockets/tokens — the #451/#452/#423 posture).
**Design source:** N/A — drives already-shipped UI (#383 picker / #398 dialog), no visual change, no Figma reference.

Split from #424. Rides the merged fixtures #433 (`launchPairedApp`) + #434 (`conversationStateFake`). **Blocks #457** (the default-workspace spec reuses the `recent_workspaces` fake answer this ticket adds to the shared fixture).

---

## Files to read first

- `e2e/fixtures/conversationStateFake.ts:83-175` — the shared stateful fake this ticket extends. The switch already answers `change_workspace` → `conversation_updated` (152-158, **reused verbatim** for the recent-pick assertion) and `list_conversations` from held state. Add the `recent_workspaces` case here.
- `e2e/fixtures/conversationStateFake.ts:44-69` — reply-framing convention (`REPLY_ENVELOPE_ID`, `FIXED_TS`), `DEFAULT_SEED` (**PROMOTED** — the reason #456 must seed its own `is_promoted:false` row), and `ConversationStateFakeOptions` (the interface to extend with the new `recentWorkspaces` option).
- `e2e/save-as-channel-promote.spec.ts:71-100` — the `promoteFake` compose-over shape: decode each inbound, answer the spec-local verb (`create_workspace_folder` → `workspace_folder_created`, `in_reply_to: env.id`), delegate the rest to `conversationStateFake`. **Clone this**, adding the frame-capture push (this spec's one new element).
- `e2e/save-as-channel-promote.spec.ts:32-59` — `ROUNDTRIP_TIMEOUT_MS`, spec-local reply-framing constants, and the fixed `is_promoted:false` seed shape to copy.
- `e2e/fixtures/launchPairedApp.ts:60-97, 118-200` — `SEEDED_ROW` (a clickable `is_promoted:false` row), the `buildReplyFrames` override contract, the `PairedApp` handle (`{ page, app, daemon }`), and the land-on-thread drive. **Load-bearing:** the fake daemon runs in the TEST process (in-process forwarder + `startFakeDaemon`), so a spec-held capture array populated inside the scripted `buildReplyFrames` is directly readable from the test body.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:137-141, 191-197, 431-454` — the `WorkspaceChip` gate `isEmpty && conversation !== null && !conversation.is_promoted` (436), the chip's always-enabled "Change workspace" button that opens the picker (140, 442-450), and the picker mount reading `activeConversation` (191-197).
- `src/renderer/src/PairedShell.tsx:105-120` — **#448**: `onOpen` calls `setActiveConversation(conversation)` before `dispatch('open')`, so a `launchPairedApp` row-open lands a non-null active conversation → the chip gate is satisfiable from the landed thread (no FAB-create step). Requires the opened row be `is_promoted:false`.
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx:139-200, 234-274` — picker DOM (`.workspace-picker__row` per recent, `.workspace-picker__other` = "Create new folder"), `onChoose(path)` → `requestChangeWorkspace(sendCommand, conversation.id, path)` then `onClose` (249-256), `onCreateFolder` → opens `CreateFolderDialog` (260, 266-272). `RecentWorkspacesData` mounted picker-scoped (239) = a fresh `recent_workspaces` one-shot per open.
- `src/renderer/src/screens/conversation/CreateFolderDialog.tsx:46-108, 134-188` — dialog DOM (`.create-folder__input`, `.create-folder__create` disabled while name blank), `onCreate` → `createRequested` + `requestCreateWorkspaceFolder(sendCommand, conversation.cwd, name)` (181-184), the created-effect → `requestChangeWorkspace(sendCommand, conversation.id, roundTrip.path)` **verbatim** then `onCreated` (161-165).
- `src/renderer/src/store/recentWorkspacesBridge.ts:75-99` — `RecentWorkspacesData`: fires `recent_workspaces` once per mount, consumes `recentWorkspacesReceived`. A picker reopen = a fresh mount = a fresh request (the fake re-answers).
- `src/shared/wire/types.ts:546-556, 712-751` — exact wire shapes (do NOT drift): `RecentWorkspace {path, last_used_at}`, `RecentWorkspacesPayload {workspaces}`, `ChangeWorkspacePayload {conversation_id, cwd}`, `CreateWorkspaceFolderPayload {parent, name}`, `WorkspaceFolderCreatedPayload {path}`.
- `src/main/transport/inboundMessage.ts:978-991` + `597-606` — `recent_workspaces_list` decode requires only `{ workspaces: RecentWorkspace[] }` (each row needs `path` + `last_used_at`); **no `in_reply_to`** (emit it as a broadcast, like `conversation_updated`). Fail-closed on a bad row.
- `playwright.config.ts:9-14` — `testDir: './e2e'`, `testIgnore: /real-.*\.spec\.ts$/`. The new filename must NOT start with `real-` so `npm run e2e` picks it up (`package.json:16`).

---

## Context

Tier-1 fake-stack UI e2e for the workspace picker's two wire round-trips, neither covered today. The empty (pre-first-message) thread shows a `WorkspaceChip`; its "Change workspace" button opens the single `WorkspacePickerSheet` surface, which carries both flows:

1. **Recent-pick** — the picker mounts `RecentWorkspacesData` (fires `recent_workspaces`), renders the reply as `.workspace-picker__row` rows; a row click dispatches `change_workspace { conversation_id, cwd }` with the row's path and closes the picker.
2. **Create-folder** — "Create new folder" opens `CreateFolderDialog`, which sends `create_workspace_folder { parent, name }` (parent = the active conversation's cwd); on the `workspace_folder_created { path }` reply the created-effect **auto-chains** `change_workspace` with the daemon-returned path **verbatim**, then closes the whole picker tree.

The stateful fake (#434) already answers `change_workspace` and `create_conversation` but falls to `default: return []` for `recent_workspaces` and `create_workspace_folder`. This ticket adds those two answers and drives the real picker over them, proving the full renderer → preload → main → transport → fake round-trip — including the reply-driven `workspace_folder_created` → app-emitted `change_workspace` chain, which behaviour unit tests cannot cover.

**Why the assertion is the outbound wire frame, not a rendered reflection.** The changed cwd has no DOM surface: `change_workspace`'s reply is `conversation_updated`, a no-op for `activeConversationStore`, so the chip's cwd (snapshotted at open) never updates; the channel-list row renders name + time only, never cwd. "The list reflects the new workspace" is therefore the same unrealizable-active-list trap that routed #440 back. The load-bearing observable is instead **the inbound frame the fake received**, captured spec-locally.

**Realizability precondition (load-bearing).** The chip gate is `isEmpty && conversation !== null && !conversation.is_promoted`. Post-#448, a `launchPairedApp` row-open records the clicked row as the active conversation, so the landed thread has a non-null active conversation and the picker's row/create actions (gated on it) are enabled — **provided the seeded row is a discussion (`is_promoted: false`)** (the `conversationStateFake` default seed is promoted → chip renders null → undrivable) **and no message is sent** (keeps `isEmpty` true). `launchPairedApp` sends no message and the fake returns `[]` for the entry snapshot request, so the thread stays empty.

---

## Design

Two deliverables, both under `e2e/`:

### A. Shared fixture extension — `e2e/fixtures/conversationStateFake.ts` (additive)

Add the `recent_workspaces` answer here (not spec-local) because **#457 reuses it**. Purely additive: no existing spec opens the picker or sends `recent_workspaces`, so none hits the new case; the new option is optional.

1. Extend the type import to include `RecentWorkspace` and `RecentWorkspacesPayload`.
2. Add one optional option:
   - `recentWorkspaces?: RecentWorkspace[]` on `ConversationStateFakeOptions` — the seeded recent list; default `[]` (a valid loaded-empty answer). Capture it in the closure alongside `list` (a plain `const`, not mutable — `recent_workspaces` is read-only).
3. Add one switch case:
   - `case 'recent_workspaces': return [recentWorkspacesListFrame(recents)]`
4. Add one framing helper (mirror `conversationsFrame`):
   - `recentWorkspacesListFrame(workspaces: RecentWorkspace[]): Uint8Array` — encodes `{ id: REPLY_ENVELOPE_ID, type: 'recent_workspaces_list', ts: FIXED_TS, payload: { workspaces } satisfies RecentWorkspacesPayload }`. **No `in_reply_to`** (broadcast-shaped; the app consumes it via the correlation-free `recentWorkspacesReceived` event, and the decoder does not require correlation).

`create_workspace_folder` stays **spec-local** (single consumer — #457's Settings default picker has its "Create new folder" entry disabled, so #456 is the only caller; the #423 `promoteFake` precedent).

### B. New spec — `e2e/workspace-picker.spec.ts`

Imports `test, expect` from `./fixtures/launchPairedApp`, `conversationStateFake` from the fixture, and `decodeEnvelope, encodeEnvelope` + the wire payload types from `../src/...` (the relative-path idiom — `@shared` is not available to e2e). Filename does NOT match `real-*`.

**Two `test()` blocks** (the #423 shape), each its own `launchPairedApp` launch + its own single `is_promoted:false` seed + its own capture array. Two isolated blocks keep each assertion crisp with no cross-flow array bookkeeping; the extra launch (~pairing cost) is the accepted price, matching the sibling suite. (A single continuous drive is realizable but needs mid-drive array-clearing; the two-block shape is idiomatic here.)

**The capturing compose-over fake** (spec-local factory, clones `promoteFake` + adds capture):

```
function capturingWorkspaceFake(
  seed: ConversationSummary,
  recents: RecentWorkspace[],
  captured: Envelope[]          // spec-owned; the factory pushes every decoded inbound in wire order
): (inbound: Uint8Array) => Uint8Array[]
```

Behavior (contract, not implementation):
- Construct `const stateFake = conversationStateFake({ conversations: [seed], recentWorkspaces: recents })`.
- Return `(inbound) => { const env = decodeEnvelope(inbound); captured.push(env); ... }`.
- If `env.type === 'create_workspace_folder'`, return one spec-local `workspace_folder_created { path: CREATED_PATH }` frame (`in_reply_to: env.id`, the #423 correlation-fidelity shape).
- Otherwise delegate to `stateFake(inbound)` — which now answers `recent_workspaces`, `change_workspace`, and `list_conversations`.
- The double-decode (capture + delegate) is pure and harmless (the #423 note).

Fixed deterministic literals only (the fakeDaemon convention — no `Date.now()`, no randomness):
- `SEED` — one `is_promoted:false` discussion row (id, name, `cwd`, timestamps as fixed literals). Its `cwd` is the `parent` the create-folder request must carry.
- `RECENTS` — 2+ `RecentWorkspace` rows with **distinct** paths where no path is a substring of another (so a `hasText` row locator resolves uniquely — the #423 substring caution).
- `CREATED_PATH` — a fixed daemon-returned path **deliberately distinct** from `SEED.cwd + '/' + <typed name>`. The divergence proves the chained `change_workspace` carries the daemon-returned path verbatim, never a client-reconstructed preview (the #288 lesson).
- `FOLDER_NAME` — a whitespace-free name (so the trimmed request name equals it; trimming itself is unit-covered).

---

## State + concurrency model

- **No production state change.** The fixture holds one `const recents` per factory call (read-only) alongside the existing mutable `list`.
- **Capture channel.** The `captured` array lives in the test process (the fake daemon runs there via the loopback forwarder), so the scripted `buildReplyFrames` writes it synchronously as each inbound frame is decrypted and forwarded. The test body reads it directly — no IPC, no daemon-handle accessor (the `FakeDaemon` handle exposes no received-frame log; the spec owns the closure).
- **Async arrival.** Frames traverse renderer → preload → main → Noise → loopback before reaching the fake, so a captured frame appears after the click resolves. Assert with `expect.poll(() => captured.find/filter(...))` (not a bare `expect`), with `ROUNDTRIP_TIMEOUT_MS` headroom for a cold runner.
- **Picker reopen semantics.** `RecentWorkspacesData` is picker-scoped; each open is a fresh mount → a fresh `recent_workspaces` one-shot → the fake re-answers. (Only relevant if a future single-drive variant reopens the picker; the two-block shape never reopens.)

---

## Error handling / failure modes

- **Fail-closed decode.** The production `recent_workspaces_list` decoder throws on a non-array `workspaces` or a bad row; the fake emits a well-formed `{ workspaces: RecentWorkspace[] }`, so a green run proves the real decoder accepted it. Trusted input in the fake (the app's own outbound) → per-verb cast, no defensive narrowing (the existing fixture posture).
- **Realizability guard as an explicit assertion.** Before the picker drive, assert the "Change workspace" button is visible/enabled (the chip rendered) — this pins the #448-dependent precondition; a regression that stops row-open from setting the active conversation fails here with a clear signal rather than a downstream mystery.
- **Chain-hang as a caught failure.** If the fake failed to answer `create_workspace_folder`, `newFolderStore` would hang in-flight, the chained `change_workspace` would never fire, and the two-frame ordered assertion (plus picker disappearance) would time out — the same end-to-end proof #423 relies on.
- **Secret hygiene (carried verbatim).** Every assertion reads DOM visibility/count and captured wire frames only. `SEED`/`RECENTS`/`CREATED_PATH`/`FOLDER_NAME` are non-secret display literals; the pairing plumbing (synthetic token, fake static key) lives in `launchPairedApp` and is never echoed. No failure diagnostic serializes a token, key, or plaintext; remote paths are opaque, never resolved locally (the #380/#139 posture).

---

## Testing strategy

The spec **is** the test. Runs under `npm run e2e` (which is `npm run build && playwright test` — `build` is the salvage/QA gate). Scenarios as bullets (the developer writes them in Playwright idiom):

**Block 1 — recent-pick:**
- `launchPairedApp({ buildReplyFrames: capturingWorkspaceFake(SEED, RECENTS, captured) })`; the drive lands on the seeded row's empty thread.
- Assert the "Change workspace" button is visible/enabled (chip rendered — the realizability gate). Click it.
- Assert `.workspace-picker__row` count === `RECENTS.length` (the `recent_workspaces` → `recent_workspaces_list` round-trip rendered).
- Click the row for a chosen recent (`.workspace-picker__row` filtered by that path's text — unique by the distinct-path seed).
- `expect.poll` the captured `change_workspace` payload `toEqual { conversation_id: SEED.id, cwd: <chosen path> }`.
- Assert `.workspace-picker__row` count === 0 (picker closed by `onChoose`'s `onClose`).

**Block 2 — create-folder:**
- Fresh `launchPairedApp` with the same seed + recents + a fresh `captured`.
- Open the picker (assert the button, click it). Click `.workspace-picker__other` ("Create new folder …").
- Assert `.create-folder` dialog visible. Fill `.create-folder__input` with `FOLDER_NAME`. Click `.create-folder__create`.
- `expect.poll` that the captured verbs (filtered to `create_workspace_folder` + `change_workspace`) are `['create_workspace_folder', 'change_workspace']` **in order**.
- Assert the `create_workspace_folder` payload `toEqual { parent: SEED.cwd, name: FOLDER_NAME }`.
- Assert the chained `change_workspace` payload `toEqual { conversation_id: SEED.id, cwd: CREATED_PATH }` (verbatim daemon path, distinct from `SEED.cwd/FOLDER_NAME` — the #288 proof).
- Assert `.create-folder` count === 0 AND `.workspace-picker__row` count === 0 (the whole picker tree unmounted — AC's "picker/dialog closes").

No new unit tests: the fixture case is exercised end-to-end by the spec, and the picker/dialog/bridge units already have their own suites. `npm run typecheck` covers the fixture's type additions.

---

## Open questions

- **`create_workspace_folder` placement** — resolved: spec-local (single consumer; #457's create entry is disabled). If a later ticket needs it shared, promote it to the fixture then (evidence-based, not pre-emptively).
- **One drive vs. two blocks** — resolved: two `test()` blocks (crisp per-flow assertions, no array bookkeeping). Revisit only if launch cost becomes a suite-time problem.
- **`RECENTS` count** — 2 rows suffices to prove render + a specific-path pick; the developer may use 2–3, keeping paths mutually non-substring.
