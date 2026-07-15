# #466 — fake e2e: push-notification toggle persists across an app relaunch

Child C of the #429 split. A Tier-1 fake-stack UI e2e that proves the push-notification preference
(`pyry.pushNotificationsEnabled`, #408/#409) survives a full app relaunch that reuses the same
`--user-data-dir`. Adds one narrow affordance to the shared `launchPairedApp` fixture (#433) and one new
spec. **Zero production code.**

## Size

**S** (confirmed, was `size:s`). 2 files: modify `e2e/fixtures/launchPairedApp.ts`, add one
`*.spec.ts`. 0 production `.ts`/`.tsx` (fixture is test infra; spec is a test). ~40 changed LOC in the
fixture + ~60 LOC spec ≈ ~100 total. **Zero consumer fan-out** — the fixture change is a new *optional*
second parameter plus an *additive* return field (`userDataDir`); `PairedApp.daemon` stays non-optional,
so none of the ~9 existing `launchPairedApp` consumers change. 1 new exported type (`LaunchControl`).

## Design source

N/A — coverage-only e2e. No new UI; the spec pins the already-shipped #409 push toggle
(`PushNotificationRow`) and the #333/#347 Settings/ChannelList chrome. The visual-fidelity check is
intentionally skipped.

## Files to read first

- `e2e/fixtures/launchPairedApp.ts` (all ~212 lines) — the fixture being modified. Note especially: the
  factory shape `base.extend<{ launchPairedApp }>` (118); the per-launch `mkdtemp` fresh dir + `rm`
  teardown (127-128); the LIFO `teardown[]` drain after `use` (202-208); the `PairedApp` return type
  (93-97); the unconditional pairing drive (157-197) ending at the **thread** (row-click 189 + Send-enabled
  wait 195). This is the single home of every pairing/navigation selector.
- `e2e/paired-shell-navigation.spec.ts` (#465, merged PR#467) — the closest structural sibling: `import
  { test, expect } from './fixtures/launchPairedApp'`, one `test()` block, DOM-only asserts, the exact
  thread→back→list→Settings selector chain this spec reuses on launch 1. Copy its shape.
- `e2e/pair-to-conversation.spec.ts` — the nav-only skeleton (no `buildReplyFrames`, no `daemon.pushFrame`,
  no codec import). This spec follows it: default seed only.
- `src/renderer/src/store/pushNotificationPrefStore.ts:41,47,60-64,108` — the contract under test:
  `PUSH_NOTIFICATIONS_DEFAULT_ENABLED = true` (default-empty ⇒ ENABLED), key
  `'pyry.pushNotificationsEnabled'`, `decodePushPref` (`'true'`/`'false'` only), and hydration
  `storage.read() ?? DEFAULT`. Confirms flipping to DISABLED distinguishes *persisted* from *reset*.
- `src/renderer/src/screens/settings/PushNotificationRow.tsx:20,46-55` — the switch DOM: a native
  `<button role="switch" aria-checked={enabled} aria-label="Push notifications when claude responds">`.
  This is the e2e selector + the assertion surface (`aria-checked`).
- `src/renderer/src/screens/channels/ChannelList.tsx:131,135-138,153-172` — the ChannelList root
  `section[aria-label="Conversations"]` and the top-right actions cluster (`aria-label="Settings"` gear)
  are present in **all** list states, unconditionally. This is why launch 2 reaches Settings from a
  persisted-paired boot with no connection.
- `src/renderer/src/App.tsx:64-83,111-124` and `src/main/pairingStatusHandler.ts:42-47` — the launch-time
  route decision: one mount-time `pairingStatus()` read → `routeForStatus` → `'conversation'` mounts
  `PairedShell`. `pairingStatusHandler` returns `paired` iff `store.load()` finds a record — it reads the
  persisted pairing blob, **not** the Noise handshake. Confirms launch 2 boots ChannelList from
  persisted state alone.
- `src/main/pairedServerStore.ts:144-149` + `src/main/secretBackend.ts` (the `PYRY_TEST_SECRET_BACKEND=1`
  stateless XOR backend) — why the blob written under the dir on launch 1 decrypts on launch 2: same
  dir + same deterministic backend. **The test secret-backend env flag is mandatory on launch 2**, else
  `load()` throws → status `error` → routed to pairing, not conversation.

## Context

The push-notification toggle writes renderer `localStorage['pyry.pushNotificationsEnabled']` on tap
(#409 → #408 store). `localStorage` lives inside the Electron `--user-data-dir`, so the choice survives a
relaunch that reuses that dir — but no e2e proves it. A storage regression (wrong key, hydration bug,
accidental clear-on-boot) could silently reset the preference and no test would catch it.

The shared `launchPairedApp` fixture mints a **fresh throwaway** `--user-data-dir` per launch (a
guaranteed-*unpaired* start) and **unconditionally drives** the pairing UI. A relaunch-persistence test
needs the fixture to instead **reuse a dir** across two launches and, on the already-paired second
launch, **skip the pairing drive** (the reused dir already holds the encrypted pairing blob, so the app
boots straight to the ChannelList; the paste→Pair→Confirm drive would hang waiting for a pairing screen
that never appears). That affordance is in scope here and is used by this spec only; the default
single-launch fresh-dir behavior must not change.

## Design

### Fixture affordance — one `reuseUserDataDir` option

Add a **second, optional** control parameter to the launch function, keeping the existing daemon-reply
`options` (first param) untouched so all current callers are unaffected:

```ts
export type LaunchControl = { reuseUserDataDir?: string }

launchPairedApp(options?: LaunchPairedAppOptions, control?: LaunchControl): Promise<PairedApp>
```

`PairedApp` gains one additive field so launch 1 can hand its minted dir to launch 2:

```ts
export type PairedApp = { page: Page; app: ElectronApplication; daemon: FakeDaemon; userDataDir: string }
```

Semantics of `reuseUserDataDir` (a single flag that couples dir-reuse with drive-skip — the AC's singular
"option"; the two are inseparable because a reused *paired* dir must skip the drive or the drive hangs):

- **absent (default, unchanged):** `mkdtemp` a fresh dir, register its `rm` teardown, run the full
  pairing drive → end at the **thread** (`.conversation`).
- **present:** launch against the given dir, **do not** register an `rm` teardown (the minting launch
  already registered one; deferring removal to the end-of-test LIFO drain removes it exactly once, after
  the second launch — AC "remove only after the second"), and **skip** the pairing drive. Instead, await
  the paired-boot render and return at the **list**:
  - `await expect(page.locator('section[aria-label="Conversations"]')).toBeVisible()`
  - **No row-click, no Send-enabled wait.** The paired route mounts from the persisted pairing record at
    mount time (`App.tsx` → `routeForStatus`), independent of the Noise handshake; the fixture's default
    Send-enabled wait (`launchPairedApp.ts:195`) may never resolve on the reconnecting second launch,
    whose persisted relay URL points at launch 1's now-dead forwarder. Waiting for it would hang the test.

**Forwarder + daemon are started on BOTH launches**, gated by nothing. On the reuse launch the daemon is
vestigial (the app dials the *persisted* launch-1 relay URL, not launch 2's fresh forwarder port), but
starting it keeps `PairedApp.daemon` a non-optional `FakeDaemon` — making it optional would ripple a
`possibly-undefined` type error through every `daemon.pushFrame` consumer (#425/#426/#427/#428/…). The
wasm is compiled once per process (already paid on launch 1), so launch 2's daemon start is cheap. This is
a deliberate simplicity-vs-fan-out trade: one throwaway daemon per relaunch test vs. a cross-consumer type
cascade.

Contract asserted by the fixture's own behavior (no new fixture unit test — `e2e/` is driven, not
unit-tested): default call → thread end-state, unchanged; `reuseUserDataDir` call → list end-state, no
drive, no connection wait; `userDataDir` returned on every call.

### Spec drive — one `test()`, two launches

`e2e/push-toggle-persist-relaunch.spec.ts`. `import { test, expect } from './fixtures/launchPairedApp'`.
No `buildReplyFrames`, no `daemon.pushFrame`, no codec import — default seed only.

**Launch 1 — flip the toggle away from its default:**

1. `const { page, app, daemon, userDataDir } = await launchPairedApp()` — ends at the thread.
2. thread → list: click `.conversation__back`; assert `section[aria-label="Conversations"]` visible.
   (The fixture's default drive lands on the thread; Settings is reached list-side, the #465 chain.)
3. list → Settings: click `getByRole('button', { name: 'Settings' })`; assert
   `section[aria-label="Settings screen"]` visible.
4. Locate the switch: `getByRole('switch', { name: 'Push notifications when claude responds' })`.
   Assert it is **checked** (default ENABLED — `toBeChecked()`).
5. Click it; assert it is now **unchecked** (`toBeChecked({ checked: false })`) — the in-session flip to
   DISABLED, which persists the string `'false'` under the key.

**Relaunch — close launch 1, boot launch 2 on the same dir:**

6. `await app.close()` — releases the Electron `SingletonLock` on the dir *and* triggers the graceful
   shutdown that flushes renderer `localStorage` to disk. `await daemon.close()` — kills daemon 1 so
   launch 2 provably cannot reconnect through the persisted (launch-1) relay URL, matching the ticket's
   "no live daemon connection" scenario deterministically. (Both re-run best-effort at end-of-test;
   `close()` on app and daemon is idempotent.)
7. `const { page: page2 } = await launchPairedApp({}, { reuseUserDataDir: userDataDir })` — ends at the
   list, paired-from-persistence, no drive, no connection.

**Launch 2 — assert the preference persisted:**

8. list → Settings: click `getByRole('button', { name: 'Settings' })`; assert
   `section[aria-label="Settings screen"]` visible.
9. Locate the switch (same role+name); assert it is **unchecked** (`toBeChecked({ checked: false })`).
   A reset-to-default regression would render it checked; unchecked proves the DISABLED choice persisted
   across the relaunch. **This assertion is the test.**

## State + concurrency model — the relaunch lifecycle

- **Persistence substrate.** Two independent artifacts land in the reused dir on launch 1 and are read
  back on launch 2: (a) the push preference in renderer `localStorage` (the thing under test), and (b) the
  encrypted pairing blob in `<dir>/secrets` via the stateless test secret backend (what makes launch 2
  boot *paired*). Both share the one `--user-data-dir`.
- **Ordering is mandatory, not incidental.** Launch 2 **must not** run while launch 1's app is alive:
  two Electron processes on one `--user-data-dir` collide on the `SingletonLock`. Step 6's `app.close()`
  is the barrier — it must be `await`ed before step 7. It is also the flush point: `localStorage`'s
  LevelDB commit is flushed on graceful process exit, so closing launch 1 cleanly is what makes the
  DISABLED value durable for launch 2's read.
- **Teardown.** The end-of-test LIFO drain closes launch 2's stack, re-closes launch 1's (idempotent
  no-ops), and removes the dir **last** (the `rm` thunk was registered first, by launch 1's mint, so it
  drains last — after every app is gone). No second `rm` is registered by the reuse launch, so the dir is
  removed exactly once.
- **No connection dependency on launch 2.** `routeForStatus` runs once at mount and does not re-run on a
  connection drop; the ChannelList chrome (Settings gear, `Conversations` root) renders unconditionally;
  the toggle reads `localStorage`; the Settings screen renders unconditionally. So Settings is reachable
  and the toggle is readable with zero live-daemon interaction.

## Error handling / failure modes

- **Secret-backend flag on launch 2.** The env for launch 2 must include `PYRY_TEST_SECRET_BACKEND=1`
  (and `PYRY_ALLOW_LOOPBACK_RELAY=1`) exactly as launch 1 does — the fixture already sets both for every
  launch (`launchPairedApp.ts:150-151`), so no new logic; just do not special-case the reuse launch's
  env. Without the test backend, `pairedServerStore.load()` fails to decrypt → `pairingStatusHandler`
  returns `error` → `routeForStatus` sends the app to the pairing screen, and the ChannelList never
  mounts (the reuse-boot `Conversations`-visible wait would time out — a clear failure, not a silent
  pass).
- **`SingletonLock` collision** if step 6 is skipped or not awaited: launch 2 either fails to boot or
  attaches to launch 1's instance. Manifests as a launch-2 timeout. The `await app.close()` barrier
  prevents it.
- **Accidental reconnection** if `daemon.close()` (step 6) is omitted: launch 2 could hand-shake through
  launch 1's still-listening forwarder. Benign to the assertion (the toggle is connection-independent),
  but closing daemon 1 keeps the scenario deterministic and matches the ticket's stated intent.

## Secret hygiene

Carried verbatim from the siblings and the fixture: every assertion reads DOM role / `aria-checked` /
visibility only. The synthetic pairing token and fake static key live inside `launchPairedApp` and are
never echoed. No failure diagnostic serializes the pairing payload, token, or any plaintext.

## Testing strategy

- The deliverable *is* the e2e; there is no unit layer to add. `npm run e2e` (= `build && playwright
  test`) must be green, with this spec's one `test()` passing alongside the existing fake suite.
- `e2e/` is not covered by either project tsconfig ([[e2e-not-typechecked-by-project-config]]); the
  fixture edit and the new spec should pass a standalone `tsc` (temp config extending `tsconfig.node.json`
  with `src/**` globs — the [[ticket-428-stall-snapshot-bundle-fake-e2e-refined]] gotcha). Note the
  pre-existing `launchPairedApp.ts:152` `env` baseline the sibling recorded; introduce no new standalone
  errors.
- `npm run build` (the salvage/QA gate) and `npm test` (vitest, ignores `e2e/`) must stay green — the
  fixture change is additive and vitest does not touch `e2e/`, so no unit impact is expected.

## Open questions

- **`localStorage` flush timing.** The design relies on `app.close()` flushing renderer `localStorage`
  on graceful exit — the standard Electron-persistence-e2e mechanism. If a cold runner shows the launch-2
  assertion flaking (value read as still-ENABLED), the localized fix is a settle before step 6 (or a
  read-back), not a broader change. Per Evidence-Based Fix Selection, ship without it and add only on an
  observed flake.
- **Two-launch timeout.** Both launches share the fixture's one `LAUNCH_TEST_TIMEOUT_MS` (60 s, set once
  per test). Launch 1 pays the full handshake; launch 2 pays only a spawn + render (wasm already
  compiled, no handshake wait), so ~30–40 s total is expected. If a cold runner approaches 60 s, extend
  via `test.setTimeout()` in the spec — again, only on an observed timeout.
- **Shared-fixture coordination with #464.** Sibling #464 (child A of #429, currently `error:architect`,
  no branch) will also modify `launchPairedApp.ts` (expose the forwarder + a fatal-close hook). No branch
  overlap exists today, so #466 proceeds; #464's later architect run will see #466's branch and block on
  it. Whichever lands second resolves a small merge in the `PairedApp` type / `use`-body region — the two
  changes touch adjacent but distinct concerns (forwarder exposure vs. reuse-dir control).
