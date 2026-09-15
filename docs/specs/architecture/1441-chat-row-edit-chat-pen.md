# #1441 — the chat row's pen opens Edit chat and its pill reads Edit chat

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `Row` — the one row component both trees
  instance; its optional `onRename` is the prop this ticket reshapes, and its two trailing-control
  blocks are the markup the chat pen joins.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderBody` — the two `renderServerTrees`
  calls, the single level that tells the Channels tree from the Chats tree, and therefore the level
  where each tree's pen label and class tokens are chosen.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `RENAME_CONTROL_LABEL`,
  `SAVE_AS_CHANNEL_CONTROL_LABEL`, `EDIT_WORKSPACE_CONTROL_LABEL`, `WorkspaceEditControl` — the
  client-owned-constant idiom and the `{ label, onEdit }` control-object shape this ticket copies one
  row family down.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`'s `onRename` handler and the
  `renameRow` mount — already re-checks the host with `canMutateHost`, already seeds with
  `titleFor(row.name)`, and already renders `EditChatDialogView`. Nothing downstream of the callback
  is new.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `controlNamePlacement` — the pointer-following
  pill handler set every control spreads; the chat pen spreads it too.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__save`, `.channel-list__rename`,
  and the shared `.channel-list__row:hover` reveal rule — the block the chat pen's block restates, and
  the rule whose "a row only ever carries one of the two" comment stops being true here.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-edit`,
  `.channel-list__host-edit` — the `<subject>-edit` token idiom the new token follows, and the second
  and third restatements of the same block one and two row families up.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `titleFor`, `UNNAMED_LABEL` — the
  `Untitled` fallback AC1 names.
- `src/renderer/src/screens/channels/EditChatDialog.tsx` → `EditChatDialogView` — the modal #1440
  shipped: overlay class `.rename-conversation-overlay`, dialog name `Edit chat`, field label
  `Channel name:`.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the affordance, glyph, pill and drift-guard
  tests around `RENAME_MARKER` / `SAVE_MARKER`, and `host-owned mutation availability` — the three
  places AC3 moves.
- `e2e/sidebar-row-geometry.spec.ts` → the Chats-row block and the Channels-row block — where each
  control's glyph inset and centre are pinned, and where a pen is already clicked through to its dialog.
