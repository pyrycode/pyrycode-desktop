# #1056 — the message box grows with the draft, to a five-line ceiling

## Files read

| Path | Symbol / region | Why it matters |
|---|---|---|
| `src/renderer/src/screens/conversation/conversation.css` | `.composer__input` | The textarea rule. `box-sizing: border-box`, `resize: none`, no height, body-medium 14/20 — the one rule the growth is declared on. |
| `src/renderer/src/screens/conversation/conversation.css` | `.composer__row` | The box. Its comment names this gap ("a declared height would be a second source of truth fighting the textarea auto-grow"). Still declares no height, and still must not. |
| `src/renderer/src/screens/conversation/conversation.css` | `.composer__send` | `position: absolute; right: var(--space-1); top: 50%; transform: translateY(-50%)` — the centring AC4 replaces with a bottom pin. |
| `src/renderer/src/screens/conversation/conversation.css` | `.composer__row::before` | The ground at `inset: 0`. Follows the height for free; confirmed untouched. |
| `src/renderer/src/screens/conversation/conversation.css` | `.conversation__thread`, `.composer-status`, `.composer__footer`, `.composer` | AC5's neighbours. The thread is `flex: 1 1 auto; min-height: 0`, so it is the one that gives up the space. |
| `src/renderer/src/theme/tokens.css` | `--text-body-medium-line` (20px), `--space-1` (4px), `--space-3` (12px) | The ceiling's arithmetic is written in these, not in literals. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | the `textarea` inside `.composer__row` | Confirms `rows={1}` is the only sizing input and that nothing here changes. |
| `e2e/composer-message-box.spec.ts` | the whole file | The resting spec AC1 pins byte-stable, and the file the grown states join. |
| `e2e/send-and-stream.spec.ts` | the fill → click Send drive | The shape AC3's send half reuses. |
| `e2e/fixtures/launchPairedApp.ts` | `launchPairedApp` | Lands at "paired, connected, on the thread, Send enabled" — and on an EMPTY conversation, so `.conversation__thread` does not exist until a message is sent. Shapes the test split below. |
| `src/renderer/src/screens/conversation/composerSlot.test.tsx` | the `class="composer__input"` whole-attribute-run match | Why no second class may join the textarea. Nothing here adds one. |
| `docs/knowledge/features/conversation-shell-composer.md` | § the two gaps left open by #951 | Records the ~46% non-click-to-focus band as a separate fix. Explicitly left alone. |

`mcp__codegraph__*` was not used: every call in this repo fails with "CodeGraph not initialized". Read and grep throughout.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6635

`Input large` (`347:6635`) is a 741×52 dark box on a 6px corner: `py-[12px]` around a `Text field`
(`pl-[16px] pr-[56px] py-[4px]`) holding one line of body-medium 14/20, with the 48px
`Message input button` at `right-[4px]` inside its right end. That is the resting box this app already
ships and this ticket keeps byte-stable.

**The drawing has exactly one state and no grown one**, as the ticket says — confirmed by reading the
node rather than trusted. Everything past the resting box comes from the operator's ruling of
2026-09-04. No Figma-side ticket is owed.

**One number the drawing does settle, and it settles AC4.** The button wrapper is `top-[-10px]` inside a
`Text field` that starts at y=12, so the control's own top in the 52px box is `12 − 10 = 2`, and its
bottom gap is `52 − 2 − 48 = 2`. The drawing's vertical offset for this control **is 2px** — the 4px is
the horizontal axis only (`right-[4px]`). See § The send control's pin.

## Context

The message box is one line tall and stays one line however long the draft gets: past the first line the
text scrolls inside a 20px window and you cannot see what you are about to send. `.composer__row`
derives its 52px rather than declaring it (12 + 4 + 20 + 4 + 12) precisely so that a grower could be
added without fighting a declared height — its own comment names the auto-grow as unbuilt, and
`conversation-shell-composer.md` and `conversation-shell-seams.md` both record it as "unbuilt (cosmetic,
no AC)". This ticket builds it.

No ADR is owed. This adds no contract, no type and no module; it is two declarations on rules this
repo already owns.

## Design

Two edits, both in `conversation.css`. **No TypeScript changes at all** — `rows={1}` stays, no ref, no
`ResizeObserver`, no measure-and-set.

### 1. The growth and the ceiling — `.composer__input`

```css
field-sizing: content;
max-height: calc(5 * var(--text-body-medium-line) + 2 * var(--space-1));
```

`field-sizing: content` makes the textarea's block size follow its content, with `rows={1}` becoming the
**minimum** rather than the fixed size — which is why the resting box is unchanged and why the TSX needs
no edit. The rule already declares `box-sizing: border-box`, so `max-height` is the border box: 5 × 20px
of line plus the field's own 2 × 4px of padding = **108px**, and the row's 12 + 12 puts the box at
**132px**, derived the same way the resting 52 is.

