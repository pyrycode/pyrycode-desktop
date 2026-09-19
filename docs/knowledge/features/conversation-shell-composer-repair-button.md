# Conversation shell — actionable-error button (#963)

Split from [Conversation shell — composer status row and error slot](conversation-shell-composer-status.md)
on 2026-09-15 to stay under the size cap. Part of [Composer](conversation-shell-composer.md); see the
parent page for [the status row](conversation-shell-composer-status-row.md),
[the connection-error chip](conversation-shell-composer-error-chip.md) this button replaces, and the
slot's other occupants.

## Actionable-error button, and the row that grows to fit it (#963)

**An actionable connection error becomes one button in the chip's slot.**
`Pairing error - Re-pair` requires a non-retryable `pairing-rejected` error.
`Connection error - Reconnect` handles other non-retryable errors except `unpair`
and `not-paired`. Retryable errors and those two exclusions keep the existing chip.
The [pure gates](composer-send.md#5-re-pair-gate--shouldofferrepair-167) are disjoint.
A bare fatal close, including 4421 or 4401, is not evidence of broken pairing;
only the sealed invalid-token rejection establishes the repair branch.

**`ComposerErrorSlot`** checks repair, reconnect, then the connection-error chip,
followed by the unchanged [connected-only priority](conversation-shell-composer-status.md#model-settings-rejection).
Its injected `status`, `onRepair` and `onReconnect` keep the view statically testable;
the container owns store reads and actions. Both buttons reuse
`button-small button-small--error`; the old beneath-composer `RepairPrompt`,
`RepairControl` and `.composer__repair` remain retired.

**Error fields select a branch, never markup.** The predicates read `.retryable`
and `.code`, but button content comes only from the client-owned copy constants.
Sentinel messages on both branches and a sentinel code on Reconnect must reach no
markup or attributes. The repair test needs the actual `pairing-rejected` code;
replacing it with an arbitrary sentinel would silently test Reconnect instead.
Visible text supplies each accessible name, with no `aria-label` or hidden prefix:
both labels already say “error”. The banner owns the disconnect announcement.

No fourth component for the button markup itself (`ComposerRepairButton` was considered and dropped): six
lines of markup with no branch of its own would add a name and a test surface without adding a decision.

**`ComposerErrorSlotControl({ onRepairHost, onCommand })`** owns the slot's store reads.
Its connection status comes from `useOpenConnectionStatus`, the same hook used by the composer
send gate and connection banner: resolve the open conversation's client-stamped server, then read
that server's status. Missing or ambiguous attribution renders disconnected. A different host's
failure cannot disable this thread or give it a recovery button. See
[Session store](session-store.md#one-slot-per-server-since-1133).

`handleRepair` re-resolves the open conversation's server at click time and calls
`onRepairHost(serverId)` when it is attributable. It never calls `runUnpair` or clears stores.
The shell opens [recovery beside the sidebar](paired-shell-routing.md#host-recovery-and-navigation-lifetime),
using the existing pairing input and fingerprint confirmation. Cancel returns to the prior thread;
same-host confirmation replaces credentials and reconnects while preserving held conversations.
Explicit host removal remains in Settings.

`handleReconnect` also re-reads the active conversation and conversation list at click
time. `serverIdForOpenConversation` must find one unique owner before it invokes
`window.pyry.reconnectServer(serverId)`; missing or ambiguous ownership is a no-op.
It awaits the existing named-host bridge without navigating to recovery, unpairing,
clearing credentials/stores or setting optimistic connection state. Main-process
lifecycle events remain authoritative. A rejected bridge call emits only the fixed
`composer-reconnect-failed` / `bridge-rejected` diagnostic, with no error details.

`COMPOSER_REPAIR_BUTTON_COPY` and `COMPOSER_RECONNECT_BUTTON_COPY` live beside the
connection copy in `composerSend.ts`; see [Composer send § 9](composer-send.md#9-actionable-error-button-copy-composerrepairbuttoncopy-963).

### The row grows to fit the button, and only then

`.composer-status` changed two declarations: `height: 24px` → `min-height: 24px` (the 32px button then
sets the row's height when present, and nothing else does — no `--tall` modifier, since the button being
in the slot *is* the state), and `align-items: center` → `align-items: flex-end`, the Figma frame's own
`items-end`. The alignment change alone would have dropped the status label 4px at the taller height, so
`.composer-status__activity` gained `min-height: 24px` of its own (the Figma status group's own height,
`112:3530`) — through #796 the group had no height and `align-items: center` produced its 24px box for
free; under `flex-end` that equivalence breaks unless the group states its own floor. With it, the 16px
line centres in a 24px box whose bottom edge is the row's, at both 24 and 32, which is the whole of "the
label does not move" (AC3).

**Chip and button share a base class, extracted on its second consumer.** `.button-small` — reset, M3
body/small-emphasized type, `border-radius: var(--radius-xs)`, `white-space: nowrap`, `flex: 0 0 auto` —
is the same nine declarations the question panel's `.question-panel__cancel`/`__previous`/`__continue`
already shared as one three-selector rule; see
[Question panel § Step controls](conversation-shell-question-panel.md#step-controls-916) for that side of
the extraction. `.button-small--error` is the design's `Type=Error` fill: `background:
var(--color-on-error)`, `color: var(--color-error)`, hover swaps the fill to
`var(--color-error-container)` (already a token, from #797's chip). Padding stays out of the base class —
the panel's outlined pair needs 7px against the filled pair's 8px to compensate for a 1px border under
this repo's absent box-sizing reset, so sharing padding would silently break that compensation. No
`outline: none` anywhere in either rule: AC3 requires a visible focus ring and the Figma component set
draws no focus state of its own, so the UA ring is the treatment.

**New token: `--color-on-error: #690005`**, `tokens.css` beside `--color-error`/`--color-error-container`,
read from the Figma **variable** bound to node `354:7088`, never the generated export's `white` fallback
— the light scheme, and a starker instance of the trap `--color-error-container`'s own comment already
warns about (a white button where the design draws near-black red).

**Re-measured rather than assumed, twice.** The truncation chain #797 measured with the chip up (`flex: 1
1 auto; min-width: 0` on the activity group, `flex: 0 0 auto` on the trailing occupant) was re-measured
with the wider button up, the same way: a 3000-char daemon tool name, headless Chromium, the 800px minimum
window width. The row stays 640×32; the button is unshrunk at **167.88px** (not the ~157px the Figma frame
suggested — the standing Roboto→system-ui substitution, the same drift #797's chip measured at 155
against its own 148px node); the activity group absorbs the whole squeeze at 448.13px and the label inside
it at 426.13px; neither `.conversation` nor `document.body` overflows. Separately, the ticket's own
premise that "the message box moves 8px on this transition" turned out wrong in both size and cause:
measured in `e2e/unpair-repair.spec.ts` at the time, the box moved 20px **upward**, and none of it was the
row's own 8px — the same status change also mounted [the connection banner](conversation-shell-chrome.md#connection-banner-279)
above the thread and, through [#968](../codebase/968.md), the composer's own `Connection error` caption,
and the row's 8px alone was absorbed by `.conversation__thread`'s `flex: 1 1 auto; min-height: 0`. #968
retired that caption — the banner is now the only other mover on this transition, and the stale 20px
figure was deliberately not re-measured, since no e2e assertion pins the box's absolute position: doing so
would be pinning the banner's geometry under a name that claims to be about this row; the row's own two
facts (height, and the status group's offset from the row's bottom edge) are what
`e2e/unpair-repair.spec.ts` asserts instead, both relative to the row.

**Testing.** `composerSend.test.ts` proves the disjoint gate matrix, including
retryability, all non-error statuses and both exclusions. `ConversationScreen.test.tsx`
checks exact button markup, mutual exclusion, sentinel isolation and lower-priority
occupants. Store-bound static renders must spy on `getInitialState`, not merely
call `setState`: Zustand v5 reads the initial snapshot under `renderToStaticMarkup`.
Stage `pairing-rejected` for repair, an ordinary terminal code for reconnect, and a
retryable error for the chip; all three are different test subjects.

**`e2e/unpair-repair.spec.ts` owns clicks and geometry.** Repair scenarios send a
sealed `auth.invalid_token` frame and open the existing host-recovery flow. Bare
4421 and 4401 closes instead show Reconnect with two hosts paired. After clicking,
wait for Send to become enabled and the selected host's authenticated connection
event before asserting that only that host redialled, both saved hosts and the draft
remain, and neither unpair nor recovery navigation occurred. Button disappearance
alone would also pass during connecting and cannot prove completion.

At 800px width the reconnect scenarios assert a 24px resting row becoming 32px,
the status group's bottom flush with the row and the icon's unchanged bottom offset.
The longer reconnect label uses the existing Error treatment without new CSS.
The repair scenario also checks the focus ring: Chromium paints it after keyboard
input, so press a key before calling `.focus()` in that assertion.

Other history and precedence scenarios must make the same fixture distinction:
a terminal transport error tests Reconnect priority; a repair-cancellation test
requires the sealed rejection. Bare 4401 cannot stand in for invalid credentials.
