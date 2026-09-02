# 907 — The question's option rows, in radio and checkbox variants

The option-row slice of the question vertical. #906 drew the panel's frame; this fills the band between the
question's text and the separator with one row per held option, plus the design's in-list Other row. It is
drawing only — the picks are #908's.

## Files read

- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QuestionPanelView`, `QUESTION_CANCEL_COPY` —
  the frame this fills, the client-owned-copy constant idiom the Other placeholder joins, and the
  untrusted-text posture (claude's strings are React children and nothing else) extended to two more fields.
- `src/renderer/src/store/questionBatches.ts` → `Question`, `QuestionOption` — the held shape. **No `id`**
  (the answer protocol selects by `label`), array position is claude's display order, `description` is a
  required `string` so `''` is legal traffic. The module header names the failure this slice must not
  commit: untrusted text in a lookup path, "by keying a tab on `header` or memoising on `label`".
- `src/renderer/src/screens/conversation/conversation.css` → `.question-panel__box`,
  `.question-panel__question`, `.question-panel__cancel`, `.composer__input` — the 16px column gap the rows
  inherit; the clamp that is the question text's own and stays untouched; the "structural geometry may be a
  literal" precedent; and the repo's only text-input precedent (explicit `box-sizing`, a focus affordance
  rather than a bare `outline: none`, since there is no global box-sizing reset).
- `src/renderer/src/screens/pairing/pairing.css` → `.pairing-field::before` — **the house rule for a
  translucent Figma fill**: a token on a dedicated pseudo-element at `opacity`, never a bare `rgba()` /
  `color-mix()` literal. The Other field's ground is that shape exactly.
- `src/renderer/src/theme/tokens.css` → `--text-label-medium-*`, `--text-body-small-*`, `--color-tertiary`,
  `--color-on-surface`, `--color-primary-container`, `--color-on-primary`, `--space-2/3`, `--radius-xs`,
  `--radius-full` — every value this slice needs already exists; **no new token is minted.**
- `docs/knowledge/features/conversation-shell-modals.md` § the question panel — #906's folded lessons: read
  colours from the Figma *variables* (the generated fallbacks print the light scheme), and the panel's
  controls are inert-but-real rather than greyed.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6015

The two option lists (`347:6025` single, `347:6706` multi) are an 8px-gapped column. A row is a 20×20
control, a 12px gap, then a text column stacking the option's Label over its Description — both in Schemes/On
Background, **distinguished by weight alone** (M3 label/medium-emphasized 600 over label/medium 500), wrapping
freely. Everything but the control is identical across the variants: the radio is a 2px Schemes/Tertiary ring
at radius 10 on a 20px box, the checkbox the same ring at radius 4. The last row is Other — the same control,
offset 8px down and centred against a taller `Input small` field (radius 6, an On-Primary-tinted ground)
whose placeholder reads `Other. Type something.` in Schemes/Primary Container at M3 body/small.

Read from the **variables** on `347:6025`: Tertiary `#ffb59f`, On Background `#e0e2e8`, Primary Container
`#134a74` — i.e. `--color-tertiary`, `--color-on-surface`, `--color-primary-container`. The field's ground is
a raw `rgba(0,51,85,0.41)` in the file, which is `--color-on-primary` (`#003355`) at 41%.

