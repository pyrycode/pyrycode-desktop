# Question panel — inline batch

Part of [Conversation shell](conversation-shell.md), over the [question-batch model and picks
store](question-batch-model.md). Since [#1729](../../specs/architecture/1729-inline-questions.md),
clarification questions render together at the end of their owning conversation's scrollable history.
This supersedes the composer replacement, header tabs and stepping introduced by #906/#915/#916.
The [permission/trust panel](conversation-shell-permission-modal.md) shares the trailing-history seam
and takes precedence over the retained questionnaire.

`useQuestionBridge()` mounts unconditionally in `App.tsx`, beside `useModalBridge`, for the app's
lifetime. Requests for background conversations stay pending without navigating to them.

## Composer placement

`ComposerSlot` keeps the message box, attachments, status area and desktop footer visible during
either request type, under their existing connection and turn gates. Permission never covers the
composer. Reply actions focus its end caret immediately; permission dismissal and chat navigation
do not replay that focus. History loading and sidebar navigation remain usable.

`Timeline` accepts an optional `trailing: ReactNode` after its message and queued rows. The live
screen supplies `QuestionHistorySlot` for an open-chat pending batch, permission/trust or owned
rejection, including empty/offline history. Active-surface presence keeps history mounted and
suppresses the empty welcome; an always-mounted empty trailing wrapper would suppress it too.
The questionnaire is a transient trailing node, never a timeline item, paginated
history entry or saved message. Offline saved messages can appear above it without saving its content.

`QuestionHistorySlot({ conversationId })` renders `PermissionModal` before the questionnaire's
native `hidden` wrapper. Current-chat permission/trust hides only that wrapper; the pending full
batch stays mounted with all picks and Other text in its memory-only store. Resolving the last
permission restores every still-pending question card. Remote dismissal while hidden leaves no
questionnaire to restore. The composer's typed draft and attachments stay available throughout.

Native `hidden` removes controls from layout, keyboard focus and the accessibility tree;
`aria-hidden` alone would leave invisible inputs keyboard-active. The question wrapper has no author
`display` override. Rejection feedback alone never hides the questionnaire. Composer text survives
chat navigation in its host/conversation-keyed draft store without leaking into the other chat;
question picks survive pane remounts in `questionPicksStore`.

The screen reads pending-batch and permission/rejection presence for empty-history placement. `QuestionHistorySlot`
reads the batch and permission state; `QuestionPanelSlot` alone subscribes to
`selectBatchSelections(batch.questionBatchId)`. Other-field keystrokes therefore stay in the panel
leaf rather than re-rendering the whole message history or composer. Store selectors compare results
by `Object.is`; held objects/maps and shared empty sentinels avoid a fresh result on every read.

## All-question presentation

`QuestionPanelView` is a pure exported view taking `questions`, the batch's `selections` map,
`canAnswer`, `responseAvailable`, and position-addressed edit and batch-response callbacks.
Every card renders in server order beneath the client-owned “Claude has questions” heading, with
its PyryMark/header, question text, offered options and final Other row. A single centered
Cancel/Continue row follows the whole batch; there are no tabs, Previous/Next controls or active index.

Question and option React keys use array positions. Native radio names are
`question-panel-option-${questionIndex}`, including each question's Other tick, so keyboard and
single-choice selection in one card cannot clear another card. Daemon-authored headers, question
text, labels and descriptions are escaped React text children, never identifiers, attributes,
URLs or raw markup. The request nonce is only a React remount key/correlation value and reaches no
DOM attribute or log. See [option rows](question-panel-option-rows.md#option-rows-907-live-since-912)
for the native control and Other selection behavior.

[Figma 756:8626](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-8626)
is the inline design. Theme typography, spacing, controls and input tokens supply the card stack,
tertiary headers, surface boxes with primary-container borders, Other label/field and body-large
actions. Scope these overrides to `.question-batch`: permission controls share `question-panel__*`
classes, so changing the shared selectors would also change the permission panel. The inline question
text wraps rather than retaining the old single-line clamp.

## Request lifetime and activation

Fresh requests retire the previous batch for that conversation. The app's batch-store retirement
callback clears its picks before publishing the replacement; same-ID redelivery keeps selections.
Resolution iterates the current questions and offered positions, excluding removed questions/options.
This makes a shorter redelivery safe without introducing a second draft reconciliation store.
Dismissal and reconnect clear drafts; a fresh request cannot inherit a retired draft.

Every edit/response closure captures its batch object. `isCurrentQuestionBatch` requires the active
conversation to match, the current owning store entry to be that exact object, and no outstanding
permission/trust prompt in that chat. Edits additionally check the question and option positions.
Comparing only the nonce would accept callbacks from a previous same-ID delivery after its positions
changed. Checking only the batch would accept retained handlers after navigation. Both checks are
needed to prevent stale edits recreating cleared picks or answering/refusing a replacement or another
conversation. Main independently routes responses using its existing correlation owner.

Response activation also rereads the owning host's availability. Continue recomputes answers from the
current picks immediately before the synchronous send; it never consumes the render-time payload.
A duplicate activation sees the cleared batch and does nothing. Local edits remain available offline,
but unavailable response activation sends nothing and preserves both stores.

## Option rows (#907, live since #912, Other-typing ticks since #1698)

Single-select replaces a pick; multi-select toggles offered choices independently. Typing into Other
ticks it, clearing offered picks only in the single-select shape. Un-ticking Other keeps the draft.
Blank Other text cannot supply an answer. See [Option rows](question-panel-option-rows.md) for the
accessible names, event mapping, tinted field and focus-ring rules.

## Cancel refuses the batch (#921)

Cancel refuses the whole request via `refuseQuestionBatch`. Both its disabled state and activation
require the conversation's unique stamped owner to be connected; another connected host cannot
enable it. Missing/ambiguous ownership or unavailable status blocks the response without clearing
picks. See [Cancel refuses the batch](question-panel-cancel-refusal.md) for the command and local clear.

## Continue answers the batch (#922)

`resolveQuestionAnswers` is the sole completeness and payload computation. Continue requires every
question to contribute an offered choice or ticked, trimmed nonblank Other text, plus host availability.
Answers travel together in question-index order, with offered labels in display order and Other last.
See [Continue answers the batch](question-panel-continue-answer.md) for removed-position filtering.

An attempted answer/refusal clears picks first, then the batch, even if the bridge throws. Those are
optimistic local effects, not acknowledgement that the daemon received the response. No resolved-ID
memory or asynchronous sending lock suppresses legitimate retries. Disconnect retains the pending
batch and local edits; reconnect clears both stores before the daemon reasserts unresolved requests,
which need fresh picks and explicit response. Drafts, request IDs and answers enter neither disk nor logs;
send-failure logs contain only fixed event strings.

## Verification

Static renderer tests cover all cards, independent group names, escaping, the gated action row,
trailing history placement, visible composer/footer and the hidden questionnaire. `QuestionPanelSlot.test.tsx`
drives captured callbacks against real stores for replacement, duplicate response, redelivery,
reconnect, permission precedence and navigation; it does not pretend to exercise browser focus.

The existing fake-transport question, offline and permission specs prove native keyboard groups,
all-question validation, ordered/trimmed answer and refusal frames, navigation retention, replacement,
shorter redelivery, offline activation, hidden-input isolation and scrolling. See
[recorded coverage and Figma comparison](development-verification-test-tiers.md#inline-question-verification)
and [scroll pin](conversation-shell-scroll-pin.md#inline-question-growth) for the reader-position and
observer-retention details. Both [real-Claude specs](real-claude-liveness-e2e.md) address inline cards;
their continuation proof must be established by counted live results in the
[live runbook](live-e2e-runbook.md#current-real-claude-gate-state).
