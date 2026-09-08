# #1190 — hovering the host row's pen or plus names it in a pill

The host row's two trailing controls are bare glyphs that appear together on the row's hover (#1185,
live since #1299 and #1308). This slice names them: hovering or keyboard-focusing one shows the shipped
`.channel-list__control-name` pill reading that control's own name, so two blue marks 10px apart tell a
pointer which is which before it clicks.

A short plan, because the change is small and adds no type, no state and no failure mode: two `<span>`s
and four selectors that flip one property. The one paragraph that is not small is the placement, which
the ticket asks to be checked for clipping rather than assumed.

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRow` — the two icon-only buttons each
  gaining one child, and `EDIT_HOST_CONTROL_LABEL` / `ADD_WORKSPACE_CONTROL_LABEL` above it. **Both
  constants already exist** and already feed the `aria-label`s; the ticket's "lifted so both use one
  definition" is done, so this ticket adds a second reader rather than a constant.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__control-name` — the shipped pill
  block (#1172), reused with no declaration added; `.channel-list__host-edit` and
  `.channel-list__host-add` — the two controls, each `position: absolute` (so each is already a
  containing block) and a 20px box at `top: var(--space-1)` down the 28px `.channel-list__host`.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-edit`'s and
  `.channel-list__workspace-create`'s trigger pairs (#1180/#1181) — the same two controls one level up
  the tree, at the same size and inset down the same 28px row. This ticket is those two rules with the
  ancestor changed, which is why it adds no geometry.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__pair`'s pill override (#1304) —
  the one place the band placement was NOT reused, and the measurement of why: the sticky
  `.channel-list__actions` cluster resolves its `top` against the scrollport's content box and so lands
  4px *inside* the Channels section header. Read because the ticket names this exact hazard.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the `#1185` block's `EDIT_MARKER` /
  `ADD_MARKER` / `EDIT_ICON_MARKER` / `ADD_ICON_MARKER` / `HOST_NAME` assertions — the runs a new child
  element must leave byte-identical, and the `countOf(markup, HOST_NAME) === 1` guard a text node near
  this subtree could break.
- `e2e/host-row-hover-controls.spec.ts` — the host-row drive shape, `HOST_ROW_COUNT`, and the reason the
  pointer is parked on `.channel-list__actions` before any "at rest" read.
- `e2e/sidebar-workspace-plus-name-pill.spec.ts` — the sibling pill drive: the containment criterion,
  the band assertion, `allHidden`, and the Tab-not-`focus()` reasoning for `:focus-visible`.
- `docs/specs/architecture/1172-row-control-name-pill.md` — the pill's structured design context, the
  transposed-colour trap, and the two measured revisions on which assertion detects a wrong placement.

## Design source

**Pill:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617
**Host row:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2966 (Hover `405:7920`)

The Pill node is a 148 × 24 single-line label box: dark navy ground, light blue ink at body-small, a
small corner radius, hugging its text with no wrap. The Hover host row is 360 × 28 — the rack glyph, the
machine label, and at the trailing edge the pen then the plus, both filled `--color-primary` and **drawn
bare**: the node itself puts no tooltip on either control, so the Pill is a treatment borrowed onto them,
exactly as the ticket instructs.

`get_design_context` was **not** re-run on the Pill. #1172 already derived that node into
`.channel-list__control-name` — including the trap that the export transposes
`--color-primary-container` and `--color-on-primary-container`, which the screenshot above settles the
same way (dark ground, light ink) — and this ticket adds no drawing declaration for a fresh derivation
to inform. The two screenshots are the visual check.

## Change

`HostRow` gives each of its two buttons one child, **appended after the `</svg>`**:

```
<span className="channel-list__control-name" aria-hidden="true">{EDIT_HOST_CONTROL_LABEL}</span>
```

…and the plus the same with `ADD_WORKSPACE_CONTROL_LABEL`. Appending is load-bearing for the static
tier: `ChannelList.test.tsx` pins each glyph's whole opening run, and a child after the closing tag
leaves it byte-identical. The pill's text is a bare text node, not an `aria-label="…"` run, so
`EDIT_NAME_MARKER` / `ADD_NAME_MARKER` and their counts are untouched. `aria-hidden` is belt-and-braces
rather than the mechanism — a button's `aria-label` already overrides child text for the accessible name
— which is why it needs pinning: nothing else in either tier reddens if it is dropped.

`channels.css` gains **four selectors and one declaration**, written as two pairs beside the control each
names, which is this file's convention (#1180, #1181, #1304 each did the same rather than joining one
growing list):

```
.channel-list__host-edit:hover  .channel-list__control-name,
.channel-list__host-edit:focus-visible  .channel-list__control-name { display: block }
```

The control's **own** `:hover`, never the row's — that is the whole of AC1's "hovering the row's label
shows nothing", and a deliberately different scope from the glyph's reveal, which hangs off the row so
the glyph is already there when the pointer arrives at a 20px box it could not otherwise see.
`:focus-visible` and not `:focus`, matching each control's own opacity rule, so the keyboard case cannot
half-fire. The ticket's estimate said "no new CSS"; four selectors are needed because
`.channel-list__control-name` is `display: none` until a named trigger says otherwise.

Nothing else moves. No new constant, no new class, no `max-width` (both strings are client-owned
compile-time constants, so the composer pill's ellipsis chain would defend a case that cannot occur), no
store, no effect, no IPC, no daemon-derived string anywhere near it, and so no log line and no failure
mode.

### Placement, and the clipping check the ticket asks for

**The band placement is reused verbatim — no override.** The shared block is `right: 0; top: 50%;
transform: translateY(-50%)`, resolved against the control, which is `position: absolute` and so already
a containing block. Each control is a 20px box at `--space-1` down a 28px host row, so its centre **is**
the row's centre, and the 24px pill (`--space-1` + the 16px body-small line + `--space-1`) spans 2…26 of
that 28 — inside the row's own band. This is `.channel-list__workspace-edit`'s and
`.channel-list__workspace-create`'s argument one level up the tree, unchanged, because the two rows have
the same height and the two controls the same box and inset.

Containment inside `.channel-list` (which is `overflow-y: auto` and so clips on both axes) then follows
from **the row being in view**, at any scroll position, rather than from the rows a drive happens to
park on. `right: 0` pins each pill to its own control's right edge, so both grow leftward and reach
neither horizontal edge — and an out-of-flow box adds scrollable overflow only rightward or downward, so
the sidebar gains no horizontal scroll.

**The Channels host row at scroll top clears the sticky cluster, so #1172's fallback is not taken.** The
hazard is real and is #1304's: `.channel-list__actions` is `position: sticky; top: var(--space-1);
z-index: 1`, and that offset resolves against the scrollport's content box, so at scroll top the
cluster's bottom edge lands 4px *inside* the Channels section header rather than on its top edge —
which is why the header's own plus had to hang its pill below itself. The host row is one whole header
box further down: the header is its 20px content line plus 12px of bottom padding, and
`.channel-list__section-header + .channel-list__host` takes no margin, so the first host row's band
starts a full 32px below the header's top and the pill's top edge sits ~30px below the cluster's bottom.
The band placement therefore does **not** collide here, and `top: 100%` would push the pill down into
the workspace row under it for no reason.

That clearance is a prediction, and the e2e spec below makes it a measurement: it reads the cluster's
bottom edge and this pill's top edge at runtime and asserts the relation, so a cluster that grew or a
sticky offset that changed reddens rather than silently reopening the overlap. If the measurement had
come back the other way, #1304's `top: 100%; transform: none` override is the fallback the ticket names.

**The cost, stated rather than hidden.** While the plus is hovered its ~116px pill covers the pen's glyph
and the trailing part of the machine label; the pen's ~76px pill ends 25px short of the card edge and
covers only label. Accepted on #1172's and #1181's precedent — each is up only while the pointer sits on
a 20px control, and `pointer-events: none` on the shared block is what lets a click aimed at the row, or
Playwright's hit test on the drives that click these controls without hovering first, read straight
through it.

## Testing strategy

**Unit — `ChannelList.test.tsx`**, in the existing `#1185` block, the static tier's whole share (the
reveal, the drawing and the box all need a layout engine): each pill asserted as the closing-tag
**adjacency** `</svg><span class="channel-list__control-name" aria-hidden="true">Edit host</span>`, which
is the detector for the one placement that would break the shipped tier — a pill in front of the glyph
reddens the pinned opening run, and a pill promoted to a sibling of the button would still contain both
substrings and only this assertion says otherwise. Plus the drift guard, counted: a row drawing one
control carries exactly one pill and its words equal that control's `aria-label`. The block's shipped
marker counts and its `HOST_NAME`-occurs-once guard are re-run, not edited.

**E2E — `e2e/sidebar-host-row-control-name-pill.spec.ts`** (new, fake transport). A dedicated file on
#1181's precedent — the three shipped pill specs must pass untouched and none of their seeds addresses a
host row. One launch, one continuous drive, on the fixture's default seed, which already draws both host
rows (`host-row-hover-controls.spec.ts` pins that at `HOST_ROW_COUNT`); the Channels row is the topmost,
asserted by comparing the two rows' `y` rather than trusted from `.first()`. Every absence read is
ordered after a positive, auto-waiting read of the same gesture's own effect. In order: both pills
mounted and hidden with the pointer parked on the actions cluster; hover the pen → its pill visible,
text exactly `Edit host`, the other three still hidden as a whole-set read; the band (24px tall, centred
on the row's centre, right edge on the control's), the ACTIONS-EDGE clearance, containment inside
`.channel-list`, and — read while a pill is up — the sidebar still 400px with no horizontal scroll;
hover the plus → text exactly `Add workspace`; hover the host **label** → all hidden, the scoping clause;
pointer off the list → hidden; keyboard, reached by focusing the Channels header's `.channel-list__pair`
and pressing `Tab` (never `locator.focus()` — `:focus-visible` is Chromium's keyboard-modality
heuristic), pen focused and its pill up, blur hides it; and a plain click on the pen with no hover first
still opens the Edit host dialog, which is what a pill swallowing the hit test would break.

**Collision check, run at plan time** (#1265's rework lesson, keyed on the criterion rather than the
symbol): both new text nodes grepped across `e2e/`. Three hits, all clear —
`host-row-hover-controls.spec.ts` and `sidebar-add-workspace.spec.ts` read both strings through
`getByRole('button', { name })`, an accessible-name query that an `aria-hidden` child cannot change, so
their counts are unmoved; `sidebar-host-edit.spec.ts` reads `Edit host` off `.edit-host__title`, a
class-scoped locator disjoint from the sidebar. No text-shaped query (`getByText` / `toContainText` /
`hasText`) reaches either string. No spec is edited.

Real-daemon and real-claude tiers are untouched. No ADR is warranted: this adds no decision the token
layer and #1172's page do not already record.

## Open questions

- None. The one the ticket raised — whether the Channels host row clips at scroll top — is answered
  above and is measured by the spec rather than left to the implementation.
