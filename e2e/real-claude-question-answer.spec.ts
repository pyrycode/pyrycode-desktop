import { type Page } from '@playwright/test'
import type { DaemonEvent } from '../src/shared/ipc/events'
import type { WireModelOption } from '../src/shared/wire/types'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// Tier-3 real-claude e2e (#928) — the question vertical proven by a RUN rather than by fakes. Everything
// upstream of this is fake-transport only: e2e/question-answer-continue.spec.ts (#922) drives the whole
// Continue path, but against a scripted `daemon.pushFrame` and an in-process capture of the outbound frame.
// No question answer had ever been measured reaching a real claude from this app, and two failure modes are
// invisible to that tier:
//   - The per-device remote-permission opt-in (pyrycode#702) DEFAULTS TO DENY, and questionResolverV2's
//     ResolveAnswer gates on it before consuming anything. A denial is audited `denied_unauthorized` and
//     leaves the batch OUTSTANDING — deliberately, so a legitimate device can still answer it.
//   - A rejected answer is SILENT BY DESIGN: no reply, no error envelope, no `question_dismissed`. So a
//     payload shape the fake daemon happily accepts can be dropped by the real one with nothing observable
//     but claude not moving.
// From the window those two are indistinguishable from a send that never left: the panel clears
// (optimistically, by design), claude stays blocked, and no frame comes back.
//
// It clones real-claude-permission-modal.spec.ts's structure (#432) — same precondition, same fixture trio,
// same DOM-only assertion posture — and swaps the turn body. The daemon side already drove this same round
// trip from the other end and it LANDED: pyrycode#1987,
// internal/e2e/realclaude/interactive_stream_question_answer_test.go, merged 2026-09-02. Every constraint
// below is transcribed from that file rather than rediscovered one live run at a time.
//
// WHY THIS ONE ASSERTS REPLY CONTENT, AGAINST #432'S CLOSING INSTRUCTION. #432 ends with "do NOT try to
// strengthen it into a causation proof by asserting reply content" and can afford to, because a
// permission-gated Write leaves a FILE ON DISK — the tool effect is its proof. This slice has no such
// effect: the trigger forbids claude from writing code or using any other tool, and what must be shown is
// that the ANSWERS MAP reached claude, which is observable only in what claude says next. Following #432's
// rule here yields a spec that is green and proves nothing. `expectNamesChoiceFirst` is what keeps the
// content assertion from being vacuous.
//
// REAL-CLAUDE DIVERGENCES from the fake twin #922:
//   - NO `daemon.pushFrame`: the batch is raised by a real claude actually calling AskUserQuestion, parked
//     by the real daemon's approve path and broadcast as a real `question_shown`.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so #922's
//     in-process `question_answer` capture is unavailable. Every assertion reads DOM text / counts only.
//   - The questions, headers and option labels are all CLAUDE-SUPPLIED, so none of them can be spelled into
//     this file. Everything is located by STRUCTURE, never by copy.
//   - The panel CLEARING is not the proof and is not asserted as one — it clears optimistically, before any
//     daemon frame answers. The continuation is the proof.
//
// It inherits the real-claude harness for free: `spawnClaude` defaults true and the full skip-gate resolves
// `pyry` + `claude` + a credential BEFORE any resource, calling testInfo.skip on any miss (AC4). The
// `real-` filename prefix does the tier routing — playwright.config.ts's `testIgnore` and
// playwright.real-claude.config.ts's matching `testMatch` — so it runs under `npm run e2e:real-claude`, is
// excluded from the default `npm run e2e`, and its all-skip turns into a non-zero exit under
// `npm run e2e:real:gate`.
//
// That routing needed one fix to actually be filename-based, and the live gate is what found it: both
// patterns were unanchored (`/real-.*\.spec\.ts$/`) and Playwright matches them against the ABSOLUTE path,
// so `.*` spanned `/` and every spec in the tree matched whenever an ancestor DIRECTORY was named `real-…`.
// The dispatcher checks this branch out into a worktree named `real-claude-gate-<N>`, so the first live run
// of this spec collected all 66 specs under the real-claude config instead of 10 — and the default tier
// would have ignored all 66 and exited 0 on a suite that never ran. Both patterns are now anchored to a
// path boundary and kept inside one segment; see the note in playwright.config.ts.
//
// SECRET HYGIENE (security-sensitive label). Every assertion reads DOM text / visibility / counts only. The
// `answer_token` is minted MAIN-side by daemonConnection.answerQuestions and never reaches the renderer;
// over the real stack there is no in-process frame capture at all, so it cannot enter a spec array, a
// `toEqual` diff or a failure diagnostic. The pairing payload is built the real-claude.spec.ts way and
// never echoed into a message or an error. Claude-authored text that a failure message must print (the
// chosen label, the continuation) goes through `bounded` — truncated and JSON-quoted — because nothing on
// this path strips terminal escapes and the pipeline salvages run logs. Trace / screenshot / video stay
// disabled (playwright.real-claude.config.ts already disables all three), which matters more here than on
// any sibling: a screenshot of this surface would capture claude-authored question text.

