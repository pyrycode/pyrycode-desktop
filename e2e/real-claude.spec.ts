import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'

// The real-claude UI e2e (#252, reworked by #448) — the thin client-layer net over the daemon-side
// liveness test (#854). Every OTHER Desktop e2e (#89 transport round-trip, #93/#94 UI pair/send/stream)
// drives a fake relay + a fake daemon that ALWAYS answer, so they stay green even if the real daemon
// never responds. This spec drives the REAL stack the operator ships: a freshly-spawned real `pyry`
// daemon running real claude on `--model haiku`, bridged to the built Electron UI through #251's
// content-blind routing relay. The window stands in for #854's headless phone.
//
// #448 rework: the drive now CREATES its conversation through the UI (the New-discussion FAB → the
// daemon's conversation_created → nav) and sends into that real id. The old version sent into a
// conversation the fixture had pre-bound under the client's placeholder id — an accommodation that hid
// the placeholder from this gate entirely (the operator found the broken send live). The fixture's
// seed keeps a plain-UUID conversation for the connected gate; nothing is bound to a client constant.
//
// The spawn harness — the relay/daemon/page fixture chain, binary resolution, skip-gating, seedRegistry,
// waitForDaemonReady, and process-group reap — is extracted into e2e/fixtures/realDaemon.ts (#420) so the
// coming real-* specs reuse it; this spec keeps only the streaming assertion. `test`, `expect`, and the
// pairing encoder (`encodePairingPayload`) come from that fixture.
//
// It is gated OUT of the default `npm run e2e` (agent pipeline: no daemon, no claude, no creds) by a
// filename `testIgnore` in playwright.config.ts; it runs only under playwright.real-claude.config.ts via
// `npm run e2e:real-claude`, part of the operator's pre-ship gate alongside `npm run build` / `npm test`.
// When the real stack is unavailable the spec SKIPS cleanly (missing binaries/creds) — an unrun test is
// the correct outcome there, not a hard failure.
//
// TODO(#449): on the live stack this spec is currently RED — the isolated-HOME daemon delivers the turn
// but no reply ever fans back to the app (a separate, environment-specific gap left after #448's
// client-side conversation_id fix). It SKIPs cleanly in the pipeline (testIgnore) and must NOT be seeded
// green; the interim operator pre-ship gate is scripts/live-drive.mjs. Live diagnosis is tracked on #449.
//
// SCOPE: zero production `src/` change. The app, as built, already works against the real daemon+relay
// (#179 advertises `interactive` and renders the structured reply as data-thread-role="assistant"; #251
// is the routing bridge). The whole deliverable is this spec + its config + gating wiring.
//
// SECRET HYGIENE (security-sensitive label): assertions read DOM text / visibility / counts only; no
// failure diagnostic serialises the pairing token, keys, or the transcript.

// --- Selectors ---------------------------------------------------------------
// The one place #94 is stale: a real v2 daemon fans the STRUCTURED stream to interactive conns, which
// renders into the timeline (ConversationScreen.tsx:154) as data-thread-role="assistant" — NOT the
// non-interactive MessageBubble (#94's data-message-role="daemon", never fired here).
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
// The streaming cursor ▎ (U+258E) is a child <span> INSIDE the assistant bubble, so a row's textContent
// includes it even while the reply text is still empty. Strip it before the non-empty check.
const CURSOR_CHAR = '▎'
// turn_end appends a turnBoundary that drops the cursor — its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'

// --- Timeouts ----------------------------------------------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two: if the app's first noise_init reaches the relay before the daemon leg is OPEN,
// #251's relay drops it silently and the app's supervisor re-dials on a fresh conn_id. Send-enabled is the
// readiness signal (whenReady() is chicken-and-egg here — the client leg exists only once the app dials).
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold PTY claude (spawn + model load + first reply). Matches #854's per-turn budget.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + 2×turn + headroom.
const SPEC_TIMEOUT_MS = 300_000

/**
 * Count assistant rows whose text is non-empty once the streaming cursor ▎ is stripped. Runs in the page
 * context. Content-agnostic liveness: a naive "row exists" or unstripped-textContent check would pass on
 * an empty streaming bubble (the cursor span is inside the row).
 */
function nonEmptyAssistantCount(page: Page): Promise<number> {
  return page
    .locator(ASSISTANT_ROW)
    .evaluateAll(
      (els, cursor) =>
        els.filter((el) => (el.textContent ?? '').split(cursor).join('').trim().length > 0).length,
      CURSOR_CHAR
    )
}

test('real claude streams a reply into a UI-created conversation for two consecutive sends', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so turn 2 differs from turn 1 and reruns differ (defeats any accidental reply caching),
  // never asserted on. The single-short-word phrasing (from #854) discourages tool calls without pinning
  // content — the strictly-increasing count below is robust to a tool split regardless.
  const runNonce = Date.now()
  const message = (turn: number): string => `Reply with a single short word. run=${runNonce} turn=${turn}`

  // --- Precondition (AC1): pair against the real daemon, dial the test relay's /v1/client leg. ---
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim (relayConnection uses config.url unchanged); NOT pyry's emitted relay
    // (which points at prod). The loopback affordance (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  const fingerprint = page.locator('[aria-label="Server key fingerprint"]')
  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')

  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(fingerprint).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // --- Create the conversation THROUGH THE UI (#448) — the operator flow, not a pre-bound seed. ---
  // Pairing lands on the Channel List. The fixture's seeded row renders only after the real daemon's
  // `conversations` reply arrives on the connected edge, so its visibility IS the connected gate (the
  // launchPairedApp idiom); the FAB itself is present in all list states, so it must not be clicked
  // before this gate or the create command would fire into a not-yet-connected bridge.
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
  // The FAB fires a real `create_conversation` at the real daemon; navigation is event-driven — the
  // thread mounts ONLY when the daemon confirms with `conversation_created` (useConversationCreatedNav),
  // which also records the created conversation as active. The composer then sends under THAT real id;
  // a client regression to a placeholder id gets `send_message unknown conversation` from the real
  // daemon and no reply ever streams (the exact live failure #448 fixed).
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Turn 1 (AC2): a fresh session — proves the reply bridge binds. ---
  await composer.fill(message(1))
  await sendButton.click()
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message: 'turn 1: no non-empty assistant reply streamed within the timeout (the fresh-daemon deadlock #854 fixes)'
    })
    .toBeGreaterThanOrEqual(1)
  // Wait for turn 1 to fully quiesce (turn_end received → cursor cleared) before turn 2, so the turn-1/
  // turn-2 count comparison is race-free.
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Turn 2 (AC3): the session now exists — proves the bridge survives past the first turn. ---
  const base = await nonEmptyAssistantCount(page)
  await composer.fill(message(2))
  await sendButton.click()
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message: 'turn 2: no additional non-empty assistant reply streamed within the timeout'
    })
    .toBeGreaterThan(base)
})
