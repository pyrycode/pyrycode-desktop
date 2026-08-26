# #678 — the send button becomes stop while a turn is running

**Size: S.** One production `.tsx` (`ConversationScreen.tsx`), one CSS file whose diff is pure deletion plus a comment true-up, one renderer test file, one e2e spec. Net-negative: the control this ticket builds replaces two components and five CSS rules it deletes. No new files, no new store state, no wire change, no new command type. `sendInterrupt.ts` is untouched.

**Blocker cleared.** #758 is CLOSED and merged. `InterruptControl` already takes `phase` as a required prop from the container (`ConversationScreen.tsx:1461`), so the phase this ticket reads is already the open conversation's, and the seventh-flat-store-reader concern is moot.

**Codegraph:** unavailable — `codegraph_status` returns `CodeGraph not initialized for this project` (probed 2026-08-27; the `.codegraph/` symlink carries a config but no index DB). The reading list below was built by grep + Read, the documented fallback.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=114-3549

One Figma component, "Message input button", with an `Action` variant property: `Action=Send` (`113:3543`/`113:3544`) and `Action=Stop` (`114:3549`). Both are 48×48 frames holding a single 28×28 glyph — `circle-chevron-up-solid-full` and `circle-stop-solid-full` respectively — and both glyphs are painted `#9dcbfc`, which is exactly `--color-primary` (`src/renderer/src/theme/tokens.css:24`). The Figma component is an M3 *standard* icon button, so its container is invisible at rest; our `.composer__send` has always carried a visible `--color-surface-container-high` pill instead.

**What this ticket takes from the design, and what it deliberately does not.** It takes the stop variant's glyph: `circle-stop-solid-full` at 28×28, replacing #307's improvised bare filled square. It does **not** take the primary colour or the invisible container, because the ticket's Technical Notes freeze the send variant's theming ("Re-theming the *send* variant to `circle-chevron-up-solid-full` is also out") — and applying primary to only the stop half would fork the two variants of the control this ticket exists to merge. Both variants therefore keep `currentColor` inheriting `--color-on-surface` from the shared `.composer__send` chrome. The colour + container re-theme is one coherent follow-up covering both variants; see Open questions.

**The exact glyph.** Inlined here so the developer needs no MCP access (the Figma asset URL expires in 7 days). Exported verbatim from node `114:3552`, `fill` swapped to `currentColor` and the wrapper's `clipPath` dropped (it clips to the full 28×28 box, so it is a no-op):

```
viewBox="0 0 28 28"  width="28" height="28"  fill="currentColor"
d="M14 28C21.7328 28 28 21.7328 28 14C28 6.26719 21.7328 0 14 0C6.26719 0 0 6.26719 0 14C0 21.7328 6.26719 28 14 28ZM10.5 8.75H17.5C18.468 8.75 19.25 9.53203 19.25 10.5V17.5C19.25 18.468 18.468 19.25 17.5 19.25H10.5C9.53203 19.25 8.75 18.468 8.75 17.5V10.5C8.75 9.53203 9.53203 8.75 10.5 8.75Z"
```

A 28-unit viewBox departs from this file's 24-unit habit (28 of 30 existing `viewBox` values are `0 0 24 24`, with two exceptions already). Take the exported coordinates as-is rather than rescaling them by hand: `viewBox` is only a coordinate space, the rendered size comes from `width`/`height`, and hand-converting the path is pure transcription risk for zero gain.

The send variant's glyph and size are untouched — the existing `0 0 24 24` arrow at 22×22 (`ConversationScreen.tsx:2073-2082`). The two variants therefore differ in glyph box (28 vs 22); that is correct, not a fork: a filled disc needs more area than a thin arrow to read at the same optical weight, and 28 is what the design specifies for the stop glyph. It also means the follow-up re-theme has to touch only the send half.

---

## Files to read first

**Production — `src/renderer/src/screens/conversation/ConversationScreen.tsx`**