// The fixture overrides that make a real batch surface — and be answerable by — this desktop client. The
// first three are #432's trio, load-bearing here for reasons partly distinct from its own:
//   - skipPermissions:false drops `--dangerously-skip-permissions`. For #432 that makes a tool call block
//     on a permission; here it is what parks the AskUserQuestion call on the approve path AT ALL. With the
//     flag present the call auto-runs and no question is ever broadcast. The daemon's own harness omits the
//     flag with a comment calling it the single line that matters.
//   - interactiveRunner:'stream-json' is production's runner and the only one that surfaces an answerable
//     prompt; the PTY path screen-scraped and misclassified it (desktop#483).
//   - allowRemotePermissions:true pairs the device WITH the pyrycode#702 grant. Without it the panel would
//     render and the answer would be denied — silently, leaving the batch outstanding.
//   - claudeModel (#928's single-consumer fixture option) replaces the harness's hardcoded 'haiku'. See
//     QUESTION_MODEL.
const QUESTION_MODEL = 'claude-sonnet-5'
test.use({
  skipPermissions: false,
  interactiveRunner: 'stream-json',
  allowRemotePermissions: true,
  // The ONLY model under which a live AskUserQuestion call has been measured in either tree. The daemon
  // side runs both its question gates under it deliberately and records why: tool-selection reliability is
  // worth more than the token delta, because a model that will not reach for the tool DEADLINES the
  // surface wait below with no useful message instead of failing usefully.
  claudeModel: QUESTION_MODEL,
  // #933 — this spec is unrunnable against a daemon that predates pyrycode#2020: without the
  // `question` capability the daemon never broadcasts a batch, and the surface wait below deadlines.
  // Declaring it makes that a SKIP naming the stale daemon, which parks the gate run in Inbox for the
  // operator to rebuild `pyry` — rather than a failure routed back to a builder who cannot. This is
  // the first and (today) only consumer of the option; every other real-* spec declares nothing and
  // is gated on the `pyry` binary alone, exactly as before.
  requiredCapabilities: ['question']
})

// --- Selectors (verbatim from real-claude.spec.ts) ---------------------------
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// The streaming cursor ▎ (U+258E) is a child <span> INSIDE the assistant bubble, so a row's textContent
// includes it even while the reply text is still empty. Strip it before reading.
const CURSOR_CHAR = '▎'
// turn_end appends a turnBoundary that drops the cursor — its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'
// #1014 filled the meta row's timestamp slot, and `.bubble__meta` is a child of the bubble, so a row's
// textContent now ends in `13.01.2026 - 13:55` whatever the reply says. Strip that subtree before reading
// too: an unstripped read here would also break `continuationOf`'s prefix invariant, since the stamp
// trails EACH row's text and an in-place continuation therefore no longer starts with what came before.
// Structural rather than digit-shape matching: it survives whatever the row grows next. Kept verbatim
// across the four real-claude specs that read a bubble's text — `rg META_SELECTOR e2e/` finds them all.
const META_SELECTOR = '.bubble__meta'

