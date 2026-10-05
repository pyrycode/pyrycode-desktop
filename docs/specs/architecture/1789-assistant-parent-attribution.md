# Assistant text parent attribution

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository rules and validation boundaries.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-tool-row-header-groups.md`: mounted hidden children, origin-relative expansion identity, token indentation and distinct tool counts.
- `docs/knowledge/features/inbound-message-decode.md`, `thread-timeline.md`, `chat-history.md`: shared decode, tail-only coalescing and validated version-1 persistence.
- `src/shared/wire/types.ts` → `AssistantDeltaPayload`; `src/main/transport/inboundMessage.ts` → `parseAssistantDeltaPayload`, `decodeHistoryEvent`, `DecodedHistoryEvent`: the two decode lanes.
- `src/main/daemonConnection.ts` → `createDaemonConnection`; `src/shared/ipc/events.ts` → `DaemonEvent`, `HistoryTimelineEvent`; `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`: named-field forwarding.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`, `ThreadEvent`, `appendDelta`; `historyPageBridge.ts` → `reduceHistoryPage`: arrival-order state and history replay.
- `src/shared/chatHistory.ts` → `DurableThreadItem`, `threadItem`; `chatHistoryWriter.ts`, `chatHistoryContract.test.ts`: persistence projection and renderer contract.
- `src/renderer/src/screens/conversation/groupToolRows.ts` → `groupToolRows`; `ConversationScreen.tsx` → `Timeline`, `ToolRow`, `TimelineRow`; `conversation.css` → tool-group depth selectors: reuse presentation and visibility.
- `toolGroups.test.tsx`, `e2e/tool-groups.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: existing projection and fake-transport coverage.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=789-10437
Read the section screenshot and detailed live-row `789:10539` and assistant-message `789:10473` contexts. Reuse the existing Agent/Task header, primary chevron, body-medium assistant bubble and body-small meta row; indent child text with existing `--space-4` depth classes. Marker and live-row placement remain with #1780/#1781, as the ticket specifies; no new assets or styling are needed.

## Context

Subagent replies lose their display attribution during decode. Preserve the daemon's existing optional parent hint and reuse the loaded-owner grouping rather than depending on roster or placement work. This is one deliverable, estimated at about 480 written lines across nine production files, tests and this plan; no new exported type/component, nine forwarding/state/display surfaces, five observable criteria, no new state-machine rejects. The estimate is consistent with #1239's roughly 516-line grouping implementation. No ADR is needed.

In-flight overlaps: #1544, #1721, #1723, #1726, #1729, #1731 and #1738 share files. Their changes concern other event arms, queued-message identity/actions and question placement; this attribution change is local and needs none of their new contracts. Preserve their additions when merging.

## Design

Add optional `parent_tool_use_id` to assistant wire payloads and `parentToolUseId` to decoded history, live/history IPC, timeline events, assistant items and durable assistant items. Decode using `optionalString` like tool payloads: empty or missing becomes undefined, every supplied non-string rejects. Copy named fields at each forwarding boundary.

`appendDelta` retains tail-only coalescing, requiring equal turn and parent; preserve the first creation stamp. Stored items remain in arrival order. `groupToolRows` permits assistant text to reference only a loaded Agent/Task owner, including completed rows. Its existing Map ownership and iterative cycle handling remain. Roots and mixed text/tool siblings retain relative order. Add `hasChildren` to the existing projection record so text-only parents expand while `count` still counts distinct descendant tools only.

`Timeline` wraps nested assistant rows using the existing depth and hidden treatment, keeps them mounted and uses origin-relative keys. Parentless text retains its existing direct rendering. Pass a group to `ToolRow` whenever `hasChildren`, including zero-tool groups; pending text-only owners therefore have the same control and a zero distinct-tool count. Missing owners and ordinary tools leave assistant replies top-level. History prepend naturally recomputes ownership without duplicating text.

`threadItem` validates the optional saved id with the same bounded `id` parser as tool attribution. Existing version-1 parentless snapshots stay readable; no version bump or storage mechanism change.

## State + concurrency model

No new store, effect, async task or cancellation owner. Existing conversation-keyed timeline and serialized event/history reductions own state. Expansion remains UI-local to the mounted conversation and keyed by origin-relative row identity. Persistence retains the existing writer and teardown/flush lifecycle.

## Error handling

Malformed live parents take the existing `WireDecodeError` path with category-only diagnostics; malformed history entries use existing entry skip handling. Invalid saved ids use `INVALID_CHAT_HISTORY` and existing typed history error results. Unknown owners are presentation fallbacks, not errors. Parent ids never become authority, DOM attributes, logs, paths or raw markup.

## Testing strategy

- Decode both lanes with nonempty, empty, missing and malformed/null parent values; verify live daemon forwarding and the timeline bridge.
- Reducer/projection cases: main text interleaved with two parents sharing a turn, same-parent growth, turn changes, mixed tool children, unchanged parentless coalescing, completed owners, ordinary tools and late owner history prepend.
- JSON snapshot round trip with owner/parented text plus an old parentless shape; malformed saved parent validation; retain compile-time durable contract test.
- Fake-transport Playwright streams text before owner result, expands/collapses text-only and mixed groups, checks order, count and exact single occurrence. Capture expanded state at standard/minimum widths for visual comparison.
- After final main merge: pre-verify check, build and focused browser spec. No live-Claude test is required.

## Open Questions

None. The cleaner shape is to extend the existing projection with `hasChildren`, rather than create a second nesting or expansion model.

## Security review

**Verdict:** PASS

- [Trust boundaries] `parseAssistantDeltaPayload` validates optional strings in both network decode lanes; `threadItem` validates bounded saved identifiers. Named-field forwarding keeps unknown fields out of IPC. MUST FIX addressed in design: null/nonstrings must reject, never be coerced.
- [Tokens, secrets, credentials] No credential changes; attribution is a display hint only and never logged.
- [File and storage operations] Saved ids are values parsed by `id`, never filenames or lookup paths. Existing encrypted atomic history storage is unchanged; no renderer web storage.
- [Electron attack surface] No new bridge APIs or navigation changes; existing main decode sends typed events. Rendering reuses escaped assistant text and client-owned depth/hidden classes; parent strings never enter attributes.
- [Cryptographic primitives] Noise, key ownership, nonces and secret comparison are unchanged; no cryptographic operation uses attribution.
- [Network and I/O] Existing bounded frame codec and relay lifecycle remain; optional field validation introduces no socket or request. Malformed fields follow existing typed decode failure paths.
- [Errors, logs, telemetry] No new content logs; errors remain category-only. Tests must ensure malformed values cannot escape into exception messages.
- [Concurrency] Pure projection over one conversation; loaded owners only. No asynchronous buffer or id-based cross-conversation routing; existing history/writer lifetime owns teardown.
- [Threat model alignment] Hostile daemon attribution may alter display grouping but grants no authority; nonstrings fail closed, Map matching avoids object-key hazards, existing cycle disconnection keeps rows reachable. Relay encryption/isolation and token-at-rest protections remain unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05
