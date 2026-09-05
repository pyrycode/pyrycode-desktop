import type { Locator } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ToolResultPayload, ToolUsePayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for the tool-row toggle (#697): opening a resolved tool row to read what the tool
// returned, and closing it again. It drives the whole client path — Noise wire → decode → IPC → bridge
// → reducer → row — on the launchPairedApp fixture, then exercises the one thing the unit tests
// structurally cannot: the click.
//
// WHY THE INTERACTION NEEDS A REAL BROWSER. vitest runs the `node` environment (vitest.config.ts:27) —
// every renderer test is a renderToStaticMarkup string assertion with no DOM, no effects and no click
// handlers. #696's expanded branch and #697's collapsed-at-rest button markup are pinned there; only a
// real window can prove the row OPENS, closes again, and opens on the keyboard as well as the mouse.
// (This is the sibling of e2e/unrecognized-message.spec.ts, whose row solved the same problem first.)
//
// BOTH FRAMES ARE SERVER PUSHES. A daemon emits `tool_use` mid-turn when claude calls a tool and
// `tool_result` when it returns — nothing the client sent provokes either — so both go out via
// daemon.pushFrame rather than being bundled onto an inbound's reply frames. `tool_use` is already
// proven to arrive that way by thread-scroll-pin.spec.ts.
//
// SECRET HYGIENE (carried from the sibling specs): every assertion reads DOM text, attributes, class
// locators, bounding boxes and counts only. SEEDED_ROW.id, the tool ids and the invented tool name are
// non-secret display/routing literals; the pairing plumbing lives in launchPairedApp and is never
// echoed. No failure diagnostic serialises a token, key, or plaintext.
//
// #722 ADDED THE WIDTH ASSERTIONS, for the same reason: the desktop redraw makes the chip fill the
// message column in both element branches, and a rendered width is a computed value the
// renderToStaticMarkup tier structurally cannot observe. They ride the states this spec already
// reaches rather than adding a spec, a frame or a fixture.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process, so a short headroom
// over Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// pushes by envelope id, so one fixed id is reused across both frames.
const PUSH_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// `fillResult` correlates the result to its call by `tool_use_id` alone, so both frames carry this one.
const TOOL_USE_ID = 'tool-use-697'

// A distinctive, non-secret needle inside the result text. It must NOT appear while the row is
// collapsed — that absence is the assertion that the result is genuinely withheld rather than merely
// hidden by CSS — and must appear once expanded.
const RESULT_NEEDLE = 'needle-inside-the-tool-result'

// Rendered widths are floats (device pixel ratio, sub-pixel layout), so the three equalities below are
// compared with a sub-pixel tolerance rather than with toBe.
const WIDTH_TOLERANCE_PX = 0.5

const TOOL_USE: ToolUsePayload = {
  conversation_id: SEEDED_ROW.id,
  turn_id: 'turn-697',
  tool_use_id: TOOL_USE_ID,
  name: 'read_file',
  input_summary: 'src/main/index.ts'
}

const TOOL_RESULT: ToolResultPayload = {
  conversation_id: SEEDED_ROW.id,
  turn_id: 'turn-697',
  tool_use_id: TOOL_USE_ID,
  is_error: false,
  result_summary: `line one\n${RESULT_NEEDLE}\nline three`
}

/** One unsolicited `tool_use` frame -> a PENDING `toolCall` item. Sealed via the production encoder. */
function toolUseFrame(): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_use',
    ts: FIXED_TS,
    payload: TOOL_USE
  })
}

/** One unsolicited `tool_result` frame -> resolves the call above in place, by `tool_use_id`. */
function toolResultFrame(): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_result',
    ts: FIXED_TS,
    payload: TOOL_RESULT
  })
}

