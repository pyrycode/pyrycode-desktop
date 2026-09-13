# Session permission checkbox

## Context and size

Offer one explicit session grant for the daemon's complete offered rule list, preserving the existing permission response gates. This is one deliverable with its live proof; no ADR is needed. Refiner estimate: about 700 written lines. Planned work: about 680 lines including tests and this plan, five production TypeScript files (the fifth only exports the existing checkbox glyph), one stylesheet, one newly exported component, at most four existing consumer edits, four acceptance criteria, and fewer than ten rejection predicates. No dependencies or wire changes.

The worktree starts at current main `af17b54`. Refreshed remote feature branches show no overlap after excluding parked `feature/1364` as explicitly approved for this ticket. Codegraph returned “not initialized”; repository reads and text search supplied the symbol/caller map. `answerPrompt` has two production calls in `PermissionModal`; `PermissionModalView` has that container and two test consumers. `QuestionTick` has one existing call in `QuestionPanel`.

## Files read

- `src/renderer/src/store/modalBridge.ts` — `translateModalEvent` drops the offer at its named-field copy.
- `src/renderer/src/store/modalPrompts.ts` — `ModalPrompt`, `ModalEvent`, `reduceModal` own replacement and retention.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` — `PermissionModal`, `PermissionModalView` own local selection, confirmation, focus and response availability.
- `src/renderer/src/screens/conversation/modalResolution.ts` — `answerPrompt`, `selectOption`, `resolvePendingOption` preserve routing and correlation.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` — `QuestionTick` supplies the existing Figma checkbox glyph.
- `src/renderer/src/screens/conversation/conversation.css` — `.question-panel__control--checkbox`, `.permission-panel__content` supply style and bounded scrolling.
- Co-located modal bridge/model/view/resolution tests and `interactiveRoundtrip.test.tsx` — static-render and injected-effect conventions.
- `e2e/permission-modal-answer-paths.spec.ts` — `shown`, `fake`, `resolutions` provide app-wide fake transport and retained-draft checks.
- `e2e/real-claude-permission-modal.spec.ts` and `e2e/fixtures/realDaemon.ts` — existing drive, `RealDaemonOptions`, isolated config and teardown.
- `src/shared/wire/types.ts`, `src/shared/ipc/events.ts` — existing optional offer and outbound Boolean contracts.
- `docs/knowledge/features/conversation-shell-permission-modal.md` — Selection and confirmation: affirmative defaults remain direct, offline responses remain blocked.
- `docs/knowledge/features/modal-store-bridge.md` — named copies and reconnect resets; `development-verification.md` — static tests cannot prove clicks or fresh effects.
- Daemon `docs/protocol-mobile.md`, Modal (v2) — retained grants are daemon-authorized and session-only; client supplies neither rules nor destination.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6913

Surrounding component: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6015

Read the design context and screenshot: a compact title with Pyry mark sits over a bordered, rounded content column and trailing outlined Cancel / filled Continue actions. Use existing body/label typography, tertiary checkbox, background/primary-container border and spacing tokens. Apply the approved adaptation: one checkbox and complete wrapped list above the action separator, inside the existing scrollport; retain it during confirmation.

## Design

Carry optional `alwaysAllow` through both named-field copies, using the existing wire offer shape. In `reduceModal`, keep the previous offer object only for an unchanged request identity, class, conversation and ordered rules; every removal/change replaces it. This stable object identity represents a continuous offer, so removing and restoring equal rules cannot revive old consent even when intermediate store updates are batched.

The container holds a nullable opted-in prompt snapshot. A pure helper validates request/conversation/class and current available offer identity. Invalid snapshots are cleared during render, matching existing selection-marker invalidation. Checkbox changes update only this local snapshot. Keep one native checkbox with client-owned label and separately associated rule text; rule strings appear only as escaped React children, keyed by their list positions. No truncation, parsing, attributes, URLs or content-derived keys.