- `e2e/sidebar-control-name-pill.spec.ts` → the per-row `pills` counts and the bottom-edge mirror block
  — the counts AC4 says must account for a chat row carrying two controls.
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW` (`is_promoted: false`) — the launch seed is a **chat**
  row, which is why the pill spec's launch-seed count of 1 becomes 2.
- `e2e/fixtures/conversationStateFake.ts` → its `rename_conversation` arm — applies the rename to state
  and re-lists, which is what lets the new drive prove a rename end to end without a bespoke fake.
- `docs/knowledge/features/channel-list-row-hover-control.md` — why the reveal is `opacity` and never
  `display: none` (nine shipped specs click or await these controls without hovering first, five of them
  `real-daemon-*` readiness gates). The new token inherits that constraint.
- `docs/knowledge/features/channel-list-control-name-pill.md` — why each name is one constant read twice,
  why the pill is appended *after* the `<svg>`, and why `--space-6` is the offset that keeps the pill off
  the control's box.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=486-1073
(the sidebar's lower section, read for the row treatment only — its Sidebar header still reads
**Channels** because the section is a duplicate of the one above it, raised for Juhana on the ticket)
and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=398-7258 (the Channel
row's Hover state, the component both trees instance).

Read 2026-09-15. The lower section's rows are Channel-row instances: the hovered row draws the same
12×12 `--color-primary` pen the Channels tree draws, at the row's right edge, with no chevron beside it
and no other change to the row. The Hover component places the glyph at x=320 in a 340-wide row — right
edge 8px in — top 6.01 in a 24px row, i.e. centred. The same numbers #1171 shipped, so the pen's own
geometry is a reuse and not a new measurement.

**Deviation from the drawing, carried as the ticket's stated assumption:** the drawing shows no chevron
on a chat row and the Edit chat modal has no Save as channel, but the chevron's fate is an open question
for Juhana, so the chevron **stays**, moved 20px inside the pen. A second assumption rides on it: the
row keeps its 28px trailing padding, which reserves room for one control, so while both are revealed the
chevron's glyph overlaps the tail of a long title. Widening that padding is out of scope —
`sidebar-row-geometry` pins the 28.

## Context

A Chats row draws only the Save-as-channel chevron today. The pen is handed to the Channels tree alone,
through `Row`'s optional `onRename`, and its word comes from `RENAME_CONTROL_LABEL`. Juhana's 2026-09-14
sidebar drawing reuses the Channel row component in the Chats section, so a chat row shows the pen too —
opening the Edit chat modal #1440 shipped, and named **Edit chat** rather than **Rename**.

Everything downstream of the callback already exists. `ChannelList`'s `onRename` handler re-checks the
host, seeds the field with `titleFor(row.name)` and mounts `EditChatDialogView`. What this ticket adds is
the second caller of that handler, the second word, and the second class token.

The Channels tree keeps **Rename** until #1430 renames it **Edit channel**. That ticket is sequenced
after this one precisely so the per-tree *shape* lands first and #1430 changes the channel word alone —
which is why the two words are two separate constants rather than one.

No ADR is warranted: this is a second wearer of three shipped idioms (the client-owned label constant,
the `{ label, … }` control object built at `renderServerTrees`, and the restated control block), not a
new decision.

## Design

### The chat pen's own class token, not a share of `.channel-list__rename`

Twelve specs locate through `.channel-list__rename`, six of them `real-daemon-*`, and most read it as
the proxy for "this row is a promoted Channels row" — counting it or awaiting it as a bare strict
locator. `save-as-channel-promote` asserts exactly one after promoting while a second host's chat row is
on screen; `sidebar-control-name-pill` counts forty against a list holding forty-one rows. Sharing the
token breaks both, voids #1430's own promise that specs awaiting `.channel-list__rename` keep passing
unedited, and pulls six `real-*` specs — and with them the real-claude gate — into a renderer-only
change.

The new token is **`.channel-list__chat-edit`** / **`.channel-list__chat-edit-icon`**, following the
`<subject>-edit` idiom `.channel-list__workspace-edit` and `.channel-list__host-edit` already wear one
and two row families up. Its `channels.css` block **restates** `.channel-list__rename`'s declaration for
declaration, which is this file's shipped idiom for exactly this: `.channel-list__rename` already
restates `.channel-list__save`, and `.channel-list__workspace-edit` restates it again.

### One pen block in `Row`, parameterized at the two tree calls

`Row`'s `onRename?: () => void` becomes `pen?: RowPenControl`, a module-private type in
`WorkspaceEditControl`'s shape with the two class tokens added:

```ts
type RowPenControl = {
  readonly label: string
  readonly className: string
  readonly iconClassName: string
  readonly onEdit: () => void
}
```

The three compile-time halves are two module constants — `CHANNELS_ROW_PEN` and `CHATS_ROW_PEN` — each
holding its tree's `label`, `className` and `iconClassName`; the handler is spread onto one at each
`renderServerTrees` call, `{ ...CHATS_ROW_PEN, onEdit: () => onRename(d) }`. Both label constants stay
module-local and separate (AC2), and both class tokens stay **whole string literals** in the source
rather than an interpolation, so a grep for `channel-list__rename` still finds its definition — the very
property this ticket's token split exists to protect.

`renderBody` keeps one `onRename` parameter: both trees open the same dialog through the same handler,
and the per-tree difference is entirely in the control object, at the one level that knows which tree it
is drawing. The gate is each tree's existing connected check, unchanged, so AC1's "a Chats row whose host
is not connected draws neither control" holds by construction — both controls read the same condition.

One JSX block serves both trees rather than two restated blocks. The rendered markup differs only in the
word and the two tokens (the glyph is the same Font Awesome pen in both sections, per the drawing), and a
single block is what keeps the pill's append-after-`</svg>` discipline, the `controlNamePlacement` spread
and the `aria-label`/pill single-constant wiring from drifting between the trees. The CSS is restated
because two rules with two selectors is the only way to have two tokens; the markup is not, because one
element with a parameterized token is.

### The pen block moves after the chevron block

Both controls are absolutely positioned, so DOM order changes no layout — but it changes tab order and
reading order, and on a chat row the chevron sits 20px to the *left* of the pen. Emitting the chevron
first makes the focus order match the visual order. A Channels row's markup is byte-identical either way,
since only one of the two blocks renders there.

The two boxes overlap by 8px (the pen's 28-wide box spans 0–28 from the row's right edge, the chevron's
spans 20–48), with the later sibling on top. Neither *glyph* is covered: the pen's is at 8–20 and the
chevron's at 28–40, and each lies outside the other's box.

### Geometry

`.channel-list__save` takes `right: var(--space-5)` in place of `right: 0`, putting its glyph's right
edge 28px in — 20px further than the pen's 8px, which the box's unchanged `padding: 0 var(--space-2) 0 0`
and `justify-content: flex-end` carry the rest of the way. The pen keeps `right: 0` and #1171's whole
treatment: 28×24 box, `top: calc(50% - var(--space-3))` (transform-free, #1427's reason — a non-`none`
transform would make it a containing block for its own fixed-position pill), `--color-primary`,
`opacity: 0` at rest.

The new token joins the `.channel-list__row:hover` reveal rule as a third selector, and gets its own
`:focus-visible` rule. The reveal stays an `opacity` and never a `display`/`visibility` — the constraint
the nine shipped specs that click or await these controls without hovering first depend on. The reveal
rule's comment, which says a row only ever carries one of the two controls, stops being true and is
corrected in place.

## State + concurrency model

None. No store slice, no async work, no subscription, no IPC. The pen is a synchronous callback into
`ChannelList`'s existing `renameRow` / `renameName` `useState` pair, which #1440 already drives from the
Channels tree.

## Error handling

Unchanged, and deliberately so. The connected gate at the render site withholds both controls on a host
that is not connected; `canMutateHost` re-checks at interaction time (a render snapshot cannot authorize
a later activation) and emits the content-free `{ event: 'sidebar-mutation', code: 'host-unavailable' }`
diagnostic on refusal. The chat pen adds no new failure mode: it reaches the same handler through the
same gate. No new log call — a second caller of an already-instrumented path is not a new event.

## Testing strategy

**`ChannelList.test.tsx`** (static markup, vitest node environment — AC3):

- The test asserting a Recent row *omits* the pen inverts: a Recent row now carries one named
  **Edit chat**, and carries neither `aria-label="Rename"` nor `.channel-list__rename` (AC2's
  "that selector still matches Channels rows alone", asserted from the chat row's side).
- The mirror on the Channels side: a promoted row carries no `.channel-list__chat-edit`.
- The chat pen's glyph run, asserted whole including its own icon class, in the shape the two shipped
  glyph tests use — so neither pen can satisfy the other's case.
- The chat pen's pill, asserted as the `</svg><span class="channel-list__control-name" …>` adjacency, for
  the shipped reason: only adjacency catches a pill that drifted out of the button.
- The drift guard `keeps each control's pill text and accessible name in step` covers **Edit chat**, and
  counts *two* controls and *two* pills on a chat row.
