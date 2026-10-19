# Saved-list title observation

## Files read
- `e2e/real-claude-thread.spec.ts` → `savedThread`, saved-title read: saved replies precede a single collapsed list observation.
- `e2e/fixtures/threadReplyEvidence.ts` and its tests → `savedRepliesMatch`: thread content proof, independent of list persistence.
- `e2e/fixtures/certifiedCheckpoint.ts` and its tests → `readCertifiedCheckpoint`: bounded read-only observation precedent.
- `src/renderer/src/store/chatHistoryWriter.ts` and its tests → `capture`, `captureChange`, `drain`: lists and owned mutations have separate buffered work.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: serializes submitted IPC, not future renderer submissions.
- `src/main/chatHistoryStore.ts` and its tests → `createChatHistoryStore`: protected list/thread read and storage setup.
- `src/shared/chatHistory.ts` → `ChatHistoryResult`: distinguish missing, storage errors and unexpected kinds.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and test-first practice.
- `docs/knowledge/features/chat-history-storage.md` → Buffered replacements: natural receipt and serial drain; thread durability is insufficient for list durability.
- `docs/knowledge/features/development-verification.md`: Node checks finish before Electron SQLite preparation; retain counted offline evidence.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: strict replay contract, retirement settlement and existing reset fixme.

## Context
One useful behavior: observe the exact host/chat's durable string title before
retiring its protected profile, with the causal regression kept alongside it.
The historical collapsed null does not identify a production cause. A controlled
delayed list demonstrates the observation gap without claiming that it triggered
the historical failure. No production or UI changes and no ADR are needed.
No in-flight remote feature branch overlaps the planned files (checked after fetch).

## Design
Add `readSavedListTitle(read, host, conversation): Promise<string>` under
`e2e/fixtures/`. Its read callback returns the actual `ChatHistoryResult` for the
host. Classify results as missing list, absent row, unnamed row, named row,
storage error or unexpected result kind/host. Poll only the first three, using
Playwright's existing default five-second assertion bound. Return the actual
stored string, including an empty string; never derive it from another row,
thread contents or UI. Stop repeating reads on classified errors/unexpected
results or a rejected read, and report static categories/codes without payloads.
The scenario replaces only its one-shot title read; it retains the explicit
`expect(typeof title).toBe('string')` and every surrounding assertion.

Before committing to this contract, considered waiting for a renderer writer
acknowledgement: the protected list result is the smaller and stronger observation
because it directly establishes the required data without new instrumentation.

## State + concurrency model
No application state or background jobs change. A local observation retains the
last classified result and repeats read-only IPC until ready or bounded failure.
The controlled regression uses real writer, list/thread stores, history handler
and protected SQLite storage, with an injected scheduler and held list write to
control receipt/submission/acknowledgement ordering. It never flushes to make the
observation succeed; the test drives the writer's scheduled work independently.

## State transitions and identity reuse
| Event | Regression |
| --- | --- |
| Saved replies precede named-list receipt and persistence | `waits for the exact named list after replies are already saved`: original read yields stored null; repaired read waits through receipt and held write, then returns actual protected title before retirement. |
| Same chat ID on another host / another chat on same host | The controlled regression and `does not accept a different host`: unrelated names cannot satisfy observation. |
| Persistent missing list, absent row or null name | `bounds persistent ...`: fake timers exhaust the unchanged five-second bound. |
| Repeated storage error / unexpected result / rejected IPC | `does not repeat ...`: fail after one observation. |
| Relaunch | Original shared thread scenario: saved replies before and immediately after relaunch, before opening any chat, then saved-row reopen and rendered replies. |

## Error handling
Storage error codes remain failures, with no repeated mutation or error masking.
Unexpected result kinds/host fail explicitly. Pending categories appear in bounded
assertion failures. The regression records ordered static category/event labels
for list receipt, write acknowledgement, protected read and retirement, without
title, reply, host or chat payloads.

## Testing strategy
- Write the controlled regression first and observe failure with the original one-shot observation.
- Focused Vitest tests prove causal ordering, exact coordinates, result categories, bounded missing/unnamed failure and no retry of errors.
- After final main merge: install, pre-verify with the affected unit file, client-test typecheck and build; finish Node checks before rebuilding Electron SQLite.
- Run five consecutive guarded paired batches using the ticket's exact command: both named cases twice, fully parallel, three actual workers, retries zero (20 executed/passed required).
- Run complete guarded `npm run e2e:recorded`; inspect counted reports, zero remaining requests per exchange and zero forbidden launches. Preserve capture hashes/provenance, boundaries, inspector repair and retirement settlement.
- Dispatcher owns the subsequent application gate; verifier reviews both named cases without retry and separates unrelated failures. Existing system-prompt-reset fixme stays explicit. Linux only; offline checks add no provider/live claim.

## Open Questions
None. If the exact list never becomes durable, reassess scope before changing production persistence.

## Scope measurement
One behavior with regression, four observable criteria; estimated 350–450 written
lines, zero production files, one exported helper, one consumer and fewer than
ten result branches. Within all numeric ceilings; no independent split seam.