// --- The panel surface, fake-tier-proven by #922 -----------------------------
// Located by STRUCTURE only. `__option-label` is the <p> the panel renders for an offered option, drawn
// SEPARATELY from `__option-description`: comparing against whole option rows would let description prose
// corrupt the ordering check below. It is also what tells a real option row from the trailing Other row,
// which is a `.question-panel__option` carrying no `__option-label` child.
const PANEL = '.question-panel'
const OPTION_LABEL = '.question-panel__option-label'
const TRAILING = '.question-panel__continue'
const TAB = '.question-panel__labels button'
// The panel's client-owned copy, re-declared spec-local rather than imported from QuestionPanel.tsx (the
// #922 precedent): e2e is outside every tsconfig and importing a .tsx module would drag React through
// Playwright's transform for two string literals.
const CONTINUE_COPY = 'Continue'
const NEXT_COPY = 'Next'

// --- Timeouts ----------------------------------------------------------------
// Generous to absorb real daemon startup latency plus a handshake re-dial or two; Send-enabled is the
// readiness signal (verbatim from real-claude.spec.ts).
const HANDSHAKE_TIMEOUT_MS = 45_000
// The wait for a real clarifying-question batch to surface: cold claude (spawn + model load) reaching the
// AskUserQuestion call, `pyry mcp-approve` parking it, questionbridge.Parse accepting it and the daemon
// broadcasting question_shown. This is the daemon-side twin's `questionSurfaceBudget`, and it is
// deliberately wider than #432's 120s MODAL_TIMEOUT_MS because this gate runs a LARGER model than the modal
// gates do — that spec's constant is the analogue to widen, not to copy.
const QUESTION_SURFACE_TIMEOUT_MS = 180_000
// The post-answer continuation turn.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + the surface wait + the continuation turn + headroom.
const SPEC_TIMEOUT_MS = 480_000

// --- Bounded, quoted printing of claude-authored bytes -----------------------
// A label's length is claude's to decide and a run log this pipeline salvages is not the place to find out
// how long it can get. The continuation gets a wider cap — a failure message that cut the reply to a few
// words would not show what claude actually said — and is still bounded. JSON.stringify is the quoting:
// it escapes control characters, so a terminal escape sequence in claude-authored text cannot reach a
// terminal as one.
const LABEL_LOG_CAP = 256
const TEXT_LOG_CAP = 2048
function bounded(text: string, cap: number): string {
  return JSON.stringify(text.length > cap ? `${text.slice(0, cap)}…` : text)
}

/**
 * The trigger, transcribed from the daemon-side twin's `questionAnswerTrigger`. Every constraint in it is
 * load-bearing rather than stylistic:
 *   - IT NAMES THE TOOL. Legitimate: this slice measures the round trip, not claude's spontaneous
 *     propensity to reach for the tool.
 *   - IT ASKS FOR A SINGLE CHOICE, which is what makes claude emit the multiSelect key at all.
 *     questionbridge.Parse REJECTS a question whose key is absent, and a rejected batch falls through to a
 *     permission modal this spec never answers, so the turn would park until the approval window elapsed.
 *   - IT ASKS FOR FOUR OPTIONS, widening the space a guessing continuation would have to hit. Both 2 and 4
 *     sit inside Parse's 2-4 bound.
 *   - IT CARRIES NO PATH, NO FILENAME AND NO "in this repo", so a claude-authored question cannot quote the
 *     harness temp workdir — under /var/folders/ on macOS — into a salvaged run log.
 *   - IT NAMES NO OPTION AND NO PREFERENCE, so the answer is unpredictable from the prompt. That is the
 *     property `expectNamesChoiceFirst` rests on.
 *   - IT INSTRUCTS THE REPLY, which is what makes the continuation observable at all, and cannot leak the
 *     choice because the labels do not exist until claude writes them.
 * The nonce keeps the trigger distinct per run (defeats accidental caching) and is NEVER asserted on.
 */
