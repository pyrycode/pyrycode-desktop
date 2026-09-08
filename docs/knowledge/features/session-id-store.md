# Session-id store

The renderer's held copy of the open conversation's **current daemon `session_id`** — a dedicated,
unidirectional Zustand store fed by the always-arriving `sessionTransition` marker, so the interactive
[Run configuration](conversation-shell-run-configuration.md#run-configuration-sheet-177) controls ([#257](../codebase/257.md))
can address a `set_session_settings` write to the session that is actually running.

Introduced in [#259](../codebase/259.md), the renderer-side retention half of #183's interactive
Run-configuration write path, split alongside #254/#255/#256/#257. Consumes the transport
[#254](../codebase/254.md) already shipped (`sessionTransition{newSessionId}` daemon event, later
widened by [#285](../codebase/285.md) to also carry `reason`/`occurredAt`/`workspaceCwd` for the
delimiter render slice #286 — this store's bridge still reads only `newSessionId` and is unaffected).
This store itself delivers no visible surface of its own — [#257](../codebase/257.md) (since shipped,
PR #283) is its live reader, the same posture `runConfigStore` (#187) had before #188.

## What it does

Retains the most recently arrived `session_id` in a read-only store, superseded by each new
`sessionTransition` marker. Deliberately **not** a [run configuration store](run-config-store.md)
facet, and unlike that store, has **no request half**: the daemon *pushes* `session_transition`
markers unsolicited (a `/clear`, an idle eviction, or a workspace change), so nothing is requested and
nothing is correlated — reactive-only, strictly smaller than both `runConfigStore` (#187, requests on
sheet-open) and `conversationListStore` (#208, requests on the connected-edge).

## How it works

### The store (`src/renderer/src/store/sessionIdStore.ts`)

```ts
export interface SessionIdState { sessionId: string | null }   // null = no marker seen yet
export type SessionIdStore = SessionIdState & { setSessionId: (id: string) => void }

createSessionIdStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
sessionIdStore                  // app-wide singleton
useSessionIdStore(selector)     // React binding: useStore(sessionIdStore, selector)
selectSessionId(s)               // the only read surface
```

Mirrors `conversationListStore`'s DI-factory → singleton → hook → selector structure (the #208
idiom), but holds a bare `string | null` — no wire type, no camelCase remap, since the value is
already a routing id, not a wire row. `setSessionId` replaces the whole `sessionId` unconditionally
(last-write-wins, no merge) and never coerces or validates — a received empty string is held
**verbatim**, not treated as "no id." `sessionId: null` is the distinct "no marker seen yet" state, so
a degenerate empty-string id is never confused with "nothing arrived yet."

[#529](../codebase/529.md) added a second mutation, `clearSessionId`, returning the state to the
exported `initialSessionIdState` constant — for when the pairing context that scoped the id ends.
Named setters rather than a reducer: `setSessionId`/`clearSessionId` are independent whole-value
writes, neither reading prior state nor constraining the other's ordering, so there is still no state
machine for a discriminated-union action set to model. Shipped with no production caller; [#530](../codebase/530.md)
(navigation) added the first — `clearSessionId` is now called from
[`activateConversation`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx), gated on the active
conversation's id actually changing — a same-id re-open leaves the held session id untouched.
[#531](../codebase/531.md) (unpair) added the second, unconditional call site, via
[`clearPairingScopedState`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx) — the pairing
itself is ending there, so unlike #530's gate there is no id to compare against. Until
[#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) this call site fired on pairing another
server too; it no longer does — adding a server ends no pairing, so the open conversation's session id
stays live, and `setSessionSettings` routes by session id (`correlations.routeSession`, #1119) to the
daemon that owns it, never to whichever server was paired most recently.
[#652](../codebase/652.md) (the deleted-open-discussion exit) added a third, via
[`exitActiveConversation`](paired-shell.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652) —
gated on the id like #530's, but comparing against a *deleted* conversation's id rather than a
*newly-opened* one's.
[#1166](https://github.com/pyrycode/pyrycode-desktop/issues/1166) shortened the window `#530`'s clear
opens: `activateConversation` now asks for a fresh `session_settings` reply (which also fills this store,
see § The data path below) in the same move that clears it, rather than leaving the id at `null` until
the new conversation's first turn ends. See [Paired shell — conversation exits and stamps § The
run-configuration and model-list
ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166).

### The data path (`src/renderer/src/store/sessionIdBridge.ts`)

Framework-free, effects injected (the `conversationListBridge` / `runConfigSnapshot` idiom), so the
whole path unit-tests with plain spies:

```ts
translateSessionTransition(event: DaemonEvent): string | null
// sessionTransition → event.newSessionId verbatim; every other event → null (plain `default`, not
// assertNever — this filter permanently consumes only sessionTransition). Deliberately blind to
// event.conversationId (#1192) — attribution is one decision and it lives in the gate below, not here.

subscribeSessionId(onDaemonEvent, setSessionId, getOpenConversationId): () => void
// onDaemonEvent(event => {
//   if (event.type === 'sessionTransition' && event.conversationId !== getOpenConversationId()) return
//   const id = translateSessionTransition(event); if (id !== null) setSessionId(id)
// })
// — returns the off handle (the daemonEventBridge cleanup idiom). The guard is `!== null`, not
// truthiness: `if (id)` would silently drop an empty-string session_id. The gate ([#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192),
// `subscribeRunConfig`'s shape copied verbatim) is checked first: a marker naming a conversation other
// than the open one returns before the translator ever runs. `getOpenConversationId` is called PER
// EVENT, inside the listener, never captured once at subscribe time — this listener is app-lifetime,
// so a captured id would freeze at whatever was open on mount.
```

### The React binding — `SessionIdData` (same file)

A headless leaf (`SessionIdData(): null`) mounted **unconditionally at App level**
(`src/renderer/src/App.tsx`), alongside `<ConversationListData />` — **not** sheet-scoped like
`RunConfigData`. A `sessionTransition` marker can arrive at any time, including before the Run
config sheet is ever opened, so the subscriber must already be listening. Since
[#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192) the listener being always-on no
longer means the id is retained regardless of which screen is shown — each marker is kept only if it
names the open chat; the two are independent. One
`useEffect(() => subscribeSessionId(window.pyry.onDaemonEvent, id => sessionIdStore.getState().setSessionId(id), () => activeConversationStore.getState().activeConversation?.id ?? null), [])` —
the third argument is `RunConfigLiveData`'s open-conversation wiring verbatim, down to the `?? null`
spelling. `window.pyry` is dereferenced only inside the effect, so it server-renders to empty markup
without a bridge mock (the `ConversationListData` invariant). No request effect, no `useState`/
`useRef`/`useSessionStore` — reactive-only.

### Data flow

```
daemon → transport (#254) → sessionTransition{newSessionId, conversationId (#1192)}
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge   (no-op, #254)
                                └─ SessionIdData (NEW, #259)
                                     → conversationId !== getOpenConversationId()? → drop (#1192)
                                     → translateSessionTransition → setSessionId
                                     → sessionIdStore                                  [last marker wins]

\#257: useSessionIdStore(selectSessionId) → RunConfigSections' AC5 gate input
```

## Configuration and usage

- **Import surface**, consumed by `RunConfigSections` (#257):
  `import { useSessionIdStore, selectSessionId } from '@renderer/store/sessionIdStore'`.
- **Mount point:** `src/renderer/src/App.tsx`, `<SessionIdData />` next to `<ConversationListData />`.
- **Single current id, not a per-conversation map** — desktop targets a single active conversation
  (`MILESTONE_CONVERSATION_ID`), so there is nothing to key a map by. The marker itself carries a
  `conversationId` since [#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192) (this
  repo's port was simply stale relative to the daemon, which has stamped one since upstream
  #740/#741) — but that field is consumed only to gate the write, never to shard the store.

## Edge cases and limitations

- **`sessionId !== null` is #257's AC5 gate**, both structurally (the container withholds `onChange`
  from `RunConfigView` until a session id exists) and at runtime (`changeSetting`'s null guard in
  `runSettingsControls.ts`) — see [#257 codebase notes](../codebase/257.md).
- **Empty-string `session_id` is held, not dropped** — deliberate (see the store section); a product
  call to instead reject it would be a behavior change, not a bug fix.
- **No correlation, no automatic reset.** Nothing is requested, so there is nothing to time out or
  retry; the store keeps its last id until something explicitly clears it. [#529](../codebase/529.md)
  added `clearSessionId` as the manual path back to `initialSessionIdState`; [#530](../codebase/530.md)
  wired its first caller (a conversation switch), and [#531](../codebase/531.md) wired its second
  (unpair alone since [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141), unconditional).
- **Fixed: a late `sessionTransition` for the previous conversation could re-stale the id after a
  switch** ([#530](../codebase/530.md); closed by
  [#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192)). If the previous conversation was
  still streaming when the switch happened, a marker meant for it that arrived after `clearSessionId()`
  ran was indistinguishable from the new conversation's first marker and got written — reopening the
  misdirected-write window `activateConversation` narrows. Named as an open PO follow-up by the
  architect's security review on #530; #1192 closed it by bringing the ported wire payload into line
  with the daemon (`conversation_id` has been on `SessionTransitionPayload` since upstream #740/#741;
  this repo's copy asserted the field did not exist) and gating `subscribeSessionId`'s write on it —
  see § The data path above. `sessionIdBridge`'s reply-only sibling ingress,
  `runConfigSnapshot`, got the same gate one ticket earlier, in [#1176](https://github.com/pyrycode/pyrycode-desktop/issues/1176)
  (see [Run configuration store](run-config-store.md) § Conversation-attributed since #1176). The
  general form was already narrow for [#531](../codebase/531.md): unpair tears the transport down
  first, so no late marker follows, and on the pair-another path the exposure window is a microtask gap
  that shrinks to nothing in practice — see #531's spec § Open questions.

## Related

- [Daemon-event channel](daemon-event-channel.md) — the `sessionTransition` event this store's bridge
  consumes, shipped content-minimised (only `newSessionId`) in [#254](../codebase/254.md) and later
  widened (unaffecting this store) by [#285](../codebase/285.md).
- [Daemon-event bridge](daemon-event-bridge.md) — the `assertNever`-guarded bridge whose
  `sessionTransition → null` arm (added in #254) reserved this feature's consumer role; this store is
  a **fifth**, independent subscriber on the same channel, not a change to that bridge.
- [Conversation list store](conversation-list-store.md) — the structural precedent this store's
  DI-factory → singleton → hook → selector shape and its App-level always-listening headless leaf both
  mirror.
- [Run configuration store](run-config-store.md) — the sibling store this ticket deliberately did
  **not** fold `session_id` into (lifecycle mismatch: sheet-scoped vs. App-level always-listening); its
  § Conversation-attributed since #1176 documents the reply-only ingress's twin gate.
- **[#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192)** — closed this store's other
  misattribution window: `subscribeSessionId` gained a fourth parameter,
  `getOpenConversationId`, and a one-line early return copied from `subscribeRunConfig` (#1176), so a
  `sessionTransition` naming a conversation other than the open one no longer writes. Required
  bringing `SessionTransitionPayload` (`src/shared/wire/types.ts`) into line with the daemon, which has
  carried `conversation_id` since upstream #740/#741 — this repo's port had simply gone stale.
- [Conversation shell](conversation-shell.md) — the Run configuration sheet #257 wired this
  store's selector into.
- [#254 codebase notes](../codebase/254.md) — the transport decode arm this store consumes.
- [#259 codebase notes](../codebase/259.md) — implementation summary and patterns established.
- [Session settings send](session-settings-send.md) / [#263](../codebase/263.md) — the outbound
  `setSessionSettings` command + connection method this store's held `session_id` now addresses,
  via #257's `runSettingsControls.ts` gate.
- [#257 codebase notes](../codebase/257.md) — the live consumer: gates `submitSettingsChange` on
  `selectSessionId(s) !== null`.
- [Relay-link store](relay-link-store.md) / [#329](../codebase/329.md) — a sibling store cloning
  this one's structure verbatim (DI-factory → singleton → hook → selector, reactive-only, `null`
  sentinel) for the `relayLinkChanged` arm instead of `sessionTransition`.
- [#529 codebase notes](../codebase/529.md) — added `clearSessionId`, the store's clear path, in
  lockstep with the same capability on [`activeConversationStore`](conversation-shell.md); capability
  only, no caller yet.
- [#530 codebase notes](../codebase/530.md) — `clearSessionId`'s first production caller: a conversation
  switch, gated on the active conversation's id changing, via
  [`activateConversation`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx).
- [#531 codebase notes](../codebase/531.md) — `clearSessionId`'s second production caller: a pairing
  ending (unpair alone since [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141)),
  unconditional, via
  [`clearPairingScopedState`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx).
- [#652 codebase notes](../codebase/652.md) — `clearSessionId`'s third production caller: the open
  discussion being deleted, gated on the id like #530's, via
  [`exitActiveConversation`](paired-shell.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652).
