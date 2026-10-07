import type { Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { HISTORY_ASK_BAND_VIEWPORTS } from '../src/renderer/src/screens/conversation/threadScrollPosition'
import type {
  Envelope,
  HistoryPagePayload,
  MessagePayload,
  RequestHistoryPayload
} from '../src/shared/wire/types'

// #1260 — scrolling back through a thread walks its history until the log's start. The DECISION is a pure
// function of the conversation's held reading plus one boolean and is unit-tested in
// `historyPageBridge.test.ts`; the geometry is `isNearTop` and is unit-tested beside `isAtBottom`. What
// only this tier can show is the loop closing: a real scroll event on a real scroll container fires a real
// ask carrying the previous page's cursor, and the reading the reply writes is what decides the next one.
// `vitest.config.ts` is `environment: 'node'`, so renderer specs are static renders with no DOM and
// nothing to scroll.
//
// THE THREE SEQUENCES THE TICKET NAMES ARE ALL IN ONE DRIVE, deliberately, because they are one walk
// rather than three behaviours: a full page, then an EMPTY page, then a SHORT page, then `at_start`. Split
// across tests, each would need its own launch and its own preceding pages to reach the interesting state,
// and the property under test — that neither an empty nor a short page is read as the end of the log —
// only exists in the sequence.
//
// NO SEND ANYWHERE IN THIS FILE. The opening page is sized to overflow the thread on its own, so every row
// on screen arrived through `history_page` and the thread is scrollable without the composer ever being
// touched. That also makes the drawn-row assertions unambiguous: there is no optimistic echo to confuse
// with a replayed entry.
//
// HISTORY_ASK_BAND_VIEWPORTS IS IMPORTED, never hardcoded, and every park is derived from the thread's
// MEASURED `clientHeight` (#1752), so the parks below are inside the band by construction rather than by a
// copied literal that a retune or a window resize would silently strand. That module has zero imports and no
// React or DOM reference, so it resolves under Playwright's Node transform with no alias config — the
// argument `thread-scroll-pin.spec.ts` already makes for `AT_BOTTOM_TOLERANCE_PX`.
//
// SECRET HYGIENE (the siblings' rule): every assertion reads DOM text, a count, or a decoded envelope
// TYPE and its `cursor` field. The cursors here are this spec's own display literals, the pairing plumbing
// is the fixture's business and is never echoed, and no failure diagnostic serialises a token or a key.

const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const ROUNDTRIP_TIMEOUT_MS = 15_000

/** The opening page, sized to OVERFLOW the 1100x800 window's thread on its own — that overflow is what
 *  makes the thread scrollable at all, and it is asserted below rather than assumed. Not measured: raise
 *  the count if the gate ever fails, never weaken the gate. */
const OPENING_ENTRIES = 14

/** The cursors, in the order the daemon hands them back. Opaque to the client by contract — it echoes them
 *  and reads nothing out of them — so their readable shape here is a convenience for a failure message,
 *  never something the app is allowed to depend on. */
const CURSOR_AFTER_OPENING = 'cursor-page-2'
const CURSOR_AFTER_EMPTY = 'cursor-page-3'
const CURSOR_AFTER_SHORT = 'cursor-page-4'

const openingText = (n: number): string => `opening page entry number ${n}`
const SHORT_PAGE_TEXT = 'the only entry the daemon could fit in that page'
const FINAL_PAGE_TEXT = 'the very first thing ever said in this conversation'

/** The operator's own stored message: type `message`, NOT `send_message` — `protocol.TypeMessage` is what
 *  the daemon appends to a conversation's log, and `message` is the string the client's decode matches on.
 *  Carried verbatim in shape from `history-on-open.spec.ts`'s builder. */
function storedMessageEntry(id: number, text: string): HistoryPagePayload['entries'][number] {
  return {
    id,
    type: 'message',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      message_id: `stored-m${id}`,
      role: 'user',
      text
    } satisfies MessagePayload
  }
}

/** One served page, correlated by `in_reply_to`. `history_page` NAMES NO CONVERSATION — the window is
 *  handed the id it asked with, resolved from the main process's own correlation map. */
function historyPageFrame(
  inReplyTo: number,
  entries: HistoryPagePayload['entries'],
  cursor: string,
  atStart: boolean
): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'history_page',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { entries, cursor, at_start: atStart } satisfies HistoryPagePayload
  })
}

