# Scoped attachment retrieval (#1926)

## Files read
- `src/shared/ipc/attachmentRetrieval.ts` → request guard and terminal union: bounded IPC identifiers.
- `src/main/attachmentRetrieval.ts` → `createAttachmentRetrieval`: process-wide admission and storage ownership.
- `src/main/index.ts` → `retrieveAttachment`, `attachmentRetrievalListener`: routing and originating sender.
- `src/main/serverRouter.ts` → `resolve`: registry-backed explicit host lookup.
- `src/main/conversationRouter.ts` → `route`: legacy lookup/refusal; expose its resolved host beside the connection.
- `src/main/connectionRegistry.ts` → `connectionFor`: named requests cannot reach the unpaired stand-in.
- `src/main/attachmentStore.ts` → `storeAttachment`: atomic storage and sole path confinement gate.
- `src/preload/index.ts` → retrieval bridge: already forwards request/event objects unchanged.
- `src/renderer/src/screens/conversation/attachmentImageSource.ts` → `request`, `awaitTerminal`: listener/resource lifetime.
- `src/renderer/src/screens/conversation/downloadAttachment.ts` → `retrieveAndSave`: capture activation scope.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`, `BubbleAttachmentRow`: supplied scope callers.
- `e2e/thread-items.spec.ts` → snapshot attachment variants: production regression and renderer-only proof.
- `docs/knowledge/INDEX.md`, root `CLAUDE.md`, `docs/knowledge/features/development-verification.md`: repository/test boundaries.
- `docs/knowledge/features/attachment-retrieval.md`, `docs/knowledge/features/attachment-image-source.md`: preserve static diagnostics, subscribe-before-ask, atomic persistence and independent byte-read contract.

## Context
Explicit thread hosts currently disappear at retrieval routing, and equal attachment IDs share unrelated work.
One ownership repair; no presentation redesign, wire change, cache-directory change or new dependency.
Overlap: `feature/suggestion-quieter-tab-sends` changes the Composer in ConversationScreen; our thread attachment edits are separate and local. No in-flight dependency.
Sizing: about 200 production, 430 test/fixture and 75 plan lines; at most two new exports, eight consumer edits, five observable criteria, no new failure codes. Below all limits on sketch and plan recount.

## Design
Add optional bounded `serverId` to AttachmentRetrievalRequest. Omitted/undefined uses legacy conversation lookup.
Expose `ConversationRouter.resolve` returning the existing ServerTarget shape; retain `route` as its connection-only wrapper.
Inject `resolve(request)` into the orchestrator, returning a resolved host/connection or null. Main selects ServerRouter.resolve for explicit hosts and ConversationRouter.resolve otherwise. Unknown hosts fail not-connected without fallback; disconnected connections retain their existing not-connected transport terminal.
Key live retrievals by a JSON tuple of resolved host, conversation and attachment. Capture the connection at admission; rebuild only conversation_id and attachment_id for its wire call.
Each entry retains originating emitters and each caller's request scope. Duplicate scope asks share one transport/storage operation and fan out the terminal to their requesting windows, never replacing an earlier emitter.
Terminal events carry conversationId and optional requested serverId alongside attachmentId. Optional scope fields preserve compatibility with legacy event fixtures; production always supplies conversationId. Scoped listeners require both scope fields to match; unscoped listeners accept legacy unscoped events and match conversation when supplied.
Add a shared pure terminal matcher. Image-source and download deps can capture optional host once; ThreadItemsView and file activation provide their supplied host. Image URL sharing keys include scope, preventing a host/thread switch from reusing an unrelated live URL. Byte-read and persistence contracts stay unchanged.

## State + concurrency model
One process-lifetime map enforces four live retrievals across every host. A slot remains held through async store.
Entry-local transport-terminal fencing permits only one complete/fail; storage completion settles the captured entry, never another same-ID retrieval. Deletion precedes emission so synchronous retry is admitted.
Renderer release tears down subscriptions and revokes URLs at zero holders. Existing keyed ThreadItemsView unmount cancels listeners on host/thread changes. Main drops replies to destroyed originating senders; existing transport teardown/timeouts terminate its retrievals.

## State transitions and identity reuse
| Event | Proof |
| --- | --- |
| Duplicate same scope, including multiple windows | orchestrator coalesced-origin and resolved-owner tests |
| Same attachment on different hosts/conversations | orchestrator independent scoped outcomes test |
| Disconnect while another owner remains pending | orchestrator independent scoped outcomes test |
| Delayed store, repeated terminal, retry same tuple | orchestrator aggregate-cap and stale-terminal test |
| Host/thread switch with reused attachment ID | image-source scoped listener/cache test and thread-items production variant |
| Legacy request, missing routing entry, invalid host | IPC guard tests and routed orchestrator tests |

## Error handling
Malformed requests are dropped before resolve, transport, store or emit. Renderer checks host bounds before subscribing.
Unknown/unpaired/disconnected owners return existing not-connected; busy and storage failures retain existing typed outcomes. No exception detail, bytes, filename, path, digest or daemon text reaches diagnostics or terminals.

## Testing strategy
Write failing IPC and scoped orchestration tests first, then implement. Existing orchestrator tests retain wire, persistence and diagnostics proof. Use real routers with fake connections for explicit/unlisted/equal-ID and legacy refusal coverage. Renderer fakes prove mismatched terminals do not consume listeners, scoped URL sharing, release and downloads. Enable existing production thread-items variant and require both image rows to decode through real preload/main with two fake hosts; retain renderer-only proof with scoped fake terminals. Run focused units, targeted Playwright, final pre-verify and build after merging main.

## Open Questions
None. Resolved ownership lives in main; requested scope is echoed to match each caller, including legacy callers coalescing with an explicit ask. Disk cache and byte reads retain their existing attachment-ID addressing as requested by this ticket.

## Security review
**Verdict:** PASS
- [Trust boundaries] Main's isAttachmentRetrievalRequest validates all three identifiers before owner resolution. Explicit host lookup uses paired registry membership; it cannot conjure a connection or fall back to another host.
- [Tokens] No credential paths change; keys and safeStorage-backed tokens remain in main and are never echoed.
- [File/storage operations] storeAttachment remains the sole atomic writer under trusted userData; resolveAttachmentPath remains the only canonicity gate. Scope is never a filesystem component. Existing flat attachment cache is deliberately retained by the ticket.
- [Electron attack surface] Fixed existing IPC channels only; no Node/socket/path surface added. Isolation, navigation guards and CSP stay intact. Renderer host bounds prevent subscriptions for dropped asks.
- [Cryptographic primitives] Existing Noise transport and verified reassembly are reused unchanged; no keys, nonces or crypto added.
- [Network/I/O] Existing bounded reassembly, correlated request responses, disconnect cleanup and idle timeout remain responsible for hostile/delayed streams. Wire payload is rebuilt from two fields only.
- [Errors/logs/telemetry] Only client-owned failure codes and caller-supplied scope identifiers cross IPC. Logs retain static event/code fields; no identifiers, content, paths, hashes or byte counts added.
- [Concurrency] MUST FIX addressed in design: coalescing resolves ownership before keying; entry-local terminal fencing and held storage slots prevent late callbacks from settling or releasing a reused slot. Each duplicate retains its own sender and scope.
- [Threat model alignment] Compromised renderer is limited to bounded paired-host retrievals and the aggregate cap. Hostile daemon remains confined by existing parser/reassembler/path gate; malicious relay delays end via existing timeout. Token theft defenses and relay cryptography are unchanged.
**Reviewer:** builder (self-review per builder/security-review.md)
**Date:** 2026-10-10
