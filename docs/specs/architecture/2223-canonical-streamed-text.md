# Canonical streamed text and attribution fixtures

## Files read
- `e2e/assistant-parent-text.spec.ts`: owner folding, nested text and tool-run expansion assertions.
- `e2e/assistant-whitespace.spec.ts`: `buildReplyFrames`, stream builders and measured layout scenarios.
- `e2e/progressive-markdown.spec.ts`: pending syntax, explicit settlement and mounted CDP reuse checks.
- `e2e/fixtures/canonicalThread.ts`: `createCanonicalThread` owns authored facts and correlated query replies.
- `e2e/canonical-thread.spec.ts`: complete-thread canonical application launch and revision update pattern.
- `src/shared/wire/thread.ts`: `ThreadItem` and `ThreadUpdate` contracts.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts`: `nest` uses numeric agent parents.
- `docs/knowledge/features/assistant-markdown-renderer.md`: streaming presentation and raw-source settlement.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: mounted proof, replay and native/live boundaries.
- Root `CLAUDE.md` and `docs/knowledge/INDEX.md`: repository conventions and owning topics.

## Context
Replace legacy translated input in the existing streamed-text rendering cohort with authored daemon facts. This is one fixture migration with no production or visual change. Reuse merged #2210; retain compatibility for siblings. Remote feature-branch audit found no overlap with the three owned specs.

## Design
Keep builders local to the three specs. Each launch creates a fresh canonical publisher with the seeded conversation, explicit current session, epoch and version. Select canonical mode and complete-thread capabilities. Let the publisher supply conversation lists and correlated query responses.

Author ordered assistant/tool/agent items directly. Appends reference the same numeric item ID with increasing base/revision and thread version. Explicit completion changes status to finished and active to false; tool arrival does not settle assistant text. Parent edges name numeric agent items. Preserve distinct assistant segments around tool boundaries and after returning to a parent lane.

Whitespace send responders return facts only for the exact seeded conversation. Other requests return no custom frames, leaving query handling to the publisher. Retain trusted Send input and all existing measurements, rendered barriers, exact identities, cursor assertions and CDP counters. The standard reply cohort has completed messages and one active streaming tail.

## State + concurrency model
Only test-local fact identity/revision/version counters are added. Each test owns one publisher; fixture teardown retains ownership of Electron, sockets and listeners. No production store or async job changes.

## State transitions and identity reuse
| Event | Existing mounted coverage |
| --- | --- |
| Repeated append to one item | parent text grows; progressive parser reuse; heading append phases |
| Parent lane resumes after another lane/tool | streamed assistant text folds under its owner |
| Owner/run collapse and reopen | both assistant-parent-text scenarios |
| Explicit completion, including former tool-boundary settlement | progressive presentation and indented pending headers; whitespace settlement phases |
| New message after completion | progressive unfinished-end/tool and punctuation cases; H1–H6 variants |
| Active final tail | markdown owns whitespace on the in-progress tail and settled bubble |

## Error handling
Preserve the wrong-conversation send rejection and existing positive processing barriers. Shared canonical publisher rejects invalid identity, epoch, version and revision sequences. No new production failure modes.

## Testing strategy
- Run the migrated mounted cohort on Linux with retries zero; preserve all 20 owned cases and assertions.
- Use the existing assertions as test-first contracts; observe canonical input failing before completing migration where applicable. No production behavior is being implemented.
- Typecheck all three fake specs and imported helpers through a scratch TypeScript project extending the client-test project, plus app/client typechecks.
- After final main merge, run pre-verify with the affected canonical publisher unit file and build.
- Reuse the dispatcher's matching configured application gate evidence; it includes recorded client replay, canonical activation, captured history and protected native storage. Do not duplicate the complete suite or claim fresh provider/physical-effect proof. Other OS testing is outside scope.

## Open Questions
None. The merged publisher supplies the required complete-thread route without shared helper edits.

## Scope check
Forecast approximately 350 written lines including this plan, zero production files, zero new exported types/components/stores, zero external consumer migrations, three acceptance criteria and zero production rejection branches; below every builder ceiling. Recheck the final diff before publishing.

## Revisions
2026-10-24: The first focused cohort exposed missing authored message timestamps: `bubbleTextExactly` requires the original rendered time suffix. Supply `content.ts` directly, as read by `timestamp` in `threadItemPresentation.ts`, in all three local message builders. Preserve every original assertion and timeout. This is a missing fixture fact within the original migration, with no production expansion. Failed evidence remains in `/tmp/builder-2223/focused.json` and `focused-results/`.

## Builder verification — Linux
Executed candidate `ed07ff8a0f8c076d630ea67f5f9058e0c05d6034`, Linux x86_64, 2026-10-24. Final main merge contains `b7c343ebd809`; normal build provenance records this candidate with `sourceDirty: false`. Subsequent changes record evidence only.

- Controlled missing-completion run: 2 executed, 1 passed native prerequisite, 1 failed original raw-source settlement assertion, 0 skipped/retries. Tool arrival was positively rendered while text remained streaming. Evidence: `/tmp/builder-2223/red.json`, `red.log`, `red-results/`. Restoring the explicit completion passes that assertion.
- First full focused run: 21 executed, 9 passed, 12 failed at the unchanged exact-text timestamp barrier, 0 skipped/retries. Evidence: `/tmp/builder-2223/focused.json`, `focused.log`, `focused-results/`; retained as failures.
- Final command: `PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/builder-2223/final.json npx playwright test e2e/assistant-parent-text.spec.ts e2e/assistant-whitespace.spec.ts e2e/progressive-markdown.spec.ts --retries 0 --output /tmp/builder-2223/final-results --reporter list,json`: **21 executed/passed, 0 failed/skipped/flaky, zero retries**, three workers. Includes all 20 owned cases (2 attribution, 16 whitespace, 2 progressive) and the configured native-writer prerequisite. Started `2026-10-24T17:36:20.771Z`, duration 50.149 seconds; no global errors. All 22 fake-daemon setup attachments were inspected: attempt 1/opened, matching listener/dial, valid upgrade, no failure/rejection.
- Final report SHA-256 `25ea077d07cf767fe25c1809acd2552bea0fb34f3c1f8f10199acb9aed8e0ce4`; list log `/tmp/builder-2223/final.log` SHA-256 `4064bc92030072260768dee9242a340b4d1af56332fdc057a38e5c0b46968cfc`.
- Final pre-verify **5/5 passed**, including publisher units **17 executed/passed, 0 failed/skipped**; `/tmp/builder-2223/pre-verify-2.log`. Focused compiler project `/tmp/builder-2223/tsconfig.json` includes all three changed specs and imported helpers; focused/client typechecks and `npm run build` pass (`focused-typecheck-2.log`, `client-typecheck-2.log`, `build-2.log`). Node checks completed before restoring Electron SQLite ABI (`electron-native-2.log`).
- TypeScript AST audit against plan commit `aaf3eae9` retains all **193 original assertion expressions** unchanged; six positive tool/streaming barriers added. `/tmp/builder-2223/assertion-audit.log`.
- Dispatcher/verifier owns the normal complete configured application gate, including captured-client replay, canonical activation, history and protected storage. **Pending that matching gate evidence**; do not duplicate its complete run. No replay bytes, native prerequisites or live-only assertions changed; no fresh provider/encryption/physical-effect claim. Other OS testing is outside this ticket's scope.

Final scope remains below all ceilings: approximately 260 added lines across the three owned specs and plan, zero production files/new exports/external consumer migrations, three acceptance criteria, zero new production rejection branches.
