# #1103 — the expanded tool row's fields and result take the design's treatment

Draws what is *inside* the box #1102 moved outward: the field value's own box, the result as bare text,
and the body's two rhythms. Stylesheet-only in production; both test tiers gain assertions.

## Files read

Codegraph was unavailable — every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized", a hard error rather than an empty result, so this list was built with Grep and Read.

- `src/renderer/src/screens/conversation/conversation.css` → the joined `.tool-row__result,
  .tool-row__input-value` rule, `.tool-row__body`, `.tool-row__body--error .tool-row__result`,
  `.tool-row__input`, `.tool-row__input-name`, `.tool-row__empty` — the whole edit surface.
- Same file → `.code-block` and `.code-block__body` — the precedent the design says the value box must
  read alike with: `--space-3`/`--space-4` padding, `--text-body-small-size` /
  `--text-code-body-line`, and the full four-token type run.
- Same file → `.bubble`'s comment, which enumerates `--space-bubble-x`'s consumers and goes false here.
- Same file → `.unrecognized-row__raw`, the house treatment the shared rule was copied from, and the one
  consumer of `--space-bubble-x` that survives this slice.
- Same file → `.tool-row`, `.tool-row--error`, `.tool-row--expanded` — #1102's box, its retint and its
  4px gap, none of which move here.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ToolRow` — the body's markup: the
  `.code-block` head, the wrapper-less `listedInputFields(...).map(...)`, the `tool-row__empty` /
  `tool-row__result` fork, and the comment recording why the list has no wrapper and no `.length > 0`
  guard.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the three
  `not.toContain('tool-row__input')` empty-map assertions, and the two `tool-row__body--error`
  substring pins that make removing the modifier class churn rather than cleanup.
- `e2e/tool-row-toggle.spec.ts` → `boxOf`, `boxesOf`, `routedToolUseFrame`, `routedToolResultFrame`,
  `failedToolResultFrame`, `WIDTH_TOLERANCE_PX`, and #1102's geometry test with its
  `.tool-row__body > *` binding and its per-class full-width loop.
- `src/renderer/src/theme/tokens.css` → `--text-code-body-line` (20px) and its comment on why 12/20 is
  not assembled from a scale step, `--space-3`/`--space-4`, `--radius-xs`,
  `--color-surface-container-high` (`#272a2f`), `--color-on-surface` (`#e0e2e8`), `--space-bubble-x`.
