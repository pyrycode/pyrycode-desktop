# Composer model menu (#988)

The footer's second live control, immediately right of [the Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)
(Figma `115:3683`, x=135 in the design though not yet in the built row — see below). Part of
[Conversation shell — composer](conversation-shell-composer-message-box.md#composer-footer-row-811); see that
document's footer-row section for the row's geometry and no-placeholder rule.

Everything under this control was already built and dormant: the shared
[options panel](conversation-shell-composer-options-panel.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)
(#838/#839/#840), the daemon-published rows in [Model-list store](model-list-store.md) (#974), the
single-field write in [`changeSetting`](session-settings-send.md) (#256), and the exact-equality match
rule in [Run configuration Model section](conversation-shell-workspace-and-run-config.md#run-configuration-model-section-daemon-published-rows-975)
(#560/#975/#976). This ticket adds three things: the entries, the trigger's label, and what picking one
does — plus two one-time family costs that land on whichever footer menu goes second (this one, since
\#682's permission-mode button was sequenced behind it): the shared `.composer__footer-button` extraction,
and a correction to three sites that had rested on "exactly one `.composer-options-anchor` exists."

**Position.** The design puts the permission-mode button (#682) between Actions and this one. At the time
this ticket shipped #682 hadn't landed yet, so the trigger mounted immediately right of Actions with no
spacer and no placeholder held open for it — #811's rule, reapplied. [#682](composer-permission-mode-menu.md)
has since landed and inserted itself between the two, as this section always said it would; this trigger is
now the row's **third** item, not its second.

## `composerModelMenuModel`, one pure function deciding all three renderings

`ComposerModelMenu.tsx` exports a pure
`composerModelMenuModel(models, layers: ComposerModelLayers): ComposerModelMenuModel | null` that turns
the inputs into everything the view needs (`label`, `options`, `currentId`), so every rule below is
unit-testable as data rather than only through markup — the same property `COMPOSER_ACTIONS` buys
`ComposerActionsMenu`, adapted to entries that are the daemon's rather than the client's. A static render
can never open the panel, so without this extraction the entries would only be assertable indirectly.

**`ComposerModelLayers` (#1053)** replaced a single `model: string` parameter with three, resolved in this
fixed order — a pending-or-confirmed **pick** made in this client, then what claude **announced** for the
running turn, then the snapshot's **stored** explicit choice:

```ts
export interface ComposerModelLayers {
  picked: string      // pending optimistic over client-confirmed; '' = no pick in force
  announced: string    // claude's identifier for the running turn; '' = none, or a degenerate one
  stored: string       // the run-config snapshot's stored choice; '' = the daemon's inherited default
}
```

`''` means "nothing at this layer", uniformly across all three — this control's existing posture (it
already drew nothing for an unset session model) rather than a new decision, and it is what lets the
container collapse `AnnouncedModel | null` from `announcedModelStore` to a plain string: a `null`
announcement and a `{ model: '' }` one both read as "nothing here", which is the only distinction this
surface could draw anyway. The store's own `null`-vs-`''` contract stays intact where it is established —
[Announced-model store](announced-model-store.md) and the run-configuration sheet still read it.

**The announcement is ranked below a pick and above the stored choice, deliberately not above a
confirmed pick.** A held announcement carries no sequence or timestamp, so it carries no information
about whether it is older or newer than a pick — ranking it above a *confirmed* pick would let a stale
pre-pick announcement beat the pick the instant the daemon confirms it, making a confirm and a rejection
render identically. `announcedModelStore` keyed itself by conversation in #1146, and that left this
property true per key: each conversation's held record is still the bare two fields, with nothing added
to date or order it against a pick made in the same chat. The ordering is a client-side judgment call,
not something the daemon's frames can settle.

| Input | Rendering |
|---|---|
| no layer has anything (`picked === announced === stored === ''`) | `null` — nothing in the row |
| something to show, and `models` is `null` or `models.models` is empty | an inert `<span>`: the label, no chevron, no role, no tabindex, no handler, no `.composer-options-anchor` |
| something to show and rows are present | `ComposerOptionsMenu` with the rows as options |

The first rendering is not in #988's ACs; it was that ticket's own decision, taken because it is otherwise
reachable in the app's ordinary startup window (see § Turn-end dependency below), and #1053's AC4 widened
its criterion from "the session's model is unset" to "no layer has anything" without changing its shape —
a session on the daemon's inherited default with no announcement yet sits in this state permanently, which
is the state #1053 exists to get the control out of once an announcement arrives. `ContextUsageControl`
takes the identical posture for its own unavailable reading, and #811's no-placeholder rule points the
same way — rendering nothing invents no name for the daemon's own held-verbatim `''` ("inherited
default").

The second rendering is AC4, and it cannot be `options={[]}`: `ComposerOptionsMenu` renders
`aria-haspopup="menu"` and `aria-expanded` unconditionally and would open exactly the empty panel AC4
forbids. The chevron is omitted deliberately on this arm — it is the design's "this opens a panel" mark,
and drawing it over an element that opens nothing is the visual half of the claim AC4 refuses. The class
that draws it (`composer__footer-button`) carries no `cursor: pointer`, so the inert arm doesn't lie about
being clickable either — see § CSS extraction.

**The label, since #1095, is a family, not the published prose.** `row ? row.display_name : shown` — the
expression above, mirroring `RunningModelSection`'s exactly rather than `row?.display_name ?? shown` (which
would treat a matched row's empty `display_name` as a miss) — is now only the **fallback** (`verbatim`
below), reached when nothing derives a family. The match is still `publishedRowFor(models, shown)` — the
one exported home for the rule, exported since #988 for its third caller (`RunConfigSections.tsx`) and
reused by #1053 for a fourth. A miss is ordinary, not an error: since #1053, it is also the *common* case
for an announcement, which claude reports at least as specific an identifier as it was given.

Juhana ruled on 2026-09-05 that this control shows the family and nothing else — no version, no date, no
context size, since those are always the newest and so carry no information here. `modelFamily(identifier)`
(module-private, beside `firstShown`) is the whole rule: strip one leading `claude-` if present, take the
leading run of ASCII letters, upper-case its first letter, hold the rest as claude sent them; `''` when
nothing matches. `''` is the same "nothing here" `firstShown` already consumes, so the source chain composes
with it rather than adding a second nullability idiom. There is no allow-list — a family this client has
never heard of (`claude-newname-6`) derives through the same rule as a known one, which is what keeps #988's
AC2 ("no client copy naming a model concept") intact; the one client-owned literal on this path is the
`claude-` prefix itself, a vendor-prefix strip rather than a vocabulary.

The trigger's source chain, on a hit: `firstShown(modelFamily(row.resolved_model), modelFamily(row.value))`,
falling back to `verbatim = row ? row.display_name : shown` when both derive `''`. On a miss:
`modelFamily(shown)`, falling back to `shown` itself. `resolved_model` leads because the trigger's job is to
name what **runs**, and it is the field naming the concrete identifier behind an alias like `default`; the
`value` step is an ordinary second source rather than a guard against an unseen case — the captured fixture
`WireModelOption`'s docblock cites carries the literal `<unmeasured>` on four of its five rows, whose head is
`<` and so yields `''`.

**The marking (`currentId`) is a second, separate lookup (#1053):** `publishedRowFor(models, session)`
where `session` is the first non-empty of picked and stored — **never** the announcement. The label and
the marking read different layer-sets on purpose: the label answers "what's shown", the marking answers
"what would picking do nothing" / "what is the daemon actually set to", and the daemon is set to what the
session says, never to what claude reported running. The two collapse to the same row whenever a pick is
in force and differ exactly in the state #1053 exists for (an announcement with no pick and no stored
choice: the label shows the announcement, nothing is marked current). Exact equality stays the whole rule
for this lookup too, including its edge case: a daemon publishing a row whose `value` is `''` would have
that row marked current on an inherited-default session with no pick — the lookup answering honestly,
not a case this code guards against.

**The options:** `entry.models.map((row) => ({ id: row.value, label: ... }))`, exactly the published rows,
in the daemon's order — nothing deduped, dropped, reordered or synthesized, per AC2. `id` is the row's
`value`, so `onSelect(id)` submits it with no lookup. Two rows may legitimately share a `value` (claude's
prerogative, per the store's own header); both are carried and both wear `aria-current`, accepted rather
than fixed, since AC2's "exactly the published rows" outranks a tidier list.

**Since #1095, each row's `label` is `modelFamily(published.value)`, falling back to `published.display_name`
when that derives `''`.** A row reads its own `value` and **never** `resolved_model` — the opposite of the
trigger, deliberately: a row's job is to name a *choice*, and `default` is its own choice. Derived from
`resolved_model` it would wear the label of the row it resolves to (`claude-sonnet-5` → `Sonnet`), and the
panel would show two identical rows submitting different values; from `value` it reads `Default`, the
daemon's own word capitalised. Two rows that derive to the same family are both shown, per AC2, and each
still submits its own `value` — the derivation changes nothing about which rows exist or what they send.

This is the panel's first consumer to pass a non-null `currentId` (`ComposerActionsMenu` passes `null`:
"a list of actions, not a choice"). A miss marks nothing, through the panel's existing no-special-case
branch. See above for what `currentId` resolves against since #1053 (the session layers, never the
announcement).

## The write

`onSelect` calls `changeSetting({ sessionId, sendCommand: window.pyry.sendCommand, dispatch }, { field: 'model', value })`
— the same single-field write path the run-configuration sheet uses. `window.pyry` is dereferenced only
inside this arrow, at interaction time, never during render (hoisting it would break every container
smoke test under `renderToStaticMarkup`, where the bridge doesn't exist).

**AC3's "sends nothing when there is no addressable session id" is met by `changeSetting`'s own gate, not
by withholding the handler** — a deliberate departure from the sheet, which withholds `onChange` because
its view branches *operability* on handler presence. This view branches operability on the rows (AC4).
Withholding the handler here would fuse two unrelated conditions into one rendering and make a
session-less-but-populated menu unopenable, which no AC asks for.

Picking a row moves the trigger's label to the optimistic value at once and reverts it if the change is
rejected — not local state: `selectEffectiveSettings`'s pending-overlay-over-confirmed-over-snapshot
composition is what moves it, and the same composition reverts it when the store drops the pending record
on rejection. This menu says nothing more on a rejection: the row has a hard 20px height with no slot for
an error line, and the sheet already names the rejection. This trigger also does not read
`supports_auto_mode` and does not touch the permission mode — `SettingsChange` has no such field to send,
and that control belongs to #682.

## Turn-end dependency, shared with the context reading

The run-config snapshot used to be requested only on the `connected` edge — which lands before a
conversation is active, so that request sent nothing — and at each turn end (`runConfigLive`); a fresh
app launch therefore had **no** snapshot until a turn had run to completion, and this control correctly
rendered nothing until then. **Since [#1166](https://github.com/pyrycode/pyrycode-desktop/issues/1166), a
third edge exists: opening a conversation.** `activateConversation` fires the same
`requestRunConfigSnapshot` sender (alongside a new model-list request, see [Model-list
store](model-list-store.md)) on every activation, including a re-open of the chat already open — see
[Paired shell — conversation exits and stamps § The run-configuration and model-list
ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166).
A fresh launch now shows this control's stored-choice reading immediately, populated from the opened
conversation's own bound session — the daemon has answered a never-messaged conversation with its real
values since pyrycode#2085, which is what makes asking on open worth doing. The
[context-usage reading](conversation-shell-composer-message-box.md#composer-footer-row-811) beside it shares the
identical dependency and is populated on the same edge for the same reason.

The `connected` and turn-end edges are unchanged by #1166 and still fire exactly as before — an e2e drive
proving either edge in isolation still needs a turn end (an unsolicited `turn_state` thinking → idle pair;
a lone `idle` push fires nothing, since the refresh trigger is a running→idle *transition* and
`Set.delete` on an id never inserted returns `false`) or a fresh `connected` frame. What changed is only
that a drive no longer needs either edge just to get *a* snapshot onto the screen — the activation that
opens the conversation already supplied one.

## CSS: the shared footer-button treatment, lifted on its second consumer

`conversation.css`'s `.composer__actions` comment named this moment before it happened: "One consumer is
not a pattern... the SECOND button is the moment to lift the common declarations out of these two
rules." This ticket is that second button (#682 is sequenced behind it), so the reset, the body-small
type block, `color: var(--color-primary)` and `white-space: nowrap` move into a new
`.composer__footer-button`, worn as a two-class mix (`class="composer__footer-button composer__actions"` /
`"composer__footer-button composer__model"`) — [`.button-small`'s](conversation-shell-composer.md) shape
on the same stylesheet, on its own second consumer under #963.

**`cursor: pointer` is deliberately not in the shared rule.** It stays declared per-consumer
(`.composer__actions { cursor: pointer }`, `.composer__model { cursor: pointer }`) because this ticket's
own inert arm (AC4) wears `.composer__footer-button` on a `<span>` that opens nothing — a shared hand
cursor would make that a lie.

**`white-space: nowrap` lifts, but `.composer__actions`'s *justification* for it does not carry over.**
That rule rests nowrap on "the label is a client-owned constant"; this trigger's label is
claude-authored, bounded by the daemon but not sanitized by it. What actually bounds this label is
`.composer__model-label`: `min-width: 0` (so the ellipsis is reachable at all — a flex item's default
`min-width: auto` refuses to shrink below its content), `max-width: 120px`, `overflow: hidden`,
`text-overflow: ellipsis`. 120px is derived from the row's budget at the app's 800px minimum window
(~400px chat pane, less padding, the Actions trigger, the nowrap context reading and two gaps leaves
~185px), then measured in the running app against a 56-character published display name: the row stayed
exactly 20px tall, the label ellipsized, no horizontal overflow, and the context reading kept its full
width.

`.composer__actions-icon`'s single declaration (`flex: 0 0 auto`) is **not** lifted alongside the button
rule — the standing comment assigned the button extraction only, and the glyph rule carries no such note.
`.composer__model-icon` repeats it verbatim instead. `.composer__actions`'s `white-space: nowrap`
declaration is now `.composer__footer-button`'s; the comment on the extracted rule records both what
transferred and what didn't.

## The `.composer-options-anchor` uniqueness invariant is now conditional

`ComposerOptionsMenu` renders `.composer-options-anchor` unconditionally, and this menu is the app's
second live host of the shared panel — so a second anchor now renders whenever a model list has arrived
for the open conversation. Three sites had rested on "exactly one exists in the app," all corrected by
this ticket:

- `e2e/composer-options-clamp.spec.ts`'s locator, previously bare, is re-scoped to the Actions trigger's
  own anchor (`has:` the exact-named button); its measurements are untouched.
- `conversation.css`'s `.composer__row` comment (declining to add the class there) drops the spent
  "exactly one" reason; the decision itself stands independently (the class carries only
  `position: relative` / `display: flex`, which the row already has).
- `ConversationScreen.tsx`'s JSX comment above `.composer__row`, which had repeated the same reasoning
  verbatim, is corrected alongside it.

**The invariant was already conditional before this ticket landed, not just after** — with no
`model_list` ever pushed, this control's own inert arm (AC4) emits no anchor at all, so the clamp spec's
bare locator would in fact still have resolved exactly one by accident of what that spec's launch state
seeds. It was re-anchored anyway, because the comment's claim ("exactly one exists") is unconditionally
false once any spec or any real session receives a model list, and a locator that only survives by
accident of a fixture's launch state is the wrong thing to leave in place.

## Security

`display_name` and `value` are claude-authored text that crossed the subprocess trust boundary, bounded
by the daemon but not sanitized (see [Model-list store](model-list-store.md)). Since #1053, the
**announced** identifier crosses the same boundary and is bounded the same way, by
[Announced-model store](announced-model-store.md)'s producer (256 bytes) rather than sanitized. Each of
the three reaches exactly one JSX text position (React's default escaping); `value` additionally reaches
`key={option.id}` (React's own keyed reconciliation — a `Map` internally, not a plain-object index), a
string comparison against `currentId`, and the `onSelect` pass-through into the write payload — no
attribute, URL, filename, cache key, lookup path or log line, on any branch. The announced identifier's
only other use is as a lookup **argument** to `publishedRowFor` (a `find` with `===` over an array, never
a plain-object index) — it is a REPORT, never a control input: nothing branches on its content beyond
`=== ''`, and `onSelect` still dispatches only a value a published row itself carries, never the announced
string, so a hostile daemon cannot make this control send a value it did not itself publish. The panel's
`aria-label` is a client-owned constant (`COMPOSER_MODEL_MENU_LABEL = 'Model'`) naming the panel, never the
trigger's visible text — unlike `ComposerActionsMenu`, this trigger cannot use its own label as
`aria-label`, since that label is daemon-authored and `aria-label` is an attribute sink CLAUDE.md's
daemon-text ruling forbids outright. The trigger itself carries no `aria-label` at all, so its accessible
name stays its visible (auto-escaped) text. No `title` tooltip either, for the same reason — the 120px
label cap (§ CSS below) still clips a long announced identifier with no fallback surface; the
run-configuration sheet stays the full reading.

**Since #1095, both text positions usually carry a derived family instead of the published prose or the raw
identifier — strictly less exposure, not more.** `modelFamily` is a view-side transform on a held-verbatim
value, the same tier as `.composer__model-label`'s CSS ellipsis one element up: it does not sanitize and
does not claim to, the store still holds every string verbatim, and React still escapes the one text
position each label reaches. A family is a `[A-Za-z]+` prefix with one character upper-cased, so a control
byte or a terminal escape can reach the DOM only through the unchanged verbatim fallback — the same path
that carried it before this ticket. Nothing feeds a derived label back into a lookup: `publishedRowFor` is
still called with the raw string, `currentId` is still a raw published `value`, and `onSelect` still
dispatches a value a row carries; the only branch on a derived label is `=== ''`, on the client's own
answer. The standing "`value` is not parseable" prohibition in `modelListStore.ts`, `shared/ipc/events.ts`
and `shared/wire/types.ts` is re-scoped rather than deleted by this ticket: it stays absolute about
matching, indexing and keying — deriving a display label is none of those three, and a consumer deriving a
family for any other purpose is still doing the forbidden thing.

This menu deliberately surfaces neither of `ModelListEntry`'s two truncation reports
(`truncated_fields`, `droppedModels`), nor `announcedModelStore`'s own `truncated` cut report — the
run-configuration sheet remains the surface that reports a cut; withholding a report here is a
completeness question the sheet already answers, not a leak.

## The follow-up this ticket answered

\#988 left a gap, noted but not filed: a session on the daemon's inherited default (`model === ''`) had no
footer model control at all, even once a list had arrived — the run-configuration sheet was the only way
in for that state. #1053 closed it by layering in the value held in
[Announced-model store](announced-model-store.md) — what claude announced for the running turn (see
§ `ComposerModelLayers` above) — rather than by inventing an
empty-label affordance or client copy naming a model concept — both of which #988's own reasoning had
already ruled out. The gap is closed for the state it was filed from; it reopens only if the daemon stops
announcing (an app-lifetime `announcedModelStore` clear followed by no new turn), which is already covered
by AC4's "nothing at any layer" rendering.

## Testing

Renderer tests are static server renders (CLAUDE.md); `ComposerModelMenu.test.tsx` covers the view against
`composerModelMenuModel` directly (each of the three renderings, four explicit near-misses — case fold,
prefix, superstring, surrounding whitespace — all failing to match on purpose, and the duplicate-`value`
case). The container is proven only at its `ConversationScreen.tsx` mount site. The pinned mount order was
Actions → this trigger → the context reading at the time this ticket shipped; since
[#682](composer-permission-mode-menu.md) landed the order is Actions → permission mode → this trigger →
effort → the context reading, and the anchor/`aria-haspopup` counts that ticket's own tests pin moved from
one to two accordingly.

Two lessons from the e2e drive (`e2e/composer-model-menu.spec.ts`), useful to any future footer control
reading the same stores:

- **An optimistic overlay is unobservable against the in-process loopback fake if the fake answers the
  request in the same frame as the click** — there is no intermediate state left to assert against. The
  rejection half of AC3 is driven by withholding the reply from `buildReplyFrames` and instead pushing a
  correlated `error` frame from the test body, addressed by the envelope id read back off the capture.
  That makes the optimistic label a stable, assertable state and the revert a distinct second one.
- **A whole-attribute-run class assertion silently loses its coverage when the class becomes a two-class
  mix.** `ConversationScreen.test.tsx`'s "the trigger is not disabled" guard extracted the trigger tag
  with `match(...)?.[0] ?? ''`; once `.composer__actions` became `"composer__footer-button
  composer__actions"`, the guard would have degenerated to `expect('').not.toContain('disabled')` —
  passing, with the guard silently gone. Both extractors this ticket touches now assert they matched
  before asserting an absence, rather than trusting an empty-string fallback to fail loudly on its own.

There is no vitest detector for stylesheet declarations; the CSS extraction above is proven by the
class-run assertions plus review, the standing ruling for this stylesheet.

**#1053's layering** moved the nine existing `composerModelMenuModel` call sites in
`ComposerModelMenu.test.tsx` onto a `stored(...)` helper that builds a `ComposerModelLayers` record with
the other two layers empty, so every rule #988 shipped keeps asserting exactly what it asserted; the
`view` helper's six call sites needed no edit, since it builds the same record internally. New cases cover
the announcement resolving to a label with no pick and no stored choice, the announcement outranking a
stored choice that names a *different* row (label and `currentId` diverge — the pair a single-string
model couldn't represent), a pick outranking both, and the all-empty-layers `null` case.

A new e2e spec, `e2e/composer-model-announced.spec.ts`, drives the ordering directly rather than
extending `composer-model-menu.spec.ts` (whose drive is ordered around *not* having an announcement). At
the time this spec was written, a fresh launch had no run-config snapshot at all, so `model_announced`
pushed unsolicited before any snapshot existed was the only way to show the control with no turn-end
dance needed — proof the announcement alone is sufficient, unlike every other snapshot-dependent control
on this row (see § Turn-end dependency). **Since #1166** the launch itself supplies a snapshot, so the
spec's launch-state assertion became a presence check (the stored choice, not an empty label) and its
step proving the announcement outranks a later stored choice moved from an absence-based barrier to
`expect.poll`-counting the captured `request_session_settings` envelopes — see [Paired shell —
conversation exits and stamps § The run-configuration and model-list
ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166)
for why an absence barrier stopped being available. `model_list` still resolves the label to a display
name; a `turn_state` thinking → idle pair still brings in a *different* stored choice without moving the
label off the announcement; and a picked third row still moves the label at once and reverts to the
announcement (not to the stored choice) on a withheld-reply, correlated-`error`-frame rejection — the same
optimistic-overlay idiom above, proving where a reverted pick lands when an announcement is present.

**#1095 turned the published-prose label into a derived family**, and with it, both e2e specs' miss→hit
step (published rows arrive; the label moves off the launch-state string) went vacuous: every alias in
`MODEL_ROWS` matched its own family by construction, so both sides of the transition rendered the same
family and the assertion passed whether or not the row lookup ran. The only re-anchor is a row whose
`value` and `resolved_model` name *different* families — `default`, resolving to `claude-sonnet-5`, is the
**only** published value with that property, since every other alias derives its own family from itself.
Both `composer-model-menu.spec.ts` and `composer-model-announced.spec.ts` replaced one row with
`default` / `claude-sonnet-5`, so the label reads `Default` before the list and `Sonnet` after — an
observable move only a real row lookup produces. This was not a convenient choice; it was the only one
available, which is worth stating in a spec so a later edit doesn't swap the anchor row for a tidier one
that quietly loses the property.

**A label narrowing can disarm a spec that used the label as a settle signal, with no test list to catch
it.** `e2e/composer-permission-mode-auto.spec.ts` waits on `.composer__model-label` twice to prove a
`model_list` frame landed, and it wasn't on this ticket's own "tests that change" list — it surfaced only
from grepping the label's class across all of `e2e/`. Once its two rows' `display_name`s collapsed to one
family, both waits passed before the frame arrived and the drive's last step lost its only barrier, with no
assertion going red. Fixed by giving those two rows `resolved_model` values that derive to distinct
families (`Refusing` / `Relenting`), restoring an observable change at each tick. The general lesson: grep
the *rendered element* of anything whose text is being narrowed, not just the specs that exercise the
component directly.

**`ComposerModelMenu.test.tsx`'s invented-fixture-identities discipline (see #988 below) inverted rather
than expired under this ticket.** The file uses invented tokens (never a real model name) so a bug that
derives a label from a hardcoded family vocabulary can't hide behind a coincidentally-correct real one.
\#1095 *adds* a derivation, which reads like the moment that discipline stops mattering — but the bug it
guards against is exactly an allow-list of known families, which an invented family (`claude-alpha-5`)
still catches and a real one would hide. Same discipline, opposite-seeming ticket, unchanged reason.

See [PR #1018](https://github.com/pyrycode/pyrycode-desktop/pull/1018) and
`docs/specs/architecture/988-composer-model-menu.md` for #988's full plan, its security review, and its
`## Revisions` entry recording the `composerModelMenuModel` extraction and the 120px measurement. See
`docs/specs/architecture/1053-footer-model-announced-layer.md` for #1053's plan and security review, and
`docs/specs/architecture/1095-model-family-only-in-the-footer.md` for #1095's plan, security review and
`## Revisions` entry.
