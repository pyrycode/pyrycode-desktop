# Channel List — the row's desktop geometry (`channels.css`/`ChannelList.tsx`, converged by #1097, marked by #1098)

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
  none, and #1097 left the wrapper's own corner to whichever ticket decided the spanning fill — see
  § The open row's fill below, which is that ticket.

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

Two more rules complete it: `.channel-list__row-open[aria-current='true']:hover { background: none }`
suppresses the button's opaque `--color-surface-container` hover, which would otherwise paint over the
wrapper's fill across the button's share of the row (its (0,3,0) beats the base rule's (0,2,0), so it
wins on specificity, not source order); `.channel-list__row-open[aria-current='true'] >
.channel-list__title { font-weight: var(--text-body-small-weight-emphasized) }` is the one-declaration
step from body-small to `M3/body/small-emphasized` (500) — the two type tiers differ in weight alone.
`:focus-visible` is untouched on every row (#274's ruling that the two affordances highlight
independently still stands), and so are the trailing controls' own hover circles — the node draws no
trailing control at all.

**Lessons learned, folded in at their sites above:**

- **A wrapper's computed `background-color` cannot see a child painting over it.** The natural assertion
  for "hovering the open row leaves its fill unchanged" reads the row's own background — and it passes
  whether or not the button's hover is suppressed, since a parent's computed style is unaffected by a
  child's paint. Only the button's own computed background detects the suppression rule; noted at the
  e2e assertion rather than trusted.
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

## Related

- [Channel List home screen](channel-list.md) — the parent doc.
- [#1097 spec](../../specs/architecture/1097-desktop-24px-sidebar-row.md) — the row's geometry.
- [#1098 spec](../../specs/architecture/1098-sidebar-open-row-fill.md) — the open row's fill.
