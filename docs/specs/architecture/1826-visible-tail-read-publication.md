# Visible focused thread read publication

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md` and `docs/knowledge/features/development-verification.md`: process boundaries and mounted interaction proof.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` and `chat-history.md`: measured overlays, reader-only paging, protected display evidence.
- `docs/specs/architecture/1825-received-daemon-read-marks.md`, `1851-history-contributions.md`, `1815-newest-history-on-open.md`, `1779-message-reply.md`, `1879-known-history-gaps.md`, `1880-legacy-history-recovery.md`: merged prerequisites and restoration contracts.
- Daemon `docs/protocol-mobile.md`, Application envelope, Marking a conversation read and Joining a page to the live stream: durable IDs are distinct from connection/replay counters; acknowledgements clamp.
- `src/main/transport/codec.ts`, `inboundMessage.ts`, `src/shared/wire/types.ts`, `src/shared/ipc/events.ts`: envelope admission and optional typed metadata.
- `src/shared/ipc/commands.ts`, `src/main/daemonConnection.ts`, `connectionRegistry.ts`, `conversationRouter.ts`, `index.ts`: validated mute-command precedent and host routing.
- `src/renderer/src/store/timelineBridge.ts`, `conversationTimelineStore.ts`, `historyContributions.ts`, `conversationListStore.ts`: synchronous folds, retained contributions, received read authority and list replacement.
- `src/shared/chatHistory.ts`, `src/main/chatHistoryStore.ts`, `src/renderer/src/store/chatHistoryWriter.ts`: bounded, validated protected contribution snapshots.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`, `src/renderer/src/store/conversationLastReadBridge.ts`, `relayLinkStore.ts`: mounted commit, focus, reader coverage, legacy stamp and lifecycle seams.
- `e2e/received-read-marks.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: actual outbound frames and independent daemon pushes.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171 and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2959 (design context and screenshots read).
Keep the existing message bubbles/actions and sidebar status dots, with their current theme tokens. This changes read observation and received attention state; it introduces no visual controls or styling.

## Context

Desktop must publish what the operator actually saw so the host's shared read mark can clear phone attention. A receipt, row count, bottom-follow flag or newest-page coverage does not establish visibility. No ADR is needed.

## Design

Admit optional `history_entry_id` as a non-negative safe integer in the envelope decoder. Carry optional typed `historyEntryId` through the existing timestamp/event metadata and timeline dispatch without changing existing literals or narrow doubles. Never recover an ID-less replay's identity by fetching history.
An owned validated live ID raises its existing host/conversation row's latest ID even while closed. List replacement retains the maximum held/incoming latest ID, like received read marks. It never creates the received-read contract from missing fields.
Retain a live display contribution only when its timeline fold changes display: associate changed durable rows with their existing client-owned numeric row keys using the existing suppressed contribution shape. Folded deltas and tool patches retain their IDs; orphan/no-op/ambiguous operations do not. State-only changes carry a transient display target and require a subsequent mounted commit; they are not saved as durable rows. Existing page contributions establish their own targets, independently of receipt high-water.
`readTargetFor(slice)` returns only retained row-bound contribution IDs and committed state evidence. Saved live row identity uses the existing bounded, validated `display` contract, writer and restoration; old snapshots remain unknown. Pending commands are never persisted.
Add a small publisher with `observe(host, conversation, target)` and `sync()` contracts. It retains the highest observed target per host/conversation, consumes an attempt before sending and suppresses repeated observations. Received matching read marks alone settle it. Higher observations coalesce; failure, refusal and a clamped mark retain the target without retries. A new connected host edge permits one resend even with no focused screen. Ownership changes cannot redirect it.
Add one host-required `markConversationRead` command carrying `{ conversation_id, up_to }`. Validate exact payload shape, safe integer including zero and nonempty host. Main checks the observation's host against current unambiguous conversation claims, then uses that host's connection; emit only the fresh allowlisted wire payload. Reuse existing `conversation_updated` handling for received acknowledgement; no local read advance on send.
The mounted observation hook captures the rendered slice at layout commit. It measures the newest message's trailing edge against the scroller and measured header/input borders, requires document focus and a closed Markdown reader, and observes on commit, scroll, focus and resize. Geometry callbacks always use the last committed slice. Keep the existing scroll pin and all trusted upward paging intact.
Overlap: #1544 touches different daemon reset/config-correlation blocks; keep daemon edits additive and local.
Size re-count: one observable publication deliverable, five acceptance groups, approximately 790 written lines including tests and this plan; four new exported helpers/hooks, fewer than ten simultaneous consumer updates and ten classified reject/failure cases. Optional metadata/methods preserve existing constructors and doubles.

