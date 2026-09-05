# #1057 — a user message keeps the line breaks it was typed with

## Files read

Codegraph is not initialised in this repo (every `mcp__codegraph__*` call returns
"CodeGraph not initialized"), so this list was built with Grep/Read rather than
`codegraph_context`. Symbols, never line numbers.

- `src/renderer/src/screens/conversation/conversation.css` → `.bubble`, `.bubble--user`,
  `.bubble--assistant-text`, `.conversation__queued` — the one production file this ticket edits.
  `.bubble` declares `max-width: min(680px, 75%)` and `word-break: break-word` and **no**
  `white-space`; `.bubble--assistant-text` is #607's `pre-wrap`, carrying the written-out value
  rationale this plan cites rather than re-derives.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `userText` arm of the
  timeline row switch (`bubble bubble--user`, `data-thread-role="user"`), `QueuedBacklog`
  (`bubble bubble--user`, `data-thread-role="queued"`), and the retired `MessageBubble`
  (`bubble bubble--${message.type}`, `data-message-role`) — the three sites `.bubble--user`
  reaches. None of them is edited.
- `src/renderer/src/screens/conversation/composerSend.ts` → the `text.trim()` at the accept, which
  both the wire text and the local echo carry. Out of scope, per AC2, and the reason the fixtures
  below put every space run and every indent on an interior line.
- `e2e/assistant-whitespace.spec.ts` → its header's vacuity-trap paragraph, `readBubbleMetrics`,
  `readCodeMetrics`, `SUBPIXEL_TOLERANCE_PX` — the measurement idioms the new sibling copies, and
  the file AC5 forbids editing.
- `e2e/queued-backlog-interrupt.spec.ts` → `queueStateFrame`, its three load-bearing facts about a
  pushed `queue_state` (conversation id, post-`connected` ordering, phase gating) — the frame
  builder AC4's arm copies.
- `e2e/composer-message-box.spec.ts` → `draftOfLines` and the block that sends a four-line draft
  for real. The one existing spec whose measured geometry a delivered user bubble's new height can
  reach; see § Blast radius.
- `e2e/fixtures/bubbleText.ts` → `bubbleTextExactly`, the anchored whole-bubble matcher that admits
  #969's meta-row stamp.
- `e2e/fixtures/launchPairedApp.ts` → `seedConversationsFrame`, `SEEDED_ROW`, the daemon's
  `pushFrame`.
- `docs/knowledge/features/assistant-markdown-renderer.md` § "The container and its whitespace" and
  § "`.code-block` now renders in two places" — the standing lesson that a whitespace declaration
  arriving by inheritance or descendant match is silently absent at the next call site. It is why
  this plan hangs the rule on a class that is *stated on every site that wants it* rather than on a
  container.
- `docs/knowledge/features/conversation-shell-message-bubble.md` § Testing — the unit-tier
  assertions that pin `MessageBubble`'s exact byte string and the queued row's zero `.bubble__meta`
  count. A CSS-only fix leaves both untouched by construction.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4508

The desktop `Message` component's user variant: a 6px-radius box on the `--color-on-primary` fill,
20/16 padding, `--color-on-primary-container` title-small-emphasized text, with a right-aligned meta
row (a `DD.MM.YYYY - HH:MM` stamp plus the copy glyph) at its foot. **The drawing is two stacked
paragraphs** — which is what a multi-line message is — but it draws them as two separate text nodes
in a 12px flex column, so it states no whitespace treatment for a single text node holding a
newline. The node is here so the fix is planned against the bubble it actually restyles: the fill,
radius, padding and the meta row that shares the box are all visible in one place, and none of them
changes.

## Context

Shift+Enter puts a newline in the message box, the newline survives `composerSend`'s `trim()` and
reaches the daemon, and then the bubble throws it away at paint: `.bubble` declares no
`white-space`, so it takes the initial `normal` and every newline and every run of spaces collapses
to a single space. A pasted stack trace arrives as one run-on line.

This is #607's defect in the one place #607 did not reach. That ticket fixed the assistant side and
hung its rule on `.bubble--assistant-text` deliberately, because a rule on `.bubble` would have
reached the user bubble too — its comment says exactly that. What it did not say is that the user
bubble had the same defect and wanted the same treatment. #609 later narrowed the assistant rule
again to the still-growing tail, so today `pre-wrap` is stated in exactly one place under `.bubble`
and it is not the user's.

No ADR is warranted: the value question was settled by #607 and this ticket cites that ruling rather
than reopening it.

## Design

