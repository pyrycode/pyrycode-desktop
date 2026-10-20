# Compact history after send

## Files read

- `src/renderer/src/store/threadCompact.ts` → `event`, `query`, `pump`: compact progress, certified recovery and one per-host lane.
- `src/renderer/src/store/threadRuntime.ts` → `handle`, `event`, `presentation`: accepted host grants, delivery ordering and selected authority.
- `src/main/daemonConnection.ts` → `onDriverEvent`, `queryThread`: authenticated grants and local refusal boundary.
- `src/main/threadQueryCommand.ts` → `dispatchThreadQuery`: missing-route settlement.
- `src/shared/ipc/commands.ts` → `isRendererCommand`: closed command validation.
- `src/main/transport/threadUpdates.ts` → `logical`, `createThreadUpdateReceiver`: inbound validation, query correlation and marker certification.
- `e2e/threadBodies.test.ts` → `compactRuntime`: production dispatch/preload/inbound regression harness.
- `e2e/compact-demand.spec.ts` → compact demand and recovery controls: mounted synthetic daemon fixtures.
- `e2e/real-daemon-history-on-open.spec.ts`, `e2e/fixtures/realDaemon.ts`: isolated daemon, channel posts and native lifecycle.
- `docs/knowledge/features/thread-runtime-compact.md`: compact and complete authority must remain separate; only successful matching markers certify checkpoints.
- `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-live-test-diagnosis.md`, `docs/recorded-tests.md`: positive processing barriers, counted evidence, executable provenance and replay limits.
- Root `CLAUDE.md`, shared working practice and ticket scope/security/UI policies.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Read design context and screenshot. Preserve the fixed sidebar, adjacent conversation pane, existing dark surface/message tokens and footer. Reuse the existing history failure and Retry treatment; no new visual component or asset.

## Context

Sending text can leave compact history reporting an older-messages failure. Capability refusal remains a hypothesis: both processes currently require the same owning-host accepted grants. Establish the accepted negotiation and source-version sequence before changing recovery. Attachment retention belongs to #2164.

This is one usable-history repair with its regression and refusal/gap controls. Forecast total written work: 650–750 lines including this plan, focused regressions, one live diagnostic scenario and production changes; no new exported declarations, at most four changed consumers, four observable criteria and fewer than ten reject branches. The scoped #2103 analogue added 158/deleted 28 lines. No public API migration or new dependency. Overlaps #1544 (main settings correlation) and #2089 (runtime unpair cleanup) change different blocks; preserve them when merging.

## Design

Keep the existing compact owner and its separate complete authority. Diagnose through the existing query/receiver/renderer path, using a live diagnostic control before any production edit. The production regression must send through the connection and deliver compact updates through its parser and preload, then page Older. Change only the demonstrated fault in that path; record the causal result and exact revised contract below before implementing a changed recovery rule.

At `queryThread`, distinguish unavailable connection, missing accepted capability and invalid command using static diagnostic codes while retaining the existing typed failure settlement. A sent-query diagnostic means transport handoff only, never daemon receipt. Keep command validation fail-closed and never replace refused compact projection with complete. Automatic selection still uses complete without accepted compact grants.

Considered a second recovery owner: unnecessary, because `createThreadCompact` already owns the bounded lane and explicit Retry. Fix its existing invariant or the validated delivery boundary instead of adding another retry mechanism.

## State + concurrency model

Retain compact snapshots, per-host lane, query identities, generations and cancellation. Live consumed progress is distinct from the marker-certified checkpoint. Recovery starts at that checkpoint, not optimistic or consumed progress. Retained rows survive failure. Failure clears pending work and blocks automatic retries; explicit Retry can dispatch once the cause clears. Navigation, host retirement and disposal cancel queued work and reject stale replies. Add no background task.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Send after loaded compact history, contiguous updates, then Older | New production-dispatch regression in `threadBodies.test.ts`; mounted `compact-demand.spec.ts` send case; live compact-send scenario |
| Genuine gap and matching recovery marker | Existing compact gap/checkpoint tests plus send regression control |
| Local refusal, retained rows, no loop, explicit Retry after cause clears | Existing compact refusal tests plus classified main diagnostics assertions |
| No owning compact grants: automatic complete versus explicit refusal | Existing automatic-selection and explicit compact controls |
| Reconnect, reset, same host/chat reuse, stale reply, deletion/disposal | Existing `threadBodies.test.ts` lifecycle and retirement controls; retain unchanged |

