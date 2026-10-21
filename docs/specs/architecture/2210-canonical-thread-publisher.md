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

## Revisions
2026-10-21: Selection lives in `e2e/fixtures/threadPublisher.ts`, so a throwing adapter factory proves bypass without starting Playwright. The focused compiler exposed existing unknown-payload annotations in `scriptedThread`; `ScriptEnvelope` and local payload casts clarify authored test inputs without changing runtime logic. No production changes.

The existing native protocol permits one same-version/revision append immediately after a field change. Preserve that explicit companion, consume it once and clear it on intervening item updates; `accepts one ordered same-revision suffix companion` covers it. `setConversation` explicitly replaces facts/epoch, with reused identity checked by the checkpoint control. A second Electron case checks default authored summaries and colliding identities across two canonical hosts. Total remains below 650 written lines and the numeric ceilings.

## Builder verification — macOS
- Final `origin/main` merge: already current at `aba135ed6e4c`.
- Pre-verify: all five checks pass; affected canonical units 8 executed/passed, 0 failed/skipped. Combined canonical + preserved adapter units: 19 executed/passed, 0 failed/skipped.
- `npm run typecheck`, `npm run typecheck:client-tests`, focused fixture/unit/scenario TypeScript check and `npm run build`: pass. Focused config is `/tmp/builder-2210/tsconfig.focused.json` and includes both new test inputs, importing the publisher, selector and launcher.
- Approved focused Electron helper: 3 executed/passed, 0 failed/skipped, including the configured native writer prerequisite and both canonical scenarios. The initial attempt failed the native prerequisite before the canonical scenario ran (1 executed/failed, 1 not run); rebuilding `better-sqlite3` for Electron restored the prerequisite. No assertions changed.
- Complete configured macOS suite is requested against the pushed implementation revision through the managed `desktop-fake-suite` route; counted result will be retained here. Linux is outside this run's verification scope. No fresh provider/encryption/physical-effect acceptance is claimed.

Managed full-suite handoff: task `09802b99bcacd958fef1cc0a1c1c5f51e4d85af6705056b6c32d8be37eb58baf`, candidate `c08993cfa27b5936234bbc191c47504b544e2b69`, recipe/capability `desktop-fake-suite`. Still queued at handoff; no full-suite pass or counts claimed. On return, read this task's fresh JSON/list logs and all setup attachments, inspect failures/skips/retries, and commit the required counted evidence before advancing. The dispatcher holds this builder stage while the requested task is open.

## Returned full-suite evidence — 2026-10-21
The managed task above is complete; its builder hold is resolved. Retrieved all six artifacts with `fleet-task.py read` into `/tmp/builder-2210/native-result-20261021/desktop/`. This evidence covers implementation revision `c08993cfa27b5936234bbc191c47504b544e2b69` on macOS (`macbook`), run `7d501698eb1ee3817dd0edfe272ec854f84bdbcbfc71350e1757a3796814ac4a`. Subsequent commits only record evidence in this plan.

- Full configured `playwright.config.ts` suite: **543 executed, 543 passed, 0 failed, 2 skipped, 0 retries/flaky**; JSON has no global errors and the list log agrees. Started `2026-10-21T06:24:00.100Z`, duration 703.257 seconds. Original configuration matches this branch byte for byte: four workers, native-writer/clipboard/parallel projects, no grep/shard and zero configured retries.
- Both `canonical-thread.spec.ts` scenarios passed: authored opening/stream/page/reconnect without the adapter, and colliding identities across canonical hosts. Native writer prerequisite passed. All 29 active captured-client cases passed; no fresh provider/encryption/physical-effect claim. Linux is outside this macOS ticket's verification scope.
- Two preserved exclusions: `desktop-isolation.spec.ts` / `an independent input-enabled cover preserves isolated hover` skips because a never-shown window receives no pointer; `recorded-clients.spec.ts` / `real claude picks up a saved channel system prompt at Reset session` is the existing reset-prompt fixme documented in `docs/recorded-tests.md` and `docs/client-replay-migration.md` (report reason `unspecified`). Neither counts as passed.
- Inspected all **589** fake-daemon setup attachments and their 589 unique capture references: every attempt is 1, outcome/responder `opened`, matching dial/listener, connection and upgrade observed, valid method/upgrade/key/version, no rejected upgrade, parser error or failure class. No missing attachment references, retries or launcher failures.
- Execution log confirms dependency installation, build and native preparation before the full suite. No source, configuration, recording or assertion changes were needed on return; earlier failed prerequisite evidence remains recorded above.