- `:1383-1391` — `isTurnRunning`. **Survives verbatim.** Only its doc comment is true'd up. Three production consumers outside this ticket's file set depend on it (see Constraints).
- `:1393-1397` — `INTERRUPT_LABEL = 'Stop the running turn'`. The string is a load-bearing e2e locator. Relocate it; never reword it.
- `:1399-1445` — `InterruptButton`. **Deleted.** Read for the posture the new view inherits: `aria-label` from a client-owned constant, a *required* injected effect, `aria-hidden="true"` on the glyph, native `<button>` so keyboard activation is free.
- `:1447-1468` — `InterruptControl`. **Deleted.** Its note at `:1458-1460` states the one property the new design must preserve: `window.pyry` is dereferenced *inside the click closure only*, because it does not exist under `renderToStaticMarkup`.
- `:1985-2087` — `Composer`. The container the control moves into. Note `canSend` (`:2002`), `handleSubmit` (`:2007-2032`), `handleKeyDown` (`:2034-2044`), and the inline send `<button>` at `:2066-2083` that becomes the new component's send branch.
- `:164-181` — the container's slice destructure; `phase` is already in scope at `:181`.
- `:274-281` — the `<InterruptControl phase={phase} />` mount (deleted, comment block included) and the `<Composer onMessageSent={followBottom} />` mount directly below it.
- `:1244-1280` — `workingIndicatorStateWithLocalSend`. Its closing paragraph (`:1267-1271`) is the #650 guarantee this ticket must not break, and is one of the comments to true up.
- `:1980-1984` — why `Composer`'s props are required rather than optional (one render site, no cascade). The same reasoning applies to the new `phase` prop.

**Production — `src/renderer/src/screens/conversation/conversation.css`**

- `:1239-1271` — the `.composer__send` rule set. The chrome **both** variants share. Note that `:hover:not(:disabled)` and `:disabled` already behave correctly for a never-disabled stop variant, which is why this ticket adds no CSS at all.
- `:1273-1314` — `.conversation__interrupt`, `.interrupt-button`, `.interrupt-button:hover`, `.interrupt-button:focus-visible`, `.interrupt-button-icon`. **Deleted wholesale.** The false design-gap claim at `:1276-1277` dies with the block.

**Reference — untouched**

- `src/renderer/src/screens/conversation/sendInterrupt.ts` (whole file, 36 lines) — the effect, unchanged. Its docstring already states the no-optimistic-state contract AC2 restates.
- `src/renderer/src/theme/tokens.css:19-24` — `--color-surface-container-high`, `--color-on-surface`, `--color-primary`.

**Tests — `src/renderer/src/screens/conversation/ConversationScreen.test.tsx`**

- `:30-31` — the import block; `InterruptButton` → the new component name.
- `:1565-1602` — the `isTurnRunning` describe (**survives**) and the `InterruptButton` describe (**rewritten**).
- `:1475-1488` — the #650 "opens the window WITHOUT arming the interrupt control" test. Its three assertions are all pure predicate calls and survive **unchanged**; only the comment at `:1476-1483` needs a true-up.
- `:2492-2508` and `:2534-2538` — the container smoke tests. `:2500-2501` asserts on the two class names this ticket deletes and must be replaced (see Testing strategy); `:2507` and `:2536` still pass as written.

**Tests — `e2e/`**

- `e2e/real-claude-queue-drop.spec.ts:196-204` — **the only mid-turn `sendButton.click()` in the repo.** Must become an Enter keypress.
- `e2e/queued-backlog-interrupt.spec.ts:160-209` — read to *confirm no migration*: its Send click at `:166` runs while phase is `idle` (`turn_state{thinking}` is not pushed until `:199`).
- `e2e/real-claude-interrupt.spec.ts:128-160` — same; its only Send click (`:150`) is the one that *starts* the turn, so phase is `idle`.

**Docs**

- `CLAUDE.md` § Build and test — renderer tests are `renderToStaticMarkup` under `environment: 'node'`. **Nothing in this repo can click.** Every unit assertion below is on markup.
- `CLAUDE.md` § Build and test — the real-claude tiers skip silently and exit 0 without a credential. Use `npm run e2e:real:gate` and read the skip reasons.
- `docs/knowledge/features/composer-send.md`, `docs/knowledge/features/interrupt-envelope.md` — the two package overviews this ticket's lessons will be folded into by the documentation phase. **Read-only for the developer.**

---

## Context

Interrupting works and already has a button: #307's `InterruptButton` / `InterruptControl`, a standalone 48px round control right-aligned in its own `.conversation__interrupt` block directly above the composer. This ticket does not add a stop affordance — it **moves the existing one into the send button**, which is why the diff deletes more than it adds. If the standalone control survived, the screen would grow a second stop button stacked above the first.

