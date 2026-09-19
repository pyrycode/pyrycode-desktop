import type { Locator, Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  ConversationSummary,
  ConversationsPayload,
  SendMessagePayload,
  TurnEndPayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1444 — THE CHAT CARD TAKES ITS DRAWN TOP BAR AND INSET (Figma `Content`
// 106:3321 and its `Top bar` 497:1891). The chat-side sibling of e2e/sidebar-tree-geometry.spec.ts, which
// owns the same change on the other card (#1443).
//
// ONLY THIS TIER CAN SEE IT. vitest.config.ts sets `environment: 'node'` and every renderer spec is a
// `renderToStaticMarkup` string assertion, so there is no layout engine to measure a box with and no
// computed style to read. The whole criterion set is geometry and paint.
//
// A SIBLING RATHER THAN AN EXTENSION of e2e/paired-shell-card.spec.ts. That file owns the card's own
// definition — the wash, the radius, the shell inset — in one continuous drive that twelve unrelated
// assertions ride on; threading a bar audit and a menu dismissal through it would fight that structure.
// Its rectOf / wholePixels / tokenColor helpers are borrowed verbatim below, which is the convention in
// this family (each spec pays its own launch and carries its own copies).
//
// The updated Figma variables resolve the title to On Primary Container and the divider to
// Inverse Primary. The existing ellipsis keeps Primary. Probe the app's matching tokens separately.
//
// SECRET HYGIENE (the sibling specs' posture, carried verbatim): every assertion reads geometry, a
// computed style or an element count. The prompt and reply texts, the conversation_id and the turn ids
// are non-secret display and routing literals; the pairing plumbing lives in launchPairedApp and is never
// echoed. No failure diagnostic serialises a token, a key or any plaintext.

// Updated Top bar: a 28px content row, 16px divider gap and 16px bottom padding.
// The containing card and message-area insets remain unchanged.
const CARD_TOP_PX = 24
const CARD_SIDE_PX = 20
const CARD_BOTTOM_PX = 16
const CARD_GAP_PX = 12
const BUTTON_PX = 24
const CONTENT_ROW_PX = 28
const RULE_GAP_PX = 16
const RULE_HEIGHT_PX = 1
const BAR_BOTTOM_PX = 16
const ROW_GAP_PX = 16

// The first message still starts 97px below the card top.
const FIRST_ROW_TOP_PX =
  CARD_TOP_PX + CONTENT_ROW_PX + RULE_GAP_PX + RULE_HEIGHT_PX + BAR_BOTTOM_PX + CARD_GAP_PX

const PRIMARY_TOKEN = '--color-primary'
const RULE_OPACITY = '0.6'

// The primer's reply travels a real send -> Noise -> decode -> render round-trip; generous headroom for a
// cold runner (the siblings' value).
const STREAM_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushes by envelope id, so one fixed id is reused across every frame.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// Separate TURNS rather than newlines inside one delta, because same-turn deltas coalesce into a single
// bubble (threadTimeline.appendDelta) and this spec needs DISTINCT rows to measure the 16px between. 20 is
// thread-scroll-pin.spec.ts's own count, sized to overflow the 1100x800 window — which the scroll block
// below needs and asserts before it relies on it.
const REPLY_TURNS = 20
const replyText = (turn: number): string => `Streamed reply line ${turn}`
const PRIMER_TEXT = 'prime the thread past its viewport'

// --- Spec-local frame builders (the seedConversationsFrame idiom, copied from thread-scrollbar.spec.ts):
// each seals one envelope through the production codec with a deterministic id/ts. ---

const assistantDeltaFrame = (turn: number): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'assistant_delta',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: `turn-${turn}`,
      seq: 0,
      text: replyText(turn)
    } satisfies AssistantDeltaPayload
  })

const turnEndFrame = (turn: number): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_end',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: `turn-${turn}`,
      stop_reason: 'end_turn'
    } satisfies TurnEndPayload
  })

/** The turn's terminal phase — faithful, and the settle gate: without it the composer's own local accept
 *  leaves the working indicator mounted and the layout still in motion when the offsets are read. */
const turnStateFrame = (state: WireTurnState): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })

