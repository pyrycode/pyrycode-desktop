# #1579 — Ask for fresh MCP status when the channel info sheet opens

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ConversationScreen` (`channelInfoOpen`, the `ThreadOverflowMenu` `onChannelInfo` handler, which is the only place the sheet is opened) and `ChannelInfoSheet` (mounted only while open, with the `mcpServersSection` slot built from the same `activeConversation`). The trigger goes into the open handler.
- `src/renderer/src/screens/conversation/McpServersSection.tsx` → `McpServersSectionView` (pure view of `report` + `showBuiltIn`) and `McpServersSection` (store-bound container). The notice renders here, and the request helper lives beside it.
- `src/renderer/src/screens/conversation/requestContextUsage.ts` → `requestContextUsage`. This is the one-line `(sendCommand, conversationId)` helper shape the new helper copies.
- `src/renderer/src/store/mcpStatusStore.ts` → `createMcpStatusStore`, `selectMcpStatusFor`. Reports are keyed by conversation id only. The unavailable mark is added here.
- `src/renderer/src/store/mcpStatusBridge.ts` → `subscribeMcpStatus`, `McpStatusData` (the app-lifetime subscription). It gains the refusal arm.
- `src/shared/ipc/events.ts` → the `mcpStatusRequestRejected` arm and `MCPStatusRequestFailure` (`'mcp-status-unavailable' | 'unclassified'`). `conversationId` is the id this app asked about, not a daemon-echoed one.
- `src/shared/ipc/commands.ts` → the `requestMcpStatus` command (`payload: { conversation_id }`).
- `src/renderer/src/PairedShell.tsx` → `requestConversationConfig` (the activation-time batch, a neighbour and not the place for this request) and `clearMcpStatus` in the pairing-scoped clear.
- `e2e/fixtures/conversationStateFake.ts` → `conversationStateFake`, `ConversationStateFake` (callable-with-property seams), `errorFrame`. It learns to answer `mcp_status_request`.
- `e2e/channel-mcp-servers.spec.ts`: the shipped spec pushes unsolicited reports and must keep passing. The fake stays silent unless a spec configures an answer.
- `e2e/real-claude-system-prompt.spec.ts` → `pairAndConnect`, `createChat`, `takeTurn`, `openChannelInfo`. This is the real-tier analogue whose helpers the new spec copies.
- `e2e/fixtures/realDaemon.ts` → `RealDaemonOptions.skipPermissions` / `interactiveRunner`. `skipPermissions: false` drops `--dangerously-skip-permissions`, so the child is non-bypass and the daemon spawns it with its strict MCP config.
- pyrycode `docs/protocol-mobile.md` § `mcp_status` and § Asking for MCP status on demand. Only a daemon-configured strict child is queried. `mcp_status.unavailable` covers "no bound session, no live eligible child". No reject sends an empty or stale report, and the on-demand answer is requester-only.
- `docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state: read for the documentation handoff only.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

The Channel info sheet is a column of sections, each a small muted section header (`.status-sheet__section-header`) over label/value rows. Muted secondary lines such as the Memory row's "None" use the same muted text. The refresh itself draws nothing. The unavailable notice is one more muted paragraph in the MCP servers section using the shipped `channel-info__empty` class, the same one the section's "No MCP report has arrived yet." line uses. There is no new colour, icon or layout.

## Context

#1490 renders the last `mcp_status` that arrived, which can be an hour old or absent. #1578 shipped the `requestMcpStatus` command and the correlated `mcpStatusRequestRejected` event, and neither has a consumer in the window yet. This slice sends the request each time the sheet opens, shows a client-owned notice on an unavailable refusal, and adds the family's first real-claude MCP spec.

## Design

### Trigger: the open handler, not an effect

`onChannelInfo` in `ConversationScreen` becomes: open the sheet, then `requestMcpStatus(window.pyry.sendCommand, activeConversation?.id ?? null)`. An event handler fires exactly once per user open. A mount `useEffect` would fire twice under the renderer's `React.StrictMode` in dev. The sheet reads the same `activeConversation`, so the request names the conversation whose section is shown. When the id is null the sheet has no MCP section and nothing is sent.

