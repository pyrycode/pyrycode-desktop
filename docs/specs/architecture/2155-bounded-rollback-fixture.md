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
