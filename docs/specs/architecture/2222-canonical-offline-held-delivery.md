# Canonical offline held-message delivery

## Files read
- `e2e/disconnected-message-delivery.spec.ts` → reconnect-mode loop: intercepted sends, socket writes, contrast, settlement and replay barriers.
- `e2e/offline-conversation-actions.spec.ts` → `event`, `observe`: held reading/actions, attachments and first-opening query counts.
- `e2e/offline-held-responses.spec.ts` → `event`, `permission`, `questions`: unavailable-owner prompt controls.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: retained authored facts and correlated query replies.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: per-host canonical activation rejects legacy content.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: independent second-host publisher and real Electron transport.
- `e2e/canonical-thread.spec.ts` → opening/reconnect example; `e2e/queued-backlog-interrupt.spec.ts` → observed device identity and queued fact lifecycle.
- `docs/knowledge/features/development-verification.md` → Source and contract checks: author sessions, acceptance and same-item redelivery explicitly.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md` → keep replay, native prerequisites and live-only assertions unchanged.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `playwright.config.ts`, `tsconfig.client-tests.json` → test boundaries and configured Linux gate.

## Context
Replace legacy content translation in the nine existing offline scenarios, retaining their product gates. This is the bounded migration admitted by refinement in place; no new product behaviour or production changes. The existing three cohorts remain together as assigned. Estimated written work: approximately 430 lines including this plan, no new exported API, ten launcher/second-host consumers, five acceptance criteria, no production reject branches. Remote feature-branch audit found no overlapping owned-spec edits at planning. No ADR or documentation change is required.

## Design
Each launched fake host selects canonical mode with its own `createCanonicalThread`. Seeds supply explicit conversation summaries, current session, epoch, version and complete `ThreadItem` facts. Spec-local typed fact/update builders keep authored identity, order, lifecycle and content visible at the call sites; no shared fixture migration.

Disconnected delivery starts with an authored streaming assistant item and a supported scoped turn-state reading. Accepted sends retain the IPC interception and write observations. Only explicitly published user facts with the observed message/device identity acknowledge sends. The same queued item changes to delivered; assistant additions and status changes retain visible streaming and settled barriers. Redelivery changes the accepted item's revision without adding a new identity, followed by the existing rendered replay barrier.

Offline actions explicitly publish attachment-bearing user acceptance, held assistant text and queued work. The unopened chat is seeded before launch with its own facts; a live update before it has an accepted epoch stays hidden until its first connected query. Ownership/connection/attachment and prompt injections remain controls; remove content translation from both `event` helpers. Held responses use an explicit retained assistant fact where needed and preserve all permission/question controls.

## State + concurrency model
No application state changes. Each publisher owns one host's retained facts; ordered updates advance its version. Existing Electron launch/teardown owns transport cleanup. Keep intercepted-send cleanup, positive rendering barriers and animation-frame settlement. Supported scoped readings explicitly name the seeded current session.

## State transitions and identity reuse
| Event | Existing mounted coverage |
| --- | --- |
| Automatic/explicit/failed reconnect; two held sends drain in order | `accepted disconnected messages drain and settle: automatic/explicit/terminal` |
| Queued acceptance to delivered; streaming to finished; accepted item redelivery | Same three reconnect modes, cursor and replay snapshot assertions |
| Offline reopen/copy; independent host send; explicit reconnect action | `held reading, draft and queue survive offline actions, reopening and copying; another host and reconnect work` |
| Missing/ambiguous/unavailable action owner | `pre-opened action menu and missing, connecting, failed or ambiguous ownership cannot submit` |
| Unopened offline chat then first connected query | `offline opening does not consume first-history eligibility` |
| Reused permission nonce across trust/permission and reconnect | `permission and trust retain selection offline, including pre-opened confirmation and keyboard attempts` |
| Independent question picks, second host, explicit reconnect response | `questions preserve independent picks and draft offline; a second connected host answers` |
| Repeated unavailable/missing/ambiguous prompt ownership | `all unavailable statuses and missing or ambiguous ownership block both prompt families` |

## Error handling
Preserve existing terminal reconnect failure, rejected-answer notice, unavailable-owner guards and forced click/keyboard controls. Canonical fixture validation rejects legacy content and invalid updates; no new error handling.

## Testing strategy
- Activate canonical mode first to demonstrate the old content setup fails, then migrate facts without removing product assertions or increasing timeouts.
- Run all nine owned mounted scenarios on Linux with retries zero; preserve screenshots outside the worktree.
- Run `npm run typecheck`, `npm run typecheck:client-tests`, and a scratch TypeScript project including all three changed specs and their imported helpers/declarations.
- After final main merge run pre-verify with the existing canonical-publisher unit regression and `npm run build`.
- Dispatcher owns the normal configured complete application acceptance gate, including recorded clients/native prerequisites; use exact-candidate evidence there, without a duplicate builder complete-suite run. No fresh provider/physical-effect proof or macOS check is claimed.

## Open Questions
None.
