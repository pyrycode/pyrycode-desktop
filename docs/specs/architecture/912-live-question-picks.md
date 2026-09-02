# 912 — Live option rows and Other field, with picks that survive a chat switch

The slice that makes the question panel respond. #906 drew the frame, #907 drew the rows at rest, #911 landed
the per-question picks store with no consumer mounted. This wires the three together: the rows become real
native controls driven by that store, the Other field becomes controlled, and the picks outlive the chat
switch that remounts the whole conversation subtree. Continue and Cancel stay inert — sending is #853's.

## Files read

- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QuestionPanelView`,
  `QUESTION_OTHER_PLACEHOLDER_COPY` — the view this slice makes live. Its two chrome comments (the control's
  "presentational span, not an `<input type="radio">`" note and the Other field's "inert in #906's sense")
  are the two paragraphs this ticket overturns, and both still cite the abandoned #908.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerSlot` — the container half of the
  \#224 split, its inline-selector ruling (`useStore` compares the selector's RESULT, so no `useMemo` and no
  per-key memo table — a memo keyed on anything claude-authored would be the family's named failure), and its
  `conversationId === null` explicit test.
- `src/renderer/src/store/questionPicksStore.ts` → `QuestionSelection`, `QuestionPickEvent`,
  `selectQuestionSelection`, `useQuestionPicksStore`, `createQuestionPicksStore` — the store this reads and
  writes. Five arms are this slice's; `dismissed` and `reconnected` are the bridge's and must not be
  re-dispatched. The `init` seam's docblock names this ticket: seeding the singleton is invisible to
  `renderToStaticMarkup`, so a container test that needs seeded picks must `vi.mock` the module.
- `src/renderer/src/store/questionBridge.ts` → `subscribeQuestionBatches`, `useQuestionBridge` — proof the
  clearing half is already wired, over ONE subscription fanning out to both stores, picks-first. Nothing here
  needs extending.
- `src/renderer/src/store/questionBatches.ts` → `Question`, `QuestionOption` — no `id` by design, array
  position is the identity, `multiSelect` always present.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` → `PermissionModalView` — the props shape this
  view grows into: injected state plus NAMED callbacks, not a single `onEvent` union.
- `src/renderer/src/screens/conversation/conversation.css` → `.question-panel__control` and its `--radio` /
  `--checkbox` / `--other` modifiers, `.question-panel__option`, `.question-panel__other-field`,
  `.question-panel__other-input`, `.composer-status__error-prefix` — the resting treatment to extend, the
  row's `overflow: hidden` bound, and the repo's one visually-hidden recipe (`clip-path: inset(50%)`, kept a
  BEM element rather than promoted to a utility).
- `src/renderer/src/theme/PyryMark.tsx` → `PyryMark` — the house idiom for a vector: inline JSX `<svg>`, never
  a transcribed `https://www.figma.com/api/mcp/…` `<img src>`, because the renderer's CSP is `default-src
  'self'` with no `img-src` and no `data:`, so an external or data-URI asset fails closed.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `daemon.pushFrame`; `e2e/fixtures/
  conversationStateFake.ts` → `conversationStateFake` (default seed `seed-conversation`, FAB-minted rows
  `created-N`) — the two halves the new spec composes.
- `e2e/permission-modal-answer-paths.spec.ts` → its spec-local frame builders — the shape a `question_shown`
  builder copies; `e2e/conversation-switch-remount.spec.ts` → the two switch paths (FAB create, sidebar row
  click) and the composer draft as the remount observable.
- `docs/knowledge/features/conversation-shell-modals.md` § the question panel — #906/#907's folded lessons.
  Two matter here and are acted on below: read colours off the Figma *variables* (generated fallbacks print
  the light scheme), and the **known gap** that `.question-panel__other-input`'s `:focus-visible` ring is
  clipped on two edges by the row's `overflow: hidden`, deferred to this slice by name because it is where
  the field stops being chrome. The overview also parks an option-list scroll container here; that is not in
  this ticket's acceptance criteria and stays deferred (see Context).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6015

The checked treatment is a `Selector` child centred inside the same 20×20 control the resting row already
draws — the design context on all four instances confirms one shape per variant, differing only in the
instance's `y`. `Radio` (347:6141 / 347:6478) centres a filled `Schemes/Tertiary` circle inside the ring's
3px padding, which lands a 10×10 dot inset 5px from the outer edge. `Checkbox` (347:6211 / 347:6773) centres
a 12×12 `Selector` holding a 10×9 tick `Vector`, inset 4px, whose exported fill and stroke are both `#FFB59F`
— exactly this repo's `--color-tertiary`, confirming the ring and the selector read the same variable. So the
resting border, the radio dot and the tick are one token, and no new token is minted.

