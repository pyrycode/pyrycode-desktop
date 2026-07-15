# Spec — #439: claude-less real-daemon spawn harness + rename round-trip

**Size:** S (2 files, zero `src/` production change). Additive option fixtures on the existing
`realDaemon.ts`; one new `real-*` spec. No consumer cascade — `real-claude.spec.ts` is untouched.

**Not security-sensitive** (no `security-sensitive` label). **Not UI-visible** (an e2e harness; no Figma).

---

## Files to read first

- `e2e/fixtures/realDaemon.ts` (whole, ~430 lines) — the fixture this ticket extends. Key regions:
  - `80-216` — the `test.extend<RealDaemonFixtures>` block: the `relay` → `daemon` → `page` chain (its
    dependency order IS the LIFO teardown; do not collapse it).
  - `87-128` — the `daemon` fixture skip-gate (`claude`, `pyry`, credential, `.claude.json`). This is the
    branch point for claude-less mode.
  - `168-190` — the spawn args (`-pyry-claude`, post-`--` claude args) + `spawn(... detached)`.
  - `329-344` — `seedRegistry`: hardcodes `"is_promoted":false`; gains an `isPromoted` param.
  - `408-427` — `reapDaemon` process-group kill (unchanged; still correct with no claude grandchild).
- `e2e/real-claude.spec.ts` (whole, ~130 lines) — the spec template. Reuse its pairing drive (`79-103`),
  its timeout constants (`40-49`), and its secret-hygiene posture (`26-27`). It must keep consuming the
  fixture **unchanged** (AC2).
