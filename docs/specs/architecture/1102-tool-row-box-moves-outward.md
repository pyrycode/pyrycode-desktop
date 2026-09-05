# 1102 — the tool row's box moves outward so the expanded body sits inside the border

## Files read

Codegraph is not available in this repo (`mcp__codegraph__*` answers "CodeGraph not initialized"), so the
reading list below was built with Grep and Read rather than from `codegraph_context`. This slice is CSS
and a Playwright spec, so a symbol graph would have had little to say about it either way.

- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row`, `.tool-row--resolved`,
  `.tool-row--error .tool-row__chip`, `.tool-row--expanded`, `.tool-row__chip`,
  `.tool-row__chip--toggle`, `.tool-row__chip--toggle:hover`, `.tool-row__body` — the whole edit surface.
- `src/renderer/src/screens/conversation/conversation.css` → `.code-block`, `.code-block__body` — the
  comment on `.code-block` reasons from `.tool-row--expanded`'s `align-items: flex-start` and goes false
  in this slice; the block itself is the "a shell call's command block included" half of AC3.
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row__right`, `.tool-row__count` — the
  `max-width: 50%` cap resolves against the chip's *definite* `width: 100%`; this slice must leave that
  definite, which it does.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__footer-button` — this file's
  `border: none; background: none` UA-reset idiom, cited by Technical Note 3.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ToolRow` — confirms `.tool-row__body`
  is already the chip's *sibling* inside `.tool-row`, which is why this slice re-parents nothing and
  touches no TSX.
- `src/renderer/src/theme/tokens.css` → `--space-1` 4px, `--space-2` 8px, `--space-3` 12px,
  `--radius-xs` 6px, `--color-surface` `#101418`, `--color-primary-container` `#134a74` — every value the
  design names already has a token; nothing new is minted.
- `e2e/tool-row-toggle.spec.ts` → `measureChip`, `expectTrailingGroupFlush`, `chipInsetsOf`,
  `leadingInset` — the four helpers that read the chip's own box. Only the first stops being true.
- `e2e/thread-scroll-pin.spec.ts` → the three `.tool-row` count assertions — collapsed rows only, and
  collapsed height is unchanged, so nothing there moves.
- `docs/knowledge/features/conversation-shell-tool-row-layout.md` § "Full-width bordered tool row (#722)"
  — the lesson this slice is the direct sequel to: *three shipped comments in this region argued against
  the box #722 built, and two of the declarations they guarded still had to stay for different reasons
  than the stale comment gave. Grep the region's comments for the property being changed before changing
  it.* Applied below: every comment naming `align-items: flex-start`, the chip's border, or the chip's
  fill was found and is re-stated rather than left wrong.
- `docs/knowledge/features/conversation-shell-tool-rows.md` § "Expandable tool-call result (#696, toggle
  #697)" — the origin of the "the chip is a single-line pill and cannot hold this" reasoning that this
  slice supersedes.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=152-5215

`Tool row` `152:5215` draws as **one** bordered box — `Schemes/Background` fill, a 1px
`Schemes/Primary Container` stroke, a 6px corner, `overflow-clip`, `px-12 py-8`, laid out as a column
with a **12px** gap — holding `Header` above `Body`, both at `w-full`. `Body` adds 4px of its own bottom
padding and stacks `Fields` (two `Input field` instances) above the result text, everything at the row's
full content width. Verified against the node's own frame widths: on the 875px instance `Body`, `Fields`,
both fields and the result all measure 851 = 875 − 24, so nothing inside hugs. `Code` measures 717, but
it is `hidden` in both the instance and the symbol and so kept the symbol's pre-instance width — an
artefact, not a statement that a command block hugs.

## Context

`.tool-row__chip` is the bordered box and `.tool-row__body` is its sibling, so an opened row draws the
border *above* the content it should contain, with the body hanging underneath at an 8px gap. That was
correct when #696 wrote it — the chip was then a hug-width single-line pill with `overflow: hidden` — but
#722 turned the chip into the full-width bordered box and left the body outside it.

The fix is to move the box treatment outward from `.tool-row__chip` to `.tool-row`. Nothing is
re-parented: the body is already inside `.tool-row`, so it falls inside the border for free. Nesting the
body inside the chip is not an alternative and never will be — the chip is a `<button>` and a `<pre>` is
not phrasing content.

