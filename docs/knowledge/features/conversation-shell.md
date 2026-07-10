# Conversation shell

The renderer's first screen: a scrollable message thread above a bottom-pinned composer, styled from the mobile **Conversation Thread** screen (Figma node `16-8`) stretched to the desktop window. It is the surface later tickets bind real state into.

Introduced in [#1](../codebase/1.md); the thread was bound to the live [session store](session-store.md) in [#69](../codebase/69.md). Everything lives under `src/renderer/` — nothing here touches keys, sockets, the Noise handshake, or the preload bridge.

## What it does

Renders the conversation thread and composer for a session: a thread region that fills the window height and scrolls independently, and a composer (text input + send button) pinned to the bottom edge. The thread now renders the **live** message list from the [session store](session-store.md) — streamed daemon replies appear as they arrive ([#69](../codebase/69.md)). The composer is now **wired**: typing a message and submitting it (send button or Enter) sends it and shows it in the thread immediately as an optimistic echo ([#66](../codebase/66.md) — see [Composer send](composer-send.md)).

The app bar, status row, tool-call chips, code blocks, session delimiters, and the mic icon shown in the Figma node are **deliberately out of scope** — they render conversation/connection/model state that lands in later slices. This screen builds the message thread and composer only.

A minimal seed of that future top app bar landed in [#166](../codebase/166.md): a slim header row above the thread holding an unpair escape hatch. See [Unpair control](#unpair-control-166) below.

A **proactive** twin of that escape hatch landed in [#167](../codebase/167.md): beneath the composer, a `Re-pair` button that appears only when the connection has hit a terminal failure or the daemon has rejected the pairing, instead of requiring the user to notice the manual header control. See [Re-pair control](#re-pair-control-167) below.

The status row and the "Run configuration" sheet it opens landed as a **chrome-only shell** in [#177](../codebase/177.md): a trigger row between the thread and the composer, and a host modal that renders no live data or sections yet. See [Run configuration sheet](#run-configuration-sheet-177) below.

The sheet's first section, **Log data** (a Download button for the debug bundle), landed in [#72](../codebase/72.md): the last child in the sheet body, beneath where Model/Effort/YOLO/Context-window will mount. See [Log data section](#log-data-section-72) below.

A second, **structured-stream** thread landed in [#203](../codebase/203.md): a `Timeline` view mounted beside `MessageThread`, rendering [thread-timeline store](conversation-timeline-store.md) items (the streamed assistant text, with a streaming cursor on the in-progress bubble) in a Strangler-Fig coexistence with the coarse thread above it. Inert (empty, zero footprint) in production until #179 flips the `interactive` capability. See [Structured-stream timeline render](#structured-stream-timeline-render-203) below.

This screen is now the **thread view** of the [paired shell](paired-shell.md), landed in [#140](../codebase/140.md): the paired region enters at a list first, and opening a conversation mounts this screen, which gained a leading back affordance to return to the list. See [Back control](#back-control-140) below.

## How it works

### Structure

`App.tsx` mounts `<ConversationScreen />` as the **thread view** of the [paired shell](paired-shell.md)'s `list ⇄ thread` router, itself mounted on the `conversation` route ([#80](../codebase/80.md) — see [App shell](app-shell.md); before #80, `App` rendered it directly; before [#140](../codebase/140.md), `AppView` rendered it directly on the `conversation` route with no list and no way back). The screen is a flex column:

```
ConversationScreen            .conversation        (flex column, full height, position: relative)
├── BackControl                .conversation__back   (leading icon button, #140, null when onBack absent)
├── UnpairControl              .conversation__header (slim header row, #166)
├── MessageThread             .conversation__thread (scroll region, the coarse `message` path)
│   └── MessageBubble × N     .message-row / .bubble
├── Timeline                  .conversation__thread (null when empty, the structured-stream path, #203)
│   └── TimelineRow × N       .message-row--daemon / .bubble--daemon (assistantText only)
├── StatusRow                 .status-row          (trigger, between thread and composer, #177)
├── Composer                  .composer            (pinned)
├── RepairControl              .composer__repair    (conditional, beneath composer, #167)
└── StatusSheet (if open)     .status-sheet-overlay (absolute overlay, last child, #177)
```

`MessageBubble`, `Composer`, `UnpairControl`, `StatusRow`, and `RepairControl` are **in-file functions** inside `ConversationScreen.tsx` — they are tiny. `MessageThread`, `StatusSheet`, and `RepairPrompt` are also in-file but **exported** ([#69](../codebase/69.md), [#177](../codebase/177.md), [#167](../codebase/167.md)), so tests server-render them as pure views. `ConversationScreen` is the store-bound container; `MessageThread`/`StatusSheet`/`RepairPrompt` are the props-in/markup-out views — the same container/view split `PairingScreen`/`PairingView` uses ([#55](../codebase/55.md)). The load-bearing contracts are the props/types, not the file boundaries (see Seams).

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

### Back control (#140)

The thread's leading return-to-list affordance, added when the [paired shell](paired-shell.md) gave
the conversation screen somewhere to return *to*. `ConversationScreenProps` gained an **optional**
`onBack?: () => void` — the exact `onUnpaired?` precedent ([#166](../codebase/166.md)): a bare
`<ConversationScreen />` with no `onBack` renders identically to before this ticket (AC3), since the
in-file `BackControl({ onBack })` returns `null` when the prop is absent. When present, it renders a
48px icon-only `<button aria-label="Back">` holding a 24px inline `arrow_back` SVG glyph
(Figma node 16-11, `on-surface`) as the **first child** of `.conversation`, ahead of `UnpairControl`'s
header row. The [paired shell](paired-shell.md)'s `PairedShellView` wires it to a nav dispatch
(`{ type: 'back' }`) that unmounts the thread and remounts the list. The back arrow and the unpair
header are two separate rows for now — a deliberate interim; a future top-app-bar ticket consolidates
back + title + overflow + unpair into the one bar Figma 16-9 shows.

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

### Re-pair control (#167)

The **proactive** twin of the unpair control above: instead of requiring the user to notice the
header's manual `Unpair`, the screen surfaces a `Re-pair` button beneath the composer the moment
the stored pairing can no longer be used — a terminal transport/handshake failure or a
non-retryable daemon rejection. Closes the live incident (2026-07-07, #120) where a dead
connection left the user staring at a disabled composer with no recovery.

Gating is a single pure predicate, `shouldOfferRepair(status: ConnectionStatus): boolean` in
`composerSend.ts` beside `composerAvailability` (see [Composer send](composer-send.md)):

```ts
status.type === 'error' && !status.error.retryable && status.error.code !== 'unpair'
```

`!retryable` admits a terminal transport/handshake failure (`daemonConnection.ts`'s `emitFailed`
always reports `retryable: false`) and excludes a **retryable** daemon wire-error
(`server.binary_offline`, `rate_limited` — transient, not a broken pairing). `code !== 'unpair'`
excludes the self-inflicted `UNPAIR_FAILED_ERROR` `runUnpair` itself dispatches on a failed clear —
without it, a failed re-pair would immediately re-satisfy the predicate and re-offer itself in a
loop. A transient transport drop never reaches `error` at all (the relay supervisor absorbs and
re-dials), so it never reaches this predicate either.

The affordance is split along the file's pure-view/store-bound-container seam:

- **`RepairPrompt({ status, onRepair })`** — exported pure view; returns `null` unless
  `shouldOfferRepair(status)`, else a single `Re-pair` text button reusing the
  `.conversation__unpair` de-emphasized treatment. `status` is a **prop**, not a store read, because
  the populated true-branch isn't reachable under `renderToStaticMarkup` (zustand v5's
  server-snapshot gotcha — see [#69 codebase notes](../codebase/69.md)); tests server-render this
  view directly with an arbitrary status to prove the true/false matrix.
- **`RepairControl({ onUnpaired })`** — in-file container, mounted right after `<Composer />`.
  Selects `status`/`dispatch` from the [session store](session-store.md) independently of
  `ConversationScreen` (which selects only `messages`), so a status change re-renders `Composer` and
  this control only, never the thread. `handleRepair` fires the **same** `runUnpair` wiring
  `UnpairControl` uses (`window.pyry.unpair` → `dispatch({ reset })` → `onUnpaired`) — no second
  clear path.

Unlike `UnpairControl`, there is **no confirm phase and no busy guard** — the button only ever
appears in an already-terminal error, so a confirm step is pure friction, and the affordance
self-hides on both outcomes (`ok` → store resets to `disconnected`, route unmounts the screen;
`error` → store lands on `code: 'unpair'`, which the predicate excludes). `runUnpair` never
rejects, so `handleRepair` fires it as a bare `void` with no `.then`. See
[#167 codebase notes](../codebase/167.md) for the full design, patterns, and code-review NITs.

### Run configuration sheet (#177)

The host modal for the session's Model / Effort / YOLO controls, context-window state, and
Log-data download — each section is a follow-up ticket (#181 — since split into #187/#188, #182,
#72) that owns both its header and its content. This ticket ships only the chrome: the trigger and
the empty, dismissible sheet.

`StatusRow` is a full-width icon-only `<button aria-label="Run configuration" aria-haspopup="dialog">`
between `MessageThread` and `Composer` (Figma node `16-57`), with a top border separating it from
the thread. Its left summary region (`model · effort · context%`) is intentionally empty — that
live text is the collapsed mirror of the sheet's read sections, owned by #188/#182, not this shell.
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
record). The sheet body itself gained its first section in [#72](#log-data-section-72) below; all
four read-only sections (Model/Effort/YOLO, #188, and Context window, #192) have since landed. See
[#177 codebase notes](../codebase/177.md) for the shell's full design and lessons learned.

A **headless data path** for the Model/Effort/YOLO/Context-window sections landed in
[#187](../codebase/187.md): `<RunConfigData/>`, mounted as the sheet body's first child (ahead of
`<RunConfigSections/>` and `<LogDataSection/>`), requests a fresh `screen_snapshot` on every sheet
open and holds `model`/`effort`/`yolo` (and, since [#192](../codebase/192.md), `usedTokens`/
`windowTokens`) in a dedicated [Run configuration store](run-config-store.md). The Model/Effort/YOLO
render landed in [#188](../codebase/188.md); the Context window render landed in
[#192](../codebase/192.md). See [Run configuration data path](#run-configuration-data-path-187),
[Run configuration Model/Effort/YOLO sections](#run-configuration-modeleffortyolo-sections-188), and
[Run configuration Context window section](#run-configuration-context-window-section-192) below.

### Run configuration data path (#187)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

`RunConfigData` is a headless container (`(): null`) — no markup, no header, no rows; it exists
purely to drive the fetch-and-hold data path the moment the sheet opens, ahead of #188 rendering
anything from it. Because the sheet body is conditionally mounted
(`{sheetOpen && <StatusSheet>…}`), `RunConfigData`'s own mount **is** the sheet's open transition,
so "request once per open" reduces to "request once per mount" — a `useRef(false)` guard makes that
hold even under React StrictMode's dev double-invoke. A second effect subscribes to
`window.pyry.onDaemonEvent` (off-handle cleanup, the `daemonEventBridge` idiom) and writes each
arriving `snapshotReceived` verbatim into the [Run configuration store](run-config-store.md)'s
single setter. See [Run configuration store](run-config-store.md) for the full data-path design and
[#187 codebase notes](../codebase/187.md) for patterns established.

### Run configuration Model/Effort/YOLO sections (#188)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188)
│   └── RunConfigView                  (pure: three primitive props in, markup out)
│       ├── ModelSection                .status-sheet__section-header "Model" + 3-row radio list
│       ├── EffortSection                .status-sheet__section-header "Effort" + 5-segment control
│       └── YoloSection                  .status-sheet__section-header "YOLO mode" + labelled switch
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The three sections the sheet's Model/Effort/YOLO controls needed, mounted between `RunConfigData`
and `LogDataSection`. `RunConfigView` is the exported pure view — three primitive props
(`model`/`effort`/`yolo`) in, markup out, no store read and no `window.pyry`, so it
server-renders with no mock, the same seam `LogDataView`/`RunConfigData` use. `RunConfigSections` is
the thin exported container: `useRunConfigStore(selectSnapshot)` reads one narrow slice and
coalesces `snapshot ?? { model: '', effort: '', yolo: false }` before handing the triple to
`RunConfigView` — so the store's pre-load `null` and a real all-defaults `screen_snapshot` render
through the identical code path (both are AC4's blessed default: no radio filled, no segment marked,
switch off).

- **Model** — a static three-entry catalog (Opus 4.7 / Sonnet 4.6 / Haiku 4.5, each with a one-line
  descriptor) is renderer content from the design, not daemon data; the snapshot's `model` string
  only selects a row via `matchedFamily`, a case-insensitive substring match against each catalog
  entry's family token (`opus`/`sonnet`/`haiku`). That handles both the short alias the wire fixture
  uses (`"opus"`) and a full `claude --model` id (`"claude-opus-4-7"`) with one rule, and degrades to
  no selection for `''` or anything unrecognized. The selected row's radio is `role="img"
  aria-label="Current model"`; the other two are `aria-hidden`.
- **Effort** — five fixed segments (`low`/`medium`/`high`/`xhigh`/`max`) matched by exact equality;
  the current level carries `aria-current="true"`, which is both the accessibility marker and the
  CSS hook (`[aria-current='true']`) for the filled-pill style — no parallel modifier class.
- **YOLO** — a between-justified "Auto-accept tool calls" row with a switch rendered `role="switch"
  aria-checked={yolo} aria-readonly="true"`: honestly read-only (not focusable) until
  [#183](https://github.com/pyrycode/pyrycode-desktop/issues/183) drops `aria-readonly` and wires an
  `onClick`. Figma pins only the off state; the on state (`--color-primary` track, `--color-surface`
  knob) mirrors M3 on-switch semantics with tokens already in the palette — no new token, and
  low-risk since production data is always `yolo: false` until #183 lands the write path.

One more M3 token landed: `--color-surface-container-highest` (the switch's off-track fill; reused by
[#192](../codebase/192.md)'s context-window track below). See [#188 codebase notes](../codebase/188.md)
for the full design and patterns established.

### Run configuration Context window section (#192)

```
.status-sheet__body
├── RunConfigData                     (headless: requests + holds, renders null, #187)
├── RunConfigSections                 (container: reads store slice, coalesces null, #188/#192)
│   └── RunConfigView                  (pure: five primitive props in, markup out)
│       ├── ModelSection
│       ├── EffortSection
│       ├── YoloSection
│       └── ContextWindowSection         .status-sheet__section-header "Context window" + usage gauge
└── LogDataSection                    (container: useReducer + one onDaemonEvent subscription, #72)
```

The fourth and last section of the read-only surface, mounted between `YoloSection` and the sibling
`LogDataSection` per Figma order. Widens the [Run configuration store](run-config-store.md)'s held
`RunConfigSnapshot` (and the `toRunConfigSnapshot` copy) by the two usage figures [#191](../codebase/191.md)
already carries on `snapshotReceived` — `usedTokens`/`windowTokens` — and renders them as:

- **Available (`windowTokens > 0`):** a usage line — `` `${pct}% used (${abbreviateTokens(usedTokens)}
  of ${abbreviateTokens(windowTokens)} tokens)` `` — above a `role="progressbar"` track/fill whose fill
  width is set inline per render (`aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-label`
  complete the honest a11y contract). `pct` is `used/window` rounded and clamped to `[0, 100]`, so an
  over-full session reads "100% used" with a full (not overflowing) bar, while the raw abbreviated
  figures stay honest about the overflow (e.g. "210K of 200K tokens").
- **Unavailable (`windowTokens <= 0`):** a single muted "Context usage unavailable" line in place of
  the usage line and bar — no progressbar role, no division ever runs.

The container's null-default gained `usedTokens: 0, windowTokens: 0` — the same move [#188](../codebase/188.md)
made for `model`/`effort`/`yolo`, one step further: **the not-yet-loaded default and the daemon's
`window_tokens == 0` "usage unavailable" signal collapse into the identical `windowTokens > 0` branch**,
so there is exactly one guard, not two, and the division genuinely never executes on either falsy
path (AC5 — no NaN, no Infinity, no divide-by-zero). `abbreviateTokens` (1000+ → `"146K"`, else a raw
count) stays an in-file, unexported one-liner; zero new public exports, zero new theme tokens (reuses
`--color-success` and #188's `--color-surface-container-highest`). See
[#192 codebase notes](../codebase/192.md) for the full design and patterns established.

### Log data section (#72)

The sheet's **first populated section** — the sole user-facing entry point for the client debug-bundle
download (the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) family, whose background
chain — request/reassemble/save/[orchestrator](debug-bundle-orchestrator.md) — was already merged and
inert for want of a UI driver). Mounted as `<LogDataSection/>`, the sheet body's last child (`<RunConfigSections/>`, #188, now
precedes it), last in document order ("beneath Context-window" per Figma node `20-100` subtree
`98:2`/`98:16`):

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

### Structured-stream timeline render (#203)

The render slice (L3) of the Phase-2 structured-streaming vertical (transport [#199](../codebase/199.md)
→ store [#202](../codebase/202.md) → render #203), mounted immediately after `<MessageThread/>`:

```
.conversation
├── MessageThread              messages={useSessionStore(selectMessages).map(toMessageViewModel)}
└── Timeline                   items={useTimelineStore(selectItems)}
```

`Timeline({ items }: { items: readonly ThreadItem[] })` is `MessageThread`'s twin — a pure, exported,
in-file component (props-in/markup-out, server-rendered in tests from an injected `ThreadItem[]`, no
store, no IPC). It reuses `MessageThread`'s scroll region class (`.conversation__thread`) and the
coarse path's daemon-bubble treatment (`.message-row--daemon` / `.bubble--daemon`) verbatim — no new
bubble styling. `ThreadItem` (from [thread-timeline](thread-timeline.md)) is already the render model
(camelCase, `conversation_id`-free, ADR 0008), so the container passes `selectItems`'s result straight
through — no adapter, unlike the coarse path's `toMessageViewModel`.

Per-item render, by `kind`, with **no `default`/`assertNever`** (an exhaustive switch that degrades an
unsourced-today kind to `null` rather than throwing — the render-path counterpart to the store
bridges' hard `assertNever`, see [#203 codebase notes § Patterns established](../codebase/203.md)):

- `assistantText` → one bubble, text as React children (never `dangerouslySetInnerHTML` — HTML inside
  a delta renders as visible characters, discharging #199's untrusted-text handoff), carrying
  `data-thread-role="assistant"` as the test hook (`MessageThread`'s `data-message-role` counterpart).
- `toolCall` → `null` (no source until #205/#206 — a real union member, not yet renderable).
- `turnBoundary` → `null` (structural only; Figma has no per-turn divider).

**Streaming cursor** (Figma `16:56`, glyph `▎` U+258E): a trailing `<span class="bubble__cursor"
aria-hidden="true">` inside the in-progress bubble, rendered only on the tail item when
`item.kind === 'assistantText'` — derived from array position, never from `selectPhase` (which had no
source at the time; [#214](../codebase/214.md) later wired one up, but this render still doesn't read
it — the thinking indicator is a separate, still-open slice). CSS blink guarded by
`@media (prefers-reduced-motion: reduce)`.

**React key = array index**, deliberately: the reducer's `appendDelta`/`fillResult` invariants
guarantee the list is append-only with tail-mutation, never reordering or inserting mid-list, so index
identity is stable per logical item (`turnId` alone would collide once #205 lets a tool split one turn
into two `assistantText` items; a text-bearing key would remount the growing bubble every delta).

**Strangler-Fig coexistence, not a cutover.** `Timeline` sits directly beside `MessageThread`; the
coarse path is completely untouched and stays the *live* one — `Timeline` returns `null` on an empty
`items` array (not an empty `<div>`), giving it zero layout footprint so the thread is pixel-identical
to before this ticket. The store stays empty in production until #179 flips the `interactive`
capability (a non-interactive v2 connection receives no structured stream), so this entire render path
is inert today. **Open question, deliberately left to #179:** once `interactive` flips and the coarse
`message` fan-out stops, `MessageThread` will render an *empty* `.conversation__thread` beside the
now-populated `Timeline` — a half-height dead region — which #179 must reconcile (#203 must not flip
or gate anything here). See [#203 codebase notes](../codebase/203.md) for the full design and code
review record.

## Seams (bound + still open)

- **`onBack?: () => void`** — **bound in [#140](../codebase/140.md).** Optional, gated exactly like `onUnpaired?`; wired by the [paired shell](paired-shell.md) when this screen is mounted as its `thread` view, absent for a bare `<ConversationScreen />`. See [Back control](#back-control-140) above.
- **`MessageThread({ messages })`** — **bound in [#69](../codebase/69.md).** `ConversationScreen` now feeds this prop from `useSessionStore(selectMessages).map(toMessageViewModel)` instead of the deleted `placeholderMessages` array, adapting wire `MessagePayload` (`role`, `message_id`) to the `Message` view model (`type`, `id`) at the store-read boundary. `MessageThread` stays the pure `Message[]`-in view — the seam's shape held exactly as the swap target.
- **`Composer`** — **bound in [#66](../codebase/66.md).** Now a thin controlled container: `useState` input, an `onChange`/`onKeyDown` on the `<textarea>`, and an `onClick` on the send button, all delegating to the pure `submitMessage` in `composerSend.ts` (submit mints a `message_id`, emits a `sendMessage` command, and appends an optimistic echo to the store). The submit logic lives in its own `.ts` file (the pairing container/pure-logic split); `Composer` itself stayed in-file. Auto-grow was not built (cosmetic, no AC). See [Composer send](composer-send.md).
- **`UnpairControl`** — **bound in [#166](../codebase/166.md).** A screen-local confirm-phase container delegating its decision logic to the pure `runUnpair` in `unpairAction.ts`, the same pattern as `Composer`/`composerSend.ts`. See [Unpair control](#unpair-control-166) above.
- **`RepairPrompt({ status, onRepair })` / `RepairControl`** — **bound in [#167](../codebase/167.md).** `RepairPrompt` is the exported pure view (`status` as a prop, gated by `shouldOfferRepair`); `RepairControl` is the in-file container reusing `runUnpair`. See [Re-pair control](#re-pair-control-167) above.
- **`StatusRow({ onExpand })` / `StatusSheet({ onClose, children })`** — **shell landed in [#177](../codebase/177.md); the `children` seam bound its first section in [#72](../codebase/72.md); the headless data path in [#187](../codebase/187.md); the Model/Effort/YOLO render in [#188](../codebase/188.md); the Context window render in [#192](../codebase/192.md).** `StatusRow`'s summary region is still empty (no live text yet); `StatusSheet`'s body now renders `<RunConfigData/>` (holds data, no markup), then `<RunConfigSections/>` (all four read-only sections, reading the store #187/#192 populate), then `<LogDataSection/>` — the full read-only surface the sheet needed is now built. See [Run configuration sheet](#run-configuration-sheet-177), [Run configuration data path](#run-configuration-data-path-187), [Run configuration Model/Effort/YOLO sections](#run-configuration-modeleffortyolo-sections-188), and [Run configuration Context window section](#run-configuration-context-window-section-192) above.
- **`Timeline({ items })`** — **bound in [#203](../codebase/203.md).** A second, independent thread beside `MessageThread`, reading the [conversation timeline store](conversation-timeline-store.md)'s `selectItems`. Inert (empty, `null`) in production until #179 flips `interactive`. See [Structured-stream timeline render](#structured-stream-timeline-render-203) above.

## Edge cases and limitations

- An **empty `messages` array** renders a valid empty scroll region — no crash, no placeholder fallback. The store returns `[]` on initial state, so a just-connected session with no replies yet renders a clean empty thread.
- The send button is **wired** ([#66](../codebase/66.md)): a click (or Enter) sends the composed message and appends an optimistic echo. A whitespace-only input does nothing; a send-bridge failure is swallowed (no crash). See [Composer send](composer-send.md).
- **Dark scheme only**; no responsive layout beyond flex reflow; no desktop-native layout (the plan defers that until the app is fully functioning).
- No DOM interactivity is tested yet — the render test uses `renderToStaticMarkup`, not a DOM harness. Because zustand v5's `useStore` reads `getInitialState()` (not `getState()`) for its server snapshot, a *server*-rendered store-bound container always shows the store's **initial** state; #69 therefore proves ordering + role→type on the pure `MessageThread` view and smoke-tests the container against the empty store. Observing a *populated* container render needs a jsdom harness — still deferred. See [#69 codebase notes](../codebase/69.md).

## Related

- [App shell](app-shell.md) — the router that mounts the `paired`/`conversation` route (#80); gains the `onUnpaired` reverse-flip seam this screen's unpair control fires (#166)
- [Paired shell](paired-shell.md) — the second-level `list ⇄ thread` router now mounting this screen as its `thread` view (#140); source of the `onBack` seam this screen's back control fires
- [Session store](session-store.md) — the live state the thread now renders; the `MessageThread`/status seams bind to it (#2, bound in #69); gains the `reset` action the unpair control dispatches (#166)
- [Composer send](composer-send.md) — the composer's now-wired submit + optimistic echo (#66); the send half of this screen
- [Unpair channel](unpair-channel.md) — the main-side `window.pyry.unpair()` bridge this screen's unpair control consumes (#173, consumed in #166); the re-pair control reuses the same bridge via `runUnpair` (#167)
- [Debug-bundle orchestrator](debug-bundle-orchestrator.md) — the main-process consumer the Log data section's Download button and its three daemon events finally drive (#169, consumed in #72)
- [Run configuration store](run-config-store.md) — the dedicated store the headless data path `<RunConfigData/>` feeds (#187) and `<RunConfigSections/>` reads via `selectSnapshot` (#188, widened by #192); mounted as the sheet body's first two children, ahead of `<LogDataSection/>`
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the transport data path (#180, extended #191) `<RunConfigData/>` consumes via `snapshotReceived`
- [Conversation timeline store](conversation-timeline-store.md) / [Thread timeline (conversation model)](thread-timeline.md) — the store and model `<Timeline/>` reads via `selectItems` (#203); the `useTimelineBridge()` twin of `useDaemonEventBridge()` mounted in `App.tsx`
- [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the `role→'daemon'` / `message_id→id` adapter seam deferred to this screen
- [ADR 0006 — ephemeral screen-local state](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the `useState` boolean the Run configuration sheet's open/close toggle follows (#177); the `useReducer` phase-machine the Log data download state follows (#72)
- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md) — gains `--color-surface-container-low` + `--color-scrim` (#177); gains `--color-secondary-container` + `--color-on-secondary-container` (#72); gains `--color-surface-container-highest` (#188, reused by #192's context-window track — 0 new tokens)
- [ADR 0001 — Stack](../decisions/0001-stack-electron-react-typescript.md), [ADR 0002 — Remote head over relay](../decisions/0002-remote-head-over-relay-shared-wire.md)
- [#1 codebase notes](../codebase/1.md) · [#69 codebase notes](../codebase/69.md) · [#166 codebase notes](../codebase/166.md) · [#177 codebase notes](../codebase/177.md) · [#72 codebase notes](../codebase/72.md) · [#167 codebase notes](../codebase/167.md) · [#187 codebase notes](../codebase/187.md) · [#188 codebase notes](../codebase/188.md) · [#191 codebase notes](../codebase/191.md) · [#192 codebase notes](../codebase/192.md) · [#203 codebase notes](../codebase/203.md) · [#140 codebase notes](../codebase/140.md) · Spec: `docs/specs/architecture/1-app-shell-and-theme-tokens.md`