- `src/renderer/src/screens/channels/ChannelList.tsx` — `73-97` the Rename open/dispatch wiring;
  `316-319` the `.channel-list__title` span (the title text the spec asserts on); `325-341` the
  `.channel-list__rename` pencil (`aria-label="Rename"`, renders **only** for promoted rows).
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` — the dialog drive selectors:
  `.rename-conversation` (`role="dialog"`), `.rename-conversation__input`, `.rename-conversation__save`
  (text "Save", disabled while blank).
- `src/renderer/src/store/conversationListBridge.ts` — `47-49` `shouldRefreshList` (re-list fires **only**
  on `conversationUpdated`/`conversationDeleted`); `102-133` the initial `list_conversations` request on
  the rising edge to `connected`. This is the readiness + liveness chain the spec rides.
- `src/renderer/src/PairedShell.tsx` — `44-47`, `83` — post-pairing the paired region enters at
  `route='list'` → `ChannelList` renders (no thread entry needed).
- `src/renderer/src/screens/channels/channelListViewModel.ts` — `16-34` `titleFor` (null/blank name →
  `"Untitled"`) + `partitionByPromotion` (`is_promoted:true` → Channels section → the pencil).
- `playwright.real-claude.config.ts` (whole) + `playwright.config.ts:14` — the `testMatch`
  `/real-.*\.spec\.ts$/` (runs the new spec under `e2e:real-claude`) and the default config's `testIgnore`
  (excludes it from `npm run e2e`). The new filename `real-daemon-rename.spec.ts` matches both.
- `e2e/send-and-stream.spec.ts` + `e2e/pair-to-conversation.spec.ts` — how the fake-daemon specs assert
  on the list/thread; reuse the assertion idiom (DOM text / visibility / counts only).
- `docs/lessons.md` — the fake-claude substitution note (`Pool.Create` appends `--session-id <uuid>`;
  multi-session e2e tests substitute `/bin/sleep`-style binaries for `-pyry-claude`). Justifies the
  claude-less placeholder.

---

## Context

This ships the **credential-light real-daemon tier** — a real spawned `pyry` daemon on the
`fakeRoutingRelay`, gating on the `pyry` binary alone (no `claude`, no Anthropic credential). It exists to
catch the `promote_conversation` class of gap (pyrycode/pyrycode#949): the daemon defined the type +
payload + registry op but registered **no handler**, so the real wire answered `unsupported` — while the
entire fake-daemon suite stayed green, because a fake answers anything. The registry-backed user actions
(rename / archive / restore / delete / recent-workspaces / create-folder / change-workspace /
session-settings / dequeue) are pure registry ops daemon-side and never touch claude, so they can be
proven against a real daemon deterministically and cheaply.

This ticket delivers the reusable harness that the sibling action specs (#440–#443, natively blocked-by
this ticket) ride, **coupled with rename as its liveness proof** (fix-plus-liveness-test boundary). Rename
is the safest liveness action: `rename_conversation` is a *registered* pure registry op daemon-side
(pyrycode/pyrycode#820: decode → mutate → eager `Save` → typed reply; daemon-side e2e #974) — exactly the
handler `promote_conversation` lacked.

**Out of scope (do not expand):** `real-claude.spec.ts` is stale (it asserts `.conversation` visible
immediately after Confirm, but current routing lands paired sessions on `route='list'` — the same
staleness class #435 repaired). AC2 requires the spawn-mode **code** to be additive-unchanged, NOT that
`real-claude.spec.ts` currently passes. Repairing it is a separate #435-style ticket.

---

## Design

### Export surface — two additive option fixtures on the existing `test`

Add two Playwright **option fixtures** to the `base.extend` in `realDaemon.ts`, defaults chosen so the
existing behavior is byte-for-byte preserved:

```ts
type RealDaemonOptions = {
  spawnClaude: boolean   // default true  — the claude-spawning mode (real-claude.spec.ts)
  seedPromoted: boolean  // default false — the seeded conversation's is_promoted
}
// test.extend<RealDaemonOptions & RealDaemonFixtures>({ spawnClaude:[true,{option:true}], seedPromoted:[false,{option:true}], relay, daemon, page })
```

A spec selects the claude-less + promoted mode at file scope:

```ts
test.use({ spawnClaude: false, seedPromoted: true })
```

**Why option fixtures, not a factory/sibling fixture.** The `relay → daemon → page` chain's dependency
order *is* the LIFO teardown (page closes first so the app's supervisor can't churn-reconnect on the
daemon/relay drop). A factory fixture (the `launchPairedApp` shape) would collapse that chain and force
`real-claude.spec.ts` to change its call shape — violating AC2. Option fixtures are purely additive:
`real-claude.spec.ts` keeps destructuring `{ relay, daemon, page }` and never sets an option, so it gets
`spawnClaude:true` + `seedPromoted:false` — its exact current behavior.

**Why two orthogonal booleans.** The four siblings need both axes independently: all set
`spawnClaude:false`; #443 (save-as-channel) needs `seedPromoted:false` (an *unpromoted* row), the others
toggle as their action requires. Keep the seed's `is_promoted` a **per-spec option, not a shared default**.

### `daemon` fixture branching (contract — keep the `spawnClaude:true` path identical)

Branch inside the `daemon` fixture on `spawnClaude`; the `true` path must produce the **exact same** args
array and `.claude.json` seeding as today (real-claude.spec.ts is the regression proof).

- **Skip-gate.** Always resolve + gate `pyry` (`resolvePyryBin`). Only when `spawnClaude`: also resolve +
  gate `claude`, gate the `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` pair, and read the operator's
  `.claude.json`. Claude-less mode gates **only** `pyry` — it does NOT skip on missing `claude`, does NOT
  skip on missing credential, and seeds no `.claude.json` (AC1, AC4).
- **Skip message.** Keep the existing `pyry` hint; extend the tree note to `#820`-inclusive (the rename
  handler) alongside the existing `#854` requirement.
- **The unreachable re-assert** (currently lines 124-128, `throw` to narrow the nulls): narrow only the
  values the branch consumes — `pyryBin` always; `claudeBin` **only** in the `spawnClaude` branch (it is
  intentionally `null` and unused in claude-less mode).
- **Spawn args.** Identical except:
  - `-pyry-claude`: `spawnClaude` → `${claudeBin}` (unchanged); claude-less → the placeholder (below).
  - post-`--` args (`--model haiku --dangerously-skip-permissions`): present when `spawnClaude`; **omitted**
    in claude-less mode (no claude turn ever runs — passing claude flags to a non-claude placeholder is
    misleading, and the daemon appends `--session-id <uuid>` regardless).
- **`.claude.json` seed** (currently line 146-148): only when `spawnClaude`.
- **`seedRegistry`** gains a third param `isPromoted: boolean`, threaded from the `seedPromoted` option; it
  replaces the hardcoded `"is_promoted":false` in `conversations.json`. Everything else in the seed
  (bootstrap session, `'default'` binding, modes `0o600`) is unchanged.

### The `-pyry-claude` placeholder (claude-less mode)

