# Canonical reader interaction fixtures

## Files read
- `e2e/markdown-reader.spec.ts` → `buildReplyFrames`, `readReply`: reader fetch, typography, attachments and failure controls.
- `e2e/markdown-reader-menu.spec.ts` → `buildReplyFrames`, `readReply`: clipboard, refresh and trusted scroll/resize checks.
- `e2e/fixtures/canonicalThread.ts` → `createCanonicalThread`: authored facts, correlated query windows and separate final certificates.
- `e2e/fixtures/canonicalThread.test.ts` → publisher regressions: strict retired-input rejection and ownership.
- `e2e/fixtures/launchPairedApp.ts` → canonical selection and reconnect publishing; `threadPublisher.ts` → adapter bypass.
- `e2e/user-whitespace.spec.ts` → explicit public device/message acceptance pattern; analogue added 72 and deleted 39 lines.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: complete authored facts and revision contracts.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell-markdown-reader.md`, `e2e-harness-limitations.md`, `development-verification.md`: mounted/native proof and compiler input boundaries.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: preserve captured replay and live-only proof boundaries.
- Parent #2226 refinement: attachment support stays with its mounted consumers; #2270 support is additive coordination, not a blocker. Remote branch inspection found no overlapping edits.

## Context
One deliverable: the existing mounted reader gate runs on daemon-built facts without legacy content translation. No production or visual change, and no new live proof. Scope forecast: about 280 written lines, one exported test helper, two consumers, three observable acceptance criteria and no production error/state-machine changes. This fits all five ceilings; no independent helper-only slice is useful.

## Design
Add a small shared reader fixture consumed by both specs. It creates canonical conversations with explicit session bindings and epochs, records real outbound requests, and exposes canonical launch options plus a mounted readiness check. Readiness observes `thread_catch_up` and binds the public own-device identity before the existing composer send. The explicit test responder authors a delivered user item correlated to that send and completed assistant items with unique bounded orders. The longer scroll setup retains its twelve assistant paragraphs in their original order before the link reply. All content uses `ThreadItem`/`thread_item_added`; no history aliases or legacy frames remain in these specs.

The canonical publisher passes `attachment_chunk` bytes unchanged, just like its existing non-content controls. It does not validate, repair, re-correlate or invent file replies. The existing main-process verification still handles valid, withheld and deliberately digest-failing responses. Existing reader controls and every product assertion remain intact.

## State + concurrency model
Each launch owns fresh canonical facts, counters and request observations. The fixture's existing app/daemon teardown owns async lifetime. No production state or subscription changes. File reply timing and withholding remain controlled by each spec.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Send and explicit own-device/message acceptance | Every owned scenario; readiness observes an empty canonical query before the existing send and positive assistant rendering afterward. |
| Reopen same path, switch away and back | Existing #1627 reader scenario retains refetch and notice clearing checks; canonical query replies retain authored facts. |
| Refresh while held or loaded, digest failure, retry | Existing #1630 menu scenario, unchanged correlated `readReply` and real verification. |
| Repeated resize, scroll, focus and reader return | Existing 1280/800 scroll scenarios retain trusted input, draft and geometry checks. |
| Reused numeric request identity in distinct attachment replies | Publisher unit regression retains bytes and `in_reply_to` across request owners, including a broken digest. |

## Error handling
No new production failure mode. Reject retired content inputs as before. The canonical helper rejects sends to unexpected conversations or before device binding rather than inventing identity. Existing static UI failures, held replies and corrupt digest paths remain unchanged.

## Testing strategy
- First add a failing canonical publisher regression for unchanged attachment bytes/correlation, withheld replies and retained legacy rejection; then add the narrow passthrough.
- Run all five owned Linux scenarios with zero retries, including native clipboard and both window sizes; keep native prerequisite cases required by the normal configuration.
- Run applicable canonical fixture units, pre-verify, `npm run typecheck`, `npm run typecheck:client-tests`, a scratch TypeScript project explicitly including both specs/helper/unit inputs, and `npm run build` after the final main merge.
- Record revision, Linux and executed/passed/failed/skipped counts. Dispatcher/verifier owns the complete configured application gate, including captured replay, activation/history/protected storage and native prerequisites. Do not duplicate it. Existing live assertions remain; macOS is outside scope.

## Open Questions
None. A shared reader fixture is the smallest way to keep the two content setups consistent while leaving file-serving controls local.
