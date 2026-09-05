# #1062 — the composer footer's context reading turns amber at 50% and red at 70%

## Files read

- `src/renderer/src/screens/conversation/contextUsage.ts` → `contextUsagePercent` — the shared arithmetic
  and its `number | null` guard; the new ladder lands beside it, in the same leaf module (no imports, so
  it cannot join the import cycle `runConfigLive.ts` documents).
- `src/renderer/src/screens/conversation/contextUsage.test.ts` → the `describe` shape and the
  boundary-as-value habit the ladder's own tests copy.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ContextUsageReading` (the pure view
  this ticket edits), `ContextUsageControl` (its store-bound container, untouched), `LegCategory` (the
  precedent for an exported coarse-category union in this file).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `ContextUsageReading` describe
  (the exact-markup pin this ticket rewrites on purpose) and the five footer-order assertions that locate
  `composer__context` by substring — all of which survive a class suffix.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__context` (the rule that gets two
  modifiers and a re-stated length bound), `.composer__footer` (hard 20px height — the reason no geometry
  assertion here can detect anything), `.composer__footer-button` (the standing ruling that the
  `--color-primary` hoist onto the row stays declined).
- `src/renderer/src/screens/conversation/runConfigLive.ts` → `createRunConfigRefreshTrigger` — the edge
  that decides how the e2e tier can move the reading at all: `connected`, plus each running → not-running
  `turnState` transition, per conversation.
- `src/renderer/src/theme/tokens.css` → `--color-primary`, `--color-warning`, `--color-error`. All three
  exist; this ticket mints none.
- `e2e/composer-model-announced.spec.ts` → the drive idiom: a capturing fake answering
  `request_session_settings`, and the reading itself used as the "snapshot has landed" barrier.
- `e2e/composer-message-box.spec.ts` → `tokenColor`, the throwaway-probe helper that resolves a token to
  the `rgb()` form `getComputedStyle` reports, so the hex → `rgb()` conversion is the engine's own.
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW`, `seedConversationsFrame`, the `buildReplyFrames` seam
  (a test-process closure, so a spec-side `let` can steer successive replies).
- `docs/knowledge/features/conversation-shell-composer-message-box.md` § "Composer footer row (#811)" →
  the reading's established posture: a `<span>` with nothing beyond `className`, no live region, one
  template-literal text run. This ticket keeps every one of those and adds only a class token and, at the
  top step, five characters of client-owned prefix.
- `docs/knowledge/features/conversation-shell-workspace-and-run-config.md` § the context-window section →
  why the sheet's gauge and this reading share one function, which is what makes the "the bar stays green"
  choice below a deliberate one rather than an oversight.

Codegraph was not consulted: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized". The reading list above came from `grep`/`Read`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=110-3497

