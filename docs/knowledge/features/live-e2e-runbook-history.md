# Live e2e runbook — earlier gate evidence

Part of [Live e2e runbook](live-e2e-runbook.md). Current gate status stays in the
[parent runbook](live-e2e-runbook.md#current-real-claude-gate-state). These records
preserve earlier executable provenance, results and diagnosis.

## Earlier recorded runs

**#1433 (2026-09-15) — the tier grows to 20 executed specs in 20 files (21 declared); the stored-prompt family gets its first live proof, and the live gate found a real daemon bug.**
`e2e/real-claude-system-prompt.spec.ts` proves the [system prompt write](system-prompt-write.md) family end
to end: a prompt saved through Channel info produces nothing in a session that was already running, and the
same text produces a marker reply once a session actually spawns with it. The ticket asked for the positive
half on `New session`; the first live run failed there, and the failure was the daemon, not the spec — see
§ Current real-claude gate state's own detail in [system-prompt-write.md](system-prompt-write.md#live-proof-1433)
and the rework rationale in the spec's file header. **`New session` below names the row as it was labelled
on 2026-09-15, the day this ran** — [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) the
next day folded it with the menu's separate `/clear` row and renamed it **Reset session**; the spec picks
the same row and the same mechanism under its current locator, and the history below is otherwise
unaffected by the rename.

Two gate runs:

- **`4746fd3673` — RED.** 20 executed, 19 passed, 1 failed: this spec's original shape (positive half after
  `New session`) at the post-rotation marker assertion. The dispatcher parked the ticket back in
  In Development with `needs-rework:builder`, `needs-real-claude` retained.
- **`d2be2eccb0` — GREEN.** 20 executed, 20 passed, 0 failed, 1 skipped (the reworked spec's own
  `test.fixme`, which does not execute and does not count against the floor). Merged with `origin/main`
  `9cd86aa55c` (0 commits behind), exit 0, wall clock 112.4s. The dispatcher moved the ticket to
  In Documentation and removed `needs-real-claude`.

**Why the RED was a daemon bug, not a spec bug.** `refreshSystemPrompt` — the only code that recomposes a
session's `--append-system-prompt-file` from the stored value — has exactly one caller, `Pool.Activate`,
which returns early for a session already in `stateActive`. `new_session` never reaches it:
`handleNewSession` → `StartNewSession` → `Runner.RestartFresh` relaunches the child from the frozen argv
through the runner's own loop, never through `Pool.Activate`, and `Pool.RotateForNewSession` only rekeys,
persists and notifies. So a prompt saved during a live session cannot reach the child that `New session`
spawns — contradicting `set_system_prompt`'s own contract that it "takes effect at the conversation's NEXT
session start". Filed upstream as `pyrycode/pyrycode#2436`. The rework moved the positive half to a
conversation's **first** spawn instead (a minted session starts `stateEvicted` and pyrycode#2085 defers its
child to the first message, which is the flow `refreshSystemPrompt`'s own doc names as the one it serves),
kept the negative half on its original vehicle, and left the original `New session` shape as an executable
`test.fixme` pointing at #2436 — flipping it back to `test` is the whole fix once the daemon change lands.

