# Conversation status dot

The presentational leaf of a sidebar row: `ConversationStatusDot({ status })` takes one already-resolved
[`ConversationStatus`](conversation-status.md) and draws it as a single dot. It reads no store, resolves
nothing — [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801) wires it into
[`ChannelList`](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801)'s rows, its only consumer.

Introduced in [#800](https://github.com/pyrycode/pyrycode-desktop/issues/800), split from #676.
Renderer-only, no store, no transport — not security-sensitive.

## What it does

Renders exactly one `<span role="img" aria-label="…">`, no wrapper, no child, no text node, with class
`conversation-status-dot conversation-status-dot--{status}`:

| status | paint | label |
| --- | --- | --- |
| `idle` | none — a present, unpainted 6×6 box | "Idle" |
| `new-messages` | green ring (`--color-success`) | "New messages" |
| `working` | blue ring (`--color-primary`) + a slow fading blink, stilled to a steady ring under `prefers-reduced-motion: reduce` | "Assistant working" |

All three states share the same 6×6 footprint, so a row's title never shifts horizontally when its status
changes. The labels are client-owned constants in the app's own voice — the component's only input is one
of three closed-union literals, so no daemon text can reach it.

## How it works

New file beside `ChannelList.tsx` (its only planned consumer), styled by an appended block in
`channels.css` rather than a stylesheet import of its own — `ChannelList.tsx` is this directory's single
`import './channels.css'`, and both dialog siblings (`RenameConversationDialog`, `SaveAsChannelDialog`)
already decline a second one.

- **The label map is a `Record<ConversationStatus, string>`, not a `switch`.** It is exhaustive by type, so
  [#802](https://github.com/pyrycode/pyrycode-desktop/issues/802)'s reserved fourth status (input required)
  becomes a `npm run typecheck` failure here rather than a silently unlabelled dot — a `switch` with a
  `default:` arm would swallow it. Module-private; the unit spec asserts the shipped literal strings
  instead of importing the map.
- **Idle carries an explicit `--idle` modifier**, not the base class alone, so a dropped modifier fails a
  test instead of quietly rendering as a correct-looking idle dot.
- **`role="img"` is load-bearing, not decorative.** On a bare `<span>` the accessible-name computation
  drops `aria-label` outright — the dot would ship nameless. Not `role="status"`: that is a live region,
  and #801 renders one of these per row. This is the same shape `HostConnectionDots`
  (`ChannelList.tsx:310-350`) already uses for the sidebar's connection dots.
- **The ring is `box-shadow: inset 0 0 0 1px <token>`, never `border`.** This repo has no global
  `box-sizing` reset (`conversation.css:750`), so a 1px border would grow the 6px box to 8px and shift the
  row title by 2px in exactly the two painted states — an inset shadow has zero layout effect by
  construction, so the shared-footprint guarantee doesn't depend on a `box-sizing` declaration a later edit
  could drop. `background` stays unset in every state; the design's circle is unfilled, a **ring**, which is
  what separates this family from the filled `.channel-list__host-dot` / `.conn-dot` dots six pixels above
  it in the same sidebar.
- **`idle` has no CSS rule at all — the missing rule is the design.** The class still ships on the element
  so a dropped modifier fails a unit test rather than rendering as idle by coincidence.
- **The blink fades to a floor (`opacity: 0.3` at 50%), never to zero,** and uses `ease-in-out` rather than
  `.bubble__cursor`'s `step-end` (`conversation.css:727-741`, the in-tree precedent this follows for the
  animation/`@keyframes`/reduced-motion three-part shape). A caret that vanishes still reads as a caret; a
  status dot that vanishes reads as idle, the one wrong reading available. The 2s duration and the 0.3
  floor are client-owned constants — the Figma node is a static vector with no motion spec, so there was
  nothing to port.
- **Its colour bindings are this component's own**, deliberately not `.conn-dot--up` (`conversation.css:1425-1435`).
  That family reports whether a *machine* is reachable and is kept to one copy in the renderer on purpose;
  this dot reports what a *conversation* is doing. The class token shares no substring with `conn-dot`,
  `channel-list__row`, or `channel-list__host-dot` — checked in both directions (a new class joining an
  existing selector's match set, and a new class satisfying an existing substring assertion), since
  Playwright locators run in strict mode and 28 e2e specs ride an unfiltered `.channel-list__row-open`
  click (`launchPairedApp.ts:224`).

### Why the working ring is `--color-primary`, not the Figma node's bound variable

Node `106:3051`'s stroke is not a literal hex — it binds the variable `Schemes/Inverse Primary`, which
resolves to `#32628d` on the file's dark-mode page. This component ships `--color-primary` (`#9dcbfc`)
instead, and that's a deliberate reuse of an earlier, unrelated rejection rather than a fresh call:
[#719](../codebase/719.md) already measured `#32628d` against `--color-surface` for the sidebar's
relay-leg dot and found only **2.90:1** contrast — "a barely-visible dot reads as no dot" — and rejected it
there (see [its spec, § Rejected alternatives](../../specs/architecture/719-relay-not-yet-known-state.md)).
Shipping the node's bound value here would repeat a contrast problem this codebase has already ruled out
once. `--color-success` needs no such substitution: `#2fc038` is the Figma's `Schemes/Success` exactly.

## Configuration and usage

- File: `src/renderer/src/screens/channels/ConversationStatusDot.tsx`. One export:
  `ConversationStatusDot({ status: ConversationStatus })`.
- Styles: appended block in `src/renderer/src/screens/channels/channels.css`.
- One consumer: [`ChannelList.tsx`'s `ConversationStatusDotControl`](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801)
  (#801), which resolves a row's status via [`resolveConversationStatus`](conversation-status.md) and
  passes the result straight in as the row's leading child.

## Edge cases and limitations

- **The idle dot is invisible but still announced, live.** `--idle` paints nothing, yet the element still
  carries `role="img" aria-label="Idle"`, so a sidebar of mostly-idle conversations announces "Idle" once
  per row. Built as the ticket's AC2 and its own Open Question 2 specify literally, and #801's code review
  confirmed it ships exactly that way (its Open Question 1 shipped open, not a regression). The cheap fix,
  if wanted, is `aria-hidden` on the idle branch here — a change to this component and its unit spec alone,
  never a conditional wrapper at the call site. Not filed as a follow-up yet.
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
  List](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801) for the measurement.
- **`.conversation-status-dot`'s `flex: 0 0 auto` (`channels.css:848`) is now inert.** It dates from before
  this component had a consumer, written for a flow-laid-out dot; #801's sole call site takes the dot out
  of flow with `position: absolute` instead, so the flex property never applies. Flagged by #801's code
  review as harmless but stale — left unedited (it's this component's own rule, out of #801's scope to
  touch), recorded here so the next reader doesn't infer a flow-layout consumer from it.
- **e2e coverage stays at zero.** The reduced-motion fallback and the three colours are CSS-level
  guarantees the node unit tier (`renderToStaticMarkup`, no DOM, no CSSOM) cannot see. #801 wired the only
  consumer but added no e2e spec — all four of its ACs are statically assertable with seeded stores in the
  unit tier — so a `prefers-reduced-motion` clone of `e2e/composer-status-reduced-motion.spec.ts` for this
  component specifically remains unbuilt; file it separately if wanted.

## Related

- [Conversation status resolver](conversation-status.md) / [#799](https://github.com/pyrycode/pyrycode-desktop/issues/799)
  — the `ConversationStatus` type and `resolveConversationStatus` this component's prop is typed against;
  this ticket is that module's first consumer.
- [Channel List home screen](channel-list.md#the-row-s-status-dot-channellist-tsx-added-by-801) — the
  screen this dot leads each row of, since #801; also the source of the `HostConnectionDots`
  labelled-dot shape this component's markup follows.
- [#719 codebase notes](../codebase/719.md) / [spec](../../specs/architecture/719-relay-not-yet-known-state.md)
  — the prior contrast rejection of the Figma node's own bound colour, reused here rather than re-measured.
- [ADR 0009 — Modal prompt model](../decisions/0009-modal-prompt-model.md) — why the fourth status, input
  required, stays unbuilt: no `conversation_id` rides a modal frame yet.
- Spec: `docs/specs/architecture/800-conversation-status-dot.md`.
