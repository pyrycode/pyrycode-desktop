# Conversation shell — chrome and controls

The screen's structure and the persistent controls around the thread: layout, theme, the back, unpair and re-pair controls, and the connection surfaces in the header.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Structure

`App.tsx` mounts `<ConversationScreen />` as the **thread view** of the [paired shell](paired-shell.md)'s `list ⇄ thread` router, itself mounted on the `conversation` route ([#80](../codebase/80.md) — see [App shell](app-shell.md); before #80, `App` rendered it directly; before [#140](../codebase/140.md), `AppView` rendered it directly on the `conversation` route with no list and no way back). The screen is a flex column:

```
ConversationScreen            .conversation        (flex column, full height, position: relative)
├── BackControl                .conversation__back   (leading icon button, #140, null when onBack absent)
├── UnpairControl              .conversation__header (slim header row, #166)
├── ConnectionBannerControl    .conversation__banner (null unless not-connected, top of thread, #279)
├── WorkspaceChip              .conversation__workspace-chip (null unless empty + unpromoted, #278; onChange opens WorkspacePickerSheet, #383)
├── Timeline                  .conversation__thread (null when empty; the single thread surface since #179, #203)
│   └── TimelineRow × N       .message-row--user/.bubble--user (userText, #179) · .message-row--daemon/.bubble--daemon (assistantText) · .tool-row/.tool-row__chip (toolCall, #218; resolved modifiers #230)
├── (ApiRetryIndicator / CompactingIndicator / StallIndicator — the three problem-state bubbles right after Timeline; unaffected by #796, see below)
├── StatusRow                 .status-row          (trigger, between thread and composer, #177)
│   └── ConnectionStatusIndicatorControl .status-row__connection (two dots, inside .status-row__summary, #330)
├── BackgroundTaskTrigger      .background-task-trigger (StatusRow sibling, unconditional, #581)
├── ComposerStatusArea         .composer-status     (fixed-height row above the composer; NEVER null, #796)
│   ├── ThinkingIndicator       .composer-status__label ("Thinking…"/"Working…"/"Running <tool>…", #648, #649; off the daemon-bubble surface since #796)
│   └── ComposerErrorChipControl .composer-status__error (row's trailing slot, right-aligned; null unless the `error` connection arm, #797)
├── Composer                  .composer            (pinned)
│   ├── ComposerActionsMenu     .composer__footer    (leading item, opens the shared options panel — #680)
│   └── ContextUsageControl     .composer__footer    (second child, below `.composer__row`; the other three desktop-layout slots (#682/#683/#685) stay empty, #811)
├── RepairControl              .composer__repair    (conditional, beneath composer, #167)
├── StatusSheet (if open)     .status-sheet-overlay (absolute overlay, #177)
├── ChannelInfoSheet (if open) .status-sheet-overlay (absolute overlay, #365)
├── WorkspacePickerSheet (if open) .status-sheet-overlay (absolute overlay, #383)
├── BackgroundTaskPanel (if open)  .status-sheet-overlay (absolute overlay, interim chrome pending #580, #581)
└── PermissionModal (if any)  .permission-modal-overlay (absolute overlay, last child, null when no outstanding prompt, #224)
```

