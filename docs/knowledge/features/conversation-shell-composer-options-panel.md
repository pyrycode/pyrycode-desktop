# Conversation shell — composer options panel surface

The shared panel surface, its placement arithmetic, its keyboard contract and its right-edge clamp — the
piece every footer menu, the messaging top-bar menu and the slash-command type-ahead use.

Part of [Composer options panel](conversation-shell-composer-options.md); see that document for the
type-ahead sections built on this surface, and [Conversation shell](conversation-shell.md) for the screen
overall.

## Composer options panel (#838, placed #839, keyboard-driven since #840, first live mount since #680, right-edge clamp wired since #847)

The shared surface serves Actions, permission mode, model and effort in the footer,
the [messaging top bar](conversation-shell-chrome.md#structure), and the
[slash-command type-ahead](conversation-shell-composer-options-slash-type-ahead.md).
`ThreadOverflowMenu` uses `ComposerOptionsMenu` with `currentId={null}` for its three
actions, so it inherits the same dark surface, 6px corners, body-small Primary text,
28px rows, 12px horizontal insets, hover and focus treatment without a selected-value
highlight. #838 shipped only the panel's **resting appearance** — its surface,
its rows, its one new colour token — with no host anywhere in the app yet. #839 placed it in the
footer; #840 completed the interaction — opening, dismissing and driving it from the keyboard. The
panel shipped feature-complete but dormant across all three tickets: nothing mounted
`ComposerOptionsPanel` or `ComposerOptionsMenu` in production. **#680 is that first live mount** — see
[Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680) below for the consumer and the in-app interaction proof it carries.

**New file, not `ConversationScreen.tsx`.** `ComposerOptionsPanel.tsx` follows the
`PermissionModal.tsx` / `WorkspacePickerSheet.tsx` split: five named future consumers across two later
tickets want an addressable module, and `ConversationScreen.tsx`/`.test.tsx` (~2700/~3000 lines) are
merge hot-spots for those same sibling tickets. It adds no CSS import of its own — styles live in
`conversation.css`, and `ConversationScreen.tsx:13` stays that stylesheet's single importer, the
`PermissionModal.tsx` precedent.

```ts
export interface ComposerOptionsPanelOption {
  id: string      // stable identity — the wire/model value, not the display string
  label: string   // the visible row text
}

export interface ComposerOptionsPanelProps {
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null   // the chosen option for a value menu; null for a command list
  onSelect: (id: string) => void
  ariaLabel: string
  focusedIndex: number       // #840: the roving-tabindex row — required, like every other prop
  panelRef?: Ref<HTMLDivElement>  // optional: static renders cannot exercise a ref
}
```

A pure view — props in, markup out, no state, no effect, no store read, no `window.pyry` —
with required rendering and action props. `panelRef` is optional, an ordinary prop rather
than `forwardRef`, omitted in static tests because they cannot exercise a ref. `id` is separate from
`label` because #683's model menu shows `Opus 5` for `claude-opus-5` and #682's permission menu shows
`Accept edits` for `acceptEdits`; matching on the label would force both to invent a lookup.
`currentId: string | null`, not optional — `null` is "a menu of commands is a list of actions rather
than a choice: same panel, no row highlighted," and a `currentId` matching no option takes the
identical no-highlight branch, so a stale model id or a renamed effort level can't crash the panel.
There is still no `open` prop and no trigger on the view itself: the trigger's *behaviour* now belongs
to `ComposerOptionsMenu` (below), and mounting the view *is* opening — the container writes
`{open && <ComposerOptionsPanel … />}` for footer and top-bar consumers alike.

Markup is one `<button role="menuitem" type="button">` per option in array order (the panel never
sorts), inside a `<div className="composer-options" role="menu" aria-label={ariaLabel}>`. The current
row alone carries `composer-options__item--current` **and** `aria-current="true"`, base class kept
(`conversation.css:779-781`'s modifier-without-base vacuity guard). `aria-current` was chosen over a
`menuitemradio` role branch because it's a global ARIA attribute meaning exactly "the current item
within a set" — branching the role on `currentId` would make one panel two different widgets, which
the slash-command type-ahead (a type-ahead, not a menu) would then have to fight. Labels render as ordinary React text
children — escaped, no `dangerouslySetInnerHTML`, no attribute or URL sink — load-bearing once #940
fed it workspace-authored command names and argument hints, per CLAUDE.md's daemon-text ruling. **#940
sharpened this file's own doc comment on `ComposerOptionsPanelOption.label`** to say the field may
carry untrusted text and is rendered as an inert text child only — it was the first consumer for which
that was true, and the next menu to add a visible field inherits the rule rather than rediscovering it.

Since #840, each row also carries `tabIndex={index === focusedIndex ? 0 : -1}` — a **roving
tabindex**: one row is in the tab order, the rest are reachable only programmatically, and the
already-shipped `.composer-options__item:focus-visible` outline (`conversation.css:3239-3241`) paints
on whichever row holds real DOM focus. It is declared *before* `className` in the JSX, not after —
this file's tests match whole attribute runs, and inserting it later would have broken five of the
eight pre-existing assertions (#838's code review flagged that coupling as a NIT; reorder only
alongside those assertions). `aria-current` and `tabIndex` are independent axes and stay so: the
current value is what the menu reads, the focused row is where the arrows are, and they coincide only
on the frame the panel opens. An `aria-activedescendant` approach was rejected — it needs a generated
unique id per row (four consumers can share one screen) and it leaves DOM focus on the panel, which
would make the `:focus-visible` outline dead and "every close path returns focus to the trigger"
unwritable. An out-of-range `focusedIndex` marks no row, the same no-special-case posture a stale
`currentId` gets in the markup above; the container can never produce one, since
`resolveComposerOptionsKey` (below) normalises every index it emits.

**The new token**, added to `tokens.css` between `--color-on-primary` and
`--color-on-primary-container`: `--color-on-primary-fixed: #001d34` (M3 `Schemes/On Primary Fixed`,
read from the Figma *variable*, not the generated export). It's the file's first `*-fixed` token, and
the light/dark-transposition warnings on its neighbours don't apply to it — M3's `*Fixed` roles are
defined to resolve identically in both schemes, so there's no transposed fallback to be trapped by.

**CSS (`conversation.css`, appended).** The Figma nests two fills the other way — frame `On Primary`,
four of five rows `On Primary Fixed`, the current row left unfilled so the frame shows through — but
AC1/AC4 pin the collapsed shape this ships as: `.composer-options` paints the dark
`--color-on-primary-fixed` panel fill, `.composer-options__item--current` alone paints the lighter
`--color-on-primary`. Same picture, two declarations instead of six; the one visible trade is that the
2px top/bottom bands read the dark fill rather than the frame's. Hover (`--color-primary-container`)
is declared *after* the current-row rule; both are specificity (0,2,0), so source order — not the
cascade rules — is what makes hover win over the selection fill on the current row, deliberately (AC2
states the hover fill unconditionally). `padding: 2px 0` is a literal (this stylesheet's own `gap: 2px`
precedent), and with no global `box-sizing` reset in this repo, that padding on a column of five 28px
rows totals 144px — the Figma frame height exactly; keep the panel's vertical padding and the row
height in different boxes. `width: max-content` is the content-driven-width AC3 asks for — not a fixed
or minimum width — so the panel's resting size stays independent of whatever host #839 drops it into;
the drawn 81px is that particular menu's longest label, not a size (#683's model menu will be much
wider). #838 shipped no `position`, no offset and no `z-index` anywhere in the block (AC5) —
deliberately: the panel cannot be an in-flow child of `.composer__footer`, which holds a hard
`height: 20px`, and #839 (below) is the ticket that fills the gap in. The panel and footer
anchors still have no explicit `z-index`. The top-bar consumer requires a different
stacking relationship: `.composer-options-anchor--bottom-end` has `z-index: 1` so its
whole panel paints above the later opacity divider and positioned message content.
`.status-sheet-overlay` has `z-index: 2`, matching the existing dialog overlays above
menus. Raising only this anchor preserves the title row's layout and avoids a stacking
context on the whole header. The old outlined `.conversation__overflow-menu` surface
has been removed; the top bar uses this same panel.

**One shipped deviation from the architecture spec, confirmed correct in review.** The spec read the
node as drawing no radius; `get_design_context` on `121:3879` returns `rounded-[6px]` on the frame
root, so the panel ships `border-radius: var(--radius-xs)` (6px, already established in this
stylesheet) — the design tool refutes the spec's claim about the node, not the diff. Deliberately
*not* paired with `overflow: hidden`: the only clip would be a ~1.5px corner sliver on an end row
(`6 − √(6² − 4²) ≈ 1.53px`, code review's correction of the PR's own estimate of what that sliver sits
against), and clipping would eat #840's future `:focus-visible` outline on exactly those rows. If a
visual pass ever wants the corner clean, code review recorded the fix that costs neither the radius nor
the outline: `overflow: hidden` paired with `outline-offset: -1px` on the focus ring, drawing it inside
the row's box where clipping can't reach it — not applied, since nothing hosts the panel yet. The
row's right inset (12px, mirroring the pinned 12px left inset) was the spec's own open call with no
design authority cited; `get_design_context` returns `px-[12px]` on every Option button instance, so
`padding: 0 var(--space-3)` is confirmed as the literal translation and that open question is closed
rather than carried into #839.

**Unit testing** uses `renderToStaticMarkup` (`ComposerOptionsPanel.test.tsx`) — no jsdom in this repo,
so nothing here can click, focus or measure. AC4 (the current-value modifier) is the only criterion
with a vitest detector; AC2/AC3/AC5 are stylesheet declarations, and per the ruling at
`ConversationScreen.test.tsx:1128-1132` the tests pin that the class hooks are *on* the elements rather
than inventing a DOM measurement path. To still get real evidence for the declaration-only ACs without
adding a DOM environment to vitest (a separate, deliberate decision per CLAUDE.md) or an e2e spec for a
component with no host, the PR rendered `conversation.css` in headless Chromium as a scratchpad
harness (not part of the diff) and measured the real computed styles — 144×83px, five 28px rows, the
12px inset, the exact fill/type values, hover resolving above the current row, `z-index: auto`
throughout. A reusable technique for a future renderer ticket whose ACs are pure CSS and whose
component has no live host yet.

One lesson worth carrying to a future row-button component: the retired overflow menu's
reset declared `width: 100%` alongside horizontal padding. Copying that
literally onto `.composer-options__item` would have overflowed the panel — with no global `box-sizing`
reset, `width: 100%` plus `padding: 0 var(--space-3)` adds the row's 24px on *top of* the panel's
`max-content` width. The flex column's default `align-items: stretch` already runs each row the
panel's full width for free, so the correct row rule declares no `width` at all.

Code review PASS, two non-blocking NITs (the corner-clip magnitude's backdrop description, and the
test's coupling to exact JSX attribute order) — see [PR #841](https://github.com/pyrycode/pyrycode-desktop/pull/841).

**Footer placement.** `ComposerOptionsMenu` defaults its optional
`placement: 'footer' | 'bottom-end'` prop to `'footer'`. The four footer consumers omit
it and keep their upward placement and window clamp. The `.composer-options` offsets
resolve against `.composer-options-anchor` (its own block rather than
`.composer-options__anchor`, since it wraps a *trigger* the panel knows nothing about, and #940 in fact
put it on the message box rather than on a button — see below for why it did not reuse this class):

- **`bottom: 100%`** puts the panel's bottom edge on the anchor's top edge, with no gap.
- **`left: calc(-1 * var(--space-3) - var(--composer-options-shift, 0px))`** — written as the negation
  of `--space-3`, never as `-12px`, because the alignment number *is*
  `.composer-options__item`'s left padding: a footer button's label starts at the button's own left
  edge (Figma `115:3688` — text at x=0, chevron at x=28), so pulling the panel 12px left of the button
  puts an option's label horizontally flush with the button's label (AC2, the operator's instruction of
  2026-08-22). Neither centred on the button nor left-aligned to it — both put the labels out of line.
  If the row inset ever moves, this must move with it or the labels drift; writing the token rather
  than the literal makes that automatic.
- **`--composer-options-shift`** is AC3's right-edge clamp, defaulting to `0px` so the resting rule
  holds at every legal window width, where the computed shift is in fact always `0` (see #847 below —
  the sole live consumer's anchor sits over 200px inside the narrowest permitted window). It is computed
  by `composerOptionsShiftPx()`, a new file,
  `composerOptionsPlacement.ts`, built to the `threadScrollPosition.ts` shape: framework-free, DOM-free,
  a total function over three named plain numbers (`anchorLeft`, `panelWidth`, `windowWidth` — named
  rather than positional so `panelWidth`↔`windowWidth` can't transpose silently at the untested call
  site). One expression and one `Math.max(0, …)`, no guards: the resting left edge is
  `anchorLeft − COMPOSER_OPTIONS_LABEL_INSET_PX` (12, paired by comment with `--space-3` on both sides —
  there is no detector for that coupling since #838 forbids reading `conversation.css` as text from a
  test, so it is carried by comments plus a pinning test, exactly as `AT_BOTTOM_TOLERANCE_PX` is), and
  the shift is that plus `panelWidth − windowWidth`, floored at zero. **`windowWidth` is the window's
  own right edge, not the chat pane's** — a deliberate geometry call: at the 800px minimum the pane's
  right edge is 780 while the window's is 800, so a clamped panel may overhang that 20px
  `.paired-shell` gutter, which is empty backdrop with the sidebar on the other side. **There is no left
  clamp**: the sidebar is `flex: 0 0 400px` and never shrinks, so the leftmost footer button's left edge
  is `20 + 400 + 20 + 12 + 16 = 468` at every window width and the panel's leftmost resting edge is
  456 — unreachable by construction, so a guard for it would be an untestable branch defending an
  unobservable failure. Shipped dormant at #839, exactly like `threadScrollPosition.ts` ahead of #601:
  no footer button existed yet to open the panel from, so no caller was added to "prove it works." #847
  (below) is the caller. #940 later added a *second* function to this file, `composerOptionsMaxWidthPx`,
  for the type-ahead's window-relative width bound — see
  [Slash command type-ahead § the width bound](conversation-shell-composer-options-slash-type-ahead.md).
- The custom property is set on the **anchor**, not the panel, so inheritance carries the shift down
  without widening `ComposerOptionsPanel`'s four-prop surface or forwarding a ref into it — the value
  must carry a unit, or the whole `left` declaration goes invalid at computed-value time and the panel
  falls to `left: auto`.

**Top-bar placement.** `placement="bottom-end"` adds
`composer-options-anchor--bottom-end`, a non-shrinking anchor around the existing 24px
icon button. Its direct panel overrides only offsets: `top: 100%; right: 0;
bottom: auto; left: auto`. The panel starts at the button's bottom edge and aligns with
its right edge, rather than the full header's edges. The shared clamp hook still runs
on open and resize, but its `--composer-options-shift` has no effect on this placement's
`left: auto`. The top bar's three fixed labels fit within the window at the 800px floor;
this is not a general width clamp for arbitrary bottom-end consumers. Keep the
outside-click ref on the shared anchor, so the adjacent conversation title dismisses
the menu. Only the title clips; clipping the header row would also cut off the panel.

**Why the wrapper is `display: flex` with no padding and no border.** A block wrapper around an
inline-block `<button>` establishes an inline formatting context, and the line box's strut leading
makes the wrapper measurably taller than the button — breaking AC1's "the button's top edge" and
overflowing `.composer__footer`'s hard `height: 20px`. Flex has no strut, so the anchor's box matches
the button's on all four edges; any padding or border on the anchor would equally detune AC1/AC2, since
`left`/`bottom` resolve against the element's *padding* box. `position: relative` on the anchor is what
makes `left`/`bottom` resolve against the button at all — without it they'd resolve against
`.conversation`, the next positioned ancestor (line 18), landing the panel somewhere in the chat pane.

Verified out-of-band the same way #838 was (no vitest detector exists for stylesheet declarations, per
the ruling at `ConversationScreen.test.tsx:1128-1132`): a throwaway Playwright harness loading the
repo's real `tokens.css`/`pairedShell.css`/`conversation.css` at an 800px viewport. One trap worth
keeping for the next ticket that reaches for this technique: **a `file://` stylesheet will not load
into a page put up with Playwright's `setContent`** — that page stays on `about:blank`, so the links
are cross-origin and silently dropped, and everything measures as though unstyled. `page.goto('file://…')`
loads them; assert `document.styleSheets.length` before trusting any measurement taken this way, since
an unstyled page measures fine, it just measures the wrong thing.

Code review PASS on both — #838's two non-blocking NITs above, and #839's two NITs (a stale line
reference in a coupling comment, and `window.innerWidth` vs. `document.documentElement.clientWidth` for
a scrollbar edge case neither worth fixing without a live consumer) — see
[PR #841](https://github.com/pyrycode/pyrycode-desktop/pull/841) and
[PR #843](https://github.com/pyrycode/pyrycode-desktop/pull/843). #847's review re-examined the
`innerWidth`/`clientWidth` NIT now that a live consumer exists and closed it rather than reopening it:
`html, body, #root` are `height: 100%` with every scroll container interior to a pane, so the document
root never scrolls and the two values coincide — and independently, the shift is `0` at every legal
window width, so the branch stays unobservable either way.

**Interaction (#840).** Two pieces complete the panel: `composerOptionsKeyboard.ts`, a DOM-free total
function holding the whole keyboard contract, and `ComposerOptionsMenu`, an exported container in
`ComposerOptionsPanel.tsx` beside the view. Footer controls and `ThreadOverflowMenu`
share that container, so focus, activation and dismissal have one implementation.
**The trigger's behaviour and ARIA are the container's — `aria-haspopup="menu"`,
`aria-expanded`, the toggle `onClick` — its label and appearance stay the consumer's**, passed in as
`triggerContent` and `triggerClassName`. Text triggers omit the optional `triggerAriaLabel`
and take their accessible name from visible text. Icon-only consumers supply a
client-owned name: the top bar passes `triggerAriaLabel="More actions"` alongside its
decorative SVG. The separate `ariaLabel` names the menu panel. State is component-local
`useState` (`open`, `focusedIndex`), never the session store —
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)'s `sheetOpen` precedent —
so it resets to closed on remount for free.

`resolveComposerOptionsKey({ optionCount, focusedIndex, key })` returns a sealed
`{ type: 'focus' | 'pick' | 'dismiss' | 'ignore' }` union and is total: it never throws, every `focus`
index it emits is in `[0, optionCount)`, and `pick` is range-guarded so `options[index]` is always
addressable. Four decisions were settled explicitly rather than left to the implementation:

- **Focus opens on the current option, or the first when there is none** —
  `initialFocusedOptionIndex(options, currentId)`, one `findIndex` with `-1` falling back to `0`. A value
  menu (#682, #683) opens where the arrows should be relative to what it currently reads; a command list
  (Actions, the top bar or type-ahead — `currentId: null`) opens on its first entry; a **stale** id lands on the first entry
  through the identical branch, no special case, mirroring how the view already handles a stale
  `currentId` in its markup.
- **Arrows wrap.** `ArrowDown`/`ArrowUp` step by ±1 through `(((focusedIndex + delta) % optionCount) +
  optionCount) % optionCount` — the doubled modulo is load-bearing twice: `-1 % n` is negative in
  JavaScript, so the first `+ optionCount` is what keeps a wrap off the top addressing a real row, and
  the second `%` runs on a non-negative number, which is what rules out `-0` (`Object.is(-0, 0)` is
  `false`, so a negative zero passes every range check and only fails a later strict-equality
  assertion). The totality property test asserts `Object.is(index, -0) === false` explicitly rather than
  trusting the bounds — worth remembering for any future roving-index wrap.
- **`Enter` is intercepted; `Space` is not.** Enter must be, or the focused row's native button
  activation would fire `onSelect` a second time on top of the `pick`; Space returns `ignore`, runs no
  `preventDefault`, and the row's own `onClick` picks it — two paths to the same outcome, on purpose.
- **`Home`, `End`, `ArrowLeft`, `ArrowRight` and `Tab` fall through unhandled.** None is an acceptance
  criterion; Left/Right belong to a menubar that doesn't exist here, and Tab moving focus off the panel
  while it stays open is a deliberately open question for #680 to decide on a real user, not invented
  glue here.

**One keydown path.** `ComposerOptionsMenu` moves focus through a plain `useEffect`
(`querySelectorAll('.composer-options__item')[focusedIndex]?.focus()`). Its anchor's
React `onKeyDown` handles keys from both trigger and rows, preventing the default for
every outcome except `ignore` so arrows do not scroll the thread and Enter does not
double-fire. The top bar now uses this same path: Enter/Space on More actions opens
with Channel info already focused; no Tab is needed to reach the first action. Escape
closes and returns focus to the trigger. The old top-bar document keydown listener was
removed with its separate interaction state.

A document `mousedown` listener handles outside clicks, attached only while open and
removed on close or unmount. `close()` focuses the trigger before the browser's native
mousedown focus action, allowing a clicked input to receive focus and caret placement.
Preventing that default would steal focus from the control the user clicked.

**Testing is split at the DOM boundary, deliberately.** `composerOptionsKeyboard.test.ts` executes the
whole keyboard contract with no DOM, including a totality property (every `optionCount` 1–5, every
`focusedIndex` from `-1` to `optionCount`, both arrow keys → a `focus` index always in range). The
markup half extends `ComposerOptionsPanel.test.tsx` with a `focusedIndex` parameter on `renderPanel`
(defaulted, so the eight pre-existing tests are untouched — the proof the change is additive), plus one
static-render assertion of the container's *collapsed* markup (`aria-haspopup="menu"`,
`aria-expanded="false"`, no `role="menu"` anywhere — reachable because `useState(false)` is what a
static render sees). Static tests also pin the optional icon name and bottom-end class.
They cannot exercise `useState` transitions, document listeners or focus calls:
`environment: 'node'` fires no clicks and runs no effects. Those belong to Playwright.
`e2e/composer-actions.spec.ts` retains the footer activation/dismissal proof, and
`e2e/composer-options-clamp.spec.ts` checks its label alignment and
resize clamp. `e2e/chat-top-bar-geometry.spec.ts` covers the top-bar menu at 800px and
1280px: alignment, containment, first-row focus, arrow wrap, activation of all three
destinations, Escape and outside/title dismissal. Its
[paint-order probes](conversation-shell-chrome.md#layout-contract) detect divider and
message occlusion that visibility and geometry alone missed, and keep a menu mounted
under a sheet or dialog to prove overlay precedence.

Code review PASS with one deferred SHOULD FIX: the `switch (outcome.type)` in `handleKeyDown` has no
`default: return assertNever(outcome)`, the exhaustiveness-guard convention this repo otherwise applies
uniformly (`composerSend.ts`, `messageViewModel.ts`, `pairingState.ts`, and others). Its absence is
silent today — every outcome is handled — but a fifth outcome added later (the module's own docblock
names Home/End as a two-line follow-up) would be swallowed by the switch with no type error and no test
catching it at the unit tier, since static renders cannot exercise the handler. The PR recorded folding the guard into #680's
first live mount as the intended timing — **that did not happen**: #680's diff touches no line of
`ComposerOptionsPanel.tsx` (confirmed against its merged diff and its code review, PR #848, which is
silent on the guard). The gap is still open for whichever ticket next touches this file. Two accepted
NITs alongside the deferred fix: `Enter` on a Shift-Tabbed-back trigger resolves to `pick` rather than
toggling the menu shut (unreachable without the still-open Tab question above, also still open), and the
container's trigger assertions don't yet pin `type="button"` the way the panel's own row test pins it on
each option — see [PR #845](https://github.com/pyrycode/pyrycode-desktop/pull/845).

**Right-edge clamp wiring (#847), later lifted into a shared hook (#940).** #839 shipped the
arithmetic and the CSS hook dormant, on purpose: `composerOptionsShiftPx()` had no caller and
`--composer-options-shift` had no setter, because no anchor had a real x-position until a real footer
button gave it one — #680 was that button. #847 joined the two, entirely inside `ComposerOptionsMenu`.
**That is no longer where the effect body lives**: #940 needed the same clamp for the type-ahead, whose
anchor is the message box rather than a footer button, and could not reach an effect closing over
`ComposerOptionsMenu`'s own private refs — so it extracted the measure-and-write body verbatim into an
exported hook, `useComposerOptionsClamp({ anchorRef, panelRef, active })`, and `ComposerOptionsMenu` now
calls it with `active: open` rather than running the effect inline. The description immediately below is
of that hook's body; only its location moved. See [Slash command type-ahead § the clamp is
lifted](conversation-shell-composer-options-slash-type-ahead.md) for the extraction's own reasoning and
for the width-bound half #940 added alongside it.

A `useLayoutEffect`-shaped effect, gated on `active` (`open` for the menu), measures `anchorRef.current.getBoundingClientRect().left`,
`panelRef.current.offsetWidth` and `window.innerWidth` — the three named fields `composerOptionsPlacement.ts`
takes, in that order so the `panelWidth`↔`windowWidth` transposition stays impossible by inspection — feeds
them to `composerOptionsShiftPx()`, and writes the result onto the anchor with
`anchor.style.setProperty('--composer-options-shift', \`${shift}px\`)`. **Imperative, not declarative**: a
`useState` shift plus a `style` prop was the shape `composerOptionsPlacement.ts`'s own dormant-era sketch
showed, but it re-renders the subtree per resize event, needs an `as CSSProperties` cast the setter form
doesn't, and — the deciding reason — `ComposerOptionsPanel.test.tsx:229` already pins the anchor's whole
opening tag as plain `<div class="composer-options-anchor">`; a `style` prop would fail that shipped
assertion. Applied once on open and again on every `resize` while open, torn down on close and unmount —
the outside-click listener's lifecycle, copied verbatim. The property is never cleared on close: the panel
that inherits it unmounts with it, and the next open recomputes before paint, so a stale value is
inherited by nothing and displayed never.

**The alias, not a raw `useLayoutEffect`.** `ComposerOptionsMenu` is reached under
`renderToStaticMarkup` from three test files, `ConversationScreen.test.tsx`'s ~33 sites among them, and
React 18 logs a warning once per render site when `useLayoutEffect` runs there. The fix is
`ConversationScreen.tsx:387-394`'s own `useThreadLayoutEffect` pattern, duplicated rather than shared:
`const useComposerOptionsLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect`,
declared at module scope beside `useComposerOptionsClamp`, its only consumer. It costs nothing in the window, where `document`
exists and the alias resolves to the real `useLayoutEffect`, so the panel still never paints unclamped.

**Idempotent by construction, and this is why `anchorLeft` stayed the input.** The panel is `position:
absolute`, so shifting it moves neither the anchor's rect (an out-of-flow child isn't a flex item) nor
the panel's own `max-content` width, and `window.innerWidth` is independent of both — every input to
`composerOptionsShiftPx()` is invariant under the shift it produces, so a `resize` re-read converges
instead of walking the panel further left each time.

**No vitest coverage, and that absence is itself the ticket's finding**, not a gap: `environment: 'node'`
runs no layout and no effects, so nothing here is executable at the unit tier. The proof is
`e2e/composer-options-clamp.spec.ts`, a new file rather than an addition to `composer-actions.spec.ts`
since the clamp belongs to the shared container and Actions is merely the only host that exists yet —
this is the file #682 and #683 extend, and #940's later host as well. The spec's rig had to manufacture an overflow no shipped consumer
can produce: the footer's one control sits at anchor x≈468 at every window width (the sidebar never
shrinks), and its longest label puts the resting right edge near 586 — over 200px inside the 800px
minimum window width the app enforces. `BrowserWindow.setMinimumSize` is settable at runtime
(`paired-shell-navigation.spec.ts`'s precedent), so the spec lifts the floor, narrows to 520px to force a
real overflow, asserts the clamp, widens back past launch width to prove the shift releases, and restores
the floor. The rig drives a window size no user can reach; that's disclosed rather than hidden, and it's
sound because the clamp is geometry-independent and the arithmetic is already pinned at legal widths by
`composerOptionsPlacement.test.ts`.

One e2e lesson worth carrying to any future geometry spec: **`expect.poll(...).toBe(0)` on a rounded
pixel delta is not safe** — `toBe` is `Object.is`, and `Math.round` of a tiny negative fraction returns
`-0`, which is exactly what a *correctly* clamped panel produces. `Object.is(-0, 0)` is `false`, so the
checkpoint that measured perfectly was the one that never passed, and the failure (`Expected: 0, Received:
-0`) reads as a product bug rather than a normalisation gap. Normalise (`Object.is(x, -0) ? 0 : x`, or
add `0`) before asserting zero on any rounded geometry delta.

Code review PASS, one non-blocking SHOULD FIX left uncorrected in this PR: `composerOptionsPlacement.ts`'s
own doc comment and two `conversation.css` comments still read as though the property ships dormant and
is wired declaratively by a future consumer (`"It ships DORMANT BY DESIGN… Do not add a caller here"`, a
`style={{…} as CSSProperties}` recipe, `"the wiring above is all that is left to write"`) — none of which
is true after this PR, and the declarative shape shown is the one this PR's own reasoning rejected. Left
uncorrected because both files were outside this diff's touched paths, not because the finding was
disputed. **Whoever opens `composerOptionsPlacement.ts` for #682 or #683 should correct those four
comments first** — they currently hand the next consumer a recipe for the wiring this ticket already
built, in a shape review would reject a second time. (**Update:** #940 did open this file next, for the
width bound rather than #682/#683, and left this correction for whichever of those lands first — its own
addition, `composerOptionsMaxWidthPx`, does not touch these four comments.)

## Unavailable rows (#681)

`ComposerOptionsPanelOption` grows one **optional** field, `unavailable?: boolean`, its first addition
since #838 shipped the two-field shape — the authorization `ComposerActionsMenu.tsx` had stood asking for
since #680, raised and granted on #681. Optional is what keeps this an addition rather than a migration:
the other consumers (permission mode, model, effort, the top bar and slash-command type-ahead) omit it, so
`isUnavailable` is `false` for every option they render and the three markup changes below are each
absent — the ordinary-row runs stay the exact strings seven spec files already match
(`class="composer-options__item"` and `class="composer-options__item composer-options__item--current"`).
A field on the *row* rather than a fifth top-level prop (a parallel id list or set), for the reason
`currentId` already gives: it's per-row information, and `ComposerOptionsMenu` already holds `options`, so
its activation gate (below) needs no new prop threading either.

The row gains, all three gated on `option.unavailable === true` (an explicit comparison, not a bare
truthiness read — `undefined` is the ordinary case for an optional field):

- `composer-options__item--unavailable` appended to the class run **after** `--current` —
  `rowClassName(isCurrent, isUnavailable)` replaces the inline ternary, but the two shipped strings it
  produces for `isUnavailable === false` are unchanged.
- `aria-disabled="true"`, placed **after** `aria-current` — nothing may be inserted between `className`
  and `aria-current`, the load-bearing order this file already states above. `undefined` otherwise, so
  React omits the attribute rather than emitting `aria-disabled="false"`.
- A visually-hidden `<span className="composer-options__unavailable-note">` rendering
  `COMPOSER_OPTIONS_UNAVAILABLE_NOTE` (`'(unavailable in this workspace)'`, an exported module constant),
  appended to the row's accessible name so assistive technology announces a *reason* rather than only
  "dimmed." It is hidden **text**, never an `aria-label` — an `aria-label` is an attribute sink, which
  CLAUDE.md's daemon-text ruling forbids, and this row's `label` is workspace-authored for the type-ahead
  consumer, so composing label-plus-suffix into an attribute would put untrusted text exactly where it may
  not go. The constant is a load-bearing e2e locator (`e2e/composer-actions-unavailable.spec.ts` matches
  it) in the `SEND_LABEL`/`COMPOSER_ACTIONS_LABEL` family, and it is client-owned by construction: no
  workspace string may ever reach it. The CSS is the `.composer-status__error-prefix` recipe verbatim
  (`clip-path: inset(50%)`, not the legacy `clip: rect()`) — this is that recipe's third consumer, still
  kept a BEM element (`.composer-options__unavailable-note`) rather than promoted to a shared utility,
  since promoting it would mean editing two unrelated rules and their JSX for a refactor this ticket did
  not need.

**The gate lives in `ComposerOptionsMenu.select`, not in the view.** The bare `ComposerOptionsPanel` stays
a pure view and does not gate activation — whether an entry is unavailable is the consumer's question
(#681 answers it in the Actions menu's `composerActionAvailability.ts`, from the published slash-command
list; see [Conversation shell — actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)),
exactly as `currentId`'s *meaning* is the consumer's while its *marking* is this file's. `select(id)` is
where the click path (the panel's `onClick`) and the Enter path (`handleKeyDown`'s `pick` arm) already
funnel into one place, so the one-line early return — `if (isUnavailable(id)) return` — closes both at
once with nothing to drift. `isUnavailable` is a linear `options.some(...)` scan, deliberately not a `Set`
or a lookup object keyed by id: the panel's own contract lets a consumer pass daemon text as an id, and an
object keyed by one would be a prototype-pollution sink. An unavailable pick leaves the panel **open**
with focus where it was — what a disabled menu item does, and the only report that reads as "nothing
happened" rather than a successful pick. No shipped consumer of the bare panel passes `unavailable`, so no
activation path is left ungated.

**Why ARIA and not the HTML `disabled` attribute**, restated from the design: the container drives a
roving tabindex and moves real DOM focus onto the focused row, and a `disabled` button is not focusable —
arrow navigation would appear stuck on the greyed row and the focus call would silently no-op. Keeping the
row focusable and gating activation instead is also what leaves `composerOptionsKeyboard.ts`, shared by
every consumer, untouched. The `:focus-visible` outline is deliberately **not** suppressed on an
unavailable row — the row stays focusable by design, so hiding where focus sits would be the actual
accessibility regression.

**CSS** (`conversation.css`, appended): `.composer-options__item--unavailable` sets
`color: var(--color-on-surface-variant)` and `cursor: not-allowed` — the `.composer__send:disabled` /
`.workspace-picker__row:disabled` convention, never a raw opacity literal, chosen because the Figma node
(`121:3879`) carries no disabled variant to port (five identical `Option button` instances and nothing
else). It sets no `background`, so it composes with `--current` rather than fighting it — both are
specificity (0,2,0) on disjoint properties. The shipped hover rule gained
`:not(.composer-options__item--unavailable)`, the `.composer__send:hover:not(:disabled)` idiom, raising it
to (0,3,0) — which *strengthens* the "do not reorder these two rules" comment above rather than
contradicting it: hover still beats `--current`, now by specificity as well as by source order, while a
row that cannot be picked no longer advertises a hover affordance.

**Testing.** `ComposerOptionsPanel.test.tsx` adds one case proving AC5 directly: a mixed
available/unavailable/current list renders the available rows' class and ARIA runs byte-identical to
today's, alongside the existing whole-attribute-run assertions that are the actual regression detector.
`composerActionAvailability.test.ts` and `ComposerActionsMenu.test.tsx` carry the decision-layer and
mapping proof — see [Conversation shell — actions menu § grey-out](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)
for that half, since the decision itself is not this file's.

Code review (self-review, since #681 was builder-reviewed) PASS, one SHOULD FIX recorded for a future
pass: state the "hidden text, never an attribute" constraint directly in this file's own comment where the
other consumers read it, rather than only in the ticket record — not yet applied.
