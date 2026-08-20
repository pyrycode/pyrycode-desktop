import type { Page, Locator } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// The assistant-bubble whitespace e2e (#607, reworked by #609) — the liveness proof for "an assistant
// reply's whitespace comes from the right place". It ships WITH the fix because it is the only tier that
// can prove it: vitest runs the `node` environment (vitest.config.ts:27), so renderer tests are
// renderToStaticMarkup strings with no DOM, no stylesheet and no layout. The unit tier pins WHICH element
// carries which rule (ConversationScreen.test.tsx); this one pins what the browser does with them.
//
// #609 MOVED THIS FILE'S SUBJECT, which is why it is reworked in place rather than joined by a sibling.
// A settled reply now renders as markdown and a still-growing tail as plain text, so #607's `pre-wrap`
// governs the TAIL only. The old AC2 assertion (`spaceRun.width > control.width`) was built so that equal
// widths IS the broken state; under markdown, equal widths is the CORRECT state, and the assertion below
// is its deliberate inverse. A second spec would have duplicated ~120 lines of frame-builder harness and
// left the invalidated assertions behind.
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
// plus its `turn_end`, repeated per turn — the send-and-stream stream, and the #601 multi-turn shape. The
// LAST turn is deliberately left open (a delta with no `turn_end`), which is equally real: it is the
// stream mid-flight, and it is the only way to put an in-progress tail on screen beside settled bubbles.
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

// One send, answered with five TURNS. The first four each carry an `assistant_delta` plus its `turn_end`,
// so each lands SETTLED in its own bubble; the fifth carries a delta only, so it is the in-progress tail.
// Three of the settled texts are read as COMPARISONS AGAINST THE FIRST, which is what keeps this spec free
// of magic numbers: no expected pixel height, no expected width, no font metric. The one number it does
// name — the 8px block rhythm — is read from the --space-2 token at runtime rather than written down.
const CONTROL_TEXT = 'Alpha Beta' // one markdown paragraph, one line — the baseline both comparisons use.
const SPACE_RUN_LENGTH = 24
// Differs from the control ONLY in collapsible whitespace, so under markdown's `normal` the two render
// identically and DIFFERING widths is the broken state. Built with repeat() rather than a literal run of
// spaces, which is invisible in source. Mid-line, so CommonMark reads no hard break and no indented code.
const SPACE_RUN_TEXT = `Alpha${' '.repeat(SPACE_RUN_LENGTH)}Beta`
// ~200 characters, alphanumeric only: no whitespace and no hyphen/slash, so it offers no break opportunity
// of its own and only `word-break: break-word` — inherited into the <pre> from .bubble — can wrap it.
const LONG_TOKEN_TEXT = 'sha256deadbeefcafe'.repeat(12)
// A fenced block, which is where the wrapping question actually lives: <pre> carries a UA
// `white-space: pre` DECLARATION that beats .bubble's inherited value, so the code body only wraps if
// .bubble__markdown re-declares pre-wrap (Figma 16:49).
const CODE_TEXT = ['```', LONG_TOKEN_TEXT, '```'].join('\n')
// Five consecutive markdown blocks. The first three are #609's, three DIFFERENT element types so a margin
// reset written narrowly (say `> p` only) fails the rhythm measurement the same way a missing one does;
// #628 reads the <h2> for its type quartet. The blockquote and the ordered list are #629's, and they carry
// all four of its nested cases: the quote holds a paragraph, a paragraph, a list and a nested quote, and
// the ordered list is LOOSE — blank lines between and inside its items — which is the only thing that makes
// react-markdown emit a <p> inside an <li>. (A tight item is bare inline content, which is why `- Gamma
// item` above yields `<li>Gamma item</li>` and no paragraph.) Its second item ends in a nested list, which
// puts a depth-2 list in the DOM for the indent monotonicity check.
//
// EXTENDED IN PLACE rather than answered with a sixth turn: the reply stream is indexed positionally
// (CONTROL / SPACE_RUN / CODE / RHYTHM / TAIL) and an added turn would shift every index above. No second
// <h2> for the same reason in reverse — #628's readHeadingTypeMetrics resolves `.bubble__markdown h2` and
// would go strict-mode ambiguous.
//
// Assembled with join('\n') — an indented template literal would put four leading spaces on each line,
// which CommonMark reads as an indented code block. The three leading spaces inside the ordered list are
// deliberate and are its items' content column, which is what makes the continuation lines part of the item
// rather than a new block.
const RHYTHM_TEXT = [
  'Alpha paragraph.',
  '',
  '## Beta heading',
  '',
  '- Gamma item',
  '',
  '> Delta quoted paragraph.',
  '>',
  '> Epsilon quoted paragraph.',
  '>',
  '> - Zeta quoted item',
  '>',
  '> > Eta nested quote.',
  '',
  '1. Theta first paragraph.',
  '',
  '   Iota second paragraph.',
  '',
  '2. Kappa first paragraph.',
  '',
  '   - Lambda nested item'
].join('\n')
const RHYTHM_BLOCK_COUNT = 5
// The blockquote's four children and each loose item's two, asserted as the vacuity guard on every nested
// measurement below: a fixture that stopped parsing the way CommonMark says it should would otherwise
// report empty gap arrays and pass every loop.
const RHYTHM_QUOTE_CHILD_COUNT = 4
const RHYTHM_LOOSE_ITEM_CHILD_COUNTS = [2, 2]
// Every ul/ol the fixture puts in the container: the tight `- Gamma item`, the one inside the blockquote,
// the loose <ol>, and the depth-2 list inside its second item.
const RHYTHM_LIST_COUNT = 4
// The still-streaming tail. SINGLE newlines, not blank lines, and that choice is what makes the height
// comparison discriminating: `pre-wrap` renders three line boxes, while CommonMark reads a single newline
// as a SOFT break and `normal` collapses it to a space, giving one. A blank-line fixture would not tell
// the two apart — markdown would render two paragraphs and stand taller too.
const TAIL_TEXT = ['First line.', 'Second line.', 'Third line.'].join('\n')

