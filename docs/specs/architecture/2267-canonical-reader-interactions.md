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

## Revisions
- 2026-10-24: Focused compilation exposed missing required `AttachmentChunkPayload.conversation_id` in both existing file responders. Echo the requesting conversation explicitly; chunk bytes, digest and request identity remain unchanged. Tag the rate-limit reading and repeated summaries with the authored current session binding.
- 2026-10-24: Mounted execution exposed the launcher's single-listed-row pairing contract. Keep both canonical query scopes, but initially announce only the original row; the existing reader drive announces the second later. The new attachment regression covers repeated distinct request IDs; existing publisher ownership coverage tests overlapping query identities.

## Validation evidence
- Linux x64, 2026-10-24, clean source/build revision `d4f714509747e385af304d4881a6585b91c879d4`, normal build profile, Electron 33.4.11.
- `npx playwright test e2e/markdown-reader.spec.ts e2e/markdown-reader-menu.spec.ts --retries=0 --reporter=list,json`: **6 executed, 6 passed, 0 failed, 0 skipped, 0 flaky**, every result retry 0. Five owned cases executed/passed: heading scale/clearance, refetch/back/failure/attachment survival, menu/native clipboard/refresh, and trusted scroll/resize/focus/draft checks at 1280 and 800. The sixth is the unchanged configured protected-writer native prerequisite, using `gnome_libsecret`.
- Reports: `/tmp/builder-2267/playwright-serial.json`, `playwright-serial.log`, `playwright-serial-results/`. Every fake-daemon setup opened on its first attempt; all launch-fate attachments report clean exits and no teardown failures. No top-level report errors.
- Pre-verify **5 checks passed**, including **18 executed/passed fixture units, 0 failed/skipped**. Evidence: `/tmp/builder-2267/pre-verify.log` and `build/dispatcher-tests/unit-lzpxn8_l/`. Application typecheck, client-test typecheck, explicit focused compiler inputs (both owned specs, helper, publisher unit and their imports), and the post-pre-verify build passed. Scratch compiler configuration and logs are under `/tmp/builder-2267/`.
- AST comparison against `origin/main` retained all original expect expressions in order: reader 84/84, menu 89/89. No original product assertion or timeout changed.
- Failed evidence retained: the intentional red attachment unit (17 passed/1 failed before passthrough); `playwright.log` (native prerequisite failed, five owned cases unexecuted); `playwright-final.json` (native prerequisite passed, all five owned cases failed the two-row pairing setup); `playwright-accepted.json` (native prerequisite failed while Node preparation overlapped, five owned cases unexecuted). Native preparation and Electron execution were then serialized before the successful final run. These earlier runs remain failures.
- The complete configured application gate remains dispatcher/verifier-owned, including captured replay, canonical activation/history, protected storage and native prerequisites. No duplicate complete gate or fresh provider/encryption/physical-effect proof was run. Existing live-only assertions remain required through their owners; macOS is outside this ticket's verification scope.