Two things the drawing shows that are deliberately **not** reproduced. The mock has row 1 selected and every
checkbox ticked; AC5 says every row draws at rest, so no selector child is emitted and the tick's Figma asset
is never fetched (#908 draws the ticked state). And the separate `Other options` frame below the separator
(`347:6569` / `347:6711`) is hidden in both variants and is not drawn.

## Context

`QuestionPanelView` draws a header and a question over an empty band. Filling it is what makes the panel
readable as a question rather than a notice. No ADR is warranted: #906 settled the view's shape.

**Sizing.** All six boundaries hold: 1 production `*.tsx` (plus `conversation.css` and its co-located spec),
**0 consumer call sites** — `QuestionPanelView`'s signature is unchanged — 1 new export, 5 acceptance
criteria, no state machine. Code plus CSS plus tests measures near 300 against the refiner's ~320 and the
#906 analogue's actual 362; only plan prose can push the total past 400, so the plan is kept short rather
than the work split. No split is available that clears the floor rule anyway: an "Other row" child is one row
inside this same list, consumed by nothing outside the family, and the two variants differ by one class name.

## Design

Two edits, no new file.

**`QuestionPanel.tsx`** — an option list between `.question-panel__question` and `.question-panel__separator`,
inside `.question-panel__box` so it inherits that box's 16px gap. The signature is unchanged: `multiSelect`
and `options` come off the `question` prop already in hand.

- `question.options.map((option, index) => …)`, **keyed by `index`**. The array is claude's own display order
  and is never re-keyed, so the index is the honest key — and the only one that keeps untrusted text out of a
  lookup path. `label`, `description` and `header` are banned as keys by name (AC4).
- Each row: a presentational control `<span>`, then a text column holding a `<p>` label and — **only when
  `option.description !== ''`** — a `<p>` description (AC5: an empty description contributes no element
  rather than a blank line holding height). Both strings are React children and reach nothing else.
- The control's class carries the variant. That one conditional is the whole difference between the two.
- **The controls are chrome; the Other field is inert-but-real** — the ticket's own vocabulary, and the line
  is load-bearing. A native `<input type="radio">` at rest is focusable and *checkable*: clicking it would
  paint a selection the store does not hold, a worse resting posture than #906's inert buttons, whose click
  leaves no residue. So the controls stay `<span>`s until #908 lands the state that makes a real control
  honest. The Other field is an uncontrolled `<input type="text">` in #906's sense — real, no handler, no
  `disabled`, nothing reads it — carrying the design's placeholder from a new `QUESTION_OTHER_PLACEHOLDER_COPY`
  beside #906's two constants, and the same constant as its `aria-label` so the field has an accessible name
  (a placeholder alone is only a last-resort one).
- The Other row renders last, unconditionally, in both variants (AC3).

**`conversation.css`** — one block between `.question-panel__question` and `.question-panel__separator`,
matching the file's existing order. Rows 8px apart (`--space-2`), a 12px control-to-text gap (`--space-3`),
the control `box-sizing: border-box` at 20×20 with a 2px `--color-tertiary` ring. Radius: `--radius-full` for
the radio — a 10px radius on a 20px box *is* the circle — and a literal `4px` for the checkbox, kept verbatim
rather than snapped to `--radius-xs` (6px) the way `.pairing-field` snaps a field's corners, because that snap
visibly over-rounds a 20px control; the literal is structural geometry, `.question-panel__cancel`'s precedent.
The text column is `flex: 1 1 0; min-width: 0` with the design's 2px optical nudge; label and description
share `--color-on-surface` and differ only in weight, per the variable read.

The Other field's tinted ground goes on a `::before` at `opacity: 0.41` over `--color-on-primary`, the
`.pairing-field::before` rule — `opacity` on the field itself would fade the placeholder too, and a literal
`rgba()` is what the rule exists to prevent. The input clears its own border and background and keeps a
`:focus-visible` outline.

**One comment correction in scope:** `.question-panel__cancel` / `__continue`'s docblock calls those two "the
only focusable controls on the panel". The Other field falsifies that; the sentence is amended.

**Explicitly untouched.** `.question-panel__question`'s single-line clamp stays as shipped — the "reconsidered
in #907" note in `QuestionPanel.tsx` is not this slice's licence to relax it, and that comment is corrected.
The title row, separator and action row are #906's.

## State + concurrency model

None. `QuestionPanelView` stays a pure function of its prop: no store read, no effect, no subscription, no
async work, nothing to cancel. The Other `<input>` is uncontrolled, so its DOM value reaches no React state
at all until #908 makes it controlled.

## Error handling

Nothing fallible: no IPC, no parse, no I/O. The one branch is `description === ''`, legal traffic settled by
AC5. An empty `options` needs no guard either — `.map` over it draws the Other row alone, a coherent render.

## Testing strategy

Vitest static server renders from fixtures injected straight into `QuestionPanelView` — no store, no DOM, no
Playwright (interaction is #908's). `QuestionPanel.test.tsx` gains:

- `multiSelect: false` draws one radio-classed control per option and no checkbox class; `multiSelect: true`
  the mirror. Both count the fixture's options plus the Other row.
- Rows appear in the held array's order, each carrying its `label` and `description` in the stack.
- An option with `description: ''` draws its label and **no** description element, while a sibling with one
  still draws it.
- Every control is empty at rest — no selector child, no `checked` anywhere in the markup.
- The Other row is last, carries an `<input type="text">` whose placeholder and accessible name are
  `QUESTION_OTHER_PLACEHOLDER_COPY`, and takes the variant's control chrome in both variants.
- Security: a fixture whose `label` and `description` carry `<img src=x onerror=…>` / `<script>` / `&`
  renders escaped with no `<img` / `<script` in the markup; sentinels appear exactly once each as element
  content; the markup carries no `title=` and no `data-`.
- Two options sharing an identical `label` and `description` both draw. React keys are not observable in
  static markup, so this asserts the observable consequence of index-keying rather than the key itself.

#906's `draws no option rows` case is superseded — rewritten into the positive assertion, since its fixture
already carries an option.

## Open questions

None. The one the ticket raises — whether the question text's clamp is reconsidered here — it answers itself:
it is not.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] **MUST FIX — fixed in this plan before commit.** The row's React key is a sink the frame
  slice never had, and `label` is the *only* identity `QuestionOption` carries, which makes `key={option.label}`
  the reflex — untrusted text in a lookup path, the exact failure `questionBatches.ts` names ("memoising on
  `label`"). The Design section now fixes the key as the array index and says why the never-re-keyed order
  makes that honest. Re-walked after the edit: the sinks this plan prescribes for `label` and `description`
  are JSX children and nothing else — no `key`, no `title`, no `data-*`, no `aria-*` (the field's `aria-label`
  is the client-owned constant), no `id`, no `name`, no memo table, no log.
- [Trust boundaries] No further findings. The boundary is #906's, widened from two claude-authored fields to
  four. The Other row's copy is a client-owned constant, so the one attribute this slice adds (`placeholder`)
  can never carry daemon text.
- [Tokens] No findings. This slice reads `options` and `multiSelect` and nothing else; `questionBatchId` —
  the one-time unguessable nonce — is not read, not keyed on, not drawn. The Other field's uncontrolled DOM
  value is never persisted, sent, or read back.
- [File / storage] No findings — no `fs`, no `localStorage`, no `safeStorage`, no path built from any input.
- [Electron attack surface] No findings. No new IPC channel, no `contextBridge` surface, no `window.pyry`
  dereference, so the component still server-renders under `environment: 'node'`. Nothing crosses the process
  line: these strings were already in renderer memory the moment #906 mounted the bridge.
- [Cryptographic primitives] Not applicable — no randomness, no key material, no comparison against a secret.
  The one comparison added is `description !== ''`, a display decision on the client's own held value.
- [Network & I/O] No findings, on a **verified** bound: `decodeInnerFrame` in `src/main/transport/codec.ts`
  rejects an outer frame over `MAX_FRAME_BYTES` (256 KiB), so every `label` and `description`, and their
  count, are size-bounded before reaching the store. No fetch is added — in particular the Figma tick asset
  is not transcribed, so the renderer makes no outbound request (its CSP has no `img-src` and it would fail
  closed anyway).
- [Errors, logs, telemetry] No findings. No logger import and no `console.*`, matching the deliberate absence
  both store modules record. No `data-*` carries claude text, so none reaches test output either.
- [Concurrency] No findings. A pure render: no effect, no timer, no listener, no `await`, so no
  check-then-act gap and nothing to tear down.
- [Threat model] OUT OF SCOPE, **and this slice enlarges it** — stated plainly rather than inherited in
  silence. #906's clamp bounded the panel at one line of claude text; option rows wrap by design (the ticket
  and the mock's second row both say so), so a hostile daemon sending many long options can grow the panel in
  the composer's slot and squeeze that conversation's timeline. Not defended here, on three grounds: the wrap
  is the locked design and a clamp would diverge from it; the total is bounded upstream by the 256 KiB frame
  cap; and the exposure is scoped to one conversation's composer, every other chat staying usable — the same
  bound #906 recorded for the never-dismissed batch. A daemon hostile enough to try this already holds the
  session. A real bound belongs with the answer path (#908), where the list would gain its own scroll
  container.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