const SETTLED_TEXTS = [CONTROL_TEXT, SPACE_RUN_TEXT, CODE_TEXT, RHYTHM_TEXT]
const REPLY_TEXTS = [...SETTLED_TEXTS, TAIL_TEXT]

// The bubble indices the assertions read, named so a comparison says which text it is about.
const CONTROL = 0
const SPACE_RUN = 1
const CODE = 2
const RHYTHM = 3
const TAIL = 4

// A rendered box is a fractional CSS pixel; scrollWidth/clientWidth are rounded integers, so they can
// disagree by 1 on a box that does not actually overflow. The same tolerance absorbs subpixel drift in the
// box-to-box distances below.
const SUBPIXEL_TOLERANCE_PX = 1

// The width an `outside` list marker needs to the LEFT of the list's content box, at the bubble's
// body-medium. THE ONLY LITERALS EITHER #629 TEST INTRODUCES, and they are unavoidable: these are font
// metrics rather than theme values, ::marker exposes no geometry API, and e2e/ carries no screenshot or
// visual-regression tooling — so they came from a one-off pixel scan (render the marker on a white ground
// with the list's padding-inline-start zeroed, find the leftmost ink pixel in the item's row band). The
// scan measured 16 / 25 / 34 of actual ink; the figures below are the ticket's and are ~3px the
// conservative side of it, headroom that absorbs the font question — --font-sans falls back to system-ui
// because Roboto is not bundled (tokens.css:41-43), so digit advance widths are platform-dependent.
const SINGLE_DIGIT_MARKER_PX = 16
const TWO_DIGIT_MARKER_PX = 28
const THREE_DIGIT_MARKER_PX = 40

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
 * One buildReplyFrames dispatching on the decoded inbound type. `send_message` -> the ordered five-turn
 * stream (four closed, the last left open); every other inbound (the auto-fired `list_conversations`) ->
 * the shared one-row seed, since a scripted buildReplyFrames overrides the fixture's default arm.
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
      const settled = SETTLED_TEXTS.flatMap((text, index) => [
        assistantDeltaFrame(index + 1, text),
        turnEndFrame(index + 1)
      ])
      // The open tail: a delta with no turn_end, so this item stays the still-growing one.
      return [...settled, assistantDeltaFrame(REPLY_TEXTS.length, TAIL_TEXT)]
    }
    default:
      return [seedConversationsFrame()]
  }
}

