# #940 — open the slash-command type-ahead over the message box

The visible half of #694: mount #939's decision layer over the composer's message box, reading #954's
per-conversation command list, drawn on #838's shared options panel.

## Files read

- `src/renderer/src/screens/conversation/slashCommandTypeAhead.ts` → `slashCommandTypeAheadRows`,
  `completeSlashCommand` — the decision layer this slice mounts. Its own doc comment states the two
  contracts that shape the container: the returned array **is** the open state (so the gate is
  `rows.length > 0 && …`, never `rows.length && …`), and completing an un-hinted command leaves the
  fragment intact and still matching — *"which is why the container closes it on pick rather than
  relying on the text to do it."*
- `src/renderer/src/store/slashCommandListStore.ts` → `selectSlashCommandListFor`,
  `useSlashCommandListStore`, `SlashCommandListEntry` — the sole read path. `null` (no frame) is
  distinct from an entry holding `commands: []`; both must reach `slashCommandTypeAheadRows` through
  the same `entry?.commands ?? null` join. Its header also names two obligations this slice
  discharges: the inert-plain-text render, and **a React `key` scheme that is not `name`**.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsPanel`,
  `ComposerOptionsPanelOption`, `ComposerOptionsMenu`, `useComposerOptionsLayoutEffect` — the surface
  to extend additively, and the clamp/focus effects that live inside the *menu* container and close
  over its private refs.
- `src/renderer/src/screens/conversation/composerOptionsKeyboard.ts` → `resolveComposerOptionsKey`,
  `initialFocusedOptionIndex` — arrows-with-wrap, Enter-picks, Escape-dismisses, already tested. Its
  `Enter` arm is range-guarded *by name* for this ticket's narrowing case.
- `src/renderer/src/screens/conversation/composerOptionsPlacement.ts` → `composerOptionsShiftPx`,
  `COMPOSER_OPTIONS_LABEL_INSET_PX` — the right-edge clamp arithmetic and the recipe for wiring it.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer` — where `text`,
  `handleKeyDown`, `sendText` and `activeConversationId` already live; the mount site.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__row`, `.composer__input`,
  `.composer-options`, `.composer-options__item`, `.composer-options-anchor` — the geometry the new
  rules extend, and the coupled 12px label inset.
- `src/shared/wire/types.ts` → `WireSlashCommand` — the row shape and the security paragraph naming
  this client's render boundary as the one that owes the sanitization.
- `e2e/composer-actions.spec.ts` → `captureOutbound` — the idiom for proving what was (and was not)
  sent. `e2e/tool-row-toggle.spec.ts` → `daemon.pushFrame` + `encodeEnvelope` for an unsolicited frame.
- `e2e/composer-options-clamp.spec.ts` → its `page.locator('.composer-options-anchor')` expects
  **exactly one** such element in the app. Load-bearing for the anchor decision below.
- `docs/knowledge/features/conversation-shell-composer-options.md` § *Composer options panel* and
  § *Slash command type-ahead — decision layer* — the panel's prop contract and #939's settled rules.
- `docs/knowledge/features/slash-command-list-store.md` — the store's lifetime and no-logging posture.

## Design source

**Figma:** N/A — no drawing exists for this surface. It inherits the options overlay
([node 121:3879](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879)) for row height,
label inset, type and colours, and sits in the desktop conversation pane
([node 102-4](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4)). The three things that
overlay does not settle — a two-part row carrying a description, a height cap with a scroll, and a width
bound — were #934's to draw. **#934 closed on 2026-09-02 without a drawing, having settled all three by
decision instead**, and those decisions are the design source for this control's own geometry:

> 1. Hide the descriptions for now
> 2. Show max 10 items
> 3. Set max width to what fits the window with 40px margin to window edge
>
> — [#934](https://github.com/pyrycode/pyrycode-desktop/issues/934), 2026-09-02, reaching this ticket as
> three MUST FIX findings on PR #959.

So a row is the command name and its argument hint, the panel shows ten rows and scrolls past them, and
its width may grow until its right edge is 40px clear of the window's. Everything else is still the
inherited overlay's, and the visual-fidelity check is against that: 28px rows, the 12px label inset,
body-small type, the panel's `--color-on-primary-fixed` fill. The three decisions above are drawn nowhere,
so if the descriptions come back a drawing can be filed then — #934's own closing words.

Reading #934's third point, stated so it can be corrected: the panel stays anchored at the message box's
left edge and the 40px is measured from the *window's right edge*, since that is the only edge this panel
can approach — the sidebar is fixed at 400px, so its left edge is a constant. The alternative reading,
40px of margin on both sides, would bound a panel that cannot reach the left one.

## Context

#935/#936/#937 carried the daemon's published command menu from the wire to a typed IPC arm, #954 holds
it per conversation, and #939 decides — from the composer's text alone — whether the panel is open, which
rows it shows in what order, and what text a pick produces. Every one of those slices shipped without a
pixel on screen. This slice is the mount, and it is where the whole family becomes observable.

It is also where two inherited obligations are discharged: the workspace-authored strings
(`name`, `argument_hint`, `description`, every alias) reach a DOM sink for the first time, and the panel
surface #838/#839/#840/#847 shipped for five named consumers gets its second live host.

**No ADR is proposed.** Every decision here is either a consumer of a settled contract or local to one
screen; the ARIA question below is resolved *within* the shipped surface rather than against it, and the
day a real combobox is wanted it will arrive with #934's drawing and can carry its own record.

## Design

### The module: one new file beside `ComposerOptionsPanel.tsx`

`src/renderer/src/screens/conversation/SlashCommandTypeAhead.tsx` — the `ComposerActionsMenu.tsx`
precedent verbatim (`ConversationScreen.tsx` is ~3,200 lines and a declared merge hot-spot; it adds no
CSS import of its own). Five exports, and the split is the same one every sibling here made — everything
decidable is a total function or a pure view that `renderToStaticMarkup` can execute, and what is left
in the hook is `useState` and wiring thin enough to be correct by inspection.

```ts
// The panel's accessible name AND the e2e locator. Client-owned, never a daemon string.
const SLASH_COMMAND_TYPE_AHEAD_LABEL: string

