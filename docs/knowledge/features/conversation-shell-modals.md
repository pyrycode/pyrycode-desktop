# Conversation shell — modals

The two overlays that act on one conversation as a whole rather than one turn, and take over the screen (or the composer's slot) to ask the operator something: the permission/trust modal and the question panel. Split out of [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md) on 2026-09-02 to keep that document under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Permission modal (#224, answerable since #237, second-confirm since #226, rejection surface since #249, confirm marker scoped to its prompt since #511)

The render half of the modal vertical (ADR [0009](../decisions/0009-modal-prompt-model.md)):
[#223](../codebase/223.md) shipped the store + bridge but left `useModalBridge` dormant, so
`modalStore` never populated. #224 closed that loop — it mounts the bridge at App level (beside
`useDaemonEventBridge`/`useTimelineBridge` in `App.tsx`) and renders the store's outstanding prompt.
[#237](../codebase/237.md) then made the rendered prompt **answerable**, closing the modal vertical.
[#226](../codebase/226.md) then inserted a **client-side second-confirm gate** in front of an allow
answer: there is no machine-readable `destructive` class on the wire (ADR 0009), so "a consequential
action needs a second confirm" can only be a renderer UX policy, gated on the one signal available —
`prompt.defaultOptionId`. [#249](../codebase/249.md) then added a **rejection surface**: because
\#237's answer path clears the prompt optimistically, an ungranted device's answer round-tripping to a
daemon `error` (correlated by [#248](../codebase/248.md)) had nothing left on screen to show it — see
§ Rejection surface below.

`PermissionModal.tsx`, mirroring `RepairPrompt`/`RepairControl`:

- **`PermissionModalView({ prompt, pendingOption, onSelect, onConfirm, onBack, onCancel })`** — pure,
  exported. Renders a centered M3 dialog (Figma "Dialogs", node `22-3`) reusing `StatusSheet`'s
  overlay+scrim *structure* (`role="dialog"`, `aria-modal="true"`, a dedicated scrim, an opaque panel,
  absolutely positioned inside `.conversation`, no portal) but centers the panel instead of
  bottom-anchoring it, and uses a distinct class set (`.permission-modal-overlay`/`.permission-modal`/…)
  rather than the status-sheet classes — the two modals share a chrome pattern, not a stylesheet.
  `title`/`prompt`/`options[].label` render as React children (auto-escaped, never
  `dangerouslySetInnerHTML`). The `pendingOption: ModalOption | null` prop (#226) selects one of two
  render modes — a **prop**, not internal `useState`, so both modes stay SSR-testable:
  - **List mode** (`pendingOption === null`) — one `<button type="button">` per option in array order,
    keyed by `option.id`, each `onClick={() => onSelect(prompt.modalId, option.id)}` (renamed from
    #237's `onAnswer` — every click now routes through the container's gate rather than answering
    directly). The option whose `id` matches `defaultOptionId` carries the
    `permission-modal__option--default` modifier — a filled-tonal pill (`--color-secondary-container`)
    against the plain `--color-primary` text-button treatment of the others. A leading cancel button,
    `.permission-modal__cancel` (its own class, not `.permission-modal__option`), is prepended to the
    action row with `onClick={() => onCancel(prompt.modalId)}` and the client-owned label `Cancel`; CSS
    gives it `margin-right: auto` so it sits at the row's far left while the daemon options stay
    right-aligned — a code-review SHOULD-FIX from #237 flagged this as diverging from the Figma Dialogs
    reference (which clusters Cancel at the trailing/right edge next to the confirm action) and asked
    the PO/architect to confirm the placement; **still unresolved**, see [#237 codebase
    notes](../codebase/237.md).
  - **Confirm mode** (`pendingOption` set, #226) — the same chrome, title still shown, a client-owned
    confirm sentence naming `pendingOption.label` (auto-escaped, since the held option's label is still
    untrusted daemon text even quoted back to the user), and a two-button row: leading `Back`
    (`.permission-modal__back`, `onClick={() => onBack()}`) / trailing `Confirm`
    (`.permission-modal__confirm`, `onClick={() => onConfirm(prompt.modalId, pendingOption.id)}`). The
    daemon option list is **not** rendered in this mode.
- **`PermissionModal()`** — the store-bound container: `useModalStore(selectOutstanding)` plus
  `useModalStore(s => s.dispatch)` (#237), renders `outstanding[0]` via `PermissionModalView`, or `null`
  when nothing is outstanding. One dialog at a time, oldest-first FIFO; no `selectCurrentModal` selector
  (ADR 0009 defers it — the container derives `[0]` locally). Gained one `useState<PendingConfirm |
  null>` (#226, re-keyed by [#511](../codebase/511.md)), `pending` — declared **before** the
  early-return (rules-of-hooks) — holding `{ modalId, optionId }`, not a bare option id. Daemon option
  ids are a closed per-class vocabulary (`permission` → `allow_once`/`allow_always`/`reject_once`/
  `reject_always`, `trust` → `proceed`/`exit`), not per-prompt nonces, so a bare-id marker was
  guaranteed to match same-class prompts other than the one it was armed on — #511 fixed this. A new
  pure `resolvePendingOption(prompt, pending)` in `modalResolution.ts` derives `pendingOption` every
  render against the **current** prompt, not a cached snapshot: `null` unless `pending.modalId ===
  prompt.modalId` (the correlation key, and the actual fix — `modalId` is a daemon-minted
  `crypto/rand` UUIDv4, distinct per prompt) **and** `prompt.options` still contains that `optionId`
  (retained as the within-prompt net for a `shown` re-delivery that changes the option set, and how the
  `ModalOption` the confirm sentence names is obtained). Re-deriving rather than clearing on a prompt
  change means a stale marker is inert — it can only ever match the prompt it was minted against — so
  the empty-`outstanding` window (the container returns `null` but stays mounted, per
  `ConversationScreen.tsx`) is structurally safe rather than defended. `onSelect` routes through the
  pure `selectOption` gate in `modalResolution.ts` (unchanged by #511): the default option answers
  straight through (`answerPrompt`, unchanged from #237); any other option calls `setPending({ modalId,
  optionId })` — the identity captured from the click's own `modalId`, not re-read from a possibly-newer
  store — and holds. `onConfirm` calls `answerPrompt` then clears the pending marker; `onBack` just
  clears it (no send). `onCancel` is unchanged from #237 (`cancelPrompt`, never gated). All handlers
  dereference `window.pyry.sendCommand` only inside the closures (#237's discipline). Since
  [#249](../codebase/249.md), also reads `useModalStore(selectRejections)` and renders
  `RejectionSurfaceView` alongside `PermissionModalView` — see § Rejection surface below.

Mounted as the **last child** of `.conversation` in `ConversationScreen.tsx`, after the conditional
`StatusSheet`, so it overlays the whole conversation surface. Selecting the default option or clicking
Cancel dispatches `answerModalCommand`/`cancelModalCommand` (#236) immediately, exactly as #237 shipped
it; selecting any other option now holds (#226) until `Confirm` dispatches the same
`answerModalCommand` or `Back` returns to the list with no send. Either terminal path (answer or
cancel) clears the prompt **locally and optimistically** via the existing `dismissed` reducer arm — no
new store representation, no new event arm, no wire change for #226 or #511. Was inert in production
until [#179](../codebase/179.md) flipped the `interactive` capability (previously no `modal_shown` frame
arrived, so nothing to answer); now live. See [#224 codebase notes](../codebase/224.md) for the
original render design, [#237 codebase notes](../codebase/237.md) for the answer-path design and the
still-open code-review items (Cancel placement, focus trap/`Escape`, programmatic default-option cue),
[#226 codebase notes](../codebase/226.md) for the second-confirm gate design, and [#511 codebase
notes](../codebase/511.md) for the pending-marker fix — the staleness gap #226 and #510's code reviews
both flagged against the bare-option-id key is now resolved, not still open.

### Rejection surface (#249)

Because the answer path (#237) clears `outstanding` **optimistically** on click, an ungranted device's
answer round-tripping to a daemon `error` (correlated main-side by [#248](../codebase/248.md) into a
content-free `modalAnswerRejected` event) had no prompt left on screen to attach to — the user just
watched it vanish with no explanation. This slice adds a second, **orthogonal** surface at the same
host, fed by a new `rejections: readonly string[]` slice on `ModalState` (arrival-ordered,
de-duplicated `modalId`s — see [Modal-prompt model](modal-prompt-model.md)):

- **`RejectionSurfaceView({ rejections, onDismiss })`** — new, exported, pure, SSR-testable, mirroring
  `PermissionModalView`. Returns `null` on an empty list (the `Timeline`/`ThinkingIndicator`
  zero-layout-footprint idiom). Else renders `.modal-rejections`, one `.modal-rejection` banner per id
  (**keyed by `modalId`**), each with `role="alert"` (a live region — a screen reader announces the
  failure on arrival), the client-owned category copy **"Your answer was rejected."**, and a `Dismiss`
  button calling `onDismiss(modalId)`. The `modalId` is used **only** as the React key and the
  `onDismiss` argument — never rendered as visible text (it is meaningless to a human and the prompt
  title is already gone). No daemon content anywhere: the event carries none, the copy is a client
  constant. `onDismiss` is a **required** injected prop (the "a view that cannot answer is a bug" rule).
- **`PermissionModal()`** — extended, not forked: reads the new `selectRejections` slice alongside
  `selectOutstanding`; the early return now fires only when **both** are empty
  (`if (!prompt && rejections.length === 0) return null`), since a rejection can render with no
  outstanding prompt; `pendingOption` is guarded on `prompt` existing (it can be `undefined` while a
  rejection shows alone). Returns a fragment: `<PermissionModalView>` only when `prompt` exists, plus
  `<RejectionSurfaceView>` unconditionally, wired with an inline
  `dispatch({ type: 'rejectionDismissed', modalId })` — deliberately not a `modalResolution.ts` helper,
  since it neither sends a command nor renames to the wire.
- **Styling** (`conversation.css`) — `.modal-rejections` is a bottom-anchored absolute stack inside
  `.conversation`, `pointer-events: none` so it never blocks the composer beneath it (each
  `.modal-rejection` banner re-enables its own `pointer-events: auto`). Each banner is a
  `--color-surface-container-high` card with a `--color-error` `border-left` accent (a leading accent,
  not a filled error container — only the bare `--color-error` role token exists, #230). No new theme
  tokens. No bespoke Figma design exists for this surface yet (PO-confirmed gap in node `22-3`); the
  chrome is a placeholder reusing the modal/M3 tokens pending a follow-up.

Not security-sensitive — a pure renderer reading an already-typed, content-free event; no keys, sockets,
tokens, or raw bytes (the guarantee was defended upstream by #248). See [#248 codebase
notes](../codebase/248.md) for the transport half and [#249 codebase notes](../codebase/249.md) for the
full render design, testing strategy, and lessons learned.

## Question panel (#906, option rows since #907, live since #912)

The render vertical's frame slice, over the model and bridge documented in [Question-batch
model](question-batch-model.md): `questionBatchStore` (#899) held the batches and `useQuestionBridge`
(#900) filled it, but nothing mounted the hook or read the store — #906 closes both gaps, the same shape
[Permission modal](#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511)
above took for the modal vertical (#223 → #224). #906 drew the panel's chrome only: the title row, the
bordered box with the question's own text, a separator, and an inert Cancel/Continue row. #907 filled the
band between the question's text and the separator with the option rows themselves — still drawing only,
nothing responds to a click. #908, meant to land the picks and the answer path together, was split into
[#911](https://github.com/pyrycode/pyrycode-desktop/issues/911) (the picks store) and this ticket's sibling
[#912](https://github.com/pyrycode/pyrycode-desktop/issues/912); #908 itself closed as not planned, never
shipping anything. #912 wires the panel to #911's store: the option rows and the Other field respond to a
click or a keystroke, and the picks survive a chat switch. The send is still #853's.

**`useQuestionBridge()` mounts in `App.tsx`**, beside `useModalBridge`, unconditional and app-lifetime —
not screen-scoped, because a batch is raised against a conversation the operator may not have open, the
same reasoning `ConversationActivityData` already carries in that file.

**`ComposerSlot({ conversationId, phase, onMessageSent })`** (`ConversationScreen.tsx`, exported) replaces
the screen's direct `<Composer/>` mount and is the batch store's first reader:

```ts
const batch = useQuestionBatchStore((s) =>
  conversationId === null ? undefined : selectBatchFor(conversationId)(s)
)
return (
  <>
    {batch && <QuestionPanelSlot batch={batch} />}
    <Composer phase={phase} onMessageSent={onMessageSent} covered={batch !== undefined} />
  </>
)
```

`conversationId` arrives as a prop off `activeConversation?.id ?? null` — the `BackgroundTaskPanel` idiom
— so a batch arriving re-renders this leaf, never the whole screen. `selectBatchFor` is called inline with
no `useMemo`: `useStore` compares the selector's *result* under `Object.is`, and the held batch comes back
by reference, per the store's own ruling against memoising anything claude-authored into a lookup path.
`ComposerSlot` itself never indexes into `batch.questions` any more (#912) — see `QuestionPanelSlot` below.

**`QuestionPanelSlot({ batch })`** (#912, `ConversationScreen.tsx`, exported) is a separate leaf mounted only
on the `batch &&` branch, and it is the picks store's only reader:

```ts
const FIRST_QUESTION_INDEX = 0 // named: the SAME index feeds the question read and the picks key below

const question = batch.questions[FIRST_QUESTION_INDEX]
const selection = useQuestionPicksStore(
  selectQuestionSelection(batch.questionBatchId, FIRST_QUESTION_INDEX)
)
const dispatch = questionPicksStore.getState().dispatch
```

Hooks cannot be conditional, so folding this read into `ComposerSlot` would need a sentinel batch id for
the no-batch case and would subscribe the whole composer to pick traffic — every Other-field keystroke
re-rendering the message box it is covering. A leaf that exists only while the panel is up needs neither,
and keeps a pick re-rendering the panel alone. **The key is `batch.questionBatchId`, never
`conversationId`** — a substitution that would compile clean. The nonce is what makes a fresh batch
replacing a dismissed one (same conversation) read a fresh empty selection with no clearing effect to get
right and no stale pick reachable; keyed on the conversation, the new batch would inherit the old one's
picks. `batch.questions[FIRST_QUESTION_INDEX]` is read with no guard and no `!` — `reduceQuestionBatches`
never lets an empty `questions` array reach `outstanding`, so the index always exists; a batch with several
draws its first, and stepping through the rest is still deferred (#907's original note, unchanged).
`dispatch` is read off the store rather than through a hook, since it is a stable function on a singleton
and subscribing to it would buy nothing. Neither `dismissed` nor `reconnected` is dispatched here —
`questionBridge` already drives both, over its one daemon-event subscription, picks-first.

**`Composer` gained a required `covered: boolean` prop**, rendering `<div className="composer"
hidden={covered}>`. The native `hidden` attribute is the whole mechanism — one attribute that hides the
subtree, drops it from the tab order and drops it from the accessibility tree, while leaving every element
mounted, so the operator's half-typed draft (`Composer`'s own `useState`) survives the batch. A
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

**`QuestionPanelView({ question, selection, onOptionChosen, onOtherChosen, onOtherTextChanged })`**
(`QuestionPanel.tsx`) is the pure, exported view — the #224 split, testable by `renderToStaticMarkup` from
injected fixtures. `selection: QuestionSelection` and the three callbacks are #912's; the view stays
variant-neutral (single-select replace and multi-select accumulate are one gesture from its side), so it
holds no `multiSelect` branch that could pick the wrong store arm — see § Option rows below for where that
choice is made. `question.header` and
`question.question` are claude-authored and render as plain React children only, auto-escaped, never
`dangerouslySetInnerHTML`. **No `title` attribute on the clamped question text** — the reflex accompaniment
to a single-line ellipsis clamp, and the one trap the component invites, since it would put untrusted text
into an attribute, the ban `questionBatchStore.ts` states by name. No `data-*` derived from `header`,
`question`, or the nonce `questionBatchId` either, which this slice never reads. The title row draws
exactly one label (`347:6829`'s other four slots and Previous are hidden in the single-question instance)
using the already-shipped `PyryMark` at `width={14} height={16}`, the composer status row's call verbatim.
Cancel and Continue are `<button type="button">` with no `onClick` and no `disabled` — inert, not greyed,
since the panel sits on top of the composer and there is nothing to disable.

**Colours came from the Figma variables on node `347:6913`, never the generated fallbacks** (which print
the light scheme, per `tokens.css`'s standing warning): Tertiary, On Background, Primary Container,
Primary, Background and On Primary resolve onto the existing `--color-tertiary`/`--color-on-surface`/
`--color-primary-container`/`--color-primary`/`--color-surface`/`--color-on-primary` tokens, since M3 dark
defines Background = Surface. Two new tokens, `--text-body-medium-weight-emphasized` and
`--text-body-small-weight-emphasized` (both `500`), were minted for the question text and the button
labels rather than a `font-weight: 500` literal at the call site.

### Option rows (#907, live since #912)

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
`aria-label`. `otherText` is held independently of `otherTicked`, so typing into an un-ticked row is
ordinary traffic never gated on the tick — and it is the one string on this panel the daemon did not
author, still bound as a React `value`, React's own escaping, never a raw-markup sink. The Other row's
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
exported is what lets `QuestionPanel.test.tsx` assert the literal directly. `QuestionPanelSlot` (§
above) is the caller, closing over `multiSelect`, `questionBatchId` and the question index so the view
itself never sees them.

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
family draws no expiry (settled 2026-08-31 — the timeout is a daemon matter) and Cancel dispatches nothing;
the exposure is bounded to the one conversation, and a `reconnected` arm still clears every held batch on
each handshake. A malicious relay is content-blind and on-path only, so it can withhold a batch or its
dismissal but cannot reach picks state directly.

