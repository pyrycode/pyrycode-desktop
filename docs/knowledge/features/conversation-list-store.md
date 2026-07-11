# Conversation list store

The renderer's held copy of the daemon's live conversation list — a dedicated, unidirectional
Zustand store fed by a subscription binding that observes the [conversation list
fetch](conversation-list-fetch.md)'s `conversationsReceived` event and drives the initial
`list_conversations` request, so the Channel List screen (#141), the create-discussion affordance
(#142), and every future list / navigation / archive feature can read one source of truth.

Introduced in [#208](../codebase/208.md), the store half of the conversation-list foundation
(mirror mobile #312), split from and blocked by [#139](../codebase/139.md) (the transport half,
shipped as PR #209). This ticket shipped no visible surface — #141 is its first consumer.

## What it does

Requests a fresh `conversations` list once the connection reaches `connected`, and holds the
arriving rows in a read-only store until the next list arrives — whole-list replace, no merge, no
dedupe. Deliberately **not** a [session store](session-store.md) facet: a list update never touches
connection/messages state and vice versa, so a list arrival re-renders only components selecting
this slice.

## How it works

### The store (`src/renderer/src/store/conversationListStore.ts`)

```ts
export interface ConversationListState {
  conversations: readonly ConversationSummary[] | null   // null = not yet loaded
}
export type ConversationListStore = ConversationListState & {
  setConversations: (conversations: readonly ConversationSummary[]) => void
}

createConversationListStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
conversationListStore                  // app-wide singleton
useConversationListStore(selector)     // narrow-slice React binding: useStore(conversationListStore, selector)
selectConversations(state)             // the only read surface
```

Mirrors [`runConfigStore`](run-config-store.md)'s DI-factory → singleton → hook → selector structure
verbatim, including the `null` "not yet loaded" sentinel — an empty array (`[]`) is a real, loaded
"zero conversations" state, never coerced to or from `null`. A **single setter**, not a reducer:
there is exactly one mutation ("record the latest list"), so a discriminated-union action set would
be a one-member union — ceremony without benefit. Rows are held **verbatim in wire snake_case**: no
parallel camelCase renderer type, no per-field remap — unlike `runConfigSnapshot`'s `used_tokens →
usedTokens`, this reuses `ConversationSummary` directly so the slice needs zero per-field transform
and stays drift-free against the mobile wire contract. No derivations are baked in — no `kind` enum,
no "unnamed" flag, no relative-time formatting: "discussion vs channel" derives from the raw
`is_promoted` flag and "unnamed" is the literal `name === null`, both at #141's read boundary, not
here.

### The data path (`src/renderer/src/store/conversationListBridge.ts`)

```ts
translateConversationsEvent(event: DaemonEvent): readonly ConversationSummary[] | null
// switch (event.type) { case 'conversationsReceived': return event.conversations; default: return null }

requestConversationList(sendCommand: (c: RendererCommand) => void): void
// sendCommand({ type: 'requestConversations' })  — bare, no new command/builder

subscribeConversations(onDaemonEvent, setConversations): () => void
// onDaemonEvent(event => { const list = translateConversationsEvent(event); if (list !== null) setConversations(list) })
// returns the off-handle (the subscribeRunConfig idiom)

ConversationListData(): null
// headless component, two effects: subscribe on mount ([]), request on the rising edge to `connected` ([isConnected])
```

`translateConversationsEvent` uses a **soft** `default: null`, not `assertNever` — the deliberate
`toRunConfigSnapshot` precedent: this path permanently consumes only `conversationsReceived`, so a
third `assertNever` on the `DaemonEvent` channel (alongside `daemonEventBridge` and
`timelineBridge`) would make every future arm a compile error in three files without benefit. A
rename of the owned arm is still caught — a `case` label that no longer overlaps the union is a type
error regardless. Unlike [`translateTimelineEvent`](conversation-timeline-store.md#the-translator--binding-srcrenderersrcstoretimelinebridgets),
this returns `event.conversations` directly: selecting one named field is a filter, not a rename, so
no fresh-literal reconstruction is needed.

`subscribeConversations` guards on `list !== null`, not `if (list)` — an empty array is truthy
either way, but the explicit `!== null` makes "an empty list still writes (loaded-zero, not
not-loaded)" unmistakable to a reviewer.

`ConversationListData` owns two effects:

1. **Subscribe** (deps `[]`) — `subscribeConversations(window.pyry.onDaemonEvent, list =>
   conversationListStore.getState().setConversations(list))`; the off-handle is the cleanup, so a
   StrictMode double-mount nets exactly one live listener.
2. **Request on the rising edge to `connected`** (deps `[isConnected]`, `isConnected =
   useSessionStore(s => s.status.type === 'connected')`) — a `useRef(false)` guard fires exactly one
   request per connection episode: resets to `false` while disconnected (so a reconnect re-requests)
   and fires once per rising edge (StrictMode double-invoke included).

A **component**, not a hook called directly in `App` — this isolates the connected-gate
`useSessionStore` read in a headless leaf. `App` itself subscribes to no store (only `useState` +
the effect-only `useDaemonEventBridge`); a hook called in `App` would subscribe `App` to status
flips and, because `App`'s inline `onPaired`/`onUnpaired` arrows are unstable, cascade a re-render
into `ConversationScreen` on every connect/disconnect. This diverges from
[`useTimelineBridge`](conversation-timeline-store.md)'s hook form because no list render-component
exists yet to host a hook — a dedicated headless mount is the app-level equivalent.

### Data flow

```
App mount → <ConversationListData/> (app-level, sibling of AppView)
  → subscribe effect: window.pyry.onDaemonEvent → subscribeConversations (live immediately)
  → connected-gate effect: useSessionStore(status.type==='connected') rising edge
    → requestConversationList(window.pyry.sendCommand) → {type:'requestConversations'}
    → COMMAND_CHANNEL → onCommand → connection.requestConversations() → buildListConversations
      [#139, already shipped]

daemon → conversations frame → parseInboundMessage → conversationsReceived DaemonEvent [#139]
  → DAEMON_EVENT_CHANNEL → subscribeConversations listener
    → translateConversationsEvent → rows (or null → skip)
    → conversationListStore.setConversations(rows)   [whole-list replace]
  → selectConversations / useConversationListStore   (read by #141, not yet by anything)
```

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, alongside `useDaemonEventBridge()`, as a sibling
  of `<AppView/>` inside a fragment — one stable, app-lifetime listener with no subscribe/unsubscribe
  churn as the route flips, because the list must stay live for #141's Channel List regardless of
  which screen is shown.
- Import surface for #141/#142: `import { useConversationListStore, selectConversations } from
  '@renderer/store/conversationListStore'`.
- No component consumes `useConversationListStore` yet — it is exported ahead of its first consumer,
  the same shape `useRunConfigStore` shipped ahead of #188.

## Edge cases and limitations

- **Trigger is per-connection-episode, not fire-once-ever.** The minimal reading of AC4 ("issued at
  least once, without user action, after connected") plus natural robustness: a reconnect gets a
  fresh list, and a request lost to a mid-flight disconnect recovers on the next connect. This is
  **not** the deferred "richer refresh policy" (intra-connection re-requests on archive change /
  focus / a future `conversation_updated`) — it is simply the list following the connection
  lifecycle. The whole-list-replace setter makes each re-request's arrival idempotent.
- **No correlation, no request tracking.** Any `conversationsReceived` that arrives — solicited or
  not — is written unconditionally; safe because only the authenticated daemon can produce one (see
  [conversation list fetch § Correlation is deliberately absent](conversation-list-fetch.md#correlation-is-deliberately-absent)).
- **No reply / list never arrives.** The slice stays `null` forever; #141 renders its own loading
  affordance. Out of scope here.
- **`cwd` is untrusted daemon-supplied opaque display text**, carried forward from #139's security
  review. This slice only stores and reads it as a string — no filesystem use. Any later "open
  workspace" feature (#141 or beyond) that resolves `cwd` into a real path **must** boundary-check it
  (`path.resolve` + known-root prefix) before any filesystem access.
- **`ConversationListData`'s effect timing is not unit-tested** — mirrors the `RunConfigData`
  precedent: a bare component's effect lifecycle (deps/refs/StrictMode) is untestable without a React
  renderer (none in this repo). The pure `translateConversationsEvent`/`requestConversationList`/
  `subscribeConversations` helpers carry all the testable logic.

## Related

- [Conversation list fetch](conversation-list-fetch.md) / [#139 codebase notes](../codebase/139.md)
  — the transport half this store consumes (`conversationsReceived` event, `requestConversations`
  command, `ConversationSummary` wire type); shipped first, unchanged by this ticket.
- [Run configuration store](run-config-store.md) / [#187 codebase notes](../codebase/187.md) — the
  store-shape and data-path precedent this ticket mirrors verbatim (single-setter form).
- [Conversation timeline store](conversation-timeline-store.md) / [#202 codebase
  notes](../codebase/202.md) — the sibling store+bridge slice from the same era; a real-reducer form
  with a hard `assertNever` filter and a hook binding, contrasted with this ticket's single-setter
  form, soft `default: null` filter, and component binding.
- [Session store](session-store.md) / [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the store this one deliberately stays orthogonal to (no connection/messages state crosses over).
- [#208 codebase notes](../codebase/208.md) — implementation summary and patterns established.
- [Channel List home screen](channel-list.md) (#141) — the first consumer of
  `useConversationListStore`/`selectConversations`. The [new-discussion FAB](new-discussion-fab.md)
  (#242) reads the daemon's `conversationCreated` event through its own bridge, not this store.
