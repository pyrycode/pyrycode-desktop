import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// Match production: the Mac daemon runs interactive_runner: stream-json, and a real v2 daemon fans the
// STRUCTURED stream to interactive conns as the `data-thread-role="assistant"` rows this spec reads.
// real-claude-new-session.spec.ts's line verbatim.
test.use({ interactiveRunner: 'stream-json' })

// Tier-3 real-claude e2e for #1433 — the STORED-PROMPT family's first behavioural proof. The daemon
// stores the prompt (pyrycode#2149), hands it to claude at SPAWN through an appended system prompt file
// (pyrycode#2150), the write and read verbs landed as pyrycode#2151/#2152, and the Channel info sheet
// edits it (#1078). #1078 closed on a green real-claude gate, but none of the tier's specs touched the
// prompt, so that green said nothing about this vertical: nothing had yet WATCHED claude behave
// differently after a New session with a prompt saved. This is that spec.
//
// WHAT IT PROVES, in two halves, with one marker token:
//   - The daemon applies the prompt ONCE AT SPAWN and a save never reaches the RUNNING session: the reply
//     in the session that was live when the prompt was saved does not carry the marker.
//   - The first reply after New session does.
//
// THE NEGATIVE HALF IS SOUND, NOT A TIMING GUESS, and the reason is the whole design: the marker string
// NEVER ENTERS A COMPOSER MESSAGE. It exists only inside the system prompt textarea. So the session that
// was already running was never shown the instruction, and a model cannot emit a per-run nonce it has not
// seen. Putting the marker in a message — to "make the turn more likely to comply" — would destroy this
// and turn the negative assertion into a coin flip. Do not.
//
// It follows real-claude-new-session.spec.ts's flow (pair from an unpaired launch, CREATE the conversation
// through the workspace row's `Create chat` plus rather than a pre-bound seed, one turn, then the Actions
// menu's New session, then another turn) and extends it by one sheet visit, one extra turn, and the
// marker helpers below.
//
// REPLY CONTENT IS THE PROOF HERE, and this is the ONE spec in the tier where that is true. The siblings
// deliberately assert only that a reply ARRIVED (real-claude-new-session.spec.ts's header states it as a
// rule: "do NOT try to strengthen it by asserting reply content"). That posture is INVERTED here on
// purpose — a spec that only counted rows could not tell an applied prompt from an ignored one, which is
// the entire question. Recorded so the next reader files this as a decision, not as drift.
//
// WHAT IS DELIBERATELY NOT ASSERTED:
//   - `.system-prompt__session` (the running-session-differs notice). The reading is requested once per
//     ACTIVATION and not after a save, so that line does not appear without leaving and reopening the
//     conversation. Its mechanics are the fake tier's.
//   - The tri-state write (Save sends a string, Clear sends null) and the 8192-byte gate. Those are
//     e2e/channel-system-prompt.spec.ts's, which this ticket leaves untouched.
//   - Which PROCESS produced the third reply. DOM-only over the real wire cannot show that — the
//     sibling's accepted limitation. The marker is a strictly stronger signal than the sibling had,
//     though: only a freshly spawned process could have been given the prompt at all.
//
// It inherits the real-claude harness for free: `spawnClaude` defaults to true, so the full skip-gate
// applies (resolves `pyry` + `claude` on PATH + a credential BEFORE creating any resource; testInfo.skip
// on any miss). It declares NO `requiredCapabilities` — the daemon advertises no capability string for
// the prompt verbs, so there is nothing to gate on and #933's probe is never dialled. Auto-discovered by
// playwright.real-claude.config.ts's `testMatch` (`npm run e2e:real-claude`, the operator pre-ship gate)
// and IGNORED by the default `npm run e2e`.
//
// ADDING THIS FILE MAKES THE TIER'S FLOOR STALE. `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is a dispatcher
// environment variable and NO gate in this repo compares it against the spec count on disk — the runbook
// records 19 specs in 19 files with the floor still configured at 10, and this makes 20. The bump is the
// operator's.
//
// SECRET HYGIENE (the siblings' posture, with one addition this spec owes). The pairing payload is built
// the real-claude.spec.ts way and referenced nowhere but the arrival step — never asserted on, never
// interpolated into a message or a step title. THE ADDITION: SystemPromptSection.tsx's header records
// that an operator can paste a credential into a system prompt, which is why nothing on that path is ever
// logged. The prompt this spec saves is a SPEC-AUTHORED NON-SECRET LITERAL plus a numeric run nonce — no
// credential, no daemon string, no environment value is composed into it — and it is asserted by
// CONTAINMENT OF A CONSTANT THE SPEC ITSELF MINTED, never by printing the prompt or a reply back. Both
// marker helpers return a COUNT or a BOOLEAN for exactly that reason: a failure diff prints `0` vs `2`,
// never a transcript. Trace / screenshot / video stay disabled by the real-claude config.

