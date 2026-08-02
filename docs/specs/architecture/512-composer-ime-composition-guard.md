# Spec #512 — Composer must not submit on the Enter that commits an IME composition

**Ticket:** [#512](https://github.com/pyrycode/pyrycode-desktop/issues/512) · **Size:** S (confirmed, not split) · **Labels:** `bug`, `size:s` — no `security-sensitive`, so no security-review pass.

## Files to read first

Codegraph is **not initialized** for this repo (`codegraph_status` → "CodeGraph not initialized"), so this list is hand-built rather than lifted from `codegraph_context`. It is the developer's turn-1 data load; nothing outside it needs reading.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1389-1428` | `Composer` — the module-local container. `handleSubmit` (`:1407-1420`) and the buggy `handleKeyDown` (`:1422-1428`). This is the only production edit outside `composerSend.ts`. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1442-1449` | The `<textarea>`: only `onChange` + `onKeyDown` today. Nothing else is rewired. |
| `src/renderer/src/screens/conversation/composerSend.ts:41-70` | `submitMessage` — the "pure helper, injected effects" idiom and its doc-comment density. The new predicate lands **directly after** this function. |
| `src/renderer/src/screens/conversation/composerSend.ts:97-168` | `composerAvailability` / `shouldOfferRepair` / `shouldShowBanner` — the three existing pure predicates. The new one matches their naming and doc shape; do **not** disturb this `ConnectionStatus` cluster. |
| `src/renderer/src/screens/conversation/composerSend.test.ts:1-70` | The test idiom: plain `vi.fn()` spies, plain values, no React, no store. The new `describe` block mirrors it. |
| `src/renderer/src/screens/conversation/modalResolution.ts:72-82` | `selectOption` — the other React-free "decision, no effects" helper; read it to confirm the seam shape chosen below is the house style, not an invention. |
| `docs/knowledge/features/composer-send.md:67-76, 175` | How the composer container is documented today, incl. the standing "DOM interaction is untested" limitation this ticket works within. Read-only — documentation phase owns the update. |
| `docs/knowledge/codebase/276.md:76-78` | The repo's written precedent that `Composer.handleKeyDown` is *untested reviewed glue* because the `node` harness fires no events. This is the posture the testing strategy below relies on. |
| `vitest.config.ts` | `environment: 'node'`, no jsdom. Confirms no DOM harness — do not add one. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-61

Node `16-61` ("Composer", 412×68) is a dark rounded input pill holding the placeholder text and a mic glyph, with a separate circular arrow-upward send button to its right — verified by screenshot and by `get_metadata` (`16:62` pill → `16:63` text + `16:64/16:65` mic; `16:69/16:70` send button). **No visual change is in scope.** This ticket changes only whether a keystroke submits; no element, token, class, or attribute in the rendered markup changes, so there is nothing here for the developer to reproduce. The node is cited as the surface anchor for consistency with #31 / #66.

## Context

`Composer.handleKeyDown` (`ConversationScreen.tsx:1422-1428`) treats **every** non-shift Enter as submit:

```ts
if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSubmit() }
```

While an IME composition is in flight, the Enter that *commits the candidate* fires a keydown with `key === 'Enter'` and `shiftKey === false`. For a CJK user this is ordinary typing, and today it does two wrong things at once:

1. `handleSubmit()` sends the partially-composed text and clears the input mid-word.
2. `event.preventDefault()` suppresses the commit itself — so even the keystroke's intended effect is lost.

Nothing downstream compensates: `handleSubmit` gates only on `canSend`; `submitMessage` gates only on empty-trimmed text and a null `conversationId`. Repo-wide there are zero hits for `isComposing` / `composition*` / `keyCode` across `src/` and `e2e/`.

The fix is one guard. The design question is *where* it lives, because this repo has no DOM harness — see Testing strategy.

## Design

### 1. `composerSend.ts` — a new pure predicate (the only new exports)

Placed **directly after `submitMessage`**, before the `ComposerAvailability` interface. Rationale: the `ConnectionStatus` predicates at the bottom of the file form one cluster on one axis (*may* the composer send); this one is on a different axis (*did this keystroke ask* to send), and belongs beside the submit it gates.

```ts
/** The three fields of a composer keydown the submit decision reads. Plain values, no React. */
export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  isComposing: boolean
}

/** True iff this keydown asks the composer to submit. */
export function shouldSubmitOnKeyDown(event: ComposerKeyEvent): boolean
```

Behaviour — total, three conjuncts, no branches:

| `key` | `shiftKey` | `isComposing` | result |
|---|---|---|---|
| `'Enter'` | `false` | `false` | **`true`** — submit |
| `'Enter'` | `false` | `true` | `false` — IME commit (**the fix**) |
| `'Enter'` | `true` | any | `false` — newline |
| anything else | any | any | `false` |

Two things this predicate deliberately does **not** do:

- **It does not absorb the `canSend` gate.** `handleSubmit`'s `if (!canSend) return` (`:1411`) stays exactly where it is — it is the authoritative gate for the button as well as for Enter, and #31's contract is that a disconnected Enter is *swallowed* (`preventDefault` fires, nothing sends, the input is preserved). Folding `canSend` in here would silently change that to "disconnected Enter inserts a newline". This predicate answers keystroke intent only.
- **It does not read `keyCode === 229`.** Chromium sets it on the same keydown, and React's synthetic event even exposes `keyCode` directly (deprecated, `@types/react` `index.d.ts:2288`) — but one signal identifies the composition and a second is a defense for a failure mode nobody has observed here. `isComposing` is the standard, non-deprecated one. If `isComposing` is ever seen misreporting in this app, that is its own ticket with the reproduction attached.

Docstring should carry the *why* at the density of its neighbours: name the IME-commit keydown, and state that `preventDefault` must not fire on it (below).

### 2. Reading the signal — `event.nativeEvent.isComposing`

`isComposing` is **not** on React's synthetic keyboard event. Verified against the pinned `@types/react` ^18.3.12:

- `interface KeyboardEvent<T = Element> extends UIEvent<T, NativeKeyboardEvent>` (`index.d.ts:2273`) declares `key`, `shiftKey`, `code`, deprecated `charCode`/`keyCode`/`which` — and **no `isComposing`**.
- `nativeEvent: E` lives on `BaseSyntheticEvent` (`index.d.ts:2186`), so `event.nativeEvent` is the DOM `KeyboardEvent`.
- DOM `KeyboardEvent` declares `readonly isComposing: boolean` (`lib.dom.d.ts:19107`) — non-optional.

So the read is `event.nativeEvent.isComposing`, and it types as `boolean` with no cast, no `?.`, no `as`. Writing `event.isComposing` is a TS2339 compile error, so `npm run typecheck` catches the mistake — this is why the extraction can safely live in the untested container.

*(Fail-mode note, for honesty rather than defense: if a host ever left `isComposing` undefined at runtime, `!undefined` is truthy and the composer would submit — i.e. exactly today's behaviour. The guard can only improve on the status quo, never regress it. Nothing is added to defend this.)*

### 3. `ConversationScreen.tsx` — rewire `handleKeyDown`

The handler becomes exactly three statements, and the order is load-bearing:

```ts
const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
  const { key, shiftKey, nativeEvent } = event
  if (!shouldSubmitOnKeyDown({ key, shiftKey, isComposing: nativeEvent.isComposing })) return
  event.preventDefault()
  handleSubmit()
}
```

**The `return` must precede `preventDefault()`.** Calling `preventDefault()` on the committing keydown and *then* declining to submit would still break the IME — the candidate never commits and the user's half-typed text is stranded. This is why AC1 enumerates "no `preventDefault`" as a separate clause from "no wire command". The three-statement shape is also what makes AC1's remaining clauses (no wire command, no optimistic echo, text intact) true **by construction** and verifiable by eye — see Testing strategy.

Add `shouldSubmitOnKeyDown` to the existing `composerSend` import block at the top of the file. Nothing else in `ConversationScreen.tsx` changes — not the JSX, not `handleSubmit`, not the textarea's props.

## State + concurrency model

None. `shouldSubmitOnKeyDown` is a synchronous pure function over three plain fields: no store slice, no `useState`, no `useEffect`, no subscription, no async task, no teardown. This is deliberate and is the load-bearing simplification — the alternative design (tracking `compositionstart`/`compositionend` in component state) is scoped out by the ticket precisely because it would add a lifecycle the `node`-only harness cannot exercise, which is the failure shape #511 was fixed to remove. Composition state is re-derived from each keydown; there is nothing to get stale.

## Error handling

No new failure modes and no new error surface. The predicate is total (every input maps to a boolean; no throw path), so there is nothing to catch, log, or render. The two existing guards downstream are untouched and still apply on the submit path: `handleSubmit`'s `!canSend` early return, and `submitMessage`'s guarded `sendCommand` try/catch (`composerSend.ts:58-63`).

Nothing is logged. Consistent with `resolvePendingOption` and the composer generally: keystrokes and composer text are user content, and the content-blind posture keeps them out of the diagnostic log.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) + `npm run typecheck` + `npm run build`.

**Do not add a DOM harness.** No jsdom, no happy-dom, no `@testing-library`, no `fireEvent`. `Composer` is module-local (`:1389`) and cannot be rendered from a test at all; `renderToStaticMarkup` fires no events. Building a harness is its own always-split infrastructure ticket. All new tests go in the existing `composerSend.test.ts` as one new `describe('shouldSubmitOnKeyDown')` block, in the plain-value/plain-spy idiom of the file. `ConversationScreen.test.tsx` needs no change.

**Scenarios** (bullet-pointed; write them in the file's own style):

- Plain Enter, no shift, no composition → **`true`**. *(This is the single assertion that a "never submit" stub must fail — AC4, first direction.)*
- Enter, no shift, **composition in progress** → `false`. *(AC1, the fix.)*
- Enter, **shift held**, no composition → `false`. *(AC2, newline preserved.)*
- Enter, shift held, composition in progress → `false`. *(Both suppressors at once; neither cancels the other.)*
- A representative sweep of non-Enter keys (e.g. `'a'`, `'Escape'`, `'Tab'`, `'NumpadEnter'`) with every composition/shift combination → `false`. *(Note `'NumpadEnter'` is `key === 'Enter'` in a real browser; it appears here only as a "not the string `Enter`" case — the predicate matches on `key`, not `code`.)*

**AC4 — prove non-vacuity with two mutation runs, do not assert it.** Before opening the PR, run both controls and record the observed results in the PR body:

1. Replace the predicate body with `return false` → `npm test` → the plain-Enter case must fail.
2. Replace it with `return true` → `npm test` → the composition, shift, and non-Enter cases must fail.
3. Revert.

This is the #511 discipline: the mutation evidence settles vacuity in a way code-review cannot reproduce (the review worktree has no `node_modules`), and every AC1/AC2 assertion here is a "→ false" expectation, which is exactly the shape a stub passes for free.

**What is not directly asserted, and why that is correct.** AC1's remaining clauses — no wire command, no optimistic echo, no `preventDefault`, text intact — are consequences of the predicate returning `false` plus a three-statement handler that returns before touching either effect. They are not spy-asserted, because doing so would require either a DOM harness (impossible here) or a test that re-implements the handler's `if` and then asserts against its own copy — theatre that would pass even if the real container were wired wrong. `Composer.handleKeyDown` is *untested reviewed glue* by written repo precedent (`docs/knowledge/codebase/276.md:76-78`, which names this exact handler), and this ticket keeps it that way while shrinking the untested surface to a single field extraction that `npm run typecheck` already guards. **Reviewer's check is therefore structural:** the handler is three statements, and the `return` precedes `preventDefault()`.

## Scope

**In:** `composerSend.ts` (two new exports), `ConversationScreen.tsx` (`handleKeyDown` body + one import), `composerSend.test.ts` (one new `describe`).

**Out:** the `compositionstart`/`compositionend` fallback (ticket-scoped out — Electron `^33.2.1` means Chromium, not WebKit, so the rationale that motivated it does not apply here); any DOM harness; `keyCode === 229`; any change to `handleSubmit`, `submitMessage`, the JSX, or the connection gates; the mic affordance visible in the Figma node (unbuilt, unrelated).

**Not a developer deliverable:** `docs/knowledge/features/composer-send.md` and `docs/knowledge/codebase/512.md`. The knowledge base is written by the documentation phase from this spec plus the merged diff. The developer's worktree touches only `src/` and this spec file.

## Open questions

None blocking. One judgment call recorded for review: the seam is a **boolean predicate** (`shouldOfferRepair` / `shouldShowBanner` shape) rather than an effect-injected void helper (`selectOption` / `submitMessage` shape). Both are house idioms. The predicate wins here because the handler it feeds is three statements — injecting `preventDefault` and `submit` as spies would upgrade two of AC1's four clauses from consequence-of-predicate to direct assertion, at the cost of an indirection plus a real footgun (`preventDefault: event.preventDefault` passed unbound loses its `this` and silently no-ops). Reject this reasoning and the alternative is a small, contained change to make.