Two things changed since #307 that make this the right moment. The design gap it was built around is closed: Figma `114:3549` now specifies the stop variant, so the `conversation.css:1276-1277` and `ConversationScreen.tsx:1411` claims that "the mobile Figma has no stop/interrupt affordance" are false as of this ticket, and both are deleted with the code they annotate. And #758 made `phase` a prop rather than a flat-store subscription, so relocating the reader is a prop move, not a new store reader.

---

## Design

### The new pure view

One exported component in `ConversationScreen.tsx`, placed immediately above `Composer` (near `:1980`):

```ts
export function ComposerSendButton(props: {
  isRunning: boolean
  canSend: boolean
  onSend: () => void
  onInterrupt: () => void
}): JSX.Element
```

Named for the `.composer__send` class it owns, following this file's existing component↔class habit (`.interrupt-button`↔`InterruptButton`, `.conversation__queued`↔`QueuedBacklog`). Its doc comment must say plainly that it renders two variants, so the name does not mislead.

Behaviour, in one sentence per branch:

- **`isRunning` → the stop variant.** A `<button type="button" className="composer__send">` carrying `aria-label={INTERRUPT_LABEL}`, `onClick={onInterrupt}`, **no `disabled` attribute**, and the 28×28 `circle-stop` glyph from § Design source.
- **otherwise → the send variant.** The existing button verbatim: `className="composer__send"`, `aria-label={SEND_LABEL}`, `onClick={onSend}`, `disabled={!canSend}`, the existing 22×22 arrow glyph.

Three properties are load-bearing and each is asserted by a named test below:

1. **It never returns `null`.** This is the deliberate departure from `InterruptButton`'s null-on-false posture, and it is what makes AC1's "exactly one stop affordance renders" structural rather than a convention: the composer row holds exactly one button in every state, so a second one cannot be stacked above it.
2. **`isRunning` and `canSend` are separate booleans, and only `canSend` gates.** The stop variant is never disabled — preserving #307's behaviour exactly (`conversation.css:1288`: "Never disabled, so the hover has no `:not(:disabled)` guard"). A turn can be running while the session is disconnected; disabling stop there would be a new behaviour this ticket has no mandate for, and `sendInterrupt` already swallows a bridge failure.
3. **It takes `isRunning: boolean`, not `phase: TurnPhase`.** The same type-level guarantee `InterruptButton` had: the view structurally cannot render a daemon-supplied string because it never receives one. The container does the `isTurnRunning(phase)` derivation.

Both callbacks are **required**, following `InterruptButton`'s `onInterrupt` and `Composer`'s `onMessageSent` — a view that cannot answer is a bug, and requiring them makes "forgot to wire it" a compile error at the one render site.

### The two label constants

Move `INTERRUPT_LABEL` down from `:1397` to sit beside a new sibling immediately above `ComposerSendButton`:

```ts
const SEND_LABEL = 'Send'
const INTERRUPT_LABEL = 'Stop the running turn'
```

`'Send'` is currently an inline literal at `:2069`. Promoting it costs one line and puts **both** load-bearing e2e locator strings in one place under one comment recording that neither may be reworded — which is this ticket's single strongest failure mode. Markup is unchanged, so `App.test.tsx:15` and `PairedShell.test.tsx:17` (which assert the literal `aria-label="Send"` substring) are untouched.

`isTurnRunning` stays where it is at `:1383-1391`. Its other consumers reference it there, and it is not a composer concern.

### Wiring

`Composer` gains one required prop, `phase: TurnPhase` (`TurnPhase` is already imported in this file), derives the boolean, and renders the new view in place of the inline `<button>` at `:2066-2083`:

- `isRunning={isTurnRunning(phase)}` — **AC3**: derived from the phase on every render, never a local flag set on click, so a turn that ends on its own returns the button to send with no user action.
- `canSend={canSend}` — the existing `composerAvailability(status)` value, unchanged.
- `onSend={handleSubmit}` — unchanged.
- `onInterrupt={() => sendInterrupt({ sendCommand: window.pyry.sendCommand })}` — lifted verbatim from `InterruptControl:1465`. **It must stay an arrow function**, so the `window.pyry` dereference happens at interaction time. Writing `onInterrupt={sendInterrupt}` or hoisting the deps object out of the closure would move it into the render path, where `window.pyry` does not exist under `renderToStaticMarkup`, and every container smoke test in `ConversationScreen.test.tsx` would throw.

