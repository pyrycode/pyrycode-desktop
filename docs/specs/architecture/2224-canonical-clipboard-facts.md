# Canonical facts for native clipboard scenarios

## Files read
- `e2e/code-block-copy.spec.ts` → `buildReplyFrames`: block literals, keyboard/focus and viewport geometry assertions.
- `e2e/message-copy.spec.ts` → `buildReplyFrames`: source-copy, permission denial and bubble geometry assertions.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: authored facts, advancing versions/revisions and correlated query certificates.
- `e2e/fixtures/threadPublisher.ts` → `selectThreadPublisher`: canonical mode bypasses the scripted adapter.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchPairedAppOptions`: publisher wiring and trusted pairing/composer drive.
- `e2e/send-and-stream.spec.ts` → `fact`, `frame`: explicit session and device/message acceptance contract.
- `playwright.config.ts` → `CLIPBOARD_SPECS`: serial clipboard project with native-writer prerequisite.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`: repository rules and reading map.
- `docs/knowledge/features/development-verification.md`: canonical facts cannot infer receipts; rendered barriers establish processing.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: preserve replay, storage, native prerequisites and live-only boundaries.

## Context
Migrate the existing native clipboard acceptance behavior to authored daemon thread facts.
These two variants share the existing serial clipboard gate; no production behavior changes.
The scoped analogue #2248 wrote 92 lines in its spec. Forecast: approximately 220 written
lines including this plan, zero new exports/production consumers, three acceptance criteria,
and no production error branches. No overlapping remote feature branch touches either spec.
No ADR or documentation changes are required.

## Design
Each mounted case owns an empty canonical conversation with explicit epoch, version and
current-session metadata. Pass it to `launchPairedApp` with canonical mode. The publisher
alone supplies conversation lists and correlated opening/page/catch-up replies. Record
requests; other requests return no fabricated content. Keep the trusted composer send
before any reply facts, validate its conversation and text, and observe the opening query.

Code copy publishes an ordered, finished assistant fact containing the unchanged Markdown
source. Message copy publishes an active assistant fact, explicitly accepts the submitted
user text with the actual message ID/public device identity, then settles the assistant
using an advancing version and revision. A rendered assistant barrier precedes the check
that no canonical user acceptance has been invented. Preserve all existing product assertions,
sentinels, clipboard reads/writes and timeouts; assert canonical queries and no legacy aliases.

## State + concurrency model
Only test-local publisher/request state changes. Frames are delivered after the recorded
send, in explicit version order; the fixture owns Electron/daemon/display teardown.
No new subscriptions, stores or long-lived jobs are introduced.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Opening empty conversation, then trusted send | Both existing named clipboard cases observe canonical query and submitted identity before publishing. |
| Active assistant followed by explicit user acceptance and terminal revision | Existing message-copy case checks rendered assistant, absence of accepted user, then canonical accepted row and settled reply. |
| Repeated copy and keyboard activation | Both existing cases retain distinct clipboard readback and sentinels. |
| Window resize at 1280 and 800 | Existing code-block-copy case retains containment/non-overlap checks. |

## Error handling
No new product failures. Missing public identity fails the message test explicitly.
Wrong send identity/text fails before reply delivery. Existing copy and permission
assertions remain the failure controls; publisher ownership/revision checks remain active.

## Testing strategy
- Test first: select canonical mode while retaining legacy frames; observe mounted failure,
  then replace those frames with authored facts and rerun both existing cases.
- Linux: both owned specs, configured clipboard project/native-writer prerequisite,
  retries zero. Report owned and prerequisite counts separately.
- Pre-verify with affected canonical publisher unit tests, app/client typechecks, focused
  TypeScript project outside the worktree including both specs/imported helpers, and build
  after final merge of main. Prepare Electron ABI only after Node tests finish.
- The normal dispatcher configured gate supplies complete-suite acceptance once; retain
  revision/OS/counts in review evidence rather than running a duplicate full suite here.

## Open Questions
None.

## Builder verification — 2026-10-24
- Linux x64 candidate `364f68544dfcabd686163b8d7338f895e4f26476`, containing
  main `f25c78ccba4d`; normal build provenance records `sourceDirty: false`.
- Full pre-verify passed 5/5 checks after merging main; affected publisher units:
  17 executed/passed, 0 failed/skipped. Final committed branch checks passed 3/3
  with unchanged unit/typecheck portions deliberately omitted on that repeat.
- `npm run build`, `npm run typecheck:client-tests` and focused
  `tsc --noEmit -p /tmp/builder-2224/tsconfig.clipboard.json` passed. The retained
  `/tmp/builder-2224/typecheck-inputs.txt` confirms both specs and imported helpers.
- `npx playwright test e2e/code-block-copy.spec.ts e2e/message-copy.spec.ts
  --project=clipboard --retries=0 --reporter=json
  --output=/tmp/builder-2224/green-results` passed: owned clipboard cases
  2 executed / 2 passed / 0 failed / 0 skipped; native-writer prerequisite
  separately 1 executed / 1 passed / 0 failed / 0 skipped. Every retry index is 0.
  Report: `/tmp/builder-2224/green-report.json`, SHA-256
  `eca63aa431578c99174d0c577ba87de9b4450c14ded79eccc71d997ff62506b5`.
- Retained test-first run: canonical launch with legacy reply frames, prerequisite
  1 passed, owned cases 2 executed/failed with worker exit 7; reports remain at
  `/tmp/builder-2224/red-report.json` and `red-results`. No failed evidence replaced.
- At builder handoff the complete configured application/replay gate was pending
  with the dispatcher. No duplicate full suite ran here; see the accepted result below.
  No fresh provider/encryption proof is claimed; macOS is outside this ticket's scope.

## Verifier acceptance — 2026-10-24

Accepted verifier stage
`858d96ba00a7b4c9a6506b0e82ac0c2fbfc6d149095bcd6cc7c6f67f347e98b1`
records PASS for PR #2266 at `cd350ca7ca914295943e422557773d02d4357310`
on Linux x64. The [counted verification record](../../knowledge/features/development-verification-replay-validation-canonical-message-lifecycle-diagnostics-validation.md#canonical-clipboard-validation)
retains the matching configured gate: 542 executed/passed, 0 failed, 4 skipped,
both named owned cases and the native prerequisite present and passed, retries
zero. The supplied unit-gate counts are 10045 executed/passed, 0 failed, 3 skipped.
The [fixture guidance](../../knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md#canonical-clipboard-fixtures)
records the verifier's documentation handoff for explicit acceptance and barriers.
