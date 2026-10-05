# Channel List — the toolbar's pair-new-host control

The [Channel List](channel-list.md) toolbar contains a left Sidebar menu button and one
Pair new host button at the right. Both remain visible when the list is loading, empty or populated.
The global Channels/Chats title rows and their two pairing buttons were removed by
[#1678](../../specs/architecture/1678-sidebar-pairing-toolbar.md). The two independently grouped
trees and their divider remain; host-first grouping belongs to #1679.

## What it is (`ChannelList.tsx`)

`ChannelListView` renders `ComposerOptionsMenu` and `PairNewHostButton` inside
`.channel-list__actions`, followed by `.channel-list__actions-rule` and the scrolling
`.channel-list__tree`. `renderBody` draws only the trees and their divider; it no longer
receives the pairing callback or renders `SectionHeader`.

The Sidebar menu replaces the standalone Settings and Archive buttons. It uses the
[shared menu](conversation-shell-composer-options-panel.md) with `currentId={null}`,
`placement="bottom-start"` and `consumeOutsideClick`. Its client-owned rows are Settings
then Archive; selection closes the menu and invokes `onOpenSettings` or `onOpenArchive`
once. These navigation boundaries remain unchanged and send no transport command.
Keyboard opening focuses Settings; arrows wrap between rows, Enter/Space activate,
and Escape closes and returns focus to the trigger. A transparent dismissal layer consumes
the entire first outside click, preventing tree navigation or folding until a subsequent click.

Pair new host opens the same [Pair modal](pairing-input-screen.md#in-app-modal-presentation)
as Settings' Pair another server entry. The button itself is an injected navigation effect;
it sends no transport command and mutates no store.

## The accessible name is a module-level constant, never a prop

`PAIR_NEW_HOST_CONTROL_LABEL = 'Pair new host'` supplies both the native button's `aria-label`
and its `aria-hidden` name pill. `PairNewHostButton` accepts only `onClick: () => void`, so a
caller cannot interpolate operator or daemon text into its name. Its decorative mask span
is also `aria-hidden`. The menu trigger is named `Sidebar menu`; Settings and Archive are
named `menuitem` buttons inside its popup, rather than standalone sidebar entry buttons.

`getByRole('button', { name: 'Pair new host' })` now matches exactly one button. Do not retain
an indexed two-button locator from the former section headers. Both toolbar controls are native
`type="button"` controls, with Enter/Space activation and a 1px `--color-outline` outline on
`:focus-visible`.

## Geometry (`channels.css`)

At the shell's 400px sidebar width, the toolbar follows Figma Top bar `115:3693` and Add
`590:5802` within Sidebar `132:3902`:

- The card has 20px side padding and 24px top padding. Its content width is 360px.
- `.channel-list__actions` has 4px top padding around 24×24px controls, making a 28px wrapper.
  Sidebar menu leads, and Pair new host
  uses `margin-left: auto` to reach the trailing content edge.
- The 1px rule sits 16px below that wrapper, in `--color-primary` at 60% opacity. The tree's
  24px top padding puts the first host at sidebar-relative y=93 when scrolled to the top.
- Toolbar and rule are outside the scrollport. Only the tree scrolls; its first host and the
  host immediately after the section divider have zero top margin. The divider retains
  28px margins above and below. Card bottom padding remains 20px.

Both controls draw at rest in `--color-primary`, without a background or hover fill.
The menu centers the thread menu's exact 6×24px ellipsis SVG in its 24px button. Its popup
matches [Figma `756:9674`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-9674),
popup `756:9837`: 160×60px, two 28px rows with 2px top/bottom padding, 6px corners,
12px horizontal row insets and body-small Primary text. It starts 4px left of the trigger
and 32px below its bottom. Sidebar-local rules set `--color-on-primary` for the ground
and `--color-on-primary-fixed` for hover; existing footer, thread and reader surfaces
retain their defaults. The level-1 anchor lifts the popup and fixed dismissal layer
above the rule/tree; the popup has its own level 1 above the layer.

The pairing glyph uses the 24×24 Figma export at
`src/renderer/public/sidebar-pair-host.svg`, referenced as `/sidebar-pair-host.svg` by a CSS
mask. `background: currentColor` supplies the theme colour independently of the SVG's fill.

**Public assets avoid the observed mask failure.** Importing this small SVG from the source
assets directory let Vite inline its CSS URL; the renderer CSP blocked that URL and the glyph
vanished. Keeping the unchanged export in `public/` follows the repair glyph's existing
pattern without changing CSP or build configuration. A valid button or mask-span box did
not detect the failure; test the asset load as well as layout (see Testing).

## The hover/focus name pill (`channels.css`/`ChannelList.tsx`, added by [#1304](https://github.com/pyrycode/pyrycode-desktop/issues/1304))

Pair new host retains `controlNamePlacement` and `.channel-list__control-name`.
Sidebar menu has an accessible name but no name pill.
The pill appears on the button's own `:hover` or `:focus-visible`, and hides on leave/blur
with `display: none`. Its text matches the accessible name; `aria-hidden` avoids adding
another spoken label. It remains click-through through `pointer-events: none`.

The shared [control-name pill](channel-list-control-name-pill.md) follows the pointer,
with keyboard placement seeded from the control's bottom-right corner. It uses fixed
positioning and the shared window-edge handling. No toolbar-specific placement override
is needed: the former header pill's sticky-toolbar collision and band-centred placement
were retired before the move. Keep `.channel-list` at `position: relative; z-index: auto`:
it lifts content above the card wash without creating a stacking context that traps the
fixed pills. A positioned pill must be reviewed against the full ancestor/sibling paint
order, not just its button's box.

The pill's ground is `--color-primary-container` and its ink is
`--color-on-primary-container` (rgb(19, 74, 116) / rgb(207, 228, 255)). Figma's Pill export
has previously transposed those token names; the rendered design and computed colours
settle the mapping. The fake-transport test checks both colours.

## Wiring

The required `onPairNewHost: () => void` contract travels from `ChannelList` through
`ChannelListView` directly to `PairNewHostButton` as `onClick`. It no longer passes through
`renderBody`. Keeping it required prevents a caller from silently drawing an inert entry.

`PairedShellView` binds it to the same `onOpenPairServer` callback as Settings' `onPairAnother`.
The shell captures the originating route before entering pairing. Cancel or Escape returns
to that origin and restores focus to the invoking button, retaining an open conversation
and its draft. Settings' entry still returns to Settings. The mounted-background and
focus-restoration mechanisms remain owned by the existing pairing flow; see
[origin-aware cancellation](paired-shell-routing.md#the-pair-new-host-plus-and-origin-aware-cancel-1303).

## Testing

`ChannelList.test.tsx` uses static server rendering to check one enabled, named pairing
button before the tree in loading, empty and populated states, with and without saved
hosts. It checks Sidebar menu → Pair new host order, collapsed menu markup with neither
standalone Settings/Archive entry nor popup, the absent global headers,
the decorative glyph and name-pill markup, and separation of daemon text from control
attributes. Tree/divider boundaries preserve partition checks without deleted title text.
Static rendering cannot prove CSS paint, layout, focus or handlers.

The fake-transport browser specs cover the remaining behavior:

- `sidebar-pair-new-host.spec.ts`: one visible toolbar trigger; Enter/Space activation;
  Cancel/Escape from thread, list and Settings; restored trigger focus, retained thread
  draft, and Settings/Archive navigation. Wait for the returning surface as well as the
  dialog's disappearance, so an intermediate empty render cannot satisfy cancellation.
- `sidebar-header-menu.spec.ts`: at 1280×800 and 800×600, exact trigger/popup/row geometry,
  no current row, paint and hit testing above the tree, keyboard opening/arrows/activation/
  Escape, both destinations, and consumed dismissal followed by a working tree click.
- `sidebar-section-header-plus-name-pill.spec.ts` retains its historical filename and
  expects Sidebar menu and Pair new host. Its name-pill assertions cover Pair new host:
  hover/focus visibility, pointer-following and keyboard placement, computed treatment,
  visible outline, leave/blur hiding and no tree overflow. Establish keyboard modality
  with Shift+Tab back to Sidebar menu, then Tab forward to Pair new host; a programmatic
  focus alone does not establish `:focus-visible` treatment.
- `sidebar-tree-geometry.spec.ts`: measured toolbar/rule/list offsets, unchanged tree
  insets and divider, and fixed toolbar/rule positions while a tall tree scrolls. It
  captures populated 1280×800 and 800×800 windows. It also reads the computed mask URL,
  requires `Image.decode()` to succeed and checks native 24×24 dimensions. Bounding boxes
  alone passed with the CSP-blocked glyph absent; screenshots confirm actual paint.
- `paired-shell-card.spec.ts` targets the toolbar, hosts and rows for the card-wash check;
  `sidebar-offline-mutations.spec.ts` expects one pairing entry while host mutations are
  unavailable.

No live-Claude behavior is needed to establish these renderer interactions.

## Related

- [Channel List](channel-list.md) — list state, grouping and row behavior.
- [Control-name pill](channel-list-control-name-pill.md) — shared placement and paint.
- [Host row](channel-list-host-row.md) — host-specific add, edit and repair actions.
- [Pair-server route](paired-shell-pair-server-route.md) — the shared pairing flow.
- [Sidebar pairing toolbar spec](../../specs/architecture/1678-sidebar-pairing-toolbar.md) —
  design source and the public-asset revision.
- [Sidebar header menu spec](../../specs/architecture/1732-sidebar-header-menu.md) — menu geometry
  and shared interaction contract; [verification evidence](development-verification.md#layout-and-input).
