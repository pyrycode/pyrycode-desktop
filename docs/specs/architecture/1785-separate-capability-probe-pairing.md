# Separate capability-probe pairing (#1785)

## Files read

- `CLAUDE.md` and `docs/knowledge/INDEX.md`: repository conventions and owning topics.
- `docs/knowledge/features/real-claude-liveness-e2e.md` → Capability-gated skip: negotiated intersection, fail-closed skips and fixture teardown; its shared-token assumption predates first-key binding.
- `docs/knowledge/features/development-verification.md` → Live-test diagnosis: dispatcher acceptance needs executed counts and the actual daemon source revision.
- `e2e/fixtures/realDaemon.ts` → `test` daemon fixture, `runPyryPair`, `decodePairFields`: mint after readiness, app permission grant and isolated cleanup.
- `e2e/fixtures/daemonCapabilityGate.ts` → `readDaemonCapabilities`, `probeOnce`: temporary static key, bounded attempts, stopped drivers and content-free failures.
- `e2e/fixtures/daemonCapabilityGate.test.ts` → capability decisions and real timeout/malformed-key coverage.
- `e2e/real-daemon-multi-agent.spec.ts` → app reconnect ack recorder: preserve app-owned evidence.
- `vitest.config.ts` and `package.json`: harness unit tests already supported; no dependency needed.

## Change

The daemon fixture currently hands one pairing to two independent Noise static keys. After first-key binding, a successful probe claims that pairing and prevents the app from connecting. Keep the existing app mint and its `allowRemotePermissions` option; for nonempty `requiredCapabilities`, mint a second device named `capability-probe-e2e`, with no remote-permission grant, and pass only its decoded fields to the probe. Parameterize the private `runPyryPair` device name with fixture-owned constants; the app remains `realclaude-e2e`. Hand only the original app fields to `use`. Correct the probe's token/key comments. Sanitize mint failures to fixed launch/exit/timeout diagnostics, dropping stdout, stderr and caught error contents so neither pairing can enter reports.

No new exported type, state, async owner or failure mode. Both mints retain the existing 15-second bound and occur sequentially inside the existing cleanup scope; probe retries reuse their own key and retain existing deadlines, fail-closed decisions and driver teardown. No product, wire, Electron, UI, live spec assertions or daemon policy changes. Remote overlaps #1364 and #1544 touch other fixture blocks; neither is a dependency and edits stay local.

Sizing: one deliverable; approximately 300 written lines including this plan and fixture regression; zero production files, zero new exported surfaces, two private mint call sites and one probe caller, three observable acceptance criteria. All five limits hold on sketch and plan re-count.

## Testing strategy

- Add `e2e/fixtures/realDaemon.test.ts`, capturing the actual fixture via Playwright's registration boundary. Fake process/socket I/O and a binding-aware driver; retain real temp-directory setup, pairing decoding, capability reader and decision. The fake binds a daemon-minted token to the first supplied static key and refuses a different key.
- First watch successful probe → independent app-key authentication fail with current shared-token wiring; then require it to pass after repair. Assert app grant retained, probe grant absent, driver stops, and isolated home removal.
- Cover empty requirements (one mint, no probe), missing capability and probe failure (no app handoff), and second-mint failure (content-free diagnostics and cleanup).
- Run existing capability tests, final main merge, pre-verify check and build. Existing timeout/invalid-key tests retain bounded fail-closed evidence.
- Dispatcher owns credentialed acceptance of all three ticket-named cases: preserve `needs-real-claude`, require three executed/passed with no skips, and retain per-test results plus actual daemon version/source revision. No live spec is written or changed here.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `decodePairFields` parses daemon mint stdout without echoing it; each credential has one intended consumer. `parseHelloAck` and `decideCapabilityGate` retain parsed capabilities and spec-owned skip reasons.
- [Tokens, secrets, credentials] No findings after design correction — distinct daemon-minted pairings, fixed device names and no probe permission grant. Mint diagnostics drop subprocess output/error objects. Tokens and keys stay in harness memory and the isolated daemon registry, never reports.
- [File and storage operations] No findings — no new paths or persisted secrets; existing daemon HOME is minted by `mkdtemp`, restrictive registry modes remain, and `finally` removes that isolated HOME on success/skip/failure.
- [Electron attack surface] No findings — no Electron, IPC, navigation or renderer changes; the app receives its existing pairing through the existing test flow.
- [Cryptographic primitives] No findings — use daemon minting and unchanged vetted Noise library/variant. The probe keeps one generated key across retries and never claims the app pairing.
- [Network and I/O] No findings — existing loopback-only test relay, frame cap, connect/attempt/deadline limits remain; the extra mint inherits its existing timeout.
- [Errors, logs, telemetry] No findings after design correction — static launch/exit/timeout failures replace mint stderr/error echoes. No new logging; skip reasons remain client-owned. Regression assertions never print pairing values or key material.
- [Concurrency] No findings — sequential mints and probe before app handoff, stopped probe driver, unchanged process-group and isolated-directory cleanup in `finally`.
- [Threat model alignment] No findings — malicious relay delays remain bounded; malformed daemon acks fail closed; pair output cannot enter diagnostics. Existing production safeStorage and renderer isolation stay unchanged. This harness repair does not weaken first-key binding.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05
