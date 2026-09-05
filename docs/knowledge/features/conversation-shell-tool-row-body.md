# Conversation shell — tool row body

The body's own drawing, done in two slices: the box treatment moving from the chip onto the row, then the
design's field-value box and bare-text result inside it. Split out of
[Conversation shell — tool row layout](conversation-shell-tool-row-layout.md) on 2026-09-05 to keep every
section under the size cap; see that document for the layout arc as a whole and
[Conversation shell](conversation-shell.md) for the screen itself.

## Tool row box moves outward (#1102)

Moves the bordered-box treatment — fill, 1px border, 6px corner, clip — from `.tool-row__chip` to
`.tool-row` itself, so an expanded row's body (`.tool-row__body`, already the chip's sibling) falls
*inside* the border instead of hanging beneath it. [#722](conversation-shell-tool-row-box.md#full-width-bordered-tool-row-722) made the
chip itself the box; #1102 moves only *where* the box lives, not that it exists. `conversation.css` and
`e2e/tool-row-toggle.spec.ts` only — no TSX, no markup change, nothing re-parented, since the body was
already the chip's sibling inside `.tool-row`.

**The padding split.** The row carries fill, border, corner and clip — no padding of its own.
`.tool-row__chip` keeps its `--space-2 --space-3` (8/12) padding and its hover, so a collapsed row's
header inset and hover fill stay byte-identical; `.tool-row__body` gains `0 var(--space-3) var(--space-3)`
(0 top / 12 sides / 12 bottom) as its own half of the design's insets. Hoisting the design's 8/12 onto the
row instead was rejected: it would shrink the toggle's `:hover` fill to a rectangle inset 12px inside the
border, changing a collapsed row's paint, and it would move the chip-width e2e equalities by 26px rather
than the 2px of border they actually move by.

**`.tool-row--expanded`'s gap is 4px, not the design's 12.** Figma measures 12px from the header frame to
the body frame on a node whose header carries no padding of its own; 8 of that 12 is already the chip's
own bottom padding (which stands in for the row's absent bottom padding on a collapsed row), so the row's
gap supplies only the remaining 4 — `--space-1`, not `--space-3`. Collapsed height is unchanged either
way: `1 + 8 + 20 + 8 + 1 = 38`, which `e2e/thread-scroll-pin.spec.ts` now measures inside an overflowing
thread (until the follow-up below it only counted rows there).

**The row must state `flex: 0 0 auto`, and the first build without it shipped.** Found in the
running app on 2026-09-05, the afternoon #1102 merged: every tool row in a real chat had shrunk to a
2px blue line. The clip is the cause. A flex item whose overflow is not visible has an automatic
minimum height of 0 rather than its content, and `.conversation__thread` is a scrolling column, so
as soon as the thread is taller than its viewport the tool rows were the one kind of child free to
shrink and they gave up all their height, keeping only the two borders. Bubbles do not clip, so
their content stays their floor. Before #1102 the clip sat on the chip, which is not a child of the
thread, so nothing shrank. The fix is the stylesheet's own no-shrink idiom on `.tool-row`, and the
guard is a collapsed-height assertion in `e2e/thread-scroll-pin.spec.ts` — the only spec whose
thread overflows. `e2e/tool-row-toggle.spec.ts` lays out a thread that never scrolls and cannot
observe this by construction, which is why the slice's own gate passed.

**Every block in the body now fills the row's content width instead of hugging.** `.tool-row--expanded`
drops `align-items: flex-start` — held since #722 specifically to keep the body content-sized while the
chip took its own `width: 100%` — because the design sizes `Body`, `Fields`, every field and the result
block at the row's full content width. `flex-direction: column` moves off `.tool-row--expanded` onto the
base `.tool-row` rule, since the row is a column in both states now that it is the box; only the *gap*
stays state-dependent. This falsified two shipped comments — `.code-block`'s (reasoned from `flex-start`
to "content-sized at this site") and `.tool-row__body`'s own (which opened by citing #696's "the chip is a
pill and cannot hold this," the very reasoning #1102 supersedes) — both re-stated in place rather than
left wrong.

**`.tool-row--error` replaces `.tool-row--error .tool-row__chip`** as the border retint, since the chip no
longer has a border to retint. At `.tool-row--error` alone the selector is (0,1,0) — equal specificity to
the base `.tool-row` — so it now wins by source order rather than by outspecifying it, and must stay
declared after the base rule.

**`.tool-row__chip--toggle` gained the two declarations its own comment used to forbid: `border: none` and
`background: none`.** With the border and fill gone from the chip, the resolved branch — a real
`<button>` — would otherwise inherit the UA's grey 3D border and button-face background, growing relative
to the pending `<div>` branch and breaking #722's "identical by construction" property. The comment that
argued against ever stating `border` here is corrected in place rather than deleted, so a future reader
sees the argument refuted rather than silently gone.

**A regression caught by the slice's own security pass: the row's new clip ate the toggle's UA focus
ring.** Once the toggle's border box coincides exactly with the row's padding box (`width: 100%` +
`border-box`, no row padding) and the row clips (`overflow: hidden`, AC1's requirement), a UA outline —
painted outside the border box — is clipped away on all four sides, silently removing the row's only
keyboard affordance's indicator. Fixed with this file's own `:focus-visible` idiom, inset:
`outline: 1px solid var(--color-outline); outline-offset: -1px`, drawn just inside the clip rather than on
top of it.

**What deliberately did not move.** The chip keeps its own `overflow: hidden` — a *second* clip, 12px
inside the row's — because #856's chevron-safety bound measures against the chip's padding edge, not the
row's; moving the clip outward alone would have loosened that bound by 12px. The chip keeps
`width: 100%` + `box-sizing: border-box`, now resolving against the row's content box rather than the
row's whole box, with an unchanged result (row width − 2 − 24, before and after). `.tool-row__body`'s
`max-width`/`min-width` stay as belt-and-braces against a 16000-character line, though the container's
`stretch` is now what actually bounds it.

**Testing.** No unit-tier changes — `renderToStaticMarkup` sees no CSS, and this slice adds no
element/class/attribute. In `e2e/tool-row-toggle.spec.ts`, `measureChip`'s three width equalities were
re-derived (not deleted) against the row's *content* width rather than its bounding box, since the chip is
now the row less 2px of border — a shift the spec's 0.5px tolerance does not absorb. A new fifth sibling
test asserts the geometry `renderToStaticMarkup` cannot see: the 8/12/12/12 insets read against computed
tokens (not literal pixels), every body block filling the row's content width including a shell call's
command block, the error retint living on the row's border rather than the chip's (asserted comparatively
against a resolved row, so a token retune can't redden it), and the focus ring's negative
`outline-offset`. One implementation-time correction: the design's insets land on the body's *content*
box, not its border box, since the body itself supplies the padding — the first draft measured the wrong
box and read 0 where it expected 12.

**One Figma deviation, observed and deliberately deferred to #1103** (below): the node gives `Body` a 12px
gap between `Fields` and the result; `.tool-row__body` still used its existing 8px (`--space-2`) at the
time this slice shipped. That, and the result's own fill and type, were #1103's — this slice only moved the
box and the body's outer insets.

**Unblocks [#1073](https://github.com/pyrycode/pyrycode-desktop/issues/1073)** (joining consecutive tool
rows into one stack by overlapping their borders 1px), which wants a border on `.tool-row` and was
natively blocked while that border lived on the chip.

No `docs/knowledge/codebase/1102.md` — that directory was frozen 2026-08-26, and this section is #1102's
only home.

## Expanded tool row body: fields and result take the design (#1103)

Draws what #1102 moved the box around: the field value's own filled box, and the result as bare text under
it, from `Tool row` `155:553`'s `Body` frame (Figma `152:5215`). The joined `.tool-row__result,
.tool-row__input-value` rule (#706) splits along the one seam the design actually draws — the value box
**is** the result block plus a box, nothing else differs — so the selector keeps the nine declarations
still common in substance (`margin`, `max-height: 240px`, `overflow: auto`, `white-space: pre`, the mono
quartet, `--color-on-surface`) and `.tool-row__input-value` alone adds `padding: var(--space-3)
var(--space-4)`, `background: var(--color-surface-container-high)`, `border-radius: var(--radius-xs)` —
`.code-block__body`'s own pairing, taken rather than re-derived, since the design's `Body` leads with an
instance of that same `Code` component. Keeping the join (rather than two independent rules) preserves
\#706's "the field list takes the result block's visual language" as a fact by construction over nine
declarations instead of a claim two rule bodies could drift out of.

**Three token decisions, each stated on the rule rather than inherited.** The leading moves 16 → 20 via
`--text-code-body-line`, the token #721 minted for the fenced code body — not a bare `20px` and not a
second name for the same value. The type run widens from two tokens to the full quartet (adding
`--text-body-small-tracking`/`-weight`), so the value and result stop sitting at the UA's
`letter-spacing: normal` while their mono neighbours (`.code-block__body` above, `.tool-row__input-name`
stacked directly on top inside the same field) draw at body-small's tracking — nobody had chosen that
difference. And `--color-on-surface` is confirmed as the design's `Schemes/On Background` (`#e0e2e8`), read
rather than inherited; no `--color-on-background` token was added for the duplicate value.

**The body's two rhythms are the gap plus one correction, not a wrapper.** `.tool-row__body`'s gap moved
`--space-2` → `--space-3` (12px, the design's `Body` gap); `.tool-row__input + .tool-row__input { margin-top:
calc(var(--space-2) - var(--space-3)) }` corrects the one pair the design draws tighter (8px, the nested
`Fields` frame) back down — `+` cannot match a first child and flex items never margin-collapse, so the
correction reaches only consecutive fields. `ToolRow` renders the field list as a bare `.map()` with no
wrapper and no `.length > 0` guard on purpose: an empty array renders nothing, so "an absent, empty or
fully carved-out map draws no field list and no empty container" stays structural rather than a second
condition that could drift. A `.tool-row__fields` wrapper would have bought the same two distances at the
cost of that invariant — and the three assertions that police it
(`ConversationScreen.test.tsx`'s `not.toContain('tool-row__input')`) would not have caught the regression,
since they're substring checks a differently-named wrapper walks straight past. The fix is a detector
rather than a rule: a new case pins the empty-map body as one byte-exact contiguous run
(`<div class="tool-row__body"><pre class="tool-row__result">…</pre></div>`), which reddens on any
introduced element regardless of its name.

**The error rule is deleted, not retuned.** `.tool-row__body--error .tool-row__result`'s 1px
`--color-error` border would draw a red rectangle around loose text now that the result carries no box; the
failure device has been `.tool-row--error`'s border retint since #1102, so this removes a second device
rather than the last one. `tool-row__body--error` stays on `ToolRow`'s markup as the body's own failure
hook — two `ConversationScreen.test.tsx` substring assertions pin it, and dropping it would be markup churn
with no visual gain.

**`--space-bubble-x` is down to one consumer**, `.unrecognized-row__raw`; `.bubble`'s comment enumerating
both was corrected in the same edit rather than left to claim a consumer that moved off it.

**Splitting a shared declaration set is where a hostile-payload bound gets silently dropped.**
`max-height: 240px` + `overflow: auto` bound both a 64KB result and a 4000-rune input value. The
natural-looking edit — give the value box its own rule carrying the new box properties — invites taking the
cap along with them. Keeping it on the still-shared selector, and asserting it on both classes in
`e2e/tool-row-toggle.spec.ts` rather than only on the result, is what makes that unreachable instead of
merely avoided.

**Testing.** `e2e/tool-row-toggle.spec.ts` gains a sixth sibling test (its own `launchPairedApp`, two rows —
a plain call with two input fields and a failed shell call) covering: the value box's fill, four paddings,
corner, size and leading, each read off the row's own custom properties rather than a literal; the result's
absent fill (`rgba(0, 0, 0, 0)`), zero corner and zero padding on all four sides, plus its fit across the
body's full content width; both gaps, measured between adjacent bounding boxes rather than read off a `gap`
declaration, which is what makes the assertion indifferent to wrapper-vs-correction; the failed result's
zero border width on all four sides against the row's still-differing border colour (comparative, so a
token retune can't redden it); and that the cap, both overflow axes and `white-space: pre` survive on both
classes, alongside the shell call's `.code-block__body` treatment leading the body unchanged.
\#1102's `.tool-row__body > *` geometry test needed no edit — with no wrapper introduced it matches the same
elements it did before, though the result losing 24px of padding does change the height of the last block,
which the test reads live rather than assumes.

Code review: PASS, two non-blocking NITs — an e2e helper's explicit return-type annotation widening away
the literal 18-key shape `evaluate` actually returns (so a mistyped key would compile and only surface as a
puzzling `undefined` at assertion time, worse here than elsewhere since nothing in this repo typechecks
`e2e/` in any gate); and a distance citation ("already on screen 1150 lines up") with the same drift problem
as the stale `:2536`/`:2538` line numbers this same edit replaced with symbol names two rules above. See PR
\#1105 for the full record; there is no `docs/knowledge/codebase/1103.md` — that directory was frozen
2026-08-26, and this section is #1103's only home.
