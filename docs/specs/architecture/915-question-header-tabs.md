# #915 — the batch's header tabs, and jumping between questions

## Files read

- `QuestionPanel.tsx` → `QuestionPanelView` — the prop shape this slice widens, the docblock that says the
  view "has no index to get wrong", and the option rows' `key={index}` comment the tabs copy verbatim.
- `ConversationScreen.tsx` → `QuestionPanelSlot`, `ComposerSlot`, `FIRST_QUESTION_INDEX` — the container
  holding that index as a constant today and as state after this.
- `src/renderer/src/store/questionBatches.ts` → `QuestionBatch`, `reduceQuestionBatches` — the batch is held
  whole for exactly this; the `shown` arm replaces a re-delivered batch **in place**; and the file names
  "keying a tab on `header`" as this family's failure mode, by hand.
- `src/renderer/src/store/questionPicksStore.ts` → `selectQuestionSelection` — already `(batchId, index)`, so
  a jump is the same read at a different index and AC5 costs this slice nothing.
- `src/shared/wire/types.ts` → `WireQuestion` — `header`'s cap (documented 12, **observed 14**, runes,
  enforced by nothing) and the per-field provenance: `header` is claude-authored, the two ids are not.
- `conversation.css` → `.question-panel__labels` (already wraps at the design's 8/16 rhythm),
  `.question-panel__label`, and `.conversation__unpair` — this repo's bare-text-button recipe.
- `ComposerOptionsPanel.tsx` → `aria-current={isCurrent ? 'true' : undefined}`, mirrored in
  `RunConfigSections`.
- `QuestionPanel.test.tsx`, `composerSlot.test.tsx`, `e2e/question-picks.spec.ts` — the fixtures that widen;
  `wireQuestion` and `questionShownFrame` each hardcode one question.
- `docs/knowledge/features/conversation-shell-modals.md` § Question panel — the prior slices' lessons: the
  covered composer's `hidden`, the nonce-not-conversation picks key, the light-scheme fallback trap on every
  Figma colour read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6829

Five `Question label` instances in one wrapping flex row — three on the first line, two on the second — each
a bare 11px uppercase Roboto Medium run at 16px line height, with no pill, no fill and no padding. Slot two
is `State=Active` (`Schemes/Tertiary` → `--color-tertiary`); the rest are `State=Inactive`
(`Schemes/Primary Container` → `--color-primary-container`). The states differ in `color` and nothing else,
and slot three holds a full sentence — the design's own statement that a header is not truncated. Colours
read from the node's **variables**; the generated fallbacks print the light scheme (`#cfe4ff`, `#8f4c37`),
the trap `tokens.css` and `.question-panel` already record.

## Context

The panel draws one question and one label. The batch has been held whole since #899 and the picks keyed per
question since #911, so this slice only fills the labels row and lets a click choose which question the box
draws. The box, the option rows and the Other field are untouched. Previous (#916) is **not** in this row —
Figma puts it in the Actions row — so this slice also corrects the two in-repo comments that misplace it, in
the files it edits. No ADR is warranted: a render slice over settled contracts.

## Design

```ts
QuestionPanelView({
  questions: readonly Question[]      // was: question: Question
  activeIndex: number
  onQuestionSelected: (questionIndex: number) => void
  // selection + the three #912 callbacks, unchanged
})
```

The box derives from `questions[activeIndex]` — one value, read once, so the tabs and the box cannot
disagree; the container uses that same value as its picks key.

**The tab row.** `questions.map(…)` inside the existing `.question-panel__labels`, keyed by array
**position**, never by `header` — claude-authored text in a lookup path is the failure `questionBatches.ts`
and `WireQuestion` each name by hand, and a tab row is where it is reached for first. Each tab's accessible
name is its own visible text, so `header` stays on the React-children path: no `aria-label`, no
`aria-labelledby`, no generated `id`, no `title`, no `data-*`.

**Element by count, because AC4 is about the affordance and not only the paint.** One question renders
today's `<span className="question-panel__label">` unchanged — nothing focusable, nowhere to jump. Two or
more renders every tab as `<button type="button">`, the active one included; clicking it re-selects the
question already on screen, which React bails out of.

**Active vs inactive.** The active tab carries `aria-current="true"` (`undefined` elsewhere, so no
`aria-current="false"` is emitted), which keeps the distinction from being colour-only.
`.question-panel__label` keeps the shipped Active colour, and inactive tabs add a `--inactive` modifier — the
only new colour in the stylesheet.

**No `role="tablist"`.** A conforming tab widget needs `aria-controls` pointing at a panel `id`, in a
component whose test asserts no `id=` reaches the markup at all. Buttons plus `aria-current` give the same
affordance with no id, no roving tabindex and no arrow-key contract; this row is a set of jump controls.

**CSS.** `.question-panel__labels` is untouched. `--tab` is the `.conversation__unpair` recipe minus its pill
(zero padding, no border, transparent ground, `cursor: pointer`, `font-family: var(--font-sans)`,
`text-align: left`) plus the repo's `:focus-visible { outline: 1px solid var(--color-outline) }`.
`--inactive` sets `color: var(--color-primary-container)` and nothing else. **One deliberate divergence from
the generated Figma code:** its slots are `whitespace-nowrap`; the shipped `word-break: break-word` is kept
and no `white-space` is added, because an unbounded hostile header under `nowrap` pushes the row's width out.

## State + concurrency model

`activeIndex` is `useState(FIRST_QUESTION_INDEX)` in `QuestionPanelSlot` — panel-local, deliberately not a
new arm on the picks store: what must survive a chat switch is the picks, and they already live outside the
keyed pane, so an index in the store would widen its event union and clearing arms for nothing observable. A
chat switch remounts the pane (#670) and the index resets, which is intended. `FIRST_QUESTION_INDEX` survives
as that seed, with its docblock rewritten — its "stepping through a batch is deferred" clause is this ticket,
and its two-places warning now belongs to `activeIndex`.

Two guards sit between that component state and the store state it indexes, covering **disjoint** cases:

1. **`key={batch.questionBatchId}` on `<QuestionPanelSlot>` in `ComposerSlot`.** The slot stays mounted while
   any batch is up, so a *different* batch taking the panel would inherit the retired one's index and open
   mid-list. The nonce as key remounts the leaf and re-seeds `useState` — React's own prescribed reset, and
   #670's shape one level up. React strips `key` from props, so the unguessable value reaches no attribute,
   no log and no DOM node.
2. **The index used is `Math.min(held, batch.questions.length - 1)`.** Re-delivery under the *same* nonce
   replaces the batch in place, so the key does not change and the slot does not remount; a re-delivery
   carrying fewer questions than the operator jumped past would read `undefined` and throw out of the render,
   on a daemon-controlled frame. Computed **once** and feeding both the question read and the picks key, so
   those two still cannot disagree. `questions.length` is never 0 (the reducer's empty guard), so the clamp
   always yields a valid position.

No async, no timers, no subscriptions: this slice adds a click handler and a `useState`.

## Error handling

No I/O, no new failure modes. Both shape hazards are closed by construction: an empty `questions` never
reaches `outstanding` (guard before the match), and the out-of-range index is closed by the clamp above. A
`?? questions[0]` fallback is the wrong shape and looks like the right one — it renders one question's rows
against another question's selection, the disagreement `FIRST_QUESTION_INDEX` was named to prevent.

## Testing strategy

**vitest** — `QuestionPanel.test.tsx`, static server render of the widened view from injected fixtures (the
`environment: 'node'` ceiling): one tab per question in batch order carrying each `header`; exactly one
`aria-current="true"` and `N-1` inactive; a non-zero `activeIndex` draws that question's text, options and
control variant; a one-question batch draws a single `<span>`, no `<button>` and no `--inactive`; two
byte-identical headers draw two tabs (the observable consequence of keying by position); the multi-tab render
still puts no claude-authored string in any attribute and still escapes a hostile `header`.
`composerSlot.test.tsx` keeps its first-question assertion and gains one tab-per-question first paint.

**Playwright** — `e2e/question-picks.spec.ts`, for the click and the preservation, both unreachable from
vitest. `wireQuestion` and `questionShownFrame` widen to take what an arc needs. A third arc pushes a
two-question batch (Q1 single-select, Q2 multi-select): two tabs; pick in Q1; click Q2's tab and see its own
text and its checkbox rows; tick and type there; back to Q1 and find the radio pick and Other text intact;
forward again and find Q2's intact. It ends by pushing a **same-nonce re-delivery carrying one question**
while the operator is on Q2 — the clamp's only reachable proof, since a static render never leaves the seeded
index — and the panel must still be standing under a single non-button label. Arcs 1 and 2 gain one assertion
that the one-question row holds no button.

## Open questions

- Whether the active tab should be non-focusable the way the one-question label is. Resolved for a uniform
  button row: the design draws five instances of one component, and skipping the active one puts a hole in
  the keyboard order mid-row. AC4's "no jump affordance" is about the case with nowhere to jump.
- Whether a question switch can leave a stale DOM `checked` on a radio input React reuses by position. Driven
  by the third e2e arc rather than pre-empted with a `key` on the options list; if it reproduces, the fix
  lands with a `## Revisions` entry.

## Security review

**Verdict:** PASS. The first pass FAILED on the [Concurrency] finding below; the plan above is the revision,
and this is the re-run.

**Findings:**

- **[Trust boundaries]** No findings. The boundary is unchanged — the render sink set — and this slice draws
  N claude-authored `header`s where one was drawn before, adding no new sink: each is a React child, each
  tab's accessible name is that same text, and the tabs are keyed by **position**. `<button>`, never
  `<a href>`: a link is the URL sink and `header` is what would fill it.
- **[Trust boundaries — the nonce]** No findings, and the new read is deliberate. `ComposerSlot` now reads
  `questionBatchId` for a React `key`; React strips `key` from props, so it reaches no attribute, no log and
  no DOM. `QuestionPanel.tsx`'s "this file never reads the nonce at all" stays literally true — the read is
  one level up, in the container.
- **[Tokens, secrets, credentials]** Not applicable: no credential, no storage, no lifecycle. The nonce is the
  nearest thing and is covered above.
- **[File / storage operations]** Not applicable: no `fs`, no `path`, no web storage, no cache — nothing here
  turns a claude-authored string into a filename or a cache key, the shape this category catches.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, no `contextBridge` surface, no
  `BrowserWindow` option, no protocol handler, no navigation; the transport stays in main. Every tab is
  `type="button"`, explicit and matching Cancel/Continue, so no tab can act as a submit control.
- **[Cryptographic primitives]** Not applicable. The one added comparison is `index === activeIndex`, two
  client-owned integers routing a render — `questionBatches.ts`'s own reasoning for plain `===`.
- **[Network & I/O]** OUT OF SCOPE, bounded upstream, named here. `questions` has no membership cap; it is
  bounded only by `MAX_FRAME_BYTES` at the codec. The render cost in that length was O(1) — one question drawn
  whatever the batch held — and becomes O(N) tabs, so a hostile daemon inside the session can make the row as
  tall as the frame cap allows. Accepted, not fixed: #915 states there is no tab cap to enforce, the frame cap
  is the real bound, and truncating would break AC1. The mitigation taken instead is `word-break: break-word`
  over the design's `nowrap`, so one unbroken hostile header cannot push the row's width out.
- **[Error messages, logs, telemetry]** No findings. Nothing in this family logs, and that absence is
  load-bearing — one "which tab did we draw?" diagnostic puts the nonce and claude's text in a sink in one
  line. No logger import, no `console.*`, no throw carrying `header`; the e2e nonces stay spec-local routing
  literals, never asserted on.
- **[Concurrency]** **MUST FIX — found on the first pass; the plan above is the fix.** `activeIndex` is
  component state and `batch.questions` is store state, updating independently. A same-nonce re-delivery
  replaces the batch **in place**, so the `questionBatchId` key does not change, the slot does not remount,
  and a held index past the re-delivered list's end reads `undefined` — a throw out of the render, on a frame
  the daemon controls and the reducer explicitly supports. The first draft closed only the *different*-batch
  case, with the remount key, and read as complete. Fixed by the clamp, computed once for both the question
  read and the picks key, and driven in Playwright rather than left to inspection. No other concurrency
  surface: no async, no timers, no listeners, nothing to cancel.
- **[Threat model alignment]** The applicable threat is **hostile daemon response**, and this slice widens one
  thing under it: the array's length and every `header` in it become render inputs. Both are addressed above.
  A **malicious relay** stays content-blind and on-path only; **renderer compromise reaching the transport**
  is unchanged, since no bridge surface is added; **token theft from disk** is untouched.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Revisions

**2026-09-02, implementation.** No design change — both Open Questions resolved as the plan proposed, and
the code landed as designed.

- The uniform button row stands: every tab in a multi-question batch is a `<button>`, the active one
  included, and only the one-question row keeps the bare `<span>`.
- The stale-`checked` question **did not reproduce**. Arc 3 of `e2e/question-picks.spec.ts` drives the worst
  case directly — a single-select question's radios reconciled into a multi-select question's checkboxes by
  position, and back — and both directions read their own store state on every hop. So no `key` was added to
  the options list, which would have been a defence against a failure mode that does not occur.
</content>