## Error handling

Use existing `threadQueryFailed` reasons and content-free diagnostics. Do not suppress errors, invent receipt evidence or clear retained projection after refusal. Reject malformed inbound/IPC data through the existing validators. Recovery remains bounded and final-marker correlated.

## Testing strategy

- Retain current-daemon diagnostic control before production changes, recording Desktop build/revision, daemon version/source, owning-host equality, the four grant booleans and numerical progress/query/marker sequence. Never retain bodies, raw acknowledgements, peer identities or credentials.
- First run the new focused production-dispatch test red for the demonstrated cause; implement and rerun it plus existing genuine-gap/refusal/lifecycle controls.
- Mounted Electron case positively waits for authoritative echo and any recovery completion before asserting no failure, then positively observes an Older page completing. Capture the existing history treatment at 1280×800 and 800×800.
- Live scenario uses an isolated daemon and loaded history, sends text, observes compact updates and completes Older. Record executed/passed/failed/skipped for before and after. Missing live access requires an exact Juhana handoff and explicit pre-merge hold; replay is not a substitute.
- After final main merge run affected pre-verify checks, build and the focused mounted spec on macOS. Dispatcher owns the full acceptance suite. No second-OS run.

## Open Questions

- What is the first causal divergence in accepted grants/source-version progression? Resolve with diagnostic control before production edits; append result to Revisions.
- Dedicated daemon is 0.41.1, clean source `a935bfb8db70ff5fd5cd47c2a05ab5bc1e83273f`; determine compact support or hand current 0.41.4 acceptance to Juhana with the exact missing evidence.

## Security review

**Verdict:** PASS

- [Trust boundaries] Preserve `isRendererCommand`, authenticated owning-host gates and `createThreadUpdateReceiver` validation; no caller can grant itself compact capability.
- [Tokens] No credential storage or lifecycle change. Tests use the shared login launcher; never read or log credentials ourselves.
- [File/storage] Compact state stays session-only. No message-body persistence or new file path derived from daemon text.
- [Electron] No new IPC channel, API or privilege. Keep isolated/sandboxed renderer and main-process transport.
- [Cryptography] No change to Noise, keys, nonces, TLS or randomness; request IDs retain crypto UUID generation.
- [Network/I/O] Preserve frame/assembly limits, query deadline and one unfinished-query lane. Refusal must settle rather than spin.
- [Errors/logs] Only static classification and numerical sequence evidence. Exclude bodies, raw acknowledgements, peer identifiers, keys and credentials.
- [Concurrency] Preserve host/epoch/generation/request fences, marker correlation, cancellation and teardown. Existing lifecycle controls remain required.
- [Threat alignment] Malicious relay delay/reorder remains subject to bounded recovery; hostile daemon responses retain validation. Compromised renderer cannot bypass main grants or reach keys; disk-token protection stays in safeStorage.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20

## Revisions

2026-10-20: Pre-implementation v0.41.4 live reproduction (tag/source `4d43574874eec9450c97513adb571092de669d12`, isolated archive build `/tmp/builder-2163/pyry-0.41.4`, normal Desktop build from `2860189f` with test-only dirty files) executed 1, passed 0, failed 1, skipped 0. Owning host and all four accepted grants were true. Successful window checkpoint was 122; a malformed live rejection and malformed recovery failure preceded delivered echo interval (125,127], followed by contiguous intervals through 135. Evidence: `/tmp/builder-2163/live-0.41.4-before.json` and `.stderr`. This is not capability refusal.

The concrete decoder mismatch is `logical`'s `rootItem`: it requires `order`, although the daemon `internal/protocol/thread.go` contract explicitly omits order for queued/dropped/lost sends until delivery. The existing shared DTO and `fullItem` already allow absent order, and compact sorting already treats it as zero. Admit those full non-tool/agent roots without inventing an order, retaining parent/root checks and every present numeric-field validation. Apply the same contract to live updates and query data. No recovery policy change is needed: malformed rejection was creating the spurious gap/recovery failure.

