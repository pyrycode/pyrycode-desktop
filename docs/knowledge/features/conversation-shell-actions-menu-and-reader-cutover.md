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
that doesn't define it is a correct, visible, harmless outcome this ticket deliberately does not detect
or grey out (that's [#681](https://github.com/pyrycode/pyrycode-desktop/issues/681), gated on a daemon
change). See [Driving a running session](../../../CLAUDE.md) in CLAUDE.md for the general mechanism.

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
chip or button](conversation-shell-composer.md#composer-error-chip-797) already explain. Through
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

