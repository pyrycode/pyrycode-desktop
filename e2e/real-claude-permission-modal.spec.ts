import { type Locator } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'

// Tier-3 real-claude e2e (#432) — the DEEPEST liveness net in the suite: the permission modal proven over
// the REAL stack. It exercises the whole interactive-permission chain end to end — a freshly-spawned real
// `pyry` daemon → real claude actually BLOCKING on a tool permission → the daemon relaying `modal_shown`
// to the remote desktop → the desktop answering "allow" → the tool running → the turn completing. Every
// prior modal test SCRIPTS the modal: the unit tests (interactiveRoundtrip / PermissionModal /
// modalResolution) and the fake-stack twin (permission-modal-answer-paths.spec.ts, #426) push a
// `daemon.pushFrame`. This proves ONE answer path — allow — over the REAL chain, where the `modal_shown`
// is emitted by a real daemon relaying a real claude tool prompt, not a scripted push.
//
// It clones real-claude.spec.ts's precondition VERBATIM (pair against a freshly-spawned real `pyry` on
// `--model haiku`, bridged to the built Electron window through #251's content-blind routing relay, then
// CREATE the conversation through the New-discussion FAB and reach the connected `.conversation` with Send
// enabled) and swaps only the turn body: send a prompt engineered to force exactly ONE permission-gated
// tool call, answer the relayed dialog "allow", and prove the turn completes. Same clone-then-swap shape
// as the merged siblings #445 (interrupt) and #446 (queue-drop).
//
// The client wiring is fully shipped and fake-stack-proven; this adds NO production `src/` change. The app
// advertises `CAPABILITY_INTERACTIVE` at hello (daemonConnection.ts, #179), whose vocabulary explicitly
// includes modal prompts — that is what makes the daemon relay claude's permission prompt to the remote
// desktop instead of resolving it PTY-side. `PermissionModal` is mounted unconditionally on the
// conversation surface (ConversationScreen.tsx:201) and renders whenever `modalStore.outstanding[0]` exists,
// driven purely by an inbound `modal_shown` — NOT gated on the interactive-timeline flip. So no un-inert
// step; the dialog renders the moment the prompt arrives.
//
// REAL-CLAUDE DIVERGENCES from the fake twin #426 (mirrors the #445/#446 doc discipline):
//   - NO `daemon.pushFrame`: the real daemon owns the modal lifecycle. The `modal_shown` is emitted by a
//     real claude actually reaching a tool call and blocking on the permission, not a scripted push.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so #426's
//     in-process `capturingModalFake` / captured `modal_answer` assertions are unavailable. Every assertion
//     reads DOM text / visibility / counts only.
//   - The option labels + which option is default are DAEMON-SUPPLIED here (the daemon relays claude's
//     actual permission options), not test-controlled as in #426 — see § "Answering allow" below.
//   - Accepted limitation (OQ-e, cloned from #445): DOM-only over the real wire CANNOT *prove* the turn
//     ended BECAUSE of the allow. The mitigation is structural: the tool is permission-gated, so `turn_end`
//     can only follow the tool running, which can only follow the answer. Do NOT try to strengthen it into a
//     causation proof by asserting reply content.
//
// It inherits the real-claude harness for free: `spawnClaude` defaults true (claude on `--model haiku`) and
// the full skip-gate (resolves `pyry` + `claude` on PATH + a credential BEFORE any resource; testInfo.skip
// on any miss). The ONLY override is `skipPermissions: false` (#432's single-consumer fixture option), which
// drops `--dangerously-skip-permissions` so a tool call blocks on a permission decision instead of
// auto-running. It is auto-discovered by playwright.real-claude.config.ts's `testMatch: /real-.*\.spec\.ts$/`
// (runs under `npm run e2e:real-claude`, the operator pre-ship gate) and IGNORED by the default `npm run
// e2e`. When the real stack is unavailable the spec SKIPS cleanly — an unrun test, never a hard failure.
//
// SECRET HYGIENE (AC5): every assertion reads DOM text / visibility / counts only; the tool-call prompt is a
// non-secret nonce literal, content NEVER asserted; the pairing payload is built the real-claude.spec.ts way
// and never echoed into a message. No failure diagnostic serialises the token, keys, or the transcript;
// trace / screenshot / video stay disabled (the real-claude config already disables all three).