The direct production-dispatch test with an omitted-order post-send root fails before this change; the original ordered contiguous control passes. Diagnostic tests separately fail on all three missing refusal classifications. The old dedicated 0.41.1 binary grants compact but resets after sends and cannot establish this current interval behavior: two attempted controls each executed 1/failed 1/passed 0/skipped 0 waiting for compact echoes. Its source is `a935bfb8db70ff5fd5cd47c2a05ab5bc1e83273f`. Both initial open questions are resolved by using the isolated exact v0.41.4 tag and repairing the demonstrated decoder contract. A test-only Buffer observation returned no shapes and is discarded from the scenario; it supplied no causal evidence.

Security review addendum: absent order is an allowed wire representation, not malformed input. `fullItem` continues to validate any present order as a nonnegative safe integer; kind/parent restrictions remain in `rootItem`. No broader IPC or authentication admission changes.

## Validation evidence

Execution OS: macOS arm64. Other operating systems are outside this ticket's verification scope. Implementation/test revision: `ee719c41c3c2c497d676d4897e93da5e35e37d0f`; final evidence-only plan changes do not change that tested code. Main `0b6da265ae933229b25f7ebfce2aea8477c50eb2` was merged (already current) before final checks. Total written scope remains under 500 lines, zero new exported declarations and no changed public signatures.

### Current-daemon before and after

The isolated daemon was built with `go build -o /tmp/builder-2163/pyry-0.41.4 -ldflags '-X main.Version=0.41.4' ./cmd/pyry` from a local `git archive v0.41.4`, source/tag `4d43574874eec9450c97513adb571092de669d12`. Binary SHA-256: `92d097c027bd2e961089a51ed321e2c4c6e2c9fe79c880bbb5745c440a1ea2f0`. No installed daemon was replaced. Both runs used the normal Desktop profile and the same isolated daemon binary.

| Run | Executed | Passed | Failed | Skipped | Retained report |
| --- | ---: | ---: | ---: | ---: | --- |
| Before production edits | 1 | 0 | 1 | 0 | `/tmp/builder-2163/live-0.41.4-before.json` |
| Final committed candidate | 1 | 1 | 0 | 0 | `/tmp/builder-2163/live-committed.json` |

Final provenance attachment identifies clean Desktop `ee719c41`, profile `normal`, OS `darwin`, daemon release/source/checksum above. The command was the shared `live-claude-gate.py desktop --spec e2e/real-compact-send-history.spec.ts --tests "loaded compact history stays usable after text send and Older completes"`, with `PYRY_BIN` set to the isolated binary and the source supplied as `PYRY_TEST_DAEMON_REVISION`. Companion `.stderr` files record counted outcomes. The launcher owned credentials; none were read or retained by this ticket.

Both runs positively established owning-host equality and accepted `interactive=true`, `thread=true`, `thread_expansion=true`, `thread_compact=true`. Before repair, the successful window marker certified checkpoint 122, followed by malformed live rejection, malformed query failure, then the delivered user echo (125,127]. Later live intervals did not repair that failure. The failure was inbound admission, not a demonstrated capability refusal; no daemon receipt of the failed recovery is claimed.

After repair, the successful initial marker certified checkpoint/consumed 122. Live intervals were `(122,123]`, `(123,125]`, `(125,127]` (delivered echo), `(127,129]`, `(129,130]`, `(130,131]`, `(131,132]`, `(132,134]` (two roots, including successful turn end), `(134,135]`. Consumed progress reached 135 while the certified checkpoint stayed 122. There was no recovery query or failure. Explicit upward input issued `thread_page before_order=73`; matching data and successful final marker at version 135 positively establish daemon receipt and older-page completion. The marker did not advance checkpoint 122. No peer identity, body, raw acknowledgement or credential is in these retained sequence facts.

Earlier diagnostics remain failed: both 0.41.1 controls were 1 executed/0 passed/1 failed/0 skipped; the additional v0.41.4 structural-observer control was also 1/0/1/0 and observed no raw shapes. The first repaired run (`live-after.json`) was 1/0/1/0: send/updates passed, but its premature single Home did not complete pagination. Adding a positive turn-end barrier and explicit upward input produced `live-after-settled.json`, 1/1/0/0; final committed acceptance additionally correlates the page reply to its observed request. These are test-observation refinements, not additional production changes.

### Deterministic and mounted checks

