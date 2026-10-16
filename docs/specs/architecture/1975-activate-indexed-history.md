# Activate protected indexed history

## Files read

- `src/main/chatHistoryStore.ts` → `decode`, `createChatHistoryStore`: collection validation, queue and public results.
- `src/main/historyDatabase.ts` → `transaction`: synchronous rollback and schema admission.
- `src/main/indexedLegacyHistory.ts`, `src/main/indexedThreadHistory.ts` → `execute`: protected reconstruction and full replacement.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`, `clearServer`: saved-host admission and generation fencing.
- `src/main/index.ts` → `flushHistory`, `drainQuit`: application lifetime and shutdown ownership.
- `src/main/historyNativeSmoke.ts`: existing packaged production-adapter proof.
- `src/main/chatHistoryStore.test.ts`, `src/main/daemonItemHistory.test.ts`, `src/main/appUpdate.test.ts`, `e2e/daemon-item-cache.test.ts`, `e2e/chat-history-removal.test.ts`: persistence factories and held-operation barriers.
- `docs/knowledge/INDEX.md`, root `CLAUDE.md`, `docs/knowledge/features/chat-history.md`, `chat-history-api.md`, `chat-history-testing.md`, `development-verification.md`: exact UTF-16 ownership, full-read compatibility, evidence preservation and counted native proof.

## Context

Replace repeated whole-collection decoding with the merged indexed backends. The upgrade is one independently observable deliverable: importing without activating has only this activation as a consumer. Following refinement's floor exception, forecast about 900 written lines (approximately 100 above the normal ceiling), no new exported types, eight construction sites, five behaviors and fewer than ten classified failure branches. Lists will also move into encrypted SQLite cells so removal and import have a single commit boundary. No wire, renderer or UI change is required; no ADR is requested.

## Design

- Extend the database schema additively with protected list cells and a singleton import-completion/source-retirement record. Reject unknown versions without replacement.
- Expose synchronous classified backend execution alongside existing Promise execution. The store checks classified errors and throws them inside its enclosing transaction, ensuring both families and completion roll back together. Bounded page methods remain callable unchanged for #1931.
- Before the first operation, validate the complete version-1 source through the existing collection decoder and `parseChatHistorySnapshot`. In one synchronous transaction, import only missing scopes/lists and commit completion. Existing database records win irrespective of timestamps. Successful application removals always follow completion, so its durable marker also fences replay after deletion and identical-coordinate reuse.
- Encrypt list snapshots with `SecretEncryption`, bind ownership using UTF-16LE BLOBs, and validate decrypted ownership before use. Lists read only their own cell after import.
- Retire the fixed protected source name after commit. A durable pending flag survives interruption or cleanup failure; retry direct deletion without reopening/decrypting the source. Reads remain available from the committed database; removal reports cleanup failure through `remove-failed`.
- Full reads/replacements delegate to the existing backends; replacements remain complete. Remove both families and list entries in one transaction. Host removal enumerates off-screen records through the existing backends.
- Preserve handler saved-host checks and credential-first clear ordering. Add conversation-generation invalidation for requests admitted before confirmed removal; fresh requests may reuse identical coordinates.
- Construct one database/encryption/store at the composition root. Drain the store queue and close the database only on application shutdown after renderer flushing, retaining window-close/reopen behavior.
- #1908 overlaps `src/main/index.ts` in independent device/command wiring; keep edits local.

## State + concurrency model

The handler owns authorization/admission, the store owns serialized import and disk operations, and the database owns synchronous transactions. Never await within a SQLite transaction. No new stream, timer or renderer slice. A failed operation settles the queue; the next request retries from committed state. Source retirement is durable state separate from completion.

## State transitions and identity reuse

| Event | Proof |
| --- | --- |
| First import / fresh reopen / repeated source | Migration tests compare exact two-format snapshots, lists and owner isolation; completion forbids replay. |
| Interrupted import / protection or SQL failure / retry | Migration tests inject failure between formats and assert rollback, intact source and later success. |
| Commit then source cleanup failure / restart | Migration cleanup retry test keeps completion and newer replacements/deletions while retrying retirement. |
| Held import/save then removal or unpair | Existing held-operation regressions move their barriers to operation admission; fresh-instance reads prove both formats and off-screen removal. |
| Conversation or host identity reused / stale queued work | Handler regression rejects prior-generation requests but admits fresh same-id/epoch content and preserves other hosts. |
| Quit / window reopen | Existing flush/relaunch regressions plus store close/drain assertions. |

## Error handling

Keep existing classified results: invalid requests before I/O, unsupported versions, unreadable protected/invalid content, unavailable encryption, write and remove failures. Never delete unreadable sources, recreate an unsupported database, or initialize empty content as recovery. Cleanup failure logs static codes only and remains retryable. Logs exclude identities, text, paths, ciphertext and caught exceptions.

## Testing strategy

- Test first with real temporary SQLite and existing reversible protection fixtures; reopen fresh owners for exact content, optional fields, ownership, saved-empty/missing and full replacements.
- Exercise source validation, rollback, existing newer database content, completion and retirement interruption, restart deletion fences, held operations, unpair, queue recovery and plaintext absence in every history file.
- Adapt existing storage factories and their collection-write barriers to the activated boundary; retain writer-to-restart, protected history, removal and update drain assertions.
- Extend the existing packaged native smoke to use the activated store and request Linux/macOS manager evidence on the pushed revision. Record executed/failed/skipped counts; dispatcher-owned full fake suite remains later-stage work.
- After the final main merge run pre-verify and `npm run build`, plus every changed spec. No live Claude spec is changed or required.

## Open Questions

None. The simpler atomic design stores protected lists in SQLite rather than coordinating two writable stores.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/chat-history.md` (Storage and concurrency), `chat-history-api.md` (API), `chat-history-storage.md` (Protected collection), and `chat-history-results.md` (Results and failure preservation): production indexed activation, schema 5, protected lists, atomic two-format import, durable completion/retirement, cleanup retry and deletion fences; retire descriptions of unbound indexed storage.
- Pending documentation stage: `docs/knowledge/features/chat-history-storage.md` (Window close and app quit) and `chat-history-api.md` (API): application-lifetime ownership, shutdown drain, conversation admission invalidation, identity reuse and credential-first unpair errors.
- Pending documentation stage: `docs/knowledge/features/chat-history-testing.md` (Native runtime and packaged proof; Recording and removal): counted Linux migration/removal/lifecycle/native evidence and Node/Electron ABI preparation. Bounded pages remain main-only for #1931; historical failures retain their original status and macOS is outside this Linux run's verification scope.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseChatHistoryRequest`, collection `decode` and backend reconstruction validate untrusted IPC/disk content; list reads additionally compare exact requested ownership.
- [Tokens, secrets] Reuse selected `SecretEncryption`; fail closed before storage when unavailable. Credentials remain in the existing secure store.
- [File operations] Database path comes only from trusted userData; no ids become filenames. Existing 0700 directory, 0600 database, memory temporary store and protected payloads cover journal/temporary leakage. Import and completion share rollback; retirement never erases unreadable input.
- [Electron] No new IPC capability or window policy; all database and protection work stays main-only, behind saved-host authorization.
- [Cryptography] Existing OS protection and backend UUID identities are reused; no new primitives, keys or nonces.
- [Network and I/O] No new network path. Existing relay frame limits and cancellation are unchanged.
- [Errors and logs] Static classified operation/result events only; never log caught errors, fixture content, credentials or raw ids.
- [Concurrency] Serialized authorization/import/save/removal, durable completion and drain-before-close prevent stale work/source replay; fresh admission permits intentional coordinate reuse.
- [Threat model] Malformed daemon/saved content is parsed; compromised renderer lacks filesystem/keys; disk readers see protected payloads. Relay security remains existing transport responsibility; no transport changes.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

