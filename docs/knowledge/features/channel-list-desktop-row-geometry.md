# Channel List — the row's desktop geometry (`channels.css`/`ChannelList.tsx`, converged by #1097, marked by #1098, redrawn by #1171, workspace row nested by #1178)

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
- **Both trailing affordances shrank from a 24px glyph in `--space-2` padding to a 16px glyph in
  `--space-1`** (`.channel-list__save`, `.channel-list__rename`, and the `width`/`height` attributes on
  their `<svg>`s) — otherwise their old 40px box would set the row's height. A 24px pointer target was
  accepted here: this is a mouse-driven desktop window whose own design row is 24px. Superseded by
  [#1171](#the-redrawn-frame-the-rows-8px-inset-and-its-hover-revealed-control-1171): the affordances
  left the flex flow altogether, so their size no longer sets the row's height at all — see that
  section for the 12px glyph, the absolute box and the hover/focus-only reveal.
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
  none, and #1097 left the wrapper's own corner to whichever ticket decided the spanning fill — see
  § The open row's fill below, which is that ticket.

**The status dot's centring is now a settled ruling, not a deferral.** See [the parent doc § The row's
status dot](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801-874), whose "Vertical
alignment" note previously deferred the design's 3px drop pending exactly this convergence — #1097
measured it and kept the dot centred.