/** One buildReplyFrames dispatching on the decoded inbound type — the siblings' shape, including the #448
 *  guard that replies only for the OPENED row's id. */
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  switch (envelope.type) {
    case 'send_message': {
      const payload = envelope.payload as SendMessagePayload
      if (payload.conversation_id !== SEEDED_ROW.id) return []
      if (payload.text !== PRIMER_TEXT) return []
      return [
        ...Array.from({ length: REPLY_TURNS }, (_, index) => [
          assistantDeltaFrame(index + 1),
          turnEndFrame(index + 1)
        ]).flat(),
        turnStateFrame('idle')
      ]
    }
    default:
      return [seedConversationsFrame()]
  }
}

// composer-options-clamp.spec.ts's helper verbatim: `Math.round` of a tiny negative delta is `-0`, and
// `toBe` is Object.is, so `Object.is(-0, 0)` is false and a perfectly correct render fails.
const wholePixels = (value: number): number => Math.round(value) + 0

// paired-shell-card.spec.ts's helper verbatim. A missing box is a node that never laid out; thrown rather
// than asserted null-safe so the checkpoints below read as geometry instead of as null handling.
const rectOf = async (
  locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const rect = await locator.boundingBox()
  if (!rect) throw new Error('the located node has no layout box')
  return rect
}

// paired-shell-card.spec.ts's token probe verbatim. A token's value as the CSSOM serialises a COLOUR, so
// the conversion is the engine's own and cannot drift from the readings it is compared against.
const tokenColor = async (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (value === '') return ''
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, token)

/** The thread's DIRECT children, which are the message rows: the thread is a column flex container, so the
 *  gap under test is the distance between consecutive children's border boxes, and the width under test is
 *  each child's own. Read in one round trip off the live boxes rather than through a class selector, so a
 *  row kind that stopped stretching is caught wherever it sits in the column. */
const rowBoxesOf = (page: Page): Promise<{ y: number; bottom: number; x: number; width: number }[]> =>
  page.locator('.conversation__thread').evaluate((el) =>
    Array.from(el.children).map((child) => {
      const rect = child.getBoundingClientRect()
      return { y: rect.y, bottom: rect.bottom, x: rect.x, width: rect.width }
    })
  )

const scrollTopOf = (page: Page): Promise<number> =>
  page.locator('.conversation__thread').evaluate((el) => el.scrollTop)

/** Drive one send whose reply overflows the thread, then assert it ACTUALLY overflows — the non-vacuity
 *  gate for the scroll block, which has nothing to scroll in a thread that fits. */
async function primeOverflowingThread(page: Page): Promise<void> {
  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')

  await page.getByPlaceholder('Message…').fill(PRIMER_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(assistantBubbles).toHaveCount(REPLY_TURNS, { timeout: STREAM_TIMEOUT_MS })
  await expect(page.locator('.conversation__thinking')).toHaveCount(0, { timeout: STREAM_TIMEOUT_MS })

  const { scrollHeight, clientHeight } = await page
    .locator('.conversation__thread')
    .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  expect(scrollHeight).toBeGreaterThan(clientHeight)
}

/** Wheel the thread to its top. A wheel drive rather than a `scrollTop` assignment because the pin
 *  (useThreadScrollPin) re-asserts the bottom while the reader is following it, and a wheel is the input
 *  that takes the reader off that follow — the same reason thread-scrollbar.spec.ts drives it this way. */
async function wheelThreadToTop(page: Page): Promise<void> {
  const box = await rectOf(page.locator('.conversation__thread'))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -1000)
  await expect.poll(() => scrollTopOf(page)).toBe(0)
}