- `docs/knowledge/features/conversation-shell-tool-row-layout.md` § "Tool row box moves outward
  (#1102)" — names this ticket as the owner of the body's 12px gap and the result's fill and type, and
  records that the body's outer insets are already on screen and not to be re-applied.
- Same overview § "Shell command code block (#780)" and § "Full-width bordered tool row (#722)" — why
  the command block shares `.code-block`'s classes, and why the expanded body was left undrawn until now.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=152-5215

The opened row's `Body` is a full-width column with a 12px gap: a `Fields` column (8px gap) of
name-over-value pairs, then the result. Each value sits in a `#272a2f` box with 12/16 padding and a 6px
corner, holding mono 12/20; the field name above it is mono 12/16 in the muted variant ink, and the
result below is the same mono 12/20 as the value — on the background ink, with no fill and no box of
its own. The screenshot shows the consequence the ACs are about: the values read as two filled blocks
and the result as loose text beneath them, rather than as three identical grey boxes.

## Context

The expanded body has never been drawn from a design. `.tool-row__result`'s own comment says so, and
#706 joined `.tool-row__input-value` to it so the field list would take the result block's visual
language rather than invent a third. `Tool row` `155:553` now draws the body, and it gives the two
halves *different* treatments — so the joined rule has to split, and that split is the ticket.

#1102 (merged, `bd6b5d0`) already moved the box treatment out to `.tool-row` and gave `.tool-row__body`
its outer insets, so every block in the body already fills the row's content width. This slice draws
what is inside.

No ADR is warranted: this is a restyle inside one region of one stylesheet, with no new contract.

## Design

### 1. The shared rule splits along exactly one seam: the box

The design's value box **is** the result's treatment plus a fill, a padding and a corner. Nothing else
differs — both are mono 12/20 in `--color-on-surface`, both keep the shape-preserving pair and the cap.
So the joined selector is *kept*, carrying everything still common in substance, and shrinks by the
three declarations that are now the value's alone:

```
.tool-row__result,
.tool-row__input-value   margin, max-height: 240px, overflow: auto, white-space: pre,
                         --font-mono, --text-body-small-size, --text-code-body-line,
                         --text-body-small-tracking, --text-body-small-weight, --color-on-surface

.tool-row__input-value   + padding: --space-3 --space-4
                         + background: --color-surface-container-high
                         + border-radius: --radius-xs
```

Keeping the join rather than writing two independent rules preserves #706's argument in the half where
it still holds — "the field value takes the result block's visual language" stays true by construction
for nine declarations instead of becoming a claim two rule bodies could drift out of — while stating the
divergence once, additively, in the smallest rule that can express it. It also makes the design's own
relationship legible in the CSS: the value box is the result block, boxed.

**Three token decisions, each stated on the rule rather than inherited:**

- **Leading 16 → 20** via `--text-code-body-line`, the token #721 minted for the fenced code body. Not a
  bare `20px` and not a second name for the same value; `tokens.css` already writes out why 12/20 is not
  a scale step.
- **The full four-token type run, not today's two.** The ticket leaves this open; the answer is the
  quartet. `.code-block__body` states four, and `.tool-row__input-name` — the run stacked directly above
  the value, inside the same field — states four. Today's two-token rule leaves the value and the result
  at the UA's `letter-spacing: normal` while both their mono neighbours draw at body-small's 0.4px,
  which is a difference nobody chose. Whether mono should carry a sans tracking at all is a live design
  question `.code-block__body`'s comment already parks; this slice puts the three mono runs of an opened
  row on one answer rather than on two.
- **`--color-on-surface`, deliberately.** Schemes/On Background prints `#e0e2e8`, which is
  `--color-on-surface` exactly; M3 gives background and surface one value here. The result already
  carries this token, so nothing changes on screen — what changes is that the rule says the mapping was
  read rather than inherited. `.code-block`'s header comment already records the same equivalence.
- **`--space-4` (16), not `--space-bubble-x` (14)**, for the value box's horizontal padding — the design
  value, and the one `.code-block__body` already pairs with `--space-3` on the block axis.

### 2. The error rule goes; the class stays

`.tool-row__body--error .tool-row__result` draws a 1px `--color-error` border around the result. Under
"no fill and no box" that becomes a red rectangle around bare text. Since #1102 the failure device is
`.tool-row--error`'s retint of the row's own border, so deleting the rule removes a device rather than
the last one. `ToolRow` keeps emitting `tool-row__body--error` — it is the body's own failure hook and
two `ConversationScreen.test.tsx` substring assertions pin it, so removing it is churn with no visual
gain. The rule's grave says the accent lives outward now.

### 3. The two rhythms, without a wrapper

`Fields` is a layout grouping in an auto-layout tool, and AC3 asks for two distances rather than for an
element. The distances are:

| pair | distance |
|---|---|
| command block → field, field → result, command block → result | 12px |
| field → field | 8px |

Expressed as the body's gap plus one adjacent-sibling correction:

```
.tool-row__body                          gap: var(--space-2) → var(--space-3)
.tool-row__input + .tool-row__input      margin-top: calc(var(--space-2) - var(--space-3))
```

−4px against a 12px gap is 8px, and it applies to exactly the one pair the design draws tighter. Flex
items never margin-collapse, and `+` cannot match a first child, so the first field is untouched in
every ordering.

**Why not the wrapper.** `ToolRow` renders the list as a bare `.map()` with no wrapper and no
`.length > 0` guard *on purpose*, and its comment says why: an empty array renders literally nothing, so
"an absent, empty or fully carved-out map draws no field list AND no empty container" is structural
rather than a second condition that could drift. A `.tool-row__fields` wrapper turns that back into a
guarded fact, adds a TSX change with test churn, and changes what #1102's `.tool-row__body > *` binding
matches. The CSS form buys the same two distances and keeps the invariant — and it is the same idiom one
level down: `.tool-row__input`'s `--space-1` gap is already documented as "tighter than the body's own
gap … the grouping the list gets without a wrapper element". This slice states the outer half of the
same grouping the same way.

The trade is that a reader must compose two rules to get 8px. The correction rule's comment carries the
arithmetic and names the design frame it stands for.

### 4. One stranded comment, corrected in the same edit

`.bubble`'s comment enumerates `--space-bubble-x`'s consumers as "`.tool-row__result` /
`.tool-row__input-value` and `.unrecognized-row__raw`". After this slice the result has no padding and
the value box takes `--space-4`, leaving `.unrecognized-row__raw` alone. The sentence is corrected, not
deleted — its point (don't retune the token, it restyles rows this ticket isn't touching) survives with
one consumer just as well as with two.

`.tool-row__result`'s own comment cites `.unrecognized-row__raw` by two line numbers that are stale by
~1860 lines. The comment is being rewritten anyway; the citations become symbol names, per the repo's
citation rule.

## State + concurrency model

None. No store slice, no async task, no subscription, no IPC. The change is CSS plus test assertions;
`ToolRow` is a pure render of an already-reduced `ThreadItem`.

## Error handling

No new failure mode. The one error *path* touched is presentational: a failed tool's body loses the
result's own border and keeps the row-level retint (AC4). `tool-row__body--error` still lands on the
body element, so any future body-scoped failure treatment has its hook.

## Testing strategy

**e2e (`e2e/tool-row-toggle.spec.ts`) — the home.** Fills, paddings, corners, type, gaps and the
*absence* of a fill are computed values, and this repo's renderer tier is `renderToStaticMarkup` with no
DOM. A sixth sibling `test(...)` with its own `launchPairedApp` (the reason the five before it record:
extra rows would make their bare `.tool-row` locators strict-mode-ambiguous), driving two rows — a plain
call carrying **two** input fields, and a failed shell call. Scenarios:

- AC1 — the value box's computed fill, its four paddings, its corner, its size and its leading, each
  compared against the token read off the row rather than against a literal.
- AC2 — the result's fill is the transparent initial value, its corner is 0, all four paddings are 0,
  its ink is `--color-on-surface`, and its size/leading match the value box's.
- AC3 — the two gaps, measured between adjacent bounding boxes: 12px from the last field to the result,
  8px between the two consecutive fields.
- AC4 — the failed row's result has zero computed border width on all four sides, while the row's own
  border colour still differs from the successful row's (comparative, so a token retune can't redden it).
