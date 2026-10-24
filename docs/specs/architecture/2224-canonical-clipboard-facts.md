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
