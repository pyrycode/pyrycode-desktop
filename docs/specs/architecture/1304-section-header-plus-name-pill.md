# #1304 — the section header's plus names itself in a pill

The fourth control in the sidebar to wear `.channel-list__control-name`. The pill, its treatment and its
two conventions are shipped; what this ticket owes is one span, one trigger rule, and a **placement
decision the three shipped instances did not have to make** — the Channels header's plus is the first
pill-wearing control with a sticky neighbour directly above it.

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `SectionHeader`, `PAIR_NEW_HOST_CONTROL_LABEL` —
  the button the span goes inside, and the constant its text must be (never a second literal).
- `src/renderer/src/screens/channels/ChannelList.tsx` → `CollapsibleWorkspaceGroup`'s create button — the
  span's shipped shape, appended *after* the `<svg>` and `aria-hidden`.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelListView`, `renderBody` — establishes that
  `.channel-list__actions` is the **immediately preceding sibling** of the Channels `SectionHeader`, with
  no element, gap or margin between them. This is the whole of the placement problem below.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__control-name` — the pill block, and
  its ⭐ paragraphs on the transposed colour export, on `display: none`/`block` over opacity, and on
  `pointer-events: none`. Read before writing, per the ticket.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-create:hover …` — #1181's
  trigger pair, written beside its control: the form this ticket copies.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__pair`, `.channel-list__actions`,
  `.channel-list__section-header`, `.channel-list` — the four boxes the placement arithmetic runs on.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the `#1303` describe block, `PAIR_NEW_HOST_MARKER`,
  `pairTagsIn` — what the static tier already pins and what a child element must leave byte-identical.
- `e2e/sidebar-workspace-plus-name-pill.spec.ts` — the model for the new spec, band and containment reads
  included.
- `e2e/sidebar-control-name-pill.spec.ts` → its `pills` locator, already `.channel-list__row …`, and
  `e2e/sidebar-workspace-plus-name-pill.spec.ts` → its own, already `.channel-list__workspace-create …`.
  Both are scoped to their own controls, so **neither needs the edit #1181 needed** (AC4 verifies it).
- `docs/knowledge/features/channel-list-section-header-pair-control.md` — #1303's own record; its
  "Geometry" section is where the 20px box on a 20px line and the untouched 32px rhythm come from.

## Design source

**Figma:** Pill https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617 · header
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2966

The Pill is a one-line `M3/body/small` label — 12px on a 16px line, tracking 0.4, weight 400 — in
`--color-on-primary-container` ink on a `--color-primary-container` ground, `4px 8px` padding, 6px
corners, no border and no shadow. **Read by name; the export's hexes are transposed** and the node's own
screenshot settles it (dark ground, light ink) — checked again for this ticket, `get_design_context` still
prints `#cfe4ff` under `primary-container`. The header node draws the plus at rest at the header's right
edge and draws **no pill at all**: the drawing does not pin this pill's placement, so the criterion does.

## Change

`SectionHeader`'s button gains a `<span className="channel-list__control-name" aria-hidden="true">` after
the `<svg>`, its text `PAIR_NEW_HOST_CONTROL_LABEL` — the same constant the `aria-label` reads, so the
spoken name and the drawn one cannot drift. `channels.css` gains a trigger pair beside
`.channel-list__pair` (`:hover` and `:focus-visible` on the **control**, never the header), plus a
two-declaration placement override on the pill inside that control. Nothing else moves: the class is
reused rather than forked, the row and workspace pills are untouched, and the header's own attribute run,
the plus's box and the 32px header→first-host rhythm are all out of the diff.

### The placement, which is a stated deviation from the three shipped instances

The shipped placement is the control's own band, right-aligned: `top: 50%; translateY(-50%)`. Here it
**collides**, and the collision is arithmetic rather than a guess:

- `.channel-list__actions` is the Channels header's immediately preceding sibling in a gapless flex
  column with no margin on either, so at scroll top the cluster's bottom edge **is** the header's top edge.
- The plus is a 20px box at `top: 0` of that header; the pill is 24px (`--space-1` + the 16px body-small
  line + `--space-1`). Band-centring puts its top edge 2px *above* the plus's — 2px inside the cluster,
  which is sticky at `z-index: 1` and paints over it.
- Horizontally there is no escape either: the cluster insets only `--space-1` from the content right
  edge, and the pill grows leftward across its full width from that same edge.

