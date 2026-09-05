# #1098 — the sidebar fills the row of the chat you have open

The second half of #1059, on top of #1097's converged row (merged 2026-09-05 in #1100). #1097 gave the
row its 24px box, its body-small label and its 6px corner *on the open button*; it marks the open row
in no way at all. This slice marks it: the open chat's row wrapper carries the design's fill and its
label goes one weight heavier, and nothing else about the row moves.

## Files read

Codegraph was not consulted: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized", so this reading list came from Read + Grep. Noted here because the builder brief tells me
to prefer codegraph for symbol-level questions and the gap is repo-wide, not ticket-specific.

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList` (the store-bound container),
  `ChannelListView` (the pure view), `renderBody`, `Row` — where the read lands and where the state is
  rendered. Its `ConversationStatusDotControl` header carries the constraints that bind here (no hooks
  in `renderBody`'s map callbacks, no merged-object selectors), and `WorkspaceRow`'s header carries the
  sole-class-token ruling this slice follows.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__row`, `.channel-list__row-open`,
  `.channel-list__row-open:hover`, `.channel-list__row-open:focus-visible`, `.channel-list__title` —
  the five rules the fill sits beside. The `.channel-list__row-open` header states #1097's ruling that
  the corner stayed on the button so this ticket could decide the spanning fill's surface.