// --- Selectors (verbatim from real-claude-new-session.spec.ts unless noted) --------------------------
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// The streaming cursor ▎ (U+258E) is a child <span> INSIDE the assistant bubble, so a row's textContent
// includes it even while the reply text is still empty. Strip it before the non-empty check.
const CURSOR_CHAR = '▎'
// turn_end appends a turnBoundary that drops the cursor — its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'
// #1014 filled the meta row's timestamp slot and `.bubble__meta` is a child of the bubble, so a row's
// textContent ends in a date whatever the reply says. Strip that subtree too, or the non-empty gate
// greens on any assistant row that merely EXISTS. Kept verbatim across the real-claude specs.
const META_SELECTOR = '.bubble__meta'
// NOT the sibling's bare `.session-delimiter`. ConversationScreen.tsx's timeline switch renders that class
// from BOTH its `sessionBoundary` and its `compactionBoundary` arms, the latter adding
// `.compaction-delimiter`. A bare-class count is sound for the sibling, which only counts; this spec
// slices assistant rows RELATIVE TO the delimiter, so a compaction boundary landing in the thread would
// silently move the slice point and the marker assertion would read the wrong turn.
const DELIMITER_SELECTOR = '.session-delimiter:not(.compaction-delimiter)'

// --- Client-owned labels. LOAD-BEARING LOCATORS: rewording any of these without updating this spec
// breaks it, which is the point. `exact: true` on the Actions trigger because getByRole matches `name` as
// a case-insensitive SUBSTRING and the thread overflow trigger reads `More actions`. ---
const ACTIONS_LABEL = 'Actions'
const NEW_SESSION_ROW = 'New session (restarts claude)'
const CHANNEL_INFO_ROW = 'Channel info'

// --- Timeouts ---------------------------------------------------------------------------------------
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold claude (spawn + model load + first reply). The turn AFTER the restart pays that cold
// start again, by construction — the restart is what threw the warm process away.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + THREE turns (cold, warm, cold again) + the sheet round trip + headroom. Above
// the sibling's 420s for the third turn; the config's 300s is not enough and `test.setTimeout` is what
// overrides it.
const SPEC_TIMEOUT_MS = 540_000

/**
 * Every non-empty assistant reply's text, in document order, with the streaming cursor and the meta row
 * stripped — real-claude-new-session.spec.ts's `nonEmptyAssistantCount` strip, kept byte-identical so the
 * two specs read a bubble the same way. Runs in the page context; the strip runs on a DETACHED COPY, so
 * the live DOM this spec's other assertions read is untouched.
 *
 * MODULE-PRIVATE, and it is the only thing here that ever holds reply text. Its two callers reduce it to
 * a count and a boolean before anything reaches an assertion — see the secret-hygiene note above.
 */
function assistantTexts(page: Page): Promise<string[]> {
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
          .filter((text) => text.length > 0),
      { cursor: CURSOR_CHAR, meta: META_SELECTOR }
    )
}

/** How many non-empty assistant replies exist. The siblings' liveness count, in terms of the above. */
async function nonEmptyAssistantCount(page: Page): Promise<number> {
  return (await assistantTexts(page)).length
}

/**
 * How many non-empty assistant replies anywhere in the thread contain `marker`.
 *
 * AC2 asks whether the reply in the still-running session carries it; this answers the STRICTLY STRONGER
 * question "does ANY row carry it", which is both simpler and sound: at the moment it is called, every row
 * in the thread belongs to the pre-restart session. A COUNT rather than the matching text, so a failure
 * prints `0` vs `2` and never a transcript.
 */
async function markerRowCount(page: Page, marker: string): Promise<number> {
  return (await assistantTexts(page)).filter((text) => text.includes(marker)).length
}

