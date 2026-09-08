import { type Page } from '@playwright/test'
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
// WHY THE ONE REAL TURN IS DRIVEN THROUGH THE SEEDED ROW, and this is the correction the first gate run
// bought (the drive spent its turn on a FAB-created chat and then read a blank label). The apply is gated
// on the remembered level appearing among the levels PUBLISHED for the target chat's model, and the
// daemon builds `model_list` from claude's own `initialize` reply — one exchange per child spawn. A
// never-messaged conversation has no child, so its vocabulary can only come from pyrycode#2124's
// daemon-wide fallback, whose source is `Pool.Default()`: the BOOTSTRAP session's retained list. The
// harness seeds exactly one conversation and binds it to that bootstrap session, while every FAB-created
// conversation gets a dedicated minted session of its own (`create_conversation`'s eager bind). So a turn
// spent in the seeded row is what puts a vocabulary behind the fallback, and a turn spent anywhere else
// leaves the fallback empty and every never-messaged chat without levels. That is a property of where the
// turn lands, not of how long the drive waits for it.
//
// AND WHY THAT CHAT'S VOCABULARY IS ASKED FOR RATHER THAN WAITED FOR (#1266, the correction the THIRD
// gate red bought). The client asks for a conversation's model list exactly ONCE PER ACTIVATION —
// `requestConversationConfig` reaching `requestModelList` — and this drive activates the seeded row
// BEFORE turn 1, when the bootstrap session has no claude child and therefore no vocabulary to answer
// with. That ask comes back with nothing. So until #1266 the read below rode entirely on the daemon's
// UNSOLICITED push once the child spawned — a frame `modelListStore`'s header documents as best-effort
// and lossy — landing inside ROUNDTRIP_TIMEOUT_MS. Nothing in the drive caused that frame and nothing
// re-asked: a required precondition was WAITED FOR rather than REQUESTED, and a lost push presented as a
// real turn followed by a timeout wearing a daemon-side diagnostic that was not true (2026-09-07 19:31
// UTC, against the same binary that passed the same spec thirty minutes later and six runs after that).
//
// The re-activation below is the repair, and it is a REQUEST, NEVER A RETRY. `activateConversation` runs
// `requestConversationConfig` OUTSIDE its changed-id gate on purpose, so re-clicking the row already open
// re-fires the ask while the clear branch — timeline reset, session id, run configuration — stays skipped
// by that same gate. A drive-side re-ask LOOP would instead be the self-inflicted spin against a
// withholding relay that `modelListStore`'s header forbids the CLIENT, and a drive that spins where the
// app may not is asserting a behaviour the app does not have. One caused ask, then the ordinary timeout.
//
// The FAB-minted chat further down needs none of this: it is activated AFTER turn 1 has put a vocabulary
// behind the daemon-wide fallback, so its own one-shot ask is answered — request and response, no push.
//
// AND WHY EVERY TURN GATE HERE IS POSITIVE-THEN-MUTATION, AND WHY THE POSITIVE HALF IS BASE-RELATIVE.
// A bare closing `toHaveCount(0)` on the streaming cursor passes before the send's own work has even
// started, because the locator was 0 all launch — the first gate run's whole drive completed in under two
// seconds with no turn in it. So each turn below polls `nonEmptyAssistantCount` UP first
// (real-claude.spec.ts's content-agnostic liveness read, transcribed as the sibling real specs transcribe
// it) and only then waits the cursor back down.
//
// But UP AGAINST WHAT is the second half of that lesson, and it is what the SECOND gate run bought. The
// count is polled against a baseline read immediately before the send, never against a bare `>= 1`.
// real-claude.spec.ts can use `>= 1` for its first turn only because the chat it drives was minted empty
// by the FAB two lines earlier; it switches to base-relative the moment a turn has already landed in that
// thread. This drive's first turn runs in the SEEDED row — a pre-existing daemon conversation whose thread
// this spec never established as empty — so `>= 1` there is satisfiable by whatever the daemon's history
// reply already rendered, and the drive would sail past a send that never produced a turn. That is the same
// vacuous-gate family as the cursor trap, one direction over: an opening absence and an already-satisfied
// presence fail identically, by resolving against state the action did not cause.
//
// REAL-CLAUDE DIVERGENCES from the fake twin (the only deltas — the real-daemon-workspace.spec.ts doc
// discipline):
//   - NO `daemon.pushFrame`: the real daemon owns the turn lifecycle and publishes its own model list.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so the
//     twin's in-process capture and its deep equal on the payload are unavailable. Every assertion here
//     reads DOM text, attributes and counts.
//   - THE LEVEL IS READ, NEVER ASSUMED. Which levels exist is the daemon's to publish, so the level this
//     drive picks is derived from the segments actually rendered — no client-side vocabulary appears in
//     this file, exactly as none appears in the app (#976). It is also addressed BY INDEX into the array
//     already read rather than by a constructed pattern: a daemon-published level is untrusted text and
//     has no business being compiled into a regular expression.
//   - THE PICK GOES THROUGH THE SHEET, not the footer. The footer's effort control draws NOTHING while
//     the session reports no explicit effort, which is the defect this ticket exists to fix and therefore
//     the state the seeded chat is in; `EffortSection` stays operable there. That asymmetry is deliberate
//     on both surfaces (see ComposerEffortMenu's three renderings) and is what makes the first pick
//     possible.
//   - THE PICK IS WAITED OUT TO ITS SETTLE, through #558's `aria-busy` on the effort group. Only a
//     correlated reply clears that marker, so this is the one place in the drive where a daemon reply
//     gates a DOM transition rather than the optimistic overlay — and it is load-bearing rather than
//     tidy: the remembered level is written when the CONFIRM is folded (`foldWriteEvent`), so a drive
//     that switched chats before the settle would clear the pending record, drop the confirm unmatched,
//     remember nothing, and then read a blank label on the next chat for a reason that has nothing to do
//     with the daemon.
//
// ACCEPTED LIMITATION, stated rather than papered over, and it is the same one the sibling real settings
// specs record: `runSettingsWriteStore.confirmed` is an app-level per-field override that outlives the
// post-turn re-read, so the final label is not PROVABLY snapshot-sourced. What the drive does prove is the
// failure this tier exists to catch — a daemon that refuses the change, or drops it for a never-messaged
// conversation, replies with an error, the store drops the pending marker WITHOUT committing an override,
// and the label rolls back to nothing at all.
//
// SECRET HYGIENE: every assertion reads DOM text, an attribute or a count. The pairing payload is built
// the same way as the sibling specs and is never echoed into a message or a failure diagnostic. The
// levels are daemon-published display values, never a token or a key.

