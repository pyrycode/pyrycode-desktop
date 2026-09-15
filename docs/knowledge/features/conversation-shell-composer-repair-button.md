# Conversation shell — actionable-error button (#963)

Split from [Conversation shell — composer status row and error slot](conversation-shell-composer-status.md)
on 2026-09-15 to stay under the size cap. Part of [Composer](conversation-shell-composer.md); see the
parent page for [the status row](conversation-shell-composer-status-row.md),
[the connection-error chip](conversation-shell-composer-error-chip.md) this button replaces, and the
slot's other occupants.

## Actionable-error button, and the row that grows to fit it (#963)

**An error the operator can act on becomes a button in the chip's own slot** (Juhana's ruling, 2026-09-02),
reading `Pairing error - Re-pair`, exactly when `shouldOfferRepair` is true. This retires
[#167's separate `RepairPrompt`/`RepairControl`/`.composer__repair` block](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963)
that used to sit beneath the composer — one escape hatch, in the slot the operator is already looking at,
rather than two surfaces for the same terminal state.

**`ComposerErrorSlot`** is the pure view for the trailing slot. Repair takes
precedence over the connection-error chip because `shouldOfferRepair` is a strict
subset of the error state. Retryable connection errors and `code: 'unpair'` still
get the chip. Connected-only occupants follow in the [status priority](conversation-shell-composer-status.md#model-settings-rejection)
below. Props keep this decision testable with static markup; the container owns
store reads.

**The error arm is read for a decision, never for markup.** `ComposerErrorChip` can state the stronger
"never destructures `status.error`"; this view cannot, because `shouldOfferRepair` reads
`.retryable`/`.code`. Both reads are confined to that predicate's boolean — no local in `ComposerErrorSlot`
binds `status.error`, and the button's text is `COMPOSER_REPAIR_BUTTON_COPY` and nothing else. A test on
the button arm with sentinel `code`/`message` values asserts neither reaches the markup, which is what
makes the guarantee falsifiable rather than a comment. No visually-hidden `Error: ` prefix on the button,
unlike the chip — the label already leads with "Pairing error", so the accessible name (the visible text;
no `aria-label`) says it is an error without one.

No fourth component for the button markup itself (`ComposerRepairButton` was considered and dropped): six
lines of markup with no branch of its own would add a name and a test surface without adding a decision.

**`ComposerErrorSlotControl({ onRepairHost, onCommand })`** owns the slot's store reads.
Its connection status comes from `useOpenConnectionStatus`, the same hook used by the composer
send gate and connection banner: resolve the open conversation's client-stamped server, then read
that server's status. Missing or ambiguous attribution renders disconnected. A different host's
failure cannot disable this thread or give it a repair button. See
[Session store](session-store.md#one-slot-per-server-since-1133).

`handleRepair` re-resolves the open conversation's server at click time and calls
`onRepairHost(serverId)` when it is attributable. It never calls `runUnpair` or clears stores.
The shell opens [recovery beside the sidebar](paired-shell-routing.md#host-recovery-and-navigation-lifetime),
using the existing pairing input and fingerprint confirmation. Cancel returns to the prior thread;
same-host confirmation replaces credentials and reconnects while preserving held conversations.
Explicit host removal remains in Settings.

**`COMPOSER_REPAIR_BUTTON_COPY = 'Pairing error - Re-pair'`** joins `composerSend.ts` beside
`COMPOSER_ERROR_CHIP_COPY` — see [Composer send § 9](composer-send.md#9-actionable-error-button-copy-composerrepairbuttoncopy-963).

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

**Testing.** `ConversationScreen.test.tsx` replaces the `RepairPrompt` describe with a `ComposerErrorSlot`
describe covering all three arms in both directions (occupant present *and* the other occupant's markup
absent) plus the sentinel/no-attribute cases above; the `ComposerErrorChip` describe and its `disconnected`
container assertion are untouched. **One #797 container assertion did not survive as originally planned**
— the ticket expected both chip container assertions to stay true unedited, but the error-arm one staged
`code: 'transport', retryable: false`, which is exactly the status `shouldOfferRepair` now admits, so the
slot correctly filled with the button and the test went red rather than vacuous. Repointed onto a
retryable daemon error (`server.binary_offline`), an arm the chip still owns (#167's AC4), which keeps the
test's actual claim (`trailing` reaches the row with the chip in it) intact. A sibling container test
proves the button's own arm the same way, spying `sessionStore.getInitialState` (not a `beforeEach`
`setState`, per the [standing zustand v5 lesson](conversation-shell-composer-error-chip.md#composer-error-chip-797) above), and additionally proves
`.composer__repair` is absent in the exact state that used to render it.

**A fifth production file: `QuestionPanel.tsx`.** The shared `.button-small` base class means the question
panel's three buttons' `className` attributes changed too (`button-small` prepended, not replacing their
own class), so `QuestionPanel.test.tsx`'s exact-string markup assertion on the Cancel button moved with
it — see [Question panel § Step controls](conversation-shell-question-panel.md#step-controls-916).

**e2e (`e2e/unpair-repair.spec.ts`) drives the geometry and the click**, none of which a static render can
reach: the row's height (24 → 32), the status group's offset from the row's bottom edge (unchanged across
that transition), the focus ring (Chromium only paints it after keyboard-driven focus, so the spec presses
a key before calling `.focus()`), and the click opening recovery beside the sidebar without unpairing.
The button's locator moved from `getByRole('button', { name: 'Re-pair', exact: true })` to
`COMPOSER_REPAIR_BUTTON_COPY`, imported rather than retyped so a copy change cannot leave the spec passing
against a string nothing renders; the spec's header comment, which used to describe **four**
`.conversation__unpair` buttons (Unpair/Cancel/Confirm/Re-pair), now describes three — the button does not
wear that class.

The sentinel test enforces the trust boundary: error fields may select the control but cannot
supply its markup. Recovery entry now performs navigation only; credential changes remain behind
the pairing form's fingerprint confirmation.

