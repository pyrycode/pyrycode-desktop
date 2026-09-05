# #1063 — drop the pale focus ring around the message box

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.composer__row:has(.composer__input:focus-visible)`
  — the rule this ticket deletes; the block above it carries the `:has()`-over-`:focus-within` argument that
  must survive the deletion.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__input` — its `outline: none` is
  deliberately **kept**; dropping it hands the box back the UA ring, the opposite of the ask.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__send:focus-visible` — the ring that
  must still paint after this ticket, and the nearest thing to a regression detector for "only the one rule
  went".
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row__chip--toggle:focus-visible`,
  `.composer--drop-target`, `.question-panel__option:has(.question-panel__input:focus-visible)` — the three
  live comments that cite the deleted rule. All three are in this one file.
- `e2e/composer-message-box.spec.ts` → the first `test()` block's section 6 — the focus checkpoint that
  inverts rather than disappears, and the `#1056` note below the block that forbids editing that block.
- `e2e/attachment-file-row.spec.ts` → its `:focus-visible` assertion — the shipped technique for making
  `:focus-visible` match in this tier (*"the last interaction above was a key press"*), which the send-ring
  assertion copies.
- `docs/knowledge/features/conversation-shell-composer-message-box.md` § the focus ring, and
  `composer-attach.md` § `.composer--drop-target` — both record the ring as shipped. **The documentation
  phase's to fold, not this ticket's** (the ticket says so explicitly); named here so the reading list shows
  they were seen and deliberately left.
- Codegraph was not consulted: every `mcp__codegraph__*` call in this repo fails with
  *"CodeGraph not initialized"*. Grep and Read throughout.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6635

`Input large` is a flat rounded box — a `rgba(0, 51, 85, 0.41)` ground at a 6px radius, 52px tall, holding a
body-medium text run inset 16px from the left and the 48px `circle-chevron-up` control at its right end.
**It has no edge of any kind.** The node's `Active indicator` child (`347:6441`) is hidden, and the proof is
in the design context rather than only in the layer list: the emitted node tree for `347:6635` contains the
`Text field` wrapper, the text run and the `Button`, and no indicator node at all. A hidden layer is a
drawn decision, not an omission — the drawing gives the focused message box no visible indicator of its own,
and that is the fact this ticket implements.

## Context

`.composer__row:has(.composer__input:focus-visible)` paints `outline: 1px solid var(--color-outline)` —
`#8c9199`, a pale grey — around the whole 52px box whenever the textarea holds focus. It is #951's own
addition rather than a design value that drifted: #951 moved a ring that used to sit on the textarea onto
the box, because at 28px inside a 52px box the textarea's own outline drew a bare rectangle floating inside
the rounded corner. Operator call of 2026-09-04: drop it. The blinking caret is the focus signal.

**The accessibility trade, stated rather than buried.** `conversation.css` declares
`outline: 1px solid var(--color-outline)` **22 times**. It is this file's focus convention and this ticket
removes one of them, which makes the message box the most prominent focusable thing in the app with no
visible focus ring. That is defensible only because of what the box is. A text field's caret is a focus
indicator in its own right, and it is the reason WCAG's focus-visible requirement is normally read as
satisfied for text inputs — the caret appears on focus, is absent without it, and is the browser's own
native indicator. The trade would **not** be defensible on a button, and this ticket is not licence to drop
the other 21; `.composer__send:focus-visible` sits four rules below the deleted one and keeps its ring.

A ringless text field already ships here — `.create-folder__input` declares `outline: none` and paints no
ring of its own — so the shape is not unprecedented. The message box is far more prominent, which is why the
trade is written down here and why the caret gets a checkpoint of its own rather than being assumed.

**The replacement indicator is the caret, and this plan names it as such.** `caret-color` is set nowhere in
this stylesheet, so the caret is the UA's and inherits `.composer__input`'s `color` (`--color-on-surface`) —
visible against the box's ground by construction rather than by declaration. Nothing in the tree may hide it
without this ticket's checkpoint reddening.

**No ADR.** This is a fidelity fix against a hidden layer plus one stated trade; the trade belongs in the
package overview the documentation phase folds, not in a decision record.

## Design

One rule is deleted, one declaration is deliberately kept, four comments are re-pointed. No markup, no
TypeScript, no tokens, no new selectors.

**1. Delete `.composer__row:has(.composer__input:focus-visible)`** and its `outline` declaration, the box's
entire focus indicator.

**2. Keep `.composer__input`'s `outline: none`.** Load-bearing, and the reason is worth a word in the
retirement note: without it the UA draws its own focus ring on the textarea, which is a ring the design does
not have, drawn on the element #951 already established is the wrong one to draw it on.

