# 988 — the model menu in the input footer

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` | `ComposerActionsMenu`, `CHEVRON_PATH`, `COMPOSER_ACTIONS_LABEL` | The file-shape precedent this ticket follows, and the source of the trigger's chevron geometry and its `aria-hidden` reasoning. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` | `ComposerOptionsMenu`, `ComposerOptionsPanel`, `ComposerOptionsPanelOption` | The shared surface: trigger `<button>`, `aria-haspopup`, `aria-expanded`, roving focus, `aria-current`, `.composer-options-anchor`. No prop may be added to it. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx` | `publishedRowFor`, `ModelSection`, `EffortSection`, `RunConfigSections` | The match rule to export and reuse, the operable-vs-inert row idiom AC4's arm copies, and the container recipe (four store reads, `useMemo`-stable model selector, `onChange` built at interaction time). |
| `src/renderer/src/store/modelListStore.ts` | `selectModelListFor`, `ModelListEntry`, `useModelListStore`, `createModelListStore` | The rows and the three readings (`null` / empty / populated); its header states the security tier for `display_name` and `value`, and the `vi.mock` recipe renderer specs need. |
| `src/renderer/src/store/runSettingsWriteStore.ts` | `selectEffectiveSettings`, `SettingsChange`, `useRunSettingsWriteStore` | The displayed value (pending overlay > confirmed > snapshot base) and the single-field write shape. `selectEffectiveSettings(null, initial)` resolves `model` to `''` — the source of this plan's third rendering. |
| `src/renderer/src/screens/conversation/runSettingsControls.ts` | `changeSetting`, `isAddressableSessionId` | The write path and its deterministic no-addressable-session gate, which is how AC3's "sends nothing" is met without a structural gate here. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `Composer`, `ContextUsageControl`, `TOOL_ROW_CHEVRON_PATH` | The mount point and its two stale comments; the store-bound footer control precedent; the second module-private glyph const proving glyphs stay at their use site. |
| `src/renderer/src/screens/conversation/conversation.css` | `.composer__footer`, `.composer__actions`, `.composer__actions-icon`, `.composer__context`, `.button-small`, `.composer-options-anchor` | The row's geometry, the rule the extraction lifts from, and `.button-small` as the house shape for a shared-treatment lift on its second consumer. |
| `src/renderer/src/screens/conversation/runConfigLive.ts` | `RunConfigLiveData` | Proves the run-config snapshot exists app-wide without the sheet ever opening — the footer's model value is live for the same reason the context reading is. |
| `e2e/run-config-settings.spec.ts` | `modelListFrame`, `capturingRunConfigFake`, `MODEL_ROWS` | The template for pushing an unsolicited `model_list` and capturing `set_session_settings`. |
| `e2e/composer-actions.spec.ts` | `actionsTrigger`, `actionsPanel` | The open-and-pick drive this spec mirrors; also the reason this trigger cannot copy its locator strategy. |
| `e2e/composer-options-clamp.spec.ts` | the `.composer-options-anchor` locator | Anchor site (a): a bare class locator that this ticket makes conditional on the app's state. |
| `docs/knowledge/features/conversation-shell-composer.md` § "Composer footer row (#811)" | — | The row's no-placeholder rule and the item rhythm this trigger inherits. |
| `docs/knowledge/features/conversation-shell-composer-options-panel.md` | — | The panel's shipped contract and the "no vitest detector exists for stylesheet declarations" ruling, which is why the CSS extraction is proven by markup assertions plus review, not by a unit test. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683

The third `Input footer button` instance in the footer row (`115:3660`), at x=135: a 4px-gap centred flex row holding one M3 body/small label at `schemes/primary` (drawn `Opus `, illustrative only — the real label is the daemon's published display name) followed by the 8×4 `chevron-up-solid-full` glyph. Structurally identical to the Actions instance at x=0 that `.composer__actions` already draws, which is what makes the shared-treatment extraction below the right move rather than a second copy. The opened panel is #838's `121:3879` and is not redrawn here.

## Context

The footer's second live control. Everything under it is built: the shared panel (#838/#839/#840), the published rows (#974), the single-field write (#256) and the match rule (#560/#975/#976). This slice adds the entries, the trigger's label and what picking one does — and pays two one-time family costs that land on whichever footer menu goes second: the `.composer__footer-button` extraction the stylesheet's own comment assigns to it, and the correction of three sites resting on "exactly one `.composer-options-anchor` exists".

No ADR is warranted: every decision here is an application of a rule already recorded elsewhere in the repo.

### Size: over the line ceiling by ~200, shipped as one ticket

Total written work lands near ~1000 lines against the 800 boundary. Every other line of the S table holds: 4 production files (≤5), 1 new exported component (≤5), 1 call site (≤10), 4 acceptance criteria (≤5), 3 renderings (≤10). The only split that would clear the ceiling — a trigger without a menu, then the menu — halves a single control into a slice whose sole consumer is its sibling, which the floor rule forbids more strongly than the ceiling forbids the overage. Split depth is also already one (parent #683, no grandparent). Overage stated, ticket built.

## Design

### `ComposerModelMenu.tsx` (new)

A container/pure-view split, as both precedents use (`RunConfigView`/`RunConfigSections`, `ComposerOptionsPanel`/`ComposerOptionsMenu`), so the markup stays a pure function of props under `renderToStaticMarkup`.

```ts
// The panel's accessible name. Client-owned and NOT the trigger's visible text, unlike
// COMPOSER_ACTIONS_LABEL — this trigger's text is claude-authored, and aria-label is an attribute.
export const COMPOSER_MODEL_MENU_LABEL = 'Model'