## Context

`QuestionPanel.tsx` ships two deliberately inert controls: a childless presentational `<span>` per row and a
real but uncontrolled Other `<input>` nothing reads. #907 chose that resting posture precisely because a
native control at rest is focusable *and* checkable, so a click would paint a selection no store holds. This
slice supplies the store that makes a native control honest, so the span becomes a real
`<input type="radio">` / `type="checkbox"` and the Other field becomes controlled.

The survival half is the consequence of #670's keying: `PairedShell` keys `ConversationScreen` on the active
pane, so a chat switch remounts the conversation subtree and destroys every `useState` inside it. #911 put
the picks outside that pane for exactly this reason; this slice is where the arrangement gets driven end to
end. The same drive folds in #906's outstanding draft-survival proof — that the covered composer's own
`useState` draft survives the panel appearing over it — which was proved structurally (the subtree stays
mounted) but never driven, because nothing in this repo can click.

**No ADR is warranted.** Every architectural decision this slice depends on is already recorded: ADR 0009's
renderer-store discipline, #224's pure-view/container split, #670's pane keying, and #911's own spec for the
pick semantics. What this adds is wiring.

**Deferred, deliberately.** The option list still has no scroll container and no per-question row cap, so a
hostile daemon sending many long options can grow the panel and squeeze that conversation's timeline. #907's
overview parks that bound "with #908"; #908 was split into #911 and this ticket and neither inherits it as an
acceptance criterion. It stays out of scope here — the wrap is the locked design, the total is still bounded
by the transport's frame cap, and the exposure is scoped to one conversation's composer. The Other
placeholder's sub-AA contrast stays deferred too: the colour is read correctly off the Figma variable and
inventing a brighter one is a fidelity violation, not a fix.

## Design

### The pure view grows state and three callbacks

`QuestionPanelView` keeps the #224 posture — markup in, props out, a pure function of its props so both
render states stay provable as static server renders. Following `PermissionModalView`'s precedent it takes
injected state plus NAMED callbacks rather than one `onEvent` union:

```
QuestionPanelView({ question, selection, onOptionChosen, onOtherChosen, onOtherTextChanged })
  question: Question
  selection: QuestionSelection
  onOptionChosen: (optionIndex: number) => void
  onOtherChosen: () => void
  onOtherTextChanged: (text: string) => void
```

**The two chosen-callbacks are variant-neutral by design.** Single-select replace and multi-select accumulate
are one gesture from the view's side; which store arm that becomes is the container's decision, so the view
holds no branch that could be transposed. `questionIndex` is not a prop at all — the container closes over
it, so the view has no index to get wrong.

### Row markup: a native control inside an implicit label

Each option row becomes a `<label className="question-panel__option">` holding, in order:

1. A visually-hidden native `<input>` — `type` is `checkbox` when `question.multiSelect`, else `radio`;
   `name` a client-owned constant so the radios form one group and arrow keys work; `checked` driven by
   `selection.optionIndices.includes(index)`; `onChange` calling `onOptionChosen(index)`. Controlled, so the
   resting-posture hazard #907 named cannot occur: the DOM's checked state is the store's, always.
2. The existing `.question-panel__control` `<span>`, now `aria-hidden` chrome, carrying the selector child
   when picked and nothing when not — the child #907 deliberately withheld.
3. The unchanged `.question-panel__option-text` stack.

**The implicit label is what supplies the accessible name**, from the row's own visible text. That keeps
claude-authored text on the same JSX-children path it is already on: no `aria-label`, no `aria-labelledby`,
no `id`, so nothing claude wrote reaches an attribute. It also makes the whole row a click target, which is
what the design draws.

**The Other row cannot be one label, and that asymmetry is load-bearing.** A `<label>` binds to its FIRST
labelable descendant, so wrapping the Other row whole would make every click into the free-text field toggle
the tick. Instead the row stays a `<div>` and only the control is wrapped in its own
`.question-panel__other-control` label; that label has no text, so the tick's accessible name comes from an
`aria-label` set to a new client-owned constant. The free-text `<input>` becomes controlled on
`selection.otherText` with `onChange` → `onOtherTextChanged`, keeping its existing client-owned placeholder
and `aria-label`.

### The arm mapping is one place, and it is unit-tested

