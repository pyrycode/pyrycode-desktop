# #800 — the status dot component and its three states

The presentational leaf of the sidebar row: one already-resolved `ConversationStatus` in, one dot out.
No store read, no resolution, no call site. #799 landed the type and the resolver; #801 wires the row.

## Files to read first

Codegraph is wired but **not indexed** for this repo (`.codegraph/` holds `config.json` and no DB), so every
`codegraph_*` call errors `CodeGraph not initialized`. This list was built by grep + Read; do not spend a
turn probing codegraph.

- `src/renderer/src/store/conversationStatus.ts:51-54` — `ConversationStatus`, the prop's type. Import it;
  do not restate the union. This ticket is its first consumer.
- `src/renderer/src/screens/channels/ChannelList.tsx:310-350` — `HostConnectionDots`: the in-repo shape for
  a labelled dot. `role="img"` + `aria-label`, template-literal modifier off a closed union, no text node.
  Copy the shape, not the class tokens, and read the doc comment above it for why `role="img"` is
  load-bearing.
- `src/renderer/src/screens/channels/channels.css:92-108` — `.channel-list__host-dot`. The 6px sidebar dot's
  geometry, and the comment recording that the design's **6×14 instance frame is reproduced without a
  wrapper element**. That precedent decides this component's markup (see § Geometry).
- `src/renderer/src/screens/conversation/conversation.css:727-741` — `.bubble__cursor`: the complete
  three-part blink shape (`animation` → `@keyframes` → `@media (prefers-reduced-motion: reduce)`). Follow
  the structure; the timing function differs (see § The blink).
- `src/renderer/src/screens/conversation/conversation.css:1425-1458` — the `conn-dot--*` colour contract and
  the comment stating it has exactly one copy in the renderer. Read it to understand why this ticket
  declares **its own** colour bindings rather than reusing that family.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:589-630` — the dot-test idiom in this directory:
  marker constants, one assertion per union member so the binding is pinned rather than sampled.
- `src/renderer/src/theme/tokens.css:24,39` — `--color-primary` (#9dcbfc) and `--color-success` (#2fc038).
  Use the token **names**; never the hex, and never a Figma export's light-scheme fallback (desktop is
  dark-only, ADR 0003).
- `src/renderer/src/screens/conversation/conversation.css:795-818` — #796's spin + reduced-motion pair, the
  most recent precedent for "a class the unit tier can see, a media rule it cannot".

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3051

The `Status dot` instance is a 6×14 frame holding a single **stroked, unfilled** circle — `cx=3 cy=11
r=2.5`, `stroke=#9DCBFC` (exactly `--color-primary`), `fill=none` — leading the `Channel` row's title
(`103:2968`, 340×24, dot at x=16, title at x=32). Since blue is the *assistant working* colour in the
ticket's own table, the one drawn instance is the **working** state, and the dot is a 1px **ring**, not a
filled disc — which is what separates it from the filled `conn-dot` / `channel-list__host-dot` family six
pixels above it in the same sidebar. `Status dot` is a local instance with no variants: the design draws
one state, the ticket's table supplies the other two.

## Context

