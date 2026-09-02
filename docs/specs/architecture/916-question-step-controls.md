# #916 — stepping the batch with Previous, and reading Next until the last question

## Files read

- `QuestionPanel.tsx` → `QuestionPanelView` — the view already holds `questions`, `activeIndex` and
  `onQuestionSelected`, so this slice changes **no prop and no signature**; `QUESTION_CANCEL_COPY` /
  `QUESTION_CONTINUE_COPY` — the named-constant precedent the two new copy strings join; the action row's
  own comment, which #915 corrected to hand Previous to this slice by name.
- `ConversationScreen.tsx` → `QuestionPanelSlot` — `onQuestionSelected={setJumpedTo}` is a plain index
  setter and `activeIndex = Math.min(jumpedTo, batch.questions.length - 1)` is the clamp above it. **The
  container is not edited.** Both facts are load-bearing for the index arithmetic below.
- `conversation.css` → `.question-panel__actions`, `.question-panel__cancel`, `.question-panel__continue` —
  the two selector lists Previous joins, and the 7px-vs-8px border-box compensation that makes an outlined
  button come out the same height as the filled one.
- `QuestionPanel.test.tsx` → `renderBatch`, `render`, `count`, `labelsRow`, `batch` — the fixture helpers
  the new cases reuse; and `renders an inert Cancel / Continue row above no dispatch`, which asserts
  `<button type="button"` **twice** on a one-question render and so is a live tripwire for AC1's
  "unchanged from today" clause.
- `e2e/question-picks.spec.ts` → arc 3, `BATCH_TABS`, `tab()`, `optionRow()`, `control()`, `otherField` —
  the two-question drive this slice extends, and the mutually-non-substring naming rule its literals obey.
- `docs/knowledge/features/conversation-shell-modals.md` § Question panel — the prior slices' lessons:
  picks are keyed on the nonce **and the question index**, which is why stepping costs preservation
  nothing; and the light-scheme fallback trap on every Figma colour read (not triggered here — this slice
  mints no colour).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6657

The Actions row with all three instances visible: `Cancel` (347:6661), `Previous` (347:6888) and the filled
trailing button (347:6692), right-aligned in one row 16px apart. Read on 2026-09-02, Previous carries
Cancel's treatment **exactly** — `Schemes/Background` fill, a 1px `Schemes/Primary` border, `Schemes/Primary`
text, 16px/7px padding — so it is the shipped `.question-panel__cancel` rule with no property changed; only
the filled trailing button differs. Figma draws **no Next**: the trailing instance reads `Continue`
everywhere in the file, because a static frame cannot express a label that depends on position, so the Next
copy is this ticket's decision rather than a design read.

## Context

#915 filled the title row with one tab per question and put the current index in `QuestionPanelSlot`'s own
state behind a clamp. Stepping is that same index moved by one, so this slice adds two controls over
machinery that already exists and changes no contract: the view keeps its #915 prop shape, the container is
untouched, and the picks store needs nothing because it has been keyed `(nonce, questionIndex)` since #911.
No ADR is warranted — a render slice over settled contracts.

## Design

**No signature change anywhere.** `QuestionPanelView`'s props are exactly #915's. Everything below is
derived inside the view from two values it already receives:

```ts
const canStepBack = activeIndex > 0
const isLastQuestion = activeIndex === questions.length - 1
```

**The action row becomes three slots, and the middle one is conditional.** Cancel leads (unchanged, still
inert), Previous sits in the middle and renders **only when `canStepBack`**, and the filled button trails.
Absent rather than `disabled` on the first question, for #915's own reason one row up: with nowhere to go, a
focusable control is a new tab stop in front of the operator for no gesture — and it is what makes a
one-question batch's row byte-identical to what shipped, which AC1 asks for by name.

**The trailing button is ONE element whose label and handler vary, never two branched elements.** It reads
`QUESTION_NEXT_COPY` when `!isLastQuestion` and `QUESTION_CONTINUE_COPY` on the last question, and carries
an `onClick` in the first case only. Two branched elements would reconcile as a replacement, so stepping
onto the last question with the keyboard would drop focus mid-row; one element keeps focus where the
operator put it.

**Copy.** `QUESTION_PREVIOUS_COPY = 'Previous'` and `QUESTION_NEXT_COPY = 'Next'`, exported beside the two
shipped constants, for the reason that file states: the line between what the client says and what claude
says has to stay visible in the source of a file that renders both. Each button's accessible name is its own
visible text; no `aria-label`, no `title`, no `data-*`.