// The fixture overrides that make the modal reach — and be answerable by — this desktop client:
//   - skipPermissions:false (#432) drops `--dangerously-skip-permissions`, so the tool call blocks on a
//     per-tool permission decision instead of auto-running.
//   - interactiveRunner:'stream-json' (#483/T9) routes the daemon's interactive path onto the streamsup
//     runner. On the PTY path the daemon read the permission dialog by screen-scraping and misclassified it
//     on the live buffer (desktop#483), so the modal never surfaced. The stream runner instead wires
//     claude's approval tool to the daemon, which emits the modal_shown deterministically.
//   - allowRemotePermissions:true (#483/T9) pairs the device with the remote-permission grant. The daemon
//     fail-closes the answer on that grant, so without it the dialog would render but "allow" would be
//     denied and the turn would never complete — the second gate the PTY red masked.
// Every sibling spec sets none of these → PTY default, plain pairing, identical args as today.
test.use({ skipPermissions: false, interactiveRunner: 'stream-json', allowRemotePermissions: true })

// --- Selectors (verbatim from real-claude.spec.ts) ---------------------------
// turn_end appends a turnBoundary that drops the streaming cursor ▎ (U+258E) — its absence is the per-turn
// quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'

// --- Timeouts (verbatim from real-claude.spec.ts) ----------------------------
// Generous to absorb real daemon startup latency (registration on /v1/server is async after spawn) plus a
// handshake re-dial or two; Send-enabled is the readiness signal.
const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold PTY claude (spawn + model load + first reply). Also bounds the post-answer completion wait.
const TURN_TIMEOUT_MS = 120_000
// Whole spec: handshake + one permission-gated turn + headroom.
const SPEC_TIMEOUT_MS = 300_000

// --- New constant ------------------------------------------------------------
// The wait for the first permission dialog after Send. Cold PTY claude must spawn, load the model, and reach
// the tool call before it blocks on the permission, so bound it as generously as a whole turn.
const MODAL_TIMEOUT_MS = 120_000

/**
 * Answer the relayed permission dialog "allow". Over the real stack the affirmative label + which option is
 * default are DAEMON-SUPPLIED (the daemon relays claude's actual options), so neither is known ahead of time:
 *   - The affirmative label is matched by a start-anchored, case-insensitive regex over the plausible
 *     affirmative vocabulary, scoped INSIDE the dialog, first match. The `^…\b` anchor keeps it from matching
 *     a decline like "No, and tell Claude…"; the client-owned Cancel/Back/Confirm buttons carry different
 *     labels and are not matched.
 *   - Which option is default is unknown, so clicking the affirmative either answers straight-through (if it
 *     IS the default — modalResolution.selectOption resolves it in one tap) or opens the client-owned confirm
 *     sub-step (if non-default — held pending a second `Confirm`). Resolve both: click the affirmative, then
 *     click `Confirm` iff it appeared. `Confirm` is client-owned + deterministic; the sub-step transition is
 *     a synchronous local React state update, so it is present (or not) by the time the option click resolves.
 * The regex + the conditional confirm are the two live-tunable knobs the operator adjusts on the first real
 * run (OQ-b): if the daemon's affirmative uses vocabulary the regex misses, the click below fails cleanly.
 */
async function answerAllow(dialog: Locator): Promise<void> {
  await dialog
    .getByRole('button', { name: /^(yes|allow|approve|accept|grant)\b/i })
    .first()
    .click()
  const confirm = dialog.getByRole('button', { name: 'Confirm', exact: true })
  if ((await confirm.count()) > 0) await confirm.click()
}

