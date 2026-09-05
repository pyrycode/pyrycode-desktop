# Conversation shell — actions menu and reader cutover

The composer's Actions menu and the per-conversation timeline reader cutover — two independent slices of the conversation screen, split out of [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md) on 2026-09-02 to keep that document under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Actions menu (#680)

The shared [options panel](conversation-shell-composer-options-panel.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)'s
first live consumer, and the composer footer's leading item (Figma `115:3677`, x=0). Sends `/clear`,
`/compact` or `/knowledge-capture` as ordinary message text — reset, compact and knowledge capture, one
click instead of typed by hand. Needs no daemon change and no wire change: claude intercepts a message
whose text begins with a slash and runs it as a command rather than passing it to the model (measured
2026-08-21 against claude 2.1.220), and an unknown command comes back as a synthetic "Unknown command"
assistant reply at zero turns and zero cost — which is why an absent `/knowledge-capture` in a workspace
that doesn't define it was, at #680's ship, a correct, visible, harmless outcome that ticket deliberately
did not detect or grey out. **[#681](https://github.com/pyrycode/pyrycode-desktop/issues/681) has since
built exactly that grey-out** — see § Grey-out for an absent command below. See [Driving a running
session](../../../CLAUDE.md) in CLAUDE.md for the general mechanism.

**`ComposerActionsMenu.tsx` (new file)** — its own module rather than another 70 lines in
`ConversationScreen.tsx` (~2700 lines, a declared merge hot-spot), the precedent #682 (permission mode)
and #683 (model and effort) follow for the same reason. Three exports:

```ts
export const COMPOSER_ACTIONS: readonly ComposerOptionsPanelOption[] = [
  { id: '/clear', label: 'Reset session' },
  { id: '/compact', label: 'Compact session' },
  { id: '/knowledge-capture', label: 'Knowledge capture' }
]
export const COMPOSER_ACTIONS_LABEL = 'Actions'
export function ComposerActionsMenu({ onCommand }: { onCommand: (command: string) => void }): JSX.Element
```

**This is the #680 shape. #681 split `ComposerActionsMenu` into a pure view (renamed
`ComposerActionsMenuView`) and a store-bound container that kept the original name** — see § Grey-out for
an absent command below for the current signatures; `COMPOSER_ACTIONS` and `COMPOSER_ACTIONS_LABEL` are
unchanged and `COMPOSER_ACTIONS` is still never mutated.

**The `id` is the command, sent verbatim.** `ComposerOptionsPanelOption.id` is documented elsewhere as
"the stable identity — the wire/model value," kept separate from `label` because #683 shows `Opus 5` for
`claude-opus-5`. A command menu has no wire/model value behind the row — the command string *is* the
identity — so collapsing them is the honest shape rather than a shortcut: `COMPOSER_ACTIONS` passes
straight into the panel's `options` prop with no `.map()`/`useMemo` and no parallel array to drift, and
`onSelect(id)` is `onCommand(id)` with no lookup and no unreachable `undefined` branch. There is
deliberately no `command` field, no lookup function and no `ComposerActionId` union — that would be
ceremony around an array whose ids already are the answer. `ComposerActionsMenu` renders
`<ComposerOptionsMenu options={COMPOSER_ACTIONS} currentId={null} onSelect={onCommand} ariaLabel={COMPOSER_ACTIONS_LABEL} triggerContent={…} triggerClassName="composer__actions" />`
and nothing else — no store read, no `window.pyry`, no state of its own, and (per the panel's boundary
rule stated at its own `:121-126`) `ComposerOptionsPanel.tsx` is untouched by this ticket's diff.
`currentId={null}` takes the panel's existing non-matching branch (a list of actions, not a choice — no
row wears `aria-current`), and the trigger's chevron (Figma's `chevron-up-solid-full`, inlined as an
8×4 `currentColor` svg, does **not** flip on open — the shared component keeps its `open` state private)
carries `aria-hidden="true"` so the button's accessible name stays exactly the client-owned
`COMPOSER_ACTIONS_LABEL` string — a load-bearing e2e locator once `e2e/composer-actions.spec.ts` reads it.