**`.question-panel__continue` keeps its name** even though the copy on it now varies. The class names the
design's filled treatment slot (347:6692), the two call sites are the only references outside prose, and a
rename would churn the package overview to buy nothing observable. The reasoning goes in the row's comment
so the next reader does not read the name as a claim about the copy.

**Index arithmetic, and why neither end needs a new guard.** Previous dispatches
`onQuestionSelected(activeIndex - 1)` and is rendered only when `activeIndex > 0`, so the value it can send
is never negative. Next dispatches `onQuestionSelected(activeIndex + 1)` and is rendered only when
`activeIndex < questions.length - 1`; if that ever slipped, the container's existing
`Math.min(jumpedTo, length - 1)` absorbs it into a no-op re-render rather than a throw. A `Math.max(0, …)`
here would be a defence against a state neither handler can produce.

**CSS.** Two selector-list additions and nothing else. `.question-panel__previous` joins
`.question-panel__cancel, .question-panel__continue` for the shared type and geometry, and joins
`.question-panel__cancel` for the outlined fill/border/padding. No new rule, no new token, no new colour.

## State + concurrency model

No new state. The two handlers are a second and third writer to the same `jumpedTo` `useState` the tab row
already writes, through the same `onQuestionSelected` callback, and the clamp between that state and the
store's batch is #915's, unchanged. No async, no timers, no subscriptions, nothing to cancel.

The one interaction worth naming: `activeIndex` is component state and `batch.questions` is store state, so
a same-nonce re-delivery can shorten the list under a rendered Previous/Next. The upper end is the clamp's;
the lower end is closed by `canStepBack` gating the only handler that subtracts. Both are stated above.

## Error handling

No I/O and no new failure mode. Neither button sends anything — #853 owns the answer path, and Continue
stays inert on the last question exactly as it is today, so this slice adds no result type and no surface
for a failure to reach.

## Testing strategy

**vitest** — `QuestionPanel.test.tsx`, server-rendering `QuestionPanelView` from injected fixtures at each
index of a three-question batch. This is the **only** place the all-three-visible state is reachable: the
e2e arc drives two questions, where no question has both a previous and a next.

- The first question of a multi-question batch: no Previous, trailing reads Next.
- A middle question: Cancel, Previous, then the trailing button, **in document order**, all three present,
  and the trailing one reads Next.
- The last question: Previous present, trailing reads Continue and no Next copy anywhere.
- A one-question batch: the shipped two-button row exactly — no Previous, trailing reads Continue.
- Every step button is `type="button"`, carries no `disabled`, and the multi-question row still puts no
  claude-authored string in an attribute (the existing sentinel assertion, re-run at a stepping index).

**Playwright** — `e2e/question-picks.spec.ts`, arc 3 extended, because clicking is unreachable from a static
render. After the existing tab-click hops leave the operator on the second (last) question: assert Previous
is present and the trailing button reads Continue there; click Previous and find the first question drawn,
its tab active, and its radio pick and Other text intact; assert the first question offers no Previous and a
trailing Next; click Next and find the second question drawn, its tab active, and its three ticks and its
own Other text intact. The clamp push that closes the arc then reads Continue again on the one-question row.

## Open questions

- Whether Previous should be `disabled` on the first question rather than absent. Resolved absent by AC1's
  "a one-question batch's row is unchanged from today" and by #915's matching call one row up; recorded here
  because `disabled` is the reflex answer and the panel's comment already explains why nothing here is.
- Whether the trailing button's label change under a keyboard focus that stays put is a hazard once #853
  wires it. Named in the security review as out of scope, for #853 to answer.

## Security review

**Verdict:** PASS. No MUST FIX. Two findings are recorded as OUT OF SCOPE with the ticket that owns each.

**Findings:**

- **[Trust boundaries]** No findings, and the reason is narrower than "nothing changed". The escaping
  boundary this file owns is the render sink set for claude's four strings, and this slice **reads none of
  them**: `canStepBack` and `isLastQuestion` are derived from `activeIndex` and `questions.length` — a
  client-owned integer and an array length — and both button labels are module constants. What the slice
  *does* change is **which** of claude's headers and question bodies are on screen, via a second route into
  the same `onQuestionSelected(index)` callback the tab row already drives. That route ends at the same
  single `questions[activeIndex]` read, so the drawn set is unchanged in kind: no new attribute, no new key,
  no new lookup path. Both buttons are `<button>`, never `<a href>` — the URL sink stays unreachable.