const assistantBubble = (page: Page, index: number): Locator =>
  page.locator('.bubble[data-thread-role="assistant"]').nth(index)

interface BubbleMetrics {
  whiteSpace: string
  lineHeightPx: number
  height: number
  width: number
}

/**
 * One assistant bubble's live style and geometry — the whole reason this proof lives in e2e. The line
 * height is read from the element's OWN computed style rather than from the --text-body-medium-line token,
 * so the height comparison stays true if the type scale is ever retuned.
 */
const readBubbleMetrics = (page: Page, index: number): Promise<BubbleMetrics> =>
  assistantBubble(page, index).evaluate((el) => {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return {
      whiteSpace: style.whiteSpace,
      lineHeightPx: parseFloat(style.lineHeight),
      height: box.height,
      width: box.width
    }
  })

/** The computed `white-space` inside a settled bubble's markdown container. */
const readMarkdownWhiteSpace = (page: Page, index: number): Promise<string> =>
  assistantBubble(page, index)
    .locator('.bubble__markdown')
    .evaluate((el) => getComputedStyle(el).whiteSpace)

interface CodeMetrics {
  whiteSpace: string
  scrollWidth: number
  clientWidth: number
}

/** The <pre> a fenced block renders to, inside a settled bubble's container. */
const readCodeMetrics = (page: Page, index: number): Promise<CodeMetrics> =>
  assistantBubble(page, index)
    .locator('.bubble__markdown pre')
    .evaluate((el) => ({
      whiteSpace: getComputedStyle(el).whiteSpace,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth
    }))

interface RhythmMetrics {
  rowGapPx: number
  spaceTokenPx: number
  blockGapsPx: number[]
  firstOffsetPx: number
  lastOffsetPx: number
  blockCount: number
}

/**
 * The container's declared gap AND the distances actually measured between its blocks. Both halves are
 * needed: `row-gap` alone reads correct even when live UA block margins add 14-16px on top of it, so a
 * row-gap-only test would pass with the margin reset missing entirely. The expected value is read from the
 * --space-2 custom property rather than written as 8, so no spacing literal enters this spec either.
 *
 * `.bubble__markdown` declares no padding and no border, so its border box IS its content box and the
 * first/last offsets below are the flush-with-the-bubble check.
 */
const readRhythmMetrics = (page: Page, index: number): Promise<RhythmMetrics> =>
  assistantBubble(page, index)
    .locator('.bubble__markdown')
    .evaluate((el) => {
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      const blocks = Array.from(el.children).map((child) => child.getBoundingClientRect())
      return {
        rowGapPx: parseFloat(style.rowGap),
        spaceTokenPx: parseFloat(style.getPropertyValue('--space-2')),
        blockGapsPx: blocks.slice(1).map((rect, i) => rect.top - blocks[i].bottom),
        firstOffsetPx: blocks[0].top - box.top,
        lastOffsetPx: box.bottom - blocks[blocks.length - 1].bottom,
        blockCount: blocks.length
      }
    })

interface TypeQuartet {
  fontSize: string
  lineHeight: string
  letterSpacing: string
  fontWeight: string
}

interface HeadingTypeMetrics {
  computed: TypeQuartet
  token: TypeQuartet
}

/**
 * A heading's live type quartet inside a settled bubble's container, beside the four --text-title-large-*
 * tokens read off that same element. Both halves come from one evaluate so the comparison is against the
 * scale rather than against `22px` written down — the --space-2 idiom of readRhythmMetrics above, and what
 * keeps this spec free of type literals too.
 *
 * The fixture's heading is the RHYTHM block's `<h2>`. One level of six is enough: it proves the class of
 * failure that matters (a heading typed by the UA stylesheet rather than by the theme), and the reply
 * stream is indexed positionally, so adding a turn to reach another level would shift every index above.
 */