**One send path, not two.** `Composer.handleSubmit` (`ConversationScreen.tsx`) split into a reusable
`sendText(value): boolean` — the `canSend` gate, the `submitMessage` call with its existing deps object,
and the `onMessageSent()` notify, moved verbatim — and a one-line `handleSubmit` that clears the message
box on success. `<ComposerActionsMenu onCommand={sendText} />` mounts ahead of `ContextUsageControl` in
`.composer__footer`, so a picked command gets the identical `submitMessage` call, `message_id`, wire
`send_message`, optimistic `userText` echo and `followBottom()` scroll-follow a typed message gets — no
second entry point to drift. The menu carries no `canSend` prop of its own for exactly that reason: the
gate exists in one place, and the trigger is never disabled (including while disconnected) — picking
while the composer can't send sends nothing and writes nothing, silently, the same posture [the connection
banner](conversation-shell-chrome.md#connection-banner-279) and, in the `error` arm, [the status row's
chip or button](conversation-shell-composer-status.md#composer-error-chip-797) already explain. Through
[#968](../codebase/968.md) the composer also carried its own `Not connected` caption one row up for the
same reason; that caption is retired. `window.pyry` is still dereferenced only inside `sendText`, at
interaction time, never during render, so the container smoke test still server-renders with no bridge mock.

**Styling** — `.composer__actions` (`conversation.css`) was originally an explicit `<button>` reset (no
border, no fill, no padding) plus `color: var(--color-primary)` and the `.composer__context` body-small
type block; the file's `--color-primary`-onto-`.composer__footer` hoist question (raised at #811) is
answered here as declined — the UA stylesheet sets `color` on form controls, so a hoisted value wouldn't
reach a `<button>` at all, and every button-shaped consumer would still need its own `color: inherit` plus
the same font block. **The real extraction — a shared `.composer__footer-button` — landed with
[#988](composer-model-menu.md)**, not #682 as first anticipated here: #682's permission-mode button turned
out to be sequenced behind the model menu, so #988 was the row's actual second button and the moment the
stylesheet's own comment assigned the lift to. `.composer__actions` now carries only `cursor: pointer`
beside the shared class (`triggerClassName="composer__footer-button composer__actions"`, a two-class mix,
the `.button-small` shape). `outline: none` is still deliberately absent: every close path in
`ComposerOptionsMenu` returns DOM focus to the trigger, so its focus ring is load-bearing.

**Testing.** `ComposerActionsMenu.test.tsx` pins the mapping (`renderToStaticMarkup` cannot fire
`onCommand`, so only the data half and the closed-at-mount markup are unit-tested) plus a direct render
of `ComposerOptionsPanel` fed `COMPOSER_ACTIONS`/`currentId={null}` to prove zero `aria-current`
occurrences. `ConversationScreen.test.tsx` gained the mount-site guard — the trigger renders inside
`.composer__footer`, closed, ahead of the context reading in DOM order, and (since the container smoke
renders a disconnected session) present-and-**enabled** in that state, pinning AC4's static half.
`e2e/composer-actions.spec.ts` is the in-app interaction proof #840 deferred here: open → three rows in
order → pick → the outbound `send_message`'s `text` is the command verbatim *and* the thread's
`.bubble[data-thread-role="user"]` shows it; Escape and an outside click both dismiss; Escape also
returns focus to the trigger (an outside click deliberately does not — `close()`'s `.focus()` runs before
the browser's own mousedown focus action, the same accepted deviation `ComposerOptionsMenu` shipped
under #840). AC4's *interactive* half is not driven in e2e — tearing down the fake daemon mid-spec is
larger fixture work than this ticket's whole feature — and the spec says so in its own header comment
rather than leaving the gap silent.

**A landmine found and repaired, not introduced.** `getByRole`'s `name` option matches as a
case-insensitive *substring* by default, and the thread overflow trigger one region up is labelled `More
actions` — so `page.getByRole('button', { name: 'Actions' })` resolved two buttons and failed Playwright
strict mode until the locator added `exact: true`. Worth checking on any future control whose accessible
name is a common word. Separately, the pre-existing `renders no overflow menu for a bare ConversationScreen`
test used `not.toContain('aria-haspopup="menu"')` as a stand-in for "no menu popup exists" — a global
absence assertion on an attribute now legitimately present a second time. It was repaired rather than
deleted: pinned as a count of exactly one, scoped to the Actions trigger, so a second unrelated menu in
the bare tree still fails it. Code review (PR #848) flagged two non-blocking NITs — both about a test
comment overstating what the static tier can prove, not about behavior — and otherwise PASS.

Not security-sensitive: `/clear`, `/compact` and `/knowledge-capture` are client-owned constants, never
daemon-supplied, and reach the DOM only as ordinary auto-escaped React text (the panel's `option.label`
render) — no attribute, URL, filename or log sink. See [PR #848](https://github.com/pyrycode/pyrycode-desktop/pull/848).

## Grey-out for an absent command (#681)

An Actions entry whose command the conversation's published `slash_command_list` does not carry renders
unavailable (the shared panel's ARIA disabled-item treatment — see [Composer options panel §
Unavailable rows](conversation-shell-composer-options-panel.md#unavailable-rows-681)) and sends nothing
when picked, by click or by Enter on the focused row. **Correcting a claim this ticket's own earlier
comments carried**: the Actions menu's `reset` entry was said to be an *alias* of `clear`, which would
have made a name-only match grey out a working command. It is not — the shipped entry's `id` is `/clear`,
the command *name* itself, and `Reset session` is only its client-owned display label, which never
participates in matching. There was no live bug to repair; alias matching is still required (a published
row can name a command only by an alias other than `clear`/`compact`/`knowledge-capture`), just not for
that reason.

**`composerActionAvailability.ts` (new file)**, framework-free and DOM-free like `composerSend.ts` /
`composerOptionsKeyboard.ts` / `slashCommandTypeAhead.ts`, so the whole decision is a total function a
vitest spec can execute as data — nothing here can be reached by a click in this repo's `node`-environment
tests.

```ts
export function slashCommandMenuProvesAbsence(
  entry: SlashCommandListEntry | null
): entry is SlashCommandListEntry
export function markUnavailableActions(
  actions: readonly ComposerOptionsPanelOption[],
  entry: SlashCommandListEntry | null
): readonly ComposerOptionsPanelOption[]
```

**`slashCommandMenuProvesAbsence` inverts the asymmetry `slashCommandTypeAhead.ts`'s `hasUnknownAliases`
chose for the sibling type-ahead, deliberately.** That helper ignores a truncated `name`, because there a
cut name costs a free "Unknown command" reply while a cut alias hides a working command. Here **both**
cuts point the same way, and so does a frame-level drop: each can make a command that genuinely exists
look absent, and greying it out is the exact user-visible failure this ticket exists to prevent. So
absence is provable only from a **complete** list — all four must hold: `entry !== null` (a frame has
arrived), `entry.droppedCommands === 0` (compared as a value, never for truthiness), and no row's
`truncated_fields` names `name` or `aliases`. `commands: []` with `droppedCommands: 0` **proves absence**
and greys all three rows — claude's positive statement that it accepts nothing here, not an edge case.
The `truncated_fields` test is spelled `!== null && .includes(...)`, never `?.includes(...)` — the
optional-chaining form is falsy for an absent key exactly as it is for `null`, which would silently invert
the rule if this type were ever reached through a bare `as`. It is written fresh rather than importing the
type-ahead's helper, since the condition is wider than what that helper checks. Spelled as a **type
predicate** (`entry is SlashCommandListEntry`), a departure from the architecture sketch's plain `boolean`
— it is what lets `markUnavailableActions` narrow on that one call with no second, dead-at-runtime null
test.

**`markUnavailableActions` is AC3's whole rule, applied identically to all three entries — no per-command
table, `/clear` and `/compact` are not special-cased.** An entry is present when its id, with exactly one
leading `/` stripped, equals a published row's `name` **or** any string in that row's `aliases` — exact
string equality, no case fold and no trim (`publishedRowFor`'s posture; the type-ahead folds case only
because its own ticket asked for case-insensitive typing). The scan is a linear `Array.prototype.some`,
deliberately not a `Set` or an index: workspace-authored text keys no cache, no memo and no lookup path
here either, the store header's obligation carried one hop, and three entries against a measured 51 rows
costs nothing perceivable. Returns the input array **by reference** whenever nothing is unavailable — the
common case (every unknown reading, and a fully-published workspace) allocates nothing. Each marked entry
is the caller's own option **spread** with one boolean added; `id` and `label` are never rebuilt from a
published row — that is the line between "a hostile list greys a row out" and "a hostile list changes
what gets sent," and it is pinned by a test rather than left to inspection.

**`ComposerActionsMenu.tsx` split in two**, the pure-decision/pure-view/store-bound-container shape
`ComposerModelMenu` already uses on the same footer row:

```ts
export function ComposerActionsMenuView({
  menu, onCommand
}: { menu: SlashCommandListEntry | null; onCommand: (command: string) => void }): JSX.Element
// renders <ComposerOptionsMenu options={markUnavailableActions(COMPOSER_ACTIONS, menu)} ... />

export function ComposerActionsMenu({
  conversationId, onCommand
}: { conversationId: string | null; onCommand: (command: string) => void }): JSX.Element
// a useMemo-stable selectSlashCommandListFor(conversationId), null id selecting null through the same
// path, feeding ComposerActionsMenuView — ComposerModelMenu's idiom verbatim
```

`COMPOSER_ACTIONS` itself is not mutated and gains no field — the marking is derived per render, computed
fresh from the live store entry each time rather than cached or carried across conversations, so a marking
can never outlive `clearAllSlashCommandLists` and re-hydrate one workspace's verdict into the next
pairing. The mount site (`ConversationScreen.tsx`'s `.composer__footer` row) changed one line:
`<ComposerActionsMenu conversationId={activeConversationId} onCommand={sendText} />` — `activeConversationId`
was already in scope and already subscribed beside the `ComposerModelMenu`/`ComposerEffortMenu` mounts, so
the added prop costs no new subscription.

**This ticket is the first consumer in the family to make a *gating* decision from workspace-authored
text**, which is why it carries `security-sensitive`. The gate is one-way by construction: the published
list can only ever make `ComposerOptionsMenu.select` return early (see [Composer options panel §
Unavailable rows](conversation-shell-composer-options-panel.md#unavailable-rows-681)); no branch lets a
value from the frame become, alter or select the text that is sent, which stays `options[i].id` sourced
from the client-owned `COMPOSER_ACTIONS`. So the worst a hostile or compromised workspace can do is grey a
row out — it can neither send nor substitute anything the user did not pick, and the user can still type
the command by hand. Nothing on this path is logged, not even a content-free count of greyed rows,
inheriting `slashCommandListStore`'s no-diagnostic property (see [Slash-command-list
store](slash-command-list-store.md)). Builder self-review PASS; one SHOULD FIX recorded for a future
touch of this file: pin, with a test, that `markUnavailableActions` preserves each entry's `id` and
`label` unchanged rather than only reasoning about it.

**Testing.** `composerActionAvailability.test.ts` is the bulk of the proof, as data — both functions
across all four unknown readings, a name match, an alias-only match (a row named `clear` with alias
`reset`, so the alias arm is proven on a row where only the alias matches, not on the corrected `reset`
claim above), the leading-slash strip, no case folding, reference-equality on the no-op path, and the
`truncated_fields: ['aliases']` trap that would redden if `?.includes` ever replaced the explicit null
test. `ComposerActionsMenu.test.tsx` extends the #680 mapping assertions with the marked-row markup
(class, `aria-disabled`, the note) and its absence on an unmarked list.
`e2e/composer-actions-unavailable.spec.ts` is AC1's real proof: a pushed `slash_command_list` frame naming
`clear`/`compact` but not `knowledge-capture`, then the greyed row refuses both a click and a focused
Enter while an available row in the same open panel still sends. **The click is forced**
(`{ force: true }`): Playwright's actionability check already refuses an ordinary click on
`aria-disabled="true"`, which corroborates the marking lands where tooling looks but proves nothing about
what the app does when clicked — `aria-disabled` is advisory, a real pointer does reach the row, and
forcing the click is what actually drives the path the gate guards.

## The open-conversation reader cutover (#758)

Every tree above this point reads `useTimelineStore(select*)` — the flat, single-conversation store.
As of this ticket none of them do: the six reads (`items`, `phase`, `stalled`, `apiRetry`, `compacting`,
`localSendPending`) collapse into one subscription to the [conversation timeline
holder](conversation-timeline-holder.md)'s `selectTimelineFor(openConversationId)`, and `TimelineRow`,
`Timeline`, `ThinkingIndicator`, `ApiRetryIndicator`, `CompactingIndicator`, and `StallIndicator` all keep
their existing signatures and every line of JSX under them — the six local names destructured out of the
slice are `TimelineState`'s own six field names, so the diff is the read block and the import block only,
not the render tree. This is what makes leaving a chat and coming back show that chat's thread as it now
stands (Figma node 132-4171 redraws nothing; the anchor being rebound is the surface, not the shapes):
`activateConversation.ts`'s flat-store reset still fires on every switch, but now fires into a store
nothing renders from, while the per-conversation slice in the holder keeps whatever arrived while the
operator was elsewhere.

`activeConversation` (`useActiveConversationStore(selectActiveConversation)`, already read here since
[#278](conversation-shell-workspace-and-run-config.md#workspace-chip-278)) moved above the timeline read, because the timeline read now needs its id —
same hook, same selector, same single subscription, only its position in the hook list changed. The id
is derived as `activeConversation?.id ?? null` (the `:281`/`:1955` spelling this file already used), then
run through a `useMemo`-stable selector so a fresh closure per render does not churn the subscription:

```ts
const selectOpenTimeline = useMemo(() => selectOpenTimelineFor(openConversationId), [openConversationId])
const openTimeline = useConversationTimelineStore(selectOpenTimeline)
const thread = openTimeline === null ? initialTimelineState : openTimeline
const { items, phase, stalled, apiRetry, compacting, localSendPending } = thread
```

`selectOpenTimelineFor` (exported from `ConversationScreen.tsx`) branches on the id rather than
substituting a sentinel: `null` in → the module-level `selectNothingHeld` (`(): null => null`, a stable
identity, no map lookup at all); an id in → `selectTimelineFor(id)`. **This is deliberately not
`selectTimelineFor(openConversationId ?? '')`** — [Background-task
panel](conversation-shell-turn-status.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)'s idiom, safe
there and not here: `''` is an ordinary key in the holder (`dispatchFor` mints a slice for whatever
`conversation_id` the daemon asserts, `''` included), so a hostile or buggy daemon emitting one frame
with an empty `conversation_id` would plant a slice the sentinel spelling would then render as the open
conversation's thread while nothing is open. Branching to `selectNothingHeld` makes that misattribution
structurally unavailable rather than merely unlikely — see the architecture spec's security review
(`docs/specs/architecture/758-open-conversation-timeline-reader.md`) for the full reasoning.

The `openTimeline === null` branch means **no conversation is open**, not "the open one has no rows": by
the time this renders, [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786)'s `markViewed` has
already created the open conversation's slice at the activation seam, so an open conversation always has
one. The reachable `null` cases are the nullary notification `open` before any conversation was activated
([Paired shell](paired-shell.md)) and a bare `<ConversationScreen />` in a test — both resolve to the same
shipped empty thread (`Timeline`'s existing zero-`items` render), which is AC3's "empty thread that fills
from the next live event," not a new empty state.

`InterruptControl` (see [Interrupt envelope § The render
affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678)) took
`phase: TurnPhase` as a required prop from the container instead of its own
`useTimelineStore(selectPhase)` subscription — the seventh read this ticket enumerates, wired the same
way rather than duplicating the id derivation and the memoised selector in a second component. Its one
mount became `<InterruptControl phase={phase} />`; `window.pyry.sendCommand` stayed dereferenced only
inside its click closure, never during render. **`InterruptControl` itself is gone as of
[#678](https://github.com/pyrycode/pyrycode-desktop/issues/678)**, which folded the affordance into
`Composer`'s own send button — the same `phase` prop this section describes now reaches `<Composer
phase={phase} onMessageSent={followBottom} />` instead, one line below.

**Nothing else changes.** The flat `timelineStore` stays imported (the composer's `dispatch` write at
`composerSend.ts`) and stays dual-written by the bridge fan-out and the composer's echo; retiring it is
its own ticket. See [Conversation timeline holder § The open-conversation reader
cutover](conversation-timeline-holder.md), [Conversation timeline
store](conversation-timeline-store.md), and
[#758 spec](../../specs/architecture/758-open-conversation-timeline-reader.md) for the full design, the
security review, and the AC-by-AC test scenarios (`ConversationScreen.test.tsx`'s `store binding`
describe) and `e2e/conversation-switch-keeps-both-threads.spec.ts` for the end-to-end proof.

