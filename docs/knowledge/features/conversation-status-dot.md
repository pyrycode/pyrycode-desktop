# Conversation status dot

The presentational leaf of a sidebar row: `ConversationStatusDot({ status })` takes one already-resolved
[`ConversationStatus`](conversation-status.md) and draws it as a single dot. It reads no store, resolves
nothing — [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801) wires it into
[`ChannelList`](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801-874)'s rows, its only
consumer.

Introduced in [#800](https://github.com/pyrycode/pyrycode-desktop/issues/800), split from #676.
Renderer-only, no store, no transport — not security-sensitive.
[#873](https://github.com/pyrycode/pyrycode-desktop/issues/873) added the fourth state, `input-required`,
and its amber ring, landing correct-but-unreachable until
[#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) wired the call site — all four states are
now reachable in production.
[#1174](https://github.com/pyrycode/pyrycode-desktop/issues/1174) then repainted it to the redrawn Channel
list frame: the 1px ring moved off each status and onto the dot's shared base rule, so idle wears it too,
and idle gained a conditional fill while its own row is hovered or open.

## What it does

Renders exactly one `<span role="img" aria-label="…">`, no wrapper, no child, no text node, with class
`conversation-status-dot conversation-status-dot--{status}`:

| status | paint | label |
| --- | --- | --- |
| `input-required` | 1px primary ring, `--color-warning` fill | "Input required" |
| `working` | 1px primary ring, `--color-tertiary` fill + a slow fading blink, stilled to a steady disc under `prefers-reduced-motion: reduce` | "Assistant working" |
| `new-messages` | 1px primary ring, `--color-success` fill | "New messages" |
| `idle` | 1px primary ring, no fill at rest — fills `--color-primary` while its row is hovered or open ([#1174](https://github.com/pyrycode/pyrycode-desktop/issues/1174), conditional, declared at the row's call site rather than here) | "Idle" |

Since #1174 every status wears the same 1px `--color-primary` ring; before it, the ring itself carried the
status colour and idle wore no paint at all. All four states still share the same 6×6 footprint, so a
row's title never shifts horizontally when its status changes. The labels are client-owned constants in
the app's own voice — the component's only input is one of four closed-union literals, so no daemon text
can reach it.

## How it works

New file beside `ChannelList.tsx` (its only planned consumer), styled by an appended block in
`channels.css` rather than a stylesheet import of its own — `ChannelList.tsx` is this directory's single
`import './channels.css'`, and both dialog siblings (`RenameConversationDialog`, `SaveAsChannelDialog`)
already decline a second one.

- **The label map is a `Record<ConversationStatus, string>`, not a `switch`.** It is exhaustive by type,
  which is what forced [#873](https://github.com/pyrycode/pyrycode-desktop/issues/873)'s fourth status and
  its label to ship in one commit — adding a union member without an entry here is a `npm run typecheck`
  failure, and `npm run build` runs typecheck first, so the salvage gate catches a silently unlabelled dot
  before it ever reaches this component. A `switch` with a `default:` arm would have swallowed it silently
  instead. Module-private; the unit spec asserts the shipped literal strings instead of importing the map.
- **Idle carries an explicit `--idle` modifier**, not the base class alone, so a dropped modifier fails a
  test instead of quietly rendering as a correct-looking idle dot.
- **`role="img"` is load-bearing, not decorative.** On a bare `<span>` the accessible-name computation
  drops `aria-label` outright — the dot would ship nameless. Not `role="status"`: that is a live region,
  and #801 renders one of these per row. This is the same shape `HostConnectionDots`
  (`ChannelList.tsx:310-350`) already uses for the sidebar's connection dots.
- **The ring is `box-shadow: inset 0 0 0 1px var(--color-primary)`, never `border`, and since
  [#1174](https://github.com/pyrycode/pyrycode-desktop/issues/1174) it is declared once on the base
  `.conversation-status-dot` rule rather than restated per modifier** — every status, idle included, now
  wears it. This repo has no global `box-sizing` reset (`conversation.css:750`), so a 1px border would grow
  the 6px box to 8px and shift the row title by 2px in every state — an inset shadow has zero layout effect
  by construction, so the shared-footprint guarantee doesn't depend on a `box-sizing` declaration a later
  edit could drop. Each modifier now sets `background` alone: `--color-tertiary` for `working`,
  `--color-success` for `new-messages`, `--color-warning` for `input-required`. That still separates the
  family from the filled `.channel-list__host-dot` / `.conn-dot` dots six pixels above it in the same
  sidebar — those carry no ring at all — but it no longer separates `--input-required` from
  `.conn-dot--in-progress` (`conversation.css:1817`) by form: both are now filled `--color-warning` discs.
  The 1px primary ring is what keeps the two readings apart instead; see the note below, which #1174
  settled in the opposite direction from how #873 first wrote it.
- **`idle` still has no *unconditional* background rule — the missing fill at rest is still the design.**
  The class ships on the element so a dropped modifier fails a unit test rather than rendering as idle by
  coincidence. Since #1174 it also carries a *conditional* fill: an idle dot fills `--color-primary` while
  its own row is hovered or holds the open conversation. That rule is declared beside the row's own two
  fill carriers in `channels.css` — `.channel-list__row:hover` and
  `.channel-list__row:has(> .channel-list__row-open[aria-current='true'])`, both from [Channel List § the
  open row's fill](channel-list-desktop-row-geometry.md) — not in this component's own CSS block, since the
  selectors it hangs off belong to the row wrapper, not the dot. It is scoped to the `--idle` modifier
  rather than written against the bare class: unscoped, `:hover` on the bare class would be (0,3,0) against
  each painted modifier's (0,1,0) and would repaint a hovered *working* or *unread* row's dot primary,
  destroying the reading the fill exists to give. Scoped, a dot cannot be `--idle` and `--working` at once,
  so the two never compete.
- **The blink fades to a floor (`opacity: 0.3` at 50%), never to zero,** and uses `ease-in-out` rather than
  `.bubble__cursor`'s `step-end` (`conversation.css:727-741`, the in-tree precedent this follows for the
  animation/`@keyframes`/reduced-motion three-part shape). A caret that vanishes still reads as a caret; a
  status dot that vanishes reads as idle, the one wrong reading available. The 2s duration and the 0.3
  floor are client-owned constants — the Figma node is a static vector with no motion spec, so there was
  nothing to port. **The blink and its `prefers-reduced-motion` fallback stay scoped to `--working` alone**
  — `--input-required` has no animation and no reduced-motion entry: a dot blocked on the operator has no
  reason to animate ([#873](https://github.com/pyrycode/pyrycode-desktop/issues/873)).
- **Its colour bindings are this component's own**, deliberately not `.conn-dot--up` (`conversation.css:1425-1435`).
  That family reports whether a *machine* is reachable and is kept to one copy in the renderer on purpose;
  this dot reports what a *conversation* is doing. The class token shares no substring with `conn-dot`,
  `channel-list__row`, or `channel-list__host-dot` — checked in both directions (a new class joining an
  existing selector's match set, and a new class satisfying an existing substring assertion), since
  Playwright locators run in strict mode and 28 e2e specs ride an unfiltered `.channel-list__row-open`
  click (`launchPairedApp.ts:224`).

### Why the ring is `--color-primary`, not the Figma node's bound variable

The dot's stroke is not a literal hex — it binds the variable `Schemes/Inverse Primary`, which resolves to
`#32628d` on the file's dark-mode page, and [#1174](https://github.com/pyrycode/pyrycode-desktop/issues/1174)'s
code review pixel-sampled the redrawn Channel list frame (`103:2985`) to confirm that binding is universal:
all six of the frame's row instances carry the same `#32628d` ring, whatever their fill. This component
ships `--color-primary` (`#9dcbfc`) instead, and that's a deliberate reuse of an earlier, unrelated
rejection rather than a fresh call: [#719](../codebase/719.md) already measured `#32628d` against
`--color-surface` for the sidebar's relay-leg dot and found only **2.90:1** contrast — "a barely-visible dot
reads as no dot" — and rejected it there (see [its spec, § Rejected
alternatives](../../specs/architecture/719-relay-not-yet-known-state.md)). Shipping the node's bound value
here would repeat a contrast problem this codebase has already ruled out once, now for every row rather
than only the working ones.

The fills need no such substitution and are each an exact token match, read off the frame directly:
`--color-tertiary` (`#ffb59f`) is its `tertiary-fixed-dim` binding, `--color-success` (`#2fc038`) its
`Schemes/Success`. `--color-warning` (`#ffca45`), the amber `--input-required` ships, isn't a Figma-node
read at all — the frame has no input-required instance, so amber comes from the operator's design-notes
status table (2026-08-21) rather than from a node — see [conversation status §
precedence](conversation-status.md) for the table. It reads 12.3:1 against `--color-surface` and 8.1:1
against `--color-surface-container-highest`, well clear of the 2.90:1 that sank the Figma-bound ring value
above.

**The drawing fills only the open row's dot; the hovered row's reads unfilled.** #1174's code review
pixel-sampled both: the open row's dot samples `#32628d` (filled, matching the ring), the hovered row's
samples `#134a74` — the row's own hover fill showing through a dot with no fill of its own. The shipped
idle-fill rule covers both hover and open anyway, correctly — the ticket body rules the hover arm
explicitly (Juhana, 2026-09-06); it is not a second data point read off the frame, and citing the drawing
for that arm is the one thing code review asked this file's CSS comment to stop doing. Recorded here so a
future reader doesn't repeat it.

## Configuration and usage

- File: `src/renderer/src/screens/channels/ConversationStatusDot.tsx`. One export:
  `ConversationStatusDot({ status: ConversationStatus })`.
- Styles: appended block in `src/renderer/src/screens/channels/channels.css`.
- One consumer: [`ChannelList.tsx`'s `ConversationStatusDotControl`](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801)
  (#801), which resolves a row's status via [`resolveConversationStatus`](conversation-status.md) and
  passes the result straight in as the row's leading child.

## Edge cases and limitations

- **The idle dot is unfilled at rest but still announced, live.** `--idle` paints no *fill* (it wears the
  shared ring like every other status, and fills `--color-primary` conditionally since #1174 — see above),
  yet the element still carries `role="img" aria-label="Idle"`, so a sidebar of mostly-idle conversations
  announces "Idle" once per row. Built as the ticket's AC2 and its own Open Question 2 specify literally,
  and #801's code review confirmed it ships exactly that way (its Open Question 1 shipped open, not a
  regression). The cheap fix, if wanted, is `aria-hidden` on the idle branch here — a change to this
  component and its unit spec alone, never a conditional wrapper at the call site. Not filed as a follow-up
  yet.
- **The component ships no vertical positioning, correctly** — it's a leaf with no opinion on how its
  parent centers it, and #801 confirmed that stays the right call: centring happens entirely at the call
  site (`.channel-list__row > .conversation-status-dot { position: absolute; top: 50%; transform:
  translateY(-50%) }`), not here. But the *reasoning* this directory previously gave for that stance —
  "centring a 6px dot against the row's line box reproduces the Figma frame with no wrapper," established
  for `.channel-list__host-dot` — turned out not to hold for this node's own metadata: the `Status dot`
  instance sits measurably below the `Channel` row title's centre in the Figma frame (row-relative y=15 in
  a 24px frame centred at y=12), and #801 found that offset doesn't port onto the shipped row at all (which
  isn't the design's 24px frame — different padding, a larger title scale, a trailing time the design node
  lacks). #801 centres the dot on the row instead of reproducing that offset; see [Channel
  List](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801) for the measurement.
- **`.conversation-status-dot`'s `flex: 0 0 auto` (`channels.css:848`) is now inert.** It dates from before
  this component had a consumer, written for a flow-laid-out dot; #801's sole call site takes the dot out
  of flow with `position: absolute` instead, so the flex property never applies. Flagged by #801's code
  review as harmless but stale — left unedited (it's this component's own rule, out of #801's scope to
  touch), recorded here so the next reader doesn't infer a flow-layout consumer from it.
- **e2e coverage, since #1174.** Through #873 this stayed at zero: every colour and the reduced-motion
  fallback were CSS-level guarantees the node unit tier (`renderToStaticMarkup`, no DOM, no CSSOM) couldn't
  see, and none were driven. #1174 closed most of that gap, for a structural reason rather than
  coverage-mindedness: moving the ring onto a shared base rule means a dropped fill binding now renders a
  *correct-looking idle dot* rather than a visibly missing one — the one wrong reading available, and the
  renderer tier still can't reach it. `e2e/sidebar-status-dot-fills.spec.ts` probes each of the four
  statuses on a throwaway element appended to the live document and asserts the shared ring plus each
  status's own fill; `e2e/sidebar-row-geometry.spec.ts` (block 11b) proves the idle row-conditional fill on
  real rows — an idle dot fills only while hovered or open, read as a before/after on the same dot so the
  hovered read can only pass by observing the pointer's own effect. The reduced-motion fallback remains
  undriven: a `prefers-reduced-motion` clone of `e2e/composer-status-reduced-motion.spec.ts` for this
  component stays unfiled; file it separately if wanted.

## Related

- [Conversation status resolver](conversation-status.md) / [#799](https://github.com/pyrycode/pyrycode-desktop/issues/799)
  — the `ConversationStatus` type and `resolveConversationStatus` this component's prop is typed against;
  this ticket is that module's first consumer.
- [Channel List home screen](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801-874) — the
  screen this dot leads each row of, since #801; also the source of the `HostConnectionDots`
  labelled-dot shape this component's markup follows.
- [#719 codebase notes](../codebase/719.md) / [spec](../../specs/architecture/719-relay-not-yet-known-state.md)
  — the prior contrast rejection of the Figma node's own bound colour, reused here rather than re-measured.
- [Channel List § the open row's fill](channel-list-desktop-row-geometry.md) — the `:hover`/`:has()` row
  carriers [#1174](https://github.com/pyrycode/pyrycode-desktop/issues/1174)'s idle conditional fill is
  declared beside, in `channels.css`, rather than in this component's own block.
- [ADR 0009 — Modal prompt model](../decisions/0009-modal-prompt-model.md) — the store-side chain that made
  the fourth status, input required, buildable. The wire carries a
  `conversation_id` on `modal_shown` ([#870](../codebase/870.md), pyrycode#1065), and
  [#871](../codebase/871.md)/[#877](../codebase/877.md)/
  [#878](https://github.com/pyrycode/pyrycode-desktop/issues/878) have since carried it onto
  `DaemonEvent`, `ModalEvent`, and the held `ModalPrompt` in the [modal-prompt
  model](modal-prompt-model.md), which now exposes `selectHasOutstandingFor(conversationId): boolean`.
  [Conversation status](conversation-status.md)'s resolver consumes that boolean as of #873; this
  component only ever draws whatever `ConversationStatus` it's handed, so it never touches the selector
  directly — [#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) composed it at the
  `ChannelList.tsx` call site.
- Spec: `docs/specs/architecture/800-conversation-status-dot.md`,
  `docs/specs/architecture/873-input-required-status-and-dot.md`,
  `docs/specs/architecture/874-input-required-dot-call-site.md`,
  `docs/specs/architecture/1174-status-dot-fills.md`.
