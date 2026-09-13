# 1413 — Mint the real-daemon fixture's device credential from the running daemon

## Files read

- `e2e/fixtures/realDaemon.ts` → the `daemon` fixture closure, `runPyryPair`, `seedRegistry`,
  `waitForDaemonReady`, `reapDaemon`, `decodePairFields` — the whole surface this ticket changes.
- `e2e/real-daemon-rename.spec.ts` → the `spawnClaude:false` consumer AC2 names as the fails-on-`main` /
  passes-on-branch proof; read to confirm it touches no fixture internal beyond `daemon.pairFields`.
- `e2e/fixture-teardown-leak.spec.ts` → imports **only** `withIsolatedElectronApp` from this fixture, and
  runs in the *default* tier; it is the one non-`real-*` consumer, so the export surface must not move.
- `e2e/fixtures/daemonCapabilityGate.ts` → `readDaemonCapabilities` consumes `pairFields`, which fixes the
  probe's position after the mint.
- `docs/knowledge/features/real-claude-liveness-e2e.md` § "Daemon spawn — the load-bearing flags" → records
  `pyrycode#860`: `os.tmpdir()` on macOS overflows the 104-byte `sun_path` limit, which is why the socket
  has lived under a short `/tmp` base. That lesson is what decides where `daemonHome` itself now lives.
- `docs/knowledge/features/real-daemon-credential-light-e2e.md` → the tier AC2's proof spec belongs to; read
  to confirm the change is fixture-only and costs the tier no coverage.

## Design source

N/A — this is an e2e fixture repair with no rendered surface.

## Context

Upstream pyrycode#2393 (daemon `8a850505`) turned bare `pyry pair` into a **running-service** operation: it
resolves the service named by `-pyry-name`, dials that service's control socket, and the live daemon mints
the device. The fixture still calls `runPyryPair` *before* `spawn`, so every spec in the real tier aborts in
setup. Reproduced on this branch at `af17b54` (= `origin/main`) before any edit, with `PYRY_BIN` on the
dedicated test daemon:

```
Error: pyry pair exited with code 1; stderr:
pyry: pair: service "test" at /var/folders/…/T/pyry-daemon-12Yz0d/.pyry/test.sock: dial …: connect: no such file or directory
```

Two defects, not one. **Ordering** is the first. **Socket addressing** is the second: bare issuance takes a
service *name*, never a path, and `-pyry-name=test` resolves `$HOME/.pyry/test.sock` — the very path the
error above names — while the fixture spawns the daemon with an explicit `-pyry-socket` under a *separate*
short `/tmp` directory. Reordering alone would still dial a path nothing listens on.

Probed by hand on this MacBook, 2026-09-13, against `pyry dev-8a850505` under an isolated short `/tmp` HOME
(no operator daemon touched, no real device minted):

- A daemon given `-pyry-name=test` and **no** `-pyry-socket` binds `$HOME/.pyry/test.sock` (`srw-------`).
- `pyry pair -pyry-name=test --name=<label>` against it exits 0, writes `devices.json` into the instance
  registry, and prints a base64url payload line that `decodePairFields` decodes to exactly
  `{relay, server, server_static_pubkey, token}` — the trailing `Static-key fp:` and prose lines are not
  decodable and its scanner already skips them.
- **The mint does not need the relay leg up.** The probe's daemon was still failing to dial its (deliberately
  dead) relay URL while the mint succeeded.
- **New precondition, found by the probe failing first:** the daemon refuses to start when
  `$HOME/.pyry/<name>` is mode `0755` — `keys: … insecure key directory mode`, raised at relay start, before
  it ever binds. `seedRegistry` already creates that directory `0o700`, but that was incidental while
  `pyry pair` created it first; under the new order it is load-bearing.

This design deserves no ADR — it restores a fixture to a changed upstream CLI contract; the documentation
handoff below carries the record.

## Design