test('tool row: pending offers no toggle, resolved opens on click and on Enter', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // Everything is scoped under `.tool-row` rather than the page root: post-#670 the sidebar is always
  // mounted beside the thread, and cheap top-level selectors are what produced #670's three Playwright
  // strict-mode collisions.
  const row = page.locator('.tool-row')
  const chip = row.locator('.tool-row__chip')
  const toggle = row.locator('.tool-row__chip--toggle')
  const result = row.locator('.tool-row__result')

  // #722 — the chip's rendered width beside its row's. The row is a stretch item of
  // .conversation__thread's flex column and so IS the message column's measure by construction.
  //
  // #1102 RE-DERIVED IT AGAINST THE ROW'S CONTENT WIDTH, and did not delete it. The box treatment moved
  // outward: .tool-row now carries the 1px border, so the chip is the row's BORDER box less 2px and the
  // old comparison against the row's bounding box would be short by exactly that — well outside this
  // spec's 0.5px tolerance, so it genuinely reddens rather than passing inside slack. The property being
  // protected is unchanged and still worth pinning: a resolving row does not shift, and the <button> and
  // <div> branches measure the same. The row's padding is read rather than assumed to be zero — that it
  // has none is #1102's padding split, a decision a later slice could revisit.
  //
  // IT ALSO CARRIES AC2's HOVER HALF. The chip's box IS the row's content box, which is what makes
  // .tool-row__chip--toggle:hover fill the whole box inside the border rather than a rectangle inset from
  // it — the failure mode the alternative padding split (8/12 hoisted onto the row) would have shipped.
  //
  // Both elements are visible at every call site below, so a null box is a genuine failure rather than a
  // case to handle.
  async function measureChip(): Promise<{ chip: number; rowContent: number }> {
    const chipBox = await chip.boundingBox()
    if (chipBox === null) throw new Error('the tool row is not laid out')
    const rowContent = await row.evaluate((element) => {
      const style = getComputedStyle(element)
      return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    })
    return { chip: chipBox.width, rowContent }
  }

  // --- The call lands PENDING: a chip with no toggle affordance at all (AC2).
  daemon.pushFrame(toolUseFrame())
  await expect(row).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(chip).toContainText('read_file')
  await expect(row).not.toHaveClass(/tool-row--resolved/)

  // Not a disabled button — no button, and nothing carrying aria-expanded, so the row is not in the
  // accessibility tree as a control at all. This is the assertion the unit tier cannot make about
  // ACTIVATABILITY, only about markup.
  await expect(toggle).toHaveCount(0)
  await expect(row.locator('[aria-expanded]')).toHaveCount(0)
  await expect(row).not.toContainText(RESULT_NEEDLE)

  // #722 — the <div> branch fills the message column. Three states are measured, not four: pending +
  // expanded is unreachable by construction, since the body renders only when the result does and the
  // toggle exists only on a resolved row.
  const pending = await measureChip()
  expect(pending.chip).toBeGreaterThan(0)
  expect(Math.abs(pending.chip - pending.rowContent)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // #1102 AC5's first half — the pending dimming, now applied to a box that has a fill rather than to a
  // transparent wrapper. That the value still READS as pending is a visual question, checked on screen
  // rather than here; this pins only that the declaration still reaches the row.
  await expect(row).toHaveCSS('opacity', '0.5')

  // --- The result resolves the SAME row in place (correlated by tool_use_id), and the chip becomes
  // the control — closed at rest.
  daemon.pushFrame(toolResultFrame())
  await expect(row).toHaveClass(/tool-row--resolved/, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(row).toHaveCount(1) // resolved IN PLACE — never a second row.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  // The result is genuinely absent from the DOM, not merely hidden.
  await expect(result).toHaveCount(0)
  await expect(row).not.toContainText(RESULT_NEEDLE)

  // #722 — the <button> branch fills the same column AND measures the same as the <div> did: that
  // second equality is "a resolving row does not shift", which is the whole reason the chip's
  // box-sizing is stated once on the base rule reaching both branches.
  const resolved = await measureChip()
  expect(Math.abs(resolved.chip - resolved.rowContent)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  expect(Math.abs(resolved.chip - pending.chip)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // #1102 AC5's second half — resolving lifts the dimming off the filled box.
  await expect(row).toHaveCSS('opacity', '1')

  // --- It expands in place on click, showing the result text.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(row).toHaveClass(/tool-row--expanded/)
  await expect(result).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(result).toContainText(RESULT_NEEDLE)

  // #722 — and it still fills the column once the row turns into a column flex, where the chip is a
  // CROSS-axis item. This is the state that would go red if the chip leaned on the container's
  // alignment instead of carrying its own width.
  const expanded = await measureChip()
  expect(Math.abs(expanded.chip - expanded.rowContent)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  expect(Math.abs(expanded.chip - pending.chip)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // --- And collapses again on a second click, withdrawing the result from the DOM (AC5's second half).
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(result).toHaveCount(0)
  await expect(row).not.toContainText(RESULT_NEEDLE)

  // --- The keyboard path. Focusing the chip and pressing Enter must do exactly what the click did;
  // this is the assertion that would fail had the chip shipped as a <div onClick> (AC1's "reachable by
  // keyboard, not by mouse only").
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(result).toContainText(RESULT_NEEDLE)

  // #1102 — AND THE FOCUS RING IS STILL VISIBLE ON THAT PATH. The box moved outward, so .tool-row clips
  // (AC1) and the toggle's border box now coincides exactly with the row's padding box; a UA outline is
  // painted OUTSIDE the border box, so it would be clipped away on all four sides and this keyboard
  // affordance would leave no indicator at all. .tool-row__chip--toggle:focus-visible therefore draws its
  // own ring with a NEGATIVE offset, which is what puts it inside the clip. The negative offset is the
  // assertion: a ring at offset 0 or greater is a ring the row's clip eats.
  const focusRing = await toggle.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineOffset: parseFloat(style.outlineOffset)
    }
  })
  expect(focusRing.focusVisible).toBe(true)
  expect(focusRing.outlineStyle).not.toBe('none')
  expect(focusRing.outlineOffset).toBeLessThan(0)
})

// #854 — the header's two groups. A SIBLING test rather than an extension of the one above: each test
// launches its own app through launchPairedApp, so a second row on the same page would make that test's
// bare `.tool-row` locators strict-mode-ambiguous. Everything asserted here is GEOMETRY — a flush
// trailing edge, an engaged ellipsis, a surviving 12px gap — which the renderToStaticMarkup unit tier
// structurally cannot observe; the markup half is pinned there.
//
// The row's existing width equalities above are NOT re-asserted here. They are that test's, they still
// run, and duplicating them would just make one property fail in two places.

// BOTH LENGTHS ARE DRIVEN, and the short one is not a nicety. Under a long headline the left group
// fills the header whether or not it is told to — its content alone is wider than the row — so a flush
// trailing edge there is satisfied by a group that merely SHRINKS. Measured as a control: with
// `flex: 1 1 auto` deleted from .tool-row__left, the long-headline assertions below all still pass. The
// SHORT headline is the case the design describes — "anything at the trailing edge floats in behind the
// headline and drifts with it" — and it is what makes AC1 a real check.
const LONG_TOOL_USE_ID = 'tool-use-854-long'
const SHORT_TOOL_USE_ID = 'tool-use-854-short'

// Drawn VERBATIM: neither payload carries an `input` map, so toolHeadline's rule-4 fallback renders
// `input_summary` as-is and no new fixture machinery is needed. The long one overflows the 800px-minimum
// window's message column by a wide margin and holds no newline, so its overflow can only be horizontal.
const LONG_HEADLINE = 'headline-that-overflows-the-message-column-'.repeat(20)
const SHORT_HEADLINE = 'short.ts'

function toolUseWith(toolUseId: string, inputSummary: string): ToolUsePayload {
  return {
    conversation_id: SEEDED_ROW.id,
    turn_id: 'turn-854',
    tool_use_id: toolUseId,
    name: 'read_file',
    input_summary: inputSummary
  }
}

function toolResultFor(toolUseId: string): ToolResultPayload {
  return {
    conversation_id: SEEDED_ROW.id,
    turn_id: 'turn-854',
    tool_use_id: toolUseId,
    is_error: false,
    result_summary: 'one line of result text'
  }
}

/** A #854 call, pending. Sealed via the production encoder, like the two frames above. */
function splitToolUseFrame(toolUseId: string, inputSummary: string): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_use',
    ts: FIXED_TS,
    payload: toolUseWith(toolUseId, inputSummary)
  })
}

