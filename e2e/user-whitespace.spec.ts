import type { Page, Locator } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { bubbleTextExactly } from './fixtures/bubbleText'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { QueuedItem, QueueStatePayload } from '../src/shared/wire/types'

// The user-bubble whitespace e2e (#1057) — the liveness proof for "a message draws the way it was typed".
// It ships WITH the fix because it is the only tier that can prove it: vitest runs the `node` environment,
// so renderer specs are renderToStaticMarkup strings with no DOM, no stylesheet and no layout, and the
// markup here is byte-identical before and after (the fix is one CSS declaration on .bubble--user, no
// class added at any call site). Nothing in the unit tier can observe a computed `white-space`.
//
// A NEW SIBLING rather than an extension of assistant-whitespace.spec.ts, which is #607's proof for the
// other branch: that file's harness is the assistant delta/turn_end frame builder, which this ticket does
// not need, and its own AC requires its existing assertions untouched — the assistant bubble is unchanged
// here in both of its branches (settled markdown and streaming tail).
//
// THE VACUITY TRAP THIS SPEC IS WRITTEN AROUND, recorded at length in assistant-whitespace.spec.ts's
// header: `toHaveText` / `toContainText` hardcode `normalizeWhiteSpace: true` on BOTH their string and
// their regex branch — the actual text is trimmed and every whitespace run collapsed to a single space
// BEFORE comparison. A multi-line text expectation therefore passes identically against the broken and the
// fixed build. Every whitespace assertion below is instead a computed style or a measured box, read
// through `locator.evaluate()`. The one text assertion in this file (`bubbleTextExactly`) is deliberately
// NOT a whitespace assertion — it is there to say the bubble's text is intact and its meta row is still
// the only thing after it.
//
// EVERY FIXTURE DIFFERS FROM ITS CONTROL ONLY IN COLLAPSIBLE WHITESPACE, which is what keeps the
// comparisons discriminating: under the broken build the two measure EQUAL, so equal is the broken state
// and every assertion below is an inequality or a delta against a control read at runtime. No expected
// pixel height, no expected width, no font metric — the only lengths named are read off the live elements
// (`line-height`, the meta row's own box and margin, the parent row's width).
//
// EVERY PUSHED FRAME IS ONE A REAL DAEMON PRODUCES (the standing fake-tier rule): a `conversations` seed
// and a `queue_state` snapshot. The delivered rows are planted through a REAL composer send — the fake
// no-ops `send_message`, so the optimistic echo renders on its own and stays (the
// queued-backlog-interrupt.spec.ts precedent).
//
// SECRET HYGIENE (carried from the siblings): every assertion reads computed style, geometry, counts or
// normalized text; the message texts, conversation_id and queued ids are non-secret display & routing
// literals. The pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is never
// echoed. No failure diagnostic serialises a token, key or plaintext.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; generous headroom for a
// cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes pushes
// by envelope id, so one fixed id is reused across every pushed frame.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// A rendered box is a fractional CSS pixel; scrollWidth/clientWidth are rounded integers, so they can
// disagree by 1 on a box that does not actually overflow. The same tolerance absorbs subpixel drift in the
// height and width deltas below. (assistant-whitespace.spec.ts records the same caveat for the same read.)
const SUBPIXEL_TOLERANCE_PX = 1

// --- The delivered fixtures, sent in this order and read back by index. ---

