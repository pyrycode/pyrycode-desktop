# External-link handoff on canonical thread facts

## Files read
- `e2e/assistant-link-opens-externally.spec.ts` → `replyFramesFor` and both mounted cases: preserve handoff, denial, navigation and window assertions.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: authored summaries/items, exact revisions, separate correlated query certificates; no inferred acceptance.
- `e2e/fixtures/canonicalThread.test.ts` → canonical publisher controls: ownership, order, revision, adapter bypass and legacy rejection.
- `e2e/fixtures/launchPairedApp.ts` → `startFakeServer`: canonical selection covers replies, pushes and reconnect without history aliases.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: canonical selection bypasses the compatibility adapter.
- `e2e/code-block-copy.spec.ts` → mounted canonical send/request observations: local pattern.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: complete authored facts and exact-base completion.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/assistant-markdown-renderer.md`, `docs/knowledge/features/development-verification.md`: Markdown routing and positive mounted proof boundaries.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: retain replay, storage/native prerequisites and live-only assertions.
- Issues #2268 and #2226 refinement evidence; analogue #2250 at `c08c659a` (72 additions, 39 deletions in its spec).

## Context
Replace legacy assistant delta/turn-end fixture production for the existing external-link regression gate. Both web and Obsidian cases exercise one handoff boundary. No production, visual, protocol or IPC change. No ADR needed.
Scope: one useful deliverable, about 160–200 written lines including this plan/evidence, zero new exported surfaces, two local consumers, three acceptance criteria and no production reject branches. The sketch and written plan fit all ceilings. Remote feature-branch audit found no overlap in the owned spec.

## Design
Each mounted case constructs a fresh canonical publisher with an explicit current session, epoch, version and empty opening thread. `replyFramesFor` retains its opened-conversation guard and emits complete assistant facts only after the trusted composer send: a running assistant item followed by an exact-base revision marking it finished/inactive. The shared publisher retains these facts and answers actual thread queries with correlated data and separate final certificates. Unknown requests return no extra content; no legacy history alias or compatibility adapter is selected.
Record actual incoming envelopes per case. Positively observe the opening catch-up for the seeded conversation, no rendered links before send, and the expected send payload before accepting the rendered reply. Preserve every existing URL/text literal, timeout, allowed/denied anchor assertion, main-process recorder, single-call handoff, window count, document URL and composer assertion. No acceptance receipt is invented; these cases do not require an accepted user row.

## State + concurrency model
Only test-local canonical publisher state is added. Each launch owns its publisher/request list. Existing fixture teardown owns Electron, daemon and forwarder shutdown. No new async task or subscription is introduced; reconnect uses the same canonical publisher through existing fixture wiring.

## State transitions and identity reuse
| Event | Contract and coverage |
| --- | --- |
| Fresh launch for either case | Independent empty epoch/session-bound seed; both named mounted cases observe the actual opening query and absence of anchors before send. |
| Trusted send to opened conversation | Only `SEEDED_ROW.id` receives assistant facts; both mounted cases observe the expected send before links. |
| Assistant completion | Added running item at revision 1, then finished/inactive revision 2 with exact base 1; both mounted cases require rendered Markdown links. |
| Repeated query/reconnect | Existing publisher retains authored facts and supplies correlated certificates; existing canonical fixture units cover catch-up, scope isolation and adapter bypass. No new reconnect behavior is requested. |
| Allowed link activation | Existing recorder positively observes exactly one expected call before window/navigation absence checks in each case. |

## Error handling
No new failure mode. Canonical publisher rejects legacy content or invalid ownership/revisions. Wrong-conversation sends return no reply, preserving the mounted positive-control failure. Denied Obsidian actions remain text. Synthetic shell handoffs remain stubbed before clicking.

## Testing strategy
- Test first: select canonical mode while legacy reply production remains, then run the owned cases without retries and observe rejection of `assistant_delta`; replace that production with authored updates.
- Run existing canonical publisher fixture units; they cover separate certificates, revision ownership, orders and adapter bypass.
- Run pre-verify with `e2e/fixtures/canonicalThread.test.ts`, standard typecheck, client-test typecheck, and an external scratch tsconfig including the owned spec, canonical fixture/unit inputs and ambient declarations. Confirm those inputs with TypeScript's file list.
- Build and run both original mounted cases on Linux with retries zero; retain exact revision, named executed cases and executed/passed/failed/skipped counts in this plan and PR.
- Dispatcher/verifier retain the complete configured application gate. No duplicate full suite, new live/provider/encryption/physical-effect proof or macOS check.

## Open Questions
None.