/** Its result — resolves that call in place, which is what brings the trailing group up. */
function splitToolResultFrame(toolUseId: string): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_result',
    ts: FIXED_TS,
    payload: toolResultFor(toolUseId)
  })
}

type Box = { x: number; y: number; width: number; height: number }

// `boundingBox()` returns null for a detached or hidden node, and every consumer below does arithmetic
// on the result, so a `?? -1` sentinel would turn a missing box into a wrong number
// (host-label-sidebar.spec.ts's shape). The message names the ELEMENT, never a value.
async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`expected a laid-out box for ${what}`)
  return box
}

test('tool row: the header pins its trailing group flush while the headline ellipsises', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // Two rows land on this page, so EVERY locator is scoped to one of them by index — a bare `.tool-row`
  // descendant selector would be strict-mode-ambiguous the moment the second call arrives (#670's three
  // collisions). Arrival order is the thread's order, so 0 is the long call and 1 is the short one.
  const rows = page.locator('.tool-row')
  const longRow = rows.nth(0)
  const shortRow = rows.nth(1)

  /** A row's chip metrics, read rather than hardcoded — the tokens behind them may be retuned. */
  async function chipMetricsOf(
    row: Locator
  ): Promise<{ paddingRight: number; borderRight: number; columnGap: number }> {
    return row.locator('.tool-row__chip').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        paddingRight: parseFloat(style.paddingRight),
        borderRight: parseFloat(style.borderRightWidth),
        columnGap: parseFloat(style.columnGap)
      }
    })
  }

  /**
   * AC1 for one row: the trailing group's right edge sits on the header's trailing edge, which is the
   * chip's PADDING edge (border-box right, less the computed padding and border).
   */
  async function expectTrailingGroupFlush(row: Locator, what: string): Promise<void> {
    const metrics = await chipMetricsOf(row)
    const chip = await boxOf(row.locator('.tool-row__chip'), `${what}'s chip`)
    const group = await boxOf(row.locator('.tool-row__right'), `${what}'s trailing group`)
    const headerTrailingEdge = chip.x + chip.width - metrics.paddingRight - metrics.borderRight
    expect(Math.abs(headerTrailingEdge - (group.x + group.width))).toBeLessThanOrEqual(
      WIDTH_TOLERANCE_PX
    )
  }

  /** Whether a row's headline run is overflowing its box, i.e. whether the ellipsis is engaged. */
  async function summaryOverflows(row: Locator): Promise<boolean> {
    return row
      .locator('.tool-row__summary')
      .evaluate((element) => element.scrollWidth > element.clientWidth)
  }

  // --- Pending: the left group is there, the trailing group is ABSENT — not present and empty. An
  // empty one would still take one side of the chip's 12px gap and move this row's trailing edge away
  // from the resolved row's, which is the property the width equalities in the test above pin.
  daemon.pushFrame(splitToolUseFrame(LONG_TOOL_USE_ID, LONG_HEADLINE))
  await expect(longRow).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(longRow.locator('.tool-row__left')).toHaveCount(1)
  await expect(longRow.locator('.tool-row__right')).toHaveCount(0)
  await expect(longRow.locator('.tool-row__chevron')).toHaveCount(0)
  const pendingChip = await boxOf(longRow.locator('.tool-row__chip'), 'the pending chip')

  // --- Resolved: the trailing group and its chevron appear, flush against the trailing edge.
  daemon.pushFrame(splitToolResultFrame(LONG_TOOL_USE_ID))
  await expect(longRow).toHaveClass(/tool-row--resolved/, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(longRow.locator('.tool-row__right')).toHaveCount(1)
  await expect(longRow.locator('.tool-row__chevron')).toHaveCount(1)
  await expectTrailingGroupFlush(longRow, 'the long-headline row')

  // AC3 — the long headline still ellipsises on ONE line and pushes nothing off the trailing edge. An
  // overflowing scrollWidth is the ellipsis engaged; an unchanged chip height is the single line, and
  // it is also the assertion that the chevron added no second row.
  expect(await summaryOverflows(longRow)).toBe(true)
  const resolvedChip = await boxOf(longRow.locator('.tool-row__chip'), 'the resolved chip')
  expect(Math.abs(resolvedChip.height - pendingChip.height)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // The 12px between the two runs survived being re-homed from the chip onto the left group. This is
  // the one silent regression the split can produce — the gap moving off the chip with no rule
  // replacing it — and nothing else in either tier catches it.
  const metrics = await chipMetricsOf(longRow)
  const nameBox = await boxOf(longRow.locator('.tool-row__name'), 'the tool-name run')
  const summaryBox = await boxOf(longRow.locator('.tool-row__summary'), 'the headline run')
  expect(Math.abs(summaryBox.x - (nameBox.x + nameBox.width) - metrics.columnGap)).toBeLessThanOrEqual(
    WIDTH_TOLERANCE_PX
  )

  // --- AC1's real check: a SHORT headline, where the runs come nowhere near the trailing edge. Without
  // .tool-row__left filling the header the chevron would sit just behind the headline and drift with it,
  // which is exactly what the split exists to prevent — and what the long row above cannot detect.
  daemon.pushFrame(splitToolUseFrame(SHORT_TOOL_USE_ID, SHORT_HEADLINE))
  daemon.pushFrame(splitToolResultFrame(SHORT_TOOL_USE_ID))
  await expect(shortRow).toHaveClass(/tool-row--resolved/, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(shortRow.locator('.tool-row__chevron')).toHaveCount(1)
  // The headline genuinely fits — so the group below is flush because it was PLACED there, not because
  // its sibling's content pushed it there.
  expect(await summaryOverflows(shortRow)).toBe(false)
  await expectTrailingGroupFlush(shortRow, 'the short-headline row')

  // Both rows put their trailing edge in the SAME column, which is the point of the split: a thread of
  // tool calls reads as a column with its affordances lined up rather than as a ragged stack.
  const longGroup = await boxOf(longRow.locator('.tool-row__right'), 'the long row group')
  const shortGroup = await boxOf(shortRow.locator('.tool-row__right'), 'the short row group')
  expect(Math.abs(longGroup.x - shortGroup.x)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
})

// #855 — WHICH of the two runs the headline lands in, per call. A THIRD sibling test launching its own
// app, for the reason above: three more rows on either test's page would make its bare `.tool-row`
// locators strict-mode-ambiguous. Two claims are asserted here and nothing else, because they are
// exactly the two the renderToStaticMarkup tier structurally cannot observe — a rendered LEFT EDGE (AC1)
// and a COMPUTED TYPE AND INK (AC2). Which elements exist in which case is pinned in
// ConversationScreen.test.tsx, byte for byte.
//
// The hard cut of an over-long command is NOT asserted, on purpose. .tool-row__left's overflow: hidden
// ships and is #854's, this ticket adds no rule that could regress it, and the ticket rules the cut is
// the intended degrade — a test for it would be a defence for an unobserved failure mode.

const DESCRIBED_TOOL_USE_ID = 'tool-use-855-described'
const UNDESCRIBED_TOOL_USE_ID = 'tool-use-855-undescribed'
const PATH_TOOL_USE_ID = 'tool-use-855-path'

// Drawn from Figma's own cases (155:621 and 155:662). Both are short enough to fit the 800px-minimum
// window's message column, which is what makes the left-edge assertion below a placement check rather
// than an overflow one.
const SHELL_DESCRIPTION = 'List unscoped role queries in e2e'
const SHELL_COMMAND = 'git status --short'

/**
 * A #855 call, pending — the first frame here to carry an `input` map. `ToolUsePayload.input` is a
 * shipped wire field (#642), so this is one more property on the existing payload shape rather than any
 * new fixture machinery.
 */
function routedToolUseFrame(
  toolUseId: string,
  name: string,
  input?: Record<string, string>
): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_use',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-855',
      tool_use_id: toolUseId,
      name,
      input_summary: 'the whole input, compacted',
      input
    }
  })
}

