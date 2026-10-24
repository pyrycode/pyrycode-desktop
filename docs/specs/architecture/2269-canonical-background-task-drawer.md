# Canonical background task drawer interaction gate

## Files read
- `e2e/background-task-drawer.spec.ts` → `capturingFake`, `turnState` and the continuous mounted scenario: preserve all six ordered interaction phases.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: explicit retained facts, correlated query data and separate final certificates.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchPairedAppOptions`, `SEEDED_ROW`: canonical selection and initial conversation activation.
- `e2e/status-icon-local-send.spec.ts` → scoped turn controls, complete-thread capability and opening-query observation.
- `src/renderer/src/screens/conversation/threadTaskPresentation.ts` → `threadTaskPresentations`: membership, attribution, description and active lifecycle derive from linked task facts.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `taskLinked`: raw task and tool identities must match their link.
- `src/shared/wire/thread.ts` → `ThreadItem`: explicit session, agent, order and revision.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md` → fixture ownership, canonical authoring and positive processing barriers.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `playwright.config.ts`, `tsconfig.client-tests.json` → native/replay boundaries, configured prerequisite and focused TypeScript coverage.

## Context
Deliver one continuous mounted drawer gate using authored canonical facts, from #2227 / #2213 / feature root #2209. Only this spec and plan change. No production or visual change, documentation requirement or ADR. The remote feature-branch overlap check found no other branch editing the owned spec. Reuse merged canonical helpers; #2228's outcome changes are unnecessary here.

## Design
Create one canonical publisher with two preseeded conversation scopes. Each summary explicitly names its current session; each scope has its own epoch, version 1 and one shown active running `tool_call` item, with explicit session/Claude attribution, item identity, unique order and revision 1. The content's task and tool IDs match `task_link.task_id` and `task_link.tool_call_id`, with the original task description.

Select `{ threadMode: 'canonical', thread }` and advertise complete thread capability. `capturingFake` records outbound envelopes and answers the initial list with only the first scoped summary. It supplies no content or history aliases. The publisher owns actual thread query replies and final certificates. Observe positive task content and the conversation's actual version-zero `thread_catch_up` at each opening. Assert no legacy history request was observed.

Keep the original pill/menu/Close toggles, open outline, nonmodal send, geometry at both sizes, overlay Escape arbitration, focused-composer stop, idle Escape and conversation switch in their existing order. Sending remains an outbound observation, with explicit conversation/text identity checks; it does not accept a user row. Session-scoped thinking/idle controls carry matching envelope provenance and cannot alter task membership. Announce the second summary only at the original switch step; positively observe its task before asserting the first task's absence. No subsequent canonical item updates or acceptance are needed.

## State + concurrency model
No new production state or async tasks. The publisher synchronously retains authored seeds. Existing fixture teardown owns Electron, daemon and relay lifetimes. Keep one launch and one continuous drive, using existing awaited DOM and outbound-capture barriers. Finish Node checks before Electron ABI preparation; no native rebuild or output rebuild overlaps mounted execution.

## State transitions and identity reuse
Every row is covered by `the drawer toggles from the pill, leaves the composer usable, takes one Escape and survives a switch`.

| Event | Oracle |
| --- | --- |
| First conversation opens | One running task pill, authored task visible after opening, actual scoped catch-up. |
| Drawer repeatedly opens/closes | Original pill outline, menu and Close assertions; one continuous mount. |
| Composer sends while drawer open | Typed value, exactly one captured send with owning conversation/text, drawer remains visible. |
| Overlay and drawer both open | First Escape closes drawer only; second closes overlay. |
| Scoped thinking, focused Escape | Stop visible before keypress, exactly one captured owning-conversation interrupt, drawer stays visible. |
| Scoped idle, same focused Escape | Send visible before keypress, drawer closes with no second interrupt; task remains available. |
| Switch conversations while open | Selected row identity, second scoped catch-up and second task content, first task absent, open treatment retained. |

## Error handling
No new failure or rejection branches. Keep existing identity/count/geometry controls and timeouts. Invalid canonical authoring fails at the existing publisher boundary. No compatibility path supplies content.