**3. Replace the deleted rule's comment with a retirement note in this file's own idiom** — `#968 retired
.composer__hint`, `#962 retired the collapsed status row`, and the four status bubbles that went with #967
are the shipped shape: record the retirement in place rather than leaving a hole. The note must carry
forward, because the next person's instinct will be to restore the ring:

- Why it went: the drawing's `Active indicator` is hidden, plus the operator call.
- Why the caret is enough here and would not be on a button — the trade above, in two sentences.
- The `:has()`-over-`:focus-within` argument, preserved verbatim in substance: `:focus-within` also matches
  while the send control holds focus, stacking a box ring on top of `.composer__send:focus-visible`'s own —
  two rings for one focused control. **This is the reason the note exists.** A restore that reaches for
  `:focus-within` would be worse than what was deleted, and the argument is not recoverable from the diff.
- That `.composer__input`'s `outline: none` stays, and why.
- Where the absence is pinned, by spec filename.

**4. Re-point the three live citations.** All three are in `conversation.css`; leaving them is a comment
describing a rule that is not there.

- `.tool-row__chip--toggle:focus-visible` (#1102) cites the composer rule as the precedent for
  `outline-offset: -1px`. **That citation is already wrong on `main`** — the composer focus rule carries no
  `outline-offset` at all. Re-point to `.composer--drop-target`, which is the rule that actually does, and
  note that the rule it used to name is retired. The same sentence also names `.composer__row--drop`'s note,
  a class that does not exist either; **out of scope, left untouched** per the ticket.
- `.composer--drop-target` (#890) cites the composer rule twice: as the shipped no-reflow precedent, and as
  the twin its `--color-primary` avoids "during a drag over a composer whose textarea holds focus". After
  this ticket there is no twin. The no-reflow argument survives on its own merits and keeps its force —
  `outline` does not participate in layout, `border` does, and the composer would reflow the whole
  conversation column by 2px on every dragover — so it is restated standing on itself rather than borrowing
  a precedent that is gone. The twin paragraph is restated as the file's general `--color-outline` focus
  idiom rather than as one specific neighbouring ring.
- `.question-panel__option:has(.question-panel__input:focus-visible)` (#912) says #951 took it as the
  precedent for the message box's ring, "so the selector now has two consumers and the same argument twice".
  Back to one consumer; the `:has()` argument it makes is now made once, here, and that is worth saying
  because it is also the argument the retirement note above preserves.

## State + concurrency model

None. This ticket adds no state, no store slice, no async work, no subscription and no teardown path. The
only state involved is the UA's own focus state, which the deleted selector read and nothing now reads.

## Error handling

None. No I/O, no IPC, no parsing, no failure mode. The one runtime risk is a *silent* one — a rule that
still paints an edge in place of the deleted outline (a `border`, a `box-shadow`) — and that is answered by
assertion rather than by handling: the focus checkpoint asserts the absence of each, not merely of
`outline`.

## Testing strategy

**Every assertion is a Playwright one in the default fake-transport tier.** `vitest.config.ts` runs the
`node` environment — no layout, no CSSOM, no `getComputedStyle` — so renderer unit tests cannot see any of
this and none are added. Nothing here needs a live claude.

**`e2e/composer-message-box.spec.ts` section 6 is rewritten, not deleted.** It is exactly the proof this
ticket wants, read the other way: today it asserts the box paints `solid` / `1px` / `--color-outline` and the
input paints nothing; after the change the box paints nothing and the input still paints nothing. Deleting
the checkpoint would leave the ring's absence unpinned and free to drift back. Rewritten, it asserts:

- **AC1** — with the input focused, the box's computed `outlineStyle` is `none` and the input's own is
  `none`. And no edge appears in its place: the box's `borderStyle` and `boxShadow` are asserted too, since
  "nothing paints a ring" is the criterion and `outline` is only one way to draw one.
- **AC2** — the caret, written as a **negative** assertion on purpose. `caret-color` is set nowhere in this
  stylesheet, so `getComputedStyle(el).caretColor` computes to the keyword `auto` and there is no rgb to
  compare against; the checkpoint asserts it is neither `transparent` nor `rgba(0, 0, 0, 0)`, paired with
  `document.activeElement === textarea`. It is deliberately **not** compared against `--color-on-surface`.
  No spec can see a caret blink. What this pins is that a later ticket cannot silently hide the caret and
  leave the box with no focus indicator at all — which is the whole justification for removing the ring.
- **AC3's no-reflow half** — the box's height and border-radius are re-read while focused and asserted
  identical to the resting `BOX_HEIGHT_PX` / `BOX_RADIUS_PX` the same block already captured, then re-read
  after blur. An `outline` never reflowed anything, but the criterion is that nothing *replaced* it with
  something that does, and a `border` added in its place is precisely what would.
- **AC3's typed-text half is already covered** by the second `test()` block, which types multi-line drafts
  into the box and measures it growing. Not duplicated here.
- **AC4's first half** — `.composer__send:focus-visible` still paints `solid` / `1px` / `--color-outline`,
  which is the real detector for "the deletion was surgical". `:focus-visible` matches after a **key press**
  in this tier, not reliably after a programmatic `.focus()` on a button —
  `e2e/attachment-file-row.spec.ts` states that rule and this assertion copies it, tabbing from the focused
  textarea rather than calling `.focus()`.

**AC4's second half — the "21 times" count — is verified at review time and deliberately not shipped as a
test.** It is a source-text fact, not a runtime one: an e2e spec would have to read the stylesheet off disk
to assert it, and the resulting magic number reddens for any future ticket that adds a focus ring anywhere
in a 5000-line file — a test that fails for reasons unrelated to what it claims to protect. Counted by hand
instead: 22 on `34d23cd`, 21 after, and the count is stated in the PR body. The half of AC4 that has a real
runtime detector gets one, above.

**The `#1056` note below the block forbids the edit this ticket requires, and is updated with the rest.** It
says the first `test()` block "stays UNEDITED: its whole contract is that the resting render is byte-stable,
and an edit to it would be the thing it exists to catch". Section 6 lives inside that block. That
instruction was written about the resting-*geometry* checkpoints — which this ticket does not touch, and
which section 6's own no-reflow assertions now re-prove under focus — and not about the focus checkpoint.
The note is amended in place to say so, or the next reader reads this edit as a violation of it. The section
comment's opener also cites "AC3's focus clause", which is #951's AC3 and not this ticket's; restated.

**Section 6 mutates no state**, which keeps the block's stated invariant ("nothing here mutates state, so
every checkpoint reads the same first paint") true: it moves focus and reads computed style, and types
nothing.

**Verification gate:** `npm run build`, plus `npx playwright test e2e/composer-message-box.spec.ts` after
the build, since the fixture launches the built app from `out/`. RED first — the rewritten assertions run
against the un-deleted rule and must fail on the box's outline before the stylesheet changes.

## Open questions

1. **Does Tab from the focused textarea land on `.composer__send`?** `canSend` derives from
   `composerAvailability(status)` — the connection status, not the draft — so the control is enabled on a
   paired fake launch and is tabbable. Whether it is the *next* tabbable element (the attach control and the
   footer controls are also in the composer) is settled empirically in Phase B. If Tab lands elsewhere, the
   fallback is to Tab to the send control by name and assert on it there; the key press is the part that
   matters for `:focus-visible`, not the number of presses.
2. **Does `.composer__row` carry a `box-shadow` or `border` at rest that the new assertions would trip on?**
   The package overview records the row gained no border; the assertions are written as `none` and the RED
   run confirms the resting values before the deletion lands.

Both are resolved in Phase B and any resolution that changes the design above is recorded under
`## Revisions`.

## Revisions

### 2026-09-05 — Phase B

**Both open questions resolved as the design assumed; nothing above changed.**

1. **Tab from the focused textarea lands on `.composer__send`.** Asserted directly
   (`el === document.activeElement` on the control) rather than taken on trust, so the fallback in the
   question was not needed and a future change to the composer's tab order reddens this rather than
   silently making the send-ring assertion read a different element.
2. **`.composer__row` carries no border and no `box-shadow`** at rest or under focus. The `none`
   assertions hold as written.

**One finding the plan did not anticipate, and it changes an assertion's shape rather than the design.**
The caret checkpoint was specified as two negative arms — not `transparent`, not `rgba(0, 0, 0, 0)`. Proved
by deletion (`caret-color: transparent` added to `.composer__input`, rebuilt, run): the block reddens on the
**rgba arm only**, because Chromium serialises the keyword to `rgba(0, 0, 0, 0)` and the `'transparent'` arm
therefore never fires. Both arms are kept — the second costs nothing and catches an engine that serialises
the keyword — but the spec now names which one is the detector, so a later edit cannot trim the working half
and leave a pair of assertions that no longer prove the caret is visible. This is the ticket's load-bearing
new assertion (the caret is the entire justification for removing the ring), which is why it was proved
rather than assumed.
