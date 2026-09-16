# 1507 — the host row folds its workspaces, with a chevron

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRow` — the static `div` this ticket turns
  into a disclosure; its four-sink rule for the untrusted label and the compile-time-constant control
  names both hold unchanged over the new button.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRowControl` — the store-bound container that
  derives `failed` from `selectStatusFor` and gates the plus on `connected`; the status read moves one
  level up in this ticket.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `CollapsibleWorkspaceGroup` — the model for the
  new group: one `useState`, `defaultExpanded` as a mount-time seed, `{expanded && children}`, and a
  fragment that emits no element. Its docblock is the authority on why the state lives at this scope.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow` — the `hasRows`-gated chevron and
  the `aria-expanded` disclosure one level down, reproduced here on the host row's own terms.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderServerTrees` — the level that already
  computes each host's workspace groups, and so the level that can answer "has this host anything to
  fold" without counting a `<Fragment>`'s children.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host` — its `gap` block states in as
  many words that the 12 is inert and is the chevron's, to be re-derived to 6 by this ticket.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host-icon` — absolutely placed at
  `left: 0` against **the row**; the reason the new button must NOT be `position: relative`.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace` — the `<button>`
  inheritance repairs (`font-family`, `color`) and the `flex: 1 1 auto` / `min-width: 0` pair this button
  needs for the same reasons.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-chevron` and its
  `[aria-expanded='false']` rule — the art's box, the `margin-top: 2px` derivation and the quarter turn,
  all reused here.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host--failed` (three rules) and
  `.channel-list__host-repair` — what the failed row's markup must keep describing.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `HOST_ROW_MARKER`, `HOST_ICON_MARKER`,
  `HOST_LABEL_OPEN`, `DOT_WRAPPER_MARKER` and the exact-opening-tag assertion — the pins this structure
  must leave byte-identical.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `describe('the drawn fold state (#1487)')` —
  the unit-tier shape this ticket's cases mirror.
- `e2e/workspace-collapse.spec.ts` — the interaction spec this ticket's new spec is modelled on: one
  launch, one sequential drive, the composer draft as the "nothing else happened" anchor.
- `docs/knowledge/features/channel-list-host-row.md` § "The row's pen and plus on hover (#1185)" — the
  standing constraint that 21 e2e reads locate a control, a dot or a name pill as a **descendant** of
  `.channel-list__host`.

Codegraph was unavailable in this worktree (`codegraph_context` answered *CodeGraph not initialized for
this project*), so the reading list above was built by grep and Read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=399-1366

A 28px row on the card's content edge: the 12px server-rack glyph absolutely placed at left 0, the label
at 24 in M3 title-small on full-strength on-surface, and — packed immediately after the label at a 6px gap
— a small `Chevron` 510:2384, a 20px-tall box centring a 10px chevron instance whose art is inset 2px from
the top and the sides. Idle and Hover both draw that chevron in its base right-pointing orientation; the
trailing slot holds the two 6px connection dots at rest and swaps them for the pen and the plus on hover.
The Pairing Issue variant (486:838) paints the glyph and label `error-container` red, draws the repair plug
in the trailing slot, and draws **no chevron at all**.

## Context

`HostRow` is a static `div` that folds nothing. The redrawn Host component gives it a disclosure and a
fold mark, so a long sidebar can collapse to the machines the operator is not working on. The level below
already shipped exactly this (#704's restructure, #1487's chevron), and #1506 has already moved the glyph
out of the flow and put the row's whole 24px inset on the label — so this ticket touches no geometry
constant and reuses both the chevron art and its quarter-turn rule.

The refiner measured this at ~850 lines against the 800-line boundary and declined the finer cut on a
stated, measured difference (a chevron-less host fold ships a disclosure no sighted operator can read,
because the host's server-rack glyph does not swap the way the workspace row's folder does). I agree and
build it whole: the overage is ~6%, the alternative class placement it rules out was measured at ~200
further lines of e2e retune, and the declined slice would have been a one-consumer child of this one.

**One discrepancy in the drawing, ruled on rather than reproduced.** Idle and Hover draw the chevron
right-pointing while the placement frame ([Channels 103:2966](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2966))
shows those same hosts expanded with their subtrees beneath them. The drawn orientation is the component's
base art, not a claim that a resting host is collapsed. Down-when-expanded is the behaviour, matching the
row one level down; a host starts expanded, so the shipped sidebar looks unchanged on launch.

No ADR is warranted: this is #704's and ADR 0006's scope decision applied one level up, not a new one.

## Design

### The structural call: `.channel-list__host` stays on the row

The class stays on the element that still contains every part of the row, and the disclosure gets its own
token, `channel-list__host-disclosure`. Four CSS families reach the trailing controls *through*
`.channel-list__host` and 21 e2e reads across six specs locate a control, a dot or a name pill as its
descendant; moving the class onto the button breaks all of them at once for nothing but symmetry. The
button is a *child*, so the row's own attribute run is untouched — which is what leaves `HOST_ROW_MARKER`,
`HOST_ICON_MARKER`, `HOST_LABEL_OPEN`, `DOT_WRAPPER_MARKER` and the exact-opening-tag assertion matching
byte for byte, the `--failed` modifier's three rules describing the same elements, and `paired-shell-card`'s
`closest()` hit test resolving through the inner button to the row.

`channel-list__host-disclosure` is a **distinct class token**, so `.channel-list__host` does not match it
(CSS class selectors match whole tokens) and `'class="channel-list__host"'` — the unit tier's
quote-anchored substring — does not occur in it either.

### The new element tree

```
div.channel-list__host                       (unchanged tag, unchanged class attribute)
├─ button.channel-list__host-disclosure      [aria-expanded]   ← new, when foldable
│  ├─ svg.channel-list__host-icon            (moved in; still absolute against THE ROW)
│  ├─ span.channel-list__host-label          (moved in)
│  └─ svg.channel-list__host-chevron         ← new, when hasWorkspaces
├─ span.channel-list__host-status            (unchanged, absolute)
├─ button.channel-list__host-repair          (unchanged, absolute)
├─ button.channel-list__host-edit            (unchanged, absolute)
└─ button.channel-list__host-add             (unchanged, absolute)
```

The four trailing elements stay direct children in their shipped DOM order, so the `:has(> …)` dot swap,
the two hover reveals, the failed row's pen inset and the tab order (host button → repair → pen → plus)
are all unchanged.

### Contracts

`HostRow` — the exported pure view — gains three required props:

```ts
expanded: boolean
hasWorkspaces: boolean
onToggle: () => void
```

Required, not optional, on `WorkspaceRow`'s stated reason for `hasRows`: every caller knows the answer, and
a default would be a second way to draw a fold over nothing. `onToggle` is nullary, the file's standing
handler shape, so React's synthetic event cannot reach a caller.

`CollapsibleHostGroup` — new, exported, `CollapsibleWorkspaceGroup`'s shape one level up:

```ts
{ serverId: string, hasWorkspaces: boolean, defaultExpanded?: boolean,
  onEditHost, onAddWorkspace, onRepairHost, children: ReactNode }