/** Its result — every row here is resolved, so all three carry the trailing group and the chevron. */
function routedToolResultFrame(toolUseId: string): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_result',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-855',
      tool_use_id: toolUseId,
      is_error: false,
      result_summary: 'one line of result text'
    }
  })
}

test('tool row: a described shell call starts at the hard left, an undescribed one takes the lead type', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // Three rows land on this page, so every locator is scoped by index (#670's strict-mode collisions).
  // Arrival order is the thread's order.
  const rows = page.locator('.tool-row')
  const describedRow = rows.nth(0)
  const undescribedRow = rows.nth(1)
  const pathRow = rows.nth(2)

  daemon.pushFrame(
    routedToolUseFrame(DESCRIBED_TOOL_USE_ID, 'Bash', {
      description: SHELL_DESCRIPTION,
      command: SHELL_COMMAND
    })
  )
  daemon.pushFrame(routedToolUseFrame(UNDESCRIBED_TOOL_USE_ID, 'Bash', { command: SHELL_COMMAND }))
  daemon.pushFrame(routedToolUseFrame(PATH_TOOL_USE_ID, 'read_file'))
  daemon.pushFrame(routedToolResultFrame(DESCRIBED_TOOL_USE_ID))
  daemon.pushFrame(routedToolResultFrame(UNDESCRIBED_TOOL_USE_ID))
  daemon.pushFrame(routedToolResultFrame(PATH_TOOL_USE_ID))

  await expect(pathRow).toHaveClass(/tool-row--resolved/, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rows).toHaveCount(3)

  // --- AC1. The described call draws its description alone, and that run starts at the header's HARD
  // LEFT — the chip's CONTENT-box left edge. An empty lead element would still take one side of the left
  // group's 12px gap and push it right, which is the failure this measures and a count assertion cannot.
  await expect(describedRow.locator('.tool-row__name')).toHaveCount(0)
  await expect(describedRow.locator('.tool-row__summary')).toHaveText(SHELL_DESCRIPTION)
  const describedChip = describedRow.locator('.tool-row__chip')
  // Read rather than hardcoded — the tokens behind the chip's padding may be retuned.
  const leadingInset = await describedChip.evaluate((element) => {
    const style = getComputedStyle(element)
    return parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)
  })
  const chipBox = await boxOf(describedChip, 'the described row chip')
  const subjectBox = await boxOf(describedRow.locator('.tool-row__summary'), 'the subject run')
  expect(Math.abs(subjectBox.x - (chipBox.x + leadingInset))).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // --- AC2. The undescribed call draws its command alone, in the SAME type and ink the tool name takes
  // in that run. Asserted COMPARATIVELY against the path row's tool name rather than against hardcoded
  // token values: a retune of the type scale must not turn this red, while a `--command` modifier class
  // added later — the one thing AC2 forbids — must.
  await expect(undescribedRow.locator('.tool-row__summary')).toHaveCount(0)
  await expect(undescribedRow.locator('.tool-row__name')).toHaveText(SHELL_COMMAND)

  async function leadTypeOf(row: Locator): Promise<Record<string, string>> {
    return row.locator('.tool-row__name').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        fontFamily: style.fontFamily,
        color: style.color,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight
      }
    })
  }
  expect(await leadTypeOf(undescribedRow)).toEqual(await leadTypeOf(pathRow))

  // --- AC3's control, and the proof neither switch disturbed the rest of the row: the path call keeps
  // BOTH runs, and all three rows still resolve into a one-line header with its trailing group.
  await expect(pathRow.locator('.tool-row__name')).toHaveText('read_file')
  await expect(pathRow.locator('.tool-row__summary')).toHaveCount(1)
  const pathChip = await boxOf(pathRow.locator('.tool-row__chip'), 'the path row chip')
  for (const [row, what] of [
    [describedRow, 'the described row'],
    [undescribedRow, 'the undescribed row']
  ] as const) {
    await expect(row.locator('.tool-row__right')).toHaveCount(1)
    await expect(row.locator('.tool-row__chevron')).toHaveCount(1)
    // EVERY ROW IS THE SAME HEIGHT whichever run it drew — Figma draws all three at 36px, the lead-only
    // case (155:662) included, and a thread whose rows are two different heights is the ragged stack the
    // header's two groups exist to prevent. This equality catches BOTH directions and one of them is
    // real: without .tool-row__left's min-height the lead-only row is 4px SHORTER, because switching the
    // subject off removes the 20px line box that used to set the header's height. (The other direction
    // is a run wrapping onto a second line.) Measured as a control before the rule was added.
    const chip = await boxOf(row.locator('.tool-row__chip'), `${what} chip`)
    expect(Math.abs(chip.height - pathChip.height)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  }
})

