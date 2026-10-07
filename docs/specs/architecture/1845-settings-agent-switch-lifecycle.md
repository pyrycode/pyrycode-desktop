# Settings lifecycle on authoritative agent switch

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: renderer ownership and reading map.
- `docs/knowledge/features/run-settings-write-store.md` → confirmation composition: acknowledgements retain sent values; arbitrary snapshots cannot erase them.
- `docs/knowledge/features/run-config-store.md` → live feed: settings and session identity share attribution/admission.
- `docs/knowledge/features/switch-agent-request.md` → owning-host outcomes: only a target-agent conversation row establishes success.
- `docs/knowledge/features/development-verification.md` → test tiers and native Electron capture: mounted interaction needs Playwright.
- `src/renderer/src/store/agentSwitchStore.ts` → `createAgentSwitchStore`: pending attempt owns conversation, host and target; pane identity survives separately.
- `src/renderer/src/store/AgentSwitchData.tsx` → `subscribeAgentSwitchData`: app-lifetime outcome and reconciliation subscriptions.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `reduceRunSettingsWrite`, `selectEffectiveSettings`: sparse pending/confirmed overlays and correlated settlement.
- `src/renderer/src/store/runSettingsWriteBridge.ts` → `foldWriteEvent`: only matched pending values update remembered preferences.
- `src/renderer/src/screens/conversation/confirmedRunConfig.ts` → `subscribeConfirmedRunConfig`: private permission/YOLO correlations, confirmation timer and replacement-session guard.
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `RunConfigLiveData`: owning-host read admission, cleanup and refresh wiring.
- `e2e/agent-switch-confirmation.spec.ts` → ticket-local opening fixture: production confirmation path without picker work.
- Existing adjacent store/bridge tests and `e2e/fixtures/capturePairedApp.ts`: reusable event fakes and capture contract.

QMD searched the desktop collection for settings/agent lifecycle lessons. Codegraph reports this worktree uninitialized; repository search supplies symbol/caller counts.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683 (context and screenshot read). The existing footer uses body-small primary text beside an upward chevron; keep its components and theme tokens. The ticket's sheet reference https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100 returns node-not-found with both ID spellings. This lifecycle repair changes no layout, styling or control presentation; retain the existing Run configuration sheet and capture its updated readings.

## Context

Confirmed settings choices describe the outgoing agent after the same conversation switches agents. Snapshot replacement deliberately retains choices during ordinary refreshes, so model-value comparison cannot decide ownership. One deliverable is to end the outgoing settings lifetime exactly at authoritative switch success.

Overlap: #1662 adds announcement clearing beside the success branch; #1544 introduced the permission-confirmation bridge already present on main. These changes require no in-flight APIs. Keep edits local and additive, preserving #1662's announcement behavior when combined. Announcement invalidation and both downstream picker cases remain owned by #1662.

## Design

- Add `agentSwitched` to `RunSettingsWriteEvent`. Its reducer clears pending, confirmed and error together, like conversation change.
- Add `agentGeneration: number` to the factory-produced `RunSettingsWriteStore`, initialized to zero and incremented for every `agentSwitched` dispatch. Keep it outside the existing overlay state interface so existing overlay constructors/selectors stay unchanged. This explicit lifecycle marker lets subscribers cancel private correlations even if visible state was already empty.
- Add optional `onActiveSucceeded(conversationId: string): void` to `createAgentSwitchStore` dependencies. Call it only for a pending attempt established by a stamped owning-host target row, when current pane conversation/host and current open binding still match. Removal remains abandonment. No model comparison is involved.
- Wire the singleton callback to dispatch `agentSwitched`, then request settings for that conversation through `requestRunConfigSnapshot`. Existing success diagnostic remains content-free.
- In `subscribeConfirmedRunConfig`, observe a changed generation before tracking new writes: cancel timer/target, clear private pending acknowledgements and awaiting status, clear the outgoing snapshot, and refresh the context from its getter. Reset reset-progress suppression so authoritative success admits fresh settings, while retaining a known replacement-session guard established by a session transition.
- Late outgoing confirmations/rejections then match neither visible nor private pending maps. `foldWriteEvent` consequently cannot restore preferences. New writes use fresh correlation IDs and settle through the existing paths.

## State + concurrency model

The write store remains one active-pane slice; agent attempts remain conversation/host-owned. Eligibility is sampled synchronously at authoritative outcome handling, including both host and conversation identity, so a completion after navigation cannot clear a successor's writes. The generation is a notification of a proven lifecycle edge, never a daemon-provided number or model-derived ownership claim.

The existing app-lifetime write subscription cancels permission polling on that edge before the request is sent. No new listener, timer, transport or async job is introduced. Existing cleanup removes all subscriptions and cancels polling. Preserve ordinary reconnect, conversation-change, same-agent refresh, applied-effort and permission confirmation behavior.

