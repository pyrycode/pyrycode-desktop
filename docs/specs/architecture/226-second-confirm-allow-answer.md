# #226 — Second-confirm: a client-side confirm before an allow answer

**Ticket:** [#226](https://github.com/pyrycode/pyrycode-desktop/issues/226) · Split from #201 · Blocked-by #237 (merged)
**Size:** S · **Not security-sensitive** (renderer-only UX gate; no keys, sockets, or wire bytes — the answer-frame construction is #236/#237's).

## Context

A permission/trust modal lets `claude` ask the desktop user to approve an action. The answer path already ships (#237): each daemon option button dispatches a `modal_answer`, the leading cancel dispatches a `modal_cancel`, both clearing the prompt locally. There is **no machine-readable "destructive" signal on the wire** — `class` is `permission | trust` only (ADR [0009](../../knowledge/decisions/0009-modal-prompt-model.md)). So "a consequential action needs a second confirm" can only be a **client-side UX policy** on the answer path.

This slice inserts a confirm step in front of the answer dispatch for the deliberate-move-away case only: **selecting a non-default option** (anything other than the fail-safe deny default) surfaces a confirm sub-step before the `modal_answer` command is sent. The default option and the cancel affordance stay ungated — they resolve immediately, exactly as today.

**The only signal available to classify "allow"** is `ModalPrompt.defaultOptionId` (a required `string`, the fail-safe deny default that already carries the `--default` treatment in `PermissionModalView`). There is no per-option "allow" flag. So: **gate on `option.id !== prompt.defaultOptionId`.** The degenerate case where the sole option *is* the default (a single-option trust prompt) is correctly ungated — the only choice is the safe default.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=22-3

The Dialogs section is a set of centered M3 dialogs — a dark surface panel with a headline title, body text, and a right-aligned action row of text buttons (a leading dismissive action on the left, the trailing primary action on the right; e.g. *Cancel / Save*, *Cancel / Create*, *Cancel / Pair*). The existing `PermissionModal` chrome (title + prompt + right-aligned `permission-modal__options` row with a leading `permission-modal__cancel`) already reproduces this, and the confirm sub-step **reuses that same chrome** — a title, a short client-owned confirm sentence, and a two-button action row (`Back` leading / `Confirm` trailing). **The confirm-step affordance itself is not drawn in Figma** (as #199's node was absent); it is a client-owned sub-step assembled from the existing Dialogs chrome and needs no new node. No new theme tokens.

## Files to read first

- `src/renderer/src/screens/conversation/PermissionModal.tsx` (whole file, 114 lines) — the pure `PermissionModalView` + thin `PermissionModal` container seam this ticket extends. The `isDefault = option.id === prompt.defaultOptionId` check at line 67 is the classification signal reused by the gate.
- `src/renderer/src/screens/conversation/modalResolution.ts` (whole file, 62 lines) — `answerPrompt` / `cancelPrompt`, the injected-effect helpers. `selectOption` lands here alongside them, same pure/plain-spy shape.
- `src/renderer/src/screens/conversation/modalResolution.test.ts` — the plain-spy idiom (`vi.fn()` deps, no React/store/DOM). `selectOption`'s tests follow this exactly.
- `src/renderer/src/screens/conversation/PermissionModal.test.tsx` — the `renderToStaticMarkup` SSR idiom + the `optionCount` matcher. Confirm-mode tests are added here; existing `onAnswer`→`onSelect` rename touches `renderView`.
- `src/renderer/src/store/modalPrompts.ts:14-27` — `ModalOption` and `ModalPrompt` shapes (the view's `pendingOption` prop is a `ModalOption | null`). Confirm the reducer/store is NOT touched (no new `ModalEvent` arm).
- `src/renderer/src/screens/conversation/conversation.css:511-618` — the `permission-modal*` rules. The Back/Confirm buttons extend the shared text-button selector group at lines 585-598; `.permission-modal__cancel`'s `margin-right: auto` (line 608) is the leading-placement idiom to copy for `Back`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:79` — the sole consumer (`<PermissionModal />`); confirms there is no edit fan-out.
- `docs/knowledge/decisions/0009-modal-prompt-model.md` — why there is no `destructive` wire class (the premise of this whole ticket).

## Design

Three moving parts, all in the renderer: a **pure gate helper** (the classification + routing branch, where the AC3 test lands), a **stateless view** that renders either the option list or the confirm sub-step from a prop, and a **container** that holds the transient confirm state and wires everything.

### 1. The gate — `selectOption` (pure helper in `modalResolution.ts`)

The routing branch lives in a pure, React-free helper so it is testable with plain spies under the `node` test environment — the same discipline as `answerPrompt`/`cancelPrompt`. It does **not** send or dispatch itself; it routes to one of two injected effects.

```ts
export interface SelectOptionDeps {
  answer: (optionId: string) => void          // straight-through: the default (ungated) path
  requestConfirm: (optionId: string) => void  // held: enter the confirm sub-step
}

// Route a just-clicked option. The default (fail-safe deny) resolves immediately; any other
// option is held pending a second confirm. Consults ONLY prompt.defaultOptionId (ticket §Classification).
export function selectOption(prompt: ModalPrompt, optionId: string, deps: SelectOptionDeps): void
```

Behavior: if `optionId === prompt.defaultOptionId` → `deps.answer(optionId)`; else → `deps.requestConfirm(optionId)`. The degenerate single-option-is-default prompt routes to `answer` (ungated), which is correct. Invariants asserted in `modalResolution.test.ts` (see Testing).

### 2. The view — `PermissionModalView` gains a `pendingOption` prop

Keep the view **pure** (`props in → markup out`), so both render modes are SSR-testable under the `node` environment — this is why the confirm state is a *prop*, not internal `useState`. The `onAnswer` prop is renamed to `onSelect` (every option click now routes through the gate; the container decides answer-vs-hold).

New signature (contract — the developer writes the body):

```ts
export function PermissionModalView({
  prompt,
  pendingOption,                                       // ModalOption | null — null = list mode, set = confirm mode
  onSelect,   // (modalId, optionId) => void  — an option was clicked (list mode)
  onConfirm,  // (modalId, optionId) => void  — Confirm clicked (confirm mode); sends the held answer
  onBack,     // () => void                   — Back clicked (confirm mode); returns to the option list
  onCancel    // (modalId) => void            — Cancel clicked (list mode); unchanged from #237
}: {
  prompt: ModalPrompt
  pendingOption: ModalOption | null
  onSelect: (modalId: string, optionId: string) => void
  onConfirm: (modalId: string, optionId: string) => void
  onBack: () => void
  onCancel: (modalId: string) => void
}): JSX.Element
```

Render behavior:

- **`pendingOption === null` (list mode)** — the existing render, with two changes only: option buttons call `onSelect(prompt.modalId, option.id)` instead of `onAnswer`; the `--default` marking, the leading `Cancel`, the untrusted-text escaping, and the dialog chrome are all unchanged.
- **`pendingOption` set (confirm mode)** — the same `.permission-modal` chrome (title still shown, so the user stays oriented on what they are approving), a short **client-owned** confirm sentence naming `pendingOption.label` (e.g. *Send "{label}"?* — client copy, not daemon text, rendered as auto-escaped React children like every other label), and a two-button action row: a leading `Back` (`onBack()`) and a trailing `Confirm` (`onConfirm(prompt.modalId, pendingOption.id)`). The daemon option list is **not** rendered in this mode.

The daemon-supplied `title`/`prompt`/`label` remain inert text (React children, never `dangerouslySetInnerHTML`) — the AC4 escaping guarantee from #224 is preserved in both modes.

### 3. The container — `PermissionModal` holds the transient confirm state

The container gains one `useState` and derives the pending option from the current prompt:

- `const [pendingOptionId, setPendingOptionId] = useState<string | null>(null)` — declared **before** the `if (!prompt) return null` early-return (rules-of-hooks; the empty-case SSR test still returns `null` because the hook runs first and the guard fires after).
- `const pendingOption = prompt.options.find((o) => o.id === pendingOptionId) ?? null` — derive from the *current* prompt's options. This is a **deterministic safety net**: if the outstanding `[0]` prompt is swapped out (e.g. a remote/timeout `dismissed` clears the current one and the next prompt renders) while a confirm is pending, a stale `pendingOptionId` no longer matches any option and the view falls back to list mode instead of confirming a wrong prompt.

Handler wiring (the four effects passed to the view):

| View callback | Container wiring |
|---|---|
| `onSelect(modalId, optionId)` | `selectOption(prompt, optionId, { answer: (id) => answerPrompt(modalId, id, deps), requestConfirm: setPendingOptionId })` |
| `onConfirm(modalId, optionId)` | `answerPrompt(modalId, optionId, deps)` then `setPendingOptionId(null)` |
| `onBack()` | `setPendingOptionId(null)` |
| `onCancel(modalId)` | `cancelPrompt(modalId, deps)` (unchanged from #237) |

where `deps = { sendCommand: window.pyry.sendCommand, dispatch }`, dereferenced inside the closures at interaction time (the existing container discipline). `answerPrompt`/`cancelPrompt` are unchanged — the actual send + optimistic local clear still live there. The gate adds no new send path; it only decides *when* `answerPrompt` fires.

### What is explicitly NOT touched

- **No store change, no new `ModalEvent` arm** — the confirm is transient view/container state, cleared on confirm or back. `modalPrompts.ts` and `modalStore` are untouched.
- **No wire change** — the answer frame is #236/#237's; this ticket sends the same `answerModal` command, just gated.
- **No new component** — the confirm sub-step is a render branch of the existing view, not a new exported component.

### CSS (`conversation.css`)

Minimal, reusing the existing text-button treatment:

- Add `.permission-modal__back` and `.permission-modal__confirm` to the shared text-button selector groups (the `.permission-modal__option, .permission-modal__cancel { … }` rule at ~585 and its `:focus-visible` sibling at ~600) so both inherit the pill / primary-label treatment.
- Give `.permission-modal__back` `margin-right: auto` (the `.permission-modal__cancel` leading-placement idiom) so Back sits left and Confirm right in the flex-end row.
- The confirm sentence reuses `.permission-modal__prompt` (body-medium, muted). No new tokens, no color literals.

## State + concurrency model

- **No store slice added.** The confirm state is one `useState<string | null>` in the container — the lowest scope that survives re-render, per CLAUDE.md's "local UI state kept in component-local `useState`". The single source of modal *prompt* state remains `modalStore`; the pending-confirm marker is ephemeral UI state derived against it, never persisted.
- **No async, no subscriptions, no cancellation surface.** Every transition (`select`, `confirm`, `back`, `cancel`) is a synchronous click handler. `answerPrompt`/`cancelPrompt` keep their existing guarded-send + unconditional-local-clear behavior.
- **Prompt-swap safety** handled by the `find(...) ?? null` derivation above (a stale pending id degrades to list mode).

## Error handling

Unchanged from #237. The only outbound effect is still `answerPrompt`/`cancelPrompt`, whose send is wrapped in a `try/catch` that swallows a bridge failure (AC4 from #237) and always posts the local `dismissed` clear. The gate introduces no new failure mode — a non-default selection that is never confirmed simply leaves the prompt outstanding (no send, no clear), which is the intended "held" state; the user can Back out or Cancel.

## Testing strategy

`npm test` (vitest, `node` environment — SSR + plain spies, **no** jsdom, no new dependency) + `npm run typecheck` + `npm run build`.

**`modalResolution.test.ts` — the gate (AC3 vehicle, plain spies):**
- default option (`optionId === prompt.defaultOptionId`) → `answer` spy called once with `optionId`; `requestConfirm` **not** called (dispatches straight through).
- non-default option → `requestConfirm` spy called once with `optionId`; `answer` **not** called (held pending confirm).
- degenerate prompt whose sole option **is** the default → `answer` called (ungated), `requestConfirm` not — the single-option-trust case.

**`PermissionModal.test.tsx` — the view, both modes via `renderToStaticMarkup`:**
- list mode (`pendingOption={null}`): existing assertions hold after the `onAnswer`→`onSelect` rename (one button per option, `--default` on the matching option, leading `Cancel`, `optionCount` unchanged, untrusted text escaped, dialog chrome/aria).
- confirm mode (`pendingOption={{ id, label }}`): renders the confirm sentence containing the option label, a `Back` button, and a `Confirm` button; does **not** render the daemon option list (`optionCount(markup) === 0`); untrusted context still escaped; chrome/aria preserved.
- container empty case (`renderToStaticMarkup(<PermissionModal />) === ''`) still passes — the added `useState` is declared before the early `return null`.

Coverage note: the confirm-mode *wiring* (Confirm → `answerPrompt`, Back → clear-without-send) is covered structurally by the SSR test (the buttons exist with their handlers) plus the already-tested `answerPrompt`; the `node` env fires no clicks, matching the established `PermissionModal`/`modalResolution` division of coverage — the branch that matters (held vs straight-through) is proven directly by the `selectOption` plain-spy test.

## Acceptance criteria mapping

- **AC1** (non-default surfaces confirm before send; confirm sends, back returns without sending) → `selectOption` routes non-default to `requestConfirm` (held, no send); container `onConfirm` fires `answerPrompt`, `onBack` clears without sending. Confirm-mode SSR render proves the Back/Confirm affordances.
- **AC2** (default + cancel ungated, resolve immediately) → `selectOption` routes default to `answer` (straight-through `answerPrompt`); `onCancel` still calls `cancelPrompt` directly — neither path enters confirm state.
- **AC3** (gate unit-testable via container/pure-view split, plain-spy idiom) → the `selectOption` tests in `modalResolution.test.ts`.
- **AC4** (`npm run build` + `npm test` green) → the typecheck/build/test gate.

## Open questions

- **Confirm copy.** Spec assumes a single client-owned sentence *Send "{label}"?* plus `Back`/`Confirm` labels. If a stronger warning tone is wanted (e.g. *This will grant the action*), it is a one-line copy change with no structural impact — developer's call within the existing markup.
- **Confirm-button emphasis.** Spec reuses the flat text-button treatment (matching the Figma Dialogs primary action, which is itself a text button). If a filled/emphasized Confirm is later wanted, add a `--emphasis` modifier reusing the `--default` filled-tonal recipe; not required for this ticket.