The horizontal geometry (dot at x=16, label at x=32 via `.channel-list__row-open`'s `--space-8` left
padding) was #801's and held through #1097 and #1098 — the node's 10px gap was the arithmetic behind
that 32, not a declaration to port, which is why the row's own `gap` was deleted outright rather than
retuned. [#1171](#the-redrawn-frame-the-rows-8px-inset-and-its-hover-revealed-control-1171) moved both:
dot to x=8, label to x=22, reading the redrawn frame's own 8px inset and 8px gap in place of #801's
16/10. The sidebar's list inset, 20px from #1070's fix through #1097/#1098, is 28 as of the same
ticket — see § The tree's inset below for the card-edge arithmetic that follows from it, and § The
redrawn frame below for the row-relative numbers. (This paragraph used to assign the original 20 to
\#1070, whose acceptance never mentioned it.)

**Testing.** The renderer tier (`ChannelList.test.tsx`) asserts the negative — no bucket text and no
`.channel-list__time` class survive, seeded at a bucket boundary a working formatter would render, so a
reintroduced span would fail here first. Everything needing a layout engine (the height, the computed
padding/corner/type, the dot's centre, the 4px pitch, and that both affordances still open their
dialogs at their shrunk size) is `e2e/sidebar-row-geometry.spec.ts` — a new file rather than an
extension of `host-label-sidebar.spec.ts`, whose header scopes it to the host label and forbids
asserting it by value. Two `test()` blocks, one per seed promotion state, because a single launch can
carry only one clickable seed and the Save/Rename affordances are disjoint by section.

## The open row's fill (`ChannelList.tsx`/`channels.css`, #1098)

The sidebar marked the open chat in no way at all until #1098. The chat the pane is showing was already
held in `activeConversationStore` (`ConversationCreatedPayload.id` — the ticket body's `conversation_id`
does not exist; every shipped reader uses `.id`) and `activateConversation` already writes it
unconditionally on both a row click and a FAB-minted conversation. The sidebar simply did not read it, so
the feature is one reactive read plus three CSS rules — no store, no IPC, no wire change.

**Where the read lands: the `ChannelList` container, not per-row.** `useActiveConversationStore((s) =>
s.activeConversation?.id ?? null)` — `ConversationScreen`'s shipped selector verbatim — runs once in the
container and reaches `Row` as a required `isOpen` boolean, compared with `===` against a possibly-`null`
id and never a truthiness test (an empty-string id stays an ordinary key). A per-row read would be the
tighter re-render boundary and mirrors `ConversationStatusDotControl` one component over, but it was
rejected: Zustand v5 serves `getInitialState()` under `renderToStaticMarkup`, so a store-reading `Row` can
only ever render `activeConversation: null`, which would put the whole marked state out of the renderer
tier's reach and onto e2e alone. Lifting the read to the container costs a wider re-render (the whole
sidebar re-renders on a switch, not just two rows) — accepted, since a switch already rebuilds the chat
pane.

**How the state is carried: `aria-current` on the open button, never a modifier class.** `aria-current`
announces the open chat to a screen reader; a class announces nothing, which is also why it sits on the
button — the element a keyboard user actually reaches — rather than the role-less row wrapper.
`undefined` omits the attribute rather than emitting `aria-current="false"`, the shape all four shipped
consumers use (`ComposerOptionsPanel`, `ComposerModelMenu`, `ComposerSlashCommandTypeAhead`,
`QuestionPanel`). A `--open` modifier class was rejected mainly because `ChannelList.test.tsx` matches
whole `class="..."` attribute runs and `rowChunksIn` **splits** the render on the first of them — a
marker that stopped matching would yield zero chunks and pass the #801 assertions vacuously rather than
failing, the same silent-zeroing reason `WorkspaceRow` already keeps its own class token sole and styles
off `[aria-expanded='false']`.

**Where the fill paints: the wrapper, selected through `:has()`.** `.channel-list__row-open` is a
`flex: 1 1 auto` sibling of the trailing Save-as-channel/Rename controls, not their parent, so a fill on
it would stop short of the row's trailing edge. The fill goes on `.channel-list__row`, already spanning
the row and already `position: relative`, selected by
`.channel-list__row:has(> .channel-list__row-open[aria-current='true'])` — background `--color-on-primary`
plus the `--radius-xs` corner, background and corner only (no padding, no border, no min-height, so the
derived-24px box above does not move). `:has()` had two prior consumers in `conversation.css`; Electron
33 ships Chromium 130 and `:has()` landed in 105.

`--color-on-primary` (`#003355`) is the exact fill value and satisfies the file's no-literals rule, but
this is its **first use as a background** — its own token comment scopes it to the label/icon role on a
`--color-primary` fill. The rule's comment says so rather than silently repurposing it, and it is not
"corrected" to `--color-primary`, a different colour (`#9dcbfc`). Contrast measured at review: label
`#e0e2e8` on the fill ≈ 10.1:1, and the untouched `--color-outline` focus ring ≈ 4.1:1 against it — both
clear their thresholds, so the existing focus-visible treatment needed no change.

Two more rules completed it, as of #1098: `.channel-list__row-open[aria-current='true']:hover {
background: none }` suppressed the button's opaque `--color-surface-container` hover, which would
otherwise paint over the wrapper's fill across the button's share of the row (its (0,3,0) beat the base
rule's (0,2,0), so it won on specificity, not source order). [#1171](#the-redrawn-frame-the-rows-8px-inset-and-its-hover-revealed-control-1171)
deleted that suppression rule outright — the row's hover fill moved off the button and onto the
wrapper, so nothing paints on the button on hover any more and there is nothing left to suppress. The
ruling itself (the open fill wins over the hover fill) is unchanged; it is enforced by the new
`.channel-list__row:hover` rule's lower specificity against `:has()`, recorded in that section.
`.channel-list__row-open[aria-current='true'] >
.channel-list__title { font-weight: var(--text-body-small-weight-emphasized) }` is the one-declaration
step from body-small to `M3/body/small-emphasized` (500) — the two type tiers differ in weight alone.
`:focus-visible` is untouched on every row (#274's ruling that the two affordances highlight
independently still stands), and so are the trailing controls' own hover circles — the node draws no
trailing control at all.

[#1174](https://github.com/pyrycode/pyrycode-desktop/issues/1174) hung a third rule off these same two
carriers: `.channel-list__row:hover > .conversation-status-dot--idle` and
`.channel-list__row:has(> .channel-list__row-open[aria-current='true']) > .conversation-status-dot--idle`
fill an idle row's [status dot](conversation-status-dot.md) `--color-primary`. Scoped to `--idle` rather
than the bare dot class, so it never competes with the dot's own painted modifiers (`--working` etc.) — see
[Conversation status dot § how it works](conversation-status-dot.md) for the specificity math. Declared
beside these two rules in `channels.css` rather than in the dot's own CSS block, for the same reason the
dot's own positioning already lives at this call site: the selectors it hangs off belong to the row
wrapper, not the dot.

**Lessons learned, folded in at their sites above:**

- **A wrapper's computed `background-color` cannot see a child painting over it.** The natural assertion
  for "hovering the open row leaves its fill unchanged" reads the row's own background — and it passes
  whether or not the button's hover is suppressed, since a parent's computed style is unaffected by a
  child's paint. Only the button's own computed background detects the suppression rule; noted at the
  e2e assertion rather than trusted. **Resolved by #1171, not merely worked around:** once the hover fill
  itself moved onto the wrapper, both candidate fills paint on the same element, so the row's own
  computed background genuinely separates `--color-on-primary` from `--color-primary-container` and the
  suppression rule this bullet is about no longer exists to need a workaround.
- **An id-leak scan over `renderToStaticMarkup` output must strip inline SVGs first.** This file's
  Material `<path d>` runs contain coordinate pairs (`14c1.1`) that a naive `not.toContain('c1')` guard
  flags as leaked id fragments — client-owned glyph geometry, not daemon text.
- **The fixture that reaches the thread by clicking a row makes that row the open one everywhere.** All
  29 fixture-riding specs now launch with a filled seeded row, which silently broke #1097's
  `font-weight: 400` assertion on that row — fixed by asserting the open weight (500) there and moving
  the resting-weight (400) assertion to the point where the FAB has minted a second, unopened row.

**Testing**, across the same two homes as the geometry above: `ChannelList.test.tsx` proves the unfilled
case, the exactly-one-`aria-current` case, and the AC5 byte-stability equality (all reachable under
`renderToStaticMarkup`, which always hydrates to no open id); `sidebar-row-geometry.spec.ts` and
`conversation-switch-keeps-both-threads.spec.ts` prove the computed fill colour, the corner, the computed
500 weight, the hover outcome, and the fill moving to a second row on a row-click switch — stated as sets
and counts per that file's secret-hygiene posture, never by seed text or `nth()` position.

## The redrawn frame: the row's 8px inset and its hover-revealed control (#1171)

The redrawn Figma frame (Hover row 398:7266) moved the row's own 8px inset, moved the hover fill off
the button, and replaced the trailing affordances' always-visible Material glyphs with a control that
is invisible at rest and appears on hover or keyboard focus. One `Row` and one block of `channels.css`
still serve both the Channels and Chats trees, so all of it changed for both sections at once.

**Geometry.** `.channel-list__row`'s `margin-left` went `--space-5` → `--space-7`. The status dot's
`left` went `--space-4` → `--space-2`, landing its 6×11 frame at row-relative x=8. The title's left
padding, formerly the single token `--space-8` (32), became `calc(--space-2 + 6px + --space-2)` (22) —
there is no single token for 22, so the sum of the drawing's 8px inset, the 6px dot, and the 8px gap
after it is written out rather than hidden behind a new token. The row still declares no `gap`. The
dot stays out of flow for a reason that changed underneath it: the old comment cited the notch a
button-only fill would leave around it, which stopped applying once the fill left the button, but the
click-through reason survived and hardened — the dot is a *sibling* of the button, so an in-flow dot
would carve its 22px out of the button's own hit area, and a click there would open nothing.
`pointer-events: none` on the dot is what keeps that from happening.

**The hover fill moved from the button to the row wrapper**, `--color-primary-container`
(`#134a74`) behind the same `--radius-xs` corner, replacing `.channel-list__row-open:hover`'s
`--color-surface-container` (`#1d2024`). It had to move because the trailing control, a sibling of the
button rather than its child (an interactive control cannot nest inside a `<button>`, #274), now sits
directly over the button's trailing padding — a fill living on the button would drop the instant the
pointer crossed onto the glyph, flickering the row. `.channel-list__row:hover` keeps the fill under the
pointer across the whole row the way the `:has()` open-fill rule already did. The open fill still wins
on hover (`:has()`'s (0,3,0) over the plain hover rule's (0,2,0)), and — since both fills now paint the
same element — the win is for the first time directly assertable by reading the row's own computed
background; see the correction folded into § The open row's fill above.

**The trailing control leaves the flex flow.** `.channel-list__save` / `.channel-list__rename` become
`position: absolute; right: 0; top: 50%; transform: translateY(-50%)`, a 28×24 (`--space-7` ×
`--space-6`) box with `padding: 0 var(--space-2) 0 0` and `justify-content: flex-end`, landing the 12px
glyph's right edge 8px in from the row's right edge, its box centred on the row. Two consequences
follow directly from taking it out of the centred flex line that used to size the row:

- **The row-height e2e assertion stops detecting the control's size.** It was #1097's proof that an
  oversized trailing affordance would push the row past its derived 24px — a real detector only because
  the flex line's tallest child decided the row's height. An absolutely positioned control can no longer
  do that, so the assertion now detects only the button's own padding and the label's line box (still
  the source of the 24), and the control's own rectangle needs a direct assertion instead (its glyph's
  8px right inset, its centre on the row).
