# #296 — Drop a queued message: drop affordance on queued rows

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:393-437` — the `QueuedBacklog` pure view (#294) and its `QueuedBacklogControl` container. This is the primary edit site: `QueuedBacklog` gains a required `onDrop` prop and a per-row drop button; the container binds it. Note the existing row markup (`.message-row--user` > `.bubble--user[data-thread-role="queued"]`) and `selectMilestoneBacklog = selectBacklogFor(MILESTONE_CONVERSATION_ID)`.
- `src/renderer/src/screens/conversation/modalResolution.ts:38-97` — **the precedent to mirror.** `cancelPrompt` is the closest analogue: a pure, React-free guarded-send helper (`try { sendCommand(...) } catch { console.error }`) with an injected `sendCommand` dep, plain-spy tested under the `node` env. Your `dropQueuedMessage` helper is a strict subset of this — same guarded send, but **no** local `dispatch` (AC3 forbids optimistic removal) and no camelCase→snake rename (wire fields are already snake_case).
- `src/renderer/src/screens/conversation/composerSend.ts:17,43-67` — `MILESTONE_CONVERSATION_ID = 'default'` (the conversation id the container supplies) and `submitMessage`'s guarded-send shape (`try/catch` swallow around `sendCommand`, the AC4 "a bridge failure must not crash the window" idiom).
- `src/renderer/src/screens/conversation/PermissionModal.tsx:34-48,204-233` — the injected-effect discipline: the pure view takes a **required** effect prop (`onSelect`/`onCancel` — "a view that cannot answer is a bug"); the thin container dereferences `window.pyry.sendCommand` **only inside the handler closure** (interaction time), so the view's server-render test stays bridge-free.
- `src/shared/ipc/commands.ts:118-127` — `dequeueMessageCommand({ conversation_id, queued_msg_id }): RendererCommand` (#300). Already built; import from `@shared/ipc/commands`. Dispatch via `window.pyry.sendCommand`.
- `src/shared/wire/types.ts:333-378` — `QueuedItem` (`{ queued_msg_id: number, text, ts }`, no `conversation_id`) and `DequeueMessagePayload` (`{ conversation_id: string, queued_msg_id: number }`). Confirms `queued_msg_id` is a `number` and the row carries no conversation id (the "conversation-id wall" — see Context).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:414-460` — the existing `QueuedBacklog` describe block. **The test cascade lives here:** four `<QueuedBacklog items={...} />` render calls (lines 429, 434, 444, 456) will need the new required `onDrop` prop; add the new drop-affordance scenarios in this block.
- `src/renderer/src/screens/conversation/conversation.css:364-371` (`.conversation__queued`) and `:674-700` (`.status-sheet__close` icon-button idiom) — the queued region (a dimmed 50%-opacity flex column) and the transparent-bg / hover-surface / focus-visible-outline icon-button treatment to reuse for the drop control.

## Context