## Testing strategy
- First add the actual opening-query assertion to the existing legacy scenario and observe its expected failure, then migrate setup.
- After the final merge of main: pre-verify with affected canonical publisher units; app and client-test typechecks; focused strict TypeScript including the owned spec and imported helpers; build.
- Run the owned Playwright spec on Linux with retries zero and configured native-writer prerequisite. Record source/build identity, exact named test and executed/passed/failed/skipped counts, including failed evidence.
- Dispatcher owns the complete configured application gate including captured clients, canonical activation, protected history/storage and native prerequisites; verifier checks matching counted evidence. No duplicate full-suite run here. Existing live-only assertions remain required in their original tiers; no fresh provider/encryption/physical-effect proof is introduced. Other operating systems are outside scope.

## Open Questions
None. All contracts are supplied by merged helpers; preserve compatibility for unmigrated siblings.

## Scope check
One independently useful mounted behaviour, three acceptance criteria, approximately 210 written lines including plan/evidence, zero production files, zero new exports, one migrated consumer and zero new production rejection branches. Both sketch and written-plan counts fit every ceiling. The analogous #2255 implementation added 59 and deleted 32 scenario lines; its plan/evidence added 69.

## Revisions
2026-10-24: Source inspection confirmed the legacy adapter captures the actual opening query before asking its history alias. The red oracle therefore combines the planned real-query assertion with zero observed `request_history` aliases. The legacy scenario failed with one alias after positively rendering its task; the canonical migration must retain the real query and eliminate that alias. No product contract changes.

## Validation evidence
Linux x64, 2026-10-24. Final implementation/build revision `ae62bfb62873fd12554898e714dc9cb441805207` contains final main `89ded5653129535fd669e24858f05af8646ac535`. Normal build provenance records that revision with `sourceDirty: false`; this subsequent evidence-only commit changes no executable input. `/tmp/builder-2269/build-provenance.json` and `build-bundles.sha256` retain identity and seven output hashes, all checked unchanged after mounted execution.

- Red control: `npx playwright test e2e/background-task-drawer.spec.ts --retries=0 --reporter=list,json` with `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2269/red.json`: 2 executed, 1 passed (native prerequisite), 1 failed (owned scenario), 0 skipped/retries. The expected zero-history-alias assertion received 1 after the seeded task rendered. Failure report/log and original result attachments remain in `/tmp/builder-2269/red.{json,log}` and `red-results/`.
- Final identical command, with report `owned-final.json`: 2 executed/passed, 0 failed/skipped/retries/flaky. Both `finite protected writer backlog preserves native keyboard and both event loops` and the owned `the drawer toggles from the pill, leaves the composer usable, takes one Escape and survives a switch` were present and passed. `/tmp/builder-2269/owned-final.{json,log}` retains the counted run. Existing geometry captures are `/tmp/builder-2269/drawer-{1280,800}.png` and `drawer-open.png`.
- Pre-verify: all 5 checks passed after final main merge, including `npm run typecheck` and canonical publisher units: 17 executed/passed, 0 failed/skipped. `/tmp/builder-2269/pre-verify-final.log`; structured JSON, audit, XML and invocation under `/tmp/builder-2269/unit-final/unit-fwjrj7oi/`.
- `npm run typecheck:client-tests`, focused `npx tsc --noEmit --strict --skipLibCheck --esModuleInterop --module ESNext --moduleResolution Bundler --target ES2023 --lib ES2023,DOM,DOM.Iterable --jsx react-jsx e2e/background-task-drawer.spec.ts src/preload/index.d.ts src/main/transport/noise-c.wasm.d.ts`, and `npm run build` passed. Logs are `/tmp/builder-2269/{client-types-final,focused-types-final,build-final}.log`.
- All Node checks finished before successful `native-preparation.py electron`; no ABI preparation or build overlapped final mounted execution. Initial sandbox installation hit esbuild `spawnSync EPERM`; the approved install succeeded. No missing toolchain or test skip was substituted for execution.

The dispatcher/verifier still owns the complete configured application/captured-client gate and matching counted evidence, including canonical activation, captured history, protected storage and native prerequisites. This focused pass does not replace it. Existing live-only assertions and exclusions remain intact; no fresh provider, encryption or physical-effect acceptance is claimed. Other operating systems remain outside scope.

Final scope is 39 added scenario lines, 26 deleted scenario lines, and this plan/evidence; no production/shared-helper changes, new exports or unresolved questions. All original mounted assertions and interaction order remain.
