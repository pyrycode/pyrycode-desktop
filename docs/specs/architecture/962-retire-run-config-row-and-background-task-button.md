# 962 — Retire the run-configuration trigger row and the background-task button

The region between the thread and the message box empties. `StatusRow` (#177) and
`BackgroundTaskTrigger` (#581) go; their two overlays keep an entry point as items in the existing
per-conversation overflow menu, which grows from one hardcoded item to three.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `StatusRow`,
  `BackgroundTaskTrigger`, `BACKGROUND_TASK_TRIGGER_LABEL`, `ConnectionStatusIndicator`,
  `ConnectionStatusIndicatorControl` — the five symbols this ticket deletes; and
  `ThreadOverflowMenuView` / `ThreadOverflowMenu` — the pair it generalises. Also the two mounts inside
  `ConversationScreen` and the `sheetOpen` / `panelOpen` comments that name the retired triggers.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `relayLeg`, `daemonLeg`,
  `ConnectionLeg` — the three that STAY. They are the sidebar's leg mapping since #718 and are
  imported by `ChannelList.tsx`; only the view and its container go.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostConnectionDots` — the second consumer of
  the four `.conn-dot--*` colour bindings, worn without the `.conn-dot` base. Its doc comment cites
  the bindings' file and must follow them.
- `src/renderer/src/screens/conversation/conversation.css` → the `.status-row` … `.conn-leg__label`
  block and `.background-task-trigger` with its hover/focus rules — what is deleted, and the four
  `.conn-dot--*` rules inside that block that must move rather than die.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host-dot` and its comment; the
  `.conversation-status-dot` doc comments — four claims about where the colour bindings live, one of
  which inverts on the move.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the
  `ConnectionStatusIndicator` matrix describe, the `ThreadOverflowMenuView` describe, and the
  container `it`s that assert the two retired triggers. The bare-screen posture (the menu is gated on
  `onBack`, so `<ConversationScreen />` cannot open either overlay) is what decides where each
  assertion lands.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → its `DOT_*_MARKER` constants — the unit
  tier's surviving proof that the four modifier classes are emitted, which is why deleting the
  `ConnectionStatusIndicator` matrix describe loses no coverage of the class names.
- `e2e/conversation-create-rename.spec.ts` → its overflow-trigger + `getByRole('menuitem')` sequence —
  the idiom every re-pointed open follows.
- `e2e/composer-message-box.spec.ts` → `tokenColor` — the shipped throwaway-probe +
  `getComputedStyle` idiom the new colour spec reuses.
- `e2e/host-label-sidebar.spec.ts` → its `.channel-list__host-dot` count assertion — the sidebar half
  of AC3, and the `launchPairedApp` posture the new spec copies.
- `e2e/real-daemon-session-settings.spec.ts`, `e2e/run-config-settings.spec.ts`,
  `e2e/stall-bundle.spec.ts` → the four sheet opens that re-point.
- `docs/knowledge/features/conversation-shell-chrome.md` § "Screen-reader note (accepted, not a gap)"
  — records that the two-dot indicator sat inside a `<button>`, an accepted a11y compromise. The
  deletion removes the compromise rather than working around it; nothing to carry forward.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

N/A for a new surface — this ticket draws nothing. The desktop frame stacks the message area directly
onto the input area (`347:5408`: status row, message box, footer); read at `102:4`, the space between
the last thread row and the status row carrying `Thinking…` and the pairing-error chip is empty. That
emptiness is the whole acceptance. The two overflow-menu items wear the existing
`conversation__overflow-item` treatment and have no drawing of their own; the mobile `16-57` row this
retires is the design being left behind.

## Context

The chat pane still carries the phone's run-configuration row: a full-width button holding the two-dot
connection indicator and a chevron onto `StatusSheet`. Its three jobs have all been re-homed —
permission mode and model/effort to the input footer (#682, #683), the context gauge to the footer's
reading (#811), the connection dots to the sidebar host row (#672, #718) — and the desktop design
draws no home for it. The background-task trigger beside it (#581) never had one at all.

The sheet and the panel both stay: the sheet is the only surface for the model/effort/bypass writes
until #683 lands and the only home of the log-data download (#72), and three specs drive it, one in
the real-daemon gate. So both keep an entry point in `ThreadOverflowMenu` (#276) — itself mobile-era
chrome a later ticket retires alongside the sheet.

No ADR is warranted. The design decision (the footer menus replace the sheet) is Juhana's ruling of
2026-09-02, already recorded on the ticket and in the vault's Chat Screen Design note; this ticket
implements it and adds no new architectural contract.

## Design

### The menu grows from one item to three

`ThreadOverflowMenuView` keeps its trigger verbatim and renders its menu surface by mapping a local
array of `{ label, onSelect }` instead of one literal `<button role="menuitem">`. The three labels
stay **inside the view** as client-owned literals, in AC2's order:

1. `Channel info`
2. `Run configuration`
3. `Background tasks`

Keeping the labels in the view rather than passing them in as data is the load-bearing choice. The
container `ThreadOverflowMenu` is in-file and not exported, and the screen gates the menu on `onBack`,
so a bare `<ConversationScreen />` can never open it — the pure view is the ONLY place the unit tier
can see the shipped copy and its order. Those two strings are also the accessible names four e2e
opens locate by, so a typo has to fail a unit assertion, not just a Playwright timeout. The prop shape
therefore grows from one `onSelect` to three named ones:

```ts
onSelectChannelInfo: () => void
onSelectRunConfiguration: () => void
onSelectBackgroundTasks: () => void
```

The rejected alternative was `items: readonly { label, onSelect }[]` built by the container. It is the
tidier type, and it moves both new labels out of the one surface that can prove them — the view's
describe would then assert injected fixtures rather than shipped copy. Ordering would become a
container fact with no unit witness at all.

### The container invokes all three on identical terms

`ThreadOverflowMenu`'s single `select` becomes a factory so close → invoke → return-focus is written
once and each item gets the same three steps AC2 asks for:

```ts
const select = (action: () => void) => (): void => { … }
```

Its three action props become **required**, replacing today's optional `onChannelInfo?`. That
optionality existed only because #276 shipped before #365 wired the item — the item was a live no-op
by design then. All three are wired now at the one mount site, so required props turn a forgotten wire
into a compile error instead of a menu item that silently does nothing, which is exactly AC2's
failure mode.

### The mounts

The two deleted mounts' bodies move onto the menu unchanged: `setSheetOpen(true)` and
`setPanelOpen(true)` are what the retired triggers did, so both overlays keep their existing
open/close lifecycle and the `useState` pair above is untouched. Only the sentence in each state's
comment naming its retired trigger is corrected.

### Deleted, and what stays

Deleted from `ConversationScreen.tsx`: `StatusRow`, `BACKGROUND_TASK_TRIGGER_LABEL`,
`BackgroundTaskTrigger`, `ConnectionStatusIndicator`, `ConnectionStatusIndicatorControl`, and the two
mounts. `relayLeg`, `daemonLeg` and `ConnectionLeg` stay — `ChannelList.tsx` imports all three.
`useRelayLinkStore` / `selectRelayLinkStatus` become unused in this file with
`ConnectionStatusIndicatorControl` gone and their import goes with it; `useSessionStore` /
`selectStatus` have other readers here and stay.

Deleted from `conversation.css`: `.status-row` through `.conn-leg__label`, and
`.background-task-trigger` with its hover and focus-visible rules.

### The colour bindings move rather than die

`.conn-dot--up` / `--in-progress` / `--down` / `--unknown` move to `channels.css`, landing directly
after `.channel-list__host-dot` — the colour half beside the geometry half, which is now their only
consumer. This is precisely what the block's own comment instructs whoever deletes the rest of
`.status-row__connection` to do, and why: the sidebar's dots wear the modifiers without the
`.conn-dot` base, so dropping them would leave two 6px unpainted boxes and the unit tier, asserting
markup in a node environment, would never see it.

The carried comment is rewritten for its new owner. Two of its sentences no longer hold as written:
the "second consumer since #718" framing inverts (the sidebar is now the *only* consumer), and
`--unknown`'s reasoning against `--color-on-surface-variant` argues from `.conn-leg__label`'s colour,
a class this ticket deletes. That argument is restated against the host row's own label colour, which
is the same token and the same "a dot in the colour of the text beside it reads as a bullet" point,
on ground that still exists.

Four claims elsewhere become false on the move and are corrected: `channels.css`'s
`.channel-list__host-dot` comment (both the "in conversation.css" pointer and the "must NOT be
re-declared here" contract, which inverts — the same one-copy-in-the-renderer contract #330's AC2 asks
for, now naming this file as that copy), the two `.conversation-status-dot` doc comments that cite
`conversation.css` line ranges (already stale today; they become symbol citations), and
`HostConnectionDots`'s doc comment in `ChannelList.tsx`.

The nineteen other sites naming the deleted classes and components are prose anchors citing a
precedent that did exist, and are left alone per the ticket — including the two
`.conn-dot { width: 8px }` geometry-precedent citations in `channels.css`, which will name a rule this
ticket removes. Editing correct reasoning to chase a vanished exemplar is churn; the ticket rules on
this explicitly and the plan follows it.

## State + concurrency model

Unchanged. No store, no selector, no subscription and no async work is added, removed or re-pointed.
`sheetOpen` and `panelOpen` keep their `useState` cells and their reset-on-remount behaviour (ADR
0006); only the callers of their setters move from two deleted buttons to two menu items. The one
subscription that disappears is `ConnectionStatusIndicatorControl`'s pair of narrow store reads, which
goes with the component — the sidebar's own container keeps reading both legs independently.

`ThreadOverflowMenu`'s open/close `useState` and its document-listener effect (Escape / outside-click,
attached only while open, torn down on close and unmount) are untouched: three items ride the same
shell one item did.

## Error handling

No I/O, no IPC, no parse and no new failure mode. The one failure this ticket can introduce is a
silent visual one — the sidebar's dots going unpainted if the colour bindings are lost in the
deletion — which is why AC3 is proven by a computed `backgroundColor` read rather than by class
presence, and is covered below.

## Testing strategy

### Unit (vitest, `renderToStaticMarkup`)

- **`ThreadOverflowMenuView` describe** grows to the three-item surface: closed still renders the
  trigger and no `role="menu"` and none of the three labels; open renders exactly three
  `role="menuitem"` buttons carrying the three labels in AC2's order, asserted by `indexOf`
  ordering and a menuitem count. `Run configuration` and `Background tasks` land here as menuitem
  TEXT — the accessible name of a menuitem is its content, so the two retired `aria-label="…"`
  assertions become text assertions on the item rather than moving verbatim.
- **AC1 at the container**, replacing the four retired `it`s: one render of a bare
  `<ConversationScreen />` asserting the absence of `status-row`, `background-task-trigger`,
  `aria-label="Run configuration"` and `aria-label="Background tasks"`. Keyed on the class and
  attribute forms, never on the bare label strings — those two strings legitimately appear elsewhere
  in this file (the menu describe, `StatusSheet`'s title), so a bare-string negative would be both
  false and self-defeating.
- **Retired**: the `ConnectionStatusIndicator` matrix describe and its import; the four container
  `it`s asserting the status-row trigger, the sheet-closed-by-`Close` proxy, the absent summary text
  and the at-rest two-dot render. `ChannelList.test.tsx`'s four `DOT_*_MARKER` constants keep the
  unit tier's proof that the four modifier classes are emitted, so no class-name coverage is lost;
  the retired describe's leg → label matrix is `relayLeg` / `daemonLeg`'s, and those describes stay.
- **Untouched**: the `StatusSheet` shell describe, and the background-task-panel-closed-at-first-paint
  `it` — which remains the region's "overlay closed at first paint" witness after the sheet's
  equivalent is retired with its trigger.
- Two stale sentences corrected: the header comment above the `relayLeg` describe (it introduces
  `ConnectionStatusIndicator` as the exported view and points at the container render), and the
  "StatusRow keeps its own `aria-haspopup="dialog"`" note above the popup-count assertion — the count
  of 1 below it stays correct and is untouched.

### e2e (Playwright, fake tier)

- **New spec, AC3.** Paints the four modifier classes onto throwaway probe elements and reads back
  `getComputedStyle().backgroundColor`, asserting four values that are pairwise distinct and none of
  them the CSSOM's transparent. Driving four live connection states instead was rejected: the
  `in-progress` category has no stable assertable moment and the drive would be racy, and the risk
  AC3 names is a CSS deletion, not a mapping bug — the mapping already has a unit matrix. The
  sidebar half re-uses `host-label-sidebar.spec.ts`'s two-dot count on the same launch.
- **Four opens re-pointed** in `run-config-settings.spec.ts`, `stall-bundle.spec.ts` and
  `real-daemon-session-settings.spec.ts`: `getByRole('button', { name: 'Run configuration' })` becomes
  the two-step click on `.conversation__overflow-trigger` then
  `getByRole('menuitem', { name: 'Run configuration' })`. All three reach the thread through
  `launchPairedApp`, so `onBack` is present and the trigger is mounted.
- `real-daemon-session-settings.spec.ts` opens the sheet twice and both opens are load-bearing — the
  second proves the read came from the daemon rather than from state the first left behind. Its
  `sheetButton` locator becomes a local two-step helper so both opens keep working from one
  definition. This spec is in the real-daemon gate: it must keep executing, and the gate's skip
  reasons are what to read, never its exit code.

## Open questions

- Whether the three menu items should advertise `aria-haspopup="dialog"` like the two buttons they
  replace. Leaning no: the shipped `Channel info` item opens a dialog today and carries none, and a
  divergence inside one menu is worse than a missing hint. Resolve while implementing; a change here
  also has to keep the bare-tree `aria-haspopup="menu"` count assertion at 1.
- Whether deleting the `.conn-dot` base rule leaves any consumer. Grep says the base was worn only by
  `ConnectionStatusIndicator`'s dots, and the sidebar deliberately wears the modifiers without it —
  confirm at the class's last call site before removing it.

## Revisions

### 2026-09-03 — both open questions resolved, design unchanged

- **The menu items carry no `aria-haspopup="dialog"`**, as the question leaned. `Channel info` has
  opened a dialog without one since #276, and advertising the hint on two of three items would read as
  a difference between them rather than as extra help. The reasoning is recorded on
  `ThreadOverflowMenuView`. The bare-tree `aria-haspopup="menu"` count assertion is untouched and still
  passes at 1 — a dialog hint was never one of the popups it counts.
- **The `.conn-dot` base rule had no surviving consumer** and was deleted with the rest of the block.
  `HostConnectionDots` wears the four modifiers flat on `.channel-list__host-dot`, which was already
  the deliberate split; the base only ever carried the retired row's 8px box.

One correction outside both questions, found while moving the colour block. The `--unknown` rule's
comment argued against `--color-on-surface-variant` on the grounds that it was `.conn-leg__label`'s own
colour — a class this ticket deletes. Restating it against the host label next to the moved rules would
have shipped a false claim: `.channel-list__host-label` is `--color-on-surface`, not the variant. The
argument is restated against the token's actual role in `channels.css` (this file's muted text token,
worn by the section headings and most secondary row copy), which is verifiable where it now stands.
