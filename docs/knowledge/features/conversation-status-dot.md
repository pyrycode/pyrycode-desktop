# Conversation status dot

The presentational leaf of a sidebar row: `ConversationStatusDot({ status })` takes one already-resolved
[`ConversationStatus`](conversation-status.md) and draws it as a single dot. It reads no store, resolves
nothing — [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801) wires it into
[`ChannelList`](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801-874)'s rows, its only
consumer.

Introduced in [#800](https://github.com/pyrycode/pyrycode-desktop/issues/800), split from #676.
Renderer-only, no store, no transport — not security-sensitive.
[#873](https://github.com/pyrycode/pyrycode-desktop/issues/873) added the fourth state, `input-required`,
landing correct-but-unreachable until
[#874](https://github.com/pyrycode/pyrycode-desktop/issues/874) wired the call site — all four states are
now reachable in production.
The current paint follows [#1735](https://github.com/pyrycode/pyrycode-desktop/issues/1735)'s redraw:
only idle has a ring; the three other states are solid discs. This replaces #1174's shared ring and
conditional idle hover/open fill.

## What it does

Renders exactly one `<span role="img" aria-label="…">`, no wrapper, no child, no text node, with class
`conversation-status-dot conversation-status-dot--{status}`:

| status | paint | label |
| --- | --- | --- |
| `input-required` | Solid gold `--color-status-dot-input-required` (`#d8b85a`), no ring or blink | "Input required" |
| `working` | Solid blue `--color-primary` (`#9dcbfc`), no ring; slow fading blink, steady under `prefers-reduced-motion: reduce` | "Assistant working" |
| `new-messages` | Solid green `--color-success` (`#2fc038`), no ring or blink | "New messages" |
| `idle` | Unfilled 1px `--color-primary` ring at opacity 0.5, including on hovered/open rows; no blink | "Idle" |

All four states share the same 6×6 footprint, so a
row's title never shifts horizontally when its status changes. The labels are client-owned constants in
the app's own voice — the component's only input is one of four closed-union literals, so no daemon text
can reach it.

## How it works

The file lives beside `ChannelList.tsx` (its only consumer), styled by a block in
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
  and the sidebar renders one of these per row.
- **Only `--idle` owns the ring**, `box-shadow: inset 0 0 0 1px var(--color-primary)`, with `opacity: 0.5`.
  The base class supplies size and roundness alone. A 1px `border` would grow the 6px box to 8px without
  a `box-sizing` reset and shift the title; an inset shadow has zero layout effect. Keeping the shadow
  off the base prevents a primary rim from contaminating the three solid state colours.
- **Idle has no background, including on hovered/open rows.** The row's own fill shows through its
  transparent centre. The old row-level idle background selectors are removed; restoring them would
  make the same idle state change meaning with pointer position or selection.
- **The waiting gold has its own token in `theme/tokens.css`.** `--color-status-dot-input-required`
  is `#d8b85a`, while `--color-warning` stays `#ffca45` for connection state. Changing the shared warning
  token to match this dot would also recolour the connection indicator. Conversation state and machine
  reachability keep separate colour bindings.
- **The blink fades to a floor (`opacity: 0.3` at 50%), never to zero,** and uses `ease-in-out` rather than
  `.bubble__cursor`'s `step-end` (the in-tree precedent this follows for the
  animation/`@keyframes`/reduced-motion three-part shape). A caret that vanishes still reads as a caret; a
  status dot that vanishes reads as idle, the one wrong reading available. The 2s duration and the 0.3
  floor are client-owned constants — the Figma node is a static vector with no motion spec, so there was
  nothing to port. **The blink and its `prefers-reduced-motion` fallback stay scoped to `--working` alone**
  — `--input-required` has no animation and no reduced-motion entry: a dot blocked on the operator has no
  reason to animate ([#873](https://github.com/pyrycode/pyrycode-desktop/issues/873)).
- **Its colour bindings are this component's own**, deliberately not `.conn-dot--up`.
  That family reports whether a *machine* is reachable and is kept to one copy in the renderer on purpose;
  this dot reports what a *conversation* is doing. The class token shares no substring with `conn-dot`,
  `channel-list__row`, or `channel-list__host-dot` — checked in both directions (a new class joining an
  existing selector's match set, and a new class satisfying an existing substring assertion), since
  Playwright locators run in strict mode and 28 e2e specs ride an unfiltered `.channel-list__row-open`
  click (`launchPairedApp.ts:224`).

### Design source

The current [Figma dot variants, node 106:3077](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=106-3077),
in use in sidebar node 103:2985, show the four 6px paints in the table above. The success fill binds
`Schemes/Success`; the redraw specifies primary `#9dcbfc` and mobile-matching gold `#d8b85a`.
The earlier frame comparison and inverse-primary contrast rationale describe superseded paint, so
they must not be used to restore the shared ring, tertiary working fill or idle hover/open fill.

## Configuration and usage

- File: `src/renderer/src/screens/channels/ConversationStatusDot.tsx`. One export:
  `ConversationStatusDot({ status: ConversationStatus })`.
- Styles: appended block in `src/renderer/src/screens/channels/channels.css`.
- One consumer: [`ChannelList.tsx`'s `ConversationStatusDotControl`](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801)
  (#801), which resolves a row's status via [`resolveConversationStatus`](conversation-status.md) and
  passes the result straight in as the row's leading child.

## Edge cases and limitations

- **The idle dot is unfilled but still announced, live.** `--idle` paints only a half-opacity ring,
  yet the element still carries `role="img" aria-label="Idle"`, so a sidebar of mostly-idle conversations
  announces "Idle" once per row. Built as the ticket's AC2 and its own Open Question 2 specify literally,
  and #801's code review confirmed it ships exactly that way (its Open Question 1 shipped open, not a
  regression). The cheap fix, if wanted, is `aria-hidden` on the idle branch here — a change to this
  component and its unit spec alone, never a conditional wrapper at the call site. Not filed as a follow-up
  yet.
- **The component ships no vertical positioning, correctly** — it's a leaf with no opinion on how its
  parent centers it: centring happens entirely at the call
  site (`.channel-list__row > .conversation-status-dot { position: absolute; top: 50%; transform:
  translateY(-50%) }`). [The row's geometry](channel-list-status-dot.md) settled the Figma's apparent
  3px drop in #1097: it comes from a 14px-tall wrapper around the design's painted circle. The app draws
  a bare 6px circle, so copying that offset would copy wrapper padding without the wrapper.
- **`.conversation-status-dot`'s `flex: 0 0 auto` is inert.** It dates from before
  this component had a consumer, written for a flow-laid-out dot; #801's sole call site takes the dot out
  of flow with `position: absolute` instead, so the flex property never applies. Flagged by #801's code
  review as harmless but stale — left unedited (it's this component's own rule, out of #801's scope to
  touch), recorded here so the next reader doesn't infer a flow-layout consumer from it.
- **Browser paint tests complement static renderer tests.** `renderToStaticMarkup` proves class tokens
  and labels, but cannot observe CSS paint, animation or media queries. A correct modifier can still
  render the wrong state if its CSS binding disappears. `e2e/sidebar-status-dot-fills.spec.ts` probes
  all four modifiers on an element in the live styled document: exact fills, idle-only ring, idle
  opacity 0.5, 6px geometry, and a 2s infinite animation on working alone. It emulates reduced motion
  and verifies that working becomes a steady blue disc, and checks that `--color-warning` remains amber.
  The probe cannot exercise row selectors; `e2e/sidebar-row-geometry.spec.ts` (block 11b) separately
  checks both real idle dots stay transparent half-opacity rings on resting, open and hovered rows.

## Related

- [Conversation status resolver](conversation-status.md) / [#799](https://github.com/pyrycode/pyrycode-desktop/issues/799)
  — the `ConversationStatus` type and `resolveConversationStatus` this component's prop is typed against;
  this ticket is that module's first consumer.
- [Channel List home screen](channel-list-status-dot.md#the-row-s-status-dot-channellist-tsx-added-by-801-874) — the
  screen this dot leads each row of, since #801.
- [Channel List § the open row's fill](channel-list-row-open-fill.md) — row selection paints the wrapper;
  the idle dot stays unfilled over it.
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
  `docs/specs/architecture/1174-status-dot-fills.md`,
  [current redraw](../../specs/architecture/1735-sidebar-status-dot-redraw.md).