`MessageBubble`, `Composer`, `UnpairControl`, `StatusRow`, and `RepairControl` are **in-file functions** inside `ConversationScreen.tsx` — they are tiny. `MessageThread`, `StatusSheet`, and `RepairPrompt` are also in-file but **exported** ([#69](../codebase/69.md), [#177](../codebase/177.md), [#167](../codebase/167.md)), so tests server-render them as pure views. `PermissionModal`/`PermissionModalView` live in their own file, `PermissionModal.tsx` ([#224](../codebase/224.md)), the same split one level up. `ConversationScreen` is the store-bound container; `MessageThread`/`StatusSheet`/`RepairPrompt`/`PermissionModalView` are the props-in/markup-out views — the same container/view split `PairingScreen`/`PairingView` uses ([#55](../codebase/55.md)). The load-bearing contracts are the props/types, not the file boundaries (see Seams).

## Data shape (coarse path — retired residue since #179)

The thread's view model is a discriminated union on `type`, following the project's sealed-event convention. It lives in `messageViewModel.ts` (relocated from the deleted `placeholderMessages.ts` in [#69](../codebase/69.md)):

```ts
export type Message =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'daemon'; text: string }
```

The data source was the [session store](session-store.md), which holds wire `MessagePayload` verbatim (ADR 0004). `ConversationScreen` used to read the messages slice and adapt each payload at the store-read boundary:

```ts
const messages = useSessionStore(selectMessages).map(toMessageViewModel)
```

**[#179](../codebase/179.md) removed this read from `ConversationScreen`** along with the `MessageThread` mount — `Message`/`toMessageViewModel`/`MessageThread`/`MessageBubble`/`selectMessages` are kept as dead-but-tested residue (a later cleanup ticket removes them), but nothing in production reads or renders them anymore. The live thread's data shape is `ThreadItem` (see [Thread timeline](thread-timeline.md)), read via `useTimelineStore(selectItems)` — see [The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below.

`toMessageViewModel` (in `messageViewModel.ts`) is a pure, exhaustive `switch (m.role)`: `role: 'user' → type: 'user'`, `role: 'assistant' → type: 'daemon'`, `message_id → id`, `text` carried through, `conversation_id` dropped; an `assertNever` default makes a future third `WireRole` a compile error. Selecting only the `messages` slice keeps connection-status changes from re-rendering the thread. Each bubble carries `data-message-role={message.type}` — the test hook the structural render test asserts against.

## Layout contract

Independent scroll rests on three rules; get these right and AC1/AC5 follow:

- `index.css` — `html, body, #root { height: 100% }` establishes the full-height chain; `body { margin: 0 }`.
- `.conversation__thread` — `flex: 1 1 auto; min-height: 0; overflow-y: auto`. The **`min-height: 0`** is load-bearing: without it a flex item refuses to shrink below its content, so the whole window scrolls instead of the thread region.
- `.composer` — `flex: 0 0 auto`: pinned, never grows or shrinks.

Bubbles use `max-width: min(680px, 75%)` (not a fixed width) so they reflow as the window resizes — the desktop divergence from the mock's fixed `330px`. Bubble corners are asymmetric via `border-radius` (order **TL TR BR BL**): the user bubble clips its bottom-right, the daemon bubble its bottom-left.

## Theme

Every style references a token from `theme/tokens.css` — no color/type/spacing literal in `conversation.css`. Bare structural geometry (`100%`, flex ratios, the `48px` send button, the bubble measure) stays literal; those are layout, not theme. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

## Back control (#140)

The thread's leading return-to-list affordance, added when the [paired shell](paired-shell.md) gave
the conversation screen somewhere to return *to*. `ConversationScreenProps` gained an **optional**
`onBack?: () => void` — the exact `onUnpaired?` precedent ([#166](../codebase/166.md)): a bare
`<ConversationScreen />` with no `onBack` renders identically to before this ticket (AC3), since the
in-file `BackControl({ onBack })` returns `null` when the prop is absent. When present, it renders a
48px icon-only `<button aria-label="Back">` holding a 24px inline `arrow_back` SVG glyph
(Figma node 16-11, `on-surface`) as the **first child** of `.conversation`, ahead of `UnpairControl`'s
header row. The [paired shell](paired-shell.md)'s `PairedShellView` wires it to a nav dispatch
(`{ type: 'back' }`) that unmounts this thread. Before [#670](../codebase/670.md) that also remounted
the list screen (`list`/`thread` were mutually exclusive); since #670 the sidebar list is permanently
mounted alongside the thread, so `back` now only empties the chat pane — "deselect," not "navigate away."
The back arrow and the unpair header are two separate rows for now — a deliberate interim; a future
top-app-bar ticket consolidates back + title + overflow + unpair into the one bar Figma 16-9 shows.

## Unpair control (#166)

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

## Re-pair control (#167)

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

## Connection banner (#279)

A third, independent read of the same `ConnectionStatus` slice `composerAvailability` and
`shouldOfferRepair` already read (see [Composer send](composer-send.md)) — prominent and
disconnected-only, distinct from both the composer's terse inline gate and the separate, always-on #149
two-dot Relay/Pyrycode indicator (not built here). Closes the gap where the thread gave no prominent
disconnected signal, only the composer's muted caption.

Split from #148 alongside #276/#277/#278; no Figma frame exists (the mobile file draws only the
connected thread), so the copy and accent are design-doc-sourced defaults, mirroring
[#277](../codebase/277.md)'s "no Figma frame" justification shape.

Mirrors the [Re-pair control](#re-pair-control-167) split exactly:

- **`shouldShowBanner(status: ConnectionStatus): boolean`** — in `composerSend.ts`, beside
  `composerAvailability`/`shouldOfferRepair`: `status.type !== 'connected'`. True for
  `disconnected`/`connecting`/`error`; false only for `connected`. Unlike `composerAvailability`, this
  is **not** an exhaustive per-arm switch — every non-connected arm maps to the same behavior (show the
  banner), so "show unless connected" is the honest shape, and a hypothetical future 5th
  `ConnectionStatus` arm defaults to *showing* the banner rather than silently hiding it.
- **`CONNECTION_BANNER_COPY`** — also in `composerSend.ts`: a single client-owned string constant
  (`'Cannot reach pyrybox — your messages will not send until the connection is back.'`), lexically
  distinct from the three `composerAvailability` hints (`Connecting…` / `Not connected` / `Connection
  error`) so the prominent banner and the terse composer gate never read as the same string stacked
  twice. One constant, not a per-arm map — a second three-way copy split would be the duplication this
  ticket's AC5 warns against; the composer already carries the per-arm nuance.
- **`ConnectionBanner({ status })`** — exported pure view in `ConversationScreen.tsx`. Returns `null`
  unless `shouldShowBanner(status)`, else a single `role="status"` `<p className="conversation__banner">`
  holding only `CONNECTION_BANNER_COPY` — nothing derived from `status`, so no daemon-supplied string
  (`ConnectionError.message`) can ever reach it, a structural guarantee (the `EMPTY_THREAD_COPY`/
  `ThinkingIndicator` idiom) rather than a convention. `status` is a **prop**, so the shown/hidden matrix
  server-renders directly, unlike `RepairPrompt`'s populated branch (which needs an `error` status not
  reachable from the store's server-snapshot).
- **`ConnectionBannerControl()`** — in-file, unexported container: `useSessionStore(selectStatus)` then
  `<ConnectionBanner status={status} />`. Selecting only `status` re-renders it exactly on a connection
  transition, never on a timeline delta — the same narrow-slice seam the composer gate and
  `RepairControl` already use.

Mounted between `<UnpairControl />` and `<Timeline />` — below the header row, above the message list,
"the top of the thread." Styled `.conversation__banner` (`conversation.css`), token-only, following the
`.modal-rejection` (#249) error-accent idiom: `--color-error` left border over
`--color-surface-container-high`, sized to body-medium — a step up in prominence from
`.composer__hint`'s muted body-small caption — `flex: 0 0 auto` so it pushes the thread down rather than
overlaying it, never growing or shrinking.

Not security-sensitive: a pure renderer read of already-store-held status, no transport/crypto/socket
code touched. See [#279 codebase notes](../codebase/279.md) for the full design, the code-review record,
and the apostrophe-escaping test lesson.

## Two-dot Relay/Pyrycode connection-status indicator (#330)

The final slice of the two-dot connection indicator, split from [#149](../codebase/149.md):
[#328](../codebase/328.md) (relay-leg transport) → [#329](../codebase/329.md) (renderer [relay-link
store](relay-link-store.md)) → this ticket (render). Two independently-read legs — the relay-socket
leg from `relayLinkStore` and the daemon-session leg from [session store](session-store.md)'s
`ConnectionStatus` — render as two labelled, colour-coded dots inside `StatusRow`'s
`.status-row__summary` slot (Figma node `16-58`), mirroring mobile's `ConnectionStatusLine`
(mobile #397/#398, not itself drawn in the locked Figma file). Complements the disconnected-only
[Connection banner](#connection-banner-279) — the banner announces failure, this is the persistent
at-a-glance state.

Two exported pure mapping functions turn each leg's raw status into a `{ category, label }` pair —
`category: 'up' | 'in-progress' | 'down' | 'unknown'` (the fourth member added by
[#719](../codebase/719.md)) drives the dot's colour class; `label` is the full visible status word,
baked in so the pure view stays dumb (a coloured dot + its label, nothing else) and status is
legible without colour perception:

```ts
export function relayLeg(status: RelayLinkStatus | null): ConnectionLeg
export function daemonLeg(status: ConnectionStatus): ConnectionLeg
```

| `relayLeg(status)` | category | label |
| --- | --- | --- |
| `'connected'` | up | `Relay Connected` |
| `'daemon-absent'` | up | `Relay Reachable` — distinct label; a missing daemon behind a reachable relay is the **daemon leg's** story, not a relay failure |
| `'offline'` | down | `Relay Offline` |
| `null` | unknown | `Relay Unknown` — no status has arrived yet, distinct from `'offline'` since [#719](../codebase/719.md) (was `down`/`Relay Offline` under #330's original mapping) |

`daemonLeg` never produces `unknown`: `ConnectionStatus` starts at `disconnected` and has no null,
so the host leg has nothing to be not-yet-known about — the fourth category is the relay leg's
alone.

| `daemonLeg(status.type)` | category | label |
| --- | --- | --- |
| `connected` | up | `Pyrycode Connected` |
| `connecting` | in-progress | `Pyrycode Connecting` |
| `disconnected` | down | `Pyrycode Offline` |
| `error` | down | `Pyrycode Offline` — `ConnectionError.message` never reaches this indicator, the banner (#279) owns error text |

Both functions `switch` with an explicit `ConnectionLeg` return type and **no `default`** — the
standing desktop exhaustive-switch guard (TS2366), so a future `RelayLinkStatus`/`ConnectionStatus`
member fails the build here. **Neither leg's category ever references the other** — this is
structural, not a convention: after a fatal session close (`4401`/`4421`/`4426`) the relay leg is
left at its last value (typically `connected`) by design (#328's forward decision), so relay = up
while daemon = down is a legitimate, intended render, not a bug the mapping functions reconcile. A
retryable `daemon-absent` (4404) close similarly leaves the daemon leg at `connecting` (in-progress,
never down) while the relay leg reads up/"Reachable" — both legs are honest about their own hop only.

`ConnectionStatusIndicator({ relay, daemon })` is the exported pure view: a
`<span className="status-row__connection" role="group" aria-label="Connection status">` holding one
`.conn-leg` per leg (relay first, then daemon), each a `.conn-dot--{category}` (`aria-hidden`,
decorative — colour is redundant with the label) plus a `.conn-leg__label` span. A static
`role="group"`, not a live region — the banner (#279) already announces disconnect transitions, so a
second live region here would double-announce. `ConnectionStatusIndicatorControl`, the in-file
container, reads `useRelayLinkStore(selectRelayLinkStatus)` and `useSessionStore(selectStatus)` (the
`QueuedBacklogControl` two-independent-store precedent — re-anchored here by [#618](../codebase/618.md)
after the original, `ScreenSnapshotControl`, was removed) and passes the mapped legs down; no
`window.pyry`, no IPC, no effects, so the server-rendered smoke test touches no bridge. Initial state
is one Unknown dot and one Offline dot — the relay leg's `null` sentinel reads `unknown`/`Relay
Unknown` since [#719](../codebase/719.md) (previously collapsed into a second `down`/`Relay
Offline`, #330's original choice), while the daemon leg's `disconnected` still reads `down`/`Pyrycode
Offline`.

Mounted inside `StatusRow`'s previously-empty `.status-row__summary` span, now a flex row
(`gap: var(--space-3); min-width: 0`) so the dots and #181/#182's future run-config summary text
("Opus 4.7 · high · 73% used") can sit side by side — this slice does not claim the slot
exclusively. New theme token `--color-warning: #ffca45` (`tokens.css`, after `--color-error`) drives
the in-progress dot — M3 has no warning role and the design-system file has no such variable (the
two-dot line post-dates the 2026-05-08 Figma lock, a code-era addition like the dots themselves).
[#719](../codebase/719.md)'s `unknown` category reuses the existing `--color-outline` token (no new
token added) — the same achromatic fill already used for the `.run-config__switch-knob`/
`.settings__switch-knob` off-state chips, chosen because it is the only achromatic option among the
four categories and carries no success/failure valence. `.conn-dot` is an 8px circle (structural
component geometry, the `.run-config__context-bar` precedent, not a spacing token); `.conn-leg__label`
is `body-small` on `--color-on-surface-variant`, `white-space: nowrap`.

**Screen-reader note (accepted, not a gap):** the indicator sits inside `StatusRow`, a `<button
aria-label="Run configuration">` — the button's `aria-label` overrides its inner text as the
accessible *name*, so the connection labels are visible content but not announced as part of the
button's name. This satisfies AC2 (colour-independence via visible text) and matches Figma's summary
placement inside the row button; a dedicated live-region announcement was left out of scope, since
the banner (#279) already announces the disconnect transition.

Not security-sensitive: pure presentation over already-classified, content-free store state (#328's
guarantee) — no transport, crypto, or socket code touched. See [#330 codebase
notes](../codebase/330.md) for the full design, the leg → category → label matrix tests, and the
code-review record.

**Second consumer since [#718](../codebase/718.md).** `relayLeg`/`daemonLeg`/`ConnectionLeg` are now
also imported into `channels/ChannelList.tsx`, whose `HostConnectionDots` renders the same two legs
as a label-less dot pair on the sidebar's host row (host leg first, the reverse of this section's
`ConnectionStatusIndicator(relay, daemon)` order). The TS mapping has one copy, imported across
screens; the CSS category → colour binding (`.conn-dot--up/--in-progress/--down/--unknown`, just
above, four rules since [#719](../codebase/719.md)) also has one copy, worn by the sidebar dot
without the `.conn-dot` 8px base it sits beside here — so removing this indicator would need to
relocate those four rules rather than deleting them. See the [Channel List home
screen](channel-list.md) doc and [#718 codebase notes](../codebase/718.md).