**`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is owed a bump from 10 to 20** — the tier's executed count, matching
the discipline that a PR adding a `real-*` spec must say so. The floor lives in the fork's dispatcher
configuration, not this repo.

**#1409 (2026-09-14) — the dispatcher's authenticated gate PASSED, confirming AC4's session-permission checkbox live.**
`real-claude-permission-modal.spec.ts`'s `real claude session checkbox grants repeated Bash use only in
the current session` now opts the fixture into `stdio_permission_prompt: true` (retaining the stream
runner, `skipPermissions: false` and remote permission approval), observes an offered checkbox, checks
it, explicitly Confirms allow, and observes the witness Bash command's effect; a repeat of the identical
command in the same session produces a fresh effect with no second permission event, and a fresh session
in the same workspace raises a new permission request before any fresh effect. Result: 19 executed, 19
passed, 0 failed, 0 skipped, at `feature/1409` `e49ea05a1d` merged with `origin/main` `3f6f3e1e83`
(0 commits behind before the merge), exit 0, wall clock 101.0s. The dispatcher moved the ticket to In
Documentation and removed `needs-real-claude`. The tier's file/spec count is unchanged at 19 tests in
19 files — `real-claude-permission-modal.spec.ts` was modified, not added — so no
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor change is owed.

Getting here took three gate reworks, recorded in the plan's Revisions for the mechanism, not repeated
here: the first live attempt (`98627c7`) found the checkbox absent because the installed dedicated test
binary predated upstream #2365's grant/mixed-offer fixes; #1413's running-daemon mint-order fix (below)
then briefly reddened all 19 specs at fixture setup for an unrelated pairing-contract reason and was
absorbed via merge; the final rework (`e49ea05`) dropped a 120s post-Cancel `turnEnd` wait whose premise
was wrong — the daemon has no `modal_cancel` coverage for the stdio-permission-prompt path, so nothing
upstream proves what a cancelled prompt resolves to, and AC4 does not require it. That specific daemon-
side observation (a cancelled stdio permission prompt produces no `turn_end` within 120s) is out of
scope for this client repo and unrepeated here; it is recorded for the maintainer in the plan and PR.

**#1413 (2026-09-13/14) — the real tier's device credential now mints from the running daemon, not offline.**
Upstream pyrycode#2393 (daemon `8a850505`) turned bare `pyry pair` into a running-service operation, which
had reddened the whole tier at fixture setup (`pyry pair exited with code 1 … connect: no such file or
directory`, first seen on the #1409 gate run against PR #1412). [real-claude-liveness-e2e.md](real-claude-liveness-e2e.md)
§ "Fixture chain and teardown" and § "Daemon spawn — the load-bearing flags" carry the mechanism: the
fixture now seeds the registry, spawns the daemon, waits for its control socket, and only then mints —
**the tier now requires a daemon carrying pyrycode#2393.**

The dispatcher's authenticated gate ran twice on this ticket's PR (#1415):

- **`c9da89b`** — 19 executed, 18 passed, 1 failed. The one failure,
  `real-daemon-add-workspace.spec.ts` at a strict-mode-ambiguous `getByRole('textbox')` locator, was a
  pre-existing drift from #1372 that this repair merely *unmasked* (the tier had been dead at setup since
  pyrycode#2393 shipped, so nothing had exercised that spec since), not a regression from this ticket's
  fixture change. Fixed in the same PR at `c876bc9` by qualifying the locator's accessible name (see
  [#1414](https://github.com/pyrycode/pyrycode-desktop/issues/1414)).
- **`c876bc9`** — not yet re-run through the dispatcher's authenticated gate as of this writing; the
  builder's own credential-light local run (`spawnClaude:false` specs only) came back 8 passed, 1 skipped
  (the credential-gated `real-daemon-history-on-open.spec.ts`), 0 failed. The next full authenticated run
  on this commit or later is the one that closes out AC2's live-tier confirmation.

Daemon source revision used for the fixture repair's own RED→GREEN proof and for the builder's local runs:
the dedicated test binary `pyry dev-8a850505` (clean revision `8a850505170c4041b852d899f60601c100894fb1`),
kept deliberately pinned per the ticket's operator direction rather than tracking the daemon's tip. The
dispatcher's own authenticated gate run does not record its daemon's source revision in its evidence —
that provenance gap is unchanged by this ticket, same as the one #1371 already noted below.

**#1371 (2026-09-12) — 19 tests executed, 19 passed, none failed or skipped.**
The [dispatcher evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1371#issuecomment-5648697088)
records branch `c318680328` against main `9304c4d46d`. The added
`e2e/real-daemon-add-workspace.spec.ts` ran successfully at 21:07:28 UTC in 1.454s
(retry 0), confirmed in the gate's per-test JSON log
`2026-09-12T21-06-02-455Z_real-claude-gate_#1371.log`.