## Revisions

2026-10-16 — Additional rework guard `keeps invalid destination list decoding unreadable before importing either family` proves a raw destination JSON failure stays a read/validation error and leaves both families, completion and source intact before later same-queue recovery. Added the verifier's documentation-stage handoff above; no knowledge files are edited by the builder.

2026-10-16 — Verifier rework for reviewed commit `54d7010a`, findings 1 and 2. Within the existing import transaction, validate all addressed destination records and collect missing snapshots before entering the mutation phase. Preserve classified backend/validation/protection errors; classify raw list insertion, completion-marker insertion and outer import COMMIT failures as `write-failed`. Share static error mapping with normal operations so stored list versions retain `unsupported-version` for reads, replacement and both removals. No public interface, durable state, authorization, queue or encryption changes. No in-flight branch overlaps these rework files. Forecast under 180 additional source/test/plan lines, no new exports or consumers, within the accepted activation floor exception.

Test-first real-disk cases: `classifies an import %s failure and rolls back both families before queued retry` covers list insertion, marker insertion and deferred outer COMMIT, intact source, absent completion, preserved committed peers, same-queue recovery and exact fresh-owner content. `preserves a stored list with version %s across reads and mutations` covers safe-integer 9 versus malformed versions, ciphertext/both-family preservation and usable later work. Security re-review: PASS; all nine original categories remain applicable and unchanged, with static error codes only and no caught exception data exposed. No transaction spans secure-store I/O. Existing Linux native and focused lifecycle checks will run after Node/Electron adapter preparation; the full configured fake gate remains dispatcher-owned.