So the pill is **top-aligned to its control** instead: `top: 0; transform: none`, overriding exactly the
two declarations that place it and inheriting every other one. Its top edge then coincides with the
plus's, which is the header's, which is the cluster's bottom edge — a zero-area touch rather than a 2px
overlap — and its 24px falls inside the header's own 32px box (the 20px line plus 4 of the 12px under it).
The pill still covers its control and still grows leftward from the content right edge, exactly as the
other three do; the whole departure is 2px of vertical offset.

**This makes the containment argument stronger, not weaker.** #1172 and #1181 derive containment inside
`.channel-list` from the pill sitting inside its *row's* band; here the pill sits inside the *header's own
box*, so containment follows from the header being in view at any scroll position — with nothing poking
above it that a scroller clipping on both axes could shave.

Declined: **centring on the header's 32px box** (`top: 4px`) clears the cluster by 4px but drops the pill
4px below the glyph it names, buying nothing the zero-area touch does not already have. **Moving the pill
below the plus** (`top: 100%`, the ticket's named fallback) also clears the cluster, but detaches the name
from the header's line into the first host row's band and departs further from the three shipped pills
than 2px does; it is the answer if a later change puts something in the 4px this one uses.

## Testing strategy

**Unit (`ChannelList.test.tsx`, static server render — the tier that can see markup and no layout).** One
new assertion in the existing `#1303` describe block: the `</svg><span class="channel-list__control-name"
aria-hidden="true">Pair new host</span>` run occurs exactly twice (which pins the class, the ordering
after the glyph, the `aria-hidden` and the text in one marker), and zero times in the not-yet-loaded
frame. `PAIR_NEW_HOST_MARKER` still counts 2 and `pairTagsIn` still reads two unchanged opening tags — the
pill's text is a text node, so no attribute run moves. Colour, placement and the hover itself are
invisible here.

**E2E, fake tier — a new `e2e/sidebar-section-header-plus-name-pill.spec.ts`**, one launch, one continuous
drive, on `e2e/sidebar-workspace-plus-name-pill.spec.ts`'s model. A dedicated file for that spec's own
stated reason: each pill spec owns the control whose pill it is about. Scenarios, in drive order:

- Both pills mounted and `display: none` with the pointer parked off the control (a count *and* a
  hidden-ness — an absent pill satisfies hidden-ness vacuously).
- A tall list pushed as an unsolicited `conversations` envelope, so the scroller really scrolls and
  "at scroll top" is a position rather than a list that never moved.
- Hovering the Channels plus: its own pill shows, reads exactly `Pair new host`, and is the only one
  showing. Its computed ground, ink, size, line, weight, padding and radius are read back — **the only
  detector for the transposed-colour trap.**
- The geometry, at scroll top: 24px tall; top edge on the header's top edge; bottom edge inside the
  header's box; right edge on the header's right edge; **top edge at or below `.channel-list__actions`'s
  bottom edge** (the assertion the deviation exists for, and the one band-centring fails by 2px);
  contained in `.channel-list`'s box on both axes; the sidebar still 400 wide and the scroller with no
  horizontal overflow while the pill is up.
- Hovering the header away from the plus shows nothing — the trigger's scope, ordered after a positive
  read so it measures the scope rather than a pill that never showed.
- The Chats header's plus shows its own pill; leaving hides it.
- Keyboard: the Settings button focused, `Tab` to the Channels plus (the plus is the cluster's next
  focusable), pill shows on `:focus-visible` with the pointer parked off the list; `blur()` hides it.
- The plus still opens the pairing surface on a plain click while the pill covers it — the
  `pointer-events: none` proof, and what keeps `e2e/sidebar-pair-new-host.spec.ts`'s three clicks alive.

**Regression (AC4), run rather than argued:** `e2e/sidebar-tree-geometry.spec.ts`,
`e2e/sidebar-control-name-pill.spec.ts`, `e2e/sidebar-workspace-plus-name-pill.spec.ts` and
`e2e/sidebar-pair-new-host.spec.ts` unedited. The new pill joins no existing match set — both sibling pill
locators are already scoped to their own control's class, and `.channel-list__pair` shares no token with
any of them.

**Secret hygiene**, the sibling specs' posture: every assertion reads a number, a computed style, a count
or the one client-owned control name. No row title, no `cwd`, no host label.

## Open questions

- Does the band-centred pill's 2px overlap of the actions cluster hold up under measurement in a running
  window, or does some sub-pixel of the flex column separate them? Resolved in Phase B by asserting the
  shipped placement's own criterion (`pill.top ≥ actions.bottom`) and checking that band-centring reddens
  it — the same falsify-before-trust the two sibling rules record. Recorded under `## Revisions` if the
  measurement changes the decision above.
