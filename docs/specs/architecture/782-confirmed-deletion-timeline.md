# Confirmed deletion removes the owning retained timeline

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process boundaries and mounted-effect proof.
- `docs/knowledge/features/paired-shell.md`, `paired-shell-conversation-exits.md`, `conversation-timeline-holder.md`: active exit is deliberately gated; retained map order and references must survive local deletion.
- `src/renderer/src/exitActiveConversation.ts` → `exitActiveConversation`: preserve the mismatch gate and clear-before-navigation ordering.
- `src/renderer/src/store/conversationDeletedBridge.ts` → `subscribeConversationDeleted`, `useConversationDeletedExit`: retain main-stamped origin through the existing subscription.
- `src/renderer/src/PairedShell.tsx` → `exitConversationDeps`, `PairedShell`: mount the new decision using the existing clear/navigation wiring.
- `src/shared/ipc/events.ts` → `StampedDaemonEvent`: origin is stamped from the paired connection, rather than supplied by the daemon payload.
- `src/renderer/src/store/conversationTimelineStore.ts` → `clearTimelineFor`, `beginLocalTimelineRead`: exact Map keys, idempotent removal and stale-read ownership checks.
- `src/renderer/src/store/timelinePublication.ts`, `timelineBridge.ts` → `flushTimeline`, `subscribeTimeline`: mutation boundaries flush pending frame folds before clearing.
- `src/renderer/src/store/conversationArchivedBridge.ts` → `subscribeArchivedActiveConversation`: archive remains an active-only exit, not permanent deletion.
- `src/renderer/src/exitActiveConversation.test.ts`, `store/timelineFrames.test.ts`, `store/savedTimelineRestorer.test.ts`: injected real stores and lifecycle scheduling patterns.
- `e2e/conversation-archive-lifecycle.spec.ts`, `conversation-switch-keeps-both-threads.spec.ts`, `timeline-frame-deltas.spec.ts`, `fixtures/conversationStateFake.ts`: mounted fake transport and held correlated replies.

## Design source

Internal retained-state cleanup. No layout, copy, styling or new navigation behavior is introduced.

## Context

A delayed deletion of A after opening B leaves A's keyed slice because the active exit correctly refuses A. Confirmed deletion needs an independent retained-view cleanup with explicit host ownership. No ADR is needed.

## Design

Add a React-free `confirmConversationDeleted(deps, conversationId, serverId): void` beside the existing exit decision. Its injected interface extends `ExitActiveConversationDeps` with `getTimelineServerId(id): string | undefined` and a content-free diagnostic sender. The getter flushes pending timeline folds before reading slice ownership. A string origin must exactly equal the retained slice's explicit `serverId`; absent/null origin, absent slices and unknown/different owners do nothing. This rule also prevents exiting a same-ID open thread whose displayed slice belongs to another host.

For an owned active id, call `exitActiveConversation` unchanged, preserving its clears and navigation order. For an owned inactive id (including no active conversation), call only `clearTimelineFor(id)`. Never derive authority from the active chat, list membership, archive flags, a click or a pending request. No wire changes, persistence deletion path, store mutation API or new state.

`subscribeConversationDeleted` forwards `(id, serverId)` while keeping `translateConversationDeleted`'s existing string/null contract. It accepts the existing bare-event test seam, narrowing the optional stamp without casts. The hook preserves both arguments through its ref-held callback. `PairedShell` mounts the new decision in the existing deletion hook; the archive hook continues calling the old decision. Diagnostics carry only static event/codes, never conversation/server ids or content.

Remote feature branches were checked for these production files: no overlaps found. Sizing: one lifecycle deliverable, five observable acceptance criteria; approximately 70 production, 450 test and 80 plan lines, two new exports, fewer than ten updated consumers, two refusal branches and no new state machine. Re-counted against the written design: within all builder limits.

## State + concurrency model

The keyed map is the only new mutation target. Owned off-screen deletion never writes the active/flat/session/configuration stores. The decision is synchronous, so no await separates ownership check and removal. Existing publication boundaries flush older queued folds before ownership inspection/removal, and saved-read handles reject completion after their owning slice is removed. The existing hook unsubscribes on shell teardown; no async task is added. Fresh post-deletion traffic remains outside scope, as specified by the ticket.

