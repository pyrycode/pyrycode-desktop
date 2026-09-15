# #1487 — the workspace row reads its own fold state

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow` — the row this ticket redraws: one
  inline Material `folder` path in flex flow, then the label, then nothing.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `CollapsibleWorkspaceGroup` — owns the `expanded`
  boolean and is the exported seam the unit tier reaches both states through; gains the `children`-derived
  "has rows" read.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderServerTrees` — its `workspaceGroups` closure
  is the sole `CollapsibleWorkspaceGroup` call site and gains no prop; its #1485 comment block is what
  makes an empty group reachable.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace` — the comment block whose
  "the design draws one state and no chevron" paragraph this ticket falsifies, and whose padding/gap sum
  has to be re-derived once the glyph leaves the flow.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-icon`,
  `.channel-list__workspace-head`, `.channel-list__workspace-create`, `.channel-list__workspace-edit` —
  the glyph's current flex rule, the wrapper's 20px nest, and the two absolutely positioned trailing
  controls whose 52px reserve and 45px hit-box edge the chevron must clear.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `workspaceRowTagsIn`, `WORKSPACE_ROW_MARKER`,
  the `CollapsibleWorkspaceGroup (#704)` describe — the tag-slicing helper, the exact-substring marker AC4
  pins, and the `renderGroup(label, defaultExpanded?)` seam both new state cases extend.
- `e2e/sidebar-tree-geometry.spec.ts` → `WORKSPACE_ICON_X`, `WORKSPACE_LABEL_X` — the two drawn offsets
  (card inset + 28, card inset + 50) that must survive the glyph leaving the flow. Read only; untouched.
- `docs/knowledge/features/channel-list-workspace-row-nest.md` — this row's geometry history: why the
  wrapper exists, why the right padding is the Hover variant's 52 in both states, and why the label's
  `min-width: 0` is load-bearing rather than copied.

Codegraph is not initialised in this worktree (`codegraph_context` returns
`CodeGraph not initialized for this project`), so the reading list above came from grep and Read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=399-1039