/**
 * The whole log, as the daemon would serve it: each page keyed by the cursor the client must ask with to
 * receive it. Keying on the REQUESTED cursor rather than on a call counter is what makes the drive's
 * central claim checkable at all — a client that invented, mangled or dropped a cursor gets no page and
 * the drive stalls, where a counter would have served the next page regardless.
 *
 * The sequence is the ticket's, in order:
 *
 *   ''                     -> a full page, `at_start` false   (the opening ask, #1259)
 *   CURSOR_AFTER_OPENING   -> an EMPTY page, `at_start` false  (an empty page is not the end of the log)
 *   CURSOR_AFTER_EMPTY     -> a SHORT page, `at_start` false   (a short page is not the end either)
 *   CURSOR_AFTER_SHORT     -> two entries, `at_start` TRUE     (the only thing that stops a walk)
 *
 * A page fills exactly at the log's first entry with `at_start` false and a usable cursor, and the daemon
 * re-asks its own log at a smaller size rather than truncating to fit the envelope cap — so both middle
 * arms are shapes a real daemon produces, not manufactured preconditions.
 */
const PAGES: ReadonlyMap<string, { entries: HistoryPagePayload['entries']; cursor: string; atStart: boolean }> =
  new Map([
    [
      '',
      {
        entries: Array.from({ length: OPENING_ENTRIES }, (_, i) =>
          storedMessageEntry(100 + i, openingText(OPENING_ENTRIES - i))
        ),
        cursor: CURSOR_AFTER_OPENING,
        atStart: false
      }
    ],
    [CURSOR_AFTER_OPENING, { entries: [], cursor: CURSOR_AFTER_EMPTY, atStart: false }],
    [
      CURSOR_AFTER_EMPTY,
      {
        entries: [storedMessageEntry(200, SHORT_PAGE_TEXT)],
        cursor: CURSOR_AFTER_SHORT,
        atStart: false
      }
    ],
    [
      CURSOR_AFTER_SHORT,
      {
        entries: [storedMessageEntry(300, FINAL_PAGE_TEXT)],
        // The terminal page's published shape: an empty cursor with `at_start` true. The client must stop
        // on the FLAG — a client that stopped on the empty cursor instead would pass this drive and keep
        // walking against a daemon that still had a position to hand back.
        cursor: '',
        atStart: true
      }
    ]
  ])

/** The scripted daemon: every inbound is captured, `request_history` is answered from the table above by
 *  the cursor it carried, everything else takes the shared seed arm. */
function walkingFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    if (env.type === 'request_history') {
      const asked = (env.payload as RequestHistoryPayload).cursor
      const page = PAGES.get(asked)
      // An unknown cursor is answered with NOTHING, which is what turns "the client mangled a cursor"
      // into a visible stall at the next barrier rather than into a silently-served page.
      return page === undefined
        ? []
        : [historyPageFrame(env.id, page.entries, page.cursor, page.atStart)]
    }
    return [seedConversationsFrame()]
  }
}

const historyAsks = (captured: Envelope[]): RequestHistoryPayload[] =>
  captured.filter((e) => e.type === 'request_history').map((e) => e.payload as RequestHistoryPayload)

// Position the viewport, then issue a genuine upward input.
const scrollBack = async (page: Page, offset: number): Promise<void> => {
  await page.locator('.conversation__thread').evaluate((el, top) => {
    el.scrollTop = top
  }, offset)
  // One full "update the rendering" step, so the queued scroll event has dispatched and React's onScroll
  // has run. Scroll steps run before animation-frame callbacks within a step, so one rAF suffices; the
  // second is free insurance. (`settleScrollEvent`'s contract, transcribed.)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  await page.locator('.conversation__thread').focus()
  await page.keyboard.press('ArrowUp')
}

/** The ask band in CSS pixels for this window, from the real scroll container's own viewport. */
const askBandPx = (page: Page): Promise<number> =>
  page
    .locator('.conversation__thread')
    .evaluate((el, viewports) => viewports * el.clientHeight, HISTORY_ASK_BAND_VIEWPORTS)

async function walkBackUntilAskFor(
  page: Page,
  captured: Envelope[],
  cursor: string
): Promise<void> {
  const band = await askBandPx(page)
  let offset = band / 2
  await expect
    .poll(
      async () => {
        offset = offset === band / 2 ? band / 4 : band / 2
        await scrollBack(page, offset)
        return historyAsks(captured).some((ask) => ask.cursor === cursor)
      },
      { timeout: ROUNDTRIP_TIMEOUT_MS }
    )
    .toBe(true)
}