function questionAnswerTrigger(nonce: number): string {
  return (
    'Before writing anything, use the AskUserQuestion tool to ask me one clarifying question: for an ' +
    'in-memory key-value cache, which eviction policy should it use? Give the question a short header, ' +
    'offer four policies as options with a one-line description each, and allow only a single choice. ' +
    'After I answer, reply with only the exact label of the option I chose and nothing else — do not ' +
    `write code and do not use any other tool. run=${nonce}`
  )
}

/**
 * The concatenated text of every assistant row, with the streaming cursor and the meta row stripped.
 * Generalises real-claude.spec.ts's `nonEmptyAssistantCount` from the count to the text it already
 * computes: both the cursor span and #1014's timestamp live INSIDE the row, so an unstripped read would
 * report a still-empty streaming bubble as having content. The strip runs on a detached copy, so the live
 * DOM this spec's panel assertions read is untouched.
 */
function assistantText(page: Page): Promise<string> {
  return page
    .locator(ASSISTANT_ROW)
    .evaluateAll(
      (els, { cursor, meta }) =>
        els
          .map((el) => {
            const content = document.createElement('div')
            content.append(el.cloneNode(true))
            content.querySelectorAll(meta).forEach((node) => node.remove())
            return (content.textContent ?? '').split(cursor).join('').trim()
          })
          .join('\n'),
      { cursor: CURSOR_CHAR, meta: META_SELECTOR }
    )
}

/**
 * What arrived AFTER the answer: `after` minus its `before` prefix. The pre-answer text is stable while the
 * turn is parked on the tool call, so the suffix is exactly the continuation — and this is agnostic to
 * whether it lands as a new assistant row or appends to the pre-question one, which is unmeasured.
 *
 * If the prefix invariant ever fails the whole text is used instead. That fallback is CONSERVATIVE by
 * construction: extra leading text can only add earlier positions for an unchosen label, so it can redden
 * the ordering check below and never green it.
 */
function continuationOf(before: string, after: string): string {
  return after.startsWith(before) ? after.slice(before.length) : after
}

/**
 * THE ASSERTION THE WHOLE SLICE EXISTS FOR: the continuation must name the option this spec chose, and name
 * it FIRST among that question's offered labels.
 *
 * Presence alone would not do. A claude that never read the answers map can still restate its own question
 * — it authored those labels — and a restatement lists them in OFFER ORDER, where the drive below
 * deliberately chose the LAST. So "first offered label mentioned" is what separates "claude read the
 * answers" from "claude repeated its own batch": a compliant reply naming only the label passes, "you chose
 * <last> rather than <first>" passes, and "the options were <first>, <second>, …" fails.
 *
 * Case-insensitive substring matching on both halves: claude's casing is its own, and the label may sit
 * inside a sentence. A sibling label equal to the chosen one is SKIPPED — two options can spell the same
 * label and are then indistinguishable in text, and nothing in claude's contract forbids it.
 */