## Error handling

No new failure mode or wire contract. Missing/foreign stamps, unrelated rows and unchanged agents do not invoke success invalidation. Refusal and abandonment retain outgoing settings. Existing typed IPC commands carry the refresh; existing generic field errors remain until a confirmed switch clears them. Log only static lifecycle/confirmation codes, never daemon text or settings values.

## Testing strategy

- Test first with isolated real stores and composed event listeners: both switch directions, all four settings fields, confirmed/pending/error clearing, equal raw model values and incoming readings.
- Verify opening/cancel/refusal/abandonment, reset/transition alone, unchanged or unrelated lists, foreign/unstamped origins and completion after navigation (including equal IDs on different hosts) preserve writes.
- Verify stale confirm/reject cannot remember model/effort or restart permission/YOLO confirmation polling; new writes settle normally. Keep existing permission deadline, replacement admission, reconnect and applied-effort tests green.
- Mounted fake-transport regression reuses the ticket-local renderer opening fixture in `agent-switch-confirmation.spec.ts`: confirm an own-agent model write, use the existing switch dialog, establish list success, deliver requested incoming settings, and assert footer and open sheet readings. Run this new regression against unmodified production main first and record the actual failure, then run it after repair. Capture synthetic incoming states. No live Claude test is added or required.
- After final merge of main: pre-verify check (typecheck/full unit suite), build and focused Playwright spec.

## Open Questions

None. The simpler shape is one typed write-lifecycle edge shared by the visible overlays and private confirmation bookkeeping; a new shared harness or model ownership inference would add unnecessary machinery.

Sizing: about 550 written lines (70 production, 390 tests/helpers, 90 plan), zero new exported definitions, two production consumer updates, four observable criteria and fewer than eight lifecycle/admission branches. Analogue #539 inserted 187 plan plus 225 implementation/test lines and deleted 23; this repair adds mounted proof and a second existing lifecycle consumer. All ceilings hold on sketch and written plan.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `createAgentSwitchStore` admits only a stamped owning-host row matching a pending target; pane host plus conversation and open binding gate mutation. Settings read admission remains in `subscribeConfirmedRunConfig`; no raw payload is trusted as an agent-change signal.
- [Tokens, secrets, credentials] No findings — only typed settings and correlation IDs enter this renderer lifecycle. No token creation, persistence, access or logging is added; safeStorage remains main-owned.
- [File and storage operations] No findings — production changes are in-memory only; remembered preferences are updated only by existing matched acknowledgements. Late unmatched replies cannot write model/effort preferences.
- [Electron attack surface] No findings — no new channel, preload API, navigation or remote content. Existing isolated renderer receives typed/stamped events; transport and keys remain in main.
- [Cryptographic primitives] No findings — no crypto changes; existing Noise variant and UUID correlation generation remain untouched. No secret comparison or nonce lifecycle is introduced.
- [Network and I/O] No findings — reuse the fixed typed settings request and existing transport limits/timeouts; no socket, relay URL or TLS policy changes. An invalidation sends one request, not a retry loop.
- [Errors, logs, telemetry] No findings — cleared errors are field-only; retained logs are static codes. No daemon message, model/effort value, secret or exception content is added to logs.
- [Concurrency] No findings — synchronous generation notification cancels the private permission target/timer before refresh. Removed pending records prevent late replay from restoring overlays or remembered preferences; success after navigation is host-and-conversation gated. Existing teardown owns subscriptions/timer.
- [Threat model alignment] No findings — delayed/reordered relay acknowledgements fail closed without correlations; malformed daemon data retains existing main parsers and renderer host/session admission. A compromised renderer gains no new key/socket/storage capability. Disk token theft is unaffected because this ticket never handles credentials; existing main safeStorage protections remain in force.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07

## Revisions

2026-10-07 — A test with an outgoing session that had previously reset exposed that retaining `expectedSession` at authoritative success rejects a fresh incoming-agent session indefinitely. The generation edge now resets that admission guard along with reset suppression, private correlations, polling and snapshot. Standalone reset/replacement admission remains unchanged and covered by the existing bridge tests. This supersedes the Design section's instruction to retain a prior replacement guard; the new contract starts fresh settings admission at the proven agent-lifetime edge.

Baseline proof on main `95ed3951e38df40550eae2680068a6bc0f417563`, before production edits: the initial store regression ran 9 cases, 3 failed on retained outgoing pending/confirmed state; focused Playwright ran 2 cases, existing confirmation passed and the new mounted regression failed at the incoming GPT-6 Luna footer assertion. Its captured DOM showed incoming Codex offerings and settings while the footer still read `sonnet`; evidence: `/tmp/builder-1845/main-regression-error-context.md`. With the repair, both mounted cases passed. No live Claude test is required or claimed.
