# Conversation shell — conversation surfaces and modals

Surfaces that act on the conversation as a whole rather than on one turn: the permission modal, the actions menu, the channel info sheet, session boundaries, the queued backlog, and the reader cutovers.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Actions menu (#680)

The shared [options panel](conversation-shell-composer-options.md#composer-options-panel-838-placed-839-keyboard-driven-since-840-first-live-mount-since-680-right-edge-clamp-wired-since-847)'s
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
while the composer can't send sends nothing and writes nothing, silently, the same posture the composer's
existing `Not connected` hint one row up already explains. `window.pyry` is still dereferenced only
inside `sendText`, at interaction time, never during render, so the container smoke test still
server-renders with no bridge mock.

**Styling** — `.composer__actions` (`conversation.css`) is an explicit `<button>` reset (no border, no
fill, no padding) plus `color: var(--color-primary)` and the `.composer__context` body-small type block;
the file's `--color-primary`-onto-`.composer__footer` hoist question (raised at #811) is answered here as
declined — the UA stylesheet sets `color` on form controls, so a hoisted value wouldn't reach a `<button>`
at all, and every button-shaped consumer would still need its own `color: inherit` plus the same font
block. The real extraction — a shared `.composer__footer-button` — is deferred to #682 landing as the
row's second button, not built speculatively here. `outline: none` is deliberately absent: every close
path in `ComposerOptionsMenu` returns DOM focus to this button, so its focus ring is load-bearing.

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

## Permission modal (#224, answerable since #237, second-confirm since #226, rejection surface since #249, confirm marker scoped to its prompt since #511)

The render half of the modal vertical (ADR [0009](../decisions/0009-modal-prompt-model.md)):
[#223](../codebase/223.md) shipped the store + bridge but left `useModalBridge` dormant, so
`modalStore` never populated. #224 closed that loop — it mounts the bridge at App level (beside
`useDaemonEventBridge`/`useTimelineBridge` in `App.tsx`) and renders the store's outstanding prompt.
[#237](../codebase/237.md) then made the rendered prompt **answerable**, closing the modal vertical.
[#226](../codebase/226.md) then inserted a **client-side second-confirm gate** in front of an allow
answer: there is no machine-readable `destructive` class on the wire (ADR 0009), so "a consequential
action needs a second confirm" can only be a renderer UX policy, gated on the one signal available —
`prompt.defaultOptionId`. [#249](../codebase/249.md) then added a **rejection surface**: because
\#237's answer path clears the prompt optimistically, an ungranted device's answer round-tripping to a
daemon `error` (correlated by [#248](../codebase/248.md)) had nothing left on screen to show it — see
§ Rejection surface below.

`PermissionModal.tsx`, mirroring `RepairPrompt`/`RepairControl`:

- **`PermissionModalView({ prompt, pendingOption, onSelect, onConfirm, onBack, onCancel })`** — pure,
  exported. Renders a centered M3 dialog (Figma "Dialogs", node `22-3`) reusing `StatusSheet`'s
  overlay+scrim *structure* (`role="dialog"`, `aria-modal="true"`, a dedicated scrim, an opaque panel,
  absolutely positioned inside `.conversation`, no portal) but centers the panel instead of
  bottom-anchoring it, and uses a distinct class set (`.permission-modal-overlay`/`.permission-modal`/…)
  rather than the status-sheet classes — the two modals share a chrome pattern, not a stylesheet.
  `title`/`prompt`/`options[].label` render as React children (auto-escaped, never
  `dangerouslySetInnerHTML`). The `pendingOption: ModalOption | null` prop (#226) selects one of two
  render modes — a **prop**, not internal `useState`, so both modes stay SSR-testable:
  - **List mode** (`pendingOption === null`) — one `<button type="button">` per option in array order,
    keyed by `option.id`, each `onClick={() => onSelect(prompt.modalId, option.id)}` (renamed from
    #237's `onAnswer` — every click now routes through the container's gate rather than answering
    directly). The option whose `id` matches `defaultOptionId` carries the
    `permission-modal__option--default` modifier — a filled-tonal pill (`--color-secondary-container`)
    against the plain `--color-primary` text-button treatment of the others. A leading cancel button,
    `.permission-modal__cancel` (its own class, not `.permission-modal__option`), is prepended to the
    action row with `onClick={() => onCancel(prompt.modalId)}` and the client-owned label `Cancel`; CSS
    gives it `margin-right: auto` so it sits at the row's far left while the daemon options stay
    right-aligned — a code-review SHOULD-FIX from #237 flagged this as diverging from the Figma Dialogs
    reference (which clusters Cancel at the trailing/right edge next to the confirm action) and asked
    the PO/architect to confirm the placement; **still unresolved**, see [#237 codebase
    notes](../codebase/237.md).
  - **Confirm mode** (`pendingOption` set, #226) — the same chrome, title still shown, a client-owned
    confirm sentence naming `pendingOption.label` (auto-escaped, since the held option's label is still
    untrusted daemon text even quoted back to the user), and a two-button row: leading `Back`
    (`.permission-modal__back`, `onClick={() => onBack()}`) / trailing `Confirm`
    (`.permission-modal__confirm`, `onClick={() => onConfirm(prompt.modalId, pendingOption.id)}`). The
    daemon option list is **not** rendered in this mode.
- **`PermissionModal()`** — the store-bound container: `useModalStore(selectOutstanding)` plus
  `useModalStore(s => s.dispatch)` (#237), renders `outstanding[0]` via `PermissionModalView`, or `null`
  when nothing is outstanding. One dialog at a time, oldest-first FIFO; no `selectCurrentModal` selector
  (ADR 0009 defers it — the container derives `[0]` locally). Gained one `useState<PendingConfirm |
  null>` (#226, re-keyed by [#511](../codebase/511.md)), `pending` — declared **before** the
  early-return (rules-of-hooks) — holding `{ modalId, optionId }`, not a bare option id. Daemon option
  ids are a closed per-class vocabulary (`permission` → `allow_once`/`allow_always`/`reject_once`/
  `reject_always`, `trust` → `proceed`/`exit`), not per-prompt nonces, so a bare-id marker was
  guaranteed to match same-class prompts other than the one it was armed on — #511 fixed this. A new
  pure `resolvePendingOption(prompt, pending)` in `modalResolution.ts` derives `pendingOption` every
  render against the **current** prompt, not a cached snapshot: `null` unless `pending.modalId ===
  prompt.modalId` (the correlation key, and the actual fix — `modalId` is a daemon-minted
  `crypto/rand` UUIDv4, distinct per prompt) **and** `prompt.options` still contains that `optionId`
  (retained as the within-prompt net for a `shown` re-delivery that changes the option set, and how the
  `ModalOption` the confirm sentence names is obtained). Re-deriving rather than clearing on a prompt
  change means a stale marker is inert — it can only ever match the prompt it was minted against — so
  the empty-`outstanding` window (the container returns `null` but stays mounted, per
  `ConversationScreen.tsx`) is structurally safe rather than defended. `onSelect` routes through the
  pure `selectOption` gate in `modalResolution.ts` (unchanged by #511): the default option answers
  straight through (`answerPrompt`, unchanged from #237); any other option calls `setPending({ modalId,
  optionId })` — the identity captured from the click's own `modalId`, not re-read from a possibly-newer
  store — and holds. `onConfirm` calls `answerPrompt` then clears the pending marker; `onBack` just
  clears it (no send). `onCancel` is unchanged from #237 (`cancelPrompt`, never gated). All handlers
  dereference `window.pyry.sendCommand` only inside the closures (#237's discipline). Since
  [#249](../codebase/249.md), also reads `useModalStore(selectRejections)` and renders
  `RejectionSurfaceView` alongside `PermissionModalView` — see § Rejection surface below.

Mounted as the **last child** of `.conversation` in `ConversationScreen.tsx`, after the conditional
`StatusSheet`, so it overlays the whole conversation surface. Selecting the default option or clicking
Cancel dispatches `answerModalCommand`/`cancelModalCommand` (#236) immediately, exactly as #237 shipped
it; selecting any other option now holds (#226) until `Confirm` dispatches the same
`answerModalCommand` or `Back` returns to the list with no send. Either terminal path (answer or
cancel) clears the prompt **locally and optimistically** via the existing `dismissed` reducer arm — no
new store representation, no new event arm, no wire change for #226 or #511. Was inert in production
until [#179](../codebase/179.md) flipped the `interactive` capability (previously no `modal_shown` frame
arrived, so nothing to answer); now live. See [#224 codebase notes](../codebase/224.md) for the
original render design, [#237 codebase notes](../codebase/237.md) for the answer-path design and the
still-open code-review items (Cancel placement, focus trap/`Escape`, programmatic default-option cue),
[#226 codebase notes](../codebase/226.md) for the second-confirm gate design, and [#511 codebase
notes](../codebase/511.md) for the pending-marker fix — the staleness gap #226 and #510's code reviews
both flagged against the bare-option-id key is now resolved, not still open.

### Rejection surface (#249)

Because the answer path (#237) clears `outstanding` **optimistically** on click, an ungranted device's
answer round-tripping to a daemon `error` (correlated main-side by [#248](../codebase/248.md) into a
content-free `modalAnswerRejected` event) had no prompt left on screen to attach to — the user just
watched it vanish with no explanation. This slice adds a second, **orthogonal** surface at the same
host, fed by a new `rejections: readonly string[]` slice on `ModalState` (arrival-ordered,
de-duplicated `modalId`s — see [Modal-prompt model](modal-prompt-model.md)):

- **`RejectionSurfaceView({ rejections, onDismiss })`** — new, exported, pure, SSR-testable, mirroring
  `PermissionModalView`. Returns `null` on an empty list (the `Timeline`/`ThinkingIndicator`
  zero-layout-footprint idiom). Else renders `.modal-rejections`, one `.modal-rejection` banner per id
  (**keyed by `modalId`**), each with `role="alert"` (a live region — a screen reader announces the
  failure on arrival), the client-owned category copy **"Your answer was rejected."**, and a `Dismiss`
  button calling `onDismiss(modalId)`. The `modalId` is used **only** as the React key and the
  `onDismiss` argument — never rendered as visible text (it is meaningless to a human and the prompt
  title is already gone). No daemon content anywhere: the event carries none, the copy is a client
  constant. `onDismiss` is a **required** injected prop (the "a view that cannot answer is a bug" rule).
- **`PermissionModal()`** — extended, not forked: reads the new `selectRejections` slice alongside
  `selectOutstanding`; the early return now fires only when **both** are empty
  (`if (!prompt && rejections.length === 0) return null`), since a rejection can render with no
  outstanding prompt; `pendingOption` is guarded on `prompt` existing (it can be `undefined` while a
  rejection shows alone). Returns a fragment: `<PermissionModalView>` only when `prompt` exists, plus
  `<RejectionSurfaceView>` unconditionally, wired with an inline
  `dispatch({ type: 'rejectionDismissed', modalId })` — deliberately not a `modalResolution.ts` helper,
  since it neither sends a command nor renames to the wire.
- **Styling** (`conversation.css`) — `.modal-rejections` is a bottom-anchored absolute stack inside
  `.conversation`, `pointer-events: none` so it never blocks the composer beneath it (each
  `.modal-rejection` banner re-enables its own `pointer-events: auto`). Each banner is a
  `--color-surface-container-high` card with a `--color-error` `border-left` accent (a leading accent,
  not a filled error container — only the bare `--color-error` role token exists, #230). No new theme
  tokens. No bespoke Figma design exists for this surface yet (PO-confirmed gap in node `22-3`); the
  chrome is a placeholder reusing the modal/M3 tokens pending a follow-up.

Not security-sensitive — a pure renderer reading an already-typed, content-free event; no keys, sockets,
tokens, or raw bytes (the guarantee was defended upstream by #248). See [#248 codebase
notes](../codebase/248.md) for the transport half and [#249 codebase notes](../codebase/249.md) for the
full render design, testing strategy, and lessons learned.

## The interactive flip + thread cutover (#179)

The on-switch for the whole structured surface above. `loadDialConfig` (`daemonConnection.ts`) now
passes `capabilities: [CAPABILITY_INTERACTIVE]` to `buildClientHello` — the single production call
site, previously always `[]`. `interactive` is the only capability in the vocabulary, so advertising
it turns on everything the daemon offers a paired interactive client: the v2 structured stream (turn
state, deltas, tool use/result, thinking) and the `modal_shown` prompts, all decoded by the
already-shipped, previously-inert transport (#199–#230) and rendered by the already-mounted pipeline
above. The daemon's accepted set echoes back on `hello_ack.capabilities`, surfaced unchanged on the
`connected{ack}` event (`parseHelloAck` already did this — no production change needed for that half).

Advertising `interactive` stops the daemon's coarse `message` fan-out in the same instant
(pyrycode #699), so the flip and the render cutover **land in one commit**:

- **The composer's echo retargets.** `Composer`'s `dispatch` now reads
  `useTimelineStore((s) => s.dispatch)` instead of `useSessionStore((s) => s.dispatch)`;
  `composerSend.ts`'s `submitMessage` dispatches `{ type: 'userText', text: trimmed }` (the
  [#245](../codebase/245.md) event) instead of a `messageSent` `SessionAction`. The `message_id`
  minted in `submitMessage` is now used for the **wire** command only — the old "reuse the id so the
  daemon's re-echo dedupes" rationale is retired: in interactive mode the `DaemonEvent` union carries
  no user-message arm and the coarse fan-out is off, so the optimistic echo is the sole source of the
  user's own message and needs no dedup key.
- **`TimelineRow`'s `case 'userText'`** (the [#245](../codebase/245.md) dormant placeholder) now draws
  the right-aligned user bubble — `.message-row--user` / `.bubble--user` (`data-thread-role="user"`,
  distinct from `MessageBubble`'s `data-message-role`), reusing the coarse thread's own user-bubble
  treatment verbatim (no new CSS). Text renders as auto-escaped React children, never
  `dangerouslySetInnerHTML`.
- **`MessageThread` is retired.** Its mount (`<MessageThread messages={messages} />`) and the
  `useSessionStore(selectMessages)` read are removed from `ConversationScreen`. `MessageThread` /
  `MessageBubble` / `messageViewModel.ts` / `selectMessages` all stay as **dead-but-tested residue**
  (deliberate — a later cleanup ticket removes them); `sessionStore.messages` is populated but unread.

`Timeline` is now the conversation's **single** thread surface: the user's `userText` echo and the
daemon's structured reply share the one ordered `timelineStore.items` array, so arrival order gives
one continuous thread with no split-brain and no empty second region. See
[#179 codebase notes](../codebase/179.md) for the full design, the security review, and lessons
learned.

## Session-boundary delimiter (#286, redrawn #690)

The fifth `ThreadItem` kind's render row (transport half was #285): marks where a `/clear`, an idle
eviction, or a workspace change started a fresh session. `TimelineRow`'s `sessionBoundary` case renders
a `<div className="session-delimiter">` — deliberately **no `data-thread-role`** (AC4, keeping it out of
the assistant/user/tool bubble count).

**#286 shipped it in mobile's shape** (Figma node 16-35): a monospace title stacked above a single
full-width rule, the title joined to a **long-form** relative time (`formatSessionBoundaryTime`, `2
hours ago` — a deliberate sibling of `channelListViewModel.ts`'s short-form `formatLastActivity`) via a
`now` prop threaded from `ConversationScreen`'s `Date.now()` through `Timeline` → `TimelineRow`. Copy for
`clear`/`idle_evict` was provisional (`New session` / `New session after idle`) since the Figma drew only
the `workspace_change` variant.

**#690 redrew it as the desktop chat screen's own shape** (Figma node 119-3843): one 16px-tall row —
hairline rule, centred label, hairline rule — replacing the stacked layout. Two copy decisions the
operator took 2026-08-22 drove the change: the reason still has to read differently in the words
themselves, so the label is no longer provisional — `Session reset` for `clear`, `Session reset after
idle` for `idle_evict`, narrower than the Figma's single "Session reset" node — and the relative time is
gone entirely, since every message above and below the row already carries its own timestamp.
`sessionBoundaryTitle(item)` in `sessionBoundaryViewModel.ts` collapsed from the two-function long-form
module into a single exhaustive label switch (`workspace_change` unchanged: `Workspace changed to
${workspaceCwd}`, degrading to the pathless `Workspace changed` on a `null` path); `formatSessionBoundaryTime`
and the `now` prop threaded through `Timeline`/`TimelineRow` for its sake are both deleted —
`ConversationScreen`'s own `now` stays, since the [Channel Info](#channel-info-sheet-365) and [Workspace
Picker](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) sheets still read it for their own relative-time lines.

The row is now two identically-classed `.session-delimiter__rule` siblings bracketing the centred label,
each `flex: 1 0 0` inside a `nowrap` flex row — equal halves at every container width by construction,
nothing kept in sync via a width or percentage. The label takes `--color-primary` and `--font-sans`
body-small (no `font-family` declaration — `.conversation` already sets `--font-sans` and a `<p>` has no
UA font-family to fight); the two hairlines take a new token, `--color-inverse-primary` (`#32628d`, M3
Schemes/Inverse Primary, `tokens.css`), at the Figma's own 60% opacity. `workspaceCwd` (an untrusted
daemon filesystem path) still reaches the DOM only inside the label string as auto-escaped React
children — the `toolCall`/`userText` posture, unchanged since #286. Both rules stay decorative
`aria-hidden` styled `div`s, not semantic `<hr>`s.

Row clearance (16px above/below) is the *sum* of `.conversation__thread`'s `gap: var(--space-3)` (12px)
and the row's own `--space-1` padding (4px) — not `--space-4`, which would double the container's
existing gap into 28px. AC5 (equal halves under resize; a long unbroken workspace path wrapping inside
the row rather than stranding a rule) was settled as review-by-inspection in the spec, since nothing
under `renderToStaticMarkup` can measure layout — but the PR discovered that the Playwright Electron tier
actually *can* resize the window (`app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]
.setSize(w, h))`; `page.setViewportSize` still does not apply to an Electron page), so AC5 was verified
by measuring real rects at 800px and 1600px rather than only inspected. The explanatory sentence and
`Install` affordance (Figma 16-38, #286's mobile file) remain out of scope, deferred with the
memory-plugin subsystem neither ticket depends on. See [#286 codebase notes](../codebase/286.md) for
\#286's original design and patterns established.

## Queued backlog + drop affordance (#294, drop since #296)

The [queue store](queue-store.md)'s held backlog (per-conversation `QueuedItem` rows the daemon has
accepted but not yet run) renders as `QueuedBacklog`, an exported pure view mounted after
`<ThinkingIndicator/>` and before the status row's `<StatusRow/>` trigger. Empty → `null` (no
region, no chrome — the `ThinkingIndicator` posture); non-empty → one row per item, in enqueue
order, inside a `.conversation__queued` wrapper dimmed to 50% opacity (the `.tool-row` pending
precedent, the single "waiting / not yet run" signal). Each row reuses the delivered user-bubble
treatment (`message-row--user` / `bubble--user`) but is tagged `data-thread-role="queued"` —
distinct from a delivered row's `data-thread-role="user"`. `QueuedBacklogControl`, the in-file
container, binds a module-scope-hoisted `selectBacklogFor(MILESTONE_CONVERSATION_ID)` (the same
milestone constant the composer sends under — this screen has no conversation id in nav scope, and
the spec explicitly ruled out threading one through for this slice).

[#296](../codebase/296.md) added a **drop / cancel affordance** to each row: an icon-only button, a
leading sibling of the bubble (the row is right-aligned, so leading sits it at the inner edge),
carrying a client-owned `aria-label="Drop queued message"` and an inline `aria-hidden` SVG glyph.
`onDrop` is a **required** injected-effect prop on `QueuedBacklog` (the `PermissionModal` "a view
that cannot answer is a bug" rule) — the container binds it to the pure `dropQueuedMessage` helper
(`dropQueuedMessage.ts`), supplying `MILESTONE_CONVERSATION_ID` and dereferencing
`window.pyry.sendCommand` only inside the click closure. Activating it dispatches
`dequeueMessageCommand` (see [Dequeue message envelope](dequeue-message-envelope.md)) and nothing
else — **no optimistic removal**: the row disappears only when the daemon's next `queue_state`
snapshot replaces the backlog and this same store subscription re-renders. The button exists only
inside `QueuedBacklog`; `Timeline` draws every delivered row and is untouched, so "affordance only
on queued rows" and "delivered rows unaffected" are structural guarantees, not conventions. The
drop button inherits the region's 50% dimming (a child's own opacity cannot escape a parent opacity
compositing group) — shipped dimmed by design; see [#296 codebase notes](../codebase/296.md).

No Figma coverage for either the queued row or its drop control — the same documented gap as
[#148](../codebase/148.md)'s thread-chrome states: the mobile file draws only the populated,
delivered thread (node 16-8/16-21). See [#294 codebase notes](../codebase/294.md) and [#296
codebase notes](../codebase/296.md) for full design and patterns established.

## Screen-snapshot action & display (#324, removed #618)

The view half of #318's store/render split (store half: [#323](../codebase/323.md)) — a request
button between `<StatusRow/>` and `<InterruptControl/>` (`ScreenSnapshotControl`, `.screen-snapshot`)
that fired the `requestSnapshot` command, plus a bounded `<pre>` panel (`.screen-snapshot__screen`,
`max-height: 240px; overflow: auto`) showing the daemon's held rendered-screen text, with a distinct
`.screen-snapshot__empty` placeholder before any reply arrived.

**Removed in [#618](../codebase/618.md).** The feature it exposed — photographing claude's terminal
— was deleted upstream (pyrycode#1348); the daemon now wires `Snapshotter: nil`, so the button
rendered enabled and did nothing, with no error shown. #618 took only this visible surface:
`ScreenSnapshotView`, `ScreenSnapshotControl`, both copy constants, `requestScreenSnapshot.ts`, and
the `.screen-snapshot*` CSS block are all gone, and the mount between `StatusRow` and
`InterruptControl` reverts to the two sitting adjacent. A raw-event view to replace this was
discussed and deliberately deferred, not built.

**What stayed, and what's since gone.** [`screenSnapshotStore`](screen-snapshot-store.md) and its
bridge stayed reader-less through #618's scope, then were deleted outright by
[#619](../codebase/619.md). The outbound `requestSnapshot` IPC command and its wire type were then
removed by [#620](../codebase/620.md); the inbound decode and its two events remain #621/#622's
removals. See [#324 codebase notes](../codebase/324.md) for the original design and patterns
established, [#618 codebase notes](../codebase/618.md) for the visible-surface removal and its comment
re-anchors, [#619 codebase notes](../codebase/619.md) for the state-layer removal, and [#620 codebase
notes](../codebase/620.md) for the outbound-transport removal.

## Channel Info sheet (#365)

Makes the thread overflow menu's **Channel info** item (#276, previously a live no-op) open a new
bottom sheet (Figma node 20-48), reusing the Run-configuration `StatusSheet`'s `.status-sheet__*`
chrome verbatim — the second sheet to do so. Renders the active conversation's **About** detail
(Workspace `cwd` + Last activity), an empty **Actions** section slot, and a monospace **Channel ID**
footer. Renderer-contained: no transport, IPC, or wire code.

```
.conversation
├── … (StatusSheet, when sheetOpen)
└── ChannelInfoSheet                    (mounted last, when channelInfoOpen)
    └── ChannelInfoSheetView
        ├── .status-sheet-overlay__scrim         (onClick → onClose)
        └── .status-sheet  role="dialog"
            ├── .status-sheet__handle
            ├── .status-sheet__header             title (name / "Unnamed conversation" / "Channel info") + close
            └── .status-sheet__body
                ├── "About" section-header
                ├── .channel-info__row × 2          Workspace (mono, cwd) / Last activity  — or —
                ├── .channel-info__empty            "No conversation details yet" (conversation === null)
                ├── "Actions" section-header
                ├── .channel-info__actions          mount point for #366/#367/#368 (Rename+Archive built, Delete #367 open)
                └── .channel-info__footer           "Channel ID: {id}" (omitted when conversation === null)
```

**Open-state ownership stays local, not threaded through `PairedShell`.** `channelInfoOpen` is a new
`useState(false)` in `ConversationScreen` — the `sheetOpen` precedent (ADR 0006) — flipped by the
overflow menu's `onChannelInfo={() => setChannelInfoOpen(true)}`. This is a deliberate divergence from
\#276's original design: #276 shipped a speculative `ConversationScreenProps.onChannelInfo?` seam
assuming the sheet would live *above* `ConversationScreen` (opened by `PairedShell`). #365 retired that
prop instead (removed from the interface and the destructure) because the sheet's trigger, data
(`activeConversationStore`), and chrome are all `ConversationScreen`-local, exactly like `StatusSheet` —
splitting one sheet's control across two files for zero behavioral gain would have contradicted the very
precedent the seam was named after. No caller ever passed `onChannelInfo` (`PairedShell`, `App.tsx`, and
every test constructed props without it), so the removal is a pure simplification, not a breaking change.

**`conversation === null` renders gracefully, not a crash.** [`activeConversationStore`](conversation-shell-workspace-and-run-config.md#workspace-chip-278)
is written on exactly one path — the FAB create-nav callback — so a thread opened from the channel list
never populates it (the app's single-active-conversation interim). The sheet still opens: chrome + a
`CHANNEL_INFO_EMPTY_COPY` placeholder line in place of the About rows, and the Channel ID footer omitted
entirely (there is no id to show). `conversation.name === null` (an unnamed scratch conversation) is a
separate, narrower case — the title falls back to `UNNAMED_CONVERSATION_LABEL` — distinct from no
conversation at all.

**Deferred, not invented:** Figma 20-48 also shows Created / Total sessions / Total messages rows and a
Memory section — none has a field on the desktop `ConversationCreatedPayload`, so none is built. The
Channel ID footer ships at the app's `body-small` (12px) mono token rather than Figma's 11px — a
type-scale simplification (the app's fixed vocabulary is the fidelity ceiling, not a literal Figma
pixel match), not drift.

Escape-to-dismiss is wired via the same `document`-`keydown`-listener-scoped-to-mount-lifetime idiom
\#276 established (`DocumentEventMap['keydown']`, not a bare `KeyboardEvent` — this file's top-level
`import { type KeyboardEvent } from 'react'` shadows the DOM type). Untested here, same as #276's
Escape/outside-click and `StatusSheet`'s open-on-click wiring — the suite is `renderToStaticMarkup`-only,
no jsdom, so interactive effects are reviewed glue, not asserted. Not security-sensitive: the only daemon
strings rendered (`name`/`cwd`/`id`) are already rendered elsewhere in this file as auto-escaped React
children, same posture as `WorkspaceChip`. See [#365 codebase notes](../codebase/365.md) for the full
design and patterns established.

**Rename action ([#368](../codebase/368.md)).** The Actions slot's first filler: a Material 3 tonal
pill (Figma 20:89, `.channel-info__action`) rendered only when the container supplies an `onRename?`
callback — supplied exactly in the `conversation !== null` branch, so the null-conversation
graceful-empty case (above) offers no Rename control either. Activating it seeds and opens the
existing [Rename dialog](rename-conversation-dialog.md) (`RenameConversationDialogView`, #360) via a
second screen-local `useState` pair (`renameOpen`/`renameName`) the `ChannelInfoSheet` container
grows, mirroring `ChannelList.tsx`'s row-level rename state shape; Save dispatches the already-shipped
`renameConversation` command (#359) via `requestRenameConversation`, imported verbatim rather than
cloned. That helper's `row` param narrowed from `ConversationSummary` to `Pick<ConversationSummary,
'id'>` (it only ever read `.id`) so the sheet's `ConversationCreatedPayload` — a narrower 5-field
shape lacking `is_archived`/`last_message_ts` — passes directly, no adapter, no cast; the existing
`ChannelList` call site is unaffected (a wider shape still satisfies the narrower `Pick`). No new
transport, IPC, or wire code. See [#368 codebase notes](../codebase/368.md) for the full design and
patterns established.

**Archive action ([#366](../codebase/366.md)).** The Actions slot's second filler, landing one
merge after Rename and reusing its `.channel-info__action` tonal pill (Figma 20:94) verbatim — no
new CSS. Same callback-gate shape as Rename (`onArchive?`, supplied by the container only when
`conversation !== null`), but the handler itself is simpler: no dialog, just dispatch-then-close.
Activating it fires the already-shipped, previously-dormant [`archiveConversation`
command](conversation-archive.md) (#363) via a new exported helper, `requestArchiveConversation` —
a structural clone of `requestUnarchiveConversation` (`ArchiveScreen.tsx`) — with
`{ conversation_id: conversation.id }`, fire-and-forget, then calls the container's existing
`onClose`. Button order is Rename → Archive → the future Delete (#367), a destructive-last
convention. The archived conversation leaving the active list needs no new code here: the daemon's
`conversation_updated` broadcast reply rides the existing #275 list-re-request path, the same
mechanism the restore flow already proved in reverse (#346/#348). No transport, IPC, or wire code.
See [#366 codebase notes](../codebase/366.md) for the full design and patterns established.