const readHeadingTypeMetrics = (page: Page, index: number): Promise<HeadingTypeMetrics> =>
  assistantBubble(page, index)
    .locator('.bubble__markdown h2')
    .evaluate((el) => {
      const style = getComputedStyle(el)
      // Blink serialises a computed letter-spacing of zero as the `normal` keyword, and title-large's
      // tracking token is `0px` — one computed value spelled two ways. Both sides pass through this, so
      // the comparison is over values and not over spellings.
      const tracking = (value: string): string => {
        const trimmed = value.trim()
        return trimmed === 'normal' ? '0px' : trimmed
      }
      return {
        computed: {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          letterSpacing: tracking(style.letterSpacing),
          fontWeight: style.fontWeight
        },
        token: {
          fontSize: style.getPropertyValue('--text-title-large-size').trim(),
          lineHeight: style.getPropertyValue('--text-title-large-line').trim(),
          letterSpacing: tracking(style.getPropertyValue('--text-title-large-tracking')),
          fontWeight: style.getPropertyValue('--text-title-large-weight').trim()
        }
      }
    })

interface NestedRhythmMetrics {
  spaceTokenPx: number
  quoteChildCount: number
  quoteGapsPx: number[]
  looseItemChildCounts: number[]
  looseItemGapsPx: number[][]
  looseItemToItemGapsPx: number[]
}

/**
 * The distances between blocks ONE LEVEL INSIDE a blockquote and a loose list item, beside the --space-2
 * token read off the same element — readRhythmMetrics' idiom, and what keeps this half free of a spacing
 * literal too. readRhythmMetrics itself cannot answer this: it reads `el.children`, direct children only,
 * so the nested half has no coverage without a measurement of its own.
 *
 * Both halves of the pair matter. `.bubble__markdown`'s flex `gap` applies strictly between flex ITEMS, and
 * a blockquote and an <li> are block boxes whose children stack in normal flow — so these gaps are NOT the
 * container's gap reaching one level down. They come from the UA's margin until a rule replaces it, which
 * means 0px fails this measurement exactly as surely as the UA's 14px does.
 */
const readNestedRhythmMetrics = (page: Page, index: number): Promise<NestedRhythmMetrics> =>
  assistantBubble(page, index)
    .locator('.bubble__markdown')
    .evaluate((el) => {
      const gapsWithin = (parent: Element): number[] => {
        const rects = Array.from(parent.children).map((child) => child.getBoundingClientRect())
        return rects.slice(1).map((rect, i) => rect.top - rects[i].bottom)
      }
      // Document order, so this is the OUTER blockquote rather than the one nested inside it.
      const quote = el.querySelector('blockquote')
      if (!quote) throw new Error('the RHYTHM fixture rendered no blockquote')
      const looseItems = Array.from(el.querySelectorAll('ol > li'))
      const itemRects = looseItems.map((item) => item.getBoundingClientRect())
      return {
        spaceTokenPx: parseFloat(getComputedStyle(el).getPropertyValue('--space-2')),
        quoteChildCount: quote.children.length,
        quoteGapsPx: gapsWithin(quote),
        looseItemChildCounts: looseItems.map((item) => item.children.length),
        looseItemGapsPx: looseItems.map((item) => gapsWithin(item)),
        looseItemToItemGapsPx: itemRects.slice(1).map((rect, i) => rect.top - itemRects[i].bottom)
      }
    })

interface ListIndentMetrics {
  spaceTokenPx: number
  bubbleContentLeftPx: number
  bubblePaddingLeftPx: number
  threadPaddingLeftPx: number
  lists: {
    paddingInlineStartPx: number
    contentLeftPx: number
    ancestorContentLeftPx: number | null
  }[]
}

/**
 * Every list's declared indent and the three boxes the marker budget is arithmetic over: the list's own
 * content edge, the bubble's, and the thread's inline padding. One evaluate returns the measurements AND
 * the --space-4 token off the same element, so the expected side is the scale rather than `16` written
 * down.
 *
 * The thread's padding is reached with closest() rather than a second locator so every number in the
 * comparison is read at the same moment, from the same layout.
 */
