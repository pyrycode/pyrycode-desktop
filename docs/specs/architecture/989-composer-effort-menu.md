# 989 — the effort menu in the input footer

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` | `ComposerModelMenu`, `ComposerModelMenuView`, `composerModelMenuModel`, `COMPOSER_MODEL_MENU_LABEL`, `CHEVRON_PATH` | The structural template one button to the left: the pure-model / pure-view / store-bound-container split, the four store reads, the interaction-time `window.pyry` dereference, and the glyph const's stated reason for staying module-private. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx` | `publishedRowFor`, `EffortSection` | The exported match rule this is the fourth caller of, and the settled treatment of the *same field* — the levels, the collapse of absent/`null`/`[]`, the verbatim submission, the no-client-allowlist ruling and the index-key security call. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` | `ComposerOptionsMenu`, `ComposerOptionsPanel`, `ComposerOptionsPanelOption` | The shared surface — trigger `<button>`, `aria-haspopup`, `aria-expanded`, roving focus, `aria-current`, `.composer-options-anchor`, `key={option.id}`. No prop may be added to it. |
| `src/renderer/src/store/runSettingsWriteStore.ts` | `selectEffectiveSettings`, `SettingsChange` | The displayed value (pending overlay > confirmed > snapshot base) and `effort`'s `''` fallback, which AC1's second half turns on. `SettingsChange` already carries the effort arm — no type change anywhere. |
| `src/renderer/src/screens/conversation/runSettingsControls.ts` | `changeSetting`, `isAddressableSessionId` | The write path and its deterministic no-addressable-session gate, which is how AC4's "sends nothing" is met without a structural gate here. |
| `src/renderer/src/store/modelListStore.ts` | `selectModelListFor`, `ModelListEntry` | The rows and the three readings the selector keeps apart; its header states the security tier for every string on this path. |
| `src/shared/wire/types.ts` | `WireModelOption` § `effort_levels` | `string[]`, never optional — absent / `null` / `[]` are one position by contract. Also the direction hazard and the "cut is unknowable from `effort_levels` alone" clause this slice deliberately does not act on. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | the `.composer__footer` row, `ComposerModelMenu` mount, `ContextUsageControl` | The mount point, `activeConversationId` already in scope as a prop source, and the footer's JSX comment recording each control's placement decision. |
| `src/renderer/src/screens/conversation/conversation.css` | `.composer__footer`, `.composer__footer-button`, `.composer__model`, `.composer__model-label`, `.composer__actions-icon`, `.composer-options-anchor` | The row geometry the bound is derived from, the shared treatment this trigger rides, why `cursor` is not in it, and the standing third-glyph note that fires on this ticket. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` | the model menu's mount proof; the two `aria-haspopup="menu"` count assertions | The mount-proof shape this control needs, and the two counted assertions that must be re-checked against a third control in the row. |
| `e2e/composer-model-menu.spec.ts` | `capturingFake`, `turnStateFrame`, `modelListFrame`, `settingsFramesMatching` | The drive template — including the turn-end edge that makes a snapshot exist at all, and the withheld reply that makes an optimistic overlay observable. |
| `docs/knowledge/features/composer-model-menu.md` | § "The `.composer-options-anchor` uniqueness invariant is now conditional", § "Security" | The lesson this ticket inherits: a counted assertion on the footer survives only by where it sits relative to a `model_list` push. |
| `docs/knowledge/features/conversation-shell-composer.md` § "Composer footer row (#811)" | — | The row's no-placeholder rule and the item rhythm this trigger inherits. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3688

