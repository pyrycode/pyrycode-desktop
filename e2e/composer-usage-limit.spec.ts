import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { RateLimitedPayload } from '../src/shared/wire/types'
import {
  USAGE_LIMIT_EXHAUSTED_COPY,
  USAGE_LIMIT_WARNING_COPY
} from '../src/renderer/src/screens/conversation/usageLimitNotice'

// Fake-stack UI e2e for #1321 — the usage-limit notice appearing, changing treatment, and clearing in the
// composer status row's trailing slot. These are TRANSITIONS, which is why they live here and not in
// vitest: this repo's renderer specs are static server renders (`environment: 'node'`, no DOM, no
// effects), so the copy and the markup are pinned there and only the movement between states is this
// spec's.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. All
// three frames are `rate_limited` and the daemon sends them UNSOLICITED — its producer emits on any
// non-benign status, and has committed to the benign one as the window's clean clear. Only their TIMING
// is this test's. The frames name `SEEDED_ROW.id` because the fixture navigates by clicking that single
// seeded row, so it is the open conversation for the whole drive, and the reading is conversation-scoped.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, classes and
// counts. The statuses, the limit types and the reset instant are non-secret display inputs; the pairing
// plumbing lives in launchPairedApp and is never echoed. No failure diagnostic serialises a token, a key
// or plaintext. Nothing on this path is logged by production either — see `usageLimitNotice`'s header.

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

// The app's own documented minimum (src/main/index.ts's `minWidth`), and the width every geometry
// assertion below is taken at — e2e/composer-footer-overflow.spec.ts's floor and its reason verbatim. The
// LAUNCH width is where this row's overflow HIDES: the conversation pane is 640px there and the widest
// notice this drive can produce is under 410, so a fit assertion taken at launch passes on a row that
// spills 79px at the shipped minimum. The drive narrows TO the floor rather than past it, so
// `setMinimumSize` is never called and there is nothing to restore.
const NARROW_WIDTH_PX = 800
const NARROW_HEIGHT_PX = 600

// The turning brand mark's own width (Figma 112:3530's 14x15.97 vector, `.composer-status__icon`). The
// status group holding LESS than this is the group annihilated rather than compressed — the failure mode
// the shipped `flex: 0 0 auto` produced, where the notice took none of the squeeze, the group went to zero
// and the row overflowed anyway.
const BRAND_MARK_PX = 14

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

