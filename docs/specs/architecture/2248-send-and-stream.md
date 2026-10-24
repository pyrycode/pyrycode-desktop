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
