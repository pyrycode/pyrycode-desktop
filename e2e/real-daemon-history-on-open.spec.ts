import { type Page } from '@playwright/test'
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

// THE SEED MUST BE PROMOTED, and the first gate run is what bought this line: without it the fixture's
// `seedPromoted` default of `false` seeds a Recent discussion, which renders `.channel-list__save` in the
// Chats section and NEVER the Rename pencil — so the readiness gate below timed out at 45s before a
// single step of the drive ran. Two later steps depend on it too: the Archive view sorts a promoted row
// into the Channels tab (`partitionArchived` splits by `is_promoted`), which is the tab this spec counts
// 1→0 across the restore. Every sibling real-* spec that opens the seed declares the same option
// (`real-daemon-conversation-lifecycle.spec.ts`, `real-daemon-session-settings.spec.ts`,
// `real-claude-effort-default.spec.ts`), and nothing in this repo typechecks or lints a missing one:
// `test.use` is additive, so its ABSENCE is silently the default, and the whole tier is gated out of the
// fake Playwright config. The detector is the gate run itself, which is why the affordance the gate keys
// on is named in the comment beside it rather than left implicit.
test.use({ seedPromoted: true })

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
const CURSOR_CHAR = '▎'
const ASSISTANT_ROW = '[data-thread-role="assistant"]'
const META_SELECTOR = '.bubble__meta'

/**
 * Count assistant rows whose text is non-empty once the streaming cursor ▎ and the meta row are stripped
 * — `real-claude.spec.ts`'s content-agnostic liveness read, transcribed rather than shared, as every
 * real-* spec that needs it transcribes it. A naive "row exists" check would pass on an empty streaming
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
  // The marker as the operator's own REPLAYED row, and the closing proof — read once, after the re-open.
  // Scoped to the chat pane so the sidebar's last-message preview — which also carries this text once the
  // daemon has the message — can never satisfy it, and to `.bubble` so a queued backlog row (which
  // renders this same text beside a Drop control, outside the thread) cannot either.
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

  // --- Put the marker in the daemon's log, and wait the turn OUT rather than reading the composer's own
  // optimistic echo. The first gate run's claude-less rehearsal is what bought this shape: a send issued
  // while the bound session already reports a running turn is QUEUED, so it renders as a backlog row with
  // a Drop control and never becomes a `.bubble` at all — an optimistic-echo assertion is therefore a
  // statement about the session's turn state at click time, which this spec neither controls nor cares
  // about. The completed ASSISTANT TURN is the barrier that holds either way: a reply exists only if the
  // message reached claude, and it reached claude only through the log this spec is about to re-read.
  //
  // AND IT IS BASE-RELATIVE, never a bare `>= 1`. This is the pre-existing seeded row, not a FAB-minted
  // empty chat, and the opening ask above may itself have drawn assistant rows out of history — so a
  // count polled against zero is satisfiable by state this send did not cause, and the drive would sail
  // past a send that produced no turn. Only a count that MOVED proves the turn happened. The cursor then
  // comes back down: positive first, absence second, the sibling real-* idiom.
  const baseBeforeTurn = await nonEmptyAssistantCount(page)
  await composer.fill(marker)
  await sendButton.click()
  await expect
    .poll(() => nonEmptyAssistantCount(page), {
      timeout: TURN_TIMEOUT_MS,
      message:
        'no ADDITIONAL non-empty assistant reply streamed within the timeout — the marker send produced ' +
        'no turn, so nothing was appended to the log this spec re-reads. Check the daemon and the ' +
        'credential before reading it as a defect in the history ask.'
    })
    .toBeGreaterThan(baseBeforeTurn)
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
