# #1172 — hovering Rename or Save as channel shows its name in a pill

A sidebar row's two trailing controls are bare 12px glyphs since #1171, revealed by the row's hover. This
slice names them: hovering (or keyboard-focusing) one shows a Pill reading that control's own name.

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `Row` — the two icon-only buttons this ticket
  adds a child to, and the two `aria-label` literals it lifts into constants.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__save` / `.channel-list__rename` —
  the controls' shipped block. Both are `position: absolute` with `height: var(--space-6)`, which is what
  makes them a containing block of exactly the row's own height. `.channel-list` above them is
  `overflow-y: auto` (so it clips on both axes) with `padding: var(--space-1) var(--space-5) var(--space-6)`;
  `.channel-list__row` is `position: relative` with `margin-left: var(--space-7)`.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__attachment-name` — the shipped
  Pill treatment (#1265) this restates. Read, not edited, not lifted.
- `docs/knowledge/features/composer-attach-name-pill.md` — #1265's lessons: `display` over
  `opacity`/`visibility` so a hidden pill reports no box; `pointer-events: none` because the pill sits
  over something the pointer must stay free to reach; and the rework finding that a criterion-keyed grep
  (`toContainText` / `hasText` across `e2e/`), not a symbol-keyed one, is what surfaces the specs a new
  text node collides with. That grep is run below.
- `src/renderer/src/theme/tokens.css` → `--color-primary-container` `#134a74`,
  `--color-on-primary-container` `#cfe4ff`, the `--text-body-small-*` quad, `--space-1` / `--space-2`,
  `--radius-xs` — the pill's whole vocabulary, and the pair the Figma export transposes.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `SAVE_MARKER` / `RENAME_MARKER` /
  `rowChunksIn` — the shipped attribute runs a new child element must leave byte-identical.
- `e2e/sidebar-row-geometry.spec.ts` → the second `test()` block — the shipped keyboard-focus idiom
  (`.channel-list__row-open` focus, then `Tab`) this ticket's e2e copies, and its stated reason.
- `e2e/composer-attachment-name.spec.ts` — the drive shape and the transposition-detector constants.
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW`, `seedConversationsFrame`, and the launch drive's
  single strict `.channel-list__row-open` click — which is why a tall list cannot be the launch seed.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=347-6617

The Pill is a single-line label box: a dark navy ground behind a 6px corner, light blue text at
body-small regular (12/16, tracking 0.4), 4px above and below and 8px each side, hugging its text with no
wrap. The rows it sits on (103:2985, 106:3272) draw no tooltip of their own — the Pill is the treatment
this ticket borrows onto them.

**The export's two colours are transposed and neither hex is used.** `get_design_context` on the node
prints `bg-[var(--schemes/primary-container,#cfe4ff)]` over
`text-[color:var(--schemes/on-primary-container,#134a74)]` — the reverse of `tokens.css`, where
`--color-primary-container` is `#134a74` and `--color-on-primary-container` is `#cfe4ff`. The screenshot
settles it: dark ground, light ink, which is what the tokens read **by name** produce. This is the trap
#1262, #969 and #1265 each hit; the e2e's two computed-colour constants are its detector.

## Context

Both controls are icon-only buttons whose only affordance is a 12px glyph, and since #1171 that glyph is
invisible until the row is hovered. Nothing names them. `title=` is not an option and is not the shape
being reached for anyway — it is declined across this file for daemon text, and these two strings are
client-owned constants, so the reason here is simply that the design draws a Pill and `title` is not it.

No ADR is warranted: this adds no decision the token layer and #1265's page do not already record.

## Design

### The markup

`Row` gains two module-level constants, each used for both the button's `aria-label` and its pill's text,
so the two cannot drift:

```
const RENAME_CONTROL_LABEL = 'Rename'
const SAVE_AS_CHANNEL_CONTROL_LABEL = 'Save as channel'
```

Each control gains one child, **appended after its `<svg>`**, never inserted before it:

```
<span className="channel-list__control-name" aria-hidden="true">{RENAME_CONTROL_LABEL}</span>
```

Appending is load-bearing for the unit tier: `ChannelList.test.tsx` asserts each glyph as a whole opening
run (`<svg class="channel-list__save-icon" viewBox="0 -2.46 12.12 12.12" width="12" height="12"`), and a
child after the closing `</svg>` leaves both runs byte-identical. The `aria-label` attributes keep their
position in source order, so `SAVE_MARKER` / `RENAME_MARKER` and their counts are untouched — the pill's
text is a bare text node, not an `aria-label="…"` run, so `countOf` cannot confuse the two.

`aria-hidden="true"` is belt-and-braces rather than the mechanism: a button's `aria-label` already
overrides its child text for the accessible name. It is what AC4 asks for, and it makes the claim true by
construction instead of by an accessible-name computation rule a reader has to know.

### One shared class, and why that is safe here

Both pills wear `.channel-list__control-name`. This is a **new class on a new element**, so it degrades no
shipped assertion: the hazard a shared class carries is turning an existing `class="x"` into
`class="shared x"`, which silently breaks whole-attribute-run assertions — nothing here changes an
existing class attribute. AC4's four protected tokens (`__save`, `__rename`, `__save-icon`,
`__rename-icon`) are untouched.

`conversation.css` and `ComposerAttach.tsx` are **not** edited and `.composer__attachment-name` is **not**
lifted, per the ticket. Both blocks read the same tokens by name and are anchored to the same node, so the
drift risk sits in the token layer where it belongs.

### Placement — inside the row's own vertical band, right-aligned to the control

The ticket's cheapest route, chosen because it makes the containment criterion hold by construction on
every row rather than on the rows a test happens to reach. The arithmetic, all of it from the shipped
control block:

- The control is `position: absolute; top: 50%; transform: translateY(-50%); height: var(--space-6)` — a
  24px box centred on a row whose 24px is derived from `.channel-list__title`'s 16px line plus
  `.channel-list__row-open`'s 4px padding. Control box and row band **coincide**.
- The pill is `position: absolute; top: 50%; transform: translateY(-50%)` inside it, and is itself 24px
  tall (`--space-1` + the 16px body-small line + `--space-1`). So the pill's box coincides with the row
  band too, and containment inside `.channel-list` follows from the row being in view — on the first row,
  on the last row, and at any scroll position.
- `right: 0` pins it to the control's padding-box right edge, which is the row's right edge, which is
  `.channel-list`'s content right edge. The pill therefore grows **leftward** and can reach neither
  horizontal edge. That is also what keeps the scroller unscrolled horizontally: an out-of-flow box
  contributes scrollable overflow only where it overflows right or bottom.

The two alternatives are declined: flipping below when there is no room above solves a problem this
placement does not have, and rendering outside the scroller needs a portal plus a scroll-synced position
for the same result.

**The cost, stated rather than hidden:** while a control is hovered, its pill covers the trailing ~104px
of that row's title. The ticket accepts this explicitly, and the pill is up only while the pointer is on
a 36 × 24 control.

`pointer-events: none`, the composer pill's reason applied to a different neighbour: the pill overlays the
row's own open button, and a click aimed at the row — or Playwright's hit test on the nine shipped specs
that click these controls without hovering first — must read straight through it. It also means the pill
cannot hover itself, so there is no feedback loop with the trigger below.

### The trigger

`display: none` → `display: block`, fired by the **control's own** `:hover` and `:focus-visible`, never
the row's — AC1's "hovering the row's title alone shows no pill" is exactly that scoping. Four selectors,
two per control, each naming the control it fires from.

`display` and not `opacity`/`visibility`, for #1265's stated reason: a hidden pill then holds no
accessibility-tree entry and reports **no box at all**, so a test tells "showing" from "hidden" by the
kind of answer it gets rather than by comparing a number against itself. (This is the opposite of the
ruling on the *control*, which must stay `opacity: 0` because nine specs focus or click it unhovered —
these two rulings are about different elements and do not conflict.)

The control's existing `:focus-visible { opacity: 1 }` is what makes the keyboard case visible: the
control turns opaque and its pill turns `block` off the same pseudo-class.

### No `max-width`, no ellipsis chain

Unlike `.composer__attachment-name`, which bounds an untrusted daemon filename of unbounded length. Both
strings here are client-owned compile-time constants; the longer computes to ~104px inside a 332px row
(400px sidebar − 2 × `--space-5` − the row's `--space-7` inset). An ellipsis chain would defend a case
that cannot occur. `white-space: nowrap` alone is what AC2's "one line" asks for.

### State, concurrency, errors

None of each, and that is the design rather than an omission: two pseudo-classes are the whole mechanism.
No store, no `useState`, no effect, no IPC, no `window.pyry`, no async work to cancel, no failure mode to
surface, and no daemon-derived string anywhere near it. No log line — a hover is not an event, and the
only thing a useful one could carry is which row the pointer is on.

## Testing strategy

**Unit — `ChannelList.test.tsx`** (static render, the only tier that can assert adjacency): each row kind
emits its pill as the control's last child with its constant text and `aria-hidden`, asserted as the
closing-tag adjacency `</svg><span class="channel-list__control-name" aria-hidden="true">Rename</span>`
so a pill that drifted *before* the glyph fails rather than passing on a substring. The shipped
`SAVE_MARKER` / `RENAME_MARKER` counts and the byte-stability test cover the rest and are not edited.

**E2E — `e2e/sidebar-control-name-pill.spec.ts`** (new, fake transport). One launch, one continuous
drive; every absence assertion placed after a positive auto-waiting read of the same gesture's own effect.

- *The tall list.* `launchPairedApp` reaches the thread by clicking a single **strict**
  `.channel-list__row-open`, so a multi-row list cannot be the launch seed. It is pushed after launch as
  an unsolicited `conversations` envelope (`daemon.pushFrame`, the fixture's own idiom — the inbound
  `conversations` arm dispatches on the inner frame's `type` with no correlation-id match), carrying
  `SEEDED_ROW` so the open row is not orphaned plus ~40 promoted rows. Nothing in this drive mutates the
  list, so nothing re-fires `list_conversations` and the pushed list stands.
- *Resting:* every pill is mounted and every pill is hidden — a count **and** a hidden-ness, since an
  absent pill satisfies `toBeHidden` vacuously.
- *Hover the Rename control:* its pill visible, text exactly `Rename`, siblings still hidden; the drawing
  as computed values (ground, ink, weight, size, line, tracking, radius, both paddings, `nowrap`,
  `position`, `pointer-events`) — the two colours being the transposition detector.
- *Containment*, the criterion: the pill's box lies inside `.channel-list`'s own box, proven with the list
  scrolled to the top on the first row, scrolled to the bottom on the last row, and — the case an
  above-the-row placement actually clips — on the row sitting flush against the scroller's **top** edge
  while scrolled, found by one in-page read of the rows' rects rather than by an index guess. While a
  pill shows: `.paired-shell__sidebar` still 400px wide and `.channel-list`'s `scrollWidth` no greater
  than its `clientWidth`.
- *Hover the Save-as-channel control:* pill text exactly `Save as channel`.
- *Hovering the title alone:* `.channel-list__title` hovered, every pill hidden — ordered after a positive
  read so it measures the scoping and not a pill that never showed.
- *Leave:* pointer parked off the list, pill hidden.
- *Keyboard:* focus `.channel-list__row-open`, press `Tab`, assert the control is focused and its pill
  shows; blur hides it. `Tab` and never `locator.focus()` — `:focus-visible` is Chromium's
  keyboard-modality heuristic and a programmatic focus after a pointer interaction does not match it,
  which is the reason `sidebar-row-geometry.spec.ts` already records for the same control.

**Collision check, run at plan time** (#1265's rework lesson, keyed on the criterion rather than the
symbol): `toContainText` / `getByText` / `toHaveText` / `hasText` across `e2e/`. Four candidates, all
clear — `conversation-state-fake.spec.ts` scopes `getByText` to `.channel-list` but with `exact: true`
against `Renamed channel` / `Original channel`, neither equal to a pill string;
`settings-per-server-unpair.spec.ts` reads `.channel-list__title` in array form, which the pill is not;
`host-row-per-server.spec.ts` filters `.channel-list__row-open` by `hasText`, and the pill is a child of
the *sibling* control, not of that button; `conversation-create-rename.spec.ts` scopes its `Rename`
role-query to `.conversation`, still disjoint from the sidebar. No spec is edited.

Real-daemon and real-claude tiers are untouched.

## Open questions

- Whether the row-band placement reads as intrusive in daily use once the title is partly covered. The
  ticket names `transition-delay` as the knob if it flickers; neither is added now, on the same
  evidence-based rule — no delay is drawn and none has been observed to be needed.
