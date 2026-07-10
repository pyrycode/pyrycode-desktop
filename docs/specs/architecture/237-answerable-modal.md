# Spec #237 — Answerable modal: option buttons dispatch `modal_answer` / `modal_cancel` and clear the prompt

The terminal render slice of #225's outbound modal-answer path (last of the #201 modal vertical).
#224 rendered the outstanding permission/trust prompt as a modal with the fail-safe default marked,
but the option buttons are **inert** (read-only, no `onClick`). #236 (merged PR #240) landed the
main-side command that mints the `answer_token` and sends `modal_answer` / `modal_cancel`. This slice
makes the modal **answerable**: wire the buttons to dispatch the command and clear the prompt locally
via the existing `dismissed` reducer arm, and add a new cancel affordance.

Renderer-only. No crypto, no sockets, no tokens, no raw bytes (the `answer_token` is minted main-side
in `daemonConnection.answerModal`, #236). **NOT security-sensitive.**

---

## Files to read first

| Path | What to extract |
|------|-----------------|
| `src/renderer/src/screens/conversation/PermissionModal.tsx` (whole, 73 lines) | #224's `PermissionModalView` (pure) + `PermissionModal` (container) — the exact seam to extend. The option `.map` at `:40-57` gets `onClick`; the container at `:68-73` gains the wiring. |
| `src/renderer/src/screens/conversation/PermissionModal.test.tsx` | The `renderToStaticMarkup` server-render pattern + the `optionCount` helper (`:12-14`, matches `type="button"`) — it must change to count option buttons specifically once the cancel button is added. |
| `src/renderer/src/screens/conversation/composerSend.ts:22-68` | **The precedent to mirror.** `ComposerSendDeps` (injected effects) + `submitMessage` (AC4 guard: `try { deps.sendCommand(...) } catch { console.error(...) }`, then `deps.dispatch(...)` **unconditionally**). `modalResolution.ts` is this shape. |
| `src/renderer/src/screens/conversation/composerSend.test.ts` | The plain-spy test pattern for a pure `deps`-injected helper (throwing `sendCommand` spy → assert `dispatch` still called). `modalResolution.test.ts` mirrors it. |
| `src/renderer/src/store/modalPrompts.ts:35-47` | The `ModalEvent` union. The `dismissed` arm is `{ type: 'dismissed'; modalId; outcome: string; source: 'remote' \| 'local' \| 'timeout' }` — `outcome` + `source` are **required by the type** but ignored by `reduceModal` (which consults only `modalId`, `:65-68`). |
| `src/renderer/src/store/modalStore.ts:38-45` | `useModalStore(selector)` hook + the `dispatch` write path (`s.dispatch`) + the `selectOutstanding` re-export. |
| `src/shared/ipc/commands.ts:33,83-94` | `AnswerModalCommandPayload = Omit<ModalAnswerPayload,'answer_token'>`; `answerModalCommand({ modal_id, option_id })` + `cancelModalCommand({ modal_id })` constructors returning `RendererCommand`. |
| `src/shared/wire/types.ts:325-340` | `ModalAnswerPayload { modal_id, option_id, answer_token }` and `ModalCancelPayload { modal_id }` — the **snake_case** field names the command payloads use. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:321-346,406-442` | The two idioms: `Composer.handleSubmit` (`:340-344`) derefs `window.pyry.sendCommand` **only inside the handler** (interaction time); `RepairPrompt` (`:406-421`, injected `onRepair` effect) + `RepairControl` (`:433-442`, container wiring). |
| `src/renderer/src/screens/conversation/conversation.css:575-611` | Existing `.permission-modal__options` (right-aligned flex row) + `.permission-modal__option` (M3 text-button) + `--default` (filled-tonal). The cancel affordance extends this row. |
| `vitest.config.ts:17` | `environment: 'node'` — **no DOM, no jsdom, no click firing.** This constrains the testing strategy (see below). Do not add a DOM test dependency. |

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=22-3

Node `22-3` is the Dialogs section (there is **no dedicated permission/trust modal node** — a genuine
Figma gap, confirmed; the modal content is daemon-supplied, so the design surface is the modal chrome,
mirroring #224). Each dialog is a bottom-anchored action row where a de-emphasized **Cancel** text
button sits at the **left** and the confirming action(s) at the **right**, both drawn as
`--color-primary` M3 text buttons (transparent fill, pill, label-large) with no filled background. The
new cancel affordance reproduces that leading-dismissive placement: a `--color-primary` text button
left-aligned in the existing `.permission-modal__options` action row, with the daemon-supplied option
buttons (and the filled-tonal `--default`) staying right-aligned. No new visual tokens; this slice adds
interaction + one button to #224's already-approved chrome.

*Figma gap note:* the missing dedicated permission-modal node is a known PO/design gap (same as #224 /
#199); the cancel affordance is confirmed against the Dialogs section here. No new Figma-side ticket is
required for this slice — the Dialogs action-row pattern fully covers the cancel button. If a dedicated
permission-modal node is later desired, that is a design-backlog item, not a blocker for this render.

---

## Context

The modal store (`modalStore` → `reduceModal`, #122/#223) holds an ordered `outstanding` array of
prompts; the container renders `outstanding[0]` (single-dialog FIFO, #224). Today the prompts never
arrive in production — the modal path is inert until #179 flips `interactive` — so, exactly like #224's
render, these buttons are wired but dormant until then. This slice does **not** flip `interactive`
(AC5).

The two facts that were invisible before #236/#224 merged (validated against the merged code):

1. **The `dismissed` event requires `{ modalId, outcome, source }`, not `modalId` alone.**
   `reduceModal` consults only `modalId` to clear, but the `ModalEvent` type demands `outcome`
   (string) + `source` — both carried for #227's resolution toast, not consulted by the reduce.
2. **camelCase store → snake_case command boundary.** The store's `ModalPrompt` is camelCase
   (`modalId`, option `id`); the command payloads reuse the snake_case wire types (`modal_id`,
   `option_id`). The rename happens at the dispatch site (the inverse of #223's bridge, which renames
   the other way).

---

## Design

Two changes, following the `composerSend.ts` (pure helper) + `RepairControl` (injected-effect view)
precedents the ticket cites:

### 1. New pure helper — `src/renderer/src/screens/conversation/modalResolution.ts`

React-free, framework-free, `deps`-injected — the exact shape of `composerSend.ts`'s `submitMessage`.
This is **where the guarded-send + dispatch logic lives so it is unit-testable with plain spies** under
the `node` test environment (the view cannot be — no DOM to fire clicks). Contract:

```ts
export const MODAL_CANCEL_OUTCOME = 'cancelled'   // mirrors the daemon's OutcomeCancelled (pyrycode #727)

export interface ModalResolveDeps {
  sendCommand: (command: RendererCommand) => void   // window.pyry.sendCommand in the container
  dispatch: (event: ModalEvent) => void             // modalStore dispatch
}

export function answerPrompt(modalId: string, optionId: string, deps: ModalResolveDeps): void
export function cancelPrompt(modalId: string, deps: ModalResolveDeps): void
```

Behavior (each function, mirroring `submitMessage`'s guard exactly):

- `answerPrompt` — guarded `deps.sendCommand(answerModalCommand({ modal_id: modalId, option_id: optionId }))`
  (the camelCase → snake_case rename happens **here**, at the dispatch site), then — **unconditionally,
  after the guarded send** — `deps.dispatch({ type: 'dismissed', modalId, outcome: optionId, source: 'local' })`.
- `cancelPrompt` — guarded `deps.sendCommand(cancelModalCommand({ modal_id: modalId }))`, then
  unconditionally `deps.dispatch({ type: 'dismissed', modalId, outcome: MODAL_CANCEL_OUTCOME, source: 'local' })`.

The `try { … } catch (error) { console.error(...) }` swallow around the `sendCommand` call is the AC4
guard (identical to `composerSend.ts:50-55`). The `dispatch` is **outside** the try, so a send-bridge
throw never prevents the local clear. Invariant asserted by `modalResolution.test.ts` (see Testing).

**`outcome` choice** (the reduce ignores it; the value is the architect's call, kept internally
consistent for #227): the chosen `option_id` for an answer; the `MODAL_CANCEL_OUTCOME` sentinel
(`'cancelled'`) for a cancel — the latter matches the daemon's own `OutcomeCancelled` wire vocabulary
(pyrycode #727 / #701, confirmed via QMD), so #227 can reconcile local-optimistic and daemon-sent
dismissals under one vocabulary. `source: 'local'` marks the user-initiated (vs. `'remote'` / `'timeout'`)
resolution.

### 2. `PermissionModal.tsx` — add interaction to #224's view + container

**`PermissionModalView`** gains two **required** injected effects (the `RepairPrompt` idiom — a view
that cannot answer is a bug, so not optional):

```ts
PermissionModalView({
  prompt, onAnswer, onCancel
}: {
  prompt: ModalPrompt
  onAnswer: (modalId: string, optionId: string) => void
  onCancel: (modalId: string) => void
}): JSX.Element
```

- Each option button gains `onClick={() => onAnswer(prompt.modalId, option.id)}` (the view speaks the
  store's **camelCase**; the snake_case rename is the helper's job, not the view's — keeps the untrusted
  daemon strings and the wire vocabulary apart). No other change to the option markup, the `--default`
  marking, or the untrusted-text escaping (#224's AC4 posture is preserved).
- A **new** cancel button is added to the `.permission-modal__options` action row as its **leading**
  (first) child: `type="button"`, its own class `.permission-modal__cancel` (NOT `.permission-modal__option`
  — see Testing for why), a client-owned constant label (`Cancel`), `onClick={() => onCancel(prompt.modalId)}`.

**`PermissionModal`** (container) wires the real effects, dereferencing `window.pyry` **only inside the
handler closures** (interaction time — the `Composer.handleSubmit` discipline, so the empty-case
server-render test never touches the bridge):

- reads `outstanding` via `useModalStore(selectOutstanding)` and `dispatch` via `useModalStore(s => s.dispatch)`;
- `prompt = outstanding[0]`; `if (!prompt) return null` (unchanged FIFO);
- passes `onAnswer={(modalId, optionId) => answerPrompt(modalId, optionId, { sendCommand: window.pyry.sendCommand, dispatch })}`
  and the analogous `onCancel` wiring `cancelPrompt`.

### 3. `conversation.css` — the cancel affordance

One text-button rule `.permission-modal__cancel` reusing the `.permission-modal__option` base treatment
(transparent fill, `--color-primary` label, pill radius, label-large type, `:focus-visible` outline —
share the declarations via a grouped selector to avoid duplication) **plus** `margin-right: auto` so it
left-aligns in the `flex-end` action row while the daemon options stay right-aligned (the M3
leading-dismissive layout). No new tokens.

### Data flow

```
user clicks option "allow-once"
  → view onClick → onAnswer('m1', 'allow-once')
    → container → answerPrompt('m1', 'allow-once', { sendCommand, dispatch })
      → sendCommand(answerModalCommand({ modal_id: 'm1', option_id: 'allow-once' }))   [guarded]
          → main: daemonConnection.answerModal mints answer_token, sends modal_answer  (#236)
      → dispatch({ type: 'dismissed', modalId: 'm1', outcome: 'allow-once', source: 'local' })
          → reduceModal removes m1 from outstanding → outstanding[1] becomes [0] → next prompt renders (FIFO)

user clicks Cancel
  → onCancel('m1') → cancelPrompt → sendCommand(cancelModalCommand({ modal_id: 'm1' }))  [guarded]
                                  → dispatch({ type:'dismissed', modalId:'m1', outcome:'cancelled', source:'local' })
```

---

## State + concurrency model

- **Single source of state:** `modalStore` (unchanged). No new store representation, no new event arm —
  the local clear reuses the existing `dismissed` arm. The container reads `outstanding[0]` and
  `dispatch`; no parallel mutable state.
- **Optimistic clear, idempotent under a later daemon dismissal.** This slice clears locally on click
  (optimistic). When #179 is live, the daemon later broadcasts its own `modal_dismissed{modal_id,…}` for
  the same modal (via the #223 bridge). `reduceModal`'s `removeById` returns the **same array reference**
  on an unknown/already-removed id (`modalPrompts.ts:65-68`), so the duplicate daemon dismissal is a
  deterministic no-op — no double-removal hazard, no churn.
- **No self-gating on the grant.** The desktop sends the answer regardless of whether the device is
  granted; an ungranted device's answer round-trips to an `error` surfaced later by #227. Out of scope
  here — this slice always sends + always clears.
- **No cancellation/teardown surface.** Fire-and-forget `sendCommand` (the `submitMessage` posture); no
  `AbortController`, no subscription, no promise that outlives the window. `sendCommand` is
  `void`-returning (`preload` fire-and-forget).

---

## Error handling

| Failure mode | Layer | Result | UI surface |
|--------------|-------|--------|------------|
| `window.pyry.sendCommand` throws (bridge failure) | `answerPrompt` / `cancelPrompt` | swallowed via `try/catch` → `console.error` (AC4). The `dispatch({ dismissed })` still posts unconditionally. | Prompt clears locally; no crash, no banner (this milestone has no send-failure UI, exactly like `submitMessage`). |
| Daemon rejects an ungranted answer | main → daemon round-trip | out of scope | #227 (resolution toast) surfaces the `error`. |
| Unknown / already-dismissed `modalId` in a later daemon `modal_dismissed` | `reduceModal` | same-reference no-op | none (no churn). |
| Untrusted daemon `title` / `prompt` / `label` | `PermissionModalView` | rendered as React children (auto-escaped) — **unchanged from #224**, never `dangerouslySetInnerHTML`. | inert text. |

---

## Testing strategy

`npm test` (vitest, **`node` environment — no DOM, no click firing**) + `npm run build`
(typecheck + build, the salvage gate). The harness cannot fire clicks, so behavior is proven the
`composerSend` way: **the pure helper is tested directly with plain spies; the view is server-rendered
for structure only.** Do **not** add a DOM/testing-library dependency (violates "don't add
dependencies").

**`modalResolution.test.ts`** (new — the behavioral coverage, plain spies, no store, no Electron; mirrors
`composerSend.test.ts`):

- `answerPrompt('m1','allow-once', deps)` → `sendCommand` spy called once with
  `answerModalCommand({ modal_id: 'm1', option_id: 'allow-once' })` (assert the **snake_case** rename);
  `dispatch` spy called once with `{ type: 'dismissed', modalId: 'm1', outcome: 'allow-once', source: 'local' }`.
- `cancelPrompt('m1', deps)` → `sendCommand` called with `cancelModalCommand({ modal_id: 'm1' })`;
  `dispatch` called with `{ type: 'dismissed', modalId: 'm1', outcome: 'cancelled', source: 'local' }`.
- **AC4 guard:** a `sendCommand` spy that throws → `answerPrompt` / `cancelPrompt` does **not** throw, and
  `dispatch` is still called exactly once (the unconditional local clear). Both functions.
- `answer_token` never appears in the sent payload (it is `Omit`-excluded by construction — a
  type-level guarantee; a light assertion that the payload has only `modal_id` + `option_id` documents it).

**`PermissionModal.test.tsx`** (update — structural, server-render):

- Update the existing `<PermissionModalView prompt={…} />` calls to pass no-op `onAnswer` / `onCancel`
  spies (the props are now required).
- Update `optionCount` to count **option** buttons specifically (match `permission-modal__option`, not
  bare `type="button"`) so the new cancel button does not inflate the count — then the existing
  order/default/single-option assertions stay valid.
- New: the view renders a cancel button (assert the `permission-modal__cancel` class + the `Cancel`
  label) and it is the leading element of the action row.
- The container's empty case is unchanged (`renderToStaticMarkup(<PermissionModal />) === ''`).

Type-level coverage (`npm run typecheck`): `onAnswer` / `onCancel` are required; the view passes
`(prompt.modalId, option.id)` (both `string`) — the arg wiring is a compile-time guarantee, not a
DOM-tested one (the same reason `Composer`'s `onClick={handleSubmit}` binding is not DOM-tested).

---

## Open questions

- **`outcome` encoding for #227.** This slice uses `outcome: optionId` (answer) / `'cancelled'`
  (cancel), both `string`, matching the daemon's wire vocabulary. If #227 later needs to distinguish
  "answered with option X" from "cancelled" more robustly (e.g. an option whose `id` happens to equal
  `'cancelled'`), it may formalize the encoding — but that is #227's call; the reduce ignores `outcome`
  today, so any consistent scheme is safe here. No action for this slice.
- None blocking. The command API (#236), the store (#122/#223), and the render chrome (#224) are all
  merged; this slice is pure wiring.