- `pre-verify-final.log`: all five checks passed, including issue-label security review, main integration, removed-string check, typecheck and 172 integration tests. Subsequent `unit-final.log` ran the added local-refusal/Retry control too: 173 executed/passed, zero failed/skipped.
- `main-controls.log`: `src/main/threadQueries.test.ts` and `src/main/transport/threadUpdates.test.ts`, 85 executed/passed, zero failed/skipped. Initial omitted-order integration and three diagnostic assertions failed before repair (`unit-zero-order-before.log`); the ordered contiguous control alone had passed.
- `build-committed.log`: `npm run build` passed on committed code. `client-types-final.log`: client-test TypeScript check passed.
- `mounted-final.log`: native-writer prerequisite and five compact cases passed; the remaining existing 8333-item case timed out at initial `#root` while output was being rebuilt. Stable-output targeted rerun `mounted-large-rerun.log` passed that exact case, 1 executed/passed, zero failed/skipped. Together all six compact cases and the native-writer assertion ran and passed with retries zero. No assertion was skipped or changed to excuse a failure.
- The earlier native-writer prerequisite run failed before any compact case executed; the first direct compact run was 6 executed/3 passed/3 failed. Their storage checks used a Node-built SQLite binary. Preparing Electron's native dependency after the unit gates repaired this setup; subsequent persisted-history controls and native writer passed. Reports are retained as `mounted-after.log`, `mounted-targeted.log`, `electron-native-prepare.log`. No product storage change was made. Existing native-writer tracker #2125 was checked; this environmental setup failure does not add a new bug.
- Visual comparison: `/tmp/builder-2163/compact-send-1280.png` and `/tmp/builder-2163/compact-send-800.png`, 1280×800 and 800×800 content viewports, inspected against Figma 102:4. Existing sidebar, conversation, bubbles and footer styling remain; retained history and the older page are visible. No in-scope visual deviation remains.
- Guarded original `daemon-built thread streams, places an agent, reconnects, resets and reopens saved items` replay passed: 1 executed/passed, zero failed/skipped, retries zero, zero forbidden launches (`replay-final.log`). Invoked `npm run e2e:recorded -- --profile complete-thread --grep "daemon-built thread streams, places an agent, reconnects, resets and reopens saved items" --retries 0`; original assertions and strict outgoing matcher remain intact. The profile runner restored normal output. This is offline complete-route compatibility evidence, separate from the current-daemon live pass. The first invocation selected nonexistent project `parallel` in the recorded configuration, executed zero tests and failed (`replay.log`); it is not counted as a pass. The final replay built `ee719c41` with only this evidence plan dirty.

### Lessons for documentation

Compact full roots use the same optional-order contract as full items: send admission can precede delivery order. Rejecting the absent field turns a valid live interval into a false gap and can also reject the recovery data containing that root. Test the pre-delivery and delivered representations through the main receiver, not only ordered compact fixtures. A positive delivered echo plus request-correlated final page marker prevents an optimistic bubble or an unrelated reply from passing acceptance early.


### Manual merge recovery — 2026-10-20

Merged current `origin/main` (`200fecb0750e235d7b420a6b83f8815c39eb28ce`) into the retained candidate `b4b22dff`, producing merge commit `5438aba032a9b2cb1fa80395644fb18cb5980b19`. The only conflict was independently inserted tests at the top of `e2e/compact-demand.spec.ts`. Kept both original send/gap cases byte-for-byte and all current main content byte-for-byte; verified removing just those two added cases reproduces main's file exactly. No additional production change or assertion relaxation.

Execution OS: macOS arm64. Evidence root: `/Users/juhanailmoniemi/Documents/Codex/2026-10-20/why-did-desktop-ticket-2163-error/work/`.

