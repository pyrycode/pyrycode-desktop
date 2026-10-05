# Stop one running background task

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: renderer tests are static; transitions require fake-transport Playwright.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-background-tasks.md` and `background-task-roster-store.md` / `background-task-roster-store-model.md`: roster membership, terminal grouping, escaped daemon text and app-lifetime ownership.
- `docs/knowledge/features/session-store.md`, `src/renderer/src/store/sessionStore.ts` → `selectStatusFor`: owning-server connection and ack, never the compatibility status cell.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `setRoster`, `setUpdatedTask`, `resetRostersFor`, `clearAllRosters`: joins and lifecycle boundaries; extend these locally.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `subscribeBackgroundTaskRoster`, `BackgroundTaskRosterData`: synchronous event ordering and stamp-based server scope.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `TaskRow`, `BackgroundTaskPanelView`, `BackgroundTaskPanel`: presentation, escaping and Escape ownership.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `selectedHost`; `conversation.css` → task card rules; `theme/tokens.css` → existing button typography, palette and spacing.
- `src/shared/ipc/commands.ts` → `isRendererCommand`; `src/main/index.ts` → stop command routing; `src/main/daemonConnection.ts` → `stopBackgroundTask`: #1770 supplies validated payloads and send-time refusal correlation.
- `src/renderer/src/store/mcpStatusStore.ts`, `e2e/fixtures/conversationStateFake.ts` → toggle wait/refusal and callable fake seams; `e2e/background-task-reconnect.spec.ts` → real command/event fixture.
- Existing panel, roster and bridge unit specs: preserve identity, grouping, truncation and security assertions.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=564-2230
Also inspected nodes 565:2281, 565:2241, 565:2519, 347:6645 and 801:11055, including screenshots. The separate Secondary small button follows all content and cut markers, left aligned in the card's existing 8px gap. Use Background (#101418), Primary (#9dcbfc), a 1px outline, 6px radius, 16px horizontal padding, 7px vertical padding and body-small emphasized (12/16, weight 500, tracking 0.4px), mapped to existing tokens. No new assets; existing drawer decorations stay in place. Pending retains “Stop task” with disabled styling.

## Context

Operators need to stop one background task without interrupting the conversation's current reply. Accepted requests are silent; only daemon membership/terminal events settle the wait. No ADR or documentation requirement is specified. In-flight #1726 and #1728 touch conversation wiring/CSS in different blocks; their changes add no dependency.

## Design

Add renderer-only `pendingStops: ReadonlyMap<string, ReadonlySet<string>>` to the roster state. `beginTaskStop(conversationId, taskId): boolean` synchronously verifies a listed, unfinished, uncut task and atomically claims its wait; duplicate claims return false. `endTaskStopWait(conversationId, taskId): void` clears only that pair. A narrow selector returns the held set or null.

The panel container receives `serverId` from `selectedHost`, selects `selectStatusFor(serverId)`, and enables actions only for Claude while that host is connected with `CAPABILITY_STOP_BACKGROUND_TASK`. The click rechecks the current host status, claims the pair before sending `stopBackgroundTask` with the two payload ids, and leaves roster/grouping untouched. The pure view takes an optional stop callback and pending ids; running uncut rows render the separate button, finished/Codex rows do not. Rows remain semantic, inert list items. No id reaches an attribute or additional React key.

Cleaner-shape check: retain the existing roster owner and named-setter convention rather than introduce a second pending store or a drawer-lifetime subscription. Add an optional trailing refusal writer to the bridge, preserving existing callers while app composition supplies it.

## State + concurrency model

All mutations are synchronous copy-on-write; there is no await between claiming a wait and sending the existing void command. Roster replacement intersects waits with still-listed tasks; terminal updates remove their pair, while nonterminal updates/progress retain it. Correlated refusal clears exactly its pair. Existing stamp-based reconnect reset clears waits for only that server's conversation ids; pairing clear removes all. Drawer and conversation unmount do not clear waits. The existing app-mounted event listener owns settlement and unsubscribes at app teardown; no new timer or async job.

## Error handling

Use #1770's validated command and typed correlated `backgroundTaskStopRejected`; no raw error text reaches the panel. Refusal re-enables the named button. Disconnected/missing/unsupported host state hides actions, including a fresh interaction-time check. Silent acceptance has no timeout by contract: keep pending until terminal update, omission, refusal or reconnect. Existing main-process content-free stop diagnostics cover send/refusal failures; never log ids or daemon text here.

## Testing strategy

- Static renders: visible footer placement after progress/update/cut markers; disabled label preserved; finished, Codex, absent action and task-own cut id hidden; report-own cut lists do not hide the button; hostile task ids absent from markup.
- Isolated roster state: atomic duplicate claim, distinct rows/conversations, nonterminal preservation, all terminal statuses, roster omission, exact refusal, server-scoped reset and pairing clear. Keep other conversation slice references stable.
- Injected bridge + real store: correlated refusals and reconnect scoping from client stamps despite a conflicting ack server id; app-lifetime settlement without drawer mount.
- Fake-transport Playwright: record stop payloads, hold a silent request across close/reopen and conversation switch, then drive stopped update, roster omission and correlated refusal through Noise/IPC and assert positive outcome barriers and request counts.
- Run touched-scope vitest and `npm run build`, plus only the new Playwright spec. Capture integrated states at 1280×800 and 800×600, compare against Figma, keep images under `/tmp/builder-1771/`.

## Open Questions

None. Scope count: one deliverable, four observable acceptance groups, no new production exported types/components/stores, two production wiring consumers and an optional bridge argument; estimate 700–750 total written lines, at most six guard/outcome branches. Recount before implementation/commit; stay below 800 lines.

## Security review

**Verdict:** PASS

- Trust boundaries: task ids remain routing values in existing Maps/Sets and validated IPC payloads; `beginTaskStop` refuses the task's own cut id. Daemon content remains escaped children only.
- Tokens/secrets: no credential access or persistence added; existing main-only safeStorage boundary unchanged.
- File/storage operations: pending is memory-only and pairing-cleared; no paths, browser storage or production file writes.
- Electron attack surface: existing `isRendererCommand` validates both nonempty ids and `src/main/index.ts` routes by conversation; no new IPC API, navigation or security setting.
- Cryptography: existing main-process Noise transport is reused; no renderer crypto, nonce or key changes.
- Network/I/O: existing connection framing and lifecycle are unchanged; silent acceptance is intentionally represented as a wait, with reconnect recovery and no retries.
- Errors/logs/telemetry: the renderer consumes the typed pair-only refusal; no daemon text or task id logging, attributes, URLs or extra keys. Existing main diagnostics are content-free.
- Concurrency: synchronous claim prevents duplicate sends, settlements prune bounded listed waits, app subscription survives navigation and retains cleanup. Reconnect uses the client stamp, never `ack.server_id`.
- Threat model: malicious relay delay keeps one disabled button until reconnect; hostile daemon text cannot become markup or execution, and cut ids cannot actuate a different task. Existing process isolation keeps tokens/keys/sockets outside the renderer; disk-token protection and protocol parsing stay with their existing owners, no new exposure.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05

## Revisions

2026-10-05: reuse the existing `.button-small` shared shape with a local outlined treatment. Figma Background maps to `--color-surface`, the existing dark scheme token (#101418); there is no separate background token. The integrated capture uses the harness's documented `PYRY_E2E_SHOW_WINDOW=1` on Linux's virtual display because hidden Linux windows do not produce screenshot frames. These choices retain the planned behavior and geometry.
