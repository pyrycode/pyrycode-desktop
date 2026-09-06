import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// #1169/AC5 — the LIVENESS NET for this feature's load-bearing wire premise, over the real stack.
//
// WHAT THE FAKE TIER CANNOT REACH. `e2e/composer-effort-default.spec.ts` proves the client wiring end to
// end against a daemon that answers anything: the level is remembered on a confirm, applied to a chat
// reporting none, and withheld from a chat reporting its own. What it cannot prove is the premise the
// whole design rests on — that a `set_session_settings` against a NEVER-MESSAGED conversation persists
// with no claude child running, and that the first message then materialises the child with that setting
// already composed into its launch arguments (pyrycode#2085 mints and binds the session at conversation
// creation while the process starts on the first message). A daemon that dropped such a change, or
// answered it and then spawned without it, would leave the whole fake suite green.
//
// AND THE OTHER HALF: no `/effort` line may appear in the thread. Some settings reach a RUNNING session
// as an ordinary message beginning with a slash (CLAUDE.md § Driving a running session), and this one
// deliberately does not — it goes to the launch arguments. A client that reached for the slash path would
// put a visible user turn in the thread and burn a turn to do it, so the thread itself is the detector.
//
// REAL-CLAUDE DIVERGENCES from the fake twin (the only deltas — the real-daemon-workspace.spec.ts doc
// discipline):
//   - NO `daemon.pushFrame`: the real daemon owns the turn lifecycle and publishes its own model list.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so the
//     twin's in-process capture and its deep equal on the payload are unavailable. Every assertion here
//     reads DOM text and counts only.
//   - THE LEVEL IS READ, NEVER ASSUMED. Which levels exist is the daemon's to publish, so the level this
//     drive picks is derived from the segments actually rendered — no client-side vocabulary appears in
//     this file, exactly as none appears in the app (#976).
//   - THE PICK GOES THROUGH THE SHEET, not the footer. The footer's effort control draws NOTHING while
//     the session reports no explicit effort, which is the defect this ticket exists to fix and therefore
//     the state chat A is in; `EffortSection` stays operable there. That asymmetry is deliberate on both
//     surfaces (see ComposerEffortMenu's three renderings) and is what makes the first pick possible.
//
// ACCEPTED LIMITATION, stated rather than papered over, and it is the same one the sibling real settings
// specs record: `runSettingsWriteStore.confirmed` is an app-level per-field override that outlives the
// post-turn re-read, so the final label is not PROVABLY snapshot-sourced. What the drive does prove is the
// failure this tier exists to catch — a daemon that refuses the change, or drops it for a never-messaged
// conversation, replies with an error, the store drops the pending marker WITHOUT committing an override,
// and the label rolls back to nothing at all, failing step 3 or step 5.
//
// SECRET HYGIENE: every assertion reads DOM text or a count. The pairing payload is built the same way as
// the sibling specs and is never echoed into a message or a failure diagnostic. The levels are
// daemon-published display values, never a token or a key.

const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold claude (spawn + model load + first reply), the sibling specs' per-turn budget.
const TURN_TIMEOUT_MS = 120_000
// Handshake + 2×turn + two create round trips + the settings round trip + headroom.
const SPEC_TIMEOUT_MS = 360_000
// A settings write and its reply-gated re-render. No claude turn to absorb, so this is tight on purpose —
// a timeout here means the daemon did not answer, which is the signal.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// The streaming cursor is a child of the assistant bubble; its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'

test('a level set before a chat’s first message survives into the first turn', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so the turns differ and reruns differ; never asserted on. The single-short-word
  // phrasing (from #854) discourages tool calls, which this drive has no need of.
  const runNonce = Date.now()
  const message = (turn: number): string =>
    `Reply with a single short word. run=${runNonce} turn=${turn}`

  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  const label = page.locator('.composer__effort-label')
  const segment = page.locator('.run-config__effort-segment')

  await pairFromUnpairedLaunch(page, payload)

  // --- Precondition: pair, then create chat A THROUGH THE UI (#448) — the operator flow. The seeded row
  // rendering is the connected gate; the FAB must not be clicked before it. ---
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Turn 1, in chat A: resolve a real session so the sheet's controls are addressable. Nothing about
  // this turn is asserted beyond its completion — it exists to give the pick below somewhere to land. ---
  await composer.fill(message(1))
  await sendButton.click()
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- 1. Pick a level in A, through the run-configuration sheet. The segments existing at all is itself
  // the proof that the real daemon published a row for this chat's model with levels on it — the join
  // #1168 widened to the inherited default, exercised here against a chat nobody set a model on. ---
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Run configuration' }).click()
  await expect(segment.first()).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  const published = (await segment.allInnerTexts()).map((text) => text.trim())
  // `aria-current` sits ON the segment (it is both the a11y marker and the CSS selection hook), so the
  // marked set is a filtered selector rather than a descendant match.
  const marked = (
    await page.locator('.run-config__effort-segment[aria-current="true"]').allInnerTexts()
  ).map((text) => text.trim())
  // Pick one the session is NOT already running, so the final assertions are falsifiable: a change to the
  // level already in force would pass whether or not the daemon did anything at all. A chat nobody has
  // set a level on marks nothing, which is the ordinary case here and leaves every level eligible.
  const picked = published.find((level) => !marked.includes(level))
  expect(
    picked,
    `no unselected level among ${published.length} published, ${marked.length} marked`
  ).toBeDefined()

  await page.locator('.run-config__effort-segment', { hasText: new RegExp(`^${picked}$`) }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  // The footer now draws the level — which is both this ticket's own reading and the proof the daemon
  // ACCEPTED the change: a refusal drops the pending marker without committing an override, and this
  // control would go back to drawing nothing at all.
  await expect(label).toHaveText(picked!, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 2. Mint chat B and send NOTHING. B has a session bound at creation and no claude child, which is
  // exactly the state this ticket's write has to survive. ---
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- 3. AC5's first half, and AC1 over the real wire: the remembered level is applied to B BEFORE its
  // first message, so the footer names it on a chat that has never had a turn. This step also proves the
  // premise the design rests on — a never-messaged conversation is addressable — because the apply is
  // gated on an addressable session id and would be silently inert without one. ---
  await expect(label).toHaveText(picked!, { timeout: HANDSHAKE_TIMEOUT_MS })

  // --- 4. B's first turn. This is where the daemon materialises the child, and where a setting that was
  // accepted-then-dropped would show itself. ---
  await composer.fill(message(2))
  await sendButton.click()
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- 5. AC5's second half. The chat still reports the level once the first turn has ended... ---
  await expect(label).toHaveText(picked!, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)

  // ...and the level never travelled as a message. The positive count comes FIRST so the absence below is
  // asserted against a thread that provably rendered: one user turn and one assistant reply.
  await expect(page.locator('.bubble')).toHaveCount(2, { timeout: TURN_TIMEOUT_MS })
  // `hasText` is a case-insensitive substring match, which is exactly what is wanted here — any slash
  // line naming this setting, however it were phrased, would be caught.
  await expect(page.locator('.bubble', { hasText: '/effort' })).toHaveCount(0)
})
