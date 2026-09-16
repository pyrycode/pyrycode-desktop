import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// Match production: the Mac daemon runs interactive_runner: stream-json, and a real v2 daemon fans the
// STRUCTURED stream to interactive conns as the `data-thread-role="assistant"` rows this spec counts.
// real-claude.spec.ts's line verbatim.
test.use({ interactiveRunner: 'stream-json' })

// Tier-3 real-claude e2e for #1218 — the LIVENESS NET for Reset session, and the reason it cannot be folded
// into the fake tier. The fake twin (e2e/composer-new-session.spec.ts) proves the CLIENT WIRING: the
// picked row reaches the wire as one `new_session` naming the open conversation, nothing travels the
// message path, and a scripted `session_transition` draws exactly one delimiter. But there the daemon's
// answer is a `daemon.pushFrame` — a state this spec's author chose. Here claude is genuinely killed and
// genuinely respawned, and the two things that can only be true or false on the real stack are: that the
// daemon answers the frame with a rotation marker at all, and that the turn stream SURVIVES the respawn.
// A client that sent a well-formed frame into a daemon that then never spoke again would pass the fake
// tier untouched.
//
// It clones real-claude-interrupt.spec.ts's precondition (pair against a freshly-spawned real `pyry` on
// `--model haiku`, bridged to the built Electron window through #251's content-blind routing relay, then
// CREATE the conversation through the workspace row's `Create chat` plus and reach the connected
// `.conversation` with Send enabled) and swaps the body: run a turn, restart, then run another turn
// across the restart.
//
// THE FIRST TURN IS A PRECONDITION, NOT DECORATION. A conversation nobody has messaged has no child
// process to rotate, and the daemon's handler is inert — the AC's own first arm, and the fake tier's.
// Sending once is what gives the restart something to kill.
//
// REAL-CLAUDE DIVERGENCES from the fake twin (the only deltas — the real-daemon-workspace.spec.ts doc
// discipline):
//   - NO `daemon.pushFrame`: the delimiter must come from the REAL daemon rotating a REAL session in
//     response to this frame, not from a scripted push.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so the
//     fake twin's in-process `decodeEnvelope` capture is unavailable — the same divergence
//     real-daemon-workspace.spec.ts documents. Every assertion reads DOM text, values and counts.
//   - Accepted limitation: DOM-only over the real wire cannot prove that the assistant turn after the
//     restart came from a NEW process rather than the old one. The delimiter between them is the daemon's
//     own statement that the session rotated, and it is the strongest available signal in this tier. Do
//     NOT try to strengthen it by asserting reply content.
//
// It inherits the real-claude harness for free: `spawnClaude` defaults to true, so the full skip-gate
// applies (resolves `pyry` + `claude` on PATH + a credential BEFORE creating any resource; testInfo.skip
// on any miss). Auto-discovered by playwright.real-claude.config.ts's `testMatch: /real-.*\.spec\.ts$/`
// (`npm run e2e:real-claude`, the operator pre-ship gate) and IGNORED by the default `npm run e2e`.
//
// ADDING THIS FILE MAKES THE TIER'S FLOOR STALE. `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is a dispatcher
// environment variable and NO gate in this repo compares it against the spec count on disk — the runbook
// records 13 against 14 files already present, and this makes 15. The bump is the operator's.
//
// SECRET HYGIENE (the siblings' posture): every assertion reads DOM text, values or counts; the prompts
// are non-secret nonce literals whose content is NEVER asserted; the pairing payload is built the
// real-claude.spec.ts way and never echoed into a message. No failure diagnostic serialises the token,
// keys, or the transcript; trace / screenshot / video stay disabled by the real-claude config.

// --- Selectors (verbatim from real-claude-interrupt.spec.ts) -----------------
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// The streaming cursor ▎ (U+258E) is a child <span> INSIDE the assistant bubble, so a row's textContent
// includes it even while the reply text is still empty. Strip it before the non-empty check.
const CURSOR_CHAR = '▎'
// turn_end appends a turnBoundary that drops the cursor — its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'
// #1014 filled the meta row's timestamp slot and `.bubble__meta` is a child of the bubble, so a row's
// textContent ends in a date whatever the reply says. Strip that subtree too, or this tier's liveness
// gates green on any assistant row that merely EXISTS. Kept verbatim across the real-claude specs that
// read a bubble's text.
const META_SELECTOR = '.bubble__meta'
// The session-boundary marker the daemon draws when a conversation's session rotates — already rendered
// and untouched by #1218.
const DELIMITER_SELECTOR = '.session-delimiter'

// --- Client-owned labels. LOAD-BEARING LOCATORS: rewording either in ComposerActionsMenu.tsx without
// updating this spec breaks it, which is the point. `exact: true` on the trigger because getByRole
// matches `name` as a case-insensitive SUBSTRING and the thread overflow trigger reads `More actions`. ---
const ACTIONS_LABEL = 'Actions'
// #1496 renamed this row: it read `New session (restarts claude)` while a second `/clear` row called
// itself Reset session. The fold dropped that row and this one inherited its label; the binding keeps
// the wire's verb, as ComposerActionsMenu.tsx's own constant does.
const NEW_SESSION_ROW = 'Reset session'