Write a self-contained no-op executable into `daemonHome` and point `-pyry-claude` at it:

- `<daemonHome>/noop-claude.sh` — `#!/bin/sh` + `exit 0`, mode `0o755`. Mirrors the existing
  write-into-`daemonHome` pattern (`.claude.json`); the `daemonHome` cleanup already removes it, so no new
  teardown.

**Why a placeholder and not omission.** The credential-light invariant is *"no real claude binary or
Anthropic credential required,"* not *"flag absent"* (Technical Notes). Pointing the flag at a
harness-owned executable removes all dependence on the daemon's default `-pyry-claude` resolution (which
might fall back to a PATH `claude` that claude-less machines lack).

**Why it is never invoked during a rename.** `real-claude.spec.ts` documents the first turn as a **cold
PTY claude spawn** (its `TURN_TIMEOUT` comment) — i.e. the daemon spawns claude **lazily on the first
`send_message`**, not at boot. Rename triggers no `send_message` (it is a pure registry op), so the
placeholder is never executed; it only has to be an executable path the daemon accepts at flag-parse
time. The daemon is designed to accept substitutable claude binaries — `docs/lessons.md` records
`/bin/sleep`-style fake-claude binaries used as `-pyry-claude` in the daemon's own multi-session e2e.

**Fallback (Open Question 1).** If, on the operator machine, the daemon eagerly spawns claude at boot for
the seeded *active* bootstrap session and treats the immediate `exit 0` as a crash, switch the placeholder
to a long-lived no-op (`#!/bin/sh` + `exec sleep 2147483647`), which occupies the slot and reaps with the
process group. This is verifiable where the spec runs (the operator machine).

### Seed promotion — drive option (a)

Per the ticket's option (a): the claude-less spec seeds `is_promoted:true`, so the row lands in the
**Channels** section and renders the `.channel-list__rename` pencil (`partitionByPromotion` →
`ChannelList.tsx:256-258`). This keeps the drive on the list (no thread entry, fewer steps than the
Channel-Info-sheet route (b)). The seeded conversation carries **no `name`** (the registry seed omits it),
so its rendered title is `"Untitled"` (`titleFor(null)`) — a fine, distinct "old title" for the assertion.

### New spec — `e2e/real-daemon-rename.spec.ts`

Imports `{ test, expect, encodePairingPayload }` from `./fixtures/realDaemon`; `test.use({ spawnClaude:
false, seedPromoted: true })` at file scope. Timeout constants mirror `real-claude.spec.ts`:
`HANDSHAKE_TIMEOUT_MS = 45_000`; add `RENAME_TIMEOUT_MS ≈ 15_000` (a fast registry op + the re-list
round-trip). `test.setTimeout(≈90_000)` — well under the config's 300s default; there is no cold-claude
turn to absorb.

**Drive (scenario, not full body):**

1. Build the pairing payload via `encodePairingPayload` with `relay: ${relay.url}/v1/client` and
   `daemon.pairFields` — identical to `real-claude.spec.ts:80-87`.
2. `pasteBox.fill(payload)` → click **Pair** → `expect(fingerprint).toBeVisible()` → click **Confirm**
   (`aria-label`/role selectors from `real-claude.spec.ts:89-99`).
3. **Readiness gate:** `await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout:
   HANDSHAKE_TIMEOUT_MS })`. The pencil appearing proves the whole chain: handshake complete → session
   `connected` → the auto-fired `list_conversations` round-trip returned the seeded row → it rendered
   **promoted** (in Channels). Stronger and more specific than a Send-enabled gate for this spec.
4. Capture the old title: `const oldTitle = (await page.locator('.channel-list__title').first()
   .textContent())?.trim() ?? ''` (deterministically `"Untitled"`, but read from the DOM so the assertion
   is robust to whatever the daemon actually returns).
5. `const NEW_TITLE = \`renamed ${runNonce}\`` where `runNonce = Date.now()` — per-run nonce so reruns
   differ (defeats any accidental reply caching) and it can never collide with `oldTitle`.
6. Click `.channel-list__rename` → `expect(page.locator('.rename-conversation')).toBeVisible()`.
7. `page.locator('.rename-conversation__input').fill(NEW_TITLE)` — `fill` clears the prefilled current
   title before typing.