One declaration, in `conversation.css`, beside the existing `.bubble--user` rule:

```css
.bubble--user {
  /* … existing fill + text role … */
  white-space: pre-wrap;
}
```

**`pre-wrap` is the value, and #607 wrote out why** — `normal` loses the break, `pre-line` still
collapses space runs and indentation, `pre` stops wrapping so a long unbroken token spills past the
bubble's measure, and `break-spaces` pushes preserved spaces onto the next line where they would
contribute to the box's width instead of hanging. That reasoning is already in this file under
`.bubble--assistant-text` and the new comment cites it rather than restating it.

**Where it hangs: `.bubble--user`, not a new modifier.** The class reaches all three sites that
draw the user's own words in one declaration — the delivered `userText` row, the `QueuedBacklog`
row, and the retired `MessageBubble`'s user branch — and reaches nothing else. That set is exactly
the defect and nothing more. A new modifier applied at the two live call sites is the alternative;
it buys a distinction between "a delivered user message" and "a queued one" that nothing needs
today, and it costs a markup change at both sites, which would put the unit tier's exact-byte
assertions in play. Staying CSS-only is what keeps this a one-file ticket.

**The declaration is stated on the class, not inherited into it.** The package overview's #780
lesson is that `white-space` arriving via a descendant selector or by inheritance from `.bubble` is
silently absent at the next call site that reuses the markup. `.bubble--user` is written on every
element that wants the treatment, so a fourth site that wears the class gets it, and one that does
not, does not.

**Nothing else under `.bubble` changes.** `.bubble--daemon` is untouched, so the four chrome
affordances (thinking / stall / api-retry / compacting) keep the initial `normal`;
`.bubble--assistant-text` and `.bubble__markdown` are untouched, so AC5's spec sees an identical
assistant bubble in both branches.

### What `pre-wrap` reaches inside the bubble, and why it is inert there

