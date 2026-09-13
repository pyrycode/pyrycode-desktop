import { PyryMark } from '../../theme/PyryMark'
import type { Question } from '../../store/questionBatches'
import type { QuestionPickEvent, QuestionSelection } from '../../store/questionPicksStore'

// #906 / #907 / #912 / #915 / #916 / #921: the pure view half of the question vertical's render slice
// (Figma node 347:6913, the single-question instance). #906 drew the panel's chrome — the title row, the
// bordered box with the question's own text, the separator, and an inert Cancel / Continue row — #907
// filled the box's middle band with one row per offered option, #912 made those rows and the Other field
// respond, #915 filled the title row with one tab per question in the batch (347:6829) and made them jump
// between them, and #916 put the same jump on the action row as Previous plus a trailing button that reads
// Next until the last question. #921 GAVE CANCEL THE ROW'S FIRST SENDING HANDLER: it refuses the batch and
// clears the panel. #922 GAVE THE TRAILING BUTTON ITS SECOND, and the row is now fully live: in its
// Continue role it sends the batch's assembled answers, and it is the one control here that can be
// unavailable — see the action row for why the gate is a conjunction and not a bare `!canAnswer`.
//
// The pure view / store-bound container split is #224's, built on #177's dialog precedent: this file is
// markup-in-props-out and server-render-testable from injected fixtures, while the store read lives in
// ConversationScreen's `ComposerSlot` — which is where it must live anyway, because the container also
// covers the composer and `Composer` is that module's own.
//
// THIS IS NOT THE PERMISSION MODAL'S CHROME, and the resemblance is the trap. There is no scrim, no
// role="dialog", no aria-modal and no centring: claude draws a clarifying question in the input area's
// place and the desktop mirrors that. A question belongs to ONE conversation, so a centred dialog would
// block the whole app for something local to one chat — the reason the panel takes the composer's slot
// instead of floating over the surface.
//
// UNTRUSTED TEXT, RENDERED — THIS SLICE IS WHERE THE ESCAPING IS OWED. `question.header`,
// `question.question` and every option's `label` and `description` are CLAUDE-AUTHORED: they crossed the
// subprocess trust boundary and the daemon NEITHER BOUNDS NOR SANITIZES them. `questionBatchStore.ts`
// states the rule this file discharges — plain text only, never HTML (no innerHTML /
// dangerouslySetInnerHTML), never into an attribute, a URL, a filename, a cache key, a lookup path or a
// log. All four strings appear here as React CHILDREN and nowhere else, which is the whole boundary. The
// one lookup path this file could have opened is the option rows' React key; see it for why it is not.
//
// NO `title` ATTRIBUTE ON THE QUESTION TEXT, and this is the one trap the component invites. The design
// clamps that text to a single line with an ellipsis (see .question-panel__question), and the reflex
// accompaniment to a clamp is `title={question.question}` so the full string is reachable on hover — which
// is claude-authored text in an ATTRIBUTE, the ban that survives a paraphrase least well. The full text
// clamp IS the render, not a summary of a hidden tooltip — and #907 confirmed it is the DESIGN'S OWN in
// both option variants rather than a placeholder for something roomier, so it is not relaxed here. Same
// rule for `data-*`: nothing here carries an attribute derived from any of the four claude-authored
// strings, or from `questionBatchId` — a one-time unguessable nonce this file never reads at all. Every
// attribute below that DOES carry copy (the Other field's placeholder and aria-label, the Other tick's
// aria-label, the radio group's name) is a client-owned constant, which is exactly why it may be an
// attribute.
//
// THE ACCESSIBLE NAME IS THE SINK #912 COULD HAVE OPENED, and it is closed by construction. Making a row's
// control real raises the question of what names it, and both reflex answers put claude's string somewhere
// it must not go: `aria-label={option.label}` is that string in an attribute, and `aria-labelledby` needs a
// generated `id` and turns the value into a DOM lookup key. An implicit <label> wrapping the whole row
// avoids both — the name comes from the row's own visible text, which is the React-children path the four
// strings were already on. The one control that cannot take its name that way is the Other row's tick; see
// that row for why, and note that its name is client-owned copy rather than anything claude wrote.
//
// THE OPERATOR'S OWN TEXT flows the other way, and #912 is where it arrives. `otherText` is the one string
// on this panel the daemon did not author. It is bound into a controlled `<input value={…}>` — React's own
// escaping — and reaches no other sink: not an attribute derived from it, not a key, not a log.
//
// NOTHING HERE LOGS. No logger import, no `console.*` — the deliberate absence `questionBatches.ts`,
// `questionBatchStore.ts` and `questionBridge.ts` each record, for the same two reasons.