test('composer status row: the usage-limit notice warns, escalates and clears (AC5)', async ({
  launchPairedApp
}) => {
  const { page, app, daemon } = await launchPairedApp({})

  const statusRow = page.locator('.composer-status')
  const activity = page.locator('.composer-status__activity')
  const notice = page.locator('.composer-status__usage')
  const warning = page.locator('.composer-status__usage--warning')
  const exhausted = page.locator('.composer-status__usage--exhausted')

  // `.composer-status` declares only a min-height, so its height is whatever its occupant makes it —
  // which is why #963's 32-tall button grows the row and #797's 24-tall chip does not. Read at each step
  // rather than once at the end, so "the row does not move across the transition" is a comparison rather
  // than a single reading.
  const rowHeight = async (): Promise<number | undefined> =>
    (await statusRow.boundingBox())?.height

  // How far past its own box the ROW's content reaches — the detector, and it is the row rather than
  // `.conversation` deliberately. `.composer-status` is the box the occupants are laid out in, so it is
  // where a non-shrinking occupant first spills; the pane reports the same number one level up only
  // because nothing between them clips. Zero or less is the fix. A single scalar per checkpoint, so a poll
  // cannot settle on a frame where one of two reads is stale.
  const rowOverflowPx = (): Promise<number> =>
    statusRow.evaluate((el) => el.scrollWidth - el.clientWidth)

  // The slot is empty at launch — the daemon emits only on a non-benign window, so most conversations
  // never carry a reading and this is the overwhelmingly common state. It is asserted AFTER a positive
  // wait on the row itself, so it cannot pass merely because the composer had not mounted yet.
  await expect(statusRow).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(notice).toHaveCount(0)

  // --- AC2 through the wire. `allowed_warning` is the ONE non-benign status ever captured live
  // (2026-08-22, claude 2.1.239, `limit_type: seven_day`), in a band where every turn still ran normally.
  // It takes the warning treatment and the warning lead, and specifically NOT the exhausted one: the
  // whole point of the two-lead design is that an unmeasured status never claims the operator is blocked.
  daemon.pushFrame(rateLimitedFrame('allowed_warning', 'seven_day', FAR_FUTURE_RESET))
  await expect(warning).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(warning).toContainText(USAGE_LIMIT_WARNING_COPY)
  await expect(warning).toContainText('7-day window')
  await expect(exhausted).toHaveCount(0)
  const warningRowHeight = await rowHeight()

  // --- The row's geometry, AT THE APP'S OWN MINIMUM WINDOW and with the WIDEST reading this drive can
  // produce up. Both halves of that are load-bearing. `allowed_warning` / `seven_day` is the single
  // combination ever captured live (2026-08-22, claude 2.1.239), a seven-day window always resets on
  // another local day so it always takes the formatter's long form, and that is this notice's longest
  // string — measured wider than the exhausted arm's, because the warning lead is the longer of the two.
  // At the 1100 launch width the conversation pane is 640 and that string fits with room to spare, so a
  // fit assertion taken there is an assertion that cannot fail. ---
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width: NARROW_WIDTH_PX, height: NARROW_HEIGHT_PX }
  )

  // The row's content is inside its box at the documented minimum. Every geometry read polls: layout
  // settles a frame after the window does.
  await expect.poll(() => rowOverflowPx()).toBeLessThanOrEqual(0)

  // And it fits BY COMPRESSING, not because the copy turned out to be short — which is the whole of this
  // block, since the assertion above is one of absence and a row holding nothing satisfies it perfectly.
  // An ellipsized flex item is exactly what reports this. The notice's runs are ordered lead, window,
  // reset, so the ellipsis eats the least important one first and the lead — the only run carrying the
  // operator-facing fact — is the last thing to go.
  expect(await notice.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)

  // The status group is COMPRESSED AND NOT ANNIHILATED. This is the assertion the shipped `flex: 0 0 auto`
  // failed: with the notice refusing every pixel of the squeeze, the group absorbed all of it, went to
  // zero width — taking the turning mark and the activity label off the row entirely — and the row still
  // overflowed. Sharing the squeeze is what leaves the mark drawable.
  expect((await activity.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(BRAND_MARK_PX)

  // The pane, one level up, therefore reports no horizontal overflow either. Kept beside the row's own
  // number rather than in place of it: this is the operator-visible consequence, the row's is the cause.
  expect(
    await page.evaluate(() => {
      const el = document.querySelector('.conversation')
      return el === null ? null : el.scrollWidth - el.clientWidth
    })
  ).toBeLessThanOrEqual(0)

  // --- AC1 through the wire, and the step that makes the one before it falsifiable. `rejected` is the
  // one string that earns the exhausted wording, and a DIFFERENT window rides with it — so an
  // implementation that ignored either field, or that reused the first reading, shows the wrong pair
  // here. The row still holds exactly one occupant across the change.
  daemon.pushFrame(rateLimitedFrame('rejected', 'five_hour', FAR_FUTURE_RESET))
  await expect(exhausted).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(exhausted).toContainText(USAGE_LIMIT_EXHAUSTED_COPY)
  await expect(exhausted).toContainText('5-hour window')
  await expect(warning).toHaveCount(0)
  await expect(notice).toHaveCount(1)

  // The row's HEIGHT, RE-MEASURED with this occupant up rather than carried over from #797's or #963's
  // numbers — the discipline both their stylesheet comments set. The notice wears the chip's box on BOTH
  // arms, differing only in colour, so the row reads 24 and does not move between them: the first reading
  // was taken at the launch width on the warning arm, this one at the 800px floor on the exhausted arm, so
  // the pair also states that compressing the row costs it no height. A wrapped or grown occupant would
  // push the composer down, which is #963's AC3 from the other side.
  expect(warningRowHeight).toBe(24)
  expect(await rowHeight()).toBe(24)

  // And the row still fits on this arm too. Its string is the shorter of the two, so this is the weaker of
  // the two fit assertions and is kept for what it rules out rather than what it proves: a treatment swap
  // that changed the box rather than only its colours.
  await expect.poll(() => rowOverflowPx()).toBeLessThanOrEqual(0)

  // --- AC5's clear, driven end to end through the arm that has no other exit. `allowed` is the benign
  // status: it never reaches the store at all — `subscribeUsageLimit` routes it to `clearUsageLimitFor`
  // instead — so this is the only clean clear the wire offers, and the two steps above are what make this
  // closing absence a mutation check rather than a locator that was empty all launch.
  daemon.pushFrame(rateLimitedFrame('allowed', 'five_hour', FAR_FUTURE_RESET))
  await expect(notice).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // The shipped 800px floor is unchanged: this drive fits the row to the window rather than the window to
  // the row, so a future edit that starts borrowing the minimum the way e2e/composer-options-clamp.spec.ts
  // does would redden here rather than quietly widening the floor every measurement above is taken at.
  const [minWidth] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMinimumSize()
  )
  expect(minWidth).toBe(NARROW_WIDTH_PX)
})
