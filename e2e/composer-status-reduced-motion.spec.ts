import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { TurnStatePayload, WireTurnState } from '../src/shared/wire/types'

// #796 AC4: under `prefers-reduced-motion: reduce` the status row's icon still RENDERS but does not
// rotate, in either state. This is the only AC on the ticket that a renderer spec structurally cannot
// reach — vitest renders through renderToStaticMarkup with `environment: 'node'`, so there is no DOM, no
// CSSOM and no media query to observe (CLAUDE.md). The unit specs hold the half that IS observable in
// static markup: the `composer-status__icon--spinning` class is present while a turn runs and absent at
// idle. What can only be proven here is that the class stops meaning motion once the preference is set.
//
// It is also this repo's FIRST reduced-motion coverage anywhere — nothing else emulates it, and
// `.bubble__cursor`'s identically-shaped guard (conversation.css:737) has never been exercised. Playwright
// emulates reduced motion natively, so this needs no new dependency, no fixture change, and no shared
// harness: one spec, its own setup.
//
// THREE things a naive clone of a sibling spec would get wrong:
//
//   1. THE EMULATION MUST SELF-VERIFY. If `emulateMedia` silently no-ops on an Electron window, every
//      assertion below still passes — against a page that never entered reduced motion. That is this
//      repo's own all-skip trap (CLAUDE.md: "read the skip reasons, never the exit code") reproduced in a
//      new place, so the matchMedia gate below is load-bearing, not belt-and-braces. If it ever fails, the
//      fallback is Chromium's --force-prefers-reduced-motion switch in the fixture's launch args — take it
//      only after the gate actually fails.
//   2. THE CONTROL ARM MUST EXIST. Without step 5 this spec cannot fail: `animationName === 'none'` is
//      trivially true of a stylesheet that never declared an animation at all, or of an icon that lost its
//      spinning class. The no-preference arm is what proves the assertions above measured the media query
//      rather than a missing rule.
//   3. THE IDLE ARM IS NOT A REDUCED-MOTION TEST. At idle the icon carries no `--spinning` modifier, so
//      no animation is declared and `animationName` is 'none' with or without the preference. It is
//      asserted anyway because AC4 says "in either state", and because it pins the other half of AC3 —
//      the icon is THERE and still, not simply absent.
//
// ASSERT ON CLASS NAMES AND `animationName` ONLY. `animationName` is a discrete string, so there is no
// timing dependence and no flake surface — never assert on a frame, a screenshot, or an elapsed duration.
// Secret hygiene (carried from the siblings): every assertion reads a class or a computed style; no
// failure diagnostic serialises page content, a token, a key or any plaintext.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; the siblings' headroom
// over Playwright's 5s default covers a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The keyframes name conversation.css declares for the turning icon. Held here so the control arm asserts
// the animation is the RIGHT one rather than merely "not none".
const SPIN_ANIMATION_NAME = 'composer-status-spin'

// The coarse turn-phase scalar. A THIRD spec-local copy, deliberately: queued-backlog-interrupt.spec.ts:96
// and stall-bundle.spec.ts each keep their own, and that is the shipped convention — extracting a shared
// helper is a wider refactor than this ticket. timelineBridge drops turn_state's conversation_id (ADR
// 0004) so the id is not a gate here, but it carries SEEDED_ROW.id for realism, as the siblings do.
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

test('the status icon renders but never rotates under reduced motion, running or idle', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const icon = page.locator('.composer-status__icon')
  const spinningIcon = page.locator('.composer-status__icon--spinning')
  const animationName = () => icon.evaluate((el) => getComputedStyle(el).animationName)

  // The row mounts unconditionally (AC2), so the icon is on screen before any preference is set.
  await expect(icon).toBeVisible()

  // --- Enter reduced motion, and PROVE the emulation took effect (fact 1) ---
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect
    .poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
    .toBe(true)

  // --- AC4, idle arm: rendered, still (fact 3) ---
  await expect(icon).toBeVisible()
  await expect(spinningIcon).toHaveCount(0)
  expect(await animationName()).toBe('none')

  // --- AC4, running arm: the class arrives, the motion does not ---
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(spinningIcon).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  expect(await animationName()).toBe('none')

  // --- The control arm: without the preference, the SAME element animates (fact 2) ---
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect
    .poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
    .toBe(false)
  // Still the running state — the class never depended on the media query, only the animation did.
  await expect(spinningIcon).toBeVisible()
  expect(await animationName()).toBe(SPIN_ANIMATION_NAME)

  // Return the thread to idle so the icon's still state is proven to be phase-driven rather than a
  // leftover of the reduced-motion emulation.
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(spinningIcon).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(icon).toBeVisible()
  expect(await animationName()).toBe('none')
})
