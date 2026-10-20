# Bounded rollback fixture reliability

## Files read

- `src/main/chatHistoryStore.test.ts` → `setup` and the bounded rollback family: real reversible protection, temporary SQLite, replay and fresh-owner proof.
- `src/main/chatHistoryStore.ts` → `createChatHistoryStore`, `run`: queued mutations return classified failures without retry.
- `src/main/historyDatabase.ts` → `createHistoryDatabase.transactionSteps`: each callback accounts for 16 generator units; default replay yields through real `setImmediate`.
- `src/main/indexedThreadHistory.ts` → `mutateThread`: item admission and upsert precede authenticated-index flush and the protected header write.
- `docs/knowledge/features/chat-history-testing-storage.md`, `chat-history-storage.md`, `chat-history-testing.md` → preserve protected disk/reopen coverage and distinguish it from OS-keychain proof.
- `docs/knowledge/features/development-verification.md` → compare actual suite composition and retain counted evidence.
- `vitest.config.ts`, `package.json` → default Node Vitest configuration; no worker, retry or timeout override.

## Change

One deliverable: reduce the bounded rollback fixture's redundant storage work while preserving all three failure modes. Start with 64 rather than 80 items, subject to observed callbacks proving every injected failure follows at least eight 16-unit turns. A smaller probe must fail that progress assertion before selecting the representative batch. Reuse the fresh owner that proves rollback for explicit replay, avoiding the immediate redundant reopen. Retain the existing triggers, private failure text, exact items/checkpoint read, duplicate replay and final fresh reopen. Count transaction attempts to pin absence of automatic retry. Production storage, scheduling, the 5000 ms deadline and neighboring bounded-work/real-timer tests stay unchanged. No new exported API, production branch or consumer migration; three acceptance behaviours, approximately 160 written lines including this plan and evidence, within all ceilings. The analogue #2122 wrote 152 added/6 deleted lines; this narrower one-file test fixture needs no browser work. Remote feature overlap check after fetching main found no other branch touching this test file. No ADR or documentation-stage requirement.

## Testing strategy

- Measure the original header case before editing, retaining revision, configuration, counts and case timing.
- Probe the smaller fixture against the existing eight-turn assertion; retain its failure and all three repaired-mode progress observations.
- Run the complete storage file three consecutive times, then default `npm test` twice consecutively with unchanged configuration, no retry and no worker flags. Retain raw logs/JSON under `/tmp/builder-2155/` and summarize counts, timings, provenance and suite sensitivity here.
- After final main merge, run the affected-file pre-verify check and `npm run build`. Linux is this ticket's operating system; other operating systems are outside verification scope. No live scenario is added: reversible unit protection does not establish OS-keychain security.

## Security review

**Verdict:** PASS

- Trust boundaries: real SQLite and protected-record decoding remain exercised through `createChatHistoryStore`; no production admission or parsing changes.
- Tokens/secrets: fixture text is synthetic; `setup` keeps reversible encryption and no credentials enter this test.
- File/storage operations: `setup` uses isolated `mkdtemp` roots and real `createHistoryDatabase`; `afterEach` closes owners and removes only registered fixture roots. Atomic rollback and fresh reopen remain asserted.
- Electron attack surface: no Electron window, IPC, navigation or preload changes; this Node-only fixture adds no privileged interface.
- Cryptographic primitives: existing reversible test transform remains a fake of protection only, never claimed as production encryption or a new cryptographic primitive.
- Network/I/O: no network added; real disk I/O remains, with no sleeps, retries or fake database.
- Errors/logs/telemetry: retain exact `write-failed` and absence of `private-failure` in all collected diagnostics for each injected failure.
- Concurrency: retain eight bounded callbacks before each failure, one attempted transaction, the production replay scheduler and final fresh owner. Neighboring timer/work assertions remain untouched.
- Threat alignment: untrusted-file atomicity and private-text suppression retain their real-storage tests. Relay, token theft, daemon parsing and renderer isolation receive no changed surface in this test-only repair; their production protections remain unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20

## Revisions

2026-10-20: the 16-item controlled probe executed three cases: turn and header passed every invariant; index failed specifically because only two bounded turns preceded its trigger. Use 64 items for index and 16 for turn/header instead of uniformly using 64. Authenticated-index flushing yields additional work before the turn/header faults, but the index fault fires at the first flush insertion. Every case retains the same minimum eight full 16-unit turns, unchanged failure injection, real storage and default replay scheduler. Reuse the rollback-reading owner for replay as planned. The failed probe is retained at `/tmp/builder-2155/probe-16.{log,json}`; it is diagnostic evidence, not an acceptance pass.

## Linux acceptance evidence — 2026-10-20

Original measurements executed clean revision `a122aef8bb62940a28dec86a322b0ca2a33d7555` (plan only above main). Repaired consecutive acceptance runs and final checks executed clean candidate `4ed7c86778f569bbf88ae53cb9e769eeb44c7a07`, containing final merged main `845cf9a251960a1cbe26b342dcc246d650c070df`. The subsequent evidence commit changes only this plan. Runtime: Linux x64, Node 25.8.0, npm 11.11.0, Vitest 2.1.9, better-sqlite3 12.4.1; six available CPUs, eight reported CPUs. `runtime.json`, `revisions.txt`, `config.sha256` and `test-source.sha256` are retained under `/tmp/builder-2155/`.

