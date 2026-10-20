# Protected history paging observations

## Files read
- `e2e/real-daemon-history-on-open.spec.ts` → `coverage`, `mainRead`: collapsed protected results and one-shot paging baseline; synchronous inspection remains intact.
- `e2e/fixtures/savedListTitle.ts`, `savedListTitle.test.ts` → `readSavedListTitle`: bounded result classification and real protected-store regression setup.
- `src/renderer/src/store/chatHistoryWriter.ts` → `mutationSteps`, `drain`: bounded split submissions and acknowledgement-driven cursor.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: saved-host authorization and serialized operations.
- `src/main/indexedThreadHistory.ts` → `load`: pending persistence obligations reject public reads.
- `src/renderer/src/store/threadItemStore.ts` → `beginBatch`: publication and certified ranges.
- `e2e/daemon-item-cache.test.ts` → split-save controls: existing owned-state injection through the real writer.
- `docs/knowledge/features/chat-history-api.md` → Owned authoritative mutations: preserve fail-closed reads until final durable part.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: counted guarded replay, native ABI preparation, capture provenance and excluded reset fixme.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`: test-first and process boundaries.

## Context
One independently useful behavior: trustworthy durable progress for each trusted paging input. Its single-consumer reader and causal/failure controls belong together. The historical Linux failure at `de6e481a` and unchanged isolated pass remain separate outcomes; neither establishes the trigger. The controlled pending-save mechanism demonstrates the observation defect without claiming to reproduce that historical trigger. No production repair or ADR is needed.

Sizing: approximately 450 written lines including plan/evidence, zero production files, one helper export, one scenario consumer, four observable acceptance criteria, fewer than ten classified observation branches. Recount before implementation remains below all ceilings. Remote feature-branch inspection found no overlap with the three planned e2e paths (including #2079).

## Design
Add `readHistoryCoverage(read, host, conversation, before?): Promise<number>` in `e2e/fixtures/historyCoverage.ts`. Consume complete `ChatHistoryResult` values. Return the actual first numeric range start, including zero, only for daemon items with exact outer and inner ownership. With `before`, require a strictly smaller value. Retain the successful value from the polling callback itself; never reread it after success.

Use one five-second polling bound per observation. Missing snapshots, empty ranges, pending-save `unreadable`, and unchanged/increased starts remain pending categories. Other classified errors, rejected reads, unexpected status/kind and wrong ownership terminate immediately with content-free diagnostics. Polling yields static categories, never snapshots or exceptions.

Before Home and each ArrowUp obtain a numeric baseline. After each input start durable-progress observation alongside the existing exact request-count check, so waiting for dispatch cannot add another coverage deadline. Preserve bubble growth, all 205 posts, saved-checkpoint catch-up, trusted input, recovery/order/uniqueness/no-legacy assertions. Leave synchronous inspector access and profile retirement untouched. No new state store, production interface, dependency or harness migration.

## State + concurrency model
Observation state is local to one call: a retained numeric result and static status. It performs read-only IPC; it does not flush writers or retry inputs. The controlled regression schedules the real writer and holds split submission/acknowledgement boundaries outside the handler queue, allowing actual protected reads while the obligation is pending. Gates release and writer/store/database cleanup finish in `finally`.

## State transitions and identity reuse
| Event | Regression |
| --- | --- |
| Split prefix durable before baseline | `waits across split saves at baseline and after dispatch`: old projection is undefined, reader stays pending until final durability. |
| Page dispatched/published while persistence pending | Same regression: request/publication trace precedes unreadable read, then final acknowledgement and strictly older range. |
| Consecutive paging observations | Same regression retains first numeric baseline and uses it for the next save; successful baseline is read once. |
| Unavailable state persists | `bounds persistent ...`: unreadable, missing, empty, equal and increased starts fail by five seconds. |
| Wrong owner/kind, classified error or rejection | `does not repeat ...`: one read, static diagnostic, no content. |
| Zero range start | `returns actual zero without rereading`: zero satisfies availability and strict progress. |

## Error handling
Only `unreadable` is a retryable classified storage result. Missing/empty coverage and no progress are bounded failures, never coverage. Read rejections become `read-failed`; unexpected status/kind and ownership use static diagnostics. No caught error, message content or credentials enter traces.

## Testing strategy
- Write controlled and failure tests first and observe the missing/broken reader fail, then implement.
- Real SQLite/protection, secure-store setup, handler and writer; controlled scheduling at existing writer seam. Assert the original projection fails under held durable prefixes, and the repaired observation does not finish prematurely.
- Fake timers for observation deadlines; real writer event-loop yields remain intact. Cover baseline retention, zero, pending states, strict decrease, all terminal result codes, rejection and exact ownership.
- After final main merge: pre-verify with the new unit file, client-test typecheck, docs check and normal build. Complete Node-native checks before Electron-native rebuild.
- Linux only: five consecutive guarded complete-thread paired batches, each named history/thread case twice, three actual workers, retries zero (20 total passes), followed by complete guarded committed replay. Retain reports, build identity, capture hashes, exchange counts and guard counts in validation evidence. Dispatcher owns configured application gate for both named cases; existing reset-prompt fixme stays excluded. No fresh live acceptance required.

## Open Questions
None. A single observation helper is the smallest shape; no new generalized polling framework.
