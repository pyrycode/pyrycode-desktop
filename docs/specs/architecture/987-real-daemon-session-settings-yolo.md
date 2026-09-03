# 987 — re-key the real-daemon session-settings spec onto YOLO

`e2e/real-daemon-session-settings.spec.ts` is red on `main` and parks the whole
`npm run e2e:real:gate` floor. Since #975 the Model rows are built from the daemon's published
`model_list` frame, which a `spawnClaude: false` spec can never receive. Re-key the round-trip onto
the one control that survives with no such frame, keep the spec claude-less, and keep it a liveness
test rather than a render test.

Zero production source files. One e2e spec.

## Files read

- `e2e/real-daemon-session-settings.spec.ts` → the whole spec — the file under change; its header
  states the claude-less argument and the SECRET HYGIENE invariant that must survive.
- `e2e/run-config-settings.spec.ts` → the `yoloSwitch` locator idiom
  (`getByRole('switch', { name: 'Auto-accept tool calls' })`) and the documented
  unmatched-row state (`.run-config__effort-current` present, `.run-config__effort-segment`
  count 0) that closes the Effort escape hatch.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `YoloSection` (the
  `role="switch"` element, `aria-checked`, `aria-readonly`, and `aria-busy` **on the switch itself**),
  `RunConfigView` (`onYolo` derived from the single `onChange`), and `RunConfigSections` (the
  container: `onChange` is built **only** when `isAddressableSessionId(sessionId)`).
- `src/renderer/src/store/runSettingsWriteStore.ts` → `selectEffectiveSettings` (pending overlay >
  client-confirmed override > snapshot base), `selectPendingFields` (the `aria-busy` source), and the
  `settingsConfirmed` / `settingsRejected` / `reconnected` arms — the three ways a pending marker
  can clear, only one of which also commits the value.
- `src/renderer/src/screens/conversation/RunConfigData.tsx` → `RunConfigData` — the one-shot
  `requestRunConfigSnapshot` per mount, which is what makes close-then-reopen a fresh read.
- `src/renderer/src/screens/conversation/runSettingsControls.ts` → `isAddressableSessionId`,
  `changeSetting` — the gate rule and the single-changed-field submit.
- `e2e/fixtures/realDaemon.ts` → `seedRegistry` (seeds no `settings` object, so the daemon's own
  default decides the initial YOLO — hence the read-then-flip design) and the `spawnClaude` branch.
- `docs/knowledge/features/real-daemon-credential-light-e2e.md` → the tier's provability rule and the
  record of #442's demotion. **This is the lesson that changes how the ticket is built**: the tier
  states a verb is provable here only if its daemon reply gates a visible DOM transition with no
  optimistic pre-render, and #442 (set-session-settings) was demoted for failing exactly that. The
  design below has to answer that objection explicitly rather than re-litigate it by accident.
- `docs/knowledge/features/run-config-store.md`, `session-settings-send.md` → the write machine's
  shipped contract.
- Upstream daemon, `~/Workspace/Projects/pyrycode`: `internal/relay/v2session_settings.go` →
  `handleSetSessionSettings` (always replies; validates before persisting; YOLO needs no value
  check) and `handleRequestSessionSettings`. `internal/sessions/pool.go` → `Pool.UpdateSettings`,
  `inBandDeliverable`, `deliverSettingsInBand`. `internal/streamsup/runner.go` → `Runner.Restart`,
  `Runner.SetPermissionMode`. Read to answer one question the ticket does not: **does a YOLO write
  reply promptly with no live claude child?**

## Design source

**Figma:** N/A — this ticket changes one Playwright spec and no production source file. There is no
rendered surface to compare against a design node, so the visual-fidelity check is intentionally
skipped.

## Context

The spec has been red on `main` since PR #982 (issue #975) deleted `MODEL_CATALOG`. The Model rows
are now exactly the entries of the daemon's published `model_list` frame, which the daemon emits from
claude's own announcement. This spec is deliberately claude-less, so no announcement is ever made and
the rows can never appear. It fails at the first sheet read. The gate is all-or-nothing, so one red
spec parks every `needs-real-claude` ticket.

The refiner already closed the obvious escape: PR #983 (issue #976) made `EffortSection` read the same
published rows through `publishedRowFor`, so with no frame there is no `.run-config__effort-segment`
to click either. YOLO is the one control that takes no `models` prop.

### The objection this design has to answer

`docs/knowledge/features/real-daemon-credential-light-e2e.md` records #442 — *dequeue +
set-session-settings* — as the tier's cleanest **negative** case, demoted without shipping because
"set-session-settings' confirmation never touches the DOM, optimistic-first". That is a direct
argument against the spec this ticket is repairing, and re-keying onto YOLO does not by itself
answer it.

It is answerable, and the answer is dated: **#558 put `aria-busy` on the switch element itself**, and
the pending marker that drives it is deleted only by a correlated reply. So the daemon's reply *does*
now gate a DOM transition. What it does not do is gate the *value* — `aria-checked` flips optimistically
on click. The design below is built on that distinction rather than around it.

Nothing here warrants an ADR.