- `unit-final.log`: 265 executed/passed, 0 failed/skipped, covering production-path send/recovery, receiver/query admission and current main's read publisher.
- `pre-verify.log`: all five checks passed after the committed merge; its structured affected-file gate executed/passed 173 tests, 0 failed/skipped. Security labels were supplied from the authenticated workflow read. Main integration and committed security review passed.
- `build-final.log`, `client-types.log`, `docs-check-final.log`: build, client-test typecheck and docs guard passed on the merged source. The build preceded the merge commit but used the identical merged production/test files. The first build used an incomplete copied dependency directory and failed; installing the locked dependencies resolved setup without source changes. The first docs invocation lacked `AGENTS_REPO_PATH`; the configured rerun passed.
- `compact-electron.log`: native-writer prerequisite passed (1 executed/passed). The initial mounted run then recorded 1 teardown failure, 1 interrupted case and 9 unrun cases. It is not a passing suite. The pre-verifier's Node native preparation overlapped this run, so the run was stopped and preparation/test phases were separated.
- `electron-native-final.log`, `compact-final.log`, `compact-final.json`: after completed pre-verification and Electron native preparation, all 11 compact scenarios executed/passed, 0 failed/skipped, retries 0, no runner errors. Used `npx playwright test e2e/compact-demand.spec.ts --project=parallel --no-deps --retries=0 --reporter=list,json`; the already-passed native prerequisite is reported separately. Both original send/Older/genuine-gap cases and every current-main compact read/layout/status/recovery case passed.

These are fresh merge-validation results. The earlier current-daemon before/after evidence remains unchanged; no new live-daemon execution is claimed for this merge-only recovery. Full dispatcher acceptance and review remain required.

### Recovery harness plan — 2026-10-20

Retained full capture `9eee543f056d0328b6a2ae367d4c866ee40a9b14f45f49405411b78b7e51a118` at `b2978707` is 532 executed / 529 passed / 3 failed / 2 skipped, retries zero. Its original report is preserved under `/tmp/builder-2163/recovery-capture/`. All compact cases passed. This rework repairs the demonstrated verification boundaries without changing product scheduling, security rejection or the existing live evidence. Forecast additional written work: 250–300 lines; combined branch remains within 800 lines, with no new exported declaration or consumer migration.

Files read: `e2e/visible-tail-read.spec.ts` (held append receipt and commit assertions), `src/renderer/src/store/threadRuntime.ts` (`schedule`, frame and 50 ms drain), `e2e/fixtures/visibleTailFocus.ts` (`focusVisibleTailWindow`, acknowledged native controls), its unit harness, `e2e/hosted-app-view.spec.ts` (`open`, `evaluate`, cancellation/navigation sequence), `src/main/hostedAppView.ts` (`createHostedAppViews`, retirement/navigation/debugger lifetime), and the verification/layout/hosted-resource package overviews. Remote overlaps #2007/#2008 (hosted tests), #2150 (focus helper), #2186 (read tests) are reviewed; preserve their existing assertions and use local additive changes.

- Hold both runtime scheduling paths in the received-but-uncommitted test. Positively observe inbound delivery, wait beyond the 50 ms fallback using an unmodified clock, prove no commit/read advancement, then release and prove version-5 text and read eligibility. Restore both scheduling APIs in cleanup.
- Replace three immediate focus inspections with bounded, spaced read-only confirmation of the same captured native window. An acknowledged control is never replayed. Ambiguous control loss retains the existing two-attempt limit and requires conclusive absence before resend. Add fake-timer coverage for delayed readiness and identity replacement; preserve existing loss/error controls.
- Instrument the retained hosted view and WebContents handle across cancellation/navigation: local numeric IDs, state, destroyed flag, navigation boundaries and debugger detach reason. Reproduce with the preceding preferences case. Repair only the demonstrated lifetime/observation fault; never reopen the view or retry fetch/IPC mutations. Keep forged-call rejection and every original assertion.

Validation: failing deterministic delayed-focus/held-timer controls first, then targeted units and mounted sequences with the native-writer prerequisite and representative concurrency. After final main merge run pre-verify, build and client-test typecheck, then Electron-native preparation and focused specs. Push the complete candidate and request a fresh configured native capture; preserve both earlier failed captures and require fresh verifier judgment.

Security review addendum (PASS, builder self-review): all trust/IPC/authentication boundaries, token lifecycle, file/storage handling, Noise/crypto and network admission remain unchanged. Diagnostics contain only test-owned numeric IDs, static state/event codes and booleans, excluding origins/tokens/bodies/peer identities. Scheduling holds restore and release in `finally`; native observations cannot mutate focus or authorize a replacement view. Forged bridge checks remain mandatory. No production Electron permissions, protocol policies or cancellation semantics change.

### Recovery findings and dependency — 2026-10-20

