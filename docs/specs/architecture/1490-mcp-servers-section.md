# MCP servers in channel info

## Context and sizing

#1489 decodes `mcp_status` into `MCPStatusPayload` and the `mcp-status` inbound kind, and the list
stops in the background process. This ticket carries it to the window and draws it as a read-only
**MCP servers** section in the Channel info sheet. It follows #1241's session-facts path slice for slice.

One deliverable: the transport, retention and view have exactly one consumer between them. The floor
wins over the file ceiling, the same ruling #1241 made on this path. About 13 production files (one IPC
member, one main arm, four bridge ignore arms, a store, a bridge, App mount, PairedShell wiring, the
pairing clear, the sheet slot, the section component), plus CSS. About 500–650 written lines including
tests, e2e and this plan. Five acceptance criteria. New exports: the store, its data mount, the pure
section view and its container (four). Four exhaustive bridges and one clear-deps constructor update.
No error state machine: malformed frames already die in #1489's decode guard.

Split depth: parent #1251, no grandparent. Overlap check: only `origin/feature/1544` touched
`daemonConnection.ts`, and it merged as PR #1553; nothing in flight.

## Files read

- `src/shared/wire/types.ts` → `MCPStatusPayload`, `MCPServerStatus` — shape, absence vs `[]`, `dropped_servers` copied, `name` never a key.
- `src/main/transport/inboundMessage.ts` → `mcp-status` arm of `InboundMessage` — dormant decode with content-free logging.
- `src/main/daemonConnection.ts` → the `session-facts` and `context-usage` arms of the inbound switch — named-field literal emit.
- `src/shared/ipc/events.ts` → `DaemonEvent` `sessionFacts` / `contextUsage` members — IPC event shape idiom.
- `src/renderer/src/store/sessionFactsStore.ts`, `sessionFactsBridge.ts` → `createSessionFactsStore`, `subscribeSessionFacts`, `SessionFactsData` — the retention and always-mounted listener to mirror.
- `src/renderer/src/store/{daemonEventBridge,timelineBridge,modalBridge,questionBridge}.ts` → their `sessionFacts` ignore arms.
- `src/renderer/src/App.tsx` → `SessionFactsData` mount; `src/renderer/src/PairedShell.tsx` → `clearPairingDeps`.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`, `clearPairingScopedState` — the unconditional pairing clear.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ChannelInfoSheetView` (its `systemPromptSection` slot and the Session section), `ChannelInfoSheet` container.
- `src/renderer/src/screens/conversation/conversation.css` → `.channel-info__row`, `-label`, `-value`, `.channel-info__empty`, `.channel-info__session-value`.
- `src/renderer/src/screens/channels/ConversationStatusDot.tsx` + `channels.css` → the 6px `--radius-full` dot; `.conn-dot--*` success / error / outline tones.
- `e2e/channel-session-facts.spec.ts`, `e2e/fixtures/launchPairedApp.ts` → `daemon.pushFrame` delivery before the sheet opens.
- `docs/knowledge/features/conversation-shell-session-and-channel-info.md` → Channel info sheet section order.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

The sheet is a dark rounded panel of muted section headers (About, Memory, Actions) over label-left /
value-right body rows; the Memory row pairs a muted value with an inline action on the right. No MCP
section is drawn, so this one reuses `.status-sheet__section-header`, `.channel-info__row` and
`.channel-info__empty` with the shipped tokens. Each server row's value side is a 6px round dot in the
sidebar status dot's box (`--color-success` connected, `--color-error` failed, `--color-outline` other)
followed by the status word in `.channel-info__row-value` type. No new assets.

## Design

**IPC.** `DaemonEvent` gains
`{ type: 'mcpStatus'; conversationId: string; servers: readonly MCPServerStatus[]; droppedServers: number }`.
The main switch's new `mcp-status` arm emits a fresh named-field literal (the `contextUsage` idiom; the
decoder already built fresh row literals). No dedup, no memo. The four exhaustive renderer bridges ignore it.

**Store** (`store/mcpStatusStore.ts`): `createMcpStatusStore()` holding
`reports: ReadonlyMap<conversationId, McpStatusReport>` where `McpStatusReport = { servers, droppedServers }`.
`setMcpStatus(event-minus-type)` replaces the conversation's whole report with a copied array of
copied rows. `clearMcpStatus()` empties the Map. `selectMcpStatusFor(id | null)` returns the report or
`null`, so `null` means "no report" and `servers: []` means "claude has no servers". Only the daemon's
routing id keys the Map; no server `name` ever keys anything.

**Bridge** (`store/mcpStatusBridge.ts`): `subscribeMcpStatus(onDaemonEvent, record)` and the
always-mounted `McpStatusData` effect, mounted in `App` beside `SessionFactsData`, so reports land
while the sheet is closed. `clearMcpStatus` joins `ClearPairingScopedStateDeps` and is called
unconditionally in `clearPairingScopedState`; `PairedShell` wires it. Reconnect, sheet close and
conversation switching clear nothing.

**Section** (`screens/conversation/McpServersSection.tsx`):

- `McpServersSectionView({ report, showBuiltIn, onShowBuiltInChange })` — pure markup:
  header **MCP servers**; with `report === null` one `.channel-info__empty` line "No MCP report has
  arrived yet." and nothing else (no toggle, no rows, no "no servers" claim). With a report: a
  **Show built-in** `<label class="channel-info__row">` holding a native checkbox; the rows; an empty
  line — "Claude reported no MCP servers." when `servers` is empty, "Only built-in servers are
  reported." when the filter hid everything; and when `droppedServers > 0`, "Partial list: N more
  servers were left out by the daemon."
