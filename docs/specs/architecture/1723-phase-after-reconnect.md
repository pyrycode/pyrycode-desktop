# Turn phase after reconnect (#1723)

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process boundaries, static renderer tests and positive delivery barriers.
- `docs/knowledge/features/conversation-timeline-store.md`: the open conversation owns reconnect clearing; its no-reassertion discussion predates the daemon prerequisite.
- `docs/knowledge/features/conversation-shell-composer-status-row.md`: `ComposerStatusArea` reserves space and `ThinkingIndicator` selects existing phase copy.
- `src/renderer/src/store/threadTimeline.ts` → `reduceTimeline`: clears transient chrome on `reconnected`, preserves items, treats identical phases as no-ops.
- `src/renderer/src/store/threadTimeline.test.ts` → phase no-op case: existing reference-identity proof to reuse.
- `src/renderer/src/store/timelineBridge.ts`, `src/renderer/src/App.tsx` → `translateTimelineEvent`, `useTimelineBridge`: mounted routing from attributed events into the open keyed slice.
- `src/main/daemonConnection.ts` → `onDriverEvent`: publishes `connected` synchronously after handshake; phase delivery does not require an event ID.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThinkingIndicator`, `ComposerStatusArea`: existing Thinking… / Working… presentation and theme tokens.
- `e2e/reconnect-event-replay.spec.ts`, `e2e/background-task-reconnect.spec.ts`: genuine socket drop and immediate handshake-tail burst under fresh Noise ciphers.
- `e2e/fixtures/launchPairedApp.ts`, `src/main/transport/fakeDaemon.ts`: pairing fixture, reply scripting and `reconnectResendFrames`.
- `e2e/fixtures/realDaemon.ts`, `e2e/real-claude-queue-drop.spec.ts`, `e2e/fixtures/queueTurnEvidence.ts`: isolated real daemon, ordinary gate-held tool turn and content-free observation.
- Daemon `internal/relay/v2session_turnphasereconcile.go`, `internal/relay/v2session_handshake.go`, `cmd/pyry/relay.go` → `reconcileTurnPhases`, `startRelayV2`: running-only snapshot wired to the emitter; reconciliation follows replay and omits `event_id`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

Read the design context and screenshot: a horizontal status row with the Pyry mark and small primary-colored Thinking label above the composer. Retain `ComposerStatusArea` / `ThinkingIndicator` and their existing color, typography and spacing tokens. Capture the existing integrated running states at 1280×800; this proof adds no visual design.

## Context

A phase emitted before disconnect is not necessarily in the replay tail. Daemon prerequisite pyrycode#2718 (`25b532b6205507784a7615fe59d3c5a7bb2f5484`) now reasserts the running phase after replay, without an event ID. Source inspection suggests desktop already handles this; the baseline must be observed through the mounted app before changing behavior. The deliverable is regression coverage for the conversation kept open across disconnect, plus a production fix only if that baseline demonstrates a defect. No ADR is needed.

## Design

Add `e2e/timeline-phase-reconnect.spec.ts` covering thinking, responding and an ended-offline silence. Seed a held transcript, observe the running phase, genuinely drop the client socket, and send the optional phase immediately after the fresh handshake. Positive renderer-side connection and phase observations gate assertions, so neither retained pre-drop copy nor early absence can pass. Duplicate-phase assertions wait for observed delivery before comparing status markup and transcript rows.

Add a small test-only evidence helper under `e2e/fixtures/` with a self-contained renderer subscription. Its snapshot carries connection counts, conversation IDs, closed phase values and turn IDs/completion counts only; never model text, tokens or frames. It observes without dispatching into stores.

Add `e2e/real-claude-phase-reconnect.spec.ts` using the production stream-json runner. A foreground Bash command creates a readiness file and waits for a release file in the isolated daemon workdir. After readiness and a running phase, a spec-local content-blind TCP proxy drops only the app's connection to the routing relay. Wait for a new `connected` and an attributed running phase, require the original turn still open, and confirm the status returns before releasing the gate. Record daemon version and the baseline outcome in content-free test annotations / attachment. No transport, renderer or wire contract changes are expected. Correct the obsolete reducer comment about phase reassertion after the baseline.

## State + concurrency model

No production state, events, exports or consumer migrations. Existing `connected` → `reconnected` targets the open keyed slice; subsequent `turnState` replaces its phase. Held items survive by reference. The evidence subscription is removed in `finally`. The local TCP proxy owns both socket legs and destroys them before closing its listener; the fixture continues to own app, daemon process group and relay teardown. Always release the tool gate on failure before teardown.

## Error handling

Existing typed decode/IPC rejection behavior stays unchanged. Test timeouts fail with static descriptions; a missing live prerequisite uses the fixture's skip gate and is never acceptance. No new production failure modes. The dedicated daemon used by the dispatcher must contain the prerequisite revision; record its version rather than inferring this from a closed issue.

## Testing strategy

- Run the new fake spec against unchanged production code and record the baseline before any production edit.
- Negative control: omit a running-phase handshake-tail reassertion and observe the phase-restoration assertion fail, then restore the burst and require all scenarios green.
- Both phases return without later phase transitions or sends; held transcript survives. Silence checks follow positive evidence of the new connection.
- Identical phase delivery changes no status markup and adds no transcript row; reuse `threadTimeline.test.ts`'s same-reference no-op coverage rather than duplicating it.
- Run focused existing reducer/bridge/holder tests and `npm run build`; run only the new fake spec. List the real spec to check collection; dispatcher owns credentialed `npm run e2e:real:gate`, which must execute and pass the new case.
- Capture and inspect synthetic integrated screenshots; no live screenshots or model-authored text artifacts.

## Open Questions

- Does unchanged desktop restore the phase? Resolve with the fake baseline; the live spec records the same observation when the dispatcher executes it. Any required fix gets a dated revision before its code lands.

## Scope measurement

One deliverable, four observable acceptance behaviors. Estimate 450–550 total written lines including plan, two specs, evidence helper and a comment correction; at most one production file, zero new exported production surfaces, zero migrated consumers and zero new production reject branches. Remote feature branches checked against the proposed paths; no overlaps found. This stays within the refiner's S estimate and all five size limits.

## Documentation handoff

Pending documentation stage: `docs/knowledge/features/conversation-timeline-store.md` → `## Edge cases and limitations`, replace the obsolete claims that desktop advertises no replay cursor and the daemon never reasserts `turn_state` with the current cursor/reassertion behavior and open-conversation scope. This discovery was recorded by the refiner; no reference documentation is edited in this stage.