```

Exported for the reason its neighbour is: `renderToStaticMarkup` never re-renders, so rendering the group
at each `defaultExpanded` value is the only seam through which the unit tier reaches the collapsed shape
at all. Production renders it from `renderServerTrees` alone and never passes `defaultExpanded`. It emits
no element of its own — a shorthand fragment, exactly like the keyed `<Fragment>` it replaces — so the
rendered sequence under `.channel-list` stays the flat run of siblings (header, host, workspace, rows) that
every `.channel-list__row`'s ancestry depends on across 28 e2e specs, each workspace head stays a sibling
of its host row, and the section-header adjacency rule stays exact.

`HostRowControl` gains `expanded` / `hasWorkspaces` / `onToggle` pass-throughs and **loses its own
`useSessionStore` read**, taking the resolved status as a prop instead — see the failed-row rule below for
why that read has to move up. It keeps its host-label and local-read-failure reads.

`renderServerTrees` computes each host's groups into a local before rendering, and passes
`hasWorkspaces={groups.length > 0}`. The answer comes from the group array the loop already builds, never
from `Children.count` — a host's children are a `<Fragment>`, which counts as 1 regardless.

### The failed row

`foldable = !failed`. A failed host is **not** a disclosure: the row draws its glyph and label as direct
children exactly as it does today, with no button, no `aria-expanded` and no chevron. The chevron is drawn
when `foldable && hasWorkspaces`.

The consequence that forces the status read upward: if a failed host kept a stored fold boolean, a host
collapsed *before* it errored would have its subtree withheld with no chevron and no control to re-open it
— a dead end only an app restart clears. So the group renders `{(expanded || failed) && children}`, which
means the group needs `failed`, which means the status is read once at the group and threaded down rather
than read twice. One read, one answer, no way for the row and the tree drawing it to disagree.

This is the one place the workspace row's posture is deliberately not copied: a `hasRows`-less workspace row
stays a toggling button, because the folder glyph swaps and still reads the state. The host's server-rack
glyph does not swap, so a mark-less host disclosure would be unreadable — the same measured argument the
ticket's estimate uses to decline the chevron-less cut.

### The chevron

One art, `WorkspaceRow`'s verbatim: `viewBox="0 0 8 4"`, `width="8"`, `height="4"`, `fill="currentColor"`,
`aria-hidden="true"`, no text, no second attribute. Not re-exported and not re-fetched from Figma. It is
drawn DOWN and turned a quarter by a rule off the button's own `aria-expanded`, which is what keeps that
attribute the single state signal rather than one of two.

Its box reproduces the drawn placement with no new literal. The row's content box is 20 tall between
`--space-1` paddings, so `align-items: center` over a `margin-top: 2px` margin box lands the art's centre at
11 — one pixel below the row's centre, which is exactly where `Chevron` 510:2384 puts it (a 10px box centred
in 20, `pt-[2px]`, art centred in the remaining 8). The same derivation as `.channel-list__workspace-chevron`,
whose block already writes it out.

### CSS

One new block and one new rule, and two edits to shipped blocks.

- `.channel-list__host-disclosure` — the `<button>` reset (`appearance`/`border`/`background`/`cursor`/
  `text-align`/`padding: 0`), the two inheritance repairs `.channel-list__workspace` records
  (`font-family`, because a button inherits none; `color: var(--color-on-surface)`, because a button resets
  it to the UA `buttontext` and the glyph is `fill="currentColor"` — `.channel-list` already supplies that
  same value today, so the glyph's paint is unchanged), `flex: 1 1 auto` + `min-width: 0` (grow so the
  label's ellipsize chain and the row's 52px trailing reserve keep describing something; the zero so the
  automatic minimum size cannot floor the button at content width), `gap: calc(var(--space-1) + 2px)` — the
  drawn 6 — and `border-radius: var(--radius-xs)` to shape the `:focus-visible` outline.
- ⭐ **No `position: relative`.** This is the one declaration `.channel-list__workspace` carries that this
  button must not: the workspace glyph is drawn at `left: 8` *from its button*, but
  `.channel-list__host-icon` is drawn at `left: 0` from **the row**. `.channel-list__host` is already
  `position: relative`, so leaving the button unpositioned keeps the glyph resolving against the row and
  its shipped declarations byte-identical — in both the button shape and the failed shape.
- `.channel-list__host-disclosure:focus-visible { outline: 1px solid var(--color-outline) }` — the file
  convention, `.channel-list__workspace`'s value verbatim.
- `.channel-list__host-chevron` — `display: block; flex: 0 0 auto; margin-top: 2px`, plus
  `.channel-list__host-disclosure[aria-expanded='false'] .channel-list__host-chevron { transform: rotate(-90deg) }`.
  Its own token and its own block rather than joining `.channel-list__workspace-chevron`'s selector, the
  call `.channel-list__host-add` already records: two marks on two different row families, told apart by a
  block that says where each lives.
- `.channel-list__host`'s `gap: var(--space-3)` is **deleted**, and the 6 it was earmarked for lands on the
  button. That is the one edit its comment reserves, not two: with the glyph absolute and every trailing
  element absolute, the row has exactly one in-flow child in both shapes, so a gap on it can never apply
  again.
- `.channel-list__host-label` needs **no** change: it already omits `flex-grow`, so it resolves to
  `0 1 auto` — the very value #1487 had to correct `.channel-list__workspace-label` down to, and the reason
  the chevron packs against the text instead of parking at the row's trailing edge.

## State + concurrency model

One boolean per host per tree, `useState` inside `CollapsibleHostGroup` — no store, no reducer, no context,
no lifted map, exactly `CollapsibleWorkspaceGroup`'s scope and for its stated reasons. ADR 0006 picks the
lowest scope that resets correctly, and both halves of "renderer-only and unpersisted" fall out of it for
free: `PairedShell` renders `ChannelList` at the same element position on both routes, so React preserves
the subtree across the list↔thread flip and a fold survives opening a conversation and coming back — while
the whole thing dies with the renderer on app start. Nothing reaches disk, `localStorage`, IPC or the wire.

Per-server independence: each machine's group is a keyed sibling in one list, keyed by `serverId` (the key
that already sat on the `<Fragment>` this replaces), so two machines hold two booleans. Per-tree
independence: the two trees are two separate sibling lists in `renderBody`, and React scopes reconciliation
per sibling list, so the same machine's two rows hold two separate booleans. Neither needs anything
implemented; both need something *not* done, namely lifting the state.

The toggle is a functional updater, never `setExpanded(!expanded)` — the latter reads a value captured at
render and is a check-then-act race against React's batching. No async work, no subscription, no effect, no
cancellation path: the handler's entire body is the state flip.

## Error handling

No new failure mode. The only error state this ticket touches is the existing `status.type === 'error'`
host, handled above by withholding the disclosure and unconditionally rendering the subtree. No IPC, no
transport, no daemon text and no new log line: the label and the `serverId` keep their four-sink treatment
(no `title`, no `aria-label`, no derived id/key/lookup path, no log), the chevron carries no text and adds
no attribute to the button beyond `aria-expanded`, and `renderToStaticMarkup`-visible output gains no
attribute carrying a host or workspace label.

## Testing strategy

**vitest** (`ChannelList.test.tsx`, static markup — the tier cannot click):

- `HostRow` shapes, through the exported pure view: expanded draws the button with `aria-expanded="true"`
  and one chevron; collapsed draws `aria-expanded="false"` and still one chevron; the two opening tags are
  equal but for that attribute (the pin that keeps a `--collapsed` modifier out and `HOST_ROW_MARKER`'s
  counts honest); `hasWorkspaces: false` withholds the chevron and keeps the button; `failed` draws neither
  the button nor the chevron and leaves the row's markup as shipped.
- The chevron is empty, `aria-hidden`, and adds nothing to the button — the `#1487` describe's shape.
- The row's opening tag is still exactly `<div class="channel-list__host">`, and `HOST_ROW_MARKER`,
  `HOST_ICON_MARKER`, `HOST_LABEL_OPEN`, `DOT_WRAPPER_MARKER` keep their shipped counts across the existing
  suite. A red there is evidence the structure drifted, not an assertion to retune.