The ceiling is written in the two tokens the arithmetic actually depends on, mirroring the
`calc(48px + var(--space-2))` already on this rule's `padding-right`: `--text-body-medium-line` is the
line height the textarea lays out at, and `--space-1` is this rule's own vertical padding. A `108px`
literal would be a second source of truth for both.

Past the ceiling the textarea scrolls on its own UA `overflow-y: auto`, and Chromium keeps the caret's
line in view without help. Nothing is declared for either — see § Measured evidence for what that
actually does, including the one cosmetic consequence.

### 2. The send control's pin — `.composer__send`

`top: 50%` and `transform: translateY(-50%)` are **deleted**, replaced by:

```css
bottom: 2px;
```

`right: var(--space-1)` is unchanged, and the pin resolves against the same edge for the reason that rule
already records: `.composer__row` has no border and no horizontal padding, so its padding box edge is its
border box edge — which is what let `right` be the drawing's own number, and means `bottom` lands on the
outer bottom edge too, unaffected by the row's 12px of vertical padding.

**2px, not `var(--space-1)`, and the reason is stronger than the ticket's framing.** The ticket offers
the 4px mirror of `right` and calls 2px "off the 4px grid". Reading the node says otherwise: the drawing
places this control's bottom gap at 2px (§ Design source), so **2px is the drawing's own number on this
axis** and there is no 4px grid on it to be off. It follows that:

- the resting render is byte-identical, so AC1's "at rest the box is unchanged" is met by construction
  rather than by re-measurement;
- `e2e/composer-message-box.spec.ts`'s `expect(gapAbove).toBe(gapBelow)` stays green **unedited** — at
  rest both are 2 — as does `BOX_HEIGHT_PX`. Nothing in the existing test block is touched;
- at every grown height the control sits 2px off the bottom, beside the line being typed, which is what
  AC4 asks for.

The 4px mirror would move the control up 2px at rest, redden that assertion, and buy a grid alignment the
drawing does not ask for. Declined.

### What is deliberately NOT done

- **No height on `.composer__row`.** Its comment's warning stands: the height stays derived.
- **No second class on the textarea** (`composerSlot.test.tsx` matches `class="composer__input"` as a
  whole attribute run).
- **No `scrollbar-gutter: stable`.** It would reserve the scrollbar's 15px at rest and narrow the resting
  text column, which AC1 forbids. See § Measured evidence.
- **No pin, hook or observer for the thread's scroll position.** #1049's `ResizeObserver` already watches
  `.conversation__thread`'s own border box, which is exactly what a growing composer changes.
- **The composer overview's ~46% non-click-to-focus band is left alone** — a different fix with its own
  visible behaviour, recorded there and out of scope here.

## State + concurrency model

**None, and that is the design.** No component state, no store slice, no effect, no subscription and no
async work is added or touched. The draft's `text` state stays in `Composer` (a leaf), so a keystroke
still re-renders nothing above it, and `useThreadScrollPin`'s no-dependency-array effect still does not
re-run. Growth is a layout consequence of a declaration; there is no lifecycle to tear down and no
cancellation path to define.

## Error handling

No I/O, no IPC, no daemon text and no user-supplied string reaches any new sink. Nothing is logged,
because nothing fails: the one failure mode a CSS-only change has is an engine that does not implement
the property, and that is a build-time constant here, not a runtime branch. Electron 33 (Chromium 130) is
past `field-sizing`'s Chromium 123, there is no second engine, and § Measured evidence records the
property resolving to `content` in the shipped binary rather than being dropped.

## Testing strategy

Geometry is invisible to the renderer tier (`vitest.config.ts` sets `environment: 'node'`: no layout, no
CSSOM, no `getComputedStyle`), so **every assertion is Playwright**, in
`e2e/composer-message-box.spec.ts` beside the resting ones. No vitest file changes.

The existing `test()` block is untouched — it is AC1's detector and its whole contract is that it stays
green unedited. Two new blocks join it, split on a fixture fact rather than on taste:
`launchPairedApp` lands on an **empty** conversation, where `.conversation__thread` does not exist
(`.conversation__empty` renders instead), so AC5 must send a message first — which is also AC3's send
half, so the two share one launch.

**Block 2 — growth, ceiling, shrink and the pin (AC2, AC3-by-deletion, AC4).**

- The draft is driven with **explicit newlines**, per the ticket: `'line 1\nline 2\n…'` is N lines on any
  window width and any font metric, where a long line that happens to wrap N times is a detector that
  moves when the sidebar does.
- The box is 52 / 72 / 92 / 112 / 132 at 1–5 lines, asserted line by line so a failure names which step
  broke, not just that the ceiling is wrong.
