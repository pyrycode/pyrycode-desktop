# Provisional live Agent rows (#1840)

## Files read

- `src/main/transport/inboundMessage.ts` → `parseBackgroundTask`: additive wire narrowing and existing malformed-frame dispatch.
- `src/main/transport/inboundMessage.test.ts` → roster decoding cases: old rows and ignored extra-field assertion.
- `src/shared/wire/types.ts` → `BackgroundTask`: optional daemon #2753 id preserves narrow inputs.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `setRoster`, `setStartedTask`, `setUpdatedTask`: provenance, retained order and first-terminal boundaries.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → roster translation and terminal delivery: unchanged app-lifetime owning-host receipt path.
- `src/renderer/src/screens/conversation/groupToolRows.ts` → `groupToolRows`: exact Agent ownership and projection-only relocation.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `ToolRow`: native marker navigation, retained expansion and existing Agent treatment.
- `src/renderer/src/screens/conversation/foldToolRuns.ts` → `foldToolRuns`: background groups stay independent of ordinary folds.
- `src/renderer/src/screens/conversation/groupToolRows.test.ts`, `src/renderer/src/store/backgroundTaskRosterStore.test.ts`, `e2e/tool-groups.spec.ts`: focused existing proof surfaces.
- `docs/knowledge/features/background-task-roster-store.md` and `background-task-roster-store-internals.md`: panel membership differs from retained timeline evidence; app-level delivery survives navigation.
- `docs/knowledge/features/conversation-shell-tool-row-header-groups.md` → Subagent tool groups: escaped bounded descriptions, client-owned keys, exact joins and native marker controls.
- `docs/knowledge/features/development-verification.md`, `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md`, root `CLAUDE.md`: fake transport acceptance and additive wire contract.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=789-10437

Read the section screenshot and high-fidelity live-row `789:10539` and marker `789:10438`. Reuse `ToolRow`'s Agent monospace lead, ellipsized body-medium subject, right count/chevron, primary-container border and background tokens. Running groups stack at the bottom; settled rows stay at receipt position. Existing native marker buttons retain the busy/finished dots and primary action. The ticket's provisional-before-launch rule overrides the unmatched-launch design note. No new assets or styling.

## Context

A connect roster currently loses its tool-call id and cannot show live Agents until a start and launch have both arrived. Daemon #2753 supplies that missing join hint. This delivers one connect-before-history behavior using the existing retained lifecycle; history reconstruction remains #1781. No ADR is needed. No in-flight feature branch overlaps the planned files at the initial fetch.

## Design

- Add optional `BackgroundTask.tool_call_id?: string`. Missing/empty means unknown; reject any supplied non-string (including null), preserve every nonempty string exactly.
- Held tasks distinguish started provenance from placement availability through optional started/roster id readings. Started metadata wins after any start, even an empty id. Roster metadata otherwise refreshes each time. Placement prefers the latest usable roster id, falling back to a usable started id.
- Retained `BackgroundAgentTimeline` adds an optional description and client-owned numeric identity, keeping old narrow doubles valid. Existing evidence insertion order stays authoritative; a roster appends new qualified entries in roster order. Updates replace values without deleting/reinserting established entries. Only genuine roster-derived `local_agent` membership confirms evidence.
- A pure additive projection helper prepares synthetic Agent tool items for confirmed usable ids absent from loaded tool calls. They use the retained description, constant Agent name and empty result. A loaded matching non-Agent suppresses synthesis and relocation. Matching exact Agent rows gain existing markers and children, with no synthetic duplicate.
- `groupToolRows` receives the synthetic indices to omit launch markers for those items. Full groups use retained ordering and first-terminal anchors for both loaded and provisional items.
- `Timeline` assigns each retained identity one client-owned UI key on first observation: the existing ordinary key if already loaded, otherwise a provisional key. This keeps the same wrapper and expansion through late launch, children and history prepends; ordinary rows keep their origin-relative keys. IDs remain Map equality hints, never DOM attributes or selectors.