test('real claude relays a per-tool permission modal that answering "allow" clears, completing the turn', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so reruns differ (defeats any accidental reply caching), never asserted on. Engineered
  // to force exactly ONE deterministic, permission-gated tool call — a single file write, no read/list first
  // — so a single `modal_shown` surfaces and the run stays cheap on haiku. The write lands in the daemon's
  // -pyry-workdir (the harness temp workdir). Content is NEVER asserted (Date.now() is fine in a spec).
  const runNonce = Date.now()
  const message =
    `Create a file named ${runNonce}.txt in the current directory whose exact contents are the word ok. ` +
    `Use a single write and do nothing else — do not read or list any files first. run=${runNonce}`

  // --- Precondition (AC1): pair against the real daemon, dial the test relay's /v1/client leg. ---
  // Verbatim from real-claude.spec.ts: the app dials `${relay.url}/v1/client` unchanged (NOT pyry's emitted
  // prod relay); the loopback affordance (#97) accepts the ws://127.0.0.1 relay.
  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const pasteBox = page.locator('textarea[aria-label="Pairing code"]')
  const fingerprint = page.locator('[aria-label="Server key fingerprint"]')
  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  // The single-dialog FIFO surface (PermissionModal): the oldest outstanding prompt renders as one
  // role="dialog"; option / Confirm buttons are scoped inside it.
  const dialog = page.getByRole('dialog')

  await expect(pasteBox).toBeVisible()
  await pasteBox.fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(fingerprint).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  // --- Create the conversation THROUGH THE UI (#448) — the operator flow, not a pre-bound seed. ---
  // The seeded row renders only after the real daemon's `conversations` reply arrives on the connected edge,
  // so its visibility IS the connected gate; only then click the FAB, which fires a real create at the real
  // daemon and navigates on `conversation_created`. Send is enabled once the thread is connected.
  await expect(page.locator('.channel-list__row-open')).toBeVisible({
    timeout: HANDSHAKE_TIMEOUT_MS
  })
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Send the one-tool-call prompt (AC3). ---
  await composer.fill(message)
  await sendButton.click()

  // --- CORE liveness proof (AC3): the real daemon relayed claude's per-tool permission prompt as a
  //     `modal_shown`, and it rendered on the desktop as the answerable dialog. ---
  // This is THE tier-3 assertion. A timeout here is a GENUINE liveness signal — the daemon build under test
  // did not relay the per-tool prompt to the interactive client (it resolved it PTY-side) — not a flake to
  // soften (OQ-a). Note the fixture already suppresses claude's OWN startup dialogs (trust pre-seed +
  // skipDangerousModePermissionPrompt); the per-tool permission prompt is the distinct behavior under test.
  await expect(dialog).toBeVisible({ timeout: MODAL_TIMEOUT_MS })

  // --- Answer "allow" from the desktop (AC4). ---
  await answerAllow(dialog)

  // --- The prompt clears (AC4) — the answer posted, the outstanding prompt left `outstanding[0]`. ---
  await expect(dialog).toHaveCount(0, { timeout: MODAL_TIMEOUT_MS })

  // --- The turn completes (AC4): the claude→daemon→relay→desktop→answer→claude→completion loop closes. ---
  // Effect-observable proof that answering "allow" let the tool run: with a permission-gated tool call,
  // `turn_end` (cursor cleared) can only follow the tool running, which can only follow the allow. A timeout
  // here means the answer never closed the loop (daemon stuck on the permission, or the tool hung) — a
  // genuine red, do NOT soften.
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  // AC4 completion signal — tool EFFECT, not reply content. The permission-gated Write lands its file in the
  // daemon's shared workdir (claude's cwd, exposed by the fixture per #487). The file can only exist if the
  // tool ran, which can only follow the "allow", so its presence is the deterministic proof the answer closed
  // the loop. This supersedes the old nonEmptyAssistantCount text-reply check: the prompt forces a single
  // tool-only turn to keep exactly one modal, and real haiku emits no assistant TEXT on such a turn.
  expect(existsSync(join(daemon.workdir, `${runNonce}.txt`))).toBe(true)
})
