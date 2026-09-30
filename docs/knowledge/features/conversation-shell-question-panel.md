# Question panel (#906, option rows since #907, live since #912, header tabs since #915, step controls since #916, Cancel sends since #921, Continue sends since #922)

Split out of [Conversation shell — modals](conversation-shell-modals.md) on 2026-09-02 to keep that
document under the size cap. Part of [Conversation shell](conversation-shell.md); see that document for
what the screen does, its edge cases and its links. See [Permission
panel](conversation-shell-permission-modal.md) for the permission/trust variant in the same input area.

The render vertical's frame slice, over the model and bridge documented in [Question-batch
model](question-batch-model.md): `questionBatchStore` (#899) held the batches and `useQuestionBridge`
(#900) filled it, but nothing mounted the hook or read the store — #906 closes both gaps, the same shape
[Permission modal](conversation-shell-permission-modal.md#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511)
above took for the modal vertical (#223 → #224). #906 drew the panel's chrome only: the title row, the
bordered box with the question's own text, a separator, and an inert Cancel/Continue row. #907 filled the
band between the question's text and the separator with the option rows themselves — still drawing only,
nothing responds to a click. #908, meant to land the picks and the answer path together, was split into
[#911](https://github.com/pyrycode/pyrycode-desktop/issues/911) (the picks store) and this ticket's sibling
[#912](https://github.com/pyrycode/pyrycode-desktop/issues/912); #908 itself closed as not planned, never
shipping anything. #912 wires the panel to #911's store: the option rows and the Other field respond to a
click or a keystroke, and the picks survive a chat switch. #915 fills the title row with one tab per
question the batch carries and lets a click choose which question the box draws — the batch's own header
text, on a control keyed by array position rather than by that text, the failure mode `questionBatches.ts`
and `WireQuestion`'s docblock each name by hand. #916 puts the same jump on the action row: a Previous button beside the header tabs' own jump, and a trailing button that reads Next until the operator reaches the last question. #921 gives Cancel its send, and #922 gives the same trailing button its second role's send.

**`useQuestionBridge()` mounts in `App.tsx`**, beside `useModalBridge`, unconditional and app-lifetime —
not screen-scoped, because a batch is raised against a conversation the operator may not have open, the
same reasoning `ConversationActivityData` already carries in that file.

## Composer placement

**`ComposerSlot({ conversationId, phase, onMessageSent, statusArea })`** (`ConversationScreen.tsx`, exported)
selects the open chat's questionnaire and permission presence. Permission takes precedence over a
waiting questionnaire; either request type covers the normal composer. With `conversationId === null`,
neither panel appears. Other chats' requests never cover this chat's input or force navigation.

The panels render through `Composer`'s `beforeComposer` seam, after the status area. The questionnaire's
model footer shares its wrapper so it is hidden along with the question during permission coverage:

```ts
const batch = useQuestionBatchStore((s) =>
  conversationId === null ? undefined : selectBatchFor(conversationId)(s)
)
const hasPermission = useModalStore((s) =>
  conversationId !== null && selectHasOutstandingFor(conversationId)(s)
)
return (
  <Composer
    phase={phase} onMessageSent={onMessageSent} covered={hasPermission || batch !== undefined}
    beforeComposer={(sendText) => (
      <>
        {statusArea?.(sendText)}
        <PermissionModal conversationId={conversationId} />
        {batch && (
          <div hidden={hasPermission}>
            <QuestionPanelSlot key={batch.questionBatchId} batch={batch} />
            <div className="composer__footer">
              <ComposerModelMenu conversationId={conversationId} />
            </div>
          </div>
        )}
      </>
    )}
  />
)
```

The wrapper stays mounted for a still-outstanding batch while permission is visible. Its picks and
Other text remain in the picks store, and `QuestionPanelSlot` retains its local active question.
After the last current-chat permission resolves, the questionnaire resumes at that question; if the
batch has also ended, the composer returns with its typed draft. This temporary coverage does not
extend state across chat switches: existing pane remounts still reset the active question and composer
draft, while questionnaire picks survive in their separate store.

The wrapper's native `hidden` removes the questionnaire, its Other field, navigation and model menu
from layout, keyboard focus and the accessibility tree. It has no author `display` override, so the
native rule suffices. Conditional unmounting would lose the active question; `aria-hidden` alone would
leave invisible controls keyboard-active. Rejection feedback is outside this wrapper and never sets
`covered`; see [Permission panel — Rejection surface](conversation-shell-permission-modal.md#rejection-surface-249).

`conversationId` arrives as a prop off `activeConversation?.id ?? null` — the `BackgroundTaskPanel` idiom
— so a batch arriving re-renders this leaf, never the whole screen. `selectBatchFor` is called inline with
no `useMemo`: `useStore` compares the selector's *result* under `Object.is`, and the held batch comes back
by reference, per the store's own ruling against memoising anything claude-authored into a lookup path.
`ComposerSlot` itself never indexes into `batch.questions` any more (#912) — see `QuestionPanelSlot` below.

**The `key={batch.questionBatchId}` is #915's, and it is a remount instruction, not decoration.** The slot
holds the operator's current tab in component state (below) and stays mounted while *any* batch is up, so a
different batch replacing the panel for this conversation would otherwise inherit the retired batch's
position into a question list that never had it. The nonce as `key` makes React discard and rebuild the
leaf, which reseeds that state to the first question — React's own prescribed reset, one level above #670's
same shape. React strips `key` from props, so the value reaches no attribute, no DOM node and no log. A
same-nonce re-delivery (the daemon re-sending `question_shown` for a batch still outstanding) leaves this key
unchanged by design — that case is the clamp's job, inside `QuestionPanelSlot`, not this key's.

**`QuestionPanelSlot({ batch })`** (#912, header tabs since #915, `ConversationScreen.tsx`, exported) is a
separate leaf mounted only on the `batch &&` branch, and it is the picks store's only reader:

```ts
const [jumpedTo, setJumpedTo] = useState(FIRST_QUESTION_INDEX)
const activeIndex = Math.min(jumpedTo, batch.questions.length - 1)
const question = batch.questions[activeIndex]
const selection = useQuestionPicksStore(
  selectQuestionSelection(batch.questionBatchId, activeIndex)
)
const dispatch = questionPicksStore.getState().dispatch
```

Hooks cannot be conditional, so folding this read into `ComposerSlot` would need a sentinel batch id for
the no-batch case and would subscribe the whole composer to pick traffic — every Other-field keystroke
re-rendering the message box it is covering. A leaf that exists only while the panel is up needs neither,
and keeps a pick re-rendering the panel alone. **The key is `batch.questionBatchId`, never
`conversationId`** — a substitution that would compile clean. The nonce is what makes a fresh batch
replacing a dismissed one (same conversation) read a fresh empty selection with no clearing effect to get
right and no stale pick reachable, and, since #915, a fresh first question too (the `key` on this leaf,
above); keyed on the conversation, the new batch would inherit the old one's picks and the old one's tab.
`dispatch` is read off the store rather than through a hook, since it is a stable function on a singleton
and subscribing to it would buy nothing. `reconnected` is not dispatched here — `questionBridge` drives it
from the transport's own (re)handshake, which this leaf cannot see. `dismissed` now is, since [Cancel
refuses the batch (#921)](question-panel-cancel-refusal.md): this slot is the family's first local
raiser of it, going through the same picks-first order the bridge uses so the two paths cannot drift.

**`jumpedTo` is #915's, and `activeIndex`'s clamp is a crash guard, not tidiness.** `jumpedTo` is
panel-local `useState`, deliberately not a new arm on the picks store: what must survive a chat switch is
the picks, and they already do, because they live outside the pane `PairedShell` keys on the conversation id
(#670) — so this leaf remounts on a switch and reopens on the first question, which is intended rather than
a gap, and putting the index in the store instead would widen its event union and every clearing arm for
nothing observable. `jumpedTo` and `batch.questions` are two independent pieces of state, though: a
same-nonce `question_shown` re-delivery replaces the held batch **in place** (`reduceQuestionBatches`'
`shown` arm, latest wins), so the `key` above does not change, this leaf does not remount, and an operator
sitting past the end of a shorter re-delivered list would read `batch.questions[jumpedTo]` as `undefined` and
throw out of the render — on a frame the daemon controls and the reducer explicitly supports. `activeIndex =
Math.min(jumpedTo, batch.questions.length - 1)` closes that, and is computed **once** and read **twice** —
the question and the picks key — which is `FIRST_QUESTION_INDEX`'s old two-places warning in its new home: a
silent disagreement between those two reads would render one question's rows against another's selection. A
`?? questions[0]` fallback would look like the same fix and be the wrong one, for that reason.
`batch.questions` is never empty (`reduceQuestionBatches`' guard sits before the match, so `[]` never reaches
`outstanding`), so the clamp always yields a valid position.

**`Composer` gained a required `covered: boolean` prop**, rendering `<div className="composer"
hidden={covered}>`. The native `hidden` attribute is the whole mechanism — one attribute that hides the
subtree, drops it from the tab order and drops it from the accessibility tree, while leaving every element
mounted, so the operator's half-typed draft (`Composer`'s own `useState`) survives either request type. A
conditional render would discard the draft; `aria-hidden` alone would leave a focusable invisible textarea
whose Enter still sends. `.composer__row` and `.composer__footer` are children of `.composer`, so the one
attribute takes the send/stop control and the footer menus with it — there is no second element to hide
and no disabled state to draw for either. `ComposerStatusArea` is `.composer`'s **sibling**, not a
descendant, and stays visible and untouched throughout.

**`conversation.css` needed an explicit `.composer[hidden] { display: none }`.** The UA stylesheet's
`[hidden] { display: none }` loses outright to the author-level `.composer { display: flex }` regardless
of specificity, so without this rule the attribute is a no-op for layout — the composer keeps painting
under the panel — and only its accessibility half works, silently, which is the trap: it looks fine on
screen and is broken for a keyboard.

**`QuestionPanelView({ questions, activeIndex, selection, onQuestionSelected, onOptionChosen, onOtherChosen, onOtherTextChanged })`**
(`QuestionPanel.tsx`) is the pure, exported view — the #224 split, testable by `renderToStaticMarkup` from
injected fixtures. Through #912 it took a single `question`, "by design" — its own docblock said "choosing
which is the container's job, so this view has no index to get wrong." #915 is what gives it the list and a
position, widening that shape rather than violating the note: the title row needs every header at once, and
the box needs exactly one of them, so `question = questions[activeIndex]` is read **once**, inside the view,
so the tabs and the box cannot point at different questions — `QuestionPanelSlot` (above) computes the same
`activeIndex` once and uses it as the picks key too. `selection: QuestionSelection` and the three #912
callbacks stay unchanged in shape; the view stays variant-neutral (single-select replace and multi-select
accumulate are one gesture from its side) and holds no `multiSelect` branch that could pick the wrong store
arm — see [Question panel — Option rows](question-panel-option-rows.md) for where that choice is made — and neither callback carries a question index,
even now that the view knows one: which question a pick is recorded against is still the container's single
read. `question.header` and `question.question` are claude-authored and render as plain React children
only, auto-escaped, never `dangerouslySetInnerHTML`. **No `title` attribute on the clamped question text** —
the reflex accompaniment to a single-line ellipsis clamp, and the one trap the component invites, since it
would put untrusted text into an attribute, the ban `questionBatchStore.ts` states by name. No `data-*`
derived from `header`, `question`, or the nonce `questionBatchId` either, which this slice never reads. The
title row draws every question's header as a tab — see § Header tabs below — using the already-shipped
`PyryMark` at `width={14} height={16}`, the composer status row's call verbatim, beside them. Cancel and
Continue are both `<button type="button">`; Cancel is disabled while its host is unavailable. Through #916 neither carried an `onClick` either; since
[#921](question-panel-cancel-refusal.md) Cancel sends, and since
[#922](question-panel-continue-answer.md) Continue does too. Final Continue requires both a complete
answer and host availability; local navigation and editing remain usable. See the response sections below.

**Colours came from the Figma variables on node `347:6913`, never the generated fallbacks** (which print
the light scheme, per `tokens.css`'s standing warning): Tertiary, On Background, Primary Container,
Primary, Background and On Primary resolve onto the existing `--color-tertiary`/`--color-on-surface`/
`--color-primary-container`/`--color-primary`/`--color-surface`/`--color-on-primary` tokens, since M3 dark
defines Background = Surface. Two new tokens, `--text-body-medium-weight-emphasized` and
`--text-body-small-weight-emphasized` (both `500`), were minted for the question text and the button
labels rather than a `font-weight: 500` literal at the call site.

**The panel paints no ground of its own since #1099**, exactly as `.composer` no longer does. Its
stylesheet comment had tied its `--color-surface` ground to the composer's so the slot would not change
when a question replaced the message box; once #1058 made the pane a card and #1099 dropped the composer's
paint, the tie pointed the other way and the panel's paint went with it, or a clarifying question would
have brought the flat rectangle back for as long as it was on screen. The padding it shares with
`.composer` is unchanged. `e2e/question-answer-continue.spec.ts` reads the panel's computed background as
transparent. See [Composer message box § no background](conversation-shell-composer-message-box.md).

## Header tabs (#915)

The title row (`347:6829`) went from one static `<span>` per #906 to `questions.map(…)` inside the same
`.question-panel__labels`, and count is what decides the element: `questions.length === 1` still draws
`<span className="question-panel__label">{questions[0].header}</span>` — byte-identical to #906's markup, so
the one-question batch is unchanged by construction — and two or more draws every header, the active one
included, as `<button type="button">`. AC4 reads as an affordance requirement, not only a paint one: with
nowhere to jump, a focusable control that re-selects the question already on screen would be a new tab stop
for no gesture, so the single-question case stays inert rather than becoming a one-item button row.

**Keyed by array position, never by `header`.** `header` is claude-authored, and a tab keyed on it is the
lookup-path failure `questionBatches.ts` and `WireQuestion`'s docblock each name by hand as this family's
likeliest mistake — a tab row is where it is reached for the first time, one level above the option rows'
same reasoning. The array is claude's own order and is never re-keyed, so the index is the honest identity;
two byte-identical headers still draw two tabs. A tab's accessible name is its own visible text — no
`aria-label`, no `aria-labelledby` (which would need a generated `id` and turn the value into a DOM lookup
key), no `title`, no `data-*` — keeping `header` on the same React-children path the option rows already put
it on. A `<button>`, never an `<a href>`: a link is the URL sink these strings must never reach.

**Active vs inactive is `aria-current`, not colour alone.** The active tab carries `aria-current="true"`;
`undefined` — never `"false"` — on every other one, the `ComposerOptionsPanel`/`RunConfigSections` idiom, so
the design's colour-only state difference (`--color-tertiary` active, `--color-primary-container` inactive)
is also non-visual. `QUESTION_TAB_CLASS = 'question-panel__label question-panel__label--tab'` carries the
shipped Active typography and colour for both states; `--inactive` appends the one new colour. No
`role="tablist"`/`"tab"`: a conforming tab widget needs `aria-controls` pointing at the panel's `id` — a
generated DOM id, in a component whose test asserts none reaches the markup — plus a roving tabindex and an
arrow-key contract. Plain buttons plus `aria-current` give the same jump affordance without minting any of
that.

**CSS.** `.question-panel__labels` itself needed no change — it already wrapped at the design's 8px row /
16px column rhythm, drawn for a five-slot row that had only ever held one. `.question-panel__label--tab` is
the `.conversation__unpair` bare-text-button recipe minus its pill (no padding, no border, transparent
ground, `cursor: pointer`, `font-family: var(--font-sans)`, `text-align: left`) plus the repo's
`:focus-visible { outline: 1px solid var(--color-outline) }`; `.question-panel__label--inactive` sets
`color: var(--color-primary-container)` and nothing else, the only new colour this slice mints. One
deliberate divergence from the generated Figma code: its slots are `white-space: nowrap`, dropped here — the
shipped `word-break: break-word` on `.question-panel__label` is kept instead, since an unbounded hostile
header under `nowrap` would push the row's width out; `word-break` holds the layout while still matching the
mock for any ordinary header.

**Two in-repo comments had misplaced Previous into this row** — one here in `QuestionPanel.tsx`, one in
`conversation.css` — both written against #906's single-question instance and both wrong once checked against
Figma on 2026-09-02: `347:6829` holds five `Question label` instances and no button at all. Previous is the
middle button of the Actions row (`347:6657`) — see § Step controls below, which is where #916 built it;
both comments were corrected in this slice.

**Concurrency was the one security finding, MUST-FIX on the first pass.** `jumpedTo`/`activeIndex` is
component state, `batch.questions` is store state, and they move independently; the fix is the `key` +
clamp pair described under `QuestionPanelSlot` above, driven in Playwright (a same-nonce re-delivery
shortening the list while the operator sits on the last question) rather than left to inspection, since a
static render can never leave the seeded index. Everything else reviewed clean: no new IPC surface, every tab
is `type="button"` matching Cancel/Continue so none can act as a submit control, and nothing in this family
logs — a "which tab did we draw?" diagnostic would be the one line putting the nonce and claude's text in a
sink together. **Accepted, not fixed:** the row's render cost went from O(1) (one question, whatever the
batch held) to O(N) tabs, so a hostile daemon inside the session can make the row as tall as the frame cap
(`MAX_FRAME_BYTES`) allows; truncating would violate AC1's "do not cap," so `word-break: break-word` — closing
the one geometry escape a single header could still cause — is the mitigation taken instead of a count limit.

**Testing.** `QuestionPanel.test.tsx` server-renders the widened view from injected fixtures: one tab per
question in batch order carrying each `header`; exactly one `aria-current="true"` and the rest carrying none;
a non-zero `activeIndex` drawing that question's own text, options and control variant; the one-question
batch drawing a single `<span>` with no `<button>` and no `--inactive` anywhere; two byte-identical headers
drawing two tabs; and the existing escaping/no-attribute assertions extended to the multi-tab render.
`composerSlot.test.tsx` keeps its first-question first-paint assertion and gains a tab-per-question one.
`e2e/question-picks.spec.ts` gained a third arc unreachable from a static render: a two-question batch (Q1
single-select, Q2 multi-select) — pick in Q1, click Q2's tab, see its own text and checkbox rows, tick and
type there, jump back and find Q1's radio pick and Other text intact, forward again and find Q2's intact —
then a same-nonce re-delivery carrying one question while the operator sits on Q2, proving the clamp: the
panel keeps standing, now under a single non-button label. The stale-DOM-`checked` question the architecture
doc left open **did not reproduce**: both directions of arc 3 read their own store state on every hop, so no
`key` was added to the options list, which would have defended a failure mode that never occurred. Arcs 1 and
2 gained one assertion each that the one-question row holds no button.

## Step controls (#916)

The Actions row (`347:6657`) grew the middle button Figma always drew but the single-question instance
hides: **`QuestionPanelView`** derives two booleans from state it already held since #915 — `canStepBack =
activeIndex > 0` and `isLastQuestion = activeIndex === questions.length - 1` — and renders Cancel (unchanged,
still inert), Previous, then the trailing button, in that order. **No prop and no signature changed.**
Stepping is the header tabs' own `onQuestionSelected(index)` callback fired with a neighbouring index, so a
Previous or Next click is indistinguishable from a tab click one hop away as far as `QuestionPanelSlot` and
the picks store are concerned — picks survive stepping for the same reason they survive a jump.

**Previous is absent on the first question, never `disabled`** — the header tabs' own call one row up, for
the same reason: with nowhere to step back to, a focusable control is a new tab stop for no gesture, and it
is what keeps a one-question batch's row byte-identical to what #906 shipped. `activeIndex - 1` can never go
negative *because* of this render condition, so no `Math.max(0, …)` guards it; the container's own
`Math.min(jumpedTo, questions.length - 1)` clamp (`QuestionPanelSlot`, unedited by this slice) still owns the
other end. Neither handler can produce a state the other's guard would need to catch.

**The trailing button is one element whose child and `onClick` vary, never two branched elements.** Through
\#916 it read `QUESTION_NEXT_COPY` with a handler on every question but the last, and `QUESTION_CONTINUE_COPY`
with no handler at all on the last — inert-until-#853 by construction rather than by care. Verified in code
review: the three action-row slots are a static array, so the trailing button always sits at the same child
index regardless of whether Previous's slot is `null` or a button, and React matches it there across renders
by that position — it is genuinely never remounted when Previous appears or disappears. **[#922](
question-panel-continue-answer.md) gave the Continue role its handler and its one `disabled` attribute** —
see that document for the gate, which is a conjunction with the Continue role precisely so this element's
Next role is never disabled. The one real focus consequence, confirmed in review and left open at the time
for #922 alongside the adjacent hazard it already owned (the trailing label swapping under a stationary
keyboard focus, unchanged by #922): Previous *itself* unmounts on its own activation — stepping from the
second question to the first with the keyboard removes the just-activated button, dropping focus to
`<body>`. That is the direct, correct consequence of "absent, not disabled," not a bug to fix.

**CSS joined two existing selector lists rather than minting a treatment.** Read against `347:6888` on
2026-09-02 (and independently re-confirmed by the verifier's own `get_variable_defs` read — byte-identical
tokens), Previous carries Cancel's treatment with no property changed: `Schemes/Background` fill, a 1px
`Schemes/Primary` border, `Schemes/Primary` text, 16px/7px padding. Through #963 that meant
`.question-panel__previous` joined `.question-panel__cancel, .question-panel__continue` for the shared
type/geometry rule and joined `.question-panel__cancel` alone for the outlined fill/border/padding rule —
a separate *class* from Cancel only so the markup does not name a Previous button after a different
action, not a separate *rule*.

**[#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) lifted the shared type/geometry half out
of that three-selector list into a `.button-small` base class**, on its second consumer — the composer
status row's new actionable-error button wants the same reset, corner, nowrap and `flex: 0 0 auto`, and
this repo's own "One consumer is not a pattern" ruling (at `.composer__actions`) is what triggers an
extraction on the second one rather than a third selector on this list. See [Conversation shell — composer
§ Actionable-error button](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963)
for the class itself. All three of this panel's buttons now wear `button-small` *in their `className`*
alongside their own class (`class="button-small question-panel__cancel"`, etc.) — an ordinary two-class
BEM mix, not a rename — and `QuestionPanel.test.tsx`'s exact-string markup assertion on Cancel moved with
it. The outlined fill/border/padding rule below, joining `.question-panel__previous` to
`.question-panel__cancel` alone, is untouched: padding cannot live in the shared base class, since the
outlined pair's 7px is a border-box compensation the filled variant must not inherit.
**`.question-panel__continue` keeps its name even though the copy on it now usually reads Next** — the class
names the design's filled treatment slot (`347:6692`), which is what stays constant; a rename would touch
two call sites (the component and the e2e locator) to buy nothing observable, and both the stylesheet and the
component say so for the next reader whose reflex is to rename it.

**Testing.** `QuestionPanel.test.tsx` server-renders `QuestionPanelView` from injected fixtures at each index
of a three-question batch — the *only* place the all-three-visible state is reachable: a two-question
Playwright arc has no question with both a previous and a next. Cases cover a middle question (Cancel,
Previous, trailing Next, in that document order, all three present, no `disabled` anywhere), the first
question (no Previous, trailing reads Next), the last question (Previous present, trailing reads Continue, no
Next copy anywhere), a one-question batch (the shipped two-button row exactly, byte-identical to #906), and
the no-attribute sentinel re-run at a stepping index. `e2e/question-picks.spec.ts` extends arc 3 (#915's
two-question drive): standing on the last question, Previous is visible and the trailing button reads
Continue with no Next reachable; clicking Previous draws the first question, moves the active tab, and both
its radio pick and Other text are intact; the first question then offers no Previous and a trailing Next;
clicking Next draws the second question back, moves the tab, and its three ticks and its own Other text are
intact. The clamp push that closes the arc (a same-nonce re-delivery shortening the batch to one question)
lands the operator on a row with neither step control and Continue again — the one path that reaches that row
without the panel remounting, so a stale Next surviving the shrink would show up right there.

**Security review: PASS**, both the plan's self-review and the verifier's independent pass. This slice reads
none of the panel's four claude-authored strings — `canStepBack` and `isLastQuestion` are derived from a
client-owned integer and an array length — and both button labels, `QUESTION_PREVIOUS_COPY` and
`QUESTION_NEXT_COPY`, join `QUESTION_CANCEL_COPY`/`QUESTION_CONTINUE_COPY` as module constants next to them.
What it changes is *which* of claude's headers and question bodies are on screen, through the same
`onQuestionSelected(index)` → `questions[activeIndex]` route the header tabs already drive, so the drawn set
is unchanged in kind: no new attribute, no new key, no new lookup path, no `<a href>`. The trailing button's
`onClick` is the one place this slice could have grown a send path by accident, and on the last question —
where it reads Continue — it carries none at all.

## Option rows (#907, live since #912, Other-typing ticks since #1698)

`question.options.map(…)` renders the radio/checkbox rows and the Other row, the row-level click target,
the accessible-name closure over `<label>`, and the event-arm mapping (`optionPickEventFor`,
`otherPickEventFor`, and `otherTextChanged`'s `multiSelect` flag). #1698 made typing into Other tick it,
copying mobile: single-select typing replaces the picked option, multi-select typing ticks Other beside
ticked options, and un-ticking afterwards always keeps the typed text.

Split out to [Question panel — Option rows](question-panel-option-rows.md) on 2026-09-30 to keep this
document under the size cap. That document covers the option row and Other row markup, the native
radio/checkbox wiring, the accessible-name construction, the CSS house rules for the Other field's tint
and focus ring, and the security review across #907/#912/#1698.

## Cancel refuses the batch (#921)

Cancel sends a refusal, so it shares the [permission response availability gate](conversation-shell-permission-modal.md#selection-and-confirmation):
only the batch conversation's unique stamped owner reporting `connected` permits it. Missing or
ambiguous ownership and missing/non-connected status disable Cancel; another connected host cannot
enable it. `QuestionPanelSlot` rereads ownership/status before `refuseQuestionBatch`, so a blocked
gesture sends no command and clears neither the batch nor its picks.

Split out to [Question panel — Cancel refuses the batch](question-panel-cancel-refusal.md) on 2026-09-02
to keep this document under the size cap. Through #916 the Actions row's Cancel button was inert chrome;
that document covers `questionResolution.ts`'s `refuseQuestionBatch`, the picks-first optimistic clear, the
client-owned `outcome`/`source` constants, the `onCancel` wiring on `QuestionPanelView`/`QuestionPanelSlot`,
and the security review.

## Continue answers the batch (#922)

`responseAvailable` is separate from answer completeness (`canAnswer`). Final Continue requires both;
Next, Previous, tabs, picks and Other editing stay local and usable offline. Disconnect retains the
batch, picks, active question, messages and composer draft. Reconnect keeps the bridge's reset and
daemon re-delivery semantics, with no automatic submission; a re-delivered batch needs explicit picks
and Continue. The handler rereads current host availability before `answerQuestionBatch`.
See [offline verification](conversation-shell-permission-modal.md#verification) for renderer-command
observation and the distinction between disconnect retention and chat-switch remounts.

Split out to [Question panel — Continue answers the batch](question-panel-continue-answer.md) on
2026-09-02, the same move made for Cancel above. Through #916 the trailing button's Continue role carried
no handler at all. That document covers `resolveQuestionAnswers` (the one function that is both the
completeness gate and the payload builder), `answerQuestionBatch`, the picks store's new
`selectBatchSelections` read, the `canAnswer`/`onAnswer` props and the conjunction that keeps the button's
Next role from ever being gated on completeness, the `:disabled` CSS treatment, and the security review.
