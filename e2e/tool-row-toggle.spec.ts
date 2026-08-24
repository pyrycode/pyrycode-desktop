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
// locators and counts only. SEEDED_ROW.id, the tool ids and the invented tool name are non-secret
// display/routing literals; the pairing plumbing lives in launchPairedApp and is never echoed. No
// failure diagnostic serialises a token, key, or plaintext.

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

  // --- The result resolves the SAME row in place (correlated by tool_use_id), and the chip becomes
  // the control — closed at rest.
  daemon.pushFrame(toolResultFrame())
  await expect(row).toHaveClass(/tool-row--resolved/, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(row).toHaveCount(1) // resolved IN PLACE — never a second row.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  // The result is genuinely absent from the DOM, not merely hidden.
  await expect(result).toHaveCount(0)
  await expect(row).not.toContainText(RESULT_NEEDLE)

  // --- It expands in place on click, showing the result text.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(row).toHaveClass(/tool-row--expanded/)
  await expect(result).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(result).toContainText(RESULT_NEEDLE)

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
