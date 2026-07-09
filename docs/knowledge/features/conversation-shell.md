# Conversation shell

The renderer's first screen: a scrollable message thread above a bottom-pinned composer, styled from the mobile **Conversation Thread** screen (Figma node `16-8`) stretched to the desktop window. It is the surface later tickets bind real state into.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders the conversation thread and composer for a session: a thread region that fills the window height and scrolls independently, and a composer (text input + send button) pinned to the bottom edge. The thread now renders the **live** message list from the [session store](session-store.md) — streamed daemon replies appear as they arrive ([#69](../codebase/69.md)). The composer is now **wired**: typing a message and submitting it (send button or Enter) sends it and shows it in the thread immediately as an optimistic echo ([#66](../codebase/66.md) — see [Composer send](composer-send.md)).

The app bar, status row, tool-call chips, code blocks, session delimiters, and the mic icon shown in the Figma node are **deliberately out of scope** — they render conversation/connection/model state that lands in later slices. This screen builds the message thread and composer only.

A minimal seed of that future top app bar landed in [#166](../codebase/166.md): a slim header row above the thread holding an unpair escape hatch. See [Unpair control](#unpair-control-166) below.

The status row and the "Run configuration" sheet it opens landed as a **chrome-only shell** in [#177](../codebase/177.md): a trigger row between the thread and the composer, and a host modal that renders no live data or sections yet. See [Run configuration sheet](#run-configuration-sheet-177) below.

The sheet's first section, **Log data** (a Download button for the debug bundle), landed in [#72](../codebase/72.md): the last child in the sheet body, beneath where Model/Effort/YOLO/Context-window will mount. See [Log data section](#log-data-section-72) below.

## How it works

### Structure

`App.tsx` mounts `<ConversationScreen />` on the `conversation` route ([#80](../codebase/80.md) — see [App shell](app-shell.md); before #80, `App` rendered it directly). The screen is a flex column:

```
ConversationScreen            .conversation        (flex column, full height, position: relative)
├── UnpairControl              .conversation__header (slim header row, #166)
├── MessageThread             .conversation__thread (scroll region)
│   └── MessageBubble × N     .message-row / .bubble
├── StatusRow                 .status-row          (trigger, between thread and composer, #177)
├── Composer                  .composer            (pinned)
└── StatusSheet (if open)     .status-sheet-overlay (absolute overlay, last child, #177)
```

`MessageBubble`, `Composer`, `UnpairControl`, and `StatusRow` are **in-file functions** inside `ConversationScreen.tsx` — they are tiny. `MessageThread` and `StatusSheet` are also in-file but **exported** ([#69](../codebase/69.md), [#177](../codebase/177.md)), so tests server-render them as pure views. `ConversationScreen` is the store-bound container; `MessageThread`/`StatusSheet` are the props-in/markup-out views — the same container/view split `PairingScreen`/`PairingView` uses ([#55](../codebase/55.md)). The load-bearing contracts are the props/types, not the file boundaries (see Seams).

### Data shape

The thread's view model is a discriminated union on `type`, following the project's sealed-event convention and forward-compatible with the richer kinds later slices add. It lives in `messageViewModel.ts` (relocated from the deleted `placeholderMessages.ts` in [#69](../codebase/69.md)):

```ts
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }
```

The **data source is the [session store](session-store.md)**, which holds wire `MessagePayload` verbatim (ADR 0004). `ConversationScreen` reads the messages slice and adapts each payload at the store-read boundary:

```ts
const messages = useSessionStore(selectMessages).map(toMessageViewModel)
```

`toMessageViewModel` (in `messageViewModel.ts`) is a pure, exhaustive `switch (m.role)`: `role: 'user' → type: 'user'`, `role: 'assistant' → type: 'daemon'`, `message_id → id`, `text` carried through, `conversation_id` dropped; an `assertNever` default makes a future third `WireRole` a compile error. Selecting only the `messages` slice keeps connection-status changes from re-rendering the thread. Each bubble carries `data-message-role={message.type}` — the test hook the structural render test asserts against.

### Layout contract

Independent scroll rests on three rules; get these right and AC1/AC5 follow:

- `index.css` — `html, body, #root { height: 100% }` establishes the full-height chain; `body { margin: 0 }`.
- `.conversation__thread` — `flex: 1 1 auto; min-height: 0; overflow-y: auto`. The **`min-height: 0`** is load-bearing: without it a flex item refuses to shrink below its content, so the whole window scrolls instead of the thread region.
- `.composer` — `flex: 0 0 auto`: pinned, never grows or shrinks.

Bubbles use `max-width: min(680px, 75%)` (not a fixed width) so they reflow as the window resizes — the desktop divergence from the mock's fixed `330px`. Bubble corners are asymmetric via `border-radius` (order **TL TR BR BL**): the user bubble clips its bottom-right, the daemon bubble its bottom-left.

### Theme

Every style references a token from `theme/tokens.css` — no color/type/spacing literal in `conversation.css`. Bare structural geometry (`100%`, flex ratios, the `48px` send button, the bubble measure) stays literal; those are layout, not theme. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

### Unpair control (#166)

The escape hatch off a stale/dead conversation screen (no in-app way back to pairing existed
before #120's split). A `.conversation__header` row above the thread, right-aligned, holding
`UnpairControl` — a screen-local `useState<'idle' | 'confirming' | 'unpairing'>` phase machine:
`idle` shows an `Unpair` trigger; `confirming` shows `Forget this pairing?` + `Cancel`/`Confirm`
(the AC3 accidental-unpair guard); `unpairing` disables both buttons while the request is in
flight.

`ConversationScreen` takes an **optional** `onUnpaired?: () => void` prop — mirroring
`PairingScreen`'s `onPaired?`/`onCancel?` — so the existing bare `<ConversationScreen />`
server-render tests stay green. Confirm calls the pure `runUnpair` helper
(`unpairAction.ts`, the `composerSend.ts` precedent: injected effects, spy-tested, no React) which
invokes `window.pyry.unpair()` — the [unpair channel](unpair-channel.md) (#173) bridge — and
either dispatches `{ type: 'reset' }` into the [session store](session-store.md) then calls
`onUnpaired` (on `ok`), or dispatches `{ type: 'failed', error: { code: 'unpair', ... } }` and
stays put (on `error` or a rejected invoke). `window.pyry.unpair` is dereferenced only inside the
click handler, never during render, so the server-rendered smoke test never touches the preload
bridge. Styled with existing tokens only — no new `--color-error` (desktop has none; the mobile
`#BA1A1A` destructive color is deliberately not carried over for this minimal control). See
[#166 codebase notes](../codebase/166.md) for the full design and the [App shell](app-shell.md)
for the route-flip half.

### Run configuration sheet (#177)

The host modal for the session's Model / Effort / YOLO controls, context-window state, and
Log-data download — each section is a follow-up ticket (#181, #182, #72) that owns both its header
and its content. This ticket ships only the chrome: the trigger and the empty, dismissible sheet.

`StatusRow` is a full-width icon-only `<button aria-label="Run configuration" aria-haspopup="dialog">`
between `MessageThread` and `Composer` (Figma node `16-57`), with a top border separating it from
the thread. Its left summary region (`model · effort · context%`) is intentionally empty — that
live text is the collapsed mirror of the sheet's read sections, owned by #181/#182, not this shell.
Clicking it calls `onExpand`, which flips `sheetOpen` (a single `useState(false)` in
`ConversationScreen` — the "trivial single-value local UI state" case carved out by
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md), not its `useReducer`
phase-machine case). It resets to closed on remount for free.

`StatusSheet` (Figma node `20-100`) renders as the screen's last child when `sheetOpen` is true:

```
.status-sheet-overlay          absolute, inset: 0, flex column, justify-content: flex-end
├── .status-sheet-overlay__scrim   absolute, inset: 0, --color-scrim @ opacity 0.4, onClick=onClose
└── .status-sheet                 role="dialog" aria-modal="true" aria-labelledby=<title id>
    ├── .status-sheet__handle       32×4 decorative drag bar, aria-hidden
    ├── .status-sheet__header       title (left) + × close control (right, aria-label="Close")
    └── .status-sheet__body         empty, flex:1 1 auto; min-height:0; overflow-y:auto
```

It is an **absolutely-positioned overlay inside `.conversation`** (which gained `position: relative`
for this), not a React portal — no App-level z-index coordination, fully self-contained in the
screen. The scrim is a **separate element**, not the overlay's own background, so the opaque panel
sibling is never dimmed and no bare `rgba()`/`color-mix` literal is needed; it doubles as a
near-free backdrop-click dismissal. The `×` close control is the **authoritative** dismissal path
(clicking it or the scrim both call `onClose`, which flips `sheetOpen` back to `false`); Esc-to-close
was left out (optional per spec, unobservable under the server-render harness).

Two M3 dark-scheme tokens were ported into `tokens.css` ahead of their other consumers (sanctioned
by that file's header comment): `--color-surface-container-low` (the panel fill) and
`--color-scrim` (applied only via `opacity`, never as a raw color-with-alpha literal). Icons are
inline `currentColor` SVGs, the `.composer__send` precedent — no remote asset fetch (CSP blocks it).

Not wired yet at shell-landing time: no live summary text in `StatusRow`, no focus trap/restore on
open-close (accepted for a shell with a single focusable control; worth adding once more than one
section is interactive — see [#177 codebase notes](../codebase/177.md) for the full code-review
record). The sheet body itself gained its first section in [#72](#log-data-section-72) below;
Model/Effort/YOLO (#181) and Context window (#182) remain open. See
[#177 codebase notes](../codebase/177.md) for the shell's full design and lessons learned.

### Log data section (#72)

The sheet's **first populated section** — the sole user-facing entry point for the client debug-bundle
download (the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) family, whose background
chain — request/reassemble/save/[orchestrator](debug-bundle-orchestrator.md) — was already merged and
inert for want of a UI driver). Mounted as `<LogDataSection/>`, the sheet body's currently-only child,
last in document order ("beneath Context-window" per Figma node `20-100` subtree `98:2`/`98:16`):

```
.status-sheet__body
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription)
    └── LogDataView                    (pure: props in, markup out)
        ├── .status-sheet__section-header   "Log data" (reused across future sections)
        └── .log-data
            ├── button.log-data__download   full-width filled-tonal pill, "Download"/"Downloading…"
            └── p.log-data__status[role=status]   count / saved path / mapped error (only when non-null)
```

The download state (`idle` / `downloading{chunks}` / `saved{path}` / `failed{reason}`) is a small,
**pure, total, phase-agnostic** reducer (`logDataDownload.ts`, the `composerSend.ts`/`pairingState.ts`
idiom) driven by `useReducer` per [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)
— never the session store, since [`translateDaemonEvent`](daemon-event-bridge.md) already returns
`null` for all three `debugBundle*` events. The container's single `onDaemonEvent` subscription filters
those three events via `toDownloadAction` (the `translateDaemonEvent` analogue) and is torn down on
unmount, so a sheet close/reopen nets exactly one live listener. Pressing Download sends the bare
`requestDebugBundle` command and **optimistically** dispatches `requested` (not gated on the first
daemon event — the `unavailable` failure path emits no progress at all). Single-in-flight is
belt-and-suspenders: the button disables while busy and `onDownload` re-checks the phase, with the
deterministic backstop being the [#169 orchestrator](debug-bundle-orchestrator.md)'s own `active`
flag, not a second authoritative guard here. Failure text is drawn from a closed `reason → sentence`
map — never the raw `DebugBundleFailure` token, an errno, or a stack (AC5).

Two more M3 tokens landed for the button: `--color-secondary-container` / `--color-on-secondary-container`
(filled-tonal fill/text). See [#72 codebase notes](../codebase/72.md) for the full design, patterns,
and the one copy-only deviation from spec.

## Seams (bound + still open)

- **`MessageThread({ messages })`** — **bound in [#69](../codebase/69.md).** `ConversationScreen` now feeds this prop from `useSessionStore(selectMessages).map(toMessageViewModel)` instead of the deleted `placeholderMessages` array, adapting wire `MessagePayload` (`role`, `message_id`) to the `Message` view model (`type`, `id`) at the store-read boundary. `MessageThread` stays the pure `Message[]`-in view — the seam's shape held exactly as the swap target.
- **`Composer`** — **bound in [#66](../codebase/66.md).** Now a thin controlled container: `useState` input, an `onChange`/`onKeyDown` on the `<textarea>`, and an `onClick` on the send button, all delegating to the pure `submitMessage` in `composerSend.ts` (submit mints a `message_id`, emits a `sendMessage` command, and appends an optimistic echo to the store). The submit logic lives in its own `.ts` file (the pairing container/pure-logic split); `Composer` itself stayed in-file. Auto-grow was not built (cosmetic, no AC). See [Composer send](composer-send.md).
- **`UnpairControl`** — **bound in [#166](../codebase/166.md).** A screen-local confirm-phase container delegating its decision logic to the pure `runUnpair` in `unpairAction.ts`, the same pattern as `Composer`/`composerSend.ts`. See [Unpair control](#unpair-control-166) above.
- **`StatusRow({ onExpand })` / `StatusSheet({ onClose, children })`** — **shell landed in [#177](../codebase/177.md); the `children` seam bound its first section in [#72](../codebase/72.md).** `StatusRow`'s summary region is still empty (no live text yet); `StatusSheet`'s body now renders `<LogDataSection/>` and awaits two more children — #181 (Model/Effort/YOLO) and #182 (Context window) — each mounting above it, per section, owning both header and content. See [Run configuration sheet](#run-configuration-sheet-177) above.

## Edge cases and limitations

- An **empty `messages` array** renders a valid empty scroll region — no crash, no placeholder fallback. The store returns `[]` on initial state, so a just-connected session with no replies yet renders a clean empty thread.
- The send button is **wired** ([#66](../codebase/66.md)): a click (or Enter) sends the composed message and appends an optimistic echo. A whitespace-only input does nothing; a send-bridge failure is swallowed (no crash). See [Composer send](composer-send.md).
- **Dark scheme only**; no responsive layout beyond flex reflow; no desktop-native layout (the plan defers that until the app is fully functioning).
- No DOM interactivity is tested yet — the render test uses `renderToStaticMarkup`, not a DOM harness. Because zustand v5's `useStore` reads `getInitialState()` (not `getState()`) for its server snapshot, a *server*-rendered store-bound container always shows the store's **initial** state; #69 therefore proves ordering + role→type on the pure `MessageThread` view and smoke-tests the container against the empty store. Observing a *populated* container render needs a jsdom harness — still deferred. See [#69 codebase notes](../codebase/69.md).

## Related

- [App shell](app-shell.md) — the router that mounts this screen on the `paired`/`conversation` route (#80); gains the `onUnpaired` reverse-flip seam this screen's unpair control fires (#166)
- [Session store](session-store.md) — the live state the thread now renders; the `MessageThread`/status seams bind to it (#2, bound in #69); gains the `reset` action the unpair control dispatches (#166)
- [Composer send](composer-send.md) — the composer's now-wired submit + optimistic echo (#66); the send half of this screen
- [Unpair channel](unpair-channel.md) — the main-side `window.pyry.unpair()` bridge this screen's unpair control consumes (#173, consumed in #166)
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) — the main-process consumer the Log data section's Download button and its three daemon events finally drive (#169, consumed in #72)
- [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `role→'daemon'` / `message_id→id` adapter seam deferred to this screen
- [ADR 0006 — ephemeral screen-local state](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the `useState` boolean the Run configuration sheet's open/close toggle follows (#177); the `useReducer` phase-machine the Log data download state follows (#72)
- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md) — gains `--color-surface-container-low` + `--color-scrim` (#177); gains `--color-secondary-container` + `--color-on-secondary-container` (#72)
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md), [ADR 0002 — Remote head over relay](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#1 codebase notes](../codebase/1.md) · [#69 codebase notes](../codebase/69.md) · [#166 codebase notes](../codebase/166.md) · [#177 codebase notes](../codebase/177.md) · [#72 codebase notes](../codebase/72.md) · Spec: `docs/specs/architecture/1-app-shell-and-theme-tokens.md`
