# Composer model menu (#988)

The footer's second live control, immediately right of [the Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)
(Figma `115:3683`, x=135 in the design though not yet in the built row — see below). Part of
[Conversation shell — composer](conversation-shell-composer-message-box.md#composer-footer-row-811); see that
document's footer-row section for the row's geometry and no-placeholder rule.

Everything under this control was already built and dormant: the shared
[options panel](conversation-shell-composer-options-panel.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)
(#838/#839/#840), the daemon-published rows in [Model-list store](model-list-store.md) (#974), the
single-field write in [`changeSetting`](session-settings-send.md) (#256), and the exact-equality match
rule in [Run configuration Model section](conversation-shell-run-configuration.md#run-configuration-model-section-daemon-published-rows-975)
(#560/#975/#976). This ticket adds three things: the entries, the trigger's label, and what picking one
does — plus two one-time family costs that land on whichever footer menu goes second (this one, since
\#682's permission-mode button was sequenced behind it): the shared `.composer__footer-button` extraction,
and a correction to three sites that had rested on "exactly one `.composer-options-anchor` exists."

**Position.** The design puts the permission-mode button (#682) between Actions and this one. At the time
this ticket shipped #682 hadn't landed yet, so the trigger mounted immediately right of Actions with no
spacer and no placeholder held open for it — #811's rule, reapplied. [#682](composer-permission-mode-menu.md)
has since landed and inserted itself between the two, as this section always said it would; this trigger is
now the row's **third** item, not its second.

## Availability during question batches

While a question batch is open, `ComposerSlot` mounts this menu in a model-only
`.composer__footer` immediately beneath the questionnaire (#1252). It uses the same
published options and label layers as the ordinary footer, including the inert and
absent renderings described below. Mouse and keyboard access work at the 800px minimum
window width.

The original composer stays mounted and hidden, retaining its draft and covering send,
actions, effort, permission mode and attachments. The keyed question panel stays mounted
too: a model pick or settings response preserves the batch, active question, selections
and Other text. [Continue](question-panel-continue-answer.md) answers that original batch;
closing it reveals the preserved composer draft.

Picking an own-agent model uses the existing model-only `set_session_settings` write for
the active session, without sending a chat turn or resolving the question. The own-agent write relies on
[daemon control-request delivery](https://github.com/pyrycode/pyrycode/issues/2280), which
can reach the child while it is waiting for an answer. The optimistic label and rollback
remain immediate; availability during questions adds no wait-for-next-turn label policy.
An other-agent row uses the confirmed switch path below.

## `composerModelMenuModel`, one pure function deciding all three renderings

`composerModelMenuModel(models, layers, agent, pendingSwitchRow?)` decides the footer label, visible options and
`currentId`. The [Run configuration sheet](conversation-shell-run-configuration.md#run-configuration-model-section-daemon-published-rows-975)
uses the same decision for its Model radios. Keep these inputs separate:

```ts
export interface ComposerModelLayers {
  picked: string       // pending optimistic choice over client-confirmed choice; '' = no pick
  announced: string    // this conversation's running-turn identifier; '' = no announcement
  stored: string | null // saved model; ''/default = inherited, null = no snapshot
}
```

The container obtains `picked` through `selectEffectiveSettings(null, writeState).model`, preserving
pending-over-confirmed precedence without the snapshot base. `stored` is `snapshot?.model ?? null`;
a real empty saved model remains `''`. The announcement is conversation-scoped through
[Announced-model store](announced-model-store.md).

**Visible rows.** Both agents share one list, omitting only raw `value === 'default'` rows.
Retain the daemon's rows and order without headers, synthesis or deduplication; the daemon supplies
newest-per-family choices. `composerModelRowLabel` uses Claude's `modelFamily(row.value)` with
`display_name` fallback, and Codex's exact `display_name`. The sheet keeps published names and
resolutions. Option IDs are strings of the visible row positions, not model values, so duplicate
values within or across agents remain separate choices. The view recovers the actual clicked row
from that same non-default list; settings and switch payloads still carry its raw `value`.
The internal Claude default row stays available for recommendation lookup and
[effort offerings](composer-effort-menu.md), even though neither model surface offers it.

**Explicit marking.** A non-empty pending or confirmed pick wins; otherwise a saved model other than
`''` or `'default'` is explicit. Mark only a visible row whose raw `value` equals that choice. An unmatched
choice marks nothing, even if its resolution or family would match. Matching stays within
`modelRowsFor(models, agent)`: a foreign row cannot acquire the current marker. Duplicate explicit
values remain carried; the first own-agent match supplies the single positional marker.
Ambiguity stopping below applies to inherited matching.
A [remembered model](remembered-model.md) saved onto a new chat is an explicit choice and takes this rule.

**Inherited marking.** With no pick and saved `''` or `'default'`, use a non-empty announcement against
the own-agent non-default rows in this order:

1. Exact raw `row.value === announced`.
2. Exact raw `row.resolved_model === announced`.
3. `modelFamily(row.value) === modelFamily(announced)`, only when the announced family is non-empty.

At each tier, one candidate wins, zero advances, and multiple candidates stop with nothing marked.
An ambiguous earlier tier never falls through to a less precise unique match. Once an announcement
exists, an unmatched or ambiguous announcement marks nothing; the published default resolution cannot
supply a marker then. An announcement can also establish this reading before a snapshot arrives.

Before any announcement, Claude may mark only a unique non-default row whose raw `resolved_model`
equals the internal Claude default row's resolution. Ignore an empty or literal `<unmeasured>` default
resolution. An unmatched or ambiguous usable resolution marks nothing. Codex has no such recommendation
fallback and marks nothing before an announcement.

**Why the published default is only a pre-announcement fallback.** An inherited Claude session launches
without `--model`, so a `model` in Claude's `settings.json` can win. The published `default` row describes
Claude's recommended model, rather than proving what that session runs. The observed default-model chat
ran Opus 5.5 while that row resolved to Sonnet. Continuing to mark Sonnet after the Opus announcement
would misreport the running model. Announcements determine inherited marking but never become written
settings. See [the selection spec](../../specs/architecture/1690-running-model-selection.md).

**Claude trigger labels.** Explicit choices retain the existing shown-source order: pick, then announcement,
then saved model. An exact published-row hit names the family of `resolved_model`, then the family of
`value`, then the published `display_name`; a miss names the shown identifier's family, then the raw
identifier. Thus an explicit saved row can remain marked while an announcement supplies a different
trigger label. A confirmed pick stays above the announcement: the announcement carries no sequence or
timestamp to establish that it is newer, so letting it beat confirmation would let a stale pre-pick
announcement undo the optimistic label.

Inherited Claude labels name the marked row by the same resolution-family → value-family → display-name
chain. With nothing marked, use the announced family, then the family of the usable default resolution,
then `COMPOSER_MODEL_MENU_LABEL` (`Model`). That resolution may still supply a label after an announcement
with no family, but never a marker.

Codex explicit labels retain the pick → announcement → saved source order; inherited labels use the
announcement. An exact raw source-to-value lookup shows the daemon's display name on a hit and the raw
source on a miss. An unset Codex snapshot without an announcement reads `Model` and still offers its rows.

`modelFamily` strips one exact leading `claude-`, takes the leading ASCII-letter run, upper-cases its
first letter and leaves the rest unchanged. No family allowlist, trimming or case folding is involved.
Use this transform only for these display rules and the designated inherited family tier; explicit
choices, resolution joins and writes compare raw identifiers with `===`.

The table assumes a selection callback is available; without one, every held label uses the inert span.

| Input | Rendering |
|---|---|
| no snapshot (`stored === null`), no pick, announcement or pending switch, even with a held model list | `null`: no trigger |
| snapshot, pick, announcement or pending switch available, but no visible non-default rows | inert label span, no chevron, role, tabindex, handler or options anchor |
| snapshot, pick, announcement or pending switch available, and visible non-default rows | `ComposerOptionsMenu` with the shared `currentId` |

A snapshot naming no model is inheritance, even when the recommendation is unavailable: it can render
`Model`. No snapshot is a distinct loading state and stays absent until a pick, announcement,
snapshot or pending switch arrives. The inert arm bypasses `ComposerOptionsMenu`, which would otherwise advertise and open an empty
popup. The shared footer-button class has no pointer cursor and the inert arm omits the chevron.

## Per-agent filtering (#1651)

Since #1662, listing spans both agents while current-model matching and capability lookups retain
\#1651's agent boundary. `modelRowsFor(models, agent)` preserves order and treats an untagged row as
Claude. Explicit and inherited matching use only that agent's non-default rows; foreign rows cannot
cause ambiguity or a current match. Widening the list must not widen `publishedRowFor`, `effortRowFor`,
permission offerings or recommendation lookup. Route using the clicked row's `agent`, never its
model string: identical raw values can legitimately belong to different agents.

`composerModelRowLabel` keys on the row's own agent: Claude uses the value-family rule, Codex uses the
daemon's display name. Codex trigger labels remain daemon display names or raw announcements, with `Model`
for the empty snapshot state; they never use a derived family as visible copy.

The container resolves the conversation's agent through
[`useConversationAgent`](conversation-shell-run-configuration.md#run-configuration-model-section-daemon-published-rows-975).
`publishedRowFor` and `effortRowFor` require an `agent: WireAgent` argument so a caller cannot accidentally
join across agents. The latter's empty-model substitution onto the internal default row remains Claude's
alone. See [Composer effort menu](composer-effort-menu.md#composereffortmenumodel-one-pure-function-deciding-all-three-renderings)
for offerings and [the sheet](conversation-shell-run-configuration.md#run-configuration-model-section-daemon-published-rows-975)
for its agent resolution.

## The write

The container supplies optional `onSelect` only for an addressable session whose
resolved owning host reports `connected`. Selected pane coordinates take precedence;
without matching selected coordinates, ownership must be unambiguous in the flattened list.
Otherwise the view keeps any held label as an inert span and unmounts an open menu, even
with published rows present.
The callback passes the actual row to `selectConnectedModel(conversationId, row)`, which rechecks
connection, addressability and the conversation's current agent at click time. It passes
`conversationHostNow(conversationId)` to `selectAgentForConversation`, matching the
`useConversationHost` subscription used by `useConversationAgent`. Two hosts may publish the
same conversation ID with different agents: falling back to the flattened list here would
default to Claude and either write a foreign model without confirmation or ignore a Codex pick.
An own-agent row calls `changeConnectedSetting(conversationId, { field: 'model', value: row.value })`; an other-agent
row calls `openAgentSwitch` with that exact row. Untagged means Claude in both directions. Opening
sends no settings write or switch command. The switch store also revalidates the active owning pane
and outgoing agent on confirmation. Bridge access stays at interaction time, never during render.
See [the shared settings availability contract](conversation-shell-run-configuration.md#run-configuration-modeleffortyolo-sections-188),
which also applies to the model-only footer during questions. Reconnection restores
eligible controls without replaying blocked choices.

Picking an own-agent row moves the trigger's label to the optimistic value at once and reverts it if the change is
rejected — not local state: `selectEffectiveSettings`'s pending-overlay-over-confirmed-over-snapshot
composition is what moves it, and the same composition reverts it when the store drops the pending record
on rejection. The menu itself has no error line in its 20px footer; the
[composer status row](conversation-shell-composer-status.md#model-settings-rejection)
and run-configuration sheet name the rejection, including while answering a question.
This trigger also does not read
`supports_auto_mode` and does not touch the permission mode — `SettingsChange` has no such field to send,
and that control belongs to #682.

## Confirmed switch presentation and success (#1662)

`usePendingAgentSwitchRow(conversationId)` supplies a retained row only for `pending` status whose
`serverId` equals the conversation's current owning host. It subscribes through
`useConversationHost`, so selected host coordinates resolve colliding conversation IDs and
changing the selected host under the same ID immediately removes a foreign pending overlay.
Matching only the conversation ID would show another host's choice; resolving only flattened
ownership would hide a valid selected-host pending choice. Opening or cancelling a confirmation
installs no model overlay. Switch records pending synchronously before its one command; further
other-agent picks open no dialog and send nothing. Effort is included only if the displayed effort
at confirmation is supported by the picked row, as described in
[the switch contract](switch-agent-request.md#renderer-confirmation-and-read-surface).

Pending overrides the footer label with `composerModelRowLabel` of the retained row and marks that
presentation in both lists. Matching compares agent (absent = Claude), raw value, display name and
resolution, so another target row sharing its value cannot steal the marker. If that presentation
is no longer published, keep the retained label but mark nothing. The switch overlay stays outside
`runSettingsWriteStore`; effort and permission offerings still use outgoing settings and agent.
A correlated owning-host refusal or abandonment removes the overlay and reveals the underlying
model reading. Navigation retains pending for its conversation; disconnect, host removal or removal
of the owning conversation abandons it. Reconnect never resends.

A fresh owning-host conversation list establishing the target agent ends pending through the
existing outcome path. Its `onSucceeded(conversationId)` clears only that conversation's outgoing
announcement with `clearAnnouncedModelFor`, even when its pane is closed. The separate
`onActiveSucceeded` resets outgoing settings and requests incoming settings only for the active
owning pane, including clearing its snapshot and permission polling. Both callbacks are necessary:
a retained announcement can outrank an incoming saved model even with no prior settings write, while
a confirmed settings override can outrank the new snapshot independently. Opening, Cancel, refusal,
foreign/unchanged lists and abandonment clear neither underlying reading. See
[announcement lifetime](announced-model-store.md#the-store-srcrenderersrcstoreannouncedmodelstorets)
and [the repaired settings lifetime](run-settings-write-store.md#settings-lifetime-on-agent-switch).

After the incoming settings arrive, Codex's footer label uses its published display name; both
pickers route target-agent rows as own-agent settings choices, and effort/permission lookups use
the incoming agent. Both agents' model rows remain visible.

## New-chat model recall

The last non-empty deliberate model pick confirmed through this dropdown or the Run
configuration sheet is persisted verbatim as one profile-wide value shared across
hosts and agents. Pending/rejected picks, passive reads and automatic recall never
replace it. See [Remembered model](remembered-model.md) for storage and correlation rules.

Create chat and Add workspace activate the new chat immediately and read that preference
once. Channels and existing conversations do not recall. A non-empty value other than
raw `default` must exactly match a published row for the new chat's agent (absent means
Claude), with no `value` truncation. Recall accepts a cached list or waits up to five
seconds; empty or ineligible lists skip immediately. After eligibility it waits up to
five seconds for that chat's first settings reply, accepting one already received.
An empty session ID ends recall immediately. With a usable session and connected owning
host, it sends exactly one model-only write using the raw remembered value.

While pending, Send is disabled and the shared `sendText` guard blocks Enter, Actions
and status-area message sends before draft clearing or attachment consumption. After
submission, command return does not release the hold: the correlated confirmation
commits the chat's own selection and releases sending; rejection rolls back the
optimistic label silently and releases sending. No separate preference label is rendered.

Missing/empty/`default` preferences, either read timeout and write failures preserve the
inherited settings and preference without error UI or retry. Leaving or losing the owning
connection cancels the attempt; reopening/reconnecting does not replay it. Another host's
reconnect preserves the pending write and hold. Diagnostics contain only static outcome
codes. The model menu's geometry and label rules remain those described above.

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

**The gap #1423 left open — switching to a chat whose snapshot hadn't arrived yet could render the
*previous* chat's inherited-default row — is closed, by [#1495](https://github.com/pyrycode/pyrycode-desktop/issues/1495).**
`activateConversation` clears `runConfigStore` and `sessionIdStore` on every switch, but deliberately never
clears `modelListStore` — that store's own docs rule out an activation- or connected-edge clear, since
\#1166's model-list ask is per-conversation and the list itself does not vary by chat. Before #1495, the
container collapsed "no snapshot yet" and "snapshot says the model is empty" into the same layer (`stored:
snapshot?.model ?? ''`), so between the clear and the next `runConfigReceived` frame, `shown === ''` and the
already-held model list resolved the inherited-default row — the same row the *previous* chat may have been
showing — even on a chat whose actual stored model was something else entirely.

`ComposerModelLayers.stored` is now `string | null`, not `string`: `null` means no snapshot has arrived for
this chat at all, `''` keeps meaning the snapshot named no model (the daemon's inherited default,
\#1423's reading). The container supplies the distinction it was flattening — `snapshot?.model ?? null`
rather than `?? ''`, since `??` does not fire on `''` and a real empty-model snapshot still arrives as `''`.
`firstShown` treats null as nothing at that layer, while `composerModelMenuModel` explicitly returns
`null` when there is no snapshot, pick or announcement. A cached recommendation alone therefore cannot
show the previous chat's model during the switch. `runConfigStore` already distinguishes `snapshot: null`
from an empty saved model; the container preserves that distinction rather than flattening it.

A real settings reply with `model: ''` still represents inheritance. It takes the pre-announcement
recommendation rule described above, or reads `Model` when no usable resolution is available. The absent
trigger is limited to the no-snapshot window without a pick or announcement.

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

`display_name` and `value` are daemon-published text from either agent that crossed the subprocess trust boundary, bounded
by the daemon but not sanitized (see [Model-list store](model-list-store.md)). Since #1053, the
**announced** identifier crosses the same boundary and is bounded the same way, by
[Announced-model store](announced-model-store.md)'s producer (256 bytes) rather than sanitized. Each of
the three reaches escaped JSX text (React's default escaping). Raw values participate in array-scan
matching and are passed through into settings or confirmed switch payloads. `option.id`, React keys
and `currentId` use client-generated visible-row positions; daemon strings do not become option keys.
The published text reaches no
attribute, URL, filename, cache key, lookup path or log line, on any branch. The announced identifier also
participates in exact raw value/resolution comparisons and the designated inherited family tier, using
array scans rather than an object keyed by daemon text. It is a report used
for display and marking; `onSelect` dispatches only a published row's raw value, never the announcement.
The panel's `aria-label` is a client-owned constant (`COMPOSER_MODEL_MENU_LABEL = 'Model'`) naming the
panel, never the trigger's visible text — unlike `ComposerActionsMenu`, this trigger cannot use its own label as
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
that carried it before this ticket. `publishedRowFor` still receives raw strings; `currentId` is a
visible-row position, and selection sends the clicked row's raw value. Family comparison is limited to the inherited
selection tier above; it does
not widen explicit-choice matching, indexing, keying or writes. Neither labels nor family derivation
sanitize the held strings; React's text escaping remains the rendering boundary.

This menu deliberately surfaces neither of `ModelListEntry`'s two truncation reports
(`truncated_fields`, `droppedModels`), nor `announcedModelStore`'s own `truncated` cut report — the
run-configuration sheet remains the surface that reports a cut; withholding a report here is a
completeness question the sheet already answers, not a leak.

## Testing

`e2e/composer-model-recall.spec.ts` holds correlated recall replies and proves first-send
release on confirmation/rejection, draft/attachment retention and no recall for channels
or existing chats. The [remembered-model tests](remembered-model.md#testing) also exercise
the production write subscription and asynchronous background encoding/send failures;
a renderer-only throwing mock misses that failure boundary.

`e2e/real-claude-model-recall.spec.ts` deliberately confirms a published model different
from the inherited one, relaunches the same profile and checks the new chat's first
announcement against the picked row's resolved model. Live evidence requires an executed
passing test, not an all-skipped exit.

`e2e/question-answer-continue.spec.ts` holds settings replies while checking the optimistic
label and preserved answers, then drives a correlated rejection and retry at 800px. It
captures exact model-only payloads and verifies the original batch's answers and restored
draft. Scope footer interactions to `.composer__footer:visible`: the hidden composer still
contains its own menu.

The real question spec must prove Claude continues with the selected answer before
probing the resolved model on an ensuing user turn. `model_announced` originates in
`system/init`; the in-band control request creates neither a user turn nor an intermediate
init. Waiting for an announcement during the parked question therefore observes the wrong
lifecycle. `e2e/real-claude-question-answer.spec.ts` records the ensuing announcement in its
`resolved-target-model` attachment. Optimistic panel dismissal alone proves no continuation.

`mergedModelPickers.test.tsx` checks merged order, positional IDs, duplicate values, inherited
agent isolation, pending presentation and both-direction action routing with untagged Claude.
`e2e/merged-model-pickers.spec.ts` drives footer and sheet entry points, including acknowledged
own-agent picks, Cancel/Switch, duplicate suppression, refusal, abandonment and authoritative
success. Native sheet buttons cover Enter and Space in both directions; disabled rows retain
their reading without taking focus. Colliding-host cases cover selected-owner routing,
matching-host pending and foreign-host exclusion, with exact per-host write/switch counts.
A confirmed settings overlay surviving host navigation is separately tracked in
[#2068](https://github.com/pyrycode/pyrycode-desktop/issues/2068); pending-switch isolation does
not establish settings-overlay isolation. A row-disappearance assertion would contradict the
merged list: after success, assert that the outgoing row remains visible and unmarked while
the incoming row is current.

The [October 16 verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1846#issuecomment-6219617302)
for reviewed head `49ed9418` records the complete Linux fake-transport/captured-client gate:
488 executed/passed, 0 failed, 4 existing skips, 0 flaky results or retries. All 20 merged-picker,
2 confirmation, 4 offline-settings and 1 settings-round-trip cases executed and passed, with
0 failed/skipped in those 27 cases. Keyboard, colliding-host, acknowledged own-pick and outgoing
announcement regressions remain active. The settings dependency #1845 is repaired.

CDP command observation at `window.pyry.sendCommand` sees the result of
`sendConversationCommand`, including the selected owning `serverId`. Exact single-command
assertions must include that host alongside the raw model and supported effort; the wire payload
alone is not the bridge command shape.

**Operator hand-over acceptance remains pending under `held:live-handover`.** Establish a fresh
fact in Claude, switch the same conversation through the real picker to GPT-6 Luna at Low, then
require a completed answer recalling the fact without restating it. The named live spec now
implements that scenario, but its repaired version has only collected 1 test, 0 executed.
The historical live failure remains failed. Record fresh current-main counts and same-attempt
daemon revision, correlated terminal/answer, unchanged conversation ID, saved/applied Low settings
and published Luna footer before releasing the hold. See the
[live runbook](live-e2e-runbook.md#claude-to-luna-handover-acceptance-1662) for the exact test,
attachments and historical results. Collection, fake transport and recorded new-channel proof
cannot establish continuity from Claude; the automatic live gate is retired.

Renderer tests are static server renders (CLAUDE.md), so they cannot prove clicks or effect delivery.
`modelSelection.test.tsx` gives both surfaces identical input layers with independently stated expected
row IDs and trigger labels. It covers the no-snapshot distinction, usable/empty/unmeasured/unmatched and
ambiguous recommendations, value/resolution/family tiers and ambiguity, disagreement with the default,
saved `default`, explicit matched/unmatched choices, agent-scoped matching and Codex. Reducer-driven cases prove
pending, confirmed and rejected picks. Assert the marked row's identity on each surface: a count of one
alone can pass with the wrong dropdown row selected.

`e2e/real-claude-effort-default.spec.ts` observes the inherited chat's own announcement, a fresh model list
and settings after a real turn. Its independent wire-data oracle checks both model surfaces and applied
effort, retaining `inherited-model-selection` evidence. Live acceptance needs an actually executed passing
test; collection or an all-skipped zero exit proves nothing.

When a menu hides an internal row, derive positional click indices from the visible merged,
non-default rows. The real question driver once indexed the full list (Default, Sonnet, Fable, Opus,
Haiku); the old Opus index clicked Haiku after Default disappeared. Acknowledgement and original-answer
continuation still passed; only the ensuing announcement exposed the wrong model. Assert menu count and
target label before clicking, then assert the announced result. The fake-transport menu spec saves its
integrated footer and sheet screenshots through `testInfo.outputPath` and attaches them so repeated runs
retain their own evidence.

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

Two lessons from the #1495 e2e drive (`e2e/composer-model-waits-for-snapshot.spec.ts`), on top of the two
above:

- **Every sibling footer control was also unavailable as the "the app has finished launching" barrier.**
  Permission mode, effort and the context reading all wait on the same withheld snapshot the drive is
  proving absent, so none could anchor the wait and `.composer__model-label` is the thing under test. The
  barrier that worked is the capture itself: push `model_list`, then a `thinking → idle` pair, and wait for
  the extra `request_session_settings` envelope the turn-end transition sends to reach the capture before
  asserting the label's absence — frames are in-order on one socket, so that ask proves the list was
  already processed. It holds only because `createRunConfigRefreshTrigger` fires on exactly the `connected`
  edge and a running → not-running transition, with no retry and no poll, so the baseline envelope count
  cannot drift on its own the way a polled or retried request could.
- **A widened `firstShown` predicate is right by accident if written as a bare `value !== ''`.** A `null`
  passes that looser test, and the result is correct only because `?? ''` launders it at the end and
  because `stored` happens to be last in both chains today. The explicit `value !== '' && value !== null`
  states the rule instead of inheriting it from an ordering — a later nullable layer placed in front of
  `stored` would otherwise silently answer "nothing" for every layer behind it, with no test in this repo
  positioned to catch it.

`e2e/composer-model-announced.spec.ts` drives announcement-over-saved label precedence, a picked row
outranking both, and rejection restoring the announcement label. The launch supplies a snapshot; to prove
a later stored-choice response arrived, count captured `request_session_settings` envelopes rather than
using a label that can remain unchanged. See [the activation refresh](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166).

A label-source test needs inputs whose source families differ. Rows whose value and resolution share a
family make a miss-to-hit assertion pass even without a row lookup. The internal default resolution can
exercise that distinction without offering a Default row: an inherited label moves from `Model` before a
list to the recommendation's family after it. Invented explicit rows with differing families can exercise
the explicit source chain without changing the production vocabulary.

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
`## Revisions` entry. See `docs/specs/architecture/1423-inherited-default-model-menu.md` for #1423's plan
and [PR #1432](https://github.com/pyrycode/pyrycode-desktop/pull/1432) for its verifier review, including
the switch-window gap that #1495 closed. See `docs/specs/architecture/1495-model-label-waits-for-a-snapshot.md`
for #1495's plan and security review, and [PR #1512](https://github.com/pyrycode/pyrycode-desktop/pull/1512)
for its verifier review.
