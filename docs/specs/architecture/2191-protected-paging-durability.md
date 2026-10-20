# Protected paging durability

## Files read

- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`, `mutationSteps`, `drain`: bounded acknowledged save cursor and task yields.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: serialized membership and storage admission.
- `src/main/indexedThreadHistory.ts` → `mutateThread`, `load`: protected independent save obligation and exact receipts.
- `e2e/fixtures/historyCoverage.ts` → `readHistoryCoverage`: exact ownership, limit-one authenticated coverage, five-second observation.
- `e2e/fixtures/historyQueryEvidence.ts` → `installHistoryQueryEvidence`: actual request checkpoints.
- `e2e/real-daemon-history-on-open.spec.ts` → fresh-profile trusted input walk: numeric coverage and exactly one request per input.
- `src/renderer/src/store/chatHistoryWriter.test.ts`: bounded cursors, failures, owner fencing and paused-clock regression patterns.
- `docs/knowledge/features/chat-history-api.md` → Owned authoritative mutations: unreadable is intentionally fail-closed, not proof of a pending save.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, root `CLAUDE.md`, knowledge index: guarded replay, native ABI ordering and provenance.
- Agents `docs/ticket-scope-policy.md`, `docs/working-practice.md`, `builder/security-review.md`: one repair with its directly consumed causal investigation and regression.

## Context

One historical paired macOS replay stalled after ArrowUp with protected coverage unreadable. Later unchanged replay passes did not establish cause. This ticket preserves the durable boundary and diagnoses the stalled stage before correcting it. No ADR or UI design change is intended.

## Design

Retain the existing writer, fixed IPC and encrypted store contracts. Add content-free test observations at actual query dispatch, received-page delivery/publication and bounded mutation submission/acknowledgement. Filter by exact host/conversation/epoch in memory; export only equality flags, static classifications and counts. Observe committed parts separately from queued work and failures. Preserve original assertions and captures.

Use these observations to identify the mechanism, then add a controlled regression before the correction. The correction remains local to the demonstrated persistence scheduling/admission boundary; it must not retry mutations automatically, flush for acceptance, manufacture coverage, loosen ownership, enlarge bounds or change capture inputs. Record the demonstrated mechanism and precise resulting contract in Revisions before handoff.

Scope: one independently useful durability repair with its regression, forecast 500–650 written lines, at most two production files, no new public types, at most four consumer edits, three observable acceptance criteria, fewer than ten reject branches. No separable infrastructure extraction. Overlap: feature/2153 adds resumed-startup observations in the same scenario, a different block; no dependency.

## State + concurrency model

The renderer owns the debounced serial writer and acknowledged split cursor. Main owns membership admission and atomic encrypted parts. Pending persistence remains unreadable. Existing stop/unsubscribe, host generations and explicit failure policy remain authoritative. Test observers live only for the isolated Electron lifetime and never trigger writes.

## State transitions and identity reuse

| Event | Verification |
| --- | --- |
| Repeated Home/ArrowUp | Original guarded history-on-open scenario: one request and strictly older numeric coverage each time. |
| Split submission, acknowledgement and completion | Controlled regression at the demonstrated stalled boundary plus existing writer bounded cursor tests. |
| Failed part / explicit retry | Existing bounded writer failure and indexed-history receipt tests. |
| Reset, epoch reuse, deletion, unpair, equal chat on another host | Existing writer fencing and indexed-history persistence tests retained. |
| Profile close/relaunch | Both paired scenarios and full recorded suite. |

## Error handling

Keep typed errors and pending-save unreadable. Record static failure codes without payloads, coordinates, persistence UUIDs or caught exceptions. A passing unchanged run is evidence only of that run, never a causal conclusion.

## Testing strategy

- Install dependencies, add the controlled failing regression, observe its intended failure, then correct and rerun it.
- Preserve and run coverage observer tests including split-save and bounded-read regressions; run affected writer/handler/indexed-history tests and pre-verify after final main merge, then build.
- Finish Node checks before Electron SQLite preparation. Run guarded complete-thread paired acceptance five times with fully parallel three workers, repeat-each two, retries zero, followed by full guarded complete-thread replay. Retain actual overlap, counts, complete exchanges, guard results, input provenance and build/report hashes in evidence.
- macOS arm64 only; replay establishes captured-client behavior, no new live provider or physical-effect claim.

## Open Questions

- Which exact stage stalls: queued work, submission, classified rejection, acknowledgement, or completion? Resolve from actual Electron checkpoints before choosing a correction.

## Security review

**Verdict:** PASS

- Trust boundaries: main `parseChatHistoryRequest` and paired membership remain mandatory. Observers compare exact owners internally; no new renderer authority.
- Tokens/secrets: no token or key changes; never include credentials or raw identifiers in evidence.
- File/storage: retain encrypted atomic parts under the existing protected database owner; no new storage paths or plaintext snapshots.
- Electron attack surface: no new bridge API or security-setting changes. Test-only observers must delegate unchanged requests/results and not expose Node primitives to the page.
- Cryptography: preserve existing safeStorage and authenticated owner/receipt bindings; introduce no primitive or nonce changes.
- Network/I/O: transport and guarded capture exchange remain unchanged; no network retry or deadline extension.
- Errors/logs: static statuses, part counts and owner equality only; never payloads, raw coordinates, UUIDs or exception values.
- Concurrency: MUST FIX addressed by design constraint—do not make reads bypass an unfinished obligation; diagnose and repair the demonstrated scheduling/admission cause with a controlled regression. Preserve generations and explicit retry behavior.
- Threat model: hostile daemon data still passes existing parsers, compromised renderer still passes main validation/membership, malicious relay remains Noise-protected, disk theft remains safeStorage-protected. This repair grants no new capability to any of them.

**Reviewer:** builder self-review per `builder/security-review.md`
**Date:** 2026-10-20