A 340 × 28 row, `py-[4px] pl-[30px] pr-[32px]`, 6px gap. An open-folder glyph (13 × 11, Font Awesome
`folder-open-solid`, node 510:2214) sits out of flow inside a 20px-tall box at left 8, top 4 — so it is
vertically centred in the row. The label ("Second Brain", M3 title-small = the theme's label-large) starts
at the 30px padding and is followed, at the 6px gap, by a down chevron (node 510:2328): a 20px-tall frame
holding a 7.967 × 3.985 glyph with a 2px top inset. Both marks paint on-surface (#E0E2E8 in the drawn
dark scheme), so both read `currentColor` here.

## Context

`WorkspaceRow` is the disclosure control for a workspace group, and it is drawn identically whether the
group is open or shut — `channels.css`'s own comment above `.channel-list__workspace` says so in as many
words, and says that a collapsed appearance, once designed, styles off `[aria-expanded='false']`. Juhana
redrew the component on 2026-09-15 and it is now designed: the folder glyph opens with the group and a
chevron follows the label, so the fold state reads without a click.

Three things change and one deliberately does not.

1. **The glyph leaves the flex flow.** It becomes absolutely positioned at left 8, which is where the
   wrapper's nest already puts it — this ticket changes how the row is built, not where its parts land.
2. **The glyph swaps with the state**: Font Awesome `folder-open-solid` expanded, the shipped Material
   `folder` path collapsed (Juhana's brief).
3. **A chevron follows the label**, decorative, riding the same `expanded` value.
4. **The right padding stays 52.** The redraw reads the Idle variant's `pr-[32px]`; #1180's reserve of 52
   is the Hover variant's, held in both states so a long label does not re-truncate when the pointer
   arrives. That reasoning is unchanged by this ticket, so the number is unchanged.

The nest itself (the wrapper's 20px) is #1488's, not this ticket's.

No ADR is warranted: this is one row's drawn state, inside a component family the
`channel-list-workspace-row-nest` topic already owns.

## Design

### `WorkspaceRow` (`ChannelList.tsx`)

Signature gains one required boolean beside `expanded`:

```
WorkspaceRow({ label, expanded, hasRows, onToggle, create, edit })
```

`hasRows` names the fact, not the drawing: the chevron is withheld from a group with nothing to fold, and
the row remains the disclosure button in that case — only the mark goes.

Rendered children of the `<button class="channel-list__workspace">`, in order:

1. **The glyph**, one `<svg class="channel-list__workspace-icon">` chosen by `expanded`. Expanded:
   `viewBox="0 0 13 11" width="13" height="11"`, the downloaded `folder-open-solid` path inlined.
   Collapsed: the shipped `viewBox="0 0 24 24" width="12" height="12"` Material `folder` path, byte for
   byte. Both `fill="currentColor"` and `aria-hidden="true"`, both wearing the one class the geometry
   spec locates on.
2. **The label**, `<span class="channel-list__workspace-label">` — untouched.
3. **The chevron**, `<svg class="channel-list__workspace-chevron">` rendered only when `hasRows`:
   `viewBox="0 0 8 4" width="8" height="4"`, the downloaded chevron path inlined, `fill="currentColor"`,
   `aria-hidden="true"`.

No attribute is added to the button itself and `class="channel-list__workspace"` stays a sole token —
`WORKSPACE_ROW_MARKER` is an exact attribute-value substring that a second token would stop matching
silently rather than loudly.

**One glyph for the chevron, rotated off the button's own attribute — not two paths.** The collapsed
direction comes from
`.channel-list__workspace[aria-expanded='false'] .channel-list__workspace-chevron { transform: rotate(-90deg) }`,
the escape the ticket's technical note names as preferred. Three reasons it is the right call here, and
one stated cost:

- `aria-expanded` stays the **sole** state signal, which is what the Context section asks for. A second
  render branch would be a parallel signal that can drift from it; a rotation keyed to the attribute
  cannot.
- The drawing's 2px top inset — the note's stated escape hatch — is **not** misaligned by the rotation.
  The inset resolves to a 1px net downward nudge (below), the rotation is about the element's own centre,
  so the nudged centre is what rotates.
- The reserved layout box stays 8 wide in both states, so the label's truncation point does not move when
  the group is folded.
- **Cost, stated rather than hidden:** the drawn direction is CSS and therefore invisible to
  `renderToStaticMarkup`. What the unit tier proves is that `aria-expanded` carries the right value and
  that the chevron is present — the rotation is one reviewed declaration keyed to an attribute the tier
  pins. This is the same standard the file already holds every other CSS-only visual to (the plus's
  hover reveal, every colour). #1488 reuses the rotation.

### `CollapsibleWorkspaceGroup` (`ChannelList.tsx`)

Derives the flag from what it already holds rather than taking it as a prop —
`hasRows={Children.count(children) > 0}` (`Children` joins the existing `react` import). That is what
keeps the heavily-commented `CollapsibleWorkspaceGroup` call site in `renderServerTrees` untouched, which
AC5 requires. #1488 rules the other way for the host row because a `<Fragment>`'s children cannot be
counted; the two are not in conflict.

The sole production caller passes `group.rows.map(renderRow)`, an array that is empty exactly when #1485's
union gave this tree a group whose rows all live in the other one. `Children.count` reads an empty array
as 0.

### `channels.css`

`.channel-list__workspace` gains `position: relative` — the glyph must be positioned against the **button**
and not against `.channel-list__workspace-head`, which is already `position: relative` for the plus and
the pen and whose left edge is 30px to the left of the label. The button has no border, so its padding box
starts at the wrapper's own left edge and `left: var(--space-2)` lands the glyph at the wrapper's nest + 8,
exactly where it sits today. `position: relative` with `z-index: auto` opens no stacking context, so the
plus and pen (siblings of the button, not descendants) are untouched.

Three retuned numbers on the same rule, each written as a sum in the file's idiom:

| declaration | from | to | derivation |
|---|---|---|---|
| `gap` | `calc(--space-2 + 2px)` = 10 | `calc(--space-1 + 2px)` = 6 | the drawn `gap-[6px]`; with the glyph out of flow the gap now falls between the label and the chevron |
| `padding-left` | `--space-2` = 8 | `calc(--space-7 + 2px)` = 30 | the drawn `pl-[30px]`, and the same 30 the old 8 + 12 + 10 already summed to — which is why the label does not move |
| `padding-right` | `calc(--space-8 + --space-5)` = 52 | unchanged | #1180's reserve; the redraw's 32 is the Idle variant's and is not taken |

`.channel-list__workspace-icon` drops `flex: 0 0 auto` (meaningless out of flow) and becomes
`position: absolute; left: var(--space-2); top: 50%; transform: translateY(-50%)`. Centring by percentage
rather than by a literal reproduces the drawing's 20px-tall box at top 4 exactly for the 11px open glyph
(top 8.5) and leaves the 12px closed glyph where flex centring already put it (top 8).

`.channel-list__workspace-chevron` is new: `flex: 0 0 auto` so a long `cwd` truncates before it ever does,
`display: block` (the file's icon convention), and `margin-top: 2px`. That last is the drawing's own
number, not a nudge invented here: a 2px top inset inside a `justify-center` box lands the glyph 1px below
the frame's centre, and a 2px top margin on a `center`-aligned flex item lands its border box 1px below
the row's centre — the same 1px, from the same 2.

Its box spans the 8px ending at the label's content edge, which is 52 in from the row's trailing edge; the
pen's hit box starts at 45. The two never meet, which is the same clearance the label already has.

Rotation rule specificity is (0,3,0) over the base rule's (0,1,0).

### What does not change

`renderServerTrees` — no prop, no argument, no closure. `WORKSPACE_ROW_MARKER`,
`WORKSPACE_HEAD_MARKER`, the two create markers and the edit marker. `e2e/sidebar-tree-geometry.spec.ts`.
The wrapper's 20px nest (#1488's).

## State + concurrency model

None added. `CollapsibleWorkspaceGroup`'s single `useState` boolean is the whole of the state and this
ticket neither reads it differently nor writes it at all; `hasRows` is derived per render from `children`.
No store slice, no async work, no subscription, so nothing to cancel or tear down.

## Error handling

No new failure mode: no I/O, no IPC, no parse, no daemon value reaching a new sink. The daemon-derived
workspace label stays exactly where it is — an escaped React child of the label span — and reaches no
attribute of the button, the glyph or the chevron, on the four-sink rule `WorkspaceRow`'s header already
states. Neither new element carries text, an `aria-label` or a `title`.

## Testing strategy

Vitest, node environment, `renderToStaticMarkup` — the whole of it. The ticket rules out a DOM environment
and rules out a new e2e spec: the toggle is shipped behaviour this ticket does not change, and the drawn
offsets are already driven by `e2e/sidebar-tree-geometry.spec.ts`, which must pass unchanged.

New cases in `ChannelList.test.tsx`, in the existing `CollapsibleWorkspaceGroup (#704)` describe, reached
through its `renderGroup(label, defaultExpanded?)` helper (extended to take the group's children so the
empty case is reachable):

- **Expanded (AC1)** — the markup carries the open glyph's whole `<svg>` opening run and not the closed
  one's; the chevron's opening run is present. Opening runs rather than a width alone, the file's idiom:
  one marker fixes the class, the viewBox, both box dimensions, the `currentColor` fill and the
  `aria-hidden` together.
- **Collapsed (AC1)** — the reverse: the closed glyph's run, not the open one's, and the chevron still
  drawn.
- **The button's tag is untouched by either (AC4)** — the shipped
  `changes nothing but the state attribute between the two shapes` equality still holds byte for byte, and
  `countOf(markup, WORKSPACE_ROW_MARKER)` stays 1 per group. Re-asserted rather than assumed, because the
  glyph swap is the exact edit that could put a class modifier on the button.
- **Neither mark speaks (AC4)** — both svgs carry `aria-hidden="true"`; the row's accessible name, read
  back out of the render, is the label and nothing more.
- **An empty group draws no chevron, in either state (AC5)** — `renderGroup` with no children at both
  `defaultExpanded` values: the workspace row is still there, still the disclosure, and the chevron's
  class appears zero times.
- **A group with rows draws exactly one chevron**, so the empty case is a withhold rather than a count
  that was always zero.

Gate: `npm test -- src/renderer/src/screens/channels/ChannelList.test.tsx` and `npm run build`.

Visual: a static capture of `CollapsibleWorkspaceGroup` at both `defaultExpanded` values, compared against
the Figma screenshot per `docs/visual-review.md`. Static markup is not visual evidence, and the absolute
positioning is exactly the class of change a markup assertion cannot see.

## Documentation handoff

Pending for the documentation stage, not done here:

- `docs/knowledge/features/channel-list-workspace-row-nest.md` — fold-state reading folded in, and the
  record corrected that the row is drawn identically in both disclosure states.
- Same topic — the withheld chevron on an empty workspace group recorded as the visible half of #1485's
  union.

## Revisions

**2026-09-15 — `.channel-list__workspace-label` drops its `flex-grow`, `1 1 auto` → `0 1 auto`.**

The ticket's technical notes say the label keeps `flex: 1 1 auto`, and the Design above took that as given.
The first static capture showed why it cannot stand: a grown label fills the row, so the chevron rendered
~230px right of "Second Brain", parked against the trailing padding. The drawing packs the two against
each other at the 6px gap — 399:1039's items are `shrink-0` and start-packed, with no spacer between them
— which is what AC3's "sits after the label at a 6px gap" describes. While nothing followed the label the
grow was invisible (left-aligned text draws the same in a stretched box), which is why it survived #1178
unnoticed.

`0 1 auto` keeps everything the note was protecting: the shrink and `min-width: 0` are what "a long `cwd`
truncates first" actually rests on, and they are untouched, so the label still gives — and gives before
the chevron's `0 0 auto` can. The button's own `flex: 1 1 auto` is a different declaration and stays, so
the row's click target still spans to the wrapper's far edge and the dead space right of the chevron
still toggles.

Checked against every consumer of the class before changing it: `e2e/sidebar-tree-geometry.spec.ts` reads
the label's `.x` only, and the other nine specs that locate on it filter by text, count, hover or click —
none reads its width.

## Open questions

- **Does the chevron's 8px layout box crowd the pen at 45?** **Resolved — no.** The arithmetic said the
  label's content edge is 52 in against the pen's 45, and the capture confirms it: the truncated long
  label's chevron ends 52 in from the card's content edge.
- **Is `Children.count` or `Children.toArray(children).length` the right read?** **Resolved —
  `Children.count`.** The sole caller passes `group.rows.map(renderRow)`, where the two agree, and `count`
  additionally reads a single non-array element as 1 without the call site having to wrap it. The unit
  tier renders the production shape (an empty array) rather than a `null` stand-in, so the case that
  ships is the case asserted.