2026-10-16 — Final Linux acceptance on pushed candidate `41fbd1f47a361551f872badcc483121b46911161`, containing main `af067d8f6cd343613ffe03d70032845ced2931c3`. No other in-flight feature branch overlaps the final changed files. Install, documentation guard, pre-verify **5/5** and production build pass. This subsequent commit records evidence only.

| Final check | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 417 passing files | 10,239 | 10,239 | 0 | 30 inherited |
| Migration subset, including atomic rollback, retirement, identity reuse and saturation | 14 | 14 | 0 | 0 |
| Removal integration subset, including failed authoritative deletion/retry | 6 | 6 | 0 | 0 |
| Focused Linux Playwright group | 19 | 19 | 0 | 0 |
| Packaged production-encryption case, included in the group | 1 | 1 | 0 | 0 |

The unchanged Playwright configuration used two actual workers, clipboard/parallel projects and zero retries. The group ran all 15 named `thread-activation.spec.ts` cases; `indexed history drains a buffered thread replacement on quit and restores it offline`; its `window` counterpart; `local list read failures stay beside the saved host`; and `packaged protected history commits and reopens with production encryption`. Report/global errors are empty. Report: `/tmp/builder-1975/linux-final-recheck-20261016.json`, SHA256 `f041ac9ea1bc5cf3a25e4e1643aabc4d2f2d1767af8002c4cae435a75cf74299`, with empty companion `.stderr`. Configuration SHA256 `3b6b77443bf5f4d3f6d56ece6c6b19ec95566efd9d4d445c2374239406b9db80` matches the inspected intermediate Mac configuration. Gate/build logs: `/tmp/builder-1975/pre-verify-final-20261016.log`, `/tmp/builder-1975/build-final-20261016.log`; removal red/green logs are retained beside them. The full dispatcher fake suite remains later-stage work; no live Claude spec changed.

