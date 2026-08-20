import type { Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// The assistant-bubble whitespace e2e (#607) — the liveness proof for "an assistant reply keeps its line
// and paragraph breaks". It ships WITH the fix because it is the only tier that can prove it: vitest runs
// the `node` environment (vitest.config.ts:27), so renderer tests are renderToStaticMarkup strings with no
// DOM, no stylesheet and no layout. The unit tier pins WHICH element carries the rule
// (ConversationScreen.test.tsx); this one pins what the browser does with it.
//
// THE VACUITY TRAP THIS SPEC EXISTS TO AVOID: `toHaveText` hardcodes `normalizeWhiteSpace: true` on both
// its string and its regex branch (playwright/lib/matchers/expect.js:12478,12483), and `useInnerText` does
// not opt out — the actual text is trimmed and every whitespace run collapsed to a single space BEFORE
// comparison. A multi-line text expectation therefore passes identically against the broken and the fixed
// rendering. Every whitespace assertion below is instead a computed style or a geometric measure, read
// through `locator.evaluate()` in the thread-scroll-pin.spec.ts:179-184 idiom.
//
// A separate file rather than an extension of send-and-stream.spec.ts: that spec asserts against a bare
// `.bubble[data-thread-role="assistant"]` locator, so adding turns to its stream would break it on
// strict-mode multiplicity. #601 set the precedent of shipping the liveness proof as its own spec.
//
// EVERY PUSHED FRAME IS ONE A REAL DAEMON PRODUCES (the standing fake-tier rule): an `assistant_delta`
// plus its `turn_end`, repeated per turn — the send-and-stream stream, and the #601 multi-turn shape.
//
// SECRET HYGIENE (carried from the siblings): every assertion reads computed style, geometry or counts;
// the reply texts, conversation_id and turn ids are non-secret display & routing literals. The pairing
// plumbing (synthetic token, fake static key) lives in launchPairedApp and is never echoed. No failure
// diagnostic serialises a token, key or plaintext.

// The reply travels a real send -> Noise -> decode -> render round-trip; generous headroom for a cold
// runner (the siblings' value).
const STREAM_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushes by envelope id, so one fixed id is reused across every frame.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// One send, answered with four TURNS (each an assistant_delta plus its turn_end, distinct turn_id) so each
// text lands in its own bubble and the trailing turn_end leaves no streaming cursor anywhere to perturb a
// measurement. Three of the four texts are read as COMPARISONS AGAINST THE FIRST, which is what keeps this
// spec free of magic numbers: no expected pixel height, no expected width, no font metric.
const CONTROL_TEXT = 'Alpha Beta' // one line, one internal space — the baseline both comparisons use.
const PARAGRAPH_TEXT = 'First paragraph.\n\nSecond paragraph.' // the blank line (AC1).
const SPACE_RUN_LENGTH = 24
// Collapses to EXACTLY the control once whitespace is normalised — so equal widths is the broken state
// (AC2). Built with repeat() rather than a literal run of spaces, which is invisible in source.
const SPACE_RUN_TEXT = `Alpha${' '.repeat(SPACE_RUN_LENGTH)}Beta`
// ~200 characters, alphanumeric only: no whitespace and no hyphen/slash, so it offers no break opportunity
// of its own and only the bubble's `word-break: break-word` can wrap it (AC3). Its whitespace-free-ness is
// also what makes the settle gate below non-vacuous under toHaveText's normalisation.
const LONG_TOKEN_TEXT = 'sha256deadbeefcafe'.repeat(12)
const REPLY_TEXTS = [CONTROL_TEXT, PARAGRAPH_TEXT, SPACE_RUN_TEXT, LONG_TOKEN_TEXT]

// The bubble indices the assertions read, named so a comparison says which text it is about.
const CONTROL = 0
const PARAGRAPHS = 1
const SPACE_RUN = 2
const LONG_TOKEN = 3

// A rendered box is a fractional CSS pixel; scrollWidth/clientWidth are rounded integers, so they can
// disagree by 1 on a box that does not actually overflow.
const SUBPIXEL_TOLERANCE_PX = 1

// The typed message. A fixed literal, distinct from every reply text, so the user bubble can never be
// mistaken for an assistant one by text.
const PROMPT_TEXT = 'answer me in several shapes'

// --- Spec-local frame builders (the seedConversationsFrame idiom): each seals one envelope through the
// production codec, deterministic id/ts. ---

const assistantDeltaFrame = (turn: number, text: string): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'assistant_delta',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: `turn-${turn}`,
      seq: 0,
      text
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

/**
 * One buildReplyFrames dispatching on the decoded inbound type. `send_message` -> the ordered four-turn
 * stream; every other inbound (the auto-fired `list_conversations`) -> the shared one-row seed, since a
 * scripted buildReplyFrames overrides the fixture's default arm.
 *
 * #448 regression guard, carried from send-and-stream: the send arm replies only when the inbound
 * `conversation_id` is the OPENED row's id. A client regression to a hardcoded/placeholder id gets no
 * reply frames and the stream wait times out, mirroring the real daemon's KnownConversation rejection.
 */
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  switch (envelope.type) {
    case 'send_message': {
      const payload = envelope.payload as SendMessagePayload
      if (payload.conversation_id !== SEEDED_ROW.id) return []
      return REPLY_TEXTS.flatMap((text, index) => [
        assistantDeltaFrame(index + 1, text),
        turnEndFrame(index + 1)
      ])
    }
    default:
      return [seedConversationsFrame()]
  }
}

