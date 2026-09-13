# Permission modal (#224, answerable since #237, second-confirm since #226, rejection surface since #249, confirm marker scoped to its prompt since #511)

Permissions and trust requests appear in the open conversation's bottom message-input area.
[`PermissionModal.tsx`](../../../src/renderer/src/screens/conversation/PermissionModal.tsx) keeps its
original component names, but renders a nonmodal panel since
[#1356](https://github.com/pyrycode/pyrycode-desktop/issues/1356). Part of
[Conversation shell](conversation-shell.md); the [questionnaire](conversation-shell-question-panel.md)
shares its presentation styles while keeping its own requests, picks and answer protocol.

The [modal store and bridge](modal-store-bridge.md) still deliver prompts app-wide through
`useModalBridge` in `App.tsx`. `PermissionModal({ conversationId })` renders the first outstanding
prompt whose `conversationId` matches the open chat. A null conversation renders no permission or
rejection surface. Other chats' requests stay pending and retain the sidebar's
[Input required indication](conversation-status.md); arrivals never navigate to them.
Answering, cancelling or remote dismissal advances to the next outstanding request in that chat.

## Presentation

`ComposerSlot` mounts `PermissionModal` through `Composer`'s `beforeComposer` seam. The panel takes
precedence over a waiting questionnaire and covers the normal composer. The still-outstanding
questionnaire and its model footer remain mounted inside a native `hidden` wrapper; the composer
also stays mounted and hidden. Resolving permissions restores the questionnaire at its active
question with its picks and Other text, or the typed composer draft when no batch remains. See
[Composer placement](conversation-shell-question-panel.md#composer-placement) for these lifetimes
and keyboard/accessibility isolation.

`PermissionModalView` is a pure view, rendering a `section` with `role="region"` labelled by its title.
There is no centred dialog, dimmed backdrop or modal focus boundary; the chat history and sidebar
remain usable. The approved adaptation of
[Figma node 347:6913](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6913)
uses the Pyry mark and title row, bordered content box, native single-choice rows, separator and
trailing outlined Cancel / filled Continue actions. It omits Other, question tabs and Previous/Next.
The supplied default has visible “Default” copy; it is not preselected.

The permission variant is capped at `60vh`. Its explanation and supplied options scroll inside
`.permission-panel__content`, while the title row, separator and actions stay outside that scrollport.
An unusually tall title has its own `15vh` scroll bound. Both prompt and confirmation explanations
use `white-space: pre-wrap` with `overflow-wrap: anywhere`, preserving the full text and wrapping
unbroken paths. These overrides are permission-specific; the normal questionnaire layout is unchanged.
Titles, explanations and option labels remain escaped React children, including the selected label
quoted in confirmation. No daemon text supplies markup or an attribute.

## Selection and confirmation

Continue, Confirm and server-bound Cancel require the prompt conversation's uniquely stamped host
to report `connected` in `SessionState.statuses` ([#1381](https://github.com/pyrycode/pyrycode-desktop/issues/1381)).
`promptResponseAvailability.ts` uses `serverIdForOpenConversation`; missing/unstamped or duplicate
ownership, absent status, connecting, disconnected and error all block responses. Neither aggregate
status nor another connected host supplies a fallback. The hook updates native disabled controls;
each response handler also rereads ownership and status synchronously before calling a resolution
helper, with no intervening await. A confirmation opened before disconnect cannot send afterward,
including by keyboard. A blocked attempt emits no answer/cancel command and does not resolve the prompt.

Selection editing, local Back and rejection-feedback Dismiss remain usable offline. Disconnect
preserves the held prompt, selection, confirmation and hidden composer draft. Reconnect retains the
[bridge reset and daemon re-delivery](modal-store-bridge.md#configuration-and-usage) contract; it never
submits a blocked response automatically. A re-delivered prompt needs a fresh explicit response under
the selection and confirmation rules below. Chat-switch remounts still reset local selection and drafts.

`PermissionModalView` receives `selectedOption`, `pendingOption` and injected handlers; both modes
remain statically renderable. The container owns selection and confirmation separately:

- Initially nothing is selected and Continue is disabled. Selecting a native radio row records one
  supplied option and sends nothing. The client-owned `name="permission-choice"` groups the radios
  separately from any hidden questionnaire controls.
- Continue calls the existing `selectOption` gate. Selecting the supplied `defaultOptionId` and then
  continuing sends that option directly, even when the supplied default is affirmative. The client
  does not infer the default from label wording.
- For any non-default, Continue opens Back/Confirm inside the same panel. Confirmation keeps the
  title and replaces the explanation/options with the client-owned sentence naming the selected
  label. Back sends nothing and restores the selection; Confirm sends that option.
- Cancel in the choice view calls `cancelPrompt`. Both answer and cancel retain the guarded send and
  unconditional optimistic `dismissed` dispatch in `modalResolution.ts` once availability passes. An answer contains one
  supplied `option_id`, with `modal_id` for correlation; main mints `answer_token`. Questionnaire
  free text and multiple picks never enter a permission answer.

Both local markers hold `{ modalId, optionId }`. `resolvePendingOption` validates request identity
and membership in the current option set on every render. Option IDs can repeat across requests,
so checking only option membership would let a confirmation authorize a different prompt. Invalid
markers are also cleared: merely rendering them as inert would let a removed option revive when a
later same-request delivery restored it. Chat switches retain the existing pane remount behavior
and require a fresh permission selection.

## Rejection surface (#249)

Optimistic removal can precede a daemon rejection, so feedback has an independent lifetime from
`outstanding`. The main-side [rejection correlation](daemon-connection-correlation.md#modal-answer-rejection-correlation-248)
emits only `modalAnswerRejected{modalId}`. `ModalState.rejections` retains arrival-ordered,
de-duplicated IDs; `rejectionOwners` retains their `{ modalId, conversationId }` ownership. On the
first `rejected` event, `reduceModal` copies the owner from the outstanding prompt or its resolved
record. No prompt text is retained for the banner.

A render-time join against `resolved` is insufficient: reconnect clears that server's resolved
suppression records while the feedback remains. The separately recorded owner survives reconnect
with its rejection, so switching away and back still shows it only in the originating chat. An ID
whose ownership is unknown when rejection arrives stays unattributed and has no visible banner.
Dismiss removes the rejection and its owner locally, without a command; pairing reset clears both.
See [Modal-prompt model](modal-prompt-model.md#types) for the state and reducer contract.

`RejectionSurfaceView({ rejections, onDismiss })` renders one `role="alert"` banner per visible ID,
with the fixed copy “Your answer was rejected.” and Dismiss. IDs serve only as React keys and local
action arguments, never visible text. The `.modal-rejections` stack occupies normal flow above the
input panel, using the existing surface card and error-coloured leading border. Rejection feedback
alone never covers or hides the composer or questionnaire, and may coexist with the next permission.

## Verification

[`offline-held-responses.spec.ts`](../../../e2e/offline-held-responses.spec.ts) observes renderer
`sendCommand` calls as well as retained prompts/picks: observing only outbound daemon frames could
pass while broken if main rejected an offline renderer command. It covers both request classes,
pre-opened confirmation, keyboard attempts, unavailable ownership/status and another connected host.
Draft retention is asserted before switching chats, because pane remounts reset composer-local state.
Reconnect tests re-deliver prompts before explicit responses; reconnect alone must send nothing.
`promptResponseAvailability.test.ts` checks fresh store reads independently of native disabled buttons.

`PermissionModal.test.tsx` checks static region markup, supplied/default choices, initial disabled
Continue, confirmation and escaped text. `composerSlot.test.tsx` checks current-chat/null-chat
placement and retained hidden subtrees. Static renderer tests do not execute clicks, focus or layout.
[`permission-modal-answer-paths.spec.ts`](../../../e2e/permission-modal-answer-paths.spec.ts) drives
both request classes through the fake transport, including FIFO, option invalidation, chat switching,
cancel/remote dismissal, delayed rejection through reconnect, and questionnaire/draft retention.
It checks hidden controls are absent from role queries and cannot retain keyboard input or tab focus.

Long prose with spaces can pass a scroll test while a filename still overflows. The long-content
case uses a 180-character filename at 800×600 and compares explanation and scrollport `scrollWidth`
with `clientWidth` in both prompt and confirmation states, checks the actions remain in the viewport,
and verifies no answer is sent before confirmation.

Shared CSS classes do not identify the response protocol: permission locators use
`.permission-panel`; questionnaire locators in a drive that services both use
`.question-panel:not(.permission-panel)`. Both `real-claude-permission-modal.spec.ts` and
`real-claude-question-cancel.spec.ts` choose a supplied affirmative row, Continue, then Confirm when
needed. Live permission proof requires the existing tool effect, not just disappearance of the
optimistically removed panel; an all-skipped real suite cannot establish it. See the
[live test runbook](live-e2e-runbook.md).