One file, `e2e/fixtures/realDaemon.ts`. No exported surface moves: `test`, `expect`,
`withIsolatedElectronApp`, `encodePairingPayload`, `SpawnedDaemon`, `RealDaemonOptions`,
`RealDaemonFixtures` all keep their shapes, so no spec body changes.

### The new setup order

Inside the `daemon` fixture's tracked `try`, the sequence becomes:

1. `daemonHome` + `workdir` + `seedCwd` (unchanged)
2. `.claude.json` / `.claude/settings.json` / `.pyry/config.json` (unchanged)
3. `daemonEnv` (unchanged)
4. **`seedRegistry`** — still before `spawn`, because the registry loads once at daemon startup with no
   reload. It now additionally guarantees `$HOME/.pyry/test` exists at `0o700` before the daemon looks at it.
5. `claudeArg` (unchanged)
6. **`spawn`**, with `-pyry-socket` removed
7. stderr tee (unchanged)
8. **`waitForDaemonReady`** — dials the derived socket path
9. **`runPyryPair` → `decodePairFields`** — the move; the daemon is live and dialable by now
10. capability gate (unchanged; it consumes `pairFields`, so it necessarily stays last)
11. `use({ pairFields, workdir })`

The "seed before spawn" and "mint after spawn" halves now hold for *different* reasons, and the code says so:
the registry is read once at startup, whereas the device mint lands in the running daemon's own state.

### The socket contract — derive, don't assert

`-pyry-socket` is **dropped**. The daemon derives its listen path from `-pyry-name`, and `pyry pair` derives
its dial path from the same flag in the same binary, so the two agree structurally rather than by an equality
the fixture asserts between its own `join` and the daemon's resolver. The fixture computes
`join(daemonHome, '.pyry', '<name>.sock')` for one purpose only — its readiness dial — so a future change to
the daemon's naming convention reddens as a loud `waitForDaemonReady` timeout rather than as a silent
mint against a socket nothing listens on.