- Both `host-owned mutation availability` cases withhold `aria-label="Edit chat"` alongside **Rename**
  and **Save as channel**.

**`e2e/sidebar-row-geometry.spec.ts`** (fake transport — AC4):

- The Chats-row block pins both controls: the pen's 12×12 glyph 8px in and centred on the row, the
  chevron's glyph 28px in (a new `CHEVRON_RIGHT_INSET_PX` beside `GLYPH_RIGHT_INSET_PX`), the pen's
  `--color-primary`, the row's height unchanged with two controls on it, and the pen hidden at rest and
  revealed by the row's hover. `.channel-list__rename` counts 0 there.
- The Channels-row block asserts `.channel-list__chat-edit` counts 0 — the disjointness restated from the
  other side.
- A new block drives AC1's behaviour clause end to end on a single seeded **null-named** chat row: click
  the pen with no hover first (the path the shipped specs take), the **Edit chat** dialog opens, its field
  is seeded with the row's displayed title — `Untitled`, AC1's named fallback — then a new name and OK,
  and the sidebar row's title becomes it. The stateful fake's `rename_conversation` arm applies the rename
  and re-lists, so this proves the round trip rather than only the click.

**`e2e/sidebar-control-name-pill.spec.ts`** (AC4's counts):

- The launch seed is `is_promoted: false`, so the one seeded row now carries two controls: the
  launch-time pill count goes 1 → 2.
- The tall list holds forty promoted rows plus one chat row, so every per-row pill count becomes
  `rowCount + 1`, through one named constant rather than four edited literals.
- The bottom-edge mirror block parks on the chat row's chevron and asserts `pills.last()` reads
  **Save as channel**. That row now has two pills, and with the chevron emitted first its last pill is the
  pen's. The locator is re-scoped to the control being parked on rather than re-ordered around —
  a pill read through `save.locator('.channel-list__control-name')` says which control it belongs to,
  which is what the block meant all along.

**Not edited:** no `real-*` spec, and none of the twelve `.channel-list__rename` locators outside the two
files above — the whole point of the second token.

**Visual check:** the built app under the fake transport, a chat row hovered, compared against the Figma
node above for the pen's glyph, its inset and the chevron beside it.

## Documentation handoff

Pending for the documentation stage — not written here:

- `docs/knowledge/features/channel-list-row-hover-control.md` records that a Chats row now carries two
  trailing controls, the chevron's new 28px inset, and why the chat pen's class token is a restatement
  rather than a share — with the spec count that decided it (twelve locators, six of them `real-daemon-*`).
- `docs/knowledge/features/channel-list-control-name-pill.md` records the chat pen's name beside the two
  already there, and the per-tree two-constant shape #1430 relies on.

## Revisions

**2026-09-15, during implementation — the drift guard counts tokens, not pills.** The plan said the
`keeps each control's pill text and accessible name in step` guard would count *two pills* on a chat row.
It cannot: `.channel-list__control-name` is worn by six other sidebar controls (the host row's pen and
plus, the workspace row's plus and pen, the two section headers' plus), so a document-wide count of that
class answers about the whole sidebar — it came back 7 on a one-row render. `rowChunksIn` does not fix it
either, its last chunk running to the end of the markup rather than to the end of the row. The guard now
counts each control's **own** token (`class="channel-list__chat-edit"` and `class="channel-list__save"`,
both unique), which is the same claim — a chat row carries both controls — made with a locator that can
only be about that row. The name↔pill parity half is unchanged and covers **Edit chat** as planned.

## Open questions

- **The chevron's fate on a chat row.** The drawing shows none and the Edit chat modal carries no Save as
  channel. Built on the ticket's stated assumption — it stays, 20px inside the pen — and flagged for
  Juhana on the ticket. If the ruling goes the other way the change is a deletion, not a redesign.
- **The overlapped title tail.** With both controls revealed, the chevron's glyph reaches 12px past the
  row's 28px trailing padding and sits over the tail of a long title. Accepted: widening the padding is
  out of scope and `sidebar-row-geometry` pins the 28.
