# 1202 — the launch-fate attachment must not gate on a status that is not yet final

## Files read

- `e2e/fixtures/desktopIsolation.ts` → `attachLaunchFate`, `LaunchFateSink`, `LAUNCH_FATE_ATTACHMENT`,
  `createLaunchFateLog` — the gate under repair, the sink contract it reads, and the report's shape.
- `e2e/fixtures/launchPairedApp.ts` → the `launchPairedApp` fixture's LIFO drain and its trailing
  `attachLaunchFate(testInfo, fate)` — the epilogue the reported red went through.
- `e2e/smoke.spec.ts` → its local `launched` fixture — the tier's other epilogue, same trailing call.
- `e2e/launch-fate.spec.ts` → `recordingSink` and its four tests — the cover that AC3 says is blind here,
  and the file that has to gain the real-seam check.
- `e2e/question-picks.spec.ts` → the reported red's test — confirms it rides `launchPairedApp`, so the
  epilogue really was on its path.
- `playwright.config.ts` → `reporter: 'list'`, `workers: 1` — the reporter whose rules decide what an
  operator actually reads off a failing run.
- `node_modules/playwright/lib/runner/index.js` → `formatFailure` — the only place the terminal reporter
  prints an attachment, and it is reached only for a result that carries errors. This is the fact that
  lets the gate move out of our code and into the reporter without changing a green run's output.
- `node_modules/playwright/lib/worker/workerProcessEntry.js` → `TestInfoImpl._failWithError`,
  `TestInfoImpl.attach`, `WorkerMain.unhandledError` — the timing that makes the status gate unsound.
- `docs/knowledge/features/e2e-harness.md` § the #1127 paragraph — states the shipped "only a failing
  test gets one attachment" contract this ticket inverts. Read-only; the documentation phase owns it.

No `## Figma` section on the ticket and none is owed: nothing here renders. The whole change is inside
`e2e/`, and its only observable surface is the text an operator reads off a failing tier run.

## Context

#1127 shipped a launch-fate diagnostic so that the next fake-tier flake would be readable off a single
failing run. On the next occurrence — PR #1195, `e2e/question-picks.spec.ts`, a bare `socket hang up` —
it did not fire. The failing run carried no `attachment #N: launch-fate` line, and the exit code, signal
and alive-at-outcome facts were unavailable for exactly the red they were built for.

The existing cover cannot see this, because `e2e/launch-fate.spec.ts` drives `attachLaunchFate` with a
`recordingSink` double — a hand-written `{ status, attach }` pair that substitutes precisely the part
that fails.

### The mechanism, established by forced reproduction

Two throwaway specs were run against `main`, both launching through `launchPairedApp` (not committed):

- **A — the test body fails outright.** The run output carries
  `attachment #1: launch-fate (text/plain)` followed by
  `{"launches":[{"runningAtOutcome":true,"exitCode":0,"signal":null}],"teardownFailures":[]}`.
  So the plain path works, and the gap is *not* "the epilogue never reaches the attach".
- **B — the test body passes, and the failure is established after the epilogue.** A second fixture is
  requested first, so it is set up first and torn down last, and it throws `socket hang up` from its
  teardown. Console markers confirm the body ran to completion and the launch really happened. The run
  output carries the failure and **no `launch-fate` line**; `test-results/` holds only Playwright's own
  `error-context.md`. That is the reported symptom, reproduced.

`attachLaunchFate` gates on `sink.status`. `TestInfoImpl.status` starts at `'passed'` and only becomes a
failure when `TestInfoImpl._failWithError` runs, and Playwright can run that **after** the fixture
epilogue in two ways this tier hits:

1. Any teardown that runs later than `launchPairedApp`'s — a fixture set up before it tears down after
   it. That is reproduction B.
2. `WorkerMain.unhandledError`, which routes an `uncaughtException` / `unhandledRejection` to
   `this._currentTest._failWithError(error)` for as long as the current test is still open — which
   includes the whole epilogue and everything after it. A bare `Error: socket hang up` with no in-spec
   stack frame, on a worker that owns a fake relay forwarder and a fake daemon socket, is that shape.