test('scrolling back walks the thread page by page and stops at the start of the log', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page } = await launchPairedApp({ buildReplyFrames: walkingFake(captured) })

  await scrollBack(page, 0)
  const userBubbles = page.locator('.bubble[data-thread-role="user"]')
  const thread = page.locator('.conversation__thread')

  // --- The opening page (#1259), which is this drive's setup rather than its subject. ---
  await expect(userBubbles).toHaveCount(OPENING_ENTRIES, { timeout: ROUNDTRIP_TIMEOUT_MS })
  expect(historyAsks(captured)).toHaveLength(1)
  expect(historyAsks(captured)[0].cursor).toBe('')

  // THE NON-VACUITY GATE FOR EVERY SCROLL BELOW. A thread that does not overflow cannot produce a scroll
  // event at all, so without this the drive would stall at the first barrier with a misleading failure —
  // and a walk asserted against a thread that never scrolled would be testing nothing.
  const { scrollHeight, clientHeight } = await thread.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight
  }))
  expect(scrollHeight).toBeGreaterThan(clientHeight)

  // --- AC1. Scrolling back asks for the page BEFORE the oldest loaded entry, echoing that page's cursor
  // verbatim. This is the whole loop closing: a DOM scroll event on the real container reached the real
  // decision, which read the real stored reading and put its cursor on the wire. ---
  await walkBackUntilAskFor(page, captured, CURSOR_AFTER_OPENING)
  expect(historyAsks(captured)[1]).toEqual({
    conversation_id: SEEDED_ROW.id,
    cursor: CURSOR_AFTER_OPENING,
    limit: 200
  } satisfies RequestHistoryPayload)

  // --- AC3, first half: the EMPTY page. It draws nothing, so there is no row count to wait on — the ask
  // count itself is the observable, and the fact that a THIRD ask goes out at all is the claim: the walk
  // survived a page with no entries in it, and did so carrying the cursor that empty page handed back. A
  // client that read an empty `entries` list as the end of the log stalls here. ---
  await walkBackUntilAskFor(page, captured, CURSOR_AFTER_EMPTY)

  // --- AC3, second half: the SHORT page. One entry against an opening page of fourteen — the shape a
  // daemon produces when it re-asks its own log at a smaller size to fit the envelope cap. It draws its
  // row AND leaves the walk running. ---
  //
  // Receipt is settled before issuing another qualifying input; a short page never starts one.
  await expect(page.locator('.bubble[data-thread-role="user"]', { hasText: SHORT_PAGE_TEXT })).toHaveCount(
    1,
    { timeout: ROUNDTRIP_TIMEOUT_MS }
  )
  expect(historyAsks(captured)).toHaveLength(3)
  await walkBackUntilAskFor(page, captured, CURSOR_AFTER_SHORT)

  // --- AC3, the stop. The final page reports `at_start`, and every later scroll declines. ---
  //
  // THE POSITIVE READ IS ORDERED IN FRONT OF THE ABSENCE, and it is the final page's own row: an absence
  // asserted straight after a scroll passes before the reply it is about has even been processed. Waiting
  // for the row proves the terminal page was drawn AND that its `at_start` was recorded, because both are
  // written by the same delivery.
  await expect(page.locator('.bubble[data-thread-role="user"]', { hasText: FINAL_PAGE_TEXT })).toHaveCount(
    1,
    { timeout: ROUNDTRIP_TIMEOUT_MS }
  )

  // Several genuine scroll events from the position the walk fires from, and nothing goes out. Repeated
  // rather than single, because a stop that merely LAGGED by one event would pass a single scroll.
  for (const offset of [40, 120, 8, 160, 24]) await scrollBack(page, offset)

  // THE WHOLE WALK, IN ORDER AND WITHOUT DUPLICATES. This one equality carries three claims no barrier
  // above could make on its own: every ask echoed the previous page's cursor verbatim, no page was ever
  // asked for twice (the one-ask-in-flight gate, end to end, across dozens of real scroll events), and
  // the walk stopped on `at_start` rather than on the empty page or the short page before it.
  expect(historyAsks(captured).map((ask) => ask.cursor)).toEqual([
    '',
    CURSOR_AFTER_OPENING,
    CURSOR_AFTER_EMPTY,
    CURSOR_AFTER_SHORT
  ])

  // And the thread holds exactly the whole log and nothing twice — the drawing half of "no page was ever
  // asked for, or applied, more than once". `prependHistoryFor` is deliberately non-idempotent, so a
  // duplicate ask would show up here as duplicated rows rather than as a silent no-op.
  await expect(userBubbles).toHaveCount(OPENING_ENTRIES + 2)
})

// #1752 — the band's two edges on the real scroll container. The walk above only ever parks well inside
// the band; this drive pins where it ENDS: an upward input from exactly two viewport heights asks, and one
// from a pixel further down sends nothing. The opening page is tall enough that the thread scrolls past
// the band at all, which is gated below rather than assumed, and the ask the in-band input fires is
// withheld so no prepend moves the geometry between the two parks.

/** Rows enough to scroll the thread more than three viewports deep in the 1100x800 window. */
const BOUNDARY_ENTRIES = 40
const BOUNDARY_CURSOR = 'cursor-past-the-boundary-page'
/** How long the out-of-band input is given to reach the daemon before its absence is read. A real ask is
 *  one synchronous keydown handler plus one IPC hop, so this is orders of magnitude of headroom. */
const NO_ASK_SETTLE_MS = 1_000

function boundaryFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    if (env.type === 'request_history') {
      if ((env.payload as RequestHistoryPayload).cursor !== '') return []
      const entries = Array.from({ length: BOUNDARY_ENTRIES }, (_, i) =>
        storedMessageEntry(100 + i, openingText(BOUNDARY_ENTRIES - i))
      )
      return [historyPageFrame(env.id, entries, BOUNDARY_CURSOR, false)]
    }
    return [seedConversationsFrame()]
  }
}

test('an upward input asks from up to two viewport heights below the top and not one pixel further', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page } = await launchPairedApp({ buildReplyFrames: boundaryFake(captured) })
  const thread = page.locator('.conversation__thread')

  await scrollBack(page, 0)
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(BOUNDARY_ENTRIES, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  expect(historyAsks(captured)).toHaveLength(1)

  // NON-VACUITY: the thread must scroll past the band, or the "beyond" park below would be clamped back
  // inside it and the absence would prove nothing.
  const band = await askBandPx(page)
  const { scrollHeight, clientHeight } = await thread.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight
  }))
  expect(band).toBe(2 * clientHeight)
  expect(scrollHeight - clientHeight).toBeGreaterThan(band + 1)

  // One pixel beyond the band: the input is genuine, and nothing goes out.
  await scrollBack(page, band + 1)
  await expect.poll(() => thread.evaluate((el) => el.scrollTop)).toBeLessThan(band + 1)
  await page.waitForTimeout(NO_ASK_SETTLE_MS)
  expect(historyAsks(captured)).toHaveLength(1)

  // Exactly at the band: the same input asks, carrying the opening page's cursor and the page size.
  await page.locator('.conversation__thread').evaluate((el, top) => {
    el.scrollTop = top
  }, band)
  expect(await thread.evaluate((el) => el.scrollTop)).toBe(band)
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => historyAsks(captured).length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(2)
  expect(historyAsks(captured)[1]).toEqual({
    conversation_id: SEEDED_ROW.id,
    cursor: BOUNDARY_CURSOR,
    limit: 200
  } satisfies RequestHistoryPayload)
})

test('partially overlapping and repeated served pages contribute assistant and tool rows once', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const entries: HistoryPagePayload['entries'] = [
    { id: 503, type: 'assistant_delta', ts: FIXED_TS, payload: {
      conversation_id: SEEDED_ROW.id, turn_id: 'receipt-turn', seq: 0, text: 'Assistant receipt once'
    } },
    { id: 502, type: 'tool_result', ts: FIXED_TS, payload: {
      conversation_id: SEEDED_ROW.id, turn_id: 'receipt-turn', tool_use_id: 'receipt-tool',
      is_error: false, result_summary: 'Tool receipt once'
    } },
    { id: 501, type: 'tool_use', ts: FIXED_TS, payload: {
      conversation_id: SEEDED_ROW.id, turn_id: 'receipt-turn', tool_use_id: 'receipt-tool',
      name: 'Read', input_summary: 'receipt input'
    } },
    ...Array.from({ length: OPENING_ENTRIES }, (_, i) => storedMessageEntry(400 + i, openingText(i)))
  ]
  const { page } = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    captured.push(env)
    if (env.type !== 'request_history') return [seedConversationsFrame()]
    const cursor = (env.payload as RequestHistoryPayload).cursor
    if (cursor === '') return [historyPageFrame(env.id, entries, 'repeat', false)]
    if (cursor === 'repeat') return [historyPageFrame(env.id, [...entries.slice(0, 3), storedMessageEntry(399, 'older partial overlap')], 'settled-repeat', false)]
    if (cursor === 'settled-repeat') return [historyPageFrame(env.id, entries, '', true)]
    return []
  } })
  const thread = page.locator('.conversation__thread')
  const assistant = thread.locator('.bubble[data-thread-role="assistant"]')
  const tools = thread.locator('.tool-row:not(.tool-run__row)')
  await scrollBack(page, 0)
  await expect(assistant).toHaveCount(1)
  await expect(assistant).toContainText('Assistant receipt once')
  await expect(tools).toHaveCount(1)
  await expect(tools).toContainText('receipt input')
  await expect(tools).toHaveClass(/tool-row--resolved/)
  await walkBackUntilAskFor(page, captured, 'repeat')
  // Asking from the new cursor proves the repeated page has actually settled in the mounted store.
  await walkBackUntilAskFor(page, captured, 'settled-repeat')
  await expect(assistant).toHaveCount(1)
  await expect(tools).toHaveCount(1)
  await expect(thread.locator('.bubble[data-thread-role="user"]')).toHaveCount(OPENING_ENTRIES + 1)
  await expect(thread).toContainText('older partial overlap')
  expect(historyAsks(captured).map(ask => ask.cursor)).toEqual(['', 'repeat', 'settled-repeat'])
})
