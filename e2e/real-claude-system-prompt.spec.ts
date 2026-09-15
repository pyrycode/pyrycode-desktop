import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload, type SpawnedDaemon } from './fixtures/realDaemon'
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
// differently with a prompt saved. This is that spec.
//
// WHAT IT PROVES, in two halves, with one marker token:
//   - A prompt stored BEFORE a conversation's session has a child reaches claude when that child
//     spawns: the first reply carries the marker.
//   - A prompt saved while a session is ALREADY RUNNING does not reach it: no reply in that session
//     carries the marker.
//
// THE NEGATIVE HALF IS SOUND, NOT A TIMING GUESS, and the reason is the whole design: the marker string
// NEVER ENTERS A COMPOSER MESSAGE. It exists only inside the system prompt textarea. So the session that
// was already running was never shown the instruction, and a model cannot emit a per-run nonce it has not
// seen. Putting the marker in a message — to "make the turn more likely to comply" — would destroy this
// and turn the negative assertion into a coin flip. Do not.
//
// AND IT IS NOT VACUOUS EITHER, which is the property the second conversation buys. A negative alone
// would go green against a daemon that stored nothing, applied nothing and had no verbs at all. The
// SAME prompt text is saved in a second conversation and IS observed in its first reply, so the zero in
// conversation A is a statement about WHEN the daemon applies a prompt rather than about whether it can.
//
// WHY THE POSITIVE HALF IS NOT TAKEN AFTER `New session`, WHICH IS WHAT THIS TICKET FIRST ASKED FOR.
// The 2026-09-15 live gate ran that shape and it failed at the marker, and the cause is upstream and
// structural, not a flake and not the model:
//
//   `refreshSystemPrompt` is the only thing that recomposes a session's --append-system-prompt-file
//   from the conversations registry. It has exactly one caller, `Pool.Activate`, and it returns early
//   for a session in `stateActive`. `new_session` reaches neither: `handleNewSession` →
//   `StartNewSession` → `Runner.RestartFresh`, which rotates the session id and cancels the live child
//   so the runner's OWN Run loop relaunches from the frozen argv — "never a Pool lock", as its doc
//   says — while `Pool.RotateForNewSession` only rekeys, persists and notifies. The session also stays
//   `stateActive` across the whole rotation, so even the next message's `Activate` skips the refresh.
//
// So a prompt saved during a live session cannot reach the child that `New session` spawns, which
// contradicts the daemon's own `set_system_prompt` contract ("takes effect at the conversation's NEXT
// session start"). That is filed upstream; the `test.fixme` at the foot of this file is the proof,
// written out and ready to flip to `test` when the daemon lands the fix.
//
// The path this spec takes instead is the one `refreshSystemPrompt`'s own doc says it exists to serve:
// a conversation's session is MINTED at create in `stateEvicted` and its child comes up on the first
// message (pyrycode#2085), so a prompt saved before that first message is composed in at the spawn.
// It is the same shape real-claude-effort-default.spec.ts already drives for session settings.
//
// REPLY CONTENT IS THE PROOF HERE, and this is the ONE spec in the tier where that is true. The siblings
// deliberately assert only that a reply ARRIVED (real-claude-new-session.spec.ts's header states it as a
// rule: "do NOT try to strengthen it by asserting reply content"). That posture is INVERTED here on
// purpose — a spec that only counted rows could not tell an applied prompt from an ignored one, which is
// the entire question. Recorded so the next reader files this as a decision, not as drift.
//
// NO MESSAGE CONSTRAINS THE SHAPE OF A REPLY, and that is a correction the same gate run bought. The
// first draft inherited the sibling's "Reply with the single word ready", which fights a stored prompt
// reading "begin every reply with <token>" — a model obeying the message alone answers `ready` and the
// spec reddens for a reason that has nothing to do with the daemon. The messages are now plain
// questions, and the stored prompt says the token applies to short answers too.
//
// WHAT IS DELIBERATELY NOT ASSERTED:
//   - `.system-prompt__session` (the running-session-differs notice). The reading is requested once per
//     ACTIVATION and not after a save, so that line does not appear without leaving and reopening the
//     conversation. Its mechanics are the fake tier's.
//   - The tri-state write (Save sends a string, Clear sends null) and the 8192-byte gate. Those are
//     e2e/channel-system-prompt.spec.ts's, which this ticket leaves untouched.
//   - Which PROCESS produced a reply. DOM-only over the real wire cannot show that — the sibling's
//     accepted limitation. The marker is a strictly stronger signal than the sibling had, though: only
//     a process that was handed the prompt at spawn could emit a nonce nothing else has seen.
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
// records 19 specs in 19 files with the floor still configured at 10, and this makes 20 EXECUTED (21
// declared; the `test.fixme` below does not run). The bump is the operator's.
//
// SECRET HYGIENE (the siblings' posture, with one addition this spec owes). The pairing payload is built
// the real-claude.spec.ts way and referenced nowhere but the arrival step — never asserted on, never
// interpolated into a message or a step title. THE ADDITION: SystemPromptSection.tsx's header records
// that an operator can paste a credential into a system prompt, which is why nothing on that path is ever
// logged. The prompt this spec saves is a SPEC-AUTHORED NON-SECRET LITERAL plus a numeric run nonce — no
// credential, no daemon string, no environment value is composed into it — and it is asserted by
// CONTAINMENT OF A CONSTANT THE SPEC ITSELF MINTED, never by printing the prompt or a reply back.
// `assistantTexts` is module-private and is the only thing here that ever holds reply text; every
// assertion reads a `MarkerReading`, which is three NUMBERS, so a failure diff prints counts and never a
// transcript. Trace / screenshot / video stay disabled by the real-claude config.

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
// `.compaction-delimiter`. A bare-class count is sound for the sibling, which only counts; the fixme below
// slices assistant rows RELATIVE TO the delimiter, so a compaction boundary landing in the thread would
// silently move the slice point and the marker assertion would read the wrong turn.
const DELIMITER_SELECTOR = '.session-delimiter:not(.compaction-delimiter)'

