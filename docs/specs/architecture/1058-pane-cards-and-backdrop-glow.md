# 1058 — the two panes draw a card, the backdrop draws the glow

Ticket: https://github.com/pyrycode/pyrycode-desktop/issues/1058

## Files read

Codegraph is unavailable in this worktree (`CodeGraph not initialized` on every call, a standing gap
recorded in the agent's memory), so this reading list came from targeted grep + read rather than from
`codegraph_context`. It is a CSS-only ticket, where codegraph would have had little to say regardless:
there is no symbol graph over stylesheets.

- `src/renderer/src/pairedShell.css` → `.paired-shell`, `.paired-shell__sidebar`,
  `.paired-shell__pane` — the three rules this ticket edits, plus the file header carrying #670's
  deferral note that the change must retire.
- `src/renderer/src/PairedShell.tsx` → the `list`/`thread` arm — proves the empty pane is
  `.paired-shell__pane` with `null` inside, so a card on the wrapper covers the empty case with no
  markup change.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list` (the `overflow-y: auto` scroll
  column that must go transparent and gain `position: relative`), `.channel-list__section-header`,
  `.channel-list__host`, `.channel-list__workspace-label` (the three unpositioned descendants AC3
  protects), `.channel-list__row` (already `position: relative`), `.channel-list__actions` and
  `.channel-list__fab` (sticky at `z-index: 1`), `.save-as-channel-overlay` and
  `.rename-conversation-overlay` (both `position: fixed` on purpose — AC5's second half).
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation` (already
  `position: relative`, so the chat pane needs no stacking fix), `.composer__row::before` (the wash
  idiom this ticket copies), `.status-sheet-overlay__scrim` (the `--color-scrim` + `opacity`
  precedent), `.status-sheet-overlay` / `.permission-modal-overlay` (absolute against `.conversation`,
  so already inside the pane's box), `.conversation__overflow-menu` and `.composer-options` (the two
  absolutely-positioned popovers a clip on the pane wrapper could reach — see Open questions).
- `src/renderer/src/theme/tokens.css` → `--color-scrim`, `--radius-xs`, `--color-surface`,
  `--color-primary-container`, `--color-on-primary`, `--space-5`.
- `src/renderer/src/screens/channels/ChannelList.tsx` → the `.channel-list` root and
  `.channel-list__rename` — the sole mount site of that class, and the one-click opener for a fixed
  overlay.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `.conversation` root — likewise
  the sole mount site.
- `e2e/composer-message-box.spec.ts` → `tokenColor` (the throwaway-probe token resolver) and the
  `getComputedStyle(el, '::before')` read — both idioms this ticket's spec reuses verbatim.
- `e2e/fixtures/launchPairedApp.ts` → the fixture lands on `list` and then clicks
  `.channel-list__row-open`, so a launch ends on `thread`; `.conversation__back` returns to `list`,
  which is where the empty pane lives.
- `e2e/paired-shell-navigation.spec.ts` → #670's geometry assertions, the nearest existing home; this
  ticket adds a sibling spec instead (see Testing strategy).
- `docs/knowledge/features/` — no overview covers the shell's chrome; `channel-list.md` and the
  conversation overviews were read for prior lessons and carry none that bear on this change.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

Two dark cards on a glowing backdrop. `Channels and chats` (`103:2959`) and `Content` (`106:3321`) are
each `bg-[rgba(0,0,0,0.3)] rounded-[6px]`, laid out by `Container` (`103:2963`) at `p-[20px] gap-[20px]`
— a layout the shell already has. The window frame `Chat Screen` (`102:4`) paints a flat `#101418`
overlaid by one radial gradient, a blue haze centred left-of-middle and high, fading out before it
reaches the bottom corners.

**Every number below is re-derived from the node's own gradient transform, not read off the ticket.**
`102:4` carries its fill as an inline SVG on a `1280 x 1302` viewBox:

```
radialGradient cx=0 cy=0 r=10 gradientUnits=userSpaceOnUse
gradientTransform=matrix(100.76 -5.5583 5.1936 152.2 608.93 386.8)
stop rgba(19,74,116,1) @ 0    stop rgba(0,51,85,0) @ 0.7
```

The unit circle of radius 10 maps through that matrix, so:

| | derived | as a CSS percentage |
| --- | --- | --- |
| centre | `(608.93, 386.8)` | `47.6%` across, `29.7%` down |
| x radius | `hypot(100.76, -5.5583) x 10 = 1009.13px` | `78.8%` of 1280 |
| y radius | `hypot(5.1936, 152.2) x 10 = 1522.89px` | `117.0%` of 1302 |
| rotation | `atan2(-5.5583, 100.76) = -3.16 deg` | dropped — CSS cannot rotate a radial-gradient |

That lands on `radial-gradient(ellipse 78.8% 117% at 47.6% 29.7%, ...)`, which agrees with the ticket's
starting figures to within rounding. The 3.16 degrees of tilt is unreachable in CSS without a
pseudo-element and a transform, and on a haze whose near edge is already 1000px from its centre it is
below the perceptual floor; dropping it is the only divergence from the drawing and it is recorded in
the stylesheet.

**Both stops are tokens, exactly.** `rgb(19,74,116)` is `#134a74` is `--color-primary-container`;
`rgb(0,51,85)` is `#003355` is `--color-on-primary`. The base `linear-gradient(90deg, rgb(16,20,24),
rgb(16,20,24))` is a flat `#101418` — `--color-surface`, the colour the shell already paints.

## Context

The sidebar and the chat pane are invisible as panes: `.channel-list` and `.conversation` each paint
`--color-surface` on themselves, and `.paired-shell` paints the same colour behind them, so the window
reads as one flat sheet. This is #670's own deferral, and its file header names the successor it did not
have — the note says the card "lands with the sidebar-tree and composer tickets", which came and went
without it. Retiring that note is part of this change, not a courtesy: a deferral that outlives its
deferral is a false statement about the file.

No ADR is warranted. Nothing here is a new architectural form: the wash is the fifth consumer of the
`::before` + `opacity` idiom this file family already carries, and the gradient is one declaration.

## Design

Three stylesheets, no `.ts`/`.tsx` change anywhere.

### 1. The backdrop — `pairedShell.css`, `.paired-shell`

Today's `background: var(--color-surface)` shorthand splits into two longhands:

```css
background-color: var(--color-surface);
background-image: radial-gradient(ellipse 78.8% 117% at 47.6% 29.7%, <stop 0>, <stop 0.7>);
```

The split is what satisfies AC2's "the token surviving as a name rather than being folded into a
gradient stop": the base colour stays a `var()` on its own longhand instead of becoming an opaque first
stop. `background-image` is also the only way to paint this that does **not** make `.paired-shell` a
containing block for fixed descendants — `filter`, `backdrop-filter`, `will-change`, `contain` and
`clip-path` all would, and any of them would drop `.save-as-channel-overlay` and
`.rename-conversation-overlay` out of the window and into the shell's box.

The gradient's positioning area is `.paired-shell`'s padding box. The element has no border and
`box-sizing: border-box`, so padding box == border box == the whole window, and the percentages resolve
against the same 1280 x 1302 the Figma matrix was derived against.

Stop 0 is `var(--color-primary-container)`. Stop 0.7 is the CSS-wide keyword `transparent` rather than
`--color-on-primary` at zero alpha, because there is no way to write a token at an alpha in this repo:
`color-mix()` is declined file-family-wide and relative colour syntax appears nowhere. The two are
renderable-identically only if gradient interpolation is premultiplied — which CSS Images 3 mandates and
Chromium implements, meaning a zero-alpha stop's channels contribute nothing at any position along the
ramp. **This is measured, not assumed** (see Testing strategy); the result is recorded in the
stylesheet.

### 2. The cards — `pairedShell.css`, both wrappers

`.paired-shell__sidebar` and `.paired-shell__pane` are the card's box exactly: full height, at the
shell's existing 20px inset and 20px gap, and neither is a scroll container. Each gains:

- `position: relative` — the anchor for the wash. Neither wrapper is positioned today.
- `border-radius: var(--radius-xs)` — the drawing's 6px, a token.
- `overflow: hidden` — AC5's clip.

and a shared `::before` rule: `content: ''`, `position: absolute`, `inset: 0`,
`background: var(--color-scrim)`, `opacity: 0.3`. This is `.composer__row::before` and the five
`__scrim` rules, one more time; "opacity is a de-emphasis device, not a colour literal" is the house
rule it rests on, and the wash must stay a wash rather than a pre-mixed flat colour because it sits over
a gradient that varies across the window.

The `::before` carries **no** `border-radius` of its own, unlike `.composer__row::before`. Absolute
insets resolve against the wrapper's padding box and `overflow: hidden` clips at that same padding box
rounded by `border-radius`, so the two boxes coincide and the wrapper's clip rounds the wash already. A
restatement here would be inert.

### 3. The two deletions

`.channel-list` and `.conversation` each drop `background: var(--color-surface)` and stay transparent,
so the wrapper's wash is what shows. Both classes have exactly one mount site each (`ChannelList.tsx`
and `ConversationScreen.tsx`, both inside the shell's wrappers), so neither can render anywhere the card
is absent — checked, because a transparent screen outside the shell would be a regression this ticket
could not see.

### 4. The sidebar's stacking fix — `channels.css`, `.channel-list`

An absolutely positioned `::before` at `z-index: auto` paints in step 6 of the painting order
(positioned descendants), above every non-positioned descendant, which is steps 3 and 5. `.channel-list`
is unpositioned today, and so are `.channel-list__section-header`, `.channel-list__host` and the
workspace label — while `.channel-list__row` is already `position: relative` and the actions cluster and
FAB are sticky at `z-index: 1`. Left alone the headers and host rows would sit *under* a 30% black wash
and the chat rows would not: a worse defect than the one being fixed, and precisely AC3.

The fix is one declaration, `position: relative` on `.channel-list`. It lifts the whole subtree into
step 6, where tree order puts it after the wrapper's `::before` and therefore above it. It is the idiom
this file family already carries for exactly this reason — `.composer__input` above
`.composer__row::before`, and `.pairing-field__row`. The `isolation: isolate` + `z-index: -1`
alternative works too but introduces a form the repo does not have anywhere.

`.channel-list` gets no `z-index`, so it does not become a stacking context, so the sticky FAB and
actions cluster keep painting at the root's positive-z layer exactly as before. `position: relative` is
not one of the properties that makes an ancestor a containing block for fixed descendants, so the two
overlays still escape.

`.conversation` is already `position: relative` (it is the containing block for the run-config sheet),
so the chat pane needs nothing.

## State + concurrency model

None. No store slice, no async work, no subscription, no lifecycle. The change is three stylesheets;
`PairedShell.tsx`, `ChannelList.tsx` and `ConversationScreen.tsx` are untouched.

## Error handling

None to add. Nothing here can fail at runtime: CSS that does not parse is dropped by the engine, and the
e2e assertions below are what catch that.

## Testing strategy

Renderer tests are `renderToStaticMarkup` with no CSSOM, so every claim this ticket makes — computed
colour, computed radius, painting order, clipping — is unreachable from vitest. All of it is e2e.

**New spec: `e2e/paired-shell-card.spec.ts`**, a sibling to `paired-shell-navigation.spec.ts` rather
than an extension of it: that spec's one `test()` block is a single continuous navigation drive whose
comment explains why it is one block, and threading four unrelated paint assertions plus an overlay
round-trip through it would fight that structure. One launch, one drive, three `test()` blocks sharing
the fixture's handshake cost is the shape here.

Scenarios:

1. **The cards and the backdrop (AC1, AC2).** On the `thread` route the fixture lands on: for each
   wrapper, `getComputedStyle(el, '::before')` gives `backgroundColor` equal to the probe-resolved
   `--color-scrim` and `opacity` exactly `0.3`; the wrapper's own `backgroundColor` is
   `rgba(0, 0, 0, 0)` (so the wash never migrates onto the element as a pre-mixed literal — the
   `.composer__row` precedent for this exact guard); all four corner radii are `6px`. `.channel-list`
   and `.conversation` both report a transparent `backgroundColor`, which is the two deletions. The
   shell reports `backgroundColor` equal to the resolved `--color-surface` and a `backgroundImage`
   containing both `radial-gradient` and the resolved `--color-primary-container`.
2. **Nothing is dimmed, and nothing moved (AC3, AC4).** `document.elementFromPoint` at the centre of
   `.channel-list__section-header`, of `.channel-list__host` and of a chat row must return that node or
   a descendant of it — never `.paired-shell__sidebar`. This is a real detector, not a restatement: a
   pseudo-element hit-tests as its originating element, so before the stacking fix the header's own
   centre returns the wrapper `<div>`. AC4 is the geometry half: the sidebar box starts 20px from the
   window's left and top edges, the gap between the two wrappers is 20px, and the section header's own
   box is byte-identical to its pre-change position — asserted as absolute numbers read from the
   built app before the change, so a padding or rhythm change reddens it.
3. **The corner clips and the overlays still escape (AC5, AC1's empty pane).** `.conversation__back`
   returns to `list`, where the pane is empty: the empty `.paired-shell__pane` still reports the wash
   and the 6px corner, which is the "empty card, not empty rectangle" half of AC1. Then
   `.channel-list__rename` opens `.rename-conversation-overlay` — `position: fixed`, deliberately
   escaping the sidebar — and `elementFromPoint` at a point over the *chat pane*, far outside the
   sidebar's 400px column, must land inside that overlay. `boundingBox()` is deliberately **not** used
   here: a clipped element still reports its full layout box, so it cannot detect a clip; hit-testing
   can, because `overflow: hidden` removes the clipped-away region from it.

**Detector proof.** Each of the three assertions above is confirmed to redden by reverting the
declaration it guards in the built app before the change is committed — the stacking fix for scenario 2
and `overflow: hidden` for scenario 3 — rather than being assumed to fire.

**The premultiplication measurement.** Before the gradient is written, both stop forms are rendered side
by side in the built app and compared pixel-for-pixel, settling whether `transparent` is renderable-
identical to `#003355` at zero alpha. The answer goes in the stylesheet comment as a measurement, in the
voice the rest of the file family uses for exactly this kind of claim.

**No gate typechecks `e2e/`.** No tsconfig includes the directory and Playwright strips types with
esbuild, so a green `npm run build` says nothing about the new spec. It is typechecked by hand with an
ad-hoc `tsc --noEmit`, read by filename (the noise chain and `realDaemon.ts` report pre-existing config
artefacts that are not real).

**Visual check.** The built app is compared against the Figma screenshot of `102:4` before the PR opens.

## Open questions

1. **Does `overflow: hidden` on `.paired-shell__pane` clip a popover that today escapes the pane?**
   Two absolutely-positioned candidates: `.conversation__overflow-menu` opens *downward* from a header
   at the pane's top, and `.composer-options` opens *upward* from the footer at a negative left offset
   plus a clamp shift. Both are anchored inside the pane and both look bounded by it, but "looks
   bounded" is not a measurement. Resolved by running the existing `composer-options-clamp.spec.ts` and
   `composer-effort-menu.spec.ts` against the built change; the answer is recorded in Revisions if it
   forces the clip onto a narrower element than the wrapper.
2. **Is `transparent` renderable-identical to the drawing's zero-alpha `#003355`?** Resolved by the
   measurement described above.

## Size

Within `size:s` on every boundary, re-counted against this written plan:

| Limit | Boundary | This ticket |
| --- | --- | --- |
| Production source files created or modified | <= 5 | 3 stylesheets (zero `.ts`/`.tsx`) |
| Total written work | <= 800 | ~700 (plan ~300, spec ~320, CSS ~80) |
| New exported types / components / stores | <= 5 | 0 |
| Consumer call sites needing simultaneous update | <= 10 | 0 |
| Acceptance criteria | <= 5 | 5 |
| Distinct error/reject branches | <= 10 | 0 |

The edit fan-out check does not apply: no symbol changes name or signature, and the two class names that
gain a declaration each have exactly one mount site.
