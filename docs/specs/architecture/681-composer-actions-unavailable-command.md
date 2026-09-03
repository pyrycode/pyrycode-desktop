# #681 — grey out a slash command the workspace does not have

An Actions entry whose command is absent from the conversation's published `slash_command_list` renders
unavailable and sends nothing when picked. Availability is decided from a **complete** list only: no frame,
a frame-level drop, or a row whose `name` or `aliases` was cut, all read as UNKNOWN and leave every entry
available.

## Files read

Codegraph was unavailable for this run — every `mcp__codegraph__*` call in this repo answers
`CodeGraph not initialized`, so the reading list below was built with Grep and Read instead. Noting the
gap per the brief's fallback clause.

- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` → `COMPOSER_ACTIONS`,
  `ComposerActionsMenu` — the three fixed entries this ticket gates, and the file's standing
  "STOP and say so on the issue before adding a prop to the shared panel" instruction. Considered raised
  (Technical Notes), so the panel may grow what this needs.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsPanelOption`,
  `ComposerOptionsPanel`, `ComposerOptionsMenu` — the shared surface, its roving tabindex, its single
  `select` funnel, and the load-bearing attribute ORDER note (nothing may be inserted between `className`
  and `aria-current`).
- `src/renderer/src/store/slashCommandListStore.ts` → `selectSlashCommandListFor`,
  `SlashCommandListEntry` — the read surface, and the `null` vs `commands: []` distinction AC2 turns on.
  Its header carries three obligations that bind here: held verbatim, `name` is not an identifier, nothing
  on this path is ever logged.
- `src/renderer/src/screens/conversation/slashCommandTypeAhead.ts` → `hasUnknownAliases` — the sibling's
  deliberate asymmetry (a cut `name` ignored), the `truncated_fields !== null` spelling, and the trap that
  spelling exists to avoid. **This ticket inverts the asymmetry**; see Design.