// Client-owned copy, in the app's own voice — deliberately constants rather than JSX literals, so the
// line between what the client says and what claude says is visible in the source of a file that renders
// both. SINCE #922 TWO BUTTONS ON THIS ROW SEND: Cancel refuses the batch, and the trailing button in its
// Continue role answers it. Previous and Next step, which is navigation and not an answer, and neither is
// ever `disabled` — the stepping controls are absent where there is nowhere to go rather than present and
// inert, the header tabs' call. Continue also requires a complete batch; both server-bound actions
// require current host availability. Local selection and navigation remain usable offline.
export const QUESTION_CANCEL_COPY = 'Cancel'
export const QUESTION_CONTINUE_COPY = 'Continue'
// The two stepping labels (#916), constants for the same reason. Previous is the middle instance Figma
// hides in the single-question panel (347:6888); NEXT IS NOT IN THE DESIGN AT ALL — the trailing instance
// reads Continue everywhere in the file, because a static frame cannot express a label that depends on
// position, so this string is #916's own decision rather than a design read. Both are client-owned, which
// is what lets each button's accessible name be its own visible text with no attribute anywhere.
export const QUESTION_PREVIOUS_COPY = 'Previous'
export const QUESTION_NEXT_COPY = 'Next'
// The Other row's field copy (347:6386), a constant for the same reason: it sits in the one attribute pair
// this component writes, so the line between client-owned and claude-authored text has to be visible here.
export const QUESTION_OTHER_PLACEHOLDER_COPY = 'Other. Type something.'
// The Other row's TICK is a second control beside that field, so it needs an accessible name of its own —
// and unlike an option row's, it cannot come from visible text: the row is not one implicit <label> (see
// the Other row's own comment for why), so this constant is its `aria-label`. Client-owned, in the app's
// voice, which is exactly what lets it be an attribute at all.
export const QUESTION_OTHER_TICK_COPY = 'Other'
// The radio group's `name`. Every control in the panel shares it, so the browser treats a single-select
// question's rows — the offered options AND the Other row — as ONE group and arrow keys move within it.
// A client-owned constant, never derived from `questionBatchId` (a one-time nonce this file still never
// reads) or from any claude-authored string: a `name` is an attribute, and the panel draws one question at
// a time, so a single fixed group is both sufficient and unambiguous. Inert on the checkbox variant, where
// `name` carries no grouping semantics and there is no form to submit into.
const QUESTION_OPTION_GROUP_NAME = 'question-panel-option'
// A header tab's classes, shared by both states (#915) — the inactive one appends its own modifier. The
// typography class is the SAME one the single label wears, so the one-question row is unchanged by
// construction and the only new colour in the stylesheet is the inactive tab's.
//
// NO role="tablist"/"tab" HERE, and the omission is a decision. A conforming tab widget needs aria-controls
// pointing at the panel's `id` — a generated DOM id in a component whose test asserts no `id=` reaches the
// markup at all — plus a roving tabindex and an arrow-key contract. Plain buttons carrying aria-current give
// the same affordance with none of that: this row is a set of jump controls, not a tab panel.
const QUESTION_TAB_CLASS = 'question-panel__label question-panel__label--tab'