- **`row.width > open.width` becomes an equality.** The button now spans the whole row rather than
  yielding its trailing share to an in-flow control, which is the intended new invariant: the open
  button's focus rectangle no longer shrinks on rows that carry a control.

**Visibility is `opacity` alone, on every row including the open one.** `opacity: 0` at rest, `opacity:
1` under `.channel-list__row:hover` and on the control's own `:focus-visible`. Juhana's ruling,
2026-09-06: the Active variant as drawn still carries the pen, but that is a leftover of building Active
from Hover in the design tool, not an intended "open rows show their control at rest" — so it is not
ported, and the open row behaves like any other row here. The mechanism matters as much as the ruling:
`display: none` or `visibility: hidden` would have taken the control out of the tab order and stopped
nine already-shipped specs that click or await `.channel-list__save` / `.channel-list__rename` without
hovering first, five of them `real-daemon-*` specs holding a `toBeVisible()` readiness gate under a
handshake timeout — the tier `playwright.config.ts` reserves for `npm run e2e:real:gate` alone.
Playwright counts an `opacity: 0` element as visible and moves the pointer onto it before clicking,
which hovers the row on the way, so all nine pass unedited.

**`:focus-visible` is a keyboard-modality heuristic, not a plain focus check.** Reaching the control's
`opacity: 1` state in a test means focusing the open button and pressing Tab, so the focus arrives via
the keyboard; a bare `element.focus()` call after a mouse interaction does not satisfy Chromium's
heuristic and would test the heuristic's mood rather than the rule.

**The glyphs are the drawing's own exports**, not the previous Material stand-ins: `viewBox="0 0 12
12"` at `width="12" height="12"`, `fill="currentColor"`, coloured `--color-primary` in place of
on-surface-variant. The Channels row (Rename) takes Font Awesome `pen-solid`. The Chats row
(Save-as-channel) takes a bold chevron-up whose art is 12.12×7.2 — its `viewBox` starts at `y=-2.46`
rather than the origin so the exported path centres in the 12px box without being re-based by hand; the
Figma layer is named `circle-chevron-up-solid` but only the chevron is drawn, there is no circle. No
hover circle and no background sit behind either glyph — the drawing draws neither.