- `src/shared/wire/types.ts` → `WireSlashCommand` — `name` carries NO leading slash, `aliases` is a plain
  array whose `[]` is a COLLAPSE (absent and empty are the same wire value), `truncated_fields` is
  `string[] | null` and its element vocabulary is deliberately not narrowed.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelMenuModel`,
  `ComposerModelMenuView`, `ComposerModelMenu` — the pure-decision / pure-view / store-bound-container
  split this ticket copies, including the `useMemo`-stable selector for a nullable conversation id.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the composer footer mount row —
  `activeConversationId` is already in scope beside the `ComposerModelMenu` / `ComposerEffortMenu` mounts.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-options__item`,
  `.composer-options__item--current`, the `:hover` rule and its "do not reorder" note,
  `.composer__send:disabled`, `.workspace-picker__row:disabled`, `.composer-status__error-prefix` — the
  disabled convention (muted content + `not-allowed`, never an opacity literal) and the visually-hidden
  recipe.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.test.tsx`,
  `ComposerActionsMenu.test.tsx`, `ComposerModelMenu.test.tsx`, `ComposerEffortMenu.test.tsx`,
  `ComposerPermissionModeMenu.test.tsx`, `ComposerSlashCommandTypeAhead.test.tsx`,
  `ConversationScreen.test.tsx` → the whole-attribute-run assertions AC5 must not disturb. Seven files
  match `class="composer-options__item` as a literal run; two match it closed with `">`.
- `e2e/composer-actions.spec.ts` → the shipped open/pick/dismiss drive and its `captureOutbound` helper.
- `e2e/slash-command-type-ahead.spec.ts` → `slashCommandListFrame`, `daemon.pushFrame` — how a
  `slash_command_list` frame is pushed unsolicited through the fake tier.
- `docs/knowledge/features/slash-command-list-store.md`, `slash-command-list-wire-types.md`,
  `conversation-shell-composer-options-panel.md`, `conversation-shell-actions-menu-and-reader-cutover.md`
  → the family's prior lessons. The wire-types overview repeats the handoff comments' claim that the
  Actions menu's `reset` entry is an alias of `clear`; the ticket body corrects it (the shipped entry id is
  `/clear`, the command name). Alias matching stays required for AC3 and AC2, not to repair a bug.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The shared "Options overlay": a 6px-radius column of five identical `Option button` rows, each 12px
horizontal / 6px vertical padding, `M3/body/small` text in `schemes/primary` over a
`schemes/on-primary-fixed` fill on the marked row. **There is no disabled variant in the node** — five
identical instances and nothing else — so the unavailable row is drawn to the shipped in-repo convention
instead: muted content (`--color-on-surface-variant`, the `.composer__send:disabled` /
`.workspace-picker__row:disabled` treatment) plus `cursor: not-allowed`, and never a raw opacity literal.
The panel's own geometry, typography and current-row fill are already shipped and are not touched.

## Context

The Actions menu offers three fixed commands (`/clear`, `/compact`, `/knowledge-capture`) that claude only
accepts in some working directories. `/knowledge-capture` exists in the vault and in almost nothing else,
so the menu is wrong most of the time and the user learns about it from a synthetic "Unknown command"
reply. Everything upstream has landed: the daemon publishes `slash_command_list` per conversation, and
`selectSlashCommandListFor` holds it with the exact distinction this needs — `null` for "no frame has
arrived", an entry with `commands: []` for "claude published an empty menu".

This is the second consumer of that store and the first to make a **gating decision** from
workspace-authored text, which is why the ticket carries `security-sensitive`; see § Security review.

No ADR is warranted. The one cross-cutting decision — that the shared panel grows an optional per-row
`unavailable` marking rather than a fifth top-level prop — is recorded in the panel's own file, where its
four other consumers read.

## Design

Three pieces, in the pure-decision / pure-view / store-bound-container split `ComposerModelMenu` already
uses on the same footer row.

### 1. `composerActionAvailability.ts` (new, framework-free)

Co-located with the screen like `composerSend.ts` / `composerOptionsKeyboard.ts` /
`slashCommandTypeAhead.ts`, for the same reason all three give: nothing in this repo can click, so
everything the menu DECIDES has to be a total function of the store entry and the client's own entry list,
where a vitest spec can execute it as data.

```ts
/** Whether this entry proves ABSENCE — i.e. whether the published list is complete enough to conclude
 *  that a command it does not carry does not exist. */
export function slashCommandMenuProvesAbsence(entry: SlashCommandListEntry | null): boolean

/** `actions` with `unavailable: true` on each entry the entry proves absent. Returns `actions` BY
 *  REFERENCE when nothing is unavailable. */
