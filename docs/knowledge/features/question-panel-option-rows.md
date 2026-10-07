# Question panel — Option rows (#907, live since #912, Other-typing ticks since #1698)

Part of the [inline question batch](conversation-shell-question-panel.md). Every question has its own
option list and Other row; shared control styles also serve the [permission panel](conversation-shell-permission-modal.md).

## Option rows (#907, live since #912)

`question.options.map(...)` draws each offered row under its question text, then Other unconditionally.
A row combines a 20×20 decorative radio/checkbox control with a label/optional-description stack.
Empty descriptions draw no element. Both text lines use on-surface colour; font weight distinguishes
them. Question and option keys use array positions, never daemon-authored headers or labels.

Offered rows are implicit `<label>` elements containing visually hidden native inputs. Their
accessible names come from visible escaped text rather than `aria-label={option.label}` or a generated
lookup ID. `checked` is driven by that question's stored selection; `onChange` dispatches an edit with
both question and option positions. The decorative dot/tick is `aria-hidden`. Each inline card uses
its own client-owned `question-panel-option-${questionIndex}` name, including Other, so native arrow
keys stay within the card. A shared name would merge independent single-choice questions in the browser
even if store updates appeared independent.

Other cannot wrap its whole row in one implicit label: a label activates its first labelable
descendant, making a click into the text field toggle the choice. Only its tick has a label wrapper,
with client-owned accessible name `Other`. The text input has accessible name `Other. Type something.`
and, in the inline layout, placeholder `Type your answer` beside a visible Other label.
The input is controlled from `otherText`; operator text stays escaped as its React value.

Typing dispatches `otherTextChanged` with the current question's `multiSelect` flag. It ticks Other
even when the field is emptied. Single-select typing clears offered picks; multi-select typing retains
them. Un-ticking Other or choosing a single-select offered option retains the text. Completeness
requires ticked, trimmed nonblank text; a draft alone does not answer a question.

`optionPickEventFor` and `otherPickEventFor` map each variant to its named store arm:
`optionPicked`/`otherPicked` replace in single-select; `optionToggled`/`otherToggled` accumulate in
multi-select. These pairs have identical payload shapes, so choosing the wrong arm compiles; direct
mapping tests prevent that transposition. `QuestionPanelSlot` checks current batch identity, active
conversation, permission precedence and valid positions before every edit. Local edits deliberately
remain available offline while answer/refusal controls require host availability.

## Styling and focus

The decorative controls use a tertiary ring; radios have a full radius and checkboxes retain the
4px structural radius. The field's tinted ground uses the on-primary token on a dedicated
`::before` at opacity 0.41, preserving the text's opacity. Inline Other sizing and body-large action
styles are scoped to `.question-batch` because changing shared `question-panel__*` rules changes
permission controls too.

The Other field's focus ring uses `outline-offset: -1px`: the row clips overflow and an external
outline would lose its right/bottom edges. Offered rows use
`.question-panel__option:has(.question-panel__input:focus-visible)` to show focus on the real row
click target; a ring around the clipped control alone would lose its left edge. The renderer is a
known Chromium with `:has()` support.

The primary-container placeholder colour retains the previously measured 1.78:1 contrast against its
ground. That is a known design limitation; the accessible name and inline visible Other label do not
improve the placeholder's sighted contrast. Long option text wraps without a row-count cap beyond the
transport frame cap. The full batch now grows inside history rather than squeezing or covering the
composer. No client expiry is drawn; request expiry belongs to the daemon.

## Verification

`QuestionPanel.test.tsx` statically renders all cards, unique group names, escaped hostile text and
the one gated Cancel/Continue row. Renderer tests run in Node without effects, focus or clicks;
`composerSlot.test.tsx` uses store instances seeded at creation because Zustand's server snapshot
otherwise ignores a later singleton seed. `QuestionPanelSlot.test.tsx` captures callbacks to verify
stale ownership and draft guards, independently of browser interactions.

`questionPicksStore.test.ts` proves replace/accumulate and Other typing/toggle behavior.
`e2e/question-picks.spec.ts` exercises native radio keyboard independence, multi-select, typing,
chat-switch retention, fresh replacement, shorter redelivery and remote dismissal. The answer and
refusal specs check the outbound command and optimistic removal while the composer stays available.
`permission-modal-answer-paths.spec.ts` verifies all-question draft restoration and isolation of
hidden questionnaire/composer controls; `offline-held-responses.spec.ts` verifies local edits and
guarded responses against the owning host. See [recorded verification](development-verification-test-tiers.md#inline-question-verification).

Daemon fields remain escaped React children; drafts, request IDs and answer content are neither
persisted nor logged. Array-position control identity closes the label-as-key trap while implicit
labels keep accessible names off the daemon-text attribute path. Synthetic test captures contain no
live conversation content.
