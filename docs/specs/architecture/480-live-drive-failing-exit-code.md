# #480 — `live-drive.mjs` sets a failing exit code without skipping cleanup

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/480
**Size:** S · **Labels:** `bug`, `security-sensitive` · **Scope:** `scripts/live-drive.mjs` only (no transport / wire / renderer change)

## Design source

N/A — operator-only CLI script, not UI-visible. No Figma anchor required (per ticket body: scope is exit-code + cleanup-ordering behavior).

## Files to read first

- `scripts/live-drive.mjs:1-121` — **the entire file; it is short — read all of it.** Extract the four control-flow landmarks the fix moves:
  - `29-32` — pyry-pair-failure early exit (`process.exit(1)`). **At this point no device and no temp dir exist** — this is the one legitimate `process.exit`.
  - `49-52` — no-payload early exit (`process.exit(1)`). **`pyry pair` already ran → a device exists** → this exit currently skips the revoke → **leaks a live credential.** This is the security bug.
  - `55-64` — `mkdtempSync` (creates the temp user-data dir), `electron.launch`, `firstWindow`. **These sit OUTSIDE the `try/finally`** → a launch failure leaks the temp dir. The fix pulls them inside.
  - `66-121` — the `try { …UI flow… } finally { close · rm temp dir · revoke }`. The RED branch (`107-111`) and the finally cleanup trio (`113-120`) are the invariant to preserve.