test('the chat card draws its top bar and its inset, and only the thread scrolls', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  const card = page.locator('.conversation')
  const bar = page.locator('.conversation__overflow')
  const contentRow = page.locator('.conversation__overflow-content')
  const title = page.locator('.conversation__overflow-title')
  const trigger = page.locator('.conversation__overflow-trigger')
  const rule = page.locator('.conversation__overflow-rule')
  const thread = page.locator('.conversation__thread')
  const status = page.locator('.composer-status')
  const composer = page.locator('.composer')

  await expect(card).toBeVisible()
  const primary = await tokenColor(page, PRIMARY_TOKEN)
  expect(primary, 'the primary token resolves').not.toBe('')

  // --- 1. The card's inset (AC1). The pane wrapper is padding- and border-free and .conversation fills it
  // edge to edge (paired-shell-card.spec.ts checkpoint 4), so the card's own border box IS the drawn
  // frame and every inset below is read against it. The bottom is read off the composer rather than off
  // the thread: the thread is the flexible middle and the composer is the column's last child, so it is
  // the one whose trailing edge the card's 16 actually holds. ---
  const cardBox = await rectOf(card)
  const contentWidth = cardBox.width - 2 * CARD_SIDE_PX
  const barBox = await rectOf(bar)
  await expect(title).toHaveText(SEEDED_ROW.name ?? '')
  const contentRowBox = await rectOf(contentRow)
  const titleBox = await rectOf(title)
  expect(wholePixels(contentRowBox.height), 'the title and menu row').toBe(CONTENT_ROW_PX)
  expect(wholePixels(barBox.height), 'the bar stays 61px tall').toBe(61)
  expect([titleBox.x, titleBox.y].map(wholePixels)).toEqual([barBox.x, barBox.y].map(wholePixels))
  const titlePaint = await title.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      font: style.fontFamily, size: style.fontSize, line: style.lineHeight,
      weight: style.fontWeight, tracking: style.letterSpacing, color: style.color
    }
  })
  expect(titlePaint.font).toContain('Roboto')
  expect(titlePaint).toMatchObject({ size: '22px', line: '28px', weight: '400', tracking: 'normal' })
  expect(titlePaint.color).toBe(await tokenColor(page, '--color-on-primary-container'))
  expect(await bar.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('6px')
  const composerBox = await rectOf(composer)

  expect(wholePixels(barBox.y - cardBox.y), 'card top inset').toBe(CARD_TOP_PX)
  expect(wholePixels(barBox.x - cardBox.x), 'card leading inset').toBe(CARD_SIDE_PX)
  expect(wholePixels(barBox.width), 'the bar spans the content box').toBe(wholePixels(contentWidth))
  expect(wholePixels(composerBox.x - cardBox.x), 'the composer at the content edge').toBe(CARD_SIDE_PX)
  expect(wholePixels(composerBox.width), 'the composer spans the content box').toBe(
    wholePixels(contentWidth)
  )
  expect(
    wholePixels(cardBox.y + cardBox.height - (composerBox.y + composerBox.height)),
    'card bottom inset'
  ).toBe(CARD_BOTTOM_PX)

  // --- 2. The bar itself (AC1): a 24px button row justified to the trailing edge, drawn at rest with no
  // ground, its glyph inked in the primary token. The transparent background is the half that would catch
  // the retired 48px round treatment coming back with the box shrunk. ---
  const triggerBox = await rectOf(trigger)
  expect([triggerBox.width, triggerBox.height].map(wholePixels), 'the button box').toEqual([
    BUTTON_PX,
    BUTTON_PX
  ])
  expect(wholePixels(triggerBox.y - barBox.y), 'the button at the bar top').toBe(0)
  expect(
    wholePixels(cardBox.x + cardBox.width - CARD_SIDE_PX - (triggerBox.x + triggerBox.width)),
    'the button at the trailing content edge'
  ).toBe(0)
  const buttonPaint = await trigger.evaluate((el) => {
    const style = getComputedStyle(el)
    return { background: style.backgroundColor, color: style.color }
  })
  expect(buttonPaint.background, 'no ground is drawn').toBe('rgba(0, 0, 0, 0)')
  expect(buttonPaint.color, 'the glyph takes the primary token').toBe(primary)

  // The divider is 16px below the 28px content row, independently of the 24px trigger height.
  const ruleBox = await rectOf(rule)
  expect(wholePixels(ruleBox.height), 'the rule is 1px').toBe(RULE_HEIGHT_PX)
  expect(wholePixels(ruleBox.y - (contentRowBox.y + contentRowBox.height)), 'the rule gap').toBe(RULE_GAP_PX)
  expect([ruleBox.x, ruleBox.width].map(wholePixels), 'the rule spans the content box').toEqual(
    [cardBox.x + CARD_SIDE_PX, contentWidth].map(wholePixels)
  )
  const rulePaint = await rule.evaluate((el) => {
    const style = getComputedStyle(el)
    return { background: style.backgroundColor, opacity: style.opacity }
  })
  expect(rulePaint.background, 'the rule takes inverse primary').toBe(
    await tokenColor(page, '--color-inverse-primary')
  )
  expect(rulePaint.opacity, 'the rule is drawn at 60%').toBe(RULE_OPACITY)

  // The bar's own bottom padding, which is the last term of the 97 and the one a border-bottom
  // implementation would have swallowed.
  expect(wholePixels(barBox.y + barBox.height - (ruleBox.y + ruleBox.height)), "the bar's foot").toBe(
    BAR_BOTTOM_PX
  )

  // --- 4. The message rows (AC1's 97, AC3's 16 and 12). Read at the TOP of the thread, because the primer
  // leaves the reader pinned at the bottom and the first row is scrolled out of the box there. ---
  await primeOverflowingThread(page)
  await wheelThreadToTop(page)

  const rows = await rowBoxesOf(page)
  expect(rows.length, 'the primed thread holds rows to measure').toBeGreaterThan(1)

  const firstRow = rows[0]
  if (firstRow === undefined) throw new Error('the primed thread rendered no rows')
  expect(wholePixels(firstRow.y - cardBox.y), 'the first row at the drawn 97').toBe(FIRST_ROW_TOP_PX)
  expect(wholePixels(firstRow.y - (barBox.y + barBox.height)), 'the bar to the first row').toBe(
    CARD_GAP_PX
  )

  for (const [index, row] of rows.entries()) {
    expect([row.x, row.width].map(wholePixels), `row ${index} spans the content box`).toEqual(
      [cardBox.x + CARD_SIDE_PX, contentWidth].map(wholePixels)
    )
    const next = rows[index + 1]
    if (next !== undefined) {
      expect(wholePixels(next.y - row.bottom), `the gap under row ${index}`).toBe(ROW_GAP_PX)
    }
  }

  // The other half of AC3's 12, which only the BOTTOM of the thread can show. `.composer-status` is the
  // first element of the drawn Input area (347:5408) and a sibling in a column that declares no gap, so
  // the thread's own foot is the whole distance.
  await page.mouse.wheel(0, 4000)
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(0)
  const scrolledRows = await rowBoxesOf(page)
  const lastRow = scrolledRows[scrolledRows.length - 1]
  if (lastRow === undefined) throw new Error('the scrolled thread rendered no rows')
  const statusBox = await rectOf(status)
  expect(wholePixels(statusBox.y - lastRow.bottom), 'the last row to the input area').toBe(CARD_GAP_PX)
  expect(wholePixels(statusBox.x - cardBox.x), 'the status area at the content edge').toBe(CARD_SIDE_PX)

  // --- 5. The bar does not scroll, and the thread is still the only thing in the pane that does (AC3).
  // The y reads are what would catch a bar left inside the scroller; the computed reads are what would
  // catch the scrollport moving off .conversation__thread, which fifteen shipped specs drive by assigning
  // `scrollTop` — a write that is a silent no-op on a non-scrolling element, so they would fail OPEN. ---
  const barAfterScroll = await rectOf(bar)
  const ruleAfterScroll = await rectOf(rule)
  expect([barAfterScroll.y, ruleAfterScroll.y].map(wholePixels), 'the bar held its place').toEqual(
    [barBox.y, ruleBox.y].map(wholePixels)
  )
  const overflows = await page.evaluate(() =>
    ['.conversation', '.conversation__overflow', '.conversation__thread'].map((selector) => {
      const el = document.querySelector(selector)
      return el === null ? null : getComputedStyle(el).getPropertyValue('overflow-y')
    })
  )
  expect(overflows, 'only the thread scrolls').toEqual(['visible', 'visible', 'auto'])

  // --- 6. AC2's dismissal region, which no shipped spec covers. The twelve specs that click this trigger
  // all go on to click a menu ITEM, so none of them would see an outside-click handler whose containment
  // test had quietly grown to the bar's full width. The point below is inside the bar and outside both the
  // button and its menu — exactly the click that stops dismissing if `wrapperRef` is left on the bar. A
  // raw-coordinate click, because there is no element to locate at that spot. ---
  const menu = page.locator('.conversation__overflow-menu')
  await trigger.click()
  await expect(menu).toBeVisible()
  await page.mouse.click(barAfterScroll.x + 4, barAfterScroll.y + BUTTON_PX / 2)
  await expect(menu).toHaveCount(0)

  // …and the trigger still opens it, so the assertion above proves dismissal rather than a broken toggle.
  await trigger.click()
  await expect(menu).toBeVisible()
})

