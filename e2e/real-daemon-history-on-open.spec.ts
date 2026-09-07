import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// #1259 — the opening history ask, against the daemon that PUBLISHES the verb rather than a fake that
// answers anything. The fake-tier twin (`e2e/history-on-open.spec.ts`) proves the client draws a page it
// is served; this proves the client's `request_history` is a frame the real `pyry` accepts, answers with
// a `history_page`, and fills from its own on-disk log. That is the #949 shape this tier exists for: a
// daemon can define a type and register no handler, the real wire answers `unsupported`, and every fake
// spec stays green.
//
// WHY IT SPAWNS CLAUDE despite the `real-daemon-` prefix. The prefix names the SUBJECT — the daemon's
// history verb — and both prefixes run in the same credentialed tier (both Playwright configs key on
// `real-` alone). A claude child is needed for one reason only: the marker has to be IN the log for the
// ask to have an answer, and the only route by which this client writes to a conversation's log is a
// real `send_message`, which the daemon accepts against a live session. Nothing here asserts on claude's
// reply — the turn is waited out solely as the barrier proving the daemon finished with the send.
//
// THE ARCHIVE ROUND TRIP IS THE MECHANISM, and it is doing one job: emptying the client's retained
// timeline for this conversation without ending the pairing. Archiving the ACTIVE conversation routes
// through `exitActiveConversation`, whose `clearTimelineFor` drops that conversation's held slice — and
// with it, since #1259, the record that it had already asked. So the re-open below is a FIRST opening as
// far as the client is concerned: it asks again, and the marker can reach the thread by no other route.
// The `.conversation` 1→0 delta is the observable that the exit actually ran, which is what keeps the
// final assertion from passing against a slice that was never cleared. Every step of the archive →
// restore → re-open drive is transplanted from `real-daemon-conversation-lifecycle.spec.ts`, which
// proves the same sequence against a real daemon today.
//
// WHY THE SEEDED ROW rather than a FAB-minted one: with one conversation in the list,
// `.channel-list__row-open` is unambiguous at both openings. The fixture's seed is a plain-UUID
// conversation the daemon really holds, so the send below is a real send under a real id.
//
// SECRET HYGIENE: the pairing payload is filled by `pairFromUnpairedLaunch` and referenced nowhere else.
// Every assertion reads DOM text, visibility or a count; no cursor, token or payload value is
// interpolated into an assertion message or a test title. The `history_page`'s cursor is never observed
// at all — it is opaque, it is not a capability, and this spec has no business reading it.

// Generous, to absorb real daemon startup latency plus a handshake re-dial or two.
const HANDSHAKE_TIMEOUT_MS = 45_000
// One cold claude turn: spawn, model load, first reply.
const TURN_TIMEOUT_MS = 120_000
// A registry round trip (archive / restore / re-list). No claude turn to absorb.
const ROUNDTRIP_TIMEOUT_MS = 15_000
// Handshake + one turn + four registry round trips + the history round trip + headroom.
const SPEC_TIMEOUT_MS = 300_000

// turn_end appends a turn boundary that drops the streaming cursor — its absence is the quiesce signal.
const CURSOR_SELECTOR = '.bubble__cursor'

test('a real daemon answers the opening history ask and the thread reopens holding it', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so a rerun cannot pass on a previous run's row, and so the marker cannot collide
  // with anything claude happens to say. Never asserted on as a value of its own.
  const marker = `history marker ${Date.now()}`

  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    // The app dials this verbatim; NOT pyry's emitted relay (which points at prod). The loopback
    // affordance (#97) accepts the ws://127.0.0.1 relay.
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const conversation = page.locator('.conversation')
  const row = page.locator('.channel-list__row-open')
  const composer = page.getByPlaceholder('Message…')
  const sendButton = page.getByRole('button', { name: 'Send' })
  // The marker as the operator's own row. Scoped to the chat pane so the sidebar's last-message preview
  // — which also carries this text once the daemon has the message — can never satisfy it.
  const markerBubble = conversation.locator('.bubble[data-thread-role="user"]', { hasText: marker })

  await pairFromUnpairedLaunch(page, payload)

  // --- Readiness gate: the promoted seed's Rename pencil renders only after the whole chain — handshake
  // complete → session `connected` → the auto-fired `list_conversations` returned the seeded row → it
  // rendered. The real-daemon path lands on the list, with no opening thread. ---
  await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- First opening. This ALREADY fires a `request_history`, which the daemon answers with an empty
  // page: the conversation's log holds nothing yet. Nothing is asserted about that here — an empty page
  // and a refusal draw the same nothing, which is exactly why the proof has to be the refill below. ---
  await row.click()
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Put the marker in the daemon's log. The bubble that appears here is the composer's OPTIMISTIC
  // echo, not a replay — it proves only that the send left. ---
  await composer.fill(marker)
  await sendButton.click()
  await expect(markerBubble).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // Wait the turn out. The operator message is appended on receipt rather than on completion, so this is
  // a barrier and not a dependency: once the turn has quiesced the daemon has certainly finished with it.
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  // --- Empty the client's retained timeline WITHOUT ending the pairing. Archiving the active
  // conversation exits it, and the exit clears its held slice. ---
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  // The non-vacuity anchor: the thread surface is HERE before the confirming click — the Channel Info
  // sheet renders inside ConversationScreen — so the 1→0 delta below is a transition this click caused.
  await expect(conversation).toHaveCount(1)
  // SCOPED to the chat pane: the two-pane shell keeps the Channel List mounted beside the thread and its
  // top-right entry is also `aria-label="Archive"`, so an unscoped exact-name query matches two buttons.
  await conversation.getByRole('button', { name: 'Archive', exact: true }).click()
  // The app returns to the Channel List on the daemon's confirmation, with no manual Back click. THIS
  // delta is the proof that `exitActiveConversation` ran — and therefore that the timeline this spec is
  // about to re-fill was dropped rather than merely navigated away from.
  await expect(conversation).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- Restore it. The seed is PROMOTED, so it lands in the Archive view's Channels tab. ---
  await page.locator('.channel-list__archive').click()
  const channelsTab = page.getByRole('tab', { name: 'Channels (1)', exact: true })
  await expect(channelsTab).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await channelsTab.click()
  await page.locator('.archive__restore').click()
  await expect(page.getByRole('tab', { name: 'Channels (0)', exact: true })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await page.locator('.archive__back').click()

  // --- The second opening, and the whole point. The client holds nothing for this conversation, so it
  // asks again; the marker is in the daemon's log; and it can reach this thread by no other route —
  // nothing was sent, nothing streamed, and the optimistic echo died with the slice. ---
  await row.click()
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(markerBubble).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
})