8. Click `.rename-conversation__save` (**Save** — enabled because `NEW_TITLE` is non-blank).
9. **Assert new title renders** (AC3): `await expect(page.locator('.channel-list').getByText(NEW_TITLE,
   { exact: true })).toBeVisible({ timeout: RENAME_TIMEOUT_MS })`. This auto-waits the rename round-trip:
   command → daemon `rename_conversation` → `conversation_updated` broadcast → `shouldRefreshList` →
   re-request → updated reply → re-render.
10. **Assert old title gone** (AC3): `await expect(page.locator('.channel-list').getByText(oldTitle,
    { exact: true })).toHaveCount(0)`.

**Secret hygiene (AC5):** every assertion reads DOM text / visibility / counts only; `NEW_TITLE` and
`oldTitle` are non-secret literals; the pairing payload is built the same way as `real-claude.spec.ts` and
never echoed into a message. No failure diagnostic serializes the token, keys, or a transcript.

---

## State + concurrency model

- **No new fixtures beyond the two options.** The `relay → daemon → page` chain and its LIFO teardown are
  unchanged; option fixtures do not alter fixture ordering.
- **No claude grandchild** in claude-less mode. Keep `reapDaemon`'s process-group kill unchanged — it is
  still correct (it reaps `pyry` alone, or `pyry` + the placeholder if a fallback long-lived no-op is ever
  spawned).
- **Readiness** is event-driven via the product's own `ConversationListData` (list request on the
  `connected` rising edge) — the spec never pokes the store; it waits on rendered DOM.

## Error handling

- **Skip, never fail, when `pyry` is unavailable** (AC4) — `testInfo.skip` before any resource is created,
  exactly as today. Claude/credential absence does **not** skip in claude-less mode.
- **Startup failure** surfaces the content-free (#62) daemon stderr via the existing `waitForDaemonReady`
  — unchanged, and safe (a startup-only failure before any message flows).
- **Rename round-trip failure** (daemon doesn't persist, or doesn't broadcast `conversation_updated`) →
  step 9 times out. That is a **genuine liveness signal** (the #949-class catch), not a flake; the
  real-claude config runs with `retries:0` by design. Do NOT weaken the assertion or add a manual re-request
  in the spec to force a pass — see Open Question 2.

## Testing strategy

- This *is* the test tier; there are no unit tests. Coverage is `npm run e2e:real-claude` on the operator
  machine (with `pyry` present, `claude`/creds **not** required).
- **Agent-machine validation the developer can run now** (no `pyry` present):
  - `npm run e2e` → the new spec is excluded by the default config's `testIgnore` (must not appear).
  - `npm run e2e:real-claude` → the new spec **skips cleanly** (pyry absent), never fails; `real-claude.spec.ts`
    still skips cleanly too (unchanged gate).
  - `npx playwright test --config playwright.real-claude.config.ts --list` → confirms the new filename is
    collected under `testMatch` and the fixture change compiles.
- **`e2e/` is not typechecked by the project tsconfigs** (neither `tsconfig.node.json` nor
  `tsconfig.web.json` includes `e2e/`), so `npm run build` will **not** catch a fixture type error — rely
  on Playwright's own TS compile via `--list` / a spec run. Keep `npm run build` green regardless (it
  compiles no e2e code).

## Open questions

1. **Placeholder invocation at boot.** The no-op `exit 0` placeholder assumes the daemon spawns claude
   lazily on first send (real-claude's cold-PTY evidence). If the operator machine shows the daemon
   eagerly spawning claude at boot for the seeded active session and failing on the immediate exit,
   switch to the long-lived `exec sleep …` fallback. Resolve on the operator machine where the spec runs.
2. **The assertion rides the daemon's `conversation_updated` broadcast.** The desktop re-lists **only** on
   `conversationUpdated` (`shouldRefreshList`) — it does not re-list on the rename typed reply. If #820
   persists the rename but does **not** emit the broadcast, step 9 times out. Treat that as a real
   desktop/daemon integration gap to file separately (it is precisely what this tier is built to surface),
   **not** a reason to add a manual `requestConversations` in the spec.
3. **Does `list_conversations` echo the registry's `is_promoted:true`?** The renderer side is confirmed
   (promoted → Channels → pencil). The ticket states the daemon side is validated against merged code; if
   it does not, the readiness gate (step 3) times out — file separately. Low risk per the ticket.