// The seeded row is opened and messaged, so it is seeded as a promoted discussion —
// real-daemon-session-settings.spec.ts's reason for the same option, one tier over.
test.use({ seedPromoted: true })

const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold claude (spawn + model load + first reply), the sibling specs' per-turn budget.
const TURN_TIMEOUT_MS = 120_000
// Handshake + 2×turn + a create round trip + the settings round trip + headroom.
const SPEC_TIMEOUT_MS = 360_000
// A settings write and its reply-gated re-render, and since #1266 the model-list ask the drive fires by
// re-activating the seeded row. No claude turn to absorb, so this is tight on purpose — a timeout here
// means the daemon did not answer a request that was made, which is the signal. It is not a window for an
// unsolicited frame to arrive in, and widening it would only lengthen the odds on a push instead.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// The streaming cursor is a child of the assistant bubble; its absence is the per-turn quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'
const CURSOR_CHAR = '▎'
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
const META_SELECTOR = '.bubble__meta'

/**
 * Count assistant rows whose text is non-empty once the streaming cursor ▎ and the meta row are stripped
 * — real-claude.spec.ts's helper, transcribed rather than shared, as every real-* spec that needs it
 * transcribes it. Content-agnostic liveness: a naive "row exists" check would pass on an empty streaming
 * bubble, because both the cursor span and the timestamp live INSIDE the row. The strip runs on a
 * detached copy, so the live DOM the other assertions read is untouched.
 */