This adds one real-tier test using `spawnClaude: false`: initially absent parent and
nested destination paths must become directories, then a second chat must reuse the
same destination device/inode. Both creates also require new active-chat identity and
an authoritative workspace row. See [Add workspace testing](add-workspace-dialog.md#rendering-and-testing)
for why an echoed folder or unchanged `Untitled` label cannot establish these results.
The real spec submits an absolute path; two-host relative preview/send agreement is
covered by the fake tier.

The required daemon includes pyrycode#2378. Neither the linked gate evidence nor its
JSON log records the daemon source revision, so that provenance remains an operator
follow-up. The recorded configured floor is still **10**; raise
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` to **19** for this suite. This documentation records
the executed pass, not completion of the daemon-revision or floor-adjustment handoffs.

**#1266 (2026-09-08) — a spec-only flake fix, tier count unchanged at 16.** `real-claude-effort-default.spec.ts`'s read of the seeded chat's effort segments used to depend on the daemon's unsolicited, best-effort `model_list` push landing inside the 15 s round trip, because the drive's only ask for that chat's vocabulary went out *before* turn 1 — when the bootstrap session had no claude child yet to answer with one. A lost push presented as a stale-daemon timeout with no daemon fault behind it: the 2026-09-07 19:31 UTC red and the 20:01 UTC green were the same `pyry` binary. The fix re-clicks the already-open seeded row between turn 1's quiesce and the sheet open, which re-fires `requestModelList` through `activateConversation`'s changed-id-gated `requestConversationConfig` without disturbing the settled turn or the run configuration — a caused request, not a retry loop. See [composer-effort-menu.md](composer-effort-menu.md) for the mechanism and [PR #1280](https://github.com/pyrycode/pyrycode-desktop/pull/1280). **Nothing here changes `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED`** — no spec was added or removed.

**#1259 (2026-09-07) — the tier grows to 16 specs.** `e2e/real-daemon-history-on-open.spec.ts` is the
liveness proof for [opening a conversation asking for its newest page of
history](conversation-timeline-store.md): it pairs against a real `pyry`, opens a conversation, sends a
marker message, waits it drawn, archives the active conversation (routing through
`exitActiveConversation`'s `clearTimelineFor` — the `.conversation` 1→0 delta is the positive observable
that the exit actually ran), restores it from the Archive view, re-opens it, and asserts the marker draws
again **with no second send** — the reload-based approach the architecture spec first proposed was
rejected after reading `conversationListBridge`: the conversation list refreshes only on the `connected`
*edge*, which a `page.reload()` cannot reliably reproduce against a live daemon. **`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED`
needs bumping to 16** — the bump is the operator's, per § Automated coverage below.

The first gate run reddened at the very first assertion (`.channel-list__rename` not found in 45s) because
the spec's prose called its seed "promoted" without ever declaring `test.use({ seedPromoted: true })` — the
fixture's default is `false`, and `test.use` additions are silent, so the missing option was invisible to
everything except the gate run itself (no typecheck or lint covers `e2e/`). The second correction moved the
send barrier off the composer's optimistic echo: a claude-less rehearsal showed the marker landing as a
queued backlog row rather than a bubble whenever the bound session already reports a running turn, and
reading the daemon settled why — `newOperatorMessageHistory` is wired as the send queue's `OnDelivered`
callback, so the operator's turn reaches the on-disk log **on delivery to claude, not on receipt**. The spec
now polls `real-claude.spec.ts`'s `nonEmptyAssistantCount`, base-relative, as the barrier a completed reply
proves. Both corrections are spec-only; no production code changed. See PR #1261's "Lessons learned" for
the full account.

**#1218 (2026-09-07) — the tier grows to 15 specs; the floor is already stale by two.**
`e2e/real-claude-new-session.spec.ts` is the liveness proof for the [New session control
action](conversation-shell-actions-menu-and-reader-cutover.md#new-session-control-action-1218-folded-to-the-menus-only-reset-row-by-1496): pair,
create through the FAB, send one real turn to give the daemon a child to rotate, capture a
`nonEmptyAssistantCount` baseline **after** that turn quiesces (the vacuous-`>= 1` trap below applies
here too), pick New session, assert exactly one `.session-delimiter`, send a second message and assert
the count rises above the baseline. **The row this spec picks is named New session only historically** —
[#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) folded the menu's two reset rows into
one, renamed this one's label to **Reset session** and moved it first; the spec's locator and prose
followed, with no change to what it proves or to the tier's floor. **Not yet run live** — `real-*.spec.ts` is `testIgnore`d by the
default config, nothing in this ticket's own gate loads it, and it was verified only by an ad-hoc
`tsc --noEmit`. `origin/main` already carried 14 `real-*.spec.ts` files at `373ae70` against the floor of
13 recorded below (itself already stale by one, the same drift #1055's note two entries down describes),
and this ticket's addition makes 15. **`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` needs bumping to 15** — the
bump is the operator's, per § Automated coverage below.

**Last run: 2026-09-04 — the tier grew to 13 specs.** `e2e/real-claude-attachment.spec.ts` ([#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055)) is the live proof that an attached file
actually reaches claude: it pairs against a real spawned daemon, creates a conversation through the UI,
drives one **cursor-stamp turn** first (an ordinary message, drained to quiesce), then stubs
`dialog.showOpenDialog` to answer a real solid-red PNG on disk, attaches it through the production upload
path, sends a message asking claude to name the image's dominant colour, and polls the assistant rows —
stripped and skip-offset past the stamp turn's own reply — for a **word-anchored** `/\bred\b/i`. The
assertion is on the reply's text, never on client state, which is the point: a client that renders the
attachment perfectly and sends no `attachment_ids` passes every other tier in this repo and fails only
this one.

**The cursor-stamp turn is load-bearing, not incidental, and was discovered by a failing live run.** An
`attachment_chunk` carries no conversation id by design — the daemon files a completing upload under its
follow-active cursor, which its `send_message` relay handler stamps only on the successful-route path;
creating a conversation does not stamp it. The first live run of this spec attached immediately after
conversation creation and died 123 polls into "The host could not store the file." (`attachment.storage_failed`), with the drive never reaching the picker stub at all. Upstream's daemon-side twin rides the identical prior-turn precondition — see `pyrycode` `docs/specs/architecture/2039-live-attachment-read.md` § Sequence step 2. **The operator hits the same wall** — attaching to a brand-new discussion is an ordinary flow and fails identically — filed separately as [#1076](https://github.com/pyrycode/pyrycode-desktop/issues/1076); not fixed here, since the remedy is an unmade UX decision and this ticket's scope is the spec, not the precondition.

The tenth interactive spec (the entry directly below, #929) still reads "11" as the prior state at the
time it landed; that count was **itself already stale by one**, since #1067's `desktop-isolation.ts`
landed between #929 and #1055 with no `real-*` spec of its own (a harness fix, not a tier addition) —
`origin/main` carried 12 `real-*.spec.ts` files by the time #1055 branched, measured directly rather than
transcribed from this section. **The
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor below (§ Automated coverage) needs bumping to 13** to match.

**Last run: 2026-09-04 — the tier grew to 11 specs and holds green.** The tenth interactive spec,
`e2e/real-claude-question-cancel.spec.ts` (#929), landed as the refusal twin of #928's answer arm on
the same question vertical: it drives a live claude into refusing its own `AskUserQuestion` batch
through Cancel, then proves the gated work left no artefact via a recursive post-quiesce walk of the
daemon's workdir, contained by an allow arm on any permission modal raised after the refusal so the
absence cannot be the permission gate's own doing. Second consumer of the `claudeModel` and
`requiredCapabilities` fixture options after #928 (see
[real-claude-liveness-e2e.md](real-claude-liveness-e2e.md)). **The untracked
`PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor below (§ Automated coverage) needs bumping from 10 to 11**
to match — this note is the "PR that adds a `real-*` spec must say so" the floor's own bullet asks for.

**Last run: 2026-09-02 — the tier grew to 10 specs and holds green.** The ninth interactive spec,
`e2e/real-claude-question-answer.spec.ts` (#928), landed and passed on its first live execution
against `claude-sonnet-5` — the round trip from a real `AskUserQuestion` batch through the panel back
to a resumed turn, previously proven only against a scripted `daemon.pushFrame`
([question-panel-continue-answer.md](question-panel-continue-answer.md)).

**That same run surfaced a routing bug in the tier partition itself**, unrelated to the spec's own
liveness proof. The dispatcher's gate on the landing commit came back red with 2 failures out of **66
executed**, against a tier that holds 10. Both `playwright.config.ts`'s `testIgnore` and
`playwright.real-claude.config.ts`'s `testMatch` matched `/real-.*\.spec\.ts$/` against the
**absolute** file path, and `.*` spans `/` — so the pattern matched every spec in the tree whenever
any *ancestor directory* was named `real-…`, which the dispatcher's own `real-claude-gate-<N>`
worktree always is. Both reported failures were specs that had no business being collected under this
config at all: one was a fake-tier spec caught only by the path bug and never actually broken, the
other a pre-existing failure on `real-daemon-session-settings.spec.ts` (filed as
[desktop#941](https://github.com/pyrycode/pyrycode-desktop/issues/941), reproduced against
`origin/main` and structurally unrelated to #928's change). The inverse direction was the more
dangerous half: in that same worktree the default config's `testIgnore` would have ignored all 66
specs and exited 0 on a suite that never ran. Both patterns are now
`/(^|\/)real-[^/]*\.spec\.ts$/` — anchored to a path boundary, held inside one filename segment — so
the partition depends on the filename alone, which is what both configs always claimed. Verified by
`playwright test --list` under both configs in a throwaway ordinarily-named worktree, where the fix is
a no-op: 10 tests under the real-claude config, 56 under the default, unchanged from before.

**Red from 2026-09-02 ~21:00 to 2026-09-03, owned by #975, fixed by #987.** PR #982 (issue #975) deleted
`MODEL_CATALOG`: the run-config sheet's Model rows became exactly the entries of the daemon's published
`model_list` frame, which the daemon emits only from claude's own model announcement. `real-daemon-session-settings.spec.ts` is deliberately claude-less (`spawnClaude: false`), so no announcement is ever made
and the rows could never appear — the spec failed at the first sheet read, parking the whole
all-or-nothing floor. The break was first surfaced by issue #962's gate run at 22:57 that same day (10
executed / 9 passed / 1 failed); with no baseline command configured the gate attributed it to
`feature/962` by default, but it reproduces identically on `origin/main` through the untouched trigger
\#962 later replaced. #987 re-keyed the round-trip onto the YOLO switch, the one run-config control that
takes no published rows (detailed in
[real-daemon-credential-light-e2e.md](real-daemon-credential-light-e2e.md)), restoring the floor to
10/10 with no spec change needed elsewhere.

Prior state, retained as history: the daemon's production interactive runner has been **stream-json**
since 2026-07-24 — claude is driven over a structured stdin/stdout stream, not a PTY. The four
interactive real-claude specs that existed at the time (send/stream, interrupt, permission-modal,
queue-drop) migrated onto the stream runner in
[#490](https://github.com/pyrycode/pyrycode-desktop/pull/490) (merged), first going fully green
2026-07-26 (8 passed / 0 failed) after the last red, **queue-drop**, was fixed by pyrycode#1199 (a
drain race, not a missing message). The four claude-less `real-daemon-*` specs were already green
throughout. The PTY-era diagnosis previously recorded here — `DetectModalClass` returning Unknown on
the live session buffer — is historical: it described the PTY runner's modal detection, which the
stream-json migration made moot for this gate.