// Rows → panel options. The id is the row's INDEX as a string, never its name (§ Untrusted text).
function slashCommandTypeAheadOptions(
  rows: readonly WireSlashCommand[]
): readonly ComposerOptionsPanelOption[]

// The container's own per-text interaction state, held and re-derived rather than reset by an effect.
interface SlashCommandTypeAheadState { text: string; highlightedIndex: number; dismissed: boolean }
function slashCommandTypeAheadStateFor(
  held: SlashCommandTypeAheadState,
  text: string
): SlashCommandTypeAheadState

// The pure view: the gate, the mapping and the panel. Returns null for an empty row list.
function SlashCommandTypeAheadPanel(props: {
  rows: readonly WireSlashCommand[]
  highlightedIndex: number
  onPick: (index: number) => void
  panelRef?: Ref<HTMLDivElement>
}): JSX.Element | null

// The container. Returns the two refs the composer attaches, the element it renders, and a key
// handler that reports whether it consumed the keystroke.
function useSlashCommandTypeAhead(args: {
  text: string
  conversationId: string | null
  onComplete: (text: string) => void
}): {
  anchorRef: RefObject<HTMLDivElement>
  inputRef: RefObject<HTMLTextAreaElement>
  panel: ReactNode
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
}
```

**The join, and its one hazard.** The hook reads
`selectSlashCommandListFor(conversationId)` through `useSlashCommandListStore` (a `useMemo`-stable
selector per id, the `ConversationScreen` precedent for a keyed selector), and passes
`entry?.commands ?? null` into `slashCommandTypeAheadRows(text, …)`. A null `conversationId` selects
nothing and yields `null` commands through the same path — no second branch, no invented key. The gate
is written `rows.length > 0`, never `rows.length &&` (which renders a bare `0`) and never `rows &&`.

**Which component reads what.** `SlashCommandTypeAheadPanel` owns the gate and the mapping so both are
unit-testable; the hook never assembles markup. That is what puts AC1's "nothing renders when it answers
empty" and AC2's row content in the `node` vitest tier rather than in reviewed-but-unproved glue.

### The anchor is `.composer__row`, and it does **not** wear `.composer-options-anchor`

The panel needs a positioned ancestor whose left edge is the message box's left edge. `.composer__row`
already is that element (the textarea is its first flex item and the row carries no padding), so the
design adds one declaration — `position: relative` — rather than wrapping the textarea in a new div and
re-deriving its flex sizing.

**It deliberately does not reuse the `.composer-options-anchor` class**, even though that block's own
comment anticipates this consumer: `e2e/composer-options-clamp.spec.ts` locates
`page.locator('.composer-options-anchor')` and relies on Playwright strict mode finding **exactly one**
in the app. A second element wearing that class turns a passing spec red for a reason that has nothing to
do with the clamp. The class carries only `position: relative` and `display: flex`, both of which
`.composer__row` already has or needs, so nothing is lost by declaring the one missing property in place.

Consequence, stated because it is visible: the shipped `.composer-options` `left` rule pulls the panel
12px left of its anchor, so the rows' labels land flush with the **message box's left edge**, while the
box's own text starts 16px in (`.composer__input`'s `--space-4` padding). Those 4px are the price of not
forking the panel's placement, and the panel's left edge lands exactly on `.composer`'s own content edge.
#934 may settle it differently; nothing here forecloses that.

### Extending the panel surface, additively

`ComposerOptionsPanelOption` gains **one optional field**, `description?: string`. A row without it
renders exactly as it does today — `{option.label}` as the button's sole child — so the four existing
consumers and `ComposerOptionsPanel.test.tsx`'s whole-attribute-run assertions are untouched by
construction. A row with it renders two spans, `.composer-options__name` and
`.composer-options__description`, both ordinary React text children.

The argument hint rides in `label`, composed by `slashCommandTypeAheadOptions` as `/name` plus a space
and the hint when the hint is non-empty. One string rather than a third field: the hint is part of what
the user is picking, the panel needs no rule of its own for it, and a field the panel would only ever
concatenate is a field to keep in agreement.

**CSS (three new rules, one new declaration; `conversation.css` is not counted by the sizing table):**

- `.composer__row { position: relative }` — the anchor, above.
- `.composer__row .composer-options { max-height: 228px; overflow-y: auto }` — AC4's cap and scroll,
  8 rows × 28px plus the panel's 2px bands. **Scoped to this host on purpose**: `overflow-y` makes the
  panel a scroll container, whose padding box clips a row's `:focus-visible` outline horizontally, and
  the three footer menus — which *do* move DOM focus into their rows — must not pay for a cap they can
  never reach. Specificity (0,2,0) beats the base rule; no `!important`, no second surface, no new
  z-index.
- `.composer-options__name { flex: 0 0 auto }` and `.composer-options__description { … }` — the
  description shrinks and ellipsizes (`flex: 0 1 auto; min-width: 0; overflow: hidden;
  text-overflow: ellipsis`), inset from the name by `--space-2`, bounded by a `max-width` of 320px, and
  muted with `--color-on-surface-variant` (this repo's muted-caption role; ≈9.7:1 against the panel's
  `--color-on-primary-fixed` fill, comfortably past AA). The row keeps its shipped 28px height and its
  inherited `white-space: nowrap`, which is also what makes the measured `0x0a` inside a description
  collapse to a space instead of breaking the row.

**The width bound and the clamp do different jobs, and both are wanted.** The `max-width` stops a
1,145-byte description stretching the panel at all (AC2). The clamp keeps whatever width results inside
the window at 800px (AC4) — reachable arithmetic, not dead code: a long name plus a 320px description
puts the panel's resting right edge past the window at the minimum width.

### The clamp is lifted, not copied

`composerOptionsShiftPx` is already wired — inside `ComposerOptionsMenu`, closing over that component's
private `anchorRef`/`panelRef`, so it is unreachable from here. This slice extracts it into an exported
hook in the same file, `useComposerOptionsClamp({ anchorRef, panelRef, active })`, and calls it from both
consumers. `useComposerOptionsLayoutEffect` (the isomorphic alias that keeps the pre-paint guarantee in
the window and the warning noise out of the `node` tier) moves inside it unchanged.

This is `conversation.css`'s "one consumer is not a pattern" rule firing in the direction it points now
that there are two: the alternative is a second copy of a measure-and-write effect whose every hazard —
the mandatory `px` unit, the `[active]`-only dep list, the resize listener's lifecycle — is recorded in
prose rather than in a type. The extraction moves lines and changes no markup and no behaviour, so
`e2e/composer-options-clamp.spec.ts` stays the detector for both hosts.

### The keyboard, and why Enter cannot send

`Composer.handleKeyDown` gains one line ahead of its existing body:

```ts
if (typeAhead.handleKeyDown(event)) return
```

The hook's handler returns `false` for everything it does not consume, so a closed panel changes nothing
about the composer. When open, it routes the key through `resolveComposerOptionsKey` with the *live* row
count, `preventDefault()`s anything that is not `ignore`, and reports `true` — which is the whole of
AC3's "Enter completes, it does not send": the composer's `shouldSubmitOnKeyDown` is never reached on
that keystroke, and the second Enter (panel now closed) falls straight through to the shipped send path
with the shipped gate. There is no new send path and no second copy of `canSend`.

**Composition is checked first.** The handler returns `false` immediately when
`event.nativeEvent.isComposing`, so the Enter that commits an IME composition neither completes nor
sends, and the arrows still drive the IME's own candidate window. This mirrors `shouldSubmitOnKeyDown`'s
reason for reading `isComposing` off the native event.

### Highlight, focus, and the ARIA question

**DOM focus never leaves the textarea** — the user must keep typing — so this control cannot use the
roving tabindex the way `ComposerOptionsMenu` does. Two consequences, both handled inside the shipped
prop surface:

- The highlight is `currentId`, not `focusedIndex`: the highlighted row is the panel's "current" row, so
  it wears `.composer-options__item--current` and `aria-current="true"` through the shipped branch.
- `focusedIndex` is passed as `-1`, the value the panel documents as marking no row, which keeps every
  row out of the tab order. Tab from the message box therefore still reaches the send button.

The panel stays `role="menu"` with `role="menuitem"` rows, named `SLASH_COMMAND_TYPE_AHEAD_LABEL`. It is
**not** promoted to a combobox/listbox: `aria-activedescendant` was rejected by #840 for a reason that
still holds (a generated unique id per row, four consumers on one screen), and `role="combobox"` on the
composer's textarea would change the semantics of a control ~15 shipped locators address. The honest
statement of the trade: for a screen-reader user the panel is discoverable but the highlight is not
announced, and the feature degrades to exactly today's behaviour — a command typed by hand still sends.
Naming it here rather than papering over it is what lets #934's drawing pick it up deliberately.

A plain `useEffect` scrolls the highlighted row into view (`block: 'nearest'`, through `panelRef` and the
row class, the shipped focus effect's idiom minus the `.focus()`), because with the cap in place the
highlight can otherwise move below the fold with nothing to move the scroll.

### Untrusted text

Every string on this path is workspace-authored and bounded-but-not-sanitized by the daemon. Discharged
here as: ordinary React text children only (no `innerHTML`, no `dangerouslySetInnerHTML`, never into an
attribute, a URL, a filename, a cache key or a lookup path), a hard `max-width` on the description, a
`nowrap` row that absorbs the measured `0x0a`, and **no logging anywhere in the module** — no diagnostic
at all, which is the store's own posture carried one hop.

The React `key` and the option `id` are **the row's index**, never `name`. That satisfies the store's
stated obligation, and it also removes a real failure: two rows can carry the same name (an alias match
or a hostile duplicate), which as a key is a React collision and as an id is an ambiguous `onSelect`. The
pick path resolves `rows[index]` and returns silently when the index addresses no row — no `!`, no cast.

## State + concurrency model

Three values, held as **one** `useState` cell keyed by the text they were decided for:

```ts
{ text, highlightedIndex, dismissed }
```

`slashCommandTypeAheadStateFor(held, text)` returns the held cell when `held.text === text` and a fresh
`{ text, highlightedIndex: 0, dismissed: false }` otherwise. Every reset is therefore a *derivation*, not
an effect: editing the box moves the highlight back to the first (best-ranked) row — the container's
answer to the ticket's "where focus lands after a narrowing" — and re-opens a panel Escape had closed.

`dismissed` exists because the row list cannot express closure: Escape must leave the typed text alone
(AC3) and completing an un-hinted command leaves the text still matching, so both close the panel by
writing `{ text: <the text as of that moment>, dismissed: true }`. On a pick that text is the *completed*
text, which is what stops the panel re-opening on top of its own completion while still re-opening the
moment the user types again.

No store writes: this container is read-only against `slashCommandListStore` (unidirectional, ADR 0006's
"ephemeral single-value screen-local state → `useState`"). No IPC, no `window.pyry`, no timers, no
promises, no async work at all — so there is no cancellation path to define. The two effects (the clamp's
resize listener, inherited with the extraction, and the scroll-into-view) both tear down through their
own cleanup on close and on unmount, and the composer's own `hidden` cover (#906) leaves the subtree
mounted, so nothing here outlives the screen.

Re-render surface: the hook subscribes to one conversation's menu through a narrow selector, so a frame
for another conversation is `Object.is`-true and wakes nothing. The rows array is rebuilt per render and
its identity is deliberately not a dependency of anything (#939's own instruction).

## Error handling

Nothing here can fail: no I/O, no parse, no bridge call. The three total-function properties that replace
error handling are (a) `rows[index]` returning `undefined` is a silent no-op rather than a throw,
(b) a `conversationId` of `null` yields `null` commands through the ordinary path, and (c) a malformed
frame never reaches the store at all — #936's fail-closed narrower rejects it inside `daemonConnection`'s
decode guard, which is what makes #939's `truncated_fields` reading sound in the first place. A second,
weaker check in the renderer would only invent a disagreement. Nothing is logged, including on the
never-taken branches.

## Testing strategy

**vitest (`node`, `renderToStaticMarkup`)** — `SlashCommandTypeAhead.test.tsx`:

- `slashCommandTypeAheadStateFor`: same text → the held cell by reference; changed text → highlight 0
  and `dismissed: false`; a dismissal keyed to the completed text survives that text.
- `slashCommandTypeAheadOptions`: `/name` with the hint appended only when non-empty; ids are indices;
  two rows sharing a name still get distinct ids.
- `SlashCommandTypeAheadPanel`: renders nothing for an empty row list (AC1's closed half); one row per
  command with name, hint and description as text; the highlighted row alone carries `aria-current`;
  every row carries `tabindex="-1"`; a hostile description (`<img src=x onerror=…>`, an embedded `0x0a`,
  non-ASCII) is escaped and appears in no attribute — the sibling panel spec's assertion shape, including
  its `not.toMatch(/\son[a-z]+="/i)` guard against a vacuous pass.
- The container smoke: a host component calling `useSlashCommandTypeAhead` with the store module
  `vi.mock`ed onto a per-file `createSlashCommandListStore()` instance (the singleton's server snapshot
  is captured at creation, so seeding the singleton would be invisible to a static render) — the panel
  renders for `/cl` and renders nothing for `hello`, which is the `entry?.commands ?? null` join proved
  end-to-end in the tier that can prove it.

**Playwright, fake tier** — `e2e/slash-command-type-ahead.spec.ts` (AC5), one launch, one continuous
drive, with `captureOutbound()` from `composer-actions.spec.ts` so "nothing was sent" is an assertion on
the decoded outbound rather than on the absence of a bubble: push a `slash_command_list` frame for
`SEEDED_ROW.id` via `daemon.pushFrame` + `encodeEnvelope` (the fake's `buildReplyFrames` answers only
outbound envelopes, so a pushed frame is the right seam for an unsolicited menu), type `/`, assert the
panel opens with every row, narrow it and assert the list shrinks, `ArrowDown` and assert the highlight
moved, `Enter` and assert the message box holds the completion **and** that `sent` is still empty, then
`Escape` on a re-opened panel and assert the typed text is untouched.

Not re-proved here: the clamp arithmetic (`composerOptionsPlacement.test.ts`), the clamp wiring
(`e2e/composer-options-clamp.spec.ts` — the extraction changes neither), the keyboard contract
(`composerOptionsKeyboard.test.ts`), and #939's filtering and completion rules.

## Open questions

1. **Does the panel need to close when the message box loses focus?** No acceptance criterion asks for
   it, and adding it introduces the classic mousedown-before-click ordering bug. Deliberately not built;
   Escape closes, and the panel only exists while the whole text is a bare slash fragment. Resolve by
   observation, not by speculation.
2. **Is 8 rows the right cap and 320px the right description bound?** Both are literals chosen to read
   well against the inherited overlay's 28px rhythm; #934 is the ticket that can replace them with
   measurements.
3. **The 4px between the panel's label inset and the message box's text inset** (§ anchor). Left as the
   shipped placement's consequence rather than corrected with a fork.

Each is answered in Phase B by leaving it as designed unless the implementation contradicts it; anything
that changes lands as a `## Revisions` entry in the same commit as the code.

## Sizing note

The size-S table's total-written-work line is 800; this ticket's own `Estimate:` says ~850, and the
written plan measures higher still — this document is itself ~430 lines, and the module, its vitest
spec, the Playwright drive and the four CSS rules put the honest total near 1,000. The overage is
declared rather than shaved, and it stands for the reason the ticket already recorded — the panel-surface half (the two-part row, the cap, the scroll, the width bound)
has exactly one consumer, the mount half, in this same ticket. Splitting them would put a slice's whole
deliverable inside its only sibling, which is the failure no resume can fix. The floor beats the ceiling,
so this ships whole. Every other line of the table holds: 3 production source files
(`SlashCommandTypeAhead.tsx`, `ComposerOptionsPanel.tsx`, `ConversationScreen.tsx`), 5 acceptance
criteria, 2 new exported types/components (`SlashCommandTypeAheadState`, `SlashCommandTypeAheadPanel`),
0 consumer call sites forced to change (the new option field is optional and the clamp extraction has one
existing caller), and no state machine.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — `ComposerOptionsPanelOption.label` becomes untrusted for the first
  time, and its own doc comment still reads as if it could not be.** Four shipped consumers pass
  client-owned constants; `slashCommandTypeAheadOptions` composes `label` from a workspace-authored
  `name` and `argument_hint`, and adds a `description` from the same tier. The boundary itself is
  explicit and single — every one of those strings reaches the DOM through exactly one expression, the
  text children of `ComposerOptionsPanel`'s row — but nothing tells the *next* consumer that. Phase B
  amends that interface's doc comment to say both fields may carry untrusted text and are rendered as
  inert text children only, so the next menu to add a field inherits the rule rather than rediscovering
  it. No type-level brand: this repo has none, and inventing one for two fields would be a mechanism
  nothing else on the path uses.
- **[Trust boundaries] No findings on identity.** The option `id` and the React `key` are the row's
  index — a client-generated value — so no workspace text reaches a key, a lookup path or a `findIndex`
  comparison. That is the store's stated obligation discharged, and it also closes the duplicate-name
  collision a name-keyed list would have.
- **[Injection / raw-markup sinks] No findings — by construction, and pinned by a test.** Every
  workspace string is a React text child; the module contains no `dangerouslySetInnerHTML`, no
  `innerHTML`, no attribute interpolation, no `href`/`src`, and it deliberately does **not** route the
  description through `assistant-markdown-renderer` (which exists in this screen's neighbourhood and
  would turn a description into links and markup). The panel spec's hostile-string assertions — the
  escaped `<img src=x onerror=…>` plus the `not.toMatch(/\son[a-z]+="/i)` guard against a vacuous pass —
  are carried over onto the described row.
- **[Rendered-vs-completed mismatch] No fix; it is why AC3 has two Enters.** The daemon does not
  sanitize `name`, so a name carrying `0x0a` renders as one line inside the row's inherited
  `white-space: nowrap` while `completeSlashCommand` copies it verbatim into the message box as a real
  newline — the drawn row and the resulting text can differ. This is not repaired here: `completeSlashCommand`
  is #939's settled contract and normalising a name would be normalisation nothing asked for on a field
  the daemon bounds without sanitizing. What contains it is the design already required — completion
  never sends, the operator sees the box's actual content, and a second, deliberate Enter is what sends
  it through the unchanged gate. Recorded so nobody later "simplifies" completion into sending.
- **[Denial of service / unbounded render] No findings — the bound is inherited and the ceiling is
  concrete.** Rows are rendered one DOM button each with no virtualisation, and the list is rebuilt on
  every keystroke that leaves the text a slash fragment. The count is bounded twice upstream: the
  daemon's own entry cap (reported back as `droppedCommands`), and `MAX_PLAINTEXT_BYTES` (65,519) capping
  the decrypted envelope before any parse — a minimal ~80-byte row puts the hard ceiling near 800 rows
  against 51 measured. No second render-side cap is added, for the store's stated reason: a second bound
  is a second bound to keep in agreement with the daemon's. The height cap and scroll mean a long list
  costs layout, not an unbounded panel.
- **[Tokens, secrets, credentials] Not applicable — no secret is reachable.** The module holds no token,
  touches no `safeStorage`, and reads one memory-only store that is forbidden from persisting (its
  header's rule, sharpened by #955's pairing-boundary clear). Nothing here writes web storage, so no
  workspace text outlives the pairing that published it.
- **[File / storage operations] Not applicable — no filesystem access.** Nothing on this path builds a
  path, a filename or a cache key, and the index-based id is what keeps `name` structurally incapable of
  becoming one.
- **[Inter-process / Electron attack surface] No findings — the surface is unchanged.** No new IPC
  channel, no `contextBridge` addition, no `window.pyry` dereference (not even at interaction time), no
  navigation, no `window.open`, no new window. This slice is renderer-local and reads state that already
  crossed the bridge through #937's typed arm; a renderer compromise gains nothing it did not already
  have.
- **[Cryptographic primitives] Not applicable — no randomness and no secret comparison.** The only
  comparison on the path is #939's `toLowerCase` fragment match, which decides what is displayed and
  guards nothing.
- **[Network & I/O] Not applicable — no socket, no request, no timeout to set.** There is no request half
  on this path and there must never be one (the bridge's rule): the daemon pushes the menu unsolicited,
  so a withheld frame is a permanent `null`, never a retry or a spin.
- **[Error messages, logs, telemetry] No findings, and the property must stay total.** The module emits
  no diagnostic at all — no `console.*`, no thrown error carrying a row, no "no menu for this
  conversation" note — because `0x0a` is the only sub-`0x20` byte measured across the capture's four
  string fields, so a logged description is a workspace author forging log records in a file readable by
  anything running as the user. The never-taken branches (`rows[index]` undefined, a null conversation
  id) return silently rather than logging.
- **[Concurrency] SHOULD FIX — the clamp extraction must preserve the listener lifecycle exactly.**
  Lifting `useComposerOptionsClamp` out of `ComposerOptionsMenu` moves a `resize` listener that is
  attached only while the panel is open and removed by the effect's cleanup on close **and** on unmount,
  with `[active]` as the sole dependency. Widening those deps (to `options`, whose identity churns per
  render) or dropping the cleanup would leak a listener per open. Phase B moves the body verbatim and
  changes only the closed-over refs; `e2e/composer-options-clamp.spec.ts` remains the detector, and it
  covers both hosts after the lift.
- **[Concurrency] No findings on the container itself.** No async work, no promise, no timer — so there
  is no cancellation path to define and no check-then-act gap across an `await`. The scroll effect's only
  side effect is a scroll, cleaned up by unmount.
- **[Threat model alignment] Hostile workspace addressed; hostile daemon and hostile relay inherited.**
  The workspace-authored tier is this slice's own threat and is answered above. A malformed frame never
  reaches the store — #936's fail-closed narrower rejects it inside `daemonConnection`'s decode guard, so
  no event is emitted — and the content-blind relay can drop or delay the menu, which this path already
  treats as the normal permanent `null` rather than an error. Token theft and process isolation are
  untouched: nothing here reaches a key, a socket or the main process.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Revisions

### 2026-09-02 — implementation

- **The module is `ComposerSlashCommandTypeAhead.tsx`, not `SlashCommandTypeAhead.tsx`.** The planned
  name differs from #939's shipped `slashCommandTypeAhead.ts` only by case, and this repo is developed on
  a case-insensitive filesystem: a resolver that reached for `.tsx` before `.ts` would answer
  `import … from './slashCommandTypeAhead'` with the new file itself. The `Composer*` prefix is also the
  cluster's own (`ComposerOptionsPanel.tsx`, `ComposerActionsMenu.tsx`). Every export keeps its planned
  name.
- **The container smoke seeds the store at CREATION, not through `setSlashCommandList`.** The plan said to
  mock the module onto a per-file instance and seed it; that half is right and the seed timing is not.
  Under a server render zustand answers `useStore` from `getServerSnapshot`, which it binds to the state
  captured when the store was created — so a seed written afterwards is invisible and every assertion runs
  against an empty map. Measured, not reasoned: the first version of that test failed exactly this way.
  The mock now passes the menu as `createSlashCommandListStore({ menus: … })`; only the
  `useSlashCommandListStore` binding is overridden, so `selectSlashCommandListFor` stays the real one and
  the join is still what is under test.
- **Open questions, resolved as designed.** Blur-closing was not built (no criterion, and it introduces the
  mousedown-before-click ordering bug); the 228px cap, the 320px description bound and the 4px label/text
  offset all stand as planned, and remain #934's to settle with a drawing.
- **One spec expectation was wrong, not the code.** The e2e drive first asserted that `/m` shows two rows;
  it shows three, because `compact` contains an `m` and #939 ranks contained matches into a second bucket
  behind the prefix ones. The spec now pins all three and their order, which turned a mistake into the
  proof that both buckets reach the panel.

### 2026-09-02 — #934's product decision, as three MUST FIX findings on PR #959

The plan above designed the row, the cap and the width bound against the ticket's written description,
because #934 had no drawing. It was decided instead, one minute after the PR opened, and the decision
differs from what shipped on all three points. **They are decisions, not review preferences**, and they
supersede the corresponding paragraphs of § *Extending the panel surface, additively* and § *The clamp is
lifted, not copied*; the quoted wording and the reading of its third point are now in § *Design source*.

- **No descriptions. `ComposerOptionsPanelOption` loses the `description` field entirely** rather than
  keeping it unused, and `ComposerOptionsPanel`'s row goes back to `{option.label}` as the button's sole
  child — byte-for-byte the surface the four footer consumers shipped with, so this ticket now leaves the
  shared view's markup unchanged. `slashCommandTypeAheadOptions` never reads `row.description`, which
  makes the guarantee structural rather than stylistic: the string reaches no markup, no attribute and no
  measurement, and of the four workspace-authored fields only `name` and `argument_hint` reach the DOM at
  all. § *Untrusted text* and the plan's security review are narrowed, not weakened — the two fields that
  do reach it are authored by the same party, and every measure there still applies to them. The two CSS
  rules for the two-part row are gone, and with them the 320px bound the row used to carry.
- **Ten rows, not eight** — `max-height: 280px`, which draws 284px tall. Two corrections the number itself
  hides, both measured rather than reasoned: `max-height` bounds the *content* box under this repo's
  absent `box-sizing` reset, so capping at 10 rows plus the panel's 2px bands left a 4px sliver of the
  eleventh row on screen; and a flex item's default `flex-shrink: 1` meant fifteen rows in a capped column
  **compressed to ~18px each instead of scrolling**, with `scrollHeight === clientHeight`. The rows now
  carry `flex-shrink: 0`. The shipped 8-row version had the second bug and no assertion that could see it.
- **The width bound is the window's, not a 320px description bound.** New arithmetic beside the shift, in
  the module that already owns this screen's placement: `COMPOSER_OPTIONS_WINDOW_MARGIN_PX` and
  `composerOptionsMaxWidthPx({ anchorLeft, windowWidth })`, a total function of the same measurements
  `composerOptionsShiftPx` reads minus the panel's own width — which it must be, since this is the bound
  the width is decided *by*. `useComposerOptionsClamp` writes it to `--composer-options-max-width` on the
  anchor, and **writes it before it measures the panel**: `offsetWidth` reads the laid-out width, so the
  old order would have fed the shift an unbounded width and pulled the panel left by an overflow the bound
  removes. Consumed only by `.composer__row .composer-options`, so the three footer menus inherit a
  property no rule of theirs reads — deliberate, because the same bound applied to the Actions panel would
  squash it at the artificial widths `e2e/composer-options-clamp.spec.ts` drives, and that spec is the
  shift's only detector.
- **A consequence, stated because § *The clamp is lifted, not copied* claimed the opposite.** That section
  argued the shift was "reachable arithmetic, not dead code" for this host, on the strength of a 320px
  description pushing the panel past the window. With the bound now window-relative the panel can never
  overflow, so **the shift is structurally 0 for the type-ahead** and the clamp is wired here because it is
  one shared effect and because it still catches the panel if that `max-width` declaration is ever dropped.
  AC4's "reusing the shipped clamp arithmetic" is met by the placement module, not by a non-zero shift.
- **The e2e drive gained the two assertions these decisions need, and both are non-vacuous by
  construction.** Ten filler rows (names free of `c`, `m` and `x`, so no existing count moves) put fifteen
  rows behind a bare `/` for the cap, and a 400-character command name — reachable, since the daemon bounds
  `name` without sanitizing it — makes the panel wide enough that the width bound actually binds, so the
  right-edge assertion is an equality against the measured `innerWidth` rather than a `<=` a short panel
  would satisfy for free. The descriptions are now proved absent instead of escaped: exact `toHaveText`
  on rows whose commands carry them, and a unit test that a hostile description reaches no sink at all.
