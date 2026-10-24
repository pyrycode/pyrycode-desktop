# Canonical background-task finished counts

## Files read
- `e2e/background-task-finished-count.spec.ts` → `fake`, `roster`, `updated`, `panelFor`: owned mounted scenario and ordered final-state barrier.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: retained authored updates, correlated query data and separate final certificates.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `SEEDED_ROW`: canonical selection, request observation and trusted pairing/navigation.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: explicit attribution, order and exact-base revision contracts.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `taskLinked`: usable matching task/tool linkage.
- `src/renderer/src/screens/conversation/threadTaskPresentation.ts` → `threadTaskPresentations`: shown membership and active running count.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/conversation-shell-background-tasks.md`: canonical authoring, positive processing barriers and retained-task drawer contract.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `playwright.config.ts`, `tsconfig.client-tests.json`: native prerequisites, replay/live boundaries and spec typechecking.
- `docs/specs/architecture/2255-canonical-local-send-status.md` (matching analogue plan): counted Linux checks and Node-before-Electron preparation.

## Context
Migrate one mounted running-count/retained-membership scenario from #2227, under implementation family #2213 and feature root #2209. Reuse merged #2210. Scope is this spec and plan; no production, shared helper, visual or documentation change. Remote feature-branch audit found no overlap in the owned spec. #2228 retains its separate fake-outcome work; #2153 and #2191 remain separate repairs. No ADR is needed.

## Design
Replace the legacy roster/update/history script with `createCanonicalThread` selected through `{ threadMode: 'canonical', thread }`. Supply the seeded conversation's current session and agent, an explicit epoch/version, and two shown, active `tool_call` facts. Give each a unique item/order/task/tool identity, session/agent attribution, matching direct `task_link` and its original description. Advertise the complete thread capability. Observe the actual scoped version-zero opening catch-up and render both descriptions positively.

Keep the original test title, viewport, pill assertions, trusted menu interactions and final retained-row assertions. Finish the first item with an exact-base revision (`finished`, inactive). Open the drawer while the pill reads one. Revise the second item with an explicit active nonterminal patch and wait for its unique rendered patch before checking one again. Refresh the first item's content while preserving its finished/inactive state and description; wait for a distinct rendered refresh marker before checking one. Finish the second item with `stopped`, inactive, retaining both shown facts. The ordered zero-pill barrier follows all updates. Close and reopen through More actions → Background tasks and retain both rows, descriptions, Finished · 2 and the Completed/Stopped outcomes.

The canonical publisher owns correlated opening/query replies and separate final certificates. The request observer returns no content. No scripted publisher, legacy task content, roster absence or history alias supplies facts.

## State + concurrency model
Only spec-local authored facts/revision counters and observed requests are new. Updates use one ordered daemon channel, advancing versions and exact base revisions. Existing launcher teardown owns Electron, relay and daemon cleanup; no new async job or production state.

## State transitions and identity reuse
All events are covered by `a terminal status takes a listed task out of the pill count but not out of the panel`.

| Event | Positive oracle and invariant |
| --- | --- |
| Canonical opening | Actual scoped catch-up observed; both descriptions and two-task pill rendered. |
| First item settles | One-task pill; first row Completed and retained. |
| Second item nonterminal revision | Unique patch rendered; second stays active and count remains one. |
| First settled item refresh, same identity | Unique refresh marker rendered; first stays inactive and count remains one. |
| Second item settles, same identity | Stopped row plus ordered zero-pill barrier. |
| Drawer closes/reopens | Trusted menu access retains both original descriptions and Finished · 2. |

## Error handling
No new production failure mode. Preserve existing assertions and original timeouts. Invalid authored identities, orders or revisions fail in the canonical publisher rather than being translated. Required mounted failures remain evidence, without retries, skips or assertion weakening.

## Testing strategy
- Test-first oracle: add observation of the canonical opening query and positive task descriptions; run against the old fixture and retain the expected failure before authoring canonical facts.
- Run pre-verify with the existing canonical publisher unit file, app typecheck, client-test typecheck, focused strict TypeScript including the owned spec and imported helpers, and build after the final main merge.
- Finish Node checks before Electron native preparation. Run the owned Playwright spec on Linux with retries zero and its configured native-writer prerequisite; record exact revision/build identity and executed/passed/failed/skipped counts.
- Dispatcher/verifier retains the complete configured application gate, captured-client replay, canonical activation, captured history, protected storage and native prerequisites. Reuse matching candidate evidence without another full-suite run here. Existing live-only requirements remain; no fresh provider, encryption or physical-effect claim. Another OS is outside scope.

## Open Questions
None. Shared publisher and production task presentation already provide the required behavior.

## Scope check
One independently useful mounted behavior with four acceptance criteria; approximately 200 written lines including plan and evidence, zero production files, new exported APIs, simultaneous production consumer changes or production reject branches. The sketch and written plan fit every ceiling.

## Validation evidence
Linux x64, 2026-10-24. Final implementation revision `9c2aee7d8c19a1405c7616744c659a139967003c` contains final main `b94c107906ba0d75570a1b2892f82d13ac38d7f8`. Normal build provenance records that implementation revision and `sourceDirty: false`; retained metadata and bundle hashes are `/tmp/builder-2271/build-provenance.json` and `/tmp/builder-2271/build-sha256.txt`. This evidence-only addition changes no executable input.

- Red control: requiring the opening two-task pill before pushed updates failed against the legacy fixture because the pill was absent. Two executed, one passed (native prerequisite), one failed (owned case), zero skipped/retries. Evidence: `/tmp/builder-2271/red.json`, `/tmp/builder-2271/red.log` and `/tmp/builder-2271/red-results/`.
- Final mounted command: `npx playwright test e2e/background-task-finished-count.spec.ts --retries=0 --reporter=list,json`. Two executed/passed, zero failed/skipped/flaky/retries: the owned scenario and `finite protected writer backlog preserves native keyboard and both event loops`. Evidence: `/tmp/builder-2271/owned-final.json`, `/tmp/builder-2271/owned-final.log` and `/tmp/builder-2271/owned-final-results/`. All three fake-daemon setup attachments report first-attempt opened responders and valid upgrades; both launch-fate attachments have no teardown failures.
- Final pre-verify: all five checks passed; canonical publisher units 17 executed/passed, zero failed/skipped. Evidence: `/tmp/builder-2271/pre-verify-final.log` and `/tmp/builder-2271/unit-final/unit-w76nlpep/`.
- App typecheck (pre-verify/build), `npm run typecheck:client-tests`, and focused strict TypeScript including the owned spec, preload declarations and Noise WASM declarations passed. Focused command: `npx tsc --noEmit --strict --skipLibCheck --esModuleInterop --module ESNext --moduleResolution Bundler --target ES2023 --lib ES2023,DOM,DOM.Iterable --jsx react-jsx e2e/background-task-finished-count.spec.ts src/preload/index.d.ts src/main/transport/noise-c.wasm.d.ts`. Logs: `/tmp/builder-2271/client-types-final.log`, `/tmp/builder-2271/focused-types-final.log`.
- `npm run build` passed after final main merge and pre-verify; `/tmp/builder-2271/build-final.log`. Node checks completed before sequential Electron native preparation (`/tmp/builder-2271/electron-final.log`); no native rebuild overlapped the final mounted run.
- Earlier prerequisite failures remain recorded: sandbox installation hit esbuild EPERM and succeeded through normal approved escalation; premature pre-verify lacked Electron provenance (`/tmp/builder-2271/pre-verify.log`); the next attempt passed all 17 units but detected advancing main (`/tmp/builder-2271/pre-verify-ready.log`). Final main merge and fresh checks resolved both pre-verify failures without changing assertions.

Dispatcher/verifier retains the complete configured application gate and its counted candidate evidence, including captured clients, canonical activation, captured history, protected storage and native prerequisites. The focused run does not substitute for that gate. Existing live-only requirements remain unchanged; no fresh provider, encryption or physical-effect proof is claimed. Another OS is outside this ticket's verification scope. Final scope is 60 added scenario lines plus plan/evidence, below the admitted estimate and every ceiling; no design deviation or unresolved question.