function expectNamesChoiceFirst(continuation: string, chosen: string, unchosen: string[]): void {
  const haystack = continuation.toLowerCase()
  const chosenAt = haystack.indexOf(chosen.toLowerCase())
  expect(
    chosenAt,
    `the continuation never names the chosen option ${bounded(chosen, LABEL_LOG_CAP)} — claude proceeded ` +
      'but the answers map did not reach it (or reached it in a shape it does not read, which is silent ' +
      `because the call is allowed either way)\ncontinuation: ${bounded(continuation, TEXT_LOG_CAP)}`
  ).toBeGreaterThanOrEqual(0)
  for (const other of unchosen) {
    if (other.toLowerCase() === chosen.toLowerCase()) continue
    const at = haystack.indexOf(other.toLowerCase())
    expect(
      at < 0 || at > chosenAt,
      `the continuation names the unchosen option ${bounded(other, LABEL_LOG_CAP)} before the chosen ` +
        `${bounded(chosen, LABEL_LOG_CAP)} — that is what a claude restating its own batch looks like, ` +
        `not one reporting what it was told\ncontinuation: ${bounded(continuation, TEXT_LOG_CAP)}`
    ).toBe(true)
  }
}

type ModelEvidence = {
  models: readonly WireModelOption[]
  announced: string[]
  conversationId: string
  batchId: string
  dismissed: boolean
  accepted: number
  rejected: number
  stop: () => void
}
type EvidenceWindow = Window & {
  pyry: { onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void }
  questionModelEvidence: ModelEvidence
}

