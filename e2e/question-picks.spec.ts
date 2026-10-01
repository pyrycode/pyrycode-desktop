import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import { encodeEnvelope } from '../src/main/transport/codec'
import type {
  QuestionDismissedPayload,
  QuestionShownPayload,
  WireQuestion,
  WireQuestionOption
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the QUESTION PANEL's picks (#912). The first question spec in this repo: #906 drew
// the panel, #907 drew its rows at rest and #911 landed the picks store with no consumer mounted, and every
// one of those slices was provable by static server render precisely because nothing responded yet. This
// slice makes the rows respond, so its first three acceptance criteria are unreachable from vitest —
// `environment: 'node'`, no jsdom, no @testing-library, so no DOM, no effects and no event handlers. It
// drives the already-shipped stack (decode #884, bridge #900, batch store #899, picks store #911, panel
// #906/#907) through fake daemon → Noise wire → decode → IPC → renderer, pushing `question_shown` with the
// `daemon.pushFrame` server-push hook the way permission-modal-answer-paths.spec.ts pushes `modal_shown`.
//
// ONE test(), ONE launch, THREE ARCS, and the split is by SEMANTICS rather than convenience. A dismissal
// clears that batch's picks (questionPicksStore's `dismissed` arm), so the arcs are sequenced such that the
// clear only ever lands between them. Arc 1 is the single-select variant plus the chat switch; arc 2 is the
// multi-select variant plus the composer-draft survival #906 left unproven; arc 3 (#915/#916) is the first
// batch carrying MORE THAN ONE question — the header tabs, the jump, the STEP over that same index, and
// the picks surviving both in both directions. The action row's THREE-button state is not here and cannot
// be: a two-question batch has no question with both a previous and a next, so QuestionPanel.test.tsx owns
// that one by static render. BOTH variants are driven because
// neither proves the other: `optionPicked`/`optionToggled` carry identical payloads and differ only in the
// `type` literal, so a transposed arm compiles clean and shows up ONLY as replace-instead-of-accumulate.
//
// EVERY CLICK IS ON A ROW, NEVER ON THE CONTROL ITSELF. The native input is visually hidden (the design's
// own 20x20 chrome does the drawing), so it is not a pointer target — its wrapping <label> is, which is
// also the real operator gesture. State is then read back through `toBeChecked()` on that input AND through
// the drawn selector child's count, so neither stands in for the other: a store write that never reached
// the render, or a render that drew a state the store does not hold, fails one of the pair.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM values / roles / counts
// only. The batch nonces below are spec-local routing literals, never asserted on and never logged; the
// question/option strings are non-secret display text, and the Other text is typed into a field that never
// sends (this family has no answer frame at all — #853 is where sending lands). The pairing plumbing lives
// in launchPairedApp and is never echoed.

// The push → decode → IPC → render hop is fast in-process, so a short headroom over Playwright's 5s default
// suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushed frames by envelope id, so one fixed id is reused across every push.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// conversationStateFake's own default seed id — the conversation launchPairedApp lands in, and the one both
// batches are raised against. A batch is display-scoped by conversation, so this is what puts the panel in
// front of the operator at launch.
const CONVERSATION_ID = 'seed-conversation'
const SEEDED_TITLE = 'Seeded channel'
// The bare `conversationStateFake()` default seed's own `cwd` — the workspace the second conversation is
// minted into below. Restated here rather than imported: this spec takes the fake bare, and the seed is
// the fixture's business, so a literal is the narrower coupling of the two.
const SEEDED_CWD = '/fake/workspace'

// Three nonces, one per arc. Distinct so each later batch is genuinely a FRESH batch for the SAME
// conversation — which is the half of AC4 that a re-render of the first batch could never prove.
const BATCH_SINGLE = 'question-batch-single'
const BATCH_MULTI = 'question-batch-multi'
const BATCH_TABS = 'question-batch-tabs'

// MUTUALLY NON-SUBSTRING LABELS, and none of them appears in any description. Playwright matches an
// accessible name by case-insensitive SUBSTRING, and an implicit <label> gives each row the name
// "<label> <description>", so a label contained in another row's text would silently match two controls.
const OPTIONS: WireQuestionOption[] = [
  { label: 'Rust', description: 'systems' },
  { label: 'Elixir', description: 'concurrent' },
  { label: 'Haskell', description: 'pure' }
]

// #915's second question, distinguishable from the first in every observable at once — its header names its
// tab, its text is what the box must swap to, and its options are how a jump is told from a re-render of the
// question already showing. Non-substring of each other and of every label above, for the same accessible-
// name reason. The headers are also matched as BUTTON names, so neither may be a substring of Cancel or
// Continue.
const LANGUAGE_HEADER = 'Language'
const EDITOR_HEADER = 'Editor'
const EDITOR_QUESTION = 'And which editor should you drive it in?'
const EDITOR_OPTIONS: WireQuestionOption[] = [
  { label: 'Helix', description: 'modal' },
  { label: 'Zed', description: 'collaborative' }
]

// The panel's client-owned copy, re-declared spec-local rather than imported from QuestionPanel.tsx (the
// REJECTION_COPY precedent): e2e is outside every tsconfig and importing a .tsx module would drag React
// through Playwright's transform for two string literals.
const OTHER_PLACEHOLDER = 'Other. Type something.'
const OTHER_TICK = 'Other'
// #916's action-row copy, spec-local for the same reason. Matched as BUTTON NAMES, which Playwright does
// by case-insensitive substring — so none of them may contain another, nor either question header above.
const PREVIOUS_COPY = 'Previous'
const NEXT_COPY = 'Next'
const CONTINUE_COPY = 'Continue'

// Non-secret display literals, distinct from each other so a failure diagnostic names WHICH box held what.
const OTHER_TEXT = 'Zig, if that counts'
const EDITOR_OTHER_TEXT = 'Acme, on a good day'
const DRAFT = 'a half-typed message the panel must not eat'

/** One question, spread-overridden per arc (#915 widened this from a lone `multiSelect` flag, since the tab
 *  arc needs two questions that are told apart by their header, their text AND their options).
 *  `multi_select` is the wire's snake_case spelling — the one renamed field in this family. */
function wireQuestion(over: Partial<WireQuestion> = {}): WireQuestion {
  return {
    question: 'Which of these three programming languages should you learn next?',
    header: LANGUAGE_HEADER,
    options: OPTIONS,
    multi_select: false,
    ...over
  }
}

/** A `question_shown` batch, surfaced via daemon.pushFrame. All three payload fields always present. The
 *  batch is the whole list (#915): re-pushing the SAME id with a different list replaces it in place. */
function questionShownFrame(questionBatchId: string, questions: WireQuestion[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'question_shown',
    ts: FIXED_TS,
    payload: {
      conversation_id: CONVERSATION_ID,
      question_batch_id: questionBatchId,
      questions
    } satisfies QuestionShownPayload
  })
}

