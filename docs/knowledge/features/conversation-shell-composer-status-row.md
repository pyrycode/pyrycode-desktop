# Conversation shell — composer status row (#796)

Split from [Conversation shell — composer status row and error slot](conversation-shell-composer-status.md)
on 2026-09-15 to stay under the size cap. Part of [Composer](conversation-shell-composer.md); see the
parent page for the trailing slot's occupants (error chip, repair button, recovery, refusal, notices,
history failure, usage-limit notice, task count) and [Conversation shell](conversation-shell.md) for
the screen overall.

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
indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)
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
[#797](https://github.com/pyrycode/pyrycode-desktop/issues/797) — see [Composer error chip](conversation-shell-composer-error-chip.md#composer-error-chip-797)
below. Through #796 that right-hand slot was empty and got **no placeholder element**, relying on the
row's own `height: 24px` to reserve the space (the Figma error frame is itself 24 tall, so a second flex
child was never going to grow it); #797 kept that posture when filling it — `trailing` still renders bare,
with no wrapper div, so the three non-error arms emit nothing there today either. **Since
[#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) the row is sized *by* its occupant rather
than reserved ahead of it** — `.composer-status` declares `min-height: 24px`, not `height` — because the
slot gained a second, taller occupant; see [Actionable-error button](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963)
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
exists to close. **`.composer-status__activity`'s `min-width` is no longer `0`** — [#1321](conversation-shell-composer-usage-limit-notice.md#the-usage-limit-notice-the-slots-third-occupant-1321)
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
indicator](conversation-shell-working-indicator.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)
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

