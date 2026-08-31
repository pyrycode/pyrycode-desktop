# #680 — Actions menu sending reset, compact and knowledge capture as slash commands

## Files to read first

Codegraph is wired but **not indexed** for this repo (`codegraph_context` → `CodeGraph not initialized`,
confirmed again 2026-08-27), so this list is hand-built from grep/Read rather than lifted from a
structured query. Read these before writing anything.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:25-60` | `ComposerOptionsPanelOption` (`{ id, label }`) and the panel's prop contract. Note the `id`/`label` split and the documented `currentId: null` case. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:115-273` | `ComposerOptionsMenu` — the six props you consume, the trigger it renders, and the sentence "THE TRIGGER'S BEHAVIOUR IS THE CONTAINER'S; ITS LABEL AND APPEARANCE ARE THE CONSUMER'S". That sentence is this ticket's whole boundary. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2153-2273` | `Composer` — the container you edit. `handleSubmit`'s `canSend` gate, the `submitMessage` deps object, the `onMessageSent()` notify, and the `.composer__footer` mount at 2268-2270. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2042-2052` | `SEND_LABEL` / `INTERRUPT_LABEL` — the module-level client-owned-label convention, and the warning that these strings are load-bearing e2e locators. `COMPOSER_ACTIONS_LABEL` joins that club. |
| `src/renderer/src/screens/conversation/composerSend.ts:50-91` | `submitMessage`'s signature and its two `false` returns. It already takes the text as an argument — that is why this ticket needs no new send path. |
| `src/renderer/src/screens/conversation/conversation.css:1490-1548` | `.composer__footer` (hard `height: 20px`, `gap: var(--space-5)`, `padding: 0 var(--space-4)`) and `.composer__context`. The `--color-primary` hoist question this spec answers is in the 1531-1535 comment. |
| `src/renderer/src/screens/conversation/conversation.css:3307-3334` | `.composer-options-anchor` — why it is `display: flex` with no padding, and why its flex sizing was left to this ticket. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.test.tsx:1-72` | The static-render test idiom: `renderToStaticMarkup`, `rowCount`, `focusableRowLabel`, and the standing note that nothing here can click. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:2997-3016` | The `describe('ConversationScreen — store binding')` container smoke suite and the two `.composer__footer` mount tests you extend. |
| `e2e/send-and-stream.spec.ts` (whole file, 123 lines) | The fake-tier template: `launchPairedApp({ buildReplyFrames })`, decoding the outbound envelope inside `buildReplyFrames`, and the `.bubble[data-thread-role="user"]` optimistic-echo assertion. |
| `e2e/fixtures/launchPairedApp.ts:64-90, 152-185` | `SEEDED_ROW`, `seedConversationsFrame()`, and the rule that a spec scripting `buildReplyFrames` owns seeding its own default arm. |
| `CLAUDE.md` § "Renderer tests are static server renders" and § "Driving a running session" | Why the interaction proof must be Playwright, and the measured claude-2.1.220 slash-command behaviour this ticket rests on. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3677

A bare inline row — the word `Actions` in M3 body/small at `schemes/primary`, then a 4px gap, then an
8×4 chevron pointing **up** — with no border, no fill and no padding of its own. It is the composer
footer's leftmost item (Figma 110:3494, items at x=0/76/135/197/253) and it opens the already-built
options panel at node `121:3879`, which this ticket does not redraw.

The chevron is `chevron-up-solid-full`, exported verbatim at 8×4 in an 8×4 viewBox:

```
M3.59822 0.146303C3.82044 -0.0482491 4.18133 -0.0482491 4.40356 0.146303L7.81689 3.13463C8.03911 3.32918 8.03911 3.64514 7.81689 3.83969C7.59467 4.03424 7.23378 4.03424 7.01156 3.83969L4 1.20311L0.988445 3.83813C0.766222 4.03268 0.405333 4.03268 0.183111 3.83813C-0.0391111 3.64358 -0.0391111 3.32763 0.183111 3.13307L3.59644 0.144747L3.59822 0.146303Z
```

Inlined here rather than left as a fetch instruction: the developer's dispatched tool whitelist may not
carry the Figma MCP, and a spec that defers on a hex or a path has cost rework loops before.

The export's `fill="#32628D"` is the **light** scheme's primary. Desktop is dark-only (ADR 0003), so the
glyph takes `fill="currentColor"` and inherits the button's `--color-primary` — never the hex, the
standing `.composer-status` / `.status-row` rule.

**The chevron does not flip on open.** The design draws one state, and `ComposerOptionsMenu` keeps its
`open` flag private — reading it would mean a new prop on the surface four tickets share, which the
ticket body forbids and which this spec declines. An up chevron at rest is honest anyway: the panel
opens upward.

## Context

Three commands — `/clear`, `/compact`, `/knowledge-capture` — are typed by hand today. They need no
daemon change: claude intercepts a message whose text begins with a slash and runs it as a command
(measured 2026-08-21 against claude 2.1.220), and an unknown command returns a synthetic
"Unknown command" reply at zero turns and zero cost. So the entire feature is *a menu that types for
you*, and the correct implementation is the one that adds **no new send path at all**.

`ComposerOptionsMenu` (#838 surface, #839 placement, #840 interaction) has shipped dormant across three
tickets. Nothing in the app renders it. This ticket is its first live mount, which is why #840 deferred
its in-app interaction proof here.

## Design

### Module layout

Three new files; two existing files modified.

| File | Status | What it holds |
| --- | --- | --- |
| `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` | new | `COMPOSER_ACTIONS`, `COMPOSER_ACTIONS_LABEL`, `ComposerActionsMenu` |
| `src/renderer/src/screens/conversation/ComposerActionsMenu.test.tsx` | new | the data + static-render unit tests |
| `e2e/composer-actions.spec.ts` | new | the fake-tier interaction proof |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | modified | `sendText` extraction inside `Composer`; the footer mount |
| `src/renderer/src/screens/conversation/conversation.css` | modified | `.composer__actions`, `.composer__actions-icon` |

**Its own file, not `ConversationScreen.tsx`.** That file is ~2700 lines and a declared merge hot-spot —
`ComposerOptionsPanel.tsx:10-14` records exactly that reasoning for itself. #682 (permission mode) and
#683 (model and effort) are two more footer menus of the same shape queued behind this one; three
tickets each appending 70 lines to the same 2700-line file is three merge conflicts. This file is the
precedent they follow, and it keeps `ConversationScreen.tsx`'s diff to an import plus one JSX element
plus the `sendText` extraction.

### The entries are the mapping

```ts
// ComposerActionsMenu.tsx
export const COMPOSER_ACTIONS: readonly ComposerOptionsPanelOption[]
export const COMPOSER_ACTIONS_LABEL = 'Actions'
```

Three entries in this order, and **the `id` IS the command sent verbatim as message text**:

| `id` (sent as message text) | `label` (visible row) |
| --- | --- |
| `/clear` | `Reset session` |
| `/compact` | `Compact session` |
| `/knowledge-capture` | `Knowledge capture` |

This is the load-bearing decision in the spec, so it gets the argument. `ComposerOptionsPanelOption.id`
is documented as "the stable identity — the wire/model value", separate from `label` because #683 shows
`Opus 5` for `claude-opus-5`. A command menu has no wire/model value behind the row; the command string
*is* the identity. Making them one thing means:

- `COMPOSER_ACTIONS` passes **straight** into `options` — no `.map()` on every render, no `useMemo`, no
  parallel array to drift.
- `onSelect(id)` is `onCommand(id)` with no lookup, therefore **no unreachable `undefined` branch** to
  write, test or `!`-assert. A `{ id, label, command }` shape would force a `.find(…)?.command` whose
  `undefined` arm the panel can never produce — a branch that exists only to satisfy the compiler.
- AC2's mapping cannot be got wrong: there is nothing between the picked row and the sent text.

The ids are unique, which is the panel's stated `key` contract. Every id begins with `/`, which is the
whole mechanism — a test pins it as a property of the array, not of one entry.

Do **not** add a `command` field, a lookup function, or a `ComposerActionId` union. All three are
ceremony around a three-element array whose ids are already the answer.

### The component

```ts
export function ComposerActionsMenu({ onCommand }: { onCommand: (command: string) => void }): JSX.Element
```

One required effect prop (the "a view that cannot answer is a bug" rule, `ConversationScreen.tsx:2033`).
No store read, no `window.pyry`, no state of its own — the open/close/keyboard/focus machinery is
`ComposerOptionsMenu`'s, and the send gate is the container's. It renders exactly one thing:

`<ComposerOptionsMenu options={COMPOSER_ACTIONS} currentId={null} onSelect={onCommand} ariaLabel={COMPOSER_ACTIONS_LABEL} triggerContent={…} triggerClassName="composer__actions" />`

Four of those six props are settled by the ticket body and need no deliberation. The two that need a
note:

- **`currentId={null}`** — a list of actions, not a choice. No row wears `aria-current`; the panel
  already handles this through the same branch a non-matching id takes (`ComposerOptionsPanel.tsx:32-35`).
- **`ariaLabel`** reuses `COMPOSER_ACTIONS_LABEL`, so the `role="menu"` and its trigger carry the same
  accessible name. Two roles, one name — Playwright and assistive tech both disambiguate by role.

`triggerContent` is the text `Actions` followed by the chevron `<svg>`. The svg **must** carry
`aria-hidden="true"`: the container deliberately puts no `aria-label` on the trigger (WCAG 2.5.3
label-in-name), so the button's accessible name is computed from its contents, and an exposed `<svg>`
could perturb the exact string `Actions` that the e2e locator matches.

`COMPOSER_ACTIONS_LABEL` is a module-level client-owned constant, exported, following
`SEND_LABEL` / `INTERRUPT_LABEL` (`ConversationScreen.tsx:2042-2052`) — and inherits their warning: once
the e2e spec locates by it, **it is a load-bearing locator and may not be reworded** without updating
`e2e/composer-actions.spec.ts`. Figma's text node reads `Actions ` with a trailing space; that is a
design artifact, the constant is `'Actions'`.

### The container edit — one gate, one send path

`Composer` (`ConversationScreen.tsx:2153`) grows a single extracted function. `handleSubmit` today is:
gate on `canSend` → `submitMessage(text, …)` → on `true`, `setText('')` and `onMessageSent()`. Split it
so the message-box's *text-clearing* stays in `handleSubmit` and everything else becomes reusable:

```ts
// inside Composer, above handleSubmit
const sendText = (value: string): boolean => { /* the existing canSend gate, submitMessage call
                                                  with the existing deps object, and the sent &&
                                                  onMessageSent() notify — moved, not rewritten */ }