// --- Client-owned labels. LOAD-BEARING LOCATORS: rewording any of these without updating this spec
// breaks it, which is the point. `exact: true` on the Actions trigger because getByRole matches `name` as
// a case-insensitive SUBSTRING and the thread overflow trigger reads `More actions`. ---
const ACTIONS_LABEL = 'Actions'
const NEW_SESSION_ROW = 'New session (restarts claude)'
const CHANNEL_INFO_ROW = 'Channel info'
const CREATE_CHAT_LABEL = 'Create chat'

// --- Timeouts ---------------------------------------------------------------------------------------
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold claude (spawn + model load + first reply). Conversation B's only turn pays that cold
// start by construction — it is the spawn under test.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + THREE turns + two sheet round trips + a second conversation + headroom. Above
// the sibling's 420s; the config's 300s is not enough and `test.setTimeout` is what overrides it.
const SPEC_TIMEOUT_MS = 540_000

// The marker's fixed stem, shared by every run. Carried separately from the per-run token so a failure
// can distinguish "claude emitted a marker whose nonce differs" — the prompt DID reach it — from
// "claude emitted no marker at all". Those two have different causes and different owners.
const MARKER_STEM = 'MARKER-'

/** What a slice of replies says about the marker. THREE NUMBERS AND NO TEXT — see the header's
 *  secret-hygiene note. This is the only shape any assertion in this file reads. */
interface MarkerReading {
  /** Non-empty replies in the slice. Zero means nothing was read, which is a different fault. */
  replies: number
  /** Replies containing the exact per-run marker. */
  withMarker: number
  /** Replies containing the bare stem, whatever nonce follows. `withStem > withMarker` narrows a
   *  failure to the model transcribing the token wrong, with the prompt itself proven delivered. */
  withStem: number
}