// --- Timeouts (the siblings' values) ----------------------------------------
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold claude (spawn + model load + first reply). The turn AFTER the restart pays that cold
// start again, by construction — the restart is what threw the warm process away.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + one turn + the restart + a second COLD turn + headroom. Longer than the
// single-turn siblings' 300s for exactly that second cold start.
const SPEC_TIMEOUT_MS = 420_000

/**
 * Count assistant rows whose text is non-empty once the streaming cursor ▎ and the meta row are stripped.
 * real-claude-interrupt.spec.ts's helper verbatim. Runs in the page context; the strip runs on a detached
 * copy, so the live DOM this spec's other assertions read is untouched. Content-agnostic liveness: a naive
 * "row exists" or unstripped-textContent check would pass on an empty streaming bubble.
 */
function nonEmptyAssistantCount(page: Page): Promise<number> {
  return page
    .locator(ASSISTANT_ROW)
    .evaluateAll(
      (els, { cursor, meta }) =>
        els.filter((el) => {
          const content = document.createElement('div')
          content.append(el.cloneNode(true))
          content.querySelectorAll(meta).forEach((node) => node.remove())
          return (content.textContent ?? '').split(cursor).join('').trim().length > 0
        }).length,
      { cursor: CURSOR_CHAR, meta: META_SELECTOR }
    )
}

test('real claude restarts on Reset session and the turn stream survives it', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // Per-run nonces defeat reply caching; the replies' CONTENT is never asserted on, only their arrival.
  // Two distinct prompts so a stale row from the first turn cannot be mistaken for the second's.
  const runNonce = Date.now()
  const firstMessage = `Reply with the single word ready. run=${runNonce}-a`
  const secondMessage = `Reply with the single word ready. run=${runNonce}-b`

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
  // fires a real create at the real daemon and navigates on `conversation_created`. ---
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- A first real turn, so the daemon has a child process to rotate. A conversation nobody has messaged
  // has none and the restart handler is inert (the AC's first arm, covered in the fake tier). ---
  await composer.fill(firstMessage)
  await sendButton.click()

  // `>= 1` is sound HERE and only here: this conversation was minted through the plus moments ago and has
  // no history, so any non-empty assistant row is this turn's. Every later count is measured against the
  // baseline below instead, because that property stops holding the moment a turn has landed.
  await expect
    .poll(() => nonEmptyAssistantCount(page), { timeout: TURN_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(1)
  // The turn is over, not merely started: the cursor drops on turn_end. Capturing the baseline before
  // this would race a still-streaming row.
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- THE BASELINE (AC5), captured strictly after the first turn quiesced, so it is race-free. The
  // closing assertion is `> baseline` rather than a bare non-zero count, which would already be true here
  // and would prove nothing about the turn after the restart. ---
  const baseline = await nonEmptyAssistantCount(page)

  // A precondition read, not the proof: an ordinary turn draws no session boundary, so the delimiter
  // counted after the restart is the restart's. The proof is the positive count below.
  await expect(delimiters).toHaveCount(0)

  // --- Restart claude (AC5). The operator's own route: open the Actions menu and pick the row. ---
  await page.getByRole('button', { name: ACTIONS_LABEL, exact: true }).click()
  await page
    .getByRole('menu', { name: ACTIONS_LABEL, exact: true })
    .getByRole('menuitem', { name: NEW_SESSION_ROW })
    .click()

  // EXACTLY ONE DELIMITER, drawn by the REAL daemon's own `session_transition`. This is the assertion the
  // fake tier cannot make: there the marker is a push this spec's author wrote. A timeout here means the
  // daemon received a well-formed frame and did not rotate the session — file it separately, do NOT
  // soften it into a `>= 0`.
  await expect(delimiters).toHaveCount(1, { timeout: TURN_TIMEOUT_MS })

  // --- THE TURN STREAM SURVIVES THE RESTART (AC5) — the whole point of this tier. A second real turn,
  // against the process the daemon just spawned, counted against the baseline. It pays a cold start
  // again, which is why the spec's budget carries two turn windows. ---
  await expect(sendButton).toBeEnabled({ timeout: TURN_TIMEOUT_MS })
  await composer.fill(secondMessage)
  await sendButton.click()

  await expect
    .poll(() => nonEmptyAssistantCount(page), { timeout: TURN_TIMEOUT_MS })
    .toBeGreaterThan(baseline)

  // Still exactly one boundary. The second turn was sent strictly after the count reached 1 and the count
  // has not moved, so the assistant row it produced arrived AFTER that boundary — which is AC5's ordering
  // clause, established by the sequence of gates rather than by re-deriving the timeline's item order
  // here. A second delimiter would mean the restart drew one marker and the following turn another.
  await expect(delimiters).toHaveCount(1)
})