interface BubbleMetrics {
  whiteSpace: string
  lineHeightPx: number
  height: number
  width: number
  scrollWidth: number
  clientWidth: number
}

/**
 * One assistant bubble's live style and geometry — the whole reason this proof lives in e2e. The line
 * height is read from the element's OWN computed style rather than from the --text-body-medium-line token,
 * so the height comparison stays true if the type scale is ever retuned.
 */
const readBubbleMetrics = (page: Page, index: number): Promise<BubbleMetrics> =>
  page
    .locator('.bubble[data-thread-role="assistant"]')
    .nth(index)
    .evaluate((el) => {
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return {
        whiteSpace: style.whiteSpace,
        lineHeightPx: parseFloat(style.lineHeight),
        height: box.height,
        width: box.width,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth
      }
    })

/** The thread scroll container's horizontal extent — a horizontal scrollbar iff these differ. */
const readThreadWidths = (page: Page): Promise<{ scrollWidth: number; clientWidth: number }> =>
  page
    .locator('.conversation__thread')
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))

/**
 * Drive one send and settle the four-turn reply before anything is measured.
 *
 * Waiting for the LAST bubble's exact text is the settle gate: its turn_end drops the streaming cursor, so
 * an exact match proves the whole stream landed and layout is final. That text is deliberately the
 * whitespace-free one — the single text in this spec on which `toHaveText`'s normalisation cannot make a
 * wait silently vacuous.
 */
async function streamTheFourReplies(page: Page): Promise<void> {
  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')

  await page.getByPlaceholder('Message…').fill(PROMPT_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(assistantBubbles).toHaveCount(REPLY_TEXTS.length, { timeout: STREAM_TIMEOUT_MS })
  await expect(assistantBubbles.nth(LONG_TOKEN)).toHaveText(LONG_TOKEN_TEXT)
}

test('an assistant reply keeps its paragraph breaks and its runs of spaces', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFourReplies(page)

  const control = await readBubbleMetrics(page, CONTROL)
  const paragraphs = await readBubbleMetrics(page, PARAGRAPHS)
  const spaceRun = await readBubbleMetrics(page, SPACE_RUN)

  // The rule reaches the element in the BUILT app — the class, the stylesheet and the cascade all line up.
  // This is the decision table asserted directly: it fails under `normal` (no rule at all), under
  // `pre-line` (which loses the space runs) and under `pre` (which stops wrapping) alike.
  expect(control.whiteSpace).toBe('pre-wrap')

  // AC1 — a blank line is a visible break. The paragraph bubble stands more than one line box taller than
  // the one-line control; under the collapsing default both bubbles are the same single-line height. This
  // is the assertion that covers the whole path: a daemon-supplied newline through codec, store and render
  // into layout.
  expect(paragraphs.height - control.height).toBeGreaterThan(control.lineHeightPx)

  // AC2 — runs of spaces survive. `.bubble` shrink-wraps to its content inside the flex `.message-row`
  // (up to max-width), and these two bubbles differ ONLY in collapsed spaces, so equal widths IS the
  // broken state and no threshold constant is needed.
  expect(spaceRun.width).toBeGreaterThan(control.width)
})

test('a long unbroken token in an assistant reply still wraps inside the bubble measure', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFourReplies(page)

  // AC3, and the guard against over-correcting the rule above to `white-space: pre`: under `pre` the token
  // does not wrap at all, so its content overflows the bubble's max-width and that overflow propagates to
  // the thread as a horizontal scrollbar. Both boxes fail there; both hold under `pre-wrap`, where
  // `.bubble`'s pre-existing `word-break: break-word` (conversation.css:298) does the breaking. (This test
  // passes against today's collapsing default too — it is a bound on the fix, not a proof of it.)
  const longToken = await readBubbleMetrics(page, LONG_TOKEN)
  expect(longToken.scrollWidth).toBeLessThanOrEqual(longToken.clientWidth + SUBPIXEL_TOLERANCE_PX)

  const thread = await readThreadWidths(page)
  expect(thread.scrollWidth).toBeLessThanOrEqual(thread.clientWidth + SUBPIXEL_TOLERANCE_PX)
})
