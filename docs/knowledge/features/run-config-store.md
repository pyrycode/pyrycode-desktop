# Run configuration store

The renderer's held copy of the active session's **Model / Effort / YOLO** settings — a dedicated,
unidirectional Zustand store fed by an app-lifetime subscription and refreshed as conversations and
settings change, so the [Run configuration sheet](conversation-shell-run-configuration.md#run-configuration-sheet-177) can
display how the session is running. The store is now live app-wide (#810, see § Live outside the
sheet below) rather than fed only by the sheet's own open transition.

Introduced in [#187](../codebase/187.md), split A (data path) of
[#181](https://github.com/pyrycode/pyrycode-desktop/issues/181) — itself split from
[#156](../codebase/156.md). Originally consumed the transport [#180](../codebase/180.md) had shipped
(`requestSnapshot` command, `snapshotReceived` event, sourced from a `screen_snapshot` reply — a
picture of the terminal that carried the run configuration as a side-load). **Moved onto the
dedicated `requestSessionSettings` command / `runConfigReceived` event at #491/#500** (see § Moved
off `screen_snapshot` below) — a daemon with no terminal to photograph, which is every daemon on the
stream-json interactive runner, refused the old reply outright and left the sheet permanently inert
on that runner; the new reply answers on both runners — though since 2026-08-20 "answers" and "carries
real values" are no longer the same claim, see § Conversation-keyed since 2026-08-20 below — and also
finally carries a session id to address writes to. This store itself delivered no visible surface at
\#187; the sibling
[#188](../codebase/188.md) renders the three sections (`RunConfigSections`/`RunConfigView`) from the
values it holds.

[#191](../codebase/191.md) extended the transport event with two more fields, `used_tokens` /
`window_tokens` (context-window usage) — this store required **zero** change at the time, exactly as
the `toRunConfigSnapshot`'s explicit-copy comment predicted. [#192](../codebase/192.md) is that
extension: it widens both the held `RunConfigSnapshot` and the `toRunConfigSnapshot` copy by the two
figures (`usedTokens`/`windowTokens`) and renders the fourth read-only section, **Context window**,
from them — see below.

## Moved off `screen_snapshot` (#491/#500)

`screen_snapshot` is refused outright whenever there is no terminal to photograph — always, on the
stream-json interactive runner — so the sheet was inert in production despite #187–#192 shipping a
working data path. #491 moved the fetch onto `request_session_settings` /
`runConfigReceived`, a reply the runner actually answers, and dropped the active-conversation
dependency in the same move: the new request is **bare** (no `conversation_id`) because the reply is
daemon-wide, so there is no id to resolve first and no `conversation.not_found` to fire into. #500
added the session id half — `runConfigReceived.sessionId` is now also written, to the
[session-id store](session-id-store.md), on the same frame as the settings fields (see § The data
path below) — because the sheet's write-side controls ([Run configuration write
store](run-settings-write-store.md), #256/#257) need a session to address a `set_session_settings`
change to, and `screen_snapshot` never carried one at all. [#621](../codebase/621.md) later removed
`snapshotReceived`/`screen_snapshot`'s daemon events entirely, once this move left them unconsumed
everywhere — see [Screen snapshot fetch](screen-snapshot-fetch.md).

This section describes the request as it stood from #491/#500 until 2026-08-20 — genuinely bare, no
`conversation_id` field to carry one. It stopped being accurate on that date; see § Conversation-keyed
since 2026-08-20 below for what changed and why the request stopped being bare without this store's own
behaviour changing yet.

[#257](../codebase/257.md) later made the Model/Effort/YOLO sections **interactive**: this store's
`snapshot` remains the read-only daemon base, now composed *underneath* the adjacent
[Run configuration write store](run-settings-write-store.md)'s optimistic pending/confirmed overlay
(`selectEffectiveSettings`) rather than read directly by `RunConfigSections`. This store itself needed
no change for that — see the `RunConfigSections`/`RunConfigView` section below for the interactive
render.

## Conversation-keyed since 2026-08-20 (#945/#946)

`request_session_settings` stopped being genuinely bare on 2026-08-20. Two daemon commits —
pyrycode#1586 and pyrycode#1610 — gave it a `conversation_id` field and taught the handler to resolve
it, and the degradation for a request that names none is silent by design: no error frame, no log
line, just a zero-valued `SessionSettingsPayload` in place of the real running configuration. Every
request this store's own callers send names none, so the sheet quietly lost the ability to show or
confirm the running model for about two weeks of real operator use before
[#941](https://github.com/pyrycode/pyrycode-desktop/issues/941) traced the regression to this frame.

The fix landed in two slices, deliberately, because it crossed a wire-capability question and a
where-does-the-id-come-from question:

- **[#945](https://github.com/pyrycode/pyrycode-desktop/issues/945)** threaded the capability through
  `src/main/` and `src/shared/` only. The wire gained `RequestSessionSettingsPayload{conversation_id:
  string}` (mirroring the daemon struct field-for-field, no `omitempty` — the key is always on the
  wire, `''` meaning "names nothing" rather than an absence); the `requestSessionSettings`
  `RendererCommand` member gained an optional payload carrying it; and `buildRequestSessionSettings`
  normalised an absent id to `conversation_id: ''`. This store's own callers were untouched in that
  slice — `requestRunConfigSnapshot` (`runConfigSnapshot.ts`) and the refresh-triggered request in
  `runConfigLive.ts` still sent no id, serialising as `conversation_id: ''` instead of an omitted
  payload, drawing exactly the same zero-valued reply as before. Production behaviour did not change.
- **[#946](https://github.com/pyrycode/pyrycode-desktop/issues/946)** is the renderer slice: both call
  sites now resolve `activeConversationStore.getState().activeConversation?.id ?? null` at call time
  and pass it through `requestRunConfigSnapshot`, which declines to send at all when nothing is
  addressable. This is the change that makes the sheet show real values again, and
  `e2e/real-daemon-session-settings.spec.ts` is green against a real `pyry` daemon as of this slice —
  see § How it works below for the current shape of both sites.

Every "bare"/"daemon-wide" statement elsewhere in this document below this point that is not corrected
inline describes the request as it stood before 2026-08-20 — read it as history, not current wire
shape.

## Conversation-attributed since #1176

The reply itself still carries no correlation id — `SessionSettingsPayload` gained nothing, and giving
it one would be a wire change (ADR 0002), so this closes client-side instead. Every conversation switch
since #1166 is a request occasion, and a reply from a conversation the operator has since switched away
from used to land in both stores unconditionally, attributed to whichever conversation was open when it
arrived — showing another chat's model/effort/permission-mode/context reading, and, the sharp half,
pointing `changeSetting` (`runSettingsControls.ts`) at that other conversation's session id.

**The correlation lives in `src/main/daemonConnection.ts`**, as a fourth per-connection map beside
`outstandingAnswers`/`pendingSettings`/`pendingCreateFolders` — `pendingConfigRequests: Map<number,
string>`, envelope id → the conversation `request_session_settings` named. Set *after* a successful
`driver.sendMessage` in `requestSessionSettings` (a throwing build/send registers nothing, so an entry
never sits under an unspent id), matched and deleted by `Envelope.in_reply_to` in the `session-settings`
arm of `onDriverEvent`, and cleared wholesale on each `dial()` — which is what makes the recycled
envelope ids after a reconnect safe. Keyed by a client-minted number, never a daemon-supplied string, so
it stays a `Map` for the same reason `pendingCreateFolders` is a `Set` rather than an object.

**Fail-closed on anything uncorrelatable, silently.** A `session_settings` frame with no `in_reply_to`,
or one matching no outstanding entry (a stale reply from a cleared connection, a duplicate of an
already-matched reply, or a daemon forging a snapshot for a request never sent), emits no
`runConfigReceived` at all — not a partial event, not a coerced id. Neither branch logs: the only values
a diagnostic could carry are the conversation id and the wire routing id, and `emitDaemonEvent` is
log-free by construction. One accepted consequence: `correlationRouter`'s `learn` also reads
`runConfigReceived.sessionId` to index session → server, so an uncorrelatable reply now teaches it
nothing either — correct, since a session id this client cannot tie to a request it sent is exactly the
input that index must not accept.

**The renderer gate is `subscribeRunConfig`'s fourth parameter**, `getOpenConversationId: () => string |
null`, called *per event inside the listener* — never resolved once at subscribe time, since this
listener is app-lifetime (mounted in `RunConfigLiveData`) and a closure capture would freeze the open
conversation at mount and reinstate the defect in a new shape. One gate covers both writes
(`event.conversationId !== getOpenConversationId()` returns before either setter runs), deliberately not
one per setter, because the settings and the session id they describe are only meaningful together —
see § The data path below for the exact shape. `toRunConfigSnapshot`/`toSnapshotSessionId` are untouched
by the gate and stay pure `DaemonEvent → value | null` mappers.

The one production caller, `RunConfigLiveData` (`runConfigLive.ts`), reads the open conversation
non-reactively at call time — `activeConversationStore.getState().activeConversation?.id ?? null` — the
third consumer of that shape after `conversationLastReadBridge.ts` and this module's own request side;
`conversationLastReadBridge.ts`'s note that a third consumer is the signal for a
`selectOpenConversationId` selector is now genuinely due, and remains unactioned as adjacent refactoring.

**What this does not reach — closed by a sibling ticket, not this mechanism.**
`sessionIdStore`'s other writer, `sessionIdBridge`'s unsolicited `session_transition` marker, answers
no request, so there is nothing to correlate against the way this section's envelope-id map does.
[#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192) closed it a different way: it brought
`SessionTransitionPayload` into line with the daemon (which has carried `conversation_id` on this
frame since upstream #740/#741 — this repo's port had simply gone stale) and gave
`subscribeSessionId` the same shape of gate as this module's, one early return comparing the event's
own routing key against `getOpenConversationId()`. See [Session-id store](session-id-store.md) §
Related.

## What it does

Requests settings on Run configuration or Channel info sheet open, connection, turn completion,
every conversation activation (including reopening the current chat), and a correlated successful effort write. Activation
supplies the bound session and saved choices even before a first message; see the
[activation seam](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166).
The [write bridge](run-settings-write-store.md#remembering-the-confirmed-level-1169) refreshes after
remembering a confirmed effort choice, so an acknowledgement cannot substitute for an applied reading.

The held snapshot separates saved `effort` from optional `effectiveEffort`. Omission means unavailable,
null means Claude reports no model effort parameter, and strings (including empty) are preserved.
Whole-snapshot replacement drops a prior reading when a later reply omits it. The
[footer](composer-effort-menu.md) uses this reading with only a pending-write overlay; recall eligibility
continues to use saved/pending/confirmed choices. Snapshot clearing and conversation attribution cover
the effective reading together with the other fields, including across hosts.

Deliberately **not** a [session store](session-store.md) facet: a settings arrival never touches
connection/messages state and vice versa, so it re-renders only components selecting this slice.

## How it works

### The store (`src/renderer/src/store/runConfigStore.ts`)

```ts
export interface RunConfigSnapshot {
  model: string; effort: string; yolo: boolean
  effectiveEffort?: string | null            // applied reading, independent of saved effort
  permissionMode: string                     // #1020 — '' means "no session was resolved"
  usedTokens: number; windowTokens: number   // #192 — windowTokens === 0 means "usage unavailable"
  slashCommands?: boolean; mcpServers?: boolean; contextUsageDetail?: boolean  // #1655, see below
  midTurnInput?: boolean                     // #1726 — Send now requires explicit true
  memorySearch?: MemorySearchPayload          // daemon search report; omission means unknown
}
export interface RunConfigState { snapshot: RunConfigSnapshot | null }  // null = not yet loaded
export type RunConfigStore = RunConfigState & {
  setSnapshot: (s: RunConfigSnapshot) => void
  clearSnapshot: () => void   // #1167 — back to initialRunConfigState
}

createRunConfigStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
runConfigStore                  // app-wide singleton
useRunConfigStore(selector)     // React binding: useStore(runConfigStore, selector)
selectSnapshot(s)                // whole-snapshot read; capability selectors below
```

Mirrors [`sessionStore.ts`](session-store.md)'s DI-factory → singleton → hook → selectors
structure, but with **named setters** rather than a reducer: its two mutations — "record the latest
snapshot" and, since #1167, "drop it" — are independent whole-value writes that read no prior state,
the [session-id store](session-id-store.md)'s set/clear shape (#259/#529) rather than a
discriminated-union action set. A reducer earns its keep where the transitions are *correlated* — the
adjacent [Run configuration write store](run-settings-write-store.md) is that contrast, which is why
\#1167 lands as a reducer arm there and a second setter here.

`setSnapshot` replaces the whole `snapshot` object unconditionally (the
most recent snapshot always wins — no merge, no dedupe) and never coerces or validates the fields:
an empty `model`, an empty `effort` (inherited default), and `yolo: false` (permissions enforced)
are held **verbatim**. `snapshot: null` is the distinct "no snapshot received yet" state, so a
received all-defaults snapshot (`{ model: '', effort: '', yolo: false }`) is never confused with
"nothing loaded" — #188 needs to tell those two apart.

`usedTokens`/`windowTokens` (#192) follow the same verbatim-hold rule: both required, never coerced.
`windowTokens === 0` is the daemon's "usage unavailable" signal (foreground session, or no transcript
yet) — not `undefined` — which lets [#192](../codebase/192.md)'s container null-default
(`windowTokens: 0`) collapse into the *same* branch as a real unavailable snapshot, one guard instead
of two.

`permissionMode` (#1020) follows the identical verbatim-hold rule — see § Permission mode below for
what the value means and why it is never derived from `yolo`.

`memorySearch` is copied only when the daemon supplies its optional search report. The whole-snapshot
replacement drops an earlier report when the next accepted reply omits it; an explicit `unknown`
remains a report, and provider `installed: false` or `enabled: false` stays intact. The aggregate
availability, not the number of providers or the MCP server list, determines whether search was
reported absent. See [Channel info](conversation-shell-session-and-channel-info.md#memory-search-report)
for the displayed states.

### Permission mode (#1020)

The snapshot's `permissionMode` reports the running child's confirmed permission mode.
The six known values are `default`, `acceptEdits`, `plan`, `auto`, `dontAsk` and
`bypassPermissions`.
An empty string means confirmation is unavailable.
It can accompany a non-empty session ID, including while the child is starting or resetting.
The store preserves the empty string and the footer hides its permission control.

The report is independent of stored settings and the `yolo` boolean.
An operator-bypass child can report `bypassPermissions` while stored default and false
yolo remain unchanged. Never derive a mode from the boolean or initialization facts.
Pending writes and acknowledgements describe intent, so they cannot replace this report.
The model and effort controls retain their existing write overlays.

`subscribeConfirmedRunConfig` accepts reports for the active conversation and owning host.
After a permission acknowledgement it requests a report immediately, then retries every
500ms within a 15-second window. Each retry waits for the outstanding reply.
An old-mode reply does not end confirmation polling.
A rejection requests a refresh without cancelling an earlier acknowledged target or
extending its deadline. Timeout preserves the latest report.

Conversation/host changes, owning-host reconnects, reset and session replacement clear
permission confirmation and the memory-search report while preserving other snapshot fields where
applicable.
Reset suppresses incoming readings until completion.
A replacement during reset keeps that suppression, and completion keeps the new session guard.
Main discards superseded requests and requests invalidated by reset or replacement.
Late replies cannot restore a previous context's permission label.

The read accepts any string, including empty and future mode names.
The write accepts only the five settable modes and excludes `bypassPermissions`.
The [footer permission menu](composer-permission-mode-menu.md#permission-mode) renders
known labels and escapes unknown text. Daemon text never becomes markup, a URL or a log.

### Session capability flags (#1655)

`slashCommands`/`mcpServers`/`contextUsageDetail` on the snapshot report what the running
session supports — false for a Codex session, which has none of the three (decoded onto
`runConfigReceived` by #1654). `toRunConfigSnapshot` copies each with the same conditional
spread as `effectiveEffort`: an unreported flag crosses IPC as an explicit `undefined`
property, and the spread omits the key rather than holding that `undefined`, so the snapshot
never carries a key the daemon did not send.

`sessionSupports(snapshot, capability)` reads these three flags as `false` only for the daemon's
explicit `false`. A null snapshot, an absent flag and `true` all read as supported, so an older
daemon, a snapshot that has not arrived yet and every Claude session render exactly as before
the flags existed. `selectSlashCommandsSupported`/`selectMcpServersSupported` are primitive
boolean selectors over `sessionSupports`, so a snapshot change that leaves a flag alone
re-renders nothing. There is no `selectContextUsageDetailSupported`; `ContextUsageControl`
already reads the whole snapshot and calls `sessionSupports` directly.

Consumers key on the flags only, never on the agent name: [Conversation shell — actions menu
and reader cutover § composerActionRows](conversation-shell-actions-menu-and-reader-cutover.md)
drops the Actions menu's slash-command rows, [Conversation shell — channel info and
MCP](conversation-shell-channel-info-mcp.md) mounts no MCP servers section, and
`ContextUsageControl` (`ConversationScreen.tsx`) renders the context reading without its
`ContextBreakdownPopover` trigger.

`midTurnInput` follows the same copy-when-reported and whole-snapshot lifetime,
but has its own opt-in selector, `selectMidTurnInputSupported(s)`, which reads
`s.snapshot?.midTurnInput === true` ([#1726](https://github.com/pyrycode/pyrycode-desktop/issues/1726)).
It deliberately stays outside `SessionCapability` / `sessionSupports`: reusing
that helper would show Send now before any reply or on an older daemon that
omits the flag. No snapshot, omission and explicit `false` all hide the control;
only explicit `true` offers it on queued rows. A later reply without the flag
drops an earlier true reading, and switching chats clears it with the snapshot.
See [queued-row behavior](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213).

### The data path (`src/renderer/src/screens/conversation/runConfigSnapshot.ts`)

Framework-free, effects injected (the `composerSend.ts` / `logDataDownload.ts` idiom), so the whole
path unit-tests with plain spies — no React, no store, no Electron:

```ts
toRunConfigSnapshot(event: DaemonEvent): RunConfigSnapshot | null
// runConfigReceived → {model, effort, effectiveEffort?, yolo, permissionMode, usedTokens, windowTokens}
// effectiveEffort preserves omission, null and strings; the other fields copy verbatim.
// (explicit copy, not a spread — keeps the store shape immune to DaemonEvent gaining an unrelated
// field later; the two usage figures map the wire snake_case used_tokens/window_tokens to the
// store's camelCase — permissionMode is already camelCase on the event, #1020, and copies straight
// across unconditionally, '' included); every other event → null.

toSnapshotSessionId(event: DaemonEvent): string | null
// runConfigReceived → event.sessionId; every other event → null. '' is a real daemon value ("no
// session to address") held verbatim, never coerced to null — the `!== null` write-gate (below)
// preserves it, matching sessionIdBridge's discipline.

requestRunConfigSnapshot(sendCommand, conversationId): void
// conversationId is REQUIRED (string | null), not optional (#946) — a caller that forgets to resolve
// one must be a compile error, not a silent unnamed request. Sends nothing at all for an
// unaddressable id (null or ''), under one falsy check: either serialises to the identical zero-reply
// frame, and setSnapshot's whole-object replace means a request that could only draw zeroes would
// wipe a held real snapshot instead of leaving it alone. An addressable id sends exactly
// { type: 'requestSessionSettings', payload: { conversation_id } }. Inline typed literal, no shared
// constructor.

subscribeRunConfig(onDaemonEvent, setSnapshot, setSessionId, getOpenConversationId): () => void
// One listener feeds BOTH setters from the SAME event, gated by ONE check (#1176): onDaemonEvent(event => {
//   if (event.type === 'runConfigReceived' && event.conversationId !== getOpenConversationId()) return
//   const s = toRunConfigSnapshot(event); if (s) setSnapshot(s)
//   const id = toSnapshotSessionId(event); if (id !== null) setSessionId(id)
// }). Returns the off handle (the daemonEventBridge cleanup idiom). Deliberately one subscription,
// not two: the settings and the session id they describe arrive on one frame and are only
// meaningful together — splitting them would let the sheet show one session's values while
// addressing another. The gate is symmetric with that reasoning: it is one check covering both
// writes, not one per setter, for the same reason. getOpenConversationId is called PER EVENT, never
// captured once at subscription — see § Conversation-attributed since #1176 above.
```

`toRunConfigSnapshot`/`toSnapshotSessionId` return `null` via a plain `default`, not `assertNever` —
these filters intentionally consume only `runConfigReceived`; permanent, not a gap to close.
Exhaustiveness over `DaemonEvent` is enforced exactly once, in `daemonEventBridge.ts`.

**Second ingress into the session-id store.** `subscribeRunConfig`'s `setSessionId` write is the
*second* source for the [session-id store](session-id-store.md) — the first, `sessionIdBridge`,
consumes the unsolicited `session_transition` marker and stays reactive-only. Neither source is
preferred; arrival order wins, the store's existing contract. Preferring the marker would be wrong
right after an eviction (it still names the *previous* id, so this route's next read is the only
correct value); preferring this route would be wrong after a `/clear` while the sheet sits open with
a now-stale id (the marker carries the genuinely newer one).

### The React binding (`src/renderer/src/screens/conversation/RunConfigData.tsx`)

A **headless container** (`RunConfigData(): null`) mounted as the first child of `<StatusSheet>` in
`ConversationScreen.tsx`, ahead of `<LogDataSection />`. Because the sheet body is conditionally
mounted (`{sheetOpen && <StatusSheet>…}`), the container's mount **is** the sheet's open transition
— no separate `isOpen`-tracking is needed. `window.pyry` is dereferenced only inside its mount
effect, never during render, so it server-renders to empty markup without a bridge mock.

Since #810 it owns **only** the request half — the subscription moved app-level (see § Live outside
the sheet below):

- **Request** — `requestRunConfigSnapshot(window.pyry.sendCommand, conversationId)`, guarded by a
  `useRef(false)` one-shot flag so the effect (which has no symmetric "un-request" cleanup) fires the
  request exactly once even under the StrictMode dev double-invoke. A genuine close→reopen is a *new*
  component instance with a fresh ref, so it re-requests — exactly one request per open.
  `conversationId` is read **non-reactively**, `activeConversationStore.getState().activeConversation?.id
  ?? null` at call time (#946) — the same `getState()`-inside-a-callback idiom `runConfigLive.ts` already
  used for its sibling stores — so this leaf still subscribes to nothing and its render body stays free
  of store reads. It is correct because the effect runs on the sheet's own mount, which happens after
  `activateConversation` has already recorded the conversation the sheet is about to describe. A sheet
  opened before any conversation has ever resolved now sends nothing (`requestRunConfigSnapshot`'s
  no-addressable-id branch) rather than the pre-#946 unnamed request that drew a zero reply — strictly
  fewer wasted frames, no behaviour regression. There is no "subscribe before request" ordering left to
  preserve here: the app-level listener (#810) has been live since `App` mounted, well before any sheet
  opens.

### Live outside the sheet (#810)

Before #810 the store's only feed was `RunConfigData`'s own subscribe effect, live only while the
sheet was mounted: the figures did not exist before the first open and froze the instant the sheet
closed. `session_settings` is **reply-only** — `requestRunConfigSnapshot` is its sole sender
anywhere in the tree and nothing pushes the reply unsolicited — so keeping the figures true needed
both an app-lifetime listener and a refresh trigger of its own; a subscription alone could never see
a second value.

**`src/renderer/src/screens/conversation/runConfigLive.ts`** (new module, the
[`conversationListBridge`](conversation-list-store.md) shape: a `.ts` holding React-free injected
helpers plus a headless leaf) supplies both:

- **`RunConfigLiveData(): null`** — the ninth app-level headless leaf, mounted in `App.tsx`
  alongside the other eight. It is now the **only** listener that lands `runConfigReceived` into
  `runConfigStore` and `sessionIdStore` (`subscribeRunConfig`, reused verbatim, unedited). Two
  effects, each returning its `onDaemonEvent` off handle as cleanup, net exactly one live listener
  of each kind across a StrictMode double-mount.
- **`createRunConfigRefreshTrigger()`** — a stateful factory returning a predicate over the
  daemon-event stream, closing over one `Set<string>` of conversations whose turn is currently
  running. `connected` clears the set and returns `true` (a genuine rising edge — the daemon emits
  it once per completed handshake, and `liveWindow.ts` replays the held one into a reopened window,
  which is correct to re-request into since that window's store starts empty). `turnState` adds the
  conversation id while a turn is running and returns `false`; a non-running phase does
  `set.delete(id)` and returns whatever `delete` returns — `true` only if the id had actually been
  running, so a re-asserted `idle` (or an `idle` for a conversation never seen running) is not an
  edge. The set is per-conversation specifically so two interleaved conversations cannot steal or
  mask each other's edges, and it self-prunes (bounded by concurrently-running turns, not by
  lifetime conversation count). It is a `Set`, never a plain object keyed by the daemon-supplied id —
  `obj[id] = …` would hand a hostile `__proto__` to a prototype setter.
- **`subscribeRunConfigRefresh(onDaemonEvent, refresh)`** — wraps one trigger instance around
  `onDaemonEvent`, calling `refresh` (a nullary `() => void`) on each `true` edge. `RunConfigLiveData`'s
  own arrow is `() => requestRunConfigSnapshot(sendCommand, activeConversationStore.getState().activeConversation?.id
  ?? null)` (#946) — the same non-reactive `getState()` read `RunConfigData` uses, resolved fresh on
  every edge.

**The edge set and the request's addressee are two separate questions, and #946 answers only the
second.** The edge set stays daemon-wide and untouched: a turn ending in *any* conversation is a valid
edge, because filtering to the active conversation would leave the figures stale exactly when another
conversation was the one spending the window — `createRunConfigRefreshTrigger` is not touched by
\#946, and its `refresh` seam stays nullary so `event.conversationId` is structurally incapable of
reaching the request. What changed is which conversation the *resulting* request names: since the
reply describes exactly one conversation's session and carries no correlation id, and the sheet shows
the active conversation, the request names the **active** one — whichever conversation's turn edge
triggered it, never the edge's own id. An edge firing with no conversation active (a `connected` edge
before the first sheet open, typically) now sends nothing, matching `RunConfigData`'s branch, rather
than the pre-#946 unnamed request.

The trigger reads the edge off the **event stream**, not off `useSessionStore` + a `useRef` the way
`conversationListBridge`'s connected-edge guard does. This repo's renderer specs are static server
renders (`environment: 'node'`, CLAUDE.md) with no effects, so a ref-guarded edge would be
structurally uncoverable; a plain predicate is callable directly from a test. `isTurnRunning` is
imported from `ConversationScreen.tsx` rather than re-derived, for the same #648-defect reason
[`conversationActivityBridge`](conversation-activity-store.md) already documents (a gate written
against one phase literal loses the signal for the tool-heavy bulk of a turn). Importing it is also
*why* this logic cannot live in `runConfigSnapshot.ts` or `RunConfigData.tsx`: `ConversationScreen`
imports `RunConfigData`, which imports `runConfigSnapshot` — putting the trigger in either would
close an import cycle. A separate module under `screens/conversation/` has none.

A duplicate request — a sheet-open request landing alongside an edge-driven one — needs no
deduplication: the reply is a whole-snapshot replace, so it is simply idempotent.

## Data flow

```
App mounts → <RunConfigLiveData/>  [app-lifetime, unconditional]
  → subscribeRunConfig(onDaemonEvent, setSnapshot, setSessionId)         [the ONLY lander into the two stores]
  → subscribeRunConfigRefresh(onDaemonEvent, () => requestRunConfigSnapshot(sendCommand))

connected (handshake complete, or replayStatus into a reopened window)
  → trigger: clear the running set, return true → requestSessionSettings
turnState{id, thinking|responding} → trigger: add(id), return false
turnState{id, idle}                → trigger: delete(id) — true (→ request) only if id was running

sheet opens → <RunConfigData/> mounts → requestRunConfigSnapshot(sendCommand)   [one per open, unchanged]

correlated effort confirmation → RunSettingsWriteData → remember choice → requestSessionSettings
daemon → session_settings → runConfigReceived{sessionId,model,effort,effectiveEffort?,yolo,permissionMode,used_tokens,window_tokens}
  → the one app-level listener → toRunConfigSnapshot → setSnapshot(s)  AND  toSnapshotSessionId → setSessionId(id)
  → runConfigStore                                          [most recent snapshot wins]
  → sessionIdStore                                          [id held verbatim, including '']
  → RunConfigSections (#188/#192): useRunConfigStore(selectSnapshot)
```

## Configuration and usage

- **Import surface**, consumed by `RunConfigSections` (#188):
  `import { useRunConfigStore, selectSnapshot } from '@renderer/store/runConfigStore'`.
- **Mount point:** `src/renderer/src/screens/conversation/ConversationScreen.tsx`, inside
  `<StatusSheet>` — `RunConfigData` (write) first, `RunConfigSections` (read, #188) second.
- **Names the active conversation.** Sheet-open, live refresh and effort-confirmation requests resolve
  `activeConversationStore.getState().activeConversation?.id ?? null` at invocation. Activation passes
  `conversation.id` directly. `requestRunConfigSnapshot` sends nothing for an unaddressable id;
  `MILESTONE_CONVERSATION_ID` is not read by this path.

## Running model section (#560, resolved onto the published rows by #975)

`RunConfigView` gained a **sixth section**, `RunningModelSection`, rendered immediately *before*
`ModelSection` — reading order is "what is running, then what you can switch to." It reads **no
state from this store**: its data comes from the sibling [Announced-model
store](announced-model-store.md) — `useAnnouncedModelStore(selectAnnouncedModelFor(conversationId))`
since #1146 keyed that store by conversation (a fourth read added to the `RunConfigSections` container
alongside this store's `selectSnapshot`) — and, since #975, a fifth: [Model-list
store](model-list-store.md)'s published rows for the active conversation. It exists because this store's
`snapshot.model` is the daemon's *persisted override*, which reads `''` / unmarked on a daemon where
nothing was overridden — honest, but indistinguishable from broken; the section answers what claude
actually announced instead.

At #560 ship time, resolution was an exact-match lookup against `MODEL_CATALOG`, four hardcoded
family tokens. **#975 deleted the catalog** (see [Conversation shell — workspace and run
configuration § Run configuration Model section](conversation-shell-run-configuration.md#run-configuration-model-section-daemon-published-rows-975))
and moved the lookup onto the daemon-published rows: `publishedRowFor` (`RunConfigSections.tsx`,
renamed from `runningPublishedRow` by #976, which gave it a second caller — see [Conversation shell —
workspace and run configuration § Run configuration Effort section, daemon-published
levels](conversation-shell-run-configuration.md#run-configuration-effort-section-daemon-published-levels-976))
finds the row whose `value` is `===` the announced identifier — `value`, deliberately not
`resolved_model`, because a row's `resolved_model` is routinely a superstring of its own `value`
(`'haiku'` → `'claude-haiku-4-5-20251001'`), which would give the ticket's exactness guard an
exception. A miss stays the ordinary case — claude echoes an identifier at least as specific as the
one it was given, so it rarely equals a bare published `value` — and renders the identifier
verbatim; a hit renders that row's `display_name`; no announcement yet renders an explicit
not-yet-known line; a daemon-reported cut renders a sibling client-owned marker element, never text
concatenated into the value. **Both branches are daemon-authored text now** — the hit path used to
render a client-owned catalog name, so the code comment claiming "the two provenances never mix in
one node" stopped being true and was rewritten in place rather than left standing; what still holds,
and is the property that actually matters, is that only one JSX text position renders per branch.
See [#560 codebase notes](../codebase/560.md) for the original three-state render contract and
[#975 codebase notes](../codebase/975.md) for the rewrite.

## Scoped to the open chat since #1167

Until #1167 nothing reset this store when the open chat changed: `clearPairingScopedState` deliberately
left it alone ("re-requested", its comment said), and neither `activateConversation` nor
`exitActiveConversation` touched it. The held snapshot is app-wide and keyed by nothing, so a switch, a
delete or an archive left the previous chat's model/effort/YOLO/permission-mode/usage figures standing —
composed by the sibling [write store](run-settings-write-store.md) into the footer's displayed value for
whichever chat was opened next, until that chat's own `runConfigReceived` reply eventually landed (one
round trip, bounded by [#1166](../codebase/1166.md)'s ask-on-activation and
[#1176](../codebase/1176.md)'s correlation gate — see § Conversation-attributed since #1176 above).

`clearSnapshot` closes that gap: it returns the store to `initialRunConfigState`
(`snapshot: null`), sourced from that exported constant rather than a fresh `{ snapshot: null }`
literal — `clearSessionId`'s stated reason, so a second field added to `RunConfigState` later is reset
for free rather than needing a second edit here. Unconditional, so clearing an already-clear store is a
no-op by construction; `selectSnapshot` and the capability selectors see no slice
change on `null → null`, so no subscriber wakes on a redundant clear. It reverts to the
*distinct* not-loaded state,
never to an all-zero snapshot — `''` / `false` / `0` are real daemon readings and must stay
distinguishable from "nothing has arrived for this chat yet", which is what makes every footer
control's not-known rendering reachable at all.

The optional memory-search report follows this lifetime too: activation of a different conversation
or exit drops the whole snapshot. `subscribeConfirmedRunConfig` also removes `memorySearch` from a
retained snapshot on conversation or host change, owning-host reconnect, reset, and session transition;
those paths retain some other fields, so relying on `clearSnapshot` alone would leave a stale search
claim visible. The existing conversation, host and expected-session gates admit only a current reply
to restore it. A not-yet-loaded or omitted report therefore reads as unknown in Channel info until a
correlated reply supplies a report. Opening Channel info requests fresh session settings for its
active conversation through `requestRunConfigSnapshot`; activation and reconnect continue to refresh
the same reading.

Both conversation-lifetime helpers call it through one shared `clearRunConfig` dep member that also
resets [Run configuration write store](run-settings-write-store.md) in the same act — since #1231,
[System-prompt store](system-prompt-store.md)'s held reading, and since #1250 [System prompt
write](system-prompt-write.md)'s window-side write store, a fourth arrow in the same body. See that
document's `conversationSwitched` arm and [Paired shell — conversation exits and stamps § The
run-configuration clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167)
for the placement in each helper. `activateConversation` calls it *inside* its id-change gate, so a
re-open of the chat already open leaves the snapshot standing; `exitActiveConversation` calls it
unconditionally past its own id gate, since there is no successor chat to preserve it for.

Clearing the snapshot also drops `usedTokens`/`windowTokens`, so the footer's context-usage reading
unmounts until the newly opened chat's own reply lands — the same widened window the session-id clear
already carries, not a regression. `clearPairingScopedState` stays out of scope on purpose: an unpair
leaves this store held, but no footer renders until a chat is opened, and that open clears it by
construction through `activateConversation` — a member there would guard state nothing can read.

## Edge cases and limitations

- **No reset on sheet close.** The store keeps its last snapshot across a close→reopen, so
  `RunConfigSections` shows the last-known values immediately on reopen while a fresh request is in
  flight. Revisit only if this surfaces a stale-value concern.
- **A response landing after an instant sheet close is still landed.** Since #810 the listener is
  app-level and outlives the sheet, so a reply to the sheet's own request is not dropped just
  because the sheet closed first — it lands in the store exactly as any edge-driven reply would.
- **Correlated by envelope id, client-side, since #1176.** The *reply* schema
  (`SessionSettingsPayload`) still carries no `conversation_id` — #945/#946 gave the *request* one, the
  reply is untouched, and giving the reply one would be a wire change out of scope under ADR 0002. The
  background process instead records each request's envelope id against the conversation it named and
  matches the reply by `Envelope.in_reply_to`; a reply that cannot be tied to an outstanding request of
  this client's own emits no `runConfigReceived` at all. This is why the request still always names the
  *active* conversation rather than the edge's own: the correlation identifies which reply answers which
  request, not which conversation a reply "belongs to" independent of having been asked. A duplicate
  reply (sheet-open landing alongside an edge-driven request) is still simply idempotent, since
  `setSnapshot` always replaces the whole snapshot. See § Conversation-attributed since #1176 above for
  the mechanism, and its final paragraph for the one ingress ([#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192),
  since closed by a wire-level gate rather than envelope-id correlation) this does not reach.
- **A daemon that flaps `turn_state` costs one request per genuine transition, not per re-assertion**
  — the per-conversation `Set` in `createRunConfigRefreshTrigger` absorbs re-asserted phases (#810).
  If a real daemon is ever observed flapping transitions rapidly enough to matter, a debounce belongs
  in `subscribeRunConfigRefresh`; none exists today because none has been observed (architect
  self-review, 2026-08-27).
- **Fire-and-forget request.** `sendCommand` is `void`; a bridge failure is swallowed upstream — no
  result to await, no error surface in this store.
- **`sessionId: ''` is a real value, not an absence.** It means "the daemon has no session to
  address"; the write-side gate (`isAddressableSessionId`, in `runSettingsControls`) is what turns it
  into an inert sheet — this store and its data path hold it verbatim.
- **`permissionMode: ''` is the identical reading, on the same frame.** It means "no session was
  resolved" and is never coerced, never checked against the six mode names, and never derived from or
  used to derive `yolo`. See § Permission mode above.
- **Coupled to a daemon carrying pyrycode#1687.** `permission_mode` has no `omitempty` on the wire, so
  it is required here too — a frame missing it throws `WireDecodeError` and the whole reply is
  rejected, taking the sheet and all three footer controls inert with nothing surfaced anywhere. This
  is the accepted consequence of a required-field mirror, not a bug in this store; the real-daemon gate
  (`e2e/real-daemon-session-settings.spec.ts`) is what proves the deployed daemon carries the field.

## Related

Cross-references to the other stores, decisions and ticket-by-ticket changes this store
composes with have moved to [Run configuration store — related](run-config-store-related.md)
(split out on size, documentation stage, #1655).