In both cases the gate reads `'passed'`, returns without attaching, and the failure is stamped
afterwards. The gate is not wrong about *what* to print; it is reading the answer too early.

**A note on precedent.** #1127's own note reasoned that a *throwing* teardown step cannot skip the
attach and a *hanging* one can. Both hold, and neither is this: reproduction B's teardown throws, the
attach is reached, and the report is still lost. The status read is a third way to lose it, and it is
the one that does not need a hang.

### An ADR is not owed

This is a bug fix inside one function in the e2e harness. The design decision it revises
(#1127's "only a failing test carries the diagnostic") is a paragraph in
`docs/knowledge/features/e2e-harness.md`, and that paragraph now says something false. Folding the
correction in belongs to the documentation phase; this plan does not touch that file.

## Design

**Delete the status gate. Let the reporter decide.**

`attachLaunchFate` attaches whenever the report is non-empty, with no reference to the test's status.
Suppression on a green run does not disappear — it moves to where it was always actually enforced.
Playwright's terminal reporter prints an attachment only from `formatFailure`, which is reached only for
a result that carries errors, so **a passing test's attachment is never printed by `reporter: 'list'`**.
The green-run terminal output stays byte-identical; what changes is that a passing test's *result* now
carries an attachment nothing prints.

That is the whole fix, and it is the only shape that closes the window rather than narrowing it. Moving
the attach into a fixture that tears down last would beat reproduction B's mechanism (1) and still lose
to mechanism (2), because an unhandled error can land after every teardown has run. Nothing our code can
read at epilogue time is the final status, so the code must stop reading it.

**The sink contract narrows with it.** `LaunchFateSink` goes from `Pick<TestInfo, 'status' | 'attach'>`
to `Pick<TestInfo, 'attach'>`. The narrowing is the structural half of the fix: restoring the gate means
putting `status` back on the type, which is a visible edit rather than a one-line condition.

**What is kept:**

- The empty-report early return. It is not a status gate — it keeps a site that never launched and never
  recorded a teardown failure from attaching an empty object.
- `text/plain`, the `launch-fate` name, and the primitives-only body. The reporter's inline-printing rule
  (`text/*`, name not starting with `_`, truncated at 300 characters) is unchanged and still what makes
  the report readable, so all three assertions stay.
- Both call sites, unchanged: `attachLaunchFate(testInfo, fate)` stays last in each epilogue, after the
  drain, because the exit codes only settle once the closes have run.

**Comments that become false, and must move with the code:** the trailing note in `launchPairedApp.ts`'s
epilogue and the one in `smoke.spec.ts`'s outer `finally` both say the attach fires "on a failing test
only, so a green run carries nothing". After this change the attach is unconditional and the *reporter*
is what carries nothing on green. `attachLaunchFate`'s own doc comment says the same thing and gets the
mechanism instead. (`docs/knowledge/features/e2e-harness.md` says it too; documentation phase.)

## State + concurrency model

Unchanged. `createLaunchFateLog` stays a plain per-test value with no module state, `watch` /
`closeWatched` / `recordTeardownFailure` keep their contracts and their ordering (liveness read before
the close, exit code settled after), and no new async work, listener or timer is introduced.
`attachLaunchFate` gains no `await` it did not have.

One second-order effect is worth naming rather than discovering: `TestInfo.attach` calls
`this.outputPath()`, which `mkdirSync`s the test's output directory. Attaching on every test therefore
creates one directory per test under `test-results/` on a green run where previously it created none.
That is litter, not a correctness or hygiene problem, and Phase B measures it rather than assuming it.

## Error handling

`attachLaunchFate` is called from a teardown epilogue, so a throw from it would replace the causal error
(#517's hazard). It stays a `body` attachment — held in memory, no file written — so the only I/O it can
do is the `mkdirSync` above, which is the same call the function already made on every failing test.

## Testing strategy

Playwright only, in `e2e/launch-fate.spec.ts`. There is no vitest cover here and none is owed: the seam
under repair is real-`TestInfo` behaviour, and vitest never sees a `TestInfo`.

- **AC3, the real seam — a new test.** Drive `attachLaunchFate` with the test's own real `testInfo`
  while the test is passing, then read `testInfo.attachments` back. This is the exact substitution
  `recordingSink` was making: the real `TestInfo`, its real `attach`, and a status that is `'passed'` at
  the moment of the call. Asserted, as bullet-pointed scenarios:
  - the premise — `testInfo.status` is `'passed'` when the call is made, and no `launch-fate` attachment
    exists before it (so the test cannot silently stop testing what it claims);
  - after the call, exactly one `launch-fate` attachment, `contentType: 'text/plain'`, with `path`
    undefined (still an in-memory body, no file written);
  - its body parses back to the report that went in;
  - AC4 on this real channel — the body contains no `/` and stays under the reporter's inline limit;
  - the empty-report control — a fresh log with no launches and no teardown failures attaches nothing,
    so the kept early return is covered and the assertion above is not vacuous.

  **It reddens on revert.** Restore the status gate and the call attaches nothing on a passing test, so
  the count assertion fails. No nested Playwright run: the function is driven directly, the way the rest
  of the file already does it (`e2e/launch-fate.spec.ts`'s existing shape, and #517's).

- **The existing third test loses its status arms.** `recordingSink` drops its `status` parameter — the
  sink no longer has one — so its `failed` / `timedOut` / `passed` / `skipped` assertions have nothing
  left to distinguish. What survives is its real subject: two teardown steps named in drain order. Title
  changes with it. Status-independence is not provable against a double whose status is ignored; it is
  provable only against the real `TestInfo`, which is the new test above.

- **The first two tests keep their launches and their assertions**, minus `recordingSink`'s argument.
  Test 1's hygiene bound against a real `--user-data-dir` is the strongest AC4 evidence in the file and
  is untouched.

- **The source guard stays as-is.** Its `opens`/`attaches` pairing is unaffected.

- **Verification for AC1/AC2 is the throwaway reproduction**, run before and after the change and then
  deleted. Not committed, per the ticket.

## Open questions

1. **Does a green run's terminal output really stay byte-identical?** The reporter source says yes.
   Phase B confirms it by running a passing spec and checking the output carries no attachment line.
2. **How much `test-results/` litter does the unconditional attach leave?** Measured in Phase B on the
   same passing run; recorded here as a revision if it is worse than one empty directory per test.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the reason is structural rather than incidental: this change
  moves no data across any boundary. The report body is built by `createLaunchFateLog().report()` from
  values the harness itself produced — three primitives per launch plus `TeardownStep` literals — and
  the only edit to that path is deleting a condition. No relay, IPC, disk or daemon input is in scope
  anywhere in `attachLaunchFate`.
- **[Tokens, secrets, credentials]** No findings. Nothing here reads, writes, derives or transmits a
  token. The adjacent secret is the launch argv's `--user-data-dir=<path>` — the run's secret store —
  and the three guarantees that keep it out of the body are all untouched: primitives-only construction,
  bindingless `catch` at every drain site, and `TeardownStep` as a closed union of fixed literals. AC4's
  requirement that `TeardownStep` stay closed is met by not touching it.
- **[Error messages, logs, telemetry]** **The one category this change genuinely moves, and the finding
  is about volume, not content.** The report is now emitted for every test in the tier rather than only
  for failing ones — roughly 106 emissions per green run instead of ~0. Each is the same primitives-only
  body, so the hygiene bound is per-emission unchanged, but the blast radius of a future regression that
  *did* let a path into the body is now every test rather than the rare red. That is precisely why the
  cover asserts the no-`/` bound on the **real** `testInfo.attachments` body (AC4) and not only on the
  double: the assertion now guards the channel that carries the body on every test. No finding requiring
  a design change.
- **[File / storage operations]** SHOULD FIX, and fixed in the design above rather than deferred: the
  attachment stays a `body` (in-memory) attachment and never a `path` one, so no file is written and no
  untrusted string reaches a filesystem path. The new cover pins this by asserting the attachment's
  `path` is undefined. The one filesystem effect that does widen is `TestInfo.attach`'s internal
  `outputPath()` → `mkdirSync` of the test's own output directory — a Playwright-owned path under
  `test-results/`, derived from the test title, with no input of ours in it.
- **[Inter-process / Electron attack surface]** Not applicable, stated rather than assumed: no
  `BrowserWindow`, `webPreferences`, `contextBridge`, `ipcMain` channel, custom protocol or navigation
  guard is created, read or modified. The change is confined to `e2e/` and never runs in a shipped
  build — `playwright.config.ts` scans `e2e/` only, and nothing under `src/` imports it.
- **[Cryptographic primitives]** Not applicable: no RNG, no hash, no key, no nonce, no comparison
  against a secret. `Noise_IK_25519_ChaChaPoly_BLAKE2s` is not in reach of any symbol this plan edits.
- **[Network & I/O]** Not applicable: no socket, no URL, no frame, no timeout and no reconnect path is
  touched. The fake forwarder and fake daemon are untouched — note that the *cause* of the reported red
  may well be one of their sockets, but this ticket is explicitly not fixing the flake.
- **[Concurrency]** No findings. No async task, listener or timer is created or removed;
  `settleExit`'s bounded listener-plus-timer, which clears both on whichever settles first, is
  untouched. The one ordering this file owns — liveness before the close, exit code after — is unchanged.
- **[Threat model alignment]** Out of scope by construction and named as such: the desktop threat model
  concerns a hostile relay, token theft from disk, a hostile daemon response, and renderer compromise
  reaching the transport. None is reachable from a Playwright fixture epilogue that runs only under
  `npm run e2e`. The underlying fake-tier flake is out of scope per the ticket and is picked up by a
  follow-up filed once a recurrence carries a readable fate.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07

## Revisions

### 2026-09-07 — both open questions resolved, and one departure from the testing strategy above

**Open question 1 — does a green run's terminal output stay byte-identical? Yes, measured.**
`npx playwright test e2e/smoke.spec.ts` after the change prints the same three `✓` lines and the same
`3 passed` summary, with no attachment line anywhere. The reporter reasoning holds in practice: an
attachment on a passing test exists in the result and is never printed.

**Open question 2 — how much `test-results/` litter? Less than the plan feared, and it does not
accumulate.** One *empty* directory per test **that actually attaches**, not per test: a green
`launch-fate.spec.ts` run leaves two directories for four tests, because only two of them call
`attachLaunchFate`. And Playwright wipes `test-results/` at the start of every run — the smoke run's
directories were gone after the next run — so this is per-run litter with no growth. Nothing to change.

**Departure — `recordingSink` is deleted outright, and the AC3 cover is merged into the existing third
test rather than added as a fifth.** The plan said the double would keep its `failed`/`timedOut` arms
with its `status` parameter dropped, and that a new test would carry the real-`TestInfo` check. Both
halves changed once the code was in front of me:

- With the gate gone, `LaunchFateSink` no longer has a `status`, so every one of the double's arms
  asserts the same thing. What was left of `recordingSink` was a hand-written `attach` that records into
  an array — strictly weaker than reading `testInfo.attachments`, and it is the exact substitution AC3
  names as the reason the old cover was blind. So it is gone, and **every** test that attaches now does
  so through its own real `testInfo`. That moves the killed-launch test's hygiene bound (a real launch, a
  real `--user-data-dir`, AC4's strongest evidence) onto the real channel too, where the plan had left it
  on the double.
- The remaining subject of the third test — two teardown steps named in drain order — needs the same
  synthetic log and the same real sink as the new status-independence check, and splitting them would
  have produced two near-identical tests. They are one test with two assertion blocks, and its title
  names both.

Net effect on the ACs is unchanged or stronger: two tests now redden if the gate is restored (the
killed-launch test and the merged one), where the plan promised one.
