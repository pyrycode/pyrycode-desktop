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
  // .conversation__thread's flex column and so IS the message column's measure by construction;
  // comparing against it rather than against the thread's clientWidth minus its computed padding is the
  // same coverage without the arithmetic. Both elements are visible at every call site below, so a null
  // box is a genuine failure rather than a case to handle.
  async function measureChip(): Promise<{ chip: number; row: number }> {
    const chipBox = await chip.boundingBox()
    const rowBox = await row.boundingBox()
    if (chipBox === null || rowBox === null) throw new Error('the tool row is not laid out')
    return { chip: chipBox.width, row: rowBox.width }
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
  expect(Math.abs(pending.chip - pending.row)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

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
  expect(Math.abs(resolved.chip - resolved.row)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
  expect(Math.abs(resolved.chip - pending.chip)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)

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
  expect(Math.abs(expanded.chip - expanded.row)).toBeLessThanOrEqual(WIDTH_TOLERANCE_PX)
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
