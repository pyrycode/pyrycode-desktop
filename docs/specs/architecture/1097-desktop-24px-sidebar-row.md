# 1097 — the sidebar row is the desktop 24px row, and the last-activity time goes

## Files read

Codegraph is not initialised in this repo (every `mcp__codegraph__*` call returns "CodeGraph not
initialized"), so this list came from Grep and Read rather than `codegraph_context`.

- `src/renderer/src/screens/channels/channels.css` → `.channel-list__row`, `.channel-list__row-open`,
  `.channel-list__title`, `.channel-list__time`, `.channel-list__save`, `.channel-list__rename`,
  `.channel-list__row > .conversation-status-dot` — every rule this ticket edits, plus the file header
  and the dot rule's deferral comment that this pass has to un-say.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `Row`, `renderBody`, `ChannelListView`,
  `ChannelList` — the four signatures the `now` prop threads through, the `.channel-list__time` span,
  and the two trailing-control `<svg>` elements whose `width`/`height` attributes must shrink.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `formatLastActivity` — the helper that
  STAYS: three other callers keep it alive.
- `src/renderer/src/screens/archive/archiveViewModel.ts` → `archivedSubtitle`, and
  `src/renderer/src/screens/conversation/ConversationScreen.tsx` + `WorkspacePickerSheet.tsx` — the
  three surviving `formatLastActivity` consumers AC3 protects.
- `src/renderer/src/screens/archive/archive.css` → `.archive__subtitle` — its comment cites
  `.channel-list__time`'s tokens by name and goes stale when that rule is deleted. `.archive__title`
  still reads the `--text-title-medium-*` quad, so the tokens themselves stay.
- `src/renderer/src/theme/tokens.css` → `--space-1`, `--space-4`, `--radius-xs`, `--text-body-small-*`,
  `--color-on-surface` — verified present with exactly the design's values; no new token is needed.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the `render` helper, `NOW`, `isoAgo` — the
  renderer tier's two time-coupled lines.
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW`, `seedConversationsFrame`, `LaunchPairedAppOptions`
  and the strict `.channel-list__row-open` click at launch — the constraint that decides the spec shape.
- `e2e/fixtures/conversationStateFake.ts` → the stateful reply factory: it owns the list, mints a row on
  `create_conversation` (`is_promoted` defaults false, `cwd` defaults `/fake/workspace`) and re-lists.
  This is how a second adjacent row is reachable without a second clickable seed at launch.
- `e2e/host-label-sidebar.spec.ts` → `boxOf` — the box-reading idiom this spec copies. Its own header
  scopes it to the host label and forbids asserting that label by value, so extending it would mean
  rewriting that framing; a dedicated spec is the cleaner shape.
- `e2e/real-daemon-rename.spec.ts` → the single `.channel-list__title` `textContent` read in the whole
  e2e tree. It reads the TITLE span, never the row, so dropping the time span does not reach it.
- `docs/knowledge/features/channel-list.md` § "Placement — a sibling of the open button" and
  § "Vertical alignment is a measurement, not an inheritance" — the dot's centring history, and the
  "the button's name stays title + time" claim that this ticket falsifies in three places.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2968 (row), with the list
frame at [`103-2985`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2985).

A single flat 24px row: a 6px status dot at the leading edge, then one line of `M3/body/small` label in
`Schemes/On Surface`, on a 6px-cornered rectangle with 4px vertical and 16px horizontal padding. There
is no time, no avatar and no trailing control of any kind — the label runs to the row's trailing edge.
In the list frame the rows sit on a 28px pitch (y = 0, 28, 56, …), i.e. 24px tall with 4px between
them, and exactly one row (the open one) is filled — that fill is #1098's, not this ticket's.

`get_design_context` on 103:2968 returned `h-[24px] items-start px-[16px] py-[4px] rounded-[6px]
gap-[10px]` with a `6×14` status-dot frame and a body-small paragraph, confirming the ticket's measured
table value for value. Every value already has an exact token, so no literal enters `channels.css`.

## Context

Every sidebar row is still the mobile Channel List's row — `--space-3` vertical padding, a
`--text-title-medium` label and a trailing `.channel-list__time` — stretched to the desktop sidebar's
400px. `channels.css`'s dot rule named this convergence and deferred it by name ("Converging the row's
full geometry on node 103:2968 — its height, its body-small title, dropping the time — is a separate
pass"). This is that pass.

No ADR is warranted: this is a geometry convergence on an already-decided design, and both rulings it
settles (the dot's centring, the deleted time) belong in the package overview rather than a decision
record.

## Design

Three production files, no new module, no new export, no signature that any other file consumes.

### `channels.css` — the row's geometry

| Rule | Change |
|---|---|
| `.channel-list__row-open` | vertical padding `--space-3` → `--space-1`; `gap: var(--space-4)` deleted; `border-radius: var(--radius-xs)` added. Left `--space-8` and right `--space-4` are untouched. |
| `.channel-list__title` | the `--text-title-medium-*` quad → the `--text-body-small-*` quad. Colour, ellipsize treatment and flex sizing unchanged. |
| `.channel-list__time` | deleted whole. |
| `.channel-list__save`, `.channel-list__rename` | `padding: var(--space-2)` → `var(--space-1)`. Everything else — `margin-right`, the round hover target, the focus outline — unchanged. |
| new: `.channel-list__row + .channel-list__row` | `margin-top: var(--space-1)`. |
| `.channel-list__row > .conversation-status-dot` | declarations unchanged; the comment's deferral paragraph is replaced by the ruling below. |

**24px is derived, never declared.** `.channel-list__row` is `display: flex; align-items: center`, so
its height is its tallest child's. With the title at `--text-body-small-line` (16px) and 4px of padding
above and below, `.channel-list__row-open` computes to 24 with no `height` anywhere. That is what makes
the e2e height assertion a real detector: a trailing control left at 40px would push the row past 24 and
redden it, where a hard `height: 24px` would swallow the overflow silently. (`.composer__footer`'s hard
20px height is the measured precedent for that failure — a `boundingBox().height` assertion against it
can never redden.)

**The trailing controls are 24px by the same arithmetic.** Each is a 24px `<svg>` in `--space-2` (8px)
padding — a 40px box that would hold the row at 40 and make AC1 unsatisfiable. A 16px glyph in
`--space-1` (4px) padding is exactly 24. The glyph size lives on the `<svg>`'s `width`/`height`
attributes in `ChannelList.tsx`, so both files move together; `viewBox="0 0 24 24"` is the coordinate
system and does not change. A 24px pointer target is accepted here — this is a mouse-driven desktop
window whose design row is 24px.

**The 4px comes from the row and reaches only a row.** Rows are flat siblings of the section headers,
host rows and workspace rows inside the single `.channel-list` flex column (#703/#704 emit no per-group
wrapper element). A `gap` on `.channel-list` would move every one of those spacings, which AC1's second
half forbids. The adjacent-sibling combinator fires only when a row's immediately preceding sibling is
another row, so the first row of a group — whose predecessor is a workspace row — keeps its zero.

**The corner goes on the fill's own surface.** At rest the row wrapper paints nothing; the only painted
surface today is `.channel-list__row-open`'s hover fill (and its focus-visible outline). The radius
therefore goes on `.channel-list__row-open`, not on `.channel-list__row`. Deliberately NOT extended to
the row wrapper to span the trailing controls: the design has no controls there, and #1098 is where the
open-row fill and its surface get decided. This ticket does not mark the open row at all.

**The horizontal geometry does not move.** The dot stays absolutely positioned at `--space-4` (x=16) and
the label keeps landing at x=32 via `.channel-list__row-open`'s `--space-8` left padding — #801's
arithmetic, which already reproduces the design's 16/32. The design's 10px gap is the arithmetic behind
that 32 (16 + 6 + 10), not a declaration to port, which is why the row's own `gap` is deleted rather
than retuned: with the time gone it has no second item to fall between. The rows' 20px inset from the
sidebar edge is #1070's, and is left at 16.

**The dot stays centred, and this pass settles it.** On the node the row is `items-start` and the dot is
a **14px-tall, 6px-wide frame** whose painted circle sits at `cy=11` inside it, so at 4px padding the
circle lands at y=15 in a 24px row whose centre is y=12 — the 3px drop. That offset is an artifact of
the Figma component's own 14px wrapper; the app draws a bare 6px dot with no wrapper, so porting the
offset would copy the wrapper's padding without the wrapper. `top: 50%; transform: translateY(-50%)`
stays, and the comment records this ruling in place of the deferral. Cheap to flip later if the drawn
offset is wanted.

### `ChannelList.tsx` — the time and the `now` thread

`formatLastActivity` survives with its unit tests; what goes is this file's use of it. The removal
unwinds one prop through four signatures, all of them file-local:

- the import of `formatLastActivity` (the other three named imports stay);
- `Row`: the `now` prop and the `const time = …` binding, and the `.channel-list__time` span;
- `renderBody`: the `now` parameter and the two `now={now}` pass-downs;
- `ChannelListView`: the `now` prop, its type, and the pass into `renderBody`;
- `ChannelList`: the `const now = Date.now()` and the `now={now}` pass into `ChannelListView`.

`now` is a plain per-render `Date.now()` read with no ticker behind it, so nothing else unwinds. No
other file imports `ChannelListView` except the renderer spec.

Also here, the two `<svg>` glyph sizes (Rename and Save) drop from 24 to 16.

### What the slice must un-say

Eight comments assert the row carries a time, spread across three files, and none is greppable from the
class name alone — three of them say "time" and never name the class:

- `channels.css`: the file header's "title + last-activity-time rows"; `.channel-list__row-open`'s "laid
  out as title · time"; the dot rule's deferral paragraph; `.channel-list__time`'s own comment (deleted
  with the rule).
- `ChannelList.tsx`: the file header's "collapse to a single title + last-activity-time row";
  `ConversationStatusDotControl`'s "not the row's title, time or icon buttons"; `Row`'s "`name` and the
  time are untrusted daemon-derived strings"; the dot's JSX comment "the button's name stays title +
  time".
- `archive.css`: `.archive__subtitle`'s "Clones `.channel-list__time`'s tokens" — restate the token
  quad by name rather than by a rule that no longer exists.

## State + concurrency model

None. This ticket adds no store slice, no async work, no subscription and no IPC. It removes one
per-render `Date.now()` read from `ChannelList`. React re-render behaviour is unchanged: the row's
subtree loses one `<span>`, and `ConversationStatusDotControl`'s four narrow subscriptions are untouched.

## Error handling

No new failure mode. The one behaviour retired is `formatLastActivity`'s empty-string return for a
malformed timestamp, which had no visible surface here beyond the deleted span; the helper keeps that
branch and its unit test for its three surviving callers.

## Testing strategy

Two tiers, because the removed markup and the computed geometry are observable in different places.

**Renderer (`ChannelList.test.tsx`, `renderToStaticMarkup`)** — the markup contract:

- delete `now={NOW}` from the shared `render` helper and drop the `expect(markup).toContain('3h ago')`
  assertion. `NOW` and `isoAgo` stay: the row factory still builds timestamps from them.
- replace the deleted assertion with its inverse — a row seeded at a bucket boundary renders NO bucket
  text and no `channel-list__time` class, so a re-added span reddens here rather than passing silently.
- the malformed-timestamp test's `not.toContain('NaN')` is now vacuous against a row that renders no
  time at all; fold it into the same negative assertion rather than leaving a test that cannot fail.

**Playwright, fake tier (`e2e/sidebar-row-geometry.spec.ts`, new)** — everything that needs a layout
engine. Two `test()` blocks because AC4's two halves need two different seeds, and a second clickable
seed strict-violates `launchPairedApp`'s launch click.

Block 1, a non-promoted seed (renders under "Chats" with `.channel-list__save`):

- `.channel-list__row` box height is 24 (± the file's one-device-pixel tolerance) — the AC1 detector,
  live only because no rule declares the height.
- `.channel-list__row-open`'s computed `border-radius` is 6px and its computed `padding` is `4px 16px
  4px 32px` — the corner and the padding, read off the surface that paints the fill.
- `.channel-list__title`'s computed `font-size` / `line-height` / `letter-spacing` / `font-weight` are
  12/16/0.4/400 and its colour resolves to on-surface — AC2, asserted as numbers, not as a token name.
- no `.channel-list__time` anywhere in the sidebar (count 0) — AC3's negative.
- `.channel-list__save`'s box height is ≤ 24 while the row's is still 24 — AC4's "without growing it".
- the dot's box centre and the row's box centre agree within tolerance — AC5, and the assertion that
  would redden if the design's 3px drop were ported.
- click the FAB, which mints a second non-promoted row in the same workspace group via
  `conversationStateFake` and re-lists → two adjacent `.channel-list__row` siblings. Assert the gap
  between them is 4px AND the gap between the workspace row above and the first row is 0 — together,
  "4px between rows, and the surrounding spacings unchanged". A `gap` on `.channel-list` would pass the
  first and fail the second, which is exactly the mistake AC1's second half is guarding.
- click `.channel-list__save` → `.save-as-channel-overlay` appears (AC4's "still opens its dialog").

Block 2, a promoted seed (renders under "Channels" with `.channel-list__rename`):

- the row's box height is 24 with the Rename control present, and the control's own box is ≤ 24.
- click `.channel-list__rename` → `.rename-conversation-overlay` appears.

Both blocks read numbers, counts and booleans only — no seed name is asserted by value, matching the
sibling specs' secret-hygiene posture. The fake tier is the dispatcher's gate; this spec runs there.

**Class tokens are load-bearing and do not move.** `channel-list__row`, `__row-open` and `__title` are
worn by 28 e2e spec files plus the shared fixture's strict click. This ticket changes what those rules
DECLARE, never which classes are worn.

## Open questions

1. **Does the FAB-minted row land in the same workspace group as the seed?** The fake resolves a null
   `cwd` to `/fake/workspace`; the seed will be given that same `cwd` so both fall in one
   `CollapsibleWorkspaceGroup` and are adjacent siblings. To confirm by observation in Phase B — if the
   two rows land in different groups, seed the row's `cwd` explicitly to match rather than reaching for
   a second launch.
2. **Does `.channel-list__save`'s `border-radius: var(--radius-full)` still read as a circle at 24px?**
   It becomes a 24px round target rather than a 40px one. Expected fine (the radius is proportional);
   confirm against the render before opening the PR, and note any deviation rather than retuning the
   radius, which is out of this ticket's scope.