## Security review

**Verdict:** PASS

- [Trust boundaries] No findings — tests use the existing validated `parseInboundMessage` → typed IPC path and observe through `window.pyry.onDaemonEvent`; no new production boundary or dispatch hook.
- [Tokens, secrets, credentials] No findings — existing fixtures own temporary pairing and secret storage. Evidence retains only counts, routing IDs and closed phase values. Dispatcher owns credentialed execution; tests never fetch credentials.
- [File and storage operations] No findings — gate files use spec-owned names inside `daemon.workdir`; synthetic screenshots use scratch paths. No daemon-controlled text forms a filename and no new production storage exists.
- [Electron attack surface] No findings — use existing isolated Electron fixture with unchanged sandbox, context isolation and IPC allowlist; no new preload or IPC APIs.
- [Cryptographic primitives] No findings — real fixture and fake daemon reuse Noise_IK_25519_ChaChaPoly_BLAKE2s; handshake-tail frames use the fresh cipher, with no hand-written crypto or nonce reset.
- [Network and I/O] No findings — local TCP proxy forwards opaque bytes on loopback and drops socket legs; it cannot decode, inject or log pairing/Noise data. It is test-local and owns socket/listener cleanup.
- [Errors, logs, telemetry] No findings — failure messages and attachments use static descriptions and numeric evidence; exclude model reply text, raw frames and pairing fields. No production logging changes.
- [Concurrency] No findings — positive connection/phase barriers prevent premature absence assertions; the tool gate keeps the same live turn open. Every added listener and socket has a `finally` cleanup.
- [Threat model alignment] No findings — exercise relay drop/delay recovery without weakening Noise or parser validation. Hostile response validation, token-at-rest protection and compromised-renderer isolation remain enforced by existing production boundaries, unchanged by test-only coverage.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05

## Revisions

2026-10-05 — Baseline resolved: unchanged desktop restores both thinking and responding from event-ID-free handshake-tail reassertions, preserves the transcript, and stays idle on silence after a positively observed reconnect. The negative control withheld both phase reassertions: two expected missing-label failures, while the idle case passed. No production behavior changed; only the obsolete reducer comment was corrected. The real spec records the before-drop phase and restoration during the same gate-held turn when the dispatcher executes it.

2026-10-05 — Capture setup: screenshots in this Linux runtime timed out while the fixture kept the Electron window hidden, after the phase assertions had passed. Capture only in the fixture's supported `PYRY_E2E_SHOW_WINDOW=1` mode; the behavioral regression remains runnable in default hidden mode. Visible captures at 1280×800 (`/tmp/builder-1723/thinking.png`, `/tmp/builder-1723/responding.png`) were inspected against the Figma status row: existing Pyry mark, small primary label and composer placement match, with no visual changes.
