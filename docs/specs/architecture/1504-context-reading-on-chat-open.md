# Context reading on chat open

## Files read

- `src/renderer/src/PairedShell.tsx` — `activateDeps.requestConversationConfig` is the connected-owner activation seam.
- `src/renderer/src/activateConversation.ts` — `activateConversation` requests configuration on every activation, including the same id.
- `src/renderer/src/screens/conversation/conversationActionAvailability.ts` — `connectedConversationHostNow` gates requests; `initializeCreatedConversationAfterList` handles creation before list arrival.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` — `requestRunConfigSnapshot` supplies the injected, falsy-id-guarded sender pattern.
- `src/main/daemonConnection.ts` — `requestContextUsage` already sends once and logs static sent/refused/failed diagnostics without retry.
- `src/shared/ipc/commands.ts` — `RendererCommand` already carries the required conversation id.
- `src/renderer/src/store/reportedContextBridge.ts` — `subscribeReportedContext` accepts both unsolicited readings and correlated replies.
- `src/renderer/src/screens/conversation/contextTokenSource.ts` — `contextTokenSource` prefers the conversation's reported reading over settings.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` — `RunConfigSections` uses that source for the existing gauge.
- `e2e/composer-context-claude-reading.spec.ts` — existing wire-to-footer source-swap proof and synthetic frames.
- `e2e/offline-conversation-actions.spec.ts` — renderer-command observation and disconnected activation patterns.
- `docs/knowledge/features/paired-shell.md` and `paired-shell-conversation-exits.md`, activation section — requests belong at activation, not every settings refresh.
- `docs/knowledge/features/reported-context-store.md`, “How it works” — passive receive bridge and absent-only fallback.
- `docs/knowledge/features/development-verification.md`, test boundaries — static renders cannot prove activation; absence assertions need a completed action.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=110-3494
and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-152

Read both design contexts and screenshots. The footer is a compact horizontal row with body-small primary text and a context percentage beside the controls; the gauge reading is body-large on-surface text describing percentage and token totals. Preserve the existing components, theme tokens, icons, spacing and severity treatment; only the time at which data arrives changes.

## Change

Add a React-free `requestContextUsage(sendCommand, conversationId: string | null): void` helper beside `runConfigSnapshot`, rejecting null/empty ids and sending exactly one existing `requestContextUsage` command. Call it immediately beside `requestRunConfigSnapshot` in `PairedShell` after the existing connected-owner guard. Keep activation's re-open behavior and created-chat initialization unchanged. No new state, asynchronous task, listener, cancellation path or failure mode: sending is synchronous fire-and-forget, main already classifies/logs send failures, and neither layer retries. The existing per-conversation receive store and source selector update both surfaces; silence/errors leave their held reading or transcript fallback intact. No ADR is needed.

One deliverable; approximately 180–220 written lines, 2 production files, 0 new exported types/components/stores, 1 new consumer call site, 2 acceptance criteria and 0 new state-machine reject branches. This reuses #1166's activation seam rather than changing its contract. Codegraph is uninitialized; repository search supplied the reading map. Fetched all remote feature branches: no overlap with the planned source/test files. No security-sensitive label.

## Testing strategy

- Commit this plan before implementation. First run the sender unit tests RED for the missing helper; prove exact command, null/empty no-op, repeated explicit asks and no scheduled retries.
- Extend the existing fake-transport spec with an on-open correlated reply, held until both surfaces show the transcript fallback. Assert the captured request id/payload, replacement in footer and gauge before any turn, same-chat reopening, no extra request on sheet open, and no renderer request during unavailable-host reopening. Preserve the unsolicited turn-end case.
- Build and run that focused Playwright spec RED before wiring, then GREEN after implementation. Capture the footer and open gauge at 1280×800 in `/tmp/builder-1504-visual/` and compare with the supplied Figma nodes.
- Final gate: touched sender Vitest file, `npm run build`, and the focused fake-transport spec. Full suites belong to the verifier; no live-Claude criterion is required.

## Documentation handoff

Pending for the documentation stage, exactly as the refiner specified:

> Update `docs/knowledge/features/reported-context-store.md` under “How it works” from “callable but dormant” to the on-open request behavior, retaining the passive receive bridge and no-retry distinction.

## Open questions

None.
