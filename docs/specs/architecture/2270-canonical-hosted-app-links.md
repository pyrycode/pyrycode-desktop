# Canonical hosted app link regression gate

## Files read
- `e2e/hosted-app-links.spec.ts` → `scenario`, `reply`, `launch`, `discovered`: four mounted routing cases, UUID pairing and positive processing barriers.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: authored facts, correlated query replies and bounded control passthrough.
- `e2e/fixtures/canonicalThread.test.ts` → canonical publisher regressions: byte identity, retained facts and retired-content rejection.
- `e2e/fixtures/launchPairedApp.ts` → `startFakeServer`: independent publisher selection for each host, including pushes and reconnect.
- `e2e/progressive-markdown.spec.ts` → `markdownThread`: complete assistant facts and exact-base terminal revisions.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: authored protocol contracts.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness.md`: canonical fixtures bypass compatibility and require explicit session provenance.
- `docs/knowledge/features/development-verification.md` → Hosted app link verification: preserve all four cases and ordered processing barriers before absence checks.
- `playwright.config.ts`, `tsconfig.client-tests.json`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: native prerequisite, focused compiler coverage and preserved replay/live boundaries.

## Context
Move the existing hosted-link routing gate off legacy content translation without changing product code or behavior. Its six hosted control frame allowances stay with their consuming gate. One independently verifiable result; forecast approximately 300 written lines, no production files, new exports or simultaneous consumer migrations, three acceptance criteria and no production reject branches. The nearest analogue is #2250 (`c08c659a`, 72 additions/39 deletions in its spec).

## Design
Each `scenario` creates its own canonical publisher with the existing owning conversation summary, explicit current session, epoch, version and an empty initial window. Both first-host options and `control.secondServer` select canonical mode. Observe real opening thread requests before using each conversation; reject any legacy history alias in the script.

Replace `reply`'s legacy assistant delta with a complete ordered running assistant item. The streaming case settles that same item with an exact-base revision, then adds an explicit terminal turn fact, preserving the original terminal-event processing barrier. Other cases retain their intentionally running content. No sends occur and no acceptance is inferred.

Allow only `apps`, `app_updated`, `app_removed`, `app_cancelled`, `app_response` and `app_response_chunk` alongside the existing control allowlist. Return the original byte object; do not mutate canonical facts or manufacture withheld replies. Preserve legacy-content rejection and session-scoped controls/readings. Reader #2267 overlaps the two canonical fixture files with additive attachment support; reviewed its diff, no causal dependency, preserve both on merge.

Keep every original mounted assertion, native resource check, timeout, trusted interaction, hold/release and discovery barrier. Scratch captures move to this ticket's `/tmp` directory.

## State + concurrency model
Test-local publisher and version ownership only. Existing application stores, transport teardown, host pairing, reconnect dispatch and delayed hosted replies remain unchanged. Host publishers never share facts even though app IDs match. The launch fixture owns process/listener cleanup; `discovered` retains its `finally` unsubscribe.

## State transitions and identity reuse
| Event | Regression |
| --- | --- |
| Running assistant becomes settled, repeated and keyboard activation, return restores draft and releases native view | `streaming and settled links preserve conversation drafts` |
| Same app ID across independently paired hosts; delayed A discovery and command result after B selection | `latest host selection survives delayed replies` |
| Malformed/unpaired target; pairing cancelled then succeeds without automatic activation | `invalid and unpaired links stay bounded` |
| Same host reconnects repeatedly, capabilities change, held/failed discovery recovers, app removed | `links reuse discovery recovery` |
| Correlated hosted replies, cancellation/chunks and updates repeat without changing retained facts; withheld replies stay withheld | new canonical publisher hosted-frame regression |

## Error handling
Retain existing unsupported/missing/stopped/failed app and discovery-error tests without changing product handling. Unknown/retired content remains a publisher error. Hosted protocol failures pass through unchanged for the existing real consumer to classify.

## Testing strategy
- Write a publisher regression first and observe the unsupported hosted frame failure, then add the bounded allowance. Check original bytes, identities/correlation, withheld replies, unchanged thread queries and retired-content rejection.
- Run canonical publisher and publisher-selection units. Run typecheck, client-test typecheck and focused TypeScript coverage including all three changed test/helper inputs.
- After final main merge, run pre-verify and build. Prepare Electron native ABI after Node checks, then run all four named cases with `--retries=0` under the normal config, retaining `native-writer` separately counted.
- Record exact tested revision, Linux, named cases, executed/passed/failed/skipped counts and evidence paths in the PR. Dispatcher/verifier retain the complete configured gate; no duplicate full suite or new live proof. Captured replay/history/protected storage, native prerequisites and existing live-only assertions remain intact. macOS is outside scope.

## Open Questions
None.