- Filter: `MCP_BUILT_IN_SERVER_NAMES = ['pyry_approve', 'pyry_files']` (client-owned); a row is hidden
  when `!showBuiltIn` and its `name` equals one of them. Order is claude's; never sorted.
- Row: `.channel-info__row` with the name as label and a value span holding an `aria-hidden` dot plus
  the status word. Dot class from a client-owned tone function: exactly `connected` → `--connected`,
  exactly `failed` → `--failed`, anything else → `--other`. The status word is the accessible reading,
  so no daemon text reaches `aria-label` or any attribute. Rows keyed by position.
- `error !== ''` adds a `<p class="channel-info__mcp-error">` under the row with `white-space: pre-wrap`
  so a newline stays inside that text; `''` adds nothing.
- Name, status and error render as React children only, each display-bounded to 256 code points
  (the Session section's bound) with `…` when cut.
- `McpServersSection({ conversationId })` — container: selects the report and owns `showBuiltIn` in
  `useState(false)` (UI-local; resets when the sheet closes).

`ChannelInfoSheetView` gains an `mcpServersSection?: ReactNode` slot rendered after Session and before
the System prompt slot; the container supplies it only when `conversation !== null`, like
`systemPromptSection`.

## State and concurrency

Synchronous copy-on-write Zustand updates; other conversations' records keep identity. One app-lifetime
listener whose effect returns the off handle. No timers, requests or persistence. Pairing teardown
clears the Map.

## Error handling and logging

Malformed frames are rejected by #1489's `parseMCPStatusPayload` inside the existing decode guard. This
ticket adds no log line: nothing decoded, including the conversation id, list length and row strings,
reaches a diagnostic record.

## Testing strategy

- Main: `daemonConnection.test.ts` — a frame yields exactly one `mcpStatus` event with named fields and
  extras dropped; a malformed frame yields none.
- Store/bridge: isolation incl. `__proto__` conversation ids, whole replacement, `[]` stays distinct from
  absent, identity stability, clear, unsubscribe; all four bridges return null for the event.
- `clearPairingScopedState.test.ts`: the deps pin and a real-store clear.
- `McpServersSection.test.tsx` (static render): absence line with no rows/toggle; `[]` wording; the
  built-in-only wording; claude order; tone classes for `connected`, `failed`, `Connected`, `pending`;
  verbatim status; error beneath with newline preserved and `<` escaped; empty error adds nothing;
  built-ins hidden when off and shown when on; partial line only when `droppedServers > 0`; no daemon
  text in any attribute.
- `e2e/channel-mcp-servers.spec.ts`: push frames for two conversations before opening; open; assert rows
  and hidden built-ins; toggle on shows built-ins; close, switch conversation and back, report still
  there. Reconnect survival is proven structurally: only `clearPairingScopedState` clears the store.
- Visual check of the opened sheet against node 20-48 in scratch space.

## Documentation handoff

Pending documentation stage: `docs/knowledge/features/conversation-shell-session-and-channel-info.md`,
Channel info sheet section — describe the MCP servers section, its absence / empty / partial wording,
the Show built-in filter and pairing-scoped per-conversation retention. The ticket has no explicit
documentation criterion.

## Open questions

- Whether `showBuiltIn` should persist across sheet opens. Resolved in design: UI-local, off each open,
  matching "off by default".

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the boundary stays `parseMCPStatusPayload`; the main arm copies named
  fields only, so a later decoder field cannot cross IPC. Row strings stay untrusted all the way to the
  view, which renders them as React children only.
- [Trust boundaries] SHOULD FIX (addressed in design) — the built-in filter compares a claude-authored
  `name` against client-owned constants. It is a display filter, never an authorization or actuation
  decision; `McpServersSectionView` is the only comparer and nothing branches behaviour on it.
- [Tokens] No findings — no token, key or credential is created, read or forwarded.
- [File / storage] No findings — in-memory `Map` keyed by the daemon routing id; `__proto__` is an
  ordinary Map key (tested). No server `name` becomes a Map key, React `key`, path, filename or cache key;
  rows are keyed by position. No web storage.
- [Electron attack surface] No findings — one new member on the existing one-way event channel; no new
  command, handler or preload API. No daemon text reaches an attribute: the dot is `aria-hidden` and its
  class comes from a closed client set via the tone function, not from `status`.
- [Crypto] No findings — Noise, keys and comparisons untouched.
- [Network & I/O] No findings — existing plaintext cap and decode guard apply. An oversized list is
  bounded by the daemon's cap; each rendered string is display-bounded to 256 code points.
- [Logs] No findings — no new log call; the only record is #1489's static code, length and hash. An
  embedded newline in `error` therefore cannot forge a diagnostic line.
- [Concurrency] No findings — synchronous replacement, effect cleanup removes the listener,
  unconditional whole-Map clear at pairing teardown; no await between read and write.
- [Threat model] Hostile daemon/claude text renders inert; a status word cannot recolour itself beyond
  the three tones. A hostile relay can only delay or drop the frame, which shows as "no report yet".
  OUT OF SCOPE — requesting a report (#1491), Reconnect and enable switches (later #1251 slices).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-23
