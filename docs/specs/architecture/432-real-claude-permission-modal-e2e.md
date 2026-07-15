# #432 — real-claude e2e: permission modal over the real stack

Tier-3 real-claude e2e — the deepest liveness net in the suite. It exercises the whole
interactive-permission chain end to end: real `pyry` daemon → real claude actually blocking on a tool
permission → the daemon relaying `modal_shown` to the remote desktop → the desktop answering "allow" →
the tool running → the turn completing. Every prior modal test *scripts* the modal (the unit tests and
the fake-stack twin `permission-modal-answer-paths.spec.ts` push a frame). This proves ONE answer path —
allow — over the REAL chain, where `modal_shown` is emitted by a real daemon relaying a real claude tool
prompt, not a `daemon.pushFrame`.

**Zero production `src/` change.** Structurally identical to the merged siblings #445 (interrupt) and #446
(queue-drop): a new `real-*` spec that drives already-shipped surfaces as a black box, plus one additive,
single-consumer per-spec fixture option. Size **S**.

## Files to read first

- `e2e/real-claude.spec.ts` (whole, ~148 lines) — **the clone base.** Copy the precondition VERBATIM
  (pair against the freshly-spawned real `pyry` → Channel-List `.channel-list__row-open` gate → New-discussion
  FAB → `.conversation` visible → `Send` enabled) and the `ASSISTANT_ROW` / `CURSOR_CHAR` /
  `CURSOR_SELECTOR` constants, the `HANDSHAKE`/`TURN`/`SPEC` timeouts, and the `nonEmptyAssistantCount`
  helper. Swap only the turn body.
- `e2e/real-claude-interrupt.spec.ts` (whole, ~177 lines) — **the closest structural sibling** (merged, on
  `main`). Its header doc block enumerates the real-claude divergences from a fake twin (NO `daemon.pushFrame`;
  NO outbound frame capture; DOM-only; the DOM-only-causation accepted limitation). Mirror that doc discipline.
  Its quiesce logic (`.bubble__cursor` count-0 = `turn_end`) is the pattern this spec reuses to prove "the
  turn completes."
- `e2e/permission-modal-answer-paths.spec.ts:161-256` — **the fake-stack twin.** Reuse the modal selectors:
  `page.getByRole('dialog')`, scoped `dialog.getByRole('button', { name })`, and the allow →
  (confirm sub-step) → clear click shape. ⚠ The twin *controls* the option labels (`Allow`/`Deny`) and the
  `default_option_id`; over the real stack those are **daemon-supplied** — see Design § "Answering allow".
- `e2e/fixtures/realDaemon.ts:82-111` — `RealDaemonOptions` type + the option-fixture pattern
  (`spawnClaude`/`seedPromoted`). Add `skipPermissions` here, same shape.
- `e2e/fixtures/realDaemon.ts:262-274` — the spawn-args array; line 273 hardcodes
  `--dangerously-skip-permissions` in the post-`--` claude flags. Gate that single flag on `skipPermissions`.
- `e2e/fixtures/realDaemon.ts:119-220` — the skip-gating + the **OAuth-path** trust pre-seed (`.claude.json`
  `projects[workdir].hasTrustDialogAccepted` + `.claude/settings.json` `skipDangerousModePermissionPrompt`).
  Understand why `skipPermissions:false` relies on this pre-seed (Open Questions § OQ-d).
- `src/renderer/src/screens/conversation/PermissionModal.tsx:34-130` — `PermissionModalView`: list mode
  (leading `Cancel` + one button per daemon option, the default carries `--default`) vs confirm mode
  (`Back`/`Confirm`). Confirms which labels are **client-owned** (`Cancel`/`Back`/`Confirm`, deterministic)
  vs **daemon-supplied** (the option labels + which is default).
- `src/renderer/src/screens/conversation/modalResolution.ts:72-82` — `selectOption`: clicking the option
  whose id === `defaultOptionId` answers straight-through (one tap); any **non-default** option is held
  pending a second `Confirm`. This is why the answer sequence must resolve a possible confirm sub-step.
- `src/main/daemonConnection.ts:848-855` — the app advertises `CAPABILITY_INTERACTIVE` at hello, whose
  vocabulary explicitly includes "modal prompts" — that is what makes the daemon relay claude's permission
  prompt to the remote desktop instead of resolving it PTY-side. Confirms: no new client wiring.