function nonEmptyAssistantCount(page: Page): Promise<number> {
  return page.locator(ASSISTANT_ROW).evaluateAll(
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
  const effortGroup = page.locator('.run-config__effort')

  const openRunConfiguration = async (): Promise<void> => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Run configuration' }).click()
  }

  await pairFromUnpairedLaunch(page, payload)

  // --- Precondition: pair, then open the SEEDED row — the one conversation bound to the bootstrap
  // session (see the header). Its rendering is also the connected gate: it appears only once the
  // handshake completed and the auto-fired list_conversations reply came back. ---
  const seededRow = page.locator('.channel-list__row-open')
  await expect(seededRow).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await seededRow.click()
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Turn 1, in the seeded chat: one real turn against the BOOTSTRAP session, which is what puts a
  // vocabulary behind the daemon-wide model-list fallback every never-messaged chat below reads from.
  // Nothing about the reply is asserted beyond its existence. The baseline is read here rather than
  // assumed zero — see the header: this row is pre-existing daemon state, so its thread is not this
  // spec's to declare empty, and only a count that MOVED proves the send produced a turn. ---
  const baseBeforeTurn1 = await nonEmptyAssistantCount(page)
  await composer.fill(message(1))
  await sendButton.click()
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message: 'turn 1: no ADDITIONAL non-empty assistant reply streamed within the timeout'
    })
    .toBeGreaterThan(baseBeforeTurn1)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Now ASK for this chat's vocabulary instead of waiting for the daemon to volunteer it (#1266; the
  // header says why the pre-turn ask could not answer and why this one can). Re-clicking the row already
  // open re-runs `activateConversation`, whose `requestConversationConfig` sits OUTSIDE the changed-id
  // gate, so `request_model_list` goes out again — this time against a bound session whose claude child
  // is live and has already published its `initialize` reply. The same gate skips the clear branch
  // because the id did not change, so the settled turn above and this chat's run configuration survive
  // the click; and the one ask in that set that is NOT idempotent, the opening history page, declines
  // through `requestOpeningHistory`'s own per-conversation gate rather than prepending a second copy.
  //
  // The locator is deliberately left unfiltered: only the seeded conversation exists until the FAB runs
  // below, so Playwright's strict mode is itself the check that this click lands on that row. ---
  await seededRow.click()

  // --- 1. Pick a level here, through the run-configuration sheet. The segments existing at all is itself
  // the proof that the daemon published a row with levels on it for this chat's model — the join #1168
  // widened to the inherited default, exercised against a chat nobody set a model on. ---
  await openRunConfiguration()
  // Named, because this is a DAEMON-side precondition and its failure now has one actionable cause. Since
  // #1266 the ask behind this read is the drive's own, so a timeout here can no longer mean "the push we
  // were hoping for went missing" — it means a request went out against a session with a live child and
  // came back with no vocabulary, which is the daemon's answer and not a race. The message is what keeps
  // that from presenting as an anonymous timeout three assertions later, and what stops a lost push from
  // ever wearing this diagnostic again. No skip and no soft-pass: a daemon that publishes nothing fails
  // the spec right here.
  await expect(
    segment.first(),
    'the seeded chat published no effort levels within the round trip — the drive re-activated this row ' +
      'immediately above, which re-sent `request_model_list` for it AFTER its bound session had spawned ' +
      'a claude child, and no vocabulary came back to pick from. The ask was MADE and went unanswered, ' +
      'so this is a daemon-side precondition rather than a lost unsolicited push (#1266): check that the ' +
      'installed `pyry` serves `request_model_list` and retains the bootstrap session’s list before ' +
      'reading this as a defect in the feature under test.'
  ).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  const published = (await segment.allInnerTexts()).map((text) => text.trim())
  // `aria-current` sits ON the segment (it is both the a11y marker and the CSS selection hook), so the
  // marked set is a filtered selector rather than a descendant match.
  const marked = (
    await page.locator('.run-config__effort-segment[aria-current="true"]').allInnerTexts()
  ).map((text) => text.trim())
  // Pick one the session is NOT already running, so the assertions below are falsifiable: a change to the
  // level already in force would pass whether or not the daemon did anything at all. A chat nobody has
  // set a level on marks nothing, which is the ordinary case here and leaves every level eligible.
  const pickedIndex = published.findIndex((level) => !marked.includes(level))
  expect(
    pickedIndex,
    `no unselected level among ${published.length} published, ${marked.length} marked`
  ).toBeGreaterThanOrEqual(0)
  const picked = published[pickedIndex]

  await segment.nth(pickedIndex).click()

  // The change SETTLES: only a correlated reply deletes the pending marker that raises #558's aria-busy,
  // so a daemon that loses the write times out right here rather than passing on the optimistic overlay.
  // Reaching this line is also what guarantees the confirm was FOLDED — and the fold is what writes the
  // remembered level the rest of the drive depends on.
  await expect(effortGroup).not.toHaveAttribute('aria-busy', 'true', {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  // Settled AND still holding, which is what distinguishes a confirm from a rejection: a rejection also
  // clears the busy flag, but rolls the value back and raises the sheet's role="alert" line. A sequence,
  // never one composed poll — two reads inside a single poll are not atomic.
  await expect(segment.nth(pickedIndex)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.run-config__error')).toHaveCount(0)

  await page.getByRole('button', { name: 'Close' }).click()
  await expect(label).toHaveText(picked, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 2. Mint a chat through the FAB and send NOTHING. It has a session bound at creation and no claude
  // child, which is exactly the state this ticket's write has to survive. The empty thread is what proves
  // the app actually navigated: the seeded chat it came from holds a settled exchange, so this count can
  // only be reached by arriving somewhere else. ---
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect(page.locator('.bubble')).toHaveCount(0, { timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // The new chat's own levels, from the daemon-wide fallback — the apply's last precondition, asserted
  // separately so a daemon that publishes nothing for a childless conversation fails HERE, saying so,
  // rather than as a blank label three assertions later that could mean anything.
  await openRunConfiguration()
  await expect(segment.first()).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await page.getByRole('button', { name: 'Close' }).click()

  // --- 3. AC5's first half, and AC1 over the real wire: the remembered level is applied to a chat that
  // reports none, BEFORE its first message, so the footer names it on a chat that has never had a turn.
  // This also proves the premise the design rests on — a never-messaged conversation is addressable —
  // because the apply is gated on an addressable session id and would be silently inert without one. ---
  await expect(label).toHaveText(picked, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 4. Its first turn. This is where the daemon materialises the child, and where a setting that was
  // accepted-then-dropped would show itself. ---
  await composer.fill(message(2))
  await sendButton.click()
  // `>= 1` is sound HERE and only here: this chat was minted by the FAB and its thread was asserted empty
  // above, so the baseline is established rather than assumed — real-claude.spec.ts's own condition for
  // the same shape.
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message: 'turn 2: no non-empty assistant reply streamed within the timeout'
    })
    .toBeGreaterThanOrEqual(1)
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- 5. AC5's second half. The chat still reports the level once the first turn has ended... ---
  await expect(label).toHaveText(picked, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)

  // ...and the level never travelled as a message. The positive count comes FIRST so the absence below is
  // asserted against a thread that provably rendered: one user turn and one assistant reply.
  await expect(page.locator('.bubble')).toHaveCount(2, { timeout: TURN_TIMEOUT_MS })
  // `hasText` is a case-insensitive substring match, which is exactly what is wanted here — any slash
  // line naming this setting, however it were phrased, would be caught.
  await expect(page.locator('.bubble', { hasText: '/effort' })).toHaveCount(0)
})
