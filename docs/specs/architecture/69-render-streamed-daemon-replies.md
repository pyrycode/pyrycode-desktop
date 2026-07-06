# Spec #69 — Render streamed daemon replies in the conversation thread

**Size:** XS (PO sized `size:xs`; confirmed — 2 production files, ~1 net-new export, no consumer fan-out).

Bind the conversation thread to the live session store so streamed replies render in the
window. This is the renderer-only half of showing a daemon reply: the background decode that
fills the store already landed (#68); this ticket swaps the thread's data source from the
static `placeholderMessages` array to `useSessionStore(selectMessages)`, adapting the wire
`MessagePayload` to the shell's `Message` view model at the boundary.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1-63` — the whole shell. `ConversationScreen` (the seam to change), `MessageThread({ messages })` (keeps its `Message[]` prop), `MessageBubble` (unchanged — renders `message.type` into the CSS class + `data-message-role`).
- `src/renderer/src/screens/conversation/placeholderMessages.ts:6-9` — the `Message` view-model union (`{id;type:'user'|'daemon';text}`). This file is **deleted** by this ticket; the `Message` type relocates (see Design).
- `src/renderer/src/store/sessionStore.ts:110-133` — `initialSessionState`, the `sessionStore` singleton, the `useSessionStore(selector)` hook, and `selectMessages` (returns `readonly MessagePayload[]`, stable ref across status-only changes). The read surface this ticket binds to.
- `src/renderer/src/store/sessionStore.test.ts:130-144` — already proves `selectMessages` returns the same ref across a status-only change and a new ref after an append. The store-level re-render-narrowness guarantee is **already tested here**; this ticket does not re-prove it.
- `src/shared/wire/types.ts:63,87-92` — `WireRole = 'user' | 'assistant'` and `MessagePayload` (`conversation_id`, `message_id`, `role`, `text`). The adapter's source shape.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-43` — the current test (node env, `renderToStaticMarkup`, `data-message-role` count). Rewritten by this ticket; keep the same render harness.
- `src/renderer/src/store/daemonEventBridge.test.ts:20-74` — the `msg(id, role)` fixture pattern and the dispatch-into-a-store idiom to mirror in the component test.
- `src/renderer/src/screens/conversation/conversation.css:34-63` — confirms `--user` = right-aligned/`primary-container`, `--daemon` = left-aligned/`surface-container-high`. No CSS change; the adapter must preserve this role→type mapping.
- `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` — fixes this exact adapter seam (Decision ¶4, Consequences ¶2): store holds wire `MessagePayload`; the `role→'daemon'` / `message_id→id` transform is the #12 component-boundary job.
- `docs/knowledge/features/conversation-shell.md` (Seams) — the `MessageThread({ messages })` seam contract; "keep the array the sole data source so the swap stays minimal."

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

A dark vertical thread of message bubbles: **user** messages are right-aligned with the
`primary-container` fill and a clipped bottom-right corner; **assistant/daemon** messages are
left-aligned with the `surface-container-high` fill and a clipped bottom-left corner. This
ticket changes **only the data feeding those bubbles** — the bubble styling, alignment, and
corner geometry are unchanged from #1. The tool-call chip, session delimiter, code block, app
bar, and status row visible in the node remain out of scope (deferred per the conversation-shell
feature doc). The adapter's role→type mapping is what selects each bubble's alignment/fill, so
`'user'→'user'` and `'assistant'→'daemon'` must hold exactly.

## Context

The conversation shell (#1) renders `MessageThread({ messages })` over the static
`placeholderMessages` array. The session store (#2, ADR 0004) holds the live message list as
`readonly MessagePayload[]`, fed by the daemon-event bridge (#68/#19) and exposed through
`selectMessages` + `useSessionStore`. ADR 0004 deliberately deferred the wire→view-model
presentation transform to this component boundary: the store keeps wire types verbatim (zero
drift from the mobile contract), and the UI adapts `role`/`message_id` when it renders.

This is renderer-only. No keys, sockets, IPC, or transport (CLAUDE.md). The composer stays
inert — controlled input and the send dispatch are #66.

## Design

### Module structure

Three edits, one new file, two deletions:

1. **New — `src/renderer/src/screens/conversation/messageViewModel.ts`.** The new home for the
   `Message` view-model type (relocated verbatim from `placeholderMessages.ts`) plus the pure
   adapter. Framework-free `.ts` module so the adapter unit-tests without React or a store.

   ```ts
   export type Message =
     | { id: string; type: 'user'; text: string }
     | { id: string; type: 'daemon'; text: string }

   export function toMessageViewModel(m: MessagePayload): Message
   ```

   **Adapter contract** (total over `WireRole`): `message_id → id`; `role: 'user' → type: 'user'`,
   `role: 'assistant' → type: 'daemon'`; `text` carried through unchanged; `conversation_id`
   dropped (not read into the returned object). Implement as an exhaustive `switch (m.role)` with
   an `assertNever(role)` default — mirror the sealed-union idiom already in `reduceSession` /
   `translateDaemonEvent`, so a future third `WireRole` becomes a compile error here rather than
   silently mapping to `'user'`. Behavior summary only — no >20-line body; the adapter is ~10 lines.

2. **Modify — `ConversationScreen.tsx`.** Replace the placeholder import with the store binding.
   - Drop `import { placeholderMessages, type Message } from './placeholderMessages'`.
   - Add `import { toMessageViewModel, type Message } from './messageViewModel'` and
     `import { useSessionStore, selectMessages } from '../../store/sessionStore'` (relative import,
     matching the file's existing style; `@renderer/store/sessionStore` also resolves).
   - In `ConversationScreen`: read the slice and adapt at the store-read boundary, then pass the
     `Message[]` to the unchanged `MessageThread` prop:
     `const messages = useSessionStore(selectMessages).map(toMessageViewModel)`.
   - `MessageThread` keeps its `{ messages: Message[] }` prop; `MessageBubble` is untouched. The
     seam named in the conversation-shell feature doc is preserved exactly — only the source of
     the `messages` prop changes.

3. **Delete — `placeholderMessages.ts` and `placeholderMessages.test.ts`.** Once the thread no
   longer imports the array, both are dead (the test asserts only the array's shape). The array
   was scaffolding introduced expressly as the swap target for this ticket (AC5); removing it is
   in-scope, not adjacent refactoring. Grep confirms no other consumer: `placeholderMessages` and
   the `Message` type are referenced only by `ConversationScreen.tsx` and these two test files.

### Data flow

```
daemon frame (#68 decode) → sessionStore.dispatch(messageReceived|messagesReceived)
  → appendUnique (dedupe by message_id, arrival order preserved) → state.messages: readonly MessagePayload[]
  → useSessionStore(selectMessages) [subscribes to messages slice only]
  → .map(toMessageViewModel) → Message[]
  → MessageThread → MessageBubble (message.type → class + data-message-role)
```

The store already dedupes by `message_id` and preserves arrival order (`appendUnique`, ADR 0004).
The component does **not** re-sort, coalesce, or assemble tokens — `message_chunk` batches carry
complete messages. Rendering is a straight map over the slice in store order.

## State + concurrency model

- **Store slice:** `selectMessages` only. Selecting the single slice is what keeps status
  changes (`connecting`/`connected`/`disconnected`/`error`) from re-rendering the thread —
  `reduceSession` returns the same `messages` reference on every status action, so Zustand's
  `useStore` (Object.is on the selected value) skips the re-render. This narrowness is already
  proven at the store level (`sessionStore.test.ts:135-138`); the component just consumes it.
- **The `.map(toMessageViewModel)` runs per `ConversationScreen` render.** That is fine — the
  component only re-renders when `selectMessages` actually changes reference (i.e. a new message
  landed). No `useMemo` — the map is O(n) over a small thread and there is no observed perf issue
  (evidence-based-fix rule; don't pre-optimize).
- **No effects, no subscriptions, no teardown in this ticket.** The daemon-event subscription
  lives in `useDaemonEventBridge` (already wired in `App.tsx`); this component is a pure reader.
  Nothing to cancel on unmount.
- **Empty store → empty thread.** `selectMessages` returns `[]` on `initialSessionState`;
  `[].map(...)` is `[]`; `MessageThread` renders an empty scroll region. No crash, no placeholder
  fallback — the current `messages.map` already handles the empty case, so no new empty-guard code.

## Error handling

Renderer-only, no failure surfaces this ticket touches (no network, socket, parse, or
permission). The one boundary is the adapter over `role`: `WireRole` is a sealed two-member
union and the store holds already-validated wire payloads (decoded upstream in #68), so the
exhaustive `switch` + `assertNever` is total and needs no runtime guard for malformed input.
Connection-error surfacing (the `status.error` banner) is a separate seam owned by a later
ticket and is out of scope here.

## Testing strategy

Node env + `renderToStaticMarkup` throughout (no jsdom/Testing Library — none is a dep, and the
static-markup harness is sufficient; keep it, per #1's deferral note). `npm test` (vitest) and
`npm run typecheck` are the gates.

**New — `messageViewModel.test.ts`** (pure adapter, no store, no React). Scenarios:
- `role: 'assistant'` → `type: 'daemon'`.
- `role: 'user'` → `type: 'user'`.
- `message_id` maps to `id`; `text` carried through byte-for-byte.
- `conversation_id` is dropped — the returned object has no `conversation_id` key (its keys are
  exactly `id`, `type`, `text`).

**Rewrite — `ConversationScreen.test.tsx`** (drives the singleton store; import `sessionStore`
from the store module). Reset in `beforeEach` via `sessionStore.setState({ status: { type: 'disconnected' }, messages: [] })`
(Zustand `setState` shallow-merges, preserving `dispatch`). Populate by dispatching real actions
(`sessionStore.getState().dispatch(...)`), mirroring how the bridge feeds it. Use distinct
`message_id`s (the store dedupes). Scenarios:
- **Empty store** → renders without throwing; zero `data-message-role` bubbles; none of the old
  placeholder strings present (AC4, AC5).
- **A `messagesReceived` batch** of mixed roles → one bubble per message in store order; assistant
  messages carry `data-message-role="daemon"`, user messages `data-message-role="user"`; each
  `text` appears (AC1, AC2, AC3).
- **Append via a second `messageReceived`** after an initial batch → the new text appears **and**
  every prior text still appears in its original order — nothing dropped or reordered (AC3).
- The suite no longer imports `placeholderMessages`; the rendered bubbles derive solely from
  dispatched store data (AC5).

Store-level re-render narrowness (status-only change → no new messages ref) is already covered by
`sessionStore.test.ts:135-144`; do not duplicate it here.

## Open questions

- **`renderToStaticMarkup` + `useStore`.** This is the first component test rendering a
  store-bound component. Zustand v5's `useStore` supplies a `getServerSnapshot` (its `getState`),
  so server rendering reads the current singleton state — the dispatch-then-render pattern works
  as written. If React ever warns about a missing server snapshot, that is a Zustand-version
  signal, not a design change; a DOM harness remains out of scope (deferred per #1). Expected: no
  issue.
- **Adapter boundary.** Adapting in `ConversationScreen` (at the store read) vs. inside
  `MessageThread` — this spec picks the store-read boundary to keep `MessageThread`'s `Message[]`
  prop and `MessageBubble` untouched, matching the feature doc's seam. Not expected to reopen.
