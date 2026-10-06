import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { RateLimitedPayload } from '../src/shared/wire/types'
import {
  USAGE_LIMIT_EXHAUSTED_COPY,
  USAGE_LIMIT_WARNING_COPY
} from '../src/renderer/src/screens/conversation/usageLimitNotice'
import { USAGE_PILL_DISMISS_LABEL } from '../src/renderer/src/screens/conversation/TopOverlay'

// Fake-stack UI e2e for #1321, moved by #1604 — the usage-limit reading appearing, being dismissed,
// returning on a changed reading, escalating and clearing as a pill in the conversation's Top overlay.
// These are TRANSITIONS and clicks, which is why they live here and not in vitest: this repo's renderer
// specs are static server renders (`environment: 'node'`, no DOM, no effects), so the copy and the markup
// are pinned there and only the movement between states is this spec's.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. Every
// frame is `rate_limited` and the daemon sends them UNSOLICITED — its producer emits on any non-benign
// status, and has committed to the benign one as the window's clean clear. Only their TIMING is this
// test's. The frames name `SEEDED_ROW.id` because the fixture navigates by clicking that single seeded
// row, so it is the open conversation for the whole drive, and the reading is conversation-scoped.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, classes,
// counts and boxes. The statuses, the limit types and the reset instant are non-secret display inputs;
// the pairing plumbing lives in launchPairedApp and is never echoed. No failure diagnostic serialises a
// token, a key or plaintext. Nothing on this path is logged by production either.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// A FIXED far-future instant (2100-01-01T00:00:00Z) rather than a computed one, for that same convention,
// and it is what keeps every step of this drive inside the window `selectUsageLimitFor` reads: a reading
// is unreadable AT `resets_at` and after it, so a near instant would expire mid-drive and the row would
// empty for a reason no assertion here names. Its FORMATTED form is deliberately never asserted — the
// formatter uses local getters, so the exact characters depend on the runner's time zone, and they are
// pinned in `usageLimitNotice.test.ts` against locally-constructed moments instead.
const FAR_FUTURE_RESET = 4_102_444_800

// The app's own documented minimum (src/main/index.ts's `minWidth`). At the 1100 launch width the pane is
// 640px and the longest reading this drive produces fits on one line, so the wrap is asserted here, at the
// floor, where the pane is narrower than that reading.
const NARROW_WIDTH_PX = 800
const NARROW_HEIGHT_PX = 600

// A second far-future instant one hour later: the same status and window with a CHANGED reset time, which
// is exactly the change that must bring a dismissed pill back.
const LATER_RESET = FAR_FUTURE_RESET + 3600

// `truncated_fields: null` is a VALUE meaning nothing was cut, not an absence — the Go field has no
// `omitempty`, so the key is always on the wire and `parseRateLimitedPayload` fails closed without it.
function rateLimitedFrame(status: string, limitType: string, resetsAt: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'rate_limited',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      status,
      limit_type: limitType,
      resets_at: resetsAt,
      truncated_fields: null
    } satisfies RateLimitedPayload
  })
}

