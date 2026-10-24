# Compact attachment continuity

## Files read

- `src/main/transport/threadUpdates.ts` → `createThreadUpdateReceiver`, `logical`: compact user roots retain full content, with separate data/final query frames.
- `src/main/daemonConnection.ts` → thread delivery wiring: authenticated host attribution precedes renderer delivery.
- `src/renderer/src/store/threadCompact.ts` → `admit`: item replacement and session-only compact authority.
- `src/renderer/src/store/threadRuntime.ts` → `presentation`, compact subscription: zero complete-history evidence; scoped send settlement uses the admitted snapshot.
- `src/renderer/src/store/threadSendStore.ts` → `settle`: host/conversation/device/message identity controls retirement, never text.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `attachment`: accepted rows require daemon attachment ID and filename.
- `src/renderer/src/store/threadSendStore.test.ts` → scoped settlement controls: reuse cross-host/conversation/device and unusable identity coverage.
- `e2e/compact-demand.spec.ts` → native compact send fixtures and positive echo/recovery barriers.
- `e2e/thread-items.spec.ts` → authoritative attachment retrieval and scoped actions.
- `e2e/real-claude-attachment.spec.ts` → actual upload and image retrieval; preserve its existing provider assertion.
- `e2e/fixtures/realDaemon.ts` → isolated profile relaunch and resource cleanup.
- `docs/knowledge/features/thread-runtime-compact.md`, `conversation-shell-timeline-render.md`, `conversation-shell-message-bubble-attachments.md`, `attachment-upload-testing.md`: compact facts cannot become persisted complete history; shared attachment rows already provide retrieval.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `docs/knowledge/features/development-verification.md`: replay is client evidence only; fresh live proof requires source identity and counted execution.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Read design context and screenshot on 2026-10-24. Preserve the right-aligned user bubble, embedded image/file treatment and existing attachment actions within the sidebar/chat layout. No visual or theme implementation changes are planned.

## Context

Daemon #3693 records conversation-owned stored attachment facts; #3694 preserves them through delivery. The dedicated Linux test binary is pyry 0.43.0, clean source `94bd216633c49d6f87f775da1f492d321b90e0c3`, containing both fixes (verified ancestry). The historical ID-only input cannot supply filenames and must remain a negative comparison. Test current behavior before considering any production correction. No ADR needed.

One behavior: authoritative attachment continuity through acceptance and subsequent online delivery. Forecast <=450 written lines: about 100 plan/evidence, 70 regression and 250 mounted/live test lines; zero new production exports, no consumer migration, four acceptance criteria, no new reject state machine. Remote feature overlap scan found no branch touching the proposed test files. Production changes require new evidence and a plan revision first.

## Design

Retain the production path unchanged unless a client defect is demonstrated. Add a bounded regression passing genuine compact full-root input through the main receiver into the runtime and send settlement, then adapt the admitted item with the existing presentation function. Compare ID-only historical content (no accepted attachment) with repaired full facts (daemon attachment only), including replacement and catch-up. Reuse existing isolation assertions.

Add mounted current-daemon acceptance beside the existing live attachment spec, using its actual upload/native-picker pattern and existing isolated relaunch. Positively observe owning user-message facts and compact query completion before asserting rendered rows. Observe queued acceptance and delivered replacement, navigate to another conversation and back, then restart the app and require fresh compact delivery. Exercise the existing image preview/open path, proving decoded daemon bytes after fresh reopening. Retain only synthetic attachment metadata and content-free provenance in test artifacts.

## State + concurrency model

No new production state. Test observers belong to their page lifetime. Isolated app relaunch waits for process exit before reusing its profile; daemon and relay teardown remain fixture-owned. Compact snapshots remain session-only and separate from the complete item store and protected history writer. No optimistic data is copied into daemon rows.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Optimistic send accepted, then delivered under the same ID | compact attachment regression; mounted attachment acceptance |
| Repeated full-root replacement / catch-up | compact attachment regression; observed mounted compact deliveries |
| Equal text, peer device, reused host/conversation IDs | existing `scoped daemon send settlement` tests; regression retains distinct local/daemon facts |
| Navigate away/back | mounted attachment acceptance requires a new query completion |
| Online restart under the same conversation identity | mounted attachment acceptance requires fresh full-root delivery and decoded preview |
| Missing authoritative facts | ID-only comparison must render no accepted attachment, with local row retired |

## Error handling

No new I/O or IPC contracts. Existing typed upload/retrieval outcomes remain authoritative. Missing daemon facts fail the test; they never trigger resend, tool-body expansion or optimistic attachment retention. Missing live access records the exact operator scenario and an explicit pre-merge hold, with zero execution never counted as a pass.

## Testing strategy

