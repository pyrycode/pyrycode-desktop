import { PyryMark } from '../../theme/PyryMark'
import type { Question } from '../../store/questionBatches'

// #906 / #907: the pure view half of the question vertical's render slice (Figma node 347:6913, the
// single-question instance). #906 drew the panel's chrome — the title row, the bordered box with the
// question's own text, the separator, and an inert Cancel / Continue row — and #907 filled the box's
// middle band with one row per offered option. The picks are #908's.
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
// strings, or from `questionBatchId` — a one-time unguessable nonce this file never reads at all. The two
// attributes below that DO carry copy (the Other field's placeholder and aria-label) are client-owned
// constants, which is exactly why they may be attributes.
//
// NOTHING HERE LOGS. No logger import, no `console.*` — the deliberate absence `questionBatches.ts`,
// `questionBatchStore.ts` and `questionBridge.ts` each record, for the same two reasons.

// Client-owned copy, in the app's own voice — deliberately constants rather than JSX literals, so the
// line between what the client says and what claude says is visible in the source of a file that renders
// both. Neither button dispatches anything this slice (#853 sends, #908 answers), and neither is
// `disabled`: the panel sits ON TOP of the composer, so there is nothing to disable and no disabled state
// to draw. The inert-buttons posture is #224's, so the answer path lands on a stable surface.
export const QUESTION_CANCEL_COPY = 'Cancel'
export const QUESTION_CONTINUE_COPY = 'Continue'
// The Other row's field copy (347:6386), a constant for the same reason: it sits in the one attribute pair
// this component writes, so the line between client-owned and claude-authored text has to be visible here.
export const QUESTION_OTHER_PLACEHOLDER_COPY = 'Other. Type something.'

/**
 * One outstanding question's frame. Takes the question itself, never the batch: a batch carrying several
 * draws its first, and choosing which is the container's job, so this view has no index to get wrong.
 *
 * NO EMPTY BRANCH AND NO NULL PROP, deliberately. `reduceQuestionBatches` returns state unchanged when
 * `questions` is empty — the guard sits before the match, so an empty re-delivery leaves a live batch
 * alone — which means `[]` never reaches `outstanding` even though the wire type admits it and the daemon
 * ships a `question_shown_empty.json` fixture. A defensive empty-state render here would defend a failure
 * mode the store makes unreachable.
 *
 * The title row draws exactly ONE label. The Figma's `Question labels` row (347:6829) has five slots and
 * a Previous control; in the single-question instance four labels and Previous are hidden, so there is no
 * tab SWITCHING here and no Previous — but the row itself is drawn, because omitting it would diverge
 * from the locked design.
 */
export function QuestionPanelView({ question }: { question: Question }): JSX.Element {
  // The ONLY difference between the two option variants (347:6696 Single / 347:6698 Multiple): same row
  // geometry, same 8px gap, same label-over-description stack, a differently-cornered control.
  const controlClass = question.multiSelect
    ? 'question-panel__control question-panel__control--checkbox'
    : 'question-panel__control question-panel__control--radio'
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
          {/* The batch's own header, in the row's Active treatment. DRAWN, never keyed on: a tab keyed by
              `header` is the exact "untrusted text in a lookup path" this family names, and with one
              label there is no list and so no key at all. */}
          <span className="question-panel__label">{question.header}</span>
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
            <div className="question-panel__option" key={index}>
              {/* The control is CHROME — a presentational span, not an <input type="radio">. These rows
                  respond to nothing this slice, and a native control at rest is focusable AND checkable:
                  a click would paint a selection the store does not hold, which is a worse resting
                  posture than #906's inert buttons, whose click leaves no residue. #908 lands the real
                  control together with the state that makes it honest. It has no child at all — nothing
                  is pre-selected, whatever the design's mock draws ticked (AC5). */}
              <span className={controlClass} />
              <div className="question-panel__option-text">
                <p className="question-panel__option-label">{option.label}</p>
                {/* An empty description contributes NO element. `description` is a required string, so ''
                    is legal traffic rather than an absent field, and a blank <p> would hold a line of
                    height for nothing. */}
                {option.description === '' ? null : (
                  <p className="question-panel__option-description">{option.description}</p>
                )}
              </div>
            </div>
          ))}
          {/* The Other row (347:6386 single, 347:6709 multi) — always last and INSIDE the list, wearing
              the variant's own control so it can later sit ticked beside ticked labels. This is not the
              separate `Other options` frame below the separator (347:6569 / 347:6711), which is hidden in
              both variants and in the shipped instance. The field is inert in #906's sense: real,
              uncontrolled, no handler, no `disabled`, and nothing reads it — the typed text and the
              ticked state are #908's, so here it is chrome that #908 makes live. */}
          <div className="question-panel__option">
            <span className={`${controlClass} question-panel__control--other`} />
            <div className="question-panel__other-field">
              <input
                type="text"
                className="question-panel__other-input"
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
          {/* Cancel leads, Continue trails, right-aligned (347:6657). type="button" on both so neither
              can ever submit an ancestor form. Their accessible name is their visible text. */}
          <button type="button" className="question-panel__cancel">
            {QUESTION_CANCEL_COPY}
          </button>
          <button type="button" className="question-panel__continue">
            {QUESTION_CONTINUE_COPY}
          </button>
        </div>
      </div>
    </div>
  )
}