`optionPickEventFor` and `otherPickEventFor` are pure exported functions taking a single object
`{ multiSelect, questionBatchId, questionIndex, optionIndex? }` and returning the `QuestionPickEvent`. The
object parameter is deliberate: a positional `boolean` beside two `number`s is the exact boolean-blindness the
store's own event union was shaped to avoid.

They live in `QuestionPanel.tsx` beside the view they serve rather than in a new pure module (the
`modalResolution.ts` family's shape), because the mapping is six lines and this ticket is already at its size
ceiling. They are exported solely so `QuestionPanel.test.tsx` can assert the `type` literal directly —
`optionPicked` and `optionToggled` carry identical payloads and differ only in that literal, so a transposed
arm compiles clean and is invisible to `tsc`. A unit test on the literal turns that into a caught error at
the mapping; the Playwright spec proves the consequence in both variants.

### The container: a leaf that exists only while a panel is up

`ComposerSlot` keeps its batch read and gains nothing. A new `QuestionPanelSlot({ batch })` — mounted only on
the `batch &&` branch — owns the picks read and the handlers:

- reads `useQuestionPicksStore(selectQuestionSelection(batch.questionBatchId, FIRST_QUESTION_INDEX))`, called
  inline with no `useMemo` on the store's own explicit ruling;
- dispatches through `questionPicksStore.getState().dispatch`, mapping each callback through the two pure
  functions above with `batch.questions[FIRST_QUESTION_INDEX].multiSelect`;
- renders `QuestionPanelView`.

A sub-container rather than a `?? ''` sentinel in `ComposerSlot`: hooks cannot be conditional, so reading the
picks store in `ComposerSlot` would subscribe the composer to pick traffic and need a sentinel batch id. A
leaf that only exists while a panel is up needs neither, and keeps a pick re-rendering the panel alone.

`FIRST_QUESTION_INDEX = 0` is a named constant, not a bare `0`, because it is the same index in two places
(the question read and the pick key) and stepping through a batch is #907's deferred work.

### CSS

Additive; no existing declaration changes except two, both named:

- `.question-panel__input` — the visually-hidden recipe copied from `.composer-status__error-prefix`.
- `.question-panel__control` gains `display: flex; align-items: center; justify-content: center` so the
  selector child centres. The Figma frame's own `items-center justify-center`.
- `.question-panel__control-dot` — 10×10, `--radius-full`, `background: var(--color-tertiary)`.
- `.question-panel__control-tick` — 12×12, `color: var(--color-tertiary)`; the inline `<svg>` fills and
  strokes with `currentColor`.
- `.question-panel__other-control` — `display: flex; flex: 0 0 auto`, so the tick's label does not stretch.
- `.question-panel__option` gains `cursor: pointer` (it is now a click target).
- `.question-panel__option:has(.question-panel__input:focus-visible)` carries the focus ring. **On the row,
  not the control**, because the row's own `overflow: hidden` clips a descendant's outline but never its own,
  and the control sits flush at the row's left content edge. This introduces `:has()` to the codebase; the
  one place it was previously rejected (`.bubble__markdown`'s list rhythm) rejected it for protecting a
  distinction that container flattens by intent, not as a ban, and the renderer is one known Chromium.
- `.question-panel__other-input:focus-visible` gains `outline-offset: -1px` — the fix for the clipped-ring
  gap #907 deferred here by name.

### The tick vector

A module-private `QuestionTick` in `QuestionPanel.tsx`: an inline `<svg viewBox="0 0 12 12">` carrying the
Figma export's path verbatim with `fill`/`stroke` as `currentColor`. Inline JSX per `PyryMark`'s recorded
rule — the CSP is `default-src 'self'`, so a Figma asset URL and a `data:` background both fail closed. Not
promoted to `theme/`: one call site, and `PyryMark`'s own comment says promote on the second.

## State + concurrency model

No new store, no store API change — #911's surface is complete. Two stores are read on the panel's path
(`questionBatchStore` for the batch in `ComposerSlot`, `questionPicksStore` for the selection in
`QuestionPanelSlot`), each through a narrow selector so a pick wakes only the panel.

No async task, no timer, no subscription, no teardown: every write is a synchronous `dispatch` from a React
event handler. The clearing arms (`dismissed`, `reconnected`) are already driven by `questionBridge` over its
single daemon-event subscription, and this slice must not re-dispatch either — there is no local dismissal
and no optimistic path, because the daemon's `dismissed` is the only way a batch leaves the held set.

Re-entrancy: zustand notifies synchronously inside `setState`, so a subscriber that dispatched during a
notify would recurse. Nothing here does — the panel reads and dispatches from user events only.

## Error handling

No new failure mode. No I/O, no IPC, no parsing, no async, so no result type and nothing to surface. The
store's own deterministic non-throwing posture covers the degenerate reads: an unknown batch id or question
position is a legitimate query answering with the shared empty selection, and a same-value dispatch returns
the state reference unchanged so no subscriber wakes.

The one case worth naming is a batch swapped underneath a live panel — a `dismissed` immediately followed by
a fresh `question_shown` for the same conversation. `QuestionPanelSlot` keys its read on
`batch.questionBatchId`, a one-time nonce, so the new batch reads a fresh empty selection with no clearing
effect to get wrong and no stale pick reachable. That is AC4's second half.

## Testing strategy

**vitest — `QuestionPanel.test.tsx`** (static server renders, injected props; the view is a pure function of
its props, so no store and no mock is needed):

- a picked option draws the dot in its own row and nowhere else; no other row does.
- the multi variant draws a tick per ticked index, several at once, and none for the rest.
- an empty selection draws no selector child anywhere — AC4's first half, replacing #907's now-superseded
  "every control empty at rest" case rather than leaving it stale.
- the Other row: ticked draws the variant's selector; `otherText` reaches the field's `value`; a ticked Other
  renders alongside ticked option labels in the multi variant — AC2.
- the escaping and no-claude-text-in-an-attribute cases extended to the new markup: the sentinels still
  appear exactly once each, and the accessible name of a row comes from its text rather than an attribute.
- `optionPickEventFor` / `otherPickEventFor` return the arm each variant wants — the transposition guard.
- #907's `not.toContain('value=')` and its childless-control regex are DELIBERATELY REWRITTEN, not deleted:
  both asserted the inert posture this slice overturns.

**vitest — `composerSlot.test.tsx`**: one added case proving the container reads the picks store under
`batch.questionBatchId` (using `conversationId` would compile clean). Needs the `vi.mock` seam #911's
docblock documents — a per-file `createQuestionPicksStore()` bound over `useQuestionPicksStore`, spreading
`importActual` so the selector stays real.

**Playwright — `e2e/question-picks.spec.ts`** (new; nothing in `e2e/` drives a question yet). One
`launchPairedApp` over `conversationStateFake`, batches pushed with `daemon.pushFrame` the way
`permission-modal-answer-paths.spec.ts` pushes `modal_shown`. Two arcs in one test, sequenced so the
dismissal that clears the picks never lands mid-assertion:

1. *Single-select and the switch.* Push a single-select batch for the seeded conversation. Assert nothing is
   checked (AC4). Pick a row → checked, and the dot is drawn. Pick a second → the first clears, so exactly
   one is checked (AC1, replace). Type Other text (AC2). Mint a second conversation with the FAB → the
   panel is gone and that chat shows its own normal composer; click back to the seeded row → the pick and the
   typed text are both still there (AC3). Dismiss the batch.
2. *Multi-select and the draft.* Type a draft into the now-visible message box. Push a multi-select batch for
   the same conversation → every row clear (AC4's fresh-batch half). Tick two rows → both checked; un-tick
   one → the other survives (AC1, accumulate — the arm-transposition proof the single arc cannot give). Tick
   Other → it sits checked beside a checked option label (AC2). Dismiss → the draft is still in the message
   box (AC5, #906's folded-in proof).

State is read through `toBeChecked()` on the real controls and through the selector child's count for the
drawn treatment, so the two are asserted together rather than one standing for the other. Secret hygiene
follows the siblings: every assertion reads roles, counts and DOM values; the batch nonce is a spec-local
routing literal and never asserted on or logged.

## Open questions

1. Does `overflow: hidden` on `.question-panel__option` clip a `:has()`-driven outline on the row itself?
   Expected no — `overflow` clips descendants, not the element's own outline — to be confirmed against the
   built renderer before the CSS lands.
2. Does the Other row's `aria-label` need to differ from the field's `QUESTION_OTHER_PLACEHOLDER_COPY`?
   Planned yes, a separate shorter constant, since the tick and the field are two controls; to settle while
   writing the markup.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and this is the category the slice actually moves. The panel's boundary is
  unchanged in kind: all four claude-authored strings (`question.question`, `question.header`, every option's
  `label` and `description`) remain React CHILDREN and reach no attribute, URL, filename, cache key, lookup
  path or log. The slice adds a second, opposite-direction flow — operator-typed text — and it is bound into
  a controlled `<input value={…}>`, React's own escaping, never a raw-markup sink. **The one new sink this
  markup could have opened is the accessible name**, and it is closed by construction: the row is an implicit
  `<label>` so the name comes from the row's own visible text rather than an `aria-label={option.label}` or an
  `aria-labelledby` needing a generated `id`. Both of those would have put claude's string in an attribute,
  and `aria-labelledby` would additionally have made a claude-adjacent value a DOM lookup key. Every attribute
  this slice writes is a client-owned constant or a number derived from array position.
- [Trust boundaries, second] No findings — a pick is an array POSITION, never a label. The store's own type
  makes that structural (`optionIndices: readonly number[]`), and the handler closes over the map index, so
  there is no path by which a claude-authored string becomes an identity here. `questionBatchId` is used as a
  `Map` key inside the store and, in this slice, only as an argument to `selectQuestionSelection` — never
  rendered, never an attribute, never logged.
- [Tokens, secrets, credentials] No findings — no token, key or credential is read, stored or compared.
  `questionBatchId` is a one-time nonce, and the two values that must never be logged (`questionBatchId` and
  `otherText`, whatever the operator typed) both stay out of every diagnostic: this slice adds no logger
  import, no `console.*` and no `observe?` seam, matching the refusal every module in this family records.
  The e2e spec's failure diagnostics read roles, counts and DOM values only.
- [File / storage operations] No findings — nothing is persisted, deliberately. The picks store ships no
  `localStorage` port (unlike `conversationLastReadStore`) precisely because persisting would write live
  nonces and operator text into a hand-editable blob, and this slice adds no persistence of its own. No path
  is constructed, no file read or written.
- [Inter-process / Electron attack surface] No findings — no new IPC channel, no `contextBridge` addition, no
  `window.pyry` dereference anywhere in this slice (not even inside an effect; the panel only reads stores
  and dispatches). No window, navigation or protocol handler is touched. **No remote content is loaded**: the
  tick is inline JSX `<svg>` rather than the Figma `<img src="https://www.figma.com/api/mcp/…">` the design
  context generated, and rather than a `data:` background — both would fail closed against the renderer's
  `default-src 'self'` CSP, and the first would be an outbound third-party fetch from the privileged window
  that holds the transport bridge.
- [Cryptographic primitives] Not applicable — no randomness, no hashing, no key material, no comparison
  against a secret. The only equality in the slice is `optionIndices.includes(index)` on two client-held
  numbers, a rendering decision rather than an authorisation one, so plain `===` semantics are correct and
  `timingSafeEqual` would be theatre.
- [Network & I/O] Not applicable — the slice adds no socket, no request, no timeout and no reconnect path.
  It renders state a shipped, fail-closed decode path already put in the store.
- [Error messages, logs, telemetry] No findings — this slice raises no error and surfaces none. It adds no
  `Error` construction, so there is no message to interpolate a nonce or operator text into; the store's own
  `assertNever` is already content-free for that reason and is untouched.
- [Concurrency] No findings — no async task, no timer, no subscription, no listener, so nothing to cancel
  and no teardown to leak. Every write is a synchronous dispatch from a React event handler, and the store's
  `dispatch` has no suspension point, so its same-value check-then-act cannot interleave. The one shared-state
  race worth naming is a `dismissed` arriving between a pick and a re-render; it resolves safely because the
  bridge dispatches picks-first, so the intermediate state is "batch held, picks cleared" — indistinguishable
  from untouched — and never "batch gone, picks held".
- [Threat model alignment] Hostile-daemon exposure is unchanged in kind and **one degree worse in one
  respect, named rather than defended**: the option list still has no scroll container or row cap, so a
  daemon sending many long options grows the panel, and this slice makes each of those rows a focusable
  control, lengthening the tab order along with the panel. Both remain bounded by the transport's frame cap
  and scoped to one conversation's composer, both are annoyance rather than escalation, and neither is in
  this ticket's acceptance criteria — the bound was parked with the (now-split) #908 and stays deferred, per
  Context. A malicious relay is content-blind and on-path only, so it can withhold a batch or its dismissal
  but cannot reach this state; a withheld dismissal covers one conversation's composer indefinitely, which is
  #906's recorded, still-accepted exposure and unchanged here. Renderer compromise reaching the transport is
  stopped by the existing process split, which this slice does not touch.
- [Threat model, fail-closed reading] No findings — this slice never reads `dismissed.source` or `outcome`
  and never infers an answer from a dismissal. It cannot get the fail-closed rule backwards because it does
  not consult the field: the picks store clears on ANY dismissal regardless of cause, and the mapping that
  drops `source` and `outcome` is #911's, already landed and unmodified here.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