One state only: the single text run `Context: 84%`, M3 body/small (12/16, 0.4px tracking, weight 400) in
`schemes/primary`, `white-space: nowrap`, sitting as one item of the input footer row. The drawing pins no
threshold and no second colour — the 50/70 ladder and the amber/red steps are the operator's ruling of
2026-09-04, layered onto a node that is otherwise reproduced exactly as it ships today. Everything the
drawing does pin (the type ramp, the single run, the reading's place in the row) is unchanged by this
ticket, and the below-50 arm's markup stays byte-identical to what is on `main`.

## Context

The reading is the only place in the window that says how full the session's context window is, and today
it paints `--color-primary` at 3% and at 97% alike — so the number has to be read to be understood. This
ticket makes the colour carry the same fact as emphasis, amber from 50% and red from 70%, and at the top
step adds a word to the string so the "act now" state is not colour-only.

No ADR is warranted: this adds no new token, no new store, no new event, and no new architectural seam —
it is one pure function and one class modifier on an existing surface.

## Design

### The ladder — `contextUsageStep`, beside `contextUsagePercent`

```ts
export type ContextUsageStep = 'primary' | 'warning' | 'error'
export function contextUsageStep(percent: number): ContextUsageStep
```

A second pure function in the same leaf module, for the reason the module exists: the thresholds are
*values*, and values belong somewhere a test can call directly. A stylesheet cannot express "50" as
anything a test can assert, and an inline conditional at the call site would put the two boundaries inside
a component the renderer tier can only reach through rendered markup.

Both boundaries are stated exactly once, in one descending ladder — `>= 70` → `error`, `>= 50` →
`warning`, else `primary`. Descending rather than two ranges, so neither boundary appears twice and no
gap between the arms is expressible. Inclusive by construction: 49 is primary, 50 is warning, 69 is
warning, 70 is error.

The literals stay literals inside the ladder and are **not** exported as named constants. Exporting them
would let the test assert the ladder against the same symbol the ladder is written from, which pins
nothing; the tests below hard-code 49/50/69/70 so they are falsifiable against a `>` / `>=` slip.

The parameter is `number`, not `number | null`. The reading's null case is already resolved one line
earlier by `contextUsagePercent`'s return type, and taking a nullable here would re-open a guard that is
deliberately the return type rather than a convention.

The step names are the roles, not the colours: `warning` and `error` are exactly the token suffixes and
exactly the class modifiers, so the mapping from step to paint is nominal at every layer and a fourth step
would be one obvious edit rather than three lookups.

### The view — `ContextUsageReading`

Still one `<span>`, still one template-literal text run, still nothing beyond `className`. Two derived
values:

- **class** — `composer__context` alone on the primary step (byte-identical to today), otherwise
  `composer__context composer__context--<step>`. The base token stays **leading**, which is what keeps the
  five footer-order assertions that locate the reading by substring green, and the modifier is appended
  last rather than swapped in, so nothing that reads the base class has to learn the ladder.
- **text** — `Context: N%` below 70, `Context high: N%` at 70 and above. The word rides the top step alone
  because that is the step with something to act on; the amber step is emphasis on a percentage the reader
  can already read, which is what keeps WCAG 1.4.1 satisfied without a word there.

The prefix stays a client-owned literal built in the component, not in `contextUsage.ts`: the ladder maps
a number to a step, and copy is the view's. Still no daemon-supplied string on this path, so there is
nothing to escape and nothing to length-bound.

No `aria-label` (name-from-author is not supported on a generic role), no live region (the figures refresh
on every turn end since #810, so a polite region would announce a percentage after every turn), no role,
no handler, no `tabindex`, no `title`. The exact-markup pins below are what keep that structural rather
than stated.

`ContextUsageControl` is untouched.

### The paint — `conversation.css`

Two modifier rules immediately after `.composer__context`, each a single `color` declaration naming a
token: `--color-warning` on `--warning`, `--color-error` on `--error`. Equal specificity to the base rule
(0,1,0), so source order is what makes them win — they must stay below it, and the comment says so.

The base rule's `white-space: nowrap` comment currently justifies its missing truncation chain with "at
most 13 characters"; the top step's string is 18 (`Context high: 100%`), so the justification is re-stated
with the new bound rather than left stale. The bound is still client-owned and still constant-length: the
only interpolated value is an integer in [0, 100].

The `--color-primary` hoist onto `.composer__footer` stays declined, unchanged by this ticket — a hoisted
`color` would not reach the row's four `<button>` children anyway, and the reading now has *three* colours
rather than one, which makes it less of a hoist candidate than before.

**The run-configuration sheet's gauge is deliberately not touched.** `.run-config__context-fill` stays
`--color-success` at every value, so at 80% the footer reads red while the sheet's bar reads green from
the same number. That is this ticket's stated choice, not an oversight: keeping the ladder in
`contextUsage.ts` rather than in the stylesheet is what leaves the bar one class away from following it in
a later ticket.

## State + concurrency model

None added. The reading is a pure function of the `runConfigStore` snapshot that `ContextUsageControl`
already reads in one selector call; this ticket adds no store, no subscription, no effect, no timer and no
async work of any kind. Nothing here can outlive a render, so there is nothing to cancel.

The only lifecycle fact that matters is a *test* fact: the reading mounts only once a snapshot exists, and
`session_settings` is reply-only. `createRunConfigRefreshTrigger` fires on `connected` (which sends
nothing before a conversation is active) and on each per-conversation running → not-running `turnState`
transition — a lone `idle` fires nothing, because the trigger's edge is a `Set.delete` that returns
`false` when the conversation was never marked running. So the e2e drive below pushes `thinking` then
`idle` for each step it wants to observe.

## Error handling

No new failure mode. The ladder is total over `number`: every input, including `NaN`, falls through both
comparisons to `primary` — the same arm the shipped colour uses today — and `NaN` cannot reach it anyway,
since `contextUsagePercent` returns `null` for every input that could produce one and the caller returns
before the ladder runs. No I/O, no IPC, no parse, no branch that can reject.

## Testing strategy

**Renderer tier (vitest, `renderToStaticMarkup`, node environment)**

- `contextUsage.test.ts` — a new `describe` for the ladder, pinning the six values the AC names as
  literals: 0 and 49 primary, 50 and 69 warning, 70 and 100 error. Written as hard-coded numbers so a
  `>` / `>=` slip at either boundary reddens.
- `ConversationScreen.test.tsx` — the existing exact-markup pin becomes **one exact pin per step**: the
  primary arm asserted byte-identical to what ships today, the warning arm with its modifier and its
  unchanged text, the error arm with its modifier and the `Context high:` prefix. The exactness is the
  assertion (it is what proves no handler, no role, no tabindex, no title can hide in the span), so all
  three stay `toBe`, never `toContain`. The absent-arm, clamp and no-live-region tests keep their current
  form; the clamp test's 100% now reads `Context high: 100%`, and the footer-mount assertion at 84%
  likewise — both are the same tripwire firing on purpose, not collateral.

**e2e tier (Playwright, fake transport) — `e2e/composer-context-severity.spec.ts`**

The painted colour is invisible to `renderToStaticMarkup`, so the three steps' computed `color` is proven
in the built app against each token's own resolved value, via the `tokenColor` probe helper copied from
`composer-message-box.spec.ts` — never a hard-coded `rgb()` triple.

One launch, three turn-end cycles. The reply factory answers `request_session_settings` from a
spec-side mutable `usedTokens`, which the body sets before each cycle — a *variable*, not a consume-once
queue, so a duplicate request (a sheet open landing beside an edge) answers with the same value instead of
skipping a step. Scenarios, each `thinking` → `idle` then assert:

- 49% → text `Context: 49%`, `color` equals `--color-primary`'s resolved value.
- 50% → text unchanged in form (`Context: 50%`), `color` equals `--color-warning`'s.
- 70% → text `Context high: 70%`, `color` equals `--color-error`'s.

Both boundaries are driven from the painted side as well as the pure side, and the top step's word is
proven where a real reader would meet it.

**Not written, deliberately.** No geometry assertion: `.composer__footer` is a hard `height: 20px`, so a
`boundingBox().height` on it can never redden however the reading changes, and the reading's position in
the row is already pinned by the footer-order markup assertions. No new spec touches the six existing
run-config-seeding specs — all six seed 50 000 / 200 000 = 25%, which stays on the primary step and keeps
its current markup byte for byte.

## Open questions

- **Does the 5-character growth overflow the footer at the 800px minimum window?** **Resolved: it already
  overflowed, by a wide margin, and this ticket does not widen into a fix.** Measured with a throwaway
  probe (an 800×600 window, the fixture's seeds, since deleted): `.composer__footer` has a 316px content
  box there and its content needs **429px carrying the PRE-#1062 string** `Context: 25%`, against 465px
  carrying the longest post-#1062 one, `Context high: 100%`. So the row overflows by 113px before this
  ticket touches it and by 149px after — the word adds 36px to a row that was already 113px over. Filed as **#1107**
  rather than fixed here, per the ticket's own instruction. No detector was written: the
  row's `height: 20px` makes a `boundingBox().height` assertion structurally unable to redden, and a width
  detector would be a footer-overflow regression test, which belongs to the ticket that fixes it.
- **Should the sheet's gauge follow the ladder?** Answered above: not here. Recorded so the divergence is
  a decision on the record rather than a discovery for the next reader.
