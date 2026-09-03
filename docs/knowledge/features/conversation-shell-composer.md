# Conversation shell — composer

The composer's own surfaces: its status row, error chip and footer row. The options panel is large enough to have its own document.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Composer status row (#796)

The desktop layout's own fixed-height status area directly above the message box (Figma `111:3525`,
780×24), replacing the loose region the working indicator used to float in. `ComposerStatusArea({
isRunning, children })` is an in-file `ConversationScreen.tsx` function, mounted directly after
`QueuedBacklogControl` and immediately before `Composer` (through #962 it followed `StatusRow`/
`BackgroundTaskTrigger`, both since retired — see [Run-configuration row and background-task trigger
retired](conversation-shell-chrome.md#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962);
that region is now empty above this row):

```
.conversation
├── QueuedBacklogControl
├── ComposerStatusArea         .composer-status
│   ├── .composer-status__activity
│   │   ├── PyryMark            .composer-status__icon(--spinning)  (14×16, from theme/PyryMark.tsx)
│   │   └── {children}          → <ThinkingIndicator/>
│   └── {trailing}              → <ComposerErrorChipControl/>       (row's own slot, #797, see below)
└── Composer
```

**Never returns `null` — the one deliberate departure from every sibling indicator's zero-footprint
posture (AC2).** `ApiRetryIndicator`/`CompactingIndicator`/`StallIndicator`/`ThinkingIndicator` itself all
still return `null` at rest; this row's *height* is what must be reserved regardless, so the composer no
longer moves under the operator's cursor each time the label appears or disappears — the same reasoning
`ComposerSendButton` (#678) already applies to never returning `null` either. A turning icon beside no
label is consequently a **legal, expected** render (a live api-retry or compaction still supersedes the
label per #493/#496 while the raw phase reading keeps the icon turning) and the held height is what makes
that read as intentional rather than broken.

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
with no wrapper div, so the three non-error arms emit nothing there today either.

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
exists to close. `text-overflow` needs a block container and the label is a `<span>` — it works because a
flex item is blockified, the load-bearing detail nearest a future "make it a span again" refactor.

**Scope boundary, held exactly as ticketed.** `ApiRetryIndicator`, `CompactingIndicator`, and
`StallIndicator` keep their pre-#796 mount site (right after `Timeline`), their bubble treatments, and
their mutual precedence rule — none of that was reopened. Only `ThinkingIndicator`'s markup moved. One
second-order consequence: `.conversation__thinking` no longer changes the thread's viewport size when it
mounts or unmounts, because it now lives inside a row that is *always* mounted — see the **Thread scroll
pin** edge case below, where `thread-scroll-pin.spec.ts`'s fourth criterion had to be repointed onto the
stall indicator for exactly this reason. `conversation__thinking` itself is **retained**
as a class on the label purely as an identity hook (two Electron-launch e2e specs locate it as their
turn-liveness gate) — it styles nothing any more; that is ordinary BEM, not drift.

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
`ConnectionStatus`, beside `composerAvailability`'s terse hint, `shouldOfferRepair`'s re-pair gate, and
`shouldShowBanner`'s prominent band (all in [composer send](composer-send.md)).

`ComposerErrorChip({ status })` is the pure, exported view (the `ConnectionBanner` pattern):
`status.type !== 'error'` → `null`; otherwise one `<div className="composer-status__error">` holding a
hidden `<span className="composer-status__error-prefix">Error: </span>` ahead of the visible copy.
`ComposerErrorChipControl` is the module-private, store-bound container — `useSessionStore(selectStatus)`,
the same narrow slice `ConnectionBannerControl` already reads — mounted as `ComposerStatusArea`'s
`trailing` prop.

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
control](conversation-shell-chrome.md#re-pair-control-167) above and [#69 codebase notes](../codebase/69.md)), not the banner's. The
shipped test spies `sessionStore.getInitialState` directly, mocks its return once, and restores it in a
`finally`. Worth remembering for the next container test whose visible branch is not the store's initial
`disconnected` snapshot — check which read path the mount actually uses before trusting a `beforeEach`
`setState` to reach it.

Code review PASS (architect self-review) — see the ticket's own security review for the trust-boundary and
attribute-sink analysis; both concluded no findings, on the strength of the "never destructures
`status.error`" structural guarantee above.

## Message box (#951)

The message box itself, redrawn as the design's `Input large` (Figma `347:6635`) — chrome and glyph only,
no behaviour change to sending, Enter handling, the send→stop switch (#678), the not-connected gate (#31),
queueing, or the covered state (#906). Closes the glyph/colour follow-up #678 deferred (see
[Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678)).

**`.composer__row` *is* the box now**, not a bare flex row holding a filled textarea beside a filled send
disc. It keeps its class — three shipped specs and #940's type-ahead anchor depend on it — and gains the
ground, the 6px corner (`--radius-xs`) and 12px vertical padding (`--space-3`); the textarea
(`.composer__input`) goes transparent and carries only the text's own type and inset. The box's 52px
height is **derived, not declared**: 12 (row) + 4 + 20 (one body-medium line at `rows={1}`) + 4 (field) +
12 (row) — a declared height would be a second source of truth fighting the textarea auto-grow
[composer send](composer-send.md) still lists as unbuilt.

**Horizontal padding stays on the textarea, not the row** — `.composer__input` carries 16px left / 56px
right (`--space-4` / `calc(48px + --space-2)`), the row carries none. This is the only split that works:
`.composer__send` is absolutely positioned against the row, and an absolutely positioned box resolves
`right` against its containing block's *padding* box. With horizontal padding on the row, the drawing's
`right: 4px` would have to be written as a negative offset; at zero the padding box edge is the border box
edge, so `right: var(--space-1)` is the drawing's own number.

**The translucent ground is a dedicated `::before` at `opacity`, not `color-mix()`.** `--color-on-primary`
(`#003355`) at 41% is the house form for "a token at N%" — recorded on `.status-sheet-overlay__scrim`
("opacity is not a color literal") and already shipped twice more at the same colour and percentage
(`.question-panel__other-field::before`, the drawing's `Input small`) and at 72%
(`.pairing-field__row`'s ground). `color-mix()` appears nowhere in this repo as a value, only in comments
naming it as the form declined. The pseudo-element paints above non-positioned in-flow content, which is
why `.composer__input` carries `position: relative` — the same line `.pairing-field__row` carries for the
same reason.

**The send control moved inside the box**: `position: absolute; right: var(--space-1); top: 50%;
transform: translateY(-50%)`, out of the row's flex flow (so the row's old `gap` was deleted — one flex
item left, nothing to space). At rest it now paints **no container** (`background: none`) with its glyph
in `--color-primary` instead of a filled `--color-surface-container-high` disc — the M3 icon button's own
always-invisible-at-rest posture, not a desktop divergence. The send variant's glyph changed to the
`circle-chevron-up-solid-full` export at 28×28, matching the stop variant's existing size and export
family; both glyphs are `fill="currentColor"`, no hardcoded `#9DCBFC`. `ComposerSendButton`'s own props,
callbacks, `aria-label`s and disabled gate are untouched — see
[composer send § 3](composer-send.md#3-the-controlled-composer--conversationscreentsx).

**The focus ring moved from the textarea to the box**: `.composer__input:focus-visible` became
`.composer__row:has(.composer__input:focus-visible)`, same token (`--color-outline`), same 1px. Once the
textarea is a 28px band inside a 52px box, its own outline drew a bare rectangle floating inside the
rounded corner rather than reading as the box's focus state. `:has()` rather than `:focus-within` —
`:focus-within` also matches while the send control holds focus, which would stack the box's ring on top
of the button's own `:focus-visible` ring. This is the pattern's **second** consumer;
`.question-panel__option:has(.question-panel__input:focus-visible)` (#912) is the first, and its comment
was trued up in the same commit to name both.

**The #940 type-ahead anchor is unmoved**, on purpose: no `overflow: hidden` was added to `.composer__row`
(the panel paints outside the row's box at `bottom: 100%`; clipping to the new corner would erase it, and
no `node`-environment vitest spec can see that). The row gained no border and no horizontal padding, so
the anchor rect `e2e/composer-options-clamp.spec.ts` measures is unchanged in x and width — it grew 4px in
height only (48 → 52), which that spec does not read. The recorded 4px gap between the type-ahead's label
and the box's own text inset ([type-ahead § the anchor](conversation-shell-composer-options-slash-type-ahead.md))
stands on the same `--space-4` declaration it always named.

**Two gaps the verifier flagged and left open, both non-blocking and carried to #890** (the one open
ticket still touching this region) rather than fixed in #951:

- **~46% of the box's height is not click-to-focus.** The 12px of vertical padding now lives on the row,
  not the field, so a click in either 12px band (24 of the box's 52px, full width) hits a bare `<div>`
  with no handler and does nothing — visible too, since the row declares no `cursor: text` and the cursor
  drops to an arrow there. The fix, if picked up, is to move the 12px back onto `.composer__input` instead
  of `.composer__row` (pixel-identical box, and the textarea fills it again).
  \#890 or a follow-up should carry this if it isn't addressed sooner.
- **The send control's hover step is now a ~1.008:1 non-step against the new ground.** The ground
  composites to `rgb(9, 33, 49)`; the shipped `:hover:not(:disabled)` still steps to
  `--color-surface-container` (`#1d2024`), which was a visible ~1.12:1 step against the old
  `--color-surface-container-high` at-rest fill but reads as no luminance change at all against the new
  translucent navy. `--color-surface-container-high` (the token the control already wore before this
  ticket) restores a comparable step and is the likely fix.

## Composer footer row (#811)

The desktop layout's fixed-height row **below** the message box (Figma `110:3494`, 780×20, the third
child of the `Input area` symbol after `Status area`/`ComposerStatusArea` and `Message input`) — not to
be confused with [Composer status row](#composer-status-row-796), which sits *above* the message box.
The desktop layout puts five affordances in this row — Actions (#680), permission mode (#682), model and
effort (#683), this ticket's context-usage reading, and attach (#685) — and at the time #811 shipped, four
of them were blocked on daemon work that doesn't exist yet. #811 built the row itself and landed the one
occupant that wasn't blocked; **no placeholder element and no disabled control for the rest**. **#680 is
the first of the blocked four to land** — it needed no daemon work at all, only the already-shipped
[options panel](conversation-shell-composer-options-panel.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)
— so two of the row's five slots are occupied today and three (#682, #683, #685) still stay empty:

```
Composer
├── .composer__hint             (unchanged, #31)
├── .composer__row              (unchanged — textarea + ComposerSendButton)
└── .composer__footer           (third child, #811)
    ├── ComposerActionsMenu     leading item — opens the shared options panel with sendText (#680)
    └── ContextUsageControl     null until a real snapshot has loaded, then <ContextUsageReading/>
```

Inline BEM children of `.composer`, not a component of their own — consistent with `.composer__hint`/
`.composer__row` already being inline JSX rather than extracted, and it keeps the ticket's exported
surface to two symbols.

**`contextUsagePercent(usedTokens, windowTokens): number | null`** — new file,
`src/renderer/src/screens/conversation/contextUsage.ts`, React-free and dependency-free (the
`composerSend.ts` idiom: a pure module beside the screen with its own `.test.ts`). This is the one
computation [Run configuration Context window section](conversation-shell-workspace-and-run-config.md#run-configuration-context-window-section-192)
used to own inline; see that section above for the extraction and the `Number.isFinite` guard it added.
Returning `number | null` (not a number beside a separate `available` boolean) is what makes the two
surfaces structurally unable to disagree about whether a reading exists — the guard is the return type,
not a convention repeated at each call site.

**`ContextUsageReading({ usedTokens, windowTokens })`** — the pure view, beside `ComposerErrorChip` in
`ConversationScreen.tsx` (the exact pair this ticket clones, [Composer error chip](#composer-error-chip-797)
above). Returns `null` when `contextUsagePercent` does; otherwise exactly one
`<span className="composer__context">Context: {pct}%</span>`, a single template-literal text run. Every
property `ComposerErrorChip` established carries over unedited: a `<span>` (this repo ships no global
box-sizing/margin reset, so a `<p>`'s UA margin is a live layout hazard against the row's held height),
no attribute beyond `className` (no `onClick`, `tabIndex`, `role`, `title`, `aria-*` — it is a reading,
not a control), and no live region (`aria-live` would announce a percentage after every turn once #810
made the figures live). Unlike the error chip, there is no daemon-supplied *string* on this path at all —
the only interpolated value is an integer in `[0, 100]`, so none of #796/#797's escaping/attribute-sink
questions apply here.

**`ContextUsageControl()`** — module-private container, the `ComposerErrorChipControl` shape: one
`useRunConfigStore(selectSnapshot)` read (not two narrow field selectors — both figures must come from
the same store tick, or a tear could show a percentage of two unrelated snapshots), coalescing
`snapshot?.usedTokens ?? 0` / `snapshot?.windowTokens ?? 0` — [`RunConfigSections`'s own
container](conversation-shell-workspace-and-run-config.md#run-configuration-context-window-section-192) verbatim, so the not-yet-loaded state and the
daemon's `window_tokens: 0` "unavailable" signal collapse into the identical rendered absence on both
surfaces. Reads [Run configuration store](run-config-store.md)'s app-lifetime `RunConfigLiveData` feed
(#810) — this ticket adds no store, no subscription, and no event of its own.

**`.composer__footer` reserves its own height (20px) unconditionally**, the same `.composer-status`
guarantee ([Composer status row](#composer-status-row-796) above): a null reading cannot move
`.composer__row` because the row's box exists whether or not it holds a child. No vertical padding
(no global box-sizing reset), `align-items: center`, `padding: 0 var(--space-4)` — aligned with the
input's *text* start (`.composer__hint`'s treatment), deliberately not with `.composer-status`'s
box-edge alignment; the two rows are inset differently by design. `gap: var(--space-5)` is declared now
(the design's measured 20px item rhythm), inert with one child at #811 but live between the Actions
trigger and the context reading since #680; #682/#683 inherit the same row spacing instead of each
re-deriving it.
