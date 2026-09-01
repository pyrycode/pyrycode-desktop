import { PyryMark } from '../../theme/PyryMark'
import type { Question } from '../../store/questionBatches'

// #906: the question panel's frame — the pure view half of the question vertical's render slice (Figma
// node 347:6913, the single-question instance). It draws the panel's chrome and nothing inside it: the
// title row, the bordered box with the question's own text, the separator, and an inert Cancel /
// Continue row. The option rows are #907's and the picks are #908's.
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
// UNTRUSTED TEXT, RENDERED — THIS SLICE IS WHERE THE ESCAPING IS OWED. `question.header` and
// `question.question` are CLAUDE-AUTHORED: they crossed the subprocess trust boundary and the daemon
// NEITHER BOUNDS NOR SANITIZES them. `questionBatchStore.ts` states the rule this file discharges — plain
// text only, never HTML (no innerHTML / dangerouslySetInnerHTML), never into an attribute, a URL, a
// filename, a cache key, a lookup path or a log. Both strings appear here as React CHILDREN and nowhere
// else, which is the whole boundary.
//
// NO `title` ATTRIBUTE ON THE QUESTION TEXT, and this is the one trap the component invites. The design
// clamps that text to a single line with an ellipsis (see .question-panel__question), and the reflex
// accompaniment to a clamp is `title={question.question}` so the full string is reachable on hover — which
// is claude-authored text in an ATTRIBUTE, the ban that survives a paraphrase least well. The full text
// becomes reachable in #907's box, which is where the clamp is reconsidered; until then the clamp IS the
// render, not a summary of a hidden tooltip. Same rule for `data-*`: nothing here carries an attribute
// derived from `header`, `question`, or `questionBatchId` — whose value is a one-time unguessable nonce
// this slice never reads at all.
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
