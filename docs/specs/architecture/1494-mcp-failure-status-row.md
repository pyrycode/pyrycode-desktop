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

## Revisions

- 2026-09-23, during build: the Playwright spec also asserts the long-name geometry at the 800px minimum window (row stays 32px tall and its width unchanged, the button stays inside it), because "a long name does not grow the row" is a layout claim static markup cannot prove. At that width the ellipsis cuts the trailing "failed" of a 300-character name; the escaped, bounded name is still the only daemon text shown.
- 2026-09-23, during build: Design §8's rule is `flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis`, the `.composer-status__tasks` treatment, instead of `max-width: 100%`. The occupant is a direct flex child of `.composer-status`, and `.button-small`'s `flex: 0 0 auto` would refuse to shrink regardless of a max-width; letting it shrink is what keeps the row's width.
- 2026-09-23, rework after the verifier's FAIL on PR #1590: the ticket is `security-sensitive` and the plan had no `## Security review`. The pass below was run against the design and the shipped code in `mcpStatusStore.ts`, `ConversationScreen.tsx`, `McpServersSection.tsx` and `conversation.css`. It raised no MUST FIX and changed no production code. It adds one assertion to the acknowledgement isolation test in `mcpStatusStore.test.ts`: prototype-shaped server names (`__proto__`, `constructor`, `toString`) are compared as values, so acknowledging one silences only that exact name.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. There is one untrusted input: the claude-authored server `name` and `status` strings in an `mcp_status` report. `parseMCPStatusPayload` in the main process validates them, the renderer receives them already typed over IPC, and `setMcpStatus` holds them. This slice adds no new boundary. The only new decision made on claude text is `isMcpServerFailed`, which is an exact `=== 'failed'` comparison. A case variant, padded word or unknown word is not a failure. The sheet's `toneOf` calls the same function, so the two surfaces cannot classify a row differently. `conversation_id` is a daemon routing key used only as a `Map` key, never as an authorization signal.
- [Untrusted text in the DOM] No findings. The name reaches the page only as the single text child of the button in `ComposerMcpFailure`: `mcpFailedCopy(boundMcpText(name))`. React escapes it; the unit spec renders a markup-shaped name and asserts it comes out escaped. The name is never in `className`, `key`, `id`, an `aria-*` attribute, a URL, a filename or `innerHTML`. The class list is a client-owned constant and the button's accessible name is its visible text. `boundMcpText` is the sheet's own 256-code-point bound, shared rather than copied, and it cuts on code points so it never splits a surrogate pair. `mcpFailedCopy` is client-owned, apostrophe-free and has one hole. It never pre-escapes, so nothing is double-encoded. The CSS keeps the label on one line (`nowrap` from `.button-small`, ellipsis from `.composer-status__mcp-failure`), so an embedded newline or a long name cannot change the row's height or width. The Playwright spec checks this at the 800px minimum window.
- [Untrusted text as state] No findings. Acknowledged names sit in `acknowledgedFailures`, a `Map` keyed by conversation id whose values are `Set`s of names, and they are only ever compared with `Set.has`. A name is never an object key, a lookup path, a cache key or a log field. A `__proto__` or `constructor` conversation id is an ordinary `Map` key; the unit spec checks that acknowledging `a` leaves those conversations raised. After this rework it also checks that a prototype-shaped server name is compared as a value and silences only itself. Acknowledgement compares the full raw name and display uses the bounded one. So two names that share their first 256 code points look the same in the row but are acknowledged separately. That can only raise an extra notice; it can never hide one.
- [Growth / resource use] No findings. Each press adds at most the failed rows of the one report already held in `reports`. The daemon caps that report's size, and the renderer already holds the whole report. Names are added only when the operator presses, never when a frame arrives, so a flood of reports cannot grow the set on its own. The set lasts for the app run and `clearMcpStatus` empties it with the pairing-scoped reset. The selector returns a primitive and the no-conversation arm uses the hoisted `NO_MCP_FAILURE`, so a report flood cannot cause a render loop.
- [Electron / IPC surface] No findings. No channel, preload bridge or handler is added, and the renderer gains no new capability. Pressing the button sends only the existing `request_mcp_status` command, through the same `openChannelInfo` closure the overflow menu uses, carrying only the open conversation's id. No server name crosses IPC. The action behind the button is fixed and client-owned, so whatever a name says, pressing it only opens the sheet.
- [Tokens, secrets, crypto, files, network] No findings. The slice reads and writes no token, key, file or socket, and does no crypto. It lives entirely in the renderer store and view.
- [Logs / telemetry] No findings. Nothing new is logged in either process. The name, the status and the acknowledged set never reach a log, an error message or the console.
- [Concurrency] No findings. The press runs synchronously: `acknowledgeMcpFailures` runs, then `openChannelInfo`, with no `await` between them and no new async task, timer or subscription beyond one more `useMcpStatusStore` read. If a report lands between the render and the press, `acknowledgeMcpFailures` acknowledges what the store holds at press time. A newly failed server can be acknowledged without having been shown, but the sheet the press opens shows it with its failed tone.
- [Threat model: display spoofing] OUT OF SCOPE, accepted and not ticketed. A hostile or misconfigured MCP server could pick a name that uses bidi controls or confusable characters, or that reads like instructions, to make the row misleading. The Channel info sheet already renders the same name under the same bound, so this slice adds no new exposure. The fixed "MCP server … failed" framing and the fixed press action limit the damage to display. Filtering names is a sheet-wide decision to take across both surfaces if it is ever observed.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
