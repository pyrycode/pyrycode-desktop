# Finished background Agent history

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: process boundaries and test evidence.
- `docs/knowledge/features/background-task-roster-store-internals.md`: retained evidence is independent of roster membership; resets remove it without recycling identities.
- `docs/knowledge/features/conversation-shell-tool-row-header-groups.md`: existing marker, grouping and navigation contracts.
- `src/main/transport/inboundMessage.ts` → `decodeHistoryEvent`, lifecycle payload parsers: bounded validation and per-entry skipping.
- `src/main/daemonConnection.ts`, `src/shared/ipc/events.ts`: named-field IPC emits and history event mirror.
- `src/renderer/src/store/historyPageBridge.ts` → `withoutLiveEntries`, `reduceHistoryPage`, `subscribeHistoryPage`: chronological scratch fold and safe live suffix join.
- `src/renderer/src/store/conversationTimelineStore.ts` → `prependHistoryFor`, `withoutHeldEchoes`: owning-host admission, stable keys and echo deduplication.
- `src/renderer/src/store/backgroundTaskRosterStore.ts`, `backgroundTaskRosterBridge.ts`: independent placement evidence and first-live-terminal capture.
- `src/renderer/src/screens/conversation/groupToolRows.ts`, `backgroundAgentTimeline.test.tsx`, `e2e/tool-groups.spec.ts`: projection, identity, expansion and browser harness.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=789-10437
Read the section screenshot and detailed finished frame `789:10678` and marker `789:10445`. Reuse the existing ToolRow and Agent marker: green finished dot, body-medium description, primary label-medium Go to agent, and the settled row above later messages. No styling or assets change.

## Context

Finished lifecycle evidence currently disappears during page folding. Retain it through the established Agent projection so finish, start and launch can join across newest-first pages without replay acquiring live roster authority. Saved snapshots contain no task frames; their current placement remains unchanged. Durable admission/persistence and automatic newest-page requests remain with #1814/#1815.

## Design

- Extend only started/updated history events with task id, start join/type/description and update status. Reuse live parsers and switch dispatch; omit patch, summary, roster and progress.
- Keep `reduceHistoryPage`'s rows-only return; an optional placement collector reports lifecycle events with their scratch ordinary-row boundary. `subscribeHistoryPage` passes this evidence alongside folded rows.
- `prependHistoryFor` returns boundary keys for the original page rows, including deduplicated echoes and the page tail. Allocate fresh prepend keys without recycling a reserved tail boundary. The bridge maps placement offsets through these keys.
- Add a history-only writer to `backgroundTaskRosterStore`. Retain unmatched valid starts and terminal finishes inside `agentTimeline`; preserve identities and established first finish. History-only evidence cannot create provisional/running rows. Exact local_agent + nonempty start id + terminal finish qualifies historical evidence; projection additionally requires an exact Agent launch.
- Preserve existing live evidence and start order when history attaches. Reconstruct history finishes using stable ordinary-row anchors and chronological finish order, never numeric prepend allocation order. Projection inserts by resolved anchor position, with existing live boundaries retaining their current interpretation.
- Propagate live started/updated envelope timestamps through IPC and record their bounded join keys without dispatching timeline events. The ordinary-event suffix join remains unchanged.
- In-flight overlap: #1544 edits other daemonConnection branches; placement emits stay local and additive.

## State + concurrency model

All writes are synchronous in existing subscriptions; no new job, timer or subscription. Page scratch phase/turn state never enters live state. The history writer changes only agentTimeline. Existing reconnect/pairing clears remove all retained evidence. Page attribution remains the client-correlated conversation within the owning-host receipt boundary.

## Error handling

Malformed lifecycle payloads skip individually with existing content-free diagnostics; malformed page envelopes reject wholesale. Empty joins, non-local_agent starts and nonterminal statuses cannot qualify historical placement. Task ids are Map equality hints only, never selectors, attributes, paths or logs. No new user-facing error mode.

## Testing strategy

- Transport units: valid and malformed started/updated payloads, omitted live-only fields, excluded roster/progress/modal/question frames; timestamp propagation through live parsing/emits.
- Store/projection units: finish-before-start across pages, tied finishes, late launch/children, echo boundary mapping, no historical provisional rows, live overlap and immutable finish, isolated roster/turn state, clears and conversation isolation.
- Extend `e2e/tool-groups.spec.ts`: separate-page reconstruction and late attachment, expansion and marker navigation, unique rows, stable DOM identity and reader position. Capture finished state at desktop/minimum width for visual comparison.
- Final pre-verify and build after merging main; run the focused fake spec. No live specs are changed.

## Open Questions

None. Boundary keys are client identity; their numeric value does not establish history chronology.

## Security review

**Verdict:** PASS

- [Trust boundaries] Reuse `parseBackgroundTaskStartedPayload` / `parseBackgroundTaskUpdatedPayload` at `decodeHistoryEvent`; named-field history IPC exposes placement data only. Switch dispatch avoids prototype lookups.
- [Tokens] No credentials enter this path; existing main-process safeStorage and key ownership remain unchanged.
- [File/storage operations] Memory-only evidence; no daemon string becomes a filename/cache key. Saved format and storage are unchanged; durable history is #1814.
- [Electron attack surface] No channel or privileged capability added. Existing isolated renderer receives parsed events; identifiers never reach DOM attributes/selectors and descriptions reuse bounded escaped text.
- [Cryptographic primitives] No crypto changes; Noise stays in main with the existing variant and nonce lifecycle.
- [Network/I/O] Existing frame/page limits and parser bounds apply; no new request or reconnect behavior.
- [Errors/logs] Existing history skip diagnostics contain static codes/counts only; never log descriptions, ids, patch, summary, plaintext, tokens or keys.
- [Concurrency] Synchronous read/write handoff has no await race. Existing owning-host attribution and reset methods bound retained joins; no new asynchronous ownership.
- [Threat model alignment] Hostile daemon entries validate before IPC; malformed siblings skip independently. Relay ordering cannot authorize a live roster change through replay. Renderer isolation and token-at-rest protection remain unchanged; durable admission is #1814.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07

## Revisions

2026-10-07: Lifecycle placement collection reads the original page even when the safe ordinary-event suffix join suppresses its live duplicates. This lets a historical start qualify held unconfirmed live evidence without losing the start to timestamp deduplication; an established live finish still wins. Historical anchors compare stable row identity separately from live receipt chronology, and reserve a tail key on evidence-only pages so older prepends cannot take that identity. Historical markers use the retained start description, bounded and escaped through the existing marker.

2026-10-07 (verifier finding 1): `setUpdatedTask` promotes retained valid historical-start qualification when it records the first exact live terminal status. The existing identity, live boundary and finish order remain authoritative through historical terminal replay; roster/panel/pill state remains isolated. The parameterized `finishedAgentHistory.test.ts` regression covers historical start/launch → live completed/failed/stopped → terminal replay, including row/marker uniqueness, chronology, immutable evidence and live-state isolation. Security review remains PASS: only previously validated placement evidence can qualify, with no new IPC, text sink, persistence or asynchronous work.