- Unit: actual compact frame parsing, runtime admission, scoped send retirement, presentation, replacement/catch-up and zero complete-history authority. Existing settlement file verifies cross-scope identity refusal.
- Mounted/live: real daemon upload/acceptance/replacement, one accepted row, navigation, online restart and actual image retrieval. Record Linux, Desktop build identity/profile, daemon source/version/SHA-256, accepted owning-host capability booleans and counts.
- Existing live attachment color assertion remains unchanged. Offline recording is not current provider evidence.
- Final main merge, pre-verify for each affected unit file, build, and the targeted mounted/live scenario. No full Playwright sweep.

## Open Questions

- Does repaired current-daemon behavior need any Desktop correction? Resolve through the retained regression and mounted/live run before handoff.
- Is live login available through the approved launcher? Resolve by invoking it; if unavailable, retain a concrete Juhana pre-merge hold.

## Security review

**Verdict:** PASS

- [Trust boundaries] Tests exercise `createThreadUpdateReceiver` and attributed runtime admission; no new parser, renderer authority or attachment synthesis. Missing filename remains absent.
- [Tokens] Existing isolated pairing and main-only credentials remain; test artifacts must never serialize pairing payloads or keys. Live launcher supplies login without agent credential access.
- [Files/storage] Fixture image uses a new owned temporary directory; cleanup targets only that directory. Compact evidence is never persisted as complete history. Retrieval stays behind existing validated attachment services.
- [Electron] No bridge or browser security settings change. Native picker and external open are stubbed only in tests, preserving production upload/retrieval.
- [Cryptography] No primitive, Noise variant, key lifecycle or nonce changes; genuine daemon tests retain existing encrypted transport.
- [Network/I/O] Existing bounded frame receiver and fixture timeouts apply. No new relay URLs or production network paths.
- [Errors/logs] Retain synthetic attachment facts, static capability booleans, versions and hashes only; no user message bodies, credentials or decrypted real-user payloads in diagnostics.
- [Concurrency] Page observers die with their app; fixture relaunch drains the old process and finally tears down daemon/relay even on assertion failure.
- [Threat model] Malformed daemon facts cannot gain attachment authority through optimistic state; cross-host/device/conversation settlement controls remain. Relay delay/reorder remains subject to existing revision admission. Renderer gains no secrets/socket/filesystem access.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-24

## Revisions

2026-10-24 rework, verifier finding 1: the earlier navigation evidence contained a returned root, but the assertion could pass with retained send-time roots and an empty final. Extend `observe` with each query root's request ID and event sequence; successful compact finals retain the same ownership and sequence. A small test-only `completedAttachmentDelivery` predicate requires the expected accepted root ID, daemon attachment ID/filename and delivered status from that exact request before its final. Unit cases reject retained/live roots, another request, mismatched facts, missing data/final and reversed data/final order. Navigation and restart each capture their query boundary, select a newly dispatched owning compact request, and require this predicate before inspecting rendered rows. Restart also retains its version-zero requirement. All existing scoped settlement, replacement, retrieval and missing-complete-history assertions remain.

This repairs the same acceptance invariant without changing Desktop production behavior. Completed work is 338 added lines; remaining forecast is about 120 lines across the observer/assertions, test-only predicate/regression and this record, staying below the original 450-line estimate approximately and the 800-line ceiling. No new production exports, consumer migration or reject state machine. Remote feature overlap scan found no other branch touching these test files. Final validation will rerun the affected unit tests, build/client-test typecheck and exact current-daemon live scenario on Linux, with new counted evidence recorded below.

Security recheck: PASS. The existing nine-category review still applies: only read-only test observations and synthetic scoped facts change; no production parser, IPC authority, credential access, storage, crypto, network or window policy changes. Event sequencing prevents unrelated/delayed delivery from certifying the wrong query; page/fixture teardown still owns observers and live processes. Test artifacts remain synthetic metadata and content-free provenance. No new MUST FIX or SHOULD FIX findings.

2026-10-24: No Desktop production defect remains with supplied full-root attachment facts. Added the comparison beside the existing main/preload/runtime integration cases in `e2e/threadBodies.test.ts`, and isolated current-daemon acceptance in `e2e/real-compact-attachment.spec.ts` rather than changing the older shared color scenario. That older scenario's original provider assertion passed unchanged against the repaired daemon. The new live scenario also passes acceptance, navigation, online restart, decoded image retrieval and missing complete persisted history. Both Open Questions are resolved: no production patch, and the approved launcher has live access.

The historical retained input is `e2e/recordings/claude-attachment.json`, SHA-256 `6d54b1aa7ae9bf9a0967e30279439dab8cfe6dd12c574b78594da8e51b56aaba`, captured from Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5` / daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`. Its queued user root carries one `attachment_ids` entry and no `attachments`; subsequent changed content also lacks attachment facts. The new comparison preserves this absence instead of inventing a failing Desktop patch. The current daemon returns the same attachment ID/filename across queued acceptance, delivered replacement and fresh compact query data.