A single module constant `DAEMON_INSTANCE_NAME = 'test'` replaces the four independent `'test'` literals
(spawn flag, pair flag, `seedRegistry`'s registry dir, and now the socket path). Drift between those literals
is exactly the defect class this ticket is repairing, so the coupling is made structural rather than left to
four strings that happen to match.

### Where the socket lives — `daemonHome` moves to a short base

`daemonHome` moves from `mkdtemp(join(tmpdir(), 'pyry-daemon-'))` to `mkdtemp('/tmp/pyry-daemon-')`. The
socket now lives under the daemon HOME, so the `pyrycode#860` short-base lesson transfers from the old
socket directory to the HOME itself. Measured on this machine: the old base yields an 83-byte `sun_path`
against the 104-byte macOS limit (a 21-byte margin that depends on the machine's `TMPDIR`); the new base
yields 39. Nothing else about `daemonHome` is path-sensitive — the one consumer that cares about its real
location, the `.claude.json` trust seed, already keys on `realpathSync(workdir)` and so already handles
`/tmp` → `/private/tmp` exactly as it handled `/var/folders` → `/private/var/folders`.

The separate `socketDir` `mkdtemp` becomes redundant and is **removed together with its `cleanup` line and
its tracking variable**, rather than left as a tracked resource nothing creates.

## State + concurrency model

No new async work and no new long-lived task. The one ordering consequence: `runPyryPair` now runs while the
daemon process is alive, so a pair failure must still reap it. It does — `child` is assigned before the
readiness wait, `cleanup()` is registered before the `try`, and the `finally` runs `reapDaemon` on the process
group followed by the `rm` of `daemonHome` on every exit path (setup failure, test failure, success, and the
capability skip). Dropping `socketDir` removes one `rm` from that path and leaks nothing, because the socket
now lives inside `daemonHome`, which is already reaped recursively.

`waitForDaemonReady` keeps its stderr-capture-until-ready discipline unchanged, so no post-handshake tee is
introduced by the mint moving after it.

## Error handling

- **Mint failure** stays a rejected promise from `runPyryPair`, surfaced with the exit code and its
  **stderr only**. `pyry pair` **stdout is never echoed** — it carries the token — and that rule is unchanged
  in both wording and code.
- **A daemon that never binds** now fails at `waitForDaemonReady` (with the existing startup-only stderr
  diagnostic) *before* the mint is attempted, instead of surfacing as a confusing pair dial error. That is a
  strictly better first failure for the same root cause.
- **Skip-gating is untouched.** Every `testInfo.skip` keeps its position; the capability gate remains the one
  documented exception that lands after resource creation.

## Testing strategy

Nothing in this change is unit-testable without inventing a seam: it is an ordering and a spawn-argv contract
inside a Playwright fixture closure, and this repo's renderer/unit tier cannot drive a daemon. The proof AC2
names is the real one, and it is the RED→GREEN:

- **RED, on `main`:** `real-daemon-rename.spec.ts` (a `spawnClaude:false` consumer needing `pyry` alone) run
  under `playwright.real-claude.config.ts` with `PYRY_BIN` on the dedicated test daemon — recorded above,
  reproduced before any edit.
- **GREEN, on the branch:** the same command passes.
- **No lost coverage:** `--list` under `playwright.real-claude.config.ts` still collects all 19
  `real-*.spec.ts` files, and no spec body is touched.
- **Existing unit tier + build:** `npm test -- e2e/fixtures` and `npm run build`.

Both runs use the fixture's own isolated `HOME` (`daemonEnv` overrides it for the spawn *and* the pair), so
the proof can never reach the operator's live daemon or mint a real device.

## Documentation handoff

Pending — owned by the documentation stage, not this PR.

- `docs/knowledge/features/real-claude-liveness-e2e.md` § "Fixture chain and teardown" and § "Daemon spawn —
  the load-bearing flags": record the new order (seed → spawn → readiness → mint), the socket contract
  (no `-pyry-socket`; the daemon derives the path from `-pyry-name`, the fixture derives the same path only
  to dial readiness; the short base moved from the socket dir to `daemonHome`), and that the tier now
  requires a daemon carrying pyrycode#2393. § "The binding problem: seeding `'default'` before spawn" stays
  true and should say **why** it still holds: the registry loads once at startup, while the device mint now
  lands in the running daemon's own state.
- `docs/knowledge/features/real-daemon-credential-light-e2e.md`: its one-line description of the tier's
  pairing must stay consistent with the above.
- `docs/knowledge/features/live-e2e-runbook.md` § "Current real-claude gate state": record the gate outcome
  once it runs, with the daemon source revision (`pyry dev-8a850505`).

## Open questions

1. *Explicit `-pyry-socket` at the derived path, or no flag at all?* **Resolved in this plan**: no flag —
   see § The socket contract. Both paths bind, but only the flagless form makes listen and dial come from one
   resolver.
2. *Does the `0o700` requirement on `$HOME/.pyry/<name>` need an explicit `chmod` in the fixture?*
   **Resolved**: no. `seedRegistry`'s `mkdir(..., { recursive: true, mode: 0o700 })` already creates both
   `.pyry` and `.pyry/<name>` at that mode and now runs before the daemon starts. The requirement is recorded
   as a comment at that `mkdir` so a future edit cannot relax it unknowingly.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The one untrusted-to-trusted crossing is unchanged in both position and
  shape: `pyry pair` stdout → `decodePairFields`, which stays the single explicit parse (a scanner that
  tolerates non-payload lines and validates all three fields as strings before returning). The mint moving
  after `spawn` does not widen what crosses: the payload's bytes, producer and validator are identical. The
  daemon's stderr is the other inbound text, and it is still only read on a **startup** failure path.
- **[Tokens, secrets, credentials]** No findings, with one deliberate re-verification. The token is now minted
  by a *running* daemon rather than an offline command, so the review question is whether it can reach a new
  sink. It cannot: `runPyryPair` still resolves stdout to the caller and its rejection path still interpolates
  **stderr only** — the no-echo rule is unchanged in code, not merely in prose. Probed directly: a successful
  mint writes the payload to stdout and leaves stderr empty, and the failing mint's stderr carries only the
  service name and socket path. The credential is per-run, lives in a `0o700` temp HOME that `cleanup`
  removes on every exit path, and is never persisted outside it. Entropy and lifecycle are the daemon's, not
  this fixture's.
- **[File / storage operations]** One finding, addressed in the design rather than deferred. Moving the socket
  under `daemonHome` transfers the `pyrycode#860` `sun_path` hazard from the old socket dir to the HOME, so
  `daemonHome` moves to a short `/tmp` base (83 → 39 bytes measured). No path here is built from untrusted
  input: `daemonHome` comes from `mkdtemp`, the instance name is a module constant, and `seedCwdSubdir` — the
  only spec-supplied path component — keeps its existing single-plain-segment guard, untouched. The `rm`
  targets stay values `mkdtemp` returned, so no arbitrary-recursive-delete primitive is created; removing
  `socketDir` strictly shrinks that set. `/tmp` is world-*writable*, but `mkdtemp` creates `0700` and the
  daemon additionally **refuses** to start on a key directory laxer than `0700` — a second, daemon-side
  enforcement of the same property.
- **[Inter-process / Electron attack surface]** No findings — out of this diff entirely. No `webPreferences`,
  no `contextBridge` surface, no `ipcMain` channel, no protocol handler is touched; `withIsolatedElectronApp`
  is unmodified and its one default-tier consumer (`fixture-teardown-leak.spec.ts`) keeps its import.
- **[Cryptographic primitives]** No findings. Nothing cryptographic is implemented, selected or configured
  here. The Noise static key is now generated by the daemon at startup instead of by the offline `pyry pair`
  — a relocation *within the daemon*, into a directory whose mode the daemon itself enforces. The client-side
  probe handshake in `readDaemonCapabilities` is untouched and still runs after the mint.
- **[Network & I/O]** No findings. No socket is opened by this change beyond the existing unix-domain
  readiness dial, which keeps its bounded `DAEMON_READY_TIMEOUT_MS` poll. The mint is a subprocess, still
  bounded by `PAIR_TIMEOUT_MS` with a `SIGKILL` on expiry. Worth stating because it is the reordering's real
  risk: the two timeouts are now **sequential** rather than overlapping, so worst-case setup grows by at most
  `DAEMON_READY_TIMEOUT_MS` (10 s) against the tier's 300 s spec budget and the proof spec's own 90 s — ample,
  and a hang is bounded by both, never unbounded.
- **[Error messages, logs, telemetry]** No findings, one property re-checked under the new order.
  `waitForDaemonReady`'s stderr capture still stops the instant readiness is reached, so the mint — the first
  thing that now runs *after* readiness — cannot tee anything into a diagnostic. `PYRY_E2E_DAEMON_LOG` is
  opt-in, off in every gate, and unchanged. The fixture emits no telemetry.
- **[Concurrency]** No findings. The reordering creates one genuinely new window — the daemon is alive while
  `runPyryPair` runs — and the existing structure already covers it: `cleanup` is registered before the
  `try`, `child` is assigned before the readiness wait, and the `finally` reaps the process **group** and
  removes `daemonHome` on setup failure, test failure, skip and success alike. There is no check-then-act on
  shared state and no new listener or timer whose handle is not already cleared.
- **[Threat model alignment]** No findings. The hostile-relay and hostile-daemon threats are unmoved: the
  relay leg is still the in-process fake, the daemon is still one this fixture spawned from an
  operator-supplied binary, and the probe confirmed the mint completes without the relay leg being up — so the
  relay gains no new influence over credential issuance. **Out of scope, named:** `scripts/live-drive.mjs`
  also shells out to `pyry pair` without `-pyry-name`, against the operator's *live* daemon; the ticket
  defers it explicitly and asks for a separate ticket if it reddens.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13