/**
 * Which pick arm a question's shape wants for an OPTION row — `optionPicked` (replace) for a single-select
 * question, `optionToggled` (accumulate) for a multi-select one.
 *
 * **THIS MAPPING IS INVISIBLE TO `tsc`, which is the whole reason it is a named, exported function rather
 * than a ternary inside a handler.** The two arms carry IDENTICAL payloads and differ only in the `type`
 * literal, so a transposed one compiles clean and shows up only as replace-instead-of-accumulate in front of
 * an operator. The store is deliberately TOLD which behaviour the question wants rather than reading
 * `multiSelect` off the held batch (questionPicksStore.ts's event union records why), so this is the single
 * place the distinction can be lost — and being exported is what lets QuestionPanel.test.tsx assert the
 * literal directly, alongside the Playwright drive that proves the consequence in both variants.
 *
 * ONE OBJECT PARAMETER, not four positional ones: a bare `boolean` sitting beside two `number`s is the exact
 * boolean-blindness the store's behaviour-named arms exist to avoid, and re-introducing it at the call site
 * would give back what the union bought.
 */
export function optionPickEventFor(args: {
  multiSelect: boolean
  questionBatchId: string
  questionIndex: number
  optionIndex: number
}): QuestionPickEvent {
  const { multiSelect, questionBatchId, questionIndex, optionIndex } = args
  return {
    type: multiSelect ? 'optionToggled' : 'optionPicked',
    questionBatchId,
    questionIndex,
    optionIndex
  }
}

/**
 * The same mapping for the OTHER row — `otherPicked` (radio semantics: tick Other, clear every option pick)
 * for single-select, `otherToggled` (flip the tick, leave ticked options and the text alone) for
 * multi-select. Neither arm takes a boolean: `otherPicked` cannot un-tick, because in a radio group only
 * picking an option does that.
 */
export function otherPickEventFor(args: {
  multiSelect: boolean
  questionBatchId: string
  questionIndex: number
}): QuestionPickEvent {
  const { multiSelect, questionBatchId, questionIndex } = args
  return { type: multiSelect ? 'otherToggled' : 'otherPicked', questionBatchId, questionIndex }
}

/**
 * The checkbox's ticked `Selector` (Figma `Checkbox` 347:6211 / 347:6773) — a 12x12 frame holding the
 * design's 10x9 tick `Vector`, whose exported fill and stroke are both `#FFB59F`, i.e. this repo's
 * `--color-tertiary`. Both are `currentColor` here so the one class supplies the colour, the `PyryMark`
 * idiom; the stroke is kept because the design's vector carries one, and dropping it thins the tick.
 *
 * INLINE JSX, never Figma's generated `<img src="https://www.figma.com/api/mcp/…">` and never a `data:`
 * background — `PyryMark.tsx` records the reasoning in full: the window's CSP is `default-src 'self'` with
 * no `img-src`, so either would fail closed and draw nothing, and the first would be an outbound
 * third-party fetch from the privileged window that holds the transport bridge. Shared with the
 * permission panel's session checkbox so both controls use the same glyph.
 *
 * The radio's ticked `Selector` (347:6141 / 347:6478) needs no component at all — it is a plain filled
 * circle, so it is a `<span>` the stylesheet draws.
 */
export function QuestionTick(): JSX.Element {
  return (
    <svg
      className="question-panel__control-tick"
      viewBox="0 0 12 12"
      fill="currentColor"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M10.7051 1.63436C11.0243 1.85929 11.0957 2.29186 10.8636 2.60114L5.14911 10.2142C5.02634 10.3786 4.8366 10.4803 4.62678 10.4976C4.41695 10.5149 4.21382 10.4392 4.06649 10.2964L1.20927 7.52802C0.930244 7.25767 0.930244 6.81862 1.20927 6.54827C1.48829 6.27792 1.94143 6.27792 2.22046 6.54827L4.48615 8.74352L9.70951 1.78576C9.94166 1.47648 10.3881 1.40727 10.7073 1.6322L10.7051 1.63436Z" />
    </svg>
  )
}