test('top overlay: the usage pill warns, dismisses, returns on a changed reading, escalates and clears (#1604)', async ({
  launchPairedApp
}) => {
  const { page, app, daemon } = await launchPairedApp({})

  const area = page.locator('.conversation__message-area')
  const overlay = page.locator('.conversation__top-overlay')
  const pill = overlay.locator('.top-overlay-pill')
  const warning = overlay.locator('.top-overlay-pill--default')
  const exhausted = overlay.locator('.top-overlay-pill--error')
  const dismiss = page.getByRole('button', { name: USAGE_PILL_DISMISS_LABEL, exact: true })

  // The overlay renders NO element at launch — most conversations never carry a reading. Asserted after a
  // positive wait on the message area, so it cannot pass merely because the screen had not mounted.
  await expect(area).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(overlay).toHaveCount(0)
  // And the composer slot never holds the reading any more.
  const slotNotice = page.locator('.composer-status').getByText(USAGE_LIMIT_WARNING_COPY)

  // --- `allowed_warning`, the one status ever captured live, is the Default pill with an X.
  daemon.pushFrame(rateLimitedFrame('allowed_warning', 'seven_day', FAR_FUTURE_RESET))
  await expect(warning).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(warning).toContainText(USAGE_LIMIT_WARNING_COPY)
  await expect(warning).toContainText('7-day window')
  await expect(dismiss).toHaveCount(1)
  await expect(slotNotice).toHaveCount(0)

  // --- The wrap, at the app's own minimum window. The pill's text wraps and stays inside the message area
  // rather than truncating or spilling: taller than one line, right edge within the area, no overflow.
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width: NARROW_WIDTH_PX, height: NARROW_HEIGHT_PX }
  )
  const oneLinePx = await warning.evaluate((el) => {
    const style = getComputedStyle(el)
    return parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
  })
  await expect.poll(async () => (await warning.boundingBox())?.height ?? 0).toBeGreaterThan(oneLinePx)
  const areaBox = await area.boundingBox()
  const pillBox = await warning.boundingBox()
  expect(areaBox).not.toBeNull()
  expect(pillBox).not.toBeNull()
  if (areaBox !== null && pillBox !== null) {
    expect(pillBox.x).toBeGreaterThanOrEqual(areaBox.x)
    expect(Math.round(pillBox.x + pillBox.width)).toBeLessThanOrEqual(Math.round(areaBox.x + areaBox.width))
  }
  // Pills float over the full-pane timeline below the actual occupied header.
  await expect.poll(() => warning.evaluate(el => {
    const header = document.querySelector('.conversation__top-chrome')!.getBoundingClientRect()
    const pane = document.querySelector('.conversation__message-area')!.getBoundingClientRect()
    const pill = el.getBoundingClientRect()
    return { belowHeader: Math.round(pill.top - header.bottom), rightInset: Math.round(pane.right - pill.right) }
  })).toEqual({ belowHeader: 12, rightInset: 20 })
  // Wrapped, not clipped: the text box holds all of its content.
  expect(await warning.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(
    await page.evaluate(() => {
      const el = document.querySelector('.conversation')
      return el === null ? null : el.scrollWidth - el.clientWidth
    })
  ).toBeLessThanOrEqual(0)
  await page.screenshot({ path: test.info().outputPath('top-overlay-usage-800.png') })

  // --- The X hides it, and the same reading arriving again keeps it hidden.
  await dismiss.click()
  await expect(overlay).toHaveCount(0)
  daemon.pushFrame(rateLimitedFrame('allowed_warning', 'seven_day', FAR_FUTURE_RESET))
  // An absence has no event to wait on, so the relay round trip gets a short settle (this suite's
  // attachment specs' idiom). The equality itself is pinned field by field in `usageLimitNotice.test.ts`;
  // what this step adds is that a re-sent identical reading reaches the store and still stays hidden.
  await page.waitForTimeout(500)
  await expect(overlay).toHaveCount(0)

  // --- A changed reset time is a new reading: the pill returns.
  daemon.pushFrame(rateLimitedFrame('allowed_warning', 'seven_day', LATER_RESET))
  await expect(warning).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- `rejected` is the Error pill with the exhausted lead and no X.
  daemon.pushFrame(rateLimitedFrame('rejected', 'five_hour', FAR_FUTURE_RESET))
  await expect(exhausted).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(exhausted).toContainText(USAGE_LIMIT_EXHAUSTED_COPY)
  await expect(exhausted).toContainText('5-hour window')
  await expect(warning).toHaveCount(0)
  await expect(dismiss).toHaveCount(0)
  await expect(pill).toHaveCount(1)

  // --- `allowed` is the benign status and the wire's one clean clear: the overlay leaves the tree.
  daemon.pushFrame(rateLimitedFrame('allowed', 'five_hour', FAR_FUTURE_RESET))
  await expect(overlay).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // The shipped 800px floor is unchanged, so every measurement above was taken at it.
  const [minWidth] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMinimumSize()
  )
  expect(minWidth).toBe(NARROW_WIDTH_PX)
})
