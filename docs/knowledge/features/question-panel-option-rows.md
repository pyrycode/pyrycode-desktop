# Question panel — Option rows (#907, live since #912, Other-typing ticks since #1698)

Split out of [Question panel](conversation-shell-question-panel.md) on 2026-09-30 to keep that document
under the size cap. Part of [Conversation shell](conversation-shell.md); see [Question
panel](conversation-shell-question-panel.md) for the panel's chrome, header tabs and step controls that
this section sits beneath.

## Option rows (#907, live since #912)

`question.options.map(…)` inside a new `.question-panel__options` list, between
`.question-panel__question` and the separator, inheriting `.question-panel__box`'s 16px gap. Each row is a
20×20 control (`.question-panel__control`, `box-sizing: border-box`, a 2px `--color-tertiary` ring) beside
a label-over-description text stack, plus a design-mandated Other row rendered last, unconditionally, in
both variants. `multiSelect` is the one prop that changes the control's class — `--radio`
(`border-radius: var(--radius-full)`, since a 10px radius on a 20px box *is* the circle) or `--checkbox`
(`border-radius: 4px`, kept a literal rather than snapped to `--radius-xs` because that snap visibly
over-rounds a 20px control — `.question-panel__cancel`'s "structural geometry" precedent). Everything else
— row geometry, the 8px row gap, the label-over-description stack — is identical between variants; **the
two lines are told apart by font weight alone**, both `--color-on-surface` (M3 label/medium-emphasized 600
for the label over label/medium 500 for the description, read off the Figma variables on `347:6025`) —
dimming the description to a muted/variant colour, the reflex reading of the ticket's own "bright" vs.
"muted" language, would have been an invented fidelity break. An option with `description === ''` draws no
description element at all (a required-`string` field, so `''` is legal traffic, not an absent one) rather
than an empty `<p>` holding a line of height.

**The row's React key is the array index, never `option.label`.** `QuestionOption` carries no `id` —
[Question-batch model](question-batch-model.md) states why: claude's answer protocol selects an option by
its `label`, so minting an id here would grow a field the wire never carries. That leaves `label` looking
like the option's natural key, which is exactly the trap: it is untrusted claude-authored text, and keying
on it is the lookup-path failure `questionBatchStore.ts` names by hand. The options array is claude's own
display order and is never re-keyed, which makes the index the honest identity and keeps every
claude-authored string confined to JSX children — no `key`, `title`, `data-*`, `id`, `name`, memo table, or
log anywhere in the row.

**The controls are native since #912, and controlled.** #907 shipped a childless, presentational `<span>`
precisely because a native radio or checkbox is *checkable* at rest, and mounting one before the picks
store existed would have let a click paint a selection nothing held. #912 supplies that store, so each row
is now a `<label className="question-panel__option">` — the row itself is the click target and supplies
the accessible name from its own visible text — wrapping, in order: a visually hidden native `<input>`
(`.question-panel__input`, the `.composer-status__error-prefix` clip-path recipe, off the tab order for
nothing but reachable by both pointer via the label and keyboard directly), `type` `checkbox` when
`question.multiSelect` else `radio`, `name="question-panel-option"` (a client-owned constant shared by
every control in the panel so a single-select question's rows form one native radio group), `checked`
driven by `selection.optionIndices.includes(index)` and `onChange` calling `onOptionChosen(index)`; then
the pre-existing `.question-panel__control` `<span>`, now `aria-hidden` chrome that draws the design's
Selector child (a filled dot for radio, a tick glyph for checkbox) only when that position is picked, and
nothing when it is not. Driving `checked` off the store rather than letting the DOM hold it is what makes
the control honest: the DOM's checked state is always the store's, on every render, and a click only ever
reaches the store through `onChange`. **The accessible name is the one new sink this markup could have
opened, and it is closed by the implicit `<label>`**: the alternative, `aria-label={option.label}`, would
have put claude-authored text in an attribute, and `aria-labelledby` would additionally have needed a
generated `id` and made the value a DOM lookup key — both closed off by letting the row's own JSX children
supply the name instead.

**The Other row cannot be one implicit `<label>`, and that asymmetry is load-bearing.** A `<label>` binds
to its first labelable descendant, so wrapping the whole row would make every click into the free-text
field toggle the tick. Instead only the control is wrapped, in its own `.question-panel__other-control`
label; that label carries no text, so the tick's accessible name comes from a new client-owned
`QUESTION_OTHER_TICK_COPY = 'Other'` constant passed as `aria-label`. The free-text `<input>` itself is
controlled since #912 — `value={selection.otherText}`, `onChange` calling `onOtherTextChanged` — keeping
its pre-existing `QUESTION_OTHER_PLACEHOLDER_COPY = 'Other. Type something.'` as both `placeholder` and
`aria-label`. **Typing ticks Other, copying mobile's `OtherTextChanged`**:
`onOtherTextChanged` dispatches `otherTextChanged` with the `at` object's `multiSelect` spread in, so every
keystroke sets `otherTicked: true` — single-select also clears the option pick (`optionIndices: []`, the same
result `otherPicked` gives), multi-select leaves ticked options in place, and emptying the text still ticks.
The text itself stays held independently of the tick: un-ticking Other afterwards (a single-select option
pick, or `otherToggled` in multi-select) leaves the text in the box. It is the one string on this panel the
daemon did not author, still bound as a React `value`, React's own escaping, never a raw-markup sink. The
Other row's
control sits inside a taller 20×28 frame, offset 8px down (`.question-panel__control--other`) so it centres
against the field beside it instead of aligning to its top edge.

**Which store arm a gesture becomes is decided in one place, and it is unit-tested.** `optionPickEventFor`
and `otherPickEventFor` (`QuestionPanel.tsx`, exported, pure) each take one object parameter —
`{ multiSelect, questionBatchId, questionIndex, optionIndex? }`, deliberately not positional, since a bare
`boolean` beside two `number`s is the exact boolean-blindness `questionPicksStore`'s named-arm union exists
to avoid — and return the `QuestionPickEvent` the question's shape wants: `optionPicked` (replace) /
`otherPicked` for single-select, `optionToggled` (accumulate) / `otherToggled` for multi-select.
**Choosing the wrong arm for the variant is invisible to `tsc`**, since each pair carries an identical
payload and differs only in the `type` literal — the store is told the behaviour rather than reading
`multiSelect` off the held batch, so this mapping is the one place the distinction can be lost, and being
exported is what lets `QuestionPanel.test.tsx` assert the literal directly. `QuestionPanelSlot` (see
[Question panel](conversation-shell-question-panel.md)) is the caller, closing over `multiSelect`,
`questionBatchId` and the question index so the view itself never sees them. `otherTextChanged` is the one
arm `ConversationScreen.tsx` builds inline rather than through an exported helper — `onOtherTextChanged`
spreads the same `at` object (`{ multiSelect, questionBatchId, questionIndex }`)
`optionPickEventFor`/`otherPickEventFor` close over, so `multiSelect` reaches the reducer the same way for
all three arms; see [Question panel](conversation-shell-question-panel.md) for that call site.

**The Other field's tinted ground follows the file's `rgba()` house rule.** The Figma fill is a raw
`rgba(0,51,85,0.41)`, which is `--color-on-primary` at 41% — and per `.pairing-field::before`'s precedent
in the pairing screen's stylesheet, that belongs on a dedicated `::before` at `opacity: 0.41`, never a bare
`rgba()`/`color-mix()` literal and never an `opacity` on the field itself, which would fade the placeholder
text along with the ground.

**Fixed in #912 — the Other field's `:focus-visible` ring, previously clipped on two edges.**
`.question-panel__option` carries `overflow: hidden` (the row's own bound against a hostile wrapped
string, doubling as the Figma frame's clip), and the field's own border box sits flush against the row's
content edge, so the ring's right and bottom segments — drawn outside the border box by `outline` — used to
fall outside the clip. #907's code review flagged it SHOULD-FIX; #912 lands the fix named there,
`outline-offset: -1px`, drawing the whole ring inside the clip rather than dropping `overflow: hidden`
(kept, since it is the row's own guard).

**#912 also gives every row its own focus ring, on the row rather than the control** — the row is the real
click target now that it is a `<label>`, and the control sits flush against the row's left content edge, so
a ring drawn around the control alone would lose its left segment to the same clip. Reaching the row from
the state of the input inside it needed `:has()`
(`.question-panel__option:has(.question-panel__input:focus-visible)`), which appears nowhere else in this
codebase — its one prior consideration (`.bubble__markdown`'s list rhythm) rejected it for protecting a
distinction that container flattens by intent, not as a blanket ban, and here there was no other way to
reach the ancestor and the renderer is one known Chromium.

**Still deferred — the Other field's placeholder measures 1.78:1 against its ground**, well under WCAG
AA's 4.5:1 for text. The colour is `--color-primary-container`, read correctly off the Figma variable on
`347:6386`; the low contrast is a design fidelity fact, not a builder error, and inventing a brighter colour
to compensate was rejected as a fidelity violation of its own, including by #912. Screen-reader users are
covered by the field's `aria-label`; the exposure is low-vision sighted users reading an unlabelled-looking
field.

**Testing.** `QuestionPanel.test.tsx` renders `QuestionPanelView` from injected fixtures: header/question
placement, the inert two-button row with no `disabled`, the decorative mark and separator, and — the
security-relevant cases — a `<img onerror>`/`<script>` fixture renders escaped with no `<img`/`<script>` in
the markup, and neither string reaches an attribute (`title=`, `data-`). Since the `QuestionPanel.tsx`
module never imports React's `dangerouslySetInnerHTML` path, escaping is structural, not merely tested.
\#906's original `draws no option rows` case is superseded by #907's positive assertions, rewritten rather
than left stale: per-variant control-class counts (options plus the Other row), rows drawn in the held
array's order with their `label`/`description` in the text stack, an empty `description` drawing no
element while a sibling with one still draws it, every control empty at rest with no `checked` anywhere in
the markup, the Other row last carrying an `<input type="text">` whose placeholder and accessible name are
`QUESTION_OTHER_PLACEHOLDER_COPY`, the same escaping assertions extended to `label`/`description`, and two
options sharing an identical `label` and `description` both still drawing — the observable consequence of
index-keying, since a React key isn't itself visible in static markup. #907's inert-posture assertions
(`not.toContain('value=')`, the childless-control regex) are rewritten rather than deleted for #912, since
both asserted the resting posture this slice overturns: a picked option draws its Selector child and no
other row's; the multi variant draws several ticks at once and none for the rest; an empty selection draws
no Selector anywhere; `selection.otherText` reaches the field's `value` and a ticked Other renders beside
ticked option labels in the multi variant; `optionPickEventFor`/`otherPickEventFor` return the arm each
variant wants, closing the transposition gap `tsc` cannot catch; and the accessible-name assertions extend
to the new markup — a row's name comes from its own text, never from an attribute. `composerSlot.test.tsx`
covers `ComposerSlot` and `QuestionPanelSlot` with per-file `createQuestionBatchStore`/`createQuestionPicksStore`
instances bound over `useQuestionBatchStore`/`useQuestionPicksStore` via `vi.mock` (both singletons' server
snapshots are frozen at store *creation*, so seeding either directly would silently assert the initial cell)
— the panel-and-cover pairing, the covered subtree still holding the message box/send control/footer, a
batch for a different conversation or `conversationId={null}` leaving the composer untouched,
`ComposerStatusArea`'s markup never appearing from this container in either state, the first-of-several-
questions draw, and (#912) `QuestionPanelSlot` reading the picks store keyed on `batch.questionBatchId`
rather than `conversationId` — a substitution that would compile clean.

`questionPicksStore.test.ts` covers `otherTextChanged` directly (#1698): single-select typing replaces the
picked option with Other and a later option pick keeps the typed text; multi-select typing ticks Other
beside already-ticked options and `otherToggled` afterwards keeps the text; emptying the text still ticks,
in both shapes; a same-value re-dispatch still returns the same state (`withSelection`'s copy-on-write
guard, unaffected by the always-`true` tick). `e2e/question-picks.spec.ts` and
`e2e/question-answer-continue.spec.ts` both drop the redundant tick-click that used to follow typing, since
typing now ticks the row itself; a click after typing is instead asserted to un-tick it while the text
stays.

**`e2e/question-picks.spec.ts` (#912, new)** is the first question spec in `e2e/` — everything before it
was provable by static render precisely because nothing responded. One `launchPairedApp`, two arcs in one
`test()`, sequenced so the `dismissed` that clears a batch's picks never lands mid-assertion: arc 1 pushes a
single-select batch, asserts nothing is picked on first render, picks one row then a second (the first
clears — replace), types Other text, switches to a second chat via the FAB and back (the pick and the typed
text are both still there), then dismisses; arc 2 pushes a fresh multi-select batch for the same
conversation (every row clear — the fresh-nonce half of the same guarantee `QuestionPanelSlot` gives for
free), ticks two rows then un-ticks one (the other survives — accumulate, the arm-transposition proof the
single arc cannot give), ticks Other beside a ticked option, then dismisses with a half-typed message-box
draft still present throughout — #906's structural draft-survival proof, driven end to end for the first
time. Both variants are driven because neither proves the other, for the same `tsc`-blind-transposition
reason above. State is read through `toBeChecked()` on the real controls *and* through the drawn Selector
child's count, so a store write that never rendered and a render that drew a state the store does not hold
each fail a different half of the pair.

`e2e/permission-modal-answer-paths.spec.ts` adds the temporary-coverage proof: permissions hide a
partly answered questionnaire on its second question, then resolving them restores that question,
both questions' Other text and the earlier pick. Remote batch dismissal restores the original draft.
Role queries and keyboard input/tab checks prove the covered controls are inactive, which static
markup and retained-value assertions alone cannot establish.

**Security review: PASS** (#906 architect self-review, #907 and #912 builder self-review). #906's one
finding — the design's own single-line clamp invites a `title` tooltip, claude-authored text in an
attribute — was fixed before that plan closed and the ban extended to every derived `data-*`. #907 widened
the same boundary from two claude-authored fields (`header`, `question`) to four (plus every option's
`label` and `description`) and raised one finding of its own, fixed before that plan closed too: the option
row's React key is a sink the frame slice never had, and `label` is the *only* identity `QuestionOption`
carries, which makes `key={option.label}` the reflex — fixed by keying on array index instead. #907's
verifier code review raised two SHOULD-FIX items that shipped as known, deferred gaps rather than blocking
fixes — the clipped focus ring (fixed in #912, above) and the sub-AA placeholder contrast (still deferred,
above) — neither a trust-boundary finding.

**#912 moves a claude-authored string from being merely rendered to being the reason a native control
exists, and that motion is the review's real subject.** The one new sink making a control real could have
opened is the accessible name, and it is closed by construction: the row is an implicit `<label>`, so the
name comes from the row's own visible text rather than `aria-label={option.label}` (claude-authored text in
an attribute) or `aria-labelledby` (which would additionally need a generated `id` and turn the value into a
DOM lookup key). Every attribute #912 writes is a client-owned constant (`name`, the Other tick's
`aria-label`) or a number derived from array position — a pick is `optionIndices.includes(index)`, never a
label comparison, so there is no path by which a claude-authored string becomes an identity here. The
slice's other new flow is the operator's own Other text, and it goes the opposite direction: bound into a
controlled `<input value={…}>`, React's own escaping, never a raw-markup sink, and never logged, matching
`questionPicksStore.ts`'s own refusal to log `otherText` or `questionBatchId`. No new IPC channel, no
`window.pyry` dereference anywhere in the slice, no persistence, no async task, no timer and no teardown —
every write is a synchronous `dispatch` from a React event handler.

Otherwise no-findings across all three tickets: no logger call, no comparison beyond the stores' existing
`===` scans, and every claude-authored string is size-bounded by the transport's 256 KiB frame cap, the
panel's own one-line clamp on `question`, and the explicit note (#907, still true after #912) that the
option list has **no** such clamp: rows wrap by design, so a hostile daemon sending many long options can
grow the panel and squeeze that conversation's timeline — **and #912 makes each of those rows a focusable
control, lengthening the tab order along with the panel**, one degree worse in the same respect, still
annoyance rather than escalation. Not defended here (the wrap is the locked design, the total is still
frame-capped, and the exposure stays scoped to one conversation's composer); the option list still has no
scroll container or row cap, the bound #908 was meant to carry and which neither #911 nor #912 inherited as
an acceptance criterion after the split. Out of scope, by design rather than oversight since #906: a daemon
that raises a batch and never dismisses it covers that conversation's composer indefinitely, since this
family draws no expiry (settled 2026-08-31 — the timeout is a daemon matter); through #916 Cancel
dispatched nothing, so an operator with no daemon-side timeout had no exit at all. [Cancel refuses the
batch (#921)](conversation-shell-question-panel.md#cancel-refuses-the-batch-921), closes that gap.
The exposure is bounded to the one
conversation, and a `reconnected` arm still clears every held batch on each handshake. A malicious relay is
content-blind and on-path only, so it can withhold a batch or its dismissal but cannot reach picks state
directly.