- `export function requestMcpStatus(sendCommand, conversationId: string | null): void` in `McpServersSection.tsx`. It has the `requestContextUsage` shape: a falsy id sends nothing, and otherwise it sends one `{ type: 'requestMcpStatus', payload: { conversation_id } }`. Connectivity, routing and diagnostics are main's (#1578).

### State: an unavailable mark beside the reports

`mcpStatusStore` gains `unavailable: ReadonlySet<string>` (conversation ids) and one action:

- `markMcpStatusUnavailable(conversationId)` adds the id. `reports` is **not** touched, so held rows stay on screen.
- `setMcpStatus` (any report, live or answered) removes that conversation's id. This is how "a later report replaces it".
- `clearMcpStatus` empties both. Pairing-scoped clearing stays one call.
- `selectMcpStatusUnavailableFor(conversationId: string | null) => (state) => boolean`: `false` for null.

`subscribeMcpStatus(onDaemonEvent, record, markUnavailable)` gains an arm: on `mcpStatusRequestRejected` with `reason === 'mcp-status-unavailable'` it calls `markUnavailable(event.conversationId)`. `'unclassified'` is ignored, so nothing changes on screen. `McpStatusData` passes the store's `markMcpStatusUnavailable`.

The mark is not cleared when a new request is sent. A reopen that is answered with a report clears it, and a reopen that is refused again keeps it, which is correct. The daemon always answers, so a mark cannot go permanently stale while connected.

### View

`McpServersSectionView` gains `unavailable: boolean`. When true, it renders one `<p className="channel-info__empty">` with the client-owned constant `MCP_STATUS_UNAVAILABLE` ("The daemon could not report MCP status right now.") as the section's last line. This happens in both the no-report branch and the rows branch, and rows, toggle and other lines are unchanged. The container reads `selectMcpStatusUnavailableFor(conversationId)`, a boolean selector, so re-render happens only on a flip. No daemon text reaches the notice: the event carries only a reason literal and the app's own id.

## State + concurrency model

- The renderer adds no async work. The send is fire-and-forget over the typed IPC channel, which returns void. There is no timer and no retry, even though `mcp_status.unavailable` is retryable. A retry would be a later decision.
- The bridge subscription is already app-lifetime (`McpStatusData` in `App.tsx`) with an unsubscribe cleanup. The refusal arm rides it, so a refusal that lands after the sheet closed is still recorded.
- An answer that races a close lands in the store and renders on the next open. That open re-requests anyway.

## Error handling