This slice moves the box and places the body at the design's insets. Every treatment *inside* the body —
the field value box, the result's fill, its type — belongs to #1103. #1073 (joining consecutive rows by
overlapping their borders 1px) is natively blocked on this slice, because that rule wants a border on
`.tool-row`.

No ADR is warranted: this reverses a placement decision inside one stylesheet region, and the region's
own comments plus the package overview are the right home for the reasoning.

## Design

All of it is `conversation.css`. **No TSX changes** — a diff touching `ConversationScreen.tsx` has gone
somewhere this ticket did not ask it to go.

### The padding split

The row takes **fill, border, corner and clip only — no padding**. The two children supply their own:

| Element | Insets |
|---|---|
| `.tool-row` | none |
| `.tool-row__chip` | keeps `var(--space-2) var(--space-3)` (8/12), unchanged |
| `.tool-row__body` | gains `0 var(--space-3) var(--space-3)` (0 top / 12 sides / 12 bottom) |
| `.tool-row--expanded` gap | `var(--space-2)` → `var(--space-1)` (8 → **4**) |

The alternative — hoisting the design's 8/12 onto the row — is rejected because it shrinks the toggle's
`:hover` fill to a rectangle inset 12px inside the border on every side, changes a collapsed row on
screen, and moves the chip-width equalities by 26px rather than 2px.

The arithmetic AC1 asks for, under that split:

- **8px above the header's line box** — the chip's own top padding.
- **12px between the header's line box and the body's first block** — the chip's 8px bottom padding plus
  the row's 4px expanded gap plus the body's 0 top padding.
