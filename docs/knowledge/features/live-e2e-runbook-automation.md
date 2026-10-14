# Live e2e runbook — automation and operator gates

Part of the [live runbook](live-e2e-runbook.md). This page covers dispatcher configuration,
failure routing and the distinction between local real-daemon coverage and production-relay
checks. Codex prerequisites, the Luna invocation and
[current gate state](live-e2e-runbook.md#current-real-claude-gate-state) stay in the parent.

## Dispatcher gate configuration

**Since 2026-09-02 the dispatcher runs the real-claude tier itself on this fork.** Before that date a `needs-real-claude` ticket parked in Inbox and waited for an operator to run the suite by hand. Parking and running are two separate dispatcher steps, and the running half is opt-in per fork through one setting in `pyrycode-desktop-agents/.env` — untracked, so no PR here can change it:

```
PYRY_REAL_CLAUDE_GATE_CMD="npm install --no-audit --no-fund >&2 && npm run build >&2 && npx playwright test --config playwright.real-claude.config.ts --reporter=json"
PYRY_REAL_CLAUDE_GATE_FORMAT=playwright-json
PYRY_REAL_CLAUDE_GATE_TIMEOUT_MS=1800000
PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED=27
```

Why each line is what it is:

- **Install and build chatter goes to stderr on purpose.** The gate reads stdout and expects Playwright's JSON report alone. Its parser skips to the first `{`, but npm output ahead of the report can still defeat it, so the chatter is routed away rather than tolerated.
- **The gate needs the per-test JSON reporter, not `e2e:real:gate`.** The repo's own gate script prints a human list. The dispatcher counts tests that ran a body, and it cannot count what it cannot read.
- **The floor must match the runnable test count on the branch.** A lower floor can hide a missing-prerequisite skip. The latest report declares 28 tests, with 27 runnable when Codex is provisioned after the known system-prompt exclusion; only 26 executed with Luna skipped. The example above reflects the intended 27. Updating this document does not change the fork's external configuration or prove its current floor. Require the named Luna pass as well as counts; see [current gate state](live-e2e-runbook.md#current-real-claude-gate-state).
- **The recorded gate used a lower floor.** The [2026-10-11 gate comment](https://github.com/pyrycode/pyrycode-desktop/issues/1809#issuecomment-6109424773) records a floor of 10 and advancement with `needs-real-claude` removed after 26 executed, 26 passed, 0 failed and 2 skipped. The named Luna scenario was skipped for an unset `PYRY_CODEX_CAPTURE_HOME`, so that advancement did not satisfy its live acceptance. The operator/dispatcher owns provisioning, external configuration and restoration of the live requirement; changing this example cannot perform those actions.
- **The floor is one-sided.** It answers "did enough tests run", never "did the right ones run". The 66-executed run in [earlier gate evidence](live-e2e-runbook-history.md#earlier-recorded-runs) cleared a floor of 10 with room to spare while running 56 fake-tier specs under the real-daemon config. A count above the floor is not evidence that the intended tier ran.

## Failure routing and setup

**This fork cannot tell an inherited failure from a new one.** On a red run the gate is meant to re-run just the failing tests against the base commit, so a failure that already exists on `main` parks for the operator instead of being blamed on the branch. That comparison never runs here: the dispatcher's filter builder rejects any test name outside a conservative character set, and every Playwright name carries spaces and a `›` separator, so the filter is always refused ([agent-dispatcher#38](https://github.com/pyrycode/agent-dispatcher/issues/38)). While any spec in the tier is red, **every** gated ticket that reaches the gate is failed and sent back for rework for a fault it did not cause, and each one needs a hand correction. That is what happened to [#928](https://github.com/pyrycode/pyrycode-desktop/issues/928) on the first live run, for the pre-existing red later filed as [#941](https://github.com/pyrycode/pyrycode-desktop/issues/941).

**Three setup requirements nothing validates at configuration time:**

- The repo needs an `error:real-claude-gate` label; the gate's park path applies it. This repo did not have one until 2026-09-02.
- The credential must reach the command. Without it the suite exits 0 with everything skipped, and the floor is what turns that into a park rather than a pass.
- The daemon the gate spawns comes from `PYRY_BIN` or `PATH`, so a stale `~/.local/bin/pyry` fails or skips any spec that needs a newer wire feature. Rebuild and reinstall it before restarting the dispatcher with the gate on, since the dispatcher reads its environment at startup. Since [#933](https://github.com/pyrycode/pyrycode-desktop/issues/933) a spec can declare the daemon capabilities it needs, and the fixture skips it with a reason naming the missing string when the daemon does not advertise them — see [real-claude-liveness-e2e.md](real-claude-liveness-e2e.md). The skip still counts against the floor, so a stale daemon parks the ticket rather than passing it.

**What a verdict means.** A pass moves the ticket to In Documentation and strips `needs-real-claude`. A genuine failure sends it back with the rework label and keeps `needs-real-claude`, so it must pass the gate again after the fix. Anything the gate cannot trust — an inherited failure, nothing executed, an unreadable report, a run the outer clock killed — parks the ticket in Inbox with `error:real-claude-gate`, which excludes it from re-selection until a person clears the label. That clearing step is deliberately human.

## Local real-daemon coverage

**The live-relay half stays manual, by design.**
 There is **no automated live-*relay* e2e**, by design — pairing against the actual
`pyrycode-relay.pyryco.de` relay needs operator credentials and network access the pipeline agents
do not have, so that half stays manual, never under CI (consistent with the Phase-1/Phase-2 split
and the mobile precedent). The current coverage is the automated fake-transport
[e2e harness](e2e-harness.md) ([#40](https://github.com/pyrycode/pyrycode-desktop/issues/40)) **plus**
the per-slice unit suites (#52/#53/#55/#62/#65/#66/#68/#69), which already prove pair/connect/send/
stream against fakes, **plus** this runbook as the live-stack operator confirmation.

[#252](../codebase/252.md)'s [real-claude liveness e2e](real-claude-liveness-e2e.md) was built to automate
the other half this runbook used to be the *only* check for: whether a real `pyry` daemon running real
claude actually replies (as opposed to a fake daemon that always answers). It still dials a **local**
fake relay, not the live one, so it does not verify the live-relay allowlist/network path — this
runbook remains the only check for that.

The harness spec **SKIPs cleanly in the pipeline** (the `testIgnore` gate in `playwright.config.ts` — it
never runs, and is never seeded green, under the agent's `npm run e2e`). For the current pass/fail result
of a real operator run, see [current gate state](live-e2e-runbook.md#current-real-claude-gate-state).

## Operator real-daemon command

**`npm run e2e:real:gate` is the exit-code-safe form of this `real-*` harness**
([#479](https://github.com/pyrycode/pyrycode-desktop/issues/479)). It runs the same specs against the same
`playwright.real-claude.config.ts` as `e2e:real-claude`, adding only an exit-code enforcement layer: when
every spec skips for a missing prerequisite (`pyry` / `claude` / a credential) the run "passes" with **zero
tests executed**, and the gate turns that silent-nothing-ran into a **non-zero exit** that names the missing
prerequisite (surfaced verbatim from the fixture's own skip reason). Prefer it over the raw `e2e:real-claude`
for operator use — the plain command exits **0** on all-skip and so cannot tell an under-provisioned machine
apart from a genuine live pass (that green-on-all-skip stays load-bearing on the pipeline, which is why the
plain command is left untouched). The gate closes only the *silent-zero* hazard: it still dials a **local**
fake relay, so it does **not** supersede `scripts/live-drive.mjs` below.

## Production-relay pre-ship command

**`scripts/live-drive.mjs` is the live-RELAY pre-ship gate** (built app → *production* relay → live Mac
daemon → vault workdir) — the path `e2e:real-claude` never exercises, since that harness dials a *local*
fake relay. `npm run build && node scripts/live-drive.mjs .` pairs a throwaway device, creates a
conversation through the UI, sends a message, waits for the real claude reply to stream in, then revokes
the pairing (first green 2026-07-15, ~4s round-trip). It prints progress lines only — never the pairing
payload or token. It is complementary to `e2e:real-claude`, not a stand-in — run it before a ship to
cover the live-relay path the harness cannot.

**It is now safe to chain** (`npm run build && node scripts/live-drive.mjs .` actually stops on RED):
as of [#480](https://github.com/pyrycode/pyrycode-desktop/issues/480), the script exits **non-zero** on
RED/timeout, on any thrown step (pairing, connect, create-conversation, send), and on the two pre-launch
early exits — only GREEN (a real reply streamed) exits 0. The exit code is deferred via `process.exitCode`
rather than `process.exit`, so the `finally` cleanup (close the app, remove the temp user-data dir, and
`pyry pair revoke` the throwaway device) always runs to completion first — a skipped revoke would leak a
**live** credential, since the device was paired with `--allow-remote-permissions` against the real daemon.