## Design

One file changes: `e2e/real-daemon-session-settings.spec.ts`. No production source file is touched,
no new dependency, no fixture change.

### The trigger, behind one helper

The sheet is opened twice and both opens are load-bearing. On `main` the trigger is
`page.getByRole('button', { name: 'Run configuration' })`. Issue #962 (PR #986, open, already
`blockedBy` this ticket) retires that row and replaces it with a two-step overflow path. Both call
sites therefore go through **one** local `openRunConfiguration()` helper, so #962's rebase is a
two-line body swap in one place rather than a conflict per call site. This is a coordination
decision, not a stylistic one; see § Revisions if it changes.

### The write half — settled *and* still holding, never one alone

`selectEffectiveSettings` composes pending overlay > confirmed override > snapshot base, so
`aria-checked` alone is a render assertion. `aria-busy` alone is not enough either: `settingsRejected`
and `reconnected` both clear the pending marker without committing the value.

The assertion is therefore the **conjunction**, asserted as an ordered sequence over the switch:

1. after the click, `aria-checked` reaches the flipped value — the optimistic overlay, which the store
   sets in the same dispatch as the pending marker, so reaching this state also establishes
   `aria-busy="true"` unless the reply has already landed;
2. `aria-busy` clears — reachable only from `settingsConfirmed`, `settingsRejected` or `reconnected`,
   so a daemon that never answers times out here;
3. `aria-checked` is **re-asserted** at the flipped value *after* the settle — a reject or a reconnect
   rolls the overlay back to the confirmed/base value, so only a confirm survives all three.

Each of the three failure modes AC2 names lands on a distinct step: a lost write fails (2), a reject
fails (3), a missing handler fails (2) via the daemon's error reply. A fourth assertion — that
`.run-config__error` is absent — is carried as a direct, visually distinct discriminator of
confirm-vs-reject, mirroring the fake tier's rejection assertion.

The ordered sequence is chosen over a single composed poll deliberately: two `getAttribute` reads
inside one poll are not atomic, and a reject landing between them would read a stale flipped value
beside a cleared busy flag and pass. The sequence has no such interleaving because step 3 re-reads
after the settle.

### The direction of the flip

`seedRegistry` writes a session with no `settings` object, so the initial YOLO is whatever the daemon
defaults to. The spec **reads** the rendered `aria-checked` and flips it, rather than assuming
`false`. `YoloSection`'s handler submits `!yolo`, so the expected post-write value is the negation of
the observed one.

### The operability gate is also the read-arrival proof

`onChange` — and therefore `onYolo` — is `undefined` until `isAddressableSessionId(sessionId)`, which
renders `aria-readonly="true"` on the switch. Claude-less, the session id has exactly one ingress:
the `session_settings` reply itself, through `runConfigSnapshot`. So *`aria-readonly` clearing* is
proof the daemon answered the read, and it is the correct gate to wait on before reading the initial
value. The spec states that, and reads the initial `aria-checked` only after it.

### The read half, and what it does and does not prove

Closing unmounts the run-config container; `RunConfigData`'s one-shot ref is per-instance, so
reopening fires a fresh `request_session_settings`. The unmount witness moves from
`.run-config__model-row` (now always 0, so vacuous) to `.run-config__yolo`, which renders
unconditionally inside the sheet — the #441 lesson that a real-daemon "closed" assertion must target
an element whose presence does not depend on the round-trip under test.

**Stated honestly, and deliberately weaker than the sentence it replaces.** `confirmed` is an
app-level override that survives the sheet unmount, so the reopened switch reads
`confirmed.yolo ?? snapshot.yolo` and the two agree whenever the daemon really persisted. The
reopened value is therefore *not* provably snapshot-sourced. The old spec's comment claimed the
reopened mark "can only come from the daemon's reply — not from state the previous open left behind";
that was already untrue for `confirmed` before this ticket, and it is not carried forward. What the
reopen genuinely proves is the remount, the fresh request, and that the written value is what the
sheet reports — which is what AC3 asks for. The daemon-required half of the proof lives in the write
sequence above.

### Copy: the header comment

Rewritten per AC5 to record that since #975/#976 both the Model rows and the Effort segments are
built from the daemon's published list, so the claude-less tier can only exercise YOLO; that #558's
`aria-busy` is what answers #442's demotion; and the SECRET HYGIENE invariant, carried intact.

## State + concurrency model

No app state is added. Relevant to the spec's reliability:

- The write store's `reconnected` arm drops pending markers without committing — a relay blip during
  the round-trip surfaces as a step-3 failure, which is the correct (loud) outcome.
