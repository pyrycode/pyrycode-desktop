# Composer effort menu (#989)

The footer's third live control, immediately right of [the model menu](composer-model-menu.md) and its
last before the context reading (Figma `115:3688`). Part of
[Conversation shell — composer](conversation-shell-composer-message-box.md#composer-footer-row-811); see that
document's footer-row section for the row's geometry and no-placeholder rule.

Everything under this control was already built and dormant: the shared
[options panel](conversation-shell-composer-options-panel.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)
(#838/#839/#840), the daemon-published levels in [Model-list store](model-list-store.md) (#974), the
single-field write in [`changeSetting`](session-settings-send.md) (#256), and the exact-equality match
rule in [Run configuration Model section](conversation-shell-run-configuration.md#run-configuration-model-section-daemon-published-rows-975)
(#560/#975/#976) — the same `publishedRowFor` [the model menu](composer-model-menu.md) is the third caller
of; this ticket is the fourth. This ticket adds the entries, the trigger's label, and what picking one
does — the same three things the model menu added one button to the left, `ComposerModelMenu.tsx`'s
three-part shape (pure model function, pure view, thin store-bound container) reused verbatim.

**Position.** The design puts the permission-mode button (#682) between the model menu and this one. At the
time this ticket shipped #682 hadn't landed, so the trigger mounted immediately right of the model menu with
no spacer and no placeholder held open for it — #811's rule, reapplied a third time.
[#682](composer-permission-mode-menu.md) has since landed between Actions and the model menu, ahead of both
— it does not sit between the model menu and this one, since the design's order is Actions → permission →
model → effort. This trigger is unmoved: still immediately right of the model menu, still the row's last
control before the context reading.

## Where this control departs from its neighbour

The two triggers look interchangeable but differ in one load-bearing way: the model trigger **looks up**
its label (a row's `display_name`, joined on the session's model), while this trigger's label **is** the
session's value, unmodified. Claude's own control displays effort levels lowercase and byte-identical to
the machine values it accepts, so there is no display convention to reproduce and no relabelling to do.
The row lookup (`effortRowFor` since #1168, `publishedRowFor` before it) is used here only to find the
**levels** — never the label.

## `composerEffortMenuModel`, one pure function deciding all three renderings

`ComposerEffortMenu.tsx` exports `composerEffortMenuModel(models, model, effort): ComposerEffortMenuModel
| null`, turning three inputs into everything the view needs (`label`, `options`, `currentId`), so every
rule below is unit-testable as data rather than only through markup.

| Input | Rendering |
|---|---|
| `effort === ''` (no run-config snapshot has arrived) | `null` — nothing in the row |
| `effort !== ''`, and the matched row publishes no levels | an inert `<span>`: the label, no chevron, no role, no tabindex, no handler, no `.composer-options-anchor` |
| `effort !== ''` and the matched row publishes levels | `ComposerOptionsMenu` with the levels as options |

**The first rendering is AC1's second half, and [the model menu](composer-model-menu.md) shipped it for
the identical case one button to the left.** `selectEffectiveSettings` resolves `effort` to `''` until a
run-config snapshot has arrived, and the snapshot lands on a turn-end edge, so the window is ordinary app
startup rather than an edge case. `ContextUsageControl` takes the same posture for its own unavailable
reading, and #811's no-placeholder rule points the same way. **The run-configuration sheet takes the
opposite posture on this same field** — `RunConfigSections`' `EffortSection` renders a present, empty
`run-config__effort-current` line, "inventing no distinction the snapshot does not carry." Two shipped
precedents, opposite outcomes; the footer follows its own neighbour rather than the sheet.

**The second rendering is one arm covering all three nothing-to-offer readings** — no list has arrived
for the conversation, the session's model matches no published row, and the matched row publishes an
empty list. `effort_levels` collapses absent, `null` and `[]` into one position by wire contract,
precisely because a client's behaviour is identical for all three, so there is one case here and not two.
It cannot be `options={[]}` through the shared menu, which renders `aria-haspopup` and `aria-expanded`
unconditionally and would open exactly the empty panel this arm forbids. The chevron is omitted on this
arm: it is the design's "this opens a panel" mark, and drawing it over an element that opens nothing is
the visual half of the claim the arm refuses.

**No fallback, ever.** An absent, unmatched or empty list must not mean "offer every level": there is no
level list left in this repo to fall back to — #976 deleted the last one — and re-minting one here would
put a second copy of the vocabulary back in the one place it was removed from. `ultracode` is not an
effort value and never appears in a published list — Claude Code resolves it to `xhigh` plus a separate
boolean the daemon's session-settings surface carries no field for, confirmed on the ticket as deliberate.

**The row is the session's model**, resolved by exact equality on `value`. No family derivation, no
substring, prefix, case fold or trim: `value` is an argument (`default`, `sonnet`, `opus[1m]`), not a
parseable identifier.

**Since #1168, an empty model is that equality's one deliberate exception, and it lives outside this
rule rather than inside it.** `composerEffortMenuModel` and `EffortSection` (the run-configuration
sheet's own Effort section) both resolve their row through `effortRowFor` — `publishedRowFor` with the
lookup *argument* substituted: an empty model, the wire's inherited daemon default and explicitly not an
absence, looks up the row the daemon publishes for that default (`value: 'default'`) instead of matching
nothing. Every other model still passes straight through to `publishedRowFor`'s unchanged `===`. This is
why a chat nobody has set a model on now reaches the **menu** rendering below instead of the inert one it
drew permanently before #1168 — measured against a live daemon, that was the common case for an
unconfigured chat, not an edge one. With no `default` row published, or no `model_list` frame received at
all, `effortRowFor` still returns `undefined` and this control still draws the inert arm.
`RunningModelSection`, `ModelSection` and the model menu's two lookups keep calling `publishedRowFor`
directly and are unmoved — in particular
[the permission-mode menu](composer-permission-mode-menu.md#the-auto-hiding-join-1022) deliberately did
not follow, since its `supports_auto_mode` read would otherwise start hiding `auto` on every
inherited-default chat.

**`truncated_fields` is deliberately not read.** The shared panel's option is `{ id, label }` with one
text child, so a cut report here would need either a new prop on a component four tickets share
(forbidden) or client copy fused into a daemon-authored node (rejected at `EffortSection`'s own
cut-marker rationale). A cut-to-nothing list collapses into the inert arm beside no-list-yet; the
run-configuration sheet remains the surface that reports both readings.

**The entries are exactly the published levels**, in the daemon's order — nothing deduped, dropped,
reordered or synthesised, per AC2. `id` is the level itself, so `onSelect(id)` submits it with no lookup.
**A repeated published level is therefore a duplicate React key** in a panel that takes no new prop: it
is carried anyway, because AC2's "exactly the published levels" outranks a tidier list and both entries
submit the identical string, so the pick is still correct. `EffortSection` reaches the same conclusion by
keying on the array index, an option the shared panel doesn't offer; the panel's key choice is #838's and
is not reopened here — the same tension #988 named for a duplicate `value` and carried the same way.

**The marking:** `currentId` is the session's `effort` itself, not a looked-up level — the options' ids
*are* the levels, so the panel's existing `option.id === currentId` branch marks the matching row on its
own, with no special case. An effort matching no published level marks nothing: the daemon may narrow a
list for a session already running a level outside it.

## The write

`onSelect` calls `changeSetting({ sessionId, sendCommand: window.pyry.sendCommand, dispatch }, { field:
'effort', value })` — the same single-field write path the run-configuration sheet uses.  `window.pyry`
is dereferenced only inside this arrow, at interaction time, never during render, exactly as the model
menu's does.

**AC4's "sends nothing when there is no addressable session id" is met by `changeSetting`'s own gate, not
by withholding the handler** — the model menu's ruling, for the same reason: this view branches
operability on the *levels*, and withholding the handler would fuse two unrelated conditions and make a
populated menu unopenable whenever the session id happens to be unknown, which no AC asks for.

Picking a level moves the trigger's label to the optimistic value at once and reverts it if the change is
rejected — not local state: `selectEffectiveSettings`'s pending-overlay-over-confirmed-over-snapshot
composition moves it, and the same composition reverts it when the store drops the pending record on
rejection. This menu says nothing more on a rejection: the row has a hard 20px height with no slot for an
error line, and the sheet already names the rejection.

## CSS: three rules on `.composer__footer-button`, and the third-glyph call taken

The trigger rides [the shared `.composer__footer-button` treatment](composer-model-menu.md) #988
extracted; nothing about that rule is re-forked here. Three new declarations:

- **`.composer__effort { cursor: pointer }`** — the operable half only, `.composer__model`'s declaration
  verbatim. The inert arm wears the shared class *without* it, the same reason `cursor` was never lifted
  into the shared rule.
- **`.composer__effort-label { min-width: 0; max-width: 64px; overflow: hidden; text-overflow: ellipsis
  }`** — a client-owned bound on daemon text, required for the model label's reason: the string is
  claude-authored and unsanitized, and the row has a hard 20px height beside a nowrap reading. **A
  separate class from `.composer__model-label`, not that class reused** — the two bounds answer different
  questions (a display name versus a short published scale), and `e2e/composer-model-menu.spec.ts`
  locates `.composer__model-label` bare, which a second wearer would break under Playwright strict mode.
  **64px is derived, not copied:** #988 measured the 13-character context reading at 82.5px (~6.35px per
  character at 12px body-small); the widest level in the measured vocabulary (`medium`, six characters)
  therefore draws at ~38px, and 64px clears it with two-thirds headroom for an honestly longer level
  claude adds later, while holding the whole trigger to ~76px against the model trigger's 132px worst
  case.
- **`.composer__effort-icon { flex: 0 0 auto }`** — `.composer__actions-icon`'s single declaration,
  repeated rather than shared, for this trigger's own glyph.

**This was not the row-overflow ticket, and the prediction below has since confirmed.** At the app's 800px
minimum the conversation pane is 400px, less the footer row's paddings and gaps, leaves ~308px for four
items; with realistic published content the row occupies ~252px and keeps ~56px of slack —
[#682](composer-permission-mode-menu.md)'s fourth control was flagged here as what would take the row to the
boundary, and its own landing confirmed it: five controls plus realistic content now total ~331px against
~288px of usable row at the 800px minimum. The fix stays what this section already named — a whole-row
shrink policy on `.composer__footer`, not a number retuned in any single control's rule — and #682 did not
touch `.composer__model-label`'s or this rule's 120px/64px literals either.

**The third-glyph call, taken explicitly rather than deferred again.** `.composer__actions-icon`'s
standing comment closed with "#682 landing as the third glyph is the moment to reconsider [lifting `flex:
0 0 auto` into a shared rule]"; #682 was sequenced behind this ticket, so this control is in fact the third
glyph and the note's number was stale. **The lift is declined and the note corrected instead of acted
on.** On the merits a three-consumer identical single declaration is where a lift starts to pay, but
performing it here would re-class two already-shipped elements, move their test assertions, and pull the
three menus' independently-duplicated `CHEVRON_PATH` consts along with it — fan-out outside a slice whose
subject is one menu, and squarely inside "don't refactor adjacent code while you are there."

**[#682](composer-permission-mode-menu.md) landed as the fourth glyph and declined the lift again, rather
than carrying it as predicted here.** It re-classes its own element regardless, as this section expected,
but the lift itself would still re-class three *shipped* elements and move their assertions — #682 already
carried an unavoidable ten-assertion recount of its own, and declined to add a fourth footer ticket's worth
of unrelated fan-out on top of it. Its own note records the actual finding: the lift is overdue on the
merits, but every footer ticket that meets it arrives already at its own size budget, so it belongs to a
standalone tidy-up rather than to whichever control happens to land next.

## The default apply (#1169)

Before [#1169](../codebase/1169.md), a chat whose session reported no explicit effort
(`SessionSettingsPayload.effort === ''`, the wire's "inherited daemon default") drew the first rendering
above — `null` — forever, since unlike the model there was nothing to fall back on: claude's session-open
line carries no effort field at all. #1169 makes sure such a session *has* a level rather than reporting
one nobody holds: **a new chat opens at the last effort level used**, remembered client-side on a daemon
confirm ([Last-effort store](last-effort-store.md)) and validated against the opened chat's own published
levels before it is applied. With nothing usable remembered, the control still stays blank — no level is
invented, #988's constraint intact.

**A separate file and a separate leaf, not an effect inside this control.** `EffortDefaultData.tsx`
(`src/renderer/src/screens/conversation/EffortDefaultData.tsx`) holds a pure decision function,
`composerEffortMenuModel`'s own shape one file over, plus a headless `EffortDefaultData(): null` mounted
beside `<ComposerEffortMenu />` in the composer footer. This control is documented as reading no state of
its own beyond what it draws; folding a write policy into it would fuse two unrelated concerns and make
its own tests answer for a decision they do not own. The leaf renders no DOM node, so no footer count,
anchor or geometry assertion anywhere in `e2e/` can see it — and the write path is otherwise untouched:
`changeSetting` → `submitSettingsChange` still sends the one existing single-field `set_session_settings`.

```ts
effortDefaultToApply(input: EffortDefaultInput): string | null
// input = { conversationId, appliedFor, sessionId, effort, model, models, remembered }
```

Six rules, in order, each returning `null` unless every one clears:

1. No chat open (`conversationId === null`) → nothing to apply to.
2. Nothing remembered (`remembered === null`) → AC4's first arm.
3. This chat's opening already had its one attempt (`appliedFor === conversationId`) → AC3's no-retry
   arm and the one-per-chat-opening rule, the same rule.
4. The chat already reports an effort of its own (`effort !== ''`, `selectEffectiveSettings`'s **composed**
   value) → AC2. It has already answered the question this feature exists to answer.
5. No addressable session id (`isAddressableSessionId`, reused from `runSettingsControls` rather than
   restated) → nothing to write to. This is also the cross-chat guard: between #1167's clear on a switch
   and the new chat's reply, this rule stops a default being written into the session the operator just
   left.
6. The remembered level is not among `effortRowFor(models, model)?.effort_levels ?? []`, checked by
   `Array.prototype.includes` — an equality scan, never an object keyed by daemon text — → AC4's second
   arm. Levels are published per model; a level carried over from one model may not exist for the next.
   No fallback, no repair, no normalisation, per this document's own "no fallback, ever" above.

**Rules 3 and 4 are different fabric, and together they are what stops a self-inflicted write loop
against the daemon over the relay.** Rule 4 is the store's composed truth about the session — the
optimistic overlay makes `effort` non-empty in the same synchronous step the send is recorded, so a
second frame from the *same* attempt cannot go out. Rule 3 is this leaf's own record of what it did, kept
in a `useRef` rather than shared state: it is the only guard that survives a **rejection**, since a
rejection rolls the composed effort back to `''` and would otherwise satisfy rule 4 again. The obvious
alternative — gating on `runSettingsWriteStore.error` — is wrong and is recorded as a mistake caught in
review at [Run configuration write store § Remembering the confirmed level](run-settings-write-store.md#remembering-the-confirmed-level-1169):
`changeDispatched` clears `error` on any unrelated field change, so it re-arms the retry rather than
closing it.

**One per chat *opening*, not one per chat ever.** `appliedFor` lives in a `useRef` scoped to this leaf's
mount, so leaving the conversation screen and returning, or switching away and back, resets it — a
deliberate, bounded choice (recorded as an open question in the architecture spec) rather than the
maximal one: a durable per-chat memo would need a conversation-keyed store for a documented upstream
asymmetry (the daemon refusing a level it published) that costs exactly one refused frame per opening and
needs a fresh operator action each time regardless.

**The effect re-reads store state through `getState()` rather than closing over render-time values, for
two independent reasons.** `main.tsx` wraps the app in `React.StrictMode`, which double-invokes an effect
against the *same* closure — a render-time `effort` of `''` would still read `''` on the second
invocation even though the first already dispatched; the `appliedFor` ref closes that independently (a
ref survives StrictMode's simulated remount). And rule 4 needs to be true of the *store*, not of a render
already superseded. `models` is the one exception, read from the render closure rather than `getState()`:
it is in the effect's dependency array so no wake is missed, and zustand hands out the same object
identity across a StrictMode double-invoke, so there is no stale-closure hazard of the kind `getState()`
exists to close for the other four inputs.

**Reaches the launch arguments, never the turn stream.** Since pyrycode#2085 the claude process starts on
the first message while the conversation's session is minted and bound at creation, so a
`set_session_settings` against a never-messaged conversation persists with no child running, and the
first message materialises the child with the setting already composed in. Nothing new on the wire; a
per-message effort field would be the wrong shape.

Mounted at `ConversationScreen.tsx`'s composer footer, `<EffortDefaultData conversationId={activeConversationId} />`,
beside `<ComposerEffortMenu />` — where the conversation id is already in hand and where the leaf's
lifetime matches the open chat's.

## Security

Every string in `effort_levels`, plus `value` used as the join key, is claude-authored text that crossed
the subprocess trust boundary — decoded is not sanitized (see [Model-list store](model-list-store.md)).
The tier is *higher* than the workspace-authored strings the slash-command list holds: no control byte is
measured in these short labels, but one is permitted rather than excluded. Every level reaches exactly one
JSX text position (React's default escaping) plus four non-sink places, all the shared panel's:
`key={option.id}` (React's own keyed reconciliation, a `Map` internally, never a plain-object index — the
`__proto__`-as-key hazard closed by that alone), the `option.id === currentId` string comparison, the
`onSelect` pass-through into the write payload, and an array index. No plain object is keyed by any of it,
and nothing on this path logs. The panel's `aria-label` is the client-owned `COMPOSER_EFFORT_MENU_LABEL =
'Effort'`, naming the panel, never the trigger's visible text; the trigger itself carries no `aria-label`,
so its accessible name stays its visible, auto-escaped text.

**No client-side allowlist is added.** The daemon's inbound validator for effort is a closed enum at the
five measured levels (`low`, `medium`, `high`, `xhigh`, `max`) while the model validator was widened for
these rows — an asymmetry that means a sixth level claude publishes later would be offered here and then
refused on the way back. That is upstream's asymmetry, already recorded at `EffortSection`'s own
cut-marker rationale, and surfaces here as an ordinary rejection rather than a reason to re-mint a client
copy of the vocabulary #976 deleted.

## Testing

Renderer tests are static server renders (CLAUDE.md); `ComposerEffortMenu.test.tsx` covers the view
against `composerEffortMenuModel` directly — all three renderings, exact-equality near-misses on the
model join, the duplicate-published-level case, and every daemon string swept across attribute positions
to confirm none reaches one. The container is proven only at its `ConversationScreen.tsx` mount site,
seeding a non-empty model *and* a non-empty effort so both footer menus render at once — the only way to
pin the row's order (Actions → model → effort → reading) and confirm the popup/anchor counts still hold
at exactly one with no list published.

Two lessons from the e2e drive (`e2e/composer-effort-menu.spec.ts`), extending
[the model menu's own e2e lessons](composer-model-menu.md#testing):

- **The 64px label bound was left as an open question in the plan and closed by the drive rather than by
  review.** With all three footer controls rendered and the effort panel open, the spec asserts
  `.composer__footer` still measures exactly 20px tall and `document.body.scrollWidth <= clientWidth` —
  a permanent detector, not a one-time measurement, and the check that will redden first if a later
  control turns this into the row-overflow ticket after all.
- **One `model_list` frame un-inerts *both* footer menus at once**, which is easy to plan past: the
  footer's `.composer-options-anchor` count moves 1 → 3 → 2 across the drive (Actions alone; then Actions
  + model + effort once the list arrives; then Actions + model once the matched row's levels are pushed
  empty), never 1 → 2 → 1. The 3 → 2 step is what isolates *this* control as the one that went inert — a
  stronger proof of the empty-list reading than asserting the label alone, which is unchanged across that
  push by design.

`e2e/composer-model-menu.spec.ts`'s two counted footer assertions, `e2e/composer-options-clamp.spec.ts`'s
anchor scoping, and `e2e/composer-actions.spec.ts` were all run rather than reasoned about, and all pass
unedited — the first two because they sit before their own `model_list` push, where this control is still
inert.

See [PR #1019](https://github.com/pyrycode/pyrycode-desktop/pull/1019) and
`docs/specs/architecture/989-composer-effort-menu.md` for the full plan, its security review, and its
`## Revisions` entry recording the two e2e lessons above.

### Testing the default apply (#1169)

`EffortDefaultData.test.tsx` covers `effortDefaultToApply` as a table — each of the six rules returning
`null` in isolation, the one path returning the level, the empty-model row substitution (#1168's
`effortRowFor`) reaching the `default` row's levels, and a near-miss level (a published level absent
from the remembered one's model) returning `null` — plus a smoke render proving the leaf emits no
markup. The write-loop guard is pinned against the **real** `runSettingsWriteStore` rather than a
hand-built input, since a hand-built `effort: 'x'` would assert a belief about the composition rather than
the composition itself: dispatch → confirm → assert refused (rule 4), dispatch → reject → assert refused
(rule 3, the marker) → dispatch an **unrelated** model change → assert still refused, which is the
regression the security review's MUST FIX named.

`e2e/composer-effort-default.spec.ts` (fake tier) is a **three**-chat drive, not two — the plan originally
called for two and the shipped spec's own header records why a third was added. Chat A reports an effort
of its own and is where a level is picked and confirmed (writing the remembered level); chat B reports
none and is where the remembered level must be applied, exactly once, naming B's session; chat C reports
an effort of its own *while something is already remembered*, and must be left alone. C is load-bearing:
without it, A's own "nothing was sent yet" reading at launch is vacuous, since nothing is remembered
either at that point — the assertion would pass with the whole feature deleted. Detected instead by the
frame count on chat A jumping the moment a rule-4-less build would fire (2, not 0) the instant A's own
confirm lands.

`e2e/real-claude-effort-default.spec.ts` (real-claude tier, AC5) proves the one thing the fake tier
cannot: that a `set_session_settings` against a **never-messaged** conversation persists with no claude
child running and is composed into the child's launch arguments on its first message (the pyrycode#2085
premise this whole feature rests on), and that no `/effort` line appears in the thread. It drives its one
real turn through the harness's **seeded** row rather than a FAB-created chat, because a never-messaged
conversation's published levels can only come from the daemon's connect-time or on-demand model-list
fallback (pyrycode#2124/#2125), whose source is the *bootstrap* session's retained list — and the harness
binds only the seeded row to that bootstrap session. Getting this spec green needed four real-environment
fixes, none of them a production change, recorded in the architecture spec's `## Revisions`: two vacuous
turn-quiesce gates (a closing `toHaveCount(0)` that resolves before the send does anything, and a
`nonEmptyAssistantCount >= 1` gate that is sound only in a chat proven empty, which the seeded row is not),
a stale gate-host daemon binary lacking the model-list fallback the drive depends on, diagnosed from
the binary's own symbols rather than assumed, and — the last of the four, \#1266 — the seeded row's
effort-segment read riding on an unsolicited push rather than a request. The client asks for a
conversation's model list exactly once per activation, and the drive activates the seeded row *before*
turn 1, when the bootstrap session has no claude child yet; that ask comes back empty, so the read used
to depend entirely on the daemon's unsolicited, best-effort `model_list` push landing inside the 15 s
round-trip window — a roughly 1-in-15 flake that presented as a stale-daemon timeout with no daemon fault
behind it. The fix re-clicks the already-open seeded row between turn 1's quiesce and the sheet open:
`activateConversation`'s `requestConversationConfig` sits outside its changed-id gate, so a same-id click
re-fires `requestModelList` without disturbing the settled turn, the session id or the run configuration
— while `requestOpeningHistory`'s own per-conversation gate stops its non-idempotent prepend from
running twice. This is a *request*, not a retry loop: `modelListStore`'s ask-once-never-retry posture is
untouched, and the drive causes exactly one extra ask rather than polling. See
[PR #1280](https://github.com/pyrycode/pyrycode-desktop/pull/1280) and
`docs/specs/architecture/1266-ask-for-the-seeded-chats-vocabulary.md`.