- `src/renderer/src/store/activeConversationStore.ts` → `useActiveConversationStore`,
  `selectActiveConversation`, `ActiveConversationState` — the read surface. **The held payload's id
  field is `id`, not `conversation_id`** (`ConversationCreatedPayload` in `src/shared/wire/types.ts` is
  a 5-field shape: `id, is_promoted, cwd, name, last_used_at`). The ticket body says `conversation_id`;
  it is wrong, and every shipped reader already uses `.id`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `activeConversationId` read
  (`useActiveConversationStore((s) => s.activeConversation?.id ?? null)`, #448) — the shipped
  precedent for the exact selector shape this slice reuses, inline arrow included.
- `src/renderer/src/App.tsx` → `openConversationId` — the same read non-reactively; its header warns
  against collapsing an empty-string id into "nothing open" with a truthiness test.
- `src/renderer/src/activateConversation.ts` → `activateConversation` — `setActiveConversation` runs
  unconditionally on both branches before navigation (#448), so the store is correct for a sidebar row
  click and for a FAB-minted conversation alike. Nothing here changes.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` and `QuestionPanel.tsx` → their
  `aria-current={isCurrent ? 'true' : undefined}` sites — the four shipped precedents for carrying
  "this is the current one" as an attribute that is *omitted* rather than emitted as `"false"`.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `ROW_MARKER`, `ROW_OPEN_MARKER`,
  `TITLE_MARKER`, `rowChunksIn`, `workspaceRowTagsIn`, and the `changes nothing but the state
  attribute` equality in the `CollapsibleWorkspaceGroup` describe — the whole-attribute-run matchers
  AC5 is really about, and the template for how to state AC5 as an equality.
- `e2e/sidebar-row-geometry.spec.ts` → both `test()` blocks — #1097's live 24px detector, and the
  block whose step 3 asserts `font-weight: 400` on the seeded row. **That row is the open row at
  launch**, so this slice breaks that assertion and must fix it.
- `e2e/conversation-switch-keeps-both-threads.spec.ts` → the two sidebar-click switches at its steps 4
  and 5 — the one existing drive that has two conversations and exercises the row-click activation path.
- `e2e/fixtures/launchPairedApp.ts` → the `.channel-list__row-open` click that reaches the thread —
  why the seeded row is already the open row in all 29 fixture-riding specs.
- `docs/knowledge/features/channel-list-desktop-row-geometry.md` — #1097's four changes and the
  explicit hand-off of the open-row fill to this ticket.
- `docs/knowledge/features/channel-list.md` § the row's status dot — the per-row-subscription reasoning
  this plan weighs its read location against.
- `src/renderer/src/theme/tokens.css` → `--color-on-primary` (`#003355`, `:35`),
  `--text-body-small-weight-emphasized` (`500`, `:159`), `--radius-xs` (`6px`),
  `--color-surface-container` (`#1d2024`, the opaque hover fill that must be suppressed).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2969

The open row is the resting row's box (`103-2968`) with two changes and nothing else: the whole row box
is filled `#003355` behind a 6px corner, and the label is `M3/body/small-emphasized` — weight 500, with
the size, line height, tracking and colour of body-small unchanged. `get_design_context` returns the
box as `bg-[#035] … px-[16px] py-[4px] rounded-[6px]` with a `font-medium` label, and confirms the fill
is an unbound hex (hence no variable for it from `get_variable_defs`). The list frame (`103-2985`)
shows exactly one row filled among six, the rest drawn flat on the sidebar ground.

## Context

The sidebar marks the open chat in no way at all. With two trees, several workspaces and a chat pane
that retains its thread across switches (#758), nothing ties the thread in front of the reader to the
row it came from.

The open chat's id is already in the renderer and the sidebar simply does not read it. So the feature
is a reactive read plus two CSS rules — no store, no IPC, no wire, no new type.

No ADR is warranted. The two decisions below are local component/CSS shape decisions, both with shipped
in-file precedent; they belong in this plan and in the package overview, not in the decisions tree.

## Design

### 1. Where the open id is read: the container, threaded down as a prop

`ChannelList` — the store-bound container whose own docstring says "the store read is its only
impurity" — takes the read:

```ts
const openConversationId = useActiveConversationStore((s) => s.activeConversation?.id ?? null)
```

That is `ConversationScreen`'s shipped selector verbatim (#448). It returns a primitive `string | null`,
so it is value-stable under `useSyncExternalStore` with no merged-object hazard, and the inline closure
costs one allocation and one `Object.is` per render — never a re-subscription.

`ChannelListView` gains a required `openConversationId: string | null` prop, `renderBody` gains the same
positional parameter after `conversations`, and each of the two `.map()` sites passes `Row` a boolean
`isOpen={c.id === openConversationId}`. The comparison is `===` against a possibly-`null` id, never a
truthiness test — an empty-string id stays an ordinary key, the trap `App.tsx`'s own header names.

**Why here rather than per-row.** A per-row `useActiveConversationStore` inside `Row` is a smaller diff
and a tighter re-render boundary (only the two rows whose boolean flips would re-render), and it is
what `ConversationStatusDotControl` does one component over. It is rejected for one reason: it would put
the whole feature out of the renderer tier's reach. Zustand v5 serves `getInitialState()` under
`renderToStaticMarkup`, so a store-reading `Row` can only ever render `activeConversation: null` — a unit
test could prove the *unfilled* case and nothing else, and AC2, AC3 and AC5's open half would rest
entirely on e2e. Lifting the read to the container instead makes the whole matrix injectable through the
prop the test file's existing `render()` helper already builds, and it does so with **no new component
and no new export** — where the file's twice-shipped answer to the same problem (`HostRow` /
`HostRowControl`, `HostConnectionDots` / `HostConnectionDotsControl`) costs both.

The honest cost, stated rather than hidden: `ChannelListView` re-renders the whole sidebar when the open
chat changes, where a per-row read would re-render two rows. That is accepted — a switch already tears
down and rebuilds the chat pane, and the sidebar is a bounded list. This is also the prop path #1097
freed by deleting `now`.

### 2. How the state is carried: `aria-current` on the open button, never a modifier class

`Row`'s open button renders `aria-current={isOpen ? 'true' : undefined}` — attribute present on exactly
one button, **omitted** (not `"false"`) on every other, which is the shape all four shipped consumers
use (`ComposerOptionsPanel`, `ComposerModelMenu`, `ComposerSlashCommandTypeAhead`, `QuestionPanel`).

Rejected: appending a `--open` modifier class. Three reasons, in order of weight:

- **It is an affordance, not decoration.** `aria-current` announces the open chat to a screen reader
  ("leaky-faucet, button, current"); a class announces nothing. That is why it goes on the *button* —
  the element a keyboard user lands on — and not on the role-less `<div>` wrapper, where the same
  attribute would be reachable only by browse-mode traversal of a generic container.
- **AC5 becomes true by construction, for every row including the open one.** `ChannelList.test.tsx`
  matches whole attribute runs (`class="channel-list__row"`, `…__row-open"`, `…__title"`) and
  `rowChunksIn` *splits* the render on the first of them, so a marker that stops matching yields zero
  chunks and passes every `for` loop in the #801 describe vacuously instead of failing one. A modifier
  class would arm that trap the moment any future test seeds an open row. An attribute after the class
  leaves all three runs byte-identical.
- **It is the ruling this file already made one row-family element over.** `WorkspaceRow` keeps its
  class token sole and styles its collapsed state off `[aria-expanded='false']`, for exactly the
  silent-zeroing reason above.

### 3. The fill goes on the wrapper, selected through `:has()`

`.channel-list__row-open` is a `flex: 1 1 auto` sibling of the trailing Save-as-channel / Rename
controls, not their parent, so a fill on it stops short of the row's trailing edge — AC1's first clause
forbids that. The fill goes on `.channel-list__row`, which already spans the row and is already
`position: relative`. Since the state lives on the button, the wrapper is selected by

```css
.channel-list__row:has(> .channel-list__row-open[aria-current='true'])
```

`:has()` has two shipped consumers in `conversation.css` (`.composer__row:has(.composer__input:focus-visible)`,
`.question-panel__option:has(…)`); Electron 33 is Chromium 130 and it shipped in 105.

Three rules, one block, placed immediately after `.channel-list__row-open:focus-visible`:

| Rule | Declaration | Why |
|---|---|---|
| `.channel-list__row:has(> .channel-list__row-open[aria-current='true'])` | `background: var(--color-on-primary)` + `border-radius: var(--radius-xs)` | the node's `#003355` fill and its 6px corner. **Background only — no padding, no border, no min-height**, so the wrapper's box does not move. |
| `.channel-list__row-open[aria-current='true']:hover` | `background: none` | AC4. `--color-surface-container` is opaque `#1d2024`; unsuppressed the button's hover would paint over the fill across the button's share of the row. Specificity (0,3,0) beats the base rule's (0,2,0), so this wins on merit and not on source order. |
| `.channel-list__row-open[aria-current='true'] > .channel-list__title` | `font-weight: var(--text-body-small-weight-emphasized)` | AC3. `M3/body/small-emphasized` differs from body-small in weight alone, so this is one declaration and not a second type quad. (0,3,0) over `.channel-list__title`'s (0,1,0). |

`--color-on-primary` is the right token by value and the file's no-literals rule requires a token, but
this is its **first use as a background** — its own token comment scopes it to the label/icon role on a
`--color-primary` fill. The rule's comment says so. It is not "corrected" to `--color-primary`, which is
a different colour (`#9dcbfc`).

`:focus-visible` is untouched on every row: it is an outline, not a fill, and #274's ruling that the two
affordances highlight independently still stands. So do the trailing controls' own hover circles — the
design draws no trailing control at all, and AC4's clause is about the row's fill.

## State + concurrency model

One reactive subscription, in `ChannelList`, to `activeConversationStore` — a store that already exists
and whose write paths (`activateConversation`'s `setActiveConversation`, `clearActiveConversation` on
unpair/exit) are untouched. No new store slice, no async work, no subscription to tear down beyond what
`useSyncExternalStore` already owns, no `AbortSignal`. Unidirectional is preserved: the sidebar reads and
never writes.

Server-render safety: the store hydrates to `activeConversation: null`, so `ChannelList` under
`renderToStaticMarkup` yields `openConversationId: null` and every row renders unfilled — which is also
AC1's "no row is filled before a chat has been opened".

Exactly-one-filled (AC2) is a property of the data, not of a guard: one store holds one payload, and
`partitionActive` puts each conversation in exactly one tree, so at most one row's `c.id` can match. An
open id that matches no row (a stale id after the conversation is archived or deleted) fills nothing —
also by construction, and asserted.

## Error handling

No new failure modes: no I/O, no IPC, no parsing, no daemon value crossing a boundary. The one absence
worth naming is that **the conversation id stays a comparison operand and nothing else** — it is
daemon-asserted, so it must not become a class-name interpolation, an attribute value, a `title`, an
object key or a log line, exactly as `ConversationStatusDotControl`'s header requires of the same value.
`aria-current`'s value is the client-owned literal `'true'`, never the id. No `console.*` on any path:
there is no event here and no failure to report.

## Testing strategy

**Renderer tier — `ChannelList.test.tsx`, a new `#1098` describe.** The `render()` helper gains an
optional second parameter defaulting to `null`, so all existing call sites are unchanged. A new
`rowOpenTagsIn` helper slices each open button's whole opening tag, the `workspaceRowTagsIn` treatment
applied to `ROW_OPEN_MARKER`. Scenarios:

- no open id → zero `aria-current` anywhere in a three-row render (AC1's last clause).
- an open id matching one of three rows → exactly one `aria-current="true"`, and it is in *that* row's
  chunk (chunk-scoped through `rowChunksIn`, the #801 misattribution guard); the other two chunks carry
  none (AC2).
- AC5 stated as an equality in the `CollapsibleWorkspaceGroup` template's shape: the open row's button
  tag equals a resting row's with `aria-current="true"` inserted, and the counts of `ROW_MARKER`,
  `ROW_OPEN_MARKER` and `TITLE_MARKER` are identical between the two renders.
- an open id matching no row → zero `aria-current`.

The stale comment at `ChannelList.test.tsx`'s `#874 AC4` test — "`ChannelListView` takes no
active-conversation prop and this component has no open-conversation concept at all" — becomes false and
is corrected in place; the test's own claim survives, since that describe renders with no open id.

**What this tier cannot prove** and why it is e2e: the computed fill colour, the corner, the weight the
browser actually resolved, the hover outcome, and the fill moving on a switch all need a layout engine.

**e2e — `e2e/sidebar-row-geometry.spec.ts`** (the static half; the fixture reaches the thread by clicking
the single seeded row, so that row is already the open row at launch):

- **A break this slice causes and must fix:** step 3 asserts `font-weight: 400` on `.channel-list__title`
  of the seeded — now open — row. It becomes 500. The constant splits into a resting and an open value;
  step 3 asserts the open one and says why, and the resting 400 moves to step 7, where the FAB has
  minted a second conversation and made *it* the open one.
- the open row's computed `background-color` is `rgb(0, 51, 85)` and its `border-top-left-radius` is 6px.
- after the FAB mints and opens a second row: exactly one `.channel-list__row:has(> .channel-list__row-open[aria-current='true'])`;
  the two rows' background colours are the fill and `rgba(0, 0, 0, 0)`; the two titles' weights are the
  set `['400','500']`. Asserted as sets and counts, never by `nth()` position and never by seed text —
  that file's stated secret-hygiene posture is numbers, colours and counts only.
- hovering the open row's button leaves the row's background at the fill; hovering the resting row's
  button paints `rgb(29, 32, 36)` on the button and leaves that row's wrapper transparent (AC4).
- the existing 24px height assertions are not touched: they run with the fill present, so they already
  are this slice's regression detector for a wrapper that grew.

**e2e — `e2e/conversation-switch-keeps-both-threads.spec.ts`** (AC2's moving half through the *row-click*
activation path, which the FAB path above does not exercise). It already mints a second conversation and
switches both ways by clicking rows; two assertions are added after each switch: exactly one filled row
exists, and it is the row whose title was just clicked. That spec already filters rows by text, so this
is in-posture there.

**Deliberately not asserted:** the `:focus-visible` outline. `:focus-visible` does not match after a
programmatic `.focus()` in Chromium, and tabbing into the sidebar from a known anchor is brittle. AC4's
focus clause is a *no-change* claim and is evidenced by the diff: the `.channel-list__row-open:focus-visible`
rule is untouched and no new rule is specific enough to reach it.

## Open questions

1. **Does the trailing Save/Rename control's own hover circle need suppressing on an open row?** Resolved
   in the Design above: no — #274's ruling is that the two affordances highlight independently, and the
   design draws no trailing control. Recorded here because it is the natural next question AC4 invites.
2. **Is the focus-visible outline legible against `#003355`?** `--color-outline` is `#8c9199` on a dark
   navy fill — high contrast, so no change is warranted, and AC4 requires none. If the contrast is ever
   judged wrong it is a separate ticket, not a silent retune here.
3. **Should the fill respond to a `prefers-contrast` or reduced-transparency setting?** Out of scope; the
   app has no such handling anywhere today, and inventing one here would be the first.
