# #259 — Retain the current session_id from the session_transition marker

**Size:** XS (PO sized S; overridden downward). This is the smallest of the read-path holders — the
`conversationListStore` (#208) shape **minus the entire request half**: no command sent, no
connected-edge trigger, no `MILESTONE_CONVERSATION_ID`-keyed request, no `useSessionStore` read, no
`useRef` re-arm. Pure subscribe → filter → whole-value set.

**Not security-sensitive** (label confirmed): pure renderer state holding a routing id — no key,
token, socket, or raw frame. Matches `runConfigStore` (#187) and `conversationListStore` (#208).

**Design source:** N/A — data-layer holder, renders nothing (a headless subscriber + a store slice).
Not UI-visible; no Figma, matching the ticket body.

---

## Files to read first

- `src/renderer/src/store/conversationListStore.ts` (whole file, 65 lines) — **the store to clone.**
  DI-factory → singleton → hook → `select*` selector with a single whole-value setter (not a reducer).
  Your store is this with `readonly ConversationSummary[] | null` → `string | null`.
- `src/renderer/src/store/conversationListBridge.ts` (whole file, 106 lines) — **the bridge to clone,
  then strip.** Mirror `translateConversationsEvent` (pure filter, `switch`/`default: null`) and
  `subscribeConversations` (subscribe + `!== null` guard + off-handle). **Delete** the request half:
  `requestConversationList`, and inside the `ConversationListData` component the `isConnected`
  `useSessionStore` read, the `requested` `useRef`, and the second (request) `useEffect`. Your
  component keeps only the **subscribe** effect.
- `src/renderer/src/store/runConfigStore.ts:26-70` — the sibling store shape; confirms the
  `interface State` / `type Store = State & { setX }` / `initialX` / `createX` / singleton / `useX` /
  `selectX` septet is the house idiom.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts:27-40` — `toRunConfigSnapshot`, the
  other instance of the pure `switch (event.type) { case …: return …; default: null }` filter idiom.
- `src/shared/ipc/events.ts:88-94` — the `sessionTransition` arm and its doc comment
  (`{ type: 'sessionTransition'; newSessionId: string }`; session_id is a routing id, not a secret).
  This arm is the sole input your filter reads.
- `src/renderer/src/App.tsx:47-99` — the App-shell container and its render fragment. You add one
  headless leaf (`<SessionIdData />`) next to `<ConversationListData />` (line 92) and one import.
  Read the comment at 85-89 explaining why `ConversationListData` is a **component** (isolated
  re-render), not a hook — same rationale applies to yours.
- `src/renderer/src/store/conversationListBridge.test.ts` (whole file, 166 lines) — **the test file to
  clone.** Framework-free filter/subscribe tests with injected spies (`fakeBridge`), a real-store
  not-loaded→loaded seam test, and one `renderToStaticMarkup` server-render sanity for the headless
  component. Drop the `requestConversationList` describe block; keep everything else.
- `src/renderer/src/store/conversationListStore.test.ts` (whole file, 96 lines) — the store test to
  clone: plain-function tests over isolated `createSessionIdStore()` instances.

**Do NOT read/edit** `daemonEventBridge.ts` / `timelineBridge.ts` / `modalBridge.ts`. All three
already have an explicit `case 'sessionTransition':` no-op arm (merged #254). This holder is a
**fifth independent subscriber** on the one daemon-event channel — exactly like the timeline and
modal bridges are independent subscribers (see `App.tsx:48-58`) — not a change to any existing bridge.

---

## Context

The transport (#254, merged) decodes the `session_transition` marker and emits it to the renderer as
the `sessionTransition` `DaemonEvent` arm, carrying only `newSessionId`. Nothing retains it: the event
is a one-shot IPC message, so a component not mounted when it arrives never sees it. The interactive
Run configuration controls (#257, later) must read "the current session id" to un-inert themselves and
to address a `set_session_settings` write to the running session.

This slice adds the renderer-side holder: a small store that retains the current `session_id`,
superseded by a later marker, exposed through a selector, written by an **App-level, always-listening**
headless subscriber. Because a marker can arrive at any time — including before any consumer (the Run
config sheet) is ever mounted — the subscriber must live at App level (the `ConversationListData`
idiom), not sheet-scoped (the `RunConfigData` idiom). Desktop targets a single active conversation and
the marker carries no conversation key (pyrycode/pyrycode#656), so the holder retains a **single
current id**, not a per-conversation map. A later marker simply replaces the held id.

---

## Design

Two new production files + one one-line mount edit. Names mirror `conversationList*`:

### 1. `src/renderer/src/store/sessionIdStore.ts` (new) — the holder

Clone `conversationListStore.ts`, substituting a `string | null` value for the array. Contracts:

- `interface SessionIdState { sessionId: string | null }`
- `type SessionIdStore = SessionIdState & { setSessionId: (id: string) => void }`
- `const initialSessionIdState: SessionIdState = { sessionId: null }` — `null` is the distinct
  "no marker seen yet" state (AC1).
- `function createSessionIdStore(init = initialSessionIdState)` — DI-friendly, React-free
  `createStore<SessionIdStore>`; `setSessionId` does `set({ sessionId })` **unconditionally** (whole-
  value replace, last-write-wins, AC2 — no merge, no coercion, no validation).
- `const sessionIdStore = createSessionIdStore()` — the app-wide singleton the bridge writes and #257
  reads.
- `function useSessionIdStore<T>(selector)` — narrow-slice `useStore(sessionIdStore, selector)` binding.
- `const selectSessionId = (s: SessionIdState): string | null => s.sessionId` — the only read surface.

This file imports **only** `zustand/vanilla` + `zustand` — no React, no `@shared` wire types (unlike
`conversationListStore`, which reuses `ConversationSummary`; here the held value is a bare `string`).

### 2. `src/renderer/src/store/sessionIdBridge.ts` (new) — the data path

Clone `conversationListBridge.ts`, strip the request half. Three exports:

- `function translateSessionTransition(event: DaemonEvent): string | null` — the pure filter (AC3).
  `switch (event.type) { case 'sessionTransition': return event.newSessionId; default: return null }`.
  A `default: null`, **not** `assertNever` — ignoring every other arm is the intended, permanent
  behavior (this path consumes only `sessionTransition`). A rename of the arm is still a type error
  (the `case` label no longer overlaps the union). React-free → unit-testable without a DOM.

- `function subscribeSessionId(onDaemonEvent, setSessionId): () => void` — subscribe via the injected
  `onDaemonEvent`, translate each event, and write **on `!== null`** (see guard note below). Returns
  the off-handle so the component can use it as effect cleanup. The listener only dispatches; it never
  throws into React. Signatures:
  - `onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void`
  - `setSessionId: (id: string) => void`

- `function SessionIdData(): null` — the App-level headless binding. **One** `useEffect(() => …, [])`
  that `return`s `subscribeSessionId(window.pyry.onDaemonEvent, (id) => sessionIdStore.getState().setSessionId(id))`.
  Renders `null`. Dereferences `window.pyry` **only inside the effect**, never during render, so it
  server-renders to `''` without a bridge mock (the `ConversationListData` invariant). No `useState`,
  no `useRef`, no `useSessionStore`, no request effect — reactive-only.

**Guard is `!== null`, not truthiness.** In `subscribeSessionId`, write when
`translateSessionTransition(event) !== null` — **not** `if (id)`. Rationale mirrors
`conversationListBridge`'s deliberate `list !== null` (empty array is truthy): here `if (id)` would
silently drop an empty-string session_id. The holder holds the daemon's value verbatim (AC4, no
coercion), matching how `runConfigStore` holds empty `model`/`effort` strings verbatim — so an empty
`newSessionId`, if the daemon ever emits one, is still recorded, not dropped by a falsy check.

### 3. `src/renderer/src/App.tsx` (modified) — mount the subscriber

Add `import { SessionIdData } from './store/sessionIdBridge'` and render `<SessionIdData />` inside the
existing fragment (App.tsx:90-98), directly next to `<ConversationListData />`. Same rationale as the
comment at App.tsx:85-89: a **component** (not a hook) isolates the subscription in its own leaf so it
never cascades a re-render into App; it renders `null`, preserving the neutral-paint invariant. This is
the one and only edit to an existing file, and the only consumer touched.

### Data flow

```
daemon → transport (#254) → main emits DaemonEvent{sessionTransition,newSessionId}
      → window.pyry.onDaemonEvent  ─┬─ useDaemonEventBridge   (existing, no-ops it)
                                    ├─ useTimelineBridge      (existing, no-ops it)
                                    ├─ useModalBridge         (existing, no-ops it)
                                    ├─ ConversationListData   (existing, no-ops it)
                                    └─ SessionIdData (NEW) → translateSessionTransition
                                                           → setSessionId → sessionIdStore
      → #257 reads via useSessionIdStore(selectSessionId)
```

---

## State + concurrency model

- **Single source of state:** the `sessionIdStore` singleton. One slice (`sessionId: string | null`),
  one write path (`setSessionId`, invoked only by `SessionIdData`'s effect, never two-way-bound from a
  component). Read-only selector. Unidirectional, matching the house rule.
- **Subscription lifecycle:** one app-lifetime listener registered on mount, torn down via the returned
  off-handle on unmount. No subscribe/unsubscribe churn on route flips (the leaf is App-level, mounted
  unconditionally in the fragment). StrictMode's dev double-mount nets exactly one live listener because
  the effect returns its cleanup — the `useDaemonEventBridge` idiom.
- **No async, no request, no cancellation surface:** the daemon *pushes* markers; nothing is requested,
  so there is no in-flight command, no `AbortController`, no connected-edge arming. Strictly smaller than
  both #187 (requests on sheet-open) and #208 (requests on connected-edge).

## Error handling

There is no failure surface to handle. The filter is total (`default: null` covers every non-owned arm,
including any future arm). The setter cannot fail (a synchronous `set`). No network, socket, parse, or
permission path is touched — those all live upstream in the transport. The listener never throws into
React (it only dispatches a synchronous store write). No banner/dialog/silent decision to make.

## Testing strategy

`npm test` (vitest), two new files cloned from the #208 tests. All React-free except one server-render
sanity check. `npm run typecheck` covers the type-level contracts (the `case` label overlap that makes
an arm rename a compile error).

**`sessionIdStore.test.ts`** — plain-function tests over isolated `createSessionIdStore()`:
- starts not-seen — `sessionId` is `null`; `selectSessionId` returns `null` (AC1).
- `setSessionId('s1')` records it; `selectSessionId` returns `'s1'` (AC2).
- a later `setSessionId('s2')` replaces `'s1'` — most-recent-wins, whole-value replace (AC2).
- holds an empty string verbatim — `setSessionId('')` → `selectSessionId` returns `''`, not `null`
  (AC4 verbatim-hold; distinguishes "empty id" from "no marker seen").
- two `createSessionIdStore()` instances stay independent; starts from an injected initial state (DI).
- `setSessionId` reference stays stable across updates.

**`sessionIdBridge.test.ts`** — injected-spy tests (the `fakeBridge` helper from #208):
- `translateSessionTransition` maps a `sessionTransition` to its `newSessionId` (the owned arm).
- `translateSessionTransition` returns `null` for a sample of unrelated arms — `connecting`,
  `disconnected`, `messageReceived`, `snapshotReceived`, `conversationsReceived` (AC3, the filter).
- `subscribeSessionId` subscribes exactly once.
- `subscribeSessionId` calls `setSessionId` with `newSessionId` on a `sessionTransition` (AC1 write).
- a **second** `sessionTransition` calls `setSessionId` again with the new id — last-write-wins at the
  subscribe layer (AC2).
- `subscribeSessionId` does **not** call `setSessionId` for an unrelated event (AC3).
- an empty-string `newSessionId` still writes — proves the `!== null` guard, not truthiness (AC4).
- `subscribeSessionId` returns the off-handle as cleanup (calling it calls the bridge's off spy once).
- drives a real `createSessionIdStore()` from `null` to the id on a `sessionTransition` (seam test).
- `SessionIdData` server-renders to empty markup without touching `window.pyry`
  (`renderToStaticMarkup`, the `ConversationListData.test` idiom).

Effect timing (deps/StrictMode single-listener) is verified by inspection against the
`ConversationListData` subscribe-effect idiom, not unit-tested — same posture as #208.

## Open questions

None blocking. Two notes for the developer:

1. **Empty-string session_id is held, not dropped** — the `!== null` guard is deliberate (see Design).
   If review prefers to *also* reject empty ids, that is a behavior change requiring a product call;
   the spec's position is verbatim-hold (AC4), matching `runConfigStore`. Do not add validation without
   one.
2. **`sessionTransition` is already no-op'd in all three exhaustive bridges** (merged #254). Confirm
   `npm run build` stays green after adding the fifth subscriber — you are not editing those bridges,
   only adding an independent listener, so no exhaustiveness guard is affected.
