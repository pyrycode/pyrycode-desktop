# #1494 — a failed MCP server raises the status row's error slot

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerErrorSlot` (the precedence chain the notice joins), `ComposerErrorSlotControl` (the store-bound container that builds each occupant), `ConversationScreen`'s `onChannelInfo` handler (open + `requestMcpStatus`, the action the notice reuses), `toolWorkingCopy` (the one-hole copy shape).
- `src/renderer/src/store/mcpStatusStore.ts` → `createMcpStatusStore`, `setMcpStatus`, `clearMcpStatus`, `selectMcpStatusFor` — per-conversation reports; a server `name` is never a key.
- `src/renderer/src/screens/conversation/McpServersSection.tsx` → `toneOf` (the `failed` classification to share), `bounded` (the 256-code-point display bound), `MCP_BUILT_IN_SERVER_NAMES` (display-only; does not filter this notice).
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps.clearMcpStatus` — the pairing-scoped reset already clears this store, so acknowledgements held in it clear with it for free.
- `src/renderer/src/screens/conversation/historyRetry.test.tsx` → the occupant-matrix test pattern for `ComposerErrorSlot`.
- `src/renderer/src/screens/conversation/conversation.css` → `.button-small`, `.button-small--error` (the #963 treatment this reuses; `white-space: nowrap` means a long label widens the button unless capped).
- `e2e/channel-mcp-servers.spec.ts` → how a fake `mcp_status` frame is pushed and the sheet opened.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The Input area: the 32-tall status row above the message box, with its trailing slot holding a single `Button small` in the Error type (dark red fill `--color-on-error`, `--color-error` text, radius xs, body-small emphasized) — drawn with "Pairing error - Re-pair". This slice fills the same slot with the same treatment (`button-small button-small--error`) and different copy. No new control shape, no geometry change.

## Context

Reports reach `mcpStatusStore` for the app's lifetime, sheet open or not, but only the Channel info sheet shows them. A server that fails at spawn is invisible unless the operator opens the sheet. This slice surfaces an unacknowledged `failed` server in the status row's trailing slot, after the history failure and ahead of the task count.

## Design

1. **Shared classification** (`mcpStatusStore.ts`): export `isMcpServerFailed(status: string): boolean` — exactly `status === 'failed'`. `toneOf` in `McpServersSection.tsx` uses it for its failed arm, so the sheet and the row cannot disagree. It lives in the store module rather than the section because the store's selector needs it and the section already imports the store (no import cycle).
2. **Acknowledgement state** (`mcpStatusStore.ts`): a new `acknowledgedFailures: ReadonlyMap<string, ReadonlySet<string>>` keyed by conversation id, whose values are sets of server names held **for equality only** (never a key, attribute, log or path).
   - `acknowledgeMcpFailures(conversationId)` adds every name the conversation's held report shows as failed. No report or no failures → no state change.
   - `setMcpStatus` does not touch it: acknowledgements last for the app run per conversation.
   - `clearMcpStatus` empties it (the pairing-scoped reset).
   - `selectUnacknowledgedMcpFailureFor(conversationId: string | null) => (state) => string | null` — the first server in report order whose status is failed and whose name is not acknowledged for that conversation; `null` otherwise. Returns a primitive, so a fresh selector per render never loops. A server that stops reading `failed` drops out simply because the selector reads only the latest report.
3. **Copy** (`ConversationScreen.tsx`): `mcpFailedCopy(name: string): string` → `MCP server ${name} failed`, beside `toolWorkingCopy`, apostrophe-free, one hole, name verbatim (React escapes).
4. **View** (`ConversationScreen.tsx`): `ComposerMcpFailure({ name, onOpen })` → one `<button type="button" className="button-small button-small--error composer-status__mcp-failure">` whose only child is `mcpFailedCopy(bounded(name))`. The name reaches the DOM only as that escaped text run. `bounded` is exported from `McpServersSection.tsx` as `boundMcpText` so both surfaces bound identically.
5. **Chain**: `ComposerErrorSlot` gains an optional `mcpFailure?: JSX.Element | null` prop; the connected arm becomes `recovery ?? refusal ?? notice ?? history ?? mcpFailure ?? taskCount ?? null`.
6. **Container**: `ComposerErrorSlotControl` reads `selectUnacknowledgedMcpFailureFor(open?.id ?? null)` via `useMcpStatusStore` (hoisted constant selector for the no-conversation arm, the `NO_TASK_COUNT` idiom) and passes `mcpFailure={name === null ? null : <ComposerMcpFailure … />}` — actual `null` when absent. Its new `onOpenChannelInfo: () => void` prop is called after `acknowledgeMcpFailures(open.id)` on press.
7. **Open action**: `ConversationScreen` hoists its overflow-menu handler into one `openChannelInfo` closure (set open + `requestMcpStatus`), passed to both `ThreadOverflowMenu.onChannelInfo` and the control — the same action, including the status refresh.
8. **CSS** (`conversation.css`): `.composer-status__mcp-failure { max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; }` so a long name truncates on one line and the row keeps its 32px height; the slot's width is capped rather than growing.

## State + concurrency model

One new store slice (`acknowledgedFailures`) in the existing `mcpStatusStore`; no new async work, no new IPC, no subscription beyond one more narrow `useMcpStatusStore` read in `ComposerErrorSlotControl`. The press is synchronous: acknowledge, then open (which sends the one existing `requestMcpStatus`).

## Error handling

No new failure modes. A missing report or conversation yields `null` (no notice). Unknown status words are not failures. Nothing is logged; the name never reaches a log.

## Testing strategy

- **vitest, `mcpStatusStore.test.ts`**: `isMcpServerFailed` is true only for `failed` (not `pending`, `needs-auth`, `disabled`, `Failed`, unknown); selector returns the first unacknowledged failed name in report order, including built-in names; acknowledge covers every current failure; a later report repeating it stays silent; a newly failing server raises; a server no longer failed stops showing; per-conversation isolation (including `__proto__`); `clearMcpStatus` clears acknowledgements; no report → acknowledge is a no-op.
- **vitest, new `mcpFailureNotice.test.tsx`** (static render, `historyRetry.test.tsx` pattern): the copy has one hole and no apostrophe; the button is `button-small button-small--error`, escapes a markup-shaped name, bounds a long name at 256 code points; `ComposerErrorSlot` matrix — each of recovery/refusal/notice/history outranks it, it outranks taskCount, and it never shows while disconnected, connecting, error, or with Re-pair/Reconnect.
- **Playwright, new `e2e/composer-mcp-failure.spec.ts`**: a pushed report with a failed server raises the button naming it; pressing it opens the Channel info sheet and sends `request_mcp_status`; after closing, a repeated report does not re-raise; a report naming a new failed server raises that one. Plus a screenshot of the row for visual review.

## Open questions

- Should a server that recovers and later fails again re-raise? The AC says acknowledgements last for the app run per conversation, so no; resolved as specified.

## Documentation handoff

Pending for the documentation stage: fold the MCP failure occupant into the status row's precedence chain in `docs/knowledge/features/conversation-shell.md` (the trailing-slot chain) and note the acknowledgement state in the MCP section of the channel-info overview.