const handleSubmit = (): void => { if (sendText(text)) setText('') }
```

Then `<ComposerActionsMenu onCommand={sendText} />` in the footer.

This is behaviour-preserving for the typed path by construction: the gate, the deps object, the notify
and the clear all keep their existing order and their existing conditions. `window.pyry.sendCommand` is
still dereferenced only inside `sendText`, i.e. at interaction time and never during render — the
property `ConversationScreen.tsx:2186-2187` and `:2244-2249` both depend on, and the reason every
container smoke test can server-render without a bridge mock. **Do not hoist the deps object out of
`sendText`.**

AC3 and AC4 fall out of this shape rather than being enforced:

- **AC3** — a picked command reaches `submitMessage` through the identical call the send button makes,
  so it gets the same `message_id`, the same wire `send_message`, the same optimistic `userText` echo
  into both timeline stores, and the same `onMessageSent()` → `followBottom()` scroll follow.
- **AC4** — `sendText`'s first line is the `canSend` gate, and there is no second entry point to forget.
  The menu holds no `canSend` prop of its own precisely so that a second, drift-capable copy of the gate
  cannot exist.

The trigger button is **never disabled**, including while disconnected. AC4 asks that picking send
nothing, not that the menu be unopenable; the composer already shows its `Not connected` hint one row up
and disables the send control, so a silently inert pick is consistent with what the operator is already
being told.

### Mount position

`<ComposerActionsMenu />` goes **before** `<ContextUsageControl />` inside `.composer__footer` — the
ticket body's "the footer button is the first one in that row", matching Figma's x=0 item. #682/#683
prepend further siblings later; #685 right-aligns with `margin-left: auto`.

### Styling

Two rules, both new, both in `conversation.css` beside `.composer__context`.

`.composer__actions` — the trigger. A `<button>` needs an explicit reset (`padding: 0`, `border: none`,
`background: none`, `cursor: pointer`) plus `display: flex; align-items: center; gap: var(--space-1)`
for the 4px label→chevron gap, plus `color: var(--color-primary)`, plus `.composer__context`'s four
body-small type declarations and its `font-family: var(--font-sans)`, plus `white-space: nowrap` for the
row's hard 20px height. Do **not** set `outline: none` — every close path in `ComposerOptionsMenu`
returns DOM focus to this button, so its focus ring is load-bearing.

`.composer__actions-icon` — `flex: 0 0 auto`, the Figma node's own `shrink-0`. Size comes from the svg's
`width="8" height="4"` attributes, the `.composer__send-icon` idiom.

**The `--color-primary` hoist is declined**, and this spec is the place that answers the question
`conversation.css:1531-1535` left open. The invitation was to move the colour from `.composer__context`
onto `.composer__footer` once a second consumer arrived. It does not pay: the UA stylesheet sets both
`color` and `font-family`/`font-size`/`font-weight`/`line-height` on form controls, so a hoisted `color`
would not reach a `<button>` at all — every button-shaped consumer would still declare `color: inherit`
plus a font block, which is not fewer declarations than `color: var(--color-primary)` plus the same font
block, and it would split the row's treatment across two rules for nothing. Leave `.composer__context`
exactly as it is.

The real extraction, when it is earned, is a shared `.composer__footer-button` class carrying the reset,
the body-small type and the primary colour for all four footer buttons. One consumer is not a pattern;
**#682 landing as the second button is the moment to lift the common declarations out of these two
rules.** Record that, do not pre-build it.

## State + concurrency model

None added. The menu's open state, focused index and both effects (row focus, outside-click listener)
are `ComposerOptionsMenu`'s component-local `useState`/`useEffect`, already shipped and already tested —
ADR 0006's "ephemeral single-value screen-local state → `useState`, never the store". `Composer` gains
no store subscription; it keeps the four it has. Nothing is async, nothing is cancellable, no new IPC
arm, no new command type, no wire change.

## Error handling

There is no new failure mode. `submitMessage` already swallows a send-bridge throw and still posts the
optimistic echo (`composerSend.ts:67-72`); a picked command inherits that verbatim.

The interesting non-failure is `/knowledge-capture` in a workspace that does not define it: claude
answers with a synthetic "Unknown command" assistant reply at zero turns and zero cost. That is a
correct, visible, harmless outcome — **not** something this ticket detects, guards or greys out. Greying
out is #681 and needs a daemon change first.

`/clear` and `/compact` are client-owned constants. No daemon-supplied string enters this component:
labels and ids are module literals, and the panel renders `option.label` as an ordinary auto-escaped
React text child. Nothing reaches an attribute, a URL, a filename or a log.

## Testing strategy

### `ComposerActionsMenu.test.tsx` — vitest, static render

The data half executes directly; the markup half is `renderToStaticMarkup`, following
`ComposerOptionsPanel.test.tsx`'s idiom (and its `rowCount` / `focusableRowLabel` helpers, which are
worth copying rather than re-deriving).

- `COMPOSER_ACTIONS` holds exactly three entries, in the order Reset / Compact / Knowledge capture, with
  the labels and ids the table above gives. One assertion over the whole array, so a reordering or a
  typo in either column fails.
- Every `id` begins with `/` — the property the entire feature rests on, asserted over the array rather
  than per entry.
- The ids are pairwise unique (the panel's `key` contract).
- Server-rendering `<ComposerActionsMenu onCommand={noop} />` yields: one `.composer-options-anchor`;
  one trigger carrying `class="composer__actions"`, `aria-haspopup="menu"` and `aria-expanded="false"`;
  the visible text `Actions`; and **no** `.composer-options` rows — the panel is closed at mount, which
  is `ComposerOptionsMenu`'s `useState(false)` seen from outside.
- The trigger's chevron carries `aria-hidden="true"`, so the button's accessible name is exactly
  `Actions`. Name this test for the e2e locator it protects.
- Feeding `COMPOSER_ACTIONS` to `ComposerOptionsPanel` directly (`currentId={null}`) yields three rows,
  all three labels, and **zero** `aria-current` occurrences. This is the "the three entries reach the
  shared panel with no current row" proof; the menu's own static render cannot show an open panel, and
  faking one would be dishonest.

`onCommand` is not exercised here — a static render fires no events. The e2e tier drives it.

### `ConversationScreen.test.tsx` — the mount-site guard

Two additions to the existing `describe('ConversationScreen — store binding')` block, beside the #811
footer tests at 2997-3016. These are the only tests that prove the control is actually *wired* — an
unmounted component passes every assertion above.

- `<ConversationScreen />` renders `composer__actions` inside `class="composer__footer"`, closed
  (`aria-expanded="false"`), with no `.composer-options` panel in the markup.
- The Actions trigger precedes the context reading in DOM order, matching Figma's x=0 position. Use the
  #811 index-comparison idiom at 3010-3016. Note that the container smoke renders against the *initial*
  run-config store, where the reading is absent — so compare the trigger's index against
  `class="composer__footer"`'s, not against `composer__context`'s.

Both of these render against a **disconnected** session: zustand v5 reads `getInitialState()` under
`renderToStaticMarkup`, never `getState()` (the standing note at
`ConversationScreen.test.tsx:2972-2977`, measured 2026-08-27 — a `beforeEach` `setState` cannot stage a
different arm). That is convenient rather than limiting: it means these tests also pin AC4's static
half, that the trigger renders **enabled** while the composer cannot send. Assert that explicitly.

### `npm run typecheck`

`readonly ComposerOptionsPanelOption[]` flowing into `options` is checked at compile time, which is what
makes "the entries reach the panel unmapped" a type-level fact rather than a test.

### `e2e/composer-actions.spec.ts` — the fake tier, and the interaction proof #840 deferred here

Template: `e2e/send-and-stream.spec.ts`. Launch via `launchPairedApp({ buildReplyFrames })`. The spec
scripts its own `buildReplyFrames`, so it owns seeding its default arm with the exported
`seedConversationsFrame()` — the fixture's default `buildReply` is overridden.

`buildReplyFrames` runs in the test process, so it can **capture** the decoded outbound envelope into a
test-local array before returning frames. On `send_message`, push the payload and return `[]` (no daemon
reply is needed; the optimistic echo is what AC3 asks about). That captured payload is AC2's real
proof — it shows the command travelling as a `send_message`'s `text`, not as some new command type.

Scenarios, each a bulleted expectation rather than pre-written code:

- **Open, pick, arrive (AC1+AC2+AC3).** Click the `Actions` button → the `role="menu"` panel is visible
  with exactly three rows reading Reset session / Compact session / Knowledge capture → click
  `Reset session` → `.bubble[data-thread-role="user"]` reads `/clear`, and the single captured outbound
  is a `send_message` whose `text` is exactly `/clear`. Assert the outbound *and* the bubble: the bubble
  alone would pass if the echo were painted without anything being sent.
- **Escape dismisses and returns focus (AC1).** Open → press `Escape` → the panel is gone and the
  `Actions` button is focused.
- **Outside click dismisses (AC1).** Open → click the message thread → the panel is gone.
- **A second entry maps to its own command (AC2).** Pick `Compact session` → the captured outbound's
  text is `/compact`. One additional entry is enough to prove the mapping is per-row rather than
  hardcoded; a third adds no information.

AC4's interactive half is **not** driven in e2e. Reaching a disconnected composer in the fake tier means
tearing down the fake daemon mid-spec, and no existing spec does it — building that drive is a larger
piece of fixture work than this ticket's whole feature. AC4 is covered instead by (a) the structural
argument above: one `canSend` gate, one `sendText`, no second entry point, reviewable by reading
`Composer`; and (b) the container smoke's disconnected render, which pins that the trigger is present
and enabled in exactly that state. **Say this out loud in the spec's e2e comment** so a later reader
knows it was decided rather than forgotten.

Add the spec to the default `npm run e2e` tier (it needs no real daemon and no credential).

## Out of scope — do not drift into these

- **Widening `ComposerOptionsMenu`.** If this ticket finds itself wanting a new prop on that component,
  stop and say so on the issue. Four consumers share it.
- **The right-edge clamp.** `composerOptionsShiftPx` and `--composer-options-shift` stay dormant; that
  is a separate ticket blocked by this one. The leftmost footer anchor never reaches the right edge.
- **Greying out an absent command** — #681, needs a daemon change.
- **Extracting `.composer__footer-button`** — earned when #682 lands as the second button, not now.
- **Any file outside `src/`, `e2e/` and this spec.** The package overview at
  `docs/knowledge/features/conversation-shell.md` is the documentation phase's; do not touch it.

## Open questions

None blocking. Two things a reviewer may reasonably want revisited later, neither of which changes the
implementation:

1. Whether a silently inert pick while disconnected wants a visible acknowledgement. AC4 specifies
   silence, the composer hint already explains why, and inventing a toast here would be a surface this
   milestone does not have.
2. Whether the chevron should flip on open once a second or third footer menu makes the static-up
   treatment feel wrong. That is a change to the shared component's prop surface and belongs with
   whichever ticket has three real consumers to justify it.
