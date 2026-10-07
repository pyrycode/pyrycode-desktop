# Permission modal (#224, answerable since #237, second-confirm since #226, rejection surface since #249, confirm marker scoped to its prompt since #511)

Permissions and trust requests appear after message and queued rows in the open conversation's thread.
[`PermissionModal.tsx`](../../../src/renderer/src/screens/conversation/PermissionModal.tsx) keeps its
original component names, but renders a nonmodal panel. Inline placement in
[#1818](../../specs/architecture/1818-inline-permission-grants.md) supersedes #1356's input-area placement. Part of
[Conversation shell](conversation-shell.md); the [questionnaire](conversation-shell-question-panel.md)
shares its presentation styles while keeping its own requests, picks and answer protocol.

The [modal store and bridge](modal-store-bridge.md) still deliver prompts app-wide through
`useModalBridge` in `App.tsx`. `PermissionModal({ conversationId })` renders the first outstanding
prompt whose `conversationId` matches the open chat. A null conversation renders no permission or
rejection surface. Other chats' requests stay pending and retain the sidebar's
[Input required indication](conversation-status.md); arrivals never navigate to them.
Answering, cancelling or remote dismissal advances to the next outstanding request in that chat.

## Presentation

`QuestionHistorySlot` mounts `PermissionModal` before the retained questionnaire inside
`Timeline.trailing`. A current-chat permission, pending questionnaire or owned rejection keeps the
thread mounted even with empty/offline history. These transient surfaces never enter saved history
or pagination. Mount the trailing wrapper only while one is present: even an empty React element
counts as trailing content and would suppress `Timeline`'s normal empty state. Keep the wrapper
stable across active surfaces so the scroll observer sees leaf-only growth.

Permission precedence hides only the questionnaire through a native `hidden` wrapper, removing its
controls from layout, keyboard focus and accessibility while retaining every pick and Other draft.
The composer, attachments, status area and desktop footer remain visible under existing send and
connection gates; typed text survives permission arrival and resolution. Reply actions focus the
composer immediately, with no focus/caret replay on dismissal or chat navigation. See
[Composer placement](conversation-shell-question-panel.md#composer-placement) for draft lifetimes.

`PermissionModalView` renders a `section` with `role="region"` labelled by its title.
The chat history and sidebar remain usable. The desktop adaptation of
[Figma node 756:9170](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=756-9170)
uses a background card with primary-container border, title, explanation, optional context and
session grant, then full-width choice buttons in server order. The supplied `defaultOptionId`
uses primary/on-primary fill, other choices have a primary outline, and the armed choice uses
secondary-container tonal fill. An outlined Cancel follows outside the card. Choice buttons replace
the radios, Continue and separate Back/Confirm screen for permission and trust requests
([#1817](https://github.com/pyrycode/pyrycode-desktop/issues/1817)); questionnaire controls remain independent.

Optional context appears below the prompt in body-medium text using the on-primary-container
colour and existing spacing tokens. String `reason` values display directly; other supplied JSON uses compact JSON text,
including `null`, `false` and `0`. Presence must not be tested by truthiness. Missing fields create no
empty rows; when all display fields are absent, the context container is absent too.

`reasonType` is independent of the reason and selects the following explanation:

| Supplied category | Explanation |
| --- | --- |
| `classifier` | The auto classifier could not approve this |
| `rule` | A permission rule asks |
| Any other string | Reason type: &lt;supplied category&gt; |

A supplied reason follows the category explanation after `: `; a category without a reason still
shows its explanation. A reason without a category uses `Reason: <reason>`. Never infer a category
from prose or a path. `description` has its own secondary text row and `blockedPath` a separate line,
each independent of reason/category presence. The [bridge](modal-store-bridge.md#the-translator--binding-srcrenderersrcstoremodalbridgets)
and [prompt model](modal-prompt-model.md#types) preserve these optional fields through both copies.

The complete card, including title, explanation, context, grant rules, choices and external Cancel,
scrolls with the thread; there is no permission height cap, title cap or inner scrollport.
Permission's outer padding is zero so its border and Cancel align with the message column rather
than inheriting the shared questionnaire inset. The card keeps its inner padding and tokens.
Titles, explanations, context, option
labels and complete rules wrap with `white-space: pre-wrap` and `overflow-wrap: anywhere`.
All supplied text remains escaped React children. Context is display information only: no markup,
attributes, URLs, filesystem operations, logs or outbound commands consume it. ARIA IDs and
second-activation instructions are client-owned constants.

## Selection and confirmation

The supplied default answers on one activation, including an affirmative default. Any other choice
requires two activations of that same button: the first arms it without sending, and the second
calls `confirmPrompt` exactly once. Choosing another non-default arms that choice afresh. The armed
button references a fixed `role="status"` instruction through `aria-describedby`:
“Activate this choice again to confirm.” Labels and server order never determine the default.
Cancel calls `cancelPrompt`; answer/cancel retain guarded sends and unconditional optimistic
`dismissed` dispatch after admission. Main mints `answer_token`; questionnaire free text and
multiple picks never enter a permission answer.

Choice, grant-checkbox and Cancel controls require the prompt conversation's uniquely stamped host
to report `connected` in `SessionState.statuses`. Missing/unstamped or duplicate ownership, absent
status, connecting, disconnected and error all disable these controls. Aggregate status and another
connected host never supply a fallback. Rejection-feedback Dismiss remains a local action offline.
A status-only disconnect holds the request and drafts but blocks all consent editing and sending;
reconnect's scoped clearing and daemon re-delivery require a fresh response and never submit one
automatically.

For each newly displayed `modalId`, `defaultToNo: true` initially focuses Cancel once, provided
responses are available. An absent or false hint leaves focus alone. The view records the displayed
identity even when offline: availability or same-request context/hint updates never rerun initial
focus. Unmounting resets that record; queued requests and chat-switch remounts get their own initial
focus decision. Focus uses `preventScroll: true` so a scrolled-up reader stays in place; inline
growth follows only pinned readers. See [thread scroll pin](conversation-shell-scroll-pin.md#thread-scroll-pin).
The hint neither changes the supplied default nor bypasses two-activation choices.
Native button Enter/Space supplies deliberate activation; there is no panel-wide approval shortcut.
Enter on focused Cancel only cancels.

`PermissionModalView` receives an armed option, availability, checked consent and injected handlers;
its output is statically renderable. The per-pane Zustand controller in
[`permissionChoices.ts`](../../../src/renderer/src/screens/conversation/permissionChoices.ts)
holds `armedOptionId` and an `opted` prompt snapshot. While mounted it synchronously subscribes to
modal, active-conversation, conversation-list and session stores. Navigation and cleanup clear
arming and local snapshots and invalidate callbacks; returning requires two fresh activations of a
non-default even when the checkbox stays checked.

[`createPermissionConsent`](../../../src/renderer/src/screens/conversation/permissionConsent.ts)
holds checked outstanding prompts with their unique stamped host in renderer memory for the app-process
lifetime. Its production instance lives beside `PermissionModal` and synchronously observes
`modalStore` and `conversationListStore`, independently of mounted panes. Admitted checkbox actions
alone populate it. Removal/resolution, answer/Cancel, replacement, ordered option IDs/labels,
default/class/conversation changes, ordered rules or offer-eligibility changes, reconnect clearing,
pairing reset and loss/change of unique ownership discard consent. An interrupted offer or owner
restored before React paints cannot revive a check, including while the chat is closed. Comparing
restored text only at remount would miss that transition. Status-only disconnect retains valid
consent while fresh availability guards disable editing and responses.

Every answer, checkbox and Cancel handler rereads the active displayed conversation, first outstanding
request for that chat, unique owner and current connection status synchronously. It requires the exact
displayed prompt object and the stamped host captured by its callback, validates current choice
membership or grant eligibility, and performs no await
between validation and action. An old callback cannot operate on a replacement, same-ID re-delivery,
another chat/host or a disposed controller. Prompt identity alone cannot reject an old callback after
an ownership change that leaves the prompt object intact; retained consent supplies no callback authority.
Identical/content-only re-delivery preserves valid arm/consent through
stable choice/offer identities but still makes callbacks holding the old prompt snapshot stale.

Controller construction through `useMemo` also calls its snapshot reader. That reader and subscription
refreshes derive availability directly from the stamped owner and per-owner status without IPC.
Calling diagnostic-emitting `canRespondToPromptNow` there would perform external I/O during repeated
or speculative React renders and unrelated store transitions. Choice/response diagnostics remain
content-free in action handlers; prompt content and grant drafts are neither persisted nor logged.

### Session permission checkbox (#1409)

For `class === 'permission'` with `alwaysAllow.offered === true`, one initially unchecked checkbox
covers the complete offer: “Don't ask again this session for:” followed by every escaped rule as an
ordered sequence of `<li>` children. It reuses `QuestionTick` and client-owned ARIA metadata. Trust,
absent and unavailable offers show no checkbox. Toggling edits only `opted`: it neither arms nor
answers and leaves an existing arm unchanged.

`hasSessionPermission(prompt, opted)` requires matching modal/conversation IDs, permission class,
a currently offered grant and reference equality of `alwaysAllow`. `reduceModal` preserves that
reference only for a continuous identical ordered offer with unchanged class, conversation, supplied
default and ordered option IDs/labels. It also preserves the options array identity for identical
choices. Display-only context re-delivery keeps both identities. Removal, changed/reordered rules,
eligibility changes or choice/default/class changes break offer identity; restoring the old text
allocates a new offer. Retention additionally requires the same options array, supplied default and
unique stamped host. Navigation clears arm but preserves a continuously valid check; synchronous
app-lifetime observation evicts ownership changes even if the offer object survives. See the
[model contract](modal-prompt-model.md#continuous-choice-and-offer-identity).

Only a checked, continuously current offer and twice-activated supplied `allow_once` or `allow_always`
can add `always_allow: true` through `confirmPrompt`. Unchecked approval, rejection choices, Cancel,
trust, unavailable offers and all one-activation default answers omit the field entirely, even when
the default is affirmative and the checkbox is checked. The renderer sends neither rules nor a
destination. The daemon remains the authority that validates grants, scopes them to the current
session and enforces remote-permission restrictions; no wire/schema change is involved.

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
inline permission card, using the existing surface card and error-coloured leading border. Rejection feedback
alone never covers or hides the composer or questionnaire, and may coexist with the next permission.

## Verification

`permissionConsent.test.ts` drives closed-pane invalidation and change/restoration, content-only
delivery, ownership loss/change, reconnect and reset. `permissionChoices.test.ts` drives retained
checks across pane disposal with fresh arming, stamped callback authority, default/second activation,
switching arms, grant omission,
ordered identity changes, change-then-restoration before render, navigation/ownership invalidation,
stale answer/checkbox/Cancel callbacks, offline guards and disposal. `PermissionModal.test.tsx`
checks static region markup, server order, filled/default and tonal states, fixed accessible
instructions, permission-only ordered rules, disabled controls, escaping and context with falsy JSON.
Its production-wiring regressions capture the actual controller during repeated populated/empty
static renders and count diagnostics, then manually start subscriptions and drive store transitions.
Static rendering alone cannot run effects, clicks, focus or scrolling.

[`offline-held-responses.spec.ts`](../../../e2e/offline-held-responses.spec.ts) observes renderer
`sendCommand` calls as well as retained prompts/picks: daemon-frame silence alone could pass while
main rejected an offline renderer command. It covers both request classes, a previously armed choice,
keyboard attempts, disabled checkbox/Cancel, unavailable ownership/status and another connected host.
Reconnect tests re-deliver prompts before explicit responses; reconnect alone must send nothing.

[`permission-modal-answer-paths.spec.ts`](../../../e2e/permission-modal-answer-paths.spec.ts) drives
choice buttons through fake transport, including grants, continuous-offer interruption/restoration,
navigation-retained checks with cleared arm, closed-chat invalidation, inline empty/offline placement,
FIFO, changed options, chat switching, cancellation/peer dismissal, delayed rejection through reconnect,
and questionnaire/composer draft retention. Browser assertions prove hinted Cancel focus once,
unhinted focus retention, native Enter/Space and no response before a non-default's second activation.
Keep hidden-input typing checks separate from initial Cancel focus: Space on focused Cancel cancels.
[`permission-resolution-notices.spec.ts`](../../../e2e/permission-resolution-notices.spec.ts)
retains notice lifetime/isolation proofs while answering via the new buttons.

Long prose alone can hide unbroken-path overflow. Minimum 800×600 cases include a 180-character
filename, long context, a 500-character unbroken rule and 15 additional complete rules. They compare
`scrollWidth` with `clientWidth`, scroll the last rule and every choice into view, and check checkbox
and Cancel reachability through thread scrolling, including the armed state. No answer may precede
the second activation. The inline arrival/growth case checks pinned arrival and arming, held-reader
Cancel focus and content growth, composer drafting, visible-checkbox edits and visible-choice arming.
See [current inline evidence](development-verification.md#inline-permission-verification) for the
verifier's counted browser results and integrated Figma captures.

The earlier [choice-controller verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1820#issuecomment-6025856890)
records all 13 scoped browser scenarios present and passed at `1cec0874`: permission paths 7,
offline responses 3 and resolution notices 3, each with 0 failed and 0 skipped. The full run executed
305: 304 passed, 1 unrelated flaky failure, 4 skipped; its selected rerun executed/passed 1, failed 0,
skipped 0. Unit evidence is 8,921 executed/passed, 0 failed, 3 skipped, including 37 permission-view
tests and both new snapshot-purity regressions. Those regressions failed against the original IPC read.

The [earlier visual review](https://github.com/pyrycode/pyrycode-desktop/pull/1820#issuecomment-6025235267)
compared desktop `756:9170` and supplementary grant/armed/trust/behavior states with integrated synthetic
captures at `60447236`: `/tmp/verifier-1820/{safe-default,armed,grant-unchecked,grant-checked}.png`
at 1280×800 and `{minimum-rules,minimum-armed,minimum-context-armed}.png` at 800×600, with dimensions
and hashes in `capture-manifest.json`. Filled/default, outlined/tonal choices, rules, checkbox states
and Cancel matched the requested adaptation. The final review retains that comparison because the
corrective commit changes no view markup/styles. Builder refreshed captures at `1cec0874` under
`/tmp/builder-1817/`. These are reviewed host scratch paths, not committed assets. Native Electron
capture once returned the preceding armed frame; the scoped spec uses Playwright screenshots for
the painted tonal state.

Shared CSS classes do not identify response protocols: permission locators use `.permission-panel`,
questionnaire locators `.question-panel:not(.permission-panel)`. The three migrated live consumers
in `real-claude-permission-modal.spec.ts`, `real-claude-permission-mode.spec.ts` and
`real-claude-question-cancel.spec.ts` now activate supplied choice buttons, twice when non-default.
Live acceptance requires the repeated Bash effect without a new permission in the same session,
then a fresh permission before an effect in a new session; panel disappearance alone is optimistic.
Before inline placement, all three named scenarios executed and passed in the dispatcher's
2026-10-06 choice-controller live run:
26 executed/passed, 0 failed, 1 skipped. See the
[counted live evidence](live-e2e-runbook.md#current-real-claude-gate-state) for named results and
the configured-command mismatch. Current inline acceptance and its remaining named-evidence gap
are recorded in [inline permission verification](development-verification.md#inline-permission-verification).
