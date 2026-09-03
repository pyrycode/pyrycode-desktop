# Composer model menu (#988)

The footer's second live control, immediately right of [the Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)
(Figma `115:3683`, x=135 in the design though not yet in the built row — see below). Part of
[Conversation shell — composer](conversation-shell-composer.md#composer-footer-row-811); see that
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

`ComposerModelMenu.tsx` exports a pure `composerModelMenuModel(models, model): ComposerModelMenuModel | null`
that turns the two inputs into everything the view needs (`label`, `options`, `currentId`), so every rule
below is unit-testable as data rather than only through markup — the same property `COMPOSER_ACTIONS`
buys `ComposerActionsMenu`, adapted to entries that are the daemon's rather than the client's. A static
render can never open the panel, so without this extraction the entries would only be assertable
indirectly.

| Input | Rendering |
|---|---|
| `model === ''` (no run-config snapshot has arrived, or the session is on the daemon's inherited default) | `null` — nothing in the row |
| `model !== ''`, and `models` is `null` or `models.models` is empty | an inert `<span>`: the label, no chevron, no role, no tabindex, no handler, no `.composer-options-anchor` |
| `model !== ''` and rows are present | `ComposerOptionsMenu` with the rows as options |

The first rendering is not in the ACs; it is this ticket's own decision, taken because it is otherwise
reachable in the app's ordinary startup window (see § Turn-end dependency below). `ContextUsageControl`
takes the identical posture for its own unavailable reading, and #811's no-placeholder rule points the
same way — rendering nothing invents no name for the daemon's own held-verbatim `''` ("inherited
default").

The second rendering is AC4, and it cannot be `options={[]}`: `ComposerOptionsMenu` renders
`aria-haspopup="menu"` and `aria-expanded` unconditionally and would open exactly the empty panel AC4
forbids. The chevron is omitted deliberately on this arm — it is the design's "this opens a panel" mark,
and drawing it over an element that opens nothing is the visual half of the claim AC4 refuses. The class
that draws it (`composer__footer-button`) carries no `cursor: pointer`, so the inert arm doesn't lie about
being clickable either — see § CSS extraction.

**The label:** `row ? row.display_name : model`, mirroring `RunningModelSection`'s expression exactly
rather than `row?.display_name ?? model`, which would treat a matched row's empty `display_name` as a
miss. The match is `publishedRowFor(models, model)` — the one exported home for the rule, now exported for
this, its third caller (`RunConfigSections.tsx`, docblock updated to name it). The input is the **session's**
model, `EffortSection`'s reading, not `RunningModelSection`'s announced-per-turn one — a distinction that
doc's own text calls out as the easy mistake to make. A miss is ordinary, not an error: the model value
renders verbatim.

**The options:** `entry.models.map((row) => ({ id: row.value, label: row.display_name }))`, exactly the
published rows, in the daemon's order — nothing deduped, dropped, reordered or synthesized, per AC2. `id`
is the row's `value`, so `onSelect(id)` submits it with no lookup. Two rows may legitimately share a
`value` (claude's prerogative, per the store's own header); both are carried and both wear
`aria-current`, accepted rather than fixed, since AC2's "exactly the published rows" outranks a tidier
list.

**The marking:** `currentId={row ? row.value : null}` — the value the label matched on, not the raw
`model` string. This is the panel's first consumer to pass a non-null `currentId` (`ComposerActionsMenu`
passes `null`: "a list of actions, not a choice"). A miss marks nothing, through the panel's existing
no-special-case branch.

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

The run-config snapshot is requested only on the `connected` edge — which lands before a conversation is
active, so the request sends nothing — and at each turn end (`runConfigLive`). A fresh app launch
therefore has **no** snapshot: `effective.model` is `''`, and this control correctly renders nothing. The
[context-usage reading](conversation-shell-composer.md#composer-footer-row-811) beside it has the exact
same dependency and is absent for the exact same reason on a fresh launch. An e2e drive against either
control needs a turn end first — an unsolicited `turn_state` thinking → idle pair, a frame the daemon
sends unprovoked, keeping the "no manufactured inputs" rule intact. A lone `idle` push fires nothing:
the refresh trigger is a running→idle *transition*, and `Set.delete` on an id that was never inserted
returns `false`.

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
by the daemon but not sanitized (see [Model-list store](model-list-store.md)). Each reaches exactly one
JSX text position (React's default escaping); `value` additionally reaches `key={option.id}` (React's own
keyed reconciliation — a `Map` internally, not a plain-object index), a string comparison against
`currentId`, and the `onSelect` pass-through into the write payload — no attribute, URL, filename, cache
key, lookup path or log line, on any branch. The panel's `aria-label` is a client-owned constant
(`COMPOSER_MODEL_MENU_LABEL = 'Model'`) naming the panel, never the trigger's visible text — unlike
`ComposerActionsMenu`, this trigger cannot use its own label as `aria-label`, since that label is
daemon-authored and `aria-label` is an attribute sink CLAUDE.md's daemon-text ruling forbids outright. The
trigger itself carries no `aria-label` at all, so its accessible name stays its visible (auto-escaped)
text.

This menu deliberately surfaces neither of `ModelListEntry`'s two truncation reports
(`truncated_fields`, `droppedModels`) — the run-configuration sheet remains the surface that reports a
cut list; withholding a report here is a completeness question the sheet already answers, not a leak.

## A follow-up noted, not filed

A session on the daemon's inherited default (`model === ''`) has no footer model control at all, even
once a list has arrived — the run-configuration sheet is the only way in for that state. Every
alternative collides with a stated rule: an empty label beside a chevron invents a false affordance, and
client copy naming a model concept is exactly what AC2 forbids. Worth a ticket if the inherited-default
state turns out to be common in practice; the current behavior is this ticket's explicit decision, not an
oversight.

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

See [PR #1018](https://github.com/pyrycode/pyrycode-desktop/pull/1018) and
`docs/specs/architecture/988-composer-model-menu.md` for the full plan, its security review, and its
`## Revisions` entry recording the `composerModelMenuModel` extraction and the 120px measurement.