// #856 — the result count, the trailing group's first child. A FOURTH sibling test with its own
// launchPairedApp, for the reason the two above record: more rows on either of their pages would make
// their bare `.tool-row` locators strict-mode-ambiguous.
//
// Everything asserted here is geometry, which is exactly the half renderToStaticMarkup structurally
// cannot see. WHICH element exists in which state, what it contains, and that absent and empty render
// byte-identically are pinned in ConversationScreen.test.tsx; what only a real window can prove is that
// the counts land in a COLUMN whatever runs each row switched on (AC4), that adding the run did not make
// any row taller (#855's lesson: a flex row's height tracks its tallest child's line box, and only
// geometry catches a run that changes it), and that the CSS cap on an untrusted count actually holds.
//
// The counts are driven from `result_detail` ON THE WIRE, so this exercises the whole #773 carry —
// decode → IPC → bridge → reducer → row — rather than just the render.

const COUNT_DESCRIBED_ID = 'tool-use-856-described'
const COUNT_UNDESCRIBED_ID = 'tool-use-856-undescribed'
const COUNT_PATH_ID = 'tool-use-856-path'
const COUNT_HOSTILE_ID = 'tool-use-856-hostile'

// Three counts of visibly different widths — the point of AC4 is that their TRAILING edges line up, so
// equal-width strings would pass a broken implementation. The middle one is the design's own example.
const DESCRIBED_COUNT = '3 lines'
const UNDESCRIBED_COUNT = '110 of 1676 lines'
const PATH_COUNT = '265 lines'

// The hostile control. `result_detail` is unbounded on the wire — the decoder type-checks it, it does not
// length-check it — and without .tool-row__right's max-width this run is an unshrinkable nowrap string
// that pushes the CHEVRON past the chip's clip edge, where the row's only visible affordance disappears.
// No spaces, so nothing can wrap its way out of the measurement.
const HOSTILE_COUNT = 'x'.repeat(400)

/** A resolved result carrying the count (#773's optional sixth wire field). */
function countedToolResultFrame(toolUseId: string, resultDetail: string): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_result',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-856',
      tool_use_id: toolUseId,
      is_error: false,
      result_summary: 'one line of result text',
      result_detail: resultDetail
    }
  })
}

