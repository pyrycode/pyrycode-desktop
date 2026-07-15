# 441 — real-daemon e2e: workspace actions (recent-workspaces + create-folder) over the real wire

**Ticket:** [#441](https://github.com/pyrycode/pyrycode-desktop/issues/441) · Size **S** · split from #430
**Labels:** `enhancement`, `size:s` — **not** `security-sensitive`, no `## Figma` section.
**Design source:** N/A — drives already-shipped UI (#383 picker / #398 dialog); no visual change, no Figma reference. AC5 (secret hygiene) is a spec-content requirement (assertions read DOM only), **not** the `security-sensitive` review gate — that label is absent, so no security-review pass applies (the #440 / #452 ruling).

This is a **test-only** ticket: one new Playwright e2e spec `e2e/real-daemon-workspace.spec.ts`, **zero production code**, **no fixture change**. It is the real-daemon twin of the fake-stack spec #456 (`workspace-picker.spec.ts`), swapping the in-process `conversationStateFake` for the #439 `realDaemon` fixture (a real spawned claude-less `pyry` on #251's content-blind routing relay). It exists to catch the `promote_conversation` class of gap (pyrycode/pyrycode#949): a daemon that defines the wire type + registry op but registers **no handler** answers `unsupported` on the real wire, while the whole fake suite stays green because a fake answers anything.

**Live-verified before writing (the #440 OQ discipline — resolved against the real stack, not pre-built fallbacks):** the actual `pyry` binary the harness spawns (`~/.local/bin/pyry`) has `recent_workspaces` / `recent_workspaces_list` / `create_workspace_folder` / `workspace_folder_created` all compiled in (verified via `strings`), and the daemon-side specs #982 / #887 confirm both handlers are wired (`cmd/pyry/relay.go`). Both open questions are resolved in the **Open questions** section — read it before the Design.

---

## Files to read first

Codegraph is not initialized for this repo (see the `codegraph-not-initialized` project memory), so this list was built by Read/grep + QMD, not `codegraph_context`. This spec is **simpler** than its fake twin #456: it captures **no** outbound wire frames (the daemon is a separate process behind the content-blind relay — the in-process capture technique is unavailable) and imports **no** wire types. Every assertion is DOM text / visibility / count.

- `e2e/real-daemon-conversation-lifecycle.spec.ts` (whole, ~193 lines) — **the closest real-daemon sibling; clone its skeleton.** Take verbatim: the imports (`test, expect, encodePairingPayload` from `./fixtures/realDaemon`), the hygiene header, the pairing drive (paste payload → Pair → Confirm fingerprint), and the three timeout constants (`HANDSHAKE_TIMEOUT_MS`, `ROUNDTRIP_TIMEOUT_MS`, `SPEC_TIMEOUT_MS`). **Diverge in two places:** (a) `test.use({ spawnClaude:false, seedPromoted:false })` — a *discussion* seed, not a promoted channel; (b) the readiness gate is `.channel-list__save`, not `.channel-list__rename` (see ChannelList below), and there is **no FAB-create** — this spec opens the *seeded* row.
- `e2e/real-daemon-rename.spec.ts:47-70` — the same pairing block + readiness-gate shape at a smaller scale; a second reference for the `encodePairingPayload({ server, relay: `${relay.url}/v1/client`, token, server_static_pubkey })` construction and the `.channel-list__*` visibility gate under `HANDSHAKE_TIMEOUT_MS`.
- `e2e/workspace-picker.spec.ts` (whole, #456 — **the fake twin**) — the two provable halves this spec mirrors: open the picker from the "Change workspace" chip, render the recent-workspaces reply, then create a folder and watch the picker close. **Do NOT clone its capture machinery** (`capturingWorkspaceFake`, the `Envelope[]` array, `expect.poll(() => captured.find(...))`) — those assert an in-process outbound frame, unavailable on the real tier. Keep only the DOM-facing halves.
- `e2e/fixtures/realDaemon.ts:90-93, 106-111` — the `spawnClaude` / `seedPromoted` option fixtures (both additive; `seedPromoted:false` = a non-promoted "Recent discussion" seed). `:183-185` — the harness workdir (`join(daemonHome, 'work')`, `mkdir … mode 0o700`) that becomes the seed's `cwd`. `:430-448` — `seedRegistry` writes the one bound conversation with `"cwd": <workdir>` and `is_promoted:<seedPromoted>`. **Confirm: no change needed** — the workdir is `$HOME/work` (writable, within `$HOME`), exactly what `create_workspace_folder` requires (Open questions, OQ-b).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:137-141` — the `WorkspaceChip` mount: `isEmpty={items.length === 0}`, `onChange={() => setPickerOpen(true)}`. `:191-197` — the picker mount reading `activeConversation`. **`:431-454`** (via `WorkspaceChip`) — the gate `if (!isEmpty || conversation === null || conversation.is_promoted) return null` and the `aria-label="Change workspace"` button. The chip renders **iff** the opened thread is empty AND its conversation is non-null AND non-promoted — the realizability precondition (Open questions, "the crux").
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx:139-200` — the **three recent states** (`workspaces === null` → not-loaded: *no* row and *no* empty copy; `[]` → `.workspace-picker__empty` "No recent workspaces"; rows → one `.workspace-picker__row` each) and the **always-present** `.workspace-picker__other` create-folder entry (181-195). `:234-274` — `RecentWorkspacesData` mounted picker-scoped (a fresh `recent_workspaces` one-shot per open), and `CreateFolderDialog` mounted with `onCreated = onClose` (the picker's own close → unmounts the whole tree).
- `src/renderer/src/screens/conversation/CreateFolderDialog.tsx:46-108, 134-188` — dialog DOM (`.create-folder`, `.create-folder__input`, `.create-folder__create` disabled while name blank); `onCreate` → `createRequested` + `requestCreateWorkspaceFolder(sendCommand, conversation.cwd, name.trim())`; the created-effect (161-165) fires **only** on `roundTrip.status === 'created'` (i.e. on the daemon's `workspace_folder_created`), auto-chains `change_workspace` with the **returned** path, then calls `onCreated`. The picker close is thus **reply-gated** on `workspace_folder_created`.
- `src/renderer/src/screens/channels/ChannelList.tsx:247, 266-267, 315, 326, 348` — `partitionByPromotion` splits promoted → "Channels" (`.channel-list__rename`) / non-promoted → "Recent discussions" (`.channel-list__save`). Every row wraps `.channel-list__row-open`. A `seedPromoted:false` seed therefore renders **`.channel-list__save`** (the readiness gate) and one clickable `.channel-list__row-open`.
- `playwright.config.ts:16` (`testIgnore: /real-.*\.spec\.ts$/`) + `playwright.real-claude.config.ts:11` (`testMatch: /real-.*\.spec\.ts$/`, `timeout: 300_000`) + `package.json:16-17` — the filename **must** start with `real-` so the default `npm run e2e` ignores it and `npm run e2e:real-claude` selects it (AC4).

**Lessons / environment (grep/Read won't surface these):** e2e is **not** typechecked by any project tsconfig; a fresh worktree needs `npm install` before `npm run e2e:real-claude`; run the built binary via `./node_modules/.bin/playwright`, never `npx`. This spec imports **only** from `./fixtures/realDaemon`, so the "`@shared` unavailable in e2e" hazard does not bite (no `../src/...` wire-type imports).

---

## Context

Tier-2 real-daemon UI e2e for the workspace picker's two wire round-trips, currently proven only on the fake stack (#456). The empty (pre-first-message) thread of a **discussion** conversation shows a `WorkspaceChip`; its "Change workspace" button opens the single `WorkspacePickerSheet`, which carries both flows:

1. **Recent-workspaces** — the picker mounts `RecentWorkspacesData` (fires `recent_workspaces`); the daemon replies `recent_workspaces_list`, which the picker resolves out of its not-loaded state into either `.workspace-picker__row` rows or the `.workspace-picker__empty` copy.
2. **Create-folder** — "Create new folder …" opens `CreateFolderDialog`, which sends `create_workspace_folder { parent, name }` (parent = the active conversation's cwd); on the daemon's `workspace_folder_created { path }` reply the created-effect auto-chains `change_workspace` with the returned path **verbatim**, then closes the whole picker tree.

**Why the daemon must be real.** A fake answers anything, so it cannot expose a daemon that declares these verbs but registers no handler (#949's exact shape). This spec pairs against a *real* spawned `pyry`, so a missing `recent_workspaces` handler leaves the picker not-loaded (assertion times out) and a missing `create_workspace_folder` handler hangs the dialog in-flight (assertion times out) — the #949-class catch. A timeout on either round-trip is a **genuine liveness signal to file separately**, never something to paper over with a longer timeout or a softened assertion.

**Why change-workspace is not an AC (rescope from the parent's three-verb framing).** The create-folder flow still *sends* `change_workspace` over the real wire (the auto-chain after `workspace_folder_created`), so the client→wire path is exercised. But the picker close fires on `workspace_folder_created`, **not** on `change_workspace`'s reply, and that reply (`conversation_updated`) is a no-op for `activeConversationStore` — the chip's snapshotted cwd never updates and the channel-list row renders name + time only, never cwd. So the daemon's *handling* of `change_workspace` has no DOM surface here, and the fake twin's outbound-frame capture is unavailable (separate process behind a content-blind relay). Its client→wire contract is covered by #456; its daemon-side handling is covered by pyrycode/pyrycode#980.

**Realizability precondition (load-bearing, the #448 recheck).** Post-#448, opening any list row calls `setActiveConversation` before routing to the thread, so a `.channel-list__row-open` on the seed lands a **non-null** active conversation. Because the seed is `is_promoted:false` and no message is sent (empty thread), the chip gate `isEmpty && conversation !== null && !conversation.is_promoted` holds and the "Change workspace" button renders enabled. AC1's assertion on that button **is** the guard: a regression that breaks any leg of the gate fails there, clearly, before the picker drive.

---

## Design

One new file: `e2e/real-daemon-workspace.spec.ts`. **No production code, no fixture change.** Imports `test, expect, encodePairingPayload` from `./fixtures/realDaemon` (nothing else). Filename starts with `real-` (AC4).

### Fixture selection + timeouts (contract)

```ts
test.use({ spawnClaude: false, seedPromoted: false })   // claude-less; seed is a Recent DISCUSSION
const HANDSHAKE_TIMEOUT_MS = 45_000   // readiness gate: async relay registration + a handshake re-dial or two
const ROUNDTRIP_TIMEOUT_MS = 15_000   // each real-wire round-trip (AC3: ≥ siblings' value, not Playwright's 5s default)
const SPEC_TIMEOUT_MS = 120_000       // handshake + two round-trips + picker opens + headroom; well under the 300s config default
```

`spawnClaude:false` gates on the `pyry` binary **alone** — no `claude`, no Anthropic credential (AC4). `seedPromoted:false` makes the single seeded conversation a Recent discussion whose empty thread renders the chip.

### Drive (single `test`, sequence + selectors + expected auto-wait)

One `test` block, one launch — a fresh app launch + pairing + daemon spawn is the dominant cost, so both round-trips share it (AC's "one session, two round-trips").

1. **Pair against the real daemon.** Clone the sibling pairing block verbatim: build the payload with `relay: `${relay.url}/v1/client``, fill `textarea[aria-label="Pairing code"]`, click `Pair`, wait `[aria-label="Server key fingerprint"]`, click `Confirm`.
2. **Readiness gate.** `await expect(page.locator('.channel-list__save')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })`. The non-promoted seed's "save as channel" affordance renders only after handshake → session `connected` → the auto-fired `list_conversations` returned the seeded discussion row into "Recent discussions". Stronger than a bare row-visible check; the real-daemon path lands on `route='list'`, so this replaces the fake twin's land-in-thread.
3. **Open the seeded discussion thread.** `await page.locator('.channel-list__row-open').click()` — exactly one row (one seed), so the locator resolves uniquely. `onOpen` sets `activeConversation` = the seed and routes `thread`; the never-messaged thread renders empty.
4. **Realizability gate + open the picker (AC1).** `const change = page.getByRole('button', { name: 'Change workspace' }); await expect(change).toBeEnabled(); await change.click()`. Asserting enabled pins the post-#448 precondition (Context). The click flips `pickerOpen`, mounting the sheet + `RecentWorkspacesData` (fires `recent_workspaces`).
5. **Recent-workspaces round-trip (AC2).** Assert the picker resolved out of not-loaded, tolerant of rows **or** empty (OQ-a):
   ```ts
   await expect(
     page.locator('.workspace-picker__row, .workspace-picker__empty').first()
   ).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
   ```
   Not-loaded renders neither element, so this times out on a missing/broken `recent_workspaces` handler — the #949-class catch. (Live-observed outcome: exactly one `.workspace-picker__row` — the seed's cwd; see OQ-a. The tolerant form is the AC-faithful assertion; do **not** hard-code a row count.)
6. **Open the create-folder dialog.** `await page.locator('.workspace-picker__other').click()` → `await expect(page.locator('.create-folder')).toBeVisible()`.
7. **Create a folder (AC3).** Fill a **single-path-element, whitespace-free, per-run** name and confirm:
   ```ts
   const FOLDER_NAME = `folder-${Date.now()}`   // single path element (no '/', no '..'); nonce defeats any collision
   await page.locator('.create-folder__input').fill(FOLDER_NAME)
   await page.locator('.create-folder__create').click()
   ```
   This sends `create_workspace_folder { parent: seedCwd, name: FOLDER_NAME }`. The daemon `mkdir`s under the seed's `$HOME/work` cwd (writable, `$HOME`-confined — OQ-b) and replies `workspace_folder_created`.
8. **Assert the picker + dialog close (AC3, reply-gated).** The close reaches the DOM **only** after `workspace_folder_created` drives the store to `created`:
   ```ts
   await expect(page.locator('.create-folder')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
   await expect(page.locator('.workspace-picker__other')).toHaveCount(0)   // the whole picker tree unmounted
   ```
   A missing/broken `create_workspace_folder` handler (or a `workspace_folder_rejected`) leaves the store in-flight, the picker open, and both counts non-zero → times out (the #949-class catch).

**Assert `.workspace-picker__other`, not `.workspace-picker__row`, for "picker gone" (a real-daemon divergence from #456).** The fake twin asserted `.workspace-picker__row` → 0, valid there because its seeded recents were always non-empty. On the real tier the recent list is daemon-derived; a future daemon that excluded the current cwd would render zero rows even while the picker is open, so a row-count-0 close check would pass vacuously. `.workspace-picker__other` is rendered **unconditionally** whenever the picker is open, so its disappearance is the sound "picker unmounted" proof regardless of the recents outcome.

---

## State + concurrency model

- **No production state change; no new fixture state.** The #439 `seedRegistry` already binds one conversation with `cwd = workdir`; the `recent_workspaces` reply is derived server-side from that. This spec adds only a test file.
- **One launch, one store lifetime.** Both round-trips share the app-singleton stores (conversation-list, `activeConversationStore`, `recentWorkspacesStore`, `newFolderStore`) — no reseed, no relaunch.
- **Async confirmations, Playwright auto-wait.** Every wire round-trip (list on connect, `recent_workspaces` → `recent_workspaces_list`, `create_workspace_folder` → `workspace_folder_created`) traverses renderer → preload → main → Noise → relay → real daemon and back, so each store update arrives after the click resolves. Each assertion auto-waits with `ROUNDTRIP_TIMEOUT_MS` (or `HANDSHAKE_TIMEOUT_MS` for the readiness gate) headroom — no manual sleeps, no `expect.poll` (nothing in-process to poll; all observables are DOM).
- **Picker one-shot semantics.** `RecentWorkspacesData` is picker-scoped: mounting the sheet fires exactly one `recent_workspaces` request. The single drive never reopens the picker, so there is no re-fetch concern.
- **Teardown** is owned entirely by the `realDaemon` fixture chain (LIFO: page → daemon subprocess group → relay, plus `rm(userDataDir)` / `rm(daemonHome)`), firing on setup failure, test failure, and success. This spec adds nothing.

---

## Error handling / failure modes

- **Missing `recent_workspaces` handler** → the picker stays not-loaded; step 5's `.workspace-picker__row, .workspace-picker__empty` first-visible assertion times out. `ROUNDTRIP_TIMEOUT_MS` gives a cold runner headroom; a true miss is the #949-class daemon gap — file separately, do not widen the timeout.
- **Missing `create_workspace_folder` handler** → `newFolderStore` hangs in-flight, the created-effect never fires, the picker never closes; step 8's count-0 assertions time out.
- **`workspace_folder_rejected` (should not occur — OQ-b)** → the store folds to `rejected`, the dialog stays open with `.create-folder__error`, the picker stays open; step 8 times out. If this ever fires, the seed's cwd fell outside `$HOME` or the name was not a single path element — treat as an OQ-b regression, not a flaky timeout.
- **Chip does not render (realizability regression)** → step 4's `toBeEnabled()` fails immediately with a clear "not found/enabled" signal (not a downstream mystery) — the explicit guard for the #448-dependent precondition.
- **Skip-clean (AC4).** On a machine without `pyry`, the `realDaemon` daemon fixture calls `testInfo.skip` **before** creating any resource — an unrun test, never a hard failure. No `claude`, no credential required in `spawnClaude:false` mode.
- **Secret hygiene (AC5, carry the sibling header verbatim).** Every assertion reads DOM text / visibility / counts only. `FOLDER_NAME` is a non-secret nonce literal; the pairing payload is built exactly as the sibling real-daemon specs build it and is never echoed into a message; the transport is content-free by construction (#62). No failure diagnostic serialises the pairing token, keys, or a transcript; remote paths (the recent-workspace rows) are opaque display text, never resolved locally.

---

## Testing strategy

This spec **is** the test — one end-to-end recent-workspaces + create-folder drive against the real daemon.

- **Runs under `npm run e2e:real-claude`** (`playwright.real-claude.config.ts`, `testMatch: /real-.*\.spec\.ts$/`, 300s per-test timeout) and is **excluded from `npm run e2e`** by the default config's `testIgnore: /real-.*\.spec\.ts$/` (AC4) — purely by the `real-` filename prefix, which cannot be forgotten the way a per-test tag can.
- **QA / salvage gate:** `npm run build` (typecheck + build) is part of `e2e:real-claude`; e2e is outside every tsconfig, so the spec must compile under Playwright's own TS handling (only `./fixtures/realDaemon` is imported — no `@shared`, no relative `../src/...`).
- **No unit tests, no fakes to write.** The picker / dialog / bridges / round-trip stores are already unit-covered (#382 / #383 / #397 / #398); the `realDaemon` harness is #439; the daemon handlers are proven daemon-side (#982 / #981). This spec proves the two verbs traverse the *real wire* end-to-end.

---

## Open questions

Both live-verified against the real stack before writing (the #440 discipline — resolved, not deferred, and no fallbacks pre-built). Documented here so the developer understands *why* the assertions take the shape they do, not to leave work open.

- **OQ-a — does the seeded registry return a non-empty `recent_workspaces` list?** **Resolved: yes, exactly one row.** `recent_workspaces` (pyrycode `internal/relay/handlers/recent_workspaces.go`, spec #982) folds the conversations registry's distinct **non-empty** `Cwd` values, one per folder, most-recent-first; it does **not** exclude the current workspace and **includes** archived rows. The #439 seed binds exactly one conversation with `cwd = workdir`, so the reply carries one `RecentWorkspace` (its path == the active cwd → it also renders the "default" pill, still a `.workspace-picker__row`). **Design consequence:** per AC2's explicit wording ("either … rows or … the loaded-empty copy"), assert the **loaded-vs-not-loaded distinction** (step 5), not a row count — that keeps the assertion faithful to the AC and resilient to a future daemon that changes the fold (e.g. excludes the current cwd → empty list); either outcome still proves the handler responded. A developer who wants a tighter check may add `.workspace-picker__row` count === 1, but the tolerant form is the AC-faithful one and is recommended.
- **OQ-b — is the seed's cwd a writable directory the daemon can `mkdir` a child under?** **Resolved: yes; no fixture change needed.** The seed's `cwd` is the harness `workdir = join(daemonHome, 'work')` (`realDaemon.ts:183-185`), created `mode 0o700` and owned by the daemon's own user, and it sits at `$HOME/work` (the fixture sets `HOME = daemonHome`). `create_workspace_folder` (pyrycode #887 / #981) `expandTilde`s the parent, confines the target to `$HOME` (fail-closed, symlink-resolved), and requires the name be a single path element — all satisfied by `$HOME/work` + a `folder-<nonce>` name, so it replies `workspace_folder_created`, not `workspace_folder_rejected`. The per-run `Date.now()` nonce (the rename spec's idiom) also removes any pre-existing-folder collision, though a fresh daemon + fresh temp workdir per run already precludes one.
- **The crux — is the opened seed thread empty (so the chip renders)?** **Resolved by reasoning + an explicit in-test guard.** The chip gate needs `items.length === 0`. The seed was never messaged and runs claude-less, so no turn ever streamed timeline items and opening the thread requests no message history — the timeline store stays empty and the chip renders. This is the same realizability posture the fake twin relies on. Rather than pre-build a fallback, AC1's `toBeEnabled()` assertion on the "Change workspace" button (step 4) **is** the guard: if this reasoning is ever wrong, that assertion fails cleanly and diagnosably at the top of the drive.
