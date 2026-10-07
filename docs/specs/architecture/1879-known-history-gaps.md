# Reader-driven known history gaps

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/chat-history.md`, `conversation-timeline-store-internals.md`, `development-verification.md`: protected ownership, exact envelope coverage, independent display joins and test boundaries.
- `docs/specs/architecture/1815-newest-history-on-open.md`, `1850-served-history-receipts.md`, `1851-history-contributions.md`, `1875-history-subagent-bubble.md`: merged lifecycle, receipt and contribution contracts.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`, `ServedHistory`: bounded allowlisted durable metadata.
- `src/renderer/src/store/conversationTimelineStore.ts` → `prependHistoryFor`, `recordHistoryPage`, `beginLocalTimelineRead`: admission, retained paging end and owned restoration.
- `src/renderer/src/store/historyContributions.ts` → `reconcileHistory`: held keys, content joins and unbound placement.
- `src/renderer/src/store/historyPageBridge.ts` → `requestHistoryPage`, `useHistoryPageBridge`: one owned request and draw-before-settle.
- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`: metadata-only capture and protected host ownership.
- `src/renderer/src/screens/conversation/historyRetry.ts` → `retryHistoryPage`: captured failure identity and host checks.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `useThreadScrollPin`, `ComposerHistoryFailure`: mounted row projection, overlays, input and stable visual anchoring.
- `e2e/history-on-open.spec.ts`, `e2e/real-daemon-history-on-open.spec.ts`: local fake commands and protected-profile relaunch proof.
- `docs/specs/architecture/1388-offline-timelines.md`: analogue was 490 inserted/16 deleted lines, including its 72-line plan.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

Read design context and screenshot: vertical message bubbles and bare informational rows in the message column. The ticket's October 6 ruling authorizes existing banner/status typography and `ComposerHistoryFailure`; reuse those theme tokens for idle/loading/failure gap rows with no count or bubble changes.

## Context

One newest page cannot connect disjoint saved and current history. Mark known missing envelope coverage and recover only one backwards page per fresh reader step. Legacy provenance and cursor-refusal recovery remain with #1880. No ADR required.

Sketch and plan sizing: approximately 350 production, 350 tests/local helpers and 80 plan lines; one shared metadata type and one demand export, seven production files, eight local integration seams, five observable criteria and fewer than ten reject branches. No required signature migration: new metadata/parameters stay optional. Cleaner shape considered: derive boundaries from existing receipts and retain only unresolved boundaries/resume cursors on the slice, rather than adding a parallel paging store.

Remote feature overlap: `suggestion-quieter-tab-sends` changes Composer suggestion input in `ConversationScreen.tsx`; gap edits use Timeline/scroll input and remain local. No numbered in-flight branch overlap or dependency. Codegraph is uninitialized; source searches supplied caller evidence.

## Design

Optional durable `gaps` contains sorted known boundaries `{ olderId, newerId, cursor? }`. IDs are envelope-valid safe integers; a cursor remains an opaque backwards position. Compare held served evidence before draw/settlement with complete page IDs, including undrawable IDs. Consecutive coverage creates no marker. Preserve unresolved boundaries independently of newest overlap and receipt expiration; retire only with complete retained served coverage across the boundary. Never allocate by ID magnitude.

Newest disjoint drawable contributions enter after the last held served display row and before unidentified/live suffix rows; fallback is the held tail. Other pages use existing sorted contribution joins, preserving held row identity, ambiguous timestamps and live state. Capture placement before admission, without changing wire types or scratch-history reconstruction.

Render each marker before the first displayed contribution on its newer side, including a contribution inside an already-joined bubble. Tool projection maps hidden/grouped boundaries to their visible containing row. Marker copy is exactly the ticket's idle/loading/failure text; retryable failures reuse existing Retry treatment and captured failure checks.

Gap input chooses the last visible marker in chronological order between measured header/input overlays, ahead of oldest-end demand. `requestHistoryPage` accepts optional gap targeting while retaining pending/read/host gates and limit 200. Use a retained resume cursor or the nearest receipt position whose oldest ID is on the newer side. A received page updates that walk even if no rows draw or its IDs were covered; gap settlement preserves independent oldest-end coverage.

Writer capture/comparison includes gaps, including cursor-only changes. Shared parsing bounds and allowlists boundaries/cursors, rejects malformed declared metadata and restores old snapshots without inventing IDs. Existing slice ownership/removal/eviction and protected disk lifetimes apply structurally.

## State + concurrency model

Transient requested/failed state optionally targets a gap's older boundary, using purpose `gap`; it is never persisted. Exactly one request per owned slice covers newest, oldest-end, gap and Retry. Pending input is discarded. No observer, arrival, mounting or resize sends demand. All existing subscriptions keep their cleanup; no new async loop or timer. Reader steps park following and preserve a surviving visible row's position across insertion; stable keys retain tool expansion.

## Error handling

Reuse main's typed correlated history failures and generic client copy. Failure keeps rows, durable boundary and cursor; no automatic retry. Retry requires current captured failure, owning host and request eligibility, and bypasses held oldest-end completion only for newest/gap asks. Invalid snapshots fail through the existing static validation sentinel and protected typed result. No cursor, served ID, content or exception detail is logged.

## Testing strategy

- Test-first admission units: first opening, adjacency/overlap, disjoint newest placement, one-entry/multi-page and older holes, skipped/covered pages, joined bubbles and held `atStart`.
- Demand/Retry units: nearest newer receipt fallback, independent completion, pending/read/offline gates, fresh steps and stale failure/host rejection.
- Persistence units: strict malformed metadata, allowlisting, fresh restoration, metadata-only writes and structural replacement/removal/eviction with legacy snapshots.
- Local fake-transport proof: marker order/placement, no automatic cascade, loading/failure/Retry, stable expanded tool and visual anchor, protected restoration. Use existing fixtures without a shared harness migration.
- Extend named real-daemon opening proof: served saved baseline, awaited Electron exit, more than 200 closed-process posts, same protected-profile restart, one newest ask, fresh input recovery in order without duplicates. Dispatcher owns live execution under `needs-real-claude`; all-skipped is insufficient.
- Final main merge, pre-verify check, build and scoped fake Playwright proof; integrated captures at normal/minimum width.

## Open Questions

None. Legacy-boundary and refused-cursor recovery remain explicitly outside this contract.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseChatHistorySnapshot` independently bounds/projects declared gap metadata; main validates envelope IDs before payload filtering. No renderer-provided ID proves served coverage. MUST FIX addressed: completion uses exact covered adjacency, never high-water arithmetic alone.
- [Tokens] No credential access or new secrets; tokens and keys remain main-only under safeStorage.
- [File/storage] Existing host-authorized protected store, atomic writes and fail-closed encryption; no new paths or browser storage. Unknown fields are discarded and invalid declared gaps reject the snapshot.
- [Electron] Existing fixed command/response IPC with isolation and sandbox retained; no new channel, raw envelopes, remote assets or navigation changes.
- [Crypto] Existing main Noise variant and per-session counters unchanged; no new primitive or key use.
- [Network/I/O] Existing bounded decoder, correlation/interruption and relay lifecycle remain; one page of limit 200 per reader step, no cascade or retry loop.
- [Errors/logs] Existing static lifecycle/failure codes only; IDs, cursors, payloads and secrets never enter diagnostics.
- [Concurrency] MUST FIX addressed: capture pre-admission evidence, mark pending before send, discard pending input, preserve independent oldest cursor, and recheck captured host/failure/gap ownership on Retry. Owned reads and existing generation checks reject stale restoration.
- [Threat alignment] Hostile daemon metadata is bounded/parsed, relay delay/drop uses existing interruption settlement, protected storage mitigates disk theft, and renderer compromise gains no new transport/secret capability. Unknown legacy and invalid-cursor repositioning are OUT OF SCOPE in #1880.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07
