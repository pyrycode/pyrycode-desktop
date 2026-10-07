# Legacy boundaries and refused history cursors

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: process, test and ownership rules.
- `docs/knowledge/features/chat-history.md` → Snapshot contract, Received-state admission and ownership: protected evidence cannot establish a renderer-created owner.
- `docs/knowledge/features/conversation-timeline-store-internals.md` → The opening ask, The history/live join: one-page demand and conservative contribution joins.
- `docs/knowledge/features/development-verification.md`, `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md`: mounted persistence barriers and protected storage.
- `docs/specs/architecture/1879-known-history-gaps.md`: independent oldest coverage and reader gates.
- `src/shared/chatHistory.ts` → HistoryGap, parseChatHistorySnapshot: bounded optional metadata.
- `src/renderer/src/store/conversationTimelineStore.ts` → prependHistoryFor, recordHistoryPage, recordHistoryFailure: pre-draw admission and owned settlement.
- `src/renderer/src/store/historyContributions.ts` → reconcileHistory: surviving row keys, conservative joins and chronological insertion.
- `src/renderer/src/store/historyPageBridge.ts` → requestGapHistory, useHistoryPageBridge: demand and draw-before-settle.
- `src/renderer/src/store/chatHistoryWriter.ts` → createChatHistoryWriter: restored ownership and metadata capture.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → Timeline, useThreadScrollPin: grouped placement and measured visible markers.
- `src/renderer/src/screens/conversation/historyRetry.ts` → retryHistoryPage: captured failure ownership.
- `e2e/history-gaps.spec.ts`, `e2e/chat-history-recording.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: synthetic recovery and full protected-profile relaunch.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

Read design context and screenshot. Preserve vertical bubbles and grouped tools; reuse existing bare theme-token status/failure treatment authorized by the ticket's October 6 ruling. No new assets or styling.

## Context

Saved display rows without envelope provenance cannot establish a numeric hole. A refused opaque position needs a fresh origin without a retry loop. Extend the existing recovery path; no ADR, wire changes or new dependencies.

Sizing: one recovery deliverable, approximately 260 production + 390 test/helper + 75 plan lines, one new exported helper, eight local consumer seams, five observable criteria and at most nine reject branches. #1388's protected restoration analogue inserted 490/deleted 16 lines. Cleaner shape considered: keep boundary and refusal evidence on the existing gap, rather than introducing another pager/store. Source searches replace the uninitialized codegraph. No numbered remote feature branch overlaps the seven production files; nonnumbered suggestion work affects Composer only.

## Design

Extend optional gap metadata with a legacy variant identified by surviving client row keys, never fabricated served IDs. Numeric gaps keep their existing shape. A helper supplies client gap identity for rendering/demand/Retry. Capture unrepresented restored row keys before newest draw, and keep a boundary before the nearest newer contribution. New unknown contributions enter after held legacy rows, including backwards pages already covered by receipts. Resolve through an unambiguous existing message/contribution join to those held keys or `atStart` from a selected backwards request; held completion and newest acquisition completion prove nothing.

Retain bounded per-gap refused cursor strings and a separate latest newest-origin cursor. `history-invalid-cursor` removes only the selected resume cursor and remembers it. Fresh input bypasses only that nonretryable refusal: choose a usable latest newest cursor or request one newest page owned by that gap. Acquisition uses a distinct request purpose, updates origin/resume only when not refused, and waits for another input. Ordinary failure and Retry retain their current ownership gate.

Strict shared parsing allowlists new metadata, validates row references and bounded refusal arrays, rejects malformed declared metadata, and accepts old snapshots. The protected writer compares evidence alongside rows. Evidence-only changes without a receipt may save only with an already established/restored matching owner, never create one. Existing replacement/removal/eviction lifetimes apply structurally.

## State + concurrency model

Optional durable evidence lives on ConversationSlice and its snapshot. Requested/failed state stays transient, with gap-owned newest acquisition distinguished from backwards walking. One outstanding request, limit 200, existing host/read/offline gates and discarded pending input. No new subscription, timer or background walk. Existing scroll anchoring and stable row keys preserve expansion; markers use existing grouped-row projection. Input still selects newer visible markers first between measured overlays.

## Error handling

Reuse typed main history errors and static failure copy. Refusal has no Retry and remains visible until new demand. Ordinary retryable errors retain Retry. A refused newest response remains unusable; another acquisition needs fresh input. Invalid snapshot metadata fails through the existing static validation sentinel; no contents, cursors or IDs enter logs.

## Testing strategy

- Test-first units: legacy restoration and retained completion; unidentified/ambiguous content versus identity overlap; backwards `atStart`; chronological row/key preservation.
- Demand/refusal units: isolated invalidation, latest usable newest fallback, absent/refused acquisition, repeated refusal, pending/offline gates and owned Retry.
- Snapshot/writer units: allowlisting, malformed metadata, old snapshots, evidence-only refusal save with received/restored ownership, no renderer-created ownership, fresh restoration and transient reset.
- Extend synthetic gap coverage: mounted legacy marker, fresh keyboard/wheel steps, no cascade, refused acquisition, held rows/anchor/expanded tools, full Electron close/relaunch over the same protected profile. Existing known-gap proof remains a regression test.
- Final main merge, pre-verify, build and focused fake Playwright. Capture idle/failure at 800 and 1280 widths for visual comparison. No new live-Claude proof required.

## Open Questions

None.

## Security review

**Verdict:** PASS

- [Trust boundaries] MUST FIX addressed: shared snapshot parsing validates declared legacy row references, safe IDs and bounded strings/arrays; renderer metadata cannot invent served provenance or establish received ownership.
- [Tokens] Existing main-only credentials and safeStorage; no new credential access or browser storage.
- [File/storage] Existing host-authorized protected atomic storage, fail-closed encryption; no new paths. Evidence-only writes require an established matching owner, including explicit owned restoration.
- [Electron] Fixed validated history command/response IPC, isolated sandboxed window and existing navigation guards unchanged; no raw envelopes or transport in renderer.
- [Crypto] Existing Noise_IK_25519_ChaChaPoly_BLAKE2s and counters untouched; no new primitives or keys.
- [Network/I/O] Existing bounded decoder/correlation and interruption settlement; limit 200 and no automatic acquisition/retry/cascade.
- [Errors/logs] Generic existing UI failure and content-free lifecycle diagnostics; never log messages, IDs, cursors, tokens or decrypted bytes.
- [Concurrency] MUST FIX addressed: capture before draw, distinguish acquisition from backwards completion, mark pending before send, preserve other gaps/oldest end, discard pending input and validate captured Retry ownership. Existing read generations and subscription teardown remain.
- [Threat alignment] Hostile daemon/disk metadata stays bounded/validated; relay delay/drop uses existing settlement; disk theft mitigated by safeStorage; renderer gains no secrets or socket capability.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07

## Revisions

2026-10-07: Legacy identity overlap is reported explicitly by `reconcileHistory`; duplicate message IDs or timestamp joins cannot close the boundary. A unique held/page `(turnId, toolUseId)` call join retains the held call and supplies overlap evidence without requiring a saved timestamp. The legacy insertion seam receives the owning row keys and advances marker placement with the fresh walk's oldest served ID. Display-only restoration creates this boundary only before its first represented page, so later newest openings cannot recreate already-resolved legacy evidence. Acquisition is represented by purpose `gap-newest`, and its `atStart` never closes the legacy boundary.

2026-10-07: Refusal mutation checks the supplying host before changing evidence. Invalidated cursors are omitted entirely; explicitly declared undefined cursors remain invalid under the shipped strict contract. Legacy row references must follow retained chronological row order. Final scope is about 600 inserted lines including plan, seven production files, one new exported helper and the existing eight integration seams; no sizing boundary exceeded.

2026-10-07 (verifier rework): Unique legacy tool identity overlap retains a row contribution bound to the held key, including its validated call identity and optional source join key. This uses the existing strict row contract, including unkeyable timestamps, without broadening snapshot validation or rebuilding held tools. Unmatched legacy comparisons fall through to normal live admission/suppression, so a live tool/result suffix keeps its original key, completed object and patch target. Regression proof covers parser round trips, protected writer/storage and fresh timeline restoration, pending/completed live suffixes, and the complete recording spec with the additive newest-origin cursor expectation. Scope remains below 800 written lines; no new exported declarations or production consumers.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/chat-history.md` → Snapshot contract; Received-state admission and ownership: legacy row-key boundaries, refused positions, newest-origin evidence, evidence-only protected saving and transient reset.
- Pending documentation stage: `docs/knowledge/features/conversation-timeline-store-internals.md` → The opening ask; The history/live join: conservative legacy overlap, fresh backwards `atStart`, gap-owned newest acquisition and fresh-input refusal recovery with independent oldest coverage.
- Pending documentation stage: `docs/knowledge/features/development-verification-history.md` → Known-gap recovery verification; Contribution joins and held-row regressions: synthetic recovery and protected-profile close/relaunch evidence.