// One line, and DELIBERATELY LONGER THAN THE META ROW: the bubble is a shrink-to-fit flex item, so a text
// narrower than the `DD.MM.YYYY - HH:MM` stamp plus the copy glyph would leave the bubble's width floored
// by the meta row and every width comparison below reading the same number twice.
const CONTROL_TEXT = 'Alpha Beta Gamma Delta Epsilon'
// Built with repeat() rather than a literal run, which is invisible in source. MID-LINE, so composerSend's
// `text.trim()` — which is out of scope and untouched — cannot reach it. Sixteen is wide enough to clear
// the tolerance by two orders of magnitude and narrow enough that the bubble still cannot wrap: the height
// assertion beside the width one is what makes that a checked assumption rather than a hope.
const SPACE_RUN_LENGTH = 16
const SPACE_RUN_TEXT = CONTROL_TEXT.replace(' Beta', `${' '.repeat(SPACE_RUN_LENGTH)}Beta`)
// SINGLE newlines. Joined so the newlines are visible in source. Under `normal` this collapses to one
// 36-character line — one line box, exactly the control's height — so the height delta is the whole
// detector.
const LINE_BREAKS_TEXT = ['First line.', 'Second line.', 'Third line.'].join('\n')
// A BLANK line between two paragraphs: three line boxes under pre-wrap, the middle one empty. Distinct
// from LINE_BREAKS above, which proves only that a break survives — this is the AC's second half, that the
// blank line is itself a line and not a swallowed one.
const BLANK_LINE_TEXT = ['First paragraph.', '', 'Second paragraph.'].join('\n')
// A leading indent on the SECOND line — never the first, which `trim()` would take. Its twin is the first
// line of the same bubble, so this fixture carries its own control and needs no second send.
const INDENT_WIDTH = 6
const INDENT_TEXT = ['Alpha line.', `${' '.repeat(INDENT_WIDTH)}Indented line.`].join('\n')
// ~216 characters, alphanumeric only: no whitespace and no hyphen/slash, so it offers no break opportunity
// of its own and only .bubble's existing `word-break: break-word` can wrap it.
const LONG_TOKEN_TEXT = 'sha256deadbeefcafe'.repeat(12)

const DELIVERED_TEXTS = [
  CONTROL_TEXT,
  SPACE_RUN_TEXT,
  LINE_BREAKS_TEXT,
  BLANK_LINE_TEXT,
  INDENT_TEXT,
  LONG_TOKEN_TEXT
]

// The bubble indices the assertions read, named so a comparison says which text it is about.
const CONTROL = 0
const SPACE_RUN = 1
const LINE_BREAKS = 2
const BLANK_LINE = 3
const INDENT = 4
const LONG_TOKEN = 5

// --- The queued fixtures. The queued row's text is DAEMON-SUPPLIED (QueuedItem.text over `queue_state`,
// not the local echo), so the trim caveat does not apply to it and `pre-wrap` here preserves whitespace a
// hostile daemon chose. The third item is that case, and it is asserted as containment rather than
// assumed. ---
const QUEUED_CONTROL: QueuedItem = { queued_msg_id: 1, text: CONTROL_TEXT, ts: FIXED_TS }
const QUEUED_LINE_BREAKS: QueuedItem = { queued_msg_id: 2, text: LINE_BREAKS_TEXT, ts: FIXED_TS }
const QUEUED_HOSTILE: QueuedItem = {
  queued_msg_id: 3,
  text: `${LONG_TOKEN_TEXT}${' '.repeat(200)}`,
  ts: FIXED_TS
}
const QUEUED_ITEMS = [QUEUED_CONTROL, QUEUED_LINE_BREAKS, QUEUED_HOSTILE]
const QUEUED_CONTROL_INDEX = 0
const QUEUED_LINE_BREAKS_INDEX = 1
const QUEUED_HOSTILE_INDEX = 2

/**
 * A replacement-truth queue snapshot (queueStore's #293 contract), sealed through the production codec.
 * `conversation_id` MUST be SEEDED_ROW.id: ConversationScreen selects the backlog for the ACTIVE
 * conversation, and list-open records the clicked seeded row as active, so a snapshot under any other id
 * lands in the store and is selected by nothing — zero rows, silently. (Fact 1 of
 * queued-backlog-interrupt.spec.ts's header; fact 2 — push only AFTER launch resolves, since every
 * `connected` resets the reconnecting server's backlogs, which with one server is all of them (#1138)
 * — is observed in the drive below.)
 */
function queueStateFrame(items: readonly QueuedItem[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'queue_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, queued: [...items] } satisfies QueueStatePayload
  })
}

/**
 * `send_message` is answered with NOTHING, which is what leaves the optimistic echo standing as the
 * delivered row this spec measures. Every other inbound (the auto-fired `list_conversations`) gets the
 * shared one-row seed, since a scripted buildReplyFrames overrides the fixture's default arm.
 */
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  return envelope.type === 'send_message' ? [] : [seedConversationsFrame()]
}

const userBubble = (page: Page, index: number): Locator =>
  page.locator('.bubble[data-thread-role="user"]').nth(index)

const queuedBubble = (page: Page, index: number): Locator =>
  page.locator('.bubble[data-thread-role="queued"]').nth(index)