`QueuedBacklog` (#294) renders the messages queued while the daemon is busy — the not-yet-run tail below the delivered thread, read from #293's replacement-truth queue store. Today those rows are inert display. This slice adds a **drop / cancel** affordance to each queued row that dispatches `dequeueMessage` (#300) for that entry, so the user can cancel a message before it runs.

Both prerequisites have merged: the render (#294, `QueuedBacklog`) and the command (#300, `dequeueMessageCommand`). This is a **pure renderer wire-together** — no new IPC channel, no preload change, no main-side work, no wire-type change. The renderer→main boundary guard (`isDequeueMessagePayload`) already lives main-side in #300.

**The conversation-id wall.** `QueuedItem` is `{ queued_msg_id, text, ts }` — it carries **no** `conversation_id`, and `QueuedBacklog` receives only `readonly QueuedItem[]`, so no conversation id is in scope at the view. But `dequeueMessage` needs one. The active conversation is the single milestone constant `MILESTONE_CONVERSATION_ID` (`'default'`) — the same constant `QueuedBacklogControl` already reads the backlog under (`selectBacklogFor(MILESTONE_CONVERSATION_ID)`) and the composer sends under. The **container** supplies it; the view stays conversation-id-free. Do **not** add nav plumbing or thread a per-item conversation id — it does not exist on the wire type (this is the same wall #294 hit).

**No optimistic removal (AC3).** Activating the affordance dispatches the command and does nothing else — it never mutates the queue store. The row disappears only when the daemon's next `queue_state` snapshot replaces the backlog and the existing live render (#294 reading #293's replacement-truth store) carries the change. This is why the helper is a strict subset of `cancelPrompt`: guarded send, **no** local dispatch.

## Design

### 1. `dropQueuedMessage.ts` — the pure guarded-send helper (new file)

Co-located with the screen, mirroring `modalResolution.ts` / `composerSend.ts`: framework-free, React-free, injected effect, so the guarded `try/catch` is unit-testable under the `node` env (the view/container click path is not SSR-testable). This is the idiomatic home for the AC "activating dispatches `dequeueMessage` with the right ids" + "a bridge failure must not crash the window" logic — every sibling guarded send (`submitMessage`, `answerPrompt`, `cancelPrompt`, `runUnpair`) is extracted this way rather than inlined in a container.

Contract:

```ts
export interface DropQueuedMessageDeps {
  sendCommand: (command: RendererCommand) => void
}

// Drop one queued message. Guarded send only — NO local dispatch (AC3: no optimistic
// removal). Swallows a bridge throw (console.error), never propagates (AC "unaffected window").
export function dropQueuedMessage(
  conversation_id: string,
  queued_msg_id: number,
  deps: DropQueuedMessageDeps
): void
```

Behavior: `try { deps.sendCommand(dequeueMessageCommand({ conversation_id, queued_msg_id })) } catch (error) { console.error('drop queued message send failed', error) }`. No dispatch, no rename (wire fields already snake_case), no return value. This is `cancelPrompt` minus the dispatch and minus the rename.

### 2. `QueuedBacklog` — add the required drop affordance (modify)

Add a **required** injected-effect prop (the `PermissionModalView` / `RepairPrompt` "a view that cannot answer is a bug" rule; making it required is what drives the small in-file test cascade):

```ts
export function QueuedBacklog({
  items,
  onDrop
}: {
  items: readonly QueuedItem[]
  onDrop: (queuedMsgId: number) => void
}): JSX.Element | null
```

`onDrop` takes only the `queued_msg_id` (a `number`) — the container owns the conversation id, so the view never sees it (the conversation-id wall). Inside each row (still keyed by `item.queued_msg_id`), render the drop control as a **sibling of the `.bubble--user`** inside `.message-row--user`:

- An icon-only `<button type="button">` with `onClick={() => onDrop(item.queued_msg_id)}`.
- **`aria-label` is mandatory** — icon-only controls need an accessible name (the `.composer__send` / `.status-sheet__close` idiom already in this file). Use a client-owned constant string (e.g. `'Drop queued message'`), never a daemon string.
- An inline SVG glyph marked `aria-hidden="true"` (a dismiss/cancel "×" or similar), the file's inline-SVG idiom (see `.status-sheet__close-icon` / `.composer__send-icon`).
- A new class (e.g. `.queued-row__drop`) for styling — see CSS below.

The button lives **only** inside the queued row. Delivered user/assistant rows are rendered by a different component (`Timeline` / `TimelineRow`) that this ticket does not touch, so AC4 (affordance only on queued rows) and AC5 (delivered rows unaffected) are **structural guarantees**, not conventions — there is no code path by which the button reaches a delivered row.

### 3. `QueuedBacklogControl` — bind the handler (modify)

Bind `onDrop`, dereferencing `window.pyry.sendCommand` **only inside the closure** (interaction time — the `Composer.handleSubmit` / `PermissionModal` discipline), so the empty-case container smoke test stays bridge-free:

```ts
<QueuedBacklog
  items={items}
  onDrop={(queuedMsgId) =>
    dropQueuedMessage(MILESTONE_CONVERSATION_ID, queuedMsgId, {
      sendCommand: window.pyry.sendCommand
    })
  }
/>
```

`MILESTONE_CONVERSATION_ID` is already imported into `ConversationScreen.tsx`.

### 4. `conversation.css` — the drop control (modify, minor)

Add a small `.queued-row__drop` rule reusing the `.status-sheet__close` icon-button treatment (`flex: 0 0 auto`, fixed square, `background: transparent`, `border: none`, `border-radius: var(--radius-full)`, `color: var(--color-on-surface-variant)`, hover → surface-container-high + on-surface, `:focus-visible` outline). All values tokenized (no bare literals — the file convention). Keep it minimal and token-consistent; desktop-specific visual design is deferred (see Design source). **Note:** `.message-row--user` is right-aligned; place the drop button as the leading (left) sibling of the bubble so it sits at the inner edge of the right-aligned row (developer discretion on exact flex placement).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8 (Conversation Thread Screen)

N/A for the drop-affordance visual — the same documented gap as #148's thread-chrome states and #294's queued row: the mobile Figma file draws only the delivered thread (Message list `16:21`) and has no queued-message row or drop/cancel control. Use a minimal, token-consistent dismiss/cancel icon button on the queued row, with a mandatory `aria-label` for its accessible name (the `.composer__send` / `.status-sheet__close` idiom already in this file). Desktop-specific visual design is deferred per the project design decision (2026-07-03). Code-review's visual-fidelity check is intentionally scoped to "token-consistent icon button," not pixel-parity against a node that does not exist.

## State + concurrency model

- **No new store, no new store slice.** The container's existing `useQueueStore(selectMilestoneBacklog)` subscription is unchanged — it already re-renders on a fresh `queue_state` snapshot, which is what removes a dropped row (AC3).
- **No optimistic mutation.** `dropQueuedMessage` performs a single fire-and-forget `sendCommand` and returns; it never touches `useQueueStore`. The queue store stays the single source of backlog truth (#293 replacement-truth). Unidirectional flow is preserved: view dispatches an effect → command travels to main → daemon → next `queue_state` snapshot → store replaced → re-render.
- **No effects, no lifecycle, no subscriptions added.** `window.pyry.sendCommand` is dereferenced only inside the click handler closure, never during render.

## Error handling

- **Bridge failure on send** (`window.pyry.sendCommand` throws): swallowed inside `dropQueuedMessage`'s `try/catch` with a `console.error`, never propagated — a failed drop must not crash the window (the `submitMessage` / `cancelPrompt` AC4 posture). The row simply remains (the daemon never received the drop), which is the honest state.
- **Out-of-range / stale `queued_msg_id`**: not policed client-side — a daemon-side no-op, matching the `isDequeueMessagePayload` guard's `typeof`-only posture (#300) and the #292 decode's requireNumber-alone stance. No client validation of the id.
- **No error UI surface.** This milestone has no send-failure surface for drops (mirrors the composer, which also has none); the deferred daemon-error reconciliation is out of scope.

## Testing strategy

All tests are renderer/`node`-env, `npm test` (vitest), the existing `ConversationScreen.test.tsx` file plus a new `dropQueuedMessage.test.ts`.

**`dropQueuedMessage.test.ts` (new)** — plain-spy tests, no React, no store (the `modalResolution.test.ts` idiom):
- Given a spy `sendCommand`, calling `dropQueuedMessage('default', 7, { sendCommand })` calls the spy exactly once with `dequeueMessageCommand({ conversation_id: 'default', queued_msg_id: 7 })` (assert the resulting command shape: `{ type: 'dequeueMessage', payload: { conversation_id: 'default', queued_msg_id: 7 } }`).
- Given a `sendCommand` that throws, `dropQueuedMessage(...)` does **not** throw (the guard swallows it).
- (Optional) It returns nothing and dispatches nothing — there is no store dep to mutate (AC3 is structural: the helper has no dispatch parameter).

**`ConversationScreen.test.tsx` — `QueuedBacklog` describe block (cascade + new):**
- **Cascade:** the four existing `<QueuedBacklog items={...} />` render calls (empty, two-item, distinct-role, untrusted-text) each gain `onDrop={() => {}}` to satisfy the now-required prop. The existing assertions are unchanged.
- **New — affordance present on queued rows (AC1):** server-render `<QueuedBacklog items={[item(1,'x'), item(2,'y')]} onDrop={...} />`; assert the markup contains the drop button's `aria-label` text (its accessible name) and that there is **one drop control per queued row** (e.g. count occurrences of the drop class, or of the `aria-label`, equals the item count).
- **New — the affordance carries the row's id (AC2):** since `renderToStaticMarkup` can't fire clicks, prove the wiring by rendering with an `onDrop` spy is **not** possible under SSR — instead assert the button is present per row and rely on the container binding + the pure-helper test for the id/command coverage. (If a click-firing test is desired, it needs the `jsdom`/testing-library path; the existing block uses `renderToStaticMarkup` under `node`, so prefer the structural per-row-button assertion here and let `dropQueuedMessage.test.ts` own the "right ids → right command" proof. Do not switch this block's env.)
- **New — empty backlog renders nothing (AC4 unchanged):** the existing empty→`''` test already covers "no region when empty"; with `items={[]}` the view returns null before any row (and thus any drop button) is rendered — no affordance with no rows.

**`npm run typecheck`** — the required `onDrop` prop makes any un-updated `<QueuedBacklog>` call site a compile error (the intended cascade signal). `dequeueMessageCommand` + `DequeueMessagePayload` are already typed; no new wire types.

## Open questions

- **Dimmed-region opacity vs. the interactive control.** `.conversation__queued` is at `opacity: 0.5` (the "waiting / not yet run" dimming). The drop button inherits that, so it renders at 50% opacity — which can read as *disabled*. Leave it dimmed (consistent with the waiting region) or bump the button back to full opacity for affordance clarity? Minimal, low-risk; developer's call at implementation, kept token-consistent either way. Not a blocker.
- **Glyph choice** (dismiss "×" vs. a trash/cancel icon) — cosmetic, developer's discretion within the file's inline-SVG idiom; the accessible name is carried by `aria-label`, not the glyph.
