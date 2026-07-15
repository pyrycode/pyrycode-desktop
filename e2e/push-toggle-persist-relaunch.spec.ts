import { test, expect } from './fixtures/launchPairedApp'

// Fake-stack UI e2e (#466, split from #429): prove the push-notification preference
// (`pyry.pushNotificationsEnabled`, #408/#409) survives a full app relaunch that reuses the same
// `--user-data-dir`. The preference lives in renderer localStorage, which persists inside the Electron
// user-data dir; a storage regression (wrong key, hydration bug, clear-on-boot) could silently reset it
// and no other e2e would catch it. Zero production code — this pins already-shipped behaviour (#409
// toggle, #408 store, #333 Settings chrome, #140 paired entry, #141 list).
//
// The relaunch uses the shared launchPairedApp fixture's `reuseUserDataDir` affordance: launch 2 reuses
// launch 1's minted dir (the encrypted pairing blob persists there, so the app boots straight to the
// ChannelList) and SKIPS the pairing drive. Driving the paste/Pair/Confirm steps would hang waiting for a
// pairing screen that never appears; and the persisted launch-1 relay URL can't reconnect through launch
// 2's fresh forwarder, so the fixture's default Send-enabled wait may never resolve. The reuse arm
// therefore lands at the list with no live-daemon dependency — the paired route mounts once from the
// persisted pairing record (App.tsx → routeForStatus), independent of the Noise handshake.
//
// The flip is default ENABLED (#408) → DISABLED, so the launch-2 assertion distinguishes "persisted"
// (unchecked) from "reset to default" (checked): an unchecked toggle after the relaunch IS the test.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM role / aria-checked /
// visibility only; the synthetic pairing token + fake static key live inside launchPairedApp and are
// never echoed. No failure diagnostic serialises a token, key, or plaintext.

test('push-notification toggle persists across an app relaunch', async ({ launchPairedApp }) => {
  const pushToggleName = 'Push notifications when claude responds'
  const list = 'section[aria-label="Conversations"]'
  const settings = 'section[aria-label="Settings screen"]'

  // --- Launch 1: flip the toggle away from its ENABLED default. ---
  const { page, app, daemon, userDataDir } = await launchPairedApp()

  // thread → list (the fixture's default drive ends on the thread; Settings is reached list-side, the
  // #465 chain). Then list → Settings via the gear.
  await page.locator('.conversation__back').click()
  await expect(page.locator(list)).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator(settings)).toBeVisible()

  // The switch starts CHECKED (default-empty ⇒ ENABLED, #408). Flip it to DISABLED — this persists the
  // string 'false' under pyry.pushNotificationsEnabled in renderer localStorage.
  const toggle1 = page.getByRole('switch', { name: pushToggleName })
  await expect(toggle1).toBeChecked()
  await toggle1.click()
  await expect(toggle1).toBeChecked({ checked: false })

  // --- Relaunch on the SAME dir. `app.close()` releases the Electron SingletonLock on the dir AND
  // flushes renderer localStorage to disk on graceful exit — so it MUST be awaited before launch 2 (two
  // Electron processes on one --user-data-dir collide on the lock). `daemon.close()` kills daemon 1 so
  // launch 2 provably cannot reconnect through the persisted launch-1 relay URL, matching the ticket's
  // no-live-daemon scenario deterministically. Both re-run best-effort at end-of-test (close is
  // idempotent). ---
  await app.close()
  await daemon.close()

  const { page: page2 } = await launchPairedApp({}, { reuseUserDataDir: userDataDir })

  // --- Launch 2: paired-from-persistence at the list, no drive, no connection. Navigate list → Settings
  // directly (no thread→back this time — the reuse arm returns at the list). ---
  await page2.getByRole('button', { name: 'Settings' }).click()
  await expect(page2.locator(settings)).toBeVisible()

  // ⭐ The assertion. A reset-to-default regression would render this CHECKED; unchecked proves the
  // DISABLED choice persisted across the relaunch.
  await expect(page2.getByRole('switch', { name: pushToggleName })).toBeChecked({ checked: false })
})
