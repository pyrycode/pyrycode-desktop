# Conversation shell — slash command type-ahead

The slash-command type-ahead over the composer's message box: #939's pure opening/filtering/completion
decisions, and #940's mount that renders them as a panel anchored to the message box.

Part of [Composer options panel](conversation-shell-composer-options.md), which covers the shared panel
surface these sections build on ([surface, placement, keyboard, clamp](conversation-shell-composer-options-panel.md)),
and [Conversation shell](conversation-shell.md) for the screen overall.

## Slash command type-ahead — decision layer (#939)

Split from #694, unblocked once [#935](slash-command-list-wire-types.md) declared `WireSlashCommand`.
New file, `slashCommandTypeAhead.ts`, sibling to `composerOptionsKeyboard.ts` and built to its exact
shape: framework-free, DOM-free, two exported functions, no component, no store read, no mount —
`environment: 'node'` and no `@testing-library` mean nothing here can click, so everything the
type-ahead *decides* had to become a total function a vitest spec can execute, leaving the render
container (#940) thin enough to be correct by inspection. It composes *with*
`resolveComposerOptionsKey`/`initialFocusedOptionIndex` rather than re-deciding any of their
arrows-with-wrap, Enter-picks, Escape-dismisses or first-row-on-open behaviour; the one place they
touch is that filtering narrows the list while the panel is open, which can leave a focused index
addressing no row — `resolveComposerOptionsKey`'s `Enter` arm is already range-guarded for exactly
that, by name, at `composerOptionsKeyboard.ts:121-122`.

```ts
function slashCommandTypeAheadRows(
  text: string,
  commands: readonly WireSlashCommand[] | null
): readonly WireSlashCommand[]

function completeSlashCommand(command: WireSlashCommand): string
```

**The returned row array *is* the open state — there is no separate `open` flag.** All six closed
cases (empty text, a slash after any other character, a slash followed by whitespace, `commands ===
null`, `commands: []`, a fragment nothing matches) return `[]` through the one encoding, making "open
with zero rows" unrepresentable rather than merely guarded against — the same convention
`ComposerOptionsMenu`'s consumers already use (`options.length` gates the panel). The one hazard: `[]`
is truthy in JavaScript, so a container must write `rows.length > 0 && <panel/>`, never `rows.length
&& …` or `rows && …`.

**Opening** is one anchored regex, `/^\/(\S*)$/` — `\S` rather than a literal space so a tab or
newline also closes the panel (a fragment is one unbroken run by construction), and JS's strict
end-of-input `$` (unlike Python's) means a trailing newline closes rather than being silently
trimmed. One rule covers all four of the parent ticket's requirements, because claude only intercepts
a message that *begins* with a slash.

**Filtering** ranks each row over its `name` and every visible alias into one of three buckets —
`prefix`, `contained`, and `unknown` — concatenated in that fixed order rather than sorted, so
claude's published order is preserved within each bucket by construction rather than by appeal to
`Array.prototype.sort`'s stability guarantee. A row that merely contains the fragment in its `name`
but prefixes it in a later alias still ranks `prefix` — the scan does not stop at the first hit.
Case folding is `toLowerCase()`, never `toLocaleLowerCase()` (the Turkish-`i` trap), and nothing else
is normalised; the `description` is never searched, so a fragment matching only prose can't hand the
user a command whose name they never typed.

**A row whose `truncated_fields` names `aliases` is the `unknown` bucket** — transposed unchanged
from the wire type's own reading rule (see [Slash-command-list wire types § How it
works](slash-command-list-wire-types.md#how-it-works)): `aliases: []` states nothing on its own,
since claude never emits an empty alias array, so a row
whose visible aliases fail to match is a *maybe*, not a non-match. It trails both real-match buckets
(never outranks a genuine hit) but survives as the sole candidate when it is the only one, keeping the
panel open rather than closed — the failure mode the user story names. The helper,
`hasUnknownAliases`, is written `truncated_fields !== null && truncated_fields.includes('aliases')`
with an explicit null test rather than `?.includes(…)`, because the optional-chaining form is the
exact shape that silently inverts the rule on an unvalidated frame (an absent key reads `undefined`,
equally falsy). This module depends on #936's fail-closed narrower for that reading to be sound at
all — a bare `as WireSlashCommand[]` would make the check meaningless, not merely unsafe.

**Completing** returns the canonical name with its leading slash, plus exactly one trailing space
when `argument_hint !== ''` (a literal test, not trimmed) and none when it is empty — canonical even
for a row matched only by an alias, so nothing downstream resolves an alias back, which is why
`completeSlashCommand` takes the whole row rather than `(name, argumentHint)` (two same-typed strings
transpose silently with no type error, `composerOptionsPlacement.ts`'s stated reason for the same
shape). The name is copied verbatim — no escape, no trim, no case change — since it is
workspace-authored text the daemon bounds but does not sanitize, landing in a controlled `<textarea>`
value and nowhere else. **The two rules agree by construction**: a hinted completion ends in a space,
and a slash followed by a space is closed, so the panel gets out of the way exactly when an argument
is about to be typed — pinned as an executable property in the spec (feeding a completion straight
back through `slashCommandTypeAheadRows`), not left as a comment. An un-hinted completion leaves the
panel matching the row just picked; closing it on pick is left to #940's container rather than to this
module.

**Untrusted input, no sink.** `name`, `argument_hint`, `description` and every alias are
workspace-authored — `__remote-workflow` (no identifier charset) and an embedded-newline,
non-ASCII `description` are both in the fixture — matched and copied with no charset assumption. No
`console.*` and no thrown error anywhere in the module: both functions are total, so there is no error
path to leak a row through, and `0x0a` is the only sub-`0x20` byte measured across the wire type's
whole capture, meaning a newline is the one control character a logged description could actually
use to forge a log line. Rows are returned by reference — the store's own objects, never projected or
copied — and the returned array's identity is deliberately not a contract; a future container must not
`useEffect` on it.

**Testing.** Co-located `slashCommandTypeAhead.test.ts`, `environment: 'node'`, AC-tagged
`describe` blocks. Fixture rows are lifted from `src/shared/wire/types.test.ts`'s committed upstream
values (`clear`'s `aliases: ['reset', 'new']` is the ticket's worked case) plus two hand-authored rows
the ACs name outright: one `truncated_fields: ['aliases']` (no committed upstream fixture carries
one), and `__remote-workflow` with an alias `Workflow` proving the case fold both directions. A
totality sweep asserts every answer, for every text × list-shape combination, is an array drawn
verbatim from the input with no duplicate — the property that makes #940's `options[index]`
lookup safe once this module has done the narrowing.

**Shipped dormant, then mounted by #940** (below) — the render slice that composes this module with
`ComposerOptionsPanel` and `resolveComposerOptionsKey`, feeding it `entry?.commands ?? null` from
`selectSlashCommandListFor(conversationId)` and the composer's own text, and deciding where focus
lands after a narrowing (this module's own docblock was explicit that that choice was the
container's, not its — #940 answers it by re-deriving the highlight from the text on every render,
see below). Security review (architect self-review) PASS, no findings — see
`docs/specs/architecture/939-slash-command-type-ahead-decisions.md`.

## Slash command type-ahead — mount (#940)

The visible half of #694, and the slice that makes the whole family — #935/#936/#937's wire-to-IPC
carry, #954's store, #939's decisions — observable for the first time. New file,
`ComposerSlashCommandTypeAhead.tsx`, the `ComposerActionsMenu.tsx` precedent verbatim (its own CSS
lives in `conversation.css`, imported once by `ConversationScreen.tsx`). Named with the `Composer*`
prefix and not `SlashCommandTypeAhead.tsx` — matching #939's `slashCommandTypeAhead.ts` by anything
less than that prefix would collide on this repo's case-insensitive filesystem, where a resolver
reaching for `.tsx` before `.ts` would answer `import … from './slashCommandTypeAhead'` with this
file itself.

**#934 settled the panel's own geometry by decision, one minute after PR #959 opened, superseding
the plan's written-description guesses.** The parent ticket's Figma (node 121:3879) draws the row,
height and colour but not a description row, a cap, or a width bound; #934 was meant to draw those
three and closed instead with:

> 1. Hide the descriptions for now
> 2. Show max 10 items
> 3. Set max width to what fits the window with 40px margin to window edge

So **no description reaches the panel at all** — `ComposerOptionsPanelOption` keeps its original
two-field shape (`id`, `label`), the panel's row markup is untouched, and only `name` and
`argument_hint` (composed as one `label`) of `WireSlashCommand`'s four workspace-authored fields
ever reach the DOM. That narrows this slice's render-boundary obligation to those two fields, not
weakens it: the same daemon-text ruling applies to both.

**Five exports**, the split every sibling in this cluster made — a total function or a pure view for
everything `renderToStaticMarkup` can execute, a thin hook for the rest:

- `SLASH_COMMAND_TYPE_AHEAD_LABEL = 'Slash commands'` — the panel's `aria-label` and the e2e locator,
  a client-owned constant distinct from the Actions panel's under the same `role="menu"`.
- `slashCommandTypeAheadOptions(rows)` — maps rows to `ComposerOptionsPanelOption[]`, `label` as
  `` `/${name}` `` plus `` ` ${argument_hint}` `` when the hint is non-empty (one string, not a third
  field, matching `completeSlashCommand`'s own `!== ''` test), **`id` as the row's array index cast to
  a string, never `name`** — `name` is not an identifier (`__remote-workflow` is a measured value) and
  carries no uniqueness on the wire, so two rows can share one; an index is client-generated and
  collision-free by construction, satisfying the store's stated key obligation.
- `slashCommandTypeAheadStateFor(held, text)` — the container's one `useState` cell,
  `{ text, highlightedIndex, dismissed }`, keyed by the text it was decided for. Same text returns
  `held` by reference (no render, no re-subscribe); changed text resets to `{ highlightedIndex: 0,
  dismissed: false }` — every reset is a *derivation*, never an effect. `dismissed` is the panel's only
  way to represent "closed while the rows still match", needed because Escape must leave the typed
  text alone (AC3) and an un-hinted completion leaves the fragment intact and still matching (#939) —
  both write `dismissed: true` keyed to the text as of that moment, which is also why a pick's `setHeld`
  keys against the *completed* text rather than the pre-pick one: closing against the wrong text would
  either fail to suppress the re-open or suppress the next real one.
- `SlashCommandTypeAheadPanel({ rows, highlightedIndex, onPick, panelRef })` — the gate
  (`rows.length > 0`, #939's own warning against `rows.length &&` or `rows &&`) and the
  `ComposerOptionsPanel` mapping, returning `null` for an empty list. **The highlight is `currentId`,
  not `focusedIndex`** — DOM focus can never leave the message box (the user is still typing), so no
  row can carry the shipped `:focus-visible` outline; `focusedIndex` is passed as `-1` (the panel's own
  "no row" sentinel) to keep every row out of the tab order, and the highlighted row instead wears
  `.composer-options__item--current`/`aria-current="true"` through the panel's existing current-value
  branch. The panel stays `role="menu"`/`role="menuitem"`, not promoted to a combobox —
  `aria-activedescendant` was rejected by #840 for a reason that still holds (a generated id per row,
  four consumers on one screen), so a screen-reader user can discover the panel but the highlight isn't
  announced; the feature degrades to today's behaviour, a command typed by hand still sends.
- `useSlashCommandTypeAhead({ text, conversationId, onComplete })` — the container: reads
  `selectSlashCommandListFor(conversationId)` through a `useMemo`-stable per-id selector (a `null`
  conversation id selects a stable `() => null`, no invented branch), joins as
  `entry?.commands ?? null` into `slashCommandTypeAheadRows(text, …)`, wires the keyboard, and returns
  `{ anchorRef, inputRef, panel, handleKeyDown }`.

**The anchor is `.composer__row` itself, not `.composer-options-anchor`.** The class the panel's own
CSS was written expecting ([surface, placement § Placement](conversation-shell-composer-options-panel.md)) is not
reused, because `e2e/composer-options-clamp.spec.ts` locates `.composer-options-anchor` and relies on
Playwright strict mode finding **exactly one** in the app — a second element wearing it would turn
that passing spec red for a reason unrelated to the clamp. `.composer__row` already has (or needed)
every property that class carries (`display: flex`, and now `position: relative`, added as one
declaration in `conversation.css`), so nothing is lost. One visible consequence, left as designed
rather than corrected: the shipped `.composer-options` `left` rule pulls the panel 12px left of the
anchor, landing a row's *label* flush with the message box's left edge, while the box's own typed
text starts 16px in (`--space-4` padding) — a 4px gap that is the price of not forking placement.

**Keyboard.** `Composer.handleKeyDown` calls `typeAhead.handleKeyDown(event)` first and returns if it
reports `true` — the whole of "Enter completes, it does not send": a consumed key never reaches
`shouldSubmitOnKeyDown`, so there is no second send path and no second `canSend` copy. The handler
returns `false` immediately on `event.nativeEvent.isComposing`, so an IME-committing Enter neither
completes nor sends and the arrows still drive the IME's candidate window (mirroring
`shouldSubmitOnKeyDown`'s own reason for reading that field off the native event). Otherwise it routes
through `resolveComposerOptionsKey` with the *live* `rows.length` — already range-guarded for a
narrowing that strands the highlight, by name, at `composerOptionsKeyboard.ts:121-122` — and
`preventDefault()`s everything but `ignore`.

**The right-edge clamp is lifted out of `ComposerOptionsMenu`, not copied**, because it closed over
that component's own private refs and this control anchors somewhere else entirely.
`useComposerOptionsClamp({ anchorRef, panelRef, active })`, exported from `ComposerOptionsPanel.tsx`,
is the extracted body verbatim — `conversation.css`'s "one consumer is not a pattern" rule firing now
that there are two — with `useComposerOptionsLayoutEffect`'s server-render-safe alias still inside it.
`ComposerOptionsMenu` now calls the same hook with `active: open`; `e2e/composer-options-clamp.spec.ts`
remains the detector for both hosts, since the extraction moved lines and changed no markup or
behaviour. See [surface, placement § Right-edge clamp
wiring](conversation-shell-composer-options-panel.md) for the effect body's own reasoning, unchanged by
the move.

**#934's third decision — the width bound — is new arithmetic in `composerOptionsPlacement.ts`, not a
CSS literal**, because the value (distance from the panel's resting left edge to the *window's* right
edge) is not expressible by any ancestor: `COMPOSER_OPTIONS_WINDOW_MARGIN_PX = 40` and
`composerOptionsMaxWidthPx({ anchorLeft, windowWidth })`, a `Math.max(0, …)` total function over the
same named fields `composerOptionsShiftPx` reads, minus the panel's own width — the bound the width is
decided *by*, so it cannot itself be a function of that width. `useComposerOptionsClamp` writes it as
`--composer-options-max-width` on the anchor **before** measuring `panel.offsetWidth` for the shift —
reading the panel's laid-out width first would feed the shift an unbounded width and pull the panel
left by an overflow the bound is about to remove. The property is scoped in CSS to
`.composer__row .composer-options` only (`max-width: var(--composer-options-max-width, none)`), so the
three footer menus inherit a custom property no rule of theirs reads; applying it to the Actions panel
would squash it at the artificial widths `e2e/composer-options-clamp.spec.ts` drives to prove the
shift, which stays that spec's only detector. **Consequence stated because an earlier draft of this
plan argued the opposite**: with the width bound in place the panel can never overflow the window, so
`composerOptionsShiftPx`'s result is structurally `0` for this host — the clamp is still wired because
it is one shared effect and because it still catches the panel if the `max-width` declaration is ever
dropped, not because it moves anything here today.

**The cap is 10 rows, not the plan's original 8**, and both corrections behind that number were
measured, not designed: `.composer__row .composer-options { max-height: 280px; overflow-y: auto }` is
exactly 10 × 28px, and this stylesheet's absent `box-sizing` reset means `max-height` bounds the
*content* box, so capping at rows-plus-bands (as an 8-row first pass did) left a several-pixel sliver
of the next row visible. `.composer__row .composer-options__item { flex-shrink: 0; overflow: hidden }`
fixes the sibling bug the row count alone hides: a flex item's default `flex-shrink: 1` let fifteen
rows in a capped column *compress* to ~18px each instead of scrolling
(`scrollHeight === clientHeight`), which no assertion before this ticket's e2e drive could see;
`overflow: hidden` also clips (never ellipsizes — a flex container's text-overflow doesn't apply) a row
that would otherwise force the now-scrollable panel into a second, horizontal scrollbar, and the row's
inherited `white-space: nowrap` is what collapses the one measured sub-`0x20` byte, `0x0a`, to a space.
Both rules are scoped to `.composer__row`'s descendants only — a footer menu's rows keep
`flex-shrink`'s default and no `overflow`, because a scroll container clips at its padding box and
these rows' zero horizontal padding would otherwise cut a keyboard-focused row's `:focus-visible`
outline, a cost only the footer menus (which do move DOM focus into rows) would pay.

**Untrusted text, discharged as designed.** `name` and `argument_hint` are workspace-authored,
daemon-bounded but not sanitized; both reach the DOM only as the panel's existing single React text
child (`ComposerOptionsPanel.tsx`'s row markup, whose doc comment #940 sharpened to state that `label`
may now carry untrusted text — the first consumer of that panel for which this was true). No
`innerHTML`, no `dangerouslySetInnerHTML`, no attribute or URL sink, and no logging anywhere in the
module — `0x0a` remains the only sub-`0x20` byte measured across the capture. `completeSlashCommand`
copies `name` verbatim into the message box (#939's contract, unchanged here), so a name carrying a
real `0x0a` can render as one `nowrap` line while completing to a literal newline — not repaired here,
since completion never sends and a second, deliberate Enter is what does, through the unchanged gate.

**No ADR.** Every decision here is either a consumer of an already-settled contract (#838's panel,
\#839/#847's clamp, #840's keyboard, #939's rows) or local to this one screen; the ARIA trade-off is
resolved within the shipped panel rather than against it, and a real combobox — if #934 ever draws
one — would carry its own record then.

**Testing.** `ComposerSlashCommandTypeAhead.test.tsx` (`environment: 'node'`,
`renderToStaticMarkup`): the state-derivation rules, the options mapping (hint appended only when
non-empty, ids as indices, two same-named rows still get distinct ids), the panel's closed/open
markup including a hostile name/hostile-description sweep (escaped, no
attribute sink), and a container smoke test. **The container smoke seeds the mocked store at
*creation*, not by calling `setSlashCommandList` afterward** — under `renderToStaticMarkup`, Zustand
answers from `getServerSnapshot`, bound to the state captured when the store was *created*, so a
post-creation seed is invisible to a static render (this repo's own [Zustand-singleton
lesson](conversation-shell-seams.md), re-confirmed the hard way: the first version of this test failed
exactly this way). The mock passes `createSlashCommandListStore({ menus: … })` and overrides only the
`useSlashCommandListStore` binding, keeping the real `selectSlashCommandListFor` under test.
`e2e/slash-command-type-ahead.spec.ts` (AC5, fake-transport tier) pushes a `slash_command_list` frame
via `daemon.pushFrame` (the unsolicited-frame seam, since `buildReplyFrames` only answers outbound
envelopes), types a slash, narrows it, arrows to a row, completes it, and asserts both the resulting
box text and — via `composer-actions.spec.ts`'s `captureOutbound` idiom — that nothing was sent; a
400-character hostile command name proves the width bound actually binds (an equality against
`innerWidth`, not a `<=` a short panel would satisfy for free), and ten filler rows behind a bare `/`
prove the 10-row cap actually scrolls rather than compresses.

Code review PASS — see [PR #959](https://github.com/pyrycode/pyrycode-desktop/pull/959). Two SHOULD
FIX findings, both addressed in the same PR before merge: `ComposerOptionsPanelOption`'s doc comment
now states `label` may carry untrusted text (above), and the clamp extraction preserves the `resize`
listener's `[active]`-only lifecycle exactly, verified by the existing e2e spec covering both hosts.