const readListIndentMetrics = (page: Page, index: number): Promise<ListIndentMetrics> =>
  assistantBubble(page, index)
    .locator('.bubble__markdown')
    .evaluate((el) => {
      const contentLeft = (node: Element): number => {
        const style = getComputedStyle(node)
        return (
          node.getBoundingClientRect().left +
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.paddingLeft)
        )
      }
      const bubble = el.closest('.bubble')
      const thread = el.closest('.conversation__thread')
      if (!bubble || !thread) throw new Error('the markdown container has no .bubble/.conversation__thread')
      return {
        spaceTokenPx: parseFloat(getComputedStyle(el).getPropertyValue('--space-4')),
        bubbleContentLeftPx: contentLeft(bubble),
        bubblePaddingLeftPx: parseFloat(getComputedStyle(bubble).paddingLeft),
        threadPaddingLeftPx: parseFloat(getComputedStyle(thread).paddingLeft),
        lists: Array.from(el.querySelectorAll('ul, ol')).map((list) => {
          // parentElement first: closest() would match the list itself.
          const ancestor = list.parentElement?.closest('ul, ol') ?? null
          return {
            paddingInlineStartPx: parseFloat(getComputedStyle(list).paddingInlineStart),
            contentLeftPx: contentLeft(list),
            ancestorContentLeftPx: ancestor ? contentLeft(ancestor) : null
          }
        })
      }
    })

/** The thread scroll container's horizontal extent — a horizontal scrollbar iff these differ. */
const readThreadWidths = (page: Page): Promise<{ scrollWidth: number; clientWidth: number }> =>
  page
    .locator('.conversation__thread')
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))

/**
 * Drive one send and settle the five-turn reply before anything is measured.
 *
 * The gate is the SETTLED code bubble's exact text: its turn_end has landed, so an exact match proves the
 * stream reached at least that far and that the markdown path produced it. That text is deliberately the
 * whitespace-free one — the single text in this spec on which `toHaveText`'s normalisation cannot make a
 * wait silently vacuous. The bubble count then covers the open tail, which carries no turn_end to wait on.
 */
async function streamTheFiveReplies(page: Page): Promise<void> {
  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')

  await page.getByPlaceholder('Message…').fill(PROMPT_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(assistantBubbles).toHaveCount(REPLY_TEXTS.length, { timeout: STREAM_TIMEOUT_MS })
  await expect(assistantBubbles.nth(CODE)).toHaveText(LONG_TOKEN_TEXT)
}

test('#607s plain-text rule governs the in-progress tail, and markdown owns the settled bubble', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFiveReplies(page)

  const control = await readBubbleMetrics(page, CONTROL)
  const tail = await readBubbleMetrics(page, TAIL)

  // The modifier still reaches the tail in the BUILT app — the class, the stylesheet and the cascade all
  // line up. It fails under `normal` (no rule at all), under `pre-line` (which loses the space runs) and
  // under `pre` (which stops wrapping) alike.
  expect(tail.whiteSpace).toBe('pre-wrap')
  // ...and no longer reaches a settled bubble, nor anything inside its container. This is the AC3
  // by-construction half: whitespace is markdown's by the ABSENCE of a declaration, not by an override.
  expect(control.whiteSpace).toBe('normal')
  expect(await readMarkdownWhiteSpace(page, CONTROL)).toBe('normal')

  // The geometric half, so this is not purely a style assertion: the tail's newlines are VISIBLE breaks,
  // standing its three lines more than one line box taller than the one-line settled control. Both are
  // .bubble, so the padding cancels, and the cursor is inline and adds no height. Under a collapsing tail —
  // whether by losing the rule or by markdown-rendering the tail, which would fold those soft breaks into
  // one line — the two bubbles are the same height. This is the assertion that covers the whole path: a
  // daemon-supplied newline through codec, store and render into layout.
  expect(tail.height - control.height).toBeGreaterThan(control.lineHeightPx)
})

