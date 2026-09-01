# Conversation shell — modals

The two overlays that act on one conversation as a whole rather than one turn, and take over the screen (or the composer's slot) to ask the operator something: the permission/trust modal and the question panel. Split out of [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md) on 2026-09-02 to keep that document under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

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

## Question panel (#906)

The render vertical's frame slice, over the model and bridge documented in [Question-batch
model](question-batch-model.md): `questionBatchStore` (#899) held the batches and `useQuestionBridge`
(#900) filled it, but nothing mounted the hook or read the store — #906 closes both gaps, the same shape
[Permission modal](#permission-modal-224-answerable-since-237-second-confirm-since-226-rejection-surface-since-249-confirm-marker-scoped-to-its-prompt-since-511)
above took for the modal vertical (#223 → #224). It draws the panel's chrome only: the title row, the
bordered box with the question's own text, a separator, and an inert Cancel/Continue row. The option rows
are #907's and the picks/send are #908's/#853's.

**`useQuestionBridge()` mounts in `App.tsx`**, beside `useModalBridge`, unconditional and app-lifetime —
not screen-scoped, because a batch is raised against a conversation the operator may not have open, the
same reasoning `ConversationActivityData` already carries in that file.

**`ComposerSlot({ conversationId, phase, onMessageSent })`** (`ConversationScreen.tsx`, exported) replaces
the screen's direct `<Composer/>` mount and is the store's first reader:

```ts
const batch = useQuestionBatchStore((s) =>
  conversationId === null ? undefined : selectBatchFor(conversationId)(s)
)
return (
  <>
    {batch && <QuestionPanelView question={batch.questions[0]} />}
    <Composer phase={phase} onMessageSent={onMessageSent} covered={batch !== undefined} />
  </>
)
```

`conversationId` arrives as a prop off `activeConversation?.id ?? null` — the `BackgroundTaskPanel` idiom
— so a batch arriving re-renders this leaf, never the whole screen. `selectBatchFor` is called inline with
no `useMemo`: `useStore` compares the selector's *result* under `Object.is`, and the held batch comes back
by reference, per the store's own ruling against memoising anything claude-authored into a lookup path.
`batch.questions[0]` is read with no guard and no `!` — `reduceQuestionBatches` never lets an empty
`questions` array reach `outstanding`, so the index always exists; a batch with several draws its first.

**`Composer` gained a required `covered: boolean` prop**, rendering `<div className="composer"
hidden={covered}>`. The native `hidden` attribute is the whole mechanism — one attribute that hides the
subtree, drops it from the tab order and drops it from the accessibility tree, while leaving every element
mounted, so the operator's half-typed draft (`Composer`'s own `useState`) survives the batch. A
conditional render would discard the draft; `aria-hidden` alone would leave a focusable invisible textarea
whose Enter still sends. `.composer__row` and `.composer__footer` are children of `.composer`, so the one
attribute takes the send/stop control and the footer menus with it — there is no second element to hide
and no disabled state to draw for either. `ComposerStatusArea` is `.composer`'s **sibling**, not a
descendant, and stays visible and untouched throughout.

**`conversation.css` needed an explicit `.composer[hidden] { display: none }`.** The UA stylesheet's
`[hidden] { display: none }` loses outright to the author-level `.composer { display: flex }` regardless
of specificity, so without this rule the attribute is a no-op for layout — the composer keeps painting
under the panel — and only its accessibility half works, silently, which is the trap: it looks fine on
screen and is broken for a keyboard.

**`QuestionPanelView({ question })`** (new file, `QuestionPanel.tsx`) is the pure, exported view — the
\#224 split, testable by `renderToStaticMarkup` from an injected `Question` fixture. `question.header` and
`question.question` are claude-authored and render as plain React children only, auto-escaped, never
`dangerouslySetInnerHTML`. **No `title` attribute on the clamped question text** — the reflex accompaniment
to a single-line ellipsis clamp, and the one trap the component invites, since it would put untrusted text
into an attribute, the ban `questionBatchStore.ts` states by name. No `data-*` derived from `header`,
`question`, or the nonce `questionBatchId` either, which this slice never reads. The title row draws
exactly one label (`347:6829`'s other four slots and Previous are hidden in the single-question instance)
using the already-shipped `PyryMark` at `width={14} height={16}`, the composer status row's call verbatim.
Cancel and Continue are `<button type="button">` with no `onClick` and no `disabled` — inert, not greyed,
since the panel sits on top of the composer and there is nothing to disable.

**Colours came from the Figma variables on node `347:6913`, never the generated fallbacks** (which print
the light scheme, per `tokens.css`'s standing warning): Tertiary, On Background, Primary Container,
Primary, Background and On Primary resolve onto the existing `--color-tertiary`/`--color-on-surface`/
`--color-primary-container`/`--color-primary`/`--color-surface`/`--color-on-primary` tokens, since M3 dark
defines Background = Surface. Two new tokens, `--text-body-medium-weight-emphasized` and
`--text-body-small-weight-emphasized` (both `500`), were minted for the question text and the button
labels rather than a `font-weight: 500` literal at the call site.

**Testing.** `QuestionPanel.test.tsx` renders `QuestionPanelView` from injected fixtures: header/question
placement, the inert two-button row with no `disabled`, the decorative mark and separator, no option rows
drawn, and — the security-relevant cases — a `<img onerror>`/`<script>` fixture renders escaped with no
`<img`/`<script>` in the markup, and neither string reaches an attribute (`title=`, `data-`). Since the
`QuestionPanel.tsx` module never imports React's `dangerouslySetInnerHTML` path, escaping is structural,
not merely tested. `composerSlot.test.tsx` covers the container with a per-file `createQuestionBatchStore`
instance bound over `useQuestionBatchStore` via `vi.mock` (the singleton's server snapshot is frozen at
store *creation*, so seeding it directly would silently assert the initial cell) — the panel-and-cover
pairing, the covered subtree still holding the message box/send control/footer, a batch for a different
conversation or `conversationId={null}` leaving the composer untouched, `ComposerStatusArea`'s markup
never appearing from this container in either state, and the first-of-several-questions draw.

**Security review: PASS** (architect self-review). One finding raised and fixed before the plan closed:
the design's own single-line clamp invites a `title` tooltip, which would be claude-authored text in an
attribute — the Design section now forbids it and every derived `data-*`, and the review re-walked the
plan afterward finding only JSX-children sinks left. Everything else no-findings: no new IPC channel, no
`window.pyry` dereference during either component's render (so both server-render tests stay clean), no
logger call, no comparison beyond the store's existing `===` scan, and the two claude-authored strings are
already size-bounded by the transport's 256 KiB frame cap plus the panel's own one-line clamp. Out of
scope, by design rather than oversight: a daemon that raises a batch and never dismisses it covers that
conversation's composer indefinitely, since this slice draws no expiry (settled 2026-08-31 — the timeout
is a daemon matter) and Cancel dispatches nothing; the exposure is bounded to the one conversation, and a
`reconnected` arm still clears every held batch on each handshake.