/**
 * The outstanding batch's frame. #915 gave this view the whole ordered LIST plus the position showing, in
 * place of #906's single `question`: the title row needs every header at once, and the box needs exactly
 * one of them, so a view holding only the chosen question could not draw the row. The box reads
 * `questions[activeIndex]` ONCE, so the tabs and the box cannot point at different questions — and the
 * container keys the picks on that same index (see `QuestionPanelSlot`, which also owns the clamp keeping
 * it in range).
 *
 * NO EMPTY BRANCH AND NO NULL PROP, deliberately. `reduceQuestionBatches` returns state unchanged when
 * `questions` is empty — the guard sits before the match, so an empty re-delivery leaves a live batch
 * alone — which means `[]` never reaches `outstanding` even though the wire type admits it and the daemon
 * ships a `question_shown_empty.json` fixture. A defensive empty-state render here would defend a failure
 * mode the store makes unreachable.
 *
 * THE TITLE ROW HOLDS TABS AND NOTHING ELSE. The Figma's `Question labels` row (347:6829) is five
 * `Question label` instances wrapping onto two lines and NO button: #906's note here — and the matching
 * one in conversation.css — put Previous in this row, and both were wrong. Figma puts Previous in the
 * middle of the Actions row (347:6657), which is where #916 built it; see that row below.
 */
