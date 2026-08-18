# Spec #105 — Make `e2e/smoke.spec.ts` hermetic on an unpaired boot

**Size:** XS (PO sized S). Test-only, one file (`e2e/smoke.spec.ts`), ~45 lines total. No production code, no new exported types, no consumer fan-out.

## Design source

N/A — test-only correctness fix. The spec asserts an already-shipped screen (`.pairing`, PairingScreen `#53`) renders on an unpaired boot; it introduces no UI, so no Figma anchor is required and the visual-fidelity check is intentionally not applicable.

## Files to read first

- `e2e/smoke.spec.ts:1-11` — the whole file being changed. Currently imports `{ test, expect }` from `./fixtures/electronApp` and asserts `.conversation` at boot (line 10). Both change.
- `e2e/pair-to-conversation.spec.ts:45-90` — the **local isolated-launch precedent** (`#93`) to mirror. Copy the *shape* of its `page` fixture: `mkdtemp` temp user-data dir → `electron.launch({ args: ['.', --user-data-dir=…], env })` → `firstWindow()` → `use(page)` → `app.close()` → `rm(dir)`. **Strip everything pairing-specific** — see Design.
- `e2e/fixtures/electronApp.ts:21-42` — the shared scenario-agnostic fixture. **Do NOT modify (AC4).** Note its `env` hardening (delete `ELECTRON_RENDERER_URL`, `args: ['.']`) — smoke keeps that hardening but adds userData isolation, which this fixture deliberately lacks.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:44-48` — the `.pairing` root container (`<div className="pairing">`), the new assertion target. Present in every pairing phase (the `editing` EntryCard renders inside it), so it is the stable parallel to `.conversation`.
- `src/renderer/src/App.tsx:38-66` — the router. On unpaired boot: route starts `pending` (renders `null`), the mount effect calls `window.pyry.pairingStatus()`, `routeForStatus` maps every non-paired outcome (and a rejected invoke) to `pairing` → PairingScreen mounts. This is *why* `.pairing` appears and `.conversation` never mounts unpaired.
- `playwright.config.ts:8-14` — `testDir: './e2e'`, `fullyParallel: false`, `workers: 1`. The full suite runs every spec serially, so a broken smoke is the one RED among green scenarios (AC5); launches never contend.
- `package.json` (`"e2e"` script) — `npm run e2e` = `npm run build && playwright test`. Build runs first (the salvage/QA gate); then all specs.

## Context

`e2e/smoke.spec.ts:10` asserts `.conversation` (ConversationScreen root) is visible at boot. That assertion predates the `#80/#84` app-shell router. Post-router, a genuinely-unpaired boot routes to **PairingScreen**, so `.conversation` never mounts and the test times out. It only "passes" on a machine whose shared, non-isolated Electron userData already carries a stale pairing (macOS `~/Library/Application Support/pyrycode-desktop/secrets/`) — a state no clean machine or CI runner can reach (and pairing couldn't even be completed in the built app until `#101` fixed the BoringSSL BLAKE2s bug). It is non-hermetic by construction. `#93` (PR #102) surfaced it: un-fixmed `pair-to-conversation.spec.ts` made `npm run e2e` run the whole `e2e/` dir for the first time, exposing smoke's independent, pre-existing failure; it was filed separately per `#93`'s scope discipline.

## Design

Single-file change to `e2e/smoke.spec.ts`. Two coupled edits: (1) replace the shared-fixture import with a **local isolated-launch fixture**, (2) swap the boot assertion to `.pairing`.

### Why the launch must be local (not the shared fixture)

The shared `e2e/fixtures/electronApp.ts` launches `args: ['.']` with **no userData isolation** — it inherits the developer's real userData and its stale pairing (the root cause). AC4 forbids modifying it (it stays scenario-agnostic for future scenarios per `#40`/`#93`). So the isolating launch must live in the spec, exactly as `#93` kept its launch machinery local. smoke therefore **stops importing** `./fixtures/electronApp` and defines its own `test` via `base.extend`.

### The local `page` fixture (contract)

Mirror `pair-to-conversation.spec.ts`'s `page` fixture, **stripped to the minimum smoke needs**. smoke never pairs and never sends, so it needs *none* of that spec's pairing scaffolding:

- **Drop** the `forwarder` and `daemon` fixtures — no fake relay target is dialed (the app sits on the pairing screen).
- **Drop** the `LOOPBACK_RELAY_ENV_FLAG` and `TEST_SECRET_BACKEND_ENV_FLAG` env flags — those gate pairing affordances (`#97`/`#99`) that smoke never exercises. Keep the launch env minimal.
- **Keep** the `delete env.ELECTRON_RENDERER_URL` hardening (mirrors `electronApp.ts:30-32`) so `createWindow` uses the built-renderer path, not a dead dev-server URL.
- **Keep** the isolated `--user-data-dir` — this is the whole fix.

Fixture skeleton (contract sketch — the developer writes the idiomatic body):

