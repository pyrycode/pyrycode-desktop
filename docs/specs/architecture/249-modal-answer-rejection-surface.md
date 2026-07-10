# Spec #249 — Render the modal-answer rejection surface

> **Status:** ready for development. Sized **S** (PO `size:s`, confirmed: 4 production files, ~90 prod LOC + ~180 test LOC, additive; no consumer fan-out). **Not** `security-sensitive` — pure renderer reading an already-typed, content-free event (#248 defended the content-free guarantee upstream).

## Files to read first

- `src/renderer/src/store/modalPrompts.ts` (whole, 106 lines) — the file you extend: the `ModalEvent` union, `ModalState`, `reduceModal`'s `switch` + `assertNever`, and the `removeById` **same-reference-on-no-op** idiom you mirror for the new field.
- `src/renderer/src/store/modalBridge.ts:41-89` — `translateModalEvent`; specifically the **dormant** `case 'modalAnswerRejected'` (lines 55-61) that currently `return null`. This is the one line you flip.
- `src/shared/ipc/events.ts:144-154` — the `modalAnswerRejected` DaemonEvent arm. Confirm it carries **only** `{ modalId: string }` — no error text, no `conversation_id` (content-free by construction, AC3).
- `src/renderer/src/screens/conversation/PermissionModal.tsx` (whole, 177 lines) — the pure-view + store-bound-container split (`PermissionModalView` / `PermissionModal`). You add a sibling pure view and extend the container. Note the `useState`-before-early-return (rules-of-hooks) and the "`window.pyry` only inside handlers" discipline.
- `src/renderer/src/store/modalStore.ts:27-45` — the DI factory → singleton → `useModalStore` hook → selector re-export. You add one re-export line.
- `src/renderer/src/screens/conversation/modalResolution.ts:38-47` — `answerPrompt`'s local optimistic `dispatch({ type: 'dismissed', ... })`. Your rejection-dismiss dispatch mirrors this shape but stays **inline in the container** — do **not** add a helper here (that would make modalResolution.ts a 5th production file and trip the scope gate).
- `src/renderer/src/store/modalPrompts.test.ts` (whole) — the reducer test idiom: fixture builders, the `run(events)` fold, and the same-reference no-op assertions (`expect(after).toBe(...)`). Extend it.
- `src/renderer/src/screens/conversation/PermissionModal.test.tsx` (whole) — the SSR pure-view idiom (`renderToStaticMarkup`, injected fixtures, `optionCount`-style markup counting) **and** the container empty-case test (lines 177-183, asserts `''`) that MUST stay green.
- `src/renderer/src/screens/conversation/conversation.css:515-600` — the `.permission-modal*` chrome (surface-container-high panel, `--radius-lg`, `--space-*`, text-button action rows). Reuse these tokens; add `.modal-rejection*` in this file.
- `src/renderer/src/theme/tokens.css:33` — `--color-error: #ffb4ab` (M3 error role, tone 80, added by #230). The **only** error token that exists — there is no `--color-error-container` / `--color-on-error`. Design around this constraint (accent, not a filled container).
- `docs/knowledge/decisions/0009-modal-prompt-model.md` — the modal-prompt model + the anticipated "resolution toast" seam this ticket realizes.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=22-3

Node 22-3 (Dialogs) holds four dark-surface, rounded M3 dialogs (Rename, Save-as-channel, Create-workspace, Paste-pairing-code), each a title + body + a right-aligned text-button action row in the primary color — the same chrome `PermissionModal` already reuses. **There is genuinely no toast / snackbar / error-banner component in the design** (PO confirmed 2026-07-11; a design-system search for `toast / snackbar / error banner / rejected` returns nothing). Per the ticket, this is **not** a blocker: build a minimal transient surface reusing the modal chrome's design tokens plus `--color-error` (a neutral `--color-surface-container-high` card with an error-colored accent), consistent with the M3 dialog treatment above. A bespoke Figma design for the rejection toast is a Juhana follow-up that can refine the chrome later.

## Context

The answer path clears the modal **optimistically** on click: `answerPrompt` / `cancelPrompt` (#237) dispatch a local `dismissed` event that removes the prompt from `outstanding` before any daemon reply arrives. So when an ungranted device's answer round-trips to a daemon `error`, the prompt is already gone — the user believes their answer went through, then watches it silently vanish.

#248 (merged, PR #266) surfaces that rejection at the transport: a correlated, **content-free** `DaemonEvent` — `{ type: 'modalAnswerRejected'; modalId: string }` — whose only field is the `modalId` nonce the client already saw on `modalShown`. It carries **no** daemon error text (the untrusted `ErrorPayload.code`/`.message` are never decoded; AC3/AC4 are enforced upstream by construction). The owning bridge, `modalBridge.ts`, currently routes that arm to `return null` — dormant, left for exactly this slice.

This slice flips the dormant case and renders the result. Because the modal is already cleared from `outstanding`, the surface is **new UI state** (a transient banner at the modal host), **not** a re-surfacing of the still-pending modal. It must not read from or depend on `outstanding`.

#248's correlation window is FIFO, so **more than one** rejection can arrive in a session (an ungranted user answers modal A then B before A's error returns). The surface stacks: an ordered, de-duplicated list keyed by `modalId`.

## Design

Three layers, mirroring the existing modal vertical (bridge → reducer/state → pure-view + container). All additive; the only edits to existing code are (a) one bridge case, (b) preserving the new state field in two existing reduce arms, (c) one selector re-export.

### 1. Sealed events (`store/modalPrompts.ts`)

Add two `ModalEvent` arms to the union:

```ts
| { type: 'rejected'; modalId: string }            // from the bridge — a round-tripped rejection
| { type: 'rejectionDismissed'; modalId: string }  // local — the user dismissed a rejection banner
```

- `rejected` mirrors the tag-flip precedent (`modalShown → shown`, `modalDismissed → dismissed`; so `modalAnswerRejected → rejected`). Produced by the bridge.
- `rejectionDismissed` is a **local** user action (never produced by the bridge), dispatched directly from the container — exactly as `answerPrompt`/`cancelPrompt` dispatch `dismissed` locally. Past-tense, a state-change fact, consistent with `shown`/`dismissed`.

### 2. State + reducer (`store/modalPrompts.ts`)

Add a field to `ModalState`, orthogonal to `outstanding` (never mutate `outstanding` in the new arms):

```ts
export interface ModalState {
  outstanding: readonly ModalPrompt[]
  rejections: readonly string[]  // modalIds of round-tripped rejections, arrival order, de-duplicated
}
```

`rejections` holds bare `modalId` strings, not objects — the event is content-free, so there is genuinely nothing else to carry (unlike `dismissed`'s `outcome`/`source`, which mirror wire fields). A stacked list (not a coalesced scalar) is required by AC4: the `modalId` is the **stable React key** when more than one rejection shows, which only makes sense per-element.

`initialModalState` gains `rejections: []`.

Two new reduce cases, each with the **same-reference-on-no-op** discipline:

- `rejected` → append `modalId` **if not already present** (dedup); return `state` unchanged (same reference) if it is. Use a small `appendUnique(rejections, modalId)` helper mirroring `removeById`'s "return the same array when nothing changed" contract.
- `rejectionDismissed` → remove `modalId`; a small `removeRejection(rejections, modalId)` helper mirroring `removeById` (filter; same reference when length unchanged → same `state`).

**Edit the two existing arms** so the new field survives: `shown` and `dismissed` currently return `{ outstanding: … }`, which would silently drop `rejections`. Change both to spread state — `{ ...state, outstanding: … }` — so a `shown`/`dismissed` preserves `rejections` and a `rejected`/`rejectionDismissed` preserves `outstanding`. (The `assertNever` default forces you to add both new cases; a missing arm is a compile error.)

Add the selector:

```ts
export const selectRejections = (s: ModalState): readonly string[] => s.rejections
```

### 3. Bridge — the flip (`store/modalBridge.ts`)

In `translateModalEvent`, replace the dormant `case 'modalAnswerRejected': return null` with a **fresh named-field literal** (never `return event`, matching the `modalShown`/`modalDismissed` reconstruction — immune to the DaemonEvent arm gaining an unrelated field later):

```ts
case 'modalAnswerRejected':
  return { type: 'rejected', modalId: event.modalId }
```

Update the surrounding comment (currently says "Dormant this slice"). No other bridge change: the new local `rejectionDismissed` arm is never produced from a DaemonEvent, so the `switch` on `DaemonEvent.type` is unaffected. `conversationListBridge` / `sessionIdBridge` / `timelineBridge` use `default: return null` (not `assertNever` over ModalEvent), so nothing else is forced.

### 4. Render host (`screens/conversation/PermissionModal.tsx`)

Follow the pure-view + store-bound-container split. Add **one pure view** and extend the **existing container** — no new mount point, so `ConversationScreen.tsx` is untouched (keeps the file count at 4 and preserves the single modal-host mount at `ConversationScreen.tsx:79`).

**`RejectionSurfaceView`** (new, exported, pure — SSR-testable):

```ts
export function RejectionSurfaceView({
  rejections,
  onDismiss
}: {
  rejections: readonly string[]
  onDismiss: (modalId: string) => void
}): JSX.Element | null
```

- Returns `null` when `rejections.length === 0` (zero layout footprint, the Timeline/ThinkingIndicator idiom).
- Else renders a stack container (`.modal-rejections`) with one banner (`.modal-rejection`) per `modalId`, **keyed by `modalId`**.
- Each banner: client-owned category copy — **"Your answer was rejected."** — plus a dismiss control (an icon/× button with an `aria-label`, or a "Dismiss" text button) calling `onDismiss(modalId)`.
- `modalId` is used **only** as the React `key` and the `onDismiss` argument — **never** rendered as visible text (AC4; the nonce is meaningless to a human and the prompt title is gone).
- No daemon content anywhere (AC3 — the event carries none; the copy is a client constant).
- Live region: give each banner `role="alert"` so a screen reader announces it on arrival. (Rationale in Open questions; the exact ARIA is the developer's call.)
- `onDismiss` is a **required** injected prop (the `PermissionModalView` "a view that cannot answer is a bug" rule); structural tests inject a no-op.

**`PermissionModal`** (existing container — extend, do not fork): read the new slice alongside the existing one and render both surfaces.

- Add `const rejections = useModalStore(selectRejections)` beside the existing `selectOutstanding` read. `dispatch` is already read.
- Change the early return to fire only when **both** are empty: `if (!prompt && rejections.length === 0) return null`. This keeps the empty-case container test (returns `''`) green.
- Guard `pendingOption` on `prompt` existing (it can now be `undefined` while a rejection shows with no outstanding prompt).
- Return a fragment: the existing `<PermissionModalView … />` rendered only when `prompt` exists, plus `<RejectionSurfaceView rejections={rejections} onDismiss={(modalId) => dispatch({ type: 'rejectionDismissed', modalId })} />`.

The dismiss wiring is a trivial inline `dispatch` — deliberately **not** extracted into a `modalResolution.ts` helper (that would add a 5th production file for one line; the reduce arm is unit-tested and the button is structurally tested, which is adequate coverage — see Testing).

### 5. Styles (`screens/conversation/conversation.css`) — not a production `.ts` file

Add `.modal-rejections` (the stack container) and `.modal-rejection` (one banner) near the `.permission-modal*` block. Reuse the modal chrome tokens; **do not add new theme tokens** (the ticket forbids it):

- `.modal-rejections`: a bottom-anchored stack absolutely positioned inside `.conversation` (the overlay idiom — `position: absolute`, above the composer), a column with `--space-2` gaps, a `max-width`, and a `z`-order above the thread. It is decorative chrome; no scrim (it does not block interaction).
- `.modal-rejection`: `--color-surface-container-high` background, `--color-on-surface` text, `--radius-*` corners, `--space-*` padding, and an **error accent** in `--color-error` (e.g. a `border-left`) — an accent, not a filled error container (only the `--color-error` role token exists). A row: the copy + a de-emphasized dismiss text button (the `.status-sheet__close` / `.permission-modal__cancel` treatment).

## State + concurrency model

- **Store slice:** the existing `modalStore` singleton (`store/modalStore.ts`), unchanged in structure — one Zustand vanilla store folding `ModalEvent`s through `reduceModal`. The new `rejections` field lives on the same `ModalState`, so there is still **one source of truth** for all modal-adjacent state; no parallel state.
- **Re-render seam:** `PermissionModal` now selects **two** narrow slices (`selectOutstanding`, `selectRejections`). Both return by reference with same-ref-on-no-op discipline, so a `rejected`/`rejectionDismissed` re-renders only the modal host, and an unrelated store fold does not churn it. The modal host is the correct single owner of both surfaces.
- **No async, no effects, no cancellation:** the view is pure and effect-free (no auto-clear timer — see Open questions), so it is fully SSR-testable and there is no subscription/teardown to manage. The only subscription (`useModalBridge`) is unchanged.

## Error handling

There are no new failure modes: the input event is already typed and content-free, there is no I/O, no `sendCommand`, no bridge round-trip on this path. The rejection **is** the error surface for the upstream failure (a modal answer that round-tripped to a daemon `error`); this slice only renders it. Category-level copy ("Your answer was rejected.") is the client-owned, non-echoing surface — no daemon `code`/`message`/nonce reaches the DOM.

## Testing strategy

`npm test` (vitest) + `npm run build` (typecheck + build) green.

**`store/modalPrompts.test.ts`** (reducer — the behavioral core; extend the existing file with a `rejected(modalId)` fixture builder):

- `rejected` appends a `modalId` to `rejections`, leaving `outstanding` untouched.
- **Independence (AC2):** `run([shown('m1'), dismissed('m1'), rejected('m1')])` → `outstanding` empty, `rejections === ['m1']`. The rejection records even though the prompt is already gone.
- **Dedup / same-ref:** a second `rejected('m1')` returns the **same state reference** (`expect(after).toBe(before)`), rejections still `['m1']`.
- **FIFO stack:** `run([rejected('m1'), rejected('m2')])` → `rejections === ['m1', 'm2']` (arrival order).
- **Field preservation:** a `shown` after a `rejected` keeps `rejections` (and vice versa — `rejected` keeps `outstanding`); assert the untouched array is preserved **by reference** (purity, mirroring the existing "does not mutate the surviving prompt" test).
- **`rejectionDismissed` (AC5):** `run([rejected('m1'), rejected('m2'), rejectionDismissed('m1')])` → `rejections === ['m2']`.
- **Unknown-id no-op:** `rejectionDismissed` against an absent id returns the **same state reference**, does not throw (mirror the existing AC4 no-op tests).
- `initialModalState.rejections` deep-equals `[]`; `selectRejections` returns the slice by reference.

**`store/modalBridge.test.ts`** (the flip):

- `translateModalEvent({ type: 'modalAnswerRejected', modalId: 'm1' })` → deep-equals `{ type: 'rejected', modalId: 'm1' }`.
- `subscribeModal` dispatches that translated `rejected` event when a `modalAnswerRejected` daemon event arrives (spy on `dispatch`), and still no-ops the unrelated arms (existing coverage).

**`screens/conversation/PermissionModal.test.tsx`** (pure view, SSR — extend with `renderToStaticMarkup`):

- `RejectionSurfaceView` with `rejections={[]}` → `''` (null).
- With `['m1']` → markup contains the client copy "Your answer was rejected." and a dismiss control with its accessible name; markup does **not** contain the raw `modalId` string (AC4 — use a distinctive nonce id so the assertion is meaningful).
- With `['m1', 'm2']` → renders **two** banners (count `.modal-rejection` occurrences === 2), proving ≥1 stacking.
- The existing container empty-case test (`renderToStaticMarkup(<PermissionModal />)` === `''`) stays green unchanged — both slices are empty under `getInitialState()`.

**Coverage split note:** the dismiss **click → dispatch** is not click-tested (the `node` env fires no DOM events; this file is SSR-only, matching how answer/cancel clicks are not view-tested either). The behavior is proven at two seams instead: the `rejectionDismissed` reduce arm (state transition, above) and the view rendering the dismiss button (structure, above). The inline wiring between them is a one-line dispatch verified by types. **AC2's "renders independently of `outstanding`" is a type-level guarantee** — `RejectionSurfaceView` receives only `rejections`, never `outstanding`, so it structurally cannot depend on the prompt (the `ThinkingIndicator({ isThinking })` posture).

## Open questions

- **Auto-clear timer (AC5, optional — recommend defer).** AC5 makes manual dismiss the requirement and a timer optional. Deferring keeps the view pure/effect-free and SSR-testable, and avoids `useEffect` + `setTimeout` + fake-timer test machinery for an unobserved need (evidence-based-fix). A timed auto-dismiss is a natural refinement to fold into the Juhana Figma follow-up. **Recommendation: manual dismiss only in this slice.**
- **Stack cap / coalescing.** #248's FIFO window is bounded by outstanding answers, so realistically few rejections stack. No cap in this slice; if the surface ever gets noisy, a cap-and-coalesce ("+N more") pass is a cheap follow-up. Flag only.
- **Live-region role.** `role="alert"` (assertive) announces the rejection immediately, which suits a failure the user should notice; `role="status"` (polite) is the quieter alternative. Recommend `role="alert"` per banner; the developer may adjust if it double-announces on re-render.
