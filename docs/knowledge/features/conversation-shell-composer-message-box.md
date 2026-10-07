# Conversation shell — composer message box and footer row

The message box itself and the footer row beneath it — the two composer surfaces below the status row. Split from [Composer](conversation-shell-composer.md) 2026-09-05, once #1056's message-box growth would have pushed the combined document over the size cap.

Part of [Composer](conversation-shell-composer.md); see that document for the status row and error slot, and [Conversation shell](conversation-shell.md) for the screen overall.

## Message box (#951)

The message box itself, redrawn as the design's `Input large` (Figma `347:6635`) — chrome and glyph only,
no behaviour change to sending, Enter handling, the send→stop switch (#678), the not-connected gate (#31),
queueing, or prompt-response gates (see [inline prompt placement](conversation-shell-question-panel.md#composer-placement)). Closes the glyph/colour follow-up #678 deferred (see
[Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678)).

**`.composer` paints no background since #1099.** The block had painted `--color-surface` since #1,
invisible while `.conversation` painted the same colour around it. When #1058 turned the pane into a card
(a `--color-scrim` wash at 0.3 on `.paired-shell__pane`, see
[Paired shell § the pane card](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670)),
that ticket deleted the two screen paints it named and this one survived, so the input area sat on the
card as an opaque, square-cornered sheet with a seam above it where `.composer-status` (which paints
nothing) already sat on the card. Figma's `Input area` (347:5408) has no fill at any level: only the card
behind it and the message box carry paint. The box's own ground below is 41% translucent and so takes its
colour from what is behind it, which is why the box read wrong too although its rule matched the drawing.
The shared `.question-panel` also dropped its paint in that change. Clarification batches now render
in history rather than this slot; permission/trust also uses the thread, leaving the composer visible.
`e2e/paired-shell-card.spec.ts` pins `.composer` transparent beside `.channel-list` and `.conversation`;
`e2e/question-answer-continue.spec.ts` now proves inline placement and available composer/footer. Reported by the operator on 2026-09-05, the same
day #1058 merged, and fixed by hand on `main` rather than through the pipeline.

**`.composer` took the card's own sides and foot, and deliberately left the top, since
[#1444](../../specs/architecture/1444-chat-top-bar-and-inset.md)** drew the chat card's inset
(24 top / 20 sides / 16 foot on `.conversation`, mirroring the sidebar's own top-bar-and-inset ticket,
\#1443 — the two cards' *feet* differ on purpose, 20 on the sidebar and 16 here, both as their own Figma
node draws them, and are not meant to converge). `.composer`'s padding went from its own
`var(--space-2) var(--space-3) var(--space-3)` to `var(--space-2) 0 0`: the card's 20px sides and 16px
foot replace the block's own, which is what puts the message box across the full content width. The
top 8 (`--space-2`) was kept rather than zeroed — `.composer-status` is a sibling in the `.conversation`
column, which declares no gap, so that 8px of `.composer`'s own padding-top is the *whole* distance
between the status row's bottom edge and the message box's top edge in every connection state; #1444's
own AC did not ask to move it, and zeroing it with the rest would have deleted a drawn value rather than
converged on one. The shared `.question-panel` retains its own `--space-3` side padding for input-area
consumers. The history questionnaire overrides it to zero under `.question-batch`, following its
[inline design](conversation-shell-question-panel.md#all-question-presentation). Inline permissions
separately clear outer padding under `.question-panel.permission-panel` so the card border and
external Cancel align with the message column.

**`.composer__row` *is* the box now**, not a bare flex row holding a filled textarea beside a filled send
disc. It keeps its class — three shipped specs and #940's type-ahead anchor depend on it — and gains the
ground, the 6px corner (`--radius-xs`) and 12px vertical padding (`--space-3`); the textarea
(`.composer__input`) goes transparent and carries only the text's own type and inset. The box's 52px
height is **derived, not declared**: 12 (row) + 4 + 20 (one body-medium line at `rows={1}`) + 4 (field) +
12 (row) — a declared height would be a second source of truth fighting the textarea auto-grow
[#1056 built](#the-box-grows-with-the-draft-to-a-five-line-ceiling-1056) into `.composer__input` itself,
below.

**Horizontal padding stays on the textarea, not the row** — `.composer__input` carries 16px left / 56px
right (`--space-4` / `calc(48px + --space-2)`), the row carries none. This is the only split that works:
`.composer__send` is absolutely positioned against the row, and an absolutely positioned box resolves
`right` against its containing block's *padding* box. With horizontal padding on the row, the drawing's
`right: 4px` would have to be written as a negative offset; at zero the padding box edge is the border box
edge, so `right: var(--space-1)` is the drawing's own number.

**The translucent ground is a dedicated `::before` at `opacity`, not `color-mix()`.** `--color-on-primary`
(`#003355`) at 41% is the house form for "a token at N%" — recorded on `.status-sheet-overlay__scrim`
("opacity is not a color literal") and already shipped twice more at the same colour and percentage
(`.question-panel__other-field::before`, the drawing's `Input small`) and at 72%
(`.pairing-field__row`'s ground). `color-mix()` appears nowhere in this repo as a value, only in comments
naming it as the form declined. The pseudo-element paints above non-positioned in-flow content, which is
why `.composer__input` carries `position: relative` — the same line `.pairing-field__row` carries for the
same reason.

**The send control sits inside the box**, out of the row's flex flow (so the row's old `gap` was
deleted — one flex item left, nothing to space): `position: absolute; right: var(--space-1)`. At rest it
paints **no container** (`background: none`) with its glyph in `--color-primary` instead of a filled
`--color-surface-container-high` disc — the M3 icon button's own always-invisible-at-rest posture, not a
desktop divergence. The send variant's glyph changed to the `circle-chevron-up-solid-full` export at
28×28, matching the stop variant's existing size and export family; both glyphs are `fill="currentColor"`,
no hardcoded `#9DCBFC`. `ComposerSendButton`'s own props, callbacks, `aria-label`s and disabled gate are
untouched — see [composer send § 3](composer-send-internals.md#3-the-controlled-composer--conversationscreentsx).
Through #951 the control's vertical placement was `top: 50%; transform: translateY(-50%)` — centred in
the box. **#1056 replaced that with a bottom pin** (`bottom: 2px`) so the control stays beside the line
being typed as the box grows past its resting height — see below.

**The focus ring #951 moved from the textarea to the box was retired by #1063 (2026-09-05), not restyled.**
`.composer__row:has(.composer__input:focus-visible)` — same token (`--color-outline`), same 1px, painted
around the whole box once the textarea became a 28px band inside a 52px box, since its own outline drew a
bare rectangle floating inside the rounded corner rather than reading as the box's focus state — is gone.
The reason is the drawing: `Input large` (Figma `347:6635`) carries an `Active indicator` child (`347:6441`)
and it is hidden in the node, so the focused message box has no visible indicator of its own by design. The
ring was never a value that drifted from Figma; it was #951's own addition, which is why removing it reads
as a fidelity fix rather than a regression. `.composer__input`'s own `outline: none` stays — dropping it
would hand the box back the UA's ring, the one thing #951 already established the textarea is the wrong
element to draw it on.

The caret is the box's only focus indicator now, and that trade is deliberate rather than assumed: a text
field's caret is a focus indicator in its own right, which is why WCAG's focus-visible requirement is
normally read as satisfied for text inputs without a drawn ring, and `e2e/composer-message-box.spec.ts`
pins the caret's presence (`caret-color` neither `transparent` nor `rgba(0, 0, 0, 0)`, paired with
`document.activeElement`) alongside the ring's absence, so a later ticket cannot silently hide it and leave
the box with no indicator at all. `caret-color` is unset anywhere in this stylesheet, so the computed value
is the keyword `auto`, not an rgb — there is nothing to compare it against `--color-on-surface` for — and
of the checkpoint's two negative arms only the `rgba(0, 0, 0, 0)` one actually detects: proved by adding
`caret-color: transparent` and rebuilding, Chromium serialises that keyword to the rgba form, so the literal
`'transparent'` arm never fires. Both arms ship anyway (the inert one costs nothing and would catch an
engine that serialises the keyword literally), but a future trim of this checkpoint must keep the rgba arm. `conversation.css` still declares `1px solid var(--color-outline)` at 21
other call sites — `.composer__send:focus-visible` among them — and this trade holds for a text field, not
for a button; the retirement comment above the deleted rule is explicit that dropping it is not licence to
drop the rest. `:has()` over `:focus-within` was the load-bearing choice while the rule lived (`:focus-within`
also matches while the send control holds focus, which would have stacked this ring on top of the button's
own `:focus-visible` ring) and the argument is preserved in the retirement note rather than restated here,
since there is no rule left to attach it to. `.question-panel__option:has(.question-panel__input:focus-visible)`
(#912) is this selector pattern's one surviving consumer.

**The #940 type-ahead anchor is unmoved**, on purpose: no `overflow: hidden` was added to `.composer__row`
(the panel paints outside the row's box at `bottom: 100%`; clipping to the new corner would erase it, and
no `node`-environment vitest spec can see that). The row gained no border and no horizontal padding, so
the anchor rect `e2e/composer-options-clamp.spec.ts` measures is unchanged in x and width — it grew 4px in
height only (48 → 52), which that spec does not read. The recorded 4px gap between the type-ahead's label
and the box's own text inset ([type-ahead § the anchor](conversation-shell-composer-options-slash-type-ahead.md))
stands on the same `--space-4` declaration it always named.

**Two gaps the verifier flagged and left open, both non-blocking and carried to #890** (the one open
ticket still touching this region) rather than fixed in #951:

- **~46% of the box's height is not click-to-focus.** The 12px of vertical padding now lives on the row,
  not the field, so a click in either 12px band (24 of the box's 52px, full width) hits a bare `<div>`
  with no handler and does nothing — visible too, since the row declares no `cursor: text` and the cursor
  drops to an arrow there. The fix, if picked up, is to move the 12px back onto `.composer__input` instead
  of `.composer__row` (pixel-identical box, and the textarea fills it again).
  \#890 or a follow-up should carry this if it isn't addressed sooner.
- **The send control's hover step is now a ~1.008:1 non-step against the new ground.** The ground
  composites to `rgb(9, 33, 49)`; the shipped `:hover:not(:disabled)` still steps to
  `--color-surface-container` (`#1d2024`), which was a visible ~1.12:1 step against the old
  `--color-surface-container-high` at-rest fill but reads as no luminance change at all against the new
  translucent navy. `--color-surface-container-high` (the token the control already wore before this
  ticket) restores a comparable step and is the likely fix.

### Suggested next reply

When the retained draft is exactly `''` and the selected host/conversation has a
valid current-session suggestion, `Composer` displays that complete text through
the native textarea placeholder. It keeps the existing body-medium typography
and grey `--color-on-surface-variant` treatment. This does not insert draft content.
Any typed or pasted content, including whitespace, restores the ordinary
`Message…` placeholder; deleting back to empty can reveal a still-valid suggestion.
Suggestion text reaches only inert escaped placeholder/input text.

After slash-command type-ahead has first chance to consume the key, unmodified
Tab outside IME composition accepts a visible suggestion as the normal editable
draft. It prevents traversal, retains input focus and places both selection ends
at the text's end after React commits, using the existing textarea ref. It sends
no message. Shift/Ctrl/Alt/Meta+Tab, composing Tab, Tab with a nonempty draft or
without a suggestion, and slash-command completion retain their existing behavior.

[Suggestion clears](daemon-event-channel.md#reply-suggestions) never erase drafts,
including accepted text and subsequent edits. The host/conversation-keyed draft
store retains that text across navigation independently of suggestion lifetimes.

Coverage lives in the [wire validation tests](../../../src/main/transport/replySuggestion.test.ts),
[main IPC tests](../../../src/main/daemonConnection.test.ts),
[suggestion-store unit tests](../../../src/renderer/src/store/replySuggestionStore.test.ts)
and [mounted fake-transport browser spec](../../../e2e/reply-suggestion.spec.ts).
Unit coverage pins scoped revision/session behavior and all four translators'
no-op handling. The four browser tests prove delivery, whitespace/edited drafts,
Tab focus/caret/editability/no-send, keyboard exceptions, slash completion,
authoritative clears, off-screen/host isolation and reconnect reconciliation.
Static renderer tests cannot execute those interactions. The paired launch
fixture needs one initial chat row; add other navigation targets after launch
and retain them in reconnect list replies, or a reconnect test can lose the chat
it needs to inspect.

The [final verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/1810#issuecomment-6026075082)
at `e0b178ce` records 8,949 unit tests executed/passed, 0 failed and 3 skipped,
including all eight suggestion-store tests. Its browser evidence records 309
executed, 307 passed, 2 failed and 4 skipped, with all four suggestion tests present
and passed, including `reconciled old-session null does not pin an off-screen chat
after a missed rotation`. The two unrelated failures passed a focused rerun:
2 executed/passed, 0 failed/skipped. No live-Claude run is required for this client
behavior.

## The box grows with the draft, to a five-line ceiling (#1056)

Past the first line the draft used to scroll inside the fixed 52px box, unreadable past a 20px window.
Two declarations on `.composer__input` build the grow the rule above always deferred — no ref, no
`ResizeObserver`, no measure-and-set, and **no change to `ConversationScreen.tsx`**: `rows={1}` stays
exactly as written.

```css
field-sizing: content;
max-height: calc(5 * var(--text-body-medium-line) + 2 * var(--space-1));
```

`field-sizing: content` (Chromium 123+; this app ships Electron 33.4.11, Chromium 130, and there is no
second engine to support) turns `rows={1}` from the textarea's fixed size into its **minimum** — which is
why the resting box stays byte-identical and why no TSX changed. `max-height` is the ceiling, read in the
border box this rule already declares: five body-medium lines plus the rule's own two 4px of vertical
padding is 108px, and the row's 12 + 12 puts the box at 132px — the same arithmetic the resting 52px above
is derived by. Both are written in the tokens they depend on (`--text-body-medium-line`, `--space-1`)
rather than as `108px`/`132px` literals, the form `padding-right`'s own `calc()` two lines down already
uses. Measured in the built app rather than predicted: box height 52/72/92/112/132 at one through five
lines, holding at 132 past them, and exactly 52 again once the draft empties — by deletion or after a
real send.

Past the ceiling, the UA's own `overflow-y: auto` keeps the draft scrollable within the five-line cap.
Since [#1525](https://github.com/pyrycode/pyrycode-desktop/issues/1525), `.composer__input` hides scrollbar
paint with `scrollbar-width: none` and a separate `.composer__input::-webkit-scrollbar { display: none; }`
rule, matching the [thread's treatment](conversation-shell-chrome.md#layout-contract). The scrollbar
stays hidden at rest and while scrolling, including with an always-visible OS scrollbar preference;
native wheel, trackpad and keyboard editing still reach the text. This supersedes the earlier choice
to keep the bar visible as an overflow signal. No gutter is reserved with `scrollbar-gutter: stable`.

Chromium keeps the caret's line in view unassisted — measured at 8 lines, `scrollTop` settles 6px short
of its own maximum, because Chromium flushes the caret's own ~16px text box to the visible bottom edge rather than
the full 20px line box; an assertion of "scrolled fully to the bottom" would fail against a correct
render, so the covering spec asserts "less than one line remains below the fold" instead.

`field-sizing` also makes the textarea's intrinsic *width* content-based, not only its height —
untested by any assertion this repo shipped before #1056. `flex: 1 1 auto; min-width: 0` (already on this
rule) still fills the row at every height: measured at 616px, equal to the row's own width, at rest, at
the five-line ceiling, and under an unbroken 1000-character line.

**The bottom pin, and why 2px rather than `var(--space-1)`'s 4px.** `.composer__send` drops `top: 50%;
transform: translateY(-50%)` for `bottom: 2px`; `right: var(--space-1)` is unchanged, and the new
declaration resolves against the same edge for the reason [the paragraph above](#message-box-951) already
gives — `.composer__row` has no border and no horizontal padding, so its padding box edge is its border
box edge. 2px is the Figma node's (`347:6440`) own number on this axis, not a compromise: the button
wrapper sits at `top: -10px` inside a `Text field` that starts at `y: 12`, placing the control's bottom
gap at `52 − 2 − 48 = 2`. The 4px belongs to the horizontal axis (`right`) alone. At 2px the resting
render is byte-identical — both gaps are 2, so `e2e/composer-message-box.spec.ts`'s
`expect(gapAbove).toBe(gapBelow)` holds unedited — and the control sits 2px off the bottom at every grown
height, beside the line being typed. Measured across the growth: the gap below stays 2 while the gap
above goes 2 → 22 → 42 → 62 → 82 as the box goes 52px → 132px.

**Only `.conversation__thread` gives up the space.** It is `flex: 1 1 auto; min-height: 0`; across the
box's 52 → 132 growth it drops by exactly the same 80px (508 → 428, measured), while `.composer-status`
and `.composer__footer` keep their own heights and nothing overflows the window. No pin, hook or observer
was added for the thread's scroll position — [#1049](conversation-shell.md#edge-cases-and-limitations)'s `ResizeObserver` already
watches the thread's own border box, which is exactly what a growing composer changes; measured with an
overflowing thread resting at the bottom, `scrollTop` tracks the maximum exactly across the growth and the
shrink back. The slash-command type-ahead (anchored on `.composer__row` at `bottom: 100%`,
[see above](conversation-shell-composer-options-slash-type-ahead.md)) rides up with the box unchanged in x
and width — `e2e/composer-options-clamp.spec.ts` reads only those two, which is why it correctly stays
green rather than why it fails to detect anything here.

Covered in `e2e/composer-message-box.spec.ts` beside the resting checks — geometry is invisible to the
`renderToStaticMarkup` renderer tier, so every assertion here is Playwright. Driven with explicit newlines
(`'a\nb\nc\n…'`), not wrap, so the detector doesn't move with the sidebar's width. The overflow checks first
prove `scrollHeight > clientHeight`, then read `scrollbar-width: none` and `overflow-y: auto`.
Wheel travel in both directions and keyboard edits at both ends must retain the height cap and hidden
scrollbar. Small pixel wheel deltas cover the trackpad event path, but do not simulate physical trackpad
momentum, which requires a manual check. See [scrollbar detection](conversation-shell-chrome.md#layout-contract)
for why a zero-width gutter can pass with the hiding rule deleted. The sidebar now shares this
hidden-scrollbar policy, with its own [wheel and focus coverage](channel-list.md#css-channelscss).

## Composer footer row (#811)

The desktop layout's fixed-height row **below** the message box, revised against
[Figma Input area `347:5408`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=347-5408)
on 2026-10-05 (#1727): a 785×20 footer in the inspected drawing, following the status area and message
input. The [Composer status row](conversation-shell-composer-status-row.md#composer-status-row-796)
sits *above* the message box.
The desktop layout puts six affordances in this row — context usage, Actions (#680), permission mode
(#682), model and effort (#683, split into a model half and an effort half by #683's own children),
and attach (#685, split into [#862](attachment-upload.md)'s headless flow and
[#863](composer-attach.md)'s button) — and at the time #811 shipped, five of them were blocked on
daemon work that doesn't exist yet. #811 built the row itself and landed the one occupant that wasn't
blocked; **no placeholder element and no disabled control for the rest**. **#680 was the first of the
blocked five to land** — it needed no daemon work at all, only the already-shipped
[options panel](conversation-shell-composer-options-panel.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)
— followed by [#988's model menu](composer-model-menu.md), [#989's effort menu](composer-effort-menu.md)
once #974 landed the daemon's published list, then
[#682's permission-mode menu](composer-permission-mode-menu.md) once #1020/#1021 landed the mode's two wire
halves, and finally [#863's attach button](composer-attach.md) once #862 landed the picker/upload flow it
wires. All six of the row's slots are occupied:

```
Composer
├── .composer__row                  (unchanged — textarea + ComposerSendButton)
├── .composer__footer               (second child, #811; was the third until #968 retired __hint above)
│   ├── ContextUsageControl         first item when available — ring, with breakdown trigger if supported (#1728)
│   ├── ComposerActionsMenu         opens the shared options panel with sendText (#680)
│   ├── ComposerPermissionModeMenu  the session's permission mode, from the same panel (#682)
│   ├── ComposerModelMenu           the session's model, from the same shared panel (#988)
│   ├── ComposerEffortMenu          the session's effort, from the same shared panel (#989)
│   └── ComposerAttachButton        last item, margin-left: auto — renders unconditionally (#863)
└── ComposerAttachOutcome           composer column's own last child, NOT inside .composer__footer (#863)
```

The row matches Figma's order (context circle · Actions · mode · model · effort · attach) since #1728.
The settings stay inline, and Attach is the sole trailing control. #1727 established footer padding
and Attach geometry; #1728 moved the reading ahead of Actions. See
[Composer permission-mode menu](composer-permission-mode-menu.md) for the one structural way it differs
from its two menu neighbours — its entries are a client-owned constant rather than a daemon-published list, so
it needs no model list to become operable once a mode is known and host/session availability permits.
That moved the row's anchor/`aria-haspopup` counts from one to two; see [Composer model menu](composer-model-menu.md) for its
three renderings, the CSS extraction it triggered on `.composer__actions` (the row's second footer button
at the time), and the `.composer-options-anchor` uniqueness correction it required; see
[Composer effort menu](composer-effort-menu.md) for its own three renderings, its own label-width bound,
and the fourth-glyph CSS lift both it and #682 declined in `.composer__actions-icon`'s favour of a
standalone tidy-up; see [Composer attach](composer-attach.md) for the one control that renders
unconditionally and needs no daemon-published list at all, and for why its outcome line lives beneath the
row rather than inside it.

Through [#968](../codebase/968.md), `.composer`'s first child was `.composer__hint` (#31's not-connected
caption); it is retired, and `.composer__row` is now `.composer`'s first child.

Inline BEM children of `.composer`, not a component of their own — consistent with `.composer__row`
already being inline JSX rather than extracted, and it keeps the ticket's exported surface to two symbols.

**`contextUsagePercent(usedTokens, windowTokens): number | null`** — new file,
`src/renderer/src/screens/conversation/contextUsage.ts`, React-free and dependency-free (the
`composerSend.ts` idiom: a pure module beside the screen with its own `.test.ts`). This is the one
computation [Run configuration Context window section](conversation-shell-run-configuration.md#run-configuration-context-window-section-192)
used to own inline; see that section above for the extraction and the `Number.isFinite` guard it added.
Returning `number | null` (not a number beside a separate `available` boolean) is what makes the two
surfaces structurally unable to disagree about whether a reading exists — the guard is the return type,
not a convention repeated at each call site.

**`ContextUsageReading({ usedTokens, windowTokens })`** — the pure view, beside `ComposerErrorChip` in
`ConversationScreen.tsx`. Returns `null` when `contextUsagePercent` does; otherwise a
`.composer__context` span contains a 15×15px inline SVG and a visually hidden
`.composer__context-label` (#1728). The SVG is `aria-hidden="true"`; its two circles use centre
`(7.5, 7.5)`, radius 6.5 and a 2px stroke. The full track always paints `--color-primary-container`.
The used arc takes the span's severity colour through `currentColor`, starting at 12 o'clock and
growing counterclockwise via `matrix(0 -1 -1 0 15 15)`. A known 0% draws the dark track only; 100%
draws a complete used ring. An unavailable reading renders neither, so it cannot masquerade as 0%.
The span has no handler, `tabIndex` or role, and no live region: a live region would announce the
percentage on every turn end. The capability-dependent button belongs to `ContextUsageControl` below.

**Dash lengths use circumference, not SVG `pathLength`.** With `C = 2π × 6.5`, the arc's
`stroke-dasharray` is `pct × C / 100` followed by a full `C` of gap, both rounded to three decimals
(0%: `0.000 40.841`; 100%: `40.841 40.841`). Chromium's `pathLength="100"` scaling left a visible
gap at 100%, and a percentage/complement dash period drew a sliver beyond the start on partial arcs.
Static markup assertions passed despite those painted defects; captures of the real component at
0%, partial readings and 100% exposed them. Keep the circumference-based form and plain butt ends
(Figma's vector has small end notches). This is the revision recorded in the
[#1728 plan](../../specs/architecture/1728-context-usage-circle.md#revisions).

**The severity ladder — `contextUsageStep(percent): 'primary' | 'warning' | 'error'`**, beside
`contextUsagePercent` in the same file. Since #1728 the descending ladder is `>= 85` → `error`,
`>= 70` → `warning`, else `primary`, replacing the earlier 50%/70% boundaries. The two literals are not
exported as named constants — `contextUsage.test.ts` hard-codes them
so a `>`/`>=` slip at either boundary reddens a test rather than passing against its own symbol. Total over
`number`: `NaN` falls through both comparisons to `primary`, the arm the reading has always painted, though
the caller can't reach it anyway (`contextUsagePercent` returns `null` first). The step names are the
`--color-*` token suffixes and the `.composer__context--*` class modifiers verbatim, so the mapping from
step to paint is nominal at every layer.

No percentage text is visible. The hidden label carries both the percentage and the warning state,
and supplies the accessible name when the ring is wrapped in the breakdown button:

| Reading | Used arc token | Hidden label |
| --- | --- | --- |
| 0–69% | `--color-primary` | `Context: N%` |
| 70–84% | `--color-warning` | `Context high: N%` |
| 85–100% | `--color-error` | `Context nearly full: N%` |

The warning/error modifiers keep the base class leading and each set only `color`; equal specificity
means they must stay below the base rule in CSS. The hidden label uses the visually hidden recipe from
`.composer-status__error-prefix`, so changing warning words never changes the ring's width.
**The [run-configuration context gauge](conversation-shell-run-configuration.md#run-configuration-context-window-section-192)
does not follow this ladder**: `.run-config__context-fill` remains `--color-success` at every value.

`ConversationScreen.test.tsx` pins literal dash lengths, including 69/70/84/85%, zero, full and rounded
readings, plus hidden labels and unavailable output. `e2e/composer-context-severity.spec.ts` drives
69/70/84/85% through turn-end refreshes and checks the arc's computed stroke against each token and
the track's unchanged dark stroke. Markup alone cannot prove the SVG's painted endpoints or direction;
the component captures supplement those assertions.

**`ContextUsageControl({ conversationId })`** — module-private container, the single-selector-read shape
\#797's `ComposerErrorChipControl` established (since collapsed into `ComposerErrorSlotControl` by #963,
above): one `useRunConfigStore(selectSnapshot)` read (not two narrow field selectors — both figures must
come from the same store tick, or a tear could show a percentage of two unrelated snapshots). Reads [Run
configuration store](run-config-store.md)'s app-lifetime `RunConfigLiveData` feed (#810).

**Since [#1421](https://github.com/pyrycode/pyrycode-desktop/issues/1421), that snapshot pair is the
fallback, not the source.** `conversationId` is now a prop — `activeConversationId`, already in scope at
the `composer__footer` row and read by every sibling control in it — behind a `useMemo`-stable selector
(the `RunConfigSections` idiom: a fresh closure each render would re-subscribe `useReportedContextStore`
every render for a value that is usually the same `null`). The control reads the conversation's claude-
reported figure through `selectReportedContextFor(conversationId)` from the [reported-context
store](reported-context-store.md), then resolves the winning pair through the shared leaf
`contextTokenSource` (`src/renderer/src/screens/conversation/contextTokenSource.ts`) — the *same* function
[`RunConfigSections`' container](conversation-shell-run-configuration.md#run-configuration-context-window-section-192)
calls for the gauge, so the footer and the gauge cannot disagree about which figure to show for one
conversation. `contextTokenSource` still performs the `snapshot?.usedTokens ?? 0` / `?? 0` coalescing this
control used to spell inline — now written once — so the not-yet-loaded state and the daemon's
`window_tokens: 0` "unavailable" signal reach each surface's existing unavailable branch, and
a present claude reading whose maximum is `0` resolves there too rather than falling back to the snapshot.

**`.composer__footer` reserves its own height (20px) unconditionally**, the same `.composer-status`
guarantee ([Composer status row](conversation-shell-composer-status-row.md#composer-status-row-796) above): a null reading cannot move
`.composer__row` because the row's box exists whether or not it holds a child. Since #1727 it explicitly
uses `box-sizing: border-box`, so the 20px includes its 4px top padding rather than becoming a 24px row.
`align-items: flex-start` puts children at that top inset. Padding is 4/16/0/12px
(top/right/bottom/left), written `var(--space-1) var(--space-4) 0 var(--space-3)`; the left edge is now
12px inside the message box's edge. The circle adds the left group's 4px inset, so its left edge is
16px inside the footer's border edge. Both the bare reading and `.context-breakdown-anchor` use
`margin-left: var(--space-1)` and
`margin-right: calc(var(--space-4) - var(--composer-footer-gap))`: subtracting the row gap keeps
circle-to-Actions spacing at 16px as the other gaps compress. Percentage margins and gaps resolve
against the same row content box. Attach keeps its
24×16px box at the 16px right inset, with the 11×12px paperclip at its top right; see
[its CSS](composer-attach.md#css). The remaining item rhythm is `column-gap: var(--composer-footer-gap)`,
where the variable holds `min(3.5%, var(--space-5))` since #1728. That value dates from
\#1107 — see below; it was a flat `gap: var(--space-5)` (the design's measured 20px) from #811 through
\#682/#683, inert with one child and then live between the Actions trigger and the context reading.

## Footer row shrink policy (#1107)

Before #1107, at the app's documented 800px minimum window the row above overflowed its content box:
five fixed `--space-5` gaps (100px), two `nowrap` items with no give (`.composer__actions`, `.composer__context`),
one `flex: 0 0 auto` item (`ComposerAttachButton`), and three labels whose `min-width: 0` truncation
chains never fired because the boxes *above* each label — the `<button>` and, above that,
`.composer-options-anchor` — both kept the default `min-width: auto`, which floors a flex item at its own
already-clamped content. The row's content was its floor, the floor exceeded the 284px content box, and
`.paired-shell__pane`'s `overflow: hidden` ([Paired shell § the pane
card](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670)) clipped the
remainder — the attach button and the tail of the context reading simply vanished off the pane's right
edge, with no visual sign anything was cut. Filed while building [#1062](#composer-footer-row-811)'s
context-severity ladder, whose five-character growth was the trigger for measuring the row, not its
cause. Fixed by [`docs/specs/architecture/1107-composer-footer-row-shrink-policy.md`](../../specs/architecture/1107-composer-footer-row-shrink-policy.md).

**The policy, in one line: whitespace gives first, then every labelled control gives together, and the
context reading never gives.** The circle-to-Actions gap stays 16px; the other gaps compress. The policy
is implemented at these three levels:

- **`.composer__footer`** — `gap: var(--space-5)` became `column-gap: min(3.5%, var(--space-5))`.
  `column-gap` rather than the `gap` shorthand because the row is single-line `nowrap`, so `row-gap` has
  no meaning in it. `3.5%` was derived to reach the 20px ceiling at the app's own 1100px default window;
  the launch-width geometry assertion still pins that ceiling after #1727's revised padding. A percentage
  `column-gap` resolves against the row's own content box, which is definite here (a stretched child of the `.composer`
  column); at the 800px minimum with worst-case content the gap measures ~10px, about a third of the
  row's shortfall.
- **`.composer-options-anchor` and `.composer__footer-button`** both gain `min-width: 0`, which is what
  lets row pressure reach a label at all — the two boxes a shrink has to pass through between the row and
  each of the three bounded labels (`.composer__model-label`, `.composer__effort-label`,
  `.composer__permission-label`). **No label `max-width` is retuned** — that is the fix both labels'
  shipped comments named and both declined to perform, and retuning one would make the row's fit depend on
  whatever vocabulary the daemon happens to publish. `.composer__footer-button` additionally gains
  `overflow: hidden`, which stops a squeezed control from painting its own chevron outside its box and
  recreating the row's overflow from the inside — structural rather than arithmetic, so no footer control
  can contribute scrollable overflow whatever the daemon publishes. It must never reach
  `.composer-options-anchor` itself, which is the open options panel's containing block
  ([Composer options panel](conversation-shell-composer-options-panel.md)) and would clip the panel out of
  existence; the split is what `e2e/composer-options-clamp.spec.ts`
  ([Composer options panel](conversation-shell-composer-options-panel.md)) and every menu-open spec
  re-confirm green. It cannot clip a `:focus-visible` ring either — an outline is
  not clipped by the focused element's own `overflow`.
- **`.composer__context`** uses `display: flex; flex: 0 0 auto` since #1728: the 15px circle cannot
  ellipsize, and its hidden label takes no layout width. This replaces the visible reading's former
  `white-space: nowrap`/automatic-minimum-size guarantee. The breakdown anchor also uses
  `flex: 0 0 auto`, so wrapping the reading in a button preserves its width.

**`ComposerActionsMenu`'s label moved into `<span className="composer__actions-label">`** — a change the
plan itself said it would not make, added after the mechanism above was proven: a bare text node inside a
flex button is an *anonymous* flex item, which no selector can reach, so it refused to shrink below its
own min-content and `.composer__footer-button`'s new `overflow: hidden` clipped its chevron off the end
instead (measured 15.2px against 56px wanted — the only one of the four triggers to lose its glyph rather
than ellipsize). `.composer__actions-label` carries the same `min-width: 0` + `overflow: hidden` +
`text-overflow: ellipsis` chain as its three sibling labels, but **no `max-width`**: those three bound
daemon-authored text, this one is `COMPOSER_ACTIONS_LABEL`, a client-owned constant with nothing to bound,
and a number here would be the "number in a single control's rule" the whole policy exists instead of.
`ComposerActionsMenu.test.tsx`'s exact-equality assertion on the trigger's announced content moved to the
wrapped form and stayed an exact equality; the accessible name is still computed from contents, so the
ellipsis is visual only.

**`.composer__permission-label` can ellipsize at the 800px minimum.** Its longest known label is
`Approved actions only` (`dontAsk`), which `e2e/composer-footer-overflow.spec.ts` seeds beside long
model/effort labels and full context usage. Before #1107 content silently vanished off the pane's clipped
edge with no truncation signal; an ellipsis is a visible one. The full mode name remains in the control's
accessible name, and selectable labels fit fully in the open dropdown. `Bypass approvals` can appear on
the trigger but remains excluded from the menu; see the [permission-mode contract](composer-permission-mode-menu.md#the-wire-contract-is-asymmetric-and-that-asymmetry-is-the-whole-design).
The gap's `min()` ceiling preserves 20px between menu items at the default window width, with the
circle-to-Actions exception above. The #1728 visual review measured a 20px footer height and no
horizontal overflow at both 1100px and the 800px minimum. Worst-case labels still ellipsize while the
circle stays whole and every control remains present, ordered and keyboard reachable.
Attach's fixed 24×16px box does not give width. Inline settings remain in the row; no control is dropped.

**Wait for the resize itself before testing fit.** Since #1727,
`e2e/composer-footer-overflow.spec.ts` polls `window.innerWidth` to 800 before reading narrow-width
geometry. A fit assertion already satisfied at the 1100px launch width could otherwise pass before
relayout. The spec retains worst-case label seeds, launch-width rhythm, overflow and visual-order
checks, and adds exact padding/Attach geometry at launch, 785px footer and minimum window widths,
plus keyboard traversal and Enter invoking the picker through IPC; see [Attach testing](composer-attach.md#testing).
Since #1728 it also measures the ring's 15px size, 4px group inset and 16px gap to Actions, checks
visual order starting with the circle, and traverses the context trigger before Actions, mode, model,
effort and Attach. With no breakdown support the bare circle has no Tab stop.
The `.composer__footer-button` comment still describes Actions as a bare text node; the rendered
`.composer__actions-label` span and its truncation chain above are the implemented policy.

## Context breakdown popover (#1254)

`ContextUsageControl` (above) wraps the `<ContextUsageReading/>` span in `ContextBreakdownPopover`
when the session supports breakdowns (see capability gating below). The module
`src/renderer/src/screens/conversation/ContextBreakdownPopover.tsx` supplies a button that opens a read-only
panel over the held [reported-context-store](reported-context-store.md) record. The ring is now the
first footer trigger; its hidden percentage/warning label supplies the button's accessible name.
Tab reaches it with visible focus, Enter opens the panel, and Escape closes it and returns focus.
Nothing renders when `contextUsagePercent` is `null`; the popover adds no new empty state.
The container mirrors `ComposerOptionsMenu`'s open/close/focus-return/Escape/outside-
click lifecycle minus rows to rove; `open` is component-local so it resets on remount (ADR 0006). The
panel's content is `reported` alone, never the settings-snapshot fallback pair — when the footer is
showing the fallback figure, `reported` is `null` and the panel shows one client-owned pending line rather
than recomputing a breakdown the daemon never sent.

**Left-aligned to the footer's edge in CSS, without a clamp, since #1728.** Moving the trigger from
the row's trailing side to its first slot reverses the safe panel alignment: the former `right: 0`
would put most of the 280px panel outside the pane's left edge. `.context-breakdown` now uses
`left: calc(-1 * var(--space-3) - var(--space-1)); right: auto`, undoing the footer's 12px padding and
the circle's 4px inset. Both pending and populated panels fit at the 800px minimum. Do not substitute
the footer menus' window-edge clamp: earlier measurements squeezed the panel to about 130px or moved
it past the pane edge, where `.paired-shell__pane`'s `overflow: hidden` clipped it. Placement must
follow the trigger's position and the pane boundary, not only the window boundary.

**The new anchor deliberately does not wear `.composer-options-anchor`.** That class carries
`min-width: 0`, which is exactly what lets a footer menu give width under the #1107 shrink policy — and
the context reading is the one control the policy names as never giving. `.context-breakdown-anchor` is
its own class with `flex: 0 0 auto` instead, so `e2e/composer-footer-overflow.spec.ts`'s anchor count
(pinned at 4) stays correct and the reading's width guarantee survives the new wrapper.

Every daemon string the held reading carries (`model`, category/tool/server names, memory-file paths,
the last `shortenPath`-ed) reaches the panel as a JSX text child only, per the store's own inert-text
mandate; the one data-derived attribute is a category's bar width, a share already clamped to `[0, 100]`.
MCP tools are grouped by `server_name` through a `Map` (`groupMcpToolsByServer`), never a plain object, so
a hostile `__proto__` server name is an ordinary group. See
[`ContextBreakdownPopover.tsx`](https://github.com/pyrycode/pyrycode-desktop/blob/main/src/renderer/src/screens/conversation/ContextBreakdownPopover.tsx)
for the row-by-row rationale; the security review at
[`docs/specs/architecture/1254-context-breakdown-popover.md`](../../specs/architecture/1254-context-breakdown-popover.md)
walks the full checklist (PASS, no findings).

Covered by `e2e/composer-context-breakdown.spec.ts`: no reading held, a frame carrying all three
inventories, and a categories-only frame (no MCP or memory group renders).

## No breakdown for a session that reports none (#1655)

`ContextUsageControl` keeps the bare `<ContextUsageReading/>` span but stops wrapping it in
`ContextBreakdownPopover` when `sessionSupports(snapshot, 'contextUsageDetail')` is false — a
Codex session, which the popover would otherwise say "arrives after the next turn" forever, since
no such reply is coming. The reading's own presence and exact styling are unchanged: the control
still returns `null` when `contextUsagePercent` is `null`, and the `sessionSupports` check runs
only once that guard has already passed. See [Run configuration store § Session capability
flags](run-config-store.md#session-capability-flags-1655) for the reading rule — an absent flag, a
snapshot that has not arrived yet, and every Claude session keep the trigger exactly as before the
flag existed. Pinned by `ConversationScreen.test.tsx`'s seeded-snapshot cases (`contextUsageDetail`
false/true/absent) and by `e2e/session-capabilities.spec.ts`, which also covers the Actions menu and
Channel info's MCP section for the same all-false reply.
