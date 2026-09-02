# #951 — redraw the message box as the design's `Input large`

A **chrome-and-glyph restyle** of the shipped composer. No behaviour changes: sending, Enter handling,
the send→stop switch (#678), the not-connected gate (#31), queueing while a turn runs, and the covered
state under the question panel (#906) are all untouched. Two production files.

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.composer`, `.composer__row`,
  `.composer__input`, `.composer__send` and its three state rules — the block this ticket redraws.
- the same file → `.composer__row .composer-options` and `.composer__row .composer-options__item` —
  #940's type-ahead rules, scoped to the row this redraw changes. They tell me what the row may not grow
  (§ The #940 constraint).
- the same file → `.question-panel__other-field` and `.question-panel__other-field::before` — **the
  decisive precedent.** The same colour at the same percentage (`--color-on-primary` at 41%), for the
  same design idiom one region away (`Input small` vs this ticket's `Input large`), drawn the house way.
- the same file → `.status-sheet-overlay__scrim` — where the house rule *"opacity is not a color
  literal"* is actually written. (`pairing.css`'s copy of it cites a line range that now points at
  `.tool-row__group`'s flex reasoning; the rule moved and the citation did not.)
- `src/renderer/src/screens/pairing/pairing.css` → `.pairing-field::before` and `.pairing-field__row` —
  the third instance of the same form, and the one that shows how the content stays *above* the ground.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerSendButton`, `SEND_LABEL`,
  `INTERRUPT_LABEL`, `Composer` — the markup, the two pinned accessible names, and the #678 follow-up
  note that names this ticket's work as pending.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the
  `ComposerSendButton — the composer send/stop control (#678)` describe — six tests, **one of which this
  ticket breaks by construction** (below).
- `src/renderer/src/screens/conversation/composerSlot.test.tsx` → the covered-composer block that pins
  `class="composer__input"` and `class="composer__send"` as literal substrings.
- `src/renderer/src/screens/conversation/composerOptionsPlacement.ts` →
  `COMPOSER_OPTIONS_LABEL_INSET_PX` (12) — the constant behind the recorded 4px consequence.
- `e2e/composer-options-clamp.spec.ts` → its `wholePixels` helper and its anchor-rect measurements — the
  pattern for a composer-level geometry spec, and the shipped spec whose anchor this redraw must not move.
- `src/renderer/src/theme/tokens.css` → `--radius-xs` (6px), `--color-on-primary` (#003355),
  `--color-primary` (#9dcbfc), the body-medium set (14/20/0.25/400), `--space-1..4`.
- `docs/knowledge/features/composer-send.md` → the send flow's contract, and the standing note that the
  textarea's auto-grow is unbuilt — which is why the box's 52px can be *derived* rather than declared.
- `docs/knowledge/features/conversation-shell-composer.md` § Composer footer row (#811) — the sibling
  row's own numbers, and the file's habit of treating a component's own height as structural geometry.

Codegraph is wired but not indexed for this repo (`codegraph_status` → *CodeGraph not initialized*),
confirmed again this run; every symbol lookup above is grep/Read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6635

`Input large` is one 52px-tall rounded box on a dark translucent ground, holding a single line of
body-medium text inset 16px from the left, with a bare blue up-chevron in a 48px hit box tucked against
the box's right end. There is no visible container behind the chevron at rest and no drawn focus, hover
or disabled state — the node's `Active indicator` is hidden and the M3 icon button's own description says
its container appears only on interaction.

The node's own numbers, read off `get_design_context` this run and matching the ticket's re-measure:
box `py-[12px] rounded-[6px] bg-[rgba(0,51,85,0.41)]`; `Text field` `pl-[16px] pr-[56px] py-[4px]`;
`Button` `absolute right-[4px] size-[48px] top-[-10px]` relative to the text field, i.e. 2px below the
box's top edge and 2px above its bottom edge; glyph `circle-chevron-up-solid-full` at 28×28 filled
`#9DCBFC`, which is `--color-primary` by value.

## Context

The composer's message box is the last part of the input area still drawn as the mobile layout stretched
to a window. The status row above it (#796, #797) and the footer row below it (#811, #680) already match
`Input area` (347:5408); the box and the send control do not. #678 shipped the send→stop switch and
explicitly deferred the glyph and the colour to "one coherent follow-up" — this is that follow-up, folded
into the box redraw because in the drawing the button lives *inside* the box.

No ADR is warranted: this changes no contract and introduces no module. The one decision worth a
documentation-phase fold is the fill's form (§ The 41% ground), which is a restatement of an existing
house rule rather than a new one.

## Design

### The row becomes the box

`.composer__row` keeps its class — three shipped specs and the type-ahead's anchor depend on it — and
takes on the box's identity: the ground, the 6px corner, and the 12px vertical padding. The textarea
becomes transparent and carries only the text's own inset.

- **Horizontal padding stays on the textarea, not on the row.** The drawing splits it the other way
  around from what the ticket's #940 note anticipates (`py-[12px]` on the box, `pl-[16px]` on the field),
  and that split is also the only one that works: `.composer__send` is absolutely positioned and an
  absolutely positioned box resolves `right` against its containing block's **padding box**. With 12px of
  row padding, `right: var(--space-1)` would land the control 16px from the box's outer edge and the
  drawing's 4px would have to be written as `right: -8px`. With the row's horizontal padding at 0 the
  padding box edge *is* the border box edge and `right: var(--space-1)` is literally the drawing's number.
  The visible result is identical either way — text starts 16px in — which is what keeps § The #940
  constraint's arithmetic true (below).
- **The 52px is derived, not declared.** 12 (row) + 4 + 20 (one body-medium line at `rows={1}`) + 4
  (field) + 12 (row) = 52. A declared height would be a second source of truth that fights the auto-grow
  the composer overview still lists as unbuilt; the sibling rows declare their heights because they hold
  *no* intrinsic content, which is the opposite case.
- **`gap: var(--space-2)` is deleted, not left inert.** Once the control is out of flow the row has one
  flex item and the declaration can never apply. The type-ahead panel is `position: absolute`, so it is
  not a flex item either.
- **`align-items: flex-end` stays.** It is what keeps the textarea at its content height instead of
  stretching to the row.

### The control moves inside the box

`.composer__send` keeps its class, its 48px box, its full radius, its flex centring and all three state
rules. It gains `position: absolute; right: var(--space-1); top: 50%; transform: translateY(-50%)` and
loses `flex: 0 0 auto` (inert once out of flow). `top: 50%` + `translateY(-50%)` centres it on whatever
height the box derives, rather than restating half of 48 as a magic offset.

Its at-rest chrome changes from a filled disc to nothing: `background: none`, `color: var(--color-primary)`.
The three state rules are correct as they stand and are **not edited**:

- `:hover:not(:disabled)` already sets `background: var(--color-surface-container)` — with no fill at
  rest that is exactly AC2's "container step on an existing token", now a step from nothing rather than
  between two surfaces.
- `:disabled` already sets `color: var(--color-on-surface-variant); cursor: not-allowed` — AC2's
  not-connected treatment verbatim, and the convention `QuestionPanel` and `.conversation__back` cite.
- `:focus-visible` already outlines on `--color-outline`.

### The text's right inset

`padding-right: calc(48px + var(--space-2))` = 56px, which is the control's 48px plus its 4px inset plus
4px of clearance. `48px` is a literal for the same reason it is one in `.composer__send` two rules below:
a control's own size is structural geometry, not spacing (the `.composer__footer` / `.composer-status` /
`.conn-dot` precedent in this file). AC1's "every value a token" is read as the colour/corner/type/spacing
values, which are all tokens here.

### The 41% ground

`--color-on-primary` at 41% lands on a **dedicated `::before` at `opacity`**, not as a `color-mix()`
value:

```css
.composer__row::before { content: ''; position: absolute; inset: 0;
  background: var(--color-on-primary); border-radius: inherit; opacity: 0.41; }
```

AC1 permits `color-mix` over a token, and it would be one declaration instead of six. It is declined
because this exact colour at this exact percentage already ships one region away —
`.question-panel__other-field::before`, the drawing's `Input small` — and `.pairing-field::before` and
`.status-sheet-overlay__scrim` are the same form again. `color-mix()` appears nowhere in this repo as a
*value*; it appears three times in comments, named as the form the house rule declines. Introducing it
here would fork the file's treatment of one colour for no visual difference. The rule the house is
actually enforcing — never write the export's hex, keep the token's name — is satisfied by both forms.

`inset: 0` resolves against the row's **padding box**, which with no horizontal padding and no border is
the whole 52px box; `border-radius: inherit` picks up the row's `--radius-xs`.

**The one consequence:** a positioned pseudo-element paints above non-positioned in-flow content, so
`.composer__input` gains `position: relative` to sit above the ground — exactly what `.pairing-field__row`
does for the same reason. `.composer__send` and the type-ahead panel are already positioned and already
later in DOM order, so they need nothing.

### The glyph

`ComposerSendButton`'s send branch swaps the 24-viewBox / 22px arrow for `circle-chevron-up-solid-full`
exported at 28×28 from `Message input button` (347:6440) — the same export family, the same size and the
same one-path/two-subpath shape as the stop glyph #678 already inlined, so both variants now render at
28×28 and both take their colour from `currentColor`. The export's `fill="#9DCBFC"` is dropped; the
colour comes from `.composer__send`'s `--color-primary`, per the standing "token name, never the export's
fallback hex" rule in this file. The two subpaths wind opposite ways and the disc is knocked out by the
nonzero fill rule — do not tidy either direction, the stop glyph's own note verbatim.

Nothing else in the component changes: both `aria-label`s, both class names, the `disabled` gate, the
never-null posture and the two callbacks are untouched.

### § The #940 constraint

Honoured as written:

- **No `overflow: hidden` on `.composer__row`.** The panel is `bottom: 100%`, i.e. outside the row's box;
  clipping to the new corner would erase it, and no `node`-environment vitest can see that.
- **The recorded 4px consequence survives and is not "fixed".** The panel's `left` pulls it
  `COMPOSER_OPTIONS_LABEL_INSET_PX` (12px) left of the anchor, so a row's label lands flush with the box's
  left edge while the box's text starts 16px in. With the horizontal split chosen above, that 16px is
  still the textarea's own `--space-4` — the arithmetic is not merely equivalent, it is *unchanged*.
- **The anchor rect does not move in x or width.** The row gains no border and no horizontal padding, so
  its border box is where it was. It grows 4px in height, 48 → 52, which the clamp spec does not read.

### Comments

Trued up in the same commit: the #678 follow-up note above `ComposerSendButton` (this ticket *is* the
follow-up); `.composer__send`'s description of the filled disc and the 22px arrow; and `.composer__row`'s
sentence that the row "carries no padding" and holds the textarea as its first flex item — both false
after this.

Left alone, per the ticket's explicit list: `QuestionPanel.tsx`'s and `conversation.css`'s citations of
the `.composer__send:disabled` convention (unchanged by AC2), `.conversation__back`'s hover-tint citation
(a hover step still exists), and `channels.css`'s "adjacent surface-container swap" parenthetical about
that screen's own FAB.

## State + concurrency model

None. No store slice, no async work, no subscription, no effect, no cancellation path. The redraw is a
pure function of the state `ComposerSendButton` and `Composer` already receive.

## Error handling

None reachable. No new branch, no new failure mode, no daemon-supplied value enters the markup — the two
strings involved (`Send`, `Stop the running turn`) are client-owned constants that already exist and may
not be reworded.

## Testing strategy

**vitest** (`ConversationScreen.test.tsx`, the existing `#678` describe — static server renders, so
markup only):

- The glyph-swap test *breaks by construction*: it currently discriminates the variants on
  `viewBox="0 0 28 28"` and asserts the idle branch does **not** contain it. Both glyphs are 28×28 now,
  so the discriminator moves to a distinguishing substring of each path (the chevron's `M20.6172`, the
  stop's square subpath), and the shared 28×28 becomes an assertion of its own rather than a difference.
- New: the idle control renders the chevron path at 28×28; the running control still renders the stop
  path at 28×28; neither glyph carries a hardcoded fill colour (`fill="currentColor"`, no `#9DCBFC`).
- The five behavioural tests in that describe (both labels, the `disabled` asymmetry, the one-button
  invariant) must pass **unedited** — that is the ticket's proof that this is chrome only.

**Playwright**, new `e2e/composer-message-box.spec.ts`, fake tier, one `test()` and one launch (the
`composer-options-clamp.spec.ts` shape, `wholePixels` borrowed for the rounded deltas):

- the box is 52px tall with a 6px corner;
- the ground is `--color-on-primary` at 41% on the row's `::before`, and the row's own background is
  transparent;
- the control sits *inside* the box: 4px clear of its right edge and vertically centred (equal top and
  bottom gaps);
- the text cannot run under it: the textarea's right padding is at least the control's width plus its
  inset;
- at rest the control paints no container (its own `background-color` is fully transparent) and its
  `color` is `--color-primary`.

Everything geometric is here because vitest runs `environment: 'node'` — no layout, no CSSOM, no
computed style. Nothing here re-proves the type-ahead's placement: `composer-options-clamp.spec.ts` and
`slash-command-type-ahead.spec.ts` already measure it against this anchor and are the detectors for AC3's
type-ahead clause, in the verifier's full tier.

**Not re-proved:** the placeholder and both accessible names, pinned by 21 existing `getByPlaceholder`
locators and the `#678` describe; the covered state, pinned by `composerSlot.test.tsx`; the footer's DOM
order, pinned in `ConversationScreen.test.tsx`.

## Open questions

1. **Does Chromium give a `rows={1}` textarea at 14/20 exactly 20px of content height?** The 52px follows
   from it. If it does not, the box's height is asserted at whatever the engine derives and the delta is
   recorded here rather than forced with a declared height. — *Resolve by running the new spec.*
2. **Does the `::before` ground need any stacking help beyond `position: relative` on the textarea?** The
   painting order says no for the two already-positioned siblings. — *Resolve by looking at the running
   app / the spec's transparency assertions.*