Artifacts remain retrievable through this ticket's managed task. SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| `capture.json` | `29f265a045b518146242349b4676b20ccfb8517bc53b5c602a18c1c5904987ab` |
| `playwright.json` | `a7299ef446d598cba6679e6e95ba16fbe707e5f5d70154c631967f88b3c365a9` |
| `playwright.list.log` | `47874ce9c82a32bfe7c3217d59a8171b0e4eb2405a697c64e87978cd41e8bb69` |
| `fake-daemon-setup.json` | `8ad875fd88e7fadcc1bf131063764c032e9f3e361c2ef30774027ef602b29f75` |
| `execution.log` | `78705686366f733803b4d2e67e165302348f1022a3d1c463c5bfaafa3126666b` |
| `playwright.config.ts` | `0d1fb967aa3b3d66275b736ec63bc55142dff69708eb297cce6ff3d4898d2643` |

## Revisions — verifier rework
2026-10-21: Findings 1 and 2 correct two invariants of the existing publisher contract; no independent behaviour slice or production change is added. Positive-version catch-up in a different epoch returns only a correlated `thread_reset` with current ownership. The client then requests version zero in that epoch and receives the replacement opening window. `resumes checkpoints and replaces a different epoch` checks correlation and the two replies; Electron `canonical epoch replacement resets a positive checkpoint and recovers reused identity` proves reset recovery, replacement presence, old-content removal and a fresh append on an ID reused at a lower revision.

Authored facts now require explicit, unique, nonnegative safe-integer orders below `Number.MAX_SAFE_INTEGER`, leaving a safe exclusive upper bound. This fixture intentionally rejects ties and missing/cleared orders rather than silently dropping facts or exceeding a requested limit. Validation runs before seeds/replacements and retained updates mutate state. `rejects unpageable authored order %s atomically at every mutation boundary` covers invalid seeds, replacements, additions and changes without altering the retained checkpoint/content. `visits every retained fact once across one-item windows and order changes` covers zero, the maximum supported order, valid repositioning and strict one-item backward traversal. Existing host/conversation isolation remains unchanged.

Recount: one shared-harness deliverable, four acceptance criteria, no new exports or consumers, ten distinct fixture rejection branches; approximately 550 added lines for the whole branch, below the 800-line ceiling. No in-flight feature branch overlaps the three repair files. The regression-first unit run executed 17 controls: 8 passed and 9 failed on the expected missing reset/order validation.

## Documentation handoff
- Pending documentation stage: document per-host canonical selection, authored facts/revisions, explicit summary/session/control ownership, and preserved scripted/native paths in `docs/knowledge/features/development-verification.md` § Source and contract checks.
- Pending documentation stage: record corrected epoch-reset and authored-order constraints, counted test evidence and preserved replay/live-only boundaries in `docs/knowledge/features/development-verification.md` § Replay build policy and provenance.

## Rework verification — macOS
After the final merge of `origin/main` (`aba135ed6e4c`, already current), pre-verify passed all five checks, including application typecheck and 17 canonical units. Combined canonical/preserved-adapter units: 28 executed, 28 passed, 0 failed/skipped. `npm run typecheck:client-tests`, focused TypeScript checking through `/tmp/builder-2210/rework-tsconfig.focused.json` (both changed unit/scenario inputs and their imported fixtures), and `npm run build` passed. The initial sandbox pre-verify skipped its inaccessible label read; approved execution read the issue and passed every check. Unit evidence: `build/dispatcher-tests/unit-zh8iavch`.

The approved focused Electron helper ran all three canonical scenarios plus the configured native writer prerequisite: 4 executed, 4 passed, 0 failed/skipped, 0 retries, 27.8 seconds. The positive-checkpoint epoch replacement and fresh lower-revision append passed through the actual client. Native dependencies were rebuilt for Electron after pre-verify's Node rebuild. A new managed full configured suite will target this pushed rework revision; earlier full-suite evidence above remains scoped to its original candidate. Other OS outside this macOS run's verification scope; no fresh provider/encryption/physical-effect claim.