## State transitions and identity reuse

| Event | Coverage in `confirmConversationDeleted.test.ts` unless specified |
| --- | --- |
| A deleted after switching to B | `removes only the owned inactive slice and preserves B state and order`; mounted `conversation-delete-inactive.spec.ts` held-confirmation sequence |
| Deletion with no active chat | `removes an owned slice with no active conversation` |
| Same id on another host / missing origin / unknown owner | `refuses unowned confirmations` |
| Active owned deletion | `clears active state before navigating` plus existing exit tests |
| Duplicate / absent / empty / hostile-looking id | `repeated confirmations use exact Map keys` |
| Request/rejection/archived list/unrelated event | `ignores events without confirmed deletion`; mounted spec checks held request leaves A retained |
| Pending frame published after confirmation | `queued frame cannot resurrect the deleted slice` with real publication/subscription boundaries |
| Saved read completes/fails/cancels after confirmation | `late saved read cannot resurrect a deleted slice` |
| Hook teardown and re-subscription | Existing bridge unsubscribe proof plus `unsubscribe stops invalidation` |

## Error handling

No I/O or new failures. Missing/foreign authority is a harmless refusal with a static diagnostic classification. Clear is idempotent. Existing deletion rejection and saved-history persistence ordering are untouched.

## Testing strategy

- First add a failing real-store regression through `subscribeConversationDeleted` using the existing gated exit, then drive it through the new decision after implementation.
- Real injected keyed, flat, active, session, run-config, settings-write and system-prompt stores prove A-only removal, B identity preservation and active clear-before-navigation. Parameterized cases cover authority, exact keys and stale read settlement.
- Controlled frame scheduling exercises `subscribeTimeline` and real store mutation boundaries; no fake cleanup implementation.
- Mounted fake transport holds A's correlated delete reply, opens B and releases A's confirmation. Inspect mounted retained-store state through test-only React fiber subscriptions, and assert B's visible thread/selection survives. No production test accessor.
- Run focused deletion/exit/archive, keyed-store, frame publication and saved-read units, the new fake spec and existing archive/switch/frame specs. After final main merge run pre-verify and build. No real-Claude test or native-platform evidence is required.

## Open Questions

None. Explicit retained-slice ownership is the authority for both invalidation and the active deletion path; unknown ownership does not justify a new clear.

## Security review

**Verdict:** PASS

- **Trust boundaries:** Main-stamped `serverId` survives `subscribeConversationDeleted`; the decision requires exact explicit slice ownership. Daemon ids remain exact Map keys, including empty/prototype-shaped values. Missing origin is never replaced with an active-host guess.
- **Tokens, secrets, credentials:** No credential access or new storage. Only already-typed ids enter the decision; none enter diagnostics.
- **File/storage operations:** No new persistence operation. Existing history writer ordering remains responsible for confirmed saved-history removal; late in-memory reads lose ownership when the slice disappears.
- **Electron attack surface:** No new IPC channel, context-bridge capability, raw markup, navigation target or remote-content sink. Existing isolation is unchanged.
- **Cryptographic primitives:** No crypto, key or nonce operations; existing main-process Noise transport is unchanged.
- **Network/I/O:** No network operation or parsing change. The typed confirmation already passed existing main-side decode and connection stamping.
- **Errors/logs/telemetry:** Static lifecycle/refusal codes only; no ids, message text, decrypted bytes or caught objects are logged.
- **Concurrency:** Flush before ownership check/removal; synchronous decision; existing saved-read ownership blocks success/failure/cancel resurrection. Existing hook off-handle owns teardown.
- **Threat alignment:** Delayed/duplicate relay delivery cannot authorize a foreign-owner clear. Hostile-daemon ids only address its explicitly owned retained view. Renderer isolation and token-at-rest protections gain no new surface. Flood/byte limits and fresh traffic after deletion are unchanged and outside this ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-13