interface BubbleMetrics {
  whiteSpace: string
  lineHeightPx: number
  height: number
  width: number
  scrollWidth: number
  clientWidth: number
  /** The row the bubble is laid out in — the box it must stay inside. */
  rowWidth: number
}

/**
 * One bubble's live style and geometry — the whole reason this proof lives in e2e. The line height is read
 * from the element's OWN computed style rather than from the --text-body-medium-line token, so every
 * height comparison below stays true if the type scale is ever retuned.
 */
const readBubbleMetrics = (bubble: Locator): Promise<BubbleMetrics> =>
  bubble.evaluate((el) => {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    const row = el.parentElement?.getBoundingClientRect()
    if (!row) throw new Error('the bubble has no parent row to measure its containing block against')
    return {
      whiteSpace: style.whiteSpace,
      lineHeightPx: parseFloat(style.lineHeight),
      height: box.height,
      width: box.width,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      rowWidth: row.width
    }
  })

/** Where one character of the bubble's message text is actually painted. */
interface CharBox {
  left: number
  top: number
}

/**
 * Three characters of the bubble's own text node, located by Range — the read that can see an indent at
 * all. A width comparison would need a second, un-indented send to compare against and would still not say
 * WHICH line moved, and a bubble-wide `getClientRects()` cannot be counted as line boxes: Blink splits the
 * range at the preserved newline, so a two-line text reports THREE rects (measured, not assumed — an
 * earlier draft of this spec asserted a count of 2 and read 3).
 *
 * Per-CHARACTER ranges sidestep that entirely: each is one glyph position, so `left`/`top` mean the same
 * thing however the browser fragments the range around it.
 *
 * `el.firstChild` and not a query: the message text is written as the bubble's first child in
 * ConversationScreen's userText arm, before the attachment slots and the meta row. Asserted rather than
 * assumed — a structure change that moved it would throw here rather than silently measure the wrong node.
 */
const readCharBoxes = (bubble: Locator, offsets: readonly number[]): Promise<CharBox[]> =>
  bubble.evaluate((el, charOffsets) => {
    const node = el.firstChild
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      throw new Error("the bubble's first child is not the message text node")
    }
    return charOffsets.map((offset) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      const rect = range.getBoundingClientRect()
      return { left: rect.left, top: rect.top }
    })
  }, offsets)

interface StackMetrics {
  /** The bubble's content box height — what its children actually occupy. */
  contentHeight: number
  metaHeight: number
  metaMarginTop: number
  /** The computed `white-space` of the bubble's element children, which must NOT be the message's. */
  childWhiteSpaces: string[]
}

/**
 * The delivered bubble's content box beside the meta row that shares it. THE STRAY-BLANK DETECTOR: with
 * `pre-wrap` inherited by every child, a whitespace text node between the message text and the meta row
 * would render as an extra line box, and `contentHeight` would then exceed the text's own lines plus the
 * meta row by exactly one line height. (No such node exists — the JSX transform drops a whitespace-only
 * run containing a newline — but "no stray blank renders" is the one structural claim this change makes,
 * so it is measured rather than reasoned about.)
 */
const readStackMetrics = (bubble: Locator): Promise<StackMetrics> =>
  bubble.evaluate((el) => {
    const style = getComputedStyle(el)
    const meta = el.querySelector('.bubble__meta')
    if (!meta) throw new Error('the delivered user bubble has no meta row')
    const metaStyle = getComputedStyle(meta)
    return {
      contentHeight:
        el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      metaHeight: meta.getBoundingClientRect().height,
      metaMarginTop: parseFloat(metaStyle.marginTop),
      childWhiteSpaces: Array.from(el.children, (child) => getComputedStyle(child).whiteSpace)
    }
  })