- **12px on each side** — the chip's and the body's own horizontal padding.
- **12px below the body's last block** — the body's own bottom padding (the design's 4px body padding
  plus the row's 8px, merged into one declaration since the row carries none).
- **Collapsed height is unchanged**: 1 + 8 + 20 + 8 + 1 = 38.

The gap value is `--space-1`, **not** the design's 12. The design measures header *frame* to body *frame*
on a node whose header carries no padding of its own; here 8 of that 12 is already inside the chip, so
declaring `--space-3` would draw 20px. It stays on `.tool-row--expanded` rather than moving to the base
rule: gaps only fall between items, so leaving it on the modifier keeps a one-child collapsed row
provably unaffected.

### The six consequences

1. **`.tool-row` becomes the box and the column.** It gains `background`, `border`, `border-radius` and
   `overflow: hidden` — the chip's current four values, moved, so nothing new is minted. It gains
   `flex-direction: column`, which moves off `.tool-row--expanded`: the row is a column in both states
   once it is the box. `justify-content: flex-start` **goes**: it was the main-axis alignment of a
   *row*-direction container ("left-aligned in the thread"), and in a column of auto height it is inert.
   The deletion is documented in the rule's comment rather than left as a declaration whose stated job
   no longer exists.

2. **`.tool-row--expanded` keeps only its gap**, at the new value. `align-items: flex-start` **goes**:
   the node sizes `Body`, `Fields`, every field and the result at the row's full content width, so the
   children must stretch (AC3). That falsifies two shipped comments, and both are re-stated rather than
   left wrong:
   - `.code-block`'s reasons from `align-items: flex-start` to "the command block is content-sized at
     this second site". Under `stretch` the body fills the row's content box and `.code-block` is a
     stretched item of the body's own column, so it fills — which is what AC3 asks for.
   - `.tool-row__body`'s opens by citing #696's "the chip is a single-line pill … so it cannot hold
     this", the reasoning this slice supersedes, and then claims `max-width`/`min-width` are what keep a
     16000-character line from widening the row. Under `stretch` the container's cross size is what does
     that; the pair drops to belt and braces and is kept as such.

3. **`.tool-row--error .tool-row__chip` becomes `.tool-row--error`**, retinting the border that is now
   the row's. At `.tool-row--error` it is (0,1,0) — equal specificity with the base `.tool-row` — so it
   wins on source order alone and must stay after it. It already sits there.

4. **`.tool-row__chip--toggle` must now state `border: none` and `background: none`**, the two
   declarations its own comment forbids at length. That comment's argument was that a `border` here would
   out-order `.tool-row--error .tool-row__chip` and silently kill the error accent. Once the border and
   the fill move outward the chip declares neither, and the resolved branch is a `<button>`, which then
   inherits the UA's grey 3D border and button-face background — a resolved row would grow while the
   pending `<div>` branch would not, breaking the "the two branches are identical by construction"
   property #722 wrote that rule for. `.composer__footer-button` is this file's reset idiom. The old
   argument dies with the rule it protected, and the comment says so where it stood rather than
   disappearing.

5. **`.tool-row`'s `opacity: 0.5` now dims a box with a fill** rather than a transparent wrapper. Checked
   on screen during implementation; if a pending row no longer reads as pending, that is reported on the
   ticket rather than retuned inside this slice.

6. **The row's new clip swallows the toggle's UA focus ring, so the chip must draw its own — inset.**
   Found by the security pass below, not by the ticket. The toggle's border box now coincides *exactly*
   with the row's padding box (`width: 100%` + `border-box` against a row with no padding, and on a
   collapsed row the chip is the row's whole height), and an `outline` is painted outside the border box,
   so `overflow: hidden` on the row clips the keyboard focus indicator away on all four sides. Today the
   row does not clip and the ring is visible, so this is a regression AC2 ("a collapsed row is unchanged
   on screen") would otherwise ship. The remedy is this file's own idiom, at seven `:focus-visible` call
   sites: `outline: 1px solid var(--color-outline)`, plus `outline-offset: -1px` to draw it *inside* the
   border box where the clip cannot reach it — the offset `.composer__row:has(.composer__input:focus-visible)`
   already states for the same reason. This falsifies a **third** claim in
   `.tool-row__chip--toggle`'s comment — "NOT `outline` either: the UA focus ring is inherited for free" —
   by exactly the move that falsified its `border` and `background` claims, and it is re-stated with them.
   `--color-outline` and not `--color-primary`: the file reserves the latter for an edge that must not
   read as the focus ring's twin, which does not apply here.

### What deliberately does not move

- **The chip keeps `overflow: hidden`.** #856's security control measures the chevron against the chip's
  *padding* edge — `.tool-row__right`'s `max-width` caps an unbounded `result_detail`, and the chip's
  clip is what catches a chevron pushed past it. Moving the clip outward to the row would move that edge
  12px further out. Both clips ship.
- **The chip keeps `width: 100%` + `box-sizing: border-box`.** They now resolve against the row's
  *content* box, since the row carries the border. `width` is a specified cross size, so it wins over the
  container's `stretch` rather than being redundant to it; `border-box` is what keeps the 12px padding
  inside the measure. The chip's content width is unchanged either way (row width − 2 − 24).
- **`.tool-row__body`'s own `gap: var(--space-2)`, and every treatment inside it.** The design gives the
  body a 12px internal gap, but that is a change to the body's contents and belongs to #1103.
- **`.conversation__workspace-chip-pill`'s comment**, which cites "the `.tool-row__chip` idiom
  (inline-flex, `--space-2` gap, `--space-2`/`--space-3` padding, max-width/min-width/overflow…)". #722's
  own review flagged it as already stale and left it; this slice makes it staler but it is outside the
  edited region and correcting it is adjacent-code refactoring.

## State + concurrency model

None. This slice adds no state, no async work and no subscription. The row's collapsed/expanded state is
`ToolRow`'s existing `useState`, untouched.

## Error handling

None at a boundary. The one failure-path concern is visual and is AC4: the failed row's retinted border
must follow the box outward, and `.tool-row--error` must keep winning over the base `.tool-row`. That is
source order, and it is pinned by a new computed-`border-color` assertion rather than by inspection.

## Testing strategy

The unit tier is `renderToStaticMarkup` and sees no CSS at all, so **no unit spec changes**: this slice
adds no element, no class and no attribute. `ConversationScreen.test.tsx`,
`interactiveRoundtrip.test.tsx` and `BackgroundTaskPanel.test.tsx` are markup-only and pass unedited.
Everything below is `e2e/tool-row-toggle.spec.ts` (fake transport), run with
`npx playwright test e2e/tool-row-toggle.spec.ts` after `npm run build`.

**Re-derived, not deleted.** `measureChip`'s three width equalities compare the chip's rendered width to
the row's *bounding box*. The chip is now the row less its 2px of border, and the spec's tolerance is
0.5px, so the 2px shift genuinely reddens rather than passing inside slack. The comparison moves to the
row's **content** width (`clientWidth` less its computed padding, read rather than hardcoded). The
property being protected is unchanged — a resolving row does not shift, and the `<button>` and `<div>`
branches measure the same — and it doubles as AC2's hover check: the chip's box *is* the row's content
box, so a hover fills the whole box inside the border rather than a rectangle inset from it.

**Verified invariant, re-commented rather than changed.** `expectTrailingGroupFlush` and `chipInsetsOf`
read the chip's own `paddingRight` + `borderRightWidth`; the padding stays and the border width goes to
0, and the chip's origin gains exactly the 1px its own border loses, so both still compute the same
edge. `leadingInset` is the same identity in the other direction. The height equalities and the
group-origin equality compare two elements that shift identically. Each gets a note naming which element
now carries which inset.

**One new test — the assertion this slice IS.** Computed geometry the `renderToStaticMarkup` tier
structurally cannot observe. A fifth sibling `test`, launching its own app for the reason the four above
record (bare `.tool-row` locators go strict-mode-ambiguous when another test's rows land on the page).
Two rows, scoped by index:

- **Row 0 — `read_file` with an `input` map, resolved successfully, expanded by click.** Asserts, at the
  row's *padding* box (its bounding box inset by its computed border widths):
  - the header's line box sits 8px below the row's padding-box top (AC1);
  - the body's first block sits 12px below the header's line box (AC1);
  - the body's border box is inset 12px from the row's padding box on the left and on the right, and
    flush with it at the bottom — which is the 12px below the body's last block, since the body's own
    bottom padding supplies it (AC1);
  - the body's border box sits inside the row's padding box on all four sides (the slice's subject);
  - the field list's value block and the result block each fill the body's content width (AC3).
- **Row 1 — `Bash` with a `command`, resolved with `is_error: true`, expanded.** Asserts:
  - `.code-block` fills the body's content width — AC3's "a shell call's command block included", the
    half whose Figma measurement is an artefact and whose justification is the auto-layout stack;
  - the row's computed `border-color` is the error colour and differs from row 0's, while the chip's
    computed `border-right-width` is `0` — AC4, the failure device on the row rather than on an element
    that no longer has a border. Asserted comparatively against row 0 so a token retune does not redden
    it, while a selector left at `.tool-row--error .tool-row__chip` must.
- **AC5** rides the rows this test already has: a computed `opacity` of `0.5` while pending and `1` once
  resolved. The "does it still *read* as pending" half is a visual check performed during
  implementation, not an assertion.
- **The focus ring** (consequence 6) is asserted on the *existing* keyboard test, which already focuses
  the toggle and presses Enter: the focused toggle's computed `outlineStyle` is not `none` and its
  `outlineOffset` is negative, i.e. drawn inside the clip. Whether Chromium's `:focus-visible` heuristic
  matches after a programmatic `locator.focus()` in this fixture is confirmed empirically before the
  assertion ships; if it does not match reliably, the assertion is dropped rather than made flaky and the
  rule is carried by the comment and the screenshot pass alone. Either outcome is recorded in
  § Revisions.

Values are read from computed style rather than hardcoded, the convention every helper in this file
already follows, so a retune of `--space-1`/`--space-3` moves the expectation with the rule.

Secret hygiene, carried from the sibling tests: every assertion reads DOM geometry, computed style,
attributes and counts. The tool ids and the invented tool name are non-secret display/routing literals;
no failure diagnostic serialises a token, key or plaintext.

## Open questions

1. **Does the pending row still read as pending once the wrapper has a fill?** (AC5, Technical Note 4.)
   Resolved by looking at a rendered screenshot during implementation. If it reads merely faint, that is
   reported on the ticket, not retuned here.
2. **Does the hover fill's corner need anything?** The chip loses its own `border-radius`, so its hover
   fill is a square rectangle clipped by the row's 5px inner radius (6px outer less the 1px border)
   rather than drawn at 6px itself. Expected to be visually identical; confirmed in the same screenshot
   pass.

## Security review

**Verdict:** PASS (first pass FAILed on the focus-ring finding below; the plan was revised inline —
Design § consequence 6 — and re-run.)

This slice ships no TypeScript. Its security surface is therefore not code paths but **geometric bounds
on untrusted daemon text**, which is the whole of what #856 treated as a security control in this exact
region: a tool row renders `name`, `input_summary`, every key and value of the `input` map,
`result_summary` and `result_detail`, all attacker-influencable through a compromised daemon or anything
speaking inside the Noise session. Moving a box outward moves the edges those bounds are measured
against, so each was re-derived arithmetically rather than assumed.

**Findings:**

- [Electron attack surface / affordance hiding] **MUST FIX — fixed in the plan before commit.** The row
  gains `overflow: hidden` (AC1's clip), and the toggle `<button>`'s border box comes to coincide exactly
  with the row's padding box. An `outline` paints outside the border box, so the UA keyboard focus ring
  is clipped away entirely — the row's only interactive element loses its focus indicator, on a control
  the spec's own keyboard test proves is reachable by Enter. The same class of defect #856 exists to
  prevent (the row's only affordance disappearing past the chip's clip), here self-inflicted rather than
  attacker-triggered. Fixed by giving `.tool-row__chip--toggle:focus-visible` an inset ring
  (`outline-offset: -1px`), the idiom already shipped three times in this file.
- [Trust boundaries] No new boundary. Every untrusted string already crosses at the decode → IPC → bridge
  path and reaches the row as typed text; this slice adds no element, no attribute, no `content:` and no
  `attr()`, so nothing daemon-controlled reaches a raw-markup sink, an attribute, a URL, a filename, a
  cache key or a log. No TSX is touched, which makes that structural rather than a claim.
- [Network & I/O — layout DoS, `result_detail`] No finding, **verified arithmetically rather than
  assumed.** #856's control caps `.tool-row__right` at 50% of the chip's content box and relies on the
  chip's `overflow: hidden` catching a chevron pushed past it. Both inputs to the spec's assertions are
  numerically unchanged: `chipInsetsOf`'s `contentWidth` is `clientWidth − paddingLeft − paddingRight` =
  (row − 2) − 24 before and after, and the trailing edge `chip.x + chip.width − paddingRight −
  borderRight` is `row.x + row.width − 13` before and after, because the chip's origin gains exactly the
  1px its own border loses. The chip's clip is kept for this reason and is *not* replaced by the row's,
  which sits 12px further out.
- [Network & I/O — layout DoS, a 16000-character line] No finding, and the bound gets **stronger**.
  Today `.tool-row__body` is content-sized under a `max-width: 100%` ceiling; under `stretch` its cross
  size is the row's content width, which is definite because `.tool-row` is itself a stretch item of
  `.conversation__thread`'s column and no child can widen it (automatic minimum size applies to a flex
  item's *main* axis, and in a column container that is the block axis). `.tool-row__result` and
  `.tool-row__input-value` keep `overflow: auto` and the 240px `max-height`.
- [Network & I/O — unbounded field count] OUT OF SCOPE, pre-existing and unchanged: the `input` map's
  cardinality is uncapped on the wire, so a hostile daemon can make one row arbitrarily tall. Nothing in
  this slice makes it better or worse, and `.conversation__thread` is its own scroll region so the
  composer cannot be pushed off screen. Belongs with the body's own treatment in #1103 if it is taken up
  at all.
- [Errors, logs, telemetry] No finding. CSS logs nothing. The new spec follows this file's rule that a
  failure diagnostic names the *element* and never a value (`boxOf`'s shape); its seeded strings are
  test-authored non-secret literals, and no assertion message interpolates a payload.
- [Tokens / files / crypto / concurrency] Not applicable by construction, and that is a property of the
  change rather than an omission: this slice adds no storage, no path, no randomness, no comparison
  against a secret, and no async work. The new spec keeps the fake-daemon convention of fixed envelope
  ids and a fixed timestamp — no `Date.now()`, no `Math.random()` — and awaits every action.
- [IPC / process placement] No finding. Nothing crosses `contextBridge`; the transport, keys and Noise
  session are untouched and remain in the main process.
- [Threat model alignment] The applicable desktop threat is **hostile daemon response**, addressed by the
  two bound-preservation findings above. **Malicious relay** and **token theft from disk** do not reach a
  stylesheet. **Renderer compromise** is unchanged: this slice grants the renderer no new capability.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05

## Revisions

_(none yet — appended here if implementation departs from the design above.)_