The overlap audit found that open #2186 / PR #2189 already rewrites the exact held-tail frame/timer interception block. Its patch holds both identical runtime drain callbacks, positively observes both opportunities, drains focus/scroll IPC and retains the version-5 release assertions. Per the same-block dependency rule, this branch does not duplicate that rewrite. Recorded `blocked-by #2186`; merge its landed implementation from main before the next complete configured capture. #2150 is closed; the #2007/#2008 overlaps affect other hosted tests and remain intact.

Implemented bounded native focus observation: twenty-one reads spaced 100 ms apart, inspecting the captured BrowserWindow rather than whichever window later leads the list. Acknowledged controls are never replayed; ambiguous control loss still needs final conclusive absence and retains the two-control ceiling. Added delayed-ready and changing-window-list controls, and used fake timers for deterministic bounded-loss tests. `focus-red.log`: 20 executed / 19 passed / 1 failed / 0 skipped at delayed readiness before implementation. `focus-green-final.log`: 21/21/0/0. The first real-timer unit run was 21/20/1/0 (the two-attempt bound test exceeded its 5-second unit deadline); converting its timing controls to fake timers resolved that test-observation issue without changing production timing.

Hosted lifetime instrumentation retains the first native content ID and WebContents, observes state transitions, main-frame navigation, destruction and debugger detachment, and numbers script evaluations without retaining script text. Evaluation failure attaches observations and rethrows the original error; Fetch/IPC scripts are executed once, with no view reopen or mutation replay. Original forged-call/cancellation assertions are unchanged. This is diagnostic work, not a claimed lifetime repair: the original undefined receiver has not reproduced. All observed cancellations/navigation retained content ID 2, ready state, live content and an attached debugger through replacement; no destruction/detach occurred before completion.

macOS evidence under `/tmp/builder-2163/` (counts are executed/passed/failed/skipped; all browser retries zero):

- `hosted-diagnostic.json`: 11/11/0/0, including the native-writer prerequisite, preferences/cancellation in original order and eight existing native/security controls.
- `hosted-concurrent.json`: 10/10/0/0, five original preferences-then-cancellation sequences. This overlapped a four-copy focus stress run; it is stress evidence, not the normal configured composition.
- `focus-mounted.json`: 4/2/2/0. Four simultaneous copies compete for the same OS focus and two correctly failed the native predicate. Preserve this failed stress report; it does not establish a normal-composition pass.
- `combined-focused.json`: 3/3/0/0, the original preferences/cancellation order beside one folded-tail scenario, normal file scheduling with two actual workers. No retries or assertion changes.
- `hosted-navigation-control.json`: 1/0/1/0. Exploratory withholding of the initial image never reached module readiness and did not reproduce the undefined receiver. Removed the noncausal diagnostic variant; its failure remains retained.
- Both pre-verify invocations passed 5/5 after main integration (`recovery-pre-verify-focus.log`, 21 tests; `recovery-pre-verify-compact.log`, 173 tests). Build and client-test typecheck passed (`recovery-build-final.log`, `recovery-client-types-final.log`). Electron-native preparation follows the completed Node checks (`recovery-electron-final.log`).
- `recovery-focused-final.json`: 40/40/0/0, zero retries and runner errors, all hosted-view and compact-demand scenarios plus the remaining visible-tail scenarios at normal file concurrency (three actual workers). The single held-tail case is explicitly unselected pending #2186, so this is not a complete suite pass. The native-writer prerequisite had passed separately before this focused run; no Node preparation overlapped Electron.

The prior saved verifier FAIL is retained in `/tmp/builder-2163/prior-evidence/cbb63d3356b372eaa1b98e91808e261b1ea315e1eb41b9182ffa90540ba738d7/`, alongside the newer failed native capture in `recovery-capture/`. Neither is converted into a pass. Existing live v0.41.4 before/after evidence and security controls are unchanged. Pending after #2186 lands: validate its held-tail case on macOS, obtain a fresh complete configured capture of the pushed candidate using ordinary native-writer ordering, inspect any hosted-lifetime failure, repair a demonstrated cause if present, and obtain fresh verifier judgment. No new complete capture or live run is claimed by this partial recovery.

### Dependency clearance and resumed macOS validation — 2026-10-20