test('tool row: the result count draws before the chevron and lines up down the thread', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const rows = page.locator('.tool-row')
  const describedRow = rows.nth(0)
  const undescribedRow = rows.nth(1)
  const pathRow = rows.nth(2)
  const hostileRow = rows.nth(3)

  // AC4's "whatever else each row has switched on": a described shell call draws NO LEAD, an undescribed
  // one draws NO SUBJECT, and the path call draws both — #855's three reachable header shapes, reused
  // here rather than re-derived.
  daemon.pushFrame(
    routedToolUseFrame(COUNT_DESCRIBED_ID, 'Bash', {
      description: SHELL_DESCRIPTION,
      command: SHELL_COMMAND
    })
  )
  daemon.pushFrame(routedToolUseFrame(COUNT_UNDESCRIBED_ID, 'Bash', { command: SHELL_COMMAND }))
  daemon.pushFrame(routedToolUseFrame(COUNT_PATH_ID, 'read_file'))
  daemon.pushFrame(routedToolUseFrame(COUNT_HOSTILE_ID, 'read_file'))
  daemon.pushFrame(countedToolResultFrame(COUNT_DESCRIBED_ID, DESCRIBED_COUNT))
  daemon.pushFrame(countedToolResultFrame(COUNT_UNDESCRIBED_ID, UNDESCRIBED_COUNT))
  daemon.pushFrame(countedToolResultFrame(COUNT_PATH_ID, PATH_COUNT))
  daemon.pushFrame(countedToolResultFrame(COUNT_HOSTILE_ID, HOSTILE_COUNT))

  await expect(hostileRow).toHaveClass(/tool-row--resolved/, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rows).toHaveCount(4)

  // --- The carry, end to end: the count the wire sent is the count the row draws. The three header
  // shapes each drew their own, which is also the proof no row picked up a neighbour's.
  await expect(describedRow.locator('.tool-row__count')).toHaveText(DESCRIBED_COUNT)
  await expect(undescribedRow.locator('.tool-row__count')).toHaveText(UNDESCRIBED_COUNT)
  await expect(pathRow.locator('.tool-row__count')).toHaveText(PATH_COUNT)

  // --- The design's type claim: the count is M3/body/medium in FULL and inked Schemes/On Background —
  // the same step and the same ink the subject run beside it takes (Figma 155:557 against 155:556).
  // Asserted COMPARATIVELY against that run rather than against hardcoded token values, #855's shape: a
  // retune of the type scale must not turn this red, while a count given its own size or ink must.
  async function typeOf(locator: Locator): Promise<Record<string, string>> {
    return locator.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        fontFamily: style.fontFamily,
        color: style.color,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        fontWeight: style.fontWeight
      }
    })
  }
  expect(await typeOf(pathRow.locator('.tool-row__count'))).toEqual(
    await typeOf(pathRow.locator('.tool-row__summary'))
  )

  /** A row's chip metrics, read rather than hardcoded — the tokens behind them may be retuned. */
  async function chipInsetsOf(
    row: Locator
  ): Promise<{ paddingRight: number; borderRight: number; contentWidth: number }> {
    return row.locator('.tool-row__chip').evaluate((element) => {
      const style = getComputedStyle(element)
      const paddingRight = parseFloat(style.paddingRight)
      return {
        paddingRight,
        borderRight: parseFloat(style.borderRightWidth),
        contentWidth: element.clientWidth - parseFloat(style.paddingLeft) - paddingRight
      }
    })
  }

  // --- AC1, the half markup cannot reach: the count sits one group-gap before the chevron, and the pair
  // is flush against the header's trailing edge (the chip's PADDING edge).
  const groupGap = await pathRow
    .locator('.tool-row__right')
    .evaluate((element) => parseFloat(getComputedStyle(element).columnGap))
  const pathCount = await boxOf(pathRow.locator('.tool-row__count'), 'the path row count')
  const pathChevron = await boxOf(pathRow.locator('.tool-row__chevron'), 'the path row chevron')
  expect(Math.abs(pathChevron.x - (pathCount.x + pathCount.width) - groupGap)).toBeLessThanOrEqual(
    WIDTH_TOLERANCE_PX
  )
  const pathInsets = await chipInsetsOf(pathRow)
  const pathChip = await boxOf(pathRow.locator('.tool-row__chip'), 'the path row chip')
  const pathGroup = await boxOf(pathRow.locator('.tool-row__right'), 'the path row group')
  const pathTrailingEdge =
    pathChip.x + pathChip.width - pathInsets.paddingRight - pathInsets.borderRight
  expect(Math.abs(pathTrailingEdge - (pathGroup.x + pathGroup.width))).toBeLessThanOrEqual(
    WIDTH_TOLERANCE_PX
  )

  // --- AC4. The counts line up as a column of TRAILING edges — not leading ones, since the three
  // strings are deliberately different widths and it is the trailing edge the group pins. This is the
  // assertion that fails if a row's count drifts with its headline instead of hugging the row's edge.
  const describedCount = await boxOf(describedRow.locator('.tool-row__count'), 'the described count')
  const undescribedCount = await boxOf(
    undescribedRow.locator('.tool-row__count'),
    'the undescribed count'
  )
  const pathCountEdge = pathCount.x + pathCount.width
  for (const [box, what] of [
    [describedCount, 'the described row (no lead)'],
    [undescribedCount, 'the undescribed row (no subject)']
  ] as const) {
    expect(
      Math.abs(box.x + box.width - pathCountEdge),
      `${what} count is not in the column`
    ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  }

  // --- AC4's other half, and #855's lesson applied: adding a run must not change any row's height. The
  // count is body-medium, the same step .tool-row__left's min-height floors at, so every chip stays the
  // one-line 36px box — including the hostile row, whose nowrap count must not wrap onto a second line.
  for (const [row, what] of [
    [describedRow, 'the described row'],
    [undescribedRow, 'the undescribed row'],
    [hostileRow, 'the hostile-count row']
  ] as const) {
    const chip = await boxOf(row.locator('.tool-row__chip'), `${what} chip`)
    expect(Math.abs(chip.height - pathChip.height), `${what} is a different height`).toBeLessThanOrEqual(
      WIDTH_TOLERANCE_PX
    )
  }

  // --- The security bound, proved rather than asserted in a comment. An unbounded count would give the
  // trailing group a base size wider than the chip and push the chevron past .tool-row__chip's
  // overflow: hidden edge; .tool-row__right's max-width caps the group and .tool-row__count's
  // flex: 0 1 auto + min-width: 0 make the COUNT the only thing that gives way.
  const hostileInsets = await chipInsetsOf(hostileRow)
  const hostileChip = await boxOf(hostileRow.locator('.tool-row__chip'), 'the hostile row chip')
  const hostileGroup = await boxOf(hostileRow.locator('.tool-row__right'), 'the hostile row group')
  const hostileChevron = await boxOf(
    hostileRow.locator('.tool-row__chevron'),
    'the hostile row chevron'
  )
  // The chevron is still INSIDE the clipped box — the affordance survives a hostile count. Measured as
  // a control with .tool-row__right's max-width removed: the chevron landed at x≈3474 against a trailing
  // edge of 1051.5, i.e. 2.4k pixels outside the clip, gone. This assertion is the one that catches it.
  const hostileTrailingEdge =
    hostileChip.x + hostileChip.width - hostileInsets.paddingRight - hostileInsets.borderRight
  expect(hostileChevron.x).toBeGreaterThanOrEqual(hostileChip.x)
  expect(hostileChevron.x + hostileChevron.width).toBeLessThanOrEqual(
    hostileTrailingEdge + WIDTH_TOLERANCE_PX
  )
  // The group obeyed its cap, and the count — not the chevron — is what gave way, ellipsized.
  expect(hostileGroup.width).toBeLessThanOrEqual(hostileInsets.contentWidth / 2 + WIDTH_TOLERANCE_PX)
  const countClipped = await hostileRow
    .locator('.tool-row__count')
    .evaluate((element) => element.scrollWidth > element.clientWidth)
  expect(countClipped).toBe(true)
  // And the headline is still readable beside it rather than collapsed to nothing.
  const hostileLeft = await boxOf(hostileRow.locator('.tool-row__left'), 'the hostile row left group')
  expect(hostileLeft.width).toBeGreaterThan(0)
})