export function QuestionPanelView({
  questions,
  activeIndex,
  selection,
  canAnswer,
  responseAvailable,
  onQuestionSelected,
  onCancel,
  onAnswer,
  onOptionChosen,
  onOtherChosen,
  onOtherTextChanged
}: {
  questions: readonly Question[]
  activeIndex: number
  selection: QuestionSelection
  // WHETHER THE WHOLE BATCH HOLDS AN ANSWER (#922) — a prop rather than something derived here, and
  // that is structural rather than convenience. This view holds the ACTIVE question's selection and no
  // other, so it cannot see the batch; the container computes this from every question's picks through
  // the one function that also builds the frame, so the button's availability and the payload's
  // contents come from the same result and cannot disagree.
  canAnswer: boolean
  responseAvailable: boolean
  onQuestionSelected: (questionIndex: number) => void
  // THE ROW'S ONE SENDING GESTURE (#921), and variant-neutral like the two chosen-callbacks below: this
  // view knows a refusal was asked for and nothing about what it becomes. It carries NO batch id even
  // though the container holds one — which batch a refusal is recorded against stays the container's
  // single read, exactly as `activeIndex` selects what is DRAWN while the pick's question index stays
  // its read, so the two cannot drift apart. Required rather than optional, so `tsc` forces the one
  // call site to supply it and an unwired Cancel cannot ship green a second time.
  onCancel: () => void
  // THE ROW'S SECOND SENDING GESTURE (#922), and variant-neutral for `onCancel`'s reasons: this view
  // knows an answer was asked for and nothing about what it becomes. It carries no batch id and no
  // entries — which batch is answered, and with what, stays the container's single read. Required
  // rather than optional, so `tsc` forces the one call site and an unwired Continue cannot ship green.
  onAnswer: () => void
  // BOTH CHOSEN-CALLBACKS ARE VARIANT-NEUTRAL, deliberately. Picking and ticking are one gesture from this
  // view's side; which store arm it becomes is the container's call, through optionPickEventFor /
  // otherPickEventFor above. So this view holds no arm to transpose — and neither callback carries a
  // question index, even now that the view knows one: `activeIndex` selects what is DRAWN, while which
  // question a pick is recorded against stays the container's single read, so the two cannot drift apart.
  onOptionChosen: (optionIndex: number) => void
  onOtherChosen: () => void
  onOtherTextChanged: (text: string) => void
}): JSX.Element {
  // Read ONCE, so every read below — the question's text, its options, its variant — is the same question
  // the active tab names. No `!` and no guard: the container clamps the index into range before it arrives.
  const question = questions[activeIndex]
  // The step controls' two conditions (#916), derived here rather than inline at the row so each is read
  // once and named — `isLastQuestion` decides BOTH the trailing button's copy and whether it carries a
  // handler, and those two must never disagree. Neither reads anything claude authored: one is a
  // client-owned integer, the other an array length.
  const canStepBack = activeIndex > 0
  const isLastQuestion = activeIndex === questions.length - 1
  // The ONLY difference between the two option variants (347:6696 Single / 347:6698 Multiple): same row
  // geometry, same 8px gap, same label-over-description stack, a differently-cornered control — and, since
  // #912, a differently-shaped Selector inside it and a different native input type.
  const controlClass = question.multiSelect
    ? 'question-panel__control question-panel__control--checkbox'
    : 'question-panel__control question-panel__control--radio'
  const inputType = question.multiSelect ? 'checkbox' : 'radio'
  // The design's checked treatment: a filled 10x10 circle centred in the radio's 3px padding, or the 12x12
  // tick frame in the checkbox's. One shape per variant covers BOTH an option row and the Other row — the
  // two instance the same component and differ only in the instance's own `y`, which the stylesheet already
  // carries as .question-panel__control--other's offset.
  const selector = question.multiSelect ? (
    <QuestionTick />
  ) : (
    <span className="question-panel__control-dot" />
  )
  return (
    <div className="question-panel">
      <div className="question-panel__title">
        {/* The Figma vector on this row (14 x 15.9707) IS the shipped pyry mark, not a new asset: that
            glyph's docblock records the composer status row's node as this same mark at exactly 1/6.5
            scale, and the two viewports agree at the same ratio. Figma's generated `<img src="https://
            www.figma.com/api/mcp/…">` must never be transcribed into this renderer — the window has no
            img-src in its CSP, so the fetch fails closed and draws nothing, from the privileged window
            that holds the transport bridge. width/height are the status row's call verbatim: the default
            preserveAspectRatio letterboxes the 0.8766 glyph into a 16px box at 14 x 15.97, the design's
            geometry exactly, with no fractional height to compute.
            The design's node carries a vertical flip (-scale-y-100). It is NOT reproduced: this is the
            app's own brand mark, upright at two shipped call sites, and a third drawing it inverted would
            be a wrong brand mark rather than fidelity. At 14px on a near-radially-symmetric snowflake the
            difference is not visible. */}
        <PyryMark className="question-panel__mark" width={14} height={16} />
        <div className="question-panel__labels">
          {/* ONE QUESTION DRAWS A BARE <span>, AND THAT IS THE WHOLE POINT OF BRANCHING ON THE COUNT. With
              nothing to jump to, a focusable control that re-selects the question already on screen is not
              "unchanged from today" — it is a new tab stop in front of the operator for no gesture. So the
              single-label render stays #906's markup exactly, and the row grows controls only once there
              is somewhere to go. */}
          {questions.length === 1 ? (
            <span className="question-panel__label">{questions[0].header}</span>
          ) : (
            questions.map((tab, index) => (
              // KEYED BY POSITION, for the option rows' reason one nesting level down and stated by hand in
              // both questionBatches.ts and WireQuestion's docblock: `header` is claude-authored, so
              // `key={tab.header}` is untrusted text in a lookup path — the single most likely mistake in
              // this family, and the one a tab row reaches for first. The array is claude's own order and
              // is never re-keyed, so the index is the honest identity, and two headers claude words
              // identically stay two tabs.
              // A <button>, NEVER an <a href>: a link is the URL sink these strings must never reach, and
              // `header` is exactly what would fill it. type="button" so no tab can submit an ancestor
              // form, matching Cancel and Continue. Its accessible name is its own visible text — the
              // React-children path `header` is already on — so there is no aria-label and no
              // aria-labelledby (which would need a generated id and make the value a DOM lookup key).
              <button
                type="button"
                key={index}
                className={
                  index === activeIndex
                    ? QUESTION_TAB_CLASS
                    : `${QUESTION_TAB_CLASS} question-panel__label--inactive`
                }
                // The design's two states differ in COLOUR ALONE, which a screen reader cannot hear. The
                // ComposerOptionsPanel / RunConfigSections idiom carries the same meaning non-visually;
                // `undefined` omits the attribute rather than emitting aria-current="false" on every other
                // tab. Client-owned constants, which is what lets them be attributes at all.
                aria-current={index === activeIndex ? 'true' : undefined}
                onClick={() => onQuestionSelected(index)}
              >
                {tab.header}
              </button>
            ))
          )}
        </div>
      </div>
      <div className="question-panel__box">
        <p className="question-panel__question">{question.question}</p>
        {/* The option list (347:6025 single, 347:6706 multi), between the question and the separator,
            inheriting the box's own 16px gap. */}
        <div className="question-panel__options">
          {question.options.map((option, index) => (
            // KEYED BY ARRAY INDEX, deliberately rather than lazily. `QuestionOption` carries no id
            // because claude's answer protocol selects an option by its `label` — so the label is the
            // option's identity ON THE WIRE, which makes `key={option.label}` the reflex and puts
            // untrusted text straight into a lookup path, the failure questionBatches.ts names by hand.
            // The array is claude's own display order and is NEVER re-keyed, so the index is the honest
            // identity here, and two options claude words identically stay two rows.
            // AN IMPLICIT <label>, AND THAT IS THIS ROW'S WHOLE ACCESSIBILITY STORY. Wrapping the row
            // makes its own visible text the control's accessible name, which keeps claude's `label` and
            // `description` on the SAME React-children path they were already on. The two alternatives
            // both open a sink this file has stayed clear of since #906: `aria-label={option.label}` is
            // claude-authored text in an attribute, and `aria-labelledby` needs a generated `id` and makes
            // that value a DOM lookup key. It also makes the whole row a click target, which is what the
            // design draws.
            <label className="question-panel__option" key={index}>
              {/* THE REAL CONTROL, and it is CONTROLLED — which is what makes it honest. #907 kept this a
                  presentational span precisely because a native control at rest is focusable AND
                  checkable, so a click would paint a selection no store held. Driving `checked` off the
                  store closes that: the DOM's checked state IS the store's, on every render, and a click
                  only ever reaches the store. Visually hidden rather than styled, so the design's Selector
                  can be a real child element of the chrome span beside it. */}
              <input
                type={inputType}
                name={QUESTION_OPTION_GROUP_NAME}
                className="question-panel__input"
                checked={selection.optionIndices.includes(index)}
                onChange={() => onOptionChosen(index)}
              />
              {/* The chrome, now carrying the design's Selector when this position is picked and nothing
                  when it is not — the child #907 deliberately withheld. aria-hidden because the input
                  beside it already announces the state; a screen reader must not hear it twice. */}
              <span className={controlClass} aria-hidden="true">
                {selection.optionIndices.includes(index) ? selector : null}
              </span>
              <div className="question-panel__option-text">
                <p className="question-panel__option-label">{option.label}</p>
                {/* An empty description contributes NO element. `description` is a required string, so ''
                    is legal traffic rather than an absent field, and a blank <p> would hold a line of
                    height for nothing. */}
                {option.description === '' ? null : (
                  <p className="question-panel__option-description">{option.description}</p>
                )}
              </div>
            </label>
          ))}
          {/* The Other row (347:6386 single, 347:6709 multi) — always last and INSIDE the list, wearing
              the variant's own control so it can sit ticked beside ticked labels. This is not the
              separate `Other options` frame below the separator (347:6569 / 347:6711), which is hidden in
              both variants and in the shipped instance.

              THIS ROW CANNOT BE ONE IMPLICIT <label> THE WAY AN OPTION ROW IS, and the asymmetry is
              load-bearing rather than untidiness. A <label> binds to its FIRST labelable descendant, so
              wrapping this row whole would make every click into the free-text field toggle the tick.
              Only the control is wrapped instead; that inner label carries no text, so the tick takes its
              accessible name from a client-owned constant, and the field keeps its own. */}
          <div className="question-panel__option">
            <label className="question-panel__other-control">
              <input
                type={inputType}
                name={QUESTION_OPTION_GROUP_NAME}
                className="question-panel__input"
                checked={selection.otherTicked}
                onChange={onOtherChosen}
                aria-label={QUESTION_OTHER_TICK_COPY}
              />
              <span
                className={`${controlClass} question-panel__control--other`}
                aria-hidden="true"
              >
                {selection.otherTicked ? selector : null}
              </span>
            </label>
            <div className="question-panel__other-field">
              {/* CONTROLLED, so the store is the field's only source of truth — which is what carries the
                  typed text across the remount a chat switch forces (the picks live outside the keyed
                  conversation pane precisely for this). `otherText` is held INDEPENDENTLY of `otherTicked`,
                  so typing into an un-ticked row is ordinary traffic and this value is never gated on the
                  tick. It is the one string on this panel the daemon did not author — and it is still
                  bound as a React `value`, escaped by React itself, never a raw-markup sink. */}
              <input
                type="text"
                className="question-panel__other-input"
                value={selection.otherText}
                onChange={(event) => onOtherTextChanged(event.target.value)}
                placeholder={QUESTION_OTHER_PLACEHOLDER_COPY}
                aria-label={QUESTION_OTHER_PLACEHOLDER_COPY}
              />
            </div>
          </div>
        </div>
        {/* Decorative rule (347:6543) — a 1px block, not an <hr>, which would announce a thematic break
            to a screen reader that this line does not represent. */}
        <div className="question-panel__separator" aria-hidden="true" />
        <div className="question-panel__actions">
          {/* Cancel leads, Previous sits in the middle, the filled button trails, right-aligned
              (347:6657). type="button" on all three so none can ever submit an ancestor form. Each one's
              accessible name is its own visible text, and all three strings are client-owned constants.
              #921 GAVE CANCEL ITS HANDLER AND CHANGED NOTHING ELSE ABOUT IT: the design read confirms the
              row's treatment is unchanged, so there is no new class, no new attribute and no
              conversation.css edit. The handler is passed straight through rather than wrapped in an
              arrow — there is no argument to supply, and nothing derived from the batch may reach an
              attribute here (the panel's standing rule for `questionBatchId`, a one-time nonce this file
              still never reads at all). The view's spec asserts this button's markup is byte-identical to
              what #906 shipped, which is what makes "the handler leaks nothing" structural. */}
          <button type="button" className="button-small question-panel__cancel" disabled={!responseAvailable} onClick={onCancel}>
            {QUESTION_CANCEL_COPY}
          </button>
          {/* ABSENT ON THE FIRST QUESTION, NEVER `disabled` — the header tabs' call one row up, for the
              same reason: with nowhere to step back to, a focusable control is a new tab stop in front of
              the operator for no gesture. It is also what keeps a one-question batch's row byte-identical
              to what #906 shipped, which is the acceptance criterion in AC1's second sentence.
              `activeIndex - 1` can never be negative BECAUSE of this condition, which is why no
              `Math.max(0, …)` guards it — the container's clamp covers the other end (see
              QuestionPanelSlot), so between the two the index cannot leave the list. */}
          {canStepBack ? (
            <button
              type="button"
              className="button-small question-panel__previous"
              onClick={() => onQuestionSelected(activeIndex - 1)}
            >
              {QUESTION_PREVIOUS_COPY}
            </button>
          ) : null}
          {/* ONE ELEMENT WHOSE LABEL, HANDLER AND AVAILABILITY VARY, never two branched elements, and the
              difference is observable. Two branches reconcile as a REPLACEMENT, so stepping onto the last
              question from the keyboard would drop focus mid-row; one element keeps the focus where the
              operator put it. `disabled` is an ATTRIBUTE on that same element, so #922's gate does not
              reopen this. The class stays `__continue` even though the copy no longer always does: it
              names the design's FILLED TREATMENT slot (347:6692), which is what does not vary.
              #922 GAVE IT ITS HANDLER: on the last question it sends the assembled answer.

              THE GATE IS A CONJUNCTION, AND THE SECOND CONJUNCT IS WHAT KEEPS THE PANEL FROM
              DEADLOCKING. Unavailable only in the Continue ROLE when the batch is short an answer or
              its host is unavailable. Gating Next as well would strand
              the operator on question 1 with no way to reach question 2 to answer it — so the batch could
              never become complete. Stepping is never gated on what has been picked; neither is Previous.
              The handler needs no null-guard beside `disabled`: `answerQuestionBatch` refuses the same
              incomplete result that produced `canAnswer === false`, so the two cannot disagree. */}
          <button
            type="button"
            className="button-small question-panel__continue"
            disabled={isLastQuestion && (!canAnswer || !responseAvailable)}
            onClick={isLastQuestion ? onAnswer : () => onQuestionSelected(activeIndex + 1)}
          >
            {isLastQuestion ? QUESTION_CONTINUE_COPY : QUESTION_NEXT_COPY}
          </button>
        </div>
      </div>
    </div>
  )
}
