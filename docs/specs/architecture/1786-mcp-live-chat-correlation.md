# #1786 — Correlate the live MCP proof with its UI-created chat

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md` and `docs/knowledge/features/development-verification.md`: test boundaries and live-gate ownership.
- `e2e/real-claude-mcp.spec.ts` → `watchMcp`, `readMcp`, `createChat`, `McpSeen`: global evidence currently chooses its own target and drives all waits.
- `e2e/real-claude-permission-modal.spec.ts` → UI creation observer: `conversationCreated` provides an identity independent of reports.
- `e2e/fixtures/realDaemon.ts` → `seedRegistry`, `BOOTSTRAP_UUID`: a seeded conversation exists before the UI creates this proof's chat.
- `e2e/fixtures/confirmCreateChat.ts` → `confirmCreateChat`: existing operator creation flow stays unchanged.
- `docs/knowledge/features/conversation-shell-channel-info-mcp.md` → MCP servers section: preserve built-in filtering, reconnect and toggle proofs.
- `docs/knowledge/features/daemon-connection-correlation-system-prompt-and-mcp.md` → MCP-status request correlation: decoded successful reports have no request identity and can publish unsolicited.
- `vitest.config.ts` → `include`: local `e2e/*.test.ts` helpers already run in the unit suite without collecting Playwright specs.

## Context

Both #1729 and #1726 fail `every report names the one chat` after the built-in rows and sheet-open count check pass. Their same-tree re-runs pass, both annotating reconnect and toggle as `refused`. The logs establish mixed conversation IDs, but do not identify the extra publisher; attributing it to the seeded bootstrap chat is an inference. The cause is the test's globally collected reports being treated as one chat's evidence, rather than a confirmed daemon defect.

Evidence is already recorded on the ticket in the refinement comment. The original logs are under `/work/Projects/pyrycode-desktop-agents/logs/`: `2026-10-05T17-30-27-313Z_real-claude-gate_#1729.log` and its `real-claude-gate-rerun` counterpart (5,306 ms failed; 5,286 ms passed), and `2026-10-05T19-00-09-611Z_real-claude-gate_#1726.log` and its rerun (5,484 ms failed; 6,661 ms passed). Revisions: #1729 `db2152aed2` with main `8b8f79b77d`; #1726 `fd8a645100` with main `6bc4e8839b`.

One test-correlation deliverable; approximately 250 written lines including plan and controlled coverage, zero production changes, at most five exported test-only symbols, one consuming spec, four observable acceptance criteria and no product state-machine changes. The in-flight remote feature-branch check found no overlap with the planned files. This repair changes no UI, needs no design source, dependency or ADR.

## Design

Move the existing page observer and snapshot read into `e2e/realClaudeMcpProof.ts`, used only by this proof and `e2e/realClaudeMcpProof.test.ts`. Observe the first `conversationCreated` after pairing and immediately before the UI create flow. `createChat(page): Promise<string>` waits for that creation result and the existing empty thread/Send readiness, then returns its nonempty ID. MCP publications never select or replace it.

`readMcp(page, conversationId): Promise<McpSeen>` returns only that conversation's reports, reconnect refusals, toggle refusals and corresponding bounded `pyry_files` status words. Every baseline, wait and status index reads this snapshot. Commands name the independently created ID. Retain the existing identity assertion over the scoped reports.

`mcpOutcome(now, before, action)` returns `waiting`, `report`, `refused` or `both`, using increases in the scoped report and action-refusal counts. Live polling waits for an outcome other than `waiting`, then rejects `both` and preserves existing annotations and UI assertions. Old refusals do not settle a later action. Sheet opening still requires a new target-chat report. This is temporal conversation correlation, not a claimed wire request match.

## State + concurrency model

Only test-owned page observation state changes: record the creation identity independently and keep report/status pairing intact while filtering snapshots. Subscribe before UI creation and child spawn. Return an unsubscribe callback from the observer and invoke it in `finally`, including failed assertions. No production store, stream or teardown changes.

## Error handling

Creation without a target identity, missing fresh target reports or refusals, and simultaneous report/refusal evidence continue to fail. Foreign events do not alter the target baseline or outcome. Preserve all existing timeout values; add no retry, sleep, skip or timeout extension.

## Testing strategy

- Test first with a controlled page evaluator and typed daemon-event publisher, exercising the actual observer/read functions rather than a duplicate selector.
- Interleave foreign reports and both refusal kinds before creation, before baselines and during the sheet-open/reconnect/toggle waits. They neither contaminate target evidence nor satisfy a wait; target reports and each matching refusal do.
- Assert creation identity is independent of publications, status indexing selects the target's bounded word, historical refusals do not settle later actions, and both outcomes remain rejected.
- Run the focused regression, pre-verify check and build after merging final main.
- Hand live acceptance to the dispatcher with `needs-real-claude` retained: run the named existing live test via `npm run e2e:real:gate`, record executed/passed/failed/skipped counts and both outcome annotations. Controlled coverage does not substitute for that gate.

## Open Questions

None. The repair follows the observed test mechanism and leaves the real-daemon outcome for the dispatcher-owned live gate.
