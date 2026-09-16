# #1506 — the sidebar tree moves 16px left onto its drawn insets

Three x positions move and the step between the levels is preserved: the host glyph to the card's
content edge, the workspace glyph to 12, and the workspace label and channel titles to their shared
34. A short plan — four declarations, no new type, no new state, no new failure mode.

## Files read

- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host` (its left padding, and the
  `position: relative` that already exists for the dots, the pen and the plus),
  `.channel-list__host-icon` (the glyph that leaves the flow), `.channel-list__workspace-head` (the
  wrapper carrying the workspace nest), `.channel-list__row` (the channel-list indent). Also
  `.channel-list__workspace-icon` and `.channel-list__workspace`, which are the shipped precedent for
  the out-of-flow glyph — read, not edited.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRow`'s subtree — the glyph is already the
  row's first child and every other child (`.channel-list__host-status`,
  `.channel-list__host-repair`, `.channel-list__host-edit`, `.channel-list__host-add`) is already
  absolutely positioned, which is what makes the row's `gap` inert once the glyph leaves. No change.
- `e2e/sidebar-tree-geometry.spec.ts` → `HOST_ICON_X`, `HOST_LABEL_X`, `WORKSPACE_ROW_X`,
  `WORKSPACE_ICON_X`, `WORKSPACE_LABEL_X`, `LIST_INSET_PX` / `ROW_X` / `DOT_X` / `TITLE_X` — the gate,
  and the only tier that can see any of this.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `HOST_ICON_MARKER` — pins
  `class="channel-list__host-icon"` as an exact attribute substring. A stylesheet-only change leaves it
  matching; noted so the next reader does not reach for a modifier class.
- `src/renderer/src/theme/tokens.css` → the `--space-*` scale: 4, 8, 12, 16, 20, 24, 28, 32. Every
  number this ticket writes is on it.
- `docs/knowledge/features/channel-list-tree-inset.md` — the page that records the sums superseded
  here, and the idiom (`**Superseded by #N:**`) the documentation stage will use to fold them in.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2966

`Channels` 103:2966 draws the tree as one indent ladder inside the card's 360px content box.
`Host container` 106:3104 reads x 0 for `Host` 405:7862, x 4 for the `Workspace` instance 405:7456
(356 wide), and x 4 for `Channel list` 103:2985, whose `Channel` instances sit a further 8 in at x 8
(348 wide) — a channel row 12 from the content edge. The host row's own composition, read from
[Host 399:1366](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=399-1366) Idle 399:1365,
is `pl-[24px] py-[4px]` with `Row icon` 399:1356 absolutely placed `left-0 top-[4px]` — a 20px-tall
box centring the 12px server glyph — so the label's 24 is carried by the row's padding alone.

## Change

Four blocks in `channels.css`, all leading edges; nothing trailing moves.

1. **`.channel-list__host`'s left padding, `--space-4` → `--space-6`** (16 → 24). With the glyph out of
   the flow the padding carries the drawn label position on its own. The right half of the shorthand
   keeps `--space-8 + --space-5` — the Hover variant's 52, held in both states for the reason the
   block's own comment gives.
2. **`.channel-list__host-icon` leaves the flow**: `position: absolute; left: 0; top: 50%;
   transform: translateY(-50%)`, and `flex: 0 0 auto` is dropped because an absolutely positioned child
   is not a flex item. `left: 0` resolves against the row's padding box, which starts at its border
   edge — the row carries no border — so it reads as the card's content edge straight off. `top: 50%`
   over the row's 28px padding box is 14, and translating the 12px glyph back by half of itself lands
   it at 8..20: the drawn box's own centre (4 + (20 − 12) / 2 = 8). `.channel-list__workspace-icon` is
   the shipped precedent for the whole shape, percentage centring included.
3. **`.channel-list__workspace-head`'s nest, `--space-5` → `--space-1`** (20 → 4). The button's own
   `pl-[30px]` and its glyph's `left: --space-2` do not move, so the folder lands at 4 + 8 = 12 and the
   label at 4 + 30 = 34.
4. **`.channel-list__row`'s indent, `--space-7` → `--space-3`** (28 → 12). `.channel-list__row-open`'s
   internal 8 (dot) and 22 (title) do not move, so the dot lands at 20 and the title at 34 — the same
   left edge as the workspace label, which is the alignment the spec asserts as an equality.

Each of those four blocks' comments states the sum this supersedes, and `.channel-list__workspace`'s
states two more (20 + 8 = 28 for the folder, 20 + 30 = 50 for the label) though none of its own
declarations move. Every one of those paragraphs is re-derived rather than left contradicting the
declarations beneath it.

Nothing else moves. **The host row's 12px `gap` goes inert and stays put** — with the glyph absolute
the label is the only flex item left and the gap describes nothing, but it is the chevron's gap and
#1507 re-derives it to the drawn 6 when it adds the chevron that makes it visible again. The 52px
trailing reserve on both rows is untouched, so the workspace row and the channel rows come out *wider*
rather than shifted and each still ends flush with the card's trailing content edge.
`ChannelList.tsx` needs no change.

## Testing strategy

`e2e/sidebar-tree-geometry.spec.ts` is the gate and the only tier that can see this: `vitest.config.ts`
sets `environment: 'node'`, every renderer spec is a `renderToStaticMarkup` string assertion, and there
is no layout engine there to measure an x with. No other spec asserts an absolute x for any of these
elements and none reads the three declarations that move.

Six constants are retuned, each still derived from `CARD_INSET_PX` plus the drawn offset rather than
from a literal at the assertion, and each one's comment re-derived to name the reading it supersedes:

- `HOST_ICON_X` → `CARD_INSET_PX` (the glyph at the content edge, `Row icon` 399:1356's `left-0`)
- `HOST_LABEL_X` → `CARD_INSET_PX + 24`, carried by the row's padding alone rather than summed through
  the glyph and the gap as the superseded `HOST_ICON_X + 12 + 12` did
- `WORKSPACE_ROW_X` → `CARD_INSET_PX + 4`, `WORKSPACE_ICON_X` → `CARD_INSET_PX + 12`,
  `WORKSPACE_LABEL_X` → `CARD_INSET_PX + 34`
- `LIST_INSET_PX` → 12, which carries `ROW_X`, `DOT_X` (32) and `TITLE_X` (54 = `CARD_INSET_PX + 34`)

The existing equality `expect(WORKSPACE_LABEL_X).toBe(TITLE_X)` holds at the new numbers and is what
keeps the two paddings from being moved independently. The trailing-edge assertions in block 2 want no
retune — they are derived from `right` and `CARD_INSET_PX`, and they are what makes AC3's "wider rather
than shifted" a red rather than a silent pass.

Run: `npx playwright test e2e/sidebar-tree-geometry.spec.ts` after `npm run build`, proved red against
the unpatched stylesheet first. Plus `npm run build` for the typecheck.

## Documentation handoff

Pending for the documentation stage — two package overviews record the sums this ticket supersedes and
go stale with it. Each file's own established idiom for a number that moved applies;
`channel-list-tree-inset.md` already annotates one as **Superseded by #1171:**.

- `docs/knowledge/features/channel-list-tree-inset.md` — the host and workspace glyph positions, the
  channel row's 28 indent with its "starts 48 from the card's edge" and 332 width, and the title's
  card-edge 70.
- `docs/knowledge/features/channel-list-workspace-row-nest.md` — "lands the 12px folder glyph at 28 and
  the label at 50", and the `WORKSPACE_ICON_X` reading it quotes as `CARD_INSET_PX + 28`.