- **[Tokens, secrets, credentials]** Not applicable, and the negative is worth stating precisely:
  `QuestionPanel.tsx`'s docblock claims it never reads `questionBatchId` at all, and this slice keeps that
  literally true — the nonce's one read is `ComposerSlot`'s React `key`, in a container this slice does not
  edit. No credential, no storage, no lifecycle.
- **[File / storage operations]** Not applicable: no `fs`, no `path`, no web storage, no cache. Nothing here
  turns any string into a filename or a cache key — the shape this category catches.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` surface, no
  `BrowserWindow` option, no navigation, no protocol handler; the transport stays in main. Both new controls
  are explicitly `type="button"`, matching Cancel and Continue, so neither can act as a submit control on an
  ancestor form. **The trailing button gains a conditional `onClick` for the first time**, which is the one
  place this slice could have grown a send path by accident: it is `onQuestionSelected(activeIndex + 1)` and
  nothing else, and on the last question — where the button reads Continue — it carries no handler at all,
  so the inert-until-#853 posture is preserved by construction rather than by care.
- **[Cryptographic primitives]** Not applicable. The two added comparisons are `activeIndex > 0` and
  `activeIndex === questions.length - 1`, both over client-owned integers routing a render —
  `questionBatches.ts`'s own stated reason for plain `===`. No secret is compared, so `timingSafeEqual` has
  nothing to protect here.
- **[Network & I/O]** No findings, and the index arithmetic is where one would live. A hostile daemon's
  lever on this slice is `questions.length`, through a same-nonce re-delivery that shortens the list under a
  rendered button. The **upper** end is #915's clamp, unchanged and still computed once. The **lower** end
  is new and is closed by the render condition: Previous is the only handler that subtracts and is rendered
  only when `activeIndex > 0`, so the value it can send is never negative, and `Math.min(jumpedTo, len - 1)`
  of a non-negative `jumpedTo` over a never-empty list is always a valid position. A stale closure firing
  after a shrink is covered by the same pair — a stale `activeIndex - 1` is still ≥ 0, and still too large
  only in the direction the clamp absorbs. No new guard is added, because neither handler can produce the
  state a guard would catch.
- **[Error messages, logs, telemetry]** No findings, and the absence stays load-bearing. Nothing in this
  family logs; a single "stepped to question N" diagnostic is exactly the line that would put the nonce and
  claude's text in a sink together. No logger import, no `console.*`, no throw carrying any of the four
  strings; the e2e literals stay spec-local and are never secret.
- **[Concurrency]** No findings. `jumpedTo` gains a second and third writer, all three going through one
  callback into one `useState`, all synchronous inside React's own event dispatch — there is no `await`
  between the read of `activeIndex` and the write, so the check-then-act race this category looks for has no
  gap to open in. No async, no timers, no listeners, nothing to cancel. The component-state-versus-store-
  state hazard #915 fixed is unchanged and is covered under Network & I/O above.
- **[Threat model alignment]** The applicable threat is **hostile daemon response**, and this slice widens
  nothing under it: `questions.length` was already a render input (#915 accepted the O(N) tab row as bounded
  by `MAX_FRAME_BYTES`), and the two constant-cost buttons this slice adds are a function of that same
  length. **Malicious relay** stays content-blind and on-path only; **renderer compromise reaching the
  transport** is unchanged, since no bridge surface is added; **token theft from disk** is untouched.
- **[OUT OF SCOPE — #853, the answer path]** Two things this slice deliberately leaves for the slice that
  sends. First, **the label swaps under a stationary focus**: stepping to the last question with the
  keyboard turns the focused Next into Continue on the same element, so the operator's next Enter activates
  a different action than the one they were looking at when they pressed it. Harmless today because Continue
  is inert; the slice that makes it send is where that becomes a mis-send, and where the mitigation (a focus
  move, or a confirmation) belongs. Second, **stepping is not answering** — nothing in this slice validates,
  assembles or transmits the picks, so no submit-side check is owed here and none is implied by the presence
  of a Continue label.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
</content>
</invoke>