// #1102 — the box moved outward from .tool-row__chip to .tool-row, so an opened row draws as ONE bordered
// box with its body INSIDE it rather than as a box with a loose column hanging underneath. A FIFTH sibling
// test with its own launchPairedApp, for the reason the four above record: more rows on any of their pages
// would make their bare `.tool-row` locators strict-mode-ambiguous.
//
// Everything asserted here is COMPUTED GEOMETRY — where the body's edges sit relative to the row's padding
// box, whether the command block fills the row's measure, and which element carries the failure tint. That
// is exactly the half the renderToStaticMarkup unit tier structurally cannot observe, and this slice adds
// no element, no class and no attribute, so there is nothing new for that tier to pin and its specs are
// unedited.
//
// THE INSETS ARE ASSERTED AGAINST TOKENS READ OFF THE ROW, not against literal 8s and 12s: a retune of
// --space-2 / --space-3 must move the expectation with the rule, while the one arithmetic error this slice
// invites — copying the design's header-frame-to-body-frame 12 into .tool-row--expanded's gap, which draws
// 20px because 8 of that 12 already sits inside the chip — must redden. Each of the five equalities below
// was checked against the OUTGOING rules as a control and each is genuinely red there (9 not 8, 17 not 12,
// 0 not 12 on both the leading edge and the bottom, and an arbitrary content-sized trailing edge).

const BOX_PLAIN_ID = 'tool-use-1102-plain'
const BOX_SHELL_ID = 'tool-use-1102-shell'

// Drawn from the design node's own example (152:5215's second Input field), and short enough that the
// field list cannot be what widens the body — which is what makes the fill assertions below about the
// container rather than about the content.
const BOX_INPUT_PATH = '.../pyrycode/internal/e2e'

/** A FAILED result — AC4's row. `routedToolResultFrame` above is hardcoded to the success branch. */
function failedToolResultFrame(toolUseId: string): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'tool_result',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-1102',
      tool_use_id: toolUseId,
      is_error: true,
      result_summary: 'one line of failed result text'
    }
  })
}

type Edges = { left: number; right: number; top: number; bottom: number }

/**
 * An element's PADDING box and its CONTENT box in page coordinates — its border box inset by its own
 * computed border widths, and then again by its own computed padding.
 *
 * WHICH BOX EACH INSET IS MEASURED AGAINST IS THE WHOLE SUBJECT OF THE PADDING SPLIT, so both are
 * returned rather than one being assumed. The row carries the border and NO padding, so its padding box
 * is where its children begin; the body carries the design's 12px itself, so what sits at those insets is
 * the body's CONTENT box and its border box is flush. Measuring the body's bounding box against the row's
 * would read 0 and say nothing about the design.
 */
async function boxesOf(locator: Locator, what: string): Promise<{ padding: Edges; content: Edges }> {
  const box = await boxOf(locator, what)
  const insets = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const edge = (border: string, padding: string): { border: number; padding: number } => ({
      border: parseFloat(border),
      padding: parseFloat(padding)
    })
    return {
      left: edge(style.borderLeftWidth, style.paddingLeft),
      right: edge(style.borderRightWidth, style.paddingRight),
      top: edge(style.borderTopWidth, style.paddingTop),
      bottom: edge(style.borderBottomWidth, style.paddingBottom)
    }
  })
  const padding: Edges = {
    left: box.x + insets.left.border,
    right: box.x + box.width - insets.right.border,
    top: box.y + insets.top.border,
    bottom: box.y + box.height - insets.bottom.border
  }
  return {
    padding,
    content: {
      left: padding.left + insets.left.padding,
      right: padding.right - insets.right.padding,
      top: padding.top + insets.top.padding,
      bottom: padding.bottom - insets.bottom.padding
    }
  }
}

