# Channel List — the host row's fold and its chevron (#1507)

Split out of [Channel List — the host row and its connection dots](channel-list-host-row.md) once that
page neared the doc-guard's 50000-byte cap (`npm run check:docs`) —
[`channel-list-workspace-row-nest.md`](channel-list-workspace-row-nest.md) is the precedent for carving a
row's own topic out of a page it grew past. Read the parent page first for the row's baseline shape (the
glyph, the label, the connection dots, the pen and plus on hover); this page covers only the disclosure
[#1507](https://github.com/pyrycode/pyrycode-desktop/issues/1507) added.

The row grew a disclosure: [#704](channel-list-workspace-row-nest.md)'s restructure and
[#1487](channel-list-workspace-row-nest.md)'s fold-state read, applied one level up, once
[#1506](channel-list-tree-inset.md) had moved the glyph out of the flow and put the row's whole 24px
inset on the label. Clicking the row (or `Enter`/`Space` on it) hides that host's workspace groups and
their conversation rows; a chevron after the label shows which way it is folded.

**The structural call, realized in code exactly as measured.** `.channel-list__host` stays on the `div`
that holds every part of the row; the new button is a **child**, wearing its own token,
`channel-list__host-disclosure`. That is what leaves `HOST_ROW_MARKER`, `HOST_ICON_MARKER`,
`HOST_LABEL_OPEN`, `DOT_WRAPPER_MARKER` and the exact opening tag (`<div class="channel-list__host">`)
byte-identical, the `--failed` modifier's three rules describing the same elements, the pen/plus hover
reveals and the `:has()` dot swap ([parent page § The row's pen and plus on
hover](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)) reaching the same descendants, and
`paired-shell-card`'s `closest()` hit test still resolving a hit on the button to the row.

**`HostRow`'s glyph and label are lifted into two locals** (`glyph`, `name`) because they now render in
two different parents depending on `failed`: inside the disclosure on a healthy row, as the row's own
direct children — unchanged from what shipped before this ticket — on a failed one. Two required,
non-optional props front the fold, `WorkspaceRow`'s `hasRows` reasoning applied here: `expanded: boolean`,
`hasWorkspaces: boolean`, `onToggle: () => void`. Required rather than optional because every caller
already knows all three answers, and a default would be a second way to draw a disclosure over nothing.
`onToggle` is nullary, so React's synthetic event cannot reach it.

**A failed row is not a disclosure, and draws no chevron — a ruling, not an omission.** The Pairing Issue
variant (Figma 486:838) draws no chevron, and unlike the workspace row's folder glyph, the host's
server-rack glyph does not swap between fold states — so a chevron-less disclosure on this row would be a
fold no sighted operator could read (the same measured argument the ticket's estimate used to decline a
chevron-less cut generally). The failed branch renders `glyph` and `name` as the row's own children, no
button, no `aria-expanded`, exactly the markup that shipped before this ticket.

**The chevron is withheld whenever a host has no workspace groups in that tree**, via a `hasWorkspaces`
prop computed by `renderServerTrees` — never derived from `children`, because a host's children are a
`<Fragment>`, which `Children.count` reads as 1 regardless of what is inside it (`renderServerTrees`
already builds each host's group array into a local before rendering, so `groups.length > 0` is free
there). This is the opposite read from [#1487](channel-list-workspace-row-nest.md)'s `hasRows`, where the
children genuinely are the mapped rows — the two are not in conflict, they answer the same question at two
different points in the tree.

**`CollapsibleHostGroup`** is the new component, `CollapsibleWorkspaceGroup`'s shape one level up and
exported for the same reason: `renderToStaticMarkup` never re-renders, so rendering it at each
`defaultExpanded` value is the only seam through which the unit tier reaches the collapsed shape at all.
It owns one `useState` (`defaultExpanded = true` — a host starts expanded, so the shipped sidebar looks
unchanged on launch), toggled with a functional updater (`setExpanded((open) => !open)`, never
`setExpanded(!expanded)` — the latter is a check-then-act race against React's batching). It renders no
element of its own, a shorthand fragment exactly like the keyed `<Fragment>` it replaced in
`renderServerTrees`, carrying that same `key={serverId}` — which is what keeps the rendered sequence under
`.channel-list` a flat run of siblings and each host's fold pinned to that machine's identity rather than
to its position in the list.

**The session-status read moved from `HostRowControl` up to `CollapsibleHostGroup`.** A failed host's
subtree must render regardless of the fold boolean it happens to be holding — `{(expanded || failed) &&
children}` — because otherwise a host folded *before* it went into error would strand its own subtree
with no chevron and no control left to re-open it, clearable only by restarting the renderer. That
guard needs `failed`, and drawing the row correctly needs the same answer, so the status is read once
here and threaded down as a prop (`HostRowControl` no longer calls `useSessionStore` itself); reading it
twice would be two answers where the tree and the fold could disagree. `|| failed` is a stranding guard,
not a second state — while a host is failed the fold boolean is kept, not reset, so a machine that
recovers returns to the state the operator left it in.

**State stays exactly `CollapsibleWorkspaceGroup`'s scope, for the same reasons**: one `useState`, no
store, no reducer, no context, no lifted map — the lowest scope that resets correctly (ADR 0006).
Renderer-only and unpersisted falls out of it for free: `PairedShell` renders `ChannelList` at the same
element position on both the `list` and `thread` routes, so React preserves this subtree — and its fold —
across that flip, while the whole thing dies with the renderer on app start. Per-server and per-tree
independence need nothing implemented, only something *not* done (lifting the state): each machine is a
keyed sibling in one list, and the two trees are two separate sibling lists in `renderBody`, so React's
per-sibling-list reconciliation gives each of a machine's two rows its own boolean for free.

**The chevron** is `WorkspaceRow`'s fold-mark art reused verbatim — the same 8×4 `viewBox`, the same path,
not re-exported and not re-fetched from Figma — drawn down when expanded and turned a quarter via
`.channel-list__host-disclosure[aria-expanded='false'] .channel-list__host-chevron { transform:
rotate(-90deg) }`, off the button's own `aria-expanded` and nothing else. That is what keeps
`aria-expanded` the single state signal rather than one of two: the drawn direction cannot disagree with
what a screen reader is told, because it reads the same attribute. **One drawn discrepancy is a ruling,
not a bug**: the Host component's Idle and Hover variants draw the chevron right-pointing while the
placement frame (Channels 103:2966) shows those same hosts expanded with their subtrees beneath them — the
drawn orientation is the component's base art, not a claim that a resting host is collapsed. Down-when-
expanded is the shipped behaviour, matching the workspace row one level down; do not "fix" this to a right
chevron on an expanded host to match the Idle art.

**CSS**: `.channel-list__host`'s `gap: var(--space-3)` — inert since [#1506](channel-list-tree-inset.md)
moved the glyph out of the flow, and reserved by that ticket's own comment as "the chevron's, to be
re-derived to 6 when the mark arrives" — is **deleted outright, not re-derived in place**. The drawn 6px
gap lands on the new `.channel-list__host-disclosure` block instead, because that button is the row's one
remaining in-flow child in both of the row's shapes (disclosure, or bare glyph+label on a failed row), so
a `gap` on the row itself can never apply again. `.channel-list__host-disclosure` is a button reset
(`appearance`/`border`/`background`/`cursor`/`text-align`/`padding: 0`) plus the two inheritance repairs
`.channel-list__workspace` already needed one level down (`font-family`, since a `<button>` inherits
none; `color: var(--color-on-surface)`, since a button resets it to the UA `buttontext` and the glyph is
`fill="currentColor"`), the same `flex: 1 1 auto` + `min-width: 0` pair for the same reasons (grow so the
label's ellipsize chain and the row's 52px trailing reserve keep describing something; zero so the
automatic minimum size cannot floor the button at content width and let a 128-character label take the
sidebar with it), and `border-radius: var(--radius-xs)` to shape the `:focus-visible` outline alone — the
row's Figma corner clips no background here, since the drawing gives this row no hover fill.

**No `position: relative` on the disclosure — the one declaration `.channel-list__workspace` carries
that this button must not.** The workspace glyph is drawn at `left: 8` from *its button's* edge, which is
why that button needs to be the containing block; this row's glyph (`.channel-list__host-icon`) is drawn
at `left: 0` against *the row*, unchanged since #1506. Leaving the disclosure unpositioned is what keeps
the glyph resolving against `.channel-list__host` (already `position: relative` since #718) and its
shipped declarations byte-identical in both of the row's shapes. Giving the button `position: relative`
for symmetry with the workspace row would have shifted the glyph 24px right, silently, with every test
still green — the trap the symmetry itself sets.

`.channel-list__host-chevron` reuses `.channel-list__workspace-chevron`'s three declarations verbatim
(`display: block; flex: 0 0 auto; margin-top: 2px`) in its own block rather than joining that selector —
two marks on two different row families, told apart by a block that says where each lives, the same call
`.channel-list__host-add` already records for the plus it shares a drawing with.

**Tab order: the disclosure is the host row's first child**, ahead of the repair control, the pen and the
plus, which AC3 asks for and which the element tree above already prescribes — but that also makes it the
row's leading tab stop. Adding a focusable at a container's leading edge reaches every shipped spec that
tabs *into* that container from a sibling, and that set is invisible from the diff: the sweep found one,
`e2e/sidebar-host-row-control-name-pill.spec.ts`, whose step 10 entered the row from the Channels header's
plus and pressed `Tab` once to reach the pen — it now needs one more `Tab`, with an intermediate
`toBeFocused` on the disclosure added so the next change to the row's leading edge fails naming what moved.
Worth a deliberate check — not just driving the new spec's own tab order — whenever a focusable is
inserted at the front of an existing container.

**Testing.** `ChannelList.test.tsx` covers `HostRow` at each combination of `expanded` and `hasWorkspaces`,
the failed branch's unchanged markup, and `CollapsibleHostGroup` at each `defaultExpanded` value proving
the subtree is genuinely withdrawn from the markup (not hidden by a class) when collapsed. Two shipped
assertions had to retune for the row's new third element rather than for a changed claim: a "draws neither
control without handlers" case that read `not.toContain('<button')` became "exactly one button, and it is
the disclosure," and a nesting-guard button count went from 2 to 3 with the `#274` loop itself untouched.
`e2e/host-collapse.spec.ts` (new, modelled on `e2e/workspace-collapse.spec.ts`) drives the click, the
keyboard (`Enter`) and the "every other host and every other tree's copy is untouched" claims the unit
tier cannot reach, using a filled composer draft as the "nothing else happened" anchor. Per-server
independence across two machines was **not** added to this spec — `launchPairedApp`'s single strict
`.channel-list__row-open` click strict-violates against a seeded second server — so that half rides the
keyed-sibling property `CollapsibleHostGroup` and #1070 already established, rather than a new fixture
change this ticket did not otherwise need.

## Related

- [Channel List — the host row and its connection dots](channel-list-host-row.md) — the parent page: the
  row's baseline shape, the connection dots, the pen/plus hover reveal this disclosure sits beside.
- [Channel List — the workspace row's own nest and its create-chat plus](channel-list-workspace-row-nest.md)
  (#704, #1178, #1487) — the disclosure restructure and fold-state read this ticket applies one level up.
- [Channel List — the tree's inset](channel-list-tree-inset.md) (#1506) — moved the glyph out of the flow
  and reserved the 12px `gap` this ticket spends as the drawn 6, on the disclosure rather than on the row.
- [#1507 spec](../../specs/architecture/1507-host-row-folds-its-workspaces.md) — the full design, the
  stranding-guard rationale for reading session status one level up, and the two resolved open questions.