#2186 / PR #2189 is closed and its implementation is included in merged candidate `410f4986e73c5ae78324e1cacce6c39dbfc4a09c`. Final fetch and merge confirmed current main `ebe063cfd5617e094d1f611a685639ea8edf7565` is contained. The former held-tail exclusion is removed from this run's selection. No production or test changes were needed after that merge; this update records the resulting evidence. The overlap audit still finds #2007/#2008 in other hosted cases and older #2150/#2176 branches; no additional shared block is changed here. Total branch additions remain below 600 lines, with no new exported declaration or public signature migration.

Execution OS: macOS arm64. Fresh evidence root: `/tmp/builder-2163/`; all browser retries zero.

- `resumed-pre-verify-compact.log`: all five checks pass, including authenticated security-label validation, current main integration, typecheck and 173/173 affected production-dispatch tests. The first sandboxed invocation could not read the label; the same command outside the sandbox completed every check.
- `resumed-focus-unit.log`: 21/21 focus controls pass. `resumed-main-controls.log`: 85/85 query/receiver controls pass. `resumed-build.log`, `resumed-client-types.log`, `resumed-docs.log`: build, client-test typecheck and docs guard pass. `resumed-electron-native.log`: Electron preparation completed after Node checks, before browser tests.
- `resumed-focused.json` and `.log`: 42 executed / 42 passed / 0 failed / 0 skipped, zero flaky outcomes or runner errors. The unchanged configured projects supplied the isolated native-writer prerequisite, then three actual workers ran all 11 compact, 23 hosted and 7 visible-tail cases. No case was excluded, retried or weakened.
- The `pending-read-barrier` attachment records receipt 1, frame opportunity 1, timer opportunity 1, targets `[1,2,3,4]` and received context-usage sentinel. Passing final assertions establish released text and read target 5. Thus the merged #2186 repair is now positively validated on macOS.
- The preferences-then-cancellation sequence passed in original order. Its `hosted-lifetime` attachment retains content ID 2 throughout loading/ready transitions and document replacement; all fifteen evaluations had an available, undestroyed receiver, and navigation after initial readiness retained debugger attachment. No destruction or detach occurred. The earlier undefined receiver remains unreproduced; this is observation evidence, not a claimed lifetime repair. Forged-call rejection and mutation/cancellation assertions remain intact.

The failed native task was freshly retrieved through the managed route into `resume-capture-20261020/`, with its manifest/checksums and original 532/529/3/2 outcome. Both prior failures and the saved FAIL remain preserved. Existing exact-v0.41.4 before/after live evidence is unchanged; no new live run is claimed. Next: capture this pushed merged candidate through the complete configured native route, inspect all results, and obtain fresh verifier judgment before merge.

### Complete native capture handoff — 2026-10-20

Requested managed task `e16fea0745ef00a5127d1e1b0e79654ed3d12a4e44537921bb56aab586934908` (`desktop-fake-suite`, capability `desktop-fake-suite`) for pushed `bad15d599b8a75f4191b9626ea15a30a49928a9f`. It is queued; no result or full-suite pass is claimed. Request file: `/tmp/builder-2163/resumed-capture-request.json`. This subsequent plan-only commit does not change the tested candidate's executable or tests. PR #2170 names the task and retains the complete-capture/fresh-verifier pre-merge hold. The dispatcher-managed pending-task handoff must retain ownership until the exact artifacts are read and their evidence committed; do not create an unchanged duplicate request. Retrieve with `fleet-task.py await e16fea0745ef00a5127d1e1b0e79654ed3d12a4e44537921bb56aab586934908 --out /tmp/builder-2163/resumed-complete-capture`, inspect configuration/counts/skip reasons/retries/setup attachments and hosted-lifetime/pending-read-barrier evidence, then record the result before ordinary review. Prior saved FAIL and failed reports stay failed.

### Completed configured native capture — 2026-10-20

Read completed task `e16fea0745ef00a5127d1e1b0e79654ed3d12a4e44537921bb56aab586934908`, run `f29940ebb82d6823a4a0d03de6df5f02ad96484f402093bf04fa57b2f5a091e5`, for exact pushed candidate `bad15d599b8a75f4191b9626ea15a30a49928a9f`. All six returned files are retained under `/tmp/builder-2163/completed-capture-20261020/desktop/`; their byte counts and SHA-256 hashes match the managed manifest. `capture.json`, original Playwright JSON/list logs, execution log, configuration and all setup attachments were inspected.

