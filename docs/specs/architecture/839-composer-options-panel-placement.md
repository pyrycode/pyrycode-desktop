# 839 — The footer options panel opens upward with its labels flush

Ticket: [#839](https://github.com/pyrycode/pyrycode-desktop/issues/839) · size `s` · split from #692.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The node draws the panel **alone** — an 81×144 flush dark-navy column of five 28px rows with `Max`
highlighted — floating on the canvas with no host, so **the design does not draw the placement**. The two
numbers that do the placing come from elsewhere and are the whole of this ticket's visual input: the footer
button instance `115:3688` is 36×16 with its `Max` text node at **x=0** (the chevron follows at x=28), and
`.composer-options__item`'s label sits **12px** in from the panel's left edge (`conversation.css:3163`,
shipped by #838). Label-flush therefore means the panel's left edge sits 12px *left* of the button's — the
operator's 2026-08-22 instruction, not a measurement anyone can take off the drawing.

## Files to read first

Codegraph is **not indexed for this repo** — `codegraph_status` errors with `CodeGraph not initialized for
this project` (re-probed 2026-08-27, same as #838 found). This list is hand-built. Read these before
writing anything.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/screens/conversation/conversation.css:3100-3193` | The whole shipped `.composer-options` block (#838). The first rule is what this ticket appends to. Note what is deliberately **absent**: no `position`, no `top`/`right`/`bottom`/`left`, no `z-index` — "#839's whole ticket". Also `width: max-content` and `border-radius: --radius-xs`, both of which survive unchanged. |
| `src/renderer/src/screens/conversation/conversation.css:3140-3175` | `.composer-options__item` — `padding: 0 var(--space-3)`. **That 12px is the number this ticket negates.** The alignment rule is defined as the negation of this inset, not as an independent constant. |
| `src/renderer/src/screens/conversation/conversation.css:2350-2414` | `.conversation__overflow` / `.conversation__overflow-menu` (#276) — the repo's **one** anchored overlay, and the idiom this ticket mirrors vertically: an absolutely-positioned panel against a `position: relative` wrapper, `top: 100%`, no JS, and the **no-`z-index`** paragraph whose reasoning applies here unchanged. |
| `src/renderer/src/screens/conversation/conversation.css:1435-1443` | `.composer__footer` (#811) — `height: 20px`, `align-items: center`, `padding: 0 var(--space-4)`, `gap: var(--space-5)`. The host row; the 16px is one term of the 468px derivation below. |
| `src/renderer/src/screens/conversation/conversation.css:1376-1385` | `.composer` — `padding: var(--space-2) var(--space-3) var(--space-3)`. The 12px is the other term of the 468px derivation. Confirm for yourself that neither this rule nor `.composer__footer` declares `overflow`: an upward-escaping panel is clipped by neither. |
| `src/renderer/src/screens/conversation/conversation.css:9-19` | `.conversation`'s `position: relative` (#177). This is **why a wrapper is required**: with no nearer positioned ancestor the panel would resolve `left` against the whole chat pane instead of against its button. |
| `src/renderer/src/screens/conversation/threadScrollPosition.ts:1-64` | **The module shape to copy, closely.** Framework-free total function over a named plain-number struct; the "ships dormant BY DESIGN — do not add a caller to prove it works" paragraph; and the "ONE comparison, deliberately — every case is a consequence of that quantity's value rather than a branch of its own" discipline. |
| `src/renderer/src/screens/conversation/threadScrollPosition.test.ts:1-30` | The matching test shape: the header comment explaining *why* the arithmetic is isolated, the constant-pinning `describe` with fenced bounds, and fractional inputs as the motivating case. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2216-2231` | The `.composer__footer` JSX and its comment naming who prepends siblings (#680/#682/#683) and that #685 right-aligns with `margin-left: auto`. The future anchors go here. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:291-355` | The `.conversation` child order — `<Composer>` at 303, then `<StatusSheet>` 306, the Channel Info sheet 317, `<PermissionModal />` 354. **All three overlays are later siblings**, which is what keeps a positioned panel inside the composer painting below them with no `z-index`. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:39-51` | The four required props. This ticket adds none and forwards no ref — read this to see why the shift has to arrive by inheritance rather than as an inline style on the panel. |
| `src/renderer/src/pairedShell.css:17-45` | 20px shell padding, 20px gap, `flex: 0 0 400px` sidebar that never shrinks. Every number in the reachability argument below. |
| `src/renderer/src/theme/tokens.css:158-162` | `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1128-1132` | **The AC-without-a-detector ruling** — stylesheet declarations get no vitest proof. AC1 and AC2 are that ruling restated; do not invent a measurement path for them. |
| `docs/specs/architecture/838-composer-options-panel.md` | What the surface already settled, and two standing prohibitions this ticket inherits: **do not read `conversation.css` as text from a test**, and do not add a DOM environment. |
| `docs/knowledge/features/conversation-shell.md` | The only overview covering `.composer__footer`; read the footer section for what #811 settled. |

## Context

#838 shipped the shared panel's surface carrying no `position` at all, on purpose. This ticket puts it
where it belongs: above its button, labels in line, never off the window. #840 then opens it.

Five consumers are queued behind this — #680 Actions, #682 permission mode, #683 model and effort, #685's
attach control, and #694's slash-command type-ahead — and **none of them exists yet**. That shapes the
whole design: whatever is shipped here has to be the thing those tickets *use* rather than the thing they
each re-derive, and it has to be provable with no host to render it into. `.composer__footer` carries the
context reading alone today.

## Design

The work splits cleanly along the line the ticket already drew, and the split is the design decision:

| Criterion | Mechanism | Provable here? |
| --- | --- | --- |
| AC1 — opens upward | Pure CSS, absolute against a positioned wrapper | No detector (stylesheet ruling) |
| AC2 — 12px-left alignment | Pure CSS, same rule | No detector (stylesheet ruling) |
| AC3 — right-edge clamp | A total function over three plain numbers | **Yes — unit-tested** |

Nothing measured for AC1/AC2, and the one thing that genuinely needs arithmetic gets a test. That is the
ticket's "keep the measuring at the edge and the arithmetic out of it" applied literally.

### The anchor — a new block, not a modifier

Two rules appended to `conversation.css`, in the `.composer-options` neighbourhood (after the existing
block, so the placement reads next to the surface it places).

```css
.composer-options-anchor { position: relative; display: flex; }

/* appended to the existing .composer-options rule */
position: absolute;
bottom: 100%;
left: calc(-1 * var(--space-3) - var(--composer-options-shift, 0px));
```

Each declaration is load-bearing and the comment must say so:

- **`.composer-options-anchor` is its own block, not `.composer-options__anchor`.** It is not a part of the
  panel — it wraps a *trigger*, which the panel knows nothing about, and #694 will put it on the message
  box. A sibling block name is the honest BEM reading and the one that survives that consumer.
- **`position: relative` on the wrapper** is what makes `left`/`bottom` resolve against the button rather
  than against `.conversation` (which is the next positioned ancestor, `conversation.css:18`).
- **`display: flex` on the wrapper** so the wrapper's box is *exactly* the trigger's box. A block wrapper
  around an inline-block `<button>` establishes an inline formatting context, and the line box's strut
  leading makes the wrapper taller than the button — which both breaks AC1's "the button's top edge" as
  written and overflows `.composer__footer`'s hard `height: 20px`. Flex has no strut. **The wrapper must
  carry no padding and no border**, for the same reason: `left` and `bottom` resolve against its *padding
  box*, so any inset there silently detunes both criteria.
- **`bottom: 100%`** puts the panel's bottom edge on the wrapper's top edge — AC1, with **no gap**. The
  design draws none and AC1 asks for none; do not invent one. This is `.conversation__overflow-menu`'s
  `top: 100%` mirrored (`conversation.css:2403-2406`).
- **`left` is written as the negation of `--space-3`, never as `-12px`.** The alignment number *is*
  `.composer-options__item`'s left padding — the two are the same quantity seen from two sides, and if the
  row inset ever moves, the panel must follow it or the labels drift. Writing the token makes that
  automatic; writing the literal makes it a silent break. (`conversation.css:1329` is this stylesheet's own
  precedent for calling out a coupled number.)
- **No `z-index`, and none is needed.** #276's paragraph at `conversation.css:2350-2362` applies unchanged:
  a positioned element already paints above the non-positioned thread, and the three overlays that must
  stay on top — the Run configuration sheet, the Channel Info sheet, the permission modal — are all later
  siblings of `<Composer>` in `.conversation` (`ConversationScreen.tsx:303/306/317/354`), so DOM order
  keeps them there. A `z-index` here would lift the panel above a modal; that is the regression, not the
  fix.
- **`width: max-content` survives.** An absolutely-positioned box with `left` set and `right: auto` is
  shrink-to-fit anyway, and `max-content` keeps the width the longest label rather than anything the host
  imposes. Do not touch it.

### The markup contract for the five consumers

The panel keeps its four props and gains no `ref`. The shift reaches it by **custom-property inheritance**,
which is what lets placement be applied without widening #838's surface at all:

```tsx
<div className="composer-options-anchor" ref={anchorRef}
     style={{ '--composer-options-shift': `${shiftPx}px` } as CSSProperties}>
  <button type="button" /* #680/#682/#683's own trigger */ >Max</button>
  {open && <ComposerOptionsPanel … />}
</div>
```

The trigger and the panel are **siblings inside the anchor**. The panel is out of flow, so it is not a flex
item and it cannot push the 20px footer row around. `--composer-options-shift` is set on the wrapper, not
the panel, because the consumer already owns the wrapper element and inheritance carries it down — no ref
forwarding, no style prop, no change to `ComposerOptionsPanel.tsx`. The value **must carry a unit**: a
bare number makes the whole `left` declaration invalid at computed-value time, dropping the panel to
`left: auto` and its static position.

### The clamp — `composerOptionsPlacement.ts`

New file `src/renderer/src/screens/conversation/composerOptionsPlacement.ts`, alongside
`threadScrollPosition.ts` and built to the same posture: React-free, DOM-free, a total function over a named
plain-number struct.

```ts
export interface ComposerOptionsPlacementMetrics {
  anchorLeft: number    // the anchor wrapper's left edge, window coordinates
  panelWidth: number    // the panel's own rendered width
  windowWidth: number   // the clamp boundary — the window's right edge
}

export const COMPOSER_OPTIONS_LABEL_INSET_PX = 12

export function composerOptionsShiftPx(metrics: ComposerOptionsPlacementMetrics): number
```

**Behaviour**, one expression and one `Math.max`: the resting left edge is `anchorLeft` minus the label
inset; the overflow is that plus `panelWidth` minus `windowWidth`; the shift is that overflow floored at
zero. Asserted by the scenarios below.

Design notes the implementation must honour:

- **Three named fields, not three positional numbers** — `threadScrollPosition.ts:16-20`'s reasoning
  verbatim: same-typed positionals transpose silently, and `panelWidth` ↔ `windowWidth` transposed produces
  a wrong answer with no type error. The call site is untested reviewed glue, so the argument names have to
  make it correct by inspection.
- **`anchorLeft`, not `panelLeft`.** Reconstructing the resting left from the anchor costs one duplicated
  constant, but every input stays **idempotent under the shift** — the anchor does not move when the panel
  shifts, and the width does not change. Taking the panel's measured left instead would remove the constant
  and replace it with a reset-measure-apply dance at the one place in this feature that has no test. Put
  the robustness where the proof is absent.
- **`COMPOSER_OPTIONS_LABEL_INSET_PX` mirrors `--space-3`, and both sides must say so.** This is the one
  cross-file coupling in the ticket. There is no detector for it — #838 forbids reading `conversation.css`
  as text from a test — so it is carried by paired comments plus the pinning test below, exactly as
  `AT_BOTTOM_TOLERANCE_PX` is.
- **No left clamp. No `Math.min`, no second branch.** The sidebar is `flex: 0 0 400px` and never shrinks
  (`pairedShell.css:41-45`), so the leftmost footer button's left edge is `20 + 400 + 20 + 12 + 16 = 468`
  at *every* window width and the panel's leftmost resting edge is 456 — the left edge is unreachable by
  construction. A guard for it would be an untestable branch defending an unobservable failure.
- **No rounding.** `getBoundingClientRect()` returns fractions and CSS lengths accept them; rounding here
  would be a silent half-pixel drift with nothing asking for it.

### The boundary is the window's right edge — the geometry call

The ticket asks for this to be a decision rather than an accident. **`windowWidth` is the window's own
right edge, and the resulting 20px overhang across `.paired-shell`'s padding gutter is permitted.**

At the 800px minimum the chat pane's right edge is 780 (`800 − 20` shell padding) while the window's is
800, so a clamped panel may sit over that 20px gutter. Three reasons that is right:

1. **AC3 names the window**, twice, and the panel is an overlay — overhanging its own pane's padding is
   what overlays do.
2. **Nothing is occluded.** The gutter is `.paired-shell`'s own `--color-surface` backdrop with no content
   in it, and the sidebar is on the *other* side.
3. **It costs one cheap read.** `window.innerWidth` is a plain property; clamping to the pane instead would
   mean measuring `.conversation`'s rect, or hard-coding the shell's 20px padding into the conversation
   screen — more work at the untested edge, and a new coupling, to buy a cosmetic 20px.

Recorded as a decision in the module comment, with the pane-edge alternative named so a later visual review
can flip it in one place.

**Reachability**, so the developer knows the case is real and where: at 800px the footer's content box spans
x=468–752. With the drawn 81px panel the clamp engages once a button's left edge passes `800 − 81 + 12 =
731`, which the trailing controls (#683's model/effort, #685's attach) sit in; with #683's much wider model
menu it engages far earlier. Both are inside the 468–752 span, so this is an ordinary case rather than a
pathological one.

### How a consumer wires it — and why not here

The recipe, which belongs in the module's own doc comment so the first consumer reads it from the code:
on open, in a `useLayoutEffect` (before paint, so there is no visible unclamped frame), read
`anchorRef.current.getBoundingClientRect().left`, the panel's `offsetWidth`, and `window.innerWidth`; pass
them to `composerOptionsShiftPx`; write the result onto the anchor's `--composer-options-shift`. Re-run on
`resize`. The panel mounts at the resting position and the effect corrects it — the shift is 0 in the
common case, so the correction is usually a no-op.

**This ticket ships no caller**, exactly as `threadScrollPosition.ts` shipped dormant for #601. There is no
footer button to hang one on, and the hook's shape depends on facts the consumers own (whether #683's
trigger is one control or two, whether #694 anchors on the message box or the textarea). The two questions
the first consumer will hit, answered here so it does not have to decide alone:

- **Measuring `panelWidth` needs a handle on the panel element.** `ComposerOptionsPanel` forwards no ref.
  The first consumer should add ref forwarding — three lines, and the React-idiomatic answer — rather than
  reaching through the anchor with `querySelector`. Not done here: no consumer exists to shape the
  signature, and a static render cannot exercise a ref, so it would ship both speculative and unproven.
- **#694 anchors on the message box, where the −12px rule is probably wrong** (a type-ahead aligns to the
  text, not to a button label). It gets the wrapper and the clamp for free and overrides `left` in its own
  rule; nothing here forecloses that.

### Rejected alternatives

- **CSS anchor positioning** (`anchor-name` / `position-try-fallbacks`) would make the clamp free of JS,
  but `anchor-name` is not per-instance without a distinct name on every trigger — pushing work onto the
  three consumers this ticket exists to spare — and the behaviour is a layout effect that neither
  `renderToStaticMarkup` nor any e2e host (there is none) can prove. AC3 would ship with zero detector.
- **`transform: translateX(calc(-1 * max(0px, 100% - var(--room))))`** does compute the clamp in pure CSS,
  since `translate` percentages resolve against the element's *own* width — one measured number, no panel
  ref, no ref forwarding for anyone. Rejected because it moves the arithmetic into the half of the codebase
  that has no tests, which is the exact inversion of the ticket's instruction; and because a `100%` meaning
  "my own width" inside a `max()` is a real comprehension cost on a rule five tickets will read. Kept in
  Open questions — it is the fallback if the panel-measurement glue proves annoying in #680.
- **The Popover API** (`popovertarget`, top layer, implicit anchor, light dismiss) would carry placement
  *and* opening, but opening is #840's ticket and #838 deliberately built the panel with no trigger and no
  `open` prop. Adopting it here would pre-decide #840 from a ticket that cannot test it.

## State + concurrency model

None in this ticket. `composerOptionsPlacement.ts` performs no effects, holds no state, takes no injected
dependencies, and touches no store — a total function of three numbers, like `isAtBottom`. The CSS is
declarative. The `useLayoutEffect` and the `resize` listener described above belong to the first consumer.

## Error handling

No failure modes reach this layer — no I/O, no parse, no bridge call, no daemon input. Three degenerate
inputs, all answered by the single expression rather than by a guard:

| Input | Behaviour |
| --- | --- |
| A panel that fits with room to spare | Negative overflow → shift `0`; the resting rule stands. |
| `panelWidth: 0` (zero options) | Cannot overflow from a reachable anchor → `0`. No throw. |
| Fractional metrics | Passed through exactly; the shift is fractional too. |

A consumer that writes a unitless `--composer-options-shift` drops `left` to `auto` and the panel falls to
its static position. That is a CSS invalid-at-computed-value-time rule, not something this module can
defend against; the doc comment states the unit requirement.

## Testing strategy

New file `composerOptionsPlacement.test.ts`. `npm test`, `npm run typecheck`, `npm run build`. No render,
no markup, no DOM — the module imports neither React nor the DOM, so the `node` environment covers it
completely.

**AC1 and AC2 have no detector**, per the ruling at `ConversationScreen.test.tsx:1128-1132`: they are
stylesheet declarations and server render has no layout engine. Do not read `conversation.css` as text from
a test (#838's standing prohibition), and do not add a DOM environment — that is a separate deliberate
decision (CLAUDE.md), never a side effect of this ticket. No e2e proof exists either: there is no footer
button to open the panel from until #680.

Scenarios, as behaviour rather than as the formula:

- **The constant is pinned.** `COMPOSER_OPTIONS_LABEL_INSET_PX` is 12, with the comment naming
  `.composer-options__item`'s `padding: 0 var(--space-3)` as the other half of the pair and instructing that
  a change to either must move both. The `AT_BOTTOM_TOLERANCE_PX` `describe` is the shape.
- **A panel with room to spare does not move.** Anchor near the left of the footer, narrow panel → `0`.
- **A panel whose resting right edge lands exactly on the window edge does not move.** `0`, not a
  one-pixel nudge — the boundary case that decides `>` versus `>=` in the overflow comparison.
- **An overflowing panel shifts by exactly its overflow.** Assert both the returned shift *and* the derived
  left edge, so the test states the invariant (the shifted right edge sits on the window's right edge)
  rather than restating the arithmetic. Use the ticket's own case: an 800px window, a trailing button, a
  panel wide enough to run past 800.
- **The 20px gutter overhang is deliberate.** A case whose shifted right edge is 800 — past the chat pane's
  780 — asserting the function does not clamp to the pane. This is the geometry decision's detector.
- **The leftmost reachable anchor never triggers a shift.** `anchorLeft: 468` with the drawn 81px panel at
  an 800px window → `0`. Documents that the left edge is out of reach and that no left clamp exists.
- **Fractional metrics pass through unrounded.** A fractional overflow returns fractional; nothing is
  rounded or floored to an integer.

## Scope check

| Red line | This spec |
| --- | --- |
| > 3 new files | 2 (`composerOptionsPlacement.ts`, `composerOptionsPlacement.test.ts`) |
| > ~600 LOC total written | ~165 (≈20 code + ≈45 comment, ~70 test, ~30 CSS with comments) |
| > 5 new exported types / components | 3 (one interface, one constant, one function) |
| > 10 consumer call sites | 0 — nothing consumes it until #680 |
| > 5 acceptance criteria | 3 |
| ≥ 10 reject branches | 0 — one `Math.max`, no guards |

Production source files touched (`*.ts`/`*.tsx`, excluding tests): `composerOptionsPlacement.ts` — 1, under
the 5-file commit gate. `conversation.css` is modified but is not a counted extension. `ComposerOptionsPanel.tsx`
is **not** touched. Size confirmed `s`.

**File-overlap check** (2026-08-27, `git fetch origin --prune` then a branch-diff sweep of all 18
`origin/feature/<n>` remote branches against `origin/main`): no in-flight branch touches `conversation.css`,
`ConversationScreen.tsx`, `ConversationScreen.test.tsx` or either `ComposerOptionsPanel` file. No block set.

## Open questions

- **The pane-edge boundary.** The window edge is this spec's call, argued above. If a visual review reads
  the 20px gutter overhang as wrong, the correction is confined to what the consumer passes as
  `windowWidth`; the function, the CSS and the tests are unchanged apart from one scenario's numbers.
- **The `translateX` clamp.** The pure-CSS alternative in § Rejected alternatives removes the panel
  measurement entirely and with it the ref-forwarding change #680 would otherwise make. If that glue turns
  out to be the awkward part of #680, this is the revisit — and it can replace the `left` declaration
  without touching the markup or the anchor.
- **Registering `--composer-options-shift` with `@property`** would turn a unitless value from a broken
  `left` into a graceful 0px fallback. Deferred: no `@property` rule exists anywhere in this repo, and the
  failure has not been observed. The unit requirement is carried by the doc comment instead.
- **`.composer-options-anchor` and `flex: 0 0 auto`.** The wrapper inherits `.composer__footer`'s default
  `flex: 0 1 auto` and could shrink if the row ever overflows. Left alone deliberately: the footer's
  overflow behaviour with five controls in it is #680/#682/#683's question, not the anchor's, and this
  ticket adds no control to the row.