export function markUnavailableActions(
  actions: readonly ComposerOptionsPanelOption[],
  entry: SlashCommandListEntry | null
): readonly ComposerOptionsPanelOption[]
```

**`slashCommandMenuProvesAbsence` is AC2, and it is the one rule that inverts the sibling module.**
`slashCommandTypeAhead.ts`'s `hasUnknownAliases` deliberately ignores a truncated `name`, because there a
cut name costs a free "Unknown command" reply while a cut alias hides a working command. Here BOTH cuts —
and a frame-level drop — point the same way: each can make a command that genuinely exists look absent,
and greying it out is the precise failure this ticket exists to prevent. So the condition is WIDER than
the helper it resembles, and it is written fresh rather than imported. Absence is provable only when all
four hold:

| Condition | Why it is unknown otherwise |
|---|---|
| `entry !== null` | no frame has arrived; delivery is best-effort at three named loss points |
| `entry.droppedCommands === 0` | rows were cut from the frame; a dropped row may be the one we asked about |
| no row's `truncated_fields` names `name` | a cut name cannot be compared |
| no row's `truncated_fields` names `aliases` | a cut alias list may have held the match |

`truncated_fields` is tested with an explicit `!== null` before `.includes`, never
`truncated_fields?.includes(…)` — the optional-chaining form is falsy for an ABSENT key for the same
reason it is falsy for `null`, which silently inverts the rule on a frame reached through a bare `as`.
The reading is sound because the frame came through #936's fail-closed narrower; spelling the null test
out is what keeps that dependency visible.

`commands: []` with `droppedCommands === 0` PROVES ABSENCE and greys all three rows. That is the correct
answer, not an edge case: it is claude's positive statement that it offers nothing here.

**`markUnavailableActions` is AC3.** An entry is present when the entry's id, with its leading `/`
stripped, equals a published row's `name` or any string in that row's `aliases`. Exact string equality —
no case fold, no trim, no normalisation (`publishedRowFor`'s posture; the type-ahead folds case only
because its own ticket asked for case-insensitive typing). All three entries go through the one rule;
`/clear` and `/compact` are not special-cased, and there is no per-command table.

The scan is a linear `Array.prototype.some` over the rows, deliberately **not** a `Set` or an index built
from `name` and `aliases`. That is the store header's obligation (b) carried one hop: workspace-authored
text keys no cache, no memo and no lookup path here either. Three entries against a measured 51 rows is a
cost nobody can perceive, and it makes the security property structural rather than reviewed.

### 2. `ComposerOptionsPanel.tsx` — the affordance

One **optional** field on the shared row type, so the four other consumers pass nothing and their markup
does not move (AC5):

```ts
export interface ComposerOptionsPanelOption {
  id: string
  label: string
  unavailable?: boolean   // #681, optional: absent === an ordinary row
}
```

A field on the option rather than a fifth top-level prop (a parallel `unavailableIds` array or set) for
two reasons: it is per-row information, so a second array would be a second thing to keep index-aligned
with `options`; and `ComposerOptionsMenu` already holds `options`, so the gate below needs no new prop
threading either.

Row rendering gains exactly three conditional things, and every one of them is ABSENT when
`unavailable` is:

- `composer-options__item--unavailable` appended to the class run, AFTER `--current`. The available-row
  runs stay byte-identical: `class="composer-options__item"` and
  `class="composer-options__item composer-options__item--current"`.
- `aria-disabled="true"`, placed AFTER `aria-current` — nothing may be inserted between `className` and
  `aria-current`, which the file states and seven test files depend on. `undefined` otherwise, so React
  omits the attribute entirely rather than emitting `aria-disabled="false"`.
- A visually-hidden `<span className="composer-options__unavailable-note">` carrying a **client-owned
  constant** appended to the row's accessible name (AC4).

**AC4 is hidden TEXT, never an `aria-label`.** An `aria-label` would be an ATTRIBUTE sink, which
CLAUDE.md's daemon-text ruling forbids outright — and this row's `label` is workspace-authored for the
type-ahead consumer, so putting the label plus a suffix into an attribute would put untrusted text there.
The `.composer-status__error-prefix` recipe (clip-path, not the legacy `clip: rect()`) is the shipped
precedent, and this is its third consumer. It stays a BEM element rather than being promoted to a global
utility: promoting it would mean editing two unrelated rules and their JSX, which is out-of-scope
refactoring. Recorded as an observation, not done here.

**Why ARIA and not the HTML `disabled` attribute.** `ComposerOptionsMenu` drives a roving tabindex and
moves real DOM focus onto the focused row; a `disabled` button is not focusable, so `rows[i].focus()`
would silently no-op and arrow navigation would appear stuck. Keeping the row focusable and gating
activation also leaves `composerOptionsKeyboard.ts` — shared by all five consumers — untouched.

### 3. `ComposerOptionsMenu` — ONE gate for both AC1 paths

The container already funnels both activation paths through a single `select`: the panel's `onClick` calls
the `onSelect` prop, which IS `select`, and the Enter arm of `handleKeyDown` calls `select` directly. So
the gate is one predicate in one place, and there is no second copy to drift:

```ts
const isUnavailable = (id: string): boolean =>
  options.some((option) => option.id === id && option.unavailable === true)