The complete macOS suite executed **533, passed 533, failed 0, skipped 2, retries 0**, with zero flaky outcomes, individual errors or runner errors. The original unfiltered invocation was `playwright test --config=playwright.config.ts`, with four actual workers and all three original projects. Returned configuration SHA-256 `0d1fb967aa3b3d66275b736ec63bc55142dff69708eb297cce6ff3d4898d2643` matches both the captured revision and current branch. Installation, build and Electron-native preparation completed before testing. The native-writer prerequisite passed before every other test started; all 585 fake-daemon setup attachments report `opened`, with no failure classification.

- All 11 compact cases passed, including post-send/Older with and without a genuine gap, explicit Retry, capability/recovery controls and the 8333-item case. All 23 hosted-view and 7 visible-tail cases passed. No case in those files was excluded or retried.
- `pending-read-barrier` positively records receipt 1, frame opportunity 1, timer opportunity 1, read targets `[1,2,3,4]` and the received context sentinel. Passing release assertions establish version-5 text commitment and read eligibility.
- Preferences ran before cancellation/navigation. `hosted-lifetime` retains content ID 2 throughout loading/ready transitions and document replacement. All 16 evaluations had an available, undestroyed receiver; no destruction or debugger detach occurred, and navigation after initial readiness retained debugger attachment. The original undefined receiver remains unreproduced; this passing observation is not a claimed product lifetime repair. Forged-call and cancellation assertions remain intact.
- Captured-client replay passed 28 scenarios. Its saved-system-prompt-at-Reset scenario remains the existing upstream-blocked `test.fixme`; the JSON skip reason is unspecified, and the source documents the daemon limitation. The other skip is the existing input-enabled-cover hover case: a never-shown window receives no display pointer. Neither skip covers this ticket's acceptance, and no new assertion was skipped.

These complete results discharge the pending-capture handoff above. The previous 532/529/3/2 capture, earlier failed capture and saved verifier FAIL remain preserved and failed. Exact-v0.41.4 live before/after evidence remains unchanged; no fresh live run is claimed. Fresh verifier judgment and its normal gates remain required before merge; documentation remains with the documentation stage.

### Post-capture main integration checks — 2026-10-20

The dispatcher subsequently merged main into `a908507e65c3b034924df0bb0ee9fdff4587964a`. Final fetch/merge confirmed current main `198cbb5d13599ed45f1496bccb175335de6e30e2` is contained. This retrieval run changes only this plan; all ticket-owned production, live and regression files are unchanged from the captured candidate. Main additionally strengthens the held-tail target-array assertions and changes its read-observation diagnostics; the complete capture counts above belong to `bad15d599b8a`, not this later merge.

Fresh macOS checks on the merged tree: `completed-pre-verify.log` passed all five checks, including authenticated security labels and **173/173** production-path tests; `completed-unit-controls.log` passed **147/147** focus/query/receiver/read-publisher controls. `completed-build.log`, `completed-client-types.log` and `completed-docs.log` passed. Electron-native preparation completed after Node checks (`completed-electron-native.log`). `completed-focused.json`/`.log` then recorded **42 executed/passed, 0 failed/skipped/retries/flaky outcomes or runner errors**, with the configured native-writer prerequisite followed by three actual workers: all 11 compact, 23 hosted-view and 7 visible-tail cases. No case was excluded. Fresh receipt/frame/timer observations and the stronger exact read-target release assertion passed. No new complete native task was requested; the inspected complete capture and this merge validation are ready for fresh normal verifier review.

## Documentation handoff

Pending for the documentation stage:

- `docs/knowledge/features/thread-runtime-compact.md` — `Root facts and independent evidence`: optional-order full roots, static refusal codes, retained Retry and certified checkpoint versus consumed progress.
- `docs/knowledge/features/thread-runtime-compact.md` — `Validation evidence`: counted live before/after provenance, authoritative echo and request-correlated Older barriers; preserve historical failures and offline/live distinction.
- `docs/knowledge/features/development-verification-layout-and-input.md` — `Visible-tail native acknowledgement verification`: bounded read-only confirmation of the same native window, without replaying acknowledged controls.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md` — `Received but uncommitted read evidence`: fresh macOS receipt, paired scheduling opportunities and version-5 release evidence. Preserve existing Linux and historical macOS evidence separately.