| Case | Result |
|---|---|
| Sheet opened with no active conversation | no section, no request |
| Host offline / unrouted | main refuses silently (#1578); section shows what it holds |
| `mcpStatusRequestRejected` / `mcp-status-unavailable` for the shown conversation | notice appended; rows kept |
| Same refusal for another conversation | that conversation's mark only; shown section unchanged |
| `mcpStatusRequestRejected` / `unclassified` | ignored |
| Later `mcp_status` for the conversation | report replaced, mark cleared |
| No answer | nothing changes |

## Testing strategy

**Unit (vitest, static render):**
- `mcpStatusStore.test.ts`:
  - A mark keeps an existing report object identical and isolates conversations (including `__proto__`).
  - A report clears only its own conversation's mark.
  - `clearMcpStatus` clears marks.
  - The null selector returns false.
  - The bridge marks on `mcp-status-unavailable`, ignores `unclassified` and ignores other events.
- `McpServersSection.test.tsx`:
  - The notice renders with rows still present.
  - The notice renders with no report, beside the no-report line.
  - There is no notice when `unavailable` is false.
  - `requestMcpStatus` sends one command naming the id, and nothing for null or `''`.

**Fake-transport Playwright** (`e2e/channel-mcp-status-request.spec.ts`, new):
- `conversationStateFake` gains an option and two seams:
  - `mcpStatusAnswers?: Record<string, McpStatusAnswer>` where `McpStatusAnswer = MCPStatusPayload | 'unavailable' | 'unclassified'`.
  - `setMcpStatusAnswer(conversationId, answer | null)`.
  - `mcpStatusRequests(): readonly string[]` (the conversation ids asked, in order).
  - An answer is a correlated `mcp_status` (`in_reply_to` = request id) or a correlated `error` (`mcp_status.unavailable`, retryable true / `conversation.not_found`).
  - With no configured answer the fake records the request and replies nothing. That keeps `channel-mcp-servers.spec.ts` byte-for-byte unaffected.
- One drive:
  - Open → exactly one request naming the seed, and the answered rows render.
  - Change the answer and reopen → a second request, and the new rows replace the old.
  - Answer `unclassified` and reopen → a third request. Behind a delivery barrier (a pushed list frame renaming a sidebar row), the rows are unchanged and there is no notice.
  - Answer `unavailable` and reopen → the notice appears and the rows stay.
  - Switch to a second conversation (silent) and open → no notice there.
  - Switch back and open with the sheet held open → push an unsolicited report → the notice goes and the new rows show.
  - Each count assertion is followed by a barrier, so "exactly one" is not only "at least one".

**Real-claude** (`e2e/real-claude-mcp.spec.ts`, new; `skipPermissions: false`, `interactiveRunner: 'stream-json'`):
- Pair, create a chat, take one plain turn so a non-bypass child spawns.
- Open Channel info and wait for the MCP servers section.
- Tick Show built-in, then assert `pyry_approve` and `pyry_files` rows.
- It asserts names only. Statuses and errors are claude's open-set text and are not asserted.
- The spec header records the floor-bump debt.

## Open questions

- Whether also to assert the live unavailable notice on a fresh chat before its first turn, when there is no live child. It would prove the request reaches the daemon independently of the spawn-time publication. **Resolved:** not asserted. It is outside AC3, and it would bind the gate to the daemon's eviction timing. The rows arriving after the sheet's request, plus the fake tier's count, carry the proof.

## Documentation handoff

Pending for the documentation stage:

- `docs/knowledge/features/live-e2e-runbook.md` § Current real-claude gate state must record that the real tier gained `e2e/real-claude-mcp.spec.ts`, which is one more executed spec.
- It must also say that the gate's executed-count floor, which lives in the dispatcher configuration and not in this repo, is owed a matching operator bump.
- Read the current floor and tier count from that section when writing it.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. Two inputs reach new code:
  - **The refusal event.** It crosses main → renderer as `mcpStatusRequestRejected`. main's `pendingMcpStatusRequests` correlation (#1578) already fixes its `conversationId` to an id this app sent, and its `reason` to a closed two-literal union. The renderer uses `conversationId` only as a `Set` key (a `Set`, so `__proto__` is inert, and the test covers it) and `reason` only in an `===` comparison.
  - **The report path.** It is unchanged (`setMcpStatus`, #1490).
  - The outbound request carries only the active conversation's id. main re-validates it (`isRendererCommand`) and routes it.
- [Tokens] No findings. No credential is created, read, carried or logged. The renderer logs nothing new.
- [File / storage] No findings. State is in-memory Zustand only and is cleared with pairing-scoped state through `clearMcpStatus`. Nothing touches disk or web storage.
- [Electron attack surface] No findings. No new IPC channel, bridge API or `webPreferences` change. The command rides the existing typed `sendCommand`. A compromised renderer could already send this command in a loop, and #1578's 32-entry pending cap bounds main's cost.
- [Crypto] No findings. No primitive is touched.
- [Network & I/O] No findings. There is one request per user open and no retry on refusal or silence, so a hostile or silent daemon cannot induce a request loop from the window.
- [Logs / UI text] No findings. The notice is a client-owned constant, and no daemon code or message reaches the window, which holds none. Server row strings keep #1490's escaped, bounded React-text rendering. The real spec asserts built-in names by exact match against client constants and prints no row text.
- [Concurrency] No findings. There is no async work in the renderer, and the subscription has its existing cleanup. A late answer only updates the store.
- [Threat model] OUT OF SCOPE: a hostile daemon can already publish arbitrary `mcp_status` for any conversation (#1490's live path) and can refuse every request. The worst outcome is a stale or empty list plus a notice, all inert text. Per-device gating of MCP actuation is #1492's.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
