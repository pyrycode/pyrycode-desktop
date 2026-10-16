# Bounded saved conversation opening

## Files read

- `src/main/indexedThreadHistory.ts` → `sequence`, `tree`, `activate`, `mutateThread`, `mutablePage`: authenticated storage, conversion and selection.
- `src/shared/chatHistory.ts` → `threadHistoryCodec`, `parseChatHistoryRequest`: retained facts and fixed bridge admission.
- `src/main/chatHistoryStore.ts` → `run`; `src/main/chatHistoryHandler.ts` → `handle`: serialized import and saved-host authorization.
- `src/renderer/src/store/savedTimelineRestorer.ts` → `readSavedTimeline`; `threadRuntime.ts` → `restore`: local settlement before coordinator resume.
- `src/renderer/src/store/threadItemStore.ts` → `beginLocalRead`, `restoredProgress`: lifecycle, revision and progress merge from #2058.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `nest`, `identity`, `threadItemPresentations`: recorded parent chains, synthetic background markers and attributed ending statistics.
- `src/main/indexedThreadHistory.test.ts` → `setup`, `page`; `e2e/daemon-item-cache.test.ts`: protected fresh-owner fixtures and selected-work counters.
- `docs/knowledge/features/chat-history-api.md` → Owned authoritative mutations, Main-only bounded authoritative pages: partial residency grants no write/progress authority.
- `docs/knowledge/features/chat-history-testing-restoration.md` → Restoration; `chat-history-testing-native.md` → Native runtime and packaged proof: keep arrival/unfinished-progress regressions and prepare each native ABI.
- `docs/knowledge/decisions/0014-authenticated-owned-thread-mutations.md`: authenticated roots, exact completion intervals and one-time transactional conversion.
- Root `CLAUDE.md`, `docs/knowledge/INDEX.md`, `development-verification.md`: repository and counted verification conventions.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Read design context and its screenshot. Preserve the 400px sidebar, expanding conversation pane, current token-based bubbles and footer controls. This change alters local residency only; existing loading/retry presentation remains.

## Context

Full restoration decodes unrelated saved history before first display. Open the newest 200 shown saved identities with required active/dependent facts, retaining the authoritative-only route. Older user traversal belongs to #2042. #2026 overlaps shared admission, application store, native smoke and indexed tests; changes here remain local/additive and do not need its legacy cleanup. No ADR is requested.

## Design

- Add a shared partial page contract and validated bounded opening/page request variants. Preload forwards these existing shared unions unchanged; main's saved-host handler remains the authorization boundary.
- Extend the authenticated held AVL sequence with shown/active subtree counts. A shown identity consumes one base slot; synthetic markers consume none. Select final shown ranks and all active ranks without decoding hidden tails.
- Maintain an authenticated attribution index for recorded `turn_end` dependencies, and follow numeric recorded parent edges through the id index. Include ancestors once, never unrelated descendants. Background marker and ending placement come from the included agent's retained fields.
- Conversion, replacement and owned mutation maintain selection facts transactionally. Old scopes convert once after full validation; ordinary fresh-owner opening never repeats conversion. Selection/index roots authenticate all structural facts and bind selected placements/payloads as before.
- Return selected items in retained held order, sparse aligned first-arrival positions, intact containing ranges plus newest anchor, original availability boundary and an opaque protected continuation. Selected-range residency grants no missing-coverage or completeness inference.
- `readSavedTimeline` requests opening with limit 200. Explicit partial admission validates separately, then reuses #2058's revision/lifecycle/progress merge. Saved arrival positions order saved facts; live-only facts retain admission order. Keep continuation and original availability boundary separate from snapshot authority.
- After local settlement the existing runtime coordinator uses the admitted epoch/checkpoint; pending server replies leave local rows visible. Retry uses the same bounded operation, with no full-read fallback.

## State + concurrency model

Main retains its serialized queue and synchronous transaction. Renderer restoration retains the existing per-read token and admitted generation, cancellation on navigation, reset, delete, unpair and disposal. Hydration publishes a restored snapshot without an owned mutation, completion receipt, read acknowledgement or running-session authority.

## State transitions and identity reuse

| Event | Regression coverage |
| --- | --- |
| Fresh owner/reopen, sparse arrivals and hidden tail | indexed `bounded opening selects shown, active and recorded dependencies`; protected cache restart regressions |
| Mutation/removal/replacement and conversion | indexed `opening indexes follow owned revisions and removal`; existing rollback/replay tests |
| Saved/live overlap, equal revisions, kind mismatch | cache `merges delayed restoration with admitted revisions and original arrival ties`, adapted partial projection cases |
| Cancel/supersede/reset/reused epoch or host/chat strings | existing cache lifecycle table, through bounded restorer |
| Covered and unfinished progress, omitted availability boundary | existing progress restoration tests plus partial boundary regression |
| Connected opening and held reply; pending cleanup | mounted scripted-thread restoration case; existing cache/runtime cleanup cases |

## Error handling

Reuse classified storage/handler errors and content-free diagnostics. Reject malformed limits, extra fields, invalid tokens, mismatched coordinates, tampered/replayed roots/placements and invalid sparse arrival arrays. Missing, saved-empty and failed reads remain distinct. A cancelled late result publishes nothing. No full-read recovery path.

## Testing strategy

- Test first with existing indexed fixtures: shown selection despite hidden tails, active/parent/ending closure, misleading timestamps, transactional maintenance and fresh-owner payload/placement counters as unrelated history grows. Report conversion separately from cold opening.
- Extend cache and mounted scripted-thread fixtures for partial restoration and held server replies while retaining #2058 lifecycle, arrival, progress and cleanup regressions.
- Run Linux pre-verify, full units and build after final main merge, then prepare Electron and run the complete configured fake suite including packaged production-encryption opening/reopen proof. Record revision and executed/passed/failed/skipped counts. macOS is outside this ticket's verification scope; no live-Claude gate is added.

## Open Questions

None. Reuse weighted authenticated selection rather than filtering held pages; reuse existing bridge and lifecycle owner rather than adding another store or harness.

## Security review

**Verdict:** PASS

- Trust boundaries: validate request variants in `parseChatHistoryRequest`, selected payloads in `threadHistoryCodec`, and exact host/conversation in partial admission. Saved-host authorization stays in `createChatHistoryHandler`.
- Tokens/secrets: continuation contents and OS storage protection stay in main; renderer gets opaque bounded strings. No token, content or attribution text enters diagnostics.
- Storage: fixed database owner under existing userData permissions; authenticated roots bind selection, placements and payloads. Conversion and maintenance commit atomically. Unavailable encryption fails closed; no plaintext fallback or renderer web storage.
- Electron: fixed channel and allowlisted variants only, integer limits 1–200, no Node/SQL/filesystem/key exposure; existing isolation/navigation policy is unchanged.
- Cryptography: retain OS `SecretEncryption`, SHA-256 authenticated index bindings and random generation UUIDs. No new cipher, Noise change, nonce or credential comparison.
- Network/I/O: no socket or fetch added; existing coordinator resumes only after local settlement. Held or malicious replies cannot delay first local display.
- Errors/logs: static status classifications and counts only, never saved content, keys, tokens or caught exceptions.
- Concurrency: existing exact read-token and admitted-generation fences survive asynchronous overlap and identifier reuse; serialized storage prevents partial commits. Hydration supplies no owned write or progress receipt.
- Threat model: hostile saved files fail authenticated validation; compromised renderer remains limited to validated authorized operations; keychain unavailability fails closed. Relay/daemon parsing and transport protections remain with existing main transport.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16
