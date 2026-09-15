# Channel List — the open row's fill (`ChannelList.tsx`/`channels.css`, #1098)

Split out of [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md), the map
page for this row's geometry history, once that page grew past the doc-guard's 50000-byte cap
(`npm run check:docs`). Read the map page first for the surrounding context.

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
rule's (0,2,0), so it won on specificity, not source order). [#1171](channel-list-row-hover-control.md)
deleted that suppression rule outright — the row's hover fill moved off the button and onto the
wrapper, so nothing paints on the button on hover any more and there is nothing left to suppress. The
ruling itself (the open fill wins over the hover fill) is unchanged; it is enforced by the new
`.channel-list__row:hover` rule's lower specificity against `:has()`, recorded on that page.
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

## Related

- [Channel List — the row's desktop geometry](channel-list-desktop-row-geometry.md) — the map page.
- [#1098 spec](../../specs/architecture/1098-sidebar-open-row-fill.md) — the open row's fill.
- [Channel List — the row's 8px inset and its hover-revealed control](channel-list-row-hover-control.md)
  (#1171) — moved the hover fill off the button and onto the wrapper, resolving this page's own "Lessons
  learned" workaround.
- [Conversation status dot](conversation-status-dot.md) — the dot's own idle-fill rule, added by #1174.