test('a settled reply takes its whitespace from markdown, not from the plain-text rule', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFiveReplies(page)

  const control = await readBubbleMetrics(page, CONTROL)
  const spaceRun = await readBubbleMetrics(page, SPACE_RUN)

  // AC3, and the deliberate INVERSE of the assertion #607 shipped here. These two sources differ only in
  // collapsible whitespace: a soft-wrapped paragraph keeps its source spacing under `pre-wrap` (the old
  // rendering, where the space-run bubble measured visibly wider) and collapses to the control under
  // markdown's `normal`. `.bubble` shrink-wraps to its content inside the flex `.message-row` (up to
  // max-width), so equal boxes is the whole claim and no threshold constant is needed.
  expect(Math.abs(spaceRun.width - control.width)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
  expect(Math.abs(spaceRun.height - control.height)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
})

test('a fenced code block wraps inside the bubble measure rather than spilling out of it', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFiveReplies(page)

  // AC3's code half. <pre>'s UA `white-space: pre` is a declaration on the element and beats .bubble's
  // inherited value whatever its origin, so without .bubble__markdown pre re-declaring pre-wrap the token
  // does not wrap at all: its content overflows the <pre>, and that overflow propagates to the thread as a
  // horizontal scrollbar. Both boxes fail there; both hold once it wraps, where .bubble's pre-existing
  // `word-break: break-word` (conversation.css:298) — inherited, deliberately not restated — does the
  // breaking. Keeping the thread check is the over-correction guard #607 carried.
  const code = await readCodeMetrics(page, CODE)
  expect(code.whiteSpace).toBe('pre-wrap')
  expect(code.scrollWidth).toBeLessThanOrEqual(code.clientWidth + SUBPIXEL_TOLERANCE_PX)

  const thread = await readThreadWidths(page)
  expect(thread.scrollWidth).toBeLessThanOrEqual(thread.clientWidth + SUBPIXEL_TOLERANCE_PX)
})