Exploratory evidence stays under `/tmp/builder-2164/`: `live-baseline.log` failed at Electron launch because the build had not completed; `live-baseline-built.log` passed the unchanged color case (1/1/0/0 executed/passed/failed/skipped). `live-compact-first.log` and `live-compact-barriers.log` failed because the test captured the old sidebar title before new-chat activation; the observer showed real queued/delivered facts and retrieval. `live-compact-navigation.log` reached fresh delivery but failed its storage reading before Electron's SQLite native dependency was prepared. `npm run rebuild:electron` fixed that setup; `live-compact-native.log` passed (1/1/0/0). None of those earlier failed attempts is claimed as a pass. Navigation now waits for the new row and the other conversation's completed query. Reopening explicitly correlates each owning query with its successful final marker; restart requires version zero and full authoritative roots. The final run will identify a clean committed normal build separately.

Final size forecast: about 340 written lines, zero production changes/exports/consumer migrations or added reject branches. One behavior and its regression remain together.

### Final Linux acceptance

Executed normal build `901a5517204cfff8f6d342d4d9d820f7075d96c5`, `sourceDirty=false`, after merging main `aba135ed6e4c`. The final evidence-only commit adds this record; it changes no executed code. Daemon `/opt/pyry-test-daemon/pyry`: 0.43.0, clean source `94bd216633c49d6f87f775da1f492d321b90e0c3`, SHA-256 `e669aa7f717d41ba91ade23f84158ac4208dbc66563613e25bc49b090ad449ff`. Both prerequisite fix commits are ancestors of that binary's source.

| Check | Executed / passed / failed / skipped |
| --- | --- |
| `e2e/threadBodies.test.ts` plus existing scoped-send isolation tests, initial targeted invocation | 188 / 188 / 0 / 0 |
| Final pre-verify, affected `e2e/threadBodies.test.ts` | 175 / 175 / 0 / 0 |
| Unchanged real attachment/provider color scenario | 1 / 1 / 0 / 0 |
| Final `compact attachment survives owning echo, replacements, navigation and fresh online restart` | 1 / 1 / 0 / 0 |

Pre-verify passed all five checks; `npm run build`, `npm run typecheck:client-tests` and `git diff --check` passed. The unit gate prepares SQLite for Node, so `npm run rebuild:electron` must follow it before mounted storage checks. `live-compact-final.log` preserves a failed concurrent attempt with static `unreadable`; after the unit gate completed and Electron native preparation ran, `live-compact-final-electron.log` passed without test retries. No assertions were skipped or weakened.

Final live run started 2026-10-24T15:46:11.864Z, duration 8.880 seconds. Its owning accepted handshake reports `interactive=true`, `thread=true`, `thread_expansion=true`, `thread_compact=true`. The same user root (id 1) supplies `attachment_id` and `filename` at queued rev 1, delivered rev 7, navigation catch-up rev 7 and fresh-process rev 7. The matching host/conversation/device/message observer and query/final correlation fence every assertion. Exactly one user row and one decoded 64px image remain; zero queued/local duplicates, one initial send, zero restart sends and zero tool-body reads. Fresh restart issues a normal compact query at version zero, receives full root data and a successful separate final, completes real daemon retrieval, and reads complete persisted history as `missing`. A null handshake observation in the fresh-page artifact means the observer installed after that handshake; the initial accepted handshake above is the observed capability proof.

Retained evidence under `/tmp/builder-2164/`: final report `live-compact-final-electron.log` (SHA-256 `bd53ce5584d54198b1979f5d2e1e7d33431de5055b60ebcdb8151885132babff`), decoded attachments `final-provenance.json`, `final-accepted-and-reopened.json`, `final-fresh-online-delivery.json`, `final-complete-history-reading.json`; `pre-verify-thread-bodies.log`, `client-typecheck.log`, `final-build.log`. Production bundle SHA-256: main `4ba11a8bae93d14a3d407eb2b182513d10c13b321f759ff5551f3bb0b91d3783`, preload `0430e6aac5d4c276ae9e2d22447431b4c388c5e1bd68dbe3c7a7d9bada0d4df7`, renderer `1a4440d011695fafc6ab9b063d9723a7ff828b1517d087464fa48f8fa1238fca`.

Viewed `compact-attachment-1280.png` (1280×800, SHA-256 `e2969f3b88c10300b171bd2ff965ca0002f72e869062255e3d39e1747de699a5`) and `compact-attachment-800.png` (800×800, SHA-256 `4c8202b83742e212ac19b93c8ed550a9e89af6f1fa32aaf04f26430edc28018f`) against the Figma screenshot. Existing right-aligned bubble, embedded image, sidebar and footer treatment are preserved; synthetic red swatch replaces fixture imagery only. No unresolved attachment design deviation. macOS is outside this Linux ticket's verification scope. Required live acceptance is satisfied; no pre-merge live hold remains. Dispatcher owns the full unit/application acceptance suites; documentation owns knowledge-base reconciliation.
