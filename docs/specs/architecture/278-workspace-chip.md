# #278 — Workspace chip on the empty new-discussion thread

A pre-first-message pill at the top of the empty new-discussion thread showing the
workspace `cwd` the discussion will run in, with a "change" affordance whose target is
the Workspace Picker sheet (#157, not yet built → disabled placeholder). Renderer-only.

## Design source

N/A — the mobile Figma file (`g2HIq2UyPhslEoHRokQmHG`) has no frame for the empty
new-discussion thread or the workspace chip. Per the ticket body, the design is sourced
from the locked mobile design doc (a Material 3 pill, "Workspace: … (change)",
pre-first-message only; mobile #137). A request to add the frame is filed on parent #148.
The visual-fidelity check is intentionally sourced from the design doc, not a node.

## Files to read first

- `src/renderer/src/store/sessionIdStore.ts:19-58` — **the store template to clone.**
  `activeConversationStore` is this file with the held type changed from `string | null`
  to `ConversationCreatedPayload | null`: same DI-factory → singleton → `useStore` hook →
  selector structure, same single unconditional setter, same "hold the daemon value
  verbatim, no coercion" doctrine.
- `src/renderer/src/store/sessionIdStore.test.ts` — the store test template (initial value
  is `null`; the setter replaces verbatim; most-recent-wins). Clone its shape.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:46-103` — the container.
  Add one store read beside `items`/`phase` and mount `<WorkspaceChip …/>` between
  `<ConnectionBannerControl/>` (line 76) and `<Timeline …/>` (line 77).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:301-324` — `ThinkingIndicator`:
  **the exact idiom `WorkspaceChip` mirrors** — the container derives a value and passes it
  down; the pure view self-gates to `null`; no store read inside the view; the visible label
  is a client-owned constant, never a daemon string.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:595-613` — `ConnectionBanner`
  + `ConnectionBannerControl`: the sibling-affordance placement (`flex: 0 0 auto`, top of
  thread) and the "prove the present/absent matrix by server-rendering the pure view" discipline.
- `src/renderer/src/PairedShell.tsx:46-60` — the nav callback to extend. `useConversationCreatedNav`
  already delivers the decoded `created` payload to the callback (line 51 currently ignores it,
  passing `()`); change it to record the payload into `activeConversationStore` *and* dispatch
  the `open` nav. No new subscription, no new bridge.
- `src/renderer/src/store/conversationCreatedBridge.ts:53-87` — confirms `ConversationCreatedPayload`
  already reaches the nav callback; `conversationCreatedBridge.test.ts` already proves that path.
- `src/shared/wire/types.ts:532-550` — `ConversationCreatedPayload` (`id`, `is_promoted`,
  `cwd: string` always-present, `name: string | null`, `last_used_at`). The chip reads `cwd`
  and `is_promoted` only.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:74-101` — the server-render
  + escaping idiom: inject a `cwd` containing `<b>`/`<i>` (**no apostrophes** — `renderToStaticMarkup`
  escapes `'` → `&#x27;`, a repeat desktop gotcha), assert `&lt;b&gt;…&lt;/b&gt;` appears and raw
  `<b>` never does. Copy this for AC #2.
- `src/renderer/src/screens/conversation/conversation.css:134-196` — `.conversation__banner`
  and `.conversation__empty` blocks: the flex/token idiom the chip's CSS mirrors.
- `src/renderer/src/screens/conversation/conversation.css:316-330` — `.tool-row__chip`: the
  existing chip (inline-flex, gap, bounded width, border, radius) — the closest pill precedent.
- `src/renderer/src/theme/tokens.css:19-95` — tokens: `--radius-full` (pill shape),
  `--color-surface-container-high`, `--color-outline-variant`, `--color-on-surface`,
  `--color-on-surface-variant`, `--space-2`/`--space-3`/`--space-4`. No new token.

## Context

A new discussion is an unpromoted conversation created via the FAB (#242): the renderer
fires `create_conversation` (`is_promoted:false`, `name:null`, `cwd:null` → "take the daemon
default") and the daemon replies with `conversation_created` carrying the chosen `cwd`. That
reply reaches `PairedShell`'s `useConversationCreatedNav` callback, which today **drops the
payload** and only navigates to the thread. This ticket surfaces that `cwd` as a pill at the
top of the (empty) thread so the user can see — and later change (#157) — which workspace the
discussion will run in before sending the first message.

### Why not "correlate `sessionIdStore` with `conversationListStore`"

The ticket body floats correlating the session id with a conversation-list row. **Rejected —
there is no join key.** `sessionIdStore` holds a daemon *session* routing id from
`sessionTransition` (`sessionIdStore.ts:1-18`); `ConversationSummary` is keyed by conversation
`id` and carries no session id. The two are orthogonal ids. And `MILESTONE_CONVERSATION_ID =
'default'` (`composerSend.ts:17`) is a synthetic send-id, not guaranteed to appear in the
daemon's `conversations` list, so a `conversationListStore` lookup by it would usually miss.
The correct, narrow source is the **`conversation_created` payload's `cwd`**, captured when the
new discussion is created (the "read a snapshot" option). That value is exactly "the workspace
this discussion will run in," and it is already in hand.

## Design

Three production files. No new dependency. No transport/main-side change.

### 1. `activeConversationStore.ts` (NEW — `src/renderer/src/store/`)

A dedicated renderer store holding the conversation the thread is currently showing, written
when a new discussion is created. Clone `sessionIdStore.ts` verbatim, substituting the held type:

- State: `interface ActiveConversationState { activeConversation: ConversationCreatedPayload | null }`.
  `null` is the distinct "no conversation created/opened this session yet" state.
- Store shape adds the single setter `setActiveConversation(conversation: ConversationCreatedPayload): void`
  — unconditional replace (most-recent-wins), value held verbatim (snake_case, no remap — the
  `conversationListStore` doctrine).
- `createActiveConversationStore(init?)` DI factory → `activeConversationStore` singleton →
  `useActiveConversationStore(selector)` hook → `selectActiveConversation = s => s.activeConversation`.
- Held verbatim as `ConversationCreatedPayload` (not a projected shape): the drift-free
  `conversationListStore` idiom; the chip derives `cwd` + `is_promoted` at the read boundary.

Interface contract only — the developer clones `sessionIdStore.ts`'s ~40-line body; the sole
substantive difference is the held type and the setter name.

### 2. `PairedShell.tsx` (write the snapshot)

`useConversationCreatedNav` (line 51) already receives the decoded `created` payload and today
discards it. Change the callback to record it *and* navigate:

```ts
// contract sketch — the callback now consumes the payload it already receives
useConversationCreatedNav((created) => {
  setActiveConversation(created)      // NEW — snapshot the workspace cwd
  dispatch({ type: 'open' })          // unchanged nav
})
```

`setActiveConversation` is imported from the store (a component writing a store setter is the
established idiom — Composer dispatches to `timelineStore`, `UnpairControl` to `sessionStore`).
No new subscription: this reuses the one `conversation_created` listener PairedShell already
mounts. Server-renderability is unchanged (the callback fires only on a real daemon event, never
during render).

### 3. `ConversationScreen.tsx` (the chip)

**Pure view `WorkspaceChip`** — exported, props-in/markup-out, mirroring `ThinkingIndicator`:

```ts
// contract sketch — signature + gate only
export function WorkspaceChip({
  conversation,       // ConversationCreatedPayload | null
  isEmpty,            // boolean — the thread has no timeline items yet
  onChange            // optional () => void — the #157 Workspace Picker seam (omitted here)
}: WorkspaceChipProps): JSX.Element | null
```

- **Gate (self-gates to `null`):** render the chip iff `isEmpty && conversation != null &&
  !conversation.is_promoted`. `is_promoted` false is the wire signal for "discussion" (vs
  channel) — this makes the chip a new-*discussion*, pre-first-message affordance, exactly AC #1/#3.
- **Body:** a client-owned label constant (e.g. `WORKSPACE_CHIP_LABEL = 'Workspace'`, module-level
  like `EMPTY_THREAD_COPY` — apostrophe-free) + `{conversation.cwd}` rendered as **React children
  (auto-escaped)** + a "Change" button.
- **`cwd` is rendered whole and opaque (AC #2).** Never `dangerouslySetInnerHTML`; **never split,
  basenamed, or otherwise interpreted as a path** — extracting a path segment (`cwd.split('/').pop()`)
  would itself be "interpreting it as a filesystem path," which the AC forbids. Render the raw
  string; React escaping handles HTML-ish characters. This is the `toolCall`/`sessionBoundary`
  untrusted-string posture already in this file.
- **"Change" affordance (AC #4):** a `<button>` with an `aria-label`, `disabled={!onChange}` and
  `onClick={onChange}`. This ticket's container passes no `onChange`, so the button renders
  `disabled` — a visible, honest placeholder. #157 lands as a pure additive: pass `onChange` that
  opens the Workspace Picker sheet (Figma node 20-2), and the button un-disables. This is the exact
  optional-prop extension seam #276 reserves for #155 (`onChannelInfo?`).

**Container wiring** — add one store read beside `items`/`phase` at the top of `ConversationScreen`:

```ts
const activeConversation = useActiveConversationStore(selectActiveConversation)
```

and mount the chip as a **sibling above `Timeline`**, below the banner (between lines 76 and 77):

```tsx
<ConnectionBannerControl />
<WorkspaceChip conversation={activeConversation} isEmpty={items.length === 0} />
<Timeline items={items} now={now} />
```

**Why a sibling, not inside `EmptyThread`.** #277's CSS comment says the chip "pins to the top
of this surface," but do **not** thread `conversation`/`onChange` through `Timeline` → `EmptyThread`
to nest it inside `.conversation__empty`. `Timeline` is the pure thread-rendering view (contract:
`{ items, now }`); a workspace affordance is orthogonal, and widening `Timeline`'s props would
couple two concerns and cascade its test call-sites. A sibling `flex: 0 0 auto` chip above
`Timeline` yields the identical visual result — the pill sits at the top, the `.conversation__empty`
icon+copy (`flex: 1 1 auto`, centered) fills below — while `Timeline`'s contract stays untouched.
No new prop reaches `ConversationScreen` either (store read, not prop), so the many bare
`<ConversationScreen/>` server-render tests stay green with zero edits.

### 4. `conversation.css` (the pill)

Add `.conversation__workspace-chip` (+ a `__label` / `__cwd` / `__change` as needed). Mirror the
idioms already in the file — do not invent tokens:

- The wrapper is `flex: 0 0 auto`, horizontal padding `--space-4` (thread-aligned, the
  `.conversation__banner` convention), so the pill sits at the top and pushes the empty surface down.
- The pill itself follows `.tool-row__chip` (inline-flex, `gap: --space-2`, `padding: --space-2
  --space-3`, `max-width: 100%` / `min-width: 0` / `overflow` bounding so a long untrusted `cwd`
  can't blow out the layout — load-bearing given `cwd` is unbounded) but with `border-radius:
  --radius-full` for the Material 3 pill shape, `background: --color-surface-container-high`,
  `border: 1px solid --color-outline-variant`, `color: --color-on-surface`.
- The `cwd` run ellipsizes (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) — the
  `.tool-row__summary` treatment.
- The "Change" button is a compact text button (`--color-on-surface-variant`, link-like); its
  `:disabled` state reads muted. Reuse the `.conversation__unpair` de-emphasized text-button posture
  if convenient.

Left-align the pill (`align-self: flex-start` if the wrapper is a flex column) to match a
top-anchored pill; final alignment is the developer's read of the mobile design doc.

## State + concurrency model

- **Stores read:** `activeConversationStore` (NEW, `selectActiveConversation`) and the existing
  `timelineStore` (`items`, already read by the container). Both are narrow slices. `activeConversation`
  changes once (on creation); `items.length === 0` is a boolean that flips only on the empty↔non-empty
  transition, so neither adds meaningful re-render churn.
- **Write path:** exactly one — `setActiveConversation`, invoked only from PairedShell's
  `conversation_created` callback. Unidirectional; no two-way binding; the chip is read-only over the
  slice.
- **No async, no subscription, no effect, no `window.pyry`** added by the chip — a pure store read
  and pure render. `AbortController`/teardown: none needed (no new stream or listener; the reused
  created-event listener already tears down with PairedShell's unmount).

## Error handling

- `cwd` is an untrusted daemon string → rendered as auto-escaped React children (AC #2). No parse, no
  path resolution, no `dangerouslySetInnerHTML`. The failure mode "HTML-ish `cwd` renders as markup"
  is closed structurally by React escaping + the no-`dangerouslySetInnerHTML` rule, asserted by the
  escaping test.
- `ConversationCreatedPayload.cwd` is `string` (always present, never `null`) — no null-guard needed.
  A degenerate empty-string `cwd` renders an empty value; **do not** add a "hide chip on empty cwd"
  guard (no observed empty-cwd case; evidence-based — the daemon always supplies a real dir).
- No network/socket/crypto surface is touched — no new transport failure modes. Not `security-sensitive`
  (renderer reads an already-decoded string and renders it on the default-safe React-escaped path; the
  ticket body's own analysis).

## Testing strategy

`npm test` (vitest, `environment: 'node'` — **no jsdom**; all rendering via `renderToStaticMarkup`),
`npm run typecheck`, `npm run build`. Tests as scenarios, not full bodies — the developer writes them
in the project idiom.

- **`activeConversationStore.test.ts` (NEW)** — clone `sessionIdStore.test.ts`:
  - initial `activeConversation` is `null`.
  - `setActiveConversation(payload)` replaces it verbatim (identity/shape preserved).
  - a second `setActiveConversation` replaces (most-recent-wins, no merge).
- **`ConversationScreen.test.tsx` (add a `WorkspaceChip` describe block)** — server-render the pure
  view with injected props:
  - empty (`isEmpty:true`) + present unpromoted conversation → markup contains the label constant, the
    `cwd` text, and the change button (AC #1).
  - `isEmpty:false` + present conversation → renders `null` / empty markup (AC #3 — chip gone once the
    thread has a message).
  - `conversation:null` + `isEmpty:true` → `null` (no active conversation ⇒ no chip).
  - `is_promoted:true` + `isEmpty:true` → `null` (new-*discussion* affordance only).
  - `cwd` = `<b>hi</b>` (no apostrophes) → markup contains `&lt;b&gt;hi&lt;/b&gt;`, never raw `<b>`
    (AC #2 — opaque, escaped).
  - no `onChange` prop → the change button carries `disabled` (AC #4 placeholder); with an injected
    `onChange`, the button is not disabled (proves the #157 additive seam).
- **PairedShell wiring — closed by composition, no jsdom test** (the #242 precedent,
  `PairedShell.test.tsx:56-63`): the store unit test proves `setActiveConversation` records the payload;
  `conversationCreatedBridge.test.ts` already proves a `conversation_created` event reaches the nav
  callback; the `WorkspaceChip` view test proves render-given-a-conversation. Together they close the
  path without a DOM harness. A one-line comment at the changed callback documents the seam.

## Open questions

- **Stale snapshot across unpair/re-pair.** `activeConversationStore` is a module singleton; it persists
  after PairedShell unmounts. A re-pair that lands on an empty thread could briefly show the prior
  discussion's `cwd`. Not observed and gated in the common case by `isEmpty` (a sent message hides it).
  A future ticket may clear it beside `sessionStore.clear()` on unpair — **flag, don't build** here.
- **Type generalization for select-and-load.** The store holds `ConversationCreatedPayload` (the
  create-reply shape). When list-row open + select-and-load lands, opening an existing row yields a
  `ConversationSummary` (different shape); the store type will generalize or gain an adapter then. This
  ticket wires only the created-event path — the correct scope for the milestone.
- **#157 hand-off.** `WorkspaceChip`'s `onChange?` is the sole extension point; #157 passes it (open the
  Workspace Picker sheet, Figma node 20-2) and the disabled placeholder becomes live — purely additive,
  no change to this ticket's structure.