- `playwright.real-claude.config.ts` (whole) — `testMatch: /real-.*\.spec\.ts$/`, `retries: 0`, and NO
  trace/screenshot/video (the secret-hygiene AC is enforced deterministically here).
- `playwright.config.ts:14` — the default-`e2e` `testIgnore: /real-.*\.spec\.ts$/` (why the new spec is
  excluded from `npm run e2e`). `package.json:16-17` — the `e2e` / `e2e:real-claude` scripts.

## Context

The permission modal is the last modal surface never proven over the real stack. The client wiring is fully
shipped and fake-stack-proven:

- **`CAPABILITY_INTERACTIVE` at hello** (`daemonConnection.ts:855`) tells the daemon to open the v2
  structured stream and relay modal prompts to this interactive client — the "remote-permissions grant" is
  already advertised (#179). No new client wiring.
- **`PermissionModal` is mounted unconditionally** on the conversation surface (`ConversationScreen.tsx:201`)
  and renders whenever `modalStore.outstanding[0]` exists — driven purely by an inbound `modal_shown`, NOT
  gated on the interactive-timeline flip. So no un-inert step; the dialog renders the moment the prompt
  arrives.

What is NOT yet proven live: that the daemon build under test relays claude's *per-tool* permission prompt
as a `modal_shown` (vs. resolving it in the local PTY), and that answering "allow" from the desktop
completes the round-trip. That is exactly this tier-3 net's job — see Open Questions § OQ-a.

## Design

### New file: `e2e/real-claude-permission-modal.spec.ts` (~150 lines)

Clone `real-claude.spec.ts`, swap the turn body for a single permission-gated tool call answered "allow".

**Fixture config (file scope).** The only `test.use`:

```ts
test.use({ skipPermissions: false })
```

`spawnClaude` stays default `true` (real claude on `--model haiku`, full skip-gate on `pyry` + `claude` +
credential); `seedPromoted` stays default `false`. `skipPermissions: false` is what makes claude prompt on
the tool call instead of auto-running it.

**Constants** — clone verbatim from `real-claude.spec.ts`: `ASSISTANT_ROW`, `CURSOR_CHAR`,
`CURSOR_SELECTOR`, `nonEmptyAssistantCount(page)`, `HANDSHAKE_TIMEOUT_MS = 45_000`,
`TURN_TIMEOUT_MS = 120_000`, `SPEC_TIMEOUT_MS = 300_000`. Add one:

- `MODAL_TIMEOUT_MS = 120_000` — the wait for the first permission dialog after Send. Cold PTY claude must
  spawn, load the model, and reach the tool call; bound it as generously as one turn.

**The turn prompt** — a per-run nonce, content never asserted, engineered to force exactly one deterministic
tool call: *"Create a file named `<nonce>.txt` in the current directory whose exact contents are the word
`ok`. Use a single write and do nothing else — do not read or list any files first. run=`<nonce>`."* The
write lands in the daemon's `-pyry-workdir` (the harness temp workdir).

**Body sequence** (each step is one assertion group):

1. **Precondition (AC1)** — verbatim from `real-claude.spec.ts`: encode the pairing payload
   (`relay: ${relay.url}/v1/client`), paste → Pair → Confirm, wait for `.channel-list__row-open` (the
   connected gate), click **New discussion**, wait for `.conversation` visible + `Send` enabled.
2. **Send the one-tool-call prompt (AC3)** — fill the composer, click Send.
3. **CORE liveness proof (AC3)** — `await expect(dialog).toBeVisible({ timeout: MODAL_TIMEOUT_MS })` where
   `dialog = page.getByRole('dialog')`. This is the tier-3 assertion: the real daemon relayed claude's
   per-tool permission prompt as a `modal_shown`, and it rendered on the desktop as the answerable dialog.
   A timeout here is a **genuine liveness signal** (the daemon did not relay the prompt), not a flake — do
   NOT soften it (OQ-a).
4. **Answer "allow" (AC4)** — see § "Answering allow" below.
5. **Prompt clears (AC4)** — `await expect(dialog).toHaveCount(0, { timeout: MODAL_TIMEOUT_MS })`.
6. **The turn completes (AC4)** — the loop closes:
   - `await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })` — `turn_end`
     fired, i.e. the tool actually ran and claude finished. This is the effect-observable proof that answering
     "allow" let the tool run: with a permission-gated tool call, `turn_end` can only follow the tool running,
     which can only follow the allow. A timeout here means the answer never closed the loop (daemon stuck on
     the permission, or the tool hung) — a genuine red, do NOT soften.
   - `expect(await nonEmptyAssistantCount(page)).toBeGreaterThanOrEqual(1)` — a non-empty assistant reply is
     present after the dialog clears (AC4's stated signal).

Prefer this DOM proof over reading the written file back from the daemon workdir — the file-read couples the
test to the daemon filesystem (ticket's "architect's call").

### Answering allow (the one live-uncertain decision)

Over the fake stack the test *controls* the option labels and `default_option_id`. Over the real stack **both
are daemon-supplied** — the daemon relays claude's actual permission options (typically an affirmative like
"Yes"/"Allow" plus a decline), and which option is `default` is unknown. Two consequences the answer sequence
must absorb:

- **The affirmative label is unknown** → select it by a case-insensitive regex over the plausible affirmative
  vocabulary, scoped inside the dialog, first match:
  `dialog.getByRole('button', { name: /^(yes|allow|approve|accept|grant)\b/i }).first()`. The start-anchor
  keeps it from matching a decline like "No, and tell Claude…"; the client-owned `Cancel`/`Back`/`Confirm`
  buttons carry different labels and are not matched.
- **Which option is default is unknown** → clicking the affirmative either answers straight-through (if it is
  the default) or opens the client-owned confirm sub-step (if non-default, per `selectOption`). Resolve both:
  click the affirmative option, then click `Confirm` **iff** it appeared. `Confirm` is client-owned and
  deterministic; the sub-step transition is a synchronous local React state update, so it is present (or not)
  by the time the option click resolves:

  ```
  answerAllow(dialog):
    click the affirmative-option locator
    confirm = dialog.getByRole('button', { name: 'Confirm', exact: true })
    if (await confirm.count()) > 0: click confirm
  ```

  Keep it a small local helper (a few lines, not a full body). The regex + confirm-resolution are the two
  live-tunable knobs the operator adjusts on the first real run (OQ-b).

### Fixture change: `e2e/fixtures/realDaemon.ts` (~4 additive edits, single consumer)

A per-spec `skipPermissions` option, default `true` = current behavior byte-for-byte. It gates exactly one
flag and has exactly one consumer (this spec) — so per the single-consumer fixture-boundary rule it rides
in-ticket, mirroring the `seedPromoted` precedent (#439).

- `RealDaemonOptions` (line 90-93) — add `skipPermissions: boolean`.
- Option-fixture defaults (line 110-111) — add `skipPermissions: [true, { option: true }]` beside
  `spawnClaude`/`seedPromoted`.
- `daemon` fixture deps (line 119) — destructure `skipPermissions` alongside `relay`/`spawnClaude`/`seedPromoted`.
- Spawn-args (line 273) — gate the single flag:
  `...(spawnClaude ? ['--', '--model', 'haiku', ...(skipPermissions ? ['--dangerously-skip-permissions'] : [])] : [])`.

**Byte-for-byte preservation:** every sibling spec sets no `skipPermissions` override → default `true` →
identical args as today (claude-spawning: `['--', '--model', 'haiku', '--dangerously-skip-permissions']`;
claude-less: `[]`). `real-claude.spec.ts` / #440-443 / #445 / #446 stay green unchanged — the invariant the
#420 extraction and #439 additions established.

## State + concurrency model

No store change. The interactive stream, `modalStore`, `PermissionModal`, and the `modal_answer` outbound
path are all shipped and unit-/fake-e2e-proven; this spec is a black-box driver. The dialog renders purely
off `modalStore.outstanding[0]` from an inbound `modal_shown` (unconditional mount, no interactive-gating).

Concurrency/teardown is the #420 fixture's, unchanged: the `relay → daemon → page` fixture chain forces
LIFO teardown (page closes first so its supervisor cannot churn-reconnect), and `reapDaemon` SIGTERM→SIGKILLs
the whole detached process group so the real-claude grandchild dies with `pyry`. No new resource.

## Error handling

- **No real stack** → the fixture's skip-gate (`pyry` + `claude` + credential resolved before any resource)
  calls `testInfo.skip` → the spec is an unrun test, never a hard failure (AC1).
- **`modal_shown` never arrives** (step 3 timeout) → the daemon did not relay the per-tool prompt to the
  interactive client. This is the load-bearing liveness signal (OQ-a) — a genuine red to inspect, not a flake.
- **Turn never completes** (step 6 cursor-clear timeout) → the answer did not close the loop (daemon stuck on
  the permission, or the tool hung). Genuine red.
- **Startup trust dialog** on the API-key-only auth path (no OAuth trust pre-seed) → could deadlock the turn
  under `skipPermissions:false` (OQ-d).
- **Secret hygiene (AC5)** — every assertion reads DOM text / visibility / counts only; the prompt is a
  non-secret nonce literal, content never asserted; the pairing payload is built the `real-claude.spec.ts`
  way and never echoed into a message; trace / screenshot / video stay disabled by
  `playwright.real-claude.config.ts`.

## Testing strategy (gates the developer runs)

This spec IS the test; the gates prove it is well-formed and discoverable (it SKIPS in the pipeline — the
operator runs it live):

- **`npm run build`** clean (typecheck both sides + build) — the salvage gate. No `src/` change, so this
  proves the fixture edit typechecks.
- **`npm test`** (vitest) unaffected — vitest scans `src/` only, never `e2e/`; expect the current
  pass/skip counts unchanged.
- **Standalone typecheck for `e2e/`** — neither project tsconfig includes `e2e/` ([[e2e-not-typechecked-by-project-config]]).
  Write a temp `tsconfig.e2e-check.json` at repo root extending `./tsconfig.node.json` with `composite:false`
  and `include: [e2e, src/main, src/shared]` (+ `lib:["DOM"]`), run `./node_modules/.bin/tsc --noEmit -p
  tsconfig.e2e-check.json`, delete it after. Expect ZERO errors in the new spec / fixture — only the 4
  pre-existing benign `{...process.env}` `string|undefined` notes in the shared fixtures (do NOT "fix" them).
- **Discovery** — `playwright test --config playwright.real-claude.config.ts --list` LISTS
  `real-claude-permission-modal.spec.ts`; the default `playwright test --list` does NOT (the `real-*`
  `testIgnore`).
- **Skip-clean** — run under the real-claude config with `PYRY_BIN=/nonexistent` (or simply no real stack):
  the spec reports **skipped**, never failed.

⚠ **Fresh-worktree hazards** (from #445/#446): `npm install` first (`node_modules` may be absent); use
`./node_modules/.bin/tsc`, NOT `npx tsc` (the latter resolves a wrong/global stub).

## Open questions

- **OQ-a — load-bearing, discover live (not a ticket defect).** Whether the daemon build under test relays
  claude's *per-tool* permission prompt as a `modal_shown` to interactive clients, vs. resolving it PTY-side,
  is exactly what this net exists to prove. A red `real-*` here is a genuine liveness signal. Note the fixture
  already seeds `skipDangerousModePermissionPrompt` + trust-dialog acceptance to suppress claude's OWN
  *startup* dialogs; the per-tool permission prompt is the distinct behavior under test.
- **OQ-b — the affirmative label + default are daemon-supplied.** The `/^(yes|allow|approve|accept|grant)\b/i`
  regex and the conditional `Confirm` resolution are the two knobs the operator tunes on the first live run.
  If the daemon's affirmative uses vocabulary the regex misses, the step-4 locate fails cleanly (a red to
  adjust, exactly the intended live-discovery loop).
- **OQ-c — multi-tool-call risk (defer per evidence-based fix selection).** Haiku may split into >1
  permission-gated tool call, surfacing a second dialog after the first answer and stalling the turn. Not yet
  observed → the primary answers one prompt (the AC's single-tool-call intent). If a live run shows multiple
  prompts, wrap step 4-5 in a bounded allow-loop ("while a dialog is visible, answer allow") — a documented
  contingency, not baked in.
- **OQ-d — OAuth-path dependency.** `skipPermissions:false` removes bypass mode, so claude's *startup* trust
  dialog is suppressed only by the fixture's `.claude.json` trust pre-seed, which today runs on the **OAuth
  path only** (`realDaemon.ts:149-220`). The operator's documented real-claude setup uses the OAuth token
  (the fixture's own skip message steers Max-only Macs to it), so this is consistent. On an API-key-only host
  the startup trust dialog could deadlock the turn; generalizing the trust pre-seed to that path is out of
  scope here (a separate ticket if the operator hits it).
- **OQ-e — DOM-only causation (accepted tier-3 limit, cloned from #445).** DOM-only over the real wire cannot
  *prove* the turn ended BECAUSE of the allow. The mitigation is structural: the tool is permission-gated, so
  `turn_end` can only follow the tool running, which can only follow the answer. Do NOT try to strengthen it
  by asserting reply content.