/**
 * Every non-empty assistant reply's text, in document order, with the streaming cursor and the meta row
 * stripped — real-claude-new-session.spec.ts's `nonEmptyAssistantCount` strip, kept byte-identical so the
 * two specs read a bubble the same way. Runs in the page context; the strip runs on a DETACHED COPY, so
 * the live DOM this spec's other assertions read is untouched.
 *
 * MODULE-PRIVATE, and it is the only thing here that ever holds reply text. Every caller reduces it to a
 * `MarkerReading` or a length before anything reaches an assertion.
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

/** Reduce replies to counts. A PURE FUNCTION over strings already read — it is what keeps reply text out
 *  of every assertion in this file. */
function readMarkers(texts: readonly string[], marker: string): MarkerReading {
  return {
    replies: texts.length,
    withMarker: texts.filter((text) => text.includes(marker)).length,
    withStem: texts.filter((text) => text.includes(MARKER_STEM)).length
  }
}

/** The counts, spelled for a failure message. Numbers only; never a reply. */
function diagnose(reading: MarkerReading): string {
  return (
    `replies read: ${reading.replies}, ` +
    `carrying the run's marker: ${reading.withMarker}, ` +
    `carrying the bare "${MARKER_STEM}" stem: ${reading.withStem}`
  )
}

/** Open the Channel info sheet through the operator's own route: the thread overflow menu. */
async function openChannelInfo(page: Page): Promise<void> {
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: CHANNEL_INFO_ROW }).click()
}

/**
 * Save `prompt` as the open conversation's stored system prompt and close the sheet.
 *
 * The `.system-prompt__input` wait is AC4 — THE STALE-DAEMON GATE — and the reason it is spelled as a
 * named assertion rather than an incidental wait. While `request_system_prompt` is outstanding the
 * section renders `.system-prompt__empty` reading "Reading the stored prompt from the daemon" and NO
 * EDITOR AND NO CONTROLS at all (SystemPromptSection.tsx's `loading` arm), so there is no disabled
 * textarea to wait on: the editor APPEARING is the only observable that the reading landed. A daemon
 * without pyrycode#2152 never answers, leaving the section in that arm forever, and every later step
 * would then fail somewhere unhelpful — a fill against nothing, or a Save that never settles.
 *
 * The `Saved` wait is the REAL daemon settling the write. `systemPromptWriteConfirmed` is ack-driven,
 * never an optimistic local flip: daemonConnection.ts emits it only off a `conversation_updated`
 * correlated by `in_reply_to`, so this line reaching `Saved` is itself a statement that pyrycode#2151
 * answered. A red here is a daemon-contract finding, not a spec bug. ("Saving" does not contain "Saved",
 * so it cannot pass on the in-flight line.)
 *
 * IT IS ALSO NOT A LINE LEFT OVER FROM AN EARLIER SAVE, which is why every caller saves into a
 * conversation activated since its last save. `systemPromptWriteStore` is module-level and survives a
 * sheet close, but `activateConversation` dispatches `conversationSwitched`, which empties it — so the
 * marker this waits on was minted by the click above and by nothing else.
 */
async function saveStoredPrompt(page: Page, prompt: string): Promise<void> {
  await openChannelInfo(page)

  const promptEditor = page.locator('.system-prompt__input')
  await expect(
    promptEditor,
    'the daemon never answered request_system_prompt — the System prompt section stayed in its reading ' +
      'arm, which means a stale daemon without pyrycode#2152, not a client fault'
  ).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  await promptEditor.fill(prompt)
  await page.locator('.system-prompt__save').click()
  await expect(page.locator('.system-prompt__write')).toContainText('Saved', {
    timeout: HANDSHAKE_TIMEOUT_MS
  })

  // The sheet is `aria-modal` over the conversation surface, so the composer and the Actions menu are
  // unreachable until it is closed. Closing is a precondition for everything after it, not tidying.
  await page.locator('.status-sheet__close').click()
  await expect(promptEditor).toHaveCount(0)
}

/**
 * Send `message` and wait for the turn to be OVER rather than merely started, returning every non-empty
 * reply the thread holds afterwards.
 *
 * `baseline` is the non-empty reply count before the send; the poll waits past it. The cursor wait after
 * it is the quiesce signal — capturing replies before it would race a still-streaming row.
 */