```ts
import { test as base, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const test = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL            // built-renderer path, not a dev URL
    const userDataDir = await mkdtemp(join(tmpdir(), 'pyry-e2e-smoke-'))
    const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env })
    const page = await app.firstWindow()
    await use(page)                              // ── epilogue fires on pass AND fail ──
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
```

- Overriding Playwright's built-in `page` fixture this way is the proven `#93` pattern — no separate `electronApp` fixture, no LIFO teardown chain needed (there is no external process to order against).
- The `use()` epilogue runs through Playwright's fixture lifecycle, so `app.close()` + `rm()` fire on pass *and* fail — no orphaned Electron process, no leaked temp dir (AC3's "cleans up on pass and fail").

### The assertion

Replace line 10 with a single visibility assertion on the pairing root:

```ts
await expect(page.locator('.pairing')).toBeVisible()
```

The locator auto-waits through the async `pending → pairing` route transition (App starts `pending` → `null`, then `pairingStatus()` resolves `not-paired` → setRoute `pairing`), exactly as the old assertion auto-waited through `pending → conversation` on a stale-paired machine. Assert the **container** (`.pairing`), not a specific control — matches AC2 and stays robust to pairing-phase copy changes.

Update the file's header comment to say the smoke check now proves the shell renders the **unpaired-boot** screen (pairing), and note the isolated userData is what guarantees the unpaired start.

### State + concurrency model

None. No store, no async iterables, no cancellation. One synchronous assertion after a one-shot launch. `playwright.config.ts` runs `workers: 1, fullyParallel: false`, so smoke and `pair-to-conversation` never contend for a window or the temp-dir namespace.

## Why `.pairing` mounts on an isolated boot (hermeticity, AC1 + AC3)

`--user-data-dir` overrides `app.getPath('userData')`, so the launch reads a fresh, empty secrets store regardless of any ambient shared-userData pairing. `window.pyry.pairingStatus()` resolves `not-paired` → `routeForStatus` → `pairing` → PairingScreen → `.pairing`. The result is identical with or without an ambient pairing on the machine (AC3): the isolated dir makes the shared one invisible. The temp dir is removed in the epilogue; even a skipped `rm` is OS-reaped since it lives under `os.tmpdir()`, and `force: true` never throws on a missing dir.

## Note on `electronApp.ts` becoming unimported

> **SUPERSEDED 2026-08-18 (#546). The file has been deleted.** The rule below was written to preserve
> the fixture for two named future scenarios. Both have since shipped and neither used it: `#40` and
> `#93` are closed, and every e2e spec launches through `launchPairedApp` or the `realDaemon` fixture
> instead. At deletion, 26 specs used those two and nothing imported `electronApp.ts` — the remaining
> textual mentions were comments explaining why it was *not* used, plus one unrelated local variable.
>
> Keeping it had turned into a cost rather than a saving. Its header still advertised it as the
> primitive new scenarios should import, and what they would have inherited is precisely the
> non-hermetic launch this spec moved smoke off: no `--user-data-dir`, no isolation, the developer's
> real user data and any persisted pairing visible to the test. The hermeticity argued for below is
> unchanged and still correct; only the decision to keep an unused, non-hermetic launcher alongside it
> is reversed.

The rule as originally written, kept for the trail:

- **Do NOT delete `electronApp.ts`** — AC4 keeps it as the scenario-agnostic launch primitive for future scenarios (`#40`/`#93`).
- **Do NOT modify it** — AC4.
- No gate fails on an unimported fixture: `e2e/` is in neither tsconfig's `include` (known-issue — Playwright type-checks specs itself, and a fixture with no `test(...)` is never executed as a spec), so an "unused module" produces no build or test failure.

## Error handling

No new failure modes. The one guard carried forward is the `ELECTRON_RENDERER_URL` strip (prevents a `loadURL`-to-dead-dev-server hang, per `electronApp.ts:26-29`). No secrets are written — the app never pairs, so the isolated userData holds nothing sensitive; still, it is removed on teardown.

## Testing strategy

The spec **is** the test. Verification the developer runs:

- **AC1 / AC2** — `npx playwright test smoke.spec.ts` passes on a clean environment (no persisted pairing), asserting `.pairing` visible.
- **AC3** — the same spec passes *with* an ambient shared-userData pairing present and *without* it, yielding the same result (the isolated `--user-data-dir` decouples it). If a stale shared pairing exists on the dev box, run once as-is and once after temporarily moving `~/Library/Application Support/pyrycode-desktop/secrets/` aside to prove independence.
- **AC4** — `git diff` shows `e2e/fixtures/electronApp.ts` untouched.
- **AC5** — `npm run e2e` (full suite) is green; smoke is no longer the one RED spec among passing scenarios.

No unit tests apply (this is the e2e harness). No `npm test` / `npm run typecheck` coverage change — `e2e/` is outside both configs.

## Open questions

None material. The temp-dir prefix (`pyry-e2e-smoke-` vs `#93`'s `pyry-e2e-`) is cosmetic; a smoke-specific prefix just aids triage of leaked dirs.
