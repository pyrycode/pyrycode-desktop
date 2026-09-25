# Conversation shell — actions menu and reader cutover

The composer's Actions menu and the per-conversation timeline reader cutover — two independent slices of the conversation screen, split out of [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md) on 2026-09-02 to keep that document under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Actions menu (#680)

The shared [options panel](conversation-shell-composer-options-panel.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)'s
first live consumer, and the composer footer's leading item (Figma `115:3677`, x=0). At #680's ship, sent
`/clear`, `/compact` or `/knowledge-capture` as ordinary message text — reset, compact and knowledge
capture, one click instead of typed by hand. **`/clear` is gone from this menu as of
[#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496)**: reset now dispatches the control frame
described in § New session control action below, whose row is relabelled **Reset session** and drawn first;
the menu's slash-text path now carries only `/compact` and `/knowledge-capture`. Typing `/clear` by hand is
untouched — claude still intercepts a message whose text begins with a slash and runs it as a command
rather than passing it to the model (measured 2026-08-21 against claude 2.1.220), and an unknown command
comes back as a synthetic "Unknown command" assistant reply at zero turns and zero cost — which is why an
absent `/knowledge-capture` in a workspace that doesn't define it was, at #680's ship, a correct, visible,
harmless outcome that ticket deliberately did not detect or grey out. **[#681](https://github.com/pyrycode/pyrycode-desktop/issues/681) has since
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
an absent command below for the current signatures; `COMPOSER_ACTIONS_LABEL` is unchanged and
`COMPOSER_ACTIONS` is still never mutated. **The array above is not the current shape**:
[#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) dropped the `{ id: '/clear', label:
'Reset session' }` member — reset moved to the control row (§ New session control action below, now itself
labelled Reset session) — so `COMPOSER_ACTIONS` today holds only `/compact` and `/knowledge-capture`, in
that order.

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
second entry point to drift. `sendText` also rechecks the current owning host before
submitting or creating an optimistic echo. The container hides the menu when that host
is unavailable, including a menu opened before disconnect. Reusing the greyed rows would
incorrectly announce a workspace limitation for an offline host. Local drafts remain
editable; blocked commands do not replay on reconnect. See
[host availability](conversation-shell.md#held-reading-and-host-availability).
`window.pyry` is dereferenced only at interaction time.

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
occurrences. The disconnected container now hides the trigger.
`e2e/composer-actions.spec.ts` proves command dispatch and optimistic echo, Escape and
outside-click dismissal. `e2e/offline-conversation-actions.spec.ts` closes the former
offline interaction gap by disconnecting with an open menu and checking renderer commands,
held state and explicit reconnect actions.

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
that reason. **This example is now purely historical** — [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496)
folded the `/clear` entry out of `COMPOSER_ACTIONS` entirely (§ New session control action below), so the
live rule below applies to `/compact` and `/knowledge-capture` only.

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

**`markUnavailableActions` is AC3's whole rule, applied identically to both remaining entries — no
per-command table, neither `/compact` nor `/knowledge-capture` is special-cased** (a third, `/clear`, was
marked here too until [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) folded it out of
`COMPOSER_ACTIONS`; see § New session control action below). An entry is present when its id, with exactly
one leading `/` stripped, equals a published row's `name` **or** any string in that row's `aliases` — exact
string equality, no case fold and no trim (`publishedRowFor`'s posture; the type-ahead folds case only
because its own ticket asked for case-insensitive typing). The scan is a linear `Array.prototype.some`,
deliberately not a `Set` or an index: workspace-authored text keys no cache, no memo and no lookup path
here either, the store header's obligation carried one hop, and two entries against a measured 51 rows
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

**Both signatures above gained a required `onNewSession: () => void` beside `onCommand`, and
`markUnavailableActions(COMPOSER_ACTIONS, menu)` above became `composerActionRows(menu)` — #1218, see §
New session control action below for the fourth row this added and why it is a second array rather than
a fourth member of `COMPOSER_ACTIONS`.**

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

## New session control action (#1218, folded to the menu's only reset row by #1496)

**As shipped by #1218**, this was the menu's fourth row and its first entry that is not a slash command,
drawn *beside* a separate `/clear` row labelled Reset session: `/clear` cleared claude's context in place
and the process kept what it holds — loaded workspace instructions, tool servers, every setting it was
spawned with — while this row asked the daemon to kill claude and spawn a fresh one under a new id in the
open conversation, so every stored setting (model, effort, permission mode, the per-conversation system
prompt) applied at the spawn instead. That was the two-button surface Juhana's 2026-09-06 decision had
already rejected — a conversation has exactly one reset path, the cold one — and on 2026-09-15 he asked why
there were two. **[#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) folded them**: the
`/clear` row is gone from `COMPOSER_ACTIONS` (§ Actions menu above), this row's label became **Reset
session**, and it moved from last to first. The row's own dispatch is unchanged by the fold — only which
row makes it, what it's called, and where it sits changed.

The transport half — `newSessionCommand`, the routed `newSession` arm in `src/main/index.ts`,
`buildNewSession` — shipped with [#1217](https://github.com/pyrycode/pyrycode-desktop/issues/1217) with no
renderer caller; #1218 is that caller and the proof the round trip works. **The daemon answers the frame
with nothing at all** — the only observable effect, when it has a child to rotate, is the pre-existing
`session_transition` marker drawn by the shipped `.session-delimiter`, which is why the fake-tier proof
below needs two arms rather than one.

**A second array, not a widened one — and that separation is what made the #1496 fold safe.**
`COMPOSER_ACTIONS` is never touched by this row: it holds whatever slash commands the menu offers (three at
\#1218's ship, two — `/compact` and `/knowledge-capture` — since #1496 dropped `/clear`), still an array
whose every id *is* the command sent verbatim. The control row is a sibling constant in the same file, and
its label is the one field #1496 changed:

```ts
export const NEW_SESSION_ACTION: ComposerOptionsPanelOption = {
  id: 'new-session',
  label: 'Reset session'
}
export function composerActionRows(
  menu: SlashCommandListEntry | null,
  slashCommands: boolean            // #1655 — see below
): readonly ComposerOptionsPanelOption[] {
  if (!slashCommands) return [NEW_SESSION_ACTION]
  return [NEW_SESSION_ACTION, ...markUnavailableActions(COMPOSER_ACTIONS, menu)]
}
```

**A session whose capability list says it has no slash commands drops the two command rows
outright (#1655), rather than greying them out.** `slashCommands` comes from [Run configuration
store § Session capability flags](run-config-store.md#session-capability-flags-1655)
(`selectSlashCommandsSupported`) — a Codex session publishes no `slash_command_list` at all, so
`markUnavailableActions` (§ Grey-out above) reads the missing list as *unknown* and would leave
both rows live, each reachable as a command that gets sent to Codex as prompt text. The early
return is keyed on the flag alone, never on whether a menu was published or on the agent name, so
the answer is the same with or without a published `slash_command_list`. `ComposerActionsMenuView`
takes `slashCommands` as a required prop and the container reads the selector directly; `false`
leaves the Actions trigger itself unchanged — only the panel's contents shrink to the single Reset
session row.

**`NEW_SESSION_ACTION` keeps its constant name and its `id` (`new-session`) across the #1496 rename —
deliberately, not by oversight.** The id, the view's `onNewSession` prop, the `sendNewSession` helper, the
`newSession` IPC command and the `new_session` wire envelope all keep the verb they have and are one chain;
`label` exists as a field separate from the constant's name precisely so the two can differ, and only
`label` speaks the UI's vocabulary. `id` carries no leading slash and is disjoint from every
`COMPOSER_ACTIONS` id — pinned by a test, since it is what makes the view's two-arm dispatch total:
`onSelect={(id) => (id === NEW_SESSION_ACTION.id ? onNewSession() : onCommand(id))}`. That dispatch reads
the id, never the row's position, so #1218's append-last and #1496's move to prepend-first changed nothing
about which arm a pick takes. At #1218's ship the row was appended **last**, keeping the availability-marked
commands one contiguous block at the head, on the reading that AC1's "beside Reset session" named the
*surface* the row lives on, not a row index. **#1496 moved it to the head instead** — AC1 there mandates
`Reset session, Compact session, Knowledge capture` in that order — so the availability-marked block is now
the contiguous tail rather than the head; the composition stays the same single splice-free expression
either way.

**Why a second array is what makes AC3 (#1218) and AC2 (#1496) structural rather than a carve-out.** The
control entry is never an argument to `markUnavailableActions` (§ Grey-out above), so no published
`slash_command_list` — complete, empty, hostile or truncated — can reach it: there is no "except this one"
branch inside that module to get backwards, since `isPublished` strips one leading slash and matches a
published `name` or alias, and a non-slash id like `new-session` would otherwise match nothing and grey out
in every workspace with a complete list, a failure that ships looking correct. After #1496 folded `/clear`
away, this row is the conversation's **only** reset path, so that failure mode would now mean no reset
offered at all rather than a redundant second one — which is why #1496's own acceptance criteria restate
the same structural property (the control row "stays offered in a workspace whose published
`slash_command_list` is complete and names neither it nor `clear`") rather than trusting the #1218 shape to
still hold. It is also what left two shipped assertions honest rather than weakened at #1218's ship, contrary
to that ticket's own prediction that they would need editing: `ComposerActionsMenu.test.tsx`'s "every entry
id starts with `/`" still guards exactly the array whose ids are commands, and
`composerActionAvailability.test.ts`'s "an empty published menu marks every entry" is untouched and still
true, since `COMPOSER_ACTIONS` still holds only entries that rule applies to. What moved instead is the
*rendered* row counts (3→4 unmarked at #1218, 2→3 in the mixed panel; back to 3 unmarked at #1496, now
1→2 in the mixed panel since `COMPOSER_ACTIONS` itself shrank) — the honest place for a row-count change to
be felt. **Lesson for a future ticket reading a Technical Notes section**: when it predicts which shipped
guard must be weakened to satisfy an AC, treat that as a hint about the sketched design rather than a
requirement the AC itself imposes — a differently-shaped design can leave the guard both green and still
meaningful.

**The send: `sendNewSession.ts` (new file)**, the `sendInterrupt` shape with an address — `sendInterrupt`
sends a bare Esc naming nothing, and a restart has to name the one conversation it kills claude in:

```ts
export interface SendNewSessionDeps { sendCommand: (command: RendererCommand) => void }
export function sendNewSession(conversationId: string | null, deps: SendNewSessionDeps): void
```

Guarded send only, no optimistic dispatch — the daemon answers with nothing, so there is no state to post
and nothing to retract — and a bridge failure swallowed to `console.error` with the error alone, never
propagated. It returns early, sending nothing, on **both** a `null` id (`submitMessage`'s precedent; the
composer footer renders whether or not a conversation is open) and an **empty** `''` id. The empty-id
clause exists because on this one verb an empty id is not an unresolvable id: the protocol gives no
payload, `{}`, an absent id and an explicit `''` one wire meaning — restart whichever conversation the
daemon's process-wide follow-active cursor points at — so it would be *some other conversation's* claude
killed mid-work. `isNewSessionPayload` (`src/shared/ipc/commands.ts`) remains the load-bearing refusal of
that case at the renderer→main boundary; the renderer-side check is defence in depth, commented as such so
a later reader cannot conclude the boundary guard is now redundant and relax it — a command the boundary
guard rejects is dropped in silence, no frame, no event, no error, so a relaxed clause on either side
compiles, typechecks and passes every gate with no symptom to chase. `Composer.startNewSession` checks the
current conversation owner's connected status before calling this helper. It closes over the same
`activeConversationId` as `sendText` and dereferences `window.pyry` only at interaction time. Main's
existing validation remains in place; renderer availability prevents offering or dispatching unavailable
actions.

**No confirmation step in front of this row, by decision — worth a reader's attention rather than an
assumption of safety.** The shared panel focuses row 0 on open, and #1496 put this row at index 0, so an
operator who opens the Actions menu and presses Enter reflexively now kills and respawns claude, where
before the fold (when `/clear` was row 0) that same keystroke cleared context in place. Both #1218's and
\#1496's security reviews name this and leave it unaddressed deliberately: AC1 (#1496) mandates the row
order, Juhana's 2026-09-06 decision mandates the single cold reset path, and the planned mitigation is
upstream — a daemon-side wrap-up turn that writes a handoff note before the kill, not yet landed as of
\#1496. A client-side confirmation dialog would be a product decision neither ticket was given.

**Testing.** `sendNewSession.test.ts` covers the happy path, the `null` and `''` refusals and a swallowed
bridge throw with a plain spy — no React, no store. `ComposerActionsMenu.test.tsx` pins the row's exact
label (`Reset session` as of #1496; `New session (restarts claude)` at #1218's ship), its position (first
as of #1496; last at #1218's ship), and the two identity properties the dispatch's totality rests on
(`new-session` has no leading slash and matches no `COMPOSER_ACTIONS` id), plus a deterministic detector:
the control row carries no `unavailable` marking and no `aria-disabled` against both a complete list naming
none of the entries and a complete empty list — the guard that reddens if a later ticket ever merges the
two arrays back into one, and #1496 sharpened its input further by also proving the row survives a complete
list that names neither the row's id nor `clear`. `e2e/composer-new-session.spec.ts` drives AC2/AC4 (#1218)
and AC1/AC4 (#1496) end to end: picking the row sends exactly one `new_session` naming the open
conversation, zero `send_message`, no user bubble and an empty message box; with the daemon answering
nothing, no delimiter and no error surface; with one pushed `session_transition`, exactly one
`.session-delimiter`. **The two arms are a matched pair, not two independent tests** — the daemon answering
`new_session` with nothing gives the "nothing drawn" arm no event to await, so on its own it is vacuous; it
is worth something only paired with the arm that pushes one `session_transition` and counts exactly one
delimiter. `e2e/real-claude-new-session.spec.ts` is the liveness proof and the reason it cannot be folded
into the fake tier: a live claude cannot be made to answer with no `session_transition` on demand, and a
scripted fake cannot prove the turn stream survives a real respawn. It mirrors
`real-claude-interrupt.spec.ts`'s pair-create-send preamble, sends one real turn to give the daemon a child
to rotate, captures a `nonEmptyAssistantCount` baseline **after** that turn quiesces (a bare `>= 1` is
vacuous in a chat that already streamed a turn — see [live-e2e-runbook.md](live-e2e-runbook.md)), picks
**Reset session** (renamed from New session by #1496; locator and prose only, no new spec), asserts exactly
one delimiter, sends a second message and asserts the count rises **above** the baseline. #1218 made the
real-claude tier's floor stale — see [live-e2e-runbook.md § Current real-claude gate
state](live-e2e-runbook.md); #1496 adds no spec and leaves that floor unchanged.

**A row-count lesson for any future ticket that touches this menu.**
`e2e/composer-actions-unavailable.spec.ts` arrows from the greyed row back to `Reset session` through the
roving-tabindex wrap, and the wrap distance is a function of the row count: one `ArrowDown` over three
rows at #680's ship, two over four once #1218 appended this row, back to one once #1496 folded `/clear`
away. **A label rename across two rows that fold into one is also not a plain rename, and a spec can go
green for the wrong reason**: this spec's `AVAILABLE_ROW` and `CONTROL_ROW` constants anchored on `Reset
session` (the `/clear` row) and the New session label respectively — after the fold both names resolve to
the same row, so a mechanical rename would have pointed `AVAILABLE_ROW` at the control row too, silently
turning "an available row still sends" into a no-op assertion. #1496's fix moved `AVAILABLE_ROW` to
`Compact session` and dropped `clear` from the spec's own published-list fixture, which is also what keeps
the never-greyed assertion honest against the exact regression AC2 exists to forbid (folding the control
row back into `COMPOSER_ACTIONS` under the id `/clear`). Check for collapsed anchors — two constants about
to name the same element — before a mechanical rename, not after. Nothing in a diff that only adds, removes
or renames a row names this spec's keyboard drive on its own; grep a shared panel's specs for keyboard
navigation, not only for row-count and label assertions, before changing this family's row count again.

Code review (self-review) PASS at #1218, one non-blocking NIT (a stale word in
`e2e/composer-actions.spec.ts`'s own file-header comment). #1496's own review (verifier) PASS, one SHOULD
FIX and two NITs, none blocking. See [PR \#1220](https://github.com/pyrycode/pyrycode-desktop/pull/1220),
[PR \#1513](https://github.com/pyrycode/pyrycode-desktop/pull/1513), and the architecture specs at
`docs/specs/architecture/1218-new-session-action.md` and
`docs/specs/architecture/1496-one-reset-session-row.md`.

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
[#278](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278)) moved above the timeline read, because the timeline read now needs its id —
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
panel](conversation-shell-background-tasks.md#background-task-panel-581-cap-and-cut-display-since-582-latest-patch-since-583)'s idiom, safe
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

