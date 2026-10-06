# Received daemon read marks (#1825)

## Files read

- `src/shared/wire/types.ts` → `ConversationSummary`, `ConversationUpdatedPayload`: received contract extensions.
- `src/main/transport/inboundMessage.ts` → `parseConversationSummary`, `parseConversationUpdatedPayload`: closed wire admission.
- `src/shared/chatHistory.ts` → `parseChatHistorySnapshot`: saved-list allowlist and restoration.
- `src/renderer/src/store/conversationListStore.ts` → `createConversationListStore`: host ownership, replacement and local-load cancellation.
- `src/renderer/src/store/conversationListBridge.ts` → `subscribeConversations`: mounted typed update delivery and metadata refresh.
- `src/renderer/src/store/conversationUnread.ts` → `isConversationUnread`: legacy nullable count semantics.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `stampLastReadFor`, `conversationLastReadDeps`: activation and timeline write seam.
- `src/renderer/src/store/appBadgeBridge.ts` → `countAttentionConversations`, `conversationStatusNow`: row-aware badge composition.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ConversationStatusDotControl`, `Row`: per-row dot composition.
- `src/renderer/src/PairedShell.tsx` → `activateDeps`: activation uses the same stamp helper as timeline delivery.
- `docs/knowledge/features/conversation-unread.md`, `conversation-last-read-store.md`, `conversation-list-store.md`: preserve legacy absent/zero distinction, persistence and pairing clears; update patches must retain authoritative metadata refresh.
- `docs/knowledge/features/development-verification.md`: static rendering cannot prove mounted subscriptions; fake transport provides integration proof.
- `e2e/fixtures/launchPairedApp.ts`, `e2e/app-badge-count.spec.ts`: encrypted fake frames and two-host launch seams.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2959

The sidebar groups channel/chat rows below hosts. Existing small status dots retain their theme colours and geometry; only their resolved status changes. Capture the mounted sidebar with synthetic remote-read states and compare against the retrieved reference.

## Context

A phone read currently cannot clear desktop attention. Daemon history entry IDs now provide authoritative received read state, independently of local timeline counts. Publishing desktop marks belongs to #1826. No ADR is needed for this received-contract extension.

## Design

Add optional `read_up_to` and `latest_entry_id` to summaries and optional `read_up_to` to updates. Each present value is a non-negative safe integer, admitted without coercion by closed wire and saved-list parsers. Omission produces no field; zero remains present.

Extend `isConversationUnread(timeline, lastRead, row?)` to compare daemon fields when both exist, otherwise keep its three legacy branches. A shared pure complete-contract predicate supports the stamp guard. Pass the actual row through the sidebar and badge status callback; do not find another host's row by ID.

Add `advanceReadMark(serverId, conversationId, readUpTo)` to the list store. It patches only an existing row in a nonempty stamped host slot, only for an admitted advancing number, preserving other fields. `subscribeConversations` invokes the injected patch before the existing refresh. An optional injected patch preserves older independent bridge callers; production wires it explicitly. List replacement keeps its normal metadata/latest-ID replacement, taking the maximum of incoming and known numeric read marks for matching IDs in that host only. An omitted incoming mark preserves a known mark; an omitted latest ID remains unknown. Removed rows remain removed.

Guard `stampLastReadFor` using an optional injected daemon-backed predicate. Production reads current list rows at invocation time; because local marks are ID-keyed, any complete matching row suppresses stamping when IDs collide. Both activation and timeline callbacks pass through this guard. Legacy persistence and all clears remain untouched.

Overlap: #1660 edits the decoder's error arm and #1775 adds sidebar update chrome; neither rewrites this ticket's blocks or provides a required dependency. Keep edits local.

Size re-count: one deliverable, four observable acceptance groups, forecast 660 written lines including plan/tests, one new exported helper, eight consumer seams, fewer than ten rejection branches. Within all limits.

## State + concurrency model

List updates are synchronous Zustand copy-on-write updaters over `byServer`; the flattened union changes in the same transaction. Read marks never decrease for a held row. No new task, timer or event union is added; the existing app-lifetime bridge owns unsubscribe cleanup. Local-load tokens and pairing clears retain their current ownership.

## Error handling

Invalid present numeric fields fail the entire wire/saved-list decode with static errors. No rounded/coerced values enter state. Invalid origins, unknown rows and nonadvancing updates are no-ops; metadata refresh remains origin-validated. Existing main decode logging classifies failures without payload content; no IDs or daemon text are added to logs.

## Testing strategy

- Unit: zero, omitted and invalid wire/saved fields; correlated and unsolicited decode; detached saved restoration.
- Unit: no-timeline daemon unread, incomplete fallback, stale list/update ordering, unknown rows and invalid origins, host isolation and pairing clears.
- Unit: guarded activation/timeline stamping alongside existing legacy persistence tests; badge precedence/exclusions and row-aware duplicate IDs; static sidebar rendering.
- Fake transport Playwright: mounted list and remote push clear dots before any refresh reply; stale lists stay read, newer latest IDs restore unread, opening cannot locally clear daemon unread, and duplicate IDs on two hosts remain isolated. Observe badge commands on Linux rather than relying on unavailable OS badge support.
- Final pre-verify check and build after merging main; run only the ticket's focused browser spec. No live Claude required.

## Open Questions

None. The ID-keyed legacy stamp guard deliberately fails closed for a duplicate ID with any complete daemon row, while daemon attention always uses each actual row.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] Wire parsers and `parseChatHistorySnapshot` reconstruct allowlisted fields, rejecting null, negative, fractional, nonnumeric and unsafe IDs. Store patch independently checks numeric admission and stamped nonempty origin; payload origin never participates.
- [Tokens] No token lifecycle or storage changes; only nonsecret numeric read state crosses existing typed IPC.
- [File/storage] Saved-list parser preserves the existing encrypted main-owned history store and fixed storage paths. Legacy local count storage remains unchanged; no daemon text becomes a filename or path.
- [Electron] No bridge API or window preference change; existing typed event delivery carries validated fields, transport remains in main.
- [Crypto] No handshake, key or nonce changes; inherits existing Noise_IK_25519_ChaChaPoly_BLAKE2s transport.
- [Network/I/O] No new requests or connection lifecycle; existing frame bounds and decode failure handling apply. A delayed list cannot undo an admitted read advance.
- [Errors/logs] Static decode errors and existing content-free lifecycle logs only; no mark payload, message text, keys or tokens added to logging.
- [Concurrency] Patches and list reconciliation execute inside synchronous store updaters; host arrays retain isolation, unknown rows cannot be fabricated, existing unsubscribe and local-load cancellation remain intact.
- [Threat model] Hostile daemon/saved fields fail closed; reordered delivery retains monotonic marks. Compromised relay cannot forge main-stamped origins or access Noise plaintext. Token theft and compromised renderer protections are inherited without new capability; desktop mark publication is explicitly owned by #1826.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-06
