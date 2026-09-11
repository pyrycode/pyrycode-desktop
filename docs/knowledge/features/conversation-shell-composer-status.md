# Conversation shell — composer status row and error slot

The status row directly above the message box: its activity/thinking display, its error chip, that chip's fold into an actionable re-pair button, and the retry/compacting/stall statuses folded into its label. Split from [Composer](conversation-shell-composer.md) 2026-09-05, once this ticket's message-box growth would have pushed the combined document over the size cap.

Part of [Composer](conversation-shell-composer.md); see that document for the message box and footer row, and [Conversation shell](conversation-shell.md) for the screen overall.

## Composer status row (#796)

The desktop layout's own fixed-height status area directly above the message box (Figma `111:3525`,
780×24), replacing the loose region the working indicator used to float in. `ComposerStatusArea({
isRunning, children })` is an in-file `ConversationScreen.tsx` function, mounted directly after
`Timeline` (through #1009 the queued backlog sat between them as its own `<QueuedBacklog/>` view,
mounted straight from `ConversationScreen` rather than through the retired `QueuedBacklogControl`;
[#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) deleted that view and folded its rows
into `Timeline` itself — see [Conversation shell — conversation surfaces and modals § Queued rows folded
into the
thread](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213))
and immediately before `Composer` (through #962 it followed `StatusRow`/`BackgroundTaskTrigger`, both
since retired — see [Run-configuration row and background-task trigger
retired](conversation-shell-chrome.md#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962);
that region is now empty above this row):

```
.conversation
├── Timeline                   .conversation__thread  (queued rows drawn in place since #1214)
├── ComposerStatusArea         .composer-status
│   ├── .composer-status__activity
│   │   ├── PyryMark            .composer-status__icon(--spinning)  (14×16, from theme/PyryMark.tsx)
│   │   └── {children}          → <ThinkingIndicator/>
│   └── {trailing}              → <ComposerErrorSlotControl/>       (repair, error, recovery or notice)
└── Composer
```

This is the DOM order. `ComposerSlot.statusArea(sendText)` supplies the status area
through `Composer.beforeComposer`, giving recovery the composer's existing command
send callback. The status area remains outside the composer's `hidden` subtree,
so covering the input with a question panel does not hide its messages.

**Never returns `null` — the one deliberate departure from `ThinkingIndicator`'s own zero-footprint
posture (AC2).** `ThinkingIndicator` still returns `null` at rest; this row's *height* is what must be
reserved regardless, so the composer no longer moves under the operator's cursor each time the label
appears or disappears — the same reasoning `ComposerSendButton` (#678) already applies to never returning
`null` either.

**Through #963, a turning icon beside no label was a legal, expected render** — a live api-retry or
compaction superseded the label (per #493/#496) while the raw phase reading (`isRunning`) kept the icon
turning regardless, and the held height was what made that read as intentional rather than broken.
[**#967**](https://github.com/pyrycode/pyrycode-desktop/issues/967) **closed that state as a side effect
of folding retry, compacting and stall into the label's own union** (see [Thinking / working
indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)
below) rather than by coupling the two gates: the icon still turns on the raw `isRunning`, and whenever
that holds the label is now non-null in every case (retrying, compacting, stalled, or thinking/working),
so the icon can no longer turn beside nothing. The converse is still reachable and still intended: a
stall or a held retry at `idle` shows its label beside a still icon — the folded statuses are not gated
on a running turn (see below).

**`isRunning: boolean`, not `phase: TurnPhase` — the `ComposerSendButton` precedent, not a new one.** The
view structurally cannot receive the store enum, so `'idle'` is not representable inside the spinning
branch and no daemon string can reach this prop. The container supplies `isTurnRunning(phase)`, the same
exported predicate the composer's stop-button variant already gates on — reused, not re-derived.

**`children`, not a `label: string` prop — the `StatusSheet({ onClose, children })` precedent.** Keeps the
row independent of where its text comes from. `children` is the activity group's slot (`<ThinkingIndicator/>`);
the row gained a second, sibling slot of its own, `trailing`, in
[#797](https://github.com/pyrycode/pyrycode-desktop/issues/797) — see [Composer error chip](#composer-error-chip-797)
below. Through #796 that right-hand slot was empty and got **no placeholder element**, relying on the
row's own `height: 24px` to reserve the space (the Figma error frame is itself 24 tall, so a second flex
child was never going to grow it); #797 kept that posture when filling it — `trailing` still renders bare,
with no wrapper div, so the three non-error arms emit nothing there today either. **Since
[#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) the row is sized *by* its occupant rather
than reserved ahead of it** — `.composer-status` declares `min-height: 24px`, not `height` — because the
slot gained a second, taller occupant; see [Actionable-error button](#actionable-error-button-and-the-row-that-grows-to-fit-it-963)
below.

**The turning state is a CSS class, never a resolved style.** `.composer-status__icon--spinning` drives a
`composer-status-spin` keyframe (`1.6s linear infinite`, a client-owned constant — the Figma node is a
static vector with no motion spec); a `@media (prefers-reduced-motion: reduce)` rule turns the animation
off while leaving the class and the icon in place, `.bubble__cursor`'s existing shape verbatim. The class
being static markup (rather than an inline style resolved at paint time) is what makes AC3's
running-vs-still distinction visible to a `renderToStaticMarkup` renderer spec, and it is the repo's
**first reduced-motion coverage anywhere** — no renderer spec can reach a media query, so
`e2e/composer-status-reduced-motion.spec.ts` (Playwright fake tier) is the sole check, and it self-verifies
the emulation took effect (`matchMedia('(prefers-reduced-motion: reduce)').matches` asserted before
anything else) before asserting the icon's computed `animationName`. A control arm — the same class,
`reducedMotion: 'no-preference'`, `animationName` asserted **not** `'none'` — is what makes the spec able
to fail at all; without it, `'none'` on a stylesheet that never declared the keyframe would also pass.
`page.emulateMedia` does reach an Electron window over CDP as shipped, so the `--force-prefers-reduced-motion`
launch-arg fallback the architecture spec held in reserve was never needed.

**The icon is `PyryMark`** (`theme/PyryMark.tsx`), the pyrycode snowflake mark **moved out of
`WelcomeScreen.tsx`'s module-private `PyrycodeMark`** so the two screens share one 12 KB path instead of a
second, driftable copy — see [Welcome screen § The two SVGs](welcome-screen.md#the-two-svgs--inline-jsx-no-svg-file).
Confirmed to be the *same* glyph the welcome hero draws, numerically rather than assumed: this node's
Figma coordinates and viewport both divide the welcome mark's by exactly 6.5. Rendered **unflipped** here,
diverging from `.welcome__mark`'s own `transform: scaleY(-1)` — a glyph that spends its visible life
rotating has no observable orientation, so the flip buys nothing and was left off; the architecture spec's
stated reason for this ("the same orientation as the welcome hero") did not survive contact with
`welcome.css:84` and the code comment now records the real relationship instead of repeating the
now-false one.

**The truncation bound is a re-derived three-link chain, not a copy of the retired one.** Through #796,
`.bubble--tool-label`'s one-line-ellipsis bound leaned on `.bubble`'s own `max-width: min(680px, 75%)` as
its backstop — measured: removing that max-width blew the label out to 3089px against a 396-char name.
This move deletes `.bubble` from the label's ancestry entirely, so that backstop is gone. The replacement,
verified by measurement rather than assumed (a 3000-char daemon tool name leaves `.composer-status` at
640px with no horizontal overflow on `.conversation` or `document.body`): `.composer-status` is a
block-level flex item of `.conversation` (a definite width) → `.composer-status__activity` is `flex: 1 1
auto; min-width: 0` (without which a flex item's automatic content minimum floors at the label's full
intrinsic width) → `.composer-status__label--tool` is `min-width: 0; overflow: hidden; text-overflow:
ellipsis; white-space: nowrap` (`nowrap` also collapses an embedded newline, so a daemon name can't break
the line either). All three links are required; dropping any one reopens the #649 hazard this bound
exists to close. **`.composer-status__activity`'s `min-width` is no longer `0`** — [#1321](#the-usage-limit-notice-the-slots-third-occupant-1321)
raised it to the turning brand mark's own box plus its gap once a third, shrinkable occupant could squeeze
the group all the way to zero and take the mark off the row; the chain above is otherwise unaffected, since
the floor is far below the label's intrinsic width and the label still absorbs an oversized daemon string
first. `text-overflow` needs a block container and the label is a `<span>` — it works because a
flex item is blockified, the load-bearing detail nearest a future "make it a span again" refactor.

**Scope boundary, held through #796 and reopened by #967.** Through #796, `ApiRetryIndicator`,
`CompactingIndicator`, and `StallIndicator` kept their pre-#796 mount site (right after `Timeline`),
their bubble treatments, and their mutual precedence rule — none of that was reopened by #796. #967 is
what reopened it: those three views, their mount site, their bubbles, and seven CSS rules are gone, and
the precedence they used to hold via separate DOM adjacency now lives entirely inside
`workingIndicatorState`'s four-way order — see [Thinking / working
indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)
above for the retirement and the new order.

One second-order consequence that predates #967 and is unaffected by it: `.conversation__thinking` no
longer changes the thread's viewport size when it mounts or unmounts, because it now lives inside a row
that is *always* mounted — see the **Thread scroll pin** edge case in [Conversation
shell](conversation-shell.md#edge-cases-and-limitations), where `thread-scroll-pin.spec.ts`'s fourth
criterion was repointed by #796 onto the (now also folded) stall indicator, and repointed again by #967
onto the queued backlog. `conversation__thinking` itself is **retained** as a class on the label purely
as an identity hook (two Electron-launch e2e specs locate it as their turn-liveness gate, and it is now
also the one element all five status-row states share) — it styles nothing any more; that is ordinary
BEM, not drift.

**Test-file vacuity repoint, the same hazard the row's own class-string rename created elsewhere.** Once
`bubble--thinking` exists nowhere in production, the three pre-existing `ConversationScreen.test.tsx`
assertions checking the stall/api-retry/compacting renders' `not.toContain('bubble--thinking')` — i.e.
"this problem state is visually distinct from the working indicator" — would pass against a string no
component can emit, silently testing nothing; #796 repointed all three onto `not.toContain('composer-status__label')`
so the claim stays falsifiable, the same fix `.bubble--tool-label`'s own naming comment was written to
avoid ([#649 codebase notes](../codebase/649.md)).

Code review PASS, with one non-blocking SHOULD FIX left open: `ThinkingIndicator`'s own comment block still
says "there is no Figma node for this state; the indicator is one muted run" — both clauses are now false
(node `111:3525` is precisely what this ticket consumes, and the label inherits `--color-primary`, not a
muted tint) even though the paragraph's conclusion (one text run, so overflow draws a single ellipsis) is
still correct and still load-bearing. Left as prose upkeep rather than a gate. See [#796](https://github.com/pyrycode/pyrycode-desktop/issues/796).

## Composer error chip (#797)

Fills the composer status row's `trailing` slot (Figma error frame `112:3529`) with a red pill reading
`COMPOSER_ERROR_CHIP_COPY` (`'Host connection down!'`, [composer send § 8](composer-send.md#8-error-chip-copy-composersendts-797)),
shown in the `error` connection arm and in no other — the **fourth** read of `sessionStore`'s
`ConnectionStatus`, beside `composerAvailability`'s send gate, `shouldOfferRepair`'s re-pair gate, and
`shouldShowBanner`'s prominent band (all in [composer send](composer-send.md)).

`ComposerErrorChip({ status })` is the pure, exported view (the `ConnectionBanner` pattern):
`status.type !== 'error'` → `null`; otherwise one `<div className="composer-status__error">` holding a
hidden `<span className="composer-status__error-prefix">Error: </span>` ahead of the visible copy. Still
exactly this, unchanged by #963 below — only its container and its neighbours in the slot changed.

Through #963, `ComposerErrorChipControl` was the module-private, store-bound container —
`useSessionStore(selectStatus)`, the same narrow slice `ConnectionBannerControl` already reads — mounted
as `ComposerStatusArea`'s `trailing` prop directly. #963 collapsed it into `ComposerErrorSlotControl`,
which now owns that mount site and calls `ComposerErrorChip` only on its delegate arm — see [Actionable-error
button](#actionable-error-button-and-the-row-that-grows-to-fit-it-963) below.

**It never destructures `status.error`.** The whole of AC2 is that structural fact, restated one component
over from `CONNECTION_BANNER_COPY`'s own guarantee: neither `message` nor `code` has a rendering path to
the DOM, an attribute, a `title`, or a log, so there is nothing to escape, length-bound, or strip a
newline from. The design carries this independently too — the mock's text node is a single 132×16 line, a
relayed `ErrorPayload.message` would not fit it.

**A `<div>`, not the banner's `<p>`.** The chip lives in `.composer-status`'s hard `height: 24px` row, and
this repo ships no global `box-sizing`/margin reset (the row's own comment records that), so a `<p>`'s UA
margin would be a live layout hazard for no semantic gain.

**No live region.** No `role="status"`, no `role="alert"`, no `aria-live` — the `ConnectionStatusIndicator`
ruling applies verbatim: the banner already politely announces disconnects, and `shouldShowBanner` is true
on the same `error` arm, so a `connected → error` transition mounts the banner and this chip in the same
commit. A second polite region would announce one fact twice.

**AC4's marking is hidden text, not an `aria-label`.** A bare `<div>`/`<span>` maps to `role="generic"`,
which ARIA 1.2 puts on the name-prohibited list — an `aria-label` there asserts green in a markup test and
is silently dropped by a real screen reader. The hidden prefix's trailing space is load-bearing: it is the
separator a screen reader needs to concatenate the two runs into "Error: Host connection down!"; an
editor's trim would silently degrade the announcement, which is why `composerSend.test.ts` pins it.

**CSS (`conversation.css`, after `.composer-status__label--tool`):** `.composer-status__error` is
`flex: 0 0 auto` (required, not decorative — without it the chip would be a shrink candidate alongside
`.composer-status__activity`'s `flex: 1 1 auto; min-width: 0`, and an oversized daemon tool name would
squeeze the chip instead of ellipsizing the label, inverting the truncation chain above and making it
remotely triggerable); `white-space: nowrap` (the row's hard height means a wrapped chip would overflow
rather than grow it); no `height` declaration — under this repo's content-box default, `line-height: 16px`
plus `padding: 4px 0` already sums to the Figma's own 24px construction, and an explicit `height: 24px`
alongside that padding would render a 32px chip. `.composer-status__error`'s truncation-chain interaction
was **re-measured with the chip up** (not assumed from #796's empty-slot numbers): a 3000-char tool name
still leaves `.composer-status` at 640×24 with no horizontal overflow, the chip unshrunk at its full
content width and the activity group absorbing the whole squeeze.

**New token:** `--color-error-container: #93000a` (`tokens.css`, beside `--color-error`) — the M3 dark
`Schemes/Error Container`, read from `get_variable_defs` on Figma node `112:3529`, never from the export's
light-scheme fallback `#ffdad6` (the same trap `.status-row` and this row's own comment already record).
One consumer today; the next slot needing an error container should reuse it rather than re-derive the hex.

**Testing gotcha: the container's showing branch needed a `getInitialState` spy, not `setState`.** The
architecture spec assumed the container `describe`'s existing `beforeEach` (which `setState`s the session
store) would make the `error` arm reachable through the mounted `ConversationScreen`, the same way it does
for `ConnectionBannerControl`. It doesn't: zustand v5's `useStore` reads `getInitialState()` under
`renderToStaticMarkup`, never `getState()`, so a `setState` in `beforeEach` never surfaces there —
`ComposerErrorChipControl` turned out to share `RepairControl`'s situation (see [Re-pair
control](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963) above and [#69 codebase notes](../codebase/69.md)), not the banner's. The
shipped test spies `sessionStore.getInitialState` directly, mocks its return once, and restores it in a
`finally`. Worth remembering for the next container test whose visible branch is not the store's initial
`disconnected` snapshot — check which read path the mount actually uses before trusting a `beforeEach`
`setState` to reach it.

Code review PASS (architect self-review) — see the ticket's own security review for the trust-boundary and
attribute-sink analysis; both concluded no findings, on the strength of the "never destructures
`status.error`" structural guarantee above.

## Actionable-error button, and the row that grows to fit it (#963)

**An error the operator can act on becomes a button in the chip's own slot** (Juhana's ruling, 2026-09-02),
reading `Pairing error - Re-pair`, exactly when `shouldOfferRepair` is true. This retires
[#167's separate `RepairPrompt`/`RepairControl`/`.composer__repair` block](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963)
that used to sit beneath the composer — one escape hatch, in the slot the operator is already looking at,
rather than two surfaces for the same terminal state.

**`ComposerErrorSlot({ status, onRepair })`** is the pure, exported three-way view that now fills the
row's `trailing` slot: `shouldOfferRepair(status)` → the button; otherwise it **delegates** to
`ComposerErrorChip({ status })` unchanged, which returns the chip on the `error` arm and `null` on the
other three. Delegating rather than inlining the chip's markup is what keeps #797's whole describe block
and both container assertions true, unedited by this ticket. Ordering is the whole of "one occupant per
slot": `shouldOfferRepair` is a **strict subset** of `status.type === 'error'` (it adds `!retryable` and
`code !== 'unpair'`), so the narrower gate has to be asked first, or the chip would swallow every
actionable case. A retryable daemon error (`server.binary_offline`, `rate_limited`) still gets the plain
chip — #167's AC4 — and so does the self-inflicted `code: 'unpair'` failure — #167's AC5 — both preserved
by construction rather than by a new check. `status` and `onRepair` are both **props, not a store read**,
for `RepairPrompt`'s and `ComposerErrorChip`'s reason: the populated branches are unreachable under
`renderToStaticMarkup`, so the matrix is only assertable with an injected status.

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

**`ComposerErrorSlotControl({ onUnpaired })`** is the store-bound container, collapsing #797's
`ComposerErrorChipControl` and #167's `RepairControl` into one — they read the same `selectStatus` slice
for the same fact and now fill the same hole, so the re-render footprint narrows rather than grows.
`handleRepair` was `RepairControl`'s body verbatim through [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163):
`void runUnpair({ unpair: window.pyry.unpair, dispatch, onUnpaired: () => onUnpaired?.() })`. #1163
migrated it onto the per-server channel: it now resolves the open conversation's server id at
interaction time (`serverIdForOpenConversation` over `conversationListStore`'s stamped rows, via
`getState()`, not a subscription) and calls `void runUnpair({ unpairServer: window.pyry.unpairServer,
refreshServers, onLastServerUnpaired: () => onUnpaired?.(), dispatch }, serverId)`, still fired as a bare
`void` since `runUnpair` never rejects. No confirm phase and no busy guard, for #167's recorded reasons —
the button only ever appears in an already-terminal error, and it self-hides on both outcomes (`ok` and
nothing left paired → route unmounts the screen; `ok` and other servers remain → the shell just stays up;
`error` → the store lands on `code: 'unpair'`, which the predicate excludes). `window.pyry` is
dereferenced only inside the handler, never during render — see [Unpair channel § The two renderer
callers](unpair-channel.md#the-two-renderer-callers) for the full mechanism.

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
`setState`, per the [standing zustand v5 lesson](#composer-error-chip-797) above), and additionally proves
`.composer__repair` is absent in the exact state that used to render it.

**A fifth production file: `QuestionPanel.tsx`.** The shared `.button-small` base class means the question
panel's three buttons' `className` attributes changed too (`button-small` prepended, not replacing their
own class), so `QuestionPanel.test.tsx`'s exact-string markup assertion on the Cancel button moved with
it — see [Question panel § Step controls](conversation-shell-question-panel.md#step-controls-916).

**e2e (`e2e/unpair-repair.spec.ts`) drives the geometry and the click**, none of which a static render can
reach: the row's height (24 → 32), the status group's offset from the row's bottom edge (unchanged across
that transition), the focus ring (Chromium only paints it after keyboard-driven focus, so the spec presses
a key before calling `.focus()`), and the click landing on the pairing screen through the same `runUnpair`
flow. The button's locator moved from `getByRole('button', { name: 'Re-pair', exact: true })` to
`COMPOSER_REPAIR_BUTTON_COPY`, imported rather than retyped so a copy change cannot leave the spec passing
against a string nothing renders; the spec's header comment, which used to describe **four**
`.conversation__unpair` buttons (Unpair/Cancel/Confirm/Re-pair), now describes three — the button does not
wear that class.

Security review PASS (builder self-review). One SHOULD FIX carried as a structural requirement rather
than left as prose: the trust-boundary note above ("read for a decision, never for markup") is enforced by
the sentinel test, not by convention alone. One accepted risk named, not fixed: the destructive clear
still has no confirmation step, and this ticket makes the control markedly more prominent (a 157×32 filled
button replacing a bare de-emphasised text button) — accepted because the consequence is bounded and
recoverable (re-pair by scanning a QR) and a confirm step on an already-terminal state is pure friction,
per #167's original rationale.

## Stopped-turn recovery

`ComposerErrorSlotControl` reads the open conversation's `timeline.latestTurnEnd`.
Only a stop that passes [the boundary formatter](conversation-shell-turn-status.md#stopped-turn-records)
can offer recovery. `terminalReason: 'prompt_too_long'` shows “Context too long.
Compact or reset the session.” with Compact. Otherwise `billing_error` shows
“Claude reported a billing error. Check Claude billing on this server.” and
`authentication_failed` shows “Claude reported an authentication failure. Check
Claude sign-in on this server.” These are reports about Claude on the affected
server; Desktop settings cannot repair that account and are not an action here.

Compact sends the client-owned `/compact` through the same `sendText` path as the
[Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#grey-out-for-an-absent-command-681).
`markUnavailableActions` checks the published command list at render and again at
click time: a complete list proving absence disables it; unknown or incomplete
availability does not. The click also rechecks the open conversation id, and
`sendText` retains its connection/conversation guards. A command never clears the
typed draft. Reset session remains the Actions-menu `/clear` action.

Recovery has priority after re-pair and connection errors, before model-settings
rejection and usage notices; it is visible only while connected. The next local
submitted message or daemon turn activity clears recovery while preserving the
boundary; the stopped turn's trailing idle does **not** clear it. Session boundaries,
reset and reconnect also clear the reading. A timeline reset or eviction drops the
retained rows too. [The reducer lifecycle](thread-timeline-internals.md#stopped-turn-state)
defines the exact events; scratch history folds cannot restore recovery, and each
conversation owns its own reading.

The recovery text wraps within a shrinkable status group. Compact needs both
`button-small` and `button-small--error`: the base class supplies typography and
shape only, so omitting the status-action variant leaves native button styling.
See [browser evidence](e2e-harness.md#stopped-turn-evidence) for draft preservation,
availability, slot priority and the 800px layout check.

## Model settings rejection

`ComposerErrorSlotControl` reads `useRunSettingsWriteStore(selectError)`. When the last
correlated settings rejection is for `model`, it supplies “Could not change the model —
try again.” as the slot's `notice`, replacing any usage notice (#1252). The message is
fixed client copy in a `role="alert"` element. It is available both with the ordinary
composer and while the [questionnaire's model footer](composer-model-menu.md#availability-during-question-batches)
is visible; rejection leaves the question answerable and rolls back the optimistic label.

The single-occupant priority is repair button → connection-error chip → stopped-turn
recovery → model rejection → usage notice. Recovery and both notices require
`connected`; disconnected and connecting states hide them.
`.composer-status__error--settings` retains the error treatment but uses
`flex: 0 1 auto`, `min-width: 0` and `white-space: normal` so the sentence can wrap at the
800px minimum window width.

Clearing follows the existing [settings write lifecycle](session-settings-send.md), with
no timer or question-specific reset. Any new settings dispatch clears the stored error;
`conversationSwitched` clears it with the other write state. Reconnect clears pending
writes but preserves the error, so it can reappear once connected. A confirmation does
not clear a standing error, and an unmatched rejection changes nothing. A later correlated
rejection replaces the stored field; non-model errors do not use this status message.
Closing the question or the model menu does not clear it.

Static slot tests cover connection priority. The fake question-answer drive holds the
settings response, checks rollback on rejection, verifies that rejection outranks an
existing usage notice, and checks that a fresh dispatch restores that notice while the
original question remains answerable.

## The usage-limit notice, the slot's third occupant (#1321)

Draws [the usage-limit store](usage-limit-store.md)'s per-conversation reading in the trailing slot,
below the actionable-error button, connection-error chip, stopped-turn recovery and model rejection in precedence.
It remains the slot's lowest priority. `status` and `limitType` are claude-authored open strings that crossed the
subprocess trust boundary; this slice is where the "no DOM sink" constraint that store inherited is
**discharged** rather than passed on further.

**`usageLimitNotice.ts`** (`src/renderer/src/screens/conversation/`) is a React-free module beside
`messageTime.ts`, for the same reason that one exists: the exact characters are pinnable without
rendering anything. `usageLimitNotice(reading, nowSeconds)` is total — no throw, no reject branch — and
composes three runs in a fixed order (lead, window, reset), each independently omittable except the lead:

- **The lead** decides the treatment and is the *only* place that happens: `status === 'rejected'`
  (exact equality, never a prefix or family test) takes `USAGE_LIMIT_EXHAUSTED_COPY` ("Usage limit
  reached"); every other status — including the one status ever observed live, `allowed_warning`
  (2026-08-22, claude 2.1.239, `limit_type: seven_day`, a weekly band where every turn still ran normally)
  — takes `USAGE_LIMIT_WARNING_COPY` ("Nearly at usage limit"). The asymmetry is deliberate: the status set
  is open, and the cost of under-claiming (one softly-worded row) is far below the cost of over-claiming
  (telling the operator they are blocked while their turns keep working). `treatment` is returned as a
  client-owned `'exhausted' | 'warning'` union beside the text, so the view picks a class without
  re-testing the status.
- **The window** is a `ReadonlyMap<string, string>` lookup on `limitType` (`five_hour` → "5-hour window",
  `seven_day` → "7-day window"), omitted for any other value — the four other documented values
  (`seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included`, `overage`) deliberately fall to the
  unnamed arm rather than getting invented copy. **`Record<string, string>` is forbidden here**, the same
  `Map`-not-`Record` rule the store this reads from already carries one layer up: against a `Record`,
  `'__proto__'` and `'constructor'` are non-`undefined` and would put `[object Object]` or a function's
  source into the status row; `Map.prototype.get` makes both ordinary misses by construction.
- **The reset clause** is a local-getter formatter (`formatMessageTime`'s discipline verbatim — no
  `Intl`, no `toLocale*`) that carries the date **only when the reset does not fall on the local day the
  notice is read** — a seven-day window resets days out, so a bare time of day would read as "later
  today." It returns `null`, dropping the clause, in two wire-reachable cases: `resetsAt === 0` (claude
  reported no reset — never formatted as 1970) and an unrepresentable instant (`resetsAt` is unvalidated
  in both directions upstream, so a magnitude past `Date`'s ±8.64e15 ms range passes `selectUsageLimitFor`'s
  readability test and would otherwise render `NaN.NaN.NaN`; guarded by `Number.isNaN(at.getTime())`, not
  by a range check on the input). Both parameters are unix seconds, matching `selectUsageLimitFor`'s
  `nowSeconds` — one unit across the whole vertical closes that selector's millisecond trap.

Nothing here is scheduled from `resetsAt` — no timer, no interval, no re-arming handler. Expiry is
`selectUsageLimitFor`'s one read-time comparison, so an expired reading leaves the row on the next render.
Nothing here is logged, on the store's own reasoning sharpened one layer down: the pair discloses the
account's quota posture, a fact about the operator, and even a content-free count would be the first
crack in a property that has to be total.

**`ComposerUsageLimitNotice({ reading, nowSeconds })`** is the pure, exported view: `null` on a `null`
reading; otherwise one `<div className="composer-status__usage composer-status__usage--{treatment}">`
holding `notice.text` and nothing else. Props, not a store read — the `ComposerErrorChip`/`ConnectionBanner`
discipline, and here it is the *only* way the matrix is assertable at all, since zustand v5's `useStore`
reads `getInitialState()` under `renderToStaticMarkup` and a container test can reach exactly one arm. The
class is chosen by an explicit two-way conditional over the `treatment` union, never by interpolating it
into a template — the same discipline that keeps `notice.text` itself free of either untrusted string. No
live region and no hidden prefix, unlike the chip: both leads already say what they are in plain words, so
the visible text is already the accessible name.

**`ComposerErrorSlot` grows from three arms to four, and the order is the whole of the one-occupant
rule:** `shouldOfferRepair(status)` → the button; `status.type === 'error'` → the chip (the discriminant
now asked explicitly here, where it used to be left to the chip's own guard, so the notice's arm cannot be
reached while either existing occupant could claim the slot); `status.type === 'connected'` → `recovery ?? notice`;
otherwise `null`. The `connected` gate is deliberately **stricter** than "no error live" — while
disconnected or connecting, [the banner](#composer-error-chip-797) is already up saying so, and a quota
claim beside it would contradict it, so the notice is suppressed on both of those arms too, not only on
`error`. `notice` reaches the slot as a `JSX.Element | null` prop rather than the reading itself — the
slot stays a view that knows a position and its occupants' priority, and knows nothing about a usage
window. The container now chooses the model rejection above before falling back to the
usage notice; the slot's connection gating is unchanged.

**`ComposerErrorSlotControl`** gains two more narrow-slice reads, on the container that already owns this
slot rather than a fourth container mounted beside it: `useActiveConversationStore(selectActiveConversation)`
for which conversation is open, `Math.floor(Date.now() / 1000)` for the instant (read at render, matching
`selectUsageLimitFor`'s unit — a millisecond value would expire every reading with no symptom beyond
"nothing ever shows"), and `useUsageLimitStore(selectUsageLimitFor(...))` for the reading itself. A
module-level `NO_USAGE_LIMIT_READING` selector constant covers "no conversation is open" so the hook is
called unconditionally with a stable identity on that arm, rather than a fresh closure every render.

### The layout hazard the first review cleared, wrongly

Shipped in the first PR as `flex: 0 0 auto` with `white-space: nowrap`, matching both existing occupants.
At the app's own 800px minimum window the widest string this element can produce — 404px, the warning
lead on a seven-day window with a far-future reset, which always takes the formatter's long form — left
only 316px of row content to share. Neither existing occupant nor the notice could shrink, so the *activity
group* (the only remaining flexible item) absorbed the whole squeeze, went to zero width, took the turning
brand mark off the row entirely, and the row still spilled 79px past the pane.

The builder's own security review had cleared this exact hazard as "No findings," reasoning that no
daemon-controlled string enters this path so `white-space: nowrap` "cannot be blown out" — true, and
irrelevant: the string that overflowed was the *client's own copy*, which the review never weighed. The
review's Revisions section retracts that finding by name rather than silently correcting it, since the
argument that cleared it and the fact that broke it are both worth keeping.

The fix, a rework leg landing two stylesheet changes:

- **`.composer-status__usage` becomes `flex: 0 1 auto; min-width: 0`** plus an `overflow: hidden;
  text-overflow: ellipsis` chain — a deliberate divergence from both neighbours' `flex: 0 0 auto`, and the
  reason is copy *length* rather than trust: this element's longest string is a client-owned constant, so
  letting it compress cannot be triggered by a hostile or oversized daemon value the way shrinking the
  chip or the button could. Flex distributes shrink proportional to base size, so an oversized daemon tool
  name in the label still takes essentially all of the squeeze and this element still yields last only the
  three runs, in order (lead, window, reset) — the operator-facing lead is the last thing to clip.
- **`.composer-status__activity`'s `min-width` rises from `0` to the brand mark's box plus its gap**
  (`calc(14px + var(--space-2))`) — see the correction in [Composer status row](#composer-status-row-796)
  above — so proportional shrink alone cannot paint the mark under the notice again.

`.composer-status__usage` is its own stylesheet block rather than a geometry lifted out of
`.composer-status__error`, a deliberate departure from `.button-small`'s "second consumer, extract"
precedent: the two occupants share no colour on either of the notice's two arms and the notice has no
`position: relative` (no hidden prefix to contain), so sharing would couple two occupants that draw
differently for the sake of six declarations.

Re-measured at the 800×600 floor rather than the 1100px launch width, where the fit could not fail (every
string the element can hold fit the 640px pane there, so that measurement was never a real test): the row
reads 340×24 with no horizontal overflow, the 316px of content divides as 22px to the activity group (its
new floor) and 294px to the notice, whose full content is 404px — so it fits by compressing, with 110px of
copy clipped. All of this is pinned in `e2e/composer-footer-overflow.spec.ts`'s shape, at the row rather
than the pane, since no vitest detector in this repo can read a resolved style.

### Testing

**`usageLimitNotice.test.ts`** (vitest, new) pins the copy/treatment matrix directly: `rejected` takes the
exhausted treatment, every other status (including an invented one) takes the warning treatment; the two
treatments' texts are asserted to agree on every run but the lead, by construction; `five_hour`/`seven_day`
produce their words while `seven_day_opus`, `overage`, `''` and hostile `__proto__`/`constructor` keys
produce no window clause and no `[object`, `function` or `undefined` in the text; `resetsAt: 0` drops the
clause with no `1970`; a same-local-day reset renders time-only and a different-day one carries the date,
both built from local getters in the test so no runner time zone can flake them; an unrepresentable
`resetsAt` drops the clause with no `NaN`; neither `status` nor `limitType` ever reaches the text, pinned
with sentinel values.

**`ConversationScreen.test.tsx`** gained two describes: `ComposerUsageLimitNotice` (the exact empty string
on a `null` reading; the two treatment classes asserted present and absent in both directions; no
`aria-label`, no `role`, no hidden prefix) and the extended `ComposerErrorSlot` precedence matrix (a
sentinel notice element on every arm — the button and chip arms render their own occupant and never the
sentinel; the `connected` arm renders the sentinel; `disconnected` and `connecting` render nothing at
all). The nine pre-existing `ComposerErrorSlot` renders gained `notice={null}` with no other change.

**`e2e/composer-usage-limit.spec.ts`** (Playwright fake tier, new) drives the transitions no static render
can reach, against the seeded row: empty at launch → push `allowed_warning`/`seven_day` (warning
treatment, `7-day window`, exhausted class absent) → push `rejected`/`five_hour` (flips to exhausted,
`5-hour window` — a different window on purpose, so the step is falsifiable by the one before it) → push
`allowed` (empties again, `usageLimitBridge`'s clear route driven end-to-end). The closing empty check is
a mutation check rather than a vacuous locator, since the two prior steps each proved the element present
first. `resets_at` is a fixed far-future literal and the spec asserts only the lead and window words, never
the formatted instant, whose exact characters depend on the runner's time zone and are pinned in vitest
instead. Every geometry assertion in the spec is taken at the 800×600 floor, against the row, per the
rework leg above.

Security review PASS (builder self-review), with the one retracted-and-corrected finding recorded above
under its own heading in the ticket's architecture spec rather than silently edited away. See
[#1321](https://github.com/pyrycode/pyrycode-desktop/issues/1321) and its
[architecture spec](../../specs/architecture/1321-usage-limit-in-status-row.md).
