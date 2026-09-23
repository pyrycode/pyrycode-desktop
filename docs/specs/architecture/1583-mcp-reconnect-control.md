# #1583 — Reconnect a failed MCP server from the channel info sheet

## Files read

- `src/renderer/src/screens/conversation/McpServersSection.tsx` → `McpServersSectionView`, `McpServersSection`, `toneOf`, `requestMcpStatus` — the section this ticket adds the control to; already a pure function of held state, rows keyed by position.
- `src/renderer/src/store/mcpStatusStore.ts` → `createMcpStatusStore`, `setMcpStatus`, `markMcpStatusUnavailable`, `clearMcpStatus`, the selectors — the app-lifetime store the wait and the refusal mark join.
- `src/renderer/src/store/mcpStatusBridge.ts` → `subscribeMcpStatus`, `McpStatusData` — the app-lifetime daemon-event subscription that must also route `mcpReconnectRejected`.
- `src/shared/ipc/commands.ts` → the `reconnectMcpServer` arm (`MCPReconnectPayload`) — shipped by #1582, unchanged here.
- `src/shared/ipc/events.ts` → the `mcpReconnectRejected` arm — carries only `conversationId`, no reason.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the Channel info sheet mount (`channelInfoOpen`, `onChannelInfo`) — the sheet unmounts its body on close, which is what lets an unmount cleanup end the wait. Unchanged.
- `src/renderer/src/screens/conversation/conversation.css` → `.button-small`, `.question-panel__cancel` (the outlined Secondary treatment and its `:disabled` state), the `.channel-info__mcp-*` block.
- `src/renderer/src/clearPairingScopedState.ts` → `clearMcpStatus` dep — unpair already clears the store; the new sets clear through the same action.
- `e2e/channel-mcp-status-request.spec.ts`, `e2e/fixtures/conversationStateFake.ts` → `mcpStatusAnswers`, `setMcpStatusAnswer`, `mcpStatusRequests` — the fake-answer pattern the reconnect answers mirror.
- `e2e/real-claude-mcp.spec.ts` — the real spec this ticket extends (the file's header already reserves it for the Reconnect drive).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

The sheet (node 20-48) draws label-left / value-right rows and no per-row action. The Reconnect control is the shipped `button-small` shape in the set's neutral variant, `State=Default, Type=Secondary` (347:6686): outlined, 1px `--color-primary` border, `--color-surface` fill, `--color-primary` text at body-small emphasized, 7px × 16px padding, `--radius-xs` — the treatment `.question-panel__cancel` already carries. It sits at the end of the row's value slot, after the status dot and word; disabled, it takes the muted ink `.question-panel__cancel:disabled` uses.

## Context

#1582 shipped the command and the refusal event; nothing sends or consumes them. This slice adds the control, the wait and the refusal notice. No ADR needed.

## Design

### Store (`mcpStatusStore.ts`)

Two more conversation-keyed sets beside `unavailable`, never keyed by a server name:

- `reconnecting: ReadonlySet<string>` — conversations with an outstanding reconnect.
- `reconnectRefused: ReadonlySet<string>` — conversations whose latest reconnect was refused.

Actions:

- `beginMcpReconnect(conversationId)` — adds to `reconnecting`.
- `endMcpReconnectWait(conversationId)` — removes from `reconnecting` only (sheet close).
- `markMcpReconnectRefused(conversationId)` — removes from `reconnecting`, adds to `reconnectRefused`. Held `reports` untouched.
- `setMcpStatus` — additionally removes the conversation from both sets (any report ends the wait and lifts the notice, whatever the rows read, `pending` included).
- `clearMcpStatus` — also empties both sets.

Selectors `selectMcpReconnectingFor(id)` and `selectMcpReconnectRefusedFor(id)`, shaped like `selectMcpStatusUnavailableFor`. Every action returns `{}` when it would not change the set, as `markMcpStatusUnavailable` does.

### Bridge (`mcpStatusBridge.ts`)

`subscribeMcpStatus` gains a fourth parameter `markReconnectRefused: (conversationId: string) => void`, called on `mcpReconnectRejected`. `McpStatusData` passes the store's `markMcpReconnectRefused`. Mounted for the app lifetime, so a refusal that lands with the sheet closed is still recorded.

### Section (`McpServersSection.tsx`)

`McpServersSectionView` gains props `reconnecting: boolean`, `reconnectRefused: boolean`, `onReconnect: (serverName: string) => void`.

- A row whose `toneOf(status)` is not `'connected'` renders `<button type="button" className="button-small channel-info__mcp-reconnect" disabled={reconnecting}>Reconnect</button>` inside the value slot. The accessible name is the constant "Reconnect"; the server name never reaches an attribute.
- `reconnectRefused` appends a client-owned notice, `MCP_RECONNECT_REFUSED = 'The daemon refused to reconnect the MCP server.'`, after the rows, beside the unavailable notice, in the same `channel-info__empty` paragraph class. Rendered in the no-report branch too.
- `onReconnect(server.name)` hands the untrusted name through unchanged.

New exported helper `reconnectMcpServer(sendCommand, begin, conversationId, serverName)`: calls `begin(conversationId)` then sends one `{ type: 'reconnectMcpServer', payload: { conversation_id, server_name } }`. Unit-tested with fakes, as `requestMcpStatus` is.

`McpServersSection` (container) reads the two new selectors, wires `onReconnect` to the helper with `window.pyry.sendCommand` and the store's `beginMcpReconnect`, and holds `useEffect(() => () => endMcpReconnectWait(conversationId), [conversationId])` — the sheet unmounts on close, so close ends the wait and a reopen starts clean; a conversation switch under an open sheet ends the previous conversation's wait too. The effect body does nothing on mount, so StrictMode's double mount is harmless.

The press guard is the `disabled` attribute: while `reconnecting`, every Reconnect in that conversation's section is disabled, so a second press cannot send.

### CSS (`conversation.css`)

`.channel-info__mcp-reconnect` and its `:disabled` rule in the MCP block, the Secondary treatment by token name (padding `7px var(--space-4)`, `1px solid var(--color-primary)`, `--color-surface`, `--color-primary`; disabled: `--color-on-surface-variant` border and ink, `not-allowed`).

## State + concurrency model

No async work in the renderer: the press is a fire-and-forget IPC send (main owns correlation and logging, #1582). The wait lives in the store and ends on exactly three events: a report for the conversation (`setMcpStatus`), a refusal (`markMcpReconnectRefused`), or the section unmounting / switching conversation (`endMcpReconnectWait`). Unpair clears everything through `clearMcpStatus`.

## Error handling

The only failure is the merged refusal; it re-enables the controls, keeps the rows, and shows a notice that names no cause. No daemon text crosses (the event has none). Nothing is logged in the renderer; main already logs the send and the refusal content-free.

## Testing strategy

- **vitest, `mcpStatusStore.test.ts`:** begin/end/refuse/report transitions per conversation, isolation between conversations (including `__proto__`), report ends wait and lifts notice while refusal keeps held report identity, `clearMcpStatus` empties both, bridge routes `mcpReconnectRejected` to the mark.
- **vitest, `McpServersSection.test.tsx`:** Reconnect rendered for `failed` / `pending` / other words and not for `connected`; disabled while `reconnecting`; refused notice rendered (with and without a report) and absent otherwise; the name never appears in an attribute; `reconnectMcpServer` sends one command naming conversation and name, after calling `begin`.
- **Playwright fake tier, new `e2e/channel-mcp-reconnect.spec.ts`:** the fake gains `mcpReconnectAnswers` / `setMcpReconnectAnswer` / `mcpReconnectRequests` (answer is a correlated `mcp_status` payload, `'refused'` for a correlated error, absent for silence). Drive: a `failed` row shows Reconnect, a `connected` row none; press → exactly one recorded request with the conversation and name, controls disabled while silent; close + reopen re-enables; press with a `pending` answer → rows re-render from it; press with `'refused'` → notice shows, rows held, controls enabled; the next report lifts the notice.
- **Real tier, `e2e/real-claude-mcp.spec.ts`:** a second drive in the same test after the built-in rows show: `window.pyry.sendCommand({ type: 'reconnectMcpServer', ... 'pyry_files' })` from the page, then wait for exactly one of (a) the refused notice or (b) a fresh report — detected by the sheet re-rendering (a DOM marker captured before the send, then observed replaced). Record `test.info().annotations.push({ type: 'mcp-reconnect-outcome', description: 'report' | 'refused' })`.

## Open questions

1. How the real drive tells a fresh report from the held one when the rows are identical. Candidate: tag the sheet's server rows via `evaluate` before sending (a data attribute set from the page); React replaces the row elements only if the key changes, which it will not (position keys), so a DOM tag survives a re-render. Fallback: subscribe to `window.pyry.onDaemonEvent` from the page before sending and record the first `mcpStatus`/`mcpReconnectRejected` for the conversation. Resolve during implementation.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: fold the reconnect control into `docs/knowledge/features/` MCP section coverage as it sees fit.

## Security review

Run after the plan's first commit rather than before it. The ticket carries `security-sensitive` and the pass was missed on that commit. It is added here, in its own commit, before any implementation code. The plan body did not change.

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The row `name` is untrusted claude text and is handed through the `onReconnect` closure into the command unchanged, which is the daemon's contract. It is never a React key (rows stay position-keyed), a store key (the sets are keyed by the daemon's conversation routing id only), an attribute or a log field. The button's accessible name is the constant "Reconnect". The renderer→main boundary is #1582's `isMCPReconnectPayload` guard in `isRendererCommand`, unchanged. The `status` word only picks the closed tone through `toneOf`. A hostile claude can make any row offer Reconnect. The worst that follows is one operator-initiated `mcp_reconnect` naming a server claude chose, which the daemon authorizes before acting.
- [Tokens] No findings. No token, key or credential is touched. The renderer holds only a conversation id and a server name.
- [File / storage] No findings. Nothing is persisted. The store is in-memory, and unpair clears it through the existing `clearMcpStatus`, which also empties the two new sets.
- [Electron attack surface] No findings. No new IPC channel, bridge method or window. The press uses the existing `window.pyry.sendCommand` and the existing validated `reconnectMcpServer` arm. The real spec calls the same bridge from the page, as the other `real-claude-*` specs already do.
- [Crypto] Not applicable. There is no cryptographic work in this slice. The transport is main's and unchanged.
- [Network & I/O] SHOULD FIX, satisfied by the design. `reconnectMcpServer` in `DaemonConnection` is inert on an unavailable connection or a failed send, so no answer and no refusal may ever come. The wait must therefore not depend on either of them. Closing the sheet (the section's unmount cleanup calling `endMcpReconnectWait`) and switching conversation both end it. The verifier should check that the cleanup exists and that the fake spec proves close and reopen re-enable the control against a silent fake.
- [Errors / logs] No findings. The refusal notice is a client-owned constant, and `mcpReconnectRejected` carries no daemon text to leak. The renderer logs nothing. Main's send and refusal logging is #1582's and content-free.
- [Concurrency] OUT OF SCOPE, benign. After a wait ends by close, a second press can overlap a late answer to the first. That answer, whether a report or a refusal, ends the second wait early. Every send is operator-initiated and the daemon stays the authority, so the only effect is an early re-enable. Per-request correlation in the renderer is not built. Main already correlates each refusal to its conversation, and nothing here needs finer grain.
- [Threat model] No findings. A hostile or buggy daemon can send `mcp_status` at any time, which ends a wait and lifts the notice. The AC requires that behaviour for any report. It cannot forge a refusal for a conversation this app did not ask about, because main emits `mcpReconnectRejected` only for its recorded send.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23

## Revisions

### 2026-09-23 — Open question 1 resolved: the real drive observes daemon events

The real drive uses the plan's fallback. It does not use the DOM tag. A page-side `window.pyry.onDaemonEvent` observer (`watchMcp`) records only the conversation id of each `mcpStatus` and `mcpReconnectRejected`, and never a row string. It is installed right after pairing. Before sending, the drive waits for one report beyond the count taken before the sheet opened, so the sheet-open ask's answer cannot be read as the reconnect's. The outcome is whichever arrives next: a further report or a refusal naming the conversation. It is then checked on screen (the notice is shown or absent, and the built-in rows are still visible) and recorded as the `mcp-reconnect-outcome` annotation. A DOM tag would have depended on React reusing row elements across a re-render, which is an implementation detail, while the event is the contract. The design is otherwise unchanged.
