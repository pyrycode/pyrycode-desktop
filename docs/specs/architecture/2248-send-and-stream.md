# Canonical send acceptance and streamed reply

## Files read
- `e2e/send-and-stream.spec.ts` → `buildReplyFrames`: preserve trusted composer input, opened-conversation guard and exact reply oracle.
- `e2e/canonical-thread.spec.ts` → mounted canonical scenarios: explicit selection and positive opening-query barrier.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: shared correlated data/final replies and authored revision ownership.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: canonical selection bypasses the scripted adapter.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: typed identity bridge, real pairing/navigation and publisher-controlled pushes.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: complete facts and exact-base revisions.
- `src/renderer/src/store/threadSendStore.ts` → `matches`, `settle`: acceptance requires device/message identity in the opened scope.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`, `TimelineRow`: pending rows lack an authoritative outer `data-read-row`; active assistant facts render a cursor.
- `e2e/fixtures/bubbleText.ts` → `bubbleTextExactly`: exact content bounded separately from timestamp chrome.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: test boundaries and positive processing barriers.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: retain captured replay, native prerequisites and live-only exclusions.

## Context
Migrate the single mounted send/stream round trip from inferred legacy facts to directly authored canonical facts. No production or visual change, shared fixture edits or new dependency. No ADR needed. Complete configured Linux application acceptance belongs to the verifier gate and is reused once; focused builder proof does not replace it.

## Design
Only `e2e/send-and-stream.spec.ts` changes. Seed a canonical publisher with an explicit conversation summary/current session, epoch, version and a complete opening fact. Observe the actual opened-conversation catch-up request; the shared publisher owns query replies and correlation. Render the opening fact before composer input.

Keep fill then Send click in that order. Capture the outbound `send_message` payload in `buildReplyFrames`, rejecting the wrong conversation before creating a successful assistant response. The default arm supplies no assistant fact, so echoing a command cannot satisfy the exact reply oracle. The test reads public device identity through `window.pyry.deviceIdentity()`.

Hold all authored send responses until exactly one local user row shows the exact typed text and has no authoritative outer item wrapper. Capture of the command establishes daemon receipt without accepting the row. Then publish a complete active assistant fact with exact `REPLY_TEXT`; its visible cursor is the positive processing barrier before rechecking that the user row remains local. Publish the explicit delivered user fact with captured device/message identities, advancing the version, and require exactly one user bubble inside its authoritative wrapper with no remaining local duplicate. Finally publish an exact-base assistant completion revision; require exact reply text and no cursor.

## State + concurrency model
Spec-local captured requests and outbound payload only. Every update is synchronous fixture input, with advancing versions, unique orders and explicit session ownership. No timers, subscriptions or production state changes. Existing fixture teardown owns Electron, daemon and relay resources.

## State transitions and identity reuse
All rows are covered by `send a message and see the streamed daemon reply render in the thread`:

| Event | Check |
| --- | --- |
| Opening query | Actual conversation/version-zero request plus rendered authored opening fact |
| Send/command receipt | One exact local pending row before release and after captured outbound request |
| Active assistant arrival | Exact reply and cursor, then the user still local |
| Explicit own-device acceptance | Matching outbound message ID, one authoritative user row and no duplicate |
| Assistant completion | Exact-base revision, exact reply and cursor removal |

No reconnect, retry, reset or identifier reuse is introduced; the shared publisher's existing controls retain those contracts.

## Error handling
No new application failure paths. Preserve the wrong-conversation no-reply guard and default-echo failure oracle. Shared publisher rejects invalid authored ownership/revisions. Failed bridge identity retrieval fails the test rather than fabricating identity.

## Testing strategy
- First add the positive authored-opening assertion and observe the legacy scenario fail, then migrate the scenario.
- Run the owned Playwright spec with retries zero and its configured native prerequisite; keep original timeout bounds.
- Run canonical publisher/selection and send-settlement units, pre-verify, application/client-test typechecks, a focused compiler check covering the owned spec (outside the default client-test include), and build after merging main.
- The dispatcher/verifier runs the normal complete configured application gate, including captured-client replay and existing native prerequisites. Record exact revision, Linux, counts and owned-scenario execution when that evidence returns; do not duplicate that gate here. macOS is outside this ticket's scope. No fresh provider/encryption/physical-effect proof.

## Open Questions
None. Cleaner shape considered: direct spec-owned authored additions/revisions through the existing publisher; no shared helper or legacy adapter state is needed.

## Scope check
One independently testable round trip, four acceptance criteria, approximately 220 written lines including plan/evidence, zero production files/new exports, one local callback consumer, zero new production reject branches. No in-flight feature branch overlaps the owned spec at the initial fetch. Recount before plan commit remains below every builder ceiling.

## Builder verification — Linux
Executed candidate: `133abc4cc7262e212389d3b1b01faceda4edc522`, Linux x64, 2026-10-24. Final main merge contains `a653c019873c03288c96e721559a0b183a693be6`; no conflicts. Build provenance records this exact candidate, normal profile and `sourceDirty: false`. Subsequent changes only record this evidence. Plan commit `1bec1058` precedes implementation.

- Test first: adding the authored-opening assertion to the legacy script failed at that assertion. Two executed: one native prerequisite passed, one owned scenario failed, zero skipped/retries. Historical failed evidence remains at `/tmp/builder-2248/red.log` and `/tmp/builder-2248/red-results/`.
- Pre-verify: **5/5 checks passed**, including the live label read, `npm run typecheck` and canonical publisher units **17 executed/passed, 0 failed/skipped**. Artifacts: `/tmp/builder-2248/pre-verify.log`, `build/dispatcher-tests/unit-liggpy7e/`.
- Send-settlement units: `npm test -- src/renderer/src/store/threadSendStore.test.ts`, **13 executed/passed, 0 failed/skipped**; `/tmp/builder-2248/send-units.log`. Combined applicable units: **30 executed/passed, 0 failed/skipped**.
- `npm run typecheck:client-tests`, focused `npx tsc --noEmit -p /tmp/builder-2248/tsconfig.focused.json`, and final `npm run build`: pass. The focused config includes the owned spec and its imported fixtures because the default client-test config does not collect this fake spec. Logs are `/tmp/builder-2248/client-typecheck.log`, `/tmp/builder-2248/focused-typecheck.log`, `/tmp/builder-2248/build.log`.
- Node unit preparation completed before restoring Electron's SQLite ABI through `native-preparation.py electron`; `/tmp/builder-2248/electron-native.log`. Initial sandbox installation failed on esbuild subprocess EPERM; approved installation succeeded. No assertion or environment-security policy changed.
- Final mounted command: `PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/builder-2248/final-playwright.json npx playwright test e2e/send-and-stream.spec.ts --retries 0 --output /tmp/builder-2248/final-results --reporter list,json`. **2 executed, 2 passed, 0 failed/skipped/flaky, 0 retries**, no global errors, 33.755 seconds starting `2026-10-24T16:49:56.804Z`.
- Explicitly executed/passed: `send a message and see the streamed daemon reply render in the thread` and configured prerequisite `finite protected writer backlog preserves native keyboard and both event loops`. All three fake-daemon setup attachments were inspected: attempt 1, opened, matching listener/dial, valid upgrade, no rejection/parser/failure category. No new skip or timeout changes.
- Final report SHA-256: `2dc2fc9950888833d3d5f79b357b6a13793941131f5096ae0b5b9f60dc323870`; list log `/tmp/builder-2248/final-playwright.log` SHA-256 `7a97c578921f827b22f6309d511e0e7e26e3a3907b21eb58cebabb26fc2a51fd`.

## Completed verifier evidence — Linux

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2252#issuecomment-6387177626)
records PASS at `0c417eacde1ea4cb13345553750f9dad406719ac`, Linux x86_64,
2026-10-24, with exact-revision normal-profile build provenance and
`sourceDirty: false`. This revision adds only plan evidence to the builder's
tested implementation. The normal complete configured application gate executed
542 tests: 542 passed, 0 failed, 4 skipped, 0 retries/flaky. Both
`send a message and see the streamed daemon reply render in the thread` and
`finite protected writer backlog preserves native keyboard and both event loops`
were present and passed once. All 29 captured-client replay cases passed with
773 matched requests, 3,216 emitted frames, zero remaining and zero mismatches.

The supplied dispatcher unit gate report records 10,045 executed/passed,
0 failed, 3 skipped; this counted report takes precedence over the verdict's
10,144 prose total. The matching configured gate supplies complete-suite proof
once; no duplicate run was ordered. Exact log/hash provenance and the completed
documentation handoff are in the
[canonical send/stream validation record](../../knowledge/features/development-verification-replay-validation.md#canonical-send-and-stream-validation).
Existing captured history, protected storage, native prerequisites and live-only
assertions/exclusions remain in place. These are retained results; no fresh
provider, real-daemon, encryption or physical-effect proof is claimed. macOS is
outside this ticket's verification scope.

Final scope remains one round trip, four criteria, zero production files/new exports/shared fixture edits; approximately 180 added lines including this plan/evidence, below the admitted estimate and builder ceilings.