/**
 * Whether the FIRST non-empty assistant reply following the session delimiter contains `marker` (AC3).
 *
 * `querySelectorAll` over the two selectors together yields DOCUMENT ORDER regardless of how either is
 * nested, so the slice point is the delimiter itself rather than an index this spec would have to keep in
 * sync with the timeline's markup.
 *
 * FIRST, not newest: AC3 names the first reply after the boundary, and a turn may emit more than one text
 * block (the prompt says "begin every REPLY", which the model can reasonably read as the reply's opening
 * block alone). Reading the newest row instead would be a weaker claim than the AC makes, and would go
 * green on a run where only a later block happened to echo the token.
 *
 * Returns a BOOLEAN, never the text. `false` with no delimiter present is correct and not a silent pass:
 * the caller has already asserted the delimiter's arrival, so reaching here without one is unreachable.
 */
function markerAfterDelimiter(page: Page, marker: string): Promise<boolean> {
  return page.evaluate(
    ({ row, delimiter, cursor, meta, token }) => {
      const nodes = Array.from(document.querySelectorAll(`${row}, ${delimiter}`))
      const boundary = nodes.findIndex((node) => node.matches(delimiter))
      if (boundary === -1) return false
      for (const node of nodes.slice(boundary + 1)) {
        if (!node.matches(row)) continue
        const content = document.createElement('div')
        content.append(node.cloneNode(true))
        content.querySelectorAll(meta).forEach((child) => child.remove())
        const text = (content.textContent ?? '').split(cursor).join('').trim()
        if (text.length === 0) continue
        return text.includes(token)
      }
      return false
    },
    {
      row: ASSISTANT_ROW,
      delimiter: DELIMITER_SELECTOR,
      cursor: CURSOR_CHAR,
      meta: META_SELECTOR,
      token: marker
    }
  )
}

