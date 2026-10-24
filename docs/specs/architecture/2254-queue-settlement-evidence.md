# Canonical queue settlement and completion evidence

## Files read
- `e2e/queued-own-settlement.spec.ts` → five settlement orders and treatment assertions to retain.
- `e2e/queue-delivery-evidence.spec.ts` → installed observer and ordered marker completion.
- `e2e/fixtures/canonicalThread.ts` → explicit authoring, exact-base updates and correlated final certificates.
- `e2e/fixtures/threadPublisher.ts` → canonical selection and native exception for duplicate wire probes.
- `e2e/live-user-receipts.spec.ts` → native composition of valid publisher facts and rejected duplicate controls.
- `e2e/fixtures/queueTurnEvidence.ts` → canonical observer completion and suffix handling.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → queue identity and tool content contracts.
- `docs/knowledge/features/e2e-harness.md` and `development-verification-evidence-that-cannot-pass-too-early.md` → positive barriers before absence checks.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, root `CLAUDE.md`, knowledge index and package/config files → proof boundaries and Linux validation.

## Context
Migrate the seven mounted queue cases to supplied daemon facts while preserving their failure controls. This is one queue-lifecycle evidence slice, with no production or visual change. No ADR is needed. No in-flight feature branch overlaps the two owned specs. Estimate: about 400 written lines including tests/helper/plan, zero production files, one exported helper, two consumers, four acceptance behaviours, no new error state machine; below all ceilings. The analogue's scope is its two test migrations, excluding subsequent documentation.

## Design
Use a local shared scenario fixture holding explicit summary/session, epoch, version and authored items. Its add/change/append operations accept canonical item fields and revisions, never legacy events; they preserve supplied identity and unique safe order. Correlated opening/page replies come from `createCanonicalThread` with separate final certificates. Capture actual requests and sends. Read the authenticated public device identity from preload before publishing own acceptance.

Five settlement cases use native launch with explicit publisher composition so equal/older full-item conflict probes reach the application unchanged. Valid facts still pass publisher validation; resynchronize its authoritative snapshot after direct probes. Treatment and observer use canonical launcher selection. Queue removal is an explicit same-item transition out of queued status; receipt is a distinct delivered revision, never an inferred effect of a send or assistant. Orders are authored at delivery. Preserve original own text, foreign collision, connected row handle, exact counts, transcript ordering, expanded agent/tool result and streaming continuity.

## State + concurrency model
Only per-test authored fixture state and the existing installed evidence observer are held. Launcher teardown owns app/transport cleanup. Observer subscription is stopped in `finally`. No production store changes. All updates travel through the actual encrypted fake transport and mounted app.

## State transitions and identity reuse
| Event | Mounted coverage |
| --- | --- |
| Command and assistant activity before explicit acceptance | All queue cases retain local-only user row before queued fact |
| Queue removal before/after receipt, same item/device/message | `queued own rows settle in stream order: removal-first`, `receipt-first` |
| Forced and mixed delivery orders | Same test family: `sent-now`, `mixed-removal-first`, `mixed-receipt-first` |
| Foreign device with same message ID and duplicate conflicting receipt | All five settlement cases |
| Duplicate/late own receipt while assistant streams | All five settlement cases, continuing same assistant item |
| Queued to delivered treatment | `queued and delivered treatments retain the message-area design` |
| Queue disappearance without terminal completion; split second marker and ordered completions | `queue evidence follows a single user row through delivery in the built app` |

## Error handling
Preserve deliberate duplicate/equal/older-revision wire controls in native mode. No new runtime error path, timeout, retry, dependency or provider proof.

## Testing strategy
First add the canonical opening-request assertion to the existing suite and observe it fail on the legacy callback alias. Then migrate facts, retaining all mounted oracles and adding acceptance/completion barriers. Run seven owned cases with retries zero (plus configured native prerequisite), applicable publisher/queue evidence unit checks, pre-verify, typecheck, client-test typecheck, a scratch focused TS config including both specs and helper, and build after final main merge. Record exact revision, Linux counts and every case. Complete configured application/captured replay gate belongs to dispatcher/verifier; do not duplicate it. macOS is outside scope.

## Open Questions
None. Native composition is required only for deliberately invalid authoring controls.

## Documentation handoff
- Pending documentation stage: preserve canonical activation, captured history, protected-storage coverage and proof boundaries in `docs/recorded-tests.md` and `docs/client-replay-migration.md`. This migration introduces no fresh provider, encryption or physical-effect proof.

## Revisions
- 2026-10-24: Opening callback requests already include `thread_catch_up` under compatibility mode, so the request-only negative-control hypothesis was incorrect (2/2 including prerequisite passed). Keep actual request assertions as protocol observations; the distinguishing negative control instead challenges inferred acceptance after assistant activity. The first test-first launch was blocked by incomplete Electron installation, and the first seven-case run was held by Node/Electron SQLite ABI mismatch. Reinstalling dependencies and running the existing Electron rebuild resolved these environment failures without changing source or assertions.
- Queue disappearance is authored as `written` before a later delivered revision for removal-first cases; receipt-first cases follow delivery with an older-revision full fact. Repeated identical facts and equal/older conflicting facts use native mode, with the publisher snapshot reset to known authoritative facts after each probe. No legacy event translation is introduced.
