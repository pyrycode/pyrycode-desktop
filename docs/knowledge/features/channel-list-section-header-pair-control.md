# Channel List — the section header's pair-new-host control

Split out of [Channel List home screen](channel-list.md) rather than folded into the parent, which is
close enough to the doc-guard's 50000-byte cap (`npm run check:docs`) that this control's markup, CSS and
accessible-name detail would have pushed it over. Everything about the screen's rows, view-model and
workspace grouping stays on the parent page; the origin-aware cancel this control's plus reaches into is
documented in [Paired shell — routing § The pair-new-host plus and origin-aware
cancel](paired-shell-routing.md#the-pair-new-host-plus-and-origin-aware-cancel-1303).

## What it is (`ChannelList.tsx`/`channels.css`, added by [#1303](https://github.com/pyrycode/pyrycode-desktop/issues/1303))

Both section headers — `<header className="channel-list__section-header">Channels</header>` and its
`Chats` twin — now render through a shared `SectionHeader({ label, onPairNewHost })` component instead of
a bare string child. The drawing (Figma `Sidebar header` `405:7885` under Channels, the identical instance
`405:7896` under Chats) places one component under each section, so neither is a special case and there is
no per-tree difference in the markup, the CSS or the wiring. `renderBody`'s two call sites become
`<SectionHeader label="Channels" onPairNewHost={onPairNewHost} />` and the `Chats` twin — the header's own
`class` attribute is unchanged, still exactly `channel-list__section-header`, since
`ChannelList.test.tsx`'s `SECTION_HEADER_MARKER` is a quote-anchored substring count five specs read and
`e2e/sidebar-tree-geometry.spec.ts`/`e2e/paired-shell-card.spec.ts` both locate on that class.

Clicking the plus opens the pairing flow — the same `pairServer` route Settings' "Pair another server" row
opens (see [the pairServer route](paired-shell-pair-server-route.md)). It reaches no daemon and touches no
store by itself; it is a pure injected nav effect, the `SettingsButton`/`ArchiveButton` shape.

## The accessible name is a module-level constant, never a prop

`PAIR_NEW_HOST_CONTROL_LABEL = 'Pair new host'` — `HostRow`'s ruling from
[`channel-list-host-row.md`](channel-list-host-row.md), applied for the identical reason: with no `label`
field on `SectionHeader`'s props there is no slot for a caller to interpolate untrusted operator or daemon
text into an `aria-label`, the exact shape [#696](../codebase/696.md)'s review made a MUST FIX. Both
headers carry the same name by design — the drawing places one component under each section — so the
`aria-label="Pair new host"` locator (and the `getByRole('button', { name: 'Pair new host' })` Playwright
query) is a two-match locator by construction, indexed by position rather than differentiated by name; an
added distinguishing name would be copy the design does not have.

## Geometry (`channels.css`)

`.channel-list__host-add`'s block (the host row's own hover-revealed plus) with one number changed and one
rule deleted:

- **A `--space-5` (20px) box, `top: 0; right: 0`, centring a `--space-4` (16px) glyph.** The node places
  the 16px glyph at `right: 2px`, centred on the header's 20px line. A 20px box centring a 16px glyph puts
  the glyph's right edge at 2 — the box's 4px of slack, halved — with no `2px` literal anywhere in the
  rule. The header's content line is exactly 20px (`line-height: var(--text-label-large-line)`), so
  `top: 0` lands the box on the line directly, rather than the rows' `--space-1` offset.
- **Absolutely positioned, so it adds no box.** The header's own 20px line and its 12px bottom padding —
  and the 32px that padding puts between the header's top and the first host row, which AC5 pins as
  unchanged — are untouched. `e2e/sidebar-tree-geometry.spec.ts` and the ticket's own
  `e2e/sidebar-pair-new-host.spec.ts` both read this back from a running window rather than trusting the
  arithmetic.
- **`.channel-list__section-header` gained `position: relative`** — the containing block the absolutely
  positioned button needs. Without a nearer one the control would pin itself to the scroll column
  (`.channel-list`, itself `position: relative` for its own stacking reason) rather than to its own
  header. `.channel-list__row`'s idiom exactly, and `.channel-list__host`'s (since #1185).
- **Drawn at rest, not hover-revealed — the one place `.channel-list__host-add`'s block must NOT be
  copied wholesale.** The host-row and workspace-row plusses are `opacity: 0`, revealed by their row's
  `:hover`/`:focus-within`; the drawing shows this control filled `--color-primary` in every state it
  draws, at rest. There is no reveal rule, no `:has()`-guarded swap, no hover circle, no radius and no
  background. The `:focus-visible` outline stays, per the file convention, but no longer doubles as a
  reveal, since there is nothing to reveal — [#1304](https://github.com/pyrycode/pyrycode-desktop/issues/1304)
  gave the control its own name instead (below).

## The hover/focus name pill (`channels.css`/`ChannelList.tsx`, added by [#1304](https://github.com/pyrycode/pyrycode-desktop/issues/1304))

The fourth control in the sidebar to wear `.channel-list__control-name` — minted by #1172 for the row's
trailing controls, reused by #1181 for the workspace row's plus. `SectionHeader`'s button gains a
`<span className="channel-list__control-name" aria-hidden="true">{PAIR_NEW_HOST_CONTROL_LABEL}</span>`
appended after the `<svg>`, so the spoken name (`aria-label`) and the drawn one read the same constant and
cannot drift; there is still no `label` prop anywhere in this chain for a caller to interpolate operator or
daemon text into either. `aria-hidden` is belt-and-braces — the button's `aria-label` already overrides
child text for the accessible name, which stays exactly "Pair new host" at count two whether or not a pill
is showing.

The trigger is the control's own `:hover`/`:focus-visible`, written beside `.channel-list__pair` rather
than joined onto #1172's or #1181's selector list (#1181's convention: each rule names the elements that
can carry a pill). Unlike the row and workspace controls there is no glyph-reveal rule sharing that
selector — this control draws at rest — so the pill's trigger is the *only* hover/focus rule on it. Shown
and hidden are `display: block`/`none`, never opacity, so a hidden pill reports no box at all.

**Placement is a stated deviation from the three shipped instances**, discovered by measurement rather
than assumed. The shipped form centres the pill on its control's own band (`top: 50%` +
`translateY(-50%)`); here that band collides with `.channel-list__actions`, the Channels header's
immediately preceding sibling. The flow read — "gapless column, no margins, so the cluster's bottom edge is
the header's top edge" — is wrong: the cluster is `position: sticky; top: var(--space-1)`, and a sticky
offset resolves against the scrollport's **content** box, i.e. inside `.channel-list`'s own `--space-1` top
padding, so at scroll top the cluster sits `--space-1` *past* its flow position. Read off a running window
at scroll top: the cluster's bottom edge is at 76; band-centring puts the pill's top at 70; top-aligning
(`top: 0`) puts it at 72 — both under a cluster painting at `z-index: 1`, and reachably so (the cluster's
buttons are transparent at rest but fill on `:hover`, while the pill can be up on the plus's
`:focus-visible`). So the pill hangs **below** the control instead — `top: 100%; transform: none`, landing
at 92, clear of the cluster by the plus's own height — overriding only those two declarations; the ground,
ink, type, padding, radius, `right: 0`, `pointer-events: none` and `nowrap` are all the shared block's.
Declined: `top: var(--space-1)` (centred in the header's 32px box) clears the cluster too, but only by an
exact tangency a one-pixel change would reopen, while covering the glyph it names.

**The move downward changes what the pill sits under, not just what it clears.** `.channel-list` is
deliberately not a stacking context (`position: relative; z-index: auto`), and `.channel-list__section-header`
and `.channel-list__host` are both `position: relative` with `z-index: auto` — the same stacking-context
slot — so tree order decides and the first host row's subtree paints *after* the header's. The pill's 24px
(top 92, header top 72) falls inside the header's 12px bottom padding and 12px of the first host row, which
puts it under that row's own `position: absolute` furniture — `.channel-list__host-status` (the connection
dots) and `.channel-list__host-add` — rather than the other way around. `pointer-events: none` is what
keeps a click through the pill landing on the plus regardless of what's on top; no `z-index` fixes the
paint order without also lifting the pill over the sticky actions cluster it was moved to clear. See
[Channel List — the host row § Geometry](channel-list-host-row.md) for that row's own furniture, and note
this for [#1190](https://github.com/pyrycode/pyrycode-desktop/issues/1190) before giving the host row its
own pill in the same file.

**The colour trap, read by name rather than by export.** `get_design_context` on the Pill node
(`347:6617`) prints `--schemes/primary-container`/`on-primary-container` transposed against `tokens.css`;
the node's own screenshot (dark ground, light ink) is what actually settles it. The shipped pill reads
`--color-primary-container` (ground) and `--color-on-primary-container` (ink) by name, matching
`rgb(19, 74, 116)` ground / `rgb(207, 228, 255)` ink — the fourth ticket in a row to hit this transposition,
and the e2e computed-colour read is the only tier that can see it at all.

**The class, `channel-list__pair`, shares no token** with `channel-list__row`, `__row-open`,
`__section-header`, `__workspace` or `__host` — Playwright runs locators in strict mode, and an element
joining an existing locator's match set raises a strict-mode violation rather than a clean assertion
failure; 28+ specs ride `launchPairedApp`'s unfiltered `.channel-list__row-open` click. This is the same
naming discipline `.channel-list__workspace-head` (#1178) and `.channel-list__host` (#1185) already
follow in this file.

**`channels.css`'s head paragraph, which argues `.channel-list`'s own `position: relative` lifts the whole
subtree above the sidebar card's `::before` wash in paint order, used to rest that argument on the section
header being the *last unpositioned level* of the tree.** #1303 ended that: with the header now
`position: relative` too, every level of the tree is positioned and no descendant is the element the
argument turns on any more. Nothing broke — the declaration lives on `.channel-list` itself and lifts the
subtree regardless of what its descendants do — but the paragraph was re-stated rather than left claiming
an unpositioned element that no longer exists. The reasoning still holds for a text node: the headers'
`label` text has no position of its own to be lifted by, so `.channel-list`'s own `position: relative`
remains the thing actually doing the lifting.

## Wiring

`onPairNewHost: () => void` is required at every level of the chain it travels: `ChannelList` (the
container) → `ChannelListView` (the pure view) → `renderBody` → both `SectionHeader` instances — one hop
longer than `onOpenSettings`, which stops at `ChannelListView`, because `renderBody` is what actually
draws the headers. Required rather than optional for `onCreateChat`'s reasoning, restated at each level:
a defaulted prop would let a future caller silently render a sidebar whose headers show a plus that opens
nothing. `PairedShell` binds it to the *same* `onOpenPairServer` handler `SettingsScreen` already receives
as `onPairAnother` — one act, one handler, reused rather than given a second name — which is also why
`PairedShellView`'s six render literals in `PairedShell.test.tsx` needed no edit for this ticket. See
[Paired shell — routing § The pair-new-host plus and origin-aware
cancel](paired-shell-routing.md#the-pair-new-host-plus-and-origin-aware-cancel-1303) for what the
container does with that click and why cancelling from it no longer always lands on Settings.

## Testing

**Unit (`ChannelList.test.tsx`, static server render).** The new prop joins the `render()` harness; the
static markup carries `aria-label="Pair new host"` exactly twice in every drawn state;
`SECTION_HEADER_MARKER` still counts 2 (the header's own class attribute is unchanged); the new
`channel-list__pair` class occurs twice and is absent from the not-yet-loaded frame.

**E2E, fake tier (`e2e/sidebar-pair-new-host.spec.ts`), one launch, one continuous drive** — the
`paired-shell-navigation.spec.ts` posture, since none of the drive's transitions mutates persistent or
session state (cancel reaches no server) and each launch pays a full handshake. Reads the glyph's box
against its header's box first (right edge 2px in, vertically centred on the 20px line, header box still
32px), with no `hover()` anywhere in that block — deliberately, since unlike the row controls this one has
no reveal rule to accidentally paper over. Then drives all three cancel origins in one window: a plus
clicked with a thread open (cancel → thread, positive-first: `.conversation` re-attaching is read *before*
the negative "did not go to the list" check, `a-closing-tohavecount-zero-needs-a-positive-wait-before-it`'s
trap), a plus clicked from the list (cancel → list), and Settings → "Pair another server" → Cancel (cancel
→ settings) — the shipped path, re-driven here even though `paired-shell-navigation.spec.ts` already
covers it, because a regression in the new origin-recording machinery is what this spec exists to catch.
The real-daemon tier is untouched.

**E2E, fake tier (`e2e/sidebar-section-header-plus-name-pill.spec.ts`, added by #1304), one launch, one
continuous drive** — the `sidebar-workspace-plus-name-pill.spec.ts` model. Pushes an unsolicited tall
`conversations` envelope first so "at scroll top" is a scroller position rather than a list that never
moved, then drives both headers' pills through mount/hidden, hover, computed style (the colour-trap
detector), geometry (24px tall, top edge on the header's top edge, right edge on the header's right edge,
and the **actions-edge criterion** — the pill's top at or below `.channel-list__actions`'s bottom, which is
the assertion the deviation exists for and the one band-centring reddens), trigger scope (hovering the
label alone shows nothing), keyboard `:focus-visible` via a real `Tab`, and a click-through proving
`pointer-events: none` still lands on the plus. Neither sibling pill spec
(`sidebar-control-name-pill.spec.ts`, `sidebar-workspace-plus-name-pill.spec.ts`) needed an edit — both
were already scoped to their own control's class, unlike #1181's edit to the row spec.

## Related

- [Channel List home screen](channel-list.md) — the parent document; § What it does links back here.
- [Channel List — the host row and its connection dots](channel-list-host-row.md) — `HostRow`'s
  compile-time-constant accessible-name ruling this control inherits, the hover-revealed plus/pen pair
  this control's "drawn at rest" geometry deliberately departs from, and the row furniture this control's
  pill now paints under (§ Geometry) — read before giving that row its own pill in #1190.
- [Channel List — the row's desktop geometry § The workspace row's own nest and its create-chat
  plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
  (#1178) — the class-isolation precedent (`channel-list__workspace-head`) and the same glyph path.
- [Paired shell — the pairServer route](paired-shell-pair-server-route.md) — the screen this control's
  plus opens.
- [Paired shell — routing § The pair-new-host plus and origin-aware
  cancel](paired-shell-routing.md#the-pair-new-host-plus-and-origin-aware-cancel-1303) — the routing half:
  `pairServerReturn`, `nextPairedRoute`'s `returnTo` payload, and why cancelling from a section-header plus
  no longer always lands on Settings.
- [#1303 spec](../../specs/architecture/1303-section-header-pair-new-host.md) — the design doc, its
  Revisions section recording that `PairedShell.test.tsx` needed one line after all (not zero, as
  predicted) and that the e2e drive was falsified-before-trusted against a hardcoded `'settings'`.
- [#1304 spec](../../specs/architecture/1304-section-header-plus-name-pill.md) — the design doc; its
  Revisions section records the placement moving from top-aligned to `top: 100%` after the actions-cluster
  measurement contradicted the original flow arithmetic.
- [Channel List — the row's desktop geometry § The workspace row's plus names itself in a
  pill](channel-list-desktop-row-geometry.md#the-workspace-rows-plus-names-itself-in-a-pill-1181) (#1181) —
  the shipped `.channel-list__control-name` treatment this ticket's pill reuses verbatim bar two
  placement declarations.