Export and reuse `QuestionTick` without altering questionnaire behavior. Add required checked/change view props and update the two test consumers. Use existing question option/control styles and a permission-only wrapped rule stack.

Add a confirmation helper in `modalResolution` that validates the current pending option, derives the Boolean only for supplied `allow_once` / `allow_always` on a checked current permission offer, and calls `answerPrompt`. Extend `answerPrompt` with an optional Boolean defaulting false; omit false from the payload. Direct Continue never supplies it. Keep response-availability reads immediately before response helpers, existing selection validation, host routing, main-minted answer token, optimistic dismissal and rejection feedback.

## State + concurrency model

No new persisted store, async task or subscription. The existing modal bridge retains its teardown. The reducer observes every offer transition; local consent survives Confirm/Back only for that continuous offer. Unmount, a different request, class/conversation change, removal, reordered or edited rules invalidate it. Existing connection checks continue to block Continue, Confirm and Cancel while allowing local editing/Back.

## Error handling

No new I/O failure mode. Absent/unavailable/trust offers hide the control and never grant. Invalid pending selection remains inert. Preserve guarded send and rejection presentation; send only static lifecycle/error codes through the existing renderer diagnostic channel, never offer content or caught error values. Main and daemon retain all authorization boundaries.

## Testing strategy

- RED first: bridge/store offered, unavailable and legacy retention; same ordered offer identity versus changed/removed/restored identities; static complete escaped rule list and hidden trust/unavailable cases; confirmation allow matrix with no rules/destination/token in renderer payloads.
- Fake transport: initially unchecked; toggle sends nothing and cannot bypass selection; checked/unchecked allow, deny/cancel/trust/default paths; Confirm/Back; same-ID replacement while confirming, removal/restoration, reordered rules and different requests. Existing tests cover FIFO, offline gates, rejected answers, questionnaire and draft retention.
- Capture normal and 800×600 long/unbroken rule states in the focused fake spec, open images and compare Figma styling. Assert scroll widths and action reachability, including confirmation.
- Extend the existing live permission test (one test before and after): opt in to `stdio_permission_prompt: true`, retain stream runner, remote approvals and `skipPermissions: false`. Require an offered checkbox, check it, explicitly Confirm allow, observe a Bash command's fresh filesystem effect. Repeat the identical command in the same session and require a fresh effect with no new permission event. Create a fresh session in the same workspace; require a new permission before a new effect. Count typed inbound events with cleanup so transient prompts cannot evade the absence assertion. No absent-offer skip or optimistic-disappearance proof.
- Run touched unit tests, `npm run build`, focused fake permission spec and existing offline-response spec. Authenticated live execution belongs to the dispatcher; use its dedicated daemon containing upstream #2346, #2364 and #2365. Never claim it passed without execution.

## Open questions

None in the product contract. Resolve the exact live Bash witness against the daemon's session-scope precedent before implementing that drive; record any resulting contract change under Revisions.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/conversation-shell-permission-modal.md`, Selection and confirmation, to state that one checkbox covers the complete displayed offer for this session only. Record the executed live result in `docs/knowledge/features/live-e2e-runbook.md`, Current real-claude gate state; identify any spec-count change requiring a dispatcher floor update. The planned live spec count is unchanged.

## Security review

**Verdict:** PASS

- Trust boundaries: daemon rule text remains untrusted display content; `translateModalEvent` and `reduceModal` copy the typed offer, and JSX escapes every rule. Rule values never reach attributes, keys, logs or outbound payloads.
- Tokens/storage/crypto: no credentials, storage or cryptographic changes. Existing main-side answer-token minting and safeStorage remain the owners; renderer consent is volatile only.
- Files/I/O: only the isolated live fixture writes its known temporary config and synthetic command witness. No daemon text selects a path. Fixture teardown remains intact.
- Electron/network: no bridge API, window, socket or navigation changes. Existing main validation and daemon retained-modal authorization remain decisive, including session-only destinations and remote approval.
- Logs: lifecycle and classified errors use static diagnostic codes; no rule, prompt, path, identifier or caught exception content is logged by new behavior.
- Concurrency: canonical offer identity prevents A→B→A consent resurrection, including batched deliveries. Confirm validates membership and current offer; no await separates the connection check and response. Default Continue never gains a grant.
- Threat alignment: hostile rule markup is inert; a hostile daemon cannot make the client supply extra rules or persistence destinations. Relay flooding, transport compromise and at-rest token handling are unchanged existing transport/storage responsibilities, with no new deferred fix introduced here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13

