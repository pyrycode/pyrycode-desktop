# 928 — prove a question answer round-trips to a live claude

## Files read

- `e2e/real-claude-permission-modal.spec.ts` → the whole file — the tier-3 shape this clones: `test.use` fixture trio, the pairing precondition, UI-created conversation, DOM-only assertions. Its header's closing instruction ("do NOT strengthen into a causation proof by asserting reply content") is the one thing that does **not** transfer; § Design says why.
- `e2e/real-claude.spec.ts` → `nonEmptyAssistantCount`, `ASSISTANT_ROW`, `CURSOR_CHAR`, `CURSOR_SELECTOR`, `HANDSHAKE_TIMEOUT_MS` — the cursor-stripping reader and the quiesce signal this spec reuses rather than re-derives.
- `e2e/question-answer-continue.spec.ts` → the whole drive — the fake-tier twin. It pins the panel surface (`.question-panel`, `.question-panel__continue` reading Next then Continue, `.question-panel__option`) and the optimistic clear, which is exactly why the clear cannot be this spec's proof.
- `e2e/fixtures/realDaemon.ts` → `RealDaemonOptions`, the `test.extend` option defaults, and the `args` array that hardcodes `'--model', 'haiku'` — the single line AC 3 changes.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → the render body — `.question-panel__option-label` is a `<p>` inside the option `<label>`, and the trailing **Other** row is a `.question-panel__option` that carries **no** `-label` child. That asymmetry is what makes `-label` (not the row) the honest locator for "an offered option".
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `QuestionPanelSlot` — `jumpedTo` starts at `FIRST_QUESTION_INDEX`, so the question the panel shows on arrival is index 0: the focus question, the same index the daemon-side twin checks.
- `~/Workspace/Projects/pyrycode` `internal/e2e/realclaude/interactive_stream_question_answer_test.go` → `questionAnswerTrigger`, `chooseQuestionAnswers`, `requireContinuationNamesChoice`, `questionSurfaceBudget`, `askQuestionCaptureModel` — the merged daemon-side twin (pyrycode#1987). Every constraint below is transcribed from it rather than rediscovered on live runs.
- `docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state → the tier is fully green as of 2026-07-26 on the stream-json runner, and the all-skip-exits-0 hazard that `e2e:real:gate` closes. Read-only; the documentation phase owns it.
- `docs/knowledge/features/conversation-shell-question-panel.md` → the panel's store seams and the optimistic-clear ordering.

## Design source

**Figma:** N/A — this ticket adds one Playwright spec and one fixture option. Zero production `src/` change, no rendered surface is created or altered, so there is no visual-fidelity check to skip.

## Context

Every question-vertical slice upstream of this is proven against the fake transport only. `e2e/question-answer-continue.spec.ts` drives the whole Continue path, but against a scripted `daemon.pushFrame` and an in-process capture of the outbound frame. No question answer has ever been measured reaching a real claude from this app, and two failure modes are invisible to the fake tier: the per-device remote-permission gate (pyrycode#702) denies silently and leaves the batch outstanding, and a payload the fake daemon accepts can be dropped by the real one with no reply, no error envelope and no `question_dismissed`. From the window both look identical to a send that never left — the panel clears optimistically either way.

No ADR is warranted: this adds no decision, only a live gate over decisions already recorded.

## Design

One new spec, `e2e/real-claude-question-answer.spec.ts`, and one additive option on the existing real-daemon fixture. The `real-` filename prefix does all of AC 4's routing: `playwright.config.ts` carries `testIgnore: /real-.*\.spec\.ts$/` and `playwright.real-claude.config.ts` the matching `testMatch`, so no configuration changes.

### The fixture option (AC 3)

`RealDaemonOptions` gains `claudeModel: string`, defaulted to `'haiku'` so every existing real-* spec keeps its byte-identical args. The `args` array's hardcoded `'--model', 'haiku'` reads the option instead. This spec sets `claudeModel: 'claude-sonnet-5'` — the model the daemon-side twin runs both its question gates under, and the only one under which a live `AskUserQuestion` call has been measured in either tree. Same single-consumer shape #432 used for `skipPermissions`.

The `test.use` trio otherwise matches #432 and is load-bearing for reasons distinct from it: `skipPermissions: false` (the approval routing that parks the question at all — with `--dangerously-skip-permissions` the call auto-runs and nothing surfaces), `interactiveRunner: 'stream-json'` (production's runner; the PTY path cannot surface an answerable prompt), `allowRemotePermissions: true` (the pyrycode#702 device gate `questionResolverV2.ResolveAnswer` fails closed on).

### The trigger

A module-level function returning `questionAnswerTrigger`'s prompt with a per-run nonce, transcribed from the daemon-side twin. Every constraint is carried, and none is stylistic:

- **Names the tool.** This slice measures the round trip, not claude's propensity to reach for it.
- **Demands a single choice.** A question claude emits without the `multiSelect` key is rejected by `questionbridge.Parse` and falls through to a permission modal this spec never answers, parking the turn until the approval window elapses.
- **Asks for four options.** Widens the space a guessing continuation would have to hit; both 2 and 4 sit inside Parse's 2–4 bound.
- **Carries no path, no filename, no "in this repo".** Keeps a claude-authored question from quoting the temp worktree path into a salvaged run log.
- **Names no option and no preference,** so the choice is unpredictable from the prompt — the property the whole continuation proof rests on.
- **Instructs the reply to be only the exact chosen label.** That instruction cannot leak the choice: the labels do not exist until claude writes them.

The nonce is never asserted on.

### The drive

Precondition is `real-claude.spec.ts`'s verbatim: pair against the freshly-spawned daemon over the test relay's `/v1/client` leg, wait for the seeded row (the connected gate), create the conversation through the New-discussion FAB, wait for Send enabled. Then fill the composer with the trigger and send.

1. **Surface and non-vacuity (AC 1).** Wait for `.question-panel` with a 180s budget — the daemon-side twin's `questionSurfaceBudget`, deliberately wider than #432's `MODAL_TIMEOUT_MS` because this gate runs a larger model. Then read `.question-panel__option-label` texts on the shown question (index 0 = the focus question, `QuestionPanelSlot`'s starting `jumpedTo`) and assert at least two. A batch that never surfaced deadlines the wait; one that surfaced empty fails here rather than letting a later assertion pass over nothing.
2. **The choice.** Chosen = the **last** label; unchosen = the rest. Last is unpredictable from the trigger and is not the position a restating claude leads with.
3. **Step the whole batch (AC 2).** Question count comes from `.question-panel__labels button` (`max(count, 1)` — a one-question batch draws a bare `<span>` and no tabs). For each question: click its last `.question-panel__option-label`, then assert the trailing `.question-panel__continue` reads `Next` and click it — except on the last, where it must read `Continue`. Stepping the batch to its end rather than answering the first is required twice over: the trailing control only enables once every question holds a value, and the daemon rejects an entry count that is not exactly the parked question count before assembling anything.
4. **Continuation (AC 2's proof).** Snapshot the assistant text before clicking Continue, click, wait for quiesce (`.bubble__cursor` count 0), read the assistant text again and take the suffix. Assert the chosen label appears in it, case-insensitively as a substring, and **before** every unchosen label of the focus question — skipping any sibling that equals the chosen one, since two options can spell the same label and are then indistinguishable in text.

**Why reply content, against #432's instruction.** #432 forbids it because a permission-gated Write leaves a file on disk, so the tool effect is the proof. This slice has no such effect — the trigger forbids writing code and every other tool — and what must be shown is that the *answers map* reached claude, which is observable only in what claude says next. The first-among rule is what keeps that from being vacuous: a claude that never read the answers can still restate its own question (it authored the labels) and a restatement lists them in offer order, where the chosen one was deliberately put last. "You chose &lt;last&gt; rather than &lt;first&gt;" passes; "the options were &lt;first&gt;, &lt;second&gt;, …" fails.

The panel clearing proves nothing and is not asserted as the proof: it clears optimistically, before any daemon frame answers.

### Helpers

- `assistantText(page)` — the concatenated text of `[data-thread-role="assistant"]` rows with the streaming cursor stripped, `real-claude.spec.ts`'s `nonEmptyAssistantCount` reader generalised from a count to the text it already computes.
- `continuationOf(before, after)` — `after` minus its `before` prefix. The pre-answer text is stable while the turn is parked on the tool call, so the suffix is exactly what arrived after the answer. If the prefix invariant ever fails the whole text is used instead: that can only add earlier positions for unchosen labels, so the fallback reddens and never greens.
- `expectNamesChoiceFirst(continuation, chosen, unchosen)` — the ordering assertion, `requireContinuationNamesChoice`'s rule.

## State + concurrency model

No app state and no store: the spec drives the shipped window through the DOM. Every long-lived resource is the existing fixture chain's — relay → daemon → page, LIFO teardown, the daemon subprocess reaped as a process group in `finally`. The added option changes one array element and owns nothing. The only concurrency the spec reasons about is the parked turn: the assistant text is read once while the turn is blocked on the tool call and once after `turn_end`, and quiesce is the boundary between them.

## Error handling

There is no product error path here; the spec's failure modes are its diagnostics.

- A surface timeout means claude never called `AskUserQuestion` under this model, or `questionbridge.Parse` rejected the batch and it fell through to a permission modal nothing answers. Genuine red, not a flake to soften.
- A quiesce timeout after Continue means the answer never closed the loop. **A denied answer and a swallowed send look identical from the window** — the daemon's audit record (`denied_unauthorized`) is what tells them apart, and `PYRY_E2E_DAEMON_LOG=<path>` tees daemon stderr for the whole run. That is the first thing to check.
- A continuation that names an unchosen label first is the vacuity the slice exists to catch.

Claude-authored text a failure message must print (the chosen label, the continuation) is bounded and quoted, never interpolated raw: nothing on this path strips terminal escapes and the pipeline salvages run logs.

## Testing strategy

The deliverable *is* the test; no vitest change. RED is structural rather than a local run — the spec cannot execute on the pipeline machine (no `pyry`, no `claude`, no credential), so it skips there by design, which is AC 4's own requirement. What is verified locally: `npm run build` (the fixture edit typechecks), and `npx playwright test --list` under both configs to prove the routing — present under `playwright.real-claude.config.ts`, absent under the default. Live execution is the operator's `npm run e2e:real:gate`, whose all-skip → non-zero behaviour is what makes AC 4's last clause hold.

## Open questions

- **OQ-a — does a live `claude-sonnet-5` reliably emit a four-option single-select batch?** The daemon-side twin measured it once (2026-09-02). If it proves flaky the trigger is the tuning knob, not the assertion.
- **OQ-b — one row or two?** Whether the continuation lands as a new `[data-thread-role="assistant"]` row or appends to the pre-question one is unmeasured. The prefix-suffix reader is deliberately agnostic to that, which is why it was chosen over "read the last row".

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and the category is the design's centre rather than a formality. Everything the spec reads out of the panel — question text, headers, option labels, descriptions, and the continuation — is **claude-authored bytes that crossed the subprocess trust boundary**, and the daemon neither bounds nor sanitises them. The design never spells any of it into the spec (locate by structure: `.question-panel__option-label`, `.question-panel__continue`, `.question-panel__labels button`), never puts it in a lookup path, and prints it only bounded and quoted. It stays inside Playwright's own string handling and reaches no sink.
- [Tokens] No findings. The `answer_token` is minted main-side by `daemonConnection.answerQuestions` and never composed or held by the renderer; over the real stack the daemon is a separate process behind the content-blind relay, so there is no in-process outbound-frame capture at all and the token cannot enter a spec array, a `toEqual` diff or a failure diagnostic. The pairing payload is built the `real-claude.spec.ts` way from `daemon.pairFields` and never echoed into a message or an error.
- [File / storage] No findings — the spec writes no file and reads none. #432 needed `existsSync` on `daemon.workdir` for its tool-effect proof; this slice's trigger forbids every tool, so there is no filesystem path in the design and no TOCTOU window. The fixture's temp dirs (mode `0700`, reaped in `finally`) are unchanged.
- [Electron attack surface] No findings — zero production `src/` change, so no window, `webPreferences`, `contextBridge` API or `ipcMain` channel is added or altered. The spec drives the built app exactly as shipped.
- [Cryptographic primitives] Not applicable, and deliberately so: this spec exercises the real `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake end to end rather than touching it. Nothing here constructs a key, a nonce or a comparison. `Date.now()` seeds the run nonce, which is a cache-defeating label, never a security value, and is never asserted on.
- [Network & I/O] SHOULD FIX, and it is a *deadline* finding rather than an exposure one. Three waits bound hostile-or-slow behaviour: 180s to surface, and the existing turn budget for quiesce. The one to get right in Phase B is that **no wait is unbounded** — an `expect.poll` without an explicit `timeout` inherits the spec timeout and would turn a genuine liveness red into a spec-level hang whose message names nothing. Every wait carries its own timeout and a message naming what did not happen. The relay is the loopback fake (`ws://127.0.0.1`, the #97 dev affordance on an unpackaged build), not the live one; the allowlist path stays the runbook's manual gate.
- [Errors / logs] No findings by construction. Assertions read DOM text, visibility and counts only. The desktop transport is log-free (#62) and the daemon's stderr tee is opt-in via `PYRY_E2E_DAEMON_LOG`, content-free by construction. Trace, screenshot and video stay disabled — `playwright.real-claude.config.ts` already disables all three, which matters more here than on any sibling: a screenshot of this surface would capture claude-authored question text.
- [Concurrency] No findings — the spec launches no async task of its own. The fixture chain owns the relay, the daemon subprocess (reaped as a process group on success, failure and setup failure) and the Electron app, and the ordering forces the window closed first so its supervisor cannot churn-reconnect on the drop.
- [Threat model] The relevant desktop threat is **a hostile daemon response**, and this spec is a consumer of the shipped defence rather than a place to add one: the panel renders claude-authored strings through React children only, keyed by array index rather than by label, which `questionBatches.ts` and `QuestionPanel.tsx` record by hand. Out of scope, named: the **live-relay** allowlist path (this dials a local fake relay — `scripts/live-drive.mjs` and the runbook cover it), the **per-device denial arm** (pyrycode#702's hermetic tests own it; this harness pairs *with* `--allow-remote-permissions` precisely so the gate passes and the round trip is observable at all), and the **refusal arm** (pyrycode#1995).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
