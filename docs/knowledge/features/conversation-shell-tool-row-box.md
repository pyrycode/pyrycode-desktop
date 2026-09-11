# Conversation shell — tool row box

Split out of [Conversation shell — tool row layout](conversation-shell-tool-row-layout.md) on 2026-09-05 to
keep every section under the size cap; see that document for the layout arc as a whole and
[Conversation shell](conversation-shell.md) for the screen itself.

## Full-width bordered tool row (#722)

Restyles the chip from the mobile mock's hug-width pill to the desktop design's full-width bordered box
(Figma `134:4939`) — the same treatment `.code-block` (#721) already ships, adopted rather than invented.
CSS and one theme token only: the markup, the class names and the collapsed prefix are byte-stable, so
every existing tool-row assertion in `ConversationScreen.test.tsx` passed unedited. The third run (a
per-call count) and the chevron that the redrawn Figma component (`155-553`) also draws were held for
\#773/#774 at the time — the chevron shipped in [#854](conversation-shell-tool-row-header-groups.md#tool-row-header-groups-854) (split from #774), the
count is [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856); the expanded body
(`.tool-row__result`, and the `.code-block` #780 puts inside it) is untouched and deliberately not redrawn
here.

**The width mechanic**, the one part with consequences. `.tool-row` was already a stretch item of
`.conversation__thread`'s flex column — the row was always full width, only the chip hugged.
`.tool-row__chip`'s `max-width: 100%` (a ceiling on a hug-width box) becomes `width: 100%`, with
`box-sizing: border-box` added alongside it (`index.css` sets no global box-sizing; `.paired-shell:20-22`
is the file-family precedent for stating it at the call site), and both land on the *base* rule so they
reach the `<button>` and the `<div>` branches identically — that's what makes a resolving row not shift,
pinned by three new width assertions in `e2e/tool-row-toggle.spec.ts` (pending vs. resolved vs. expanded,
each compared against the row's own width with a 0.5px float tolerance), since a rendered width is
invisible to the `renderToStaticMarkup` unit tier. `.tool-row__chip--toggle`'s `box-sizing: content-box` —
held there specifically so `max-width: 100%` bounded both branches alike — is deleted rather than flipped,
since under `width: 100%` it would be exactly backwards: the button would overflow its row by 2×12px
padding plus 2×1px border.

`width: 100%`, not a flex remedy: `.tool-row` flips `flex-direction` between collapsed (`row`) and
expanded (`column`), so `flex: 1` would fill the row collapsed but grow the chip *vertically* expanded,
and `align-self: stretch` would do the reverse. The direction-agnostic form is what `.status-row` and
`.unrecognized-row__summary` already use for the same job, and the e2e's expanded-state assertion is the
one that would go red under a flex-based remedy.

**`.tool-row--expanded`'s `align-items: flex-start` stays, its reason doesn't.** It used to be
load-bearing because `stretch` would blow the hug-width pill out to the full row — the thing this ticket
now wants, so that reason is dead. It survives for a different one: `.tool-row__body` is the column's
*other* child, and under `stretch` the body (and the `.code-block` #780 puts inside it) would go full
width too — a change to the expanded body, which stays #774's. The chip itself is unaffected either way,
since it now carries its own `width: 100%`. **The general lesson, not just this rule's:** three shipped
comments in this region argued *against* the box this ticket builds, and two of the declarations they
guarded still had to stay, for different reasons than the stale comment gave. Grep the region's comments
for the property being changed before changing it, rather than assuming a comment's presence still matches
its reasoning.

**The box treatment**, every value a token, read off the Figma variables rather than assumed: fill
`--color-surface` (the thread's own background — no separate fill step); border colour
`--color-outline-variant` → `--color-primary-container`; corner `--radius-sm` (12px) → `--radius-xs`
(6px); run gap `--space-2` → `--space-3` (8px → 12px, padding unchanged). Both type runs move onto
`--text-body-medium-*`; the headline's ink lifts `--color-on-surface-variant` → `--color-on-surface`. The
design's primary-container variable prints `#134a74`, which agrees with the dark token — no
light-scheme-fallback transposition to correct here, unlike the trap `--color-inverse-primary` and
`.code-block`'s own comment warn about elsewhere in this file.

**One new token**, `--text-tool-name-line: 16px` in `tokens.css`, immediately after `--text-code-body-line`
— the same shape for the same reason. The tool-name run's 14/16 is bound to no type style in Figma, and no
14px step in the scale carries a 16px line (`body-medium` and `label-large` both pair 14px with 20px; 16px
belongs only to a 12px or 11px step). Borrowing `--text-body-small-line` would couple a 14px run to a 12px
step's quartet for no reason beyond convenience. There is no `--text-tool-name-size`: the size is
`--text-body-medium-size`, the same step the sans sibling run takes whole.

**The hover fill moved with the resting one.** Resting dropped `--color-surface-container` →
`--color-surface`, so the outgoing hover value (`--color-surface-container-highest`, two rungs up the
ladder) would have become a three-rung jump. `.status-row:hover` had already answered this exact
question — a full-width `<button>` resting on `--color-surface` and hovering to
`--color-surface-container` — so that value is taken rather than picked fresh: one ladder rung, and still
a visible step over the now-unfilled resting background.

**What the ticket held, and how each survives untouched:** the pending row's 50% dimming
(`.tool-row { opacity: 0.5 }` / `.tool-row--resolved`, neither edited) and its `<div>` fork (TSX, not
edited); the error border (`.tool-row--error .tool-row__chip`, not edited, still outspecifying the base
rule at (0,2,0) against (0,1,0) — `.tool-row__chip--toggle` still declares no `border` in any form, which
is the one thing that would silently kill the error accent on every failed row if it ever did); the
headline's single-line ellipsis (`min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` +
`white-space: nowrap`, all unchanged — a wider box gives an untrusted string more room, it does not make
the geometric bound optional, and `nowrap` still collapses an embedded newline to a space so it cannot
break the row).

Code review: PASS, four non-blocking NITs. Two are worth carrying forward rather than re-discovering: the
new border's contrast against the surface fill, `--color-primary-container` on `--color-surface`, computes
to roughly 1.97:1 — under WCAG 1.4.11's 3:1 for a UI-component boundary. Not gating (the design binds the
value, the outgoing pairing was comparably low, and `.code-block`'s "decorative chrome, not a state-bearing
graphic" ruling from #721 already covers the identical case) — but this box goes from decorative to
interactive once resolved, unlike `.code-block`, so it was flagged for whoever adds the chevron. [#854](conversation-shell-tool-row-header-groups.md#tool-row-header-groups-854)
shipped the chevron without touching the border; the contrast question is still open.
The other: `.conversation__workspace-chip-pill`'s comment (`:159`, outside the edited region) still cites
"the `.tool-row__chip` idiom (inline-flex, `--space-2` gap, `--space-2`/`--space-3` padding,
max-width/min-width/overflow…)" — that idiom moved under this ticket (`--space-3` gap, `width: 100%`,
`--radius-xs`) and the chip is no longer a pill at all. Nothing regresses visually, since the two rules
hold independent declarations, but the citation now points at a shape the tool-row region no longer draws.

See PR #846 for the full record; there is no `docs/knowledge/codebase/722.md` — that directory was frozen
2026-08-26, and this section is #722's only home.

## The shadow (the 2026-09-05 shadow fix)

`.tool-row` gains `box-shadow: var(--shadow-thread)`, the one drop shadow every element of the desktop
message area casts (Figma "Tool use" 134:4939; X 0, Y 4, blur 5, spread 0, black at 20% — the token and
the blur-doubling trap are described under
[message bubble § The shadow](conversation-shell-message-bubble.md#the-shadow-the-2026-09-05-shadow-fix)).
The design puts it on each single row and once on the grouped stack (384:7103).
[#1073](#consecutive-tool-rows-join-into-one-stack-1073) draws that group: a row with a tool-row successor
now computes `box-shadow: none` and only a run's last row keeps it, so a run of any length still casts
exactly one, cast by its last row rather than its first (the design's group shadow visually belongs to the
bottom of the stack, and an outer shadow starting 1.5px below its own border box cannot reach back up
across the join above it). A lone row, with no successor to suppress it, is untouched by that rule and
keeps casting its own — which is what `e2e/thread-shadow.spec.ts` reads on a pending row. The row's own
`overflow: hidden` does not clip it — an element's overflow clips descendants, never its own outer shadow —
and the pending row's 50% opacity dims the shadow with the box.

## Consecutive tool rows join into one stack (#1073)

A run of tool rows now draws as one stack with exactly one border line at each join, rather than as
separate boxes 12px apart on `.conversation__thread`'s flex gap. Two selectors carry all of it, each naming
one half of a join — `.tool-row + .tool-row` the lower row, `.tool-row:has(+ .tool-row)` the upper — so a
lone row, or a tool row beside a message bubble, matches neither and is byte-identical to what #1102 already
shipped. The markup does not change: every tool row is already a direct child of the thread's flex column
with no wrapper, so the adjacent-sibling selectors reach exactly the internal joins of a run. `:has()`
shipped in Chromium 105; this app runs Electron 33 (Chromium 130) with no other renderer, so no fallback was
needed.

**The join is a negative margin, not a gap change** — `gap` cannot be varied per pair.
`margin-top: calc(-1 * var(--space-3) - 1px)` on the lower row cancels the column's 12px gap and overlaps
the pair by the border's own 1px, landing both borders on the same pixel band. Tokenised against
`--space-3` rather than written as `-13px`, since the gap must follow that token if it ever moves; the
`1px` stays a literal because it is the border width, not a spacing step.

**A run's internal corners are square; only its outer corners keep the 6px** — Juhana ruled this
2026-09-04. The Figma node for the run (384:7103) is *not* the answer here: it is literally two `Tool use`
instances overlapped, so both keep all four corners and the node's own render shows the resulting artefact,
a notch of thread background where two `--radius-xs` curves face each other across a join. The fix zeroes
the two corners each half of a join shares with the seam (`border-top-left/right-radius: 0` on the lower
row, `border-bottom-left/right-radius: 0` on the upper) — written as the absence of the row's own
`--radius-xs`, not a `--radius-none` token, since a square corner isn't a value in the radius scale.

**The join's border colour is stated as a rule, not left to paint order**, because paint order does not
reliably favour either row. A later sibling paints over an earlier one by default, which would erase a
failed row's red bottom edge against the row below it — but `.tool-row`'s pending `opacity: 0.5` makes a
pending row an atomic paint group that paints above every non-dimmed sibling regardless of DOM order,
which reverses that direction the moment a pending row is one side of the pair. `.tool-row--error +
.tool-row` and `.tool-row:has(+ .tool-row--error)` retint exactly the one edge each neighbour shares with a
failed row to `--color-error`, so the two coincident borders are always the same colour and the drawn line
stops depending on which row happens to paint last. A pending/resolved join needs no such rule: a 50%
border painted over a 100% border of the same colour at the same pixels composites back to full strength,
and a failed row is always `--resolved` too (`tool-row--error` layers only on top of `tool-row--resolved`),
so a dimmed row and a red border are never the same element.

**A run follows visible neighbours.** Legacy, clean-success and cancelled `turnBoundary`
items draw nothing and do not break a tool stack. A [stopped-turn record](conversation-shell-turn-status.md#stopped-turn-records)
or `sessionBoundary` draws an element and ends the stack. With grouped tool wrappers,
the [join scan](conversation-shell-tool-row-header-groups.md#visible-tool-row-joins)
must include that visible stop as well: rendering the label while skipping every
boundary still joins tool cards across it. The stopped-turn static render test
asserts that two tools separated by the label receive no joined-row classes.

**Testing.** All four rendered properties here — adjacency, the corner radii, the computed shadow, the
border colour at a join — are invisible to the `renderToStaticMarkup` unit tier, so `e2e/tool-row-toggle.spec.ts`
gained a seventh sibling test (its own `launchPairedApp`, following the file's one-test-one-page idiom): a
run of four resolved as pending / resolved / failed / resolved reaches every join case in one drive — a
pending/resolved join, a join with the failed row below it, and one with the failed row above it — plus a
non-tool neighbour on the run's leading edge. Expanding a row inside a run (AC5) re-measures the same joins
after toggling the second row open; the three width equalities that guard a resolving row's shape stay in
this file's first, pre-existing test. `e2e/thread-shadow.spec.ts` and `e2e/thread-scroll-pin.spec.ts` each
drive exactly one tool row, so neither forms a run and both keep covering the lone-row case unchanged.

Code review: PASS, one non-blocking NIT (a specificity-accounting typo in the shipped CSS comment — both
join selectors are `(0,2,0)`, not the mixed triple the comment states; the conclusion drawn from it was
already correct). See PR #1211 for the full record; the design is `docs/specs/architecture/1073-consecutive-tool-rows-share-one-border.md`, committed before the code.
