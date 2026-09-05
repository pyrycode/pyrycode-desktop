# Channel List — the row's desktop geometry (`channels.css`/`ChannelList.tsx`, converged by #1097)

Split out of [Channel List home screen](channel-list.md) § How it works, where the package overview
had grown past the size cap. Read the parent doc first for the screen's overall shape; this page picks
up where its "How it works" section would have covered the row's geometry convergence.

The row was still the mobile Channel List's row — `--space-3` vertical padding, a `--text-title-medium`
label and the trailing time — stretched to the desktop sidebar's 400px, a convergence
`channels.css` had named and deferred by number since [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801).
[#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097) is that pass, landing four changes on
Figma node 103:2968:

- **24px is derived, never declared.** `.channel-list__row-open` (the only child `.channel-list__row`'s
  centred flex line sizes against) gets `--space-1` (4px) vertical padding over the label's
  `--text-body-small-line` (16px) box — 4 + 16 + 4 = 24, with no `height` rule anywhere. That is what
  keeps the e2e height assertion a real detector: a trailing affordance left at its old size would push
  the row past 24 and redden it, where a hard `height: 24px` would swallow the overflow silently (the
  measured precedent being `.composer__footer`'s hard 20px height, which no `boundingBox().height`
  assertion can ever fail against). This was checked empirically during the build, not just argued:
  reverting the affordance shrink below measured the row at 40px and reddened both e2e blocks.
- **Both trailing affordances shrink from a 24px glyph in `--space-2` padding to a 16px glyph in
  `--space-1`** (`.channel-list__save`, `.channel-list__rename`, and the `width`/`height` attributes on
  their `<svg>`s) — otherwise their old 40px box would set the row's height. A 24px pointer target is
  accepted here: this is a mouse-driven desktop window whose own design row is 24px.
- **4px between consecutive rows comes from `.channel-list__row + .channel-list__row { margin-top:
  var(--space-1) }`, not a `gap` on `.channel-list`.** Rows are flat siblings of the section headers,
  host rows and workspace rows inside one `.channel-list` flex column (#703/#704 emit no per-group
  wrapper element), so a column `gap` would move every one of those spacings too. The adjacent-sibling
  combinator fires only when a row's immediate predecessor is another row, leaving a group's first row
  — whose predecessor is a workspace row — at the zero it already has.
- **The label's type swaps `--text-title-medium-*` for `--text-body-small-*`** (12/16, tracking 0.4,
  weight 400), on the same `--color-on-surface`. The `--text-title-medium-*` quad is not dead — see
  `.archive__title`.
- **The last-activity time is deleted, not hidden:** the `<span className="channel-list__time">`, the
  CSS rule, and the `now` prop through all four signatures. See [the parent doc § Why the row carries
  no message preview](channel-list.md#why-the-row-carries-no-message-preview) for what stays.
- **The 6px corner (`--radius-xs`) lands on `.channel-list__row-open`, not the row wrapper** — at rest
  the wrapper paints nothing, so the corner is only observable on the button's `:hover` fill and
  `:focus-visible` outline. Deliberately not extended to span the trailing affordances: the node draws
  none, and [#1098](https://github.com/pyrycode/pyrycode-desktop/issues/1098) ("the sidebar fills the
  row of the chat you have open") is where the open-row fill gets decided — #1097 does not mark the
  open row at all.

**The status dot's centring is now a settled ruling, not a deferral.** See [the parent doc § The row's
status dot](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801-874), whose "Vertical
alignment" note previously deferred the design's 3px drop pending exactly this convergence — #1097
measured it and kept the dot centred.

The horizontal geometry (dot at x=16, label at x=32 via `.channel-list__row-open`'s `--space-8` left
padding) is #801's and does not move — the node's 10px gap is the arithmetic behind that 32, not a
declaration to port, which is why the row's own `gap` was deleted outright rather than retuned. The
sidebar's 20px list inset is [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070)'s and
is also untouched.

**Testing.** The renderer tier (`ChannelList.test.tsx`) asserts the negative — no bucket text and no
`.channel-list__time` class survive, seeded at a bucket boundary a working formatter would render, so a
reintroduced span would fail here first. Everything needing a layout engine (the height, the computed
padding/corner/type, the dot's centre, the 4px pitch, and that both affordances still open their
dialogs at their shrunk size) is `e2e/sidebar-row-geometry.spec.ts` — a new file rather than an
extension of `host-label-sidebar.spec.ts`, whose header scopes it to the host label and forbids
asserting it by value. Two `test()` blocks, one per seed promotion state, because a single launch can
carry only one clickable seed and the Save/Rename affordances are disjoint by section.

## Related

- [Channel List home screen](channel-list.md) — the parent doc.
- [#1097 spec](../../specs/architecture/1097-desktop-24px-sidebar-row.md).
- [#1098](https://github.com/pyrycode/pyrycode-desktop/issues/1098) — the sibling ticket that fills the
  open row; this ticket does not mark it.