## State + concurrency model

Timeline contributions share the slice's host replacement, removal, eviction and protected save lifecycle. Pending observations belong to a renderer-lifetime publisher, survive navigation/disconnection, and are discarded on conversation/host/pairing removal. Its list/link subscriptions synchronously settle or invalidate pending records; reconnect generations prevent effect replay from resending. Main send operations retain existing connection teardown. Hook cleanup removes DOM focus/scroll/resize subscriptions; no timers, recovery fetches or retry loops.

## Error handling

Malformed durable IDs fail closed at decode/IPC boundaries. Missing identity or ownership produces no observation/send. Main send failures are classified with static content-free logs; existing daemon refusal handling and received marks remain authoritative. Never log daemon text, durable IDs, conversation identifiers, cursors, tokens or raw frames. Legacy daemons keep the existing local count persistence and clears.

## Testing strategy

- Test first: numeric envelope/command admission, zero and missing metadata; host-bound main routing and actual wire payload/send failure.
- Focused units: row/patch/state commit eligibility, repeated delivery, saved contribution round trips and unknown legacy provenance; latest-ID/read monotonic list replacement.
- Publisher units: coalescing/deduplication, clamped/refused/failed sends, navigation/reconnect, deletion, duplicate hosts, ownership change and pairing removal.
- Fake Playwright: mounted folded tail targets with distinct connection/replay/durable IDs; focus/scroll/reader gates, direct replay and ID-less replay, independently admitted newest history, and unseen newer attention surviving older acknowledgement. Inspect outbound frames; clear attention only on reply/push. Capture the existing integrated thread/sidebar at 1280×800.
- After final main merge: pre-verify check and build, then the focused fake spec. No live-Claude spec changes or execution required.

## Open Questions

None. A separate observer/publisher is simpler than teaching the legacy count bridge viewport authority or putting pending commands into protected history.

## Revisions

2026-10-08: Existing `suppressed` validation permits specific page-source associations, and a row reference alone loses fragment order when history fills a missing live delta (reproduced by the new partial-history test). Retain each live entry's actual typed `row` or `patch` operation with its surviving numeric key, using the existing validated protected schema. Delta operations contain their own fragment, never the accumulated bubble. State-only evidence stays transient. Host-required routing and connection methods remain optional for older callers/doubles. Mounted focus gating injects only the focus oracle because Playwright's original CDP session forces focus; viewport, scroll and reader geometry remain real.

## Security review

**Verdict:** PASS

- [Trust boundaries] Decoder validates optional durable numbers; typed metadata alone crosses IPC. Command guard reconstructs the bounded action. Existing snapshot parser validates retained contribution IDs/references; receipt coverage is never authority.
- [Tokens] No credential lifecycle change; keys/tokens remain main-only under existing safeStorage protection.
- [File/storage] Existing encrypted atomic history service owns fixed paths and pairing membership. No renderer storage, raw envelopes or persistent pending commands.
- [Electron surface] One fixed allowlisted command; host/number/payload validation and host-claim checks prevent redirection. No raw socket API, new navigation or window preference change.
- [Cryptography] Existing Noise_IK_25519_ChaChaPoly_BLAKE2s, keys and counters unchanged; no renderer crypto.
- [Network/I/O] Existing frame limits, TLS, request interruption and reconnect backoff remain; observation attempts are bounded per target/connection edge and never loop on refusal.
- [Errors/logs] Static lifecycle/error codes only, no input payload or secret-bearing exceptions forwarded.
- [Concurrency] Consume attempts before send; bind pending entries to observed hosts; sample only committed display; remove subscriptions on teardown and discard removed ownership. Delayed receipt cannot acknowledge a different host's target.
- [Threat alignment] Relay delay/drop retains unconfirmed observations; hostile numbers/saved metadata reject at existing boundaries. Compromised renderer cannot redirect a command, obtain secrets or raw transport; token-at-rest protections are inherited.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-08