- `CollapsibleHostGroup`, at each `defaultExpanded` value: the subtree is genuinely withdrawn from the
  markup when collapsed (not hidden by a class), the host row itself stays, and the default render is
  expanded.
- The untrusted label still escapes in the collapsed shape, and neither shape carries a `title=`.

Not reachable from this tier and stated as such: the failed group's unconditional subtree render, because
`sessionStore` is a zustand singleton whose seeding is invisible to `renderToStaticMarkup`. It is proved by
review of one expression.

**Playwright** (`e2e/host-collapse.spec.ts`, new, default fake-transport tier — modelled on
`e2e/workspace-collapse.spec.ts`): one launch, one sequential drive.

- AC1 — clicking the Channels tree's host button hides that host's workspace head rows *and* their
  conversation rows; the host row itself stays; `aria-expanded` flips; clicking again restores; a fresh
  launch starts expanded; the Chats tree's copy of the same machine is untouched, and the reverse direction
  is driven by `press('Enter')` so the keyboard half is proved on a real focus.
- AC2 — the chevron is present on a host with workspace groups, and its computed `transform` is `none`
  when expanded and a rotation when collapsed. That turns #1487's "proved by review of one declaration"
  into an assertion for this row.
- AC3 — the pen, the plus and the dots keep their accessible names and their counts; activating the pen
  opens its dialog and leaves `aria-expanded` unchanged; `Tab` from the host button reaches the pen then
  the plus.
