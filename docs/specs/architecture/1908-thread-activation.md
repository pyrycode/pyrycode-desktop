# Activate daemon-built conversation threads

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process boundaries, counted proof and committed read evidence.
- `docs/knowledge/features/thread-item-store.md`, `chat-history.md`, `conversation-shell.md`: authoritative snapshots, protected persistence and existing presentation.
- `src/main/daemonConnection.ts` → `loadDialConfig`, `requestHistory`: handshake advertisement and legacy recovery boundary.
- `src/main/deviceKeypair.ts` → `createDeviceKeypairStore`: main-owned stable Noise identity.
- Daemon `internal/relay/handlers/send_message.go` → `connSender`, `internal/relay/v2session_handshake.go`: authenticated device identity is the lowercase hexadecimal static public key.
- `src/preload/index.ts`, `src/main/index.ts`: typed IPC and process composition.
- `src/renderer/src/App.tsx`, `PairedShell.tsx`: app-lifetime subscriptions, saved restore and newest-history demand.
- `src/renderer/src/store/threadItemStore.ts`, `threadQueryCoordinator.ts`: generation ownership, complete checkpoints and query certification.
- `src/renderer/src/store/threadSendStore.ts`, `screens/conversation/composerSend.ts`: device/message settlement and pending submissions.
- `src/renderer/src/store/threadLiveState.ts`, `screens/conversation/threadLiveInputs.ts`: summary-owned session binding and prompt invalidation.
- `src/renderer/src/store/conversationReadPublisher.ts`, `conversationReadRouteStore.ts`: committed visibility and separate newest/catch-up completion.
- `src/renderer/src/store/chatHistoryWriter.ts`, `savedTimelineRestorer.ts`: protected authoritative cache adapters.
- `src/renderer/src/store/timelineBridge.ts`, `historyPageBridge.ts`: legacy content/recovery writers.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen`, `ThreadItemsTimeline`, `Composer`: reuse chrome, item view, queue and task controls.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Design context and screenshot reviewed. Retain the fixed sidebar beside the conversation, existing bubble/tool/agent rows, top chrome and composer footer, with existing theme tokens. No asset, style or layout redesign.

## Context

All Desktop and daemon prerequisites named by the current issue are merged. The adapters are inactive in ordinary app composition. Activate them while preserving host-local legacy compatibility for one release. No new ADR is needed. Remote branch overlap: #1544 modifies independent configuration-request invalidation in `daemonConnection.ts`; keep this change local to negotiation and recovery.

Sizing follows the issue's explicit floor exception: approximately 1500 written lines (450 production, 950 tests/fixtures, 100 plan/log), roughly 14 production files, five observable acceptance criteria. The 700-line ceiling overage is retained because separating the composition from its regression proof would create a preparatory slice with only this consumer. Reuse existing exported adapter types and signatures; introduce only the composition surface and narrow identity result.

## Design

- Advertise `thread` with existing capabilities. Select each host's route solely from its accepted connection capabilities, replacing the selection on every handshake. Retained offline provenance may choose saved display only, never network capability.
- Add an app-lifetime composition layer owning authoritative item/send stores and query coordination. Selection, restore, connection state and daemon replies feed the existing adapters; teardown retires queries, restores and subscriptions. Capability downgrade retires authoritative network work before legacy demand resumes.
- Restore authoritative snapshots through `readThread` and supply the existing writer's optional thread source. Preserve legacy `readTimeline`/timeline saves separately. Resume from saved epoch/checkpoint, never applied or unfinished versions.
- Expose a no-argument typed device-identity IPC operation returning only the hexadecimal public identifier or a static failure. Derive it in main from the same keypair used by the connection. Capture it for each thread submission; retain the existing legacy send path.
- Render `ThreadItemsTimeline` on the authoritative route with existing send, queued-action and task inputs. Preserve the ordinary composer, connection/account chrome, reader and existing loading/retry controls. Legacy content, history, queue and roster projections cannot write authoritative rows or launch content recovery.
- Bind `createThreadLiveState` from current owning summaries, consume `threadLiveInputs` for current-session UI and route prompt answers to their retained host. Session transitions and saved items cannot establish binding.
- Extend coordinator completion reporting with successful newest/catch-up certification distinct from older-page idle. Read publication receives that watermark with the committed immutable snapshot; sending remains distinct from daemon acknowledgement.

## State + concurrency model

Host routing is explicit and independent. Every restore captures route/selection ownership; cancellation and store generations invalidate late callbacks. Query request IDs remain unique and their existing per-host slot serializes replies. Reconnect cancels old work, retains saved items and resumes complete progress. Host removal/deletion releases item/send/live/read state. App cleanup removes all listeners and cancels query/restore work. No new background transport, keys or raw bytes enter the renderer.

## State transitions and identity reuse

| Event | Regression coverage to write |
| --- | --- |
| Mixed hosts, upgrade/downgrade, repeated reconnect | production thread integration spec: route and owning requests |
| Offline restore, reopen, restore/live overlap | production thread integration spec: saved rows and checkpoint |
| Interrupted batch, epoch replacement and repeated session reset | production thread integration spec: retained complete progress and prompt invalidation |
| Queued acknowledgement and terminal delivery | production thread integration spec: device/message settlement and genuine queue handle |
| Deletion, unpair, reused IDs on another host | production thread integration spec: stale work and host isolation |
| Visible committed content, older page and received read acknowledgement | production thread integration spec: separate attempt/wire/receipt facts |
| Identity IPC failure and repeated submissions | identity unit test and composer integration coverage |

## Error handling

Reuse existing typed query/cache failures and static retry copy. Identity IPC returns a typed static error without key material or caught details. Missing capability selects legacy compatibility and never counts as thread proof. Failed/abandoned queries retain complete checkpoint fences. Log only static lifecycle/reason codes, never daemon content, device identifiers, keys, tokens or saved bodies.

## Testing strategy

Write failing identity/composition tests before implementation and observe their intended failure. Extend existing fake-transport Electron fixtures for ordinary-app mixed-route, restore/query/send/session/read transitions; use positive receipt and React-commit barriers before absence assertions. Run changed focused specs, final main merge, pre-verify and build. Extend existing real-daemon/live-Claude evidence to observe negotiated thread facts alongside its legacy oracle and assert capabilities on the actual app connection. Per the current issue, credentialed counted execution and binary/Desktop revision artifacts are pending the dispatcher's live gate; no builder live pass is claimed. Capture existing integrated chrome at 1280 and 800 widths.

## Open Questions

Resolved: identity is lowercase hexadecimal public key, matching daemon `connSender`, rather than a name, token or selected host. Use the existing coordinator and protected cache adapters instead of adding another sync or storage implementation.

## Security review

**Verdict:** PASS

- Trust boundaries: main derives device identity without renderer arguments; existing main thread decoding and shared saved-record validation remain the only admission boundaries. Saved provenance cannot negotiate capability.
- Tokens/secrets: only the public hexadecimal identifier crosses IPC. Existing safeStorage key/token protection stays fail-closed; no renderer web storage or credentials are added.
- File/storage: reuse protected atomic cache operations and validated coordinates; no untrusted path construction or plaintext fallback is introduced.
- Electron: narrow no-argument identity IPC exposes a typed result, no raw IPC/filesystem/key API. Existing context isolation, sandbox, navigation and remote-content policies remain intact.
- Cryptography: derive the identifier using Node byte encoding only; retain the existing Noise implementation/variant and nonce/key lifetimes.
- Network/I/O: reuse bounded main thread receiver and coordinator deadlines. Negotiated capability is host-local; reconnect cannot reuse a prior network route silently.
- Errors/logs/telemetry: static error codes only; no content, identifiers, key material, caught exceptions or telemetry are added.
- Concurrency: route-generation and restore cancellation guards fence downgrade, deletion, unpair and reused IDs; complete checkpoints exclude interrupted progress. Prompt response validates the exact retained current-session reading and owning connected host.
- Threat alignment: hostile relay delay/reordering cannot certify unfinished progress; hostile daemon/saved text remains validated, bounded and escaped; compromised renderer receives no secret or transport primitive. Existing safeStorage protects disk credentials and fails closed when unavailable.

**Reviewer:** builder (self-review per `builder/security-review.md`). **Date:** 2026-10-15.
