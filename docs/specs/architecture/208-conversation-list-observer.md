# #208 — Observe the conversation list into a renderer store slice

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/208
**Size:** S · **Security-sensitive:** No (pure renderer state fed by already-typed events) · **Figma:** N/A (headless store slice + binding, no visible surface)
**Blocked by:** #139 (transport half — merged as PR #209)

This is the **store half** of the conversation-list data foundation. The transport half (#139) already ships the entire main-process request path: the `requestConversations` `RendererCommand`, its receiver guard, the `index.ts` route, `daemonConnection.requestConversations()` → `buildListConversations`, the `conversations` decode, and the typed `conversationsReceived` `DaemonEvent`. **This ticket adds no main-process, IPC, wire, or Noise code** — it lands the already-typed reply in a dedicated renderer store slice and triggers the existing request path from the renderer.

---

## Files to read first

Read these before writing any code — they carry the exact patterns to mirror, and the developer's turn-1 orientation depends on them.

- `src/renderer/src/store/runConfigStore.ts` — **the store shape to mirror verbatim**: DI factory → app singleton → narrow-slice hook → read-only selector, with a **single setter (not a reducer)** and a `null` "not yet loaded" sentinel. Your store is this with the payload type swapped.
- `src/renderer/src/store/runConfigStore.test.ts` — the plain-function store-test idiom (isolated `create…Store()` instances, no React). Your store tests mirror these one-for-one.
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts` — **the pure data-path helpers to mirror**: `toRunConfigSnapshot` (the filter), `requestRunConfigSnapshot` (fire the command), `subscribeRunConfig` (subscribe → translate → write, returns the off-handle). Note it uses `default: null` in the filter (not `assertNever`) — deliberate, and correct for you too (see Design §3).
- `src/renderer/src/screens/conversation/runConfigSnapshot.test.ts` — the framework-free data-path test idiom, including the `fakeBridge()` helper (captures the listener, hands back an `off` spy). Lift `fakeBridge` verbatim.
- `src/renderer/src/store/timelineBridge.ts` — the closest **structural** precedent for the bridge file: an app-level channel subscriber that keeps the pure translate/subscribe helpers **and** the React entry point in one `.ts`. Your bridge file has this shape (helpers + a headless binding).
- `src/renderer/src/screens/conversation/RunConfigData.tsx:11-35` — the **headless-component + StrictMode one-shot `useRef` guard** idiom (subscribe effect whose cleanup is the off-handle; request effect guarded so the dev double-invoke fires exactly once). Your binding reuses this, with the request effect keyed on `connected` instead of firing on mount.
- `src/renderer/src/screens/conversation/RunConfigData.test.tsx` — the server-render-to-empty-markup container test idiom (headless component renders `null` without touching `window.pyry`).
- `src/shared/ipc/events.ts:84` — the `conversationsReceived` arm you consume: `{ type: 'conversationsReceived'; conversations: readonly ConversationSummary[] }`.
- `src/shared/wire/types.ts:198-206` — `ConversationSummary` (the row held verbatim): `id`, `name: string | null`, `is_promoted`, `is_archived`, `cwd`, `last_message_ts`, `last_used_at`. Read the doc-comment above it (185-197): `name: null` is a distinct "unnamed", `is_promoted` derives channel-vs-discussion downstream, `cwd` is untrusted opaque display text.
- `src/shared/ipc/commands.ts` (the `RendererCommand` union + `isRendererCommand`) — **confirm** `requestConversations` is already a bare member (it is, added by #139). You send it; you add no command and no builder.
- `src/renderer/src/store/sessionStore.ts:16-20,164-171` — `ConnectionStatus` (`status.type === 'connected'`) plus `useSessionStore` / `selectStatus`. Your binding reads the live connection status here for the request trigger.
- `src/renderer/src/App.tsx:42-77` — the app-shell container that mounts `useDaemonEventBridge()` app-level and unconditional. You mount the new headless binding here (see Design §4).
- `src/renderer/src/App.test.tsx:63-74` — the `renderToStaticMarkup(<App/>) === ''` neutral-paint test that **must stay green** after your App change (your binding renders `null` and touches `window.pyry` only in effects).

---

## Context

Desktop has a single conversation today. The Channel List screen (#141), the create-discussion affordance (#142), and every future list / navigation / archive feature need one unidirectional source of truth for the daemon's conversation list. This ticket creates that slice and keeps it live.

The design mirrors the Run-configuration data path exactly: a **dedicated store** (`runConfigStore`, #187) written by a **subscription binding** (`runConfigSnapshot` / `RunConfigData`, #181), **not** a facet of the session store. A conversation-list update never touches connection or message state, so the two stores stay orthogonal and a list arrival re-renders only components selecting this slice. Unidirectional is preserved: read-only selectors, one write path, no two-way binding.

The daemon serves the list as request/response (send `list_conversations`, receive one `conversations` reply), not as a push. This ticket requests the list so the slice populates; a richer refresh policy is out of scope.

---

## Design

### File layout

| File | New/Mod | Contents |
|------|---------|----------|
| `src/renderer/src/store/conversationListStore.ts` | **New** | The store slice (state + single setter + selector + DI factory + singleton + hook). |
| `src/renderer/src/store/conversationListBridge.ts` | **New** | Pure helpers (`translateConversationsEvent`, `requestConversationList`, `subscribeConversations`) **and** the headless React binding `ConversationListData`. `.ts` — the binding returns `null`, no JSX. |
| `src/renderer/src/App.tsx` | **Mod** | Render `<ConversationListData/>` app-level (see §4). ~5 lines. |
| `…/conversationListStore.test.ts` | **New** | Store-mechanics tests (mirror `runConfigStore.test.ts`). |
| `…/conversationListBridge.test.ts` | **New** | Data-path tests (mirror `runConfigSnapshot.test.ts`) + the not-loaded → loaded integration test. |

### 1. The store slice — `conversationListStore.ts`

A direct mirror of `runConfigStore.ts` with the payload swapped. Contract (signatures only — the developer writes the bodies against the `runConfigStore` precedent):

```ts
// null = distinct "not yet loaded" state (mirrors runConfigStore's snapshot: null).
// An empty array is a real, loaded "zero conversations" state — NOT null.
export interface ConversationListState {
  conversations: readonly ConversationSummary[] | null
}
export type ConversationListStore = ConversationListState & {
  setConversations: (conversations: readonly ConversationSummary[]) => void
}
export const initialConversationListState: ConversationListState  // { conversations: null }
export function createConversationListStore(init?): StoreApi<ConversationListStore>
export const conversationListStore  // app-wide singleton
export function useConversationListStore<T>(selector): T          // narrow-slice React binding for #141
export const selectConversations: (s: ConversationListState) => readonly ConversationSummary[] | null
```

- **Import** `ConversationSummary` from `@shared/wire/types` (the renderer has the `@shared` alias; see `runConfigStore`/`sessionStore` imports).
- **`setConversations` replaces the whole array unconditionally** — most recent list wins, no merge, no dedupe (AC2). No coercion, no validation; the daemon's rows are stored as-is (AC3).
- **Rows are held verbatim in wire snake_case.** Do **not** invent a parallel camelCase renderer type and do **not** remap fields — unlike `runConfigSnapshot` (which remapped `used_tokens → usedTokens`), this arm reuses `ConversationSummary` directly, so holding it as-is keeps the slice drift-free with zero per-field transform.
- **No derivations in the slice** (AC3). No `kind` enum, no "unnamed" flag, no relative-time formatting. "Discussion vs channel" derives from the raw `is_promoted` flag, and "unnamed" is the literal `name === null`, both at the read boundary in #141 — not here. The slice's job is to hold and expose; #141 interprets.

### 2. The pure data-path helpers — `conversationListBridge.ts`

Mirror `runConfigSnapshot.ts`'s three helpers. Injected effects keep them React-free and unit-testable with plain spies.

```ts
// The filter: the one owned arm → its rows; every other DaemonEvent → null.
export function translateConversationsEvent(event: DaemonEvent): readonly ConversationSummary[] | null
// Fire the existing bare command (#139 wired the main side through to buildListConversations).
export function requestConversationList(sendCommand: (c: RendererCommand) => void): void
// Subscribe → translate → write; returns the off-handle from onDaemonEvent (the effect cleanup).
export function subscribeConversations(
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void,
  setConversations: (conversations: readonly ConversationSummary[]) => void
): () => void
```

Behavior:

- `translateConversationsEvent` — a `switch (event.type)` with **one** `case 'conversationsReceived': return event.conversations` and `default: return null`. Return `event.conversations` directly (select the one field) — this is a filter, not a rename, so there is no field-mapping and no fresh-literal reconstruction needed (that discipline guards against a top-level *event* gaining a field; here you already select a single named field). See §3 for why `default: null`, not `assertNever`.
- `requestConversationList` — `sendCommand({ type: 'requestConversations' })`. A bare command, inline literal typed as `RendererCommand`, no payload (mirrors the `requestRunConfigSnapshot` fire-and-forget shape but with the bare `requestConversations` member). No constructor added.
- `subscribeConversations` — `return onDaemonEvent((event) => { const list = translateConversationsEvent(event); if (list !== null) setConversations(list) })`. **Use `list !== null`, not `if (list)`** — an empty array is truthy, but the explicit `!== null` makes the "an empty list still writes (loaded-zero, not not-loaded)" intent unmistakable to a reviewer.

### 3. Filter uses `default: null`, not `assertNever`

`daemonEventBridge` and `timelineBridge` guard their filters with `assertNever` so a new `DaemonEvent` arm is a compile error that forces a mapping decision. **Do not do that here.** Follow the `toRunConfigSnapshot` precedent: `default: null`. Rationale — this path *deliberately and permanently* consumes only `conversationsReceived`; ignoring every other arm is the intended behavior, not an oversight. Adding a third `assertNever` on the channel would make every future arm a compile error in three files (ceremony without benefit). A rename of `conversationsReceived` is still caught either way (TypeScript flags a `case` label that no longer overlaps the union). This keeps the filter aligned with its named twin, `toRunConfigSnapshot`.

### 4. The headless binding — `ConversationListData` (in `conversationListBridge.ts`)

A headless component (`function ConversationListData(): null`) that owns two effects and renders nothing. Mounted **app-level in `App.tsx`**, alongside `useDaemonEventBridge()` — one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route flips, because the list must stay live for #141's Channel List regardless of which screen is shown.

```ts
export function ConversationListData(): null
```

Two effects (reuse the `RunConfigData.tsx` idiom):

1. **Subscribe (deps `[]`).** `return subscribeConversations(window.pyry.onDaemonEvent, (list) => conversationListStore.getState().setConversations(list))`. The returned off-handle is the effect cleanup, so a StrictMode double-mount nets exactly one live listener. `window.pyry` is dereferenced only inside the effect, never during render.
2. **Request on the rising edge to `connected` (deps `[isConnected]`).** Read `const isConnected = useSessionStore((s) => s.status.type === 'connected')`. Guard with a `useRef(false)`:
   - if `!isConnected` → reset the ref to `false` and return (so a later reconnect re-requests);
   - else if the ref is already `true` → return (StrictMode double-invoke fires exactly one request);
   - else set the ref `true` and `requestConversationList(window.pyry.sendCommand)`.

**Trigger decision (explicit, for code-review):** the request fires **once per connection episode** — on each rising edge `disconnected/…→connected`. This is the minimal reading of AC4 ("issued at least once, without user action, after the connection reaches `connected`") plus natural robustness: a reconnect gets a fresh list, and a request lost to a mid-flight disconnect recovers on the next connect. This is **not** the deferred "richer refresh policy" (that means intra-connection re-requests on archive change / focus / a future `conversation_updated`) — it is simply the list following the connection lifecycle. The `whole-list replace` setter (§1) makes each re-request's arrival idempotent.

**Mount point.** In `App.tsx`, wrap the existing return in a fragment and add the binding as a sibling of `<AppView/>`:

```tsx
return (
  <>
    <ConversationListData />
    <AppView route={route} onPaired={…} onUnpaired={…} />
  </>
)
```

A **component** (not a hook called directly in `App`) is deliberate: the connected-gate reads the session store via `useSessionStore`, so a hook in `App` would subscribe `App` to status flips and (because `App`'s inline `onPaired`/`onUnpaired` arrows are unstable) cascade a re-render into `ConversationScreen` on every connect/disconnect. Isolating the read in a headless leaf keeps that re-render off `App`. This diverges from `timelineBridge`'s hook form because no list render-component exists yet to host a hook — a dedicated headless mount is the app-level equivalent.

---

## State + concurrency model

- **One store slice, one write path.** `conversationListStore` holds `conversations: readonly ConversationSummary[] | null`. The sole mutation is `setConversations`, invoked only by the subscription wiring — never two-way-bound from a component. Read surface is `selectConversations` / `useConversationListStore`.
- **Stream consumption** is event-emitter style over the internal channel: `subscribeConversations` registers one listener via `window.pyry.onDaemonEvent` and returns its off-handle. No async iterables, no `AbortController` needed.
- **Teardown.** The subscribe effect's cleanup is the off-handle, so unmount (and the StrictMode double-mount) leaves exactly one or zero live listeners. The binding is app-lifetime in practice (mounted at the app root), so it lives for the window's lifetime.
- **Request** is fire-and-forget (`sendCommand` returns `void`), gated by the `connected` edge + ref guard (§4). No awaiting, no in-flight tracking.
- **Re-render isolation.** Selecting the derived boolean `status.type === 'connected'` (not the whole status object) minimizes the binding's own re-renders; mounting it as a leaf keeps those re-renders off `App`/`AppView`/`ConversationScreen`.

---

## Error handling

This layer introduces no new failure modes — network, socket, parse, and permission failures are all handled upstream in the transport half (#139); the renderer receives only already-typed events.

- **Unrelated events** no-op (`translateConversationsEvent` → `null`, setter not called).
- **The listener never throws into React** — `translateConversationsEvent` is total and `setConversations` is a pure `set`.
- **Empty list** (`conversations: []`) is written as a real loaded state — the UI (#141) tells "zero conversations" (`[]`) from "not loaded yet" (`null`) by the sentinel.
- **No reply / list never arrives** — the slice stays `null`; #141 renders its own loading affordance. Out of scope here.

No banner, dialog, or silent-drop path is added.

---

## Forward notes (carried from #139's security review, for #141)

- **`cwd` is untrusted daemon-supplied opaque display text.** This ticket only stores and reads it as a string — no filesystem use, so nothing is gated here. When #141 (or any later "open workspace" feature) resolves `cwd` into a real path, it **must** boundary-check it (`path.resolve` + known-root prefix) before any filesystem access. Do not treat `cwd` as trusted.
- **`name`, `is_promoted`, `is_archived`, timestamps** are display data; #141 derives "unnamed" (`name === null`), "channel vs discussion" (`is_promoted`), archived state, and a relative "last active" time (from `last_message_ts`) at its read boundary — none of that is baked into this slice.

---

## Testing strategy

`npm test` (vitest), plain-function tests over isolated `create…Store()` instances and injected spies — no React harness, no Electron. `npm run typecheck` covers the type-level contracts. Mirror `runConfigStore.test.ts` and `runConfigSnapshot.test.ts` (lift its `fakeBridge()` helper).

**`conversationListStore.test.ts`** (store mechanics — AC1/AC2/AC3):
- starts with `conversations: null` (not loaded); `selectConversations` returns `null`.
- `setConversations` records the list; `selectConversations` returns it.
- a later `setConversations` **replaces** the held list — most recent wins, no merge, no dedupe (feed list A, then a shorter/disjoint list B; assert exactly B).
- holds an **empty** list verbatim — `setConversations([])` → `selectConversations` returns `[]`, **not** `null` (the loaded-zero vs not-loaded distinction, AC1).
- holds a row verbatim in snake_case — set one `ConversationSummary` including `name: null` and assert every field (`id`, `name`, `is_promoted`, `is_archived`, `cwd`, `last_message_ts`, `last_used_at`) is held unchanged (AC3).
- two stores stay independent (DI); starts from an injected initial state (DI).
- `setConversations` reference is stable across updates.

**`conversationListBridge.test.ts`** (data path — AC2/AC4/AC5):
- `translateConversationsEvent` maps a `conversationsReceived` event to its `conversations` array (identity of the rows).
- `translateConversationsEvent` maps an **empty** `conversationsReceived` to `[]` (not `null`).
- `translateConversationsEvent` returns `null` for a sample of unrelated events (`connecting`, `disconnected`, `snapshotReceived`, `messageReceived`).
- `requestConversationList` calls `sendCommand` exactly once with `{ type: 'requestConversations' }` (spy).
- `subscribeConversations` writes the translated list via `setConversations` on a `conversationsReceived` event (`fakeBridge` + spy setter); does **not** call the setter for an unrelated event; **does** call it (with `[]`) for an empty list; returns the off-handle as cleanup (invoke it → `off` called once).
- **not-loaded → loaded transition (AC5):** wire a real `createConversationListStore()` to `subscribeConversations` (setter = the store's `setConversations`); assert `conversations` is `null` before, emit a `conversationsReceived`, assert the store now holds the list. This exercises the store↔bridge seam end-to-end.

**The `ConversationListData` binding is not unit-tested for effect timing** (deps/refs/StrictMode) — mirroring the `RunConfigData` precedent, that thin lifecycle glue is verified by inspection against the established one-shot-ref idiom, and the pure helpers above carry the testable logic. Optionally add one server-render sanity test (the `RunConfigData.test.tsx` idiom: `renderToStaticMarkup(<ConversationListData/>) === ''`, no throw) to pin "headless, touches `window.pyry` only in effects." The developer should state the no-effect-test rationale in the PR. **Verify `App.test.tsx`'s `renderToStaticMarkup(<App/>) === ''` stays green** after the fragment change (the binding renders `null`; its effects don't run under server render, so `window.pyry` is never touched).

---

## Open questions

- **Per-connection-episode request vs fire-once-ever.** The spec chooses per-episode (§4) as more robust and still within AC4's "at least once". If the operator/PO prefers strictly-once-per-app-lifetime, drop the `!isConnected → reset` branch (fire once, never reset). Either is a one-line difference; the per-episode choice is the recommended default and is documented as deliberate so code-review reads it as intentional, not a leak of the deferred refresh policy.
- **`useConversationListStore` has no consumer yet** (#141 is its first). It is exported now for the same reason `useRunConfigStore` shipped ahead of #188 — the store's React read surface belongs with the store. No component consumes it in this ticket.