## State + concurrency model

Synchronous copy-on-write store updates preserve the app-lifetime bridge and owning-host checks. No new async job, subscription, timer or persistence. Existing first exact terminal update settles once, including after roster removal and while another chat is active. Roster absence/unknown statuses never finish, repeated updates never move or revive. Panel/pill membership, scoped reconnect and pairing resets remain unchanged. Existing scroll-pin observes growth and preserves scrolled-up offsets; marker navigation runs after layout.

## Error handling

`parseBackgroundTask` validates the additive id behind the existing `WireDecodeError` boundary. Malformed network frames follow existing classified, content-free logging and dispatch failure handling. No new IPC/error result or UI error surface. Descriptions are bounded to 4096 characters and rendered as React text with existing ellipsis, never interpreted as markup or logged.

## Testing strategy

- Parser units: missing/empty/exact ids, rejected null/non-string ids, unknown extras still discarded.
- Actual-store units: refreshing roster metadata with an id; empty-start provenance; preferred roster id and started fallback; roster-only qualification; stable evidence insertion order; terminal retention after removal and resets.
- Projection/static-render units: provisional rows, no marker before launch, exact/non-Agent joins, children, stable ordering and equal terminal boundaries; unmodified ordinary item references.
- Extend existing fake-transport `e2e/tool-groups.spec.ts`: pre-history roster rows, late live/history launch and children, same DOM row/expansion, pointer and Enter/Space markers, inactive-chat finish without duplication. Preserve its existing pinned/scrolled-up proof. Capture running/finished at desktop and minimum widths for Figma comparison.
- Run targeted red/green units, focused fake spec, then final main merge, pre-verify and build. No live-Claude changes or run required. `readSavedTimeline` contains no task frames; saved format and current saved placement remain unchanged (state this in PR).

## Open Questions

None. Considered storing provisional rows in timeline state; rejected because roster membership and ordinary arrival chronology already have distinct owners. A pure display projection extends the existing seam with less state.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] `parseBackgroundTask` checks presence/type without coercion; malformed optional ids fail closed through `WireDecodeError`. Downstream IPC carries parsed rows only. Map equality does not establish authority.
- [Tokens, secrets, credentials] No credential handling added; roster ids and descriptions never enter credential storage or logs.
- [File/storage operations] New evidence stays in memory and uses existing reconnect/pairing clears. No files, caches, web storage, paths or saved-format changes.
- [Electron attack surface] No IPC channel, navigation, remote content or window preference change. React text escaping and bounded descriptions prevent a new markup sink; ref navigation uses client-owned identity.
- [Cryptographic primitives] Noise and main-process key ownership remain unchanged; no crypto added or secret comparisons introduced.
- [Network/I/O] Existing encrypted transport framing and limits remain in force. New ids are open strings matching daemon #2753; no second protocol cap or raw-byte access in renderer.
- [Errors/logs/telemetry] Existing malformed-frame classification stays content-free. Never log roster ids, descriptions, message bodies, tokens, keys or decrypted bytes; no telemetry added.
- [Concurrency] Synchronous setters preserve established insertion and immutable first-terminal chronology. No new long-lived job; existing bridge cancellation and owning-host reset apply.
- [Threat model] Hostile daemon data is validated then inert text/equality hints; delayed/repeated frames cannot revive or relocate settled evidence. Relay and renderer credential isolation are inherited unchanged. Background-task history reconstruction is OUT OF SCOPE, owned by #1781.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07

Sizing recheck: one deliverable, approximately 650 total written lines (production/tests/plan), one new exported helper, one additive projection consumer update, four observable acceptance criteria and fewer than ten new ignore/reject branches. All boundaries hold.

## Revisions

2026-10-07: Reset verification requires client identities to remain unique for the lifetime of the store factory, including across reconnect/pairing clears, so a mounted Timeline cannot inherit an old provisional expansion. An empty later id leaves already-retained evidence intact; it cannot discard a settled row after roster removal. Held placement readings and first-terminal boundaries remain independent.