The container passes the `phase` it already destructures at `:181`: `<Composer phase={phase} onMessageSent={followBottom} />`. `<Composer />` at `:281` is the only render site in the repo, so a required prop costs no edit cascade.

### Deletions

- `InterruptButton` (`:1399-1445`) and `InterruptControl` (`:1447-1468`), including their comment blocks.
- The `<InterruptControl phase={phase} />` mount and its `:274-276` comment block.
- `conversation.css:1273-1314` — all five `.conversation__interrupt` / `.interrupt-button*` rules and the block comment above them.

### Why no CSS is added

The stop variant reuses `.composer__send` with no modifier class. Check each existing rule against a never-disabled 28px-glyph button and none needs changing: `:hover:not(:disabled)` matches (the stop variant is never disabled, so the guard is satisfied); `:disabled` never matches it; the 48px flex-centred box with `padding: 0` centres a 28px glyph as happily as a 22px one; `.composer__send-icon` is `display: block` and size-agnostic. An empty `.composer__send--stop` rule "for the future re-theme" would be dead code defending an unobserved failure — add it when the re-theme lands.

The CSS diff is therefore pure deletion. The two variants are distinguished in markup by `aria-label` and glyph, which is exactly the seam the e2e locators already use.

---

## State + concurrency model

No new state — this is the AC2/AC3 core.