Configuration remained unchanged: Node environment, original include globs, default worker settings and retries zero; no pool, concurrency, worker, retry or timeout flags/overrides. The original 5000 ms rollback deadline remains implicit. Baseline storage tests and `vitest.config.ts` are also unchanged relative to historical `5f3aec7f`. Config SHA-256: `40c90d8f917e3a184c14ef42c02a091394ce1cb8842ade4f4f2f0d340a517c0e`; package-lock: `ce7ecdb807ffdceacd7e93c272b989f1c1f3f07a9b045ab58d8879088fe91026`; repaired test source: `29cc7239e53eeee0e5d64483d8189d035725608d790c5d5889f8a48b27d0cb6e`.

Commands used `npm test -- src/main/chatHistoryStore.test.ts` for complete-file runs and `npm test --` for complete default-suite runs, followed only by `--reporter=default --reporter=json --outputFile=/tmp/builder-2155/<name>.json`; stdout/stderr went to matching `<name>.log`. Original-header additionally selected its complete original title with `-t`; probe/focus selected `-t 'rolls back bounded'`. Those selections are diagnostic only. The three repaired file runs were consecutive, followed by two consecutive default runs, with no retries, edits, installs or worker changes between them.

| Report name | Executed / passed / failed / skipped or unselected | Turn ms | Index ms | Header ms |
| --- | --- | ---: | ---: | ---: |
| original-header | 1 / 1 / 0 / 30 unselected | — | — | 1413.4 |
| original-storage | 31 / 31 / 0 / 0 | 1192.7 | 1425.2 | 1419.8 |
| probe-16 (expected diagnostic failure) | 3 / 2 / 1 / 28 unselected | 497.9 | 153.2 | 416.1 |
| repaired-focus | 3 / 3 / 0 / 28 unselected | 493.7 | 1351.8 | 320.6 |
| storage-1 | 31 / 31 / 0 / 0 | 370.3 | 1445.6 | 455.0 |
| storage-2 | 31 / 31 / 0 / 0 | 378.4 | 1551.5 | 467.8 |
| storage-3 | 31 / 31 / 0 / 0 | 566.3 | 1860.8 | 557.0 |
| default-1 | 9903 / 9903 / 0 / 3 | 1098.4 | 3077.1 | 821.5 |
| default-2 | 9903 / 9903 / 0 / 3 | 797.3 | 4070.3 | 654.0 |

Both default runs passed 421 files, taking 215.34 s and 233.80 s. Their three skips are unchanged credential-gated live relay tests: the daemon post-handshake round trip, operator-gated post-handshake open, and deliberate server-static mismatch. No live acceptance is claimed. Pre-verify passed all five checks, including another 31/31 affected tests (0 failed/skipped, no suite/unhandled errors) after its native rebuild; evidence is copied to `/tmp/builder-2155/pre-verify-units/`. `npm run build` and `npm run check:docs` passed; logs are `build.log`, `check-docs.log` and `pre-verify.log` in that same scratch root. Other operating systems are outside this ticket's verification scope.

The family now requests 96 rather than 240 items overall (60% fewer), and removes one redundant reopen per case. In complete-file runs the header case is 61–68% cheaper than the local original; its focused measurement fell from 1413.4 to 320.6 ms. Complete-file wall times were 29.91 s before and 29.86/33.35/44.32 s after, so these measurements do not establish an overall suite throughput improvement. Default-suite header times of 654.0–821.5 ms and index times up to 4070.3 ms demonstrate remaining composition/load sensitivity. All original semantic assertions and neighboring bounded-work/timer tests pass; no production scheduling cause is claimed.

Historical failure remains failed: #2079 reports 9918 executed / 9917 passed / 1 failed / 3 skipped at `5f3aec7f`, header 5287 ms against 5000 ms, followed by its unchanged focused pass at 2833 ms (1 executed/passed, 30 unselected). That suite composition differs from the current revision's 9903 executed cases. Retrieved the named bundle `9902504b907216c177c15cf1845ef24a8c4711e2486d86106bba2eec039fdc63` into `/tmp/builder-2155/historical-2079/`; it retains the agent log and metadata, not the original full scratch unit logs. The local original pass does not reproduce or erase that historical timeout.

Report SHA-256 values (matching raw JSON and logs remain in `/tmp/builder-2155/`; full manifest: `reports.sha256`):

```text
b8eda9bd2047a9ac4916c56be558fab0ace6adc805e06c7788bc6d5ce012369e  original-header.json
4ab919df8fec76887fb4a3fe9792a2cfd464034122b76f3c6cd8a9631c95f3db  original-storage.json
34d04749098c0a0c503e4fea564404fb6af69327613eddcd30fb43cd0594175c  probe-16.json
fd66dbdddcb2736e95b6e7627187ab3a143bc97f57afad6e0f27a0e5b5b94d78  repaired-focus.json
c6a0470b5fc53a0d8a093b73a915b764038579807c9c61c6d22b3be480b43e81  storage-1.json
7a1a9cf2c446ee57c0a16a17a38e2513dc4960ed0301c0ba80dd82f03aaaaa22  storage-2.json
334dde1c3111d3cbaa92a1d2fedf29021dd48cf3e19d2d19e0556bdff2fbf0af  storage-3.json
5d2a07404d1eea8432ed89ff43bd7d8db8b5fd490e54eb32d7799235e2e1bbdd  default-1.json
7817a11411ac3f63a34286d9c33b4499154a6da89c976cd14b143ccd7d958a3a  default-2.json
```