test('real claude applies a saved channel system prompt at New session and not before', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // Per-run nonces defeat reply caching, and here they do one thing more: the MARKER carries one, so no
  // row from an earlier turn or an earlier RUN can satisfy the positive assertion. Three distinct message
  // prompts so a stale row cannot be mistaken for a later turn's.
  const runNonce = Date.now()
  const marker = `MARKER-${runNonce}`
  // A spec-authored non-secret literal. It is saved into the prompt editor and NEVER sent as a message.
  const storedPrompt = `Begin every reply with the exact token ${marker}`
  const firstMessage = `Reply with the single word ready. run=${runNonce}-a`
  const secondMessage = `Reply with the single word ready. run=${runNonce}-b`
  const thirdMessage = `Reply with the single word ready. run=${runNonce}-c`

  // --- Precondition: pair against the real daemon, dial the test relay's /v1/client leg. Verbatim from
  // real-claude.spec.ts: the app dials `${relay.url}/v1/client` unchanged (NOT pyry's emitted prod relay);
  // the loopback affordance (#97) accepts the ws://127.0.0.1 relay. ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  const delimiters = page.locator(DELIMITER_SELECTOR)

  await pairFromUnpairedLaunch(page, payload)

  // --- Create the conversation THROUGH THE UI (#448) — the operator flow, not a pre-bound seed. The
  // seeded row renders only after the real daemon's `conversations` reply arrives on the connected edge,
  // so its visibility IS the connected gate; only then click the workspace row's `Create chat` plus, which
  // fires a real create at the real daemon and navigates on `conversation_created`. That navigation is
  // also what ACTIVATES the conversation, and activation is what fires `requestSystemPrompt`
  // (PairedShell's `requestConversationConfig`) — which is why the sheet below has a reading to show. ---
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- TURN ONE (cold), so the daemon has a live child process the save must NOT reach. A conversation
  // nobody has messaged has none, and the negative half would then be vacuous — there would be no running
  // session for the prompt to have left untouched. ---
  await composer.fill(firstMessage)
  await sendButton.click()

  // `>= 1` is sound HERE and only here: this conversation was minted through the plus moments ago and has
  // no history, so any non-empty assistant row is this turn's. Every later count is measured against a
  // baseline instead, because that property stops holding the moment a turn has landed.
  await expect
    .poll(() => nonEmptyAssistantCount(page), { timeout: TURN_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(1)
  // The turn is OVER, not merely started: the cursor drops on turn_end. Capturing a baseline before this
  // would race a still-streaming row.
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  const afterFirstTurn = await nonEmptyAssistantCount(page)

  // --- SAVE THE PROMPT through the operator's own route: the thread overflow menu, then Channel info. ---
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: CHANNEL_INFO_ROW }).click()

  const promptEditor = page.locator('.system-prompt__input')
  // AC4 — THE STALE-DAEMON GATE, and the reason it is spelled as a named assertion rather than an
  // incidental wait. While `request_system_prompt` is outstanding the section renders
  // `.system-prompt__empty` reading "Reading the stored prompt from the daemon" and NO EDITOR AND NO
  // CONTROLS at all (SystemPromptSection.tsx's `loading` arm), so there is no disabled textarea to wait
  // on: the editor APPEARING is the only observable that the reading landed. A daemon without
  // pyrycode#2152 never answers, leaving the section in that arm forever, and every later step would then
  // fail somewhere unhelpful — a fill against nothing, or a Save that never settles. This message is what
  // turns that into a diagnosis.
  await expect(
    promptEditor,
    'the daemon never answered request_system_prompt — the System prompt section stayed in its reading ' +
      'arm, which means a stale daemon without pyrycode#2152, not a client fault'
  ).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  await promptEditor.fill(storedPrompt)
  await page.locator('.system-prompt__save').click()
  // The REAL daemon settled the write. `systemPromptWriteConfirmed` is ack-driven, never an optimistic
  // local flip: daemonConnection.ts emits it only off a `conversation_updated` correlated by
  // `in_reply_to`, so this line reaching `Saved` is itself a statement that pyrycode#2151 answered. A red
  // here is a daemon-contract finding, not a spec bug. ("Saving" does not contain "Saved", so this cannot
  // pass on the in-flight line.)
  await expect(page.locator('.system-prompt__write')).toContainText('Saved', {
    timeout: HANDSHAKE_TIMEOUT_MS
  })

  // The sheet is `aria-modal` over the conversation surface, so the composer and the Actions menu are
  // unreachable until it is closed. Closing is a precondition for everything below, not tidying.
  await page.locator('.status-sheet__close').click()
  await expect(promptEditor).toHaveCount(0)

  // --- TURN TWO (warm, SAME session). AC2: saving did not reach the process that was already running. ---
  await expect(sendButton).toBeEnabled({ timeout: TURN_TIMEOUT_MS })
  await composer.fill(secondMessage)
  await sendButton.click()

  await expect
    .poll(() => nonEmptyAssistantCount(page), { timeout: TURN_TIMEOUT_MS })
    .toBeGreaterThan(afterFirstTurn)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // AC2. Every row in the thread belongs to the pre-restart session, so ZERO of them may carry the
  // marker. This is not a "the model happened not to say it" assertion: the running session was never
  // shown the instruction, and it cannot emit a per-run nonce it has never seen. A non-zero count here
  // would mean the daemon applied a saved prompt to a LIVE session — file that, do not soften this.
  expect(await markerRowCount(page, marker)).toBe(0)

  const afterSecondTurn = await nonEmptyAssistantCount(page)

  // A precondition read, not the proof: an ordinary turn draws no session boundary, so the delimiter
  // counted after the restart is the restart's.
  await expect(delimiters).toHaveCount(0)

  // --- NEW SESSION: the operator's route again, the Actions menu's own row. ---
  await page.getByRole('button', { name: ACTIONS_LABEL, exact: true }).click()
  await page
    .getByRole('menu', { name: ACTIONS_LABEL, exact: true })
    .getByRole('menuitem', { name: NEW_SESSION_ROW })
    .click()

  // EXACTLY ONE DELIMITER, drawn by the REAL daemon's own `session_transition`. It is also the anchor
  // `markerAfterDelimiter` slices on, so its arrival must be established before the read.
  await expect(delimiters).toHaveCount(1, { timeout: TURN_TIMEOUT_MS })

  // --- TURN THREE (cold again, NEW session). AC3: the spawn applied the stored prompt. ---
  await expect(sendButton).toBeEnabled({ timeout: TURN_TIMEOUT_MS })
  await composer.fill(thirdMessage)
  await sendButton.click()

  // Two gates before the proof, so the three ways this can fail are distinguishable rather than all
  // arriving as one timeout: no reply at all (the poll), a reply still streaming (the cursor), and a
  // completed reply WITHOUT the marker (the assertion below, which fails immediately instead of spinning).
  await expect
    .poll(() => nonEmptyAssistantCount(page), { timeout: TURN_TIMEOUT_MS })
    .toBeGreaterThan(afterSecondTurn)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // AC3 — THE PROOF. Containment, never position and never full text: a preamble must not redden the
  // tier. A `false` here means the daemon answered the read and the write but did NOT hand the prompt to
  // claude at spawn (pyrycode#2150), and that is a real red, not a flake.
  expect(await markerAfterDelimiter(page, marker)).toBe(true)

  // Still exactly one boundary — the restart drew one marker and the turn following it drew none.
  await expect(delimiters).toHaveCount(1)
})
