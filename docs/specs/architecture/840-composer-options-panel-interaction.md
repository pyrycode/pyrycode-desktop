# 840 — Opening, dismissing and keyboard-driving the composer options panel

Ticket: [#840](https://github.com/pyrycode/pyrycode-desktop/issues/840) · size `s` · split from #692.
Completes the panel begun in #838 (surface) and #839 (placement). Unblocks #680, #682, #683, #694.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The same node #838 and #839 built: an opaque dark-navy column of five 28px rows, body-small labels 12px in,
one row (the current value, `Max`) carrying the lighter `--color-on-primary` fill. **The node draws no
focus, hover or open/closed state** — it is a single resting frame — so this ticket adds no new visual
treatment and touches no stylesheet. `.composer-options__item:focus-visible` (`conversation.css:3240-3242`)
already ships the focus outline the roving focus below reveals; the design's only contribution here is the
confirmation that the current-value fill is a *fill*, not a focus marker, which is why the focused row and
the current row are two independent axes in the markup contract.

## Files to read first

Codegraph is **not indexed for this repo** — `.codegraph/` holds only `.gitignore` + `config.json`, no DB,
so every `codegraph_*` call errors `CodeGraph not initialized` (re-confirmed 2026-08-27). This list was
built by hand. Read these before writing anything.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2653-2710` | **`ThreadOverflowMenu` — the container this ticket twins.** `useState` open flag, `wrapperRef` + `triggerRef`, the `close()`/`select()` pair that both focus the trigger, the document listeners attached only while open and torn down by the effect cleanup, and the `DocumentEventMap['keydown']` indexing trick (a bare `KeyboardEvent` annotation resolves to React's synthetic type in this file). Copy this shape. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2588-2651` | `ThreadOverflowMenuView` — the trigger's ARIA (`aria-haspopup="menu"`, `aria-expanded={open}`) and the `triggerRef?: Ref<HTMLButtonElement>` prop convention (an ordinary optional prop, **not** `forwardRef`; omitted in tests). |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:1-85` | The view being extended in place. Note the "every prop is REQUIRED" rule (line 27), the deliberate absence of an `open` prop (lines 34-38) — this ticket does not add one, the container keeps the `{open && …}` seam — and that each row is already a real `<button type="button" role="menuitem">`. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.test.tsx:1-56` | The static-render harness: `renderPanel()`, `rowCount()`, `countOf()`. The new roving-tabindex assertions extend this file; `renderPanel` gains one defaulted parameter rather than seven call-site edits. |
| `src/renderer/src/screens/conversation/composerSend.ts:93-126` | **The repo's precedent for a keyboard decision as plain data**: `ComposerKeyEvent` (the fields destructured off the synthetic event, so the decision stays testable with no DOM) + `shouldSubmitOnKeyDown`. The new module is this pattern with a richer return. |
| `src/renderer/src/screens/conversation/composerOptionsPlacement.ts:1-40` | The dormant-ship posture ("do not add a caller here to prove it works") **and the right-edge clamp this ticket must not pull in** — the wiring recipe in that comment belongs to #680. |
| `src/renderer/src/screens/conversation/conversation.css:3208-3242` | `.composer-options__item`, its `--current` modifier, `:hover` and `:focus-visible`. Confirm the focus outline already exists: **this ticket adds no CSS.** |
| `src/renderer/src/screens/conversation/conversation.css:3268-3271` | `.composer-options-anchor` (#839) — `position: relative; display: flex`, no padding, no border. The container renders exactly this wrapper. Read the comment above it for why `--composer-options-shift` is set by the *consumer*, not here. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:2523-2560` | **The "interaction container is untested reviewed glue" ruling**, and the one thing a static render *can* prove about a container — the collapsed trigger. §Testing strategy applies both halves. |
| `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` | Why the open flag is component-local `useState` and never the session store. Two booleans and an index do not earn a reducer; §State names the line. |
| `docs/specs/architecture/838-composer-options-panel.md:64-125` | The public surface and markup contract this ticket extends, and the id/label split that makes `onSelect(id)` the right report shape. |
| `docs/knowledge/features/conversation-shell.md:1378-1560` | The overview's composer-options section — what #838 and #839 already settled. **Read-only**; the documentation phase folds this ticket in. |

## Context

#838 shipped `ComposerOptionsPanel` as a pure view — props in, markup out, no `open` prop and no trigger,
on the stated grounds that "the trigger belongs to whichever control opens it." That is right for a view
and wrong for four consumers: #680, #682 and #683 would each write the same `useState`, the same document
listeners and the same focus-return, and three copies of a keyboard contract is three chances to get ARIA
wrong. This ticket lands the shared answer once.

Three things ship:

1. **A pure decision module** (`composerOptionsKeyboard.ts`) — where focus starts when the panel opens, and
   what each keystroke does to it. Plain data in, plain data out, no DOM. This is the only part of the
   ticket a vitest spec can execute, and every keyboard AC is proved here.
2. **One new rendered attribute on the panel** — the roving `tabIndex`, so "which row is focusable right
   now" is a fact `renderToStaticMarkup` can pin.
3. **`ComposerOptionsMenu`, a thin container** — the `ThreadOverflowMenu` twin. `useState`, two document
   listeners, the focus calls. Thin enough to be correct by inspection, because nothing can test it.

**This ships dormant.** Nothing mounts `ComposerOptionsMenu` when this ticket lands. #680 is the first live
host. Do not wire it into the footer to prove it works, and do not draw a footer button — #680/#682/#683
draw those.

**Not in this ticket:** the right-edge clamp. `composerOptionsShiftPx` and `--composer-options-shift` stay
dormant. Wiring them needs a layout effect on the anchor and a real x-position, both of which arrive with
#680. The container's anchor `<div>` takes **no `style` prop** — the consumer that needs the custom
property sets it then.

## Design

### Module layout

| File | Change | Holds |
| --- | --- | --- |
| `src/renderer/src/screens/conversation/composerOptionsKeyboard.ts` | **new** | `ComposerOptionsKeyInput`, `ComposerOptionsKeyOutcome`, `resolveComposerOptionsKey`, `initialFocusedOptionIndex` |
| `src/renderer/src/screens/conversation/composerOptionsKeyboard.test.ts` | **new** | The whole keyboard contract, executable |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` | modified | `focusedIndex` + `panelRef` on the view; the new `ComposerOptionsMenu` container below it |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.test.tsx` | modified | Roving-tabindex assertions; the container's collapsed render |

The container lives **in `ComposerOptionsPanel.tsx`, beside the view** — the `ThreadOverflowMenuView` /
`ThreadOverflowMenu` arrangement, and the file is already the addressable module four tickets import from.
It is **exported**, unlike `ThreadOverflowMenu`, because its consumers are in other files. No new CSS file,
no new CSS rule, and — following `PermissionModal.tsx` — no `import './conversation.css'`.

### The pure decision module

```ts
export interface ComposerOptionsKeyInput {
  optionCount: number   // options.length
  focusedIndex: number  // the row that currently has focus
  key: string           // KeyboardEvent.key, verbatim
}

export type ComposerOptionsKeyOutcome =
  | { type: 'focus'; index: number }  // move focus to index; panel stays open
  | { type: 'pick'; index: number }   // report options[index].id and close
  | { type: 'dismiss' }               // close, reporting nothing
  | { type: 'ignore' }                // not ours — leave the event alone

export function resolveComposerOptionsKey(input: ComposerOptionsKeyInput): ComposerOptionsKeyOutcome
export function initialFocusedOptionIndex(
  options: readonly ComposerOptionsPanelOption[],
  currentId: string | null
): number
```

A sealed union on `type`, per CLAUDE.md. `ComposerOptionsKeyInput` is a named object rather than three
positional arguments for `composerOptionsPlacement.ts:44-52`'s reason verbatim: `optionCount` and
`focusedIndex` are the same type and transpose silently. `initialFocusedOptionIndex` takes the option
objects (a `import type` from `./ComposerOptionsPanel` — erased at build, so no runtime cycle) because it
matches on `id`; it is the only part of the module that is not plain numbers.

**Key map**, for an open panel with `optionCount > 0`:

| `key` | Outcome |
| --- | --- |
| `ArrowDown` | `focus` at `(focusedIndex + 1) % optionCount` |
| `ArrowUp` | `focus` at `(focusedIndex - 1 + optionCount) % optionCount` |
| `Enter` | `pick` at `focusedIndex` — **only when `focusedIndex` is in `[0, optionCount)`**; otherwise `ignore` |
| `Escape` | `dismiss` |
| anything else | `ignore` |

Four decisions the ticket asked to be settled explicitly, each with its reason:

- **Focus starts on the current option; on the first option when there is none.** One expression covers all
  three cases the panel already distinguishes — `options.findIndex(o => o.id === currentId)`, with `-1`
  falling back to `0`. A value menu (#682, #683) opens on what it currently reads, which is where the
  arrows should be relative to; a command list (#680, #694 — `currentId: null`) opens on its first entry;
  a **stale** id that matches nothing lands on the first entry through the *same* branch, no special case
  and no throw, exactly as #838 handles a stale id in the markup (`ComposerOptionsPanel.tsx:30-32`).
- **Arrows wrap.** The ARIA menu pattern specifies wrapping; the panel is a short, fully-visible closed
  ring with no "off the end" affordance drawn; and wrapping puts the last option one keystroke from the
  top. `+ optionCount` before the `%` is load-bearing — `-1 % 3 === -1` in JavaScript, and the negative
  would address no row. §Testing pins that specific case.
- **`Enter` is intercepted; `Space` is not.** Enter must be intercepted anyway, because without a
  `preventDefault` the focused row's *native* button activation would fire `onSelect` a second time — so
  routing it through the function costs nothing and is what makes AC3 provable in vitest. Space needs no
  interception: it returns `ignore`, no `preventDefault` runs, and the native button activation picks the
  row through the `onClick` #838 already wired. Two paths to one outcome, each for its own reason.
- **`Home`, `End`, `ArrowLeft`, `ArrowRight` and `Tab` are not handled.** None is an acceptance criterion.
  Left/Right belong to a menubar, which does not exist here; Tab falls through to the browser and moves
  focus past the panel (see §Open questions). Adding Home/End later is two lines and two test cases.

**Totality.** The function throws for no input. `optionCount <= 0` yields `dismiss` for `Escape` and
`ignore` for everything else — #838's contract is that consumers gate on `options.length`, but the function
is total regardless. Every `focus` index it emits is in `[0, optionCount)`, including from an out-of-range
`focusedIndex`, because the modulo normalises. `pick` is range-guarded so the container's
`options[outcome.index]` can never be `undefined`. That guard is not speculative: #694's type-ahead filters
the option list *while the panel is open*, so a `focusedIndex` left over from a longer list is a shape a
named consumer will produce.

### The view: one new rendered attribute, one new ref

`ComposerOptionsPanelProps` gains:

- **`focusedIndex: number`** — required, per #838's "a view that cannot answer is a bug". Each row renders
  `tabIndex={index === focusedIndex ? 0 : -1}`: a **roving tabindex**. One row is in the tab order, the rest
  are reachable only programmatically, and the shipped `:focus-visible` outline paints on whichever holds
  real DOM focus. An out-of-range `focusedIndex` marks no row — the same no-special-case posture as a stale
  `currentId`, and unreachable from the container anyway.
- **`panelRef?: Ref<HTMLDivElement>`** — optional, on the `.composer-options` div, following
  `ThreadOverflowMenuView`'s `triggerRef` convention exactly (an ordinary prop, not `forwardRef`; omitted in
  tests). The container needs a handle to move focus. It is *not* the ref #839's clamp wants measured — that
  wiring is #680's — but it is the same handle, which is a bonus, not this ticket's business.

**`aria-activedescendant` is rejected.** It would need a unique `id` per row (four consumers can share one
screen, so ids would have to be generated) and it leaves DOM focus on the panel, which makes the
already-shipped `:focus-visible` outline dead. Roving tabindex moves real focus, which is what AC5's
"returns focus to the trigger" is written in terms of.

`aria-current` and `tabIndex` are **independent axes** and must stay so: the current value is what the menu
reads, the focused row is where the arrows are. They coincide only on the frame the panel opens.

### The container

```tsx
export function ComposerOptionsMenu(props: {
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null
  onSelect: (id: string) => void
  ariaLabel: string        // names the MENU surface — passed straight to the panel
  triggerContent: ReactNode // the consumer's label/chevron; supplies the trigger's accessible name
  triggerClassName: string  // the consumer's appearance hook
}): JSX.Element
```

Props are declared inline in the signature, as `ThreadOverflowMenu` and `ThreadOverflowMenuView` do; the
container is glue, and no consumer annotates them.

It renders exactly `.composer-options-anchor` > `<button>` + `{open && <ComposerOptionsPanel …/>}` — the
shape `composerOptionsPlacement.ts:20-24` already documents as the recipe.

**The trigger's behaviour is the container's; its label and appearance are the consumer's.** The container
owns the `<button type="button">`, `aria-haspopup="menu"`, `aria-expanded={open}` and the toggle `onClick`
— the parts that four tickets would otherwise each get wrong. It renders `triggerContent` inside and
`triggerClassName` on it, and it puts **no `aria-label` on the trigger**: `triggerContent` is visible text
("Max", "Opus 5"), so an `aria-label` would override it and break WCAG 2.5.3's label-in-name.

State — component-local `useState`, never the session store (ADR 0006; the `sheetOpen` precedent):

- `open: boolean`, initially `false`. It resets to closed on remount for free, as #276's does.
- `focusedIndex: number`, initially `0`, set to `initialFocusedOptionIndex(options, currentId)` on every
  closed→open transition.

Three handlers, one shared exit:

- **`close()`** — `setOpen(false)` then `triggerRef.current?.focus()`. Every exit path routes through it or
  through `select()`, which is `close()` plus `onSelect(id)`. That single path is AC5.
- **`onKeyDown` on the anchor `<div>`** — returns immediately unless `open`, otherwise calls
  `resolveComposerOptionsKey({ optionCount: options.length, focusedIndex, key: event.key })` and switches on
  the outcome: `focus` → `setFocusedIndex`, `pick` → `select(options[index].id)`, `dismiss` → `close()`,
  `ignore` → return without touching the event. **`event.preventDefault()` runs for every outcome except
  `ignore`** — it is what stops `ArrowUp`/`ArrowDown` scrolling the thread and what stops `Enter` firing the
  focused row's native click on top of the `pick`.
- **`useEffect` on `[open, focusedIndex]`** — while open, moves DOM focus to the focused row:
  `panelRef.current?.querySelectorAll<HTMLElement>('.composer-options__item')[focusedIndex]?.focus()`.
  Plain `useEffect`, not `useLayoutEffect`: focus is not a paint concern, `useLayoutEffect` warns under
  `renderToStaticMarkup`, and #276's container uses the plain one. `querySelectorAll` on the row class
  rather than `children[i]` so a future non-row child (#694's "no matches" line is a named one) cannot
  silently shift the index; the class is declared ten lines above in the same file.

**One keydown path, not two.** #276 dismisses on Escape through a *document* listener because it never
moves focus into its menu, so a React handler on the wrapper would never see the key. This container does
move focus in, so the anchor's own `onKeyDown` sees every keystroke — the trigger's and the rows' both — and
a document keydown listener would only double-handle Escape. The deviation from the precedent is what makes
the whole key contract live in one tested function.

**Outside click keeps the precedent verbatim**: a `document` `mousedown` listener attached only while open,
torn down by the effect cleanup, target narrowed with `instanceof Node` (never an `as` cast), calling
`close()` when the target is outside `wrapperRef`. Read the event through `DocumentEventMap['mousedown']`
rather than a bare annotation, for the same shadowing reason `ConversationScreen.tsx:2681-2683` records.
Note that `close()`'s `.focus()` runs *before* the browser's own mousedown focus action, so on this one path
focus ends where the user clicked rather than on the trigger — which is the correct outcome, and the reason
no `preventDefault` is added here. See §Open questions.

## State + concurrency model

No store, no async, no streams, no `window.pyry`. Two `useState` cells and two document listeners whose
lifetime is exactly the open panel — attached in an effect gated on `open`, removed by its cleanup on close
*and* on unmount, so no listener outlives an open menu. Nothing here is cancellable because nothing here is
asynchronous. The panel unmounts on close, so no stale focus target survives.

## Error handling

There are no failure modes in the ordinary sense — no I/O, no parsing, no permissions. What replaces them
is **totality**:

| Shape | Behaviour |
| --- | --- |
| `optionCount === 0` | `Escape` → `dismiss`; every other key → `ignore`. No throw. |
| `focusedIndex` out of range, arrow key | Normalised into range by the modulo. |
| `focusedIndex` out of range, `Enter` | `ignore` — `pick` is range-guarded, so `options[index]` is always addressable. |
| `focusedIndex` out of range, render | No row carries `tabIndex={0}`. No throw, no invented fallback row. |
| The focused row's DOM node is missing | Optional chaining on the `querySelectorAll` result; the effect is a no-op. |
| A `currentId` matching no option | Focus opens on the first row, through the same expression as `null`. |

Nothing is surfaced to the user: there is no error state to show, and inventing one would be a banner for a
failure that cannot occur.

## Testing strategy

Gates: `npm test`, `npm run typecheck`, `npm run build`.

**`composerOptionsKeyboard.test.ts` — the executable half.** Scenarios (inputs → expected outcome), not
pre-written bodies:

- `initialFocusedOptionIndex`: a `currentId` matching the **middle** option → its index (so order and
  matching stay independent properties, the #838 convention); `null` → `0`; an id matching nothing → `0`;
  an empty option list → `0`; matching is on `id` and never on `label` (reuse #838's `claude-opus-5` /
  `Opus 5` pair — a label passed as `currentId` must not match).
- `ArrowDown` from the first of three → `focus` 1; from the **last** → `focus` 0.
- `ArrowUp` from the middle → `focus` 1 below it; from the **first** → `focus` at the last. This case is the
  negative-modulo detector: an implementation missing `+ optionCount` returns `-1` here.
- With exactly one option, both arrows → `focus` 0 (a lone option is its own neighbour).
- `Enter` at index 1 → `pick` 1. `Enter` with `focusedIndex` past the end, and at `-1` → `ignore`.
- `Escape` → `dismiss`, from the first index, a middle one and the last.
- `' '`, `'Tab'`, `'Home'`, `'End'`, `'ArrowLeft'`, `'ArrowRight'`, `'a'`, `''` → `ignore`. Space is called
  out in a comment as deliberately native, not forgotten.
- `optionCount: 0`: `Escape` → `dismiss`; `ArrowDown`, `ArrowUp`, `Enter` → `ignore`.
- **A totality property**: for every `optionCount` in 1..5, every `focusedIndex` in `-1..optionCount`, and
  both arrow keys, the outcome is `focus` with an index in `[0, optionCount)`. This is the property that
  makes the container's indexing safe, and it is worth more than the individual arrow cases.

**`ComposerOptionsPanel.test.tsx` — the markup half.** `renderPanel` gains a `focusedIndex` parameter
defaulting to `0`; the seven existing tests are untouched, which is the proof the change is additive.

- `focusedIndex: 1` of three → exactly one `tabindex="0"`, on the row whose text is the middle label, and
  the other two carry `tabindex="-1"`. Count the attribute, do not merely `toContain` it.
- `focusedIndex: 0` → the first row is the focusable one.
- **The two axes are independent**: `currentId` on the middle option with `focusedIndex: 2` → `aria-current`
  on the middle row and `tabindex="0"` on the last. This is the assertion that stops a later ticket
  collapsing focus onto the current value.
- An out-of-range `focusedIndex` → no `tabindex="0"` anywhere, and no throw. Mirrors the stale-`currentId`
  test directly above it.
- **The container, collapsed**: server-render `ComposerOptionsMenu` and assert the trigger carries
  `aria-haspopup="menu"`, `aria-expanded="false"` and the consumer's class and content, and that no
  `role="menu"` is in the markup. That is AC1's ARIA half, and it is reachable because `useState(false)` is
  what a static render sees and effects do not run under it.

**What has no detector, stated plainly.** The container's open state is internal, so its *opened* markup is
unreachable from a static render — the panel's open markup is proven directly through
`ComposerOptionsPanel`'s own tests instead. The `useState` transitions, the document listeners, the
`preventDefault` calls and the focus moves are **untested reviewed glue**, exactly as
`ConversationScreen.test.tsx:2523-2528` rules for #276's container: the `node` environment fires no clicks
and runs no effects. Do **not** add jsdom, happy-dom or `@testing-library` to reach them — CLAUDE.md makes
that a separate, deliberate decision. The in-app interaction proof rides #680, the first consumer with a
real trigger in a real footer.

## Scope check

| Red line | This spec |
| --- | --- |
| > 3 new files | 2 (`composerOptionsKeyboard.ts`, `composerOptionsKeyboard.test.ts`) |
| > ~600 LOC total written | ~405 (≈120 module, ≈110 module test, ≈135 panel file, ≈40 panel test, 0 CSS) |
| > 5 new exported types / components / interfaces | 3 (`ComposerOptionsKeyInput`, `ComposerOptionsKeyOutcome`, `ComposerOptionsMenu`) — 5 counting both new functions |
| > 10 consumer call sites | 2 — `focusedIndex` is required, and its only callers are the new container and the test helper's defaulted parameter |
| > 5 acceptance criteria | 5 |
| ≥ 10 reject branches | 0 — four outcome shapes, no reject path and no logging |

Production source files (`.ts`/`.tsx`, tests excluded) created or modified: `composerOptionsKeyboard.ts`,
`ComposerOptionsPanel.tsx` — **2**, under the 5-file commit gate. Size confirmed `s`.

**File-overlap check** (2026-08-27): `git fetch origin --prune`, then a branch-diff sweep of all 18
`origin/feature/<n>` remote branches against `ComposerOptionsPanel.tsx`, `ComposerOptionsPanel.test.tsx`,
`conversation.css` and `ConversationScreen.tsx`. No overlap. No block set.

## Open questions

- **Focus after an outside click.** AC5 lists outside click among the paths that return focus to the
  trigger, and the container does call `.focus()` there — but the browser's own mousedown focus action runs
  afterwards and takes focus to whatever was clicked. That is the right behaviour (returning focus to a
  trigger the user just clicked away from would steal it), and it is why no `preventDefault` is added.
  If a review reads AC5 as literal, the correction is one `event.preventDefault()` confined to that
  handler. #276 has shipped the same shape since its own AC3.
- **Tab while open.** Tab falls through: focus leaves the panel and the panel stays open until the next
  Escape, outside click or trigger toggle. Closing on focus-out is the standard extra, but it is not an
  acceptance criterion, no consumer exists yet, and it would be one more piece of untestable glue. #680 is
  where a real user first meets it — decide there, on evidence.
- **#694 does not use the container.** Its trigger is the message box, not a button, so it will compose
  `ComposerOptionsPanel` + `composerOptionsKeyboard.ts` against the textarea itself. The pure module is the
  part it reuses; that is deliberate, and it is why the keyboard contract is a standalone module rather
  than private to the container.
- **An icon-only trigger** would need an accessible name that `triggerContent` cannot supply, and this repo
  has no visually-hidden utility. #680/#682/#683 all draw text-labelled buttons, so nothing needs it today;
  the fix when something does is one additive optional prop with zero cascade (the container has no other
  consumers).
- **A named `ComposerOptionsMenuProps`** may be worth exporting once a consumer wants to annotate. Inline
  props follow the `ThreadOverflowMenu` precedent and keep the new public surface at five symbols;
  promoting it later is additive.