```

`select(id)` returns early when it answers true — nothing sent, and the panel deliberately stays OPEN with
focus where it was, which is what a disabled menu item does and what makes the e2e proof observable.

The bare `ComposerOptionsPanel` is deliberately left ungated: it is a pure view, and the decision belongs
to the container exactly as `currentId`'s MEANING does while its MARKING is the panel's. No shipped
consumer of the bare panel passes `unavailable` (the type-ahead never does), so no path is left open.

### 4. `ComposerActionsMenu.tsx` — view + container

`ComposerActionsMenuView({ menu, onCommand })` is the pure view: it calls `markUnavailableActions` and
renders `ComposerOptionsMenu`. `ComposerActionsMenu({ conversationId, onCommand })` is the store-bound
container — a `useMemo`-stable `selectSlashCommandListFor(conversationId)`, with a null id selecting
`null` through the same path (`ComposerModelMenu`'s idiom verbatim, including why the closure is
memoised).

`COMPOSER_ACTIONS` itself is NOT mutated and gains no field: the marking is derived per render.

### 5. `ConversationScreen.tsx` — one line

`<ComposerActionsMenu conversationId={activeConversationId} onCommand={sendText} />`. `activeConversationId`
is already in scope on that row and already subscribed, so the prop costs no new subscription.

### 6. `conversation.css`

```css
.composer-options__item--unavailable { color: …on-surface-variant; cursor: not-allowed; }
.composer-options__unavailable-note  { /* the visually-hidden recipe */ }
```

and the shipped hover rule gains `:not(.composer-options__item--unavailable)`, mirroring the in-repo
`.composer__send:hover:not(:disabled)` / `.workspace-picker__row:hover:not(:disabled)` convention. That
raises its specificity from (0,2,0) to (0,3,0), which strictly preserves the behaviour its comment pins —
hover still beats `--current` — while removing the fill from a row that cannot be picked. The comment is
amended in place so the "do not reorder" instruction stays true.

## State + concurrency model

No new store, no new async work, no new subscription, no IPC and no wire change. The container adds one
narrow-slice zustand read (`selectSlashCommandListFor(conversationId)`), whose re-render behaviour is
already settled by the store: a write for another conversation returns the SAME entry object, so
`Object.is` holds and this component does not re-render. Nothing here writes to any store. There is no
teardown to define because there is no effect, no timer and no listener; the store's own lifetime
(`clearAllSlashCommandLists` at the pairing boundary) is unchanged and untouched.

`markUnavailableActions` runs in the render body — a pure function over ≤ 3 entries and a bounded row
list — and returns the input array by reference when nothing is unavailable, so the common case allocates
nothing. Its array identity is deliberately not a contract: no effect may depend on it. The one place the
panel reads `options` outside render is `initialFocusedOptionIndex` on the closed→open transition, which
takes the live prop and is unaffected.

## Error handling

There is no failure mode to classify: every input is already-validated in-process state, the decision
functions are total, and nothing throws. What replaces error handling here is the UNKNOWN reading — four
distinct incomplete-list conditions all resolve to "available", so the failure the ticket exists to
prevent (greying out a command that works) cannot be reached by a degraded frame. A hostile or broken
frame can therefore only cost a row that stays offerable, which is today's behaviour.

`droppedCommands` is read as a number and compared to `0`; `0` is a value, never consulted for
truthiness, per the store's own note.

**Nothing on this path is logged**, not even a content-free count. The store header states that the
no-diagnostic property has to be total to be worth anything, and this consumer inherits it.

## Testing strategy

**vitest — `composerActionAvailability.test.ts` (the bulk of the proof, as data):**

- `slashCommandMenuProvesAbsence`: `null` → false; a complete entry → true; `droppedCommands > 0` → false;
  a row whose `truncated_fields` names `name` → false; one naming `aliases` → false; a row with
  `truncated_fields: null` alongside one naming an unrelated field → true; `commands: []` with
  `droppedCommands: 0` → true.
- `markUnavailableActions`: all three available under each of the four unknown cases; a name match; an
  ALIAS match (a row named `clear` with alias `reset` still makes `/clear` present via its name, so the
  alias arm is proven on a row where only the alias matches); the leading slash stripped exactly once; no
  case folding (`/Clear` against a published `clear` is absent); returns the input array by reference when
  nothing is unavailable; `COMPOSER_ACTIONS` is not mutated.
- The trap directly: a row carrying `truncated_fields: ['aliases']` whose visible fields would otherwise
  make a command absent leaves it available — the assertion that fails if `?.includes` is ever
  substituted for the explicit null test.

**vitest — `ComposerActionsMenu.test.tsx` (markup):** the shipped `COMPOSER_ACTIONS` assertions stay; the
existing render sites gain the new prop. Added: the panel fed a marked entry renders
`class="composer-options__item composer-options__item--unavailable"`, `aria-disabled="true"` and the
client-owned note; an unmarked list renders NONE of those three; and the note's text is a module constant
containing no workspace-authored input.

**vitest — `ComposerOptionsPanel.test.tsx` (AC5's guard):** the existing whole-attribute-run assertions are
the regression detector and are left alone; one added case renders the panel with a mixed available /
unavailable / current list and pins that the available rows' runs are byte-identical to today's.

**Playwright — `e2e/composer-actions-unavailable.spec.ts` (AC1's real proof):** the interaction the unit
tier structurally cannot reach. Launch the paired fake app, push a `slash_command_list` frame carrying
`clear` and `compact` but NOT `knowledge-capture` (`daemon.pushFrame`, the type-ahead spec's helper), open
the Actions menu, then:

- the unavailable row is `aria-disabled`, clicking it sends nothing and the panel stays open
  (`captureOutbound`'s `sent` array is the negative proof — a bubble-absence assertion alone would pass on
  a broken echo);
- arrowing onto it and pressing Enter also sends nothing, and the row is still reachable by arrow (the
  roving tabindex is not stuck);
- an AVAILABLE row in the same open panel still sends its command, so the gate is per-row rather than a
  dead menu.

Fakes over mocks throughout: the frame goes through the production encoder and the real decode / IPC /
store path, exactly as the sibling spec does. No live claude is needed.

## Open questions

1. **Should an unavailable row keep the `:focus-visible` outline?** Leaning yes — the row stays focusable
   by design, and hiding where focus is would be the actual accessibility regression. Resolve while
   writing the CSS; record under Revisions if it changes.
2. **Exact wording of the client-owned note.** It becomes part of the row's accessible name and therefore
   a load-bearing e2e locator once the spec matches it. Settle the string when the spec is written and
   mark it in the source with the SEND_LABEL-style warning the sibling constants carry.
3. **Does any shipped spec read a menu row's `textContent` in a way the appended note could disturb?**
   Checked: the note only renders on an unavailable row, no shipped spec drives one, and
   `e2e/composer-actions.spec.ts` pushes no `slash_command_list` frame at all, so its `toHaveText` list is
   unaffected. Re-verified against the full suite in Phase B before the PR.

## Sizing

Over the 800-line ceiling, deliberately and with no split — the refiner's `Estimate:` line (~1100 lines,
4 production files) is re-checked here against the written plan and stands. Every other line of the size
table holds: **4** production source files (`composerActionAvailability.ts`, `ComposerOptionsPanel.tsx`,
`ComposerActionsMenu.tsx`, one line of `ConversationScreen.tsx`) against 5; **1** new exported React
component (`ComposerActionsMenuView`) plus two exported functions against 5; **2** consumer call sites
(the mount and the menu's own spec) against 10; **5** acceptance criteria against 5; no state machine and
so no reject branches.

The only available cut is the panel's unavailable-row affordance, whose sole consumer is the Actions menu
in this same ticket. The sizing floor calls that lines inside a ticket rather than a ticket of its own,
and the floor outranks the ceiling: splitting would ship a dormant panel field with no gate that reddens.
Stated as an overage rather than acted on.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary is single and named. Workspace-authored text
  (`name`, the strings in `aliases`) enters this ticket's code at exactly one function,
  `markUnavailableActions`, which uses it for **string equality only**. It is not stored, not returned, not
  rendered, not keyed, not logged and not carried past that comparison; the only thing that survives is a
  boolean. `truncated_fields` and `droppedCommands` are read as a shape report, never as content. The
  frame's SHAPE was made trustworthy upstream by #936's fail-closed narrower and the store makes no second,
  weaker check — this consumer inherits that and adds none either, which is why the `truncated_fields`
  test is spelled `!== null && .includes(…)` rather than `?.includes(…)`: the optional-chaining form is
  falsy for an absent key exactly as it is for `null`, and would silently invert the rule if this type were
  ever reached through a bare `as`.
- **[Trust boundaries — the gate's DIRECTION]** No findings. The gate is one-way by construction: the
  published list can only ever cause `select` to RETURN EARLY. There is no branch anywhere in which a value
  from the frame becomes, alters or selects the text that is sent — the sent string is
  `options[i].id`, sourced from the client-owned `COMPOSER_ACTIONS`. So the worst a hostile or compromised
  workspace can do is grey a row out; it can neither send nor substitute anything the user did not pick,
  and the user can still type the command by hand in the message box, which this ticket does not touch.
- **[Trust boundaries]** SHOULD FIX — that property depends on `markUnavailableActions` PRESERVING each
  entry's `id` and `label` and adding only the boolean. An implementation that rebuilt the returned options
  from published rows would move a workspace string into the sent text. Phase B: spread the input option
  and set one field; pin it with a test asserting the marked array's `id` and `label` equal the input's.
- **[Tokens, secrets, credentials]** No findings — no token, key or credential is read, derived, compared
  or displayed on this path. No comparison here is against a secret, so `crypto.timingSafeEqual` is not the
  applicable primitive; the comparison is between two public strings and the timing of a menu render leaks
  nothing that the rendered menu does not already state.
- **[File / storage operations]** No findings, and the design decision that makes the category
  inapplicable is explicit: nothing is persisted, and nothing may be. `createSlashCommandListStore` takes
  no storage port, and the marking is recomputed per render rather than cached — no `localStorage`, no
  IndexedDB, no memo keyed by workspace text, and no cross-conversation carry (the only memo is the
  SELECTOR closure, keyed by `conversationId`). This matters more than it looks: a persisted or cached
  marking would survive `clearAllSlashCommandLists` at the pairing boundary and re-hydrate one workspace's
  verdict into the next pairing, with every in-memory assertion still green.
- **[Inter-process / Electron attack surface]** No findings — this ticket adds no IPC channel, no
  `contextBridge` surface, no `ipcMain` handler, no window, no protocol handler and no navigation. It reads
  a renderer store that an already-shipped event arm populates, and the transport, keys and sockets stay in
  the main process untouched.
- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no key material, no Noise
  code is added or altered. The design decision behind that: the frame's authenticity is already
  established by the Noise session before it reaches the decode slice, and re-deciding it here would be a
  second, weaker check.
- **[Network & I/O]** No findings on the wire (nothing is sent, no socket is opened, no bound is
  re-decided here — the frame is already capped by `MAX_PLAINTEXT_BYTES` before any parse). On the
  RESOURCE side, the hostile-input shape this family has already measured — a 400-byte name, a 1,145-byte
  description — costs nothing here: both decision functions are linear scans over a bounded row list with
  no regular expression applied to any wire string, so there is no backtracking surface, and the three
  client entries bound the outer loop at 3.
- **[Error messages, logs, telemetry]** No findings, and the category is closed rather than merely unused:
  there is deliberately NO diagnostic anywhere on this path, not even a content-free count of greyed rows.
  The store's header states that the never-logged property has to be total to be worth anything, and the
  measured reason binds here too — `0x0a` is the only sub-`0x20` byte across the capture's 51 entries'
  string fields, so the control character that actually occurs is the one that splits a log line. Nothing
  throws, so no error message can carry workspace text either.
- **[Concurrency]** No findings — no async work, no effect, no timer, no listener and no `await`, so there
  is no cancellation path to define and no check-then-act window across a suspension point. One race IS
  reachable and is accepted rather than unnoticed: a frame arriving between a render and a click can leave
  a row's marking one frame stale. Both directions are benign and both fail in the ticket's chosen
  direction — a newly-unavailable row picked in that frame sends a command claude answers with a zero-cost
  "Unknown command" (today's behaviour), and a newly-available row refused in that frame costs one more
  click. Neither is exploitable and neither warrants a lock.
- **[Threat model alignment]** No findings. **Malicious / compromised relay:** it is content-blind and
  cannot forge a frame inside the Noise session; dropping or delaying one yields `null` from the selector,
  which reads as UNKNOWN and leaves every entry available — degradation lands on today's behaviour, by
  design rather than by luck. **Hostile daemon or hostile workspace:** bounded to greying a row out, per
  the direction finding above. **Token theft / renderer compromise:** out of scope for this ticket in the
  strict sense that it adds no capability, no secret and no reachable sink to the renderer.
- **[Accessibility surface — the AC4 string]** No findings — the announced explanation is a module-level
  client-owned constant, and no workspace-authored string reaches it. It is hidden TEXT rather than an
  `aria-label` specifically because `aria-label` is an attribute, which CLAUDE.md's daemon-text ruling
  forbids for daemon text and which a future consumer with untrusted labels would then be tempted to
  compose into. SHOULD FIX for Phase B: state that constraint in the panel's own comment where the four
  other consumers read it, and assert in a test that the note is the constant.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04

## Revisions

### 2026-09-04 — implementation

**Open questions, resolved.**

1. **The `:focus-visible` outline is KEPT on an unavailable row**, as the plan leaned. The row stays
   focusable by design — that is the whole reason the ARIA disabled-item pattern was chosen over the HTML
   `disabled` attribute — so suppressing the outline would hide where focus sits and be the actual
   accessibility regression. Recorded in `conversation.css` beside the modifier rule.
2. **The note reads `(unavailable in this workspace)`**, a module constant
   (`COMPOSER_OPTIONS_UNAVAILABLE_NOTE`) exported from the panel and marked with the SEND_LABEL-style
   load-bearing-locator warning. `e2e/composer-actions-unavailable.spec.ts` matches it, and a unit test
   pins it as a literal so an edit that interpolated a published `name` into it would fail there.
3. **No shipped spec is disturbed.** Verified by running every panel consumer's spec plus
   `ConversationScreen.test.tsx` (450 tests) and `e2e/composer-actions.spec.ts` — all green, unchanged.
   The mechanism is that all three renderings are absent when `unavailable` is, and no shipped consumer
   passes the field.

**Design departures.**

- `slashCommandMenuProvesAbsence` is spelled as a **type predicate** (`entry is SlashCommandListEntry`)
  rather than the plain `boolean` the plan's contract sketch showed. It answers true only for a non-null
  entry, so the predicate is honest, and it is what lets `markUnavailableActions` narrow on that one call
  instead of carrying a second null test that would be dead at runtime and read as a real branch.
- **The e2e spec clicks the greyed row with `{ force: true }`.** Playwright's actionability check reads
  `aria-disabled="true"` as not-enabled and refuses an ordinary click. That refusal is corroboration that
  the marking lands where tooling looks, but it proves nothing about what the app does when clicked — and
  `aria-disabled` is advisory, so a real pointer does reach the row and React's `onClick` does fire.
  Forcing the click is what drives the path the gate guards; asserting the refusal instead would be a
  vacuous test. Recorded in the spec at the call.
