# Canonical fake thread publisher

## Files read
- `e2e/fixtures/launchPairedApp.ts` → `LaunchPairedAppOptions`, `startFakeServer`: independent per-host selection and reply/push/reconnect interception.
- `e2e/fixtures/scriptedThread.ts` → `createScriptedThread`: compatibility path to preserve, never call from canonical mode.
- `e2e/fixtures/scriptedThread.test.ts`: existing adapter assertions remain unchanged.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`, `ThreadQuery`, `ThreadReply`: complete delivery contract.
- `src/shared/wire/types.ts` → `SessionStateFamily`, `ConversationSummary`: explicit live/session provenance.
- `e2e/thread-activation.spec.ts` → `windowFrames`: separate data and final certificates, trusted paging input.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`: positive opening barrier and separate data/final frames.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: preserve replay and native prerequisites; no fresh provider or physical-effect claim.

## Context
One shared harness behaviour: publish authored canonical thread facts without legacy translation. Six sibling migrations consume it. Existing default and native paths stay intact. No production or visual changes. No ADR needed.

## Design
Add `createCanonicalThread` and its seed contract under `e2e/fixtures/`. Each instance belongs to one fake host; each seed supplies a conversation summary, epoch, version and complete items. Seeds and updates are copied. No generated user receipts, sessions, item IDs or revisions.

`publish(bytes): Uint8Array[]` retains authored addition/change/append updates and returns their unchanged wire frame. Revision ownership, epoch, version progression and item identity must agree. Supported live/control frames pass unchanged, with no inferred session/content effects. Unsupported legacy content frames throw a fixture error.

`reply(bytes, frames): Uint8Array[]` publishes authored replies, supplies explicit summaries for list requests and answers complete opening/page/catch-up queries. Latest and older windows respect the requested limit and a fixture window-size cap (default 200), ordered by order then identity. Older windows contain only orders strictly below the request. Certificates derive continuation and older availability from retained facts. Same-epoch catch-up returns items changed since the checkpoint, including empty current results; a different epoch returns an opening replacement. Data frames precede a separate empty final frame correlated to the request. Data batches stay below 32 KiB where possible.

The launcher selects `{ threadMode: 'canonical', thread: publisher }` independently per host. Its replies, pushed frames and reconnect frames use that publisher; only scripted mode constructs the old adapter or history aliases. Native remains untouched. A focused launcher control verifies adapter bypass as well as the real Electron scenario.

## State + concurrency model
Synchronous fixture-owned maps hold conversation facts and each item's last changed version. Requests have no shared mutable query context; each response is constructed atomically. No streams, timers, subscriptions or background tasks are introduced. Existing launcher teardown owns daemon/app resources.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Add, change, append and repeated invalid revision | `retains authored revisions and rejects wrong ownership` |
| Colliding conversation/item IDs across hosts | `isolates hosts, conversations and overlapping query identities` |
| Repeated/current catch-up and changed epoch | `resumes checkpoints and replaces a different epoch` |
| Empty opening and exhausted older page | `certifies bounded ordered windows and empty threads` |
| Send then assistant activity | `never invents acceptance or session transitions` |
| Reconnect with retained checkpoint | Electron `canonical facts open, stream, page and reconnect without the adapter` |

## Error handling
Fixture contract errors throw synchronously for unsupported frames or inconsistent scope/revisions. These are authored-test invariant violations, not application I/O failures. Native mode remains available for deliberately malformed or unanswered queries. No new UI errors.

## Testing strategy
- Test first with focused Vitest controls for ordering/limits/certificates, query correlation, isolation, revisions and retained-vs-emitted equality, explicit live metadata and legacy rejection.
- Add an Electron scenario observing actual thread requests, positive opening/addition/append rendering, trusted older paging and reconnect checkpoint catch-up without duplicates.
- Add a source boundary assertion demonstrating canonical launcher selection never constructs the adapter.
- Run affected and preserved adapter units, pre-verify, application/client typechecks plus a temporary focused TypeScript config covering new fixture/tests/spec, and build after final merge of main.
- Run the complete configured fake-plus-recorded application suite on macOS through the approved helper/native route, retaining counts and artifacts. Other OS outside verification scope. Existing recordings and live-only assertions unchanged.

## Open Questions
None. Cleaner shape considered: reuse the compatibility adapter's storage; rejected because it would preserve inferred acceptance/session behaviour and couple sibling migrations to legacy scripts.

## Scope check
One independently useful shared-harness deliverable, four observable acceptance criteria. Estimate 650 written lines including plan, two new exported fixture contracts at most, one launcher integration, fewer than ten fixture rejection branches. Analogue `8d2f3a03` wrote 365 publisher + 125 test lines. No in-flight feature branches overlap the planned files at initial fetch.
