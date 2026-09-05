# Run configuration store

The renderer's held copy of the active session's **Model / Effort / YOLO** settings — a dedicated,
unidirectional Zustand store fed by an app-lifetime subscription and refreshed on two daemon-event
edges, so the [Run configuration sheet](conversation-shell-workspace-and-run-config.md#run-configuration-sheet-177) can
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

## What it does

Requests the session settings on three occasions — every time the Run configuration sheet opens,
every rising edge to `connected`, and every running → not-running turn transition (#810) — and
holds the arriving `model` / `effort` / `yolo` / `permissionMode` (#1020, see § Permission mode
below) plus the two usage figures (#192) in a read-only store until the next one arrives.
Deliberately **not** a [session store](session-store.md) facet: a settings arrival never touches
connection/messages state and vice versa, so it re-renders only components selecting this slice.

## How it works

### The store (`src/renderer/src/store/runConfigStore.ts`)

```ts
export interface RunConfigSnapshot {
  model: string; effort: string; yolo: boolean
  permissionMode: string                     // #1020 — '' means "no session was resolved"
  usedTokens: number; windowTokens: number   // #192 — windowTokens === 0 means "usage unavailable"
}
export interface RunConfigState { snapshot: RunConfigSnapshot | null }  // null = not yet loaded
export type RunConfigStore = RunConfigState & { setSnapshot: (s: RunConfigSnapshot) => void }

createRunConfigStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
runConfigStore                  // app-wide singleton
useRunConfigStore(selector)     // React binding: useStore(runConfigStore, selector)
selectSnapshot(s)                // the only read surface
```

Mirrors [`sessionStore.ts`](session-store.md)'s DI-factory → singleton → hook → selectors
structure, but with a **single setter** rather than a reducer: there is exactly one mutation
("record the latest snapshot"), so a discriminated-union action set would be a one-member union —
ceremony without benefit. `setSnapshot` replaces the whole `snapshot` object unconditionally (the
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

### Permission mode (#1020)

`permissionMode` is the session's permission mode as the daemon reports it, one of claude's **six**
modes on a resolved session (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`,
`bypassPermissions`). `''` is its own real reading, held verbatim like every other field on this
snapshot — **no session was resolved** — and it arrives on the same frame as `sessionId: ''` (§ The data path
below); the two are read as a pair, and `''` is never coerced to a mode name or to `null`.

It is **never derived from `yolo` and never derives it**: `yolo` is a boolean and there are six
modes, so on its own it can only separate `bypassPermissions` from the other five — the reason this
field exists at all. The two always agree on a resolved session (the daemon stores them so they
cannot disagree), but this store treats them as two independent fields, not a computed pair.

**No client-side allowlist.** The decode narrows only the field's *type* (`requireString`, not
`requireNonEmptyString` — `''` is a value, not an absence to reject); the six names above are never
checked against the wire value anywhere on this chain. This is deliberate: the read half carries six
modes while the write half's `set_session_settings` (`validPermissionMode`, [#1021 — run
configuration write store](run-settings-write-store.md)) accepts a closed **five**, excluding
`bypassPermissions`. Narrowing the read side to those five would be wrong.

**No consumer yet.** This ticket is wire-to-store plumbing only — the Run configuration sheet keeps
its exact current shape, with no new section, copy or display for the mode. #682 (the footer
permission-mode menu) is the first thing that renders it, and inherits the trust-tier constraint the
IPC arm's comment (`src/shared/ipc/events.ts`) states: `permissionMode` is daemon-asserted text
across the main→renderer boundary, so it is a *report*, never a control input — plain text only,
never markup, an attribute, a URL, a filename, a cache key or a lookup path, and it reaches no log
sink on either side of the bridge.

### The data path (`src/renderer/src/screens/conversation/runConfigSnapshot.ts`)

Framework-free, effects injected (the `composerSend.ts` / `logDataDownload.ts` idiom), so the whole
path unit-tests with plain spies — no React, no store, no Electron:

```ts
toRunConfigSnapshot(event: DaemonEvent): RunConfigSnapshot | null
// runConfigReceived → {model, effort, yolo, permissionMode, usedTokens, windowTokens} verbatim
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

subscribeRunConfig(onDaemonEvent, setSnapshot, setSessionId): () => void
// One listener feeds BOTH setters from the SAME event: onDaemonEvent(event => {
//   const s = toRunConfigSnapshot(event); if (s) setSnapshot(s)
//   const id = toSnapshotSessionId(event); if (id !== null) setSessionId(id)
// }). Returns the off handle (the daemonEventBridge cleanup idiom). Deliberately one subscription,
// not two: the settings and the session id they describe arrive on one frame and are only
// meaningful together — splitting them would let the sheet show one session's values while
// addressing another.
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

daemon → session_settings → runConfigReceived{sessionId,model,effort,yolo,permissionMode,used_tokens,window_tokens}
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
- **Names the active conversation, since #946.** Both request sites resolve
  `activeConversationStore.getState().activeConversation?.id ?? null` at call time and send nothing
  when that is unaddressable — see § Conversation-keyed since 2026-08-20 above.
  `MILESTONE_CONVERSATION_ID` (`composerSend.ts`) is not read by this path.

## Running model section (#560, resolved onto the published rows by #975)

`RunConfigView` gained a **sixth section**, `RunningModelSection`, rendered immediately *before*
`ModelSection` — reading order is "what is running, then what you can switch to." It reads **no
state from this store**: its data comes from the sibling [Announced-model
store](announced-model-store.md) (`useAnnouncedModelStore(selectAnnouncedModel)`, a fourth read
added to the `RunConfigSections` container alongside this store's `selectSnapshot`) and, since
\#975, a fifth: [Model-list store](model-list-store.md)'s published rows for the active
conversation. It exists because this store's `snapshot.model` is the daemon's *persisted override*,
which reads `''` / unmarked on a daemon where nothing was overridden — honest, but
indistinguishable from broken; the section answers what claude actually announced instead.

At #560 ship time, resolution was an exact-match lookup against `MODEL_CATALOG`, four hardcoded
family tokens. **#975 deleted the catalog** (see [Conversation shell — workspace and run
configuration § Run configuration Model section](conversation-shell-workspace-and-run-config.md#run-configuration-model-section-daemon-published-rows-975))
and moved the lookup onto the daemon-published rows: `publishedRowFor` (`RunConfigSections.tsx`,
renamed from `runningPublishedRow` by #976, which gave it a second caller — see [Conversation shell —
workspace and run configuration § Run configuration Effort section, daemon-published
levels](conversation-shell-workspace-and-run-config.md#run-configuration-effort-section-daemon-published-levels-976))
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

## Edge cases and limitations

- **No reset on sheet close.** The store keeps its last snapshot across a close→reopen, so
  `RunConfigSections` shows the last-known values immediately on reopen while a fresh request is in
  flight. Revisit only if this surfaces a stale-value concern.
- **A response landing after an instant sheet close is still landed.** Since #810 the listener is
  app-level and outlives the sheet, so a reply to the sheet's own request is not dropped just
  because the sheet closed first — it lands in the store exactly as any edge-driven reply would.
- **No correlation.** Any `session_settings` reply that arrives is decoded and emitted
  unconditionally — safe because the *reply* schema (`SessionSettingsPayload`) carries no
  `conversation_id`, or any other correlation id, to disambiguate at all. #945/#946 gave the *request*
  a `conversation_id`; the reply shape is untouched, so this still holds exactly as before — the
  per-conversation request #946 shipped relies on this same no-correlation acceptance, since nothing
  on the reply says which request it answers. This is why the request always names the *active*
  conversation rather than, say, the edge's own conversation: whichever id goes out is the one whose
  values land, unconditionally, whenever the reply arrives. A duplicate reply (sheet-open landing
  alongside an edge-driven request) is simply idempotent, since `setSnapshot` always replaces the
  whole snapshot.
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

- [Conversation list store](conversation-list-store.md) — `conversationListBridge`, the shape
  `runConfigLive.ts` clones (a `.ts` module of React-free injected helpers plus a headless leaf, and
  the refresh-trigger-predicate idiom the ticket named as precedent).
- [Conversation activity store](conversation-activity-store.md) — source of `isTurnRunning`'s
  #648-defect rationale (import it, never re-derive) and of the `connected`-clears-stale-liveness
  discriminator the refresh trigger's `Set` reuses.
- [Session store](session-store.md) — the structural precedent this store's DI-factory → singleton
  → hook → selectors shape mirrors, contrasted on reducer-vs-single-setter.
- [Session-id store](session-id-store.md) — the second write destination this data path feeds
  (`toSnapshotSessionId`/`setSessionId`, #491/#500); `sessionIdBridge` is the store's other,
  reactive-only ingress.
- [Daemon-event bridge](daemon-event-bridge.md) — the `assertNever`-guarded consumer whose
  `runConfigReceived → null` arm reserves this feature's consumer role (originally
  `snapshotReceived → null`, added at [#180](../codebase/180.md); re-pointed at #491/#500).
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the original transport half this store fetched
  from through #491: the `request_snapshot`/`screen_snapshot` round trip and the
  content-minimisation seam that kept the rendered screen `text` off `snapshotReceived`. Superseded
  for this store's purposes by `request_session_settings`/`runConfigReceived`; both old events were
  later removed outright by [#621](../codebase/621.md).
- [Conversation shell](conversation-shell.md) — the Run configuration sheet
  `RunConfigData` mounts inside.
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase
  notes](../codebase/256.md) — the reason #500 added the session-id half: the write-side controls
  need an address to send a `set_session_settings` change to.
- [#187 codebase notes](../codebase/187.md) — implementation summary and patterns established.
- [#188 codebase notes](../codebase/188.md) — the three read-only sections
  (`RunConfigSections`/`RunConfigView`) that read `selectSnapshot`.
- [#191 codebase notes](../codebase/191.md) — the transport slice that carried `used_tokens`/
  `window_tokens` to this store's input event.
- [#192 codebase notes](../codebase/192.md) — widened this store by the two usage figures and added
  the fourth read-only section (Context window) that renders them.
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase notes](../codebase/256.md)
  — the adjacent pending-write store whose `selectEffectiveSettings` composes over this store's
  `snapshot` as its base value; deliberately not folded in as a facet (lifecycle mismatch: sheet-scoped
  vs. App-level always-listening).
- [#257 codebase notes](../codebase/257.md) — made `RunConfigSections`/`RunConfigView` interactive:
  selecting a model, picking an effort, or toggling YOLO now submits a change through the write store
  above instead of the sections only ever reading this store's snapshot.
- [Announced-model store](announced-model-store.md) / [#560 codebase notes](../codebase/560.md) —
  the sixth section, `RunningModelSection`, added ahead of `ModelSection`; sources its own store,
  not this one — see § Running model section above.
- [Model-list store](model-list-store.md) / [#975 codebase notes](../codebase/975.md) — deleted
  `MODEL_CATALOG` and re-anchored `RunningModelSection`'s lookup and `ModelSection`'s rows onto the
  daemon-published list; see § Running model section above.
- **#810** — split the store's feed by lifetime: the app-lifetime subscription moved to the new
  `RunConfigLiveData` leaf, refreshed on the connected edge and each turn-end edge, so the figures
  are true whether or not the sheet has ever been opened; `RunConfigData` kept its per-open request
  unchanged. Security-sensitive, architect self-review PASS. See § Live outside the sheet above.
- **#811** — gave this store's live figures a second reader: the [conversation shell](conversation-shell-composer-message-box.md#composer-footer-row-811)'s
  new composer footer row, a "Context: N%" reading beside the four blocked desktop-layout slots
  (#680/#682/#683/#685). Added no store change here — `usedTokens`/`windowTokens` were already
  required `number`s under this store's `snapshot`. What moved is the *consumer-side* percentage math:
  `ContextWindowSection`'s inline clamp (§ Configuration and usage, [#192 codebase
  notes](../codebase/192.md)) is now `contextUsagePercent(usedTokens, windowTokens)`, a shared
  `number | null` function both the sheet's gauge and the new reading call, closing a `NaN`/`Infinity`
  gap the old clamp had on an overflowing daemon value (`Number.isFinite(windowTokens)` added to the
  guard). See [conversation shell § Run configuration Context window
  section](conversation-shell-workspace-and-run-config.md#run-configuration-context-window-section-192) for the extraction and
  [§ Composer footer row](conversation-shell-composer-message-box.md#composer-footer-row-811) for the new consumer.
- **[#945](https://github.com/pyrycode/pyrycode-desktop/issues/945)** — root-cause slice 1 of
  [#941](https://github.com/pyrycode/pyrycode-desktop/issues/941): threaded a `conversation_id` onto
  the wire `request_session_settings` frame (main/shared only) after the daemon made it conversation-
  keyed on 2026-08-20, silently degrading every unnamed request to a zero-valued reply since.
- **[#946](https://github.com/pyrycode/pyrycode-desktop/issues/946)** — root-cause slice 2, and the
  slice that closed [#941](https://github.com/pyrycode/pyrycode-desktop/issues/941): both this store's
  request sites now resolve the active conversation and supply it, and the payload #945 left optional
  is required since. See § Conversation-keyed since 2026-08-20 above.
- [Command channel](command-channel.md) — the `requestSessionSettings` `RendererCommand` member's
  payload (optional from #945, required since #946) and its `isRequestSessionSettingsPayload` guard.
- [Daemon connection](daemon-connection.md) — hosts `requestSessionSettings(conversationId?)`, the
  connection method this store's data path calls into.
- **#1020** — added `permissionMode` end to end from `SessionSettingsPayload.permission_mode`
  (pyrycode#1687) through to this store's snapshot; no consumer yet. See § Permission mode above.
- [Run configuration write store](run-settings-write-store.md) — #1021 is the write half's mirror:
  `set_session_settings` accepts a closed five of modes, `bypassPermissions` excluded, the deliberate
  asymmetry § Permission mode above names.
- [Model-list wire types](model-list-wire-types.md) — `WireModelOption.supports_auto_mode`, whose
  docblock names the same `set_session_settings.permission_mode` field this store's read half mirrors
  (corrected by #1020 to stop saying `set_permission_mode`).