- `RunConfigLiveData` (#810) re-requests the snapshot on the connected edge and on turn-end edges. No
  turn runs here, and after the write `confirmed` masks the base, so a refresh cannot flip the
  asserted value.
- Daemon side, verified in the upstream tree so the spec is not built on hope: `handleSetSessionSettings`
  always replies and `Pool.UpdateSettings` releases `p.mu` before any live-apply. A YOLO **enable** is
  the escalation, so `inBandDeliverable` is false and it takes `sup.Restart(newArgs)`, documented
  non-blocking and fire-and-forget; a YOLO **revoke** goes in-band via `Runner.SetPermissionMode`,
  which returns `ErrNoLiveChild` when no child is live and is logged, not propagated. Both directions
  reply promptly with no claude child, which is the property the whole ticket rests on.

## Error handling

Spec-side only. Every failure mode is an assertion timeout with a distinct meaning, and the tier's
stance is that a timeout is a genuine liveness signal never to be papered over: no retry, no manual
re-request, no weakened assertion.

## Testing strategy

The spec *is* the test. Verification is AC1's own command:
`npx playwright test --config playwright.real-claude.config.ts e2e/real-daemon-session-settings.spec.ts`,
which needs only `pyry` on PATH — available on this machine, so this run executes it rather than
reasoning about it. `npm run build` is run because the fixture launches the built app from `out/`.

No unit test accompanies this: there is no production code to unit-test, and the renderer tier cannot
click (`environment: 'node'`, no DOM). The interactive state transitions this spec drives are already
covered statically in `RunConfigSections.test.tsx`'s `aria-busy` block and dynamically in the fake
tier's `e2e/run-config-settings.spec.ts`.

The full `npm run e2e:real:gate` (10 executed, 0 failed) is the operator's run from Inbox, not this
ticket's.

## Open questions

1. **Does the daemon default the seeded session's YOLO to `false`, making the flip an escalation?**
   Resolved during planning by reading the upstream tree rather than by assuming: the seed writes no
   `settings`, so it is the Go zero value, and an enable takes the non-blocking `sup.Restart` path.
   The spec still reads-then-flips, so it is correct either way and does not depend on this answer.
2. **Should the spec declare `requiredCapabilities` (#933)?** No. That gate can only *skip* the spec,
   and AC1 requires it to execute. Left unchanged.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and one boundary worth naming: the only untrusted input this change
  reads is the daemon's own `session_settings` reply, and it reaches the spec exclusively as a
  rendered `aria-checked` / `aria-busy` / `aria-readonly` attribute string that Playwright compares
  against a client-owned literal. The spec derives the value it writes from that read (read-then-flip),
  so a hostile daemon could steer *which* boolean is written to its own session — a capability it
  already has directly, gaining nothing. No daemon string reaches a path, a selector, a URL, or a
  shell.
- [Tokens, secrets, credentials] No findings — the SECRET HYGIENE invariant is preserved and
  strengthened by subtraction. The pairing payload is built by `encodePairingPayload` from
  `daemon.pairFields` and passed to `pairFromUnpairedLaunch`, exactly as on `main`; it is never
  interpolated into an assertion, a locator, a message, or a failure diagnostic. Every assertion in
  the rewritten spec reads DOM attributes, visibility, or counts. The one *new* runtime read is
  `getAttribute('aria-checked')`, whose domain is `"true" | "false"`.
- [File / storage operations] Not applicable — the spec creates, reads, and writes no file. All
  temp-dir and registry seeding stays in the untouched `realDaemon.ts` fixture.
- [Electron attack surface] No findings — no `webPreferences`, no IPC channel, no `contextBridge`
  surface, and no production source file is touched. The spec drives only the shipped UI.
- [Cryptographic primitives] Not applicable — no randomness, no comparison against a secret, no
  handshake code. The Noise handshake is exercised through the unmodified fixture.
- [Network & I/O] No findings — no new socket, no new frame, and notably **no manufactured push**.
  The standing rule adopted in `e2e/run-config-settings.spec.ts` (a spec may not supply an input
  production does not produce) is satisfied structurally here: the `daemon` handle is used only for
  its `pairFields`, and every byte the app receives is a reply to a frame the app itself sent.
- [Error messages, logs, telemetry] No findings — the spec adds no logging. A failed assertion prints
  a locator, an attribute name, and a boolean-valued string; no branch can surface a token, a key, or
  plaintext. Playwright's trace/screenshot artifacts show only the run-config sheet, whose YOLO
  section renders client-owned copy.
- [Concurrency] SHOULD FIX, addressed in the design rather than deferred: asserting the settle and the
  value in one non-atomic composed read would let a rejection interleaving between the two
  `getAttribute` calls pass a spec whose entire purpose is to fail on a rejection. The ordered
  three-step sequence in § Design exists for this reason; Phase B must not collapse it into a single
  `expect.poll` returning a two-field object.
- [Threat model alignment] Malicious/compromised relay and hostile-daemon-response are both in the
  tier's model and both surface here only as an assertion timeout, which the tier treats as a genuine
  liveness signal. Renderer-compromise-reaching-the-transport is untouched: no production code
  changes. Restoring real-wire coverage of the model-specific `validModel` leg — the daemon's
  argv-injection defence for an untrusted model string — is **OUT OF SCOPE** per the ticket's stated
  trade-off; it needs a claude-spawning spec and is explicitly deferred, with the loss recorded in the
  spec's header comment so it is discoverable from the file itself. That leg remains covered at the
  daemon's own unit tier and by `validModel` at the wire boundary.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
