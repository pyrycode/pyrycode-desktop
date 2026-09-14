import type { Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1074 — THE THREAD SCROLLS WITHOUT DRAWING A SCROLLBAR (Figma "Message area"
// 132:4171, inside the chat screen's "Content" frame 106:3321). The design's reference is an ABSENCE and a
// measured one: the message area is 780 wide inside a 820 frame with 20px insets, so the column runs the
// full inner width with no strip reserved on the right, and the frame holds no scrollbar layer at any
// depth even though it stacks 1026px of message containers.
//
// ONLY THIS TIER CAN SEE IT. Nothing in this repo screenshots (`toHaveScreenshot` appears nowhere in
// `e2e/`), and renderer specs are `renderToStaticMarkup` under vitest's `node` environment with no
// stylesheet and no layout at all, so no unit test can observe a computed style. The markup is also
// byte-identical before and after — the change is two CSS declarations on an existing rule and no class is
// added at any call site — so there is nothing for a markup assertion to catch either.
//
// THE DETECTOR IS THE COMPUTED `scrollbar-width`, AND A GEOMETRY READ IS DELIBERATELY NOT WRITTEN.
// `offsetWidth - clientWidth === 0` proves nothing on a machine drawing overlay bars, where that gutter is
// already 0 with the declaration DELETED — such an assertion passes against an app with no feature in it.
// Nor can the overlay case simply be assumed away: `.composer__input`'s own comment records THIS app
// measured with a layout-taking bar (clientWidth 616 -> 601 when the textarea's bar appears). The computed
// keyword is platform-independent, and if the property were somehow not exposed it reads back as the empty
// string, so the assertion fails loudly rather than degrading into a passing one.
//
// THE NEIGHBOUR READS ARE WHAT PROVE THE DETECTOR DISCRIMINATES, and they are the same assertions that
// discharge the last criterion. A bare `toBe('none')` could in principle pass on an engine answering `none`
// for every element; reading `.channel-list` (the sidebar's scroll column, on screen beside the thread in
// the two-pane layout) and `.composer__input` (whose bar past five lines is a deliberate #1056 signal) in
// the SAME run and getting `auto` back rules that out. One read, two jobs.
//
// TRACKPAD MOMENTUM IS NOT SYNTHESIZABLE IN ANY TIER, and that leg of AC2 is an operator eyeball on the
// built app. Saying so plainly beats a wheel event dressed up as a trackpad. The wheel and the four
// keyboard keys ARE drivable and are driven below.
//
// THE `overflow-anchor` HALF KEEPS ITS EXISTING DETECTOR: the three thumbnail tests at the bottom of
// `thread-scroll-pin.spec.ts`, which were shown failing with `overflow-anchor: none` present. Nothing here
// re-litigates them; the computed read below only pins that the property is still at its default.
//
// SECRET HYGIENE (the siblings' posture): every assertion reads a computed style, an attribute or a scroll
// offset; the prompt text, the reply texts, the conversation_id and the turn ids are non-secret display and
// routing literals. The pairing plumbing lives in launchPairedApp and is never echoed. No failure
// diagnostic serialises a token, key, or plaintext.

// The primer's reply travels a real send -> Noise -> decode -> render round-trip; generous headroom for a
// cold runner (the siblings' value).
const STREAM_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushes by envelope id, so one fixed id is reused across every frame.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The primer send's reply: REPLY_TURNS separate TURNS, each an assistant_delta plus its turn_end, so the
// timeline grows REPLY_TURNS distinct assistant bubbles. Separate turns rather than newlines inside one
// delta because same-turn deltas coalesce into a single bubble (threadTimeline.appendDelta). 20 is
// thread-scroll-pin.spec.ts's own count, sized for headroom over the 1100x800 window — if the thread does
// not overflow, the `scrollHeight > clientHeight` gate below fails loudly, which is the gate working.
const REPLY_TURNS = 20
const replyText = (turn: number): string => `Streamed reply line ${turn}`

const PRIMER_TEXT = 'prime the thread past its viewport'

// --- Spec-local frame builders (the seedConversationsFrame idiom): each seals one envelope through the
// production codec, deterministic id/ts. Copied from thread-scroll-pin.spec.ts, whose primer this is. ---

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

/** The turn's terminal phase. Faithful first — a real daemon ends every turn with it — and load-bearing as
 *  the settle gate: since #650 the composer's own accept opens the working indicator locally, so without
 *  this frame the primer would leave `.conversation__thinking` mounted and the layout would still be in
 *  motion when the offsets below are read. */
const turnStateFrame = (state: WireTurnState): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })

/**
 * One buildReplyFrames dispatching on the decoded inbound type. `send_message` -> the ordered overflow
 * stream; every other inbound (the auto-fired `list_conversations`) -> the shared one-row seed, since a
 * scripted buildReplyFrames overrides the fixture's default arm.
 *
 * #448 regression guard, carried from the siblings: the send arm replies only when the inbound
 * `conversation_id` is the OPENED row's id, mirroring the real daemon's KnownConversation rejection.
 */
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

/** The computed scrollbar keyword off one selector. `getPropertyValue` rather than the camelCase CSSOM
 *  property so an engine that does not expose `scrollbar-width` at all answers `''` and reddens, instead of
 *  answering `undefined` and stringifying into something a loose assertion might accept. */
const scrollbarWidthOf = (page: Page, selector: string): Promise<string> =>
  page.locator(selector).evaluate((el) => getComputedStyle(el).getPropertyValue('scrollbar-width'))