- At 6 and at 8 lines the box stays 132 and the textarea's `scrollHeight` exceeds its `clientHeight`.
- **Caret in view**: after `pressSequentially` at the tail of an over-tall draft, less than one line
  remains below the fold (`scrollHeight − (scrollTop + clientHeight) < 20`). This is the honest form of
  the assertion — see § Measured evidence for why "scrolled fully to the bottom" is the wrong one — and
  it reddens loudly if the box stops scrolling at all.
- Shrink: back to 3 lines is 92, and empty is exactly 52.
- **The pin (AC4)**: the control's gap below the box's bottom edge is the same number at 52px and at
  132px, its size is still 48×48 at both, and its gap ABOVE differs between them — that last one is what
  separates a pin from a centring, and is why it is asserted rather than assumed.
- **The `field-sizing` width guard the ticket demands**: the textarea's own border-box width equals the
  row's at rest, at five lines, and under a 400-character unbroken line. None of the shipped assertions
  read that box, so without this AC1 would be called proved while the intrinsic-width half went
  unmeasured.

**Block 3 — the neighbours (AC3's send half, AC5).**

- A draft is sent through the real fill → click Send drive; the bubble arrives and the box is exactly
  52px again.
- `.conversation__thread`'s height **delta** is asserted against the box's: as the box goes 52 → 132 the
  thread drops by exactly the same 80. The delta form is the point — a fixed 428 would encode the
  window's size, not the behaviour.
- `.composer-status` and `.composer__footer` keep their heights across the growth, and
  `document.documentElement.scrollHeight` equals its `clientHeight` at both. These two are the cheap
  sanity check the ticket calls them, not the detector: the footer's `height: 20px` is hard, so it
  essentially cannot redden. The thread delta and the document-overflow reading are the ones that bite.

## Measured evidence

Everything below was measured before this plan was committed, by injecting the two candidate
declarations into the **built** app through `page.addStyleTag` under `launchPairedApp` — the ticket's
"prove it in the Playwright tier before reaching for the scripted idiom", run without touching the tree.
The probe was deleted; these are its numbers.

- **The property is live in the shipped binary.** `getComputedStyle(...).fieldSizing` serialises `fixed`
  before the patch and `content` after — not dropped. **The scripted measure-and-set idiom is not needed
  and is not taken.**
- **Growth, ceiling and shrink, exactly as designed.** Box height at 1–8 lines: 52, 72, 92, 112, 132,
  132, 132, 132. Back to 3 lines: 92. Emptied: 52. After a real send: 52.
- **The intrinsic-width prediction holds.** The textarea's border-box width is 616 at every height,
  equal to the row's 616, including under a 400-character unbroken line. `flex: 1 1 auto; min-width: 0`
  fills the row exactly as predicted, and the prediction is now a measurement.
- **AC4's pin, and AC1 undisturbed.** With `bottom: 2px`, the gap below is **2px at every height** while
  the gap above goes 2 → 22 → 42 → 62 → 82. At rest both gaps are 2, so `expect(gapAbove).toBe(gapBelow)`
  holds unedited.
- **AC5's neighbours.** Across 52 → 132: thread 508 → 428 (−80, exactly the box's +80), `.composer-status`
  24 → 24, `.composer__footer` 20 → 20, `.composer` 100 → 180, and
  `document.documentElement.scrollHeight === clientHeight === 772` at every height. Nothing overflows.
- **The caret's line is kept in view, but not by scrolling fully to the bottom.** At 8 lines
  `scrollTop` settles at 54 where the maximum is 60: Chromium scrolls the **caret** flush to the visible
  bottom edge, and the caret is the ~16px text box, not the 20px line box, so the last 2px of leading
  stays below the fold. An assertion of "scrolled to the very bottom" would fail against a correct
  render — hence the `< one line remains` form above.
- **One cosmetic consequence, recorded rather than fixed.** At six lines and beyond the UA scrollbar
  appears and takes 15px from the textarea's *content* width (`clientWidth` 616 → 601) while its border
  box stays 616 — so nothing outside the textarea moves, but the wrapped text re-wraps 15px narrower at
  the moment the draft crosses the ceiling, and a track paints inside the box's right edge below the
  send control. It is left as-is: the design draws no scrolled state, a scrollbar is the honest signal
  that the draft continues past the box (which is the defect's own subject), and the one declaration that
  would remove the re-wrap, `scrollbar-gutter: stable`, buys it by narrowing the **resting** text column
  by 15px — which AC1 forbids.

## Open questions

1. **Does the slash-command type-ahead still sit right at five lines?** It is anchored on
   `.composer__row` at `bottom: 100%`, so it should ride up with the box, and
   `e2e/composer-options-clamp.spec.ts` reads the anchor's x and width only, so it cannot redden either
   way. To be checked by eye during Phase B and recorded under `## Revisions` if anything is owed.
2. **Does the thread's scroll pin visibly slip at five lines?** Expected not to — #1049's
   `ResizeObserver` watches the thread's own border box, which is what a growing composer changes. If it
   does slip, it is filed as its own ticket, not widened into this one.