async function takeTurn(page: Page, message: string, baseline: number): Promise<string[]> {
  const sendButton = page.getByRole('button', { name: 'Send' })
  await expect(sendButton).toBeEnabled({ timeout: TURN_TIMEOUT_MS })
  await page.getByPlaceholder('Message…').fill(message)
  await sendButton.click()

  await expect
    .poll(() => nonEmptyAssistantCount(page), { timeout: TURN_TIMEOUT_MS })
    .toBeGreaterThan(baseline)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  return assistantTexts(page)
}

/** Mint a chat through the workspace row's plus — the operator flow, not a pre-bound seed — and wait for
 *  its empty thread. `.conversation__empty` is what proves the pane switched rather than kept the
 *  previous conversation's rows, which is what makes a later reply count unambiguous. */
async function createChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: CREATE_CHAT_LABEL, exact: true }).click({ force: true })
  await expect(page.locator('.conversation')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(
    page.locator('.conversation__empty'),
    'the created chat did not present an empty thread, so a reply count below cannot be attributed to ' +
      'this conversation'
  ).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
}

/** Pair against the real daemon and wait for the connected gate. The relay leg is assembled the
 *  real-claude.spec.ts way: the app dials `${relay.url}/v1/client` unchanged (NOT pyry's emitted prod
 *  relay), and the loopback affordance (#97) accepts the ws://127.0.0.1 relay. The seeded row renders
 *  only after the real daemon's `conversations` reply arrives on the connected edge, so its visibility
 *  IS the connected gate. */
async function pairAndConnect(
  page: Page,
  relay: { url: string },
  pairFields: SpawnedDaemon['pairFields']
): Promise<void> {
  const payload = encodePairingPayload({
    server: pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: pairFields.token,
    server_static_pubkey: pairFields.server_static_pubkey
  })
  await pairFromUnpairedLaunch(page, payload)
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
}

test('real claude applies a stored system prompt at a spawn, and a save never reaches a running session', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // Per-run nonces defeat reply caching, and here they do one thing more: the MARKER carries one, so no
  // row from an earlier turn or an earlier RUN can satisfy the positive assertion. Distinct message
  // prompts so a stale row cannot be mistaken for a later turn's.
  const runNonce = Date.now()
  const marker = `${MARKER_STEM}${runNonce}`
  // A spec-authored non-secret literal. It is saved into the prompt editor and NEVER sent as a message.
  // The second sentence is load-bearing: without it a model reads a terse question as licence to answer
  // in one word and drop the prefix, which is the 2026-09-15 gate's lesson.
  const storedPrompt =
    `Begin every reply with the exact token ${marker} before any other text. ` +
    `Apply this to every reply, including short or one-word answers.`
  const warmSessionFirst = `What is 2 plus 2? run=${runNonce}-a`
  const warmSessionSecond = `What is 3 plus 4? run=${runNonce}-b`
  const coldSpawn = `What is 5 plus 6? run=${runNonce}-c`

  await pairAndConnect(page, relay, daemon.pairFields)

  // === CONVERSATION A — the negative half: a save does not reach a session already running. ==========
  await createChat(page)

  // TURN ONE, which brings A's child up. A conversation nobody has messaged has no child (pyrycode#2085
  // mints the session at create and defers the spawn), and the negative half would be vacuous without
  // one — there would be no running session for the save to have left untouched.
  const beforeSave = await takeTurn(page, warmSessionFirst, 0)
  // Nothing has been saved yet, so nothing can carry a marker. A non-zero stem here would mean the run
  // is reading rows it did not produce.
  expect(
    readMarkers(beforeSave, marker).withStem,
    'a reply carried a marker stem before any prompt was saved — the thread is showing rows this run ' +
      'did not produce'
  ).toBe(0)

  // THE SAVE, against A's LIVE session.
  await saveStoredPrompt(page, storedPrompt)

  // TURN TWO, same session. The daemon applies a stored prompt only at a spawn — `refreshSystemPrompt`
  // returns early for a session in `stateActive` — so A's child still runs with what it was spawned
  // with, which is nothing.
  const afterSave = readMarkers(
    (await takeTurn(page, warmSessionSecond, beforeSave.length)).slice(beforeSave.length),
    marker
  )
  expect(
    afterSave.withMarker,
    'a reply in the session that was already running carried the marker, which would mean the daemon ' +
      `applied a saved prompt to a LIVE session — ${diagnose(afterSave)}. File that; do not soften this.`
  ).toBe(0)

  // === CONVERSATION B — the positive half, and what makes A's zero mean something. ====================
  // The SAME prompt text, saved before B's session has a child, must reach that child at its spawn.
  // Activating B also empties `systemPromptWriteStore`, so the `Saved` line below is this save's.
  await createChat(page)
  await saveStoredPrompt(page, storedPrompt)

  // THE PROOF. Containment, never position and never full text: a preamble must not redden the tier.
  const atSpawn = readMarkers(await takeTurn(page, coldSpawn, 0), marker)
  expect(
    atSpawn.withMarker,
    'the first reply of a session spawned AFTER the prompt was stored did not carry the marker — ' +
      `${diagnose(atSpawn)}. A non-zero stem count means the daemon did hand the prompt to claude at ` +
      'spawn and only the nonce differs (a model transcription fault); a zero stem count against ' +
      'replies that were read means either the daemon did not apply the stored prompt at spawn ' +
      '(pyrycode#2150) or the model declined the instruction.'
  ).toBeGreaterThan(0)
})

