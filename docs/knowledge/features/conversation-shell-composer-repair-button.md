# Conversation shell — actionable-error button (#963, Re-pair moved to the Top overlay by #1604)

Split from [Conversation shell — composer status row and error slot](conversation-shell-composer-status.md)
on 2026-09-15 to stay under the size cap. Part of [Composer](conversation-shell-composer.md); see the
parent page for [the status row](conversation-shell-composer-status-row.md),
[the connection-error chip](conversation-shell-composer-error-chip.md), and the slot's other occupants.

## Actionable-error button, and the row that grows to fit it (#963; Re-pair split out by #1604)

**An actionable connection error becomes one button.** Through #963 both `Pairing error - Re-pair`
(a non-retryable `pairing-rejected` error) and `Connection error - Reconnect` (other non-retryable errors
except `unpair` and `not-paired`) filled the composer status row's trailing slot. **#1604 moved Re-pair out
of that slot into the conversation's Top overlay** — the same overlay [the usage-limit
notice](conversation-shell-composer-usage-limit-notice.md) moved into — leaving **Reconnect as the row
slot's only actionable-error occupant**. Retryable errors and the two exclusions still fall through to the
existing chip. The [pure gates](composer-send.md#5-re-pair-gate--shouldofferrepair-167) remain disjoint;
`shouldOfferRepair` now gates `TopOverlayControl`'s `repair` prop instead of a slot arm. A bare fatal close,
including 4421 or 4401, is still not evidence of broken pairing; only the sealed invalid-token rejection
establishes repair.

**`ComposerErrorSlot`** no longer has a repair arm. It checks reconnect first, then the connection-error
chip, followed by the unchanged [connected-only priority](conversation-shell-composer-status.md#model-settings-rejection).
**On the pairing-rejected arm the slot now falls through to the ordinary connection-error chip** — the same
`COMPOSER_ERROR_CHIP_COPY` pill every other non-retryable, non-reconnect, non-unpair error already showed
here, since `shouldOfferReconnect` still excludes `pairing-rejected` and there is no longer a repair arm to
catch it instead. The Top overlay's Re-pair pill is what now carries the actionable copy for that status.
Its injected `status` and `onReconnect` keep the view statically testable; the container owns store reads
and actions. Reconnect reuses `button-small button-small--error`; the old beneath-composer `RepairPrompt`,
`RepairControl` and `.composer__repair` remain retired, as do #963's own Re-pair markup and test coverage
inside this file — both live in [`TopOverlay.tsx`](conversation-shell-composer-usage-limit-notice.md#the-usage-limit-notice-now-a-top-overlay-pill-1321-moved-by-1604)
now.

**Error fields select a branch, never markup.** The predicates read `.retryable`
and `.code`, but button content comes only from the client-owned copy constants.
A sentinel code reaching Reconnect must produce no markup or attributes change. The repair test needs the
actual `pairing-rejected` code; replacing it with an arbitrary sentinel would silently test the chip
fallback instead. Visible text supplies each accessible name, with no `aria-label` or hidden prefix — both
labels already say "error". The banner owns the disconnect announcement.

No fourth component was ever added for the button markup itself (`ComposerRepairButton` was considered and
dropped in #963): six lines of markup with no branch of its own would add a name and a test surface without
adding a decision. #1604 reused that reasoning for the Top overlay: Re-pair is one arm inside `TopOverlay`'s
own JSX, not a component of its own.

**`ComposerErrorSlotControl({ onReconnect })`** owns the slot's remaining store reads. Its connection
status comes from `useOpenConnectionStatus`, the same hook used by the composer send gate, the connection
banner and — since #1604 — `TopOverlayControl`: resolve the open conversation's client-stamped server, then
read that server's status. Missing or ambiguous attribution renders disconnected. A different host's
failure cannot disable this thread or give it a recovery button. See
[Session store](session-store.md#one-slot-per-server-since-1133).

**Repair now lives in `TopOverlayControl`.** `handleRepair` — #963's original `handleRepair`, moved
verbatim by #1604 — re-resolves the open conversation's server at click time and calls `onRepairHost
(serverId)` when it is attributable. It never calls `runUnpair` or clears stores. The shell opens
[recovery beside the sidebar](paired-shell-routing.md#host-recovery-and-navigation-lifetime), using the
existing pairing input and fingerprint confirmation. Cancel returns to the prior thread; same-host
confirmation replaces credentials and reconnects while preserving held conversations. Explicit host removal
remains in Settings.

`handleReconnect`, still in `ComposerErrorSlotControl`, also re-reads the active conversation and
conversation list at click time. `serverIdForOpenConversation` must find one unique owner before it invokes
`window.pyry.reconnectServer(serverId)`; missing or ambiguous ownership is a no-op.
It awaits the existing named-host bridge without navigating to recovery, unpairing,
clearing credentials/stores or setting optimistic connection state. Main-process
lifecycle events remain authoritative. A rejected bridge call emits only the fixed
`composer-reconnect-failed` / `bridge-rejected` diagnostic, with no error details.

`COMPOSER_REPAIR_BUTTON_COPY` and `COMPOSER_RECONNECT_BUTTON_COPY` still live beside the
connection copy in `composerSend.ts`, unmoved by #1604; see [Composer send § 9](composer-send.md#9-actionable-error-button-copy-composerrepairbuttoncopy-963).
`TopOverlay` imports `COMPOSER_REPAIR_BUTTON_COPY` directly rather than through a prop.

### The row grows to fit the button — now only for Reconnect (#963; narrowed by #1604)

`.composer-status` changed two declarations in #963: `height: 24px` → `min-height: 24px` (the 32px button
then sets the row's height when present, and nothing else does — no `--tall` modifier, since the button
being in the slot *is* the state), and `align-items: center` → `align-items: flex-end`, the Figma frame's
own `items-end`. The alignment change alone would have dropped the status label 4px at the taller height, so
`.composer-status__activity` gained `min-height: 24px` of its own (the Figma status group's own height,
`112:3530`) — through #796 the group had no height and `align-items: center` produced its 24px box for
free; under `flex-end` that equivalence breaks unless the group states its own floor. With it, the 16px
line centres in a 24px box whose bottom edge is the row's, at both 24 and 32.

**#1604 narrows what can trigger the 32px height to Reconnect alone.** Re-pair's move to the overlay
retires that transition for the pairing-rejected arm: the row now stays at its 24px at-rest geometry when
pairing is rejected, since the slot falls through to the chip (which does not grow the row) instead of a
32px button. `e2e/unpair-repair.spec.ts`'s Re-pair scenario now asserts `readStatusRowGeometry` is
unchanged from the at-rest baseline, and separately asserts the pill's own position: its top edge flush
with `.conversation__message-area`'s top edge, its right edge flush with the area's right edge. The
Reconnect scenarios are otherwise unchanged — a bare 4421 or 4401 close still grows the row to 32px exactly
as #963 shipped it, with the group flush to the row's bottom edge and the icon's offset unmoved.

**Chip and button share a base class, extracted on its second consumer.** `.button-small` — reset, M3
body/small-emphasized type, `border-radius: var(--radius-xs)`, `white-space: nowrap`, `flex: 0 0 auto` —
is the same nine declarations the question panel's `.question-panel__cancel`/`__previous`/`__continue`
already shared as one three-selector rule; see
[Question panel](conversation-shell-question-panel.md#all-question-presentation) for that side of
the extraction. `.button-small--error` is the design's `Type=Error` fill: `background:
var(--color-on-error)`, `color: var(--color-error)`, hover swaps the fill to
`var(--color-error-container)` (already a token, from #797's chip). Padding stays out of the base class —
the panel's outlined pair needs 7px against the filled pair's 8px to compensate for a 1px border under
this repo's absent box-sizing reset, so sharing padding would silently break that compensation. No
`outline: none` anywhere in either rule: AC3 requires a visible focus ring and the Figma component set
draws no focus state of its own, so the UA ring is the treatment. `TopOverlay`'s Re-pair pill draws from a
different base, `.top-overlay-pill`/`.top-overlay-pill--error` (see [the usage-limit
notice](conversation-shell-composer-usage-limit-notice.md#the-top-overlays-own-geometry-1604)), which keeps
the same no-`outline: none` rule for the same AC3 reason but does not share `.button-small`'s padding or
sizing, since the overlay pill hugs its text and wraps instead of staying fixed-width and single-line.

**New token: `--color-on-error: #690005`**, `tokens.css` beside `--color-error`/`--color-error-container`,
read from the Figma **variable** bound to node `354:7088`, never the generated export's `white` fallback —
the light scheme, and a starker instance of the trap `--color-error-container`'s own comment already
warns about (a white button where the design draws near-black red). Still used by Reconnect; the Top
overlay's Re-pair pill uses `--color-error-container`/`--color-error` instead, the same tokens the Error
pill variant uses for the usage notice.

**Re-measured rather than assumed, twice, in #963.** The truncation chain #797 measured with the chip up
(`flex: 1 1 auto; min-width: 0` on the activity group, `flex: 0 0 auto` on the trailing occupant) was
re-measured with the wider button up, the same way: a 3000-char daemon tool name, headless Chromium, the
800px minimum window width. The row stays 640×32; the button is unshrunk at **167.88px** (not the ~157px
the Figma frame suggested — the standing Roboto→system-ui substitution, the same drift #797's chip measured
at 155 against its own 148px node); the activity group absorbs the whole squeeze at 448.13px and the label
inside it at 426.13px; neither `.conversation` nor `document.body` overflows. This measurement covered
Reconnect only once #1604 moved Re-pair out — it was never re-taken for Re-pair, since Re-pair no longer
shares this row's truncation chain at all. Separately, #963's own premise that "the message box moves 8px
on this transition" turned out wrong in both size and cause: measured in `e2e/unpair-repair.spec.ts` at the
time, the box moved 20px **upward**, and none of it was the row's own 8px — the same status change also
mounted [the connection banner](conversation-shell-chrome.md#connection-banner-279) above the thread and,
through [#968](../codebase/968.md), the composer's own `Connection error` caption, and the row's 8px alone
was absorbed by `.conversation__thread`'s `flex: 1 1 auto; min-height: 0`. #968 retired that caption, and
\#1604 retired the transition itself for the pairing-rejected arm — the stale 20px figure describes neither
mover any more and was never re-measured for Reconnect, since no e2e assertion pins the box's absolute
position: doing so would pin the banner's geometry under a name that claims to be about this row.

**Testing.** `composerSend.test.ts` proves the disjoint gate matrix, including
retryability, all non-error statuses and both exclusions — unchanged by #1604, since the gates themselves
did not move, only which component reads them. `ConversationScreen.test.tsx`
checks exact Reconnect button markup, mutual exclusion, sentinel isolation and lower-priority
occupants, with the Re-pair arm's coverage moved to `TopOverlay.test.tsx`. Store-bound static renders must
spy on `getInitialState`, not merely call `setState`: Zustand v5 reads the initial snapshot under
`renderToStaticMarkup`. Stage `pairing-rejected` to prove the chip fallback, an ordinary terminal code for
reconnect, and a retryable error for the chip on its own arm; all three are different test subjects.

**`e2e/unpair-repair.spec.ts` owns clicks and geometry.** The repair scenario sends a sealed
`auth.invalid_token` frame and opens the existing host-recovery flow, now locating the button inside
`.conversation__top-overlay` and asserting `.composer-status__error` shows the ordinary chip instead. Bare
4421 and 4401 closes still show Reconnect in the row with two hosts paired. After clicking, wait for Send
to become enabled and the selected host's authenticated connection event before asserting that only that
host redialled, both saved hosts and the draft remain, and neither unpair nor recovery navigation occurred.
Button disappearance alone would also pass during connecting and cannot prove completion.

At 800px width the reconnect scenarios still assert a 24px resting row becoming 32px, the status group's
bottom flush with the row and the icon's unchanged bottom offset — #963's original assertions, unaffected
by #1604 since Reconnect never left the row. The repair scenario instead asserts the row's geometry is
unchanged from the at-rest baseline and the pill's own top/right edges against the message area. The longer
reconnect label still uses the existing Error treatment with no new CSS. Both scenarios check the focus
ring: Chromium paints it after keyboard input, so press a key before calling `.focus()` in that assertion.

Other history and precedence scenarios must make the same fixture distinction:
a terminal transport error tests Reconnect priority in the row; a repair-cancellation test
requires the sealed rejection and now drives the overlay's pill. Bare 4401 cannot stand in for invalid
credentials.

See [#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) and
[#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604) and its
[architecture spec](../../specs/architecture/1604-top-overlay-pills.md) for the move.
