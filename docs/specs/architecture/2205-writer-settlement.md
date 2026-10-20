# History writer settlement handoff

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process boundaries and verification map.
- `docs/knowledge/features/chat-history-storage.md` → Buffered replacements: failed cursors wait for an explicit flush or later received event; shutdown cannot schedule another timer.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: replay cannot establish native encryption or OS integration.
- `docs/knowledge/features/development-verification.md`: counted evidence and positive acknowledgement barriers.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`, `drain`, `flush`: scheduling guards, failed-key suppression, ownership and lifecycle fences.
- `src/renderer/src/store/chatHistoryWriter.test.ts` → `harness`, held-failure and lifecycle cases: real thread-store publications and controlled scheduler.
- `src/renderer/src/store/threadItemStore.ts` → `ThreadItemStore`: `acceptEpoch` and `applyUpdate` supply owned changes.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: fixed request parsing, paired-host admission and generation checks.
- `src/main/chatHistoryStore.ts` → `createChatHistoryStore`: encrypted lists, serialized persistence and encryption-unavailable rejection.
- `src/main/indexedThreadHistory.ts` → `createIndexedThreadHistory`: bounded owned mutations and protected persistence obligations.
- `e2e/indexed-history-lifecycle.spec.ts`, `e2e/history-writer-native.spec.ts`: existing native storage and shutdown checks.
- Agents `docs/working-practice.md`, `docs/ticket-scope-policy.md`, `builder/security-review.md`: scope, publishing and adversarial review requirements.

## Context

After the final list acknowledgement, `drain` may finish before a queued microtask publishes owned work. Capture sees `running`, so it cannot schedule; the existing cleanup then clears `running` without handing off that work. This repair establishes eventual scheduled submission for this gap. It does not attribute the separate historical protected-page failure in #2191.

One useful behaviour: drain eligible settlement-time work, with failure and lifecycle controls proving that same invariant. Forecast: 25–40 production lines, 170–220 test lines, about 90 plan/evidence lines; under 400 written lines, zero new exports or consumer migrations, two observable criteria and no new error branches. The shipped #2198 analogue used 320 additions and 8 deletions, excluding documentation folds. No ADR is needed. Remote feature branches were inspected: no overlap with either planned code file.

## Design

Keep the existing API, pending linked queues, request cursors and 200 ms production scheduler. Pass a failed-key set into `drain` rather than creating it inside that function. A private drain starter owns cancellation and `running`; public `flush()` starts a fresh cycle with an empty failed set. During settlement, clear `running` and schedule a continuation only if an unpaused pending key is outside the failed set and the writer has not stopped. That scheduled continuation retains the same failed set across further automatic handoffs. Ordinary capture scheduling continues to call public `flush`, preserving later-event retries.

Reusing the existing failure set is the cleaner shape than introducing another queue or publication counter. Checking readiness alone is insufficient: starting a fresh failure set for a different key's automatic continuation would retry a retained failure.

## State + concurrency model

One serial drain remains active. No store shape, event union or IPC contract changes. A settlement continuation uses the existing cancellable scheduling handle. Explicit flush cancels that handle before taking ownership. Failed keys remain suppressed throughout an automatic chain; paused hosts remain excluded. Stop unsubscribes producers, waits for host removals, cancels scheduled work and drains with the existing close semantics. Keep generation checks, 32-unit submissions and MessageChannel yields intact.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Owned publication in the final list-acknowledgement microtask gap; repeated settlement | New `schedules owned work captured during final list settlement exactly once` case, using real `acceptEpoch`/`applyUpdate`, scheduler execution and acknowledged requests. |
| Failed cursor alongside a newly eligible different key; repeated automatic settlement | New `keeps failed cursors suppressed across settlement continuations` controls; assert no schedule/spin after eligible work finishes and exact retry order afterward. |
| Later received event or explicit flush | Same controls parameterized by retry trigger; original failed request precedes newer work at its key. |
| Paused host, failed or successful host removal | New paused settlement control plus existing `pauses buffered host saves`, `resumes buffered history`, and `settles pending removal before the shutdown flush` cases. |
| Stop during final acknowledgement | New stopped-settlement control and existing paused-clock flush/stop regression; no timer after stop. |
| Reset, epoch replacement, confirmed deletion, same chat on another host, successful re-pair | Existing `fences a held bounded cursor after %s`, deletion suppression and in-flight comparison-state cases. |

## Error handling

Keep typed `ChatHistoryResult` classification and static content-free diagnostics. Invalid owned requests and IPC/write failures retain their exact mutation cursor. Automatic settlement neither retries those keys nor declares persistence. List/removal failure semantics stay as implemented. No new failure mode or log payload is introduced.

## Testing strategy

- Test first: resolve a held `replaceList`, then queue a microtask publishing through the real thread store before cleanup. Check a new scheduled callback, execute it, await acknowledged epoch/item submissions without flush/stop, and verify exactly-once order. Retain counted red and green results.
- Hold another final list acknowledgement in an automatic continuation while one key has already failed. Publish another eligible key in its settlement gap, then prove no failed-cursor retry and no idle timer; verify later explicit and received-event retries preserve the exact request and queued ordering.
- Check paused-only and stopped settlement paths; run the full writer file and existing handler/storage/indexed/failure/lifecycle checks on Linux.
- Build after the final main merge and run pre-verify against the writer file. Run existing native protected-storage/lifecycle Playwright coverage with its encryption assertions. No new user interaction is introduced. The dispatcher owns the full application/replay gate; replay is not native storage proof. macOS is outside this run's verification scope.

## Open Questions

None. The repair changes only settlement scheduling and its regression controls.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `captureChange` retains exact store-owned host/conversation coordinates; `parseChatHistoryRequest` validates bounded submissions and `createChatHistoryHandler` independently validates untrusted IPC and paired membership.
- [Tokens, secrets, credentials] No findings — no new credential flow or renderer persistence; encryption remains main-owned through `SecretEncryption` backed by Electron safeStorage.
- [File and storage operations] No findings — the repair does not derive paths or change storage. `createChatHistoryStore` rejects unavailable encryption; protected transactional storage and pending-save fail-closed reads remain intact and covered by existing storage checks.
- [Electron attack surface] No findings — fixed history IPC only; no new bridge method, navigation, remote content or process privilege changes.
- [Cryptographic primitives] No findings — no crypto changes; safeStorage and the existing authenticated storage implementation remain the only persistence path. Noise and key ownership are untouched.
- [Network and I/O] No findings — no network operations added. IPC writes retain bounded requests and serial acknowledgement; failed keys cannot acquire an automatic retry loop.
- [Errors, logs, telemetry] No findings — existing static status/error codes only; never log message content, identifiers, requests, secrets or caught exception text.
- [Concurrency] No findings — carry failure suppression across automatic handoffs, check paused hosts and stopped state, retain one running owner and cancellable timer, and preserve cursor/generation fencing. The listed controls prove exclusion and progress independently.
- [Threat model alignment] No findings — relay flooding cannot enlarge per-request bounds; hostile daemon content still passes existing admission; compromised renderer requests remain main-validated; disk theft remains subject to OS protection with unavailable encryption rejected. No threat boundary is widened by rescheduling already-owned work.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20