// BLOCKED ON THE UPSTREAM DAEMON, NOT ON THIS SPEC — see the file header for the trace. `new_session`
// respawns claude from the frozen argv without re-entering `Pool.Activate`, which is
// `refreshSystemPrompt`'s only caller, so a prompt saved during a live session cannot reach the child
// the rotation starts. The 2026-09-15 real-claude gate ran exactly this and failed at the marker.
//
// It is written out rather than described because flipping `test.fixme` back to `test` is then the whole
// change once the daemon lands the fix, and because it is the executable statement of what "fixed"
// means. It asserts the FIRST non-empty reply after the delimiter, not the newest: a turn may emit more
// than one text block, and reading the newest would go green on a run where only a later block happened
// to carry the token.
test.fixme(
  'real claude picks up a saved channel system prompt at New session',
  async ({ relay, daemon, page }) => {
    test.setTimeout(SPEC_TIMEOUT_MS)

    const runNonce = Date.now()
    const marker = `${MARKER_STEM}${runNonce}`
    const storedPrompt =
      `Begin every reply with the exact token ${marker} before any other text. ` +
      `Apply this to every reply, including short or one-word answers.`

    await pairAndConnect(page, relay, daemon.pairFields)
    await createChat(page)

    const beforeSave = await takeTurn(page, `What is 2 plus 2? run=${runNonce}-a`, 0)
    await saveStoredPrompt(page, storedPrompt)

    const delimiters = page.locator(DELIMITER_SELECTOR)
    // A precondition read, not the proof: an ordinary turn draws no session boundary, so the delimiter
    // counted after the restart is the restart's.
    await expect(delimiters).toHaveCount(0)

    await page.getByRole('button', { name: ACTIONS_LABEL, exact: true }).click()
    await page
      .getByRole('menu', { name: ACTIONS_LABEL, exact: true })
      .getByRole('menuitem', { name: NEW_SESSION_ROW })
      .click()

    // EXACTLY ONE DELIMITER, drawn by the REAL daemon's own `session_transition`. It is also the anchor
    // the read below slices on, so its arrival must be established first.
    await expect(delimiters).toHaveCount(1, { timeout: TURN_TIMEOUT_MS })

    await takeTurn(page, `What is 5 plus 6? run=${runNonce}-c`, beforeSave.length)

    const firstAfterRestart = await page.evaluate(
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
    expect(
      firstAfterRestart,
      'the first reply after New session did not carry the marker: the rotation respawned claude ' +
        'without recomposing the appended system prompt file'
    ).toBe(true)
  }
)