## Revisions

- 2026-09-13: Resolved the live witness question from daemon `TestInteractiveStreamStdioAlwaysAllowIsSessionScoped`: run the identical `touch pyrycode-always-allow-witness.txt` command and reset its mtime to one second after epoch before each repeat. The desktop drive additionally creates its fresh session in the same workspace and reads fresh session-settings replies to prove distinct session identity. No product-contract change; one live test remains one live test.
- The existing styled inputs receive pointer activation through their labels. Fake checks therefore exercise label clicks and native Space activation, then assert checked state; clicking the visually hidden input itself is not a valid pointer drive.
- 2026-09-13 live-gate rework: the dispatcher executed 19 tests (17 passed, 2 failed) at `98627c7`. The permission drive reached the panel but found no checkbox. The dedicated test daemon inspected with `go version -m` is clean revision `716eadae1f4521bccddc1c5e3d32517fad242b9e`; ancestry checks show it includes #2346/#2364 but lacks #2365's grant implementation (`76d06c2d`) and mixed-offer fix (`a993a5f3`). Before another authenticated gate, the maintainer must rebuild the dedicated binary from a clean revision containing both; local daemon main `8a850505` contains them. The live drive will assert the inbound offer Boolean separately from checkbox rendering so another unavailable offer reports the unmet prerequisite without collecting rule content. No acceptance assertion is relaxed and no live pass is claimed.
- The same gate exposed a pre-existing test-only locator ambiguity in `e2e/real-daemon-add-workspace.spec.ts`: `AddWorkspaceDialogView` now has both a folder and optional-name textbox. Target the folder's accessible name, preserving the workspace creation and filesystem checks. The dispatcher log is the RED evidence; verify named-field interaction in the existing fake workspace spec and hand off the real spec rerun. No production/UI changes, new state, exported symbols or security boundaries are introduced by this rework; the security verdict remains PASS and live test counts remain unchanged.
- 2026-09-13 second live-gate rework — **blocked on \#1413, no code change made**. The gate at `98c71b9` executed 19 tests and failed all 19 in 44.6s wall, roughly 1.5s each, with one identical error: `pyry pair exited with code 1` after dialling `$HOME/.pyry/test.sock`. Eighteen of those specs are untouched by this branch, so the failure is setup-wide rather than a product regression. Root cause is the daemon rebuild that this ticket itself requested: `8a850505` carries upstream `4958c614` / `c19d5c93` (pyrycode/pyrycode#2393), which makes bare `pyry pair` mint through a *running* service and rejects `--relay` outright. The `realDaemon` fixture calls `runPyryPair` above the daemon `spawn` by deliberate design, so the credential mint now dials a socket that does not yet exist. Verified by running the same command under an isolated `HOME` against both installed dedicated binaries: `pyry.prev` (`pyry dev`) mints offline and prints the payload, `pyry` (`pyry dev-8a850505`) exits 1. Reverting the binary is not a fix, because this ticket's acceptance needs #2365 from that same rebuild; only a fixture migration satisfies both. Upstream hit this in its own suites and migrated them (pyrycode/pyrycode#2394, #2396, #2398–#2403, #2407, #2408), but its replacement offline seeder is the Go package `internal/e2e/internal/paireddevice`, unavailable to this repo's TypeScript harness. That migration spans the whole real tier and is out of scope here per the builder's scope rule, so it is filed as \#1413 and set as a blocker of this ticket. Nothing in this branch is implicated and no assertion is relaxed; AC4 remains pending authenticated execution once \#1413 lands.
