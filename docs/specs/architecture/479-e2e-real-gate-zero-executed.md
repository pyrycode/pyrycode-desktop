# Spec #479 — operator gate: fail on zero-executed real-* e2e

**Ticket:** [#479](https://github.com/pyrycode/pyrycode-desktop/issues/479) · **Size:** S · **Security-sensitive:** no · **Figma:** N/A (CLI exit-code gate, no UI surface)

## Files to read first

- `e2e/fixtures/realDaemon.ts:126-168` — the `daemon` fixture's `testInfo.skip(...)` calls. **These strings are the gate's output** (AC2). Line 133-136: `` `pyry` not found `` (the universal gate — fires first, so it is the ONLY reason that surfaces on the agent machine). Lines 141-151: the `claude`-not-on-PATH and "neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set" reasons (only reachable when `pyry` is present). The gate reuses these verbatim; it does not re-derive which prerequisite is missing.
- `playwright.real-claude.config.ts:12-21` — the config the gate reuses unchanged (`reporter: 'list'`, `testMatch: /real-.*\.spec\.ts$/`, `retries: 0`). The gate script adds a reporter via the CLI `--reporter` flag; **this file is not edited** (editing its `reporter` would change `e2e:real-claude` too, breaking AC6).
- `package.json:16-17` — the `e2e` / `e2e:real-claude` script pair; add `e2e:real:gate` beside them (AC1).
- `docs/knowledge/features/live-e2e-runbook.md:72-101` — § "Automated coverage is deferred"; where AC7's runbook note lands. Read it first — the note must position `e2e:real:gate` correctly relative to the existing `scripts/live-drive.mjs` interim gate (they are different layers — see § Runbook edit below).
- `docs/knowledge/codebase/420.md:22,28` — the load-time-proof lesson: `e2e/` sits outside both tsconfig `include`s, so `npm run typecheck` never sees a reporter type error. **Verification is running the gate**, not typechecking it (see § Testing strategy).

## Context

`npm run e2e:real-claude` exits **0 when every real-* spec skips**. The `daemon` fixture (`realDaemon.ts`) correctly `testInfo.skip`s when `pyry`/`claude`/a credential is missing, and the `list` reporter prints the skips — but the shell sees success. On the pipeline that green-on-all-skip is *load-bearing* (agents run the plain command as a smoke check: a clean skip proves the fixture graph resolved without needing the real stack — see `codebase/420.md`). The gap is that an **operator** on an under-provisioned machine gets the identical green exit, indistinguishable from a real live pass. A prose warning ("watch the UI, not the exit code") is not a gate; a deterministic exit code is.

This spec adds a **separate** operator entry point that runs the same specs against the same config and turns `executed == 0` into a hard non-zero exit. The plain `e2e:real-claude` command is untouched.

**Agent-developable.** The RED-before-GREEN proof — "on a machine with no prerequisites, exit non-zero" — reproduces on the agent's own machine (zero prereqs → all 8 specs skip → executed == 0 → gate must exit non-zero). The "behaves like today on a fully-provisioned machine" half is operator-only, like every real-* spec.

## Design

Two moving parts, no shared-config change:

1. **A custom Playwright reporter** — `e2e/reporters/zeroExecutedGate.ts` — that counts executed (non-skipped) tests, collects skip reasons, and overrides the run status to `failed` (via `onEnd`'s documented return-status API) **only** when the run passed AND executed == 0.
2. **A new npm script** — `e2e:real:gate` — that runs the exact same config as `e2e:real-claude` but adds the gate reporter through the CLI `--reporter` flag.

### Why the CLI `--reporter` flag (not a second config, not editing the config)

The CLI `--reporter` flag **overrides** the config's `reporter`. So:

- `e2e:real-claude` passes no `--reporter` → uses `playwright.real-claude.config.ts`'s `reporter: 'list'`, byte-for-byte unchanged (AC6). ✅
- `e2e:real:gate` passes `--reporter=list,./e2e/reporters/zeroExecutedGate.ts` → keeps the human `list` output AND runs the gate reporter, against **the same config file** (AC1: "same specs, same config"). ✅

This is strictly cleaner than a second config that spreads the first (no new config file to keep in sync) and correct where editing the shared config is wrong (that would leak the gate into the plain command).

### package.json (AC1)

Add one script beside the existing pair (`package.json:16-17`):

```
"e2e:real:gate": "npm run build && playwright test --config playwright.real-claude.config.ts --reporter=list,./e2e/reporters/zeroExecutedGate.ts"
```

Mirror `e2e:real-claude` exactly — same `npm run build &&` prefix, same `--config` — appending only the `--reporter` flag. (Note the `.` in `./e2e/reporters/...`: Playwright resolves a bare token like `list` as a builtin but a path-shaped token as a module.)

### The reporter contract — `e2e/reporters/zeroExecutedGate.ts`

A default-exported class implementing Playwright's `Reporter` interface. Import the types from `@playwright/test/reporter`:

```ts
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter'
export default class ZeroExecutedGate implements Reporter { /* ... */ }
```

State: a running `executed` count (number) and a `Set<string>` of skip descriptions (a Set dedupes — see below).

Two hooks, defined by contract (not pre-written):

- **`onTestEnd(test: TestCase, result: TestResult): void`** — if `result.status !== 'skipped'`, increment `executed`. Otherwise the test was skipped: collect its skip reason(s) by merging `result.annotations` and `test.annotations`, keeping entries where `type === 'skip'` and `description` is a non-empty string, and adding each `description` to the Set. Reading **both** annotation locations covers Playwright's split between runtime annotations (added by `testInfo.skip()` during fixture setup → surface on the result) and declared ones (on the test case); the developer confirms which carries the string empirically (§ Testing).
- **`onEnd(result: FullResult): { status: FullResult['status'] } | void`** — the gate. If `result.status === 'passed'` **and** `executed === 0`: write the collected skip reasons to `process.stderr` (one per line, prefixed so they stand out from the `list` output — e.g. `zero-executed gate: no real-* e2e ran — <reason>`), then `return { status: 'failed' }`. Otherwise return nothing.

**The `result.status === 'passed'` guard is the "never mask a real failure" invariant (AC4).** The reporter only *upgrades* a clean pass to a failure. It never touches `'failed'` / `'timedout'` / `'interrupted'` — a genuine Playwright failure or a load-time collection error already exits non-zero and flows through untouched. And a genuine live pass (`executed > 0`) is left as `'passed'` → exit 0 (AC3).

Why dedupe: on the agent machine all 8 specs share the `daemon` fixture and hit the same `pyry`-not-found skip first, so without dedup the gate would print the identical line 8×. With the Set it prints exactly the distinct reason(s) — one line on the agent machine, up to three on a partially-provisioned one.

**Exit-code override mechanism.** Returning `{ status: 'failed' }` from `onEnd` is Playwright's documented way for a reporter to override the run status and thus the process exit code. This is the primary and sufficient mechanism. If empirical verification (§ Testing) shows the process still exits 0 on this `@playwright/test@^1.61.1`, the deterministic fallback is to also set `process.exitCode = 1` inside an `onExit()` hook guarded by the same "gate tripped" flag — but do not add that hook speculatively; only if the run proves `onEnd` alone insufficient.

### Reporter file placement

`e2e/reporters/zeroExecutedGate.ts` (new directory `e2e/reporters/` — none exists yet). A `.ts` reporter referenced by path is loaded through Playwright's own TS loader, so `.ts` is correct and matches the e2e/ TypeScript convention. This is *not* a `scripts/*.mjs` standalone (those are spawned directly by Node); it is a Playwright plugin loaded in-process, so it gets typed `TestCase`/`TestResult` objects — no JSON-file/child-process plumbing.

## State + concurrency model

None. The reporter is a single-worker, single-process observer (`workers: 1`, `fullyParallel: false` in the config). `executed` and the skip-reason Set are plain instance fields mutated only from `onTestEnd`, read once in `onEnd`. No async, no store, no transport — this is test tooling entirely outside `src/`.

## Error handling

- **Real test failure / timeout / interruption** → `result.status !== 'passed'` → gate returns nothing → natural non-zero exit propagates (AC4).
- **Load-time / collection error** (e.g. a bad import in a spec) → Playwright reports errors and a non-passed status → same as above, gate is inert, non-zero exit propagates (AC4).
- **All skipped** → `result.status === 'passed'`, `executed === 0` → gate prints reasons, returns `{ status: 'failed' }` → exit 1 (AC2, AC5).
- **Genuine live pass** → `result.status === 'passed'`, `executed > 0` → gate returns nothing → exit 0 (AC3).
- **Skip reasons missing/empty** (defensive) — if the Set ends up empty despite executed == 0, still fail (exit non-zero) with a generic "zero tests executed; no skip reason captured" line so the gate never silently passes. The reasons *should* always be present (the fixture always skips with a description), so this is a floor, not the expected path.

## Runbook edit (AC7) — `docs/knowledge/features/live-e2e-runbook.md`

In § "Automated coverage is deferred" (lines 72-101), add a short note naming `npm run e2e:real:gate` as the **exit-code-safe form of the real-* harness**: it runs the same specs against `playwright.real-claude.config.ts` but exits **non-zero when zero tests executed**, so a machine missing a prerequisite fails loudly instead of masquerading as a green pass. This replaces the implicit "you must notice all-skip by hand" burden with a deterministic gate.

**Accuracy constraints — do not overclaim:**
- `e2e:real:gate` does **not** supersede `scripts/live-drive.mjs`. `live-drive.mjs` drives the *live production relay* round-trip; the real-* harness (both `e2e:real-claude` and the new gate) still dials a **local** fake relay (per the same section's existing text and `codebase/420.md`). Keep `live-drive.mjs` described as the interim live-relay pre-ship gate; add `e2e:real:gate` as the "don't let all-skip look green" guard on the local-relay real-stack harness.
- Do not delete or contradict the existing #449 note that `e2e:real-claude` is not yet a working live-green pre-ship gate. `e2e:real:gate` fixes the *silent-zero* hazard, not the #449 live reply-fan-out gap.

Keep the edit tight (a paragraph, plus the command). Do not restructure the section.

## Testing strategy

**No vitest unit test.** The reporter's behavior is not meaningfully unit-testable in isolation (it needs a real Playwright run to produce `TestResult` objects and to exercise the exit-code override), and `e2e/` is outside both tsconfig `include`s so `npm run typecheck` won't cover it (`codebase/420.md`). Verification is running the gate — which the agent CAN do, because the agent machine reproduces the all-skip case exactly. This IS the RED-before-GREEN liveness proof the ticket calls for (AC5), not a substitute for one.

Developer verification checklist (all runnable on the agent's own prereq-less machine):

1. **RED / liveness proof (AC5, AC2):** `npm run e2e:real:gate` → all 8 real-* specs skip → command exits **non-zero** (`echo $?` ≠ 0), and stderr names the missing prerequisite (the `` `pyry` not found `` reason from `realDaemon.ts:135`). Confirm the reason string appears exactly once (dedup working), not 8×.
2. **Plain command unchanged (AC6):** `npm run e2e:real-claude` → still exits **0** on all-skip (`echo $?` == 0), same `list` output as before. This is the pipeline-safety guarantee — it must stay green.
3. **Annotation source confirmed:** while running step 1, verify the skip strings actually arrive via `result.annotations` and/or `test.annotations` (add a temporary `console.error` if needed, then remove). If the description lands on only one of the two, the merged read still captures it — but confirm the real strings, not empty descriptions, reach stderr.
4. **Real-failure passthrough (AC4) — spot-check, optional:** the `result.status === 'passed'` guard makes masking structurally impossible, but a quick sanity check (e.g. temporarily make one spec `throw` at collection, confirm the gate stays inert and the run still exits non-zero, then revert) validates the guard. Not required for merge if the guard reasoning is clear.

The AC3 case (genuine live pass → exit 0) is operator-only (needs the real stack) — same as every real-* spec's green path. Note it as operator-verified-later in the PR; it is not agent-reproducible.

## Open questions

- **Annotation field carrying the skip description** — `result.annotations` vs `test.annotations` on `@playwright/test@1.61`. Resolved by merging both and verifying empirically (§ Testing step 3). No hardcoding of which one; read both.
- **`onEnd` return-status sufficiency** — confirmed as the documented mechanism; the `onExit` + `process.exitCode` fallback is gated on empirical failure only (§ reporter contract). Do not add it pre-emptively.

## Scope guard

Production `.ts`/`.tsx` files created or modified by this spec: **1** (`e2e/reporters/zeroExecutedGate.ts`). `package.json` (JSON) and the runbook (`.md`) are not production source. Well under the 5-file / 600-LOC / 5-exported-type red lines; zero consumer call sites (Playwright loads the reporter by path — nothing imports it). No split.
