## Files read
- `e2e/real-claude-question-answer.spec.ts` → `expectNamesChoiceFirst`, `continuationOf`: replace prose ordering and transcript fallback while retaining the model flow.
- `e2e/fixtures/clientScenario.ts` → `scenarioInput`, capture fixture: post-surface input and clean-source provenance.
- `e2e/fixtures/phaseReconnectEvidence.ts` → `watchPhaseReconnect`: native turn identities.
- `e2e/fixtures/queueTurnEvidence.ts` → `createQueueTurnEvidence`: native item revisions and normal completion semantics.
- `e2e/real-claude-effort-default.spec.ts` → `observe`: read-only command breakpoint observation.
- `src/shared/wire/thread.ts` → `ThreadUpdate`, `ThreadItem`; `src/shared/ipc/commands.ts` → `AnswerQuestionsCommandPayload`: public evidence contracts.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-live-test-diagnosis.md`, `docs/knowledge/features/modal-store-bridge.md`: strict replay, SQLite preparation, source-stamped capture and optimistic clearing limits.

## Context
Label mention order rejects valid answers and cannot prove delivery. One useful behavior is correlated interpretation of the original batch across a model switch. Its single-consumer controls and generated recording cannot ship independently. No production or visible UI change; no ADR required.

## Design
Request exactly two single-select questions in one tool call: eviction policy and confirmation. Generate a unique confirmation via `scenarioInput` only after the batch appears; select a surfaced policy and enter confirmation through Other. A scenario-local self-contained evidence observer binds host, conversation, native epoch and original AskUserQuestion turn. It records only selected typed command fields, public identities and necessary assistant text, never answer tokens or raw frames. A read-only CDP breakpoint observes the answer command without replacing the bridge.

The evidence contract exposes observe, arm and a boolean completion snapshot. Arm requires the original outstanding batch, remembers existing item text and expected exact indexed values. Success requires the matching submission, subsequent owning daemon answered dismissal, fresh top-level assistant text containing confirmation on the original turn, then a matching normal terminal completion. Full transcript replacement cannot supply freshness. Native snapshots alone cannot introduce fresh text. The existing resolved-model probe and attachment follow this proof.

No overlapping feature branch touched the scenario or its recording at admission. Estimated authored work: about 500–650 lines including controls/plan; one helper export, one consumer, five observable criteria, fewer than ten classified rejection gates. Generated capture (~7,000 lines) exceeds the ceiling under the verification-floor exception expressly documented in the ticket.

## State + concurrency model
The observer subscribes before sending the trigger. Native live updates carry original turn/epoch identity; existing items establish a pre-submission baseline. Observer cleanup and CDP detach occur in finally. No production store or async job is added.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Accepted model change while batch outstanding | shared question scenario checks the same batch before answering |
| Wrong/replaced batch, host or conversation | evidence controls reject foreign submission/dismissal/update |
| Replayed old assistant item or changed prefix | controls reject stale content and snapshot-only witness |
| Repeated item updates or completion | controls retain identity, require witness before matching completion |
| Missing/error/foreign terminal completion | controls reject each; shared scenario waits before probing |

## Error handling
Evidence remains incomplete for missing or mismatched facts; bounded polls fail with static diagnostics. No new production failure mode or logging. Failed live captures remain private diagnostics and cannot become fixtures.

## Testing strategy
Write failing Vitest controls beside the local evidence helper, covering ignored answers, restatement, wrong routes/batches/values/indices, stale and nested/wrong-turn text, completion mismatch/error/missing, and varied correct prose including overlapping labels. Run these controls and client-test typecheck. Commit source before focused supported real capture; use the loaded login through the shared launcher environment and an isolated clean Go VCS-stamped daemon. Review capture provenance, integrate only `claude-question-answer.json`, prepare Electron SQLite and run guarded focused replay with retries zero. Final merge of main, pre-verify and build precede publication. Retain counted Linux reports, identities/checksum/capabilities and zero outstanding/forbidden-launch evidence. macOS is outside scope.

## Open Questions
None. Live capture and replay results will be recorded after execution.

## Revisions
2026-10-19: bind the route from `conversationCreated` before sending the trigger, so either ordering of the native tool and question reading identifies the same turn. Answer commands carry host plus batch, not a conversation field; associate their batch with the original daemon-supplied conversation. The observer retains projected fields only. A red control (27 passed, 1 failed) demonstrated that updating an old terminal item after the witness could falsely pass; terminal identity is now counted on first observation only (28 passed, 0 failed). Logs: `/tmp/builder-2137/controls-red.log`, `/tmp/builder-2137/controls-green.log`.

2026-10-19: the first supported capture established every positive fact but exposed an overbroad observer rejection: a snapshot-only user item later received a live revision update. Unknown-item updates now contribute no evidence and do not invalidate the scoped proof; tracked items still require revision continuity. A focused control reproduces this false rejection. Static gate diagnostics and public identity are attached, and observation stops after original completion before the model probe. The UI policy value is retained exactly, including any label whitespace. Failed reports/capture remain under `/tmp/builder-2137/` and are not eligible fixtures.

2026-10-19: the second capture passed the complete answer proof, then exposed an existing probe sampling race: native live state reasserted Sonnet before the ensuing system/init announced Opus. The probe now waits for the original expected Opus announcement before retaining its unchanged changed-model assertions and attachment. No assertion is removed or production behavior changed.

## Validation evidence
- Linux real capture: `real claude changes model during a question and resumes with the original answer`, 1 executed/passed, 0 failed/skipped, retry 0. Counted report `/tmp/builder-2137/capture-3.json`, stderr `/tmp/builder-2137/capture-3.stderr.log`; report attachments retain resolved target, public route/turn identity, every positive evidence gate and capture provenance.
- Capture source: Desktop `ef097bfc29324437d067d65360558b8e77be8f40`, daemon `664305939d73e5a146457503081d8232fcca5407`, clean Go VCS metadata; isolated binary `/tmp/builder-2137/pyry`, SHA-256 `ba2831b24dd8f880c0a707fb694bab8b99cfe2535d76eaa6129dbf11e4d0b869`, Claude `2.1.280`. Authenticated capabilities: `interactive`, `multi_agent`, `stop_background_task`, `thread`, `thread_expansion`, `thread_compact`.
- Only the target exchange was integrated, byte-identical to `/tmp/builder-2137/capture-3/claude-question-answer.json`: SHA-256 `24bbe5dff65241a77dda96cbd262c9185925d88f6168439a1679b576b984dac1`. Its explicit confirmation input matches question index 1 and is absent from the initial prompt. Generated fixture is 8,487 lines; 5,009 generated additions remain inseparable from this scenario under the stated verification-floor exception. Authored diff remains below 800 lines, with one helper export and one scenario consumer.
- Deterministic controls: 29 executed/passed, 0 failed/skipped in `/tmp/builder-2137/revision-control-green.log`; client-test typecheck passed. Both demonstrated red controls and all failed exploratory live/capture reports remain separate under `/tmp/builder-2137/`; none became fixtures or is claimed passed.
- Exact lifecycle coverage includes `requires an outstanding original batch and does not accept a replacement`, `binds the original turn even when its tool update arrives before the question`, `rejects stale assistant content even when replayed after submission`, `does not reuse a terminal item first seen before the witness`, and `accepts fresh append text once and rejects prefix replacement or epoch reuse`. Route/submission/dismissal/completion parameterized controls cover their corresponding table rows; the shared named scenario covers the accepted pending-question model change.
- Final main merge: `3fbfcfdb5944`; install passed. Pre-verify passed all five checks, including 29/29 affected units, with structured evidence under `build/dispatcher-tests/unit-42zrzp7a` and `/tmp/builder-2137/pre-verify.log`. Normal `npm run build` passed afterward (`/tmp/builder-2137/build-final.log`); the main bundle excludes the recorder. Electron SQLite preparation passed after the Node unit gate (`/tmp/builder-2137/sqlite-electron-final.log`).
- Normal-build targeted live launcher also passed on implementation `6c6a4bdb`: 1 executed/passed, 0 failed/skipped, retries 0 (`/tmp/builder-2137/live-final.json`, `/tmp/builder-2137/live-final.stderr.log`), using the same `66430593` binary and checksum above.

2026-10-19 replay finding: the successful `66430593` capture closes connection 1 at wire index 47, before three trailing client requests still assigned to connection 1. Guarded replay correctly refuses reconnect before those requests match (9 matched, 29 remaining, zero forbidden launches); the failed report is `/tmp/builder-2137/replay.json`. No matcher, closure or capture bytes were relaxed. A separate clean isolated build of `58f46aa5`, the daemon revision supporting the original fixture, is being used for fresh capture; its result must independently pass live and replay before integration.