- **No store change.** `phase` already lives in the per-conversation timeline store and already reaches this container as `thread.phase`. No new slice, no new subscription, no new selector.
- **No local flag.** The variant is a pure function of `phase` on every render. There is no "stopping" state, no `useState`, no timer, no disable-after-click. The button returns to send when the daemon's next `turn_state{idle}` arrives and the live subscription re-renders — the same retraction path `InterruptButton` had.
- **A second click is harmless.** `sendInterrupt` is fire-and-forget with no id to thread (`sendInterrupt.ts` docstring, daemon SSOT pyrycode #707); the daemon owes no reply. This is why not-disabling-after-click is correct rather than sloppy.
- **`localSendPending` must not reach this.** #650's local window opens the working indicator while `phase` is still the daemon-owned `idle`. Gate the stop variant on `isTurnRunning(phase)` **alone**. Wiring it to `localSendPending` would regress #650 and turn `ConversationScreen.test.tsx:1475` red. The structural guarantee already holds by construction: `workingIndicatorStateWithLocalSend`'s synthetic `phase` never escapes that function (`:1267-1268`), the container passes the real `phase` to `Composer`, and `isTurnRunning` admits only a `TurnPhase`. Keep it that way — do not widen `Composer`'s prop to the whole thread slice.

**Enter is untouched (AC4).** `handleKeyDown` and `shouldSubmitOnKeyDown` are not modified. Enter calls `handleSubmit` directly and never consults `isRunning`, so a mid-turn Enter still sends — and the daemon still enqueues it. This is the deliberate asymmetry the ticket asks for: mid-turn, the *button* is a stop affordance and the *keyboard* is still a send affordance.

---

## Error handling

No new failure modes. `sendInterrupt` already catches a bridge throw and logs it without propagating (`sendInterrupt.ts:32-35`); a failed interrupt leaves the turn running and the button on its stop variant, which is the honest state. `handleSubmit`'s `!canSend` guard and `submitMessage`'s two `false` returns are unchanged.

One reading worth stating because it looks like a bug and is not: while the session is disconnected **and** a turn is running, the button shows an enabled stop that may do nothing. That is the pre-existing #307 behaviour preserved verbatim, and the alternative — a disabled stop — would hide the only interrupt affordance at exactly the moment an operator most wants to try it.

---

## Testing strategy

Renderer tests are `renderToStaticMarkup` under `environment: 'node'`: no DOM, no effects, no clicks. Every unit assertion is on markup; the activation→command proof stays in `sendInterrupt.test.ts` (unchanged) and the click paths stay in `e2e/`.

**Rewrite `describe('InterruptButton …')` (`:1585-1602`) as a `ComposerSendButton` describe.** Bullet-pointed scenarios, developer writes them in the file's idiom:

- idle + `canSend` → markup contains `aria-label="Send"` and the button tag carries no `disabled`.
- idle + `!canSend` → markup contains `aria-label="Send"` and the button tag carries `disabled`. (Regression cover for `:2534`'s container assertion, now that the tag is produced by a component rather than inline.)
- running → markup contains `aria-label="Stop the running turn"` and does **not** contain `aria-label="Send"`. **AC5 + AC1's "exactly one stop affordance" in one assertion pair.**
- running + `canSend: false` → still the stop variant, and the button tag carries **no** `disabled`. This pins the deliberate asymmetry in § Design property 2; without it a later "tidy-up" collapsing the two gates into one would pass silently.
- both states → exactly one `<button` occurrence in the markup, and the markup is never `''`. Pins property 1 (never returns null), which is what makes the one-control invariant structural.
- the glyph differs between the two states — assert on a distinguishing substring of the stop path (e.g. `viewBox="0 0 28 28"`), not the whole `d`.

**Keep `describe('isTurnRunning …')` (`:1571-1583`) verbatim.** Three assertions, all still true, all still AC3's evidence. Only its preamble comment (`:1565-1570`) is true'd up.

**Container smoke tests:**

- `:2498-2502` — **must be edited, not left alone.** It asserts `not.toContain('conversation__interrupt')` and `not.toContain('interrupt-button')`; after the deletion those strings cannot appear, so both assertions become vacuously true and the test stops testing anything. Replace with `expect(markup).not.toContain('Stop the running turn')` — against the idle initial store, the composer renders the send variant and no stop affordance exists anywhere on the screen. That is the real AC1 regression guard.
- `:2504-2508` (`aria-label="Send"` present) and `:2534-2538` (the send tag carries `disabled` while disconnected) — **unchanged and must still pass.** The initial store is `phase: 'idle'` + `disconnected`, so the container renders the disabled send variant exactly as before. If either goes red, the wiring is wrong.
- `:1475-1488` — assertions unchanged; update the comment at `:1476-1483` (it names `InterruptControl` and `InterruptButton`, both gone). The structural half of its claim survives in the new shape: `Composer` takes `phase` alone, `isTurnRunning` admits only a `TurnPhase`, `ComposerSendButton` takes `isRunning: boolean`, and `localSendPending` has no path into any of the three.

**e2e — one migration, exactly one:**

- `e2e/real-claude-queue-drop.spec.ts:203-204` — replace `await sendButton.click()` with an Enter keypress on the composer (`await composer.press('Enter')`), keeping the `composer.fill(msg2)` above it. **AC4.** The turn-1 gate at `:196` (`expect(interruptButton).toBeVisible()`) runs immediately before, so phase is provably running at this point and the Send button is not on screen — this click would hang until timeout without the migration. True up the `:197-202` comment, which currently explains why clicking Send mid-turn is safe.
- **No other spec needs migrating.** Audited every `getByRole('button', { name: 'Send' })` site in `e2e/` (19 of them): `queued-backlog-interrupt.spec.ts:166` and `real-claude-interrupt.spec.ts:150` both click at `idle`; `real-claude.spec.ts:130,144` waits for turn 1 to quiesce between sends; `thread-scroll-pin.spec.ts:218,300,361` likewise (see its `:222` comment); `conversation-switch-keeps-both-threads.spec.ts:71,86` sends into two different conversations against a fake that no-ops `send_message`; the rest are single sends at idle or `toBeEnabled` assertions at launch. **Do not pre-emptively migrate any of them** — an unnecessary Enter conversion loses the Send-button coverage those specs currently carry.
- `queued-backlog-interrupt.spec.ts` needs no change but is worth re-running: it is the fake-tier twin that exercises the full `turn_state{thinking}` → stop-visible → click → `turn_state{idle}` → stop-gone cycle at `:199-209`, and it is the only tier `npm run e2e` can actually run.

**Gates.** `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`. Then **`npm run e2e:real:gate`** — two of the three stop-locator specs are real-claude tier and skip silently with a 0 exit without a credential, so `npm run e2e` cannot catch a break in them. Read the skip reasons, never the exit code.

---

## Comments to true up in-commit

Free scope: every file below is already in this ticket's file set.

- `conversation.css:1273-1277` — the "mobile Figma has no stop/interrupt affordance (the documented design gap)" claim. **Deleted with its block**, no rewrite needed.
- `ConversationScreen.tsx:1411` — the same claim, "the mobile-design gap's derived affordance". **Deleted with `InterruptButton`.**
- `ConversationScreen.tsx:1383-1388` — `isTurnRunning`'s doc calls it "the interrupt control's gate". Retarget: it is now the composer send button's stop-variant gate, and it has three other production consumers (`shouldShowThinking`, `conversationActivityBridge.ts:128`, and the tie documented at `conversationActivityStore.ts:28`).
- `ConversationScreen.tsx:1267-1271` — `workingIndicatorStateWithLocalSend`'s closing paragraph says "the interrupt control is handed `phase` alone (#758 made it a prop)". The substance holds; the referent moves to `Composer`.
- `ConversationScreen.test.tsx:1476-1483` and `:1565-1570` — both name the deleted components.
- `e2e/real-claude-queue-drop.spec.ts:197-202` — explains why clicking Send mid-turn is safe; it is now an Enter keypress and the reason has changed.

**Already resolved upstream — do not go hunting.** The ticket also cites stale "the interrupt control reads `selectPhase` alone" asides at `ConversationScreen.tsx:1225,1242`. #758 already rewrote those; the current text at those lines is `shouldShowThinking` / `workingIndicatorState` and mentions no store reader.

**Out of scope.** `src/renderer/src/store/threadTimeline.ts:222` calls `isTurnRunning` "the interrupt control's only gate". That file is outside this ticket's file set — leave it, and let the usual citation-retirement follow-up take it.

---

## Constraints

- **`isTurnRunning` must survive, exported, with its current signature.** Beyond the control being deleted it has three production consumers: `shouldShowThinking` (`ConversationScreen.tsx:1230`), a cross-module import in `conversationActivityBridge.ts:43,128`, and the tie documented at `conversationActivityStore.ts:28`. Deleting the interrupt block wholesale breaks the working indicator and a store bridge in another module.
- **Neither label string may be reworded.** `'Stop the running turn'` is a `getByRole` locator in `queued-backlog-interrupt.spec.ts:159`, `real-claude-interrupt.spec.ts:133`, `real-claude-queue-drop.spec.ts:162`. `'Send'` is a locator at ~15 e2e sites and the `CONVERSATION_MARKER` literal in `App.test.tsx:15` and `PairedShell.test.tsx:17`.
- **`sendInterrupt.ts` is untouched.** No new command type, no wire change.
- **No `localSendPending` in the stop gate.** See § State + concurrency model.
- **No knowledge-base doc is a deliverable.** `docs/knowledge/features/composer-send.md` and `interrupt-envelope.md` are read-only here; the documentation phase folds this ticket's lessons in after code review. The developer's worktree mutates only `src/`, `e2e/`, and this spec file.

---

## Open questions

1. **The colour + container re-theme.** Figma paints both variants' glyphs `--color-primary` on an M3 standard icon button whose container is invisible at rest; we render `--color-on-surface` on a permanent `--color-surface-container-high` pill. This ticket takes neither, for the reason in § Design source. The follow-up is one coherent change — both glyphs to `circle-*-solid-full` at 28×28 in `--color-primary`, and the pill dropped to a hover/focus-only container — and it needs a design ruling on whether the always-visible container is a deliberate desktop divergence before it is filed. Resolve after this lands, not during.
2. **Component name.** `ComposerSendButton` is named for the `.composer__send` class it owns, per this file's component↔class habit, but it renders a stop variant too. `ComposerActionButton` was the alternative. If the developer finds the name actively confusing while writing the doc comment, renaming before the first commit is free (one export, one render site, one test import) — after that it is a Strangler-Fig chore. Either choice is fine; do not spend turns on it.
3. **The disconnected-and-running reading.** § Error handling states it: an enabled stop that may do nothing. It preserves #307 exactly and needs no code, but it is the one behaviour a reviewer may reasonably challenge. If challenged, the fix is one clause (`disabled={!canSend}` on both variants) plus a test — file it rather than pre-empting it here.
