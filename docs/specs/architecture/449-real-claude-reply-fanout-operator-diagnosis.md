# #449 — real-claude isolated-HOME reply-fan-out: operator live-stack diagnosis

> **This is an operator live-stack diagnosis, not standard agent-developable work.**
> `e2e/real-claude.spec.ts` is gated OUT of the agent pipeline (`testIgnore` in
> `playwright.config.ts:14`; no daemon / no claude / no creds → clean SKIP). A developer
> agent physically cannot observe the reply-fan-out path — the two falsifiers below run
> **only** on the operator's live Mac stack via `npm run e2e:real-claude`. The pipeline-safe
> deliverable is the doc reconciliation in § Developer-phase scope; everything else is the
> operator checklist in § Operator diagnosis.

## Files to read first

- `e2e/fixtures/realDaemon.ts:193-227` — the isolated-HOME seed block: `.claude.json` trust
  seed (`hasTrustDialogAccepted`) + `.claude/settings.json` (`skipDangerousModePermissionPrompt`).
  **The suspect-1 fixture seed lands here**, alongside these two, inside the `claudeJsonBytes !== null`
  branch (so the claude-less specs #439–#443 with `spawnClaude:false` are untouched — their
  `claudeJsonBytes` stays `null`).
- `e2e/fixtures/realDaemon.ts:138-142` + `:258-267` — where `claudeBin` is resolved
  (`resolveOnPath('claude')`, type `string | null`) and the existing `if (claudeBin === null) throw`
  unreachable-narrowing pattern to mirror for the seed.
- `e2e/fixtures/realDaemon.ts:9` — the `node:fs/promises` import (`mkdir`, `writeFile`, …);
  the seed adds `symlink` here.
