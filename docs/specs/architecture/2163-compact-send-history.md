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