The sidebar's rows must report what each conversation is doing without being read. #799 reduced the two
facts a row holds to one `ConversationStatus`; this ticket draws it. Splitting the dot from the row wiring
(#801) keeps the drawing testable with no store in scope — the component is a pure function of one closed
union, which is the whole reason it is its own ticket.

Three states ship. The fourth, **input required** (yellow), is not buildable: no `conversation_id` rides a
modal frame (ADR 0009). #802 inserts it. Do not add an unreachable variant, and do not leave a
`default:` arm shaped like a placeholder for it.

## Design

### Files

| File | Change |
| --- | --- |
| `src/renderer/src/screens/channels/ConversationStatusDot.tsx` | new — the component and its label constants |
| `src/renderer/src/screens/channels/ConversationStatusDot.test.tsx` | new — the unit spec |
| `src/renderer/src/screens/channels/channels.css` | edited — one appended block: geometry, three colour bindings, the blink, the reduced-motion guard |

One new production source file. It lives beside `ChannelList.tsx` because the sidebar is its only consumer
(#801) and the directory already holds `ChannelList`'s sibling components. Its styles go in `channels.css`
for the same reason.

**Do not add `import './channels.css'` to the new component.** `ChannelList.tsx:1` is this directory's
single stylesheet import and its siblings (`RenameConversationDialog`, `SaveAsChannelDialog`) all decline
one. A second import is the repo-idiom break a reviewer will flag.

### The component

```ts
export function ConversationStatusDot({ status }: { status: ConversationStatus }): JSX.Element
```

One `<span>`, no wrapper, no child, no text node. It carries:

- `className={`conversation-status-dot conversation-status-dot--${status}`}` — the base token in every
  state (the box, AC4) plus a modifier that differs per status (AC1). Interpolating `status` directly is
  safe and is the `conn-dot--${host.category}` idiom: the union is closed, client-owned and never touches
  the wire. **Idle gets an explicit `--idle` modifier**, not base-only, so a dropped modifier fails a test
  instead of rendering as idle.
- `role="img"` + `aria-label` — `role="img"` is what makes the label land: on a bare `<span>` the
  accessible-name computation drops `aria-label` and the dot ships nameless (`ChannelList.tsx:320-322`
  records this for the host dots). Not `role="status"`: that is a live region, and #801 renders one of
  these per row.

The label comes from a `Record<ConversationStatus, string>` module constant, **not** a `switch`. The record
is exhaustive by type, so #802's fourth status is a compile error here rather than a silently unlabelled
dot; a `switch` with a `default:` arm swallows it. Client-owned copy in the app's own voice, matching the
ticket's own status table:

| status | label |
| --- | --- |
| `working` | `Assistant working` |
| `new-messages` | `New messages` |
| `idle` | `Idle` |

No daemon text can reach this file: the only input is one of three client-owned literals. Nothing is logged
on any path, matching the resolver's log-free construction.

### Class naming — the collision guard

The block is `conversation-status-dot`. Checked against both hazard families named in the ticket:

- **Playwright strict mode.** `launchPairedApp.ts:224` clicks an unfiltered `.channel-list__row-open` and 28
  specs ride it. `conversation-status-dot*` is a distinct class token from `channel-list__row`,
  `channel-list__row-open`, `channel-list__section-header` and `channel-list__host*`, so it joins no
  existing locator's match set. No file under `e2e/` needs touching.
- **Substring assertions on raw markup.** `ChannelList.test.tsx` counts `class="channel-list__row"` and
  `class="channel-list__row-open"` as literal strings; `ConversationScreen.test.tsx` asserts
  `toContain('conn-dot--up')` and its three siblings. `conversation-status-dot--working` /
  `--new-messages` / `--idle` contains none of those, and — the direction that is easy to miss — contains
  neither `conn-dot` nor `conversation__` (the existing `conversation__thinking` / `__queued` family uses a
  double underscore, this block uses a hyphen).

If the developer renames the block, both directions must be re-checked, not just the first.

### Geometry

6px wide, 6px tall, `flex: 0 0 auto`, `border-radius: var(--radius-full)` — **identical in all three
states**, which is AC4: the horizontal advance is 6px whatever the status, so a row's title never shifts.

The Figma's 6×14 is the *instance frame*, not the dot. It does not become a wrapper element: centring a 6px
dot against the row's line box reproduces that frame with no extra node, which is exactly what
`channels.css:92-107` already records for the host dots and `#703` for the `Row icon` frame. Adding a
wrapper here would break with the neighbour it sits beside for no visual gain.

### Paint

The ring is drawn with `box-shadow: inset 0 0 0 1px <token>` on the 6px box, not with `border`.

This is the load-bearing choice for AC4. The repo has **no global `box-sizing` reset** (recorded at
`conversation.css:750`), so a `border` would grow a 6px box to 8px and shift the title by 2px in
exactly the two states where the dot is visible. An inset shadow has zero layout effect by construction, so
"the same box in all three states" holds without depending on a `box-sizing` declaration a later edit could
drop. `background` stays unset — the design's circle is unfilled.

| modifier | paint |
| --- | --- |
| `--working` | ring in `var(--color-primary)` + the blink below |
| `--new-messages` | ring in `var(--color-success)` |
| `--idle` | no shadow, no background — the box is present and unpainted |

Token names only. `--color-primary` is `#9dcbfc`, which is the Figma stroke exactly; do not paste the hex,
and do not reach for a Figma export's `#32628d`, which is the light scheme's primary.

**These three bindings are this component's own and must not reuse `conn-dot--up`.** That family is the
*connection* contract, deliberately kept to one copy in the renderer (`conversation.css:1425-1435`), and it
reports whether a machine is reachable. This dot reports what a conversation is doing — a different
concept, a different box (ring vs fill), and a class whose substring is already asserted in two test files.
Wearing `conn-dot--up` here would couple the two contracts and trip those assertions.

### The blink

`animation: conversation-status-dot-blink 2s ease-in-out infinite` on `--working` only, with a `@keyframes`
block fading opacity to a **floor, not to zero** — `0.3` at the midpoint. `.bubble__cursor` fades to 0
because a caret that vanishes still reads as a caret; a status dot that vanishes reads as *idle*, which is
the one wrong reading available. `ease-in-out` rather than `step-end`: the design asks for a fading blink,
and the cursor precedent's structure transfers while its timing function does not.

2s and 0.3 are client-owned constants — the Figma node is a static vector with no motion spec, so there is
nothing to port. Slow enough to read as "working", not as a loading spinner.

The reduced-motion guard is the third part of the `.bubble__cursor` shape, verbatim: a
`@media (prefers-reduced-motion: reduce)` block setting `animation: none` on `--working` alone, leaving a
steady blue ring (AC3). It must not touch the base class or the other two modifiers, which have no
animation to cancel.

## State and concurrency model

None. No store, no subscription, no effect, no async work, no cancellation. The component is a pure
function of its one prop and re-renders only when #801's row passes a different status. The animation is
compositor-owned, so a working conversation costs zero React renders.

## Error handling

No failure mode exists. The prop is a closed union, every member has a branch, and the function is total —
so no result type, no throw path, no UI error surface and no logging. The one failure the *type system*
must catch is a fourth union member arriving (#802) without a label or a colour binding: the exhaustive
`Record<ConversationStatus, string>` makes that a `npm run typecheck` failure. Nothing else needs guarding.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) — `renderToStaticMarkup` against the component directly, no
stores, no fixtures. Follow `ChannelList.test.tsx:589-630`: marker constants at the top, one assertion per
union member so each binding is pinned rather than sampled. Scenarios, as bullets — write them in the
file's own idiom:

- Each of the three statuses emits its own modifier token, one case each. A shared helper rendering one
  status keeps the three cases one line apiece.
- The three markups are pairwise distinct (AC1) — the assertion that catches a modifier interpolated from
  the wrong value or dropped entirely.
- Exactly one element is emitted per render (AC1): count the base-class occurrences, expect 1.
- Every status carries the base class as well as its modifier (AC4) — the box is what the base class holds,
  so losing it is how the title starts shifting.
- Each status carries `role="img"` and its own `aria-label`, one case each (AC2), asserted as the literal
  label strings.
- **A collision-regression guard**: the emitted markup contains none of `conn-dot`, `channel-list__row`,
  `channel-list__host-dot`. Cheap, deterministic, and it is the assertion that survives a later rename —
  the hazard the ticket names twice.

Not covered by the unit tier, deliberately: the three colours and the reduced-motion fallback. Renderer
specs are static server renders with no DOM, no CSSOM and no media-query evaluation, so both are CSS-level
guarantees (the ticket says so, and `conversation.css:812-818` records the same for #796's spinner).

**No e2e spec ships with this ticket** — nothing renders the component until #801, so a Playwright spec
would have nothing to load. `e2e/composer-status-reduced-motion.spec.ts` is the shape to clone once a call
site exists; see Open questions.

Type coverage: `npm run typecheck`. Build gate: `npm run build`.

## Open questions

1. **Ring or filled disc.** The spec follows the Figma vector, which is a 1px stroke with no fill. The
   sidebar's other dots (`channel-list__host-dot`) are filled. If the operator wants a filled disc, the
   change is one declaration per modifier (`box-shadow: inset …` → `background:`) and touches nothing else
   — worth raising at code review rather than pre-empting here.
2. **Whether the idle dot should be announced at all.** AC2 says every dot carries a label naming its
   state, and this spec follows it literally. Its stated reason — "so colour is not the only signal" —
   applies to the two painted states; an unpainted idle dot has no colour to compensate for, and #801
   renders one per row, so a long sidebar will announce "Idle" once per conversation. Building it as
   specified; flagging it for the operator, since suppressing the idle label is a one-line change in #801's
   ticket, not here.
3. **Reduced-motion e2e coverage** lands with the first ticket that renders the dot (#801). Noting it so it
   is not lost between the two.