- AC5 — the cap and the pair survive (`max-height` 240px, `overflow` auto, `white-space` pre), and the
  shell row's `.code-block__body` still draws today's padding and `pre-wrap`.

Each assertion is checked against the outgoing rules as a control, so the test is shown red before it is
shown green.

**Unit (`ConversationScreen.test.tsx`) — AC3's structural half.** The three shipped assertions that
police the empty-field-map case are `not.toContain('tool-row__input')` substring checks, which a wrapper
named anything else slips past. A new `it(...)` pins the body's whole subtree byte-exactly for an empty
input map — `<div class="tool-row__body"><pre class="tool-row__result">…</pre></div>` — which reddens if
*any* element is introduced, whatever it is named. That is the assertion AC3 asks for, in the form that
does not depend on guessing the name of an element the design decision declined to add.

No other unit change: this slice adds no element, class or attribute, so nothing else in that tier moves.

**Re-derived rather than left to luck:** #1102's geometry test binds `blocks = plainRow.locator(
'.tool-row__body > *')` and names `.tool-row__input`, `.tool-row__input-value` and `.tool-row__result`
in its full-width loop. With no wrapper introduced, `> *` matches exactly the same elements it did
before and every assertion still means what its comment claims. The result losing 24px of vertical
padding changes the *height* of the last block, which those assertions read from the live box rather
than assume. Both were re-checked against the new rules; neither needs an edit.

## Open questions

1. **Quartet or two type tokens on the split rule?** Resolved in Design §1: the quartet.
2. **Wrapper element or CSS-only for the two rhythms?** Resolved in Design §3: CSS-only.
3. Whether mono runs should carry a sans tracking at all is a standing design question
   (`.code-block__body`'s comment). Out of scope; this slice only stops the three mono runs of one row
   from answering it two different ways.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The two strings this slice restyles are daemon-controlled — a
  field value from `listedInputFields`, and `resultSummary` — and both already cross into the renderer
  through the decode → IPC → reducer chain and render as auto-escaped React text children of a `<pre>`.
  This slice adds no element, class, attribute or prop, so the sink set is byte-identical: no `title`,
  no `data-*`, no `dangerouslySetInnerHTML`, nothing routed through `AssistantMarkdown`. `ToolRow`'s
  SAFETY block continues to govern unchanged, and a CSS-only change cannot widen it.
- **[Network & I/O — layout DoS, the load-bearing one]** No findings, but the property is *load-bearing
  and easy to drop while splitting the rule*. `max-height: 240px` + `overflow: auto` bound both a 64KB
  `result_summary` and a 4000-rune input value. The design's split moves `padding`, `background` and
  `border-radius` off the joined selector — the cap, the overflow and `white-space: pre` stay on it, so
  **both** classes keep them. Implementation check: after the split,
  `.tool-row__input-value` must still resolve `max-height`/`overflow`; dropping them from the value while
  keeping them on the result would leave a hostile input value uncapped. AC5's e2e assertions cover the
  result; the value box's own cap is asserted in the same test.
- **[Network & I/O — the cap gets tighter, not looser]** No finding. `max-height` resolves against the
  content box (no global `box-sizing`), so the result's drawn height goes from 240 + 24px of padding to
  240. The bound is strengthened by the loss of padding, not weakened.
- **[Network & I/O — unbounded field count]** OUT OF SCOPE, pre-existing, worsened by a constant factor.
  `listedInputFields` is `Object.entries(input ?? {})` with no cap, so a hostile daemon can send an
  arbitrary number of fields; each is individually capped at 240px but the body is not. This slice makes
  each field ~28px taller (24px of new padding, 4px of extra leading), so it scales an existing vector
  rather than introducing one. Not fixed here, per scope discipline: the design draws no body-level cap,
  adding one is a visual-fidelity decision of its own, and the existing mitigation holds either way —
  `.conversation__thread` is its own scroll region (`flex: 1 1 auto; min-height: 0; overflow-y: auto`)
  with `.composer` as its sibling, so no body height can push the composer off screen. Whoever picks up
  a field-count bound owns it; there is no ticket for it today.
- **[Network & I/O — horizontal containment]** No finding. The result keeps `white-space: pre` +
  `overflow: auto`, so a single 16000-character line scrolls inside its own box; `.tool-row`'s
  `overflow: hidden` (#1102) is the second clip behind it. Removing the result's padding changes neither.
- **[Concurrency]** Not applicable by construction — no async task, no subscription, no timer, no store
  slice. `ToolRow` is a pure render of an already-reduced `ThreadItem`.
- **[Electron attack surface]** Not applicable — no IPC channel, no `contextBridge` API, no
  `webPreferences`, no protocol handler, no navigation. Nothing crosses the main/renderer boundary.
- **[Tokens, secrets, credentials] / [File & storage] / [Cryptographic primitives]** Not applicable —
  this slice touches one stylesheet region and two test files; it reads and writes no secret, no path
  and no key material.
- **[Error messages, logs, telemetry]** No findings. No log call is added, and a stylesheet cannot emit
  one. The standing rule that daemon text never reaches a log (ADR 0007, `CLAUDE.md`) is untouched — the
  result text stays rendered-only.
- **[Threat model — hostile daemon]** Addressed: an oversized or crafted result or input value is bounded
  by the retained cap and scroll, and escaped by React. **[Malicious relay]** unchanged — content-blind
  and off this path. **[Renderer compromise]** unchanged — no key, socket or token is reachable from
  here.
- **[Implementer-error check on the negative margin]** No finding. `calc(var(--space-2) - var(--space-3))`
  is −4px against a 12px gap, so the corrected distance is 8px and strictly positive. It is smaller in
  magnitude than the gap it corrects, so no retune of either token can make two fields overlap: a
  retune that inverts the two values spreads the fields instead. It applies to at most one pair at a
  time and can never match a first child.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