- `e2e/fixtures/realDaemon.ts:294-301` — the `PYRY_E2E_DAEMON_LOG` stderr tee (the diagnosis
  instrument, content-free by construction, #62). **The content-blindness invariant (AC5) is
  anchored here** — any new diagnostic must not serialise token / keys / transcript text.
- `e2e/real-claude.spec.ts:1-33` — the spec header (add the honest-red `// TODO` pointer);
  `:107-147` — the UI-create + turn-1/turn-2 non-empty-assistant-reply assertions (the reply
  path under diagnosis; **no assertion changes** in this ticket).
- `playwright.config.ts:10-14` — `testIgnore: /real-.*\.spec\.ts$/`: why the pipeline SKIPs;
  this gate stays (never force the spec green in-pipeline).
- `docs/knowledge/features/live-e2e-runbook.md:82-88` — currently presents `e2e:real-claude`
  as a working pre-ship gate; **this overclaims** (the spec is red for #449). AC6 reconciles it.
- `scripts/live-drive.mjs:1-10` — the standalone live-drive harness (built app → prod relay →
  live Mac daemon → vault workdir) that is the **current interim operator pre-ship gate**; the
  runbook does not yet reference it (the gap AC6 closes).
- `docs/knowledge/features/real-claude-liveness-e2e.md` — the #252 feature doc (context only;
  it may also overclaim, but it is owned by the documentation phase — out of scope here, see
  § Open questions).
- The issue body's evidence chain + two suspects — the authoritative diagnosis input.

## Context

`e2e/real-claude.spec.ts` drives the real stack the operator ships: a freshly-paired real `pyry`
daemon running real claude on `--model haiku`, bridged to the built Electron window through #251's
content-blind routing relay. It is the thin client-layer net over the daemon-side liveness test.

**#449 ≠ #448.** #448 (PR#450, merged 2026-07-15) fixed the *client-side* root cause — the thread
screen hardcoded `conversation_id: 'default'`, which the real daemon rejected. After that fix the
harness is STILL red for a **separate, environment-specific reason** (PR#450's "Known remaining"):
in the isolated-HOME daemon the turn is *delivered* (`PYRY_E2E_DAEMON_LOG` shows `send_message
enqueued`, **no** `msgqueue: delivery failed`; claude completes the identical turn in ~1s under a
manual PTY probe) but **no reply event ever fans back to the app** — silence to the 120s spec timeout.

So: the turn is written, claude is capable of completing it, and no reply reaches the window. Three
2026-07-15 data points bracket the failure — live stack GREEN (`scripts/live-drive.mjs`, ~4s),
manual PTY probe in the harness's exact isolated conditions GREEN (~1s), harness RED silently.

**Why now:** the operator's real-stack pre-ship gate must be trustworthy — either reliably green,
or honestly red with a pinned root cause. It is currently silently broken. **Update since filing:**
the daemon-side startup-dialog family (pyrycode#988) is now CLOSED/fixed, so step zero (re-test
against a `pyry` built from current pyrycode `main`) is cheap — the symptom may already be gone.

## Design — the deliverable shape

This ticket has three layers. Only the first is pipeline-runnable; the other two are the operator
gate, specified here as precise contingent contracts so applying them is mechanical once the live
result is known.

1. **Developer-phase (pipeline-safe, no live stack):** reconcile the runbook + spec header to the
   current honest red state. See § Developer-phase scope.
2. **Operator step zero + suspect 1 falsifier:** a bounded live-stack diagnosis; if suspect 1 holds,
   the fixture seed below is the fix, verified by an actual live pass. See § Operator diagnosis.
3. **Operator suspect 2 (daemon-side):** if the residual survives suspect 1, pin the env assumption,
   file a `pyrycode/pyrycode` issue, keep the desktop spec honestly red with a `// TODO` pointer.

### Suspect-1 fixture-seed contract (contingent — applied only on a live-verified pass)

**Symptom it targets:** claude in the isolated HOME renders a persistent
`⚠ claude command at <home>/.local/bin/claude missing or broken … run claude install to repair`
banner (the temp HOME has no `~/.local/bin`). The live daemon's claude has none. Hypothesis: tui-driver's
turn/idle detection or the structured-turn producer's screen coupling chokes on the banner, so the
reply runs but never fans.

**Contract:** inside the `claudeJsonBytes !== null` block (`realDaemon.ts:193-227`), after the
`.claude/settings.json` seed and before the block closes, seed a valid `<daemonHome>/.local/bin/claude`
that resolves to a working claude, so claude's isolated-HOME install-check finds a real
`~/.local/bin/claude` and suppresses the banner. Contract sketch (developer/operator writes it in the
fixture idiom, mirroring the two sibling seeds directly above):

```ts
// claudeBin was skip-gated non-null in this branch — narrow with the same unreachable-throw
// guard used for the spawn-args at ~L260, then symlink the real claude into the isolated HOME.
if (claudeBin === null) throw new Error('real-daemon: unreachable — claude skip-gated above')
const localBin = join(daemonHome, '.local', 'bin')
await mkdir(localBin, { recursive: true, mode: 0o700 })
await symlink(claudeBin, join(localBin, 'claude')) // add `symlink` to the node:fs/promises import (L9)
```

**Rationale for the placement:** operator-state fidelity, same class as the two seeds above it — the
operator's real HOME has claude installed at `~/.local/bin/claude`; the isolated HOME does not, and
that divergence produces a real banner. Co-locating inside `claudeJsonBytes !== null` reaches the
operator's actual path (Max-only Mac → OAuth token, so `claudeJsonBytes` is non-null; see the skip
message at `:146-151`) and structurally excludes the claude-less specs.

**Symlink, not a stub:** a symlink to the resolved real `claudeBin` satisfies both an exec/version
probe and a stat check; a `#!/bin/sh exit 0` stub would read as "broken." If (unexpectedly) claude
rejects a symlinked install or a resolve-loop appears, fall back to a copied binary — but symlink first.

### Developer-phase scope (pipeline-safe — the only work a dispatched developer agent can verify)

The developer/documentation phase can land the doc reconciliation now; it is true regardless of the
diagnosis outcome and satisfies the in-pipeline half of AC5/AC6. It must **not** apply the fixture
seed (that requires a live pass to verify — a fixture change that flips no observable is exactly the
seeded-green move #448's rule forbids).

- **`docs/knowledge/features/live-e2e-runbook.md`** — reconcile `:82-88` to the honest state:
  record that `scripts/live-drive.mjs` (built app → prod relay → live daemon) is the **current
  interim operator pre-ship gate**, and that `e2e:real-claude` (the #252 real-claude spec) is
  presently **red for #449** (isolated-HOME reply-fan-out) and SKIPs cleanly in the pipeline. Point
  at #449 for the live diagnosis. The final green / red-pending-daemon flip is the operator's closing
  edit (see the two forks below).
- **`e2e/real-claude.spec.ts`** — add a one-line honest-red note to the header comment
  (`// TODO(#449): isolated-HOME daemon delivers the turn but no reply fans back — red on the live
  stack pending the #449 diagnosis`). A comment only; it does not touch the `testIgnore` gate or any
  assertion, so the pipeline SKIP is unchanged.

## Operator diagnosis (live Mac stack — not agent-runnable)

Run in order. Record each outcome as a comment on #449 with the `PYRY_E2E_DAEMON_LOG` excerpt
(content-free by construction — see the invariant in § Error handling).

1. **Step zero (free, no code change) — AC1.** Rebuild `pyry` from current pyrycode `main` (now
   includes the closed pyrycode#988 fix). Run:
   `PYRY_E2E_DAEMON_LOG=/tmp/pyry-449.log PYRY_BIN=<new pyry> npm run e2e:real-claude`.
   Record: green, or still-red with the log. **If green → skip to the green fork.**
2. **Suspect 1 falsifier — AC2.** Apply the § Suspect-1 fixture-seed contract, re-run live.
   - **Green (AC3):** the seed is the fix. Keep it (it is both operator-state fidelity and the
     observed cause). This is a real live pass — never seeded-green. → green fork.
   - **Still red:** suspect 1 is falsified — the banner was a real-but-non-causal divergence.
     **Revert the seed** (keeping unobserved fixture state violates evidence-based fix selection).
     → suspect 2.
3. **Suspect 2 (daemon-side) — AC4.** The residual is the daemon's transcript fan-out under the
   `HOME` override: the producer tails `<HOME>/.claude/projects/<encoded-cwd>/<session-id>.jsonl`;
   some path/env assumption does not survive the override even though daemon and child share the env.
   Pin the specific broken assumption, file a `pyrycode/pyrycode` issue, and:
   - Update the `e2e/real-claude.spec.ts` header TODO from `#449` to `// TODO(pyrycode#<N>)`.
   - Keep the spec honestly red/skipped — **do not** force it green.
   - → red-pending-daemon fork.

### Fork outcomes (AC6 — runbook final state)

- **Green fork:** `e2e:real-claude` is restored as a pre-ship gate alongside `scripts/live-drive.mjs`
  in the runbook; remove the `// TODO(#449)` header note from the spec.
- **Red-pending-daemon fork:** the runbook records `e2e:real-claude` is currently red/SKIP pending
  `pyrycode#<N>`, with `scripts/live-drive.mjs` as the interim gate; the spec header carries the
  `// TODO(pyrycode#<N>)` pointer.

## State + concurrency model

Not applicable — zero renderer / store / async-stream surface. The suspect-1 seed is synchronous
setup inside the daemon fixture's `try` block; it is reaped automatically with `daemonHome` by the
existing `cleanup()` (`realDaemon.ts:181-185`, `rm(daemonHome, { recursive: true, force: true })`).
No new teardown, no new fixture, no new lifecycle.

## Error handling

- **The falsifier decision tree is the error handling** — each live step has an explicit
  green / still-red branch (§ Operator diagnosis). There is no in-code error path to add.
- **Content-blind-diagnostics invariant (AC5).** `PYRY_E2E_DAEMON_LOG` tees only the daemon's
  content-free stderr (#62); the spec asserts DOM text / visibility / counts only. Any new diagnostic
  added during the hunt must preserve this: **never serialise the pairing token, keys, or transcript
  text.** Note especially the suspect-2 path — the transcript *path*
  (`.claude/projects/…/<session-id>.jsonl`) is safe to print, but the file *contents* are transcript
  plaintext and must never reach a log, an error message, or a #449 comment.

## Testing strategy

- **The live pass IS the test.** There is no pipeline test to add — the spec already asserts the
  reply fan-out (`nonEmptyAssistantCount ≥ 1` on turn 1, strictly increasing on turn 2). The gate is
  whether `npm run e2e:real-claude` runs green on the operator's live stack, verified by an actual run.
- **Never seeded-green (#448's fixture rule).** A red spec must SKIP cleanly in the pipeline (the
  `testIgnore` gate) and FAIL honestly on the live stack — it must never be forced green by a fixture
  that fits a symptom without a verified live pass.
- **Pipeline gates unaffected.** If the suspect-1 seed lands, `npm run build` (typecheck) must stay
  clean — the `symlink` import and the `claudeBin` narrowing typecheck under the existing config.
  The doc reconciliation touches only `.md` + one comment; `npm test` / `npm run e2e` are untouched
  (the real-claude spec stays `testIgnore`d).

## Open questions

- **Does step zero already resolve it?** pyrycode#988 closed since filing; the symptom may be gone
  against a current-`main` daemon, making suspects 1 and 2 moot. Step zero settles this first.
- **Placement generality of the suspect-1 seed.** The banner is a claude-spawning concern independent
  of OAuth-vs-API-key, but the seed is placed inside `claudeJsonBytes !== null` per the issue and
  because that is the operator's actual path. If a future API-key operator run needs it, hoist the
  guard to the true claude-spawning gate (`claudeBin !== null`, i.e. inside `if (spawnClaude)`);
  keeping it in the OAuth block until then avoids touching the untested API-key path.
- **`real-claude-liveness-e2e.md` may also overclaim.** The #252 feature doc likely still presents
  the gate as working. It is owned by the documentation phase and AC6 names only the runbook, so it
  is out of scope here — flag it for documentation to reconcile when this ticket resolves.