/** The live scroll offset off the real container — the whole reason the scrolling half lives in this tier. */
const scrollTopOf = (page: Page): Promise<number> =>
  page.locator('.conversation__thread').evaluate((el) => el.scrollTop)

/**
 * Drive one send whose reply overflows the thread, then assert it ACTUALLY overflows.
 *
 * The overflow gate is the non-vacuity requirement for the first criterion's "at any content length": a
 * thread shorter than its viewport draws no bar on any platform, so every assertion below would pass
 * against an app with the declaration deleted. It is also the precondition the scrolling legs need — there
 * is nothing to scroll in a thread that fits.
 *
 * Waiting for the LAST bubble's exact text is the settle gate: the trailing streaming cursor drops only
 * when that turn's `turn_end` lands, so an exact-count match plus the idle gate proves the whole stream
 * arrived and the layout is final before anything is measured.
 */
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

/**
 * Put the sequential-focus navigation starting point inside the thread, the way the operator does.
 *
 * A RAW-COORDINATE click, never a locator click: Playwright scrolls a located element into view before
 * clicking it, which would move the very offset under test. The target is 4px in from the container's left
 * edge, inside its own 16px (`--space-4`) horizontal padding — that strip is the container itself with no
 * row under it, and no row, bubble or message wrapper carries a click handler anyway (the copy affordance
 * is a dedicated `Copy message` button inside the bubble).
 *
 * The thread is keyboard-focusable for user-demand history paging. Clicking its padding focuses the
 * scroll region itself, so native scroll keys and qualifying upward history demand share that target.
 */
async function clickInsideThread(page: Page): Promise<void> {
  const box = await page.locator('.conversation__thread').boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.click(box.x + 4, box.y + box.height / 2)
}

test('the overflowing thread draws no scrollbar while its neighbours keep theirs', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })
  await primeOverflowingThread(page)

  // --- AC1. The thread, in the state where a bar would be drawn. ---
  expect(await scrollbarWidthOf(page, '.conversation__thread')).toBe('none')

  // --- AC5, and the proof that the read above discriminates rather than answering `none` for everything.
  // Both regions are on screen in this same launch: `.channel-list__tree` is what scrolls in the sidebar
  // beside the thread, `.composer__input` the textarea below it whose bar past five lines is deliberate
  // (#1056). The control names the TREE and not `.channel-list` since #1443: the drawn top bar split that
  // column into a padded card column that no longer scrolls and a tree wrapper inside it that does, and a
  // control pointed at a non-scrolling element is a weaker one — `scrollbar-width` computes `auto` by
  // default on any element at all, so it would still answer `auto` and prove nothing about a region that
  // draws a bar. ---
  expect(await scrollbarWidthOf(page, '.channel-list__tree')).toBe('auto')
  expect(await scrollbarWidthOf(page, '.composer__input')).toBe('auto')

  // --- AC3. Nothing else about the element moved. `overflow-anchor` unset computes `auto`, which is what
  // leaves Chromium's scroll anchoring on — the mechanism thread-scroll-pin.spec.ts's three thumbnail tests
  // prove and which `overflow-anchor: none` would cost a measured 172px. The thread participates in tab
  // order for keyboard history demand and keeps its existing implicit role. ---
  const element = await page.locator('.conversation__thread').evaluate((el) => ({
    overflowY: getComputedStyle(el).getPropertyValue('overflow-y'),
    overflowAnchor: getComputedStyle(el).getPropertyValue('overflow-anchor'),
    tabIndexAttribute: el.getAttribute('tabindex'),
    roleAttribute: el.getAttribute('role')
  }))
  expect(element).toEqual({
    overflowY: 'auto',
    overflowAnchor: 'auto',
    tabIndexAttribute: '0',
    roleAttribute: null
  })
})

test('the thread still scrolls by wheel and by keyboard with no bar to drag', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })
  await primeOverflowingThread(page)

  // The primer leaves the reader pinned at the bottom, so every leg below moves UP first and is asserted
  // against the offset it actually started from rather than against a constant.
  const bottom = await scrollTopOf(page)
  expect(bottom).toBeGreaterThan(0)

  // --- AC2, the wheel. The pointer is moved over the thread first: a wheel event is delivered to whatever
  // is under the cursor, and without the move it would land wherever the cursor happens to rest. Wheel
  // scrolling is asynchronous in Chromium, so every leg polls rather than reading once. ---
  const box = await page.locator('.conversation__thread').boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -400)
  await expect.poll(() => scrollTopOf(page)).toBeLessThan(bottom)

  const afterWheelUp = await scrollTopOf(page)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(afterWheelUp)

  // --- AC2, the four keys. Each is asserted in its own direction, so a key silently doing nothing cannot
  // be masked by the key before it. Trackpad momentum is the one input with no leg here: it is not
  // synthesizable in any tier and is an operator eyeball on the built app. ---
  await clickInsideThread(page)

  const beforePageUp = await scrollTopOf(page)
  await page.keyboard.press('PageUp')
  await expect.poll(() => scrollTopOf(page)).toBeLessThan(beforePageUp)

  const beforePageDown = await scrollTopOf(page)
  await page.keyboard.press('PageDown')
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(beforePageDown)

  await page.keyboard.press('Home')
  await expect.poll(() => scrollTopOf(page)).toBe(0)

  await page.keyboard.press('End')
  await expect.poll(() => scrollTopOf(page)).toBe(bottom)
})
