# #1587 — Turn an MCP server off and on from the channel info sheet

## Files read

- `src/renderer/src/screens/conversation/McpServersSection.tsx` → `McpServersSectionView`, `McpServersSection`, `reconnectMcpServer`, `toneOf` — the section and the Reconnect press this slice mirrors. Rows are position-keyed; the row name is untrusted and never an attribute.
- `src/renderer/src/store/mcpStatusStore.ts` → `createMcpStatusStore`, `setMcpStatus`, `beginMcpReconnect`, `endMcpReconnectWait`, `markMcpReconnectRefused`, `clearMcpStatus`, the `select…For` selectors — the conversation-keyed sets the toggle wait and its refusal join.
- `src/renderer/src/store/mcpStatusBridge.ts` → `subscribeMcpStatus`, `McpStatusData` — the app-lifetime subscription that becomes `mcpToggleRejected`'s consumer.
- `src/shared/ipc/commands.ts` → the `toggleMcpServer` arm (`MCPTogglePayload`: `conversation_id`, `server_name`, `enabled`) — #1586, unchanged.
- `src/shared/ipc/events.ts` → the `mcpToggleRejected` arm — `conversationId` only, no cause.
- `src/renderer/src/screens/settings/PushNotificationRow.tsx` → `PushNotificationRowView` — the switch to reuse: native `<button type="button" role="switch" aria-checked>` with an aria-hidden knob.
- `src/renderer/src/screens/settings/settings.css` → `.settings__switch`, `.settings__switch-knob`, `.settings__switch--on` — the Figma 17:67 geometry and tokens, cloned per screen by convention (that file's own comment: each screen owns its CSS).
- `src/renderer/src/screens/conversation/conversation.css` → the `.channel-info__mcp-*` block, and the `opacity: 0.38` M3 disabled-emphasis precedent in the same file.
- `e2e/channel-mcp-reconnect.spec.ts`, `e2e/fixtures/conversationStateFake.ts` → `mcpReconnectAnswers`, `setMcpReconnectAnswer`, `mcpReconnectRequests`, the `mcp_reconnect` arm — the fake-answer pattern the toggle answers mirror.
- `e2e/real-claude-mcp.spec.ts` → `watchMcp`, `readMcp`, the reconnect drive — the real test this ticket extends.
- `docs/specs/architecture/1583-mcp-reconnect-control.md` — the analogue; its Security review's Network finding (the wait must not depend on an answer) applies here unchanged.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

The sheet (20-48) draws label-left / value-right rows. The file draws no MCP row, so the switch is the one Settings already ships (17:67): a 52×32 fully rounded track, off = `--color-surface-container-highest` fill with a 2px `--color-outline` border and a 16px `--color-outline` knob at the left; on = `--color-primary` track and border with a 24px `--color-surface` knob at the right. It sits at the trailing end of each row's value slot, after the status word and any Reconnect button. Disabled takes the M3 disabled emphasis (`opacity: 0.38`, `not-allowed`), the precedent already in `conversation.css`.

## Context

#1586 shipped `toggleMcpServer` and `mcpToggleRejected`; nothing sends or consumes them. This slice adds the switch, the shared wait and the refusal notice. No ADR needed.

## Design

### Store (`mcpStatusStore.ts`)

Two more conversation-keyed sets beside the reconnect pair, never keyed by a server name:

- `toggling: ReadonlySet<string>` — conversations with an outstanding toggle.
- `toggleRefused: ReadonlySet<string>` — conversations whose latest toggle was refused.

Actions, each the exact shape of its reconnect twin:

- `beginMcpToggle(conversationId)`, `endMcpToggleWait(conversationId)`, `markMcpToggleRefused(conversationId)` (removes from `toggling`, adds to `toggleRefused`, `reports` untouched).
- `setMcpStatus` additionally removes the conversation from both new sets. `clearMcpStatus` empties them.

Selectors `selectMcpTogglingFor(id)`, `selectMcpToggleRefusedFor(id)`.

Separate sets rather than one merged "actuating" set: merging would rename the shipped reconnect symbols for no behavioural gain, and the two refusal notices must stay distinct anyway.

### Bridge (`mcpStatusBridge.ts`)

`subscribeMcpStatus` gains a fifth parameter `markToggleRefused`, called on `mcpToggleRejected`. `McpStatusData` passes the store's `markMcpToggleRefused`. Four call sites (the container and three tests).

### Section (`McpServersSection.tsx`)

`McpServersSectionView` gains props `toggling: boolean`, `toggleRefused: boolean`, `onToggle: (serverName: string, enabled: boolean) => void`.

- `isOn(status)`: `status !== 'disabled'` — the ticket's predicate, exact word, kept beside `toneOf`.
- Every row renders, last in its value slot, `<button type="button" role="switch" aria-checked={isOn} aria-labelledby={nameId} disabled={reconnecting || toggling} className="channel-info__mcp-switch[ --on]">` with an aria-hidden knob span. `onClick` calls `onToggle(server.name, !isOn(server.status))`.
- The name span gets `id={nameId}`, where `nameId` is `${useId()}-mcp-name-${index}` — derived from React's id and the row position, never the name. The accessible name is therefore the rendered (bounded) name, and no daemon string reaches an attribute.
- Reconnect's `disabled` becomes `reconnecting || toggling` too: one busy flag disables every control in the section.
- `toggleRefused` appends `MCP_TOGGLE_REFUSED = 'The daemon refused to change the MCP server.'` to the notice block, beside the reconnect refusal, in both branches.
- `aria-checked` reads the report only. There is no local state: the switch never leads the wire.

New exported helper `toggleMcpServer(sendCommand, beginWait, conversationId, serverName, enabled)`: `beginWait(conversationId)` then one `{ type: 'toggleMcpServer', payload: { conversation_id, server_name, enabled } }`.

`McpServersSection` reads the two new selectors, wires `onToggle` through the helper with `window.pyry.sendCommand` and `beginMcpToggle`, and its existing unmount cleanup also calls `endMcpToggleWait(conversationId)`, so closing the sheet ends the wait.

### CSS (`conversation.css`)

`.channel-info__mcp-switch`, `-knob`, `--on`, `:focus-visible` and `:disabled` in the MCP block, a clone of the `.settings__switch` rules by token name, plus the disabled emphasis.

## State + concurrency model

No renderer async work: a flip is one fire-and-forget IPC send; main owns correlation and logging. The toggle wait ends on a report for the conversation, a toggle refusal, or the section unmounting / switching conversation. The two waits cannot both be outstanding from this UI, since either one disables every control. Unpair clears everything through `clearMcpStatus`.

## Error handling

The only failure is the merged refusal. It re-enables the controls, keeps the rows and every switch as reported, and shows a notice that names no cause. Nothing is logged in the renderer.

## Testing strategy

- **vitest, `mcpStatusStore.test.ts`:** begin / end / refuse / report transitions for the toggle sets, per conversation; a report ends the wait and lifts the notice; a refusal keeps the held report; `clearMcpStatus` empties both; the bridge routes `mcpToggleRejected` to the toggle mark and not the reconnect mark (and vice versa).
- **vitest, `McpServersSection.test.tsx`:** a switch on every row, connected included; `aria-checked` false exactly for `disabled` (not `Disabled`, not `failed`); `aria-labelledby` resolves to the name span's id and neither contains the name; every switch and Reconnect disabled under `toggling`, and under `reconnecting`; the toggle-refused notice with and without a report; the daemon-strings-out-of-attributes test still holds with switches present; `toggleMcpServer` calls `begin` then sends one command with the requested state.
- **Playwright fake tier, new `e2e/channel-mcp-toggle.spec.ts`:** the fake gains `mcpToggleAnswers` / `setMcpToggleAnswer` / `mcpToggleRequests` on the `mcp_reconnect` pattern. Drive: switches reflect the report; flip `docs` off against silence → one request `{ docs, enabled: false }`, all switches and Reconnect disabled, the switch still reads on; close + reopen re-enables; flip with a report answer → the switch reads off from the answer; flip with `'refused'` → notice shows, switch unchanged, controls enabled; the next report lifts the notice.
- **Real tier, `e2e/real-claude-mcp.spec.ts`:** after the reconnect drive, `watchMcp` also records `mcpToggleRejected` ids and, per report, the `pyry_files` status word only. The drive clicks the `pyry_files` switch, waits for exactly one of a further report or a toggle refusal, records `mcp-toggle-outcome`, and on a report records `mcp-toggle-status-word` before asserting the switch reads off. On a refusal the notice shows and the switch still reads on. `pyry_approve` is never touched.

## Open questions

1. Whether claude's word for a server turned off is `disabled`. Only the real drive can say; the annotation is recorded before the assertion so a different word is visible even when the test fails. If it differs, the predicate is fixed from that evidence.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: fold the toggle switch, its wait and its refusal notice into the MCP section coverage under `docs/knowledge/features/`.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The row `name` is untrusted claude text. It is handed through `onToggle` into the command unchanged (the daemon's contract), and it is never a React key, a store key, an attribute or a log field. The switch is named by `aria-labelledby` pointing at an id built from `useId()` and the row index, so the name reaches the accessibility tree only as rendered text. The `status` word selects `aria-checked` and a closed class through `isOn` and is never copied anywhere else. The renderer→main boundary is #1586's `isMCPTogglePayload` guard in `isRendererCommand`, unchanged, which requires a genuine boolean `enabled`. A hostile claude can make any status read `disabled`. The worst outcome is that the operator is offered "turn on" for a server claude lied about, and pressing it sends one operator-initiated `mcp_toggle` that the daemon authorizes.
- [Tokens] No findings. No token, key or credential is touched.
- [File / storage] No findings. Nothing is persisted. The new sets are in memory and cleared by `clearMcpStatus` on unpair.
- [Electron attack surface] No findings. No new channel, bridge method or window. The press uses `window.pyry.sendCommand` and the existing validated arm.
- [Crypto] Not applicable. The slice does no cryptographic work.
- [Network & I/O] SHOULD FIX, satisfied by the design. `toggleMcpServer` in `DaemonConnection` is inert on an unavailable connection, so an answer may never come. The unmount cleanup calling `endMcpToggleWait` ends the wait, and the fake spec proves close + reopen re-enables against silence.
- [Errors / logs] No findings. The notice is a client-owned constant, the event carries no daemon text, and the renderer logs nothing. The real spec's status-word annotation is a test-report field requested by the ticket and bounded to one server's status word. It never holds a name, error or reply text.
- [Concurrency] OUT OF SCOPE, benign, as in #1583. A late answer to a toggle whose wait was ended by close can end a later wait early. Every send is operator-initiated and the daemon stays the authority.
- [Threat model] No findings. A hostile daemon can send `mcp_status` at any time, which ends the wait and re-renders the switches. That is the AC's behaviour for any report. It cannot forge a toggle refusal for a conversation this app did not act on, because main emits `mcpToggleRejected` only for its recorded send.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