export function ComposerModelMenuView(props: {
  model: string                              // the session's EFFECTIVE model (composed by the container)
  models: ModelListEntry | null              // selectModelListFor's three readings, unchanged
  onSelect: (value: string) => void          // required — "a view that cannot answer is a bug"
}): JSX.Element | null

export function ComposerModelMenu(props: { conversationId: string | null }): JSX.Element | null
```

**THREE RENDERINGS.**

| Input | Rendering |
|---|---|
| `model === ''` (no snapshot yet, or a session on the inherited default) | `null` — nothing in the row |
| `model !== ''`, `models === null` or `models.models.length === 0` | an inert `<span>` carrying the label, no chevron, no role, no tabindex, no handler |
| `model !== ''` and rows present | `ComposerOptionsMenu` with the rows as options |

The first is not in the ACs and is this plan's decision, taken because it is otherwise reachable in the app's ordinary startup window: the snapshot arrives on the `connected` edge through `RunConfigLiveData`, so before that reply the effective model is `''` and every other rendering would draw an empty gap where a label belongs. `ContextUsageControl` takes exactly this posture for its own unavailable reading, and #811's no-placeholder rule points the same way. It is not a fourth *state* — `''` is the daemon's own held-verbatim "inherited default", and rendering nothing is the only reading that does not invent a name for it.

The second is AC4, and it cannot be `options={[]}`: `ComposerOptionsMenu` renders `aria-haspopup="menu"` and `aria-expanded` unconditionally and would open an empty panel. The chevron is omitted from this arm deliberately — the up chevron is the design's "this opens a panel" mark, and drawing it on an element that opens nothing is the visual half of exactly the claim AC4 refuses.

**The label.** `publishedRowFor(models, model)` → `row ? row.display_name : model`, mirroring `RunningModelSection`'s expression exactly rather than `row?.display_name ?? model`, which would treat a matched row's empty `display_name` as a miss. Exact equality on `value`, through the one exported home for that rule. The input is the SESSION's model — `EffortSection`'s input, not `RunningModelSection`'s.

**The options.** `entry.models.map((row) => ({ id: row.value, label: row.display_name }))`, in the daemon's order, nothing deduped, dropped, reordered or synthesised. Built inside the view from props, so it is a fresh array per render — which the panel's clamp effect explicitly tolerates (`useComposerOptionsClamp`'s deps are `[active]` and `options` is deliberately absent).

**The marking.** `currentId={row ? row.value : null}` — the value AC1 matched, not the raw `model`. A miss marks nothing through the panel's existing no-special-case branch. Two rows sharing a `value` both wear `aria-current`; accepted, per the ticket, since AC2's "exactly the published rows" outranks a tidier list.

**The container.** `RunConfigSections`' recipe minus the announced model:

- `useSessionIdStore(selectSessionId)`, `useRunConfigStore(selectSnapshot)`, `useRunSettingsWriteStore((s) => s)` (the RAW state — `selectEffectiveSettings` returns a fresh object and must never be the zustand selector), and `useModelListStore` with a `useMemo`-stable `selectModelListFor(conversationId)` closure.
- `selectEffectiveSettings(snapshot, writeState)` composed in the render body.
- `onSelect` is an arrow that dereferences `window.pyry.sendCommand` at interaction time only, calling `changeSetting({ sessionId, sendCommand, dispatch }, { field: 'model', value })`.

**AC3's "sends nothing when there is no addressable session id" is met by `changeSetting`'s own gate, not by withholding the handler.** That differs from the sheet on purpose: the sheet withholds `onChange` because its view branches *operability* on handler presence, whereas this view branches operability on the ROWS (AC4). Withholding the handler here would fuse two unrelated conditions into one rendering and make a session-less-but-populated menu unopenable, which no AC asks for. `changeSetting` is documented as the deterministic safety net behind that structural gate; here it is the whole gate, and it is a unit-testable one.

**`conversationId` is a prop, not a fifth store read** — the settled `RunConfigSections` / `ComposerSlot` / `BackgroundTaskPanel` idiom. `Composer` already subscribes to `activeConversationId`, so the prop costs no subscription; the other three reads stay inside this leaf so a snapshot tick does not re-render the textarea (`ContextUsageControl`'s stated reason).

### `RunConfigSections.tsx`

One `export` keyword on `publishedRowFor`. Its docblock gains one sentence naming the third caller and restating that this trigger joins the SESSION's model. No lift into a new module: the docblock's "one home for the rule" is satisfied by the export, and a co-located module would add a fifth production file to an already over-ceiling slice.

### `ConversationScreen.tsx`

- `<ComposerModelMenu conversationId={activeConversationId} />` prepended between `<ComposerActionsMenu />` and `<ContextUsageControl />` in `.composer__footer`. No spacer and no placeholder for #682, which inserts itself when it lands.
- The footer comment's "#683 model and effort … blocked on daemon work that does not exist" half is refreshed; #682's and #685's halves stand.
- The `.composer__row` JSX comment (anchor site (c)) is corrected: it repeats verbatim the spent "exactly one in the app" reason.

### `conversation.css`

The extraction the stylesheet's own comment assigns to the second footer button, in `.button-small`'s two-class-mix shape:

- **`.composer__footer-button`** — lifted from `.composer__actions`: the `<button>` reset (`padding: 0; border: none; background: none`), the flex row (`display: flex; align-items: center; gap: var(--space-1)`), `font-family`, the body-small type block, `color: var(--color-primary)`, and `white-space: nowrap`.
- **`cursor: pointer` does NOT lift.** It stays on `.composer__actions` and is declared again on `.composer__model`, because this ticket's consumer has an inert arm that wears the shared class: a hand cursor over an element that opens nothing is a lie the shared rule would make unavoidable.
- **`white-space: nowrap` lifts, but its JUSTIFICATION does not.** `.composer__actions` rests it on "the label is a client-owned constant"; this label is claude-authored. What transfers is the declaration (the row has a hard `height: 20px`, so a wrapped label overflows rather than grows it); what does not is the claim that nowrap alone is sufficient. AC1's second sentence is answered by `.composer__model-label`'s `max-width` + `text-overflow: ellipsis`, not by nowrap.
- **`.composer__model-label`** — `max-width: 120px; overflow: hidden; text-overflow: ellipsis`. A client-owned bound on daemon text. 120px is derived from the row at the app's 800px minimum window: a ~400px chat pane less the row's 32px padding, the Actions trigger, the nowrap `Context: 100%` reading and two 20px gaps leaves ~185px, so 120 fits with headroom while comfortably clearing a real display name at 12px body-small.
- **`.composer__model-icon`** — `flex: 0 0 auto`, the `.composer__actions-icon` declaration. Deliberately NOT lifted alongside the button: the standing comment assigns the BUTTON extraction, lifting the glyph rule would re-class a shipped element and move a sixth test assertion for one declaration, and `.composer__actions-icon`'s own comment records no such trigger. The note stays for #682 as the third consumer.
- `.composer-options-anchor`'s comment (anchor site (b)) and `.composer__row`'s (the stylesheet half of (c)) lose the spent uniqueness reason; both decisions stand on their declarations. The row-level overflow question stays assigned to whichever ticket first has a row that overflows.

## State + concurrency model

Read-only, four narrow slices, no new store and no new event. Every write goes out through `changeSetting` → `submitSettingsChange`, which mints the correlation id, records the optimistic pending change and sends exactly one `setSessionSettings`. The optimistic label movement is not local state: `selectEffectiveSettings`' pending overlay is what moves it, and the same composition reverts it when the store drops the pending record on rejection. There is no local `useState`, no effect, no timer, no async work and therefore no cancellation path to define — the panel's own listeners and their teardown are `ComposerOptionsMenu`'s and are untouched.

Re-render correctness: the model selector is `useMemo`-stable per id, so a list published for another conversation leaves this leaf `Object.is`-identical; the write store is read RAW so its identity is stable between dispatches; nothing subscribes from `Composer` that it did not already subscribe to.

## Error handling

No new failure mode reaches this surface. A rejected change is handled by dropping the optimistic overlay, so the trigger returns to the true value on its own — and this menu says nothing more, per the ticket: the row has a hard 20px height with no slot for an error line and the sheet already names the rejection. A missing session id is a silent no-op inside `changeSetting`. A model list that never arrives is AC4's inert arm, not an error. Nothing on this path logs, matching `modelListStore`'s no-diagnostic property.

## Testing strategy

**Unit — `ComposerModelMenu.test.tsx`** (view only; the container is proven at its mount site):

- the trigger's label is the matched row's `display_name`, matched by exact equality on `value`
- a value differing only by case / as a substring / by surrounding whitespace does NOT match — the label falls back verbatim
- `models === null` and `models.models.length === 0` each render the inert arm: label present, and no `aria-haspopup`, no `<button`, no `.composer-options-anchor`, no `role="menu"`
- `model === ''` renders nothing at all
- the rows reach the shared panel as exactly the seeded rows' display names, in order, with equal counts — asserted as a DERIVATION over the seeded array, never as `not.toContain('<a model name>')`, which would type the banned literal into the file AC2's own grep polices
- exactly one row wears `aria-current`, and it is the matched one; a miss marks none
- two rows sharing a `value` are both carried and both marked — the accepted consequence, pinned so a later "fix" has to argue with a test
- the chevron is `aria-hidden` and the trigger's accessible name is the label alone
- the label sits in its own bounded element (the class that carries `max-width` / ellipsis), so AC1's second sentence has a detector at the markup tier

**Unit — `ConversationScreen.test.tsx`**: the mount site (order: footer → Actions anchor → the model trigger → the context reading), which is the only proof the control is wired in; plus the five `class="composer__actions"` assertion updates. `:3810`'s extractor gains a non-empty precondition so it can never again pass vacuously with an empty match.

**e2e — `e2e/composer-model-menu.spec.ts`** (fake tier): one launch, one continuous drive, `run-config-settings.spec.ts`'s frame builders plus `composer-actions.spec.ts`'s menu drive. Seed a run-config snapshot naming a model and push an unsolicited `model_list` for the seeded conversation; assert the trigger reads that row's display name; open, assert the entries and the marking; pick another row and assert both the optimistic label move and exactly one captured `set_session_settings` carrying only `{ session_id, model: <value> }`; then pick a row the fake rejects and assert the label reverts. The trigger is located by the display name the spec itself seeded — it has no client-owned label to locate by.

**e2e — `e2e/composer-options-clamp.spec.ts`**: the anchor locator is re-scoped to the Actions trigger's own anchor (`has:` the exact-named button); measurements untouched. Note that the bare locator would survive by accident in that spec's launch state, since with no `model_list` pushed the model trigger renders its inert arm and emits no anchor — the invariant it rests on becomes CONDITIONAL, which is weaker than what its comment claims and is why the re-anchor is required rather than optional.

There is no vitest detector for stylesheet declarations (the standing ruling); the CSS extraction is proven by the class-run assertions above plus review.

## Security review

Adversarial pass over this plan, per the ticket's `security-sensitive` label.

**Trust boundaries.** Exactly one untrusted input reaches this slice: `WireModelOption.display_name` and `.value`, claude-authored text that crossed the subprocess trust boundary, decoded fail-closed for SHAPE only (#972) and bounded but NOT sanitized by the daemon. It arrives already held verbatim in `modelListStore` and is never re-fetched here. `model` (the effective session model) is daemon-authored by the same argument — it originates in the `session_settings` reply. The session id is daemon-asserted and is used only as a payload value the main process rebuilds, never as a key or a path.

**Findings.**

1. **MUST FIX — `aria-label` is an attribute sink and must never carry the label.** The obvious copy of `ComposerActionsMenu` passes the trigger's visible text as `ariaLabel`, which here would put claude-authored text into an attribute — forbidden outright by CLAUDE.md's daemon-text ruling. Addressed in the design: `COMPOSER_MODEL_MENU_LABEL` is a client-owned constant, and it names the panel only. The trigger keeps NO `aria-label` (the container never sets one), so its accessible name stays its visible text and WCAG 2.5.3 is unaffected.
2. **MUST FIX — every daemon string reaches exactly one JSX text position.** `display_name` renders as an ordinary React text child in the trigger's label span and, via the panel, in each row. `value` reaches four places, all non-sink: `key={option.id}` (React's own keyed reconciliation, a Map internally), `option.id === currentId` (string comparison), `onSelect(option.id)` (pass-through into the write payload) and the panel's array-index select. No `dangerouslySetInnerHTML`, no attribute, no URL, no filename, no cache key, no `title`, no `data-*`, and no plain object is ever keyed by daemon text. The one new derived structure is an ARRAY built by `.map`, never an index.
3. **MUST FIX — nothing on this path is logged.** No `console.*` on any branch, inheriting `modelListStore`'s total no-diagnostic property. A content-free count would be the first crack in it and is not written.
4. **SHOULD FIX — the label must be length-bounded at the render boundary, not trusted to the daemon's bound.** A long or pathological `display_name` in a row with `height: 20px` beside a nowrap reading is a layout-level denial of the context reading, remotely triggerable by a hostile or merely buggy daemon. `.composer__model-label`'s `max-width` + ellipsis is that bound, and it is why nowrap alone (`.composer__actions`' answer) is explicitly not carried over. A control byte is PERMITTED rather than excluded in these strings (the store's header is precise that no measurement exists here), and the bound plus nowrap is the answer to that too.
5. **SHOULD FIX — no parse, no normalisation, no derivation from `value`.** `value` is not parseable (`default`, `opus[1m]`, `claude-fable-5[1m]`). Nothing splits it, lowercases it, trims it or presents it as a version; the match is `===` through one exported helper, and the submitted value is the row's own string verbatim, so the round trip cannot desynchronise.
6. **SHOULD FIX — the write carries one field and one addressable id.** `changeSetting` gates on `isAddressableSessionId` before anything is sent, so a session-less pick sends nothing and dispatches nothing; `submitSettingsChange` sends exactly one command carrying the single changed field. This menu submits no permission mode and reads no `supports_auto_mode` — `SettingsChange` has no such field to send, and that control is #682's.
7. **OUT OF SCOPE — the two truncation reports.** `truncated_fields` and `droppedModels` are deliberately not surfaced in the footer (settled on the ticket); the sheet remains the surface that reports a cut list. Not a leak: withholding a report is a completeness question, and #975 answers it where the operator can act on it.
8. **OUT OF SCOPE — duplicate `value` rows.** Two entries may share an id, so both would wear `aria-current` and React logs a dev key warning. Bounded and accepted: both submit the same value, so the pick is still correct. No dedupe, no synthetic id.

**Verdict: PASS.** Every MUST FIX is discharged by the design above rather than deferred, and both SHOULD FIX items are concrete declarations in the plan.

## Open questions

1. Does the inert arm need a visual affordance distinguishing it from the context reading beside it? Resolved in the design as "no": it is the same type and colour as the operable trigger, minus the chevron, which is the only mark that claims interactivity. If review disagrees, the fix is a `--inert` modifier, not a new element.
2. Is `120px` the right label bound? It is derived from the 800px-minimum row budget above, not measured in a browser. If the Playwright drive shows a real published name clipping at the launch width, the number moves and the derivation is restated — the mechanism (a client-owned max-width plus ellipsis) does not.
