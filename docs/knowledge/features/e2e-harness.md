# E2E test harness

The end-to-end harness that launches the **built** Electron app and drives its renderer window with Playwright, so UI-level scenarios (pairing, send, stream) can be asserted against the real assembled app instead of only unit-testing pieces in isolation.

Introduced in [#40](../codebase/40.md). Everything lives under the top-level `e2e/` directory — outside every `src/` unit glob — plus `playwright.config.ts` at the repo root. This ticket ships **scaffolding only**: the config, one reusable launch fixture, and a single smoke assertion. The actual UI scenarios are follow-ups that reuse the fixture.

## What it does

Runs the whole app as a user would get it: `npm run e2e` builds (`npm run build`) then launches the compiled app from `out/main/index.js`, waits for the main window, and asserts the app shell rendered in real Electron DOM. It is a test-side process supervisor — no app source changes, no new runtime code. The smoke test proves the app boots and the [app-shell router](app-shell.md) routes a genuinely unpaired launch to the PairingScreen (`.pairing` visible) — see [#105](../codebase/105.md).

Playwright's `_electron` API launches the project's **own** `electron` binary and drives the renderer over the DevTools protocol — this is a strictly different test layer from the existing vitest unit suites (`renderToStaticMarkup`, no real window). The two layers are kept two-way separate (see below).

## How it works

### The three pieces

| File | Role |
|---|---|
| `playwright.config.ts` (repo root) | `testDir: './e2e'` (Playwright scans only `e2e/`), `workers: 1` + `fullyParallel: false` (one Electron process at a time), `reporter: 'list'`, CI-gated `forbidOnly`/`retries`. No `projects`/`browserName` block — Electron launches its own binary, so a browser project would be dead config and there is **no** `npx playwright install` step. |
| `e2e/smoke.spec.ts` | The single smoke assertion: `expect(page.locator('.pairing')).toBeVisible()`, launched through its own local isolated-userData fixture (see below) — see [#105](../codebase/105.md). |

### The launch fixture (retired)

`e2e/fixtures/electronApp.ts` shipped as the original reusable primitive (`electronApp`/`page`, `args: ['.']`, no `--user-data-dir` isolation) but never gained an importer: #105 moved `smoke.spec.ts` off it onto its own isolated-userData fixture precisely because it inherited the developer's real userData, and every later scenario launches through `launchPairedApp` or `realDaemon.ts` instead (see below). **[#546](../codebase/546.md) deleted it** after confirming zero importers across 26 specs. There is no shared scenario-agnostic launch fixture today — a new scenario either drives a real fake-daemon pairing flow through `launchPairedApp`, drives a real `pyry` through `realDaemon.ts`, or forks its own minimal local fixture the way `smoke.spec.ts` does.

**Why the built renderer gets exercised** (still the governing constraint for every fixture below). `createWindow` (`src/main/index.ts:50-68`) computes `devRendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']`. Under `electron.launch` the app is **not packaged**, so the built-vs-dev choice hangs purely on that env var. Every launch fixture therefore launches with a copy of `process.env` that has `ELECTRON_RENDERER_URL` **deleted** — if the var leaked from a dev shell, `createWindow` would `loadURL` a non-running dev server instead of `loadFile('out/renderer/index.html')`, and the test would hang until timeout.

### Deterministic teardown

Teardown must run on **every** exit path — success, test failure, and a failure raised after a resource (the Electron process, its `--user-data-dir`) came up but before `use()` returns. The naive shape (cleanup code placed textually after `await use(...)`) only covers the first two: Playwright's fixture lifecycle runs that code on pass and fail alike, but a setup-time throw — say `firstWindow()` rejecting — never reaches it, so the process and dir both leak. With `workers: 1`, one leaked launch then poisons every remaining spec in the run, since apps launch serially and the orphan just sits there.

**[#517](../codebase/517.md) fixed this** in the three fixtures that had the naive shape (`realDaemon.ts`'s `page` and `relay`, `smoke.spec.ts`'s local `page`) by converting to nested `try`/`finally`, one level per resource: each `try` textually follows its `const x = await create()`, so "teardown registered before the next `await`" is structural rather than a discipline a future edit can silently break, and close-then-`rm` ordering falls out of the nesting for free (the inner `finally` always completes before the outer one begins). Both teardown steps at the two-resource sites (app close, dir `rm`) are best-effort — wrapped in their own `try`/`catch` that discards the error without logging, since a throwing `finally` would replace the causal error the developer needs and abort the unwind before the outer `rm`, stranding the credential-bearing dir. The `page` fixture body in `realDaemon.ts` was lifted out into an exported `withIsolatedElectronApp(run)` so a regression spec can drive the real setup path directly; see [#517 codebase notes](../codebase/517.md) for the full shape and its one accepted gap (a setup `await` that never settles is not reapable — Playwright kills the worker without unwinding, so no `finally` runs).

### Two-way separation from the vitest unit run

`npm test` (vitest) must stay fast and headless-safe and must never collect the Playwright specs; the Playwright runner must never collect the `src/` unit files. Both directions are enforced structurally:

- **Playwright → only `e2e/`:** `testDir: './e2e'` in `playwright.config.ts`.
- **vitest → only `src/`:** `include: ['src/**/*.{test,spec}.{ts,tsx}']` in `vitest.config.ts`. vitest's `include` **replaces** the default glob (it is not additive), so vitest never walks `e2e/`. Every existing `*.test.ts(x)` lives under `src/`, so none is dropped.

### Desktop isolation (default-tier launches)

Every default-tier launch used to show and focus its window (`createWindow`'s `ready-to-show → show()`), 49 times per `workers: 1` run — a state Chromium backgrounds and throttles the moment the operator clicks away. That was traced, in [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067), to a one-spec-per-run flake at `pairingArrival.ts`'s fingerprint-card wait: the step is a synchronous BLAKE2s hash with no socket in it, so a 5000ms miss meant the renderer was stopped, not slow — and the fix is isolating the tier from the operator's desktop, not raising that wait's timeout.

Both launch sites — `launchPairedApp.ts` and `smoke.spec.ts` — now go through one shared, side-effect-free module, **`e2e/fixtures/desktopIsolation.ts`** (the `pairingArrival.ts` convention: no `base.extend`, so importing it drags no second fixture extension into a spec). `launchIsolatedApp({ args, env })` replaces `electron.launch` at both sites and applies two levers together, because neither alone is sufficient: three Chromium renderer-throttling switches (`RENDERER_THROTTLING_SWITCHES` — `disable-renderer-backgrounding`, `disable-backgrounding-occluded-windows`, `disable-background-timer-throttling`) appended to `args`, and the [window-presentation dev affordance](window-presentation-affordance.md)'s `HIDDEN_WINDOW_ENV_FLAG` set to `'1'` on `env` — a hidden window is still an occluded one, so hiding it without the switches would earn back exactly the throttling this exists to remove. `readDesktopIsolation(app)` reads the isolation back **from inside the launched app** (`app.commandLine.hasSwitch`, `BrowserWindow.getAllWindows()` filtered on `isVisible()`) rather than matching fixture source text, and `expectDesktopIsolated(app)` asserts all three switches applied, at least one window exists, and none is visible.

`e2e/desktop-isolation.spec.ts` is the cover: one test drives the full pairing arrival through `launchPairedApp` and asserts the isolation held for the whole drive; a second reads the isolation back directly; a third walks every `.ts` file under `e2e/` and asserts the set of files calling `electron.launch(` is exactly `{fixtures/desktopIsolation.ts, fixtures/realDaemon.ts}` — the deterministic guard against a future launch site skipping the shared module the way `electronApp.ts` (above) died of being optional. `smoke.spec.ts` gained its own `expectDesktopIsolated` assertion for the same reason, since it is the tier's other launch site.

`e2e/fixtures/realDaemon.ts` and `e2e/fixtures/pairingArrival.ts` are deliberately untouched — the `real-*` tier is operator-supervised by nature, and this ticket is provable without a live daemon.

## Configuration and usage

- **Run the suite:** `npm run e2e` = `npm run build && playwright test`. The build is chained so e2e never runs against a stale `out/` — a silently-stale build is a worse failure than a slower run.
- **Precondition when bypassing the script:** running `npx playwright test` directly against a clean tree fails fast with Electron's "Unable to find application" (there is no `out/`). The sanctioned entrypoint is `npm run e2e`.
- **Add a scenario:** create `e2e/<name>.spec.ts`. A scenario that needs **per-run env or state isolation** (extra `env`, an isolated `--user-data-dir` — true of every scenario today, since the unisolated `electronApp.ts` primitive was retired by #546) either drives a real fake-daemon pairing flow — in which case it imports the shared **`launchPairedApp`** fixture (`e2e/fixtures/launchPairedApp.ts`, [#433](../codebase/433.md)) rather than forking its own harness — or drives a real `pyry` through the shared **`realDaemon.ts`** fixture ([#420](../codebase/420.md)) — or, if neither fits, declares its **own** local `test.extend` in-file re-implementing only the hardening moves it needs (`args: ['.']`, strip `ELECTRON_RENDERER_URL`, isolate `--user-data-dir`) — see [smoke.spec.ts](../codebase/105.md) (#105), which forked the same shape stripped to the minimum smoke needs (no fake relay/daemon, no pairing env flags). Whichever launch path, teardown must reap the app and its dir on every raised exit path, not only after `use()` returns — see [Deterministic teardown](#deterministic-teardown) and [#517](../codebase/517.md).
- **Dependency:** `@playwright/test` (dev-only). `@playwright/test` re-exports the core `_electron` API, so no separate `playwright` import is needed.
- **Artifacts:** `test-results/` and `playwright-report/` are git-ignored (Playwright creates `test-results/` even on a passing run).

## Edge cases and limitations

- **Not type-checked.** `npm run typecheck` is scoped to `src/` (via `tsconfig.node.json` / `tsconfig.web.json`); `e2e/` and `playwright.config.ts` are transpiled by Playwright at run time, not by `tsc`. Acceptable for scaffolding; a follow-up could add an `e2e/tsconfig.json` if type errors there start biting.
- **No CI today.** Electron e2e on headless Linux will need `xvfb-run`. macOS (current dev env) no longer runs plain headful: since [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) every default-tier launch's window is never shown and its renderer is exempted from occlusion/backgrounding throttling — see [Desktop isolation](#desktop-isolation-default-tier-launches) above — which is what keeps a `workers: 1` run from being disturbed by the operator using the machine mid-run. The `forbidOnly`/`retries` knobs are CI-gated and harmless until then.
- **Two UI scenarios have landed.** [#93](../codebase/93.md) (`e2e/pair-to-conversation.spec.ts`) drives the real pairing UI against the in-process [fake relay forwarder](fake-relay-forwarder.md) + [fake daemon](fake-daemon.md); [#94](../codebase/94.md) (`e2e/send-and-stream.spec.ts`) picks up from the same connected thread, sends a message, and asserts the streamed daemon reply renders — together closing the automated side of the Phase-1 milestone. Two harness lessons from the first real scenario: (1) an e2e run is what catches main-process-runtime-only bugs (BoringSSL, `isPackaged`, native modules) that pass every vitest unit test — it surfaced [#101](../codebase/101.md); (2) `npm run e2e` runs **all** of `e2e/`, so a non-hermetic sibling spec fails the whole run — this is exactly what exposed the `.conversation`-at-boot `smoke.spec.ts` assertion as non-hermetic (it predated the [#80 router](app-shell.md); it only passed on the shared, pre-seeded userData), fixed in [#105](../codebase/105.md) by forking the same isolated-launch shape and retargeting the assertion to `.pairing`. New scenarios must launch with an isolated `--user-data-dir` for a hermetic start.
  - **Both scenarios were later found red on `main`** ([#140](../codebase/140.md)'s `PairedShell` nav-shell changed the paired route's entry point to the ChannelList (`route='list'`), not straight into `ConversationScreen` — so the post-Confirm `.conversation`/Send assertions both timed out, invisibly, since `npm run e2e` is not CI-gated). [#435](../codebase/435.md) repaired both: the fake daemon seeds a one-row `conversations` reply (via `buildReply`/`buildReplyFrames`) so ChannelList has a clickable `.channel-list__row-open` row, and each spec drives that real row click before asserting `.conversation`/Send — the row's Playwright auto-wait doubles as a connected gate, since the seed only arrives on the connected rising edge. #94 additionally had drifted a *second*, independent way (post-#140 renames in [#179](../codebase/179.md)/[#245](../codebase/245.md)/[#203](../codebase/203.md) moved message rendering from `data-message-role` to the timeline's `data-thread-role`, and retired the coarse `message` reply in favor of `[assistant_delta, turn_end]`) — both fixed in the same ticket. The lesson: a long-red e2e can accumulate more than one layer of staleness past its first failing assertion.
  - **Both scenarios' file-local `test.extend` forks were then extracted into one shared factory fixture**, `e2e/fixtures/launchPairedApp.ts` ([#433](../codebase/433.md)) — the #435 repaired drive (paste → Pair → Confirm → seed-row-click → Send-enabled) plus the launch/env/user-data-dir plumbing, all fixture-owned now. `pair-to-conversation.spec.ts` went thin; `send-and-stream.spec.ts` keeps its own reply-frame builders but scripts them through the fixture's `LaunchPairedAppOptions` (an `Omit<FakeDaemonOptions,'url'>` passthrough) and reuses the fixture's exported `seedConversationsFrame()` for its own default arm. This is the harness a future fake-daemon UI scenario (the #422–#429/#434/#420 batch) should import — not `electronApp.ts`, and not a fresh local fork.
- **No `e2e:fast` variant.** Re-building on every run is accepted; a build-skipping variant is deferred until iteration pain is actually observed.
- **A fourth scenario, gated out of the default run.** [#252](../codebase/252.md)'s
  [real-claude liveness e2e](real-claude-liveness-e2e.md) (`e2e/real-claude.spec.ts`) drives a real
  `pyry` + real `claude` instead of the fake relay/daemon pair. It is excluded from `npm run e2e` via
  a `testIgnore` in `playwright.config.ts` and runs only under its own
  `playwright.real-claude.config.ts` via `npm run e2e:real-claude` — the first scenario to need a
  second config rather than fitting inside the shared one.
  - **Its spawn recipe was later extracted into its own shared fixture**, `e2e/fixtures/realDaemon.ts`
    ([#420](../codebase/420.md)) — the real-stack counterpart of `launchPairedApp.ts` (#433): the
    `relay → daemon → page` chain (binary resolution, skip-gating, `seedRegistry`, spawn args,
    `waitForDaemonReady`, process-group reap) moved verbatim so the coming tier-2/tier-3 real-* specs
    (real-daemon-actions, interrupt/queue, permission modal) reuse it. Both configs' `real-*`
    partition widened together — `playwright.real-claude.config.ts`'s `testMatch` and
    `playwright.config.ts`'s `testIgnore` both went from `/real-claude\.spec\.ts$/` to
    `/real-.*\.spec\.ts$/` — so a future `real-*` spec can't leak into the daemon-less default
    `npm run e2e`. Unlike `launchPairedApp`, the pairing/drive body stayed in the spec; only the spawn
    recipe (AC1's scope) moved.
  - **The fixture then grew a second, credential-light spawn mode.** [#439](../codebase/439.md) added two
    additive Playwright option fixtures (`spawnClaude`, `seedPromoted`) to `realDaemon.ts`, so a spec can
    opt into a real `pyry` daemon with **no** `claude` and **no** Anthropic credential — see
    [real-daemon credential-light e2e](real-daemon-credential-light-e2e.md). `real-claude.spec.ts` sets
    neither option and keeps its exact prior behavior.
  - **A stateful sibling to `launchPairedApp` landed for the fake-daemon side.** [#434](../codebase/434.md)
    added `e2e/fixtures/conversationStateFake.ts` — a `conversationStateFake(options)` factory that returns
    a `buildReplyFrames` closure **holding** a seeded `ConversationSummary[]` and mutating it across a real
    UI drive, instead of the stateless per-call `buildReplyFrames` dispatch `send-and-stream.spec.ts` uses.
    It answers `list_conversations` from current state and applies all seven list-mutation verbs
    (create/rename/archive/unarchive/promote/change_workspace/delete), matching the app's two real reflect
    paths — a `conversation_updated` broadcast that triggers `shouldRefreshList` re-listing, and a
    correlated `conversation_deleted { id }` echoing `in_reply_to`. Consumed through `launchPairedApp`
    exactly like any other `buildReplyFrames` option. Its demonstrating spec,
    `e2e/conversation-state-fake.spec.ts`, clones `real-daemon-rename.spec.ts`'s drive against the fake
    (rename, not archive — `partitionByPromotion` does not filter `is_archived`, so an archived row never
    leaves the active list; see [#440](../codebase/440.md)). This is the fixture the #422–#429 per-flow
    family (blocked-by #434) rides for list-mutation state instead of re-transcribing the wire per spec.
- **The first `conversationStateFake`-riding per-flow scenario landed.**
  [#451](../codebase/451.md) added `e2e/conversation-create-rename.spec.ts` (split from #422; its sibling
  #452 covers archive → restore → delete): a single `launchPairedApp` launch drives FAB create-nav, the
  Channel-info **sheet** rename entry point (distinct from the list-row pencil #434's demonstrator owns),
  and the resulting two-row Channel List. Confirms the then-current Gap A pattern (`shouldRefreshList` false
  for `conversationCreated`, so a scenario must assert navigation, not list membership, right after a
  create) — **fixed by [#515](../codebase/515.md)**, which added the missing arm; the spec's assertions
  didn't change (route is still `thread` at the create step, so there is nothing to assert against on the
  list even though the row now lands in the store) but the *reason* is different — see #515 for the
  corrected rationale — and surfaces a harness-adjacent UI lesson: the Channel-info sheet is a full-surface
  `.status-sheet-overlay` scrim that blocks `.conversation__back` until the sheet's own
  `.status-sheet__close` is clicked first — relevant to any future scenario that opens the sheet.
- **#451's independent sibling, the destructive-lifecycle scenario, landed too.**
  [#452](../codebase/452.md) added `e2e/conversation-archive-lifecycle.spec.ts` — the fake-stack twin of
  the real-daemon lifecycle spec [#440](../codebase/440.md), driving one FAB-created conversation through
  archive → restore → delete on the same single `launchPairedApp` launch. It hits the same Gaps A/B as
  #440 and lands on the same ruling: assert the Archive view's `role=tab` count deltas (`Discussions
  0→1→0` for archive/restore) rather than active-Channel-List departure/return, since Gap B means an
  archived row never actually leaves the active list. (Gap A itself is later fixed by
  [#515](../codebase/515.md); Gap B is untouched and still governs this ruling.) Delete is asserted as gone
  from **both** surfaces —
  it splices the row from the fake's held state rather than tagging it, so that's the one step where
  "gone" holds everywhere. Also nuances the #451 sheet-scrim lesson: whether `.status-sheet__close` is
  needed before `.conversation__back` depends on the specific action's callback wiring, not the sheet shell
  itself — here `onArchive` and `onDeleteConfirm` both call `onClose()` themselves, so the sheet is already
  unmounted and clicking `.status-sheet__close` would fail (the button no longer exists).
- **[#456](../codebase/456.md) covers the Workspace Picker sheet's (#383) two wire round-trips.**
  `e2e/workspace-picker.spec.ts` adds a `recent_workspaces` answer to `conversationStateFake` (shared,
  since split sibling #457 reuses it) and, spec-locally, a `create_workspace_folder` answer (single
  consumer, the #423 precedent), in two isolated `test()` blocks (also the #423 shape): recent-pick
  (`change_workspace` carrying the chosen path) and create-folder (`create_workspace_folder` chaining
  `change_workspace` with the daemon-**returned** path, verbatim — never a client preview, the #288
  proof). Both blocks assert the "Change workspace" button is enabled before driving the picker, pinning
  the [#448](https://github.com/pyrycode/pyrycode-desktop/pull/450) precondition that a
  `launchPairedApp` row-open now sets the active conversation (so the `WorkspaceChip` gate is
  satisfiable straight from the landed thread, given an `is_promoted: false` seed and no message sent).
  Since the changed `cwd` has no DOM reflection (`change_workspace`'s reply is a no-op for
  `activeConversationStore` — the same #440 unrealizable-active-list trap), both flows assert the
  **outbound wire frame** the fake captured, `expect.poll`ed for async loopback arrival, rather than a
  rendered reflection.
- **[#425](../codebase/425.md) covers the run-config sheet's (#257) `set_session_settings` write family** —
  model / effort / YOLO, plus one rejection — in a single `test()` block on a single launch (unlike #423's
  two: nothing here is one-way, and the session persists across all three controls). Its spec-local
  `capturingRunConfigFake` confirms the parent premise was stale: `conversationStateFake` (#434) only
  answers the seven conversation-list verbs, so `set_session_settings` / `request_snapshot` /
  `session_transition` all fall to its `default` (no reply) — this scenario needed its own factory, not an
  extension of the shared one. It also surfaces two preconditions `launchPairedApp` doesn't provide that any
  future run-config or session-id scenario will need again: a session id (fed only by an *unsolicited*
  `session_transition` marker via the App-level `sessionIdBridge`, required before the controls' `onChange`
  is built at all — absent it, #188's inert markup renders and clicks no-op) and a seeded `screen_snapshot`
  baseline (answering `RunConfigData`'s one `request_snapshot` on sheet open). Because the view renders no
  pending/disabled state (`selectEffectiveSettings` composes `pending` and `confirmed` to the same displayed
  value), a landed confirm is DOM-indistinguishable from a still-pending optimistic overlay — so the send
  half of each change is proven from the **captured outbound** `set_session_settings` frame
  (`isDeepStrictEqual` + `expect.poll(...).toBe(1)`, proving send-once and only-the-changed-field together),
  while the one scripted rejection (a correlated `error`) is the visually distinct outcome asserted in the
  DOM (control reverts + `.run-config__error[role="alert"]`).
- **[#457](../codebase/457.md), split from #424 (#456's twin), covers the Settings "Default workspace"
  preference reaching `create_conversation`.** `e2e/default-workspace.spec.ts` drives
  `DefaultWorkspaceRow` (#404) → `WorkspacePickerSheet` (#383) → `defaultWorkspaceStore` (#403) → the
  channel-list FAB (#242) in **one** `test()` block on one launch — the choose writes the store with
  **no wire traffic** (unlike #456's thread picker, which dispatches `change_workspace`), so the only
  load-bearing wire assertion is the FAB's own `create_conversation { is_promoted:false, name:null,
  cwd:CHOSEN }`, `expect.poll`ed on the spec-captured inbound frames (the same #440/#456 unrealizable-
  active-list trap: the chosen `cwd` has no DOM reflection). Its capturing wrapper reuses #456's shared
  `recentWorkspaces` fake answer with **zero spec-local verb handling** — strictly simpler than #456's
  own wrapper, since every verb this drive sends is already answered by the shared fake. Corrects #456's
  seed-promotion constraint as irrelevant to this flow (the Settings picker has no active-conversation
  gate, unlike the thread `WorkspaceChip`), and establishes a reusable pattern: a negative wire guard
  (asserting `change_workspace` was never sent) is race-free when placed *after* a positive poll on the
  same in-order Noise channel, since any earlier frame is already captured by the time the later one
  arrives.
- **[#426](../codebase/426.md) covers the permission/trust modal's (`PermissionModal`) five answer
  paths** — default one-tap, non-default → confirm sub-step (Back vs Confirm), cancel, a rejected
  answer's dismissible banner, and a remote `modal_dismissed` clear. `e2e/permission-modal-answer-paths.spec.ts`
  surfaces each prompt via `daemon.pushFrame(modal_shown)` after launch (the #425 push-after-launch
  technique) since `PermissionModal` renders straight off `modalStore.outstanding[0]`, with no
  interactive-timeline gate to un-inert first. Two `test()` blocks, split by a load-bearing subtlety
  rather than convenience: the modal reject correlates by **FIFO send order, not `in_reply_to`** — a bare
  daemon `error` dequeues the *oldest* `outstandingAnswers` entry — so block 1 (answer/confirm/cancel/
  dismiss, one launch) never triggers a reject and its un-drained answer residue stays inert, while block
  2 (reject, a fresh launch) starts from an empty queue so its one answer is unambiguously what the reject
  dequeues. `answer_token` is main-minted (`crypto.randomUUID`), so the captured `modal_answer` is matched
  on `modal_id` + `option_id` with the token asserted present-but-opaque, not deep-equalled like #425's
  `set_session_settings` payload. AC3's "exactly one `modal_answer`" after Back → re-select → Confirm is
  the negative guard proving Back sends nothing; AC6's zero-frame check proves a remote dismiss sends
  neither `modal_answer` nor `modal_cancel`.
- **[#428](../codebase/428.md) covers the three reliability affordances an operator reaches for when a
  session misbehaves** — the stall indicator, the "Show daemon screen" screen snapshot, and the
  debug-bundle download — each exercising a distinct daemon-interaction shape (server push, request→reply,
  chunked reply stream) in one `test()` block on one launch, the #425/#427 precedent. Confirms the stall
  event is a `daemon.pushFrame`, never a bundled reply (the same stale-premise correction as #426/#427);
  defuses a most-recent-wins overwrite trap where the Run-config sheet's own `request_snapshot` on mount
  would clobber the scripted snapshot text if the fake answered it differently, by answering every
  `request_snapshot` identically and asserting the `<pre>` before that sheet opens; and proves
  `debugBundleProgress` climbs to its final chunk count from streamed `debug_bundle_chunk` frames alone,
  deliberately never sending `debug_bundle_done` since the completed save writes a real archive to
  `app.getPath('downloads')` with no dialog to stub and no downloads-directory isolation in the fixture.
- **[#465](../codebase/465.md) covers the paired region's inner navigation** — every `nextPairedRoute`
  transition in `PairedShell` beyond the launcher's own `list → thread` click: the pair-another-server
  round-trip (#152) and the back-navigation chain (`thread → list → settings → list → archive → list`), in
  one `test()` block on one launch (the #425/#427/#428 precedent extended from server-push flows to five
  pure client-nav transitions). Establishes that teardown-vs-in-shell-pair-another is provable **only** via
  the Cancel→Settings round-trip, not an on-pairing-surface assertion — the `pairServer` route and the
  app-root pairing route both render the identical `PairingScreen`, so the DOM is byte-identical whether the
  session survived (the #440-realizability discipline applied to a same-component-two-routes case); the
  Cancel destination (Settings re-renders) is the one observable that separates them. Also notes the three
  back buttons (thread/settings/archive) share the identical accessible name `'Back'`, selected by
  screen-scoped class rather than role-name.
- **[#466](../codebase/466.md) is the first #422-family scenario that needs two launches**, since its
  target — the push-notification preference (#408) surviving a relaunch — is only observable across a
  process boundary. Added `LaunchControl` to `launchPairedApp`: an optional second parameter carrying one
  `reuseUserDataDir?: string` flag, plus an additive `PairedApp.userDataDir` return field. Dir-reuse and
  pairing-drive-skip are deliberately one flag, not two — a reused *paired* dir must skip the drive, or the
  paste→Pair→Confirm steps hang waiting for a pairing screen that never appears on an already-paired boot.
  On a reuse launch the forwarder + daemon still start (unconditionally, so `PairedApp.daemon` stays
  non-optional and no possibly-undefined check ripples through the `daemon.pushFrame` consumer family) but
  are vestigial — the app dials the *persisted* launch-1 relay URL, not the fresh forwarder port — and the
  fixture returns at the **list**, skipping both the row-click and the Send-enabled wait that would hang on
  a connection that will never establish (`routeForStatus` reads the persisted pairing record at mount,
  independent of the Noise handshake). No second `rm` teardown is registered on a reuse launch; the minting
  launch's `rm` (pushed first, drained last by Playwright's LIFO teardown) removes the dir exactly once,
  after every launch on it has closed. The spec itself: launch 1 flips the toggle from its default-ENABLED
  state to DISABLED, `app.close()` (barrier — releases the `SingletonLock` *and* flushes renderer
  `localStorage` on graceful exit, both required before a same-dir relaunch) + `daemon.close()` (kills
  daemon 1 so launch 2 provably cannot reconnect through the stale persisted relay URL), then launch 2
  reuses the dir and asserts the switch is still unchecked — the only assertion in the spec, and the whole
  point of it.
- **[#464](../codebase/464.md), split from #429 (sibling of #465/#466), covers the session-EXIT path** —
  the flip from a paired, connected thread back to the app-root `PairingScreen`, previously uncovered.
  `e2e/unpair-repair.spec.ts` has two blocks: block A (one launch, since Cancel keeps the session) drives
  the two-phase `UnpairControl` — `Cancel` keeps the thread mounted with `Send` enabled and the app-root
  pairing field (`[aria-label="Pairing code"]` — element-agnostic since [#664](../codebase/664.md)) at
  count 0, then re-opening and `Confirm` (same launch) flips to
  the app-root pairing screen; block B (its own launch, since a fatal close is terminal) surfaces the
  `Re-pair` affordance (#167) via a new [fake relay forwarder](fake-relay-forwarder.md) hook,
  `closeClientLeg(4401)`, and confirms it too returns to the app-root pairing screen. The field's
  visibility is the return-to-pairing proof and its count-0 absence is the session-intact proof — a clean
  case (no round-trip needed, unlike #465's Cancel→Settings) because both #464 exits flip the *top-level*
  `App` route and unmount `PairedShell` entirely, so the app-root pairing route is simply not mounted while
  on the thread. The Re-pair trigger's reachability was traced end-to-end through merged code (forwarder →
  `relayConnection` → `relaySupervisor`'s `DEFAULT_FATAL_CLOSE_CODES` → `daemonConnection.emitFailed` →
  `shouldOfferRepair`) before the infra was written, confirming it as the #464-first case where the fatal
  hook is feasible rather than falling back to the ticket's own "route back instead of asserting the
  unrealizable" escape hatch (the #440 discipline).
- **[#546](../codebase/546.md) deleted the retired `electronApp.ts` fixture.** Dead code with zero importers across all 26 specs — every scenario by then launched through `launchPairedApp`, `realDaemon.ts`, or its own local fixture. *(Not separately documented at the time; recorded here retroactively by [#517](../codebase/517.md)'s documentation pass.)*
- **[#517](../codebase/517.md) closed a teardown leak in the three fixtures that predated the harness's later shared fixtures.** `realDaemon.ts`'s `page` and `relay`, and `smoke.spec.ts`'s local `page`, all registered cleanup only *after* `await use(...)` — a setup-time throw (e.g. `firstWindow()` rejecting once the process was already up) made that cleanup unreachable, leaking the Electron process and its `--user-data-dir` for the rest of the `workers: 1` run. The credential angle: that dir is where `PYRY_TEST_SECRET_BACKEND` persists the pairing record, and at the `page`/`realDaemon.ts` site the leaked record pairs against a live spawned `pyry`. Fixed with nested `try`/`finally` (see [Deterministic teardown](#deterministic-teardown)); `launchPairedApp.ts` was already immune (every resource it creates lives inside the `use()` callback, so a mid-drive failure surfaces as a test failure with `use()` still returning) and was intentionally left untouched. The `page` fixture body in `realDaemon.ts` is now also reachable directly as `withIsolatedElectronApp(run)`, letting `e2e/fixture-teardown-leak.spec.ts` drive the real converted setup path — not a re-transcription of it — to prove the fix.
- **[#515](../codebase/515.md) closes Gap A.** `conversationListBridge.shouldRefreshList` gained a third
  arm for `conversationCreated`, so a FAB-created conversation now re-requests the list and lands in the
  store instead of waiting for an unrelated rename/archive/promote/delete. No e2e assertion changed — the
  three specs that document Gap A (#440, #451, #452) still assert navigation, not list membership, at the
  create step, because the route is `thread` and `ChannelList` is unmounted there regardless of whether the
  row is in the store. Only the *reason* in their comments changed, from "the row isn't in the store yet"
  to "the list isn't mounted to show it". Gap B (archived rows never leave the active list,
  `partitionByPromotion`, #469) is untouched.
- **[#661](../codebase/661.md) funnels every unpaired-launch pairing drive through one shared step.**
  Ten sites — `launchPairedApp.ts` and nine `real-*` specs — each ran the identical six lines after an
  unpaired launch (locate the pairing field → wait → fill → click `Pair` → wait for the fingerprint
  card → click `Confirm`). All ten now call the new **`e2e/fixtures/pairingArrival.ts`**'s
  `pairFromUnpairedLaunch(page, payload)` instead. Behaviour-preserving (zero production LOC, the six
  lines moved verbatim), and the seam is drawn *after* `Confirm` — post-confirm readiness gates
  (list→thread + Send-enabled for the fixture, a per-flow gate for each `real-*` spec) stay in each
  caller. `pairingArrival.ts` imports only `@playwright/test`, never `launchPairedApp.ts` or
  `realDaemon.ts` — both call `base.extend` at module scope, so importing either would drag a second
  fixture extension into specs that must keep using the other one. `e2e/unpair-repair.spec.ts` is
  deliberately not a caller and stays byte-unchanged: its two pairing-field locators follow a
  mid-session unpair flip and serve as a teardown proof, not a drive, and #662 relies on this file
  staying untouched as its negative control. This is now the harness's single edit point for changing
  what an unpaired launch lands on.
- **[#664](../codebase/664.md) re-points every non-owning site at the pairing field's accessible name
  alone.** Six sites the ticket named plus five prose-only sites its own selector-grep couldn't see (11
  total, across the same five files `#661`/`#662` had already touched) dropped `textarea[aria-label=
  "Pairing code"]` and the `Paste pairing code` card-heading marker for the bare
  `[aria-label="Pairing code"]` idiom — element-agnostic and heading-agnostic, so #665's restyle (an M3
  filled `<input>`, no heading) can land without a silent-green cascade across `e2e/`, which is outside
  both tsconfigs, or the two `renderToStaticMarkup` unit markers. Retired the half of `pairingArrival.ts`
  INVARIANT 4 that told the reader not to finish this sweep (its named negative-control purpose had
  already been served); kept the still-true half, that `unpair-repair.spec.ts` is not a
  `pairFromUnpairedLaunch` caller. Zero production code.
- **[#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) filled the message bubble's meta-row timestamp slot
  ([Conversation shell — message bubble § The meta row](conversation-shell-message-bubble.md#the-meta-row))
  and broke thirteen fake-tier `toHaveText` assertions across five files that read a whole `.bubble`'s
  text — a selector grep alone missed four of them.** `.bubble__meta` is the bubble's last child on both
  branches, and Playwright's `toHaveText(string)` asserts an element's *entire* normalized text, so every
  site asserting a bubble's exact message text broke the moment the slot filled. The fix keeps each site
  an exact bound rather than loosening it to `toContainText` (which would have deleted what several of
  them prove — one spec's own comment says its assertion is the guard against the default-echo trap): a
  new `e2e/fixtures/bubbleText.ts` exports `bubbleTextExactly(text)`, which regex-escapes the expected
  message text and anchors an optional digit-shape timestamp pattern after it
  (`^<escaped text>\s*<DD.MM.YYYY - HH:MM shape>$`), and every broken site swaps its string literal (or,
  for `toHaveText`'s array-of-strings form, each array element) for this call — no locator, timeout,
  `.nth()`, or `.last()` moved. **The sweep that finds these sites is by assertion name across all of
  `e2e/`, not by the selector.** `conversation-switch-keeps-both-threads.spec.ts` binds its locator to a
  const eleven lines above its four assertions, so neither `.bubble` nor the selector string appears on
  the assertion lines a selector grep finds — `rg 'toHaveText|toContainText' e2e/` (no path or `bubble`
  filter) followed by resolving every const-bound locator is what catches those. The QA gate is what
  caught the first three of the four here (a first failed `expect` aborts a Playwright test, hiding its
  siblings from the same failure log — all four bounced in one pass once found). See [Real-claude
  liveness e2e](real-claude-liveness-e2e.md#assertions--content-agnostic-two-turn-liveness) for the
  second half of this sweep — the real-claude tier's raw `textContent`/`evaluateAll` reads, which no
  `expect`-based grep finds at all.

- **[#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) traced a one-spec-per-run, different-spec-each-run flake at `pairingArrival.ts`'s fingerprint-card wait to the operator's own desktop, not a slow step.** The originally-filed hypothesis — that the wait spans the Noise handshake — was wrong: pairing's fingerprint is a synchronous BLAKE2s hash with no socket in it, so a 5000ms miss meant the renderer was stopped, and every launch showing and focusing a window 49 times per run is what a `workers: 1` operator machine can stop it with. See [Desktop isolation](#desktop-isolation-default-tier-launches) above for the fix. There is deliberately no fails-on-main test for the flake itself — it reproduced about once per 77 tests, non-deterministically, and only under operator interference — so the acceptance criteria (isolation applied at one shared place, read back from inside the app, the whole tier green under it) are the proof this ticket shipped, not a repro.

## Related

- [Window-presentation dev affordance](window-presentation-affordance.md) / [#1067](https://github.com/pyrycode/pyrycode-desktop/issues/1067) — the third `isPackaged`-false-first dev-only gate, letting a non-packaged build keep its window unshown; consumed by `desktopIsolation.ts` above.
- [App shell (router)](app-shell.md) / [#80](../codebase/80.md) — `routeForStatus`, whose unpaired outcome the smoke test now asserts (`.pairing`).
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the shell the UI scenarios ([#93](../codebase/93.md), [#94](../codebase/94.md)) drive to after pairing; no longer what smoke asserts at boot.
- [#40 codebase notes](../codebase/40.md) · Spec: `docs/specs/architecture/40-e2e-electron-harness.md`
- [#105 codebase notes](../codebase/105.md) — made `smoke.spec.ts` hermetic on an unpaired boot (isolated `--user-data-dir` + `.pairing` assertion).
- [#433 codebase notes](../codebase/433.md) — extracted `launchPairedApp`, the shared fake-daemon pairing fixture both #93 and #94 now import; the intended home for future fake-daemon UI scenarios.
- [#435 codebase notes](../codebase/435.md) — repaired the list→thread drive #433 later extracted.
- [#420 codebase notes](../codebase/420.md) — extracted `e2e/fixtures/realDaemon.ts`, the real-stack sibling of `launchPairedApp.ts`, from `real-claude.spec.ts`; the intended home for future real-* scenarios.
- [#439 codebase notes](../codebase/439.md) / [Real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) — added the claude-less spawn mode to `realDaemon.ts` and the first credential-light real-* scenario.
- [#434 codebase notes](../codebase/434.md) — `conversationStateFake`, the stateful fake-daemon sibling of `realDaemon.ts`'s credential-light mode; holds and mutates a conversation list across a real UI drive for the #422–#429 per-flow family.
- [#451 codebase notes](../codebase/451.md) — first `conversationStateFake`-riding per-flow scenario: FAB create-nav, the Channel-info sheet rename entry point, and the grown two-row Channel List.
- [#452 codebase notes](../codebase/452.md) — #451's independent sibling: the destructive archive → restore → delete lifecycle, fake-stack twin of [#440](../codebase/440.md).
- [#423 codebase notes](../codebase/423.md) — the third #422-family sibling: the save-as-channel promote dialog's scratch/dedicated branches; the two-block shape and captured-envelope compose-over idiom [#456](../codebase/456.md) reuses.
- [#456 codebase notes](../codebase/456.md) — the Workspace Picker sheet's recent-pick + create-folder round-trips; adds the shared `recent_workspaces` fake answer split sibling #457 reuses.
- [Conversation workspace change](conversation-workspace-change.md) / [#379 codebase notes](../codebase/379.md) — the `change_workspace` transport slice [#456](../codebase/456.md) drives and asserts on the wire, since its reply has no DOM reflection.
- [Recent-workspaces store](recent-workspaces-store.md) / [#382 codebase notes](../codebase/382.md) — the renderer store + bridge [#456](../codebase/456.md) exercises end-to-end via the picker's `recent_workspaces` request.
- [#425 codebase notes](../codebase/425.md) — the run-config sheet's model/effort/YOLO round-trip; the spec-local capturing-fake precedent applied to `set_session_settings`, plus the session-id + snapshot preconditions any future run-config scenario needs.
- [#457 codebase notes](../codebase/457.md) — the default-workspace preference reaching `create_conversation`'s `cwd`; the split twin of [#456](../codebase/456.md), reusing its shared `recent_workspaces` fake answer with a zero-verb-handling capturing wrapper and the race-free negative-guard-after-positive-poll pattern.
- [Default workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) — the `localStorage`-backed store [#457](../codebase/457.md) is the first e2e to drive.
- [#426 codebase notes](../codebase/426.md) — the permission/trust modal's five answer paths (default tap, confirm/Back, cancel, reject banner, remote dismiss); the FIFO-not-`in_reply_to` reject model that forces the two-block split.
- [#427 codebase notes](../codebase/427.md) — the queued-backlog render, dequeue, and interrupt flows, all server-push-driven; establishes why a flow does NOT need #423/#426's two-block split (no one-way residue) and the two-part act/capture/push-reflect assertion shape for non-optimistic push-reflected mutations.
- [#428 codebase notes](../codebase/428.md) — the stall indicator, screen snapshot, and debug-bundle download; the last of the reliability-affordance surfaces, covering a server push, a request→reply, and a chunked reply stream in a single launch.
- [#465 codebase notes](../codebase/465.md) — the paired region's inner navigation: the pair-another-server round-trip and the thread/settings/archive back-chain, plus the Cancel→Settings round-trip as the only realizable teardown proof when two routes render the same component.
- [#466 codebase notes](../codebase/466.md) — the push-notification toggle's relaunch persistence; the first two-launch scenario in the family, and the `reuseUserDataDir` fixture affordance (dir-reuse + drive-skip as one flag) it added to `launchPairedApp`.
- [#515 codebase notes](../codebase/515.md) — closed Gap A (`shouldRefreshList` now covers `conversationCreated`); zero e2e assertion changes, comment-only reconciliation across #440/#451/#452.
- [#546 codebase notes](../codebase/546.md) — deleted the retired `electronApp.ts` fixture (zero importers).
- [#517 codebase notes](../codebase/517.md) — closed the teardown-on-setup-failure leak in `realDaemon.ts`'s `page`/`relay` and `smoke.spec.ts`'s local `page`; added `withIsolatedElectronApp`.
- [#661 codebase notes](../codebase/661.md) — extracted `e2e/fixtures/pairingArrival.ts`, the shared
  unpaired-launch pairing-arrival step all ten drive sites (the fixture + nine `real-*` specs) now call;
  the one-line edit point #662 needs to change the unpaired entry point.
- [Push-notification preference store](push-notification-preference-store.md) / [#408 codebase notes](../codebase/408.md) — the `pyry.pushNotificationsEnabled` `localStorage` contract [#466](../codebase/466.md) is the first e2e to prove survives a full app relaunch.
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md) — Electron + electron-vite emitting `out/main` · `out/renderer`, the layout the launch target depends on.
- Cross-project prior art: pyrycode `#68` shipped the same spawn+cleanup harness-primitive + one-smoke shape (Go, `internal/e2e/`), with UI scenarios as separate tickets. This mirrors that shape in TypeScript/Playwright.