/** The daemon retiring a batch — the ONLY way one leaves the held set (this family has no answer frame, so
 *  there is no local dismissal to race). `outcome`/`source` carry the producer's one landed pair; neither is
 *  consulted by either store, which clears on any dismissal regardless of cause. */
function questionDismissedFrame(questionBatchId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'question_dismissed',
    ts: FIXED_TS,
    payload: {
      question_batch_id: questionBatchId,
      outcome: 'unanswered',
      source: 'no_answer'
    } satisfies QuestionDismissedPayload
  })
}

test('question panel: picks are live in both variants, survive a chat switch and a jump or a step between the batch’s questions, and leave the draft alone', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: conversationStateFake() })

  const panel = page.locator('.question-panel')
  const thread = page.locator('.conversation')
  // The two drawn treatments (the design's Selector child): a filled dot for the radio variant, the tick
  // glyph for the checkbox one. Counting them is the render-side half of every state assertion below.
  const dots = page.locator('.question-panel__control-dot')
  const ticks = page.locator('.question-panel__control-tick')
  const composer = page.getByPlaceholder('Message…')
  const otherField = page.getByRole('textbox', { name: OTHER_PLACEHOLDER })
  // Read state off the real control; click the ROW, which is the label that drives it.
  const control = (role: 'radio' | 'checkbox', name: string) => page.getByRole(role, { name })
  const optionRow = (label: string) =>
    page.locator('.question-panel__option').filter({ hasText: label })
  const otherRow = page.locator('.question-panel__other-control')
  // #915. `.question-panel__label` matches a class TOKEN, so it never matches the row's own
  // `question-panel__labels` — the count is tabs, exactly. A tab is addressed by ROLE, which is what keeps
  // the option rows (implicit <label>s, not buttons) out of the match.
  const labels = page.locator('.question-panel__label')
  const tab = (header: string) => page.getByRole('button', { name: header })
  // #916. Scoped to the PANEL rather than the page: these carry client-owned copy in the app's own voice,
  // and a page-wide role match is one shipped "Next" anywhere else in the shell away from matching two
  // controls at once. The trailing button is addressed by CLASS, not by name, because its name is the
  // thing under test — it reads Next on every question but the last.
  const stepBack = panel.getByRole('button', { name: PREVIOUS_COPY })
  const stepForward = panel.getByRole('button', { name: NEXT_COPY })
  const trailing = panel.locator('.question-panel__continue')

  // ============ Arc 1 — the single-select variant and the chat switch ============
  daemon.pushFrame(questionShownFrame(BATCH_SINGLE, [wireQuestion()]))
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // #915 AC4 — one question is one bare label and NO jump affordance: with nowhere to jump, a focusable
  // control that re-selects what is already on screen is not "unchanged from today".
  await expect(labels).toHaveCount(1)
  await expect(page.locator('.question-panel__labels button')).toHaveCount(0)

  // AC4 — nothing is selected on a batch's first render, whatever the Figma mock draws pre-selected. Both
  // halves: no drawn selector anywhere, and no control reporting itself checked.
  await expect(dots).toHaveCount(0)
  await expect(control('radio', 'Rust')).not.toBeChecked()
  await expect(control('radio', OTHER_TICK)).not.toBeChecked()

  // AC1, replace — picking a radio row selects it AND clears that question's previous pick. The dot count
  // staying at 1 after the second pick is the whole assertion: an `optionToggled` sent here (the invisible
  // transposition) would leave two.
  await optionRow('Rust').click()
  await expect(control('radio', 'Rust')).toBeChecked()
  await expect(dots).toHaveCount(1)
  await optionRow('Elixir').click()
  await expect(control('radio', 'Elixir')).toBeChecked()
  await expect(control('radio', 'Rust')).not.toBeChecked()
  await expect(dots).toHaveCount(1)

  // AC2 — the Other field holds what is typed. `toHaveValue` pins that the box really holds it, so what
  // survives the switch below is a transition this drive caused rather than an assertion against a box that
  // was never filled (the siblings' non-vacuity anchor). #1698 — typing ticks Other, as on mobile, and in
  // this radio group that REPLACES the Elixir pick; the dot count stays at 1 because the dot moved.
  await otherField.fill(OTHER_TEXT)
  await expect(otherField).toHaveValue(OTHER_TEXT)
  await expect(control('radio', OTHER_TICK)).toBeChecked()
  await expect(control('radio', 'Elixir')).not.toBeChecked()
  await expect(dots).toHaveCount(1)
  // Picking Elixir again un-ticks Other and leaves its text in the box: the text is held apart from the tick.
  await optionRow('Elixir').click()
  await expect(control('radio', 'Elixir')).toBeChecked()
  await expect(control('radio', OTHER_TICK)).not.toBeChecked()
  await expect(otherField).toHaveValue(OTHER_TEXT)

  // AC3, away — Add workspace mints a second conversation and navigates to it WITHOUT leaving the thread route,
  // which remounts the whole conversation subtree (#670's keying). The batch is display-scoped, so the other
  // chat shows its own ordinary composer meanwhile and no panel at all.
  await mintChatInWorkspace(page, SEEDED_CWD)
  await expect(panel).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue('')
  // The pane never emptied on the way: the switch happened THROUGH the thread route, not via the list.
  await expect(thread).toHaveCount(1)

  // AC3, back — the part-made picks are all still there. This is the criterion the picks store exists for:
  // the same drive against panel-local `useState` finds an empty panel here, because the remount destroyed
  // it. Both the option pick and the typed text, since they are two different fields of one selection.
  await page
    .locator('.channel-list__row')
    .filter({ hasText: SEEDED_TITLE })
    .locator('.channel-list__row-open')
    .click()
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(control('radio', 'Elixir')).toBeChecked()
  await expect(dots).toHaveCount(1)
  await expect(otherField).toHaveValue(OTHER_TEXT)

  daemon.pushFrame(questionDismissedFrame(BATCH_SINGLE))
  await expect(panel).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // ============ Arc 2 — the multi-select variant and the composer draft ============

  // AC5, first half — a draft typed into the message box BEFORE the batch arrives. #906 proved statically
  // that the covered composer subtree stays mounted; this is the consequence an operator actually feels, and
  // it has never been driven because nothing in this repo can click.
  await composer.fill(DRAFT)
  await expect(composer).toHaveValue(DRAFT)

  daemon.pushFrame(questionShownFrame(BATCH_MULTI, [wireQuestion({ multi_select: true })]))
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // AC4, second half — a FRESH batch for the SAME conversation opens with every row clear. The picks are
  // keyed on the batch's own one-time nonce, so the retired batch's selection is unreachable here even
  // before its `dismissed` cleared it.
  await expect(ticks).toHaveCount(0)
  await expect(control('checkbox', 'Rust')).not.toBeChecked()
  await expect(otherField).toHaveValue('')

  // AC1, accumulate — ticking checkbox rows adds, and un-ticking one leaves the others. This is the half
  // arc 1 structurally cannot give: had the container sent `optionPicked` here, the second tick would have
  // replaced the first and this count would read 1.
  await optionRow('Rust').click()
  await optionRow('Haskell').click()
  await expect(control('checkbox', 'Rust')).toBeChecked()
  await expect(control('checkbox', 'Haskell')).toBeChecked()
  await expect(ticks).toHaveCount(2)
  await optionRow('Rust').click()
  await expect(control('checkbox', 'Rust')).not.toBeChecked()
  await expect(control('checkbox', 'Haskell')).toBeChecked()
  await expect(ticks).toHaveCount(1)

  // AC2, second half — typed Other text becomes the answer value itself, so in this variant the Other row
  // sits ticked BESIDE ticked option labels rather than replacing them (the opposite of arc 1's radio
  // semantics, and the second place a transposed arm would show). #1698 — the typing alone ticks it.
  await otherField.fill(OTHER_TEXT)
  await expect(control('checkbox', OTHER_TICK)).toBeChecked()
  await expect(control('checkbox', 'Haskell')).toBeChecked()
  await expect(ticks).toHaveCount(2)
  await expect(otherField).toHaveValue(OTHER_TEXT)
  // Un-ticking Other keeps both its text and the ticked option.
  await otherRow.click()
  await expect(control('checkbox', OTHER_TICK)).not.toBeChecked()
  await expect(control('checkbox', 'Haskell')).toBeChecked()
  await expect(ticks).toHaveCount(1)
  await expect(otherField).toHaveValue(OTHER_TEXT)

  // AC5, second half — the batch goes and the draft is still in the box, untouched by everything above.
  daemon.pushFrame(questionDismissedFrame(BATCH_MULTI))
  await expect(panel).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue(DRAFT)

  // ============ Arc 3 (#915) — the header tabs, and jumping between two questions ============
  // Two questions differing in EVERY observable — header, text, options, variant — because a jump that
  // silently re-rendered the question already showing would pass a weaker fixture.
  daemon.pushFrame(
    questionShownFrame(BATCH_TABS, [
      wireQuestion(),
      wireQuestion({
        header: EDITOR_HEADER,
        question: EDITOR_QUESTION,
        options: EDITOR_OPTIONS,
        multi_select: true
      })
    ])
  )
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // AC1/AC2 — a tab per question, in the batch's order, exactly one of them active. Both halves of the
  // active treatment are read: aria-current (the non-visual one, since the design's two states differ in
  // colour alone) and the inactive modifier class (the drawn one).
  await expect(labels).toHaveCount(2)
  await expect(tab(LANGUAGE_HEADER)).toBeVisible()
  await expect(tab(EDITOR_HEADER)).toBeVisible()
  await expect(panel.locator('[aria-current="true"]')).toHaveCount(1)
  await expect(panel.locator('.question-panel__label--inactive')).toHaveCount(1)
  await expect(tab(LANGUAGE_HEADER)).toHaveAttribute('aria-current', 'true')

  // Part-answer the first question: an option pick and typed Other text, the two fields AC5 must carry.
  // Typed FIRST, since typing ticks Other and would replace a radio pick made before it (#1698).
  await otherField.fill(OTHER_TEXT)
  await expect(otherField).toHaveValue(OTHER_TEXT)
  await optionRow('Rust').click()
  await expect(control('radio', 'Rust')).toBeChecked()

  // AC3 — the jump. The second question's own text, its own options and its own MULTI-select row style all
  // arrive together; the first question's rows are gone rather than merely unchecked. Its Other field opens
  // empty, which is the picks being keyed per question rather than per batch.
  await tab(EDITOR_HEADER).click()
  await expect(panel).toContainText(EDITOR_QUESTION)
  await expect(control('radio', 'Rust')).toHaveCount(0)
  await expect(control('checkbox', 'Helix')).not.toBeChecked()
  await expect(dots).toHaveCount(0)
  await expect(ticks).toHaveCount(0)
  await expect(otherField).toHaveValue('')
  await expect(tab(EDITOR_HEADER)).toHaveAttribute('aria-current', 'true')

  // Part-answer the second question too, in its own variant's semantics: two ticked options ALONGSIDE a
  // ticked Other row, which is what the single-select arc structurally cannot hold.
  await optionRow('Helix').click()
  await optionRow('Zed').click()
  await otherField.fill(EDITOR_OTHER_TEXT)
  await expect(ticks).toHaveCount(3)

  // AC5, backwards — every field of the first question's selection is exactly as it was left. This is the
  // criterion the whole slice turns on: the same drive against a panel that rebuilt its picks on a jump
  // finds an empty question here.
  await tab(LANGUAGE_HEADER).click()
  await expect(panel).not.toContainText(EDITOR_QUESTION)
  await expect(control('radio', 'Rust')).toBeChecked()
  await expect(dots).toHaveCount(1)
  await expect(otherField).toHaveValue(OTHER_TEXT)
  await expect(control('radio', OTHER_TICK)).not.toBeChecked()

  // AC5, forwards again — and the second question's three ticks and its own Other text are equally intact,
  // so neither direction is standing in for the other.
  await tab(EDITOR_HEADER).click()
  await expect(control('checkbox', 'Helix')).toBeChecked()
  await expect(control('checkbox', 'Zed')).toBeChecked()
  await expect(control('checkbox', OTHER_TICK)).toBeChecked()
  await expect(ticks).toHaveCount(3)
  await expect(otherField).toHaveValue(EDITOR_OTHER_TEXT)

  // ---- #916 — stepping the same index with Previous and Next ----
  // Standing on the LAST question, which is the only place the trailing button's copy flips. Read as a
  // pair: Continue is showing AND no Next is reachable, so a row that drew both would fail here.
  // NOTE the row's third state — Cancel, Previous and a trailing Next all at once — is unreachable from
  // this arc by construction: a two-question batch has no question with both a previous and a next. It is
  // proven by static render in QuestionPanel.test.tsx instead.
  await expect(stepBack).toBeVisible()
  await expect(trailing).toHaveText(CONTINUE_COPY)
  await expect(stepForward).toHaveCount(0)

  // AC2 — Previous draws the question BEFORE this one and moves the active tab to it. The picks read back
  // here are the same ones the tab click asserted above, which is the point: stepping and jumping must be
  // one gesture as far as the store is concerned, not two paths that can drift.
  await stepBack.click()
  await expect(panel).not.toContainText(EDITOR_QUESTION)
  await expect(tab(LANGUAGE_HEADER)).toHaveAttribute('aria-current', 'true')
  await expect(control('radio', 'Rust')).toBeChecked()
  await expect(dots).toHaveCount(1)
  await expect(otherField).toHaveValue(OTHER_TEXT)

  // AC1's second sentence and AC3's first — on the FIRST question there is no Previous at all (absent, not
  // disabled), and the trailing button reads Next rather than Continue.
  await expect(stepBack).toHaveCount(0)
  await expect(trailing).toHaveText(NEXT_COPY)

  // AC3 — Next draws the FOLLOWING question and moves the tab; AC4 — the second question's three ticks and
  // its own Other text come back intact, so a step in each direction has now preserved its own side.
  await stepForward.click()
  await expect(panel).toContainText(EDITOR_QUESTION)
  await expect(tab(EDITOR_HEADER)).toHaveAttribute('aria-current', 'true')
  await expect(control('checkbox', 'Helix')).toBeChecked()
  await expect(ticks).toHaveCount(3)
  await expect(otherField).toHaveValue(EDITOR_OTHER_TEXT)

  // THE CLAMP, and this is its only reachable proof: a static render never leaves the seeded index. A
  // SAME-NONCE re-delivery replaces the held batch in place, so the panel does not remount — and here it
  // arrives carrying fewer questions than the operator has jumped past. Unclamped, the slot reads
  // `questions[1]` of a one-element list and throws out of the render, taking the window's tree with it.
  daemon.pushFrame(questionShownFrame(BATCH_TABS, [wireQuestion()]))
  await expect(labels).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(panel).toBeVisible()
  await expect(panel).not.toContainText(EDITOR_QUESTION)
  // Back to a one-question row: a bare label again, with no jump affordance to offer.
  await expect(page.locator('.question-panel__labels button')).toHaveCount(0)
  // Still holding the first question's picks under the same nonce — so the panel is genuinely alive here,
  // not merely present.
  await expect(control('radio', 'Rust')).toBeChecked()
  await expect(otherField).toHaveValue(OTHER_TEXT)
  // #916 — one question is the first AND the last, so the action row is back to the two buttons #906
  // shipped. The clamp lands the operator here from index 1, which is the one path that reaches this row
  // WITHOUT the panel remounting: a stale Next surviving the shrink would show up right here.
  await expect(stepBack).toHaveCount(0)
  await expect(stepForward).toHaveCount(0)
  await expect(trailing).toHaveText(CONTINUE_COPY)
})
