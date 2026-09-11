# Subagent tool groups

## Files read

- `src/shared/wire/types.ts`: `ToolUsePayload`, `ToolResultPayload` — daemon field contracts.
- `src/shared/ipc/events.ts`: `HistoryTimelineEvent`, `DaemonEvent` — both IPC lanes.
- `src/main/transport/inboundMessage.ts`: `parseToolUsePayload`, `parseToolResultPayload`, `decodeHistoryEvent` — validation and replay.
- `src/main/daemonConnection.ts`: live tool emission — explicit payload mapping.
- `src/renderer/src/store/timelineBridge.ts`: `translateTimelineEvent` — domain translation.
- `src/renderer/src/store/threadTimeline.ts`: `reduceTimeline`, `fillResult` — arrival order and result correlation.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `Timeline`, `TimelineRow`, `ToolRow` — stable row identity and expansion.
- `src/renderer/src/screens/conversation/conversation.css`: tool-row rules — existing tokens and body styling.
- `e2e/tool-denied.spec.ts`: fake live-frame delivery and result interaction pattern.
- `docs/knowledge/features/conversation-timeline-store.md`: history prepend identity must survive insertion.
- `docs/knowledge/features/conversation-shell-tool-row-header-groups.md`: fill/hug header and count slot.
- `docs/knowledge/features/development-verification.md`: static rendering cannot prove interaction.

## Design source

https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553

The screenshot is a single bordered, rounded row with a monospace lead and flexible description on the left, count and right-facing chevron on the right. Reuse `ToolRow` and its existing background, primary-container border, body typography and spacing tokens; nesting adds token-based indentation capped at two levels.

## Context and sizing

One observable feature: group attributed tool calls without changing stored arrival order. Assistant text remains independent. Approximately 750 written lines, nine production files including a pure grouping helper, at most two new exports, no required consumer migration, five acceptance criteria, and no new I/O error branches. The file ceiling is exceeded by four; the single-consumer floor keeps field plumbing with its only consumer. The nearest analogue is `6062f97` (444 additions including proof and plan revisions). Remote feature-branch overlap check found no conflicts. Codegraph was unavailable; source reads supplied the map.

## Design

Add optional `parent_tool_use_id` to both wire payloads and optional `parentToolUseId` to live/history IPC and timeline events and tool items. Decode with the existing optional-string validator, normalizing only empty strings. Preserve exact nonempty values. Result correlation remains by its own id; an absent result parent never erases the call's parent, and a result can supply an otherwise absent parent.

A pure `groupToolRows` helper projects item indices into display order with depth, ancestor indices, distinct descendant count and running status. Only known Agent/Task calls may own children. Missing parents remain roots; rebuilding the projection after history arrives groups them. Root and sibling ordering follow the original array. Walk iteratively, with visited membership so hostile cycles cannot recurse forever or hide rows. Maps use identifier equality, never object-property lookup. Cyclic relationships fall back to roots.

`Timeline` renders the projected rows under one stable parent, keyed by their original origin-relative index. Wrapper visibility follows ancestors' expansion state; hidden descendants remain mounted so their own result and nested-group expansion survive outer collapse. `ToolRow` accepts optional group metadata, is expandable while pending when it has descendants, and uses its current header count slot for descendant count and running text. Calls without children keep existing rendering. Group expansion state is UI-local in `Timeline`, keyed by origin-relative row identity, and begins collapsed. Existing non-tool row identity and queue folding remain intact.

## State + concurrency model

No new store, subscription, timer or async task. The projection consumes one conversation's items synchronously. Results update existing calls and history prepends preserve origin-relative row identities. UI expansion is retained for surviving rows for the lifetime of the mounted timeline.

## Error handling

Present non-string attribution follows existing malformed live-frame/history-entry policy. Missing parents are a normal display fallback. Existing content-free decoder lifecycle and error logging remain authoritative; identifiers never enter logs or DOM attributes.

## Testing strategy

- Decoder tests cover missing/empty/exact strings, malformed fields, live and history paths, and content-free logging.
- Reducer/bridge tests cover parent preservation, result resolution without extra rows, and history replay.
- Pure projection and static render tests cover interleaving, orphan recovery, descendant count/status, depth cap, cycles and collapsed rendering.
- Fake-transport Playwright proves live IPC, pending expansion, nested visibility, child result expansion, resolution status, indentation and surviving state after history prepend.
- Run touched Vitest files, `npm run build`, and the new focused Playwright spec.

## Open questions

None. For malformed cyclic hints, retain every row as a reachable root rather than trusting an impossible ancestry.

## Documentation handoff

No explicit documentation requirement in the ticket. Feature documentation belongs to the later documentation stage.

## Security review

**Verdict:** PASS

- Trust boundaries: the existing payload parsers validate attribution in both lanes; the string remains an untrusted grouping hint, never authority.
- Tokens and storage: no credentials, persistence or filesystem operations are introduced; attribution stays in memory.
- Electron: no new IPC channel, renderer capability, navigation or remote content. Existing typed event arms carry one optional field.
- Cryptography and network: no changes to Noise, sockets, relay URLs or frame limits. Parsing happens after the existing transport boundary.
- Logs: existing decoder metadata logs contain event codes, bytes and hashes only; attribution and description never enter diagnostics.
- Concurrency: synchronous projection and reducer updates introduce no asynchronous lifetime or cancellation obligation.
- Hostile daemon: Map-based equality avoids prototype properties; iterative traversal and cycle fallback preserve reachability and terminate. Identifiers never become DOM attributes, URLs, filenames or log fields. Counts are derived from distinct calls in the current conversation only.
- Threat alignment: relay and credential protections remain with the existing transport/security components; this change grants no additional capability to a compromised renderer.

**Reviewer:** builder self-review per `builder/security-review.md`
**Date:** 2026-09-11


## Revisions

- 2026-09-11: Expansion is controlled by `Timeline` for every tool row, not just groups. This preserves an expanded leaf when history supplies its first child. The timeline is keyed by conversation so expansion cannot leak to unrelated calls in a different conversation. Pending expanded groups show their descendants without an empty result body.
- 2026-09-11: `DecodedHistoryEvent` is a separate internal type in the already-planned decoder file and also carries attribution. The file count is eight TypeScript production files plus the existing CSS file; total written work remains below 800 lines. Unit history proof is split across decoder and renderer projects to respect their TypeScript boundaries.
- 2026-09-11 (PR #1328 verifier rework): `Timeline` derives join styling from visible tool neighbours at the same capped indentation, skipping collapsed descendants and undrawn `turnBoundary` items. The wrappers broke the former direct-sibling CSS selectors. Keep those wrappers and stable mounted identities, and extend the existing join rules with client-owned wrapper classes for corners, shadow, overlapping borders and adjacent error edges. Different indentation or a visible non-tool row ends a stack. Visible wrappers use a flex column so the child's negative join margin reduces its wrapper's height without margin collapse. Security review remains PASS: all new classes derive from validated item kinds, booleans and bounded depth; no identifier reaches a new sink. Preserve the existing `tool-row-toggle` assertion and add `tool-groups` interaction proof for joins through outer collapse, child-result expansion and depth changes. The rework adds two production-file edits and roughly 140 written lines; cumulative work stays below 800 lines. Documentation handoff remains pending for the later stage.