- The composer draft, filled before the first toggle and re-read after each, is the "nothing else happened"
  anchor: a surviving draft proves no navigation, no pane remount and no active-conversation change.

Secret hygiene, carried from the sibling spec: every assertion reads DOM counts, attribute values,
client-owned accessible names or computed style strings. No pairing payload, token, key or relay URL is
asserted on or echoed.

**Visual**: a static capture of `HostRow` in the expanded, collapsed, no-workspaces and failed states,
compared against the Figma screenshot above per `docs/visual-review.md`. Paths and viewport recorded in the
PR.

## Open questions

1. **Does the two-server fixture give a cheap "every other host is left alone" assertion?** AC1 asks for it.
   `launchPairedApp({…}, { secondServer: {} })` is shipped in `host-row-per-server.spec.ts`, but
   `launchPairedApp` reaches the thread by clicking a single strict `.channel-list__row-open`, and a second
   seeded row strict-violates at launch. If the second server launches without seeding a row, the spec adds
   one assertion over the four host disclosures' `aria-expanded` values; if it does not, per-server
   independence rides the same keyed-sibling property `CollapsibleWorkspaceGroup` documents and #1070
   established, and the spec proves the per-tree half only — the posture `workspace-collapse.spec.ts`
   already ships. Resolved in Phase B and recorded under `## Revisions` if it changes anything.
2. **Does the disclosure's `:focus-visible` outline need a `border-radius` at all?** The row's Figma
   `rounded-[6px]` clips no background here (the button paints none), so the radius shapes the outline
   alone. Kept for consistency with `.channel-list__workspace`; dropped if the capture shows it reads wrong
   against the row's 28px box.

## Documentation handoff

Pending for the documentation stage, not done here: fold the host row's fold state and its chevron into
`docs/knowledge/features/channel-list-host-row.md`, the overview that owns this row. It stands at 39347
bytes against `npm run check:docs`' 50000-byte cap, so if the fold would not fit, split the page rather
than trimming the record — `channel-list-workspace-row-nest.md` is the precedent for carving a row's own
topic out of `channel-list.md`.
