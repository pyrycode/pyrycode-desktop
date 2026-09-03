# #929 — real-claude e2e: Cancel refuses a question batch to a live claude

One new Playwright spec on the tier-3 real-claude tier, `e2e/real-claude-question-cancel.spec.ts`. The
refusal twin of #928's answer arm: same fixture overrides, same pairing-and-create preamble, same
DOM-only assertion posture, opposite verdict. **No production file changes, no fixture change** — every
fixture option this needs landed with #928 (`claudeModel`) and #933 (`requiredCapabilities`).

## Files read

Codegraph was not consulted: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized", so this list came from `Grep`/`Read` directly. Noted rather than silently worked around.

- `e2e/real-claude-question-answer.spec.ts` (#928) → `questionAnswerTrigger`, `assistantText`,
  `continuationOf`, `bounded`, the `test.use` block, the pairing-and-create preamble — **the direct
  template**. Everything below that is not about refusal is transcribed from it.
- `e2e/question-cancel-refuses.spec.ts` (#921) → the fake twin. Source of the panel-scoped Cancel
  locator and of the two things this spec must *not* assert (the optimistic clear; a panel that stays
  cleared).
- `e2e/real-claude-permission-modal.spec.ts` (#432) → `answerAllow` — the daemon-supplied-affirmative
  dialog helper the allow arm reuses verbatim; also the `existsSync(join(daemon.workdir, …))`
  *presence* check this spec deliberately does not copy (see § Design, the absence walk).
- `e2e/fixtures/realDaemon.ts` (#420/#439/#432/#483/#928/#933) → `RealDaemonOptions` (the five options
  used here), `SpawnedDaemon.workdir` (#487, the absence walk's root), the skip gate, `test`, `expect`,
  `encodePairingPayload`.
- `e2e/fixtures/pairingArrival.ts` → `pairFromUnpairedLaunch`, the paste → Pair → Confirm drive.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QUESTION_CANCEL_COPY`, the
  `question-panel__cancel` button, `question-panel__option-label`, `question-panel__labels` — the
  structural surface. Read only; nothing here changes.
- `playwright.config.ts` `testIgnore` / `playwright.real-claude.config.ts` `testMatch` → both anchored
  `/(^|\/)real-[^/]*\.spec\.ts$/`, so the tier partition depends on the **filename** alone (AC4).
- `docs/knowledge/features/real-claude-liveness-e2e.md` → the tier's own lessons, and the one that
  changes how this ticket is built: the `META_SELECTOR` strip must run on a **detached clone** so the
  live DOM the panel assertions read is untouched, and every text-bearing child added to `.bubble`
  needs the two-grep sweep. This spec is the fifth `META_SELECTOR` reader; the constant keeps that
  exact name so `rg META_SELECTOR e2e/` still finds the whole set.
- `docs/knowledge/features/question-panel-cancel-refusal.md` → what Cancel actually sends
  (`refuseQuestionBatch`: one `question_refused` carrying the batch id, then two local clears **outside**
  the try), and the design fact this spec's assertion posture rests on — the clear is optimistic and
  the daemon owns what claude is told.
- `docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state → the tier holds green
  at 10 specs as of 2026-09-02; this makes 11. Read-only (documentation phase owns it).

## Design source

**Figma:** N/A — the ticket body carries no `## Figma` section and this slice touches no production
file, renders nothing, and adds no chrome. It drives an already-shipped surface (`QuestionPanel`, whose
Figma fidelity was settled by #906/#916/#921) by structure only. The visual-fidelity check is not
skipped by oversight; there is no new pixel to check.

## Context

`e2e/question-cancel-refuses.spec.ts` proves Cancel sends exactly one `question_refused` for the batch
and clears the panel — against the fake transport, with an in-process outbound capture. What it cannot
show is what a **real** claude does with that refusal. pyrycode#1990 resolves a refused batch as a deny
carrying a fixed *instruction* — do not answer it yourself, do not assume an answer, do not continue
with the work it was blocking, stop and wait — and whether a model honours that is not a property of
this app's code.

The daemon side drove it from the other end and it landed (pyrycode#1995,
`interactive_stream_question_refusal_test.go`, 2026-09-02): under `claude-sonnet-5`, one question with
four options, `question_dismissed{refused, remote}` for the batch, then claude **stopped** — no further
modal, no re-ask, nothing written, one sentence inviting the discussion before terminal idle, whole
turn 6.5s. That is the baseline. The thing this spec exists to catch is a future model that reasons
differently about the deny.

The desktop-specific half: the refusal is gated too. `questionResolverV2.admit` gates a refusal on the
same per-device remote-permission opt-in (pyrycode#702) that gates an answer, and it defaults to deny.
A refusal from a device without the opt-in is denied and the batch is left outstanding — from the
window, indistinguishable from a Cancel that never left, because the panel clears optimistically either
way.

**No ADR is warranted.** This adds no decision; it is the refusal arm of a vertical whose decisions
(#921's client-owned outcome/source constants, #928's assert-reply-content departure) are already
recorded.

## Design

One file, `e2e/real-claude-question-cancel.spec.ts`. Structure mirrors #928 section for section.

### Tier routing and fixture declaration (AC4)

`test.use({ skipPermissions: false, interactiveRunner: 'stream-json', allowRemotePermissions: true,
claudeModel: 'claude-sonnet-5', requiredCapabilities: ['question'] })` — all five already exist in
`RealDaemonOptions`. `allowRemotePermissions` is load-bearing for a **refusal** exactly as it is for an
answer (`admit` gates both). `requiredCapabilities` turns a daemon predating pyrycode#2020 into a skip
naming the stale daemon rather than a deadlined surface wait. The `real-` filename prefix does the rest:
excluded from `npm run e2e`, collected by `npm run e2e:real-claude`, and its all-skip is what
`npm run e2e:real:gate` turns into a non-zero exit.

### The trigger — the whole of AC2's difference from #928

#928's prompt ends *"do not write code and do not use any other tool"* precisely so that slice measured
only the continuation's wording. Here the question must gate **real work**, and the artefact that work
would produce is what the absence walk looks for. `questionCancelTrigger(base, nonce)` keeps every
pinned constraint that survives and diverges on one:

- **Names the tool.** This measures the round trip, not claude's propensity to reach for it.
- **Demands a single choice.** A question emitted without the `multiSelect` key is rejected by
  `questionbridge.Parse` and falls through to a permission modal that parks the turn.
- **Asks for four options**, inside Parse's 2–4 bound.
- **Names no option and no preference.**
- **Gates a file-creating step on the answer** — "do not create it and do not use any other tool until
  I answer". That is the work whose absence AC2 reads.
- **Diverges: a per-run unique bare base name, no directory, no absolute path, no "in this repo"** — so
  a claude-authored question cannot quote the harness temp workdir (`/var/folders/…` on macOS) into a
  salvaged run log. The extension is left to the chosen format, which is why the walk matches on
  *containment* of the base name rather than on an exact filename.

Signature: `questionCancelTrigger(base: string, nonce: number): string`. The nonce keeps reruns
distinct and is never asserted on.

### The drive

1. Pair (`pairFromUnpairedLaunch`), create the conversation through the New-discussion FAB, wait for
   Send enabled — verbatim from #928, which is verbatim from #432.
2. Send the trigger. Wait for `.question-panel` visible within `QUESTION_SURFACE_TIMEOUT_MS` (180s per
   the ticket). **AC1 first half.** A timeout here is a genuine liveness signal, not a flake.
3. **AC1 second half, before anything is clicked:** at least one question (tab count floored at 1, as a
   single-question batch draws a bare `<span>` and no tabs) offering at least two
   `.question-panel__option-label` entries. Asserted *before* the click so a batch that surfaced empty
   fails here rather than letting the absence walk pass over nothing.
4. Read the pre-refusal baseline `before = assistantText(page)`, while the turn is parked on the tool
   call and nothing is streaming.
5. Click Cancel, **scoped to the panel** — `panel.getByRole('button', { name: 'Cancel' })`, the #921
   scoping: Cancel is ordinary chrome copy elsewhere in the shell and a page-wide role match is one
   shipped dialog away from matching two controls.

### The settle loop — AC3, and why it is not dead code

Between the refusal and terminal idle the spec services two arms on every poll iteration, through one
`serviceInterruptions(state)` helper called from inside both polls below:

- **Allow arm.** Any `page.getByRole('dialog')` raised *after* the refusal is answered allow via
  #432's `answerAllow` (affirmative by start-anchored case-insensitive regex, then the optional
  client-owned `Confirm`), under `MAX_ALLOWED_MODALS`. This is what makes the absence non-vacuous: on
  a permission-gated harness the artefact's absence would otherwise be guaranteed by the permission
  gate whether or not the refusal did anything.
- **Re-ask arm.** A panel that comes back is refused again, under `MAX_REFUSALS` (counting the first).
  Without it a re-asked batch parks the turn on the ten-minute approval window instead of failing
  usefully.

**Expect neither arm to fire on a passing run** — neither did upstream, because claude stopped cleanly.
A reader meeting a green run with zero modals allowed should read that as a structural gap, not as dead
code: there is no run that exercises the arm without the model failing to honour the refusal. That note
goes in the file header verbatim, per the ticket.

Containment for the allow arm is upstream's four bounds minus the one this DOM does not have.
`modalPrompts` carries a `trust` class through unchanged and `PermissionModal` renders `outstanding[0]`
whatever its class, with no class or data attribute on the rendered dialog — so upstream's
`Class == "permission"` assertion is unavailable here. **Surfacing it is out of scope** (a production
change in a slice that touches no production file). What remains: the count cap, the harness's isolated
authenticated HOME with the workdir beneath it, a bounded record of every allowed dialog's text, and
the fixture's existing suppression of claude's own startup dialogs (trust pre-seed +
`skipDangerousModePermissionPrompt`, #432).

### The settle assertions — AC2 first half

Two sequential polls, each servicing the arms:

1. `continuationOf(before, await assistantText(page)).trim().length > 0` within `TURN_TIMEOUT_MS`.
2. `.bubble__cursor` count reaches 0.

Ordered deliberately: **a turn still parked on the tool call already shows no cursor**, so a bare
quiesce check could pass instantly. The `expect.poll` shape and its diagnostic are lifted from #928; the
message names **both** readings — denied at the pyrycode#702 gate, or claude did not honour the deny —
and points at `PYRY_E2E_DAEMON_LOG=<path>`, which tees daemon stderr for the whole run and is the first
thing to check when the spec fails with claude simply not moving.

`assistantText` is #928's verbatim: concatenated `[data-thread-role="assistant"]` text with the `▎`
cursor and the `.bubble__meta` subtree stripped **on a detached clone**, so the live DOM the panel
assertions read is untouched. Without the strip a still-empty streaming bubble reports as having
content and `continuationOf`'s `startsWith` prefix invariant breaks on #1014's trailing stamp.

### The absence walk — AC2 second half

`findArtefacts(root, base): Promise<string[]>` — a **recursive** read of `daemon.workdir`
(`readdir(root, { recursive: true })`), returning every relative entry path containing `base`. Expected
empty, asserted only **after quiesce**, so the tool phase is definitively over.

It walks rather than `stat`s, and that is the point: #432 reads a single joined path for a *presence*
check, which is fine there, but an *absence* check on one path passes silently when claude writes the
same base name into a sub-path. Matching on the whole relative path also catches a directory named for
the base.

Four properties of the walk are load-bearing rather than incidental, and each is a security-review
finding pinned into the code (§ Security review, categories 1/3/7):

- **It never builds a path from what it finds** — no `join`, no `open`, no `stat` on a discovered name.
  Claude authored those names; the walk tests containment and nothing else.
- **It never deletes.** The fixture's `try`/`finally` reaps the whole temp tree; a spec-side `rm` here
  would be an arbitrary recursive-delete primitive pointed at a path the test does not fully own.
- **It does not descend symlinks.** Node's recursive `readdir` descends real directories only, so a
  symlink claude planted at the operator's home is listed as one entry and never enumerated into a
  salvaged run log.
- **Only matching entries are ever printed, relative and bounded** — never the full listing, never the
  `/var/folders/…` root, capped at `MAX_REPORTED_ARTEFACTS` and each passed through `bounded()`.

### What this tier cannot correlate on

Upstream's asserted milestone is `question_dismissed{refused, remote}` for that batch id. Over the real
relay the daemon is a separate process, so #921's in-process outbound capture is unavailable and every
assertion here reads DOM text, visibility or counts only. The desktop stand-in is the continuation: a
refusal denied at the device gate leaves claude parked until the approval window elapses, so a
continuation inside a bounded budget is what separates a landed refusal from a dropped one.

**Two things the spec must not assert.** The panel *clearing* is not the proof — it clears
optimistically, before any daemon frame answers, which #921 proves on the fake tier. And the panel must
not be asserted to *stay* at count 0: a re-ask legitimately brings it back, and AC3 tolerates that
rather than reddening on it.

**`src/shared/wire/types.ts` is not touched.** Its `QuestionDismissedPayload` docblock records the
producer's landed vocabulary as `{unanswered, no_answer}` and says to recognise, not enforce.
pyrycode#1990 has since added `{refused, remote}`, but this spec asserts on neither — it cannot see the
frame — and rewriting a correct fail-closed docblock is not this slice's work.

## State + concurrency model

No store, no IPC, no async task of this spec's own. All concurrency is Playwright's: auto-waiting
locators, two `expect.poll` loops with explicit timeouts, and the fixture chain's LIFO teardown
(`page → daemon → relay`, so the app closes before the daemon its supervisor would otherwise
churn-reconnect to). The daemon subprocess and its two temp dirs are reaped by `realDaemon`'s
`try`/`finally` on success, failure and skip alike — nothing new to cancel.

The one deliberate concurrency choice: `serviceInterruptions` performs **side effects inside a poll
callback**. That is what lets the two arms run while the spec waits, without a second concurrent task
racing the same DOM. Each arm re-checks presence immediately before acting, and each is capped, so the
loop is bounded by construction as well as by `TURN_TIMEOUT_MS`.

## Error handling

- **Every timeout is a genuine red, never softened.** The surface wait, the continuation poll and the
  quiesce poll each carry a diagnostic naming what the timeout means and what to read next.
- **An arm that throws is itself informative** and is not swallowed: an arm only runs when claude has
  already failed to honour the refusal, so a failure inside one is a signal worth seeing rather than a
  race to paper over.
- **A cap reached** stops that arm; the turn then parks and the continuation poll reddens with its own
  message. No separate assertion needed.
- **Claude-authored bytes that any failure message prints go through `bounded()`** — truncated and
  `JSON.stringify`-quoted, because nothing on this path strips terminal escapes and the pipeline
  salvages run logs. This covers dialog text and found artefact names.
- **The continuation's text is never printed, unlike #928's.** That spec asserts *on* the reply, so a
  failure has to show what claude said. Here the continuation's content is irrelevant to every verdict
  — the failure mode is "nothing streamed at all" — so there is nothing worth showing, and the
  claude-authored bytes stay out of the log entirely. Strictly tighter than the sibling, at no cost.
- **Nothing interpolates the pairing payload, `daemon.pairFields`, or the workdir root** into any
  message. `PYRY_E2E_DAEMON_LOG` is named as an env-var *name*, never a value.
- **Skips, not failures**, for a missing `pyry` / `claude` / credential / `question` capability — the
  fixture's own gate, inherited unchanged.

## Testing strategy

The spec **is** the test. Nothing here is unit-testable: it exists precisely because the fake tier
cannot reach a real claude, and this repo's renderer specs are static server renders with no DOM and
nothing to click. No vitest file is added — there is no pure function in this slice that isn't already
covered (`decideCapabilityGate` under #933, `refuseQuestionBatch` under #921).

Builder gate: `npm run build` (typechecks `e2e/` too) and `npx playwright test --list` under both
configs to prove the tier partition (11 real-claude, unchanged default count). The live run belongs to
the operator's `npm run e2e:real-claude`; this fork's automatic gate is not configured, so the
`needs-real-claude` label parks the ticket in Inbox after verification.

## Open questions

- **OQ-a — does a real claude reliably say anything after the deny?** AC2's proof requires a
  continuation to stream. Upstream measured one sentence inviting the discussion, and the deny's fixed
  instruction ("stop and wait") invites exactly that. If a future model instead goes straight to
  terminal idle with no text, the continuation poll reddens on a *correct* refusal. Accepted: the AC
  specifies this proof shape, upstream's baseline supports it, and the diagnostic names the reading. If
  a live run shows it, the fix is a turn-boundary signal rather than a text signal — a follow-up
  ticket, not a widened timeout.
- **OQ-b — will claude quote the workdir into its question?** The trigger carries no path and no
  directory, which is the mitigation. Unverifiable before a live run; if it happens, the run log
  carries a `/var/folders/…` path and the trigger needs tightening.
- **OQ-c — cap values.** `MAX_ALLOWED_MODALS` and `MAX_REFUSALS` are set small (3 each). Both arms are
  expected never to fire, so the values are a runaway bound rather than a tuned budget; a live run that
  hits either is a finding, not a reason to raise them.

Each is resolved or restated in a `## Revisions` entry if implementation changes the answer.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. This slice adds no production trust boundary — no new
  `contextBridge` API, no `ipcMain` channel, no parser, no wire type. The boundaries it *reads across*
  are all claude-authored text entering the spec process: option labels, dialog text, the continuation,
  and — the one #928 did not have — **filenames claude created on disk**. Every one is treated as data:
  matched by structure or containment, never used to build a path, a selector, a key or a command. The
  design decision that makes the category safe is stated positively in § Design's absence-walk bullets
  rather than assumed.
- **[Tokens, secrets, credentials]** No findings. `answer_token` cannot enter this spec even in
  principle: over the real relay the daemon is a separate process, so there is no in-process frame
  capture at all, and the refusal's token is minted main-side by `daemonConnection.refuseQuestions`
  where the renderer never sees it. The pairing token reaches only `encodePairingPayload` and the
  pairing UI; the fixture's `runPyryPair` / `decodePairFields` already never echo `pyry pair` stdout,
  and § Error handling forbids interpolating the payload or `pairFields` into any diagnostic. The run
  nonce is `Date.now()` — a non-security discriminator (cache defeat, per-run uniqueness) inside a
  freshly `mkdtemp`'d workdir, so a cross-run collision cannot make the absence walk read a stale
  artefact.
- **[File / storage operations]** SHOULD FIX ×2, both folded into the plan before this commit rather
  than deferred. (a) The absence walk must print **relative** entries only, never the `/var/folders/…`
  workdir root, and cap the printed set at `MAX_REPORTED_ARTEFACTS` — the natural phrasing of that
  diagnostic would have interpolated the absolute harness path into a salvaged run log. (b) The walk
  must not descend symlinks; Node's recursive `readdir` already descends real directories only, so this
  is a property to *state and rely on*, not to add — a symlink claude planted at the operator's home
  would otherwise be enumerated into that same log. Beyond those: no path is built from untrusted
  input (root is fixture-owned, base is spec-minted), there is no check-then-open so no TOCTOU, and the
  spec **never deletes** — a spec-side `rm` under `daemon.workdir` would be an arbitrary
  recursive-delete primitive aimed at a tree the fixture already reaps on every exit path.
- **[Inter-process / Electron attack surface]** Named risk, accepted with bounds — the headline finding
  of this review. **The spec deliberately grants a live model auto-approval of permission prompts.**
  That is not incidental: AC3 requires it, because on a permission-gated harness the artefact's absence
  would otherwise be guaranteed by the permission gate whether or not the refusal did anything, and the
  check would be vacuous. The worst case is an auto-approved tool that is not the expected Write. It is
  not a MUST FIX because the alternative (deny, or don't answer) is forbidden by the AC, and because
  the containment is four deterministic bounds: the count cap (`MAX_ALLOWED_MODALS`), the harness's
  isolated authenticated HOME with the workdir beneath it, a bounded record of every allowed dialog,
  and the fixture's existing suppression of claude's own startup dialogs. Upstream's fifth bound —
  asserting `Class == "permission"` before allowing — is **unavailable here**: `modalPrompts` carries a
  `trust` class through unchanged and `PermissionModal` renders `outstanding[0]` whatever its class,
  with no class or data attribute on the rendered dialog. Recovering it is a production change in a
  slice that touches no production file, so per the ticket it is **OUT OF SCOPE and routed back rather
  than folded in**. Everything else in this category is untouched: no `webPreferences` change, no
  window, no protocol handler, no navigation guard, and the two `app.isPackaged`-gated dev affordances
  (#97 loopback relay, #99 test secret backend) are consumed through the existing fixture, relaxing no
  validation.
- **[Cryptographic primitives]** No findings — nothing is hand-rolled or configured here. The handshake
  is the app's own real path; #933's capability probe with its ephemeral static key is reused
  unmodified; the Noise variant is untouched. `src/shared/wire/types.ts` is explicitly not edited.
- **[Network & I/O]** No findings. No new socket; the relay is the in-process fake routing relay on
  loopback and the daemon's `PYRY_ALLOW_INSECURE_RELAY` is fixture-owned. Every wait in the spec is
  explicitly bounded (surface 180s, continuation and quiesce 120s, whole spec 480s), so a slow or
  wedged daemon reddens with a diagnostic instead of hanging the tier — the `expect.poll` deadlines are
  this spec's timeout discipline.
- **[Error messages, logs, telemetry]** SHOULD FIX ×1, folded in: **do not print the continuation.**
  #928 prints it because it asserts *on* the reply; here the content is irrelevant to every verdict and
  the failure mode is "nothing streamed", so printing it would leak claude-authored bytes for no
  diagnostic value. What may still print — dialog text when the allow arm fires, matching artefact
  names — goes through `bounded()` (truncated, `JSON.stringify`-quoted, so a terminal escape in
  claude-authored text cannot reach a terminal as one). `playwright.real-claude.config.ts` disables
  trace, screenshot and video, which matters more on this spec than on any sibling: a screenshot of
  this surface would capture both a claude-authored question panel and a permission dialog.
- **[Concurrency]** No findings. Nothing outlives the test body: no timer, no listener, no
  `AbortController` to thread, and teardown is the fixture's LIFO `page → daemon → relay` with the
  subprocess reaped as a process group on success, failure and skip alike. The one check-then-act is
  `serviceInterruptions` reading an element's presence and then acting across an await; it is
  deliberately not swallowed, because an arm only runs when claude has already failed to honour the
  refusal, so a throw there is a signal rather than a race to paper over. Both arms are capped, so the
  loop is bounded by construction as well as by `TURN_TIMEOUT_MS`.
- **[Threat model alignment]** The desktop-specific threats: a *malicious relay* is out of scope (the
  relay is an in-process test fake on loopback); *token theft from disk* is unchanged and the isolated
  `--user-data-dir` plus `mkdtemp` daemon HOME are removed on every exit path; *renderer compromise
  reaching the transport* is untouched, as no production code changes. The applicable one is a
  **hostile or degraded model** rather than a hostile daemon — a claude that ignores the deny, writes
  where it was told not to, or names files adversarially. That is precisely what this spec exists to
  detect, and it is contained by the bounded printing and the never-build-a-path rule above rather than
  trusted away.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
</content>
</invoke>