Inspected both final native attachments and `/tmp/pyry-history-native-92ys8m/runtime.stdout` / `runtime.stderr`: Electron 33.4.11, Node 20.18.3, adapter 12.4.1, `gnome_libsecret`, packaged/asar/unpacked true, `stage: complete`, 100,000 memberships and 7,484 ms saturated replacement. Exact two-format import/reopen, full replacement/fresh reopen and fixture-plaintext rejection all passed. Raw stderr retains system-bus/GPU/color diagnostics and a network-service restart during shutdown; counted completion succeeded. The earlier focused group also passed native saturation (6,154 ms), both shutdown cases and saved-list errors, but had one Electron inspection-context failure: **19 executed, 18 passed, one failed, zero skipped/retries**. Its unchanged failed thread case passed alone (**1/1**) and in the final complete focused group (**19/19**). Original failure/report provenance remains in `/tmp/builder-1975/linux-final-20261016.json` and `linux-thread-recheck-20261016.json`. The intermittent resumed `onLaunched` inspection failure is recorded separately in [#2035](https://github.com/pyrycode/pyrycode-desktop/issues/2035), Backlog, priority low; its cause is not diagnosed or claimed repaired here. No test or assertion was skipped or weakened for these rechecks.

2026-10-16 — Final main integration exposed a fixture mismatch in `removes an omitted cached thread only on confirmation (storage failure=true)`: main now seeds authoritative thread content, while this branch's SQL failure trigger still targeted legacy scopes. Both the full gate and isolated six-case module failed the retained snapshot assertion because no legacy row existed to trigger rejection. Target `thread_scopes` instead, retaining the preservation, classified-error, content-free diagnostic and successful-retry assertions. This adapts the existing failure injection to the activated storage family; production behavior and the design are unchanged.

2026-10-16 — Returned-task inspection and platform-policy update. The current issue requires native verification on the operating system running the ticket, Linux for this run, and explicitly removes opposite-OS scheduling. This supersedes the pending macOS acceptance requirement below. Final task `a1e15a53baa351db3fb77b5e6f613e289d8b4e878d0911e6b9c20b748afa55bf`, revision `109888c45b68457bd0b21d41a958de9eb1fa6be4`, was settled by the operator as interrupted: its launcher/process group is absent, custody drained, and no result or artifacts exist. It supplies no executed tests or passing proof. No new native task is requested.

Inspected completed intermediate task `465a91b4ee3e9605f06a7a58a34e5ab3a1932bc8973c3af3d8df6c3bc7de68d7`, revision `91d0a417b48d76d238ef27e1b56c5238d664b3c9`, run `827862ce31342e382ff3079edcb9fad77dae0eb04743f3ddb7c62628d9536386`. All six returned files are retained in `/tmp/builder-1975/task-intermediate-20261016/desktop/`; report SHA256 `905b13e4d85f4aada08d8213fd233ed4821b8ca4b275054176edd7580d89314a`, configuration SHA256 `3b6b77443bf5f4d3f6d56ece6c6b19ec95566efd9d4d445c2374239406b9db80`. Full configured macOS suite: **434 executed/passed, zero failed/retries/flaky, 20 skipped**, four actual workers, clipboard/parallel projects, no filters and no report errors. All 15 named thread-activation cases passed; this earlier revision has no new indexed-history-lifecycle cases. Inspected every skip: nine legacy recording cases, background-task reconnect, two legacy gap cases, history-on-open, two queued-own-settlement cases, legacy reconnect replay, two tool-group cases and ID-less visible-tail replay were retired legacy scenarios; the remaining skip is the never-shown-window hover case. Skips are not execution proof. Setup inventory is `[]`.

The intermediate packaged case `packaged protected history commits and reopens with production encryption` executed/passed once, zero failed/skipped, with Electron 33.4.11, Node 20.18.3, adapter 12.4.1, `os-keychain`, packaged/asar/unpacked true and `stage: complete`. Inspected both embedded native attachments: stderr is empty, stdout records 100,000 memberships and 11,277 ms saturated replacement. Exact two-format reopen and plaintext rejection assertions passed. Native scratch was `/var/folders/k0/gc07w9ws319b07n0plnw6y8r0000gn/T/pyry-history-native-Ty9qab`. This establishes only the named earlier revision; it does not turn the interrupted final capture or historical failed capture green. Final Linux validation is recorded separately below.

2026-10-15 — Final native-artifact handoff: pushed candidate **`109888c45b68457bd0b21d41a958de9eb1fa6be4`** contains the passing local lifecycle/native assertions. Final managed macOS task **`a1e15a53baa351db3fb77b5e6f613e289d8b4e878d0911e6b9c20b748afa55bf`** remains queued (no assigned computer, run ID or result at 19:59 UTC). It supersedes intermediate task `465a91b4ee3e9605f06a7a58a34e5ab3a1932bc8973c3af3d8df6c3bc7de68d7` on `91d0a417`; inspect either returned result, but acceptance requires the final candidate. Retrieve with `python3 /work/Projects/pyrycode-desktop-agents/dispatcher/scripts/fleet-task.py await a1e15a53baa351db3fb77b5e6f613e289d8b4e878d0911e6b9c20b748afa55bf --out /tmp/builder-1975/mac-final-handback-evidence` (use a fresh output directory). Required files: `desktop/capture.json`, `playwright.json`, `playwright.config.ts`, `playwright.list.log`, `execution.log` and `fake-daemon-setup.json`; inspect the full configured counts, every skip reason/retry, all setup/native stdout/stderr attachments, all 15 thread-activation cases, both indexed quit/window cases (including macOS same-process reactivation), and the saturated packaged OS-keychain case. Commit inspected evidence and update draft PR #2019 before marking it ready; a queued task or an earlier revision's result is not acceptance. Local role-owned checks are finished and passing; no local validation process is left running. This subsequent commit records evidence only. The Linux raw native stderr also includes a network-service restart at process shutdown in addition to system-bus/GPU/color warnings; completion and all assertions passed, and the raw files are retained for independent inspection.

2026-10-15 — Handback local gates after confirming main `ac44f55cd3f660769d5bbacb0a9b5ea8df96143b`: install, build and documentation guard pass; escalated pre-verify passes 5/5, 422 unit files and **10,414 passed, zero failed, 30 inherited skips** (27 legacy connection cases from main plus the existing three interop/live skips). Focused migration: **14 executed/passed, zero failed/skipped**. Linux focused Playwright: **18 executed/passed, zero failed/skipped/retries**, configured four workers. Includes all 15 named `thread-activation.spec.ts` cases, both `indexed history drains a buffered thread replacement on quit/window and restores it offline` cases, and `packaged protected history commits and reopens with production encryption`. No test was disabled by this branch. Main's retired legacy renderer cases remain tracked by #2020; they are not counted as executed proof. Inspected packaged attachments and raw `/tmp/pyry-history-native-z2DNFU/runtime.stdout` / `runtime.stderr`: Electron 33.4.11, Node 20.18.3, adapter 12.4.1, `gnome_libsecret`, packaged/asar/unpacked true, `stage: complete`, exact saturated/both-format reopen and fixture plaintext rejection; 100,000 memberships, replacement 6,693 ms. Stderr contains only known system-bus/GPU/color warnings, with successful completion. Artifacts: `/tmp/builder-1975/pre-verify-handback.log`, `build-handback-final.log`, `saturation-unit.log`, `linux-focused-handback.json` and its `.stderr`. Earlier diagnostic Linux native run also passed (10,661 ms under concurrent unit load). The sandboxed gate attempt had socket failures and is excluded; the accepted gate ran with required network/loopback access. No live Claude spec changed. Managed task `465a91b4ee3e9605f06a7a58a34e5ab3a1932bc8973c3af3d8df6c3bc7de68d7` covers intermediate revision `91d0a417`; request the final revision including the new lifecycle spec and strengthened native assertions separately. No Mac acceptance is claimed until exact-revision evidence returns.

2026-10-15 — Preserve current lifecycle proof after main retired the legacy renderer suite: `e2e/indexed-history-lifecycle.spec.ts` adapts the existing quit/window scenarios to authoritative thread events. Pause the renderer timer, establish a rendered-but-unsaved replacement, then close without advancing time. Exact saved content/checkpoint must survive offline relaunch; on macOS window close/reactivation must reuse the still-live database owner. Linux packaged saturation passed with production protection and exact reopen; its full replacement took 10,661 ms, demonstrating that five-second successful-save polling is not a valid bound for this full-operation workload. No renderer/writer behavior changes; bounded/partial activation remains #1931.

2026-10-15 — Operator handback: retrieved final task `38452917dc4feeea54d25fd30a0f2b4e8ad0406de20f288b18559dc794c96247`, exact candidate `d89f50d5ee585e16fe30815f85c5e025c81edf5b`. Report SHA256 `85eaeec6f39c12163dcb2dae5e023e4467af5e5c7db0728e050f41f099af96ed` matches the retained original. Full configured run: 438 executed, 437 passed, one failed, one existing pointer skip, zero retries, four workers. Inspected configuration, capture, execution/list logs, empty setup inventory, launch-fate attachment and both native attachments. Nine history cases and packaged OS-keychain proof passed; native stderr is empty. Receipt saturation alone timed out observing successful saves (`[]`) after five seconds; that observer records neither admission nor failure, so the report cannot establish a root cause or a lost write. Full replacement first decrypts the previous 100,000 membership records then encrypts their replacements. Add exact saturated migration/replacement/queued-read/fresh-owner proof and extend the existing packaged smoke with the same 500-by-200 memberships, classified completion and elapsed time. No production behavior or assertion is relaxed. Merged main's independent #1908 already retires legacy renderer regressions under #2020 and replaces production with authoritative thread restoration; retain every main change and run its active thread lifecycle regressions. This historical failed capture remains failed; new candidate platform evidence is required.

2026-10-15 — Implementation retained the design. The final written scope is below the forecast and the normal 800-line ceiling. No new exported type or dependency; nine actual store construction sites, including the newly found update-drain regression, were adapted. Source collection write barriers no longer represent indexed I/O: store tests now hold source import, handler tests hold membership, writer integration tests hold writer admission, and SQLite triggers prove mutation rollback.

Lifecycle proof maps to these executed tests in `src/main/chatHistoryMigration.test.ts`:

- First/repeated import, newer database content and reopen: `imports both exact formats once, preserves newer indexed content and never reopens the source after restart` (also checks list reads without source access and file plaintext).
- Interrupted import/retry: `rolls back an interrupted two-format import and retries without duplicates`.
- Invalid/version/decrypt failure and recovery: `preserves an unreadable %s source and recovers without poisoning the queue`.
- Commit/cleanup failure, restart and identical owner/epoch reuse: `retries retirement after commit without replaying removed records, even with reused identities`.
- Held import/removal/unpair and queued stale saves: `orders a held import before %s removal and rejects queued stale saves after identical reuse`.
- Shutdown: `drains accepted import before close and rejects later admission`.
- Unsupported database and unavailable protection: `preserves committed records and source when database admission or encryption is unavailable`.

`src/main/chatHistoryHandler.test.ts` additionally executes `invalidates queued conversation work while allowing fresh identical coordinates`, including stale list replacement. Backend schema assertions now expect additive schema 5. The durable singleton completion record is the application deletion fence: every application mutation follows its commit, so source replay cannot cross a completed deletion, even if source retirement fails.

2026-10-15 — Packaged proof rejected the new smoke fixture because `ThreadSnapshot.repair` is required even when null. Add explicit fixture admission before writing, retain the classified failure stage, and provide `repair: null`. Existing Linux history recording passed all ten cases independently. `keeps detached Promise backend execution callable` caught a `this` dependency introduced by the synchronous seam; Promise wrappers now close over their API and preserve detached invocation.

2026-10-15 — Final verification on production candidate `5fd895e82e936901395339fa83494fb16e978ce9` (subsequent edits record evidence only):

| Check | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 418 files; pre-verify 5/5 and build green after final main merge | 10,385 | 10,385 | 0 | 3 |
| Linux `e2e/chat-history-recording.spec.ts`, all ten existing deletion/unpair/restart/quit/window regressions | 10 | 10 | 0 | 0 |
| Linux packaged production adapter | 1 | 1 | 0 | 0 |
| Managed macOS complete configured fake suite | 438 | 417 | 21 | 1 |
| macOS packaged production adapter (included above) | 1 | 1 | 0 | 0 |

Both packaged checks reported Electron 33.4.11, embedded Node 20.18.3, better-sqlite3 12.4.1, `packaged: true`, `asar: true`, `unpacked: true` and `stage: complete`, with exact two-format reopen and no fixture plaintext. Linux uses `gnome_libsecret`; macOS uses `os-keychain` and native stderr is empty. Linux runtime stderr contains system-bus/GPU and color warnings, with successful counted completion. Linux artifacts: `/tmp/builder-1975/pre-verify-final.log`, `build-final.log`, `linux-history-final.json`, `linux-native-final.json`; native raw files are `/tmp/pyry-history-native-b8t8gQ/runtime.stdout` and `runtime.stderr`.

Managed macOS task `7b01967c2f64435a03e26e7ac252a366fafe7f968ab0cb672db85a7e08fcd282`, run `2532786a5afb20fa0d00293b1189add4678cb47b34562752b63f71acfa6dc945`, retains complete reports at `/tmp/builder-1975/mac-final-evidence/desktop/` and through the fleet artifact service. `playwright.json` SHA256 is `7331a4a080254677b928aedf3753c975f74a3cfbe3e5d9b47095f5f069eec6b7`. Its native stdout/stderr attachments contain the counted PASS; Mac native scratch is `/var/folders/k0/gc07w9ws319b07n0plnw6y8r0000gn/T/pyry-history-native-DahhZr`. Configuration retains four workers, clipboard/parallel projects and zero retries. The sole skip is the existing never-shown-window pointer case. Returned `fake-daemon-setup.json` is an empty array; the HTTP 501 pre-launch failure therefore has no setup attachment to inspect.

The full macOS gate is not accepted. The managed runner calls `npm ci`, build and the launcher without `rebuild:electron`, leaving the ordinary app with a host-Node SQLite adapter. Saved-history reads consequently fail. A controlled Linux load after the Node rebuild confirms `NODE_MODULE_VERSION` mismatch; explicit Electron rebuild makes all ten final history regressions pass. The isolated packaged smoke rebuilds its own copy and does not prove ordinary app ABI preparation. Open [#2018](https://github.com/pyrycode/pyrycode-desktop/issues/2018), priority low in Backlog, is a recorded blocker for the agents-repository runner repair. The independent pre-Electron HTTP 501 is recorded on existing [#1983](https://github.com/pyrycode/pyrycode-desktop/issues/1983), keeping its priority; the pairing-authentication UI failure needs triage after native preparation rather than attributing every failure to the adapter. No assertion was disabled. Draft PR #2019 remains pending the runner repair and a fresh counted managed rerun.

2026-10-15 — Continuation verification of pushed candidate `7b185d5d1da5dd1b6a918c7c64a737d50aa3a507`, with no production changes. Fresh fetch and merge confirm main `eb0e7f20b1e4d9f8d6927b4a031e6fd136a5387a` is contained. The only overlapping in-flight branch remains #1908, with independent composition-root wiring. #2018 is now closed: dispatcher PR #270 supplies Electron preparation and its ordering/failure regression. Requested complete managed macOS acceptance as task `07486a9e3d69dfa7f4c04f550b579c25458d3dbb90d7cfd87dcd56a56cdcb0c6`; it is queued, so no new macOS acceptance is claimed yet.

| Fresh check | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Pre-verify: 5/5 checks, full unit suite | 10,385 | 10,385 | 0 | 3 |
| Linux `e2e/chat-history-recording.spec.ts` | 10 | 10 | 0 | 0 |
| Linux `e2e/history-native.spec.ts` | 1 | 1 | 0 | 0 |

Install, build and documentation guard pass. Prepared `rebuild:node` before the final unit gate and `rebuild:electron` before ordinary Electron regressions; the initial unprepared gate was interrupted and is not accepted evidence. No test or assertion changed. Fresh Linux history execution uses the configured clipboard project, zero retries and the following named cases:

- `confirmed deletion removes saved content through restart without waiting for a list refresh`
- `explicit unpair discards buffered history across restart while same-server repair retains it`
- `receipt saturation still saves a repeated page and later live content across fresh relaunches`
- `records received content, drains buffered quit, and reads locally after relaunch`
- `window close saves accepted deltas before their frame and reopening restores the full reply`
- `restores a pairing-rejected saved host beside a usable connected host`
- `pending saved reading survives opening and cancelling host repair`
- `local list read failures stay beside the saved host`
- `saved coverage survives offline restart, reconnect, live receipts and connected reopening`
- `protected restoration joins partial pages while retaining an expanded tool and content anchor`

The packaged case `packaged protected history commits and reopens with production encryption` passes with Electron 33.4.11, embedded Node 20.18.3, better-sqlite3 12.4.1, `gnome_libsecret`, `packaged/asar/unpacked: true`, `stage: complete`, one executed/passed and zero failed/skipped. The runtime proves exact two-format reopen and rejects fixture plaintext in history files. Inspected both native attachments and raw runtime output: Linux stderr contains system-bus/GPU and color warnings, with successful completion. Fresh artifacts: `/tmp/builder-1975/pre-verify-prepared.log`, `build-rerun.log`, `linux-history-rerun.json`, `linux-native-rerun.json`; packaged runtime stdout/stderr are under `/tmp/pyry-history-native-dHzBmI/`.

2026-10-15 — Continuation found and reproduced an activation error-classification gap: an outer SQLite COMMIT failure after a successful nested timeline/thread replacement returned `unreadable`. Track successful backend replacements as writes before the enclosing commit, preserving backend validation errors while classifying outer write failures as `write-failed`. The real-disk regression `classifies an outer %s replacement commit failure and preserves the committed snapshot` uses deferred foreign keys for both families; both cases failed with `unreadable` before the fix. It also checks rollback, fresh-owner preservation and a later successful replacement. No API, state or security boundary changes.

2026-10-15 — Final corrected production candidate `d89f50d5ee585e16fe30815f85c5e025c81edf5b` contains main `ec5a996819b1d1d75787ce2a5e4f05c10510ab6a`, including its independent Linux display-isolation changes. No main changes were removed. Install, pre-verify (5/5), build and documentation guard pass after that merge.

| Final corrected check | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Full unit suite, 419 files | 10,394 | 10,394 | 0 | 3 |
| Focused migration suite, including both outer COMMIT cases | 13 | 13 | 0 | 0 |
| Linux history recording: same ten named cases above, zero retries | 10 | 10 | 0 | 0 |
| Linux packaged production-encryption case, zero retries | 1 | 1 | 0 | 0 |

Final local evidence is `/tmp/builder-1975/pre-verify-corrected.log`, `commit-failure-red.log`, `commit-failure-green.log`, `build-corrected.log`, `linux-history-corrected.json` and `linux-native-corrected.json`. Inspected the final native stdout/stderr attachments and raw `/tmp/pyry-history-native-QPaKia/runtime.stdout` / `runtime.stderr`: counted `stage: complete`, exact two-format reopen, no fixture plaintext, Electron 33.4.11, Node 20.18.3, adapter 12.4.1, `gnome_libsecret`, and packaged/asar/unpacked all true. Runtime stderr has system-bus/GPU and color warnings; the packaged test and runtime both pass.

Managed macOS acceptance of this corrected revision is task `38452917dc4feeea54d25fd30a0f2b4e8ad0406de20f288b18559dc794c96247`, superseding queued request `07486a9e3d69dfa7f4c04f550b579c25458d3dbb90d7cfd87dcd56a56cdcb0c6`. The corrected request remains queued with no assigned machine, run ID or result; it is tracked work, not a failed test or accepted platform proof. Required remaining evidence: `desktop/capture.json`, `desktop/playwright.json`, `desktop/playwright.list.log`, `desktop/execution.log`, `desktop/fake-daemon-setup.json`, all ten named history cases and the packaged native case with its stdout/stderr attachments. Retrieve through `fleet-task.py await` into a fresh directory, verify the exact revision, complete counts/configuration/skip reasons/retries, and inspect every returned setup/native attachment before acceptance. PR #2019 remains draft pending that proof; no assertion is disabled and no live Claude spec is changed.

2026-10-15 — Repaired-runner macOS evidence returned for earlier candidate `7b185d5d1da5dd1b6a918c7c64a737d50aa3a507`: task `07486a9e3d69dfa7f4c04f550b579c25458d3dbb90d7cfd87dcd56a56cdcb0c6`, run `2652a3ef54958d858c5d25732a2bd0deb40753aee8e39f56f39d0b24b15786d3`. Complete configured suite: **438 executed, 438 passed, 0 failed, 1 skipped, 0 retries**, four workers, original clipboard/parallel projects. All ten named history cases and `packaged protected history commits and reopens with production encryption` executed and passed. The only skip is `an independent input-enabled cover preserves isolated hover`, because a never-shown window receives no pointer from the display. Capture/global errors are empty and the full returned setup attachment inventory is `[]`.

Inspected the full report, original configuration, list/execution logs and both native attachments. Execution includes `rebuild:electron` before launch, establishing the #2018 repair on the Mac route. Packaged native evidence: one executed/passed, zero failed/skipped; Electron 33.4.11, Node 20.18.3, adapter 12.4.1, `os-keychain`, packaged/asar/unpacked true, `stage: complete`, exact two-format reopen and no fixture plaintext. Its stderr attachment is empty. Mac scratch is `/var/folders/k0/gc07w9ws319b07n0plnw6y8r0000gn/T/pyry-history-native-Vph9JE`. Full artifacts remain available through the task service and locally in `/tmp/builder-1975/mac-rerun-evidence/desktop/`; report SHA256 is `0f0cd57a3f9081a501fc25561567bf656f7a648e74cea8bef469adf968042013`, original config SHA256 is `f2868e97d72733c286ff8c3098f09adc62e2e8bfa3ad9393e000eebf9a429d5a`.

Final corrected candidate `d89f50d5ee585e16fe30815f85c5e025c81edf5b` is now running on `macbook` as task `38452917dc4feeea54d25fd30a0f2b4e8ad0406de20f288b18559dc794c96247`, run `35643d912d365b047f1428427131ff8abe24d885db5b7a67b2ead9fc7cfe7a34`, admitted at 14:48:47 UTC. Its report/counts/attachments are still pending. The passing earlier candidate proves the runner repair and its own revision; it does not replace acceptance of the final correction. Retrieve and inspect this final task's same required files before marking PR #2019 ready. Local final checks remain green and fully pushed; the outstanding requirement is counted managed macOS proof, not a reported test failure.