**A comment that names another module's class as its treatment precedent goes stale when that class is
redrawn, and no identifier grep finds it.** `archive.css`'s `.archive__restore` comment and
`conversation.css`'s drop/cancel-affordance comment each cited `.channel-list__save` as the shared
de-emphasized-icon-button idiom; #1171 redrew that control as a hover-revealed `--color-primary` glyph,
so both citations were corrected in place (the first to describe its own now-standalone treatment, the
second to point at `.archive__restore` instead). The prose lives in a comment body, invisible to a grep
for the class token itself.

**Testing.** `e2e/sidebar-tree-geometry.spec.ts`: `LIST_INSET_PX` 20 → 28, `DOT_X` = `ROW_X + 8`,
`TITLE_X` = `ROW_X + 22`. `e2e/sidebar-row-geometry.spec.ts`: `HOVER_FILL_RGB` → `rgb(19, 74, 116)` read
off the row wrapper rather than the button, plus the opacity-at-rest / opacity-on-hover /
opacity-on-focus set (asserted over both rows at once, per this file's no-`nth()` posture), the glyph's
8px right inset and row-centred box, the fill surviving with the pointer moved onto the glyph itself,
and a click at the dot's own centre still moving `aria-current`. Rounded deltas are normalised against
`-0` before any `toBe(0)` (the #868 rule).

## The tree's inset (`channels.css`, the 2026-09-05 inset fix)

The row was converged on its node, but the tree around it was still laid out as the mobile screen had
been: every level took its x from its own padding against a 400px column that had no inset at all, so the
section header sat at 16 where the design draws it at 20, the host and workspace glyphs 20px too far
left, the channel rows 40px too far left with the open row's fill spanning the full sidebar, and the two
sections separated by 25px where the design puts 57. Reported from the running client against Figma
Sidebar 132:3902 and fixed directly, five declarations in one stylesheet:

- **`.channel-list` gains the card's 20px horizontal padding** ("Channels and chats" 103:2959, p-[20px]).
  Horizontal only: the top 4 and bottom 24 belong to the sticky actions cluster and the FAB, interim
  chrome the design places elsewhere, and become 20 when those move. With this one inset the content box
  is the design's own 360px, so every node's x coordinate transfers literally — which is also what let
  the host dots' rule stop arguing with the design (below). The actions cluster and the FAB move 20px
  inward with it, an accepted side effect on two controls that are not on the node at all.
- **The section header drops its horizontal and top padding and keeps 12 below** (103:2984, 103:2966
  gap-[12px]). Its box is the bare 20px line, so the host row lands 32px under the header's top.
- **The host row's right padding goes to 0**, so the two connection dots sit flush with the content edge.
  #718 had kept them 16px in, reading the design's absolute dot coordinates as artefacts of a 360-wide
  design row against a 400-wide shipped one; with the row now 360 wide they read literally, 1px from the
  edge, and 1px has no slot on the scale. The dots now end where the channel rows' fill ends.
  **Superseded by [#1185](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185):** the padding is
  52px in both states, reserving the trailing slot its own hover-revealed pen and plus occupy, and the
  dots left the flex flow for `position: absolute; right: 0`, which keeps this same flush edge without
  riding the padding at all.
- **`.channel-list__row` gains `margin-left: var(--space-5)`** ("Channel list" 103:2985, pl-[20px]): a
  row is 340 wide in the 360 box, the dot at 56 and the title at 72 from the card's edge, and the open
  row's fill starts 40 in. A margin per row rather than padding on a wrapper because there is no
  wrapper (#703/#704); the adjacent-row rule sets `margin-top` alone, so the two longhands coexist.
  **Superseded by #1171:** `margin-left` is `--space-7` (28) now, so the row is 332 wide in the same 360
  box and its (and the open fill's) left edge starts 48 from the card's edge, not 40. The dot's
  row-relative inset shrank from 16 to 8 in the same ticket, so its card-edge position holds at 56 by
  coincidence (20 list padding + 28 row margin + 8 dot, against the old 20 + 20 + 16); the title's
  row-relative inset shrank from 32 to 22, so its card-edge position drops from 72 to 70 (20 + 28 + 22).
- **The divider spans the full content box with 28px on both sides** (103:3009 in a gap-[28px] column).
  Its colour stays `--color-outline-variant`; the node draws `--color-inverse-primary`, a colour change
  this fix did not take.

The workspace row's own inset held through this fix (106:3098 pl-[24px] already matched, and its
icon→label gap kept the documented 2px deviation) — both retired by
[#1178](#the-workspace-rows-own-nest-and-its-create-chat-plus-1178), which nests the row 20px in behind
a new wrapper and closes the 2px gap deviation outright.

**Testing.** `e2e/sidebar-tree-geometry.spec.ts`, a new file beside `sidebar-row-geometry.spec.ts`
(which owns the row's own box and scopes itself to it), seeds one promoted row, mints an unpromoted one
through the FAB so both sections and the divider render, and reads every offset above as a box
coordinate from the card's edge: proved red first at the header's 0-for-20 against the unpatched build.
The trailing edge is read off `.channel-list`'s `clientWidth` so a classic scrollbar on the host machine
cannot move it. `host-label-sidebar.spec.ts`'s trailing-inset constant went from 16 to 0 with the dots.

## The control's own name, on hover or keyboard focus (#1172)

Since #1171 each trailing control is a bare 12px glyph, invisible until the row's hover reveals it. This
names it: hovering (or keyboard-focusing) **the control itself, never the row** shows a Pill (Figma
`347:6617`) reading `Rename` or `Save as channel`, restated as `.channel-list__control-name` in this file
rather than lifted from [`.composer__attachment-name`](composer-attach-name-pill.md) (#1265, shipped
first). Two reasons, not one: verbatim duplication for these two controls is already this file's shipped
idiom (`.channel-list__rename` restates `.channel-list__save` declaration for declaration), and a BEM lift
would turn `class="composer__attachment-name"` into a two-class mix that silently degrades the composer
specs asserting whole attribute runs. Both blocks read the same tokens by name and anchor to the same
node, so drift risk sits in the token layer, not in shared markup.

**The two colours are transposed in the Figma export — the same trap as #1265, #1262 and #969.**
`get_design_context` on 347:6617 prints the ground and ink swapped against `tokens.css`
(`--color-primary-container` `#134a74` / `--color-on-primary-container` `#cfe4ff`); the node's own
screenshot — dark ground, light ink — is what settles it, by name rather than by the exported hex. Only
`e2e/sidebar-control-name-pill.spec.ts`'s two computed-colour constants can detect a regression here,
since nothing in the static tier renders a colour.

**Both names are one module constant each, read by the control's own `aria-label` and by its pill, so the
two cannot drift:** `RENAME_CONTROL_LABEL`, `SAVE_AS_CHANNEL_CONTROL_LABEL` in `ChannelList.tsx`. Not
merged with `.conversation`'s own Rename entry in the thread overflow menu, despite the same six
characters — the `HOST_ROW_FALLBACK_LABEL`/`SERVER_ROW_LABEL` ruling against a cross-screen import for one
word applies here too.

**Placement: the row's own vertical band, right-aligned to the control — not above it.** The control is
already a 24px box (`top: 50%`, `translateY(-50%)`, `height: var(--space-6)`) centred on the row; the pill
is centred inside it the same way and is itself 24px tall (`--space-1` + the 16px body-small line +
`--space-1`), so its box coincides with the row band on every row, at any scroll position — containment
inside `.channel-list` (`overflow-y: auto`, which clips both axes, per § The redrawn frame above) then
follows from the control being in view, rather than needing a per-row proof. `right: 0` pins it to the
control's padding-box right edge, i.e. the row's right edge, so it grows leftward and adds no scrollable
overflow on either axis. The cost, accepted rather than hidden: a hovered control's pill covers roughly
the trailing 104px of that row's title, for as long as the pointer sits on the 36×24 control.

**Why not above the row, the composer pill's own placement — measured, not just reasoned.**
`.channel-list__actions` sits sticky at the scroller's top-right with `z-index: 1`, covering the same
corner a row's trailing control occupies, so the highest row a pointer can actually reach always carries a
live 32px of headroom above it once the actions cluster is accounted for — the in-band placement was
chosen because it needs no headroom at all, not because none exists. Proving that third geometry case took
two failed drafts: each scrolled a row flush against the scroller's own top edge and hovered its control,
and both came back with the row 700px down the viewport, because Playwright's `hover()` **relocates** its
target when the row it computed is unhittable (the sticky cluster physically covers the control) rather
than failing on it — a false "still passes" the same shape as a clipped box still reporting geometry. The
block now reads the actions cluster's own bottom edge at runtime, parks the probe row immediately under
it, and re-reads that row's position after the hover, so a relocation fails the block instead of silently
weakening the proof it was meant to be.

**Mechanism, matching #1265 throughout:** `display: none → block`, never `opacity`/`visibility`, so a
hidden pill reports no box at all and a test tells "showing" from "hidden" by the *kind* of answer;
`pointer-events: none` — here because the pill overlays the row's own open button, and a click aimed at
the row (or Playwright's hit test on the nine pre-existing specs that click these controls without
hovering first) must read straight through it; `aria-hidden="true"` plus append-after-the-`<svg>` markup
order, so `ChannelList.test.tsx`'s existing `<svg …>` opening-run and `aria-label` assertions stay
byte-identical. No `max-width`/ellipsis: both strings are client-owned compile-time constants (the longer
computes to ~104px inside a 332px row), unlike the composer pill's unbounded daemon filename.

**Testing.** `ChannelList.test.tsx` adds the closing-tag adjacency `</svg><span
class="channel-list__control-name" aria-hidden="true">…</span>` per control — not two independent
substrings, since a pill that drifted to a row-level sibling would still contain both and only adjacency
catches it — plus a drift guard counting the pill text and the `aria-label` together.
`e2e/sidebar-control-name-pill.spec.ts` (new) drives one launch against a tall, post-launch-pushed list
(the fixture's own strict single-row click can't seed a multi-row list at launch): resting state (every
pill mounted and hidden), each control's own hover (text, every computed style including both colours,
siblings still hidden), containment on the first row, the last row, and the highest reachable row per the
measured case above, hovering the row's title alone showing no pill (the scoping is the control's own
`:hover`, never the row's), leaving, and the keyboard path (`Tab` onto the open row, never
`locator.focus()`, matching § The redrawn frame's own `:focus-visible` reasoning).

## The workspace row's own nest and its create-chat plus (#1178)

The redrawn `Workspace` component (Figma 399:1059, placed as 405:7456 inside a `pl-[20px]` wrapper
405:7469) puts the workspace row's own geometry through the same two moves the channel row above already
had: a deeper card-edge nest, and a hover-revealed trailing control. Where #1171 landed those on
`.channel-list__row`, #1178 lands them on `.channel-list__workspace` — and the two rows' labels now share
one left edge (50px from the card's content edge) for the first time, closing the 2px gap the tie-break
in § The tree's inset above had left standing since before #1171.

**A wrapper element is now necessary, not just a convenience.** `WorkspaceRow` returns
`<div class="channel-list__workspace-head">` holding the disclosure `<button class="channel-list__workspace">`
and a new plus `<button class="channel-list__workspace-create">` as **siblings**, never nested — an
interactive control cannot sit inside a `<button>` (#274), which is also the entire mechanism behind
"clicking the plus never toggles the fold": the click simply never reaches the disclosure's handler. The
wrapper is also the plus's positioned ancestor: `.channel-list` is `position: relative` for a stacking
reason (see the note on `::before` painting order above), so an absolutely positioned plus with no nearer
containing block would pin itself to the scroll column instead of to this row. The wrapper wraps the head
row only — a group's channel rows stay flat siblings of `.channel-list`, preserving the ancestry the
existing e2e specs click through. Its class, `channel-list__workspace-head`, was chosen to share no token
with any strict-mode locator (`.channel-list__workspace`, `.channel-list__row`, `.channel-list__row-open`,
`.channel-list__section-header`, `.channel-list__host`) and to not appear as a substring of
`class="channel-list__workspace"` in the unit tier's markup assertions — both hold by construction (class
selectors match whole tokens; the marker string carries its closing quote).

**Geometry**, all measured from the card's content edge: the wrapper takes `margin-left: var(--space-5)`
(20px), the same "margin on the row because there is no group wrapper" idiom `.channel-list__row` already
uses. `.channel-list__workspace`'s padding moved from `--space-1 --space-4 --space-1 --space-6` to
`--space-1 --space-8 --space-1 --space-2` and its gap from `--space-3` (a tie-break, no token being
exactly 10) to `calc(var(--space-2) + 2px)`, written as a sum for the same reason
`.channel-list__row-open`'s 22px left padding is: the arithmetic is the point, not the pixel count. That
lands the 12px folder glyph at 28 and the label at 50 — exactly `.channel-list__row-open`'s title
position, so **the workspace label and the channel titles now share one left edge**. `flex: 1 1 auto` on
the button spans it to the wrapper's far edge (the content edge), and `min-width: 0` beside it is
load-bearing rather than copied: this button is now a flex item of a **row**-direction wrapper, where the
automatic minimum size resolves against the main (horizontal) axis and is opaque to the label's own
`min-width: 0` / `overflow: hidden` ellipsis chain — unlike `.channel-list__row`, still a column child,
which needs no such declaration on itself. Without it an unbounded daemon `cwd` label would widen the row
past the 400px sidebar. The `:hover` fill (`--color-surface-container`, the file's own stand-in from when
the design pinned no hover state at all) is deleted outright: the redrawn Hover variant differs from Idle
by its controls alone, drawing no fill; `:focus-visible` stays, per the file's convention of treating it
as an outline rather than a statement about the drawn hover state.

**The plus** (`.channel-list__workspace-create`, Figma "Icon Edgeless" 399:1065) is a 20×20
(`--space-5`) absolutely positioned box at `right: 0; top: var(--space-1)`, centring a 16px glyph so it
reproduces the drawing's rectangle (right 2, top 6 in the 28px row) with no pixel literal — the same
box-minus-glyph-halved arithmetic `.channel-list__save`/`.channel-list__rename` already use one level up.
Filled `--color-primary`, no background, no hover circle. Reveal is `opacity` and never `display: none` /
`visibility: hidden` — #1171's ruling, restated here because the mechanism is what keeps the control
keyboard-reachable and present in the accessibility tree at rest, which is the acceptance criterion this
ticket names explicitly. The rule positions itself against the wrapper's own trailing edge rather than
against "being the only control", so #1180's 14×14 pen can land at `right: 28px` beside it without this
rule moving.

**Wiring rides one shared helper, not a per-tree map.** Since #1070's server loop, both the Channels and
Chats trees render through one `renderServerTrees`, so the per-tree difference has to travel as a
parameter rather than a code-path split: `renderServerTrees` takes an optional trailing `create` control,
its inner `workspaceGroups` closes over each group's own key and hands `CollapsibleWorkspaceGroup` a
nullary `create?: WorkspaceCreateControl`, which reaches `WorkspaceRow` unchanged — the same
optional-value shape `Row` already uses for `onSaveAsChannel`. `renderBody` builds one control object
per tree at its two `renderServerTrees` calls — the only place the two trees are told apart — and since
[#1179](create-channel-dialog.md) supplies one to **both**: the `channels` call's opens [the
Create-channel dialog](create-channel-dialog.md) instead of sending a command directly, the `discussions`
call's still fires `(cwd) => requestNewConversation(window.pyry.sendCommand, cwd)` — the FAB's own
constructor ([conversation-create.md](conversation-create.md)), and `requestNewConversation`'s **second
caller**, the first with a `cwd` that is not the client's own saved default.

**#1179 turned the threaded value from a bare callback into one object carrying a name too.**
`WorkspaceRow` used to hard-code `CREATE_CHAT_CONTROL_LABEL` on the plus's `aria-label`; once the
Channels tree needed its own label ("Create channel"), a second optional prop beside `onCreate?` would
have admitted a handler with no name and a name with no handler. Instead `CollapsibleWorkspaceGroup` and
`WorkspaceRow` both take one `create?: WorkspaceCreateControl` (`{ readonly label: string; readonly
onCreate: () => void }`, module-private to `ChannelList.tsx`), so the invariant is structural rather than
disciplined: a tree either offers a named create or offers none. See [Create-channel
dialog](create-channel-dialog.md) for the dialog itself, the `requestNewChannel` command constructor, and
the container state that opens it.

**The unknown-workspace group is withheld by its key, never by its label — in both trees since #1179.**
`groupByWorkspace`'s fallback bucket keys on `UNKNOWN_WORKSPACE_KEY` (`''`, exported by this ticket for
its first outside consumer), which names no directory and is **not** the same signal as the `cwd: null`
"take the daemon default" the create payload keeps distinct on the wire; sending `''` as a `cwd` would
ask the daemon to create in its own process directory. `renderServerTrees` compares the group's *key*
against the sentinel and withholds the `create` control there — never against `UNKNOWN_WORKSPACE_LABEL`
— so a real directory a user happens to name "Unknown workspace" is an ordinary group and keeps its
plus. #1179 reuses this same withhold for the Channels-tree plus with no new condition, since one
`create === undefined || group.key === UNKNOWN_WORKSPACE_KEY` check now gates both trees' controls.

**Security review note, carried forward because it is the first time this value crosses this
boundary:** `group.key` is `row.cwd`, daemon-asserted text that until now the sidebar only ever used as
an escaped React child, a `Map` key or a React key. This ticket hands it to `requestNewConversation` as
an *outgoing* command field for the first time. It travels verbatim — no normalisation, no trim, no
`path` module — because `isCreateConversationPayload` re-validates at the renderer→main boundary and
`daemonConnection.createConversation` rebuilds a fresh three-field literal before the send, and because
the reachable set of values is a strict subset of paths the daemon itself asserted (the client mints no
key but the withheld `''` sentinel). An oversized `cwd` fails closed the same way an oversized name
already does — `buildCreateConversation` throws on the plaintext cap and the send is dropped, never
partially written.

**The control's name**, `CREATE_CHAT_CONTROL_LABEL = 'Create chat'`, is a client-owned module constant
read by the plus's `aria-label`, in the `RENAME_CONTROL_LABEL` / `SAVE_AS_CHANNEL_CONTROL_LABEL` idiom
two rows up; #1181's tooltip pill becomes its second reader. #1179 added its sibling,
`CREATE_CHANNEL_CONTROL_LABEL = 'Create channel'`, for the Channels-tree plus — the two words differ
because the two trees create different things (an unnamed ad-hoc chat vs. a named, promoted channel),
and both constants are read exclusively at `renderBody`'s two `renderServerTrees` calls now, bundled
into their tree's `WorkspaceCreateControl` (see above). The daemon-supplied workspace label never
reaches an attribute of the control, on the same four-sink rule (`title`, `id`, a URL, a CSS custom
property) `WorkspaceRow`'s own comment already declines for the disclosure above it.

**Testing.** `ChannelList.test.tsx` counts `aria-label="Create chat"` once per Chats group and zero times
in the Channels slice, `aria-label="Create channel"` the reverse (since #1179), checks the plus's `<svg>`
for `width="16" height="16"`, and reconfirms `WORKSPACE_ROW_MARKER`/`WORKSPACE_LABEL_OPEN` still match
byte for byte at one per group now that the wrapper sits above the disclosure button. `createTagsIn`
widened from asserting one control to asserting both by their distinct labels — the one assertion #1179's
plan named as the cost of sharing `.channel-list__workspace-create` across both trees.
`e2e/sidebar-tree-geometry.spec.ts` retargets `WORKSPACE_ICON_X` to `CARD_INSET_PX + 28` and adds
`WORKSPACE_LABEL_X`, asserted equal to `TITLE_X`. `e2e/sidebar-workspace-create.spec.ts` (the Chats-tree
plus's own drive) seeds its clicked group's `cwd` at a path **other than** the fake harness's
`DEFAULT_CREATED_CWD` (`conversationStateFake` mints a created row at `payload.cwd ?? DEFAULT_CREATED_CWD`,
which happens to equal the default seed's own workspace) — otherwise a plus that silently sent `null`
would still land its row in the same group and the drive would pass with the bug present. It reads the
plus's box and opacity at rest/hover/focus (the last via a real Tab traversal, not `locator.focus()` —
the same `:focus-visible` modality trap #1171 already documents above), then clicks it and reads the row
count and the group's own row count going up before reading `aria-expanded` unchanged. Its seed is a
single **unpromoted** row, so #1179's Channels-tree plus renders no group at all and this spec's strict
`.channel-list__workspace-create` locator still resolves to exactly one element even though both trees
now draw that class — which is why #1179 needed no edit here. The Channels-tree plus's own drive,
covering the dialog it opens, is [`e2e/sidebar-create-channel.spec.ts`](create-channel-dialog.md#testing).

## The workspace row's plus names itself in a pill (#1181)

The plus #1178 and #1179 put on every workspace row was a bare glyph with an `aria-label` and nothing a
pointer could read. #1181 gives it #1172's own name pill: `.channel-list__control-name`, a plain
`aria-hidden` text-node `<span>` **appended after the `<svg>`** — never before it, since
`ChannelList.test.tsx` pins the glyph's opening run whole — reading `create.label`, the same
`WorkspaceCreateControl` field that already supplies the `aria-label` (§ above), so the drawn name and the
spoken one come off one definition per tree. `aria-hidden` is belt-and-braces (the button's `aria-label`
already overrides child text for the accessible name), kept because nothing else in either tier would
redden if it were dropped.

**The trigger is the control's own `:hover`/`:focus-visible`**, written beside
`.channel-list__workspace-create` rather than joined onto #1172's four-selector list, since each rule
names the elements that can carry a pill. Deliberately a *different* scope from the plus's own opacity
reveal (`.channel-list__workspace-head:hover`, which fires from the row so the glyph is visible before the
pointer reaches a 20px target): the name answers only the thing being pointed at, so hovering the row's
label shows nothing.

**Geometry needs no new number.** The pill is `right: 0; top: 50%; translateY(-50%)` inside the plus
itself (`position: absolute`, so it is the containing block); the plus is 20px tall at `top: var(--space-1)`
in the 28px head row, so its centre is the row's own centre, and the 24px pill spans 2…26 of that 28 —
inside the row's own band on every row, at any scroll position, which is what makes containment inside
`.channel-list`'s clipping scroller hold without a per-row proof. `right: 0` chains to the scroller's
content right edge, so the pill grows leftward and adds no horizontal overflow. Cost accepted as #1172
accepted it on the row's own controls: a hovered plus's pill covers the trailing ~90px of that row's label
for as long as the pointer sits on the 20px control. `pointer-events: none` (already on the shared class)
is what keeps the click-through working for every drive that clicks the plus with no prior hover.

**Reusing the shared class reached one shipped spec, and the break was worse than its count.**
`e2e/sidebar-control-name-pill.spec.ts` located `.channel-list__control-name` document-wide: two workspace
pills would have pushed its count from 41 to 43, and — since the workspace head precedes its group's rows
in document order — silently re-aimed `pills.first()` from the first row's Rename pill to the Channels
tree's own workspace pill, a count-only check would not have caught that. Fixed by scoping the locator to
`.channel-list__row .channel-list__control-name`, restoring every count and `first()`/`last()` to the
element it was written for, with no expected value moved.

**Testing.** `ChannelList.test.tsx` asserts each tree's pill as the closing-tag adjacency
`</svg><span class="channel-list__control-name" aria-hidden="true">…</span>`, a per-tree drift-guard
pairing the pill text with its `aria-label` count, and a byte-for-byte `createTagsIn` assertion catching
the one shape adjacency alone cannot — a child landing as an attribute instead of an element. New
`e2e/sidebar-workspace-plus-name-pill.spec.ts`: resting (both pills mounted and hidden), each plus's own
hover/focus showing its own text with the other still hidden, hovering the workspace label showing
nothing, the band-and-containment read at scroll top on the Channels row, and the click still landing with
no prior hover. Code review PASS, no findings.

## Related

- [Channel List home screen](channel-list.md) — the parent doc.
- [#1097 spec](../../specs/architecture/1097-desktop-24px-sidebar-row.md) — the row's geometry.
- [#1098 spec](../../specs/architecture/1098-sidebar-open-row-fill.md) — the open row's fill.
- [#1171 spec](../../specs/architecture/1171-sidebar-row-inset-and-hover-control.md) — the redrawn 8px
  inset and the hover-revealed trailing control.
- [#1172 spec](../../specs/architecture/1172-row-control-name-pill.md) — the control's own name pill.
- [#1178 spec](../../specs/architecture/1178-workspace-row-nest-and-create-chat-plus.md) — the workspace
  row's own 20px nest and its create-chat plus.
- [Create-channel dialog](create-channel-dialog.md) (#1179) — the Channels-tree plus's own dialog, the
  `requestNewChannel` command constructor and the `WorkspaceCreateControl` reshape this section
  documents.
- [Composer attach — the name pill](composer-attach-name-pill.md) — the treatment this restates, #1265,
  shipped first.
- [Save-as-channel dialog](save-as-channel-dialog.md), [Rename conversation dialog](rename-conversation-dialog.md)
  — the two dialogs the trailing controls open; their own CSS summaries were corrected for #1171's redraw.
- [Conversation create](conversation-create.md) — `requestNewConversation`'s constructor and the
  `conversationCreated` event-driven nav the plus's click resolves through; the FAB's own consumer doc.
- [Channel List — the host row's pen and plus on hover](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)
  (#1185) — this section's plus/pen pair brought up one level onto the host row, in the connection dots'
  own slot; superseded the "right padding goes to 0" bullet above.