The fourth `Input footer button` instance in `Info and buttons` (`115:3660`): a 4px-gap centred flex row holding one M3 body/small label at `schemes/primary` (drawn `Max`, **illustrative only** — the label is the session's published effort value rendered as sent) followed by the 8×4 `chevron-up-solid-full` glyph. Structurally identical to the model instance at x=135 and the Actions instance at x=0, which is why `.composer__footer-button` already carries the whole treatment. Placed immediately right of the model trigger and **not** at the design's x=197: #682's permission-mode button is sequenced behind this one and no spacer is emitted for it. The opened panel is #838's `121:3879` and is not redrawn.

## Context

The footer's third live control, and its last before the context reading. Everything under it is merged: the shared panel (#838/#839/#840), the published levels (#974), the single-field write (#256), the exported match rule (#560/#975/#976) and — as of #988 — the shared button treatment, `publishedRowFor`'s export and the clamp-spec re-anchor. What is new is the entries, the trigger's label and what picking one does.

No ADR is warranted: every decision here applies a rule already recorded in the repo, and the two calls this slice must take on its own (the label bound, the third glyph) are recorded in the stylesheet beside the rules they govern.

### Size: over the line ceiling by ~160, shipped as one ticket

Total written work lands near ~960 against the 800 boundary. Every other line of the S table holds: 3 production files (≤5), 5 new exports (≤5), 1 call site (≤10), 4 acceptance criteria (≤5), 3 renderings (≤10). Split depth is one (parent #683, no grandparent), so a split is *available* — and the only cut on offer is component-from-mount, whose child would be consumed by exactly one sibling in the same family, which is the floor's definition of not-a-ticket. Floor wins over ceiling: the overage is stated and the ticket is built. The direct analogue (#988) landed 1181 lines inside its budget with no continuation leg.

## Design

### `ComposerEffortMenu.tsx` (new)

`ComposerModelMenu.tsx`'s three-part shape verbatim — a pure model function, a pure props-in/markup-out view with an inert arm, and a thin store-bound container — so the markup stays a pure function of props under `renderToStaticMarkup`.

```ts
// The PANEL's accessible name. Client-owned, and NOT the trigger's visible text: this trigger's text is
// claude-authored and aria-label is an attribute sink.
export const COMPOSER_EFFORT_MENU_LABEL = 'Effort'

export interface ComposerEffortMenuModel {
  label: string                              // the session's effective effort, verbatim
  options: readonly ComposerOptionsPanelOption[]
  currentId: string                          // the same string; a value matching no level marks nothing
}

export function composerEffortMenuModel(
  models: ModelListEntry | null | undefined,
  model: string,
  effort: string
): ComposerEffortMenuModel | null

export function ComposerEffortMenuView(props: {
  model: string
  effort: string
  models: ModelListEntry | null
  onSelect: (level: string) => void          // required — "a view that cannot answer is a bug"
}): JSX.Element | null

export function ComposerEffortMenu(props: { conversationId: string | null }): JSX.Element | null
```

**THREE RENDERINGS**, decided by the pure function so every AC is assertable as data rather than only through markup:

| Input | Rendering |
|---|---|
| `effort === ''` | `null` — nothing in the row |
| `effort !== ''`, and the matched row publishes no levels | an inert `<span>` carrying the label: no chevron, no role, no tabindex, no handler, no anchor |
| `effort !== ''` and the matched row publishes levels | `ComposerOptionsMenu` with the levels as options |

The first is AC1's second half, and #988 settled it one button to the left: **draw no element at all.** `selectEffectiveSettings` resolves `effort` to `''` until a run-config snapshot has arrived, and that snapshot lands on a turn-end edge, so the window is ordinary app startup rather than an edge case. Every other rendering would draw an empty gap where a label belongs; `ContextUsageControl` takes the same posture for its own unavailable reading and #811's no-placeholder rule points the same way. **The sheet's opposite posture is deliberately not carried across:** `RunConfigSections`' `run-config__effort-current` renders a present, empty line for the same field, for its own stated reason. The footer follows its neighbour, and AC1 pins it.

The second is AC3, and it is **one arm covering all three nothing-to-offer readings** — no list for the conversation, a session model matching no published row, and a matched row publishing `[]` — because `publishedRowFor(models, model)?.effort_levels ?? []` yields the empty array for all three and the client's behaviour is identical for all three by the wire contract. It cannot be `options={[]}` through the shared menu, which renders `aria-haspopup` and `aria-expanded` unconditionally and would open exactly the empty panel AC3 forbids. The chevron is omitted from this arm: an up chevron is the design's "this opens a panel" mark, and drawing it on an element that opens nothing is the visual half of the claim this arm refuses.

**No fallback, anywhere.** An absent, unmatched or empty list never means "offer all five". There is no level list in this repo to fall back to — #976 deleted the last one — and re-minting it here would put a second copy of the vocabulary back in the one place it was removed from.

**The label is `effort`, verbatim, with no lookup.** Unlike the model trigger, the value *is* the display string: claude's own control displays these lowercase and byte-identical to the machine values, so there is no relabelling, no capitalisation and no client vocabulary. `publishedRowFor` is used only to find the *levels*, never the label.

**The row is resolved from the session's effective model by exact equality on `value`**, through `publishedRowFor` — the fourth caller of the one exported home for that rule, and the same join `EffortSection` and the model trigger make. No family derivation, no substring, prefix, case fold or trim: `value` is an argument (`default`, `sonnet`, `opus[1m]`), not a parseable identifier.

**`currentId` is `effort` itself**, not a looked-up level. The options' ids *are* the levels, so the panel's existing `option.id === currentId` comparison marks the matching row and marks nothing when the session's effort appears in no published list — the same no-special-case branch a stale model id already takes. Exact equality is load-bearing here for `EffortSection`'s reason: `high` is a substring of `xhigh` and a row publishes both.

**`truncated_fields` is deliberately not read.** Settled on the ticket: the shared panel's option is `{ id, label }` with one text child, so a cut report here needs either a new prop on a component four tickets share (forbidden) or client copy fused into a daemon-authored node (rejected at `RunConfigSections`' cut-marker rationale). A cut-to-nothing list therefore collapses into the inert arm alongside no-list-yet, and a shortened list is offered as it arrives. The sheet remains the surface that reports both readings.

**Duplicate published levels are carried, not deduped** — and this is the one genuine tension in the design, named here rather than discovered in review. `id` is the level so `onSelect(id)` submits it with no lookup, but `ComposerOptionsPanel` keys on `option.id`, so a repeated published level yields a duplicate React key (a dev-mode warning) and two rows both wearing `aria-current`. Bounded and accepted: both rows submit the identical string, so the pick is still correct. AC2's "exactly the `effort_levels` published" outranks a tidier list, `EffortSection` reached the same conclusion by a different route (an array-index key, which the shared panel does not offer), and #988 settled the analogous duplicate-`value` case by carrying both. The panel's key choice is #838's and is not reopened.

**The container** is `ComposerModelMenu`'s recipe unchanged: `useSessionIdStore(selectSessionId)`, `useRunConfigStore(selectSnapshot)`, `useRunSettingsWriteStore((s) => s)` — the RAW state, never `selectEffectiveSettings` as the zustand selector, which returns a fresh object every call and defeats `Object.is` — and `useModelListStore` with a `useMemo`-stable `selectModelListFor(conversationId)` closure. `selectEffectiveSettings(snapshot, writeState)` is composed in the render body. `conversationId` arrives as a prop, not a fifth store read: `Composer` already subscribes to `activeConversationId`.

`onSelect` is an arrow dereferencing `window.pyry.sendCommand` at **interaction time only** — hoisting it would move the dereference into the render path, where `window.pyry` does not exist under `renderToStaticMarkup` and every container test would throw. It calls `changeSetting({ sessionId, sendCommand, dispatch }, { field: 'effort', value })`.

**AC4's "sends nothing when there is no addressable session id" is met by `changeSetting`'s own gate**, not by withholding the handler — #988's ruling, for the same reason: this view branches operability on the LEVELS, and withholding the handler would fuse two unrelated conditions and make a populated menu unopenable whenever the session id is unknown.

**The chevron path is duplicated as a module-private const**, the third copy of the same 8×4 `chevron-up-solid-full` geometry. See the third-glyph call below — the same decision, taken once for the glyph and its CSS rule together.

### `ConversationScreen.tsx`

`<ComposerEffortMenu conversationId={activeConversationId} />` between `<ComposerModelMenu />` and `<ContextUsageControl />`. The footer's JSX comment gains this control's placement note (right of the model trigger, no spacer for #682), and the bare-tree count assertion's parenthetical at the overflow-menu test is extended to name the effort control's own reason for rendering nothing.

### `conversation.css`

Three rules, no lift, nothing re-forked:

- **`.composer__effort { cursor: pointer }`** — the operable half only, `.composer__model`'s declaration verbatim. The inert arm wears the shared class without it, which is the whole reason `cursor` is not in `.composer__footer-button`.
- **`.composer__effort-label`** — `min-width: 0; max-width: 64px; overflow: hidden; text-overflow: ellipsis`. A client-owned bound on daemon text, required for the same reason the model label's is: the string is claude-authored and unsanitized, and the row has a hard `height: 20px` beside a nowrap reading, so an unbounded label is a remotely triggerable denial of the context reading. **The number is derived, not copied.** #988 measured the 13-character reading at 82.5px, i.e. ~6.35px per character at 12px body-small; the widest level in the measured vocabulary (`medium`, six characters) therefore renders at ~38px, and 64px clears it with two-thirds headroom — room for an honestly longer level claude adds later, while holding the whole trigger to ~76px against the model trigger's 132px worst case. **A separate class, not `.composer__model-label` reused:** the two bounds answer different questions (a display name versus a short scale), and `e2e/composer-model-menu.spec.ts` locates `.composer__model-label` bare, which a second wearer would break under Playwright strict mode.
- **`.composer__effort-icon { flex: 0 0 auto }`** — `.composer__actions-icon`'s single declaration, for this trigger's glyph.

**The third-glyph call, taken explicitly.** `.composer__actions-icon`'s standing comment closes with "#682 landing as the third glyph is the moment to reconsider"; #682 is sequenced behind this ticket, so the number is stale and this control is the third glyph. **The lift is declined and the note is corrected rather than the rules refactored.** On the merits a three-consumer identical single declaration is where a lift starts to pay, but lifting it re-classes two shipped elements, moves their assertions, and would take the duplicated `CHEVRON_PATH` const with it — fan-out outside this slice and squarely inside the "don't refactor adjacent code while you are there" rule. #682 re-classes its own glyph anyway, so it can carry both lifts as a one-line change; the note now says that, with the number corrected.

**This is not the row-overflow ticket, and here is the arithmetic.** At the app's 800px minimum the conversation pane is 400px, less `.composer__footer`'s two `--space-4` paddings = 368px of content, less three `--space-5` gaps = 308px for four items. With realistic published content (`Actions` ~56px including its glyph and gap, a real display name ~63px, `medium` ~50px, the reading 82.5px) the row occupies ~252px of that 308px and keeps ~56px of slack. #682's fourth control (~37px plus a fourth 20px gap) is what takes the row to the boundary. The row *can* be overflowed today by a hostile daemon maxing the model label at its own 120px bound — but that is a condition #988's bound already creates and one this ticket's 64px cannot cause on its own, and the fix when it fires belongs on `.composer__footer` as a whole-row shrink policy, not in a single control's rule. **#988's 120px literal is not retuned here**, and the standing assignment at `.composer-options-anchor` stays where it is.

## State + concurrency model

Read-only, four narrow slices, no new store, no new event, no new type. Every write leaves through `changeSetting` → `submitSettingsChange`, which mints the correlation id, records the optimistic pending change and sends exactly one `setSessionSettings`. The optimistic label movement is **not local state**: `selectEffectiveSettings`' pending overlay moves it, and the same composition reverts it when the store drops the pending record on a rejection. There is no `useState`, no effect, no timer, no async work and therefore no cancellation path to define; the panel's own listeners and their teardown are `ComposerOptionsMenu`'s and are untouched.

Re-render correctness: the model-list selector is `useMemo`-stable per id so a list published for another conversation leaves this leaf `Object.is`-identical; the write store is read raw so its identity is stable between dispatches; `Composer` gains no subscription it did not already hold.

## Error handling

No new failure mode reaches this surface. A rejected change drops the optimistic overlay, so the trigger returns to the true value on its own — and the footer says nothing more, per the ticket: the row has a hard 20px height with no slot for a message and the sheet already names the rejection. A missing session id is a silent no-op inside `changeSetting`. A list that never arrives is AC3's inert arm, not an error. The upstream direction hazard (a future level published but refused inbound by the daemon's closed `validEffort` enum) surfaces as an ordinary rejection through that same path; **no client-side allowlist is added**, which would be a second copy of the vocabulary #976 deleted. Nothing on this path logs.

## Testing strategy

**Unit — `ComposerEffortMenu.test.tsx`** (the model function plus the pure view; the container is proven at its mount site, and a static render can neither click nor open the panel):

- the trigger's label is the session's effort verbatim — no case change, no relabelling — for a matched row publishing levels
- the entries are exactly the row's `effort_levels`, in published order, `id === label === level`, asserted as a derivation over the seeded array so a fourth level inherits the guard
- all three nothing-to-offer readings yield `options: []` with the label intact: `models === null`, a model matching no published row, and a matched row publishing `[]`
- an absent/unmatched list is **not** read as "offer all five": the inert arm's markup is asserted whole, so any synthesised entry fails
- `effort === ''` renders nothing at all, on every combination of list and model
- the matched level is marked and it is the only one; an effort appearing in no published level marks none
- a repeated published level is carried twice and both are marked — the accepted consequence, pinned so a later dedupe has to argue with a test
- exact equality on the model join: a case fold, a prefix, a superstring and surrounding whitespace each fail to match, so the levels stay empty
- the chevron is `aria-hidden` and the trigger's accessible name is the label alone; no daemon string reaches any attribute position (asserted by sweeping every `attr="value"` run in the markup)
- the label sits in its own bounded element, so AC1's bound has a detector at the markup tier
- the levels reach the shared panel as one row each with the matched one marked

**Unit — `ConversationScreen.test.tsx`**: one new mount proof, seeding a snapshot with a non-empty model *and* a non-empty effort — required, not optional coverage, because every assertion in the component's own file passes on an unmounted component. It asserts the row order (Actions → model → effort → reading), the effort label's verbatim value through the mounted container, and that the footer still holds exactly one `aria-haspopup="menu"` and one anchor (no list is published, so both menus render their inert arms). The two existing counted assertions are re-checked rather than edited: both render trees resolve `effort` to `''`, so this control renders nothing in each.

**e2e — `e2e/composer-effort-menu.spec.ts`** (fake tier), `composer-model-menu.spec.ts`'s drive with the levels as the subject: one launch, one continuous drive. Push a `turn_state` thinking → idle pair to produce the turn-end edge that makes the app request a snapshot at all (a fresh launch has none, so *both* footer controls are absent before it — the property of the row that #988 measured). Then, before any list arrives, assert the trigger reads the seeded effort and is inert, with exactly one anchor and one `aria-haspopup` still in the footer. Push a `model_list` whose baseline row publishes levels; assert the trigger opens, offers exactly those levels in order with the seeded effort marked, and that the row stays 20px tall with no horizontal page overflow. Pick a level: assert the label moves optimistically and that exactly one `set_session_settings` carrying only `{ session_id, effort }` with the level verbatim was captured. Then pick a level whose reply the fake withholds and push a correlated `error` addressed by the envelope id read back off the capture — the only way an optimistic overlay is observable against an in-process loopback fake — and assert the label reverts. Finally, switch the session's model to a row publishing `[]` and assert the trigger goes inert without opening an empty panel (AC3's third reading, end to end).

**Verified not to break, and not edited:** `e2e/composer-options-clamp.spec.ts` scopes its anchor locator `has:` the Actions trigger (#988); `e2e/composer-model-menu.spec.ts`'s footer counts at its two counted assertions sit *before* its `model_list` push, where this control is still inert, and its `.composer__model-label` locator stays unambiguous because this label wears its own class.

There is no vitest detector for stylesheet declarations (the standing ruling); the three CSS rules are proven by the class-run assertions above, the e2e row-geometry assertion, and review.

## Open questions

1. Is 64px the right label bound? It is derived from #988's measured character advance, not measured in a browser. The e2e drive's row-geometry assertion is the detector; if a real level clips at the launch width the number moves and the derivation is restated — the mechanism (a client-owned max-width plus ellipsis) does not.
2. Should the inert arm be visually distinguished from the reading beside it? Resolved as "no", #988's answer for the identical arm: same type and colour as the operable trigger, minus the chevron, which is the only mark claiming interactivity. If review disagrees the fix is a modifier, not a new element.

## Security review

Adversarial pass over this plan, per the ticket's `security-sensitive` label.

**Verdict: PASS**

**Findings:**

- **[Trust boundaries] MUST FIX, discharged in the design.** Exactly one untrusted input reaches this slice: every string in `WireModelOption.effort_levels`, plus `value` used as the join key. Claude-authored text that crossed the subprocess trust boundary, decoded fail-closed for *shape* only (#972) and bounded but **not sanitized** by the daemon. The tier is *higher* than the workspace-authored strings the slash-command list carries, and the sibling store's measured-control-byte argument does not transfer — no control byte is measured in these short labels, but one is permitted rather than excluded. The boundary is explicit and singular: `composerEffortMenuModel` is the only place these strings are read, and the view is the only place they are rendered. `effort` itself is daemon-authored by the same argument (it originates in the `session_settings` reply and in this client's own echo of a published level).
- **[Render sinks] MUST FIX, discharged in the design.** Every level reaches exactly one JSX **text** position — the trigger's label span, and one text child per panel row — where React escapes it. Never `dangerouslySetInnerHTML`, never an attribute, a URL, a filename, a cache key, a lookup path or a log. A level additionally reaches four non-sink places, all the shared panel's: `key={option.id}` (React's own keyed reconciliation, a `Map` internally, never a plain-object index — the `__proto__`-as-key hazard `WireModelOption`'s docblock names is closed by that alone), the `option.id === currentId` string comparison, the `onSelect` pass-through into the write payload, and an array index. **No plain object is keyed by any daemon string on this path,** and the one new derived structure is an array built by `.map`. The panel's `aria-label` is the client-owned `COMPOSER_EFFORT_MENU_LABEL`; the trigger carries no `aria-label` at all, so its accessible name stays its visible, auto-escaped text and WCAG 2.5.3 is unaffected.
- **[Availability / layout DoS] SHOULD FIX, addressed by a concrete declaration.** A long or pathological published level in a row with a hard 20px height beside a nowrap reading is a layout-level denial of the context reading, remotely triggerable by a hostile or merely buggy daemon — and `white-space: nowrap` alone does not bound it. `.composer__effort-label`'s `max-width: 64px` + `text-overflow: ellipsis` is the bound, declared at this render boundary rather than trusted to the daemon's own, and it answers the permitted-control-byte case too. The e2e row-geometry assertion is its detector.
- **[Input validation / no derivation] SHOULD FIX, addressed.** Nothing parses, splits, lowercases, trims, normalises or version-infers from a level or from `value`. The model join is `===` through the single exported `publishedRowFor`; the submitted level is the published string verbatim, so the round trip cannot desynchronise, and the optimistic overlay holds the same string the panel's own comparison re-selects. **No client-side allowlist is added** — it would be a second copy of the vocabulary #976 deleted, and the upstream direction hazard (a future level published then refused by the daemon's closed `validEffort` enum) is upstream's, already recorded, and surfaces as an ordinary rejection.
- **[Write surface] SHOULD FIX, addressed.** `changeSetting` gates on `isAddressableSessionId` before anything is sent, so a session-less pick sends nothing and dispatches nothing; `submitSettingsChange` sends exactly one command carrying the single changed field. This control submits no model, no permission mode and reads no `supports_auto_mode`.
- **[Logs, errors, telemetry] No findings.** Nothing on this path logs on any branch, inheriting `modelListStore`'s total no-diagnostic property; a content-free count would be the first crack in it and is not written. No error line is rendered (settled on the ticket) and no daemon string reaches an error message.
- **[Electron attack surface / process placement] Not applicable, by construction.** This slice adds no IPC channel, no `contextBridge` surface, no window and no `webPreferences`. It reads store state the bridge already populates and calls one existing renderer command. No key, socket, token or raw byte is within reach: the transport stays in the main process, unchanged.
- **[Tokens, secrets, file/storage, crypto, network] Not applicable, by construction.** No secret, no credential, no filesystem path, no randomness, no comparison against a secret (the two `===` comparisons are on non-secret display values, so `timingSafeEqual` is not indicated), no socket and no timeout of its own.
- **[Concurrency] No findings.** No async work, no timer, no listener, no local state, therefore no cancellation path and no check-then-act race. The single write is fire-and-correlate through an already-tested path; last-write-wins for rapid same-field picks is `selectEffectiveSettings`' documented behaviour, not a race introduced here.
- **[Threat model — hostile daemon] Addressed above.** A hostile daemon's three levers on this surface are a hostile *string* (bounded by the render sinks and the label bound), a hostile *list* (bounded by rendering exactly what arrives, with no fallback and no dedupe) and a *withheld or refused reply* (bounded by the optimistic overlay being dropped, which returns the trigger to the true value with no stuck state). A hostile relay is on-path but content-blind and reaches nothing here that the daemon does not.
- **[Truncation reports] OUT OF SCOPE.** `truncated_fields` naming `effort_levels` is deliberately not surfaced in the footer — settled on the ticket, and the run-configuration sheet (#976) remains the surface that reports it, where the operator can act on it. Withholding a report is a completeness question, not a leak.
- **[Duplicate published levels] OUT OF SCOPE, bounded and accepted.** A repeated level yields a duplicate React key and two marked rows. Both submit the identical string, so the pick is still correct; no dedupe, no synthetic id, and the panel's key choice is #838's.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03

## Revisions

### 2026-09-03 — implementation

The design held: no interface, arm or rule changed between the plan commit and the code. Three things are worth recording.

**Open question 1 is resolved: 64px holds.** The e2e drive asserts it rather than leaving it to review — with all three footer controls drawn and the effort panel open, `.composer__footer` measures exactly 20px tall and `document.body.scrollWidth <= clientWidth`. That is a permanent detector rather than #988's throwaway measurement, and it is the check that will redden first if a later control makes this the row-overflow ticket after all.

**One `model_list` frame un-inerts BOTH footer menus at once**, which the plan's e2e sketch had not thought through: the footer's `.composer-options-anchor` count moves 1 → 3 → 2 across the drive (Actions alone; then Actions + model + effort; then Actions + model once the matched row's levels go empty), not 1 → 2 → 1. The spec asserts all three counts, and the 3 → 2 step is what isolates *this* control as the one that dropped out — a stronger proof of AC3's third reading than asserting the label alone, which is unchanged across that push by design.

**The two sibling footer specs and the clamp spec were run rather than reasoned about.** `e2e/composer-model-menu.spec.ts`'s two counted footer assertions still hold because they sit before that spec's own `model_list` push, where this control is still inert; its `.composer__model-label` locator stays unambiguous because this label wears `.composer__effort-label`; and `e2e/composer-options-clamp.spec.ts` was already scoped `has:` the Actions trigger by #988. All three pass unedited, as does `e2e/composer-actions.spec.ts`.