for (const width of [800, 1280]) {
  test(`the top-bar name refreshes and truncates beside a usable menu at ${width}px`, async ({
    launchPairedApp
  }) => {
    let rows: ConversationSummary[] = [SEEDED_ROW]
    const listFrame = (): Uint8Array => encodeEnvelope({
      id: REPLY_ENVELOPE_ID, type: 'conversations', ts: FIXED_TS,
      payload: { conversations: rows } satisfies ConversationsPayload
    })
    const { page, app, daemon } = await launchPairedApp({
      buildReplyFrames: (inbound) => decodeEnvelope(inbound).type === 'list_conversations'
        ? [listFrame()] : []
    })
    await app.evaluate(({ BrowserWindow }, windowWidth) => {
      BrowserWindow.getAllWindows()[0].setSize(windowWidth, 800)
    }, width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)

    const title = page.locator('.conversation__overflow-title')
    const bar = page.locator('.conversation__overflow')
    const trigger = page.getByRole('button', { name: 'More actions', exact: true })
    const menu = page.getByRole('menu')
    await expect(title).toHaveText('Seeded discussion')

    // The list reply is the refresh source for automatic naming and renames. Keep the open chat
    // mounted, and preserve a local draft to distinguish a refresh from reactivation.
    const draft = page.getByPlaceholder('Message…')
    await draft.fill('Unsent local draft')
    const renameFromList = async (name: string | null): Promise<void> => {
      rows = [{ ...SEEDED_ROW, name }]
      await daemon.pushFrame(listFrame())
      await expect(title).toHaveText(name ?? 'Unnamed conversation')
      await expect(draft).toHaveValue('Unsent local draft')
    }
    await renameFromList(null)
    await renameFromList('Automatically named chat')
    await renameFromList('pyrycode discord integration')
    await page.screenshot({ path: `/tmp/builder-1541-${width}-named.png`, animations: 'disabled' })

    const other = { ...SEEDED_ROW, id: 'other-top-bar-chat', name: 'Second conversation' }
    rows = [...rows, other]
    await daemon.pushFrame(listFrame())
    await page.locator('.channel-list__row-open').filter({ hasText: other.name }).click()
    await expect(title).toHaveText(other.name)
    await page.locator('.channel-list__row-open').filter({ hasText: 'pyrycode discord integration' }).click()
    await expect(title).toHaveText('pyrycode discord integration')

    const longName = 'Long conversation name '.repeat(12)
    await draft.fill('Unsent local draft')
    await renameFromList(longName)
    const titleBox = await rectOf(title)
    const triggerBox = await rectOf(trigger)
    const barBox = await rectOf(bar)
    expect(wholePixels(titleBox.height), 'one title line').toBe(CONTENT_ROW_PX)
    expect(titleBox.x + titleBox.width, 'title ends before the menu').toBeLessThanOrEqual(triggerBox.x)
    expect(wholePixels(triggerBox.x + triggerBox.width)).toBe(wholePixels(barBox.x + barBox.width))
    expect([triggerBox.width, triggerBox.height].map(wholePixels)).toEqual([BUTTON_PX, BUTTON_PX])
    const truncation = await title.evaluate((el) => ({
      overflow: el.scrollWidth > el.clientWidth,
      ellipsis: getComputedStyle(el).textOverflow,
      whiteSpace: getComputedStyle(el).whiteSpace
    }))
    expect(truncation).toEqual({ overflow: true, ellipsis: 'ellipsis', whiteSpace: 'nowrap' })
    expect(await page.locator('.conversation').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    const menuBox = await rectOf(menu)
    expect(wholePixels(menuBox.y)).toBe(wholePixels(triggerBox.y + triggerBox.height))
    expect(wholePixels(menuBox.x + menuBox.width)).toBe(wholePixels(triggerBox.x + triggerBox.width))
    expect(menuBox.x).toBeGreaterThanOrEqual(barBox.x)
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Channel info', 'Run configuration', 'Background tasks'
    ])
    await page.screenshot({ path: `/tmp/builder-1541-${width}-long-menu.png`, animations: 'disabled' })
    await title.click()
    await expect(menu).toHaveCount(0)

    await trigger.press('Space')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('menuitem', { name: 'Channel info', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()

    await trigger.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: longName, exact: true })).toBeVisible()
    await expect(menu).toHaveCount(0)
  })
}
