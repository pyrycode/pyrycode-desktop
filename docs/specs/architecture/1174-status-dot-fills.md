# #1174 — the status dot takes the drawing's fills

A style retune of one component's paint, in one stylesheet. No new token, no new type, no new state, no
`.tsx`, no markup change. The short-plan shape (`§ A4`) rather than the full sections: the only part that
needed a decision is where the proof lives, which is why Testing strategy below is the long section.

## Files read

- `src/renderer/src/screens/channels/channels.css` → `.conversation-status-dot` and its three painted
  modifiers, `.channel-list__row > .conversation-status-dot` (the call site's positioning),
  `.channel-list__row:hover` and the `:has(> .channel-list__row-open[aria-current='true'])` open rule —
  the two carriers #1171 settled and the ones this ticket's conditional fill hangs off.
- `src/renderer/src/screens/channels/ConversationStatusDot.tsx` → `ConversationStatusDot` — emits
  `conversation-status-dot conversation-status-dot--${status}` on a bare `<span>`. Unchanged by this
  ticket; read to confirm the `--idle` modifier really does ship, since the conditional fill selects on it.
- `src/renderer/src/theme/tokens.css` → `--color-primary`, `--color-tertiary`, `--color-success`,
  `--color-warning` — all four already minted, which is why the ticket says "no new token".
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the `STATUS_DOT_*` constants — the markers
  AC2 pins as unchanged. They assert whole `class="…"` attribute runs, so any class-list edit would
  redden them; this ticket makes none.
- `e2e/sidebar-row-geometry.spec.ts` → `computed`, `computedAll`, `boxOf`, and its second `test()` block's
  FAB drive — the one shipped drive that puts an open row and a resting row on screen at once and hovers
  the resting one. The row-conditional half of AC1 rides it.
- `e2e/connection-dot-colours.spec.ts` → the throwaway-probe idiom for reading a computed colour back out
  of the shipped stylesheet. AC2 pins this file as unchanged; it is the model for the new one, not a host.
- `docs/knowledge/features/channel-list-status-dot.md` → records that #800/#801 shipped no e2e spec
  because their ACs were statically assertable, and that the `prefers-reduced-motion` clone was left
  explicitly out of scope. Both facts stop being true here: every clause of AC1 is a computed-style claim
  the `environment: 'node'` renderer tier cannot see.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2985 (Channel list; Chats
`106-3272`, the dot component `106:3051`)

Six 348×24 `Channel` rows stacked on a 4px pitch, each leading with the 6px dot at x=8. The dot reads as a
1px light-blue ring in every row; what varies is the disc inside it — empty on a resting idle row, filled
light blue on the two rows that carry a fill (hover `398:7266`, open `103:2972`), green on one row and
peach on another. `get_variable_defs` on the frame returns exactly the four bindings that matters:
`Schemes/Primary` #9dcbfc, `Schemes/Success` #2fc038, `tertiary-fixed-dim` #FFB59F, alongside the row
fills `Schemes/Primary Container` #134a74 and `Schemes/On Primary` #003355. Those three dot colours are
`--color-primary`, `--color-success` and `--color-tertiary` in `tokens.css` by value, unchanged.

## Change

`channels.css` only. The ring moves from the three painted modifiers up onto the base
`.conversation-status-dot` rule as `box-shadow: inset 0 0 0 1px var(--color-primary)`, so every state
including idle wears it and it is declared once. Each modifier then sets `background` alone —
`--color-tertiary` for `--working` (which keeps its `animation` line verbatim), `--color-success` for
`--new-messages`, `--color-warning` for `--input-required`. `--idle` still declares nothing of its own;
its fill is conditional and lands as one new rule beside the row's two fill carriers,
`.channel-list__row:hover > .conversation-status-dot--idle` and
`.channel-list__row:has(> .channel-list__row-open[aria-current='true']) > .conversation-status-dot--idle`,
setting `background: var(--color-primary)`.

Nothing else moves. `box-shadow` and `background` both have zero layout effect, so the 6px box, the dot's
absolute `left: var(--space-2)` and the title's x are untouched in every state (AC2) — the inset-shadow
ruling the base rule's comment already carries is what makes that true without a `box-sizing` reset. The
`@keyframes` and the `prefers-reduced-motion` guard are unedited; the blink animates `opacity`, so it now
fades ring and fill together, which is what "keeping the shipped blink" means.

The conditional rule is scoped to `--idle` rather than declared on the base under the same carriers, and
that is load-bearing: an unscoped `.channel-list__row:hover > .conversation-status-dot` would be (0,3,0)
against each painted modifier's (0,1,0) and would repaint a hovered working row's dot primary. Scoped, the
two selectors are mutually exclusive by class and never compete at all.

It is declared in the row region beside `.channel-list__row:hover` and the `:has()` rule, not down in the
dot's own block, following the file's existing split — the dot's positioning already lives at the call
site for the same reason. A future edit to either carrier then sees this rule adjacent rather than 700
lines away. A pointer from the dot's block records where it went.

## Testing strategy

Nothing new in vitest. The markup is byte-identical before and after, so there is no new renderer
assertion to write and `ChannelList.test.tsx`'s `STATUS_DOT_*` markers plus
`ConversationStatusDot.test.tsx` stand unchanged as AC2's regression guard. Every clause of AC1 is a
computed-style claim, and the renderer tier has no stylesheet, no cascade and no `getComputedStyle`.

The proof splits across two e2e homes along the line each file's header already draws, and the split is
the plan's one real decision:

- **`e2e/sidebar-status-dot-fills.spec.ts`, new** — the four per-state bindings, on throwaway probe
  elements appended to the live document, the `connection-dot-colours.spec.ts` idiom (that file is AC2's
  untouched sibling and the model here, never a host: its header scopes it to the *connection* dot, the
  family this one is deliberately kept disjoint from). One probe per status reads back `box-shadow` and
  `background-color`. The claims: all five states carry the same primary ring; the three painted
  modifiers are each non-transparent and mutually distinct; idle alone is transparent. Probes rather than
  driven state because reaching `working` / `new-messages` / `input-required` on real rows needs four
  stores seeded through the relay, and what is under test is the stylesheet.
- **`e2e/sidebar-row-geometry.spec.ts`, extended in place** — the row-conditional clause, on real rows.
  Its second block already mints a second conversation through the FAB, leaving an open row and a resting
  row on screen, and already hovers the resting one; both are idle. Three reads slot into that existing
  drive with no new launch: the open row's dot is filled primary, the resting row's dot is transparent,
  and it fills primary under the pointer. A dot-class count guards the reads against a row that silently
  resolved to some other status, which would make all three vacuous.

The blink and its reduced-motion fallback stay where #800 left them — asserted at the CSS level, not
driven. This ticket does not touch the `animation` line or the media query, so the clone of
`e2e/composer-status-reduced-motion.spec.ts` that `channels.css` has handed forward since #800 is still
out of scope and still unfiled.

## Open questions

- Whether Chromium's computed `box-shadow` serialisation puts `inset` last (`rgb(…) 0px 0px 0px 1px
  inset`). Resolved by running the spec rather than by guessing; if the shape differs, the constant in the
  new spec changes and nothing else does.
- Whether both rows in the geometry spec's second block really resolve to `idle` at the moment the new
  reads run. Expected — the seed is opened at launch and so read, and a FAB-minted row has no messages —
  but the dot-class count precondition above turns a wrong expectation into an honest failure instead of
  a vacuous pass.