test('consecutive markdown blocks sit one spacing token apart, flush at the bubble edges', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFiveReplies(page)

  const rhythm = await readRhythmMetrics(page, RHYTHM)

  // The three blocks are three different element types (p / h2 / ul), so the measurements below fail
  // against a margin reset narrow enough to miss one of them.
  expect(rhythm.blockCount).toBe(RHYTHM_BLOCK_COUNT)

  // AC4 — the declared rhythm is the token, not a literal.
  expect(rhythm.rowGapPx).toBe(rhythm.spaceTokenPx)

  // ...and the MEASURED rhythm is that same value. This is the load-bearing half: live UA block margins
  // would add ~14-16px on top of the gap while `row-gap` still read 8px.
  for (const gap of rhythm.blockGapsPx) {
    expect(Math.abs(gap - rhythm.spaceTokenPx)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
  }

  // AC4's other half — the first and last block add no extra space inside the bubble. Free from flex
  // `gap`, which applies strictly BETWEEN items, once the UA margins are gone.
  expect(Math.abs(rhythm.firstOffsetPx)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
  expect(Math.abs(rhythm.lastOffsetPx)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
})

test('a markdown heading is typed from one step of the scale, not by the browser', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFiveReplies(page)

  const heading = await readHeadingTypeMetrics(page, RHYTHM)

  // #628's AC1 and AC5 — the three things review can only confirm by eye. That a rule under the container
  // REACHES a heading at all: without one this <h2> keeps the UA stylesheet's 1.5em/bold, which is neither
  // the step's size nor any weight the scale carries (it holds 400 and 500 only). That its values come from
  // the SCALE and not from literals: the expected side is the element's own custom properties, so a
  // hand-written `22px` in the rule would still pass while a hand-written `21px` could not — which is why
  // the no-literal claim rests on the diff at review and this test carries the rest. And that all four
  // properties come from ONE step: a quartet mixed from two steps fails on whichever property was taken
  // from elsewhere.
  //
  // Deliberately the whole quartet in one compare, so a failure names every property that drifted rather
  // than stopping at the first.
  expect(heading.computed).toEqual(heading.token)
})

test('consecutive blocks one level inside a list item or a blockquote sit that same token apart', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFiveReplies(page)

  const nested = await readNestedRhythmMetrics(page, RHYTHM)

  // The vacuity guard, before any gap is compared: an empty children list produces an empty gap array, and
  // every loop below would then pass over nothing.
  expect(nested.quoteChildCount).toBe(RHYTHM_QUOTE_CHILD_COUNT)
  expect(nested.looseItemChildCounts).toEqual(RHYTHM_LOOSE_ITEM_CHILD_COUNTS)

  // #629's AC4. Three of its four named cases live in the blockquote — a paragraph after a paragraph, a
  // list after a paragraph, a blockquote after a list — and the container's :361 reset cannot reach any of
  // them, being direct-child only. RED at the UA's 14px before the fix; note that 0px is a failure here
  // too, which is the whole point of the criterion: a rule that merely zeroed the leftover would leave
  // these blocks touching, since flex `gap` never applies inside a block box.
  for (const gap of nested.quoteGapsPx) {
    expect(Math.abs(gap - nested.spaceTokenPx)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
  }

  // AC4's fourth case: the two paragraphs of a loose list item, and the paragraph-then-nested-list of the
  // second one.
  for (const gaps of nested.looseItemGapsPx) {
    for (const gap of gaps) {
      expect(Math.abs(gap - nested.spaceTokenPx)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
    }
  }

  // The item boundary itself, which is where zeroing the leftover creates a regression rather than fixing
  // one: today these items are held apart by exactly the 14px margin the reset removes, so without a step
  // restored between them an item's own paragraphs would sit further apart than the items do.
  for (const gap of nested.looseItemToItemGapsPx) {
    expect(Math.abs(gap - nested.spaceTokenPx)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX)
  }
})

test('a list indents from the spacing scale and leaves its marker room to paint', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })

  await streamTheFiveReplies(page)

  const indent = await readListIndentMetrics(page, RHYTHM)

  // Vacuity guard again — an empty list array passes the loop below trivially.
  expect(indent.lists.length).toBe(RHYTHM_LIST_COUNT)

  for (const list of indent.lists) {
    // #629's AC1, and the assertion carrying the RED: the UA stylesheet indents these 40px. Asserted on
    // EVERY list in the container rather than on a chosen one, which is what discharges "at every nesting
    // depth" for the indent — one value, all depths, no enumeration.
    expect(list.paddingInlineStartPx).toBe(indent.spaceTokenPx)

    if (list.ancestorContentLeftPx === null) {
      // A list at the container's own level keeps its text column inside the bubble's content box.
      expect(list.contentLeftPx).toBeGreaterThanOrEqual(
        indent.bubbleContentLeftPx - SUBPIXEL_TOLERANCE_PX
      )
    } else {
      // ...and a nested one sits strictly right of the list that holds it. Indent COMPOUNDS with depth, so
      // nesting only ever adds slack to the marker budget below and depth 1 is its worst case.
      expect(list.contentLeftPx).toBeGreaterThan(list.ancestorContentLeftPx)
    }
  }

  // AC2, as box arithmetic over the indent and the two inline paddings. Be honest about what this half is:
  // a BOUND, not a regression detector. All three hold at the UA's 40px as well, and they fire only if
  // someone later narrows the indent, widens .bubble's inline padding or narrows the thread's. The RED for
  // this test comes from the token assertion above. A pixel assertion on the marker itself is out of scope
  // — see the marker constants for why.
  //
  // `list-style-position` defaults to `outside`, so the marker paints to the LEFT of the content box the
  // loop above just pinned. Note also that readThreadWidths (below) cannot stand in for any of this:
  // scrollWidth is blind to overflow on the left, which is the side a marker overhangs.
  expect(indent.spaceTokenPx).toBeGreaterThanOrEqual(SINGLE_DIGIT_MARKER_PX)
  // A two-digit marker overhangs into .bubble's own inline padding, and the bubble's fill paints its
  // padding box — so it lands on the bubble rather than beside it.
  expect(TWO_DIGIT_MARKER_PX - indent.spaceTokenPx).toBeLessThanOrEqual(indent.bubblePaddingLeftPx)
  // A three-digit one reaches past the bubble into the thread's inline padding. That is still not clipped:
  // .conversation__thread declares overflow-y: auto, so its other axis computes to `auto` and a scroll
  // container clips at its PADDING box — and left-side overflow in LTR is unreachable by scrolling, which
  // makes this a hard edge rather than a scrollbar.
  expect(THREE_DIGIT_MARKER_PX - indent.spaceTokenPx).toBeLessThanOrEqual(
    indent.bubblePaddingLeftPx + indent.threadPaddingLeftPx
  )
})
