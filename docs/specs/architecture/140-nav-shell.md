# #140 — List ⇄ thread navigation shell (the inner router under the paired route)

Size **S**, no split, **not** security-sensitive (pure renderer view-state — no keys, sockets, tokens, or frames). 4 production files (2 new, 2 modified), ≈250–350 lines total including tests.

## Files to read first

- `src/renderer/src/appRoute.ts` (whole, 24 lines) — the app-shell pure-model precedent this ticket mirrors: a bare **string-union** route type (`AppRoute`) plus a total, React-free transition function, tested with no React/store/Electron. `PairedRoute` is its inner twin.
- `src/renderer/src/App.tsx:9-36` — the `assertNever` exhaustiveness guard and the `AppView` pure route→screen switch. **Line 31-32 (the `conversation` case) is the seam you swap**: `<ConversationScreen …>` → `<PairedShell …>`.
- `src/renderer/src/App.tsx:44-92` — the container wiring: `useState`/launch query, and the `onPaired`/`onUnpaired` arrows passed into `AppView`. `PairedShell` nests *under* the conversation case; `onUnpaired` threads straight through it.
- `src/renderer/src/App.test.tsx` (whole, 74 lines) — the server-render test idiom (`renderToStaticMarkup`, `CONVERSATION_MARKER`/`PAIRING_MARKER`). **The `route='conversation'` test at 46-60 must change** (see Testing).
- `src/renderer/src/screens/pairing/pairingState.ts:27-94` — the `pairingReducer(state, event)` template: sealed discriminated-union event, `switch(event.type)`, `assertNever(event)` at `default`. `nextPairedRoute` follows this shape exactly. (ADR 0006's realized example.)
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:27-72` — `ConversationScreenProps` and the render tree. The **optional `onUnpaired?` prop (#166) is the precedent to mirror for `onBack?`**: additive, gated on presence, existing bare-render tests stay green.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:381-436` — `UnpairControl`: the in-file control idiom (`function X({...}): JSX.Element`) and the `.conversation__header` treatment the back affordance sits beside.
- `src/renderer/src/screens/conversation/conversation.css:24-76` — `.conversation__header` / `.conversation__unpair` styling the back affordance reuses; add one small class for the icon button.
- `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` — the ADR governing where nav state lives: `useReducer` + pure reducer at the component scope, **never** the session store.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The Conversation Thread screen's Top App Bar (node 16-9) is a horizontal row: a leading **`arrow_back`** icon (node 16-11, 24px glyph inside a 48px touch target, `on-surface` color), then the conversation title (M3 title/large, 22px — future work), then a flex spacer, then a trailing `more_vert` overflow (node 16-17 — future work). **#140 reproduces only the leading `arrow_back` and wires its navigation** (return to list); the title and overflow menu are out of scope and land in later tickets. The desktop `ConversationScreen` has no top app bar today — this ticket adds the back affordance as its leading element.

## Context

The renderer's app shell (`appRoute.ts` / `AppView` in `App.tsx`) routes between `pending` / `pairing` / `conversation`, but the `conversation` route drops straight into a single `ConversationScreen` with no list and no way out. This ticket adds the **inner navigation spine** for the paired region: a pure view-state model (`list` ⇄ `thread`) plus a thin container that owns the ephemeral view state, mirroring the `appRoute.ts` + `AppView` split those two screens shipped as.

Foundational plumbing only. It **blocks #141** (real Channel List fills the list view), **#153** (Archive attaches to the shell), and **#142** (new-discussion reuses the open-thread transition). The list view here is a throwaway in-file placeholder; #141 replaces it. The view-state model must be *extensible* to settings/archive without reworking existing arms, but this ticket wires only list ⇄ thread.

## Design

Two new files at `src/renderer/src/` (peers of `appRoute.ts` / `App.tsx` — this is the second-level router, not a screen), plus additive edits to `App.tsx` and `ConversationScreen.tsx`.

### 1. `src/renderer/src/pairedRoute.ts` — the pure view-state model (NEW)

A bare string-union route (mirrors `AppRoute`) and a total transition reducer over a sealed nav-event union (mirrors `pairingReducer`). React-free, store-free, Electron-free.

```ts
export type PairedRoute = 'list' | 'thread'
export type PairedNav = { type: 'open' } | { type: 'back' }
// (state, event) => state — the useReducer shape. `current` is unreferenced today (both
// transitions are absolute), but kept in the signature so a future stack-aware `back`
// (settings/archive → list vs. thread → list) is an added arm, not a signature rewrite.
export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute
```

Behavior (assert in `pairedRoute.test.ts`): `open` → `'thread'`; `back` → `'list'`; both idempotent (`open` from `thread` stays `thread`; `back` from `list` — home — stays `list`). The `switch(nav.type)` ends in `default: return assertNever(nav)` (copy the `assertNever` helper from `pairingState.ts:51`). Adding a future nav event (e.g. `openSettings`) without a case is a compile error — the exhaustive/compile-checked transition surface AC1/technical-notes require.

> `noUnusedParameters` is **off** in both tsconfigs, so the unreferenced `current` is not a compile error. Add the one-line comment above so review doesn't flag it.

### 2. `src/renderer/src/PairedShell.tsx` — pure view + container (NEW)

Mirrors `App.tsx`'s `AppView` (pure) + `App` (container) co-location.

**`PairedShellView`** (exported, pure — props in, markup out): a `switch(props.route)` over `PairedRoute`, `default: return assertNever(props.route)`. Twin of `AppView` (App.tsx:26-35):
- `'list'` → `<PlaceholderList onOpen={props.onOpen} />`
- `'thread'` → `<ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />`

Props: `{ route: PairedRoute; onOpen: () => void; onBack: () => void; onUnpaired: () => void }`. Returns `JSX.Element` (no null arm — both routes render). Adding a future `'settings'` view is one new case; the `assertNever` default forces you to add it (AC1: "an added arm, not a rewrite").

**`PlaceholderList`** (in-file, not exported — throwaway, #141 replaces): a minimal stand-in with **one affordance** to open the active conversation into the thread — a bare `<button onClick={onOpen}>Open conversation</button>` inside a `.paired-list-placeholder` wrapper. **Build no list visuals here** (per ticket scope). This satisfies AC2's "no regression from the direct-to-thread landing": the single active conversation lives in `sessionStore` already; the button just flips the view.

**`PairedShell`** (exported, container): owns the ephemeral nav state via `useReducer(nextPairedRoute, 'list')` — **ADR 0006** (screen-local, resets on remount, never the store; AC5). Renders `PairedShellView`, wiring `onOpen={() => dispatch({ type: 'open' })}`, `onBack={() => dispatch({ type: 'back' })}`, and forwarding `onUnpaired`. Props: `{ onUnpaired: () => void }`. Enters at `'list'` (AC2). No effects, no window deref — server-renderable, so the neutral-paint invariant is untouched.

### 3. `src/renderer/src/App.tsx` — swap the conversation seam (MODIFY, ~4 lines)

- Replace the `ConversationScreen` import with `PairedShell` (ConversationScreen now imports from within `PairedShell.tsx`).
- In `AppView`, the `case 'conversation':` returns `<PairedShell onUnpaired={props.onUnpaired} />` (App.tsx:31-32). Everything else — `pending` → null, `pairing` → `PairingScreen`, the `assertNever` default, the container's launch query and `ConversationListData` leaf — is unchanged. AC5's `pending`/`pairing` neutral first-paint is structurally preserved (PairedShell only mounts on the `conversation` route).

### 4. `src/renderer/src/screens/conversation/ConversationScreen.tsx` — additive back affordance (MODIFY, ~15–20 lines)

- Add `onBack?: () => void` to `ConversationScreenProps` — the **exact `onUnpaired?` precedent (#166)**: optional, so existing bare `<ConversationScreen />` server-render tests stay green (AC3: "no behavioral change").
- Add an in-file `BackControl({ onBack }: { onBack?: () => void }): JSX.Element | null` (mirrors the `UnpairControl` / `StatusRow` in-file idiom). **Returns `null` when `onBack` is absent** — so it's a no-op DOM-wise for existing callers, and only the shell-mounted thread shows it. When present: an icon-only `<button type="button" aria-label="Back" onClick={onBack}>` carrying the `arrow_back` glyph (SVG path, like `StatusRow`/`Composer`'s inline SVGs; read Figma 16-11 for the glyph). `on-surface` color, 24px icon.
- Render `<BackControl onBack={onBack} />` as the **first child** of `.conversation` (before `UnpairControl`) — the leading edge, matching Figma's top-app-bar placement. Add a small `.conversation__back` (or reuse the header treatment) in `conversation.css`.

> **Why `onBack` on `ConversationScreen`, not a shell-owned sibling above it:** Figma 16-9 places `arrow_back` inside the thread's *own* top app bar, at the screen's leading edge. A shell-rendered sibling above `.conversation` would stack a second header row over the existing `UnpairControl` header — off-design and awkward. An additive optional prop keeps ConversationScreen's existing behavior identical when the prop is absent, exactly as `onUnpaired` did.

### Data flow

```
AppView (route='conversation')
  └─ PairedShell            owns useReducer(nextPairedRoute, 'list')  ← nav state (ADR 0006)
       └─ PairedShellView   route='list'  → PlaceholderList — [Open conversation] → dispatch{open}
                            route='thread'→ ConversationScreen (store-backed) + BackControl — [←] → dispatch{back}
```

`sessionStore` (module-singleton, app-lifetime) holds the messages; navigating list→thread→list→thread unmounts/remounts `ConversationScreen`, which re-reads the store on mount — so **store-backed messages stay intact across navigation** (AC4). Only `ConversationScreen`'s own ephemeral UI state (composer draft, sheet-open, unpair phase) resets on remount — expected under ADR 0006, and not a regression (there is no navigation at all today).

## State + concurrency model

- **One new state owner:** `PairedShell`'s `useReducer(nextPairedRoute, 'list')`. Screen-local, ephemeral, reset-on-remount — **ADR 0006** (a nav route is a single structured value with a pure reducer; the reducer is the tested seam, exactly like `pairingReducer`). Never touches `sessionStore` (AC5).
- **No new store, no new async, no subscriptions, no effects.** Transitions are synchronous dispatches from click handlers. No `AbortController`/teardown surface — nothing outlives the component.
- **Unidirectional:** the view reads `route` and calls `onOpen`/`onBack`; the container dispatches. No two-way binding (CLAUDE.md).

## Error handling

No new failure modes — this is pure in-process view-state with no I/O, no wire, no permissions. The transition reducer is total (`assertNever` guards both the nav-event and the route-render switches at compile time), so there is no runtime "unknown route/event" path to surface. The unpair and re-pair error paths inside `ConversationScreen` are untouched.

## Testing strategy

`npm test` (vitest) — server-render (`renderToStaticMarkup`) + pure-function assertions, mirroring `App.test.tsx` / `appRoute.test.ts`. No DOM harness (the codebase has none).

**`pairedRoute.test.ts`** (new, node env, no React/store) — bullet scenarios:
- `nextPairedRoute('list', { type: 'open' })` → `'thread'`.
- `nextPairedRoute('thread', { type: 'back' })` → `'list'`.
- `nextPairedRoute('thread', { type: 'open' })` → `'thread'` (idempotent open).
- `nextPairedRoute('list', { type: 'back' })` → `'list'` (back at home is a no-op).
- (Exhaustiveness is compile-checked, not a runtime test — note it in a comment, as `appRoute.test.ts` does.)

**`PairedShell.test.tsx`** (new, mirrors `App.test.tsx`) — reuse `CONVERSATION_MARKER` (`aria-label="Send"`); pick a list marker (the `Open conversation` text) and a back marker (`aria-label="Back"`):
- `PairedShellView route="list"` → contains the open affordance, **not** `CONVERSATION_MARKER`.
- `PairedShellView route="thread"` → contains `CONVERSATION_MARKER` **and** the back marker. Needs the clean-session `beforeEach` (`sessionStore.setState({ status: { type: 'disconnected' }, messages: [] })`) that `App.test.tsx:46-51` uses for the conversation route.
- `PairedShell` container → initial render shows the **list** view (open affordance present, `CONVERSATION_MARKER` absent) — proves "enters at list" (AC2).
- Do **not** hand-write a click-driven open→thread→back test. Like `App.test.tsx`'s note on the `onPaired→setRoute` glue, the transition wiring is guaranteed by composing the tested `nextPairedRoute` (reducer) with the tested `PairedShellView` (route→view); the DOM-harness-free suite proves each piece, not the click.

**`App.test.tsx`** (modify) — the `route='conversation'` test (46-60) currently asserts `CONVERSATION_MARKER` is present. It now enters at the list, so assert the **list placeholder** is shown (`Open conversation`) and `CONVERSATION_MARKER` is **absent**. The `beforeEach` session reset can stay (harmless) or be dropped (the list view reads no store). The neutral-first-paint `App` test (63-73) stays green — `PairedShell` never mounts while the route is `pending`.

**`ConversationScreen.test.tsx`** (modify) — add two cases mirroring the existing server-render setup:
- With `onBack` provided → the back marker (`aria-label="Back"`) is present.
- Bare `<ConversationScreen />` (no `onBack`) → the back marker is **absent** (AC3: existing behavior unchanged).

`npm run typecheck` covers the two `assertNever` surfaces (a missing nav-event or route arm fails compilation) and the `onBack?` prop threading.

## Open questions

- **`conversationId` on the thread route.** Deferred per the ticket's explicit architect call: today there is a single active conversation in `sessionStore`, so a bare `'list' | 'thread'` spine suffices. When #141/#142 introduce per-conversation selection, `{ type: 'open' }` grows a payload (`{ type: 'open'; conversationId }`) and `'thread'` may carry the id — an added field on the sealed event, caught by the `assertNever` surface. Not this ticket.
- **Placeholder styling.** `.paired-list-placeholder` is throwaway (#141 replaces the whole list view). Minimal/unstyled is fine; don't invest design fidelity in it.
- **Back-arrow vs. Unpair header coexistence.** Both are transitional chrome; a future top-app-bar ticket consolidates back + title + overflow + unpair into one bar (Figma 16-9). For now, `BackControl` as a leading element beside the existing `.conversation__header` is acceptable.