/** Plant one delivered row through a real composer send, waiting for the echo before the next. */
const send = async (page: Page, text: string, expectedCount: number): Promise<void> => {
  await page.getByPlaceholder('Message…').fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(expectedCount, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
}

test('a user message draws the line breaks, blank lines, space runs and indents it was typed with', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  // --- Plant the six delivered rows. Sent one at a time and awaited, so their order in the thread — and
  // therefore every index above — is the order they are declared in. ---
  for (const [index, text] of DELIVERED_TEXTS.entries()) {
    await send(page, text, index + 1)
  }

  const control = await readBubbleMetrics(userBubble(page, CONTROL))

  // --- The declaration itself. Every measurement below is what says it is doing something. ---
  expect(control.whiteSpace).toBe('pre-wrap')

  // --- AC1, the line breaks: three lines stand three line boxes tall. Under the initial `normal` the
  // three collapse onto one line and this delta is 0, which is exactly the defect. ---
  const lineBreaks = await readBubbleMetrics(userBubble(page, LINE_BREAKS))
  expect(lineBreaks.height - control.height).toBeCloseTo(2 * control.lineHeightPx, 0)
  // The text is intact and its meta-row stamp is still the only thing after it — the guard that no
  // measurement above would notice, since a stray whitespace child would move every bubble's box by the
  // same amount and cancel out of every delta.
  //
  // THE EXPECTATION CARRIES THE RAW NEWLINES, and that is a measured fact about this Playwright rather
  // than an oversight: `toHaveText` was handed `bubbleTextExactly('First line. Second line. Third
  // line.')` first — the collapsed spelling its `normalizeWhiteSpace: true` implies — and it FAILED,
  // reporting a received string that still held both newlines. So the normalisation the sibling spec's
  // header warns about does not reach a RegExp's received text here. It costs this file nothing (this
  // assertion is about structure, not whitespace) and it costs the existing tier nothing (every other
  // `toHaveText` over a user bubble reads a single-line, single-space text — `/clear`, `/compact`,
  // `hello from the composer` — where collapsing is a no-op either way), but a spec asserting a
  // multi-line bubble's text must expect the newlines, not the collapse.
  await expect(userBubble(page, LINE_BREAKS)).toHaveText(bubbleTextExactly(LINE_BREAKS_TEXT))

  // --- AC1, the blank line: two paragraphs with an empty line between them stand three line boxes tall,
  // not two. `pre-line` would satisfy this one too, which is why AC2's two below are separate. ---
  const blankLine = await readBubbleMetrics(userBubble(page, BLANK_LINE))
  expect(blankLine.height - control.height).toBeCloseTo(2 * control.lineHeightPx, 0)

  // --- AC2, the interior space run. WIDER than the control, at the SAME height: the second half is what
  // says the extra width is a preserved run and not a wrap, and it fails loudly if the fixture ever grows
  // wide enough to hit .bubble's max-width. Under `normal` (and under `pre-line`) both widths are equal. ---
  const spaceRun = await readBubbleMetrics(userBubble(page, SPACE_RUN))
  expect(spaceRun.height).toBeCloseTo(control.height, 0)
  expect(spaceRun.width).toBeGreaterThan(control.width + SUBPIXEL_TOLERANCE_PX)

  // --- AC2, the leading indent on a line that is not the first, read at three glyph positions: the first
  // character of line 1, the first SPACE of line 2's indent, and the first character of line 2's WORD.
  //
  // Three assertions, and each one alone would be satisfied by a build that is wrong in a different way.
  // (a) the indent's space sits BELOW line 1 — under the initial `normal` the two lines collapse onto one
  // and the tops are equal, which is the defect. (b) it sits at line 1's own left edge, so line 2 begins
  // at the start of a line rather than as the continuation of a wrap. (c) the word begins to the RIGHT of
  // it, which is the indent occupying real width; a `left` comparison against line 1's first character
  // instead would pass under `normal` too, where the word merely follows "Alpha line. " on the same line.
  const [lineOneStart, indentStart, wordStart] = await readCharBoxes(userBubble(page, INDENT), [
    0,
    INDENT_TEXT.indexOf('\n') + 1,
    INDENT_TEXT.indexOf('Indented')
  ])
  expect(indentStart.top).toBeGreaterThan(lineOneStart.top + SUBPIXEL_TOLERANCE_PX)
  expect(indentStart.left).toBeCloseTo(lineOneStart.left, 0)
  expect(wordStart.left).toBeGreaterThan(indentStart.left + SUBPIXEL_TOLERANCE_PX)

  // --- AC3, the long unbroken token. An OVERFLOW read, never a width read: .bubble carries
  // `max-width: min(680px, 75%)`, so its box cannot widen whatever `white-space` says and a
  // boundingBox().width assertion here could never redden. What `pre` would change is that the text stops
  // wrapping and spills out of a box that stays the same size. Verified to redden by building once with
  // `pre` before settling on `pre-wrap`. ---
  const longToken = await readBubbleMetrics(userBubble(page, LONG_TOKEN))
  expect(longToken.scrollWidth).toBeLessThanOrEqual(longToken.clientWidth + SUBPIXEL_TOLERANCE_PX)
  // The box itself stays inside the row it is laid out in. Bounded against the ROW and not against
  // `0.75 * rowWidth`: the percentage in .bubble's `min(680px, 75%)` does not resolve against this
  // element's parent rect (measured — the token bubble is 485 wide in a 594-wide row, 82%), so a
  // re-derivation of the max-width chain here would assert a number this spec got wrong rather than the
  // containment it actually cares about.
  expect(longToken.width).toBeLessThanOrEqual(longToken.rowWidth + SUBPIXEL_TOLERANCE_PX)

  // --- The stray-blank guard: the control bubble's content is exactly one line of text plus the meta row
  // and its margin. `pre-wrap` now reaches every child of the bubble; a preserved whitespace text node
  // between the text and the meta row would add a line box here. ---
  const stack = await readStackMetrics(userBubble(page, CONTROL))
  expect(stack.contentHeight).toBeCloseTo(
    control.lineHeightPx + stack.metaHeight + stack.metaMarginTop,
    0
  )

  // --- ...and the rule stops at the message text. The bubble's ELEMENT children — the attachment rows,
  // the image fallback, the meta row — are chrome and filenames, and none of them wants the treatment.
  // The reset is structural (`.bubble--user > *`) rather than a list of the classes that exist today, and
  // this reads whatever children the bubble actually has rather than naming them either.
  //
  // NOT a hypothetical: .bubble__file-name deliberately ships with no rule of its own (#815, measured), so
  // the inherited value is the only one it has, and e2e/attachment-file-row.spec.ts's computed-`normal`
  // assertion went red on this ticket's first build. The count beside it is the vacuity guard — a bubble
  // whose children stopped resolving would otherwise pass an empty `every`.
  expect(stack.childWhiteSpaces.length).toBeGreaterThan(0)
  expect(stack.childWhiteSpaces).toEqual(stack.childWhiteSpaces.map(() => 'normal'))

  // --- AC4, the queued row: the same treatment, reached by the same one declaration (.bubble--user is
  // worn by the queued row unchanged — #294 draws it as the user's own pending send, dimmed by
  // .message-row--queued since #1214 folded the backlog into the thread). Pushed AFTER launch resolved, so
  // it is past the `connected` backlog reset. ---
  daemon.pushFrame(queueStateFrame(QUEUED_ITEMS))
  await expect(page.locator('.bubble[data-thread-role="queued"]')).toHaveCount(QUEUED_ITEMS.length, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  const queuedControl = await readBubbleMetrics(queuedBubble(page, QUEUED_CONTROL_INDEX))
  const queuedLineBreaks = await readBubbleMetrics(queuedBubble(page, QUEUED_LINE_BREAKS_INDEX))
  expect(queuedControl.whiteSpace).toBe('pre-wrap')
  // Its own control, not the delivered one: a queued bubble carries no meta row, so its box is a different
  // constant height from a delivered bubble's and only the delta between two queued rows is comparable.
  expect(queuedLineBreaks.height - queuedControl.height).toBeCloseTo(2 * queuedControl.lineHeightPx, 0)

  // --- The daemon-chosen-whitespace bound, confirmed rather than assumed: an unbroken token followed by a
  // 200-space run neither overflows its own box nor pushes it past .bubble's measure. `pre-wrap` hangs a
  // trailing run past the line's end instead of letting it wrap and contribute to the box's width (the
  // reason #607 declined `break-spaces`), and the max-width caps the box regardless. ---
  const queuedHostile = await readBubbleMetrics(queuedBubble(page, QUEUED_HOSTILE_INDEX))
  expect(queuedHostile.scrollWidth).toBeLessThanOrEqual(
    queuedHostile.clientWidth + SUBPIXEL_TOLERANCE_PX
  )
  expect(queuedHostile.width).toBeLessThanOrEqual(queuedHostile.rowWidth + SUBPIXEL_TOLERANCE_PX)
})
