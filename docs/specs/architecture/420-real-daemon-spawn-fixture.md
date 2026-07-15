# #420 — Extract the real-daemon spawn fixture from `real-claude.spec.ts`

**Size:** S — pure code move + a two-line config widen. Zero production `src/` change. Net-zero new logic; the unchanged `real-claude.spec.ts` staying green (skipping cleanly on the agent machine) is the whole proof.

**Not security-sensitive** (no label; test infra, no `src/` change). **Not UI** (no Figma). No `## Design source` section.

## Files to read first

- `e2e/real-claude.spec.ts:1-238` — **the source of the extraction.** Lines 85-238 are the fixture chain (`SpawnedDaemon` / `RealClaudeFixtures` types + the `relay`/`daemon`/`page` `base.extend` block). This whole block moves.
- `e2e/real-claude.spec.ts:240-449` — the standalone helpers + constants the fixtures call: `encodePairingPayload`, `resolveOnPath`, `resolvePyryBin`, `runPyryPair`, `isRecord`, `decodePairFields`, `seedRegistry`, `dialUnixSocket`, `delay`, `waitForDaemonReady`, `killGroup`, `reapDaemon`, and the constants `BOOTSTRAP_UUID`, `BOUND_CONVERSATION_ID`, `DAEMON_READY_TIMEOUT_MS`, `PAIR_TIMEOUT_MS`. These move.
- `e2e/real-claude.spec.ts:50-73, 451-528` — the parts that **stay**: the streaming selectors (`ASSISTANT_ROW`, `CURSOR_CHAR`, `CURSOR_SELECTOR`), the spec-body timeouts (`HANDSHAKE_TIMEOUT_MS`, `TURN_TIMEOUT_MS`, `SPEC_TIMEOUT_MS`), `nonEmptyAssistantCount`, and the `test(...)` block.
- `e2e/fixtures/launchPairedApp.ts:1-213` — **the fixture convention to mirror** (#433): module-header comment, `export const test = base.extend<…>({…})`, `export { expect }`, `../../src/…` import depth. `realDaemon.ts` follows this shape.
- `e2e/fixtures/electronApp.ts:1-45` — the smaller sibling convention; confirms fixture files re-export `test` + `expect`.
- `playwright.real-claude.config.ts:1-21` — the config whose `testMatch` (line 14) widens.
- `playwright.config.ts:8-14` — the default config; its `testIgnore` (line 13) is the complementary half of the same partition (see § Config widen).
- Memory: e2e files are **not** covered by `npm run typecheck` (`tsconfig.node.json` / `tsconfig.web.json` don't include `e2e/`), and `@shared`-style aliases don't apply — `e2e/` uses relative `../../src/…` imports.

## Context

`e2e/real-claude.spec.ts` (#252) is the only real-stack spec — it spawns a real `pyry` daemon running real claude, bridges it through #251's content-blind routing relay to the built Electron window, and asserts a reply streams into the thread twice. The whole spawn recipe is inline: binary resolution, skip-gating (missing binaries/creds ⇒ the suite must **skip**, never fail), `seedRegistry` (seeded `sessions.json` + `conversations.json` binding `default`), spawn args (`PYRY_MOBILE_V2=1`, the `/v1/server` relay leg, the short `/tmp/pyry-sock-*` socket dir for the macOS 104-byte `sun_path` limit), `waitForDaemonReady`, and process-group reap.

The coming tier-2/tier-3 real-stack specs (`real-daemon-actions`, real-claude interrupt/queue, permission modal) would each re-transcribe this harness. #420 extracts it once into `e2e/fixtures/realDaemon.ts`, alongside the already-merged `launchPairedApp.ts` (#433, which did the same for the *fake*-daemon pairing harness). This is a **pure move** — behaviour is unchanged; `real-claude.spec.ts` staying green is the proof.

The stale AC3/AC4 (`e2e:real` alias + README section) were dropped in refinement: both already exist under `e2e:real-claude` (landed with #252 after this ticket was filed). **Do not rename the alias, do not touch the README gate** — the name is referenced across ~9 files including documentation-phase-owned notes; renaming is a cascade for zero functional gain.

## Design

A pure extraction. The unit that moves is the **entire fixture chain plus its transitive helpers** — the `daemon` fixture (the spawn recipe named in AC1) can't be split from the `relay` fixture it depends on or the `page` fixture that depends on it: Playwright fixtures compose within one `test` object, so the `base.extend` block moves whole. The spec keeps only its streaming assertions and the `test(...)` body.

### New file: `e2e/fixtures/realDaemon.ts`

Mirror `launchPairedApp.ts`'s shape: a module-header comment (what this is, #420 provenance, the skip-gate + LIFO-teardown contract), then the moved code, then the exports.

**Export surface:**

| Export | Kind | Why exported |
|--------|------|--------------|
| `test` | `base.extend<RealDaemonFixtures>({ relay, daemon, page })` | The composed fixture object every real-* spec imports. |
| `expect` | re-export from `@playwright/test` | Convention (`launchPairedApp.ts`, `electronApp.ts`). |
| `encodePairingPayload` | `(qr: QrPayload) => string` | Used by the spec body's pairing drive **and** every future real-* spec's drive. Pure leaf encoder. |
| `RealDaemonFixtures` | `type` | So a spec can annotate if it wants; also carried implicitly through `test`. |
| `SpawnedDaemon` | `type` (`{ pairFields: Pick<QrPayload, 'server' \| 'token' \| 'server_static_pubkey'> }`) | The `daemon` fixture value shape; future helpers may reference it. |

Rename the fixtures type `RealClaudeFixtures` → `RealDaemonFixtures` (it's now shared beyond the one spec). Cosmetic; the type is fixture-internal + exported.

**Fixture chain (moved verbatim, no logic change):**
- `relay` — `startFakeRoutingRelay()` → `use` → `close()`.
- `daemon` — skip-gate (resolve `claude`/`pyry`/creds, `testInfo.skip` on any miss **before** creating any resource), then `runPyryPair` + `decodePairFields` + `seedRegistry` + `spawn` (detached) + `waitForDaemonReady`, all wrapped in `try/finally { cleanup() }` so the subprocess + temp dirs are reaped on every exit path.
- `page` — launch the built app with an isolated `--user-data-dir`, the two `isPackaged`-gated dev flags, `ELECTRON_RENDERER_URL` stripped; depends on `daemon` for LIFO teardown order (`void daemon`).

**Helpers + constants that travel** (all called only by the fixtures): `resolveOnPath`, `resolvePyryBin`, `runPyryPair`, `isRecord`, `decodePairFields`, `seedRegistry`, `dialUnixSocket`, `delay`, `waitForDaemonReady`, `killGroup`, `reapDaemon`; `BOOTSTRAP_UUID`, `BOUND_CONVERSATION_ID`, `DAEMON_READY_TIMEOUT_MS`, `PAIR_TIMEOUT_MS`. Keep them file-private (not exported) except where the table above says otherwise.

**⚠️ Import-depth shift — the one real edit inside the moved code.** The fixture sits one directory deeper than the spec, so every `../src/…` import becomes `../../src/…`:
- `../src/main/transport/fakeRoutingRelay` → `../../src/main/transport/fakeRoutingRelay`
- `../src/main/relayPolicy` → `../../src/main/relayPolicy`
- `../src/main/secretBackend` → `../../src/main/secretBackend`
- `../src/shared/wire/types` → `../../src/shared/wire/types`

This is the single highest-risk line in the whole ticket. `launchPairedApp.ts` already uses `../../src/…` — match it. A wrong depth surfaces as a Playwright module-resolution error at spec load (see § Testing).

### Modified: `e2e/real-claude.spec.ts`

After extraction the spec shrinks to: imports + streaming selectors + spec-body timeouts + `nonEmptyAssistantCount` + the `test(...)` block.

**New import line (replaces all the moved `node:` + `../src` imports):**
```ts
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { type Page } from '@playwright/test'   // for nonEmptyAssistantCount's signature only
```
The `test(...)` callback destructures `{ relay, daemon, page }` — all provided (and typed) by the imported `test`; the spec accesses `relay.url`, `daemon.pairFields`, and `page` exactly as today, with no explicit type import needed. Everything else in the spec body is unchanged.

### Config widen (AC2 + its complementary half)

The two configs partition every spec by the `real-` filename prefix: real-* specs run **only** under the real config, never the agent-pipeline default. #420 moves that partition boundary from `real-claude` to `real-*`, so **both** matchers move together — widening one without the other leaves the partition inconsistent (a future `real-daemon-actions.spec.ts` would match the real config *and* leak into the default `npm run e2e`, which has no daemon).

- `playwright.real-claude.config.ts:14` — `testMatch: /real-claude\.spec\.ts$/` → `/real-.*\.spec\.ts$/` (**AC2, required**). `real-claude.spec.ts` still matches, so the operator gate keeps running unchanged.
- `playwright.config.ts:13` — `testIgnore: /real-claude\.spec\.ts$/` → `/real-.*\.spec\.ts$/` (**completes the same invariant**). No behaviour change today (real-claude is the only real-* spec, already ignored); it keeps the agent pipeline from picking up the *next* real-* spec.
- Update the "single real-claude spec" prose comments in both files (real-claude.config `:4`, default config `:10-11`) to say "every `real-*` spec".

The widened regex is not start-anchored (matching the existing pattern) and, within `testDir: './e2e'`, still matches only files whose basename starts with `real-` — none of `pair-to-conversation`, `send-and-stream`, `smoke` match.

## State + concurrency model

**Unchanged** — the extraction preserves it exactly. The fixture chain `relay → daemon → page` forces LIFO teardown (`page → daemon → relay`): the app closes first so its reconnect supervisor can't churn on the daemon/relay drop. The `daemon` fixture's `try/finally { cleanup() }` reaps the detached subprocess (process-group SIGTERM→grace→SIGKILL via `killGroup`, enabled by `detached: true` so the real-claude grandchild dies with it) and removes both temp dirs on setup failure, test failure, and success. No new concurrency surface is introduced; this is a relocation of existing async fixtures.

## Error handling

**Unchanged.** Skip-gating stays deterministic and fires **before** any resource is created (missing `claude`/`pyry`/creds ⇒ `testInfo.skip`, an unrun test — the correct outcome on the agent machine). Secret hygiene is preserved verbatim: `pyry pair` stdout (which carries the pairing token) is never echoed on failure; only the content-free daemon **stderr** is surfaced, and only on a **startup** failure before any message flows (`waitForDaemonReady` stops capturing after readiness). Moving these functions changes none of that — same bodies, same call sites.

## Testing strategy

There is **no new test.** The existing `real-claude.spec.ts` is the test; a clean extraction is proven by it behaving identically.

Verification the developer can run **on the agent machine** (no real daemon/claude/creds):

1. `npm run build` — the salvage/QA gate; must pass (does not compile `e2e/`, but must stay green).
2. `npm run e2e:real-claude` — runs `npm run build` then loads the spec under the widened real config. Expected output: **`1 skipped`** (the `daemon` fixture's skip-gate fires because binaries/creds are absent). This is the load-time proof:
   - A wrong import depth in `realDaemon.ts` fails at **module resolution** (spec load, before collection) → the run **errors**, not skips. `1 skipped` ⇒ the import graph resolved.
   - `real-claude.spec.ts` still being collected under `/real-.*\.spec\.ts$/` ⇒ the operator gate is intact.
3. `npm run e2e` — the default agent pipeline; confirm it does **not** collect `real-claude.spec.ts` (still ignored by the widened `testIgnore`).

Note: because `e2e/` is outside both tsconfig `include`s, `npm run typecheck` will not catch a type error in the fixture. The mitigation is inherent to a pure move — the code compiled green on `main`; the only new type-surface risk is the import depth, and that surfaces as the load error in step 2. (Type correctness on the real stack is verified when an operator runs the spec end-to-end with binaries present.)

Full green (`1 passed`) is only reproducible on a machine with `pyry` + `claude` + an Anthropic credential — the operator's pre-ship gate, out of the agent's reach and unchanged by this ticket.

## Open questions / non-goals

- **The pairing drive stays in the spec** (the ~24-line paste→Pair→Confirm→wait-for-Send block in the `test` body). AC1 scopes the *spawn recipe*, not the DOM drive. Extracting a shared `pairRealDaemon(page, relay, daemon)` helper is deferred to the **second** real-* spec, mirroring how `launchPairedApp` itself was extracted only after #93 **and** #94 both existed — extract-on-second, not extract-on-first. `encodePairingPayload` is exported now because it's a pure leaf the drive needs, not a speculative abstraction.
- **`encodePairingPayload` duplication with `launchPairedApp.ts`** (which keeps its own private copy) is **out of scope** — de-duplicating across the fake and real fixtures is a separate refactor; "don't touch adjacent code while you're here."
- **Do not rename the `e2e:real-claude` alias** and **do not touch the README pre-ship gate** — both already exist (#252) and renaming cascades across ~9 files including Never-Update docs.