- `docs/specs/architecture/479-e2e-real-gate-zero-executed.md` — the direct sibling (same bug class: an operator gate that exits 0 when it should fail). Extract two things: (a) the `PYRY_BIN=/nonexistent` deterministic-forcing idiom this spec reuses; (b) the non-overclaim discipline — the automated slice proves only the exit-code/cleanup invariant, never the live round-trip.
- `docs/knowledge/features/live-e2e-runbook.md:108-113` — where the `npm run build && node scripts/live-drive.mjs .` interim-gate command is documented. **Read-only.** Documentation phase owns this doc; do NOT edit it in this ticket. (The runbook's exit-code wording is a documentation-phase follow-up — see Open questions.)

## Context

`scripts/live-drive.mjs` is the interim operator pre-ship gate: it launches the built app, pairs a throwaway device against the **live** daemon over the **production** relay, drives a real send through the UI, and waits for a real claude reply. Today it only `console.log`s `LIVE DRIVE GREEN` / `LIVE DRIVE RED` and **always exits 0**, so `npm run build && node scripts/live-drive.mjs .` reports success even on RED — the script cannot gate a chained command, which is its entire purpose. Same bug class as #479.

**The load-bearing constraint:** the `finally` block (lines 112-121) is the credential-lifecycle guard — it runs `pyry pair revoke` on a device paired with `--allow-remote-permissions` against the **live** daemon. A skipped revoke leaks a live credential. So the fix must signal failure **without** short-circuiting `finally`. `process.exit()` inside the guarded region would terminate before `finally` runs and leak the pairing (technical-note in the ticket body). The mechanism below is a deferred exit code.

## Design

### Mechanism: deferred exit code via `process.exitCode`

Set `process.exitCode = 1` on failure paths instead of calling `process.exit(1)`. Setting `process.exitCode` records the code but does **not** terminate — Node exits with it when the event loop drains naturally, *after* `finally` has run. The script already drains cleanly to exit 0 today (it reaches end-of-module), so the same drain path now carries a non-zero code. No forced `process.exit` at the end is needed or wanted.

**Keep exactly one `process.exit(1)`** — the pyry-pair-failure branch (lines 29-32). At that point no device and no temp dir exist, so there is genuinely nothing to clean up; an immediate exit is correct there and must stay.

### Restructure: bring launch + temp-dir creation inside the guarded region

The current `try` (line 66) already wraps the UI flow, but `mkdtempSync` and `electron.launch` sit *above* it (lines 55-64) — a launch failure or bad app dir throws before the `try` and leaks the temp dir (AC7's "bad app dir" case). The fix pulls resource creation inside the guarded region and null-initializes handles so `finally` can clean up conditionally.

Target shape (contract sketch — flat flow, minimal reflow; **not** a full rewrite):

```js
// after `pyry pair` succeeds and payload is scanned — a device now EXISTS.
let userDataDir = null
let app = null
try {
  if (!payload) throw new Error('no pairing payload found in pyry pair output')
  userDataDir = mkdtempSync(join(tmpdir(), 'pyry-live-drive-'))
  app = await electron.launch({ cwd: APP_DIR, args: ['.', `--user-data-dir=${userDataDir}`], env })
  const page = await app.firstWindow()
  // …existing pair-through-UI → create-conversation → send → wait-for-reply flow, unchanged…
  if (ok) {
    /* log REPLY STREAMED + LIVE DRIVE GREEN — no exitCode set → stays 0 */
  } else {
    await page.screenshot({ path: '/tmp/live-drive-448-fail.png' })
    /* log RED */
    process.exitCode = 1                 // measured negative outcome, not an exception
  }
} catch (e) {
  console.error(`[drive] ${e.message}`)  // framework error text only — never the payload (see Security)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
  if (userDataDir) { try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* log */ } }
  try { execFileSync(pyry, ['pair', 'revoke', DEVICE], { encoding: 'utf-8' }); /* log revoked */ }
  catch { /* log "could not revoke … revoke by hand" */ }
}
```

Key points a developer must preserve:

- **No-payload → `throw`, not `process.exit`.** Moving the `!payload` check inside the `try` and throwing routes it through `catch` → `exitCode = 1` → `finally` → **revoke runs.** This is the fix for the credential leak at old lines 49-52. (The scan loop at lines 35-48 stays where it is — it is pure computation over `pairStdout`; only the *decision* moves inside.)
- **RED sets `process.exitCode = 1` directly** (does not throw). RED is a measured "no reply in 150s" outcome, not an exception; the screenshot is written first, then control falls to `finally`. Do not convert RED into a synthetic thrown error.
- **GREEN leaves `process.exitCode` at its default 0.** No explicit `= 0` needed.
- **`finally` cleanup steps are each independently guarded** so no single failure can prevent the others — most importantly, a failing `rmSync` must **not** skip the revoke. Order stays: close app → remove temp dir → revoke. `app` and `userDataDir` are null-checked because on the no-payload path neither was created.
- The one legitimate `process.exit(1)` (pyry-pair-failure, lines 29-32) is unchanged.

### Deterministic forcing hook: `PYRY_BIN` override

Add an env override for the pyry binary path (one line):

```js
const pyry = process.env.PYRY_BIN ?? join(homedir(), '.local/bin/pyry')
```

This is the *only* way to deterministically force the pyry-pair-failure branch on a machine that already has a working `pyry` (which the agent/operator machine does). It mirrors #479's `PYRY_BIN=/nonexistent` idiom exactly. Default behavior is byte-for-byte unchanged when `PYRY_BIN` is unset.

## State + concurrency model

No shared state, no store, no async streams. The script is a linear async CLI. The only concurrency concern is process teardown: `app.close()` releases the Electron subprocess handle so the event loop can drain and the deferred `process.exitCode` takes effect — this already works today (GREEN exits cleanly), and the restructure keeps `app.close()` in `finally`. No `AbortController` or subscription lifecycle is involved.

## Error handling

| Failure mode | Path | Exit code | Cleanup that runs |
|---|---|---|---|
| `pyry pair` fails (e.g. `PYRY_BIN=/nonexistent`) | `catch` at line 29 → `process.exit(1)` | non-zero | none needed (no device, no temp dir) |
| No pairing payload in `pyry pair` output | `throw` inside `try` → `catch` → `exitCode=1` | non-zero | **revoke** (device exists; temp dir not yet created) |
| App launch / bad app dir throws | thrown in `try` → `catch` → `exitCode=1` | non-zero | remove temp dir + **revoke** |
| Any UI step throws (connect / create / send timeout) | thrown in `try` → `catch` → `exitCode=1` | non-zero | close app + remove temp dir + **revoke** |
| RED — no reply within 150s | screenshot + `exitCode=1`, fall to `finally` | non-zero | close app + remove temp dir + **revoke** (screenshot written first) |
| GREEN — reply streamed | fall off `try` to `finally`, `exitCode` unset | 0 | close app + remove temp dir + **revoke** |

The invariant across every terminating path except the first: **`finally` runs `pyry pair revoke` to completion.** The first path is exempt because no device was created.

## Testing strategy

No unit-test file — this is an operator `.mjs` script with no importable surface, consistent with how the script ships today (it has no test). Verification is by running the script and observing exit code + filesystem, matching the ticket's "deterministic proof without the live stack" AC. Two checks, both runnable on any machine without the live relay:

- **Check A — universal, zero side effects (the agent-verifiable slice).** Force the pyry-pair-failure branch:
  - Command: `PYRY_BIN=/nonexistent node scripts/live-drive.mjs .`
  - Expect: `echo $?` → non-zero; **no** leftover `pyry-live-drive-*` directory in `os.tmpdir()` (none was ever created); the pairing-failed error is printed. Proves the deferred-exit mechanism and AC5's first branch with no pairing and no temp dir touched.
- **Check B — full finally invariant (needs a locally-working `pyry`).** Force a thrown step *after* the temp dir is created, via a bad app dir:
  - Command: `node scripts/live-drive.mjs /nonexistent-app-dir`
  - `pyry pair` writes the registry **locally** (per the script's own comment, "CLI writes the registry; #786 reloads at handshake" — pairing does not dial the relay), so a device is created; `mkdtempSync` runs; `electron.launch` throws on the bad `cwd`.
  - Expect: `echo $?` → non-zero; the temp `pyry-live-drive-*` dir is **gone**; the `revoked` (or `could not revoke …`) log line is printed. Proves temp-dir-removal-after-creation **and** revoke-on-a-thrown-path in one run. (This creates and revokes a real *local* throwaway pairing — that is the design; the device does not survive the run.)

The GREEN path and the live RED-vs-real-daemon path remain **operator-only** against the live stack, consistent with the runbook — do **not** attempt to make the full round-trip runnable under CI.

## Security review

Ticket carries `security-sensitive`. Adversarial pass over the spec below; verdict **PASS**.

**Trust boundaries.** The script is operator-run on a fully-operator-controlled machine. Its inputs are `process.argv[2]` (app dir, already operator-controlled today) and the new `process.env.PYRY_BIN` (operator-controlled). `PYRY_BIN` introduces **no new trust boundary**: an operator who can set an env var on the machine running the script can already run any binary directly; the override is at the same trust level as the existing hard-coded `~/.local/bin/pyry` path and the argv-supplied app dir. No untrusted/network-supplied value reaches the binary path. Enforced at `scripts/live-drive.mjs` (the single `const pyry = …` line).

**Credential lifecycle (the heart of this ticket).** The device is paired with `--allow-remote-permissions` against the **live** daemon; a skipped `pyry pair revoke` leaks a live credential. The design is verified to keep the revoke running on **every** terminating path that created a device:
- No-payload path: was `process.exit(1)` (skipped revoke → leak) → now `throw` → `catch` → `finally` → **revoke runs.** This is the leak the ticket fixes.
- Thrown-step / RED / GREEN paths: unchanged `finally` → revoke runs.
- The only revoke-exempt path (pyry-pair-failure `process.exit(1)`) is safe because `pyry pair` failed → **no device exists** to revoke.
- The `finally` revoke is independently guarded from the `rmSync` step, so a temp-dir removal failure cannot silently skip the revoke.

**Secret exposure in logs.** The script's standing invariant is "prints progress lines only; never the pairing payload or token" (header comment). The new `catch` logs **`e.message` only** — framework error text (Playwright locator timeouts, spawn/ENOENT errors, the literal `'no pairing payload found…'` string). The pairing payload is never passed into any thrown Error and is never interpolated into a log line, so `e.message` cannot carry it. No new secret-exposure surface.

**Deferred-exit correctness under failure.** Using `process.exitCode` (not `process.exit`) is precisely what preserves the revoke; the security property depends on cleanup completing, and the mechanism guarantees `finally` runs before the process exits. No path was found where a failure signals non-zero *and* skips cleanup.

No findings. Verdict: **PASS.**

## Open questions

- **Runbook wording.** `docs/knowledge/features/live-e2e-runbook.md:108-113` describes the interim-gate command but not its exit-code semantics. Updating it to note "exits non-zero on RED, safe to chain" is a **documentation-phase** follow-up after this PR merges — it is out of scope for the developer here (developer worktree mutates only `scripts/live-drive.mjs` + this spec). Flagging so documentation picks it up.
- **`PYRY_BIN` inclusion.** Included because it is the only way to force the pyry-pair-failure branch deterministically on a provisioned machine and it mirrors the sibling #479. If the developer finds Check B alone gives sufficient confidence and prefers to drop it, that is acceptable — but Check A (the zero-side-effect universal proof) then loses its forcing hook. Recommendation: keep it.