test('real claude changes model during a question and resumes with the original answer', async ({
  relay,
  daemon,
  page
}, testInfo) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so reruns differ, never asserted on (Date.now() is fine in a spec).
  const message = questionAnswerTrigger(Date.now())

  // --- Precondition: pair against the real daemon, dial the test relay's /v1/client leg. ---
  // Verbatim from real-claude.spec.ts: the app dials `${relay.url}/v1/client` unchanged (NOT pyry's emitted
  // prod relay); the loopback affordance (#97) accepts the ws://127.0.0.1 relay.
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  const panel = page.locator(PANEL)
  const optionLabels = panel.locator(OPTION_LABEL)
  // The ONE trailing element, located by its class rather than by either copy — that is what lets the drive
  // follow it across both of its roles (Next on every question but the last, Continue on the last).
  const trailing = panel.locator(TRAILING)
  const tabs = panel.locator(TAB)

  await pairFromUnpairedLaunch(page, payload)

  // --- Create the conversation THROUGH THE UI (#448) — the operator flow, not a pre-bound seed. ---
  // The seeded row renders only after the real daemon's `conversations` reply arrives on the connected
  // edge, so its visibility IS the connected gate; only then click the workspace row's `Create chat` plus,
  // which fires a real create at the real daemon and navigates on `conversation_created`.
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
  await confirmCreateChat(page)
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // Observe only typed public model metadata and batch identity, never tokens or answer text.
  await page.evaluate(() => {
    const w = window as unknown as EvidenceWindow
    const evidence: ModelEvidence = {
      models: [], announced: [], conversationId: '', batchId: '', dismissed: false,
      accepted: 0, rejected: 0, stop: () => {}
    }
    evidence.stop = w.pyry.onDaemonEvent((event) => {
      if (event.type === 'modelList') evidence.models = event.models
      if (event.type === 'modelAnnounced') {
        evidence.conversationId = event.conversationId
        evidence.announced.push(event.model)
      }
      if (event.type === 'questionShown') evidence.batchId = event.questionBatchId
      if (event.type === 'questionDismissed' && event.questionBatchId === evidence.batchId) evidence.dismissed = true
      if (event.type === 'sessionSettingsUpdated') evidence.accepted += 1
      if (event.type === 'sessionSettingsRejected') evidence.rejected += 1
    })
    w.questionModelEvidence = evidence
  })

  await composer.fill(message)
  await sendButton.click()

  // --- AC1, first half: a REAL batch surfaced. ---
  // This is the first tier-3 assertion. A timeout here is a GENUINE liveness signal, not a flake to soften:
  // either claude never called AskUserQuestion under this model, or questionbridge.Parse rejected the batch
  // (an absent multiSelect, or counts outside its 2-4 bound) and it fell through to a permission modal
  // nothing here answers, parking the turn until the approval window elapses.
  await expect(panel).toBeVisible({ timeout: QUESTION_SURFACE_TIMEOUT_MS })

  const originalBatch = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.batchId)
  expect(originalBatch.length > 0).toBe(true)
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as EvidenceWindow).questionModelEvidence.models.length
  ), { timeout: HANDSHAKE_TIMEOUT_MS }).toBeGreaterThan(0)
  const published = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.models)
  const previous = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.at(-1))
  expect(Boolean(previous)).toBe(true)
  // The dropdown omits Default and other agents; published indices do not address its rows.
  const visibleModels = published.filter((row) => (row.agent ?? 'claude') === 'claude' && row.value !== 'default')
  const targetIndex = visibleModels.findIndex((row) => row.value !== '' &&
    row.value !== QUESTION_MODEL && row.resolved_model !== previous && row.value.startsWith('opus'))
  expect(targetIndex, 'daemon must publish a different non-empty Opus model').toBeGreaterThanOrEqual(0)
  const target = visibleModels[targetIndex]
  const acceptedBefore = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.accepted)
  await page.locator('.composer__footer:visible').getByRole('button').click()
  const modelMenu = page.getByRole('menu', { name: 'Model', exact: true })
  await expect(modelMenu.getByRole('menuitem')).toHaveCount(visibleModels.length)
  const targetItem = modelMenu.getByRole('menuitem').nth(targetIndex)
  await expect(targetItem).toHaveText('Opus')
  await targetItem.click()
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as EvidenceWindow).questionModelEvidence.accepted
  ), { timeout: HANDSHAKE_TIMEOUT_MS }).toBeGreaterThan(acceptedBefore)
  const preserved = await page.evaluate((batch) => {
    const evidence = (window as unknown as EvidenceWindow).questionModelEvidence
    return evidence.batchId === batch && !evidence.dismissed && evidence.rejected === 0
  }, originalBatch)
  expect(preserved, 'model change must preserve the original outstanding batch').toBe(true)
  await expect(panel).toBeVisible()

  // The batch's question count, read from the tab row. ONE question draws a bare <span> and no tabs at all,
  // which is why this floors at 1. The trigger asks for one question; CLAUDE DECIDES, and the drive below
  // does not assume it got one — the trailing control only enables once EVERY question holds a value, and
  // the daemon rejects an entry count that is not exactly the parked question count before assembling
  // anything.
  const questionCount = Math.max(await tabs.count(), 1)

  // The focus question's choice, captured BEFORE anything is clicked and made from the surfaced batch —
  // never from the trigger, which names no option.
  let chosen = ''
  let unchosen: string[] = []

  for (let index = 0; index < questionCount; index += 1) {
    // The step barrier: the active tab carries aria-current="true", so this is what proves the previous
    // Next landed and the rows below belong to THIS question rather than the last one. Same React commit,
    // so tab and rows cannot disagree. Skipped for a single-question batch, which has no tabs.
    if (questionCount > 1) {
      await expect(tabs.nth(index)).toHaveAttribute('aria-current', 'true')
    }

    const labels = (await optionLabels.allTextContents()).map((label) => label.trim())
    if (index === 0) {
      // --- AC1, second half: the batch is ANSWERABLE, asserted before anything is clicked. A batch that
      //     never surfaced deadlined the wait above; one that surfaced empty fails HERE rather than letting
      //     the ordering assertion pass over nothing.
      expect(
        labels.length,
        'the focus question offers fewer than two options — there is no choice to make, and a continuation ' +
          'checked against a one-option batch would prove nothing'
      ).toBeGreaterThanOrEqual(2)
      // THE LAST OPTION IS CHOSEN, and that is the non-vacuity argument in one line: last is unpredictable
      // from the trigger and is not the position a restating claude leads with.
      chosen = labels[labels.length - 1]
      unchosen = labels.slice(0, -1)
      // An empty label would make `indexOf('')` return 0 and the ordering check vacuous. Length is claude's
      // to decide, so it is asserted rather than assumed.
      expect(chosen.length, 'the chosen option label is empty').toBeGreaterThan(0)
    } else {
      expect(
        labels.length,
        `question ${index} offers no options — nothing can be chosen for it, and an entry count short of ` +
          'the question count is rejected by the daemon before it reaches claude'
      ).toBeGreaterThan(0)
    }

    // Clicking the label <p> activates the row's implicit <label>, which forwards to the real input beside
    // it. Locating the ROW instead would also match the trailing Other row, which offers no label.
    await optionLabels.nth(labels.length - 1).click()

    if (index < questionCount - 1) {
      await expect(trailing).toHaveText(NEXT_COPY)
      await trailing.click()
    }
  }

  // --- AC2, first half: the batch is complete, so the trailing control is now Continue and available. ---
  await expect(trailing).toHaveText(CONTINUE_COPY)
  await expect(trailing).toBeEnabled()

  // The pre-answer baseline, read while the turn is still parked on the tool call and nothing is streaming.
  const before = await assistantText(page)

  await trailing.click()

  // --- AC2, the core proof: the turn RESUMED, and it resumed with the answers. ---
  // The continuation is waited for BEFORE quiesce, deliberately: a parked turn may already show no cursor,
  // so a bare quiesce check could pass instantly and read the reply before it exists. Wait for text to
  // arrive, then for the turn to finish streaming, then read.
  //
  // A timeout here means the answer never closed the loop, and A DENIED ANSWER AND A SWALLOWED SEND LOOK
  // IDENTICAL FROM THE WINDOW. Reading the daemon's audit record is what tells them apart and is the first
  // thing to check: PYRY_E2E_DAEMON_LOG=<path> tees daemon stderr for the whole run (content-free by
  // construction), where a `denied_unauthorized` names the pyrycode#702 device gate.
  await expect
    .poll(
      async () => continuationOf(before, await assistantText(page)).trim().length,
      {
        timeout: TURN_TIMEOUT_MS,
        message:
          'no continuation streamed after the answer — the turn never resumed. Either the answer was ' +
          'denied (pyrycode#702: the batch stays outstanding and the denial is silent from the window) or ' +
          'it was dropped as a shape the daemon does not read. Check the daemon audit record via ' +
          'PYRY_E2E_DAEMON_LOG.'
      }
    )
    .toBeGreaterThan(0)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- AC2, second half: claude's own reply names the chosen label first among the offered ones. The
  //     panel clearing is NOT this proof and is not asserted as one — it clears optimistically, before any
  //     daemon frame answers.
  expectNamesChoiceFirst(continuationOf(before, await assistantText(page)), chosen, unchosen)

  // model_announced comes from system/init on the ensuing user turn, not from set_model itself.
  // Only send this probe after the original answer has positively resumed Claude.
  const announcementCount = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.length)
  const beforeProbe = await assistantText(page)
  await expect(composer).toBeVisible()
  await composer.fill('Reply with OK only. Do not use tools.')
  await sendButton.click()
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as EvidenceWindow).questionModelEvidence.announced.length
  ), { timeout: TURN_TIMEOUT_MS }).toBeGreaterThan(announcementCount)
  const resolved = await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.announced.at(-1))
  expect(typeof resolved === 'string' && resolved.length > 0 && resolved !== previous).toBe(true)
  expect(resolved?.startsWith('claude-opus')).toBe(true)
  await testInfo.attach('resolved-target-model', {
    body: JSON.stringify({ requested: target.value.slice(0, 256), resolved: resolved?.slice(0, 256) }),
    contentType: 'application/json'
  })
  await expect.poll(async () => continuationOf(beforeProbe, await assistantText(page)).trim().length,
    { timeout: TURN_TIMEOUT_MS }).toBeGreaterThan(0)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  await page.evaluate(() => (window as unknown as EvidenceWindow).questionModelEvidence.stop())
})
