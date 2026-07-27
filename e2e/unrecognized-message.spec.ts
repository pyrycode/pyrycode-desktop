import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { UnrecognizedMessagePayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for the unrecognized-message row: a diagnostic the daemon pushes when its stream
// parser meets claude output it has no mapping for. It drives the whole client path — Noise wire →
// decode → IPC → bridge → reducer → row — on the launchPairedApp fixture, then exercises the one thing
// the unit tests structurally cannot: the expand-and-collapse interaction.
//
// WHY THE INTERACTION NEEDS A REAL BROWSER. The row holds its open/closed state in a component-local
// useState (ADR 0006), so renderToStaticMarkup only ever sees it collapsed. The unit tests therefore
// pin the collapsed markup and that the payload is ABSENT from the DOM until asked for; only a real
// DOM can prove it opens, and opens on the keyboard as well as the mouse.
//
// IT IS A SERVER PUSH, like `stall`. The daemon emits it unsolicited when it meets output it cannot
// map — nothing the client sent provokes it — so it is delivered via daemon.pushFrame, never bundled
// onto the reply frames of an inbound the app just sent.
//
// SECRET HYGIENE (carried from the sibling specs): every assertion reads DOM text, attributes, and
// class locators only. SEEDED_ROW.id and the invented message type are non-secret display/routing
// literals; the pairing plumbing lives in launchPairedApp and is never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process, so a short headroom
// over Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness).
const PUSH_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// A distinctive, non-secret needle inside the raw payload. It must NOT appear in the collapsed row —
// that absence is the assertion that the payload is genuinely withheld rather than merely hidden — and
// must appear once expanded.
const RAW_NEEDLE = 'needle-inside-the-raw-payload'

const UNRECOGNIZED: UnrecognizedMessagePayload = {
  conversation_id: SEEDED_ROW.id,
  site: 'line_type',
  message_type: 'some_future_event',
  raw: `{"type":"some_future_event","detail":"${RAW_NEEDLE}"}`,
  truncated: false
}

// A second frame, on the other interesting shape: a payload the daemon had to cut, whose `site` read no
// type at all. It exercises the empty-message_type slot and the truncation note together.
const UNRECOGNIZED_TRUNCATED: UnrecognizedMessagePayload = {
  conversation_id: SEEDED_ROW.id,
  site: 'undecodable',
  message_type: '',
  raw: '{"type":"assist',
  truncated: true
}

// Client-owned copy, duplicated here rather than imported: the renderer bundle is not importable from a
// Playwright spec, and pinning the literal is the point — a silent copy change should fail this.
const UNRECOGNIZED_COPY = 'Unrecognized message'
const TRUNCATED_COPY = 'Payload truncated by the daemon.'

/** One unsolicited `unrecognized_message` frame, sealed via the production encoder. */
function unrecognizedFrame(payload: UnrecognizedMessagePayload): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'unrecognized_message',
    ts: FIXED_TS,
    payload
  })
}

test('unrecognized-message row: pushed, collapsed, expands on click and on Enter', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // --- The push lands as a collapsed row.
  daemon.pushFrame(unrecognizedFrame(UNRECOGNIZED))

  const row = page.locator('.unrecognized-row').first()
  await expect(row).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  const summary = row.locator('.unrecognized-row__summary')
  await expect(summary).toContainText(UNRECOGNIZED_COPY)
  await expect(summary).toContainText('some_future_event')
  await expect(summary).toContainText('whole message')

  // A real button, closed at rest — so keyboard and screen-reader support come for free.
  await expect(summary).toHaveAttribute('aria-expanded', 'false')

  // The payload is genuinely absent, not merely hidden by CSS.
  await expect(row.locator('.unrecognized-row__raw')).toHaveCount(0)
  await expect(row).not.toContainText(RAW_NEEDLE)

  // --- It expands in place on click, showing the raw JSON.
  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  const raw = row.locator('.unrecognized-row__raw')
  await expect(raw).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(raw).toContainText(RAW_NEEDLE)

  // --- And collapses again on a second click, withdrawing the payload from the DOM.
  await summary.click()
  await expect(summary).toHaveAttribute('aria-expanded', 'false')
  await expect(row.locator('.unrecognized-row__raw')).toHaveCount(0)

  // --- The keyboard path. Focusing the button and pressing Enter must do exactly what the click did;
  // this is the assertion that would fail had the row been a div with an onClick.
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await expect(row.locator('.unrecognized-row__raw')).toContainText(RAW_NEEDLE)

  // --- A second, differently-shaped frame: truncated payload, no readable type.
  daemon.pushFrame(unrecognizedFrame(UNRECOGNIZED_TRUNCATED))

  // Two frames, two rows — repeats are never coalesced, because how often this fires is the number
  // that tells an operator to go fix something.
  await expect(page.locator('.unrecognized-row')).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })

  const second = page.locator('.unrecognized-row').nth(1)
  const secondSummary = second.locator('.unrecognized-row__summary')
  await expect(secondSummary).toContainText('could not be decoded')
  // No type was ever read, so the slot is omitted rather than rendered empty.
  await expect(second.locator('.unrecognized-row__type')).toHaveCount(0)

  // The truncation note appears only once expanded, and only for a payload that was actually cut.
  await expect(second).not.toContainText(TRUNCATED_COPY)
  await secondSummary.click()
  await expect(second.locator('.unrecognized-row__truncated')).toContainText(TRUNCATED_COPY)

  // The two rows open independently — the state is per-row component-local, not shared.
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
})
