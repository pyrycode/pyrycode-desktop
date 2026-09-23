# Channel info — MCP servers section

The Channel Info sheet's MCP servers section — split out of [Conversation shell —
session boundaries and channel info](conversation-shell-session-and-channel-info.md)
on 2026-09-23 to keep that document under the size cap.

Part of [Conversation shell](conversation-shell.md); see [Channel Info
sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365) for the
sheet's chrome, its other sections and its open-state ownership.

## MCP servers section ([#1490](https://github.com/pyrycode/pyrycode-desktop/issues/1490))

A read-only list of claude's MCP servers, sitting after the Session facts rows and before the System
prompt section — #1489's decoded `mcp_status` report carried the rest of the way, slice for slice on
[#1241 session facts](conversation-shell-session-and-channel-info.md#session-reports)'s path: one `DaemonEvent` member (`mcpStatus`), an ignore arm
on each of the four exhaustive renderer bridges, a `Map`-keyed store (`mcpStatusStore.ts`) retaining one
report per conversation id, an always-mounted `McpStatusData` bridge (`App.tsx`, beside
`SessionFactsData`) so a report lands while the sheet is closed, and an unconditional `clearMcpStatus()`
in `clearPairingScopedState`. `selectMcpStatusFor(id)` returns `null` for "no report has arrived" and a
`{ servers: [], droppedServers }` report for claude's own positive "no servers" — the two states the wire
doc requires apart stay apart end to end.

**Wording.** `McpServersSectionView` (pure, `report | null` plus `showBuiltIn` and, since #1579,
`unavailable` in → markup out) picks one of four lines: `report === null` → *No MCP report has arrived
yet.* (no toggle, no rows); an empty `servers` → *Claude reported no MCP servers.*; a non-empty
`servers` fully hidden by the built-in filter → *Only built-in servers are reported.*; and,
independently, `droppedServers > 0` → *Partial list: N more servers were left out by the daemon.*
stacked beneath whichever of the first three applies. Since #1579, `unavailable` stacks a fifth,
independent line beneath all of that — see § On-demand refresh below. The review
that shipped this (PR #1576) flagged as a non-blocking SHOULD FIX that the third case can still read as
self-contradictory when the daemon drops every row (`servers: [], droppedServers > 0` shows both "Claude
reported no MCP servers." and the partial line back to back) — left unfixed as a deliberately unlikely
edge case, along with a NIT that the partial line never pluralizes ("1 more servers"). Fix both together
if this section changes again.

**Show built-in** is a `useState(false)` owned by the container (`McpServersSection`), not persisted and
not read from the store — every sheet open starts hidden, matching "off by default". It filters rows
whose `name` is exactly `pyry_approve` or `pyry_files`, the daemon's own servers on every non-bypass
spawn, matched against a client-owned constant list — display-only, never a behavior gate. Rows keep
claude's order (never sorted) and are `key`ed by array position, since a claude-authored `name` must
never become a React key, a `Map` key or any other identity. Each row shows the name, a 6px
`--radius-full` dot styled on the sidebar `ConversationStatusDot` (`--color-success` for exactly
`connected`, `--color-error` for exactly `failed`, `--color-outline` for every other word — a closed
three-way client set, `status` itself is never parsed or mapped), and the status word verbatim. A
non-empty `error` renders as its own `<p class="channel-info__mcp-error">` beneath the row with
`white-space: pre-wrap`, so an embedded newline stays inside that one text block; an empty `error` adds
nothing. Name, status and error are each bounded to 256 Unicode code points with a trailing `…` on cut,
the same bound `SessionFacts` uses for reported fields — every string reaches the DOM only as an escaped
React child, never an attribute, a URL, a filename or a log line.

`MCPServerStatus` also carries `scope` and `version` (both copied into the store's retained rows), but
neither is rendered here — #1490's acceptance criteria named only what is drawn. A later ticket
adding either should read `mcpStatusStore.ts`'s row-copy first: the fields are already flowing.

**Testing.** `McpServersSection.test.tsx` (static render) pins the four wording states, claude's row
order, the tone-by-exact-word mapping, the error line's escaping and newline, the built-in filter both
ways, the 256-code-point bound, and that no daemon string reaches an attribute; since #1579 it also pins
the unavailable notice both with rows still present and beside the no-report line, that there is no
notice when `unavailable` is false, and that `requestMcpStatus` sends exactly one command naming the
conversation and nothing for `null` or `''`. `daemonConnection.test.ts`
asserts the `mcp-status` arm emits exactly one named-field event and drops a malformed frame — added
because, per the PR's Lessons learned, a test asserting only "no event emitted" would have passed both
before and after this ticket, since #1489 already decoded the frame but nothing downstream consumed it.
`e2e/channel-mcp-servers.spec.ts` (fake transport) pushes reports for two conversations before opening
the sheet (the closed-sheet retention proof), toggles built-in visibility, and confirms a report survives
closing the sheet and switching conversations; reconnect survival is structural, proven by
`clearPairingScopedState.test.ts` rather than driven live. Not `needs-real-claude`: the acceptance is a
daemon frame rendering, which the fake transport already covers end to end.

**On-demand refresh ([#1578](https://github.com/pyrycode/pyrycode-desktop/issues/1578) +
[#1579](https://github.com/pyrycode/pyrycode-desktop/issues/1579)).** Before #1579 this section's report
was only ever whatever arrived when the session spawned or the last live publication — #1578 added the
outbound `mcp_status_request` verb and a correlated `mcpStatusRequestRejected` refusal event end to end
in the transport and IPC layers, but shipped nothing that called it. #1579 put it to use: the Channel
info overflow-menu handler ([Channel Info
sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365)) sends `requestMcpStatus(sendCommand,
activeConversation?.id ?? null)` every time the sheet opens — from the click handler, not a mount
`useEffect`, so one open is exactly one request even under `React.StrictMode`'s double-invoke, and a
`null` id (no active conversation) sends nothing. `mcpStatusStore` gained `unavailable:
ReadonlySet<string>` and `markMcpStatusUnavailable(conversationId)`; the mark never touches `reports`,
so rows already on screen stay. `subscribeMcpStatus` (`mcpStatusBridge.ts`) gained a third parameter and
marks a conversation only on `mcpStatusRequestRejected` with `reason === 'mcp-status-unavailable'`; an
`unclassified` refusal is ignored outright. Any `mcp_status` for that conversation, live or answered,
clears its mark — "a later report replaces it" is `setMcpStatus` deleting the id from `unavailable` when
present. `clearMcpStatus` empties both the reports map and the mark set together, so a pairing-scoped
clear cannot leave a stale mark behind. The four other exhaustive renderer bridges (`questionBridge`,
`daemonEventBridge`, `timelineBridge`, `modalBridge`) still just carry a one-line ignored arm for
`mcpStatusRequestRejected` — the consumer is `mcpStatusBridge.ts`, a fifth, dedicated bridge, not any of
those four. See [Daemon connection — system-prompt and MCP-status correlation §
MCP-status request correlation](daemon-connection-correlation-system-prompt-and-mcp.md#mcp-status-request-correlation-1578)
for the ask/refusal transport design.

`e2e/channel-mcp-status-request.spec.ts` (fake transport, new in #1579) drives: an open sends exactly one
request naming the seed conversation and renders the answered rows; changing the fake's configured answer
and reopening sends a second request and replaces the rows; an `unclassified` answer changes nothing
behind a delivery barrier; an `unavailable` answer shows the notice while keeping existing rows; switching
to a silent second conversation shows no notice there; and reopening on the original conversation while an
unsolicited report arrives clears the notice and shows the new rows. `conversationStateFake` gained
`mcpStatusAnswers`/`setMcpStatusAnswer`/`mcpStatusRequests()`; with no configured answer for a
conversation the fake records the request and replies nothing, which is what keeps
`e2e/channel-mcp-servers.spec.ts`'s unsolicited-report pushes byte-for-byte unaffected.
`e2e/real-claude-mcp.spec.ts` (`needs-real-claude`, `skipPermissions: false` so the child is
non-bypass) pairs, takes one turn, opens Channel info, ticks Show built-in, and asserts the daemon's own
`pyry_approve`/`pyry_files` rows by exact name — it asserts names only, since statuses and errors are
claude's open-set text. The reconnect and toggle drives below extend this same file. See § Current
real-claude gate state in [the live e2e runbook](live-e2e-runbook.md#current-real-claude-gate-state)
for this spec's execution status against the dispatcher's gate.

## Reconnect a failed server ([#1583](https://github.com/pyrycode/pyrycode-desktop/issues/1583))

A row whose `toneOf(status)` is anything but `connected` grows a `Reconnect` control — the shipped `button-small`
shape's neutral Secondary variant (`.channel-info__mcp-reconnect`, the same outlined-on-surface treatment
`.question-panel__cancel` already carries, disabled state included), in the row's value slot after the dot
and status word. A press calls the exported `reconnectMcpServer(sendCommand, beginWait, conversationId,
serverName)`: it marks the conversation's wait first, then sends one `reconnectMcpServer` command with the
row's `name` unchanged — same untrusted-text discipline as everywhere else here, never a key or a log field.

An accepted reconnect answers with a fresh `mcp_status` report, not an acknowledgement, so the wait cannot
be told apart from any other report in flight. `mcpStatusStore` therefore tracks two more conversation-keyed
sets, `reconnecting` and `reconnectRefused` (never keyed by server name), alongside `unavailable`:
`beginMcpReconnect` adds to `reconnecting`; `setMcpStatus` clears a conversation out of every wait and
refusal set on *any* report, `pending` included, since the daemon's own docs call that normal post-reconnect
behaviour, not a failure the client may second-guess; `markMcpReconnectRefused` (routed by
`subscribeMcpStatus`'s fourth parameter off `mcpReconnectRejected`) moves it from `reconnecting` to
`reconnectRefused` and leaves `reports` untouched — the refusal is one merged outcome with no cause, so
`MCP_RECONNECT_REFUSED` names none and reads until the next report. While `reconnecting` **or** `toggling`
(#1587, below) is true, every Reconnect *and* switch control in that conversation's section is disabled —
one busy flag for the section, not a per-control lock — so a second press cannot send. `McpServersSection`'s
`useEffect` cleanup calls `endMcpReconnectWait(conversationId)` (and, since #1587, `endMcpToggleWait`) on
unmount — the sheet unmounts its body on close, so closing (or switching conversations under an open sheet)
is what stops a daemon that never answers from leaving a control stuck past a reopen; `clearMcpStatus` also
empties every wait and refusal set at pairing teardown.

**Testing.** `mcpStatusStore.test.ts` and `McpServersSection.test.tsx` cover the four transitions per
conversation (begin/end/refuse/report), that a report lifts the wait and the refusal notice regardless of
the status word, that `reconnectMcpServer` calls `beginWait` before sending, and that the served name never
reaches an attribute. One store-testing trap: Zustand's `set({})` still replaces the state object, so a
no-op action (e.g. ending a wait that was never begun) cannot be asserted via `getState()` identity on the
whole state — compare the identity of the slice (`reconnecting`/`reconnectRefused`) instead, or the
assertion goes red on a correctly-no-op action. `e2e/channel-mcp-reconnect.spec.ts` (fake tier) drives the
press, a `pending`-answer re-render, a `'refused'` answer and its notice, and close-then-reopen re-enabling
a silently-waiting control, via the fake's `mcpReconnectAnswers`/`setMcpReconnectAnswer`/`mcpReconnectRequests`.

The real drive extends `e2e/real-claude-mcp.spec.ts` rather than adding a file — the two daemon servers
normally read `connected` and offer no button, so it sends `reconnectMcpServer` for `pyry_files` through
`window.pyry`, as the other `real-claude-*` specs already call the bridge. It cannot tell the reconnect's
report apart from the sheet-open ask's own answer (same ambiguity as the store's wait), so it first waits for
that ask's answer before sending. It tells outcome apart from a DOM read: `watchMcp` installs a page-side
`window.pyry.onDaemonEvent` observer right after pairing that records only conversation ids off `mcpStatus`,
`mcpReconnectRejected` and (since #1587) `mcpToggleRejected`, never a row string — chosen over tagging the DOM
before the send because React reuses the position-keyed row elements across a re-render, so a DOM tag would
depend on an implementation detail the event does not. The drive records whichever arrives next as the
`mcp-reconnect-outcome` test annotation (`'report'` or `'refused'`) — that annotation is what answers whether
this app's paired device is authorized to actuate at all, since the daemon checks the asking device before
anything else and a fake transport cannot stand in for that check. See § Current real-claude gate state in
[the live e2e runbook](live-e2e-runbook.md#current-real-claude-gate-state) once a gate run records the
annotation's result.

## Turn a server off and on ([#1587](https://github.com/pyrycode/pyrycode-desktop/issues/1587))

The second actuator on the section, beside Reconnect: every row, a working server included, carries an
on/off switch — a native `<button type="button" role="switch" aria-checked>` cloned from the Settings
notifications switch (Figma 17:67) by CSS token, not a second kind of control. `isOn(status)` is `status
!== 'disabled'`, kept beside `toneOf` in `McpServersSection.tsx` — claude's exact word for a server turned
off is `disabled`; any other word reads on. The real drive below is what confirms that word, and
`isOn` is the one place to change if it turns out to differ.

**The switch shows what the last report said, never a requested or optimistic state.** There is no local
"pending" flip: a press disables the control instead of pre-toggling it, so a refusal never has to revert
a state the daemon never entered. `aria-checked` and the `--on` class both read `isOn(server.status)`
directly off the held report on every render.

**Naming without a daemon string in an attribute.** The row's name span carries `id={`${idBase}-mcp-name-
${index}`}` — `idBase` is `useId()`, so the id is built from React's own id and the row's position, never
from `server.name`. The switch is `aria-labelledby`-linked to that id, so its accessible name is the
rendered (bounded, escaped) name by reference, and the raw string never reaches an attribute. The same
row-position key backs the row's own React `key`, unchanged from #1490.

**One busy flag, not two.** `onToggle` calls the exported `toggleMcpServer(sendCommand, beginWait,
conversationId, serverName, enabled)`: it marks the conversation's toggle wait first, then sends one
`toggleMcpServer` command naming the opposite of the shown state. `mcpStatusStore` holds `toggling` and
`toggleRefused` as a pair structurally identical to `reconnecting`/`reconnectRefused` (`beginMcpToggle`,
`endMcpToggleWait`, `markMcpToggleRefused`), kept separate rather than merged into one "actuating" set so
the two refusal notices — `MCP_RECONNECT_REFUSED` and `MCP_TOGGLE_REFUSED` — stay distinct outcomes for the
operator. `setMcpStatus` (any report, published or answered) clears a conversation out of both wait/refusal
pairs together. But `reconnecting || toggling` is the single `busy` flag every switch *and* every Reconnect
button in the section reads for its own `disabled`: the two kinds of actuation cannot overlap from this UI,
since either one starts by disabling the whole section, so there is no case where a reconnect and a toggle
are simultaneously outstanding to disambiguate. `McpServersSection`'s unmount cleanup ends both waits, so
closing the sheet (or switching conversations) stops a silent toggle the same way it already stopped a
silent reconnect.

**A refused toggle reads like a refused reconnect:** the rows and every switch stay exactly as last
reported, and `MCP_TOGGLE_REFUSED` ("The daemon refused to change the MCP server.") stacks beside
`MCP_RECONNECT_REFUSED` in the notice block, naming no cause — `mcpToggleRejected` carries only a
conversation id. `subscribeMcpStatus` (`mcpStatusBridge.ts`) gained a fifth parameter, `markToggleRefused`,
routed off `mcpToggleRejected` only; the four other exhaustive renderer bridges keep their one-line ignored
arm for it, the same shape as every other MCP event.

**A working server can be switched off and still offer Reconnect.** `disabled` is not `connected`, so
\#1583's `toneOf(status) !== 'connected'` still grows the Reconnect button on an off row — this ticket left
that alone; both controls sit side by side in the row's value slot, Reconnect then the switch. Worth a
follow-up only if the real drive confirms `disabled` is in fact claude's word and the pairing reads as
redundant to an operator.

**CSS** (`conversation.css`, `.channel-info__mcp-switch{,-knob,--on}`) is `.settings__switch`'s Figma
17:67 geometry cloned by token name, the convention this file already follows per-screen: a 52×32
fully-rounded track, off = `--color-surface-container-highest` fill with a 2px `--color-outline` border and
a 16px `--color-outline` knob at the left, on = `--color-primary` track/border with a 24px `--color-surface`
knob at the right, plus `:focus-visible` and the shared `opacity: 0.38` / `cursor: not-allowed` disabled
emphasis already used elsewhere in this file.

**Security.** The row `name` reaches the switch only through `aria-labelledby`, never copied into an
attribute; `status` selects only `aria-checked` and the `--on` class through `isOn`, a boolean derived from
one exact-word comparison. A hostile claude can make any row read `disabled`, at worst offering "turn on"
for a server claude lied about — pressing it still sends one operator-initiated `mcp_toggle` the daemon
authorizes on its own. No new IPC channel or bridge method: the press reuses `window.pyry.sendCommand` and
\#1586's validated `isMCPTogglePayload` arm. Builder self-review, verdict PASS; see the ticket's architecture
doc for the full review.

**Testing.** `mcpStatusStore.test.ts` extends the reconnect coverage with the same four transitions
(begin/end/refuse/report) for `toggling`/`toggleRefused`, that a report ends the wait and lifts the notice
regardless of the status word, that `clearMcpStatus` empties both new sets, and that the bridge routes
`mcpToggleRejected` to the toggle mark and not the reconnect mark (and vice versa). `McpServersSection.test.tsx`
pins a switch on every row including a connected one, `aria-checked` false exactly for the word `disabled`
(not `Disabled`, not `failed`), that `aria-labelledby` resolves to the name span's id and neither id nor
label contains the raw name, that every switch and Reconnect disable under either `toggling` or
`reconnecting`, the toggle-refused notice with and without a report, and that `toggleMcpServer` begins the
wait before sending exactly one command carrying the requested state. `e2e/channel-mcp-toggle.spec.ts` (fake
tier, new) drives: switches read the report on open; a flip against silence sends one request and disables
every switch and Reconnect while the switch itself keeps its prior reading; closing and reopening
re-enables against continued silence; a flip with a configured report answer re-renders the flipped switch
from that answer; a `'refused'` answer shows the notice, leaves every switch as last reported and
re-enables the controls; and an unsolicited later report clears the notice.

`e2e/real-claude-mcp.spec.ts` gained a toggle drive after the reconnect drive (same file, not a new one —
see § MCP servers section above): it flips `pyry_files` off through its switch, waits for exactly one of a
further report or `mcpToggleRejected`, and records the outcome as the `mcp-toggle-outcome` annotation. On a
report, the status word the report gave `pyry_files` is recorded as `mcp-toggle-status-word` *before* the
assertion that the switch reads off — so if claude's real word differs from `disabled`, the annotation shows
it even on a failing assertion. On a refusal, the notice must show and the switch must still read on.
`pyry_approve` is never toggled, since the permission path needs it running. As of this writing the spec has
not executed on the dispatcher's live gate (see § Current real-claude gate state in [the live e2e
runbook](live-e2e-runbook.md#current-real-claude-gate-state)); the `disabled` predicate is therefore still
unconfirmed against a real daemon.