The delivered user bubble holds three kinds of child: the message text, the attachment rows (#815's
file row and #1045's image), and `BubbleMeta` (#969). `pre-wrap` inherits into all three.

- **No stray blank can render between them.** The JSX transform drops a whitespace-only run that
  contains a newline, so the source's line breaks between sibling elements emit no text node at all
  — there is nothing for `pre-wrap` to preserve. #969 recorded the same reasoning for the assistant
  branch, where #607's rule already reaches `BubbleMeta`.
- **The attachment rows and the meta row are their own flex boxes** whose content is a filename or a
  stamp, so preserved whitespace inside them has nothing to preserve.

This is a claim the implementation confirms rather than assumes: the new spec asserts the delivered
bubble's whole text with `bubbleTextExactly`, which admits the meta stamp and nothing else, so a
stray blank line or a widened gap shows up as a text mismatch.

### Wrapping is `.bubble`'s, not restated

A long unbroken token wraps under `pre-wrap` because `.bubble` already declares
`word-break: break-word`. That is not restated on the new rule. Note that the two interact the way
the assistant side does and not the way `.bubble__markdown table`'s cells do: `break-word` is the
legacy keyword — `normal` plus `overflow-wrap: anywhere` — and `anywhere` lowers min-content width,
which is what lets the token squeeze rather than overflow. Under `pre` there are no soft wrap
opportunities at all, so `overflow-wrap` has nothing to act on and the text spills. That asymmetry
is what makes AC3's detector able to redden; see § Testing strategy.

## State + concurrency model

None. No store slice, no async work, no subscription, no IPC. A CSS declaration on an existing
class; no TypeScript in `src/` changes at all.

## Error handling

None reachable. One consideration is worth stating rather than discovered later: **the queued row's
text is daemon-supplied**, arriving on `queue_state` as `QueuedItem.text` through `queueBridge`, so
`pre-wrap` there preserves whitespace a hostile daemon chose. Two bounds already cover it and the
spec confirms both rather than assuming them:

- `pre-wrap` **hangs** a trailing space run past the line's end rather than letting it wrap onto the
  next line and contribute to the box's width — the reason #607 declined `break-spaces`.
- `.bubble`'s `max-width: min(680px, 75%)` caps the box regardless.

The text stays auto-escaped React children on both branches; nothing here touches a raw-markup sink,
an attribute, a URL or a log.

## Testing strategy

**Whitespace is a computed style and a laid-out box, so the proof is e2e and only e2e.**
`vitest.config.ts` runs the `node` environment; every renderer spec is a `renderToStaticMarkup`
string with no stylesheet and no layout. The unit tier cannot observe this and **gains no test** —
the markup is byte-identical before and after.

**A new sibling spec, `e2e/user-whitespace.spec.ts`**, not an extension of
`assistant-whitespace.spec.ts`: that file's harness is the assistant delta/turn-end frame builder,
which this ticket does not need, and AC5 requires its assertions untouched.

**The vacuity trap this spec is written around.** `toHaveText` / `toContainText` hardcode
`normalizeWhiteSpace: true` on both their string and their regex branch, so the actual text is
trimmed and every whitespace run collapsed before comparison — a multi-line text expectation passes
identically against the broken and the fixed build. Every whitespace assertion below is therefore a
computed style or a measured box, read through `locator.evaluate()`. The one text assertion in the
spec is `bubbleTextExactly`, and it is there to prove the *structure* is unchanged, not the
whitespace.

**Fixtures.** One launch, one `buildReplyFrames` that no-ops `send_message` (the optimistic echo
renders on its own — the `queued-backlog-interrupt` precedent) and seeds the row on its default arm.
Six messages sent through `input.fill(...)` + click Send, indexed positionally like the assistant
spec:

| # | fixture | shape | proves |
|---|---------|-------|--------|
| 0 | `CONTROL` | one line, long enough to clear the meta row's own min width | the height and width baseline every comparison below is against |
| 1 | `SPACE_RUN` | `CONTROL` with one interior space replaced by a long run | AC2 — width **greater than** control at equal height |
| 2 | `LINE_BREAKS` | three short lines joined by `\n` | AC1 — height is control + 2 line boxes |
| 3 | `BLANK_LINE` | two lines with a blank line between | AC1 — the blank line is its own line box: height is control + 2 |
| 4 | `INDENT` | two lines, the **second** indented | AC2 — the second line box starts to the right of the first |
| 5 | `LONG_TOKEN` | ~200 unbroken alphanumeric characters | AC3 — the bubble's own `scrollWidth` does not exceed its `clientWidth` |

Every text is built from constants (`' '.repeat(n)`, `join('\n')`), never a literal run of spaces
that is invisible in source. Each fixture differs from the control **only** in collapsible
whitespace where the comparison depends on it, so under the broken build the two measure equal —
equal is the broken state, which is what keeps the assertions discriminating.

**Assertions, all through `locator.evaluate()`:**

- `getComputedStyle(bubble).whiteSpace === 'pre-wrap'` on a delivered user bubble and on a queued
  bubble. The direct read; the geometry below is what proves it is doing something.
- Heights compared as `height - controlHeight ≈ n × lineHeight`, with `lineHeight` read from the
  element's own computed style rather than from a token, so the comparison survives a type-scale
  retune. Every bubble carries the same padding and the same meta row, so those cancel in the delta
  and no padding literal enters the spec.
- Width: `spaceRun.width > control.width`, and `spaceRun.height === control.height` beside it — the
  second half is what says the extra width came from a preserved run rather than from a wrap.
- The indent: a `Range` over the bubble's own text node, `getClientRects()` giving one rect per line
  box; assert `rects.length === 2` and `rects[1].left > rects[0].left`. The rect count is the
  vacuity guard — under the broken build there is one rect and the `left` comparison would be made
  against nothing.
- AC3: `scrollWidth <= clientWidth + SUBPIXEL_TOLERANCE_PX` on the bubble itself (a rendered box is
  a fractional pixel; `scrollWidth`/`clientWidth` are rounded integers and can disagree by 1 on a
  box that does not overflow — `assistant-whitespace.spec.ts` records the same caveat).
  **A `boundingBox().width` read here could never redden**: `.bubble`'s `max-width` caps the box
  whatever `white-space` says. What `pre` changes is that the text stops wrapping and spills out of
  a box that stays the same size, so the overflow read is the only detector.
- AC4: a pushed `queue_state` carrying two items — a control and a three-line one — under
  `SEEDED_ROW.id`, after launch resolves (the two load-bearing facts from
  `queued-backlog-interrupt.spec.ts`). Same computed-style read and the same height delta as the
  delivered rows. The queued bubble carries no meta row, so its baseline is its own control, not the
  delivered one.
- AC5 is verified by running `assistant-whitespace.spec.ts` unedited.

**The redden check, before settling.** Build once with `white-space: pre` on `.bubble--user` and
confirm AC3's overflow assertion goes red, then revert to `pre-wrap` and confirm it is green.
Without that, "the bubble does not overflow" is a claim that would also hold on a build with no
declaration at all. Recorded in the PR body.

### Blast radius on the existing tier

`composer-message-box.spec.ts` fills `draftOfLines(4)` and **sends it for real**, so after this
change that spec's delivered user bubble is four line boxes tall where it was one. Its subsequent
reads are the thread's and the footer's rectangles and `document.documentElement`'s overflow, all
taken *after* the send, and the thread is an internally-scrolling flex region — so the taller bubble
should be absorbed. That is a prediction, not a proof: this spec is run as part of the touched-scope
gate.

Existing whole-bubble text assertions elsewhere are unaffected by construction — `toHaveText`
normalises whitespace, so preserved whitespace normalises back to the same string.

## Open questions

1. **Does the flex row let the bubble widen instead of overflowing under `pre`?** `.bubble` is a
   flex item, and a flex item's automatic minimum size is content-based — but the spec clamps that
   suggestion by the definite max main size, so the box should stay at `max-width` and the content
   should spill. The redden check answers this directly: if the box widens rather than overflowing,
   AC3's detector is the wrong read and the assertion must move to a `boundingBox().width` bound
   against the computed `max-width`. Resolve in Phase B and record under `## Revisions` if it moves.
2. **Does `Range.getClientRects()` return one rect per line box for a text node under `pre-wrap` in
   this Chromium?** Expected yes. If it does not, AC2's indent half falls back to a width comparison
   against an un-indented twin fixture (one extra send), which is strictly weaker but sufficient.
   Resolve in Phase B.
3. **Does `composer-message-box.spec.ts` stay green?** Predicted yes, per § Blast radius. If it
   reddens on a geometry read rather than on a regression this ticket caused, the fix belongs in
   that spec's fixture (a single-line draft for the send step) and is in scope as a test-only edit.

## Revisions

**2026-09-05 — the rule needed a companion reset, and the plan's "inert on the other children" claim was
wrong.** § Design argued that `pre-wrap` inherits into the attachment rows and `BubbleMeta` harmlessly,
because their content is a filename or a stamp. The first build proved otherwise:
`e2e/attachment-file-row.spec.ts` asserts a computed `white-space: normal` on `.bubble__file-name`, which
**deliberately ships with no rule of its own** (#815's measured answer to its own wrapping AC), so the
inherited value is the only one it has. That assertion went red.

The fix is a second declaration beside the first, `.bubble--user > * { white-space: normal }`. It is
structural rather than a list of the two filename classes: the message is the bubble's bare text node and
everything else in the box is an element child, so the reset lands once at the top of each child's subtree
and covers a child added later without anyone remembering to add it to a list. Naming the classes that
exist today would have fixed the one red assertion and handed the same trap to the next ticket that puts a
child in a bubble. `> *` and not a descendant selector, so a rule *inside* one of those subtrees that
wants something else still wins on ordinary specificity instead of having to out-specify a blanket
override.

Still CSS-only, still no markup change, still one production file. `e2e/user-whitespace.spec.ts` asserts
the reset over whatever element children the bubble actually has, rather than naming them.

**Open questions, resolved.**

1. *Does the flex row let the bubble widen instead of overflowing under `pre`?* **No** — the redden check
   measured `scrollWidth` 1765 against `clientWidth` 486, so the box stayed at its measure and the content
   spilled. AC3's overflow read is the right detector and it reddens.
2. *Does `Range.getClientRects()` return one rect per line box?* **No.** Blink splits the range at the
   preserved newline, so a two-line text reports **three** rects — an assertion of `count === 2` failed
   against 3. Replaced with per-character ranges (`setStart`/`setEnd` at one offset), which are one glyph
   position each and mean the same thing however the browser fragments around them. The indent is then
   read as three glyph boxes: line 2's first space sits *below* line 1's first character (the break), at
   the *same* left (a line start, not a wrap continuation), with line 2's first word to the *right* of it
   (the indent occupying real width).
3. *Does `composer-message-box.spec.ts` stay green?* **Yes**, unchanged, along with every other spec that
   reads a user bubble.

**One more measured surprise, recorded because it contradicts a comment in the sibling spec.** Playwright's
`toHaveText` did **not** collapse the newlines in a multi-line bubble's text when matched against a
`RegExp`: the collapsed expectation failed, reporting a received string that still carried both newlines.
`assistant-whitespace.spec.ts`'s header states that `normalizeWhiteSpace: true` is set on both the string
and the regex branch — it is, but it does not reach a RegExp's *received* text here. This costs the
existing tier nothing (every other `toHaveText` over a user bubble reads a single-line, single-space text,
where collapsing is a no-op either way) and it did not weaken any assertion, but a spec asserting a
multi-line bubble's text must expect the newlines rather than the collapse.