test('tool row: an expanded row is one box with its body inside the border', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  // Two rows land on this page, so every locator is scoped by index (#670's strict-mode collisions).
  // Arrival order is the thread's order.
  const rows = page.locator('.tool-row')
  const plainRow = rows.nth(0)
  const shellRow = rows.nth(1)

  daemon.pushFrame(routedToolUseFrame(BOX_PLAIN_ID, 'read_file', { path: BOX_INPUT_PATH }))
  daemon.pushFrame(routedToolUseFrame(BOX_SHELL_ID, 'Bash', { command: SHELL_COMMAND }))
  daemon.pushFrame(routedToolResultFrame(BOX_PLAIN_ID))
  daemon.pushFrame(failedToolResultFrame(BOX_SHELL_ID))

  await expect(shellRow).toHaveClass(/tool-row--error/, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rows).toHaveCount(2)

  await plainRow.locator('.tool-row__chip--toggle').click()
  await shellRow.locator('.tool-row__chip--toggle').click()
  await expect(plainRow).toHaveClass(/tool-row--expanded/)
  await expect(shellRow).toHaveClass(/tool-row--expanded/)

  // --- AC1. Every inset the design pins, measured against the row's padding box now that the row is the
  // box. The five equalities ARE the containment claim ("the body renders inside the border"), stated as
  // numbers rather than as a `>=` that would hold on `main` too — the body has always been inside the
  // row's bounding box; what it was not inside was a border, because the row had none.
  const space = await plainRow.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      two: parseFloat(style.getPropertyValue('--space-2')),
      three: parseFloat(style.getPropertyValue('--space-3'))
    }
  })
  const rowPad = (await boxesOf(plainRow, 'the plain row')).padding
  const bodyContent = (await boxesOf(plainRow.locator('.tool-row__body'), "the plain row's body")).content
  const header = await boxOf(plainRow.locator('.tool-row__summary'), "the plain row's header line box")
  const blocks = plainRow.locator('.tool-row__body > *')
  const firstBlock = await boxOf(blocks.first(), "the plain row body's first block")
  const lastBlock = await boxOf(blocks.last(), "the plain row body's last block")

  // 8px above the header's line box — the chip's own top padding, the row carrying none.
  expect(Math.abs(header.y - rowPad.top - space.two), 'the header sits wrong in the box').toBeLessThanOrEqual(
    WIDTH_TOLERANCE_PX
  )
  // 12px between the header's line box and where the body's content starts: the chip's 8px bottom padding
  // plus the row's 4px expanded gap. THIS is the equality that reddens if --space-3 is copied into that
  // gap, which draws 20px.
  expect(
    Math.abs(bodyContent.top - (header.y + header.height) - space.three),
    'the header-to-body distance is not the 12px the design pins'
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  // 12px on each side and 12px at the bottom, all three from the body's own padding.
  expect(
    Math.abs(bodyContent.left - rowPad.left - space.three),
    'the body is not inset from the leading edge'
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  expect(
    Math.abs(rowPad.right - bodyContent.right - space.three),
    'the body is not inset from the trailing edge'
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  expect(
    Math.abs(rowPad.bottom - bodyContent.bottom - space.three),
    'the body does not end 12px above the box'
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // And the same two distances read off the BLOCKS themselves, which is how AC1 words them ("the body's
  // first block", "the body's last block"). Equal to the content-box reads above by construction today,
  // since the body's top padding is 0 and .tool-row__result zeroes the UA <pre> margin — which is exactly
  // what these two catch if a block added later brings a margin of its own.
  expect(
    Math.abs(firstBlock.y - (header.y + header.height) - space.three),
    "the body's first block is not 12px below the header"
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  expect(
    Math.abs(rowPad.bottom - (lastBlock.y + lastBlock.height) - space.three),
    "the body's last block does not end 12px above the box"
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // --- AC3. Every block in the body fills the body's content width. On its own this holds on `main` too
  // (the blocks have always stretched to their container); it MEANS "fills the row's content width" only
  // in composition with the two side insets above, which pin the body itself to the row's measure.
  const bodyContentWidth = bodyContent.right - bodyContent.left
  for (const [selector, what] of [
    ['.tool-row__input', 'the input field'],
    ['.tool-row__input-value', 'the field value box'],
    ['.tool-row__result', 'the result block']
  ] as const) {
    const block = await boxOf(plainRow.locator(selector), what)
    expect(Math.abs(block.width - bodyContentWidth), `${what} does not fill the body`).toBeLessThanOrEqual(
      WIDTH_TOLERANCE_PX
    )
  }

  // --- AC3's named case: a shell call's COMMAND BLOCK. Asserted against the shell row's own padding box
  // rather than against its body, which makes it a detector on its own — under the outgoing
  // `align-items: flex-start` the body was content-sized and the block filled a narrower box. The Figma
  // node measures `Code` at 717 against its siblings' 851, but that frame is hidden in both the instance
  // and the symbol and so kept a pre-instance width; the block sits in the same auto-layout stack as the
  // siblings that do measure 851, which is what this pins.
  const shellPad = (await boxesOf(shellRow, 'the shell row')).padding
  const codeBlock = await boxOf(shellRow.locator('.code-block'), "the shell call's command block")
  expect(
    Math.abs(codeBlock.x - shellPad.left - space.three),
    'the command block does not fill to the leading edge'
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  expect(
    Math.abs(shellPad.right - (codeBlock.x + codeBlock.width) - space.three),
    'the command block does not fill to the trailing edge'
  ).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

  // --- AC4. The failure device followed the box outward: the ROW's border is retinted, and the chip has
  // no border left to retint. Asserted COMPARATIVELY against the successful row rather than against a
  // hardcoded colour, so a token retune cannot redden it — while the one mistake this consequence invites,
  // leaving the selector at `.tool-row--error .tool-row__chip`, must: that leaves both rows' borders the
  // same colour.
  async function bordersOf(
    row: Locator
  ): Promise<{ color: string; width: string; chipWidth: number }> {
    const rowBorder = await row.evaluate((element) => {
      const style = getComputedStyle(element)
      return { color: style.borderTopColor, width: style.borderTopWidth }
    })
    const chipWidth = await row
      .locator('.tool-row__chip')
      .evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth))
    return { ...rowBorder, chipWidth }
  }
  const plainBorders = await bordersOf(plainRow)
  const shellBorders = await bordersOf(shellRow)
  expect(shellBorders.color).not.toBe(plainBorders.color)
  // The retint is a colour change and nothing else — a failed row is the same box, not a thicker one.
  expect(shellBorders.width).toBe(plainBorders.width)
  expect(plainBorders.width).toBe('1px')
  // And the chip carries no border in either row, which is what makes the row the failure device for the
  // WHOLE row rather than for its header alone. It is also the assertion that catches the <button>
  // branch inheriting the UA's own border once the chip stops declaring one.
  expect(plainBorders.chipWidth).toBe(0)
  expect(shellBorders.chipWidth).toBe(0)
})
